import type { ColumnFieldType, TableRow } from "./types";
import { MAX_NUMBER_DECIMALS, PAGE_ROWS } from "./constants";
import type { RouterInputs } from "~/trpc/react";

export const coerceColumnType = (value?: string | null): ColumnFieldType =>
  value === "long_text" || value === "number" ? value : "single_line_text";

export const formatInitials = (name: string) => {
  const trimmed = name.trim();
  const chars = Array.from(trimmed);
  const first = chars[0] ?? "";
  const second = chars[1] ?? "";
  const formatChar = (char: string, index: number) => {
    if (!char) return "";
    if (/[a-zA-Z]/.test(char)) {
      return index === 0 ? char.toUpperCase() : char.toLowerCase();
    }
    return char;
  };
  const initials = `${formatChar(first, 0)}${formatChar(second, 1)}`;
  return initials || "??";
};

export const isValidNumberDraft = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return true;
  const match = trimmed.match(/^-?\d*(?:\.(\d*))?$/);
  if (!match) return false;
  const decimals = match[1] ?? "";
  return decimals.length <= MAX_NUMBER_DECIMALS;
};

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isValidTableId = (id: string | null): id is string =>
  typeof id === "string" && UUID_REGEX.test(id);

export const isValidUUID = (id: string | null): id is string =>
  typeof id === "string" && UUID_REGEX.test(id);

// ---------------------------------------------------------------------------
// localStorage key helpers
// ---------------------------------------------------------------------------

export const getLastViewedTableKey = (baseId: string) =>
  `airtable:last-viewed-table:${baseId}`;

export const getLastViewedViewKey = (tableId: string) =>
  `airtable:last-viewed-view:${tableId}`;

export const getTableFilterStateKey = (baseId: string, tableId: string) =>
  `airtable:table-filters:${baseId}:${tableId}`;

// ---------------------------------------------------------------------------
// User initial formatting
// ---------------------------------------------------------------------------

export const formatUserInitial = (name: string) => {
  const trimmed = name.trim();
  const chars = Array.from(trimmed);
  const first = chars[0] ?? "";
  if (!first) return "?";
  return /[a-zA-Z]/.test(first) ? first.toUpperCase() : first;
};

// ---------------------------------------------------------------------------
// Row transformation (shared between sparse pages and data pipeline)
// ---------------------------------------------------------------------------

/**
 * Transform raw row data into a TableRow object aligned with ordered columns.
 * Used by both sparse page fetcher and data pipeline to ensure consistent
 * row shape across infinite query and sparse cache results.
 *
 * @param rawRow - Raw row from server: { id, data: Record<columnId, value> }
 * @param orderedColumns - Column definitions in display order
 * @returns TableRow with id and cell values for each column
 */
export const transformRowData = (
  rawRow: { id: string; data?: Record<string, string> },
  orderedColumns: { id: string }[],
): TableRow => {
  const rawData = rawRow.data ?? {};
  const cells: Record<string, string> = { id: rawRow.id };
  for (const col of orderedColumns) {
    cells[col.id] = rawData[col.id] ?? "";
  }
  return cells as TableRow;
};

// ---------------------------------------------------------------------------
// Column name generation
// ---------------------------------------------------------------------------

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const addColumnDefaultBaseNameByType: Record<ColumnFieldType, string> = {
  single_line_text: "Label",
  long_text: "Notes",
  number: "Number",
};

export const getDefaultAddColumnName = (
  type: ColumnFieldType,
  existingNames: string[]
) => {
  const baseName = addColumnDefaultBaseNameByType[type];
  const suffixPattern = new RegExp(`^${escapeRegExp(baseName)}\\s+(\\d+)$`);
  let hasBaseName = false;
  let maxSuffix = 1;

  existingNames.forEach((name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (trimmed === baseName) {
      hasBaseName = true;
      return;
    }
    const match = trimmed.match(suffixPattern);
    if (!match) return;
    const suffix = Number.parseInt(match[1] ?? "", 10);
    if (Number.isNaN(suffix) || suffix < 2) return;
    maxSuffix = Math.max(maxSuffix, suffix);
  });

  if (!hasBaseName) return baseName;
  return `${baseName} ${Math.max(2, maxSuffix + 1)}`;
};

