"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { skipToken } from "@tanstack/react-query";

import AddIcon from "~/assets/add.svg";
import { Header } from "./header";
import { Toolbar } from "../toolbar/toolbar";
import { api, type RouterInputs } from "~/trpc/react";
import { ViewSidebar } from "../views/view-sidebar";
import { TableView } from "../grid/table-view";
import { GridStateProvider } from "../grid/grid-state-context";
import { useTableSort, type SortConfig } from "../toolbar/use-table-sort";
import { useHideFields } from "../toolbar/use-hide-fields";
import { useTableSearch } from "../toolbar/use-table-search";
import { useTableFilter, type FilterItem, type FilterConnector, type FilterOperator } from "../toolbar/use-table-filter";
import { useBulkRows } from "../grid/use-bulk-rows";
import { useSparsePages } from "../grid/use-sparse-pages";
import { useFilterDrag } from "../toolbar/use-filter-drag";
import { useDataPipeline } from "../grid/use-data-pipeline";
import { TableTabs } from "./table-tabs";
import { SidebarNav } from "./sidebar-nav";
import type { TableRow } from "~/lib/types";
import { formatInitials, isValidTableId, isValidUUID, getLastViewedTableKey, getLastViewedViewKey, formatUserInitial, buildRowsPrefetchInput } from "~/lib/utils";
import { DEFAULT_COLUMN_WIDTH, STATUS_ICON_SCALE, PAGE_ROWS, SPARSE_PAGE_ROWS } from "~/lib/constants";

// Stable empty references for optimistic new-view state (avoids re-render churn)
const EMPTY_STRING_SET = new Set<string>();
const EMPTY_SORT_ROWS: SortConfig[] = [];
const EMPTY_STRING_ARRAY: string[] = [];

const MAX_TABLES = 1000;
const ROW_PREFETCH_AHEAD = PAGE_ROWS * 5;
const MIN_COLUMN_WIDTH = 120;
const MAX_COLUMN_WIDTH = 420;
const ADD_COLUMN_MENU_WIDTH = 400;
const ADD_COLUMN_OPTION_WIDTH = 380;
const STATUS_HEADER_ICON_SIZE = 13 * STATUS_ICON_SCALE;

const REQUIRED_COLUMNS = ["Name", "Notes", "Assignee", "Status", "Attachments"];

const imgEllipse2 =
  "https://www.figma.com/api/mcp/asset/220c0b55-a141-4008-8b9e-393c5dcc820b";
const imgEllipse3 =
  "https://www.figma.com/api/mcp/asset/42309589-dc81-48ef-80de-6483844e93cc";

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

