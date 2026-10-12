import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

import { wardenHttpPrefixRoutes, wardenHttpRoutes } from './warden-gateway.js';
import { wardenDistDirectory } from './warden-release.js';

/**
 * The warden's install files, served on the gateway: the three GETs that turn `warden/` into a
 * running unit on a node (`warden/enroll.sh` is the client of all three).
 *
 *   GET /cerberus/enroll.sh               `warden/enroll.sh` with its address marker replaced by `http://<CERBERUS_LISTEN>`
 *   GET /cerberus/warden/latest.json      `latest.json` of the build directory: the release a node should fetch
 *   GET /cerberus/warden/<file>           `<file>` of the build directory, for `cerberus-warden-<x.y.z>.tar.gz` only, streamed
 *
 * The build directory is `CERBERUS_WARDEN_DIST`, else `<repo>/dist-warden` where `npm run build:warden` writes
 * (`warden-release.ts` names it, and the updates driver offers the release from the same place). A build is
 * live the moment it lands: every request reads the disk, nothing is cached, so a new version needs no restart. Nothing served is a secret —
 * the script and the release are public source, and the gateway answers no login.
 *
 * WHY THE ADDRESS IS WRITTEN INTO THE SCRIPT. The script is piped into `sudo sh` as root, so the
 * address it trusts must come from center and from nowhere a node can supply. The marker is replaced
 * with the configured `CERBERUS_LISTEN` after it is checked to be only the characters of a host and a
 * port: an address that could close the script's quote would put its own commands into a root shell.
 *
 * WHICH NAMES ARE SERVED. The file route takes only `cerberus-warden-<digits>.<digits>.<digits>.tar.gz`,
 * matched against the RAW path — nothing is decoded, so `..`, an encoded slash and a `.sha256` file all
 * fail the match and answer 404 before a path is built from them.
 *
 * Consumers: `cerberus.module.ts` (`start()` registers the routes before the gateway binds).
 */

/** The address marker `warden/enroll.sh` carries on its `CENTER` line. */
const CENTER_MARKER = '__CENTER__';

const WARDEN_FILE_PREFIX = '/cerberus/warden/';

/** The only release file name the file route serves. */
const RELEASE_FILE_NAME = /^cerberus-warden-\d+\.\d+\.\d+\.tar\.gz$/;

/** Letters, digits and the punctuation of a host and port (dotted, bracketed IPv6 included); nothing a shell would read. */
const SAFE_LISTEN = /^[A-Za-z0-9.:[\]-]+$/;

const NOT_BUILT_LINE = 'No warden has been built — run npm run build:warden';

/** Where `warden/` is: the application root, the same before and after compilation. */
function applicationRoot(): string {
  return findApplicationRoot(getModuleDirectory(import.meta.url));
}

function answerText(res: http.ServerResponse, status: number, line: string): void {
  const body = `${line}\n`;
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/** `warden/enroll.sh`, its marker replaced by `centerUrl`. */
function enrollScriptHandler(centerUrl: string): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
  return async (_req, res) => {
    // Read per request: an edit to the script is live without a restart. A missing script is a broken
    // install, not an unbuilt warden, so it surfaces as the gateway's logged 500.
    const template = await fsp.readFile(path.join(applicationRoot(), 'warden', 'enroll.sh'), 'utf8');
    const script = template.replaceAll(CENTER_MARKER, centerUrl);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(script) });
    res.end(script);
  };
}

async function latestJsonHandler(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  let latest: Buffer;
  try {
    latest = await fsp.readFile(path.join(wardenDistDirectory(), 'latest.json'));
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    answerText(res, 404, NOT_BUILT_LINE);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': latest.length, 'Cache-Control': 'no-store' });
  res.end(latest);
}

async function releaseFileHandler(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const pathname = (req.url ?? '/').split('?')[0];
  const fileName = pathname.slice(WARDEN_FILE_PREFIX.length);
  if (!RELEASE_FILE_NAME.test(fileName)) {
    answerText(res, 404, 'Not found');
    return;
  }
  // Opened before any header is written: a missing file is a 404, never a half-sent 200. The handle
  // belongs to the stream from `createReadStream` on and closes when the stream does.
  let handle: fsp.FileHandle;
  try {
    handle = await fsp.open(path.join(wardenDistDirectory(), fileName), 'r');
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    answerText(res, 404, NOT_BUILT_LINE);
    return;
  }
  const { size } = await handle.stat();
  res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Length': size });
  try {
    await pipeline(handle.createReadStream(), res);
  } catch (error) {
    // A node that hangs up mid-download is its own business, not a failure of this route.
    if ((error as NodeJS.ErrnoException).code !== 'ERR_STREAM_PREMATURE_CLOSE') throw error;
  }
}

/**
 * Registers the three routes on the gateway. `listen` is `CERBERUS_LISTEN` as configured; an address
 * that is not plain host-and-port characters registers nothing (the gateway then answers its 404).
 * Idempotent: a second call replaces the first's handlers.
 * Consumers: `cerberus.module.ts`, in `start()`, before the gateway binds.
 */
export function registerWardenFileRoutes(listen: string): void {
  if (!SAFE_LISTEN.test(listen)) {
    console.error('[Cerberus] the warden file routes were not registered: CERBERUS_LISTEN holds characters outside a host and port');
    return;
  }
  wardenHttpRoutes.set('/cerberus/enroll.sh', enrollScriptHandler(`http://${listen}`));
  wardenHttpRoutes.set(`${WARDEN_FILE_PREFIX}latest.json`, latestJsonHandler);
  wardenHttpPrefixRoutes.set(WARDEN_FILE_PREFIX, releaseFileHandler);
}

/**
 * The absolute address a warden fetches a release tarball from: `http://<listen><prefix><file>`, built
 * from the configured `CERBERUS_LISTEN` the way the enroll script's address is — never from a request's
 * `Host`, which a node may not reach. `null` when `listen` holds characters outside a host and port or
 * `file` is not a name the file route serves, so an offer never carries an address the route would 404.
 * Consumers: `update-driver.ts`, for the `url` of an `update.offer`.
 */
export function wardenReleaseUrl(listen: string, file: string): string | null {
  if (!SAFE_LISTEN.test(listen) || !RELEASE_FILE_NAME.test(file)) return null;
  return `http://${listen}${WARDEN_FILE_PREFIX}${file}`;
}
