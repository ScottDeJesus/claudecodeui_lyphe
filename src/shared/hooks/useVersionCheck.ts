import { useSyncExternalStore } from 'react';

import { APP_VERSION } from '@/shared/constants';
import type { InstallMode, ReleaseInfo } from '@/shared/types';

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

/** How often the newest release is asked for, in ms. */
const POLL_MS = 5 * 60 * 1000;

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

type VersionStore = { read: () => VersionReading; subscribe: (listener: () => void) => () => void };

/** One store per repository asked about, shared by every reader: one poll and one health read however many screens read it. */
const stores = new Map<string, VersionStore>();

function storeFor(owner: string, repo: string): VersionStore {
  const key = `${owner}/${repo}`;
  const known = stores.get(key);
  if (known !== undefined) return known;

  const listeners = new Set<() => void>();
  let reading = NOTHING_KNOWN;
  let timer: ReturnType<typeof setInterval> | null = null;
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

  const readLatest = async () => {
    try {
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`);
      const data = await response.json();

      // Handle the case where there might not be any releases
      if (data.tag_name) {
        const latest = data.tag_name.replace(/^v/, '');
        learn({
          latestVersion: latest,
          // Only show update if latest version is actually newer
          updateAvailable: compareVersions(latest, APP_VERSION) > 0,
          releaseInfo: {
            title: data.name || data.tag_name,
            body: data.body || '',
            htmlUrl: data.html_url || `https://github.com/${owner}/${repo}/releases/latest`,
            publishedAt: data.published_at,
          },
        });
      } else {
        // No releases found, don't show update notification
        learn({ updateAvailable: false, latestVersion: null, releaseInfo: null });
      }
    } catch (error) {
      console.error('Version check failed:', error);
      // On error, don't show update notification
      learn({ updateAvailable: false, latestVersion: null, releaseInfo: null });
    }
  };

  const store: VersionStore = {
    read: () => reading,
    // The first reader starts the reads (the server's health once, the newest release now and every five minutes); the last to go
    // stops the poll. A reader that comes later is handed what is already known.
    subscribe: (listener) => {
      listeners.add(listener);
      if (timer === null) {
        void readHealth();
        void readLatest();
        timer = setInterval(() => void readLatest(), POLL_MS);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer !== null) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
  };
  stores.set(key, store);
  return store;
}

/**
 * The app's versions, read once for every reader: the newest release of `owner/repo` and whether it is newer than this build, how the
 * app is installed, and whether the server runs another version than this page was built from (`restartRequired`). Read by the
 * sidebar module's `Sidebar`, the settings module's `AboutTab` and project-workspace's `PlacesProvider` (the mark on Settings in the
 * wheel), which share the one poll.
 */
export const useVersionCheck = (owner: string, repo: string) => {
  const store = storeFor(owner, repo);
  const reading = useSyncExternalStore(store.subscribe, store.read);
  return { ...reading, currentVersion: APP_VERSION };
};
