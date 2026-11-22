import os from 'node:os';
import path from 'node:path';

import type { Router } from 'express';

import { createAnalyticsRouter } from './analytics.routes.js';
import { createAnalyticsService } from './analytics.service.js';
import { createAnalyticsReaders } from './sections/index.js';

/**
 * The house's Code Mode verb, unless the operator moved it. Read here and nowhere below: every reader
 * is handed the path it runs, so a probe pointing `CODE_MODE_BIN` at a scratch verb moves the whole
 * area at once.
 */
const DEFAULT_CODE_MODE_BIN = path.join(os.homedir(), '.claude', 'scripts', 'code-mode');

/** `~` expanded here, because `execFile` does not know the tilde and a path it cannot resolve never answers. */
function expandHome(value: string): string {
  if (value === '~') return os.homedir();
  return value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
}

export type AnalyticsModule = { router: Router };

/**
 * The Analytics area's composition root. Built inline by `server/index.ts` and mounted at
 * `/api/analytics` behind `authenticateToken`; it holds no timer and no socket.
 */
export function createAnalyticsModule(): AnalyticsModule {
  const codeModeBin = expandHome(process.env.CODE_MODE_BIN || DEFAULT_CODE_MODE_BIN);
  const service = createAnalyticsService(createAnalyticsReaders({ codeModeBin }));
  return { router: createAnalyticsRouter(service) };
}
