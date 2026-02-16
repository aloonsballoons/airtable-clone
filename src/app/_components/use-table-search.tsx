import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import type { RefObject, Dispatch, SetStateAction } from "react";

// Custom debounce hook for search input
function useDebounced<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UseTableSearchParams = {
  tableId: string | null;
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
  const debouncedSearchValue = useDebounced(searchValue, 150);

  // Computed values - using debounced value to avoid query on every keystroke
  const searchQuery = useMemo(() => debouncedSearchValue.trim(), [debouncedSearchValue]);
  const hasSearchQuery = searchQuery.length > 0;

  // Actions
  const clearSearch = useCallback(() => {
    setSearchValue("");
  }, []);

  // Effect: Initialize search value when it changes from outside (e.g., view switch)
  useEffect(() => {
    setSearchValue(initialSearchQuery);
  }, [initialSearchQuery]);

  // Effect: Reset search when table changes
  useEffect(() => {
    setSearchValue("");
    setIsSearchMenuOpen(false);
  }, [tableId]);

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
