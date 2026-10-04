import { useTranslation } from 'react-i18next';

import type { RoadmapCase, RoadmapCaseWord } from '@/shared/roadmap-types';
import type { Tone } from '@/shared/types';
import { Badge, Shimmer } from '@/shared/ui';
import { formatRelativeTime } from '@/shared/utils';

/** Each case word's badge, in the locale. */
const WORD_KEYS: Record<RoadmapCaseWord, string> = {
  holding: 'roadmap.cases.word.holding',
  broken: 'roadmap.cases.word.broken',
  regressed: 'roadmap.cases.word.regressed',
  'not run': 'roadmap.cases.word.notRun',
  "can't run": 'roadmap.cases.word.cantRun',
};

/**
 * The tone each word's badge wears: amber for what broke (a break, a regression, a case that could not
 * run its check), filled, never red; the muted neutral for a case that holds and for one no run has judged.
 */
const WORD_TONES: Record<RoadmapCaseWord, Tone> = {
  holding: 'neutral',
  broken: 'warn',
  regressed: 'warn',
  'not run': 'neutral',
  "can't run": 'warn',
};

/**
 * Where each word stands in the list: what broke first (a break and a regression alike, then a case that could
 * not run its check), then one no run has judged, then what holds. The door lists cases by their NAME, which the
 * screen never shows, so its order means nothing to the operator; he arrives from a row saying "1 broken", and
 * that case is the first he sees, at any width.
 */
const WORD_RANK: Record<RoadmapCaseWord, number> = {
  broken: 0,
  regressed: 0,
  "can't run": 1,
  'not run': 2,
  holding: 3,
};

/** The word no run has judged yet, whose hollow badge is dashed. */
const NOT_RUN: RoadmapCaseWord = 'not run';

type FeatureCasesProps = {
  /** The feature's active cases as the latest read answered them, kept while a re-read is out; empty until the first read lands. */
  cases: RoadmapCase[];
  /**
   * A read is out. Only the FIRST read, with no list yet, draws the shimmer: a re-read keeps the list on screen
   * (marked busy), so an open dialog never blinks its cases out and back.
   */
  loading: boolean;
  /**
   * Why the latest read failed, in words (never the door's command or the feature's slug) — or null. It takes
   * the list's place, whatever list is kept: a list the counts have moved past is no longer known to be true.
   */
  failure: string | null;
};

/**
 * The body of a feature dialog's Cases section, in each state its read can be in: the first read still out,
 * one quiet shimmer line; failed, one amber line with the reason; read, the list — in triage order
 * (`WORD_RANK`), what broke first, by a stable sort, so cases of one word keep the door's order.
 *
 * EACH CASE IS ITS SENTENCE — the claim it checks, in the operator's words, given the whole width and
 * wrapped whole — then its standing on the line under it: its word as a badge and when it last ran. A case
 * no run has judged says so in its dashed badge alone, rather than "Not run" beside "Not run yet". Where
 * something broke (broken, regressed, can't run), what its run saw follows, quoted under a rule in the
 * muted ink: that is the evidence the operator came for; a run that recorded nothing draws no line. A holding
 * case's run saw something too, and it is not shown — quiet until something breaks.
 *
 * A case's NAME is never shown (INV-6394: a slug appears only as the feature's "Name for Claude" line);
 * the sentence is its meaning, and a session finds the name from it.
 *
 * Used by the roadmap module's `FeatureDialog`, which reads the cases (`useFeatureCases`) and hands them to
 * `FeatureFacts`, under whose "Cases" heading this draws.
 */
export function FeatureCases({ cases, loading, failure }: FeatureCasesProps) {
  const { t } = useTranslation();

  if (loading && cases.length === 0) {
    return (
      <p data-roadmap-cases-read="loading" aria-busy="true" className="text-sm text-muted-foreground">
        <Shimmer>{t('roadmap.cases.loading')}</Shimmer>
      </p>
    );
  }

  // A warn SENTENCE is a soft block that wraps (the row's and the card's own shape), never a pill swollen to three lines.
  if (failure !== null) {
    return (
      <div data-roadmap-cases-read="failed" className="flex min-w-0">
        <Badge tone="warn" className="max-w-full rounded-lg text-left leading-snug">
          <span className="break-words">{t('roadmap.cases.failed', { reason: failure })}</span>
        </Badge>
      </div>
    );
  }

  // `sort` is stable, so the cases of one word keep the door's order.
  const ordered = [...cases].sort((a, b) => WORD_RANK[a.word] - WORD_RANK[b.word]);

  return (
    <ul data-roadmap-cases-read="listed" aria-busy={loading || undefined} className="flex flex-col divide-y divide-border">
      {ordered.map((item, index) => {
        const broke = WORD_TONES[item.word] === 'warn';
        return (
          // A name is unique only within its suite (the store's key is repo and name, and the route drops the
          // repo), so two suites' cases under one feature can share one: the place in the list makes it unique.
          <li key={`${index}:${item.name}`} data-roadmap-case={item.word} className="flex min-w-0 flex-col gap-2 py-3.5 first:pt-0 last:pb-0">
            <p className="break-words text-sm text-foreground">{item.sentence}</p>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
              {/* What broke is FILLED amber. The quiet words are HOLLOW: the neutral badge's fill measured 4.46:1 under
                  its muted ink in light, under AA, so the wash goes and a hairline carries the shape (MAN-743: a wash
                  is chosen by measuring it). Not run draws that ring dashed, Verve's mark for a state not yet known,
                  so the two quiet words differ in shape as well as in words. */}
              <Badge
                tone={WORD_TONES[item.word]}
                variant={broke ? undefined : 'outline'}
                className={item.word === NOT_RUN ? 'border-dashed' : undefined}
              >
                {t(WORD_KEYS[item.word])}
              </Badge>
              {item.last_run_at !== null && (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {t('roadmap.cases.lastRan', { when: formatRelativeTime(item.last_run_at) })}
                </span>
              )}
            </div>
            {/* An empty saw is a run that recorded nothing (`BROKEN:` with no text): no bare "It saw:" for it. */}
            {broke && item.last_saw && (
              <p className="break-words border-l-2 border-border pl-2.5 text-xs leading-relaxed text-muted-foreground">
                {t('roadmap.cases.saw', { saw: item.last_saw })}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
