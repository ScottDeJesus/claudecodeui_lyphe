// Watches a directory tree and calls back once per settled burst of edits.
//
// Linux-only by construction — inotify semantics are assumed below; every caller is a systemd unit
// on this host (the dev supervisor's server/ watch, the production client's build watcher).
//
// NOT `fs.watch(dir, { recursive: true })`. On Linux that option is Node's own walker
// (lib/internal/fs/recursive_watch.js): one inotify watch per FILE, which is the only thing that
// ever reports a 'change', plus one per folder that reports only NEW names. An editor's atomic
// save — write a temp name, rename it over the file — replaces the inode, and the two watchers
// race: the folder sees the new name while the old entry is still on the books and does nothing;
// the file watcher then sees its inode go and drops the entry with its watch. From that save on
// the file has no watch of its own and the folder never speaks for it, so every in-place write
// to it is invisible until it is renamed again. Measured 2026-09-10: the supervisor held 343
// watches and none on claude-sessions.provider.ts (replaced by an editor at 15:14); three
// in-place saves of it went unseen, while `touch` on a never-replaced neighbour handed over at
// once. What had been taken for "it misses .js edits" was this, not the extension.
//
// So: one plain inotify watch per DIRECTORY, kept by hand. A directory watch names every child
// that is created, written, touched, renamed in or removed, whatever its inode — the kernel
// reports by name. Directories that appear are watched as they appear; one that goes away closes
// its own watch.
import fs from 'node:fs';
import path from 'node:path';

const SKIPPED_DIRECTORIES = ['node_modules'];

/**
 * Watches `root` and every directory under it, and calls `onChange(relativePath)` once per settled
 * burst of edits to a path `isWatched` accepts: `settleMs` after the burst's last event, and, when
 * `maxWaitMs` is a number, never later than that long after its first. `log(message, kind)` gets
 * the watch's own lines, kind 'error' for a directory it could not watch. Returns the closer;
 * calling it stops every watch and cancels any settle still in flight.
 */
export function watchTree(root, { isWatched, settleMs, maxWaitMs = null, onChange, log }) {
    let closed = false;
    /** Absolute directory → its watcher. */
    const watchers = new Map();
    const burst = createBurst({ settleMs, maxWaitMs, onSettled: onChange });

    /** Drops the watch on `directory` and on everything under it. */
    const unwatchSubtree = (directory) => {
        for (const [watched, watcher] of watchers) {
            if (watched === directory || watched.startsWith(directory + path.sep)) {
                watcher.close();
                watchers.delete(watched);
            }
        }
    };

    const watchDirectory = (directory) => {
        if (closed || watchers.has(directory)) return;
        let watcher;
        try {
            watcher = fs.watch(directory, (_event, filename) => {
                // inotify always names the child on Linux; a nameless event would be the directory
                // itself, which its parent's watch reports under the directory's own name.
                if (!filename) return;
                const name = filename.toString();

                // The directory's own removal reaches its watch as an event under its own name
                // (IN_DELETE_SELF), after which the watch is dead but still open: closed here, so
                // a directory recreated at this path gets a live watch from its parent, not a
                // stale hit in the map.
                if (name === path.basename(directory) && !fs.existsSync(directory)) {
                    unwatchSubtree(directory);
                    return;
                }

                const absolute = path.join(directory, name);
                const relativePath = path.relative(root, absolute);

                let stat = null;
                try {
                    stat = fs.lstatSync(absolute);
                } catch {
                    // Gone: a delete, or a rename away. A watched file's removal is a change like
                    // any other. A directory gone from this name drops the watch keyed by it —
                    // inotify follows the inode, so after `mv a b` the watch on `a` is alive and
                    // reporting `b`'s edits under a path that no longer exists.
                    if (watchers.has(absolute)) unwatchSubtree(absolute);
                }
                if (stat?.isDirectory()) {
                    if (SKIPPED_DIRECTORIES.includes(name)) return;
                    // A directory that appeared — new, renamed in, or recreated where one was
                    // removed — with whatever it already holds: its files were written before its
                    // watch existed, so the scan after the watch speaks for them. Any watch left
                    // from a previous directory at this path is dead (a watch follows the inode,
                    // not the name).
                    unwatchSubtree(absolute);
                    watchSubtree(absolute);
                    const firstFile = findWatchedFile(absolute, root, isWatched);
                    if (firstFile) burst.add(firstFile);
                    return;
                }
                if (isWatched(relativePath)) burst.add(relativePath);
            });
        } catch (error) {
            log(`cannot watch ${directory}: ${error.message}`, 'error');
            return;
        }
        // The directory became unwatchable (its permissions changed, say): that one watch is
        // finished. The rest of the tree keeps serving, and a directory recreated later is seen
        // by its parent. Reported, never thrown — an unhandled error here would end the
        // watching process and whatever it keeps alive.
        watcher.on('error', (error) => {
            log(`watch error on ${directory}: ${error.message}`, 'error');
            unwatchSubtree(directory);
        });
        watchers.set(directory, watcher);
    };

    /**
     * Watches `directory` and every directory under it, each one's watch ARMED BEFORE IT IS LISTED. A
     * subdirectory born while this runs is then in the listing (born before it) or reported by its
     * parent's watch (born after the watch armed) or both, and `watchDirectory` takes the same
     * directory twice as once. The other order, listing the whole tree and arming afterwards, leaves
     * a gap in which a subdirectory is born into neither: measured 2026-10-28, `server/modules/companion/session/`
     * was created 1 ms after its parent, fell in that gap, and no save to its files restarted the API for two days.
     */
    const watchSubtree = (directory) => {
        watchDirectory(directory);
        let entries;
        try {
            entries = fs.readdirSync(directory, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry.isDirectory() && !SKIPPED_DIRECTORIES.includes(entry.name)) watchSubtree(path.join(directory, entry.name));
        }
    };

    watchSubtree(root);
    log(`watching ${watchers.size} directories under ${root}`, 'info');

    return () => {
        closed = true;
        burst.cancel();
        for (const watcher of watchers.values()) watcher.close();
        watchers.clear();
    };
}

