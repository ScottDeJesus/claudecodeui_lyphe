import { Check, Plus } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { KanbanMutations } from '@/modules/kanban/hooks/useKanbanMutations';
import type { KanbanCardDetail } from '@/shared/kanban-types';
import { Button, KeyValueList, Rule } from '@/shared/ui';
import { formatRelativeTime } from '@/shared/utils';

/**
 * THE RUN'S LEDGER: what went wrong, what it cost, and what it had to say at the end.
 *
 * THREE BLOCKS IN THE ORDER A READER ACTS ON THEM. An open issue is red, and it is first because
 * red means act now. Spend is second — context, never a verdict, so it carries no tone at all and
 * is spelled in tabular figures a reader can compare down a column. The closing remarks are last,
 * because they are a record rather than a decision.
 *
 * THE CHANGELOG LINE STANDS UNDER THE CLOSING REMARKS: the one sentence the card's walk left for a
 * person using the thing, as the dashboard's changelog prints it. It is read here and not typed:
 * the walk writes it. A card that has none draws no place for one.
 *
 * NOTHING HERE LETS A RUN PROCEED OR HOLDS IT BACK. A card on a self-running board is walked the
 * moment it is in To Do; what stops a walk is a question, and that is answered in its own section.
 *
 * SPEND IS NEVER A JUDGEMENT. Four counters on the design system's label column and their sum at
 * the end of its Rule, no bar, no colour, no threshold: this board has no budget to be over, and
 * painting a number amber invents one. A card that has spent nothing has no spend section.
 *
 * EACH BLOCK UNDER ITS RULE, NOTHING BOXED. An open issue is a red ✕, a resolved one a green ✓
 * (finished is green) with who closed it; the closing remarks are text written in place.
 *
 * EVERY WRITE BELOW IS A VERB ON `useKanbanMutations`, handed down by the shell: that hook is where
 * a write becomes a toast and where a refusal carries the server's own sentence, so this file
 * reaches the network through nothing of its own.
 *
 * NONE OF THEM IS GATED ON AUTONOMY. This whole section is what autonomy hides — and hiding a
 * SECTION is the entirety of that setting. With it off these presses are not on screen to make;
 * they are never refused, and the server has no idea the switch exists.
 */

type DrawerIssuesAndTokensProps = {
  /** The open card, as the shell read it. This section fetches nothing. */
  detail: KanbanCardDetail;
  /** The board's verbs, from the shell. This section reaches the network through none of its own. */
  writes: KanbanMutations;
};

