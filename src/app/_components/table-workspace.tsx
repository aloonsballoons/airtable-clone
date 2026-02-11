"use client";

import clsx from "clsx";
import { Inter } from "next/font/google";
import { useRouter } from "next/navigation";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import arrowIcon from "~/assets/arrow.svg";
import assigneeIcon from "~/assets/assignee.svg";
import attachmentsIcon from "~/assets/attachments.svg";
import bellIcon from "~/assets/bell.svg";
import colourIcon from "~/assets/colour.svg";
import deleteIcon from "~/assets/delete.svg";
import filterIcon from "~/assets/filter.svg";
import gridViewIcon from "~/assets/grid-view.svg";
import groupIcon from "~/assets/group.svg";
import helpIcon from "~/assets/help.svg";
import hideFieldsIcon from "~/assets/hide fields.svg";
import launchIcon from "~/assets/launch.svg";
import longLineSelectionIcon from "~/assets/long-line-selection.svg";
import logoIcon from "~/assets/logo.svg";
import nameIcon from "~/assets/name.svg";
import notesIcon from "~/assets/notes.svg";
import numberIcon from "~/assets/number.svg";
import omniIcon from "~/assets/omni.svg";
import pinkIcon from "~/assets/pink.svg";
import refreshIcon from "~/assets/refresh.svg";
import reorderIcon from "~/assets/reorder.svg";
import rowHeightIcon from "~/assets/row-height.svg";
import shareSyncIcon from "~/assets/share-and-sync.svg";
import sortIcon from "~/assets/sort.svg";
import statusIcon from "~/assets/status.svg";
import toggleIcon from "~/assets/toggle.svg";
import xIcon from "~/assets/x.svg";
import { authClient } from "~/server/better-auth/client";
import { api, type RouterInputs } from "~/trpc/react";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const MAX_TABLES = 1000;
const MAX_COLUMNS = 500;
const MAX_ROWS = 2_000_000;
const BULK_ROWS = 100_000;
const PAGE_ROWS = 50;
const ROW_HEIGHT = 33;
const DEFAULT_COLUMN_WIDTH = 181;
const MIN_COLUMN_WIDTH = 120;
const MAX_COLUMN_WIDTH = 420;
const ADD_COLUMN_WIDTH = 93;
const LONG_TEXT_HEIGHT = 142;
const ADD_COLUMN_MENU_WIDTH = 400;
const ADD_COLUMN_OPTION_WIDTH = 380;
const MAX_NUMBER_DECIMALS = 8;
const STATUS_ICON_SCALE = 1.1;
const STATUS_MENU_ICON_SIZE = 15 * STATUS_ICON_SCALE;
const STATUS_HEADER_ICON_SIZE = 13 * STATUS_ICON_SCALE;

const REQUIRED_COLUMNS = ["Name", "Notes", "Assignee", "Status", "Attachments"];

const columnIconMap: Record<string, string> = {
  Name: nameIcon.src,
  Notes: notesIcon.src,
  Assignee: assigneeIcon.src,
  Status: statusIcon.src,
  Attachments: attachmentsIcon.src,
  Number: numberIcon.src,
};

type ColumnFieldType = "single_line_text" | "long_text" | "number";

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

const addColumnTypeOptions: Array<{
  type: ColumnFieldType;
  label: string;
  icon: { src: string; width: number; height: number; gap: number; paddingLeft: number };
}> = [
  {
    type: "single_line_text",
    label: "Single line text",
    icon: { src: nameIcon.src, width: 12, height: 12, gap: 10, paddingLeft: 8 },
  },
  {
    type: "long_text",
    label: "Long line text",
    icon: { src: notesIcon.src, width: 15, height: 13, gap: 8, paddingLeft: 7 },
  },
  {
    type: "number",
    label: "Number",
    icon: { src: numberIcon.src, width: 14, height: 14, gap: 9, paddingLeft: 7 },
  },
];

const imgEllipse2 =
  "https://www.figma.com/api/mcp/asset/220c0b55-a141-4008-8b9e-393c5dcc820b";
const imgEllipse3 =
  "https://www.figma.com/api/mcp/asset/42309589-dc81-48ef-80de-6483844e93cc";

type TableRow = Record<string, string> & { id: string };
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
  conditions: FilterConditionItem[];
};

type FilterItem = FilterConditionItem | FilterGroupItem;

type TableWorkspaceProps = {
  baseId: string;
  userName: string;
};

type ContextMenuState =
  | {
      type: "table" | "column" | "row";
      id: string;
      x: number;
      y: number;
    }
  | null;

type ColumnResizeState = {
  columnId: string;
  startX: number;
  startWidth: number;
};

const formatUserInitial = (name: string) => {
  const trimmed = name.trim();
  const chars = Array.from(trimmed);
  const first = chars[0] ?? "";
  if (!first) return "?";
  return /[a-zA-Z]/.test(first) ? first.toUpperCase() : first;
};

const normalizeSortDirection = (direction?: string | null): "asc" | "desc" =>
  direction === "desc" ? "desc" : "asc";

const normalizeSortList = (
  sort?: Array<{ columnId: string; direction?: string | null }> | null
): SortConfig[] | null => {
  if (!sort || sort.length === 0) return null;
  return sort.map((item) => ({
    columnId: item.columnId,
    direction: normalizeSortDirection(item.direction),
  }));
};

const areSortsEqual = (left: SortConfig[], right: SortConfig[]) => {
  if (left.length !== right.length) return false;
  return left.every(
    (item, index) =>
      item.columnId === right[index]?.columnId &&
      item.direction === right[index]?.direction
  );
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
  columnType: ColumnFieldType = "single_line_text"
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
  conditions: [createFilterCondition()],
});

