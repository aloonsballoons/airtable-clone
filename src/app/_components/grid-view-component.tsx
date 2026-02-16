"use client";

import { Inter } from "next/font/google";
import Image from "next/image";
import { useId, useRef, useState } from "react";

import greySearchIcon from "~/assets/grey-search.svg";
import gridViewIcon from "~/assets/grid-view.svg";
import greyGridViewIcon from "~/assets/grey-grid-view.svg";
import plusIcon from "~/assets/plus.svg";
import settingsIcon from "~/assets/settings.svg";
import { CreateViewDropdown } from "./create-view-dropdown";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500"],
});

const CONTAINER_WIDTH = 280;

export type ViewItem = { id: string; name: string };

export type GridViewContainerProps = {
  views?: ViewItem[];
  activeViewId?: string | null;
  onSelectView?: (viewId: string) => void;
  onCreateView?: (name: string) => void;
  onFindView?: () => void;
  onSettings?: () => void;
  functionContainerRef?: React.RefObject<HTMLDivElement | null>;
};

const DEFAULT_VIEWS: ViewItem[] = [{ id: "default", name: "Grid view" }];

const VIEW_ROW_STRIDE = 33;

// Targets:
// - Text "Grid view" at (44, 95)
// - Icon at (21, 96)
const FIRST_VIEW_TEXT_TOP = 95;
const FIRST_VIEW_ICON_TOP = 97;
const VIEW_ICON_LEFT = 21;

const VIEW_HOVER_LEFT = 9;
const VIEW_HOVER_WIDTH = 263;
const VIEW_HOVER_HEIGHT = 32;

// Text is at (35, 8) within hover box, so hoverTop = textTop - 8
const FIRST_VIEW_HOVER_TOP = FIRST_VIEW_TEXT_TOP - 8;

const VIEW_TEXT_IN_HOVER_LEFT = 35;
const VIEW_TEXT_IN_HOVER_TOP = 8;

