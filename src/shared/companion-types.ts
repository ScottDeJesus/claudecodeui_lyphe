//----------------- COMPANION CONTRACTS ------------
// The client's view of Kaylee, the voice companion: every shape the panel reads off a wire or hands
// back to it — her settings, the picture of her that one request returns, every frame the gateway
// socket carries as she works, and the log, draft, walkthrough and note the panel draws.
//
// It mirrors `server/shared/companion-types.ts` field for field, and that file is the home: look
// there when a shape here seems wrong, and add a frame or a field there first. The two edit
// TOGETHER: a field renamed on one side and not the other is a panel that quietly stops reading.
//
// It imports NOTHING from `server/`: the client tsconfig does not compile server code, and an
// `import type` across that boundary is a bundle that cannot build.
//
// Every time is an ISO-8601 string and JSON is camelCase, as on every companion wire.

/**
 * The four Claude models Kaylee can run on, by the alias the CLI takes. Chosen from the panel's
 * picker (`CompanionPicture.models` lists them with their labels) and stored as
 * `CompanionSettings.model`; a change is applied live to her running process without losing her
 * memory.
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
 * A card she put on the panel with `show_note` instead of saying it aloud: a `title` and its `text`.
 * `id` is the store's row id, and a note stays until the operator dismisses it. Announced by
 * `companion_note` and withdrawn by `companion_note_removed`.
 */
export type CompanionNote = { id: number; at: string; title: string; text: string };

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
 * The whole of her as a page reads it with `GET /api/companion`: the `settings`, the models the
 * picker offers (`value` and its `label`, taken from the installed CLI's catalog), the `process`, the
 * current `activity`, the `turnId` of a running turn (`null` when none), the `focus` chat, the
 * `draft`, the `walk`, the `notes`, the newest 200 `log` entries (newest last) and the `floor` — the
 * client id of the page that holds the floor, `null` for none. Every later change reaches the page as
 * a `CompanionFrame`, and a page that missed some reads the picture again.
 */
export type CompanionPicture = {
  settings: CompanionSettings;
  models: Array<{ value: CompanionModel; label: string }>;
  process: CompanionProcess;
  activity: CompanionActivity;
  turnId: string | null;
  focus: CompanionSessionRef | null;
  draft: CompanionDraft | null;
  walk: CompanionWalk | null;
  notes: CompanionNote[];
  log: CompanionLogEntry[];
  floor: string | null;
};

/**
 * Every frame the gateway socket carries to a page about her, told apart by `kind`; each is sent to
 * every open socket of the account. `companion_log` is a whole new log line and `companion_sentence`
 * one sentence of her turn as it is said; `companion_turn` marks a turn `started` or `ended` (the
 * `outcome` and `error` are set on `ended` only, `null` otherwise); `companion_activity`,
 * `companion_focus`, `companion_draft`, `companion_walk` and `companion_process` each carry the new
 * value of the matching picture field (`null` clears the focus, draft or walk); `companion_note` adds
 * a card and `companion_note_removed` withdraws one by `id`; `companion_settings` carries the new
 * settings; `companion_open_chat` tells the page whose client id equals `floor` to open the chat
 * `sessionId`; `companion_floor` says the floor moved: `floor` is the client id of the page that holds it
 * now, so the page whose own id equals it may play her voice and every other page shows the text only
 * (sent on every write of the floor, whether or not the holder changed); `companion_cleared` says the
 * account's log and notes were cleared, with her memory, and the panel empties.
 */
export type CompanionFrame =
  | { kind: 'companion_log'; entry: CompanionLogEntry }
  | { kind: 'companion_sentence'; entry: CompanionLogEntry }
  | { kind: 'companion_turn'; turnId: string; state: 'started' | 'ended'; outcome: CompanionTurnOutcome | null; error: string | null }
  | { kind: 'companion_activity'; activity: CompanionActivity }
  | { kind: 'companion_focus'; focus: CompanionSessionRef | null }
  | { kind: 'companion_draft'; draft: CompanionDraft | null }
  | { kind: 'companion_walk'; walk: CompanionWalk | null }
  | { kind: 'companion_note'; note: CompanionNote }
  | { kind: 'companion_note_removed'; id: number }
  | { kind: 'companion_settings'; settings: CompanionSettings }
  | { kind: 'companion_process'; process: CompanionProcess }
  | { kind: 'companion_open_chat'; sessionId: string; floor: string }
  | { kind: 'companion_floor'; floor: string }
  | { kind: 'companion_cleared' };
