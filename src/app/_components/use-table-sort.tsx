import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction, MouseEvent as ReactMouseEvent, RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { api } from "~/trpc/react";

// Icon imports
import type { FC, SVGProps } from "react";
import AssigneeIcon from "~/assets/assignee.svg";
import AttachmentsIcon from "~/assets/attachments.svg";
import NameIcon from "~/assets/name.svg";
import NotesIcon from "~/assets/notes.svg";
import NumberIcon from "~/assets/number.svg";
import StatusIcon from "~/assets/status.svg";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SortConfig = { columnId: string; direction: "asc" | "desc" };

type ColumnFieldType = "single_line_text" | "long_text" | "number";

type Column = {
  id: string;
  name: string;
  type: string | null;
};

type TableMetadata = {
  sort?: Array<{ columnId: string; direction?: string | null }> | null;
  [key: string]: unknown;
};

export type UseTableSortParams = {
  tableId: string | null;
  viewId?: string | null;
  isCustomView?: boolean;
  columns: Column[];
  visibleColumnIdSet: Set<string>;
  tableMetaQuery: {
    data?: TableMetadata | null;
  };
  hasLoadedTableMetaRef: RefObject<boolean>;
  onSortChange?: (sort: SortConfig[] | null) => void;
};

export type SortLayoutConstants = {
  sortListHeight: number;
  sortFieldTop: number;
  sortFieldHeight: number;
  sortRowGap: number;
  sortRowStride: number;
  sortRowsHeight: number;
  sortAddTop: number;
  sortFooterTop: number;
  sortFooterHeight: number;
  sortConfiguredHeight: number;
  sortFieldLeft: number;
  sortFieldWidth: number;
  sortDirectionLeft: number;
  sortDirectionWidth: number;
  sortRemoveSize: number;
  sortRemoveLeft: number;
  sortReorderLeft: number;
  sortReorderWidth: number;
  sortConfiguredWidth: number;
  sortLineWidth: number;
  sortFieldMenuWidth: number;
  sortFieldMenuPadding: number;
  sortFieldMenuHeaderGap: number;
  sortFieldMenuGap: number;
  sortFieldMenuRowHeight: number;
  sortFieldMenuFindHeight: number;
  sortFieldMenuFirstRowTop: number;
  sortAddMenuWidth: number;
  sortAddMenuHeaderTop: number;
  sortAddMenuHeaderHeight: number;
  sortAddMenuHeaderGap: number;
  sortAddMenuFirstRowTop: number;
  sortAddMenuRowHeight: number;
  sortAddMenuRowStride: number;
  sortAddMenuBottomPadding: number;
  sortAddMenuContentHeight: number;
  sortAddMenuHeight: number;
  sortAddMenuListHeight: number;
};

