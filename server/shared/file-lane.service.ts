import { watchDirectory, type DirectoryEventKind, type DirectoryWatch } from './directory-watch.service.js';

/**
 * One directory watched for a few names, each event on them turned into a `tell()`.
 *
 * Built on `watchDirectory`, so a file replaced by rename, or a directory removed and made again, is
 * still seen. A name in `changeOnly` tells only for the `change` kind: a SQLite WAL is created and
 * removed by every reader that opens the database, and changed only by a commit, so its `rename`
 * events are readers and not news. A re-armed watch tells once, because what happened while it was
 * blind is unknown.
 *
 * The lane takes no view on pacing; `tell` is usually a paced hint's (`paced-hint.service.ts`).
 */

export type FileLaneDependencies = {
  dir: string;
  names: ReadonlySet<string>;
  changeOnly?: ReadonlySet<string>;
  /** Names not known ahead (a directory of sidechains, each named for its agent): tested when `names` misses. */
  matches?: (name: string) => boolean;
  tell: () => void;
  logError: (message: string) => void;
};

export type FileLane = {
  start(): void;
  stop(): void;
};

export function createFileLane(dependencies: FileLaneDependencies): FileLane {
  const { dir, names, changeOnly, matches, tell, logError } = dependencies;
  let watch: DirectoryWatch | null = null;

  const isNews = (kind: DirectoryEventKind, name: string): boolean => {
    if (!names.has(name) && !(matches?.(name) ?? false)) return false;
    if (changeOnly?.has(name)) return kind === 'change';
    return true;
  };

  return {
    start() {
      if (watch !== null) return;
      watch = watchDirectory<true>({
        dir,
        classify: (kind, name) => (isNews(kind, name) ? true : null),
        onInterest: () => tell(),
        onRearm: () => tell(),
        logError,
      });
    },
    stop() {
      watch?.close();
      watch = null;
    },
  };
}
