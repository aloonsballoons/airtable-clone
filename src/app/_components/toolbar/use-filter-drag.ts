import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import type {
  ColumnFieldType,
  FilterItem,
  FilterConditionItem,
  FilterGroupItem,
  FilterConnector,
  FilterOperator,
} from "~/lib/types";
import { coerceColumnType, isValidNumberDraft, getTableFilterStateKey } from "~/lib/utils";
import {
  type UseTableFilterReturn,
  FILTER_OPERATOR_LABELS,
  FILTER_OPERATOR_REQUIRES_VALUE,
  getDefaultFilterOperator,
  getFilterOperatorsForType,
  createFilterCondition,
  createFilterGroup,
} from "./use-table-filter";

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export type UseFilterDragParams = {
  filterHook: UseTableFilterReturn;
  orderedColumns: { id: string; name: string; type: string | null }[];
  columnById: Map<string, { id: string; name: string; type: string | null }>;
  hiddenColumnIdSet: Set<string>;
  activeTableId: string | null;
  baseId: string;
  isViewSwitching: boolean;
  pendingViewName: string | null;
  tableMetaData: unknown; // tableMetaQuery.data
};

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export type FilterLayoutEntry =
  | {
      type: "row";
      condition: FilterConditionItem;
      depth: number;
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
    }
  | {
      type: "group";
      group: FilterGroupItem;
      isEmpty: boolean;
      depth: number;
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

export type FilterLayout = {
  entries: FilterLayoutEntry[];
  contentBottom: number;
  groupMetaMap: Map<
    string,
    { startTop: number; bottomTop: number; rowCount: number }
  >;
};

export type UseFilterDragReturn = {
  // State
  activeFilterAdd: "condition" | "group" | null;
  setActiveFilterAdd: React.Dispatch<
    React.SetStateAction<"condition" | "group" | null>
  >;
  openFilterFieldId: string | null;
  setOpenFilterFieldId: React.Dispatch<React.SetStateAction<string | null>>;
  openFilterOperatorId: string | null;
  setOpenFilterOperatorId: React.Dispatch<React.SetStateAction<string | null>>;
  openFilterConnectorId: string | null;
  setOpenFilterConnectorId: React.Dispatch<React.SetStateAction<string | null>>;
  focusedFilterValueId: string | null;
  setFocusedFilterValueId: React.Dispatch<React.SetStateAction<string | null>>;
  filterValueErrorId: string | null;
  setFilterValueErrorId: React.Dispatch<React.SetStateAction<string | null>>;
  draggingFilterId: string | null;
  draggingFilterTop: number | null;
  highlightedFilterFieldId: string | null;
  setHighlightedFilterFieldId: React.Dispatch<
    React.SetStateAction<string | null>
  >;
  highlightedFilterOperatorId: string | null;
  setHighlightedFilterOperatorId: React.Dispatch<
    React.SetStateAction<string | null>
  >;
  highlightedFilterConnectorKey: string | null;
  setHighlightedFilterConnectorKey: React.Dispatch<
    React.SetStateAction<string | null>
  >;
  phantomFilterX: number | null;
  phantomFilterY: number | null;
  openGroupPlusId: string | null;
  setOpenGroupPlusId: React.Dispatch<React.SetStateAction<string | null>>;
  draggingGroupId: string | null;

  // Refs
  filterFieldMenuListRef: React.RefObject<HTMLDivElement | null>;
  filterOperatorMenuListRef: React.RefObject<HTMLDivElement | null>;

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
  filterFieldSeparatorPositions: readonly [number, number, number, number];
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

  // Group constants
  filterGroupEmptyWidth: number;
  filterGroupEmptyHeight: number;
  filterGroupPaddingTop: number;
  filterGroupPaddingBottom: number;
  filterGroupPaddingLeft: number;
  filterGroupWhereLeft: number;

  // Computed
  hasFilterItems: boolean;
  filterRows: FilterItem[];
  filterLayout: FilterLayout;
  filterFooterTop: number;

  // Callbacks
  updateFilterCondition: (
    conditionId: string,
    updater: (condition: FilterConditionItem) => FilterConditionItem,
    groupId?: string,
    parentGroupId?: string
  ) => void;
  getDefaultFilterCondition: () => FilterConditionItem;
  addFilterCondition: () => void;
  addFilterGroup: () => void;
  addFilterConditionToGroup: (
    groupId: string,
    parentGroupId?: string
  ) => void;
  addFilterGroupToGroup: (
    parentGroupId: string,
    grandparentGroupId?: string
  ) => void;
  deleteFilterGroup: (groupId: string, parentGroupId?: string) => void;
  setGroupConnector: (
    groupId: string,
    connector: FilterConnector,
    parentGroupId?: string
  ) => void;
  handleFilterFieldSelect: (
    conditionId: string,
    columnId: string,
    groupId?: string,
    parentGroupId?: string
  ) => void;
  handleFilterOperatorSelect: (
    conditionId: string,
    operator: FilterOperator,
    groupId?: string,
    parentGroupId?: string
  ) => void;
  handleFilterValueChange: (
    conditionId: string,
    value: string,
    groupId?: string,
    parentGroupId?: string
  ) => void;
  handleFilterDragStart: (
    event: ReactMouseEvent,
    conditionId: string,
    scope: "root" | "group",
    groupId?: string
  ) => void;

  // Virtualizer
  filterFieldVirtualItems: ReturnType<
    ReturnType<typeof useVirtualizer>["getVirtualItems"]
  >;
  filterFieldVirtualizerSize: number;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFilterDrag({
  filterHook,
  orderedColumns,
  columnById,
  hiddenColumnIdSet,
  activeTableId,
  baseId,
  isViewSwitching,
  pendingViewName,
  tableMetaData,
}: UseFilterDragParams): UseFilterDragReturn {
  const {
    filterItems,
    setFilterItems,
    filterConnector,
    setFilterConnector,
    hasFilterItems,
  } = filterHook;

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  const [activeFilterAdd, setActiveFilterAdd] = useState<
    "condition" | "group" | null
  >(null);
  const [openFilterFieldId, setOpenFilterFieldId] = useState<string | null>(
    null
  );
  const [openFilterOperatorId, setOpenFilterOperatorId] = useState<
    string | null
  >(null);
  const [openFilterConnectorId, setOpenFilterConnectorId] = useState<
    string | null
  >(null);
  const [focusedFilterValueId, setFocusedFilterValueId] = useState<
    string | null
  >(null);
  const [filterValueErrorId, setFilterValueErrorId] = useState<string | null>(
    null
  );
  const [draggingFilterId, setDraggingFilterId] = useState<string | null>(null);
  const [draggingFilterTop, setDraggingFilterTop] = useState<number | null>(
    null
  );
  const [highlightedFilterFieldId, setHighlightedFilterFieldId] = useState<
    string | null
  >(null);
  const [highlightedFilterOperatorId, setHighlightedFilterOperatorId] =
    useState<string | null>(null);
  const [highlightedFilterConnectorKey, setHighlightedFilterConnectorKey] =
    useState<string | null>(null);
  const [phantomFilterX, setPhantomFilterX] = useState<number | null>(null);
  const [phantomFilterY, setPhantomFilterY] = useState<number | null>(null);
  const [openGroupPlusId, setOpenGroupPlusId] = useState<string | null>(null);
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);

  const [filterDragPreview, setFilterDragPreview] = useState<{
    scope: "root" | "group";
    groupId?: string;
    order: string[];
  } | null>(null);

  // -------------------------------------------------------------------------
  // Refs
  // -------------------------------------------------------------------------
  const filterFieldMenuListRef = useRef<HTMLDivElement>(null);
  const filterOperatorMenuListRef = useRef<HTMLDivElement>(null);
  const filterDragOffsetRef = useRef(0);
  const phantomOffsetRef = useRef({ x: 0, y: 0 });
  const filterDragIndexRef = useRef(0);
  const filterDragScopeRef = useRef<{
    scope: "root" | "group";
    groupId?: string;
    startIndex: number;
    listStartTop: number;
    rowCount: number;
    order: string[];
  } | null>(null);
  const dragOffsetRef = useRef(0);
  const dragIndexRef = useRef(0);
  const hydratedFilterTableIdRef = useRef<string | null>(null);

  // -------------------------------------------------------------------------
  // Layout constants
  // -------------------------------------------------------------------------
  const filterDropdownBaseWidth = 332;
  const filterDropdownExpandedWidth = 590;
  const filterDropdownBaseHeight = 166;
  const filterDropdownHeaderLeft = 16;
  const filterDropdownHeaderTop = 14;
  const filterInputLeft = 16;
  const filterInputTop = 41;
  const filterInputHeight = 32;
  const filterInputRadius = 6;
  const filterEmptyMessageTop = 98;
  const filterExpandedMessageTop = 94;
  const filterWhereTop = 131;
  const filterRowLeft = 32;
  const filterRowHeight = 32;
  const filterRowGap = 8;
  const filterRowStride = filterRowHeight + filterRowGap;
  const filterConnectorWidth = 56;
  const filterConnectorHeight = 32;
  const filterConnectorGap = 8;
  const filterFieldLeft = filterConnectorWidth + filterConnectorGap;
  const filterFieldWidth = 456;
  const filterFieldHeight = filterConnectorHeight;
  const filterFieldFontSize = 13;
  const filterFieldTextAlignOffset = 2;
  const filterFirstRowTop =
    filterWhereTop -
    (filterFieldHeight - filterFieldFontSize) / 2 +
    filterFieldTextAlignOffset;
  const filterFieldSeparatorPositions = [125, 250, 390, 422] as const;
  const [
    filterFieldSeparatorFieldLeft,
    filterFieldSeparatorOperatorLeft,
    filterFieldSeparatorValueLeft,
    filterFieldSeparatorActionsLeft,
  ] = filterFieldSeparatorPositions;
  const filterFooterGap = 24;
  const filterFooterHeight = 16;
  const filterBottomPadding = 21;

  // Group-specific constants
  const filterGroupEmptyWidth = 570;
  const filterGroupEmptyHeight = 39;
  const filterGroupPaddingTop = 40;
  const filterGroupPaddingBottom = 8;
  const filterGroupPaddingLeft = 16;
  const filterGroupWhereLeft = 40;
  const filterDropdownGroupWidth = 683;
  const filterGroupNestedWidth = 650;
  const filterGroupConditionFieldWidth = 456;

  // Dynamic width based on group nesting
  const hasGroups = filterItems.some((i) => i.type === "group");
  const hasNestedGroups = useMemo(() => {
    const checkForNestedGroups = (items: FilterItem[]): boolean => {
      for (const item of items) {
        if (item.type === "group") {
          if (item.conditions.some((c) => c.type === "group")) {
            return true;
          }
          if (checkForNestedGroups(item.conditions)) {
            return true;
          }
        }
      }
      return false;
    };
    return checkForNestedGroups(filterItems);
  }, [filterItems]);

  const filterDropdownWidth = !hasFilterItems
    ? filterDropdownBaseWidth
    : hasNestedGroups
      ? 762
      : hasGroups
        ? filterDropdownGroupWidth
        : filterDropdownExpandedWidth;
  const filterInputWidth = filterDropdownWidth - 32;

  // Filter field menu constants
  const filterFieldMenuWidth = 204;
  const filterFieldMenuMaxHeight = 277;
  const filterFieldMenuTopPadding = 20;
  const filterFieldMenuHeaderLeft = 20;
  const filterFieldMenuHeaderHeight = 13;
  const filterFieldMenuTextHeight = 13;
  const filterFieldMenuTextGap = 20;
  const filterFieldMenuRowStride =
    filterFieldMenuTextHeight + filterFieldMenuTextGap;
  const filterFieldMenuRowHeight = 34;
  const filterFieldMenuRowGap = 0;
  const filterFieldMenuHeaderGap = filterFieldMenuTextGap;
  const filterFieldMenuBottomPadding = 20;
  const filterOperatorMenuBottomPadding = 0;
  const filterFieldMenuItemLeft = 12;
  const filterFieldMenuItemWidth = 172;
  const filterFieldMenuLabelLeft = 40;
  const filterFieldMenuHoverPadding =
    (filterFieldMenuRowHeight - filterFieldMenuTextHeight) / 2;
  const filterFieldMenuFirstRowTop =
    filterFieldMenuTopPadding +
    filterFieldMenuHeaderHeight +
    filterFieldMenuHeaderGap;
  const filterFieldMenuContentHeight =
    filterFieldMenuFirstRowTop +
    (orderedColumns.length > 0
      ? (orderedColumns.length - 1) * filterFieldMenuRowStride +
        filterFieldMenuTextHeight
      : 0) +
    filterFieldMenuBottomPadding;
  const filterFieldMenuHeight = Math.min(
    filterFieldMenuMaxHeight,
    filterFieldMenuContentHeight
  );
  const filterFieldMenuListHeight = Math.max(
    0,
    filterFieldMenuHeight - filterFieldMenuFirstRowTop
  );

  // Filter operator menu constants
  const filterOperatorMenuWidth = 186;
  const filterOperatorMenuMaxHeight = 260;
  const filterOperatorMenuTextHeight = 13;
  const filterOperatorMenuTextGap = 20;
  const filterOperatorMenuRowStride =
    filterOperatorMenuTextHeight + filterOperatorMenuTextGap;
  const filterOperatorMenuRowHeight = 34;
  const filterOperatorMenuRowGap = 0;
  const filterOperatorMenuItemWidth = 162;
  const filterOperatorMenuItemLeft = 12;
  const filterOperatorMenuHoverPadding =
    (filterOperatorMenuRowHeight - filterOperatorMenuTextHeight) / 2;
  const filterOperatorMenuFirstRowTop =
    filterFieldMenuTopPadding +
    filterFieldMenuHeaderHeight +
    filterFieldMenuHeaderGap;

  // -------------------------------------------------------------------------
  // filterRows useMemo (using filterDragPreview + filterItems)
  // -------------------------------------------------------------------------
  const filterRows = useMemo(() => {
    if (!filterDragPreview) return filterItems;
    if (filterDragPreview.scope === "root") {
      const rootItems = filterItems.filter(
        (item): item is FilterConditionItem => item.type === "condition"
      );
      if (rootItems.length !== filterDragPreview.order.length)
        return filterItems;
      const byId = new Map(rootItems.map((item) => [item.id, item]));
      return filterDragPreview.order
        .map((id) => byId.get(id))
        .filter((item): item is FilterConditionItem => Boolean(item));
    }
    if (filterDragPreview.groupId) {
      return filterItems.map((item) => {
        if (
          item.type !== "group" ||
          item.id !== filterDragPreview.groupId
        ) {
          return item;
        }
        const byId = new Map(
          item.conditions.map((condition) => [condition.id, condition])
        );
        const nextConditions = filterDragPreview.order
          .map((id) => byId.get(id))
          .filter(
            (condition): condition is FilterConditionItem => Boolean(condition)
          );
        if (nextConditions.length !== item.conditions.length) return item;
        return { ...item, conditions: nextConditions };
      });
    }
    return filterItems;
  }, [filterDragPreview, filterItems]);

  const hasFilterGroups = useMemo(
    () => filterItems.some((item) => item.type === "group"),
    [filterItems]
  );

  // -------------------------------------------------------------------------
  // filterLayout useMemo
  // -------------------------------------------------------------------------
  const filterLayout = useMemo((): FilterLayout => {
    const entries: FilterLayoutEntry[] = [];
    const groupMetaMap = new Map<
      string,
      { startTop: number; bottomTop: number; rowCount: number }
    >();

    const processItems = (
      items: (FilterConditionItem | FilterGroupItem)[],
      depth: number,
      parentGroupId: string | undefined,
      grandparentGroupId: string | undefined,
      currentTop: number,
      leftOffset: number,
      rootIndex: number,
      parentConnector?: FilterConnector
    ): { nextTop: number; nextRootIndex: number } => {
      let top = currentTop;
      let rIndex = rootIndex;

      items.forEach((item, itemIndex) => {
        if (item.type === "condition") {
          const showRootConnector = rIndex > 0;
          entries.push({
            type: "row",
            condition: item,
            depth,
            parentGroupId,
            grandparentGroupId,
            top,
            left: leftOffset,
            scope: depth === 0 ? "root" : "group",
            groupId: parentGroupId,
            indexInScope: itemIndex,
            showConnector: showRootConnector,
            showConnectorControl: rIndex === 1,
            connector: filterConnector,
            connectorKey: "root",
            showRootConnector,
            showGroupConnector: false,
          });
          top += filterRowStride;
          rIndex += 1;
        } else {
          const groupId = item.id;
          const groupStartTop = top;
          const isEmpty = item.conditions.length === 0;
          const groupDepth = depth;

          if (isEmpty) {
            const groupWidth =
              hasNestedGroups && groupDepth === 0
                ? filterGroupNestedWidth
                : filterGroupEmptyWidth;
            const showRootConnector = rIndex > 0;
            const groupLeft = leftOffset + filterFieldLeft;

            const showConnector =
              groupDepth === 0 ? showRootConnector : rIndex > 0;
            const showConnectorControl =
              groupDepth === 0 ? rIndex === 1 : rIndex === 1;
            const connectorKey =
              groupDepth === 0 ? "root" : `group:${parentGroupId}`;
            const connector =
              groupDepth === 0
                ? filterConnector
                : (parentConnector ?? "and");

            entries.push({
              type: "group",
              group: item,
              isEmpty: true,
              depth: groupDepth,
              parentGroupId,
              top: groupStartTop,
              left: groupLeft,
              width: groupWidth,
              height: filterGroupEmptyHeight,
              showConnector,
              showConnectorControl,
              connectorKey,
              connector,
              firstChildHasRootConnector: false,
            });
            groupMetaMap.set(groupId, {
              startTop: groupStartTop,
              bottomTop: groupStartTop + filterGroupEmptyHeight,
              rowCount: 0,
            });
            top += filterGroupEmptyHeight + filterRowGap;
            rIndex += 1;
          } else {
            const groupWidth =
              hasNestedGroups && groupDepth === 0
                ? filterGroupNestedWidth
                : filterGroupEmptyWidth;
            const groupLeft = leftOffset + filterFieldLeft;
            const childLeftOffset = groupLeft + 11;
            const whereTopInGroup = 47;
            const childTopOffset =
              whereTopInGroup - (filterFieldHeight - 13) / 2 + 2;
            let childTop = groupStartTop + childTopOffset;
            let childRootIndex = 0;

            const groupInsertIndex = entries.length;

            item.conditions.forEach((child, childIndex) => {
              if (child.type === "condition") {
                const isFirstChild = childIndex === 0;
                const isSecondChild = childIndex === 1;
                const showGroupConnector = childIndex > 0;
                const connector = item.connector;
                const connectorKey = `group:${groupId}`;

                entries.push({
                  type: "row",
                  condition: child,
                  depth: groupDepth + 1,
                  parentGroupId: groupId,
                  grandparentGroupId: parentGroupId,
                  top: childTop,
                  left: childLeftOffset,
                  scope: "group",
                  groupId,
                  indexInScope: childIndex,
                  showConnector: showGroupConnector,
                  showConnectorControl: isSecondChild,
                  connector,
                  connectorKey,
                  showRootConnector: false,
                  showGroupConnector,
                });
                childTop += filterRowStride;
                childRootIndex = 0;
              } else {
                const isFirstChild = childIndex === 0;
                const isSecondChild = childIndex === 1;
                const showGroupConnector = childIndex > 0;

                const nestedResult = processItems(
                  [child],
                  groupDepth + 1,
                  groupId,
                  parentGroupId,
                  childTop,
                  childLeftOffset,
                  childIndex,
                  item.connector
                );
                childTop = nestedResult.nextTop;
                childRootIndex = childIndex + 1;
              }
            });

            const childrenBottomTop = childTop - filterRowGap;
            const groupHeight =
              childrenBottomTop - groupStartTop + filterGroupPaddingBottom;

            const showRootConnector = rIndex > 0;

            const showConnector =
              groupDepth === 0 ? showRootConnector : rIndex > 0;
            const showConnectorControl =
              groupDepth === 0 ? rIndex === 1 : rIndex === 1;
            const connectorKey =
              groupDepth === 0 ? "root" : `group:${parentGroupId}`;
            const connector =
              groupDepth === 0
                ? filterConnector
                : (parentConnector ?? "and");

            entries.splice(groupInsertIndex, 0, {
              type: "group",
              group: item,
              isEmpty: false,
              depth: groupDepth,
              parentGroupId,
              top: groupStartTop,
              left: groupLeft,
              width: groupWidth,
              height: groupHeight,
              showConnector,
              showConnectorControl,
              connectorKey,
              connector,
              firstChildHasRootConnector: false,
            });

            groupMetaMap.set(groupId, {
              startTop: groupStartTop,
              bottomTop: groupStartTop + groupHeight,
              rowCount: item.conditions.length,
            });

            top = groupStartTop + groupHeight + filterRowGap;
            rIndex += 1;
          }
        }
      });

      return { nextTop: top, nextRootIndex: rIndex };
    };

    processItems(
      filterRows,
      0,
      undefined,
      undefined,
      filterFirstRowTop,
      filterRowLeft,
      0,
      undefined
    );

    const contentBottom =
      entries.length > 0
        ? Math.max(
            ...entries.map((e) =>
              e.type === "row" ? e.top + filterRowHeight : e.top + e.height
            )
          )
        : filterWhereTop;

    return {
      entries,
      contentBottom,
      groupMetaMap,
    };
  }, [
    filterConnector,
    filterRows,
    filterGroupEmptyWidth,
    filterGroupEmptyHeight,
    filterGroupPaddingTop,
    filterGroupPaddingBottom,
    filterGroupPaddingLeft,
    filterGroupNestedWidth,
    filterRowLeft,
    filterFieldLeft,
    filterFirstRowTop,
    filterRowStride,
    filterRowGap,
    filterRowHeight,
    filterWhereTop,
    hasNestedGroups,
  ]);

  // -------------------------------------------------------------------------
  // Derived layout values
  // -------------------------------------------------------------------------
  const filterFooterTop = hasFilterItems
    ? filterLayout.contentBottom + filterFooterGap
    : 132;
  const filterDropdownHeight = hasFilterItems
    ? filterFooterTop + filterFooterHeight + filterBottomPadding
    : filterDropdownBaseHeight;

  // -------------------------------------------------------------------------
  // Filter CRUD callbacks
  // -------------------------------------------------------------------------
  const updateFilterCondition = useCallback(
    (
      conditionId: string,
      updater: (condition: FilterConditionItem) => FilterConditionItem,
      groupId?: string,
      parentGroupId?: string
    ) => {
      setFilterItems((prev) =>
        prev.map((item) => {
          if (parentGroupId) {
            if (item.type !== "group" || item.id !== parentGroupId)
              return item;
            return {
              ...item,
              conditions: item.conditions.map((child) => {
                if (child.type !== "group" || child.id !== groupId)
                  return child;
                return {
                  ...child,
                  conditions: child.conditions.map((grandchild) =>
                    grandchild.type === "condition" &&
                    grandchild.id === conditionId
                      ? updater(grandchild)
                      : grandchild
                  ),
                };
              }),
            };
          }
          if (groupId) {
            if (item.type !== "group" || item.id !== groupId) return item;
            return {
              ...item,
              conditions: item.conditions.map((child) =>
                child.type === "condition" && child.id === conditionId
                  ? updater(child)
                  : child
              ),
            };
          }
          if (item.type !== "condition") return item;
          return item.id === conditionId ? updater(item) : item;
        })
      );
    },
    [setFilterItems]
  );

  const getDefaultFilterCondition = useCallback(() => {
    const defaultColumn = orderedColumns[0];
    if (!defaultColumn) return createFilterCondition();
    const columnType = coerceColumnType(defaultColumn.type);
    return createFilterCondition(defaultColumn.id, columnType);
  }, [orderedColumns]);

  const addFilterCondition = useCallback(() => {
    const defaultColumn = orderedColumns[0];
    filterHook.addFilterCondition(defaultColumn?.id ?? null);
    setActiveFilterAdd("condition");
  }, [filterHook, orderedColumns]);

  const addFilterGroup = useCallback(() => {
    filterHook.addFilterGroup();
    setActiveFilterAdd("group");
  }, [filterHook]);

  const addFilterConditionToGroup = useCallback(
    (groupId: string, parentGroupId?: string) => {
      setFilterItems((prev) => {
        if (!parentGroupId) {
          return prev.map((item) => {
            if (item.type !== "group" || item.id !== groupId) return item;
            return {
              ...item,
              conditions: [
                ...item.conditions,
                getDefaultFilterCondition(),
              ],
            };
          });
        } else {
          return prev.map((item) => {
            if (item.type !== "group" || item.id !== parentGroupId)
              return item;
            return {
              ...item,
              conditions: item.conditions.map((child) => {
                if (child.type !== "group" || child.id !== groupId)
                  return child;
                return {
                  ...child,
                  conditions: [
                    ...child.conditions,
                    getDefaultFilterCondition(),
                  ],
                };
              }),
            };
          });
        }
      });
      setOpenGroupPlusId(null);
    },
    [getDefaultFilterCondition, setFilterItems]
  );

  const addFilterGroupToGroup = useCallback(
    (parentGroupId: string, grandparentGroupId?: string) => {
      setFilterItems((prev) => {
        if (!grandparentGroupId) {
          return prev.map((item) => {
            if (item.type !== "group" || item.id !== parentGroupId)
              return item;
            return {
              ...item,
              conditions: [...item.conditions, createFilterGroup()],
            };
          });
        } else {
          return prev.map((item) => {
            if (item.type !== "group" || item.id !== grandparentGroupId)
              return item;
            return {
              ...item,
              conditions: item.conditions.map((child) => {
                if (child.type !== "group" || child.id !== parentGroupId)
                  return child;
                return {
                  ...child,
                  conditions: [...child.conditions, createFilterGroup()],
                };
              }),
            };
          });
        }
      });
      setOpenGroupPlusId(null);
    },
    [setFilterItems]
  );

  const deleteFilterGroup = useCallback(
    (groupId: string, parentGroupId?: string) => {
      setFilterItems((prev) => {
        if (!parentGroupId) {
          return prev.filter(
            (item) => item.type !== "group" || item.id !== groupId
          );
        } else {
          return prev.map((item) => {
            if (item.type !== "group" || item.id !== parentGroupId)
              return item;
            return {
              ...item,
              conditions: item.conditions.filter(
                (child) => child.type !== "group" || child.id !== groupId
              ),
            };
          });
        }
      });
    },
    [setFilterItems]
  );

  const setGroupConnector = useCallback(
    (
      groupId: string,
      connector: FilterConnector,
      parentGroupId?: string
    ) => {
      setFilterItems((prev) => {
        if (!parentGroupId) {
          return prev.map((item) => {
            if (item.type !== "group" || item.id !== groupId) return item;
            return { ...item, connector };
          });
        } else {
          return prev.map((item) => {
            if (item.type !== "group" || item.id !== parentGroupId)
              return item;
            return {
              ...item,
              conditions: item.conditions.map((child) => {
                if (child.type !== "group" || child.id !== groupId)
                  return child;
                return { ...child, connector };
              }),
            };
          });
        }
      });
      setHighlightedFilterConnectorKey(`group:${groupId}`);
      setHighlightedFilterFieldId(null);
      setHighlightedFilterOperatorId(null);
    },
    [setFilterItems]
  );

  const handleFilterFieldSelect = useCallback(
    (
      conditionId: string,
      columnId: string,
      groupId?: string,
      parentGroupId?: string
    ) => {
      const column = columnById.get(columnId);
      const columnType = coerceColumnType(column?.type);
      updateFilterCondition(
        conditionId,
        (condition) => {
          const allowedOperators = getFilterOperatorsForType(columnType);
          const nextOperator = allowedOperators.includes(condition.operator)
            ? condition.operator
            : getDefaultFilterOperator(columnType);
          return {
            ...condition,
            columnId,
            operator: nextOperator,
          };
        },
        groupId,
        parentGroupId
      );
      setOpenFilterFieldId(null);
      setOpenFilterOperatorId(null);
      setHighlightedFilterFieldId(conditionId);
      setHighlightedFilterOperatorId(null);
    },
    [columnById, updateFilterCondition]
  );

  const handleFilterOperatorSelect = useCallback(
    (
      conditionId: string,
      operator: FilterOperator,
      groupId?: string,
      parentGroupId?: string
    ) => {
      const requiresValue = FILTER_OPERATOR_REQUIRES_VALUE.has(operator);
      updateFilterCondition(
        conditionId,
        (condition) => ({
          ...condition,
          operator,
          ...(requiresValue ? {} : { value: "" }),
        }),
        groupId,
        parentGroupId
      );
      setOpenFilterOperatorId(null);
      setHighlightedFilterOperatorId(conditionId);
      setHighlightedFilterFieldId(null);
    },
    [updateFilterCondition]
  );

  const handleFilterValueChange = useCallback(
    (
      conditionId: string,
      value: string,
      groupId?: string,
      parentGroupId?: string
    ) => {
      let isValid = true;
      const columnId = (() => {
        if (parentGroupId) {
          const parentGroup = filterItems.find(
            (item): item is FilterGroupItem =>
              item.type === "group" && item.id === parentGroupId
          );
          const nestedGroup = parentGroup?.conditions.find(
            (item): item is FilterGroupItem =>
              item.type === "group" && item.id === groupId
          );
          const condition = nestedGroup?.conditions.find(
            (item): item is FilterConditionItem =>
              item.type === "condition" && item.id === conditionId
          );
          return condition?.columnId ?? null;
        }
        if (!groupId) {
          const condition = filterItems.find(
            (item): item is FilterConditionItem =>
              item.type === "condition" && item.id === conditionId
          );
          return condition?.columnId ?? null;
        }
        const group = filterItems.find(
          (item): item is FilterGroupItem =>
            item.type === "group" && item.id === groupId
        );
        const condition = group?.conditions.find(
          (item): item is FilterConditionItem =>
            item.type === "condition" && item.id === conditionId
        );
        return condition?.columnId ?? null;
      })();
      const columnType = columnId
        ? coerceColumnType(columnById.get(columnId)?.type)
        : "single_line_text";
      if (columnType === "number" && !isValidNumberDraft(value)) {
        isValid = false;
      }
      setFilterValueErrorId(isValid ? null : conditionId);
      if (!isValid) return;
      updateFilterCondition(
        conditionId,
        (condition) => ({ ...condition, value }),
        groupId,
        parentGroupId
      );
    },
    [columnById, filterItems, updateFilterCondition]
  );

  // -------------------------------------------------------------------------
  // Filter table-change reset
  // -------------------------------------------------------------------------
  useEffect(() => {
    hydratedFilterTableIdRef.current = null;
    filterHook.setFilterItems([]);
    filterHook.setFilterConnector("and");
    setActiveFilterAdd(null);
    filterHook.setIsFilterMenuOpen(false);
    setOpenFilterFieldId(null);
    setOpenFilterOperatorId(null);
    setOpenFilterConnectorId(null);
    setFocusedFilterValueId(null);
    setFilterValueErrorId(null);
  }, [activeTableId]); // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // Filter hydration from localStorage
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!activeTableId) return;
    if (!tableMetaData) return;
    if (hydratedFilterTableIdRef.current === activeTableId) return;

    const parseCondition = (
      value: unknown
    ): FilterConditionItem | null => {
      if (!value || typeof value !== "object") return null;
      const condition = value as Partial<FilterConditionItem>;
      const columnId =
        typeof condition.columnId === "string" ? condition.columnId : null;
      if (!columnId || hiddenColumnIdSet.has(columnId)) return null;
      const column = columnById.get(columnId);
      if (!column) return null;
      const columnType = coerceColumnType(column.type);
      const operatorValue = condition.operator;
      if (typeof operatorValue !== "string") return null;
      if (!(operatorValue in FILTER_OPERATOR_LABELS)) return null;
      const operator = operatorValue as FilterOperator;
      if (!getFilterOperatorsForType(columnType).includes(operator))
        return null;
      return {
        id:
          typeof condition.id === "string" && condition.id.length > 0
            ? condition.id
            : crypto.randomUUID(),
        type: "condition",
        columnId,
        operator,
        value: typeof condition.value === "string" ? condition.value : "",
      };
    };

    let nextConnector: FilterConnector = "and";
    let nextItems: FilterItem[] = [];

    try {
      const raw = window.localStorage.getItem(
        getTableFilterStateKey(baseId, activeTableId)
      );
      if (raw) {
        const parsed = JSON.parse(raw) as {
          connector?: unknown;
          items?: unknown;
        };
        if (parsed.connector === "and" || parsed.connector === "or") {
          nextConnector = parsed.connector;
        }

        const parseGroup = (value: unknown): FilterGroupItem | null => {
          if (!value || typeof value !== "object") return null;
          const rawGroup = value as {
            id?: unknown;
            type?: unknown;
            connector?: unknown;
            conditions?: unknown;
          };
          if (
            rawGroup.type !== "group" ||
            !Array.isArray(rawGroup.conditions)
          ) {
            return null;
          }

          const conditions: (FilterConditionItem | FilterGroupItem)[] = [];
          rawGroup.conditions.forEach((child: unknown) => {
            if (!child || typeof child !== "object") return;
            const rawChild = child as { type?: unknown };

            if (rawChild.type === "condition") {
              const parsed = parseCondition(child);
              if (parsed) conditions.push(parsed);
            } else if (rawChild.type === "group") {
              const parsed = parseGroup(child);
              if (parsed) conditions.push(parsed);
            }
          });

          if (conditions.length === 0) return null;
          const connector: FilterConnector =
            rawGroup.connector === "or" ? "or" : "and";
          return {
            id:
              typeof rawGroup.id === "string" && rawGroup.id.length > 0
                ? rawGroup.id
                : crypto.randomUUID(),
            type: "group",
            connector,
            conditions,
          };
        };

        if (Array.isArray(parsed.items)) {
          nextItems = parsed.items.flatMap<FilterItem>((item: unknown) => {
            if (!item || typeof item !== "object") return [];
            const rawItem = item as { type?: unknown };

            if (rawItem.type === "condition") {
              const condition = parseCondition(item);
              return condition ? [condition] : [];
            }
            if (rawItem.type === "group") {
              const group = parseGroup(item);
              return group ? [group] : [];
            }
            return [];
          });
        }
      }
    } catch {
      try {
        window.localStorage.removeItem(
          getTableFilterStateKey(baseId, activeTableId)
        );
      } catch {
        // Ignore storage errors.
      }
      nextConnector = "and";
      nextItems = [];
    }

    setFilterConnector(nextConnector);
    setFilterItems(nextItems);
    hydratedFilterTableIdRef.current = activeTableId;
  }, [
    activeTableId,
    baseId,
    columnById,
    hiddenColumnIdSet,
    tableMetaData,
    setFilterConnector,
    setFilterItems,
  ]);

  // -------------------------------------------------------------------------
  // Filter persistence to localStorage
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!activeTableId) return;
    if (hydratedFilterTableIdRef.current !== activeTableId) return;
    const storageKey = getTableFilterStateKey(baseId, activeTableId);
    try {
      if (filterItems.length === 0 && filterConnector === "and") {
        window.localStorage.removeItem(storageKey);
        return;
      }
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          version: 1,
          connector: filterConnector,
          items: filterItems,
        })
      );
    } catch {
      // Ignore storage errors.
    }
  }, [activeTableId, baseId, filterConnector, filterItems]);

  // -------------------------------------------------------------------------
  // Hidden-column filter cleanup
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (hiddenColumnIdSet.size === 0) return;
    setFilterItems((prev) => {
      let changed = false;

      const filterItem = (item: FilterItem): FilterItem | null => {
        if (item.type === "condition") {
          if (item.columnId && hiddenColumnIdSet.has(item.columnId)) {
            changed = true;
            return null;
          }
          return item;
        }

        const nextConditions: (FilterConditionItem | FilterGroupItem)[] =
          [];
        item.conditions.forEach((child) => {
          const filtered = filterItem(child);
          if (filtered) {
            nextConditions.push(filtered);
          }
        });

        if (nextConditions.length !== item.conditions.length) {
          changed = true;
        }

        if (nextConditions.length === 0) {
          changed = true;
          return null;
        }

        if (nextConditions.length === item.conditions.length) {
          return item;
        }

        return { ...item, conditions: nextConditions };
      };

      const next: FilterItem[] = [];
      prev.forEach((item) => {
        const filtered = filterItem(item);
        if (filtered) {
          next.push(filtered);
        }
      });

      return changed ? next : prev;
    });
  }, [hiddenColumnIdSet, setFilterItems]);

  // -------------------------------------------------------------------------
  // Close-on-click-outside effects
  // -------------------------------------------------------------------------

  // Highlighted filter clear on click
  useEffect(() => {
    if (
      !highlightedFilterFieldId &&
      !highlightedFilterOperatorId &&
      !highlightedFilterConnectorKey
    )
      return;
    const handleClick = () => {
      setHighlightedFilterFieldId(null);
      setHighlightedFilterOperatorId(null);
      setHighlightedFilterConnectorKey(null);
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [
    highlightedFilterFieldId,
    highlightedFilterOperatorId,
    highlightedFilterConnectorKey,
  ]);

  // Filter menu close on click outside
  useEffect(() => {
    if (!filterHook.isFilterMenuOpen) return;
    const handleClick = (event: Event) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (filterHook.filterMenuRef.current?.contains(target)) return;
      if (filterHook.filterButtonRef.current?.contains(target)) return;
      filterHook.setIsFilterMenuOpen(false);
      setOpenFilterFieldId(null);
      setOpenFilterOperatorId(null);
      setOpenFilterConnectorId(null);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        filterHook.setIsFilterMenuOpen(false);
        setOpenFilterFieldId(null);
        setOpenFilterOperatorId(null);
        setOpenFilterConnectorId(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("scroll", handleClick, true);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("scroll", handleClick, true);
      document.removeEventListener("keydown", handleKey);
    };
  }, [filterHook]);

  // Filter field menu close on click outside
  useEffect(() => {
    if (!openFilterFieldId) return;
    const handleClick = (event: Event) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (target instanceof Element) {
        if (
          target.closest(
            `[data-filter-field-menu="${openFilterFieldId}"]`
          )
        ) {
          return;
        }
        if (
          target.closest(
            `[data-filter-field-trigger="${openFilterFieldId}"]`
          )
        ) {
          return;
        }
      }
      setOpenFilterFieldId(null);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenFilterFieldId(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("scroll", handleClick, true);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("scroll", handleClick, true);
      document.removeEventListener("keydown", handleKey);
    };
  }, [openFilterFieldId]);

  // Filter operator menu close on click outside
  useEffect(() => {
    if (!openFilterOperatorId) return;
    const handleClick = (event: Event) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (target instanceof Element) {
        if (
          target.closest(
            `[data-filter-operator-menu="${openFilterOperatorId}"]`
          )
        ) {
          return;
        }
        if (
          target.closest(
            `[data-filter-operator-trigger="${openFilterOperatorId}"]`
          )
        ) {
          return;
        }
      }
      setOpenFilterOperatorId(null);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenFilterOperatorId(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("scroll", handleClick, true);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("scroll", handleClick, true);
      document.removeEventListener("keydown", handleKey);
    };
  }, [openFilterOperatorId]);

  // Filter connector menu close on click outside
  useEffect(() => {
    if (!openFilterConnectorId) return;
    const handleClick = (event: Event) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (target instanceof Element) {
        if (
          target.closest(
            `[data-filter-connector-menu="${openFilterConnectorId}"]`
          )
        ) {
          return;
        }
        if (
          target.closest(
            `[data-filter-connector-trigger="${openFilterConnectorId}"]`
          )
        ) {
          return;
        }
      }
      setOpenFilterConnectorId(null);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenFilterConnectorId(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("scroll", handleClick, true);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("scroll", handleClick, true);
      document.removeEventListener("keydown", handleKey);
    };
  }, [openFilterConnectorId]);

  // -------------------------------------------------------------------------
  // Filter field virtualizer
  // -------------------------------------------------------------------------
  const filterFieldVirtualizer = useVirtualizer({
    count: orderedColumns.length,
    getScrollElement: () => filterFieldMenuListRef.current,
    estimateSize: () => filterFieldMenuRowStride,
    overscan: 4,
  });

  const filterFieldVirtualItems = filterFieldVirtualizer.getVirtualItems();
  const filterFieldVirtualizerSize = filterFieldVirtualizer.getTotalSize();

  // -------------------------------------------------------------------------
  // handleFilterDragStart
  // -------------------------------------------------------------------------
  const handleFilterDragStart = (
    event: ReactMouseEvent,
    conditionId: string,
    scope: "root" | "group",
    groupId?: string
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (scope === "root" && hasFilterGroups) return;
    const containerRect =
      filterHook.filterMenuRef.current?.getBoundingClientRect();
    if (!containerRect) return;
    let list: FilterConditionItem[] = [];
    let listStartTop = filterFirstRowTop;
    if (scope === "root") {
      list = filterItems.filter(
        (item): item is FilterConditionItem => item.type === "condition"
      );
      listStartTop = filterFirstRowTop;
    } else if (groupId) {
      const group = filterItems.find(
        (item): item is FilterGroupItem =>
          item.type === "group" && item.id === groupId
      );
      if (!group) return;
      list = group.conditions.filter(
        (item): item is FilterConditionItem => item.type === "condition"
      );
      listStartTop =
        filterLayout.groupMetaMap.get(groupId)?.startTop ??
        filterFirstRowTop;
    }

    if (list.length < 2) return;
    const startIndex = list.findIndex(
      (condition) => condition.id === conditionId
    );
    if (startIndex < 0) return;
    const startTop = listStartTop + startIndex * filterRowStride;
    const initialOrder = list.map((condition) => condition.id);
    filterDragOffsetRef.current =
      event.clientY - (containerRect.top + startTop);
    filterDragScopeRef.current = {
      scope,
      groupId,
      startIndex,
      listStartTop,
      rowCount: list.length,
      order: initialOrder,
    };
    filterDragIndexRef.current = startIndex;
    setDraggingFilterId(conditionId);
    setDraggingFilterTop(startTop);
    setFilterDragPreview({ scope, groupId, order: initialOrder });
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";

    const handleMove = (moveEvent: MouseEvent) => {
      const ctx = filterDragScopeRef.current;
      if (!ctx) return;
      const maxTop =
        ctx.listStartTop + filterRowStride * (ctx.rowCount - 1);
      const nextTop = Math.min(
        maxTop,
        Math.max(
          ctx.listStartTop,
          moveEvent.clientY -
            containerRect.top -
            filterDragOffsetRef.current
        )
      );
      setDraggingFilterTop(nextTop);
      const targetIndex = Math.min(
        ctx.rowCount - 1,
        Math.max(
          0,
          Math.floor(
            (nextTop - ctx.listStartTop + filterRowHeight / 2) /
              filterRowStride
          )
        )
      );
      const currentIndex = filterDragIndexRef.current;
      if (targetIndex === currentIndex) return;
      const nextOrder = [...ctx.order];
      const [moved] = nextOrder.splice(currentIndex, 1);
      if (!moved) return;
      nextOrder.splice(targetIndex, 0, moved);
      ctx.order = nextOrder;
      filterDragIndexRef.current = targetIndex;
      setFilterDragPreview({
        scope: ctx.scope,
        groupId: ctx.groupId,
        order: nextOrder,
      });
    };

    const handleUp = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      const ctx = filterDragScopeRef.current;
      if (ctx && ctx.rowCount > 1) {
        const finalOrder = ctx.order;
        if (ctx.scope === "root") {
          setFilterItems((prev) => {
            if (prev.some((item) => item.type === "group")) return prev;
            const rootItems = prev.filter(
              (item): item is FilterConditionItem =>
                item.type === "condition"
            );
            if (rootItems.length < 2) return prev;
            const reordered: FilterItem[] = [];
            for (const cId of finalOrder) {
              const condition = rootItems.find((c) => c.id === cId);
              if (condition) reordered.push(condition);
            }
            return reordered;
          });
        } else if (ctx.groupId) {
          setFilterItems((prev) =>
            prev.map((item) => {
              if (item.type !== "group" || item.id !== ctx.groupId)
                return item;
              const groupConditions = item.conditions.filter(
                (child): child is FilterConditionItem =>
                  child.type === "condition"
              );
              if (groupConditions.length < 2) return item;
              const reordered: (
                | FilterConditionItem
                | FilterGroupItem
              )[] = [];
              for (const cId of finalOrder) {
                const condition = groupConditions.find(
                  (c) => c.id === cId
                );
                if (condition) reordered.push(condition);
              }
              // Add back any nested groups
              for (const child of item.conditions) {
                if (child.type === "group") reordered.push(child);
              }
              return { ...item, conditions: reordered };
            })
          );
        }
      }
      setDraggingFilterId(null);
      setDraggingFilterTop(null);
      filterDragScopeRef.current = null;
      setFilterDragPreview(null);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  };

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------
  return {
    // State
    activeFilterAdd,
    setActiveFilterAdd,
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
    highlightedFilterFieldId,
    setHighlightedFilterFieldId,
    highlightedFilterOperatorId,
    setHighlightedFilterOperatorId,
    highlightedFilterConnectorKey,
    setHighlightedFilterConnectorKey,
    phantomFilterX,
    phantomFilterY,
    openGroupPlusId,
    setOpenGroupPlusId,
    draggingGroupId,

    // Refs
    filterFieldMenuListRef,
    filterOperatorMenuListRef,

    // Layout constants
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

    // Group constants
    filterGroupEmptyWidth,
    filterGroupEmptyHeight,
    filterGroupPaddingTop,
    filterGroupPaddingBottom,
    filterGroupPaddingLeft,
    filterGroupWhereLeft,

    // Computed
    hasFilterItems,
    filterRows,
    filterLayout,
    filterFooterTop,

    // Callbacks
    updateFilterCondition,
    getDefaultFilterCondition,
    addFilterCondition,
    addFilterGroup,
    addFilterConditionToGroup,
    addFilterGroupToGroup,
    deleteFilterGroup,
    setGroupConnector,
    handleFilterFieldSelect,
    handleFilterOperatorSelect,
    handleFilterValueChange,
    handleFilterDragStart,

    // Virtualizer
    filterFieldVirtualItems,
    filterFieldVirtualizerSize,
  };
}
