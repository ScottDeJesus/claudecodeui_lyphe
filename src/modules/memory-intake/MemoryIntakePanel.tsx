import { BrainIcon, InboxIcon, PlugZapIcon } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useMemoryIntake } from '@/modules/memory-intake/context/MemoryIntakeContext';
import { useMemoryReview } from '@/modules/memory-intake/hooks/useMemoryReview';
import { LessonReviewList } from '@/modules/memory-intake/LessonReviewList';
import { MemoryCandidateRow } from '@/modules/memory-intake/MemoryCandidateRow';
import { useToast } from '@/shared/context/ToastContext';
import type { MemoryReviewOutcome, ToastRequest } from '@/shared/types';
import { Badge, EmptyState, ScrollArea, Spinner } from '@/shared/ui';

/**
 * What one review is worth saying out loud.
 *
 * A refusal and a card reviewed elsewhere are not faults: the first is the cap guard asking for
 * a shorter memory (warn, with the server's own words under it), the second is simply news
 * (neutral). Only an unreachable queue is a warning about the app's own footing.
 */
function toastFor(outcome: MemoryReviewOutcome, t: ReturnType<typeof useTranslation>['t']): ToastRequest {
  switch (outcome.kind) {
    case 'filed':
      return { tone: 'positive', title: t('memory.toast.filed') };
    case 'discarded':
      return { tone: 'positive', title: t('memory.toast.discarded') };
    case 'refused': {
      const title = t('memory.toast.refused');
      // The server's text goes under the headline, unless the headline IS it (no `error` was sent).
      return { tone: 'warn', title, message: outcome.reason === title ? undefined : outcome.reason };
    }
    case 'gone':
      return { tone: 'neutral', title: t('memory.toast.gone') };
    default:
      return { tone: 'warn', title: t('memory.toast.unreachable'), message: outcome.reason };
  }
}

/**
 * The memory-intake queue: every memory a session proposed and cannot write itself.
 *
 * Two hooks on purpose — the shared reading, and this panel's own write lifecycle. Nothing is
 * written until a person files something here, which is the whole point of the surface.
 */
export function MemoryIntakePanel() {
  const { t } = useTranslation();
  const { pending, pendingCount, refresh } = useMemoryIntake();
  const { review, refusals, busyId } = useMemoryReview();
  const push = useToast();

  // Opening the tab is its own reason to ask: what a person reads is a reading of now, not
  // whatever the last minute's tick left behind.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onReview = useCallback(async (id: string, approve: boolean) => {
    push(toastFor(await review(id, approve), t));
  }, [push, review, t]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
          <BrainIcon className="h-4 w-4" aria-hidden="true" />
        </span>
        <h2 className="text-sm font-medium">{t('memory.title')}</h2>
        {/* A queue nobody could read has no count. Stating "0 pending" over the unreachable
            line would have the panel contradict itself in two adjacent lines. */}
        {pending?.reachable === true && (
          <Badge tone="neutral">{t('memory.pending', { count: pendingCount })}</Badge>
        )}
      </div>

      {/* ONE scroll for the whole tab, two sections inside it: the memory queue, then the lessons
          under their own heading. The queue's three non-list states are blocks of their own height
          rather than the pane's — a state that filled the pane would push the lessons below the
          fold on the very visit where the queue has nothing to show and they are all there is. */}
      <ScrollArea className="flex-1">
        {pending === null ? (
          // Not asked yet — a different fact from an empty queue, and never "All filed".
          <div className="flex items-center justify-center px-4 py-10">
            <Spinner label={t('memory.reading')} />
          </div>
        ) : !pending.reachable ? (
          <div className="flex items-center justify-center px-4 py-10">
            <EmptyState icon={PlugZapIcon} title={t('memory.unreachable')} />
          </div>
        ) : pendingCount === 0 ? (
          <div className="flex items-center justify-center px-4 py-10">
            <EmptyState icon={InboxIcon} title={t('memory.empty.title')} message={t('memory.empty.message')} />
          </div>
        ) : (
          // A measured column, centred: the queue is a stack of short cards, and letting them
          // run the full width of a desktop workspace leaves each one a line of text stranded
          // in a field of empty surface.
          <ul className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 py-5">
            {pending.candidates.map((candidate) => (
              <MemoryCandidateRow
                key={candidate.id}
                candidate={candidate}
                // This tab's freshest refusal wins; the row's own copy is what every other tab
                // sees once the server has recorded it.
                refusal={refusals[candidate.id] ?? candidate.refusal}
                // Every row, not just the one being written: `busyId` holds ONE id because the
                // design writes one at a time, so painting only that row leaves the other five
                // looking pressable and turns a refused press into a press that vanished.
                busy={busyId !== null}
                onReview={onReview}
              />
            ))}
          </ul>
        )}

        {/* The second section of the same review habit — not a tab, and not a provider: it reads
            and writes through its own hook and shares nothing with the queue above but the pane. */}
        <LessonReviewList />
      </ScrollArea>
    </div>
  );
}
