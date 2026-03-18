export type ColumnFieldType = "single_line_text" | "long_text" | "number";

export type SortConfig = { columnId: string; direction: "asc" | "desc" };

export type FilterConnector = "and" | "or";

export type FilterOperator =
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

export type FilterConditionItem = {
  id: string;
  type: "condition";
  columnId: string | null;
  operator: FilterOperator;
  value: string;
};

export type FilterGroupItem = {
  id: string;
  type: "group";
  connector: FilterConnector;
  conditions: (FilterConditionItem | FilterGroupItem)[];
};

export type FilterItem = FilterConditionItem | FilterGroupItem;

export type TableRow = Record<string, string> & { id: string };

// Icon specs for toolbar components
export type IconSpec = {
  Icon: React.FC<React.SVGProps<SVGSVGElement>>;
  width: number;
  height: number;
  left?: number; // For sort/filter
  gap?: number; // For hide fields
  topOffset?: number; // Optional vertical offset
};
