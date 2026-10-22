import { CircleCheck, CircleDashed, CircleDot, CircleHelp, CircleSlash, Copy, OctagonAlert, PencilLine, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { BulletinPage, OverviewRow, PageReading, PageState, VerdictWord } from '@/shared/carrier-bulletins-types';
import type { Tone } from '@/shared/types';

/*
 * THE BULLETINS VIEW'S PURE MODEL: what the screens read off the wire before they draw it — where a carrier's current
 * file stands and which group lists it, how a page state or a verdict is drawn, and a bulletin's pages under the parts
 * its outline found. Nothing here fetches, holds state or draws; the sentences are `bulletinWords.ts`.
 *
 * A state that speaks in colour also carries its glyph and its word (MAN-578): the tone reaches paint as `data-tone`
 * alone (MAN-739 rule 4), and the glyph is what a reader without the colour reads. Act is `warn`, as the Cerberus tab's
 * own failing checks are; `danger` is kept for denied, which nothing here is.
 */

/** How a state is drawn: its tone, which lands as `data-tone`, and the glyph that says it without colour. */
export type BulletinLook = { tone: Tone; icon: LucideIcon };

/**
 * Where a carrier's current file stands, by need: `waiting`, a page Claude tried and has no answer for, which holds the
 * carrier's settlement until it is read again; `stopped`, its last reading ended before the file settled; `partly`,
 * some of it read, or all of it read and not yet written into the rules; `unread`, nothing on it read yet; `settled`,
 * every page answered and written into the rules.
 */
export type CarrierStanding = 'waiting' | 'stopped' | 'partly' | 'unread' | 'settled';

/** The overview's three groups, in the order it lists them: what needs the operator first, what is calm last. */
export type CarrierGroup = 'needs' | 'notSettled' | 'settled';

/** A carrier's standing read off its overview row. A settled file stays settled whatever a later run met (a usage limit is no try). */
export function carrierStanding(row: OverviewRow): CarrierStanding {
  if (row.waiting > 0) return 'waiting';
  if (row.pages > 0 && row.settled === row.pages) return 'settled';
  if (row.last_reading?.status === 'failed') return 'stopped';
  return row.settled + row.read === 0 ? 'unread' : 'partly';
}

/** How each standing is drawn, and the group it is listed under. Both that need the operator are `warn`, the tab's tone for act. */
export const STANDING_LOOK: Record<CarrierStanding, BulletinLook & { group: CarrierGroup }> = {
  waiting: { tone: 'warn', icon: TriangleAlert, group: 'needs' },
  stopped: { tone: 'warn', icon: OctagonAlert, group: 'needs' },
  partly: { tone: 'info', icon: CircleDot, group: 'notSettled' },
  unread: { tone: 'neutral', icon: CircleDashed, group: 'notSettled' },
  settled: { tone: 'positive', icon: CircleCheck, group: 'settled' },
};

/** The standings in need order: a waiting page before a stopped reading, a file part read before one never read. */
const STANDING_ORDER: readonly CarrierStanding[] = ['waiting', 'stopped', 'partly', 'unread', 'settled'];

/** The groups in the order the overview lists them. */
const GROUP_ORDER: readonly CarrierGroup[] = ['needs', 'notSettled', 'settled'];

/**
 * The overview's carriers under their groups: each group in need order, then by name, and a group with no carrier left
 * out, so a quiet day opens on "Settled" alone. The caller's array is never touched.
 */
export function carrierGroups(rows: OverviewRow[]): { group: CarrierGroup; rows: OverviewRow[] }[] {
  const rank = (row: OverviewRow) => STANDING_ORDER.indexOf(carrierStanding(row));
  const sorted = [...rows].sort((a, b) => rank(a) - rank(b) || a.carrier.localeCompare(b.carrier));
  return GROUP_ORDER
    .map((group) => ({ group, rows: sorted.filter((row) => STANDING_LOOK[carrierStanding(row)].group === group) }))
    .filter((entry) => entry.rows.length > 0);
}

/** How each page state is drawn: waiting in the tone for act, a page read and not yet settled in progress's, settled calm. */
export const PAGE_STATE_LOOK: Record<PageState, BulletinLook> = {
  waiting: { tone: 'warn', icon: TriangleAlert },
  unread: { tone: 'neutral', icon: CircleDashed },
  read: { tone: 'info', icon: CircleDot },
  settled: { tone: 'positive', icon: CircleCheck },
};

/**
 * How each verdict is drawn: `unsettled` (the page leaves it open, or the house refused the answer) in the tone for act,
 * `corrected` in info's, the two that take a rule out of play neutral, and `confirmed` calm.
 */
export const VERDICT_LOOK: Record<VerdictWord, BulletinLook> = {
  unsettled: { tone: 'warn', icon: CircleHelp },
  corrected: { tone: 'info', icon: PencilLine },
  not_on_page: { tone: 'neutral', icon: CircleSlash },
  duplicate: { tone: 'neutral', icon: Copy },
  confirmed: { tone: 'positive', icon: CircleCheck },
};

/** The verdicts in need order, which is how a page's judged rules are listed and how a page row counts them. */
export const VERDICT_ORDER: readonly VerdictWord[] = ['unsettled', 'corrected', 'not_on_page', 'duplicate', 'confirmed'];

/** What joins the two halves of a page's `part` on the page where a part begins after page 1 (`whole.plan_file`). */
const PART_JOIN = ' | ';

/** A page's part as the view shows it: the part the page sits in, and the part that ends on it, null on every other page. */
export type PagePart = { heading: string; closes: string | null };

/**
 * Splits a page's wire `part`. On the page where a part begins after page 1 it reads "<the part before> | <the part
 * beginning here>", and `before` (the heading the page before resolved to) makes the split exact even when a heading
 * holds the joiner itself. `before` is null for the first page, which never carries the part before; undefined when the
 * pages before are not known, which splits at the first joiner.
 */
export function splitPart(part: string, before: string | null | undefined): PagePart {
  if (before === null || part === before) return { heading: part, closes: null };
  if (before !== undefined && part.startsWith(`${before}${PART_JOIN}`)) {
    return { heading: part.slice(before.length + PART_JOIN.length), closes: before };
  }
  const at = part.indexOf(PART_JOIN);
  return at < 0 ? { heading: part, closes: null } : { heading: part.slice(at + PART_JOIN.length), closes: part.slice(0, at) };
}

/** One part of a bulletin as its pages list it: the heading the bulletin prints ('' for pages in no part) and its pages, in order. */
export type PartGroup = { heading: string; pages: BulletinPage[] };

/**
 * A bulletin's pages under their parts, in page order: the main program, then each exhibit. The page where a part
 * begins opens the new part. A file with no outline (one page, or an outline that could not be read) is one group whose
 * heading is ''.
 */
export function partGroups(pages: BulletinPage[]): PartGroup[] {
  const groups: PartGroup[] = [];
  for (const page of pages) {
    const last = groups.length > 0 ? groups[groups.length - 1] : undefined;
    const { heading } = splitPart(page.part, last === undefined ? null : last.heading);
    if (last !== undefined && last.heading === heading) last.pages.push(page);
    else groups.push({ heading, pages: [page] });
  }
  return groups;
}

/**
 * The part one page sits in and the part that ends on it, resolved against the bulletin's pages as `partGroups` resolves
 * them; from the page's own `part` alone while the pages are not read.
 */
export function partOfPage(pages: BulletinPage[] | null, page: number, part: string): PagePart {
  if (pages === null) return splitPart(part, page > 1 ? undefined : null);
  let before: string | null = null;
  for (const entry of pages) {
    if (entry.page === page) return splitPart(part, before);
    before = splitPart(entry.part, before).heading;
  }
  return splitPart(part, undefined);
}

/**
 * A page's state on its own screen: the pages list's word once it is read; before that, what the reading can say alone —
 * waiting, or not read — and null for an answered page, since whether it settled is the list's to say.
 */
export function pageStateOf(summary: BulletinPage | null, reading: PageReading | null): PageState | null {
  if (summary !== null) return summary.state;
  if (reading === null) return null;
  if (reading.waiting !== null) return 'waiting';
  return reading.reading === null ? 'unread' : null;
}

/** The pages before and after one page in the bulletin's list, for Previous and Next; null at either end or while the list is not read. */
export function neighbours(pages: BulletinPage[] | null, page: number): { previous: number | null; next: number | null } {
  const index = pages === null ? -1 : pages.findIndex((entry) => entry.page === page);
  if (pages === null || index < 0) return { previous: null, next: null };
  return { previous: index > 0 ? pages[index - 1].page : null, next: index < pages.length - 1 ? pages[index + 1].page : null };
}
