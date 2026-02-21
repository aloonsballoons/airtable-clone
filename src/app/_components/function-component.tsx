"use client";

import clsx from "clsx";
import { useRef, useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
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

import ArrowIcon from "~/assets/arrow.svg";
import AssigneeIcon from "~/assets/assignee.svg";
import DeleteIcon from "~/assets/delete.svg";
import DuplicateIcon from "~/assets/duplicate.svg";
import GreyGridViewIcon from "~/assets/grey-grid-view.svg";
import RenameIcon from "~/assets/rename.svg";
import AttachmentsIcon from "~/assets/attachments.svg";
import BlueSearchIcon from "~/assets/blue-search.svg";
import ColourIcon from "~/assets/colour.svg";
import FilterIcon from "~/assets/filter.svg";
import FilterActiveIcon from "~/assets/filter-active.svg";
import GridViewIcon from "~/assets/grid-view.svg";
import GroupIcon from "~/assets/group.svg";
import HideFieldsIcon from "~/assets/hide-fields.svg";
import HideFieldsActiveIcon from "~/assets/hide-fields-active.svg";
import LightArrowIcon from "~/assets/light-arrow.svg";
import NameIcon from "~/assets/name.svg";
import NotesIcon from "~/assets/notes.svg";
import NumberIcon from "~/assets/number.svg";
import ReorderIcon from "~/assets/reorder.svg";
import ThreeDotIcon from "~/assets/three-dot.svg";
import RowHeightIcon from "~/assets/row-height.svg";
import ShareSyncIcon from "~/assets/share-and-sync.svg";
import SortIcon from "~/assets/sort.svg";
import SortActiveIcon from "~/assets/sort-active.svg";
import StatusIcon from "~/assets/status.svg";
import ThreeLineIcon from "~/assets/three-line.svg";
import ToggleIcon from "~/assets/toggle.svg";
import XIcon from "~/assets/x.svg";

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

// Suppress unused‑import warning – LightArrowIcon is kept for API surface parity.
void LightArrowIcon;

// ---------------------------------------------------------------------------
// Column‑icon helpers
// ---------------------------------------------------------------------------

type SvgComponent = React.ComponentType<React.SVGProps<SVGSVGElement>>;

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
// Props
// ---------------------------------------------------------------------------

export type FunctionBarProps = FilterDropdownProps & {
  // View name
  viewName?: string;
  activeViewId?: string | null;
  viewCount?: number;
  allViewNames?: string[];
  onRenameView?: (viewId: string, newName: string) => void;
  onDeleteView?: (viewId: string) => void;
  onDuplicateView?: (viewId: string, name: string) => void;

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
  sortPhantomRef: RefObject<HTMLDivElement | null>;
  phantomSortX: number | null;
  phantomSortY: number | null;
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
  // View name
  viewName = "Grid view",
  activeViewId = null,
  viewCount = 1,
  allViewNames = [],
  onRenameView,
  onDeleteView,
  onDuplicateView,

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
  sortPhantomRef,
  phantomSortX,
  phantomSortY,
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
  // Static IDs avoid useId() hydration mismatches in SVG clipPath/mask elements.
  // Safe because only one FunctionBar is rendered at a time.
  const searchMaskId = "fn-search-svg";

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
  const [filterTextWidth, setFilterTextWidth] = useState(0);
  const [inactiveFilterTextWidth, setInactiveFilterTextWidth] = useState(0);
  const filterText = hasActiveFilters
    ? `Filtered by ${filteredColumnNames.join(", ")}`
    : "Filter";

  // Spacing constants for Filter button - these must be preserved in both active and inactive states
  const FILTER_ICON_LEFT = 4; // Icon left padding from button edge
  const FILTER_TEXT_LEFT = 13; // Text left (inactive)
  const FILTER_TEXT_LEFT_ACTIVE = 25; // Text left (active) — icon ends at ~19, gap matches hide fields (text at 25)
  const FILTER_TEXT_ICON_GAP = FILTER_TEXT_LEFT - FILTER_ICON_LEFT; // 9px gap (inactive)
  const FILTER_RIGHT_PADDING = 17; // Right padding (inactive)
  const FILTER_RIGHT_PADDING_ACTIVE = 18; // Right padding (active) — matches hide fields

  useEffect(() => {
    if (filterTextRef.current) {
      const textWidth = filterTextRef.current.scrollWidth;
      setFilterTextWidth(textWidth);
      
      // Track inactive text width - measure "Filter" text width when inactive
      if (!hasActiveFilters) {
        setInactiveFilterTextWidth(textWidth);
      } else if (inactiveFilterTextWidth === 0) {
        // If we start in active state, calculate inactive width from inactive button width
        // Inactive button: 66px = FILTER_TEXT_LEFT (13px) + textWidth + FILTER_RIGHT_PADDING (17px)
        // So inactive textWidth = 66 - 13 - 17 = 36px
        setInactiveFilterTextWidth(66 - FILTER_TEXT_LEFT - FILTER_RIGHT_PADDING);
      }
      
      setFilterButtonWidth(
        hasActiveFilters
          ? FILTER_TEXT_LEFT_ACTIVE + textWidth + FILTER_RIGHT_PADDING_ACTIVE
          : 66
      );
    }
  }, [filterText, hasActiveFilters, inactiveFilterTextWidth]);

  const filterExpansion = filterButtonWidth - 66;
  // Calculate text expansion: how much the text width increased when active
  const filterTextExpansion = hasActiveFilters && inactiveFilterTextWidth > 0 
    ? filterTextWidth - inactiveFilterTextWidth 
    : 0;
  
  // Filter button right edge anchor point (fixed position)
  const FILTER_BUTTON_RIGHT_EDGE = 246;

  // Dynamic sort button width
  const sortTextRef = useRef<HTMLSpanElement>(null);
  const [sortButtonWidth, setSortButtonWidth] = useState(66);
  const sortText = hasSort
    ? `Sorted by ${sortRows.length} ${sortRows.length === 1 ? "field" : "fields"}`
    : "Sort";

  useEffect(() => {
    if (sortTextRef.current) {
      const textWidth = sortTextRef.current.scrollWidth;
      // active: text at left=25, right padding 18 (matches hide fields active)
      // inactive: fixed 66px
      setSortButtonWidth(hasSort ? 25 + textWidth + 18 : 66);
    }
  }, [sortText, hasSort, sortRows.length]);

  const sortExpansion = sortButtonWidth - 66;

  // Position Filter button from its right edge so it expands leftward (after sortExpansion is defined)
  const filterButtonLeft = FILTER_BUTTON_RIGHT_EDGE - filterButtonWidth - sortExpansion;

  // View dropdown state
  const [isViewDropdownOpen, setIsViewDropdownOpen] = useState(false);
  const [isViewButtonHovered, setIsViewButtonHovered] = useState(false);
  // editMode: null | "rename" | "duplicate"
  const [editMode, setEditMode] = useState<"rename" | "duplicate" | null>(null);
  const [editValue, setEditValue] = useState("");

  // Grid view name width for arrow and Add 100k rows positioning
  const gridViewNameRef = useRef<HTMLSpanElement>(null);
  const [arrowLeft, setArrowLeft] = useState(37);
  const [addButtonLeft, setAddButtonLeft] = useState(175);
  const VIEW_SELECTOR_PADDING = 10; // padding between view selector and Add 100k rows
  useEffect(() => {
    if (gridViewNameRef.current) {
      const textWidth = gridViewNameRef.current.scrollWidth;
      const textRight = 27 + textWidth;
      const arrowPos = textRight + 10; // 10px gap between text right edge and arrow left edge
      const arrowWidth = 10;
      const viewSelectorRight = 54 + arrowPos + arrowWidth;
      setArrowLeft(arrowPos);
      setAddButtonLeft(viewSelectorRight + VIEW_SELECTOR_PADDING);
    }
  }, [viewName, editMode]);
  const viewButtonRef = useRef<HTMLButtonElement>(null);
  const viewDropdownRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Compute hover rectangle width dynamically based on content
  const viewButtonWidth = arrowLeft + 10 + 8; // arrow left + arrow width + right padding

  const isCustomViewId = activeViewId !== null && activeViewId !== "pending-view";
  const canDelete = viewCount > 1;

  const handleViewButtonClick = useCallback(() => {
    setIsViewDropdownOpen((prev) => !prev);
  }, []);

  // Track which view the edit is targeting (so rename after duplicate targets the new view)
  const editTargetViewIdRef = useRef<string | null>(null);
  const editSubmittedRef = useRef(false);
  // Track the initial name when entering edit mode (for duplicate: the default copy name)
  const editInitialNameRef = useRef<string>("");

  const handleRenameStart = useCallback(() => {
    editTargetViewIdRef.current = activeViewId;
    editSubmittedRef.current = false;
    editInitialNameRef.current = viewName;
    setEditValue(viewName);
    setEditMode("rename");
    setIsViewDropdownOpen(false);
    setTimeout(() => {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }, 0);
  }, [viewName, activeViewId]);

  const handleDuplicateStart = useCallback(() => {
    // Generate a unique copy name by checking existing view names
    const baseCopyName = `${viewName} copy`;
    let defaultName = baseCopyName;
    if (allViewNames.includes(defaultName)) {
      let copyNum = 2;
      while (allViewNames.includes(`${baseCopyName} ${copyNum}`)) {
        copyNum++;
      }
      defaultName = `${baseCopyName} ${copyNum}`;
    }
    // Create the duplicate immediately
    if (activeViewId) {
      onDuplicateView?.(activeViewId, defaultName);
    }
    // Show rename input so user can change the name
    editTargetViewIdRef.current = null; // will be set once the new view id arrives via activeViewId
    editSubmittedRef.current = false;
    editInitialNameRef.current = defaultName;
    setEditValue(defaultName);
    setEditMode("duplicate");
    setIsViewDropdownOpen(false);
    setTimeout(() => {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }, 0);
  }, [viewName, activeViewId, onDuplicateView, allViewNames]);

  // Track activeViewId changes during edit mode so the rename targets the correct view.
  // For rename: if activeViewId was null when rename started (e.g. first view still loading),
  // capture it once it arrives.
  // For duplicate: capture the new view id once it resolves from "pending-view" to a real UUID.
  useEffect(() => {
    if (editMode === "rename" && activeViewId && activeViewId !== "pending-view" && !editTargetViewIdRef.current) {
      editTargetViewIdRef.current = activeViewId;
    }
    if (editMode === "duplicate" && activeViewId && activeViewId !== "pending-view") {
      editTargetViewIdRef.current = activeViewId;
    }
  }, [editMode, activeViewId]);

  const handleEditSubmit = useCallback(() => {
    // Guard against double submission (blur fires after Enter unmounts input)
    if (editSubmittedRef.current) return;
    editSubmittedRef.current = true;

    // Read directly from the input DOM node to avoid stale closure issues
    const currentValue = editInputRef.current?.value ?? editValue;
    const trimmed = currentValue.trim();
    if (!trimmed) {
      setEditMode(null);
      return;
    }
    if (editMode === "rename") {
      const targetId = editTargetViewIdRef.current;
      // Compare against the initial name stored in the ref (avoids stale closure)
      if (targetId && trimmed !== editInitialNameRef.current) {
        onRenameView?.(targetId, trimmed);
      }
    } else if (editMode === "duplicate") {
      // Duplicate was already created — rename it if user changed the name
      const targetId = editTargetViewIdRef.current;
      if (targetId && trimmed !== editInitialNameRef.current) {
        onRenameView?.(targetId, trimmed);
      }
    }
    setEditMode(null);
  }, [editValue, editMode, onRenameView]);

  const handleDeleteView = useCallback(() => {
    if (activeViewId && canDelete) {
      onDeleteView?.(activeViewId);
    }
    setIsViewDropdownOpen(false);
  }, [activeViewId, canDelete, onDeleteView]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isViewDropdownOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        viewDropdownRef.current &&
        !viewDropdownRef.current.contains(event.target as Node) &&
        viewButtonRef.current &&
        !viewButtonRef.current.contains(event.target as Node)
      ) {
        setIsViewDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isViewDropdownOpen]);

  return (
    <div className="relative h-[46px] bg-white">
      <div className="relative h-full min-w-[940px] airtable-secondary-font-regular">
        <ThreeLineIcon
          className="absolute left-[20px] top-[17px] h-[15px] w-[16px]"
        />
        {editMode !== null ? (
          /* 189x30 edit rectangle: stroke BFBFBF, stroke-width 2, radius 3,
             bottom edge 8.5px above container bottom → top = 46 - 8.5 - 30 = 7.5,
             x same as hover rect left (54 - 4 = 50) */
          <input
            ref={editInputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleEditSubmit}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); handleEditSubmit(); }
              if (e.key === "Escape") setEditMode(null);
            }}
            className="absolute rounded-[3px] bg-white outline-none"
            style={{
              left: 50,
              top: 7.5,
              width: 189,
              height: 30,
              border: "2px solid #BFBFBF",
              fontFamily: "Inter, sans-serif",
              fontWeight: 600,
              fontSize: 14,
              color: "#1D1F24",
              paddingLeft: 8,
              paddingRight: 8,
              boxSizing: "border-box",
              zIndex: 10,
            }}
          />
        ) : (
          <button
            ref={viewButtonRef}
            type="button"
            className="absolute left-[54px] top-0 h-full cursor-pointer border-none bg-transparent p-0 outline-none"
            style={{ minWidth: 108 }}
            onMouseEnter={() => setIsViewButtonHovered(true)}
            onMouseLeave={() => setIsViewButtonHovered(false)}
            onClick={handleViewButtonClick}
          >
            {/* Hover background rectangle — extended 4px to the left */}
            <span
              className="absolute rounded-[3px] transition-colors"
              style={{
                left: -4,
                top: 10,
                width: viewButtonWidth + 4,
                height: 26,
                backgroundColor: isViewButtonHovered || isViewDropdownOpen ? "#F2F2F2" : "transparent",
                pointerEvents: "none",
              }}
            />
            {/* Grid view icon — swap to grey on hover */}
            <GridViewIcon
              className="absolute left-[3px] top-[16px] h-[15px] w-[16px]"
              style={{
                opacity: isViewButtonHovered || isViewDropdownOpen ? 0 : 1,
                transition: "opacity 0.1s ease",
              }}
            />
            <GreyGridViewIcon
              className="absolute left-[3px] top-[16px] h-[15px] w-[16px]"
              style={{
                opacity: isViewButtonHovered || isViewDropdownOpen ? 1 : 0,
                transition: "opacity 0.1s ease",
              }}
            />
            <span
              ref={gridViewNameRef}
              className="absolute left-[27px] top-[18px] block whitespace-nowrap text-[13px] font-medium leading-[13px] text-[#1D1F24]"
              style={{ fontFamily: "Inter, sans-serif" }}
            >
              {viewName}
            </span>
            {/* Arrow icon — mix-blend-mode: multiply turns white parts into hover bg color */}
            <ArrowIcon
              className="absolute h-[6px] w-[10px]"
              style={{
                left: arrowLeft,
                top: 22,
                mixBlendMode: isViewButtonHovered || isViewDropdownOpen ? "multiply" : "normal",
              }}
            />
          </button>
        )}
        {/* View dropdown */}
        {isViewDropdownOpen && (
          <div
            ref={viewDropdownRef}
            className="airtable-dropdown-surface absolute z-[200] rounded-[6px]"
            style={{
              left: 50, // aligned with hover rect left (button 54 - 4)
              top: 44, // button bottom (10 + 26) + 8px gap
              width: 352,
              height: 132,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative h-full w-full">
              {/* Rename view */}
              <button
                type="button"
                className="group/rename absolute cursor-pointer border-none bg-transparent p-0 outline-none"
                style={{ left: 12, top: 12, width: 328, height: 35 }}
                onClick={handleRenameStart}
              >
                <span
                  className="absolute rounded-[4px] transition-colors group-hover/rename:bg-[#F2F2F2]"
                  style={{ left: 0, top: 0, width: 328, height: 35, pointerEvents: "none" }}
                />
                <RenameIcon
                  className="absolute group-hover/rename:[mix-blend-mode:multiply]"
                  style={{ left: 19 - 12, top: 23 - 12, width: 16.5, height: 14.35 }}
                />
                <span
                  className="absolute text-[13px] font-normal text-[#1D1F24]"
                  style={{ left: 44 - 12, top: 21 - 12, fontFamily: "Inter, sans-serif" }}
                >
                  Rename view
                </span>
              </button>

              {/* Duplicate view */}
              <button
                type="button"
                className="group/dup absolute cursor-pointer border-none bg-transparent p-0 outline-none"
                style={{ left: 12, top: 46, width: 328, height: 35 }}
                onClick={handleDuplicateStart}
              >
                <span
                  className="absolute rounded-[4px] transition-colors group-hover/dup:bg-[#F2F2F2]"
                  style={{ left: 0, top: 0, width: 328, height: 35, pointerEvents: "none" }}
                />
                <DuplicateIcon
                  className="absolute group-hover/dup:[mix-blend-mode:multiply]"
                  style={{ left: 21 - 12, top: 56 - 46, width: 15, height: 15 }}
                />
                <span
                  className="absolute text-[13px] font-normal text-[#1D1F24]"
                  style={{ left: 44 - 12, top: 55 - 46, fontFamily: "Inter, sans-serif" }}
                >
                  Duplicate view
                </span>
              </button>

              {/* Delete view — disabled & 50% opacity when only 1 view */}
              <button
                type="button"
                className={clsx(
                  "group/del absolute border-none bg-transparent p-0 outline-none",
                  canDelete ? "cursor-pointer" : "cursor-default"
                )}
                style={{ left: 12, top: 80, width: 328, height: 35 }}
                onClick={canDelete ? handleDeleteView : undefined}
              >
                {canDelete && (
                  <span
                    className="absolute rounded-[4px] transition-colors group-hover/del:bg-[#F2F2F2]"
                    style={{ left: 0, top: 0, width: 328, height: 35, pointerEvents: "none" }}
                  />
                )}
                <DeleteIcon
                  className={clsx("absolute", canDelete && "group-hover/del:[mix-blend-mode:multiply]")}
                  style={{ left: 21 - 12, top: 88 - 80 + 2, width: 14, height: 16, opacity: canDelete ? 1 : 0.5 }}
                />
                <span
                  className="absolute text-[13px] font-normal"
                  style={{ left: 44 - 12, top: 89 - 80, fontFamily: "Inter, sans-serif", color: "#B01041", opacity: canDelete ? 1 : 0.5 }}
                >
                  Delete view
                </span>
              </button>
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={handleAddBulkRows}
          disabled={bulkRowsDisabled}
          style={{ left: editMode !== null ? 50 + 189 + 10 : addButtonLeft }}
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
            {(
              <div className="absolute top-0" style={{ left: 70 - hideFieldsExpansion - filterExpansion - sortExpansion, transition: "left 0.2s ease" }}>
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
                  transition: "width 0.2s ease",
                  ["--hover-left" as string]: "-4px",
                  ["--hover-right" as string]: hiddenFieldCount > 0 ? "10px" : "-8px",
                } as React.CSSProperties}
                onClick={() => setIsHideFieldsMenuOpen((prev) => !prev)}
                aria-haspopup="menu"
                aria-expanded={isHideFieldsMenuOpen}
              >
                <HideFieldsActiveIcon
                  className="absolute"
                  style={{ left: 4, top: 4, width: 18, height: 16, opacity: hiddenFieldCount > 0 ? 1 : 0, transition: "opacity 0.2s ease" }}
                />
                <HideFieldsIcon
                  className="absolute left-[4px] top-[5px] h-[16px] w-[19px]"
                  style={{ opacity: hiddenFieldCount > 0 ? 0 : 1, transition: "opacity 0.2s ease" }}
                />
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
                              style={{ transition: "fill 0.15s ease" }}
                            />
                            <rect
                              x={0}
                              y={2}
                              width={4}
                              height={4}
                              rx={2}
                              fill="#FFFFFF"
                              style={{
                                transform: `translateX(${isHidden ? 2 : 7}px)`,
                                transition: "transform 0.15s ease",
                              }}
                            />
                          </svg>
                          <row.iconSpec.Icon
                            className="airtable-hide-fields-icon absolute"
                            style={{
                              left: row.iconLeftOffset,
                              top: row.iconTopOffset,
                              width: row.iconSpec.width,
                              height: row.iconSpec.height,
                            }}
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
                          <ThreeDotIcon
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
            )}

            {/* ---- Filter ---- */}
            {(
              <div className="absolute top-0" style={{ left: filterButtonLeft, transition: "left 0.2s ease" }}>
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
                  transition: "width 0.2s ease",
                  ["--hover-left" as string]: "-4px",
                  ["--hover-right" as string]: hasActiveFilters ? "10px" : "-4px",
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
                <FilterActiveIcon
                  className="absolute"
                  style={{ left: FILTER_ICON_LEFT, top: 7, width: 13.5, height: 9, opacity: hasActiveFilters ? 1 : 0, transition: "opacity 0.2s ease" }}
                />
                <FilterIcon
                  className="absolute top-[6px] h-[12px] w-[18px]"
                  style={{ left: `${FILTER_ICON_LEFT}px`, opacity: hasActiveFilters ? 0 : 1, transition: "opacity 0.2s ease" }}
                />
                <span
                  ref={filterTextRef}
                  className="absolute top-[5px] block h-[16px] text-[13px] leading-[16px]"
                  style={
                    hasActiveFilters
                      ? { left: FILTER_TEXT_LEFT_ACTIVE, whiteSpace: "nowrap" }
                      : { left: FILTER_TEXT_LEFT, width: "60px" }
                  }
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
            )}

            {/* ---- Group ---- */}
            {(
              <button
                type="button"
                className="absolute top-[10px] h-[26px] w-[60px] text-left"
                style={{ left: 256 - sortExpansion, transition: "left 0.2s ease" }}
              >
                <GroupIcon className="absolute left-0 top-[6px] h-[14px] w-[16px]" />
                <span className="absolute left-[20px] top-[5px] block h-[16px] w-[40px] text-[13px] leading-[16px]">
                  Group
                </span>
              </button>
            )}

            {/* ---- Sort ---- */}
            {(
              <div className="absolute top-0" style={{ left: 338 - sortExpansion, transition: "left 0.2s ease" }}>
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
                                        <iconSpec.Icon
                                          className="airtable-sort-add-menu-icon absolute top-1/2 -translate-y-1/2"
                                          style={{
                                            left: iconSpec.left,
                                            width: iconSpec.width,
                                            height: iconSpec.height,
                                          }}
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
                            <ToggleIcon
                              className="h-[16px] w-[22px]"
                            />
                            <span className="text-[13px] font-normal text-[#1d1f24]">
                              Automatically sort records
                            </span>
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <BlueSearchIcon
                          className="absolute left-[21px] top-[58px] h-[16px] w-[16px]"
                        />
                        <div className="absolute left-[48px] top-[57px] text-[13px] font-normal text-[#989AA1]">
                          Find a field
                        </div>
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
            )}

            {/* ---- Color ---- */}
            {(
              <button
                type="button"
                className="absolute top-[10px] h-[26px] w-[68px] text-left"
                style={{ left: 410 }}
              >
                <ColourIcon
                  className="absolute left-0 top-[3px] h-[19px] w-[20px]"
                />
                <span className="absolute left-[20px] top-[5px] block h-[16px] w-[48px] text-[13px] leading-[16px]">
                  Color
                </span>
              </button>
            )}

            {/* ---- Row height ---- */}
            {(
              <button
                type="button"
                className="absolute top-0 h-full w-[19px]"
                style={{ left: 485 }}
                aria-label="Row height"
              >
                <RowHeightIcon
                  className="absolute left-0 top-[16px] h-[15px] w-[19px]"
                />
              </button>
            )}

            {/* ---- Share and sync ---- */}
            {(
              <button
                type="button"
                className="absolute top-[10px] h-[26px] w-[114px] text-left"
                style={{ left: 528 }}
              >
                <ShareSyncIcon
                  className="absolute left-0 top-[6px] h-[15px] w-[15px]"
                />
                <span className="absolute left-[19px] top-[5px] block h-[16px] w-[95px] whitespace-nowrap text-[13px] leading-[16px]">
                  Share and sync
                </span>
              </button>
            )}
          </div>

          {/* ---- Search button ---- */}
          {(
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
          )}
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
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeDasharray="0.6 0.4"
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
              <XIcon
                className="block h-[10px] w-[10px] text-[#1D1F24]"
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
