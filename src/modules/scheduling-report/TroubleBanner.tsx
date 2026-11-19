import { Banner, Button } from '@/shared/ui';

type TroubleBannerProps = {
  /** What cannot be read, in the view's words. */
  title: string;
  /** The lane's own sentence, under the title; null when it gave none. */
  detail: string | null;
  /** Try again's word. */
  retry: string;
  onRetry: () => void;
};

/**
 * The lane's fault as the view says it: what cannot be read, the lane's own sentence under it, and Try again (44 px under
 * a finger). Warn, not danger: nothing was refused, the server did not answer, and the next read may. The caller wraps it
 * in the `role="alert"` it is announced by.
 *
 * Used by this module's `SchedulingView` (the first read that failed, and the stale strip) and `EntrySheet` (an entry
 * that could not be read).
 */
export function TroubleBanner({ title, detail, retry, onRetry }: TroubleBannerProps) {
  return (
    <Banner
      tone="warn"
      action={<Button variant="tonal" size="sm" className="h-8 flex-none px-2.5 text-xs max-md:h-11" onClick={onRetry}>{retry}</Button>}
    >
      <p className="text-sm font-medium">{title}</p>
      {detail !== null && <p className="mt-0.5 text-xs">{detail}</p>}
    </Banner>
  );
}
