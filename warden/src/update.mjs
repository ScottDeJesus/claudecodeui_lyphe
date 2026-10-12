// The updater: the warden replaces itself when center offers it a newer release, and tells center each step.
//
// `update.offer { updateId, version, url, sha256, size, note }` arrives signed — the link has already checked
// that — so the SHA-256 in it is center's own word about the bytes. Every step below is one reliable
// `update.progress { updateId, step, text }`, and a step that fails is the offer's whole outcome (`failed`):
//
//   SAME       the running version: `verified` "Already on <v>", and nothing else happens. An OLDER version is `failed`
//              "This warden is on <running> and does not go back to <v>": an offer is signed but carries no freshness.
//   WAIT       while a fix (a run, a diagnosis) is going the warden is not restarted: `waiting`, re-sent when the
//              count changes, and `failed` after 10 minutes. Woken by the runner's own change event, never by a timer.
//   UPLOAD     `uploading`, the fetch, and the SHA-256 against the offer's: a mismatch is `failed` and nothing is
//              written. Then `verified`.
//   SWAP       the tarball is unpacked as this account into `releases/<v>/` (the running release's own directory must
//              still be there: it is the rollback), `pending-update.json` is written and `current` is swapped by a
//              temporary symlink and a rename. `swapping`.
//   RESTART    `restarting`, up to 2 s for center's ack of that frame, then the process ends with 75 — the launcher's
//              word for "start the new `current` under probation" (`launcher.mjs`).
//
// AFTER A START. `hello.update` is read from `pending-update.json` once, when the daemon is built: the release the
// launcher kept (`{ updateId, from, to }`), or, after the launcher took a bad one back, the old release with
// `{ updateId, failed, reason }`. Every `welcome` makes the running release write `hello-ok.json` (the launcher's
// proof that it started) and, the first time, delete the pending record: a welcome only answers a hello, and every
// hello of this process carried it until then.
import path from 'node:path';

import { log } from './log.mjs';
import {
  UpdateFailure,
  VERSION_PATTERN,
  downloadRelease,
  extractRelease,
  readPending,
  isOlderVersion,
  releaseIsComplete,
  releaseVersion,
  removePending,
  swapCurrent,
  writeHelloOk,
  writePending,
} from './release-files.mjs';
import { homePaths, readIdentity, version as runningVersion } from './state.mjs';

const WAIT_LIMIT_MS = 10 * 60 * 1000;
const ACK_WAIT_MS = 2000;
/** The exit code the launcher reads as "I swapped `current`; start it and judge it". */
export const RESTART_EXIT_CODE = 75;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function fixes(count) {
  return count === 1 ? '1 fix' : `${count} fixes`;
}

/** `2.1 MB` — decimal megabytes, as a download is reckoned; under one megabyte, kilobytes. Empty when the offer names no size. */
function sizeWords(size) {
  if (!Number.isSafeInteger(size) || size <= 0) return '';
  return ` · ${size >= 1_000_000 ? `${(size / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1000))} KB`}`;
}

/** The offer's url as an absolute http(s) address (a path is read against the center this node enrolled with), or null. */
function offerAddress(url, home) {
  if (typeof url !== 'string' || url === '') return null;
  try {
    const address = new URL(url, readIdentity(home)?.center);
    return address.protocol === 'http:' || address.protocol === 'https:' ? address.href : null;
  } catch {
    // Not a URL, or a path with no center to resolve it against.
    return null;
  }
}

/**
 * @param {{
 *   link: { on(type: string, handler: Function): () => void, send(type: string, body: object, options?: { reliable?: boolean }): { seq: number|null }|undefined },
 *   home: string,
 *   activeWork: () => { runs?: string[], diags?: string[] },
 *   onWorkChange?: (listener: () => void) => () => void,
 *   exit?: (code: number) => void,
 * }} options `activeWork` is what keeps the warden from restarting under a fix; `onWorkChange` registers a listener
 * for every change of it and answers its remover — without one a waiting update is woken only by the 10-minute limit.
 * `exit` ends the process: `process.exit` unless the daemon passes its clean stop.
 */
