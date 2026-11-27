import fs from 'node:fs';
import path from 'node:path';

import { watchDirectory, type DirectoryWatch } from '@/shared/directory-watch.service.js';

import { CHAIN_RECORD_FILE } from './chain-record.transport.js';
import {
  CHILD_LOG_FILE,
  CHILD_LOG_HEAD_BYTES,
  CHILD_PID_FILE,
  LAUNCHER_PID_FILE,
  RESULT_FILE,
  SPEC_FILE,
} from './soul-launch.transport.js';

/**
 * What tells the souls lane that something its snapshot reads was written.
 *
 * Every watch here is `watchDirectory`: the launch root and the chains root, one watch per directory
 * in each (EVERY directory, not only the six-hour window's: a launch resumed after a day writes into an
 * old directory), and the pacer's `cpu-wait` folder. What counts, by directory:
 *   - a root: any event naming a child. A child that is a directory and unwatched gets its watch, one
 *     that is gone loses it; either way `onMove`.
 *   - a launch directory: the spec, the receipt and the two pid files on any event; the child's log only
 *     while the lane does not yet hold the launch's served model and the log is still inside the head
 *     the model is read from — the write that takes it past that head is the last of it that counts.
 *   - a chain directory: its record.
 *   - the cpu-wait folder: a marker, `<launch id>.json`.
 * A watch that was lost and armed again lists its root again and calls `onMove`: what happened while it
 * was blind is unknown.
 *
 * A root's watch is ARMED BEFORE THE ROOT IS LISTED (the order `deploy/dev-supervisor/watch.mjs` learned),
 * so a directory born during `start` is in the listing or reported by the watch, never in neither.
 * `onMove` is not settled here: a burst of writes is the caller's to gather.
 */

export type LaunchWatch = { start(): void; stop(): void };

export type LaunchWatchDependencies = {
  soulsRoot: string;
  chainsRoot: string;
  cpuWaitDir: string;
  /** Whether the lane already holds this launch's served model. */
  modelKnown: (launchId: string) => boolean;
  /** Something the snapshot reads was written. Not settled here: the caller settles. */
  onMove: () => void;
  logError: (message: string) => void;
};

/** The files of a launch directory any write of which may change the launch's snapshot. */
const LAUNCH_RECORD_FILES: ReadonlySet<string> = new Set([SPEC_FILE, RESULT_FILE, LAUNCHER_PID_FILE, CHILD_PID_FILE]);

/** The extension a CPU-wait marker carries, `<launch id>.json` (`hooks/plan_runner/pacer/cpu_marker.py`). */
const CPU_WAIT_MARKER_EXT = '.json';

/** Which file names count inside one child directory of a root, given the child's own name. */
type ChildFilter = (childName: string) => (fileName: string) => boolean;

export function createLaunchWatch(dependencies: LaunchWatchDependencies): LaunchWatch {
  const { soulsRoot, chainsRoot, cpuWaitDir, modelKnown, onMove, logError } = dependencies;
  /** Absolute child directory → its watch, for both roots. */
  const childWatches = new Map<string, DirectoryWatch>();
  /** Launches whose log has grown past the model's head: no later write to it counts. */
  const logsPastHead = new Set<string>();
  let rootWatches: DirectoryWatch[] = [];
  let isRunning = false;

  const countsInLaunch = (launchId: string, fileName: string): boolean => {
    if (LAUNCH_RECORD_FILES.has(fileName)) return true;
    if (fileName !== CHILD_LOG_FILE || logsPastHead.has(launchId) || modelKnown(launchId)) return false;
    if (fileSize(path.join(soulsRoot, launchId, fileName)) >= CHILD_LOG_HEAD_BYTES) logsPastHead.add(launchId);
    return true;
  };
  const launchFilter: ChildFilter = (launchId) => (fileName) => countsInLaunch(launchId, fileName);
  const chainFilter: ChildFilter = () => (fileName) => fileName === CHAIN_RECORD_FILE;

  const watchChild = (root: string, childName: string, filter: ChildFilter): void => {
    const dir = path.join(root, childName);
    if (childWatches.has(dir)) return;
    const counts = filter(childName);
    childWatches.set(dir, watchDirectory<true>({
      dir,
      classify: (_kind, fileName) => (counts(fileName) ? true : null),
      onInterest: onMove,
      onRearm: onMove,
      logError,
    }));
  };

  const dropChild = (root: string, childName: string): void => {
    const dir = path.join(root, childName);
    childWatches.get(dir)?.close();
    childWatches.delete(dir);
    if (root === soulsRoot) logsPastHead.delete(childName);
  };

  /** One event named `childName` in `root`: its watch is opened or closed to match what is there now. */
  const followChild = (root: string, childName: string, filter: ChildFilter): void => {
    if (isDirectory(path.join(root, childName))) watchChild(root, childName, filter);
    else dropChild(root, childName);
  };

  /** Every directory now in `root` watched, and every watched one no longer there dropped. */
  const relist = (root: string, filter: ChildFilter): void => {
    const present = new Set(listDirectories(root, logError));
    for (const childName of present) watchChild(root, childName, filter);
    const prefix = root + path.sep;
    for (const dir of [...childWatches.keys()]) {
      const childName = path.basename(dir);
      if (dir.startsWith(prefix) && !present.has(childName)) dropChild(root, childName);
    }
  };

  const watchRoot = (root: string, filter: ChildFilter): DirectoryWatch => {
    const watch = watchDirectory<string>({
      dir: root,
      classify: (_kind, childName) => (childName === '' ? null : childName),
      onInterest: (childName) => {
        followChild(root, childName, filter);
        onMove();
      },
      onRearm: () => {
        relist(root, filter);
        onMove();
      },
      logError,
    });
    // Listed only once its watch stands: a directory made in between is in one or the other.
    relist(root, filter);
    return watch;
  };

  return {
    start(): void {
      if (isRunning) return;
      isRunning = true;
      rootWatches = [
        watchRoot(soulsRoot, launchFilter),
        watchRoot(chainsRoot, chainFilter),
        watchDirectory<true>({
          dir: cpuWaitDir,
          classify: (_kind, fileName) => (fileName.endsWith(CPU_WAIT_MARKER_EXT) ? true : null),
          onInterest: onMove,
          onRearm: onMove,
          logError,
        }),
      ];
    },
    stop(): void {
      if (!isRunning) return;
      isRunning = false;
      for (const watch of rootWatches) watch.close();
      rootWatches = [];
      for (const watch of childWatches.values()) watch.close();
      childWatches.clear();
      logsPastHead.clear();
    },
  };
}

/** The directories in `root`; none while it is missing, which its own watch waits out. */
function listDirectories(root: string, logError: (message: string) => void): string[] {
  try {
    return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (!isMissing(error)) logError(`cannot list ${root}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function isDirectory(file: string): boolean {
  try {
    return fs.statSync(file, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    // Unreadable is not a launch this lane can read either; its watch would fail the same way.
    return false;
  }
}

function fileSize(file: string): number {
  try {
    return fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0;
  } catch {
    // A log the lane cannot stat is one it cannot read the model from: the write still counts.
    return 0;
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
