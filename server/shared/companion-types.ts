//----------------- COMPANION CONTRACTS ------------
// The shapes Kaylee, the voice companion, puts on a wire: her settings, the picture of her that a page
// reads in one request, every frame the gateway socket carries to a page as she works, and the log,
// draft, walkthrough and note a page draws. One home, so every plan of the arc adds here and none
// redefines.
//
// It is a SIBLING of `server/shared/types.ts` rather than an addition to it, for the reason
// `cerberus-types.ts` is one: that file is far past the house ceiling of 300 lines for a module.
//
// Three readings the whole contract stands on:
//   - every time is an ISO-8601 string (`at`, `updatedAt`), the way the store keeps it;
//   - JSON is camelCase on every wire, and SQL is snake_case (`turnId` here, `turn_id` in the store);
//   - the browser half is `src/shared/companion-types.ts`: the same types, field for field. The two
//     files are edited together, always — a field renamed on one side and not the other is a panel
//     that quietly stops reading.
//
// Nothing here is server-only: the whole contract reaches the browser, so the server file has no
// section the client file lacks. Later plans of the arc add types and frame kinds HERE and redefine
// nothing.

/**
 * The four Claude models Kaylee can run on, by the alias the CLI takes. Chosen from the panel's
 * picker (`CompanionPicture.models` lists them with their labels) and stored as
 * `CompanionSettings.model`; a change is applied live to her running process without losing her
 * conversation.
 */
export type CompanionModel = 'sonnet' | 'fable' | 'opus' | 'haiku';

/**
 * The key or mouse button that presses Kaylee's talk button, bound in Settings > Voice > Companion and
 * caught while CloudCLI has focus (the main window, or the floating chat's picture-in-picture window).
 * Stored as `CompanionSettings.talkBinding`, so it reaches every page of the account.
 *
 * A `key` binding names the physical key by `KeyboardEvent.code` (`F8`, `Space`, `KeyK`; 1-40
 * characters of letters and digits) and the four modifiers that must be held with it, exactly. It is
 * accepted when `code` is a function key (`F1`-`F24`) or when `ctrl`, `alt` or `meta` is held: a
 * plain typing key would fire on every word he types. A `mouse` binding names the button by
 * `MouseEvent.button`: `1` middle, `3` back or `4` forward (the left button is every click, the
 * right one is the context menu). `label` is what Settings shows (`F8`, `Ctrl+Space`, `Mouse back`),
 * 1-40 characters with no line break; it is written once, when the binding is made, by the page's
 * `talkBindingFromEvent`, and the server stores the label it is sent, trimmed.
 */
export type TalkBinding =
  | { kind: 'key'; code: string; ctrl: boolean; alt: boolean; shift: boolean; meta: boolean; label: string }
  | { kind: 'mouse'; button: 1 | 3 | 4; label: string };

/**
 * Everything the operator can set about Kaylee, held as the account's `companion` preference. The
 * server applies the defaults on read, so a page always receives every field. `name` fills the
 * register's `{name}` and is 1-40 characters with no line break (default `Kaylee`); `operatorName`
 * fills the system prompt's `{operator_name}` once at launch and is 1-40 characters; `register` is
 * the register template, carrying the slots `{name}`, `{delivery_note}` and `{sound_tags}`, 200-16000
 * characters (it rides inside `<register>` with every message and is never part of the system
 * prompt); `deliveryNote` is a few words that fill `{delivery_note}`, 0-120 characters with no line
 * break; `model` defaults to `sonnet`; `live` defaults to `false` and, while true, lets house alerts
 * reach her; `talkBinding` is the key or mouse button that presses her talk button (default `null`: none
 * bound). Read by `GET /api/companion`, written by `PUT /api/companion/settings` (a partial
 * body; `register: null` restores the default template and `talkBinding: null` unbinds the talk button)
 * and announced to every page by `companion_settings`.
 */
export type CompanionSettings = {
  name: string;
  operatorName: string;
  register: string;
  deliveryNote: string;
  model: CompanionModel;
  live: boolean;
  talkBinding: TalkBinding | null;
};

/**
 * A chat of the operator's, named the way she names it. `sessionId` is CloudCLI's own id for the
 * chat, `name` the title the operator knows it by and `project` the display name of its project.
 * Carried by the focus, a draft or walkthrough target and an activity, and written into the
 * envelopes she reads (`<state>`, `<view>`).
 */