export function TableWorkspace({ baseId, userName }: TableWorkspaceProps) {
  const router = useRouter();
  const utils = api.useUtils();
  const parentRef = useRef<HTMLDivElement>(null);

  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [resizing, setResizing] = useState<ColumnResizeState | null>(null);
  const [cellEdits, setCellEdits] = useState<Record<string, Record<string, string>>>(
    {}
  );
  const [ensuredTableId, setEnsuredTableId] = useState<string | null>(null);
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  const [hoveredHeaderId, setHoveredHeaderId] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<{
    rowId: string;
    columnId: string;
  } | null>(null);
  const [editingCell, setEditingCell] = useState<{
    rowId: string;
    columnId: string;
  } | null>(null);
  const [addRowHover, setAddRowHover] = useState(false);
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const [isAddColumnMenuOpen, setIsAddColumnMenuOpen] = useState(false);
  const [openSortDirectionId, setOpenSortDirectionId] = useState<string | null>(null);
  const [openSortFieldId, setOpenSortFieldId] = useState<string | null>(null);
  const [isAddSortMenuOpen, setIsAddSortMenuOpen] = useState(false);
  const [sortOrderOverride, setSortOrderOverride] = useState<SortConfig[] | null>(
    null
  );
  const [sortOverride, setSortOverride] = useState<SortConfig[] | null>(null);
  const [draggingSortId, setDraggingSortId] = useState<string | null>(null);
  const [draggingSortTop, setDraggingSortTop] = useState<number | null>(null);
  const [filterItems, setFilterItems] = useState<FilterItem[]>([]);
  const [filterConnector, setFilterConnector] = useState<FilterConnector>("and");
  const [activeFilterAdd, setActiveFilterAdd] = useState<"condition" | "group" | null>(
    null
  );
  const [openFilterFieldId, setOpenFilterFieldId] = useState<string | null>(null);
  const [openFilterOperatorId, setOpenFilterOperatorId] = useState<string | null>(
    null
  );
  const [openFilterConnectorId, setOpenFilterConnectorId] = useState<string | null>(
    null
  );
  const [focusedFilterValueId, setFocusedFilterValueId] = useState<string | null>(
    null
  );
  const [filterValueErrorId, setFilterValueErrorId] = useState<string | null>(null);
  const [draggingFilterId, setDraggingFilterId] = useState<string | null>(null);
  const [draggingFilterTop, setDraggingFilterTop] = useState<number | null>(null);
  const sortButtonRef = useRef<HTMLButtonElement>(null);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const sortFieldMenuRef = useRef<HTMLDivElement>(null);
  const filterFieldMenuListRef = useRef<HTMLDivElement>(null);
  const filterOperatorMenuListRef = useRef<HTMLDivElement>(null);
  const addColumnButtonRef = useRef<HTMLButtonElement>(null);
  const addColumnMenuRef = useRef<HTMLDivElement>(null);
  const sortAddMenuListRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef<
    Map<string, HTMLInputElement | HTMLTextAreaElement | null>
  >(new Map());
  const sortRowsRef = useRef<SortConfig[]>([]);
  const filterDragOffsetRef = useRef(0);
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
  const hasLoadedTableMetaRef = useRef(false);

  const baseDetailsQuery = api.base.get.useQuery({ baseId });
  useEffect(() => {
    utils.base.list.prefetch();
  }, [utils.base.list]);
  const tableMetaQuery = api.base.getTableMeta.useQuery(
    { tableId: activeTableId ?? "" },
    { enabled: Boolean(activeTableId) }
  );
  useEffect(() => {
    if (tableMetaQuery.data) {
      hasLoadedTableMetaRef.current = true;
    }
  }, [tableMetaQuery.data]);
  const rawSortConfig = tableMetaQuery.data?.sort ?? null;
  const sortConfigList: SortConfig[] = Array.isArray(rawSortConfig)
    ? rawSortConfig.map((item) => ({
        columnId: item.columnId,
        direction: normalizeSortDirection(item.direction),
      }))
    : [];
  const activeColumnIdSet = new Set(
    tableMetaQuery.data?.columns?.map((column) => column.id) ?? []
  );
  const activeTables = baseDetailsQuery.data?.tables ?? [];
  const activeTable = tableMetaQuery.data?.table ?? null;
  const activeColumns = tableMetaQuery.data?.columns ?? [];
  const activeRowCount = tableMetaQuery.data?.rowCount ?? 0;
  const columnById = useMemo(
    () => new Map(activeColumns.map((column) => [column.id, column])),
    [activeColumns]
  );
  const orderedColumns = useMemo(() => {
    const nameCol = activeColumns.find((column) => column.name === "Name");
    if (!nameCol) return activeColumns;
    return [
      nameCol,
      ...activeColumns.filter((column) => column.id !== nameCol.id),
    ];
  }, [activeColumns]);
  const filterInput: RouterInputs["base"]["getRows"]["filter"] = useMemo(() => {
    const items: Array<
      | { type: "condition"; columnId: string; operator: FilterOperator; value: string }
      | {
          type: "group";
          connector: FilterConnector;
          conditions: Array<{
            type: "condition";
            columnId: string;
            operator: FilterOperator;
            value: string;
          }>;
        }
    > = [];

    const normalizeCondition = (
      condition: FilterConditionItem
    ): { type: "condition"; columnId: string; operator: FilterOperator; value: string } | null => {
      if (!condition.columnId) return null;
      const column = columnById.get(condition.columnId);
      if (!column) return null;
      const columnType = coerceColumnType(column.type);
      const allowedOperators = getFilterOperatorsForType(columnType);
      if (!allowedOperators.includes(condition.operator)) return null;
      const trimmedValue = condition.value.trim();
      if (FILTER_OPERATOR_REQUIRES_VALUE.has(condition.operator) && !trimmedValue) {
        return null;
      }
      return {
        type: "condition",
        columnId: condition.columnId,
        operator: condition.operator,
        value: trimmedValue,
      };
    };

    filterItems.forEach((item) => {
      if (item.type === "condition") {
        const normalized = normalizeCondition(item);
        if (normalized) items.push(normalized);
        return;
      }
      const normalizedGroup = item.conditions
        .map(normalizeCondition)
        .filter(
          (condition): condition is {
            type: "condition";
            columnId: string;
            operator: FilterOperator;
            value: string;
          } => Boolean(condition)
        );
      if (normalizedGroup.length > 0) {
        items.push({
          type: "group",
          connector: item.connector,
          conditions: normalizedGroup,
        });
      }
    });

    if (items.length === 0) return undefined;
    return {
      connector: filterConnector,
      items,
    };
  }, [columnById, filterConnector, filterItems]);

  const activeFilterConditions = useMemo(() => {
    if (!filterInput) return [];
    return filterInput.items.flatMap((item) =>
      item.type === "condition" ? [item] : item.conditions
    );
  }, [filterInput]);

  const filteredColumnIds = useMemo(() => {
    const ids = new Set<string>();
    activeFilterConditions.forEach((condition) => ids.add(condition.columnId));
    return ids;
  }, [activeFilterConditions]);

  const filteredColumnNames = useMemo(() => {
    const names: string[] = [];
    const seen = new Set<string>();
    activeFilterConditions.forEach((condition) => {
      const column = columnById.get(condition.columnId);
      if (!column || seen.has(column.id)) return;
      seen.add(column.id);
      names.push(column.name);
    });
    return names;
  }, [activeFilterConditions, columnById]);
  const hasActiveFilters = activeFilterConditions.length > 0;
  const filterActiveSorts = (sorts: SortConfig[]) => {
    if (activeColumnIdSet.size === 0) return sorts;
    return sorts.filter((sort) => activeColumnIdSet.has(sort.columnId));
  };
  const sortParamSource = sortOverride ?? sortConfigList;
  const sortParam = filterActiveSorts(sortParamSource);
  const hasSort = sortParam.length > 0;
  const shouldIncludeSortInQuery =
    sortOverride !== null || hasLoadedTableMetaRef.current;
  const getRowsQueryKeyForSort = (
    tableId: string,
    sort: SortConfig[]
  ) => {
    const key: {
      tableId: string;
      limit: number;
      sort?: SortConfig[];
      filter?: RouterInputs["base"]["getRows"]["filter"];
    } = { tableId, limit: PAGE_ROWS };
    if (shouldIncludeSortInQuery) {
      key.sort = sort;
    }
    if (filterInput) {
      key.filter = filterInput;
    }
    return key;
  };
  const getRowsQueryKey = (tableId: string) =>
    getRowsQueryKeyForSort(tableId, sortParam);
  const rowsQuery = api.base.getRows.useInfiniteQuery(
    getRowsQueryKey(activeTableId ?? ""),
    {
      enabled: Boolean(activeTableId),
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    }
  );

  const addTable = api.base.addTable.useMutation({
    onSuccess: async (data) => {
      await utils.base.get.invalidate({ baseId });
      setActiveTableId(data.id);
    },
  });

  const deleteTable = api.base.deleteTable.useMutation({
    onSuccess: async () => {
      await utils.base.get.invalidate({ baseId });
      setActiveTableId(null);
    },
  });

  const deleteColumn = api.base.deleteColumn.useMutation({
    onSuccess: async () => {
      if (activeTableId) {
        await utils.base.getTableMeta.invalidate({ tableId: activeTableId });
        await utils.base.getRows.invalidate(getRowsQueryKey(activeTableId));
      }
    },
  });

  const addColumn = api.base.addColumn.useMutation({
    onMutate: async ({ tableId, name, id, type }) => {
      if (!activeTableId || tableId !== activeTableId || !id) {
        return { tableId, columnId: id ?? null, skipped: true };
      }
      await utils.base.getTableMeta.cancel({ tableId });
      const columnName = name ?? "Column";
      const columnType = type ?? "single_line_text";
      utils.base.getTableMeta.setData({ tableId }, (current) => {
        if (!current) return current;
        return {
          ...current,
          columns: [
            ...current.columns,
            { id, name: columnName, type: columnType },
          ],
        };
      });
      return { tableId, columnId: id, skipped: false };
    },
    onError: (_error, _variables, context) => {
      if (!context?.tableId || !context.columnId || context.skipped) return;
      utils.base.getTableMeta.setData({ tableId: context.tableId }, (current) => {
        if (!current) return current;
        return {
          ...current,
          columns: current.columns.filter((column) => column.id !== context.columnId),
        };
      });
    },
    onSuccess: async (_data, variables) => {
      if (variables.id) return;
      await utils.base.getTableMeta.invalidate({ tableId: variables.tableId });
    },
  });

  const addRows = api.base.addRows.useMutation({
    onMutate: async ({ tableId, count, ids }) => {
      if (!activeTableId || tableId !== activeTableId) {
        return { queryKey: null, tableId };
      }
      const queryKey = getRowsQueryKey(tableId);
      await utils.base.getRows.cancel(queryKey);

      if (ids?.length && !hasActiveFilters) {
        const optimisticRows = ids.map((id) => ({ id, data: {} }));
        utils.base.getRows.setInfiniteData(queryKey, (data) => {
          if (!data) return data;
          if (data.pages.length === 0) {
            return {
              ...data,
              pages: [{ rows: optimisticRows, nextCursor: null }],
            };
          }
          const pages = [...data.pages];
          if (sortParam[0]?.direction === "asc") {
            const firstPage = pages[0]!;
            pages[0] = {
              ...firstPage,
              rows: [...optimisticRows, ...firstPage.rows],
            };
          } else {
            const lastIndex = pages.length - 1;
            const lastPage = pages[lastIndex]!;
            pages[lastIndex] = {
              ...lastPage,
              rows: [...lastPage.rows, ...optimisticRows],
            };
          }
          return { ...data, pages };
        });
      }

      utils.base.getTableMeta.setData({ tableId }, (current) => {
        if (!current) return current;
        return { ...current, rowCount: current.rowCount + count };
      });

      return { queryKey, tableId };
    },
    onError: (_error, variables, context) => {
      if (context?.queryKey && variables.ids?.length) {
        const removeIds = new Set(variables.ids);
        utils.base.getRows.setInfiniteData(context.queryKey, (data) => {
          if (!data) return data;
          return {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              rows: page.rows.filter((row) => !removeIds.has(row.id)),
            })),
          };
        });
      }
      if (context?.tableId) {
        utils.base.getTableMeta.setData({ tableId: context.tableId }, (current) => {
          if (!current) return current;
          return {
            ...current,
            rowCount: Math.max(0, current.rowCount - variables.count),
          };
        });
      }
    },
    onSuccess: async (_data, variables) => {
      if (variables.ids?.length) return;
      await utils.base.getTableMeta.invalidate({ tableId: variables.tableId });
      await utils.base.getRows.invalidate(getRowsQueryKey(variables.tableId));
    },
  });

  const setTableSort = api.base.setTableSort.useMutation({
    onMutate: async ({ tableId, sort }) => {
      await utils.base.getTableMeta.cancel({ tableId });
      const previous = utils.base.getTableMeta.getData({ tableId });
      const previousSort = normalizeSortList(previous?.sort ?? null);
      const nextSort = sort ?? [];
      utils.base.getTableMeta.setData({ tableId }, (current) => {
        if (!current) return current;
        return {
          ...current,
          sort: nextSort.length ? nextSort : null,
        };
      });
      const nextKey = getRowsQueryKeyForSort(
        tableId,
        filterActiveSorts(normalizeSortList(nextSort) ?? [])
      );
      const prevKey = getRowsQueryKeyForSort(
        tableId,
        filterActiveSorts(previousSort ?? [])
      );
      const keysMatch = JSON.stringify(nextKey) === JSON.stringify(prevKey);
      await utils.base.getRows.invalidate(nextKey);
      if (!keysMatch) {
        await utils.base.getRows.invalidate(prevKey);
      }
      return { previous, previousSort, tableId };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        utils.base.getTableMeta.setData(
          { tableId: context.tableId },
          context.previous
        );
      }
      setSortOverride(context?.previousSort ?? null);
    },
    onSettled: async (_data, _error, variables, context) => {
      await utils.base.getTableMeta.invalidate({ tableId: variables.tableId });
      const nextSort = filterActiveSorts(
        normalizeSortList(variables.sort ?? null) ?? []
      );
      const previousSort = filterActiveSorts(
        normalizeSortList(context?.previousSort ?? null) ?? []
      );
      const nextKey = getRowsQueryKeyForSort(variables.tableId, nextSort);
      const prevKey = getRowsQueryKeyForSort(variables.tableId, previousSort);
      const keysMatch = JSON.stringify(nextKey) === JSON.stringify(prevKey);
      await utils.base.getRows.invalidate(nextKey);
      if (!keysMatch) {
        await utils.base.getRows.invalidate(prevKey);
      }
    },
  });

  const deleteRow = api.base.deleteRow.useMutation({
    onSuccess: async () => {
      if (activeTableId) {
        await utils.base.getTableMeta.invalidate({ tableId: activeTableId });
        await utils.base.getRows.invalidate(getRowsQueryKey(activeTableId));
      }
    },
  });

  const updateCell = api.base.updateCell.useMutation({
    onMutate: async ({ rowId, columnId, value }) => {
      if (!activeTableId) return { previous: null, queryKey: null };
      const queryKey = getRowsQueryKey(activeTableId);
      await utils.base.getRows.cancel(queryKey);
      const previous = utils.base.getRows.getInfiniteData(queryKey);
      utils.base.getRows.setInfiniteData(queryKey, (data) => {
        if (!data) return data;
        return {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            rows: page.rows.map((row) =>
              row.id === rowId
                ? {
                    ...row,
                    data: {
                      ...(row.data ?? {}),
                      [columnId]: value,
                    },
                  }
                : row
            ),
          })),
        };
      });
      return { previous, queryKey, rowId, columnId };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous && context.queryKey) {
        utils.base.getRows.setInfiniteData(context.queryKey, context.previous);
      }
    },
    onSuccess: (_data, variables) => {
      const shouldInvalidateSort =
        sortParam.length > 0 &&
        sortParam.some((sort) => sort.columnId === variables.columnId);
      const shouldInvalidateFilter =
        hasActiveFilters && filteredColumnIds.has(variables.columnId);
      if ((shouldInvalidateSort || shouldInvalidateFilter) && activeTableId) {
        void utils.base.getRows.invalidate(getRowsQueryKey(activeTableId));
      }
    },
  });

  useEffect(() => {
    setActiveTableId(null);
    setEnsuredTableId(null);
    setHoveredRowId(null);
    setHoveredHeaderId(null);
    setSelectedCell(null);
    setEditingCell(null);
    setSortOverride(null);
  }, [baseId]);

  useEffect(() => {
    const tables = baseDetailsQuery.data?.tables ?? [];
    if (!tables.length) return;
    if (activeTableId && tables.some((table) => table.id === activeTableId)) {
      return;
    }
    const firstTable = tables[0];
    if (!firstTable) return;
    setActiveTableId(firstTable.id);
  }, [activeTableId, baseDetailsQuery.data?.tables]);

  useEffect(() => {
    if (!activeTableId) return;
    parentRef.current?.scrollTo({ top: 0 });
  }, [activeTableId]);

  useEffect(() => {
    setCellEdits({});
  }, [activeTableId]);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
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
  }, [contextMenu]);

  useEffect(() => {
    if (!isSortMenuOpen) return;
    const handleClick = (event: Event) => {
      const target = event.target as Node | null;
      if (sortMenuRef.current?.contains(target)) return;
      if (sortButtonRef.current?.contains(target)) return;
      setIsSortMenuOpen(false);
      setOpenSortDirectionId(null);
      setOpenSortFieldId(null);
      setIsAddSortMenuOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSortMenuOpen(false);
        setOpenSortDirectionId(null);
        setOpenSortFieldId(null);
        setIsAddSortMenuOpen(false);
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
  }, [isSortMenuOpen]);

  useEffect(() => {
    if (!openSortFieldId) return;
    const handleClick = (event: Event) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (sortFieldMenuRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(".airtable-sort-field")) {
        return;
      }
      setOpenSortFieldId(null);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenSortFieldId(null);
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
  }, [openSortFieldId]);

  useEffect(() => {
    if (!isFilterMenuOpen) return;
    const handleClick = (event: Event) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (filterMenuRef.current?.contains(target)) return;
      if (filterButtonRef.current?.contains(target)) return;
      setIsFilterMenuOpen(false);
      setOpenFilterFieldId(null);
      setOpenFilterOperatorId(null);
      setOpenFilterConnectorId(null);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFilterMenuOpen(false);
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
  }, [isFilterMenuOpen]);

  useEffect(() => {
    if (!openFilterFieldId) return;
    const handleClick = (event: Event) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (target instanceof Element) {
        if (target.closest(`[data-filter-field-menu="${openFilterFieldId}"]`)) {
          return;
        }
        if (target.closest(`[data-filter-field-trigger="${openFilterFieldId}"]`)) {
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

  useEffect(() => {
    if (!openFilterOperatorId) return;
    const handleClick = (event: Event) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (target instanceof Element) {
        if (target.closest(`[data-filter-operator-menu="${openFilterOperatorId}"]`)) {
          return;
        }
        if (target.closest(`[data-filter-operator-trigger="${openFilterOperatorId}"]`)) {
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

  useEffect(() => {
    if (!openFilterConnectorId) return;
    const handleClick = (event: Event) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (target instanceof Element) {
        if (target.closest(`[data-filter-connector-menu="${openFilterConnectorId}"]`)) {
          return;
        }
        if (target.closest(`[data-filter-connector-trigger="${openFilterConnectorId}"]`)) {
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

  useEffect(() => {
    if (!isAddColumnMenuOpen) return;
    const handleClick = (event: Event) => {
      const target = event.target as Node | null;
      if (addColumnMenuRef.current?.contains(target)) return;
      if (addColumnButtonRef.current?.contains(target)) return;
      setIsAddColumnMenuOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsAddColumnMenuOpen(false);
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
  }, [isAddColumnMenuOpen]);

  const sortRows = sortOrderOverride ?? sortOverride ?? sortConfigList;
  const sortedColumnIds = useMemo(
    () => new Set(sortRows.map((sort) => sort.columnId)),
    [sortRows]
  );
  const [filterDragPreview, setFilterDragPreview] = useState<{
    scope: "root" | "group";
    groupId?: string;
    order: string[];
  } | null>(null);
  const filterRows = useMemo(() => {
    if (!filterDragPreview) return filterItems;
    if (filterDragPreview.scope === "root") {
      const rootItems = filterItems.filter(
        (item): item is FilterConditionItem => item.type === "condition"
      );
      if (rootItems.length !== filterDragPreview.order.length) return filterItems;
      const byId = new Map(rootItems.map((item) => [item.id, item]));
      return filterDragPreview.order
        .map((id) => byId.get(id))
        .filter((item): item is FilterConditionItem => Boolean(item));
    }
    if (filterDragPreview.groupId) {
      return filterItems.map((item) => {
        if (item.type !== "group" || item.id !== filterDragPreview.groupId) {
          return item;
        }
        const byId = new Map(
          item.conditions.map((condition) => [condition.id, condition])
        );
        const nextConditions = filterDragPreview.order
          .map((id) => byId.get(id))
          .filter((condition): condition is FilterConditionItem => Boolean(condition));
        if (nextConditions.length !== item.conditions.length) return item;
        return { ...item, conditions: nextConditions };
      });
    }
    return filterItems;
  }, [filterDragPreview, filterItems]);
  const hasFilterItems = filterItems.length > 0;
  const hasFilterGroups = useMemo(
    () => filterItems.some((item) => item.type === "group"),
    [filterItems]
  );
  const sortListHeight = 97 + activeColumns.length * 32;
  const sortFieldTop = 52;
  const sortFieldHeight = 28;
  const sortRowGap = 8;
  const sortRowStride = sortFieldHeight + sortRowGap;
  const sortRowsHeight =
    sortRows.length > 0
      ? sortRows.length * sortFieldHeight + (sortRows.length - 1) * sortRowGap
      : 0;
  const sortAddTop = sortFieldTop + sortRowsHeight + 18;
  const sortFooterTop = sortAddTop + 41;
  const sortFooterHeight = 42;
  const sortConfiguredHeight = sortFooterTop + sortFooterHeight;
  const sortFieldLeft = 20;
  const sortFieldWidth = 250;
  const sortDirectionLeft = 282;
  const sortDirectionWidth = 120;
  const sortRemoveSize = 28;
  const sortRemoveLeft = 422;
  const sortReorderLeft = sortRemoveLeft + sortRemoveSize + 17;
  const sortReorderWidth = 10;
  const sortConfiguredWidth = sortReorderLeft + sortReorderWidth + 20;
  const sortLineWidth = sortConfiguredWidth - 40;
  const sortFieldMenuWidth = 244;
  const sortFieldMenuPadding = 11.5;
  const sortFieldMenuHeaderGap = 15;
  const sortFieldMenuGap = 6;
  const sortFieldMenuRowHeight = 26;
  const sortFieldMenuFindHeight = 13;
  const sortFieldMenuFirstRowTop =
    sortFieldMenuPadding + sortFieldMenuFindHeight + sortFieldMenuHeaderGap;
  const sortAddMenuWidth = 432;
  const sortAddMenuHeaderTop = 10;
  const sortAddMenuHeaderHeight = 13;
  const sortAddMenuHeaderGap = 15;
  const sortAddMenuFirstRowTop =
    sortAddMenuHeaderTop + sortAddMenuHeaderHeight + sortAddMenuHeaderGap;
  const sortAddMenuRowHeight = 26;
  const sortAddMenuRowStride = 32;
  const sortAddMenuBottomPadding = 10;
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
  const filterDropdownWidth = hasFilterItems
    ? filterDropdownExpandedWidth
    : filterDropdownBaseWidth;
  const filterInputWidth = filterDropdownWidth - 32;

  const filterLayout = useMemo(() => {
    let currentTop = filterFirstRowTop;
    let rootIndex = 0;
    const rows: Array<{
      condition: FilterConditionItem;
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
    }> = [];
    const groupMetaMap = new Map<
      string,
      { startTop: number; bottomTop: number; rowCount: number }
    >();

    filterRows.forEach((item) => {
      if (item.type === "condition") {
        const showRootConnector = rootIndex > 0;
        rows.push({
          condition: item,
          top: currentTop,
          left: filterRowLeft,
          scope: "root",
          indexInScope: rootIndex,
          showConnector: showRootConnector,
          showConnectorControl: rootIndex === 1,
          connector: filterConnector,
          connectorKey: "root",
          showRootConnector,
          showGroupConnector: false,
        });
        currentTop += filterRowStride;
        rootIndex += 1;
        return;
      }

      const groupId = item.id;
      const groupStartTop = currentTop;
      const groupConnector = item.connector;
      item.conditions.forEach((condition, index) => {
        const showRootConnector = index === 0 && rootIndex > 0;
        const showGroupConnector = index > 0;
        const connector =
          showRootConnector ? filterConnector : groupConnector;
        const connectorKey = showRootConnector ? "root" : `group:${groupId}`;
        rows.push({
          condition,
          top: currentTop,
          left: filterRowLeft,
          scope: "group",
          groupId,
          indexInScope: index,
          showConnector: showRootConnector || showGroupConnector,
          showConnectorControl: showRootConnector
            ? rootIndex === 1
            : index === 1,
          connector,
          connectorKey,
          showRootConnector,
          showGroupConnector,
        });
        currentTop += filterRowStride;
      });
      const rowCount = item.conditions.length;
      const groupBottomTop =
        rowCount > 0
          ? groupStartTop + (rowCount - 1) * filterRowStride + filterRowHeight
          : groupStartTop;
      groupMetaMap.set(groupId, {
        startTop: groupStartTop,
        bottomTop: groupBottomTop,
        rowCount,
      });
      rootIndex += 1;
    });

    const rowCount = rows.length;
    const contentBottom =
      rowCount > 0
        ? filterFirstRowTop + (rowCount - 1) * filterRowStride + filterRowHeight
        : filterWhereTop;
    return {
      rows,
      contentBottom,
      groupMetaMap,
    };
  }, [filterConnector, filterRows]);

  const filterFooterTop = hasFilterItems
    ? filterLayout.contentBottom + filterFooterGap
    : 132;
  const filterDropdownHeight = hasFilterItems
    ? filterFooterTop + filterFooterHeight + filterBottomPadding
    : filterDropdownBaseHeight;
  const remainingSortColumns = orderedColumns.filter(
    (column) => !sortedColumnIds.has(column.id)
  );
  const filterFieldMenuWidth = 204;
  const filterFieldMenuMaxHeight = 277;
  const filterFieldMenuTopPadding = 20;
  const filterFieldMenuHeaderLeft = 20;
  const filterFieldMenuHeaderHeight = 13;
  const filterFieldMenuTextHeight = 13;
  const filterFieldMenuTextGap = 20; // 20px vertical distance between text lines
  const filterFieldMenuRowStride = filterFieldMenuTextHeight + filterFieldMenuTextGap; // 13 + 20 = 33px between text tops
  const filterFieldMenuRowHeight = 34; // Height of the hover box (visual only)
  const filterFieldMenuRowGap = 0;
  const filterFieldMenuHeaderGap = filterFieldMenuTextGap; // Same 20px gap from header to first item
  const filterFieldMenuBottomPadding = 20;
  const filterOperatorMenuBottomPadding = 0;
  const filterFieldMenuItemLeft = 20;
  const filterFieldMenuItemWidth = 164;
  const filterFieldMenuLabelLeft = 40;
  const filterFieldMenuHoverPadding = (filterFieldMenuRowHeight - filterFieldMenuTextHeight) / 2; // Extra space for hover box
  const filterFieldMenuFirstRowTop =
    filterFieldMenuTopPadding + filterFieldMenuHeaderHeight + filterFieldMenuHeaderGap;
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
  const filterOperatorMenuWidth = 186;
  const filterOperatorMenuMaxHeight = 260;
  const filterOperatorMenuTextHeight = 13;
  const filterOperatorMenuTextGap = 20; // 20px vertical distance between text lines
  const filterOperatorMenuRowStride = filterOperatorMenuTextHeight + filterOperatorMenuTextGap; // 13 + 20 = 33px
  const filterOperatorMenuRowHeight = 34; // Height of the hover box (visual only)
  const filterOperatorMenuRowGap = 0;
  const filterOperatorMenuItemWidth = 162;
  const filterOperatorMenuItemLeft = 12;
  const filterOperatorMenuHoverPadding = (filterOperatorMenuRowHeight - filterOperatorMenuTextHeight) / 2;
  const filterOperatorMenuFirstRowTop =
    filterFieldMenuTopPadding + filterFieldMenuHeaderHeight + filterFieldMenuHeaderGap;
  const sortAddMenuContentHeight =
    sortAddMenuFirstRowTop +
    (remainingSortColumns.length > 0
      ? (remainingSortColumns.length - 1) * sortAddMenuRowStride +
        sortAddMenuRowHeight
      : 0) +
    sortAddMenuBottomPadding;
  const sortAddMenuHeight = Math.min(256, sortAddMenuContentHeight);
  const sortAddMenuListHeight = Math.max(
    0,
    sortAddMenuHeight - sortAddMenuFirstRowTop - sortAddMenuBottomPadding
  );
  const canDeleteTable = activeTables.length > 1;
  const canDeleteColumn = activeColumns.length > 1;
  const canDeleteRow = activeRowCount > 1;
  const showContextMenu =
    contextMenu &&
    ((contextMenu.type === "table" && canDeleteTable) ||
      (contextMenu.type === "column" && canDeleteColumn) ||
      (contextMenu.type === "row" && canDeleteRow));

  const applySorts = useCallback(
    (next: SortConfig[] | null) => {
      if (!activeTableId) return;
      const normalizedNext = next && next.length > 0 ? next : null;
      setSortOverride(next ?? []);
      setTableSort.mutate({
        tableId: activeTableId,
        sort: normalizedNext,
      });
    },
    [activeTableId, setTableSort]
  );

  const updateFilterCondition = useCallback(
    (
      conditionId: string,
      updater: (condition: FilterConditionItem) => FilterConditionItem,
      groupId?: string
    ) => {
      setFilterItems((prev) =>
        prev.map((item) => {
          if (groupId) {
            if (item.type !== "group" || item.id !== groupId) return item;
            return {
              ...item,
              conditions: item.conditions.map((condition) =>
                condition.id === conditionId ? updater(condition) : condition
              ),
            };
          }
          if (item.type !== "condition") return item;
          return item.id === conditionId ? updater(item) : item;
        })
      );
    },
    []
  );

  const getDefaultFilterCondition = useCallback(() => {
    const defaultColumn = orderedColumns[0];
    if (!defaultColumn) return createFilterCondition();
    const columnType = coerceColumnType(defaultColumn.type);
    return createFilterCondition(defaultColumn.id, columnType);
  }, [orderedColumns]);

  const addFilterCondition = useCallback(() => {
    setFilterItems((prev) => [...prev, getDefaultFilterCondition()]);
    setActiveFilterAdd("condition");
  }, [getDefaultFilterCondition]);

  const addFilterGroup = useCallback(() => {
    setFilterItems((prev) => [
      ...prev,
      {
        ...createFilterGroup(),
        conditions: [getDefaultFilterCondition()],
      },
    ]);
    setActiveFilterAdd("group");
  }, [getDefaultFilterCondition]);

  const addFilterConditionToGroup = useCallback(
    (groupId: string) => {
      setFilterItems((prev) =>
        prev.map((item) => {
          if (item.type !== "group" || item.id !== groupId) return item;
          return {
            ...item,
            conditions: [...item.conditions, getDefaultFilterCondition()],
          };
        })
      );
    },
    [getDefaultFilterCondition]
  );

  const handleFilterFieldSelect = useCallback(
    (conditionId: string, columnId: string, groupId?: string) => {
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
        groupId
      );
      setOpenFilterFieldId(null);
      setOpenFilterOperatorId(null);
    },
    [columnById, updateFilterCondition]
  );

  const handleFilterOperatorSelect = useCallback(
    (conditionId: string, operator: FilterOperator, groupId?: string) => {
      updateFilterCondition(
        conditionId,
        (condition) => ({
          ...condition,
          operator,
        }),
        groupId
      );
      setOpenFilterOperatorId(null);
    },
    [updateFilterCondition]
  );

  const handleFilterValueChange = useCallback(
    (conditionId: string, value: string, groupId?: string) => {
      let isValid = true;
      const columnId = (() => {
        if (!groupId) {
          const condition = filterItems.find(
            (item): item is FilterConditionItem =>
              item.type === "condition" && item.id === conditionId
          );
          return condition?.columnId ?? null;
        }
        const group = filterItems.find(
          (item): item is FilterGroupItem => item.type === "group" && item.id === groupId
        );
        const condition = group?.conditions.find((item) => item.id === conditionId);
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
        groupId
      );
    },
    [columnById, filterItems, updateFilterCondition]
  );

  const getSortDirectionLabels = useCallback(
    (columnId: string) => {
      const column = columnById.get(columnId);
      const columnType = coerceColumnType(column?.type);
      const isNumber = columnType === "number";
      return {
        asc: isNumber ? "1 → 9" : "A → Z",
        desc: isNumber ? "9 → 1" : "Z → A",
      };
    },
    [columnById]
  );

  useEffect(() => {
    if (sortConfigList.length === 0) return;
    const activeIds = new Set(activeColumns.map((column) => column.id));
    const nextSorts = sortConfigList.filter((sort) =>
      activeIds.has(sort.columnId)
    );
    if (nextSorts.length !== sortConfigList.length) {
      applySorts(nextSorts.length ? nextSorts : null);
    }
  }, [activeColumns, applySorts, sortConfigList]);

  useEffect(() => {
    sortRowsRef.current = sortRows;
  }, [sortRows]);

  useEffect(() => {
    setFilterItems([]);
    setFilterConnector("and");
    setActiveFilterAdd(null);
    setIsFilterMenuOpen(false);
    setOpenFilterFieldId(null);
    setOpenFilterOperatorId(null);
    setOpenFilterConnectorId(null);
    setFocusedFilterValueId(null);
    setFilterValueErrorId(null);
  }, [activeTableId]);

  useEffect(() => {
    if (!sortOverride) return;
    if (setTableSort.isPending) return;
    if (areSortsEqual(sortOverride, sortConfigList)) {
      setSortOverride(null);
    }
  }, [sortConfigList, sortOverride, setTableSort.isPending]);


  useEffect(() => {
    if (!activeColumns.length || !activeTableId) return;
    if (ensuredTableId === activeTableId) return;
    const missing = REQUIRED_COLUMNS.filter(
      (name) => !activeColumns.some((column) => column.name === name)
    );
    if (missing.length === 0) {
      setEnsuredTableId(activeTableId);
      return;
    }
    missing.forEach((name) => {
      addColumn.mutate({
        tableId: activeTableId,
        name,
        id: crypto.randomUUID(),
      });
    });
    setEnsuredTableId(activeTableId);
  }, [activeColumns, activeTableId, addColumn, ensuredTableId]);

  useEffect(() => {
    if (!activeColumns.length) return;
    setColumnWidths((prev) => {
      const next = { ...prev };
      activeColumns.forEach((column) => {
        if (!next[column.id]) {
          next[column.id] = DEFAULT_COLUMN_WIDTH;
        }
      });
      Object.keys(next).forEach((columnId) => {
        if (!activeColumns.some((column) => column.id === columnId)) {
          delete next[columnId];
        }
      });
      return next;
    });
  }, [activeColumns]);

  useEffect(() => {
    if (!resizing) return;
    const handleMove = (event: MouseEvent) => {
      const delta = event.clientX - resizing.startX;
      const nextWidth = Math.min(
        MAX_COLUMN_WIDTH,
        Math.max(MIN_COLUMN_WIDTH, resizing.startWidth + delta)
      );
      setColumnWidths((prev) => ({
        ...prev,
        [resizing.columnId]: nextWidth,
      }));
    };
    const handleUp = () => setResizing(null);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [resizing]);

  const rows = useMemo(() => {
    const pages = rowsQuery.data?.pages ?? [];
    const seen = new Map<string, (typeof pages)[number]["rows"][number]>();
    const ordered: (typeof pages)[number]["rows"][number][] = [];
    pages.forEach((page) => {
      page.rows.forEach((row) => {
        if (!seen.has(row.id)) {
          seen.set(row.id, row);
          ordered.push(row);
        }
      });
    });
    return ordered;
  }, [rowsQuery.data?.pages]);

  const columnOrder = useMemo(
    () => orderedColumns.map((column) => column.id),
    [orderedColumns]
  );

  const tableData = useMemo<TableRow[]>(() => {
    if (!activeTable) return [];
    return rows.map((row) => {
      const data = row.data ?? {};
      const cells = Object.fromEntries(
        orderedColumns.map((column) => [column.id, data[column.id] ?? ""])
      );
      return { id: row.id, ...cells };
    });
  }, [activeTable, orderedColumns, rows]);

  const sortedTableData = useMemo(() => tableData, [tableData]);

  const rowOrder = useMemo(
    () => sortedTableData.map((row) => row.id),
    [sortedTableData]
  );

  const columnsWithAdd = useMemo(
    () => [
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
    [columnWidths, orderedColumns]
  );

  const totalColumnsWidth = useMemo(
    () => columnsWithAdd.reduce((sum, column) => sum + column.width, 0),
    [columnsWithAdd]
  );
  const addColumnWidth = useMemo(
    () => columnsWithAdd.find((column) => column.type === "add")?.width ?? ADD_COLUMN_WIDTH,
    [columnsWithAdd]
  );
  const dataColumnsWidth = Math.max(0, totalColumnsWidth - addColumnWidth);

  const rowCount = sortedTableData.length;

  const rowVirtualizer = useVirtualizer({
    count: rowsQuery.hasNextPage ? rowCount + 1 : rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: columnsWithAdd.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => columnsWithAdd[index]?.width ?? DEFAULT_COLUMN_WIDTH,
    overscan: 2,
    getItemKey: (index) => columnsWithAdd[index]?.id ?? index,
  });

  const sortAddVirtualizer = useVirtualizer({
    count: remainingSortColumns.length,
    getScrollElement: () => sortAddMenuListRef.current,
    estimateSize: () => sortAddMenuRowStride,
    overscan: 4,
  });

  const sortAddVirtualItems = sortAddVirtualizer.getVirtualItems();
  const sortAddVirtualizerSize = Math.max(
    0,
    sortAddVirtualizer.getTotalSize() -
      (remainingSortColumns.length > 0
        ? sortAddMenuRowStride - sortAddMenuRowHeight
        : 0)
  );

  const filterFieldVirtualizer = useVirtualizer({
    count: orderedColumns.length,
    getScrollElement: () => filterFieldMenuListRef.current,
    estimateSize: () => filterFieldMenuRowStride,
    overscan: 4,
  });

  const filterFieldVirtualItems = filterFieldVirtualizer.getVirtualItems();
  const filterFieldVirtualizerSize =
    filterFieldVirtualizer.getTotalSize();

  const virtualColumns = columnVirtualizer.getVirtualItems();
  const nameColumnIndex = columnsWithAdd.findIndex(
    (column) => column.type === "data" && column.name === "Name"
  );
  const nameColumn = nameColumnIndex >= 0 ? columnsWithAdd[nameColumnIndex] : null;
  const nameColumnWidth = nameColumn?.width ?? 0;
  const scrollableVirtualColumns = nameColumn
    ? virtualColumns.filter((virtualColumn) => virtualColumn.index !== nameColumnIndex)
    : virtualColumns;
  const scrollablePaddingLeft = nameColumn
    ? Math.max(0, (scrollableVirtualColumns[0]?.start ?? nameColumnWidth) - nameColumnWidth)
    : virtualColumns[0]?.start ?? 0;
  const totalScrollableWidth = Math.max(0, totalColumnsWidth - nameColumnWidth);
  const lastScrollableEnd = nameColumn
    ? Math.max(
        0,
        (scrollableVirtualColumns.at(-1)?.end ?? nameColumnWidth) - nameColumnWidth
      )
    : virtualColumns.at(-1)?.end ?? 0;
  const scrollablePaddingRight = Math.max(0, totalScrollableWidth - lastScrollableEnd);

  useEffect(() => {
    columnVirtualizer.measure();
  }, [columnVirtualizer, columnWidths, columnsWithAdd.length]);

  const lastFocusedRef = useRef<{ key: string; mode: "select" | "edit" } | null>(
    null
  );
  const focusTokenRef = useRef(0);

  useEffect(() => {
    const focusTarget = editingCell ?? selectedCell;
    if (!focusTarget) {
      lastFocusedRef.current = null;
      return;
    }
    if (
      isFilterMenuOpen &&
      document.activeElement &&
      filterMenuRef.current?.contains(document.activeElement)
    ) {
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
  }, [editingCell, isFilterMenuOpen, selectedCell, virtualItems, virtualColumns]);

  useEffect(() => {
    const lastItem = virtualItems[virtualItems.length - 1];
    if (!lastItem) return;
    if (
      lastItem.index >= rowCount - 1 &&
      rowsQuery.hasNextPage &&
      !rowsQuery.isFetchingNextPage
    ) {
      rowsQuery.fetchNextPage();
    }
  }, [rowCount, rowsQuery, rowsQuery.hasNextPage, rowsQuery.isFetchingNextPage, virtualItems]);

  const handleAddTable = () => {
    addTable.mutate({ baseId });
  };

  const handleSelectTable = (tableId: string) => {
    setActiveTableId(tableId);
  };

  const handleDeleteTable = (tableId: string) => {
    deleteTable.mutate({ tableId });
    setContextMenu(null);
  };

  const handleDeleteColumn = (columnId: string) => {
    deleteColumn.mutate({ columnId });
    setContextMenu(null);
  };

  const handleAddColumn = (type: ColumnFieldType = "single_line_text") => {
    if (!activeTableId) return;
    const nextIndex = activeColumns.length + 1;
    addColumn.mutate({
      tableId: activeTableId,
      name: `Column ${nextIndex}`,
      id: crypto.randomUUID(),
      type,
    });
    setIsAddColumnMenuOpen(false);
  };

  const handleAddRow = () => {
    if (!activeTableId) return;
    addRows.mutate({
      tableId: activeTableId,
      count: 1,
      ids: [crypto.randomUUID()],
    });
  };

  const handleAddBulkRows = () => {
    if (!activeTableId) return;
    addRows.mutate({ tableId: activeTableId, count: BULK_ROWS });
  };

  const handleDeleteRow = (rowId: string) => {
    deleteRow.mutate({ rowId });
    setContextMenu(null);
  };

  const handleSignOut = async () => {
    await authClient.signOut();
    router.refresh();
  };

  const handleOpenContextMenu = (
    event: ReactMouseEvent,
    type: "table" | "column" | "row",
    id: string,
    allowed: boolean
  ) => {
    event.preventDefault();
    if (!allowed) {
      setContextMenu(null);
      return;
    }
    setContextMenu({ type, id, x: event.clientX, y: event.clientY });
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

  const handleSortDragStart = (event: ReactMouseEvent, columnId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const containerRect = sortMenuRef.current?.getBoundingClientRect();
    if (!containerRect) return;
    const currentOrder = sortRowsRef.current;
    const startIndex = currentOrder.findIndex(
      (sort) => sort.columnId === columnId
    );
    if (startIndex < 0) return;
    const startTop = sortFieldTop + startIndex * sortRowStride;
    dragOffsetRef.current = event.clientY - (containerRect.top + startTop);
    dragIndexRef.current = startIndex;
    setSortOrderOverride(currentOrder);
    setDraggingSortId(columnId);
    setDraggingSortTop(startTop);
    setOpenSortDirectionId(null);
    setOpenSortFieldId(null);
    setIsAddSortMenuOpen(false);
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";

    const handleMove = (moveEvent: MouseEvent) => {
      const order = sortRowsRef.current;
      if (order.length === 0) return;
      const maxTop = sortFieldTop + sortRowStride * (order.length - 1);
      const nextTop = Math.min(
        maxTop,
        Math.max(
          sortFieldTop,
          moveEvent.clientY - containerRect.top - dragOffsetRef.current
        )
      );
      setDraggingSortTop(nextTop);
      const targetIndex = Math.min(
        order.length - 1,
        Math.max(
          0,
          Math.floor((nextTop - sortFieldTop + sortFieldHeight / 2) / sortRowStride)
        )
      );
      const fromIndex = dragIndexRef.current;
      if (targetIndex === fromIndex) return;
      const nextOrder = [...order];
      const [moved] = nextOrder.splice(fromIndex, 1);
      if (!moved) return;
      nextOrder.splice(targetIndex, 0, moved);
      sortRowsRef.current = nextOrder;
      dragIndexRef.current = targetIndex;
      setSortOrderOverride(nextOrder);
    };

    const handleUp = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      const finalOrder = sortRowsRef.current;
      if (!areSortsEqual(finalOrder, sortConfigList)) {
        applySorts(finalOrder.length ? finalOrder : null);
      }
      setDraggingSortId(null);
      setDraggingSortTop(null);
      setSortOrderOverride(null);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  };

  const handleFilterDragStart = (
    event: ReactMouseEvent,
    conditionId: string,
    scope: "root" | "group",
    groupId?: string
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (scope === "root" && hasFilterGroups) return;
    const containerRect = filterMenuRef.current?.getBoundingClientRect();
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
        (item): item is FilterGroupItem => item.type === "group" && item.id === groupId
      );
      if (!group) return;
      list = group.conditions;
      listStartTop =
        filterLayout.groupMetaMap.get(groupId)?.startTop ?? filterFirstRowTop;
    }

    if (list.length < 2) return;
    const startIndex = list.findIndex((condition) => condition.id === conditionId);
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
      const maxTop = ctx.listStartTop + filterRowStride * (ctx.rowCount - 1);
      const nextTop = Math.min(
        maxTop,
        Math.max(
          ctx.listStartTop,
          moveEvent.clientY - containerRect.top - filterDragOffsetRef.current
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
              (item): item is FilterConditionItem => item.type === "condition"
            );
            if (rootItems.length < 2) return prev;
            const byId = new Map(rootItems.map((item) => [item.id, item]));
            const nextRoot = finalOrder
              .map((id) => byId.get(id))
              .filter((item): item is FilterConditionItem => Boolean(item));
            return nextRoot.length === rootItems.length ? nextRoot : prev;
          });
        } else if (ctx.groupId) {
          setFilterItems((prev) =>
            prev.map((item) => {
              if (item.type !== "group" || item.id !== ctx.groupId) return item;
              if (item.conditions.length < 2) return item;
              const byId = new Map(
                item.conditions.map((condition) => [condition.id, condition])
              );
              const nextConditions = finalOrder
                .map((id) => byId.get(id))
                .filter(
                  (condition): condition is FilterConditionItem => Boolean(condition)
                );
              return nextConditions.length === item.conditions.length
                ? { ...item, conditions: nextConditions }
                : item;
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

  const setCellEditValue = (rowId: string, columnId: string, value: string) => {
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
    updateCell.mutate({ rowId, columnId, value });
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

  const handleCellChange = (rowId: string, columnId: string, value: string) => {
    setCellEditValue(rowId, columnId, value);
  };

  const handleCellCommit = (
    rowId: string,
    columnId: string,
    value: string
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
    event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>
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
    currentValue: string
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

      if (isPrintableKey(event) || event.key === "Backspace" || event.key === "Delete") {
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

  const bulkRowsDisabled =
    !activeTableId || addRows.isPending || activeRowCount + BULK_ROWS > MAX_ROWS;
  const addRowDisabled =
    !activeTableId || activeRowCount >= MAX_ROWS;

  const baseName = baseDetailsQuery.data?.name ?? "Base";
  const userInitial = formatUserInitial(userName);

  const headerCellBorder = (
    column: { name: string; type: "data" | "add" },
    isFirst: boolean
  ) => ({
    borderTop: "none",
    borderBottom: "0.5px solid #CBCBCB",
    borderRight:
      column.type === "data" && column.name === "Name"
        ? "none"
        : "0.5px solid #DDE1E3",
    borderLeft: "none",
  });

  const bodyCellBorder = (
    column: { name: string; type: "data" | "add" },
    isFirst: boolean,
    isLastRow: boolean
  ) => ({
    borderBottom: isLastRow ? "none" : "0.5px solid #DDE1E3",
    borderRight:
      column.type === "data" && column.name === "Name"
        ? "none"
        : "0.5px solid #DDE1E3",
    borderLeft: "none",
  });

  return (
    <div className={clsx("h-screen overflow-hidden bg-white text-[#1d1f24]", inter.className)}>
      <div className="flex h-screen overflow-hidden">
        <aside className="relative flex w-[56px] flex-shrink-0 flex-col items-center border-r border-[#E5E5E5] bg-white py-4">
          <button
            type="button"
            onClick={() => router.push("/bases")}
            className="cursor-pointer"
            aria-label="Back to bases"
          >
            <img
              alt="Airtable"
              className="h-[19.74px] w-[22.68px]"
              src={logoIcon.src}
              style={{ filter: "brightness(0) saturate(100%)" }}
            />
          </button>
          <img
            alt=""
            className="mt-[25px] h-[28.31px] w-[28.33px]"
            src={omniIcon.src}
          />
          <div className="absolute bottom-4 left-0 right-0 flex flex-col items-center gap-4">
            <img alt="" className="h-[15px] w-[15px]" src={helpIcon.src} />
            <img alt="" className="h-[16px] w-[16px]" src={bellIcon.src} />
            <button
              type="button"
              onClick={handleSignOut}
              className="airtable-circle relative overflow-hidden"
              aria-label="Sign out"
            >
              <img
                alt=""
                className="absolute inset-0 m-auto h-[29px] w-[29px]"
                src={imgEllipse2}
              />
              <img
                alt=""
                className="absolute inset-0 m-auto h-[26px] w-[26px]"
                src={imgEllipse3}
              />
              <span className="relative text-[13px] text-white">{userInitial}</span>
            </button>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <header className="border-b border-[#DDE1E3] bg-white">
            <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
              <div className="flex items-center gap-3">
                <div className="flex h-[32px] w-[32px] items-center justify-center rounded-[6px] bg-[#8c3f78]">
                  <img
                    alt=""
                    className="h-[19.74px] w-[22.68px]"
                    src={logoIcon.src}
                    style={{ filter: "brightness(0) saturate(100%) invert(1)" }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => router.push("/bases")}
                  className="flex items-center gap-2 text-[16px] font-semibold text-[#1d1f24]"
                >
                  <span>{baseName}</span>
                  <span className="airtable-nav-chevron rotate-90 text-[#1d1f24]" />
                </button>
              </div>

              <nav className="ml-[118px] flex flex-wrap items-center gap-5 airtable-secondary-font">
                <button type="button" className="relative text-[#1d1f24]">
                  Data
                  <span className="absolute -bottom-[19px] left-1/2 h-[2px] w-[28.5px] -translate-x-1/2 bg-[#8c3f78]" />
                </button>
                <button type="button">Automations</button>
                <button type="button">Interfaces</button>
                <button type="button">Forms</button>
              </nav>

              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="flex items-center" aria-label="Refresh">
                  <img alt="" className="h-[14px] w-[14px]" src={refreshIcon.src} />
                </button>
                <button
                  type="button"
                  className="flex h-[32px] w-[126px] items-center justify-center rounded-[6px] bg-[#F2F2F2] text-[13px] text-[#1d1f24]"
                >
                  Trial: 14 days left
                </button>
                <button
                  type="button"
                  className="flex h-[32px] items-center gap-2 rounded-[6px] border border-[#DDE1E3] bg-white px-3 text-[13px] text-[#1d1f24]"
                >
                  <img alt="" className="h-[14px] w-[14px]" src={launchIcon.src} />
                  Launch
                </button>
                <button
                  type="button"
                  className="h-[32px] rounded-[6px] bg-[#8c3f78] px-4 text-[13px] font-medium text-white"
                >
                  Share
                </button>
              </div>
            </div>
          </header>

          <section className="border-b border-[#DDE1E3] bg-white px-4 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                {activeTables.map((tableItem) => (
                  <button
                    key={tableItem.id}
                    type="button"
                    onClick={() => handleSelectTable(tableItem.id)}
                    onContextMenu={(event) =>
                      handleOpenContextMenu(event, "table", tableItem.id, canDeleteTable)
                    }
                    className={clsx(
                      "flex items-center gap-2 rounded-[6px] border px-3 py-1 text-[13px]",
                      tableItem.id === activeTableId
                        ? "border-[#1d1f24] text-[#1d1f24]"
                        : "border-[#DDE1E3] airtable-secondary-font"
                    )}
                  >
                    {tableItem.name}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={handleAddTable}
                  disabled={activeTables.length >= MAX_TABLES || addTable.isPending}
                  className={clsx(
                    "rounded-[6px] border px-3 py-1 text-[13px]",
                    activeTables.length >= MAX_TABLES
                      ? "cursor-not-allowed border-[#E2E8F0] bg-[#F8FAFC] text-[#94A3B8]"
                      : "border-[#DDE1E3] text-[#1d1f24]"
                  )}
                >
                  {addTable.isPending ? "Adding..." : "+ Add table"}
                </button>
              </div>
              <button type="button" className="flex items-center gap-2 text-[13px] text-[#595459]">
                Tools
                <span className="airtable-nav-chevron rotate-90 text-[#595459]" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-4 pb-0 airtable-secondary-font-regular">
              <button type="button" className="flex items-center gap-2">
                <img alt="" className="h-[14px] w-[14px]" src={gridViewIcon.src} />
                Grid view
              </button>
              <div className="ml-auto flex flex-wrap items-center gap-4">
                <button type="button" className="flex items-center gap-2">
                  <img alt="" className="h-[14px] w-[14px]" src={hideFieldsIcon.src} />
                  Hide fields
                </button>
                <div className="relative">
                  <button
                    ref={filterButtonRef}
                    type="button"
                    className={clsx(
                      "airtable-table-feature-selection gap-2 font-normal",
                      hasActiveFilters &&
                        "airtable-table-feature-selection--filter-active text-[#1d1f24]"
                    )}
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
                    <img
                      alt=""
                      className={clsx(
                        "h-[14px] w-[14px]",
                        hasActiveFilters && "airtable-filter-icon--active"
                      )}
                      src={filterIcon.src}
                    />
                    <span>
                      {hasActiveFilters
                        ? `Filtered by ${filteredColumnNames.join(", ")}`
                        : "Filter"}
                    </span>
                  </button>
                  {isFilterMenuOpen && (
                    <div
                      ref={filterMenuRef}
                      className="airtable-filter-dropdown airtable-dropdown-surface absolute right-[-8px] top-[calc(100%+4px)] z-50"
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
                            {filterLayout.rows.map((row) => {
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
                              const isNumber = columnType === "number";
                              const isFocused = focusedFilterValueId === row.condition.id;
                              const hasError = filterValueErrorId === row.condition.id;
                              const connectorLabel = row.connector;
                              const showConnectorControl = row.showConnectorControl;
                              const connectorKey = row.connectorKey;
                              const isConnectorOpen = openFilterConnectorId === connectorKey;
                              const fieldValue = row.condition.value;
                              const scopeGroupId = row.scope === "group" ? row.groupId : undefined;
                              const isDraggingRow = draggingFilterId === row.condition.id;
                              const dragOffset =
                                isDraggingRow && draggingFilterTop !== null
                                  ? draggingFilterTop - row.top
                                  : 0;
                              const fieldTop =
                                (filterRowHeight - filterFieldHeight) / 2 + dragOffset;
                              const fieldMenuTop = fieldTop + filterFieldHeight + 2;
                              const operatorMenuTop = fieldMenuTop;
                              const rowZIndex = isOperatorMenuOpen
                                ? 40
                                : isDraggingRow
                                ? 30
                                : isFieldMenuOpen || isConnectorOpen
                                ? 25
                                : 10;
                              const hideConnectorControl =
                                showConnectorControl && isDraggingRow;
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
                                    transition: isDraggingRow ? "none" : "top 0.15s ease",
                                    overflow: "visible",
                                  }}
                                >
                                  {row.showConnector && !hideConnectorControl && (
                                    <>
                                      {showConnectorControl ? (
                                        <button
                                          type="button"
                                          className="absolute flex items-center rounded-[2px] border border-[#E4E4E4] text-[13px] font-normal text-[#1D1F24] hover:bg-[#F2F2F2] cursor-pointer"
                                          style={{
                                            width: filterConnectorWidth,
                                            height: filterConnectorHeight,
                                            left: 0,
                                            top: 0,
                                            paddingLeft: 8,
                                          }}
                                          onClick={() =>
                                            setOpenFilterConnectorId((prev) =>
                                              prev === connectorKey ? null : connectorKey
                                            )
                                          }
                                          data-filter-connector-trigger={connectorKey}
                                        >
                                          <span>{connectorLabel}</span>
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
                                            zIndex: 1000,
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
                                                } else if (row.groupId) {
                                                  setFilterItems((prev) =>
                                                    prev.map((item) =>
                                                      item.type === "group" &&
                                                      item.id === row.groupId
                                                        ? { ...item, connector }
                                                        : item
                                                    )
                                                  );
                                                }
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
                                      <span className="text-[13px] font-normal text-[#1D1F24]">
                                        {column?.name ?? "Name"}
                                      </span>
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
                                          zIndex: 1000,
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
                                                      scopeGroupId
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
                                      <span className="text-[13px] font-normal text-[#1D1F24]">
                                        {operatorLabel}
                                      </span>
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
                                            zIndex: 3000,
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
                                                      scopeGroupId
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
                                        paddingLeft: 9,
                                        paddingRight: 9,
                                        cursor: "text",
                                      }}
                                    >
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
                                            scopeGroupId
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
                                            prev.filter(
                                              (item) =>
                                                item.type !== "condition" ||
                                                item.id !== row.condition.id
                                            )
                                          );
                                        } else if (row.groupId) {
                                          setFilterItems((prev) =>
                                            prev.flatMap((item) => {
                                              if (
                                                item.type !== "group" ||
                                                item.id !== row.groupId
                                              ) {
                                                return [item];
                                              }
                                              const nextConditions = item.conditions.filter(
                                                (condition) =>
                                                  condition.id !== row.condition.id
                                              );
                                              if (nextConditions.length === 0) return [];
                                              return [{ ...item, conditions: nextConditions }];
                                            })
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
                    </div>
                  )}
                </div>
                <button type="button" className="flex items-center gap-2">
                  <img alt="" className="h-[14px] w-[14px]" src={groupIcon.src} />
                  Group
                </button>
                <div className="relative">
                  <button
                    ref={sortButtonRef}
                    type="button"
                    className={clsx(
                      "airtable-table-feature-selection gap-2 font-normal",
                      hasSort &&
                        "airtable-table-feature-selection--active text-[#1d1f24]"
                    )}
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
                    <span className="relative inline-flex h-[14px] w-[14px]">
                      <img
                        alt=""
                        className={clsx(
                          "h-[14px] w-[14px]",
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
                    <span>
                      {hasSort
                        ? `Sorted by ${sortRows.length} ${
                            sortRows.length === 1 ? "field" : "fields"
                          }`
                        : "Sort"}
                    </span>
                  </button>
                  {isSortMenuOpen && (
                    <div
                      ref={sortMenuRef}
                      className="airtable-sort-dropdown airtable-dropdown-surface absolute right-[-8px] top-[calc(100%+4px)] z-50"
                      style={{
                        width: hasSort ? sortConfiguredWidth : 320,
                        height: hasSort ? sortConfiguredHeight : sortListHeight,
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
                          style={{ width: hasSort ? sortLineWidth : 280 }}
                        />
                        {hasSort ? (
                          <>
                            {sortRows.map((sortItem, index) => {
                              const rowTop = sortFieldTop + index * sortRowStride;
                              const isDragging = draggingSortId === sortItem.columnId;
                              const displayTop =
                                isDragging && draggingSortTop !== null ? draggingSortTop : rowTop;
                              const fieldMenuColumns = orderedColumns.filter(
                                (column) =>
                                  column.id === sortItem.columnId ||
                                  !sortedColumnIds.has(column.id)
                              );
                              const fieldMenuHeight =
                                sortFieldMenuFirstRowTop +
                                Math.max(0, fieldMenuColumns.length - 1) *
                                  (sortFieldMenuRowHeight + sortFieldMenuGap) +
                                (fieldMenuColumns.length > 0
                                  ? sortFieldMenuRowHeight
                                  : 0) +
                                sortFieldMenuPadding;
                              const directionLabels = getSortDirectionLabels(
                                sortItem.columnId
                              );
                              const removeTop = (sortFieldHeight - sortRemoveSize) / 2;
                              const reorderTop = (sortFieldHeight - 13) / 2;
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
                                    height: sortFieldHeight,
                                    zIndex: shouldElevateRow ? 30 : 0,
                                    transition: isDragging ? "none" : "top 0.15s ease",
                                  }}
                                >
                                  <button
                                    type="button"
                                    className="airtable-sort-field absolute"
                                    style={{ left: sortFieldLeft, width: sortFieldWidth }}
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
                                        left: sortFieldLeft,
                                        top: sortFieldHeight + 1,
                                        width: sortFieldMenuWidth,
                                        height: fieldMenuHeight,
                                      }}
                                    >
                                      <div
                                        className="absolute text-[13px] font-normal text-[#757575]"
                                        style={{ left: 9, top: sortFieldMenuPadding }}
                                      >
                                        Find a field
                                      </div>
                                      {fieldMenuColumns.map((column, itemIndex) => {
                                        const itemTop =
                                          sortFieldMenuFirstRowTop +
                                          itemIndex *
                                            (sortFieldMenuRowHeight + sortFieldMenuGap);
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
                                      left: sortDirectionLeft,
                                      width: sortDirectionWidth,
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
                                        left: sortDirectionLeft,
                                        top: sortFieldHeight + 1,
                                        width: sortDirectionWidth,
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
                                    style={{ left: sortRemoveLeft, top: removeTop }}
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
                                    style={{ left: sortReorderLeft, top: reorderTop }}
                                    onMouseDown={(event) =>
                                      handleSortDragStart(event, sortItem.columnId)
                                    }
                                    aria-label="Reorder sort"
                                  >
                                    <img
                                      alt=""
                                      style={{ width: sortReorderWidth, height: 13 }}
                                      src={reorderIcon.src}
                                    />
                                  </button>
                                </div>
                              );
                            })}
                            <div className="absolute" style={{ left: 23, top: sortAddTop }}>
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
                                    width: sortAddMenuWidth,
                                    height: sortAddMenuHeight,
                                  }}
                                >
                                  <div
                                    className="absolute text-[13px] font-normal text-[#757575]"
                                    style={{ left: 10, top: 10 }}
                                  >
                                    Find a field
                                  </div>
                                  <div
                                    ref={sortAddMenuListRef}
                                    className="airtable-sort-add-menu-list absolute left-0 right-0"
                                    style={{
                                      top: sortAddMenuFirstRowTop,
                                      height: sortAddMenuListHeight,
                                      overflowY:
                                        sortAddMenuContentHeight > sortAddMenuHeight
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
                                              height: sortAddMenuRowHeight,
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
                              style={{ top: sortFooterTop - 1 }}
                              aria-hidden="true"
                            />
                            <div
                              className="airtable-sort-footer absolute left-0 right-0"
                              style={{
                                top: sortFooterTop,
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
                            <span
                              className="airtable-search-icon absolute left-[21px] top-[58px] text-[#156FE2]"
                              aria-hidden="true"
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
                <button type="button" className="flex items-center gap-2">
                  <img alt="" className="h-[14px] w-[14px]" src={colourIcon.src} />
                  Colour
                </button>
                <button type="button" className="flex items-center" aria-label="Row height">
                  <img alt="" className="h-[14px] w-[14px]" src={rowHeightIcon.src} />
                </button>
                <button type="button" className="flex items-center gap-2">
                  <img alt="" className="h-[14px] w-[14px]" src={shareSyncIcon.src} />
                  Share and sync
                </button>
                <button
                  type="button"
                  onClick={handleAddBulkRows}
                  disabled={bulkRowsDisabled}
                  className={clsx(
                    "rounded-[6px] border px-3 py-1 text-[13px]",
                    bulkRowsDisabled
                      ? "cursor-not-allowed border-[#E2E8F0] bg-[#F8FAFC] text-[#94A3B8]"
                      : "border-[#DDE1E3] text-[#1d1f24]"
                  )}
                >
                  Add 100k rows
                </button>
              </div>
            </div>
          </section>

          <div className="flex min-h-0 flex-1 overflow-hidden">
            <section className="w-[281px] flex-shrink-0 border-r border-[#DDE1E3] bg-white" />

            <section className="min-h-0 min-w-0 flex-1 overflow-hidden bg-[#F7F8FC]">
              {baseDetailsQuery.isLoading && (
                <div className="rounded-[6px] border border-[#DDE1E3] bg-white px-4 py-6 airtable-secondary-font">
                  Loading base...
                </div>
              )}

              {baseDetailsQuery.isError && (
                <div className="rounded-[6px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-6 text-[12px] text-[#991b1b]">
                  We couldn’t load this base. It may have been deleted or you may not have access.
                </div>
              )}

              {activeTable && (
                <div className="h-full">
                  <div className="relative h-full w-full">
                    <div
                      ref={parentRef}
                      className="h-full w-full overflow-auto"
                      style={{ backgroundColor: "#F7F8FC" }}
                    >
                      <div
                        className="relative"
                        style={{ minWidth: totalColumnsWidth, minHeight: "100%" }}
                        onMouseLeave={() => {
                          setHoveredRowId(null);
                          setHoveredHeaderId(null);
                        }}
                      >
                      <div
                        className="sticky top-0 z-10 flex text-[13px] font-medium text-[#1d1f24] relative"
                        style={{ width: totalColumnsWidth }}
                      >
                        {nameColumn && (
                          <div
                            className="relative flex h-[33px] items-center gap-2 px-2"
                            style={{
                              ...headerCellBorder(nameColumn, true),
                              width: nameColumnWidth,
                              minWidth: nameColumnWidth,
                              maxWidth: nameColumnWidth,
                              flex: "0 0 auto",
                              backgroundColor: filteredColumnIds.has(nameColumn.id)
                                ? "#F6FBF9"
                                : sortedColumnIds.has(nameColumn.id)
                                ? "var(--airtable-sort-header-bg)"
                                : hoveredHeaderId === nameColumn.id
                                ? "var(--airtable-hover-bg)"
                                : "#ffffff",
                              position: "sticky",
                              left: 0,
                              zIndex: 30,
                            }}
                            onMouseEnter={() => setHoveredHeaderId(nameColumn.id)}
                            onMouseLeave={() => setHoveredHeaderId(null)}
                            onContextMenu={(event) =>
                              handleOpenContextMenu(
                                event,
                                "column",
                                nameColumn.id,
                                canDeleteColumn
                              )
                            }
                          >
                            {nameColumn.type === "data" &&
                              getColumnIconSrc(nameColumn.name, nameColumn.fieldType) && (
                              <img
                                alt=""
                                className={clsx(
                                  "h-[13px] w-[13px]",
                                  (sortedColumnIds.has(nameColumn.id) ||
                                    filteredColumnIds.has(nameColumn.id)) &&
                                    "airtable-column-icon--sorted",
                                  hoveredHeaderId === nameColumn.id &&
                                    "airtable-column-icon--hover"
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
                          const backgroundColor =
                            isFilteredColumn
                              ? "#F6FBF9"
                              : isSortedColumn
                              ? "var(--airtable-sort-header-bg)"
                              : hoveredHeaderId === column.id
                              ? "var(--airtable-hover-bg)"
                              : "#ffffff";

                          if (column.type === "add") {
                            return (
                              <div
                                key={column.id}
                                className="relative"
                                onMouseEnter={() => setHoveredHeaderId(column.id)}
                                onMouseLeave={() => setHoveredHeaderId(null)}
                                style={{
                                  ...cellStyle,
                                  width: virtualColumn.size,
                                  flex: "0 0 auto",
                                  backgroundColor,
                                }}
                              >
                                <button
                                  ref={addColumnButtonRef}
                                  type="button"
                                  onClick={() => {
                                    if (activeColumns.length >= MAX_COLUMNS) return;
                                    setIsAddColumnMenuOpen((prev) => !prev);
                                  }}
                                  disabled={activeColumns.length >= MAX_COLUMNS}
                                  className="flex h-[33px] w-full cursor-pointer items-center justify-center airtable-secondary-font transition-colors disabled:cursor-not-allowed"
                                  aria-label="Add column"
                                >
                                  <span className="airtable-plus-icon" aria-hidden="true" />
                                </button>
                                {isAddColumnMenuOpen && (
                                  <div
                                    ref={addColumnMenuRef}
                                    className="airtable-add-column-menu airtable-dropdown-surface absolute z-50"
                                    style={{
                                      width: ADD_COLUMN_MENU_WIDTH,
                                      top: "calc(100% + 2px)",
                                      right: 5,
                                    }}
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    <div className="airtable-add-column-header">
                                      <div className="airtable-add-column-search">
                                        <span
                                          className="airtable-search-icon text-[#156FE2]"
                                          aria-hidden="true"
                                        />
                                        <span className="airtable-add-column-placeholder">
                                          Find a field type
                                        </span>
                                      </div>
                                      <img
                                        alt=""
                                        className="airtable-add-column-help"
                                        src={helpIcon.src}
                                      />
                                    </div>
                                    <div
                                      className="airtable-dropdown-separator"
                                      style={{ marginLeft: 6, marginTop: 6 }}
                                      aria-hidden="true"
                                    />
                                    <div className="airtable-add-column-body">
                                      <div className="airtable-dropdown-heading">
                                        Standard fields
                                      </div>
                                      <div className="airtable-add-column-options">
                                        {addColumnTypeOptions.map((option) => (
                                          <button
                                            key={option.type}
                                            type="button"
                                            className="airtable-add-column-option airtable-dropdown-body"
                                            style={{
                                              width: ADD_COLUMN_OPTION_WIDTH,
                                              paddingLeft: option.icon.paddingLeft,
                                              gap: option.icon.gap,
                                            }}
                                            onClick={() => handleAddColumn(option.type)}
                                          >
                                            <img
                                              alt=""
                                              style={{
                                                width: option.icon.width,
                                                height: option.icon.height,
                                              }}
                                              src={option.icon.src}
                                            />
                                            <span>{option.label}</span>
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          }

                          return (
                            <div
                              key={column.id}
                              className="relative flex h-[33px] items-center gap-2 px-2"
                              style={{
                                ...cellStyle,
                                width: virtualColumn.size,
                                flex: "0 0 auto",
                                backgroundColor,
                              }}
                              onMouseEnter={() => setHoveredHeaderId(column.id)}
                              onMouseLeave={() => setHoveredHeaderId(null)}
                              onContextMenu={(event) =>
                                handleOpenContextMenu(
                                  event,
                                  "column",
                                  column.id,
                                  canDeleteColumn
                                )
                              }
                            >
                              {column.type === "data" &&
                                getColumnIconSrc(column.name, column.fieldType) && (
                                <img
                                  alt=""
                                  className={clsx(
                                    "h-[13px] w-[13px]",
                                    (isSortedColumn || isFilteredColumn) &&
                                      "airtable-column-icon--sorted",
                                    hoveredHeaderId === column.id &&
                                      "airtable-column-icon--hover"
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

                      <div
                        className="relative"
                        style={{ height: rowVirtualizer.getTotalSize() }}
                      >
                        {virtualItems.map((virtualRow) => {
                          const row = sortedTableData[virtualRow.index];
                          if (!row) {
                            return (
                              <div
                                key={`loader-${virtualRow.index}`}
                                className="absolute left-0 right-0 flex items-center px-3 text-[12px] text-[#616670]"
                                style={{
                                  transform: `translateY(${virtualRow.start}px)`,
                                  height: `${virtualRow.size}px`,
                                  width: totalColumnsWidth,
                                }}
                              >
                                {rowsQuery.hasNextPage
                                  ? "Loading more rows..."
                                  : "No more rows"}
                              </div>
                            );
                          }

                        const isLastRow = virtualRow.index === rowCount - 1;
                        const rowHasSelection = selectedCell?.rowId === row.id;

                        return (
                          <div
                            key={row.id}
                            className="absolute left-0 right-0 flex text-[13px] text-[#1d1f24]"
                            style={{
                              transform: `translateY(${virtualRow.start}px)`,
                              height: `${virtualRow.size}px`,
                              width: totalColumnsWidth,
                              zIndex: rowHasSelection ? 5 : 1,
                            }}
                            onMouseEnter={() => setHoveredRowId(row.id)}
                            onMouseLeave={() => setHoveredRowId(null)}
                            onContextMenu={(event) =>
                              handleOpenContextMenu(
                                event,
                                "row",
                                row.id,
                                canDeleteRow
                              )
                            }
                          >
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
                                const nameExpanded =
                                  nameIsLongText &&
                                  selectedCell?.rowId === row.id &&
                                  selectedCell?.columnId === nameColumn.id;
                                return (
                                  <div
                                    className={clsx(
                                      "relative flex overflow-visible px-2",
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
                                      backgroundColor: filteredColumnIds.has(nameColumn.id)
                                        ? "#E2F1E3"
                                        : sortedColumnIds.has(nameColumn.id)
                                        ? "var(--airtable-sort-column-bg)"
                                        : nameIsSelected
                                        ? "#ffffff"
                                        : hoveredRowId === row.id
                                        ? "var(--airtable-hover-bg)"
                                        : selectedCell?.rowId === row.id
                                        ? "var(--airtable-hover-bg)"
                                        : "#ffffff",
                                      position: "sticky",
                                      left: 0,
                                      zIndex: nameExpanded ? 30 : 25,
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
                                              {nameEditedValue}
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
                                                !nameIsEditing && "airtable-cell-input--inactive"
                                              )}
                                              style={{ height: LONG_TEXT_HEIGHT }}
                                              readOnly={!nameIsEditing}
                                              aria-label={`${nameColumn.name} cell`}
                                            />
                                            <img
                                              alt=""
                                              className="airtable-long-text-selection"
                                              src={longLineSelectionIcon.src}
                                            />
                                          </>
                                        )}
                                      </>
                                    ) : (
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
                                          !nameIsEditing && "airtable-cell-input--inactive"
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
                              const isRowHovered = hoveredRowId === row.id;
                              const rowHasSelection = selectedCell?.rowId === row.id;
                              const cellBackground = isFilteredColumn
                                ? "#E2F1E3"
                                : isSortedColumn
                                ? "var(--airtable-sort-column-bg)"
                                : isSelected
                                ? "#ffffff"
                                : isRowHovered || rowHasSelection
                                ? "var(--airtable-hover-bg)"
                                : "#ffffff";
                              const cellStyle = bodyCellBorder(column, false, isLastRow);

                                if (column.type === "add") {
                                  return (
                                    <div
                                      key={`${row.id}-${column.id}`}
                                      style={{
                                        width: virtualColumn.size,
                                        flex: "0 0 auto",
                                      }}
                                      aria-hidden="true"
                                    />
                                  );
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
                              const isExpanded =
                                isLongText &&
                                selectedCell?.rowId === row.id &&
                                selectedCell?.columnId === column.id;

                                return (
                                <div
                                  key={`${row.id}-${column.id}`}
                                  className={clsx(
                                    "relative flex overflow-visible px-2",
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
                                    backgroundColor: cellBackground,
                                    zIndex: isExpanded ? 20 : undefined,
                                    ...(isSelected
                                      ? ({ ["--cell-outline-left" as string]: "0px" } as Record<
                                          string,
                                          string
                                        >)
                                      : null),
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
                                                {editedValue}
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
                                                  !isEditing && "airtable-cell-input--inactive"
                                                )}
                                                style={{ height: LONG_TEXT_HEIGHT }}
                                                readOnly={!isEditing}
                                                aria-label={`${column.name} cell`}
                                              />
                                              <img
                                                alt=""
                                                className="airtable-long-text-selection"
                                                src={longLineSelectionIcon.src}
                                              />
                                            </>
                                          )}
                                        </>
                                      ) : (
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
                                            !isEditing && "airtable-cell-input--inactive"
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

                      <div
                        className="flex"
                        style={{ width: totalColumnsWidth }}
                        onMouseEnter={() => setAddRowHover(true)}
                        onMouseLeave={() => setAddRowHover(false)}
                      >
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
                                backgroundColor: addRowHover
                                  ? "var(--airtable-hover-bg)"
                                  : "#ffffff",
                                borderTop: "0.5px solid #DDE1E3",
                                borderBottom: "0.5px solid #DDE1E3",
                                borderLeft: "none",
                                borderRight: "none",
                                position: "sticky",
                                left: 0,
                                zIndex: 30,
                              }}
                              aria-label="Add row"
                            >
                              <span className="airtable-plus-icon" aria-hidden="true" />
                            </button>
                            <div
                              style={{
                                width: Math.max(0, dataColumnsWidth - nameColumnWidth),
                                flex: "0 0 auto",
                                backgroundColor: addRowHover
                                  ? "var(--airtable-hover-bg)"
                                  : "#ffffff",
                                borderTop: "0.5px solid #DDE1E3",
                                borderBottom: "0.5px solid #DDE1E3",
                                borderRight: "0.5px solid #DDE1E3",
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
                              backgroundColor: addRowHover
                                ? "var(--airtable-hover-bg)"
                                : "#ffffff",
                              borderTop: "0.5px solid #DDE1E3",
                              borderBottom: "0.5px solid #DDE1E3",
                              borderLeft: "none",
                              borderRight: "0.5px solid #DDE1E3",
                            }}
                            aria-label="Add row"
                          >
                            <span className="airtable-plus-icon" aria-hidden="true" />
                          </button>
                        )}
                        <div style={{ width: addColumnWidth }} aria-hidden="true" />
                      </div>
                    </div>
                    </div>
                    {nameColumn && nameColumnWidth > 0 && (
                      <div
                        className="pointer-events-none absolute top-0 bottom-0 z-40 w-px bg-[#CBCBCB]"
                        style={{ left: `${nameColumnWidth}px` }}
                        aria-hidden="true"
                      />
                    )}
                  </div>

                  {!activeColumns.length && (
                    <div className="p-6 text-center text-[12px] text-[#94a3b8]">
                      Add a column to start building this table.
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      {showContextMenu && contextMenu && (
        <div
          className="fixed z-50 min-w-[160px] rounded-[10px] border border-[#e2e8f0] bg-white p-1 text-[12px] shadow-[0_10px_30px_rgba(15,23,42,0.15)]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(event) => event.stopPropagation()}
        >
          {contextMenu.type === "table" && canDeleteTable && (
            <button
              type="button"
              onClick={() => handleDeleteTable(contextMenu.id)}
              className="w-full rounded-[8px] px-3 py-2 text-left text-[#dc2626] hover:bg-[#fee2e2]"
            >
              Delete table
            </button>
          )}
          {contextMenu.type === "column" && canDeleteColumn && (
            <button
              type="button"
              onClick={() => handleDeleteColumn(contextMenu.id)}
              className="w-full rounded-[8px] px-3 py-2 text-left text-[#dc2626] hover:bg-[#fee2e2]"
            >
              Delete column
            </button>
          )}
          {contextMenu.type === "row" && canDeleteRow && (
            <button
              type="button"
              onClick={() => handleDeleteRow(contextMenu.id)}
              className="w-full rounded-[8px] px-3 py-2 text-left text-[#dc2626] hover:bg-[#fee2e2]"
            >
              Delete row
            </button>
          )}
        </div>
      )}
    </div>
  );
}
