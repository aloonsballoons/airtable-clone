"use client";

import clsx from "clsx";
import { Inter } from "next/font/google";
import { useRouter } from "next/navigation";
import type {
  MouseEvent as ReactMouseEvent,
} from "react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { skipToken } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";

import AddIcon from "~/assets/add.svg";
import ArrowIcon from "~/assets/arrow.svg";
import AssigneeIcon from "~/assets/assignee.svg";
import AttachmentsIcon from "~/assets/attachments.svg";
import BellIcon from "~/assets/bell.svg";
import BlueSearchIcon from "~/assets/blue-search.svg";
import ColourIcon from "~/assets/colour.svg";
import FilterIcon from "~/assets/filter.svg";
import GridViewIcon from "~/assets/grid-view.svg";
import GroupIcon from "~/assets/group.svg";
import HelpIcon from "~/assets/help.svg";
import HideFieldsIcon from "~/assets/hide fields.svg";
import { HeaderComponent } from "./header-component";
import { FunctionBar } from "./function-component";
import LightArrowIcon from "~/assets/light-arrow.svg";
import LightMailIcon from "~/assets/light-mail.svg";
import LogoIcon from "~/assets/logo.svg";
import NameIcon from "~/assets/name.svg";
import NotesIcon from "~/assets/notes.svg";
import NumberIcon from "~/assets/number.svg";
import OmniIcon from "~/assets/omni.svg";
import PinkIcon from "~/assets/pink.svg";
import PlusIcon from "~/assets/plus.svg";
import ReorderIcon from "~/assets/reorder.svg";
import RowHeightIcon from "~/assets/row-height.svg";
import SearchIcon from "~/assets/search.svg";
import ShareSyncIcon from "~/assets/share-and-sync.svg";
import SortIcon from "~/assets/sort.svg";
import StatusIcon from "~/assets/status.svg";
import ThreeLineIcon from "~/assets/three-line.svg";
import ToggleIcon from "~/assets/toggle.svg";
import XIcon from "~/assets/x.svg";
import LogoutIcon from "~/assets/logout.svg";
import { handleLogout } from "./handle-logout";
import { api, type RouterInputs } from "~/trpc/react";
import { GridViewContainer } from "./grid-view-component";
import { TableView } from "./table-view";
import { useTableSort, type SortConfig, getSortAddMenuIconSpec } from "./use-table-sort";
import { useHideFields } from "./use-hide-fields";
import { useTableSearch } from "./use-table-search";
import { useTableFilter, type FilterItem, type FilterConnector, type FilterOperator, type FilterConditionItem, type FilterGroupItem, FILTER_CONNECTORS, FILTER_TEXT_OPERATORS, FILTER_NUMBER_OPERATORS, FILTER_OPERATOR_LABELS, FILTER_OPERATOR_REQUIRES_VALUE, getDefaultFilterOperator, getFilterOperatorsForType, formatFilterOperatorLabel, createFilterCondition, createFilterGroup } from "./use-table-filter";
import { useBulkRows } from "./use-bulk-rows";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

// Stable empty references for optimistic new-view state (avoids re-render churn)
const EMPTY_STRING_SET = new Set<string>();
const EMPTY_SORT_ROWS: SortConfig[] = [];
const EMPTY_STRING_ARRAY: string[] = [];

const MAX_TABLES = 1000;
const PAGE_ROWS = 2000;
const SPARSE_PAGE_ROWS = 2000; // Match main page size for fewer round trips
const ROW_PREFETCH_AHEAD = PAGE_ROWS * 5;
const MAX_PREFETCH_PAGES_PER_BURST = 5;
const ROW_HEIGHT = 33;
const ROW_VIRTUAL_OVERSCAN = 200;
const ROW_SCROLLING_RESET_DELAY_MS = 30;
const ROW_NUMBER_COLUMN_WIDTH = 72;
const DEFAULT_COLUMN_WIDTH = 181;
const MIN_COLUMN_WIDTH = 120;
const MAX_COLUMN_WIDTH = 420;
const ADD_COLUMN_WIDTH = 93;
const ADD_COLUMN_MENU_WIDTH = 400;
const ADD_COLUMN_OPTION_WIDTH = 380;
const MAX_NUMBER_DECIMALS = 8;
const STATUS_ICON_SCALE = 1.1;
const STATUS_HEADER_ICON_SIZE = 13 * STATUS_ICON_SCALE;

const REQUIRED_COLUMNS = ["Name", "Notes", "Assignee", "Status", "Attachments"];

// Operators that don't require a value input
const VALUELESS_FILTER_OPS = new Set(["is_empty", "is_not_empty"]);

/**
 * Build the rows query input from a view's config for prefetching.
 * Converts the view's storage-format filter config to the query format
 * used by getRows, filters sorts by hidden columns, and includes search.
 * This allows starting the row fetch immediately on view switch/hover
 * rather than waiting for hooks to absorb the new config.
 */
function buildRowsPrefetchInput(
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
    filter?: RouterInputs["base"]["getRows"]["filter"];
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
      } as RouterInputs["base"]["getRows"]["filter"];
    }
  }

  return input;
}

type ColumnFieldType = "single_line_text" | "long_text" | "number";

const coerceColumnType = (value?: string | null): ColumnFieldType =>
  value === "long_text" || value === "number" ? value : "single_line_text";


