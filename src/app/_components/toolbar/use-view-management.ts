"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import type { Dispatch, SetStateAction, RefObject } from "react";

export interface UseViewManagementReturn {
  // State
  isViewDropdownOpen: boolean;
  isViewButtonHovered: boolean;
  editMode: "rename" | "duplicate" | null;
  editValue: string;
  // Refs
  viewButtonRef: RefObject<HTMLButtonElement | null>;
  viewDropdownRef: RefObject<HTMLDivElement | null>;
  editInputRef: RefObject<HTMLInputElement | null>;
  // Callbacks
  handleViewButtonClick: () => void;
  handleRenameStart: () => void;
  handleDuplicateStart: () => void;
  handleEditSubmit: () => void;
  handleDeleteView: () => void;
  // Setters
  setIsViewDropdownOpen: Dispatch<SetStateAction<boolean>>;
  setIsViewButtonHovered: Dispatch<SetStateAction<boolean>>;
  setEditMode: Dispatch<SetStateAction<"rename" | "duplicate" | null>>;
  setEditValue: Dispatch<SetStateAction<string>>;
}

export interface UseViewManagementParams {
  activeViewId: string | null | undefined;
  allViewNames: string[];
  viewName?: string;
  viewCount?: number;
  onRenameView?: (viewId: string, newName: string) => void;
  onDeleteView?: (viewId: string) => void;
  onDuplicateView?: (viewId: string, name: string) => void;
}

export function useViewManagement({
  activeViewId,
  allViewNames,
  viewName = "Grid view",
  viewCount = 1,
  onRenameView,
  onDeleteView,
  onDuplicateView,
}: UseViewManagementParams): UseViewManagementReturn {
  // State
  const [isViewDropdownOpen, setIsViewDropdownOpen] = useState(false);
  const [isViewButtonHovered, setIsViewButtonHovered] = useState(false);
  // editMode: null | "rename" | "duplicate"
  const [editMode, setEditMode] = useState<"rename" | "duplicate" | null>(null);
  const [editValue, setEditValue] = useState("");

  // Refs
  const viewButtonRef = useRef<HTMLButtonElement>(null);
  const viewDropdownRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Track which view the edit is targeting (so rename after duplicate targets the new view)
  const editTargetViewIdRef = useRef<string | null>(null);
  const editSubmittedRef = useRef(false);
  // Track the initial name when entering edit mode (for duplicate: the default copy name)
  const editInitialNameRef = useRef<string>("");

  const isCustomViewId = activeViewId !== null && activeViewId !== "pending-view";
  const canDelete = viewCount > 1;

  const handleViewButtonClick = useCallback(() => {
    setIsViewDropdownOpen((prev) => !prev);
  }, []);

  const handleRenameStart = useCallback(() => {
    if (activeViewId) {
      editTargetViewIdRef.current = activeViewId;
    }
    editSubmittedRef.current = false;
    editInitialNameRef.current = viewName;
    setEditValue(viewName);
    setEditMode("rename");
    setIsViewDropdownOpen(false);
    setTimeout(() => {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }, 0);
  }, [viewName, activeViewId]);

  const handleDuplicateStart = useCallback(() => {
    // Generate a unique copy name by checking existing view names
    const baseCopyName = `${viewName} copy`;
    let defaultName = baseCopyName;
    if (allViewNames.includes(defaultName)) {
      let copyNum = 2;
      while (allViewNames.includes(`${baseCopyName} ${copyNum}`)) {
        copyNum++;
      }
      defaultName = `${baseCopyName} ${copyNum}`;
    }
    // Create the duplicate immediately
    if (activeViewId) {
      onDuplicateView?.(activeViewId, defaultName);
    }
    // Show rename input so user can change the name
    editTargetViewIdRef.current = null; // will be set once the new view id arrives via activeViewId
    editSubmittedRef.current = false;
    editInitialNameRef.current = defaultName;
    setEditValue(defaultName);
    setEditMode("duplicate");
    setIsViewDropdownOpen(false);
    setTimeout(() => {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }, 0);
  }, [viewName, activeViewId, onDuplicateView, allViewNames]);

  // Track activeViewId changes during edit mode so the rename targets the correct view.
  // For rename: if activeViewId was null when rename started (e.g. first view still loading),
  // capture it once it arrives.
  // For duplicate: capture the new view id once it resolves from "pending-view" to a real UUID.
  useEffect(() => {
    if (editMode === "rename" && activeViewId && activeViewId !== "pending-view" && !editTargetViewIdRef.current) {
      editTargetViewIdRef.current = activeViewId;
    }
    if (editMode === "duplicate" && activeViewId && activeViewId !== "pending-view") {
      editTargetViewIdRef.current = activeViewId;
    }
  }, [editMode, activeViewId]);

  const handleEditSubmit = useCallback(() => {
    // Guard against double submission (blur fires after Enter unmounts input)
    if (editSubmittedRef.current) return;
    editSubmittedRef.current = true;

    // Read directly from the input DOM node to avoid stale closure issues
    const currentValue = editInputRef.current?.value ?? editValue;
    const trimmed = currentValue.trim();
    if (!trimmed) {
      setEditMode(null);
      return;
    }
    if (editMode === "rename") {
      const targetId = editTargetViewIdRef.current;
      // Compare against the initial name stored in the ref (avoids stale closure)
      if (targetId && trimmed !== editInitialNameRef.current) {
        onRenameView?.(targetId, trimmed);
      }
    } else if (editMode === "duplicate") {
      // Duplicate was already created — rename it if user changed the name
      const targetId = editTargetViewIdRef.current;
      if (targetId && trimmed !== editInitialNameRef.current) {
        onRenameView?.(targetId, trimmed);
      }
    }
    setEditMode(null);
  }, [editValue, editMode, onRenameView]);

  const handleDeleteView = useCallback(() => {
    if (activeViewId && canDelete) {
      onDeleteView?.(activeViewId);
    }
    setIsViewDropdownOpen(false);
  }, [activeViewId, canDelete, onDeleteView]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isViewDropdownOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        viewDropdownRef.current &&
        !viewDropdownRef.current.contains(event.target as Node) &&
        viewButtonRef.current &&
        !viewButtonRef.current.contains(event.target as Node)
      ) {
        setIsViewDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isViewDropdownOpen]);

  return {
    isViewDropdownOpen,
    isViewButtonHovered,
    editMode,
    editValue,
    viewButtonRef,
    viewDropdownRef,
    editInputRef,
    handleViewButtonClick,
    handleRenameStart,
    handleDuplicateStart,
    handleEditSubmit,
    handleDeleteView,
    setIsViewDropdownOpen,
    setIsViewButtonHovered,
    setEditMode,
    setEditValue,
  };
}
