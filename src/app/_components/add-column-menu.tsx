"use client";

import { useEffect, useRef, useState } from "react";
import helpIcon from "~/assets/help.svg";
import lightArrowIcon from "~/assets/light-arrow.svg";
import nameIcon from "~/assets/name.svg";
import notesIcon from "~/assets/notes.svg";
import numberIcon from "~/assets/number.svg";
import searchIcon from "~/assets/search.svg";

const ADD_COLUMN_MENU_WIDTH = 400;
const ADD_COLUMN_OPTION_WIDTH = 380;
const STANDARD_FIELDS_HEIGHT = 207;
const NAMING_FIELDS_HEIGHT = 147;

type ColumnFieldType = "single_line_text" | "long_text" | "number";

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

// Preload all SVG images at module level so they're cached before the dropdown opens
if (typeof window !== "undefined") {
  for (const opt of addColumnTypeOptions) {
    const img = new Image();
    img.src = opt.icon.src;
  }
  {
    const img = new Image();
    img.src = searchIcon.src;
  }
  {
    const img = new Image();
    img.src = helpIcon.src;
  }
}

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

  const generateDefaultColumnName = (type: ColumnFieldType): string => {
    const baseNameMap: Record<ColumnFieldType, string> = {
      single_line_text: "Label",
      long_text: "Notes",
      number: "Number",
    };
    const baseName = baseNameMap[type];

    if (!existingColumnNames.includes(baseName)) {
      return baseName;
    }

    let counter = 2;
    while (existingColumnNames.includes(`${baseName} ${counter}`)) {
      counter++;
    }
    return `${baseName} ${counter}`;
  };

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
    const finalName = columnNameInput.trim() || generateDefaultColumnName(selectedFieldType);
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
      className="airtable-add-column-menu airtable-dropdown-surface absolute z-50"
      style={{
        width: ADD_COLUMN_MENU_WIDTH,
        top: "calc(100% + 2px)",
        right: 5,
        height: isNaming ? NAMING_FIELDS_HEIGHT : STANDARD_FIELDS_HEIGHT,
        transition: "height 0.2s ease",
        overflow: "hidden",
        willChange: "height",
        contain: "layout style",
      }}
      onClick={(event) => event.stopPropagation()}
    >
      {/* Standard fields view */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: isNaming ? 0 : 1,
          pointerEvents: isNaming ? "none" : "auto",
          transition: "opacity 0.15s ease",
          willChange: "opacity",
        }}
      >
        <div className="airtable-add-column-header">
          <div className="airtable-add-column-search">
            <img
              alt=""
              loading="eager"
              decoding="sync"
              className="h-[14px] w-[14px] flex-shrink-0"
              style={{ mixBlendMode: "darken" }}
              src={searchIcon.src}
            />
            <span className="airtable-add-column-placeholder">Find a field type</span>
          </div>
          <img alt="" loading="eager" decoding="sync" className="airtable-add-column-help" src={helpIcon.src} />
        </div>
        <div
          className="airtable-dropdown-separator"
          style={{ marginLeft: 6, marginTop: 6 }}
          aria-hidden="true"
        />
        <div className="airtable-add-column-body">
          <div className="airtable-dropdown-heading">Standard fields</div>
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
                onClick={() => handleSelectFieldType(option.type)}
              >
                <img
                  alt=""
                  loading="eager"
                  decoding="sync"
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

      {/* Naming view */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: isNaming ? 1 : 0,
          pointerEvents: isNaming ? "auto" : "none",
          transition: "opacity 0.15s ease",
          willChange: "opacity",
        }}
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
          className="airtable-column-name-input"
          style={{
            position: "absolute",
            left: 15,
            top: 7,
            width: 370,
            height: 34,
            borderRadius: 7,
            padding: "9px 8px",
            fontSize: 13,
            fontFamily: "Inter, sans-serif",
            fontWeight: 400,
            color: "#1d1f24",
            outline: "none",
            border: "2px solid #156FE2",
            boxShadow: "0 0 6.5px rgba(0, 0, 0, 0.0578)",
            cursor: "text",
            boxSizing: "border-box",
          }}
        />
        <button
          type="button"
          className="airtable-outline airtable-selection-hover"
          onClick={handleCancelFieldCreation}
          style={{
            position: "absolute",
            left: 15,
            top: 46,
            width: 370,
            height: 34,
            borderRadius: 7,
            display: "flex",
            alignItems: "center",
            paddingLeft: selectedOption?.icon.paddingLeft ?? 8,
            gap: selectedOption?.icon.gap ?? 10,
            fontSize: 13,
            fontFamily: "Inter, sans-serif",
            fontWeight: 400,
            color: "#1d1f24",
            background: "#ffffff",
            cursor: "pointer",
            border: "1px solid #dadada",
            boxSizing: "border-box",
          }}
        >
          <img
            alt=""
            loading="eager"
            decoding="sync"
            style={{
              width: selectedOption?.icon.width ?? 12,
              height: selectedOption?.icon.height ?? 12,
            }}
            src={selectedOption?.icon.src ?? nameIcon.src}
          />
          <span style={{ position: "relative", top: "-0.5px" }}>
            {selectedOption?.label ?? "Single line text"}
          </span>
          <img
            alt=""
            loading="eager"
            decoding="sync"
            src={lightArrowIcon.src}
            style={{
              position: "absolute",
              left: 348,
              top: 15,
              width: 10,
              height: 6,
            }}
          />
        </button>
        {/* Cancel button with hover rectangle */}
        <div
          onMouseEnter={() => setCancelHovered(true)}
          onMouseLeave={() => setCancelHovered(false)}
          onClick={handleCancelFieldCreation}
          style={{
            position: "absolute",
            left: 210,
            top: 95,
            width: 66,
            height: 32,
            borderRadius: 7,
            background: cancelHovered ? "#F2F2F2" : "transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontFamily: "Inter, sans-serif",
              fontWeight: 400,
              color: "#1d1f24",
            }}
          >
            Cancel
          </span>
        </div>
        {/* Create field button */}
        <button
          type="button"
          onClick={handleCreateField}
          className="airtable-shadow"
          style={{
            position: "absolute",
            left: 288,
            top: 95,
            width: 96,
            height: 32,
            borderRadius: 6,
            background: "#156FE2",
            border: "none",
            color: "#ffffff",
            fontSize: 13,
            fontFamily: "Inter, sans-serif",
            fontWeight: 500,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxSizing: "border-box",
          }}
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
