import { ChevronRight } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { KanbanPriority } from '@/shared/kanban-types';
import type { BugProposal, BugProposalStopgap } from '@/shared/types';
import { KeyValueList, Rule, SegmentedControl } from '@/shared/ui';
import { formatRelativeTime, formatShortDate } from '@/shared/utils';

/**
 * ONE PROPOSED FEATURE, OPENED: what is inside the Opening hung from its slot on the instrument (`ProposedFeatures`), read down to
 * the decision.
 *
 * ITS FACTS FIRST, ON THE LABEL COLUMN: the board it was found for, who proposed it, when, and the folder. Then its words as
 * written. An ended proposal says what became of it next, without a press to find out: the feature it became and where that
 * stands on the roadmap, the card it was sent back as (a row that opens it), or the reason it was dismissed.
 *
 * THEN WHAT BACKS IT, EACH UNDER ITS RULE: the findings as the design system's Trace (the file or table each names, its words,
 * when it was found), and the stopgap tickets as rows with their state, a row that opens its card when a board holds it.
 *
 * LAST, FOR AN OPEN ONE, YOUR CALL: its priority (the kit's segmented control, written on the press), then the question every
 * proposal asks, as the design system's Choice: promote it to the roadmap, send it back as a ticket, or dismiss it. Each row asks
 * its own question next (`ProposedFeatures`'s dialogs). A refusal of the dispatcher's is said directly above it, in the warn ink.
 *
 * Empty means absent: no findings, no stopgaps, no section.
 */

type ProposalOpeningProps = {
  proposal: BugProposal;
  /** An act on this proposal is out: its presses wait. */
  busy: boolean;
  /** The dispatcher's sentence for the act it refused on this proposal, or `null`. */
  refusal: string | null;
  onPriority: (priority: KanbanPriority) => void;
  /** Opens the promote question. */
  onPromote: () => void;
  /** Opens the send-back question. */
  onSendBack: () => void;
  /** Opens the dismiss question. */
  onDismiss: () => void;
  /** Opens a card on its board. */
  onOpenCard: (cardId: string, boardId: string) => void;
};

/** The ladder, low to high, as the open bug's own priority is offered. */
const PRIORITIES: KanbanPriority[] = ['low', 'medium', 'high'];

