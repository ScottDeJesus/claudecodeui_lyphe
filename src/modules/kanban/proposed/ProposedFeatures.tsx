import { CloudOff, Lightbulb } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ProposalDismissDialog } from '@/modules/kanban/proposed/ProposalDismissDialog';
import { ProposalPromoteDialog } from '@/modules/kanban/proposed/ProposalPromoteDialog';
import { ProposalRow } from '@/modules/kanban/proposed/ProposalRow';
import { readDispatcherAnswer } from '@/modules/kanban/utils/dispatcherAnswer';
import { api } from '@/shared/api';
import type { KanbanPriority } from '@/shared/kanban-types';
import type { BugProposal, ProposalsReading, ProposalsView } from '@/shared/types';
import { Banner, ConfirmDialog, EmptyState, SegmentedControl, Spinner } from '@/shared/ui';

/**
 * THE BUGS VIEW'S PROPOSED FEATURES FACE: the work that is too big for a ticket, or that says the design itself is
 * wrong, each waiting for one of three answers: promote it to the roadmap, send it back as a ticket, dismiss it.
 *
 * ONE ANSWER FIRST: how many wait for the operator's call, as a sentence, directly over the list. Under it, once,
 * what a proposal is and what can be done with one, for the reader who has never seen this face.
 *
 * TWO CONTROLS, AND THEY STAY PUT. Which boards (this one, or all) and which proposals (the open ones, or all) stand
 * at the head in every state, a spinner and a failure included. What they are set to is the panel's, so it survives
 * a visit to another face and a board switch.
 *
 * THE LIST IS THE SERVER'S ORDER: high priority first, then the oldest. This face sorts nothing, so a priority
 * changed here moves its row only when the answer that follows says so.
 *
 * FOUR STATES. Still reading: the ring, under the controls. The route did not answer: one sentence and Try again.
 * Nothing proposed: an empty state that says what would put something here. Else the rows.
 *
 * ONE QUESTION AT A TIME. A row's press opens its question over the face: the epic to promote under, a yes or no
 * to send it back, the reason to dismiss it. A refusal of the dispatcher's is said inside the question it answers,
 * and for a priority, which asks no question, on the row itself.
 *
 * IT COMPOSES, IT DOES NOT BUILD: the reading is the panel's (`useProposals`), each row and each dialog is a file of
 * its own, and every piece is the kit's.
 */

type ProposedFeaturesProps = {
  /** Which boards and which proposals, kept by the panel. */
  view: ProposalsView;
  onView: (view: ProposalsView) => void;
  /** The proposals as the panel's one read holds them. */
  reading: ProposalsReading;
  /** Ask again: the press of the state that says the proposals could not be read. */
  onRetry: () => void;
  /** Opens a card on its board: the Board face, that board, that card's sheet. */
  onOpenCard: (cardId: string, boardId: string) => void;
};

/** The question open over the face: which proposal, and which of the three answers is being given. */
type Asking = { id: number; act: 'promote' | 'send-back' | 'dismiss' };