/**
 * One trailing-edge settle: `add(value)` (re)arms it, and `onSettled(latestValue)` runs once
 * `settleMs` after the last add — or, when `maxWaitMs` is a number, at the latest that long after
 * the burst's first add, so a stream of edits that never pauses still settles.
 */
export function createBurst({ settleMs, maxWaitMs = null, onSettled }) {
    let timer = null;
    let latest = null;
    let firstAt = null;

    const fire = () => {
        timer = null;
        firstAt = null;
        const settled = latest;
        latest = null;
        onSettled(settled);
    };

    return {
        add(value) {
            latest = value;
            const now = Date.now();
            if (firstAt === null) firstAt = now;
            if (timer) clearTimeout(timer);
            const delayMs = maxWaitMs === null ? settleMs : Math.min(settleMs, Math.max(0, firstAt + maxWaitMs - now));
            timer = setTimeout(fire, delayMs);
        },
        cancel() {
            if (timer) clearTimeout(timer);
            timer = null;
            latest = null;
            firstAt = null;
        },
    };
}

/**
 * Every directory under `root`, root first, skipping the skipped names. Symbolic links are not
 * followed: a link out of the tree would watch someone else's directory, and a link back into it
 * would watch one twice.
 */
function walkDirectories(root) {
    const found = [root];
    for (let index = 0; index < found.length; index += 1) {
        let entries;
        try {
            entries = fs.readdirSync(found[index], { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (entry.isDirectory() && !SKIPPED_DIRECTORIES.includes(entry.name)) {
                found.push(path.join(found[index], entry.name));
            }
        }
    }
    return found;
}

/** The first watched file under `root`, if any — the reason a directory that appeared is a change. */
function findWatchedFile(root, relativeTo, isWatched) {
    for (const directory of walkDirectories(root)) {
        let entries;
        try {
            entries = fs.readdirSync(directory, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const relativePath = path.relative(relativeTo, path.join(directory, entry.name));
            if (entry.isFile() && isWatched(relativePath)) return relativePath;
        }
    }
    return null;
}
