import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Router } from 'express';

import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

import { createDeepseekKeyReader } from './deepseek-key.js';
import { createDeepseekRouter } from './deepseek.routes.js';
import { createDeepseekService, DEEPSEEK_BALANCE_URL, DEEPSEEK_TIMEOUT_MS } from './deepseek.service.js';

/**
 * Builds the authenticated DeepSeek balance router for the server entrypoint.
 *
 * The composition root is the only place that reads the environment, resolves a path or hands
 * over the real `fetch`; the service and the key reader take all three as dependencies, which is
 * what lets every unknown path be proven against a closed port and a key that is not there.
 *
 * The `.env` is resolved from the APPLICATION root rather than from `process.cwd()`: the dev
 * supervisor starts this server with its own working directory, and a compiled install runs from
 * a directory nothing guarantees. `findApplicationRoot` answers identically before and after
 * compilation, so the file named here is the same one the systemd unit reads.
 */
export function createDeepseekModule(): Router {
  const applicationRoot = findApplicationRoot(getModuleDirectory(import.meta.url));

  const deepseekService = createDeepseekService({
    balanceUrl: DEEPSEEK_BALANCE_URL,
    readApiKey: createDeepseekKeyReader({
      envPath: path.join(applicationRoot, '.env'),
      readEnvironment: () => process.env,
      readFileImpl: (filePath) => readFile(filePath, 'utf8'),
    }),
    fetchImpl: fetch,
    timeoutMs: DEEPSEEK_TIMEOUT_MS,
    now: () => Date.now(),
  });

  return createDeepseekRouter(deepseekService);
}
