"use client";

import type {
  Dispatch,
  FC,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  SVGProps,
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

import { useTableScroll, ROW_HEIGHT } from "./use-table-scroll";

import { AddColumnMenu } from "./add-column-menu";
import ExpandIcon from "~/assets/expand.svg";
import LongLineSelectionIcon from "~/assets/long-line-selection.svg";
import NameIcon from "~/assets/name.svg";
import NotesIcon from "~/assets/notes.svg";
import AssigneeIcon from "~/assets/assignee.svg";
import StatusIcon from "~/assets/status.svg";
import AttachmentsIcon from "~/assets/attachments.svg";
import NumberIcon from "~/assets/number.svg";

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

const ROW_NUMBER_COLUMN_WIDTH = 72;
const DEFAULT_COLUMN_WIDTH = 181;
const ADD_COLUMN_WIDTH = 93;
const LONG_TEXT_HEIGHT = 142;
const MAX_COLUMNS = 500;
const MAX_ROWS = 2_000_000;
const MAX_NUMBER_DECIMALS = 8;
const STATUS_ICON_SCALE = 1.1;
const STATUS_HEADER_ICON_SIZE = 13 * STATUS_ICON_SCALE;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SvgComponent = FC<SVGProps<SVGSVGElement>>;

const columnIconMap: Record<string, SvgComponent> = {
  Name: NameIcon,
  Notes: NotesIcon,
  Assignee: AssigneeIcon,
  Status: StatusIcon,
  Attachments: AttachmentsIcon,
  Number: NumberIcon,
};

const columnTypeIconMap: Record<ColumnFieldType, SvgComponent> = {
  single_line_text: NameIcon,
  long_text: NotesIcon,
  number: NumberIcon,
};

const coerceColumnType = (value?: string | null): ColumnFieldType =>
  value === "long_text" || value === "number" ? value : "single_line_text";

const getColumnIcon = (name: string, type?: string | null): SvgComponent | undefined => {
  const resolvedType = coerceColumnType(type);
  return columnIconMap[name] ?? columnTypeIconMap[resolvedType];
};

// ---------------------------------------------------------------------------
// Pre-computed border style constants (avoids allocating objects per cell)
// ---------------------------------------------------------------------------

type BorderColumn = { name: string; type: "data" | "add" | "row-number" };

const BORDER_HEADER_STICKY: React.CSSProperties = {
  borderTop: "none",
  borderBottom: "0.5px solid #CBCBCB",
  borderRight: "none",
  borderLeft: "none",
};

const BORDER_HEADER_DATA: React.CSSProperties = {
  borderTop: "none",
  borderBottom: "0.5px solid #CBCBCB",
  borderRight: "1px solid #DDE1E3",
  borderLeft: "none",
};

const BORDER_BODY_STICKY: React.CSSProperties = {
  borderBottom: "1px solid #DDE1E3",
  borderRight: "none",
  borderLeft: "none",
};

const BORDER_BODY_STICKY_LAST: React.CSSProperties = {
  borderBottom: "none",
  borderRight: "none",
  borderLeft: "none",
};

const BORDER_BODY_DATA: React.CSSProperties = {
  borderBottom: "1px solid #DDE1E3",
  borderRight: "1px solid #DDE1E3",
  borderLeft: "none",
};

const BORDER_BODY_DATA_LAST: React.CSSProperties = {
  borderBottom: "none",
  borderRight: "1px solid #DDE1E3",
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
  backgroundColor: "#ffffff",
  borderBottom: "1px solid #DDE1E3",
  position: "sticky",
  zIndex: 100,
};

const SKELETON_DATA_CELL: React.CSSProperties = {
  height: ROW_HEIGHT,
  backgroundColor: "#ffffff",
  borderRight: "1px solid #DDE1E3",
  borderBottom: "1px solid #DDE1E3",
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

// Canvas context for measuring text pixel-width without triggering DOM layout.
let _measureCtx: CanvasRenderingContext2D | null = null;

const getTextWidth = (text: string): number => {
  if (typeof document === "undefined") return text.length * 7;
  if (!_measureCtx) {
    const canvas = document.createElement("canvas");
    _measureCtx = canvas.getContext("2d");
    if (_measureCtx) {
      _measureCtx.font = "400 13px Inter, system-ui, -apple-system, sans-serif";
    }
  }
  return _measureCtx?.measureText(text).width ?? text.length * 7;
};

/**
 * Returns true when the text overflows the cell's available width, meaning
 * the cell would show a CSS text-overflow ellipsis.  Used to decide whether
 * to render a highlighted custom "…" for search-match cells.
 */
const isTextTruncated = (value: string, cellWidth: number): boolean => {
  if (!value) return false;
  const availableWidth = cellWidth - 16; // 8px padding each side (px-2)
  return getTextWidth(value) > availableWidth;
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
  const addRowDisabled = !activeTableId || totalRowCount >= MAX_ROWS;

  const expandedRowId = useMemo(() => {
    if (!selectedCell) return null;
    const selectedColumn = orderedColumns.find(
      (column) => column.id === selectedCell.columnId,
    );
    const selectedType = coerceColumnType(selectedColumn?.type);
    return selectedType === "long_text" ? selectedCell.rowId : null;
  }, [orderedColumns, selectedCell]);

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
    const rowIndex = rowIndexMap.get(rowId) ?? -1;
    const colIndex = columnIndexMap.get(columnId) ?? -1;
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
    if (columnOrder.length === 0 || sortedTableData.length === 0) return;
    const rowIndex = rowIndexMap.get(rowId) ?? -1;
    const colIndex = columnIndexMap.get(columnId) ?? -1;
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
      const nextRow = Math.min(sortedTableData.length - 1, rowIndex + 1);
      focusCell(sortedTableData[nextRow]!.id, columnId);
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
            zIndex: 200,
            backgroundColor: "#ffffff",
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
                    : "#ffffff",
                  position: "sticky",
                  left: rowNumberColumnWidth,
                  zIndex: 90,
                  transform: "translateZ(0)",
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
                      top: virtualRow.start - ROW_HEIGHT,
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
            const isHot = selectedCell?.rowId === row.id || editingCell?.rowId === row.id || !!cellEdits[row.id];

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
                ? (fastRowSearchMatches?.has(nameColumn.id)
                    ? (filteredColumnIds.has(nameColumn.id) ? "#EAE5A6" : sortedColumnIds.has(nameColumn.id) ? "#FFDEA4" : "#FFF3D3")
                    : filteredColumnIds.has(nameColumn.id)
                    ? "#E2F1E3"
                    : sortedColumnIds.has(nameColumn.id)
                    ? "var(--airtable-sort-column-bg)"
                    : "#ffffff")
                : "#ffffff";

              return (
                <div
                  key={row.id}
                  className="airtable-row left-0 flex text-[13px] text-[#1d1f24]"
                  style={{
                    position: "absolute",
                    top: virtualRow.start - ROW_HEIGHT,
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
                        borderBottom: isLastRow ? "none" : "1px solid #DDE1E3",
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
                        borderBottom: isLastRow ? "none" : "1px solid #DDE1E3",
                        ["--airtable-cell-base" as string]: fastNameBg,
                      }}
                    >
                      <div className="h-full w-full truncate leading-[33px]">
                        {cellEdits[row.id]?.[nameColumn.id] ?? row[nameColumn.id] ?? ""}
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
                    const isSorted = sortedColumnIds.has(column.id);
                    const isFiltered = filteredColumnIds.has(column.id);
                    const hasMatch = hasSearchQuery && fastRowSearchMatches?.has(column.id);
                    const fastCellBg = hasMatch
                      ? (isFiltered ? "#EAE5A6" : isSorted ? "#FFDEA4" : "#FFF3D3")
                      : isFiltered
                      ? "#E2F1E3"
                      : isSorted
                      ? "var(--airtable-sort-column-bg)"
                      : "#ffffff";
                    return (
                      <div
                        key={column.id}
                        className="airtable-cell relative flex items-center overflow-hidden px-2"
                        style={{
                          width: virtualColumn.size,
                          flex: "0 0 auto",
                          height: ROW_HEIGHT,
                          borderRight: "1px solid #DDE1E3",
                          borderBottom: isLastRow ? "none" : "1px solid #DDE1E3",
                          ["--airtable-cell-base" as string]: fastCellBg,
                        }}
                      >
                        <div
                          className="h-full w-full truncate leading-[33px]"
                          style={{ textAlign: isNumber ? "right" : "left" }}
                        >
                          {cellEdits[row.id]?.[column.id] ?? row[column.id] ?? ""}
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
            const rowHasSelection = selectedCell?.rowId === row.id;
            const rowNumberBaseBg = rowHasSelection
              ? "var(--airtable-cell-hover-bg)"
              : "#ffffff";
            const rowNumberHoverBg = "var(--airtable-cell-hover-bg)";

            return (
              <div
                className={clsx("airtable-row left-0 flex text-[13px] text-[#1d1f24]", rowHasSelection && "airtable-row--has-selection")}
                style={{
                  position: "absolute",
                  top: virtualRow.start - ROW_HEIGHT,
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
                          <ExpandIcon
                            className="h-[13px] w-[12px]"
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
                      ? filteredColumnIds.has(nameColumn.id)
                        ? "#EAE5A6"
                        : sortedColumnIds.has(nameColumn.id)
                        ? "#FFDEA4"
                        : "#FFF3D3"
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
                      ? filteredColumnIds.has(nameColumn.id)
                        ? "#EAE5A6"
                        : sortedColumnIds.has(nameColumn.id)
                        ? "#FFDEA4"
                        : "#FFF3D3"
                      : filteredColumnIds.has(nameColumn.id)
                      ? "#E5F4E6"
                      : sortedColumnIds.has(nameColumn.id)
                      ? "#F8EDE4"
                      : nameIsSelected
                      ? "#ffffff"
                      : "var(--airtable-cell-hover-bg)";

                    // Lightweight path for non-selected, non-editing Name cells
                    if (!nameIsSelected && !nameIsEditing) {
                      const nameMatchHidden = showNameSearchOverlay && isTextTruncated(nameEditedValue, nameColumnWidth);
                      return (
                        <div
                          className="airtable-sticky-column airtable-cell relative flex overflow-visible px-2"
                          style={{
                            ...getBodyCellBorder(nameColumn, isLastRow),
                            width: nameColumnWidth,
                            minWidth: nameColumnWidth,
                            maxWidth: nameColumnWidth,
                            flex: "0 0 auto",
                            height: 33,
                            alignItems: "center",
                            position: "sticky",
                            left: rowNumberColumnWidth,
                            zIndex: 90,
                            transform: "translateZ(0)",
                            ["--airtable-cell-base" as string]: nameBaseBackground,
                            ["--airtable-cell-hover" as string]: nameHoverBackground,
                          }}
                          onClick={() => focusCell(row.id, nameColumn.id)}
                        >
                          {nameMatchHidden ? (
                            <div className="relative h-full w-full text-[13px] text-[#1d1f24]">
                              <div
                                className="w-full overflow-hidden whitespace-nowrap leading-[33px]"
                                style={{ textAlign: nameIsNumber ? "right" : "left" }}
                              >
                                {renderSearchHighlight(nameEditedValue, searchQuery)}
                              </div>
                              <span className="pointer-events-none absolute right-0 top-0 flex h-full items-center" style={{ background: "var(--airtable-cell-base)" }}><span>&hellip;</span><mark className="airtable-search-highlight inline-block w-1">&nbsp;</mark></span>
                            </div>
                          ) : (
                            <div
                              className="h-full w-full truncate text-[13px] text-[#1d1f24] leading-[33px]"
                              style={{ textAlign: nameIsNumber ? "right" : "left" }}
                            >
                              {showNameSearchOverlay
                                ? renderSearchHighlight(nameEditedValue, searchQuery)
                                : nameEditedValue}
                            </div>
                          )}
                        </div>
                      );
                    }

                    return (
                      <div
                        className={clsx(
                          "airtable-sticky-column airtable-cell relative flex overflow-visible px-2",
                          nameIsSelected &&
                            (nameIsEditing
                              ? "airtable-cell--editing"
                              : "airtable-cell--selected"),
                          (nameIsSelected || nameIsEditing) && "airtable-cell--no-sel-right",
                          (nameIsSelected || nameIsEditing) && virtualRow.index === 0 && "airtable-cell--no-sel-top"
                        )}
                        style={{
                          ...getBodyCellBorder(nameColumn, isLastRow),
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
                                <div
                                  className="airtable-long-text-display"
                                  style={showNameSearchOverlay && isTextTruncated(nameEditedValue, nameColumnWidth) ? { textOverflow: "clip", display: "flex", alignItems: "center" } : undefined}
                                >
                                  {showNameSearchOverlay && isTextTruncated(nameEditedValue, nameColumnWidth) ? (
                                    <>
                                      <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap">
                                        {renderSearchHighlight(nameEditedValue, searchQuery)}
                                      </span>
                                      <span className="pointer-events-none flex items-center" style={{ background: "var(--airtable-cell-base)" }}><span>&hellip;</span><mark className="airtable-search-highlight inline-block w-1">&nbsp;</mark></span>
                                    </>
                                  ) : (
                                    renderSearchHighlight(nameEditedValue, searchQuery)
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
                                <LongLineSelectionIcon
                                  className="airtable-long-text-selection"
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
                  if (column.type === "add") return null;
                  if (column.type !== "data") return null;

                  const isSelected =
                    selectedCell?.rowId === row.id &&
                    selectedCell?.columnId === column.id;
                  const isEditing =
                    editingCell?.rowId === row.id &&
                    editingCell?.columnId === column.id;
                  const isSortedColumn = sortedColumnIds.has(column.id);
                  const isFilteredColumn = filteredColumnIds.has(column.id);
                  const cellHasSearchMatch =
                    hasSearchQuery && rowSearchMatches?.has(column.id);
                  const cellBaseBackground = cellHasSearchMatch
                    ? isFilteredColumn
                      ? "#EAE5A6"
                      : isSortedColumn
                      ? "#FFDEA4"
                      : "#FFF3D3"
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
                    ? isFilteredColumn
                      ? "#EAE5A6"
                      : isSortedColumn
                      ? "#FFDEA4"
                      : "#FFF3D3"
                    : isFilteredColumn
                    ? "#E5F4E6"
                    : isSortedColumn
                    ? "#F8EDE4"
                    : isSelected
                    ? "#ffffff"
                    : "var(--airtable-cell-hover-bg)";
                  const cellStyle = getBodyCellBorder(column, isLastRow);
                  const originalValue = row[column.id] ?? "";
                  const editedValue =
                    cellEdits[row.id]?.[column.id] ?? originalValue;
                  const isLongText = column.fieldType === "long_text";
                  const isNumber = column.fieldType === "number";
                  const showSearchOverlay = cellHasSearchMatch && !isEditing;
                  const isExpanded =
                    isLongText &&
                    selectedCell?.rowId === row.id &&
                    selectedCell?.columnId === column.id;

                  // Lightweight path: non-selected, non-editing cells render a
                  // plain div instead of an <input> to reduce DOM weight.
                  if (!isSelected && !isEditing) {
                    const matchHidden = showSearchOverlay && isTextTruncated(editedValue, virtualColumn.size);
                    return (
                      <div
                        key={`${row.id}-${column.id}`}
                        className="airtable-cell relative flex overflow-visible px-2"
                        style={{
                          ...cellStyle,
                          width: virtualColumn.size,
                          flex: "0 0 auto",
                          height: 33,
                          alignItems: "center",
                          ["--airtable-cell-base" as string]: cellBaseBackground,
                          ["--airtable-cell-hover" as string]: cellHoverBackground,
                        }}
                        onClick={() => focusCell(row.id, column.id)}
                      >
                        {matchHidden ? (
                          <div className="relative h-full w-full text-[13px] text-[#1d1f24]">
                            <div
                              className="w-full overflow-hidden whitespace-nowrap leading-[33px]"
                              style={{ textAlign: isNumber ? "right" : "left" }}
                            >
                              {renderSearchHighlight(editedValue, searchQuery)}
                            </div>
                            <span className="pointer-events-none absolute right-0 top-0 flex h-full items-center" style={{ background: "var(--airtable-cell-base)" }}><span>&hellip;</span><mark className="airtable-search-highlight inline-block w-1">&nbsp;</mark></span>
                          </div>
                        ) : (
                          <div
                            className="h-full w-full truncate text-[13px] text-[#1d1f24] leading-[33px]"
                            style={{ textAlign: isNumber ? "right" : "left" }}
                          >
                            {showSearchOverlay
                              ? renderSearchHighlight(editedValue, searchQuery)
                              : editedValue}
                          </div>
                        )}
                      </div>
                    );
                  }

                    return (
                    <div
                      key={`${row.id}-${column.id}`}
                      className={clsx(
                        "airtable-cell relative flex overflow-visible px-2",
                        isSelected &&
                          (isEditing
                            ? "airtable-cell--editing"
                            : "airtable-cell--selected"),
                        (isSelected || isEditing) && virtualColumn.index === nameColumnIndex + 1 && "airtable-cell--no-sel-left",
                        (isSelected || isEditing) && virtualRow.index === 0 && "airtable-cell--no-sel-top"
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
                                  <div
                                    className="airtable-long-text-display"
                                    style={showSearchOverlay && isTextTruncated(editedValue, virtualColumn.size) ? { textOverflow: "clip", display: "flex", alignItems: "center" } : undefined}
                                  >
                                    {showSearchOverlay && isTextTruncated(editedValue, virtualColumn.size) ? (
                                      <>
                                        <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap">
                                          {renderSearchHighlight(editedValue, searchQuery)}
                                        </span>
                                        <span className="pointer-events-none flex items-center" style={{ background: "var(--airtable-cell-base)" }}><span>&hellip;</span><mark className="airtable-search-highlight inline-block w-1">&nbsp;</mark></span>
                                      </>
                                    ) : (
                                      renderSearchHighlight(editedValue, searchQuery)
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
                                  <LongLineSelectionIcon
                                    className="airtable-long-text-selection"
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
                }}
              />
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

export const TableView = memo(TableViewInner);