export type CompanionSessionRef = { sessionId: string; name: string; project: string };

/**
 * What Kaylee is doing right now, as one word. `idle` is nothing in flight; `thinking` is a turn
 * with no tool running; `reading_session` is a read of a chat's transcript; `reading_code` is a
 * dactyl reading files; `drafting` is a write to the draft; `walking` is a walkthrough in progress.
 * Carried by `CompanionActivity.phase` and drawn as the panel's status line.
 */
export type CompanionPhase = 'idle' | 'thinking' | 'reading_session' | 'reading_code' | 'drafting' | 'walking';

/**
 * The status line's facts: the `phase` and what it concerns. `session` is the chat a read or draft is
 * about, `files` the file names a code read has open and `walk` the walkthrough's place; each is
 * `null` when the phase has no such subject. Held in the picture, announced by `companion_activity`
 * on every change, and `idle` when a turn ends.
 */
export type CompanionActivity = {
  phase: CompanionPhase;
  session: CompanionSessionRef | null;
  files: string[] | null;
  walk: { at: number; total: number } | null;
};

/**
 * Where a draft is addressed: an existing chat (`kind: 'session'`) or a chat not yet started in a
 * project (`kind: 'new'`, `projectPath` the project's path on disk and `projectName` the name shown
 * on the card). Exactly one target per draft; a draft for a new chat is what `create_session`
 * sends.
 */
export type CompanionDraftTarget =
  | { kind: 'session'; session: CompanionSessionRef }
  | { kind: 'new'; projectPath: string; projectName: string };

/**
 * The one running brief she keeps for a chat: where it goes, its words and when it last changed
 * (`updatedAt`, ISO). She writes it with `update_draft`, the operator may edit `text` on the draft
 * card, and nothing is sent to a chat that does not match it. One per account; `null` in the
 * picture when none is held. Announced by `companion_draft`.
 */
export type CompanionDraft = { target: CompanionDraftTarget; text: string; updatedAt: string };

/**
 * The walkthrough of a long result: the chat it concerns, the short item titles and the place
 * reached. `at` is 1-based; `0` means the walk is set up and not begun. `updatedAt` is ISO. One per
 * account; `null` in the picture when none is held, and ended by `walk` with `at: 0`. Announced by
 * `companion_walk`.
 */
export type CompanionWalk = { session: CompanionSessionRef; items: string[]; at: number; updatedAt: string };

/**
 * One sound she made, `tag` the allow-list word (`giggle`, `short pause`, lower case) and `at` its
 * offset into the entry's `text` — the displayed text, which has no tag in it — counted in UTF-16
 * code units, the unit `text.length` and `text.slice` use, so the panel cuts the text at `at` with
 * `slice` and draws a small mark between the halves. `0 <= at <= text.length`, and never inside a
 * surrogate pair.
 */
export type CompanionSound = { tag: string; at: number };

/**
 * One line of the conversation log. `role` is who said it: the `operator`, `kaylee`, an `alert`
 * the house raised or a `system` line the panel shows in its own tone (a failure of her account
 * is only ever a system line). `via` is how the operator's line arrived and is `null` for every other
 * role. `turnId` and `index` tie her sentences to the turn that said them and their order in it (both
 * `null` for a line that is not hers); `text` is what the panel draws; `mood` is her leading mood
 * word when the sentence had one; `sounds` are the marks inside `text`. `id` is the store's row id,
 * growing with every line, and is the order the log is read in; `at` is ISO. Carried by `companion_log` and
 * `companion_sentence` and listed in the picture, newest last.
 */
export type CompanionLogEntry = {
  id: number;
  at: string;
  role: 'operator' | 'kaylee' | 'alert' | 'system';
  via: 'typed' | 'spoken' | null;
  turnId: string | null;
  index: number | null;
  text: string;
  mood: string | null;
  sounds: CompanionSound[];
};

/**
 * What a card is, by `kind`: a plain `note`, a `list`, a `diff`, a DocSpace `plan` page, or a DocSpace `page`. Stored with
 * the card (`CompanionNote.kind`), so a card she put up before kinds existed reads as a `note`. The center's inline cards and
 * the stage draw a card's glyph and word by it.
 */
export type CompanionNoteKind = 'note' | 'list' | 'diff' | 'plan' | 'page';

