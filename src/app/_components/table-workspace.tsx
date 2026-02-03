"use client";

import clsx from "clsx";
import { Inter } from "next/font/google";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  type ColumnDef,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";

import { authClient } from "~/server/better-auth/client";
import { api } from "~/trpc/react";

const inter = Inter({
  subsets: ["latin"],
  weight: ["500"],
});

const MAX_TABLES = 1000;
const MAX_COLUMNS = 500;
const MAX_ROWS = 2_000_000;
const BULK_ROWS = 100_000;
const PAGE_ROWS = 50;
const ROW_HEIGHT = 36;

type TableRow = Record<string, string> & { id: string };

type TableWorkspaceProps = {
  baseId: string;
};

type ContextMenuState =
  | {
      type: "table" | "column" | "row";
      id: string;
      x: number;
      y: number;
    }
  | null;

export function TableWorkspace({ baseId }: TableWorkspaceProps) {
  const router = useRouter();
  const utils = api.useUtils();
  const parentRef = useRef<HTMLDivElement>(null);

  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);

  const baseDetailsQuery = api.base.get.useQuery({ baseId });
  const tableMetaQuery = api.base.getTableMeta.useQuery(
    { tableId: activeTableId ?? "" },
    { enabled: Boolean(activeTableId) }
  );
  const rowsQuery = api.base.getRows.useInfiniteQuery(
    { tableId: activeTableId ?? "", limit: PAGE_ROWS },
    {
      enabled: Boolean(activeTableId),
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    }
  );

  const addTable = api.base.addTable.useMutation({
    onSuccess: async (data) => {
      await utils.base.get.invalidate({ baseId });
      setActiveTableId(data.id);
    },
  });

  const deleteTable = api.base.deleteTable.useMutation({
    onSuccess: async () => {
      await utils.base.get.invalidate({ baseId });
      setActiveTableId(null);
    },
  });

  const deleteColumn = api.base.deleteColumn.useMutation({
    onSuccess: async () => {
      if (activeTableId) {
        await utils.base.getTableMeta.invalidate({ tableId: activeTableId });
        await utils.base.getRows.invalidate({
          tableId: activeTableId,
          limit: PAGE_ROWS,
        });
      }
    },
  });

  const addColumn = api.base.addColumn.useMutation({
    onSuccess: async () => {
      if (activeTableId) {
        await utils.base.getTableMeta.invalidate({ tableId: activeTableId });
        await utils.base.getRows.invalidate({
          tableId: activeTableId,
          limit: PAGE_ROWS,
        });
      }
    },
  });

  const addRows = api.base.addRows.useMutation({
    onSuccess: async () => {
      if (activeTableId) {
        await utils.base.getTableMeta.invalidate({ tableId: activeTableId });
        await utils.base.getRows.invalidate({
          tableId: activeTableId,
          limit: PAGE_ROWS,
        });
      }
    },
  });

  const deleteRow = api.base.deleteRow.useMutation({
    onSuccess: async () => {
      if (activeTableId) {
        await utils.base.getTableMeta.invalidate({ tableId: activeTableId });
        await utils.base.getRows.invalidate({
          tableId: activeTableId,
          limit: PAGE_ROWS,
        });
      }
    },
  });

  useEffect(() => {
    setActiveTableId(null);
  }, [baseId]);

  useEffect(() => {
    const tables = baseDetailsQuery.data?.tables ?? [];
    if (!tables.length) return;
    if (activeTableId && tables.some((table) => table.id === activeTableId)) {
      return;
    }
    setActiveTableId(tables[0].id);
  }, [activeTableId, baseDetailsQuery.data?.tables]);

  useEffect(() => {
    if (!activeTableId) return;
    parentRef.current?.scrollTo({ top: 0 });
  }, [activeTableId]);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("scroll", handleClick, true);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("scroll", handleClick, true);
      document.removeEventListener("keydown", handleKey);
    };
  }, [contextMenu]);

  const activeTables = baseDetailsQuery.data?.tables ?? [];
  const activeTable = tableMetaQuery.data?.table ?? null;
  const activeColumns = tableMetaQuery.data?.columns ?? [];
  const activeRowCount = tableMetaQuery.data?.rowCount ?? 0;
  const canDeleteTable = activeTables.length > 1;
  const canDeleteColumn = activeColumns.length > 1;
  const canDeleteRow = activeRowCount > 1;
  const showContextMenu =
    contextMenu &&
    ((contextMenu.type === "table" && canDeleteTable) ||
      (contextMenu.type === "column" && canDeleteColumn) ||
      (contextMenu.type === "row" && canDeleteRow));

  const rows = useMemo(() => {
    const pages = rowsQuery.data?.pages ?? [];
    return pages.flatMap((page) => page.rows);
  }, [rowsQuery.data?.pages]);

  const tableData = useMemo<TableRow[]>(() => {
    if (!activeTable) return [];
    return rows.map((row) => {
      const data = row.data ?? {};
      const cells = Object.fromEntries(
        activeColumns.map((column) => [column.id, data[column.id] ?? ""])
      );
      return { id: row.id, ...cells };
    });
  }, [activeColumns, activeTable, rows]);

  const tableColumns = useMemo<ColumnDef<TableRow>[]>(() => {
    if (!activeTable) return [];
    return activeColumns.map((column) => ({
      accessorKey: column.id,
      header: column.name,
      cell: (info) => info.getValue<string>() ?? "",
    }));
  }, [activeColumns, activeTable]);

  const table = useReactTable({
    data: tableData,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  const gridTemplateColumns = useMemo(() => {
    return Array.from({ length: activeColumns.length }, () =>
      "minmax(160px, 1fr)"
    ).join(" ");
  }, [activeColumns.length]);

  const rowCount = table.getRowModel().rows.length;

  const rowVirtualizer = useVirtualizer({
    count: rowsQuery.hasNextPage ? rowCount + 1 : rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  useEffect(() => {
    const lastItem = virtualItems[virtualItems.length - 1];
    if (!lastItem) return;
    if (
      lastItem.index >= rowCount - 1 &&
      rowsQuery.hasNextPage &&
      !rowsQuery.isFetchingNextPage
    ) {
      rowsQuery.fetchNextPage();
    }
  }, [rowCount, rowsQuery, rowsQuery.hasNextPage, rowsQuery.isFetchingNextPage, virtualItems]);

  const handleAddTable = () => {
    addTable.mutate({ baseId });
  };

  const handleSelectTable = (tableId: string) => {
    setActiveTableId(tableId);
  };

  const handleDeleteTable = (tableId: string) => {
    deleteTable.mutate({ tableId });
    setContextMenu(null);
  };

  const handleDeleteColumn = (columnId: string) => {
    deleteColumn.mutate({ columnId });
    setContextMenu(null);
  };

  const handleAddColumn = () => {
    if (!activeTableId) return;
    addColumn.mutate({ tableId: activeTableId });
  };

  const handleAddRow = () => {
    if (!activeTableId) return;
    addRows.mutate({ tableId: activeTableId, count: 1 });
  };

  const handleAddBulkRows = () => {
    if (!activeTableId) return;
    addRows.mutate({ tableId: activeTableId, count: BULK_ROWS });
  };

  const handleDeleteRow = (rowId: string) => {
    deleteRow.mutate({ rowId });
    setContextMenu(null);
  };

  const handleSignOut = async () => {
    await authClient.signOut();
    router.refresh();
  };

  const handleOpenContextMenu = (
    event: MouseEvent,
    type: "table" | "column" | "row",
    id: string,
    allowed: boolean
  ) => {
    event.preventDefault();
    if (!allowed) {
      setContextMenu(null);
      return;
    }
    setContextMenu({ type, id, x: event.clientX, y: event.clientY });
  };

  const singleRowDisabled =
    !activeTableId || addRows.isPending || activeRowCount >= MAX_ROWS;
  const bulkRowsDisabled =
    !activeTableId ||
    addRows.isPending ||
    activeRowCount + BULK_ROWS > MAX_ROWS;

  return (
    <div className={clsx("min-h-screen bg-[#f6f7fb] pb-12", inter.className)}>
      <header className="flex items-center justify-between border-b border-[#e2e8f0] bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/bases")}
            className="rounded-[8px] border border-[#e2e8f0] px-3 py-2 text-[12px] font-medium text-[#0f172a] hover:border-[#94a3b8]"
          >
            Back to bases
          </button>
          <div>
            <p className="text-[14px] font-medium text-[#0f172a]">
              {baseDetailsQuery.data?.name ?? "Base"}
            </p>
            <p className="text-[12px] text-[#64748b]">
              Tables {activeTables.length}/{MAX_TABLES}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleAddTable}
            disabled={activeTables.length >= MAX_TABLES || addTable.isPending}
            className={clsx(
              "rounded-[8px] border px-3 py-2 text-[12px] font-medium",
              activeTables.length >= MAX_TABLES
                ? "cursor-not-allowed border-[#e2e8f0] bg-[#f1f5f9] text-[#94a3b8]"
                : "border-[#156fe2] bg-white text-[#156fe2] hover:bg-[#e9f1ff]"
            )}
          >
            Add table
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-[8px] border border-[#e2e8f0] px-3 py-2 text-[12px] font-medium text-[#0f172a] hover:border-[#94a3b8]"
          >
            Sign out
          </button>
        </div>
      </header>

      {baseDetailsQuery.isLoading && (
        <section className="px-6 py-8">
          <div className="rounded-[16px] border border-[#e2e8f0] bg-white px-6 py-8 text-[13px] text-[#64748b]">
            Loading base...
          </div>
        </section>
      )}

      {baseDetailsQuery.isError && (
        <section className="px-6 py-8">
          <div className="rounded-[16px] border border-[#fecaca] bg-[#fef2f2] px-6 py-6 text-[12px] text-[#991b1b]">
            We couldn’t load this base. It may have been deleted or you may not
            have access.
          </div>
        </section>
      )}

      <section className="px-6 pt-6">
        <div className="flex flex-wrap gap-2">
          {activeTables.map((tableItem) => (
            <div
              key={tableItem.id}
              className={clsx(
                "flex items-center gap-2 rounded-[999px] border px-3 py-1",
                tableItem.id === activeTableId
                  ? "border-[#156fe2] bg-[#e9f1ff]"
                  : "border-[#e2e8f0] bg-white"
              )}
              onContextMenu={(event) =>
                handleOpenContextMenu(
                  event,
                  "table",
                  tableItem.id,
                  canDeleteTable
                )
              }
            >
              <button
                type="button"
                onClick={() => handleSelectTable(tableItem.id)}
                className={clsx(
                  "text-[11px] font-medium",
                  tableItem.id === activeTableId
                    ? "text-[#0f172a]"
                    : "text-[#475569]"
                )}
              >
                {tableItem.name}
              </button>
            </div>
          ))}
        </div>
      </section>

      {activeTable && (
        <section className="px-6 pt-6">
          <div className="rounded-[16px] border border-[#e2e8f0] bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[14px] font-medium text-[#0f172a]">
                  {activeTable.name}
                </p>
                <p className="text-[12px] text-[#64748b]">
                  Columns {activeColumns.length}/{MAX_COLUMNS} · Rows{" "}
                  {activeRowCount.toLocaleString()}/{MAX_ROWS.toLocaleString()}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleAddColumn}
                  disabled={activeColumns.length >= MAX_COLUMNS || addColumn.isPending}
                  className={clsx(
                    "rounded-[8px] border px-3 py-2 text-[12px] font-medium",
                    activeColumns.length >= MAX_COLUMNS
                      ? "cursor-not-allowed border-[#e2e8f0] bg-[#f1f5f9] text-[#94a3b8]"
                      : "border-[#156fe2] bg-white text-[#156fe2] hover:bg-[#e9f1ff]"
                  )}
                >
                  Add column
                </button>
                <button
                  type="button"
                  onClick={handleAddRow}
                  disabled={singleRowDisabled}
                  className={clsx(
                    "rounded-[8px] border px-3 py-2 text-[12px] font-medium",
                    singleRowDisabled
                      ? "cursor-not-allowed border-[#e2e8f0] bg-[#f1f5f9] text-[#94a3b8]"
                      : "border-[#156fe2] bg-white text-[#156fe2] hover:bg-[#e9f1ff]"
                  )}
                >
                  Add row
                </button>
                <button
                  type="button"
                  onClick={handleAddBulkRows}
                  disabled={bulkRowsDisabled}
                  className={clsx(
                    "rounded-[8px] border px-3 py-2 text-[12px] font-medium",
                    bulkRowsDisabled
                      ? "cursor-not-allowed border-[#e2e8f0] bg-[#f1f5f9] text-[#94a3b8]"
                      : "border-[#156fe2] bg-white text-[#156fe2] hover:bg-[#e9f1ff]"
                  )}
                >
                  Add 100k rows
                </button>
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-[12px] border border-[#e2e8f0]">
              <div
                className="grid border-b border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-[12px] font-medium text-[#0f172a]"
                style={{ gridTemplateColumns }}
              >
                {table.getHeaderGroups()[0]?.headers.map((header) => (
                  <div
                    key={header.id}
                    onContextMenu={(event) =>
                      handleOpenContextMenu(
                        event,
                        "column",
                        header.column.id,
                        canDeleteColumn
                      )
                    }
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </div>
                ))}
              </div>
              <div ref={parentRef} className="max-h-[520px] overflow-auto">
                <div
                  className="relative"
                  style={{ height: rowVirtualizer.getTotalSize() }}
                >
                  {virtualItems.map((virtualRow) => {
                    const row = table.getRowModel().rows[virtualRow.index];
                    if (!row) {
                      return (
                        <div
                          key={`loader-${virtualRow.index}`}
                          className="absolute left-0 right-0 grid items-center px-3 text-[12px] text-[#64748b]"
                          style={{
                            transform: `translateY(${virtualRow.start}px)`,
                            height: `${virtualRow.size}px`,
                            gridTemplateColumns,
                          }}
                        >
                          {rowsQuery.hasNextPage
                            ? "Loading more rows..."
                            : "No more rows"}
                        </div>
                      );
                    }

                    return (
                      <div
                        key={row.id}
                        className="absolute left-0 right-0 grid items-center border-b border-[#e2e8f0] px-3 text-[12px] text-[#1e293b]"
                        style={{
                          transform: `translateY(${virtualRow.start}px)`,
                          height: `${virtualRow.size}px`,
                          gridTemplateColumns,
                        }}
                        onContextMenu={(event) =>
                          handleOpenContextMenu(
                            event,
                            "row",
                            row.id,
                            canDeleteRow
                          )
                        }
                      >
                        {row.getVisibleCells().map((cell) => (
                          <div key={cell.id} className="truncate pr-2">
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext()
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
              {!activeColumns.length && (
                <div className="p-6 text-center text-[12px] text-[#94a3b8]">
                  Add a column to start building this table.
                </div>
              )}
            </div>
            <p className="mt-2 text-[11px] text-[#94a3b8]">
              Showing {Math.min(rows.length, PAGE_ROWS)} rows. Scroll to load more.
            </p>
          </div>
        </section>
      )}

      {showContextMenu && contextMenu && (
        <div
          className="fixed z-50 min-w-[160px] rounded-[10px] border border-[#e2e8f0] bg-white p-1 text-[12px] shadow-[0_10px_30px_rgba(15,23,42,0.15)]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(event) => event.stopPropagation()}
        >
          {contextMenu.type === "table" && canDeleteTable && (
            <button
              type="button"
              onClick={() => handleDeleteTable(contextMenu.id)}
              className="w-full rounded-[8px] px-3 py-2 text-left text-[#dc2626] hover:bg-[#fee2e2]"
            >
              Delete table
            </button>
          )}
          {contextMenu.type === "column" && canDeleteColumn && (
            <button
              type="button"
              onClick={() => handleDeleteColumn(contextMenu.id)}
              className="w-full rounded-[8px] px-3 py-2 text-left text-[#dc2626] hover:bg-[#fee2e2]"
            >
              Delete column
            </button>
          )}
          {contextMenu.type === "row" && canDeleteRow && (
            <button
              type="button"
              onClick={() => handleDeleteRow(contextMenu.id)}
              className="w-full rounded-[8px] px-3 py-2 text-left text-[#dc2626] hover:bg-[#fee2e2]"
            >
              Delete row
            </button>
          )}
        </div>
      )}
    </div>
  );
}
