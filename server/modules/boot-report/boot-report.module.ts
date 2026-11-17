import type { Router } from 'express';

import { createBootReportRouter } from './boot-report.routes.js';
import { createBootReportService } from './boot-report.service.js';

/**
 * Builds the public boot-report router for the server entrypoint, which mounts it at `/api/boot-report` ABOVE its body
 * parsers and the API-key check: the page that posts here is the one that did not draw, and holds no session to show.
 */
export function createBootReportModule(): Router {
  return createBootReportRouter(createBootReportService());
}
