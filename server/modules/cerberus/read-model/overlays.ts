import type { CerberusMuteRow } from '@/modules/database/index.js';
import type { CerberusMute, CerberusPauseWindow, CerberusStatus } from '@/shared/cerberus-types.js';

import { needsAttention, type WindowWord } from './status-rules.js';

/**
 * What is laid over a status after the rows have said their piece. Three overlays, all worked out
 * when the screen reads and none ever stored:
 *
 *   - A MUTE: an unexpired, unlifted mute in effect at a window's end turns warn, failing and
 *     denied into `muted`. The check keeps running and recording; only the word changes.
 *   - A SILENCE: a node whose warden has not been heard for 90 s is silent, and a current silence
 *     turns every window that ends after `silentSince`, and the current status, into `unknown` —
 *     nothing is known about a node nobody is hearing, and its last words are not repeated as if
 *     they were fresh. A silence that has ended is not remembered: those windows are judged by
 *     staleness alone. The hub is never silent (it passes no `silentSince`).
 *   - A PAUSE: a warden restarting for an update is away by design. A window that overlaps a pause
 *     and whose status is below warn (`ok`, `not_enabled`, `unknown`) reads `paused` — the engine's
 *     `if (SEV[s] < 3 && paused(...)) s = 'paused'` — so a restart never hides a reading that needs
 *     a person. The CURRENT status is stricter, as the engine's `eff` is: while the pause holds,
 *     every check of the node reads `paused`, whatever it was. A node is never silent inside a
 *     pause (`buildNodeOverlay` moves a silence's start out of it), and a pause is cut off after 90 s
 *     (`updates.service.ts`), so a rollback that takes longer is a real silence and reads as one.
 *
 * Silence wins over a mute: the mute only ever quiets a problem, and a silent node has none it can
 * vouch for. A mute and a pause do meet. In a window, a word of warn or worse that a mute covers
 * reads `muted` and a pause only moves the word's moment past the restart; a word below warn that
 * overlaps a pause reads `paused`. The current status and a lookup read `paused` whatever a mute
 * says, because a pause that holds beats everything (`layerCurrent`).
 *
 * Consumers: `cells.ts` (every window), `check-views.ts` (the current status) and `lookup.ts` (the
 * mute that was active at an asked moment, and the pause around it).
 */

/**
 * What is laid over one node's checks besides their mutes: where its silence began (null while it is
 * heard) and the restarts that paused it. Built by `buildNodeOverlay`; the hub's is `NO_OVERLAY`.
 */
export type NodeOverlay = {
  silentSince: number | null;
  pauses: CerberusPauseWindow[];
};

/** The hub is never silent and never restarts for an update: nothing is laid over it. */
export const NO_OVERLAY: NodeOverlay = { silentSince: null, pauses: [] };

/** When the pause holding at `at` began, or `null` when none holds. */
export function pausedSince(pauses: CerberusPauseWindow[], at: number): number | null {
  return pauses.find((pause) => pause.from <= at && at < pause.to)?.from ?? null;
}

/** Whether a pause holds at the single moment `at`: `from <= at < to`. */
export function pausedAt(pauses: CerberusPauseWindow[], at: number): boolean {
  return pausedSince(pauses, at) !== null;
}

/**
 * The first moment of the window `[from, to)` at which a pause holds, or `null` when none overlaps it.
 * A window of no width (a last cell clipped at a minute boundary) is the single moment `from`.
 */
function firstPausedMoment(pauses: CerberusPauseWindow[], from: number, to: number): number | null {
  const end = Math.max(to, from + 1);
  const moments = pauses.filter((pause) => pause.from < end && from < pause.to).map((pause) => Math.max(from, pause.from));
  return moments.length === 0 ? null : Math.min(...moments);
}

/**
 * The overlay of a node whose silence began at `silentSince` and which paused for `pauses`. A silence
 * that begins INSIDE a pause begins when the pause ends instead — the node was not expected to be heard
 * until then — so a node is never silent inside a pause, and one that is still unheard when it ends is
 * silent from that moment.
 *
 * Consumers: `node-links.ts` (every node's overlay).
 */
export function buildNodeOverlay(silentSince: number | null, pauses: CerberusPauseWindow[]): NodeOverlay {
  const insidePause = silentSince === null ? undefined : pauses.find((pause) => pause.from <= silentSince && silentSince < pause.to);
  return { silentSince: insidePause ? insidePause.to : silentSince, pauses };
}

/**
 * The mute in effect at moment `at` among `mutes` — `from_at <= at < until_at` and not lifted by
 * `at` — or `null`. When several overlap, the one that began last (then the lower id), exactly as
 * `cerberusMutesDb.activeAt` answers for one moment, so a strip of many moments can read the mutes
 * it fetched once instead of asking the store per cell.
 *
 * Consumers: `layerWindow` below, which every strip and status goes through, and `check-views.ts`
 * (the mute covering a check now).
 */
