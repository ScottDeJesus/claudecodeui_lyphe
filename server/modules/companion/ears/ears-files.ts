import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

/**
 * HER EARS' FILES: the models the page's worker loads to hear her name, served from CloudCLI's own server so that every byte
 * the ears load comes from here and nothing is asked of a third party by the page. A file is fetched ONCE from Hugging Face at
 * its pinned revision the first time anyone asks for it, checked against the SHA-256 written below, and kept:
 *
 *   <earsRoot()>/<repo>/<path>        e.g. onnx-community/silero-vad/onnx/model.onnx
 *
 * That layout is exactly the one transformers.js reads under a `localModelPath`, so a Node replay points it at the root.
 * The manifest is the whole list of what may be named: `earsFile` looks a request up in it by string equality, so no path
 * outside it can reach the disk or the network. There is no install step; the first page that arms downloads about 69 MB.
 */

/** One file the page's ears load: the model repository, its pinned revision, the file's path in it, its size and its SHA-256. Consumed by `ears.routes.ts` (through `earsFile`) and the showings. */
export type EarsFile = { repo: string; revision: string; path: string; bytes: number; sha256: string };

const MOONSHINE_REPO = 'onnx-community/moonshine-base-ONNX';
const MOONSHINE_REVISION = 'b1e9b6aae3c3c7298f10c3798393fdf38e8fbbad';
const SILERO_REPO = 'onnx-community/silero-vad';
const SILERO_REVISION = 'e71cae966052b992a7eca6b17738916ce0eca4ec';

/**
 * The pinned manifest: what the page may load and nothing else. `bytes` and `sha256` were measured on a first download of
 * each file at its revision. A revision that moves is a new entry with new numbers; the old file on disk then fails its hash
 * and is fetched again. Consumed by `earsFile` and by the showings.
 */
export const EARS_FILES: readonly EarsFile[] = [
  { repo: MOONSHINE_REPO, revision: MOONSHINE_REVISION, path: 'config.json', bytes: 922, sha256: 'fab7241d1e9fc6c2370c4c6dfb5da79bb54d67ed9ab6b507ac51d29d2abe01d1' },
  { repo: MOONSHINE_REPO, revision: MOONSHINE_REVISION, path: 'generation_config.json', bytes: 147, sha256: 'f9b3f711b57be7def2e50a8942f64f36ee0a55fad5b84ff93a687b6c5bcc1d44' },
  { repo: MOONSHINE_REPO, revision: MOONSHINE_REVISION, path: 'preprocessor_config.json', bytes: 128, sha256: 'fa43a7017ef85cd1d0fba0d9aae77c8adb16990ae6f11115631f41ec5d8aa679' },
  { repo: MOONSHINE_REPO, revision: MOONSHINE_REVISION, path: 'tokenizer.json', bytes: 3761754, sha256: '7b913404bdd039af4756783218af4440bc07fb7d6d8258d677e34f95b3ec416f' },
  { repo: MOONSHINE_REPO, revision: MOONSHINE_REVISION, path: 'tokenizer_config.json', bytes: 135735, sha256: 'edaee394565d428ea98a663ae7209cdcfeefc5585c42d7a570ff7c986df2cd15' },
  { repo: MOONSHINE_REPO, revision: MOONSHINE_REVISION, path: 'onnx/encoder_model_quantized.onnx', bytes: 20513063, sha256: '1dd9ab0a7f987113d30affcba5a068d11c8f90fa0223caa3e491ade431ad9751' },
  { repo: MOONSHINE_REPO, revision: MOONSHINE_REVISION, path: 'onnx/decoder_model_merged_quantized.onnx', bytes: 42498870, sha256: 'cc9f3cd6698a369c6008b41aa60aa3fb3322e7f03c9bdf19d8e6b7200afca4f3' },
  { repo: SILERO_REPO, revision: SILERO_REVISION, path: 'onnx/model.onnx', bytes: 2243022, sha256: 'a4a068cd6cf1ea8355b84327595838ca748ec29a25bc91fc82e6c299ccdc5808' },
];

/** The answer of `earsFile` and `keepEarsFile`: the file's place on disk, or the status and the sentence of a refusal. */
type EarsFileAnswer = { ok: true; location: string } | { ok: false; status: 404 | 502; sentence: string };

