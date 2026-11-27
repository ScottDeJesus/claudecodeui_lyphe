import type { CerberusCell, CerberusOverview } from '@/shared/cerberus-types';

/** One cell of a strip, in ms. */
const CELL_MS = 60_000;

/**
 * The word a strip draws for a minute the reading does not hold: the word IN FORCE at the reading's now, never the
 * newest cell's, which is the worst word shown over its whole minute (a check that recovered inside it reads failing
 * there). `worst` names the check holding that word when it is one a cell names; null otherwise.
 */
export type QuietWord = { status: CerberusCell['status']; worst: CerberusCell['worst'] };

/**
 * A strip of one-minute cells moved forward to stand at `minute` (the epoch ms that minute began): the cells the
 * reading held that are still inside the window keep their place, and each minute the reading does not hold is
 * drawn with `word`, the word in force when the reading was taken. Every change of a check's word reaches the tab
 * as a frame and a read (a write's hint, or center's flip deadline for a turn made by time alone), so a minute
 * that passed with no frame is a minute in which that word held throughout. The strip keeps its length; one
 * already standing at or past `minute` is answered as it was.
 *
 * Consumers: `rewindowOverview` below and `useCheckDetail` (the live sheet's strip, with the check's own status).
 */
export function rewindowCells(cells: CerberusCell[], minute: number, word: QuietWord): CerberusCell[] {
  const newest = cells[cells.length - 1];
  if (newest === undefined) return cells;
  const end = minute + CELL_MS;
  if (newest.to >= end) return cells;

  const unheldCount = Math.min(cells.length, Math.round((end - newest.to) / CELL_MS));
  const unheld: CerberusCell[] = [];
  for (let from = end - unheldCount * CELL_MS; from < end; from += CELL_MS) {
    // `at` is the minute's own start: a moment inside it, where the word held, so a lookup picked here asks about this minute.
    unheld.push({ from, to: from + CELL_MS, status: word.status, worst: word.worst, at: from });
  }
  return [...cells.slice(unheldCount), ...unheld];
}

/**
 * The overview with every service's strip moved forward to `minute`, or the overview itself when its strips
 * already stand there (every service's strip shares one window), so a minute that moves nothing re-draws nothing.
 *
 * Consumers: `CerberusProvider`, on the overview it hands every reader.
 */
export function rewindowOverview(overview: CerberusOverview, minute: number): CerberusOverview {
  const strip = overview.nodes.flatMap((node) => node.services).find((service) => service.cells.length > 0);
  if (strip === undefined || strip.cells[strip.cells.length - 1].to >= minute + CELL_MS) return overview;
  return {
    ...overview,
    nodes: overview.nodes.map((node) => ({
      ...node,
      services: node.services.map((service) => ({ ...service, cells: rewindowCells(service.cells, minute, serviceWordOf(service, overview.now)) })),
    })),
  };
}

/** The words that leave a cell's `worst` null: nothing worth naming a check for. */
const UNNAMED_WORDS: ReadonlySet<string> = new Set(['ok', 'not_enabled']);

/**
 * How bad each word is, as the server's `SEV` ranks it (`read-model/status-rules.ts`): the fold of a paused
 * service's quiet words below keeps the worst, the first check to reach it naming the cell.
 */
const RANK: Record<CerberusCell['status'], number> = {
  not_enabled: -1, ok: 0, paused: 1, muted: 1, unknown: 2, warn: 3, failing: 4, denied: 5,
};

type ServiceView = CerberusOverview['nodes'][number]['services'][number];
type CheckView = ServiceView['checks'][number];

/**
 * The word a check holds over a minute with nothing in it, the way a cell folds one: its status, except that a
 * restart's pause does not hide a problem. A cell keeps a fresh stored word that needs attention through a pause
 * (muted when a mute covers it), where the check's own status reads paused. Words below warn read paused.
 *
 * Consumers: `serviceWordOf` below and `useCheckDetail` (the live sheet's quiet word), `now` being the reading's.
 */
export function quietWordOf(check: CheckView, now: number): CerberusCell['status'] {
  if (check.status !== 'paused' || check.stored === null || RANK[check.stored] < RANK.warn) return check.status;
  const isFresh = check.at !== null && check.at + check.staleAfter * 1000 >= now;
  if (!isFresh) return check.status;
  return check.mute !== null ? 'muted' : check.stored;
}

/** A service's word as it stands: its status, and the first of its checks holding it when that word names one. */
function serviceWordOf(service: ServiceView, now: number): QuietWord {
  if (service.status === 'paused') return pausedServiceWordOf(service, now);
  if (UNNAMED_WORDS.has(service.status)) return { status: service.status, worst: null };
  const holder = service.checks.find((check) => check.status === service.status);
  return { status: service.status, worst: holder?.key ?? null };
}

/** A paused service's quiet word: the worst of its checks' quiet words, named by the first check to reach it. */
function pausedServiceWordOf(service: ServiceView, now: number): QuietWord {
  let word: QuietWord = { status: 'paused', worst: null };
  for (const check of service.checks) {
    const status = quietWordOf(check, now);
    if (RANK[status] > RANK[word.status]) word = { status, worst: check.key };
    else if (word.worst === null && status === word.status && !UNNAMED_WORDS.has(status)) word = { status, worst: check.key };
  }
  return word;
}