export type UseTableSortReturn = {
  // Refs
  sortButtonRef: RefObject<HTMLButtonElement | null>;
  sortMenuRef: RefObject<HTMLDivElement | null>;
  sortFieldMenuRef: RefObject<HTMLDivElement | null>;
  sortAddMenuListRef: RefObject<HTMLDivElement | null>;

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
  sortPhantomRef: RefObject<HTMLDivElement | null>;
  phantomSortX: number | null;
  phantomSortY: number | null;
  sortParam: SortConfig[];
  shouldIncludeSortInQuery: boolean;

  // Virtualizer
  sortAddVirtualItems: Array<{ index: number; start: number }>;
  sortAddVirtualizerSize: number;

  // Remaining columns
  remainingSortColumns: Column[];

  // Layout
  sortLayout: SortLayoutConstants;

  // Callbacks
  applySorts: (sorts: SortConfig[] | null) => void;
  handleSortDragStart: (event: ReactMouseEvent, columnId: string) => void;
  getSortDirectionLabels: (columnId: string) => { asc: string; desc: string };
  filterActiveSorts: (sorts: SortConfig[]) => SortConfig[];

  // Mutation state
  isSettingSort: boolean;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_ICON_SCALE = 1.1;
const STATUS_MENU_ICON_SIZE = 15 * STATUS_ICON_SCALE;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const coerceColumnType = (value?: string | null): ColumnFieldType =>
  value === "long_text" || value === "number" ? value : "single_line_text";

const sortAddMenuIconSpecByName: Record<
  string,
  { Icon: FC<SVGProps<SVGSVGElement>>; width: number; height: number; left: number }
> = {
  Assignee: { Icon: AssigneeIcon, width: 15, height: 16, left: 10 },
  Status: {
    Icon: StatusIcon,
    width: STATUS_MENU_ICON_SIZE,
    height: STATUS_MENU_ICON_SIZE,
    left: 10,
  },
  Attachments: { Icon: AttachmentsIcon, width: 14, height: 16, left: 11 },
  Name: { Icon: NameIcon, width: 12.01, height: 12, left: 12 },
  Notes: { Icon: NotesIcon, width: 15.5, height: 13.9, left: 11 },
  Number: { Icon: NumberIcon, width: 13, height: 13, left: 12.5 },
};

const sortAddMenuIconSpecByType: Record<
  ColumnFieldType,
  { Icon: FC<SVGProps<SVGSVGElement>>; width: number; height: number; left: number }
> = {
  single_line_text: { Icon: NameIcon, width: 12.01, height: 12, left: 12 },
  long_text: { Icon: NotesIcon, width: 15.5, height: 13.9, left: 11 },
  number: { Icon: NumberIcon, width: 13, height: 13, left: 12.5 },
};

export const getSortAddMenuIconSpec = (name: string, type?: string | null) => {
  const resolvedType = coerceColumnType(type);
  return (
    sortAddMenuIconSpecByName[name] ?? sortAddMenuIconSpecByType[resolvedType]
  );
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
    (item, idx) =>
      item.columnId === right[idx]?.columnId &&
      item.direction === right[idx]?.direction
  );
};

// Sort menu layout constants
const SORT_ADD_MENU_ROW_HEIGHT = 26;
const SORT_ADD_MENU_ROW_STRIDE = 32;
const SORT_ADD_MENU_BOTTOM_PADDING = 10;
const SORT_FIELD_TOP = 52;
const SORT_FIELD_HEIGHT = 28;
const SORT_ROW_GAP = 8;

