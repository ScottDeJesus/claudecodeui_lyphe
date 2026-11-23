import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { RepeatsAnalytics, RepeatsFamily } from '@/shared/analytics-types';
import { trendMark } from '@/shared/trend';
import type { DataTableColumn, Tone } from '@/shared/types';
import { Badge, DataTable, DayChart, EmptyState, Rule } from '@/shared/ui';
// FILL: repeatsFigures import — the figures' own import takes this line's place: '@/modules/analytics/sections/repeats/repeatsFigures'
import {
  fakeCharsWords,
  fakeChoice,
  fakeDateWords,
  fakeFamilyDays,
  fakeFamilyDaysTotal,
  fakeFamilyTrend,
  fakeFamilyWords,
  fakeLikenessWords,
} from '@/modules/analytics/sections/repeats/repeatsFake';

type RepeatsFamiliesProps = {
  /** Every family found, the most characters first, as the answer orders them. */
  families: RepeatsFamily[];
  /** The line a family is raised at: launches and characters. */
  thresholds: RepeatsAnalytics['thresholds'];
  /** The days that line is counted over. */
  windowDays: number;
  /** The window, in days. */
  days: number;
};

/**
 * THE FAMILIES, ONE ROW EACH, THE LARGEST FIRST: WHICH REPEATED WORK TO CURE. A row leads with what repeats, cut from the
 * family's sentence so that no two rows start alike, and under it the family's standing in one of four words, its trend
 * (the heal tab's own mark and words), its id as the heal tab spells it, and what kind of work it is. Red is kept for the
 * one standing that is a regression: a family raised again after its cure. Then the three counts it is weighed in; a
 * family of custom steps says its uses, and how many worked, where the others say characters.
 *
 * A PRESSED ROW OPENS UNDER ITSELF on what a healer asks next, in that order: the sentence whole, what already does this
 * work (so the cure is to teach it, not to build it), what repeats, the file names, a few launches to read, and its days.
 * The opening keeps to the screen's own width and stays in view while the table is pushed sideways, so on a phone it is
 * read down, never across.
 *
 * With no family, the heading stays and its place says what a family is and that none has formed.
 *
 * Rendered by RepeatsSection, second. Nothing else mounts it.
 */
