import os from 'node:os';
import path from 'node:path';

import { readFlagFile, writeFlagFile } from './deepseek-flash-switch.js';

/**
 * The house Jev switches, as the flag files the Python side already reads.
 *
 * `~/.claude/hooks/jev_client.py` reads every one of them through `plan_runner.state.reads_on` — the
 * same predicate `deepseek_flash.flag` goes through — so "on" means one thing in this house, and this
 * module reuses `readFlagFile`/`writeFlagFile` rather than growing a second opinion about what a
 * flag file says or how it is written.
 *
 * MASTER (`jev.flag`) is the whole blast radius: off, and no text leaves this machine. Each other
 * file is a narrower consent — one kind of text a caller may send, once the master allows sending
 * anything at all, and each counts only while the master is on. They are separate files on purpose,
 * so that turning Jev on to filter a log can never by itself start shipping prompts to a third party.
 *
 * THE SCOPES ARE A LIST, NOT A SET OF PAIRS: every reader and writer below walks `JEV_SCOPES`, so a
 * scope added to the table is one entry and no call site grows a branch. The stored values, the
 * derived live values and the field names the panel reads all come off that one table.
 */
const MASTER_PATH = path.join(os.homedir(), '.claude', 'state', 'jev.flag');

/**
 * One narrower opt-in: the field names the panel's API uses, and the file the Python side reads.
 *
 * The key is the field in `GET`/`PUT /api/settings/jev`; `liveKey` is the derived field the same
 * answer carries; `filePath` is what `jev_client.switch_on(scope)` reads. The Python `scope=` name
 * each file belongs to is its own key in snake_case — `toolOutput` is `tool_output`, the spelling
 * `~/.claude/scripts/jev switch on --scope …` takes.
 */
export const JEV_SCOPES = {
  /** The operator's own prompt text, which `hooks/route_artifact_word.py` sends. */
  prompts: {
    liveKey: 'promptsLive',
    filePath: path.join(os.homedir(), '.claude', 'state', 'jev_prompts.flag'),
  },
  /** A command's output, which a post-tool hook sends — never from a no-send path. */
  toolOutput: {
    liveKey: 'toolOutputLive',
    filePath: path.join(os.homedir(), '.claude', 'state', 'jev_tool_output.flag'),
  },
} as const;

/** The scope a write names. Derived from the table above, so the two can never disagree. */
export type JevScopeKey = keyof typeof JEV_SCOPES;

/**
 * Every switch as one answer: the master, each scope's STORED value, and each scope's LIVE one.
 *
 * A live field is what the pair adds up to, not a file of its own — which is why it is derived
 * here, once, instead of by each consumer.
 */
export type JevSwitches = { master: boolean }
  & { [Key in JevScopeKey]: boolean }
  & { [Key in (typeof JEV_SCOPES)[JevScopeKey]['liveKey']]: boolean };

/** The scope keys in table order, as a list: `Object.keys` widens them to `string`. */
const SCOPE_KEYS = Object.keys(JEV_SCOPES) as JevScopeKey[];

/**
 * Every switch, read from disk right now.
 *
 * Read together and answered together: the panel draws them as one card, and a master from one
 * moment beside a scope switch from another could show a row live under a master that has since
 * gone off.
 */
export async function readJevSwitches(): Promise<JevSwitches> {
  const [master, ...stored] = await Promise.all([
    readFlagFile(MASTER_PATH),
    ...SCOPE_KEYS.map((key) => readFlagFile(JEV_SCOPES[key].filePath)),
  ]);

  // Answered by walking the table rather than field by field, so a scope added there is read here
  // without an edit. The cast is the one place the table's runtime order meets the type derived
  // from it, and both sides come from `JEV_SCOPES`.
  const switches: Record<string, boolean> = { master };
  SCOPE_KEYS.forEach((key, index) => {
    switches[key] = stored[index];
    switches[JEV_SCOPES[key].liveKey] = master && stored[index];
  });
  return switches as JevSwitches;
}

/** The master switch, written. The one file that decides whether anything leaves this machine. */
export async function writeJevMasterSwitch(enabled: boolean): Promise<void> {
  return writeFlagFile(MASTER_PATH, enabled);
}

/**
 * One scope's opt-in, written. Turning it on enables nothing by itself — the master gates it — so
 * this file's stored value is kept and shown even while the master is off.
 */
export async function writeJevScopeSwitch(scope: JevScopeKey, enabled: boolean): Promise<void> {
  return writeFlagFile(JEV_SCOPES[scope].filePath, enabled);
}
