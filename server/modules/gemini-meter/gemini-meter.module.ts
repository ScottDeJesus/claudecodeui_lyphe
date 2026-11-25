import type { Router } from 'express';

import { createGeminiMeterRoutes } from './gemini-meter.routes.js';
import type { HeldKeysReader } from './gemini-meter.routes.js';

/**
 * Builds CloudCLI's Gemini meter for the server entrypoint, which mounts its router at /api/gemini-meter behind
 * authenticateToken. The meter's rows live in the shared database, reached through the repository barrel; the one
 * thing handed in is heldKeysOf, the voice module's reader of which keys an account's calls can be sent with
 * (digest and tail only). It is handed in rather than imported because the voice module's wire imports this
 * module's barrel: an import back would be a cycle.
 */
export function createGeminiMeterModule(dependencies: { heldKeysOf: HeldKeysReader }): { router: Router } {
  return { router: createGeminiMeterRoutes(dependencies.heldKeysOf) };
}
