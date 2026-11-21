import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { Labeled, PageQuote } from '@/modules/carrier-bulletins/QuotedWords';
import type { NotPlaced, PageFailure } from '@/shared/carrier-bulletins-types';
import { Rule } from '@/shared/ui';

type SetAsideProps = {
  notPlaced: NotPlaced[];
  failures: PageFailure[];
};

/**
 * WHAT THE HOUSE SET ASIDE on this page, in two lists, each drawn only when it holds anything:
 * - DUTIES NOT PLACED: an explicit duty of the franchise that no key of the house's vocabulary names. It never runs (an
 *   obligation is never derived from an absence, R-SLANOTE-1), and it is kept here so it is seen: the page's words and
 *   what it asks.
 * - ENTRIES THE HOUSE'S CHECKS REFUSED: an answer of the reading that failed the house's checks — the rule it was about (or
 *   "A requirement Claude added"), what Claude said, the page's words, and each check it failed.
 *
 * The page's words, a duty's doubt and a rule's words are text nodes (R-CERB-25); the checks' failures are the house's
 * own sentences.
 *
 * Used by the carrier-bulletins module's `ReadingColumn`, last, after what the page requires and the rules judged there.
 */
export function SetAside({ notPlaced, failures }: SetAsideProps) {
  const { t } = useTranslation();
  const notPlacedId = useId();
  const failuresId = useId();

  return (
    <>
      {notPlaced.length > 0 && (
        <section aria-labelledby={notPlacedId} className="flex min-w-0 flex-col gap-2">
          <Rule id={notPlacedId} end={String(notPlaced.length)}>{t('cerberus.bulletins.notPlaced.title')}</Rule>
          <p className="text-[12.5px] text-muted-foreground">{t('cerberus.bulletins.notPlaced.why')}</p>
          <ul aria-labelledby={notPlacedId} className="m-0 list-none divide-y divide-border border-y border-border p-0">
            {notPlaced.map((duty, index) => (
              // A duty has no id on the wire; its place in the reading is its identity on this page.
              <li key={index} className="flex flex-col gap-1.5 py-3">
                <PageQuote words={duty.quote} />
                <Labeled label={t('cerberus.bulletins.notPlaced.asks')} words={duty.doubt} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {failures.length > 0 && (
        <section aria-labelledby={failuresId} className="flex min-w-0 flex-col gap-2">
          <Rule id={failuresId} end={String(failures.length)} endTone="warn">{t('cerberus.bulletins.failure.title')}</Rule>
          <ul aria-labelledby={failuresId} className="m-0 list-none divide-y divide-border border-y border-border p-0">
            {failures.map((failure, index) => (
              // A refused entry has no id on the wire; its place in the reading is its identity on this page.
              <li key={index} className="flex flex-col gap-1.5 py-3">
                <p className="text-[13.5px] font-medium leading-snug text-foreground [overflow-wrap:anywhere]">
                  {failure.words ?? t('cerberus.bulletins.failure.added')}
                </p>
                <p className="text-[12.5px] text-muted-foreground">
                  {failure.said === '(no entry)'
                    ? t('cerberus.bulletins.failure.noEntry')
                    : t('cerberus.bulletins.failure.said', { said: t(`cerberus.bulletins.verdict.${failure.said}`) })}
                </p>
                {failure.quote !== null && <PageQuote words={failure.quote} />}
                <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[12.5px] leading-relaxed text-warn-ink">
                  {failure.failures.map((check, at) => <li key={at} className="[overflow-wrap:anywhere]">{check}</li>)}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
