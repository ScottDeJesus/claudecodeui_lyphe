import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { Labeled, PageQuote } from '@/modules/carrier-bulletins/QuotedWords';
import { StateBadge } from '@/modules/carrier-bulletins/StateBadge';
import { VERDICT_LOOK, VERDICT_ORDER } from '@/modules/carrier-bulletins/utils/bulletinModel';
import type { JudgedRule } from '@/shared/carrier-bulletins-types';
import { Card } from '@/shared/ui';

type JudgedListProps = {
  judged: JudgedRule[];
};

/**
 * RULES JUDGED ON THIS PAGE: every rule the house held before this reading that cites the page, with Claude's verdict.
 *
 * Listed by need — unsettled, corrected, not on the page, duplicate, confirmed — so what changed or stays open reads
 * first and the twenty rules a busy page can hold end on the calm ones; the reading's own order is kept within a verdict.
 * Each row: the rule's words with its verdict as a badge, the revision it came from, why Claude judged it so, the rule a
 * duplicate repeats ("Same as …"), and the page's words it rests on. Where the house's checks refused Claude's answer the
 * stored verdict is `unsettled`, and the row says what Claude said and that it was refused.
 *
 * Every rule's words, reason, quote and revision are text nodes (R-CERB-25). Names, never ids: a duplicate points at the
 * other rule by its words.
 *
 * Used by the carrier-bulletins module's `ReadingColumn`, after what the page requires.
 */
export function JudgedList({ judged }: JudgedListProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const ordered = VERDICT_ORDER.flatMap((verdict) => judged.filter((rule) => rule.verdict === verdict));

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2">
      <h3 id={headingId} className="text-xs uppercase tracking-[0.14em] text-ink-faint">
        {t('cerberus.bulletins.page.judgedTitle')} · {judged.length}
      </h3>
      <Card className="overflow-hidden">
        <ul aria-labelledby={headingId} className="m-0 list-none divide-y divide-border p-0">
          {ordered.map((rule, index) => {
            // Claude's word and the stored one part only when the house refused the answer; a missing answer is the sixth word.
            const refused = rule.said !== rule.verdict;
            return (
              // A judged rule has no id on the wire; its place in the ordered list is its identity on this page.
              <li key={index} className="flex flex-col gap-1.5 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                  <p className="min-w-0 flex-[1_1_220px] text-[13.5px] font-medium leading-snug text-foreground [overflow-wrap:anywhere]">{rule.words}</p>
                  <StateBadge look={VERDICT_LOOK[rule.verdict]} words={t(`cerberus.bulletins.verdict.${rule.verdict}`)} />
                </div>
                {rule.from_revision !== null && (
                  <p className="text-[12px] text-ink-faint">
                    {t('cerberus.bulletins.judged.fromRevision')} <span className="tabular-nums">{rule.from_revision}</span>
                  </p>
                )}
                {refused && (
                  <p className="text-[12.5px] text-warn-ink">
                    {rule.said === '(no entry)'
                      ? t('cerberus.bulletins.judged.noEntry')
                      : t('cerberus.bulletins.judged.refused', { said: t(`cerberus.bulletins.verdict.${rule.said}`) })}
                  </p>
                )}
                {rule.reason !== null && <Labeled label={t('cerberus.bulletins.judged.why')} words={rule.reason} />}
                {rule.duplicate_of_words !== null && <Labeled label={t('cerberus.bulletins.judged.sameAs')} words={rule.duplicate_of_words} />}
                {rule.quote !== null && <PageQuote words={rule.quote} />}
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}
