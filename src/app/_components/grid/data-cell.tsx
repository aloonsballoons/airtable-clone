"use client";

import type {
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
} from "react";
import { memo } from "react";
import clsx from "clsx";

import LongLineSelectionIcon from "~/assets/long-line-selection.svg";
import type { ColumnFieldType } from "~/lib/types";
import {
  ROW_HEIGHT,
  LONG_TEXT_CELL_HEIGHT,
  CELL_PADDING,
  CELL_TRUNCATION_THRESHOLD,
} from "~/lib/constants";
import {
  SEARCH_HIGHLIGHT_COLOR,
  SEARCH_FILTERED_HIGHLIGHT_COLOR,
  SEARCH_SORTED_HIGHLIGHT_COLOR,
  FILTER_CELL_BG,
  FILTER_CELL_HOVER_BG,
  SORT_COLUMN_BG,
  TEXT_PRIMARY,
  BG_WHITE,
  GPU_ACCELERATION_STYLE,
  CSS_VAR_CELL_BASE,
  CSS_VAR_CELL_HOVER,
} from "~/lib/colors";

// ---------------------------------------------------------------------------
// Cell background color computation — replaces 4 identical ternary chains
// ---------------------------------------------------------------------------

export function computeCellBackground(
  hasSearchMatch: boolean,
  isFiltered: boolean,
  isSorted: boolean,
  isSelected: boolean,
  rowHasSelection: boolean,
  variant: "base" | "hover",
): string {
  if (hasSearchMatch) {
    if (isFiltered) return SEARCH_FILTERED_HIGHLIGHT_COLOR;
    if (isSorted) return SEARCH_SORTED_HIGHLIGHT_COLOR;
    return SEARCH_HIGHLIGHT_COLOR;
  }
  if (isFiltered) return variant === "hover" ? FILTER_CELL_HOVER_BG : FILTER_CELL_BG;
  if (isSorted)
    return variant === "hover" ? "#F8EDE4" : SORT_COLUMN_BG;
  if (isSelected) return BG_WHITE;
  if (variant === "hover") return CSS_VAR_CELL_HOVER;
  if (rowHasSelection) return CSS_VAR_CELL_HOVER;
  return BG_WHITE;
}

// Fast-scroll variant (no hover, no selection awareness)
export function computeFastCellBackground(
  hasSearchMatch: boolean,
  isFiltered: boolean,
  isSorted: boolean,
): string {
  if (hasSearchMatch) {
    if (isFiltered) return SEARCH_FILTERED_HIGHLIGHT_COLOR;
    if (isSorted) return SEARCH_SORTED_HIGHLIGHT_COLOR;
    return SEARCH_HIGHLIGHT_COLOR;
  }
  if (isFiltered) return FILTER_CELL_BG;
  if (isSorted) return SORT_COLUMN_BG;
  return BG_WHITE;
}

// ---------------------------------------------------------------------------
// Search highlight rendering
// ---------------------------------------------------------------------------

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
      </mark>,
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
// Text measurement (canvas-based, no DOM layout)
// ---------------------------------------------------------------------------

let _measureCtx: CanvasRenderingContext2D | null = null;

const getTextWidth = (text: string): number => {
  if (typeof document === "undefined") return text.length * 7;
  if (!_measureCtx) {
    const canvas = document.createElement("canvas");
    _measureCtx = canvas.getContext("2d");
    if (_measureCtx) {
      // Font must match DataCell input styling (13px, normal weight)
      // Loaded via CSS variable in layout.tsx, falls back to Inter
      _measureCtx.font = "normal 13px Inter, system-ui, -apple-system, sans-serif";
    }
  }
  return _measureCtx?.measureText(text).width ?? text.length * 7;
};

