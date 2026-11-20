// ---------------------------
//----------------- BUG HUNTERS: the proposed features (`dispatcher bug proposals --json`, served by `GET /api/kanban-dispatch/proposals`) and the dashboard's `hunts` part (`dispatcher hunt status --json`). Mirrored KEY FOR KEY, in the dispatcher's own snake_case, by the client in `src/shared/types.ts`; the house's `hooks/dispatcher/shapes.py` (`PROPOSAL_KEYS`) and `hunt_report.py` are the source. ------------
// ---------------------------
import type { KanbanPriority } from '@/shared/kanban-types.js';

/** Why a proposal is not a ticket: too big for one, or the design is wrong. */
export const BUG_PROPOSAL_KINDS = ['too-big', 'design'] as const;
/** Where a proposal stands: open, promoted to a feature, sent back as a ticket, or dismissed. */
export const BUG_PROPOSAL_STATES = ['open', 'promoted', 'sent-back', 'dismissed'] as const;
/** How the next turn is taken: by project, by hunter, or nightly. */
export const HUNT_TURN_RULES = ['project', 'hunter', 'nightly'] as const;
/** Whether a hunting night is still open or closed. */
export const HUNT_NIGHT_STATES = ['open', 'closed'] as const;
/** The word a hunter counts its units in: files or tables. */
export const HUNT_UNIT_WORDS = ['files', 'tables'] as const;
/** Where a hunter stands on a project: not started, hunting, done, could not be mapped, nothing of its kind, or no database named. */
export const HUNT_PROJECT_STATES = ['not started', 'hunting', 'done', 'could not be mapped', 'nothing of its kind', 'no database named'] as const;

/** One finding on a proposal (`bug proposals --json`, `findings[]`): the file or `<database>.<table>` it names (`null` when it names none), what was found there, and when (ISO-8601 UTC). Drawn in an opened `ProposalRow`. */
export type BugProposalFinding = { unit: string | null; words: string; found_at: string };
/** A stopgap ticket filed for a proposal (`stopgaps[]`): the smallest thing that stops the harm while the rework waits. `state` is the ticket's own word (`filed`, `placed`, `unplaced`, `fixed`, `cleared`, `closed`); `board` and `card` are `null` until a board has taken it, and only then is it a press. `ticket` is a key, never shown (INV-76). */
export type BugProposalStopgap = { ticket: number; title: string; state: string; board: string | null; card: string | null };
/** One proposed feature as `bug proposals --json` prints it; `feature`'s `title` and `state` are `null` once the promoted feature has been removed from the roadmap. */
export type BugProposalRecord = {
  id: number;
  path: string;
  title: string;
  words: string;
  kind: (typeof BUG_PROPOSAL_KINDS)[number];
  priority: KanbanPriority;
  state: (typeof BUG_PROPOSAL_STATES)[number];
  hunt: string | null;
  source: string;
  proposed_at: string;
  ended_at: string | null;
  feature: { name: string; title: string | null; state: string | null } | null;
  reason: string | null;
  findings: BugProposalFinding[];
  stopgaps: BugProposalStopgap[];
  sent_back: { ticket: number; board: string | null; card: string | null } | null;
};
/** The route's answer (`GET /api/kanban-dispatch/proposals`): the record plus the name of the board whose folders hold its `path` (`''` when no board does). */
export type BugProposal = BugProposalRecord & { boardName: string };
/** The newest night of hunting (`dispatcher hunt status --json`, `night`): the local date it opened on, whether it is still `open`, how many working minutes its sittings have used, and the dispatcher's own words for why it closed (`time spent`, `nothing left to hunt`, `stopped by the operator`, …), `null` while open. */
export type HuntNight = { night: string; state: (typeof HUNT_NIGHT_STATES)[number]; opened_at: string; minutes_used: number; why: string | null };
/** One hunter's standing on one project (`hunts[].projects[]`), every figure computed at the read: `total`, `covered`, `skipped` and `open` (not reached) are of the newest pass and counted in `unit_word`; `nights_left` is `null` before the pass's first sitting; `cause` is the fault's sentence when the project `could not be mapped`; `last` is its newest sitting, and `last.outcome` is `null` while that sitting is still out. `project` is the folder, `name` what a person calls it. */
export type HuntProjectStanding = {
  project: string;
  name: string;
  unit_word: (typeof HUNT_UNIT_WORDS)[number];
  state: (typeof HUNT_PROJECT_STATES)[number];
  pass: number | null;
  total: number;
  covered: number;
  skipped: number;
  open: number;
  tickets: number;
  proposals: number;
  nights_left: number | null;
  cause: string | null;
  last: { night: string; minutes: number; outcome: string | null; covered: number } | null;
};
/** One hunter (`hunts[]`): its kind (`security`, `behaviour`, `ui`, `data`, `code`), the soul and model that wear it, whether it takes a turn (`runs`: it is in the config's `order`), and its standing on each project. */
export type HuntHunter = { hunt: string; soul: string; model: string; runs: boolean; projects: HuntProjectStanding[] };
/** One unit a hunter could not hunt (`skipped[]`, the newest 200): the file or table, whose hunt and which project (its folder), the hunter's reason, and when it was marked. `project` is the project's FOLDER here, and `POST /api/kanban-dispatch/hunts/reopen` takes the project's NAME in the config (`hunt reopen HUNT PROJECT UNIT` refuses a folder): `Hunt it again` maps the folder to its name through `hunts[].projects[]` (`project` → `name`) and sends `{ hunt, project: <that name>, unit }`. */
export type HuntSkippedUnit = { hunt: string; project: string; unit: string; reason: string; marked_at: string };
/** One sitting (`sittings[]`, the newest 20): the night, the hunter and its soul, the project (its folder), the working minutes, how it ended (`pass done`, `wound down`, `tickets filed`, `waiting`, `stopped`, `failed`; `null` while it is out) with the cause of a failure, and what it marked and filed, counted by the sitting. */
export type HuntSittingRow = { night: string; hunt: string; soul: string; project: string; minutes: number; outcome: string | null; cause: string | null; covered: number; skipped: number; tickets: number; proposals: number };
/** `dispatcher hunt status --json`, whole: the dashboard answer's `hunts` part, drawn by `DashboardHunters`. The nightly switch and its start (the box's local `HH:MM`), the newest night, the sitting out now (`deadline` ISO-8601 UTC), the turn that would be taken next, every hunter, the skipped units and the last sittings. */
export type HuntStatus = {
  nightly: boolean;
  start: string;
  minutes: number;
  order: string[];
  turns: (typeof HUNT_TURN_RULES)[number];
  night: HuntNight | null;
  sitting: { hunt: string; soul: string; project: string; started_at: string; deadline: string } | null;
  next: { hunt: string; project: string; rehunt: boolean } | null;
  hunts: HuntHunter[];
  skipped: HuntSkippedUnit[];
  sittings: HuntSittingRow[];
};
