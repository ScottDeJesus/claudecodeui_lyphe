import type { MemoryCandidateLean } from '@/shared/types';
import { Card } from '@/shared/ui';

/**
 * When a filed memory landed, in the reader's own locale — the review's day, or the day it was
 * proposed when Descent recorded no review at all. `null` rather than "Invalid Date" for a stamp
 * this app cannot parse: a broken line is worse than a shorter one.
 */
function filedDate(candidate: MemoryCandidateLean): string | null {
  const stamp = candidate.reviewedAt ?? candidate.createdAt;
  if (!stamp) return null;
  const parsed = new Date(stamp);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleDateString();
}

/**
 * One memory that has already been filed: what it is, and where and when it landed.
 *
 * IT IS A READING AND NOT A DECISION. An approved memory has no verbs left — nothing to file,
 * nothing to discard, no body worth fetching — so this row is a `Card` and two lines and nothing
 * else. The name reads whole (it wraps rather than clips, `break-words`) because it is the only
 * thing a person scans for.
 *
 * NO PIN PROP: the "this chat proposed it" mark is drawn by `MemoryWidgetBody` ABOVE this row,
 * because the same marker sits above a pending row too and one composition in the body beats two
 * in its rows. `MemoryWidgetBody` is its only caller.
 */
export function MemoryApprovedRow({ candidate }: { candidate: MemoryCandidateLean }) {
  const date = filedDate(candidate);
  // Whichever of the two facts the row has, joined by the separator the rest of the app uses —
  // and no line at all when it has neither, rather than a stray separator.
  const meta = [candidate.project, date].filter((part): part is string => Boolean(part)).join(' · ');

  return (
    <Card>
      <div className="flex min-w-0 flex-col gap-0.5 px-4 py-3">
        <p className="break-words text-sm font-medium">{candidate.name}</p>
        {meta && <p className="text-xs text-muted-foreground">{meta}</p>}
      </div>
    </Card>
  );
}
