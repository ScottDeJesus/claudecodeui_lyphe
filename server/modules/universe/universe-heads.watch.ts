import fs from 'node:fs';
import path from 'node:path';

import { watchDirectory } from '@/shared/directory-watch.service.js';
import type { DirectoryWatch } from '@/shared/directory-watch.service.js';

import { headFilesOf } from './universe-heads.service.js';

/**
 * The watch that hears a registered repo's HEAD move, and the registry gain or lose a repo.
 *
 * One `watchDirectory` per distinct directory among the files every repo's HEAD is read from
 * (`headFilesOf`, the one place git's layout is known) and the registry file's own directory, each
 * filtered to the names wanted there. What is wanted changes with what it watches — a checkout names
 * another ref, a new registry entry names another repo — so after every event the set is asked for
 * again and watches are opened and closed to match it.
 *
 * A wanted directory that does not exist yet (a branch's first ref in a new folder, a repo not cloned)
 * is waited for at its nearest existing ancestor, by the name of the next segment down: its arrival is
 * the event that asks again, and the real watch follows. No clock checks on any of it.
 *
 * `onMove` is not settled here: a commit is a burst of renames, and the caller settles them.
 */

export type HeadsWatch = { start(): void; stop(): void };

export type HeadsWatchDependencies = {
  registryFile: string;
  repos: () => { id: string; path: string }[];
  /** A file a HEAD or the registry is read from was replaced. */
  onMove: () => void;
  logError: (message: string) => void;
};

/** Directory → the names in it whose change is a move. */
type WantedNames = Map<string, Set<string>>;

export function createHeadsWatch(dependencies: HeadsWatchDependencies): HeadsWatch {
  const { registryFile, repos, onMove, logError } = dependencies;
  const watches = new Map<string, DirectoryWatch>();
  let wanted: WantedNames = new Map();
  let running = false;

  const heard = (): void => {
    if (!running) return;
    match();
    onMove();
  };

  /** Opens and closes watches until they are exactly the directories wanted now. */
  const match = (): void => {
    wanted = wantedDirectories(registryFile, repos());
    for (const [dir, watch] of watches) {
      if (wanted.has(dir)) continue;
      watch.close();
      watches.delete(dir);
    }
    for (const dir of wanted.keys()) {
      if (watches.has(dir)) continue;
      watches.set(
        dir,
        watchDirectory({
          dir,
          // Read at event time, so a name that became wanted needs no new watch on a directory already held.
          classify: (_kind, name) => (wanted.get(dir)?.has(name) === true ? true : null),
          onInterest: heard,
          onRearm: heard,
          logError,
        }),
      );
    }
  };

  return {
    start(): void {
      if (running) return;
      running = true;
      match();
    },
    stop(): void {
      running = false;
      for (const watch of watches.values()) watch.close();
      watches.clear();
      wanted = new Map();
    },
  };
}

function wantedDirectories(registryFile: string, repos: { id: string; path: string }[]): WantedNames {
  const wanted: WantedNames = new Map();
  const want = (dir: string, name: string): void => {
    const names = wanted.get(dir) ?? new Set<string>();
    names.add(name);
    wanted.set(dir, names);
  };
  placeWanted(path.resolve(registryFile), want);
  for (const repo of repos) {
    for (const file of headFilesOf(repo.path)) placeWanted(path.resolve(file.dir, file.name), want);
  }
  return wanted;
}

/** Wants a file by its name in its directory, or the first missing directory on its way, by name, in the nearest one that exists. */
function placeWanted(file: string, want: (dir: string, name: string) => void): void {
  let name = path.basename(file);
  let dir = path.dirname(file);
  while (!isDirectory(dir)) {
    const parent = path.dirname(dir);
    // Nothing of the path exists, not even its root: there is nowhere to wait.
    if (parent === dir) return;
    name = path.basename(dir);
    dir = parent;
  }
  want(dir, name);
}

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    // Not there or not readable: either way not a directory a watch can sit on.
    return false;
  }
}
