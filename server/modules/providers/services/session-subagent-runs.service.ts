import { sessionsDb } from '@/modules/database/index.js';
import { listRunningLaunchers } from '@/modules/dispatch-souls/index.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { sessionHistoryCache } from '@/modules/providers/services/session-history-cache.service.js';
import {
  RUNNING_BELIEVED_FOR_MS,
  hasFreshSubagentSidechains,
  readHistoryCompanionStamp,
  runningSubagents,
} from '@/modules/providers/services/session-agents.service.js';
import type { RunningSubagent } from '@/modules/providers/services/session-agents.service.js';
import type { LLMProvider } from '@/shared/types.js';

/**
 * Which conversations have an agent running right now — the answer behind the sidebar's purple dot.
 * A conversation counts when EITHER of two things is true:
 *
 * 1. Its own transcript shows a backgrounded `Agent` call still out (the sidechain reading below).
 * 2. A soul or chain it LAUNCHED BY HAND through the dispatch door (`plan-runner chain`,
 *    `plan-runner soul`) is still out. That process is a child of nothing the chat can see — it
 *    streams no sidechain into the transcript — so the only record of it is the launcher's, stamped
 *    with the CLI session id that launched it (`listRunningLaunchers`, in the dispatch-souls module).
 *    The stamp is the CLI's id and the dot is the app's, so each one is mapped through the sessions
 *    table, and an id the app does not know is skipped. A chain keeps the dot lit between its stages,
 *    where no soul is running but the walker still is. The dispatcher's own work for a plan the chat
 *    started carries the chat's stamp too, but it is not the chat's launch and lights nothing
 *    (`listRunningLaunchers` skips it, as the chat's Subagents list does).
 *
 * The sidebar's run marks could not say either before: they come from `listRunningSessions`, which
 * reads `chatRunRegistry`, and a run leaves that registry the moment its turn ends. A BACKGROUNDED
 * `Agent` call outlives the turn that launched it — the run is over, the agent is still out there —
 * and that is the ordinary case, not an edge one; a dispatched soul outlives the turn by an hour.
 * Nothing client-side can answer either: the chat a dot belongs to is usually not open, so its
 * transcript is not loaded anywhere. So the server answers.
 *
 * The sidechain reading's rule is `runningSubagents`', which is the pinned strip's: same
 * container selection, same four-hour window. The two readings part in one place — the strip times
 * a row from `subagent.resume.at ?? message.timestamp`, this one from the launch — so a resume more
 * than four hours after its launch leaves the strip's row pinned while this answer stays dark.
 *
 * Cost is the reason this file has the shape it does. A pass on every poke cannot read every
 * conversation, and it does not have to: the candidates are bounded to a window, and a transcript
 * read is skipped entirely unless something on disk says the session could hold a running agent
 * (`hasFreshSubagentSidechains`). What is left rides the same `sessionHistoryCache` the chat's own
 * history reads use, keyed on the same subagent stamp, so a session the reader has open is parsed
 * once for both. The dispatched reading costs a directory listing bounded by the launcher's own
 * recency window and a few small files per live launch, and rides the same cached pass.
 *
 * WHAT EACH RUNNING AGENT IS MADE OF rides the same pass: `listSubagentRunningModels` answers, for each such conversation, the
 * model of every agent it has out (`''` for one that has not named its model yet), so the sessions board can draw a dot for
 * each in its model's colour. A chain that is between stages is one agent of no model; a chain with a soul out is that soul.
 */

/** A ceiling on one pass, in sessions. Twice the busiest four hours this box has recorded. */
const MAX_CANDIDATES = 500;

/**
 * How long one answer is reused. Two reasons, and both are real: the lane's pokes arrive in bursts (a
 * run's change and a watcher flush land together), and the tail of a pass is a transcript parse. Short enough that a
 * dot's appearance or disappearance is never the thing the reader waits on.
 */
const ANSWER_TTL_MS = 2_000;

type Candidate = {
  sessionId: string;
  provider: LLMProvider;
  providerSessionId: string | null;
  projectPath: string | null;
  transcriptPath: string;
};

