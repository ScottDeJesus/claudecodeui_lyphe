import fsp from 'node:fs/promises';
import path from 'node:path';

import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

/**
 * Where the warden release lives on disk and what `latest.json` says about it: the one reader of the
 * build's output, shared by the file routes that serve it (`warden-files.ts`) and the updates driver
 * that offers it (`update-driver.ts`, `updates.service.ts`).
 *
 * THE DIRECTORY. `CERBERUS_WARDEN_DIST` when it is set, else `<repo>/dist-warden` — where
 * `npm run build:warden` writes. It is read from the environment on every call, and so is the file:
 * nothing is cached across a build, so a release that has just landed is the one the next request,
 * the next `GET /wardens` and the next offer see, with no restart.
 *
 * WHAT A `latest.json` MUST HOLD to be a release at all: a `major.minor.patch` version, the tarball
 * name that version has (`cerberus-warden-<version>.tar.gz` — the only name the file route serves),
 * the tarball's SHA-256 as lowercase hex and its size in bytes. `note` is the build's one line; a
 * build refuses to ship without it, so a file with none is an older build and reads as an empty note.
 * A file that is there but is not that (a truncated write cannot happen — the build renames it into
 * place — but a hand edit can) is logged and read as "no release", never half-trusted.
 */

/** One built release, as `latest.json` names it, with the time already in epoch milliseconds. */
export type WardenBuild = {
  version: string;
  file: string;
  sha256: string;
  size: number;
  note: string;
  builtAt: number;
};

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/**
 * The directory the build's output is read from, as of now.
 * Consumers: `warden-files.ts` (the two routes that serve it) and `readLatestBuild` below.
 */
export function wardenDistDirectory(): string {
  const configured = process.env.CERBERUS_WARDEN_DIST?.trim();
  if (configured) return path.resolve(configured);
  return path.join(findApplicationRoot(getModuleDirectory(import.meta.url)), 'dist-warden');
}

/**
 * The release `latest.json` names, or `null` when nothing has been built (no file) or the file is not
 * a release. Any other failure to read it propagates: a disk that cannot be read is not "no release".
 * Consumers: `updates.service.ts` (`latestRelease`, `startBatch`, `wardensStatus`) and the driver's offers.
 */
export async function readLatestBuild(): Promise<WardenBuild | null> {
  let text: string;
  try {
    text = await fsp.readFile(path.join(wardenDistDirectory(), 'latest.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error('[Cerberus] dist-warden/latest.json is not JSON, so no warden release is on offer');
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const { version, file, sha256, size, note, builtAt } = parsed as Record<string, unknown>;

  const isRelease =
    typeof version === 'string' &&
    VERSION_PATTERN.test(version) &&
    file === `cerberus-warden-${version}.tar.gz` &&
    typeof sha256 === 'string' &&
    SHA256_PATTERN.test(sha256) &&
    typeof size === 'number' &&
    Number.isSafeInteger(size) &&
    size > 0;
  if (!isRelease) {
    console.error('[Cerberus] dist-warden/latest.json does not name a whole release, so no warden release is on offer');
    return null;
  }

  const builtAtMs = typeof builtAt === 'string' ? Date.parse(builtAt) : Number.NaN;
  return {
    version,
    file,
    sha256,
    size,
    note: typeof note === 'string' ? note : '',
    builtAt: Number.isNaN(builtAtMs) ? 0 : builtAtMs,
  };
}
