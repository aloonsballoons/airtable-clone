import { faker } from "@faker-js/faker";
import { TRPCError } from "@trpc/server";
import { and, eq, or, sql } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { baseTable, tableColumn, tableRow } from "~/server/db/schema";
import {
	MAX_ROWS,
	MAX_BULK_ROWS,
	BULK_INSERT_BATCH_SIZE,
	MAX_ROWS_QUERY_LIMIT,
	sortItemSchema,
	filterConnectorSchema,
	filterConditionSchema,
	filterSchema,
	filterTextOperators,
	filterNumberOperators,
	filterOperatorsRequiringValue,
	createId,
	coerceColumnType,
	normalizeSingleLineValue,
	normalizeLongTextValue,
	normalizeNumberValue,
	buildSearchText,
	nanosecondsToMilliseconds,
	roundMilliseconds,
	sqlUuidArray,
	buildSortCacheKey,
	getSortCache,
	setSortCache,
	invalidateSortCacheForTable,
	pendingSortCachePopulation,
	SORT_CACHE_MIN_ROWS,
	isGinRebuildRunning,
	setGinRebuildRunning,
	MAX_NUMBER_DECIMALS,
	columnTypeSchema,
	escapeLikePattern,
	MAX_FILTER_DEPTH,
} from "./_internals";

// ---------------------------------------------------------------------------
// Faker / bulk-insert helpers (only used by addRows)
// ---------------------------------------------------------------------------
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
	"Atlas", "Beacon", "Cedar", "Delta", "Ember", "Falcon", "Glacier",
	"Harbor", "Iris", "Juniper", "Kite", "Lumen", "Meridian", "Nova",
	"Orbit", "Pioneer", "Quartz", "River", "Summit", "Timber",
];

const BULK_TEXT_NOUNS = [
	"Plan", "Project", "Request", "Review", "Task", "Record", "Ticket",
	"Asset", "Milestone", "Brief", "Update", "Proposal", "Rollout",
	"Audit", "Checklist",
];

const BULK_LONG_ACTIONS = [
	"Review", "Confirm", "Prepare", "Coordinate", "Validate",
	"Schedule", "Update", "Document", "Track", "Finalize",
];

const BULK_LONG_OBJECTS = [
	"handoff details", "delivery scope", "support notes", "launch checklist",
	"risk summary", "resource plan", "timeline changes", "approval path",
	"onboarding steps", "status blockers",
];

const BULK_LONG_CONTEXTS = [
	"the growth team", "operations", "customer success", "finance",
	"engineering", "marketing", "product", "support", "leadership", "partners",
];

const BULK_LONG_OUTCOMES = [
	"pending review", "ready for handoff", "blocked by dependency",
	"on schedule", "in progress", "needs approval", "awaiting feedback",
	"validated", "scheduled", "complete",
];

const buildBulkLexiconValueExpression = (
	values: readonly string[],
	seriesAlias: string,
	columnOffset: number,
	multiplier: number,
) => {
	const valueCountLiteral = sql.raw(String(values.length));
	const multiplierLiteral = sql.raw(String(multiplier));
	const columnOffsetLiteral = sql.raw(String(columnOffset));
	const offsetMultiplierLiteral = sql.raw(String(multiplier + 5));
	const rowNumber = sql.raw(`${seriesAlias}.row_num`);

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
		return sql<string>`((${rowNumber} * 97 + ${columnOffsetLiteral} * 13) % 500001 - 250000)::text`;
	}
	if (columnType === "long_text") {
		const action = buildBulkLexiconValueExpression(BULK_LONG_ACTIONS, seriesAlias, columnOffset, 7);
		const object = buildBulkLexiconValueExpression(BULK_LONG_OBJECTS, seriesAlias, columnOffset, 11);
		const context = buildBulkLexiconValueExpression(BULK_LONG_CONTEXTS, seriesAlias, columnOffset, 13);
		const outcome = buildBulkLexiconValueExpression(BULK_LONG_OUTCOMES, seriesAlias, columnOffset, 17);
		return sql<string>`(${action} || ' ' || ${object} || ' for ' || ${context} || '. Status: ' || ${outcome} || '.')`;
	}
	const prefix = buildBulkLexiconValueExpression(BULK_TEXT_PREFIXES, seriesAlias, columnOffset, 19);
	const noun = buildBulkLexiconValueExpression(BULK_TEXT_NOUNS, seriesAlias, columnOffset, 23);
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

