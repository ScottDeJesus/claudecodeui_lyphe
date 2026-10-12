import { cerberusCatalogDb, cerberusDefinitionsDb, cerberusNodesDb } from '@/modules/database/index.js';
import type { CerberusCatalogEntryInput } from '@/shared/cerberus-types.js';
import { AppError } from '@/shared/utils.js';

import { HUB_NODE_ID } from './definition-document.js';

/**
 * What a person may write into the catalog: the refusals of `POST /catalog`, and the id a new entry
 * takes. Both belong to the WRITE of an entry and to nothing else the catalog service does (a toggle,
 * a retire and a publish never ask them), so they live apart from it.
 *
 * Every refusal is a 400 `CERBERUS_BAD_ENTRY` that names the field, in the message and in `details`
 * (`{ field }`), the way a bad definition names its path. The first field that fails is the one
 * reported; a person fixes it and tries again.
 *
 * Consumers: `catalog.service.ts` (`writeEntry`) and `diagnosis/diagnosis-promotion.ts` (`badEntry`).
 */

const MIN_TIMEOUT_S = 1;
const MAX_TIMEOUT_S = 3600;
const MIN_LIMIT_RUNS = 1;
const MAX_LIMIT_RUNS = 10;
/** The two windows an entry's limit may count in: an hour or a day. */
const LIMIT_WINDOWS_S: readonly number[] = [3600, 86_400];
const MAX_NAME_LENGTH = 100;
/** A command rides one signed frame and one `run.start`; this is far past any real one-liner and well short of a frame limit. */
const MAX_CMD_LENGTH = 8000;
const MAX_CAPPED_LENGTH = 300;
const MAX_SLUG_LENGTH = 60;
/** What a name with no letter or digit in it (a name in a script the slug cannot spell) becomes. */
const FALLBACK_SLUG = 'fix';

/** The 400 `CERBERUS_BAD_ENTRY` that names the field (in the message and in `details`); `diagnosis/diagnosis-promotion.ts` refuses its own two fields with it too. */
export function badEntry(field: string, message: string): AppError {
  return new AppError(`The entry is not valid at ${field}: ${message}.`, {
    code: 'CERBERUS_BAD_ENTRY',
    statusCode: 400,
    details: { field },
  });
}

/** An entry as `writeEntry` stores it: every field checked, trimmed where trimming is safe, defaults filled. */
export type ValidEntry = {
  node: string;
  check: string;
  name: string;
  when: 'failing' | 'warn';
  cmd: string;
  timeout: number;
  limitRuns: number;
  limitPer: number;
  recheck: boolean;
  capped: string | null;
};

/**
 * Half of an emoji or another character outside the basic plane: a high surrogate with no low one
 * after it, or a low one with no high one before. JSON can carry one (`"\ud83d"`) and SQLite stores
 * it as U+FFFD, so the text kept — and signed, and run — would not be the text typed.
 *
 * Consumers: this file's own `refuseLoneSurrogate`, and `diagnosis/diagnosis-tools.ts`, whose
 * `submit_diagnosis` and `note` refuse such text at the agent so a proposal it makes can still be
 * promoted to an entry.
 */
export const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

function refuseLoneSurrogate(field: string, text: string): void {
  if (LONE_SURROGATE.test(text)) throw badEntry(field, 'holds half of a character, which cannot be stored as typed');
}

function isWholeNumberIn(value: unknown, low: number, high: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= low && value <= high;
}

/**
 * The input as a `ValidEntry`, or the 400 that names the field that is wrong. `node` must be an
 * enrolled node (center's own checks have no warden to run anything) and `check` an ACTIVE check of
 * it — a fix for a check that is not there could never be offered. The command is stored as written,
 * not trimmed: the warden compares it byte for byte, and a trailing newline or a leading space is
 * the person's to mean.
 */
export function validateEntryInput(input: CerberusCatalogEntryInput): ValidEntry {
  const { node, check, name, when, cmd, timeout, limit } = input;

  if (node === HUB_NODE_ID || !cerberusNodesDb.get(node)) {
    throw badEntry('node', `no node called "${node}" is enrolled`);
  }
  if (!cerberusDefinitionsDb.activeChecks(node).some((active) => active.key === check)) {
    throw badEntry('check', `${node} has no active check "${check}"`);
  }

  const trimmedName = name.trim();
  if (trimmedName === '') throw badEntry('name', 'a name is needed');
  if (trimmedName.length > MAX_NAME_LENGTH) throw badEntry('name', `a name can be ${MAX_NAME_LENGTH} characters at most`);
  refuseLoneSurrogate('name', trimmedName);

  if (when !== 'failing' && when !== 'warn') throw badEntry('when', 'must be "failing" or "warn"');

  if (cmd.trim() === '') throw badEntry('cmd', 'a command is needed');
  if (cmd.length > MAX_CMD_LENGTH) throw badEntry('cmd', `a command can be ${MAX_CMD_LENGTH} characters at most`);
  refuseLoneSurrogate('cmd', cmd);

  if (!isWholeNumberIn(timeout, MIN_TIMEOUT_S, MAX_TIMEOUT_S)) {
    throw badEntry('timeout', `must be a whole number of seconds from ${MIN_TIMEOUT_S} to ${MAX_TIMEOUT_S}`);
  }
  if (!isWholeNumberIn(limit.runs, MIN_LIMIT_RUNS, MAX_LIMIT_RUNS)) {
    throw badEntry('limit.runs', `must be a whole number from ${MIN_LIMIT_RUNS} to ${MAX_LIMIT_RUNS}`);
  }
  if (!LIMIT_WINDOWS_S.includes(limit.per)) {
    throw badEntry('limit.per', 'must be 3600 (an hour) or 86400 (a day) seconds');
  }

  const capped = input.capped === undefined || input.capped === null ? null : input.capped.trim();
  if (capped === '') throw badEntry('capped', 'the reason may not be empty — leave it out for an entry that may run on its own');
  if (capped !== null && capped.length > MAX_CAPPED_LENGTH) {
    throw badEntry('capped', `the reason can be ${MAX_CAPPED_LENGTH} characters at most`);
  }
  if (capped !== null) refuseLoneSurrogate('capped', capped);

  return {
    node,
    check,
    name: trimmedName,
    when,
    cmd,
    timeout,
    limitRuns: limit.runs,
    limitPer: limit.per,
    recheck: input.recheck ?? true,
    capped,
  };
}

/** The name as a slug: accents folded, lower case, runs of anything else one hyphen, at most 60 characters. */
function slugOfName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '');
  return slug === '' ? FALLBACK_SLUG : slug;
}

/**
 * The id a new entry named `name` takes: its slug, then `<slug>-2`, `<slug>-3` … while taken. A
 * RETIRED entry still holds its id (`get` finds it): a run's history names its entry by id, and a new
 * fix inheriting an old one's id would inherit its runs.
 *
 * Reads only — the caller inserts inside the same write transaction, so two writers cannot pick one id.
 */
export function freeEntryId(name: string): string {
  const slug = slugOfName(name);
  let candidate = slug;
  for (let suffix = 2; cerberusCatalogDb.get(candidate); suffix += 1) candidate = `${slug}-${suffix}`;
  return candidate;
}
