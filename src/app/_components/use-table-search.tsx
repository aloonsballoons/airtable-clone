import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import type { RefObject, Dispatch, SetStateAction } from "react";

// Custom debounce hook for search input
// Returns [debouncedValue, setImmediate] – call setImmediate(val) to bypass debounce.
function useDebounced<T>(value: T, delay: number): [T, Dispatch<SetStateAction<T>>] {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return [debouncedValue, setDebouncedValue];
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UseTableSearchParams = {
  tableId: string | null;
  viewId?: string | null;
  initialSearchQuery?: string;
};

export type UseTableSearchReturn = {
  // Refs
  searchButtonRef: RefObject<HTMLButtonElement | null>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchMenuRef: RefObject<HTMLDivElement | null>;

  // State
  isSearchMenuOpen: boolean;
  setIsSearchMenuOpen: Dispatch<SetStateAction<boolean>>;
  searchValue: string;
  setSearchValue: Dispatch<SetStateAction<string>>;

  // Computed
  hasSearchQuery: boolean;
  searchQuery: string;

  // Actions
  clearSearch: () => void;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTableSearch({
  tableId,
  viewId,
  initialSearchQuery = "",
}: UseTableSearchParams): UseTableSearchReturn {
  // Refs
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchMenuRef = useRef<HTMLDivElement>(null);

  // State
  const [isSearchMenuOpen, setIsSearchMenuOpen] = useState(false);
  const [searchValue, setSearchValue] = useState(initialSearchQuery);

  // Debounce search value for server queries (150ms delay for snappy feel)
  const [debouncedSearchValue, setDebouncedImmediate] = useDebounced(searchValue, 150);

  // Computed values - using debounced value to avoid query on every keystroke
  const searchQuery = useMemo(() => debouncedSearchValue.trim(), [debouncedSearchValue]);
  const hasSearchQuery = searchQuery.length > 0;

  // Actions
  const clearSearch = useCallback(() => {
    setSearchValue("");
  }, []);

  // Effect: Initialize/reset search when table, view, or initial query changes.
  // Combines two previous effects to avoid a race condition where the reset
  // to "" would overwrite the initialSearchQuery from the new view.
  const prevTableIdRef = useRef(tableId);
  const prevViewIdRef = useRef(viewId);
  const prevInitialSearchRef = useRef(initialSearchQuery);
  useEffect(() => {
    const tableChanged = prevTableIdRef.current !== tableId;
    const viewChanged = prevViewIdRef.current !== viewId;
    const initialChanged = prevInitialSearchRef.current !== initialSearchQuery;
    prevTableIdRef.current = tableId;
    prevViewIdRef.current = viewId;
    prevInitialSearchRef.current = initialSearchQuery;

    if (tableChanged || viewChanged) {
      // On table/view switch, use the initial query from the new view (may be "")
      setSearchValue(initialSearchQuery);
      setIsSearchMenuOpen(false);
      // Bypass debounce: update the debounced value immediately so the query key
      // switches without waiting 150ms. This eliminates the flash of stale data.
      setDebouncedImmediate(initialSearchQuery);
    } else if (initialChanged) {
      // Initial query changed without table/view change (e.g., external update)
      setSearchValue(initialSearchQuery);
      setDebouncedImmediate(initialSearchQuery);
    }
  }, [tableId, viewId, initialSearchQuery, setDebouncedImmediate]);

  // Effect: Close search menu on outside click
  useEffect(() => {
    if (!isSearchMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const searchMenu = searchButtonRef.current?.parentElement?.querySelector(
        '[data-search-menu="true"]'
      );
      if (searchMenu?.contains(target)) return;
      if (searchButtonRef.current?.contains(target)) return;
      setIsSearchMenuOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSearchMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isSearchMenuOpen]);

  // Effect: Focus input when menu opens
  useEffect(() => {
    if (isSearchMenuOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isSearchMenuOpen]);

  return {
    // Refs
    searchButtonRef,
    searchInputRef,
    searchMenuRef,

    // State
    isSearchMenuOpen,
    setIsSearchMenuOpen,
    searchValue,
    setSearchValue,

    // Computed
    hasSearchQuery,
    searchQuery,

    // Actions
    clearSearch,
  };
}
