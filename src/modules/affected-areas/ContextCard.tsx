import type { TFunction } from 'i18next';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { capitalized, listWords, spoken } from '@/modules/affected-areas/utils/tourModel';
import type { ContextSummary } from '@/shared/affected-areas-types';
import { useHostWindow } from '@/shared/context/HostWindowContext';
import { Button, Card } from '@/shared/ui';
import { cn, formatShortDate, resizeObserverIn } from '@/shared/utils';

type ContextCardProps = {
  context: ContextSummary;
  /** Whether a job claims the tour. An unlinked tour's facts come from DocuSketch alone, and the card says so in a line of its own. */
  linked: boolean;
};

const EYEBROW = 'text-xs uppercase tracking-[0.14em] text-ink-faint';

/**
 * Where the facts came from, in a person's words: the source tables shadow-connector names, folded into the four
 * places they live ("DocuSketch, the job, XactAnalysis and drying reports"), each once, in the order first named.
 * A source this table does not know is spoken as it is, never dropped.
 */
function sourceWords(sources: string[], t: TFunction): string {
  const places = sources.map((source) => {
    if (source.startsWith('docusketch')) return t('affectedAreas.context.source.docusketch');
    if (source === 'jobs' || source === 'v_job_360') return t('affectedAreas.context.source.job');
    if (source.startsWith('xactanalysis')) return t('affectedAreas.context.source.xactanalysis');
    if (source.includes('drying')) return t('affectedAreas.context.source.drying');
    return spoken(source);
  });
  return listWords([...new Set(places)], t);
}

/**
 * WHAT THE READER IS TOLD: the facts the reader receives with every view, so a finding can be read against what it
 * was told. They are the same facts for every tour; an unlinked tour's come from DocuSketch alone (its loss type and
 * carrier, when it has them).
 *
 * Read top to bottom: the loss in one line ("Water loss · category 2 · class 2"), a stated cause when there is one,
 * the insured's own account folded to two lines with Show all, then the facts that frame it — date of loss, days
 * from the loss to the tour, year built, carrier — and last, where all of it came from. A fact the tour does not
 * carry is left out rather than drawn empty. The property type is not among them: the reader is never told it.
 *
 * A linked job that carries no loss details yet says that, and that the account is not on file. An unlinked tour adds
 * one line saying no job claims it; when it has no facts at all, that line is all it shows besides its source.
 *
 * Used by the affected-areas module's `TourScreen`, which keys it by tour, so the next tour's account opens folded.
 */
export function ContextCard({ context, linked }: ContextCardProps) {
  const { t } = useTranslation();
  const headingId = useId();
  // The account's box: the fold is measured off it, and Show all hands it the keyboard.
  const quoteRef = useRef<HTMLQuoteElement>(null);
  // Whether the account is drawn whole, once Show all is pressed. Local: nothing else asks for it.
  const [whole, setWhole] = useState(false);
  // Whether the folded account hides lines, so Show all is offered only when there is more to read. Measured, not
  // derivable: it depends on the width the account is laid out in.
  const [long, setLong] = useState(false);
  const hostWindow = useHostWindow();
  useEffect(() => {
    const quote = quoteRef.current;
    if (quote === null) return undefined;
    // `observe` delivers a first reading of its own, so the fold is measured as soon as the account is laid out. More
    // than half a line of content below the box is hidden lines; less is only glyphs reaching past the leading.
    const observer = resizeObserverIn(hostWindow, () => {
      const line = Number.parseFloat(getComputedStyle(quote).lineHeight);
      setLong(quote.scrollHeight - quote.clientHeight > line / 2);
    });
    observer?.observe(quote);
    return () => observer?.disconnect();
  }, [context.lossAccount, hostWindow]);
  const onShowAll = () => {
    setWhole(true);
    // The press is gone once the account is whole, and the folded account was already in view, so nothing scrolls.
    quoteRef.current?.focus({ preventScroll: true });
  };

  const loss = [
    context.lossType === null ? null : t('affectedAreas.context.loss', { type: capitalized(spoken(context.lossType)) }),
    context.waterCategory === null ? null : t('affectedAreas.context.category', { n: context.waterCategory }),
    context.waterClass === null ? null : t('affectedAreas.context.class', { n: context.waterClass }),
  ].filter((part) => part !== null).join(' · ');

  const facts: [string, string][] = [];
  const lostOn = formatShortDate(context.dateOfLoss);
  if (lostOn !== null) facts.push([t('affectedAreas.context.dateOfLoss'), lostOn]);
  if (context.daysLossToTour !== null) facts.push([t('affectedAreas.context.toTour'), t('affectedAreas.context.toTourDays', { count: context.daysLossToTour })]);
  if (context.yearBuilt !== null) facts.push([t('affectedAreas.context.built'), String(context.yearBuilt)]);
  if (context.carrier !== null) facts.push([t('affectedAreas.context.carrier'), context.carrier]);

  return (
    <Card role="region" aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3 px-[18px] py-4">
      <h3 id={headingId} className={EYEBROW}>{t('affectedAreas.context.title')}</h3>
      {loss !== '' && <p className="text-[15px] font-medium text-foreground">{loss}</p>}
      {context.statedCause !== null && <p className="text-[13.5px]">{t('affectedAreas.context.cause', { cause: context.statedCause })}</p>}
      {context.lossAccount !== null ? (
        <div className="flex max-w-[760px] flex-col items-start gap-0.5">
          <blockquote
            ref={quoteRef}
            tabIndex={-1}
            className={cn(
              'm-0 w-full whitespace-pre-wrap border-l-2 border-border pl-3 text-[13.5px] leading-relaxed text-foreground outline-none [overflow-wrap:anywhere] focus-visible:outline-none',
              !whole && 'line-clamp-2',
            )}
          >
            {context.lossAccount}
          </blockquote>
          {long && !whole && (
            <Button variant="link" size="sm" className="ml-1.5 h-7 px-1.5 max-md:h-11" onClick={onShowAll}>
              {t('affectedAreas.context.showAll')}
            </Button>
          )}
        </div>
      ) : (
        linked && <p className="text-[13.5px] text-muted-foreground">{t('affectedAreas.context.noAccount')}</p>
      )}
      {facts.length > 0 ? (
        <dl className="m-0 grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-x-6 gap-y-3">
          {facts.map(([term, detail]) => (
            <div key={term} className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">{term}</dt>
              <dd className="m-0 text-[13.5px] text-foreground [overflow-wrap:anywhere]">{detail}</dd>
            </div>
          ))}
        </dl>
      ) : (
        linked && loss === '' && <p className="text-[13.5px] text-muted-foreground">{t('affectedAreas.context.nothing')}</p>
      )}
      {!linked && <p className="text-[13.5px] text-muted-foreground">{t('affectedAreas.context.docusketchOnly')}</p>}
      <p className="text-xs text-muted-foreground">{t('affectedAreas.context.from', { sources: sourceWords(context.sources, t) })}</p>
    </Card>
  );
}
