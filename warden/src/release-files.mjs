// What the updater does to the disk and the network, one plain function each, so `update.mjs` reads as the
// order of the steps and nothing else: fetch the release, unpack it as the account, point `current` at it,
// and the `pending-update.json` record the launcher judges the new release by.
//
// `launcher.mjs` lives outside every release and imports nothing from here, so it repeats the swap and the
// durable write in a few lines of its own; the file names and the shape of the pending record are the
// contract between the two, named in MAN-7929 and INV-7131.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { log } from './log.mjs';
import { homePaths, readJsonFile, writeFileDurably } from './state.mjs';

/** A release version is `major.minor.patch`: the only shape that may become a directory name under `releases/`. */
export const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/** Whether `version` is older than `than` — both `major.minor.patch`, compared as numbers. */
export function isOlderVersion(version, than) {
  const [mine, theirs] = [version, than].map((text) => text.split('.').map(Number));
  for (let place = 0; place < 3; place += 1) {
    if (mine[place] !== theirs[place]) return mine[place] < theirs[place];
  }
  return false;
}

const DOWNLOAD_TIMEOUT_MS = 120_000;
/** The ceiling on a download whose offer names no usable size: a release is a few MB, and the whole body is held in memory. */
const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;
const TAR_COMPLAINT_CHARS = 200;

/** A failure whose message is the sentence a person reads in `update.progress`; any other error is the updater's own and is worded generically. */
export class UpdateFailure extends Error {}

/** The short word for what went wrong with a request or a process, never the error's message (it can quote a URL). */
function causeOf(error) {
  return error?.cause?.code ?? error?.code ?? error?.name ?? 'unknown';
}

/**
 * Fetches `url` into memory and answers `{ bytes, sha256 }`. A body longer than `expectedSize` (the size the
 * signed offer names) is cut off at once: it cannot be the release that was signed, so it is never read to the end.
 */
export async function downloadRelease(url, expectedSize) {
  const limit = Number.isSafeInteger(expectedSize) && expectedSize > 0 ? Math.min(expectedSize, MAX_DOWNLOAD_BYTES) : MAX_DOWNLOAD_BYTES;
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch (error) {
    throw new UpdateFailure(`Could not download the release (${causeOf(error)})`);
  }
  if (!response.ok || !response.body) throw new UpdateFailure(`Could not download the release (HTTP ${response.status})`);
  const hash = crypto.createHash('sha256');
  const chunks = [];
  let received = 0;
  try {
    for await (const chunk of response.body) {
      received += chunk.length;
      if (received > limit) throw new UpdateFailure('The download does not match its signed hash');
      hash.update(chunk);
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof UpdateFailure) throw error;
    throw new UpdateFailure(`Could not download the release (${causeOf(error)})`);
  }
  return { bytes: Buffer.concat(chunks), sha256: hash.digest('hex') };
}

/** Unpacks the gzipped tar `bytes` into `directory` (made if it is not there), as the account this warden runs as. */
export function extractRelease(bytes, directory) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(directory, { recursive: true });
    // The tar is read from stdin, as enroll.sh reads it: no temporary file is left to clean.
    const tar = spawn('tar', ['-xzf', '-', '-C', directory], { stdio: ['pipe', 'ignore', 'pipe'] });
    let complaint = '';
    tar.stderr.setEncoding('utf8');
    tar.stderr.on('data', (chunk) => {
      if (complaint.length < TAR_COMPLAINT_CHARS) complaint += chunk;
    });
    tar.stdin.on('error', () => {}); // tar gone before it read it all: its exit code says why
    tar.on('error', (error) => reject(new UpdateFailure(`Could not run tar (${causeOf(error)})`)));
    tar.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      log(`tar could not unpack the release into ${directory}: ${complaint.trim().split('\n')[0]}`);
      reject(new UpdateFailure(`The release does not unpack (tar exited ${code})`));
    });
    tar.stdin.end(bytes);
  });
}

/** Points `current` at `releases/<name>` so a reader sees the old release or the new, never neither: a temporary symlink, then a rename over `current`. */
export function swapCurrent(home, name) {
  const { currentLink } = homePaths(home);
  const next = `${currentLink}.next`;
  fs.rmSync(next, { force: true }); // what a swap that died between its two steps left: one link, never a directory
  fs.symlinkSync(path.join('releases', name), next);
  fs.renameSync(next, currentLink);
}

/** Whether `releases/<name>` holds a warden that can start. */
export function releaseIsComplete(home, name) {
  return fs.existsSync(path.join(homePaths(home).releasesDir, name, 'warden', 'src', 'main.mjs'));
}

/** The version a release directory's own `warden/package.json` names, or null when it cannot be read. */
export function releaseVersion(home, name) {
  try {
    const manifest = readJsonFile(path.join(homePaths(home).releasesDir, name, 'warden', 'package.json'));
    return typeof manifest?.version === 'string' ? manifest.version : null;
  } catch {
    // An unreadable manifest is a release that does not say what it is: the caller refuses it.
    return null;
  }
}

/** `pending-update.json` as an object, or null when there is none or it cannot be read (a record that cannot be read judges nothing). */
export function readPending(home) {
  try {
    const record = readJsonFile(homePaths(home).pendingFile);
    return typeof record === 'object' && record !== null && !Array.isArray(record) ? record : null;
  } catch (error) {
    log(`pending-update.json could not be read, so it is ignored: ${error.message}`);
    return null;
  }
}

export function writePending(home, record) {
  writeFileDurably(homePaths(home).pendingFile, `${JSON.stringify(record)}\n`, 0o600);
}

export function removePending(home) {
  fs.rmSync(homePaths(home).pendingFile, { force: true });
}

/** Records that this release started and was welcomed: `hello-ok.json` is the proof the launcher waits for. */
export function writeHelloOk(home, version) {
  writeFileDurably(homePaths(home).helloOkFile, `${JSON.stringify({ version, at: Date.now() })}\n`, 0o600);
}
