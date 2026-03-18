"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "~/trpc/react";
import {
	isValidTableId,
	isValidUUID,
	getLastViewedViewKey,
	buildRowsPrefetchInput,
} from "~/lib/utils";
import type { SortConfig, FilterItem, FilterConnector } from "~/lib/types";

// ----- Types ---------------------------------------------------------------

type ViewEntry = {
	id: string;
	name: string;
	sortConfig?: unknown;
	hiddenColumnIds?: unknown;
	searchQuery?: unknown;
	filterConfig?: unknown;
};

type TableEntry = {
	id: string;
	name: string;
	views: ViewEntry[];
};

export type UseViewManagerParams = {
	baseId: string;
	activeTableId: string | null;
	/** Tables array from base.get query (undefined while loading) */
	tables: TableEntry[] | undefined;

	/** Ref called inside handleSelectView to close all toolbar menus */
	closeAllMenusRef: React.MutableRefObject<() => void>;
	/** Ref called before creating/switching views to persist pending search */
	flushPendingSearchRef: React.MutableRefObject<() => void>;
	/** Ref called before creating/switching views to persist pending filter */
	flushPendingFilterRef: React.MutableRefObject<() => void>;

	// Row-query state for view-switching detection
	rowsIsFetching: boolean;
	rowsIsFetchingNextPage: boolean;
	rowsIsPlaceholderData: boolean;
	rowsIsError: boolean;
	rowsHasFirstPage: boolean;
	/** JSON.stringify({ f: filterInput, s: searchQuery }) — re-fires switching effect */
	rowsQueryKeyFingerprint: string;
};

// ----- Hook ----------------------------------------------------------------

