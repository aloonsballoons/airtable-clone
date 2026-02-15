import { api, type RouterInputs } from "~/trpc/react";

export const BULK_ROWS = 100_000;
export const MAX_ROWS = 2_000_000;

interface UseBulkRowsOptions {
  activeTableId: string | null;
  activeRowCount: number;
  hasActiveFilters: boolean;
  utils: ReturnType<typeof api.useUtils>;
  getRowsQueryKey: (tableId: string) => RouterInputs["base"]["getRows"];
}

export function useBulkRows({
  activeTableId,
  activeRowCount,
  hasActiveFilters,
  utils,
  getRowsQueryKey,
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

        // Add optimistic row to the END of the first page
        utils.base.getRows.setInfiniteData(queryKey, (data) => {
          if (!data) return data;

          const newRow = {
            id: ids[0]!,
            data: {},
          };

          return {
            ...data,
            pages: data.pages.map((page, index) => {
              // Add to the first page
              if (index === 0) {
                return {
                  ...page,
                  rows: [...page.rows, newRow],
                };
              }
              return page;
            }),
          };
        });

        return { queryKey, tableId, previous, isSingleRow: true };
      }

      return { queryKey, tableId, previous: null, isSingleRow: false };
    },
    onSuccess: async (_data, variables, context) => {
      if (!context?.queryKey) return;

      // For bulk operations, clear the cache and refetch from page 1
      if (!context.isSingleRow) {
        // Clear all cached pages by setting data to undefined
        utils.base.getRows.setInfiniteData(context.queryKey, undefined);

        // Force refetch - invalidate marks as stale and refetches if the query is active
        await utils.base.getRows.refetch(context.queryKey);
      } else {
        // For single row, just invalidate to refetch current data
        await utils.base.getRows.invalidate(context.queryKey);
      }

      // Also invalidate and refetch table meta to update row count
      await utils.base.getTableMeta.refetch({ tableId: context.tableId });
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
