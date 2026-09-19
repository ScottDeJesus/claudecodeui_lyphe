import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { AppEntry } from '@/shared/app-types.js';

import { resolveAppsFile } from './apps.store.js';

/**
 * Each registered app's own tab icon, found on the app itself and REMEMBERED on disk.
 *
 * Fetched here, by the server, and handed to the drawer as data URLs inside `GET /api/apps`: the
 * browser cannot read another origin's page to find its `<link rel="icon">`, and the server can.
 * `{host}` is resolved to loopback — the registry's rows are apps on this box.
 *
 * THE CACHE IS A FILE beside the registry (`apps.icons.local.json`), keyed by app id and holding the
 * url it was found for, so an icon survives a restart and a changed url fetches afresh. A found icon
 * is re-checked after a week; an app that published none is asked again after an hour, so an icon
 * added to an app shows up without anybody clearing anything. A read waits at most for the probes
 * that are due, each one bounded by a short timeout, and a probe already in flight is joined rather
 * than repeated.
 */
const ICONS_FILE_NAME = 'apps.icons.local.json';
const FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MISSING_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3000;
const MAX_ICON_BYTES = 256 * 1024;

type CachedIcon = { url: string; at: number; icon: string | null };

const inFlight = new Map<string, Promise<CachedIcon>>();

function iconsFile(): string {
  return path.join(path.dirname(resolveAppsFile()), ICONS_FILE_NAME);
}

function readCache(): Record<string, CachedIcon> {
  try {
    const parsed = JSON.parse(readFileSync(iconsFile(), 'utf8')) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, CachedIcon>)
      : {};
  } catch {
    // Absent or unreadable: a cache, so nothing is lost — every icon is simply due.
    return {};
  }
}

function writeCache(cache: Record<string, CachedIcon>): void {
  const file = iconsFile();
  const scratch = `${file}.${process.pid}.tmp`;
  writeFileSync(scratch, `${JSON.stringify(cache, null, 2)}\n`);
  renameSync(scratch, file);
}

function isFresh(entry: CachedIcon | undefined, url: string, now: number): entry is CachedIcon {
  if (!entry || entry.url !== url) return false;
  return now - entry.at < (entry.icon ? FOUND_TTL_MS : MISSING_TTL_MS);
}

async function fetchWithTimeout(url: string): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' });
}

/**
 * The icon hrefs the page declares, best first: an SVG scales to any tile, an apple-touch-icon is
 * large, and a plain `icon` is whatever the app chose. `/favicon.ico` goes last, for the apps that
 * only ever answered the browser's own guess.
 */
function iconCandidates(html: string, pageUrl: string): string[] {
  const links = html.match(/<link\b[^>]*>/gi) ?? [];
  const ranked: Array<{ href: string; rank: number }> = [];
  for (const tag of links) {
    const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase() ?? '';
    const href = /\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1];
    if (!href || !rel.split(/\s+/).some((word) => word === 'icon' || word === 'apple-touch-icon')) continue;
    const svg = /\.svg(\?|$)/i.test(href) || /image\/svg/i.test(tag);
    ranked.push({ href, rank: svg ? 0 : rel.includes('apple-touch-icon') ? 1 : 2 });
  }
  ranked.sort((a, b) => a.rank - b.rank);
  const hrefs = ranked.map(({ href }) => {
    try {
      return new URL(href, pageUrl).href;
    } catch {
      return null;
    }
  }).filter((href): href is string => href !== null);
  hrefs.push(new URL('/favicon.ico', pageUrl).href);
  return [...new Set(hrefs)];
}

/** The image at `url` as a data URL, or null when it is not an image or is too large to carry. */
async function imageAt(url: string): Promise<string | null> {
  try {
    const response = await fetchWithTimeout(url);
    const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    // An SPA answers every path with its index page at 200, so the type is what says "image".
    if (!response.ok || !type.startsWith('image/')) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_ICON_BYTES) return null;
    return `data:${type};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

async function probe(url: string): Promise<CachedIcon> {
  const target = url.replace(/\{host\}/gi, '127.0.0.1');
  let pageUrl = target;
  let html = '';
  try {
    const response = await fetchWithTimeout(target);
    pageUrl = response.url || target;
    if ((response.headers.get('content-type') ?? '').includes('html')) html = await response.text();
  } catch {
    // An app that is down now has no icon now; the short retry asks again.
    return { url, at: Date.now(), icon: null };
  }
  for (const candidate of iconCandidates(html, pageUrl)) {
    const icon = await imageAt(candidate);
    if (icon) return { url, at: Date.now(), icon };
  }
  return { url, at: Date.now(), icon: null };
}

/** Every app's icon that is known, by id — probing, and remembering, the ones that are due. */
export async function appIcons(apps: AppEntry[]): Promise<Record<string, string>> {
  const cache = readCache();
  const now = Date.now();
  const due = apps.filter((app) => !isFresh(cache[app.id], app.url, now));

  if (due.length > 0) {
    const found = await Promise.all(due.map((app) => {
      const key = `${app.id}\n${app.url}`;
      let pending = inFlight.get(key);
      if (!pending) {
        pending = probe(app.url).finally(() => inFlight.delete(key));
        inFlight.set(key, pending);
      }
      return pending.then((entry) => [app.id, entry] as const);
    }));
    // Re-read before writing: a second server on this file may have probed meanwhile.
    const merged = { ...readCache(), ...Object.fromEntries(found) };
    // Rows no longer in the registry take their icons with them.
    const kept = Object.fromEntries(apps.filter((app) => merged[app.id]).map((app) => [app.id, merged[app.id]]));
    try {
      writeCache(kept);
    } catch (error) {
      console.warn('[apps] could not remember the app icons:', error instanceof Error ? error.message : String(error));
    }
    Object.assign(cache, kept);
  }

  const icons: Record<string, string> = {};
  for (const app of apps) {
    const icon = cache[app.id]?.icon;
    if (icon) icons[app.id] = icon;
  }
  return icons;
}