/**
 * The sessions one pass may consider: every conversation touched inside the running window, plus
 * the live runs.
 *
 * The window is the honest bound, not a shortcut. An agent is only ever believed running for
 * `RUNNING_BELIEVED_FOR_MS` from its LAUNCH, and a turn cannot end before it launched its own
 * agents — so a session holding a running agent wrote to disk inside that same window and is
 * always in this set. The live runs are added rather than assumed: a run's row is not what the
 * registry holds, and a run admitted against a row the window has aged out must still be looked at.
 */
function candidateSessions(now: number): Candidate[] {
  const sinceIso = new Date(now - RUNNING_BELIEVED_FOR_MS).toISOString();
  const byId = new Map<string, Candidate>();

  const add = (row: ReturnType<typeof sessionsDb.getSessionById>): void => {
    if (!row?.session_id || !row.jsonl_path || byId.has(row.session_id)) {
      return;
    }
    byId.set(row.session_id, {
      sessionId: row.session_id,
      provider: row.provider as LLMProvider,
      providerSessionId: row.provider_session_id,
      projectPath: row.project_path,
      transcriptPath: row.jsonl_path,
    });
  };

  const rows = sessionsDb.getSessionsActiveSince(sinceIso, MAX_CANDIDATES);
  // The ceiling is a bound on one pass, and it truncates the OLDEST end of the window — the
  // sessions whose agents are nearest the edge of the belief window, which is to say the ones this
  // question is most likely to be about. Five times today's widest window, so it should never bite;
  // if it ever does, it says so rather than answering from a pass that quietly skipped rows.
  if (rows.length === MAX_CANDIDATES) {
    console.warn(
      `[SubagentRuns] The ${RUNNING_BELIEVED_FOR_MS / 3_600_000}h candidate window filled its ceiling of `
      + `${MAX_CANDIDATES} sessions; the oldest are not being scanned this pass.`,
    );
  }
  for (const row of rows) {
    add(row);
  }
  for (const run of chatRunRegistry.listRunningRuns()) {
    add(sessionsDb.getSessionById(run.sessionId));
  }

  return [...byId.values()];
}

/**
 * The agents one conversation has running, each with its model and launch, read through the history cache: empty when it has none.
 *
 * `transcriptPath: null` is not a case here — the candidate set is built from rows that carry one —
 * but a transcript that has since been deleted is: the cache answers null for it and the session is
 * simply not a hit.
 */
async function sessionRunningSubagents(candidate: Candidate, now: number): Promise<RunningSubagent[]> {
  const providerSessions = providerRegistry.resolveProvider(candidate.provider).sessions;
  const providerSessionId = candidate.providerSessionId ?? candidate.sessionId;

  const fullHistory = await sessionHistoryCache.getFullHistory({
    sessionId: candidate.sessionId,
    transcriptPath: candidate.transcriptPath,
    // The same load, with the same options, as `sessionsService.fetchHistory` builds for a latest
    // page — deliberately, because it is the same cache entry: an open chat's own history read and
    // this pass must never be two parses of one transcript.
    loadFull: () => providerSessions.fetchHistory(candidate.sessionId, {
      limit: null,
      offset: 0,
      projectPath: candidate.projectPath ?? '',
      providerSessionId,
    }),
    readCompanionStamp: () => readHistoryCompanionStamp(candidate.sessionId, candidate.transcriptPath, providerSessionId),
  });

  return fullHistory ? runningSubagents(fullHistory.messages, now) : [];
}

/**
 * Narrows the candidates to the ones a transcript read is worth spending on.
 *
 * Claude records every spawned agent as a sidechain beside its parent transcript, and a running one
 * writes it continuously — so a session whose sidechains are all older than the window holds no
 * running agent (`hasFreshSubagentSidechains` carries the proof). That check is a `readdir` and a
 * handful of `stat`s, against the hundreds of milliseconds a parent parse costs.
 *
 * Codex has no such per-session footprint — its agents are rollouts filed by DATE, beside every
 * other session's that day, so there is nothing cheap to ask and it goes straight to the read. It
 * is also a rounding error of this estate; the day it is not, the footprint is what to add.
 */
