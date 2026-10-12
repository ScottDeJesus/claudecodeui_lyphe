// The launcher: what systemd runs, and what runs the warden — `node ~/.cerberus-warden/launcher.mjs`.
//
// It lives OUTSIDE every release (`enroll.sh` copies it to the home from each release it installs) and imports
// nothing from one, so a release that cannot start cannot take its own rescue down with it. For the same reason
// it repeats the few lines it shares with `update.mjs` (the durable write, the `current` swap) rather than import them.
//
//   RUN        spawns `node <home>/current/warden/src/main.mjs run` with this process's stdio (the journal), forwards
//              SIGTERM and SIGINT to it, and on any normal exit exits with the child's own code: the unit's
//              `Restart=always` starts the next launcher, which starts whatever `current` is by then.
//   UPDATE     a child that exits 75 has swapped `current` for a release it fetched and checked
//              (`update.mjs`) and left `pending-update.json { updateId, from, to, swappedAt }`. The launcher starts
//              the new `current` at once, UNDER PROBATION: until `hello-ok.json` names `pending.to` (written by the
//              release after a `welcome`, so center has let it in), a child exit — or 60 s since `swappedAt` — is
//              a failed release. Then `current` goes back to `releases/<from>`, the pending record is rewritten with
//              `failed` and the reason, and the old release is started; its `hello` carries the reason to center.
//   RESUME     the probation is the pending file and the clock in it, so a launcher that systemd restarted
//              mid-probation (or a machine that rebooted) finds the same trial: inside its 60 s it goes on with what
//              is left of them, past them it rolls back. A record that already says `failed` is not tried again, and a
//              record is a trial only while `current` names the release it is about (see `readTrial`).
//
// A release counts as welcomed only by a `hello-ok.json` written AT OR AFTER the swap: one left by an earlier run of
// the same version proves nothing. Release names are checked as one path segment before a path is built from them
// (they are `1.2.3` in production; the file names, not the version shape, are the contract with `update.mjs`).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PROBATION_MS = 60_000;
const RESTART_EXIT_CODE = 75;
const KILL_AFTER_TERM_MS = 5000;
const RELEASE_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

const home = process.env.CERBERUS_WARDEN_HOME ? path.resolve(process.env.CERBERUS_WARDEN_HOME) : path.join(os.homedir(), '.cerberus-warden');
const currentLink = path.join(home, 'current');
const pendingFile = path.join(home, 'pending-update.json');
const helloOkFile = path.join(home, 'hello-ok.json');
const entryPoint = path.join(currentLink, 'warden', 'src', 'main.mjs');

let child = null;
let stopping = false; // a SIGTERM or SIGINT arrived: nothing is judged any more, the child's end is the launcher's end
let reverting = false; // a rollback is in flight: the child it kills is not a second failure
let probation = null; // { pending, timer, watcher } while a release that has not yet been welcomed is on trial

function say(message) {
  console.log(`[launcher] ${message}`);
}

/** The parsed JSON file, or null when it is absent or unreadable (an unreadable record judges nothing). */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') say(`${path.basename(file)} cannot be read (${error.message}); ignoring it`);
    return null;
  }
}