const isTextTruncated = (value: string, cellWidth: number): boolean => {
  if (!value) return false;
  const availableWidth = cellWidth - CELL_TRUNCATION_THRESHOLD;
  return getTextWidth(value) > availableWidth;
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type DataCellProps = {
  rowId: string;
  columnId: string;
  columnName: string;
  fieldType: ColumnFieldType;
  displayValue: string;
  isSelected: boolean;
  isEditing: boolean;
  width: number;
  isLastRow: boolean;
  isFirstRow: boolean;
  isSticky: boolean;
  stickyLeft?: number;
  stickyZIndex?: number;
  clipPathExpr?: string;
  isAdjacentToSticky?: boolean;
  cellBorderStyle: React.CSSProperties;
  baseBg: string;
  hoverBg: string;
  hasSearchQuery: boolean;
  searchQuery: string;
  cellHasSearchMatch: boolean;
  onCellChange: (rowId: string, columnId: string, value: string) => void;
  onCellCommit: (rowId: string, columnId: string, value: string) => void;
  onFocusCell: (rowId: string, columnId: string) => void;
  onBeginEdit: (rowId: string, columnId: string) => void;
  onSelectCell: (rowId: string, columnId: string) => void;
  onSetEditingCellNull: () => void;
  cellRefCallback: (
    rowId: string,
    columnId: string,
    node: HTMLInputElement | HTMLTextAreaElement | null,
  ) => void;
  onKeyDown: (
    event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    rowId: string,
    columnId: string,
    columnType: ColumnFieldType,
    currentValue: string,
  ) => void;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function DataCellInner({
  rowId,
  columnId,
  columnName,
  fieldType,
  displayValue,
  isSelected,
  isEditing,
  width,
  isLastRow,
  isFirstRow,
  isSticky,
  stickyLeft,
  stickyZIndex,
  clipPathExpr,
  isAdjacentToSticky,
  cellBorderStyle,
  baseBg,
  hoverBg,
  hasSearchQuery,
  searchQuery,
  cellHasSearchMatch,
  onCellChange,
  onCellCommit,
  onFocusCell,
  onBeginEdit,
  onSelectCell,
  onSetEditingCellNull,
  cellRefCallback,
  onKeyDown,
}: DataCellProps) {
  const isLongText = fieldType === "long_text";
  const isNumber = fieldType === "number";
  const showSearchOverlay = cellHasSearchMatch && !isEditing;
  const isExpanded = isLongText && isSelected;
  const textAlign = isNumber ? ("right" as const) : ("left" as const);

  const refCb = (node: HTMLInputElement | HTMLTextAreaElement | null) => {
    cellRefCallback(rowId, columnId, node);
  };

  const handleChange = (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => onCellChange(rowId, columnId, event.target.value);

  const handleBlur = () => {
    if (!isEditing) return;
    onCellCommit(rowId, columnId, displayValue);
    onSetEditingCellNull();
  };

  const handleFocus = () => onSelectCell(rowId, columnId);
  const handleDoubleClick = () => onBeginEdit(rowId, columnId);
  const handleKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => onKeyDown(event, rowId, columnId, fieldType, displayValue);

  // ---- Lightweight display path (non-selected, non-editing) ----
  if (!isSelected && !isEditing) {
    const matchHidden =
      showSearchOverlay && isTextTruncated(displayValue, width);
    return (
      <div
        className={clsx(
          "airtable-cell relative flex overflow-visible px-2",
          isSticky && "airtable-sticky-column",
        )}
        style={{
          ...cellBorderStyle,
          width,
          ...(isSticky
            ? { minWidth: width, maxWidth: width }
            : undefined),
          flex: "0 0 auto",
          height: ROW_HEIGHT,
          alignItems: "center",
          ...(isSticky
            ? {
                position: "sticky" as const,
                left: stickyLeft,
                zIndex: stickyZIndex,
                transform: GPU_ACCELERATION_STYLE,
              }
            : undefined),
          ["--airtable-cell-base" as string]: baseBg,
          ["--airtable-cell-hover" as string]: hoverBg,
        }}
        onClick={() => onFocusCell(rowId, columnId)}
      >
        {matchHidden ? (
          <div className="relative h-full w-full text-[13px]" style={{ color: TEXT_PRIMARY }}>
            <div
              className="w-full overflow-hidden whitespace-nowrap leading-[33px]"
              style={{ textAlign }}
            >
              {renderSearchHighlight(displayValue, searchQuery)}
            </div>
            <span
              className="pointer-events-none absolute right-0 top-0 flex h-full items-center"
              style={{ background: "var(--airtable-cell-base)" }}
            >
              <span>&hellip;</span>
              <mark className="airtable-search-highlight inline-block w-1">
                &nbsp;
              </mark>
            </span>
          </div>
        ) : (
          <div
            className="h-full w-full truncate text-[13px] leading-[33px]"
            style={{ textAlign, color: TEXT_PRIMARY }}
          >
            {showSearchOverlay
              ? renderSearchHighlight(displayValue, searchQuery)
              : displayValue}
          </div>
        )}
      </div>
    );
  }

  // ---- Interactive path (selected or editing) ----
  const stickyStyle: React.CSSProperties | undefined = isSticky
    ? {
        minWidth: width,
        maxWidth: width,
        position: "sticky",
        left: stickyLeft,
        zIndex: isExpanded
          ? 100
          : isSelected
            ? (stickyZIndex ?? 90) + 11
            : stickyZIndex,
        transform: GPU_ACCELERATION_STYLE,
      }
    : undefined;

  const clipStyle: React.CSSProperties | undefined =
    !isSticky && (isSelected || isEditing) && clipPathExpr
      ? ({ clipPath: clipPathExpr } as React.CSSProperties)
      : undefined;

  return (
    <div
      className={clsx(
        "airtable-cell relative flex overflow-visible px-2",
        isSticky && "airtable-sticky-column",
        isSelected &&
          (isEditing ? "airtable-cell--editing" : "airtable-cell--selected"),
        isSticky &&
          (isSelected || isEditing) &&
          "airtable-cell--no-sel-right",
        !isSticky &&
          isAdjacentToSticky &&
          (isSelected || isEditing) &&
          "airtable-cell--no-sel-left",
        (isSelected || isEditing) && isFirstRow && "airtable-cell--no-sel-top",
      )}
      style={{
        ...cellBorderStyle,
        width,
        flex: "0 0 auto",
        height: isExpanded ? LONG_TEXT_CELL_HEIGHT : 33,
        alignItems: isExpanded ? "flex-start" : "center",
        ...stickyStyle,
        ...(!isSticky && (isSelected || isEditing)
          ? {
              zIndex: isExpanded ? 20 : 2,
            }
          : undefined),
        ...clipStyle,
        ["--airtable-cell-base" as string]: baseBg,
        ["--airtable-cell-hover" as string]: hoverBg,
      }}
      onClick={() => {
        if (!isEditing) onFocusCell(rowId, columnId);
      }}
    >
      {isLongText ? (
        <>
          {!isExpanded ? (
            <>
              <input
                value={displayValue}
                onChange={handleChange}
                onBlur={handleBlur}
                onFocus={handleFocus}
                onDoubleClick={handleDoubleClick}
                onKeyDown={handleKeyDown}
                ref={refCb}
                className={clsx(
                  "airtable-long-text-input airtable-long-text-input--collapsed",
                  !isEditing && "airtable-cell-input--inactive",
                )}
                readOnly={!isEditing}
                aria-label={`${columnName} cell`}
              />
              <div
                className="airtable-long-text-display"
                style={
                  showSearchOverlay && isTextTruncated(displayValue, width)
                    ? {
                        textOverflow: "clip",
                        display: "flex",
                        alignItems: "center",
                      }
                    : undefined
                }
              >
                {showSearchOverlay && isTextTruncated(displayValue, width) ? (
                  <>
                    <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap">
                      {renderSearchHighlight(displayValue, searchQuery)}
                    </span>
                    <span
                      className="pointer-events-none flex items-center"
                      style={{
                        background: "var(--airtable-cell-base)",
                      }}
                    >
                      <span>&hellip;</span>
                      <mark className="airtable-search-highlight inline-block w-1">
                        &nbsp;
                      </mark>
                    </span>
                  </>
                ) : (
                  renderSearchHighlight(displayValue, searchQuery)
                )}
              </div>
            </>
          ) : (
            <>
              <textarea
                value={displayValue}
                onChange={handleChange}
                onBlur={handleBlur}
                onFocus={handleFocus}
                onDoubleClick={handleDoubleClick}
                onKeyDown={handleKeyDown}
                ref={refCb}
                className={clsx(
                  "airtable-long-text-input airtable-long-text-input--expanded",
                  !isEditing && "airtable-cell-input--inactive",
                  showSearchOverlay && "airtable-search-input--hidden",
                )}
                style={{ height: LONG_TEXT_CELL_HEIGHT }}
                readOnly={!isEditing}
                aria-label={`${columnName} cell`}
              />
              {showSearchOverlay && (
                <div className="airtable-search-overlay airtable-search-overlay--expanded">
                  {renderSearchHighlight(displayValue, searchQuery)}
                </div>
              )}
              <LongLineSelectionIcon className="airtable-long-text-selection" />
            </>
          )}
        </>
      ) : (
        <>
          <input
            value={displayValue}
            onChange={handleChange}
            onBlur={handleBlur}
            onFocus={handleFocus}
            onDoubleClick={handleDoubleClick}
            onKeyDown={handleKeyDown}
            ref={refCb}
            className={clsx(
              "h-full w-full bg-transparent text-[13px] text-[#1d1f24] outline-none",
              !isEditing && "airtable-cell-input--inactive",
              showSearchOverlay && "airtable-search-input--hidden",
            )}
            inputMode={isNumber ? "decimal" : undefined}
            pattern={isNumber ? "^-?\\d*(?:\\.\\d{0,8})?$" : undefined}
            style={{ textAlign }}
            readOnly={!isEditing}
            aria-label={`${columnName} cell`}
          />
          {showSearchOverlay && (
            <div className="airtable-search-overlay" style={{ textAlign }}>
              {renderSearchHighlight(displayValue, searchQuery)}
            </div>
          )}
        </>
      )}
      {isSelected && !isEditing && <div className="airtable-cell-handle" />}
    </div>
  );
}

export const DataCell = memo(DataCellInner, (prev, next) => {
  // Always re-render if selected/editing state changes
  if (prev.isSelected || next.isSelected || prev.isEditing || next.isEditing)
    return false;

  // Cold path: all props must match for shallow comparison
  return (
    prev.rowId === next.rowId &&
    prev.columnId === next.columnId &&
    prev.columnName === next.columnName &&
    prev.fieldType === next.fieldType &&
    prev.displayValue === next.displayValue &&
    prev.width === next.width &&
    prev.isLastRow === next.isLastRow &&
    prev.isFirstRow === next.isFirstRow &&
    prev.isSticky === next.isSticky &&
    prev.stickyLeft === next.stickyLeft &&
    prev.stickyZIndex === next.stickyZIndex &&
    prev.clipPathExpr === next.clipPathExpr &&
    prev.isAdjacentToSticky === next.isAdjacentToSticky &&
    prev.cellBorderStyle === next.cellBorderStyle &&
    prev.baseBg === next.baseBg &&
    prev.hoverBg === next.hoverBg &&
    prev.hasSearchQuery === next.hasSearchQuery &&
    prev.searchQuery === next.searchQuery &&
    prev.cellHasSearchMatch === next.cellHasSearchMatch &&
    prev.onCellChange === next.onCellChange &&
    prev.onCellCommit === next.onCellCommit &&
    prev.onFocusCell === next.onFocusCell &&
    prev.onBeginEdit === next.onBeginEdit &&
    prev.onSelectCell === next.onSelectCell &&
    prev.onSetEditingCellNull === next.onSetEditingCellNull &&
    prev.cellRefCallback === next.cellRefCallback &&
    prev.onKeyDown === next.onKeyDown
  );
});
