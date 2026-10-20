import { createContext, useContext } from 'react';

import type { ClaudeUsage, ClaudeUsagePace } from '@/shared/types';

/**
 * THE FAKES THE USAGE METERS RENDER OVER — one whole reading and the pacer's projection beside it,
 * for every state the meters must survive: room on both windows, a 5-hour projection past its
 * ceiling, one past 100%, a rolled window, a degraded reading, and no pace at all. The live
 * `UsageMeters` reads the context below, whose default is empty: no tick, no mark, no caption, the
 * block exactly as it was. The fill phase swaps that read for `usage.pace` and deletes this file.
 *
 * THE PACER'S FIGURES ARE PERCENTS HERE, not the dispatcher's fractions: the usage route converts
 * them once (interface X), so the meter never does arithmetic on units it cannot know.
 */

const FIVE_RESETS = '2026-10-20T23:10:00+00:00';
const WEEK_RESETS = '2026-10-26T07:00:00+00:00';
const CHECKED_AT = 1792501200;

const FIVE = (percent: number, rolled = false) => ({ key: 'five_hour', label: 'Current 5-hour window', percent, resetsAt: FIVE_RESETS, ...(rolled ? { rolled: true } : {}) });
const WEEK = (percent: number) => ({ key: 'seven_day', label: 'This week', percent, resetsAt: WEEK_RESETS });

/** A whole reading, healthy, from the two windows the panel draws. */
const READING = { reachable: true as const, windows: [FIVE(61), WEEK(42)], degraded: false, reason: '', staleSince: null, checkedAt: CHECKED_AT };

const ROOM: ClaudeUsagePace = {
  used5: 61,
  projected5: 69,
  ceiling5: 95,
  used7: 42,
  projected7: 55,
  ceiling7: 95,
  words: 'pacing to 95% · 69% projected by 4:10 pm',
};

/** A projection past the 5-hour ceiling: the mark stands above the tick, and the meter is not an error. */
const PAST_CEILING: ClaudeUsagePace = {
  used5: 93,
  projected5: 97,
  ceiling5: 95,
  used7: 42,
  projected7: 55,
  ceiling7: 95,
  words: 'no room on the 5-hour window — 93% used, 97% projected by 4:10 pm, ceiling 95%',
};

/** A projection past 100%: its mark sits at the track's end, its figure stays in the caption and the words. */
const PAST_100: ClaudeUsagePace = {
  used5: 100,
  projected5: 108,
  ceiling5: 95,
  used7: 61,
  projected7: 103,
  ceiling7: 95,
  words: 'no room on the 5-hour window — 100% used, 108% projected by 4:10 pm, ceiling 95%',
};

const ROLLED: ClaudeUsagePace = {
  used5: 36,
  projected5: 44,
  ceiling5: 95,
  used7: 61,
  projected7: 70,
  ceiling7: 95,
  words: 'pacing to 95% · 44% projected by 4:10 pm',
};

/** Every state the meters are drawn in, each a whole `ClaudeUsage` and its whole pace (or none). */
export const USAGE_PACE_FAKES: Record<'room' | 'pastCeiling' | 'past100' | 'rolled' | 'degraded' | 'absent', { usage: ClaudeUsage; pace: ClaudeUsagePace | null }> = {
  room: { usage: READING, pace: ROOM },
  pastCeiling: { usage: { ...READING, windows: [FIVE(93), WEEK(42)] }, pace: PAST_CEILING },
  past100: { usage: { ...READING, windows: [FIVE(100), WEEK(61)] }, pace: PAST_100 },
  rolled: { usage: { ...READING, windows: [FIVE(36, true), WEEK(61)] }, pace: ROLLED },
  degraded: { usage: { ...READING, degraded: true, reason: 'network', staleSince: CHECKED_AT - 3600 }, pace: ROOM },
  absent: { usage: READING, pace: null },
};

/** The pacer's projection the live meters read while this is a scaffold: empty, so no annotation draws. */
export const UsagePaceFakeContext = createContext<ClaudeUsagePace | null>(null);

/** The scaffold's read of `usage.pace` — the fill phase swaps it for the reading's own key. */
export function useUsagePaceFake(): ClaudeUsagePace | null {
  return useContext(UsagePaceFakeContext);
}
