/**
 * Prose blocks: the GitHub alert marker that opens a blockquote, the review verdict line that is a
 * whole paragraph, and the lead-in line that titles the list or table written under it. Re-exported
 * by `shapes/detect.ts` — import it from there.
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

/**
 * The longest line that may become a card's title, in characters. Past it the line is a sentence —
 * an introduction that happens to end in a colon is still an introduction, and drawing it as a
 * header would take a paragraph of prose and shrink it to the frame's own label size.
 */
export const LEAD_IN_MAX_CHARS = 120;

/**
 * Does this line title the list or table written beneath it?
 *
 * Used by `remarkShapeGroups`'s lead-in pass — the only place with siblings to look at — through the
 * barrel at `shapes/detect.ts`. It takes the line's whole text and whether the line is WHOLLY bold;
 * the pass computes the second from the parsed children, which this module cannot see.
 *
 * All three clauses REJECT: a shape that fires on prose takes the author's words and lays them out
 * as something they never wrote. A soft line break is a wrapped sentence rather than a label, so a
 * line carrying one is refused outright; a line past the cap is an introduction; and an unbolded
 * line only titles what follows when it ends in a colon, which is the one mark markdown has for
 * "the thing below belongs to this".
 */
export function isLeadInText(text: string, wholeBold: boolean): boolean {
  if (text.includes('\n')) return false;
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > LEAD_IN_MAX_CHARS) return false;
  return trimmed.endsWith(':') || wholeBold;
}
