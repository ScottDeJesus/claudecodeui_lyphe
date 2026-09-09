// The dev supervisor's eyes on server/: one debounced callback per burst of edits.
//
// Linux-only by construction, like the rest of this package — recursive fs.watch exists on Linux,
// macOS and Windows only, and the only caller is this host's systemd unit.
import fs from 'node:fs';
import path from 'node:path';

// A single save is several inotify events (write, attrib, rename-into-place) and a checkout is
// hundreds; the trailing edge is what turns any of those bursts into exactly one boot.
export const DEBOUNCE_MS = 300;

const WATCHED_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'];

// Editor droppings that are not source: vim swap and backup files, Emacs lock files, the temp
// name an atomic write lands under. Rebooting the API for one of these is pure downtime.
const IGNORED_SUFFIXES = ['~', '.swp', '.tmp'];

/** Whether a path relative to the watched root is worth a restart. */
function isWatched(relativePath) {
    const segments = relativePath.split(path.sep);
    if (segments.includes('node_modules')) return false;

    const name = segments[segments.length - 1];
    if (!name || name.startsWith('.') || name.startsWith('#')) return false;
    if (IGNORED_SUFFIXES.some((suffix) => name.endsWith(suffix))) return false;
    return WATCHED_EXTENSIONS.some((extension) => name.endsWith(extension));
}

/**
 * Watches `dir` recursively and calls `onChange(relativePath)` once per settled burst of edits.
 * Returns the closer; calling it stops the watcher and cancels any debounce still in flight.
 */
export function watchServerDir(dir, onChange) {
    let timer = null;
    let latest = null;

    const watcher = fs.watch(dir, { recursive: true }, (_event, filename) => {
        // fs.watch reports a null name when the platform cannot supply one; there is nothing to
        // filter on, and every rename burst is followed by a named event for the file itself.
        if (!filename) return;

        const relativePath = filename.toString();
        if (!isWatched(relativePath)) return;

        latest = relativePath;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            const changed = latest;
            latest = null;
            onChange(changed);
        }, DEBOUNCE_MS);
    });

    // An unwatchable tree (permissions changed, the directory moved) arrives as an 'error' event,
    // and an unhandled one is thrown: it would end the supervisor and take the serving API with
    // it. Reported instead — the API keeps serving, blind to further edits until the unit restarts.
    watcher.on('error', (error) => {
        console.error(`[supervisor] watch error on ${dir}: ${error.message}`);
    });

    return () => {
        if (timer) clearTimeout(timer);
        watcher.close();
    };
}
