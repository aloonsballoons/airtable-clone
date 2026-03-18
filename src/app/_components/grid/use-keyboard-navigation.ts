import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCallback } from "react";
import type { ColumnFieldType, TableRow } from "~/lib/types";

/**
 * Keyboard navigation for grid cells
 * Handles arrow keys, tab, enter, and direct character entry
 */

interface UseKeyboardNavigationParams {
  columnOrder: string[];
  sortedTableData: TableRow[];
  rowIndexMap: Map<string, number>;
  columnIndexMap: Map<string, number>;
  editingCell: { rowId: string; columnId: string } | null;
  onFocusCell: (rowId: string, columnId: string) => void;
  onCommitCell: (rowId: string, columnId: string, value: string) => void;
  onBeginEdit: (rowId: string, columnId: string, initialValue: string) => boolean;
  onSetEditingCellNull: () => void;
}

function isPrintableKey(event: ReactKeyboardEvent): boolean {
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
}

export function useKeyboardNavigation({
  columnOrder,
  sortedTableData,
  rowIndexMap,
  columnIndexMap,
  editingCell,
  onFocusCell,
  onCommitCell,
  onBeginEdit,
  onSetEditingCellNull,
}: UseKeyboardNavigationParams) {
  const handleCellKeyDown = useCallback(
    (
      event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
      rowId: string,
      columnId: string,
      columnType: ColumnFieldType,
      currentValue: string,
    ) => {
      if (columnOrder.length === 0 || sortedTableData.length === 0) return;
      const rowIndex = rowIndexMap.get(rowId) ?? -1;
      const colIndex = columnIndexMap.get(columnId) ?? -1;
      if (rowIndex === -1 || colIndex === -1) return;

      const isEditing =
        editingCell?.rowId === rowId && editingCell?.columnId === columnId;
      const isLongText = columnType === "long_text";

      // -----------------------------------------------------------------------
      // Navigation helper — moves focus to the next cell
      // -----------------------------------------------------------------------
      const navigate = () => {
        let nextRow = rowIndex;
        let nextCol = colIndex;

        if (event.key === "ArrowRight") {
          nextCol = Math.min(columnOrder.length - 1, colIndex + 1);
        } else if (event.key === "ArrowLeft") {
          nextCol = Math.max(0, colIndex - 1);
        } else if (event.key === "ArrowDown") {
          nextRow = Math.min(sortedTableData.length - 1, rowIndex + 1);
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
          } else if (rowIndex < sortedTableData.length - 1) {
            nextRow = rowIndex + 1;
            nextCol = 0;
          }
        } else {
          return;
        }

        event.preventDefault();
        onFocusCell(sortedTableData[nextRow]!.id, columnOrder[nextCol]!);
      };

      // -----------------------------------------------------------------------
      // Not editing: handle navigation and entry initiation
      // -----------------------------------------------------------------------
      if (!isEditing) {
        // Arrow and Tab navigation
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

        // Enter: begin editing (add newline for long_text)
        if (event.key === "Enter") {
          event.preventDefault();
          const nextValue = isLongText ? `${currentValue}\n` : currentValue;
          const success = onBeginEdit(rowId, columnId, nextValue);
          if (success && isLongText) {
            // For long_text, we already set the initial newline above
          }
          return;
        }

        // Printable characters: begin editing with the character as initial value
        if (
          isPrintableKey(event) ||
          event.key === "Backspace" ||
          event.key === "Delete"
        ) {
          event.preventDefault();
          const nextValue =
            event.key === "Backspace" || event.key === "Delete"
              ? ""
              : isLongText
                ? `${currentValue}${event.key}`
                : event.key;
          const success = onBeginEdit(rowId, columnId, nextValue);
          if (!success) {
            return;
          }
        }
        return;
      }

      // -----------------------------------------------------------------------
      // Editing: handle commit and navigation
      // -----------------------------------------------------------------------

      // For non-long_text: Enter commits and moves down
      if (!isLongText && event.key === "Enter") {
        event.preventDefault();
        onCommitCell(rowId, columnId, currentValue);
        onSetEditingCellNull();
        const nextRow = Math.min(sortedTableData.length - 1, rowIndex + 1);
        onFocusCell(sortedTableData[nextRow]!.id, columnId);
        return;
      }

      // Tab: commits and navigates
      if (event.key === "Tab") {
        event.preventDefault();
        onCommitCell(rowId, columnId, currentValue);
        onSetEditingCellNull();
        navigate();
      }
    },
    [
      columnOrder,
      sortedTableData,
      rowIndexMap,
      columnIndexMap,
      editingCell,
      onFocusCell,
      onCommitCell,
      onBeginEdit,
      onSetEditingCellNull,
    ],
  );

  return { handleCellKeyDown };
}
