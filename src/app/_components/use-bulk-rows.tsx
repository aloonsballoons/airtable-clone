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
    onMutate: async ({ tableId, count }) => {
      if (!activeTableId || tableId !== activeTableId) {
        return { queryKey: null, tableId, previous: null, isSingleRow: false };
      }
      const queryKey = getRowsQueryKey(tableId);
      const isSingleRow = count === 1;

      // Single-row additions are handled optimistically by the caller
      // (addRowsMutateWithOptimistic) which synchronously injects the row
      // into the sparse cache and bumps the local row count.  We skip the
      // expensive cancel + pages.map here to keep it instant.
      if (isSingleRow) {
        return { queryKey, tableId, previous: null, isSingleRow: true };
      }

      // Bulk inserts — cancel in-flight queries to prevent race conditions
      await utils.base.getRows.cancel(queryKey);

      return { queryKey, tableId, previous: null, isSingleRow: false };
    },
    onSuccess: (data, variables, context) => {
      const tableId = variables.tableId;
      const isSingleRow = variables.count === 1;

      // Notify caller to clear sparse page cache before invalidation
      if (!isSingleRow) {
        onBulkSuccess?.();
      }

      // Use the specific query key captured in onMutate to ensure we
      // invalidate the exact infinite query the component is observing.
      const queryKey = context?.queryKey ?? getRowsQueryKey(tableId);

      // Update totalCount immediately from the mutation response
      // for instant visual feedback before the refetch completes.
      // Skip for single-row additions — the optimistic onMutate already
      // set the correct totalCount and row data.  Running setInfiniteData
      // here would set nextCursor on the last page, making
      // rowsHasNextPage flip to true and briefly creating a skeleton row
      // slot beyond the loaded data.
      if (data?.newTotalCount != null && !isSingleRow) {
        utils.base.getRows.setInfiniteData(queryKey, (old) => {
          if (!old) return old;
          const lastIdx = old.pages.length - 1;
          return {
            ...old,
            pages: old.pages.map((page, i) => ({
              ...page,
              totalCount: data.newTotalCount,
              // Fix the last page's cursor so hasNextPage becomes true
              // after appending rows beyond the previously-known end.
              ...(i === lastIdx && page.nextCursor == null && data.added > 0
                ? { nextCursor: ((old.pageParams[lastIdx] as number) ?? 0) + page.rows.length }
                : {}),
            })),
          };
        });
      }

      // Mark stale WITHOUT triggering an immediate refetch.  For single-row
      // additions the optimistic onMutate data is already correct; an active
      // refetch of all infinite-query pages would temporarily shrink the
      // pages array and create skeleton rows.  For bulk inserts the same
      // approach avoids a burst of hundreds of concurrent page fetches.
      // The virtualizer re-fetches visible pages on-demand as the user
      // scrolls (the query is stale so TQ fetches fresh data automatically).
      void utils.base.getRows.invalidate(queryKey, { refetchType: 'none' });
      void utils.base.getTableMeta.refetch({ tableId });
    },
    onError: (error, variables, context) => {
      // Surface bulk insert errors so they're not silently swallowed.
      if (variables.count > 1) {
        console.error("[addRows] Bulk insert failed:", error.message);
        window.alert(`Failed to add rows: ${error.message}`);
      }

      // Invalidate to sync with server state; the sparse cache optimistic
      // entry will be overwritten on the next fetch cycle.
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

  // Only treat bulk inserts (count > 1) as "pending" for loading indicators.
  // Single-row additions are handled optimistically and should not block the UI.
  const isBulkPending = addRows.isPending && (addRows.variables?.count ?? 0) > 1;

  const bulkRowsDisabled =
    !activeTableId || addRows.isPending || activeRowCount + BULK_ROWS > MAX_ROWS;

  return {
    handleAddBulkRows,
    bulkRowsDisabled,
    addRowsMutate: addRows.mutate,
    addRowsIsPending: isBulkPending,
  };
}