export function TableWorkspace({ baseId, userName, userEmail }: TableWorkspaceProps) {
  const router = useRouter();
  const utils = api.useUtils();
  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const [preferredTableId, setPreferredTableId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const storedId = window.localStorage.getItem(getLastViewedTableKey(baseId));
      return storedId && isValidTableId(storedId) ? storedId : null;
    } catch {
      return null;
    }
  });
  const [preferredTableBaseId, setPreferredTableBaseId] = useState<string | null>(
    () => (typeof window === "undefined" ? null : baseId)
  );
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [resizing, setResizing] = useState<ColumnResizeState | null>(null);
  const [cellEdits, setCellEdits] = useState<Record<string, Record<string, string>>>(
    {}
  );
  const [ensuredTableId, setEnsuredTableId] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<{
    rowId: string;
    columnId: string;
  } | null>(null);
  const [editingCell, setEditingCell] = useState<{
    rowId: string;
    columnId: string;
  } | null>(null);
  const [newTableId, setNewTableId] = useState<string | null>(null);
  const searchMaskId = useId().replace(/:/g, "");
  const closeMaskId = useId().replace(/:/g, "");
  const hasLoadedTableMetaRef = useRef(false);
  const functionContainerRef = useRef<HTMLDivElement>(null);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [isViewSwitching, setIsViewSwitching] = useState(false);
  const viewDataReadyPassRef = useRef(0);
  const [pendingViewName, setPendingViewName] = useState<string | null>(null);
  const orderedColumnsRef = useRef([] as { id: string; name: string; type: string | null }[]);

  const baseDetailsQuery = api.base.get.useQuery({ baseId }, { staleTime: 30_000 });

  // Derive views directly from the base.get query (already loaded) – no extra round trip
  const activeTableViews = useMemo(() => {
    if (!activeTableId || !baseDetailsQuery.data) return [];
    const table = baseDetailsQuery.data.tables.find((t) => t.id === activeTableId);
    return table?.views ?? [];
  }, [activeTableId, baseDetailsQuery.data]);

  // Ensure existing tables have at least one view (migration for pre-view tables)
  const ensureDefaultViewMutation = api.view.ensureDefaultView.useMutation({
    onSuccess: (result) => {
      if (result.created) {
        utils.view.getView.setData({ viewId: result.id }, {
          id: result.id, name: result.name, sortConfig: [], hiddenColumnIds: [], searchQuery: "", filterConfig: null,
        });
        void utils.base.get.invalidate({ baseId });
      }
      if (!activeViewId || activeViewId === "pending-view") {
        setActiveViewId(result.id);
      }
    },
  });
  const ensureDefaultViewCalledRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeTableId) return;
    if (activeTableViews.length > 0) {
      if (activeViewId === null || (!activeTableViews.some((v) => v.id === activeViewId) && activeViewId !== "pending-view")) {
        setActiveViewId(activeTableViews[0]!.id);
      }
    } else if (baseDetailsQuery.data && isValidTableId(activeTableId)) {
      if (ensureDefaultViewCalledRef.current !== activeTableId) {
        ensureDefaultViewCalledRef.current = activeTableId;
        ensureDefaultViewMutation.mutate({ tableId: activeTableId });
      }
    }
  }, [activeTableId, activeTableViews, activeViewId, baseDetailsQuery.data]);

  const createViewMutation = api.view.createView.useMutation({
    onMutate: ({ name }) => {
      setIsViewSwitching(true);
      setPendingViewName(name);
      setActiveViewId("pending-view");
    },
    onSuccess: (newView) => {
      utils.view.getView.setData({ viewId: newView.id }, {
        id: newView.id, name: newView.name, sortConfig: [], hiddenColumnIds: [], searchQuery: "", filterConfig: null,
      });
      utils.base.get.setData({ baseId }, (prev) => {
        if (!prev) return prev;
        return { ...prev, tables: prev.tables.map((table) =>
          table.id === newView.tableId
            ? { ...table, views: [...table.views, { id: newView.id, name: newView.name, sortConfig: [], hiddenColumnIds: [], searchQuery: "", filterConfig: null }] }
            : table
        )};
      });
      setActiveViewId(newView.id);
      setPendingViewName(null);
      void utils.base.get.invalidate({ baseId });
    },
    onError: () => {
      setIsViewSwitching(false);
      setPendingViewName(null);
      setActiveViewId(activeTableViews[0]?.id ?? null);
    },
  });

  const hasActiveView = activeViewId !== null && isValidUUID(activeViewId);
  const activeViewQuery = api.view.getView.useQuery(
    { viewId: activeViewId! },
    { enabled: hasActiveView, staleTime: 30_000 }
  );

  const updateViewMutation = api.view.updateView.useMutation({
    onMutate: async ({ viewId, sortConfig, hiddenColumnIds, searchQuery, filterConfig }) => {
      await utils.view.getView.cancel({ viewId });
      const previous = utils.view.getView.getData({ viewId });
      utils.view.getView.setData({ viewId }, (current) => {
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
        utils.view.getView.setData({ viewId: context.viewId }, context.previous);
      }
    },
    onSettled: (_data, error, variables) => {
      if (error) {
        void utils.view.getView.invalidate({ viewId: variables.viewId });
      }
    },
  });

  // Re-read localStorage when baseId changes (initial mount is handled by
  // the synchronous useState initializers above, avoiding an extra render cycle).
  const prevBaseIdRef = useRef(baseId);
  useEffect(() => {
    if (prevBaseIdRef.current === baseId) return;
    prevBaseIdRef.current = baseId;
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
        utils.view.getView.setData({ viewId: view.id }, {
          id: view.id,
          name: view.name,
          sortConfig: view.sortConfig,
          hiddenColumnIds: view.hiddenColumnIds,
          searchQuery: view.searchQuery,
          filterConfig: view.filterConfig,
        });
      }
    }
  }, [baseDetailsQuery.data, utils.view.getView]);

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

    void utils.table.getTableMeta.prefetch({ tableId: targetId }, { staleTime: 30_000 });

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
    void utils.row.getRows.prefetchInfinite(rowsInput, { staleTime: 30_000 });
  }, [baseDetailsQuery.data?.tables, preferredTableId, utils.table.getTableMeta, utils.row.getRows]);

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

  const tableMetaQuery = api.table.getTableMeta.useQuery(
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
  const setTableFilter = api.view.setTableFilter.useMutation({
    onMutate: async ({ tableId, filterConfig }) => {
      await utils.table.getTableMeta.cancel({ tableId });
      const previous = utils.table.getTableMeta.getData({ tableId });
      utils.table.getTableMeta.setData({ tableId }, (current) => {
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
        utils.table.getTableMeta.setData(
          { tableId: context.tableId },
          context.previous
        );
      }
    },
    onSettled: async (_data, _error, variables) => {
      await utils.table.getTableMeta.invalidate({ tableId: variables.tableId });
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

  // Initialize filter drag/UI hook
  const filterDragHook = useFilterDrag({
    filterHook,
    orderedColumns,
    columnById,
    hiddenColumnIdSet,
    activeTableId,
    baseId,
    isViewSwitching,
    pendingViewName,
    tableMetaData: tableMetaQuery.data,
  });

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
      filter?: RouterInputs["row"]["getRows"]["filter"];
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

  const rowsQuery = api.row.getRows.useInfiniteQuery(
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
  const rowsQueryWithoutSearch = api.row.getRows.useInfiniteQuery(
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
  const baseActiveRowCount = firstPageCount >= 0 ? firstPageCount : totalRowCount;

  // Optimistic delta — incremented synchronously on single-row add clicks
  // so activeRowCount (and thus the virtualizer count) updates in the SAME
  // render frame as the sparse cache entry.  Cleared once the server count
  // catches up (the TQ page totalCount is bumped by onMutate/refetch).
  const [optimisticRowDelta, setOptimisticRowDelta] = useState(0);
  const prevBaseCount = useRef(baseActiveRowCount);
  if (baseActiveRowCount !== prevBaseCount.current) {
    // Server / TQ cache count changed — absorb the delta
    const serverGain = baseActiveRowCount - prevBaseCount.current;
    prevBaseCount.current = baseActiveRowCount;
    if (optimisticRowDelta > 0 && serverGain > 0) {
      // Use functional-style set so React batches this with the render
      // that triggered the change.  Clamp to 0 so delta never goes negative.
      const newDelta = Math.max(0, optimisticRowDelta - serverGain);
      if (newDelta !== optimisticRowDelta) {
        setOptimisticRowDelta(newDelta);
      }
    }
  }
  const activeRowCount = baseActiveRowCount + optimisticRowDelta;

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

  // Wrapper around addRowsMutate that makes single-row additions instant:
  //  1. Injects an empty TableRow into the sparse cache at the end-of-table
  //     index so the virtualizer has data for the new slot immediately.
  //  2. Bumps optimisticRowDelta so activeRowCount (→ virtualizerCount)
  //     increases in the same synchronous render — no waiting for the async
  //     onMutate / TQ cache update.
  const addRowsMutateWithOptimistic = useCallback(
    (params: { tableId: string; count: number; ids?: string[]; populateWithFaker?: boolean }) => {
      if (params.count === 1 && params.ids && params.ids.length === 1) {
        const newId = params.ids[0]!;
        const currentCount = prevBaseCount.current + optimisticRowDelta;
        const newIndex = currentCount; // 0-based index of the new last row

        // Build an empty TableRow matching the column schema
        const cols = orderedColumnsRef.current;
        const cells: Record<string, string> = { id: newId };
        for (let c = 0; c < cols.length; c++) {
          cells[cols[c]!.id] = "";
        }
        sparseRowsMapRef.current.set(newIndex, cells as TableRow);

        // Bump count + trigger re-render in one synchronous batch
        setOptimisticRowDelta((d) => d + 1);
        setSparseVersion((v) => v + 1);
      }
      addRowsMutate(params);
    },
    [optimisticRowDelta, addRowsMutate],
  );

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

  const renameViewMutation = api.view.renameView.useMutation({
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
        await utils.view.getView.cancel({ viewId: renamedViewId });
        utils.view.getView.setData({ viewId: renamedViewId }, (old) => {
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
        void utils.view.getView.invalidate({ viewId: variables.viewId });
      }
    },
  });

  const deleteViewMutation = api.view.deleteView.useMutation({
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

  const duplicateViewMutation = api.view.duplicateView.useMutation({
    onMutate: ({ name }) => {
      setIsViewSwitching(true);
      if (name) setPendingViewName(name);
      setActiveViewId("pending-view");
    },
    onSuccess: (newView) => {
      // Seed the getView cache with the duplicated view's full config
      utils.view.getView.setData({ viewId: newView.id }, {
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
      void utils.view.getView.prefetch({ viewId }, { staleTime: 30_000 });

      if (activeTableId) {
        const cachedView = utils.view.getView.getData({ viewId });
        if (cachedView) {
          const rowsInput = buildRowsPrefetchInput(activeTableId, cachedView);
          void utils.row.getRows.prefetchInfinite(rowsInput, { staleTime: 30_000 });
        }
      }
    }
  }, [utils.view.getView, utils.row.getRows, activeTableId, hideFieldsHook, filterHook, tableSortHook, searchHook]);

  // Prefetch rows when hovering over a view in the sidebar so data is
  // often ready by the time the user clicks.
  const handleHoverView = useCallback((viewId: string) => {
    if (!isValidUUID(viewId) || !activeTableId || viewId === activeViewId) return;
    const cachedView = utils.view.getView.getData({ viewId });
    if (cachedView) {
      const rowsInput = buildRowsPrefetchInput(activeTableId, cachedView);
      void utils.row.getRows.prefetchInfinite(rowsInput, { staleTime: 30_000 });
    }
  }, [utils.view.getView, utils.row.getRows, activeTableId, activeViewId]);

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

  const addTable = api.table.addTable.useMutation({
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
      void utils.table.getTableMeta.prefetch({ tableId: data.id }, { staleTime: 30_000 });
      void utils.row.getRows.prefetchInfinite(
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


  const renameTable = api.table.renameTable.useMutation({
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

  const addColumn = api.column.addColumn.useMutation({
    onMutate: async ({ tableId, name, id, type }) => {
      if (!activeTableId || tableId !== activeTableId || !id) {
        return { tableId, columnId: id ?? null, skipped: true };
      }
      await utils.table.getTableMeta.cancel({ tableId });
      const columnName = name ?? "Column";
      const columnType = type ?? "single_line_text";
      utils.table.getTableMeta.setData({ tableId }, (current) => {
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
      utils.table.getTableMeta.setData({ tableId: context.tableId }, (current) => {
        if (!current) return current;
        return {
          ...current,
          columns: current.columns.filter((column) => column.id !== context.columnId),
        };
      });
    },
    onSuccess: async (_data, variables) => {
      if (variables.id) return;
      await utils.table.getTableMeta.invalidate({ tableId: variables.tableId });
    },
  });

  const setTableSearch = api.view.setTableSearch.useMutation({
    onMutate: async ({ tableId, search }) => {
      await utils.table.getTableMeta.cancel({ tableId });
      const previous = utils.table.getTableMeta.getData({ tableId });
      const nextSearch = search ?? "";
      utils.table.getTableMeta.setData({ tableId }, (current) => {
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
        utils.table.getTableMeta.setData(
          { tableId: context.tableId },
          context.previous
        );
      }
    },
    onSettled: async (_data, _error, variables) => {
      await utils.table.getTableMeta.invalidate({ tableId: variables.tableId });
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

  const setHiddenColumns = api.view.setHiddenColumns.useMutation({
    onMutate: async ({ tableId, hiddenColumnIds }) => {
      await utils.table.getTableMeta.cancel({ tableId });
      const previous = utils.table.getTableMeta.getData({ tableId });
      utils.table.getTableMeta.setData({ tableId }, (current) => {
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
        utils.table.getTableMeta.setData(
          { tableId: context.tableId },
          context.previous
        );
      }
    },
    onSettled: async (_data, _error, variables) => {
      resetSparseCache();
      await utils.table.getTableMeta.invalidate({ tableId: variables.tableId });
      await utils.row.getRows.invalidate(getRowsQueryKey(variables.tableId));
    },
  });


  const updateCell = api.row.updateCell.useMutation({
    onMutate: async ({ rowId, columnId, value }) => {
      if (!activeTableId) return { previous: null, queryKey: null };
      const queryKey = getRowsQueryKey(activeTableId);
      await utils.row.getRows.cancel(queryKey);
      const previous = utils.row.getRows.getInfiniteData(queryKey);
      utils.row.getRows.setInfiniteData(queryKey, (data) => {
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
        utils.row.getRows.setInfiniteData(context.queryKey, context.previous);
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
        void utils.row.getRows.invalidate(getRowsQueryKey(activeTableId));
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


  // Get sort data from hook
  const sortRows = tableSortHook.sortRows;
  const sortedColumnIds = tableSortHook.sortedColumnIds;
  const sortLayout = tableSortHook.sortLayout;


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
  // Data pipeline — extracted to useDataPipeline hook
  // ---------------------------------------------------------------------------
  const {
    tableData,
    tableDataById,
    loadedRowCount,
    searchMatchesByRow,
    columnsWithSearchMatches,
    showSearchSpinner,
    showNoSearchResults,
    showRowsInitialLoading,
    showRowsError,
    showRowsEmpty,
    rowsErrorMessage,
  } = useDataPipeline({
    activeTable,
    orderedColumns,
    rowsQuery,
    rowsQueryWithoutSearch,
    searchQuery,
    hasSearchQuery,
    hasActiveFilters,
    sortParam,
    filterInput,
    cellEdits,
  });

  // ---------------------------------------------------------------------------
  // Sparse page cache — extracted to useSparsePages hook
  // ---------------------------------------------------------------------------
  const {
    sparseRows,
    sparseVersion,
    setSparseVersion,
    handleVisibleRangeChange,
    resetSparseCache,
    sparsePagesRef,
    sparseRowsMapRef,
  } = useSparsePages({
    activeTableId,
    loadedRowCount,
    activeRowCount,
    sortParam,
    filterInput,
    searchQuery,
    hasSearchQuery,
    orderedColumnsRef,
  });

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

  const handleSelectTable = (tableId: string) => {
    // Flush pending search save to the CURRENT table before switching
    flushPendingSearchRef.current();
    setActiveTableId(tableId);
    // Prefetch meta + first page of rows for the new table
    if (isValidTableId(tableId)) {
      void utils.table.getTableMeta.prefetch({ tableId }, { staleTime: 30_000 });
      void utils.row.getRows.prefetchInfinite(
        { tableId, limit: PAGE_ROWS },
        { staleTime: 30_000 }
      );
    }
  };

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
    <div className={clsx("h-screen overflow-hidden bg-white text-[#1d1f24]", "font-inter")}>
      <div className="flex h-screen overflow-hidden">
        <SidebarNav
          userName={userName}
          userEmail={userEmail}
          userInitial={userInitial}
          onNavigateHome={() => router.push("/bases")}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <Header baseName={baseName} isLoading={headerLoading} />

          <section className="border-t border-[#DEDEDE] bg-white">
            <TableTabs
              activeTables={activeTables}
              activeTableId={activeTableId}
              onSelectTable={handleSelectTable}
              baseId={baseId}
              newTableId={newTableId}
              setNewTableId={setNewTableId}
              addTableMutate={(params) => addTable.mutate(params)}
              addTableDisabled={activeTables.length >= MAX_TABLES || addTable.isPending}
              renameTableMutate={(params) => renameTable.mutate(params)}
            />
            <div ref={functionContainerRef}>
              <Toolbar
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
              filterFieldMenuListRef={filterDragHook.filterFieldMenuListRef}
              filterOperatorMenuListRef={filterDragHook.filterOperatorMenuListRef}
              filterItems={filterHook.filterItems}
              setFilterItems={filterHook.setFilterItems}
              filterConnector={filterHook.filterConnector}
              setFilterConnector={filterHook.setFilterConnector}
              openFilterFieldId={filterDragHook.openFilterFieldId}
              setOpenFilterFieldId={filterDragHook.setOpenFilterFieldId}
              openFilterOperatorId={filterDragHook.openFilterOperatorId}
              setOpenFilterOperatorId={filterDragHook.setOpenFilterOperatorId}
              openFilterConnectorId={filterDragHook.openFilterConnectorId}
              setOpenFilterConnectorId={filterDragHook.setOpenFilterConnectorId}
              focusedFilterValueId={filterDragHook.focusedFilterValueId}
              setFocusedFilterValueId={filterDragHook.setFocusedFilterValueId}
              filterValueErrorId={filterDragHook.filterValueErrorId}
              setFilterValueErrorId={filterDragHook.setFilterValueErrorId}
              draggingFilterId={filterDragHook.draggingFilterId}
              draggingFilterTop={filterDragHook.draggingFilterTop}
              phantomFilterX={filterDragHook.phantomFilterX}
              phantomFilterY={filterDragHook.phantomFilterY}
              highlightedFilterFieldId={filterDragHook.highlightedFilterFieldId}
              highlightedFilterOperatorId={filterDragHook.highlightedFilterOperatorId}
              highlightedFilterConnectorKey={filterDragHook.highlightedFilterConnectorKey}
              setHighlightedFilterConnectorKey={filterDragHook.setHighlightedFilterConnectorKey}
              setHighlightedFilterFieldId={filterDragHook.setHighlightedFilterFieldId}
              setHighlightedFilterOperatorId={filterDragHook.setHighlightedFilterOperatorId}
              activeFilterAdd={filterDragHook.activeFilterAdd}
              handleFilterFieldSelect={filterDragHook.handleFilterFieldSelect}
              handleFilterOperatorSelect={filterDragHook.handleFilterOperatorSelect}
              handleFilterValueChange={filterDragHook.handleFilterValueChange}
              handleFilterDragStart={filterDragHook.handleFilterDragStart}
              addFilterCondition={filterDragHook.addFilterCondition}
              addFilterGroup={filterDragHook.addFilterGroup}
              addFilterConditionToGroup={filterDragHook.addFilterConditionToGroup}
              addFilterGroupToGroup={filterDragHook.addFilterGroupToGroup}
              deleteFilterGroup={filterDragHook.deleteFilterGroup}
              setGroupConnector={filterDragHook.setGroupConnector}
              openGroupPlusId={filterDragHook.openGroupPlusId}
              setOpenGroupPlusId={filterDragHook.setOpenGroupPlusId}
              draggingGroupId={filterDragHook.draggingGroupId}
              filterGroupEmptyWidth={filterDragHook.filterGroupEmptyWidth}
              filterGroupEmptyHeight={filterDragHook.filterGroupEmptyHeight}
              filterGroupPaddingTop={filterDragHook.filterGroupPaddingTop}
              filterGroupPaddingBottom={filterDragHook.filterGroupPaddingBottom}
              filterGroupPaddingLeft={filterDragHook.filterGroupPaddingLeft}
              filterGroupWhereLeft={filterDragHook.filterGroupWhereLeft}
              orderedColumns={orderedColumns}
              columnById={columnById}
              hasFilterItems={filterDragHook.hasFilterItems}
              filterLayout={filterDragHook.filterLayout}
              filterFooterTop={filterDragHook.filterFooterTop}
              filterDropdownWidth={filterDragHook.filterDropdownWidth}
              filterDropdownHeight={filterDragHook.filterDropdownHeight}
              filterDropdownHeaderLeft={filterDragHook.filterDropdownHeaderLeft}
              filterDropdownHeaderTop={filterDragHook.filterDropdownHeaderTop}
              filterInputLeft={filterDragHook.filterInputLeft}
              filterInputTop={filterDragHook.filterInputTop}
              filterInputWidth={filterDragHook.filterInputWidth}
              filterInputHeight={filterDragHook.filterInputHeight}
              filterInputRadius={filterDragHook.filterInputRadius}
              filterEmptyMessageTop={filterDragHook.filterEmptyMessageTop}
              filterExpandedMessageTop={filterDragHook.filterExpandedMessageTop}
              filterRowLeft={filterDragHook.filterRowLeft}
              filterWhereTop={filterDragHook.filterWhereTop}
              filterConnectorWidth={filterDragHook.filterConnectorWidth}
              filterConnectorHeight={filterDragHook.filterConnectorHeight}
              filterConnectorGap={filterDragHook.filterConnectorGap}
              filterFieldLeft={filterDragHook.filterFieldLeft}
              filterFieldWidth={filterDragHook.filterFieldWidth}
              filterFieldHeight={filterDragHook.filterFieldHeight}
              filterRowHeight={filterDragHook.filterRowHeight}
              filterFieldSeparatorPositions={filterDragHook.filterFieldSeparatorPositions}
              filterFieldSeparatorFieldLeft={filterDragHook.filterFieldSeparatorFieldLeft}
              filterFieldSeparatorOperatorLeft={filterDragHook.filterFieldSeparatorOperatorLeft}
              filterFieldSeparatorValueLeft={filterDragHook.filterFieldSeparatorValueLeft}
              filterFieldSeparatorActionsLeft={filterDragHook.filterFieldSeparatorActionsLeft}
              filterFieldMenuWidth={filterDragHook.filterFieldMenuWidth}
              filterFieldMenuHeight={filterDragHook.filterFieldMenuHeight}
              filterFieldMenuHeaderLeft={filterDragHook.filterFieldMenuHeaderLeft}
              filterFieldMenuTopPadding={filterDragHook.filterFieldMenuTopPadding}
              filterFieldMenuHeaderHeight={filterDragHook.filterFieldMenuHeaderHeight}
              filterFieldMenuFirstRowTop={filterDragHook.filterFieldMenuFirstRowTop}
              filterFieldMenuHoverPadding={filterDragHook.filterFieldMenuHoverPadding}
              filterFieldMenuListHeight={filterDragHook.filterFieldMenuListHeight}
              filterFieldMenuContentHeight={filterDragHook.filterFieldMenuContentHeight}
              filterFieldMenuRowHeight={filterDragHook.filterFieldMenuRowHeight}
              filterFieldMenuTextHeight={filterDragHook.filterFieldMenuTextHeight}
              filterFieldMenuItemWidth={filterDragHook.filterFieldMenuItemWidth}
              filterFieldMenuItemLeft={filterDragHook.filterFieldMenuItemLeft}
              filterFieldMenuLabelLeft={filterDragHook.filterFieldMenuLabelLeft}
              filterOperatorMenuWidth={filterDragHook.filterOperatorMenuWidth}
              filterOperatorMenuMaxHeight={filterDragHook.filterOperatorMenuMaxHeight}
              filterOperatorMenuFirstRowTop={filterDragHook.filterOperatorMenuFirstRowTop}
              filterOperatorMenuBottomPadding={filterDragHook.filterOperatorMenuBottomPadding}
              filterOperatorMenuRowStride={filterDragHook.filterOperatorMenuRowStride}
              filterOperatorMenuRowHeight={filterDragHook.filterOperatorMenuRowHeight}
              filterOperatorMenuItemWidth={filterDragHook.filterOperatorMenuItemWidth}
              filterOperatorMenuItemLeft={filterDragHook.filterOperatorMenuItemLeft}
              filterOperatorMenuHoverPadding={filterDragHook.filterOperatorMenuHoverPadding}
              filterFieldVirtualItems={filterDragHook.filterFieldVirtualItems}
              filterFieldVirtualizerSize={filterDragHook.filterFieldVirtualizerSize}
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
              <ViewSidebar
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
                  addRowsMutateWithOptimistic({
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
                  <GridStateProvider
                    state={{
                      selectedCell,
                      editingCell,
                      cellEdits,
                      expandedRowId: null,
                    }}
                    actions={{
                      setSelectedCell,
                      setEditingCell,
                      setCellEdits,
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
                        addRowsMutate={addRowsMutateWithOptimistic}
                        addColumnMutate={addColumn.mutate}
                        addColumnIsPending={addColumn.isPending}
                        activeRowCount={activeRowCount}
                        totalRowCount={totalRowCount}
                        hasActiveFilters={hasActiveFilters}
                        onClearSearch={searchHook.clearSearch}
                      />
                    </GridStateProvider>
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
                    className={"font-inter"}
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
