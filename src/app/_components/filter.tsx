"use client";

import React from "react";
import clsx from "clsx";
import { useId } from "react";
import type {
  Dispatch,
  SetStateAction,
  RefObject,
  MouseEvent as ReactMouseEvent,
} from "react";
import { useLayoutEffect, useRef, useState } from "react";

import arrowIcon from "~/assets/arrow.svg";
import assigneeIcon from "~/assets/assignee.svg";
import attachmentsIcon from "~/assets/attachments.svg";
import deleteIcon from "~/assets/delete.svg";
import lightArrowIcon from "~/assets/light-arrow.svg";
import nameIcon from "~/assets/name.svg";
import notesIcon from "~/assets/notes.svg";
import numberIcon from "~/assets/number.svg";
import pinkIcon from "~/assets/pink.svg";
import plusIcon from "~/assets/plus.svg";
import reorderIcon from "~/assets/reorder.svg";
import statusIcon from "~/assets/status.svg";

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

// ---------------------------------------------------------------------------
// Filter constants & helpers
// ---------------------------------------------------------------------------

const STATUS_ICON_SCALE = 1.1;
const STATUS_MENU_ICON_SIZE = 15 * STATUS_ICON_SCALE;

const FILTER_CONNECTORS: FilterConnector[] = ["and", "or"];

const FILTER_TEXT_OPERATORS: FilterOperator[] = [
  "contains",
  "does_not_contain",
  "is",
  "is_not",
  "is_empty",
  "is_not_empty",
];

const FILTER_NUMBER_OPERATORS: FilterOperator[] = [
  "eq",
  "neq",
  "lt",
  "gt",
  "lte",
  "gte",
  "is_empty",
  "is_not_empty",
];

const FILTER_OPERATOR_LABELS: Record<FilterOperator, string> = {
  contains: "contains...",
  does_not_contain: "does not contain...",
  is: "is...",
  is_not: "is not...",
  is_empty: "is empty",
  is_not_empty: "is not empty",
  eq: "=",
  neq: "≠",
  lt: "<",
  gt: ">",
  lte: "≤",
  gte: "≥",
};

const FILTER_OPERATOR_REQUIRES_VALUE = new Set<FilterOperator>([
  "contains",
  "does_not_contain",
  "is",
  "is_not",
  "eq",
  "neq",
  "lt",
  "gt",
  "lte",
  "gte",
]);

const getDefaultFilterOperator = (columnType: ColumnFieldType) =>
  columnType === "number" ? "eq" : "contains";

const getFilterOperatorsForType = (columnType: ColumnFieldType) =>
  columnType === "number" ? FILTER_NUMBER_OPERATORS : FILTER_TEXT_OPERATORS;

const formatFilterOperatorLabel = (label: string) =>
  label.length > 12 ? `${label.slice(0, 11)}...` : label;

const createFilterCondition = (
  columnId: string | null = null,
  columnType: ColumnFieldType = "single_line_text",
): FilterConditionItem => ({
  id: crypto.randomUUID(),
  type: "condition",
  columnId,
  operator: getDefaultFilterOperator(columnType),
  value: "",
});

const createFilterGroup = (): FilterGroupItem => ({
  id: crypto.randomUUID(),
  type: "group",
  connector: "and",
  conditions: [],  // Empty - shows placeholder text
});

// ---------------------------------------------------------------------------
// Column‑icon helpers (needed by the filter field menu)
// ---------------------------------------------------------------------------

const coerceColumnType = (value?: string | null): ColumnFieldType =>
  value === "long_text" || value === "number" ? value : "single_line_text";

const sortAddMenuIconSpecByName: Record<
  string,
  { src: string; width: number; height: number; left: number }
> = {
  Assignee: { src: assigneeIcon.src, width: 15, height: 16, left: 10 },
  Status: {
    src: statusIcon.src,
    width: STATUS_MENU_ICON_SIZE,
    height: STATUS_MENU_ICON_SIZE,
    left: 10,
  },
  Attachments: { src: attachmentsIcon.src, width: 14, height: 16, left: 11 },
  Name: { src: nameIcon.src, width: 12.01, height: 12, left: 12 },
  Notes: { src: notesIcon.src, width: 15.5, height: 13.9, left: 11 },
  Number: { src: numberIcon.src, width: 13, height: 13, left: 12.5 },
};

const sortAddMenuIconSpecByType: Record<
  ColumnFieldType,
  { src: string; width: number; height: number; left: number }
> = {
  single_line_text: { src: nameIcon.src, width: 12.01, height: 12, left: 12 },
  long_text: { src: notesIcon.src, width: 15.5, height: 13.9, left: 11 },
  number: { src: numberIcon.src, width: 13, height: 13, left: 12.5 },
};

const getSortAddMenuIconSpec = (name: string, type?: string | null) => {
  const resolvedType = coerceColumnType(type);
  return (
    sortAddMenuIconSpecByName[name] ?? sortAddMenuIconSpecByType[resolvedType]
  );
};

// ---------------------------------------------------------------------------
// Layout types produced by the parent's filterLayout computation
// ---------------------------------------------------------------------------

type FilterLayoutRow = {
  type: "row";
  condition: FilterConditionItem;
  depth: number;  // 0, 1, or 2
  parentGroupId?: string;
  grandparentGroupId?: string;
  top: number;
  left: number;
  scope: "root" | "group";
  groupId?: string;
  indexInScope: number;
  showConnector: boolean;
  showConnectorControl: boolean;
  connector: FilterConnector;
  connectorKey: string;
  showRootConnector: boolean;
  showGroupConnector: boolean;
};

type FilterLayoutGroup = {
  type: "group";
  group: FilterGroupItem;
  isEmpty: boolean;
  depth: number;  // 0 or 1
  parentGroupId?: string;
  top: number;
  left: number;
  width: number;
  height: number;
  showConnector: boolean;
  showConnectorControl: boolean;
  connectorKey: string;
  connector: FilterConnector;
  firstChildHasRootConnector: boolean;
};

