"use client";

import { Inter } from "next/font/google";

import GreySearchIcon from "~/assets/grey-search.svg";
import GridViewIcon from "~/assets/grid-view.svg";
import SettingsIcon from "~/assets/settings.svg";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500"],
});

const CONTAINER_WIDTH = 280;

/** 12×12 plus icon in #1D1F24 at (23, 21) */
function PlusIcon1D1F24() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 13 13"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="flex-shrink-0"
      style={{ position: "absolute", left: 23, top: 21 }}
    >
      <rect x="0" y="6" width="13" height="1" rx="0.5" fill="#1D1F24" />
      <rect x="6" y="0" width="1" height="13" rx="0.5" fill="#1D1F24" />
    </svg>
  );
}

export type ViewItem = { id: string; name: string };

export type GridViewContainerProps = {
  /** Default/first view is "Grid view" with this name; additional views follow. */
  views?: ViewItem[];
  activeViewId?: string | null;
  onSelectView?: (viewId: string) => void;
  onCreateNew?: () => void;
  onFindView?: () => void;
  onSettings?: () => void;
};

const DEFAULT_VIEWS: ViewItem[] = [];

const VIEW_ROW_STRIDE = 32;
const FIRST_VIEW_TEXT_TOP = 94;
const FIRST_VIEW_ICON_TOP = 93; /* 17×15 icon aligned with 13px text at 94 */
const VIEW_ICON_LEFT = 17;
/** First view: text at 44,94 → hover box so text at (35,8) → box left 9, box top 94-8=86 */
const VIEW_HOVER_LEFT = 9;
const FIRST_VIEW_HOVER_TOP = 86;
const VIEW_HOVER_WIDTH = 263;
const VIEW_HOVER_HEIGHT = 32;
/** Text position within view row: from container left 44, so relative to hover (35, 8) */
const VIEW_TEXT_LEFT = 44;
const VIEW_TEXT_OFFSET_IN_ROW = 8;

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
        borderRight: "1px solid #DDE1E3",
        backgroundColor: "white",
        position: "relative",
        boxSizing: "border-box",
      }}
    >
      {/* 1. "Create new…" at 44,18 + plus 12×12 at 22,20; hover 263×32 at 9,11, radius 7, #F2F2F2 */}
      <button
        type="button"
        onClick={onCreateNew}
        className="group/create relative flex items-center rounded-[7px] border-none bg-transparent p-0 text-left outline-none cursor-pointer"
        style={{
          left: 9,
          top: 11,
          width: 263,
          height: 32,
        }}
        aria-label="Create new view"
      >
        <span
          className="absolute rounded-[7px] bg-transparent transition-colors group-hover/create:bg-[#F2F2F2]"
          style={{
            left: 0,
            top: 0,
            width: 263,
            height: 32,
            pointerEvents: "none",
          }}
        />
        <PlusIcon1D1F24 />
        <span
          className="absolute text-[13px] font-normal text-[#1D1F24]"
          style={{ left: 44 - 9, top: 18 - 11 }}
        >
          Create new…
        </span>
      </button>

      {/* 2. "Find a view" at 44,64; grey-search 14×13 at 20,56; settings 17×16 at 245,55 */}
      <GreySearchIcon
        className="absolute h-[13px] w-[14px] flex-shrink-0"
        style={{ left: 20, top: 56 }}
      />
      <button
        type="button"
        onClick={onFindView}
        className="absolute border-none bg-transparent p-0 text-[13px] font-normal text-[#A9A9A9] outline-none cursor-pointer hover:text-[#1D1F24]"
        style={{ left: 44, top: 55 }}
        aria-label="Find a view"
      >
        Find a view
      </button>
      <button
        type="button"
        onClick={onSettings}
        className="absolute flex items-center justify-center border-none bg-transparent p-0 outline-none cursor-pointer"
        style={{ left: 245, top: 55 }}
        aria-label="View settings"
      >
        <SettingsIcon className="h-[16px] w-[17px] flex-shrink-0" />
      </button>

      {/* 3 & 4. Grid view rows: icon 17×15 at 17,y; text at 44,y; each 32px below previous */}
      {views.map((view, index) => {
        const hoverTop = FIRST_VIEW_HOVER_TOP + index * VIEW_ROW_STRIDE;
        const iconTop = FIRST_VIEW_ICON_TOP + index * VIEW_ROW_STRIDE;
        const isActive = activeViewId != null && activeViewId === view.id;
        const iconTopInHover = iconTop - hoverTop;

        return (
          <button
            key={view.id}
            type="button"
            onClick={() => onSelectView?.(view.id)}
            className="group/view relative flex items-center border-none bg-transparent p-0 text-left outline-none cursor-pointer"
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
            {/* Grid icon: 17×15 at 17 from container; on hover, whites → #F2F2F2 via wrapper bg */}
            <span
              className="absolute rounded-[3px] overflow-hidden bg-transparent group-hover/view:bg-[#F2F2F2]"
              style={{
                left: VIEW_ICON_LEFT - VIEW_HOVER_LEFT,
                top: iconTopInHover,
                width: 17,
                height: 15,
                pointerEvents: "none",
              }}
            >
              <GridViewIcon
                className="h-[15px] w-[17px] flex-shrink-0"
                style={{ display: "block" }}
              />
            </span>
            <span
              className="absolute text-[13px] font-medium text-[#1D1F24]"
              style={{
                left: VIEW_TEXT_LEFT - VIEW_HOVER_LEFT,
                top: VIEW_TEXT_OFFSET_IN_ROW,
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
