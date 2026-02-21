import { api, type RouterInputs } from "~/trpc/react";

export const BULK_ROWS = 100_000;
export const MAX_ROWS = 2_000_000;

interface UseBulkRowsOptions {
  activeTableId: string | null;
  activeRowCount: number;
  hasActiveFilters: boolean;
  utils: ReturnType<typeof api.useUtils>;
  getRowsQueryKey: (tableId: string) => RouterInputs["base"]["getRows"];
  onBulkSuccess?: () => void;
}

export function useBulkRows({
  activeTableId,
  activeRowCount,
  hasActiveFilters,
  utils,
  getRowsQueryKey,
  onBulkSuccess,
}: UseBulkRowsOptions) {
  const addRows = api.base.addRows.useMutation({
    onMutate: async ({ tableId, count, ids }) => {
      if (!activeTableId || tableId !== activeTableId) {
        return { queryKey: null, tableId, previous: null, isSingleRow: false };
      }
      const queryKey = getRowsQueryKey(tableId);
      const isSingleRow = count === 1;

      // Cancel any in-flight queries to prevent race conditions
      await utils.base.getRows.cancel(queryKey);

      // For single row additions, add optimistic update
      if (isSingleRow && ids && ids.length === 1) {
        const previous = utils.base.getRows.getInfiniteData(queryKey);

        // Add optimistic row to the END of the last page so it appears at the
        // bottom of the table.  Also bump totalCount on every page so
        // activeRowCount (derived from page[0].totalCount) stays in sync.
        utils.base.getRows.setInfiniteData(queryKey, (data) => {
          if (!data) return data;

          const newRow = {
            id: ids[0]!,
            data: {},
          };

          const lastIndex = data.pages.length - 1;
          return {
            ...data,
            pages: data.pages.map((page, index) => {
              const bumpedCount =
                typeof page.totalCount === "number"
                  ? page.totalCount + 1
                  : page.totalCount;
              if (index === lastIndex) {
                return {
                  ...page,
                  totalCount: bumpedCount,
                  rows: [...page.rows, newRow],
                };
              }
              return { ...page, totalCount: bumpedCount };
            }),
          };
        });

        return { queryKey, tableId, previous, isSingleRow: true };
      }

      return { queryKey, tableId, previous: null, isSingleRow: false };
    },
    onSuccess: async (_data, variables, context) => {
      const tableId = variables.tableId;
      const isSingleRow = variables.count === 1;

      // Notify caller to clear sparse page cache before invalidation
      if (!isSingleRow) {
        onBulkSuccess?.();
      }

      // Use the specific query key captured in onMutate to ensure we
      // invalidate the exact infinite query the component is observing.
      const queryKey = context?.queryKey ?? getRowsQueryKey(tableId);

      console.log("[BULK-DEBUG] onSuccess: invalidating getRows", {
        tableId,
        isSingleRow,
        hasQueryKey: !!context?.queryKey,
        queryKey: JSON.stringify(queryKey),
      });

      await utils.base.getRows.invalidate(queryKey);

      console.log("[BULK-DEBUG] onSuccess: getRows invalidated, refetching tableMeta");

      await utils.base.getTableMeta.refetch({ tableId });

      console.log("[BULK-DEBUG] onSuccess: complete");
    },
    onError: (_error, _variables, context) => {
      // On error, revert optimistic update
      if (context?.previous && context.isSingleRow) {
        utils.base.getRows.setInfiniteData(context.queryKey, context.previous);
      }

      if (!context?.queryKey) return;
      void utils.base.getRows.invalidate(context.queryKey);
    },
  });

  const handleAddBulkRows = () => {
    if (!activeTableId) return;
    addRows.mutate({
      tableId: activeTableId,
      count: BULK_ROWS,
      populateWithFaker: true,
    });
  };

  const bulkRowsDisabled =
    !activeTableId || addRows.isPending || activeRowCount + BULK_ROWS > MAX_ROWS;

  return {
    handleAddBulkRows,
    bulkRowsDisabled,
    addRowsMutate: addRows.mutate,
    addRowsIsPending: addRows.isPending,
  };
}
