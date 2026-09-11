/**
 * Prose blocks: the GitHub alert marker that opens a blockquote, and the review verdict line that
 * is a whole paragraph. Re-exported by `shapes/detect.ts` — import it from there.
 */

export type AlertKind = 'note' | 'tip' | 'important' | 'warning' | 'caution';

// GitHub's alert syntax. The line must be the marker and NOTHING else: `[!NOTE] see below` is a
// sentence the author wrote, and swallowing it into a banner title would drop "see below".
const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/i;

export function parseAlertKind(firstLine: string): AlertKind | null {
  const match = ALERT_RE.exec(firstLine.trim());
  return match ? (match[1].toLowerCase() as AlertKind) : null;
}

const VERDICT_RE = /^VERDICT:\s+(PASS|FAIL)(?:\s+[—–-]\s+B:(\d+)\s+H:(\d+)\s+M:(\d+)\s+L:(\d+))?$/;

/** A review verdict line, with or without its B/H/M/L counts. The whole paragraph must be it. */
export function parseVerdict(
  text: string
): { verdict: 'PASS' | 'FAIL'; counts: { b: number; h: number; m: number; l: number } | null } | null {
  const match = VERDICT_RE.exec(text.trim());
  if (!match) return null;
  const [, verdict, blocking, high, medium, low] = match;
  return {
    verdict: verdict as 'PASS' | 'FAIL',
    counts:
      blocking === undefined
        ? null
        : { b: Number(blocking), h: Number(high), m: Number(medium), l: Number(low) },
  };
}