/**
 * What a card is about, told apart by `kind`: a roadmap `card` by its plan's name, a `chat` by its app session id, a DocSpace
 * `page` (and `blockId`, `null` for the page itself) or a `project` by its path. Stored with the card
 * (`CompanionNote.ref`); `null` on a card about nothing.
 */
export type CompanionNoteRef =
  | { kind: 'card'; plan: string }
  | { kind: 'chat'; sessionId: string }
  | { kind: 'page'; pageId: string; blockId: string | null }
  | { kind: 'project'; path: string };

/**
 * A card she put on the panel with `show_note` instead of saying it aloud: a `title` and its `text`.
 * `id` is the store's row id, and a note stays until the operator dismisses it or she takes it down with `dismiss_note`. Announced by
 * `companion_note` and withdrawn by `companion_note_removed`. `kind` says what the card is, `ref` what it is about (`null` for a card
 * about nothing) and `pinned` whether he pinned it to stay in view; a card held before the three existed reads as a `note`
 * about nothing, unpinned. A pin change is announced by `companion_note_pinned`.
 */
export type CompanionNote = { id: number; at: string; title: string; text: string; kind: CompanionNoteKind; ref: CompanionNoteRef | null; pinned: boolean };

/**
 * The state of her CLI process: `asleep` (not running, started by the next message), `waking`,
 * `awake` and `failed`, in which case `error` is the sentence shown on the panel. Her account's
 * failures are shown, never spoken. Announced by `companion_process`.
 */
export type CompanionProcess = { state: 'asleep' | 'waking' | 'awake' | 'failed'; error: string | null };

/**
 * How one of her turns ended: `answered` (she finished), `stopped` (the operator interrupted it) or
 * `failed` (the turn broke). Carried by the `ended` state of `companion_turn`.
 */
export type CompanionTurnOutcome = 'answered' | 'stopped' | 'failed';

/**
 * The thirteen things she does in the house. Eleven change it, and each of those waits for his word, which Kaylee judges from the
 * conversation after she has read the action back (`CompanionCeremonyAction`). The dispatcher's own: `queue`, `hide` and `rework` answer a plan's open Accept
 * prompt (`hide` and `rework` also act on a card with none open), `answer` sends his answers to an open questions round,
 * and `show`, `recut`, `stop`, `resume` and `kick` act on a card. `resume_run` resumes a chain that is not running, with
 * his rulings. `clear_memory` retires every memory of her own bank, which only he can ask of her. The other two are harmless and are done the moment he asks, with no pending action: `open` brings a card,
 * run, page, chat or Cerberus check up on his screen, and `close_followup` ticks one of his follow-ups off. All thirteen are kinds of a row of her
 * record of actions and verbs of the panel; a pending action holds only the eleven (the server types it so: `CompanionStoredPending`).
 */
export type CompanionActionKind = 'queue' | 'hide' | 'show' | 'rework' | 'answer' | 'recut' | 'stop' | 'resume' | 'kick' | 'resume_run' | 'open' | 'close_followup' | 'clear_memory';

/**
 * The eleven actions that change the house and take the whole ceremony: prepared onto his panel, read back to him, fired when
 * Kaylee judges he agreed, lapsing thirty minutes on. Every kind but the two harmless ones (`open`, `close_followup`), which she does at once.
 * Used by the hands' words, recipes and doors (`server/modules/companion/hands/`) and by the stored pending action
 * (`companion-pending.ts`), so no word of the ceremony is kept for an action that has none.
 */
export type CompanionCeremonyAction = Exclude<CompanionActionKind, 'open' | 'close_followup'>;

/**
 * What an action acts on, told apart by `kind`. `spoken` is the name he says it by: the card draws it and
 * her read-back is recognised by it. A `card` is a plan or an epic by the dispatcher's name (`arc` the epic a
 * plan belongs to, `null` for an epic or a plan with none); a `run` is a chain id or a soul launch id
 * (`plan` the plan a chain builds, `null` for a soul's); a `page` is a DocSpace page (`blockId` the block
 * an open lands on, `null` for the page); a `chat` is an app session id; a `followup` is one of his
 * follow-ups, `id` its number, `sessionId` the chat it belongs to and `text` its words as the card shows
 * them; a `memory` is her own bank, `spoken` the name he says it by ("your memory") and `count` the
 * memories it held when the action was prepared; a `check` is a service check by its `node` and `key`
 * (`<service>/<id>`), `spoken` its label — what her open records for one, never the target of a pending action.
 * Carried by `CompanionPendingAction.target`.
 */
