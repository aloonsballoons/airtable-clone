import type { FC, SVGProps } from "react";
import AssigneeIcon from "~/assets/assignee.svg";
import AttachmentsIcon from "~/assets/attachments.svg";
import NameIcon from "~/assets/name.svg";
import NotesIcon from "~/assets/notes.svg";
import NumberIcon from "~/assets/number.svg";
import StatusIcon from "~/assets/status.svg";
import type { ColumnFieldType, IconSpec } from "./types";
import { coerceColumnType } from "./utils";
import { STATUS_ICON_SCALE } from "./constants";

export type SvgComponent = FC<SVGProps<SVGSVGElement>>;

export const columnIconMap: Record<string, SvgComponent> = {
  Name: NameIcon,
  Notes: NotesIcon,
  Assignee: AssigneeIcon,
  Status: StatusIcon,
  Attachments: AttachmentsIcon,
  Number: NumberIcon,
};

export const columnTypeIconMap: Record<ColumnFieldType, SvgComponent> = {
  single_line_text: NameIcon,
  long_text: NotesIcon,
  number: NumberIcon,
};

export const getColumnIcon = (name: string, type?: string | null): SvgComponent | undefined => {
  const resolvedType = coerceColumnType(type);
  return columnIconMap[name] ?? columnTypeIconMap[resolvedType];
};

// ============================================================================
// Icon Specs for Toolbar Components
// ============================================================================

const STATUS_MENU_ICON_SIZE = 15 * STATUS_ICON_SCALE;

/**
 * Icon specs for sort/filter add menus (by column name).
 * Properties: Icon, width, height, left, topOffset (optional)
 */
export const sortAddMenuIconSpecByName: Record<string, IconSpec> = {
  Assignee: { Icon: AssigneeIcon, width: 15, height: 16, left: 10 },
  Status: {
    Icon: StatusIcon,
    width: STATUS_MENU_ICON_SIZE,
    height: STATUS_MENU_ICON_SIZE,
    left: 10,
    topOffset: -2,
  },
  Attachments: { Icon: AttachmentsIcon, width: 14, height: 16, left: 11, topOffset: -2 },
  Name: { Icon: NameIcon, width: 12.01, height: 12, left: 12 },
  Notes: { Icon: NotesIcon, width: 15.5, height: 13.9, left: 11 },
  Number: { Icon: NumberIcon, width: 13, height: 13, left: 12.5 },
};

/**
 * Icon specs for sort/filter add menus (by column type).
 * Properties: Icon, width, height, left
 */
export const sortAddMenuIconSpecByType: Record<ColumnFieldType, IconSpec> = {
  single_line_text: { Icon: NameIcon, width: 12.01, height: 12, left: 12 },
  long_text: { Icon: NotesIcon, width: 15.5, height: 13.9, left: 11 },
  number: { Icon: NumberIcon, width: 13, height: 13, left: 12.5 },
};

/**
 * Get icon spec for sort/filter menus by column name or type.
 */
export const getSortAddMenuIconSpec = (name: string, type?: string | null): IconSpec | undefined => {
  const resolvedType = coerceColumnType(type);
  return sortAddMenuIconSpecByName[name] ?? sortAddMenuIconSpecByType[resolvedType];
};

/**
 * Icon specs for hide fields dropdown (by column name).
 * Properties: Icon, width, height, gap
 */
export const hideFieldsIconSpecByName: Record<string, IconSpec> = {
  Assignee: { Icon: AssigneeIcon, width: 15, height: 16, gap: 9 },
  Status: { Icon: StatusIcon, width: 17, height: 17, gap: 7 },
  Attachments: { Icon: AttachmentsIcon, width: 17, height: 14, gap: 8 },
  Name: { Icon: NameIcon, width: 12.6, height: 12.6, gap: 10 },
  Notes: { Icon: NotesIcon, width: 15, height: 13, gap: 8 },
  Number: { Icon: NumberIcon, width: 13, height: 13, gap: 9.5 },
};

/**
 * Icon specs for hide fields dropdown (by column type).
 * Properties: Icon, width, height, gap
 */
export const hideFieldsIconSpecByType: Record<ColumnFieldType, IconSpec> = {
  single_line_text: hideFieldsIconSpecByName["Name"]!,
  long_text: hideFieldsIconSpecByName["Notes"]!,
  number: hideFieldsIconSpecByName["Number"]!,
};

/**
 * Get icon spec for hide fields dropdown by column name or type.
 */
export const getHideFieldsIconSpec = (name: string, type?: string | null): IconSpec => {
  const resolvedType = coerceColumnType(type);
  return (
    hideFieldsIconSpecByName[name] ??
    hideFieldsIconSpecByType[resolvedType] ??
    hideFieldsIconSpecByName["Name"]!
  );
};
