import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { RndFeatureReading } from '@/shared/analytics-types';
import { Badge, Button, Readout } from '@/shared/ui';
import { againstKeyOf, ownSectionOf, toneOf } from '@/modules/analytics/sections/rnd/rndReadingFigures';

type RndFeatureRowProps = {
  /** One adopted feature, as dispatcher rnd readings prints it. */
  feature: RndFeatureReading;
  /** Opens another Analytics section by its id: the feature's own tab. */
  onOpenSection: (id: string) => void;
};

/**
 * ONE FEATURE ADOPTED FROM R&D: IS IT DOING WHAT IT PROMISED. Read top to bottom in the order the question is asked:
 * which feature (its title, with the roadmap's word for it as a quiet badge), what is counted (says), the number now,
 * how it stands against the spike's own number, and last what was promised.
 *
 * THE NUMBER IS THE ROW'S ONE TONED THING. Better is the good green, worse the warn gold, level plain ink; the words
 * under it say which, so the tone is never colour alone, and the reading's own detail follows them on the same line.
 *
 * NO NUMBER IS NEVER A ZERO. Not built yet and a failed reading keep the figure's place with the kit's dash, so says and
 * the promise stay where they are in every row: the first says so quietly, the second is the row's only red and carries
 * the fault as the dispatcher wrote it. A feature with no measure named is one quiet line, and nothing else.
 *
 * ONE COLUMN ON A PHONE, TWO AT A DESK: there the figure stands in a column of its own at the row's right, so the
 * numbers of every feature are read down one line.
 *
 * The press, drawn only for a feature whose measure names a section the strip holds, opens that section.
 *
 * Rendered by RndReadingsSection, one per feature, inside its list. Nothing else mounts it.
 */
export function RndFeatureRow({ feature, onOpenSection }: RndFeatureRowProps) {
  const { t } = useTranslation('common');
  const { reading, state } = feature;
  const measure = state === 'none' ? null : feature.measure;
  const ownSection = ownSectionOf(feature);
  const noReading = t('analytics.rnd.noReading');

  return (
    <li
      className="grid min-w-0 grid-cols-1 gap-3 py-5 first:pt-0 last:pb-0 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-x-10"
      data-rnd-feature={feature.candidate}
      data-rnd-state={state}
    >
      <div className="flex min-w-0 flex-col gap-3 lg:col-start-1">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <h4 className="min-w-0 text-sm font-medium text-foreground [overflow-wrap:anywhere]">{feature.title}</h4>
          {feature.word !== null && (
            <Badge as="span" tone="neutral" className="flex-none">
              {feature.word}
            </Badge>
          )}
        </div>
        {measure === null ? (
          <p className="text-sm text-muted-foreground">{t('analytics.rnd.none')}</p>
        ) : (
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{measure.says}</p>
        )}
      </div>

      {measure !== null && (
        <>
          {/* A fault is a command's last line as written and a detail may hold a table's or a module's name: a long
              unbroken word wraps here, as the title, says and the promise do. */}
          <div className="min-w-0 [overflow-wrap:anywhere] lg:col-start-2 lg:row-span-2 lg:row-start-1">
            {state === 'read' && reading !== null ? (
              <Readout
                label={t('analytics.rnd.now')}
                value={reading.value}
                unit={measure.unit}
                tone={toneOf(reading.against)}
                change={{ words: t(againstKeyOf(reading.against), { baseline: measure.baseline.toLocaleString() }) }}
                note={reading.detail ?? undefined}
                unknownLabel={noReading}
              />
            ) : state === 'failed' ? (
              <Readout
                label={t('analytics.rnd.now')}
                value={null}
                change={{ words: t('analytics.rnd.failed'), tone: 'danger' }}
                note={feature.fault ?? undefined}
                unknownLabel={noReading}
              />
            ) : (
              <Readout label={t('analytics.rnd.now')} value={null} note={t('analytics.rnd.notBuilt')} unknownLabel={noReading} />
            )}
          </div>

          <div className="flex min-w-0 flex-col items-start gap-3 lg:col-start-1">
            <p className="text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
              <span className="font-medium text-foreground">{t('analytics.rnd.promised')}</span> {measure.promised}
            </p>
            {ownSection !== null && (
              <Button
                variant="outline"
                size="sm"
                className="finger:h-11"
                onClick={() => onOpenSection(ownSection.id)}
              >
                {t('analytics.rnd.open', { section: t(ownSection.titleKey) })}
                <ArrowRight aria-hidden="true" />
              </Button>
            )}
          </div>
        </>
      )}
    </li>
  );
}
