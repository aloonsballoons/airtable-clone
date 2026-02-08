"use client";

import clsx from "clsx";
import { Inter } from "next/font/google";
import { useRouter } from "next/navigation";
import { type MouseEvent, useEffect, useRef, useState } from "react";

import bellIcon from "~/assets/bell.svg";
import dataIcon from "~/assets/data.svg";
import deleteIcon from "~/assets/delete.svg";
import helpIcon from "~/assets/help.svg";
import menuIcon from "~/assets/menu.svg";
import renameIcon from "~/assets/rename.svg";
import searchIcon from "~/assets/search.svg";
import { authClient } from "~/server/better-auth/client";
import { api } from "~/trpc/react";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const imgRectangle1 =
  "https://www.figma.com/api/mcp/asset/77247c06-ebac-411b-b8d6-72964d4706a0";
const imgRectangle3 =
  "https://www.figma.com/api/mcp/asset/4826b6eb-2e36-4de1-8915-a98a3d7cfb3c";
const imgRectangle5 =
  "https://www.figma.com/api/mcp/asset/a2c792bd-9922-4b5c-a184-dc4de9a90b08";
const imgVector =
  "https://www.figma.com/api/mcp/asset/91ef4d33-343a-432f-83c3-0309e095b47d";
const imgVector1 =
  "https://www.figma.com/api/mcp/asset/7c695752-27d3-42e9-afcc-c72a1da82736";
const imgVector2 =
  "https://www.figma.com/api/mcp/asset/f0fad5b6-aca0-4812-a3ef-8c4f0b34dcbb";
const imgVector3 =
  "https://www.figma.com/api/mcp/asset/2e4218de-eaff-4c4a-bcdf-a04cf4303b9e";
const imgVector4 =
  "https://www.figma.com/api/mcp/asset/d6794635-1f96-4988-98c1-d9b63a5323a2";
const imgRectangle6 =
  "https://www.figma.com/api/mcp/asset/7f80c4f4-3d5f-4b92-be09-fd74c496051e";
const imgVector5 =
  "https://www.figma.com/api/mcp/asset/9db0d719-8e6f-4641-8441-9f017f129307";
const imgVector6 =
  "https://www.figma.com/api/mcp/asset/33101b65-6984-4ba3-9045-5a87b9bd47a4";
const imgVector8 =
  "https://www.figma.com/api/mcp/asset/d3a95da0-7830-40bd-bd17-97a0906e4198";
const imgVector9 =
  "https://www.figma.com/api/mcp/asset/3ebb69d2-7622-43f6-8716-6959699558d9";
const imgRectangle9 =
  "https://www.figma.com/api/mcp/asset/e0aac126-8fcf-4009-aeb9-6e20541c2d79";
const imgRectangle =
  "https://www.figma.com/api/mcp/asset/919adab7-5160-421f-b574-27d099dee419";
const imgRectangle2 =
  "https://www.figma.com/api/mcp/asset/3937d5f7-3c80-4545-9192-f25d08a7f0ae";
const imgRectangle4 =
  "https://www.figma.com/api/mcp/asset/2fcde3b2-8e5b-4195-9897-d2859aef3a9e";
const imgLine4 =
  "https://www.figma.com/api/mcp/asset/5ed0759e-1eab-4cf0-92d0-d2a651a1b57d";
const imgGroup3 =
  "https://www.figma.com/api/mcp/asset/3a734266-7673-42e3-9eb0-3ea23910093b";
const imgGroup7 =
  "https://www.figma.com/api/mcp/asset/c95965ca-ddcf-4d54-8482-f5186661e5f0";
const imgLineButton =
  "https://www.figma.com/api/mcp/asset/8a28c93f-11a9-4a97-aaea-833ae973fd27";
const imgEllipse2 =
  "https://www.figma.com/api/mcp/asset/220c0b55-a141-4008-8b9e-393c5dcc820b";
const imgEllipse3 =
  "https://www.figma.com/api/mcp/asset/42309589-dc81-48ef-80de-6483844e93cc";