export function useViewManager({
	baseId,
	activeTableId,
	tables,
	closeAllMenusRef,
	flushPendingSearchRef,
	flushPendingFilterRef,
	rowsIsFetching,
	rowsIsFetchingNextPage,
	rowsIsPlaceholderData,
	rowsIsError,
	rowsHasFirstPage,
	rowsQueryKeyFingerprint,
}: UseViewManagerParams) {
	const utils = api.useUtils();

	// ── View state ──────────────────────────────────────────────────────
	const [activeViewId, setActiveViewId] = useState<string | null>(null);
	const [isViewSwitching, setIsViewSwitching] = useState(false);
	const viewDataReadyPassRef = useRef(0);
	const [pendingViewName, setPendingViewName] = useState<string | null>(null);

	// Derive views for the currently active table
	const activeTableViews = useMemo(() => {
		if (!activeTableId || !tables) return [];
		const table = tables.find((t) => t.id === activeTableId);
		return table?.views ?? [];
	}, [activeTableId, tables]);

	// ── Ensure default view (migration for pre-view tables) ─────────────
	const ensureDefaultViewMutation = api.view.ensureDefaultView.useMutation({
		onSuccess: (result) => {
			if (result.created) {
				utils.view.getView.setData(
					{ viewId: result.id },
					{
						id: result.id,
						name: result.name,
						sortConfig: [],
						hiddenColumnIds: [],
						searchQuery: "",
						filterConfig: null,
					},
				);
				void utils.base.get.invalidate({ baseId });
			}
			if (!activeViewId || activeViewId === "pending-view") {
				setActiveViewId(result.id);
			}
		},
	});
	const ensureDefaultViewCalledRef = useRef<string | null>(null);

	useEffect(() => {
		if (!activeTableId) return;
		if (activeTableViews.length > 0) {
			if (
				activeViewId === null ||
				(!activeTableViews.some((v) => v.id === activeViewId) &&
					activeViewId !== "pending-view")
			) {
				setActiveViewId(activeTableViews[0]!.id);
			}
		} else if (tables && isValidTableId(activeTableId)) {
			if (ensureDefaultViewCalledRef.current !== activeTableId) {
				ensureDefaultViewCalledRef.current = activeTableId;
				ensureDefaultViewMutation.mutate({ tableId: activeTableId });
			}
		}
	}, [activeTableId, activeTableViews, activeViewId, tables]);

	// ── Create view ─────────────────────────────────────────────────────
	const createViewMutation = api.view.createView.useMutation({
		onMutate: ({ name }) => {
			setIsViewSwitching(true);
			setPendingViewName(name);
			setActiveViewId("pending-view");
		},
		onSuccess: (newView) => {
			utils.view.getView.setData(
				{ viewId: newView.id },
				{
					id: newView.id,
					name: newView.name,
					sortConfig: [],
					hiddenColumnIds: [],
					searchQuery: "",
					filterConfig: null,
				},
			);
			utils.base.get.setData({ baseId }, (prev) => {
				if (!prev) return prev;
				return {
					...prev,
					tables: prev.tables.map((table) =>
						table.id === newView.tableId
							? {
									...table,
									views: [
										...table.views,
										{
											id: newView.id,
											name: newView.name,
											sortConfig: [],
											hiddenColumnIds: [],
											searchQuery: "",
											filterConfig: null,
										},
									],
								}
							: table,
					),
				};
			});
			setActiveViewId(newView.id);
			setPendingViewName(null);
			void utils.base.get.invalidate({ baseId });
		},
		onError: () => {
			setIsViewSwitching(false);
			setPendingViewName(null);
			setActiveViewId(activeTableViews[0]?.id ?? null);
		},
	});

	// ── Active view query ───────────────────────────────────────────────
	const hasActiveView = activeViewId !== null && isValidUUID(activeViewId);
	const activeViewQuery = api.view.getView.useQuery(
		{ viewId: activeViewId! },
		{ enabled: hasActiveView, staleTime: 30_000 },
	);

	// ── Update view mutation (optimistic) ───────────────────────────────
	const updateViewMutation = api.view.updateView.useMutation({
		onMutate: async ({
			viewId,
			sortConfig,
			hiddenColumnIds,
			searchQuery,
			filterConfig,
		}) => {
			await utils.view.getView.cancel({ viewId });
			const previous = utils.view.getView.getData({ viewId });
			utils.view.getView.setData({ viewId }, (current) => {
				if (!current) return current;
				return {
					...current,
					...(sortConfig !== undefined && { sortConfig }),
					...(hiddenColumnIds !== undefined && { hiddenColumnIds }),
					...(searchQuery !== undefined && { searchQuery }),
					...(filterConfig !== undefined && { filterConfig }),
				};
			});
			return { previous, viewId };
		},
		onError: (_error, _variables, context) => {
			if (context?.previous && context?.viewId) {
				utils.view.getView.setData(
					{ viewId: context.viewId },
					context.previous,
				);
			}
		},
		onSettled: (_data, error, variables) => {
			if (error) {
				void utils.view.getView.invalidate({ viewId: variables.viewId });
			}
		},
	});

	// ── Seed getView cache from base.get data ───────────────────────────
	const seededBaseRef = useRef<string | null>(null);
	useEffect(() => {
		if (!tables || seededBaseRef.current === baseId) return;
		seededBaseRef.current = baseId;
		for (const table of tables) {
			for (const view of table.views) {
				utils.view.getView.setData(
					{ viewId: view.id },
					{
						id: view.id,
						name: view.name,
						sortConfig: view.sortConfig as SortConfig[],
						hiddenColumnIds: view.hiddenColumnIds as string[],
						searchQuery: view.searchQuery as string,
						filterConfig: view.filterConfig as null,
					},
				);
			}
		}
	}, [tables, baseId, utils.view.getView]);

	// ── Effective configs (derived from active view) ────────────────────
	const effectiveHiddenColumnIds = (activeViewQuery.data?.hiddenColumnIds ??
		[]) as string[];
	const effectiveSearchQuery = (activeViewQuery.data?.searchQuery ??
		"") as string;
	const effectiveSortConfig = useMemo(
		() => (activeViewQuery.data?.sortConfig ?? []) as SortConfig[],
		[activeViewQuery.data?.sortConfig],
	);
	const effectiveFilterConfig = useMemo(
		() =>
			(activeViewQuery.data?.filterConfig ?? null) as {
				connector: FilterConnector;
				items: FilterItem[];
			} | null,
		[activeViewQuery.data?.filterConfig],
	);

	// ── updateViewConfig helper ─────────────────────────────────────────
	const updateViewConfig = useCallback(
		(config: {
			sortConfig?: SortConfig[];
			filterConfig?:
				| { connector: FilterConnector; items: FilterItem[] }
				| null;
			hiddenColumnIds?: string[];
			searchQuery?: string;
		}) => {
			if (!hasActiveView || !activeViewId) return;
			updateViewMutation.mutate({ viewId: activeViewId, ...config });
		},
		[hasActiveView, activeViewId, updateViewMutation],
	);

	// ── handleCreateView ────────────────────────────────────────────────
	const handleCreateView = useCallback(
		(viewName: string) => {
			if (!activeTableId) return;
			flushPendingSearchRef.current();
			flushPendingFilterRef.current();
			createViewMutation.mutate({
				tableId: activeTableId,
				name: viewName,
			});
		},
		[activeTableId, createViewMutation],
	);

	// ── Rename view mutation ────────────────────────────────────────────
	const renameViewMutation = api.view.renameView.useMutation({
		onMutate: async ({ viewId: renamedViewId, name: newName }) => {
			await utils.base.get.cancel({ baseId });
			const previousData = utils.base.get.getData({ baseId });
			utils.base.get.setData({ baseId }, (old) => {
				if (!old) return old;
				return {
					...old,
					tables: old.tables.map((table) =>
						table.id === activeTableId
							? {
									...table,
									views: table.views.map((v) =>
										v.id === renamedViewId
											? { ...v, name: newName }
											: v,
									),
								}
							: table,
					),
				};
			});
			if (isValidUUID(renamedViewId)) {
				await utils.view.getView.cancel({ viewId: renamedViewId });
				utils.view.getView.setData(
					{ viewId: renamedViewId },
					(old) => {
						if (!old) return old;
						return { ...old, name: newName };
					},
				);
			}
			return { previousData };
		},
		onError: (_err, _vars, context) => {
			if (context?.previousData) {
				utils.base.get.setData({ baseId }, context.previousData);
			}
		},
		onSettled: (_data, _error, variables) => {
			void utils.base.get.invalidate({ baseId });
			if (isValidUUID(variables.viewId)) {
				void utils.view.getView.invalidate({
					viewId: variables.viewId,
				});
			}
		},
	});

	// ── Delete view mutation ────────────────────────────────────────────
	const deleteViewMutation = api.view.deleteView.useMutation({
		onMutate: async ({ viewId: deletedViewId }) => {
			await utils.base.get.cancel({ baseId });
			const previousData = utils.base.get.getData({ baseId });
			utils.base.get.setData({ baseId }, (old) => {
				if (!old) return old;
				return {
					...old,
					tables: old.tables.map((table) =>
						table.id === activeTableId
							? {
									...table,
									views: table.views.filter(
										(v) => v.id !== deletedViewId,
									),
								}
							: table,
					),
				};
			});
			const remainingViews = activeTableViews.filter(
				(v) => v.id !== deletedViewId,
			);
			setActiveViewId(remainingViews[0]?.id ?? null);
			return { previousData };
		},
		onSuccess: () => {
			void utils.base.get.invalidate({ baseId });
		},
		onError: (_err, _vars, context) => {
			if (context?.previousData) {
				utils.base.get.setData({ baseId }, context.previousData);
			}
			setActiveViewId(activeTableViews[0]?.id ?? null);
		},
	});

	// ── Duplicate view mutation ─────────────────────────────────────────
	const duplicateViewMutation = api.view.duplicateView.useMutation({
		onMutate: ({ name }) => {
			setIsViewSwitching(true);
			if (name) setPendingViewName(name);
			setActiveViewId("pending-view");
		},
		onSuccess: (newView) => {
			utils.view.getView.setData(
				{ viewId: newView.id },
				{
					id: newView.id,
					name: newView.name,
					sortConfig: newView.sortConfig,
					hiddenColumnIds: newView.hiddenColumnIds,
					searchQuery: newView.searchQuery,
					filterConfig: newView.filterConfig,
				},
			);
			utils.base.get.setData({ baseId }, (prev) => {
				if (!prev) return prev;
				return {
					...prev,
					tables: prev.tables.map((table) =>
						table.id === newView.tableId
							? {
									...table,
									views: [
										...table.views,
										{
											id: newView.id,
											name: newView.name,
											sortConfig: newView.sortConfig,
											hiddenColumnIds:
												newView.hiddenColumnIds,
											searchQuery: newView.searchQuery,
											filterConfig: newView.filterConfig,
										},
									],
								}
							: table,
					),
				};
			});
			setActiveViewId(newView.id);
			setPendingViewName(null);
			void utils.base.get.invalidate({ baseId });
		},
		onError: () => {
			setIsViewSwitching(false);
			setPendingViewName(null);
			setActiveViewId(activeTableViews[0]?.id ?? null);
		},
	});

	// ── View CRUD handlers ──────────────────────────────────────────────
	const handleRenameView = useCallback(
		(viewId: string, newName: string) => {
			if (!isValidUUID(viewId)) return;
			renameViewMutation.mutate({ viewId, name: newName });
		},
		[renameViewMutation],
	);

	const handleDeleteView = useCallback(
		(viewId: string) => {
			deleteViewMutation.mutate({ viewId });
		},
		[deleteViewMutation],
	);

	const handleDuplicateView = useCallback(
		(viewId: string, name: string) => {
			duplicateViewMutation.mutate({ viewId, name });
		},
		[duplicateViewMutation],
	);

	// ── Select view ─────────────────────────────────────────────────────
	const handleSelectView = useCallback(
		(viewId: string) => {
			closeAllMenusRef.current();
			flushPendingSearchRef.current();
			flushPendingFilterRef.current();
			setIsViewSwitching(true);
			viewDataReadyPassRef.current = 0;
			setActiveViewId(viewId);
			if (isValidUUID(viewId)) {
				void utils.view.getView.prefetch(
					{ viewId },
					{ staleTime: 30_000 },
				);
				if (activeTableId) {
					const cachedView = utils.view.getView.getData({ viewId });
					if (cachedView) {
						const rowsInput = buildRowsPrefetchInput(
							activeTableId,
							cachedView,
						);
						void utils.row.getRows.prefetchInfinite(rowsInput, {
							staleTime: 30_000,
						});
					}
				}
			}
		},
		[utils.view.getView, utils.row.getRows, activeTableId],
	);

	// ── Hover view (prefetch) ───────────────────────────────────────────
	const handleHoverView = useCallback(
		(viewId: string) => {
			if (
				!isValidUUID(viewId) ||
				!activeTableId ||
				viewId === activeViewId
			)
				return;
			const cachedView = utils.view.getView.getData({ viewId });
			if (cachedView) {
				const rowsInput = buildRowsPrefetchInput(
					activeTableId,
					cachedView,
				);
				void utils.row.getRows.prefetchInfinite(rowsInput, {
					staleTime: 30_000,
				});
			}
		},
		[utils.view.getView, utils.row.getRows, activeTableId, activeViewId],
	);

	// ── View switching detection (main effect) ──────────────────────────
	useEffect(() => {
		if (!isViewSwitching) {
			viewDataReadyPassRef.current = 0;
			return;
		}
		if (createViewMutation.isPending) return;
		if (activeViewId === "pending-view") return;

		const viewDataReady =
			!hasActiveView ||
			(activeViewQuery.data !== undefined &&
				!activeViewQuery.isFetching) ||
			activeViewQuery.isError;

		if (!viewDataReady) {
			viewDataReadyPassRef.current = 0;
			return;
		}

		viewDataReadyPassRef.current += 1;
		if (viewDataReadyPassRef.current < 2) return;

		const rowsDataReady =
			(rowsHasFirstPage &&
				!rowsIsFetching &&
				!rowsIsPlaceholderData) ||
			rowsIsError;

		if (rowsDataReady) {
			setIsViewSwitching(false);
		}
	}, [
		isViewSwitching,
		hasActiveView,
		createViewMutation.isPending,
		activeViewQuery.data,
		activeViewQuery.isFetching,
		activeViewQuery.isError,
		rowsHasFirstPage,
		rowsIsFetching,
		rowsIsError,
		rowsIsPlaceholderData,
		rowsQueryKeyFingerprint,
	]);

	// ── View switching detection (fallback interval) ────────────────────
	const viewSwitchDataReadyRef = useRef(false);
	viewSwitchDataReadyRef.current =
		!rowsIsFetching && !rowsIsPlaceholderData && rowsHasFirstPage;
	const activeViewIdRef = useRef(activeViewId);
	activeViewIdRef.current = activeViewId;
	const createViewPendingRef = useRef(false);
	createViewPendingRef.current = createViewMutation.isPending;

	useEffect(() => {
		if (!isViewSwitching) return;
		const start = Date.now();
		const interval = setInterval(() => {
			const isHardCap = Date.now() - start > 5000;
			if (
				!isHardCap &&
				(activeViewIdRef.current === "pending-view" ||
					createViewPendingRef.current)
			) {
				return;
			}
			if (viewSwitchDataReadyRef.current || isHardCap) {
				setIsViewSwitching(false);
			}
		}, 200);
		return () => clearInterval(interval);
	}, [isViewSwitching]);

	// ── Reset view selection on table change ────────────────────────────
	const prevResetTableIdRef = useRef<string | null>(null);
	useEffect(() => {
		if (!activeTableId) {
			prevResetTableIdRef.current = null;
			setActiveViewId(null);
			return;
		}
		if (prevResetTableIdRef.current === null) {
			prevResetTableIdRef.current = activeTableId;
			return;
		}
		if (prevResetTableIdRef.current === activeTableId) return;
		prevResetTableIdRef.current = activeTableId;
		let restoredViewId: string | null = null;
		try {
			const storedViewId = window.localStorage.getItem(
				getLastViewedViewKey(activeTableId),
			);
			if (storedViewId && isValidUUID(storedViewId)) {
				restoredViewId = storedViewId;
			}
		} catch {
			/* ignore */
		}
		setActiveViewId(restoredViewId);
	}, [activeTableId]);

	// ── Persist last-viewed view per table ──────────────────────────────
	useEffect(() => {
		if (!isValidTableId(activeTableId) || !isValidUUID(activeViewId))
			return;
		try {
			window.localStorage.setItem(
				getLastViewedViewKey(activeTableId),
				activeViewId,
			);
		} catch {
			/* ignore */
		}
	}, [activeViewId, activeTableId]);

	// ── Views list (includes pending view during creation) ──────────────
	const views = useMemo(() => {
		const list = [...activeTableViews];
		if (
			pendingViewName &&
			!activeTableViews.some((v) => v.name === pendingViewName)
		) {
			list.push({ id: "pending-view", name: pendingViewName });
		}
		return list;
	}, [activeTableViews, pendingViewName]);

	const activeView = views.find((v) => v.id === activeViewId);
	const activeViewName =
		pendingViewName ?? activeView?.name ?? "Grid view";

	// ── Return ──────────────────────────────────────────────────────────
	return {
		activeViewId,
		setActiveViewId,
		isViewSwitching,
		pendingViewName,
		hasActiveView,
		activeViewName,
		views,
		activeViewQuery,
		updateViewConfig,
		effectiveSortConfig,
		effectiveFilterConfig,
		effectiveSearchQuery,
		effectiveHiddenColumnIds,
		handleCreateView,
		handleSelectView,
		handleHoverView,
		handleRenameView,
		handleDeleteView,
		handleDuplicateView,
	};
}
