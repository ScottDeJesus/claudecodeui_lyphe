import { ChevronRight } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { DashboardCaseSentence } from '@/modules/kanban/dashboard/DashboardCaseSentence';
import type { BugDashboardPart, CasesOpenRegression, CasesRegressionTicket, CasesStats, CasesSuiteStats, DataTableColumn, Tone } from '@/shared/types';
import { Badge, Banner, DataTable, EmptyState, Rule } from '@/shared/ui';
import { formatShortDate } from '@/shared/utils';

/**
 * THE REGRESSION CASES: the cases that wait on the operator, every suite counted as it reads now, and the other
 * regressions still open.
 *
 * ONE READ, AND WHEN IT DID NOT ANSWER THE SECTION SAYS SO. The counts come from the house's `cases stats`; a refusal
 * is that command's own sentence in the section's place, and no table, no count and no "0 regressed" is drawn under it.
 *
 * THE OPERATOR'S CASES STAND FIRST, AND ONLY WHILE THERE ARE ANY. Two cures have ended on each and it still breaks, so
 * no third is sent: they are the rows of this section that wait on a person, and they sit directly under its title.
 * That is said ONCE, over the list, and not on every row. A row is the case's sentence, when it broke and in which
 * suite, and its card as a press when it has one. It wears no cure badge and no "no card yet": on these rows both are
 * true of every one and give the reader nothing to do.
 *
 * A CASE IS DRAWN ONCE. A case of the operator's is, by the house's own rule, an open regression too, and the answer
 * carries it in both lists. Here it is drawn among the operator's and left out of the others, which are then titled as
 * the others, so a suite's "5 regressed" is five rows on this face and never ten.
 *
 * A SUITE IS A ROW: how many of its cases are regressed, broken or cannot run, how many hold, and what its last night
 * read. WHAT IS WRONG STANDS FIRST, next to the suite's name, so on a phone the columns that fit without scrolling are
 * the ones a reader came for; the holding count, the largest and the calmest, follows. A regressed count that is not
 * zero wears the amber mark; every other figure is ink, and a suite no night has run says that in words.
 *
 * ANY OTHER OPEN REGRESSION IS ITS SENTENCE, then when it broke and in which suite, then where its cure stands: a
 * sentence with its own mark, in the reader's words, never the walk record's status. Its card is a press that opens it;
 * a regression whose ticket no board has taken says so instead.
 *
 * A SENTENCE IS HELD TO THREE LINES, its whole one press away (`DashboardCaseSentence`): the cases' own sentences are
 * paragraphs.
 */

type DashboardCasesProps = {
  /** `cases stats`, or the sentence of the read that did not answer. */
  cases: BugDashboardPart<CasesStats>;
  /** The window, in days. */
  days: number;
  /** Opens a card on its board. */
  onOpenCard: (cardId: string, boardId: string) => void;
};

/**
 * Where a cure stands, for each word the house reads off a cure walk (`due.cure_state`: `walking`, `stopped`, `gone`,
 * or the walk record's own status), each with its tone. A word not listed here is said as a cure that ended without
 * curing the case, which is all that is known of it: the raw word is never printed.
 */
const CURE_WORDS: Record<string, { key: string; tone: Tone }> = {
  walking: { key: 'kanban.dashboard.cases.cure.walking', tone: 'info' },
  done: { key: 'kanban.dashboard.cases.cure.done', tone: 'positive' },
  ruling: { key: 'kanban.dashboard.cases.cure.ruling', tone: 'warn' },
  'nothing-changed': { key: 'kanban.dashboard.cases.cure.nothingChanged', tone: 'warn' },
  blocked: { key: 'kanban.dashboard.cases.cure.blocked', tone: 'warn' },
  stopped: { key: 'kanban.dashboard.cases.cure.stopped', tone: 'warn' },
  dead: { key: 'kanban.dashboard.cases.cure.stopped', tone: 'warn' },
  gone: { key: 'kanban.dashboard.cases.cure.gone', tone: 'neutral' },
};

/** A case's identity across the answer's two lists: a name is only unique inside its suite. */
const caseKey = (item: { suite: string; name: string }) => `${item.suite}/${item.name}`;

