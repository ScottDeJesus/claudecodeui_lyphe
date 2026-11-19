import { type DragEvent, type KeyboardEvent, type MouseEvent, useId } from 'react';
import { MoreHorizontal } from 'lucide-react';

import type { Tone } from '@/shared/types';
import { cn } from '@/shared/utils';
import { ActionMenu, type ActionMenuItem } from '@/shared/ui/ActionMenu';
import { Badge } from '@/shared/ui/Badge';
import { KANBAN_CARD_LINK_ATTRIBUTE, KanbanCardLinks, type KanbanCardLink } from '@/shared/ui/KanbanCardLinks';
import { Meter } from '@/shared/ui/Meter';
import { Tooltip } from '@/shared/ui/Tooltip';

/**
 * One card on a board lane: a title, how urgent it is, its tags, and — only when the board that
 * owns it asked for them — the signals that say whether it needs a person, one sentence about
 * where it stands, and the cards it is tied to.
 *
 * KIT, not a board. It knows no statuses, no lane names and no policy: which lane a card sits
 * in, whether that lane is muted and what the menu offers all arrive as props. Paint is
 * `verve/board.css` on top of `.vv-card`'s ground; the one exception is the priority ladder,
 * an INK ladder spelling its steps as the `text-*` names tailwind.config.js maps onto the same
 * tokens — the shape already shipped at the task board and argued there.
 */

/**
 * The data type that marks a drag as a CARD, set beside the `text/plain` id.
 *
 * `text/plain` on its own cannot tell a card from anything else a reader can drag into the page:
 * a text selection carried in from another window arrives carrying exactly that type, set to the
 * selected words, and a lane that trusted the id out of it would hand the board a sentence as a
 * card id and attempt a write for a card that does not exist. The card sets this type and the
 * lane requires it, so a drop either is a card or is nothing. `text/plain` is still set, so a
 * card dragged into any other drop target still arrives as readable text.
 */
export const KANBAN_CARD_DRAG_TYPE = 'application/x-kanban-card';

export type CardPriority = 'low' | 'medium' | 'high';

export type KanbanCardSignals = {
  openQuestions?: number;
  openIssues?: number;
  checklist?: { done: number; total: number };
  /** Preformatted spend ("128k"). The card never does token math. */
  tokens?: string;
};

export type KanbanCardModel = {
  id: string; title: string; priority: CardPriority; tags: string[];
  /** Absent = autonomy OFF: the face is title + priority + tags and nothing else. */
  signals?: KanbanCardSignals;
  /** One sentence about where the card stands, printed whole on the face in calm ink: why it is
   *  being held, in the board's words. Never a tooltip: a finger has no hover. */
  note?: string;
  /** The cards this one is tied to. Each is a word, that card's title, and a press that opens it. */
  links?: KanbanCardLink[];
};

type KanbanCardProps = {
  card: KanbanCardModel;
  selected?: boolean;            // the drawer is open on this card
  dragging?: boolean;            // lifted, by pointer or keyboard
  muted?: boolean;               // the PANEL's decision, passed down through the lane
  dropEdge?: 'top' | 'bottom';   // the insertion line; owned by the lane
  tabStop?: boolean;             // roving tab stop — exactly one card per lane
  onOpen: (id: string) => void;
  onMove: (id: string, dx: -1 | 0 | 1, dy: -1 | 0 | 1) => void;
  menuItems: ActionMenuItem[];
};

/** The fixed vocabulary of a face, in one block so a later i18n pass lifts it in one move.
 *  Everything that VARIES per board — title, tags, menu labels — is a prop; these are the
 *  library's own words for states it detects itself, and the kit cannot reach `t()`. */
const WORDS = {
  high: 'High',
  low: 'Low',
  tokensHint: 'Build tokens',
  checklist: 'Checklist',
  moreTags: (n: number) => `+${n}`,
  issues: (n: number) => `${n} issue${n === 1 ? '' : 's'}`,
  questions: (n: number) => `${n} question${n === 1 ? '' : 's'}`,
  cardActions: (title: string) => `Actions for ${title}`,
};

/** Tags on the face before the rest fold into a `+n`, then the two halves of the tone budget: at
 *  most two toned elements at rest, of which at most one may be warn or danger. */
