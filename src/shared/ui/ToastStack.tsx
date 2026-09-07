import { useToasts } from '@/shared/context/ToastContext';
import { Toast } from '@/shared/ui/Toast';

/**
 * The one place toasts are drawn. Mounted once by App as ToastProvider's last child, so the
 * stack sits above every screen and no feature module has to remember to render it.
 *
 * The root is always in the document, empty or not: `[data-verve-toast-stack]` is how the
 * verification harness — and anyone debugging — asks whether the app has a toast surface at
 * all, and a marker that appears only once a toast exists cannot answer that.
 *
 * That permanence is also why the live region is HERE and not on the toast. Assistive tech
 * subscribes to live regions that already exist and routinely says nothing about a region born
 * with its content in it — so a `role="status"` on each row, which enters the DOM at the same
 * instant as its text, announces nothing. This root is the one element always present, which
 * makes it the only element that can be the region. `aria-atomic="false"` so a second toast
 * announces itself rather than re-reading the whole stack.
 */
export function ToastStack() {
  const toasts = useToasts();

  return (
    <div
      className="vv-toast-stack flex flex-col items-end"
      data-verve-toast-stack=""
      role="status"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((toast) => (
        <Toast key={toast.id} tone={toast.tone} title={toast.title} message={toast.message} leaving={toast.leaving} />
      ))}
    </div>
  );
}
