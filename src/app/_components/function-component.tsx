"use client";

import clsx from "clsx";
import { useId, useRef, useEffect, useState } from "react";
import type {
  Dispatch,
  MouseEvent as ReactMouseEvent,
  SetStateAction,
  RefObject,
} from "react";
import { FilterDropdown, type FilterDropdownProps } from "./filter";
import { getSortAddMenuIconSpec, type SortLayoutConstants } from "./use-table-sort";
import {
  HIDE_FIELDS_DROPDOWN_WIDTH,
  HIDE_FIELDS_HEADER_LEFT,
  HIDE_FIELDS_HEADER_TOP,
  HIDE_FIELDS_HELP_LEFT,
  HIDE_FIELDS_HELP_TOP,
  HIDE_FIELDS_SEPARATOR_LEFT,
  HIDE_FIELDS_SEPARATOR_TOP,
  HIDE_FIELDS_SEPARATOR_WIDTH,
  HIDE_FIELDS_SEPARATOR_HEIGHT,
  HIDE_FIELDS_HOVER_LEFT,
  HIDE_FIELDS_HOVER_WIDTH,
  HIDE_FIELDS_TOGGLE_LEFT,
  HIDE_FIELDS_TOGGLE_WIDTH,
  HIDE_FIELDS_TOGGLE_HEIGHT,
  HIDE_FIELDS_TEXT_LEFT,
  HIDE_FIELDS_REORDER_WIDTH,
  HIDE_FIELDS_REORDER_HEIGHT,
  HIDE_FIELDS_REORDER_LEFT,
  HIDE_FIELDS_BUTTON_WIDTH,
  type HideFieldsRow,
} from "./use-hide-fields";

import arrowIcon from "~/assets/arrow.svg";
import assigneeIcon from "~/assets/assignee.svg";
import attachmentsIcon from "~/assets/attachments.svg";
import blueSearchIcon from "~/assets/blue-search.svg";
import colourIcon from "~/assets/colour.svg";
import filterIcon from "~/assets/filter.svg";
import gridViewIcon from "~/assets/grid-view.svg";
import groupIcon from "~/assets/group.svg";
import hideFieldsIcon from "~/assets/hide-fields.svg";
import lightArrowIcon from "~/assets/light-arrow.svg";
import nameIcon from "~/assets/name.svg";
import notesIcon from "~/assets/notes.svg";
import numberIcon from "~/assets/number.svg";
import reorderIcon from "~/assets/reorder.svg";
import rowHeightIcon from "~/assets/row-height.svg";
import shareSyncIcon from "~/assets/share-and-sync.svg";
import sortIcon from "~/assets/sort.svg";
import statusIcon from "~/assets/status.svg";
import threeLineIcon from "~/assets/three-line.svg";
import toggleIcon from "~/assets/toggle.svg";
import xIcon from "~/assets/x.svg";

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

type ColumnFieldType = "single_line_text" | "long_text" | "number";

type SortConfig = { columnId: string; direction: "asc" | "desc" };

type FilterConnector = "and" | "or";

type FilterOperator =
  | "contains"
  | "does_not_contain"
  | "is"
  | "is_not"
  | "is_empty"
  | "is_not_empty"
  | "eq"
  | "neq"
  | "lt"
  | "gt"
  | "lte"
  | "gte";

type FilterConditionItem = {
  id: string;
  type: "condition";
  columnId: string | null;
  operator: FilterOperator;
  value: string;
};

type FilterGroupItem = {
  id: string;
  type: "group";
  connector: FilterConnector;
  conditions: (FilterConditionItem | FilterGroupItem)[];
};

type FilterItem = FilterConditionItem | FilterGroupItem;


