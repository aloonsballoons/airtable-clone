import { faker } from "@faker-js/faker";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { base, baseTable, tableColumn, tableRow, tableView } from "~/server/db/schema";

const MAX_TABLES = 1000;
const MAX_COLUMNS = 500;
const MAX_ROWS = 2_000_000;
const MAX_BULK_ROWS = 100_000;
const BULK_INSERT_BATCH_SIZE = 5_000;
const MAX_ROWS_QUERY_LIMIT = 2_000;

// Module-level state for tracking async GIN index rebuilds.
// When a bulk insert drops + rebuilds GIN indexes via after(),
// the CREATE INDEX holds a SHARE lock that blocks all writes.
// Tracking this lets subsequent bulk inserts skip GIN drops and
// use fast-update buffering instead of blocking for 30-120s.
let ginRebuildInProgress = false;
let ginRebuildStartedAt = 0;
const GIN_REBUILD_STALE_MS = 5 * 60 * 1000; // 5 minutes

const isGinRebuildRunning = () => {
	if (!ginRebuildInProgress) return false;
	// Auto-reset if stale (e.g. callback didn't reset due to crash)
	if (Date.now() - ginRebuildStartedAt > GIN_REBUILD_STALE_MS) {
		ginRebuildInProgress = false;
		ginRebuildStartedAt = 0;
		return false;
	}
	return true;
};

// ---------------------------------------------------------------------------
// Server-side sorted-ID cache.
//
// Sorting 100k+ rows by JSONB-extracted values is expensive (~200-500ms).
// When a user applies a sort, the first getRows call pays this cost.
// Subsequent page fetches (sparse pages, infinite scroll) for the SAME
// sort config can skip the full sort by looking up pre-sorted IDs.
//
// The cache key is: tableId + JSON-serialized sort config + filter/search
// fingerprint.  TTL is short (30s) to avoid stale data after cell edits.
// Max entries capped to bound memory usage.
// ---------------------------------------------------------------------------
type SortCacheEntry = {
	ids: string[];
	createdAt: number;
	totalFiltered: number;
};
const sortedIdCache = new Map<string, SortCacheEntry>();
const SORT_CACHE_TTL_MS = 60_000; // 60 seconds
const SORT_CACHE_MAX_ENTRIES = 50;
// Only cache sorts for tables with at least this many rows — small tables
// sort fast enough that caching adds no benefit.
const SORT_CACHE_MIN_ROWS = 5_000;

const buildSortCacheKey = (
	tableId: string,
	sorts: Array<{ columnId: string; direction: string }>,
	filterFingerprint: string,
	searchFingerprint: string,
) => `${tableId}:${JSON.stringify(sorts)}:${filterFingerprint}:${searchFingerprint}`;

const getSortCache = (key: string): SortCacheEntry | null => {
	const entry = sortedIdCache.get(key);
	if (!entry) return null;
	if (Date.now() - entry.createdAt > SORT_CACHE_TTL_MS) {
		sortedIdCache.delete(key);
		return null;
	}
	return entry;
};

const setSortCache = (key: string, ids: string[], totalFiltered: number) => {
	// Evict oldest entries if at capacity
	if (sortedIdCache.size >= SORT_CACHE_MAX_ENTRIES) {
		let oldestKey: string | null = null;
		let oldestTime = Infinity;
		for (const [k, v] of sortedIdCache) {
			if (v.createdAt < oldestTime) {
				oldestTime = v.createdAt;
				oldestKey = k;
			}
		}
		if (oldestKey) sortedIdCache.delete(oldestKey);
	}
	sortedIdCache.set(key, { ids, createdAt: Date.now(), totalFiltered });
};

// Invalidate all sort cache entries for a given table (called on data mutations)
const invalidateSortCacheForTable = (tableId: string) => {
	for (const key of sortedIdCache.keys()) {
		if (key.startsWith(`${tableId}:`)) {
			sortedIdCache.delete(key);
		}
	}
};

// Tracks in-flight sort cache population promises so getRows can await
// a pre-warm started by setTableSort instead of running a duplicate sort.
const pendingSortCachePopulation = new Map<string, Promise<void>>();

const baseNameSchema = z.string().min(1).max(120);
const tableNameSchema = z.string().min(1).max(120);
const columnNameSchema = z.string().min(1).max(120);
const columnTypeSchema = z.enum(["single_line_text", "long_text", "number"]);
const sortItemSchema = z.object({
	columnId: z.string().uuid(),
	direction: z.enum(["asc", "desc"]),
});
const filterConnectorSchema = z.enum(["and", "or"]);
const filterOperatorSchema = z.enum([
	"contains",
	"does_not_contain",
	"is",
	"is_not",
	"is_empty",
	"is_not_empty",
	"eq",
	"neq",
	"lt",
	"gt",
	"lte",
	"gte",
]);
// Filter schemas for querying (used in getRows - doesn't need id)
const filterConditionSchema = z.object({
	type: z.literal("condition"),
	columnId: z.string().uuid(),
	operator: filterOperatorSchema,
	value: z.string().optional(),
});
type FilterCondition = z.infer<typeof filterConditionSchema>;
type FilterGroup = {
	type: "group";
	connector: "and" | "or";
	conditions: Array<FilterCondition | FilterGroup>;
};

const filterGroupSchema: z.ZodType<FilterGroup> = z.object({
	type: z.literal("group"),
	connector: filterConnectorSchema,
	conditions: z.array(
		z.union([filterConditionSchema, z.lazy(() => filterGroupSchema)])
	),
});
const filterSchema = z.object({
	connector: filterConnectorSchema,
	items: z.array(z.union([filterConditionSchema, filterGroupSchema])),
});

// Filter schemas for storage (used in updateView - includes id for React keys)
const filterConditionStorageSchema = z.object({
	id: z.string().uuid(),
	type: z.literal("condition"),
	columnId: z.string().uuid().nullable(),
	operator: filterOperatorSchema,
	value: z.string(),
});
type FilterConditionStorage = z.infer<typeof filterConditionStorageSchema>;
type FilterGroupStorage = {
	id: string;
	type: "group";
	connector: "and" | "or";
	conditions: Array<FilterConditionStorage | FilterGroupStorage>;
};

const filterGroupStorageSchema: z.ZodType<FilterGroupStorage> = z.object({
	id: z.string().uuid(),
	type: z.literal("group"),
	connector: filterConnectorSchema,
	conditions: z.array(
		z.union([filterConditionStorageSchema, z.lazy(() => filterGroupStorageSchema)])
	),
});
const filterStorageSchema = z.object({
	connector: filterConnectorSchema,
	items: z.array(z.union([filterConditionStorageSchema, filterGroupStorageSchema])),
});
const filterTextOperators = new Set([
	"contains",
	"does_not_contain",
	"is",
	"is_not",
	"is_empty",
	"is_not_empty",
]);
const filterNumberOperators = new Set([
	"eq",
	"neq",
	"lt",
	"gt",
	"lte",
	"gte",
	"is_empty",
	"is_not_empty",
]);
const filterOperatorsRequiringValue = new Set([
	"contains",
	"does_not_contain",
	"is",
	"is_not",
	"eq",
	"neq",
	"lt",
	"gt",
	"lte",
	"gte",
]);
const MAX_CELL_CHARS = 100_000;
const MAX_NUMBER_DECIMALS = 8;

const createId = () => crypto.randomUUID();

const clampTextValue = (value: string) => value.slice(0, MAX_CELL_CHARS);

const normalizeSingleLineValue = (value: string) =>
	clampTextValue(value.replace(/\r?\n/g, " "));

const normalizeLongTextValue = (value: string) => clampTextValue(value);

const normalizeNumberValue = (value: string) => {
	const trimmed = value.trim();
	if (!trimmed) return "";
	const match = trimmed.match(/^(-?)(\d*)(?:\.(\d*))?$/);
	if (!match) return null;
	const sign = match[1] ?? "";
	let integer = match[2] ?? "";
	let decimals = match[3] ?? "";
	if (!integer && !decimals) return "";
	if (!integer) integer = "0";
	if (decimals.length > MAX_NUMBER_DECIMALS) return null;
	return decimals ? `${sign}${integer}.${decimals}` : `${sign}${integer}`;
};

const coerceColumnType = (
	value?: string | null,
): z.infer<typeof columnTypeSchema> =>
	value === "long_text" || value === "number" ? value : "single_line_text";

const generateFakerValueForColumnType = (columnType: z.infer<typeof columnTypeSchema>) => {
	if (columnType === "long_text") {
		return normalizeLongTextValue(
			faker.lorem.paragraphs({ min: 1, max: 2 }),
		);
	}
	if (columnType === "number") {
		const normalizedNumber = normalizeNumberValue(
			String(faker.number.int({ min: -1_000_000, max: 1_000_000 })),
		);
		return normalizedNumber ?? "0";
	}
	return normalizeSingleLineValue(faker.lorem.words({ min: 2, max: 6 }));
};

const generateFakerRowData = (columns: Array<{ id: string; type: string }>) => {
	const data: Record<string, string> = {};
	for (const column of columns) {
		const columnType = coerceColumnType(column.type);
		data[column.id] = generateFakerValueForColumnType(columnType);
	}
	return data;
};

const BULK_TEXT_PREFIXES = [
	"Atlas",
	"Beacon",
	"Cedar",
	"Delta",
	"Ember",
	"Falcon",
	"Glacier",
	"Harbor",
	"Iris",
	"Juniper",
	"Kite",
	"Lumen",
	"Meridian",
	"Nova",
	"Orbit",
	"Pioneer",
	"Quartz",
	"River",
	"Summit",
	"Timber",
];

const BULK_TEXT_NOUNS = [
	"Plan",
	"Project",
	"Request",
	"Review",
	"Task",
	"Record",
	"Ticket",
	"Asset",
	"Milestone",
	"Brief",
	"Update",
	"Proposal",
	"Rollout",
	"Audit",
	"Checklist",
];

const BULK_LONG_ACTIONS = [
	"Review",
	"Confirm",
	"Prepare",
	"Coordinate",
	"Validate",
	"Schedule",
	"Update",
	"Document",
	"Track",
	"Finalize",
];

const BULK_LONG_OBJECTS = [
	"handoff details",
	"delivery scope",
	"support notes",
	"launch checklist",
	"risk summary",
	"resource plan",
	"timeline changes",
	"approval path",
	"onboarding steps",
	"status blockers",
];

const BULK_LONG_CONTEXTS = [
	"the growth team",
	"operations",
	"customer success",
	"finance",
	"engineering",
	"marketing",
	"product",
	"support",
	"leadership",
	"partners",
];

const BULK_LONG_OUTCOMES = [
	"pending review",
	"ready for handoff",
	"blocked by dependency",
	"on schedule",
	"in progress",
	"needs approval",
	"awaiting feedback",
	"validated",
	"scheduled",
	"complete",
];

