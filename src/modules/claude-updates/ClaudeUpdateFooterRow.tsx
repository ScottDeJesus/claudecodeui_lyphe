import { Download } from 'lucide-react';

import { useClaudeUpdateLine } from '@/modules/claude-updates/hooks/useClaudeUpdateLine';

/**
 * The sidebar's own line for Claude: an offer when there is one, and the job that is taking it when
 * one is running. It lives in the list's foot, so it returns the moment a collapsed list shows again; the
 * rail draws no mark for it (the wheel of places marks Settings while an offer stands, off the same line).
 *
 * ABSENT IS THE DEFAULT. A package whose update this pipeline cannot install here is not an offer,
 * and a process with nothing on disk to move has nothing to announce; in either case the row
 * renders nothing at all rather than a row that opens a tab with nothing in it to press.
 *
 * WHILE A JOB RUNS the row says so — "Updating Claude…" with the step under it — because a sidebar
 * row that still says "Update available" while the update is happening is a row that invites a
 * second press.
 */

/** The sidebar footer's row, above the app's own update row. Renders nothing when there is no offer. */
export function ClaudeUpdateFooterRow({ onOpen }: { onOpen: () => void }) {
  const line = useClaudeUpdateLine();
  if (line === null) return null;

  return (
    <>
      <div className="nav-divider" />

      {/* Desktop */}
      <div className="hidden px-2 py-1.5 md:block">
        <button
          className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-primary/10"
          onClick={onOpen}
        >
          <div className="relative flex-shrink-0">
            <Download className="h-4 w-4 text-primary" />
            <span aria-hidden className="vv-pulse absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="block truncate text-sm font-normal text-accent-ink">{line.title}</span>
            <span className="text-[10px] text-muted-foreground">{line.detail}</span>
          </div>
        </button>
      </div>

      {/* Mobile */}
      <div className="px-3 py-2 md:hidden">
        <button
          className="flex h-11 w-full items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-3.5 transition-all active:scale-[0.98]"
          onClick={onOpen}
        >
          <div className="relative flex-shrink-0">
            <Download className="h-4 w-4 text-primary" />
            <span aria-hidden className="vv-pulse absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
          </div>
          <div className="min-w-0 flex-1 text-left">
            <span className="block truncate text-sm font-normal text-accent-ink">{line.title}</span>
            <span className="text-xs text-muted-foreground">{line.detail}</span>
          </div>
        </button>
      </div>
    </>
  );
}
