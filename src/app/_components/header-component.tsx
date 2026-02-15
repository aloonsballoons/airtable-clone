"use client";

import { Inter } from "next/font/google";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import arrowIcon from "~/assets/arrow.svg";
import launchIcon from "~/assets/launch.svg";
import logoIcon from "~/assets/logo.svg";
import timeIcon from "~/assets/time.svg";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

type HeaderComponentProps = {
  baseName: string;
  isLoading: boolean;
};

export function HeaderComponent({ baseName, isLoading }: HeaderComponentProps) {
  const router = useRouter();
  const savedTextRef = useRef<HTMLSpanElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const baseNameRef = useRef<HTMLSpanElement>(null);
  const [spinnerLeft, setSpinnerLeft] = useState<number | null>(null);
  const [arrowLeft, setArrowLeft] = useState<number | null>(null);
  const [showSaved, setShowSaved] = useState(false);
  const savedTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const measureArrow = () => {
      if (!baseNameRef.current || !headerRef.current) return;
      const nameRect = baseNameRef.current.getBoundingClientRect();
      const headerRect = headerRef.current.getBoundingClientRect();
      setArrowLeft(nameRect.right - headerRect.left + 8);
    };
    measureArrow();
    const raf = requestAnimationFrame(measureArrow);
    window.addEventListener("resize", measureArrow);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measureArrow);
    };
  }, [baseName]);

  useEffect(() => {
    if (!isLoading) {
      setSpinnerLeft(null);
      // When loading finishes, show "Changes saved" for 5 seconds
      setShowSaved(true);
      if (savedTimerRef.current) {
        clearTimeout(savedTimerRef.current);
      }
      savedTimerRef.current = setTimeout(() => {
        setShowSaved(false);
      }, 5000);
      return;
    }
    setShowSaved(false);
    const measure = () => {
      if (!savedTextRef.current || !headerRef.current) return;
      const textRect = savedTextRef.current.getBoundingClientRect();
      const headerRect = headerRef.current.getBoundingClientRect();
      // 10px gap + 10px spinner width
      setSpinnerLeft(textRect.left - headerRect.left - 10 - 10);
    };
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      if (savedTimerRef.current) {
        clearTimeout(savedTimerRef.current);
      }
    };
  }, [isLoading]);

  return (
    <header className="bg-white">
      <div
        ref={headerRef}
        className="relative flex flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6"
      >
        {/* Left: base icon + name, shifted 13px left (8 + 5 for base name) */}
        <div className="flex items-center gap-3" style={{ marginLeft: -13 }}>
          <div className="flex h-[32px] w-[32px] items-center justify-center rounded-[6px] bg-[#8c3f78]">
            <img
              alt=""
              className="h-[19.74px] w-[22.68px]"
              src={logoIcon.src}
              style={{ filter: "brightness(0) saturate(100%) invert(1)" }}
            />
          </div>
          <button
            type="button"
            onClick={() => router.push("/bases")}
            className="flex items-center gap-2 text-[16px] font-semibold text-[#1d1f24]"
          >
            <span ref={baseNameRef}>{baseName}</span>
          </button>
        </div>
        {/* arrow.svg: 11×6, y=24, 8px right of base name — positioned relative to header */}
        {arrowLeft !== null && (
          <img
            alt=""
            src={arrowIcon.src}
            className="pointer-events-none"
            style={{
              position: "absolute",
              left: arrowLeft,
              top: 24,
              width: 11,
              height: 6,
            }}
          />
        )}

        {/* Center: nav tabs — 148px - 32px = 116px (shifted 32px left) */}
        <nav className="ml-[116px] flex flex-wrap items-center gap-5 airtable-secondary-font">
          <button type="button" className="relative text-[#1d1f24]">
            Data
            <span className="absolute -bottom-[19px] left-1/2 h-[2px] w-[28.5px] -translate-x-1/2 bg-[#8c3f78]" />
          </button>
          <button type="button">Automations</button>
          <button type="button">Interfaces</button>
          <button type="button">Forms</button>
        </nav>

        {/* Right side: Saved/Saving, time icon, Launch, Share — shifted 8px left */}
        <div className="flex flex-wrap items-center" style={{ marginRight: -8 }}>
          {/* "Saving..."/"Changes saved" — Inter Regular 13, #8E8F91, 24px left of time.svg */}
          <span
            ref={savedTextRef}
            className={inter.className}
            style={{
              fontSize: 13,
              fontWeight: 400,
              color: "#8E8F91",
              lineHeight: "13px",
              marginRight: 24,
              whiteSpace: "nowrap",
              visibility: isLoading || showSaved ? "visible" : "hidden",
            }}
          >
            {isLoading ? "Saving..." : "Changes saved"}
          </span>

          {/* time.svg: 16×15, 6px left of Launch, shifted 9px left */}
          <img
            alt=""
            src={timeIcon.src}
            style={{
              width: 16,
              height: 15,
              marginRight: 6,
              marginLeft: -9,
            }}
          />

          <button
            type="button"
            className="airtable-outline flex items-center justify-center gap-2 rounded-[6px] bg-white text-[13px] text-[#1d1f24]"
            style={{ width: 80, height: 29, marginRight: 8 }}
          >
            <img alt="" className="h-[14px] w-[14px]" src={launchIcon.src} />
            Launch
          </button>
          <button
            type="button"
            className="airtable-shadow flex items-center justify-center rounded-[6px] bg-[#8c3f78] text-[13px] font-medium text-white"
            style={{ width: 60, height: 29 }}
          >
            Share
          </button>
        </div>

        {/* Loading spinner: 10×10, 10px left of "Saving...", y=25 within container */}
        {isLoading && spinnerLeft !== null && (
          <span
            className="header-saving-spinner"
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 21,
              left: spinnerLeft,
              zIndex: 10,
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 10 10"
              aria-hidden="true"
            >
              <circle
                cx="5"
                cy="5"
                r="4"
                fill="none"
                stroke="#8E8F91"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeDasharray="0.6 0.4"
                pathLength="3"
              />
            </svg>
          </span>
        )}
      </div>
    </header>
  );
}