export function RepeatsFamilies({ families, thresholds, windowDays, days }: RepeatsFamiliesProps) {
  const { t } = useTranslation('common');
  const headingId = useId();
  const count = (figure: number) => figure.toLocaleString();

  // FILL: openFamily — useState<string | null>(null): the family open under its row, held here for the visit
  const openFamily: string | null = fakeChoice().openFamily;
  // FILL: onOpenFamily — that state's setter
  const onOpenFamily: (id: string | null) => void = () => {};
  // FILL: familyWords — repeatsFigures: what repeats, cut from the sentence (its features, or a step's place and features)
  const familyWords = fakeFamilyWords;
  // FILL: familyTrend — repeatsFigures: the family's last seven days against the seven before, as trendMark takes it
  const familyTrend = fakeFamilyTrend;
  // FILL: charsWords — repeatsFigures: a count of characters in short words ("412k")
  const charsWords = fakeCharsWords;
  // FILL: dateWords — repeatsFigures: a moment's day in short words ("Nov 14")
  const dateWords = fakeDateWords;

  if (families.length === 0) {
    return (
      <section className="flex min-w-0 flex-col gap-3" aria-labelledby={headingId} data-repeats-families="empty">
        <Rule id={headingId}>{t('analytics.repeats.families.title')}</Rule>
        <EmptyState
          title={t('analytics.repeats.families.empty.title')}
          message={t('analytics.repeats.families.empty.message', { launches: thresholds.launches, window: windowDays, days })}
        />
      </section>
    );
  }

  /** A family's standing, in the section's four words: back after its cure, raised, cured, or watched. */
  const standingOf = (family: RepeatsFamily): { tone: Tone; word: string } => {
    if (family.raised && family.cured_at !== null) return { tone: 'danger', word: t('analytics.repeats.families.status.back') };
    if (family.raised) return { tone: 'warn', word: t('analytics.repeats.families.status.raised') };
    if (family.cured_at !== null) return { tone: 'positive', word: t('analytics.repeats.families.status.cured', { date: dateWords(family.cured_at) }) };
    return { tone: 'neutral', word: t('analytics.repeats.families.status.watching') };
  };

  const columns: DataTableColumn<RepeatsFamily>[] = [
    {
      key: 'family',
      label: t('analytics.repeats.families.columns.family'),
      render: (family) => {
        const standing = standingOf(family);
        const trend = trendMark(familyTrend(family));
        return (
          <div className="flex min-w-44 flex-col gap-1.5 whitespace-normal" data-repeats-family={family.id}>
            <span className="line-clamp-2 break-words font-mono text-sm">{familyWords(family)}</span>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <Badge as="span" tone={standing.tone}>
                {standing.word}
              </Badge>
              <Badge as="span" tone={trend.tone} title={t('analytics.repeats.families.trendTitle')}>
                <span aria-hidden="true">{trend.glyph}</span>&nbsp;{trend.word}
              </Badge>
              <span className="font-mono">{family.id}</span>
              <span>{t('analytics.repeats.families.tool.' + family.tool)}</span>
            </span>
          </div>
        );
      },
    },
    {
      key: 'launches',
      label: t('analytics.repeats.families.columns.launches'),
      align: 'end',
      render: (family) => <span className="tabular-nums">{count(family.launches)}</span>,
    },
    {
      key: 'programs',
      label: t('analytics.repeats.families.columns.programs'),
      align: 'end',
      render: (family) => <span className="tabular-nums">{family.tool === 'step' ? '—' : count(family.programs)}</span>,
    },
    {
      key: 'chars',
      label: t('analytics.repeats.families.columns.chars'),
      align: 'end',
      render: (family) =>
        family.tool === 'step' ? (
          <span className="flex flex-col items-end">
            <span className="whitespace-nowrap tabular-nums">{t('analytics.repeats.families.uses', { count: family.uses ?? 0, uses: count(family.uses ?? 0) })}</span>
            <span className="whitespace-nowrap text-xs text-muted-foreground">{t('analytics.repeats.families.worked', { worked: count(family.worked ?? 0) })}</span>
          </span>
        ) : (
          <span className="tabular-nums">{charsWords(family.chars)}</span>
        ),
    },
  ];

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby={headingId} data-repeats-families>
      <Rule id={headingId} end={count(families.length)}>
        {t('analytics.repeats.families.title')}
      </Rule>
      <p className="max-w-prose text-xs text-muted-foreground">
        {t('analytics.repeats.families.about', { launches: thresholds.launches, chars: count(thresholds.chars), window: windowDays })}
      </p>

      <DataTable
        rows={families}
        columns={columns}
        rowKey={(family) => family.id}
        label={t('analytics.repeats.families.tableLabel', { days })}
        expanded={openFamily}
        onExpand={onOpenFamily}
        renderExpanded={(family) => <FamilyOpened family={family} days={days} />}
      />
    </section>
  );
}

