"use client";

import { memo } from "react";
import type { Dispatch, SetStateAction, RefObject } from "react";
import clsx from "clsx";
import HideFieldsIcon from "~/assets/hide-fields.svg";
import HideFieldsActiveIcon from "~/assets/hide-fields-active.svg";
import ThreeDotIcon from "~/assets/three-dot.svg";
import {
  HIDE_FIELDS_DROPDOWN_WIDTH,
  HIDE_FIELDS_HEADER_LEFT,
  HIDE_FIELDS_HEADER_TOP,
  HIDE_FIELDS_HELP_LEFT,
  HIDE_FIELDS_HELP_TOP,
  HIDE_FIELDS_SEPARATOR_LEFT,
  HIDE_FIELDS_SEPARATOR_TOP,
  HIDE_FIELDS_SEPARATOR_WIDTH,
  HIDE_FIELDS_SEPARATOR_HEIGHT,
  HIDE_FIELDS_HOVER_LEFT,
  HIDE_FIELDS_HOVER_WIDTH,
  HIDE_FIELDS_TOGGLE_LEFT,
  HIDE_FIELDS_TOGGLE_WIDTH,
  HIDE_FIELDS_TOGGLE_HEIGHT,
  HIDE_FIELDS_TEXT_LEFT,
  HIDE_FIELDS_REORDER_WIDTH,
  HIDE_FIELDS_REORDER_HEIGHT,
  HIDE_FIELDS_REORDER_LEFT,
  HIDE_FIELDS_BUTTON_WIDTH,
  type HideFieldsRow,
} from "./use-hide-fields";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface HideFieldsSectionProps {
  buttonLeft: number;
  hideFieldsButtonRef: RefObject<HTMLButtonElement | null>;
  hideFieldsMenuRef: RefObject<HTMLDivElement | null>;
  hideFieldsTextRef: RefObject<HTMLSpanElement | null>;
  isHideFieldsMenuOpen: boolean;
  setIsHideFieldsMenuOpen: Dispatch<SetStateAction<boolean>>;
  hiddenFieldCount: number;
  hiddenColumnIdSet: Set<string>;
  hideFieldsButtonWidth: number;
  hideFieldsLayout: {
    dropdownHeight: number;
    buttonTop: number;
    rows: HideFieldsRow[];
  };
  toggleHiddenColumn: (id: string) => void;
  hideAllColumns: () => void;
  showAllColumns: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function HideFieldsSectionComponent({
  buttonLeft,
  hideFieldsButtonRef,
  hideFieldsMenuRef,
  hideFieldsTextRef,
  isHideFieldsMenuOpen,
  setIsHideFieldsMenuOpen,
  hiddenFieldCount,
  hiddenColumnIdSet,
  hideFieldsButtonWidth,
  hideFieldsLayout,
  toggleHiddenColumn,
  hideAllColumns,
  showAllColumns,
}: HideFieldsSectionProps) {
  const hideFieldsText = hiddenFieldCount > 0
    ? `${hiddenFieldCount} hidden field${hiddenFieldCount === 1 ? "" : "s"}`
    : "Hide fields";

  return (
    <div className="absolute top-0" style={{ left: buttonLeft, transition: "left 0.2s ease" }}>
      <button
        ref={hideFieldsButtonRef}
        type="button"
        className={clsx(
          "airtable-table-feature-selection relative mt-[10px] h-[26px] !min-w-0 !px-0",
          hiddenFieldCount > 0 &&
            "airtable-table-feature-selection--hide-active"
        )}
        style={{
          width: hideFieldsButtonWidth,
          transition: "width 0.2s ease",
          ["--hover-left" as string]: "-4px",
          ["--hover-right" as string]: hiddenFieldCount > 0 ? "10px" : "-8px",
        } as React.CSSProperties}
        onClick={() => setIsHideFieldsMenuOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={isHideFieldsMenuOpen}
      >
        <HideFieldsActiveIcon
          className="absolute"
          style={{ left: 4, top: 4, width: 18, height: 16, opacity: hiddenFieldCount > 0 ? 1 : 0, transition: "opacity 0.2s ease" }}
        />
        <HideFieldsIcon
          className="absolute left-[4px] top-[5px] h-[16px] w-[19px]"
          style={{ opacity: hiddenFieldCount > 0 ? 0 : 1, transition: "opacity 0.2s ease" }}
        />
        <span
          ref={hideFieldsTextRef}
          className={clsx(
            "absolute left-[25px] top-[5px] block h-[16px] text-[13px] leading-[16px]",
            hiddenFieldCount > 0 && "text-[#1D1F24]"
          )}
          style={hiddenFieldCount > 0 ? { whiteSpace: "nowrap" } : { width: "72px" }}
        >
          {hideFieldsText}
        </span>
      </button>
      {isHideFieldsMenuOpen && (
        <div
          ref={hideFieldsMenuRef}
          className="airtable-hide-fields-dropdown airtable-dropdown-surface absolute right-[-8px] top-[40px] z-[120]"
          style={{
            width: HIDE_FIELDS_DROPDOWN_WIDTH,
            height: hideFieldsLayout.dropdownHeight,
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="relative h-full w-full">
            <div
              className="absolute airtable-find-field-label"
              style={{
                left: HIDE_FIELDS_HEADER_LEFT,
                top: HIDE_FIELDS_HEADER_TOP,
              }}
            >
              Find a field
            </div>
            <span
              className="airtable-help-icon absolute text-[#878B94]"
              style={{
                left: HIDE_FIELDS_HELP_LEFT,
                top: HIDE_FIELDS_HELP_TOP,
                width: 14,
                height: 14,
              }}
              aria-hidden="true"
            />
            <div
              className="absolute bg-[#E4E4E4]"
              style={{
                left: HIDE_FIELDS_SEPARATOR_LEFT,
                top: HIDE_FIELDS_SEPARATOR_TOP,
                width: HIDE_FIELDS_SEPARATOR_WIDTH,
                height: HIDE_FIELDS_SEPARATOR_HEIGHT,
              }}
              aria-hidden="true"
            />
            {hideFieldsLayout.rows.map((row) => {
              const isHidden = hiddenColumnIdSet.has(row.column.id);
              return (
                <button
                  key={row.column.id}
                  type="button"
                  className="airtable-hide-fields-row"
                  style={{
                    top: row.hoverTop,
                    width: HIDE_FIELDS_HOVER_WIDTH,
                  }}
                  onClick={() => toggleHiddenColumn(row.column.id)}
                  aria-pressed={!isHidden}
                >
                  <svg
                    className="airtable-hide-fields-toggle absolute"
                    width={HIDE_FIELDS_TOGGLE_WIDTH}
                    height={HIDE_FIELDS_TOGGLE_HEIGHT}
                    viewBox={`0 0 ${HIDE_FIELDS_TOGGLE_WIDTH} ${HIDE_FIELDS_TOGGLE_HEIGHT}`}
                    style={{
                      left:
                        HIDE_FIELDS_TOGGLE_LEFT -
                        HIDE_FIELDS_HOVER_LEFT,
                      top: row.toggleOffset,
                    }}
                    aria-hidden="true"
                  >
                    <rect
                      x="0"
                      y="0"
                      width={HIDE_FIELDS_TOGGLE_WIDTH}
                      height={HIDE_FIELDS_TOGGLE_HEIGHT}
                      rx="4"
                      fill={isHidden ? "#D9D9D9" : "#09890E"}
                      style={{ transition: "fill 0.15s ease" }}
                    />
                    <rect
                      x={0}
                      y={2}
                      width={4}
                      height={4}
                      rx={2}
                      fill="#FFFFFF"
                      style={{
                        transform: `translateX(${isHidden ? 2 : 7}px)`,
                        transition: "transform 0.15s ease",
                      }}
                    />
                  </svg>
                  <row.iconSpec.Icon
                    className="airtable-hide-fields-icon absolute"
                    style={{
                      left: row.iconLeftOffset,
                      top: row.iconTopOffset,
                      width: row.iconSpec.width,
                      height: row.iconSpec.height,
                    }}
                  />
                  <span
                    className="airtable-hide-fields-label absolute"
                    style={{
                      left: HIDE_FIELDS_TEXT_LEFT - HIDE_FIELDS_HOVER_LEFT,
                      top: row.textOffset,
                    }}
                  >
                    {row.column.name}
                  </span>
                  <ThreeDotIcon
                    className="airtable-hide-fields-reorder absolute"
                    style={{
                      left: HIDE_FIELDS_REORDER_LEFT - HIDE_FIELDS_HOVER_LEFT,
                      top: row.reorderOffset,
                      width: HIDE_FIELDS_REORDER_WIDTH,
                      height: HIDE_FIELDS_REORDER_HEIGHT,
                    }}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
            <button
              type="button"
              className="airtable-hide-fields-action absolute"
              style={{ left: 16, top: hideFieldsLayout.buttonTop }}
              onClick={hideAllColumns}
            >
              Hide all
            </button>
            <button
              type="button"
              className="airtable-hide-fields-action absolute"
              style={{
                left:
                  HIDE_FIELDS_DROPDOWN_WIDTH -
                  16 -
                  HIDE_FIELDS_BUTTON_WIDTH,
                top: hideFieldsLayout.buttonTop,
              }}
              onClick={showAllColumns}
            >
              Show all
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export const HideFieldsSection = memo(HideFieldsSectionComponent);