/** Rendered by KanbanCardDrawer while autonomy is on. Nothing else mounts it. */
export function DrawerIssuesAndTokens({ detail, writes }: DrawerIssuesAndTokensProps) {
  const { t } = useTranslation();
  const issuesHeadingId = useId();
  const spendHeadingId = useId();
  const issueId = useId();
  const remarksId = useId();

  const [issue, setIssue] = useState('');
  const [remarks, setRemarks] = useState(detail.closingRemarks);

  const open = detail.issues.filter((row) => !row.resolved).length;

  // The line the card's walk left for a person using the thing; a card with none draws no place for one.
  const changelog = detail.changelog.trim();

  const spend = [
    { key: 'in', labelKey: 'kanban.tokens.in', value: detail.buildTokensIn },
    { key: 'out', labelKey: 'kanban.tokens.out', value: detail.buildTokensOut },
    { key: 'cacheRead', labelKey: 'kanban.tokens.cacheRead', value: detail.buildTokensCacheRead },
    { key: 'cacheCreate', labelKey: 'kanban.tokens.cacheCreate', value: detail.buildTokensCacheCreate },
  ];

  const fileIssue = async () => {
    const next = issue.trim();
    if (next.length === 0) return;
    if (await writes.fileIssue(detail.id, next)) setIssue('');
  };

  const resolveIssue = (id: string) => {
    void writes.resolveIssue(id);
  };


  const saveRemarks = () => {
    if (remarks === detail.closingRemarks) return;
    void writes.updateCard(detail.id, { closingRemarks: remarks });
  };

  return (
    <section className="flex flex-col gap-5">
      <section className="flex flex-col gap-2" aria-labelledby={issuesHeadingId} data-drawer-issues="">
        <Rule id={issuesHeadingId} end={open > 0 ? t('kanban.issues.open', { count: open }) : undefined} endTone="danger">
          {t('kanban.issues.title')}
        </Rule>

        {detail.issues.length > 0 && (
          <ul className="flex flex-col gap-2">
            {detail.issues.map((row) => (
              <li key={row.id} className="flex items-start gap-2">
                <span className="bug-glyph" data-tone={row.resolved ? 'positive' : 'danger'} aria-hidden="true">
                  {row.resolved ? '✓' : '✕'}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className={row.resolved ? 'text-[13px] leading-[18px] text-muted-foreground' : 'text-[13px] leading-[18px] text-foreground'}>{row.text}</span>
                  {row.resolved && (
                    // Who closed it and when, because a resolved issue is a claim someone made.
                    <span className="text-xs text-ink-faint">
                      {t('kanban.issues.resolvedBy', {
                        who: row.resolvedBy ?? t('kanban.issues.someone'),
                        when: formatRelativeTime(row.resolvedAt),
                      })}
                    </span>
                  )}
                </div>
                {!row.resolved && (
                  <Button variant="outline" size="sm" className="h-7 shrink-0 gap-1 px-2 finger:size-11 finger:px-0" aria-label={t('kanban.issues.resolve')} title={t('kanban.issues.resolve')} onClick={() => resolveIssue(row.id)}>
                    <Check aria-hidden="true" />
                    <span className="finger:sr-only">{t('kanban.issues.resolve')}</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="bug-add">
          <input
            id={issueId}
            value={issue}
            onChange={(event) => setIssue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void fileIssue();
            }}
            placeholder={t('kanban.issues.filePlaceholder')}
            aria-label={t('kanban.issues.file')}
            className="bug-field"
          />
          {issue.trim().length > 0 && (
            <Button variant="outline" size="icon" className="size-7 shrink-0 finger:size-11" aria-label={t('kanban.issues.file')} title={t('kanban.issues.file')} onClick={() => void fileIssue()}>
              <Plus aria-hidden="true" />
            </Button>
          )}
        </div>
      </section>

      {detail.buildTokens > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby={spendHeadingId} data-drawer-spend="">
          <Rule id={spendHeadingId} end={t('kanban.tokens.total', { total: detail.buildTokens.toLocaleString() })}>
            {t('kanban.tokens.title')}
          </Rule>
          <KeyValueList items={spend.map((counter) => [t(counter.labelKey), counter.value.toLocaleString()] as const)} />
        </section>
      )}

      <section className="flex flex-col gap-1" aria-labelledby={`${remarksId}-rule`}>
        <Rule id={`${remarksId}-rule`}>{t('kanban.closing.title')}</Rule>
        <textarea
          id={remarksId}
          rows={2}
          value={remarks}
          onChange={(event) => setRemarks(event.target.value)}
          onBlur={saveRemarks}
          placeholder={t('kanban.closing.placeholder')}
          aria-labelledby={`${remarksId}-rule`}
          className="bug-field"
        />
      </section>

      {changelog.length > 0 && (
        <section className="flex flex-col gap-1" aria-labelledby={`${remarksId}-changelog`}>
          <Rule id={`${remarksId}-changelog`}>{t('kanban.changelog.title')}</Rule>
          {/* Read here and not typed: the walk writes it. What it is for is its title. */}
          <p className="text-[13px] leading-[18px] text-foreground" title={t('kanban.changelog.helper')} data-drawer-changelog>{changelog}</p>
        </section>
      )}
    </section>
  );
}
