import type { AffectedAreasTrouble } from '@/shared/types';

/*
 * HOW A READ OF THE AFFECTED-AREAS LANE THAT BROUGHT NO ANSWER BECOMES A TROUBLE THE SCREENS SAY. Both functions
 * are pure: the hooks hand them what `fetch` gave or threw, and draw what they return.
 */

/**
 * The trouble a non-2xx answer stands for. The lane's own faults carry their status (`api.affectedAreas`'s note):
 * 502 is an answer that was not JSON, 503 is either the missing secret or a shadow-connector that did not answer,
 * told apart by the lane's sentence (it names the secret; the other never does). A 404 is the tour or pano gone;
 * anything else (a 422, a 500) is a refusal the screen can only call a failed read.
 */
export async function troubleOfResponse(response: Response): Promise<AffectedAreasTrouble> {
  if (response.status === 404) return 'gone';
  if (response.status === 502) return 'unreadable';
  if (response.status === 503) {
    const body: unknown = await response.json().catch(() => null);
    const sentence = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : null;
    return typeof sentence === 'string' && sentence.includes('secret') ? 'no_secret' : 'unreachable';
  }
  return 'failed';
}

/**
 * The trouble a thrown `fetch` or `.json()` stands for: a body that would not parse is an answer CloudCLI cannot
 * read; everything else (no connection, the client's own deadline) is no answer in time.
 */
export function troubleOfFailure(failure: unknown): AffectedAreasTrouble {
  return failure instanceof SyntaxError ? 'unreadable' : 'unreachable';
}
