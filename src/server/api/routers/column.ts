import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { baseTable, tableColumn } from "~/server/db/schema";
import {
	MAX_COLUMNS,
	columnNameSchema,
	columnTypeSchema,
	createId,
} from "./_internals";

export const columnRouter = createTRPCRouter({
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
});
