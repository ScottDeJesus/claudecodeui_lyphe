import path from 'node:path';

import { AppError, expandHome } from '@/shared/utils.js';

import { DOLLARS, PY_SPACE, readFlagText, writeFlag } from './heal-switch.js';

/**
 * The Gemini budget's CAP, as a file: the one dollar amount every plan's Gemini spend is held to.
 *
 * The backend's gate reads this exact path at every check (`core/gemini_budget/ledger.py:cap_usd`), so
 * a move in Settings → Agents → Gemini budget per plan reaches the very next Gemini call with nothing
 * restarted on either side. The budget's whole state lives with its one enforcer; this process only
 * writes the operator's number into it. It is deliberately not a row in `auth.db`: the enforcer is a
 * separate service that must be able to read the cap with no database and no HTTP in the way.
 *
 * THERE IS NO OFF STATE. The operator asked for an adjustable cap, not one that can be switched off, so
 * every reading this module cannot trust is `GEMINI_PLAN_CAP_DEFAULT` — never "no ceiling", and never
 * zero. Zero written on purpose is a real cap, and a tight one: every call has already met it.
 *
 * The grammar is a contract written twice, here and in `ledger.cap_usd`, and the two answer the same
 * number for the same bytes: at most 256 bytes, one leading BOM off, Python's `strip()`, then the heal
 * cap's decimal (`DOLLARS`, whose `\d` is ASCII on both sides), finite and at least 0. Reading and writing
 * go through `heal-switch.ts`'s own pair (`readFlagText`, `writeFlag`), so the bound, the BOM rule and the
 * scratch-file-and-rename dance exist once for every flag file in this house.
 */

/** What the backend reads when its file is absent (`ledger.DEFAULT_CAP_USD`): the operator's $5.00. */
const GEMINI_PLAN_CAP_DEFAULT = 5;

/** Python's `str.strip()` as a blank test, for the path override — `ledger._path_from_env` tests `override.strip()`. */
const BLANK = new RegExp(`^[${PY_SPACE}]*$`);

/**
 * The cap file's path, this call: `GEMINI_PLAN_CAP_FILE` when it is set and not blank, else the
 * backend's own default.
 *
 * A FUNCTION, with the override made ABSOLUTE, for the reasons `park-at-peak-switch.ts` gives for its
 * own: the cap is read live, so a proof that points the seam at a scratch file must reach the next
 * read; and the backend runs from a different working directory than this server, so a relative
 * override left unresolved would name two files from one variable. The name is spelled in every
 * language that needs it, and its home is `/opt/shadow-connector/core/gemini_budget/attribution.py`.
 */
function capPath(): string {
  const override = process.env.GEMINI_PLAN_CAP_FILE;
  if (override && !BLANK.test(override)) return path.resolve(expandHome(override));
  return '/opt/shadow-connector/state/gemini_plan_cap.flag';
}

/**
 * The cap, read — the service's `getGeminiPlanCap`, handed to it verbatim.
 *
 * An empty text is checked first and by hand, because `Number('')` is 0 and zero is a cap that bites:
 * an empty file reading as zero would refuse every Gemini call, where the backend reads it as the
 * default. A non-match, a negative or a non-finite number read as the default too.
 */
export async function getGeminiPlanCapState(): Promise<{ usd: number }> {
  const text = await readFlagText(capPath());
  if (!text || !DOLLARS.test(text)) return { usd: GEMINI_PLAN_CAP_DEFAULT };
  const usd = Number(text);
  if (!Number.isFinite(usd) || usd < 0) return { usd: GEMINI_PLAN_CAP_DEFAULT };
  // `-0` is a zero cap, and it reads as the zero the backend reads, not as a negative one.
  return { usd: usd === 0 ? 0 : usd };
}

/**
 * Set the cap, and answer with what the file reads back — never with the input; the service's
 * `setGeminiPlanCap`, handed to it verbatim.
 *
 * Anything but a finite number of 0 or more is a 400 rather than a coercion: there is no "no ceiling"
 * for a blank or a negative to mean, and a string such as `"5"` is a dollar amount nobody typed as one.
 * `${usd}` is a form the grammar above accepts for every finite number, exponent included.
 */
export async function setGeminiPlanCapState(usdInput: unknown): Promise<{ usd: number }> {
  if (typeof usdInput !== 'number' || !Number.isFinite(usdInput) || usdInput < 0) {
    throw new AppError('usd must be a dollar amount of 0 or more', {
      code: 'INVALID_GEMINI_PLAN_CAP',
      statusCode: 400,
    });
  }
  await writeFlag(capPath(), `${usdInput}\n`);
  return getGeminiPlanCapState();
}