const buildBulkLexiconValueExpression = (
	values: readonly string[],
	seriesAlias: string,
	columnOffset: number,
	multiplier: number,
) => {
	// Optimized: Pre-compute the modulo and array size for faster SQL execution
	const valueCountLiteral = sql.raw(String(values.length));
	const multiplierLiteral = sql.raw(String(multiplier));
	const columnOffsetLiteral = sql.raw(String(columnOffset));
	const offsetMultiplierLiteral = sql.raw(String(multiplier + 5));
	const rowNumber = sql.raw(`${seriesAlias}.row_num`);

	// Use simpler array literal for better performance
	const arrayLiteral = `ARRAY[${values.map(v => `'${v.replace(/'/g, "''")}'`).join(',')}]`;
	return sql<string>`(${sql.raw(arrayLiteral)}::text[])[(((${rowNumber} * ${multiplierLiteral}) + ${columnOffsetLiteral} * ${offsetMultiplierLiteral}) % ${valueCountLiteral}) + 1]`;
};

const buildBulkPopulateValueExpression = (
	columnType: z.infer<typeof columnTypeSchema>,
	seriesAlias: string,
	columnOffset: number,
) => {
	const rowNumber = sql.raw(`${seriesAlias}.row_num`);
	const columnOffsetLiteral = sql.raw(String(columnOffset));
	if (columnType === "number") {
		// Optimized: simpler arithmetic for number generation
		return sql<string>`((${rowNumber} * 97 + ${columnOffsetLiteral} * 13) % 500001 - 250000)::text`;
	}
	if (columnType === "long_text") {
		const action = buildBulkLexiconValueExpression(
			BULK_LONG_ACTIONS,
			seriesAlias,
			columnOffset,
			7,
		);
		const object = buildBulkLexiconValueExpression(
			BULK_LONG_OBJECTS,
			seriesAlias,
			columnOffset,
			11,
		);
		const context = buildBulkLexiconValueExpression(
			BULK_LONG_CONTEXTS,
			seriesAlias,
			columnOffset,
			13,
		);
		const outcome = buildBulkLexiconValueExpression(
			BULK_LONG_OUTCOMES,
			seriesAlias,
			columnOffset,
			17,
		);
		// Optimized: use || operator instead of concat() for better performance
		return sql<string>`(${action} || ' ' || ${object} || ' for ' || ${context} || '. Status: ' || ${outcome} || '.')`;
	}
	const prefix = buildBulkLexiconValueExpression(
		BULK_TEXT_PREFIXES,
		seriesAlias,
		columnOffset,
		19,
	);
	const noun = buildBulkLexiconValueExpression(
		BULK_TEXT_NOUNS,
		seriesAlias,
		columnOffset,
		23,
	);
	// Optimized: use || operator instead of concat() for better performance
	return sql<string>`(${prefix} || ' ' || ${noun})`;
};

const buildBulkPopulateSqlExpressions = (columns: Array<{ id: string; type: string }>) => {
	const valueColumns = columns.map((column, index) => ({
		id: column.id,
		expression: buildBulkPopulateValueExpression(
			coerceColumnType(column.type),
			"series",
			index,
		),
	}));

	const dataExpression = sql`jsonb_build_object(${sql.join(
		valueColumns.flatMap((column) => [
			sql`${column.id}::text`,
			sql`${column.expression}::text`,
		]),
		sql`, `,
	)})`;

	// Build search text expression by concatenating all values with spaces
	// Optimized: use || operator with COALESCE for better performance
	const searchTextExpression = valueColumns.length > 0
		? valueColumns.length === 1
			? valueColumns[0]!.expression
			: sql`(${sql.join(
					valueColumns.map((column) => column.expression),
					sql` || ' ' || `,
				)})`
		: sql`''`;

	return {
		dataExpression,
		searchTextExpression,
	};
};

const buildSearchText = (data: Record<string, string> | null | undefined) =>
	Object.values(data ?? {})
		.map((value) => String(value ?? "").trim())
		.filter(Boolean)
		.join(" ");

const nanosecondsToMilliseconds = (value: bigint) => Number(value) / 1_000_000;
const roundMilliseconds = (value: number) => Math.round(value * 100) / 100;

