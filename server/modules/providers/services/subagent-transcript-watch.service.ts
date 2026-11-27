import { IN_FLIGHT_BELIEVED_FOR_MS } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { subagentTranscriptService } from '@/modules/providers/services/subagent-transcript.service.js';
import { WS_OPEN_STATE, laneWatch } from '@/modules/websocket/index.js';
import { createFileLane, type FileLane } from '@/shared/file-lane.service.js';
import { createPacedHint, type PacedHint } from '@/shared/paced-hint.service.js';
import type { SubagentTranscriptChangedEvent } from '@/shared/types.js';

/**
 * The tail behind an open subagent transcript view: the `subagent_transcript` lane of `laneWatch`.
 *
 * A key is `agent:<appSessionId>:<toolUseId>` (an `Agent` row of a chat) or `soul:<launchId>` (a
 * launcher soul). Its first watcher opens a file lane on the directory the transcript route reads for
 * it: the chat's subagents directory (`subagentTranscriptService.subagentsDirectory`, by the rule
 * `session-agents.service.ts` holds) or the launch's record directory (handed in by the dispatch-souls
 * module, by the rule its transcript service holds). ONE lane per directory, shared by every key under
 * it: a write there tells each of them, and each key's paced hint sends at most one frame a second,
 * only to the sockets watching that key.
 *
 * One timer per key is armed when it is first watched and again after each frame, for the window the
 * route's `inFlight` answer is bounded by (`IN_FLIGHT_BELIEVED_FOR_MS`). When it lapses with nothing
 * written, one last frame goes out, so a view of an agent that died mid-write reads once more and sees
 * `inFlight` false. The last watcher of a key stops its hint and timer; the last key of a directory
 * closes its lane.
 */

export type SubagentTranscriptWatchDependencies = {
  /** A launch's record directory, or `null` for an id that is not a launch id. */
  soulRecordDirectory(launchId: string): string | null;
};

const LANE = 'subagent_transcript';
const FRAME_KIND: SubagentTranscriptChangedEvent['kind'] = 'subagent_transcript_changed';
/** At most one frame a second per key: a list of steps that lands once a second beats one that repaints per line. */
const HINT_MIN_GAP_MS = 1_000;
const AGENT_KEY_PREFIX = 'agent:';
const SOUL_KEY_PREFIX = 'soul:';
/** What a soul writes as it works: its child's stream, and at its end the receipt. */
const SOUL_RECORD_NAMES: ReadonlySet<string> = new Set(['child.log', 'result.json']);
const NO_NAMES: ReadonlySet<string> = new Set();
const SIDECHAIN_SUFFIX = '.jsonl';

type DirectorySpec = { directory: string; names: ReadonlySet<string>; matches?: (name: string) => boolean };
type WatchedDirectory = { lane: FileLane; keys: Set<string> };
type WatchedKey = { directory: string; hint: PacedHint; quiet: NodeJS.Timeout | null };

const directories = new Map<string, WatchedDirectory>();
const watchedKeys = new Map<string, WatchedKey>();

/** Defines the lane; called once by the dispatch-souls module, which knows where a launch is kept. */
export function defineSubagentTranscriptWatch(dependencies: SubagentTranscriptWatchDependencies): void {
  laneWatch.define(LANE, {
    first: (key) => {
      if (key !== null) startKey(key, dependencies);
    },
    last: (key) => {
      if (key !== null) stopKey(key);
    },
  });
}

function startKey(key: string, dependencies: SubagentTranscriptWatchDependencies): void {
  if (watchedKeys.has(key)) return;
  const spec = resolveDirectory(key, dependencies);
  if (spec === null) {
    logError(`no transcript directory for watched key ${key}`);
    return;
  }
  const hint = createPacedHint({
    kind: FRAME_KIND,
    minGapMs: HINT_MIN_GAP_MS,
    send: (frame) => {
      sendFrame(key, frame.at);
      armQuietWindow(key);
    },
  });
  watchedKeys.set(key, { directory: spec.directory, hint, quiet: null });
  armQuietWindow(key);
  openDirectory(spec).keys.add(key);
}

function stopKey(key: string): void {
  const watched = watchedKeys.get(key);
  if (!watched) return;
  watchedKeys.delete(key);
  watched.hint.stop();
  if (watched.quiet !== null) clearTimeout(watched.quiet);

  const directory = directories.get(watched.directory);
  if (!directory) return;
  directory.keys.delete(key);
  if (directory.keys.size > 0) return;
  directory.lane.stop();
  directories.delete(watched.directory);
}

/** The directory the transcript route reads for this key, with the names in it that are the transcript's. */
function resolveDirectory(key: string, dependencies: SubagentTranscriptWatchDependencies): DirectorySpec | null {
  if (key.startsWith(SOUL_KEY_PREFIX)) {
    const directory = dependencies.soulRecordDirectory(key.slice(SOUL_KEY_PREFIX.length));
    return directory === null ? null : { directory, names: SOUL_RECORD_NAMES };
  }
  if (key.startsWith(AGENT_KEY_PREFIX)) {
    const rest = key.slice(AGENT_KEY_PREFIX.length);
    const separator = rest.lastIndexOf(':');
    if (separator <= 0 || separator === rest.length - 1) return null;
    const directory = subagentTranscriptService.subagentsDirectory(rest.slice(0, separator));
    // The agent's own file is named for its agent id, which the key does not carry, so any sidechain
    // of the chat counts; a sibling agent's write costs this view one read.
    return directory === null ? null : { directory, names: NO_NAMES, matches: isSidechain };
  }
  return null;
}

function openDirectory(spec: DirectorySpec): WatchedDirectory {
  const existing = directories.get(spec.directory);
  if (existing) return existing;
  const keys = new Set<string>();
  const lane = createFileLane({
    dir: spec.directory,
    names: spec.names,
    matches: spec.matches,
    tell: () => {
      for (const key of keys) watchedKeys.get(key)?.hint.tell();
    },
    logError: (message) => logError(`${spec.directory}: ${message}`),
  });
  const watched: WatchedDirectory = { lane, keys };
  directories.set(spec.directory, watched);
  lane.start();
  return watched;
}

function armQuietWindow(key: string): void {
  const watched = watchedKeys.get(key);
  if (!watched) return;
  if (watched.quiet !== null) clearTimeout(watched.quiet);
  watched.quiet = setTimeout(() => {
    watched.quiet = null;
    sendFrame(key, Date.now());
  }, IN_FLIGHT_BELIEVED_FOR_MS);
  // A pending last frame is no reason to keep the process alive at shutdown.
  watched.quiet.unref();
}

function sendFrame(key: string, at: number): void {
  const frame: SubagentTranscriptChangedEvent = { kind: FRAME_KIND, at, key };
  const message = JSON.stringify(frame);
  for (const socket of laneWatch.sockets(LANE, key)) {
    if (socket.readyState !== WS_OPEN_STATE) continue;
    try {
      socket.send(message);
    } catch (error) {
      // A socket closing mid-send: its close handler drops its watches, the other watchers still get the frame.
      logError(`send of ${key} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function isSidechain(name: string): boolean {
  return name.endsWith(SIDECHAIN_SUFFIX);
}

function logError(message: string): void {
  console.error(`[SubagentTranscriptWatch] ${message}`);
}
