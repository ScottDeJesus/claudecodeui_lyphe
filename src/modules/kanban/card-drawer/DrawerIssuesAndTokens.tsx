import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { KanbanMutations } from '@/modules/kanban/hooks/useKanbanMutations';
import type { KanbanCardDetail } from '@/shared/kanban-types';
import { Badge, Button, Field, Input } from '@/shared/ui';
import { cn, formatRelativeTime } from '@/shared/utils';

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
 * SPEND IS NEVER A JUDGEMENT. Four counters and their sum, no bar, no colour, no threshold: this
 * board has no budget to be over, and painting a number amber invents one.
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
      <section className="flex flex-col gap-3" aria-labelledby={issuesHeadingId}>
        <div className="flex items-center gap-2">
          <h3 id={issuesHeadingId} className="text-sm font-semibold text-foreground">
            {t('kanban.issues.title')}
          </h3>
          {open > 0 && (
            <Badge tone="danger" className="vv-badge--compact">
              {t('kanban.issues.open', { count: open })}
            </Badge>
          )}
        </div>

        {detail.issues.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('kanban.issues.none')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {detail.issues.map((row) => (
              <li key={row.id} className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  className={cn('mt-0.5 shrink-0 text-xs', row.resolved ? 'text-ink-faint' : 'text-destructive')}
                >
                  {row.resolved ? '✓' : '✕'}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    className={cn(
                      'text-sm leading-snug',
                      row.resolved ? 'text-muted-foreground' : 'text-foreground'
                    )}
                  >
                    {row.text}
                  </span>
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
                  <Button
                    variant="tonal"
                    size="sm"
                    className="h-7 shrink-0 px-2"
                    onClick={() => resolveIssue(row.id)}
                  >
                    {t('kanban.issues.resolve')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-2">
          <Input
            id={issueId}
            value={issue}
            onChange={(event) => setIssue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') fileIssue();
            }}
            placeholder={t('kanban.issues.filePlaceholder')}
            aria-label={t('kanban.issues.file')}
            className="h-8"
          />
          <Button variant="tonal" size="sm" className="h-8 shrink-0" onClick={fileIssue}>
            {t('kanban.issues.file')}
          </Button>
        </div>
      </section>


      <section className="flex flex-col gap-2" aria-labelledby={spendHeadingId}>
        <h3 id={spendHeadingId} className="text-sm font-semibold text-foreground">
          {t('kanban.tokens.title')}
        </h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          {spend.map((counter) => (
            <div key={counter.key} className="flex flex-col">
              <dt className="text-xs text-muted-foreground">{t(counter.labelKey)}</dt>
              <dd className="vv-tabular text-sm text-foreground">{counter.value.toLocaleString()}</dd>
            </div>
          ))}
        </dl>
        <p className="vv-tabular text-xs text-ink-faint">
          {t('kanban.tokens.total', { total: detail.buildTokens.toLocaleString() })}
        </p>
      </section>

      <Field label={t('kanban.closing.title')} htmlFor={remarksId}>
        <textarea
          id={remarksId}
          rows={3}
          value={remarks}
          onChange={(event) => setRemarks(event.target.value)}
          onBlur={saveRemarks}
          placeholder={t('kanban.closing.placeholder')}
          className="vv-input w-full resize-y px-3 py-2 text-sm"
        />
      </Field>

      {changelog.length > 0 && (
        <Field label={t('kanban.changelog.title')} helper={t('kanban.changelog.helper')}>
          <p className="text-sm leading-snug text-foreground" data-drawer-changelog>{changelog}</p>
        </Field>
      )}
    </section>
  );
}
