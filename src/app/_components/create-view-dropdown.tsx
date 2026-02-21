"use client";

import { Inter } from "next/font/google";
import { useEffect, useRef, useState } from "react";

import PeopleIcon from "~/assets/people.svg";
import AssigneeIcon from "~/assets/assignee.svg";
import LockIcon from "~/assets/lock.svg";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500"],
});

type CreateViewDropdownProps = {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
  defaultName: string;
  dropdownPosition: { left: number; top: number };
};

export function CreateViewDropdown({
  isOpen,
  onClose,
  onCreate,
  defaultName,
  dropdownPosition,
}: CreateViewDropdownProps) {
  const [viewName, setViewName] = useState(defaultName);
  const [selectedPermission, setSelectedPermission] = useState<"collaborative" | "personal" | "locked">("collaborative");
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setViewName(defaultName);
      setSelectedPermission("collaborative");
      setTimeout(() => {
        inputRef.current?.select();
      }, 0);
    }
  }, [isOpen, defaultName]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleCreate = () => {
    if (viewName.trim()) {
      onCreate(viewName.trim());
      onClose();
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleCreate();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div
      ref={dropdownRef}
      className={`${inter.className} airtable-dropdown-surface`}
      style={{
        position: "fixed",
        left: dropdownPosition.left,
        top: dropdownPosition.top,
        width: 400,
        height: 234,
        backgroundColor: "white",
        borderRadius: 6,
        zIndex: 1000,
      }}
    >
      {/* View name input */}
      <input
        ref={inputRef}
        type="text"
        value={viewName}
        onChange={(e) => setViewName(e.target.value)}
        onKeyDown={handleKeyDown}
        style={{
          position: "absolute",
          left: 16,
          top: 24,
          width: 368,
          height: 34,
          borderRadius: 6,
          border: "2px solid #BFBFBF",
          padding: "5px 6px",
          fontSize: 17,
          fontWeight: 500,
          color: "#1D1F24",
          outline: "none",
          boxSizing: "border-box",
        }}
        className={inter.className}
      />

      {/* Who can edit label */}
      <div
        style={{
          position: "absolute",
          left: 16,
          top: 93,
          fontSize: 15,
          fontWeight: 500,
          color: "#1D1F24",
        }}
      >
        Who can edit
      </div>

      {/* Radio buttons */}
      <div style={{ position: "absolute", left: 0, top: 118 }}>
        {/* Collaborative */}
        <button
          type="button"
          onClick={() => setSelectedPermission("collaborative")}
          style={{
            position: "absolute",
            left: 16,
            top: 0,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 0,
            textAlign: "left",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <div
            style={{
              position: "relative",
              width: 16,
              height: 16,
              borderRadius: "50%",
              border: "2px solid #E5E5E5",
              backgroundColor: "transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxSizing: "border-box",
              flexShrink: 0,
            }}
          >
            {selectedPermission === "collaborative" && (
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  backgroundColor: "#176EE1",
                }}
              />
            )}
          </div>
          <PeopleIcon
            className="h-[14px] w-[18px]"
            style={{ marginLeft: 3 }}
          />
          <span
            style={{
              fontSize: 13,
              fontWeight: 400,
              color: "#1D1F24",
            }}
          >
            Collaborative
          </span>
        </button>

        {/* Personal */}
        <button
          type="button"
          onClick={() => setSelectedPermission("personal")}
          style={{
            position: "absolute",
            left: 156,
            top: 0,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 0,
            textAlign: "left",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <div
            style={{
              position: "relative",
              width: 16,
              height: 16,
              borderRadius: "50%",
              border: "2px solid #E5E5E5",
              backgroundColor: "transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxSizing: "border-box",
              flexShrink: 0,
            }}
          >
            {selectedPermission === "personal" && (
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  backgroundColor: "#176EE1",
                }}
              />
            )}
          </div>
          <AssigneeIcon
            className="h-[16px] w-[15px]"
            style={{ marginLeft: 4 }}
          />
          <span
            style={{
              fontSize: 13,
              fontWeight: 400,
              color: "#1D1F24",
            }}
          >
            Personal
          </span>
        </button>

        {/* Locked */}
        <button
          type="button"
          onClick={() => setSelectedPermission("locked")}
          style={{
            position: "absolute",
            left: 268,
            top: 0,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 0,
            textAlign: "left",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <div
            style={{
              position: "relative",
              width: 16,
              height: 16,
              borderRadius: "50%",
              border: "2px solid #E5E5E5",
              backgroundColor: "transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxSizing: "border-box",
              flexShrink: 0,
            }}
          >
            {selectedPermission === "locked" && (
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  backgroundColor: "#176EE1",
                }}
              />
            )}
          </div>
          <LockIcon
            className="h-[14.66px] w-[13.68px]"
            style={{ marginLeft: 5 }}
          />
          <span
            style={{
              fontSize: 13,
              fontWeight: 400,
              color: "#1D1F24",
            }}
          >
            Locked
          </span>
        </button>
      </div>

      {/* Help text */}
      <div
        style={{
          position: "absolute",
          left: 16,
          top: 144,
          fontSize: 13,
          fontWeight: 400,
          color: "#55575B",
        }}
      >
        All collaborators can edit the configuration
      </div>

      {/* Cancel button */}
      <button
        type="button"
        onClick={onClose}
        style={{
          position: "absolute",
          left: 181,
          top: 186,
          height: 31,
          fontSize: 13,
          fontWeight: 400,
          color: "#1D1F24",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          padding: "0 12px",
          borderRadius: 6,
          transition: "background-color 0.2s",
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "#F2F2F2";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
        }}
      >
        Cancel
      </button>

      {/* Create new view button */}
      <button
        type="button"
        onClick={handleCreate}
        disabled={!viewName.trim()}
        className="airtable-create-button"
        style={{
          position: "absolute",
          left: 258,
          top: 186,
          width: 126,
          height: 31,
          fontSize: 13,
          fontWeight: 500,
          color: "white",
          backgroundColor: viewName.trim() ? "#176EE1" : "#D9D9D9",
          border: "none",
          cursor: viewName.trim() ? "pointer" : "not-allowed",
          borderRadius: 5,
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-start",
          paddingLeft: 12,
          zIndex: 10,
        }}
      >
        Create new view
      </button>
    </div>
  );
}
