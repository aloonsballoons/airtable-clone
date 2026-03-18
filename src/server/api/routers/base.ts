import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { base, baseTable, tableColumn, tableRow, tableView } from "~/server/db/schema";
import { baseNameSchema, createId } from "./_internals";

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
});
