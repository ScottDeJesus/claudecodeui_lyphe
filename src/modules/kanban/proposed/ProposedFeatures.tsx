import { CloudOff } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ProposalDismissDialog } from '@/modules/kanban/proposed/ProposalDismissDialog';
import { ProposalOpening } from '@/modules/kanban/proposed/ProposalOpening';
import { ProposalPromoteDialog } from '@/modules/kanban/proposed/ProposalPromoteDialog';
import { readDispatcherAnswer } from '@/modules/kanban/utils/dispatcherAnswer';
import { api } from '@/shared/api';
import type { KanbanPriority } from '@/shared/kanban-types';
import type { AstrolabePoint, BugProposal, ProposalsReading, ProposalsView } from '@/shared/types';
import { Banner, ConfirmDialog, EmptyState, Opening, SegmentedControl, Spinner } from '@/shared/ui';

/**
 * THE BUGS VIEW'S PROPOSED FEATURES FACE: the work that is too big for a ticket, or that says the design itself is wrong, each
 * waiting for one of three answers: promote it to the roadmap, send it back as a ticket, dismiss it.
 *
 * THE PROPOSALS ARE THE INSTRUMENT'S SECOND SET. The board's core stays in the middle and the slots on the hoop round it are the
 * proposals (`utils/proposalHoop`, drawn by the panel): Open first, every square the accent and breathing, because each is owed your
 * word; then what has ended, when all are asked for. A press on the slot at the front opens that proposal, hung from it
 * (`ProposalOpening`, in the kit's Opening), read down to your call.
 *
 * TWO CONTROLS, AND THEY STAY PUT. Which boards (this one, or all) and which proposals (the open ones, or all) stand at the head
 * of the face in every state, a spinner and a failure included. What they are set to is the panel's, so it survives a visit to
 * another face and a board switch.
 *
 * THE SERVER'S ORDER IS KEPT in each run: high priority first, then the oldest. This face sorts nothing, so a priority changed
 * here moves its slot only when the answer that follows says so.
 *
 * THREE STATES. Still reading: the ring, under the controls. The route did not answer: one sentence and Try again. Else the
 * instrument, whose hoop is bare while nothing is proposed.
 *
 * ONE QUESTION AT A TIME. A row of the open proposal's Choice asks its own question next, over the face: the epic to promote under,
 * a yes or no to send it back, the reason to dismiss it. They are drawn inside the Opening, so answering one never closes it. A
 * refusal of the dispatcher's is said inside the question it answers, and for a priority, which asks none, in the Opening.
 *
 * IT COMPOSES, IT DOES NOT BUILD: the reading is the panel's (`useProposals`), and so are the instrument and where a slot stands;
 * the Opening's contents and each question are a file of their own, and every piece is the kit's.
 */

type ProposedFeaturesProps = {
  /** Which boards and which proposals, kept by the panel. */
  view: ProposalsView;
  onView: (view: ProposalsView) => void;
  /** The proposals as the panel's one read holds them. */
  reading: ProposalsReading;
  /** Ask again: the press of the state that says the proposals could not be read. */
  onRetry: () => void;
  /** Opens a card on its board: the Board face, that board, that card's Opening. */
  onOpenCard: (cardId: string, boardId: string) => void;
  /** The instrument at home, turned to the proposals: the panel's, sized to the room under the controls. */
  home: ReactNode;
  /** The open proposal, by id, or null; the panel holds it, so the instrument and the Opening can never disagree. */
  openId: number | null;
  onOpen: (id: number | null) => void;
  /** Where the open proposal's slot stands now, for its Opening to hang from. */
  anchor: () => AstrolabePoint | null;
  /** The instrument's box: the Opening stands clear of it where the room allows. */
  avoid: () => { left: number; right: number } | null;
};

/** The question asked over the open proposal: which of the three answers is being given. */
type Asking = { id: number; act: 'promote' | 'send-back' | 'dismiss' };

