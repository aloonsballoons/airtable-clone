"use client";

import type {
  Dispatch,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  SetStateAction,
} from "react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";

import { useTableScroll } from "./use-table-scroll";
import { useGridState } from "./grid-state-context";

import { AddColumnMenu } from "./add-column-menu";
import { DataCell, computeCellBackground, computeFastCellBackground } from "./data-cell";
import ExpandIcon from "~/assets/expand.svg";

import type { ColumnFieldType, TableRow } from "~/lib/types";
import {
  ROW_HEIGHT,
  ROW_NUMBER_COLUMN_WIDTH,
  DEFAULT_COLUMN_WIDTH,
  ADD_COLUMN_WIDTH,
  ADD_COLUMN_MENU_WIDTH,
  ADD_COLUMN_MENU_RIGHT_OFFSET,
  ADD_COLUMN_MENU_BOTTOM_OFFSET,
  MAX_NUMBER_DECIMALS,
  MAX_ROWS,
  MAX_COLUMNS,
  STATUS_ICON_SCALE,
} from "~/lib/constants";
import { getColumnIcon } from "~/lib/column-icons";
import { coerceColumnType, isValidNumberDraft } from "~/lib/utils";
import { BORDER_THIN, BORDER_STANDARD, BORDER_COLOR, BG_WHITE, BG_LIGHT_BLUE, BG_LIGHT_GRAY, HOVER_GRAY, GPU_ACCELERATION_STYLE } from "~/lib/colors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ColumnResizeState = {
  columnId: string;
  startX: number;
  startWidth: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_HEADER_ICON_SIZE = 13 * STATUS_ICON_SCALE;

// ---------------------------------------------------------------------------
// Pre-computed border style constants (avoids allocating objects per cell)
// ---------------------------------------------------------------------------

type BorderColumn = { name: string; type: "data" | "add" | "row-number" };

const BORDER_HEADER_STICKY: React.CSSProperties = {
  borderTop: "none",
  borderBottom: BORDER_THIN,
  borderRight: "none",
  borderLeft: "none",
};

const BORDER_HEADER_DATA: React.CSSProperties = {
  borderTop: "none",
  borderBottom: BORDER_THIN,
  borderRight: BORDER_STANDARD,
  borderLeft: "none",
};

const BORDER_BODY_STICKY: React.CSSProperties = {
  borderBottom: BORDER_STANDARD,
  borderRight: "none",
  borderLeft: "none",
};

const BORDER_BODY_STICKY_LAST: React.CSSProperties = {
  borderBottom: "none",
  borderRight: "none",
  borderLeft: "none",
};

const BORDER_BODY_DATA: React.CSSProperties = {
  borderBottom: BORDER_STANDARD,
  borderRight: BORDER_STANDARD,
  borderLeft: "none",
};

const BORDER_BODY_DATA_LAST: React.CSSProperties = {
  borderBottom: "none",
  borderRight: BORDER_STANDARD,
  borderLeft: "none",
};

const getHeaderCellBorder = (column: BorderColumn): React.CSSProperties =>
  column.type === "row-number" ||
  (column.type === "data" && column.name === "Name")
    ? BORDER_HEADER_STICKY
    : BORDER_HEADER_DATA;

const getBodyCellBorder = (
  column: BorderColumn,
  isLastRow: boolean,
): React.CSSProperties => {
  const isSticky =
    column.type === "row-number" ||
    (column.type === "data" && column.name === "Name");
  if (isSticky) return isLastRow ? BORDER_BODY_STICKY_LAST : BORDER_BODY_STICKY;
  return isLastRow ? BORDER_BODY_DATA_LAST : BORDER_BODY_DATA;
};

// Pre-computed skeleton cell base styles (dynamic width applied inline)
const SKELETON_STICKY_BASE: React.CSSProperties = {
  height: ROW_HEIGHT,
  backgroundColor: BG_WHITE,
  borderBottom: BORDER_STANDARD,
  position: "sticky",
  zIndex: 100,
};

