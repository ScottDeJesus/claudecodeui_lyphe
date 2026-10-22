//----------------- CARRIER BULLETINS CONTRACTS (CLIENT MIRROR) ------------
// The client's view of the Bulletins tab in Cerberus: every body `/api/carrier-bulletins` answers — each
// carrier's current SERVPRO bulletin file and how far Claude has read it (the overview), one bulletin's
// pages under their parts, and what Claude read on one page and what the house settled it into. The route
// that serves a page's PNG answers bytes, so it has no type here. The surface is read-only: every body
// below is a GET answer, and nothing in this file is a request.
//
// The one home is shadow-connector's `extractors/servpro_bulletins/verify/views.py` (/opt/shadow-connector),
// the read model the report (`scripts/bulletin_readings.py`) and the surface both print, and this file
// follows it key for key: look THERE when a shape here seems wrong, and change it there first. The two
// edit TOGETHER: a key renamed on one side and not the other is a screen that quietly stops reading.
// CloudCLI's lane forwards every body untouched, so there is no third copy.
//
// Keys are snake_case on every body, as views.py writes them (affected-areas' are camelCase; do not
// carry that habit over). Every date and datetime is ISO text, every id is text, and a page number counts
// from 1. A requirement's threshold, window and scope are the shapes of the house check's answer
// (`verify/contract.py`: `Threshold`, `Window`, and the three scope lists of `Requirement`).
//
// A body field is always present: views.py writes a `None` as `null`, and a list with nothing in it as `[]`.
// `null` is the plain absence the field's comment names (no pull on record, never read, no answer on this
// page), never "not yet judged". A part heading is never `null`: `''` is a page that sits in no part.
//
// It imports NOTHING from `server/`: the client tsconfig does not compile server code, and an
// `import type` across that boundary is a bundle that cannot build.

// ---------------------------

//----------------- VOCABULARY ------------

/**
 * Where one page of a carrier's current file stands, as `whole.plan_file` resolves it (the hook, the report
 * and this surface all read that one definition): `settled` is answered AND written into the rules; `read`
 * is answered and not yet settled; `unread` has no answer; `waiting` was tried and failed or was refused,
 * and an automatic reading will not try it again.
 */
export type PageState = 'settled' | 'read' | 'unread' | 'waiting';

/**
 * The five words a reading gives a rule it judged on a page (`verify/contract.py`'s `VerdictWord`):
 * `confirmed` the page states it, `corrected` it states it differently, `duplicate` another rule already
 * carries it, `not_on_page` the page does not state it, `unsettled` the page leaves it open or the
 * house's checks refused the answer. Read by `JudgedRule.verdict` and by `SaidWord`.
 */
export type VerdictWord = 'confirmed' | 'corrected' | 'duplicate' | 'not_on_page' | 'unsettled';

/**
 * What the model said about a rule or a requirement: one of the five `VerdictWord`s, or `(no entry)` where it
 * gave nothing usable for a rule the page asked about (`read.unsettled_entry`: an answer refused whole, a rule
 * the model left out, a rule that cites no page). Read by `JudgedRule.said` and `PageFailure.said`: a screen
 * that keys a label on it must handle the sixth value.
 */
export type SaidWord = VerdictWord | '(no entry)';

// ---------------------------

//----------------- THE OVERVIEW: ONE CARRIER'S CURRENT FILE ------------

/** A carrier's latest pull of its bulletin. `outcome` is the pull's own word with its error after a colon when it failed (`unchanged`, `new_bulletin`, `failed: …`). */
export type LastPull = {
  at: string;
  outcome: string;
};

/**
 * The newest check run of a carrier: when it ended, how it ended (`ok`, `dry_run`, `failed`), and what it
 * cost. A run that died before it counted leaves `model`, `calls` and the tokens `null`.
 */
export type LastReading = {
  at: string;
  status: string;
  model: string | null;
  calls: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
};

/**
 * One row of GET /overview: a carrier and its current file. `settled`, `read`, `unread` and `waiting`
 * split `pages` by `PageState`; `answered` counts, beside them, the pages whose answer was read on an
 * earlier file of the carrier (the page's content did not change). `requirements_live` is the carrier's
 * live list rules that cite this bulletin, `questions_open` its open questions, and `not_placed` the duties
 * its pages state that the rule vocabulary has no key for.
 */
export type OverviewRow = {
  carrier: string;
  bulletin_id: string;
  /** `null` when the bulletin prints none. */
  bulletin_number: string | null;
  /** The exact file's SHA-256: the key of its stored PDF and of `GET /files/{sha}/pages/{page}/image`. */
  file_sha256: string;
  stored_at: string;
  pages: number;
  settled: number;
  answered: number;
  read: number;
  unread: number;
  waiting: number;
  /** `null`: no pull of this carrier is on record. */
  last_pull: LastPull | null;
  /** `null`: the carrier has never been read. */
  last_reading: LastReading | null;
  requirements_live: number;
  questions_open: number;
  not_placed: number;
};

// ---------------------------

//----------------- A BULLETIN'S PAGES ------------

