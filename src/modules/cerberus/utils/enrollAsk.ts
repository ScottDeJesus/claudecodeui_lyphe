import { api, refusalCode, refusalSentence } from '@/shared/api';
import type { CerberusEnrollment } from '@/shared/cerberus-types';
import type { CerberusEnrollRefusal } from '@/shared/types';

/** True when a body is the command center issues: the name, the one-time token, the line to run and when it expires. */
function isEnrollment(body: unknown): body is CerberusEnrollment {
  if (body === null || typeof body !== 'object') return false;
  const candidate = body as Partial<Record<keyof CerberusEnrollment, unknown>>;
  return typeof candidate.name === 'string'
    && typeof candidate.token === 'string'
    && typeof candidate.command === 'string'
    && typeof candidate.expiresAt === 'number';
}

/**
 * Asks center for an install command and says how the ask came out, so the dialog turns each answer into
 * the one place it is said:
 * - `issued` — a token was minted; `enrollment` is the command and when it expires.
 * - `taken` — 409 `CERBERUS_NAME_TAKEN`: a node of that name is enrolled (the overview was read before it
 *   was). The first step says it on the name field; the server's own `sentence` is for a new command asked
 *   for after the install step, where no field is in view.
 * - `refused` — the banner's `refusal`: 409 `CERBERUS_NOT_LISTENING` as `notListening`, no answer at all as
 *   `unreachable`, anything else with the server's sentence.
 *
 * Used by the cerberus module's `EnrollDialog`, for the first command and for a new one after the token expired.
 */
export async function askForCommand(name: string, desc: string): Promise<
  | { kind: 'issued'; enrollment: CerberusEnrollment }
  | { kind: 'taken'; sentence: string | null }
  | { kind: 'refused'; refusal: CerberusEnrollRefusal }
> {
  try {
    const response = await api.cerberus.enroll({ name, desc: desc === '' ? undefined : desc });
    if (response.ok) {
      const body: unknown = await response.json();
      return isEnrollment(body)
        ? { kind: 'issued', enrollment: body }
        : { kind: 'refused', refusal: { kind: 'refused', sentence: null } };
    }
    // The body is read twice, for its code and for its sentence; `refusalCode` reads a clone, so the second read has its own copy.
    const code = await refusalCode(response);
    if (code === 'CERBERUS_NAME_TAKEN') return { kind: 'taken', sentence: await refusalSentence(response) };
    if (code === 'CERBERUS_NOT_LISTENING') return { kind: 'refused', refusal: { kind: 'notListening' } };
    return { kind: 'refused', refusal: { kind: 'refused', sentence: await refusalSentence(response) } };
  } catch {
    // No answer at all (this app's own network), or a 200 whose body is not JSON: center cannot be read.
    return { kind: 'refused', refusal: { kind: 'unreachable' } };
  }
}