export function muteActiveAt(mutes: CerberusMuteRow[], at: number): CerberusMuteRow | null {
  let found: CerberusMuteRow | null = null;
  for (const mute of mutes) {
    const inEffect =
      mute.from_at <= at && at < mute.until_at && (mute.lifted_at === null || mute.lifted_at > at);
    if (!inEffect) continue;
    if (found === null || mute.from_at > found.from_at || (mute.from_at === found.from_at && mute.id < found.id)) {
      found = mute;
    }
  }
  return found;
}

/**
 * The first moment at or after `at` that no pause holds at and, for the `mutes` given, no mute either:
 * past the cover that holds `at`, then past the one that holds there, and so on. Every cover ends after
 * the moment it covers (`muteActiveAt` and the pause test are both strict at the end), so it stops.
 * A mute ends at its `until_at`, or at `lifted_at` when someone lifted it first.
 */
function clearOf(at: number, mutes: CerberusMuteRow[], pauses: CerberusPauseWindow[]): number {
  let moment = at;
  for (;;) {
    const mute = muteActiveAt(mutes, moment);
    const pause = pauses.find((candidate) => candidate.from <= moment && moment < candidate.to);
    if (mute === null && pause === undefined) return moment;
    moment = Math.max(
      mute === null ? moment : Math.min(mute.until_at, mute.lifted_at ?? Number.POSITIVE_INFINITY),
      pause === undefined ? moment : pause.to
    );
  }
}

/**
 * Lays the overlays over a window's word `[from, to)`: `unknown` when the node has been silent since
 * before the window's end, else — for a status that needs a person — `muted` when a mute covers the
 * end, else — for any status below that — `paused` when the window overlaps a pause, else the word
 * unchanged.
 *
 * The moment goes with the word, as the first moment inside the window at which a lookup (`layerCurrent`:
 * a pause beats everything, a mute quiets a problem) answers it. A silence: its start, or the window's
 * first moment when it began before. A pause: its start, the same way. `muted`: the later of the problem's
 * moment and the mute's start, past any restart. A word that needs a person and stays itself: the
 * problem's moment, moved past a mute that covered it and ended inside the window (a mute running out)
 * and past a restart — each at the moment it ends.
 *
 * WHEN ONE EXISTS. These are the moments the overlays alone name, and the rows are not asked again: a
 * reading that recovered or lapsed before a mute began, or before a restart or a mute ended, leaves no
 * moment of the window a lookup answers with the cell's word, and a cover that runs to the window's end
 * leaves only its last moment. `at` is then the nearest moment, kept inside the window.
 *
 * Consumers: `cells.ts` (the cell's window, its end clipped at now) and `layerCurrent` below.
 */
export function layerWindow(
  word: WindowWord,
  window: { from: number; to: number },
  mutes: CerberusMuteRow[],
  overlay: NodeOverlay
): WindowWord {
  const { from, to } = window;
  const last = Math.max(to - 1, from);
  if (overlay.silentSince !== null && to > overlay.silentSince) {
    return { status: 'unknown', at: Math.max(from, overlay.silentSince) };
  }
  if (needsAttention(word.status)) {
    const mute = muteActiveAt(mutes, to);
    return mute === null
      ? { status: word.status, at: Math.min(clearOf(word.at, mutes, overlay.pauses), last) }
      : { status: 'muted', at: Math.min(clearOf(Math.max(word.at, mute.from_at), [], overlay.pauses), last) };
  }
  const paused = firstPausedMoment(overlay.pauses, from, to);
  return paused === null ? word : { status: 'paused', at: paused };
}

/**
 * The overlays for a status AT one moment — now for a check's current status, the asked moment for a
 * lookup. A pause that holds at the moment wins over everything, a failing reading included: the
 * warden is away, so what it last said is not what the check is. Otherwise the window rules, the
 * window being the moment itself.
 *
 * Consumers: `check-views.ts` (the current status) and `lookup.ts` (the asked moment's answer).
 */
export function layerCurrent(
  status: CerberusStatus,
  at: number,
  mutes: CerberusMuteRow[],
  overlay: NodeOverlay
): CerberusStatus {
  if (pausedAt(overlay.pauses, at)) return 'paused';
  return layerWindow({ status, at }, { from: at, to: at }, mutes, overlay).status;
}

/**
 * A `mutes` row as the wire carries it: camelCase, with `check_key` and the lift moment renamed.
 *
 * Consumers: `check-views.ts` (a check's current mute) and `lookup.ts` (the mute that covered an
 * asked moment).
 */
export function toMuteView(row: CerberusMuteRow): CerberusMute {
  return {
    id: row.id,
    node: row.node,
    check: row.check_key,
    from: row.from_at,
    until: row.until_at,
    reason: row.reason,
    by: row.by,
    liftedAt: row.lifted_at,
  };
}
