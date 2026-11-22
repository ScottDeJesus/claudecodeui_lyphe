import { firstLine } from '@/shared/utils';

/** Whether a value is a plain object, not an array or null. */
export const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

/**
 * A response's JSON body, or null when it carries none (an empty answer, a proxy's HTML page). Only a body that is not JSON is
 * answered null; a read that fails for any other reason rises to the caller, who says it as the network's word.
 */
export async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

/**
 * The sentence an answer carries: the dispatcher's first line (stdout, where every dispatcher verb refuses, then stderr), else the
 * relay's own 400 (error); '' when it carries none.
 */
export function sentenceOf(body: unknown): string {
  if (!isRecord(body)) return '';
  return firstLine(body.stdout) || firstLine(body.stderr) || firstLine(body.error);
}
