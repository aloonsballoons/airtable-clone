"use client";

import { memo, useRef, useLayoutEffect, useState } from "react";
import type {
  Dispatch,
  SetStateAction,
  RefObject,
  MouseEvent as ReactMouseEvent,
} from "react";
import clsx from "clsx";
import { createPortal } from "react-dom";
import type { SortConfig } from "~/lib/types";
import type { SortLayoutConstants } from "./use-table-sort";
import { STATUS_ICON_SCALE } from "~/lib/constants";
import { getColumnIcon } from "~/lib/column-icons";
import { coerceColumnType } from "~/lib/utils";

import SortActiveIcon from "~/assets/sort-active.svg";
import SortIcon from "~/assets/sort.svg";
import ThreeDotIcon from "~/assets/three-dot.svg";
import XIcon from "~/assets/x.svg";

const STATUS_MENU_ICON_SIZE = 15 * STATUS_ICON_SCALE;

type Column = {
  id: string;
  name: string;
  type: string | null;
};

export type SortSectionProps = {
  // Layout positioning
  buttonLeft: number;

  // Refs
  sortButtonRef: RefObject<HTMLButtonElement | null>;
  sortMenuRef: RefObject<HTMLDivElement | null>;
  sortFieldMenuRef: RefObject<HTMLDivElement | null>;
  sortAddMenuListRef: RefObject<HTMLDivElement | null>;
  sortPhantomRef: RefObject<HTMLDivElement | null>;

  // State
  isSortMenuOpen: boolean;
  setIsSortMenuOpen: Dispatch<SetStateAction<boolean>>;
  openSortDirectionId: string | null;
  setOpenSortDirectionId: Dispatch<SetStateAction<string | null>>;
  openSortFieldId: string | null;
  setOpenSortFieldId: Dispatch<SetStateAction<string | null>>;
  isAddSortMenuOpen: boolean;
  setIsAddSortMenuOpen: Dispatch<SetStateAction<boolean>>;

  // Data
  hasSort: boolean;
  sortRows: SortConfig[];
  sortedColumnIds: Set<string>;
  draggingSortId: string | null;
  draggingSortTop: number | null;
  phantomSortX: number | null;
  phantomSortY: number | null;
  sortAddVirtualItems: Array<{ index: number; start: number }>;
  sortAddVirtualizerSize: number;
  remainingSortColumns: Column[];
  sortLayout: SortLayoutConstants;

  // Callbacks
  applySorts: (sorts: SortConfig[] | null) => void;
  handleSortDragStart: (event: ReactMouseEvent, columnId: string) => void;
  getSortDirectionLabels: (columnId: string) => { asc: string; desc: string };

  // Column data
  orderedColumns: Column[];
  columnById: Map<string, Column>;
};