/** Temp file, fsync, rename: a reader (or a crash) sees the old record or the new one, whole. */
function writeJsonDurably(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    const descriptor = fs.openSync(temporary, 'w', 0o600);
    try {
      fs.writeSync(descriptor, `${JSON.stringify(value)}\n`);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

/** `current` → `releases/<name>`, by a temporary symlink renamed over it: never a moment with no `current`. */
function swapCurrent(name) {
  const next = `${currentLink}.next`;
  fs.rmSync(next, { force: true }); // a leftover link of a swap that died half way: one symlink, never a directory
  fs.symlinkSync(path.join('releases', name), next);
  fs.renameSync(next, currentLink);
}

/** The release `current` points at, for the log. */
function currentName() {
  try {
    return path.basename(fs.readlinkSync(currentLink));
  } catch {
    return 'unknown';
  }
}

// --- the trial -----------------------------------------------------------------------------------------

/**
 * The update on trial: a pending record that is whole, has not been taken back, and is about the release `current`
 * names; else null. A record about a release `current` does not name is not a trial — judging it would roll back
 * whatever `current` is instead (an `enroll.sh --refresh` inside the minute) for an update that never ran.
 */
function readTrial() {
  const pending = readJson(pendingFile);
  if (typeof pending !== 'object' || pending === null || pending.failed !== undefined) return null;
  const whole = [pending.from, pending.to].every((name) => typeof name === 'string' && RELEASE_NAME.test(name)) && Number.isFinite(pending.swappedAt);
  if (!whole) {
    say('pending-update.json is not a whole record; ignoring it');
    return null;
  }
  const running = currentName();
  if (running === pending.to) return pending;
  if (running === pending.from) {
    // The swap never happened, or a rollback died between its two steps: `current` already is the old release, so only the word is owed.
    try {
      writeJsonDurably(pendingFile, { ...pending, failed: pending.to, reason: `${pending.to} was never started` });
      say(`${pending.to} was never started; current is ${running}`);
    } catch (error) {
      say(`could not record that ${pending.to} was never started: ${error.message}`);
    }
    return null;
  }
  say(`pending-update.json is about ${pending.to} but current is ${running}; ignoring it`);
  return null;
}

function isWelcomed(pending) {
  const proof = readJson(helloOkFile);
  return proof?.version === pending.to && Number.isFinite(proof.at) && proof.at >= pending.swappedAt;
}

function endProbation() {
  if (probation === null) return;
  clearTimeout(probation.timer);
  probation.watcher?.close();
  probation = null;
}

/** Ends the probation the moment the release has been welcomed; true when it has. */
function passIfWelcomed() {
  if (probation === null || !isWelcomed(probation.pending)) return false;
  say(`${probation.pending.to} said hello; probation over`);
  endProbation();
  return true;
}

function beginProbation(pending) {
  // swappedAt is the updater's clock: a clock stepped back must not stretch the trial past its minute.
  const left = Math.min(PROBATION_MS, pending.swappedAt + PROBATION_MS - Date.now());
  const timer = setTimeout(() => {
    if (!passIfWelcomed()) revert(pending, 'no hello within 60 s');
  }, left);
  let watcher = null;
  try {
    // The release writes hello-ok.json by a rename into this directory: the event that ends the trial early.
    watcher = fs.watch(home, (_event, name) => {
      if (name === null || name === path.basename(helloOkFile)) passIfWelcomed();
    });
    watcher.on('error', () => {}); // the timer is the net; a watcher that fails only costs the early end
  } catch (error) {
    say(`cannot watch ${home} (${error.code ?? error.message}); the trial ends at its deadline`);
  }
  probation = { pending, timer, watcher };
}

/** Stops the child, if there is one: SIGTERM, then SIGKILL after 5 s. Resolves once it has exited. */
function stopChild() {
  return new Promise((resolve) => {
    if (child === null) {
      resolve();
      return;
    }
    const target = child;
    const killer = setTimeout(() => target.kill('SIGKILL'), KILL_AFTER_TERM_MS);
    target.once('exit', () => {
      clearTimeout(killer);
      resolve();
    });
    target.kill('SIGTERM');
  });
}

/** Takes a failed release back: `current` to the one it replaced, the record rewritten with why, the old release started. */
async function revert(pending, reason) {
  reverting = true;
  endProbation();
  await stopChild();
  const kept = fs.existsSync(path.join(home, 'releases', pending.from, 'warden', 'src', 'main.mjs'));
  try {
    // A `current` that names a release which is not on disk starts nothing, every five seconds, for ever: with no release to go back to it stays where it is.
    if (kept) swapCurrent(pending.from);
    // After the swap, never before: a crash between the two leaves `current` on the old release and a record that readTrial finishes as failed.
    writeJsonDurably(pendingFile, { ...pending, failed: pending.to, reason: kept ? reason : `${reason}; ${pending.from} is not on disk to go back to` });
  } catch (error) {
    say(`could not take ${pending.to} back to ${pending.from}: ${error.message}`);
    process.exit(1); // the unit starts a new launcher in 5 s, which finds the same trial and tries again
  }
  say(kept ? `rolled back to ${pending.from}: ${reason}` : `cannot roll back: releases/${pending.from} is not on disk; ${pending.to} stays current (${reason})`);
  reverting = false;
  launch(null);
}

// --- the child -----------------------------------------------------------------------------------------

function exitCodeOf(code, signal) {
  return code ?? 128 + (os.constants.signals[signal] ?? 0);
}

function onChildEnd(ended, code, signal) {
  if (child !== ended) return;
  child = null;
  if (reverting) return; // a rollback stopped it on purpose
  const exitCode = exitCodeOf(code, signal);
  passIfWelcomed();
  if (probation !== null && !stopping) {
    const { pending } = probation;
    const how = signal ? `was killed by ${signal}` : `exited with code ${code}`;
    revert(pending, `${pending.to} ${how} on start`);
    return;
  }
  if (exitCode === RESTART_EXIT_CODE && !stopping) {
    const pending = readTrial();
    if (pending !== null) {
      launch(pending);
      return;
    }
    // A release that exits 75 with no update behind it would be started again at once, dozens of times a second: the unit's 5 s pace it.
    say('the warden exited 75 with no update on trial; leaving the restart to the unit');
    process.exit(exitCode);
  }
  say(`the warden exited with code ${exitCode}`);
  process.exit(exitCode);
}

/** Starts `current`; `pending` is the update it is on trial for, or null. */
function launch(pending) {
  if (stopping) process.exit(0);
  if (pending !== null) beginProbation(pending);
  const started = spawn(process.execPath, [entryPoint, 'run'], { stdio: 'inherit' });
  child = started;
  say(`started ${currentName()} (pid ${started.pid})${pending ? ' on probation until it says hello, 60 s from the swap' : ''}`);
  started.on('exit', (code, signal) => onChildEnd(started, code, signal));
  // A spawn that failed never exits: it is the same end as a release that dies on start.
  started.on('error', (error) => {
    say(`could not start ${entryPoint}: ${error.code ?? error.message}`);
    onChildEnd(started, 1, null);
  });
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    stopping = true;
    if (child === null) process.exit(0);
    else child.kill(signal);
  });
}

// --- start ---------------------------------------------------------------------------------------------

const trial = readTrial();
if (trial !== null && !isWelcomed(trial)) {
  if (trial.swappedAt + PROBATION_MS <= Date.now()) {
    say(`started with ${trial.to} on trial past its 60 s`);
    revert(trial, 'no hello within 60 s');
  } else {
    say(`resuming the probation of ${trial.to}`);
    launch(trial);
  }
} else {
  launch(null);
}
