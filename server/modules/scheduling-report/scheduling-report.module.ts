import type { Router } from 'express';

import { createShadowConnectorLane } from '@/shared/shadow-connector-lane.js';

import { createSchedulingReportRouter } from './scheduling-report.routes.js';

/** The word the forwarder's log warning leads with for this lane: `[scheduling-report] no usable internal secret …`. */
const LANE_LABEL = 'scheduling-report';

/**
 * The eis backend (Restorly's FastAPI, eis_backend) on this host, over loopback. The first lane that points at
 * :8004 rather than shadow-connector's :8001 engine: :8004 serves its internal surface behind the same
 * EIS_INTERNAL_SECRET class, so a hop through :8001 would be a second service relaying a third for nothing.
 */
const DEFAULT_BASE_URL = 'http://127.0.0.1:8004';

/**
 * Where the eis backend keeps the secret its internal gate (`require_internal_caller`) compares. Read at call time
 * by the shared forwarder and never copied anywhere (a copy is a second home that drifts on rotation); this module
 * only names the file.
 */
const DEFAULT_ENV_FILE = '/opt/shadow-connector/.eis_backend.env';

export type SchedulingReportModule = { router: Router };

/**
 * Builds the scheduling report lane for the server entrypoint: the three allowlisted GET routes of the eis
 * backend's scheduling record (the window's overview, one entry whole, and the feed that says the record
 * changed), and the one forwarder behind them. The backend's `/api/eis/internal/scheduling-report/` is
 * internal-caller gated and the browser never holds the secret: this server already authenticates the operator,
 * so the lane is the one hop that holds it, as the Tours, bulletins and upload-runs lanes do.
 *
 * No watcher, no timer, no cache of any answer, no model call. The feed is the only socket the lane keeps, one
 * per watching browser, and it closes with the browser that opened it: the forwarder
 * (`@/shared/shadow-connector-lane`, which holds the one read of the secret) relays it as it arrives.
 *
 * The environment is read HERE and nowhere below it, so the lane can be proven against a scratch backend or an
 * empty env file — a caller that sets either variable before calling this gets the one it named. Consumer:
 * `server/index.ts`.
 */
export function createSchedulingReportModule(): SchedulingReportModule {
  const lane = createShadowConnectorLane({
    baseUrl: process.env.EIS_BACKEND_URL || DEFAULT_BASE_URL,
    envFile: process.env.EIS_BACKEND_ENV_FILE || DEFAULT_ENV_FILE,
    label: LANE_LABEL,
  });

  return {
    router: createSchedulingReportRouter({
      forward: (request) => lane.forward(request),
      stream: (request) => lane.stream(request),
    }),
  };
}
