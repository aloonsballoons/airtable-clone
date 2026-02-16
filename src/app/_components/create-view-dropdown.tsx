"use client";

import { Inter } from "next/font/google";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import peopleIcon from "~/assets/people.svg";
import assigneeIcon from "~/assets/assignee.svg";
import lockIcon from "~/assets/lock.svg";

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
      className={inter.className}
      style={{
        position: "absolute",
        left: dropdownPosition.left,
        top: dropdownPosition.top,
        width: 400,
        height: 234,
        backgroundColor: "white",
        borderRadius: 6,
        boxShadow: "0 3px 6px rgba(0, 0, 0, 0.1), 0 10px 20px rgba(0, 0, 0, 0.15)",
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
              width: 8,
              height: 8,
              borderRadius: "50%",
              border: "2px solid #BFBFBF",
              backgroundColor: selectedPermission === "collaborative" ? "#176EE1" : "transparent",
            }}
          />
          <Image
            src={peopleIcon}
            alt=""
            width={18}
            height={14}
            style={{ marginLeft: 11 }}
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
              width: 8,
              height: 8,
              borderRadius: "50%",
              border: "2px solid #BFBFBF",
              backgroundColor: selectedPermission === "personal" ? "#176EE1" : "transparent",
            }}
          />
          <Image
            src={assigneeIcon}
            alt=""
            width={15}
            height={16}
            style={{ marginLeft: 12 }}
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
              width: 8,
              height: 8,
              borderRadius: "50%",
              border: "2px solid #BFBFBF",
              backgroundColor: selectedPermission === "locked" ? "#176EE1" : "transparent",
            }}
          />
          <Image
            src={lockIcon}
            alt=""
            width={13.68}
            height={14.66}
            style={{ marginLeft: 13 }}
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
          left: 271,
          top: 193,
          fontSize: 13,
          fontWeight: 400,
          color: "#1D1F24",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          padding: "4px 12px",
          borderRadius: 6,
          transition: "background-color 0.2s",
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
        style={{
          position: "absolute",
          left: 270,
          top: 193,
          fontSize: 13,
          fontWeight: 500,
          color: "white",
          backgroundColor: viewName.trim() ? "#09890E" : "#D9D9D9",
          border: "none",
          cursor: viewName.trim() ? "pointer" : "not-allowed",
          padding: "6px 14px",
          borderRadius: 6,
          boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
          marginLeft: 66,
        }}
      >
        Create new view
      </button>
    </div>
  );
}
