import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { CommandLine } from '@/modules/carrier-bulletins/CommandLine';
import { PageQuote } from '@/modules/carrier-bulletins/QuotedWords';
import { QUESTIONS_COMMAND, requirementFacts } from '@/modules/carrier-bulletins/utils/bulletinWords';
import type { PageRequirement, SettledRule } from '@/shared/carrier-bulletins-types';
import { Banner, Card, EmptyState } from '@/shared/ui';

type RequirementListProps = {
  requirements: PageRequirement[];
  /** The carrier, which says whose settlement a requirement not yet in the rules waits on. */
  carrier: string;
};

/**
 * Where one requirement stands in the rules: the list rule it settled into, in the standing the rule has, with the rule's
 * open question when it carries one — in words, with the printed list's command beside it, never as a button: the view is
 * read-only, and the strict reading runs until the operator answers. A page read and not yet settled has no rule to point
 * at, and says whose settlement it waits on.
 */
function SettledInto({ rule, carrier }: { rule: SettledRule | null; carrier: string }) {
  const { t } = useTranslation();
  if (rule === null) return <p className="text-[12.5px] text-muted-foreground">{t('cerberus.bulletins.requirement.notSettled', { carrier })}</p>;
  return (
    <>
      <p className="text-[12.5px] text-muted-foreground">
        {t('cerberus.bulletins.requirement.settled')} <span className="font-medium text-foreground">{rule.state}</span>
      </p>
      {rule.question !== null && (
        <Banner tone="info">
          <p className="text-sm font-medium">{t('cerberus.bulletins.requirement.question')}</p>
          <p className="mt-0.5 text-[13px] [overflow-wrap:anywhere]">{rule.question}</p>
          <p className="mt-1.5 text-xs">{t('cerberus.bulletins.requirement.questionHow')}</p>
          <div className="mt-1"><CommandLine command={QUESTIONS_COMMAND} /></div>
        </Banner>
      )}
    </>
  );
}

/**
 * WHAT THIS PAGE REQUIRES: each requirement Claude read on the page, in a card — the requirement on one line, its facts in
 * the house's terms (what it is in the vocabulary, its deadline, its number, the jobs it reaches), the page's own words it
 * stands on, and where it settled (`SettledInto`).
 *
 * A page Claude read and found nothing on says so — "Claude found no requirement on this page" — which is an answer, not a
 * missing one. The requirement's words, its quote and its rule's question are text nodes (R-CERB-25); its facts are the
 * vocabulary's keys, never the bulletin's words.
 *
 * Used by the carrier-bulletins module's `ReadingColumn`, first, because what a page requires is what the operator came for.
 */
export function RequirementList({ requirements, carrier }: RequirementListProps) {
  const { t } = useTranslation();
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2">
      <h3 id={headingId} className="text-xs uppercase tracking-[0.14em] text-ink-faint">
        {t('cerberus.bulletins.page.requirementsTitle')} · {requirements.length}
      </h3>
      {requirements.length === 0 ? (
        <EmptyState title={t('cerberus.bulletins.page.nothing')} message={t('cerberus.bulletins.page.nothingMessage')} />
      ) : (
        <ul aria-labelledby={headingId} className="m-0 flex list-none flex-col gap-2.5 p-0">
          {requirements.map((requirement, index) => (
            // A requirement has no id on the wire; its place in the reading is its identity on this page.
            <li key={index}>
              <Card className="flex flex-col gap-2 px-[18px] py-3.5">
                <p className="text-[14.5px] font-medium leading-snug text-foreground [overflow-wrap:anywhere]">{requirement.words}</p>
                <p className="text-[12.5px] text-muted-foreground">{requirementFacts(requirement, t).join(' · ')}</p>
                {requirement.quote !== null && <PageQuote words={requirement.quote} />}
                <SettledInto rule={requirement.rule} carrier={carrier} />
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
