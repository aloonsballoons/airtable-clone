"use client";

import type {
  Dispatch,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  SetStateAction,
} from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";

import { AddColumnMenu } from "./add-column-menu";
import expandIcon from "~/assets/expand.svg";
import longLineSelectionIcon from "~/assets/long-line-selection.svg";
import nameIcon from "~/assets/name.svg";
import notesIcon from "~/assets/notes.svg";
import assigneeIcon from "~/assets/assignee.svg";
import statusIcon from "~/assets/status.svg";
import attachmentsIcon from "~/assets/attachments.svg";
import numberIcon from "~/assets/number.svg";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ColumnFieldType = "single_line_text" | "long_text" | "number";

type ColumnResizeState = {
  columnId: string;
  startX: number;
  startWidth: number;
};

type TableRow = Record<string, string> & { id: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROW_HEIGHT = 33;
const ROW_NUMBER_COLUMN_WIDTH = 72;
const DEFAULT_COLUMN_WIDTH = 181;
const ADD_COLUMN_WIDTH = 93;
const LONG_TEXT_HEIGHT = 142;
const ROW_VIRTUAL_OVERSCAN = 30;
const ROW_SCROLLING_RESET_DELAY_MS = 150;
const PAGE_ROWS = 2000;
const ROW_PREFETCH_AHEAD = PAGE_ROWS * 5;
const MAX_COLUMNS = 500;
const MAX_ROWS = 2_000_000;
const MAX_NUMBER_DECIMALS = 8;
const STATUS_ICON_SCALE = 1.1;
const STATUS_HEADER_ICON_SIZE = 13 * STATUS_ICON_SCALE;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const columnIconMap: Record<string, string> = {
  Name: nameIcon.src,
  Notes: notesIcon.src,
  Assignee: assigneeIcon.src,
  Status: statusIcon.src,
  Attachments: attachmentsIcon.src,
  Number: numberIcon.src,
};

const columnTypeIconMap: Record<ColumnFieldType, string> = {
  single_line_text: nameIcon.src,
  long_text: notesIcon.src,
  number: numberIcon.src,
};

const coerceColumnType = (value?: string | null): ColumnFieldType =>
  value === "long_text" || value === "number" ? value : "single_line_text";

const getColumnIconSrc = (name: string, type?: string | null) => {
  const resolvedType = coerceColumnType(type);
  return columnIconMap[name] ?? columnTypeIconMap[resolvedType];
};

const isValidNumberDraft = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return true;
  const match = trimmed.match(/^-?\d*(?:\.(\d*))?$/);
  if (!match) return false;
  const decimals = match[1] ?? "";
  return decimals.length <= MAX_NUMBER_DECIMALS;
};