export function createUpdater({ link, home, activeWork, onWorkChange, exit = (code) => process.exit(code) }) {
  let updating = null; // the updateId being worked on: a second offer waits for no one
  let exiting = false; // set once the process has been asked to end: it takes no further offer
  let inherited = readInheritedUpdate();

  /** The pending record this process was started after, trimmed to what `hello.update` says; null when there is none worth saying. */
  function readInheritedUpdate() {
    const record = readPending(home);
    if (record === null) return null;
    const named = typeof record.updateId === 'string' && record.updateId !== '';
    const rolledBack = named && typeof record.failed === 'string' && typeof record.reason === 'string';
    const kept = named && !rolledBack && typeof record.from === 'string' && record.to === runningVersion;
    if (rolledBack) return { updateId: record.updateId, failed: record.failed, reason: record.reason };
    if (kept) return { updateId: record.updateId, from: record.from, to: record.to };
    // A record this release neither is the new half of nor was put back by: the swap it described never happened, or something newer replaced it.
    log(`ignoring a pending update of ${record.updateId ?? 'no id'} to ${record.to ?? 'no version'}: this warden is ${runningVersion}`);
    removePending(home);
    return null;
  }

  function progress(updateId, step, text) {
    log(`update ${updateId}: ${step} — ${text}`);
    try {
      return link.send('update.progress', { updateId, step, text }, { reliable: true });
    } catch (error) {
      // A full disk cannot number the frame: the update goes on, center's three-minute silence rule is its net.
      log(`could not queue an update.progress frame: ${error?.code ?? error?.name ?? 'unknown'}`);
      return undefined;
    }
  }

  function workCount() {
    const work = activeWork();
    return (work.runs?.length ?? 0) + (work.diags?.length ?? 0);
  }

  /** Resolves true when no fix is going; false (after saying `failed`) when 10 minutes passed with one still going. */
  function waitForIdle(updateId) {
    return new Promise((resolve) => {
      let reported = 0;
      let stopListening = () => {};
      const finish = (idle) => {
        clearTimeout(limit);
        stopListening();
        resolve(idle);
      };
      const limit = setTimeout(() => {
        progress(updateId, 'failed', `Gave up waiting for ${fixes(reported)} to finish`);
        finish(false);
      }, WAIT_LIMIT_MS);
      const check = () => {
        const count = workCount();
        if (count === 0) {
          finish(true);
        } else if (count !== reported) {
          reported = count;
          progress(updateId, 'waiting', `Waiting for ${fixes(count)} to finish`);
        }
      };
      stopListening = onWorkChange?.(check) ?? stopListening;
      check();
    });
  }

  /** Resolves when center acks frame `seq`, or after 2 s, whichever is first. */
  function acked(seq) {
    if (!Number.isSafeInteger(seq)) return Promise.resolve();
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        stopListening();
        resolve();
      };
      const timer = setTimeout(finish, ACK_WAIT_MS);
      const stopListening = link.on('ack', (body) => {
        if (body.upto >= seq) finish();
      });
    });
  }

  /** The tarball, checked and put in place under `releases/`; throws an `UpdateFailure` for anything wrong with it. */
  async function install(offer, address) {
    progress(offer.updateId, 'uploading', `Uploading warden ${offer.version}${sizeWords(offer.size)}`);
    const { bytes, sha256 } = await downloadRelease(address, offer.size);
    if (sha256 !== offer.sha256) throw new UpdateFailure('The download does not match its signed hash');
    progress(offer.updateId, 'verified', 'Signature checks out');
    await extractRelease(bytes, path.join(homePaths(home).releasesDir, offer.version));
    if (!releaseIsComplete(home, offer.version)) throw new UpdateFailure('The release carries no warden/src/main.mjs');
    if (releaseVersion(home, offer.version) !== offer.version) throw new UpdateFailure(`The release is not warden ${offer.version}`);
  }

  async function runOffer(offer) {
    const { updateId } = offer;
    if (offer.version === runningVersion) {
      progress(updateId, 'verified', `Already on ${runningVersion}`);
      return;
    }
    // A signed offer carries no freshness: one recorded long ago and replayed must not move the node backwards.
    if (isOlderVersion(offer.version, runningVersion)) throw new UpdateFailure(`This warden is on ${runningVersion} and does not go back to ${offer.version}`);
    if (!(await waitForIdle(updateId))) return;
    const address = offerAddress(offer.url, home);
    if (address === null) throw new UpdateFailure('The offer carries no address to fetch');
    await install(offer, address);
    // The upload took seconds: a fix may have started in them, and the restart would take it down.
    if (!(await waitForIdle(updateId))) return;
    // The running release's directory is the rollback; an update with nothing to roll back to is refused, not promised.
    if (!releaseIsComplete(home, runningVersion)) throw new UpdateFailure(`No kept copy of ${runningVersion} to roll back to`);

    progress(updateId, 'swapping', `Swapping the binary · ${runningVersion} kept for rollback`);
    writePending(home, { updateId, from: runningVersion, to: offer.version, swappedAt: Date.now() });
    try {
      swapCurrent(home, offer.version);
    } catch (error) {
      removePending(home); // nothing was swapped: no launcher may judge a release that never ran
      throw error;
    }
    const sent = progress(updateId, 'restarting', 'Restarting the warden');
    await acked(sent?.seq);
    log(`update ${updateId}: exiting ${RESTART_EXIT_CODE} for the launcher to start ${offer.version}`);
    exiting = true;
    exit(RESTART_EXIT_CODE);
  }

  /** `update.offer`: refuses a malformed offer by its `updateId` when it has one, then runs the steps. */
  async function onOffer(body) {
    const updateId = body.updateId;
    if (typeof updateId !== 'string' || updateId === '') {
      log('ignoring an update.offer without an updateId');
      return;
    }
    const usable = VERSION_PATTERN.test(String(body.version)) && SHA256_PATTERN.test(String(body.sha256));
    if (!usable) {
      progress(updateId, 'failed', 'The offer carries no usable version and hash');
      return;
    }
    if (updating !== null) {
      if (updating !== updateId) progress(updateId, 'failed', 'Another update is already running');
      return;
    }
    updating = updateId;
    try {
      await runOffer(body);
    } catch (error) {
      log(`update ${updateId} failed: ${error?.message ?? error}`);
      progress(updateId, 'failed', error instanceof UpdateFailure ? error.message : `The update stopped (${error?.code ?? error?.name ?? 'unknown'})`);
    } finally {
      if (!exiting) updating = null;
    }
  }

  /** Every `welcome`: the proof this release started, and the end of the update record a hello has now carried. */
  function onWelcome() {
    try {
      writeHelloOk(home, runningVersion);
    } catch (error) {
      log(`could not write hello-ok.json: ${error.message}`);
    }
    if (inherited === null) return;
    try {
      removePending(home);
      inherited = null;
    } catch (error) {
      log(`could not remove pending-update.json: ${error.message}`);
    }
  }

  link.on('update.offer', onOffer);
  link.on('welcome', onWelcome);

  return {
    /** `hello.update`: the update this process was started after, or undefined. */
    helloUpdate() {
      return inherited ?? undefined;
    },
  };
}