async function needsTranscriptRead(candidate: Candidate, now: number): Promise<boolean> {
  if (candidate.provider !== 'claude') {
    return true;
  }
  try {
    return await hasFreshSubagentSidechains(
      candidate.transcriptPath,
      candidate.providerSessionId ?? candidate.sessionId,
      now,
    );
  } catch {
    // An unreadable sidechain directory is not evidence of absence: read the transcript rather
    // than drop a session whose agent may be running.
    return true;
  }
}

/** One sidechain pass: who has agents out, with their models, and the earliest launch among them (`null` when none has a time). */
type SidechainReading = { running: Map<string, string[]>; earliestLaunchAt: number | null };

/** The conversations whose own transcript shows an agent still out, each with the models of the agents it has out. */
async function collectSidechainRunning(now: number): Promise<SidechainReading> {
  const candidates = candidateSessions(now);
  // The cheap narrowing runs together — it is all directory reads — and the parses behind it run
  // one at a time: they are CPU-bound, and a box with a dozen live agents should parse a dozen
  // transcripts in sequence rather than hold a dozen normalized histories in memory at once.
  const wanted = await Promise.all(candidates.map((candidate) => needsTranscriptRead(candidate, now)));

  const running = new Map<string, string[]>();
  let earliestLaunchAt: number | null = null;
  for (let index = 0; index < candidates.length; index += 1) {
    if (!wanted[index]) {
      continue;
    }
    const candidate = candidates[index];
    try {
      const agents = await sessionRunningSubagents(candidate, now);
      if (agents.length > 0) {
        running.set(candidate.sessionId, agents.map((agent) => agent.model));
      }
      for (const { launchedAt } of agents) {
        if (launchedAt !== null && (earliestLaunchAt === null || launchedAt < earliestLaunchAt)) earliestLaunchAt = launchedAt;
      }
    } catch (error) {
      // One unreadable conversation never takes the endpoint down with it: the dot is missing for
      // this session this pass, and the next pass tries again.
      console.error(`[SubagentRuns] Could not read session ${candidate.sessionId}:`, error);
    }
  }

  return { running, earliestLaunchAt };
}

/**
 * The app's id for the conversation a CLI session id belongs to, or `null` when the app has never
 * heard of it. `resolveAppSessionId` hands an unknown id back unchanged, so the row is looked up
 * once more to tell a translation from an echo — and it follows a conversation through a rewind,
 * which a plain provider-id lookup would not.
 */
function appSessionIdForCliSession(cliSessionId: string): string | null {
  const appSessionId = sessionsDb.resolveAppSessionId(cliSessionId);
  return sessionsDb.getSessionById(appSessionId) ? appSessionId : null;
}

/**
 * The conversations that launched a soul or a chain which is still out, in the app's own ids, each with the models of what it has
 * out: one entry for each running soul, and one of no model (`''`) for a chain between stages, where the walker is out and no
 * soul is. A chain with a soul out adds nothing of its own: that soul is already counted.
 */
function collectDispatchedRunning(now: number): Map<string, string[]> {
  const souls = new Map<string, string[]>();
  const chains = new Set<string>();
  for (const launcher of listRunningLaunchers(now / 1000)) {
    const appSessionId = appSessionIdForCliSession(launcher.cliSessionId);
    if (appSessionId === null) continue;
    if (launcher.reason === 'chain') chains.add(appSessionId);
    else souls.set(appSessionId, [...(souls.get(appSessionId) ?? []), launcher.model]);
  }
  for (const appSessionId of chains) {
    if (!souls.has(appSessionId)) souls.set(appSessionId, ['']);
  }
  return souls;
}

/** One whole pass: every conversation with an agent out, and the instant that answer lapses with nothing written. */
type RunningPass = { running: Map<string, string[]>; lapseAt: number | null };

