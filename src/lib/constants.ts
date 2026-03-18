import type { FilterConnector, FilterOperator, FilterConditionItem, FilterGroupItem } from "./types";

// ============================================================================
// Row & Cell Layout
// ============================================================================
export const ROW_HEIGHT = 33;
export const ROW_NUMBER_COLUMN_WIDTH = 72;
export const DEFAULT_COLUMN_WIDTH = 181;
export const ADD_COLUMN_WIDTH = 93;
export const MAX_NUMBER_DECIMALS = 8;
export const STATUS_ICON_SCALE = 1.1;
export const PAGE_ROWS = 2000;
export const SPARSE_PAGE_ROWS = 2000; // Match main page size for fewer round trips
export const MAX_ROWS = 2_000_000;

// ============================================================================
// Grid Virtualization & Performance
// ============================================================================
export const MAX_COLUMNS = 500;
export const LONG_TEXT_CELL_HEIGHT = 142;
export const CELL_PADDING = 8;
export const CELL_TRUNCATION_THRESHOLD = 16;
export const ROW_VIRTUAL_OVERSCAN = 50;
export const COLUMN_VIRTUAL_OVERSCAN = 12;
export const ROW_SCROLLING_RESET_DELAY_MS = 30;
export const ROW_PREFETCH_AHEAD = PAGE_ROWS * 5;
export const SPARSE_PREFETCH_BUFFER = 3000;
export const SPARSE_DEBOUNCE_MS = 16;
export const SPARSE_SCROLL_THRESHOLD = 50; // Rows threshold to trigger sparse prefetch during scroll

// ============================================================================
// Add Column Menu
// ============================================================================
export const ADD_COLUMN_MENU_WIDTH = 400;
export const ADD_COLUMN_MENU_RIGHT_OFFSET = 5; // Anchor right padding
export const ADD_COLUMN_MENU_BOTTOM_OFFSET = 2; // Distance from button bottom
export const ADD_COLUMN_OPTION_WIDTH = 380;
export const STANDARD_FIELDS_HEIGHT = 207;
export const NAMING_FIELDS_HEIGHT = 147;

// ============================================================================
// Bulk Operations
// ============================================================================
export const BULK_ROWS = 100_000;

// ============================================================================
// Filter Constants
// ============================================================================

export const FILTER_CONNECTORS: FilterConnector[] = ["and", "or"];

export const FILTER_TEXT_OPERATORS: FilterOperator[] = [
  "contains",
  "does_not_contain",
  "is",
  "is_not",
  "is_empty",
  "is_not_empty",
];

export const FILTER_NUMBER_OPERATORS: FilterOperator[] = [
  "eq",
  "neq",
  "lt",
  "gt",
  "lte",
  "gte",
  "is_empty",
  "is_not_empty",
];

export const FILTER_OPERATOR_LABELS: Record<FilterOperator, string> = {
  contains: "contains...",
  does_not_contain: "does not contain...",
  is: "is...",
  is_not: "is not...",
  is_empty: "is empty",
  is_not_empty: "is not empty",
  eq: "=",
  neq: "≠",
  lt: "<",
  gt: ">",
  lte: "≤",
  gte: "≥",
};

export const FILTER_OPERATOR_REQUIRES_VALUE = new Set<FilterOperator>([
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

export const getDefaultFilterOperator = (columnType: string): FilterOperator =>
  columnType === "number" ? "eq" : "contains";

export const getFilterOperatorsForType = (columnType: string): FilterOperator[] =>
  columnType === "number" ? FILTER_NUMBER_OPERATORS : FILTER_TEXT_OPERATORS;

export const formatFilterOperatorLabel = (label: string) =>
  label.length > 12 ? `${label.slice(0, 11)}...` : label;

export const createFilterCondition = (
  columnId: string | null = null,
  columnType: string = "single_line_text"
): FilterConditionItem => ({
  id: crypto.randomUUID(),
  type: "condition",
  columnId,
  operator: getDefaultFilterOperator(columnType),
  value: "",
});

export const createFilterGroup = (): FilterGroupItem => ({
  id: crypto.randomUUID(),
  type: "group",
  connector: "and",
  conditions: [],
});