export function GridViewContainer({
  views = DEFAULT_VIEWS,
  activeViewId = null,
  onSelectView,
  onCreateView,
  onFindView,
  onSettings,
  functionContainerRef,
}: GridViewContainerProps) {
  const [isCreateDropdownOpen, setIsCreateDropdownOpen] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ left: 0, top: 0 });
  const [hoveredViewId, setHoveredViewId] = useState<string | null>(null);
  const containerRef = useRef<HTMLElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);

  const handleCreateClick = () => {
    if (containerRef.current && functionContainerRef?.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const functionRect = functionContainerRef.current.getBoundingClientRect();

      // Dropdown left edge is 1px left of table view space (which starts at grid-view container's right edge)
      const left = containerRect.right - 1;

      // Dropdown top edge is 10px below function container's bottom edge
      const top = functionRect.bottom + 10;

      setDropdownPosition({ left, top });
      setIsCreateDropdownOpen(true);
    }
  };

  const handleCreateView = (name: string) => {
    if (onCreateView) {
      onCreateView(name);
    }
  };

  const viewCount = views.length;
  const defaultViewName = `Grid ${viewCount + 1}`;

  return (
    <>
      <section
        ref={containerRef}
        className={inter.className}
        style={{
          width: CONTAINER_WIDTH,
          minWidth: CONTAINER_WIDTH,
          flexShrink: 0,
          boxSizing: "border-box",
          borderRight: "1px solid #DDE1E3",
          backgroundColor: "white",
          position: "relative",
        }}
      >
        {/* 1. "Create new…" */}
        <button
          ref={createButtonRef}
          type="button"
          onClick={handleCreateClick}
          className="group/create absolute cursor-pointer rounded-[7px] border-none bg-transparent p-0 text-left outline-none"
          style={{
            left: VIEW_HOVER_LEFT,
            top: 11,
            width: VIEW_HOVER_WIDTH,
            height: 32,
          }}
          aria-label="Create new view"
        >
          <span
            className="absolute rounded-[7px] bg-transparent transition-colors group-hover/create:bg-[#F2F2F2]"
            style={{
              left: 0,
              top: 0,
              width: VIEW_HOVER_WIDTH,
              height: 32,
              pointerEvents: "none",
            }}
          />
          <span
            className="absolute flex items-center justify-center"
            style={{ left: 23 - VIEW_HOVER_LEFT, top: 21 - 11, width: 12, height: 12 }}
          >
            <Image
              src={plusIcon}
              alt=""
              width={12}
              height={12}
              className="flex-shrink-0"
              style={{ filter: "brightness(0) saturate(100%)" }}
            />
          </span>
          <span
            className="absolute text-[13px] font-normal text-[#1D1F24]"
            style={{ left: 44 - VIEW_HOVER_LEFT, top: 18 - 11 }}
          >
            Create new…
          </span>
        </button>

      {/* 2. "Find a view" + icons */}
      <Image
        src={greySearchIcon}
        alt=""
        width={13}
        height={12}
        className="absolute flex-shrink-0"
        style={{ left: 22, top: 57 }}
      />
      <button
        type="button"
        onClick={onFindView}
        className="absolute cursor-pointer border-none bg-transparent p-0 text-[13px] font-normal text-[#A9A9A9] outline-none hover:text-[#1D1F24]"
        style={{ left: 44, top: 55 }}
        aria-label="Find a view"
      >
        Find a view
      </button>
      <button
        type="button"
        onClick={onSettings}
        className="absolute flex cursor-pointer items-center justify-center border-none bg-transparent p-0 outline-none"
        style={{ left: 245, top: 55 }}
        aria-label="View settings"
      >
        <Image src={settingsIcon} alt="" width={17} height={16} className="flex-shrink-0" />
      </button>

        {/* 3+. Views */}
        {views.map((view, index) => {
          const textTop = FIRST_VIEW_TEXT_TOP + index * VIEW_ROW_STRIDE;
          const iconTop = FIRST_VIEW_ICON_TOP + index * VIEW_ROW_STRIDE;
          const hoverTop = FIRST_VIEW_HOVER_TOP + index * VIEW_ROW_STRIDE;

          const isActive = activeViewId != null && activeViewId === view.id;
          const iconTopInHover = iconTop - hoverTop;

          const isHovered = hoveredViewId === view.id;
          const showGreyIcon = isActive || isHovered;

          return (
            <button
              key={view.id}
              type="button"
              onClick={() => onSelectView?.(view.id)}
              onMouseEnter={() => setHoveredViewId(view.id)}
              onMouseLeave={() => setHoveredViewId(null)}
              className="group/view absolute cursor-pointer border-none bg-transparent p-0 text-left outline-none"
              style={{
                left: VIEW_HOVER_LEFT,
                top: hoverTop,
                width: VIEW_HOVER_WIDTH,
                height: VIEW_HOVER_HEIGHT,
              }}
              aria-label={`View: ${view.name}`}
              aria-current={isActive ? "true" : undefined}
            >
              <span
                className="absolute rounded-[3px] bg-transparent transition-colors"
                style={{
                  left: 0,
                  top: 0,
                  width: VIEW_HOVER_WIDTH,
                  height: VIEW_HOVER_HEIGHT,
                  pointerEvents: "none",
                  backgroundColor: isActive || isHovered ? "#F2F2F2" : "transparent",
                }}
              />
              <span
                className="absolute overflow-hidden rounded-[3px]"
                style={{
                  left: VIEW_ICON_LEFT - VIEW_HOVER_LEFT,
                  top: iconTopInHover,
                  width: 16,
                  height: 15,
                  pointerEvents: "none",
                }}
              >
                <Image
                  src={showGreyIcon ? greyGridViewIcon : gridViewIcon}
                  alt=""
                  width={16}
                  height={15}
                  className="flex-shrink-0"
                  style={{
                    display: "block",
                  }}
                />
              </span>

              <span
                className="absolute text-[13px] font-medium text-[#1D1F24]"
                style={{
                  left: VIEW_TEXT_IN_HOVER_LEFT,
                  top: VIEW_TEXT_IN_HOVER_TOP,
                }}
              >
                {view.name}
              </span>
            </button>
          );
        })}
      </section>

      <CreateViewDropdown
        isOpen={isCreateDropdownOpen}
        onClose={() => setIsCreateDropdownOpen(false)}
        onCreate={handleCreateView}
        defaultName={defaultViewName}
        dropdownPosition={dropdownPosition}
      />
    </>
  );
}