/** Rendered by BugDashboard, fifth. Nothing else mounts it. */
export function DashboardCases({ cases, days, onOpenCard }: DashboardCasesProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const openId = useId();
  const theirsId = useId();

  const heading = <Rule id={headingId}>{t('kanban.dashboard.cases.title')}</Rule>;

  if (!cases.ok) {
    return (
      <section className="flex flex-col gap-3" aria-labelledby={headingId} data-dashboard-cases="unread">
        {heading}
        <Banner tone="warn">{t('kanban.dashboard.cases.failed', { error: cases.error })}</Banner>
      </section>
    );
  }

  const { suites, regressions } = cases.value;
  const { theirs } = regressions;
  // Each case once: the operator's are drawn in their own list, so the open list is every other regression.
  const theirKeys = new Set(theirs.map(caseKey));
  const others = regressions.open.filter((regression) => !theirKeys.has(caseKey(regression)));
  // An operator's case carries no ticket of its own in the answer; its open regression, the same case, does.
  const ticketOf = new Map(regressions.open.map((regression) => [caseKey(regression), regression.ticket] as const));

  const columns: DataTableColumn<CasesSuiteStats>[] = [
    { key: 'suite', label: t('kanban.dashboard.cases.columns.suite'), render: (suite) => suite.name },
    {
      key: 'regressed',
      label: t('kanban.dashboard.cases.columns.regressed'),
      align: 'end',
      render: (suite) => (suite.regressed > 0 ? <Badge tone="warn" className="vv-badge--compact">{suite.regressed.toLocaleString()}</Badge> : suite.regressed),
    },
    { key: 'broken', label: t('kanban.dashboard.cases.columns.broken'), align: 'end', render: (suite) => suite.broken.toLocaleString() },
    { key: 'cantRun', label: t('kanban.dashboard.cases.columns.cantRun'), align: 'end', render: (suite) => suite.cant_run.toLocaleString() },
    { key: 'holding', label: t('kanban.dashboard.cases.columns.holding'), align: 'end', render: (suite) => suite.holding.toLocaleString() },
    {
      key: 'night',
      label: t('kanban.dashboard.cases.columns.night'),
      render: (suite) => (
        <span className="block min-w-44">
          {suite.night === null
            ? t('kanban.dashboard.cases.noNight')
            : t('kanban.dashboard.cases.night', {
                date: formatShortDate(suite.night.day) ?? suite.night.day,
                ran: suite.night.ran.toLocaleString(),
                held: suite.night.held.toLocaleString(),
                broken: suite.night.broken.toLocaleString(),
                cannotRun: suite.night.cannot_run.toLocaleString(),
              })}
        </span>
      ),
    },
  ];

  /** Where the regression's cure stands, as a badge: the sentence for the word the house read, or for an ending it has no word for. */
  const cureBadge = (regression: CasesOpenRegression) => {
    if (regression.walk_word === null) return <Badge tone="neutral" className="vv-badge--compact">{t('kanban.dashboard.cases.cure.none')}</Badge>;
    const known = CURE_WORDS[regression.walk_word];
    return <Badge tone={known?.tone ?? 'warn'} className="vv-badge--compact">{t(known?.key ?? 'kanban.dashboard.cases.cure.ended')}</Badge>;
  };

  /** A ticket's card as a press, or `null` while no board has taken the ticket: only a card on a board can be opened. */
  const cardPress = (ticket: CasesRegressionTicket | null | undefined) => {
    if (!ticket || ticket.board === null || ticket.card === null) return null;
    const { board, card } = ticket;
    return (
      <button type="button" className="dash-row" data-dashboard-card={card} onClick={() => onOpenCard(card, board)}>
        <span className="min-w-0 flex-1 break-words">{ticket.title}</span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
    );
  };

  return (
    <section className="flex flex-col gap-5" aria-labelledby={headingId} data-dashboard-cases="read">
      {heading}

      {theirs.length > 0 && (
        <div className="flex flex-col gap-3" role="group" aria-labelledby={theirsId} data-dashboard-theirs>
          <div className="flex flex-col gap-0.5">
            <Rule id={theirsId} level={4} end={theirs.length.toLocaleString()} endTone="warn">{t('kanban.dashboard.cases.theirs.title')}</Rule>
            <p className="text-xs text-muted-foreground">{t('kanban.dashboard.cases.theirs.about')}</p>
          </div>
          <ul className="ast-trace">
            {theirs.map((mine) => (
              <li key={caseKey(mine)} className="ast-trace-item" data-dashboard-case={mine.name}>
                <span className="ast-trace-bead" aria-hidden="true" />
                <DashboardCaseSentence sentence={mine.sentence} />
                <span className="text-xs text-muted-foreground">
                  {t('kanban.dashboard.cases.broke', { date: formatShortDate(mine.broke_at) ?? '—', suite: mine.suite })}
                </span>
                {cardPress(ticketOf.get(caseKey(mine)))}
              </li>
            ))}
          </ul>
        </div>
      )}

      {suites.length === 0 ? (
        <EmptyState size="sm" title={t('kanban.dashboard.cases.noSuites')} />
      ) : (
        <DataTable rows={suites} columns={columns} rowKey={(suite) => suite.repo} label={t('kanban.dashboard.cases.suitesLabel')} />
      )}

      <div className="flex flex-col gap-3" role="group" aria-labelledby={openId} data-dashboard-regressions>
        <div className="flex flex-col gap-0.5">
          <Rule id={openId} level={4}>
            {theirs.length > 0 ? t('kanban.dashboard.cases.open.titleOthers') : t('kanban.dashboard.cases.open.title')}
          </Rule>
          <p className="text-xs text-muted-foreground">
            {regressions.ruled === 0
              ? t('kanban.dashboard.cases.open.summaryNone', { days })
              : t('kanban.dashboard.cases.open.summary', { days, ruled: regressions.ruled, cured: regressions.cured })}
          </p>
        </div>
        {others.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {theirs.length > 0 ? t('kanban.dashboard.cases.open.noneOthers') : t('kanban.dashboard.cases.open.none')}
          </p>
        ) : (
          <ul className="ast-trace">
            {others.map((regression) => (
              <li key={caseKey(regression)} className="ast-trace-item" data-dashboard-case={regression.name}>
                <span className="ast-trace-bead" aria-hidden="true" />
                <DashboardCaseSentence sentence={regression.sentence} />
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  {t('kanban.dashboard.cases.broke', { date: formatShortDate(regression.broke_at) ?? '—', suite: regression.suite })}
                  {cureBadge(regression)}
                </span>
                {cardPress(regression.ticket) ?? (
                  <span className="text-xs text-muted-foreground">
                    {regression.ticket === null ? t('kanban.dashboard.cases.open.noCard') : t('kanban.dashboard.cases.open.waitingBoard')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