export const baseRouter = createTRPCRouter({
	list: protectedProcedure.query(async ({ ctx }) => {
		const bases = await ctx.db.query.base.findMany({
			where: eq(base.ownerId, ctx.session.user.id),
			orderBy: (base, { desc }) => [desc(base.createdAt)],
		});

		return bases.map((item) => ({
			id: item.id,
			name: item.name,
			updatedAt: item.updatedAt,
		}));
	}),

	touch: protectedProcedure
		.input(z.object({ baseId: z.string().uuid() }))
		.mutation(async ({ ctx, input }) => {
			const [updated] = await ctx.db
				.update(base)
				.set({ updatedAt: new Date() })
				.where(and(eq(base.id, input.baseId), eq(base.ownerId, ctx.session.user.id)))
				.returning({ id: base.id, updatedAt: base.updatedAt });

			if (!updated) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}

			return updated;
		}),

	get: protectedProcedure
		.input(z.object({ baseId: z.string().uuid() }))
		.query(async ({ ctx, input }) => {
			const found = await ctx.db.query.base.findFirst({
				where: and(eq(base.id, input.baseId), eq(base.ownerId, ctx.session.user.id)),
				with: {
					tables: {
						orderBy: (table, { asc }) => [asc(table.createdAt)],
						with: {
							views: {
								orderBy: (view, { asc }) => [asc(view.createdAt)],
							},
						},
					},
				},
			});

			if (!found) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}

			return {
				id: found.id,
				name: found.name,
				tables: found.tables.map((table) => ({
					id: table.id,
					name: table.name,
					views: table.views.map((view) => ({
						id: view.id,
						name: view.name,
						sortConfig: Array.isArray(view.sortConfig) ? view.sortConfig : [],
						hiddenColumnIds: Array.isArray(view.hiddenColumnIds) ? view.hiddenColumnIds : [],
						searchQuery: view.searchQuery ?? "",
						filterConfig: view.filterConfig ?? null,
					})),
				})),
			};
		}),

	create: protectedProcedure
		.input(z.object({ name: baseNameSchema.optional() }))
		.mutation(async ({ ctx, input }) => {
			const baseName = input.name ?? "Untitled Base";

			const [newBase] = await ctx.db
				.insert(base)
				.values({
					id: createId(),
					name: baseName,
					ownerId: ctx.session.user.id,
				})
				.returning({ id: base.id, name: base.name });

			if (!newBase) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
			}

			const [newTable] = await ctx.db
				.insert(baseTable)
				.values({
					id: createId(),
					baseId: newBase.id,
					name: "Table 1",
				})
				.returning({ id: baseTable.id, name: baseTable.name });

			if (!newTable) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
			}

			const defaultColumns = await ctx.db
				.insert(tableColumn)
				.values([
					{
						id: createId(),
						tableId: newTable.id,
						name: "Name",
						type: "single_line_text",
					},
					{
						id: createId(),
						tableId: newTable.id,
						name: "Notes",
						type: "long_text",
					},
					{
						id: createId(),
						tableId: newTable.id,
						name: "Assignee",
						type: "single_line_text",
					},
					{
						id: createId(),
						tableId: newTable.id,
						name: "Status",
						type: "single_line_text",
					},
					{
						id: createId(),
						tableId: newTable.id,
						name: "Attachments",
						type: "single_line_text",
					},
				])
				.returning({ id: tableColumn.id, name: tableColumn.name });
			if (defaultColumns.length > 0) {
				const rows = Array.from({ length: 3 }, () => ({
					id: createId(),
					tableId: newTable.id,
					data: {},
				}));
				await ctx.db.insert(tableRow).values(rows);
				await ctx.db.update(baseTable).set({ rowCount: rows.length }).where(eq(baseTable.id, newTable.id));
			}

			// Create a default "Grid view" for the new table
			await ctx.db.insert(tableView).values({
				id: createId(),
				tableId: newTable.id,
				name: "Grid view",
				sortConfig: [],
				hiddenColumnIds: [],
				searchQuery: null,
				filterConfig: null,
			});

			return {
				base: newBase,
				table: newTable,
			};
		}),

	rename: protectedProcedure
		.input(z.object({ baseId: z.string().uuid(), name: baseNameSchema }))
		.mutation(async ({ ctx, input }) => {
			const [updated] = await ctx.db
				.update(base)
				.set({ name: input.name })
				.where(and(eq(base.id, input.baseId), eq(base.ownerId, ctx.session.user.id)))
				.returning({ id: base.id, name: base.name });

			if (!updated) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}

			return updated;
		}),

	delete: protectedProcedure
		.input(z.object({ baseId: z.string().uuid() }))
		.mutation(async ({ ctx, input }) => {
			const [deleted] = await ctx.db
				.delete(base)
				.where(and(eq(base.id, input.baseId), eq(base.ownerId, ctx.session.user.id)))
				.returning({ id: base.id });

			if (!deleted) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}

			return deleted;
		}),

	addTable: protectedProcedure
		.input(z.object({ baseId: z.string().uuid(), name: tableNameSchema.optional() }))
		.mutation(async ({ ctx, input }) => {
			const baseRecord = await ctx.db.query.base.findFirst({
				where: and(eq(base.id, input.baseId), eq(base.ownerId, ctx.session.user.id)),
			});

			if (!baseRecord) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}

			const tableCount = await ctx.db
				.select({ count: sql<number>`count(*)::int` })
				.from(baseTable)
				.where(eq(baseTable.baseId, input.baseId));

			const currentCount = Number(tableCount[0]?.count ?? 0);
			if (currentCount >= MAX_TABLES) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Table limit of ${MAX_TABLES} reached.`,
				});
			}

			const nextIndex = currentCount + 1;
			const tableName = input.name ?? `Table ${nextIndex}`;

			const [newTable] = await ctx.db
				.insert(baseTable)
				.values({
					id: createId(),
					baseId: input.baseId,
					name: tableName,
				})
				.returning({ id: baseTable.id, name: baseTable.name });

			if (!newTable) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
			}

			await ctx.db.insert(tableColumn).values([
				{
					id: createId(),
					tableId: newTable.id,
					name: "Name",
					type: "single_line_text",
				},
				{
					id: createId(),
					tableId: newTable.id,
					name: "Notes",
					type: "long_text",
				},
				{
					id: createId(),
					tableId: newTable.id,
					name: "Assignee",
					type: "single_line_text",
				},
				{
					id: createId(),
					tableId: newTable.id,
					name: "Status",
					type: "single_line_text",
				},
				{
					id: createId(),
					tableId: newTable.id,
					name: "Attachments",
					type: "single_line_text",
				},
			]);

			const rows = Array.from({ length: 3 }, () => ({
				id: createId(),
				tableId: newTable.id,
				data: {},
			}));
			await ctx.db.insert(tableRow).values(rows);
			await ctx.db.update(baseTable).set({ rowCount: rows.length }).where(eq(baseTable.id, newTable.id));

			// Create a default "Grid view" for the new table
			await ctx.db.insert(tableView).values({
				id: createId(),
				tableId: newTable.id,
				name: "Grid view",
				sortConfig: [],
				hiddenColumnIds: [],
				searchQuery: null,
				filterConfig: null,
			});

			return newTable;
		}),

	addColumn: protectedProcedure
		.input(
			z.object({
				tableId: z.string().uuid(),
				name: columnNameSchema.optional(),
				id: z.string().uuid().optional(),
				type: columnTypeSchema.optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const tableRecord = await ctx.db.query.baseTable.findFirst({
				where: eq(baseTable.id, input.tableId),
				with: {
					base: true,
				},
			});

			if (!tableRecord || tableRecord.base.ownerId !== ctx.session.user.id) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}

			const columnCount = await ctx.db
				.select({ count: sql<number>`count(*)::int` })
				.from(tableColumn)
				.where(eq(tableColumn.tableId, input.tableId));

			const currentCount = Number(columnCount[0]?.count ?? 0);
			if (currentCount >= MAX_COLUMNS) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Column limit of ${MAX_COLUMNS} reached.`,
				});
			}

			const nextIndex = currentCount + 1;
			const columnName = input.name ?? `Column ${nextIndex}`;
			const columnType = input.type ?? "single_line_text";

			const [newColumn] = await ctx.db
				.insert(tableColumn)
				.values({
					id: input.id ?? createId(),
					tableId: input.tableId,
					name: columnName,
					type: columnType,
				})
				.returning({ id: tableColumn.id, name: tableColumn.name });

			if (!newColumn) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
			}

			return newColumn;
		}),

	addRows: protectedProcedure
		.input(
			z.object({
				tableId: z.string().uuid(),
				count: z.number().int().min(1).max(MAX_BULK_ROWS),
				ids: z.array(z.string().uuid()).optional(),
				populateWithFaker: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const shouldLogTiming = input.count >= 10_000 || Boolean(input.populateWithFaker);
			const requestStart = process.hrtime.bigint();
			let phaseStart = requestStart;
			const phases: Array<{ phase: string; ms: number }> = [];
			const markPhase = (phase: string) => {
				const now = process.hrtime.bigint();
				phases.push({
					phase,
					ms: roundMilliseconds(nanosecondsToMilliseconds(now - phaseStart)),
				});
				phaseStart = now;
			};
			let mode = "standard";
			let errorCode: string | null = null;
			let errorMessage: string | null = null;
			let searchBackfillScheduled = false;

			try {
				if (input.ids && input.ids.length !== input.count) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Row id list must match the requested count.",
					});
				}
				if (input.ids && new Set(input.ids).size !== input.ids.length) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Row id list must be unique.",
					});
				}

				// Fetch table record with columns in a single query (saves a
				// DB round trip vs separate fetches for auth + columns).
				const tableRecord = await ctx.db.query.baseTable.findFirst({
					where: eq(baseTable.id, input.tableId),
					with: {
						base: true,
						columns: true,
					},
				});

				if (!tableRecord || tableRecord.base.ownerId !== ctx.session.user.id) {
					throw new TRPCError({ code: "NOT_FOUND" });
				}

				// Use cached row_count column instead of expensive COUNT(*) scan.
				// COUNT(*) over 100k-500k JSONB rows takes 0.5-5s and gets slower
				// with each subsequent bulk insert — the #1 bottleneck for repeat use.
				const currentCount = tableRecord.rowCount;
				if (currentCount + input.count > MAX_ROWS) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: `Row limit of ${MAX_ROWS.toLocaleString()} reached.`,
					});
				}
				markPhase("preflight");

				if (input.populateWithFaker) {
					if (!input.ids) {
						mode = "populate-sql";
						const normalizedColumns = tableRecord.columns.map((column) => ({
							id: column.id,
							type: column.type ?? "single_line_text",
						}));

						if (normalizedColumns.length === 0) {
							// Insert empty rows - single batch is fastest
							await ctx.db.execute(sql`
								INSERT INTO table_row (id, table_id, data, search_text, created_at, updated_at)
								SELECT
									gen_random_uuid(),
									${input.tableId}::uuid,
									'{}'::jsonb,
									'',
									NOW(),
									NOW()
								FROM generate_series(1::int, ${sql.raw(String(input.count))}::int)
							`);
							markPhase("insert");
							await ctx.db.execute(sql`UPDATE base_table SET row_count = row_count + ${input.count} WHERE id = ${input.tableId}`);
							return { added: input.count, newTotalCount: currentCount + input.count };
						}

						// Use lexicon-based data generation for UNIQUE data across all 100k rows
						const bulkExpressions = buildBulkPopulateSqlExpressions(normalizedColumns);
						const isBulkInsert = input.count >= 10_000;

						// Only drop btree indexes when the table is small relative
						// to the insert size. For large tables (e.g. 200k+ rows),
						// rebuilding btree over (existing+new) rows is SLOWER than
						// letting PostgreSQL append to the btree during INSERT
						// (since created_at is monotonically increasing → append-only).
						// This is the #2 bottleneck that makes each subsequent
						// 100k insert slower.
						const shouldDropBtreeIndexes = isBulkInsert && currentCount < input.count;

						// GIN indexes are always expensive to maintain during bulk
						// inserts (inverted index updates per term per row).
						// Instead of relying on the module-level ginRebuildInProgress
						// flag (unreliable across serverless instances), check the
						// actual database catalog: drop only VALID GIN indexes.
						// Invalid indexes (in-progress CONCURRENTLY builds, Phase 1)
						// don't incur write overhead and trying to DROP them would
						// block on their lock for 30-120s.
						const shouldDropGinIndexes = isBulkInsert;

						// IMPORTANT: Index drop and rebuild are kept OUTSIDE the
						// transaction. If the Vercel function times out during a
						// long-running transaction, PostgreSQL rolls back the entire
						// txn — including the INSERT. By auto-committing the DROP
						// and INSERT separately, the rows survive a timeout during
						// the subsequent index rebuild phase.

						// Track whether GIN indexes were actually dropped (used to
						// decide whether to schedule a rebuild in after()).
						let didDropGinIndexes = false;

						{
							// Cancel any in-progress GIN CONCURRENTLY builds
							// BEFORE dropping indexes. During Phase 2 of a
							// CONCURRENTLY build (indisready=true,
							// indisvalid=false), PostgreSQL maintains GIN
							// entries on every write — this is the #1 cause of
							// increasing INSERT latency on repeated bulk inserts.
							// The previous logic only checked indisvalid and
							// missed Phase 2 indexes that still impose full GIN
							// maintenance cost.
							if (shouldDropGinIndexes) {
								const cancelResult = await ctx.db.execute(sql`
									SELECT pg_cancel_backend(pid)
									FROM pg_stat_activity
									WHERE query ILIKE '%CREATE INDEX CONCURRENTLY%table_row%'
									AND pid != pg_backend_pid()
									AND state != 'idle'
								`);
								if ([...cancelResult].length > 0) {
									ginRebuildInProgress = false;
									ginRebuildStartedAt = 0;
								}
							}

							const drops: Promise<unknown>[] = [];
							// Always clean up the redundant standalone (table_id)
							// index — it's fully covered by the composite
							// (table_id, created_at, id) and adds unnecessary
							// maintenance cost during every subsequent insert.
							drops.push(
								ctx.db.execute(sql`DROP INDEX IF EXISTS table_row_table_idx`),
							);
							if (shouldDropBtreeIndexes) {
								drops.push(
									ctx.db.execute(sql`DROP INDEX IF EXISTS table_row_table_created_idx`),
								);
							}
							if (shouldDropGinIndexes) {
								// Unconditionally drop ALL GIN indexes regardless
								// of validity state. After canceling in-progress
								// builds above, remaining indexes are either:
								// (a) valid — normal drop
								// (b) invalid from canceled builds — instant drop
								drops.push(
									ctx.db.execute(sql`DROP INDEX IF EXISTS table_row_data_gin_idx`),
									ctx.db.execute(sql`DROP INDEX IF EXISTS table_row_search_text_trgm_idx`),
								);
							}
							await Promise.all(drops);

							if (shouldDropGinIndexes) {
								// Verify ALL GIN indexes are gone (valid AND
								// invalid) — not just valid ones. An invalid
								// index with indisready=true still imposes GIN
								// maintenance cost on writes.
								const ginCheck = await ctx.db.execute(sql`
									SELECT count(*)::int AS cnt FROM pg_index i
									JOIN pg_class c ON c.oid = i.indexrelid
									WHERE c.relname IN ('table_row_data_gin_idx', 'table_row_search_text_trgm_idx')
								`);
								const ginRemaining = Number(([...ginCheck] as Array<{ cnt: number }>)[0]?.cnt ?? 0);
								didDropGinIndexes = ginRemaining === 0;
							}

							if (shouldDropBtreeIndexes || didDropGinIndexes) {
								markPhase("drop-indexes");
							}
						}

						try {
							// Transaction scoped to SET LOCAL + INSERT only so the
							// memory/WAL settings actually apply to the insert.
							await ctx.db.transaction(async (tx) => {
								// Combine all session config into a single DB call to
								// eliminate 2-3 network round-trips (~15-60ms savings).
								// Always set gin_pending_list_limit as a safety net —
								// if GIN indexes exist in any state (e.g. concurrent
								// build in Phase 2 where indisready=true), the large
								// pending list buffers GIN updates instead of syncing
								// per-row.
								await tx.execute(sql`
									SELECT set_config('work_mem', '512MB', true),
										set_config('maintenance_work_mem', '512MB', true),
										set_config('synchronous_commit', 'off', true),
										set_config('gin_pending_list_limit', '256MB', true)
								`);

								await tx.execute(sql`
									INSERT INTO table_row (id, table_id, data, search_text, created_at, updated_at)
									SELECT
										gen_random_uuid(),
										${input.tableId}::uuid,
										${bulkExpressions.dataExpression},
										${bulkExpressions.searchTextExpression},
										NOW(),
										NOW()
									FROM generate_series(1::int, ${sql.raw(String(input.count))}::int) AS series(row_num)
								`);
								markPhase("insert");
							});
						} finally {
							// Always rebuild indexes — even if the INSERT failed,
							// we dropped them above and must restore them.
							if (shouldDropBtreeIndexes || didDropGinIndexes) {
								if (shouldDropBtreeIndexes) {
									// Rebuild composite btree (needed for pagination).
									// The standalone (table_id) index is NOT recreated —
									// it's fully covered by this composite index.
									await ctx.db.execute(sql`
										CREATE INDEX IF NOT EXISTS table_row_table_created_idx
										ON table_row (table_id, created_at, id)
									`);
									markPhase("rebuild-btree-indexes");
								}

								if (didDropGinIndexes && !isGinRebuildRunning()) {
									ginRebuildInProgress = true;
									ginRebuildStartedAt = Date.now();
									after(async () => {
										const ginStart = process.hrtime.bigint();
										try {
											// Clean up any invalid indexes from previous
											// failed concurrent builds.
											await ctx.db.execute(sql`
												DO $$ BEGIN
													PERFORM 1 FROM pg_index i
													JOIN pg_class c ON c.oid = i.indexrelid
													WHERE c.relname = 'table_row_data_gin_idx'
													AND NOT i.indisvalid;
													IF FOUND THEN
														EXECUTE 'DROP INDEX table_row_data_gin_idx';
													END IF;
													PERFORM 1 FROM pg_index i
													JOIN pg_class c ON c.oid = i.indexrelid
													WHERE c.relname = 'table_row_search_text_trgm_idx'
													AND NOT i.indisvalid;
													IF FOUND THEN
														EXECUTE 'DROP INDEX table_row_search_text_trgm_idx';
													END IF;
												END $$;
											`);
											// Use CONCURRENTLY to avoid holding a SHARE
											// lock that blocks all writes for 30-120s.
											// Sequential to avoid conflicting concurrent
											// builds on the same table.
											await ctx.db.execute(sql`
												CREATE INDEX CONCURRENTLY IF NOT EXISTS table_row_data_gin_idx
												ON table_row USING gin (data)
											`);
											await ctx.db.execute(sql`
												CREATE INDEX CONCURRENTLY IF NOT EXISTS table_row_search_text_trgm_idx
												ON table_row USING gin (search_text gin_trgm_ops)
											`);
											// Update table statistics after bulk insert so
											// the planner picks optimal plans for subsequent
											// queries (getRows pagination, next bulk insert).
											await ctx.db.execute(sql`ANALYZE table_row`);
											const ginMs = roundMilliseconds(
												nanosecondsToMilliseconds(process.hrtime.bigint() - ginStart),
											);
											console.info("[base.addRows] GIN indexes rebuilt + ANALYZE", {
												ginMs,
												tableId: input.tableId,
												count: input.count,
											});
										} catch (error) {
											console.error("[base.addRows] GIN index rebuild failed:", error);
										} finally {
											ginRebuildInProgress = false;
											ginRebuildStartedAt = 0;
										}
									});
								}
							}
						}

						await ctx.db.execute(sql`UPDATE base_table SET row_count = row_count + ${input.count} WHERE id = ${input.tableId}`);
						return { added: input.count, newTotalCount: currentCount + input.count };
					}

					// Columns already loaded with tableRecord above
					const normalizedColumns = tableRecord.columns.map((column) => ({
						id: column.id,
						type: column.type ?? "single_line_text",
					}));

					mode = "populate-js";
					await ctx.db.transaction(async (tx) => {
						for (
							let batchStart = 0;
							batchStart < input.count;
							batchStart += BULK_INSERT_BATCH_SIZE
						) {
							const batchCount = Math.min(
								BULK_INSERT_BATCH_SIZE,
								input.count - batchStart,
							);
							const batchRows = Array.from({ length: batchCount }, (_, batchIndex) => {
								const providedId = input.ids?.[batchStart + batchIndex];
								if (input.ids && !providedId) {
									throw new TRPCError({
										code: "BAD_REQUEST",
										message: "Row id list must match the requested count.",
									});
								}
								const rowId = providedId ?? createId();
								const data = generateFakerRowData(normalizedColumns);
								return {
									id: rowId,
									tableId: input.tableId,
									data,
									searchText: buildSearchText(data),
								};
							});
							await tx.insert(tableRow).values(batchRows);
						}
					});
					markPhase("insert");
					await ctx.db.execute(sql`UPDATE base_table SET row_count = row_count + ${input.count} WHERE id = ${input.tableId}`);
					return { added: input.count, newTotalCount: currentCount + input.count };
				}

				// Use PostgreSQL generate_series for bulk insert in a single query.
				// For explicit IDs, prefer a typed insert to avoid uuid[] array-literal casts.
				if (input.ids) {
					mode = "blank-explicit-ids";
					await ctx.db.insert(tableRow).values(
						input.ids.map((id) => ({
							id,
							tableId: input.tableId,
							data: {},
						})),
					);
				} else {
					mode = "blank-sql";
					// Let PostgreSQL generate UUIDs - even faster
					await ctx.db.execute(sql`
					INSERT INTO table_row (id, table_id, data, search_text, created_at, updated_at)
					SELECT
						gen_random_uuid(),
						${input.tableId}::uuid,
						'{}'::jsonb,
						'',
						NOW(),
						NOW()
					FROM generate_series(1, ${input.count})
					`);
				}
				markPhase("insert");
				await ctx.db.execute(sql`UPDATE base_table SET row_count = row_count + ${input.count} WHERE id = ${input.tableId}`);
				return { added: input.count, newTotalCount: currentCount + input.count };
			} catch (error) {
				errorCode = error instanceof TRPCError ? error.code : "INTERNAL_ERROR";
				if (error instanceof Error) {
					errorMessage = error.message;
				}
				throw error;
			} finally {
				// Invalidate sort cache — new rows change sort order
				invalidateSortCacheForTable(input.tableId);

				if (shouldLogTiming) {
					const totalMs = roundMilliseconds(
						nanosecondsToMilliseconds(process.hrtime.bigint() - requestStart),
					);
					console.info("[base.addRows.timing]", {
						tableId: input.tableId,
						count: input.count,
						mode,
							populateWithFaker: Boolean(input.populateWithFaker),
							hasExplicitIds: Boolean(input.ids?.length),
							errorCode,
							errorMessage,
							searchBackfillScheduled,
							totalMs,
							phases,
						});
				}
			}
		}),

	deleteBase: protectedProcedure
		.input(z.object({ baseId: z.string().uuid() }))
		.mutation(async ({ ctx, input }) => {
			const deleted = await ctx.db
				.delete(base)
				.where(and(eq(base.id, input.baseId), eq(base.ownerId, ctx.session.user.id)))
				.returning({ id: base.id });

			return { success: deleted.length > 0 };
		}),

	deleteTable: protectedProcedure
		.input(z.object({ tableId: z.string().uuid() }))
		.mutation(async ({ ctx, input }) => {
			const tableRecord = await ctx.db.query.baseTable.findFirst({
				where: eq(baseTable.id, input.tableId),
				with: {
					base: true,
				},
			});

			if (!tableRecord || tableRecord.base.ownerId !== ctx.session.user.id) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}

			const tableCount = await ctx.db
				.select({ count: sql<number>`count(*)::int` })
				.from(baseTable)
				.where(eq(baseTable.baseId, tableRecord.baseId));

			if (Number(tableCount[0]?.count ?? 0) <= 1) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "At least one table is required.",
				});
			}

			await ctx.db.delete(baseTable).where(eq(baseTable.id, input.tableId));
			return { success: true };
		}),

	renameTable: protectedProcedure
		.input(z.object({ tableId: z.string().uuid(), name: tableNameSchema }))
		.mutation(async ({ ctx, input }) => {
			const tableRecord = await ctx.db.query.baseTable.findFirst({
				where: eq(baseTable.id, input.tableId),
				with: {
					base: true,
				},
			});

			if (!tableRecord || tableRecord.base.ownerId !== ctx.session.user.id) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}

			const [updated] = await ctx.db
				.update(baseTable)
				.set({ name: input.name, updatedAt: new Date() })
				.where(eq(baseTable.id, input.tableId))
				.returning({ id: baseTable.id, name: baseTable.name });

			if (!updated) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
			}

			return updated;
		}),

	deleteColumn: protectedProcedure
		.input(z.object({ columnId: z.string().uuid() }))
		.mutation(async ({ ctx, input }) => {
			const columnRecord = await ctx.db.query.tableColumn.findFirst({
				where: eq(tableColumn.id, input.columnId),
				with: {
					table: {
						with: {
							base: true,
						},
					},
				},
			});

			if (!columnRecord || columnRecord.table.base.ownerId !== ctx.session.user.id) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}

			const columnCount = await ctx.db
				.select({ count: sql<number>`count(*)::int` })
				.from(tableColumn)
				.where(eq(tableColumn.tableId, columnRecord.tableId));

			if (Number(columnCount[0]?.count ?? 0) <= 1) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "At least one column is required.",
				});
			}

			await ctx.db
				.delete(tableColumn)
				.where(eq(tableColumn.id, input.columnId));

			const currentSortConfig = Array.isArray(columnRecord.table.sortConfig)
				? columnRecord.table.sortConfig
				: [];
			const nextSortConfig = currentSortConfig.filter(
				(sort) => sort?.columnId !== input.columnId,
			);
			if (
				nextSortConfig.length !== currentSortConfig.length ||
				columnRecord.table.sortColumnId === input.columnId
			) {
				const nextPrimary = nextSortConfig[0] ?? null;
				await ctx.db
					.update(baseTable)
					.set({
						sortConfig: nextSortConfig,
						sortColumnId: nextPrimary?.columnId ?? null,
						sortDirection: nextPrimary?.direction ?? null,
					})
					.where(eq(baseTable.id, columnRecord.tableId));
			}
			const currentHiddenColumnIds = Array.isArray(
				columnRecord.table.hiddenColumnIds,
			)
				? columnRecord.table.hiddenColumnIds
				: [];
			const nextHiddenColumnIds = currentHiddenColumnIds.filter(
				(columnId) => columnId !== input.columnId,
			);
			if (nextHiddenColumnIds.length !== currentHiddenColumnIds.length) {
				await ctx.db
					.update(baseTable)
					.set({ hiddenColumnIds: nextHiddenColumnIds })
					.where(eq(baseTable.id, columnRecord.tableId));
			}
			return { success: true };
		}),

	setTableSort: protectedProcedure
		.input(
			z.object({
				tableId: z.string().uuid(),
				sort: z.array(sortItemSchema).nullable(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const providedSort = input.sort ?? [];

			// Parallelize auth check and column validation
			const columnIds = providedSort.map((s) => s.columnId);
			const [tableRecord, columnRecords] = await Promise.all([
				ctx.db.query.baseTable.findFirst({
					where: eq(baseTable.id, input.tableId),
					with: {
						base: true,
					},
				}),
				columnIds.length > 0
					? ctx.db.query.tableColumn.findMany({
							where: inArray(tableColumn.id, columnIds),
						})
					: Promise.resolve([]),
			]);

			if (!tableRecord || tableRecord.base.ownerId !== ctx.session.user.id) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}
			const rawHiddenColumnIds = Array.isArray(tableRecord.hiddenColumnIds)
				? tableRecord.hiddenColumnIds
				: [];
			const hiddenColumnIdSet = new Set(
				rawHiddenColumnIds.filter((columnId): columnId is string =>
					typeof columnId === "string",
				),
			);

			const uniqueSort: Array<{ columnId: string; direction: "asc" | "desc" }> = [];
			const seenColumns = new Set<string>();
			for (const item of providedSort) {
				if (seenColumns.has(item.columnId)) continue;
				seenColumns.add(item.columnId);
				uniqueSort.push({
					columnId: item.columnId,
					direction: item.direction === "desc" ? "desc" : "asc",
				});
			}
			const filteredSort = uniqueSort.filter(
				(sort) => !hiddenColumnIdSet.has(sort.columnId),
			);

			if (filteredSort.length > 0) {
				const validColumnIds = new Set(
					columnRecords
						.filter((c) => c.tableId === input.tableId)
						.map((c) => c.id),
				);
				if (filteredSort.some((sort) => !validColumnIds.has(sort.columnId))) {
					throw new TRPCError({ code: "NOT_FOUND" });
				}
			}

			const primarySort = filteredSort[0] ?? null;

			await ctx.db
				.update(baseTable)
				.set({
					sortConfig: filteredSort,
					sortColumnId: primarySort?.columnId ?? null,
					sortDirection: primarySort?.direction ?? null,
				})
				.where(eq(baseTable.id, input.tableId));

			// Pre-warm sort cache: begin populating sorted IDs immediately
			// so the subsequent getRows call (arriving ~50-200ms later after
			// client-side React rendering) may hit a warm cache.
			if (filteredSort.length > 0 && tableRecord.rowCount >= SORT_CACHE_MIN_ROWS) {
				const prewarmKey = buildSortCacheKey(input.tableId, filteredSort, "", "");
				if (!getSortCache(prewarmKey)) {
					const sortColumnsMap = new Map(
						columnRecords
							.filter((c) => c.tableId === input.tableId)
							.map((c) => [c.id, c])
					);
					const prewarmClauses = filteredSort.flatMap((sort) => {
						const col = sortColumnsMap.get(sort.columnId);
						if (!col) return [];
						const colType = col.type ?? "single_line_text";
						if (colType === "number") {
							return [
								sort.direction === "desc"
									? sql`nullif(data ->> ${sort.columnId}, '')::numeric DESC NULLS LAST`
									: sql`nullif(data ->> ${sort.columnId}, '')::numeric ASC NULLS FIRST`,
							];
						}
						return [
							sort.direction === "desc"
								? sql`coalesce(data ->> ${sort.columnId}, '') COLLATE "C" DESC`
								: sql`coalesce(data ->> ${sort.columnId}, '') COLLATE "C" ASC`,
						];
					});
					prewarmClauses.push(sql`created_at ASC`, sql`id ASC`);
					const prewarmOrderBy = sql.join(prewarmClauses, sql`, `);

					const prewarmPromise = (async () => {
						try {
							const result = await ctx.db.transaction(async (tx) => {
								await tx.execute(sql`SET LOCAL work_mem = '256MB'`);
								return tx.execute(
									sql`SELECT id FROM table_row WHERE table_id = ${input.tableId}::uuid ORDER BY ${prewarmOrderBy}`
								);
							});
							const ids = ([...result] as Array<{ id: string }>).map((r) => r.id);
							setSortCache(prewarmKey, ids, ids.length);
						} finally {
							pendingSortCachePopulation.delete(prewarmKey);
						}
					})();
					pendingSortCachePopulation.set(prewarmKey, prewarmPromise);
				}
			}

			return { sort: filteredSort.length ? filteredSort : null };
		}),

	setTableSearch: protectedProcedure
		.input(
			z.object({
				tableId: z.string().uuid(),
				search: z.string().nullable(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const tableRecord = await ctx.db.query.baseTable.findFirst({
				where: eq(baseTable.id, input.tableId),
				with: {
					base: true,
				},
			});

			if (!tableRecord || tableRecord.base.ownerId !== ctx.session.user.id) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}

			const nextSearch = (input.search ?? "").trim();
			await ctx.db
				.update(baseTable)
				.set({
					searchQuery: nextSearch ? nextSearch : null,
					updatedAt: new Date(),
				})
				.where(eq(baseTable.id, input.tableId));

			return { searchQuery: nextSearch };
		}),

	setTableFilter: protectedProcedure
		.input(
			z.object({
				tableId: z.string().uuid(),
				filterConfig: filterStorageSchema.nullable(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const tableRecord = await ctx.db.query.baseTable.findFirst({
				where: eq(baseTable.id, input.tableId),
				with: {
					base: true,
				},
			});

			if (!tableRecord || tableRecord.base.ownerId !== ctx.session.user.id) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}

			await ctx.db
				.update(baseTable)
				.set({
					filterConfig: input.filterConfig,
					updatedAt: new Date(),
				})
				.where(eq(baseTable.id, input.tableId));

			return { filterConfig: input.filterConfig };
		}),

	setHiddenColumns: protectedProcedure
		.input(
			z.object({
				tableId: z.string().uuid(),
				hiddenColumnIds: z.array(z.string().uuid()),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const tableRecord = await ctx.db.query.baseTable.findFirst({
				where: eq(baseTable.id, input.tableId),
				with: {
					base: true,
				},
			});

			if (!tableRecord || tableRecord.base.ownerId !== ctx.session.user.id) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}

			const columns = await ctx.db.query.tableColumn.findMany({
				where: eq(tableColumn.tableId, input.tableId),
			});
			const columnsById = new Map(columns.map((column) => [column.id, column]));
			const uniqueHidden = Array.from(new Set(input.hiddenColumnIds));
			const nextHidden = uniqueHidden.filter((columnId) => {
				const column = columnsById.get(columnId);
				return Boolean(column && column.name !== "Name");
			});

			const currentSortConfig = Array.isArray(tableRecord.sortConfig)
				? tableRecord.sortConfig
				: [];
			const nextSortConfig = currentSortConfig.filter(
				(sort) => !nextHidden.includes(sort.columnId),
			);
			const nextPrimary = nextSortConfig[0] ?? null;

			await ctx.db
				.update(baseTable)
				.set({
					hiddenColumnIds: nextHidden,
					sortConfig: nextSortConfig,
					sortColumnId: nextPrimary?.columnId ?? null,
					sortDirection: nextPrimary?.direction ?? null,
				})
				.where(eq(baseTable.id, input.tableId));

			return {
				hiddenColumnIds: nextHidden,
				sort: nextSortConfig.length ? nextSortConfig : null,
			};
		}),

	deleteRow: protectedProcedure
		.input(z.object({ rowId: z.string().uuid() }))
		.mutation(async ({ ctx, input }) => {
			const rowRecord = await ctx.db.query.tableRow.findFirst({
				where: eq(tableRow.id, input.rowId),
				with: {
					table: {
						with: {
							base: true,
						},
					},
				},
			});

			if (!rowRecord || rowRecord.table.base.ownerId !== ctx.session.user.id) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}

			if (rowRecord.table.rowCount <= 1) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "At least one row is required.",
				});
			}

			await ctx.db.delete(tableRow).where(eq(tableRow.id, input.rowId));
			await ctx.db.execute(sql`UPDATE base_table SET row_count = row_count - 1 WHERE id = ${rowRecord.tableId}`);
			invalidateSortCacheForTable(rowRecord.tableId);
			return { success: true };
		}),

	updateCell: protectedProcedure
		.input(
			z.object({
				rowId: z.string().uuid(),
				columnId: z.string().uuid(),
				value: z.string(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const rowRecord = await ctx.db.query.tableRow.findFirst({
				where: eq(tableRow.id, input.rowId),
				with: {
					table: {
						with: {
							base: true,
						},
					},
				},
			});

			if (!rowRecord || rowRecord.table.base.ownerId !== ctx.session.user.id) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}

			const columnRecord = await ctx.db.query.tableColumn.findFirst({
				where: eq(tableColumn.id, input.columnId),
			});

			if (!columnRecord || columnRecord.tableId !== rowRecord.tableId) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}

			const columnType = columnRecord.type ?? "single_line_text";
			let normalizedValue = input.value;
			if (columnType === "long_text") {
				normalizedValue = normalizeLongTextValue(input.value);
			} else if (columnType === "number") {
				const nextValue = normalizeNumberValue(input.value);
				if (nextValue === null) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Invalid number format.",
					});
				}
				normalizedValue = nextValue;
			} else {
				normalizedValue = normalizeSingleLineValue(input.value);
			}

			const nextData = {
				...(rowRecord.data ?? {}),
				[input.columnId]: normalizedValue,
			};
			const nextSearchText = buildSearchText(nextData);

			await ctx.db
				.update(tableRow)
				.set({ data: nextData, searchText: nextSearchText, updatedAt: new Date() })
				.where(eq(tableRow.id, input.rowId));

			// Invalidate sorted-ID cache so subsequent page fetches
			// reflect the updated cell value in sort order.
			invalidateSortCacheForTable(rowRecord.tableId);

			return { success: true };
		}),

	getTableMeta: protectedProcedure
		.input(z.object({ tableId: z.string().uuid() }))
		.query(async ({ ctx, input }) => {
			const tableRecord = await ctx.db.query.baseTable.findFirst({
				where: eq(baseTable.id, input.tableId),
				with: {
					base: true,
				},
			});

			if (!tableRecord || tableRecord.base.ownerId !== ctx.session.user.id) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}

			const legacySort =
				tableRecord.sortColumnId
					? [
							{
								columnId: tableRecord.sortColumnId,
								direction:
									tableRecord.sortDirection === "desc" ? "desc" : "asc",
							},
						]
					: [];
			const rawSortConfig = Array.isArray(tableRecord.sortConfig)
				? tableRecord.sortConfig
				: [];
			const normalizedSortConfig = rawSortConfig
				.filter(
					(item) =>
						item &&
						typeof item.columnId === "string" &&
						(item.direction === "asc" || item.direction === "desc"),
				)
				.map((item) => ({
					columnId: item.columnId,
					direction: item.direction === "desc" ? "desc" : "asc",
				}));
			const sort =
				normalizedSortConfig.length > 0
					? normalizedSortConfig
					: legacySort.length > 0
						? legacySort
						: null;

			const columns = await ctx.db.query.tableColumn.findMany({
				where: eq(tableColumn.tableId, input.tableId),
				orderBy: (column, { asc }) => [asc(column.createdAt)],
			});
			const columnIdSet = new Set(columns.map((column) => column.id));
			const nameColumnId =
				columns.find((column) => column.name === "Name")?.id ?? null;
			const rawHiddenColumnIds = Array.isArray(tableRecord.hiddenColumnIds)
				? tableRecord.hiddenColumnIds
				: [];
			const hiddenColumnIds = rawHiddenColumnIds.filter(
				(columnId): columnId is string =>
					typeof columnId === "string" &&
					columnIdSet.has(columnId) &&
					columnId !== nameColumnId,
			);
			const visibleSort = sort
				? sort.filter((item) => !hiddenColumnIds.includes(item.columnId))
				: null;

			return {
				table: { id: tableRecord.id, name: tableRecord.name },
				columns: columns.map((column) => ({
					id: column.id,
					name: column.name,
					type: column.type ?? "single_line_text",
				})),
				rowCount: tableRecord.rowCount,
				sort: visibleSort && visibleSort.length > 0 ? visibleSort : null,
				hiddenColumnIds,
				searchQuery: tableRecord.searchQuery ?? "",
				filterConfig: tableRecord.filterConfig ?? null,
			};
		}),

	getRows: protectedProcedure
		.input(
			z.object({
				tableId: z.string().uuid(),
				limit: z.number().int().min(1).max(MAX_ROWS_QUERY_LIMIT).default(50),
				cursor: z.number().int().min(0).optional(),
				sort: z
					.array(sortItemSchema)
					.optional(),
				filter: filterSchema.optional(),
				search: z.string().optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			// Collect all column IDs needed (sort + filter) to fetch in one query
			const providedSort = input.sort ?? null;

			const filterColumnIds = new Set<string>();
			if (input.filter && input.filter.items.length > 0) {
				const collectColumnIds = (item: typeof input.filter.items[number]) => {
					if (item.type === "condition") {
						filterColumnIds.add(item.columnId);
						return;
					}
					item.conditions.forEach((child) => collectColumnIds(child));
				};
				input.filter.items.forEach(collectColumnIds);
			}

			// Use per-request cache to deduplicate auth + column lookups across
			// batched getRows calls (e.g. 5 sparse pages in one HTTP batch).
			// The first call hits the DB; subsequent calls for the same table
			// await the same promise, eliminating ~8 redundant queries per batch.
			type AuthData = {
				tableRecord: Awaited<ReturnType<typeof ctx.db.query.baseTable.findFirst<{
					with: { base: true };
				}>>>;
				allNeededColumns: Awaited<ReturnType<typeof ctx.db.query.tableColumn.findMany>>;
			};
			const needsColumns = providedSort === null || providedSort.length > 0 || filterColumnIds.size > 0;
			const cacheKey = `getRows:${input.tableId}:${needsColumns ? "cols" : "nocols"}`;
			let authPromise = ctx._cache.get(cacheKey) as Promise<AuthData> | undefined;
			if (!authPromise) {
				authPromise = (async () => {
					const [tableRecord, allNeededColumns] = await Promise.all([
						ctx.db.query.baseTable.findFirst({
							where: eq(baseTable.id, input.tableId),
							with: { base: true },
						}),
						needsColumns
							? ctx.db.query.tableColumn.findMany({
									where: eq(tableColumn.tableId, input.tableId),
								})
							: Promise.resolve([]),
					]);
					return { tableRecord, allNeededColumns };
				})();
				ctx._cache.set(cacheKey, authPromise);
			}
			const { tableRecord, allNeededColumns } = await authPromise;

			if (!tableRecord || tableRecord.base.ownerId !== ctx.session.user.id) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}
			const rawHiddenColumnIds = Array.isArray(tableRecord.hiddenColumnIds)
				? tableRecord.hiddenColumnIds
				: [];
			const hiddenColumnIdSet = new Set(
				rawHiddenColumnIds.filter((columnId): columnId is string =>
					typeof columnId === "string",
				),
			);

			// Build a shared column lookup from the single query
			const allColumnsById = new Map(
				allNeededColumns.map((column) => [column.id, column]),
			);

			const legacySort =
				tableRecord.sortColumnId
					? [
							{
								columnId: tableRecord.sortColumnId,
								direction:
									tableRecord.sortDirection === "desc" ? "desc" : "asc",
							},
						]
					: [];
			const rawSortConfig = Array.isArray(tableRecord.sortConfig)
				? tableRecord.sortConfig
				: [];
			let effectiveSorts =
				providedSort ??
				(rawSortConfig.length > 0 ? rawSortConfig : legacySort);

			const seenColumns = new Set<string>();
			effectiveSorts = effectiveSorts.filter((sort) => {
				if (!sort?.columnId) return false;
				if (seenColumns.has(sort.columnId)) return false;
				seenColumns.add(sort.columnId);
				return true;
			});
			effectiveSorts = effectiveSorts.filter(
				(sort) => !hiddenColumnIdSet.has(sort.columnId),
			);

			const sortColumnsById = allColumnsById;
			if (effectiveSorts.length > 0) {
				const missingColumn = effectiveSorts.some((sort) => {
					const column = sortColumnsById.get(sort.columnId);
					return !column || column.tableId !== input.tableId;
				});
				if (missingColumn) {
					if (providedSort) {
						throw new TRPCError({ code: "NOT_FOUND" });
					}
					effectiveSorts = effectiveSorts.filter((sort) => {
						const column = sortColumnsById.get(sort.columnId);
						return column?.tableId === input.tableId;
					});
				}
			}

			type SqlExpression = ReturnType<typeof sql>;
			let filterExpression: SqlExpression | null = null;
			if (input.filter && input.filter.items.length > 0) {
				// Remove hidden column IDs from the set now that we have the hidden list
				for (const id of filterColumnIds) {
					if (hiddenColumnIdSet.has(id)) filterColumnIds.delete(id);
				}

				const filterColumnsById = allColumnsById;

				// Collect "contains" search terms for trigram pre-filtering.
				// search_text has a GIN trigram index — using it as a pre-filter
				// lets Postgres quickly eliminate non-matching rows before the
				// expensive per-column JSONB ->> extraction.
				//
				// IMPORTANT: Only collect from top-level conditions with AND
				// connector. For AND, every condition must match, so any
				// "contains" term MUST appear in search_text — safe to pre-filter.
				// For OR connectors or nested groups, the pre-filter could
				// incorrectly exclude valid rows (e.g., "A contains 'foo' OR
				// B = 5" — rows where B=5 but 'foo' isn't in search_text would
				// be wrongly excluded by a trigram pre-filter on 'foo').
				const containsSearchTerms: string[] = [];
				if (input.filter.connector === "and") {
					for (const item of input.filter.items) {
						if (item.type === "condition" && item.operator === "contains" && item.value?.trim()) {
							containsSearchTerms.push(item.value.trim());
						}
						// Skip groups — their internal connector may differ
					}
				}

				const buildConditionExpression = (
					condition: z.infer<typeof filterConditionSchema>,
				): SqlExpression | null => {
					if (hiddenColumnIdSet.has(condition.columnId)) return null;
					const column = filterColumnsById.get(condition.columnId);
					if (!column || column.tableId !== input.tableId) return null;
					const columnType = column.type ?? "single_line_text";
					const isNumber = columnType === "number";
					const operator = condition.operator;
					if (
						(isNumber &&
							!filterNumberOperators.has(operator)) ||
						(!isNumber && !filterTextOperators.has(operator))
					) {
						return null;
					}
					const rawValue = condition.value ?? "";
					const trimmedValue = rawValue.trim();
					if (
						filterOperatorsRequiringValue.has(operator) &&
						!trimmedValue
					) {
						return null;
					}

					const textValue =
						sql<string>`coalesce(${tableRow.data} ->> ${condition.columnId}, '')`;
					if (!isNumber) {
						switch (operator) {
							case "contains":
								return sql<boolean>`${textValue} ILIKE ${`%${trimmedValue}%`}`;
							case "does_not_contain":
								return sql<boolean>`${textValue} NOT ILIKE ${`%${trimmedValue}%`}`;
							case "is":
								// Use JSONB containment (@>) to leverage the GIN index
								// instead of extracting text with ->> for every row.
								return sql<boolean>`${tableRow.data} @> ${JSON.stringify({ [condition.columnId]: trimmedValue })}::jsonb`;
							case "is_not":
								// NOT containment — GIN index still narrows the scan
								return sql<boolean>`NOT (${tableRow.data} @> ${JSON.stringify({ [condition.columnId]: trimmedValue })}::jsonb)`;
							case "is_empty":
								return sql<boolean>`${textValue} = ''`;
							case "is_not_empty":
								return sql<boolean>`${textValue} <> ''`;
							default:
								return null;
						}
					}

					const numericValue =
						sql<number>`nullif(${tableRow.data} ->> ${condition.columnId}, '')::numeric`;
					if (operator === "is_empty") {
						return sql<boolean>`${textValue} = ''`;
					}
					if (operator === "is_not_empty") {
						return sql<boolean>`${textValue} <> ''`;
					}
					const numericInput = Number(trimmedValue);
					if (Number.isNaN(numericInput)) return null;
					// For "eq", use JSONB containment to leverage the GIN index.
					// Numbers are stored as strings in JSONB, so match the string form.
					if (operator === "eq") {
						return sql<boolean>`${tableRow.data} @> ${JSON.stringify({ [condition.columnId]: trimmedValue })}::jsonb`;
					}
					switch (operator) {
						case "neq":
							return sql<boolean>`${numericValue} <> ${numericInput}`;
						case "lt":
							return sql<boolean>`${numericValue} < ${numericInput}`;
						case "gt":
							return sql<boolean>`${numericValue} > ${numericInput}`;
						case "lte":
							return sql<boolean>`${numericValue} <= ${numericInput}`;
						case "gte":
							return sql<boolean>`${numericValue} >= ${numericInput}`;
						default:
							return null;
					}
				};

				const combineConditions = (
					conditions: Array<SqlExpression | null>,
					connector: z.infer<typeof filterConnectorSchema>,
				): SqlExpression | null => {
					const validConditions = conditions.filter(Boolean) as SqlExpression[];
					if (validConditions.length === 0) return null;
					if (validConditions.length === 1) return validConditions[0] ?? null;
					return (
						connector === "or"
							? or(...validConditions)
							: and(...validConditions)
					) ?? null;
				};

				// Recursive function to build expressions for groups and nested groups
				const buildItemExpression = (item: typeof input.filter.items[number]): SqlExpression | null => {
					if (item.type === "condition") {
						return buildConditionExpression(item);
					}
					// Process group: recursively handle both conditions and nested groups
					const childExpressions = item.conditions.map((child) =>
						buildItemExpression(child)
					);
					return combineConditions(childExpressions, item.connector);
				};

				const topLevelConditions = input.filter.items
					.map(buildItemExpression)
					.filter(Boolean) as Array<SqlExpression>;

				filterExpression = combineConditions(
					topLevelConditions,
					input.filter.connector,
				);

				// Build trigram pre-filter: ALL contains terms must appear in
				// search_text (only collected for AND connector at top level).
				// This pre-filter uses the trigram GIN index on search_text to
				// rapidly narrow down candidate rows before per-column extraction.
				if (containsSearchTerms.length > 0 && filterExpression) {
					const trigramConditions = containsSearchTerms.map(
						(term) => sql<boolean>`coalesce(${tableRow.searchText}, '') ILIKE ${`%${term}%`}`
					);
					const trigramPreFilter = and(...trigramConditions);
					if (trigramPreFilter) {
						filterExpression = and(filterExpression, trigramPreFilter) ?? filterExpression;
					}
				}
			}

			const rawSearch = input.search ?? "";
			const trimmedSearch = rawSearch.trim();
			let searchExpression: SqlExpression | null = null;
			if (trimmedSearch) {
				searchExpression = sql<boolean>`coalesce(${tableRow.searchText}, '') ILIKE ${`%${trimmedSearch}%`}`;
			}

			const offset = input.cursor ?? 0;

			// Extract where clause logic
			const whereClause = (() => {
				const baseWhere = eq(tableRow.tableId, input.tableId);
				if (filterExpression && searchExpression) {
					return and(baseWhere, filterExpression, searchExpression);
				}
				if (filterExpression) {
					return and(baseWhere, filterExpression);
				}
				if (searchExpression) {
					return and(baseWhere, searchExpression);
				}
				return baseWhere;
			})();

			// Build raw SQL WHERE clause fragments for use in raw queries
			const buildRawWhereFragments = () => {
				const fragments = [sql`table_id = ${input.tableId}::uuid`];
				if (filterExpression) fragments.push(filterExpression);
				if (searchExpression) fragments.push(searchExpression);
				return fragments;
			};

			// Build ORDER BY clause for sort expressions.
			// Performance notes:
			// - Text sorts use COLLATE "C" (byte-order) instead of the default
			//   locale collation.  Locale-aware comparison (e.g. en_US.UTF-8)
			//   calls ICU/libc per comparison which is 3-5x slower than raw
			//   byte comparison for 100k+ rows.  For an Airtable-style grid,
			//   byte-order sorting is acceptable (A-Z still sorts correctly
			//   for ASCII text, which covers the vast majority of cell values).
			// - Number sorts extract text once and cast to numeric.
			const buildSortOrderClauses = () => {
				if (effectiveSorts.length === 0) {
					return [sql`created_at ASC`, sql`id ASC`];
				}
				const clauses = effectiveSorts.flatMap((sort) => {
					const column = sortColumnsById.get(sort.columnId);
					if (!column || column.tableId !== input.tableId) return [];
					const columnType = column.type ?? "single_line_text";
					if (columnType === "number") {
						return [
							sort.direction === "desc"
								? sql`nullif(data ->> ${sort.columnId}, '')::numeric DESC NULLS LAST`
								: sql`nullif(data ->> ${sort.columnId}, '')::numeric ASC NULLS FIRST`,
						];
					}
					return [
						sort.direction === "desc"
							? sql`coalesce(data ->> ${sort.columnId}, '') COLLATE "C" DESC`
							: sql`coalesce(data ->> ${sort.columnId}, '') COLLATE "C" ASC`,
					];
				});
				clauses.push(sql`created_at ASC`, sql`id ASC`);
				return clauses;
			};

			const orderClauses = buildSortOrderClauses();
			const orderByFragment = sql.join(orderClauses, sql`, `);
			const rawWhereFragments = buildRawWhereFragments();
			const rawWhereClause = rawWhereFragments.length === 1
				? rawWhereFragments[0]!
				: sql.join(rawWhereFragments, sql` AND `);

			// Query strategy:
			// - Flat query for low offsets (< 5000): simplest plan, avoids
			//   subquery JOIN overhead.  At offset 0 with default order
			//   (created_at, id), PostgreSQL can walk the btree index and
			//   stop after LIMIT matches — no sort memory needed.
			// - Subquery pattern for high offsets (>= 5000): inner query
			//   paginates only IDs (~50 bytes each) via index-only scan,
			//   then outer joins for full JSONB data, avoiding reading and
			//   discarding thousands of large heap tuples in the skip-scan.
			// - Transaction with boosted work_mem only when sorting on
			//   JSONB-extracted columns (effectiveSorts > 0): these sorts
			//   can't use an index and may need to hold 100k+ sort keys in
			//   memory.  Filter-only and search-only queries with default
			//   order use the (table_id, created_at, id) btree index
			//   directly and don't need extra work_mem.
			const SUBQUERY_OFFSET_THRESHOLD = 5000;
			const needsSortWorkMem = effectiveSorts.length > 0;

			const subquerySql = sql`
				SELECT t.id, t.data
				FROM table_row t
				INNER JOIN (
					SELECT id, row_number() OVER (ORDER BY ${orderByFragment}) AS rn
					FROM table_row
					WHERE ${rawWhereClause}
					ORDER BY ${orderByFragment}
					LIMIT ${input.limit}
					OFFSET ${offset}
				) s ON t.id = s.id
				ORDER BY s.rn
			`;

			const flatSql = sql`
				SELECT id, data FROM table_row
				WHERE ${rawWhereClause}
				ORDER BY ${orderByFragment}
				LIMIT ${input.limit}
				OFFSET ${offset}
			`;

			const querySql = offset >= SUBQUERY_OFFSET_THRESHOLD ? subquerySql : flatSql;

			// Only use a transaction for work_mem boost when sorting on
			// JSONB-extracted columns AND the offset is high enough that
			// PostgreSQL can't use a cheap top-N heapsort.  For offset=0
			// with a small LIMIT, PG already uses an efficient top-N sort
			// that needs minimal memory.  Avoiding the transaction saves
			// ~5-15ms of round-trip overhead per call.
			const needsWorkMemBoost = needsSortWorkMem && offset >= SUBQUERY_OFFSET_THRESHOLD;

			// Only compute count(*) on the first page AND only when
			// filters/search are active (filtered count differs from total).
			const isFirstPage = offset === 0;
			const hasFiltersOrSearch = !!filterExpression || !!input.search;
			const MAX_FILTERED_COUNT = 10_001;

			// -----------------------------------------------------------------
			// Sort cache: for sorted queries on large tables, cache the sorted
			// ID list from the first full sort so subsequent page fetches skip
			// the expensive JSONB-based ORDER BY entirely.
			// -----------------------------------------------------------------
			const sortCacheKey = needsSortWorkMem
				? buildSortCacheKey(
						input.tableId,
						effectiveSorts,
						filterExpression ? JSON.stringify(input.filter) : "",
						trimmedSearch,
					)
				: null;
			const cachedSort = sortCacheKey ? getSortCache(sortCacheKey) : null;

			if (cachedSort && needsSortWorkMem) {
				// Cache hit — slice the pre-sorted IDs for the requested page
				// and fetch full row data by primary key (instant lookup).
				const pageIds = cachedSort.ids.slice(offset, offset + input.limit);

				let fastRows: Array<{ id: string; data: Record<string, string> | null }>;
				if (pageIds.length === 0) {
					fastRows = [];
				} else {
					const rawResult = await ctx.db.execute(
						sql`SELECT id, data FROM table_row WHERE id = ANY(${pageIds}::uuid[])`
					);
					// Re-order to match the cached sort order
					const byId = new Map(
						([...rawResult] as Array<{ id: string; data: Record<string, string> | null }>)
							.map((r) => [r.id, r])
					);
					fastRows = pageIds
						.map((id) => byId.get(id))
						.filter(Boolean) as typeof fastRows;
				}

				const nextCursor =
					fastRows.length === input.limit ? offset + fastRows.length : null;
				const totalCount = (isFirstPage && hasFiltersOrSearch)
					? Math.min(cachedSort.totalFiltered, MAX_FILTERED_COUNT)
					: -1;

				return {
					rows: fastRows.map((row) => ({
						id: row.id,
						data: row.data ?? {},
					})),
					nextCursor,
					totalCount,
				};
			}

			// -----------------------------------------------------------------
			// Single-pass optimization for first-page sorted queries on large
			// tables: fetch ALL sorted IDs in one lightweight query (just the
			// id column — no JSONB data), cache them synchronously, then fetch
			// full row data for the first page by primary-key lookup.
			//
			// Previous approach ran TWO sort queries: one for the first page
			// (top-N heapsort) and one async for cache population (full sort).
			// Both scanned the same 100k+ rows and extracted JSONB sort keys.
			// Now: one sort query + one fast PK lookup.  The cache is warm
			// synchronously (guaranteed ready for the next page scroll).
			// -----------------------------------------------------------------
			const useSinglePassCache = sortCacheKey && needsSortWorkMem
				&& isFirstPage && tableRecord.rowCount >= SORT_CACHE_MIN_ROWS;

			if (useSinglePassCache) {
				// Check if a pre-warm is already in progress for this cache key
				const pendingPrewarm = pendingSortCachePopulation.get(sortCacheKey);
				if (pendingPrewarm) {
					try {
						await pendingPrewarm;
					} catch {
						// Pre-warm failed — fall through to run our own sort
					}
					const prewarmedCache = getSortCache(sortCacheKey);
					if (prewarmedCache) {
						// Pre-warm succeeded — use the cached result
						const pageIds = prewarmedCache.ids.slice(0, input.limit);
						let pageRows: Array<{ id: string; data: Record<string, string> | null }>;
						if (pageIds.length === 0) {
							pageRows = [];
						} else {
							const rawResult = await ctx.db.execute(
								sql`SELECT id, data FROM table_row WHERE id = ANY(${pageIds}::uuid[])`
							);
							const byId = new Map(
								([...rawResult] as Array<{ id: string; data: Record<string, string> | null }>)
									.map((r) => [r.id, r])
							);
							pageRows = pageIds
								.map((id) => byId.get(id))
								.filter(Boolean) as typeof pageRows;
						}
						const nextCursor = pageRows.length === input.limit
							? offset + pageRows.length : null;
						const totalCount = hasFiltersOrSearch
							? Math.min(prewarmedCache.totalFiltered, MAX_FILTERED_COUNT)
							: -1;
						return {
							rows: pageRows.map((row) => ({
								id: row.id,
								data: row.data ?? {},
							})),
							nextCursor,
							totalCount,
						};
					}
				}

				// No pre-warm available — single-pass: sort all IDs, cache, PK-fetch page
				const singlePassCountQuery = hasFiltersOrSearch
					? ctx.db.execute(sql`SELECT count(*)::int as "count" FROM (SELECT 1 FROM table_row WHERE ${rawWhereClause} LIMIT ${MAX_FILTERED_COUNT}) sub`)
					: null;

				const [allIdsResult, singlePassCountResult] = await Promise.all([
					ctx.db.transaction(async (tx) => {
						await tx.execute(sql`SET LOCAL work_mem = '256MB'`);
						return tx.execute(
							sql`SELECT id FROM table_row WHERE ${rawWhereClause} ORDER BY ${orderByFragment}`
						);
					}),
					singlePassCountQuery,
				]);

				const allIds = ([...allIdsResult] as Array<{ id: string }>).map((r) => r.id);
				let totalCount = -1;
				if (singlePassCountResult) {
					const countRows = [...singlePassCountResult] as Array<{ count: number }>;
					totalCount = Number(countRows[0]?.count ?? 0);
				}

				// Cache sorted IDs synchronously — guaranteed warm for next page
				setSortCache(sortCacheKey, allIds, totalCount >= 0 ? totalCount : allIds.length);

				// Fetch full row data for just the first page by PK lookup
				const pageIds = allIds.slice(0, input.limit);
				let pageRows: Array<{ id: string; data: Record<string, string> | null }>;
				if (pageIds.length === 0) {
					pageRows = [];
				} else {
					const rawResult = await ctx.db.execute(
						sql`SELECT id, data FROM table_row WHERE id = ANY(${pageIds}::uuid[])`
					);
					const byId = new Map(
						([...rawResult] as Array<{ id: string; data: Record<string, string> | null }>)
							.map((r) => [r.id, r])
					);
					pageRows = pageIds
						.map((id) => byId.get(id))
						.filter(Boolean) as typeof pageRows;
				}

				const nextCursor = pageRows.length === input.limit
					? offset + pageRows.length : null;

				return {
					rows: pageRows.map((row) => ({
						id: row.id,
						data: row.data ?? {},
					})),
					nextCursor,
					totalCount,
				};
			}

			// Standard query path: no sort, small tables, or non-first pages
			// without a warm cache.
			const rowsQuery = needsWorkMemBoost
				? ctx.db.transaction(async (tx) => {
						await tx.execute(sql`SET LOCAL work_mem = '256MB'`);
						return tx.execute(querySql);
					})
				: ctx.db.execute(querySql);

			const countQuery = (isFirstPage && hasFiltersOrSearch)
				? ctx.db.execute(sql`SELECT count(*)::int as "count" FROM (SELECT 1 FROM table_row WHERE ${rawWhereClause} LIMIT ${MAX_FILTERED_COUNT}) sub`)
				: null;

			const [rawResult, totalCountResult] = await Promise.all([
				rowsQuery,
				countQuery,
			]);

			const fastRows = [...rawResult] as Array<{ id: string; data: Record<string, string> | null }>;
			const nextCursor =
				fastRows.length === input.limit ? offset + fastRows.length : null;

			let totalCount = -1;
			if (totalCountResult) {
				const countRows = [...totalCountResult] as Array<{ count: number }>;
				totalCount = Number(countRows[0]?.count ?? 0);
			}

			return {
				rows: fastRows.map((row) => ({
					id: row.id,
					data: row.data ?? {},
				})),
				nextCursor,
				totalCount,
			};
		}),

	getTable: protectedProcedure
		.input(
			z.object({
				tableId: z.string().uuid(),
				limit: z.number().int().min(1).max(500).default(50),
				offset: z.number().int().min(0).default(0),
			}),
		)
		.query(async ({ ctx, input }) => {
			const tableRecord = await ctx.db.query.baseTable.findFirst({
				where: eq(baseTable.id, input.tableId),
				with: {
					base: true,
				},
			});

			if (!tableRecord || tableRecord.base.ownerId !== ctx.session.user.id) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}

			const [columns, rows] = await Promise.all([
				ctx.db.query.tableColumn.findMany({
					where: eq(tableColumn.tableId, input.tableId),
					orderBy: (column, { asc }) => [asc(column.createdAt)],
				}),
				ctx.db.query.tableRow.findMany({
					where: eq(tableRow.tableId, input.tableId),
					orderBy: (row, { asc }) => [asc(row.createdAt), asc(row.id)],
					limit: input.limit,
					offset: input.offset,
				}),
			]);
			const columnIdSet = new Set(columns.map((column) => column.id));
			const nameColumnId =
				columns.find((column) => column.name === "Name")?.id ?? null;
			const rawHiddenColumnIds = Array.isArray(tableRecord.hiddenColumnIds)
				? tableRecord.hiddenColumnIds
				: [];
			const hiddenColumnIds = rawHiddenColumnIds.filter(
				(columnId): columnId is string =>
					typeof columnId === "string" &&
					columnIdSet.has(columnId) &&
					columnId !== nameColumnId,
			);

			return {
				table: { id: tableRecord.id, name: tableRecord.name },
				columns: columns.map((column) => ({
					id: column.id,
					name: column.name,
					type: column.type ?? "single_line_text",
				})),
				rows: rows.map((row) => ({
					id: row.id,
					data: row.data ?? {},
				})),
				rowCount: tableRecord.rowCount,
				hiddenColumnIds,
			};
		}),

	listViews: protectedProcedure
		.input(z.object({ tableId: z.string().uuid() }))
		.query(async ({ ctx, input }) => {
			const tableRecord = await ctx.db.query.baseTable.findFirst({
				where: eq(baseTable.id, input.tableId),
				with: {
					base: true,
				},
			});

			if (!tableRecord || tableRecord.base.ownerId !== ctx.session.user.id) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}

			const views = await ctx.db.query.tableView.findMany({
				where: eq(tableView.tableId, input.tableId),
				orderBy: (view, { asc }) => [asc(view.createdAt)],
			});

			return views.map((view) => ({
				id: view.id,
				name: view.name,
			}));
		}),

	ensureDefaultView: protectedProcedure
		.input(z.object({ tableId: z.string().uuid() }))
		.mutation(async ({ ctx, input }) => {
			const tableRecord = await ctx.db.query.baseTable.findFirst({
				where: eq(baseTable.id, input.tableId),
				with: {
					base: true,
					views: true,
				},
			});

			if (!tableRecord || tableRecord.base.ownerId !== ctx.session.user.id) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}

			// If the table already has views, return the first one
			if (tableRecord.views.length > 0) {
				return { id: tableRecord.views[0]!.id, name: tableRecord.views[0]!.name, created: false };
			}

			// Migrate config from baseTable to a new default view
			const [newView] = await ctx.db
				.insert(tableView)
				.values({
					id: createId(),
					tableId: input.tableId,
					name: "Grid view",
					sortConfig: Array.isArray(tableRecord.sortConfig) ? tableRecord.sortConfig : [],
					hiddenColumnIds: Array.isArray(tableRecord.hiddenColumnIds) ? tableRecord.hiddenColumnIds : [],
					searchQuery: tableRecord.searchQuery ?? null,
					filterConfig: tableRecord.filterConfig ?? null,
				})
				.returning({ id: tableView.id, name: tableView.name });

			if (!newView) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
			}

			return { ...newView, created: true };
		}),

	createView: protectedProcedure
		.input(
			z.object({
				tableId: z.string().uuid(),
				name: z.string().min(1).max(120),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const tableRecord = await ctx.db.query.baseTable.findFirst({
				where: eq(baseTable.id, input.tableId),
				with: {
					base: true,
				},
			});

			if (!tableRecord || tableRecord.base.ownerId !== ctx.session.user.id) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}

			const [newView] = await ctx.db
				.insert(tableView)
				.values({
					id: createId(),
					tableId: input.tableId,
					name: input.name,
					sortConfig: [],
					hiddenColumnIds: [],
					searchQuery: null,
					filterConfig: null,
				})
				.returning({ id: tableView.id, name: tableView.name, tableId: tableView.tableId });

			if (!newView) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
			}

			return newView;
		}),

	getView: protectedProcedure
		.input(z.object({ viewId: z.string().uuid() }))
		.query(async ({ ctx, input }) => {
			const viewRecord = await ctx.db.query.tableView.findFirst({
				where: eq(tableView.id, input.viewId),
				with: {
					table: {
						with: {
							base: true,
						},
					},
				},
			});

			if (!viewRecord || viewRecord.table.base.ownerId !== ctx.session.user.id) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}

			return {
				id: viewRecord.id,
				name: viewRecord.name,
				sortConfig: Array.isArray(viewRecord.sortConfig) ? viewRecord.sortConfig : [],
				hiddenColumnIds: Array.isArray(viewRecord.hiddenColumnIds)
					? viewRecord.hiddenColumnIds
					: [],
				searchQuery: viewRecord.searchQuery ?? "",
				filterConfig: viewRecord.filterConfig ?? null,
			};
		}),

	updateView: protectedProcedure
		.input(
			z.object({
				viewId: z.string().uuid(),
				sortConfig: z.array(sortItemSchema).optional(),
				hiddenColumnIds: z.array(z.string().uuid()).optional(),
				searchQuery: z.string().optional(),
				filterConfig: filterStorageSchema.nullable().optional(),
			})
		)
		.mutation(async ({ ctx, input }) => {
			const viewRecord = await ctx.db.query.tableView.findFirst({
				where: eq(tableView.id, input.viewId),
				with: {
					table: {
						with: {
							base: true,
						},
					},
				},
			});

			if (!viewRecord || viewRecord.table.base.ownerId !== ctx.session.user.id) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}

			const updateData: {
				sortConfig?: Array<{ columnId: string; direction: "asc" | "desc" }>;
				hiddenColumnIds?: string[];
				searchQuery?: string | null;
				filterConfig?: z.infer<typeof filterStorageSchema> | null;
			} = {};

			if (input.sortConfig !== undefined) {
				updateData.sortConfig = input.sortConfig;
			}
			if (input.hiddenColumnIds !== undefined) {
				updateData.hiddenColumnIds = input.hiddenColumnIds;
			}
			if (input.searchQuery !== undefined) {
				updateData.searchQuery = input.searchQuery || null;
			}
			if (input.filterConfig !== undefined) {
				updateData.filterConfig = input.filterConfig;
			}

			await ctx.db
				.update(tableView)
				.set({ ...updateData, updatedAt: new Date() })
				.where(eq(tableView.id, input.viewId));

			return { success: true };
		}),

	renameView: protectedProcedure
		.input(
			z.object({
				viewId: z.string().uuid(),
				name: z.string().min(1).max(120),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const viewRecord = await ctx.db.query.tableView.findFirst({
				where: eq(tableView.id, input.viewId),
				with: {
					table: {
						with: {
							base: true,
						},
					},
				},
			});

			if (!viewRecord || viewRecord.table.base.ownerId !== ctx.session.user.id) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}

			await ctx.db
				.update(tableView)
				.set({ name: input.name, updatedAt: new Date() })
				.where(eq(tableView.id, input.viewId));

			return { success: true };
		}),

	deleteView: protectedProcedure
		.input(z.object({ viewId: z.string().uuid() }))
		.mutation(async ({ ctx, input }) => {
			const viewRecord = await ctx.db.query.tableView.findFirst({
				where: eq(tableView.id, input.viewId),
				with: {
					table: {
						with: {
							base: true,
						},
					},
				},
			});

			if (!viewRecord || viewRecord.table.base.ownerId !== ctx.session.user.id) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}

			await ctx.db.delete(tableView).where(eq(tableView.id, input.viewId));

			return { success: true };
		}),

	duplicateView: protectedProcedure
		.input(z.object({ viewId: z.string().uuid(), name: z.string().min(1).max(120).optional() }))
		.mutation(async ({ ctx, input }) => {
			const viewRecord = await ctx.db.query.tableView.findFirst({
				where: eq(tableView.id, input.viewId),
				with: {
					table: {
						with: {
							base: true,
						},
					},
				},
			});

			if (!viewRecord || viewRecord.table.base.ownerId !== ctx.session.user.id) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}

			const sortConfig = Array.isArray(viewRecord.sortConfig) ? viewRecord.sortConfig : [];
			const hiddenColumnIds = Array.isArray(viewRecord.hiddenColumnIds) ? viewRecord.hiddenColumnIds : [];
			const searchQuery = viewRecord.searchQuery ?? null;
			const filterConfig = viewRecord.filterConfig ?? null;

			const [newView] = await ctx.db
				.insert(tableView)
				.values({
					id: createId(),
					tableId: viewRecord.tableId,
					name: input.name ?? `${viewRecord.name} copy`,
					sortConfig,
					hiddenColumnIds,
					searchQuery,
					filterConfig,
				})
				.returning({
					id: tableView.id,
					name: tableView.name,
					tableId: tableView.tableId,
				});

			if (!newView) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
			}

			return {
				...newView,
				sortConfig,
				hiddenColumnIds,
				searchQuery: searchQuery ?? "",
				filterConfig,
			};
		}),
});
