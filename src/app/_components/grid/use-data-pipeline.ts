import { useMemo, useRef } from "react";
import type { RouterInputs } from "~/trpc/react";

import type { TableRow } from "~/lib/types";
import { transformRowData } from "~/lib/utils";

export type UseDataPipelineParams = {
  activeTable: { id: string } | null;
  orderedColumns: { id: string; name: string; type: string | null }[];
  rowsQuery: {
    data?: { pages: { rows: { id: string; data: Record<string, string> }[]; totalCount?: number }[] };
    isFetching: boolean;
    isFetchingNextPage: boolean;
    isLoading: boolean;
    isError: boolean;
    hasNextPage?: boolean;
    error?: { message: string } | null;
  };
  rowsQueryWithoutSearch: {
    data?: { pages: { rows: { id: string; data: Record<string, string> }[] }[] };
  };
  searchQuery: string;
  hasSearchQuery: boolean;
  hasActiveFilters: boolean;
  sortParam: { columnId: string; direction: "asc" | "desc" }[];
  filterInput: RouterInputs["row"]["getRows"]["filter"];
  cellEdits: Record<string, Record<string, string>>;
};

export type UseDataPipelineReturn = {
  tableData: TableRow[];
  tableDataById: Map<string, TableRow>;
  loadedRowCount: number;
  searchMatchesByRow: Map<string, Set<string>>;
  columnsWithSearchMatches: Set<string>;
  showSearchSpinner: boolean;
  showNoSearchResults: boolean;
  showRowsInitialLoading: boolean;
  showRowsError: boolean;
  showRowsEmpty: boolean;
  rowsErrorMessage: string;
};

export function useDataPipeline({
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
}: UseDataPipelineParams): UseDataPipelineReturn {
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
    /** Row count on the last page — used to detect optimistic intra-page inserts */
    lastPageRowCount: number;
    data: TableRow[];
    byId: Map<string, TableRow>;
    seen: Set<string>;
    baseSearchMap: Map<string, Set<string>>;
  } | null>(null);

  // -------------------------------------------------------------------------
  // Memo 1: Page selection (decide which pages to use)
  // Depends only on pages availability and search state
  // -------------------------------------------------------------------------
  const selectedPages = useMemo(() => {
    const searchPages = rowsQuery.data?.pages ?? [];
    const hasSearchResults = searchPages.some((page) => page.rows.length > 0);
    const useWithoutSearchQuery =
      hasSearchQuery &&
      !hasSearchResults &&
      !rowsQuery.isFetching &&
      !hasActiveFilters;
    return useWithoutSearchQuery
      ? rowsQueryWithoutSearch.data?.pages ?? []
      : searchPages;
  }, [
    rowsQuery.data?.pages,
    rowsQueryWithoutSearch.data?.pages,
    hasSearchQuery,
    rowsQuery.isFetching,
    hasActiveFilters,
  ]);

  // -------------------------------------------------------------------------
  // Memo 2: Core page → row transformation (expensive work)
  // Depends on pages content, columns order, and query fingerprint
  // Separated from search matching to reduce re-run frequency
  // -------------------------------------------------------------------------
  const { tableData, tableDataById, loadedRowCount, baseSearchMatchesByRow } =
    useMemo(() => {
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

      const columnsKey = orderedColumns.map((c) => c.id).join(",");
      const prev = pipelineCacheRef.current;

      // Incremental path: same fingerprint + same columns + pages only grew
      const lastPageRows =
        selectedPages.length > 0
          ? selectedPages[selectedPages.length - 1]!.rows.length
          : 0;
      const canIncrement =
        prev !== null &&
        prev.fingerprint === pipelineFingerprint &&
        prev.columnsKey === columnsKey &&
        selectedPages.length >= prev.pageCount &&
        prev.pageCount > 0;

      if (
        canIncrement &&
        selectedPages.length === prev.pageCount &&
        lastPageRows === prev.lastPageRowCount
      ) {
        // No new pages and last page unchanged — return cached result (same references)
        return {
          tableData: prev.data,
          tableDataById: prev.byId,
          loadedRowCount: prev.data.length,
          baseSearchMatchesByRow: prev.baseSearchMap,
        };
      }

      // Decide start: incremental from prev.pageCount, or full reprocess
      let data: TableRow[];
      let byId: Map<string, TableRow>;
      let seen: Set<string>;
      let baseSearchMap: Map<string, Set<string>>;
      let startPage: number;

      if (canIncrement) {
        // Clone arrays/maps so we return new references for React diffing
        data = prev.data.slice();
        byId = new Map(prev.byId);
        seen = new Set(prev.seen);
        baseSearchMap = normalizedSearch
          ? new Map(prev.baseSearchMap)
          : new Map();
        // If page count is the same but last page content changed (e.g.
        // optimistic row appended), reprocess the last page so new rows
        // get picked up.  The `seen` set prevents duplicates.
        startPage =
          selectedPages.length === prev.pageCount &&
          lastPageRows !== prev.lastPageRowCount
            ? prev.pageCount - 1
            : prev.pageCount;
      } else {
        data = [];
        byId = new Map();
        seen = new Set();
        baseSearchMap = new Map();
        startPage = 0;
      }

      for (let p = startPage; p < selectedPages.length; p++) {
        const page = selectedPages[p]!;
        for (const row of page.rows) {
          if (seen.has(row.id)) continue;
          seen.add(row.id);
          const tableRow = transformRowData(row, orderedColumns);
          let rowSearchMatches: Set<string> | null = null;
          for (const col of orderedColumns) {
            const val = tableRow[col.id] ?? "";
            if (
              normalizedSearch &&
              String(val).toLowerCase().includes(normalizedSearch)
            ) {
              if (!rowSearchMatches) rowSearchMatches = new Set();
              rowSearchMatches.add(col.id);
            }
          }
          data.push(tableRow);
          byId.set(row.id, tableRow);
          if (rowSearchMatches) baseSearchMap.set(row.id, rowSearchMatches);
        }
      }

      // Update cache for next incremental pass
      pipelineCacheRef.current = {
        fingerprint: pipelineFingerprint,
        columnsKey,
        pageCount: selectedPages.length,
        lastPageRowCount:
          selectedPages.length > 0
            ? selectedPages[selectedPages.length - 1]!.rows.length
            : 0,
        data,
        byId,
        seen,
        baseSearchMap,
      };

      return {
        tableData: data,
        tableDataById: byId,
        loadedRowCount: data.length,
        baseSearchMatchesByRow: baseSearchMap,
      };
    }, [
      activeTable,
      selectedPages,
      orderedColumns,
      pipelineFingerprint,
      normalizedSearch,
    ]);

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
  const rowsErrorMessage = rowsQuery.error?.message ?? "Try refreshing again.";

  return {
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
  };
}
