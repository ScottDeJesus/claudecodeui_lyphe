// The dev supervisor's eyes on server/: one debounced callback per burst of edits.
//
// Linux-only by construction, like the rest of this package — inotify semantics are assumed
// below, and the only caller is this host's systemd unit.
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

// A single save is several inotify events (write, attrib, rename-into-place) and a checkout is
// hundreds; the trailing edge is what turns any of those bursts into exactly one boot.
export const DEBOUNCE_MS = 300;

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
 * Every directory under `root`, root first, skipping the ignored names. Symbolic links are not
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
            if (entry.isDirectory() && !IGNORED_DIRECTORIES.includes(entry.name)) {
                found.push(path.join(found[index], entry.name));
            }
        }
    }
    return found;
}

/** The first source file under `root`, if any — the reason a directory that appeared is a change. */
function findWatchedFile(root, relativeTo) {
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

/**
 * Watches `dir` and every directory under it, and calls `onChange(relativePath)` once per settled
 * burst of edits. Returns the closer; calling it stops every watch and cancels any debounce still
 * in flight.
 */
export function watchServerDir(dir, onChange) {
    let timer = null;
    let latest = null;
    let closed = false;
    /** Absolute directory → its watcher. */
    const watchers = new Map();

    const settle = (relativePath) => {
        latest = relativePath;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            const changed = latest;
            latest = null;
            onChange(changed);
        }, DEBOUNCE_MS);
    };

    /** Drops the watch on `directory` and on everything under it. */
    const unwatchTree = (directory) => {
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
                    unwatchTree(directory);
                    return;
                }

                const absolute = path.join(directory, name);
                const relativePath = path.relative(dir, absolute);

                let stat = null;
                try {
                    stat = fs.lstatSync(absolute);
                } catch {
                    // Gone: a delete, or a rename away. A source file's removal is a change like
                    // any other. A directory gone from this name drops the watch keyed by it —
                    // inotify follows the inode, so after `mv a b` the watch on `a` is alive and
                    // reporting `b`'s edits under a path that no longer exists.
                    if (watchers.has(absolute)) unwatchTree(absolute);
                }
                if (stat?.isDirectory()) {
                    if (IGNORED_DIRECTORIES.includes(name)) return;
                    // A directory that appeared — new, renamed in, or recreated where one was
                    // removed — with whatever it already holds: its files were written before its
                    // watch existed, so the walk speaks for them. Any watch left from a previous
                    // directory at this path is dead (a watch follows the inode, not the name).
                    unwatchTree(absolute);
                    for (const subdirectory of walkDirectories(absolute)) watchDirectory(subdirectory);
                    const firstFile = findWatchedFile(absolute, dir);
                    if (firstFile) settle(firstFile);
                    return;
                }
                if (isWatched(relativePath)) settle(relativePath);
            });
        } catch (error) {
            console.error(`[supervisor] cannot watch ${directory}: ${error.message}`);
            return;
        }
        // The directory became unwatchable (its permissions changed, say): that one watch is
        // finished. The rest of the tree keeps serving, and a directory recreated later is seen
        // by its parent. Reported, never thrown — an unhandled error here would end the
        // supervisor and take the serving API with it.
        watcher.on('error', (error) => {
            console.error(`[supervisor] watch error on ${directory}: ${error.message}`);
            unwatchTree(directory);
        });
        watchers.set(directory, watcher);
    };

    for (const directory of walkDirectories(dir)) watchDirectory(directory);
    console.log(`[supervisor] watching ${watchers.size} directories under ${dir}`);

    return () => {
        closed = true;
        if (timer) clearTimeout(timer);
        for (const watcher of watchers.values()) watcher.close();
        watchers.clear();
    };
}
