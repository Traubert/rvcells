import { useState } from "react";

interface SettingsDialogProps {
  numSamples: number;
  onSave: (settings: { numSamples: number }) => void;
  onClose: () => void;
}

export function SettingsDialog({ numSamples, onSave, onClose }: SettingsDialogProps) {
  const [samples, setSamples] = useState(String(numSamples));

  function handleSave() {
    const n = parseInt(samples, 10);
    if (isNaN(n) || n < 100 || n > 1_000_000) {
      alert("Sample count must be between 100 and 1,000,000");
      return;
    }
    onSave({ numSamples: n });
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <div className="dialog-field">
          <label htmlFor="num-samples">Sample count</label>
          <input
            id="num-samples"
            type="number"
            value={samples}
            onChange={(e) => setSamples(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
            min={100}
            max={1_000_000}
            step={1000}
          />
          <span className="dialog-hint">
            More samples = more accurate distributions, slower recalculation.
            Default is 10,000.
          </span>
        </div>

        <div className="dialog-actions">
          <button className="dialog-button" onClick={onClose}>Cancel</button>
          <button className="dialog-button dialog-button-primary" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
