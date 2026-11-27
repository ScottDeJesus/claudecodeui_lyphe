// The production client's build watcher: runs scripts/prod-client-build.sh when a build input is saved.
//
// The script owns the list of inputs (`--inputs`) and the decision whether anything changed since the
// last build's start; this process only decides WHEN to ask. Each directory input is watched as a tree
// (deploy/tree-watch/tree-watch.mjs); the repo root is watched for every input's name, which covers the
// file inputs and a directory input created or replaced whole. A burst of saves runs the script once,
// QUIET_MS after its last event and never later than MAX_WAIT_MS after its first. The script also runs
// once at this process's start, so whatever landed while it was down is built on the way up; systemd's
// Restart=always is what brings it back. One build at a time: a burst that settles during a build runs
// the script once more when that build ends. SIGTERM stops the watching and exits once a running build
// has ended (the unit's KillMode=mixed sends it to this process alone).
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createBurst, watchTree } from '../tree-watch/tree-watch.mjs';

const REPO = path.resolve(import.meta.dirname, '../..');
const BUILD_SCRIPT = path.join(REPO, 'scripts/prod-client-build.sh');
// Twenty quiet seconds: a builder's multi-file edit is one build, and :5184 trails a save by ~50 s.
const QUIET_MS = 20_000;
// A stream of saves that never pauses still reaches :5184 every two minutes at most.
const MAX_WAIT_MS = 120_000;
// Editor droppings that are not inputs: vim swap and backup files, Emacs lock and autosave names,
// the temp name an atomic write lands under.
const DROPPING_SUFFIXES = ['~', '.swp', '.tmp'];
const DROPPING_PREFIXES = ['#', '.#'];
const LOG_PREFIX = '[prod-build-watch]';

const inputs = readInputs();
/** The running build's child process, or null. */
let building = null;
/** Why the next build runs, when a change settled during the running one; null otherwise. */
let rerunReason = null;
let isStopping = false;
let exitCode = 0;
/** Directory input name → its tree watch and the inode it was armed on. */
const trees = new Map();
// One settle for every input: a build waits for quiet across all of them, not inside one.
const inputBurst = createBurst({ settleMs: QUIET_MS, maxWaitMs: MAX_WAIT_MS, onSettled: (name) => requestBuild(`change: ${name}`) });
// The root's watch is armed before any input is looked at, so a directory input born meanwhile is
// either seen by the look or reported by the watch.
const rootWatcher = watchRoot();
for (const name of inputs) armTreeIfDirectory(name);
console.log(`${LOG_PREFIX} watching ${trees.size} directory inputs and ${inputs.length} names in ${REPO}`);
requestBuild('start');
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

/** The build inputs, as the script that builds from them lists them. */
function readInputs() {
    const listed = execFileSync(BUILD_SCRIPT, ['--inputs'], { cwd: REPO, encoding: 'utf8' });
    const names = listed.split('\n').filter((name) => name !== '');
    if (names.length === 0) throw new Error(`${BUILD_SCRIPT} --inputs listed no inputs`);
    return names;
}

/** Whether a path under a directory input is a save worth a build (not an editor's dropping). */
function isInputFile(relativePath) {
    const name = path.basename(relativePath);
    if (DROPPING_PREFIXES.some((prefix) => name.startsWith(prefix))) return false;
    return !DROPPING_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function watchRoot() {
    const names = new Set(inputs);
    const watch = fs.watch(REPO, (_event, filename) => {
        if (!filename) return;
        const name = filename.toString();
        if (!names.has(name)) return;
        armTreeIfDirectory(name);
        inputBurst.add(name);
    });
    // Without the root's watch a file input's save goes unseen: stop, and let Restart=always arm a fresh one.
    watch.on('error', (error) => {
        console.error(`${LOG_PREFIX} watch error on ${REPO}: ${error.message}`);
        shutdown('root watch lost', 1);
    });
    return watch;
}

/** (Re)arms the tree watch of a directory input when it is a directory not yet watched on this inode. */
function armTreeIfDirectory(name) {
    if (isStopping) return;
    const absolute = path.join(REPO, name);
    const stat = statOrNull(absolute);
    const armed = trees.get(name);
    if (armed && stat?.isDirectory() && stat.ino === armed.ino) return;
    armed?.close();
    trees.delete(name);
    if (!stat?.isDirectory()) return;
    const close = watchTree(absolute, {
        isWatched: isInputFile,
        // The tree hands each save straight on; the shared settle does the waiting.
        settleMs: 0,
        maxWaitMs: null,
        onChange: (relativePath) => inputBurst.add(path.join(name, relativePath)),
        log: logLine,
    });
    trees.set(name, { ino: stat.ino, close });
}

/** The input's stat, or null when it is not there — the root's watch reports it if it appears. */
function statOrNull(absolute) {
    try {
        return fs.statSync(absolute);
    } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
        throw error;
    }
}

function requestBuild(reason) {
    if (isStopping) return;
    if (building) {
        rerunReason = reason;
        return;
    }
    startBuild(reason);
}

function startBuild(reason) {
    console.log(`${LOG_PREFIX} building (${reason})`);
    const child = spawn(BUILD_SCRIPT, ['--wait-lock'], { cwd: REPO, stdio: ['ignore', 'inherit', 'inherit'] });
    building = child;
    let hasEnded = false;
    const end = (outcome) => {
        if (hasEnded) return;
        hasEnded = true;
        buildEnded(outcome);
    };
    child.on('error', (error) => end(`could not start: ${error.message}`));
    child.on('exit', (code, signal) => end(code === 0 ? null : (signal ?? `exit ${code}`)));
}

/** `failure` is null for a clean exit, else what went wrong. */
function buildEnded(failure) {
    building = null;
    // A failed build leaves the script's stamp untouched, so the next run retries what it missed.
    if (failure !== null) console.error(`${LOG_PREFIX} build failed (${failure}); the next save retries it`);
    if (isStopping) process.exit(exitCode);
    if (rerunReason === null) return;
    const reason = rerunReason;
    rerunReason = null;
    startBuild(`${reason}, settled during the last build`);
}

function shutdown(reason, code = 0) {
    if (isStopping) return;
    isStopping = true;
    exitCode = code;
    console.log(`${LOG_PREFIX} stopping (${reason})${building ? '; waiting for the running build to end' : ''}`);
    inputBurst.cancel();
    rootWatcher.close();
    for (const { close } of trees.values()) close();
    trees.clear();
    rerunReason = null;
    if (!building) process.exit(exitCode);
}

function logLine(message, kind) {
    const line = `${LOG_PREFIX} ${message}`;
    if (kind === 'error') console.error(line);
    else console.log(line);
}