type FilterLayoutEntry = FilterLayoutRow | FilterLayoutGroup;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type FilterDropdownProps = {
  // Refs
  filterMenuRef: RefObject<HTMLDivElement | null>;
  filterFieldMenuListRef: RefObject<HTMLDivElement | null>;
  filterOperatorMenuListRef: RefObject<HTMLDivElement | null>;

  // Filter state
  filterItems: FilterItem[];
  setFilterItems: Dispatch<SetStateAction<FilterItem[]>>;
  filterConnector: FilterConnector;
  setFilterConnector: Dispatch<SetStateAction<FilterConnector>>;

  // Open‑menu state
  openFilterFieldId: string | null;
  setOpenFilterFieldId: Dispatch<SetStateAction<string | null>>;
  openFilterOperatorId: string | null;
  setOpenFilterOperatorId: Dispatch<SetStateAction<string | null>>;
  openFilterConnectorId: string | null;
  setOpenFilterConnectorId: Dispatch<SetStateAction<string | null>>;

  // Focus / error state
  focusedFilterValueId: string | null;
  setFocusedFilterValueId: Dispatch<SetStateAction<string | null>>;
  filterValueErrorId: string | null;
  setFilterValueErrorId: Dispatch<SetStateAction<string | null>>;

  // Drag state
  draggingFilterId: string | null;
  draggingFilterTop: number | null;
  phantomFilterX: number | null;
  phantomFilterY: number | null;

  // Highlight state
  highlightedFilterFieldId: string | null;
  highlightedFilterOperatorId: string | null;
  highlightedFilterConnectorKey: string | null;
  setHighlightedFilterConnectorKey: Dispatch<SetStateAction<string | null>>;
  setHighlightedFilterFieldId: Dispatch<SetStateAction<string | null>>;
  setHighlightedFilterOperatorId: Dispatch<SetStateAction<string | null>>;

  // Active‑add highlight
  activeFilterAdd: "condition" | "group" | null;

  // Handlers
  handleFilterFieldSelect: (
    conditionId: string,
    columnId: string,
    groupId?: string,
    parentGroupId?: string,
  ) => void;
  handleFilterOperatorSelect: (
    conditionId: string,
    operator: FilterOperator,
    groupId?: string,
    parentGroupId?: string,
  ) => void;
  handleFilterValueChange: (
    conditionId: string,
    value: string,
    groupId?: string,
    parentGroupId?: string,
  ) => void;
  handleFilterDragStart: (
    event: ReactMouseEvent,
    conditionId: string,
    scope: "root" | "group",
    groupId?: string,
  ) => void;
  addFilterCondition: () => void;
  addFilterGroup: () => void;
  addFilterConditionToGroup: (groupId: string, parentGroupId?: string) => void;
  addFilterGroupToGroup: (parentGroupId: string, grandparentGroupId?: string) => void;
  deleteFilterGroup: (groupId: string, parentGroupId?: string) => void;
  setGroupConnector: (groupId: string, connector: FilterConnector, parentGroupId?: string) => void;

  // Group state
  openGroupPlusId: string | null;
  setOpenGroupPlusId: Dispatch<SetStateAction<string | null>>;
  draggingGroupId: string | null;

  // Group layout constants
  filterGroupEmptyWidth: number;
  filterGroupEmptyHeight: number;
  filterGroupPaddingTop: number;
  filterGroupPaddingBottom: number;
  filterGroupPaddingLeft: number;
  filterGroupWhereLeft: number;

  // Column data
  orderedColumns: { id: string; name: string; type: string | null }[];
  columnById: Map<string, { id: string; name: string; type: string | null }>;

  // Computed values
  hasFilterItems: boolean;
  filterLayout: { entries: FilterLayoutEntry[] };
  filterFooterTop: number;

  // Layout constants
  filterDropdownWidth: number;
  filterDropdownHeight: number;
  filterDropdownHeaderLeft: number;
  filterDropdownHeaderTop: number;
  filterInputLeft: number;
  filterInputTop: number;
  filterInputWidth: number;
  filterInputHeight: number;
  filterInputRadius: number;
  filterEmptyMessageTop: number;
  filterExpandedMessageTop: number;
  filterRowLeft: number;
  filterWhereTop: number;
  filterConnectorWidth: number;
  filterConnectorHeight: number;
  filterConnectorGap: number;
  filterFieldLeft: number;
  filterFieldWidth: number;
  filterFieldHeight: number;
  filterRowHeight: number;
  filterFieldSeparatorPositions: readonly number[];
  filterFieldSeparatorFieldLeft: number;
  filterFieldSeparatorOperatorLeft: number;
  filterFieldSeparatorValueLeft: number;
  filterFieldSeparatorActionsLeft: number;
  filterFieldMenuWidth: number;
  filterFieldMenuHeight: number;
  filterFieldMenuHeaderLeft: number;
  filterFieldMenuTopPadding: number;
  filterFieldMenuHeaderHeight: number;
  filterFieldMenuFirstRowTop: number;
  filterFieldMenuHoverPadding: number;
  filterFieldMenuListHeight: number;
  filterFieldMenuContentHeight: number;
  filterFieldMenuRowHeight: number;
  filterFieldMenuTextHeight: number;
  filterFieldMenuItemWidth: number;
  filterFieldMenuItemLeft: number;
  filterFieldMenuLabelLeft: number;
  filterOperatorMenuWidth: number;
  filterOperatorMenuMaxHeight: number;
  filterOperatorMenuFirstRowTop: number;
  filterOperatorMenuBottomPadding: number;
  filterOperatorMenuRowStride: number;
  filterOperatorMenuRowHeight: number;
  filterOperatorMenuItemWidth: number;
  filterOperatorMenuItemLeft: number;
  filterOperatorMenuHoverPadding: number;

  // Virtualizer results
  filterFieldVirtualItems: { index: number; start: number }[];
  filterFieldVirtualizerSize: number;
};

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

