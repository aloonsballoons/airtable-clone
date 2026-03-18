"use client";

import { useRef, useLayoutEffect, useState } from "react";
import clsx from "clsx";
import type { UseViewManagementReturn } from "./use-view-management";
import ArrowIcon from "~/assets/arrow.svg";
import DeleteIcon from "~/assets/delete.svg";
import DuplicateIcon from "~/assets/duplicate.svg";
import GreyGridViewIcon from "~/assets/grey-grid-view.svg";
import RenameIcon from "~/assets/rename.svg";
import GridViewIcon from "~/assets/grid-view.svg";

interface ViewSelectorProps {
  viewName?: string;
  viewCount?: number;
  mgmt: UseViewManagementReturn;
}

export const ViewSelector = ({
  viewName = "Grid view",
  viewCount = 1,
  mgmt,
}: ViewSelectorProps) => {
  // Grid view name width for arrow positioning
  const gridViewNameRef = useRef<HTMLSpanElement>(null);
  const [arrowLeft, setArrowLeft] = useState(37);

  useLayoutEffect(() => {
    if (gridViewNameRef.current) {
      const textWidth = gridViewNameRef.current.scrollWidth;
      const textRight = 27 + textWidth;
      const arrowPos = textRight + 10; // 10px gap between text right edge and arrow left edge
      setArrowLeft(arrowPos);
    }
  }, [viewName, mgmt.editMode]);

  // Compute hover rectangle width dynamically based on content
  const viewButtonWidth = arrowLeft + 10 + 8; // arrow left + arrow width + right padding

  return (
    <>
      {mgmt.editMode !== null ? (
        /* 189x30 edit rectangle: stroke BFBFBF, stroke-width 2, radius 3,
           bottom edge 8.5px above container bottom → top = 46 - 8.5 - 30 = 7.5,
           x same as hover rect left (54 - 4 = 50) */
        <input
          ref={mgmt.editInputRef}
          value={mgmt.editValue}
          onChange={(e) => mgmt.setEditValue(e.target.value)}
          onBlur={mgmt.handleEditSubmit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              mgmt.handleEditSubmit();
            }
            if (e.key === "Escape") mgmt.setEditMode(null);
          }}
          className="absolute rounded-[3px] bg-white outline-none"
          style={{
            left: 50,
            top: 7.5,
            width: 189,
            height: 30,
            border: "2px solid #BFBFBF",
            fontFamily: "Inter, sans-serif",
            fontWeight: 600,
            fontSize: 14,
            color: "#1D1F24",
            paddingLeft: 8,
            paddingRight: 8,
            boxSizing: "border-box",
            zIndex: 10,
          }}
        />
      ) : (
        <button
          ref={mgmt.viewButtonRef}
          type="button"
          className="absolute left-[54px] top-0 h-full cursor-pointer border-none bg-transparent p-0 outline-none"
          style={{ minWidth: 108 }}
          onMouseEnter={() => mgmt.setIsViewButtonHovered(true)}
          onMouseLeave={() => mgmt.setIsViewButtonHovered(false)}
          onClick={mgmt.handleViewButtonClick}
        >
          {/* Hover background rectangle — extended 4px to the left */}
          <span
            className="absolute rounded-[3px] transition-colors"
            style={{
              left: -4,
              top: 10,
              width: viewButtonWidth + 4,
              height: 26,
              backgroundColor: mgmt.isViewButtonHovered || mgmt.isViewDropdownOpen ? "#F2F2F2" : "transparent",
              pointerEvents: "none",
            }}
          />
          {/* Grid view icon — swap to grey on hover */}
          <GridViewIcon
            className="absolute left-[3px] top-[16px] h-[15px] w-[16px]"
            style={{
              opacity: mgmt.isViewButtonHovered || mgmt.isViewDropdownOpen ? 0 : 1,
              transition: "opacity 0.1s ease",
            }}
          />
          <GreyGridViewIcon
            className="absolute left-[3px] top-[16px] h-[15px] w-[16px]"
            style={{
              opacity: mgmt.isViewButtonHovered || mgmt.isViewDropdownOpen ? 1 : 0,
              transition: "opacity 0.1s ease",
            }}
          />
          <span
            ref={gridViewNameRef}
            className="absolute left-[27px] top-[18px] block whitespace-nowrap text-[13px] font-medium leading-[13px] text-[#1D1F24]"
            style={{ fontFamily: "Inter, sans-serif" }}
          >
            {viewName}
          </span>
          {/* Arrow icon — mix-blend-mode: multiply turns white parts into hover bg color */}
          <ArrowIcon
            className="absolute h-[6px] w-[10px]"
            style={{
              left: arrowLeft,
              top: 22,
              mixBlendMode: mgmt.isViewButtonHovered || mgmt.isViewDropdownOpen ? "multiply" : "normal",
            }}
          />
        </button>
      )}
      {/* View dropdown */}
      {mgmt.isViewDropdownOpen && (
        <div
          ref={mgmt.viewDropdownRef}
          className="airtable-dropdown-surface absolute z-[200] rounded-[6px]"
          style={{
            left: 50, // aligned with hover rect left (button 54 - 4)
            top: 44, // button bottom (10 + 26) + 8px gap
            width: 352,
            height: 132,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="relative h-full w-full">
            {/* Rename view */}
            <button
              type="button"
              className="group/rename absolute cursor-pointer border-none bg-transparent p-0 outline-none"
              style={{ left: 12, top: 12, width: 328, height: 35 }}
              onClick={mgmt.handleRenameStart}
            >
              <span
                className="absolute rounded-[4px] transition-colors group-hover/rename:bg-[#F2F2F2]"
                style={{ left: 0, top: 0, width: 328, height: 35, pointerEvents: "none" }}
              />
              <RenameIcon
                className="absolute group-hover/rename:[mix-blend-mode:multiply]"
                style={{ left: 19 - 12, top: 23 - 12, width: 16.5, height: 14.35 }}
              />
              <span
                className="absolute text-[13px] font-normal text-[#1D1F24]"
                style={{ left: 44 - 12, top: 21 - 12, fontFamily: "Inter, sans-serif" }}
              >
                Rename view
              </span>
            </button>

            {/* Duplicate view */}
            <button
              type="button"
              className="group/dup absolute cursor-pointer border-none bg-transparent p-0 outline-none"
              style={{ left: 12, top: 46, width: 328, height: 35 }}
              onClick={mgmt.handleDuplicateStart}
            >
              <span
                className="absolute rounded-[4px] transition-colors group-hover/dup:bg-[#F2F2F2]"
                style={{ left: 0, top: 0, width: 328, height: 35, pointerEvents: "none" }}
              />
              <DuplicateIcon
                className="absolute group-hover/dup:[mix-blend-mode:multiply]"
                style={{ left: 21 - 12, top: 56 - 46, width: 15, height: 15 }}
              />
              <span
                className="absolute text-[13px] font-normal text-[#1D1F24]"
                style={{ left: 44 - 12, top: 55 - 46, fontFamily: "Inter, sans-serif" }}
              >
                Duplicate view
              </span>
            </button>

            {/* Delete view — disabled & 50% opacity when only 1 view */}
            <button
              type="button"
              className={clsx(
                "group/del absolute border-none bg-transparent p-0 outline-none",
                viewCount > 1 ? "cursor-pointer" : "cursor-default"
              )}
              style={{ left: 12, top: 80, width: 328, height: 35 }}
              onClick={viewCount > 1 ? mgmt.handleDeleteView : undefined}
            >
              {viewCount > 1 && (
                <span
                  className="absolute rounded-[4px] transition-colors group-hover/del:bg-[#F2F2F2]"
                  style={{ left: 0, top: 0, width: 328, height: 35, pointerEvents: "none" }}
                />
              )}
              <DeleteIcon
                className={clsx("absolute", viewCount > 1 && "group-hover/del:[mix-blend-mode:multiply]")}
                style={{ left: 21 - 12, top: 88 - 80 + 2, width: 14, height: 16, opacity: viewCount > 1 ? 1 : 0.5 }}
              />
              <span
                className="absolute text-[13px] font-normal"
                style={{
                  left: 44 - 12,
                  top: 89 - 80,
                  fontFamily: "Inter, sans-serif",
                  color: "#B01041",
                  opacity: viewCount > 1 ? 1 : 0.5,
                }}
              >
                Delete view
              </span>
            </button>
          </div>
        </div>
      )}
    </>
  );
};