function SortSectionContent({
  buttonLeft,
  sortButtonRef,
  sortMenuRef,
  sortFieldMenuRef,
  sortAddMenuListRef,
  sortPhantomRef,
  isSortMenuOpen,
  setIsSortMenuOpen,
  openSortDirectionId,
  setOpenSortDirectionId,
  openSortFieldId,
  setOpenSortFieldId,
  isAddSortMenuOpen,
  setIsAddSortMenuOpen,
  hasSort,
  sortRows,
  sortedColumnIds,
  draggingSortId,
  draggingSortTop,
  phantomSortX,
  phantomSortY,
  sortAddVirtualItems,
  sortAddVirtualizerSize,
  remainingSortColumns,
  sortLayout,
  applySorts,
  handleSortDragStart,
  getSortDirectionLabels,
  orderedColumns,
  columnById,
}: SortSectionProps) {
  // Dynamic sort button width
  const sortTextRef = useRef<HTMLSpanElement>(null);
  const [sortButtonWidth, setSortButtonWidth] = useState(66);
  const sortText = hasSort
    ? `Sorted by ${sortRows.length} ${sortRows.length === 1 ? "field" : "fields"}`
    : "Sort";

  useLayoutEffect(() => {
    if (sortTextRef.current) {
      const textWidth = sortTextRef.current.scrollWidth;
      // active: text at left=25, right padding 18 (matches hide fields active)
      // inactive: fixed 66px
      setSortButtonWidth(hasSort ? 25 + textWidth + 18 : 66);
    }
  }, [sortText, hasSort, sortRows.length]);

  return (
    <>
      <div className="absolute top-0" style={{ left: buttonLeft, transition: "left 0.2s ease" }}>
        <button
          ref={sortButtonRef}
          type="button"
          className={clsx(
            "airtable-table-feature-selection relative mt-[10px] h-[26px] !min-w-0 !px-0",
            hasSort &&
              "airtable-table-feature-selection--active text-[#1d1f24]"
          )}
          style={{
            width: sortButtonWidth,
            transition: "width 0.2s ease",
            ["--hover-left" as string]: "-4px",
            ["--hover-right" as string]: hasSort ? "10px" : "7px",
          } as React.CSSProperties}
          onClick={() =>
            setIsSortMenuOpen((prev) => {
              const next = !prev;
              if (!next) {
                setOpenSortDirectionId(null);
                setOpenSortFieldId(null);
                setIsAddSortMenuOpen(false);
              }
              return next;
            })
          }
          aria-haspopup="menu"
          aria-expanded={isSortMenuOpen}
        >
          <SortActiveIcon
            className="absolute"
            style={{ left: 6, top: 6, width: 12, height: 13, opacity: hasSort ? 1 : 0, transition: "opacity 0.2s ease" }}
          />
          <span className="absolute left-[4px] top-[6px] inline-flex h-[14px] w-[13px]" style={{ opacity: hasSort ? 0 : 1, transition: "opacity 0.2s ease" }}>
            <SortIcon
              className="h-[14px] w-[13px]"
            />
            <span
              className="airtable-sort-white-overlay airtable-sort-white-overlay--hover"
              aria-hidden="true"
            />
          </span>
          <span
            ref={sortTextRef}
            className="absolute top-[5px] block h-[16px] text-[13px] leading-[16px]"
            style={hasSort ? { left: 25, whiteSpace: "nowrap" } : { left: 10, width: "52px" }}
          >
            {sortText}
          </span>
        </button>
        {isSortMenuOpen && (
          <div
            ref={sortMenuRef}
            className="airtable-sort-dropdown airtable-dropdown-surface absolute right-[-8px] top-[40px] z-[120]"
            style={{
              width: hasSort ? sortLayout.sortConfiguredWidth : 320,
              height: hasSort ? sortLayout.sortConfiguredHeight : sortLayout.sortListHeight,
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="relative h-full w-full">
              <div className="absolute left-[20px] top-[14px] flex items-center gap-[3px] airtable-secondary-font">
                <span>Sort by</span>
                <span className="airtable-help-icon" aria-hidden="true" />
              </div>
              <div
                className="absolute left-[20px] top-[41px] h-px bg-[#E5E5E5]"
                style={{ width: hasSort ? sortLayout.sortLineWidth : 280 }}
              />
              {hasSort ? (
                <>
                  {sortRows.map((sortItem, index) => {
                    const rowTop = sortLayout.sortFieldTop + index * sortLayout.sortRowStride;
                    const isDragging = draggingSortId === sortItem.columnId;
                    const displayTop =
                      isDragging && draggingSortTop !== null ? draggingSortTop : rowTop;
                    const fieldMenuColumns = orderedColumns.filter(
                      (column) =>
                        column.id === sortItem.columnId ||
                        !sortedColumnIds.has(column.id)
                    );
                    const fieldMenuHeight =
                      sortLayout.sortFieldMenuFirstRowTop +
                      Math.max(0, fieldMenuColumns.length - 1) *
                        (sortLayout.sortFieldMenuRowHeight + sortLayout.sortFieldMenuGap) +
                      (fieldMenuColumns.length > 0
                        ? sortLayout.sortFieldMenuRowHeight
                        : 0) +
                      sortLayout.sortFieldMenuPadding;
                    const directionLabels = getSortDirectionLabels(
                      sortItem.columnId
                    );
                    const removeTop = (sortLayout.sortFieldHeight - sortLayout.sortRemoveSize) / 2;
                    const reorderTop = 7.5;
                    const isFieldMenuOpen =
                      openSortFieldId === sortItem.columnId;
                    const isDirectionMenuOpen =
                      openSortDirectionId === sortItem.columnId;
                    const shouldElevateRow =
                      isFieldMenuOpen || isDirectionMenuOpen;
                    const columnLabel =
                      columnById.get(sortItem.columnId)?.name ?? "Select field";
                    return (
                      <div
                        key={sortItem.columnId}
                        className="airtable-sort-row absolute left-0 right-0"
                        style={{
                          top: displayTop,
                          height: sortLayout.sortFieldHeight,
                          zIndex: shouldElevateRow ? 30 : 0,
                          transition: "top 0.12s ease-out, opacity 0.12s ease-out",
                          opacity: isDragging ? 0.5 : 1,
                        }}
                      >
                        <button
                          type="button"
                          className="airtable-sort-field absolute"
                          style={{ left: sortLayout.sortFieldLeft, width: sortLayout.sortFieldWidth }}
                          onClick={() => {
                            setOpenSortFieldId((prev) =>
                              prev === sortItem.columnId ? null : sortItem.columnId
                            );
                            setOpenSortDirectionId(null);
                            setIsAddSortMenuOpen(false);
                          }}
                          aria-expanded={isFieldMenuOpen}
                        >
                          <span>{columnLabel}</span>
                          <span className="ml-auto airtable-nav-chevron rotate-90" />
                        </button>
                        {isFieldMenuOpen && (
                          <div
                            className="airtable-sort-field-menu z-30"
                            ref={sortFieldMenuRef}
                            style={{
                              left: sortLayout.sortFieldLeft,
                              top: sortLayout.sortFieldHeight + 1,
                              width: sortLayout.sortFieldMenuWidth,
                              height: fieldMenuHeight,
                            }}
                          >
                            <div
                              className="absolute airtable-find-field-label"
                              style={{ left: 9, top: sortLayout.sortFieldMenuPadding }}
                            >
                              Find a field
                            </div>
                            {fieldMenuColumns.map((column, itemIndex) => {
                              const itemTop =
                                sortLayout.sortFieldMenuFirstRowTop +
                                itemIndex *
                                  (sortLayout.sortFieldMenuRowHeight + sortLayout.sortFieldMenuGap);
                              const ColumnIcon = getColumnIcon(
                                column.name,
                                column.type
                              );
                              const isStatusColumn = column.name === "Status";
                              return (
                                <button
                                  key={column.id}
                                  type="button"
                                  className="airtable-sort-field-menu-item"
                                  style={{ top: itemTop }}
                                  onClick={() => {
                                    const nextSorts: SortConfig[] = sortRows.map(
                                      (item): SortConfig => {
                                        if (item.columnId !== sortItem.columnId) {
                                          return item;
                                        }
                                        const isSameColumn =
                                          column.id === sortItem.columnId;
                                        const nextDirection: SortConfig["direction"] =
                                          isSameColumn
                                            ? item.direction
                                            : coerceColumnType(column.type) === "number"
                                            ? "asc"
                                            : item.direction;
                                        return {
                                          columnId: column.id,
                                          direction: nextDirection,
                                        };
                                      }
                                    );
                                    applySorts(nextSorts);
                                    setOpenSortFieldId(null);
                                  }}
                                >
                                  {ColumnIcon ? (
                                    <ColumnIcon
                                      className="airtable-sort-field-menu-icon"
                                      style={
                                        isStatusColumn
                                          ? {
                                              width: STATUS_MENU_ICON_SIZE,
                                              height: STATUS_MENU_ICON_SIZE,
                                            }
                                          : undefined
                                      }
                                    />
                                  ) : (
                                    <span
                                      className="airtable-sort-field-menu-icon"
                                      aria-hidden="true"
                                    />
                                  )}
                                  <span>{column.name}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                        <button
                          type="button"
                          className="airtable-sort-direction absolute"
                          style={{
                            left: sortLayout.sortDirectionLeft,
                            width: sortLayout.sortDirectionWidth,
                          }}
                          onClick={() => {
                            setOpenSortDirectionId((prev) =>
                              prev === sortItem.columnId ? null : sortItem.columnId
                            );
                            setOpenSortFieldId(null);
                            setIsAddSortMenuOpen(false);
                          }}
                          aria-expanded={isDirectionMenuOpen}
                        >
                          <span>
                            {sortItem.direction === "asc"
                              ? directionLabels.asc
                              : directionLabels.desc}
                          </span>
                          <span className="ml-auto airtable-nav-chevron rotate-90" />
                        </button>
                        {isDirectionMenuOpen && (
                          <div
                            className="airtable-sort-direction-menu absolute z-10"
                            style={{
                              left: sortLayout.sortDirectionLeft,
                              top: sortLayout.sortFieldHeight + 1,
                              width: sortLayout.sortDirectionWidth,
                              height: 73,
                            }}
                          >
                            <button
                              type="button"
                              className="airtable-sort-direction-option"
                              style={{ top: 12 }}
                              onClick={() => {
                                const nextSorts = sortRows.map((item) =>
                                  item.columnId === sortItem.columnId
                                    ? { ...item, direction: "asc" as const }
                                    : item
                                );
                                applySorts(nextSorts);
                                setOpenSortDirectionId(null);
                              }}
                            >
                              {directionLabels.asc}
                            </button>
                            <button
                              type="button"
                              className="airtable-sort-direction-option"
                              style={{ top: 48 }}
                              onClick={() => {
                                const nextSorts = sortRows.map((item) =>
                                  item.columnId === sortItem.columnId
                                    ? { ...item, direction: "desc" as const }
                                    : item
                                );
                                applySorts(nextSorts);
                                setOpenSortDirectionId(null);
                              }}
                            >
                              {directionLabels.desc}
                            </button>
                          </div>
                        )}
                        <button
                          type="button"
                          className="airtable-sort-remove absolute"
                          style={{ left: sortLayout.sortRemoveLeft, top: removeTop }}
                          onClick={() => {
                            const nextSorts = sortRows.filter(
                              (item) => item.columnId !== sortItem.columnId
                            );
                            applySorts(nextSorts.length ? nextSorts : null);
                            setOpenSortDirectionId(null);
                            setOpenSortFieldId(null);
                          }}
                          aria-label="Remove sort"
                        >
                          <XIcon className="h-[12px] w-[12px]" />
                        </button>
                        {sortRows.length > 1 && (
                          <button
                            type="button"
                            className="airtable-sort-reorder absolute"
                            style={{ left: sortLayout.sortReorderLeft, top: reorderTop }}
                            onMouseDown={(event) =>
                              handleSortDragStart(event, sortItem.columnId)
                            }
                            aria-label="Reorder sort"
                          >
                            <ThreeDotIcon
                              style={{ width: sortLayout.sortReorderWidth, height: 13 }}
                            />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </>
              ) : (
                <>
                  {orderedColumns.map((column, index) => {
                    const top = 57 + 32 * (index + 1);
                    const ColumnIcon = getColumnIcon(
                      column.name,
                      column.type
                    );
                    const isStatusColumn = column.name === "Status";
                    return (
                      <button
                        key={column.id}
                        type="button"
                        className="airtable-sort-option"
                        style={{ top }}
                        onClick={() => {
                          applySorts([
                            { columnId: column.id, direction: "asc" as const },
                          ]);
                          setOpenSortDirectionId(null);
                          setOpenSortFieldId(null);
                          setIsAddSortMenuOpen(false);
                        }}
                      >
                        {ColumnIcon ? (
                          <ColumnIcon
                            className="airtable-sort-option-icon"
                            style={
                              isStatusColumn
                                ? {
                                    width: STATUS_MENU_ICON_SIZE,
                                    height: STATUS_MENU_ICON_SIZE,
                                  }
                                : undefined
                            }
                          />
                        ) : (
                          <span
                            className="airtable-sort-option-icon"
                            aria-hidden="true"
                          />
                        )}
                        <span>{column.name}</span>
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        )}
        {/* Sort drag phantom — rendered via portal to escape stacking contexts */}
        {draggingSortId && phantomSortX !== null && phantomSortY !== null && (() => {
          const phantomItem = sortRows.find(s => s.columnId === draggingSortId);
          if (!phantomItem) return null;
          const phantomLabel = columnById.get(phantomItem.columnId)?.name ?? "Select field";
          const phantomDirLabels = getSortDirectionLabels(phantomItem.columnId);
          const phantomDirText = phantomItem.direction === "asc" ? phantomDirLabels.asc : phantomDirLabels.desc;
          const phantomRemoveTop = (sortLayout.sortFieldHeight - sortLayout.sortRemoveSize) / 2;
          return createPortal(
            <div
              ref={sortPhantomRef}
              className="airtable-sort-phantom"
              style={{
                position: "fixed",
                left: phantomSortX,
                top: phantomSortY,
                width: sortLayout.sortConfiguredWidth,
                height: sortLayout.sortFieldHeight,
                zIndex: 10000,
                pointerEvents: "none",
                willChange: "transform",
              }}
            >
              <div
                className="airtable-sort-field absolute"
                style={{ left: sortLayout.sortFieldLeft, width: sortLayout.sortFieldWidth }}
              >
                <span>{phantomLabel}</span>
                <span className="ml-auto airtable-nav-chevron rotate-90" />
              </div>
              <div
                className="airtable-sort-direction absolute"
                style={{
                  left: sortLayout.sortDirectionLeft,
                  width: sortLayout.sortDirectionWidth,
                }}
              >
                <span>{phantomDirText}</span>
                <span className="ml-auto airtable-nav-chevron rotate-90" />
              </div>
              <div
                className="airtable-sort-remove absolute"
                style={{ left: sortLayout.sortRemoveLeft, top: phantomRemoveTop }}
              >
                <XIcon className="h-[12px] w-[12px]" />
              </div>
              <div
                className="airtable-sort-reorder absolute"
                style={{ left: sortLayout.sortReorderLeft, top: 7.5 }}
              >
                <ThreeDotIcon
                  style={{ width: sortLayout.sortReorderWidth, height: 13 }}
                />
              </div>
            </div>,
            document.body
          );
        })()}
      </div>
    </>
  );
}

export const SortSection = memo(SortSectionContent);
