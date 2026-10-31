import { errorMessage } from '@/shared/api';

/** What a press that got no answer at all says: a dropped connection (a phone leaving the network), in place of the browser's own "Failed to fetch". */
const UNREACHABLE = 'The server could not be reached.';

/**
 * The words of a toast for a press that failed: the server's own sentence when it gave one (a 404's "That card is not on your
 * panel any more.", a 409's walk sentence), the page's plain sentence for a request that never got an answer (the browser rejects
 * it with a `TypeError`: "Failed to fetch" is not for a person), else nothing. What really threw is kept in the console.
 *
 * Used by `NoteStage` (Pin, Dismiss) and `WalkStage` (Back, Next, End).
 */
export function refusalMessage(error: unknown): string | undefined {
  if (error instanceof TypeError) {
    console.warn('[Station] A press got no answer:', error);
    return UNREACHABLE;
  }
  return errorMessage(error) ?? undefined;
}
