import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { Router } from 'express';

import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

import { createDeepseekKeyReader } from './deepseek-key.js';
import { createDeepseekRouter } from './deepseek.routes.js';
import { createDeepseekService, DEEPSEEK_BALANCE_URL, DEEPSEEK_TIMEOUT_MS } from './deepseek.service.js';
import { createDeepseekUsageService } from './deepseek-usage.service.js';

/**
 * The usage recorder, unless the operator moved it — the same env idiom as the Jev lane's
 * `JEV_BIN`, so a probe or a second install points the recorder and this lane at one place rather
 * than splitting them.
 */
const DEFAULT_USAGE_BIN = path.join(os.homedir(), '.claude', 'scripts', 'deepseek-usage');

/**
 * How long after boot the first reading is taken.
 *
 * Not zero, because boot is the busiest moment this process has and a reading is worth nothing
 * sooner than the module that records it is steady; not long, because every hour the recorder is
 * silent is an hour the ledger's reconciliation can never recover.
 */
const FIRST_RECORDING_MS = 15_000;

/**
 * The recording cadence — the server's own reading of the account, independent of any browser.
 *
 * Three minutes is the client footer's cadence (`src/shared/hooks/useDeepseekBalance.ts`), and the
 * reconciliation's pairs are only usable while consecutive readings sit within 900 s of one
 * another, so this is the period that keeps the ledger's balance series continuous even with no
 * tab open at all.
 */
export const DEEPSEEK_BALANCE_RECORD_MS = 180_000;

/**
 * Starts the server's own balance reading: the first one shortly after the module is built, then
 * one on every cadence.
 *
 * Called from `createDeepseekModule` and NOWHERE else, once per module — an import-time timer would
 * both start before the server is listening and start a second time for every importer. Both timers
 * are unref'd: recording is a duty of this process, never a reason for it to stay alive.
 */
function startBalanceRecording(balance: () => Promise<unknown>): void {
  const firstReading = setTimeout(() => void balance(), FIRST_RECORDING_MS);
  const everyReading = setInterval(() => void balance(), DEEPSEEK_BALANCE_RECORD_MS);
  firstReading.unref();
  everyReading.unref();
}

/**
 * Builds the authenticated DeepSeek router for the server entrypoint: the balance route, and the
 * recorder every reachable reading passes through on its way out.
 *
 * The composition root is the only place that reads the environment, resolves a path or hands
 * over the real `fetch`; the service and the key reader take all three as dependencies, which is
 * what lets every unknown path be proven against a closed port and a key that is not there. The
 * recorder's binary is read HERE for the same reason — a value read at import would ignore the one
 * a caller set before calling this.
 *
 * The `.env` is resolved from the APPLICATION root rather than from `process.cwd()`: the dev
 * supervisor starts this server with its own working directory, and a compiled install runs from
 * a directory nothing guarantees. `findApplicationRoot` answers identically before and after
 * compilation, so the file named here is the same one the systemd unit reads.
 */
export function createDeepseekModule(): Router {
  const applicationRoot = findApplicationRoot(getModuleDirectory(import.meta.url));

  // The recorder first: the balance service is handed it as a dependency, and the recording loop
  // below starts only once the service that produces readings exists.
  const usage = createDeepseekUsageService({
    bin: process.env.DEEPSEEK_USAGE_BIN || DEFAULT_USAGE_BIN,
  });

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
    // Every reachable reading — this timer's, the footer's, anyone's — is booked in the ledger.
    // The recorder answers with a promise and never throws, so there is nothing to await here: the
    // route's reading must not wait on a child process writing a row.
    onReading: (reading) => void usage.record(reading),
  });

  startBalanceRecording(() => deepseekService.balance());

  return createDeepseekRouter(deepseekService);
}