const normalizeNumberInput = (value: string) => {
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

const renderSearchHighlight = (value: string, query: string) => {
  if (!query) return value;
  const normalizedValue = value.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  const firstMatch = normalizedValue.indexOf(normalizedQuery);
  if (firstMatch === -1) return value;
  const parts: ReactNode[] = [];
  let startIndex = 0;
  let matchIndex = firstMatch;
  let matchCount = 0;
  while (matchIndex !== -1) {
    if (matchIndex > startIndex) {
      parts.push(value.slice(startIndex, matchIndex));
    }
    parts.push(
      <mark
        key={`${matchIndex}-${matchCount}`}
        className="airtable-search-highlight"
      >
        {value.slice(matchIndex, matchIndex + query.length)}
      </mark>
    );
    startIndex = matchIndex + query.length;
    matchIndex = normalizedValue.indexOf(normalizedQuery, startIndex);
    matchCount += 1;
  }
  if (startIndex < value.length) {
    parts.push(value.slice(startIndex));
  }
  return parts;
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type TableViewProps = {
  activeTableId: string;
  activeTable: { id: string; name: string };
  activeColumns: { id: string; name: string; type: string | null }[];
  orderedColumns: { id: string; name: string; type: string | null }[];
  columnById: Map<string, { id: string; name: string; type: string | null }>;
  sortedTableData: TableRow[];
  searchMatchesByRow: Map<string, Set<string>>;
  columnsWithSearchMatches: Set<string>;
  columnWidths: Record<string, number>;
  setColumnWidths: Dispatch<SetStateAction<Record<string, number>>>;
  selectedCell: { rowId: string; columnId: string } | null;
  setSelectedCell: Dispatch<
    SetStateAction<{ rowId: string; columnId: string } | null>
  >;
  editingCell: { rowId: string; columnId: string } | null;
  setEditingCell: Dispatch<
    SetStateAction<{ rowId: string; columnId: string } | null>
  >;
  cellEdits: Record<string, Record<string, string>>;
  setCellEdits: Dispatch<
    SetStateAction<Record<string, Record<string, string>>>
  >;
  resizing: ColumnResizeState | null;
  setResizing: Dispatch<SetStateAction<ColumnResizeState | null>>;
  sortedColumnIds: Set<string>;
  filteredColumnIds: Set<string>;
  hiddenColumnIdSet: Set<string>;
  searchQuery: string;
  hasSearchQuery: boolean;
  rowsHasNextPage: boolean;
  rowsIsFetchingNextPage: boolean;
  rowsFetchNextPage: () => Promise<unknown>;
  sparseRows: Map<number, TableRow>;
  onVisibleRangeChange: (startIndex: number, endIndex: number) => void;
  showRowsError: boolean;
  showRowsEmpty: boolean;
  showRowsInitialLoading: boolean;
  rowsErrorMessage: string;
  updateCellMutate: (params: {
    rowId: string;
    columnId: string;
    value: string;
  }) => void;
  addRowsMutate: (params: {
    tableId: string;
    count: number;
    ids?: string[];
    populateWithFaker?: boolean;
  }) => void;
  addColumnMutate: (params: {
    tableId: string;
    name?: string;
    id?: string;
    type?: "single_line_text" | "long_text" | "number";
  }) => void;
  addColumnIsPending: boolean;
  activeRowCount: number; // Filtered row count for display
  totalRowCount: number; // Total unfiltered row count for max row validation
  hasActiveFilters: boolean;
  onClearSearch?: () => void;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TableView({
  activeTableId,
  activeTable,
  activeColumns,
  orderedColumns,
  columnById,
  sortedTableData,
  searchMatchesByRow,
  columnsWithSearchMatches,
  columnWidths,
  setColumnWidths,
  selectedCell,
  setSelectedCell,
  editingCell,
  setEditingCell,
  cellEdits,
  setCellEdits,
  resizing,
  setResizing,
  sortedColumnIds,
  filteredColumnIds,
  hiddenColumnIdSet,
  searchQuery,
  hasSearchQuery,
  rowsHasNextPage,
  rowsIsFetchingNextPage,
  rowsFetchNextPage,
  sparseRows,
  onVisibleRangeChange,
  showRowsError,
  showRowsEmpty,
  showRowsInitialLoading,
  rowsErrorMessage,
  updateCellMutate,
  addRowsMutate,
  addColumnMutate,
  addColumnIsPending,
  activeRowCount,
  totalRowCount,
  hasActiveFilters,
  onClearSearch,
}: TableViewProps) {
  // -------------------------------------------------------------------------
  // Internal state
  // -------------------------------------------------------------------------
  const [addRowHover, setAddRowHover] = useState(false);
  const [scrollbarDragging, setScrollbarDragging] = useState(false);
  const [isAddColumnMenuOpen, setIsAddColumnMenuOpen] = useState(false);
  const [addColumnMenuPosition, setAddColumnMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);

  // -------------------------------------------------------------------------
  // Refs
  // -------------------------------------------------------------------------
  const parentRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const skeletonOverlayRef = useRef<HTMLDivElement>(null);
  const gridOverlayRef = useRef<HTMLDivElement>(null);
  const scrollbarDragRef = useRef(false);
  const addColumnButtonRef = useRef<HTMLButtonElement>(null);
  const addColumnMenuRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef<
    Map<string, HTMLInputElement | HTMLTextAreaElement | null>
  >(new Map());
  const lastFocusedRef = useRef<{
    key: string;
    mode: "select" | "edit";
  } | null>(null);
  const focusTokenRef = useRef(0);
  const prefetchingRowsRef = useRef(false);
  const isAddColumnMenuOpenRef = useRef(isAddColumnMenuOpen);
  const lastScrollPrefetchRef = useRef({ start: -1, end: -1 });

  // -------------------------------------------------------------------------
  // Computed values
  // -------------------------------------------------------------------------
  const rowOrder = useMemo(
    () => sortedTableData.map((row) => row.id),
    [sortedTableData],
  );

  const columnOrder = useMemo(
    () => orderedColumns.map((column) => column.id),
    [orderedColumns],
  );

  const columnsWithAdd = useMemo(
    () => [
      {
        id: "__row-number__",
        name: "Row",
        width: ROW_NUMBER_COLUMN_WIDTH,
        type: "row-number" as const,
      },
      ...orderedColumns.map((column) => ({
        id: column.id,
        name: column.name,
        fieldType: coerceColumnType(column.type),
        width: columnWidths[column.id] ?? DEFAULT_COLUMN_WIDTH,
        type: "data" as const,
      })),
      {
        id: "__add__",
        name: "Add column",
        width: ADD_COLUMN_WIDTH,
        type: "add" as const,
      },
    ],
    [columnWidths, orderedColumns],
  );

  const totalColumnsWidth = useMemo(
    () => columnsWithAdd.reduce((sum, column) => sum + column.width, 0),
    [columnsWithAdd],
  );
  const addColumnWidth = useMemo(
    () =>
      columnsWithAdd.find((column) => column.type === "add")?.width ??
      ADD_COLUMN_WIDTH,
    [columnsWithAdd],
  );
  const rowNumberColumnIndex = columnsWithAdd.findIndex(
    (column) => column.type === "row-number",
  );
  const rowNumberColumn =
    rowNumberColumnIndex >= 0 ? columnsWithAdd[rowNumberColumnIndex] : null;
  const rowNumberColumnWidth =
    rowNumberColumn?.width ?? ROW_NUMBER_COLUMN_WIDTH;
  const dataColumnsWidth = Math.max(
    0,
    totalColumnsWidth - addColumnWidth - rowNumberColumnWidth,
  );

  const rowCount = sortedTableData.length;
  // Use the server-reported total filtered count so the scroll area reflects
  // the full dataset, not just the currently loaded rows. This prevents the
  // scrollbar from acting as if the loaded page is the entire table.
  const virtualizerCount = rowsHasNextPage
    ? Math.max(rowCount + 1, activeRowCount)
    : rowCount;
  const addRowDisabled = !activeTableId || totalRowCount >= MAX_ROWS;

  const expandedRowId = useMemo(() => {
    if (!selectedCell) return null;
    const selectedColumn = orderedColumns.find(
      (column) => column.id === selectedCell.columnId,
    );
    const selectedType = coerceColumnType(selectedColumn?.type);
    return selectedType === "long_text" ? selectedCell.rowId : null;
  }, [orderedColumns, selectedCell]);

  // Constant height — expanded cells use overlays, not taller rows.
  const estimateRowSize = useCallback(() => ROW_HEIGHT, []);

  // -------------------------------------------------------------------------
  // Virtualizers
  // -------------------------------------------------------------------------
  const rowVirtualizer = useVirtualizer({
    count: virtualizerCount,
    getScrollElement: () => parentRef.current,
    estimateSize: estimateRowSize,
    overscan: ROW_VIRTUAL_OVERSCAN,
    getItemKey: (index) => sortedTableData[index]?.id ?? sparseRows.get(index)?.id ?? `placeholder-${index}`,
    isScrollingResetDelay: ROW_SCROLLING_RESET_DELAY_MS,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  // Use virtual items directly - no caching to avoid stale data during sorts/filters
  const rowVirtualItems = virtualItems;

  // Track when sortedTableData changes significantly and reset scroll if needed
  const lastDataSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    if (!sortedTableData?.length) {
      lastDataSignatureRef.current = null;
      return;
    }

    try {
      // Create a signature from first few row IDs only to detect data changes
      // Don't include last row IDs to avoid triggering on pagination appends
      const firstIds = sortedTableData.slice(0, 10).map(r => r?.id ?? '').filter(Boolean).join(',');
      const currentSignature = `${firstIds}`;

      if (lastDataSignatureRef.current !== null &&
          lastDataSignatureRef.current !== currentSignature) {
        // Data changed significantly (sort/filter applied)
        // Force virtualizer to remeasure immediately
        if (rowVirtualizer?.measure) {
          rowVirtualizer.measure();
        }

        // Check if current scroll position is beyond new data bounds
        // Use virtualizer's total size for accurate scroll calculations
        const scrollElement = parentRef.current;
        if (scrollElement) {
          const virtualizerTotalSize = rowVirtualizer.getTotalSize();
          const maxScroll = Math.max(0, virtualizerTotalSize - scrollElement.clientHeight);
          if (scrollElement.scrollTop > maxScroll) {
            // Scrolled beyond new data, reset to top
            scrollElement.scrollTop = 0;
          }
        }
      }

      lastDataSignatureRef.current = currentSignature;
    } catch (error) {
      // Silently handle any errors in data signature calculation
      console.warn('Error in scroll reset logic:', error);
    }
  }, [sortedTableData]);
  const allRowsFiltered = showRowsEmpty && hasActiveFilters;
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

  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: columnsWithAdd.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) =>
      columnsWithAdd[index]?.width ?? DEFAULT_COLUMN_WIDTH,
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
  const nameColumnIndex = columnsWithAdd.findIndex(
    (column) => column.type === "data" && column.name === "Name",
  );
  const nameColumn =
    nameColumnIndex >= 0 ? columnsWithAdd[nameColumnIndex] : null;
  const nameColumnWidth = nameColumn?.width ?? 0;
  const stickyColumnsWidth = rowNumberColumnWidth + nameColumnWidth;
  const scrollableVirtualColumns = virtualColumns.filter((virtualColumn) => {
    if (
      rowNumberColumnIndex >= 0 &&
      virtualColumn.index === rowNumberColumnIndex
    ) {
      return false;
    }
    if (nameColumnIndex >= 0 && virtualColumn.index === nameColumnIndex) {
      return false;
    }
    return true;
  });
  const scrollablePaddingLeft = Math.max(
    0,
    (scrollableVirtualColumns[0]?.start ?? stickyColumnsWidth) -
      stickyColumnsWidth,
  );
  const totalScrollableWidth = Math.max(
    0,
    totalColumnsWidth - stickyColumnsWidth,
  );
  const lastScrollableEnd = Math.max(
    0,
    (scrollableVirtualColumns.at(-1)?.end ?? stickyColumnsWidth) -
      stickyColumnsWidth,
  );
  const scrollablePaddingRight = Math.max(
    0,
    totalScrollableWidth - lastScrollableEnd,
  );

  // Column divider positions (right edge of each data column, excluding
  // row-number, Name, and add-column — those have their own treatment).
  // Used to draw persistent vertical grid lines on the row canvas background.
  const columnDividerPositions = useMemo(() => {
    const positions: number[] = [];
    let x = 0;
    for (const col of columnsWithAdd) {
      x += col.width;
      // Skip row-number (no divider) and add column (no divider)
      if (col.type === "row-number" || col.type === "add") continue;
      // Skip Name column (has its own full-height divider)
      if (col.type === "data" && col.name === "Name") continue;
      positions.push(x);
    }
    return positions;
  }, [columnsWithAdd]);

  // SVG tile for grid lines — applied directly as a CSS background on
  // the row canvas.  The tile (dataWidth × ROW_HEIGHT) repeats vertically.
  // Because the background shares the same coordinate system as the
  // absolutely-positioned virtual rows, the grid lines stay aligned
  // during fast scrolling without any JavaScript adjustment.
  const gridPatternSvg = useMemo(() => {
    const dataWidth = totalColumnsWidth - addColumnWidth;
    if (dataWidth <= 0) return "";

    const lines: string[] = [];
    lines.push(
      `<line x1="0" y1="${ROW_HEIGHT - 0.5}" x2="${dataWidth}" y2="${ROW_HEIGHT - 0.5}" stroke="%23DDE1E3" stroke-width="1"/>`
    );
    for (const x of columnDividerPositions) {
      lines.push(
        `<line x1="${x - 0.5}" y1="0" x2="${x - 0.5}" y2="${ROW_HEIGHT}" stroke="%23DDE1E3" stroke-width="1"/>`
      );
    }

    return `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='${dataWidth}' height='${ROW_HEIGHT}'><rect width='${dataWidth}' height='${ROW_HEIGHT}' fill='white'/>${lines.join("")}</svg>")`;
  }, [totalColumnsWidth, addColumnWidth, columnDividerPositions]);

  const gridPatternSize = useMemo(() => {
    const dataWidth = totalColumnsWidth - addColumnWidth;
    return `${dataWidth}px ${ROW_HEIGHT}px`;
  }, [totalColumnsWidth, addColumnWidth]);

  // Skeleton SVG tile — same grid as gridPatternSvg but with gray shimmer
  // bars in each cell.  Used by the drag-scroll skeleton overlay.
  const skeletonPatternSvg = useMemo(() => {
    const dataWidth = totalColumnsWidth - addColumnWidth;
    if (dataWidth <= 0) return "";
    const parts: string[] = [];
    parts.push(
      `<rect width="${dataWidth}" height="${ROW_HEIGHT}" fill="white"/>`
    );
    parts.push(
      `<line x1="0" y1="${ROW_HEIGHT - 0.5}" x2="${dataWidth}" y2="${ROW_HEIGHT - 0.5}" stroke="%23DDE1E3" stroke-width="1"/>`
    );
    for (const x of columnDividerPositions) {
      parts.push(
        `<line x1="${x - 0.5}" y1="0" x2="${x - 0.5}" y2="${ROW_HEIGHT}" stroke="%23DDE1E3" stroke-width="1"/>`
      );
    }
    const barY = Math.round((ROW_HEIGHT - 12) / 2);
    let colX = 0;
    for (const col of columnsWithAdd) {
      if (col.type === "add") break;
      const barW = Math.min(col.width * 0.6, 120);
      if (barW > 4) {
        parts.push(
          `<rect x="${colX + 8}" y="${barY}" width="${barW}" height="12" rx="4" fill="%23E8E8E8"/>`
        );
      }
      colX += col.width;
    }
    return `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='${dataWidth}' height='${ROW_HEIGHT}'>${parts.join("")}</svg>")`;
  }, [totalColumnsWidth, addColumnWidth, columnDividerPositions, columnsWithAdd]);

  // -------------------------------------------------------------------------
  // Border helpers
  // -------------------------------------------------------------------------
  const headerCellBorder = (
    column: { name: string; type: "data" | "add" | "row-number" },
    isFirst: boolean,
  ) => ({
    borderTop: "none",
    borderBottom: "0.5px solid #CBCBCB",
    borderRight:
      column.type === "row-number" ||
      (column.type === "data" && column.name === "Name")
        ? "none"
        : "1px solid #DDE1E3",
    borderLeft: "none",
  });

  const bodyCellBorder = (
    column: { name: string; type: "data" | "add" | "row-number" },
    isFirst: boolean,
    isLastRow: boolean,
  ) => ({
    borderBottom: isLastRow ? "none" : "1px solid #DDE1E3",
    borderRight:
      column.type === "row-number" ||
      (column.type === "data" && column.name === "Name")
        ? "none"
        : "1px solid #DDE1E3",
    borderLeft: "none",
  });

  // -------------------------------------------------------------------------
  // Cell editing handlers
  // -------------------------------------------------------------------------
  const setCellEditValue = (
    rowId: string,
    columnId: string,
    value: string,
  ) => {
    const columnType = coerceColumnType(columnById.get(columnId)?.type);
    if (columnType === "number" && !isValidNumberDraft(value)) {
      return false;
    }
    setCellEdits((prev) => ({
      ...prev,
      [rowId]: {
        ...prev[rowId],
        [columnId]: value,
      },
    }));
    updateCellMutate({ rowId, columnId, value });
    return true;
  };

  const clearCellEdit = (rowId: string, columnId: string) => {
    setCellEdits((prev) => {
      const rowEdits = prev[rowId];
      if (!rowEdits || !(columnId in rowEdits)) return prev;
      const { [columnId]: _removed, ...rest } = rowEdits;
      if (Object.keys(rest).length === 0) {
        const { [rowId]: _rowRemoved, ...next } = prev;
        return next;
      }
      return { ...prev, [rowId]: rest };
    });
  };

  const handleCellChange = (
    rowId: string,
    columnId: string,
    value: string,
  ) => {
    setCellEditValue(rowId, columnId, value);
  };

  const handleCellCommit = (
    rowId: string,
    columnId: string,
    value: string,
  ) => {
    const columnType = coerceColumnType(columnById.get(columnId)?.type);
    if (columnType === "number") {
      const normalized = normalizeNumberInput(value);
      if (normalized !== null && normalized !== value) {
        setCellEditValue(rowId, columnId, normalized);
      }
    }
    clearCellEdit(rowId, columnId);
  };

  const beginEditExisting = (rowId: string, columnId: string) => {
    setSelectedCell({ rowId, columnId });
    setEditingCell({ rowId, columnId });
  };

  const focusCell = (rowId: string, columnId: string) => {
    const rowIndex = rowOrder.indexOf(rowId);
    const colIndex = columnOrder.indexOf(columnId);
    if (rowIndex >= 0) {
      rowVirtualizer.scrollToIndex(rowIndex);
    }
    if (colIndex >= 0) {
      columnVirtualizer.scrollToIndex(colIndex);
    }
    setSelectedCell({ rowId, columnId });
    const key = `${rowId}-${columnId}`;
    const node = cellRefs.current.get(key);
    if (node && "setSelectionRange" in node) {
      node.focus();
      node.setSelectionRange(0, 0);
    }
  };

  const isPrintableKey = (
    event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) =>
    event.key.length === 1 &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey;

  const handleCellKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    rowId: string,
    columnId: string,
    columnType: ColumnFieldType,
    currentValue: string,
  ) => {
    if (columnOrder.length === 0 || rowOrder.length === 0) return;
    const rowIndex = rowOrder.indexOf(rowId);
    const colIndex = columnOrder.indexOf(columnId);
    if (rowIndex === -1 || colIndex === -1) return;

    const isEditing =
      editingCell?.rowId === rowId && editingCell?.columnId === columnId;
    const isLongText = columnType === "long_text";

    const navigate = () => {
      let nextRow = rowIndex;
      let nextCol = colIndex;

      if (event.key === "ArrowRight") {
        nextCol = Math.min(columnOrder.length - 1, colIndex + 1);
      } else if (event.key === "ArrowLeft") {
        nextCol = Math.max(0, colIndex - 1);
      } else if (event.key === "ArrowDown") {
        nextRow = Math.min(rowOrder.length - 1, rowIndex + 1);
      } else if (event.key === "ArrowUp") {
        nextRow = Math.max(0, rowIndex - 1);
      } else if (event.key === "Tab") {
        if (event.shiftKey) {
          if (colIndex > 0) {
            nextCol = colIndex - 1;
          } else if (rowIndex > 0) {
            nextRow = rowIndex - 1;
            nextCol = columnOrder.length - 1;
          }
        } else if (colIndex < columnOrder.length - 1) {
          nextCol = colIndex + 1;
        } else if (rowIndex < rowOrder.length - 1) {
          nextRow = rowIndex + 1;
          nextCol = 0;
        }
      } else {
        return;
      }

      event.preventDefault();
      focusCell(rowOrder[nextRow]!, columnOrder[nextCol]!);
    };

    if (!isEditing) {
      if (
        event.key === "ArrowRight" ||
        event.key === "ArrowLeft" ||
        event.key === "ArrowDown" ||
        event.key === "ArrowUp" ||
        event.key === "Tab"
      ) {
        navigate();
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        const nextValue = isLongText ? `${currentValue}\n` : currentValue;
        setSelectedCell({ rowId, columnId });
        setEditingCell({ rowId, columnId });
        if (isLongText) {
          setCellEditValue(rowId, columnId, nextValue);
        }
        return;
      }

      if (
        isPrintableKey(event) ||
        event.key === "Backspace" ||
        event.key === "Delete"
      ) {
        event.preventDefault();
        const nextValue =
          event.key === "Backspace" || event.key === "Delete"
            ? ""
            : isLongText
              ? `${currentValue}${event.key}`
              : event.key;
        if (!setCellEditValue(rowId, columnId, nextValue)) {
          return;
        }
        setSelectedCell({ rowId, columnId });
        setEditingCell({ rowId, columnId });
      }
      return;
    }

    if (!isLongText && event.key === "Enter") {
      event.preventDefault();
      handleCellCommit(rowId, columnId, currentValue);
      setEditingCell(null);
      const nextRow = Math.min(rowOrder.length - 1, rowIndex + 1);
      focusCell(rowOrder[nextRow]!, columnId);
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      handleCellCommit(rowId, columnId, currentValue);
      setEditingCell(null);
      navigate();
    }
  };

  // -------------------------------------------------------------------------
  // Event handlers
  // -------------------------------------------------------------------------
  const handleAddRow = () => {
    if (!activeTableId) return;
    addRowsMutate({
      tableId: activeTableId,
      count: 1,
      ids: [crypto.randomUUID()],
    });
  };

  const handleCreateColumn = (name: string, type: ColumnFieldType) => {
    if (!activeTableId) return;
    addColumnMutate({
      tableId: activeTableId,
      name,
      id: crypto.randomUUID(),
      type,
    });
  };

  const handleStartResize = (event: ReactMouseEvent, columnId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setResizing({
      columnId,
      startX: event.clientX,
      startWidth: columnWidths[columnId] ?? DEFAULT_COLUMN_WIDTH,
    });
  };

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------
  useEffect(() => {
    isAddColumnMenuOpenRef.current = isAddColumnMenuOpen;
  }, [isAddColumnMenuOpen]);

  const updateAddColumnMenuPosition = useCallback(() => {
    if (!addColumnButtonRef.current) return null;
    const rect = addColumnButtonRef.current.getBoundingClientRect();
    // Menu has width 400 and "right: 5" from anchor → align menu right with button right
    const left = rect.right - 395;
    const top = rect.bottom + 2;
    setAddColumnMenuPosition({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!isAddColumnMenuOpen) {
      setAddColumnMenuPosition(null);
      return;
    }
    updateAddColumnMenuPosition();
    const onScrollOrResize = () => updateAddColumnMenuPosition();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [isAddColumnMenuOpen, updateAddColumnMenuPosition]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      // Check if clicking outside add column menu
      if (
        isAddColumnMenuOpenRef.current &&
        addColumnMenuRef.current &&
        !addColumnMenuRef.current.contains(target) &&
        addColumnButtonRef.current &&
        !addColumnButtonRef.current.contains(target)
      ) {
        setIsAddColumnMenuOpen(false);
      }

      // Don't clear selection if clicking on the add column button or menu
      if (
        addColumnButtonRef.current?.contains(target) ||
        addColumnMenuRef.current?.contains(target)
      ) {
        return;
      }

      // Don't clear selection if clicking on a cell
      const isClickingCell = target.closest('.airtable-cell');
      if (isClickingCell) {
        return;
      }

      // Clear selection when clicking anywhere else
      setSelectedCell(null);
      setEditingCell(null);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [setSelectedCell, setEditingCell]);

  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowVirtualizer, expandedRowId]);

  useEffect(() => {
    columnVirtualizer.measure();
  }, [columnVirtualizer, columnWidths, columnsWithAdd.length]);


  useEffect(() => {
    const focusTarget = editingCell ?? selectedCell;
    if (!focusTarget) {
      lastFocusedRef.current = null;
      return;
    }
    const token = (focusTokenRef.current += 1);
    requestAnimationFrame(() => {
      if (token !== focusTokenRef.current) return;
      const key = `${focusTarget.rowId}-${focusTarget.columnId}`;
      const node = cellRefs.current.get(key);
      if (!node || !("setSelectionRange" in node)) return;
      const mode = editingCell ? "edit" : "select";
      const last = lastFocusedRef.current;
      if (
        last &&
        last.key === key &&
        last.mode === mode &&
        document.activeElement === node
      ) {
        return;
      }
      node.focus();
      if (editingCell) {
        const length = node.value.length;
        node.setSelectionRange(length, length);
      } else {
        node.setSelectionRange(0, 0);
      }
      lastFocusedRef.current = { key, mode };
    });
  }, [
    editingCell,
    selectedCell,
    rowVirtualRange.start,
    rowVirtualRange.end,
    columnVirtualRange.start,
    columnVirtualRange.end,
  ]);

  // Report visible range so parent can fetch sparse pages directly.
  // Uses useLayoutEffect to fire synchronously after render — earlier than
  // useEffect — so the fetch request is dispatched before the browser paints
  // the skeleton frame.  Large buffer ensures data is pre-fetched well ahead.
  useLayoutEffect(() => {
    if (lastVirtualRowIndex < 0) return;
    const firstIndex = rowVirtualRange.start;
    // Large buffer: prefetch well beyond visible area so scrolling finds data ready
    const bufferSize = ROW_VIRTUAL_OVERSCAN * 4;
    const start = Math.max(0, firstIndex - bufferSize);
    const end = Math.min(activeRowCount - 1, lastVirtualRowIndex + bufferSize);
    onVisibleRangeChange(start, end);
  }, [lastVirtualRowIndex, rowVirtualRange.start, activeRowCount, onVisibleRangeChange]);

  // Sequential burst-fetch for infinite query (keeps sequential pages loading in background)
  useEffect(() => {
    if (lastVirtualRowIndex < 0) return;
    if (!rowsHasNextPage) return;
    if (rowsIsFetchingNextPage) return;
    if (prefetchingRowsRef.current) return;

    const rowsRemaining = rowCount - lastVirtualRowIndex - 1;

    if (rowsRemaining > ROW_PREFETCH_AHEAD) return;

    prefetchingRowsRef.current = true;

    // Fetch multiple pages at once to build the prefetch buffer faster.
    // When scrolling normally, fetch enough to fill the buffer in one burst
    // rather than one page per effect cycle.
    const pagesNeeded = Math.ceil((ROW_PREFETCH_AHEAD - Math.max(0, rowsRemaining)) / PAGE_ROWS);
    const pagesDeficit = rowsRemaining <= 0
      ? Math.min(10, Math.ceil((lastVirtualRowIndex - rowCount + 1) / PAGE_ROWS) + 2)
      : Math.max(1, Math.min(5, pagesNeeded));

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
  // Scrollbar drag detection — show skeleton overlay while dragging
  // -------------------------------------------------------------------------
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;

    const handleMouseDown = (e: MouseEvent) => {
      // Only detect clicks directly on the scroll container (i.e. the
      // scrollbar track/thumb), not on child elements.
      if (e.target !== el) return;
      const onVScrollbar = e.offsetX >= el.clientWidth;
      const onHScrollbar = e.offsetY >= el.clientHeight;
      if (onVScrollbar || onHScrollbar) {
        scrollbarDragRef.current = true;
        setScrollbarDragging(true);
      }
    };

    const handleMouseUp = () => {
      if (scrollbarDragRef.current) {
        scrollbarDragRef.current = false;
        setScrollbarDragging(false);
      }
    };

    el.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      el.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="relative h-full flex flex-col">
      <div className="relative flex-1 w-full flex flex-col" style={{ minHeight: 0 }}>
        {/* Header section - outside scrollable area so scrollbar doesn't extend into it */}
        <div
          ref={headerScrollRef}
          className="airtable-header-scroll relative shrink-0 w-full overflow-x-auto overflow-y-visible"
          style={{
            backgroundColor: "#ffffff",
            scrollbarWidth: "none",
            msOverflowStyle: "none",
          }}
        >
          <div
            className="flex text-[13px] font-medium text-[#1d1f24] relative"
            style={{ width: totalColumnsWidth }}
          >
            {rowNumberColumn && (
              <div
                className="airtable-sticky-column relative flex h-[33px] items-center px-2 text-[12px] font-normal text-[#606570]"
                style={{
                  borderTop: "none",
                  borderBottom: "0.5px solid #CBCBCB",
                  borderLeft: "none",
                  borderRight: "none",
                  width: rowNumberColumnWidth,
                  minWidth: rowNumberColumnWidth,
                  maxWidth: rowNumberColumnWidth,
                  flex: "0 0 auto",
                  backgroundColor: "#ffffff",
                  position: "sticky",
                  left: 0,
                  zIndex: 100,
                  transform: "translateZ(0)",
                }}
                aria-hidden="true"
              >
                <div className="airtable-outline flex h-[17px] w-[17px] items-center justify-center rounded-[4px] bg-white" />
              </div>
            )}
            {nameColumn && (
              <div
                className="airtable-sticky-column airtable-header-cell relative flex h-[33px] items-center gap-2 px-2"
                style={{
                  ...headerCellBorder(nameColumn, true),
                  width: nameColumnWidth,
                  minWidth: nameColumnWidth,
                  maxWidth: nameColumnWidth,
                  flex: "0 0 auto",
                  ["--header-base-bg" as string]: columnsWithSearchMatches.has(nameColumn.id)
                    ? "#F1EBD3"
                    : filteredColumnIds.has(nameColumn.id)
                    ? "#F6FBF9"
                    : sortedColumnIds.has(nameColumn.id)
                    ? "var(--airtable-sort-header-bg)"
                    : "#ffffff",
                  position: "sticky",
                  left: rowNumberColumnWidth,
                  zIndex: 90,
                  transform: "translateZ(0)",
                }}
              >
                {nameColumn.type === "data" &&
                  getColumnIconSrc(nameColumn.name, nameColumn.fieldType) && (
                  <img
                    alt=""
                    className={clsx(
                      "airtable-header-icon h-[13px] w-[13px]",
                      (sortedColumnIds.has(nameColumn.id) ||
                        filteredColumnIds.has(nameColumn.id)) &&
                        "airtable-column-icon--sorted",
                      columnsWithSearchMatches.has(nameColumn.id) &&
                        "airtable-column-icon--search-match"
                    )}
                    style={
                      nameColumn.name === "Status"
                        ? {
                            width: STATUS_HEADER_ICON_SIZE,
                            height: STATUS_HEADER_ICON_SIZE,
                          }
                        : undefined
                    }
                    src={getColumnIconSrc(
                      nameColumn.name,
                      nameColumn.fieldType
                    )}
                  />
                )}
                <span>{nameColumn.name}</span>
                <div
                  role="separator"
                  aria-label="Resize column"
                  className="absolute right-0 top-0 h-full w-[6px] cursor-col-resize"
                  onMouseDown={(event) =>
                    handleStartResize(event, nameColumn.id)
                  }
                />
              </div>
            )}
            {scrollablePaddingLeft > 0 && (
              <div style={{ width: scrollablePaddingLeft }} />
            )}
            {scrollableVirtualColumns.map((virtualColumn) => {
              const column = columnsWithAdd[virtualColumn.index];
              if (!column) return null;
              const cellStyle = headerCellBorder(column, false);
              const isSortedColumn =
                column.type === "data" && sortedColumnIds.has(column.id);
              const isFilteredColumn =
                column.type === "data" && filteredColumnIds.has(column.id);
              const hasSearchMatch =
                column.type === "data" && columnsWithSearchMatches.has(column.id);
              const baseBackgroundColor =
                hasSearchMatch
                  ? "#F1EBD3"
                  : isFilteredColumn
                  ? "#F6FBF9"
                  : isSortedColumn
                  ? "var(--airtable-sort-header-bg)"
                  : "#ffffff";

              if (column.type === "add") {
                return (
                  <div
                    key={column.id}
                    className="airtable-header-cell relative"
                    style={{
                      ...cellStyle,
                      width: virtualColumn.size,
                      flex: "0 0 auto",
                      ["--header-base-bg" as string]: baseBackgroundColor,
                    }}
                  >
                    <button
                      ref={addColumnButtonRef}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (activeColumns.length >= MAX_COLUMNS) return;
                        setIsAddColumnMenuOpen((prev) => !prev);
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                      }}
                      disabled={activeColumns.length >= MAX_COLUMNS}
                      className="flex h-[33px] w-full cursor-pointer items-center justify-center text-[#1d1f24] disabled:cursor-not-allowed"
                      aria-label="Add column"
                    >
                      <span className="airtable-plus-icon" aria-hidden="true" />
                    </button>
                    {isAddColumnMenuOpen &&
                      addColumnMenuPosition &&
                      typeof document !== "undefined" &&
                      createPortal(
                        <div
                          ref={addColumnMenuRef}
                          style={{
                            position: "fixed",
                            top: addColumnMenuPosition.top,
                            left: addColumnMenuPosition.left,
                            width: 400,
                            zIndex: 9999,
                          }}
                        >
                          <AddColumnMenu
                            existingColumnNames={activeColumns.map((col) => col.name)}
                            onCreateColumn={handleCreateColumn}
                            onClose={() => setIsAddColumnMenuOpen(false)}
                          />
                        </div>,
                        document.body
                      )}
                  </div>
                );
              }

              return (
                <div
                  key={column.id}
                  className="airtable-header-cell relative flex h-[33px] items-center gap-2 px-2"
                  style={{
                    ...cellStyle,
                    width: virtualColumn.size,
                    flex: "0 0 auto",
                    ["--header-base-bg" as string]: baseBackgroundColor,
                  }}
                >
                  {column.type === "data" &&
                    getColumnIconSrc(column.name, column.fieldType) && (
                    <img
                      alt=""
                      className={clsx(
                        "airtable-header-icon h-[13px] w-[13px]",
                        (isSortedColumn || isFilteredColumn) &&
                          "airtable-column-icon--sorted",
                        hasSearchMatch &&
                          "airtable-column-icon--search-match"
                      )}
                      style={
                        column.name === "Status"
                          ? {
                              width: STATUS_HEADER_ICON_SIZE,
                              height: STATUS_HEADER_ICON_SIZE,
                            }
                          : undefined
                      }
                      src={getColumnIconSrc(
                        column.name,
                        column.fieldType
                      )}
                    />
                  )}
                  <span>{column.name}</span>
                  <div
                    role="separator"
                    aria-label="Resize column"
                    className="absolute right-0 top-0 h-full w-[6px] cursor-col-resize"
                    onMouseDown={(event) =>
                      handleStartResize(event, column.id)
                    }
                  />
                </div>
              );
            })}
            {scrollablePaddingRight > 0 && (
              <div style={{ width: scrollablePaddingRight }} />
            )}
            <div
              className="pointer-events-none absolute bottom-0 left-0 right-0 z-40 h-px bg-[#CBCBCB]"
              aria-hidden="true"
            />
          </div>
        </div>

        {/* Scrollable rows container */}
        <div
          ref={parentRef}
          className="relative flex-1 w-full overflow-auto"
          style={{
            backgroundColor: "#F7F8FC",
            minHeight: 0,
          }}
          onScroll={(e) => {
            const el = e.currentTarget;
            // Sync horizontal scroll with header
            if (headerScrollRef.current) {
              headerScrollRef.current.scrollLeft = el.scrollLeft;
            }
            // Expose scroll position as CSS variable for clip-path on selected cells
            el.style.setProperty("--scroll-left", `${el.scrollLeft}px`);
            // Keep overlays aligned to the row grid during scroll.
            const scrollTopMod = `${-(el.scrollTop % ROW_HEIGHT)}px`;
            if (gridOverlayRef.current) {
              gridOverlayRef.current.style.backgroundPositionY = scrollTopMod;
            }
            if (skeletonOverlayRef.current) {
              skeletonOverlayRef.current.style.backgroundPositionY = scrollTopMod;
            }

            // Fire sparse page prefetch directly from the scroll event for
            // minimum latency.  This runs synchronously during scroll, before
            // the React render cycle, giving fetches an extra frame head start.
            const scrollTop = el.scrollTop;
            const clientHeight = el.clientHeight;
            const firstVisibleRow = Math.floor(scrollTop / ROW_HEIGHT);
            const lastVisibleRow = Math.ceil((scrollTop + clientHeight) / ROW_HEIGHT);
            const bufferSize = ROW_VIRTUAL_OVERSCAN * 4;
            const prefetchStart = Math.max(0, firstVisibleRow - bufferSize);
            const prefetchEnd = Math.min(activeRowCount - 1, lastVisibleRow + bufferSize);
            const last = lastScrollPrefetchRef.current;
            // Only dispatch when the range shifts significantly (≥100 rows)
            if (Math.abs(prefetchStart - last.start) >= 100 || Math.abs(prefetchEnd - last.end) >= 100) {
              lastScrollPrefetchRef.current = { start: prefetchStart, end: prefetchEnd };
              onVisibleRangeChange(prefetchStart, prefetchEnd);
            }
          }}
        >
          <div
            className="airtable-row-canvas relative"
            style={{
              width: totalColumnsWidth,
              minWidth: totalColumnsWidth,
              height: rowCanvasHeight,
              // Grid pattern applied directly to the canvas so it scrolls
              // natively with the content — no JS alignment, no 1-frame lag.
              // repeat-y tiles vertically across the data-column width only;
              // the add-column area remains transparent (parent gray shows).
              ...(gridPatternSvg
                ? {
                    backgroundImage: gridPatternSvg,
                    backgroundSize: gridPatternSize,
                    backgroundRepeat: "repeat-y" as const,
                  }
                : {}),
            }}
          >
            {/* Persistent grid overlay — always in the DOM, sits BELOW virtual
                rows (z-index 0).  Where virtual rows exist they paint on top
                and hide it.  Where rows are absent (scroll gaps), the overlay
                shows through as a perfect grid, making gaps invisible.  Uses
                position:sticky so it always covers the viewport. */}
            {gridPatternSvg && (
              <div
                ref={gridOverlayRef}
                aria-hidden="true"
                className="airtable-grid-overlay"
                style={{
                  position: "sticky",
                  top: 0,
                  left: 0,
                  width: totalColumnsWidth - addColumnWidth,
                  height: `min(100vh, ${rowCanvasHeight}px)`,
                  marginBottom: `max(-100vh, ${-rowCanvasHeight}px)`,
                  pointerEvents: "none",
                  zIndex: 0,
                  backgroundColor: "#ffffff",
                  backgroundImage: gridPatternSvg,
                  backgroundSize: gridPatternSize,
                  backgroundRepeat: "repeat",
                  backgroundPositionX: "0",
                  backgroundPositionY: `${-(parentRef.current?.scrollTop ?? 0) % ROW_HEIGHT}px`,
                }}
              />
            )}
            {/* Skeleton overlay — shown during scrollbar drag to give a
                consistent loading appearance.  Sits above all virtual rows
                (z-index 200) so the user sees skeleton cells with shimmer
                instead of stale / partially-rendered data.  Removed the
                instant the drag ends, revealing the real rows beneath. */}
            {scrollbarDragging && skeletonPatternSvg && (
              <div
                ref={skeletonOverlayRef}
                aria-hidden="true"
                className="airtable-skeleton-overlay"
                style={{
                  position: "sticky",
                  top: 0,
                  width: totalColumnsWidth - addColumnWidth,
                  height: `min(100vh, ${rowCanvasHeight}px)`,
                  marginBottom: `max(-100vh, ${-rowCanvasHeight}px)`,
                  pointerEvents: "none",
                  zIndex: 200,
                  backgroundColor: "#ffffff",
                  backgroundImage: skeletonPatternSvg,
                  backgroundSize: gridPatternSize,
                  backgroundRepeat: "repeat",
                  backgroundPositionX: "0",
                  backgroundPositionY: `${-(parentRef.current?.scrollTop ?? 0) % ROW_HEIGHT}px`,
                }}
              />
            )}
            <div
              className="airtable-virtual-row-wrapper"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                zIndex: 1,
              }}
            >
            {rowVirtualItems.map((virtualRow) => {
              // Check both contiguous data and sparse cache
              const rowFromData = sortedTableData[virtualRow.index];
              const rowFromSparse = !rowFromData ? sparseRows.get(virtualRow.index) : undefined;
              const row = rowFromData ?? rowFromSparse;

              // Rows without loaded data — skeleton with shimmer cells.
              // The canvas grid pattern provides the baseline grid, and
              // these skeleton divs add shimmer bars on top.
              if (!row) {
                return (
                  <div
                    key={virtualRow.key}
                    className="airtable-skeleton-row left-0 flex pointer-events-none"
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      transform: `translateY(${virtualRow.start}px)`,
                      height: ROW_HEIGHT,
                      width: totalColumnsWidth - addColumnWidth,
                    }}
                  >
                    {rowNumberColumn && (
                      <div
                        className="airtable-skeleton-cell"
                        style={{
                          width: rowNumberColumnWidth,
                          minWidth: rowNumberColumnWidth,
                          height: ROW_HEIGHT,
                          backgroundColor: "#ffffff",
                          borderBottom: "1px solid #DDE1E3",
                          position: "sticky",
                          left: 0,
                          zIndex: 100,
                        }}
                      />
                    )}
                    {nameColumn && (
                      <div
                        className="airtable-skeleton-cell"
                        style={{
                          width: nameColumnWidth,
                          minWidth: nameColumnWidth,
                          height: ROW_HEIGHT,
                          backgroundColor: "#ffffff",
                          borderBottom: "1px solid #DDE1E3",
                          position: "sticky",
                          left: rowNumberColumnWidth,
                          zIndex: 100,
                        }}
                      />
                    )}
                    {scrollablePaddingLeft > 0 && (
                      <div style={{ width: scrollablePaddingLeft }} />
                    )}
                    {scrollableVirtualColumns.map((virtualColumn) => {
                      const col = columnsWithAdd[virtualColumn.index];
                      if (!col || col.type !== "data") return null;
                      return (
                        <div
                          key={col.id}
                          className="airtable-skeleton-cell"
                          style={{
                            width: virtualColumn.size,
                            minWidth: virtualColumn.size,
                            height: ROW_HEIGHT,
                            backgroundColor: "#ffffff",
                            borderRight: "1px solid #DDE1E3",
                            borderBottom: "1px solid #DDE1E3",
                          }}
                        />
                      );
                    })}
                    {scrollablePaddingRight > 0 && (
                      <div style={{ width: scrollablePaddingRight }} />
                    )}
                  </div>
                );
              }



            const rowSearchMatches = hasSearchQuery
              ? searchMatchesByRow.get(row.id)
              : null;
            const isLastRow = virtualRow.index === rowCount - 1 && !rowsHasNextPage;
            const rowHasSelection = selectedCell?.rowId === row.id;
            const rowNumberBaseBg = rowHasSelection
              ? "var(--airtable-cell-hover-bg)"
              : "#ffffff";
            const rowNumberHoverBg = "var(--airtable-cell-hover-bg)";


            return (
              <div
                key={row.id}
                className={clsx("airtable-row left-0 flex text-[13px] text-[#1d1f24]", rowHasSelection && "airtable-row--has-selection")}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  transform: `translateY(${virtualRow.start}px)`,
                  height: `${virtualRow.size}px`,
                  width: totalColumnsWidth - addColumnWidth,
                  zIndex: rowHasSelection ? 5 : 1,
                }}
              >
                {rowNumberColumn && (
                  <div
                    className="airtable-sticky-column airtable-cell relative flex items-center px-2 text-left text-[12px] font-normal text-[#606570]"
                    style={{
                      borderBottom: isLastRow ? "none" : "1px solid #DDE1E3",
                      borderLeft: "none",
                      borderRight: "none",
                      width: rowNumberColumnWidth,
                      minWidth: rowNumberColumnWidth,
                      maxWidth: rowNumberColumnWidth,
                      flex: "0 0 auto",
                      height: 33,
                      position: "sticky",
                      left: 0,
                      zIndex: 100,
                      transform: "translateZ(0)",
                      ["--airtable-cell-base" as string]: rowNumberBaseBg,
                      ["--airtable-cell-hover" as string]: rowNumberHoverBg,
                    }}
                    aria-hidden="true"
                  >
                    <div className="relative flex h-full w-full items-center">
                      <span className="airtable-row-hover-hide block w-[17px] text-center">
                        {virtualRow.index + 1}
                      </span>
                      <div className="airtable-row-hover-show absolute inset-0 flex items-center">
                        <div className="airtable-outline h-[17px] w-[17px] rounded-[4px] bg-white" />
                        <div className="airtable-outline ml-auto flex h-[25px] w-[25px] items-center justify-center rounded-[4px] bg-white">
                          <img
                            alt=""
                            className="h-[13px] w-[12px]"
                            src={expandIcon.src}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {nameColumn && nameColumn.type === "data" && (
                  (() => {
                    const nameOriginalValue = row[nameColumn.id] ?? "";
                    const nameEditedValue =
                      cellEdits[row.id]?.[nameColumn.id] ??
                      nameOriginalValue;
                    const nameIsSelected =
                      selectedCell?.rowId === row.id &&
                      selectedCell?.columnId === nameColumn.id;
                    const nameIsLongText =
                      nameColumn.fieldType === "long_text";
                    const nameIsNumber =
                      nameColumn.fieldType === "number";
                    const nameIsEditing =
                      editingCell?.rowId === row.id &&
                      editingCell?.columnId === nameColumn.id;
                    const nameHasSearchMatch =
                      hasSearchQuery && rowSearchMatches?.has(nameColumn.id);
                    const showNameSearchOverlay =
                      nameHasSearchMatch && !nameIsEditing;
                    const nameExpanded =
                      nameIsLongText &&
                      selectedCell?.rowId === row.id &&
                      selectedCell?.columnId === nameColumn.id;
                    const nameBaseBackground = nameHasSearchMatch
                      ? "#FFF3D3"
                      : filteredColumnIds.has(nameColumn.id)
                      ? "#E2F1E3"
                      : sortedColumnIds.has(nameColumn.id)
                      ? "var(--airtable-sort-column-bg)"
                      : nameIsSelected
                      ? "#ffffff"
                      : rowHasSelection
                      ? "var(--airtable-cell-hover-bg)"
                      : "#ffffff";
                    const nameHoverBackground = nameHasSearchMatch
                      ? "#FFF3D3"
                      : filteredColumnIds.has(nameColumn.id)
                      ? "#E5F4E6"
                      : sortedColumnIds.has(nameColumn.id)
                      ? "#F8EDE4"
                      : nameIsSelected
                      ? "#ffffff"
                      : "var(--airtable-cell-hover-bg)";
                    return (
                      <div
                        className={clsx(
                          "airtable-sticky-column airtable-cell relative flex overflow-visible px-2",
                          nameIsSelected &&
                            (nameIsEditing
                              ? "airtable-cell--editing"
                              : "airtable-cell--selected")
                        )}
                        style={{
                          ...bodyCellBorder(nameColumn, true, isLastRow),
                          width: nameColumnWidth,
                          minWidth: nameColumnWidth,
                          maxWidth: nameColumnWidth,
                          flex: "0 0 auto",
                          height: nameExpanded ? LONG_TEXT_HEIGHT : 33,
                          alignItems: nameExpanded ? "flex-start" : "center",
                          position: "sticky",
                          left: rowNumberColumnWidth,
                          zIndex: nameExpanded ? 100 : nameIsSelected ? 101 : 90,
                          transform: "translateZ(0)",
                          ["--airtable-cell-base" as string]:
                            nameBaseBackground,
                          ["--airtable-cell-hover" as string]:
                            nameHoverBackground,
                        }}
                        onClick={() => {
                          if (!nameIsEditing) {
                            focusCell(row.id, nameColumn.id);
                          }
                        }}
                      >
                        {nameIsLongText ? (
                          <>
                            {!nameExpanded ? (
                              <>
                                <input
                                  value={nameEditedValue}
                                  onChange={(event) =>
                                    handleCellChange(
                                      row.id,
                                      nameColumn.id,
                                      event.target.value
                                    )
                                  }
                                  onBlur={() => {
                                    if (!nameIsEditing) return;
                                    handleCellCommit(
                                      row.id,
                                      nameColumn.id,
                                      nameEditedValue
                                    );
                                    setEditingCell(null);
                                  }}
                                  onFocus={() =>
                                    setSelectedCell({
                                      rowId: row.id,
                                      columnId: nameColumn.id,
                                    })
                                  }
                                  onDoubleClick={() =>
                                    beginEditExisting(row.id, nameColumn.id)
                                  }
                                  onKeyDown={(event) =>
                                    handleCellKeyDown(
                                      event,
                                      row.id,
                                      nameColumn.id,
                                      nameColumn.fieldType,
                                      nameEditedValue
                                    )
                                  }
                                  ref={(node) => {
                                    const key = `${row.id}-${nameColumn.id}`;
                                    if (node) {
                                      cellRefs.current.set(key, node);
                                    } else {
                                      cellRefs.current.delete(key);
                                    }
                                  }}
                                  className={clsx(
                                    "airtable-long-text-input airtable-long-text-input--collapsed",
                                    !nameIsEditing && "airtable-cell-input--inactive"
                                  )}
                                  readOnly={!nameIsEditing}
                                  aria-label={`${nameColumn.name} cell`}
                                />
                                <div className="airtable-long-text-display">
                                  {renderSearchHighlight(
                                    nameEditedValue,
                                    searchQuery
                                  )}
                                </div>
                              </>
                            ) : (
                              <>
                                <textarea
                                  value={nameEditedValue}
                                  onChange={(event) =>
                                    handleCellChange(
                                      row.id,
                                      nameColumn.id,
                                      event.target.value
                                    )
                                  }
                                  onBlur={() => {
                                    if (!nameIsEditing) return;
                                    handleCellCommit(
                                      row.id,
                                      nameColumn.id,
                                      nameEditedValue
                                    );
                                    setEditingCell(null);
                                  }}
                                  onFocus={() =>
                                    setSelectedCell({
                                      rowId: row.id,
                                      columnId: nameColumn.id,
                                    })
                                  }
                                  onDoubleClick={() =>
                                    beginEditExisting(row.id, nameColumn.id)
                                  }
                                  onKeyDown={(event) =>
                                    handleCellKeyDown(
                                      event,
                                      row.id,
                                      nameColumn.id,
                                      nameColumn.fieldType,
                                      nameEditedValue
                                    )
                                  }
                                  ref={(node) => {
                                    const key = `${row.id}-${nameColumn.id}`;
                                    if (node) {
                                      cellRefs.current.set(key, node);
                                    } else {
                                      cellRefs.current.delete(key);
                                    }
                                  }}
                                  className={clsx(
                                    "airtable-long-text-input airtable-long-text-input--expanded",
                                    !nameIsEditing && "airtable-cell-input--inactive",
                                    showNameSearchOverlay &&
                                      "airtable-search-input--hidden"
                                  )}
                                  style={{ height: LONG_TEXT_HEIGHT }}
                                  readOnly={!nameIsEditing}
                                  aria-label={`${nameColumn.name} cell`}
                                />
                                {showNameSearchOverlay && (
                                  <div className="airtable-search-overlay airtable-search-overlay--expanded">
                                    {renderSearchHighlight(
                                      nameEditedValue,
                                      searchQuery
                                    )}
                                  </div>
                                )}
                                <img
                                  alt=""
                                  className="airtable-long-text-selection"
                                  src={longLineSelectionIcon.src}
                                />
                              </>
                            )}
                          </>
                        ) : (
                          <>
                            <input
                              value={nameEditedValue}
                              onChange={(event) =>
                                handleCellChange(
                                  row.id,
                                  nameColumn.id,
                                  event.target.value
                                )
                              }
                              onBlur={() => {
                                if (!nameIsEditing) return;
                                handleCellCommit(
                                  row.id,
                                  nameColumn.id,
                                  nameEditedValue
                                );
                                setEditingCell(null);
                              }}
                              onFocus={() =>
                                setSelectedCell({
                                  rowId: row.id,
                                  columnId: nameColumn.id,
                                })
                              }
                              onDoubleClick={() =>
                                beginEditExisting(row.id, nameColumn.id)
                              }
                              onKeyDown={(event) =>
                                handleCellKeyDown(
                                  event,
                                  row.id,
                                  nameColumn.id,
                                  nameColumn.fieldType,
                                  nameEditedValue
                                )
                              }
                              ref={(node) => {
                                const key = `${row.id}-${nameColumn.id}`;
                                if (node) {
                                  cellRefs.current.set(key, node);
                                } else {
                                  cellRefs.current.delete(key);
                                }
                              }}
                              className={clsx(
                                "h-full w-full bg-transparent text-[13px] text-[#1d1f24] outline-none",
                                !nameIsEditing &&
                                  "airtable-cell-input--inactive",
                                showNameSearchOverlay &&
                                  "airtable-search-input--hidden"
                              )}
                              inputMode={nameIsNumber ? "decimal" : undefined}
                              pattern={
                                nameIsNumber
                                  ? "^-?\\d*(?:\\.\\d{0,8})?$"
                                  : undefined
                              }
                              style={{
                                textAlign: nameIsNumber ? "right" : "left",
                              }}
                              readOnly={!nameIsEditing}
                              aria-label={`${nameColumn.name} cell`}
                            />
                            {showNameSearchOverlay && (
                              <div
                                className="airtable-search-overlay"
                                style={{
                                  textAlign: nameIsNumber ? "right" : "left",
                                }}
                              >
                                {renderSearchHighlight(
                                  nameEditedValue,
                                  searchQuery
                                )}
                              </div>
                            )}
                          </>
                        )}
                        {nameIsSelected && !nameIsEditing && (
                          <div className="airtable-cell-handle" />
                        )}
                      </div>
                    );
                  })()
                )}
                {scrollablePaddingLeft > 0 && (
                  <div style={{ width: scrollablePaddingLeft }} />
                )}
                {scrollableVirtualColumns.map((virtualColumn) => {
                  const column = columnsWithAdd[virtualColumn.index];
                  if (!column) return null;
                  const isSelected =
                    column.type === "data" &&
                    selectedCell?.rowId === row.id &&
                    selectedCell?.columnId === column.id;
                  const isSortedColumn =
                    column.type === "data" &&
                    sortedColumnIds.has(column.id);
                  const isFilteredColumn =
                    column.type === "data" &&
                    filteredColumnIds.has(column.id);
                  const cellHasSearchMatch =
                    hasSearchQuery && rowSearchMatches?.has(column.id);
                  const rowHasSelection = selectedCell?.rowId === row.id;
                  const cellBaseBackground = cellHasSearchMatch
                    ? "#FFF3D3"
                    : isFilteredColumn
                    ? "#E2F1E3"
                    : isSortedColumn
                    ? "var(--airtable-sort-column-bg)"
                    : isSelected
                    ? "#ffffff"
                    : rowHasSelection
                    ? "var(--airtable-cell-hover-bg)"
                    : "#ffffff";
                  const cellHoverBackground = cellHasSearchMatch
                    ? "#FFF3D3"
                    : isFilteredColumn
                    ? "#E5F4E6"
                    : isSortedColumn
                    ? "#F8EDE4"
                    : isSelected
                    ? "#ffffff"
                    : "var(--airtable-cell-hover-bg)";
                  const cellStyle = bodyCellBorder(column, false, isLastRow);

                    if (column.type === "add") return null;
                    if (column.type !== "data") {
                      return null;
                    }

                    const originalValue = row[column.id] ?? "";
                    const editedValue =
                      cellEdits[row.id]?.[column.id] ?? originalValue;
                  const isLongText =
                    column.type === "data" && column.fieldType === "long_text";
                  const isNumber =
                    column.type === "data" && column.fieldType === "number";
                  const isEditing =
                    editingCell?.rowId === row.id &&
                    editingCell?.columnId === column.id;
                  const showSearchOverlay =
                    cellHasSearchMatch && !isEditing;
                  const isExpanded =
                    isLongText &&
                    selectedCell?.rowId === row.id &&
                    selectedCell?.columnId === column.id;

                    return (
                    <div
                      key={`${row.id}-${column.id}`}
                      className={clsx(
                        "airtable-cell relative flex overflow-visible px-2",
                        isSelected &&
                          (isEditing
                            ? "airtable-cell--editing"
                            : "airtable-cell--selected")
                      )}
                      style={{
                        ...cellStyle,
                        width: virtualColumn.size,
                        flex: "0 0 auto",
                        height: isExpanded ? LONG_TEXT_HEIGHT : 33,
                        alignItems: isExpanded ? "flex-start" : "center",
                        zIndex: isExpanded ? 20 : (isSelected || isEditing) ? 2 : undefined,
                        ...(isSelected || isEditing
                          ? ({
                              clipPath: `inset(-10px -10px -10px max(-10px, calc(var(--scroll-left, 0px) + ${stickyColumnsWidth}px - ${virtualColumn.start}px)))`,
                            } as Record<string, string>)
                          : null),
                        ["--airtable-cell-base" as string]: cellBaseBackground,
                        ["--airtable-cell-hover" as string]: cellHoverBackground,
                        }}
                      onClick={() => {
                        if (!isEditing) {
                          focusCell(row.id, column.id);
                        }
                      }}
                      >
                          {isLongText ? (
                            <>
                              {!isExpanded ? (
                                <>
                                  <input
                                    value={editedValue}
                                    onChange={(event) =>
                                      handleCellChange(
                                        row.id,
                                        column.id,
                                        event.target.value
                                      )
                                    }
                                    onBlur={() => {
                                      if (!isEditing) return;
                                      handleCellCommit(
                                        row.id,
                                        column.id,
                                        editedValue
                                      );
                                      setEditingCell(null);
                                    }}
                                    onFocus={() =>
                                      setSelectedCell({
                                        rowId: row.id,
                                        columnId: column.id,
                                      })
                                    }
                                    onDoubleClick={() =>
                                      beginEditExisting(row.id, column.id)
                                    }
                                    onKeyDown={(event) =>
                                      handleCellKeyDown(
                                        event,
                                        row.id,
                                        column.id,
                                        column.fieldType,
                                        editedValue
                                      )
                                    }
                                    ref={(node) => {
                                      const key = `${row.id}-${column.id}`;
                                      if (node) {
                                        cellRefs.current.set(key, node);
                                      } else {
                                        cellRefs.current.delete(key);
                                      }
                                    }}
                                    className={clsx(
                                      "airtable-long-text-input airtable-long-text-input--collapsed",
                                      !isEditing && "airtable-cell-input--inactive"
                                    )}
                                    readOnly={!isEditing}
                                    aria-label={`${column.name} cell`}
                                  />
                                  <div className="airtable-long-text-display">
                                    {renderSearchHighlight(
                                      editedValue,
                                      searchQuery
                                    )}
                                  </div>
                                </>
                              ) : (
                                <>
                                  <textarea
                                    value={editedValue}
                                    onChange={(event) =>
                                      handleCellChange(
                                        row.id,
                                        column.id,
                                        event.target.value
                                      )
                                    }
                                    onBlur={() => {
                                      if (!isEditing) return;
                                      handleCellCommit(
                                        row.id,
                                        column.id,
                                        editedValue
                                      );
                                      setEditingCell(null);
                                    }}
                                    onFocus={() =>
                                      setSelectedCell({
                                        rowId: row.id,
                                        columnId: column.id,
                                      })
                                    }
                                    onDoubleClick={() =>
                                      beginEditExisting(row.id, column.id)
                                    }
                                    onKeyDown={(event) =>
                                      handleCellKeyDown(
                                        event,
                                        row.id,
                                        column.id,
                                        column.fieldType,
                                        editedValue
                                      )
                                    }
                                    ref={(node) => {
                                      const key = `${row.id}-${column.id}`;
                                      if (node) {
                                        cellRefs.current.set(key, node);
                                      } else {
                                        cellRefs.current.delete(key);
                                      }
                                    }}
                                    className={clsx(
                                      "airtable-long-text-input airtable-long-text-input--expanded",
                                      !isEditing && "airtable-cell-input--inactive",
                                      showSearchOverlay &&
                                        "airtable-search-input--hidden"
                                    )}
                                    style={{ height: LONG_TEXT_HEIGHT }}
                                    readOnly={!isEditing}
                                    aria-label={`${column.name} cell`}
                                  />
                                  {showSearchOverlay && (
                                    <div className="airtable-search-overlay airtable-search-overlay--expanded">
                                      {renderSearchHighlight(
                                        editedValue,
                                        searchQuery
                                      )}
                                    </div>
                                  )}
                                  <img
                                    alt=""
                                    className="airtable-long-text-selection"
                                    src={longLineSelectionIcon.src}
                                  />
                                </>
                              )}
                            </>
                          ) : (
                            <>
                              <input
                                value={editedValue}
                                onChange={(event) =>
                                  handleCellChange(
                                    row.id,
                                    column.id,
                                    event.target.value
                                  )
                                }
                                onBlur={() => {
                                  if (!isEditing) return;
                                  handleCellCommit(
                                    row.id,
                                    column.id,
                                    editedValue
                                  );
                                  setEditingCell(null);
                                }}
                                onFocus={() =>
                                  setSelectedCell({
                                    rowId: row.id,
                                    columnId: column.id,
                                  })
                                }
                                onDoubleClick={() =>
                                  beginEditExisting(row.id, column.id)
                                }
                                onKeyDown={(event) =>
                                  handleCellKeyDown(
                                    event,
                                    row.id,
                                    column.id,
                                    column.fieldType,
                                    editedValue
                                  )
                                }
                                ref={(node) => {
                                  const key = `${row.id}-${column.id}`;
                                  if (node) {
                                    cellRefs.current.set(key, node);
                                  } else {
                                    cellRefs.current.delete(key);
                                  }
                                }}
                                className={clsx(
                                  "h-full w-full bg-transparent text-[13px] text-[#1d1f24] outline-none",
                                  !isEditing &&
                                    "airtable-cell-input--inactive",
                                  showSearchOverlay &&
                                    "airtable-search-input--hidden"
                                )}
                                inputMode={isNumber ? "decimal" : undefined}
                                pattern={
                                  isNumber
                                    ? "^-?\\d*(?:\\.\\d{0,8})?$"
                                    : undefined
                                }
                                style={{
                                  textAlign: isNumber ? "right" : "left",
                                }}
                                readOnly={!isEditing}
                                aria-label={`${column.name} cell`}
                              />
                              {showSearchOverlay && (
                                <div
                                  className="airtable-search-overlay"
                                  style={{
                                    textAlign: isNumber ? "right" : "left",
                                  }}
                                >
                                  {renderSearchHighlight(
                                    editedValue,
                                    searchQuery
                                  )}
                                </div>
                              )}
                            </>
                          )}
                          {isSelected && !isEditing && (
                            <div className="airtable-cell-handle" />
                          )}
                        </div>
                      );
                    })}
                {scrollablePaddingRight > 0 && (
                  <div style={{ width: scrollablePaddingRight }} />
                )}
              </div>
            );
          })}
            </div>
            {(showRowsError || (showRowsEmpty && !hasSearchQuery && !allRowsFiltered)) && (
              <div className="absolute inset-0 z-40 flex items-center justify-center px-4">
                <div className="rounded-[6px] border border-[#DDE1E3] bg-white px-4 py-3 text-[12px] text-[#616670] shadow-sm">
                  {showRowsError && (
                    <span>
                      We couldn&apos;t load table rows. {rowsErrorMessage}
                    </span>
                  )}
                  {showRowsEmpty && !hasSearchQuery && <span>No rows yet.</span>}
                </div>
              </div>
            )}
          </div>

          <div
            className="flex"
            style={{ width: totalColumnsWidth, backgroundColor: "#F7F8FC" }}
            onMouseEnter={() => setAddRowHover(true)}
            onMouseLeave={() => setAddRowHover(false)}
          >
            {rowNumberColumn && (
              <button
                type="button"
                onClick={handleAddRow}
                disabled={addRowDisabled}
                className="flex h-[33px] cursor-pointer items-center px-2 text-[#606570] disabled:cursor-not-allowed"
                style={{
                  width: rowNumberColumnWidth,
                  minWidth: rowNumberColumnWidth,
                  maxWidth: rowNumberColumnWidth,
                  flex: "0 0 auto",
                  backgroundColor: addRowHover ? "#F7F8FC" : "#ffffff",
                  borderTop: "1px solid #DDE1E3",
                  borderBottom: "1px solid #DDE1E3",
                  borderLeft: "none",
                  borderRight: "none",
                  position: "sticky",
                  left: 0,
                  zIndex: 30,
                }}
                aria-label="Add row"
              >
                <span className="flex h-[17px] w-[17px] items-center justify-center">
                  <svg
                    aria-hidden="true"
                    className="h-[13px] w-[13px]"
                    viewBox="0 0 13 13"
                  >
                    <rect
                      x="0"
                      y="6"
                      width="13"
                      height="1"
                      rx="0.5"
                      fill="currentColor"
                    />
                    <rect
                      x="6"
                      y="0"
                      width="1"
                      height="13"
                      rx="0.5"
                      fill="currentColor"
                    />
                  </svg>
                </span>
              </button>
            )}
            {nameColumn ? (
              <>
                <button
                  type="button"
                  onClick={handleAddRow}
                  disabled={addRowDisabled}
                  className="flex h-[33px] cursor-pointer items-center px-2 airtable-secondary-font disabled:cursor-not-allowed"
                  style={{
                    width: nameColumnWidth,
                    minWidth: nameColumnWidth,
                    maxWidth: nameColumnWidth,
                    flex: "0 0 auto",
                    backgroundColor: addRowHover ? "#F7F8FC" : "#ffffff",
                    borderTop: "1px solid #DDE1E3",
                    borderBottom: "1px solid #DDE1E3",
                    borderLeft: "none",
                    borderRight: "none",
                    position: "sticky",
                    left: rowNumberColumnWidth,
                    zIndex: 30,
                  }}
                  aria-label="Add row"
                >
                </button>
                <div
                  style={{
                    width: Math.max(0, dataColumnsWidth - nameColumnWidth),
                    flex: "0 0 auto",
                    backgroundColor: addRowHover ? "#F7F8FC" : "#ffffff",
                    borderTop: "1px solid #DDE1E3",
                    borderBottom: "1px solid #DDE1E3",
                    borderRight: "1px solid #DDE1E3",
                  }}
                  aria-hidden="true"
                />
              </>
            ) : (
              <button
                type="button"
                onClick={handleAddRow}
                disabled={addRowDisabled}
                className="flex h-[33px] cursor-pointer items-center px-2 airtable-secondary-font disabled:cursor-not-allowed"
                style={{
                  width: dataColumnsWidth,
                  flex: "0 0 auto",
                  backgroundColor: addRowHover ? "#F7F8FC" : "#ffffff",
                  borderTop: "1px solid #DDE1E3",
                  borderBottom: "1px solid #DDE1E3",
                  borderLeft: "none",
                  borderRight: "1px solid #DDE1E3",
                  position: "sticky",
                  left: rowNumberColumnWidth,
                }}
                aria-label="Add row"
              >
              </button>
            )}
            <div
              style={{
                width: addColumnWidth,
                backgroundColor: addRowHover ? "#F7F8FC" : "transparent",
              }}
              aria-hidden="true"
            />
          </div>
        </div>
        {/* End of scrollable rows container */}
      </div>

      {/* Footer section with record count */}
      <div
        className="shrink-0 flex items-center border-t-[1px] border-[#DDE1E3] bg-[#FBFCFE]"
        style={{
          height: "34px",
          paddingLeft: "8px",
        }}
      >
        <span
          className="text-[11px] text-[#1D1F24]"
          style={{ fontFamily: "Inter", fontWeight: 400 }}
        >
          {activeRowCount.toLocaleString()} {activeRowCount === 1 ? "record" : "records"}
        </span>
      </div>

      {/* Name column vertical divider - from top of header row to bottom of view */}
      {nameColumn && nameColumnWidth > 0 && (
        <div
          className="pointer-events-none absolute z-40 w-px bg-[#CBCBCB]"
          style={{
            left: `${rowNumberColumnWidth + nameColumnWidth}px`,
            top: 0,
            bottom: 0,
          }}
          aria-hidden="true"
        />
      )}

      {allRowsFiltered && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          style={{ zIndex: 10 }}
        >
          <span
            style={{
              fontFamily: "Inter, sans-serif",
              fontWeight: 400,
              fontSize: "16px",
              color: "#989AA1",
            }}
          >
            All rows are filtered
          </span>
        </div>
      )}

      {!activeColumns.length && (
        <div className="p-6 text-center text-[12px] text-[#94a3b8]">
          Add a column to start building this table.
        </div>
      )}
    </div>
  );
}
