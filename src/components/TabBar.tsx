import { useState, useRef, useEffect, useCallback } from "react";

interface TabBarProps {
  sheets: { name: string }[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onRename: (index: number, name: string) => void;
  onClose: (index: number) => void;
  onAdd: () => void;
}

export function TabBar({ sheets, activeIndex, onSelect, onRename, onClose, onAdd }: TabBarProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingIndex !== null) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editingIndex]);

  const commitRename = useCallback(() => {
    if (editingIndex !== null) {
      const trimmed = editValue.trim();
      if (trimmed && trimmed !== sheets[editingIndex].name) {
        const duplicate = sheets.some((s, i) => i !== editingIndex && s.name === trimmed);
        if (duplicate) {
          // Don't rename — revert to original
        } else {
          onRename(editingIndex, trimmed);
        }
      }
      setEditingIndex(null);
    }
  }, [editingIndex, editValue, sheets, onRename]);

  return (
    <div className="tab-bar">
      {sheets.map((sheet, i) => (
        <div
          key={i}
          className={`tab ${i === activeIndex ? "tab-active" : ""}`}
          onClick={() => { if (editingIndex === null) onSelect(i); }}
        >
          {editingIndex === i ? (
            <input
              ref={inputRef}
              className="tab-name-input"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setEditingIndex(null);
              }}
              onClick={(e) => e.stopPropagation()}
              spellCheck={false}
            />
          ) : (
            <span
              className="tab-name"
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditingIndex(i);
                setEditValue(sheet.name);
              }}
            >
              {sheet.name}
            </span>
          )}
          {sheets.length > 1 && (
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onClose(i);
              }}
              title="Close sheet"
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button className="tab-add" onClick={onAdd} title="Add sheet">
        +
      </button>
    </div>
  );
}
