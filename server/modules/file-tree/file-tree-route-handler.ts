import type { Request, RequestHandler, Response } from 'express';

import type { FileTreeLogger } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/**
 * Wraps a File Tree route operation so every refusal leaves as its declared answer.
 *
 * The one error boundary of the module's HTTP surface, shared by both routers in
 * `file-tree.routes.ts` and by `file-tree-edit.routes.ts`: a thrown `AppError` becomes its own
 * status and message, and anything else is logged and answered as a 500 rather than escaping to
 * Express's default handler with a stack trace.
 */
export function createRouteHandler(
  operation: (request: Request, response: Response) => void | Promise<void>,
  logger: FileTreeLogger,
): RequestHandler {
  return async (request, response) => {
    try {
      await operation(request, response);
    } catch (error) {
      if (error instanceof AppError) {
        response.status(error.statusCode).json({ error: error.message });
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      logger.error('File Tree API error', error);
      response.status(500).json({ error: message });
    }
  };
}