/** Rendered by KanbanPanel while its face is the proposed features. Nothing else mounts it. */
export function ProposedFeatures({ view, onView, reading, onRetry, onOpenCard, home, openId, onOpen, anchor, avoid }: ProposedFeaturesProps) {
  const { t } = useTranslation();
  // The question open over the Opening, by the proposal's id: the proposal itself is read from the newest answer, so a proposal
  // that has ended elsewhere closes its question instead of asking about one that is gone.
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
      // The face draws only the server's answer, so the changed proposal is read at once rather than waiting for the dispatcher's
      // next frame; the read coalesces with that frame.
      onRetry();
    } else {
      setRefusal({ id: proposal.id, sentence: reply.sentence ?? t('kanban.notAnswered') });
      // A refusal usually means the proposal changed elsewhere (another tab, a shell, a hunter), so the face reads it again rather
      // than keep offering presses on one that has ended.
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
  const opened = openId === null ? undefined : proposals.find((proposal) => proposal.id === openId);
  const asked = asking === null || opened === undefined || asking.id !== opened.id || opened.state !== 'open' ? undefined : opened;
  const askedBusy = asked !== undefined && busy === asked.id;
  const askedRefusal = asked !== undefined && refusal !== null && refusal.id === asked.id ? refusal.sentence : null;
  const closeQuestion = () => {
    setAsking(null);
    setRefusal(null);
  };
  // A question starts with nothing said: a refusal belongs to the act that drew it, never to the next question on that proposal.
  const openQuestion = (id: number, act: Asking['act']) => {
    setRefusal(null);
    setAsking({ id, act });
  };

  const body = () => {
    if (reading.status === 'loading') {
      return <Spinner label={t('kanban.proposed.loading')} />;
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
    return home;
  };

  const status = opened === undefined ? undefined
    : opened.state === 'open'
      ? { word: t(`kanban.priority.${opened.priority}`), tone: opened.priority === 'high' ? 'warn' as const : 'neutral' as const }
      : { word: t(`kanban.proposed.stateWord.${opened.state}`), tone: opened.state === 'promoted' ? 'positive' as const : opened.state === 'sent-back' ? 'info' as const : 'neutral' as const };

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-proposed-features={reading.status}
      aria-busy={reading.status === 'loading' || (reading.status === 'ready' && reading.stale)}
    >
      <div className="flex flex-none flex-wrap items-center justify-between gap-3 px-4 pt-2 lg:px-6">
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

      {/* The room under the controls: the instrument at home stands its hoop as wide as it allows. */}
      <div className="flex min-h-0 flex-1 items-center justify-center p-2">{body()}</div>

      {/* The open proposal, hung from its slot. Its questions are drawn inside it, so a press in one never reads as a press outside. */}
      <Opening
        open={opened !== undefined}
        anchor={anchor}
        avoid={avoid}
        onClose={() => {
          closeQuestion();
          onOpen(null);
        }}
        backLabel={t('kanban.drawer.close')}
        source={opened === undefined ? '' : [opened.state === 'open' ? t('kanban.proposed.state.open') : null, t(`kanban.proposed.kind.${opened.kind}`)].filter(Boolean).join(' · ')}
        title={opened?.title}
        status={status}
        width={360}
        marks={{ 'data-proposal': opened === undefined ? '' : String(opened.id), 'data-proposal-state': opened?.state ?? '' }}
      >
        {opened !== undefined && (
          <ProposalOpening
            proposal={opened}
            busy={busy === opened.id}
            // A refusal is said where its question is: in the Opening only while no question is open over it.
            refusal={refusal !== null && refusal.id === opened.id && asked === undefined ? refusal.sentence : null}
            onPriority={(priority) => changePriority(opened, priority)}
            onPromote={() => openQuestion(opened.id, 'promote')}
            onSendBack={() => openQuestion(opened.id, 'send-back')}
            onDismiss={() => openQuestion(opened.id, 'dismiss')}
            onOpenCard={onOpenCard}
          />
        )}

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
      </Opening>
    </div>
  );
}