const TAGS_ON_FACE = 3;
const TONE_BUDGET = 2;
const HEAVY_BUDGET = 1;
const HEAVY_TONES: Tone[] = ['warn', 'danger'];

/** The three things that can ask for colour. Each key is spelled as the `KanbanCardSignals` field
 *  it reads, so the two never drift apart. */
type SignalKey = 'openIssues' | 'priority' | 'openQuestions';

/** `glyph` is kept apart from `label`: the glyph is hidden from a screen reader, the word is read. */
type FaceSignal = { key: SignalKey; tone: Tone; glyph: string; label: string };

/**
 * Colour is a budget, not a property of a state. Every candidate keeps its glyph and its count
 * either way; the walk decides only which get to be LOUD. Two toned is the ceiling because a
 * third makes the fourth invisible, one warn-or-danger because two alarms are no alarm. A
 * candidate skipped for the heavy cap does not stop the walk — a lighter one below still takes
 * the second slot, which keeps an issue-and-questions card legible.
 */
function grantTones(candidates: FaceSignal[]): Set<SignalKey> {
  const granted = new Set<SignalKey>();
  let toned = 0;
  let heavy = 0;

  for (const candidate of candidates) {
    if (toned >= TONE_BUDGET) break;
    const isHeavy = HEAVY_TONES.includes(candidate.tone);
    if (isHeavy && heavy >= HEAVY_BUDGET) continue;
    granted.add(candidate.key);
    toned += 1;
    if (isHeavy) heavy += 1;
  }

  return granted;
}

/** The candidates raised, in the ruled precedence: issues > high priority > questions. `priority`
 *  is in the list yet renders on the row above, because the budget is over the FACE and not over
 *  one row. */
function faceSignals(card: KanbanCardModel): FaceSignal[] {
  const signals = card.signals;
  const raised: FaceSignal[] = [];
  // Autonomy OFF: no signals at all, so the ladder is the only thing that can ask for colour.
  if (!signals) {
    return card.priority === 'high' ? [{ key: 'priority', tone: 'warn', glyph: '▲', label: WORDS.high }] : raised;
  }
  if (signals.openIssues) {
    raised.push({ key: 'openIssues', tone: 'danger', glyph: '✕', label: WORDS.issues(signals.openIssues) });
  }
  if (card.priority === 'high') {
    raised.push({ key: 'priority', tone: 'warn', glyph: '▲', label: WORDS.high });
  }
  if (signals.openQuestions) {
    raised.push({ key: 'openQuestions', tone: 'info', glyph: 'i', label: WORDS.questions(signals.openQuestions) });
  }

  return raised;
}

/**
 * How urgent this card is, as ink rather than a pill — and `medium` is SILENT. Nearly every
 * card is medium; printing it turns the ladder into wallpaper. High is amber, never red: a
 * card nobody has started is neither destroyed nor refused. Below the budget's cut it keeps
 * its glyph and its word and goes quiet — the state survives, the shout does not.
 */
function priorityLine(priority: CardPriority, toned: boolean): { text: string; className: string } | null {
  if (priority === 'high') return { text: `▲ ${WORDS.high}`, className: toned ? 'text-warn-ink' : 'text-muted-foreground' };
  if (priority === 'low') return { text: `↓ ${WORDS.low}`, className: 'text-ink-faint' };
  return null;
}

/**
 * Whether a pointer or key event landed on a press INSIDE the card — its `…` control, or a link
 * to another card — rather than on the card.
 *
 * The card is a single focusable, clickable surface with presses inside it, so every event the
 * card cares about also fires there — one from the menu included, which is portalled out to
 * `<body>` and still bubbles through the card in the React tree. The check matches the attributes
 * those nodes carry, the trigger's `aria-haspopup="menu"`, the menu's own `role="menu"` and the
 * link's own marker: a check against a class name would break the moment the paint file renamed
 * one, and a check against the card's children would swallow the title.
 */
function fromInnerPress(target: EventTarget | null): boolean {
  return target instanceof Element
    && target.closest(`[aria-haspopup="menu"], [role="menu"], [${KANBAN_CARD_LINK_ATTRIBUTE}]`) !== null;
}

