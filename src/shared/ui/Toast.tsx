import type { ToastRecord } from '@/shared/types';
import { cn } from '@/shared/utils';

type ToastProps = Pick<ToastRecord, 'tone' | 'title' | 'message' | 'leaving'>;

/**
 * One toast. Used by ToastStack alone — a toast is raised through `useToast()`, never mounted
 * by hand, because the stack is what caps it at four and what times its exit.
 *
 * There is no dismiss control, and that is a choice rather than an omission: the toast leaves
 * on its own after 3250 ms, and §4 gives the component no `onDismiss` site to point at. A
 * caller who needs the reader to ACT on something is looking for a Banner, which stays.
 *
 * `leaving` is a prop rather than internal state because the stack owns the clock — the row
 * must still be rendered while its exit animation runs, and only the provider knows when the
 * 550 ms is up and the record can go.
 */
export function Toast({ tone, title, message, leaving }: ToastProps) {
  return (
    // No role of its own: the live region is the stack root, which is always in the document.
    // A second `role="status"` nested inside it would double-announce (see ToastStack).
    <div className={cn('vv-toast flex items-start', leaving && 'vv-toast--leaving')} data-tone={tone}>
      <span className="vv-toast__dot flex-none" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="vv-toast__title">{title}</div>
        {message && <div className="vv-toast__message">{message}</div>}
      </div>
    </div>
  );
}
