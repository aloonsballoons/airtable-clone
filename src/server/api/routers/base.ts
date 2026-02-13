import { TRPCError } from "@trpc/server";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { base, baseTable, tableColumn, tableRow } from "~/server/db/schema";

const MAX_TABLES = 1000;
const MAX_COLUMNS = 500;
const MAX_ROWS = 2_000_000;
const MAX_BULK_ROWS = 100_000;

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
const filterConditionSchema = z.object({
	type: z.literal("condition"),
	columnId: z.string().uuid(),
	operator: filterOperatorSchema,
	value: z.string().optional().default(""),
});
const filterGroupSchema = z.object({
	type: z.literal("group"),
	connector: filterConnectorSchema,
	conditions: z.array(filterConditionSchema),
});
const filterSchema = z.object({
	connector: filterConnectorSchema,
	items: z.array(z.union([filterConditionSchema, filterGroupSchema])),
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

const buildSearchText = (data: Record<string, string> | null | undefined) =>
	Object.values(data ?? {})
		.map((value) => String(value ?? "").trim())
		.filter(Boolean)
		.join(" ");

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
					tables: true,
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
			}

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
			}),
		)
		.mutation(async ({ ctx, input }) => {
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

			const tableRecord = await ctx.db.query.baseTable.findFirst({
				where: eq(baseTable.id, input.tableId),
				with: {
					base: true,
				},
			});

			if (!tableRecord || tableRecord.base.ownerId !== ctx.session.user.id) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}

			const rowCount = await ctx.db
				.select({ count: sql<number>`count(*)::int` })
				.from(tableRow)
				.where(eq(tableRow.tableId, input.tableId));

			const currentCount = Number(rowCount[0]?.count ?? 0);
			if (currentCount + input.count > MAX_ROWS) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Row limit of ${MAX_ROWS.toLocaleString()} reached.`,
				});
			}

			// Use PostgreSQL generate_series for bulk insert in a single query.
			// For explicit IDs, prefer a typed insert to avoid uuid[] array-literal casts.
			if (input.ids) {
				await ctx.db.insert(tableRow).values(
					input.ids.map((id) => ({
						id,
						tableId: input.tableId,
						data: {},
					})),
				);
			} else {
				// Let PostgreSQL generate UUIDs - even faster
				await ctx.db.execute(sql`
					INSERT INTO table_row (id, table_id, data, created_at, updated_at)
					SELECT 
						gen_random_uuid(),
						${input.tableId}::uuid,
						'{}'::jsonb,
						NOW(),
						NOW()
					FROM generate_series(1, ${input.count})
				`);
			}

			return { added: input.count };
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
			const tableRecord = await ctx.db.query.baseTable.findFirst({
				where: eq(baseTable.id, input.tableId),
				with: {
					base: true,
				},
			});

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

			const providedSort = input.sort ?? [];
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
				const columnRecords = await ctx.db.query.tableColumn.findMany({
					where: inArray(
						tableColumn.id,
						filteredSort.map((sort) => sort.columnId),
					),
				});
				if (
					columnRecords.length !== filteredSort.length ||
					columnRecords.some((column) => column.tableId !== input.tableId)
				) {
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

			const rowCount = await ctx.db
				.select({ count: sql<number>`count(*)::int` })
				.from(tableRow)
				.where(eq(tableRow.tableId, rowRecord.tableId));

			if (Number(rowCount[0]?.count ?? 0) <= 1) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "At least one row is required.",
				});
			}

			await ctx.db.delete(tableRow).where(eq(tableRow.id, input.rowId));
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

			const [columns, rowCount] = await Promise.all([
				ctx.db.query.tableColumn.findMany({
					where: eq(tableColumn.tableId, input.tableId),
					orderBy: (column, { asc }) => [asc(column.createdAt)],
				}),
				ctx.db
					.select({ count: sql<number>`count(*)::int` })
					.from(tableRow)
				.where(eq(tableRow.tableId, input.tableId)),
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
				rowCount: Number(rowCount[0]?.count ?? 0),
				sort: visibleSort && visibleSort.length > 0 ? visibleSort : null,
				hiddenColumnIds,
				searchQuery: tableRecord.searchQuery ?? "",
			};
		}),

	getRows: protectedProcedure
		.input(
			z.object({
				tableId: z.string().uuid(),
				limit: z.number().int().min(1).max(500).default(50),
				cursor: z.number().int().min(0).optional(),
				sort: z
					.array(sortItemSchema)
					.optional(),
				filter: filterSchema.optional(),
				search: z.string().optional(),
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
			const rawHiddenColumnIds = Array.isArray(tableRecord.hiddenColumnIds)
				? tableRecord.hiddenColumnIds
				: [];
			const hiddenColumnIdSet = new Set(
				rawHiddenColumnIds.filter((columnId): columnId is string =>
					typeof columnId === "string",
				),
			);

			const providedSort = input.sort ?? null;
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

			let sortColumnsById = new Map<
				string,
				{ id: string; tableId: string; type: string | null }
			>();
			if (effectiveSorts.length > 0) {
				const sortColumnIds = effectiveSorts.map((sort) => sort.columnId);
				const columnRecords = await ctx.db.query.tableColumn.findMany({
					where: inArray(tableColumn.id, sortColumnIds),
				});
				sortColumnsById = new Map(
					columnRecords.map((column) => [column.id, column]),
				);

				const missingColumn =
					columnRecords.length !== sortColumnIds.length ||
					columnRecords.some((column) => column.tableId !== input.tableId);
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
				const filterColumnIds = new Set<string>();
				input.filter.items.forEach((item) => {
					if (item.type === "condition") {
						if (!hiddenColumnIdSet.has(item.columnId)) {
							filterColumnIds.add(item.columnId);
						}
						return;
					}
					item.conditions.forEach((condition) => {
						if (!hiddenColumnIdSet.has(condition.columnId)) {
							filterColumnIds.add(condition.columnId);
						}
					});
				});

				const filterColumns = filterColumnIds.size
					? await ctx.db.query.tableColumn.findMany({
							where: inArray(tableColumn.id, Array.from(filterColumnIds)),
						})
					: [];
				const filterColumnsById = new Map(
					filterColumns.map((column) => [column.id, column]),
				);

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
								return sql<boolean>`${textValue} = ${trimmedValue}`;
							case "is_not":
								return sql<boolean>`${textValue} <> ${trimmedValue}`;
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
					switch (operator) {
						case "eq":
							return sql<boolean>`${numericValue} = ${numericInput}`;
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

				const topLevelConditions = input.filter.items
					.map((item) => {
						if (item.type === "condition") {
							return buildConditionExpression(item);
						}
						const groupConditions = item.conditions.map((condition) =>
							buildConditionExpression(condition),
						);
						return combineConditions(groupConditions, item.connector);
					})
					.filter(Boolean) as Array<SqlExpression>;

				filterExpression = combineConditions(
					topLevelConditions,
					input.filter.connector,
				);
			}

			const rawSearch = input.search ?? "";
			const trimmedSearch = rawSearch.trim();
			let searchExpression: SqlExpression | null = null;
			if (trimmedSearch) {
				searchExpression = sql<boolean>`coalesce(${tableRow.searchText}, '') ILIKE ${`%${trimmedSearch}%`}`;
			}

			const offset = input.cursor ?? 0;
			const rows = await ctx.db.query.tableRow.findMany({
				where: (() => {
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
				})(),
				orderBy: (row, { asc, desc }) =>
					effectiveSorts.length > 0
						? [
								...effectiveSorts.flatMap((sort) => {
									const column = sortColumnsById.get(sort.columnId);
									if (!column || column.tableId !== input.tableId) return [];
									const columnType = column.type ?? "single_line_text";
									if (columnType === "number") {
										const numericValue =
											sql<number>`nullif(${tableRow.data} ->> ${sort.columnId}, '')::numeric`;
										return [
											sort.direction === "desc"
												? desc(numericValue)
												: asc(numericValue),
										];
									}
									const textValue =
										sql<string>`coalesce(${tableRow.data} ->> ${sort.columnId}, '')`;
									return [
										sort.direction === "desc"
											? desc(textValue)
											: asc(textValue),
									];
								}),
								asc(row.createdAt),
								asc(row.id),
							]
						: [asc(row.createdAt), asc(row.id)],
				limit: input.limit,
				offset,
			});

			const nextCursor =
				rows.length === input.limit ? offset + rows.length : null;

			return {
				rows: rows.map((row) => ({
					id: row.id,
					data: row.data ?? {},
				})),
				nextCursor,
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

			const [columns, rows, rowCount] = await Promise.all([
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
				ctx.db
					.select({ count: sql<number>`count(*)::int` })
					.from(tableRow)
				.where(eq(tableRow.tableId, input.tableId)),
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
				rowCount: Number(rowCount[0]?.count ?? 0),
				hiddenColumnIds,
			};
		}),
});