export type CompanionActionTarget =
  | { kind: 'card'; name: string; spoken: string; arc: string | null }       // a plan or an epic, by the dispatcher's name
  | { kind: 'run'; runId: string; plan: string | null; spoken: string }      // a chain id or a soul launch id
  | { kind: 'page'; pageId: string; blockId: string | null; spoken: string }
  | { kind: 'chat'; sessionId: string; spoken: string }
  | { kind: 'followup'; id: number; sessionId: string; spoken: string; text: string }
  | { kind: 'memory'; spoken: string; count: number }
  | { kind: 'check'; node: string; key: string; spoken: string };            // what her open records for a check (key `<service>/<id>`); never a pending action

/**
 * One of his lines (spoken or typed), carried verbatim into an action: its `logId` in her log, its `at` time and its
 * `text` exactly as he said it. Notes, rulings and answers travel only this way — never in her words.
 * Carried by `CompanionPendingAction.carried`.
 */
export type CompanionCarriedLine = { logId: number; at: string; text: string };

/**
 * The one action waiting for his word, as her panel's card draws it. `id` names the action (its row in
 * the house's record of her actions); `prompt` is the Accept census, or the open questions with their
 * options, as the card shows them (`null` when the action has none); `carried` is his own lines it
 * carries — notes or rulings under a `null` label, or one group per question with the question as its
 * `label` — each line verbatim; `say` is the action as one order ("Queue Kaylee's eyes"), the name her answers and the panel's record give it, which no page draws; `preparedAt`
 * is when it went on his panel and `expiresAt` when it lapses (thirty minutes on). Held in her state beside
 * the draft and announced by `companion_pending`. What the prepare pinned (the ask and its lock token, the
 * chain, the follow-up) is the server's alone and is never part of this shape.
 */
export type CompanionPendingAction = {
  id: string;
  action: CompanionActionKind;
  target: CompanionActionTarget;
  prompt: string | null;                                        // the Accept census, or the questions with their options, as the card shows them
  carried: Array<{ label: string | null; lines: CompanionCarriedLine[] }>;  // notes or rulings (label null), or one group per question (label = the question)
  say: string;                                                  // the action as one order, "Queue Kaylee's eyes": named in her answers and the panel's record; no page draws it
  preparedAt: string;
  expiresAt: string;
};

/**
 * Where an open lands, on the page that holds the floor: a `chat` by its app session id, a roadmap `card`
 * by its plan's name, a DocSpace `page` (and `blockId`, `null` for the page itself), or a service `check`
 * by its `node` and its `key` (`<service>/<id>`), which the station puts on its stage and the workspace on its Cerberus tab. Carried by
 * `companion_open`.
 */
export type CompanionOpenTarget =
  | { kind: 'chat'; sessionId: string }
  | { kind: 'card'; plan: string }
  | { kind: 'page'; pageId: string; blockId: string | null }
  | { kind: 'check'; node: string; key: string };                            // a service check, by its node and key `<service>/<id>`

/**
 * The nine looks of her face, one per mood. `neutral` is the resting face and the one any mood word the page does not
 * know falls to; the others are the looks a sentence's leading mood word is gathered into. The key of
 * `CompanionFaceManifest.moods`, and the mood a page draws while a sentence is said.
 */
export type CompanionFaceMood = 'neutral' | 'delighted' | 'playful' | 'gentle' | 'thoughtful' | 'brisk' | 'soft' | 'whispered' | 'mock_serious';

/**
 * How open her mouth is, and on which vowel: `closed`, then `a` ("ah"), `e` ("ee") and `o` ("oo"), each half open (`1`) or
 * full (`2`). The key of `CompanionFaceManifest.moods[mood].mouths`; the page picks one from the loudness of her voice
 * and the vowel of the word being said.
 */
export type CompanionFaceMouth = 'closed' | 'a1' | 'a2' | 'e1' | 'e2' | 'o1' | 'o2';

/**
 * Where her eyes look with her head still, in the eight directions of the screen. The key of `CompanionFaceManifest.gaze`;
 * the page uses it for the glances she makes now and then.
 */