/** Where the pinned revisions are fetched from: Hugging Face's `resolve/<revision>/<path>` answers the bytes (after a redirect to its CDN). */
const HUGGING_FACE = 'https://huggingface.co';

/**
 * Where the files live: `COMPANION_EARS_DIR`, else `~/.cloudcli/companion-ears`, always ABSOLUTE. Read on each call, so a
 * probe may point it elsewhere. Consumed by the showings and the Node replay of the ears, which point transformers.js at it.
 */
export function earsRoot(): string {
  return path.resolve(process.env.COMPANION_EARS_DIR || path.join(os.homedir(), '.cloudcli', 'companion-ears'));
}

/** The manifest entry for a repository and a path, by string equality; null for anything else. */
function manifestEntry(repo: string, filePath: string): EarsFile | null {
  return EARS_FILES.find((entry) => entry.repo === repo && entry.path === filePath) ?? null;
}

/**
 * Where an entry lives, checked to lie strictly inside the root. An entry from the manifest always does; a scratch entry
 * handed to `keepEarsFile` by a showing is held to the same gate, so no entry can name a place outside the root.
 */
function locationOf(entry: EarsFile): string {
  const root = earsRoot();
  const target = path.resolve(root, entry.repo, entry.path);
  const relative = path.relative(root, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`the path ${target} is not inside the ears root`);
  }
  return target;
}

