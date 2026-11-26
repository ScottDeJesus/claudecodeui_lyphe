import type { Router } from 'express';

import { resolveLaunchRow } from '@/modules/agent-launch/index.js';
import { sessionsDb } from '@/modules/database/index.js';
import { sessionsService } from '@/modules/providers/index.js';
import { WS_OPEN_STATE, broadcastSessionUpserted, connectedClients } from '@/modules/websocket/index.js';
import { sessionlessEnv } from '@/shared/child-env.js';
import { dispatcherBin } from '@/shared/dispatcher-command.js';
import type { DispatcherStoreWatch } from '@/shared/dispatcher-store-watch.service.js';
import { createPolledLane } from '@/shared/polled-lane.service.js';

import { startSpike } from './rnd-spike.service.js';
import { readRndState, type RndPicture, type RndStateEvent } from './rnd-state.service.js';
import { createRndRouter } from './rnd.routes.js';

/**
 * The R&D relay: the third twin of the roadmap and dispatcher lanes. It reads one document (`dispatcher rnd show --json`),
 * serves it as GET /api/rnd and the `rnd_state` frame, and relays the place's writes as `dispatcher rnd` verbs. It holds
 * no state and decides no word: the dispatcher owns the candidates, their words, the settings and the refusals.
 *
 * The lane has no timer of its own (no interval, no backstop): it reads when the store watch pokes it (a store write the
 * board gate lets through, a re-armed watch) and when a route here wrote. The picture moves only by store writes, so
 * there is nothing a clock would catch that those events do not.
 */

/** Wall-clock ceiling for one command. `rnd scout --now` opens a launch before it answers: seconds, not milliseconds. */
const COMMAND_TIMEOUT_MS = 30_000;

/** How long a read waits for this boot's first `rnd show --json` before it is told "not read yet". */
const FIRST_READ_WAIT_MS = 5000;

/** The launch-table row the spike chat's model is read from (`launch-table resolve rnd.spike --side claude`). */
const SPIKE_ROW = 'rnd.spike';

export type RndModule = { router: Router; start(): void; stop(): void };

/** `storeWatch` is the one watch the dispatcher's lanes share; the entrypoint builds and starts it before any lane. */
export function createRndModule(storeWatch: DispatcherStoreWatch): RndModule {
  const commands = { bin: dispatcherBin(), timeoutMs: COMMAND_TIMEOUT_MS, env: sessionlessEnv() };

  const broadcast = (frame: RndStateEvent): void => {
    const message = JSON.stringify(frame);
    connectedClients.forEach((client) => {
      if (client.readyState === WS_OPEN_STATE) client.send(message);
    });
  };

  // Each distinct failure said once for the life of the process: a read that keeps failing would bury the journal.
  const said = new Set<string>();
  const logErrorOnce = (message: string): void => {
    if (said.has(message)) return;
    said.add(message);
    console.error(`[R&D] ${message}`);
  };

  const lane = createPolledLane<RndPicture, RndStateEvent>({
    snapshot: async () => withSpikeChats(await readRndState(commands)),
    frame: (picture) => ({ kind: 'rnd_state', ...picture, at: Date.now() }),
    // The roadmap lane's reason: `generated_at` moves at every read, so compared whole the lane would speak after each one.
    serialize: (picture) => JSON.stringify({ ...picture, generated_at: undefined }),
    broadcast,
    // No timer: the store watch's pokes and this module's own writes are every change the picture can see.
    backstopMs: null,
    logError: logErrorOnce,
  });

  const resolveModel = async (): Promise<{ ok: true; model: string } | { ok: false; error: string }> => {
    const answer = await resolveLaunchRow(SPIKE_ROW);
    if (!answer.ok) return { ok: false, error: answer.message };
    const model = answer.value['model'];
    if (typeof model !== 'string' || model === '') return { ok: false, error: `launch-table resolve ${SPIKE_ROW} named no model` };
    return { ok: true, model };
  };

  const spikeDependencies = {
    commands,
    resolveModel,
    // Made as the page's New chat makes one: on the simple list, then announced, so the spike's chat is listed like any other.
    createSession: (projectPath: string, prompt: string): string => {
      const { sessionId } = sessionsService.createAppSession('claude', projectPath, prompt, true);
      broadcastSessionUpserted(sessionId).catch((error: unknown) => logErrorOnce(`a spike chat was made but not announced: ${String(error)}`));
      return sessionId;
    },
    deleteSession: (sessionId: string): void => {
      sessionsDb.deleteSessionById(sessionId);
    },
  };

  const router = createRndRouter({
    commands,
    current: () => lane.whenLanded(FIRST_READ_WAIT_MS),
    poke: () => lane.poke(),
    spike: (name, projectPath) => startSpike(spikeDependencies, name, projectPath),
  });

  let detach: (() => void) | null = null;

  return {
    router,
    start: () => {
      // Attached before the first reading, so a write that lands during it is remembered as a poke.
      detach ??= storeWatch.attach('rnd', () => lane.poke());
      lane.start();
    },
    stop: () => {
      detach?.();
      detach = null;
      lane.stop();
    },
  };
}

/**
 * Each spike's chats as this app names them. `session` is the spike's own chat, stamped by the R&D place with the app's id;
 * `launched_from` is the chat a spike with no chat of its own was launched from, stamped by the /spike skill with the CLI's
 * `$CLAUDE_CODE_SESSION_ID` (a provider id). Both are read through the sessions table (`resolveAppSessionId`, as the
 * dispatcher lanes read their stamps) so the card opens by the app's id. The place's own chat runs /spike too and its skill
 * stamps that chat as the launcher: a launcher that is the spike's own chat is dropped. The launcher's name rides along for
 * "Launched from"; a chat no row carries keeps its stamp and no name.
 */
function withSpikeChats(picture: RndPicture): RndPicture {
  const candidates = picture.candidates.map((candidate) => {
    const { spike } = candidate;
    if (spike === null) return candidate;
    const own = spike.session === null ? null : appChatOf(spike.session);
    const launcher = spike.launched_from === null ? null : appChatOf(spike.launched_from);
    const outside = launcher === null || (own !== null && launcher.id === own.id) ? null : launcher;
    return {
      ...candidate,
      spike: { ...spike, session: own?.id ?? null, launched_from: outside?.id ?? null, launched_from_name: outside?.name ?? null },
    };
  });
  return { ...picture, candidates };
}

/** One stamp as the app's chat: its app id and name, or the stamp itself and no name when no row carries it. */
function appChatOf(stamp: string): { id: string; name: string | null } {
  const appSessionId = sessionsDb.resolveAppSessionId(stamp);
  const row = sessionsDb.getSessionById(appSessionId);
  return row === null || row === undefined ? { id: stamp, name: null } : { id: appSessionId, name: row.custom_name ?? null };
}
