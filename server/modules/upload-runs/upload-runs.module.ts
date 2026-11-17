import type { Router } from 'express';

import { createShadowConnectorLane } from '@/shared/shadow-connector-lane.js';

import { createUploadRunsRouter } from './upload-runs.routes.js';

/** The word the forwarder's log warning leads with for this lane: `[upload-runs] no usable internal secret …`. */
const LANE_LABEL = 'upload-runs';

/** shadow-connector on this host, over loopback. */
const DEFAULT_BASE_URL = 'http://127.0.0.1:8001';

/**
 * Where shadow-connector keeps the secret its gate compares. Read at call time by the shared forwarder and
 * never copied anywhere (a copy is a second home that drifts on rotation); this module only names the file.
 */
const DEFAULT_ENV_FILE = '/opt/shadow-connector/.env';

export type UploadRunsModule = { router: Router };

/**
 * Builds the upload runs lane for the server entrypoint: the five allowlisted GET routes of what each upload
 * run did (the window's overview, one run whole, its events, the feed of every run's edges, and a live run's
 * own stream), and the one forwarder behind them. shadow-connector's `/api/upload-agent-runs/` is
 * internal-caller gated (R-CAP-11) even from loopback, and the browser never holds the secret: this server
 * already authenticates the operator, so the lane is the one hop that holds it, as the Tours and bulletins
 * lanes are.
 *
 * No watcher, no timer, no cache of any answer, no model call. The two event streams are the only sockets
 * the lane keeps, one per watching browser, and each closes with the browser that opened it: the forwarder
 * (`@/shared/shadow-connector-lane`, which holds the one read of the secret) relays them as they arrive.
 *
 * The environment is read HERE and nowhere below it, which is what lets the lane be proven against a
 * scratch engine or an empty env file — a caller that sets either variable before calling this gets
 * the one it named. Consumer: `server/index.ts`.
 */
export function createUploadRunsModule(): UploadRunsModule {
  const lane = createShadowConnectorLane({
    baseUrl: process.env.SHADOW_CONNECTOR_URL || DEFAULT_BASE_URL,
    envFile: process.env.SHADOW_CONNECTOR_ENV_FILE || DEFAULT_ENV_FILE,
    label: LANE_LABEL,
  });

  return {
    router: createUploadRunsRouter({
      forward: (request) => lane.forward(request),
      stream: (request) => lane.stream(request),
    }),
  };
}
