"use client";

import {
  createContext,
  useContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

/**
 * Grid interaction state — shared across table-view and child components
 * to reduce prop drilling. Holds cell selection, editing, and draft edits.
 *
 * Read-only state (searchQuery, sorting, filtering) stays as props since it's
 * managed at the workspace level and doesn't change frequently within the grid.
 */

export type GridState = {
  // Cell interaction state
  selectedCell: { rowId: string; columnId: string } | null;
  editingCell: { rowId: string; columnId: string } | null;
  cellEdits: Record<string, Record<string, string>>;
  expandedRowId: string | null;
};

export type GridActions = {
  setSelectedCell: Dispatch<
    SetStateAction<{ rowId: string; columnId: string } | null>
  >;
  setEditingCell: Dispatch<
    SetStateAction<{ rowId: string; columnId: string } | null>
  >;
  setCellEdits: Dispatch<
    SetStateAction<Record<string, Record<string, string>>>
  >;
};

type GridContextType = {
  state: GridState;
  actions: GridActions;
};

const GridStateContext = createContext<GridContextType | null>(null);

export function GridStateProvider({
  children,
  state,
  actions,
}: {
  children: ReactNode;
  state: GridState;
  actions: GridActions;
}) {
  return (
    <GridStateContext.Provider value={{ state, actions }}>
      {children}
    </GridStateContext.Provider>
  );
}

/**
 * Hook to access both state and actions.
 * Use when you need to read AND modify grid interaction state.
 * Throws if used outside GridStateProvider.
 */
export function useGridState() {
  const context = useContext(GridStateContext);
  if (!context) {
    throw new Error("useGridState must be used within GridStateProvider");
  }
  return context;
}

/**
 * Hook to access read-only state.
 * Use when you only need to read grid interaction state.
 * Returns null if used outside GridStateProvider (safe for optional usage).
 */
export function useGridStateReadonly() {
  const context = useContext(GridStateContext);
  return context?.state ?? null;
}