type BasesWorkspaceProps = {
  userName: string;
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

export function BasesWorkspace({ userName }: BasesWorkspaceProps) {
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
    await authClient.signOut();
    router.refresh();
  };

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

  const bases = baseListQuery.data ?? [];
  const userInitial = formatUserInitial(userName);

  return (
    <div className={clsx("min-h-screen bg-[#f9fafb] text-black", inter.className)}>
      <header className="airtable-border airtable-shadow sticky top-0 z-50 flex h-[56px] items-center justify-between border-y bg-white px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="flex h-[24px] w-[24px] items-center justify-center"
            aria-label="Open menu"
          >
            <img alt="" className="h-[10px] w-[15px]" src={menuIcon.src} />
          </button>
          <div className="flex items-center gap-2">
            <img
              alt="Airtable"
              className="h-[23px] w-[28px] shrink-0"
              src={imgVector9}
            />
            <img alt="" className="h-[18px] w-[72px] shrink-0" src={imgRectangle9} />
          </div>
        </div>

        <div className="hidden flex-1 justify-center md:flex">
          <div className="airtable-outline airtable-selection-hover relative flex h-[34px] w-[355px] items-center gap-2 rounded-[17px] bg-white px-3 text-[13px] text-[#616670]">
            <img
              alt=""
              className="h-[14.5px] w-[14.5px] shrink-0"
              src={searchIcon.src}
            />
            <span className="flex-1">Search...</span>
            <div className="flex items-center gap-1 text-[#989aa0]">
              <img
                alt=""
                className="h-[12.7px] w-[12.7px] shrink-0"
                src={imgVector8}
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
            <img alt="" className="h-[15px] w-[15px]" src={helpIcon.src} />
            Help
          </button>
          <button type="button" className="airtable-circle" aria-label="Notifications">
            <img alt="" className="h-[16px] w-[16px]" src={bellIcon.src} />
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="airtable-circle relative overflow-hidden"
            aria-label="Sign out"
          >
            <img
              alt=""
              className="absolute inset-0 m-auto h-[29px] w-[29px]"
              src={imgEllipse2}
            />
            <img
              alt=""
              className="absolute inset-0 m-auto h-[26px] w-[26px]"
              src={imgEllipse3}
            />
            <span className="relative text-[13px] text-white">{userInitial}</span>
          </button>
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
                  <img
                    alt=""
                    className="airtable-nav-icon-img h-[18px] w-[18px] shrink-0"
                    src={imgVector3}
                  />
                </span>
                Home
              </button>
              <button type="button" className="airtable-nav-item airtable-nav-item-hover">
                <span className="flex items-center gap-[12px]">
                  <span className="airtable-nav-icon-slot">
                    <img
                      alt=""
                      className="airtable-nav-icon-img h-[19px] w-[20px] shrink-0"
                      src={imgVector4}
                    />
                  </span>
                  Starred
                </span>
                <span className="airtable-nav-chevron ml-auto translate-x-[1px]" />
              </button>
              <button type="button" className="airtable-nav-item airtable-nav-item-hover">
                <span className="airtable-nav-icon-slot">
                  <img
                    alt=""
                    className="airtable-nav-icon-img h-[16px] w-[17px] shrink-0"
                    src={imgVector5}
                  />
                </span>
                Shared
              </button>
              <button type="button" className="airtable-nav-item airtable-nav-item-hover">
                <span className="flex items-center gap-[12px]">
                  <span className="airtable-nav-icon-slot">
                    <img
                      alt=""
                      className="airtable-nav-icon-img h-[17px] w-[22px] shrink-0"
                      src={imgRectangle6}
                    />
                  </span>
                  Workspaces
                </span>
                <span className="ml-auto flex items-center gap-[12px]">
                  <img
                    alt=""
                    className="h-[12px] w-[12px] shrink-0 translate-x-[1px]"
                    src={imgGroup3}
                  />
                  <span className="airtable-nav-chevron translate-x-[1px]" />
                </span>
              </button>
            </div>
          </div>

          <div className="mt-auto px-[12px] pb-[20px]">
            <div className="mb-[16px] flex justify-center">
              <img alt="" className="h-[1px] w-[251px]" src={imgLine4} />
            </div>
            <div className="space-y-4 px-[7px] text-[12.5px]">
              <button type="button" className="flex items-center gap-[11px]">
                <img alt="" className="h-[15px] w-[17px] shrink-0" src={imgVector} />
                Templates and apps
              </button>
              <button type="button" className="flex items-center gap-[11px]">
                <img alt="" className="h-[12px] w-[14px] shrink-0" src={imgVector1} />
                Marketplace
              </button>
              <button type="button" className="flex items-center gap-[11px]">
                <img alt="" className="h-[14px] w-[14px] shrink-0" src={imgVector2} />
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

        <main className="flex-1 px-6 pb-10 pt-[33px] lg:px-[48px]">
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
              <div className="absolute left-[16.5px] top-[17px]">
                <div
                  className="h-[17px] w-[18px]"
                  style={{
                    maskImage: `url('${imgRectangle4}')`,
                    WebkitMaskImage: `url('${imgRectangle4}')`,
                    maskSize: "18px 17.086px",
                    WebkitMaskSize: "18px 17.086px",
                    maskRepeat: "no-repeat",
                    WebkitMaskRepeat: "no-repeat",
                    maskPosition: "0.595px 0px",
                    WebkitMaskPosition: "0.595px 0px",
                  }}
                >
                  <img alt="" className="h-[17px] w-[18px]" src={imgRectangle5} />
                </div>
              </div>
              <p className="absolute left-[45px] right-[12px] top-[17px] text-[15px] font-semibold text-[#1D1F24]">
                Performance Dashboard
              </p>
              <p className="absolute left-[17px] right-[12px] top-[40px] z-10 text-[13px] font-normal leading-[19px] text-[#616670]">
                Visualize key marketing metrics and campaign ROI at a glance.
              </p>
            </div>
            <div className="airtable-outline airtable-selection-hover relative h-[94px] w-full rounded-[5px] bg-white sm:w-[351px]">
              <div className="absolute left-[16.5px] top-[17px]">
                <div
                  className="h-[18.6px] w-[16.3px]"
                  style={{
                    maskImage: `url('${imgRectangle2}')`,
                    WebkitMaskImage: `url('${imgRectangle2}')`,
                    maskSize: "16.3px 18.583px",
                    WebkitMaskSize: "16.3px 18.583px",
                    maskRepeat: "no-repeat",
                    WebkitMaskRepeat: "no-repeat",
                    maskPosition: "0.1px 0.003px",
                    WebkitMaskPosition: "0.1px 0.003px",
                  }}
                >
                  <img alt="" className="h-[18.6px] w-[16.3px]" src={imgRectangle3} />
                </div>
              </div>
              <p className="absolute left-[45px] right-[12px] top-[17px] text-[15px] font-semibold text-[#1D1F24]">
                Content Calendar
              </p>
              <p className="absolute left-[17px] right-[12px] top-[40px] z-10 text-[13px] font-normal leading-[19px] text-[#616670]">
                Plan, schedule, and track all marketing content in one place.
              </p>
            </div>
            <div className="airtable-outline airtable-selection-hover relative h-[94px] w-full rounded-[5px] bg-white sm:w-[349px]">
              <div className="absolute left-[16.5px] top-[17px]">
                <div
                  className="h-[18.1px] w-[19px]"
                  style={{
                    maskImage: `url('${imgRectangle}')`,
                    WebkitMaskImage: `url('${imgRectangle}')`,
                    maskSize: "19.033px 18.067px",
                    WebkitMaskSize: "19.033px 18.067px",
                    maskRepeat: "no-repeat",
                    WebkitMaskRepeat: "no-repeat",
                    maskPosition: "0.081px -0.001px",
                    WebkitMaskPosition: "0.081px -0.001px",
                  }}
                >
                  <img alt="" className="h-[18.1px] w-[19px]" src={imgRectangle1} />
                </div>
              </div>
              <p className="absolute left-[45px] right-[12px] top-[17px] text-[15px] font-semibold text-[#1D1F24]">
                Campaign Tracker
              </p>
              <p className="absolute left-[17px] right-[12px] top-[40px] z-10 text-[13px] font-normal leading-[19px] text-[#616670]">
                Monitor and manage marketing campaigns from planning to results.
              </p>
            </div>
          </div>

          <div className="mt-10 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[15px] font-normal text-[#54555A]">
              Opened anytime
              <span
                className="inline-block h-[9.45px] w-[5.95px]"
                style={{
                  backgroundColor: "#54555A",
                  maskImage: `url('${imgGroup7}')`,
                  WebkitMaskImage: `url('${imgGroup7}')`,
                  maskSize: "100% 100%",
                  WebkitMaskSize: "100% 100%",
                  maskRepeat: "no-repeat",
                  WebkitMaskRepeat: "no-repeat",
                  maskPosition: "center",
                  WebkitMaskPosition: "center",
                  transform: "rotate(-90deg)",
                }}
              />
            </div>
            <div className="flex items-center gap-4">
              <img
                alt=""
                className="h-[9.5px] w-[15px] shrink-0"
                src={imgLineButton}
              />
              <img
                alt=""
                className="h-[30.85px] w-[32.494px] shrink-0"
                src={imgVector6}
              />
            </div>
          </div>

          <section className="mt-4">
            {baseListQuery.isLoading ? (
              <div className="airtable-outline rounded-[6px] bg-white px-4 py-6 text-[13px] text-black/70">
                Loading bases...
              </div>
            ) : bases.length === 0 ? (
              <div className="airtable-outline rounded-[6px] bg-white px-4 py-6 text-[13px] text-black/70">
                <p className="text-[14px] font-medium text-black">
                  No bases yet
                </p>
                <p className="mt-1 text-[12px] text-black/60">
                  Create your first base using the Create button in the sidebar.
                </p>
              </div>
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
                        <img
                          alt=""
                          className="airtable-open-data-icon scale-[1.17]"
                          src={dataIcon.src}
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
                        <img
                          alt=""
                          className="h-[19px] w-[20px] scale-90"
                          src={imgVector4}
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
                            <img
                              alt=""
                              className="absolute left-[16px] top-1/2 h-[14px] w-[14px] -translate-y-1/2 scale-[1.3] mix-blend-multiply"
                              src={renameIcon.src}
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
                            <img
                              alt=""
                              className="absolute left-[16px] top-1/2 h-[14px] w-[14px] -translate-y-1/2 scale-[1.3] mix-blend-multiply"
                              src={deleteIcon.src}
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