/** Rendered by KanbanPanel while its face is the proposed features. Nothing else mounts it. */
export function ProposedFeatures({ view, onView, reading, onRetry, onOpenCard }: ProposedFeaturesProps) {
  const { t } = useTranslation();
  // The question open over the face, by the proposal's id: the proposal itself is read from the newest answer, so a
  // proposal that has ended elsewhere closes its question instead of asking about a row that is gone.
  const [asking, setAsking] = useState<Asking | null>(null);

  const [busy, setBusy] = useState<number | null>(null);
  const [refusal, setRefusal] = useState<{ id: number; sentence: string } | null>(null);
  // A ref, not `busy`: a second press before React re-renders still sees the state as it was, and would send twice.
  const out = useRef(false);

  const answer = async (proposal: BugProposal, request: () => Promise<Response>, closesQuestion: boolean) => {
    if (out.current) return;
    out.current = true;
    setBusy(proposal.id);
    setRefusal(null);
    const reply = await readDispatcherAnswer(request());
    out.current = false;
    setBusy(null);
    if (reply.ok) {
      if (closesQuestion) setAsking((held) => (held !== null && held.id === proposal.id ? null : held));
      // The face draws only the server's answer, so the changed row is read at once rather than waiting for the
      // dispatcher's next frame; the read coalesces with that frame.
      onRetry();
    } else {
      setRefusal({ id: proposal.id, sentence: reply.sentence ?? t('kanban.notAnswered') });
      // A refusal usually means the proposal changed elsewhere (another tab, a shell, a hunter), so the face reads it again rather than keep offering presses on a row that has ended.
      onRetry();
    }
  };

  const changePriority = (proposal: BugProposal, priority: KanbanPriority) => {
    void answer(proposal, () => api.kanban.setProposalPriority(proposal.id, priority), false);
  };
  const promote = (proposal: BugProposal, epic: string) => {
    void answer(proposal, () => api.kanban.promoteProposal(proposal.id, epic), true);
  };
  const sendBack = (proposal: BugProposal) => {
    void answer(proposal, () => api.kanban.sendBackProposal(proposal.id), true);
  };
  const dismiss = (proposal: BugProposal, reason: string) => {
    void answer(proposal, () => api.kanban.dismissProposal(proposal.id, reason), true);
  };

  const proposals = reading.status === 'ready' ? reading.proposals : [];
  const asked = asking === null ? undefined : proposals.find((proposal) => proposal.id === asking.id && proposal.state === 'open');
  const askedBusy = asked !== undefined && busy === asked.id;
  const askedRefusal = asked !== undefined && refusal !== null && refusal.id === asked.id ? refusal.sentence : null;
  const closeQuestion = () => {
    setAsking(null);
    setRefusal(null);
  };
  // A question starts with nothing said: a refusal belongs to the act that drew it, never to the next question on that row.
  const openQuestion = (id: number, act: Asking['act']) => {
    setRefusal(null);
    setAsking({ id, act });
  };

  const body = () => {
    if (reading.status === 'loading') {
      return (
        <div className="flex justify-center py-16">
          <Spinner label={t('kanban.proposed.loading')} />
        </div>
      );
    }

    if (reading.status === 'unreachable') {
      return (
        <EmptyState
          icon={CloudOff}
          title={t('kanban.proposed.unreachable.title')}
          message={t('kanban.proposed.unreachable.message')}
          actionLabel={t('kanban.proposed.unreachable.retry')}
          onAction={onRetry}
        />
      );
    }

    if (proposals.length === 0) {
      return (
        <EmptyState
          icon={Lightbulb}
          title={view.state === 'open' ? t('kanban.proposed.empty.openTitle') : t('kanban.proposed.empty.allTitle')}
          message={t('kanban.proposed.empty.message')}
        />
      );
    }

    const waiting = proposals.filter((proposal) => proposal.state === 'open').length;
    return (
      <>
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold text-foreground" data-proposed-waiting={waiting}>
            {waiting === 0 ? t('kanban.proposed.waitingNone') : t('kanban.proposed.waiting', { count: waiting })}
          </h3>
          <p className="max-w-prose text-sm text-muted-foreground">{t('kanban.proposed.about')}</p>
        </div>
        <ul className="flex flex-col divide-y divide-border border-y border-border" aria-label={t('kanban.proposed.listLabel')}>
          {proposals.map((proposal) => (
            <ProposalRow
              key={proposal.id}
              proposal={proposal}
              busy={busy === proposal.id}
              // A refusal is said where its question is: on the row only while no question is open over it.
              refusal={refusal !== null && refusal.id === proposal.id && asked?.id !== proposal.id ? refusal.sentence : null}
              onPriority={(priority) => changePriority(proposal, priority)}
              onPromote={() => openQuestion(proposal.id, 'promote')}
              onSendBack={() => openQuestion(proposal.id, 'send-back')}
              onDismiss={() => openQuestion(proposal.id, 'dismiss')}
              onOpenCard={onOpenCard}
            />
          ))}
        </ul>
      </>
    );
  };

  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto"
      data-proposed-features={reading.status}
      aria-busy={reading.status === 'loading' || (reading.status === 'ready' && reading.stale)}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 lg:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl
            label={t('kanban.proposed.scope.label')}
            options={[
              { value: 'board', label: t('kanban.proposed.scope.board') },
              { value: 'all', label: t('kanban.proposed.scope.all') },
            ]}
            value={view.scope}
            onChange={(scope) => onView({ ...view, scope })}
          />
          <SegmentedControl
            label={t('kanban.proposed.state.label')}
            options={[
              { value: 'open', label: t('kanban.proposed.state.open') },
              { value: 'all', label: t('kanban.proposed.state.all') },
            ]}
            value={view.state}
            onChange={(state) => onView({ ...view, state })}
          />
        </div>

        {body()}
      </div>

      {asked !== undefined && asking?.act === 'promote' && (
        <ProposalPromoteDialog proposal={asked} busy={askedBusy} refusal={askedRefusal} onPromote={(epic) => promote(asked, epic)} onClose={closeQuestion} />
      )}
      {asked !== undefined && asking?.act === 'dismiss' && (
        <ProposalDismissDialog proposal={asked} busy={askedBusy} refusal={askedRefusal} onDismiss={(reason) => dismiss(asked, reason)} onClose={closeQuestion} />
      )}
      <ConfirmDialog
        open={asked !== undefined && asking?.act === 'send-back'}
        title={t('kanban.proposed.sendBackDialog.title')}
        message={
          <span className="flex flex-col gap-3">
            <span className="break-words">
              {t('kanban.proposed.sendBackDialog.message', { title: asked?.title ?? '' })}
              {asked !== undefined && asked.stopgaps.length > 0 && <> {t('kanban.proposed.sendBackDialog.stopgaps')}</>}
            </span>
            {askedRefusal !== null && <Banner tone="warn">{askedRefusal}</Banner>}
          </span>
        }
        actions={[
          { label: t('kanban.proposed.sendBackDialog.cancel'), variant: 'ghost', disabled: askedBusy, onSelect: closeQuestion },
          { label: t('kanban.proposed.sendBackDialog.confirm'), variant: 'default', busy: askedBusy, onSelect: () => { if (asked !== undefined) sendBack(asked); } },
        ]}
        onDismiss={closeQuestion}
      />
    </div>
  );
}
