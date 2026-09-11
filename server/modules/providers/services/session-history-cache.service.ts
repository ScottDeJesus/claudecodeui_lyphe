import fsp from 'node:fs/promises';

import type { FetchHistoryResult } from '@/shared/types.js';

/**
 * Full-transcript cache for session history reads.
 *
 * Every provider history reader materializes the complete normalized
 * transcript and then slices out the requested page, so serving a 20-row page
 * of a large session re-read and re-parsed the whole transcript file on every
 * request — opening a session, each older page while scrolling up, and every
 * post-turn refresh. For a multi-megabyte JSONL that is most of a second of
 * CPU per request.
 *
 * Entries are keyed by app session id and validated with one `stat` per
 * request against the transcript file's identity (path + mtime + size), so
 * only the first read after the file changes pays the parse. Anything that
 * rewrites history (a new turn, an edit, a rewind, a fork) touches the file
 * and invalidates naturally; no explicit invalidation hooks exist or are
 * needed.
 *
 * One thing a history read draws on does NOT live in that file: a subagent's own sidechain
 * transcript, which the Claude reader parses for the agent's status, its timeline and its token
 * figures. An agent writes its sidechain continuously while its parent writes nothing, so the
 * parent's stat alone would hold a running agent's reading — and a backgrounded agent's `running`
 * — frozen for as long as the main thread stayed quiet (measured 2026-09-10: 22 activity entries
 * and 88,713 context tokens served while the sidechain held 38 and 115,446). Callers therefore
 * pass `companionStamp`: a value that moves when those files move. It is compared like the stat.
 *
 * Only history readers that read `jsonl_path` itself may use this cache —
 * callers pass `transcriptPath: null` for providers whose messages live
 * elsewhere (Cursor's store.db, OpenCode's shared SQLite), which bypasses
 * caching entirely.
 */

type CacheEntry = {
  transcriptPath: string;
  mtimeMs: number;
  /** File size in bytes; doubles as the entry's cost against the byte budget. */
  size: number;
  /** The caller's freshness value for whatever else the parse read (see `companionStamp`). */
  companionStamp: string;
  full: FetchHistoryResult;
};

type GetFullHistoryArgs = {
  sessionId: string;
  /** Path of the file the provider's history reader actually parses, or null to bypass. */
  transcriptPath: string | null | undefined;
  /** Loads the complete transcript (`limit: null, offset: 0`) from the provider. */
  loadFull: () => Promise<FetchHistoryResult>;
  /**
   * Freshness of the files the parse reads BESIDES the transcript — today the session's subagent
   * sidechains. A changed value invalidates the entry exactly as a changed stat does. Resolved
   * per request, so keep it cheap; omitted means "nothing else was read".
   */
  readCompanionStamp?: () => Promise<string> | string;
};

/**
 * A transcript entry's heap cost is roughly the file it was parsed from, so
 * the budget is expressed in file bytes. The newest entry is always retained
 * even when it alone exceeds the budget — evicting it would just re-parse the
 * same file on the next request.
 */
const MAX_CACHED_TRANSCRIPT_FILE_BYTES = 256 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 8;

export function createSessionHistoryCache(
  maxTotalFileBytes = MAX_CACHED_TRANSCRIPT_FILE_BYTES,
  maxEntries = MAX_CACHE_ENTRIES,
) {
  const entries = new Map<string, CacheEntry>();
  const pendingLoads = new Map<string, Promise<FetchHistoryResult>>();

  function evictOverBudget(): void {
    let totalBytes = 0;
    for (const entry of entries.values()) {
      totalBytes += entry.size;
    }
    for (const key of entries.keys()) {
      if (entries.size <= 1 || (totalBytes <= maxTotalFileBytes && entries.size <= maxEntries)) {
        break;
      }
      totalBytes -= entries.get(key)!.size;
      entries.delete(key);
    }
  }

  return {
    /**
     * Returns the session's full transcript through the cache, or null when
     * the session is not cacheable (no transcript path, or the file cannot be
     * stat'ed) — the caller then falls back to a plain provider read.
     */
    async getFullHistory({ sessionId, transcriptPath, loadFull, readCompanionStamp }: GetFullHistoryArgs): Promise<FetchHistoryResult | null> {
      if (!transcriptPath) {
        return null;
      }

      let stat;
      try {
        stat = await fsp.stat(transcriptPath);
      } catch {
        entries.delete(sessionId);
        return null;
      }
      if (!stat.isFile()) {
        entries.delete(sessionId);
        return null;
      }

      let companionStamp = '';
      try {
        companionStamp = (await readCompanionStamp?.()) ?? '';
      } catch {
        // Unreadable companions are treated as "changed": a parse is cheaper than serving a
        // reading whose freshness cannot be established.
        companionStamp = `unreadable:${Date.now()}`;
      }

      const cached = entries.get(sessionId);
      if (
        cached
        && cached.transcriptPath === transcriptPath
        && cached.mtimeMs === stat.mtimeMs
        && cached.size === stat.size
        && cached.companionStamp === companionStamp
      ) {
        // Re-insert to mark as most recently used.
        entries.delete(sessionId);
        entries.set(sessionId, cached);
        return cached.full;
      }

      // Concurrent requests for the same session share one parse. The file may
      // gain rows while the load runs; the pre-load stat is what the entry is
      // keyed by, so the next request would see a changed stat and re-read.
      const pending = pendingLoads.get(sessionId);
      if (pending) {
        return pending;
      }

      const load = loadFull().then((full) => {
        entries.delete(sessionId);
        entries.set(sessionId, {
          transcriptPath,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          companionStamp,
          full,
        });
        evictOverBudget();
        return full;
      });
      pendingLoads.set(sessionId, load);
      try {
        return await load;
      } finally {
        pendingLoads.delete(sessionId);
      }
    },
  };
}

export const sessionHistoryCache = createSessionHistoryCache();
