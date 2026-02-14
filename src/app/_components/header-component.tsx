"use client";

import { Inter } from "next/font/google";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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
  const [spinnerLeft, setSpinnerLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!isLoading) {
      setSpinnerLeft(null);
      return;
    }
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
    };
  }, [isLoading]);

  return (
    <header className="bg-white">
      <div
        ref={headerRef}
        className="relative flex flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6"
      >
        {/* Left: base icon + name, shifted 8px left */}
        <div className="flex items-center gap-3" style={{ marginLeft: -8 }}>
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
            <span>{baseName}</span>
            <span className="airtable-nav-chevron rotate-90 text-[#1d1f24]" />
          </button>
        </div>

        {/* Center: nav tabs — original ml was 118px, shifted 30px right = 148px */}
        <nav className="ml-[148px] flex flex-wrap items-center gap-5 airtable-secondary-font">
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
          {/* "Saved"/"Saving..." — Inter Regular 13, #8E8F91, 24px left of time.svg */}
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
            }}
          >
            {isLoading ? "Saving..." : "Saved"}
          </span>

          {/* time.svg: 16×15, 6px left of Launch, y=20 within header */}
          <img
            alt=""
            src={timeIcon.src}
            style={{
              width: 16,
              height: 15,
              marginRight: 6,
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
              top: 23,
              left: spinnerLeft,
              zIndex: 10,
            }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              aria-hidden="true"
            >
              <circle
                cx="5"
                cy="5"
                r="4"
                fill="none"
                stroke="#8E8F91"
                strokeWidth="1"
                strokeLinecap="round"
                strokeDasharray="0.788 0.212"
                pathLength="3"
              />
            </svg>
          </span>
        )}
      </div>
    </header>
  );
}
