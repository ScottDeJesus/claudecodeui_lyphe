import { useMemo, useState } from 'react';

import { useHeal } from '@/modules/heal';

/**
 * A line that changes when the app's heals change: their ids, their statuses and when each ended. The heal context already
 * reads the worker once a minute for the Inbox, so a heal that lands, starts or is blocked shows up here without this view
 * asking the ledger anything on a clock. Two reads that found the same heals give the same line, so a minute's read that
 * changed nothing makes the Uploads view read nothing.
 *
 * A POLL THAT FAILED IS NOT A CHANGE. The heal context drops its summary when a poll fails (a badge must not outlive its
 * reading), so the summary goes null and comes back; the line holds the last one it knew through both, and the ledger is
 * read again only when the heals themselves differ. The line is empty until the first read answers.
 *
 * Used by this module's `useUploadsRead` and `useRunSheet`, as the `trigger` of their heal reads.
 */
export function useHealSignature(): string {
  const { summary } = useHeal();
  const latest = useMemo(
    () => (summary === null ? null : summary.heals.map((heal) => `${heal.id}:${heal.status}:${heal.ended_at ?? ''}`).join(' ')),
    [summary],
  );
  // The last line the heal context's reading gave. Essential and not derivable: a failed poll gives none, and the line must outlive it.
  const [known, setKnown] = useState(latest ?? '');
  // Adjusted during render, React's own pattern for state that follows a value: a render React draws is never one behind it.
  if (latest !== null && latest !== known) setKnown(latest);
  return known;
}
