import fs from 'node:fs';
import path from 'node:path';

import type { ArcCardPhase, ArcCardSnapshot, ArcCardState, ArcSnapshot } from '@/shared/types.js';
import { isHiddenProjectPath } from '@/shared/hidden-project-paths.js';
import { readRunnerModelChoice } from '@/shared/utils.js';

/**
 * What the runner's arc directories MEAN: one snapshot per arc, read off
 * `~/.claude/state/arcs/<name>/arc.json`. Nothing here touches a socket, a request or the runner — given
 * the bytes on disk and a clock it answers with snapshots, which is what lets a fixture arc directory
 * prove the whole reading with no runner process in existence.
 *
 * TWO fields are deliberately NOT computed here: `current` and `last_started` belong to the runner, which
 * decides the order under the arc's own lock (`hooks/plan_runner/arcs.py`); a recomputation would drift.
 */

/** The six words `hooks/plan_runner/arcs.py:CARD_STATES` writes, and the only ones this lane accepts. */
const CARD_STATES: readonly ArcCardState[] = ['unminted', 'queued', 'walking', 'paused', 'complete', 'stalled'];

/** The four `hooks/plan_runner/arcs.py:ARC_STATUSES` writes. */
const ARC_STATUSES = ['walking', 'stalled', 'not-started', 'complete'] as const;

type ArcStatus = ArcSnapshot['status'];

/** The deck's order: what is moving, then what needs a hand, then what has not begun, then what is finished. */
const STATUS_RANK: Record<ArcStatus, number> = { walking: 0, stalled: 1, 'not-started': 2, complete: 3 };

/** A string, or the fallback. Free text from the runner reaches the DOM as a text node, never as markup. */
function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** A finite number, or `null` — for the fields where "not set" is a real answer (`started_at`, `current`). */
function readNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A finite number, or the fallback. `typeof` alone admits `NaN`, which renders as "NaN" all the way to the DOM. */
function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A record's field, without asserting the record is one. */
function field(record: unknown, name: string): unknown {
  return record !== null && typeof record === 'object' ? (record as Record<string, unknown>)[name] : undefined;
}

/**
 * How a directory that could not be read is reported. Optional, and silent when nobody hands one down — but a
 * caller that CAN say must, because an arc missing from the deck with nothing written anywhere is
 * indistinguishable from an arc that ended. `runner-state.service.ts` takes the same door for a run.
 */
type ArcErrorDoor = (dir: string, message: string) => void;

/** A word outside the runner's four is one this lane does not understand, and `not-started` claims the least. */
function readStatus(value: unknown): ArcStatus {
  const status = readString(value) as ArcStatus;
  return ARC_STATUSES.includes(status) ? status : 'not-started';
}

/**
 * A card's phase list, off `arc.json:cards[].phases`. Anything but an array reads `[]` — a record written
 * before the runner carried phases draws "not written yet" rather than failing — and an entry without a
 * string `id` is dropped, since a phase with no id cannot be told from its neighbours.
 */
function readPhases(value: unknown): ArcCardPhase[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((raw) => typeof field(raw, 'id') === 'string')
    .map((raw) => ({ id: readString(field(raw, 'id')), title: readString(field(raw, 'title')), shipped: field(raw, 'shipped') === true, blocked: field(raw, 'blocked') === true }));
}

/**
 * One card, off `arc.json:cards[]`. `position` falls back to the card's place in the array and `state` to
 * `unminted`, so a card the reader cannot place is drawn where it was written rather than dropped.
 */
function readCard(raw: unknown, index: number): ArcCardSnapshot {
  const state = readString(field(raw, 'state')) as ArcCardState;
  return {
    position: readNumber(field(raw, 'position'), index + 1),
    plan_path: readString(field(raw, 'plan')),
    title: readString(field(raw, 'title')),
    charter: readString(field(raw, 'charter')),
    run_id: readString(field(raw, 'run_id')) || null,
    state: CARD_STATES.includes(state) ? state : 'unminted',
    run_status: readString(field(raw, 'run_status')) || null,
    ended_at: readNumberOrNull(field(raw, 'ended_at')),
    cost_usd: readNumber(field(raw, 'cost_usd'), 0),
    spawns: readNumber(field(raw, 'spawns'), 0),
    phases: readPhases(field(raw, 'phases')),
  };
}

