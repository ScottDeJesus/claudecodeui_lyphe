import { PlugZapIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useFollowupsContext } from '@/modules/followups/context/FollowupsContext';
import { FollowupRow } from '@/modules/followups/FollowupRow';
import type { Followup } from '@/shared/types';
import { Collapsible, CollapsibleContent, CollapsibleTrigger, EmptyState, FoldChevron, Spinner } from '@/shared/ui';

/** The two groups, in the order they are drawn, each with the locale key of its heading. */
const GROUPS = [
  { kind: 'next', headingKey: 'followups.group.next' },
  { kind: 'gap', headingKey: 'followups.group.gap' },
] as const;

/**
 * The Next steps widget's body: the open chat's own open items in two groups, "Next steps" and "Known gaps", and a
 * closed "Done (N)" fold at the bottom that lists the settled ones, each with an untick.
 *
 * Used by `src/modules/chat-gutters` (`ChatGutterLayout`), through the followups barrel, as the Next steps widget's
 * body. It reads the list the layout already made (`FollowupsContext`) — the same reading that gives the badge its
 * number — and draws nothing of its own state but the fold. The chrome, the header, the count and the scrolling belong
 * to the frame around it.
 *
 * A GROUP WITH NOTHING OPEN IS NOT DRAWN, and when both are empty the body says so in one sentence; the Done fold is
 * drawn whenever something is done, even then, because an untick is how a settled item comes back.
 */
export function FollowupsWidgetBody() {
  const { t } = useTranslation();
  const { items, unreachable, refresh, setDone } = useFollowupsContext();

  // Whether the Done fold is open. Essential: it is the fold's own state and nothing else holds it. The list inside is
  // not mounted while the fold is shut, so a settled row's hidden tick can never be reached with Tab.
  const [foldOpen, setFoldOpen] = useState(false);

  if (items === null) {
    return (
      <div className="flex items-center justify-center px-2 py-6">
        {unreachable ? (
          <EmptyState icon={PlugZapIcon} title={t('followups.unreachable')} actionLabel={t('followups.retry')} onAction={() => void refresh()} />
        ) : (
          <Spinner label={t('followups.reading')} />
        )}
      </div>
    );
  }

  const open = items.filter((item) => item.state === 'open');
  const done = items.filter((item) => item.state === 'done');
  const onToggle = (id: number, next: boolean) => void setDone(id, next);
  const rowsOf = (list: Followup[]) => list.map((item) => <FollowupRow key={item.id} item={item} onToggle={onToggle} />);

  return (
    <div data-followups-widget className="flex min-w-0 flex-col gap-4">
      {open.length === 0 && <p data-followups-empty className="text-sm text-muted-foreground">{t('followups.empty')}</p>}

      {GROUPS.map(({ kind, headingKey }) => {
        const group = open.filter((item) => item.kind === kind);
        if (group.length === 0) return null;
        return (
          <section key={kind} data-followups-group={kind} className="min-w-0">
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t(headingKey)}</h3>
            <ul className="flex min-w-0 flex-col">{rowsOf(group)}</ul>
          </section>
        );
      })}

      {done.length > 0 && (
        <Collapsible open={foldOpen} onOpenChange={setFoldOpen} data-followups-done className="min-w-0 border-t border-border pt-2">
          <CollapsibleTrigger className="flex w-full items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <FoldChevron collapsed={!foldOpen} />
            {t('followups.doneFold', { n: done.length })}
          </CollapsibleTrigger>
          <CollapsibleContent>{foldOpen && <ul className="mt-1 flex min-w-0 flex-col">{rowsOf(done)}</ul>}</CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
