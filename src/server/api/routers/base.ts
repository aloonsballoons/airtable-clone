import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
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

const createId = () => crypto.randomUUID();

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
					{ id: createId(), tableId: newTable.id, name: "Name" },
					{ id: createId(), tableId: newTable.id, name: "Notes" },
					{ id: createId(), tableId: newTable.id, name: "Assignee" },
					{ id: createId(), tableId: newTable.id, name: "Status" },
					{ id: createId(), tableId: newTable.id, name: "Attachments" },
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
				{ id: createId(), tableId: newTable.id, name: "Name" },
				{ id: createId(), tableId: newTable.id, name: "Notes" },
				{ id: createId(), tableId: newTable.id, name: "Assignee" },
				{ id: createId(), tableId: newTable.id, name: "Status" },
				{ id: createId(), tableId: newTable.id, name: "Attachments" },
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

			const [newColumn] = await ctx.db
				.insert(tableColumn)
				.values({
					id: input.id ?? createId(),
					tableId: input.tableId,
					name: columnName,
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

			const batchSize = 1000;
			const batches = Math.ceil(input.count / batchSize);
			let nextIndex = 0;
			for (let batchIndex = 0; batchIndex < batches; batchIndex += 1) {
				const remaining = input.count - batchIndex * batchSize;
				const size = Math.min(batchSize, remaining);
				const rows = Array.from({ length: size }, () => ({
					id: input.ids?.[nextIndex++] ?? createId(),
					tableId: input.tableId,
					data: {},
				}));
				await ctx.db.insert(tableRow).values(rows);
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

			if (columnRecord.table.sortColumnId === input.columnId) {
				await ctx.db
					.update(baseTable)
					.set({ sortColumnId: null, sortDirection: null })
					.where(eq(baseTable.id, columnRecord.tableId));
			}
			return { success: true };
		}),

	setTableSort: protectedProcedure
		.input(
			z.object({
				tableId: z.string().uuid(),
				columnId: z.string().uuid().nullable(),
				direction: z.enum(["asc", "desc"]).optional(),
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

			if (input.columnId) {
				if (!input.direction) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Sort direction is required when a column is selected.",
					});
				}
				const columnRecord = await ctx.db.query.tableColumn.findFirst({
					where: eq(tableColumn.id, input.columnId),
				});
				if (!columnRecord || columnRecord.tableId !== input.tableId) {
					throw new TRPCError({ code: "NOT_FOUND" });
				}

				await ctx.db
					.update(baseTable)
					.set({
						sortColumnId: input.columnId,
						sortDirection: input.direction,
					})
					.where(eq(baseTable.id, input.tableId));

				return { sort: { columnId: input.columnId, direction: input.direction } };
			}

			await ctx.db
				.update(baseTable)
				.set({ sortColumnId: null, sortDirection: null })
				.where(eq(baseTable.id, input.tableId));

			return { sort: null };
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

			const nextData = {
				...(rowRecord.data ?? {}),
				[input.columnId]: input.value,
			};

			await ctx.db
				.update(tableRow)
				.set({ data: nextData, updatedAt: new Date() })
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

			const sortDirection = (tableRecord.sortDirection === "desc"
				? "desc"
				: "asc") as "asc" | "desc";
			const sort: { columnId: string; direction: "asc" | "desc" } | null =
				tableRecord.sortColumnId
					? { columnId: tableRecord.sortColumnId, direction: sortDirection }
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

			return {
				table: { id: tableRecord.id, name: tableRecord.name },
				columns: columns.map((column) => ({
					id: column.id,
					name: column.name,
				})),
				rowCount: Number(rowCount[0]?.count ?? 0),
				sort,
			};
		}),

	getRows: protectedProcedure
		.input(
			z.object({
				tableId: z.string().uuid(),
				limit: z.number().int().min(1).max(500).default(50),
				cursor: z.number().int().min(0).optional(),
				sort: z
					.object({
						columnId: z.string().uuid(),
						direction: z.enum(["asc", "desc"]),
					})
					.optional(),
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

			const providedSort = input.sort ?? null;
			let effectiveSort:
				| { columnId: string; direction: "asc" | "desc" }
				| null =
				providedSort ??
				(tableRecord.sortColumnId
					? {
							columnId: tableRecord.sortColumnId,
							direction:
								tableRecord.sortDirection === "desc" ? "desc" : "asc",
						}
					: null);

			if (effectiveSort) {
				const columnRecord = await ctx.db.query.tableColumn.findFirst({
					where: eq(tableColumn.id, effectiveSort.columnId),
				});
				if (!columnRecord || columnRecord.tableId !== input.tableId) {
					if (providedSort) {
						throw new TRPCError({ code: "NOT_FOUND" });
					}
					effectiveSort = null;
				}
			}

			const offset = input.cursor ?? 0;
			const sortValue =
				effectiveSort &&
				sql<string>`coalesce(${tableRow.data} ->> ${effectiveSort.columnId}, '')`;
			const rows = await ctx.db.query.tableRow.findMany({
				where: eq(tableRow.tableId, input.tableId),
				orderBy: (row, { asc, desc }) =>
					sortValue
						? [
								effectiveSort?.direction === "desc"
									? desc(sortValue)
									: asc(sortValue),
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

			return {
				table: { id: tableRecord.id, name: tableRecord.name },
				columns: columns.map((column) => ({
					id: column.id,
					name: column.name,
				})),
				rows: rows.map((row) => ({
					id: row.id,
					data: row.data ?? {},
				})),
				rowCount: Number(rowCount[0]?.count ?? 0),
			};
		}),
});