/** Every conversation with an agent out, with the models of all it has out: its own transcript's agents first, then what it dispatched. */
async function collectRunning(now: number): Promise<RunningPass> {
  const { running, earliestLaunchAt } = await collectSidechainRunning(now);
  try {
    for (const [appSessionId, models] of collectDispatchedRunning(now)) {
      running.set(appSessionId, [...(running.get(appSessionId) ?? []), ...models]);
    }
  } catch (error) {
    // The launcher's records are the second source, not the first: a fault reading them costs the
    // dispatched dots this pass, never the sidechain dots the pass already holds.
    console.error('[SubagentRuns] Could not read the dispatched souls and chains:', error);
  }
  return { running, lapseAt: earliestLaunchAt === null ? null : earliestLaunchAt + RUNNING_BELIEVED_FOR_MS };
}

/** When the pass behind `cached` STARTED: an answer is only as new as the moment its reading began. */
let cachedStartedAt = 0;
let cached: ReadonlyMap<string, readonly string[]> = new Map();
let lastLapseAt: number | null = null;
let inFlight: Promise<ReadonlyMap<string, readonly string[]>> | null = null;
let inFlightStartedAt = 0;

/**
 * The one pass behind both answers below, reused briefly and never computed twice at once (`inFlight`): the route and the
 * running-sessions lane both ask it, and the lane's pokes come in bursts.
 *
 * `freshFrom` is the instant a caller's answer must not predate: a pass that began before it (cached or still out) is not
 * taken. The lane passes the start of its reading, so a poke for a write it has just heard of (a soul ending, an agent
 * reporting back) is never answered by a pass that read the disk before that write. The route passes nothing and takes any
 * answer inside the reuse window.
 */
async function runningNow(now: number, freshFrom: number = 0): Promise<ReadonlyMap<string, readonly string[]>> {
  if (cachedStartedAt >= freshFrom && now - cachedStartedAt < ANSWER_TTL_MS) {
    return cached;
  }
  if (inFlight) {
    if (inFlightStartedAt >= freshFrom) return inFlight;
    // A pass that began too early is let finish (one pass at a time), and the question is asked again after it.
    await inFlight.then(() => undefined, () => undefined);
    return runningNow(Date.now(), freshFrom);
  }

  const startedAt = Date.now();
  inFlightStartedAt = startedAt;
  inFlight = collectRunning(now)
    .then(({ running, lapseAt }) => {
      cached = running;
      lastLapseAt = lapseAt;
      cachedStartedAt = startedAt;
      return running;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/**
 * The ids of the conversations with an agent running right now — a sidechain `Agent` or a
 * dispatched soul or chain — sorted.
 *
 * Every caller gets its own array: the cached answer is shared state, and a caller that sorted or
 * spliced it in place would be editing the answer the lane's next pass reads.
 */
export async function listSubagentRunningSessionIds(now: number = Date.now(), freshFrom: number = 0): Promise<string[]> {
  return [...(await runningNow(now, freshFrom)).keys()].sort();
}

/**
 * For each of those conversations, the model of every agent it has running (`''` for one whose model is not recorded): the same
 * pass as `listSubagentRunningSessionIds`, so the two never disagree about which conversations have one. A fresh object and fresh
 * arrays for every caller, for the same reason.
 *
 * Consumed by the running-sessions route (`provider.routes.ts`) as `subagentModels`.
 */
export async function listSubagentRunningModels(now: number = Date.now(), freshFrom: number = 0): Promise<Record<string, string[]>> {
  const models: Record<string, string[]> = {};
  for (const [sessionId, held] of await runningNow(now, freshFrom)) {
    models[sessionId] = [...held];
  }
  return models;
}

/**
 * The instant the last pass's answer next changes with nothing written: the earliest launch among the agents it believed out,
 * plus `RUNNING_BELIEVED_FOR_MS`, past which that agent is no longer believed. `null` when it believed none out by a launch time.
 * The running-sessions lane arms its one deadline to it (`running-sessions.lane.ts`). A dispatched soul has no such instant: its
 * end is the launcher's own change, which the lane hears.
 */
export function subagentRunsLapseAt(): number | null {
  return lastLapseAt;
}
