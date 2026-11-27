import { useSyncExternalStore } from 'react';

import { api } from '@/shared/api';
import { APP_VERSION } from '@/shared/constants';
import { useServerFrame } from '@/shared/hooks/useServerFrame';
import type { AppReleaseReading, InstallMode, ReleaseInfo, ServerEvent } from '@/shared/types';

/**
 * Compare two semantic version strings
 * Works only with numeric versions separated by dots (e.g. "1.2.3")
 * @param {string} v1
 * @param {string} v2
 * @returns positive if v1 > v2, negative if v1 < v2, 0 if equal
 */
const compareVersions = (v1: string, v2: string) => {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 !== p2) return p1 - p2;
  }
  return 0;
};

/** The frame that carries the server's newest reading of the release. */
const RELEASE_FRAME_KIND = 'app_release_state';
const RELEASE_FRAME_KINDS: readonly string[] = [RELEASE_FRAME_KIND];

/** What is known of the app's versions: the newest release and whether it is newer, how it is installed, and what the server runs. */
type VersionReading = {
  updateAvailable: boolean;
  latestVersion: string | null;
  releaseInfo: ReleaseInfo | null;
  installMode: InstallMode;
  runningVersion: string | null;
  restartRequired: boolean;
};

const NOTHING_KNOWN: VersionReading = {
  updateAvailable: false,
  latestVersion: null,
  releaseInfo: null,
  installMode: 'git',
  runningVersion: null,
  restartRequired: false,
};

/** One reading for the whole document, shared by every reader: one health read and one release read however many screens read it. */
const listeners = new Set<() => void>();
let reading = NOTHING_KNOWN;
/** The release read in flight, so readers asking at once share one request. */
let latestInFlight: Promise<void> | null = null;

const learn = (patch: Partial<VersionReading>) => {
  reading = { ...reading, ...patch };
  listeners.forEach((listener) => listener());
};

const readHealth = async () => {
  try {
    const response = await fetch('/health');
    const data = await response.json();
    const patch: Partial<VersionReading> = {};
    if (data.installMode === 'npm' || data.installMode === 'git') {
      patch.installMode = data.installMode;
    }
    // `data.version` is the version the server process is actually running.
    // This module's `version` is baked into the frontend bundle at build
    // time, so it reflects the installed (on-disk) package. If they differ,
    // the package was updated but the server process was not restarted, and
    // DB-backed actions may silently fail until it is.
    if (typeof data.version === 'string' && data.version.length > 0) {
      patch.runningVersion = data.version;
      patch.restartRequired = data.version !== APP_VERSION;
    }
    learn(patch);
  } catch {
    // Default to git / no restart hint on error
  }
};

/** Takes one reading of the newest release, from the route or from its frame. */
const learnRelease = (release: AppReleaseReading) => {
  // No release published: nothing to offer.
  if (release.tag === null || release.release === null) {
    learn({ updateAvailable: false, latestVersion: null, releaseInfo: null });
    return;
  }
  const latest = release.tag.replace(/^v/, '');
  // Only show update if latest version is actually newer
  learn({ latestVersion: latest, updateAvailable: compareVersions(latest, APP_VERSION) > 0, releaseInfo: release.release });
};

/**
 * Reads the server's newest reading of the release. A 503 is the server not having read GitHub yet:
 * the reading stands and the frame brings the answer when it lands.
 */
const readLatest = (): Promise<void> => {
  latestInFlight ??= (async () => {
    try {
      const response = await api.appRelease();
      if (!response.ok) return;
      const release = parseAppRelease(await response.json());
      if (release !== null) learnRelease(release);
    } catch (error) {
      console.error('Version check failed:', error);
      // On error, don't show update notification
      learn({ updateAvailable: false, latestVersion: null, releaseInfo: null });
    } finally {
      latestInFlight = null;
    }
  })();
  return latestInFlight;
};

/** The release from the route's body or the frame's, or null when it is neither shape. */
function parseAppRelease(value: unknown): AppReleaseReading | null {
  if (typeof value !== 'object' || value === null) return null;
  const tag: unknown = Reflect.get(value, 'tag');
  const release: unknown = Reflect.get(value, 'release');
  if (tag === null && release === null) return { tag: null, release: null };
  if (typeof tag !== 'string') return null;
  const info = parseReleaseInfo(release);
  return info === null ? null : { tag, release: info };
}

function parseReleaseInfo(value: unknown): ReleaseInfo | null {
  if (typeof value !== 'object' || value === null) return null;
  const title: unknown = Reflect.get(value, 'title');
  const body: unknown = Reflect.get(value, 'body');
  const htmlUrl: unknown = Reflect.get(value, 'htmlUrl');
  const publishedAt: unknown = Reflect.get(value, 'publishedAt');
  if (typeof title !== 'string' || typeof body !== 'string' || typeof htmlUrl !== 'string' || typeof publishedAt !== 'string') {
    return null;
  }
  return { title, body, htmlUrl, publishedAt };
}

/** A release frame is the reading itself; a reconnect means frames were missed, so the route is read once. */
const takeReleaseFrame = (event: ServerEvent) => {
  if (event.kind !== RELEASE_FRAME_KIND) {
    void readLatest();
    return;
  }
  const release = parseAppRelease(event);
  if (release !== null) learnRelease(release);
};

const getReading = () => reading;

/** The first reader reads the server's health and the release; a reader that comes later is handed what is known, which the release frame keeps current. */
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (listeners.size === 1) {
    void readHealth();
    void readLatest();
  }
  return () => {
    listeners.delete(listener);
  };
};

/**
 * The app's versions, read once for every reader: the newest release and whether it is newer than this build, how the app is
 * installed, and whether the server runs another version than this page was built from (`restartRequired`). Read by the sidebar
 * module's `Sidebar`, the settings module's `AboutTab` and project-workspace's `PlacesProvider` (the mark on Settings in the
 * wheel), which share the one reading. The release is the server's (GET /api/app-release, then app_release_state); which
 * repository it is of is the server's setting (`APP_RELEASE_REPO`).
 */
export const useVersionCheck = () => {
  const current = useSyncExternalStore(subscribe, getReading);
  useServerFrame(RELEASE_FRAME_KINDS, takeReleaseFrame);
  return { ...current, currentVersion: APP_VERSION };
};
