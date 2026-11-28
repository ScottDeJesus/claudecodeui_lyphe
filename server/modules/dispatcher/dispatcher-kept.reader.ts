import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { isRecord } from '@/shared/document-fields.js';

/**
 * The status document as the dispatcher's keeper last kept it: files under `<home>/status`
 * (`hooks/dispatcher/keeper_files.py`), assembled here into what `dispatcher status --json` prints, key for key.
 *
 * THE FILES. `index.json` is the head: `document` (every key but `plans`) and `plans`, a list of
 * `{name, digest}` in store order. Each plan's dict is `plans/<digest>.json`, named by the sha256 of its own
 * bytes, so a file never changes under its name. The keeper writes every file tmp-then-rename, plan files first
 * and the index last, and unlinks only a plan file neither this index nor the one before it names.
 *
 * THE MEMORY. Parsed plan files are kept by digest, one map per home, and cut down to the index's digests after
 * each read: a reading opens the index and only the plan files it has not seen, which on a quiet store is none.
 * The parsed plans are frozen, because the same object is handed to every later reading: a reader that wrote into
 * one would change the next picture, and a frozen one throws instead.
 *
 * A FILE GONE UNDER A READ (two keeper runs moved on since the index was read) is answered by reading the index
 * again. A home with no index yet is answered by running `dispatcher keep` once (`keepOnce`) and reading again.
 */

/** The index's own shape number (`keeper_files.SHAPE`): a different one is a different build of the keeper. */
const INDEX_SHAPE = 1;
/** A plan file's name: the first 32 hex of its sha256 (`keeper_files.DIGEST_HEX`). Anything else is never opened. */
const DIGEST_PATTERN = /^[0-9a-f]{32}$/;
/** How many times a read takes the index again when a plan file it names is gone (`keeper_files._READ_TRIES`). */
const READ_TRIES = 3;
/** The document's key order (`keeper_files.DOCUMENT_ORDER`); a head key the list does not name follows them. */
const DOCUMENT_ORDER = ['generated_at', 'home', 'route', 'daemon', 'offpeak_at', 'arcs', 'plans', 'planners', 'cards', 'bugs'];

type KeptEntry = { name: string; digest: string };
type KeptIndex = { document: Record<string, unknown>; plans: KeptEntry[] };

/** Runs `dispatcher keep` once; it rejects when the keeper did not keep a picture. */
export type KeepOnce = () => Promise<void>;

/** Parsed plan files by digest, per home. */
const memories = new Map<string, Map<string, unknown>>();

export async function readKeptDocument(home: string, keepOnce: KeepOnce): Promise<unknown> {
  let index = await readIndex(home);
  if (index === null) {
    await keepOnce();
    index = await readIndex(home);
    if (index === null) throw new Error(`dispatcher keep ran but ${indexPath(home)} is still not there`);
  }
  for (let attempt = 1; ; attempt += 1) {
    const plans = await readPlans(home, index);
    if (plans !== null) return assemble(index, plans);
    if (attempt >= READ_TRIES) throw new Error(`the kept picture under ${home} moved under ${READ_TRIES} reads`);
    const again = await readIndex(home);
    if (again === null) throw new Error(`${indexPath(home)} went away between two reads`);
    index = again;
  }
}

function indexPath(home: string): string {
  return path.join(home, 'status', 'index.json');
}

function planPath(home: string, digest: string): string {
  return path.join(home, 'status', 'plans', `${digest}.json`);
}

/** The index parsed and checked, or null when it is not there. */
async function readIndex(home: string): Promise<KeptIndex | null> {
  const where = indexPath(home);
  const text = await readOrNull(where);
  if (text === null) return null;
  const value: unknown = JSON.parse(text);
  if (!isRecord(value) || value.shape !== INDEX_SHAPE) throw new Error(`${where} is not a shape-${INDEX_SHAPE} index`);
  const { document, plans } = value;
  if (!isRecord(document) || !Array.isArray(plans)) throw new Error(`${where} carries no document or no plan list`);
  return { document, plans: plans.map((entry, at) => entryOf(entry, `${where} plans[${at}]`)) };
}

function entryOf(entry: unknown, where: string): KeptEntry {
  if (!isRecord(entry) || typeof entry.name !== 'string' || typeof entry.digest !== 'string') {
    throw new Error(`${where} is not a {name, digest} entry`);
  }
  if (!DIGEST_PATTERN.test(entry.digest)) throw new Error(`${where} names no plan file: ${JSON.stringify(entry.digest)}`);
  return { name: entry.name, digest: entry.digest };
}

/** Every plan the index names, in its order; null when one of its files is gone. */
async function readPlans(home: string, index: KeptIndex): Promise<unknown[] | null> {
  let memory = memories.get(home);
  if (memory === undefined) {
    memory = new Map();
    memories.set(home, memory);
  }
  const plans: unknown[] = [];
  for (const { digest } of index.plans) {
    let plan = memory.get(digest);
    if (plan === undefined) {
      const text = await readOrNull(planPath(home, digest));
      if (text === null) return null;
      plan = deepFreeze(JSON.parse(text));
      memory.set(digest, plan);
    }
    plans.push(plan);
  }
  const named = new Set(index.plans.map((entry) => entry.digest));
  for (const digest of memory.keys()) if (!named.has(digest)) memory.delete(digest);
  return plans;
}

function assemble(index: KeptIndex, plans: unknown[]): Record<string, unknown> {
  const whole: Record<string, unknown> = { ...index.document, plans };
  const document: Record<string, unknown> = {};
  for (const key of DOCUMENT_ORDER) if (key in whole) document[key] = whole[key];
  for (const [key, value] of Object.entries(whole)) if (!(key in document)) document[key] = value;
  return document;
}

async function readOrNull(target: string): Promise<string | null> {
  try {
    return await readFile(target, 'utf8');
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return null;
    throw error;
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
