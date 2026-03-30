interface ConfirmDialogProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <p style={{ marginBottom: 16, lineHeight: 1.5 }}>{message}</p>
        <div className="dialog-actions">
          <button className="dialog-button" onClick={onCancel}>Cancel</button>
          <button className="dialog-button dialog-button-primary" onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
}
