import { useEffect } from 'react';

import { useFocusTrap } from '../utils/useFocusTrap.js';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  pending?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  pending = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps): JSX.Element {
  const containerRef = useFocusTrap<HTMLDivElement>();

  // Close dialog on Escape
  useEffect(() => {
    function handleEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !pending) {
        onCancel();
      }
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onCancel, pending]);

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
      <div className="modal-card" ref={containerRef}>
        <h3 id="confirm-dialog-title">{title}</h3>
        <p>{message}</p>
        <div className="button-row">
          <button type="button" className="secondary-button" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={tone === 'danger' ? 'danger-button' : undefined}
            onClick={() => void onConfirm()}
            disabled={pending}
          >
            {pending ? 'Please wait...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