/** One signal, loud or quiet. Both spellings carry the glyph AND the word; a bare dot is not a signal. */
function SignalBadge({ signal, toned }: { signal: FaceSignal; toned: boolean }) {
  return toned ? (
    <Badge tone={signal.tone} className="vv-badge--compact vv-lane-card__signal">
      <span aria-hidden="true">{signal.glyph}</span>
      <span className="ml-1">{signal.label}</span>
    </Badge>
  ) : (
    <Badge variant="outline" className="vv-badge--compact vv-lane-card__signal vv-lane-card__signal--quiet">
      <span aria-hidden="true">{signal.glyph}</span>
      <span className="ml-1">{signal.label}</span>
    </Badge>
  );
}

/** Rendered by KanbanLane for one card in its list. The lane owns the gap between cards; this sets no margin. */
export function KanbanCard({
  card,
  selected = false,
  dragging = false,
  muted = false,
  dropEdge,
  tabStop = false,
  onOpen,
  onMove,
  menuItems,
}: KanbanCardProps) {
  const reactId = useId();
  const titleId = `${reactId}-title`;
  const metaId = `${reactId}-meta`;
  const signalsId = `${reactId}-signals`;
  const noteId = `${reactId}-note`;

  const signals = card.signals;
  const links = card.links ?? [];
  const raised = faceSignals(card);
  const granted = grantTones(raised);  // which of them get to be loud
  const priority = priorityLine(card.priority, granted.has('priority'));
  const badges = raised.filter((signal) => signal.key !== 'priority');
  const checklist = signals?.checklist;
  // Three badges already fill a 300px row, and a meter squeezed into what is left renders as a
  // bare ✓ with no track and no figure — a mark carrying no reading, which doctrine §6 forbids.
  // On a face already shouting three things the progress bar stands down; the drawer keeps it.
  const showChecklist = Boolean(checklist) && badges.length <= 2;
  const checklistPercent = checklist && checklist.total > 0
    ? Math.round((checklist.done / checklist.total) * 100)
    : null;

  // The tag row also holds what a hover reveals, so it stands even when it is blank at rest — except
  // on a face whose next rows are the board's own sentence or links: there a blank row is a 20 px
  // hole between the title and the one thing the card has to say.
  const showMeta = priority !== null || card.tags.length > 0 || (links.length === 0 && !card.note);
  const visibleTags = card.tags.slice(0, TAGS_ON_FACE);
  const hiddenTags = card.tags.slice(TAGS_ON_FACE);
  // A click on the `…` trigger or on a link bubbles through here too, and opening THIS card's
  // drawer behind the menu or the other card the reader just asked for is what this guard prevents.
  const handleOpen = (event: MouseEvent<HTMLLIElement>) => {
    if (fromInnerPress(event.target)) return;
    onOpen(card.id);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    if (fromInnerPress(event.target)) return;

    if (event.key === 'Enter' || event.key === ' ') {
      // Space is prevented, not merely ignored: on a focusable element it scrolls the lane, and
      // the reader would open a card and lose their place in the same keystroke.
      event.preventDefault();
      // Consumed, so that nothing this card is mounted inside acts on the same press. The kit
      // cannot see its consumers: a board is free to hang its own key handling above the lanes.
      event.stopPropagation();
      onOpen(card.id);
      return;
    }

    // A BARE arrow is the lane's key, not this card's: the lane owns focus movement because only
    // it knows how many cards it has and which lane sits next. Returning without preventing
    // anything is what leaves ArrowUp/Down, Home and End to it.
    if (!event.ctrlKey && !event.metaKey) return;

    let dx: -1 | 0 | 1 = 0;
    let dy: -1 | 0 | 1 = 0;
    if (event.key === 'ArrowLeft') dx = -1;
    else if (event.key === 'ArrowRight') dx = 1;
    else if (event.key === 'ArrowUp') dy = -1;
    else if (event.key === 'ArrowDown') dy = 1;
    else return;

    event.preventDefault();
    event.stopPropagation();
    onMove(card.id, dx, dy);
  };

  /**
   * The payload other lanes read, on two types at once: the id as `text/plain`, so the card is
   * readable text to anything else that accepts a drop, and the id again under the card's own
   * type, which is what the lane requires before it will treat the drag as a card at all.
   *
   * The card keeps no callback to its lane: the lane's own `onDragStart` reads `data-card-id`
   * off the element the drag began on, and the event bubbles there on its own.
   */
  const handleDragStart = (event: DragEvent<HTMLLIElement>) => {
    event.dataTransfer.setData('text/plain', card.id);
    event.dataTransfer.setData(KANBAN_CARD_DRAG_TYPE, card.id);
    event.dataTransfer.effectAllowed = 'move';
  };

  /**
   * Nothing to undo here. `dragend` is delivered to the element the drag STARTED on, so the card
   * has to carry the handler for the lane to hear one at all — the lane's `onDragEnd` is what
   * clears the in-flight card and the insertion edge.
   */
  const handleDragEnd = (_event: DragEvent<HTMLLIElement>) => {};

  return (
    <li
      className={cn(
        'vv-card vv-lane-card relative flex flex-col gap-1.5 p-3',
        selected && 'vv-lane-card--selected',
        dragging && 'vv-lane-card--lifted',
        muted && 'vv-lane-card--muted',
        dropEdge === 'top' && 'vv-lane-card--edge-top',
        dropEdge === 'bottom' && 'vv-lane-card--edge-bottom',
      )}
      draggable
      tabIndex={tabStop ? 0 : -1}
      aria-labelledby={titleId}
      aria-describedby={[showMeta && metaId, (badges.length > 0 || showChecklist) && signalsId, card.note && noteId].filter(Boolean).join(' ') || undefined}
      aria-roledescription="draggable card"
      aria-current={selected || undefined}
      data-card-id={card.id}
      onClick={handleOpen}
      onKeyDown={handleKeyDown}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {/* Always in the DOM so the row never reflows when it appears; board.css fades it in on
          hover, on focus-within and while the drawer is open, and pins it on a coarse pointer. */}
      <ActionMenu
        label={WORDS.cardActions(card.title)}
        ariaLabel={WORDS.cardActions(card.title)}
        items={menuItems}
        icon={MoreHorizontal}
        iconOnly
        variant="ghost"
        size="icon"
        className="vv-lane-card__reveal absolute right-1 top-1"
        triggerClassName="vv-lane-card__menu-trigger h-7 w-7"
      />

      <h4 id={titleId} className="vv-lane-card__title line-clamp-2 pr-8 text-sm font-medium leading-snug text-foreground">
        {card.title}
      </h4>

      {showMeta && (
      <div id={metaId} className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        {priority && <span className={cn('shrink-0 text-xs', priority.className)}>{priority.text}</span>}
        {visibleTags.map((tag) => (
          <Badge key={tag} variant="outline" className="vv-badge--compact vv-lane-card__tag">{tag}</Badge>
        ))}
        {hiddenTags.length > 0 && (
          <Tooltip content={hiddenTags.join(', ')}>
            <Badge variant="outline" className="vv-badge--compact vv-lane-card__tag">{WORDS.moreTags(hiddenTags.length)}</Badge>
          </Tooltip>
        )}
        <span className="vv-lane-card__reveal vv-tabular ml-auto shrink-0 text-xs text-ink-faint">{card.id}</span>
        {signals?.tokens && (
          <Tooltip content={WORDS.tokensHint}>
            <span className="vv-lane-card__reveal vv-tabular shrink-0 text-xs text-muted-foreground">{signals.tokens}</span>
          </Tooltip>
        )}
      </div>
      )}

      {(badges.length > 0 || showChecklist) && (
        <div id={signalsId} className="flex min-w-0 items-center gap-1.5 overflow-hidden">
          {badges.map((signal) => (
            <SignalBadge key={signal.key} signal={signal} toned={granted.has(signal.key)} />
          ))}
          {showChecklist && checklist && (
            <Meter
              variant="inline"
              percent={checklistPercent}
              label="✓"
              ariaLabel={WORDS.checklist}
              value={`${checklist.done}/${checklist.total}`}
            />
          )}
        </div>
      )}

      {/* Printed, whole, in the calm ink: a card that is being held says why where it sits, and a
          sentence in a tooltip is a sentence a finger never reads. */}
      {card.note && (
        <p id={noteId} className="vv-lane-card__note text-xs leading-snug text-muted-foreground">{card.note}</p>
      )}

      {links.length > 0 && <KanbanCardLinks links={links} tabStop={tabStop} onOpen={onOpen} />}
    </li>
  );
}