export type CompanionFaceGaze = 'left' | 'right' | 'up' | 'down' | 'up_left' | 'up_right' | 'down_left' | 'down_right';

/**
 * Where her head turns, her eyes following: a small turn and a larger one to the left or right (`left_10`, `left_20`) and
 * up or down (`up_5`, `up_10`), the number being the turn's size in degrees. The key of `CompanionFaceManifest.poses`; the
 * page turns her toward what she is looking at, the anchor beside which she stands.
 */
export type CompanionFacePose = 'left_10' | 'left_20' | 'right_10' | 'right_20' | 'up_5' | 'up_10' | 'down_5' | 'down_10';

/**
 * A sound or motion she makes that plays as a short run of frames rather than one: a `laugh`, a `giggle`, a `gasp` or a
 * `sigh`. The key of `CompanionFaceManifest.clips`, and the name of the sound mark that starts it.
 */
export type CompanionFaceClip = 'laugh' | 'giggle' | 'gasp' | 'sigh';

/**
 * Every frame of a face and where each sits: the file a bake writes (`manifest.json` in the face's folder) and a page plays.
 * The frames are cut `frameSize` pixels square and packed onto `sheets` (`sheet-0.webp` and on, at most 8 × 8 cells each);
 * `frames[n]` says which sheet, column and row frame `n` is on. Everything else is an index into `frames`: each mood has its
 * seven mouths and its half-closed and closed blink, `gaze` and `poses` are the neutral face looking or turned, `states`
 * are the looks of listening, failing and surprise, and each clip is its frames in order with the rate to play them at.
 * Directions are the screen's: `left` is toward the window's left edge. `faceId` is the face's own id, the one in
 * `CompanionFace.id`, and `version` is the shape of this file.
 */
export type CompanionFaceManifest = {
  version: 1;
  faceId: string;
  frameSize: number;                                                    // pixels per side of one cell: 256
  sheets: Array<{ file: string; columns: number; rows: number }>;       // `sheet-0.webp` …, 8 × 8 cells at most
  frames: Array<{ sheet: number; column: number; row: number }>;
  moods: Record<CompanionFaceMood, { mouths: Record<CompanionFaceMouth, number>; blink: { half: number; closed: number } }>;
  gaze: Record<CompanionFaceGaze, number>;
  poses: Record<CompanionFacePose, number>;
  states: { listening: number; failed: number; surprise: number };
  clips: Record<CompanionFaceClip, { fps: number; frames: number[] }>;
};

/**
 * Where the making of an uploaded photo's face stands: `queued` (another face is being made first), `baking` (`done` of
 * `total` frames are made) or `failed` (`error` is the sentence for his screen). Carried by `CompanionFace.bake`.
 */
export type CompanionFaceBake = { state: 'queued' | 'baking'; done: number; total: number } | { state: 'failed'; error: string };

/**
 * The face an account's pages draw. `id` is the face to fetch: the original's id while he has uploaded nothing, his upload's
 * once it is made, and `null` only while no face exists at all (a fresh box, before the seed photo's first bake), when the
 * page draws her initial. `original` says whether `id` is the original. `bake` is his upload's bake while it is queued,
 * running or failed, else `null`; her current face stays in `id` until the new one is ready. Carried by
 * `CompanionPicture.face` and announced by `companion_face`.
 */
export type CompanionFace = { id: string | null; original: boolean; bake: CompanionFaceBake | null };

/**
 * The whole of her as a page reads it with `GET /api/companion`: the `settings`, the models the
 * picker offers (`value` and its `label`, taken from the installed CLI's catalog), the `process`, the
 * current `activity`, the `turnId` of a running turn (`null` when none), the `focus` chat, the
 * `draft`, the `pending` action waiting for his word (`null` for none), the `walk`, the `notes`, the
 * newest 200 `log` entries (newest last) and the `floor` — the client id of the page that holds the
 * floor, `null` for none — and her `face`, the one her pages draw. Every later change reaches the page as a
 * `CompanionFrame`, and a page that missed some reads the picture again.
 */
export type CompanionPicture = {
  settings: CompanionSettings;
  models: Array<{ value: CompanionModel; label: string }>;
  process: CompanionProcess;
  activity: CompanionActivity;
  turnId: string | null;
  focus: CompanionSessionRef | null;
  draft: CompanionDraft | null;
  pending: CompanionPendingAction | null;
  walk: CompanionWalk | null;
  notes: CompanionNote[];
  log: CompanionLogEntry[];
  floor: string | null;
  face: CompanionFace;
};

