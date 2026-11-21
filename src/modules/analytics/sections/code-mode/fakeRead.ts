import { fakeCodeModeAnswer } from '@/modules/analytics/sections/code-mode/codeModeFake';
import type { AnalyticsReading } from '@/modules/analytics/types';
import type { CodeModeAnalytics } from '@/shared/analytics-types';

// THE SCAFFOLD'S FIXED READINGS, in place of the section's one read until its fill wires `useAnalyticsSection`. This file
// goes with the fill: nothing but `CodeModeSection` imports it. The answer inside a reading is `codeModeFake.ts`'s.

/** The frame's four states, by the name the page's `?analytics-state=` asks for one. */
const STATES = ['reading', 'unreachable', 'answered', 'newer'] as const;
type FakeState = (typeof STATES)[number];

/** One reading per state the frame draws: still reading, the route did not answer, an answer, a newer answer on its way. */
export function fakeReadings(days: number): Record<FakeState, AnalyticsReading<CodeModeAnalytics>> {
  const data = fakeCodeModeAnswer(days);
  return {
    reading: { status: 'loading' },
    unreachable: { status: 'unreachable' },
    answered: { status: 'ready', data, stale: false },
    newer: { status: 'ready', data, stale: true },
  };
}

/** The reading the page asks for by name (`?analytics-state=reading|unreachable|answered|newer`), an answer when it names none. */
export function fakeSectionRead(days: number): { reading: AnalyticsReading<CodeModeAnalytics>; refresh: () => void } {
  const asked = new URLSearchParams(window.location.search).get('analytics-state');
  const state = STATES.find((name) => name === asked) ?? 'answered';
  return { reading: fakeReadings(days)[state], refresh: () => undefined };
}
