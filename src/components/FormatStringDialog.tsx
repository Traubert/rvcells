import { useState } from "react";
import { hasPlaceholder } from "../format";

interface FormatStringDialogProps {
  initial: string;
  onApply: (formatString: string | null) => void; // null clears the format string
  onClose: () => void;
}

export function FormatStringDialog({ initial, onApply, onClose }: FormatStringDialogProps) {
  const [value, setValue] = useState(initial);
  const valid = value.trim() === "" || hasPlaceholder(value);

  function apply() {
    if (!valid) return;
    onApply(value.trim() === "" ? null : value);
    onClose();
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog format-string-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Format string</h2>
        <input
          className="format-string-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply();
            else if (e.key === "Escape") onClose();
            e.stopPropagation();
          }}
          placeholder="e.g. {.2} €"
          autoFocus
        />
        {!valid && <p className="format-string-invalid">Needs a placeholder — see below.</p>}
        <p className="dialog-hint">
          Text with one placeholder for the value: <code>{"{}"}</code> plain number,{" "}
          <code>{"{%}"}</code> ×100 with a % sign, <code>{"{.2}"}</code> fixed decimals when
          they survive rounding (currency). Examples: <code>{"{.2} €"}</code>,{" "}
          <code>{"{%}"}</code>, <code>{"~{} kg"}</code>. Leave empty to remove.
        </p>
        <div className="dialog-actions">
          <button className="dialog-button" onClick={onClose}>Cancel</button>
          <button className="dialog-button dialog-button-primary" onClick={apply} disabled={!valid}>Apply</button>
        </div>
      </div>
    </div>
  );
}
