import { Archive, ArrowDown, ArrowUp, CloudOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { DrawerAttachments, type DrawerAttachmentsHandle } from '@/modules/kanban/card-drawer/DrawerAttachments';
import { DrawerBody, DrawerTitle } from '@/modules/kanban/card-drawer/DrawerBody';
import { DrawerChecklist } from '@/modules/kanban/card-drawer/DrawerChecklist';
import { DrawerIssuesAndTokens } from '@/modules/kanban/card-drawer/DrawerIssuesAndTokens';
import { DrawerLinks } from '@/modules/kanban/card-drawer/DrawerLinks';
import { DrawerQuestions } from '@/modules/kanban/card-drawer/DrawerQuestions';
import { DrawerScenarios } from '@/modules/kanban/card-drawer/DrawerScenarios';
import { useDrawerReading } from '@/modules/kanban/card-drawer/useDrawerReading';
import type { KanbanMutations } from '@/modules/kanban/hooks/useKanbanMutations';
import { kindWordKey, walkNoteOf, type KanbanLinkedTitle, type KanbanWalk } from '@/modules/kanban/utils/walkModel';
import { SubagentTranscriptView } from '@/modules/chat';
import type { KanbanLaneSpec } from '@/modules/kanban/utils/lanePolicy';
import type { KanbanBoardEvent, KanbanCardDetail } from '@/shared/kanban-types';
import { api, readApiJson } from '@/shared/api';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { AstrolabePoint, AstrolabeTrackStep } from '@/shared/types';
import { Button, EmptyState, Opening, Track } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * THE OPEN CARD: an Opening hung from the card's slot on the board's hoop (the kit's `Opening`), and the only thing on this
 * screen that ever reads a card's DETAIL.
 *
 * IT IS A SHELL AND NOTHING ELSE. No field lives in this file. It owns the frame, its head (where the card stands and what it is,
 * as a caption, and its state as a word), the card's course through the lanes, the states a card can be in before it is readable,
 * and the ONE decision the sections below it cannot make for themselves: which of them the board's autonomy setting lets the
 * reader see at all. `DrawerTitle` and `DrawerBody` are the card every board has — a title, what it is for, its tags and how
 * urgent it is — `DrawerLinks` is the cards it is tied to, and `DrawerAttachments` is what a person or a walk pinned to it (a
 * walk's screenshots are attachments like any other), on every board for the same reason. The other four are the autonomous
 * run's own ledger, and with autonomy off they are not hidden detail, they are not this board's vocabulary.
 *
 * ITS COURSE IS A TRACK (the kit's): the board's lanes in their order, lit to the lane the card is in, that lane named; a press on
 * another lane moves the card there (`onMove`), which is what the card menu's Move rows and a drag between lanes did on the old
 * board. Archive stands at its foot.
 *
 * A SITTING'S TRANSCRIPT IS READ IN THIS OPENING, IN PLACE OF THE CARD. A step offers the transcript of the soul that did it;
 * pressing it swaps the card's sections for `SubagentTranscriptView`, whose own Back swaps them in again (and so does the
 * Opening's back arrow, and Escape). The sections stay MOUNTED underneath, hidden, so a half-typed title or answer is still there
 * on the way back.
 *
 * A FILE DROPPED ANYWHERE ON IT IS ATTACHED. The whole open card is the place to drop on (its plate takes the accent's edge while
 * a file is held over it); the drop goes to the attachments section, which uploads it as a pick would.
 *
 * IT IS THE ONLY FETCHER. One read when the card opens, handed down whole; a section that fetched the slice it needed would cost
 * six requests per open and let the checklist disagree with the count on the card's face. The same read answers a write made
 * anywhere inside it — one path in, one path back.
 *
 * Rendered by the panel (`KanbanPanel`) inside the board's scene, which the Opening covers and measures its room in.
 */

type KanbanCardDrawerProps = {
  /** The open card, or `null` for a closed drawer. The panel holds it, so the board and the
   *  drawer can never disagree about which card is open. */
  cardId: string | null;
  /** The board's own setting. It decides which SECTIONS render, and gates no write: every verb
   *  behind them stays reachable on the server with autonomy off. */
  autonomy: boolean;
  /** The board's write verbs, handed to the five sections below. This shell owns the READ; the
   *  panel owns the writes, because a second `useKanbanMutations` here would be a second
   *  `applyCard` and two ideas about where a card sits. */
  writes: KanbanMutations;
  /** The open card's walk, from the board's one reader, or `null` for a card the dispatcher is not
   *  walking: no sittings under the steps and no scenarios section. */
  walk: KanbanWalk | null;
  /** What the board knows of another of its cards: its title, not read yet, or gone. */
  titleOf: (cardId: string) => KanbanLinkedTitle;
  /** Opens another card in this sheet: a link's press. */
  onOpenCard: (cardId: string) => void;
  onClose: () => void;
  /** Where the card's slot stands now, for the Opening to hang from: the board's hoop answers it each frame (or its list, its row). */
  anchor: () => AstrolabePoint | null;
  /** The board's instrument on the page: where the room allows, the card stands clear of it, so the hoop stays whole. */
  avoid: () => { left: number; right: number } | null;
  /** The side the card opens on: the right of its row while the board is a list; absent, whichever side of its slot has room. */
  side?: 'right';
  /** The board's lanes in their order: the card's course. */
  lanes: KanbanLaneSpec[];
  /** The lane the open card is in, by id, or null while the board does not hold it. */
  laneId: string | null;
  /** What the open card is doing, as a word and its tone, for the head; null for nothing worth a word. */
  status: { word: string; tone: 'info' | 'positive' | 'warn' | 'danger' | 'neutral' } | null;
  /** Moves the open card into another lane, at its end. */
  onMove: (laneId: string) => void;
  /** Moves the open card one place earlier (-1) or later (1) in its own lane: the order the board takes its cards in. */
  onShift: (step: -1 | 1) => void;
  /** Archives the open card: it leaves the board, and nothing is deleted. */
  onArchive: () => void;
  /** The card was just made here: its title field takes the focus once the card is read, its placeholder name selected. */
  fresh: boolean;
};

/** The one read this screen makes, and the two states it can be in before it lands. */
type DrawerRead = {
  detail: KanbanCardDetail | null;
  loading: boolean;
  /** The server's own sentence when the card could not be read. */
  error: string | null;
};

/** Rendered by KanbanPanel, once, inside the board's scene. Nothing else mounts it. */
export function KanbanCardDrawer({ cardId, autonomy, writes, walk, titleOf, onOpenCard, onClose, anchor, avoid, side, lanes, laneId, status, onMove, onShift, onArchive, fresh }: KanbanCardDrawerProps) {
  const { t } = useTranslation();
  const { subscribe } = useWebSocket();

  const [read, setRead] = useState<DrawerRead>({ detail: null, loading: false, error: null });

  // Which sitting's transcript stands in place of the card, and the way back from it.
  const { reading, readStage, back: backToCard, clear: clearReading } = useDrawerReading();

  /**
   * WHICH CARD THE STATE ABOVE ANSWERS FOR — the card id the last clear was made for, or `null`
   * before the first one. It is held as an OBJECT because `null` is itself a card id here: the
   * closed drawer is `cardId === null` and a bare `null` in this slot could not tell "cleared for
   * the closed drawer" from "never cleared at all".
   *
   * THE CLEAR HAPPENS DURING RENDER, and that is the point of it. This state outlives a close, so
   * a `detail` left standing paints the PREVIOUS card's title and body for a frame when a second
   * card is opened — and an effect clears it one frame too late to stop that. Adjusting state
   * against a changed input is React's own answer to exactly this, and it is the only form of the
   * clear that lands in the same render the new card id arrives in.
   */
  const [readFor, setReadFor] = useState<{ id: string | null } | null>(null);

  /**
   * WHETHER THIS OPENING LEADS WITH ITS QUESTION — decided ONCE, when the card's first read lands,
   * and held until the sheet closes or another card opens. `null` is an opening not yet decided.
   *
   * It is latched because the card is read again on every frame that names it. An order re-decided
   * on each read moves the sheet under the reader at the moment they act: the answer lands and the
   * section they were in drops below the attachments; a question arrives and the field they are
   * typing in jumps two hundred pixels. A sheet keeps the shape it opened in.
   */
  const [leadsWithQuestion, setLeadsWithQuestion] = useState<boolean | null>(null);

  /**
   * THE CARD THIS DRAWER IS OPEN ON, kept here rather than read off `cardId` by the async tails:
   * a read sent for card A can land after the reader has opened card B, and the only question
   * worth asking of its answer is whether A is still the open one. `null` means closed.
   */
  const openIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * THE ONE READ. It is what the shell does on open, what the Retry press does, and what a frame
   * does — three callers and one path, so the drawer can never hold a card the server is not
   * holding.
   *
   * IT NEVER BLANKS THE SHEET, and that is deliberate twice over. A frame arrives for the card
   * already on screen, so a read that cleared before answering would unmount the five sections
   * below and take every half-typed draft with them; and a read that cleared for a DIFFERENT card
   * would be too late anyway, because the render below has already cleared for the new one.
   */
  const readCard = useCallback(async () => {
    const id = openIdRef.current;
    // Closed, or a shell on its way out: nothing to read, and nothing left to clear.
    if (!mountedRef.current || id === null) return;

    try {
      const body = await readApiJson<{ card: KanbanCardDetail }>(await api.kanban.card(id));
      // A late answer for a card nobody is looking at any more is dropped, not painted.
      if (!mountedRef.current || openIdRef.current !== id) return;
      setRead({ detail: body.card, loading: false, error: null });
    } catch (error) {
      if (!mountedRef.current || openIdRef.current !== id) return;
      const message =
        error instanceof Error && error.message ? error.message : t('kanban.drawer.unreachable.title');
      // The detail on screen is left exactly as it was: a card that could not be re-read is not
      // a card that went away, and blanking it would report a failure as a deletion.
      setRead((held) => ({ detail: held.detail, loading: false, error: message }));
    }
  }, [t]);

  // The clear, in the render the new card id arrives in. It settles after one pass: `readFor` then
  // matches `cardId` and the branch is not taken again.
  if (readFor?.id !== cardId) {
    setReadFor({ id: cardId });
    setLeadsWithQuestion(null);
    setRead({ detail: null, loading: cardId !== null, error: null });
    clearReading();
  }

  // The read that follows the OPEN, and only the open. `readCard` is stable, so this runs when the
  // id CHANGES — which is what makes the fetch open-keyed rather than render-keyed. Every later
  // read is the frame's or the Retry press's.
  useEffect(() => {
    openIdRef.current = cardId;
    if (cardId !== null) void readCard();
  }, [cardId, readCard]);

  /**
   * THE FRAME THAT SAYS THIS CARD CHANGED. Every write in this drawer — and every write made by
   * another session, or by the dispatcher as it walks the card — comes back as a `kanban_event`, and
   * the card it names is read again whole. That is why no section below needs a way to say it
   * changed: the sections are painted from this one fetch, and this one fetch is told.
   */
  useEffect(
    () =>
      subscribe((event) => {
        if (event.kind !== 'kanban_event') return;

        const frame = event as unknown as KanbanBoardEvent;
        if (!frame || frame.event?.cardId !== openIdRef.current) return;
        void readCard();
      }),
    [subscribe, readCard]
  );

  const detail = read.detail;
  const kind = detail === null ? null : kindWordKey(detail.tags, walk);

  // A card just made is named first: once it is read, its title field (the first field of its sections) takes the focus with the
  // placeholder name selected, so typing replaces it. Once per card.
  const sectionsRef = useRef<HTMLDivElement>(null);
  const namedRef = useRef<string | null>(null);
  const attachmentsRef = useRef<DrawerAttachmentsHandle>(null);
  // A file held over the open card: the plate shows where it will land.
  const [dropping, setDropping] = useState(false);
  const holdsFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');
  useEffect(() => {
    if (!fresh || detail === null || namedRef.current === detail.id) return undefined;
    namedRef.current = detail.id;
    const timer = window.setTimeout(() => {
      const field = sectionsRef.current?.querySelector<HTMLInputElement>('input');
      field?.focus({ preventScroll: true });
      field?.select();
    }, 60);
    return () => window.clearTimeout(timer);
  }, [fresh, detail]);

  // A card that waits on an answer opens with its question right under its name. It is the one thing
  // the card was opened to get done, and under a priority, tags, a body and attachments it starts
  // below the fold of a phone.
  // The latch, set in the render the first read arrives in — the same adjust-on-change the clear
  // above is, and for the same reason: an effect would paint one frame in the other order first.
  if (detail !== null && leadsWithQuestion === null) {
    setLeadsWithQuestion(autonomy && detail.questions.some((question) => !question.answered));
  }
  const asking = leadsWithQuestion === true;

  /**
   * THE SECTIONS, AS ONE FLAT KEYED LIST. `key` is the CARD, not the section: every field holds a
   * draft of what the reader is typing, and a draft seeded from one card must never survive into
   * another. A re-read of the SAME card keeps the key and so keeps the drafts — which is what stops
   * a websocket frame from deleting a half-typed sentence. Flat, so the questions can move to the
   * head of the list and back without being remounted: React moves a keyed sibling, it does not
   * rebuild it.
   *
   * The card's name comes first, always (`DrawerTitle`); then the card every board has; the
   * autonomous run's ledger after it. With autonomy off the ledger is not collapsed or dimmed — it
   * is absent, because a board that is not running itself has no questions to answer, no steps
   * being walked, no scenarios and no spend.
   */
  const sections: ReactNode[] = [];
  if (detail !== null) {
    const card = [
      <DrawerBody key={`body-${detail.id}`} detail={detail} writes={writes} />,
      <DrawerLinks key={`links-${detail.id}`} detail={detail} titleOf={titleOf} onOpenCard={onOpenCard} />,
      <DrawerAttachments key={`attachments-${detail.id}`} ref={attachmentsRef} detail={detail} writes={writes} />,
    ];
    const questions = <DrawerQuestions key={`questions-${detail.id}`} detail={detail} writes={writes} />;
    const ledger = [
      <DrawerChecklist key={`checklist-${detail.id}`} detail={detail} writes={writes} walk={walk} onReadStage={readStage} />,
      walk !== null && <DrawerScenarios key={`scenarios-${detail.id}`} walk={walk} />,
      <DrawerIssuesAndTokens key={`ledger-${detail.id}`} detail={detail} writes={writes} />,
    ];
    const name = <DrawerTitle key={`title-${detail.id}`} detail={detail} writes={writes} />;
    if (!autonomy) sections.push(name, ...card);
    else if (asking) sections.push(name, questions, ...card, ...ledger);
    else sections.push(name, ...card, questions, ...ledger);
  }

  // The card's course: the lanes in their order, done behind the one it is in. Where it is now waits on an answer, is worked, or
  // is simply where it stands; a finished card's course is lit to its end.
  const at = laneId === null ? -1 : lanes.findIndex((spec) => spec.id === laneId);
  const course: AstrolabeTrackStep[] = lanes.map((spec, index) => ({
    id: spec.id,
    label: t(spec.titleKey),
    state: at < 0 || index > at ? 'next'
      : index < at || spec.statuses.includes('done') ? 'done'
        : status?.tone === 'warn' ? 'waiting'
          : spec.statuses.includes('active') ? 'live'
            : 'next',
  }));
  const lane = at < 0 ? null : t(lanes[at].titleKey);
  // What holds it, in words, while it waits in the lane that shows holds: the dispatcher's sentence, and how ageing has it ride.
  const walkNote = at >= 0 && lanes[at].showsHold === true ? walkNoteOf(walk, t) : null;
  const source = [lane, kind === null ? null : t(kind)].filter(Boolean).join(' · ') || t('kanban.drawer.untitled');

  return (
    <Opening
      open={cardId !== null}
      anchor={anchor}
      onClose={() => {
        if (reading !== null) backToCard();
        else onClose();
      }}
      backLabel={reading !== null ? t('kanban.ring.backToCard', { defaultValue: 'Back to the card' }) : t('kanban.drawer.close')}
      source={source}
      // Its name is the card's own title: its title field is the first thing in it, so the name is set only for a screen reader,
      // never twice on screen.
      name={detail?.title ?? t('kanban.drawer.untitled')}
      status={status ?? undefined}
      width={360}
      avoid={avoid}
      side={side}
      marks={{ 'data-bug-opening': cardId ?? '' }}
    >
      {read.loading && (
        /* Three blocks in the shape of what is coming — a title line, the description, the body — rather than a ring in the middle
           of an empty plate. The reader sees the card's skeleton settle into the card. */
        <div className="flex flex-col gap-3" aria-hidden="true">
          <div className="vv-skeleton h-7 w-2/3" />
          <div className="vv-skeleton h-16 w-full" />
          <div className="vv-skeleton h-24 w-full" />
        </div>
      )}

      {read.error !== null && (
        <EmptyState
          icon={CloudOff}
          title={t('kanban.drawer.unreachable.title')}
          message={read.error}
          actionLabel={t('kanban.drawer.unreachable.retry')}
          onAction={() => {
            setRead({ detail: null, loading: true, error: null });
            void readCard();
          }}
        />
      )}

      {detail !== null && reading !== null && (
        <SubagentTranscriptView
          sessionId={null}
          target={{ kind: 'soul', id: reading.launchId }}
          label={reading.label}
          running={reading.running}
          onBack={backToCard}
        />
      )}

      {detail !== null && (
        <div
          ref={sectionsRef}
          className={cn('bug-opening flex flex-col gap-5', reading !== null && 'hidden')}
          data-drop={dropping ? 'true' : undefined}
          onDragOver={(event) => {
            if (!holdsFiles(event)) return;
            event.preventDefault();
            if (!dropping) setDropping(true);
          }}
          onDragLeave={(event) => {
            // `dragleave` fires every time the held file crosses into one of the card's own children, so the edge clears only when
            // the pointer has actually left the card.
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
          }}
          onDrop={(event) => {
            if (!holdsFiles(event)) return;
            event.preventDefault();
            setDropping(false);
            attachmentsRef.current?.add(Array.from(event.dataTransfer.files));
          }}
        >
          {/* Its course: where it is, and a press away from anywhere else on the board. */}
          <Track
            steps={course}
            label={t('kanban.ring.course', { defaultValue: 'Course' })}
            value={laneId ?? undefined}
            stepLabel={(step, index, count) => t('kanban.ring.courseStep', { index: index + 1, count, lane: step.label, defaultValue: 'Lane {{index}} of {{count}}: {{lane}}' })}
            onOpen={(step) => {
              if (step.id !== laneId) onMove(step.id);
            }}
            className="mx-1 mt-3"
          />
          {walkNote !== null && <p data-bug-walk-note="" className="-mt-2 text-xs text-muted-foreground">{walkNote}</p>}
          {sections}
          {/* Its place in its lane, a step earlier or later (the order the board takes its cards in, as the old lanes' keys
              moved it), and Archive: each by its mark alone, its words its title and its name. Archiving deletes nothing. */}
          <div className="flex items-center justify-end gap-2 border-t border-[var(--hairline)] pt-3">
            {lane !== null && (
              <>
                <Button variant="outline" size="icon" data-bug-earlier="" aria-label={t('kanban.ring.earlier', { lane, defaultValue: 'Earlier in {{lane}}' })} title={t('kanban.ring.earlier', { lane, defaultValue: 'Earlier in {{lane}}' })} onClick={() => onShift(-1)} className="size-9 finger:size-11">
                  <ArrowUp aria-hidden="true" />
                </Button>
                <Button variant="outline" size="icon" data-bug-later="" aria-label={t('kanban.ring.later', { lane, defaultValue: 'Later in {{lane}}' })} title={t('kanban.ring.later', { lane, defaultValue: 'Later in {{lane}}' })} onClick={() => onShift(1)} className="size-9 finger:size-11">
                  <ArrowDown aria-hidden="true" />
                </Button>
              </>
            )}
            <Button variant="outline" size="icon" data-bug-archive="" aria-label={t('kanban.card.archive')} title={t('kanban.card.archive')} onClick={onArchive} className="size-9 finger:size-11">
              <Archive aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </Opening>
  );
}
