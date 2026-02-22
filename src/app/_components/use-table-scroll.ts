import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ROW_HEIGHT = 33;
const ROW_VIRTUAL_OVERSCAN = 50;
const ROW_SCROLLING_RESET_DELAY_MS = 150;
const PAGE_ROWS = 2000;
const ROW_PREFETCH_AHEAD = PAGE_ROWS * 5;
const SPARSE_PREFETCH_BUFFER = 3000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TableRow = Record<string, string> & { id: string };

type ColumnEntry = {
  id: string;
  name: string;
  width: number;
  type: "data" | "add" | "row-number";
};

export type UseTableScrollOptions = {
  /** Total number of rows known to exist (from server), used for scrollbar sizing */
  activeRowCount: number;
  /** Number of rows loaded in contiguous data */
  rowCount: number;
  /** Whether the infinite query has more pages */
  rowsHasNextPage: boolean;
  /** Whether a page is currently being fetched */
  rowsIsFetchingNextPage: boolean;
  /** Trigger fetch of the next infinite-query page */
  rowsFetchNextPage: () => Promise<unknown>;
  /** Contiguous row data array */
  sortedTableData: TableRow[];
  /** Sparse cache for rows beyond infinite query */
  sparseRows: Map<number, TableRow>;
  /** Callback when the visible row range changes (for sparse prefetch) */
  onVisibleRangeChange: (startIndex: number, endIndex: number) => void;
  /** Columns (including row-number & add sentinel) for column virtualizer */
  columnsWithAdd: ColumnEntry[];
  /** Default column width when none specified */
  defaultColumnWidth: number;
  /** Column widths map — triggers column virtualizer remeasure */
  columnWidths: Record<string, number>;
  /** Whether initial loading is in progress */
  showRowsInitialLoading: boolean;
  /** Whether an error occurred loading rows */
  showRowsError: boolean;
  /** Whether the result set is empty */
  showRowsEmpty: boolean;
  /** Whether active filters produced zero results */
  hasActiveFilters: boolean;
  /** The currently expanded row id (long_text column selected) */
  expandedRowId: string | null;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTableScroll({
  activeRowCount,
  rowCount,
  rowsHasNextPage,
  rowsIsFetchingNextPage,
  rowsFetchNextPage,
  sortedTableData,
  sparseRows,
  onVisibleRangeChange,
  columnsWithAdd,
  defaultColumnWidth,
  columnWidths,
  showRowsInitialLoading,
  showRowsError,
  showRowsEmpty,
  hasActiveFilters,
  expandedRowId,
}: UseTableScrollOptions) {
  // -------------------------------------------------------------------------
  // Refs
  // -------------------------------------------------------------------------
  const parentRef = useRef<HTMLDivElement>(null);
  const prefetchingRowsRef = useRef(false);
  const lastScrollPrefetchRef = useRef({ start: -1, end: -1 });

  // -------------------------------------------------------------------------
  // Virtualizer count — full dataset size so the scrollbar reflects reality
  // -------------------------------------------------------------------------
  const virtualizerCount = rowsHasNextPage
    ? Math.max(rowCount + 1, activeRowCount)
    : rowCount;

  // -------------------------------------------------------------------------
  // Row virtualizer
  // -------------------------------------------------------------------------
  const estimateRowSize = useCallback(() => ROW_HEIGHT, []);

  const rowVirtualizer = useVirtualizer({
    count: virtualizerCount,
    getScrollElement: () => parentRef.current,
    estimateSize: estimateRowSize,
    overscan: ROW_VIRTUAL_OVERSCAN,
    // Account for the sticky header that sits above the row canvas inside
    // the same scroll container.  This tells the virtualizer that rows
    // start ROW_HEIGHT px below the scroll container's top edge.
    scrollMargin: ROW_HEIGHT,
    getItemKey: (index) =>
      sortedTableData[index]?.id ??
      sparseRows.get(index)?.id ??
      `placeholder-${index}`,
    isScrollingResetDelay: ROW_SCROLLING_RESET_DELAY_MS,
  });

  const rowVirtualItems = rowVirtualizer.getVirtualItems();

  // -------------------------------------------------------------------------
  // Scroll reset on data changes (sort/filter)
  // -------------------------------------------------------------------------
  const lastDataSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    if (!sortedTableData?.length) {
      lastDataSignatureRef.current = null;
      return;
    }

    try {
      const firstIds = sortedTableData
        .slice(0, 10)
        .map((r) => r?.id ?? "")
        .filter(Boolean)
        .join(",");
      const currentSignature = `${firstIds}`;

      if (
        lastDataSignatureRef.current !== null &&
        lastDataSignatureRef.current !== currentSignature
      ) {
        if (rowVirtualizer?.measure) {
          rowVirtualizer.measure();
        }

        const scrollElement = parentRef.current;
        if (scrollElement) {
          const virtualizerTotalSize = rowVirtualizer.getTotalSize();
          const maxScroll = Math.max(
            0,
            virtualizerTotalSize - scrollElement.clientHeight,
          );
          if (scrollElement.scrollTop > maxScroll) {
            scrollElement.scrollTop = 0;
          }
        }
      }

      lastDataSignatureRef.current = currentSignature;
    } catch (error) {
      console.warn("Error in scroll reset logic:", error);
    }
  }, [sortedTableData]);

  // -------------------------------------------------------------------------
  // Canvas height & virtual ranges
  // -------------------------------------------------------------------------
  const allRowsFiltered = showRowsEmpty && hasActiveFilters;
  // getTotalSize() already excludes the scrollMargin in TanStack Virtual v3,
  // so no additional subtraction is needed.
  const rowCanvasHeight = allRowsFiltered
    ? 0
    : Math.max(
        rowVirtualizer.getTotalSize(),
        showRowsInitialLoading || showRowsError || showRowsEmpty
          ? ROW_HEIGHT * 5
          : 0,
      );

  const rowVirtualRange = useMemo(() => {
    if (!rowVirtualItems.length) return { start: 0, end: 0 };
    return {
      start: rowVirtualItems[0]?.index ?? 0,
      end: rowVirtualItems[rowVirtualItems.length - 1]?.index ?? 0,
    };
  }, [rowVirtualItems]);

  const lastVirtualRowIndex = rowVirtualItems.length
    ? (rowVirtualItems[rowVirtualItems.length - 1]?.index ?? -1)
    : -1;

  // -------------------------------------------------------------------------
  // Column virtualizer
  // -------------------------------------------------------------------------
  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: columnsWithAdd.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) =>
      columnsWithAdd[index]?.width ?? defaultColumnWidth,
    overscan: 12,
    getItemKey: (index) => columnsWithAdd[index]?.id ?? index,
  });

  const virtualColumns = columnVirtualizer.getVirtualItems();

  const columnVirtualRange = useMemo(() => {
    if (!virtualColumns.length) return { start: 0, end: 0 };
    return {
      start: virtualColumns[0]?.index ?? 0,
      end: virtualColumns[virtualColumns.length - 1]?.index ?? 0,
    };
  }, [virtualColumns]);

  // -------------------------------------------------------------------------
  // Remeasure effects
  // -------------------------------------------------------------------------
  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowVirtualizer, expandedRowId]);

  useEffect(() => {
    columnVirtualizer.measure();
  }, [columnVirtualizer, columnWidths, columnsWithAdd.length]);

  // -------------------------------------------------------------------------
  // Visible range reporting (sparse prefetch trigger)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (lastVirtualRowIndex < 0) return;
    const firstIndex = rowVirtualRange.start;
    const bufferSize = SPARSE_PREFETCH_BUFFER;
    const start = Math.max(0, firstIndex - bufferSize);
    const end = Math.min(
      activeRowCount - 1,
      lastVirtualRowIndex + bufferSize,
    );
    onVisibleRangeChange(start, end);
  }, [
    lastVirtualRowIndex,
    rowVirtualRange.start,
    activeRowCount,
    onVisibleRangeChange,
  ]);

  // -------------------------------------------------------------------------
  // Sequential burst-fetch for infinite query
  // When the viewport is near the edge of loaded data, fetch ahead.
  // When the user has scrolled far past loaded data (e.g., jumped to the
  // bottom), skip burst-fetching entirely — the sparse cache handles the
  // visible range much faster than sequential infinite-query page walks.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (lastVirtualRowIndex < 0) return;
    if (!rowsHasNextPage) return;
    if (rowsIsFetchingNextPage) return;
    if (prefetchingRowsRef.current) return;

    const rowsRemaining = rowCount - lastVirtualRowIndex - 1;

    if (rowsRemaining > ROW_PREFETCH_AHEAD) return;

    // If the user has scrolled far past loaded data (gap > 2 pages), don't
    // waste connections fetching intermediate pages — the sparse cache
    // already serves the visible range directly.
    const gap = lastVirtualRowIndex - rowCount;
    if (gap > PAGE_ROWS * 2) return;

    prefetchingRowsRef.current = true;

    // Cap at 2 pages per burst to leave connection headroom for sparse
    // on-demand fetches which serve the actual viewport.
    const pagesNeeded = Math.ceil(
      (ROW_PREFETCH_AHEAD - Math.max(0, rowsRemaining)) / PAGE_ROWS,
    );
    const pagesDeficit = Math.max(1, Math.min(2, pagesNeeded));

    const fetchBurst = async () => {
      for (let i = 0; i < pagesDeficit; i++) {
        await rowsFetchNextPage();
      }
    };

    void fetchBurst().finally(() => {
      prefetchingRowsRef.current = false;
    });
  }, [
    lastVirtualRowIndex,
    rowCount,
    rowsHasNextPage,
    rowsFetchNextPage,
    rowsIsFetchingNextPage,
  ]);

  // -------------------------------------------------------------------------
  // onScroll handler (for the scroll container)
  // -------------------------------------------------------------------------
  const handleScroll = useCallback(
    (el: HTMLDivElement) => {
      // Expose scroll position as CSS variable for clip-path on selected cells
      el.style.setProperty("--scroll-left", `${el.scrollLeft}px`);

      // Fire sparse page prefetch directly from the scroll event
      const scrollTop = el.scrollTop;
      const clientHeight = el.clientHeight;
      const firstVisibleRow = Math.floor(scrollTop / ROW_HEIGHT);
      const lastVisibleRow = Math.ceil(
        (scrollTop + clientHeight) / ROW_HEIGHT,
      );
      const bufferSize = SPARSE_PREFETCH_BUFFER;
      const prefetchStart = Math.max(0, firstVisibleRow - bufferSize);
      const prefetchEnd = Math.min(
        activeRowCount - 1,
        lastVisibleRow + bufferSize,
      );
      const last = lastScrollPrefetchRef.current;
      if (
        Math.abs(prefetchStart - last.start) >= 100 ||
        Math.abs(prefetchEnd - last.end) >= 100
      ) {
        lastScrollPrefetchRef.current = {
          start: prefetchStart,
          end: prefetchEnd,
        };
        onVisibleRangeChange(prefetchStart, prefetchEnd);
      }
    },
    [activeRowCount, onVisibleRangeChange],
  );

  // -------------------------------------------------------------------------
  // Grid pattern SVG (background for row canvas)
  // -------------------------------------------------------------------------
  const addColumnWidth = useMemo(
    () =>
      columnsWithAdd.find((column) => column.type === "add")?.width ?? 93,
    [columnsWithAdd],
  );
  const totalColumnsWidth = useMemo(
    () => columnsWithAdd.reduce((sum, column) => sum + column.width, 0),
    [columnsWithAdd],
  );

  const columnDividerPositions = useMemo(() => {
    const positions: number[] = [];
    let x = 0;
    for (const col of columnsWithAdd) {
      x += col.width;
      if (col.type === "row-number" || col.type === "add") continue;
      if (col.type === "data" && col.name === "Name") continue;
      positions.push(x);
    }
    return positions;
  }, [columnsWithAdd]);

  const gridPatternSvg = useMemo(() => {
    const dataWidth = totalColumnsWidth - addColumnWidth;
    if (dataWidth <= 0) return "";

    const lines: string[] = [];
    lines.push(
      `<line x1='0' y1='${ROW_HEIGHT - 0.5}' x2='${dataWidth}' y2='${ROW_HEIGHT - 0.5}' stroke='%23DDE1E3' stroke-width='1'/>`,
    );
    for (const x of columnDividerPositions) {
      lines.push(
        `<line x1='${x - 0.5}' y1='0' x2='${x - 0.5}' y2='${ROW_HEIGHT}' stroke='%23DDE1E3' stroke-width='1'/>`,
      );
    }

    return `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='${dataWidth}' height='${ROW_HEIGHT}'><rect width='${dataWidth}' height='${ROW_HEIGHT}' fill='white'/>${lines.join("")}</svg>")`;
  }, [totalColumnsWidth, addColumnWidth, columnDividerPositions]);

  const gridPatternSize = useMemo(() => {
    const dataWidth = totalColumnsWidth - addColumnWidth;
    return `${dataWidth}px ${ROW_HEIGHT}px`;
  }, [totalColumnsWidth, addColumnWidth]);

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------
  return {
    // Refs (to be attached to DOM elements)
    parentRef,

    // Row virtualizer
    rowVirtualizer,
    rowVirtualItems,
    rowVirtualRange,
    rowCanvasHeight,
    lastVirtualRowIndex,
    allRowsFiltered,
    isScrolling: rowVirtualizer.isScrolling,

    // Column virtualizer
    columnVirtualizer,
    virtualColumns,
    columnVirtualRange,

    // Grid pattern
    gridPatternSvg,
    gridPatternSize,

    // Scroll handler
    handleScroll,
  };
}
