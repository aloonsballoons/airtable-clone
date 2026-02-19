import { relations, sql } from "drizzle-orm";
import {
	boolean,
	index,
	jsonb,
	pgTable,
	pgTableCreator,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

export const createTable = pgTableCreator((name) => name);

export const posts = createTable(
	"post",
	(d) => ({
		id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
		name: d.varchar({ length: 256 }),
		createdById: d
			.varchar({ length: 255 })
			.notNull()
			.references(() => user.id),
		createdAt: d
			.timestamp({ withTimezone: true })
			.$defaultFn(() => new Date())
			.notNull(),
		updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
	}),
	(t) => [
		index("created_by_idx").on(t.createdById),
		index("name_idx").on(t.name),
	],
);

export const base = createTable(
	"base",
	(d) => ({
		id: d.uuid("id").defaultRandom().primaryKey(),
		name: d.text("name").notNull(),
		ownerId: d
			.text("owner_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: d
			.timestamp("created_at", { withTimezone: true })
			.$defaultFn(() => new Date())
			.notNull(),
		updatedAt: d
			.timestamp("updated_at", { withTimezone: true })
			.$defaultFn(() => new Date())
			.notNull(),
	}),
	(t) => [index("base_owner_idx").on(t.ownerId)],
);

export const baseTable = createTable(
	"base_table",
	(d) => ({
		id: d.uuid("id").defaultRandom().primaryKey(),
		baseId: d
			.uuid("base_id")
			.notNull()
			.references(() => base.id, { onDelete: "cascade" }),
		name: d.text("name").notNull(),
		sortColumnId: d.uuid("sort_column_id"),
		sortDirection: d.text("sort_direction"),
		sortConfig: jsonb("sort_config")
			.$type<Array<{ columnId: string; direction: "asc" | "desc" }>>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		hiddenColumnIds: jsonb("hidden_column_ids")
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		searchQuery: d.text("search_query"),
		filterConfig: jsonb("filter_config")
			.$type<{
				connector: "and" | "or";
				items: Array<{
					id: string;
					type: "condition" | "group";
					columnId?: string | null;
					operator?: string;
					value?: string;
					connector?: "and" | "or";
					conditions?: Array<unknown>;
				}>;
			} | null>()
			.default(sql`NULL`),
		createdAt: d
			.timestamp("created_at", { withTimezone: true })
			.$defaultFn(() => new Date())
			.notNull(),
		updatedAt: d
			.timestamp("updated_at", { withTimezone: true })
			.$defaultFn(() => new Date())
			.notNull(),
	}),
	(t) => [index("base_table_base_idx").on(t.baseId)],
);

export const tableColumn = createTable(
	"table_column",
	(d) => ({
		id: d.uuid("id").defaultRandom().primaryKey(),
		tableId: d
			.uuid("table_id")
			.notNull()
			.references(() => baseTable.id, { onDelete: "cascade" }),
		name: d.text("name").notNull(),
		type: d.text("type").notNull().default("single_line_text"),
		createdAt: d
			.timestamp("created_at", { withTimezone: true })
			.$defaultFn(() => new Date())
			.notNull(),
		updatedAt: d
			.timestamp("updated_at", { withTimezone: true })
			.$defaultFn(() => new Date())
			.notNull(),
	}),
	(t) => [index("table_column_table_idx").on(t.tableId)],
);

export const tableRow = createTable(
	"table_row",
	(d) => ({
		id: d.uuid("id").defaultRandom().primaryKey(),
		tableId: d
			.uuid("table_id")
			.notNull()
			.references(() => baseTable.id, { onDelete: "cascade" }),
		data: d
			.jsonb("data")
			.$type<Record<string, string>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		searchText: d.text("search_text").notNull().default(""),
		createdAt: d
			.timestamp("created_at", { withTimezone: true })
			.$defaultFn(() => new Date())
			.notNull(),
		updatedAt: d
			.timestamp("updated_at", { withTimezone: true })
			.$defaultFn(() => new Date())
			.notNull(),
	}),
	(t) => [
		index("table_row_table_created_idx").on(t.tableId, t.createdAt, t.id),
		// GIN index on data column for faster JSONB filtering
		index("table_row_data_gin_idx").using("gin", t.data),
		// Trigram index on search_text for faster ILIKE searches
		index("table_row_search_text_trgm_idx").using(
			"gin",
			sql`${t.searchText} gin_trgm_ops`,
		),
	],
);

export const tableView = createTable(
	"table_view",
	(d) => ({
		id: d.uuid("id").defaultRandom().primaryKey(),
		tableId: d
			.uuid("table_id")
			.notNull()
			.references(() => baseTable.id, { onDelete: "cascade" }),
		name: d.text("name").notNull(),
		sortConfig: jsonb("sort_config")
			.$type<Array<{ columnId: string; direction: "asc" | "desc" }>>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		hiddenColumnIds: jsonb("hidden_column_ids")
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		searchQuery: d.text("search_query"),
		filterConfig: jsonb("filter_config")
			.$type<{
				connector: "and" | "or";
				items: Array<{
					id: string;
					type: "condition" | "group";
					columnId?: string | null;
					operator?: string;
					value?: string;
					connector?: "and" | "or";
					conditions?: Array<unknown>;
				}>;
			} | null>()
			.default(sql`NULL`),
		createdAt: d
			.timestamp("created_at", { withTimezone: true })
			.$defaultFn(() => new Date())
			.notNull(),
		updatedAt: d
			.timestamp("updated_at", { withTimezone: true })
			.$defaultFn(() => new Date())
			.notNull(),
	}),
	(t) => [index("table_view_table_idx").on(t.tableId)],
);

export const user = pgTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("email_verified")
		.$defaultFn(() => false)
		.notNull(),
	image: text("image"),
	createdAt: timestamp("created_at")
		.$defaultFn(() => /* @__PURE__ */ new Date())
		.notNull(),
	updatedAt: timestamp("updated_at")
		.$defaultFn(() => /* @__PURE__ */ new Date())
		.notNull(),
});

