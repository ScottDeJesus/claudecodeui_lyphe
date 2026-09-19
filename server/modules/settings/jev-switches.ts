import os from 'node:os';
import path from 'node:path';

import { readFlagFile, writeFlagFile } from './deepseek-flash-switch.js';

/**
 * The house Jev switches, as the two flag files the Python side already reads.
 *
 * `~/.claude/hooks/jev_client.py` reads both through `plan_runner.state.reads_on` — the same
 * predicate `deepseek_flash.flag` goes through — so "on" means one thing in this house, and this
 * module reuses `readFlagFile`/`writeFlagFile` rather than growing a second opinion about what a
 * flag file says or how it is written.
 *
 * MASTER (`jev.flag`) is the whole blast radius: off, and no text leaves this machine. The second
 * file (`jev_prompts.flag`) is the narrower consent a caller needs before it may send the
 * OPERATOR'S PROMPT text, and it counts only while the master is on. They are two files on purpose,
 * so that turning Jev on to filter a log can never by itself start shipping prompts to a third
 * party — which is why `promptsLive` is derived here, once, instead of by each consumer.
 */
const MASTER_PATH = path.join(os.homedir(), '.claude', 'state', 'jev.flag');
const PROMPTS_PATH = path.join(os.homedir(), '.claude', 'state', 'jev_prompts.flag');

/** Both switches as one answer. `promptsLive` is what the pair adds up to, not a third file. */
export type JevSwitches = {
  master: boolean;
  prompts: boolean;
  promptsLive: boolean;
};

/**
 * Both switches, read from disk right now.
 *
 * Read together and answered together: the panel draws them as one card, and a master from one
 * moment beside a prompt switch from another could show the prompt row live under a master that
 * has since gone off.
 */
export async function readJevSwitches(): Promise<JevSwitches> {
  const [master, prompts] = await Promise.all([
    readFlagFile(MASTER_PATH),
    readFlagFile(PROMPTS_PATH),
  ]);
  return { master, prompts, promptsLive: master && prompts };
}

/** The master switch, written. The one file that decides whether anything leaves this machine. */
export async function writeJevMasterSwitch(enabled: boolean): Promise<void> {
  return writeFlagFile(MASTER_PATH, enabled);
}

/**
 * The prompt-text opt-in, written. Turning it on enables nothing by itself — the master gates it —
 * so this file's stored value is kept and shown even while the master is off.
 */
export async function writeJevPromptsSwitch(enabled: boolean): Promise<void> {
  return writeFlagFile(PROMPTS_PATH, enabled);
}
