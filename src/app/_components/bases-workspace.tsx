"use client";

import clsx from "clsx";
import { Inter } from "next/font/google";
import { useRouter } from "next/navigation";
import { type MouseEvent, useEffect, useRef, useState } from "react";

import AirtableIcon from "~/assets/airtable.svg";
import BaseArrowIcon from "~/assets/base-arrow.svg";
import BaseDoorIcon from "~/assets/base-door.svg";
import BasePlusIcon from "~/assets/base-plus.svg";
import BaseThreeIcon from "~/assets/base-three.svg";
import BellIcon from "~/assets/bell.svg";
import BigTextIcon from "~/assets/big-text.svg";
import CalendarIcon from "~/assets/calendar.svg";
import CampaignIcon from "~/assets/campaign.svg";
import CommandIcon from "~/assets/command.svg";
import DataIcon from "~/assets/data.svg";
import DeleteIcon from "~/assets/delete.svg";
import DownBaseArrowIcon from "~/assets/down-base-arrow.svg";
import HelpIcon from "~/assets/help.svg";
import HomeIcon from "~/assets/home.svg";
import ImportIcon from "~/assets/import.svg";
import LogoIcon from "~/assets/logo.svg";
import MarketplaceIcon from "~/assets/marketplace.svg";
import PeopleIcon from "~/assets/people.svg";
import PerformanceIcon from "~/assets/performance.svg";
import RenameIcon from "~/assets/rename.svg";
import SearchIcon from "~/assets/search.svg";
import ShareIcon from "~/assets/share.svg";
import StarIcon from "~/assets/star.svg";
import TemplateIcon from "~/assets/template.svg";
import LogoutIcon from "~/assets/logout.svg";
import { handleLogout } from "./handle-logout";
import { api } from "~/trpc/react";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

type BasesWorkspaceProps = {
  userName: string;
  userEmail: string;
};

const formatInitials = (name: string) => {
  const trimmed = name.trim();
  const chars = Array.from(trimmed);
  const first = chars[0] ?? "";
  const second = chars[1] ?? "";
  const formatChar = (char: string, index: number) => {
    if (!char) return "";
    if (/[a-zA-Z]/.test(char)) {
      return index === 0 ? char.toUpperCase() : char.toLowerCase();
    }
    return char;
  };
  const initials = `${formatChar(first, 0)}${formatChar(second, 1)}`;
  return initials || "??";
};

const formatUserInitial = (name: string) => {
  const trimmed = name.trim();
  const chars = Array.from(trimmed);
  const first = chars[0] ?? "";
  if (!first) return "?";
  return /[a-zA-Z]/.test(first) ? first.toUpperCase() : first;
};

const formatLastOpened = (openedAt: Date) => {
  const now = new Date();
  const diffMs = Math.max(0, now.getTime() - openedAt.getTime());
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;
  const year = 365 * day;

  if (diffMs < minute) {
    return "Opened just now";
  }
  if (diffMs < hour) {
    const value = Math.floor(diffMs / minute);
    return `Opened ${value} minute${value === 1 ? "" : "s"} ago`;
  }
  if (diffMs < day) {
    const value = Math.floor(diffMs / hour);
    return `Opened ${value} hour${value === 1 ? "" : "s"} ago`;
  }
  if (diffMs < week) {
    const value = Math.floor(diffMs / day);
    return `Opened ${value} day${value === 1 ? "" : "s"} ago`;
  }
  if (diffMs < month) {
    const value = Math.floor(diffMs / week);
    return `Opened ${value} week${value === 1 ? "" : "s"} ago`;
  }
  if (diffMs < year) {
    const value = Math.floor(diffMs / month);
    return `Opened ${value} month${value === 1 ? "" : "s"} ago`;
  }
  const value = Math.floor(diffMs / year);
  return `Opened ${value} year${value === 1 ? "" : "s"} ago`;
};

