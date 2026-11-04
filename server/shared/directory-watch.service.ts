import fs from 'node:fs';
import path from 'node:path';

/**
 * One `fs.watch` on one DIRECTORY, filtered to the names that matter and kept armed.
 *
 * A directory and not the files in it, because the files that matter here are REPLACED more often
 * than written — a state file goes through a scratch file and `os.replace`, a WAL is truncated or
 * deleted and recreated by a checkpoint — and a watch on a file dies with the inode it was put on.
 * A watch on the directory sees every name come and go.
 *
 * `classify` is the caller's whole opinion about an event: it answers what the event is worth
 * (anything the caller likes — `null` for nothing), and `onInterest` is handed that answer. This file
 * takes no view on what an event means and does no coalescing; both belong to whoever knows the
 * consumers.
 *
 * TWO WAYS A WATCH GOES BLIND, BOTH ANSWERED BY AN EVENT AND NEVER BY A CLOCK:
 *   - the directory itself is deleted or moved: the kernel drops the watch and libuv reports it as a
 *     `rename` named for the directory itself (an event with no file in it carries the watched path's
 *     own basename). The watch is re-armed and `onRearm` runs, because what happened while it was
 *     blind is unknown;
 *   - the directory is not there to begin with, or the re-arm finds it still gone: the PARENT is
 *     watched for the name to appear, and the arrival is the event that arms the real watch.
 * Any failure is said once through `logError`, never once per event.
 */

export type DirectoryEventKind = 'change' | 'rename';

export type DirectoryWatchDependencies<TInterest> = {
  dir: string;
  /** What one event on `name` is worth, or `null` when it is no concern of the caller's. */
  classify: (kind: DirectoryEventKind, name: string) => TInterest | null;
  /** Called synchronously for every event `classify` found a use for. */
  onInterest: (interest: TInterest) => void;
  /** Called after a lost watch is armed again: the directory may have changed while nobody was looking. */
  onRearm: () => void;
  /** Injected by the composition root — this server has no logger (`system.module.ts:57-58`). */
  logError: (message: string) => void;
};

export type DirectoryWatch = {
  close(): void;
};

export function watchDirectory<TInterest>(dependencies: DirectoryWatchDependencies<TInterest>): DirectoryWatch {
  const { dir, classify, onInterest, onRearm, logError } = dependencies;
  const ownName = path.basename(dir);
  let watcher: fs.FSWatcher | null = null;
  let closed = false;

  /** Said once per distinct sentence: a vanished directory would otherwise repeat itself on every re-arm. */
  const said = new Set<string>();
  const sayOnce = (message: string): void => {
    if (said.has(message)) return;
    said.add(message);
    logError(message);
  };

  const release = (): void => {
    watcher?.close();
    watcher = null;
  };

  /**
   * The watch on the directory is gone or was never there: wait, by event, for the directory to be made.
   *
   * `lostWatch` is true when a watch that WAS armed has just been lost, which is the one case the
   * directory may already be back by the time the parent is being watched (deleted and recreated in
   * one breath, so its creation was announced to nobody). Looked at once, here, and never again.
   * A watch that failed to arm for any other reason does not look: the directory existing is not a
   * reason to believe the next arm will go better, and arming again would be a loop.
   */
  const waitForDirectory = (lostWatch: boolean): void => {
    try {
      watcher = fs.watch(path.dirname(dir), { persistent: false }, (_kind, name) => {
        // The parent names the directory when it is made AND when it is removed; only a made one is a way back.
        if (name !== ownName || closed || !fs.existsSync(dir)) return;
        arm();
        onRearm();
      });
      watcher.on('error', (error) => sayOnce(`directory watch on ${path.dirname(dir)} failed: ${error.message}`));
    } catch (error) {
      sayOnce(`cannot watch ${dir} or its parent: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (lostWatch && fs.existsSync(dir)) {
      arm();
      onRearm();
    }
  };

  const arm = (): void => {
    release();
    try {
      watcher = fs.watch(dir, { persistent: false }, (kind, name) => {
        if (closed) return;
        // A `rename` named for the directory is its own deletion or move: the kernel has already dropped
        // the watch, so there is nothing left listening and the way back is the parent's.
        if (kind === 'rename' && name === ownName) {
          release();
          waitForDirectory(true);
          onRearm();
          return;
        }
        // Linux names the entry of every directory event; the empty string is only what the type
        // allows for a platform that does not, and a classifier that matches names will pass it by.
        const interest = classify(kind, name ?? '');
        if (interest !== null) onInterest(interest);
      });
      watcher.on('error', (error) => {
        sayOnce(`directory watch on ${dir} failed: ${error.message}`);
        release();
        waitForDirectory(true);
      });
    } catch (error) {
      sayOnce(`cannot watch ${dir}: ${error instanceof Error ? error.message : String(error)}`);
      waitForDirectory(false);
    }
  };

  arm();

  return {
    close(): void {
      closed = true;
      release();
    },
  };
}