const addColumnDefaultBaseNameByType: Record<ColumnFieldType, string> = {
  single_line_text: "Label",
  long_text: "Notes",
  number: "Number",
};

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getDefaultAddColumnName = (
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

const imgEllipse2 =
  "https://www.figma.com/api/mcp/asset/220c0b55-a141-4008-8b9e-393c5dcc820b";
const imgEllipse3 =
  "https://www.figma.com/api/mcp/asset/42309589-dc81-48ef-80de-6483844e93cc";

const formatInitials = (name: string) => {
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

type TableRow = Record<string, string> & { id: string };

type TableWorkspaceProps = {
  baseId: string;
  userName: string;
  userEmail: string;
};


type ColumnResizeState = {
  columnId: string;
  startX: number;
  startWidth: number;
};

const formatUserInitial = (name: string) => {
  const trimmed = name.trim();
  const chars = Array.from(trimmed);
  const first = chars[0] ?? "";
  if (!first) return "?";
  return /[a-zA-Z]/.test(first) ? first.toUpperCase() : first;
};

const isValidNumberDraft = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return true;
  const match = trimmed.match(/^-?\d*(?:\.(\d*))?$/);
  if (!match) return false;
  const decimals = match[1] ?? "";
  return decimals.length <= MAX_NUMBER_DECIMALS;
};


const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isValidTableId = (id: string | null): id is string =>
  typeof id === "string" && UUID_REGEX.test(id);
const isValidUUID = (id: string | null): id is string =>
  typeof id === "string" && UUID_REGEX.test(id);

const getLastViewedTableKey = (baseId: string) =>
  `airtable:last-viewed-table:${baseId}`;
const getLastViewedViewKey = (tableId: string) =>
  `airtable:last-viewed-view:${tableId}`;
const getTableFilterStateKey = (baseId: string, tableId: string) =>
  `airtable:table-filters:${baseId}:${tableId}`;

export function TableWorkspace({ baseId, userName, userEmail }: TableWorkspaceProps) {
  const router = useRouter();
  const utils = api.useUtils();
  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const [preferredTableId, setPreferredTableId] = useState<string | null>(null);
  const [preferredTableBaseId, setPreferredTableBaseId] = useState<string | null>(
    null
  );
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [resizing, setResizing] = useState<ColumnResizeState | null>(null);
  const [cellEdits, setCellEdits] = useState<Record<string, Record<string, string>>>(
    {}
  );
  const [ensuredTableId, setEnsuredTableId] = useState<string | null>(null);
  const [hoveredTableTabId, setHoveredTableTabId] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<{
    rowId: string;
    columnId: string;
  } | null>(null);
  const [editingCell, setEditingCell] = useState<{
    rowId: string;
    columnId: string;
  } | null>(null);
  const [activeFilterAdd, setActiveFilterAdd] = useState<"condition" | "group" | null>(
    null
  );
  const [openFilterFieldId, setOpenFilterFieldId] = useState<string | null>(null);
  const [openFilterOperatorId, setOpenFilterOperatorId] = useState<string | null>(
    null
  );
  const [openFilterConnectorId, setOpenFilterConnectorId] = useState<string | null>(
    null
  );
  const [focusedFilterValueId, setFocusedFilterValueId] = useState<string | null>(
    null
  );
  const [filterValueErrorId, setFilterValueErrorId] = useState<string | null>(null);
  const [draggingFilterId, setDraggingFilterId] = useState<string | null>(null);
  const [draggingFilterTop, setDraggingFilterTop] = useState<number | null>(null);
  const [highlightedFilterFieldId, setHighlightedFilterFieldId] = useState<string | null>(null);
  const [highlightedFilterOperatorId, setHighlightedFilterOperatorId] = useState<string | null>(null);
  const [highlightedFilterConnectorKey, setHighlightedFilterConnectorKey] = useState<string | null>(null);
  const [phantomFilterX, setPhantomFilterX] = useState<number | null>(null);
  const [phantomFilterY, setPhantomFilterY] = useState<number | null>(null);
  const [openGroupPlusId, setOpenGroupPlusId] = useState<string | null>(null);
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const [addTableDropdownStage, setAddTableDropdownStage] = useState<"add-options" | "name-input" | null>(null);
  const [tableName, setTableName] = useState("");
  const [pendingTableId, setPendingTableId] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{ left: number; top: number } | null>(null);
  const [newTableId, setNewTableId] = useState<string | null>(null);
  const addTableButtonRef = useRef<HTMLButtonElement>(null);
  const tableNameInputRef = useRef<HTMLInputElement>(null);
  const addTableDropdownRef = useRef<HTMLDivElement>(null);
  const newTableTabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const filterFieldMenuListRef = useRef<HTMLDivElement>(null);
  const filterOperatorMenuListRef = useRef<HTMLDivElement>(null);
  const searchMaskId = useId().replace(/:/g, "");
  const closeMaskId = useId().replace(/:/g, "");
  const filterDragOffsetRef = useRef(0);
  const phantomOffsetRef = useRef({ x: 0, y: 0 });
  const filterDragIndexRef = useRef(0);
  const filterDragScopeRef = useRef<{
    scope: "root" | "group";
    groupId?: string;
    startIndex: number;
    listStartTop: number;
    rowCount: number;
    order: string[];
  } | null>(null);
  const dragOffsetRef = useRef(0);
  const dragIndexRef = useRef(0);
  const hasLoadedTableMetaRef = useRef(false);
  const hydratedFilterTableIdRef = useRef<string | null>(null);
  const functionContainerRef = useRef<HTMLDivElement>(null);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [isViewSwitching, setIsViewSwitching] = useState(false);
  // Tracks whether hooks have had a render cycle to absorb new view config.
  // When view data first becomes ready, the filter/search/sort hooks haven't
  // processed it yet (their useEffects run after render). We skip the first
  // viewDataReady=true render and only clear isViewSwitching on the second,
  // after hooks have updated the query key.
  const viewDataReadyPassRef = useRef(0);
  const [pendingViewName, setPendingViewName] = useState<string | null>(null);

  // Sparse page cache for instant scroll-to-offset fetching
  const sparsePagesRef = useRef<Map<number, { id: string; data: Record<string, string> }[]>>(new Map());
  const sparseFetchingRef = useRef<Set<number>>(new Set());
  const sparseParamsRef = useRef<string>("");
  // Incremental sparse row map — avoid rebuilding entire Map on each page arrival
  const sparseRowsMapRef = useRef<Map<number, TableRow>>(new Map());
  const sparseProcessedPagesRef = useRef<Set<number>>(new Set());
  // RAF-batched sparse version updates — coalesce rapid page arrivals into fewer re-renders
  const sparseRafRef = useRef<number>(0);
  const orderedColumnsRef = useRef([] as { id: string; name: string; type: string | null }[]);

  // Debounce timer for sparse range fetching — coalesces rapid scroll
  // position changes into a single fetch burst for the final position.
  const sparseFetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sparseLastFetchTimeRef = useRef(0);
  const pendingSparseRangeRef = useRef<{ start: number; end: number } | null>(null);
  // Track the user's current viewport page for spiral background prefetch
  const viewportPageRef = useRef(0);

  const baseDetailsQuery = api.base.get.useQuery({ baseId }, { staleTime: 30_000 });

  // Derive views directly from the base.get query (already loaded) – no extra round trip
  const activeTableViews = useMemo(() => {
    if (!activeTableId || !baseDetailsQuery.data) return [];
    const table = baseDetailsQuery.data.tables.find((t) => t.id === activeTableId);
    return table?.views ?? [];
  }, [activeTableId, baseDetailsQuery.data]);

  // Ensure existing tables have at least one view (migration for pre-view tables)
  const ensureDefaultViewMutation = api.base.ensureDefaultView.useMutation({
    onSuccess: (result) => {
      if (result.created) {
        // Seed the getView cache for the newly created default view
        utils.base.getView.setData({ viewId: result.id }, {
          id: result.id,
          name: result.name,
          sortConfig: [],
          hiddenColumnIds: [],
          searchQuery: "",
          filterConfig: null,
        });
        // Background-invalidate to reconcile with the server (non-blocking).
        void utils.base.get.invalidate({ baseId });
      }
      // Select the (possibly newly created) default view
      if (!activeViewId || activeViewId === "pending-view") {
        setActiveViewId(result.id);
      }
    },
  });
  const ensureDefaultViewCalledRef = useRef<string | null>(null);

  // Validate / fall back: if no view is selected or it doesn't belong to the
  // current table, pick the first available view. localStorage restore is
  // handled by the reset-on-table-switch effect so we only need a fallback here.
  useEffect(() => {
    if (!activeTableId) return;
    if (activeTableViews.length > 0) {
      if (activeViewId === null || (!activeTableViews.some((v) => v.id === activeViewId) && activeViewId !== "pending-view")) {
        setActiveViewId(activeTableViews[0]!.id);
      }
    } else if (baseDetailsQuery.data && isValidTableId(activeTableId)) {
      // Table has no views — call ensureDefaultView to create one (migration)
      if (ensureDefaultViewCalledRef.current !== activeTableId) {
        ensureDefaultViewCalledRef.current = activeTableId;
        ensureDefaultViewMutation.mutate({ tableId: activeTableId });
      }
    }
  }, [activeTableId, activeTableViews, activeViewId, baseDetailsQuery.data]);

  const createViewMutation = api.base.createView.useMutation({
    onMutate: ({ name }) => {
      // Show loading state and display the new view name immediately
      setIsViewSwitching(true);
      setPendingViewName(name);
      // Immediately select the pending view so the sidebar highlights it
      setActiveViewId("pending-view");
    },
    onSuccess: (newView) => {
      // Seed the getView cache directly — new views always have empty config,
      // so we don't need to wait for a server round-trip.
      utils.base.getView.setData({ viewId: newView.id }, {
        id: newView.id,
        name: newView.name,
        sortConfig: [],
        hiddenColumnIds: [],
        searchQuery: "",
        filterConfig: null,
      });

      // Optimistically add the new view to the base.get cache so the sidebar
      // updates instantly without a full refetch.
      utils.base.get.setData({ baseId }, (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          tables: prev.tables.map((table) =>
            table.id === newView.tableId
              ? {
                  ...table,
                  views: [
                    ...table.views,
                    {
                      id: newView.id,
                      name: newView.name,
                      sortConfig: [],
                      hiddenColumnIds: [],
                      searchQuery: "",
                      filterConfig: null,
                    },
                  ],
                }
              : table
          ),
        };
      });

      // Switch to the newly created real view — getView is already cached above,
      // so hooks will pick it up immediately without a network request.
      setActiveViewId(newView.id);
      setPendingViewName(null);

      // Background-invalidate to reconcile with the server (non-blocking).
      void utils.base.get.invalidate({ baseId });
    },
    onError: () => {
      setIsViewSwitching(false);
      setPendingViewName(null);
      // Revert to the first available view
      setActiveViewId(activeTableViews[0]?.id ?? null);
    },
  });

  // Query for the active view's state (all views are now persisted in DB)
  const hasActiveView = activeViewId !== null && isValidUUID(activeViewId);
  const activeViewQuery = api.base.getView.useQuery(
    { viewId: activeViewId! },
    { enabled: hasActiveView, staleTime: 30_000 }
  );

  // Mutation to update view state
  const updateViewMutation = api.base.updateView.useMutation({
    onMutate: async ({ viewId, sortConfig, hiddenColumnIds, searchQuery, filterConfig }) => {
      await utils.base.getView.cancel({ viewId });
      const previous = utils.base.getView.getData({ viewId });
      utils.base.getView.setData({ viewId }, (current) => {
        if (!current) return current;
        return {
          ...current,
          ...(sortConfig !== undefined && { sortConfig }),
          ...(hiddenColumnIds !== undefined && { hiddenColumnIds }),
          ...(searchQuery !== undefined && { searchQuery }),
          ...(filterConfig !== undefined && { filterConfig }),
        };
      });
      return { previous, viewId };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous && context?.viewId) {
        utils.base.getView.setData({ viewId: context.viewId }, context.previous);
      }
    },
    onSettled: (_data, error, variables) => {
      // Only refetch on error to reconcile with the server.
      // On success the optimistic update from onMutate is already accurate,
      // and an immediate refetch can race with the batch-streamed response
      // causing a brief flicker (stale data overwrites the optimistic state).
      if (error) {
        void utils.base.getView.invalidate({ viewId: variables.viewId });
      }
    },
  });

  useEffect(() => {
    setPreferredTableId(null);
    setPreferredTableBaseId(null);
    try {
      const storedId = window.localStorage.getItem(getLastViewedTableKey(baseId));
      setPreferredTableId(
        storedId && isValidTableId(storedId) ? storedId : null
      );
    } catch {
      setPreferredTableId(null);
    } finally {
      setPreferredTableBaseId(baseId);
    }
  }, [baseId]);

  useEffect(() => {
    utils.base.list.prefetch();
  }, [utils.base.list]);

  // Seed the getView cache for all views from base.get data — eliminates
  // the separate getView network call on initial load and view switches.
  const seededBaseRef = useRef<string | null>(null);
  useEffect(() => {
    if (!baseDetailsQuery.data || seededBaseRef.current === baseDetailsQuery.data.id) return;
    seededBaseRef.current = baseDetailsQuery.data.id;
    for (const table of baseDetailsQuery.data.tables) {
      for (const view of table.views) {
        utils.base.getView.setData({ viewId: view.id }, {
          id: view.id,
          name: view.name,
          sortConfig: view.sortConfig,
          hiddenColumnIds: view.hiddenColumnIds,
          searchQuery: view.searchQuery,
          filterConfig: view.filterConfig,
        });
      }
    }
  }, [baseDetailsQuery.data, utils.base.getView]);

  // Prefetch the first table's meta and rows as soon as base details load
  // so the data is ready by the time activeTableId is set.
  // Now includes view params so the rows cache key matches the actual query.
  useEffect(() => {
    const tables = baseDetailsQuery.data?.tables;
    if (!tables?.length) return;

    // Determine which table will be selected (same logic as the selection effect)
    let targetId: string | null = null;
    if (isValidTableId(preferredTableId) && tables.some((t) => t.id === preferredTableId)) {
      targetId = preferredTableId;
    } else if (tables[0]) {
      targetId = tables[0].id;
    }
    if (!targetId) return;

    void utils.base.getTableMeta.prefetch({ tableId: targetId }, { staleTime: 30_000 });

    // Determine the likely view and its config for view-aware row prefetch
    const targetTable = tables.find((t) => t.id === targetId);
    let targetView: (typeof tables)[number]["views"][number] | undefined;
    try {
      const storedViewId = window.localStorage.getItem(getLastViewedViewKey(targetId));
      if (storedViewId && isValidUUID(storedViewId)) {
        targetView = targetTable?.views.find((v) => v.id === storedViewId);
      }
    } catch { /* ignore */ }
    if (!targetView && targetTable?.views[0]) {
      targetView = targetTable.views[0];
    }

    // Build rows query key from view config so the cache key matches the actual query.
    // Uses the shared helper for consistent filter/sort/search normalization.
    const rowsInput = targetView
      ? buildRowsPrefetchInput(targetId, targetView)
      : { tableId: targetId, limit: PAGE_ROWS };
    void utils.base.getRows.prefetchInfinite(rowsInput, { staleTime: 30_000 });
  }, [baseDetailsQuery.data?.tables, preferredTableId, utils.base.getTableMeta, utils.base.getRows]);

  // Update favicon when base name changes.
  // We only manage our own link element (tracked via data-dynamic-favicon).
  // Never remove links managed by Next.js — doing so causes "Cannot read
  // properties of null (reading 'removeChild')" when React tries to
  // reconcile nodes we already removed from the DOM.
  useEffect(() => {
    const baseName = baseDetailsQuery.data?.name;
    if (!baseName) return;

    const initials = formatInitials(baseName);
    const faviconUrl = `/api/favicon?initials=${encodeURIComponent(initials)}&v=${Date.now()}`;

    // Reuse our existing dynamic link if present, otherwise create one
    let link = document.querySelector<HTMLLinkElement>("link[data-dynamic-favicon]");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      link.type = "image/svg+xml";
      link.setAttribute("data-dynamic-favicon", "true");
      document.head.appendChild(link);
    }
    link.href = faviconUrl;

    // Cleanup: remove only our own link
    return () => {
      const dynamicLink = document.querySelector<HTMLLinkElement>("link[data-dynamic-favicon]");
      if (dynamicLink?.parentNode) {
        dynamicLink.parentNode.removeChild(dynamicLink);
      }
    };
  }, [baseDetailsQuery.data?.name]);

  const tableMetaQuery = api.base.getTableMeta.useQuery(
    isValidTableId(activeTableId) ? { tableId: activeTableId } : skipToken,
    { staleTime: 30_000 }
  );
  useEffect(() => {
    if (tableMetaQuery.data) {
      hasLoadedTableMetaRef.current = true;
    }
  }, [tableMetaQuery.data]);

  // All views are now persisted — always read config from the active view query
  const effectiveHiddenColumnIds = activeViewQuery.data?.hiddenColumnIds ?? [];
  const effectiveSearchQuery = activeViewQuery.data?.searchQuery ?? "";
  const effectiveSortConfig = useMemo(
    () => activeViewQuery.data?.sortConfig ?? [],
    [activeViewQuery.data?.sortConfig]
  );
  const effectiveFilterConfig = useMemo(
    () => (activeViewQuery.data?.filterConfig ?? null) as { connector: FilterConnector; items: FilterItem[]; } | null,
    [activeViewQuery.data?.filterConfig]
  );

  const hiddenColumnIds = effectiveHiddenColumnIds;
  const hiddenColumnIdSet = useMemo(
    () => new Set(hiddenColumnIds),
    [hiddenColumnIds]
  );
  const hiddenFieldCount = hiddenColumnIdSet.size;
  const activeTables = baseDetailsQuery.data?.tables ?? [];
  const activeTable = tableMetaQuery.data?.table ?? null;
  const activeColumns = tableMetaQuery.data?.columns ?? [];
  const totalRowCount = tableMetaQuery.data?.rowCount ?? 0; // Total unfiltered count
  const columnById = useMemo(
    () => new Map(activeColumns.map((column) => [column.id, column])),
    [activeColumns]
  );
  const orderedAllColumns = useMemo(() => {
    const nameCol = activeColumns.find((column) => column.name === "Name");
    if (!nameCol) return activeColumns;
    return [
      nameCol,
      ...activeColumns.filter((column) => column.id !== nameCol.id),
    ];
  }, [activeColumns]);
  const orderedColumns = useMemo(
    () =>
      orderedAllColumns.filter(
        (column) => column.name === "Name" || !hiddenColumnIdSet.has(column.id)
      ),
    [hiddenColumnIdSet, orderedAllColumns]
  );
  orderedColumnsRef.current = orderedColumns;
  const visibleColumnIdSet = useMemo(
    () => new Set(orderedColumns.map((column) => column.id)),
    [orderedColumns]
  );

  // Initialize search hook
  const searchHook = useTableSearch({
    tableId: activeTableId,
    viewId: activeViewId,
    initialSearchQuery: effectiveSearchQuery,
  });
  const { searchValue, searchQuery, hasSearchQuery } = searchHook;

  // Mutation to persist filter config on the base table (default view)
  const setTableFilter = api.base.setTableFilter.useMutation({
    onMutate: async ({ tableId, filterConfig }) => {
      await utils.base.getTableMeta.cancel({ tableId });
      const previous = utils.base.getTableMeta.getData({ tableId });
      utils.base.getTableMeta.setData({ tableId }, (current) => {
        if (!current) return current;
        return {
          ...current,
          filterConfig,
        };
      });
      return { previous, tableId };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        utils.base.getTableMeta.setData(
          { tableId: context.tableId },
          context.previous
        );
      }
    },
    onSettled: async (_data, _error, variables) => {
      await utils.base.getTableMeta.invalidate({ tableId: variables.tableId });
    },
  });

  // Memoize onFilterChange to prevent infinite re-render loops
  const handleFilterChange = useCallback(
    (filterConfig: { connector: FilterConnector; items: FilterItem[] } | null) => {
      if (hasActiveView && activeViewId) {
        updateViewMutation.mutate({ viewId: activeViewId, filterConfig });
      }
    },
    [hasActiveView, activeViewId, updateViewMutation]
  );

  // Initialize filter hook
  const filterHook = useTableFilter({
    tableId: activeTableId,
    columns: activeColumns,
    hiddenColumnIdSet,
    viewId: activeViewId,
    effectiveFilterConfig,
    onFilterChange: handleFilterChange,
  });
  const {
    filterItems,
    setFilterItems,
    filterConnector,
    setFilterConnector,
    filterInput,
    activeFilterConditions,
    filteredColumnIds,
    filteredColumnNames,
    hasActiveFilters,
  } = filterHook;

  // Memoize onSortChange to avoid unnecessary re-renders
  const handleSortChange = useCallback(
    (sortConfig: SortConfig[] | null) => {
      if (hasActiveView && activeViewId) {
        updateViewMutation.mutate({
          viewId: activeViewId,
          sortConfig: sortConfig ?? [],
        });
      }
    },
    [hasActiveView, activeViewId, updateViewMutation]
  );

  // Initialize table sort hook
  const tableSortHook = useTableSort({
    tableId: activeTableId,
    viewId: activeViewId,
    isCustomView: hasActiveView,
    columns: orderedColumns,
    visibleColumnIdSet,
    tableMetaQuery: {
      data: tableMetaQuery.data
        ? { ...tableMetaQuery.data, sort: effectiveSortConfig }
        : undefined,
    },
    hasLoadedTableMetaRef,
    onSortChange: handleSortChange,
  });

  // Initialize hide fields hook
  const hideFieldsHook = useHideFields({
    orderedAllColumns,
    hiddenColumnIdSet,
    activeTableId,
    setHiddenColumns: (params) => {
      if (hasActiveView && activeViewId) {
        updateViewMutation.mutate({
          viewId: activeViewId,
          hiddenColumnIds: params.hiddenColumnIds,
        });
      } else {
        setHiddenColumns.mutate(params);
      }
    },
  });

  const sortParam = tableSortHook.sortParam;
  const hasSort = tableSortHook.hasSort;
  const shouldIncludeSortInQuery = tableSortHook.shouldIncludeSortInQuery;

  const getRowsQueryKeyForSort = (
    tableId: string,
    sort: SortConfig[],
    includeSearch: boolean = true
  ) => {
    const key: {
      tableId: string;
      limit: number;
      sort?: SortConfig[];
      filter?: RouterInputs["base"]["getRows"]["filter"];
      search?: string;
    } = { tableId, limit: PAGE_ROWS };
    if (shouldIncludeSortInQuery) {
      key.sort = sort;
    }
    if (filterInput) {
      key.filter = filterInput;
    }
    if (includeSearch && hasSearchQuery) {
      key.search = searchQuery;
    }
    return key;
  };
  const getRowsQueryKey = (tableId: string) =>
    getRowsQueryKeyForSort(tableId, sortParam);
  const getRowsQueryKeyWithoutSearch = (tableId: string) =>
    getRowsQueryKeyForSort(tableId, sortParam, false);

  // Memoize the primary query key so the useInfiniteQuery hook receives a
  // structurally-stable reference.  On the very first render after a view
  // switch, hooks haven't absorbed the view config yet (their effects run
  // *after* render), so the hook-derived key is still at defaults — which
  // won't match the prefetch.  When this happens, fall back to the
  // view-derived key (same logic as buildRowsPrefetchInput) so the first
  // render immediately hits the prefetch cache, shaving 1-2 render cycles
  // off the skeleton → data transition.
  const hooksAtDefaults = sortParam.length === 0 && !filterInput && !hasSearchQuery;
  const memoizedRowsQueryKey = useMemo(() => {
    if (!isValidTableId(activeTableId)) return null;
    // When hooks are still at defaults but the view has config, derive the
    // key from view data to match the prefetch cache key.
    if (hooksAtDefaults && activeViewQuery.data) {
      const vd = activeViewQuery.data;
      const hasViewSort = Array.isArray(vd.sortConfig) && vd.sortConfig.length > 0;
      const hasViewSearch = !!(vd.searchQuery);
      const hasViewFilter = !!(vd.filterConfig);
      if (hasViewSort || hasViewSearch || hasViewFilter) {
        return buildRowsPrefetchInput(activeTableId, vd);
      }
    }
    return getRowsQueryKeyForSort(activeTableId, sortParam);
  }, [activeTableId, hooksAtDefaults, activeViewQuery.data, shouldIncludeSortInQuery, sortParam, filterInput, hasSearchQuery, searchQuery]);

  const memoizedRowsQueryKeyWithoutSearch = useMemo(() => {
    if (!isValidTableId(activeTableId) || hasSearchQuery) return null;
    return getRowsQueryKeyForSort(activeTableId, sortParam, false);
  }, [activeTableId, hasSearchQuery, shouldIncludeSortInQuery, sortParam, filterInput]);

  const rowsQuery = api.base.getRows.useInfiniteQuery(
    memoizedRowsQueryKey ?? skipToken,
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      // During view switches, disable placeholderData so the query starts fresh
      // without leaking filtered/sorted data from the previous view.
      placeholderData: isViewSwitching ? undefined : (previousData) => previousData,
      staleTime: 30_000,
    }
  );

  // Fallback query without search - used when search returns no results
  const rowsQueryWithoutSearch = api.base.getRows.useInfiniteQuery(
    memoizedRowsQueryKeyWithoutSearch ?? skipToken,
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      placeholderData: (previousData) => previousData,
      staleTime: 30_000,
    }
  );

  // Get the filtered row count from the first page of the query.
  // When count is -1 (skipped for unfiltered queries), fall back to
  // totalRowCount from getTableMeta which is the unfiltered total.
  const firstPageCount = rowsQuery.data?.pages[0]?.totalCount ?? -1;
  const activeRowCount = firstPageCount >= 0 ? firstPageCount : totalRowCount;

  // Initialize bulk rows hook
  const bulkRowsHook = useBulkRows({
    activeTableId,
    activeRowCount: totalRowCount, // Use total count for max row validation
    hasActiveFilters,
    utils,
    getRowsQueryKey,
    onBulkSuccess: () => {
      // Clear sparse page cache so the virtualizer fetches fresh data
      resetSparseCache();
    },
  });
  const { handleAddBulkRows, bulkRowsDisabled, addRowsMutate, addRowsIsPending } = bulkRowsHook;

  const handleCreateView = useCallback((viewName: string) => {
    if (!activeTableId) return;
    // Flush pending search and filter saves to the current view before creating a new one
    flushPendingSearchRef.current();
    flushPendingFilterRef.current();
    createViewMutation.mutate({
      tableId: activeTableId,
      name: viewName,
    });
  }, [activeTableId, createViewMutation]);

  const renameViewMutation = api.base.renameView.useMutation({
    onMutate: async ({ viewId: renamedViewId, name: newName }) => {
      await utils.base.get.cancel({ baseId });
      const previousData = utils.base.get.getData({ baseId });
      // Optimistically update the view name in cache
      utils.base.get.setData({ baseId }, (old) => {
        if (!old) return old;
        return {
          ...old,
          tables: old.tables.map((table) =>
            table.id === activeTableId
              ? { ...table, views: table.views.map((v) => v.id === renamedViewId ? { ...v, name: newName } : v) }
              : table
          ),
        };
      });
      // Also optimistically update the getView cache
      if (isValidUUID(renamedViewId)) {
        await utils.base.getView.cancel({ viewId: renamedViewId });
        utils.base.getView.setData({ viewId: renamedViewId }, (old) => {
          if (!old) return old;
          return { ...old, name: newName };
        });
      }
      return { previousData };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousData) {
        utils.base.get.setData({ baseId }, context.previousData);
      }
    },
    onSettled: (_data, _error, variables) => {
      // Background-invalidate to reconcile with the server (non-blocking).
      void utils.base.get.invalidate({ baseId });
      if (isValidUUID(variables.viewId)) {
        void utils.base.getView.invalidate({ viewId: variables.viewId });
      }
    },
  });

  const deleteViewMutation = api.base.deleteView.useMutation({
    onMutate: async ({ viewId: deletedViewId }) => {
      await utils.base.get.cancel({ baseId });
      const previousData = utils.base.get.getData({ baseId });
      // Optimistically remove the view from cache
      utils.base.get.setData({ baseId }, (old) => {
        if (!old) return old;
        return {
          ...old,
          tables: old.tables.map((table) =>
            table.id === activeTableId
              ? { ...table, views: table.views.filter((v) => v.id !== deletedViewId) }
              : table
          ),
        };
      });
      // Switch to the first remaining view
      const remainingViews = activeTableViews.filter((v) => v.id !== deletedViewId);
      setActiveViewId(remainingViews[0]?.id ?? null);
      return { previousData };
    },
    onSuccess: () => {
      // Background-invalidate to reconcile with the server (non-blocking).
      void utils.base.get.invalidate({ baseId });
    },
    onError: (_err, _vars, context) => {
      // Revert optimistic update
      if (context?.previousData) {
        utils.base.get.setData({ baseId }, context.previousData);
      }
      setActiveViewId(activeTableViews[0]?.id ?? null);
    },
  });

  const duplicateViewMutation = api.base.duplicateView.useMutation({
    onMutate: ({ name }) => {
      setIsViewSwitching(true);
      if (name) setPendingViewName(name);
      setActiveViewId("pending-view");
    },
    onSuccess: (newView) => {
      // Seed the getView cache with the duplicated view's full config
      utils.base.getView.setData({ viewId: newView.id }, {
        id: newView.id,
        name: newView.name,
        sortConfig: newView.sortConfig,
        hiddenColumnIds: newView.hiddenColumnIds,
        searchQuery: newView.searchQuery,
        filterConfig: newView.filterConfig,
      });

      // Optimistically add the new view to base.get cache
      utils.base.get.setData({ baseId }, (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          tables: prev.tables.map((table) =>
            table.id === newView.tableId
              ? {
                  ...table,
                  views: [
                    ...table.views,
                    {
                      id: newView.id,
                      name: newView.name,
                      sortConfig: newView.sortConfig,
                      hiddenColumnIds: newView.hiddenColumnIds,
                      searchQuery: newView.searchQuery,
                      filterConfig: newView.filterConfig,
                    },
                  ],
                }
              : table
          ),
        };
      });

      setActiveViewId(newView.id);
      setPendingViewName(null);

      // Background-invalidate to reconcile with the server (non-blocking).
      void utils.base.get.invalidate({ baseId });
    },
    onError: () => {
      setIsViewSwitching(false);
      setPendingViewName(null);
      setActiveViewId(activeTableViews[0]?.id ?? null);
    },
  });

  const handleRenameView = useCallback((viewId: string, newName: string) => {
    if (!isValidUUID(viewId)) return;
    renameViewMutation.mutate({ viewId, name: newName });
  }, [renameViewMutation]);

  const handleDeleteView = useCallback((viewId: string) => {
    deleteViewMutation.mutate({ viewId });
  }, [deleteViewMutation]);

  const handleDuplicateView = useCallback((viewId: string, name: string) => {
    duplicateViewMutation.mutate({ viewId, name });
  }, [duplicateViewMutation]);

  // Ref for flushing pending search save on view switch (assigned after setTableSearch is defined)
  const flushPendingSearchRef = useRef<() => void>(() => {});
  // Ref for flushing pending filter save on view switch
  const flushPendingFilterRef = useRef<() => void>(() => {});

  const handleSelectView = useCallback((viewId: string) => {
    // Close all open function bar menus before switching views
    hideFieldsHook.setIsHideFieldsMenuOpen(false);
    filterHook.setIsFilterMenuOpen(false);
    tableSortHook.setIsSortMenuOpen(false);
    searchHook.setIsSearchMenuOpen(false);
    // Flush pending search and filter saves to the CURRENT view before switching
    flushPendingSearchRef.current();
    flushPendingFilterRef.current();
    setIsViewSwitching(true);
    viewDataReadyPassRef.current = 0;
    setActiveViewId(viewId);
    // Prefetch the view data and rows if it's a real custom view.
    // Reading the cached view config lets us start the row fetch immediately
    // rather than waiting 2-3 render cycles for hooks to absorb the new config.
    if (isValidUUID(viewId)) {
      void utils.base.getView.prefetch({ viewId }, { staleTime: 30_000 });

      if (activeTableId) {
        const cachedView = utils.base.getView.getData({ viewId });
        if (cachedView) {
          const rowsInput = buildRowsPrefetchInput(activeTableId, cachedView);
          void utils.base.getRows.prefetchInfinite(rowsInput, { staleTime: 30_000 });
        }
      }
    }
  }, [utils.base.getView, utils.base.getRows, activeTableId, hideFieldsHook, filterHook, tableSortHook, searchHook]);

  // Prefetch rows when hovering over a view in the sidebar so data is
  // often ready by the time the user clicks.
  const handleHoverView = useCallback((viewId: string) => {
    if (!isValidUUID(viewId) || !activeTableId || viewId === activeViewId) return;
    const cachedView = utils.base.getView.getData({ viewId });
    if (cachedView) {
      const rowsInput = buildRowsPrefetchInput(activeTableId, cachedView);
      void utils.base.getRows.prefetchInfinite(rowsInput, { staleTime: 30_000 });
    }
  }, [utils.base.getView, utils.base.getRows, activeTableId, activeViewId]);

  // Clear view switching state once data is loaded
  // Track the query key fingerprint (filterInput + searchQuery) so the effect
  // re-fires when hooks process the new view config and update the rowsQuery key.
  const rowsQueryKeyFingerprint = useMemo(
    () => JSON.stringify({ f: filterInput ?? null, s: searchQuery }),
    [filterInput, searchQuery]
  );
  useEffect(() => {
    if (!isViewSwitching) {
      viewDataReadyPassRef.current = 0;
      return;
    }

    // Don't clear loading while the create mutation is still in flight
    if (createViewMutation.isPending) return;

    if (activeViewId == "pending-view") return;

    // Check if view data is ready (for real custom views, wait for query to finish)
    const viewDataReady = !hasActiveView ||
      (activeViewQuery.data !== undefined && !activeViewQuery.isFetching) ||
      activeViewQuery.isError;

    if (!viewDataReady) {
      viewDataReadyPassRef.current = 0;
      return;
    }

    // When view data first becomes ready, the filter/search/sort hooks haven't
    // processed it yet (their useEffects run after render). The rowsQuery key
    // still reflects the OLD view's params, so isFetching may be false and
    // placeholderData makes pages[0] truthy — causing a premature clear.
    // Skip the first pass to let hooks absorb the new effective config.
    // Including rowsQueryKeyFingerprint in deps ensures this effect re-fires
    // when hooks update filterInput/searchQuery (advancing passRef past 1).
    viewDataReadyPassRef.current += 1;
    if (viewDataReadyPassRef.current < 2) return;

    // Check if rows data is ready - must have real data (not placeholder from
    // previous query key) and not be actively fetching.
    const rowsDataReady =
      (rowsQuery.data?.pages?.[0] !== undefined &&
        !rowsQuery.isFetching &&
        !rowsQuery.isPlaceholderData) ||
      rowsQuery.isError;

    if (rowsDataReady) {
      setIsViewSwitching(false);
    }
  }, [
    isViewSwitching,
    hasActiveView,
    createViewMutation.isPending,
    activeViewQuery.data,
    activeViewQuery.isFetching,
    activeViewQuery.isError,
    rowsQuery.data?.pages,
    rowsQuery.isFetching,
    rowsQuery.isError,
    rowsQuery.isPlaceholderData,
    rowsQueryKeyFingerprint,
  ]);

  // Fallback: clear loading state if stuck, but only when data is actually ready.
  // Uses refs so the interval callback always reads current state.
  const viewSwitchDataReadyRef = useRef(false);
  viewSwitchDataReadyRef.current =
    !rowsQuery.isFetching && !rowsQuery.isPlaceholderData &&
    rowsQuery.data?.pages?.[0] !== undefined;
  const activeViewIdRef = useRef(activeViewId);
  activeViewIdRef.current = activeViewId;
  const createViewPendingRef = useRef(false);
  createViewPendingRef.current = createViewMutation.isPending;
  useEffect(() => {
    if (!isViewSwitching) return;

    // Poll every 200ms; only clear when data is genuinely ready.
    // Hard cap at 5s to never leave the user stuck.
    const start = Date.now();
    const interval = setInterval(() => {
      const isHardCap = Date.now() - start > 5000;
      // Don't clear prematurely during view creation: wait until the mutation
      // completes and activeViewId moves past "pending-view", matching the
      // guards in the main clearing effect (line ~697).
      if (!isHardCap && (activeViewIdRef.current === "pending-view" || createViewPendingRef.current)) {
        return;
      }
      if (viewSwitchDataReadyRef.current || isHardCap) {
        setIsViewSwitching(false);
      }
    }, 200);

    return () => clearInterval(interval);
  }, [isViewSwitching]);

  // Reset view selection when switching tables — read last-viewed from localStorage
  // so the correct view is set immediately without an intermediate null cycle.
  // Skip on initial render since the table selection effect already batches
  // both activeTableId + activeViewId together.
  const prevResetTableIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeTableId) {
      prevResetTableIdRef.current = null;
      setActiveViewId(null);
      return;
    }
    // Skip the first time this table is set — the table selection effect
    // already set the view in the same batch.
    if (prevResetTableIdRef.current === null) {
      prevResetTableIdRef.current = activeTableId;
      return;
    }
    if (prevResetTableIdRef.current === activeTableId) return;
    prevResetTableIdRef.current = activeTableId;
    // Try to restore the last-viewed view for this table
    let restoredViewId: string | null = null;
    try {
      const storedViewId = window.localStorage.getItem(getLastViewedViewKey(activeTableId));
      if (storedViewId && isValidUUID(storedViewId)) {
        restoredViewId = storedViewId;
      }
    } catch { /* ignore */ }
    // Set to the stored view (will be validated by auto-select if it no longer exists)
    // or null to let auto-select pick the first view.
    setActiveViewId(restoredViewId);
  }, [activeTableId]);

  // Views come directly from DB — no more hardcoded default
  const views = [
    ...activeTableViews,
    // Show the pending view in the sidebar immediately during creation
    ...(pendingViewName && !activeTableViews.some((v) => v.name === pendingViewName)
      ? [{ id: "pending-view", name: pendingViewName }]
      : []),
  ];

  // Get active view name (use pending name during creation)
  const activeView = views.find((v) => v.id === activeViewId);
  const activeViewName = pendingViewName ?? activeView?.name ?? "Grid view";

  const addTable = api.base.addTable.useMutation({
    onMutate: async ({ name }) => {
      await utils.base.get.cancel({ baseId });
      const previousData = utils.base.get.getData({ baseId });

      // Generate optimistic ID
      const optimisticId = `temp-${Date.now()}`;
      const tableName = name ?? `Table ${(previousData?.tables.length ?? 0) + 1}`;

      // Optimistically update the cache
      utils.base.get.setData({ baseId }, (old) => {
        if (!old) return old;
        return {
          ...old,
          tables: [
            ...old.tables,
            { id: optimisticId, name: tableName, views: [] },
          ],
        };
      });

      // Set active table and newTableId immediately
      setActiveTableId(optimisticId);
      setNewTableId(optimisticId);

      return { previousData, optimisticId, tableName };
    },
    onSuccess: async (data, _variables, context) => {
      if (!context) return;

      // Replace optimistic ID with real ID (preserve any views that may have loaded)
      utils.base.get.setData({ baseId }, (old) => {
        if (!old) return old;
        return {
          ...old,
          tables: old.tables.map((table) =>
            table.id === context.optimisticId
              ? { id: data.id, name: data.name, views: table.views }
              : table
          ),
        };
      });

      // Update active table ID to real ID
      setActiveTableId(data.id);
      setNewTableId(data.id);

      // Prefetch new table's meta and rows in parallel with the base invalidation
      void utils.base.getTableMeta.prefetch({ tableId: data.id }, { staleTime: 30_000 });
      void utils.base.getRows.prefetchInfinite(
        { tableId: data.id, limit: PAGE_ROWS },
        { staleTime: 30_000 }
      );
      await utils.base.get.invalidate({ baseId });
    },
    onError: (_error, _variables, context) => {
      if (context?.previousData) {
        utils.base.get.setData({ baseId }, context.previousData);
      }
      setActiveTableId(null);
      setNewTableId(null);
    },
  });


  const renameTable = api.base.renameTable.useMutation({
    onMutate: async ({ tableId, name }) => {
      await utils.base.get.cancel({ baseId });
      const previousData = utils.base.get.getData({ baseId });

      // Optimistically update the table name
      utils.base.get.setData({ baseId }, (old) => {
        if (!old) return old;
        return {
          ...old,
          tables: old.tables.map((table) =>
            table.id === tableId ? { ...table, name } : table
          ),
        };
      });

      return { previousData };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousData) {
        utils.base.get.setData({ baseId }, context.previousData);
      }
    },
    onSettled: async () => {
      await utils.base.get.invalidate({ baseId });
    },
  });

  const addColumn = api.base.addColumn.useMutation({
    onMutate: async ({ tableId, name, id, type }) => {
      if (!activeTableId || tableId !== activeTableId || !id) {
        return { tableId, columnId: id ?? null, skipped: true };
      }
      await utils.base.getTableMeta.cancel({ tableId });
      const columnName = name ?? "Column";
      const columnType = type ?? "single_line_text";
      utils.base.getTableMeta.setData({ tableId }, (current) => {
        if (!current) return current;
        return {
          ...current,
          columns: [
            ...current.columns,
            { id, name: columnName, type: columnType },
          ],
        };
      });
      return { tableId, columnId: id, skipped: false };
    },
    onError: (_error, _variables, context) => {
      if (!context?.tableId || !context.columnId || context.skipped) return;
      utils.base.getTableMeta.setData({ tableId: context.tableId }, (current) => {
        if (!current) return current;
        return {
          ...current,
          columns: current.columns.filter((column) => column.id !== context.columnId),
        };
      });
    },
    onSuccess: async (_data, variables) => {
      if (variables.id) return;
      await utils.base.getTableMeta.invalidate({ tableId: variables.tableId });
    },
  });

  const setTableSearch = api.base.setTableSearch.useMutation({
    onMutate: async ({ tableId, search }) => {
      await utils.base.getTableMeta.cancel({ tableId });
      const previous = utils.base.getTableMeta.getData({ tableId });
      const nextSearch = search ?? "";
      utils.base.getTableMeta.setData({ tableId }, (current) => {
        if (!current) return current;
        return {
          ...current,
          searchQuery: nextSearch,
        };
      });
      return { previous, tableId };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        utils.base.getTableMeta.setData(
          { tableId: context.tableId },
          context.previous
        );
      }
    },
    onSettled: async (_data, _error, variables) => {
      await utils.base.getTableMeta.invalidate({ tableId: variables.tableId });
    },
  });

  // Use a ref for effectiveSearchQuery so the persistence effect only fires
  // when searchQuery (debounced user input) changes, NOT when effectiveSearchQuery
  // changes from a view load (which would cause a race that wipes saved search).
  const effectiveSearchRef = useRef(effectiveSearchQuery);
  effectiveSearchRef.current = effectiveSearchQuery;

  // Assign the flush function now that setTableSearch and effectiveSearchRef exist.
  // Uses inline-updated values so handleSelectView always sees the latest state.
  flushPendingSearchRef.current = () => {
    if (!activeTableId) return;
    const currentSearch = searchValue.trim();
    if (currentSearch === effectiveSearchRef.current) return;
    if (hasActiveView && activeViewId) {
      updateViewMutation.mutate({ viewId: activeViewId, searchQuery: currentSearch });
    }
  };

  // Assign the flush function for pending filter changes.
  // Compares current filter state against the last-known effective config to detect unsaved changes.
  const effectiveFilterRef = useRef(effectiveFilterConfig);
  effectiveFilterRef.current = effectiveFilterConfig;

  flushPendingFilterRef.current = () => {
    if (!activeTableId) return;
    const currentConfig =
      filterItems.length > 0
        ? { connector: filterConnector, items: filterItems }
        : null;
    const currentSerialized = JSON.stringify(currentConfig);
    const effectiveSerialized = JSON.stringify(effectiveFilterRef.current);
    if (currentSerialized === effectiveSerialized) return;
    if (hasActiveView && activeViewId) {
      updateViewMutation.mutate({ viewId: activeViewId, filterConfig: currentConfig });
    }
  };

  useEffect(() => {
    if (!activeTableId) return;
    // During view transitions, skip persisting to avoid saving old search to new view
    if (isViewSwitching) return;
    if (searchQuery === effectiveSearchRef.current) return;
    const timeout = window.setTimeout(() => {
      // Use the flush ref which always reads the latest activeTableId, viewId,
      // and searchValue — this avoids stale closures and race conditions when
      // the table or view changes between scheduling and firing.
      flushPendingSearchRef.current();
    }, 250);
    return () => window.clearTimeout(timeout);
    // Only re-run when the debounced search query changes, when the active
    // table changes (to cancel the old timeout), or when view-switching state
    // changes.  Mutation objects (setTableSearch, updateViewMutation) are
    // intentionally excluded — their references change on every mutation state
    // change which would reset the timeout and prevent persistence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTableId, isViewSwitching, searchQuery]);

  const setHiddenColumns = api.base.setHiddenColumns.useMutation({
    onMutate: async ({ tableId, hiddenColumnIds }) => {
      await utils.base.getTableMeta.cancel({ tableId });
      const previous = utils.base.getTableMeta.getData({ tableId });
      utils.base.getTableMeta.setData({ tableId }, (current) => {
        if (!current) return current;
        const normalizedHidden = Array.from(new Set(hiddenColumnIds));
        const nextSort = (current.sort ?? []).filter(
          (item) => !normalizedHidden.includes(item.columnId)
        );
        return {
          ...current,
          hiddenColumnIds: normalizedHidden,
          sort: nextSort.length > 0 ? nextSort : null,
        };
      });
      return { previous, tableId };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        utils.base.getTableMeta.setData(
          { tableId: context.tableId },
          context.previous
        );
      }
    },
    onSettled: async (_data, _error, variables) => {
      resetSparseCache();
      await utils.base.getTableMeta.invalidate({ tableId: variables.tableId });
      await utils.base.getRows.invalidate(getRowsQueryKey(variables.tableId));
    },
  });


  const updateCell = api.base.updateCell.useMutation({
    onMutate: async ({ rowId, columnId, value }) => {
      if (!activeTableId) return { previous: null, queryKey: null };
      const queryKey = getRowsQueryKey(activeTableId);
      await utils.base.getRows.cancel(queryKey);
      const previous = utils.base.getRows.getInfiniteData(queryKey);
      utils.base.getRows.setInfiniteData(queryKey, (data) => {
        if (!data) return data;
        return {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            rows: page.rows.map((row) =>
              row.id === rowId
                ? {
                    ...row,
                    data: {
                      ...(row.data ?? {}),
                      [columnId]: value,
                    },
                  }
                : row
            ),
          })),
        };
      });
      // Also update sparse page cache if the row lives there
      for (const [pageIdx, pageRows] of sparsePagesRef.current) {
        const rowIdx = pageRows.findIndex((r) => r.id === rowId);
        if (rowIdx >= 0) {
          pageRows[rowIdx]!.data = { ...pageRows[rowIdx]!.data, [columnId]: value };
          // Keep incremental map in sync
          const globalIdx = pageIdx * SPARSE_PAGE_ROWS + rowIdx;
          const existing = sparseRowsMapRef.current.get(globalIdx);
          if (existing) {
            sparseRowsMapRef.current.set(globalIdx, { ...existing, [columnId]: value });
          }
          break;
        }
      }
      return { previous, queryKey, rowId, columnId };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous && context.queryKey) {
        utils.base.getRows.setInfiniteData(context.queryKey, context.previous);
      }
    },
    onSuccess: (_data, variables) => {
      const shouldInvalidateSort =
        sortParam.length > 0 &&
        sortParam.some((sort) => sort.columnId === variables.columnId);
      const shouldInvalidateFilter =
        hasActiveFilters && filteredColumnIds.has(variables.columnId);
      if ((shouldInvalidateSort || shouldInvalidateFilter) && activeTableId) {
        // Clear sparse cache so re-fetches get fresh sorted/filtered data
        resetSparseCache();
        void utils.base.getRows.invalidate(getRowsQueryKey(activeTableId));
      }
    },
  });

  useEffect(() => {
    setActiveTableId(null);
    setEnsuredTableId(null);
    setSelectedCell(null);
    setEditingCell(null);
  }, [baseId]);

  useEffect(() => {
    const tables = baseDetailsQuery.data?.tables ?? [];
    if (!tables.length || preferredTableBaseId !== baseId) return;
    if (activeTableId && tables.some((table) => table.id === activeTableId)) {
      return;
    }
    // Determine which table to select
    let targetTableId: string | null = null;
    if (
      isValidTableId(preferredTableId) &&
      tables.some((table) => table.id === preferredTableId)
    ) {
      targetTableId = preferredTableId;
    } else if (tables[0]) {
      targetTableId = tables[0].id;
    }
    if (!targetTableId) return;

    // Determine the view for this table so both can be set in one render batch
    const targetTable = tables.find((t) => t.id === targetTableId);
    let viewId: string | null = null;
    try {
      const storedViewId = window.localStorage.getItem(getLastViewedViewKey(targetTableId));
      if (storedViewId && isValidUUID(storedViewId) && targetTable?.views.some((v) => v.id === storedViewId)) {
        viewId = storedViewId;
      }
    } catch { /* ignore */ }
    if (!viewId && targetTable?.views[0]) {
      viewId = targetTable.views[0].id;
    }

    // Set both in the same batch — avoids an extra render cycle
    setActiveTableId(targetTableId);
    setActiveViewId(viewId);
  }, [
    activeTableId,
    baseDetailsQuery.data?.tables,
    baseId,
    preferredTableId,
    preferredTableBaseId,
  ]);

  useEffect(() => {
    if (
      !isValidTableId(activeTableId) ||
      preferredTableBaseId !== baseId
    )
      return;
    try {
      window.localStorage.setItem(
        getLastViewedTableKey(baseId),
        activeTableId
      );
    } catch {
      // Ignore storage failures (private mode, blocked storage, etc).
    }
  }, [activeTableId, baseId, preferredTableBaseId]);

  // Persist the last-viewed view per table to localStorage
  useEffect(() => {
    if (!isValidTableId(activeTableId) || !isValidUUID(activeViewId)) return;
    try {
      window.localStorage.setItem(
        getLastViewedViewKey(activeTableId),
        activeViewId
      );
    } catch {
      // Ignore storage failures
    }
  }, [activeViewId, activeTableId]);

  useEffect(() => {
    setCellEdits({});
  }, [activeTableId]);

  useEffect(() => {
    if (!highlightedFilterFieldId && !highlightedFilterOperatorId && !highlightedFilterConnectorKey) return;
    const handleClick = () => {
      setHighlightedFilterFieldId(null);
      setHighlightedFilterOperatorId(null);
      setHighlightedFilterConnectorKey(null);
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [highlightedFilterFieldId, highlightedFilterOperatorId, highlightedFilterConnectorKey]);

  useEffect(() => {
    if (!filterHook.isFilterMenuOpen) return;
    const handleClick = (event: Event) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (filterHook.filterMenuRef.current?.contains(target)) return;
      if (filterHook.filterButtonRef.current?.contains(target)) return;
      filterHook.setIsFilterMenuOpen(false);
      setOpenFilterFieldId(null);
      setOpenFilterOperatorId(null);
      setOpenFilterConnectorId(null);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        filterHook.setIsFilterMenuOpen(false);
        setOpenFilterFieldId(null);
        setOpenFilterOperatorId(null);
        setOpenFilterConnectorId(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("scroll", handleClick, true);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("scroll", handleClick, true);
      document.removeEventListener("keydown", handleKey);
    };
  }, [filterHook]);

  useEffect(() => {
    if (!openFilterFieldId) return;
    const handleClick = (event: Event) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (target instanceof Element) {
        if (target.closest(`[data-filter-field-menu="${openFilterFieldId}"]`)) {
          return;
        }
        if (target.closest(`[data-filter-field-trigger="${openFilterFieldId}"]`)) {
          return;
        }
      }
      setOpenFilterFieldId(null);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenFilterFieldId(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("scroll", handleClick, true);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("scroll", handleClick, true);
      document.removeEventListener("keydown", handleKey);
    };
  }, [openFilterFieldId]);

  useEffect(() => {
    if (!openFilterOperatorId) return;
    const handleClick = (event: Event) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (target instanceof Element) {
        if (target.closest(`[data-filter-operator-menu="${openFilterOperatorId}"]`)) {
          return;
        }
        if (target.closest(`[data-filter-operator-trigger="${openFilterOperatorId}"]`)) {
          return;
        }
      }
      setOpenFilterOperatorId(null);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenFilterOperatorId(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("scroll", handleClick, true);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("scroll", handleClick, true);
      document.removeEventListener("keydown", handleKey);
    };
  }, [openFilterOperatorId]);

  useEffect(() => {
    if (!openFilterConnectorId) return;
    const handleClick = (event: Event) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (target instanceof Element) {
        if (target.closest(`[data-filter-connector-menu="${openFilterConnectorId}"]`)) {
          return;
        }
        if (target.closest(`[data-filter-connector-trigger="${openFilterConnectorId}"]`)) {
          return;
        }
      }
      setOpenFilterConnectorId(null);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenFilterConnectorId(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("scroll", handleClick, true);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("scroll", handleClick, true);
      document.removeEventListener("keydown", handleKey);
    };
  }, [openFilterConnectorId]);

  // Handle click outside for add table dropdown
  useEffect(() => {
    if (!addTableDropdownStage) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (target instanceof Element) {
        if (addTableDropdownRef.current?.contains(target)) return;
        if (addTableButtonRef.current?.contains(target)) return;
      }
      setAddTableDropdownStage(null);
      setTableName("");
      setDropdownPosition(null);
      setNewTableId(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAddTableDropdownStage(null);
        setTableName("");
        setDropdownPosition(null);
        setNewTableId(null);
      } else if (event.key === "Enter" && addTableDropdownStage === "name-input") {
        event.preventDefault();
        setTableName((currentName) => {
          if (currentName.trim() && newTableId && isValidUUID(newTableId)) {
            renameTable.mutate({ tableId: newTableId, name: currentName.trim() });
            setAddTableDropdownStage(null);
            setDropdownPosition(null);
            setNewTableId(null);
            return "";
          }
          return currentName;
        });
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [addTableDropdownStage, addTable, baseId, newTableId, renameTable]);

  // Show naming dropdown when new table is created (immediately, even with optimistic temp ID)
  useEffect(() => {
    if (!newTableId || addTableDropdownStage === "name-input") return;
    // Wait for the table tab to render
    const timer = setTimeout(() => {
      const tabElement = newTableTabRefs.current.get(newTableId);
      if (!tabElement) {
        // Tab not found yet, wait a bit longer
        setTimeout(() => {
          const retryElement = newTableTabRefs.current.get(newTableId);
          if (!retryElement) return;
          positionDropdown(retryElement);
        }, 50);
        return;
      }
      positionDropdown(tabElement);
    }, 0);

    const positionDropdown = (tabElement: HTMLButtonElement) => {
      const tabRect = tabElement.getBoundingClientRect();
      // Position left edge of dropdown 73px to the left of the left edge of the tab, 6px below
      let left = tabRect.left - 73;
      const top = tabRect.bottom + 6;
      const dropdownWidth = 335;

      // Keep within viewport
      if (left + dropdownWidth > window.innerWidth) {
        left = Math.max(0, window.innerWidth - dropdownWidth - 10);
      }
      left = Math.max(0, left);

      setDropdownPosition({ left, top });
      setAddTableDropdownStage("name-input");

      // Focus and select input
      setTimeout(() => {
        if (tableNameInputRef.current) {
          tableNameInputRef.current.select();
        }
      }, 0);
    };

    return () => clearTimeout(timer);
  }, [newTableId, addTableDropdownStage]);

  // Get sort data from hook
  const sortRows = tableSortHook.sortRows;
  const sortedColumnIds = tableSortHook.sortedColumnIds;
  const sortLayout = tableSortHook.sortLayout;

  const [filterDragPreview, setFilterDragPreview] = useState<{
    scope: "root" | "group";
    groupId?: string;
    order: string[];
  } | null>(null);
  const filterRows = useMemo(() => {
    if (!filterDragPreview) return filterItems;
    if (filterDragPreview.scope === "root") {
      const rootItems = filterItems.filter(
        (item): item is FilterConditionItem => item.type === "condition"
      );
      if (rootItems.length !== filterDragPreview.order.length) return filterItems;
      const byId = new Map(rootItems.map((item) => [item.id, item]));
      return filterDragPreview.order
        .map((id) => byId.get(id))
        .filter((item): item is FilterConditionItem => Boolean(item));
    }
    if (filterDragPreview.groupId) {
      return filterItems.map((item) => {
        if (item.type !== "group" || item.id !== filterDragPreview.groupId) {
          return item;
        }
        const byId = new Map(
          item.conditions.map((condition) => [condition.id, condition])
        );
        const nextConditions = filterDragPreview.order
          .map((id) => byId.get(id))
          .filter((condition): condition is FilterConditionItem => Boolean(condition));
        if (nextConditions.length !== item.conditions.length) return item;
        return { ...item, conditions: nextConditions };
      });
    }
    return filterItems;
  }, [filterDragPreview, filterItems]);
  const hasFilterItems = filterHook.hasFilterItems;
  const hasFilterGroups = useMemo(
    () => filterItems.some((item) => item.type === "group"),
    [filterItems]
  );
  const filterDropdownBaseWidth = 332;
  const filterDropdownExpandedWidth = 590;
  const filterDropdownBaseHeight = 166;
  const filterDropdownHeaderLeft = 16;
  const filterDropdownHeaderTop = 14;
  const filterInputLeft = 16;
  const filterInputTop = 41;
  const filterInputHeight = 32;
  const filterInputRadius = 6;
  const filterEmptyMessageTop = 98;
  const filterExpandedMessageTop = 94;
  const filterWhereTop = 131;
  const filterRowLeft = 32;
  const filterRowHeight = 32;
  const filterRowGap = 8;
  const filterRowStride = filterRowHeight + filterRowGap;
  const filterConnectorWidth = 56;
  const filterConnectorHeight = 32;
  const filterConnectorGap = 8;
  const filterFieldLeft = filterConnectorWidth + filterConnectorGap;
  const filterFieldWidth = 456;
  const filterFieldHeight = filterConnectorHeight;
  const filterFieldFontSize = 13;
  const filterFieldTextAlignOffset = 2;
  const filterFirstRowTop =
    filterWhereTop -
    (filterFieldHeight - filterFieldFontSize) / 2 +
    filterFieldTextAlignOffset;
  const filterFieldSeparatorPositions = [125, 250, 390, 422] as const;
  const [
    filterFieldSeparatorFieldLeft,
    filterFieldSeparatorOperatorLeft,
    filterFieldSeparatorValueLeft,
    filterFieldSeparatorActionsLeft,
  ] = filterFieldSeparatorPositions;
  const filterFooterGap = 24;
  const filterFooterHeight = 16;
  const filterBottomPadding = 21;

  // Group-specific constants
  const filterGroupEmptyWidth = 570;
  const filterGroupEmptyHeight = 39;
  const filterGroupPaddingTop = 40;
  const filterGroupPaddingBottom = 8;
  const filterGroupPaddingLeft = 16;
  const filterGroupWhereLeft = 40;
  const filterDropdownGroupWidth = 683;
  const filterGroupNestedWidth = 650;
  const filterGroupConditionFieldWidth = 456;

  // Dynamic width based on group nesting
  const hasGroups = filterItems.some(i => i.type === "group");
  // Check if ANY group (at any level) has child groups
  const hasNestedGroups = useMemo(() => {
    const checkForNestedGroups = (items: FilterItem[]): boolean => {
      for (const item of items) {
        if (item.type === "group") {
          // If this group has any child groups, return true
          if (item.conditions.some(c => c.type === "group")) {
            return true;
          }
          // Recursively check child conditions
          if (checkForNestedGroups(item.conditions)) {
            return true;
          }
        }
      }
      return false;
    };
    return checkForNestedGroups(filterItems);
  }, [filterItems]);
  const filterDropdownWidth = !hasFilterItems
    ? filterDropdownBaseWidth
    : hasNestedGroups ? 762
    : hasGroups ? filterDropdownGroupWidth
    : filterDropdownExpandedWidth;
  const filterInputWidth = filterDropdownWidth - 32;

  const filterLayout = useMemo(() => {
    type LayoutEntry = {
      type: "row";
      condition: FilterConditionItem;
      depth: number;
      parentGroupId?: string;
      grandparentGroupId?: string;
      top: number;
      left: number;
      scope: "root" | "group";
      groupId?: string;
      indexInScope: number;
      showConnector: boolean;
      showConnectorControl: boolean;
      connector: FilterConnector;
      connectorKey: string;
      showRootConnector: boolean;
      showGroupConnector: boolean;
    } | {
      type: "group";
      group: FilterGroupItem;
      isEmpty: boolean;
      depth: number;
      parentGroupId?: string;
      top: number;
      left: number;
      width: number;
      height: number;
      showConnector: boolean;
      showConnectorControl: boolean;
      connectorKey: string;
      connector: FilterConnector;
      firstChildHasRootConnector: boolean;
    };

    const entries: LayoutEntry[] = [];
    const groupMetaMap = new Map<
      string,
      { startTop: number; bottomTop: number; rowCount: number }
    >();

    // Recursive function to process items (conditions and groups)
    const processItems = (
      items: (FilterConditionItem | FilterGroupItem)[],
      depth: number,
      parentGroupId: string | undefined,
      grandparentGroupId: string | undefined,
      currentTop: number,
      leftOffset: number,
      rootIndex: number,
      parentConnector?: FilterConnector
    ): { nextTop: number; nextRootIndex: number } => {
      let top = currentTop;
      let rIndex = rootIndex;

      items.forEach((item, itemIndex) => {
        if (item.type === "condition") {
          // Root condition
          const showRootConnector = rIndex > 0;
          entries.push({
            type: "row",
            condition: item,
            depth,
            parentGroupId,
            grandparentGroupId,
            top,
            left: leftOffset,
            scope: depth === 0 ? "root" : "group",
            groupId: parentGroupId,
            indexInScope: itemIndex,
            showConnector: showRootConnector,
            showConnectorControl: rIndex === 1,
            connector: filterConnector,
            connectorKey: "root",
            showRootConnector,
            showGroupConnector: false,
          });
          top += filterRowStride;
          rIndex += 1;
        } else {
          // Group
          const groupId = item.id;
          const groupStartTop = top;
          const isEmpty = item.conditions.length === 0;
          const groupDepth = depth;

          if (isEmpty) {
            // Empty group - expand to 650px only for root-level groups when ANY group has child groups
            // Child groups (nested groups) always stay at 570px
            const groupWidth = (hasNestedGroups && groupDepth === 0) ? filterGroupNestedWidth : filterGroupEmptyWidth;
            const showRootConnector = rIndex > 0;
            // Align group with condition fields: at leftOffset + filterFieldLeft for all groups
            const groupLeft = leftOffset + filterFieldLeft;

            // Determine connector logic based on depth
            const showConnector = groupDepth === 0 ? showRootConnector : rIndex > 0;
            const showConnectorControl = groupDepth === 0 ? rIndex === 1 : rIndex === 1;
            const connectorKey = groupDepth === 0 ? "root" : `group:${parentGroupId}`;
            const connector = groupDepth === 0 ? filterConnector : (parentConnector ?? "and");

            entries.push({
              type: "group",
              group: item,
              isEmpty: true,
              depth: groupDepth,
              parentGroupId,
              top: groupStartTop,
              left: groupLeft,
              width: groupWidth,
              height: filterGroupEmptyHeight,
              showConnector,
              showConnectorControl,
              connectorKey,
              connector,
              firstChildHasRootConnector: false, // Empty groups have no children
            });
            groupMetaMap.set(groupId, {
              startTop: groupStartTop,
              bottomTop: groupStartTop + filterGroupEmptyHeight,
              rowCount: 0,
            });
            top += filterGroupEmptyHeight + filterRowGap;
            rIndex += 1;
          } else {
            // Populated group - recursively process children
            // Group box aligns with condition fields: at leftOffset + filterFieldLeft for all groups
            // Expand to 650px only for root-level groups when ANY group has child groups
            // Child groups (nested groups) always stay at 570px
            const groupWidth = (hasNestedGroups && groupDepth === 0) ? filterGroupNestedWidth : filterGroupEmptyWidth;
            const groupLeft = leftOffset + filterFieldLeft;
            // Children positioned with 11px offset from group left edge
            // Regular conditions: at groupLeft + 11
            // Nested groups: at groupLeft + 11 + filterFieldLeft (via recursive call) to align with condition fields
            const childLeftOffset = groupLeft + 11;
            // Position first child at same vertical level as "Where" label (at 47px from group top)
            // Adjust for field alignment like at root level
            const whereTopInGroup = 47;
            const childTopOffset = whereTopInGroup - (filterFieldHeight - 13) / 2 + 2;
            let childTop = groupStartTop + childTopOffset;
            let childRootIndex = 0;

            // Track where to insert the group entry (before all its children)
            const groupInsertIndex = entries.length;

            item.conditions.forEach((child, childIndex) => {
              if (child.type === "condition") {
                // First condition: no connector (show "Where" instead)
                // Second condition: show connector button
                // Third+ condition: show connector text
                const isFirstChild = childIndex === 0;
                const isSecondChild = childIndex === 1;
                const showGroupConnector = childIndex > 0;
                const connector = item.connector;
                const connectorKey = `group:${groupId}`;

                entries.push({
                  type: "row",
                  condition: child,
                  depth: groupDepth + 1,
                  parentGroupId: groupId,
                  grandparentGroupId: parentGroupId,
                  top: childTop,
                  left: childLeftOffset,
                  scope: "group",
                  groupId,
                  indexInScope: childIndex,
                  showConnector: showGroupConnector,
                  showConnectorControl: isSecondChild,
                  connector,
                  connectorKey,
                  showRootConnector: false,
                  showGroupConnector,
                });
                childTop += filterRowStride;
                childRootIndex = 0;
              } else {
                // Nested group - needs connector logic like conditions
                const isFirstChild = childIndex === 0;
                const isSecondChild = childIndex === 1;
                const showGroupConnector = childIndex > 0;

                const nestedResult = processItems(
                  [child],
                  groupDepth + 1,
                  groupId,
                  parentGroupId,
                  childTop,
                  childLeftOffset,
                  // Pass childIndex as rootIndex so nested groups get proper connector logic
                  childIndex,
                  // Pass parent group's connector to nested group
                  item.connector
                );
                childTop = nestedResult.nextTop;
                childRootIndex = childIndex + 1;
              }
            });

            // Compute group height based on actual bottom position of children
            const childrenBottomTop = childTop - filterRowGap; // Remove the last gap
            const groupHeight = (childrenBottomTop - groupStartTop) + filterGroupPaddingBottom;

            const showRootConnector = rIndex > 0;

            // Determine connector logic based on depth
            const showConnector = groupDepth === 0 ? showRootConnector : rIndex > 0;
            const showConnectorControl = groupDepth === 0 ? rIndex === 1 : rIndex === 1;
            const connectorKey = groupDepth === 0 ? "root" : `group:${parentGroupId}`;
            const connector = groupDepth === 0 ? filterConnector : (parentConnector ?? "and");

            // Insert group entry before children (at the saved index)
            entries.splice(
              groupInsertIndex,
              0,
              {
                type: "group",
                group: item,
                isEmpty: false,
                depth: groupDepth,
                parentGroupId,
                top: groupStartTop,
                left: groupLeft,
                width: groupWidth,
                height: groupHeight,
                showConnector,
                showConnectorControl,
                connectorKey,
                connector,
                firstChildHasRootConnector: false,
              }
            );

            groupMetaMap.set(groupId, {
              startTop: groupStartTop,
              bottomTop: groupStartTop + groupHeight,
              rowCount: item.conditions.length,
            });

            top = groupStartTop + groupHeight + filterRowGap;
            rIndex += 1;
          }
        }
      });

      return { nextTop: top, nextRootIndex: rIndex };
    };

    // Start processing from root
    processItems(filterRows, 0, undefined, undefined, filterFirstRowTop, filterRowLeft, 0, undefined);

    const contentBottom = entries.length > 0
      ? Math.max(...entries.map(e => e.top + (e.type === "row" ? filterRowHeight : e.height)))
      : filterWhereTop;

    return {
      entries,
      contentBottom,
      groupMetaMap,
    };
  }, [filterConnector, filterRows, filterGroupEmptyWidth, filterGroupEmptyHeight, filterGroupPaddingTop, filterGroupPaddingBottom, filterGroupPaddingLeft, filterGroupNestedWidth, filterRowLeft, filterFieldLeft, filterFirstRowTop, filterRowStride, filterRowGap, filterRowHeight, filterWhereTop, hasNestedGroups]);

  const filterFooterTop = hasFilterItems
    ? filterLayout.contentBottom + filterFooterGap
    : 132;
  const filterDropdownHeight = hasFilterItems
    ? filterFooterTop + filterFooterHeight + filterBottomPadding
    : filterDropdownBaseHeight;
  const filterFieldMenuWidth = 204;
  const filterFieldMenuMaxHeight = 277;
  const filterFieldMenuTopPadding = 20;
  const filterFieldMenuHeaderLeft = 20;
  const filterFieldMenuHeaderHeight = 13;
  const filterFieldMenuTextHeight = 13;
  const filterFieldMenuTextGap = 20; // 20px vertical distance between text lines
  const filterFieldMenuRowStride = filterFieldMenuTextHeight + filterFieldMenuTextGap; // 13 + 20 = 33px between text tops
  const filterFieldMenuRowHeight = 34; // Height of the hover box (visual only)
  const filterFieldMenuRowGap = 0;
  const filterFieldMenuHeaderGap = filterFieldMenuTextGap; // Same 20px gap from header to first item
  const filterFieldMenuBottomPadding = 20;
  const filterOperatorMenuBottomPadding = 0;
  const filterFieldMenuItemLeft = 12;
  const filterFieldMenuItemWidth = 172;
  const filterFieldMenuLabelLeft = 40;
  const filterFieldMenuHoverPadding = (filterFieldMenuRowHeight - filterFieldMenuTextHeight) / 2; // Extra space for hover box
  const filterFieldMenuFirstRowTop =
    filterFieldMenuTopPadding + filterFieldMenuHeaderHeight + filterFieldMenuHeaderGap;
  const filterFieldMenuContentHeight =
    filterFieldMenuFirstRowTop +
    (orderedColumns.length > 0
      ? (orderedColumns.length - 1) * filterFieldMenuRowStride +
        filterFieldMenuTextHeight
      : 0) +
    filterFieldMenuBottomPadding;
  const filterFieldMenuHeight = Math.min(
    filterFieldMenuMaxHeight,
    filterFieldMenuContentHeight
  );
  const filterFieldMenuListHeight = Math.max(
    0,
    filterFieldMenuHeight - filterFieldMenuFirstRowTop
  );
  const filterOperatorMenuWidth = 186;
  const filterOperatorMenuMaxHeight = 260;
  const filterOperatorMenuTextHeight = 13;
  const filterOperatorMenuTextGap = 20; // 20px vertical distance between text lines
  const filterOperatorMenuRowStride = filterOperatorMenuTextHeight + filterOperatorMenuTextGap; // 13 + 20 = 33px
  const filterOperatorMenuRowHeight = 34; // Height of the hover box (visual only)
  const filterOperatorMenuRowGap = 0;
  const filterOperatorMenuItemWidth = 162;
  const filterOperatorMenuItemLeft = 12;
  const filterOperatorMenuHoverPadding = (filterOperatorMenuRowHeight - filterOperatorMenuTextHeight) / 2;
  const filterOperatorMenuFirstRowTop =
    filterFieldMenuTopPadding + filterFieldMenuHeaderHeight + filterFieldMenuHeaderGap;

  const updateFilterCondition = useCallback(
    (
      conditionId: string,
      updater: (condition: FilterConditionItem) => FilterConditionItem,
      groupId?: string,
      parentGroupId?: string
    ) => {
      setFilterItems((prev) =>
        prev.map((item) => {
          if (parentGroupId) {
            // Nested group case (depth 2)
            if (item.type !== "group" || item.id !== parentGroupId) return item;
            return {
              ...item,
              conditions: item.conditions.map((child) => {
                if (child.type !== "group" || child.id !== groupId) return child;
                return {
                  ...child,
                  conditions: child.conditions.map((grandchild) =>
                    grandchild.type === "condition" && grandchild.id === conditionId
                      ? updater(grandchild)
                      : grandchild
                  ),
                };
              }),
            };
          }
          if (groupId) {
            // Root group case (depth 1)
            if (item.type !== "group" || item.id !== groupId) return item;
            return {
              ...item,
              conditions: item.conditions.map((child) =>
                child.type === "condition" && child.id === conditionId ? updater(child) : child
              ),
            };
          }
          // Root condition case
          if (item.type !== "condition") return item;
          return item.id === conditionId ? updater(item) : item;
        })
      );
    },
    []
  );

  const getDefaultFilterCondition = useCallback(() => {
    const defaultColumn = orderedColumns[0];
    if (!defaultColumn) return createFilterCondition();
    const columnType = coerceColumnType(defaultColumn.type);
    return createFilterCondition(defaultColumn.id, columnType);
  }, [orderedColumns]);

  const addFilterCondition = useCallback(() => {
    const defaultColumn = orderedColumns[0];
    filterHook.addFilterCondition(defaultColumn?.id ?? null);
    setActiveFilterAdd("condition");
  }, [filterHook, orderedColumns]);

  const addFilterGroup = useCallback(() => {
    filterHook.addFilterGroup();
    setActiveFilterAdd("group");
  }, [filterHook]);

  const addFilterConditionToGroup = useCallback(
    (groupId: string, parentGroupId?: string) => {
      setFilterItems((prev) => {
        if (!parentGroupId) {
          // Add to root-level group
          return prev.map((item) => {
            if (item.type !== "group" || item.id !== groupId) return item;
            return {
              ...item,
              conditions: [...item.conditions, getDefaultFilterCondition()],
            };
          });
        } else {
          // Add to nested group
          return prev.map((item) => {
            if (item.type !== "group" || item.id !== parentGroupId) return item;
            return {
              ...item,
              conditions: item.conditions.map((child) => {
                if (child.type !== "group" || child.id !== groupId) return child;
                return {
                  ...child,
                  conditions: [...child.conditions, getDefaultFilterCondition()],
                };
              }),
            };
          });
        }
      });
      setOpenGroupPlusId(null);
    },
    [getDefaultFilterCondition]
  );

  const addFilterGroupToGroup = useCallback((parentGroupId: string, grandparentGroupId?: string) => {
    setFilterItems((prev) => {
      if (!grandparentGroupId) {
        // Add to root-level group
        return prev.map((item) => {
          if (item.type !== "group" || item.id !== parentGroupId) return item;
          return {
            ...item,
            conditions: [...item.conditions, createFilterGroup()],
          };
        });
      } else {
        // Add to nested group
        return prev.map((item) => {
          if (item.type !== "group" || item.id !== grandparentGroupId) return item;
          return {
            ...item,
            conditions: item.conditions.map((child) => {
              if (child.type !== "group" || child.id !== parentGroupId) return child;
              return {
                ...child,
                conditions: [...child.conditions, createFilterGroup()],
              };
            }),
          };
        });
      }
    });
    setOpenGroupPlusId(null);
  }, []);

  const deleteFilterGroup = useCallback((groupId: string, parentGroupId?: string) => {
    setFilterItems((prev) => {
      if (!parentGroupId) {
        // Delete root-level group
        return prev.filter((item) => item.type !== "group" || item.id !== groupId);
      } else {
        // Delete nested group
        return prev.map((item) => {
          if (item.type !== "group" || item.id !== parentGroupId) return item;
          return {
            ...item,
            conditions: item.conditions.filter(
              (child) => child.type !== "group" || child.id !== groupId
            ),
          };
        });
      }
    });
  }, []);

  const setGroupConnector = useCallback(
    (groupId: string, connector: FilterConnector, parentGroupId?: string) => {
      setFilterItems((prev) => {
        if (!parentGroupId) {
          // Update root-level group
          return prev.map((item) => {
            if (item.type !== "group" || item.id !== groupId) return item;
            return { ...item, connector };
          });
        } else {
          // Update nested group
          return prev.map((item) => {
            if (item.type !== "group" || item.id !== parentGroupId) return item;
            return {
              ...item,
              conditions: item.conditions.map((child) => {
                if (child.type !== "group" || child.id !== groupId) return child;
                return { ...child, connector };
              }),
            };
          });
        }
      });
      setHighlightedFilterConnectorKey(`group:${groupId}`);
      setHighlightedFilterFieldId(null);
      setHighlightedFilterOperatorId(null);
    },
    []
  );

  const handleFilterFieldSelect = useCallback(
    (conditionId: string, columnId: string, groupId?: string, parentGroupId?: string) => {
      const column = columnById.get(columnId);
      const columnType = coerceColumnType(column?.type);
      updateFilterCondition(
        conditionId,
        (condition) => {
          const allowedOperators = getFilterOperatorsForType(columnType);
          const nextOperator = allowedOperators.includes(condition.operator)
            ? condition.operator
            : getDefaultFilterOperator(columnType);
          return {
            ...condition,
            columnId,
            operator: nextOperator,
          };
        },
        groupId,
        parentGroupId
      );
      setOpenFilterFieldId(null);
      setOpenFilterOperatorId(null);
      setHighlightedFilterFieldId(conditionId);
      setHighlightedFilterOperatorId(null);
    },
    [columnById, updateFilterCondition]
  );

  const handleFilterOperatorSelect = useCallback(
    (conditionId: string, operator: FilterOperator, groupId?: string, parentGroupId?: string) => {
      const requiresValue = FILTER_OPERATOR_REQUIRES_VALUE.has(operator);
      updateFilterCondition(
        conditionId,
        (condition) => ({
          ...condition,
          operator,
          ...(requiresValue ? {} : { value: "" }),
        }),
        groupId,
        parentGroupId
      );
      setOpenFilterOperatorId(null);
      setHighlightedFilterOperatorId(conditionId);
      setHighlightedFilterFieldId(null);
    },
    [updateFilterCondition]
  );

  const handleFilterValueChange = useCallback(
    (conditionId: string, value: string, groupId?: string, parentGroupId?: string) => {
      let isValid = true;
      const columnId = (() => {
        if (parentGroupId) {
          // Nested group case (depth 2)
          const parentGroup = filterItems.find(
            (item): item is FilterGroupItem => item.type === "group" && item.id === parentGroupId
          );
          const nestedGroup = parentGroup?.conditions.find(
            (item): item is FilterGroupItem => item.type === "group" && item.id === groupId
          );
          const condition = nestedGroup?.conditions.find(
            (item): item is FilterConditionItem => item.type === "condition" && item.id === conditionId
          );
          return condition?.columnId ?? null;
        }
        if (!groupId) {
          // Root condition case
          const condition = filterItems.find(
            (item): item is FilterConditionItem =>
              item.type === "condition" && item.id === conditionId
          );
          return condition?.columnId ?? null;
        }
        // Root group case (depth 1)
        const group = filterItems.find(
          (item): item is FilterGroupItem => item.type === "group" && item.id === groupId
        );
        const condition = group?.conditions.find(
          (item): item is FilterConditionItem => item.type === "condition" && item.id === conditionId
        );
        return condition?.columnId ?? null;
      })();
      const columnType = columnId
        ? coerceColumnType(columnById.get(columnId)?.type)
        : "single_line_text";
      if (columnType === "number" && !isValidNumberDraft(value)) {
        isValid = false;
      }
      setFilterValueErrorId(isValid ? null : conditionId);
      if (!isValid) return;
      updateFilterCondition(
        conditionId,
        (condition) => ({ ...condition, value }),
        groupId,
        parentGroupId
      );
    },
    [columnById, filterItems, updateFilterCondition]
  );

  useEffect(() => {
    hydratedFilterTableIdRef.current = null;
    filterHook.setFilterItems([]);
    filterHook.setFilterConnector("and");
    setActiveFilterAdd(null);
    filterHook.setIsFilterMenuOpen(false);
    setOpenFilterFieldId(null);
    setOpenFilterOperatorId(null);
    setOpenFilterConnectorId(null);
    setFocusedFilterValueId(null);
    setFilterValueErrorId(null);
  }, [activeTableId]);

  useEffect(() => {
    if (!activeTableId) return;
    if (!tableMetaQuery.data) return;
    if (hydratedFilterTableIdRef.current === activeTableId) return;

    const parseCondition = (value: unknown): FilterConditionItem | null => {
      if (!value || typeof value !== "object") return null;
      const condition = value as Partial<FilterConditionItem>;
      const columnId = typeof condition.columnId === "string" ? condition.columnId : null;
      if (!columnId || hiddenColumnIdSet.has(columnId)) return null;
      const column = columnById.get(columnId);
      if (!column) return null;
      const columnType = coerceColumnType(column.type);
      const operatorValue = condition.operator;
      if (typeof operatorValue !== "string") return null;
      if (!(operatorValue in FILTER_OPERATOR_LABELS)) return null;
      const operator = operatorValue as FilterOperator;
      if (!getFilterOperatorsForType(columnType).includes(operator)) return null;
      return {
        id:
          typeof condition.id === "string" && condition.id.length > 0
            ? condition.id
            : crypto.randomUUID(),
        type: "condition",
        columnId,
        operator,
        value: typeof condition.value === "string" ? condition.value : "",
      };
    };

    let nextConnector: FilterConnector = "and";
    let nextItems: FilterItem[] = [];

    try {
      const raw = window.localStorage.getItem(
        getTableFilterStateKey(baseId, activeTableId)
      );
      if (raw) {
        const parsed = JSON.parse(raw) as {
          connector?: unknown;
          items?: unknown;
        };
        if (parsed.connector === "and" || parsed.connector === "or") {
          nextConnector = parsed.connector;
        }
        // Recursive function to parse groups and nested groups
        const parseGroup = (value: unknown): FilterGroupItem | null => {
          if (!value || typeof value !== "object") return null;
          const rawGroup = value as {
            id?: unknown;
            type?: unknown;
            connector?: unknown;
            conditions?: unknown;
          };
          if (rawGroup.type !== "group" || !Array.isArray(rawGroup.conditions)) {
            return null;
          }

          const conditions: (FilterConditionItem | FilterGroupItem)[] = [];
          rawGroup.conditions.forEach((child) => {
            if (!child || typeof child !== "object") return;
            const rawChild = child as { type?: unknown };

            if (rawChild.type === "condition") {
              const parsed = parseCondition(child);
              if (parsed) conditions.push(parsed);
            } else if (rawChild.type === "group") {
              const parsed = parseGroup(child);
              if (parsed) conditions.push(parsed);
            }
          });

          if (conditions.length === 0) return null;
          const connector: FilterConnector =
            rawGroup.connector === "or" ? "or" : "and";
          return {
            id:
              typeof rawGroup.id === "string" && rawGroup.id.length > 0
                ? rawGroup.id
                : crypto.randomUUID(),
            type: "group",
            connector,
            conditions,
          };
        };

        if (Array.isArray(parsed.items)) {
          nextItems = parsed.items.flatMap<FilterItem>((item) => {
            if (!item || typeof item !== "object") return [];
            const rawItem = item as { type?: unknown };

            if (rawItem.type === "condition") {
              const condition = parseCondition(item);
              return condition ? [condition] : [];
            }
            if (rawItem.type === "group") {
              const group = parseGroup(item);
              return group ? [group] : [];
            }
            return [];
          });
        }
      }
    } catch {
      try {
        window.localStorage.removeItem(getTableFilterStateKey(baseId, activeTableId));
      } catch {
        // Ignore storage errors.
      }
      nextConnector = "and";
      nextItems = [];
    }

    setFilterConnector(nextConnector);
    setFilterItems(nextItems);
    hydratedFilterTableIdRef.current = activeTableId;
  }, [activeTableId, baseId, columnById, hiddenColumnIdSet, tableMetaQuery.data]);

  useEffect(() => {
    if (!activeTableId) return;
    if (hydratedFilterTableIdRef.current !== activeTableId) return;
    const storageKey = getTableFilterStateKey(baseId, activeTableId);
    try {
      if (filterItems.length === 0 && filterConnector === "and") {
        window.localStorage.removeItem(storageKey);
        return;
      }
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          version: 1,
          connector: filterConnector,
          items: filterItems,
        })
      );
    } catch {
      // Ignore storage errors.
    }
  }, [activeTableId, baseId, filterConnector, filterItems]);

  useEffect(() => {
    if (hiddenColumnIdSet.size === 0) return;
    setFilterItems((prev) => {
      let changed = false;

      // Recursive function to filter conditions and nested groups
      const filterItem = (item: FilterItem): FilterItem | null => {
        if (item.type === "condition") {
          if (item.columnId && hiddenColumnIdSet.has(item.columnId)) {
            changed = true;
            return null;
          }
          return item;
        }

        // Filter group's conditions recursively
        const nextConditions: (FilterConditionItem | FilterGroupItem)[] = [];
        item.conditions.forEach((child) => {
          const filtered = filterItem(child);
          if (filtered) {
            nextConditions.push(filtered);
          }
        });

        if (nextConditions.length !== item.conditions.length) {
          changed = true;
        }

        if (nextConditions.length === 0) {
          changed = true;
          return null; // Remove empty groups
        }

        if (nextConditions.length === item.conditions.length) {
          return item; // No changes in this group
        }

        return { ...item, conditions: nextConditions };
      };

      const next: FilterItem[] = [];
      prev.forEach((item) => {
        const filtered = filterItem(item);
        if (filtered) {
          next.push(filtered);
        }
      });

      return changed ? next : prev;
    });
  }, [hiddenColumnIdSet]);

  useEffect(() => {
    if (!activeColumns.length || !activeTableId) return;
    if (ensuredTableId === activeTableId) return;
    const missing = REQUIRED_COLUMNS.filter(
      (name) => !activeColumns.some((column) => column.name === name)
    );
    if (missing.length === 0) {
      setEnsuredTableId(activeTableId);
      return;
    }
    missing.forEach((name) => {
      addColumn.mutate({
        tableId: activeTableId,
        name,
        id: crypto.randomUUID(),
      });
    });
    setEnsuredTableId(activeTableId);
  }, [activeColumns, activeTableId, addColumn, ensuredTableId]);

  useEffect(() => {
    if (!activeColumns.length) return;
    setColumnWidths((prev) => {
      const next = { ...prev };
      activeColumns.forEach((column) => {
        if (!next[column.id]) {
          next[column.id] = DEFAULT_COLUMN_WIDTH;
        }
      });
      Object.keys(next).forEach((columnId) => {
        if (!activeColumns.some((column) => column.id === columnId)) {
          delete next[columnId];
        }
      });
      return next;
    });
  }, [activeColumns]);

  useEffect(() => {
    if (!resizing) return;
    const handleMove = (event: MouseEvent) => {
      const delta = event.clientX - resizing.startX;
      const nextWidth = Math.min(
        MAX_COLUMN_WIDTH,
        Math.max(MIN_COLUMN_WIDTH, resizing.startWidth + delta)
      );
      setColumnWidths((prev) => ({
        ...prev,
        [resizing.columnId]: nextWidth,
      }));
    };
    const handleUp = () => setResizing(null);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [resizing]);

  // ---------------------------------------------------------------------------
  // Merged data pipeline — incremental single-pass transform + dedup + search
  // ---------------------------------------------------------------------------
  // Uses a ref to cache already-processed pages.  When new pages arrive the
  // memo only iterates the new rows instead of re-scanning the entire dataset.
  // For 100k loaded rows (50 pages) this avoids 100k iterations per page.
  const normalizedSearch = searchQuery.toLowerCase();
  const isSearchLoading = hasSearchQuery && rowsQuery.isFetching && !rowsQuery.isFetchingNextPage;

  // Fingerprint that changes when the result set fundamentally changes (sort/
  // filter/search/table/view switch).  Used to decide whether the incremental
  // cache is still valid or needs a full reprocess.
  const pipelineFingerprint = useMemo(
    () => JSON.stringify({
      t: activeTable?.id ?? null,
      s: sortParam,
      f: filterInput ?? null,
      q: normalizedSearch,
      h: hasSearchQuery,
      af: hasActiveFilters,
    }),
    [activeTable?.id, sortParam, filterInput, normalizedSearch, hasSearchQuery, hasActiveFilters],
  );

  const pipelineCacheRef = useRef<{
    fingerprint: string;
    columnsKey: string;
    pageCount: number;
    data: TableRow[];
    byId: Map<string, TableRow>;
    seen: Set<string>;
    searchMap: Map<string, Set<string>>;
  } | null>(null);

  const { tableData, tableDataById, loadedRowCount, baseSearchMatchesByRow } = useMemo(() => {
    const emptyResult = {
      tableData: [] as TableRow[],
      tableDataById: new Map<string, TableRow>(),
      loadedRowCount: 0,
      baseSearchMatchesByRow: new Map<string, Set<string>>(),
    };
    if (!activeTable) {
      pipelineCacheRef.current = null;
      return emptyResult;
    }

    const searchPages = rowsQuery.data?.pages ?? [];
    const hasSearchResults = searchPages.some(page => page.rows.length > 0);
    const useWithoutSearchQuery = hasSearchQuery && !hasSearchResults && !rowsQuery.isFetching && !hasActiveFilters;
    const pages = useWithoutSearchQuery
      ? (rowsQueryWithoutSearch.data?.pages ?? [])
      : searchPages;

    const columnsKey = orderedColumns.map(c => c.id).join(",");
    const prev = pipelineCacheRef.current;

    // Incremental path: same fingerprint + same columns + pages only grew
    const canIncrement =
      prev !== null &&
      prev.fingerprint === pipelineFingerprint &&
      prev.columnsKey === columnsKey &&
      pages.length >= prev.pageCount &&
      prev.pageCount > 0;

    if (canIncrement && pages.length === prev.pageCount) {
      // No new pages — return cached result (same references)
      return {
        tableData: prev.data,
        tableDataById: prev.byId,
        loadedRowCount: prev.data.length,
        baseSearchMatchesByRow: prev.searchMap,
      };
    }

    // Decide start: incremental from prev.pageCount, or full reprocess
    let data: TableRow[];
    let byId: Map<string, TableRow>;
    let seen: Set<string>;
    let searchMap: Map<string, Set<string>>;
    let startPage: number;

    if (canIncrement) {
      // Clone arrays/maps so we return new references for React diffing
      data = prev.data.slice();
      byId = new Map(prev.byId);
      seen = new Set(prev.seen);
      searchMap = normalizedSearch ? new Map(prev.searchMap) : new Map();
      startPage = prev.pageCount;
    } else {
      data = [];
      byId = new Map();
      seen = new Set();
      searchMap = new Map();
      startPage = 0;
    }

    for (let p = startPage; p < pages.length; p++) {
      const page = pages[p]!;
      for (const row of page.rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        const rawData = row.data ?? {};
        const cells: Record<string, string> = { id: row.id };
        let rowSearchMatches: Set<string> | null = null;
        for (const col of orderedColumns) {
          const val = rawData[col.id] ?? "";
          cells[col.id] = val;
          if (normalizedSearch && String(val).toLowerCase().includes(normalizedSearch)) {
            if (!rowSearchMatches) rowSearchMatches = new Set();
            rowSearchMatches.add(col.id);
          }
        }
        const tableRow = cells as TableRow;
        data.push(tableRow);
        byId.set(row.id, tableRow);
        if (rowSearchMatches) searchMap.set(row.id, rowSearchMatches);
      }
    }

    // Update cache for next incremental pass
    pipelineCacheRef.current = {
      fingerprint: pipelineFingerprint,
      columnsKey,
      pageCount: pages.length,
      data,
      byId,
      seen,
      searchMap,
    };

    return {
      tableData: data,
      tableDataById: byId,
      loadedRowCount: data.length,
      baseSearchMatchesByRow: searchMap,
    };
  }, [activeTable, rowsQuery.data?.pages, rowsQueryWithoutSearch.data?.pages, hasSearchQuery, rowsQuery.isFetching, hasActiveFilters, orderedColumns, normalizedSearch, pipelineFingerprint]);

  // ---------------------------------------------------------------------------
  // Sparse page cache — fetches arbitrary pages by offset for instant scroll
  // ---------------------------------------------------------------------------
  const [sparseVersion, setSparseVersion] = useState(0);

  // Microtask-batched sparse update — coalesces rapid page arrivals into a
  // single re-render without the ~16ms RAF delay.  React 18 already batches
  // state updates within the same microtask, so multiple calls coalesce.
  const scheduleSparseUpdate = useCallback(() => {
    if (sparseRafRef.current) return;
    sparseRafRef.current = 1; // flag: pending
    queueMicrotask(() => {
      sparseRafRef.current = 0;
      setSparseVersion((v) => v + 1);
    });
  }, []);

  // Process a fetched sparse page: store raw data, build TableRow entries
  // in the incremental map, then schedule a batched re-render.
  const processSparsePageResult = useCallback(
    (pageIndex: number, pageRows: { id: string; data: Record<string, string> }[]) => {
      sparsePagesRef.current.set(pageIndex, pageRows);

      // Eagerly transform rows into the incremental map
      const cols = orderedColumnsRef.current;
      const offset = pageIndex * SPARSE_PAGE_ROWS;
      const map = sparseRowsMapRef.current;
      for (let i = 0; i < pageRows.length; i++) {
        const row = pageRows[i]!;
        const data = row.data ?? {};
        const cells: Record<string, string> = { id: row.id };
        for (let c = 0; c < cols.length; c++) {
          const col = cols[c]!;
          cells[col.id] = data[col.id] ?? "";
        }
        map.set(offset + i, cells as TableRow);
      }
      sparseProcessedPagesRef.current.add(pageIndex);

      scheduleSparseUpdate();
    },
    [scheduleSparseUpdate],
  );

  // Clear all sparse caches (called on param changes, bulk ops, etc.)
  const resetSparseCache = useCallback(() => {
    sparseRafRef.current = 0;
    sparsePagesRef.current = new Map();
    sparseFetchingRef.current = new Set();
    sparseRowsMapRef.current = new Map();
    sparseProcessedPagesRef.current = new Set();
    setSparseVersion((v) => v + 1);
  }, []);

  // Derive a stable key for the current query params so we can reset the cache
  // when sort/filter/search changes.
  const sparseParamsKey = useMemo(
    () => JSON.stringify({ tableId: activeTableId, sort: sortParam, filter: filterInput, search: searchQuery }),
    [activeTableId, sortParam, filterInput, searchQuery],
  );

  // Reset sparse cache when query params change
  useEffect(() => {
    if (sparseParamsRef.current !== sparseParamsKey) {
      sparseParamsRef.current = sparseParamsKey;
      resetSparseCache();
    }
  }, [sparseParamsKey, resetSparseCache]);

  // Incremental sparse row map — only process newly arrived pages.
  // The heavy transform work already happened in processSparsePageResult;
  // this effect just purges entries covered by the infinite query.
  // We pass sparseRowsMapRef.current directly (no copy) and use
  // sparseVersion as a separate prop to trigger re-renders in TableView.
  useEffect(() => {
    const map = sparseRowsMapRef.current;
    if (loadedRowCount > 0) {
      for (const idx of map.keys()) {
        if (idx < loadedRowCount) map.delete(idx);
      }
    }
  }, [sparseVersion, loadedRowCount]);

  // Stable reference to the mutable sparse map — no copying needed.
  // TableView uses sparseVersion (passed as a separate prop) to know
  // when to re-read from this map.
  const sparseRows = sparseRowsMapRef.current;

  // Inner fetch executor for sparse pages — separated from the debounce
  // wrapper so it can be called from both the leading and trailing edges.
  const executeSparseRangeFetch = useCallback(
    (startIndex: number, endIndex: number) => {
      if (!isValidTableId(activeTableId)) return;
      sparseLastFetchTimeRef.current = Date.now();

      const effectiveStart = Math.max(startIndex, loadedRowCount);
      const startPage = Math.floor(effectiveStart / SPARSE_PAGE_ROWS);
      const endPage = Math.floor(endIndex / SPARSE_PAGE_ROWS);

      // Track viewport center page for spiral background prefetch
      const midPage = Math.floor((startPage + endPage) / 2);
      viewportPageRef.current = midPage;

      const pagesToFetch: number[] = [];
      for (let p = startPage; p <= endPage; p++) {
        if (!sparsePagesRef.current.has(p) && !sparseFetchingRef.current.has(p)) {
          pagesToFetch.push(p);
        }
      }
      if (pagesToFetch.length === 0) return;

      // Sort pages by proximity to viewport center so tRPC's batch
      // stream returns the visible page results first.
      pagesToFetch.sort((a, b) => Math.abs(a - midPage) - Math.abs(b - midPage));

      pagesToFetch.forEach((p) => sparseFetchingRef.current.add(p));

      // Fire each page fetch independently — rows appear progressively
      for (const pageIndex of pagesToFetch) {
        void (async () => {
          try {
            const result = await utils.base.getRows.fetch({
              tableId: activeTableId,
              limit: SPARSE_PAGE_ROWS,
              cursor: pageIndex * SPARSE_PAGE_ROWS,
              // Always pass sort explicitly (even []) so the server
              // skips the stored-sort fallback and column lookup.
              sort: sortParam,
              ...(filterInput ? { filter: filterInput } : {}),
              ...(hasSearchQuery ? { search: searchQuery } : {}),
            });
            processSparsePageResult(pageIndex, result.rows);
          } catch {
            // Allow retry on next range change
          } finally {
            sparseFetchingRef.current.delete(pageIndex);
          }
        })();
      }
    },
    [activeTableId, loadedRowCount, sortParam, filterInput, hasSearchQuery, searchQuery, utils, processSparsePageResult],
  );

  // Callback for TableView to request data for a visible row range.
  // Uses leading+trailing debounce: fires immediately on the first call,
  // then coalesces rapid subsequent calls (e.g. during scrollbar drag)
  // into a single fetch for the final position after SPARSE_DEBOUNCE_MS.
  const SPARSE_DEBOUNCE_MS = 16;

  const handleVisibleRangeChange = useCallback(
    (startIndex: number, endIndex: number) => {
      if (!isValidTableId(activeTableId)) return;
      if (endIndex < loadedRowCount) return;

      pendingSparseRangeRef.current = { start: startIndex, end: endIndex };

      // Leading edge: fire immediately if enough time has passed since
      // the last fetch.  This ensures the first scroll-to-position has
      // zero added latency.
      const now = Date.now();
      if (now - sparseLastFetchTimeRef.current >= SPARSE_DEBOUNCE_MS) {
        if (sparseFetchTimerRef.current) {
          clearTimeout(sparseFetchTimerRef.current);
          sparseFetchTimerRef.current = null;
        }
        pendingSparseRangeRef.current = null;
        executeSparseRangeFetch(startIndex, endIndex);
        return;
      }

      // Trailing edge: coalesce rapid calls into a delayed fetch so that
      // intermediate scroll positions during a fast drag don't start
      // fetches for pages the user scrolls past immediately.
      if (sparseFetchTimerRef.current) {
        clearTimeout(sparseFetchTimerRef.current);
      }
      sparseFetchTimerRef.current = setTimeout(() => {
        sparseFetchTimerRef.current = null;
        const range = pendingSparseRangeRef.current;
        if (range) {
          pendingSparseRangeRef.current = null;
          executeSparseRangeFetch(range.start, range.end);
        }
      }, SPARSE_DEBOUNCE_MS);
    },
    [activeTableId, loadedRowCount, executeSparseRangeFetch],
  );

  // ---------------------------------------------------------------------------
  // Background progressive pre-fetch — gradually cache ALL sparse pages so
  // scrolling to any position finds data ready immediately.
  //
  // Uses a spiral order starting from the current viewport page outward so
  // nearby pages are cached first.  Batches of 2 with longer pauses leave
  // connection headroom for on-demand fetches which serve the actual viewport.
  //
  // activeRowCount is read from a ref so that changes to it don't restart the
  // entire fetch loop (which would cancel in-flight requests and re-fire them,
  // producing a storm of `base.getRows` queries visible in the console).
  // ---------------------------------------------------------------------------
  const activeRowCountRef = useRef(activeRowCount);
  activeRowCountRef.current = activeRowCount;

  useEffect(() => {
    if (!isValidTableId(activeTableId)) return;

    const state = { cancelled: false };

    const fetchAll = async () => {
      // When sorting is active, each background page fetch triggers a
      // full-table JSONB sort on the server (~200-500ms per call for
      // 100k+ rows).  Use a much longer initial delay so the primary
      // viewport fetch completes first, and smaller batch sizes to
      // avoid saturating the DB with concurrent sort queries.
      const hasSortOrFilter = sortParam.length > 0 || !!filterInput || !!hasSearchQuery;
      const INITIAL_DELAY = hasSortOrFilter ? 500 : 50;
      const BATCH_SIZE = hasSortOrFilter ? 2 : 5;
      const BATCH_PAUSE = hasSortOrFilter ? 100 : 10;

      await new Promise((r) => setTimeout(r, INITIAL_DELAY));
      if (state.cancelled) return;

      const rowCount = activeRowCountRef.current;
      if (rowCount <= 0) return;

      const totalPages = Math.ceil(rowCount / SPARSE_PAGE_ROWS);

      // Build page order spiralling outward from the viewport page.
      // This ensures the most relevant pages (near where the user is
      // looking) are cached before distant ones.
      const centerPage = Math.min(Math.max(0, viewportPageRef.current), totalPages - 1);
      const pageOrder: number[] = [];
      const seen = new Set<number>();
      pageOrder.push(centerPage);
      seen.add(centerPage);
      for (let dist = 1; seen.size < totalPages; dist++) {
        for (const p of [centerPage + dist, centerPage - dist]) {
          if (p >= 0 && p < totalPages && !seen.has(p)) {
            pageOrder.push(p);
            seen.add(p);
          }
        }
      }

      for (let i = 0; i < pageOrder.length && !state.cancelled; i += BATCH_SIZE) {
        // Pause if on-demand fetches are in-flight so they aren't starved
        while (sparseFetchingRef.current.size > 0 && !state.cancelled) {
          await new Promise((r) => setTimeout(r, 10));
        }
        if (state.cancelled) break;

        const batch: Promise<void>[] = [];
        for (let j = 0; j < BATCH_SIZE && i + j < pageOrder.length; j++) {
          const page = pageOrder[i + j]!;
          if (sparsePagesRef.current.has(page) || sparseFetchingRef.current.has(page)) {
            continue;
          }
          sparseFetchingRef.current.add(page);
          batch.push(
            (async () => {
              try {
                const result = await utils.base.getRows.fetch({
                  tableId: activeTableId,
                  limit: SPARSE_PAGE_ROWS,
                  cursor: page * SPARSE_PAGE_ROWS,
                  sort: sortParam,
                  ...(filterInput ? { filter: filterInput } : {}),
                  ...(hasSearchQuery ? { search: searchQuery } : {}),
                });
                if (!state.cancelled) {
                  processSparsePageResult(page, result.rows);
                }
              } catch {
                // Skip — will retry on demand via handleVisibleRangeChange
              } finally {
                sparseFetchingRef.current.delete(page);
              }
            })(),
          );
        }
        if (batch.length > 0) {
          await Promise.all(batch);
        }
        // Pause between batches — longer for sorted queries to avoid
        // saturating the DB with expensive JSONB sort operations.
        if (!state.cancelled) {
          await new Promise((r) => setTimeout(r, BATCH_PAUSE));
        }
      }
    };

    void fetchAll();

    return () => {
      state.cancelled = true;
      // Clean up debounce timer on unmount/dep change
      if (sparseFetchTimerRef.current) {
        clearTimeout(sparseFetchTimerRef.current);
        sparseFetchTimerRef.current = null;
      }
    };
  }, [activeTableId, sortParam, filterInput, hasSearchQuery, searchQuery, utils, processSparsePageResult]);

  // Cheap patch: only reprocesses the few rows with active edits.
  // Returns baseSearchMatchesByRow by reference when cellEdits is empty.
  const searchMatchesByRow = useMemo(() => {
    const editedRowIds = Object.keys(cellEdits);
    if (editedRowIds.length === 0 || !normalizedSearch) return baseSearchMatchesByRow;

    const patched = new Map(baseSearchMatchesByRow);
    for (const rowId of editedRowIds) {
      const rowEdits = cellEdits[rowId];
      if (!rowEdits) continue;
      const row = tableDataById.get(rowId);
      if (!row) continue;

      let rowMatches: Set<string> | null = null;
      for (const column of orderedColumns) {
        const value = rowEdits[column.id] ?? row[column.id] ?? "";
        if (String(value).toLowerCase().includes(normalizedSearch)) {
          if (!rowMatches) rowMatches = new Set<string>();
          rowMatches.add(column.id);
        }
      }
      if (rowMatches && rowMatches.size > 0) {
        patched.set(rowId, rowMatches);
      } else {
        patched.delete(rowId);
      }
    }
    return patched;
  }, [baseSearchMatchesByRow, cellEdits, normalizedSearch, orderedColumns, tableDataById]);

  // Compute which columns have rows that match the search (including column name matches)
  const columnsWithSearchMatches = useMemo(() => {
    if (!hasSearchQuery) return new Set<string>();
    const columnSet = new Set<string>();
    searchMatchesByRow.forEach((columnIds) => {
      columnIds.forEach((columnId) => columnSet.add(columnId));
    });
    // Also match against column names
    for (const column of orderedColumns) {
      if (column.name.toLowerCase().includes(normalizedSearch)) {
        columnSet.add(column.id);
      }
    }
    return columnSet;
  }, [hasSearchQuery, normalizedSearch, orderedColumns, searchMatchesByRow]);

  const showSearchSpinner = isSearchLoading;
  const showNoSearchResults =
    hasSearchQuery &&
    !rowsQuery.isFetching &&
    !rowsQuery.isFetchingNextPage &&
    !rowsQuery.hasNextPage &&
    tableData.length === 0;

  const rowCount = tableData.length;
  const showRowsInitialLoading = rowsQuery.isLoading && rowCount === 0;
  const showRowsError = rowsQuery.isError && rowCount === 0;
  const showRowsEmpty =
    rowCount === 0 &&
    !showRowsInitialLoading &&
    !showRowsError &&
    !rowsQuery.isFetching;
  const rowsErrorMessage =
    rowsQuery.error instanceof Error
      ? rowsQuery.error.message
      : "Try refreshing again.";

  const sortAddVirtualItems = tableSortHook.sortAddVirtualItems;
  const sortAddVirtualizerSize = tableSortHook.sortAddVirtualizerSize;

  // --- Sort/Filter loading synchronization ---
  // Compute display column IDs synchronously so colour highlights render in
  // the same frame as the table data — no extra useEffect render cycle.
  const displaySortedColumnIds = useMemo(
    () => (isViewSwitching ? EMPTY_STRING_SET : sortedColumnIds),
    [isViewSwitching, sortedColumnIds]
  );
  const displayFilteredColumnIds = useMemo(
    () => (isViewSwitching ? EMPTY_STRING_SET : filteredColumnIds),
    [isViewSwitching, filteredColumnIds]
  );

  const [isFunctionTriggered, setIsFunctionTriggered] = useState(false);
  const fetchStartedAfterTriggerRef = useRef(false);

  // Wrap applySorts to set loading flag immediately
  const handleApplySorts = useCallback(
    (sorts: SortConfig[] | null) => {
      setIsFunctionTriggered(true);
      tableSortHook.applySorts(sorts);
    },
    [tableSortHook]
  );

  // Detect filter changes and set loading flag
  const filterInputJson = useMemo(
    () => JSON.stringify(filterInput ?? null),
    [filterInput]
  );
  const prevFilterInputJsonRef = useRef<string>(filterInputJson);
  useEffect(() => {
    if (filterInputJson !== prevFilterInputJsonRef.current) {
      prevFilterInputJsonRef.current = filterInputJson;
      setIsFunctionTriggered(true);
    }
  }, [filterInputJson]);

  // Clear function triggered state after fetch cycle completes
  useEffect(() => {
    if (!isFunctionTriggered) {
      fetchStartedAfterTriggerRef.current = false;
      return;
    }
    if (rowsQuery.isFetching && !rowsQuery.isFetchingNextPage) {
      fetchStartedAfterTriggerRef.current = true;
    }
    if (fetchStartedAfterTriggerRef.current && !rowsQuery.isFetching) {
      setIsFunctionTriggered(false);
      fetchStartedAfterTriggerRef.current = false;
    }
  }, [isFunctionTriggered, rowsQuery.isFetching, rowsQuery.isFetchingNextPage]);

  const filterFieldVirtualizer = useVirtualizer({
    count: orderedColumns.length,
    getScrollElement: () => filterFieldMenuListRef.current,
    estimateSize: () => filterFieldMenuRowStride,
    overscan: 4,
  });

  const filterFieldVirtualItems = filterFieldVirtualizer.getVirtualItems();
  const filterFieldVirtualizerSize =
    filterFieldVirtualizer.getTotalSize();

  const handleAddTable = () => {
    if (!addTableButtonRef.current) return;
    const buttonRect = addTableButtonRef.current.getBoundingClientRect();
    // Position 14px to the left and 18px down from plus.svg
    let left = buttonRect.left - 14;
    const top = buttonRect.bottom + 18;
    // Keep within viewport
    const dropdownWidth = 281;
    if (left + dropdownWidth > window.innerWidth) {
      left = Math.max(0, window.innerWidth - dropdownWidth - 10);
    }
    left = Math.max(0, left);
    setDropdownPosition({ left, top });
    setAddTableDropdownStage("add-options");
  };

  const handleStartFromScratch = () => {
    const tableCount = activeTables.length;
    const defaultName = `Table ${tableCount + 1}`;
    setTableName(defaultName);

    // Close the first dropdown
    setAddTableDropdownStage(null);

    // Create the table immediately with default name
    addTable.mutate({ baseId, name: defaultName });
  };

  const handleConfirmTableName = () => {
    if (!tableName.trim() || !newTableId || !isValidUUID(newTableId)) return;
    // Rename the newly created table
    renameTable.mutate({ tableId: newTableId, name: tableName.trim() });
    setAddTableDropdownStage(null);
    setTableName("");
    setDropdownPosition(null);
    setNewTableId(null);
  };

  const handleCancelTableName = () => {
    setAddTableDropdownStage(null);
    setTableName("");
    setDropdownPosition(null);
    setNewTableId(null);
  };

  const handleSelectTable = (tableId: string) => {
    // Flush pending search save to the CURRENT table before switching
    flushPendingSearchRef.current();
    setActiveTableId(tableId);
    // Prefetch meta + first page of rows for the new table
    if (isValidTableId(tableId)) {
      void utils.base.getTableMeta.prefetch({ tableId }, { staleTime: 30_000 });
      void utils.base.getRows.prefetchInfinite(
        { tableId, limit: PAGE_ROWS },
        { staleTime: 30_000 }
      );
    }
  };

  const handleSignOut = async () => {
    await handleLogout(() => router.refresh());
  };

  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const userDropdownRef = useRef<HTMLDivElement>(null);
  const userIconRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!showUserDropdown) return;
    const handleClickOutside = (event: globalThis.MouseEvent) => {
      if (
        userDropdownRef.current &&
        !userDropdownRef.current.contains(event.target as Node) &&
        userIconRef.current &&
        !userIconRef.current.contains(event.target as Node)
      ) {
        setShowUserDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showUserDropdown]);

  const handleFilterDragStart = (
    event: ReactMouseEvent,
    conditionId: string,
    scope: "root" | "group",
    groupId?: string
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (scope === "root" && hasFilterGroups) return;
    const containerRect = filterHook.filterMenuRef.current?.getBoundingClientRect();
    if (!containerRect) return;
    let list: FilterConditionItem[] = [];
    let listStartTop = filterFirstRowTop;
    if (scope === "root") {
      list = filterItems.filter(
        (item): item is FilterConditionItem => item.type === "condition"
      );
      listStartTop = filterFirstRowTop;
    } else if (groupId) {
      const group = filterItems.find(
        (item): item is FilterGroupItem => item.type === "group" && item.id === groupId
      );
      if (!group) return;
      list = group.conditions.filter(
        (item): item is FilterConditionItem => item.type === "condition"
      );
      listStartTop =
        filterLayout.groupMetaMap.get(groupId)?.startTop ?? filterFirstRowTop;
    }

    if (list.length < 2) return;
    const startIndex = list.findIndex((condition) => condition.id === conditionId);
    if (startIndex < 0) return;
    const startTop = listStartTop + startIndex * filterRowStride;
    const initialOrder = list.map((condition) => condition.id);
    filterDragOffsetRef.current =
      event.clientY - (containerRect.top + startTop);
    filterDragScopeRef.current = {
      scope,
      groupId,
      startIndex,
      listStartTop,
      rowCount: list.length,
      order: initialOrder,
    };
    filterDragIndexRef.current = startIndex;
    setDraggingFilterId(conditionId);
    setDraggingFilterTop(startTop);
    setFilterDragPreview({ scope, groupId, order: initialOrder });
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";

    const handleMove = (moveEvent: MouseEvent) => {
      const ctx = filterDragScopeRef.current;
      if (!ctx) return;
      const maxTop = ctx.listStartTop + filterRowStride * (ctx.rowCount - 1);
      const nextTop = Math.min(
        maxTop,
        Math.max(
          ctx.listStartTop,
          moveEvent.clientY - containerRect.top - filterDragOffsetRef.current
        )
      );
      setDraggingFilterTop(nextTop);
      const targetIndex = Math.min(
        ctx.rowCount - 1,
        Math.max(
          0,
          Math.floor(
            (nextTop - ctx.listStartTop + filterRowHeight / 2) /
              filterRowStride
          )
        )
      );
      const currentIndex = filterDragIndexRef.current;
      if (targetIndex === currentIndex) return;
      const nextOrder = [...ctx.order];
      const [moved] = nextOrder.splice(currentIndex, 1);
      if (!moved) return;
      nextOrder.splice(targetIndex, 0, moved);
      ctx.order = nextOrder;
      filterDragIndexRef.current = targetIndex;
      setFilterDragPreview({
        scope: ctx.scope,
        groupId: ctx.groupId,
        order: nextOrder,
      });
    };

    const handleUp = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      const ctx = filterDragScopeRef.current;
      if (ctx && ctx.rowCount > 1) {
        const finalOrder = ctx.order;
        if (ctx.scope === "root") {
          setFilterItems((prev) => {
            if (prev.some((item) => item.type === "group")) return prev;
            const rootItems = prev.filter(
              (item): item is FilterConditionItem => item.type === "condition"
            );
            if (rootItems.length < 2) return prev;
            const reordered: FilterItem[] = [];
            for (const conditionId of finalOrder) {
              const condition = rootItems.find((c) => c.id === conditionId);
              if (condition) reordered.push(condition);
            }
            return reordered;
          });
        } else if (ctx.groupId) {
          setFilterItems((prev) =>
            prev.map((item) => {
              if (item.type !== "group" || item.id !== ctx.groupId) return item;
              const groupConditions = item.conditions.filter(
                (child): child is FilterConditionItem => child.type === "condition"
              );
              if (groupConditions.length < 2) return item;
              const reordered: (FilterConditionItem | FilterGroupItem)[] = [];
              for (const conditionId of finalOrder) {
                const condition = groupConditions.find((c) => c.id === conditionId);
                if (condition) reordered.push(condition);
              }
              // Add back any nested groups
              for (const child of item.conditions) {
                if (child.type === "group") reordered.push(child);
              }
              return { ...item, conditions: reordered };
            })
          );
        }
      }
      setDraggingFilterId(null);
      setDraggingFilterTop(null);
      filterDragScopeRef.current = null;
      setFilterDragPreview(null);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  };

  const addTableDisabled = activeTables.length >= MAX_TABLES || addTable.isPending;

  // Whether the full-screen table loading overlay is active – used to hide the
  // TableView so no column headers / row numbers bleed through behind the spinner.
  const isTableLoading = !!(activeTableId && (
    ((tableMetaQuery.isLoading || !isValidTableId(activeTableId)) && !activeTable) ||
    showRowsInitialLoading
  ));

  const baseName = baseDetailsQuery.data?.name ?? "Base";
  const userInitial = formatUserInitial(userName);
  const headerLoading =
    (baseDetailsQuery.isLoading && !baseDetailsQuery.data) ||
    (activeTableId !== null &&
      (tableMetaQuery.isLoading || !isValidTableId(activeTableId)) &&
      !activeTable) ||
    showRowsInitialLoading ||
    addColumn.isPending ||
    addRowsIsPending ||
    isFunctionTriggered;

  return (
    <div className={clsx("h-screen overflow-hidden bg-white text-[#1d1f24]", inter.className)}>
      <div className="flex h-screen overflow-hidden">
        <aside className="relative flex w-[56px] flex-shrink-0 flex-col items-center border-r border-[#E5E5E5] bg-white py-4">
          <button
            type="button"
            onClick={() => router.push("/bases")}
            className="cursor-pointer"
            aria-label="Back to bases"
          >
            <LogoIcon
              className="h-[19.74px] w-[22.68px]"
              style={{ filter: "brightness(0) saturate(100%)" }}
            />
          </button>
          <OmniIcon
            className="mt-[25px] h-[28.31px] w-[28.33px]"
          />
          <div className="absolute bottom-4 left-0 right-0 flex flex-col items-center gap-4">
            <HelpIcon className="h-[15px] w-[15px]" />
            <BellIcon className="h-[16px] w-[16px]" />
            <button
              ref={userIconRef}
              type="button"
              onClick={() => setShowUserDropdown((prev) => !prev)}
              className="airtable-circle relative cursor-pointer overflow-hidden"
              aria-label="User menu"
            >
              <svg
                className="absolute inset-0 m-auto h-[29px] w-[29px]"
                width="29"
                height="29"
                viewBox="0 0 29 29"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <circle cx="14.5" cy="14.5" r="14.5" fill="#E8E8E8" />
              </svg>
              <svg
                className="absolute inset-0 m-auto h-[26px] w-[26px]"
                width="26"
                height="26"
                viewBox="0 0 26 26"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <circle cx="13" cy="13" r="13" fill="#DD04A8" />
              </svg>
              <span className="relative text-[13px] text-white">{userInitial}</span>
            </button>
          </div>

          {/* User dropdown */}
          {showUserDropdown && (
            <div
              ref={userDropdownRef}
              className={`${inter.className} airtable-dropdown-surface`}
              style={{
                position: "fixed",
                left: 56 + 7,
                bottom: 16,
                width: 297,
                height: 129,
                backgroundColor: "white",
                borderRadius: 5,
                zIndex: 1000,
              }}
            >
              <span
                style={{
                  position: "absolute",
                  left: 20,
                  top: 21,
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#1D1F24",
                }}
              >
                {userName}
              </span>
              <span
                style={{
                  position: "absolute",
                  left: 20,
                  top: 41,
                  fontSize: 13,
                  fontWeight: 500,
                  color: "#1D1F24",
                }}
              >
                {userEmail}
              </span>
              <div
                style={{
                  position: "absolute",
                  left: 20,
                  top: 76,
                  width: 245,
                  height: 1,
                  backgroundColor: "#F2F2F2",
                }}
              />
              <button
                type="button"
                className="group/logout"
                onClick={handleSignOut}
                style={{
                  position: "absolute",
                  left: 13,
                  top: 84,
                  width: 260,
                  height: 34,
                  background: "transparent",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                  padding: 0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "#F2F2F2";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <LogoutIcon
                  className="absolute group-hover/logout:mix-blend-multiply"
                  style={{
                    left: 20 - 13,
                    top: 94 - 84,
                    width: 16,
                    height: 15,
                    display: "block",
                  }}
                />
                <span
                  style={{
                    position: "absolute",
                    left: 44 - 13,
                    top: 93 - 84,
                    fontSize: 13,
                    fontWeight: 500,
                    color: "#1D1F24",
                  }}
                >
                  Logout
                </span>
              </button>
            </div>
          )}
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <HeaderComponent baseName={baseName} isLoading={headerLoading} />

          <section className="border-t border-[#DEDEDE] bg-white">
            <div className="relative h-[31px] bg-[#FFF0FF]">
              <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-[1] h-px bg-[#E5DAE5]" aria-hidden="true" />
              <div className="flex h-full min-w-0 items-stretch">
                <div className="min-w-0 flex-1 overflow-x-auto">
                  <div
                    className="flex h-full w-max min-w-full items-stretch pr-[12px]"
                    onMouseLeave={() => setHoveredTableTabId(null)}
                  >
                    {activeTables.map((tableItem, index) => {
                      const isActive = tableItem.id === activeTableId;
                      const previousTable = activeTables[index - 1];
                      const nextTable = activeTables[index + 1];
                      const isHovered = hoveredTableTabId === tableItem.id;
                      const previousIsActive = previousTable?.id === activeTableId;
                      const previousIsHovered = previousTable?.id === hoveredTableTabId;
                      const nextIsActive = nextTable?.id === activeTableId;
                      const showLeftDivider =
                        index > 0 &&
                        !isActive &&
                        !previousIsActive &&
                        !isHovered &&
                        !previousIsHovered;
                      return (
                        <div key={tableItem.id} className="flex h-full items-stretch">
                          <span
                            className={clsx(
                              "h-[12px] self-center bg-[#E5DAE5]",
                              index === 0 ? "w-0" : "w-px",
                              showLeftDivider ? "opacity-100" : "opacity-0"
                            )}
                            aria-hidden="true"
                          />
                          <button
                            ref={(el) => {
                              if (el) {
                                newTableTabRefs.current.set(tableItem.id, el);
                              } else {
                                newTableTabRefs.current.delete(tableItem.id);
                              }
                            }}
                            type="button"
                            onClick={() => handleSelectTable(tableItem.id)}
                            onMouseEnter={() => setHoveredTableTabId(tableItem.id)}
                            onMouseLeave={() => setHoveredTableTabId(null)}
                            className={clsx(
                              "relative flex h-[31px] items-start whitespace-nowrap rounded-t-[3px] rounded-b-none px-[12px] pt-[8px] text-[13px] leading-[13px]",
                              isActive
                                ? "airtable-table-tab-active z-[2] bg-white text-[#1D1F24]"
                                : "text-[#595359] hover:bg-[#EBDEEB] hover:text-[#1D1F24]"
                            )}
                            style={
                              isActive
                                ? {
                                    border: "0.5px solid #D7CBD6",
                                    borderBottom: "none",
                                  }
                                : undefined
                            }
                          >
                            {!isActive && isHovered && (
                              <span
                                className={clsx(
                                  "pointer-events-none absolute bottom-0 top-0 rounded-t-[3px] bg-[#EBDEEB]",
                                  previousIsActive ? "-left-[8px] right-0" : "left-0 right-0",
                                  nextIsActive && "left-0 -right-[8px]"
                                )}
                                aria-hidden="true"
                              />
                            )}
                            <span
                              className={clsx(
                                "relative z-[1]",
                                isActive ? "font-medium" : "font-normal"
                              )}
                            >
                              {tableItem.name}
                            </span>
                            {isActive && (
                              <LightArrowIcon
                                className="relative z-[1] ml-[6px] mt-[5px] h-[5.8px] w-[10.02px] mix-blend-multiply"
                              />
                            )}
                          </button>
                        </div>
                      );
                    })}
                    <span
                      className={clsx(
                        "h-[12px] w-px self-center bg-[#E5DAE5]",
                        (hoveredTableTabId === activeTables[activeTables.length - 1]?.id ||
                          activeTableId === activeTables[activeTables.length - 1]?.id) &&
                          "opacity-0"
                      )}
                      aria-hidden="true"
                    />
                    <LightArrowIcon
                      className="ml-[15px] mt-[13px] h-[5.8px] w-[10.02px] flex-shrink-0 mix-blend-multiply"
                    />
                    <button
                      ref={addTableButtonRef}
                      type="button"
                      onClick={handleAddTable}
                      disabled={addTableDisabled}
                      className={clsx(
                        "relative ml-[30px] mt-[10px] h-[12px] w-[12px] flex-shrink-0",
                        addTableDisabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"
                      )}
                      aria-label="Add table"
                    >
                      <PlusIcon className="h-[12px] w-[12px]" />
                    </button>
                    {addTableDropdownStage === "add-options" && dropdownPosition && (
                      <div
                        ref={addTableDropdownRef}
                        className="fixed z-[200]"
                        style={{
                          left: dropdownPosition.left,
                          top: dropdownPosition.top,
                          width: 281,
                          height: 70,
                        }}
                      >
                        <div
                          className="relative h-full w-full rounded-[6px] border-[1px] border-[#DADADA] bg-white shadow-[0_10px_24px_rgba(15,23,42,0.12)]"
                        >
                          <div className={clsx(inter.className, "absolute left-[16px] top-[7px]")}>
                            <p className="text-[11px] font-normal leading-[11px] text-[#616670]">
                              Add a blank table
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={handleStartFromScratch}
                            className="group absolute cursor-pointer"
                            style={{ left: 0, top: 0, width: 281, height: 70 }}
                          >
                            <span className="absolute left-[8px] top-[26px] h-[34px] w-[263px] rounded-[3px] bg-transparent group-hover:bg-[#F2F2F2]" />
                            <span
                              className={clsx(inter.className, "absolute z-10 text-[13px] font-normal leading-[13px] text-[#1D1F24]")}
                              style={{ left: 16, top: 36 }}
                            >
                              Start from scratch
                            </span>
                          </button>
                        </div>
                      </div>
                    )}
                    {addTableDropdownStage === "name-input" && dropdownPosition && (
                      <div
                        ref={addTableDropdownRef}
                        className="fixed z-[200]"
                        style={{
                          left: dropdownPosition.left,
                          top: dropdownPosition.top,
                          width: 335,
                        }}
                      >
                        <div
                          className="relative rounded-[6px] border-[2px] border-[#E5E5E5]/90 bg-white"
                          style={{ height: 216 }}
                        >
                          {/* Table name input */}
                          <input
                            ref={tableNameInputRef}
                            type="text"
                            value={tableName}
                            onChange={(e) => setTableName(e.target.value)}
                            className={clsx(
                              inter.className,
                              "absolute h-[38px] w-[299px] rounded-[3px] border-[2px] border-[#176EE1] px-[10px] text-[14px] font-normal leading-[14px] text-[#1D1F24] outline-none"
                            )}
                            style={{ left: 18, top: 18 }}
                            placeholder=""
                          />
                          {/* "What should each record be called?" label */}
                          <span
                            className={clsx(inter.className, "absolute text-[14px] font-normal leading-[14px] text-[#55565D]")}
                            style={{ left: 18, top: 72 }}
                          >
                            What should each record be called?
                          </span>
                          {/* help.svg icon 14x14 */}
                          <svg
                            className="absolute"
                            style={{ left: 302, top: 72 }}
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 15 15"
                            fill="none"
                          >
                            <circle cx="7.5" cy="7.5" r="6.5" stroke="#55565D" strokeWidth="1.2" />
                            <path d="M6 5.9C6 4.8 6.9 4.2 7.5 4.2C8.2 4.2 9 4.7 9 5.6C9 6.6 8.2 7 7.8 7.4C7.4 7.7 7.3 8 7.3 8.7V9.1" stroke="#55565D" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                            <circle cx="7.5" cy="11.1" r="0.8" fill="#55565D" />
                          </svg>
                          {/* Record selector rectangle */}
                          <div
                            className="absolute rounded-[6px]"
                            style={{ left: 18, top: 98, width: 299, height: 34, background: "#F6F7FA" }}
                          >
                            <span
                              className={clsx(inter.className, "absolute text-[13px] font-normal leading-[13px] text-[#55565D]")}
                              style={{ left: 8, top: 9 }}
                            >
                              Record
                            </span>
                            {/* Down arrow */}
                            <svg
                              className="absolute"
                              style={{ left: 278, top: 14 }}
                              xmlns="http://www.w3.org/2000/svg"
                              width="10"
                              height="6"
                              viewBox="0 0 10 6"
                              fill="none"
                            >
                              <path d="M1 1L5 5L9 1" stroke="#55565D" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </div>
                          {/* Examples row */}
                          <span
                            className={clsx(inter.className, "absolute text-[11px] font-normal leading-[11px] text-[#55565D]")}
                            style={{ left: 18, top: 142 }}
                          >
                            Examples
                          </span>
                          {/* plus.svg 12x12 */}
                          <svg
                            className="absolute"
                            style={{ left: 78, top: 142 }}
                            xmlns="http://www.w3.org/2000/svg"
                            width="12"
                            height="12"
                            viewBox="0 0 13 13"
                            fill="none"
                          >
                            <rect x="0" y="6" width="13" height="1" rx="0.5" fill="#55565D" />
                            <rect x="6" y="0" width="1" height="13" rx="0.5" fill="#55565D" />
                          </svg>
                          <span
                            className={clsx(inter.className, "absolute text-[11px] font-normal leading-[11px] text-[#55565D]")}
                            style={{ left: 95, top: 142 }}
                          >
                            Add record
                          </span>
                          {/* light-mail.svg 15x12 */}
                          <LightMailIcon
                            className="absolute"
                            style={{ left: 174, top: 142, width: 15, height: 12 }}
                          />
                          <span
                            className={clsx(inter.className, "absolute text-[11px] font-normal leading-[11px] text-[#55565D]")}
                            style={{ left: 194, top: 142 }}
                          >
                            Send records
                          </span>
                          {/* Cancel and Save buttons */}
                          <div className="absolute flex items-center gap-[23px]" style={{ right: 18, bottom: 18 }}>
                            <button
                              type="button"
                              onClick={handleCancelTableName}
                              className={clsx(
                                inter.className,
                                "group relative cursor-pointer text-[13px] font-medium leading-[13px] text-[#1D1F24]"
                              )}
                            >
                              <span className="pointer-events-none absolute left-[-8px] top-[-6px] h-[28px] w-[58px] rounded-[5px] bg-transparent group-hover:bg-[#F2F2F2]" />
                              <span className="relative z-10">Cancel</span>
                            </button>
                            <button
                              type="button"
                              onClick={handleConfirmTableName}
                              disabled={!tableName.trim()}
                              className={clsx(
                                inter.className,
                                "flex h-[28px] w-[46px] cursor-pointer items-center justify-center rounded-[5px] bg-[#176EE1] text-[13px] font-medium leading-[13px] text-white shadow-[0_0_6.5px_rgba(0,0,0,0.0578)] transition-shadow hover:shadow-[0_1px_6.5px_rgba(199,200,201,0.5)] disabled:cursor-not-allowed disabled:opacity-50"
                              )}
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="relative flex h-full flex-shrink-0 pr-[19px]">
                  <button
                    type="button"
                    className="mt-[8px] h-[13px] text-[13px] font-normal leading-[13px] text-[#595359] hover:text-[#1D1F24]"
                  >
                    Tools
                  </button>
                  <LightArrowIcon
                    className="ml-[7px] mt-[13px] h-[5.8px] w-[10.02px] mix-blend-multiply"
                  />
                </div>
              </div>
            </div>

            <div ref={functionContainerRef}>
              <FunctionBar
                viewName={activeViewName}
                activeViewId={activeViewId}
                viewCount={views.length}
                allViewNames={views.map((v) => v.name)}
                onRenameView={handleRenameView}
                onDeleteView={handleDeleteView}
                onDuplicateView={handleDuplicateView}
                bulkRowsDisabled={bulkRowsDisabled}
                handleAddBulkRows={handleAddBulkRows}
                hideFieldsButtonRef={hideFieldsHook.hideFieldsButtonRef}
              hideFieldsMenuRef={hideFieldsHook.hideFieldsMenuRef}
              isHideFieldsMenuOpen={hideFieldsHook.isHideFieldsMenuOpen}
              setIsHideFieldsMenuOpen={hideFieldsHook.setIsHideFieldsMenuOpen}
              hiddenFieldCount={(pendingViewName || isViewSwitching) ? 0 : hideFieldsHook.hiddenFieldCount}
              hiddenColumnIdSet={(pendingViewName || isViewSwitching) ? EMPTY_STRING_SET : hiddenColumnIdSet}
              hideFieldsLayout={hideFieldsHook.hideFieldsLayout}
              toggleHiddenColumn={hideFieldsHook.toggleHiddenColumn}
              hideAllColumns={hideFieldsHook.hideAllColumns}
              showAllColumns={hideFieldsHook.showAllColumns}
              filterButtonRef={filterHook.filterButtonRef}
              isFilterMenuOpen={filterHook.isFilterMenuOpen}
              setIsFilterMenuOpen={filterHook.setIsFilterMenuOpen}
              hasActiveFilters={(pendingViewName || isViewSwitching) ? false : filterHook.hasActiveFilters}
              filteredColumnNames={(pendingViewName || isViewSwitching) ? EMPTY_STRING_ARRAY : filterHook.filteredColumnNames}
              filterMenuRef={filterHook.filterMenuRef}
              filterFieldMenuListRef={filterFieldMenuListRef}
              filterOperatorMenuListRef={filterOperatorMenuListRef}
              filterItems={filterHook.filterItems}
              setFilterItems={filterHook.setFilterItems}
              filterConnector={filterHook.filterConnector}
              setFilterConnector={filterHook.setFilterConnector}
              openFilterFieldId={openFilterFieldId}
              setOpenFilterFieldId={setOpenFilterFieldId}
              openFilterOperatorId={openFilterOperatorId}
              setOpenFilterOperatorId={setOpenFilterOperatorId}
              openFilterConnectorId={openFilterConnectorId}
              setOpenFilterConnectorId={setOpenFilterConnectorId}
              focusedFilterValueId={focusedFilterValueId}
              setFocusedFilterValueId={setFocusedFilterValueId}
              filterValueErrorId={filterValueErrorId}
              setFilterValueErrorId={setFilterValueErrorId}
              draggingFilterId={draggingFilterId}
              draggingFilterTop={draggingFilterTop}
              phantomFilterX={phantomFilterX}
              phantomFilterY={phantomFilterY}
              highlightedFilterFieldId={highlightedFilterFieldId}
              highlightedFilterOperatorId={highlightedFilterOperatorId}
              highlightedFilterConnectorKey={highlightedFilterConnectorKey}
              setHighlightedFilterConnectorKey={setHighlightedFilterConnectorKey}
              setHighlightedFilterFieldId={setHighlightedFilterFieldId}
              setHighlightedFilterOperatorId={setHighlightedFilterOperatorId}
              activeFilterAdd={activeFilterAdd}
              handleFilterFieldSelect={handleFilterFieldSelect}
              handleFilterOperatorSelect={handleFilterOperatorSelect}
              handleFilterValueChange={handleFilterValueChange}
              handleFilterDragStart={handleFilterDragStart}
              addFilterCondition={addFilterCondition}
              addFilterGroup={addFilterGroup}
              addFilterConditionToGroup={addFilterConditionToGroup}
              addFilterGroupToGroup={addFilterGroupToGroup}
              deleteFilterGroup={deleteFilterGroup}
              setGroupConnector={setGroupConnector}
              openGroupPlusId={openGroupPlusId}
              setOpenGroupPlusId={setOpenGroupPlusId}
              draggingGroupId={draggingGroupId}
              filterGroupEmptyWidth={filterGroupEmptyWidth}
              filterGroupEmptyHeight={filterGroupEmptyHeight}
              filterGroupPaddingTop={filterGroupPaddingTop}
              filterGroupPaddingBottom={filterGroupPaddingBottom}
              filterGroupPaddingLeft={filterGroupPaddingLeft}
              filterGroupWhereLeft={filterGroupWhereLeft}
              orderedColumns={orderedColumns}
              columnById={columnById}
              hasFilterItems={hasFilterItems}
              filterLayout={filterLayout}
              filterFooterTop={filterFooterTop}
              filterDropdownWidth={filterDropdownWidth}
              filterDropdownHeight={filterDropdownHeight}
              filterDropdownHeaderLeft={filterDropdownHeaderLeft}
              filterDropdownHeaderTop={filterDropdownHeaderTop}
              filterInputLeft={filterInputLeft}
              filterInputTop={filterInputTop}
              filterInputWidth={filterInputWidth}
              filterInputHeight={filterInputHeight}
              filterInputRadius={filterInputRadius}
              filterEmptyMessageTop={filterEmptyMessageTop}
              filterExpandedMessageTop={filterExpandedMessageTop}
              filterRowLeft={filterRowLeft}
              filterWhereTop={filterWhereTop}
              filterConnectorWidth={filterConnectorWidth}
              filterConnectorHeight={filterConnectorHeight}
              filterConnectorGap={filterConnectorGap}
              filterFieldLeft={filterFieldLeft}
              filterFieldWidth={filterFieldWidth}
              filterFieldHeight={filterFieldHeight}
              filterRowHeight={filterRowHeight}
              filterFieldSeparatorPositions={filterFieldSeparatorPositions}
              filterFieldSeparatorFieldLeft={filterFieldSeparatorFieldLeft}
              filterFieldSeparatorOperatorLeft={filterFieldSeparatorOperatorLeft}
              filterFieldSeparatorValueLeft={filterFieldSeparatorValueLeft}
              filterFieldSeparatorActionsLeft={filterFieldSeparatorActionsLeft}
              filterFieldMenuWidth={filterFieldMenuWidth}
              filterFieldMenuHeight={filterFieldMenuHeight}
              filterFieldMenuHeaderLeft={filterFieldMenuHeaderLeft}
              filterFieldMenuTopPadding={filterFieldMenuTopPadding}
              filterFieldMenuHeaderHeight={filterFieldMenuHeaderHeight}
              filterFieldMenuFirstRowTop={filterFieldMenuFirstRowTop}
              filterFieldMenuHoverPadding={filterFieldMenuHoverPadding}
              filterFieldMenuListHeight={filterFieldMenuListHeight}
              filterFieldMenuContentHeight={filterFieldMenuContentHeight}
              filterFieldMenuRowHeight={filterFieldMenuRowHeight}
              filterFieldMenuTextHeight={filterFieldMenuTextHeight}
              filterFieldMenuItemWidth={filterFieldMenuItemWidth}
              filterFieldMenuItemLeft={filterFieldMenuItemLeft}
              filterFieldMenuLabelLeft={filterFieldMenuLabelLeft}
              filterOperatorMenuWidth={filterOperatorMenuWidth}
              filterOperatorMenuMaxHeight={filterOperatorMenuMaxHeight}
              filterOperatorMenuFirstRowTop={filterOperatorMenuFirstRowTop}
              filterOperatorMenuBottomPadding={filterOperatorMenuBottomPadding}
              filterOperatorMenuRowStride={filterOperatorMenuRowStride}
              filterOperatorMenuRowHeight={filterOperatorMenuRowHeight}
              filterOperatorMenuItemWidth={filterOperatorMenuItemWidth}
              filterOperatorMenuItemLeft={filterOperatorMenuItemLeft}
              filterOperatorMenuHoverPadding={filterOperatorMenuHoverPadding}
              filterFieldVirtualItems={filterFieldVirtualItems}
              filterFieldVirtualizerSize={filterFieldVirtualizerSize}
              sortButtonRef={tableSortHook.sortButtonRef}
              sortMenuRef={tableSortHook.sortMenuRef}
              sortFieldMenuRef={tableSortHook.sortFieldMenuRef}
              sortAddMenuListRef={tableSortHook.sortAddMenuListRef}
              isSortMenuOpen={tableSortHook.isSortMenuOpen}
              setIsSortMenuOpen={tableSortHook.setIsSortMenuOpen}
              openSortDirectionId={tableSortHook.openSortDirectionId}
              setOpenSortDirectionId={tableSortHook.setOpenSortDirectionId}
              openSortFieldId={tableSortHook.openSortFieldId}
              setOpenSortFieldId={tableSortHook.setOpenSortFieldId}
              isAddSortMenuOpen={tableSortHook.isAddSortMenuOpen}
              setIsAddSortMenuOpen={tableSortHook.setIsAddSortMenuOpen}
              hasSort={(pendingViewName || isViewSwitching) ? false : hasSort}
              sortRows={(pendingViewName || isViewSwitching) ? EMPTY_SORT_ROWS : sortRows}
              sortedColumnIds={(pendingViewName || isViewSwitching) ? EMPTY_STRING_SET : sortedColumnIds}
              draggingSortId={tableSortHook.draggingSortId}
              draggingSortTop={tableSortHook.draggingSortTop}
              sortPhantomRef={tableSortHook.sortPhantomRef}
              phantomSortX={tableSortHook.phantomSortX}
              phantomSortY={tableSortHook.phantomSortY}
              applySorts={handleApplySorts}
              handleSortDragStart={tableSortHook.handleSortDragStart}
              getSortDirectionLabels={tableSortHook.getSortDirectionLabels}
              remainingSortColumns={tableSortHook.remainingSortColumns}
              sortAddVirtualItems={sortAddVirtualItems}
              sortAddVirtualizerSize={sortAddVirtualizerSize}
              sortLayout={sortLayout}
              searchButtonRef={searchHook.searchButtonRef}
              searchMenuRef={searchHook.searchMenuRef}
              searchInputRef={searchHook.searchInputRef}
              isSearchMenuOpen={searchHook.isSearchMenuOpen}
              setIsSearchMenuOpen={searchHook.setIsSearchMenuOpen}
              searchValue={searchHook.searchValue}
              setSearchValue={searchHook.setSearchValue}
              showSearchSpinner={showSearchSpinner}
              showNoSearchResults={showNoSearchResults}
            />
            </div>
          </section>

          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            <section className="min-w-[280px] w-[280px] flex-shrink-0 border-r border-[#DDE1E3]">
              <GridViewContainer
                views={views}
                activeViewId={activeViewId}
                onSelectView={handleSelectView}
                onHoverView={handleHoverView}
                onCreateView={handleCreateView}
                functionContainerRef={functionContainerRef}
              />
            </section>

            {/* Add row + extensions pill – fixed to bottom of viewport area */}
            {activeTable && !isViewSwitching && !isTableLoading && (
            <div
              className="absolute z-[60]"
              style={{
                left: 288,       /* 280 (sidebar) + 8px gap */
                bottom: 29,
                width: 134,
                height: 36,
                borderRadius: 18,
                border: "1px solid #E4E4E4",
                overflow: "hidden",
                backgroundColor: "white",
              }}
            >
              {/* Left zone – plus / add-row button (CSS-only hover for instant response) */}
              <button
                type="button"
                className="absolute cursor-pointer border-none bg-white p-0 outline-none hover:!bg-[#E4E8F1]"
                style={{
                  left: 0,
                  top: 0,
                  width: 46,
                  height: 36,
                  borderRadius: "18px 0 0 18px",
                }}
                onClick={() => {
                  if (!activeTableId) return;
                  addRowsMutate({
                    tableId: activeTableId,
                    count: 1,
                    ids: [crypto.randomUUID()],
                  });
                }}
              >
                {/* 12×12 plus icon at (19,12) with #1D1F24 color */}
                <svg
                  width={12}
                  height={12}
                  viewBox="0 0 13 13"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="absolute pointer-events-none"
                  style={{ left: 19, top: 12 }}
                >
                  <rect x="0" y="6" width="13" height="1" rx="0.5" fill="#1D1F24" />
                  <rect x="6" y="0" width="1" height="13" rx="0.5" fill="#1D1F24" />
                </svg>
              </button>
              {/* Vertical divider */}
              <span
                className="absolute pointer-events-none"
                style={{
                  left: 45,
                  top: 0,
                  width: 1,
                  height: 35,
                  backgroundColor: "#E4E4E4",
                }}
              />
              {/* Right zone – "Add..." */}
              <button
                type="button"
                className="absolute cursor-pointer border-none bg-transparent p-0 outline-none"
                style={{
                  left: 46,
                  top: 0,
                  width: 88,
                  height: 36,
                  borderRadius: "0 18px 18px 0",
                }}
              >
                {/* 16×16 add.svg at (59,10) relative to pill → 59-46=13 within this zone */}
                <AddIcon
                  className="absolute pointer-events-none"
                  style={{ left: 13, top: 10, width: 16, height: 16 }}
                />
                {/* "Add..." label at (82,10) relative to pill → 82-46=36 */}
                <span
                  className="absolute pointer-events-none text-[13px] font-normal text-[#1D1F24]"
                  style={{
                    left: 36,
                    top: 10,
                    fontFamily: "Inter, sans-serif",
                    lineHeight: "16px",
                  }}
                >
                  Add...
                </span>
              </button>
            </div>
            )}

            <section className="isolate relative min-h-0 min-w-0 flex-1 overflow-hidden bg-[#F7F8FC]">
              {baseDetailsQuery.isError && (
                <div className="rounded-[6px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-6 text-[12px] text-[#991b1b]">
                  We couldn't load this base. It may have been deleted or you may not have access.
                </div>
              )}

              {!baseDetailsQuery.isLoading &&
                !baseDetailsQuery.isError &&
                activeTableId &&
                tableMetaQuery.isError &&
                !activeTable && (
                  <div className="rounded-[6px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-6 text-[12px] text-[#991b1b]">
                    We couldn't load this table. Try refreshing again.
                  </div>
                )}

              {(activeTableId && ((tableMetaQuery.isLoading || !isValidTableId(activeTableId)) && !activeTable || showRowsInitialLoading)) && (
                <div
                  className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[#F7F8FC]"
                >
                  <span
                    className="header-saving-spinner"
                    aria-hidden="true"
                    style={{
                      width: 28,
                      height: 28,
                    }}
                  >
                    <svg
                      width="28"
                      height="28"
                      viewBox="0 0 10 10"
                      aria-hidden="true"
                    >
                      <circle
                        cx="5"
                        cy="5"
                        r="4"
                        fill="none"
                        stroke="#989AA1"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeDasharray="0.6 0.4"
                        pathLength="3"
                      />
                    </svg>
                  </span>
                </div>
              )}

              {activeTable && !isViewSwitching && (
                <div
                  className="h-full"
                  key={activeViewId ?? "no-view"}
                  style={{
                    visibility: isTableLoading ? "hidden" : "visible",
                  }}
                >
                  <TableView
                    activeTableId={activeTableId!}
                    activeTable={activeTable}
                    activeColumns={activeColumns}
                    orderedColumns={orderedColumns}
                    columnById={columnById}
                    sortedTableData={tableData}
                    searchMatchesByRow={searchMatchesByRow}
                    columnsWithSearchMatches={columnsWithSearchMatches}
                    columnWidths={columnWidths}
                    setColumnWidths={setColumnWidths}
                    selectedCell={selectedCell}
                    setSelectedCell={setSelectedCell}
                    editingCell={editingCell}
                    setEditingCell={setEditingCell}
                    cellEdits={cellEdits}
                    setCellEdits={setCellEdits}
                    resizing={resizing}
                    setResizing={setResizing}
                    sortedColumnIds={displaySortedColumnIds}
                    filteredColumnIds={displayFilteredColumnIds}
                    hiddenColumnIdSet={hiddenColumnIdSet}
                    searchQuery={searchQuery}
                    hasSearchQuery={hasSearchQuery}
                    rowsHasNextPage={rowsQuery.hasNextPage ?? false}
                    rowsIsFetchingNextPage={rowsQuery.isFetchingNextPage}
                    rowsFetchNextPage={rowsQuery.fetchNextPage}
                    sparseRows={sparseRows}
                    sparseVersion={sparseVersion}
                    onVisibleRangeChange={handleVisibleRangeChange}
                    showRowsError={showRowsError}
                    showRowsEmpty={showRowsEmpty}
                    showRowsInitialLoading={showRowsInitialLoading}
                    rowsErrorMessage={rowsErrorMessage}
                    updateCellMutate={updateCell.mutate}
                    addRowsMutate={addRowsMutate}
                    addColumnMutate={addColumn.mutate}
                    addColumnIsPending={addColumn.isPending}
                    activeRowCount={activeRowCount}
                    totalRowCount={totalRowCount}
                    hasActiveFilters={hasActiveFilters}
                    onClearSearch={searchHook.clearSearch}
                  />
                </div>
              )}

              {isViewSwitching && (
                <div
                  className="absolute inset-0 z-50 bg-[#F7F8FC]"
                >
                  <span
                    className="header-saving-spinner"
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      left: 551,
                      top: 343,
                      width: 28,
                      height: 28,
                    }}
                  >
                    <svg
                      width="28"
                      height="28"
                      viewBox="0 0 10 10"
                      aria-hidden="true"
                    >
                      <circle
                        cx="5"
                        cy="5"
                        r="4"
                        fill="none"
                        stroke="#989AA1"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeDasharray="0.6 0.4"
                        pathLength="3"
                      />
                    </svg>
                  </span>
                  <span
                    className={inter.className}
                    style={{
                      position: "absolute",
                      left: 496,
                      top: 403,
                      fontSize: 16,
                      fontWeight: 400,
                      color: "#989AA1",
                      lineHeight: "16px",
                    }}
                  >
                    Loading this view...
                  </span>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

    </div>
  );
}