// Compute sort layout constants
export const computeSortLayout = (
  sortRowsCount: number,
  remainingColumnsCount: number
): SortLayoutConstants => {
  const sortFieldTop = SORT_FIELD_TOP;
  const sortFieldHeight = SORT_FIELD_HEIGHT;
  const sortRowGap = SORT_ROW_GAP;
  const sortRowStride = sortFieldHeight + sortRowGap;
  const sortRowsHeight =
    sortRowsCount > 0
      ? sortRowsCount * sortFieldHeight + (sortRowsCount - 1) * sortRowGap
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
  const sortRemoveLeft = 414;
  const sortReorderLeft = 450;
  const sortReorderWidth = 10;
  const sortConfiguredWidth = sortRowsCount > 1 ? 480 : 453;
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
  const sortAddMenuRowHeight = SORT_ADD_MENU_ROW_HEIGHT;
  const sortAddMenuRowStride = SORT_ADD_MENU_ROW_STRIDE;
  const sortAddMenuBottomPadding = SORT_ADD_MENU_BOTTOM_PADDING;
  const sortAddMenuContentHeight =
    sortAddMenuFirstRowTop +
    (remainingColumnsCount > 0
      ? (remainingColumnsCount - 1) * sortAddMenuRowStride +
        sortAddMenuRowHeight
      : 0) +
    sortAddMenuBottomPadding;
  const sortAddMenuHeight = Math.min(256, sortAddMenuContentHeight);
  const sortAddMenuListHeight = Math.max(
    0,
    sortAddMenuHeight - sortAddMenuFirstRowTop - sortAddMenuBottomPadding
  );
  const sortListHeight = 97 + remainingColumnsCount * 32;

  return {
    sortListHeight,
    sortFieldTop,
    sortFieldHeight,
    sortRowGap,
    sortRowStride,
    sortRowsHeight,
    sortAddTop,
    sortFooterTop,
    sortFooterHeight,
    sortConfiguredHeight,
    sortFieldLeft,
    sortFieldWidth,
    sortDirectionLeft,
    sortDirectionWidth,
    sortRemoveSize,
    sortRemoveLeft,
    sortReorderLeft,
    sortReorderWidth,
    sortConfiguredWidth,
    sortLineWidth,
    sortFieldMenuWidth,
    sortFieldMenuPadding,
    sortFieldMenuHeaderGap,
    sortFieldMenuGap,
    sortFieldMenuRowHeight,
    sortFieldMenuFindHeight,
    sortFieldMenuFirstRowTop,
    sortAddMenuWidth,
    sortAddMenuHeaderTop,
    sortAddMenuHeaderHeight,
    sortAddMenuHeaderGap,
    sortAddMenuFirstRowTop,
    sortAddMenuRowHeight,
    sortAddMenuRowStride,
    sortAddMenuBottomPadding,
    sortAddMenuContentHeight,
    sortAddMenuHeight,
    sortAddMenuListHeight,
  };
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTableSort({
  tableId,
  viewId,
  isCustomView = false,
  columns,
  visibleColumnIdSet,
  tableMetaQuery,
  hasLoadedTableMetaRef,
  onSortChange,
}: UseTableSortParams): UseTableSortReturn {
  // Refs
  const sortButtonRef = useRef<HTMLButtonElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const sortFieldMenuRef = useRef<HTMLDivElement>(null);
  const sortAddMenuListRef = useRef<HTMLDivElement>(null);
  const sortRowsRef = useRef<SortConfig[]>([]);
  const prevSortConfigListRef = useRef<SortConfig[]>([]);
  const sortPhantomRef = useRef<HTMLDivElement>(null);
  const reorderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragDropdownRectRef = useRef<DOMRect | null>(null);
  const phantomYRef = useRef<number | null>(null);
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // UI State
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const [openSortDirectionId, setOpenSortDirectionId] = useState<string | null>(
    null
  );
  const [openSortFieldId, setOpenSortFieldId] = useState<string | null>(null);
  const [isAddSortMenuOpen, setIsAddSortMenuOpen] = useState(false);

  // Sort state
  const [sortOrderOverride, setSortOrderOverride] = useState<SortConfig[] | null>(
    null
  );
  const [sortOverride, setSortOverride] = useState<SortConfig[] | null>(null);

  // Drag state
  const [draggingSortId, setDraggingSortId] = useState<string | null>(null);
  const [draggingSortTop, setDraggingSortTop] = useState<number | null>(null);
  const [phantomSortX, setPhantomSortX] = useState<number | null>(null);
  const [phantomSortY, setPhantomSortY] = useState<number | null>(null);

  // Parse sort config from table metadata (memoized to prevent unnecessary
  // re-renders and effect re-triggers when the underlying data hasn't changed)
  const rawSortConfig = tableMetaQuery.data?.sort ?? null;
  const sortConfigList: SortConfig[] = useMemo(() => {
    if (!Array.isArray(rawSortConfig) || rawSortConfig.length === 0) return [];
    return rawSortConfig.map((item) => ({
      columnId: item.columnId,
      direction: normalizeSortDirection(item.direction),
    }));
  }, [rawSortConfig]);

  // Filter sorts to only visible columns
  const filterActiveSorts = useCallback(
    (sorts: SortConfig[]) => {
      if (visibleColumnIdSet.size === 0) return sorts;
      return sorts.filter((sort) => visibleColumnIdSet.has(sort.columnId));
    },
    [visibleColumnIdSet]
  );

  // Determine active sort parameter (memoized to stabilize query keys
  // and prevent unnecessary refetches when the sort hasn't actually changed)
  const sortParamSource = sortOverride ?? sortConfigList;
  const sortParam = useMemo(() => filterActiveSorts(sortParamSource), [filterActiveSorts, sortParamSource]);
  const hasSort = sortParam.length > 0;
  const shouldIncludeSortInQuery =
    sortOverride !== null || hasLoadedTableMetaRef.current;

  // Current sort rows (for UI display)
  const sortRows = sortOrderOverride ?? sortOverride ?? sortConfigList;
  const sortedColumnIds = useMemo(
    () => new Set(sortRows.map((sort) => sort.columnId)),
    [sortRows]
  );

  // Remaining columns that can be added to sort
  const remainingSortColumns = useMemo(
    () => columns.filter((column) => !sortedColumnIds.has(column.id)),
    [columns, sortedColumnIds]
  );

  // Compute layout constants
  const sortLayout = useMemo(
    () => computeSortLayout(sortRows.length, remainingSortColumns.length),
    [sortRows.length, remainingSortColumns.length]
  );

  // Virtualizer for add sort menu
  const sortAddVirtualizer = useVirtualizer({
    count: remainingSortColumns.length,
    getScrollElement: () => sortAddMenuListRef.current,
    estimateSize: () => SORT_ADD_MENU_ROW_STRIDE,
    overscan: 5,
  });

  const sortAddVirtualItems = sortAddVirtualizer.getVirtualItems();
  const sortAddVirtualizerSize = Math.max(
    0,
    sortAddVirtualizer.getTotalSize() -
      (remainingSortColumns.length > 0
        ? SORT_ADD_MENU_ROW_STRIDE - SORT_ADD_MENU_ROW_HEIGHT
        : 0) +
      SORT_ADD_MENU_BOTTOM_PADDING
  );

  // Get tRPC utils for cache manipulation
  const utils = api.useUtils();

  // Mutation
  const setTableSort = api.base.setTableSort.useMutation({
    onMutate: async ({ tableId, sort }) => {
      await utils.base.getTableMeta.cancel({ tableId });
      const previous = utils.base.getTableMeta.getData({ tableId });
      const previousSort = normalizeSortList(previous?.sort ?? null);
      const nextSort = sort ?? [];

      // Optimistically update table meta cache
      utils.base.getTableMeta.setData({ tableId }, (current) => {
        if (!current) return current;
        return {
          ...current,
          sort: nextSort.length ? nextSort : null,
        };
      });

      // No getRows invalidation needed here — sortOverride already changes
      // the query key, which triggers a fresh fetch automatically.

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
    onSettled: async (_data, _error, variables) => {
      // Only invalidate meta to sync with server — no getRows invalidation
      // needed since sortOverride already drives the query key.
      await utils.base.getTableMeta.invalidate({ tableId: variables.tableId });
    },
  });

  // Apply sorts
  const applySorts = useCallback(
    (next: SortConfig[] | null) => {
      if (!tableId) return;
      const normalizedNext = next ?? [];
      setSortOverride(next ?? []);
      // Only persist to the base table when NOT in a custom view.
      // Custom views persist via onSortChange -> updateViewMutation instead.
      if (!isCustomView) {
        setTableSort.mutate({
          tableId,
          sort: normalizedNext,
        });
      }
      onSortChange?.(next);
    },
    [tableId, isCustomView, setTableSort, onSortChange]
  );

  // Get sort direction labels based on column type
  const getSortDirectionLabels = useCallback(
    (columnId: string) => {
      const column = columns.find((col) => col.id === columnId);
      if (column?.type === "number") {
        return { asc: "1 → 9", desc: "9 → 1" };
      }
      return { asc: "A → Z", desc: "Z → A" };
    },
    [columns]
  );

  // Handle sort drag start — phantom-based reorder
  const handleSortDragStart = useCallback(
    (event: ReactMouseEvent, columnId: string) => {
      event.preventDefault();
      const containerRect = sortMenuRef.current?.getBoundingClientRect();
      if (!containerRect) return;

      const currentOrder = sortRowsRef.current;
      const startIndex = currentOrder.findIndex(
        (sort) => sort.columnId === columnId
      );
      if (startIndex === -1) return;

      const sortRowStride = SORT_FIELD_HEIGHT + SORT_ROW_GAP;
      const rowTop = SORT_FIELD_TOP + startIndex * sortRowStride;

      // Compute sort row viewport position
      const rowViewportLeft = containerRect.left;
      const rowViewportTop = containerRect.top + rowTop;

      // Offset from cursor to phantom top-left (so phantom doesn't jump)
      dragOffsetRef.current = {
        x: event.clientX - rowViewportLeft,
        y: event.clientY - rowViewportTop,
      };
      dragDropdownRectRef.current = containerRect;

      setSortOrderOverride(currentOrder);
      setDraggingSortId(columnId);
      setPhantomSortX(rowViewportLeft);
      setPhantomSortY(rowViewportTop);
      phantomYRef.current = rowViewportTop;
      setOpenSortDirectionId(null);
      setOpenSortFieldId(null);
      setIsAddSortMenuOpen(false);

      document.body.classList.add("airtable-sort-dragging");

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const newPhantomX = moveEvent.clientX - dragOffsetRef.current.x;
        const newPhantomY = moveEvent.clientY - dragOffsetRef.current.y;

        // Clamp to viewport
        const clampedX = Math.max(
          0,
          Math.min(window.innerWidth - containerRect.width, newPhantomX)
        );
        const clampedY = Math.max(
          0,
          Math.min(window.innerHeight - SORT_FIELD_HEIGHT, newPhantomY)
        );

        // Direct DOM update — bypasses React re-render for 60fps drag
        if (sortPhantomRef.current) {
          sortPhantomRef.current.style.transform = `translate(${clampedX - rowViewportLeft}px, ${clampedY - rowViewportTop}px)`;
        }
        phantomYRef.current = clampedY;

        // Compute target index from phantom Y relative to dropdown
        const relativeY = clampedY - containerRect.top;
        const centerY = relativeY + SORT_FIELD_HEIGHT / 2;
        const order = sortRowsRef.current;
        const maxIndex = order.length - 1;
        const targetIndex = Math.max(
          0,
          Math.min(
            maxIndex,
            Math.floor((centerY - SORT_FIELD_TOP) / sortRowStride)
          )
        );

        const currentIndex = order.findIndex(
          (sort) => sort.columnId === columnId
        );

        // Clear any pending reorder timeout
        if (reorderTimeoutRef.current) {
          clearTimeout(reorderTimeoutRef.current);
          reorderTimeoutRef.current = null;
        }

        if (currentIndex !== -1 && currentIndex !== targetIndex) {
          reorderTimeoutRef.current = setTimeout(() => {
            const latestOrder = [...sortRowsRef.current];
            const curIdx = latestOrder.findIndex(
              (sort) => sort.columnId === columnId
            );
            if (curIdx !== -1 && curIdx !== targetIndex) {
              const [removed] = latestOrder.splice(curIdx, 1);
              if (removed) {
                latestOrder.splice(targetIndex, 0, removed);
              }
              sortRowsRef.current = latestOrder;
              setSortOrderOverride(latestOrder);
            }
            reorderTimeoutRef.current = null;
          }, 100);
        }
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.classList.remove("airtable-sort-dragging");

        // Clear pending timeout
        if (reorderTimeoutRef.current) {
          clearTimeout(reorderTimeoutRef.current);
          reorderTimeoutRef.current = null;
        }

        // Compute final target index from last phantom Y position
        const lastPhantomY = phantomYRef.current;
        const ddRect = dragDropdownRectRef.current;
        if (lastPhantomY !== null && ddRect) {
          const relativeY = lastPhantomY - ddRect.top;
          const centerY = relativeY + SORT_FIELD_HEIGHT / 2;
          const order = sortRowsRef.current;
          const maxIndex = order.length - 1;
          const finalTargetIndex = Math.max(
            0,
            Math.min(
              maxIndex,
              Math.floor((centerY - SORT_FIELD_TOP) / sortRowStride)
            )
          );

          const curIdx = order.findIndex(
            (sort) => sort.columnId === columnId
          );
          if (curIdx !== -1 && curIdx !== finalTargetIndex) {
            const nextOrder = [...order];
            const [removed] = nextOrder.splice(curIdx, 1);
            if (removed) {
              nextOrder.splice(finalTargetIndex, 0, removed);
            }
            sortRowsRef.current = nextOrder;
          }
        }

        const finalOrder = sortRowsRef.current;
        if (!areSortsEqual(finalOrder, sortConfigList)) {
          applySorts(finalOrder.length ? finalOrder : null);
        }

        setDraggingSortId(null);
        setDraggingSortTop(null);
        setPhantomSortX(null);
        setPhantomSortY(null);
        phantomYRef.current = null;
        dragDropdownRectRef.current = null;
        setSortOrderOverride(null);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [applySorts, sortConfigList]
  );

  // Effect: Close sort menu on outside click
  useEffect(() => {
    if (!isSortMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (sortMenuRef.current?.contains(target)) return;
      if (sortButtonRef.current?.contains(target)) return;
      setIsSortMenuOpen(false);
      setOpenSortDirectionId(null);
      setOpenSortFieldId(null);
      setIsAddSortMenuOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSortMenuOpen(false);
        setOpenSortDirectionId(null);
        setOpenSortFieldId(null);
        setIsAddSortMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isSortMenuOpen]);

  // Effect: Close sort field menu on outside click
  useEffect(() => {
    if (!openSortFieldId) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (sortFieldMenuRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(".airtable-sort-field")) {
        return;
      }
      setOpenSortFieldId(null);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenSortFieldId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [openSortFieldId]);

  // Effect: Filter out sorts for hidden columns.
  // Use a ref to track whether we already fired this for the current config
  // to prevent cascading re-fetches (applySorts -> mutation -> meta invalidation
  // -> sortConfigList change -> effect re-fires).
  const lastFilteredSortRef = useRef<string>("");
  useEffect(() => {
    if (sortConfigList.length === 0) return;
    const nextSorts = sortConfigList.filter((sort) =>
      visibleColumnIdSet.has(sort.columnId)
    );
    if (nextSorts.length !== sortConfigList.length) {
      const key = JSON.stringify(nextSorts);
      if (lastFilteredSortRef.current === key) return;
      lastFilteredSortRef.current = key;
      applySorts(nextSorts.length ? nextSorts : null);
    }
  }, [applySorts, sortConfigList, visibleColumnIdSet]);

  // Effect: Sync sortRowsRef
  useEffect(() => {
    sortRowsRef.current = sortRows;
  }, [sortRows]);

  // Effect: Clear sort overrides when table or view changes
  useEffect(() => {
    setSortOverride(null);
    setSortOrderOverride(null);
  }, [tableId, viewId]);

  // Effect: Clear override when sortConfigList changes to a different value
  // This handles view switches and when user changes are persisted
  useEffect(() => {
    const prevConfig = prevSortConfigListRef.current;
    const configChanged = !areSortsEqual(prevConfig, sortConfigList);

    if (configChanged) {
      prevSortConfigListRef.current = sortConfigList;

      // Clear override if it exists and we're not in the middle of a mutation
      if (sortOverride && !setTableSort.isPending) {
        setSortOverride(null);
        setSortOrderOverride(null);
      }
    }
  }, [sortConfigList, sortOverride, setTableSort.isPending]);

  return {
    // Refs
    sortButtonRef,
    sortMenuRef,
    sortFieldMenuRef,
    sortAddMenuListRef,

    // State
    isSortMenuOpen,
    setIsSortMenuOpen,
    openSortDirectionId,
    setOpenSortDirectionId,
    openSortFieldId,
    setOpenSortFieldId,
    isAddSortMenuOpen,
    setIsAddSortMenuOpen,

    // Data
    hasSort,
    sortRows,
    sortedColumnIds,
    draggingSortId,
    draggingSortTop,
    sortPhantomRef,
    phantomSortX,
    phantomSortY,
    sortParam,
    shouldIncludeSortInQuery,

    // Virtualizer
    sortAddVirtualItems,
    sortAddVirtualizerSize,

    // Remaining columns
    remainingSortColumns,

    // Layout
    sortLayout,

    // Callbacks
    applySorts,
    handleSortDragStart,
    getSortDirectionLabels,
    filterActiveSorts,

    // Mutation state
    isSettingSort: setTableSort.isPending,
  };
}
