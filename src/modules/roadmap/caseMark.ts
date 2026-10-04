import type { RoadmapCases } from '@/shared/roadmap-types';

/**
 * The one phrase a set of cases says: `key` is the FULL locale key of its words (`roadmap.cases.holding`,
 * `.notRunYet`, `.broken`, `.regressed`, `.joined` or `.cantRun`), `count` the number those words are said
 * with (for a plural key, the form it picks), and `tone` warn for what is wrong, neutral — the muted ink —
 * for what is quiet.
 */
type CaseMark = { key: string; count: number; tone: 'warn' | 'neutral' };

/**
 * The phrase a feature's cases say, in the design's fixed order: anything broken or regressed is amber
 * ("1 broken", "2 regressed", or both joined: "2 broken, 1 regressed"); else any case that could not run
 * is amber ("1 can't run"); else any case no run has judged is the muted ink ("4 cases · 2 not run yet");
 * else the muted ink says "5 cases holding". No case, no phrase: null.
 *
 * It is pure, and it derives only WHICH of the dispatcher's own words to say and the number to say them
 * with: every word is a count the dispatcher gave (`RoadmapCases`), so the screen invents none. `count` is
 * the amber words' own for a break or a regression (summed when both stand, for the joined phrase's
 * plural-free key), and the TOTAL for the two quiet phrases, whose sentences count every case. The
 * not-run number of "· 2 not run yet" is `cases.not_run`, which the caller already holds.
 *
 * Used by `FeatureRow` — and so by the epic card's rows and by the rail and the chat gutter's roadmap
 * widget, which draw that row — so the row, the card and the widget read one rule.
 */
export function caseMark(cases: RoadmapCases): CaseMark | null {
  if (cases.total === 0) return null;

  const { broken, regressed } = cases;
  if (broken > 0 && regressed > 0) return { key: 'roadmap.cases.joined', count: broken + regressed, tone: 'warn' };
  if (broken > 0) return { key: 'roadmap.cases.broken', count: broken, tone: 'warn' };
  if (regressed > 0) return { key: 'roadmap.cases.regressed', count: regressed, tone: 'warn' };
  if (cases.cant_run > 0) return { key: 'roadmap.cases.cantRun', count: cases.cant_run, tone: 'warn' };
  if (cases.not_run > 0) return { key: 'roadmap.cases.notRunYet', count: cases.total, tone: 'neutral' };
  return { key: 'roadmap.cases.holding', count: cases.total, tone: 'neutral' };
}
