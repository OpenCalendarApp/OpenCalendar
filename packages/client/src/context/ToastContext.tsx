import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle, Info, X } from 'lucide-react';

type ToastTone = 'info' | 'success' | 'error';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  showToast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: number): void => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((message: string, tone: ToastTone = 'info'): void => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { id, message, tone }]);

    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 3800);
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      showToast
    }),
    [showToast]
  );

  const errorToasts = toasts.filter((t) => t.tone === 'error');
  const nonErrorToasts = toasts.filter((t) => t.tone !== 'error');

  function renderToast(toast: ToastItem): JSX.Element {
    return (
      <div key={toast.id} className={`toast toast-${toast.tone}`}>
        <span className="toast-content">
          {toast.tone === 'success' ? <CheckCircle size={16} aria-hidden="true" /> : null}
          {toast.tone === 'error' ? <AlertCircle size={16} aria-hidden="true" /> : null}
          {toast.tone === 'info' ? <Info size={16} aria-hidden="true" /> : null}
          {toast.message}
        </span>
        <button
          type="button"
          className="toast-close"
          aria-label="Dismiss notification"
          onClick={() => dismissToast(toast.id)}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Error toasts use role="alert" (assertive) so screen readers announce them immediately */}
      <div
        className="toast-stack toast-stack-errors"
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
      >
        {errorToasts.map(renderToast)}
      </div>
      {/* Success / info toasts use aria-live="polite" to avoid interrupting the user */}
      <div
        className="toast-stack toast-stack-info"
        aria-live="polite"
        aria-atomic="true"
      >
        {nonErrorToasts.map(renderToast)}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used inside ToastProvider');
  }

  return context;
}
