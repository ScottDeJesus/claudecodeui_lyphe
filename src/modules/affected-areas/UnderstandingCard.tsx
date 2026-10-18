import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { capitalized, spoken } from '@/modules/affected-areas/utils/tourModel';
import type { ReadState, Understanding } from '@/shared/affected-areas-types';
import { Card } from '@/shared/ui';
import { formatRelativeTime } from '@/shared/utils';

type UnderstandingCardProps = {
  understanding: Understanding;
  /** The read it came from: who read it, under which contract, and when. */
  read: ReadState | null;
};


/**
 * WHAT THE READER UNDERSTANDS of a face, apart from its regions: its summary of the view, then, term by term, the
 * surfaces it saw (each with its material and condition), the fixtures, whether it saw the source of the loss, the
 * contents, the construction, and what it could not see — the last being what a person checks before trusting an
 * empty face. A term the reader said nothing on is left out. Its foot names the model, the contract and when.
 *
 * Materials and fixtures are codebook keys and are spoken as they are ("engineered wood"); everything else is the
 * reader's own words.
 *
 * Used by the affected-areas module's `PanoScreen`, under the face, for a face that is read.
 */
export function UnderstandingCard({ understanding, read }: UnderstandingCardProps) {
  const { t } = useTranslation();
  const headingId = useId();
  // Each term with its lines: one line per surface, fixture or blind spot; one line for the rest.
  const terms: { term: string; lines: string[] }[] = [];
  const add = (key: string, lines: string[]) => {
    if (lines.length > 0) terms.push({ term: t(`affectedAreas.understanding.${key}`), lines });
  };
  add('surfaces', understanding.surfaces.map(({ surface, material, condition }) =>
    [capitalized(spoken(surface)), material === null ? null : spoken(material), condition].filter((part) => part !== null).join(' · ')));
  add('fixtures', understanding.fixtures.map(({ fixture, note }) => [capitalized(spoken(fixture)), note].filter((part) => part !== null).join(' · ')));
  if (understanding.source !== null) {
    const { seen, what } = understanding.source;
    add('source', [!seen
      ? t('affectedAreas.understanding.sourceNone')
      : what === null ? t('affectedAreas.understanding.sourceSeenBare') : t('affectedAreas.understanding.sourceSeen', { what })]);
  }
  add('contents', understanding.contents.length > 0 ? [understanding.contents.join(', ')] : []);
  add('construction', understanding.construction === null ? [] : [understanding.construction]);
  add('couldNotSee', understanding.couldNotSee);

  return (
    <Card role="region" aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3 px-[18px] py-4">
      <h3 id={headingId} className="text-xs uppercase tracking-[0.14em] text-ink-faint">{t('affectedAreas.understanding.title')}</h3>
      {understanding.summary !== null && <p className="text-[13.5px] leading-relaxed text-foreground">{understanding.summary}</p>}
      {terms.length > 0 && (
        <dl className="m-0 grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px]">
          {terms.map(({ term, lines }) => (
            <div key={term} className="contents">
              <dt className="text-muted-foreground">{term}</dt>
              <dd className="m-0 flex min-w-0 flex-col gap-0.5 text-foreground">
                {lines.map((line, index) => <span key={index} className="[overflow-wrap:anywhere]">{line}</span>)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {read !== null && read.model !== null && (
        <p className="text-xs text-muted-foreground">
          {t('affectedAreas.understanding.readBy', { model: read.model, contract: read.contractVersion ?? '—', when: formatRelativeTime(read.readAt) })}
        </p>
      )}
    </Card>
  );
}
