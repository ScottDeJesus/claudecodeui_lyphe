import os from 'node:os';
import path from 'node:path';

import { readFlagText, writeFlag } from './heal-switch.js';

/**
 * `heal_model.flag` — one of the heal reflex's switches, and the one that is not about the reflex at
 * all: which model a heal's own souls run on.
 *
 *   `heal_model.flag`  ONE of the two words `deepseek` or `claude`. Anything else — absent,
 *                      unreadable, `DeepSeek`, a typo — is `deepseek`: the heal's own default side, and
 *                      the one it shipped on. The file IS the heal's switch, so there is no third
 *                      state and nothing else on this box has a say.
 *
 * It lives in a module of its own, beside `heal-switch.ts` rather than inside it, for the one reason
 * a file gets split in this house: the switches there (the master and the cap) are the reflex's OWN
 * behaviour — whether it may launch, what the day may cost — and this one is a routing fact about the
 * chain it forks. They change for different reasons. The read and write below go through
 * `heal-switch.ts`'s own `readFlagText`/`writeFlag`, so this file is parsed and written by the SAME
 * code as its siblings: one bound, one leading-BOM rule, one Python-space class, one atomic rename.
 * Nothing is re-implemented here.
 *
 * THE CAP COUNTS DEEPSEEK DOLLARS ONLY, and this is the switch that decides which dollars those are:
 * Claude is the operator's own subscription (no cap, no dollar figure, no warning), so the worker sums
 * the day's heals that ran on DeepSeek and nothing else.
 *
 * `heal_model.flag` IS THE HEAL'S OWN CHOICE AND NEVER THE CHAT'S. The chat composer's DeepSeek switch
 * is a different file (`deepseek-flash-switch.ts` → `state/deepseek_flash.flag`), nothing on this side
 * or the worker's reads one to answer for the other, and the two must be able to disagree: an operator
 * with leftover Claude usage at the end of a week turns the heal onto Claude without moving a single
 * session's builds, and a session turned onto DeepSeek moves no heal. Nothing here ever writes the
 * chat's file.
 *
 * The grammar is a contract written twice in two languages: the worker's reader is
 * `scripts/heal_switches.py`'s `read_model_switch`, and this is written to agree with it clause for
 * clause rather than to be lenient — anything that is not `claude` reads as `deepseek` on both sides.
 */
const MODEL_PATH = path.join(os.homedir(), '.claude', 'state', 'heal_model.flag');

/** The model switch's two words — the whole of what the flag may say. */
const MODEL_DEEPSEEK = 'deepseek';
const MODEL_CLAUDE = 'claude';

/**
 * The model switch's word, and the WHOLE grammar of `heal_model.flag`: the two models a heal may run
 * on. There is no third value — a file that names neither is `deepseek`, the side the heal ships on.
 */
export type HealModel = 'deepseek' | 'claude';

/**
 * The model this heal's souls run on, in the file's own words — ALWAYS one of the two.
 *
 * A file that cannot be trusted or does not name a side — absent, unreadable, oversized, `DeepSeek`, a
 * typo — answers `deepseek`, exactly as the worker reads it (`read_model_switch`, clause for clause):
 * the heal's own default, with the chat composer's switch having nothing to say about it. A reader
 * therefore never receives a `null` to invent a meaning for, and the row never has to draw a third
 * state.
 */
export async function readHealModel(): Promise<HealModel> {
  const text = await readFlagText(MODEL_PATH);
  return text === MODEL_CLAUDE ? MODEL_CLAUDE : MODEL_DEEPSEEK;
}

/**
 * The model, written — one word and no count, so the press that names the side is the whole write.
 *
 * There is no clear: the file names a side in every state, and a press always writes the OTHER word
 * (`deepseek` ⇄ `claude`), so an absent file is never a state a press has to restore.
 */
export async function writeHealModel(model: HealModel): Promise<void> {
  await writeFlag(MODEL_PATH, `${model}\n`);
}