export const session = pgTable("session", {
	id: text("id").primaryKey(),
	expiresAt: timestamp("expires_at").notNull(),
	token: text("token").notNull().unique(),
	createdAt: timestamp("created_at").notNull(),
	updatedAt: timestamp("updated_at").notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
	id: text("id").primaryKey(),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	idToken: text("id_token"),
	accessTokenExpiresAt: timestamp("access_token_expires_at"),
	refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
	scope: text("scope"),
	password: text("password"),
	createdAt: timestamp("created_at").notNull(),
	updatedAt: timestamp("updated_at").notNull(),
});

export const verification = pgTable("verification", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: timestamp("expires_at").notNull(),
	createdAt: timestamp("created_at").$defaultFn(
		() => /* @__PURE__ */ new Date(),
	),
	updatedAt: timestamp("updated_at").$defaultFn(
		() => /* @__PURE__ */ new Date(),
	),
});

export const userRelations = relations(user, ({ many }) => ({
	account: many(account),
	session: many(session),
	base: many(base),
}));

export const accountRelations = relations(account, ({ one }) => ({
	user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const sessionRelations = relations(session, ({ one }) => ({
	user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const baseRelations = relations(base, ({ many, one }) => ({
	owner: one(user, { fields: [base.ownerId], references: [user.id] }),
	tables: many(baseTable),
}));

export const baseTableRelations = relations(baseTable, ({ many, one }) => ({
	base: one(base, { fields: [baseTable.baseId], references: [base.id] }),
	columns: many(tableColumn),
	rows: many(tableRow),
	views: many(tableView),
}));

export const tableColumnRelations = relations(tableColumn, ({ one }) => ({
	table: one(baseTable, { fields: [tableColumn.tableId], references: [baseTable.id] }),
}));

export const tableRowRelations = relations(tableRow, ({ one }) => ({
	table: one(baseTable, { fields: [tableRow.tableId], references: [baseTable.id] }),
}));

export const tableViewRelations = relations(tableView, ({ one }) => ({
	table: one(baseTable, { fields: [tableView.tableId], references: [baseTable.id] }),
}));