/** The SHA-256 of a file on disk, streamed so a 40 MB model is never held whole; null when the file is not there. */
async function sha256OfFile(file: string): Promise<string | null> {
  const hash = createHash('sha256');
  try {
    await pipeline(createReadStream(file), hash);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return hash.digest('hex');
}

/** A file's size, or null when it is not there. */
async function sizeOfFile(file: string): Promise<number | null> {
  try {
    return (await fs.stat(file)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** How long a fetch may go with nothing arriving (no headers, or no next chunk) before it is given up as a refusal, rather than left to the transport's own five minutes. */
const FETCH_IDLE_MS = 60_000;

/** An error as a sentence's parenthesis: its message, and the cause a failed `fetch` keeps apart (`fetch failed` alone does not say ECONNREFUSED or ENOTFOUND). */
function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if (!(error.cause instanceof Error)) return error.message;
  const code = (error.cause as NodeJS.ErrnoException).code;
  const cause = code && !error.cause.message.includes(code) ? `${code} ${error.cause.message}`.trim() : error.cause.message;
  return cause === '' ? error.message : `${error.message}: ${cause}`;
}

/** Removes a partial download; a part that cannot be removed is logged and left, so the cleanup never hides the failure that called it. */
async function discardPart(part: string): Promise<void> {
  try {
    await fs.rm(part, { force: true });
  } catch (error) {
    console.error(`[companion] ears: the partial download ${part} could not be removed`, error);
  }
}

/** A refusal: one line in the log, and the 502 the route carries. */
function refuse(entry: EarsFile, sentence: string): EarsFileAnswer {
  console.error(`[companion] ears: refused ${entry.repo}/${entry.path}: ${sentence}`);
  return { ok: false, status: 502, sentence };
}

/**
 * Streams Hugging Face's `resolve/<revision>/<path>` (redirects followed) into a part beside the file, hashing as it goes. A
 * matching SHA-256 renames the part into place; a mismatch deletes the part and refuses, naming the file. The part is named
 * for THIS call (`<file>.<uuid>.part`): `fetchesInFlight` lets one download run at a time within a process, but a second
 * process (a Node replay on the live root) may fetch the same file, and two writers of one part name truncate each other and
 * rename a file with holes. With a part each, the atomic rename only ever replaces a good file with an identical good one.
 * A fetch that goes `FETCH_IDLE_MS` with nothing arriving is aborted and refused: the timer is the transport's own event, reset
 * by every chunk, not a poll of anything.
 */
async function download(entry: EarsFile, location: string): Promise<EarsFileAnswer> {
  const label = `${entry.repo}/${entry.path}`;
  const part = `${location}.${randomUUID()}.part`;
  const started = Date.now();
  const stall = new AbortController();
  let idleTimer: NodeJS.Timeout | undefined;
  const armIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => stall.abort(new Error(`nothing arrived for ${FETCH_IDLE_MS / 1000} s`)), FETCH_IDLE_MS);
  };
  try {
    await fs.mkdir(path.dirname(location), { recursive: true });
    armIdleTimer();
    const response = await fetch(`${HUGGING_FACE}/${entry.repo}/resolve/${entry.revision}/${entry.path}`, { redirect: 'follow', signal: stall.signal });
    if (!response.ok || response.body === null) {
      return refuse(entry, `Hugging Face answered ${response.status} when ${label} was fetched, so her ears' file is not here yet.`);
    }
    const hash = createHash('sha256');
    let received = 0;
    const hashing = async function* (chunks: AsyncIterable<Buffer>) {
      for await (const chunk of chunks) {
        armIdleTimer();
        hash.update(chunk);
        received += chunk.length;
        yield chunk;
      }
    };
    await pipeline(Readable.fromWeb(response.body as WebReadableStream<Uint8Array>), hashing, createWriteStream(part));
    if (hash.digest('hex') !== entry.sha256) {
      await discardPart(part);
      return refuse(entry, `${label} did not match its pinned SHA-256, so it was not kept.`);
    }
    await fs.rename(part, location);
    console.log(`[companion] ears: fetched ${label} (${received} B) in ${Date.now() - started} ms`);
    return { ok: true, location };
  } catch (error) {
    await discardPart(part);
    return refuse(entry, `${label} could not be fetched from Hugging Face (${describeFailure(error)}), so her ears' file is not here yet.`);
  } finally {
    clearTimeout(idleTimer);
  }
}

/** The downloads out right now, by file: a second ask while one is out waits on the same promise. */
const fetchesInFlight = new Map<string, Promise<EarsFileAnswer>>();

/** The files whose bytes this process has already hashed (or fetched and checked), so a served file is hashed once per process. */
const verifiedThisProcess = new Set<string>();

/**
 * Checks what is on disk before it is first served: a file whose SHA-256 is the entry's is kept as it is; any other is
 * deleted, and the caller fetches again. True when the file on disk is good.
 */
async function verifyOnDisk(entry: EarsFile, location: string): Promise<boolean> {
  // A file hashed already is trusted while it is still there at its size; one removed or cut since is hashed (and fetched) again.
  if (verifiedThisProcess.has(location) && (await sizeOfFile(location)) === entry.bytes) return true;
  const found = await sha256OfFile(location);
  if (found === null) return false;
  if (found === entry.sha256) {
    verifiedThisProcess.add(location);
    return true;
  }
  console.error(`[companion] ears: ${entry.repo}/${entry.path} on disk did not match its pinned SHA-256, so it was deleted and is fetched again`);
  await fs.rm(location, { force: true });
  return false;
}

/**
 * One entry on disk, fetched and checked if it is not already, and kept. One download per file at a time. Consumed by
 * `earsFile` for a manifest entry, and by the showing that hands it a scratch entry with a wrong SHA-256 to see the refusal.
 */
export async function keepEarsFile(entry: EarsFile): Promise<EarsFileAnswer> {
  let location: string;
  try {
    location = locationOf(entry);
  } catch (error) {
    return refuse(entry, (error as Error).message);
  }
  const out = fetchesInFlight.get(location);
  if (out) return out;

  // A disk fault (a kept file that cannot be read, a root that is a plain file) is a refusal with its sentence, as a refused fetch is.
  const work = (async (): Promise<EarsFileAnswer> => {
    try {
      if (await verifyOnDisk(entry, location)) return { ok: true, location };
      const answer = await download(entry, location);
      if (answer.ok) verifiedThisProcess.add(location);
      return answer;
    } catch (error) {
      return refuse(entry, `${entry.repo}/${entry.path} could not be kept on disk (${describeFailure(error)}), so her ears' file is not here yet.`);
    }
  })().finally(() => fetchesInFlight.delete(location));
  fetchesInFlight.set(location, work);
  return work;
}

/**
 * The file on disk for a repository and a path of the manifest: fetched from Hugging Face's `resolve/<revision>/<path>` the
 * first time it is asked for, checked against its SHA-256 (a mismatch is deleted and refused), and kept; one download per
 * file at a time. A name the manifest does not hold is 404, and nothing is fetched for it. Consumed by `ears.routes.ts`.
 */
export async function earsFile(repo: string, filePath: string): Promise<EarsFileAnswer> {
  const entry = manifestEntry(repo, filePath);
  if (entry === null) return { ok: false, status: 404, sentence: 'Her ears do not load that file.' };
  return keepEarsFile(entry);
}
