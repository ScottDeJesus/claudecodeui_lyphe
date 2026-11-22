// The Analytics frame's contract with its fill and with every section: types only, no code.

/**
 * WHAT A SECTION'S ONE READ HOLDS, AND THE FRAME DRAWS EACH: `loading` before the first answer; `unreachable` when the route
 * did not answer; else the answer, with `stale` raised while a newer one is being fetched over it. A newer answer replaces
 * the drawn one whole, so a section never blanks to a spinner between two answers.
 *
 * Answered by `useAnalyticsSection` (hooks/), drawn by `AnalyticsSectionFrame`.
 */
export type AnalyticsReading<T> = { status: 'loading' } | { status: 'unreachable' } | { status: 'ready'; data: T; stale: boolean };

/** What the panel keeps between visits: which section is open and how far back it looks, in days. */
export type AnalyticsChoice = { section: string; days: number };