type FilterLayoutRow = {
  condition: FilterConditionItem;
  connector: string;
  showConnector: boolean;
  showConnectorControl: boolean;
  showRootConnector: boolean;
  connectorKey: string;
  scope: "root" | "group";
  groupId?: string;
  top: number;
  left: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_ICON_SCALE = 1.1;
const STATUS_MENU_ICON_SIZE = 15 * STATUS_ICON_SCALE;

// Suppress unused‑import warning – lightArrowIcon is kept for API surface parity.
void lightArrowIcon;

// ---------------------------------------------------------------------------
// Column‑icon helpers
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

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type FunctionBarProps = FilterDropdownProps & {
  // Bulk rows
  bulkRowsDisabled: boolean;
  handleAddBulkRows: () => void;

  // Hide fields
  hideFieldsButtonRef: RefObject<HTMLButtonElement | null>;
  hideFieldsMenuRef: RefObject<HTMLDivElement | null>;
  isHideFieldsMenuOpen: boolean;
  setIsHideFieldsMenuOpen: Dispatch<SetStateAction<boolean>>;
  hiddenFieldCount: number;
  hiddenColumnIdSet: Set<string>;
  hideFieldsLayout: {
    dropdownHeight: number;
    buttonTop: number;
    rows: HideFieldsRow[];
  };
  toggleHiddenColumn: (id: string) => void;
  hideAllColumns: () => void;
  showAllColumns: () => void;

  // Filter button (additional to FilterDropdownProps)
  filterButtonRef: RefObject<HTMLButtonElement | null>;
  isFilterMenuOpen: boolean;
  setIsFilterMenuOpen: Dispatch<SetStateAction<boolean>>;
  hasActiveFilters: boolean;
  filteredColumnNames: string[];

  // Sort
  sortButtonRef: RefObject<HTMLButtonElement | null>;
  sortMenuRef: RefObject<HTMLDivElement | null>;
  sortFieldMenuRef: RefObject<HTMLDivElement | null>;
  sortAddMenuListRef: RefObject<HTMLDivElement | null>;
  isSortMenuOpen: boolean;
  setIsSortMenuOpen: Dispatch<SetStateAction<boolean>>;
  openSortDirectionId: string | null;
  setOpenSortDirectionId: Dispatch<SetStateAction<string | null>>;
  openSortFieldId: string | null;
  setOpenSortFieldId: Dispatch<SetStateAction<string | null>>;
  isAddSortMenuOpen: boolean;
  setIsAddSortMenuOpen: Dispatch<SetStateAction<boolean>>;
  hasSort: boolean;
  sortRows: SortConfig[];
  sortedColumnIds: Set<string>;
  draggingSortId: string | null;
  draggingSortTop: number | null;
  applySorts: (sorts: SortConfig[] | null) => void;
  handleSortDragStart: (event: ReactMouseEvent, columnId: string) => void;
  getSortDirectionLabels: (columnId: string) => { asc: string; desc: string };
  remainingSortColumns: { id: string; name: string; type: string | null }[];
  sortAddVirtualItems: { index: number; start: number }[];
  sortAddVirtualizerSize: number;
  sortLayout: SortLayoutConstants;

  // Search
  searchButtonRef: RefObject<HTMLButtonElement | null>;
  searchMenuRef: RefObject<HTMLDivElement | null>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  isSearchMenuOpen: boolean;
  setIsSearchMenuOpen: Dispatch<SetStateAction<boolean>>;
  searchValue: string;
  setSearchValue: Dispatch<SetStateAction<string>>;
  showSearchSpinner: boolean;
  showNoSearchResults: boolean;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FunctionBar({
  // Bulk rows
  bulkRowsDisabled,
  handleAddBulkRows,

  // Hide fields
  hideFieldsButtonRef,
  hideFieldsMenuRef,
  isHideFieldsMenuOpen,
  setIsHideFieldsMenuOpen,
  hiddenFieldCount,
  hiddenColumnIdSet,
  hideFieldsLayout,
  toggleHiddenColumn,
  hideAllColumns,
  showAllColumns,

  // Filter button
  filterButtonRef,
  isFilterMenuOpen,
  setIsFilterMenuOpen,
  hasActiveFilters,
  filteredColumnNames,

  // Filter dropdown (FilterDropdownProps)
  filterMenuRef,
  filterFieldMenuListRef,
  filterOperatorMenuListRef,
  filterItems,
  setFilterItems,
  filterConnector,
  setFilterConnector,
  openFilterFieldId,
  setOpenFilterFieldId,
  openFilterOperatorId,
  setOpenFilterOperatorId,
  openFilterConnectorId,
  setOpenFilterConnectorId,
  focusedFilterValueId,
  setFocusedFilterValueId,
  filterValueErrorId,
  setFilterValueErrorId,
  draggingFilterId,
  draggingFilterTop,
  phantomFilterX,
  phantomFilterY,
  highlightedFilterFieldId,
  highlightedFilterOperatorId,
  highlightedFilterConnectorKey,
  setHighlightedFilterConnectorKey,
  setHighlightedFilterFieldId,
  setHighlightedFilterOperatorId,
  activeFilterAdd,
  handleFilterFieldSelect,
  handleFilterOperatorSelect,
  handleFilterValueChange,
  handleFilterDragStart,
  addFilterCondition,
  addFilterGroup,
  hasFilterItems,
  filterLayout,
  filterFooterTop,
  filterDropdownWidth,
  filterDropdownHeight,
  filterDropdownHeaderLeft,
  filterDropdownHeaderTop,
  filterInputLeft,
  filterInputTop,
  filterInputWidth,
  filterInputHeight,
  filterInputRadius,
  filterEmptyMessageTop,
  filterExpandedMessageTop,
  filterRowLeft,
  filterWhereTop,
  filterConnectorWidth,
  filterConnectorHeight,
  filterConnectorGap,
  filterFieldLeft,
  filterFieldWidth,
  filterFieldHeight,
  filterRowHeight,
  filterFieldSeparatorPositions,
  filterFieldSeparatorFieldLeft,
  filterFieldSeparatorOperatorLeft,
  filterFieldSeparatorValueLeft,
  filterFieldSeparatorActionsLeft,
  filterFieldMenuWidth,
  filterFieldMenuHeight,
  filterFieldMenuHeaderLeft,
  filterFieldMenuTopPadding,
  filterFieldMenuHeaderHeight,
  filterFieldMenuFirstRowTop,
  filterFieldMenuHoverPadding,
  filterFieldMenuListHeight,
  filterFieldMenuContentHeight,
  filterFieldMenuRowHeight,
  filterFieldMenuTextHeight,
  filterFieldMenuItemWidth,
  filterFieldMenuItemLeft,
  filterFieldMenuLabelLeft,
  filterOperatorMenuWidth,
  filterOperatorMenuMaxHeight,
  filterOperatorMenuFirstRowTop,
  filterOperatorMenuBottomPadding,
  filterOperatorMenuRowStride,
  filterOperatorMenuRowHeight,
  filterOperatorMenuItemWidth,
  filterOperatorMenuItemLeft,
  filterOperatorMenuHoverPadding,
  filterFieldVirtualItems,
  filterFieldVirtualizerSize,
  addFilterConditionToGroup,
  addFilterGroupToGroup,
  deleteFilterGroup,
  setGroupConnector,
  openGroupPlusId,
  setOpenGroupPlusId,
  draggingGroupId,
  filterGroupEmptyWidth,
  filterGroupEmptyHeight,
  filterGroupPaddingTop,
  filterGroupPaddingBottom,
  filterGroupPaddingLeft,
  filterGroupWhereLeft,

  // Shared column data
  orderedColumns,
  columnById,

  // Sort
  sortButtonRef,
  sortMenuRef,
  sortFieldMenuRef,
  sortAddMenuListRef,
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
  applySorts,
  handleSortDragStart,
  getSortDirectionLabels,
  remainingSortColumns,
  sortAddVirtualItems,
  sortAddVirtualizerSize,
  sortLayout,

  // Search
  searchButtonRef,
  searchMenuRef,
  searchInputRef,
  isSearchMenuOpen,
  setIsSearchMenuOpen,
  searchValue,
  setSearchValue,
  showSearchSpinner,
  showNoSearchResults,
}: FunctionBarProps) {
  const searchMaskId = useId();
  const closeMaskId = useId();
  const filterIconMaskId = useId();
  const hideFieldsIconMaskId = useId();

  // Dynamic hide fields button width
  const hideFieldsTextRef = useRef<HTMLSpanElement>(null);
  const [hideFieldsButtonWidth, setHideFieldsButtonWidth] = useState(101);
  const hideFieldsText = hiddenFieldCount > 0
    ? `${hiddenFieldCount} hidden field${hiddenFieldCount === 1 ? "" : "s"}`
    : "Hide fields";

  useEffect(() => {
    if (hideFieldsTextRef.current) {
      const textWidth = hideFieldsTextRef.current.scrollWidth;
      // text starts at left-[25px], right padding ~18px
      setHideFieldsButtonWidth(hiddenFieldCount > 0 ? 25 + textWidth + 18 : 101);
    }
  }, [hideFieldsText, hiddenFieldCount]);

  const hideFieldsExpansion = hideFieldsButtonWidth - 101;

  // Dynamic filter button width
  const filterTextRef = useRef<HTMLSpanElement>(null);
  const [filterButtonWidth, setFilterButtonWidth] = useState(66);
  const filterText = hasActiveFilters
    ? `Filtered by ${filteredColumnNames.join(", ")}`
    : "Filter";

  useEffect(() => {
    if (filterTextRef.current) {
      const textWidth = filterTextRef.current.scrollWidth;
      // text starts at left-[13px], right padding ~17px
      setFilterButtonWidth(hasActiveFilters ? 13 + textWidth + 17 : 66);
    }
  }, [filterText, hasActiveFilters]);

  const filterExpansion = filterButtonWidth - 66;

  // Dynamic sort button width
  const sortTextRef = useRef<HTMLSpanElement>(null);
  const [sortButtonWidth, setSortButtonWidth] = useState(66);
  const sortText = hasSort
    ? `Sorted by ${sortRows.length} ${sortRows.length === 1 ? "field" : "fields"}`
    : "Sort";

  useEffect(() => {
    if (sortTextRef.current) {
      const textWidth = sortTextRef.current.scrollWidth;
      // text starts at left-[10px], right padding ~17px
      setSortButtonWidth(hasSort ? 10 + textWidth + 17 : 66);
    }
  }, [sortText, hasSort, sortRows.length]);

  const sortExpansion = sortButtonWidth - 66;

  // Grid view name width for arrow and Add 100k rows positioning
  const gridViewNameRef = useRef<HTMLSpanElement>(null);
  const [arrowLeft, setArrowLeft] = useState(37);
  const [addButtonLeft, setAddButtonLeft] = useState(175);
  const VIEW_SELECTOR_PADDING = 10; // padding between view selector and Add 100k rows
  useEffect(() => {
    if (gridViewNameRef.current) {
      const textWidth = gridViewNameRef.current.scrollWidth;
      const viewSelectorRight = 54 + 27 + textWidth + 10 + 10; // button left + text left + text + gap + arrow
      setArrowLeft(27 + textWidth + 10);
      setAddButtonLeft(viewSelectorRight + VIEW_SELECTOR_PADDING);
    }
  }, []);

  return (
    <div className="relative h-[46px] bg-white">
      <div className="relative h-full min-w-[940px] airtable-secondary-font-regular">
        <img
          alt=""
          className="absolute left-[20px] top-[13px] h-[15px] w-[16px]"
          src={threeLineIcon.src}
        />
        <button type="button" className="absolute left-[54px] top-0 h-full min-w-[108px]">
          <img
            alt=""
            className="absolute left-[3px] top-[12px] h-[16px] w-[14px]"
            src={gridViewIcon.src}
          />
          <span
            ref={gridViewNameRef}
            className="absolute left-[27px] top-[14px] block max-w-[120px] truncate text-[13px] font-medium leading-[13px] text-[#1D1F24]"
            style={{ fontFamily: "Inter, sans-serif" }}
          >
            Grid view
          </span>
          <img
            alt=""
            className="absolute top-[18px] h-[6px] w-[10px]"
            style={{ left: arrowLeft }}
            src={arrowIcon.src}
          />
        </button>
        <button
          type="button"
          onClick={handleAddBulkRows}
          disabled={bulkRowsDisabled}
          style={{ left: addButtonLeft }}
          className={clsx(
            "absolute top-[10px] flex h-[26px] items-center justify-center rounded-[6px] px-3 text-[13px] leading-[13px]",
            bulkRowsDisabled
              ? "cursor-not-allowed border border-[#E2E8F0] bg-[#F8FAFC] text-[#94A3B8]"
              : "airtable-outline airtable-selection-hover bg-white text-[#1d1f24] cursor-pointer"
          )}
        >
          Add 100k rows
        </button>
        <div className="absolute right-[8.5px] top-0 flex h-full items-center">
          <div className="relative h-full w-[643px]">
            {/* ---- Hide fields ---- */}
            <div className="absolute top-0" style={{ left: 68 - hideFieldsExpansion - filterExpansion - sortExpansion }}>
              <button
                ref={hideFieldsButtonRef}
                type="button"
                className={clsx(
                  "airtable-table-feature-selection relative mt-[10px] h-[26px] !min-w-0 !px-0",
                  hiddenFieldCount > 0 &&
                    "airtable-table-feature-selection--hide-active"
                )}
                style={{
                  width: hideFieldsButtonWidth,
                  ["--hover-left" as string]: "-4px",
                  ["--hover-right" as string]: "-4px",
                } as React.CSSProperties}
                onClick={() => setIsHideFieldsMenuOpen((prev) => !prev)}
                aria-haspopup="menu"
                aria-expanded={isHideFieldsMenuOpen}
              >
                {hiddenFieldCount > 0 ? (
                  <svg
                    width={19}
                    height={16}
                    viewBox="0 0 19 16"
                    className="absolute left-[4px] top-[5px]"
                    aria-hidden="true"
                  >
                    <defs>
                      <filter id={`${hideFieldsIconMaskId}-invert`}>
                        <feColorMatrix
                          type="matrix"
                          values="-1 0 0 0 1  0 -1 0 0 1  0 0 -1 0 1  0 0 0 1 0"
                        />
                      </filter>
                      <mask id={`${hideFieldsIconMaskId}-mask`}>
                        <image
                          href={hideFieldsIcon.src}
                          width="19"
                          height="16"
                          filter={`url(#${hideFieldsIconMaskId}-invert)`}
                        />
                      </mask>
                    </defs>
                    <rect
                      width="19"
                      height="16"
                      fill="#1D1F24"
                      mask={`url(#${hideFieldsIconMaskId}-mask)`}
                    />
                  </svg>
                ) : (
                  <img
                    alt=""
                    className="absolute left-[4px] top-[5px] h-[16px] w-[19px]"
                    src={hideFieldsIcon.src}
                  />
                )}
                <span
                  ref={hideFieldsTextRef}
                  className={clsx(
                    "absolute left-[25px] top-[5px] block h-[16px] text-[13px] leading-[16px]",
                    hiddenFieldCount > 0 && "text-[#1D1F24]"
                  )}
                  style={hiddenFieldCount > 0 ? { whiteSpace: "nowrap" } : { width: "72px" }}
                >
                  {hideFieldsText}
                </span>
              </button>
              {isHideFieldsMenuOpen && (
                <div
                  ref={hideFieldsMenuRef}
                  className="airtable-hide-fields-dropdown airtable-dropdown-surface absolute right-[-8px] top-[40px] z-[120]"
                  style={{
                    width: HIDE_FIELDS_DROPDOWN_WIDTH,
                    height: hideFieldsLayout.dropdownHeight,
                  }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="relative h-full w-full">
                    <div
                      className="absolute airtable-find-field-label"
                      style={{
                        left: HIDE_FIELDS_HEADER_LEFT,
                        top: HIDE_FIELDS_HEADER_TOP,
                      }}
                    >
                      Find a field
                    </div>
                    <span
                      className="airtable-help-icon absolute text-[#878B94]"
                      style={{
                        left: HIDE_FIELDS_HELP_LEFT,
                        top: HIDE_FIELDS_HELP_TOP,
                        width: 14,
                        height: 14,
                      }}
                      aria-hidden="true"
                    />
                    <div
                      className="absolute bg-[#E4E4E4]"
                      style={{
                        left: HIDE_FIELDS_SEPARATOR_LEFT,
                        top: HIDE_FIELDS_SEPARATOR_TOP,
                        width: HIDE_FIELDS_SEPARATOR_WIDTH,
                        height: HIDE_FIELDS_SEPARATOR_HEIGHT,
                      }}
                      aria-hidden="true"
                    />
                    {hideFieldsLayout.rows.map((row) => {
                      const isHidden = hiddenColumnIdSet.has(row.column.id);
                      return (
                        <button
                          key={row.column.id}
                          type="button"
                          className="airtable-hide-fields-row"
                          style={{
                            top: row.hoverTop,
                            width: HIDE_FIELDS_HOVER_WIDTH,
                          }}
                          onClick={() => toggleHiddenColumn(row.column.id)}
                          aria-pressed={!isHidden}
                        >
                          <svg
                            className="airtable-hide-fields-toggle absolute"
                            width={HIDE_FIELDS_TOGGLE_WIDTH}
                            height={HIDE_FIELDS_TOGGLE_HEIGHT}
                            viewBox={`0 0 ${HIDE_FIELDS_TOGGLE_WIDTH} ${HIDE_FIELDS_TOGGLE_HEIGHT}`}
                            style={{
                              left:
                                HIDE_FIELDS_TOGGLE_LEFT -
                                HIDE_FIELDS_HOVER_LEFT,
                              top: row.toggleOffset,
                            }}
                            aria-hidden="true"
                          >
                            <rect
                              x="0"
                              y="0"
                              width={HIDE_FIELDS_TOGGLE_WIDTH}
                              height={HIDE_FIELDS_TOGGLE_HEIGHT}
                              rx="4"
                              fill={isHidden ? "#D9D9D9" : "#09890E"}
                            />
                            <rect
                              x={isHidden ? 2 : 7}
                              y={2}
                              width={4}
                              height={4}
                              rx={2}
                              fill="#FFFFFF"
                            />
                          </svg>
                          <img
                            alt=""
                            className="airtable-hide-fields-icon absolute"
                            style={{
                              left: row.iconLeftOffset,
                              top: row.iconTopOffset,
                              width: row.iconSpec.width,
                              height: row.iconSpec.height,
                            }}
                            src={row.iconSpec.src}
                          />
                          <span
                            className="airtable-hide-fields-label absolute"
                            style={{
                              left: HIDE_FIELDS_TEXT_LEFT - HIDE_FIELDS_HOVER_LEFT,
                              top: row.textOffset,
                            }}
                          >
                            {row.column.name}
                          </span>
                          <span
                            className="airtable-hide-fields-reorder absolute"
                            style={{
                              left: HIDE_FIELDS_REORDER_LEFT - HIDE_FIELDS_HOVER_LEFT,
                              top: row.reorderOffset,
                              width: HIDE_FIELDS_REORDER_WIDTH,
                              height: HIDE_FIELDS_REORDER_HEIGHT,
                            }}
                            aria-hidden="true"
                          />
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      className="airtable-hide-fields-action absolute"
                      style={{ left: 16, top: hideFieldsLayout.buttonTop }}
                      onClick={hideAllColumns}
                    >
                      Hide all
                    </button>
                    <button
                      type="button"
                      className="airtable-hide-fields-action absolute"
                      style={{
                        left:
                          HIDE_FIELDS_DROPDOWN_WIDTH -
                          16 -
                          HIDE_FIELDS_BUTTON_WIDTH,
                        top: hideFieldsLayout.buttonTop,
                      }}
                      onClick={showAllColumns}
                    >
                      Show all
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ---- Filter ---- */}
            <div className="absolute top-0" style={{ left: 178 - filterExpansion - sortExpansion }}>
              <button
                ref={filterButtonRef}
                type="button"
                className={clsx(
                  "airtable-table-feature-selection relative mt-[10px] h-[26px] !min-w-0 !px-0",
                  hasActiveFilters &&
                    "airtable-table-feature-selection--filter-active text-[#1d1f24]"
                )}
                style={{
                  width: filterButtonWidth,
                  ["--hover-left" as string]: "-4px",
                  ["--hover-right" as string]: "-4px",
                } as React.CSSProperties}
                onClick={() =>
                  setIsFilterMenuOpen((prev) => {
                    const next = !prev;
                    if (!next) {
                      setOpenFilterFieldId(null);
                      setOpenFilterOperatorId(null);
                      setOpenFilterConnectorId(null);
                    }
                    return next;
                  })
                }
                aria-haspopup="menu"
                aria-expanded={isFilterMenuOpen}
              >
                {hasActiveFilters ? (
                  <svg
                    width={18}
                    height={12}
                    viewBox="0 0 18 12"
                    className="absolute left-[4px] top-[6px]"
                    aria-hidden="true"
                  >
                    <defs>
                      <filter id={`${filterIconMaskId}-invert`}>
                        <feColorMatrix
                          type="matrix"
                          values="-1 0 0 0 1  0 -1 0 0 1  0 0 -1 0 1  0 0 0 1 0"
                        />
                      </filter>
                      <mask id={`${filterIconMaskId}-mask`}>
                        <image
                          href={filterIcon.src}
                          width="18"
                          height="12"
                          filter={`url(#${filterIconMaskId}-invert)`}
                        />
                      </mask>
                    </defs>
                    <rect
                      width="18"
                      height="12"
                      fill="#1D1F24"
                      mask={`url(#${filterIconMaskId}-mask)`}
                    />
                  </svg>
                ) : (
                  <img
                    alt=""
                    className="absolute left-[4px] top-[6px] h-[12px] w-[18px]"
                    src={filterIcon.src}
                  />
                )}
                <span
                  ref={filterTextRef}
                  className="absolute left-[13px] top-[5px] block h-[16px] text-[13px] leading-[16px]"
                  style={hasActiveFilters ? { whiteSpace: "nowrap" } : { width: "60px" }}
                >
                  {filterText}
                </span>
              </button>
              {isFilterMenuOpen && (
                <FilterDropdown
                  filterMenuRef={filterMenuRef}
                  filterFieldMenuListRef={filterFieldMenuListRef}
                  filterOperatorMenuListRef={filterOperatorMenuListRef}
                  filterItems={filterItems}
                  setFilterItems={setFilterItems}
                  filterConnector={filterConnector}
                  setFilterConnector={setFilterConnector}
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
                />
              )}
            </div>

            {/* ---- Group ---- */}
            <button
              type="button"
              className="absolute top-[10px] h-[26px] w-[60px] text-left"
              style={{ left: 261 - sortExpansion }}
            >
              <img alt="" className="absolute left-0 top-[6px] h-[14px] w-[16px]" src={groupIcon.src} />
              <span className="absolute left-[20px] top-[5px] block h-[16px] w-[40px] text-[13px] leading-[16px]">
                Group
              </span>
            </button>

            {/* ---- Sort ---- */}
            <div className="absolute top-0" style={{ left: 338 - sortExpansion }}>
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
                  ["--hover-left" as string]: "-4px",
                  ["--hover-right" as string]: "-4px",
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
                <span className="absolute left-[4px] top-[6px] inline-flex h-[14px] w-[13px]">
                  <img
                    alt=""
                    className={clsx(
                      "h-[14px] w-[13px]",
                      hasSort && "airtable-sort-icon--active"
                    )}
                    src={sortIcon.src}
                  />
                  <span
                    className="airtable-sort-white-overlay airtable-sort-white-overlay--hover"
                    aria-hidden="true"
                  />
                  {hasSort && (
                    <>
                      <span
                        className="airtable-sort-white-overlay airtable-sort-white-overlay--active"
                        aria-hidden="true"
                      />
                      <span className="airtable-sort-arrow-overlay" aria-hidden="true" />
                    </>
                  )}
                </span>
                <span
                  ref={sortTextRef}
                  className="absolute left-[10px] top-[5px] block h-[16px] text-[13px] leading-[16px]"
                  style={hasSort ? { whiteSpace: "nowrap" } : { width: "52px" }}
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
                          const reorderTop = (sortLayout.sortFieldHeight - 13) / 2;
                          const isFieldMenuOpen =
                            openSortFieldId === sortItem.columnId;
                          const isDirectionMenuOpen =
                            openSortDirectionId === sortItem.columnId;
                          const shouldElevateRow =
                            isDragging || isFieldMenuOpen || isDirectionMenuOpen;
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
                                transition: isDragging ? "none" : "top 0.15s ease",
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
                                    const iconSrc = getColumnIconSrc(
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
                                        {iconSrc ? (
                                          <img
                                            alt=""
                                            className="airtable-sort-field-menu-icon"
                                            style={
                                              isStatusColumn
                                                ? {
                                                    width: STATUS_MENU_ICON_SIZE,
                                                    height: STATUS_MENU_ICON_SIZE,
                                                  }
                                                : undefined
                                            }
                                            src={iconSrc}
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
                                <img alt="" className="h-[12px] w-[12px]" src={xIcon.src} />
                              </button>
                              <button
                                type="button"
                                className="airtable-sort-reorder absolute"
                                style={{ left: sortLayout.sortReorderLeft, top: reorderTop }}
                                onMouseDown={(event) =>
                                  handleSortDragStart(event, sortItem.columnId)
                                }
                                aria-label="Reorder sort"
                              >
                                <img
                                  alt=""
                                  style={{ width: sortLayout.sortReorderWidth, height: 13 }}
                                  src={reorderIcon.src}
                                />
                              </button>
                            </div>
                          );
                        })}
                        <div className="absolute" style={{ left: 23, top: sortLayout.sortAddTop }}>
                          <button
                            type="button"
                            className="airtable-sort-add"
                            disabled={remainingSortColumns.length === 0}
                            onClick={() => {
                              if (!remainingSortColumns.length) return;
                              setIsAddSortMenuOpen((prev) => !prev);
                              setOpenSortDirectionId(null);
                              setOpenSortFieldId(null);
                            }}
                            aria-expanded={isAddSortMenuOpen}
                          >
                            <span className="airtable-plus-icon" aria-hidden="true" />
                            <span>Add another sort</span>
                          </button>
                          {isAddSortMenuOpen && remainingSortColumns.length > 0 && (
                            <div
                              className="airtable-sort-add-menu absolute z-10"
                              style={{
                                top: "calc(100% + 7px)",
                                width: sortLayout.sortAddMenuWidth,
                                height: sortLayout.sortAddMenuHeight,
                              }}
                            >
                              <div
                                className="absolute airtable-find-field-label"
                                style={{ left: 10, top: 10 }}
                              >
                                Find a field
                              </div>
                              <div
                                ref={sortAddMenuListRef}
                                className="airtable-sort-add-menu-list absolute left-0 right-0"
                                style={{
                                  top: sortLayout.sortAddMenuFirstRowTop,
                                  height: sortLayout.sortAddMenuListHeight,
                                  overflowY:
                                    sortLayout.sortAddMenuContentHeight > sortLayout.sortAddMenuHeight
                                      ? "auto"
                                      : "hidden",
                                }}
                              >
                                <div
                                  className="relative w-full"
                                  style={{ height: sortAddVirtualizerSize }}
                                >
                                  {sortAddVirtualItems.map((virtualRow) => {
                                    const column =
                                      remainingSortColumns[virtualRow.index];
                                    if (!column) return null;
                                    const iconSpec = getSortAddMenuIconSpec(
                                      column.name,
                                      column.type
                                    );
                                    return (
                                      <button
                                        key={column.id}
                                        type="button"
                                        className="airtable-sort-add-menu-item"
                                        style={{
                                          top: virtualRow.start,
                                          height: sortLayout.sortAddMenuRowHeight,
                                        }}
                                        onClick={() => {
                                          const nextSorts = [
                                            ...sortRows,
                                            { columnId: column.id, direction: "asc" as const },
                                          ];
                                          applySorts(nextSorts);
                                          setIsAddSortMenuOpen(false);
                                        }}
                                      >
                                        <img
                                          alt=""
                                          className="airtable-sort-add-menu-icon absolute top-1/2 -translate-y-1/2"
                                          style={{
                                            left: iconSpec.left,
                                            width: iconSpec.width,
                                            height: iconSpec.height,
                                          }}
                                          src={iconSpec.src}
                                        />
                                        <span
                                          className="airtable-sort-add-menu-label absolute top-1/2 -translate-y-1/2"
                                          style={{ left: 30 }}
                                        >
                                          {column.name}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                        <div
                          className="absolute left-px right-px h-px bg-[#E4E4E4]"
                          style={{ top: sortLayout.sortFooterTop - 1 }}
                          aria-hidden="true"
                        />
                        <div
                          className="airtable-sort-footer absolute left-0 right-0"
                          style={{
                            top: sortLayout.sortFooterTop,
                            bottom: 0,
                            paddingLeft: 22,
                          }}
                        >
                          <div className="flex h-full items-center gap-[7px]">
                            <img
                              alt=""
                              className="h-[16px] w-[22px]"
                              src={toggleIcon.src}
                            />
                            <span className="text-[13px] font-normal text-[#1d1f24]">
                              Automatically sort records
                            </span>
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <img
                          alt=""
                          className="absolute left-[21px] top-[58px] h-[16px] w-[16px]"
                          src={blueSearchIcon.src}
                        />
                        <div className="absolute left-[48px] top-[57px] text-[13px] font-normal text-[#989AA1]">
                          Find a field
                        </div>
                        {orderedColumns.map((column, index) => {
                          const top = 57 + 32 * (index + 1);
                          const iconSrc = getColumnIconSrc(
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
                              {iconSrc ? (
                                <img
                                  alt=""
                                  className="airtable-sort-option-icon"
                                  style={
                                    isStatusColumn
                                      ? {
                                          width: STATUS_MENU_ICON_SIZE,
                                          height: STATUS_MENU_ICON_SIZE,
                                        }
                                      : undefined
                                  }
                                  src={iconSrc}
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
            </div>

            {/* ---- Color ---- */}
            <button
              type="button"
              className="absolute top-[10px] h-[26px] w-[68px] text-left"
              style={{ left: 410 }}
            >
              <img
                alt=""
                className="absolute left-0 top-[3px] h-[19px] w-[20px]"
                src={colourIcon.src}
              />
              <span className="absolute left-[20px] top-[5px] block h-[16px] w-[48px] text-[13px] leading-[16px]">
                Color
              </span>
            </button>

            {/* ---- Row height ---- */}
            <button
              type="button"
              className="absolute top-0 h-full w-[19px]"
              style={{ left: 485 }}
              aria-label="Row height"
            >
              <img
                alt=""
                className="absolute left-0 top-[16px] h-[15px] w-[19px]"
                src={rowHeightIcon.src}
              />
            </button>

            {/* ---- Share and sync ---- */}
            <button
              type="button"
              className="absolute top-[10px] h-[26px] w-[114px] text-left"
              style={{ left: 528 }}
            >
              <img
                alt=""
                className="absolute left-0 top-[6px] h-[15px] w-[15px]"
                src={shareSyncIcon.src}
              />
              <span className="absolute left-[19px] top-[5px] block h-[16px] w-[95px] whitespace-nowrap text-[13px] leading-[16px]">
                Share and sync
              </span>
            </button>
          </div>

          {/* ---- Search button ---- */}
          <button
            ref={searchButtonRef}
            type="button"
            className="airtable-table-feature-selection airtable-search-trigger ml-[21px]"
            onClick={() => setIsSearchMenuOpen((prev) => !prev)}
            aria-haspopup="dialog"
            aria-expanded={isSearchMenuOpen}
            aria-label="Search"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 30 30.000001"
              className="block"
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
              xmlnsXlink="http://www.w3.org/1999/xlink"
              preserveAspectRatio="xMidYMid meet"
            >
              <defs>
                <clipPath id={`${searchMaskId}-clip1`}>
                  <path d="M 0.484375 0 L 29.515625 0 L 29.515625 29.03125 L 0.484375 29.03125 Z M 0.484375 0 " clipRule="nonzero" />
                </clipPath>
                <clipPath id={`${searchMaskId}-clip2`}>
                  <path d="M 0.484375 0 L 29.515625 0 L 29.515625 29 L 0.484375 29 Z M 0.484375 0 " clipRule="nonzero" />
                </clipPath>
              </defs>
              <g clipPath={`url(#${searchMaskId}-clip1)`}>
                <path fill="var(--search-icon-bg)" d="M 0.484375 0 L 29.515625 0 L 29.515625 29.03125 L 0.484375 29.03125 Z M 0.484375 0 " fillOpacity="1" fillRule="nonzero" />
                <path fill="var(--search-icon-bg)" d="M 0.484375 0 L 29.515625 0 L 29.515625 29.03125 L 0.484375 29.03125 Z M 0.484375 0 " fillOpacity="1" fillRule="nonzero" />
              </g>
              <g clipPath={`url(#${searchMaskId}-clip2)`}>
                <g transform="matrix(1.036866, 0, 0, 1.036866, 0.48387, 0.00000193548)">
                  <image
                    x="0"
                    y="0"
                    width="28"
                    height="28"
                    href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAIAAAD9b0jDAAAABmJLR0QA/wD/AP+gvaeTAAACk0lEQVRIia3Vz0vbYBgH8Cc66i5SYhGzjSS7vNkhrQe1NepWqVaFdpTsto1tHvTgfYwyHQwFHWN/QUsHVg96LL0ponS1g7aDCtsO204G2irWvl5TarNDoNY0rf3h9/i+7/Mhed+8TwhFUeC2c0d3VFGUZPLHzu5eIpE8OT3DOE+SPVRfr81mnZl2Wq1DBEHUQYnqJ43Fvq99+vLz1+9aNRYzv/j+3djYaEPo5eXl6trnwNcggPLg/j1R9Ew4xhmGIUkSYyxJ0v5BJBQKpzNZAGJ+bnZp0dvZ2an/pmqKxeLc/ALNIsTxPn9AlmVFL7Is+/wBxPE0i+bmF4rFYvWaK3R5ZZVm0cCgkEod6XKVSaWOBgYFmkXLK6s10ehhjGY5xPGNiGUXcTzNctHDmA5aKpVcbpFmkc8faFBU4/MHaBa53GKpVNKi8XiCZpEwYq+1j7Uiy7IwYqdZFI8nKsc7AGBndw8ARNFjMBjqfH3VMRgMougpC+V0AEAikQSACcd4U6IatUoVrqEnp2cAwDBMC6hapQrXUIzzAECSZAuoWoXzWIuSZA8AYIx1y+oHX2AAMBq7tSjV1wsAkiS1gErHEgBQFKVFbTYrAOwfRFpA1Sph2KZFZ6adABAKhQuFQlNioVAIhcIAMOl0aFGrdchi5tOZ7Hpwsyl0PbiZzmQtZn50RLg2od6Blu8+8xBFvkU1U+12qaUPH6tn2+qnNIucU65cLqdZ03Dnv8DS8VXnJwh4/eplPJ788/ffIw5tb22YTKay0+I/yut9a3/y+Pz8/PmLN9WuDgrVf9M8Nhq7KYoShm2TTkflWeu7N57Jjcnlcs4pV+X+3gJa6bqfPlPUJt1+TCbT9tZGf7+5625XzT1tM/8BN4afAouIszQAAAAASUVORK5CYII="
                    preserveAspectRatio="xMidYMid meet"
                  />
                </g>
              </g>
            </svg>
          </button>
        </div>
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-px bg-[#DEDEDE]" aria-hidden="true" />

      {/* ---- Search dropdown ---- */}
      {isSearchMenuOpen && (
        <div
          ref={searchMenuRef}
          className="absolute right-[8px] top-[calc(100%+1px)] z-50 h-[41px] w-[370px] rounded-b-[5px] rounded-t-none border-[2px] border-[#E5E5E5] border-t-0 bg-white"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="relative h-full w-full">
            <input
              ref={searchInputRef}
              value={searchValue}
              onChange={(event) => {
                setSearchValue(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  setIsSearchMenuOpen(false);
                }
              }}
              placeholder="Find in view..."
              className="absolute bg-transparent text-[13px] font-normal text-[#1D1F24] placeholder:text-[#A9A9A9] focus:outline-none"
              style={{ left: 12, top: 12, right: 101 }}
              aria-label="Find in view"
            />
            {showSearchSpinner && (
              <span
                className="airtable-search-spinner"
                style={{ right: 111, top: 13 }}
                aria-hidden="true"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  aria-hidden="true"
                >
                  <circle
                    cx="7"
                    cy="7"
                    r="6.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1"
                    strokeLinecap="round"
                    strokeDasharray="0.5 0.5"
                    pathLength="3"
                  />
                </svg>
              </span>
            )}
            {showNoSearchResults && (
              <span
                className="airtable-search-no-results"
                style={{ right: 110, top: 14 }}
              >
                No results
              </span>
            )}
            <button
              type="button"
              className="absolute flex items-center justify-center rounded-[6px] bg-[#1D1F24] text-[11px] font-medium text-white"
              style={{
                left: 269,
                top: 8,
                width: 67,
                height: 24,
                boxShadow: "var(--airtable-button-shadow)",
              }}
            >
              Ask Omni
            </button>
            <button
              type="button"
              className="airtable-table-feature-selection airtable-x-trigger absolute"
              style={{ left: 340, top: 9 }}
              onClick={() => setIsSearchMenuOpen(false)}
              aria-label="Close search"
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                className="block"
                aria-hidden="true"
              >
                <defs>
                  <filter id={`${closeMaskId}-invert`}>
                    <feColorMatrix
                      type="matrix"
                      values="-1 0 0 0 1 0 -1 0 0 1 0 0 -1 0 1 0 0 0 1 0"
                    />
                  </filter>
                  <mask
                    id={`${closeMaskId}-mask`}
                    maskUnits="userSpaceOnUse"
                    x="0"
                    y="0"
                    width="10"
                    height="10"
                    maskContentUnits="userSpaceOnUse"
                  >
                    <image
                      href={xIcon.src}
                      width="10"
                      height="10"
                      filter={`url(#${closeMaskId}-invert)`}
                      preserveAspectRatio="xMidYMid meet"
                    />
                  </mask>
                </defs>
                <rect
                  width="10"
                  height="10"
                  fill="#1D1F24"
                  mask={`url(#${closeMaskId}-mask)`}
                />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
