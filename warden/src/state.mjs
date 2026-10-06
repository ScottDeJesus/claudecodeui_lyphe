// The warden's home: the one directory it owns on its machine, and everything it keeps there.
//
//   <home>/keys/node.key    the node's ed25519 private key, PKCS8 PEM, 0600 — the source of truth
//   <home>/keys/node.pub    its public half, SPKI PEM, a convenience copy derived from node.key
//   <home>/identity.json    { node, center, centerKey, cert, enrolledAt }, 0600 — written once, by `enroll`
//   <home>/state.json       { seqFloor } — the reserved ceiling of the result sequence (outbox.mjs)
//   <home>/run.json         what the daemon last said about itself — `run` rewrites it on every heartbeat (daemon.mjs)
//
// The home is `CERBERUS_WARDEN_HOME` when set, else `~/.cerberus-warden`, and is forced to 0700:
// the installer extracts the release into it before the warden first runs, so it may pre-exist
// with a looser mode than the keys inside it deserve.
//
// Every write here goes temp file → fsync → rename → fsync of the directory, so a crash leaves the
// old file or the new one and never half of either. That is what lets `state.json` promise that a
// sequence number is never handed out twice.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { log } from './log.mjs';

/** The warden build, read from the package beside `src/` so the version has exactly one home. */
export const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

/** The home directory, resolved when asked: a test of the environment must be able to change it. */
export function homeDir() {
  const configured = process.env.CERBERUS_WARDEN_HOME;
  return configured ? path.resolve(configured) : path.join(os.homedir(), '.cerberus-warden');
}

/** Every file of a home, by name. */
export function homePaths(home = homeDir()) {
  return {
    home,
    keysDir: path.join(home, 'keys'),
    keyFile: path.join(home, 'keys', 'node.key'),
    pubFile: path.join(home, 'keys', 'node.pub'),
    identityFile: path.join(home, 'identity.json'),
    stateFile: path.join(home, 'state.json'),
    runFile: path.join(home, 'run.json'),
  };
}

/** Creates the home (and its `keys` directory) at 0700 and answers its path. */
export function ensureHome(home = homeDir()) {
  const { keysDir } = homePaths(home);
  for (const directory of [home, keysDir]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
  }
  return home;
}

function fsyncDirectory(directory) {
  const descriptor = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

/**
 * Writes `text` to `file` so that a reader (or a restart) sees the old content or the new, whole.
 * The temporary file is created with `mode` already, so a private key is never readable by anyone
 * else even for the instant before the rename.
 */
export function writeFileDurably(file, text, mode) {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    const descriptor = fs.openSync(temporary, 'w', mode);
    try {
      fs.writeSync(descriptor, text);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  fsyncDirectory(path.dirname(file));
}

/** The parsed JSON file, or null when it is not there. A file that is there and unreadable throws. */
function readJsonFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} is not valid JSON (${error.message})`);
  }
}

// --- keys -------------------------------------------------------------------------------------

let loadedKey = null; // { file, key } — the node key is read once per process

/** Whether a node key is already on disk (an earlier enrollment attempt wrote it). */
export function hasNodeKey(home = homeDir()) {
  return fs.existsSync(homePaths(home).keyFile);
}

/** Generates the node's ed25519 key pair and writes both halves. Never call it on a home that holds a key center knows. */
export function generateNodeKeys(home = homeDir()) {
  const { keyFile, pubFile } = homePaths(ensureHome(home));
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  writeFileDurably(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), 0o600);
  writeFileDurably(pubFile, publicKey.export({ type: 'spki', format: 'pem' }), 0o644);
  loadedKey = null;
}

function loadNodeKey(home) {
  const { keyFile } = homePaths(home);
  if (loadedKey?.file !== keyFile) loadedKey = { file: keyFile, key: crypto.createPrivateKey(fs.readFileSync(keyFile)) };
  return loadedKey.key;
}

/** The node's public key as base64 SPKI DER — the spelling `X-Cerberus-Key` carries. */
export function publicKeyBase64(home = homeDir()) {
  return crypto.createPublicKey(loadNodeKey(home)).export({ type: 'spki', format: 'der' }).toString('base64');
}

/** The sha256 hex of the public key's SPKI DER: the fingerprint center's certificate names. */
export function fingerprint(home = homeDir()) {
  return crypto.createHash('sha256').update(Buffer.from(publicKeyBase64(home), 'base64')).digest('hex');
}

/** The base64 signature of `cerberus-connect\n<node>\n<at>` — the proof a connect header carries. */
export function signConnect(node, at, home = homeDir()) {
  const text = `cerberus-connect\n${node}\n${at}`;
  return crypto.sign(null, Buffer.from(text, 'utf8'), loadNodeKey(home)).toString('base64');
}

// --- identity, sequence floor, run record -------------------------------------------------------

/** `{ node, center, centerKey, cert, enrolledAt }`, or null when this home was never enrolled. */
export function readIdentity(home = homeDir()) {
  return readJsonFile(homePaths(home).identityFile);
}

export function writeIdentity(identity, home = homeDir()) {
  writeFileDurably(homePaths(ensureHome(home)).identityFile, `${JSON.stringify(identity, null, 2)}\n`, 0o600);
}

/**
 * `state.json` as an object with a usable `seqFloor`. A missing file is a fresh home (floor 0). A
 * file that cannot be read is logged and treated the same way: the outbox raises its counter past
 * whatever center says it already holds when a link is made, so a lost floor costs a log line and
 * not a swallowed result.
 */
export function readState(home = homeDir()) {
  let parsed = null;
  try {
    parsed = readJsonFile(homePaths(home).stateFile);
  } catch (error) {
    log(`state.json could not be read, starting its sequence floor over: ${error.message}`);
  }
  const state = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  return { ...state, seqFloor: Number.isSafeInteger(state.seqFloor) && state.seqFloor >= 0 ? state.seqFloor : 0 };
}

/** Merges `patch` into `state.json` and fsyncs it, so the new content is on disk when this returns. */
export function writeState(patch, home = homeDir()) {
  const next = { ...readState(home), ...patch };
  writeFileDurably(homePaths(ensureHome(home)).stateFile, `${JSON.stringify(next)}\n`, 0o600);
  return next;
}

/** Replaces `run.json` with `record`, the daemon's account of itself. Readable by its owner only, like everything else in the home. */
export function writeRun(record, home = homeDir()) {
  writeFileDurably(homePaths(ensureHome(home)).runFile, `${JSON.stringify(record)}\n`, 0o600);
}

/** What the daemon last wrote about itself, with when it wrote it; null when it never has. */
export function readRun(home = homeDir()) {
  const { runFile } = homePaths(home);
  const run = readJsonFile(runFile);
  return run === null ? null : { run, writtenAt: fs.statSync(runFile).mtimeMs };
}

// --- the machine --------------------------------------------------------------------------------

function readMachineId() {
  try {
    return fs.readFileSync('/etc/machine-id', 'utf8').split('\n')[0].trim() || null;
  } catch {
    // No /etc/machine-id (a container, another OS): the machine simply has no id to report.
    return null;
  }
}

/** What this machine is, sent inside `hello` (`CerberusHostFacts`). */
export function hostFacts() {
  return {
    hostname: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    machineId: readMachineId(),
    cpus: os.availableParallelism(),
    memMb: Math.round(os.totalmem() / (1024 * 1024)),
  };
}