function removeConditionFromGroupTree(
  items: FilterItem[],
  targetGroupId: string,
  conditionId: string
): FilterItem[] {
  return items.flatMap((item): FilterItem[] => {
    if (item.type === "condition") return [item];

    if (item.id === targetGroupId) {
      const next = item.conditions.filter(c => c.id !== conditionId);
      if (next.length === 0) return [];
      return [{ ...item, conditions: next }];
    }

    return [{
      ...item,
      conditions: removeConditionFromGroupTree(
        item.conditions,
        targetGroupId,
        conditionId
      )
    }];
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FilterDropdown({
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
  orderedColumns,
  columnById,
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
}: FilterDropdownProps) {
  const fieldArrowMaskId = useId();
  const operatorArrowMaskId = useId();
  const prevTopsRef = useRef(new Map<string, number>());
  const [flipDeltas, setFlipDeltas] = useState<Record<string, number>>({});
  const groupPlusDropdownRef = useRef<HTMLDivElement>(null);
  const groupPlusButtonRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const nextTops = new Map<string, number>();

    // Collect current tops for all entries
    for (const entry of filterLayout.entries) {
      const key = entry.type === "row" ? entry.condition.id : entry.group.id;
      nextTops.set(key, entry.top);
    }

    const prevTops = prevTopsRef.current;
    const deltas: Record<string, number> = {};

    for (const [key, nextTop] of nextTops) {
      const prevTop = prevTops.get(key);
      if (prevTop === undefined) continue; // new item, don't animate from nowhere
      const delta = prevTop - nextTop;
      if (delta !== 0) deltas[key] = delta;
    }

    // Store deltas so render applies transform immediately
    setFlipDeltas(deltas);

    // Next frame: animate transform back to 0
    requestAnimationFrame(() => {
      setFlipDeltas({});
    });

    // Update prev tops for next change
    prevTopsRef.current = nextTops;
  }, [filterLayout.entries]);

  // Click-outside detection for group plus dropdown
  useLayoutEffect(() => {
    if (!openGroupPlusId) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;

      // Check if click is inside the dropdown
      if (groupPlusDropdownRef.current?.contains(target)) {
        return;
      }

      // Check if click is on any plus button (to avoid interfering with toggle behavior)
      const plusButton = (event.target as HTMLElement).closest('.airtable-filter-group-action');
      if (plusButton) {
        return;
      }

      // Click is outside - close the dropdown
      setOpenGroupPlusId(null);
    };

    // Add listener with a small delay to avoid closing immediately after opening
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [openGroupPlusId, setOpenGroupPlusId]);

  return (
    <div
      ref={filterMenuRef}
      className="airtable-filter-dropdown airtable-dropdown-surface absolute right-[-8px] top-[40px] z-[120]"
      style={{
        width: filterDropdownWidth,
        height: filterDropdownHeight,
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="relative h-full w-full">
        <div
          className="absolute flex items-center gap-[3px] airtable-secondary-font"
          style={{
            left: filterDropdownHeaderLeft,
            top: filterDropdownHeaderTop,
          }}
        >
          <span>Filter</span>
        </div>
        <div
          className="absolute flex items-center border border-[#F2F2F2] bg-white text-[13px] font-normal text-[#757575]"
          style={{
            left: filterInputLeft,
            top: filterInputTop,
            width: filterInputWidth,
            height: filterInputHeight,
            borderRadius: filterInputRadius,
            paddingLeft: 7.5,
            gap: 7,
          }}
        >
          <img
            alt=""
            className="h-[21px] w-[21px]"
            src={pinkIcon.src}
          />
          <span>Describe what you want to see</span>
        </div>
        {!hasFilterItems ? (
          <>
            <div
              className="absolute flex items-center text-[13px] font-normal text-[#8E8F92]"
              style={{ left: 16, top: filterEmptyMessageTop }}
            >
              <span>No filter conditions are applied</span>
              <span
                className="airtable-help-icon ml-[6px] text-[#8E8F92]"
                style={{ width: 14, height: 14 }}
                aria-hidden="true"
              />
            </div>
          </>
        ) : (
          <>
            <div
              className="absolute text-[13px] font-normal text-[#616670]"
              style={{ left: 16, top: filterExpandedMessageTop }}
            >
              In this view, show records
            </div>
            <div
              className="absolute text-[13px] font-normal text-[#1D1F24]"
              style={{
                left: filterRowLeft,
                top: filterWhereTop,
                width: filterConnectorWidth,
                textAlign: "center",
              }}
            >
              Where
            </div>
            {filterLayout.entries.map((entry) => {
              if (entry.type === "group") {
                const group = entry;
                const isGroupDragging = draggingGroupId === group.group.id;
                const showConnectorControl = group.showConnectorControl;
                const connectorLabel = group.connector;
                const isConnectorOpen = openFilterConnectorId === group.connectorKey;
                const isGroupPlusOpen = openGroupPlusId === group.group.id;
                const isConnectorHighlighted = highlightedFilterConnectorKey === group.connectorKey;
                // Boost z-index if this group is inside another group that has its plus dropdown open
                const isInsideGroupWithOpenDropdown =
                  openGroupPlusId && group.parentGroupId === openGroupPlusId;
                const groupKey = group.group.id;
                const groupDelta = flipDeltas[groupKey] ?? 0;
                const GROUP_MENU_Z = 20000; // higher than any row/menu you have
                const GROUP_BASE_Z = 10 + group.depth * 10;

                return (
                  <React.Fragment key={group.group.id}>
                    {/* Connector for groups */}
                    {group.showConnector && !isGroupDragging && (
                      <div
                        className="absolute"
                        style={{
                          left: group.left - filterConnectorWidth - filterConnectorGap,
                          top: group.top,
                          width: filterConnectorWidth,
                          height: filterConnectorHeight,
                          zIndex: isConnectorOpen ? 60000 : 10 + group.depth * 10,
                        }}
                      >
                        {showConnectorControl ? (
                          <button
                            type="button"
                            className="absolute flex items-center rounded-[2px] border border-[#E4E4E4] text-[13px] font-normal cursor-pointer"
                            style={{
                              width: filterConnectorWidth,
                              height: filterConnectorHeight,
                              left: 0,
                              top: 0,
                              paddingLeft: 8,
                              background: "#ffffff",
                              transition: "background 0.15s ease",
                              color: isConnectorHighlighted ? "#156FE2" : "#1D1F24",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = "#F2F2F2";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = "#ffffff";
                            }}
                            onClick={() =>
                              setOpenFilterConnectorId((prev) =>
                                prev === group.connectorKey ? null : group.connectorKey
                              )
                            }
                            data-filter-connector-trigger={group.connectorKey}
                          >
                            <span>{connectorLabel}</span>
                            {isConnectorHighlighted ? (
                              <svg
                                width={10}
                                height={6}
                                viewBox="0 0 50.25 30.000001"
                                className="absolute"
                                style={{
                                  right: 7,
                                  top: "50%",
                                  transform: "translateY(-50%)",
                                }}
                                aria-hidden="true"
                              >
                                <defs>
                                  <filter id={`connector-arrow-${group.connectorKey}-invert`}>
                                    <feColorMatrix
                                      type="matrix"
                                      values="-1 0 0 0 1  0 -1 0 0 1  0 0 -1 0 1  0 0 0 1 0"
                                    />
                                  </filter>
                                  <mask id={`connector-arrow-${group.connectorKey}-mask`}>
                                    <image
                                      href={arrowIcon.src}
                                      width="50.25"
                                      height="30.000001"
                                      filter={`url(#connector-arrow-${group.connectorKey}-invert)`}
                                    />
                                  </mask>
                                </defs>
                                <rect
                                  width="50.25"
                                  height="30.000001"
                                  fill="#156FE2"
                                  mask={`url(#connector-arrow-${group.connectorKey}-mask)`}
                                />
                              </svg>
                            ) : (
                              <img
                                alt=""
                                className="absolute"
                                style={{
                                  width: 10,
                                  height: 6,
                                  right: 7,
                                }}
                                src={arrowIcon.src}
                              />
                            )}
                          </button>
                        ) : (
                          <span
                            className="absolute text-[13px] font-normal text-[#1D1F24]"
                            style={{ left: 8, top: 8 }}
                          >
                            {connectorLabel}
                          </span>
                        )}
                        {showConnectorControl && isConnectorOpen && (
                          <div
                            className="airtable-dropdown-surface absolute z-20"
                            data-filter-connector-menu={group.connectorKey}
                            style={{
                              width: filterConnectorWidth,
                              height: 72,
                              left: 0,
                              top: filterConnectorHeight,
                              borderRadius: 2,
                              background: "#ffffff",
                              zIndex: 50000,
                            }}
                          >
                            {FILTER_CONNECTORS.map((connector, index) => (
                              <button
                                key={connector}
                                type="button"
                                className="absolute text-[13px] font-normal text-[#1D1F24] cursor-pointer"
                                style={{
                                  left: 6,
                                  top: index === 0 ? 10 : 46,
                                }}
                                onClick={() => {
                                  setGroupConnector(group.group.id, connector, group.parentGroupId);
                                  setOpenFilterConnectorId(null);
                                }}
                              >
                                {connector}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <div
                      className="absolute"
                      style={{
                        left: group.left,
                        top: group.top,
                        width: group.width,
                        height: isGroupDragging && group.height > filterGroupEmptyHeight ? filterGroupEmptyHeight : group.height,
                        borderRadius: 3,
                        border: "1px solid #E4E4E4",
                        background: "#F7F8FC",
                        transition: groupDelta ? "none" : "height 0.15s ease, width 0.15s ease, transform 150ms ease",
                        transform: groupDelta ? `translateY(${groupDelta}px)` : "translateY(0px)",
                        willChange: "transform",
                        overflow: isGroupDragging ? "hidden" : "visible",
                        zIndex: isGroupPlusOpen
                        ? GROUP_MENU_Z
                        : GROUP_BASE_Z,
                      }}
                    >
                    {group.isEmpty && (
                      <>
                        {/* Placeholder text */}
                        <span
                          className="absolute text-[13px] font-normal text-[#616670]"
                          style={{ left: 17, top: 8 }}
                        >
                          Drag conditions here to add them to this group
                        </span>
                      </>
                    )}

                    {!group.isEmpty && (
                      <>
                        {/* Header text */}
                        <span
                          className="absolute text-[13px] font-normal text-[#616670]"
                          style={{ left: 17, top: 12 }}
                        >
                          {group.group.connector === "and"
                            ? "All of the following are true..."
                            : "Any of the following are true..."}
                        </span>
                        {/* Where label - stays at x=17, condition fields shift left by 6px */}
                        <span
                          className="absolute text-[13px] font-normal text-[#1D1F24]"
                          style={{
                            left: 17,
                            top: 47,
                            width: filterConnectorWidth,
                            textAlign: "left",
                          }}
                        >
                          Where
                        </span>
                      </>
                    )}

                    {/* Action buttons - always visible for all groups */}
                    {/* Plus button - positioned relative to right edge */}
                    <button
                      type="button"
                      className="airtable-filter-group-action absolute"
                      style={{
                        left: group.width - 105,
                        top: 3,
                        width: 32,
                        height: 32,
                      }}
                      onClick={() =>
                        setOpenGroupPlusId((prev) =>
                          prev === group.group.id ? null : group.group.id
                        )
                      }
                      aria-label="Add to group"
                    >
                      <img
                        alt=""
                        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                        style={{ width: 12, height: 12 }}
                        src={plusIcon.src}
                      />
                    </button>

                    {/* Delete button - positioned relative to right edge */}
                    <button
                      type="button"
                      className="airtable-filter-group-action absolute"
                      style={{
                        left: group.width - 73,
                        top: 3,
                        width: 32,
                        height: 32,
                      }}
                      onClick={() => deleteFilterGroup(group.group.id, group.parentGroupId)}
                      aria-label="Delete group"
                    >
                      <img
                        alt=""
                        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                        style={{ width: 14, height: 16 }}
                        src={deleteIcon.src}
                      />
                    </button>

                    {/* Reorder button - positioned relative to right edge */}
                    <button
                      type="button"
                      className="airtable-filter-group-action absolute cursor-grab"
                      style={{
                        left: group.width - 41,
                        top: 4,
                        width: 32,
                        height: 32,
                      }}
                      aria-label="Reorder group"
                    >
                      <img
                        alt=""
                        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                        style={{ width: 10.23, height: 13.3 }}
                        src={reorderIcon.src}
                      />
                    </button>
                  </div>

                  {/* Plus dropdown - rendered as sibling to group box for independent z-index */}
                  {openGroupPlusId === group.group.id && (
                    <div
                      ref={groupPlusDropdownRef}
                      className="airtable-dropdown-surface absolute"
                      style={{
                        left: group.left + group.width - 105,
                        top: group.top + 3 + 32 + 8,
                        width: 174,
                        height: 92,
                        borderRadius: 3,
                        zIndex: 50000,
                      }}
                    >
                      <button
                        type="button"
                        className="absolute text-[13px] font-normal text-[#1D1F24] cursor-pointer"
                        style={{
                          left: 12,
                          top: 12,
                          width: 150,
                          height: 35,
                          borderRadius: 3,
                          background: "transparent",
                          border: "none",
                          textAlign: "left",
                          paddingLeft: 8,
                          transition: "background 0.15s ease",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "#F2F2F2";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                        }}
                        onClick={() => {
                          addFilterConditionToGroup(group.group.id, group.parentGroupId);
                        }}
                      >
                        Add condition
                      </button>
                      <button
                        type="button"
                        className="absolute text-[13px] font-normal cursor-pointer"
                        style={{
                          left: 12,
                          top: 46,
                          width: 150,
                          height: 35,
                          borderRadius: 3,
                          background: "transparent",
                          border: "none",
                          textAlign: "left",
                          paddingLeft: 8,
                          transition: "background 0.15s ease",
                          color: group.depth === 1 ? "#8E8F92" : "#1D1F24",
                          cursor: group.depth === 1 ? "not-allowed" : "pointer",
                        }}
                        onMouseEnter={(e) => {
                          if (group.depth !== 1) {
                            e.currentTarget.style.background = "#F2F2F2";
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                        }}
                        onClick={() => {
                          if (group.depth !== 1) {
                            addFilterGroupToGroup(group.group.id, group.parentGroupId);
                          }
                        }}
                        disabled={group.depth === 1}
                      >
                        Add condition group
                      </button>
                    </div>
                  )}
                  </React.Fragment>
                );
              }

              const row = entry;
              const columnId = row.condition.columnId;
              const column = columnId ? columnById.get(columnId) : null;
              const columnType = coerceColumnType(column?.type);
              const operatorLabel = formatFilterOperatorLabel(
                FILTER_OPERATOR_LABELS[row.condition.operator]
              );
              const operatorOptions = getFilterOperatorsForType(columnType);
              const operatorListHeight =
                operatorOptions.length > 0
                  ? (operatorOptions.length - 1) *
                      filterOperatorMenuRowStride +
                    filterOperatorMenuRowHeight
                  : 0;
              const operatorMenuContentHeight =
                filterOperatorMenuFirstRowTop +
                operatorListHeight +
                filterOperatorMenuBottomPadding;
              const operatorMenuHeight = Math.min(
                filterOperatorMenuMaxHeight,
                operatorMenuContentHeight
              );
              const operatorMenuListHeight = Math.max(
                0,
                operatorMenuHeight -
                  filterOperatorMenuFirstRowTop -
                  filterOperatorMenuBottomPadding
              );
              const isFieldMenuOpen = openFilterFieldId === row.condition.id;
              const isOperatorMenuOpen =
                openFilterOperatorId === row.condition.id;
              const isFieldHighlighted = highlightedFilterFieldId === row.condition.id;
              const isOperatorHighlighted = highlightedFilterOperatorId === row.condition.id;
              const isNumber = columnType === "number";
              const operatorRequiresValue = FILTER_OPERATOR_REQUIRES_VALUE.has(row.condition.operator);
              const isFocused = focusedFilterValueId === row.condition.id;
              const hasError = filterValueErrorId === row.condition.id;
              const connectorLabel = row.connector;
              const showConnectorControl = row.showConnectorControl;
              const connectorKey = row.connectorKey;
              const isConnectorOpen = openFilterConnectorId === connectorKey;
              const isConnectorHighlighted = highlightedFilterConnectorKey === connectorKey;
              const fieldValue = row.condition.value;
              const scopeGroupId = row.scope === "group" ? row.parentGroupId : undefined;
              const scopeParentGroupId = row.scope === "group" ? row.grandparentGroupId : undefined;
              const isDraggingRow = draggingFilterId === row.condition.id;
              const dragOffset =
                isDraggingRow && draggingFilterTop !== null
                  ? draggingFilterTop - row.top
                  : 0;
              const fieldTop =
                (filterRowHeight - filterFieldHeight) / 2 + dragOffset;
              const fieldMenuTop = fieldTop + filterFieldHeight + 2;
              const operatorMenuTop = fieldMenuTop;
              const baseRowZIndex = isOperatorMenuOpen
                ? 60000
                : isDraggingRow
                ? 30
                : isFieldMenuOpen || isConnectorOpen
                ? 60000
                : 10;
              // Boost z-index if this row is inside a group that has its plus dropdown open
              const isInsideGroupWithOpenDropdown =
                openGroupPlusId &&
                (row.parentGroupId === openGroupPlusId || row.grandparentGroupId === openGroupPlusId);
              const rowZIndex = isInsideGroupWithOpenDropdown
                ? baseRowZIndex + row.depth * 10 + 20000
                : baseRowZIndex + row.depth * 10;
              const hideConnectorControl =
                showConnectorControl && isDraggingRow;
              const rowKey = row.condition.id;
              const flipDelta = flipDeltas[rowKey] ?? 0;

              return (
                <div
                  key={row.condition.id}
                  className="absolute"
                  style={{
                    left: row.left,
                    top: row.top,
                    width: filterFieldLeft + filterFieldWidth,
                    height: filterRowHeight,
                    zIndex: rowZIndex,
                    transform: flipDelta ? `translateY(${flipDelta}px)` : "translateY(0px)",
                    transition: flipDelta ? "none" : "transform 150ms ease",
                    willChange: "transform",
                    overflow: "visible",
                  }}
                >
                {row.showConnector && !hideConnectorControl && (
                  <>
                    {showConnectorControl ? (
                      <button
                        type="button"
                        className="absolute flex items-center rounded-[2px] border border-[#E4E4E4] text-[13px] font-normal cursor-pointer"
                        style={{
                          width: filterConnectorWidth,
                          height: filterConnectorHeight,
                          left: 0,
                          top: 0,
                          paddingLeft: 8,
                          background: row.scope === "group" ? "#ffffff" : undefined,
                          transition: "background 0.15s ease",
                          color: isConnectorHighlighted ? "#156FE2" : "#1D1F24",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "#F2F2F2";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = row.scope === "group" ? "#ffffff" : "transparent";
                        }}
                        onClick={() =>
                          setOpenFilterConnectorId((prev) =>
                            prev === connectorKey ? null : connectorKey
                          )
                        }
                        data-filter-connector-trigger={connectorKey}
                      >
                        <span>{connectorLabel}</span>
                        {isConnectorHighlighted ? (
                          <svg
                            width={10}
                            height={6}
                            viewBox="0 0 50.25 30.000001"
                            className="absolute"
                            style={{
                              right: 7,
                              top: "50%",
                              transform: "translateY(-50%)",
                            }}
                            aria-hidden="true"
                          >
                            <defs>
                              <filter id={`connector-arrow-${connectorKey}-invert`}>
                                <feColorMatrix
                                  type="matrix"
                                  values="-1 0 0 0 1  0 -1 0 0 1  0 0 -1 0 1  0 0 0 1 0"
                                />
                              </filter>
                              <mask id={`connector-arrow-${connectorKey}-mask`}>
                                <image
                                  href={arrowIcon.src}
                                  width="50.25"
                                  height="30.000001"
                                  filter={`url(#connector-arrow-${connectorKey}-invert)`}
                                />
                              </mask>
                            </defs>
                            <rect
                              width="50.25"
                              height="30.000001"
                              fill="#156FE2"
                              mask={`url(#connector-arrow-${connectorKey}-mask)`}
                            />
                          </svg>
                        ) : (
                          <img
                            alt=""
                            className="absolute"
                            style={{
                              width: 10,
                              height: 6,
                              right: 7,
                            }}
                            src={arrowIcon.src}
                          />
                        )}
                      </button>
                    ) : (
                      <span
                        className="absolute text-[13px] font-normal text-[#1D1F24]"
                        style={{ left: 8, top: 8 }}
                      >
                        {connectorLabel}
                      </span>
                    )}
                    {showConnectorControl && isConnectorOpen && (
                      <div
                        className="airtable-dropdown-surface absolute z-20"
                        data-filter-connector-menu={connectorKey}
                        style={{
                          width: filterConnectorWidth,
                          height: 72,
                          left: 0,
                          top: filterConnectorHeight,
                          borderRadius: 2,
                          background: "#ffffff",
                          zIndex: 50000,
                        }}
                      >
                        {FILTER_CONNECTORS.map((connector, index) => (
                          <button
                            key={connector}
                            type="button"
                            className="absolute text-[13px] font-normal text-[#1D1F24] cursor-pointer"
                            style={{
                              left: 6,
                              top: index === 0 ? 10 : 46,
                            }}
                            onClick={() => {
                              if (row.showRootConnector) {
                                setFilterConnector(connector);
                                setHighlightedFilterConnectorKey("root");
                              } else {
                                // Extract group ID from connectorKey (format: "group:${groupId}")
                                const targetGroupId = connectorKey.replace("group:", "");

                                // Determine if this is a nested group (depth 2)
                                const isNestedGroup = row.grandparentGroupId !== undefined;

                                if (isNestedGroup) {
                                  // Update nested group connector
                                  setGroupConnector(targetGroupId, connector, row.grandparentGroupId);
                                } else {
                                  // Update root-level group connector
                                  setGroupConnector(targetGroupId, connector, undefined);
                                }
                              }
                              setHighlightedFilterFieldId(null);
                              setHighlightedFilterOperatorId(null);
                              setOpenFilterConnectorId(null);
                            }}
                          >
                            {connector}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
                <div
                  className="absolute flex items-center text-[13px] font-normal text-[#1D1F24]"
                  style={{
                    left: filterFieldLeft,
                    top: fieldTop,
                    width: filterFieldWidth,
                    height: filterFieldHeight,
                    borderRadius: 3,
                    border: "1px solid #E4E4E4",
                    background: "#ffffff",
                    zIndex: isDraggingRow ? 40 : 10,
                    transition: isDraggingRow
                      ? "none"
                      : "top 0.15s ease",
                    overflow: "visible",
                  }}
                >
                  {filterFieldSeparatorPositions.map((left) => (
                    <span
                      key={left}
                      className="absolute top-0 h-full"
                      style={{
                        left,
                        width: 1,
                        background: "#E4E4E4",
                      }}
                    />
                  ))}
                  <button
                    type="button"
                    className="airtable-filter-section absolute cursor-pointer"
                    data-filter-field-trigger={row.condition.id}
                    style={{
                      left: 0,
                      top: 0,
                      width: filterFieldSeparatorFieldLeft,
                      height: filterFieldHeight,
                      paddingLeft: 9,
                      paddingRight: 22,
                      display: "flex",
                      alignItems: "center",
                    }}
                    onClick={() =>
                      {
                        setOpenFilterOperatorId(null);
                        setOpenFilterFieldId((prev) =>
                          prev === row.condition.id ? null : row.condition.id
                        );
                      }
                    }
                  >
                    <span
                      className="text-[13px] font-normal"
                      style={{ color: isFieldHighlighted ? "#156FE2" : "#1D1F24" }}
                    >
                      {column?.name ?? "Name"}
                    </span>
                    {isFieldHighlighted ? (
                      <svg
                        width={10}
                        height={6}
                        viewBox="0 0 50.25 30.000001"
                        className="absolute"
                        style={{
                          left: filterFieldSeparatorFieldLeft - 11 - 10,
                          top: "50%",
                          transform: "translateY(-50%)",
                        }}
                        aria-hidden="true"
                      >
                        <defs>
                          <filter id={`${fieldArrowMaskId}-invert`}>
                            <feColorMatrix
                              type="matrix"
                              values="-1 0 0 0 1  0 -1 0 0 1  0 0 -1 0 1  0 0 0 1 0"
                            />
                          </filter>
                          <mask id={`${fieldArrowMaskId}-mask`}>
                            <image
                              href={arrowIcon.src}
                              width="50.25"
                              height="30.000001"
                              filter={`url(#${fieldArrowMaskId}-invert)`}
                            />
                          </mask>
                        </defs>
                        <rect
                          width="50.25"
                          height="30.000001"
                          fill="#156FE2"
                          mask={`url(#${fieldArrowMaskId}-mask)`}
                        />
                      </svg>
                    ) : (
                      <img
                        alt=""
                        className="absolute"
                        style={{
                          width: 10,
                          height: 6,
                          left: filterFieldSeparatorFieldLeft - 11 - 10,
                          top: "50%",
                          transform: "translateY(-50%)",
                        }}
                        src={arrowIcon.src}
                      />
                    )}
                  </button>
                  {isFieldMenuOpen && (
                    <div
                      className="airtable-dropdown-surface absolute"
                      data-filter-field-menu={row.condition.id}
                      style={{
                        left: 0,
                        top: filterFieldHeight + 2,
                        width: filterFieldMenuWidth,
                        height: filterFieldMenuHeight,
                        borderRadius: 3,
                        zIndex: 50000,
                      }}
                    >
                      <div
                        className="absolute airtable-find-field-label"
                        style={{
                          left: filterFieldMenuHeaderLeft,
                          top: filterFieldMenuTopPadding,
                          lineHeight: `${filterFieldMenuHeaderHeight}px`,
                        }}
                      >
                        Find a field
                      </div>
                      <div
                        ref={filterFieldMenuListRef}
                        className="absolute left-0 right-0"
                        style={{
                          top: filterFieldMenuFirstRowTop - filterFieldMenuHoverPadding,
                          height: filterFieldMenuListHeight + filterFieldMenuHoverPadding,
                          overflowY:
                            filterFieldMenuContentHeight >
                            filterFieldMenuHeight
                              ? "auto"
                              : "hidden",
                        }}
                      >
                        <div
                          className="relative w-full"
                          style={{ height: filterFieldVirtualizerSize + filterFieldMenuHoverPadding }}
                        >
                          {filterFieldVirtualItems.map((virtualRow) => {
                            const columnOption = orderedColumns[virtualRow.index];
                            if (!columnOption) return null;
                            const iconSpec = getSortAddMenuIconSpec(
                              columnOption.name,
                              columnOption.type
                            );
                            const hoverPadding = (filterFieldMenuRowHeight - filterFieldMenuTextHeight) / 2;
                            const hoverBoxTop = virtualRow.start;
                            return (
                              <button
                                key={columnOption.id}
                                type="button"
                                className="airtable-filter-menu-item airtable-filter-menu-item--field absolute"
                                style={{
                                  top: hoverBoxTop,
                                  width: filterFieldMenuItemWidth,
                                  left: filterFieldMenuItemLeft,
                                  height: filterFieldMenuRowHeight,
                                }}
                                onClick={() =>
                                  handleFilterFieldSelect(
                                    row.condition.id,
                                    columnOption.id,
                                    scopeGroupId,
                                    scopeParentGroupId
                                  )
                                }
                              >
                                <span
                                  style={{
                                    position: 'absolute',
                                    left: 0,
                                    top: hoverPadding,
                                    width: iconSpec.width,
                                    height: iconSpec.height,
                                  }}
                                >
                                  <img alt="" src={iconSpec.src} style={{ width: '100%', height: '100%' }} />
                                </span>
                                <span
                                  style={{
                                    position: 'absolute',
                                    left: filterFieldMenuLabelLeft - filterFieldMenuItemLeft,
                                    top: hoverPadding,
                                    fontSize: 13,
                                    lineHeight: '13px',
                                  }}
                                >
                                  {columnOption.name}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    className="airtable-filter-section absolute cursor-pointer"
                    data-filter-operator-trigger={row.condition.id}
                    style={{
                      left: filterFieldSeparatorFieldLeft,
                      top: 0,
                      width:
                        filterFieldSeparatorOperatorLeft -
                        filterFieldSeparatorFieldLeft,
                      height: filterFieldHeight,
                      paddingLeft: 9,
                      paddingRight: 22,
                      display: "flex",
                      alignItems: "center",
                    }}
                    onClick={() =>
                      {
                        setOpenFilterFieldId(null);
                        setOpenFilterOperatorId((prev) =>
                          prev === row.condition.id ? null : row.condition.id
                        );
                      }
                    }
                  >
                    <span
                      className="text-[13px] font-normal"
                      style={{ color: isOperatorHighlighted ? "#156FE2" : "#1D1F24" }}
                    >
                      {operatorLabel}
                    </span>
                    {isOperatorHighlighted ? (
                      <svg
                        width={10}
                        height={6}
                        viewBox="0 0 50.25 30.000001"
                        className="absolute"
                        style={{
                          left:
                            filterFieldSeparatorOperatorLeft -
                            filterFieldSeparatorFieldLeft -
                            11 -
                            10,
                          top: "50%",
                          transform: "translateY(-50%)",
                        }}
                        aria-hidden="true"
                      >
                        <defs>
                          <filter id={`${operatorArrowMaskId}-invert`}>
                            <feColorMatrix
                              type="matrix"
                              values="-1 0 0 0 1  0 -1 0 0 1  0 0 -1 0 1  0 0 0 1 0"
                            />
                          </filter>
                          <mask id={`${operatorArrowMaskId}-mask`}>
                            <image
                              href={arrowIcon.src}
                              width="50.25"
                              height="30.000001"
                              filter={`url(#${operatorArrowMaskId}-invert)`}
                            />
                          </mask>
                        </defs>
                        <rect
                          width="50.25"
                          height="30.000001"
                          fill="#156FE2"
                          mask={`url(#${operatorArrowMaskId}-mask)`}
                        />
                      </svg>
                    ) : (
                      <img
                        alt=""
                        className="absolute"
                        style={{
                          width: 10,
                          height: 6,
                          left:
                            filterFieldSeparatorOperatorLeft -
                            filterFieldSeparatorFieldLeft -
                            11 -
                            10,
                          top: "50%",
                          transform: "translateY(-50%)",
                        }}
                        src={arrowIcon.src}
                      />
                    )}
                  </button>
                  {isOperatorMenuOpen && (
                      <div
                        className="airtable-dropdown-surface absolute"
                        data-filter-operator-menu={row.condition.id}
                        style={{
                          left: filterFieldSeparatorFieldLeft,
                          top: filterFieldHeight + 2,
                          width: filterOperatorMenuWidth,
                          height: operatorMenuHeight,
                          borderRadius: 3,
                          zIndex: 50000,
                        }}
                      >
                      <div
                        className="absolute text-[13px] font-normal text-[#757575]"
                        style={{
                          left: filterFieldMenuHeaderLeft,
                          top: filterFieldMenuTopPadding,
                          lineHeight: `${filterFieldMenuHeaderHeight}px`,
                        }}
                      >
                        Find an operator
                      </div>
                      <div
                        ref={filterOperatorMenuListRef}
                        className="absolute left-0 right-0"
                        style={{
                          top: filterOperatorMenuFirstRowTop - filterOperatorMenuHoverPadding,
                          height: operatorMenuListHeight + filterOperatorMenuHoverPadding,
                          overflowY:
                            operatorMenuContentHeight >
                            filterOperatorMenuMaxHeight
                              ? "auto"
                              : "hidden",
                        }}
                      >
                        <div
                          className="relative w-full"
                          style={{ height: operatorListHeight }}
                        >
                          {operatorOptions.map((operator, index) => {
                            const hoverBoxTop = index * filterOperatorMenuRowStride;
                            return (
                              <button
                                key={operator}
                                type="button"
                                className="airtable-filter-menu-item airtable-filter-menu-item--operator absolute"
                                style={{
                                  top: hoverBoxTop,
                                  width: filterOperatorMenuItemWidth,
                                  left: filterOperatorMenuItemLeft,
                                  height: filterOperatorMenuRowHeight,
                                }}
                                onClick={() =>
                                  handleFilterOperatorSelect(
                                    row.condition.id,
                                    operator,
                                    scopeGroupId,
                                    scopeParentGroupId
                                  )
                                }
                              >
                                <span
                                  className="airtable-filter-menu-item-label"
                                  style={{
                                    position: 'absolute',
                                    left: 8,
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                  }}
                                >
                                  {FILTER_OPERATOR_LABELS[operator]}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                  <div
                    className={`airtable-filter-section absolute flex items-center${isFocused ? " airtable-filter-section--no-hover" : ""}`}
                    style={{
                      left: filterFieldSeparatorOperatorLeft,
                      width:
                        filterFieldSeparatorValueLeft -
                        filterFieldSeparatorOperatorLeft,
                      height: filterFieldHeight,
                      paddingLeft: operatorRequiresValue ? 9 : 0,
                      paddingRight: operatorRequiresValue ? 9 : 0,
                      cursor: operatorRequiresValue ? "text" : "default",
                    }}
                  >
                    {operatorRequiresValue && (
                      <>
                        <div
                          className="absolute"
                          style={{
                            left: 0,
                            right: 0,
                            top: -4,
                            bottom: -4,
                            border: isFocused
                              ? "2px solid #156FE2"
                              : "2px solid transparent",
                            borderRadius: 2,
                          }}
                        />
                        {isNumber && isFocused && (
                          <div
                            className="absolute"
                            style={{
                              left: 4,
                              right: 4,
                              top: 2,
                              bottom: 2,
                              border: hasError
                                ? "2px solid #DC053C"
                                : "2px solid #BFBFBF",
                              borderRadius: 2,
                            }}
                          />
                        )}
                        <input
                          value={fieldValue}
                          onChange={(event) =>
                            handleFilterValueChange(
                              row.condition.id,
                              event.target.value,
                              scopeGroupId,
                              scopeParentGroupId
                            )
                          }
                          onFocus={() =>
                            setFocusedFilterValueId(row.condition.id)
                          }
                          onBlur={() => {
                            setFocusedFilterValueId(null);
                            setFilterValueErrorId(null);
                          }}
                          placeholder="Enter a value"
                          inputMode={isNumber ? "decimal" : undefined}
                          pattern={
                            isNumber ? "^-?\\d*(?:\\.\\d{0,8})?$" : undefined
                          }
                          className="relative z-10 w-full bg-transparent text-[13px] font-normal text-[#1D1F24] outline-none placeholder:text-[#616670]"
                          style={{
                            paddingLeft: 0,
                            paddingRight: 0,
                          }}
                        />
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    className="airtable-filter-section absolute flex items-center justify-center cursor-pointer"
                    style={{
                      left: filterFieldSeparatorValueLeft,
                      top: 0,
                      width:
                        filterFieldSeparatorActionsLeft -
                        filterFieldSeparatorValueLeft,
                      height: filterFieldHeight,
                    }}
                    onClick={() => {
                      if (row.scope === "root") {
                        setFilterItems((prev) =>
                          prev.filter((item) => item.type !== "condition" || item.id !== row.condition.id)
                        );
                      } else {
                        const targetGroupId = row.parentGroupId ?? row.groupId; // parentGroupId is the group that contains the row
                        if (!targetGroupId) return;
                    
                        setFilterItems((prev) =>
                          removeConditionFromGroupTree(prev, targetGroupId, row.condition.id)
                        );
                      }
                    }}
                    aria-label="Delete condition"
                  >
                    <img
                      alt=""
                      style={{
                        width: 13.15,
                        height: 15.45,
                      }}
                      src={deleteIcon.src}
                    />
                  </button>
                  <button
                    type="button"
                    className="airtable-filter-section absolute flex items-center justify-center cursor-grab"
                    style={{
                      left: filterFieldSeparatorActionsLeft,
                      top: 0,
                      width: filterFieldWidth - filterFieldSeparatorActionsLeft,
                      height: filterFieldHeight,
                    }}
                    onMouseDown={(event) =>
                      handleFilterDragStart(
                        event,
                        row.condition.id,
                        row.scope,
                        row.groupId
                      )
                    }
                    aria-label="Reorder condition"
                  >
                    <img
                      alt=""
                      style={{
                        width: 10.23,
                        height: 13.3,
                      }}
                      src={reorderIcon.src}
                    />
                  </button>
                </div>
              </div>
              );
            })}
          </>
        )}
        <button
          type="button"
          className={clsx(
            "absolute flex items-center text-[13px] font-medium cursor-pointer",
            activeFilterAdd === "condition"
              ? "text-[#156FE2]"
              : "text-[#616670] hover:text-[#1D1F24]"
          )}
          style={{ left: 16, top: filterFooterTop, gap: 5 }}
          onClick={addFilterCondition}
        >
          <span className="airtable-plus-icon airtable-plus-icon--small" />
          <span>Add condition</span>
        </button>
        <button
          type="button"
          className={clsx(
            "absolute flex items-center text-[13px] font-medium cursor-pointer",
            activeFilterAdd === "group"
              ? "text-[#156FE2]"
              : "text-[#616670] hover:text-[#1D1F24]"
          )}
          style={{ left: 150, top: filterFooterTop, gap: 5 }}
          onClick={addFilterGroup}
        >
          <span className="airtable-plus-icon airtable-plus-icon--small" />
          <span>Add condition group</span>
          <span
            className="airtable-help-icon"
            style={{ width: 14, height: 14, marginLeft: 10 }}
          />
        </button>
      </div>
      {/* Phantom drag preview */}
      {draggingFilterId !== null && phantomFilterX !== null && phantomFilterY !== null && (() => {
        const draggedRow = filterLayout.entries.find((e) => e.type === "row" && e.condition.id === draggingFilterId);
        if (!draggedRow || draggedRow.type !== "row") return null;
        const draggedColumn = draggedRow.condition.columnId
          ? columnById.get(draggedRow.condition.columnId)
          : null;
        const draggedOperatorLabel = formatFilterOperatorLabel(
          FILTER_OPERATOR_LABELS[draggedRow.condition.operator]
        );
        const draggedRequiresValue = FILTER_OPERATOR_REQUIRES_VALUE.has(draggedRow.condition.operator);
        return (
          <div
            className="airtable-filter-phantom"
            style={{
              position: "fixed",
              left: phantomFilterX,
              top: phantomFilterY,
              width: filterFieldWidth,
              height: filterFieldHeight,
              outline: "2px solid #E5E5E5",
              outlineOffset: 0,
              borderRadius: 3,
              background: "#ffffff",
              opacity: 0.9,
              boxShadow: "0 0 24px rgba(15, 23, 42, 0.12)",
              zIndex: 10000,
              pointerEvents: "none",
              display: "flex",
              alignItems: "center",
              fontSize: 13,
              fontWeight: 400,
              color: "#1D1F24",
              overflow: "hidden",
            }}
          >
            {filterFieldSeparatorPositions.map((left) => (
              <span
                key={left}
                className="absolute top-0 h-full"
                style={{
                  left,
                  width: 1,
                  background: "#E4E4E4",
                }}
              />
            ))}
            <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)" }}>
              {draggedColumn?.name ?? "Name"}
            </span>
            <span style={{ position: "absolute", left: filterFieldSeparatorFieldLeft + 9, top: "50%", transform: "translateY(-50%)" }}>
              {draggedOperatorLabel}
            </span>
            {draggedRequiresValue && (
              <span
                style={{
                  position: "absolute",
                  left: filterFieldSeparatorOperatorLeft + 9,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: draggedRow.condition.value ? "#1D1F24" : "#616670",
                }}
              >
                {draggedRow.condition.value || "Enter a value"}
              </span>
            )}
            <span
              style={{
                position: "absolute",
                left: filterFieldSeparatorValueLeft,
                top: 0,
                width: filterFieldSeparatorActionsLeft - filterFieldSeparatorValueLeft,
                height: filterFieldHeight,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <img
                alt=""
                style={{ width: 13.15, height: 15.45, opacity: 0.9 }}
                src={deleteIcon.src}
              />
            </span>
            <span
              style={{
                position: "absolute",
                left: filterFieldSeparatorActionsLeft,
                top: 0,
                width: filterFieldWidth - filterFieldSeparatorActionsLeft,
                height: filterFieldHeight,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <img
                alt=""
                style={{ width: 10.23, height: 13.3 }}
                src={reorderIcon.src}
              />
            </span>
          </div>
        );
      })()}
    </div>
  );
}