/**
 * Every frame the gateway socket carries to a page about her, told apart by `kind`; each is sent to
 * every open socket of the account. `companion_log` is a whole new log line and `companion_sentence`
 * one sentence of her turn as it is said; `companion_turn` marks a turn `started` or `ended` (the
 * `outcome` and `error` are set on `ended` only, `null` otherwise); `companion_activity`,
 * `companion_focus`, `companion_draft`, `companion_pending`, `companion_walk` and `companion_process` each
 * carry the new value of the matching picture field (`null` clears the focus, draft, pending action or
 * walk); `companion_note` adds a card, `companion_note_removed` withdraws one by `id` and `companion_note_pinned` says whether
 * the card with that `id` is pinned now; `companion_memory` says her memory changed, and a page that shows it reads it again;
 * `companion_settings` carries the new settings; `companion_open` tells the page whose client id equals
 * `floor` to bring `target` up (a chat, a roadmap card, a DocSpace page or a service check), for every open she makes,
 * the open of the chat a send went to included (`target.kind === 'chat'`), with `label` the spoken name the door resolved for it (the
 * station's stage names what she opened by it; the workspace ignores it); `companion_floor` says the
 * floor moved: `floor` is the client id of the page that holds it now, so the page whose own id equals it
 * may play her voice and every other page shows the text only (sent on every write of the floor, whether
 * or not the holder changed); `companion_cleared` says the account's log, unpinned notes and pending action were
 * cleared, with her conversation, and the panel empties but for the cards he pinned, which Clear keeps;
 * `companion_face` carries the account's face after an
 * upload, a restore, each frame a bake renders and the bake's end.
 */
export type CompanionFrame =
  | { kind: 'companion_log'; entry: CompanionLogEntry }
  | { kind: 'companion_sentence'; entry: CompanionLogEntry }
  | { kind: 'companion_turn'; turnId: string; state: 'started' | 'ended'; outcome: CompanionTurnOutcome | null; error: string | null }
  | { kind: 'companion_activity'; activity: CompanionActivity }
  | { kind: 'companion_focus'; focus: CompanionSessionRef | null }
  | { kind: 'companion_draft'; draft: CompanionDraft | null }
  | { kind: 'companion_pending'; pending: CompanionPendingAction | null }
  | { kind: 'companion_walk'; walk: CompanionWalk | null }
  | { kind: 'companion_note'; note: CompanionNote }
  | { kind: 'companion_note_removed'; id: number }
  | { kind: 'companion_note_pinned'; id: number; pinned: boolean }
  | { kind: 'companion_settings'; settings: CompanionSettings }
  | { kind: 'companion_process'; process: CompanionProcess }
  | { kind: 'companion_open'; target: CompanionOpenTarget; floor: string; label: string }
  | { kind: 'companion_floor'; floor: string }
  | { kind: 'companion_face'; face: CompanionFace }
  | { kind: 'companion_cleared' }
  | { kind: 'companion_memory' };

/** Her memory as Settings reads it: how many memories it holds (null when the bank cannot be read, `reason` saying why) and the DocSpace page that shows it. */
export type CompanionMemoryReading = { count: number | null; pageId: string; reason: string | null };

/**
 * One memory of her own bank as the station's memory view draws it: its `token` (the docstore row that holds it), `title`, `kind`,
 * when it was said (`saidAt`, ISO, `null` when the row records none), the `account` that said it (`null` when it records none) and a
 * `quote` of its words (`null` when it holds none). Carried by `CompanionMemoryLines.lines`.
 */
export type CompanionMemoryLine = { token: string; title: string; kind: string; saidAt: string | null; account: string | null; quote: string | null };

/**
 * Her memory read as lines: `count` how many memories the bank holds (`null` when it cannot be read, `reason` saying why, as in
 * `CompanionMemoryReading`), `pageId` the DocSpace page that shows it whole, and `lines` the memories the view draws, newest first.
 * Read again when `companion_memory` is heard.
 */
export type CompanionMemoryLines = { count: number | null; pageId: string; reason: string | null; lines: CompanionMemoryLine[] };
