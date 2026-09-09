/**
 * The "Clear" mark on the token-usage panel.
 *
 * A conversation's generated-token total is read back from its transcript, which is a record of
 * what happened and is never rewritten to make a counter look better. Clearing therefore cannot
 * mean "delete" — it means "count from here": the total at the moment of the clear is kept as a
 * baseline and subtracted from every later reading.
 *
 * Per session, in localStorage rather than the preference store: it is a view of one
 * conversation on one screen, not a setting worth following the user to another device.
 */

const STORAGE_KEY = 'token-usage-clears';
/** Enough for the sessions anyone revisits; the oldest marks fall off rather than growing forever. */
const MAX_TRACKED_SESSIONS = 50;

type ClearMark = { clearedAt: number; outputBaseline: number };
type ClearMarks = Record<string, ClearMark>;

const readMarks = (): ClearMarks => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as ClearMarks) : {};
  } catch {
    return {};
  }
};

export const readTokenUsageClear = (sessionId: string | null): ClearMark | null => {
  if (!sessionId) return null;
  const mark = readMarks()[sessionId];
  return mark && typeof mark.outputBaseline === 'number' ? mark : null;
};

export const writeTokenUsageClear = (sessionId: string | null, outputBaseline: number): void => {
  if (!sessionId) return;

  try {
    const marks = readMarks();
    marks[sessionId] = { clearedAt: Date.now(), outputBaseline };

    const entries = Object.entries(marks).sort((a, b) => b[1].clearedAt - a[1].clearedAt);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries.slice(0, MAX_TRACKED_SESSIONS))));
  } catch {
    // A full or unavailable localStorage costs the mark, not the panel.
  }
};

/** The reading to show: what has been generated SINCE the clear, floored at zero. */
export const applyTokenUsageClear = (sessionId: string | null, sessionOutputTokens: number): number => {
  const mark = readTokenUsageClear(sessionId);
  if (!mark) return sessionOutputTokens;
  return Math.max(0, sessionOutputTokens - mark.outputBaseline);
};
