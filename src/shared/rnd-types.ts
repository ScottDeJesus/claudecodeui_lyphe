/**
 * THE R&D PICTURE: what the dispatcher prints for "rnd show --json", as the server hands it on at GET /api/rnd and in every
 * rnd_state frame. The client reads it and never writes it: each change is one dispatcher verb, and the next picture says
 * what it did.
 *
 * A CANDIDATE'S WORD IS DERIVED AT EVERY READ, the first that holds: adopted (it became a plan), rejected, spiking (a spike
 * started and no verdict was stamped after it), proved (its verdict is yes), else waiting. Nothing stores it, so the place
 * never works one out for itself.
 *
 * Read by the rnd place (src/modules/rnd).
 */

/** Where a candidate stands. */
export type RndWord = 'waiting' | 'spiking' | 'proved' | 'adopted' | 'rejected';

/** What a spike answered. A no rejects the candidate in the same act; unsettled sends it back to waiting with its evidence. */
export type RndVerdictWord = 'yes' | 'no' | 'unsettled';

/** A page the scout reads. */
export type RndSource = { url: string; label: string | null; added_at: string };

/** How often the scout goes out by itself. */
export type RndFrequency = 'off' | 'daily' | 'weekly' | 'monthly';
export type RndWeekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
/** The scout's schedule: a day only where one applies (1-28 for monthly), the time on the box's clock, and the crontab line's expression derived from it (null when off). */
export type RndSchedule =
  | { frequency: 'off'; day: null; time: string; cron: null }
  | { frequency: 'daily'; day: null; time: string; cron: string }
  | { frequency: 'weekly'; day: RndWeekday; time: string; cron: string }
  | { frequency: 'monthly'; day: number; time: string; cron: string };
/** A change to the schedule from the settings sheet: any of its three words; the rest stay as stored. */
export type RndScheduleChange = { frequency?: RndFrequency; day?: RndWeekday | number; time?: string };

export type RndSettings = {
  web_search: boolean;
  /** Whether a run's source scouts go out one after another (the default) or all together. */
  scouts_run: RndScoutsRun;
  /** How often the scout goes out by itself. */
  schedule: RndSchedule;
  sources: RndSource[];
};

/** How a run's source scouts go out: one after another (the default), or all together. */
export type RndScoutsRun = 'one_at_a_time' | 'all_at_once';

/** One source's scout in a run: waiting its turn, out, or ended with its outcome. */
export type RndSourceScout = {
  id: number;
  source: string;
  state: 'waiting' | 'out' | 'ended';
  outcome: 'done' | 'failed' | 'lost' | null;
  launch: string | null;
  started_at: string | null;
  ended_at: string | null;
  /** The finds it recorded, and the pages it put on the read record. */
  suggested: number;
  read: number;
};

/** A run's ranker: waiting for its scouts, out, ended with the run's outcome, or skipped when no suggestion arrived. */
export type RndRanker = {
  state: 'waiting' | 'out' | 'ended' | 'skipped';
  launch: string | null;
  outcome: 'done' | 'failed' | 'lost' | null;
  suggestions: number;
  filed: number;
  declined: number;
};

/** A scout run that is out now: one scout per source, then its ranker. */
export type RndScoutOut = {
  id: number;
  launch: string | null;
  trigger: 'weekly' | 'now';
  started_at: string;
  scouts: RndSourceScout[];
  ranker: RndRanker;
};

/** The last scout that ended, with how many candidates it filed. */
export type RndScoutLast = RndScoutOut & {
  ended_at: string | null;
  outcome: 'done' | 'failed' | 'lost' | null;
  filed: number;
};

export type RndStanding = Record<RndWord, number>;

export type RndCandidate = {
  name: string;
  /** What it is, in one line. */
  title: string;
  what: string;
  why: string;
  /** The yes-or-no question a spike would answer. */
  question: string;
  /** The page it was found on. */
  source_url: string;
  /** The configured source it was read from, or null when filed by hand. */
  source: string | null;
  word: RndWord;
  filed_at: string;
  filed_by: string | null;
  /** The scout that filed it, or null when filed by hand. */
  scout: number | null;
  /** session: the spike's own chat (made by the R&D place). launched_from: the chat a spike with no chat of its own was
   * launched from (/spike typed in a chat), with its name, null when the app holds no such chat. */
  spike: { session: string | null; launched_from: string | null; launched_from_name: string | null; started_at: string } | null;
  verdict: { word: RndVerdictWord; evidence: string | null; dir: string | null; at: string } | null;
  rejected: { why: string; at: string; by: string | null } | null;
  /** The feature it became, the epic it stands under, that feature's own word on the roadmap, and Opus's one line of why
   * it stands there (null when adopted at the terminal with an epic named), and its measure. */
  adopted: {
    plan: string;
    epic: string;
    at: string;
    word: string;
    why: string | null;
    /** What its design says it is measured by, and what the spike promised; null until a measure is named. */
    measure: { says: string; promised: string } | null;
  } | null;
  /** A proved candidate's Adopt: out while Opus places it, or the last one that failed and why; null otherwise. */
  placing: { state: 'out' | 'failed'; at: string | null; why: string | null } | null;
};

export type RndPicture = {
  generated_at: string;
  settings: RndSettings;
  scout: { out: RndScoutOut | null; last: RndScoutLast | null };
  standing: RndStanding;
  /** Newest first. */
  candidates: RndCandidate[];
};
