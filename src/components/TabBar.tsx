import { useState, useRef, useEffect, useCallback } from "react";

interface TabBarProps {
  sheets: { name: string }[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onRename: (index: number, name: string) => void;
  onClose: (index: number) => void;
  onAdd: () => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

export function TabBar({ sheets, activeIndex, onSelect, onRename, onClose, onAdd, onReorder }: TabBarProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dragIndexRef = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

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

  // Scroll wheel cycles through tabs (wrapping)
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const n = sheets.length;
    if (n <= 1) return;
    const dir = e.deltaY > 0 ? 1 : -1;
    onSelect((activeIndex + dir + n) % n);
  }, [sheets.length, activeIndex, onSelect]);

  return (
    <div className="tab-bar" onWheel={handleWheel}>
      {sheets.map((sheet, i) => (
        <div
          key={i}
          className={`tab ${i === activeIndex ? "tab-active" : ""}${dragOver === i && dragIndexRef.current !== i ? " tab-drag-over" : ""}`}
          onClick={() => { if (editingIndex === null) onSelect(i); }}
          draggable={editingIndex === null}
          onDragStart={(e) => {
            dragIndexRef.current = i;
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDragOver(i);
          }}
          onDragLeave={() => setDragOver((prev) => prev === i ? null : prev)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(null);
            const from = dragIndexRef.current;
            if (from !== null && from !== i) {
              onReorder(from, i);
            }
            dragIndexRef.current = null;
          }}
          onDragEnd={() => {
            dragIndexRef.current = null;
            setDragOver(null);
          }}
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
              draggable={false}
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
              draggable={false}
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
