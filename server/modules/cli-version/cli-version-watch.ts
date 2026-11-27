import { realpathSync } from 'node:fs';
import path from 'node:path';

import { createFileLane, createPacedHint, type FileLane } from '@/shared/index.js';

/**
 * Tells the installed-CLI reading the moment its binary is touched, instead of waiting out a clock.
 *
 * Two directories are watched: the one holding the path a run spawns (an npm or native install
 * repoints a symlink there) and, when that path is a link, the one holding the real file (an
 * in-place upgrade rewrites it there). An event on either runs `probe`, paced to one per gap: an
 * installer writes the file many times in a second and one probe after the burst is the reading
 * that matters. `probe` is the service's own cached reading, whose fingerprint misses the cache for
 * a swapped file and which publishes the transition (`noteInstalledVersionReading`).
 *
 * After every probe the two files are resolved again, because an upgrade can move the real file
 * (a versioned directory per release); the lanes are reopened only when that set changed — a lane
 * reopened on every probe would announce its own arming, which runs a probe, without end.
 */

/** An installer's burst of writes is answered by one probe this long after it began. */
const PROBE_GAP_MS = 2_000;
/** The paced hint is used here as a pacer only: its frame is never sent anywhere. */
const PROBE_PACE_KIND = 'cli_version_probe';

export type CliVersionWatchDependencies = {
  /** The binary a run spawns, or null when it is chosen only when a run starts. */
  binaryPath: () => string | null;
  /** Reads the installed version again; its answer is not this watch's business. */
  probe: () => Promise<unknown>;
  logError: (message: string) => void;
};

export type CliVersionWatch = {
  stop(): void;
  /** The files the lanes are armed on right now, as absolute paths: the link first, then its real file. */
  watching(): readonly string[];
};

type WatchedFile = { dir: string; name: string };

export function startCliVersionWatch(dependencies: CliVersionWatchDependencies): CliVersionWatch {
  const { binaryPath, probe, logError } = dependencies;
  let lanes: FileLane[] = [];
  let watched: WatchedFile[] = [];
  let isStopped = false;

  const runProbe = (): void => {
    probe()
      .catch((error: unknown) => logError(`the installed CLI could not be probed: ${messageOf(error)}`))
      .finally(() => {
        if (!isStopped) arm();
      });
  };
  const pace = createPacedHint({ kind: PROBE_PACE_KIND, minGapMs: PROBE_GAP_MS, send: runProbe });

  const arm = (): void => {
    const files = filesToWatch(binaryPath(), logError);
    if (keyOf(files) === keyOf(watched)) return;
    closeLanes();
    watched = files;
    lanes = files.map((file) =>
      createFileLane({ dir: file.dir, names: new Set([file.name]), tell: () => pace.tell(), logError }),
    );
    for (const lane of lanes) lane.start();
  };

  const closeLanes = (): void => {
    for (const lane of lanes) lane.stop();
    lanes = [];
    watched = [];
  };

  arm();
  return {
    stop() {
      isStopped = true;
      pace.stop();
      closeLanes();
    },
    watching: () => watched.map((file) => path.join(file.dir, file.name)),
  };
}

/** The spawned path, and its real file when the path is a link to somewhere else. */
function filesToWatch(binary: string | null, logError: (message: string) => void): WatchedFile[] {
  if (binary === null) return [];
  const files = [fileOf(binary)];
  const real = realPathOf(binary, logError);
  if (real !== null && real !== binary) files.push(fileOf(real));
  return files;
}

function fileOf(filePath: string): WatchedFile {
  return { dir: path.dirname(filePath), name: path.basename(filePath) };
}

/**
 * The real file behind a path, or null when there is none right now. A missing file is the middle of
 * an install, not a fault: the link's own lane still watches its directory and fires when it returns.
 */
function realPathOf(filePath: string, logError: (message: string) => void): string | null {
  try {
    return realpathSync(filePath);
  } catch (error) {
    if (isMissingFileError(error)) return null;
    logError(`the real file behind ${filePath} could not be resolved: ${messageOf(error)}`);
    return null;
  }
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}

function keyOf(files: readonly WatchedFile[]): string {
  return files.map((file) => path.join(file.dir, file.name)).join('\n');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
