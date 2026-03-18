"use client";

import { useEffect, useRef, useState } from "react";

import BellIcon from "~/assets/bell.svg";
import HelpIcon from "~/assets/help.svg";
import LogoIcon from "~/assets/logo.svg";
import LogoutIcon from "~/assets/logout.svg";
import OmniIcon from "~/assets/omni.svg";
import { handleLogout } from "./handle-logout";

type SidebarNavProps = {
  userName: string;
  userEmail: string;
  userInitial: string;
  onNavigateHome: () => void;
};

export function SidebarNav({
  userName,
  userEmail,
  userInitial,
  onNavigateHome,
}: SidebarNavProps) {
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const userDropdownRef = useRef<HTMLDivElement>(null);
  const userIconRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!showUserDropdown) return;
    const handleClickOutside = (event: globalThis.MouseEvent) => {
      if (
        userDropdownRef.current &&
        !userDropdownRef.current.contains(event.target as Node) &&
        userIconRef.current &&
        !userIconRef.current.contains(event.target as Node)
      ) {
        setShowUserDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showUserDropdown]);

  const handleSignOut = async () => {
    await handleLogout();
  };

  return (
    <aside className="relative flex w-[56px] flex-shrink-0 flex-col items-center border-r border-[#E5E5E5] bg-white py-4">
      <button
        type="button"
        onClick={onNavigateHome}
        className="cursor-pointer"
        aria-label="Back to bases"
      >
        <LogoIcon
          className="h-[19.74px] w-[22.68px]"
          style={{ filter: "brightness(0) saturate(100%)" }}
        />
      </button>
      <OmniIcon
        className="mt-[25px] h-[28.31px] w-[28.33px]"
      />
      <div className="absolute bottom-4 left-0 right-0 flex flex-col items-center gap-4">
        <HelpIcon className="h-[15px] w-[15px]" />
        <BellIcon className="h-[16px] w-[16px]" />
        <button
          ref={userIconRef}
          type="button"
          onClick={() => setShowUserDropdown((prev) => !prev)}
          className="airtable-circle relative cursor-pointer overflow-hidden"
          aria-label="User menu"
        >
          <svg
            className="absolute inset-0 m-auto h-[29px] w-[29px]"
            width="29"
            height="29"
            viewBox="0 0 29 29"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle cx="14.5" cy="14.5" r="14.5" fill="#E8E8E8" />
          </svg>
          <svg
            className="absolute inset-0 m-auto h-[26px] w-[26px]"
            width="26"
            height="26"
            viewBox="0 0 26 26"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle cx="13" cy="13" r="13" fill="#DD04A8" />
          </svg>
          <span className="relative text-[13px] text-white">{userInitial}</span>
        </button>
      </div>

      {/* User dropdown */}
      {showUserDropdown && (
        <div
          ref={userDropdownRef}
          className="font-inter airtable-dropdown-surface"
          style={{
            position: "fixed",
            left: 56 + 7,
            bottom: 16,
            width: 297,
            height: 129,
            backgroundColor: "white",
            borderRadius: 5,
            zIndex: 1000,
          }}
        >
          <span
            style={{
              position: "absolute",
              left: 20,
              top: 21,
              fontSize: 13,
              fontWeight: 600,
              color: "#1D1F24",
            }}
          >
            {userName}
          </span>
          <span
            style={{
              position: "absolute",
              left: 20,
              top: 41,
              fontSize: 13,
              fontWeight: 500,
              color: "#1D1F24",
            }}
          >
            {userEmail}
          </span>
          <div
            style={{
              position: "absolute",
              left: 20,
              top: 76,
              width: 245,
              height: 1,
              backgroundColor: "#F2F2F2",
            }}
          />
          <button
            type="button"
            className="group/logout"
            onClick={handleSignOut}
            style={{
              position: "absolute",
              left: 13,
              top: 84,
              width: 260,
              height: 34,
              background: "transparent",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
              padding: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "#F2F2F2";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            <LogoutIcon
              className="absolute group-hover/logout:mix-blend-multiply"
              style={{
                left: 20 - 13,
                top: 94 - 84,
                width: 16,
                height: 15,
                display: "block",
              }}
            />
            <span
              style={{
                position: "absolute",
                left: 44 - 13,
                top: 93 - 84,
                fontSize: 13,
                fontWeight: 500,
                color: "#1D1F24",
              }}
            >
              Logout
            </span>
          </button>
        </div>
      )}
    </aside>
  );
}
