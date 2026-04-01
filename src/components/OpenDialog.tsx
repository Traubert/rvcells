import { useState } from "react";
import type { WorkbookEntry } from "../engine/storage";
import { deleteWorkbook } from "../engine/storage";

interface OpenDialogProps {
  workbooks: WorkbookEntry[];
  currentId: string | null;
  onOpen: (id: string) => void;
  onClose: () => void;
  onRefresh: () => void;
}

function formatDate(epoch: number): string {
  const d = new Date(epoch);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return "Today " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function OpenDialog({ workbooks, currentId, onOpen, onClose, onRefresh }: OpenDialogProps) {
  const filtered = workbooks.filter((wb) => wb.id !== currentId);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  function handleDelete(id: string) {
    deleteWorkbook(id);
    setConfirmId(null);
    onRefresh();
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog open-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Open from browser storage</h2>

        {filtered.length === 0 ? (
          <p className="open-empty">{workbooks.length === 0 ? "No saved workbooks." : "No other saved workbooks."} Use <strong>Save</strong> (Ctrl+S) to save the current workbook.</p>
        ) : (
          <div className="open-list">
            {filtered.map((wb) => (
              <div key={wb.id} className="open-row">
                {confirmId === wb.id ? (
                  <div className="open-confirm-delete">
                    <span>Delete &ldquo;{wb.name}&rdquo;?</span>
                    <button className="dialog-button dialog-button-danger" onClick={() => handleDelete(wb.id)}>Delete</button>
                    <button className="dialog-button" onClick={() => setConfirmId(null)}>Cancel</button>
                  </div>
                ) : (
                  <>
                    <button className="open-name" onClick={() => onOpen(wb.id)}>
                      {wb.name}
                    </button>
                    <span className="open-date">{formatDate(wb.lastModified)}</span>
                    <button
                      className="open-delete"
                      title="Delete"
                      onClick={() => setConfirmId(wb.id)}
                    >
                      ×
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="open-footer">
          <span className="dialog-hint">
            Saved workbooks are stored in your browser. They will be lost if you clear
            site data or cookies. For durable backups, use Export.
          </span>
        </div>

        <div className="dialog-actions">
          <button className="dialog-button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