// ---------------------------------------------------------------------------
// Rows prefetch input builder
// ---------------------------------------------------------------------------

// Operators that don't require a value input
const VALUELESS_FILTER_OPS = new Set(["is_empty", "is_not_empty"]);

/**
 * Build the rows query input from a view's config for prefetching.
 * Converts the view's storage-format filter config to the query format
 * used by getRows, filters sorts by hidden columns, and includes search.
 * This allows starting the row fetch immediately on view switch/hover
 * rather than waiting for hooks to absorb the new config.
 */
export function buildRowsPrefetchInput(
  tableId: string,
  viewConfig: {
    sortConfig?: unknown;
    searchQuery?: string | null;
    filterConfig?: unknown;
    hiddenColumnIds?: unknown;
  },
) {
  type SortItem = { columnId: string; direction: "asc" | "desc" };
  type QueryCondition = { type: "condition"; columnId: string; operator: string; value: string };
  type QueryGroup = { type: "group"; connector: "and" | "or"; conditions: QueryCondition[] };

  const input: {
    tableId: string;
    limit: number;
    sort?: SortItem[];
    filter?: RouterInputs["row"]["getRows"]["filter"];
    search?: string;
  } = { tableId, limit: PAGE_ROWS };

  const hiddenIds = Array.isArray(viewConfig.hiddenColumnIds)
    ? (viewConfig.hiddenColumnIds as string[])
    : [];
  const hiddenSet = new Set(hiddenIds);

  // Sort: include only sorts for visible (non-hidden) columns
  const sort = viewConfig.sortConfig;
  if (Array.isArray(sort) && sort.length > 0) {
    const visibleSort = (sort as SortItem[]).filter(
      (s) => s?.columnId && !hiddenSet.has(s.columnId),
    );
    if (visibleSort.length > 0) {
      input.sort = visibleSort;
    }
  }

  // Search
  if (viewConfig.searchQuery) {
    input.search = viewConfig.searchQuery;
  }

  // Filter: convert storage format (with id/type fields) to query format
  type FC = {
    connector?: "and" | "or";
    items?: Array<{
      type?: string;
      columnId?: string | null;
      operator?: string;
      value?: string;
      connector?: "and" | "or";
      conditions?: Array<{
        type?: string;
        columnId?: string | null;
        operator?: string;
        value?: string;
      }>;
    }>;
  };
  const fc = viewConfig.filterConfig as FC | null;
  if (fc?.items && fc.items.length > 0) {
    const normalizeCondition = (
      item: NonNullable<FC["items"]>[number],
    ): QueryCondition | null => {
      if (item.type !== "condition" || !item.columnId || !item.operator) return null;
      if (hiddenSet.has(item.columnId)) return null;
      const trimmedValue = (item.value ?? "").trim();
      if (!VALUELESS_FILTER_OPS.has(item.operator) && !trimmedValue) return null;
      return {
        type: "condition",
        columnId: item.columnId,
        operator: item.operator,
        value: trimmedValue,
      };
    };

    const items: Array<QueryCondition | QueryGroup> = [];
    for (const item of fc.items) {
      if (item.type === "condition") {
        const normalized = normalizeCondition(item);
        if (normalized) items.push(normalized);
      } else if (item.type === "group" && item.conditions) {
        const groupConditions: QueryCondition[] = [];
        for (const child of item.conditions) {
          const normalized = normalizeCondition(
            child as NonNullable<FC["items"]>[number],
          );
          if (normalized) groupConditions.push(normalized);
        }
        if (groupConditions.length > 0) {
          items.push({
            type: "group",
            connector: (item.connector ?? "and") as "and" | "or",
            conditions: groupConditions,
          });
        }
      }
    }

    if (items.length > 0) {
      input.filter = {
        connector: (fc.connector ?? "and") as "and" | "or",
        items,
      } as RouterInputs["row"]["getRows"]["filter"];
    }
  }

  return input;
}