/** How many rules the reading judged each way on one page. */
export type VerdictCounts = {
  confirmed: number;
  corrected: number;
  duplicate: number;
  not_on_page: number;
  unsettled: number;
};

/**
 * One row of GET /bulletins/{bulletin_id}/pages, in page order. `part` is the heading of the part the page
 * sits in ("Exhibit 1: Reconstruction Guidelines"), or `"<the part before> | <the part beginning here>"` on
 * the page where a part begins after page 1. `read_at` is when the page's answer was read, `null` for an
 * `unread` or `waiting` page; `read_from` is the stored date of the earlier file that answer was read on,
 * `null` when it was read on this one. `requirements` is a count: the page's own list is on `PageReading`.
 */
export type BulletinPage = {
  page: number;
  part: string;
  state: PageState;
  read_at: string | null;
  read_from: string | null;
  requirements: number;
  verdicts: VerdictCounts;
};

// ---------------------------

//----------------- ONE PAGE: WHAT CLAUDE READ AND WHAT THE HOUSE SETTLED ------------

/**
 * The answer a page holds: when it was read, by which model, at what cost, and where it came from.
 * `read_from` is as on `BulletinPage`. The tokens are `null` when the door did not report them.
 */
export type ReadingStamp = {
  at: string;
  model: string;
  calls: number;
  input_tokens: number | null;
  output_tokens: number | null;
  read_from: string | null;
};

/** A requirement's number: `value` in `unit` (`DAY`, `HR`, `SF`, `USD`, …), counted as `measure` (`line`, `room`, `run_days`, …). */
export type RequirementThreshold = {
  value: number;
  unit: string;
  measure: string;
};

/**
 * A requirement's deadline: `hours` counted on `basis` (`calendar`, `business`, …) from `anchor`, the event it
 * starts at. `hours` is `null` only for a deadline that counts none ("by the end of the next business day");
 * `anchor` is `null` when the page gives no start.
 */
export type RequirementWindow = {
  hours: number | null;
  basis: string;
  anchor: string | null;
};

/** The jobs a requirement applies to. A list that is `null` means every one of its kind. */
export type RequirementScope = {
  services: string[] | null;
  loss_types: string[] | null;
  property_types: string[] | null;
};

/**
 * The rule a requirement settled into. `state` is the list rule's standing as views.py words it; `question`
 * is the one open question the rule carries, in words, or `null` when none is open.
 */
export type SettledRule = {
  id: string;
  state: string;
  question: string | null;
};

/**
 * One requirement the page states. `words` is the requirement on one line, `kind` and `subject` its name in
 * the rule vocabulary, `quote` the page's own words. `rule` is `null` for a page that is `read` and not yet
 * `settled`: the requirement has no list rule to point at.
 */
export type PageRequirement = {
  words: string;
  kind: string;
  subject: string;
  threshold: RequirementThreshold | null;
  window: RequirementWindow | null;
  scope: RequirementScope;
  quote: string | null;
  rule: SettledRule | null;
};

/**
 * A rule the house held before this reading, judged on this page. `words` is the rule in words,
 * `from_revision` the bulletin revision it came from. `said` is what the model gave and `verdict` the
 * word the house stored: they differ when the house's checks refused the answer (stored `unsettled`).
 * `quote` is the page's words, `reason` the model's why, `duplicate_of_words` the rule a `duplicate` points at.
 */
export type JudgedRule = {
  words: string;
  from_revision: string | null;
  verdict: VerdictWord;
  said: SaidWord;
  reason: string | null;
  quote: string | null;
  duplicate_of_words: string | null;
};

/** A duty the page states that the rule vocabulary has no key for: it never runs, and is shown here. `quote` is the page's words, `doubt` what it asks. */
export type NotPlaced = {
  quote: string;
  doubt: string;
};

/**
 * An entry of the reading the house's checks refused: `words` is the rule it judged, `null` for a
 * requirement the model added; `said` and `quote` as on `JudgedRule`; `failures` are the checks it failed, in
 * words.
 */
export type PageFailure = {
  words: string | null;
  said: SaidWord;
  quote: string | null;
  failures: string[];
};

/**
 * Why a page waits: `status` is how its try ended (`failed`: the reader gave no usable answer; `refused`: the
 * house's checks refused the answer it gave), `reason` is why in words, `at` is when. A refusal that is not
 * the page's (the usage limit, a dead login) is no try and leaves no waiting page.
 */
export type PageWaiting = {
  status: 'failed' | 'refused';
  reason: string | null;
  at: string;
};

/**
 * The body of GET /bulletins/{bulletin_id}/pages/{page}. `file_sha256` names the exact file the page is of
 * (its PNG is `GET /files/{file_sha256}/pages/{page}/image`). `reading` is `null` on a page with no answer
 * (`unread` or `waiting`); `waiting` is `null` on every page that is not waiting. A page Claude read and
 * found nothing on has a `reading` and empty lists, which is not a missing reading.
 */
export type PageReading = {
  page: number;
  part: string;
  file_sha256: string;
  reading: ReadingStamp | null;
  requirements: PageRequirement[];
  judged: JudgedRule[];
  not_placed: NotPlaced[];
  failures: PageFailure[];
  waiting: PageWaiting | null;
};
