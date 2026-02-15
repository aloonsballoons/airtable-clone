"use client";

import { Inter } from "next/font/google";
import Image from "next/image";

import greySearchIcon from "~/assets/grey-search.svg";
import gridViewIcon from "~/assets/grid-view.svg";
import plusIcon from "~/assets/plus.svg";
import settingsIcon from "~/assets/settings.svg";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500"],
});

const CONTAINER_WIDTH = 280;

/** Positions are raw text/element positions within the component (no padding). */

export type ViewItem = { id: string; name: string };

export type GridViewContainerProps = {
  views?: ViewItem[];
  activeViewId?: string | null;
  onSelectView?: (viewId: string) => void;
  onCreateNew?: () => void;
  onFindView?: () => void;
  onSettings?: () => void;
};

const DEFAULT_VIEWS: ViewItem[] = [{ id: "default", name: "Grid view" }];

const VIEW_ROW_STRIDE = 32;
const FIRST_VIEW_TEXT_TOP = 95;
const FIRST_VIEW_ICON_TOP = 94;
const VIEW_ICON_LEFT = 17;
const VIEW_HOVER_LEFT = 9;
const VIEW_HOVER_WIDTH = 263;
const VIEW_HOVER_HEIGHT = 32;
/** Text at 35,8 within hover box → first hover top = 95 - 8 = 87 */
const FIRST_VIEW_HOVER_TOP = 87;
const VIEW_TEXT_LEFT = 44;
const VIEW_TEXT_IN_HOVER_LEFT = 35;
const VIEW_TEXT_IN_HOVER_TOP = 8;

export function GridViewContainer({
  views = DEFAULT_VIEWS,
  activeViewId = null,
  onSelectView,
  onCreateNew,
  onFindView,
  onSettings,
}: GridViewContainerProps) {
  return (
    <section
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
      {/* 1. "Create new…" at 44,18 — inter regular 13 #1D1F24; plus.svg 12×12 at 23,21 in #1D1F24 */}
      <button
        type="button"
        onClick={onCreateNew}
        className="group/create relative cursor-pointer rounded-[7px] border-none bg-transparent p-0 text-left outline-none"
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

      {/* 2. "Find a view" at 44,64 — inter regular 13 #A9A9A9; grey-search 14×13 at 20,56; settings 17×16 at 245,55 */}
      <Image
        src={greySearchIcon}
        alt=""
        width={14}
        height={13}
        className="absolute flex-shrink-0"
        style={{ left: 20, top: 56 }}
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
        <Image
          src={settingsIcon}
          alt=""
          width={17}
          height={16}
          className="flex-shrink-0"
        />
      </button>

      {/* 3 & 4. "Grid view" (and subsequent views): text at 44, 94 + 32*index — inter medium 13 #1D1F24; grid-view.svg 17×15 at 17, 93 + 32*index */}
      {views.map((view, index) => {
        const textTop = FIRST_VIEW_TEXT_TOP + index * VIEW_ROW_STRIDE;
        const iconTop = FIRST_VIEW_ICON_TOP + index * VIEW_ROW_STRIDE;
        const hoverTop = FIRST_VIEW_HOVER_TOP + index * VIEW_ROW_STRIDE;
        const isActive = activeViewId != null && activeViewId === view.id;
        const iconTopInHover = iconTop - hoverTop;

        return (
          <button
            key={view.id}
            type="button"
            onClick={() => onSelectView?.(view.id)}
            className="group/view relative cursor-pointer border-none bg-transparent p-0 text-left outline-none"
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
              className="absolute rounded-[3px] bg-transparent transition-colors group-hover/view:bg-[#F2F2F2]"
              style={{
                left: 0,
                top: 0,
                width: VIEW_HOVER_WIDTH,
                height: VIEW_HOVER_HEIGHT,
                pointerEvents: "none",
              }}
            />
            <span
              className="absolute overflow-hidden rounded-[3px] bg-transparent group-hover/view:bg-[#F2F2F2]"
              style={{
                left: VIEW_ICON_LEFT - VIEW_HOVER_LEFT,
                top: iconTopInHover,
                width: 17,
                height: 15,
                pointerEvents: "none",
              }}
            >
              <Image
                src={gridViewIcon}
                alt=""
                width={17}
                height={15}
                className="flex-shrink-0"
                style={{ display: "block" }}
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
  );
}
