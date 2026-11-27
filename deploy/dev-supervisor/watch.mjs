// The dev supervisor's eyes on server/: one debounced callback per burst of edits.
//
// The tree watch itself — one inotify watch per directory, kept by hand, and why — lives in
// deploy/tree-watch/tree-watch.mjs; this file owns what counts as a server source and how long a
// burst must be quiet before the API is handed over.
import path from 'node:path';
import { watchTree } from '../tree-watch/tree-watch.mjs';

// Two quiet minutes: the trailing edge waits until no save under server/ has landed for two
// minutes, so a builder's burst of edits (and a checkout's hundreds of inotify events) becomes one
// boot, not one per save — every swap cuts Kaylee off and drops live connections (operator, 2026-11-03).
export const DEBOUNCE_MS = 120_000;

const WATCHED_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'];

// Editor droppings that are not source: vim swap and backup files, Emacs lock files, the temp
// name an atomic write lands under. Rebooting the API for one of these is pure downtime.
const IGNORED_SUFFIXES = ['~', '.swp', '.tmp'];

const IGNORED_DIRECTORIES = ['node_modules'];

/** Whether a path relative to the watched root is worth a restart. */
function isWatched(relativePath) {
    const segments = relativePath.split(path.sep);
    if (segments.some((segment) => IGNORED_DIRECTORIES.includes(segment))) return false;

    const name = segments[segments.length - 1];
    if (!name || name.startsWith('.') || name.startsWith('#')) return false;
    if (IGNORED_SUFFIXES.some((suffix) => name.endsWith(suffix))) return false;
    return WATCHED_EXTENSIONS.some((extension) => name.endsWith(extension));
}

/**
 * Watches `dir` and every directory under it, and calls `onChange(relativePath)` once per settled
 * burst of edits. Returns the closer; calling it stops every watch and cancels any debounce still
 * in flight.
 */
export function watchServerDir(dir, onChange) {
    return watchTree(dir, { isWatched, settleMs: DEBOUNCE_MS, maxWaitMs: null, onChange, log: logAsSupervisor });
}

/** The supervisor's own prefix, and stderr for a directory it could not watch, as before the move. */
function logAsSupervisor(message, kind) {
    const line = `[supervisor] ${message}`;
    if (kind === 'error') console.error(line);
    else console.log(line);
}
