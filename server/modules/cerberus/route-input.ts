import type { Request } from 'express';

import { AppError } from '@/shared/utils.js';

/**
 * The transport-shape readers every Cerberus route file shares: what a route decides is only that a
 * field is the kind of value the verb takes (text, a number, a true/false, an object) — whether the
 * value is in range, in the grammar or names something real is the service's refusal. A shape that is
 * wrong is a 400 `CERBERUS_BAD_REQUEST`, in the app's `{ success: false, error }` envelope, and the
 * signed-in user's name (which `authenticateToken` on the mount put on the request) is `readUsername`.
 *
 * Consumers: `cerberus.routes.ts` and `diagnosis/diagnosis.routes.ts`.
 */

type AuthenticatedRequest = Request & { user?: { username?: string } };

/** The 400 every shape refusal is; `cerberus.routes.ts` also raises it for a query string that is not a whole number. */
export function badRequest(message: string): AppError {
  return new AppError(message, { code: 'CERBERUS_BAD_REQUEST', statusCode: 400 });
}

/** The JSON object a write carries. */
export function readBody(request: Request): Record<string, unknown> {
  const body: unknown = request.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw badRequest('The body must be a JSON object.');
  return body as Record<string, unknown>;
}

/** A text field that must be there (the empty string counts as there). */
export function requiredText(source: Record<string, unknown>, field: string): string {
  const value = source[field];
  if (typeof value !== 'string') throw badRequest(`${field} must be text.`);
  return value;
}

/** A text field that may be absent or null; present, it must be text. */
export function optionalText(source: Record<string, unknown>, field: string): string | undefined {
  const value = source[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw badRequest(`${field} must be text.`);
  return value;
}

/** A number field that must be there; whether it is in range is the service's refusal. */
export function requiredNumber(source: Record<string, unknown>, field: string): number {
  const value = source[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw badRequest(`${field} must be a number.`);
  return value;
}

/** A true/false field that may be absent; present, it must be one. */
export function optionalBoolean(source: Record<string, unknown>, field: string): boolean | undefined {
  const value = source[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw badRequest(`${field} must be true or false.`);
  return value;
}

/** A nested JSON object field that must be there. */
export function requiredObject(source: Record<string, unknown>, field: string): Record<string, unknown> {
  const value = source[field];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw badRequest(`${field} must be an object.`);
  return value as Record<string, unknown>;
}

/** The signed-in user's name — who muted, wrote a fix, switched auto-run or asked for a diagnosis — or a 401. */
export function readUsername(request: Request): string {
  const username = (request as AuthenticatedRequest).user?.username;
  if (typeof username !== 'string' || username === '') {
    throw new AppError('Authenticated user is required.', { code: 'CERBERUS_USER_REQUIRED', statusCode: 401 });
  }
  return username;
}
