/**
 * The API's host registry: its one instance of `createHostRegistry` (host-registry.js) over this
 * machine's `cloudcli-sessions` tmux server, and the types this package reads a host through.
 *
 * What the registry does — liveness is the tmux session and never the meta file; a host is retired
 * through its socket and never a signal — and why lives in host-registry.js, which is plain
 * JavaScript so a process other than the API can run the same code. This file fixes the three
 * constants that make the instance THIS server's and re-exports each function under its
 * TypeScript type, so the call sites in this package read as they always have.
 *
 * Package-internal except `listLiveHosts` and `LiveHost`, which index.ts re-exports.
 * consumer: spawner.ts, readopt.ts, idle-version-sweep.ts
 */

import os from 'node:os';
import path from 'node:path';

import type { IdleCheck } from '@/shared/types.js';

import { createHostRegistry } from './host-registry.js';

/** The tmux server that outlives the API. Its `_keepalive` session is what keeps it up. */
export const TMUX_SOCKET_NAME = 'cloudcli-sessions';
export const KEEPALIVE_SESSION = '_keepalive';

/** D-1: on disk, not tmpfs — a long turn's journal must not live in RAM. */
export const sessionsDir =
  process.env.CLOUDCLI_SESSIONS_DIR || path.join(os.homedir(), '.cloudcli', 'sessions');

export type HostMeta = {
  hostId: string;
  appSessionId: string | null;
  userId: string | number | null;
  cwd: string | null;
  startedAt: number;
  pid: number | null;
  turnCompleteSent: boolean;
  heldForBackgroundWork: boolean;
  deferredTools?: string[];
  profile?: Record<string, unknown> | null;
  deliveredSeq: number;
  pendingResults: number[];
  /** Delivered `control_request`s the API has not answered on stdin; absent on a meta from before the field. */
  pendingControl?: { seq: number; requestId: string }[];
  /** The idle compaction check's record for the last turn end; absent on a meta from before the field. */
  idleCheck?: IdleCheck | null;
  exited: { code: number | null; signal: string | null; at: number } | null;
};

export type LiveHost = {
  hostId: string;
  appSessionId: string;
  userId: string | number | null;
  cwd: string | null;
  startedAt: number;
  turnCompleteSent: boolean;
  heldForBackgroundWork: boolean;
  deferredTools: string[];
  /**
   * The calls the meta still names that the host's journal shows reported finished — `deferredTools`
   * already leaves them out. The host alone writes its meta, so re-adoption tells it (`spawner.ts`) and
   * the next boot reads a meta that no longer holds them. A node's host carries it from its warden's listing (`[]`
   * from a warden that predates the field).
   */
  releasedCalls?: string[];
  /**
   * The ids of the CLI's own background tasks the host's journal shows running (`host-live-tasks.js`): what the
   * runtime's `backgroundTasks` held, rebuilt for a process that has just been re-adopted. Every kind of task
   * counts, so a host with one is busy to the version sweep and the activity reading and to the process's idle closer.
   * `null` on a node's host whose warden predates the field: its tasks are unknown, which is not the same as none.
   */
  liveTasks?: string[] | null;
  /** The meta's record of the idle compaction check for the host's last turn end, or null. */
  idleCheck?: IdleCheck | null;
  profile: Record<string, unknown> | null;
  /**
   * The CLI version this host's own process announced at init, read out of ITS journal — null when
   * the journal holds no such line. The runtime's launch profile carries it, so a process adopted
   * after a restart knows what it runs and is retired at its next message when the binary on disk
   * is newer (see `lastReportedCliVersion`).
   */
  cliVersion: string | null;
  /**
   * The pid of the CLI this host owns — `child.pid` in `host.js`, recorded in the meta — or null for a
   * meta that holds none. The claude-activity module uses it to tell a host's own CLI from a `claude`
   * process nothing here knows about.
   */
  cliPid: number | null;
};

export type TmuxResult = { ok: boolean; stdout: string; error: string | null };

/** consumer: spawner.ts — `spawnHostSession` and `connectToHost` are the spawn path's own two steps. */
export const registry = createHostRegistry({
  tmuxSocketName: TMUX_SOCKET_NAME,
  keepaliveSession: KEEPALIVE_SESSION,
  sessionsDir
});

// Each name below is the registry's function under the type the rest of this package is written
// against. The annotation is the drift guard: a registry whose JSDoc stops matching `HostMeta` or
// `LiveHost` fails the typecheck here instead of at a call site.
export const hostSocketPath: (hostId: string) => string = registry.hostSocketPath;
export const hostJournalPath: (hostId: string) => string = registry.hostJournalPath;
export const hostMetaPath: (hostId: string) => string = registry.hostMetaPath;
export const tmuxCommand: (args: string[]) => TmuxResult = registry.tmuxCommand;
export const isTmuxSessionAlive: (name: string) => boolean = registry.isTmuxSessionAlive;
/** The unit's own session: its absence means the whole keepalive server is down. */
export const isKeepaliveServerUp: () => boolean = registry.isServerUp;
export const liveSessionNames: () => Set<string> | null = registry.liveSessionNames;
export const readHostMeta: (hostId: string) => HostMeta | null = registry.readHostMeta;
export const listHostIds: () => string[] = registry.listHostIds;
export const listLiveHosts: () => LiveHost[] = registry.listLiveHosts;
export const lastTurnFinishedAt: (hostId: string) => number | null = registry.lastTurnFinishedAt;
/** consumer: claude-compaction-restore.ts — a re-adopted chat's last turn end, for its idle deadline. */
export const lastTurnRecord: <Budget>(
  hostId: string,
  readBudget: (message: Record<string, unknown>) => Budget | null
) => { endedAt: number; modelUsage: unknown; budget: Budget | null } | null = registry.lastTurnRecord;
export const lastReportedCliVersion: (hostId: string) => string | null = registry.lastReportedCliVersion;
export const removeHostJournal: (hostId: string) => void = registry.removeHostJournal;
export const retireHost: (hostId: string) => void = registry.retireHost;
export const retireOlderHosts: (
  hosts: LiveHost[],
  retire?: (hostId: string) => void
) => LiveHost[] = registry.retireOlderHosts;
export const sweepDeadHosts: () => number = registry.sweepDeadHosts;
