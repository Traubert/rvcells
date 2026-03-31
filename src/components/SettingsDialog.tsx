import { useState } from "react";
import { MIN_NUM_SAMPLES, MAX_NUM_SAMPLES } from "../constants";

interface SettingsDialogProps {
  numSamples: number;
  onSave: (settings: { numSamples: number }) => void;
  onClose: () => void;
}

export function SettingsDialog({ numSamples, onSave, onClose }: SettingsDialogProps) {
  const [samples, setSamples] = useState(String(numSamples));
  const [hint, setHint] = useState<string | null>(null);

  function showHint(msg: string) {
    setHint(msg);
    setTimeout(() => setHint(null), 3000);
  }

  function handleSave() {
    const n = parseInt(samples, 10);
    if (isNaN(n) || String(n) !== samples.trim()) {
      setSamples(String(numSamples));
      showHint("Not a valid integer — reverted.");
      return;
    }
    if (n < MIN_NUM_SAMPLES) {
      setSamples(String(MIN_NUM_SAMPLES));
      showHint(`Clamped to minimum (${MIN_NUM_SAMPLES.toLocaleString()}).`);
      return;
    }
    if (n > MAX_NUM_SAMPLES) {
      setSamples(String(MAX_NUM_SAMPLES));
      showHint(`Clamped to maximum (${MAX_NUM_SAMPLES.toLocaleString()}).`);
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
            min={MIN_NUM_SAMPLES}
            max={MAX_NUM_SAMPLES}
            step={1000}
          />
          {hint && <span className="dialog-hint dialog-hint-warn">{hint}</span>}
        </div>

        <div className="dialog-actions">
          <button className="dialog-button" onClick={onClose}>Cancel</button>
          <button className="dialog-button dialog-button-primary" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
