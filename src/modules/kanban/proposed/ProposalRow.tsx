import { ChevronRight } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { KanbanPriority } from '@/shared/kanban-types';
import type { BugProposal, BugProposalStopgap, Tone } from '@/shared/types';
import { Badge, Banner, Button, CardFoldBody, Collapsible, CollapsibleTrigger, FoldChevron, Select } from '@/shared/ui';
import { cn, formatRelativeTime, formatShortDate } from '@/shared/utils';

/**
 * ONE PROPOSED FEATURE: a line that says how bad, what and from whom, and opens in place to the whole of it.
 *
 * THE ROW IS THE PRESS. Folded, it answers the three things a reader sorts by: its priority as a word, its title,
 * and one quiet line (why it is not a ticket, the project, who proposed it, how long ago, how many findings). The
 * whole of that is one button, 44 px under a finger, with the kit's fold chevron at its end.
 *
 * ONLY AN OPEN HIGH WEARS AMBER. Medium and low are neutral words, and so is the priority of a proposal that has
 * ended: its urgency is spent, and its title steps back to the muted ink.
 *
 * AN ENDED ROW SAYS ITS ENDING WITHOUT BEING OPENED, under the fold's press and outside it: the feature it became
 * and where that stands on the roadmap, the card it was sent back as (a press that opens it), or the reason it was
 * dismissed. A state is a word first, on the quiet line.
 *
 * OPENED, IT READS DOWN TO THE DECISION: the words, the folder, each finding with the file or table it names, the
 * stopgap tickets with their state (a press when a board holds the card), and last, for an open proposal, the
 * priority and the three presses. The decision stands at the foot because it is made after the reading. A refusal
 * of the dispatcher's is said directly above the presses, in its own sentence.
 *
 * A FOLDED BODY IS OUT OF THE TAB ORDER (`CardFoldBody`): its presses cannot be reached while they cannot be seen.
 */

type ProposalRowProps = {
  proposal: BugProposal;
  /** An act on this proposal is out: its presses wait. */
  busy: boolean;
  /** The dispatcher's sentence for the act it refused on this proposal, or `null`. */
  refusal: string | null;
  onPriority: (priority: KanbanPriority) => void;
  /** Opens the promote dialog. */
  onPromote: () => void;
  /** Opens the send-back question. */
  onSendBack: () => void;
  /** Opens the dismiss dialog. */
  onDismiss: () => void;
  /** Opens a card on its board. */
  onOpenCard: (cardId: string, boardId: string) => void;
};

/** The three priorities, highest first, as the `Select` lists them. */
const PRIORITIES: KanbanPriority[] = ['high', 'medium', 'low'];

/** One fact of a row's quiet line: 8 px of gap, a 1 px rule and 8 px more before its words, 17 px that the line's own pull hides at the start of each line. */
const FACT = 'ml-2 flex items-center border-l border-border pl-2 leading-4';

/** The tone of each ended state's word. */
const STATE_TONES: Record<Exclude<BugProposal['state'], 'open'>, Tone> = { promoted: 'positive', 'sent-back': 'info', dismissed: 'neutral' };

/** The tone of each ticket state's word; a word not listed is neutral and said as the ticket wrote it. */
const TICKET_TONES: Record<string, Tone> = { filed: 'neutral', placed: 'info', unplaced: 'warn', fixed: 'positive', cleared: 'neutral', closed: 'neutral' };