export function BasesWorkspace({ userName, userEmail }: BasesWorkspaceProps) {
  const router = useRouter();
  const utils = api.useUtils();

  const baseListQuery = api.base.list.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
  });
  const [menuBaseId, setMenuBaseId] = useState<string | null>(null);
  const [renamingBaseId, setRenamingBaseId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const [isContentReady, setIsContentReady] = useState(false);

  const createBase = api.base.create.useMutation({
    onSuccess: (data) => {
      utils.base.list.invalidate();
      if (data?.base?.id) {
        router.push(`/bases/${data.base.id}`);
      }
    },
  });

  const touchBase = api.base.touch.useMutation({
    onSuccess: async () => {
      await utils.base.list.invalidate();
    },
  });

  const deleteBase = api.base.delete.useMutation({
    onMutate: async ({ baseId }) => {
      await utils.base.list.cancel();
      const previous = utils.base.list.getData();
      utils.base.list.setData(undefined, (old) => {
        if (!old) return old;
        return old.filter((item) => item.id !== baseId);
      });
      return { previous };
    },
    onError: async (_error, _variables, context) => {
      if (context?.previous) {
        utils.base.list.setData(undefined, context.previous);
      }
    },
    onSettled: async () => {
      await utils.base.list.invalidate();
    },
  });

  const renameBase = api.base.rename.useMutation({
    onSuccess: async () => {
      await utils.base.list.invalidate();
    },
  });

  const handleCreateBase = () => {
    createBase.mutate({});
  };

  const handleOpenBase = (baseId: string) => {
    touchBase.mutate({ baseId });
    router.push(`/bases/${baseId}`);
  };

  const handleSignOut = async () => {
    await handleLogout(() => router.refresh());
  };

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

  const handleOpenMenu = (event: MouseEvent, baseId: string) => {
    event.stopPropagation();
    setMenuBaseId((prev) => (prev === baseId ? null : baseId));
  };

  const handleDeleteBase = (event: MouseEvent, baseId: string) => {
    event.stopPropagation();
    deleteBase.mutate({ baseId });
    setMenuBaseId(null);
  };

  const handleStartRename = (
    event: MouseEvent,
    baseId: string,
    baseName: string
  ) => {
    event.stopPropagation();
    setMenuBaseId(null);
    setRenamingBaseId(baseId);
    setRenameValue(baseName);
  };

  const commitRename = (baseId: string) => {
    const nextName = renameValue.trim();
    if (!nextName) {
      setRenamingBaseId(null);
      return;
    }
    utils.base.list.setData(undefined, (previous) => {
      if (!previous) return previous;
      return previous.map((item) =>
        item.id === baseId ? { ...item, name: nextName } : item
      );
    });
    renameBase.mutate({ baseId, name: nextName });
    setRenamingBaseId(null);
  };

  useEffect(() => {
    if (!renamingBaseId) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renamingBaseId]);

  useEffect(() => {
    if (!menuBaseId) return;
    const handleClick = () => setMenuBaseId(null);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [menuBaseId]);

  useEffect(() => {
    // Wait for fonts and DOM to be ready
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        setIsContentReady(true);
      });
    } else {
      // Fallback for browsers without Font Loading API
      setIsContentReady(true);
    }
  }, []);

  const bases = baseListQuery.data ?? [];
  const showInitialBaseListLoading =
    baseListQuery.isLoading && !baseListQuery.isFetched;
  const userInitial = formatUserInitial(userName);

  const [skeletonCount, setSkeletonCount] = useState(() => {
    if (typeof window === "undefined") return 0;
    const stored = localStorage.getItem("baseCount");
    return stored ? parseInt(stored, 10) || 0 : 0;
  });

  useEffect(() => {
    if (baseListQuery.data) {
      const count = baseListQuery.data.length;
      setSkeletonCount(count);
      localStorage.setItem("baseCount", String(count));
    }
  }, [baseListQuery.data]);

  return (
    <div
      className={clsx(
        "min-h-screen bg-[#f9fafb] text-black transition-opacity duration-200",
        inter.className,
        isContentReady ? "opacity-100" : "opacity-0"
      )}
    >
      <header className="airtable-border airtable-shadow sticky top-0 z-50 flex h-[56px] items-center justify-between border-y bg-white px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="flex h-[24px] w-[24px] items-center justify-center"
            aria-label="Open menu"
          >
            <svg
              width="16"
              height="11"
              viewBox="0 0 16 11"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M0 0.5H16M0 5.5H16M0 10.5H16" stroke="#8E8F92" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <LogoIcon
              className="h-[23.76px] w-[27.72px] shrink-0"
            />
            <AirtableIcon
              className="h-[18.39px] w-[71.61px] shrink-0"
            />
          </div>
        </div>

        <div className="hidden flex-1 justify-center md:flex">
          <div className="airtable-outline airtable-selection-hover relative flex h-[34px] w-[335px] items-center gap-2 rounded-[17px] bg-white px-3 text-[13px] text-[#616670]">
            <SearchIcon
              className="h-[14.5px] w-[14.5px] shrink-0"
            />
            <span className="flex-1">Search...</span>
            <div className="flex items-center gap-1 text-[#989aa0]">
              <CommandIcon
                className="h-[11px] w-[10px] shrink-0"
              />
              <span>K</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            type="button"
            className="hidden items-center gap-2 text-[13px] md:flex"
            aria-label="Help"
          >
            <HelpIcon className="h-[15px] w-[15px]" />
            Help
          </button>
          <button type="button" className="airtable-circle relative" aria-label="Notifications">
            <BellIcon className="h-[18px] w-[17px]" />
          </button>
          <div className="relative">
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
            {showUserDropdown && (
              <div
                ref={userDropdownRef}
                className={`${inter.className} airtable-dropdown-surface`}
                style={{
                  position: "fixed",
                  right: 31,
                  top: 43 + 14,
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
                    className="absolute h-[15px] w-[16px] group-hover/logout:mix-blend-multiply"
                    style={{
                      left: 20 - 13,
                      top: 94 - 84,
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
          </div>
        </div>
      </header>

      <div className="flex min-h-[calc(100vh-56px)]">
        <aside className="airtable-border hidden w-[300px] flex-col border-r bg-white lg:flex">
          <div className="pt-[22px]">
            <div className="flex flex-col items-center gap-[3px] text-[15px]">
              <button
                type="button"
                className="airtable-nav-item airtable-nav-item-active"
              >
                <span className="airtable-nav-icon-slot">
                  <HomeIcon
                    className="airtable-nav-icon-img h-[19px] w-[18px] shrink-0"
                  />
                </span>
                Home
              </button>
              <button type="button" className="airtable-nav-item airtable-nav-item-hover">
                <span className="flex items-center gap-[12px]">
                  <span className="airtable-nav-icon-slot">
                    <StarIcon
                      className="airtable-nav-icon-img h-[20px] w-[19px] shrink-0"
                    />
                  </span>
                  Starred
                </span>
                <span className="ml-auto flex items-center gap-[12px]">
                  <BaseArrowIcon
                    className="h-[14px] w-[10px] shrink-0"
                  />
                </span>
              </button>
              <button type="button" className="airtable-nav-item airtable-nav-item-hover">
                <span className="airtable-nav-icon-slot">
                  <ShareIcon
                    className="airtable-nav-icon-img h-[18px] w-[20px] shrink-0"
                  />
                </span>
                Shared
              </button>
              <button type="button" className="airtable-nav-item airtable-nav-item-hover">
                <span className="flex items-center gap-[12px]">
                  <span className="airtable-nav-icon-slot">
                    <PeopleIcon
                      className="airtable-nav-icon-img h-[18px] w-[24px] shrink-0"
                    />
                  </span>
                  Workspaces
                </span>
                <span className="ml-auto flex items-center gap-[12px]">
                  <BasePlusIcon
                    className="h-[13px] w-[12px] shrink-0"
                  />
                  <BaseArrowIcon
                    className="h-[14px] w-[10px] shrink-0"
                  />
                </span>
              </button>
            </div>
          </div>

          <div className="mt-auto px-[12px] pb-[20px]">
            <div className="mb-[16px] flex justify-center">
              <div className="h-[1px] w-[251px] bg-[#E5E5E5]" />
            </div>
            <div className="space-y-4 px-[7px] text-[12.5px]">
              <button type="button" className="flex items-center gap-[11px]">
                <TemplateIcon
                  className="h-[15px] w-[18px] shrink-0"
                />
                Templates and apps
              </button>
              <button type="button" className="flex items-center gap-[11px]">
                <MarketplaceIcon
                  className="h-[14px] w-[16px] shrink-0"
                />
                Marketplace
              </button>
              <button type="button" className="flex items-center gap-[11px]">
                <ImportIcon
                  className="h-[14px] w-[15px] shrink-0"
                />
                Import
              </button>
            </div>
            <button
              type="button"
              onClick={handleCreateBase}
              disabled={createBase.isPending}
              className="airtable-shadow mt-[18px] flex h-[32px] w-full cursor-pointer items-center justify-center gap-2 rounded-[6px] bg-[#176ee1] text-[13px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
            >
              {!createBase.isPending && (
                <span className="airtable-plus-icon text-white" aria-hidden="true" />
              )}
              {createBase.isPending ? "Creating..." : "Create"}
            </button>
          </div>
        </aside>

        <main className="relative flex-1 px-6 pb-10 pt-[33px] lg:px-[48px]">
          {/* Always visible decorative SVGs - positioned relative to main area */}
          <BaseThreeIcon
            className="absolute h-[18px] w-[22px]"
            style={{ top: '300px', right: '80px' }}
          />
          <BaseDoorIcon
            className="absolute h-[34px] w-[34px]"
            style={{ top: '292px', right: '46px' }}
          />

          <div className="space-y-2">
            <p className="text-[26px] font-semibold text-[#1D1F24]">Home</p>
            <p className="translate-y-[4px] text-[20px] font-medium text-[#1D1F24]">
              Start building
            </p>
            <p className="text-[13px] font-normal text-[#616670]">
              Create apps instantly with AI
            </p>
          </div>
          <div className="mt-4 lg:hidden">
            <button
              type="button"
              onClick={handleCreateBase}
              disabled={createBase.isPending}
              className="airtable-shadow flex h-[32px] w-full cursor-pointer items-center justify-center gap-2 rounded-[6px] bg-[#176ee1] text-[13px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
            >
              {!createBase.isPending && (
                <span className="airtable-plus-icon text-white" aria-hidden="true" />
              )}
              {createBase.isPending ? "Creating..." : "Create"}
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-[13px]">
            <div className="airtable-outline airtable-selection-hover relative h-[94px] w-full rounded-[5px] bg-white sm:w-[348px]">
              <div className="absolute left-[15px] top-[17px]">
                <PerformanceIcon
                  className="h-[17px] w-[19px]"
                />
              </div>
              <p className="absolute left-[45px] right-[12px] top-[17px] text-[15px] font-semibold text-[#1D1F24]">
                Performance Dashboard
              </p>
              <p className="absolute left-[17px] right-[12px] top-[40px] z-10 text-[13px] font-normal leading-[19px] text-[#616670]">
                Visualize key marketing metrics and campaign ROI at a glance.
              </p>
            </div>
            <div className="airtable-outline airtable-selection-hover relative h-[94px] w-full rounded-[5px] bg-white sm:w-[351px]">
              <div className="absolute left-[18px] top-[16px]">
                <CalendarIcon
                  className="h-[20px] w-[17px]"
                />
              </div>
              <p className="absolute left-[45px] right-[12px] top-[17px] text-[15px] font-semibold text-[#1D1F24]">
                Content Calendar
              </p>
              <p className="absolute left-[17px] right-[12px] top-[40px] z-10 text-[13px] font-normal leading-[19px] text-[#616670]">
                Plan, schedule, and track all marketing content in one place.
              </p>
            </div>
            <div className="airtable-outline airtable-selection-hover relative h-[94px] w-full rounded-[5px] bg-white sm:w-[349px]">
              <div className="absolute left-[18px] top-[17px]">
                <CampaignIcon
                  className="h-[16.92px] w-[18px]"
                />
              </div>
              <p className="absolute left-[45px] right-[12px] top-[17px] text-[15px] font-semibold text-[#1D1F24]">
                Campaign Tracker
              </p>
              <p className="absolute left-[17px] right-[12px] top-[40px] z-10 text-[13px] font-normal leading-[19px] text-[#616670]">
                Monitor and manage marketing campaigns from planning to results.
              </p>
            </div>
          </div>

          <div className="absolute left-[48px] top-[300px] flex items-center gap-2 text-[15px] font-normal text-[#54555A]">
            Opened anytime
            <DownBaseArrowIcon
              className="h-[14px] w-[15px]"
            />
          </div>

          <section className="absolute top-[374px] left-0 right-0 px-6 lg:px-[48px]">
            {showInitialBaseListLoading && skeletonCount > 0 ? (
              <div className="flex flex-wrap gap-3">
                {Array.from({ length: skeletonCount }).map((_, i) => (
                  <div key={i} className="airtable-skeleton-base sm:w-[345px]" />
                ))}
              </div>
            ) : bases.length === 0 ? (
              <></>
            ) : (
              <div className="flex flex-wrap gap-3">
                {bases.map((baseItem) => {
                  const initials = formatInitials(baseItem.name);
                  const lastOpened = formatLastOpened(new Date(baseItem.updatedAt));
                  const isMenuOpen = menuBaseId === baseItem.id;
                  const isRenaming = renamingBaseId === baseItem.id;
                  return (
                    <div
                      key={baseItem.id}
                      onClick={() => {
                        if (isRenaming) return;
                        handleOpenBase(baseItem.id);
                      }}
                      onKeyDown={(event) => {
                        const target = event.target as HTMLElement;
                        if (
                          target instanceof HTMLInputElement ||
                          target instanceof HTMLTextAreaElement ||
                          target.isContentEditable
                        ) {
                          return;
                        }
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          if (!isRenaming) {
                            handleOpenBase(baseItem.id);
                          }
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      className="airtable-outline airtable-selection-hover group relative h-[92px] w-full max-w-[345px] cursor-pointer rounded-[6px] bg-white text-left sm:w-[345px]"
                    >
                      <div className="airtable-base-initials absolute left-[18px] top-[18px]">
                        {initials}
                      </div>
                      {isRenaming ? (
                        <input
                          ref={renameInputRef}
                          value={renameValue}
                          onChange={(event) => setRenameValue(event.target.value)}
                          onBlur={() => commitRename(baseItem.id)}
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              commitRename(baseItem.id);
                            }
                          }}
                          className="absolute left-[93px] top-[20px] h-[30px] w-[237px] rounded-[7px] border-[2px] border-[#156FE2] bg-white px-2 text-[13px] font-normal text-[#1D1F24] outline-none"
                        />
                      ) : (
                        <p className="absolute left-[93px] right-[12px] top-[27px] text-[13px] font-normal text-[#1D1F24]">
                          {baseItem.name}
                        </p>
                      )}
                      <p
                        className={clsx(
                          "absolute left-[92px] right-[12px] top-[51px] text-[11px] font-normal text-[#616670] transition-opacity group-hover:opacity-0",
                          isRenaming && "opacity-0"
                        )}
                      >
                        {lastOpened}
                      </p>
                      <div
                        className={clsx(
                          "airtable-open-data-frame transition-all",
                          isRenaming
                            ? "opacity-100 translate-y-[10px]"
                            : "opacity-0 group-hover:opacity-100"
                        )}
                      >
                        <DataIcon
                          className="airtable-open-data-icon scale-[1.17]"
                        />
                      </div>
                      <p
                        className={clsx(
                          "airtable-open-data-text transition-all",
                          isRenaming
                            ? "opacity-100 translate-y-[10px]"
                            : "opacity-0 group-hover:opacity-100"
                        )}
                      >
                        Open data
                      </p>
                      <button
                        type="button"
                        onClick={(event) => event.stopPropagation()}
                        className={clsx(
                          "airtable-outline airtable-selection-hover absolute right-[50px] top-[15.5px] flex h-[29px] w-[29px] items-center justify-center rounded-[6px] bg-white transition-opacity",
                          isRenaming
                            ? "opacity-0 pointer-events-none"
                            : isMenuOpen
                            ? "opacity-100"
                            : "opacity-0 pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100"
                        )}
                      >
                        <StarIcon
                          className="h-[17px] w-[16px]"
                        />
                      </button>
                      <button
                        type="button"
                        onClick={(event) => handleOpenMenu(event, baseItem.id)}
                        className={clsx(
                          "airtable-outline airtable-selection-hover absolute right-[10px] top-[15.5px] flex h-[29px] w-[29px] items-center justify-center rounded-[6px] bg-white text-[15px] font-normal text-[#1D1F24] leading-none transition-opacity",
                          isRenaming
                            ? "opacity-0 pointer-events-none"
                            : isMenuOpen
                            ? "opacity-100"
                            : "opacity-0 pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100"
                        )}
                      >
                        <span className="block -translate-y-[5px] leading-none">...</span>
                      </button>
                      {isMenuOpen && (
                        <div
                          className="airtable-selection-shadow absolute left-[calc(100%-39px)] top-[52px] z-50 h-[90px] w-[240px] rounded-[6px] border border-[#C7C8C9] bg-white"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="absolute left-[12px] top-[11px] h-[33px] w-[216px] rounded-[3px] text-left text-[13px] font-normal text-[#1D1F24] hover:bg-[#F2F2F2] isolate"
                            onClick={(event) =>
                              handleStartRename(event, baseItem.id, baseItem.name)
                            }
                          >
                            <RenameIcon
                              className="absolute left-[16px] top-1/2 h-[14px] w-[14px] -translate-y-1/2 scale-[1.3] mix-blend-multiply"
                            />
                            <span className="absolute left-[44px] top-1/2 -translate-y-1/2">
                              Rename
                            </span>
                          </button>
                          <button
                            type="button"
                            className="absolute left-[12px] top-[45px] h-[33px] w-[216px] rounded-[3px] text-left text-[13px] font-normal text-[#1D1F24] hover:bg-[#F2F2F2] isolate"
                            onClick={(event) => handleDeleteBase(event, baseItem.id)}
                          >
                            <DeleteIcon
                              className="absolute left-[16px] top-1/2 h-[14px] w-[14px] -translate-y-1/2 scale-[1.3] mix-blend-multiply"
                            />
                            <span className="absolute left-[44px] top-1/2 -translate-y-1/2">
                              Delete
                            </span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