const SKELETON_DATA_CELL: React.CSSProperties = {
  height: ROW_HEIGHT,
  backgroundColor: BG_WHITE,
  borderRight: BORDER_STANDARD,
  borderBottom: BORDER_STANDARD,
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

// ---------------------------------------------------------------------------
// Memoised row wrapper — prevents React from re-rendering unchanged rows
// during scroll.  The `render` function is a closure over parent scope; it
// is only invoked when the custom `areEqual` comparison returns false.
// ---------------------------------------------------------------------------

const MemoTableRow = memo(
  function MemoTableRow({
    render,
  }: {
    rowId: string;
    rowIndex: number;
    rowSize: number;
    isLastRow: boolean;
    isHot: boolean;
    version: string;
    render: () => ReactNode;
  }) {
    return <>{render()}</>;
  },
  (prev, next) => {
    // "Hot" rows (selected, editing, or with pending edits) always re-render
    // so they pick up the latest interaction state.
    if (prev.isHot || next.isHot) return false;
    // Cold rows: skip re-render when identity and global version are stable.
    return (
      prev.rowId === next.rowId &&
      prev.rowIndex === next.rowIndex &&
      prev.rowSize === next.rowSize &&
      prev.isLastRow === next.isLastRow &&
      prev.version === next.version
    );
  },
);

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
  sparseVersion: number;
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

function TableViewInner({
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
  sparseVersion,
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
  // Grid state from context (cell selection, editing, drafts)
  const { state: gridState, actions: gridActions } = useGridState();
  // -------------------------------------------------------------------------
  // Internal state
  // -------------------------------------------------------------------------
  const [addRowHover, setAddRowHover] = useState(false);
  const [isAddColumnMenuOpen, setIsAddColumnMenuOpen] = useState(false);
  const [addColumnMenuPosition, setAddColumnMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);

  // -------------------------------------------------------------------------
  // Refs
  // -------------------------------------------------------------------------
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
  const isAddColumnMenuOpenRef = useRef(isAddColumnMenuOpen);

  // -------------------------------------------------------------------------
  // Computed values
  // -------------------------------------------------------------------------
  // Build rowIndexMap directly — eliminates the intermediate rowOrder array
  // allocation (saves one .map() + array creation for 100k rows).
  const rowIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < sortedTableData.length; i++) {
      map.set(sortedTableData[i]!.id, i);
    }
    return map;
  }, [sortedTableData]);

  const columnOrder = useMemo(
    () => orderedColumns.map((column) => column.id),
    [orderedColumns],
  );

  const columnIndexMap = useMemo(
    () => new Map(columnOrder.map((id, i) => [id, i])),
    [columnOrder],
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

  const rowNumberColumnIndex = columnsWithAdd.findIndex(
    (column) => column.type === "row-number",
  );
  const rowNumberColumn =
    rowNumberColumnIndex >= 0 ? columnsWithAdd[rowNumberColumnIndex] : null;
  const rowNumberColumnWidth =
    rowNumberColumn?.width ?? ROW_NUMBER_COLUMN_WIDTH;

  const rowCount = sortedTableData.length;
  const addRowDisabled = !activeTableId || totalRowCount >= MAX_ROWS;

  const expandedRowId = useMemo(() => {
    if (!gridState.selectedCell) return null;
    const selectedColumn = orderedColumns.find(
      (column) => column.id === gridState.selectedCell!.columnId,
    );
    const selectedType = coerceColumnType(selectedColumn?.type);
    return selectedType === "long_text" ? gridState.selectedCell.rowId : null;
  }, [orderedColumns, gridState.selectedCell]);

  // -------------------------------------------------------------------------
  // Scroll / virtualizer hook
  // -------------------------------------------------------------------------
  const {
    parentRef,
    rowVirtualizer,
    rowVirtualItems,
    rowVirtualRange,
    rowCanvasHeight,
    lastVirtualRowIndex,
    allRowsFiltered,
    isScrolling,
    columnVirtualizer,
    virtualColumns,
    columnVirtualRange,
    gridPatternSvg,
    gridPatternSize,
    handleScroll,
    totalColumnsWidth,
    addColumnWidth,
  } = useTableScroll({
    activeRowCount,
    rowCount,
    rowsHasNextPage,
    rowsIsFetchingNextPage,
    rowsFetchNextPage,
    sortedTableData,
    sparseRows,
    onVisibleRangeChange,
    columnsWithAdd,
    defaultColumnWidth: DEFAULT_COLUMN_WIDTH,
    columnWidths,
    showRowsInitialLoading,
    showRowsError,
    showRowsEmpty,
    hasActiveFilters,
    expandedRowId,
  });

  const nameColumnIndex = columnsWithAdd.findIndex(
    (column) => column.type === "data" && column.name === "Name",
  );
  const nameColumn =
    nameColumnIndex >= 0 ? columnsWithAdd[nameColumnIndex] : null;
  const nameColumnWidth = nameColumn?.width ?? 0;
  const stickyColumnsWidth = rowNumberColumnWidth + nameColumnWidth;
  const dataColumnsWidth = Math.max(
    0,
    totalColumnsWidth - addColumnWidth - rowNumberColumnWidth,
  );

  // Skeleton cell styles — memoized to avoid allocating new objects per cell per render
  const skeletonRowNumStyle = useMemo<React.CSSProperties>(
    () => ({
      ...SKELETON_STICKY_BASE,
      width: rowNumberColumnWidth,
      minWidth: rowNumberColumnWidth,
      left: 0,
    }),
    [rowNumberColumnWidth],
  );
  const skeletonNameStyle = useMemo<React.CSSProperties>(
    () => ({
      ...SKELETON_STICKY_BASE,
      width: nameColumnWidth,
      minWidth: nameColumnWidth,
      left: rowNumberColumnWidth,
    }),
    [nameColumnWidth, rowNumberColumnWidth],
  );

  const scrollableVirtualColumns = useMemo(
    () =>
      virtualColumns.filter((virtualColumn) => {
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
      }),
    [virtualColumns, rowNumberColumnIndex, nameColumnIndex],
  );
  const scrollablePaddingLeft = useMemo(
    () =>
      Math.max(
        0,
        (scrollableVirtualColumns[0]?.start ?? stickyColumnsWidth) -
          stickyColumnsWidth,
      ),
    [scrollableVirtualColumns, stickyColumnsWidth],
  );
  const totalScrollableWidth = useMemo(
    () => Math.max(0, totalColumnsWidth - stickyColumnsWidth),
    [totalColumnsWidth, stickyColumnsWidth],
  );
  const lastScrollableEnd = useMemo(
    () =>
      Math.max(
        0,
        (scrollableVirtualColumns.at(-1)?.end ?? stickyColumnsWidth) -
          stickyColumnsWidth,
      ),
    [scrollableVirtualColumns, stickyColumnsWidth],
  );
  const scrollablePaddingRight = useMemo(
    () => Math.max(0, totalScrollableWidth - lastScrollableEnd),
    [totalScrollableWidth, lastScrollableEnd],
  );

  // -------------------------------------------------------------------------
  // Row render version — a cheap fingerprint of all shared state that affects
  // how ANY row renders.  Stable during vertical-only scrolling so that
  // MemoTableRow can skip re-rendering cold rows.
  // -------------------------------------------------------------------------
  // Column-layout fingerprint: only changes when columns are added/removed/resized.
  // Separated from virtualColumns positions so pure horizontal scroll doesn't
  // bust every row's memo.
  const columnLayoutVersion = useMemo(
    () => columnsWithAdd.map((c) => `${c.id}:${c.width}`).join(","),
    [columnsWithAdd],
  );

  // Virtual-column fingerprint: tracks which columns are currently in the
  // visible viewport.  Only the *set of indices* matters for row content —
  // the exact pixel offsets don't affect what text is rendered.
  const virtualColumnIndices = useMemo(
    () => virtualColumns.map((v) => v.index).join(","),
    [virtualColumns],
  );

  // Memoize Set→string conversions separately to avoid allocating
  // intermediate arrays inside the rowRenderVersion memo.
  const sortedColumnIdsStr = useMemo(
    () => [...sortedColumnIds].join(","),
    [sortedColumnIds],
  );
  const filteredColumnIdsStr = useMemo(
    () => [...filteredColumnIds].join(","),
    [filteredColumnIds],
  );

  const rowRenderVersion = useMemo(
    () =>
      columnLayoutVersion +
      "|" +
      virtualColumnIndices +
      "|" +
      searchQuery +
      "|" +
      scrollablePaddingLeft +
      "|" +
      scrollablePaddingRight +
      "|" +
      sortedColumnIdsStr +
      "|" +
      filteredColumnIdsStr,
    [
      columnLayoutVersion,
      virtualColumnIndices,
      searchQuery,
      scrollablePaddingLeft,
      scrollablePaddingRight,
      sortedColumnIdsStr,
      filteredColumnIdsStr,
    ],
  );

  // -------------------------------------------------------------------------
  // Border helpers
  // -------------------------------------------------------------------------
  // Border helpers: see module-level getHeaderCellBorder / getBodyCellBorder

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
    gridActions.setCellEdits((prev) => ({
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
    gridActions.setCellEdits((prev) => {
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
    gridActions.setSelectedCell({ rowId, columnId });
    gridActions.setEditingCell({ rowId, columnId });
  };

  const handleSetEditingCellNull = useCallback(() => {
    gridActions.setEditingCell(null);
  }, [gridActions.setEditingCell]);

  const cellRefCallback = useCallback(
    (rowId: string, columnId: string, node: HTMLInputElement | HTMLTextAreaElement | null) => {
      const key = `${rowId}-${columnId}`;
      if (node) {
        cellRefs.current.set(key, node);
      } else {
        cellRefs.current.delete(key);
      }
    },
    [],
  );

  const handleSelectCell = useCallback(
    (rowId: string, columnId: string) => {
      gridActions.setSelectedCell({ rowId, columnId });
    },
    [gridActions.setSelectedCell],
  );

  const focusCell = (rowId: string, columnId: string) => {
    const rowIndex = rowIndexMap.get(rowId) ?? -1;
    const colIndex = columnIndexMap.get(columnId) ?? -1;
    if (rowIndex >= 0) {
      rowVirtualizer.scrollToIndex(rowIndex);
    }
    if (colIndex >= 0) {
      columnVirtualizer.scrollToIndex(colIndex);
    }
    gridActions.setSelectedCell({ rowId, columnId });
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
    if (columnOrder.length === 0 || sortedTableData.length === 0) return;
    const rowIndex = rowIndexMap.get(rowId) ?? -1;
    const colIndex = columnIndexMap.get(columnId) ?? -1;
    if (rowIndex === -1 || colIndex === -1) return;

    const isEditing =
      gridState.editingCell?.rowId === rowId && gridState.editingCell?.columnId === columnId;
    const isLongText = columnType === "long_text";

    const navigate = () => {
      let nextRow = rowIndex;
      let nextCol = colIndex;

      if (event.key === "ArrowRight") {
        nextCol = Math.min(columnOrder.length - 1, colIndex + 1);
      } else if (event.key === "ArrowLeft") {
        nextCol = Math.max(0, colIndex - 1);
      } else if (event.key === "ArrowDown") {
        nextRow = Math.min(sortedTableData.length - 1, rowIndex + 1);
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
        } else if (rowIndex < sortedTableData.length - 1) {
          nextRow = rowIndex + 1;
          nextCol = 0;
        }
      } else {
        return;
      }

      event.preventDefault();
      focusCell(sortedTableData[nextRow]!.id, columnOrder[nextCol]!);
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
        gridActions.setSelectedCell({ rowId, columnId });
        gridActions.setEditingCell({ rowId, columnId });
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
        gridActions.setSelectedCell({ rowId, columnId });
        gridActions.setEditingCell({ rowId, columnId });
      }
      return;
    }

    if (!isLongText && event.key === "Enter") {
      event.preventDefault();
      handleCellCommit(rowId, columnId, currentValue);
      gridActions.setEditingCell(null);
      const nextRow = Math.min(sortedTableData.length - 1, rowIndex + 1);
      focusCell(sortedTableData[nextRow]!.id, columnId);
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      handleCellCommit(rowId, columnId, currentValue);
      gridActions.setEditingCell(null);
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
    if (!addColumnButtonRef.current) return;
    const rect = addColumnButtonRef.current.getBoundingClientRect();
    // Menu is absolutely positioned with right: ADD_COLUMN_MENU_RIGHT_OFFSET
    // So we calculate left such that menu.right aligns with button.right
    const left = rect.right - (ADD_COLUMN_MENU_WIDTH - ADD_COLUMN_MENU_RIGHT_OFFSET);
    const top = rect.bottom + ADD_COLUMN_MENU_BOTTOM_OFFSET;
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
      gridActions.setSelectedCell(null);
      gridActions.setEditingCell(null);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [gridActions.setSelectedCell, gridActions.setEditingCell]);

  useEffect(() => {
    const focusTarget = gridState.editingCell ?? gridState.selectedCell;
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
      const mode = gridState.editingCell ? "edit" : "select";
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
      if (gridState.editingCell) {
        const length = node.value.length;
        node.setSelectionRange(length, length);
      } else {
        node.setSelectionRange(0, 0);
      }
      lastFocusedRef.current = { key, mode };
    });
  }, [
    gridState.editingCell,
    gridState.selectedCell,
    rowVirtualRange.start,
    rowVirtualRange.end,
    columnVirtualRange.start,
    columnVirtualRange.end,
  ]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="relative h-full flex flex-col">
      <div className="relative flex-1 w-full flex flex-col" style={{ minHeight: 0 }}>
        {/* Single scroll container for both header and body */}
        <div
          ref={parentRef}
          className="relative flex-1 w-full overflow-auto"
          style={{
            backgroundColor: "#F7F8FC",
            minHeight: 0,
          }}
          onScroll={(e) => handleScroll(e.currentTarget)}
        >
        {/* Header section - sticky so it stays pinned vertically but scrolls horizontally with zero latency */}
        <div
          style={{
            position: "sticky",
            top: 0,
            height: ROW_HEIGHT,
            zIndex: 200,
            backgroundColor: BG_WHITE,
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
                  borderBottom: BORDER_THIN,
                  borderLeft: "none",
                  borderRight: "none",
                  width: rowNumberColumnWidth,
                  minWidth: rowNumberColumnWidth,
                  maxWidth: rowNumberColumnWidth,
                  flex: "0 0 auto",
                  backgroundColor: BG_WHITE,
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
                  ...getHeaderCellBorder(nameColumn),
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
                    : BG_WHITE,
                  position: "sticky",
                  left: rowNumberColumnWidth,
                  zIndex: 90,
                  transform: "translateZ(0)",
                  overflow: "visible",
                }}
              >
                {(() => {
                  const ColumnIcon = nameColumn.type === "data"
                    ? getColumnIcon(nameColumn.name, nameColumn.fieldType)
                    : undefined;
                  if (!ColumnIcon) return null;
                  return (
                    <ColumnIcon
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
                    />
                  );
                })()}
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
              const cellStyle = getHeaderCellBorder(column);
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
                  : BG_WHITE;

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
                  {(() => {
                    const ColIcon = column.type === "data"
                      ? getColumnIcon(column.name, column.fieldType)
                      : undefined;
                    if (!ColIcon) return null;
                    return (
                      <ColIcon
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
                      />
                    );
                  })()}
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

        {/* Vertical divider - positioned absolutely, scrolls with content via --scroll-left variable */}
        {nameColumn && nameColumnWidth > 0 && (
          <div
            className="pointer-events-none w-px bg-[#CBCBCB]"
            style={{
              position: "absolute",
              left: `calc(var(--scroll-left, 0px) + ${rowNumberColumnWidth + nameColumnWidth}px)`,
              top: 0,
              height: `${ROW_HEIGHT + rowCanvasHeight}px`,
              zIndex: 201,
            }}
            aria-hidden="true"
          />
        )}

          <div
            className="airtable-row-canvas relative"
            style={{
              width: totalColumnsWidth,
              minWidth: totalColumnsWidth,
              height: rowCanvasHeight,
              ...(gridPatternSvg
                ? {
                    backgroundImage: gridPatternSvg,
                    backgroundSize: gridPatternSize,
                    backgroundRepeat: "repeat-y" as const,
                  }
                : {}),
            }}
          >
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
                      top: virtualRow.start,
                      left: 0,
                      height: ROW_HEIGHT,
                      width: totalColumnsWidth - addColumnWidth,
                    }}
                  >
                    {rowNumberColumn && (
                      <div
                        className="airtable-skeleton-cell"
                        style={skeletonRowNumStyle}
                      />
                    )}
                    {nameColumn && (
                      <div
                        className="airtable-skeleton-cell"
                        style={skeletonNameStyle}
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
                            ...SKELETON_DATA_CELL,
                            width: virtualColumn.size,
                            minWidth: virtualColumn.size,
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



            const isLastRow = virtualRow.index === rowCount - 1 && !rowsHasNextPage;
            const isHot = gridState.selectedCell?.rowId === row.id || gridState.editingCell?.rowId === row.id || !!gridState.cellEdits[row.id];

            // ---- Fast-path: lightweight row during rapid scrolling ----
            // For non-interactive ("cold") rows while the user is scrolling,
            // render a minimal DOM that skips event handlers, search
            // highlighting, hover styles, and selection outlines.  Cell
            // background colours (sort/filter/search tints) are preserved so
            // the table looks consistent during scroll.  Search highlights
            // render immediately on scroll stop when isScrolling flips false
            // and the full MemoTableRow takes over.
            if (isScrolling && !isHot) {
              const fastRowSearchMatches = hasSearchQuery
                ? searchMatchesByRow.get(row.id)
                : null;
              // Name column background
              const fastNameBg = nameColumn
                ? computeFastCellBackground(
                    !!(fastRowSearchMatches?.has(nameColumn.id)),
                    filteredColumnIds.has(nameColumn.id),
                    sortedColumnIds.has(nameColumn.id),
                  )
                : BG_WHITE;

              return (
                <div
                  key={row.id}
                  className="airtable-row left-0 flex text-[13px] text-[#1d1f24]"
                  style={{
                    position: "absolute",
                    top: virtualRow.start,
                    left: 0,
                    height: ROW_HEIGHT,
                    width: totalColumnsWidth - addColumnWidth,
                    zIndex: 1,
                  }}
                >
                  {rowNumberColumn && (
                    <div
                      className="airtable-sticky-column airtable-cell relative flex items-center px-2 text-left text-[12px] font-normal text-[#606570]"
                      style={{
                        width: rowNumberColumnWidth,
                        minWidth: rowNumberColumnWidth,
                        maxWidth: rowNumberColumnWidth,
                        flex: "0 0 auto",
                        height: ROW_HEIGHT,
                        position: "sticky",
                        left: 0,
                        zIndex: 100,
                        transform: "translateZ(0)",
                        borderBottom: isLastRow ? "none" : BORDER_STANDARD,
                      }}
                    >
                      <span className="block w-[17px] text-center">
                        {virtualRow.index + 1}
                      </span>
                    </div>
                  )}
                  {nameColumn && nameColumn.type === "data" && (
                    <div
                      className="airtable-sticky-column airtable-cell relative flex items-center overflow-hidden px-2"
                      style={{
                        width: nameColumnWidth,
                        minWidth: nameColumnWidth,
                        maxWidth: nameColumnWidth,
                        flex: "0 0 auto",
                        height: ROW_HEIGHT,
                        position: "sticky",
                        left: rowNumberColumnWidth,
                        zIndex: 90,
                        transform: "translateZ(0)",
                        borderBottom: isLastRow ? "none" : BORDER_STANDARD,
                        ["--airtable-cell-base" as string]: fastNameBg,
                      }}
                    >
                      <div className="h-full w-full truncate leading-[33px]">
                        {gridState.cellEdits[row.id]?.[nameColumn.id] ?? row[nameColumn.id] ?? ""}
                      </div>
                    </div>
                  )}
                  {scrollablePaddingLeft > 0 && (
                    <div style={{ width: scrollablePaddingLeft }} />
                  )}
                  {scrollableVirtualColumns.map((virtualColumn) => {
                    const column = columnsWithAdd[virtualColumn.index];
                    if (!column || column.type !== "data") return null;
                    const isNumber = column.fieldType === "number";
                    const fastCellBg = computeFastCellBackground(
                      !!(hasSearchQuery && fastRowSearchMatches?.has(column.id)),
                      filteredColumnIds.has(column.id),
                      sortedColumnIds.has(column.id),
                    );
                    return (
                      <div
                        key={column.id}
                        className="airtable-cell relative flex items-center overflow-hidden px-2"
                        style={{
                          width: virtualColumn.size,
                          flex: "0 0 auto",
                          height: ROW_HEIGHT,
                          borderRight: BORDER_STANDARD,
                          borderBottom: isLastRow ? "none" : BORDER_STANDARD,
                          ["--airtable-cell-base" as string]: fastCellBg,
                        }}
                      >
                        <div
                          className="h-full w-full truncate leading-[33px]"
                          style={{ textAlign: isNumber ? "right" : "left" }}
                        >
                          {gridState.cellEdits[row.id]?.[column.id] ?? row[column.id] ?? ""}
                        </div>
                      </div>
                    );
                  })}
                  {scrollablePaddingRight > 0 && (
                    <div style={{ width: scrollablePaddingRight }} />
                  )}
                </div>
              );
            }

            return (
              <MemoTableRow
                key={row.id}
                rowId={row.id}
                rowIndex={virtualRow.index}
                rowSize={virtualRow.size}
                isLastRow={isLastRow}
                isHot={isHot}
                version={rowRenderVersion}
                render={() => {
            const rowSearchMatches = hasSearchQuery
              ? searchMatchesByRow.get(row.id)
              : null;
            const rowHasSelection = gridState.selectedCell?.rowId === row.id;
            const rowNumberBaseBg = rowHasSelection
              ? "var(--airtable-cell-hover-bg)"
              : BG_WHITE;
            const rowNumberHoverBg = "var(--airtable-cell-hover-bg)";

            return (
              <div
                className={clsx("airtable-row left-0 flex text-[13px] text-[#1d1f24]", rowHasSelection && "airtable-row--has-selection")}
                style={{
                  position: "absolute",
                  top: virtualRow.start,
                  left: 0,
                  height: `${virtualRow.size}px`,
                  width: totalColumnsWidth - addColumnWidth,
                  zIndex: rowHasSelection ? 5 : 1,
                }}
              >
                {rowNumberColumn && (
                  <div
                    className="airtable-sticky-column airtable-cell relative flex items-center px-2 text-left text-[12px] font-normal text-[#606570]"
                    style={{
                      borderBottom: isLastRow ? "none" : BORDER_STANDARD,
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
                          <ExpandIcon
                            className="h-[13px] w-[12px]"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {nameColumn && nameColumn.type === "data" && (() => {
                    const nameHasSearchMatch = !!(hasSearchQuery && rowSearchMatches?.has(nameColumn.id));
                    const nameIsSelected = gridState.selectedCell?.rowId === row.id && gridState.selectedCell?.columnId === nameColumn.id;
                    const nameIsEditing = gridState.editingCell?.rowId === row.id && gridState.editingCell?.columnId === nameColumn.id;
                    const nameEditedValue = gridState.cellEdits[row.id]?.[nameColumn.id] ?? row[nameColumn.id] ?? "";
                    return (
                      <DataCell
                        rowId={row.id}
                        columnId={nameColumn.id}
                        columnName={nameColumn.name}
                        fieldType={nameColumn.fieldType}
                        displayValue={nameEditedValue}
                        isSelected={nameIsSelected}
                        isEditing={nameIsEditing}
                        width={nameColumnWidth}
                        isLastRow={isLastRow}
                        isFirstRow={virtualRow.index === 0}
                        isSticky
                        stickyLeft={rowNumberColumnWidth}
                        stickyZIndex={90}
                        cellBorderStyle={getBodyCellBorder(nameColumn, isLastRow)}
                        baseBg={computeCellBackground(nameHasSearchMatch, filteredColumnIds.has(nameColumn.id), sortedColumnIds.has(nameColumn.id), nameIsSelected, rowHasSelection, "base")}
                        hoverBg={computeCellBackground(nameHasSearchMatch, filteredColumnIds.has(nameColumn.id), sortedColumnIds.has(nameColumn.id), nameIsSelected, rowHasSelection, "hover")}
                        hasSearchQuery={hasSearchQuery}
                        searchQuery={searchQuery}
                        cellHasSearchMatch={nameHasSearchMatch}
                        onCellChange={setCellEditValue}
                        onCellCommit={handleCellCommit}
                        onFocusCell={focusCell}
                        onBeginEdit={beginEditExisting}
                        onSelectCell={handleSelectCell}
                        onSetEditingCellNull={handleSetEditingCellNull}
                        cellRefCallback={cellRefCallback}
                        onKeyDown={handleCellKeyDown}
                      />
                    );
                  })()}
                {scrollablePaddingLeft > 0 && (
                  <div style={{ width: scrollablePaddingLeft }} />
                )}
                {scrollableVirtualColumns.map((virtualColumn) => {
                  const column = columnsWithAdd[virtualColumn.index];
                  if (!column || column.type !== "data") return null;
                  const cellIsSelected = gridState.selectedCell?.rowId === row.id && gridState.selectedCell?.columnId === column.id;
                  const cellIsEditing = gridState.editingCell?.rowId === row.id && gridState.editingCell?.columnId === column.id;
                  const cellHasSearchMatch = !!(hasSearchQuery && rowSearchMatches?.has(column.id));
                  const isFiltered = filteredColumnIds.has(column.id);
                  const isSorted = sortedColumnIds.has(column.id);
                  const editedValue = gridState.cellEdits[row.id]?.[column.id] ?? row[column.id] ?? "";
                  const clipExpr = `inset(-10px -10px -10px max(-10px, calc(var(--scroll-left, 0px) + ${stickyColumnsWidth}px - ${virtualColumn.start}px)))`;
                  return (
                    <DataCell
                      key={`${row.id}-${column.id}`}
                      rowId={row.id}
                      columnId={column.id}
                      columnName={column.name}
                      fieldType={column.fieldType}
                      displayValue={editedValue}
                      isSelected={cellIsSelected}
                      isEditing={cellIsEditing}
                      width={virtualColumn.size}
                      isLastRow={isLastRow}
                      isFirstRow={virtualRow.index === 0}
                      isSticky={false}
                      clipPathExpr={clipExpr}
                      isAdjacentToSticky={virtualColumn.index === nameColumnIndex + 1}
                      cellBorderStyle={getBodyCellBorder(column, isLastRow)}
                      baseBg={computeCellBackground(cellHasSearchMatch, isFiltered, isSorted, cellIsSelected, rowHasSelection, "base")}
                      hoverBg={computeCellBackground(cellHasSearchMatch, isFiltered, isSorted, cellIsSelected, rowHasSelection, "hover")}
                      hasSearchQuery={hasSearchQuery}
                      searchQuery={searchQuery}
                      cellHasSearchMatch={cellHasSearchMatch}
                      onCellChange={setCellEditValue}
                      onCellCommit={handleCellCommit}
                      onFocusCell={focusCell}
                      onBeginEdit={beginEditExisting}
                      onSelectCell={handleSelectCell}
                      onSetEditingCellNull={handleSetEditingCellNull}
                      cellRefCallback={cellRefCallback}
                      onKeyDown={handleCellKeyDown}
                    />
                  );
                })}
                {scrollablePaddingRight > 0 && (
                  <div style={{ width: scrollablePaddingRight }} />
                )}
              </div>
            );
                }}
              />
            );
          })}
            </div>
            {(showRowsError || (showRowsEmpty && !hasSearchQuery && !allRowsFiltered)) && (
              <div className="absolute inset-0 z-40 flex items-center justify-center px-4">
                <div className="rounded-[6px] px-4 py-3 text-[12px] text-[#616670] shadow-sm" style={{ border: BORDER_STANDARD, backgroundColor: BG_WHITE }}>
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
                  backgroundColor: addRowHover ? BG_LIGHT_BLUE : BG_WHITE,
                  borderTop: BORDER_STANDARD,
                  borderBottom: BORDER_STANDARD,
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
                    backgroundColor: addRowHover ? BG_LIGHT_BLUE : BG_WHITE,
                    borderTop: BORDER_STANDARD,
                    borderBottom: BORDER_STANDARD,
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
                    backgroundColor: addRowHover ? BG_LIGHT_BLUE : BG_WHITE,
                    borderTop: BORDER_STANDARD,
                    borderBottom: BORDER_STANDARD,
                    borderRight: BORDER_STANDARD,
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
                  backgroundColor: addRowHover ? BG_LIGHT_BLUE : BG_WHITE,
                  borderTop: BORDER_STANDARD,
                  borderBottom: BORDER_STANDARD,
                  borderLeft: "none",
                  borderRight: BORDER_STANDARD,
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
        className="shrink-0 flex items-center"
        style={{
          borderTop: BORDER_STANDARD,
          backgroundColor: BG_LIGHT_GRAY,
          height: "34px",
          paddingLeft: "8px",
        }}
      >
        <span
          className="text-[11px] text-[#1D1F24]"
          style={{ fontFamily: "Inter", fontWeight: 400 }}
        >
          {`${activeRowCount.toLocaleString()} ${activeRowCount === 1 ? "record" : "records"}`}
        </span>
      </div>


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

export const TableView = memo(TableViewInner);
