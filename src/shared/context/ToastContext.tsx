import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import type { ToastRecord, ToastRequest } from '@/shared/types';

/** How long a toast stands before its exit begins. */
const AUTO_DISMISS_MS = 3250;
/** How long the exit animation runs — `vv-toast-out .55s` in feedback.css, in milliseconds. */
const LEAVE_MS = 550;
/** The tallest the stack is allowed to get. A fifth toast pushes the oldest out. */
const MAX_TOASTS = 4;

/**
 * Split in two on purpose, the way UiPreferencesContext is: a screen that only RAISES toasts
 * (every screen) must not re-render each time one arrives or leaves. Only ToastStack reads
 * the list.
 */
const ToastListContext = createContext<ToastRecord[] | null>(null);
const ToastPushContext = createContext<((request: ToastRequest) => void) | null>(null);

/** Mounted once by App inside ThemeProvider; ToastStack is its last child. */
export function ToastProvider({ children }: { children: ReactNode }) {
  // The live stack. It cannot be derived from anything the app already holds: a toast is an
  // event that happened, and between the push and the removal this list is the only record of
  // it — which is exactly why nothing durable may depend on it.
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  // Pending dismissal timers by toast id, so unmounting cancels them instead of leaving a
  // setState pointed at a component that is gone.
  const timersRef = useRef(new Map<number, number[]>());
  // The next toast's id. A counter rather than the list length, because ids must stay unique
  // after the oldest has been dropped.
  const nextIdRef = useRef(1);

  const clearTimers = useCallback((id: number) => {
    for (const timer of timersRef.current.get(id) ?? []) window.clearTimeout(timer);
    timersRef.current.delete(id);
  }, []);

  const push = useCallback((request: ToastRequest) => {
    const id = nextIdRef.current;
    nextIdRef.current += 1;

    // The cap drops the oldest here and nothing else: a dropped toast's own two timers are
    // left to fire and clean themselves up, because cancelling them from inside a state
    // updater would put a side effect where React expects a pure one. Both timers below
    // return the SAME array when their id is no longer in the list, so a dropped toast costs
    // nothing on its way out instead of re-rendering the stack twice for a row nobody has.
    setToasts((live) => [...live, { ...request, id, leaving: false }].slice(-MAX_TOASTS));

    timersRef.current.set(id, [
      window.setTimeout(
        () => setToasts((live) => (live.some((toast) => toast.id === id)
          ? live.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast))
          : live)),
        AUTO_DISMISS_MS
      ),
      window.setTimeout(() => {
        clearTimers(id);
        setToasts((live) => {
          const remaining = live.filter((toast) => toast.id !== id);
          return remaining.length === live.length ? live : remaining;
        });
      }, AUTO_DISMISS_MS + LEAVE_MS),
    ]);
  }, [clearTimers]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const pending of timers.values()) for (const timer of pending) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  return (
    <ToastPushContext.Provider value={push}>
      <ToastListContext.Provider value={toasts}>{children}</ToastListContext.Provider>
    </ToastPushContext.Provider>
  );
}

/** Raises a toast. Used by any screen that wants to say what just happened and move on. */
export function useToast(): (request: ToastRequest) => void {
  const push = useContext(ToastPushContext);
  if (!push) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return push;
}

/** The live stack, read by ToastStack alone — every other consumer only pushes. */
export function useToasts(): ToastRecord[] {
  const toasts = useContext(ToastListContext);
  if (!toasts) {
    throw new Error('useToasts must be used within a ToastProvider');
  }
  return toasts;
}
