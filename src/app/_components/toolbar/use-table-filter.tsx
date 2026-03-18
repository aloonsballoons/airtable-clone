import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import type { RefObject, Dispatch, SetStateAction } from "react";
import type { RouterInputs } from "~/trpc/react";
import { useDebounced } from "~/lib/hooks";
import { coerceColumnType } from "~/lib/utils";
import type { ColumnFieldType, FilterConnector, FilterOperator, FilterConditionItem, FilterGroupItem, FilterItem } from "~/lib/types";
import {
  FILTER_OPERATOR_REQUIRES_VALUE,
  getFilterOperatorsForType,
  createFilterCondition,
  createFilterGroup,
} from "~/lib/constants";

// Re-export types so existing consumers continue to work
export type { FilterConnector, FilterOperator, FilterConditionItem, FilterGroupItem, FilterItem } from "~/lib/types";

// Re-export filter constants from ~/lib/constants for backwards compatibility
export {
  FILTER_CONNECTORS,
  FILTER_TEXT_OPERATORS,
  FILTER_NUMBER_OPERATORS,
  FILTER_OPERATOR_LABELS,
  FILTER_OPERATOR_REQUIRES_VALUE,
  getDefaultFilterOperator,
  getFilterOperatorsForType,
  formatFilterOperatorLabel,
  createFilterCondition,
  createFilterGroup,
} from "~/lib/constants";

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
  filterInput: RouterInputs["row"]["getRows"]["filter"];
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
// All filter constants and helpers are re-exported from ~/lib/constants

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
  // Version counters to prevent the persistence effect from firing with stale
  // debouncedFilterItems during view transitions. The reset and init effects
  // bump viewVersionRef; the persistence effect skips when versions don't match
  // (the state updates from reset/init haven't been applied yet in that render).
  const viewVersionRef = useRef(0);
  const lastPersistedVersionRef = useRef(0);

  // Debounce filter items and connector for server queries (300ms to batch
  // keystrokes — each filter query runs expensive JSONB extraction on all rows)
  const [debouncedFilterItems, setDebouncedFilterItemsImmediate] = useDebounced(filterItems, 300);
  const [debouncedFilterConnector, setDebouncedFilterConnectorImmediate] = useDebounced(filterConnector, 300);

  // Effect: Reset filter state on table/view switch
  useEffect(() => {
    viewVersionRef.current += 1;
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
    viewVersionRef.current += 1;
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
  const filterInput: RouterInputs["row"]["getRows"]["filter"] = useMemo(() => {
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
    // During view transitions, debouncedFilterItems may still hold stale values
    // from the previous view (state updates from reset/init effects haven't been
    // applied yet). Skip persistence in this case to avoid saving stale filter
    // data to the wrong view.
    if (lastPersistedVersionRef.current !== viewVersionRef.current) {
      lastPersistedVersionRef.current = viewVersionRef.current;
      return;
    }
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
