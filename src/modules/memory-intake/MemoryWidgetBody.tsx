import { PinIcon, PlugZapIcon } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useMemoryIntake } from '@/modules/memory-intake/context/MemoryIntakeContext';
import { useApprovedMemories } from '@/modules/memory-intake/hooks/useApprovedMemories';
import { useMemoryReview } from '@/modules/memory-intake/hooks/useMemoryReview';
import { MemoryApprovedRow } from '@/modules/memory-intake/MemoryApprovedRow';
import { MemoryCandidateRow } from '@/modules/memory-intake/MemoryCandidateRow';
import { useToast } from '@/shared/context/ToastContext';
import type { MemoryCandidateLean, MemoryReviewOutcome, ToastRequest } from '@/shared/types';
import { Badge, EmptyState, Spinner } from '@/shared/ui';

/**
 * How many filed memories the gutter draws. The gutter is company for a conversation, not an
 * archive: twenty is more than anyone reads there, and the Memory tab remains the place to read
 * the whole list.
 */
const APPROVED_CAP = 20;

/**
 * The mark on a row THIS chat proposed: a glyph AND a word.
 *
 * Colour is never the whole signal (design doctrine :147-149) and neither is a shape, so the pin
 * carries the glance and the badge carries the words. The tone is `info` — which chat a memory came
 * from is news about which ROW this is, never a verdict on the memory.
 *
 * Written here and once more in `RunnerWidgetBody.tsx`; both memory sections share this one copy.
 * Two copies is below design doctrine §2's promote-on-the-third rule.
 */
function SessionPin() {
  const { t } = useTranslation();
  return (
    <span data-session-pin className="inline-flex items-center gap-1" title={t('gutters.pin.title')}>
      <PinIcon aria-hidden="true" className="h-3.5 w-3.5" />
      <Badge tone="info">{t('gutters.pin.label')}</Badge>
    </span>
  );
}

/**
 * Whether a row was proposed by the chat that is open. BOTH ids arrive already resolved to app
 * session ids (the server resolves Descent's unverified provenance column on the way out), so a
 * plain equality is the whole test — and a `null` session on either side is never a match:
 * "no session launched it" is not "this session launched it".
 */
function isMine(candidate: MemoryCandidateLean, sessionId: string | null): boolean {
  return sessionId !== null && candidate.sessionId === sessionId;
}

/**
 * This chat's rows lifted to the front, in the order they already had — a STABLE partition, so a
 * group never internally reorders and the list's own order survives the lift.
 */
function mineFirst(rows: MemoryCandidateLean[], sessionId: string | null): MemoryCandidateLean[] {
  return [
    ...rows.filter((candidate) => isMine(candidate, sessionId)),
    ...rows.filter((candidate) => !isMine(candidate, sessionId)),
  ];
}

/**
 * What one review is worth saying out loud — the row's own voicing, kept beside the verbs it
 * speaks for.
 *
 * A refusal and a card reviewed elsewhere are not faults: the first is the cap guard asking for a
 * shorter memory (warn, with Descent's own words under it), the second is simply news (neutral).
 * Only an unreachable Descent is a warning about the app's own footing.
 *
 * A second copy of the panel's own helper (it is module-private there, and this body is a second
 * surface for the same two verbs), still below the promote-on-the-third rule.
 */
function toastFor(outcome: MemoryReviewOutcome, t: ReturnType<typeof useTranslation>['t']): ToastRequest {
  switch (outcome.kind) {
    case 'filed':
      return { tone: 'positive', title: t('memory.toast.filed') };
    case 'discarded':
      return { tone: 'positive', title: t('memory.toast.discarded') };
    case 'refused': {
      const title = t('memory.toast.refused');
      // Descent's text goes under the headline, unless the headline IS it (no `error` was sent).
      return { tone: 'warn', title, message: outcome.reason === title ? undefined : outcome.reason };
    }
    case 'gone':
      return { tone: 'neutral', title: t('memory.toast.gone') };
    default:
      return { tone: 'warn', title: t('memory.toast.unreachable'), message: outcome.reason };
  }
}

