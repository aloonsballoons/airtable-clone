import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { base, baseTable, tableColumn, tableRow, tableView } from "~/server/db/schema";
import {
	MAX_TABLES,
	tableNameSchema,
	createId,
	coerceColumnType,
} from "./_internals";

export const tableRouter = createTRPCRouter({
	addTable: protectedProcedure
		.input(z.object({ baseId: z.string().uuid(), name: tableNameSchema.optional() }))
		.mutation(async ({ ctx, input }) => {
			const baseRecord = await ctx.db.query.base.findFirst({
				where: eq(base.id, input.baseId),
				columns: { id: true, ownerId: true },
			});

			if (!baseRecord || baseRecord.ownerId !== ctx.session.user.id) {
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
					type: coerceColumnType(column.type),
				})),
				rowCount: tableRecord.rowCount,
				sort: visibleSort && visibleSort.length > 0 ? visibleSort : null,
				hiddenColumnIds,
				searchQuery: tableRecord.searchQuery ?? "",
				filterConfig: tableRecord.filterConfig ?? null,
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
					type: coerceColumnType(column.type),
				})),
				rows: rows.map((row) => ({
					id: row.id,
					data: row.data ?? {},
				})),
				rowCount: tableRecord.rowCount,
				hiddenColumnIds,
			};
		}),
});
