import express from 'express';
import type { Request, Router } from 'express';

import { AppError, asyncHandler, readAuthenticatedUserId, readPathParam } from '@/shared/utils.js';

import {
  GEMINI_FEATURES,
  USAGE_RANGES,
  isGeminiFeature,
  isUsageRange,
  readUsage,
  setFeatureSwitch,
} from './gemini-meter.service.js';
import type { GeminiFeature, HeldGeminiKey, UsageRange } from './gemini-meter.service.js';

/** The keys an account's calls can be sent with: handed in by the composition root, so this module imports no voice code. */
export type HeldKeysReader = (userId: number) => HeldGeminiKey[];

/**
 * The meter's two doors, mounted at /api/gemini-meter behind authenticateToken. Both act for the signed-in account
 * only and answer bare JSON:
 *   GET /usage?range=today|7d|30d          the window's reading; 400 for any other range
 *   PUT /switches/:feature {"enabled": b}  {feature, enabled} as the table reads back; 400 for an unknown feature or a non-boolean
 */
export function createGeminiMeterRoutes(heldKeysOf: HeldKeysReader): Router {
  const router = express.Router();

  router.get(
    '/usage',
    asyncHandler(async (request, response) => {
      const userId = readAuthenticatedUserId(request);
      response.json(readUsage(userId, readRange(request), heldKeysOf(userId)));
    })
  );

  router.put(
    '/switches/:feature',
    asyncHandler(async (request, response) => {
      const userId = readAuthenticatedUserId(request);
      const feature = readFeature(request);
      response.json(setFeatureSwitch(userId, feature, readEnabled(request.body)));
    })
  );

  return router;
}

function readRange(request: Request): UsageRange {
  const range = request.query.range;
  if (isUsageRange(range)) return range;
  throw new AppError('range must be one of ' + USAGE_RANGES.join(', ') + '.', { code: 'RANGE_INVALID', statusCode: 400 });
}

function readFeature(request: Request): GeminiFeature {
  const feature = readPathParam(request.params.feature, 'feature');
  if (isGeminiFeature(feature)) return feature;
  throw new AppError('feature must be one of ' + GEMINI_FEATURES.join(', ') + '.', { code: 'FEATURE_INVALID', statusCode: 400 });
}

function readEnabled(body: unknown): boolean {
  const enabled = typeof body === 'object' && body !== null ? (body as { enabled?: unknown }).enabled : undefined;
  if (typeof enabled === 'boolean') return enabled;
  throw new AppError('enabled must be true or false.', { code: 'ENABLED_INVALID', statusCode: 400 });
}
