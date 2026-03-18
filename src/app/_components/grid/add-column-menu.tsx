"use client";

import { useEffect, useRef, useState } from "react";
import type { FC, SVGProps } from "react";
import HelpIcon from "~/assets/help.svg";
import LightArrowIcon from "~/assets/light-arrow.svg";
import NameIcon from "~/assets/name.svg";
import NotesIcon from "~/assets/notes.svg";
import NumberIcon from "~/assets/number.svg";
import SearchIcon from "~/assets/search.svg";
import type { ColumnFieldType } from "~/lib/types";
import { getDefaultAddColumnName } from "~/lib/utils";
import {
  ADD_COLUMN_MENU_WIDTH,
  ADD_COLUMN_MENU_RIGHT_OFFSET,
  ADD_COLUMN_MENU_BOTTOM_OFFSET,
  ADD_COLUMN_OPTION_WIDTH,
  STANDARD_FIELDS_HEIGHT,
  NAMING_FIELDS_HEIGHT,
} from "~/lib/constants";
import { PRIMARY_BLUE, BORDER_GRAY, HOVER_GRAY, TEXT_PRIMARY } from "~/lib/colors";
import styles from "./styles/add-column-menu.module.css";

const addColumnTypeOptions: Array<{
  type: ColumnFieldType;
  label: string;
  icon: { Icon: FC<SVGProps<SVGSVGElement>>; width: number; height: number; gap: number; paddingLeft: number };
}> = [
  {
    type: "single_line_text",
    label: "Single line text",
    icon: { Icon: NameIcon, width: 12, height: 12, gap: 10, paddingLeft: 8 },
  },
  {
    type: "long_text",
    label: "Long line text",
    icon: { Icon: NotesIcon, width: 15, height: 13, gap: 8, paddingLeft: 7 },
  },
  {
    type: "number",
    label: "Number",
    icon: { Icon: NumberIcon, width: 14, height: 14, gap: 9, paddingLeft: 7 },
  },
];

interface AddColumnMenuProps {
  existingColumnNames: string[];
  onCreateColumn: (name: string, type: ColumnFieldType) => void;
  onClose: () => void;
}

export function AddColumnMenu({
  existingColumnNames,
  onCreateColumn,
  onClose,
}: AddColumnMenuProps) {
  const [selectedFieldType, setSelectedFieldType] = useState<ColumnFieldType | null>(null);
  const [columnNameInput, setColumnNameInput] = useState("");
  const [cancelHovered, setCancelHovered] = useState(false);
  const columnNameInputRef = useRef<HTMLInputElement>(null);

  const handleSelectFieldType = (type: ColumnFieldType) => {
    setSelectedFieldType(type);
    setTimeout(() => {
      columnNameInputRef.current?.focus();
    }, 50);
  };

  const handleCancelFieldCreation = () => {
    setSelectedFieldType(null);
    setColumnNameInput("");
    setCancelHovered(false);
  };

  const handleCreateField = () => {
    if (!selectedFieldType) return;
    const finalName = columnNameInput.trim() || getDefaultAddColumnName(selectedFieldType, existingColumnNames);
    onCreateColumn(finalName, selectedFieldType);
    onClose();
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const isNaming = selectedFieldType !== null;
  const selectedOption = addColumnTypeOptions.find((o) => o.type === selectedFieldType);

  return (
    <div
      className={`${styles.menu} airtable-add-column-menu airtable-dropdown-surface`}
      style={{
        width: ADD_COLUMN_MENU_WIDTH,
        top: `calc(100% + ${ADD_COLUMN_MENU_BOTTOM_OFFSET}px)`,
        right: ADD_COLUMN_MENU_RIGHT_OFFSET,
        height: isNaming ? NAMING_FIELDS_HEIGHT : STANDARD_FIELDS_HEIGHT,
        "--primary-blue": PRIMARY_BLUE,
        "--border-gray": BORDER_GRAY,
        "--hover-gray": HOVER_GRAY,
        "--text-primary": TEXT_PRIMARY,
      } as React.CSSProperties}
      onClick={(event) => event.stopPropagation()}
    >
      {/* Standard fields view */}
      <div
        className={`${styles.standardView} ${
          isNaming ? styles.standardViewHidden : styles.standardViewVisible
        }`}
      >
        <div className="airtable-add-column-header">
          <div className="airtable-add-column-search">
            <SearchIcon
              className="h-[14px] w-[14px] flex-shrink-0"
              style={{ mixBlendMode: "darken" }}
            />
            <span className="airtable-add-column-placeholder">Find a field type</span>
          </div>
          <HelpIcon className="airtable-add-column-help" />
        </div>
        <div
          className={`airtable-dropdown-separator ${styles.separator}`}
          aria-hidden="true"
        />
        <div className="airtable-add-column-body">
          <div className="airtable-dropdown-heading">Standard fields</div>
          <div className="airtable-add-column-options">
            {addColumnTypeOptions.map((option) => (
              <button
                key={option.type}
                type="button"
                className={`${styles.optionButton} airtable-add-column-option airtable-dropdown-body`}
                style={{
                  width: ADD_COLUMN_OPTION_WIDTH,
                  paddingLeft: option.icon.paddingLeft,
                  gap: option.icon.gap,
                }}
                onClick={() => handleSelectFieldType(option.type)}
              >
                <option.icon.Icon
                  className={styles.icon}
                  style={{
                    width: option.icon.width,
                    height: option.icon.height,
                  }}
                />
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Naming view */}
      <div
        className={`${styles.namingView} ${
          isNaming ? styles.namingViewVisible : styles.namingViewHidden
        }`}
      >
        <input
          ref={columnNameInputRef}
          type="text"
          value={columnNameInput}
          onChange={(e) => setColumnNameInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleCreateField();
            }
          }}
          placeholder="Field name (optional)"
          className={`${styles.columnNameInput} airtable-column-name-input`}
        />
        <button
          type="button"
          className={`${styles.displayButton} airtable-outline airtable-selection-hover`}
          onClick={handleCancelFieldCreation}
          style={{
            paddingLeft: selectedOption?.icon.paddingLeft ?? 8,
            gap: selectedOption?.icon.gap ?? 10,
          }}
        >
          {(() => {
            const IconComp = selectedOption?.icon.Icon ?? NameIcon;
            return (
              <IconComp
                className={styles.icon}
                style={{
                  width: selectedOption?.icon.width ?? 12,
                  height: selectedOption?.icon.height ?? 12,
                }}
              />
            );
          })()}
          <span className={styles.label}>
            {selectedOption?.label ?? "Single line text"}
          </span>
          <LightArrowIcon
            className={`h-[6px] w-[10px] ${styles.arrowIcon}`}
          />
        </button>
        {/* Cancel button with hover rectangle */}
        <div
          className={styles.cancelContainer}
          onMouseEnter={() => setCancelHovered(true)}
          onMouseLeave={() => setCancelHovered(false)}
          onClick={handleCancelFieldCreation}
          style={{
            background: cancelHovered ? HOVER_GRAY : "transparent",
          }}
        >
          <span className={styles.cancelText}>Cancel</span>
        </div>
        {/* Create field button */}
        <button
          type="button"
          onClick={handleCreateField}
          className={`${styles.createButton} airtable-shadow`}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.12)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = "0 0 6.5px rgba(0, 0, 0, 0.0578)";
          }}
        >
          Create field
        </button>
      </div>
    </div>
  );
}