/** Rendered by ProposedFeatures, once per proposal. Nothing else mounts it. */
export function ProposalRow({ proposal, busy, refusal, onPriority, onPromote, onSendBack, onDismiss, onOpenCard }: ProposalRowProps) {
  const { t } = useTranslation();
  const bodyId = useId();
  const findingsId = useId();
  const stopgapsId = useId();
  const decideId = useId();
  // Whether this row is opened in place. Its own, so a newer answer that redraws the list leaves an open row open.
  const [open, setOpen] = useState(false);

  const isOpen = proposal.state === 'open';
  const proposer =
    proposal.source === 'hunter' && proposal.hunt !== null
      ? t(`kanban.dashboard.hunters.name.${proposal.hunt}`, { defaultValue: t('kanban.proposed.proposer.hunter') })
      : t(`kanban.proposed.proposer.${proposal.source}`, { defaultValue: proposal.source });

  /** A stopgap ticket: a press that opens its card when a board holds it, else its title and where it stands. */
  const stopgap = (ticket: BugProposalStopgap) => {
    const state = (
      <Badge as="span" tone={TICKET_TONES[ticket.state] ?? 'neutral'} className="vv-badge--compact shrink-0">
        {t(`kanban.proposed.ticketState.${ticket.state}`, { defaultValue: ticket.state })}
      </Badge>
    );
    if (ticket.board === null || ticket.card === null) {
      return (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm text-foreground">
          <span className="min-w-0 flex-1 break-words leading-snug">{ticket.title}</span>
          {state}
        </div>
      );
    }
    const { board, card } = ticket;
    return (
      <Button
        variant="outline"
        className="h-auto min-h-9 w-full flex-wrap justify-start gap-2 whitespace-normal px-3 py-2 text-left font-normal finger:min-h-11"
        data-proposal-card={card}
        onClick={() => onOpenCard(card, board)}
      >
        <span className="min-w-0 flex-1 break-words text-sm leading-snug text-foreground">{ticket.title}</span>
        {state}
        <ChevronRight className="shrink-0 text-muted-foreground" aria-hidden="true" />
      </Button>
    );
  };

  /** What became of an ended proposal, said under its line without opening it. */
  const ending = () => {
    if (proposal.state === 'promoted') {
      return (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground">
          <span className="min-w-0 break-words">
            {proposal.feature === null ? t('kanban.proposed.ending.promotedGone') : t('kanban.proposed.ending.promoted', { title: proposal.feature.title })}
          </span>
          {proposal.feature !== null && (
            <Badge as="span" tone="info" className="vv-badge--compact">
              {t(`kanban.proposed.ending.featureState.${proposal.feature.state}`, { defaultValue: proposal.feature.state })}
            </Badge>
          )}
        </p>
      );
    }
    if (proposal.state === 'sent-back') {
      const sentBack = proposal.sent_back;
      if (sentBack === null || sentBack.board === null || sentBack.card === null) {
        return <p className="text-sm text-muted-foreground">{t('kanban.proposed.ending.sentBackWaiting')}</p>;
      }
      const { board, card } = sentBack;
      return (
        <Button
          variant="outline"
          className="h-auto min-h-9 justify-start gap-2 self-start whitespace-normal px-3 py-2 text-left font-normal finger:min-h-11 finger:w-full"
          data-proposal-card={card}
          onClick={() => onOpenCard(card, board)}
        >
          <span className="min-w-0 flex-1 text-sm text-foreground">{t('kanban.proposed.ending.sentBackCard')}</span>
          <ChevronRight className="shrink-0 text-muted-foreground" aria-hidden="true" />
        </Button>
      );
    }
    return (
      <p className="break-words text-sm text-foreground">
        {proposal.reason ? t('kanban.proposed.ending.dismissed', { reason: proposal.reason }) : t('kanban.proposed.ending.dismissedNoReason')}
      </p>
    );
  };

  return (
    <li data-proposal={proposal.id} data-proposal-state={proposal.state}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          aria-controls={bodyId}
          className="flex w-full items-start gap-3 rounded-md py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring finger:min-h-11"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:gap-3">
            {/* A column of its own at a desk, so every title starts on one edge whatever the priority's word. */}
            <span className="flex items-start sm:w-20 sm:shrink-0 sm:pt-px">
              <Badge as="span" tone={isOpen && proposal.priority === 'high' ? 'warn' : 'neutral'} className="vv-badge--compact" data-proposal-priority={proposal.priority}>
                {t(`kanban.priority.${proposal.priority}`)}
              </Badge>
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className={cn('break-words text-sm font-medium leading-snug', isOpen ? 'text-foreground' : 'text-muted-foreground')}>{proposal.title}</span>
              {/* Each fact is ruled off from the one before it. The rule is the fact's own left edge, and the line is pulled left
                  by that edge and its gap (17 px) under a clip, so every line starts on the title's edge with no rule and no orphaned dot. */}
              <span className="overflow-hidden text-xs text-muted-foreground">
                <span className="-ml-[17px] flex flex-wrap items-center gap-y-1">
                  {proposal.state !== 'open' && (
                    <span className={FACT}>
                      <Badge as="span" tone={STATE_TONES[proposal.state]} className="vv-badge--compact">
                        {t(`kanban.proposed.stateWord.${proposal.state}`)}
                      </Badge>
                    </span>
                  )}
                  <span className={FACT}>{t(`kanban.proposed.kind.${proposal.kind}`)}</span>
                  <span className={FACT}>{proposal.boardName}</span>
                  <span className={FACT}>{proposer}</span>
                  <span className={FACT}>{t('kanban.proposed.proposedAge', { age: formatRelativeTime(proposal.proposed_at) })}</span>
                  <span className={FACT}>{t('kanban.proposed.findings', { count: proposal.findings.length })}</span>
                </span>
              </span>
            </span>
          </span>
          <FoldChevron collapsed={!open} className="mt-0.5 text-muted-foreground" />
        </CollapsibleTrigger>

        {!isOpen && <div className="flex flex-col pb-3 sm:pl-[5.75rem]" data-proposal-ending>{ending()}</div>}

        <CardFoldBody>
          <div id={bodyId} className="flex flex-col gap-5 pb-5 pt-1 sm:pl-[5.75rem]" data-proposal-body>
            <p className="max-w-prose whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{proposal.words}</p>
            <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
              <span>{t('kanban.proposed.folder')}</span>
              <span className="break-all font-mono">{proposal.path}</span>
            </p>

            <div className="flex flex-col gap-3" role="group" aria-labelledby={findingsId}>
              <h4 id={findingsId} className="text-sm font-semibold text-foreground">{t('kanban.proposed.findingsTitle')}</h4>
              {proposal.findings.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('kanban.proposed.noFindings')}</p>
              ) : (
                <ul className="flex flex-col gap-4">
                  {proposal.findings.map((finding, index) => (
                    <li key={`${finding.found_at}/${index}`} className="flex flex-col gap-1 border-l-2 border-border pl-3">
                      {finding.unit === null
                        ? <span className="text-xs text-muted-foreground">{t('kanban.proposed.noUnit')}</span>
                        : <span className="break-all font-mono text-xs text-foreground">{finding.unit}</span>}
                      <span className="max-w-prose break-words text-sm leading-relaxed text-foreground">{finding.words}</span>
                      <span className="text-xs text-muted-foreground">{t('kanban.proposed.found', { date: formatShortDate(finding.found_at) ?? '—' })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {proposal.stopgaps.length > 0 && (
              <div className="flex flex-col gap-3" role="group" aria-labelledby={stopgapsId} data-proposal-stopgaps>
                <div className="flex flex-col gap-0.5">
                  <h4 id={stopgapsId} className="text-sm font-semibold text-foreground">{t('kanban.proposed.stopgapsTitle')}</h4>
                  <p className="text-xs text-muted-foreground">{t('kanban.proposed.stopgapsAbout')}</p>
                </div>
                <ul className="flex flex-col gap-2">
                  {proposal.stopgaps.map((ticket) => <li key={ticket.ticket}>{stopgap(ticket)}</li>)}
                </ul>
              </div>
            )}

            {isOpen && (
              <div className="flex flex-col gap-3 border-t border-border pt-4" role="group" aria-labelledby={decideId} data-proposal-decide>
                <h4 id={decideId} className="text-sm font-semibold text-foreground">{t('kanban.proposed.decide')}</h4>
                {refusal !== null && <Banner tone="warn">{refusal}</Banner>}
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                  <div className="flex flex-col gap-1.5 sm:w-36">
                    <span className="text-xs text-muted-foreground" aria-hidden="true">{t('kanban.proposed.priorityLabel')}</span>
                    <Select
                      size="sm"
                      ariaLabel={t('kanban.proposed.priorityLabel')}
                      options={PRIORITIES.map((priority) => ({ value: priority, label: t(`kanban.priority.${priority}`) }))}
                      value={proposal.priority}
                      disabled={busy}
                      onChange={(next) => {
                        const priority = PRIORITIES.find((candidate) => candidate === next);
                        if (priority !== undefined && priority !== proposal.priority) onPriority(priority);
                      }}
                    />
                  </div>
                  <Button size="sm" className="finger:h-11" busy={busy} onClick={onPromote} data-proposal-press="promote">{t('kanban.proposed.promote')}</Button>
                  <Button variant="outline" size="sm" className="finger:h-11" busy={busy} onClick={onSendBack} data-proposal-press="send-back">{t('kanban.proposed.sendBack')}</Button>
                  <Button variant="ghost" size="sm" className="finger:h-11" busy={busy} onClick={onDismiss} data-proposal-press="dismiss">{t('kanban.proposed.dismiss')}</Button>
                </div>
              </div>
            )}
          </div>
        </CardFoldBody>
      </Collapsible>
    </li>
  );
}