/**
 * One arc directory, or `null` when it says nothing honest. A file that is unreadable or is not JSON is
 * skipped rather than thrown: the runner replaces `arc.json` whole through `os.replace`, so this lane can
 * catch a directory mid-swap, and one arc must never cost the others their frame — but the skip is not
 * silent: it goes through `onArcError` when the caller handed one down. `endedKeepS` is the run list's own
 * finished-run window, so a finished arc leaves the deck on a finished run's schedule.
 */
function readArc(arcDir: string, nowS: number, endedKeepS: number, onArcError?: ArcErrorDoor): ArcSnapshot | null {
  let record: unknown;
  try {
    record = JSON.parse(fs.readFileSync(path.join(arcDir, 'arc.json'), 'utf8'));
  } catch (error) {
    // Caught mid-replace is a normal event on a live state dir; one that STAYS unreadable is not, and this is
    // the only place anything can learn of it. A missing arc and a corrupt one must not draw the same deck.
    onArcError?.(arcDir, error instanceof Error ? error.message : String(error));
    return null;
  }
  if (record === null || typeof record !== 'object') {
    onArcError?.(arcDir, 'arc.json is not a JSON object');
    return null;
  }

  const arcPath = readString(field(record, 'arc_path'));
  const status = readStatus(field(record, 'status'));
  const endedAt = readNumberOrNull(field(record, 'ended_at'));
  if (status === 'complete' && endedAt !== null && nowS - endedAt >= endedKeepS) return null;

  const cards = field(record, 'cards');
  return {
    // The directory name is the fallback: the runner mints the directory FROM the name.
    arc: readString(field(record, 'arc')) || path.basename(arcDir),
    arc_path: arcPath,
    title: readString(field(record, 'title')),
    test_arc: isHiddenProjectPath(arcPath),
    status,
    started_at: readNumberOrNull(field(record, 'started_at')),
    ended_at: endedAt,
    synced_at: readNumber(field(record, 'synced_at'), 0),
    has_receipt: fs.existsSync(path.join(arcDir, 'receipt.json')),
    now: field(record, 'now') === true,
    start_at: readNumberOrNull(field(record, 'start_at')),   // `plan-runner arc schedule`; absent reads `null`
    model: readRunnerModelChoice(field(record, 'model')),
    current: readNumberOrNull(field(record, 'current')),
    last_started: readNumber(field(record, 'last_started'), 0),
    cards: Array.isArray(cards) ? cards.map(readCard) : [],
  };
}

/** Every arc directory under the root. A missing root is the ordinary state before the first arc exists. */
function listArcDirs(arcsDir: string): string[] {
  try {
    return fs
      .readdirSync(arcsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(arcsDir, entry.name))
      .sort();
  } catch {
    return [];
  }
}

/** The deck's order (see `STATUS_RANK`), newest `started_at` first inside each status. */
function byStatusThenNewest(left: ArcSnapshot, right: ArcSnapshot): number {
  const rank = STATUS_RANK[left.status] - STATUS_RANK[right.status];
  if (rank !== 0) return rank;
  return (right.started_at ?? 0) - (left.started_at ?? 0);
}

/**
 * Every arc on this host, as the deck draws it — the arc lane's snapshot, taken on every tick. `nowS` is
 * epoch SECONDS, the runner's clock and not `Date.now()`: a millisecond clock would drop every finished arc
 * the moment its receipt landed. A plain read, no cache and no `fs.watch`. `onArcError` is optional — a bare
 * call is silent — and the arc lane hands down the composition root's door (`arc-lane.ts`).
 */
export function snapshotArcs(
  arcsDir: string,
  nowS: number,
  endedKeepS: number,
  onArcError?: ArcErrorDoor,
): ArcSnapshot[] {
  const arcs: ArcSnapshot[] = [];
  for (const arcDir of listArcDirs(arcsDir)) {
    try {
      const snapshot = readArc(arcDir, nowS, endedKeepS, onArcError);
      if (snapshot !== null) arcs.push(snapshot);
    } catch (error) {
      // A record that would not parse was reported inside `readArc`; this is a directory that moved between
      // the listing and the read.
      onArcError?.(arcDir, error instanceof Error ? error.message : String(error));
    }
  }
  return arcs.sort(byStatusThenNewest);
}
