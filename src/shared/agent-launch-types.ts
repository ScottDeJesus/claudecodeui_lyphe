// ---------------------------
//----------------- AGENT LAUNCH CONTRACTS (CLIENT MIRROR) ------------
// The Agents tab's view of the launch table: every shape it reads off `GET /api/agent-launch` and
// every change it sends back. The census mirrors what `~/.claude/scripts/launch-table show` prints,
// KEY FOR KEY and in that CLI's own snake_case — the relay (`server/modules/agent-launch/`) carries the
// CLI's one JSON object untouched, so a rename here is a field the panel quietly stops reading.
//
// A SIBLING of `src/shared/types.ts`, as `kanban-types.ts` is: that file is past 2000 lines and the
// house ceiling for a module is 300. Nothing here is computed on the client — a row's model, effort,
// lanes and `shim.current` are the Python seams' answers, drawn as they come.

//----------------- THE CENSUS ------------

/**
 * The vocabulary the table accepts, and the ONLY source of every choice list the panel draws.
 * The panel never spells `opus` or `xhigh` itself: a word the Python side adds arrives here first.
 */
export type AgentLaunchChoices = {
  models: string[];
  efforts: string[];
};

/**
 * The table's `[default]` and `[deepseek]` blocks — what a launch runs at when its row pins nothing.
 *
 * `effort` is keyed by every model in `choices.models`; a `null` value means no `--effort` flag is
 * passed for that model, so the CLI's own `effortLevel` (`census.cli_effort`) applies.
 * `deepseek_effort` is ONE house-wide word: on the DeepSeek side it wins over a soul's own effort.
 */
export type AgentLaunchDefaults = {
  model: string;
  effort: Record<string, string | null>;
  deepseek_effort: string;
};

/**
 * One side of a lane: the model and effort a launch runs at when `when` holds.
 *
 * `when` is `always` for a lane with a single answer — a planner's own row in the launch table among
 * them — and `claude` / `deepseek` where the DeepSeek switch picks the side. `effort` is null when no
 * flag is passed.
 */
export type AgentLaunchSide = {
  when: string;
  model: string;
  effort: string | null;
};

/**
 * One door a row launches through, with the model and effort of every side of that door.
 *
 * `reach` says when a change to the row lands: `new-session` for the `agent` lane (an Agent call reads
 * its definition once per session), `next-launch` for every other lane. `note` is the Python side's
 * own sentence about the lane, or null when it has nothing to add.
 */
export type AgentLaunchLane = {
  lane: 'agent' | 'dispatcher' | 'chain' | 'metis';
  reach: 'new-session' | 'next-launch';
  note: string | null;
  sides: AgentLaunchSide[];
};

/**
 * What a soul's generated shim (`~/.claude/agents/<name>.md`) says for itself, against the row's values.
 * `effort` is null when the shim carries no `effort:` line; `current` is true when both words equal
 * the row's — false means the shims have not been regenerated since the table last changed.
 */
export type AgentLaunchShim = {
  model: string;
  effort: string | null;
  current: boolean;
};

/**
 * One row of the tab: a soul, or Metis (`kind: 'metis'`, always last, with no shim).
 *
 * `model` and `effort` are what the row RESOLVES to; `model_pinned` and `effort_pinned` say whether
 * the row's own table entry set them (a pin) or they came from `defaults`. Clearing a pin is sending
 * `null` in an `AgentLaunchRowChange`.
 */
export type AgentLaunchRow = {
  name: string;
  kind: 'soul' | 'metis';
  description: string;
  model: string;
  model_pinned: boolean;
  effort: string | null;
  effort_pinned: boolean;
  lanes: AgentLaunchLane[];
  shim: AgentLaunchShim | null;
};

/**
 * What the shims' regeneration said after a write.
 *
 * `ran` is false when nothing needed regenerating (a Metis-only change) or the table was a scratch
 * copy; `ok` is false when the generator failed — the write is kept either way. `said` is the
 * generator's last stdout line, or the tail of its error, at most 300 characters.
 */
export type AgentLaunchRegen = {
  ran: boolean;
  ok: boolean;
  said: string;
};

/**
 * The whole picture: the table's state, its defaults, one row per soul then Metis, and — on the
 * census a write answers with — the regeneration.
 *
 * `state` is `file` for a table read off disk, `absent` when there is none, `malformed` when it could
 * not be read; the last two answer the SHIPPED values, and `problems` carries every sentence the
 * read had to say. `cli_effort` is the CLI's own `effortLevel`, or null.
 */
export type AgentLaunchCensus = {
  file: string;
  state: 'file' | 'absent' | 'malformed';
  problems: string[];
  choices: AgentLaunchChoices;
  defaults: AgentLaunchDefaults;
  cli_effort: string | null;
  rows: AgentLaunchRow[];
  regen: AgentLaunchRegen | null;
};

//----------------- WHAT THE TAB SENDS ------------

/**
 * A change to one row's own pins. A field left out is untouched; a word pins it; `null` clears the
 * pin, so the row falls back to the defaults (the panel's "Default" choice).
 */
export type AgentLaunchRowChange = { model?: string | null; effort?: string | null };

/**
 * A change to the table's defaults. `effort` names one or more models: a word sets that model's
 * default effort, `null` removes it (no `--effort` flag, so the CLI's own applies).
 */
export type AgentLaunchDefaultsChange = {
  model?: string;
  effort?: Record<string, string | null>;
  deepseek_effort?: string;
};
