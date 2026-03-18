import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { SPARSE_PAGE_ROWS, SPARSE_DEBOUNCE_MS } from "~/lib/constants";
import { isValidTableId, transformRowData } from "~/lib/utils";
import type { TableRow } from "~/lib/types";
import type { RouterInputs } from "~/trpc/react";
import { api } from "~/trpc/react";

export type UseSparsePageParams = {
  activeTableId: string | null;
  loadedRowCount: number;
  activeRowCount: number;
  sortParam: { columnId: string; direction: "asc" | "desc" }[];
  filterInput: RouterInputs["row"]["getRows"]["filter"];
  searchQuery: string;
  hasSearchQuery: boolean;
  orderedColumnsRef: MutableRefObject<{ id: string; name: string; type: string | null }[]>;
};

export type UseSparsePageReturn = {
  sparseRows: Map<number, TableRow>;
  sparseVersion: number;
  setSparseVersion: React.Dispatch<React.SetStateAction<number>>;
  handleVisibleRangeChange: (startIndex: number, endIndex: number) => void;
  resetSparseCache: () => void;
  sparsePagesRef: MutableRefObject<Map<number, { id: string; data: Record<string, string> }[]>>;
  sparseRowsMapRef: MutableRefObject<Map<number, TableRow>>;
};

export function useSparsePages({
  activeTableId,
  loadedRowCount,
  activeRowCount,
  sortParam,
  filterInput,
  searchQuery,
  hasSearchQuery,
  orderedColumnsRef,
}: UseSparsePageParams): UseSparsePageReturn {
  const utils = api.useUtils();

  // Sparse page cache for instant scroll-to-offset fetching
  const sparsePagesRef = useRef<Map<number, { id: string; data: Record<string, string> }[]>>(new Map());
  const sparseFetchingRef = useRef<Set<number>>(new Set());
  const sparseParamsRef = useRef<string>("");
  // Incremental sparse row map — avoid rebuilding entire Map on each page arrival
  const sparseRowsMapRef = useRef<Map<number, TableRow>>(new Map());
  const sparseProcessedPagesRef = useRef<Set<number>>(new Set());
  // RAF-batched sparse version updates — coalesce rapid page arrivals into fewer re-renders
  const sparseRafRef = useRef<number>(0);

  // Debounce timer for sparse range fetching — coalesces rapid scroll
  // position changes into a single fetch burst for the final position.
  const sparseFetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sparseLastFetchTimeRef = useRef(0);
  const pendingSparseRangeRef = useRef<{ start: number; end: number } | null>(null);
  // Track the user's current viewport page for spiral background prefetch
  const viewportPageRef = useRef(0);

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
        const tableRow = transformRowData(row, cols);
        map.set(offset + i, tableRow);
      }
      sparseProcessedPagesRef.current.add(pageIndex);

      scheduleSparseUpdate();
    },
    [scheduleSparseUpdate, orderedColumnsRef],
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
            const result = await utils.row.getRows.fetch({
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
          } catch (error) {
            console.warn(
              `[useSparsePages] Failed to fetch page ${pageIndex}:`,
              error instanceof Error ? error.message : String(error),
            );
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
      const INITIAL_DELAY = hasSortOrFilter ? 1500 : 50;
      const BATCH_SIZE = hasSortOrFilter ? 3 : 5;
      const BATCH_PAUSE = hasSortOrFilter ? 50 : 10;

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
                const result = await utils.row.getRows.fetch({
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

  // Stable reference to the mutable sparse map — no copying needed.
  // TableView uses sparseVersion (passed as a separate prop) to know
  // when to re-read from this map.
  const sparseRows = sparseRowsMapRef.current;

  return {
    sparseRows,
    sparseVersion,
    setSparseVersion,
    handleVisibleRangeChange,
    resetSparseCache,
    sparsePagesRef,
    sparseRowsMapRef,
  };
}