/**
 * The memory lane as the desktop chat gutter draws it: what this chat proposed and cannot write
 * itself, then what has recently been filed.
 *
 * TWO SECTIONS, ONE CLOCK, NO FRAME. It reads the provider's `pending` (the app's one memory
 * poller) and `useApprovedMemories`, which re-reads on that poller's answer rather than running a
 * timer of its own — so the queue and the filed list are always the same reading of the same lane.
 * The chrome, the slots and the scrolling belong to `src/modules/chat-gutters`; this body is the
 * content and nothing else.
 *
 * THE PENDING VERBS ARE THE TAB'S VERBS. `useMemoryReview` and the toast helper are asked for here
 * exactly as the Memory tab asks for them, so a memory filed from the gutter is filed the same way
 * — same in-flight guard, same refusal text held per id, same words spoken afterwards.
 *
 * THE ONLY ORDERING THIS BODY DOES IS THE LIFT. Pending rows keep Descent's order; filed rows go
 * newest first, by review day and falling back to the day they were proposed.
 */
export function MemoryWidgetBody({ sessionId }: { sessionId: string | null }) {
  const { t } = useTranslation();
  const { pending } = useMemoryIntake();
  const approved = useApprovedMemories();
  const { review, refusals, busyId } = useMemoryReview();
  const push = useToast();

  const onReview = useCallback(async (id: string, approve: boolean) => {
    push(toastFor(await review(id, approve), t));
  }, [push, review, t]);

  // This chat's queue first, Descent's order inside each group. Nothing is re-sorted: the queue's
  // order is Descent's, and a second opinion would only make the gutter disagree with the tab.
  const pendingRows = useMemo(
    () => mineFirst(pending?.reachable ? pending.candidates : [], sessionId),
    [pending, sessionId],
  );

  // Filed memories: newest first, this chat's lifted, and the cap applied AFTER the lift — so an
  // older memory of this chat's can never be pushed off the end by newer ones that are not.
  const approvedRows = useMemo(() => {
    const rows = approved?.reachable ? approved.candidates : [];
    // ISO strings compare lexically, so no parsing is needed to sort by day.
    const newestFirst = [...rows].sort((a, b) =>
      (b.reviewedAt ?? b.createdAt ?? '').localeCompare(a.reviewedAt ?? a.createdAt ?? ''),
    );
    return mineFirst(newestFirst, sessionId).slice(0, APPROVED_CAP);
  }, [approved, sessionId]);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className="flex min-w-0 flex-col gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('gutters.memory.pending')}
        </h3>
        {pending === null ? (
          <Spinner label={t('memory.reading')} />
        ) : !pending.reachable ? (
          <EmptyState icon={PlugZapIcon} title={t('memory.unreachable')} />
        ) : pendingRows.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('gutters.memory.pendingEmpty')}</p>
        ) : (
          <ul data-testid="memory-widget-pending" className="flex min-w-0 flex-col gap-2">
            {pendingRows.map((candidate) => {
              const mine = isMine(candidate, sessionId);
              return (
                <li
                  key={candidate.id}
                  data-testid="memory-widget-row"
                  data-candidate-id={candidate.id}
                  data-pinned={String(mine)}
                  className="flex min-w-0 flex-col gap-1"
                >
                  {mine && <SessionPin />}
                  {/* The row renders its own `<li>`; `contents` keeps this one the only box between
                      the card and the list, which is what makes the list HTML valid. */}
                  <ul className="contents">
                    <MemoryCandidateRow
                      candidate={candidate}
                      // This surface's freshest refusal wins; the row's own copy is what every other
                      // surface sees once Descent has recorded it.
                      refusal={refusals[candidate.id] ?? candidate.refusal}
                      busy={busyId !== null}
                      onReview={onReview}
                    />
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex min-w-0 flex-col gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('gutters.memory.recent')}
        </h3>
        {approved === null ? (
          <Spinner label={t('memory.reading')} />
        ) : !approved.reachable ? (
          <p className="text-xs text-muted-foreground">{t('memory.unreachable')}</p>
        ) : approvedRows.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('gutters.memory.recentEmpty')}</p>
        ) : (
          <ul data-testid="memory-widget-approved" className="flex min-w-0 flex-col gap-2">
            {approvedRows.map((candidate) => {
              const mine = isMine(candidate, sessionId);
              return (
                <li
                  key={candidate.id}
                  data-testid="memory-widget-row"
                  data-candidate-id={candidate.id}
                  data-pinned={String(mine)}
                  className="flex min-w-0 flex-col gap-1"
                >
                  {mine && <SessionPin />}
                  <MemoryApprovedRow candidate={candidate} />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