/** Rendered by ProposedFeatures inside the open proposal's Opening. Nothing else mounts it. */
export function ProposalOpening({ proposal, busy, refusal, onPriority, onPromote, onSendBack, onDismiss, onOpenCard }: ProposalOpeningProps) {
  const { t } = useTranslation();
  const findingsId = useId();
  const stopgapsId = useId();
  const decideId = useId();

  const isOpen = proposal.state === 'open';
  const proposer =
    proposal.source === 'hunter' && proposal.hunt !== null
      ? t(`kanban.dashboard.hunters.name.${proposal.hunt}`, { defaultValue: t('kanban.proposed.proposer.hunter') })
      : t(`kanban.proposed.proposer.${proposal.source}`, { defaultValue: proposal.source });

  /** A row that opens a card on its board: the stopgap's, or the card a proposal was sent back as. */
  const cardRow = (board: string, card: string, words: string, state: string | null) => (
    <button type="button" className="bug-row" data-proposal-card={card} onClick={() => onOpenCard(card, board)}>
      <span className="min-w-0 flex-1 break-words text-[13px] leading-[18px]">{words}</span>
      {state !== null && <span className="bug-figure">{state}</span>}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );

  const stopgap = (ticket: BugProposalStopgap) => {
    const state = t(`kanban.proposed.ticketState.${ticket.state}`, { defaultValue: ticket.state });
    if (ticket.board === null || ticket.card === null) {
      return (
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <span className="min-w-0 flex-1 break-words text-[13px] leading-[18px] text-foreground">{ticket.title}</span>
          <span className="bug-figure">{state}</span>
        </div>
      );
    }
    return cardRow(ticket.board, ticket.card, ticket.title, state);
  };

  /** What became of an ended proposal, said without a press. */
  const ending = () => {
    if (proposal.state === 'promoted') {
      return (
        <p className="ast-choice-said">
          <span className="min-w-0">
            {proposal.feature === null ? t('kanban.proposed.ending.promotedGone') : t('kanban.proposed.ending.promoted', { title: proposal.feature.title })}
            {proposal.feature?.state && (
              <span className="bug-figure ml-2">{t(`kanban.proposed.ending.featureState.${proposal.feature.state}`, { defaultValue: proposal.feature.state })}</span>
            )}
          </span>
        </p>
      );
    }
    if (proposal.state === 'sent-back') {
      const sentBack = proposal.sent_back;
      if (sentBack === null || sentBack.board === null || sentBack.card === null) {
        return <p className="text-[13px] leading-[18px] text-muted-foreground">{t('kanban.proposed.ending.sentBackWaiting')}</p>;
      }
      return <div className="-mx-2">{cardRow(sentBack.board, sentBack.card, t('kanban.proposed.ending.sentBackCard'), null)}</div>;
    }
    return (
      <p className="break-words text-[13px] leading-[18px] text-foreground">
        {proposal.reason ? t('kanban.proposed.ending.dismissed', { reason: proposal.reason }) : t('kanban.proposed.ending.dismissedNoReason')}
      </p>
    );
  };

  return (
    <div className="bug-opening flex flex-col gap-5" data-proposal-body="">
      <KeyValueList
        items={[
          [t('kanban.proposed.facts.board', { defaultValue: 'Board' }), proposal.boardName],
          [t('kanban.proposed.facts.by', { defaultValue: 'By' }), proposer],
          [t('kanban.proposed.facts.when', { defaultValue: 'Proposed' }), formatRelativeTime(proposal.proposed_at)],
          [t('kanban.proposed.folder'), <span key="path" className="font-mono" title={proposal.path}>{proposal.path}</span>],
        ]}
      />

      <p className="whitespace-pre-wrap break-words text-[13px] leading-[1.6] text-foreground">{proposal.words}</p>

      {!isOpen && <div data-proposal-ending="">{ending()}</div>}

      {proposal.findings.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby={findingsId}>
          <Rule id={findingsId} end={proposal.findings.length}>{t('kanban.proposed.findingsTitle')}</Rule>
          <ol className="ast-trace">
            {proposal.findings.map((finding, index) => (
              <li key={`${finding.found_at}/${index}`} className="ast-trace-item" data-latest={index === 0 ? 'true' : 'false'}>
                <span className="ast-trace-bead" aria-hidden="true" />
                <span className="ast-trace-head">
                  <span className="break-all">{finding.unit ?? t('kanban.proposed.noUnit')}</span>
                </span>
                <p className="ast-trace-text">{finding.words}</p>
                <p className="ast-trace-quiet">{t('kanban.proposed.found', { date: formatShortDate(finding.found_at) ?? '—' })}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {proposal.stopgaps.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby={stopgapsId} data-proposal-stopgaps="">
          <Rule id={stopgapsId}>{t('kanban.proposed.stopgapsTitle')}</Rule>
          <ul className="-mx-2 flex flex-col">
            {proposal.stopgaps.map((ticket) => <li key={ticket.ticket}>{stopgap(ticket)}</li>)}
          </ul>
        </section>
      )}

      {isOpen && (
        <section className="flex flex-col gap-3" aria-labelledby={decideId} data-proposal-decide="">
          <Rule id={decideId}>{t('kanban.proposed.decide')}</Rule>
          {refusal !== null && <p className="text-[13px] leading-[18px] text-[var(--warn-ink)]" role="alert">{refusal}</p>}
          <dl className="bug-facts">
            <dt>{t('kanban.proposed.priorityLabel')}</dt>
            <dd data-priority={proposal.priority}>
              <SegmentedControl
                label={t('kanban.proposed.priorityLabel')}
                options={PRIORITIES.map((priority) => ({ value: priority, label: t(`kanban.priority.${priority}`) }))}
                value={proposal.priority}
                onChange={(next) => {
                  if (!busy && next !== proposal.priority) onPriority(next);
                }}
              />
            </dd>
          </dl>
          {/* The question every proposal asks, as the design system's Choice. Each row asks its own question next. */}
          <div className="ast-choice-list" role="group" aria-labelledby={decideId}>
            {([['promote', 'kanban.proposed.promote', onPromote], ['send-back', 'kanban.proposed.sendBack', onSendBack], ['dismiss', 'kanban.proposed.dismiss', onDismiss]] as const).map(([act, key, press]) => (
              <button key={act} type="button" className="ast-choice-opt" data-proposal-press={act} disabled={busy} aria-busy={busy} onClick={press}>
                <span className="ast-choice-opt-mark" aria-hidden="true" />
                <span className="min-w-0 flex-1">{t(key)}</span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
