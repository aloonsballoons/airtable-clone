import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import type { RefObject, Dispatch, SetStateAction } from "react";
import type { RouterInputs } from "~/trpc/react";

// Custom debounce hook for filter input
// Returns [debouncedValue, setImmediate] – call setImmediate(val) to bypass debounce.
function useDebounced<T>(value: T, delay: number): [T, Dispatch<SetStateAction<T>>] {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return [debouncedValue, setDebouncedValue];
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FilterConnector = "and" | "or";

export type FilterOperator =
  | "contains"
  | "does_not_contain"
  | "is"
  | "is_not"
  | "is_empty"
  | "is_not_empty"
  | "eq"
  | "neq"
  | "lt"
  | "gt"
  | "lte"
  | "gte";

export type FilterConditionItem = {
  id: string;
  type: "condition";
  columnId: string | null;
  operator: FilterOperator;
  value: string;
};

export type FilterGroupItem = {
  id: string;
  type: "group";
  connector: FilterConnector;
  conditions: (FilterConditionItem | FilterGroupItem)[];
};

export type FilterItem = FilterConditionItem | FilterGroupItem;

type ColumnFieldType = "single_line_text" | "long_text" | "number";

type Column = {
  id: string;
  name: string;
  type: string | null;
};

export type UseTableFilterParams = {
  tableId: string | null;
  columns: Column[];
  hiddenColumnIdSet: Set<string>;
  viewId?: string | null;
  effectiveFilterConfig?: {
    connector: FilterConnector;
    items: FilterItem[];
  } | null;
  onFilterChange?: (filterConfig: {
    connector: FilterConnector;
    items: FilterItem[];
  } | null) => void;
};

export type UseTableFilterReturn = {
  // Refs
  filterButtonRef: RefObject<HTMLButtonElement | null>;
  filterMenuRef: RefObject<HTMLDivElement | null>;

  // State
  isFilterMenuOpen: boolean;
  setIsFilterMenuOpen: Dispatch<SetStateAction<boolean>>;
  filterItems: FilterItem[];
  setFilterItems: Dispatch<SetStateAction<FilterItem[]>>;
  filterConnector: FilterConnector;
  setFilterConnector: Dispatch<SetStateAction<FilterConnector>>;

  // Computed
  filterInput: RouterInputs["base"]["getRows"]["filter"];
  activeFilterConditions: Array<{
    type: "condition";
    columnId: string;
    operator: FilterOperator;
    value: string;
  }>;
  filteredColumnIds: Set<string>;
  filteredColumnNames: string[];
  hasActiveFilters: boolean;
  hasFilterItems: boolean;

  // Actions
  clearFilters: () => void;
  addFilterCondition: (columnId?: string | null) => void;
  addFilterGroup: () => void;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const coerceColumnType = (value?: string | null): ColumnFieldType =>
  value === "long_text" || value === "number" ? value : "single_line_text";

export const getDefaultFilterOperator = (columnType: ColumnFieldType): FilterOperator =>
  columnType === "number" ? "eq" : "contains";

export const getFilterOperatorsForType = (columnType: ColumnFieldType): FilterOperator[] =>
  columnType === "number" ? FILTER_NUMBER_OPERATORS : FILTER_TEXT_OPERATORS;

export const formatFilterOperatorLabel = (label: string) =>
  label.length > 12 ? `${label.slice(0, 11)}...` : label;

export const createFilterCondition = (
  columnId: string | null = null,
  columnType: ColumnFieldType = "single_line_text"
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
  conditions: [], // Empty - shows placeholder text
});

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTableFilter({
  tableId,
  columns,
  hiddenColumnIdSet,
  viewId,
  effectiveFilterConfig,
  onFilterChange,
}: UseTableFilterParams): UseTableFilterReturn {
  // Refs
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  // Stable ref for onFilterChange so the persistence effect only fires when
  // debounced filter data changes, not when the callback reference changes
  // (e.g. on view switch when activeViewId updates the closure).
  const onFilterChangeRef = useRef(onFilterChange);
  onFilterChangeRef.current = onFilterChange;

  // State
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const [filterItems, setFilterItems] = useState<FilterItem[]>(
    effectiveFilterConfig?.items ?? []
  );
  const [filterConnector, setFilterConnector] = useState<FilterConnector>(
    effectiveFilterConfig?.connector ?? "and"
  );

  // Tracks whether we've loaded the view's filter config for the current view.
  // Prevents re-initialization when effectiveFilterConfig changes from our own mutations.
  const viewDataLoadedRef = useRef<string | null>(null);
  // Tracks the last config we sent via onFilterChange, to skip redundant calls
  // (e.g., after initializing from server data, the debounce fires but we shouldn't
  // re-persist the same config we just loaded).
  const lastSentConfigRef = useRef<string>("null");

  // Debounce filter items and connector for server queries (50ms for fast response)
  const [debouncedFilterItems, setDebouncedFilterItemsImmediate] = useDebounced(filterItems, 50);
  const [debouncedFilterConnector, setDebouncedFilterConnectorImmediate] = useDebounced(filterConnector, 50);

  // Effect: Reset filter state on table/view switch
  useEffect(() => {
    viewDataLoadedRef.current = null;
    setFilterItems([]);
    setFilterConnector("and");
    setIsFilterMenuOpen(false);
    // Bypass debounce: update debounced values immediately so the query key
    // switches without waiting 50ms. This eliminates the flash of stale data.
    setDebouncedFilterItemsImmediate([]);
    setDebouncedFilterConnectorImmediate("and");
    // Mark "null" as already sent so the debounced empty state doesn't
    // wipe the view's saved filter config.
    lastSentConfigRef.current = "null";
  }, [tableId, viewId, setDebouncedFilterItemsImmediate, setDebouncedFilterConnectorImmediate]);

  // Effect: One-time initialization when view data loads (delayed for async views)
  useEffect(() => {
    const viewKey = `${tableId ?? ""}:${viewId ?? ""}`;
    if (viewDataLoadedRef.current === viewKey) return; // already initialized
    if (!effectiveFilterConfig) return; // still loading or no config
    viewDataLoadedRef.current = viewKey;
    setFilterItems(effectiveFilterConfig.items);
    setFilterConnector(effectiveFilterConfig.connector);
    // Bypass debounce so the query key updates immediately (same pattern as the
    // reset effect above). Without this, filterInput lags by 50ms and the
    // isViewSwitching clearing effect can fire before the query key has changed.
    setDebouncedFilterItemsImmediate(effectiveFilterConfig.items);
    setDebouncedFilterConnectorImmediate(effectiveFilterConfig.connector);
    // Mark as "already sent" so the debounce doesn't re-persist this config
    lastSentConfigRef.current = JSON.stringify(effectiveFilterConfig);
  }, [tableId, viewId, effectiveFilterConfig, setDebouncedFilterItemsImmediate, setDebouncedFilterConnectorImmediate]);

  // Build columnById map
  const columnById = useMemo(
    () => new Map(columns.map((column) => [column.id, column])),
    [columns]
  );

  // Build filter input for server - using debounced values to avoid query on every keystroke
  const filterInput: RouterInputs["base"]["getRows"]["filter"] = useMemo(() => {
    const items: Array<
      | { type: "condition"; columnId: string; operator: FilterOperator; value: string }
      | {
          type: "group";
          connector: FilterConnector;
          conditions: Array<{
            type: "condition";
            columnId: string;
            operator: FilterOperator;
            value: string;
          }>;
        }
    > = [];

    const normalizeCondition = (
      condition: FilterConditionItem
    ): { type: "condition"; columnId: string; operator: FilterOperator; value: string } | null => {
      if (!condition.columnId) return null;
      if (hiddenColumnIdSet.has(condition.columnId)) return null;
      const column = columnById.get(condition.columnId);
      if (!column) return null;
      const columnType = coerceColumnType(column.type);
      const allowedOperators = getFilterOperatorsForType(columnType);
      if (!allowedOperators.includes(condition.operator)) return null;
      const trimmedValue = condition.value.trim();
      if (FILTER_OPERATOR_REQUIRES_VALUE.has(condition.operator) && !trimmedValue) {
        return null;
      }
      return {
        type: "condition",
        columnId: condition.columnId,
        operator: condition.operator,
        value: trimmedValue,
      };
    };

    // Recursive function to normalize groups (flatten nested groups for server)
    const normalizeGroup = (
      item: FilterGroupItem
    ): Array<{ type: "condition"; columnId: string; operator: FilterOperator; value: string }> => {
      const result: Array<{ type: "condition"; columnId: string; operator: FilterOperator; value: string }> = [];
      item.conditions.forEach((child) => {
        if (child.type === "condition") {
          const normalized = normalizeCondition(child);
          if (normalized) result.push(normalized);
        } else {
          // Nested group - flatten into parent group
          result.push(...normalizeGroup(child));
        }
      });
      return result;
    };

    debouncedFilterItems.forEach((item) => {
      if (item.type === "condition") {
        const normalized = normalizeCondition(item);
        if (normalized) items.push(normalized);
        return;
      }
      const normalizedGroup = normalizeGroup(item);
      if (normalizedGroup.length > 0) {
        items.push({
          type: "group",
          connector: item.connector,
          conditions: normalizedGroup,
        });
      }
    });

    if (items.length === 0) return undefined;
    return {
      connector: debouncedFilterConnector,
      items,
    };
  }, [columnById, debouncedFilterConnector, debouncedFilterItems, hiddenColumnIdSet]);

  // Compute active filter conditions
  const activeFilterConditions = useMemo((): Array<{
    type: "condition";
    columnId: string;
    operator: FilterOperator;
    value: string;
  }> => {
    if (!filterInput) return [];
    const conditions: Array<{
      type: "condition";
      columnId: string;
      operator: FilterOperator;
      value: string;
    }> = [];
    filterInput.items.forEach((item) => {
      if (item.type === "condition") {
        conditions.push(item as {
          type: "condition";
          columnId: string;
          operator: FilterOperator;
          value: string;
        });
      } else {
        conditions.push(...(item.conditions as Array<{
          type: "condition";
          columnId: string;
          operator: FilterOperator;
          value: string;
        }>));
      }
    });
    return conditions;
  }, [filterInput]);

  // Compute filtered column IDs
  const filteredColumnIds = useMemo(() => {
    const ids = new Set<string>();
    activeFilterConditions.forEach((condition) => ids.add(condition.columnId));
    return ids;
  }, [activeFilterConditions]);

  // Compute filtered column names — derived from raw filterItems (not debounced/normalized)
  // so the label reflects every column that has been selected in the filter UI, even if the
  // condition value is not yet filled in.
  const filteredColumnNames = useMemo(() => {
    const names: string[] = [];
    const seen = new Set<string>();
    const collect = (items: FilterItem[]) => {
      items.forEach((item) => {
        if (item.type === "condition") {
          if (!item.columnId) return;
          const column = columnById.get(item.columnId);
          if (!column || seen.has(column.id)) return;
          seen.add(column.id);
          names.push(column.name);
        } else {
          collect(item.conditions);
        }
      });
    };
    collect(filterItems);
    return names;
  }, [filterItems, columnById]);

  const hasActiveFilters = activeFilterConditions.length > 0;
  const hasFilterItems = filterItems.length > 0;

  // Actions
  const clearFilters = useCallback(() => {
    setFilterItems([]);
    setFilterConnector("and");
  }, []);

  const addFilterCondition = useCallback(
    (columnId: string | null = null) => {
      const column = columnId ? columnById.get(columnId) : null;
      const columnType = column ? coerceColumnType(column.type) : "single_line_text";
      const newCondition = createFilterCondition(columnId, columnType);
      setFilterItems((prev) => [...prev, newCondition]);
    },
    [columnById]
  );

  const addFilterGroup = useCallback(() => {
    const newGroup = createFilterGroup();
    setFilterItems((prev) => [...prev, newGroup]);
  }, []);

  // Effect: Call onFilterChange when debounced filter state changes.
  // Uses lastSentConfigRef to skip redundant calls (e.g., right after initialization
  // from server data, or after our own mutation's optimistic update).
  // Uses onFilterChangeRef (not onFilterChange directly) so this effect only fires
  // when the actual filter data changes, not when the callback reference changes
  // on view switch — which would otherwise persist stale filter data to the new view.
  useEffect(() => {
    if (!onFilterChangeRef.current) return;
    const config =
      debouncedFilterItems.length > 0
        ? {
            connector: debouncedFilterConnector,
            items: debouncedFilterItems,
          }
        : null;
    const serialized = JSON.stringify(config);
    if (serialized === lastSentConfigRef.current) return;
    lastSentConfigRef.current = serialized;
    onFilterChangeRef.current(config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedFilterItems, debouncedFilterConnector]);

  // Note: Filter reset on table change is handled by the initialization effect above

  // Effect: Close filter menu on outside click
  useEffect(() => {
    if (!isFilterMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (filterMenuRef.current?.contains(target)) return;
      if (filterButtonRef.current?.contains(target)) return;
      setIsFilterMenuOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFilterMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isFilterMenuOpen]);

  return {
    // Refs
    filterButtonRef,
    filterMenuRef,

    // State
    isFilterMenuOpen,
    setIsFilterMenuOpen,
    filterItems,
    setFilterItems,
    filterConnector,
    setFilterConnector,

    // Computed
    filterInput,
    activeFilterConditions,
    filteredColumnIds,
    filteredColumnNames,
    hasActiveFilters,
    hasFilterItems,

    // Actions
    clearFilters,
    addFilterCondition,
    addFilterGroup,
  };
}
