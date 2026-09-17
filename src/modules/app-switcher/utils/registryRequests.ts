import { api } from '@/shared/api';
import type { AppEntry } from '@/shared/app-types';

/**
 * The registry's two WRITE verbs, and the one reader of a refusal that every registry request in
 * this module answers with.
 *
 * Three callers, one sentence each: the drawer's add and remove handlers call the verbs, and the
 * list read (`useAppRegistry`) reads its own refusals in the same words — which is why the reader
 * lives here, beside the writes, rather than inside either of them. A server that says no says it in
 * ONE place, and the reader prints what it said.
 *
 * WHY NOT `readApiJson`: this server answers a refusal with `{ success: false, error: { code,
 * message, details } }` — `error` is an OBJECT — and `readApiJson` throws `new Error(data.error)`,
 * which for that body is the string `[object Object]` where the reader expected a reason. A body
 * that is not JSON says nothing at all, and then the caller's own sentence and the status are the
 * whole answer — which is why the sentence is an argument rather than a constant here: a list that
 * could not be read and a change that was refused are different news.
 */

/** Appends one row. Resolves once the registry holds it; rejects with the server's own sentence. */
export async function addRegistryApp(draft: Pick<AppEntry, 'name' | 'url'>): Promise<void> {
  const response = await api.apps.add(draft);
  if (!response.ok) throw new Error(await refusalInWords(response, 'The application was not added'));
}

/**
 * Removes one row by id. Resolves once the registry no longer holds it; rejects with the server's
 * own sentence — a 404 for an id the file does not hold, whatever the drawer last painted.
 */
export async function removeRegistryApp(appId: string): Promise<void> {
  const response = await api.apps.remove(appId);
  if (!response.ok) throw new Error(await refusalInWords(response, 'The application was not removed'));
}

/**
 * The server's message out of a failed response, or — when the body carries none — `fallback` with
 * the status in brackets, which is still an answer.
 */
export async function refusalInWords(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    const envelope = body.error;
    if (typeof envelope === 'string' && envelope.trim()) return envelope.trim();
    if (typeof envelope === 'object' && envelope !== null) {
      const message = (envelope as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message.trim();
    }
  } catch {
    // A body that is not JSON says nothing; the status is still an answer.
  }
  return `${fallback} (${response.status}).`;
}