/** One family, open under its row: drawn by the table above, and by nothing else. */
function FamilyOpened({ family, days }: { family: RepeatsFamily; days: number }) {
  const { t } = useTranslation('common');
  const id = useId();
  const count = (figure: number) => figure.toLocaleString();
  const step = family.tool === 'step';
  const command = 'heal-repeats show ' + family.id;

  // FILL: charsWords — repeatsFigures: a count of characters in short words ("412k")
  const charsWords = fakeCharsWords;
  // FILL: dateWords — repeatsFigures: a moment's day in short words ("Nov 14")
  const dateWords = fakeDateWords;
  // FILL: likenessWords — repeatsFigures: a likeness as a share ("63%")
  const likenessWords = fakeLikenessWords;
  // FILL: familyDays — repeatsFigures: the family's days for its plot, oldest first: the launches that wrote it each day
  const familyDays = fakeFamilyDays(family);
  // FILL: familyDaysTotal — repeatsFigures: those launches summed over the window, in words, for the legend
  const familyDaysTotal = fakeFamilyDaysTotal(family);

  return (
    <div className="sticky left-0 flex min-w-0 max-w-[calc(100vw-5rem)] flex-col gap-5 whitespace-normal py-2" data-repeats-family-opened={family.id}>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="max-w-prose break-words text-sm">{family.sentence}</p>
        <p className="text-xs text-muted-foreground">{t('analytics.repeats.families.opened.firstSeen', { date: dateWords(family.first_seen) })}</p>
        {family.cured_at !== null && family.since_cure !== null && (
          <p className="text-xs text-muted-foreground">
            {t('analytics.repeats.families.opened.sinceCure', {
              date: dateWords(family.cured_at),
              launches: count(family.since_cure.launches),
              programs: count(family.since_cure.programs),
              chars: charsWords(family.since_cure.chars),
            })}
          </p>
        )}
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-x-8 gap-y-5 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-5">
          <section className="flex min-w-0 flex-col gap-2" aria-labelledby={id + 'shelf'}>
            <Rule level={4} id={id + 'shelf'}>
              {t('analytics.repeats.families.opened.shelf')}
            </Rule>
            {family.existing.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('analytics.repeats.families.opened.shelfNone')}</p>
            ) : (
              <ul className="flex min-w-0 flex-col gap-2">
                {family.existing.map((entry) => {
                  const name = entry.path ?? entry.tool ?? '';
                  return (
                    <li key={name} className="flex min-w-0 flex-col gap-0.5">
                      <span className="break-all font-mono text-sm">{name}</span>
                      <span className="text-xs text-muted-foreground">
                        {entry.path === undefined && t('analytics.repeats.families.opened.shelfTool') + ' · '}
                        {t('analytics.repeats.families.opened.shelfLine', { likeness: likenessWords(entry.likeness), count: entry.used_by })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="flex min-w-0 flex-col gap-2" aria-labelledby={id + 'features'}>
            <Rule level={4} id={id + 'features'} end={count(family.features.length)}>
              {t('analytics.repeats.families.opened.features')}
            </Rule>
            <ul className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
              {family.features.map((feature) => (
                <li key={feature} className="break-all font-mono text-xs">
                  {feature}
                </li>
              ))}
            </ul>
          </section>

          <section className="flex min-w-0 flex-col gap-2" aria-labelledby={id + 'names'}>
            <Rule level={4} id={id + 'names'}>
              {t('analytics.repeats.families.opened.names')}
            </Rule>
            {family.names.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('analytics.repeats.families.opened.namesNone')}</p>
            ) : (
              <ul className="flex min-w-0 flex-col gap-1">
                {family.names.map((entry) => (
                  <li key={entry.name} className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 break-all font-mono">{entry.name}</span>
                    <span className="flex-none tabular-nums text-muted-foreground">{t('analytics.repeats.families.opened.nameCount', { count: entry.count })}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <section className="flex min-w-0 flex-col gap-2" aria-labelledby={id + 'examples'}>
            <Rule level={4} id={id + 'examples'}>
              {t('analytics.repeats.families.opened.examples')}
            </Rule>
            <ul className="flex min-w-0 flex-col gap-2">
              {family.examples.map((example) => (
                <li key={example.owner + '|' + example.path} className="flex min-w-0 flex-col gap-0.5">
                  <span className="break-all font-mono text-sm">{example.path}</span>
                  <span className="break-all text-xs text-muted-foreground">
                    {t('analytics.repeats.families.opened.exampleLine', { owner: example.owner, chars: count(example.chars) })}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="flex min-w-0 flex-col gap-2" aria-labelledby={id + 'days'}>
            <Rule level={4} id={id + 'days'}>
              {t('analytics.repeats.families.opened.days')}
            </Rule>
            <DayChart
              form="columns"
              series={[{ label: t('analytics.repeats.families.opened.daysSeries'), total: familyDaysTotal, mark: 'ink' }]}
              days={familyDays}
              label={t('analytics.repeats.families.opened.daysPlot', { days })}
              tickWords={(value) => value.toLocaleString()}
              todayLabel={t('analytics.repeats.trend.today')}
            />
          </section>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {t(step ? 'analytics.repeats.families.opened.moreStep' : 'analytics.repeats.families.opened.more')}{' '}
        <code className="break-all font-mono text-foreground">{command}</code>
      </p>
    </div>
  );
}
