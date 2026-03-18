"use client";

import { useState, useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";

// Custom debounce hook for inputs.
// Returns [debouncedValue, setImmediate] - call setImmediate(val) to bypass debounce.
export function useDebounced<T>(value: T, delay: number): [T, Dispatch<SetStateAction<T>>] {
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