// ---------------------------------------------------------------------------
// Row router
// ---------------------------------------------------------------------------
export const rowRouter = createTRPCRouter({
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
			const searchBackfillScheduled = false;

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

						const bulkExpressions = buildBulkPopulateSqlExpressions(normalizedColumns);
						const isBulkInsert = input.count >= 10_000;

						const shouldDropBtreeIndexes = isBulkInsert && currentCount < input.count;
						const shouldDropGinIndexes = isBulkInsert;

						let didDropGinIndexes = false;

						{
							if (shouldDropGinIndexes) {
								const cancelResult = await ctx.db.execute(sql`
									SELECT pg_cancel_backend(pid)
									FROM pg_stat_activity
									WHERE query ILIKE '%CREATE INDEX CONCURRENTLY%table_row%'
									AND pid != pg_backend_pid()
									AND state != 'idle'
								`);
								if ([...cancelResult].length > 0) {
									setGinRebuildRunning(false);
								}
							}

							const drops: Promise<unknown>[] = [];
							drops.push(
								ctx.db.execute(sql`DROP INDEX IF EXISTS table_row_table_idx`),
							);
							if (shouldDropBtreeIndexes) {
								drops.push(
									ctx.db.execute(sql`DROP INDEX IF EXISTS table_row_table_created_idx`),
								);
							}
							if (shouldDropGinIndexes) {
								drops.push(
									ctx.db.execute(sql`DROP INDEX IF EXISTS table_row_data_gin_idx`),
									ctx.db.execute(sql`DROP INDEX IF EXISTS table_row_search_text_trgm_idx`),
								);
							}
							await Promise.all(drops);

							if (shouldDropGinIndexes) {
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
							await ctx.db.transaction(async (tx) => {
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
							if (shouldDropBtreeIndexes || didDropGinIndexes) {
								if (shouldDropBtreeIndexes) {
									await ctx.db.execute(sql`
										CREATE INDEX IF NOT EXISTS table_row_table_created_idx
										ON table_row (table_id, created_at, id)
									`);
									markPhase("rebuild-btree-indexes");
								}

								if (didDropGinIndexes && !isGinRebuildRunning()) {
									setGinRebuildRunning(true);
									after(async () => {
										const ginStart = process.hrtime.bigint();
										try {
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
											await ctx.db.execute(sql`
												CREATE INDEX CONCURRENTLY IF NOT EXISTS table_row_data_gin_idx
												ON table_row USING gin (data)
											`);
											await ctx.db.execute(sql`
												CREATE INDEX CONCURRENTLY IF NOT EXISTS table_row_search_text_trgm_idx
												ON table_row USING gin (search_text gin_trgm_ops)
											`);
											await ctx.db.execute(sql`ANALYZE table_row`);
											const ginMs = roundMilliseconds(
												nanosecondsToMilliseconds(process.hrtime.bigint() - ginStart),
											);
											console.info("[row.addRows] GIN indexes rebuilt + ANALYZE", {
												ginMs,
												tableId: input.tableId,
												count: input.count,
											});
										} catch (error) {
											console.error("[row.addRows] GIN index rebuild failed:", error);
										} finally {
											setGinRebuildRunning(false);
										}
									});
								}
							}
						}

						await ctx.db.execute(sql`UPDATE base_table SET row_count = row_count + ${input.count} WHERE id = ${input.tableId}`);
						return { added: input.count, newTotalCount: currentCount + input.count };
					}

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
				invalidateSortCacheForTable(input.tableId);

				if (shouldLogTiming) {
					const totalMs = roundMilliseconds(
						nanosecondsToMilliseconds(process.hrtime.bigint() - requestStart),
					);
					console.info("[row.addRows.timing]", {
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

			invalidateSortCacheForTable(rowRecord.tableId);

			return { success: true };
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
				search: z.string().max(500).optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
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
				for (const id of filterColumnIds) {
					if (hiddenColumnIdSet.has(id)) filterColumnIds.delete(id);
				}

				const filterColumnsById = allColumnsById;

				const containsSearchTerms: string[] = [];
				if (input.filter.connector === "and") {
					for (const item of input.filter.items) {
						if (item.type === "condition" && item.operator === "contains" && item.value?.trim()) {
							containsSearchTerms.push(item.value.trim());
						}
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
								return sql<boolean>`${textValue} ILIKE ${`%${escapeLikePattern(trimmedValue)}%`}`;
							case "does_not_contain":
								return sql<boolean>`${textValue} NOT ILIKE ${`%${escapeLikePattern(trimmedValue)}%`}`;
							case "is":
								return sql<boolean>`${tableRow.data} @> ${JSON.stringify({ [condition.columnId]: trimmedValue })}::jsonb`;
							case "is_not":
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

				const buildItemExpression = (item: typeof input.filter.items[number], depth = 0): SqlExpression | null => {
					if (item.type === "condition") {
						return buildConditionExpression(item);
					}
					if (depth >= MAX_FILTER_DEPTH) return null;
					const childExpressions = item.conditions.map((child) =>
						buildItemExpression(child, depth + 1)
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

				if (containsSearchTerms.length > 0 && filterExpression) {
					const trigramConditions = containsSearchTerms.map(
						(term) => sql<boolean>`coalesce(${tableRow.searchText}, '') ILIKE ${`%${escapeLikePattern(term)}%`}`
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
				searchExpression = sql<boolean>`coalesce(${tableRow.searchText}, '') ILIKE ${`%${escapeLikePattern(trimmedSearch)}%`}`;
			}

			const offset = input.cursor ?? 0;

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

			const buildRawWhereFragments = () => {
				const fragments = [sql`table_id = ${input.tableId}::uuid`];
				if (filterExpression) fragments.push(filterExpression);
				if (searchExpression) fragments.push(searchExpression);
				return fragments;
			};

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

			const needsWorkMemBoost = needsSortWorkMem && offset >= SUBQUERY_OFFSET_THRESHOLD;

			const isFirstPage = offset === 0;
			const hasFiltersOrSearch = !!(filterExpression || searchExpression);
			const shouldCountFiltered = isFirstPage && hasFiltersOrSearch;

			const countPromise = shouldCountFiltered
				? ctx.db.execute(
						sql`SELECT COUNT(*) AS count FROM table_row WHERE ${rawWhereClause}`
					).then((result) => {
						const row = [...result][0] as { count: string | number } | undefined;
						return Number(row?.count ?? 0);
					})
				: Promise.resolve(-1);

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
				const pageIds = cachedSort.ids.slice(offset, offset + input.limit);

				let fastRows: Array<{ id: string; data: Record<string, string> | null }>;
				if (pageIds.length === 0) {
					fastRows = [];
				} else {
					const rawResult = await ctx.db.execute(
						sql`SELECT id, data FROM table_row WHERE id = ANY(${sqlUuidArray(pageIds)})`
					);
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

				const filteredCount = shouldCountFiltered
					? cachedSort.totalFiltered
					: -1;

				return {
					rows: fastRows.map((row) => ({
						id: row.id,
						data: row.data ?? {},
					})),
					nextCursor,
					totalCount: filteredCount,
				};
			}

			const useFirstPageFastPath = sortCacheKey && needsSortWorkMem
				&& isFirstPage && tableRecord.rowCount >= SORT_CACHE_MIN_ROWS;

			if (useFirstPageFastPath) {
				const [topNResult, filteredCount] = await Promise.all([
					ctx.db.execute(flatSql),
					countPromise,
				]);

				if (!pendingSortCachePopulation.has(sortCacheKey)) {
					const deferredPromise = (async () => {
						try {
							const result = await ctx.db.transaction(async (tx) => {
								await tx.execute(sql`SET LOCAL work_mem = '256MB'`);
								return tx.execute(
									sql`SELECT id FROM table_row WHERE ${rawWhereClause} ORDER BY ${orderByFragment}`
								);
							});
							const ids = ([...result] as Array<{ id: string }>).map((r) => r.id);
							setSortCache(sortCacheKey, ids, ids.length);
						} finally {
							pendingSortCachePopulation.delete(sortCacheKey);
						}
					})();
					pendingSortCachePopulation.set(sortCacheKey, deferredPromise);
				}

				const fastRows = [...topNResult] as Array<{ id: string; data: Record<string, string> | null }>;
				const nextCursor = fastRows.length === input.limit
					? offset + fastRows.length : null;

				return {
					rows: fastRows.map((row) => ({
						id: row.id,
						data: row.data ?? {},
					})),
					nextCursor,
					totalCount: filteredCount,
				};
			}

			if (sortCacheKey && needsSortWorkMem && !isFirstPage) {
				const pendingPopulation = pendingSortCachePopulation.get(sortCacheKey);
				if (pendingPopulation) {
					try {
						await pendingPopulation;
					} catch {
						// Cache population failed — fall through to standard query
					}
					const freshCache = getSortCache(sortCacheKey);
					if (freshCache) {
						const pageIds = freshCache.ids.slice(offset, offset + input.limit);
						let cacheRows: Array<{ id: string; data: Record<string, string> | null }>;
						if (pageIds.length === 0) {
							cacheRows = [];
						} else {
							const rawResult = await ctx.db.execute(
								sql`SELECT id, data FROM table_row WHERE id = ANY(${sqlUuidArray(pageIds)})`
							);
							const byId = new Map(
								([...rawResult] as Array<{ id: string; data: Record<string, string> | null }>)
									.map((r) => [r.id, r])
							);
							cacheRows = pageIds
								.map((id) => byId.get(id))
								.filter(Boolean) as typeof cacheRows;
						}
						const nextCursor =
							cacheRows.length === input.limit ? offset + cacheRows.length : null;
						return {
							rows: cacheRows.map((row) => ({
								id: row.id,
								data: row.data ?? {},
							})),
							nextCursor,
							totalCount: -1,
						};
					}
				}
			}

			const [rawResult, filteredCount] = await Promise.all([
				needsWorkMemBoost
					? ctx.db.transaction(async (tx) => {
							await tx.execute(sql`SET LOCAL work_mem = '256MB'`);
							return tx.execute(querySql);
						})
					: ctx.db.execute(querySql),
				countPromise,
			]);

			const fastRows = [...rawResult] as Array<{ id: string; data: Record<string, string> | null }>;
			const nextCursor =
				fastRows.length === input.limit ? offset + fastRows.length : null;

			return {
				rows: fastRows.map((row) => ({
					id: row.id,
					data: row.data ?? {},
				})),
				nextCursor,
				totalCount: filteredCount,
			};
		}),
});
