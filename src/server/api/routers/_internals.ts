/**
 * Shared constants, schemas, types, utilities, and module-level state
 * used across the split tRPC routers (base, table, row, view, column).
 */
import { sql } from "drizzle-orm";
import { z } from "zod";
import { MAX_NUMBER_DECIMALS } from "~/lib/constants";
import { coerceColumnType } from "~/lib/utils";

// Re-export so downstream router files can keep importing from "./_internals"
export { MAX_NUMBER_DECIMALS, coerceColumnType };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const MAX_TABLES = 1000;
export const MAX_COLUMNS = 500;
// Keep in sync with ~/lib/constants.ts
export const MAX_ROWS = 2_000_000;
export const MAX_BULK_ROWS = 100_000;
export const BULK_INSERT_BATCH_SIZE = 5_000;
export const MAX_ROWS_QUERY_LIMIT = 2_000;
export const MAX_CELL_CHARS = 100_000;

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------
export const baseNameSchema = z.string().min(1).max(120);
export const tableNameSchema = z.string().min(1).max(120);
export const columnNameSchema = z.string().min(1).max(120);
export const columnTypeSchema = z.enum(["single_line_text", "long_text", "number"]);
export const sortItemSchema = z.object({
	columnId: z.string().uuid(),
	direction: z.enum(["asc", "desc"]),
});
export const filterConnectorSchema = z.enum(["and", "or"]);
export const filterOperatorSchema = z.enum([
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
export const filterConditionSchema = z.object({
	type: z.literal("condition"),
	columnId: z.string().uuid(),
	operator: filterOperatorSchema,
	value: z.string().optional(),
});
export type FilterCondition = z.infer<typeof filterConditionSchema>;
export type FilterGroup = {
	type: "group";
	connector: "and" | "or";
	conditions: Array<FilterCondition | FilterGroup>;
};

export const filterGroupSchema: z.ZodType<FilterGroup> = z.object({
	type: z.literal("group"),
	connector: filterConnectorSchema,
	conditions: z.array(
		z.union([filterConditionSchema, z.lazy(() => filterGroupSchema)])
	),
});
export const filterSchema = z.object({
	connector: filterConnectorSchema,
	items: z.array(z.union([filterConditionSchema, filterGroupSchema])),
});

// Filter schemas for storage (used in updateView - includes id for React keys)
export const filterConditionStorageSchema = z.object({
	id: z.string().uuid(),
	type: z.literal("condition"),
	columnId: z.string().uuid().nullable(),
	operator: filterOperatorSchema,
	value: z.string(),
});
export type FilterConditionStorage = z.infer<typeof filterConditionStorageSchema>;
export type FilterGroupStorage = {
	id: string;
	type: "group";
	connector: "and" | "or";
	conditions: Array<FilterConditionStorage | FilterGroupStorage>;
};

export const filterGroupStorageSchema: z.ZodType<FilterGroupStorage> = z.object({
	id: z.string().uuid(),
	type: z.literal("group"),
	connector: filterConnectorSchema,
	conditions: z.array(
		z.union([filterConditionStorageSchema, z.lazy(() => filterGroupStorageSchema)])
	),
});
export const filterStorageSchema = z.object({
	connector: filterConnectorSchema,
	items: z.array(z.union([filterConditionStorageSchema, filterGroupStorageSchema])),
});

// Filter operator sets
export const filterTextOperators = new Set([
	"contains",
	"does_not_contain",
	"is",
	"is_not",
	"is_empty",
	"is_not_empty",
]);
export const filterNumberOperators = new Set([
	"eq",
	"neq",
	"lt",
	"gt",
	"lte",
	"gte",
	"is_empty",
	"is_not_empty",
]);
export const filterOperatorsRequiringValue = new Set([
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

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
export const createId = () => crypto.randomUUID();

export const clampTextValue = (value: string) => value.slice(0, MAX_CELL_CHARS);

export const normalizeSingleLineValue = (value: string) =>
	clampTextValue(value.replace(/\r?\n/g, " "));

export const normalizeLongTextValue = (value: string) => clampTextValue(value);

export const normalizeNumberValue = (value: string) => {
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

export const buildSearchText = (data: Record<string, string> | null | undefined) =>
	Object.values(data ?? {})
		.map((value) => String(value ?? "").trim())
		.filter(Boolean)
		.join(" ");

export const nanosecondsToMilliseconds = (value: bigint) => Number(value) / 1_000_000;
export const roundMilliseconds = (value: number) => Math.round(value * 100) / 100;

// Drizzle's sql`` template expands JS arrays into individual bind parameters
// ($1, $2, …).  PostgreSQL limits ROW/ARRAY expressions to 1664 entries,
// so passing 2000 UUIDs via ${pageIds} causes:
//   "ROW expressions can have at most 1664 entries"
// Instead, build a literal ARRAY['uuid1','uuid2',…]::uuid[] string that
// PostgreSQL parses as a single value.  UUIDs are validated upstream
// (z.string().uuid()) so injection is not a concern.
export const sqlUuidArray = (ids: string[]) =>
	sql.raw(`ARRAY[${ids.map((id) => `'${id}'`).join(",")}]::uuid[]`);

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
export const SORT_CACHE_MIN_ROWS = 5_000;

export const buildSortCacheKey = (
	tableId: string,
	sorts: Array<{ columnId: string; direction: string }>,
	filterFingerprint: string,
	searchFingerprint: string,
) => `${tableId}:${JSON.stringify(sorts)}:${filterFingerprint}:${searchFingerprint}`;

export const getSortCache = (key: string): SortCacheEntry | null => {
	const entry = sortedIdCache.get(key);
	if (!entry) return null;
	if (Date.now() - entry.createdAt > SORT_CACHE_TTL_MS) {
		sortedIdCache.delete(key);
		return null;
	}
	return entry;
};

export const setSortCache = (key: string, ids: string[], totalFiltered: number) => {
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
export const invalidateSortCacheForTable = (tableId: string) => {
	for (const key of sortedIdCache.keys()) {
		if (key.startsWith(`${tableId}:`)) {
			sortedIdCache.delete(key);
		}
	}
};

// Tracks in-flight sort cache population promises so getRows can await
// a pre-warm started by setTableSort instead of running a duplicate sort.
export const pendingSortCachePopulation = new Map<string, Promise<void>>();

// ---------------------------------------------------------------------------
// Module-level state for tracking async GIN index rebuilds.
// When a bulk insert drops + rebuilds GIN indexes via after(),
// the CREATE INDEX holds a SHARE lock that blocks all writes.
// Tracking this lets subsequent bulk inserts skip GIN drops and
// use fast-update buffering instead of blocking for 30-120s.
// ---------------------------------------------------------------------------
let ginRebuildInProgress = false;
let ginRebuildStartedAt = 0;
const GIN_REBUILD_STALE_MS = 5 * 60 * 1000; // 5 minutes

export const isGinRebuildRunning = () => {
	if (!ginRebuildInProgress) return false;
	// Auto-reset if stale (e.g. callback didn't reset due to crash)
	if (Date.now() - ginRebuildStartedAt > GIN_REBUILD_STALE_MS) {
		ginRebuildInProgress = false;
		ginRebuildStartedAt = 0;
		return false;
	}
	return true;
};

export const setGinRebuildRunning = (running: boolean) => {
	ginRebuildInProgress = running;
	ginRebuildStartedAt = running ? Date.now() : 0;
};
