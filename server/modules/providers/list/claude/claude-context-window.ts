import type { AnyRecord } from '@/shared/types.js';

import { contextWindowFor } from './claude-compaction-seams.js';

/** The window a budget falls back to when the SDK has reported none and CONTEXT_WINDOW is unset. */
const DEFAULT_CONTEXT_WINDOW = 160_000;

/**
 * The window a budget is measured against: the one the SDK reported for the session's model when
 * known, else the server-wide CONTEXT_WINDOW setting (a fallback only).
 *
 * Used by claude-runtime.provider.js for every `token_budget` it publishes.
 */
export function resolveContextWindow(reportedContextWindow: number | null | undefined): number {
  if (typeof reportedContextWindow === 'number' && Number.isFinite(reportedContextWindow) && reportedContextWindow > 0) {
    return reportedContextWindow;
  }
  return Number.parseInt(process.env.CONTEXT_WINDOW ?? '', 10) || DEFAULT_CONTEXT_WINDOW;
}

/**
 * Reads the context window the SDK measured for the model that served a turn.
 *
 * Only a turn's `result` states it, in `modelUsage[<model>].contextWindow`. That map has one entry
 * per model the turn billed, subagents' included, so the entry has to be the main thread's model
 * (`mainModel`, the last main-thread assistant request's `message.model`): the CLI keys a 1M
 * variant `claude-opus-4-8[1m]`, which `contextWindowFor` matches against the bare id.
 *
 * Used by claude-runtime.provider.js at each `result`.
 *
 * @param sdkMessage - an SDK stream message
 * @param mainModel - `message.model` of the turn's main-thread assistant requests, when it had any
 * @returns the reported window, or null when the message states none
 */
export function readReportedContextWindow(sdkMessage: unknown, mainModel: string | null): number | null {
  const message = sdkMessage as AnyRecord | null;
  const modelUsage = message?.type === 'result' ? message.modelUsage : null;
  if (!modelUsage || typeof modelUsage !== 'object') {
    return null;
  }

  const matchedWindow = contextWindowFor(modelUsage, mainModel);
  if (matchedWindow !== null) {
    return matchedWindow;
  }

  // A turn that billed a single model was served by it, whatever the id it is keyed by is called
  // (a self-hosted model behind ANTHROPIC_BASE_URL names itself differently on the two sides).
  const reportedWindows = Object.values(modelUsage as Record<string, unknown>)
    .map((entry) => (entry && typeof entry === 'object' ? (entry as AnyRecord).contextWindow : null))
    .filter((window): window is number => typeof window === 'number' && Number.isFinite(window) && window > 0);
  return reportedWindows.length === 1 ? reportedWindows[0] : null;
}
