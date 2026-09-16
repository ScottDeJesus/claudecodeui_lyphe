import { CloudOff, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DrawerBody } from '@/modules/kanban/card-drawer/DrawerBody';
import { DrawerChecklist } from '@/modules/kanban/card-drawer/DrawerChecklist';
import { DrawerIssuesAndTokens } from '@/modules/kanban/card-drawer/DrawerIssuesAndTokens';
import { DrawerQuestions } from '@/modules/kanban/card-drawer/DrawerQuestions';
import type { KanbanMutations } from '@/modules/kanban/hooks/useKanbanMutations';
import type { KanbanBoardEvent, KanbanCardDetail } from '@/shared/kanban-types';
import { api, readApiJson } from '@/shared/api';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import { Button, Dialog, DialogContent, DialogTitle, EmptyState, ScrollArea } from '@/shared/ui';

/**
 * THE OPEN CARD: a sheet down the right of the board, and the only thing on this screen that ever
 * reads a card's DETAIL.
 *
 * IT IS A SHELL AND NOTHING ELSE. No field lives in this file. It owns the frame, the header, the
 * scroll container, the three states a card can be in before it is readable, and the ONE decision
 * the four sections below it cannot make for themselves: which of them the board's autonomy
 * setting lets the reader see at all. `DrawerBody` is the card every board has — a title, what it
 * is for, its tags and how urgent it is. The other three are the autonomous run's own ledger, and
 * with autonomy off they are not hidden detail, they are not this board's vocabulary.
 *
 * IT IS THE ONLY FETCHER. One read when the card opens, handed down whole; a section that fetched
 * the slice it needed would cost five requests per open and let the checklist disagree with the
 * count on the card's face. The same read answers a write made anywhere inside it — one path in,
 * one path back.
 *
 * A SHEET, NOT A CENTRED BOX. The board stays visible beside it on a desktop, so the reader never
 * loses the lane they came from; under 640px it takes the screen, because a 300px lane behind a
 * 300px dialog is two things fighting for one column. The sheet rises rather than sliding, on the
 * app's own `vv-rise`, so the entrance costs no keyframe this phase may not add.
 *
 * FOCUS COMES BACK TO THE CARD. `DialogContent` remembers what had focus when it opened and
 * returns it on close — which is the card the reader pressed Enter on. That contract is why this
 * component stays MOUNTED while the board is open and switches on `cardId` instead: unmounting
 * the dialog to close it throws the memory away with the component, and the reader lands back at
 * the top of the document.
 */

type KanbanCardDrawerProps = {
  /** The open card, or `null` for a closed drawer. The panel holds it, so the board and the
   *  drawer can never disagree about which card is open. */
  cardId: string | null;
  /** The board's own setting. It decides which SECTIONS render, and gates no write: every verb
   *  behind them stays reachable on the server with autonomy off. */
  autonomy: boolean;
  /** The board's write verbs, handed to the four sections below. This shell owns the READ; the
   *  panel owns the writes, because a second `useKanbanMutations` here would be a second
   *  `applyCard` and two ideas about where a card sits. */
  writes: KanbanMutations;
  onClose: () => void;
};

/** The one read this screen makes, and the two states it can be in before it lands. */
type DrawerRead = {
  detail: KanbanCardDetail | null;
  loading: boolean;
  /** The server's own sentence when the card could not be read. */
  error: string | null;
};

/** Rendered by KanbanPanel, once, beside the lane rail. Nothing else mounts it. */
export function KanbanCardDrawer({ cardId, autonomy, writes, onClose }: KanbanCardDrawerProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const { subscribe } = useWebSocket();

  const [read, setRead] = useState<DrawerRead>({ detail: null, loading: false, error: null });

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
   * already on screen, so a read that cleared before answering would unmount the four sections
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
    setRead({ detail: null, loading: cardId !== null, error: null });
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
   * another session, or by a build holding the card's lease — comes back as a `kanban_event`, and
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

  return (
    <Dialog
      open={cardId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        aria-labelledby={titleId}
        animationClassName="animate-shape-rise motion-reduce:animate-none"
        className="left-auto right-0 top-0 flex h-full max-w-xl translate-x-0 translate-y-0 flex-col rounded-none p-0 sm:rounded-l-2xl"
      >
        {/* The accessible name is the card's own title. It is not painted here because the title
            is EDITABLE three lines below, and a screen that shows one string twice — once as a
            label and once as a field — reads as a mistake the reader then goes looking for. */}
        <DialogTitle id={titleId}>{detail?.title ?? t('kanban.drawer.untitled')}</DialogTitle>

        {/* Identity left, exit right, at the board header's own height so the two bars line up
            when the sheet opens beside the rail. The id is what stays true while the body
            scrolls — a title can be edited out from under the reader, an id cannot. */}
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
          <span className="vv-tabular truncate text-xs text-ink-faint">{cardId}</span>
          <Button
            variant="ghost"
            size="icon"
            // `.vv-button--ghost` paints the accent; the close is chrome and takes the muted ink
            // instead, so the one green thing in this sheet stays the progress meter.
            className="ml-auto h-8 w-8 text-muted-foreground"
            aria-label={t('kanban.drawer.close')}
            onClick={onClose}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </header>

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-6 p-4">
            {read.loading && (
              /* Three blocks in the shape of what is coming — a title line, the description, the
                 body — rather than a ring in the middle of an empty sheet. The reader sees the
                 card's skeleton settle into the card. */
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
                  // The same read the open made, asked again by hand. It says so on screen while it
                  // runs, because a Retry that changes nothing visible reads as a dead button.
                  setRead({ detail: null, loading: true, error: null });
                  void readCard();
                }}
              />
            )}

            {detail !== null && (
              <>
                {/* `key` is the CARD, not the section: every field below holds a draft of what the
                    reader is typing, and a draft seeded from one card must never survive into
                    another. A re-read of the SAME card keeps the key and so keeps the drafts —
                    which is what stops a websocket frame from deleting a half-typed sentence. */}
                <DrawerBody key={`body-${detail.id}`} detail={detail} writes={writes} />

                {/* The autonomous run's ledger. With autonomy off these four are not collapsed or
                    dimmed — they are absent, because a board that is not running itself has no
                    questions to answer, no checklist being walked, no lease and no spend. */}
                {autonomy && (
                  <>
                    <DrawerQuestions key={`questions-${detail.id}`} detail={detail} writes={writes} />
                    <DrawerChecklist key={`checklist-${detail.id}`} detail={detail} writes={writes} />
                    <DrawerIssuesAndTokens key={`ledger-${detail.id}`} detail={detail} writes={writes} />
                  </>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
