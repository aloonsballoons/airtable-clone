import { and, desc, eq, ilike } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { boolean, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import postgres from "postgres";

/**
 * Populate a single column for all rows in a user's base/table using faker.
 *
 * Example:
 *   node scripts/populate-column.mjs --yes --email you@example.com --base "Demo base" --table "Table 1" --column "Column 6"
 */

let faker;
try {
  ({ faker } = await import("@faker-js/faker"));
} catch (error) {
  // eslint-disable-next-line no-console
  console.error(
    [
      "Missing dependency: @faker-js/faker",
      "",
      "Install it with:",
      "  pnpm add @faker-js/faker",
      "",
      `Original error: ${String(error)}`,
    ].join("\n"),
  );
  process.exit(1);
}

const userTable = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  emailVerified: boolean("email_verified").notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

const baseTable = pgTable("base", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  ownerId: text("owner_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

const tableTable = pgTable("base_table", {
  id: uuid("id").primaryKey(),
  baseId: uuid("base_id").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

const columnTable = pgTable("table_column", {
  id: uuid("id").primaryKey(),
  tableId: uuid("table_id").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

const rowTable = pgTable("table_row", {
  id: uuid("id").primaryKey(),
  tableId: uuid("table_id").notNull(),
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

function parseArgs(argv) {
  const args = {
    email: "alinanoor305@gmail.com",
    base: "Demo base",
    table: "Table 1",
    column: "Column 6",
    seed: 606,
    yes: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (!token) continue;

    if (token === "--yes") {
      args.yes = true;
      continue;
    }
    if (token === "--email" && next) {
      args.email = next;
      i += 1;
      continue;
    }
    if (token === "--base" && next) {
      args.base = next;
      i += 1;
      continue;
    }
    if (token === "--table" && next) {
      args.table = next;
      i += 1;
      continue;
    }
    if (token === "--column" && next) {
      args.column = next;
      i += 1;
      continue;
    }
    if (token === "--seed" && next) {
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid --seed: ${next}`);
      }
      args.seed = parsed;
      i += 1;
      continue;
    }
    if (token === "--help" || token === "-h") {
      printHelpAndExit(0);
    }
  }

  return args;
}

function printHelpAndExit(code) {
  // eslint-disable-next-line no-console
  console.log(
    [
      "Populate a single column with faker data for all rows.",
      "",
      "Usage:",
      "  node scripts/populate-column.mjs --yes [options]",
      "",
      "Options:",
      "  --email <email>   User email (default: alinanoor305@gmail.com)",
      "  --base <name>     Base name (default: Demo base)",
      "  --table <name>    Table name (default: Table 1)",
      "  --column <name>   Column name (default: Column 6)",
      "  --seed <n>        Faker seed (default: 606)",
      "  --yes             Execute (required; otherwise dry run)",
    ].join("\n"),
  );
  process.exit(code);
}

function valueForColumnName(name) {
  const normalized = name.trim().toLowerCase();
  if (normalized === "column 6") return faker.number.int({ min: 0, max: 1_000_000 });
  if (normalized.includes("email")) return faker.internet.email();
  if (normalized.includes("date")) return faker.date.soon({ days: 30 }).toISOString();
  if (normalized.includes("url") || normalized.includes("link")) return faker.internet.url();
  if (normalized.includes("status")) {
    return faker.helpers.arrayElement(["To do", "In progress", "Done"]);
  }
  if (normalized.includes("name")) return faker.person.fullName();
  return faker.lorem.words({ min: 1, max: 4 });
}

const args = parseArgs(process.argv);
faker.seed(args.seed);

const loadEnvFile = async () => {
  try {
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(new URL("../.env", import.meta.url), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // Ignore missing/invalid .env.
  }
};

if (!process.env.DATABASE_URL) {
  await loadEnvFile();
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set. Add it to your environment (.env) first.");
}

const conn = postgres(databaseUrl, { max: 1 });
const db = drizzle(conn);

const [userRecord] = await db
  .select({ id: userTable.id, email: userTable.email })
  .from(userTable)
  .where(eq(userTable.email, args.email))
  .limit(1);

if (!userRecord) {
  throw new Error(`No user found with email ${args.email}`);
}

const bases = await db
  .select({
    id: baseTable.id,
    name: baseTable.name,
    createdAt: baseTable.createdAt,
  })
  .from(baseTable)
  .where(and(eq(baseTable.ownerId, userRecord.id), ilike(baseTable.name, args.base)))
  .orderBy(desc(baseTable.createdAt));

const baseRecord = bases[0];
if (!baseRecord) {
  throw new Error(`No base named "${args.base}" found for ${args.email}`);
}

const tables = await db
  .select({
    id: tableTable.id,
    name: tableTable.name,
    createdAt: tableTable.createdAt,
  })
  .from(tableTable)
  .where(and(eq(tableTable.baseId, baseRecord.id), ilike(tableTable.name, args.table)))
  .orderBy(desc(tableTable.createdAt));

const tableRecord = tables[0];
if (!tableRecord) {
  throw new Error(`No table named "${args.table}" found in base "${baseRecord.name}"`);
}

const [columnRecord] = await db
  .select({ id: columnTable.id, name: columnTable.name })
  .from(columnTable)
  .where(and(eq(columnTable.tableId, tableRecord.id), ilike(columnTable.name, args.column)))
  .limit(1);

if (!columnRecord) {
  throw new Error(`No column named "${args.column}" found in table "${tableRecord.name}"`);
}

const rows = await db
  .select({ id: rowTable.id, data: rowTable.data })
  .from(rowTable)
  .where(eq(rowTable.tableId, tableRecord.id));

// eslint-disable-next-line no-console
console.log(
  [
    "Populate plan:",
    `- user: ${args.email} (${userRecord.id})`,
    `- base: ${baseRecord.name} (${baseRecord.id})`,
    `- table: ${tableRecord.name} (${tableRecord.id})`,
    `- column: ${columnRecord.name} (${columnRecord.id})`,
    `- rows: ${rows.length}`,
    `- faker seed: ${args.seed}`,
    args.yes ? "- mode: EXECUTE" : "- mode: DRY RUN (add --yes to execute)",
  ].join("\n"),
);

if (!args.yes) {
  await conn.end({ timeout: 5 });
  process.exit(0);
}

const now = new Date();
const batchSize = 200;
for (let index = 0; index < rows.length; index += batchSize) {
  const batch = rows.slice(index, index + batchSize);
  for (const row of batch) {
    const nextValue = valueForColumnName(columnRecord.name);
    const nextData = {
      ...(row.data ?? {}),
      [columnRecord.id]: nextValue,
    };
    await db
      .update(rowTable)
      .set({ data: nextData, updatedAt: now })
      .where(eq(rowTable.id, row.id));
  }
  // eslint-disable-next-line no-console
  console.log(`Updated ${Math.min(index + batchSize, rows.length)}/${rows.length} rows.`);
}

await conn.end({ timeout: 5 });
// eslint-disable-next-line no-console
console.log("Done.");
