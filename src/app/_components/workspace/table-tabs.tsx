"use client";

import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";

import LightArrowIcon from "~/assets/light-arrow.svg";
import LightMailIcon from "~/assets/light-mail.svg";
import PlusIcon from "~/assets/plus.svg";
import { isValidUUID } from "~/lib/utils";

type TableTabsProps = {
  activeTables: Array<{ id: string; name: string }>;
  activeTableId: string | null;
  onSelectTable: (tableId: string) => void;
  baseId: string;
  newTableId: string | null;
  setNewTableId: (id: string | null) => void;
  addTableMutate: (params: { baseId: string; name: string }) => void;
  addTableDisabled: boolean;
  renameTableMutate: (params: { tableId: string; name: string }) => void;
};

const MAX_TABLES = 1000;

export function TableTabs({
  activeTables,
  activeTableId,
  onSelectTable,
  baseId,
  newTableId,
  setNewTableId,
  addTableMutate,
  addTableDisabled,
  renameTableMutate,
}: TableTabsProps) {
  const [addTableDropdownStage, setAddTableDropdownStage] = useState<
    "add-options" | "name-input" | null
  >(null);
  const [tableName, setTableName] = useState("");
  const [dropdownPosition, setDropdownPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [hoveredTableTabId, setHoveredTableTabId] = useState<string | null>(
    null,
  );

  const addTableButtonRef = useRef<HTMLButtonElement>(null);
  const tableNameInputRef = useRef<HTMLInputElement>(null);
  const addTableDropdownRef = useRef<HTMLDivElement>(null);
  const newTableTabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Handle click outside for add table dropdown
  useEffect(() => {
    if (!addTableDropdownStage) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (target instanceof Element) {
        if (addTableDropdownRef.current?.contains(target)) return;
        if (addTableButtonRef.current?.contains(target)) return;
      }
      setAddTableDropdownStage(null);
      setTableName("");
      setDropdownPosition(null);
      setNewTableId(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAddTableDropdownStage(null);
        setTableName("");
        setDropdownPosition(null);
        setNewTableId(null);
      } else if (
        event.key === "Enter" &&
        addTableDropdownStage === "name-input"
      ) {
        event.preventDefault();
        setTableName((currentName) => {
          if (currentName.trim() && newTableId && isValidUUID(newTableId)) {
            renameTableMutate({
              tableId: newTableId,
              name: currentName.trim(),
            });
            setAddTableDropdownStage(null);
            setDropdownPosition(null);
            setNewTableId(null);
            return "";
          }
          return currentName;
        });
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    addTableDropdownStage,
    newTableId,
    renameTableMutate,
    setNewTableId,
  ]);

  // Show naming dropdown when new table is created (immediately, even with optimistic temp ID)
  useEffect(() => {
    if (!newTableId || addTableDropdownStage === "name-input") return;
    // Wait for the table tab to render
    const timer = setTimeout(() => {
      const tabElement = newTableTabRefs.current.get(newTableId);
      if (!tabElement) {
        // Tab not found yet, wait a bit longer
        setTimeout(() => {
          const retryElement = newTableTabRefs.current.get(newTableId);
          if (!retryElement) return;
          positionDropdown(retryElement);
        }, 50);
        return;
      }
      positionDropdown(tabElement);
    }, 0);

    const positionDropdown = (tabElement: HTMLButtonElement) => {
      const tabRect = tabElement.getBoundingClientRect();
      // Position left edge of dropdown 73px to the left of the left edge of the tab, 6px below
      let left = tabRect.left - 73;
      const top = tabRect.bottom + 6;
      const dropdownWidth = 335;

      // Keep within viewport
      if (left + dropdownWidth > window.innerWidth) {
        left = Math.max(0, window.innerWidth - dropdownWidth - 10);
      }
      left = Math.max(0, left);

      setDropdownPosition({ left, top });
      setAddTableDropdownStage("name-input");

      // Focus and select input
      setTimeout(() => {
        if (tableNameInputRef.current) {
          tableNameInputRef.current.select();
        }
      }, 0);
    };

    return () => clearTimeout(timer);
  }, [newTableId, addTableDropdownStage]);

  const handleAddTable = useCallback(() => {
    if (!addTableButtonRef.current) return;
    const buttonRect = addTableButtonRef.current.getBoundingClientRect();
    // Position 14px to the left and 18px down from plus.svg
    let left = buttonRect.left - 14;
    const top = buttonRect.bottom + 18;
    // Keep within viewport
    const dropdownWidth = 281;
    if (left + dropdownWidth > window.innerWidth) {
      left = Math.max(0, window.innerWidth - dropdownWidth - 10);
    }
    left = Math.max(0, left);
    setDropdownPosition({ left, top });
    setAddTableDropdownStage("add-options");
  }, []);

  const handleStartFromScratch = useCallback(() => {
    const tableCount = activeTables.length;
    const defaultName = `Table ${tableCount + 1}`;
    setTableName(defaultName);

    // Close the first dropdown
    setAddTableDropdownStage(null);

    // Create the table immediately with default name
    addTableMutate({ baseId, name: defaultName });
  }, [activeTables.length, addTableMutate, baseId]);

  const handleConfirmTableName = useCallback(() => {
    if (!tableName.trim() || !newTableId || !isValidUUID(newTableId)) return;
    // Rename the newly created table
    renameTableMutate({ tableId: newTableId, name: tableName.trim() });
    setAddTableDropdownStage(null);
    setTableName("");
    setDropdownPosition(null);
    setNewTableId(null);
  }, [tableName, newTableId, renameTableMutate, setNewTableId]);

  const handleCancelTableName = useCallback(() => {
    setAddTableDropdownStage(null);
    setTableName("");
    setDropdownPosition(null);
    setNewTableId(null);
  }, [setNewTableId]);

  return (
    <div className="relative h-[31px] bg-[#FFF0FF]">
      <div
        className="pointer-events-none absolute bottom-0 left-0 right-0 z-[1] h-px bg-[#E5DAE5]"
        aria-hidden="true"
      />
      <div className="flex h-full min-w-0 items-stretch">
        <div className="min-w-0 flex-1 overflow-x-auto">
          <div
            className="flex h-full w-max min-w-full items-stretch pr-[12px]"
            onMouseLeave={() => setHoveredTableTabId(null)}
          >
            {activeTables.map((tableItem, index) => {
              const isActive = tableItem.id === activeTableId;
              const previousTable = activeTables[index - 1];
              const nextTable = activeTables[index + 1];
              const isHovered = hoveredTableTabId === tableItem.id;
              const previousIsActive =
                previousTable?.id === activeTableId;
              const previousIsHovered =
                previousTable?.id === hoveredTableTabId;
              const nextIsActive = nextTable?.id === activeTableId;
              const showLeftDivider =
                index > 0 &&
                !isActive &&
                !previousIsActive &&
                !isHovered &&
                !previousIsHovered;
              return (
                <div
                  key={tableItem.id}
                  className="flex h-full items-stretch"
                >
                  <span
                    className={clsx(
                      "h-[12px] self-center bg-[#E5DAE5]",
                      index === 0 ? "w-0" : "w-px",
                      showLeftDivider ? "opacity-100" : "opacity-0",
                    )}
                    aria-hidden="true"
                  />
                  <button
                    ref={(el) => {
                      if (el) {
                        newTableTabRefs.current.set(tableItem.id, el);
                      } else {
                        newTableTabRefs.current.delete(tableItem.id);
                      }
                    }}
                    type="button"
                    onClick={() => onSelectTable(tableItem.id)}
                    onMouseEnter={() =>
                      setHoveredTableTabId(tableItem.id)
                    }
                    onMouseLeave={() => setHoveredTableTabId(null)}
                    className={clsx(
                      "relative flex h-[31px] items-start whitespace-nowrap rounded-t-[3px] rounded-b-none px-[12px] pt-[8px] text-[13px] leading-[13px]",
                      isActive
                        ? "airtable-table-tab-active z-[2] bg-white text-[#1D1F24]"
                        : "text-[#595359] hover:bg-[#EBDEEB] hover:text-[#1D1F24]",
                    )}
                    style={
                      isActive
                        ? {
                            border: "0.5px solid #D7CBD6",
                            borderBottom: "none",
                          }
                        : undefined
                    }
                  >
                    {!isActive && isHovered && (
                      <span
                        className={clsx(
                          "pointer-events-none absolute bottom-0 top-0 rounded-t-[3px] bg-[#EBDEEB]",
                          previousIsActive
                            ? "-left-[8px] right-0"
                            : "left-0 right-0",
                          nextIsActive && "left-0 -right-[8px]",
                        )}
                        aria-hidden="true"
                      />
                    )}
                    <span
                      className={clsx(
                        "relative z-[1]",
                        isActive ? "font-medium" : "font-normal",
                      )}
                    >
                      {tableItem.name}
                    </span>
                    {isActive && (
                      <LightArrowIcon className="relative z-[1] ml-[6px] mt-[5px] h-[5.8px] w-[10.02px] mix-blend-multiply" />
                    )}
                  </button>
                </div>
              );
            })}
            <span
              className={clsx(
                "h-[12px] w-px self-center bg-[#E5DAE5]",
                (hoveredTableTabId ===
                  activeTables[activeTables.length - 1]?.id ||
                  activeTableId ===
                    activeTables[activeTables.length - 1]?.id) &&
                  "opacity-0",
              )}
              aria-hidden="true"
            />
            <LightArrowIcon className="ml-[15px] mt-[13px] h-[5.8px] w-[10.02px] flex-shrink-0 mix-blend-multiply" />
            <button
              ref={addTableButtonRef}
              type="button"
              onClick={handleAddTable}
              disabled={addTableDisabled}
              className={clsx(
                "relative ml-[30px] mt-[10px] h-[12px] w-[12px] flex-shrink-0",
                addTableDisabled
                  ? "cursor-not-allowed opacity-40"
                  : "cursor-pointer",
              )}
              aria-label="Add table"
            >
              <PlusIcon className="h-[12px] w-[12px]" />
            </button>
            {addTableDropdownStage === "add-options" &&
              dropdownPosition && (
                <div
                  ref={addTableDropdownRef}
                  className="fixed z-[200]"
                  style={{
                    left: dropdownPosition.left,
                    top: dropdownPosition.top,
                    width: 281,
                    height: 70,
                  }}
                >
                  <div className="relative h-full w-full rounded-[6px] border-[1px] border-[#DADADA] bg-white shadow-[0_10px_24px_rgba(15,23,42,0.12)]">
                    <div
                      className={clsx(
                        "font-inter",
                        "absolute left-[16px] top-[7px]",
                      )}
                    >
                      <p className="text-[11px] font-normal leading-[11px] text-[#616670]">
                        Add a blank table
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleStartFromScratch}
                      className="group absolute cursor-pointer"
                      style={{
                        left: 0,
                        top: 0,
                        width: 281,
                        height: 70,
                      }}
                    >
                      <span className="absolute left-[8px] top-[26px] h-[34px] w-[263px] rounded-[3px] bg-transparent group-hover:bg-[#F2F2F2]" />
                      <span
                        className={clsx(
                          "font-inter",
                          "absolute z-10 text-[13px] font-normal leading-[13px] text-[#1D1F24]",
                        )}
                        style={{ left: 16, top: 36 }}
                      >
                        Start from scratch
                      </span>
                    </button>
                  </div>
                </div>
              )}
            {addTableDropdownStage === "name-input" &&
              dropdownPosition && (
                <div
                  ref={addTableDropdownRef}
                  className="fixed z-[200]"
                  style={{
                    left: dropdownPosition.left,
                    top: dropdownPosition.top,
                    width: 335,
                  }}
                >
                  <div
                    className="relative rounded-[6px] border-[2px] border-[#E5E5E5]/90 bg-white"
                    style={{ height: 216 }}
                  >
                    {/* Table name input */}
                    <input
                      ref={tableNameInputRef}
                      type="text"
                      value={tableName}
                      onChange={(e) => setTableName(e.target.value)}
                      className={clsx(
                        "font-inter",
                        "absolute h-[38px] w-[299px] rounded-[3px] border-[2px] border-[#176EE1] px-[10px] text-[14px] font-normal leading-[14px] text-[#1D1F24] outline-none",
                      )}
                      style={{ left: 18, top: 18 }}
                      placeholder=""
                    />
                    {/* "What should each record be called?" label */}
                    <span
                      className={clsx(
                        "font-inter",
                        "absolute text-[14px] font-normal leading-[14px] text-[#55565D]",
                      )}
                      style={{ left: 18, top: 72 }}
                    >
                      What should each record be called?
                    </span>
                    {/* help.svg icon 14x14 */}
                    <svg
                      className="absolute"
                      style={{ left: 302, top: 72 }}
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 15 15"
                      fill="none"
                    >
                      <circle
                        cx="7.5"
                        cy="7.5"
                        r="6.5"
                        stroke="#55565D"
                        strokeWidth="1.2"
                      />
                      <path
                        d="M6 5.9C6 4.8 6.9 4.2 7.5 4.2C8.2 4.2 9 4.7 9 5.6C9 6.6 8.2 7 7.8 7.4C7.4 7.7 7.3 8 7.3 8.7V9.1"
                        stroke="#55565D"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <circle cx="7.5" cy="11.1" r="0.8" fill="#55565D" />
                    </svg>
                    {/* Record selector rectangle */}
                    <div
                      className="absolute rounded-[6px]"
                      style={{
                        left: 18,
                        top: 98,
                        width: 299,
                        height: 34,
                        background: "#F6F7FA",
                      }}
                    >
                      <span
                        className={clsx(
                          "font-inter",
                          "absolute text-[13px] font-normal leading-[13px] text-[#55565D]",
                        )}
                        style={{ left: 8, top: 9 }}
                      >
                        Record
                      </span>
                      {/* Down arrow */}
                      <svg
                        className="absolute"
                        style={{ left: 278, top: 14 }}
                        xmlns="http://www.w3.org/2000/svg"
                        width="10"
                        height="6"
                        viewBox="0 0 10 6"
                        fill="none"
                      >
                        <path
                          d="M1 1L5 5L9 1"
                          stroke="#55565D"
                          strokeWidth="1.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                    {/* Examples row */}
                    <span
                      className={clsx(
                        "font-inter",
                        "absolute text-[11px] font-normal leading-[11px] text-[#55565D]",
                      )}
                      style={{ left: 18, top: 142 }}
                    >
                      Examples
                    </span>
                    {/* plus.svg 12x12 */}
                    <svg
                      className="absolute"
                      style={{ left: 78, top: 142 }}
                      xmlns="http://www.w3.org/2000/svg"
                      width="12"
                      height="12"
                      viewBox="0 0 13 13"
                      fill="none"
                    >
                      <rect
                        x="0"
                        y="6"
                        width="13"
                        height="1"
                        rx="0.5"
                        fill="#55565D"
                      />
                      <rect
                        x="6"
                        y="0"
                        width="1"
                        height="13"
                        rx="0.5"
                        fill="#55565D"
                      />
                    </svg>
                    <span
                      className={clsx(
                        "font-inter",
                        "absolute text-[11px] font-normal leading-[11px] text-[#55565D]",
                      )}
                      style={{ left: 95, top: 142 }}
                    >
                      Add record
                    </span>
                    {/* light-mail.svg 15x12 */}
                    <LightMailIcon
                      className="absolute"
                      style={{ left: 174, top: 142, width: 15, height: 12 }}
                    />
                    <span
                      className={clsx(
                        "font-inter",
                        "absolute text-[11px] font-normal leading-[11px] text-[#55565D]",
                      )}
                      style={{ left: 194, top: 142 }}
                    >
                      Send records
                    </span>
                    {/* Cancel and Save buttons */}
                    <div
                      className="absolute flex items-center gap-[23px]"
                      style={{ right: 18, bottom: 18 }}
                    >
                      <button
                        type="button"
                        onClick={handleCancelTableName}
                        className={clsx(
                          "font-inter",
                          "group relative cursor-pointer text-[13px] font-medium leading-[13px] text-[#1D1F24]",
                        )}
                      >
                        <span className="pointer-events-none absolute left-[-8px] top-[-6px] h-[28px] w-[58px] rounded-[5px] bg-transparent group-hover:bg-[#F2F2F2]" />
                        <span className="relative z-10">Cancel</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleConfirmTableName}
                        disabled={!tableName.trim()}
                        className={clsx(
                          "font-inter",
                          "flex h-[28px] w-[46px] cursor-pointer items-center justify-center rounded-[5px] bg-[#176EE1] text-[13px] font-medium leading-[13px] text-white shadow-[0_0_6.5px_rgba(0,0,0,0.0578)] transition-shadow hover:shadow-[0_1px_6.5px_rgba(199,200,201,0.5)] disabled:cursor-not-allowed disabled:opacity-50",
                        )}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              )}
          </div>
        </div>
        <div className="relative flex h-full flex-shrink-0 pr-[19px]">
          <button
            type="button"
            className="mt-[8px] h-[13px] text-[13px] font-normal leading-[13px] text-[#595359] hover:text-[#1D1F24]"
          >
            Tools
          </button>
          <LightArrowIcon className="ml-[7px] mt-[13px] h-[5.8px] w-[10.02px] mix-blend-multiply" />
        </div>
      </div>
    </div>
  );
}
