import { TRPCError } from "@trpc/server";
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { baseTable, tableColumn, tableView } from "~/server/db/schema";
import {
	sortItemSchema,
	filterStorageSchema,
	createId,
	buildSortCacheKey,
	getSortCache,
	setSortCache,
	pendingSortCachePopulation,
	SORT_CACHE_MIN_ROWS,
} from "./_internals";

export const viewRouter = createTRPCRouter({
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
				if (!getSortCache(prewarmKey) && !pendingSortCachePopulation.has(prewarmKey)) {
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
});
