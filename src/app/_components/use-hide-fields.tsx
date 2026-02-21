import { useMemo, useCallback, useState, useRef, useEffect } from "react";
import type { RefObject } from "react";
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

type ColumnFieldType = "single_line_text" | "long_text" | "number";

export type HideFieldsRow = {
  column: { id: string; name: string; type: string | null };
  hoverTop: number;
  toggleOffset: number;
  iconLeftOffset: number;
  iconTopOffset: number;
  iconSpec: { Icon: FC<SVGProps<SVGSVGElement>>; width: number; height: number };
  textOffset: number;
  reorderOffset: number;
};

export type HideFieldsLayout = {
  dropdownHeight: number;
  buttonTop: number;
  rows: HideFieldsRow[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const HIDE_FIELDS_DROPDOWN_WIDTH = 320;
export const HIDE_FIELDS_HEADER_LEFT = 16;
export const HIDE_FIELDS_HEADER_TOP = 18;
export const HIDE_FIELDS_HELP_LEFT = 289;
export const HIDE_FIELDS_HELP_TOP = 18;
export const HIDE_FIELDS_SEPARATOR_LEFT = 16;
export const HIDE_FIELDS_SEPARATOR_TOP = 44;
export const HIDE_FIELDS_SEPARATOR_WIDTH = 288;
export const HIDE_FIELDS_SEPARATOR_HEIGHT = 2;
export const HIDE_FIELDS_TEXT_LEFT = 73;
export const HIDE_FIELDS_FIRST_TEXT_TOP = 61;
export const HIDE_FIELDS_TEXT_HEIGHT = 13;
export const HIDE_FIELDS_TEXT_ROW_GAP = HIDE_FIELDS_TEXT_HEIGHT + 13;
export const HIDE_FIELDS_HOVER_LEFT = 16;
export const HIDE_FIELDS_HOVER_WIDTH = 272;
export const HIDE_FIELDS_HOVER_HEIGHT = 18;
export const HIDE_FIELDS_TOGGLE_LEFT = 20;
export const HIDE_FIELDS_TOGGLE_WIDTH = 13;
export const HIDE_FIELDS_TOGGLE_HEIGHT = 8;
export const HIDE_FIELDS_REORDER_WIDTH = 10;
export const HIDE_FIELDS_REORDER_HEIGHT = 13;
export const HIDE_FIELDS_REORDER_RIGHT_OFFSET = 18;
export const HIDE_FIELDS_REORDER_LEFT =
  HIDE_FIELDS_DROPDOWN_WIDTH -
  HIDE_FIELDS_REORDER_RIGHT_OFFSET -
  HIDE_FIELDS_REORDER_WIDTH;
export const HIDE_FIELDS_REORDER_TOP = 63.5;
export const HIDE_FIELDS_REORDER_ROW_GAP = HIDE_FIELDS_REORDER_HEIGHT + 12.5;
export const HIDE_FIELDS_BUTTON_WIDTH = 136;
export const HIDE_FIELDS_BUTTON_HEIGHT = 26;
export const HIDE_FIELDS_BUTTON_GAP = 24;
export const HIDE_FIELDS_BUTTON_BOTTOM_PADDING = 10;

// ---------------------------------------------------------------------------
// Icon helpers
// ---------------------------------------------------------------------------

const coerceColumnType = (value?: string | null): ColumnFieldType =>
  value === "long_text" || value === "number" ? value : "single_line_text";

const hideFieldsIconSpecByName: Record<
  string,
  { Icon: FC<SVGProps<SVGSVGElement>>; width: number; height: number; gap: number }
> = {
  Assignee: { Icon: AssigneeIcon, width: 15, height: 16, gap: 9 },
  Status: { Icon: StatusIcon, width: 17, height: 17, gap: 7 },
  Attachments: { Icon: AttachmentsIcon, width: 17, height: 14, gap: 8 },
  Name: { Icon: NameIcon, width: 12.6, height: 12.6, gap: 10 },
  Notes: { Icon: NotesIcon, width: 15, height: 13, gap: 8 },
  Number: { Icon: NumberIcon, width: 13, height: 13, gap: 9.5 },
};

const hideFieldsIconSpecByType: Record<
  ColumnFieldType,
  { Icon: FC<SVGProps<SVGSVGElement>>; width: number; height: number; gap: number }
> = {
  // Non-null assertions are safe here: these keys are defined in hideFieldsIconSpecByName.
  single_line_text: hideFieldsIconSpecByName["Name"]!,
  long_text: hideFieldsIconSpecByName["Notes"]!,
  number: hideFieldsIconSpecByName["Number"]!,
};

export const getHideFieldsIconSpec = (name: string, type?: string | null) => {
  const resolvedType = coerceColumnType(type);
  return (
    hideFieldsIconSpecByName[name] ??
    hideFieldsIconSpecByType[resolvedType] ??
    hideFieldsIconSpecByName["Name"]!
  );
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

type Column = {
  id: string;
  name: string;
  type: string | null;
};

interface UseHideFieldsProps {
  orderedAllColumns: Column[];
  hiddenColumnIdSet: Set<string>;
  activeTableId: string | null;
  setHiddenColumns: (params: { tableId: string; hiddenColumnIds: string[] }) => void;
}

export function useHideFields({
  orderedAllColumns,
  hiddenColumnIdSet,
  activeTableId,
  setHiddenColumns,
}: UseHideFieldsProps) {
  // State
  const [isHideFieldsMenuOpen, setIsHideFieldsMenuOpen] = useState(false);
  const hideFieldsButtonRef = useRef<HTMLButtonElement>(null);
  const hideFieldsMenuRef = useRef<HTMLDivElement>(null);

  // Computed values
  const hiddenFieldCount = hiddenColumnIdSet.size;

  const hideFieldColumns = useMemo(
    () => orderedAllColumns.filter((column) => column.name !== "Name"),
    [orderedAllColumns]
  );

  const hideFieldsLayout: HideFieldsLayout = useMemo(() => {
    const rows = hideFieldColumns.map((column, index) => {
      const textTop = HIDE_FIELDS_FIRST_TEXT_TOP + index * HIDE_FIELDS_TEXT_ROW_GAP;
      const hoverTop =
        textTop - (HIDE_FIELDS_HOVER_HEIGHT - HIDE_FIELDS_TEXT_HEIGHT) / 2;
      const toggleTop =
        hoverTop + (HIDE_FIELDS_HOVER_HEIGHT - HIDE_FIELDS_TOGGLE_HEIGHT) / 2;
      const reorderTop = HIDE_FIELDS_REORDER_TOP + index * HIDE_FIELDS_REORDER_ROW_GAP;
      const iconSpec = getHideFieldsIconSpec(column.name, column.type);
      const iconLeft = HIDE_FIELDS_TEXT_LEFT - iconSpec.gap - iconSpec.width;
      const iconTop = textTop - (iconSpec.height - HIDE_FIELDS_TEXT_HEIGHT) / 2;
      return {
        column,
        hoverTop,
        textOffset: textTop - hoverTop,
        iconSpec,
        iconLeftOffset: iconLeft - HIDE_FIELDS_HOVER_LEFT,
        iconTopOffset: iconTop - hoverTop,
        toggleOffset: toggleTop - hoverTop,
        reorderOffset: reorderTop - hoverTop,
      };
    });
    const lastTextTop =
      hideFieldColumns.length > 0
        ? HIDE_FIELDS_FIRST_TEXT_TOP +
          (hideFieldColumns.length - 1) * HIDE_FIELDS_TEXT_ROW_GAP
        : HIDE_FIELDS_FIRST_TEXT_TOP;
    const buttonTop =
      lastTextTop + HIDE_FIELDS_TEXT_HEIGHT + HIDE_FIELDS_BUTTON_GAP;
    const dropdownHeight =
      buttonTop + HIDE_FIELDS_BUTTON_HEIGHT + HIDE_FIELDS_BUTTON_BOTTOM_PADDING;
    return {
      rows,
      buttonTop,
      dropdownHeight,
    };
  }, [hideFieldColumns]);

  // Actions
  const toggleHiddenColumn = useCallback(
    (columnId: string) => {
      if (!activeTableId) return;
      const nextHidden = new Set(hiddenColumnIdSet);
      if (nextHidden.has(columnId)) {
        nextHidden.delete(columnId);
      } else {
        nextHidden.add(columnId);
      }
      setHiddenColumns({
        tableId: activeTableId,
        hiddenColumnIds: Array.from(nextHidden),
      });
    },
    [activeTableId, hiddenColumnIdSet, setHiddenColumns]
  );

  const hideAllColumns = useCallback(() => {
    if (!activeTableId) return;
    setHiddenColumns({
      tableId: activeTableId,
      hiddenColumnIds: hideFieldColumns.map((column) => column.id),
    });
  }, [activeTableId, hideFieldColumns, setHiddenColumns]);

  const showAllColumns = useCallback(() => {
    if (!activeTableId) return;
    setHiddenColumns({
      tableId: activeTableId,
      hiddenColumnIds: [],
    });
  }, [activeTableId, setHiddenColumns]);

  // Click outside handler
  useEffect(() => {
    if (!isHideFieldsMenuOpen) return;
    const handleClick = (event: Event) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (hideFieldsMenuRef.current?.contains(target)) return;
      if (hideFieldsButtonRef.current?.contains(target)) return;
      setIsHideFieldsMenuOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsHideFieldsMenuOpen(false);
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
  }, [isHideFieldsMenuOpen]);

  return {
    // State
    isHideFieldsMenuOpen,
    setIsHideFieldsMenuOpen,
    hideFieldsButtonRef,
    hideFieldsMenuRef,

    // Computed values
    hiddenFieldCount,
    hideFieldsLayout,

    // Actions
    toggleHiddenColumn,
    hideAllColumns,
    showAllColumns,
  };
}
