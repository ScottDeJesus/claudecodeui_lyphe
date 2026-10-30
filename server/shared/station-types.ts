//----------------- STATION CONTRACTS ------------
// The shapes Kaylee Station puts on a wire: what its stage holds, the sessions and needs its regions list, the frames its hint
// carries as a chat changes, and what has landed. One home, so every plan of the arc adds here and none redefines.
//
// It is a SIBLING of `companion-types.ts` for the same reason that file is one of `types.ts`: a shared file past the house
// ceiling is not where new contracts go. Its readings are the companion's — every time is an ISO-8601 string, JSON is
// camelCase on every wire — and the browser half is `src/shared/station-types.ts`: the same types, field for field. The two
// files are edited together, always; a field renamed on one side and not the other is a station that quietly stops reading.
//
// Nothing here is server-only: the whole contract reaches the browser. Later plans of the arc add types and frame kinds HERE
// and redefine nothing.

/**
 * The kinds of thing the station's stage can hold, one per `StationFocus` member: a `chat`, a `card` (a feature or an epic), a
 * waiting `ask`, a chat's `followups`, a service `check`, a `note` card of hers, the `walk`through and a DocSpace `page`. The key of
 * the page's `STATION_FOCUS_GLYPHS`, which gives each its icon and its word.
 */
export type StationFocusKind = 'chat' | 'card' | 'ask' | 'followups' | 'check' | 'note' | 'walk' | 'page';

/**
 * What the station's stage holds, told apart by `kind`; every member carries `label`, the spoken name the stage and her `<view>` line
 * name it by. A `chat` is an app session id; a `card` a feature (plan) or an epic (arc) by the dispatcher's name; an `ask` the one
 * waiting request (`requestId`) of a chat; `followups` a chat's open follow-ups; a `check` a service check by its `node` and its
 * `key` (`<service>/<id>`); a `note` one of her cards by its row id; the `walk`through has no more to name than its label; a
 * `page` is a DocSpace page and `blockId` the block it lands on (`null` for the page). Stored in the page's session storage,
 * stated to the server in the presence a station sends, and read by her as the `<view>` of a message he sends — never pushed.
 */
export type StationFocus =
  | { kind: 'chat'; sessionId: string; label: string }
  | { kind: 'card'; plan: string; label: string }                      // a feature (plan) or an epic (arc), by name
  | { kind: 'ask'; sessionId: string; requestId: string; label: string }
  | { kind: 'followups'; sessionId: string; label: string }
  | { kind: 'check'; node: string; key: string; label: string }      // key `<service>/<id>`
  | { kind: 'note'; id: number; label: string }
  | { kind: 'walk'; label: string }
  | { kind: 'page'; pageId: string; blockId: string | null; label: string };

/**
 * Where a chat stands, as the station's sessions list shows it (chat-activity's `ChatState`): `working` (a turn runs), `waiting`
 * (it waits for his answer), `live` (its process is up and idle) or `asleep` (no process).
 */
export type StationSessionState = 'working' | 'waiting' | 'live' | 'asleep';

/**
 * One row of the station's sessions list: the chat's `sessionId`, its `name`, the `project` it belongs to, its `state`, a short
 * `activity` line saying what it is doing, and `updatedAt` (ISO, `null` when the chat has none yet).
 */
export type StationSession = { sessionId: string; name: string; project: string; state: StationSessionState; activity: string; updatedAt: string | null };

/** What a waiting chat ask is: a `permission` for a tool, a `question` with options, or a `plan` to approve. */
export type StationAskKind = 'permission' | 'question' | 'plan';

/**
 * One thing that waits for his word, told apart by `kind`; `id` names it in the needs list and `say` is what he says aloud to answer
 * it (`null` when it has no spoken answer, or when her resolvers would refuse the phrase for it: a name two cards share, an unnamed chat). `accept` is a plan's (or, `epic`, an arc's) Accept prompt on `card` with `features` to
 * cut; `questions` an open questions round of `count` on `card`; `ask` a chat's waiting request (`ask` its kind, `tool` the tool,
 * `what` what it would do, `rule` the permission rule that would allow it, `options` the answers it offers, `more` how many
 * requests wait behind it); `followups` a chat's `count` open follow-ups, `newest` the latest; `check` a service check that is
 * `failing` or `denied` (`value` its reading, `since` when it began, each `null` when unknown).
 */
export type StationNeed =
  | { kind: 'accept'; id: string; card: string; epic: boolean; title: string; headline: string; features: number; say: string | null }
  | { kind: 'questions'; id: string; card: string; title: string; headline: string; count: number; say: string | null }
  | { kind: 'ask'; id: string; sessionId: string; requestId: string; chat: string; ask: StationAskKind; tool: string; what: string; rule: string | null; options: string[]; more: number; say: string | null }
  | { kind: 'followups'; id: string; sessionId: string; chat: string; count: number; newest: string; say: string | null }
  | { kind: 'check'; id: string; node: string; key: string; label: string; status: 'failing' | 'denied'; value: string | null; since: number | null; say: string | null };

/** The answer a press on a waiting ask sends: the `answer` text for the ask `requestId` of chat `sessionId`. */
export type StationAskAnswer = { sessionId: string; requestId: string; answer: string };

/** What a landed entry of the station's roadmap is: a feature `shipped`, an `epic` finished, a build `landed`, or a chain `recovered`. */
export type StationLandedKind = 'shipped' | 'epic' | 'landed' | 'recovered';

/**
 * One line of what has landed: the log's row `id`, when it landed (`at`, ISO), its `kind`, its `title`, the `plan` it belongs to and
 * the `sessionId` and `chat` name it came from (each `null` when it has none). Carried by `station_landed`.
 */
export type StationLanded = { id: number; at: string; kind: StationLandedKind; title: string; plan: string | null; sessionId: string | null; chat: string | null };

/**
 * Every frame the station's hint carries to a page, each sent to every open socket of the account. `station_sessions_changed` says a
 * chat changed, and the page reads its sessions again; `states` is `true` when a chat's state moved (starting, waiting, ending) and
 * `false` when only its activity did, which the page may fold more slowly. `station_landed` carries one new `entry` of what landed.
 */
export type StationFrame =
  | { kind: 'station_sessions_changed'; states: boolean }
  | { kind: 'station_landed'; entry: StationLanded };
