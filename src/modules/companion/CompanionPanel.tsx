import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { CompanionActionCard } from '@/modules/companion/CompanionActionCard';
import { CompanionComposer } from '@/modules/companion/CompanionComposer';
import { CompanionDraftCard } from '@/modules/companion/CompanionDraftCard';
import { CompanionDraftNoneLine } from '@/modules/companion/CompanionDraftFoldLine';
import { CompanionHeader } from '@/modules/companion/CompanionHeader';
import { CompanionLog } from '@/modules/companion/CompanionLog';
import { CompanionNotes } from '@/modules/companion/CompanionNotes';
import { CompanionPanelBoundary } from '@/modules/companion/CompanionPanelBoundary';
import { CompanionPanelGrips } from '@/modules/companion/CompanionPanelGrips';
import { CompanionWalkStrip } from '@/modules/companion/CompanionWalkStrip';
import { useCompanion } from '@/modules/companion/context/CompanionContext';
import { useCompanionPanelPlace } from '@/modules/companion/hooks/useCompanionPanelPlace';
import { useCompanionPresence } from '@/modules/companion/hooks/useCompanionPresence';
import { useDraftFold } from '@/modules/companion/hooks/useDraftFold';
import { mayFocusFieldOnOpen } from '@/modules/companion/hooks/useFinePointer';
import { useNotesFold } from '@/modules/companion/hooks/useNotesFold';
import type { CompanionModel, CompanionPicture } from '@/shared/companion-types';
import { openStation } from '@/shared/cloudcliDoors';
import { useBusySessionIdSet } from '@/shared/context/SessionProtectionContext';
import type { CompanionEars, CompanionPresence, CompanionVoice, TalkPress } from '@/shared/types';
import { Banner, Button, Card, Spinner } from '@/shared/ui';
import { cn } from '@/shared/utils';

type CompanionPanelViewProps = {
  /** Her picture as the page holds it; null until the first read lands. */
  picture: CompanionPicture | null;
  /** Why the read of the picture failed, while there is none: the panel says so with a Try again (`onReread`) instead of waiting for ever. */
  readFailure?: string | null;
  /** Reads the picture again. Absent, a failed read is told without the button. */
  onReread?: () => void;
  /** The page's open state: closed, the panel stays mounted (his unsent words and the log's place survive) and undrawn. */
  open: boolean;
  /** Whether the draft's target chat is working right now. */
  targetWorking: boolean;
  /** What she is doing on this page, her process included (`useCompanionPresence`): the header's status line draws it, and only it. */
  presence: CompanionPresence;
  /** The page's one talk press: the composer's talk button draws and presses it. Absent, the composer has no talk button. */
  talk?: TalkPress;
  /** This page's voice: the header draws its switch and the log marks the sentence being spoken. Absent, neither is drawn. */
  voice?: CompanionVoice;
  /** This page's ears: the header draws their switch, "Listen for her name on this device", and what they are doing. Absent, no row. */
  ears?: CompanionEars;
  onClose: () => void;
  /** Sends his typed words and the files he attached to them (either may be empty, never both); a refusal rejects and the composer puts both back. */
  onSendText: (text: string, files: File[]) => Promise<void>;
  onModelChange: (model: CompanionModel) => Promise<void>;
  onLiveChange: (live: boolean) => Promise<void>;
  onInterrupt: () => Promise<void>;
  onClear: () => Promise<void>;
  onEditDraft: (text: string) => Promise<void>;
  onSendDraft: (mode: 'turn' | 'steer') => Promise<void>;
  onClearDraft: () => Promise<void>;
  onDismissNote: (id: number) => Promise<void>;
  /** Withdraws the action waiting for his word; a refusal rejects with the server's sentence. Absent, its card draws no ×. */
  onWithdraw?: () => Promise<void>;
  /** The header's station button: opens Kaylee Station. Absent, the header draws no button. */
  onOpenStation?: () => void;
};

/**
 * Her door, the panel's way back when it closes from the keyboard: the rail's door where it is drawn, and her disc (the
 * kit's button in CompanionFab's layer), which is the door while it is seated and the rail's cell draws none. The first
 * of them on screen takes the focus: below md the rail's door stands in the closed drawer, drawn but hidden, while her
 * disc is in its corner.
 */
const DOOR_SELECTOR = '[data-companion-door], [data-companion-fab] > .vv-fab';

/**
 * HER PANEL, drawn: Kaylee beside every chat, tied to none. Exported for this file's CompanionPanel, which hands it the
 * page's picture and verbs, and for `.verify/companion-panel-scaffold.mjs`, `.verify/kaylee-talk-scaffold.mjs` and
 * `.verify/kaylee-voice-scaffold.mjs`, which mount it on fixture pictures, each with the `presence` its fixture's picture
 * (process and activity), press and voice resolve to (the second with a talk press, the third with a voice too).
 *
 * WHERE IT STANDS. It floats over whatever view or application is up — never a view, so the chat and the application
 * stay in sight beside her. From lg it is a 400px column at the right edge, 12px in, at the floating chat's level (z-45:
 * above the application layer at 40, below the rail at 50 and the FAB at 60), on the lift shadow with the strong border,
 * so it reads as an object over the page and keeps an edge over a dark application. Below lg it is a full-height sheet:
 * from 768 to 1023px a 400px column would leave the chat a sliver beside it (27px at 768 with the list open), so it takes
 * the screen as on a phone. The sheet is the shell's whole box, which already clears the status bar, the notch and the
 * keyboard, so it is `absolute inset-0` in it rather than fixed to the screen. It stands at z-61: over the sidebar's
 * drawer (50), whose rail holds the door that opens it, so closing it returns him to the drawer he opened it from; and
 * over the FAB (60), which on a phone floats in the sheet's own send lane (16px in, 56px up) and would take the press
 * meant for send. The sheet carries its own close, and whatever the FAB opens in the shell — an application at 40, the
 * floating chat at 45 — would open under the sheet anyway; dialogs, menus and toasts are portalled and stay above it.
 *
 * FROM LG, WITH A MOUSE OR A PEN ON THE PAGE, HE MOVES AND RESIZES IT (`useCompanionPanelPlace`; the mouse is known by its
 * events, `useFinePointer`, since a touchscreen computer Windows reports as used as a tablet names its pointer coarse and its
 * mouse is never asked): a press on the header's empty space carries it, and the kit's grips on its four edges and four
 * corners (`CompanionPanelGrips`) size it, held inside the shell, 8px in, and never smaller than her header, the composer,
 * the log's floor and every card in the dock at its own floor stand in (measured from the panel), nor narrower than 320px.
 * Where he leaves it is kept in this browser and drawn inline; with nothing kept nothing is, and the column above is what
 * stands. While it floats, the two rows that scroll at its right edge — the log and the dock, the notes' scroller inside it —
 * keep a gutter there (a transparent border over their own ground), the width of the right edge's grip (6px; 12px where the
 * browser names touch its primary pointer), so the strip stands beside their scrollbars and never on one. With nothing but
 * fingers on the page at lg it stays that column; below lg it is the sheet, with no grips and no gutter.
 *
 * TOP TO BOTTOM: the header (who, what she is doing, the focus, the controls, this device's voice switch given `voice`, and
 * this device's ears given `ears`; its status line draws `presence` alone, in which the page's own state wins over her process and her activity: Cut
 * for a breath after a press that stopped her voice, then his press, Listening or Transcribing, then Speaking while this
 * page sounds her, then Loading, Stopped, Asleep or Waking while her process is not awake); a warn
 * Banner while her process has failed — the server's sentence, pinned where the eye lands, while the log keeps the
 * system line as history and the status line says the next message starts her again; the log, marking the sentence
 * being spoken (before the first read lands, a waiting row; once a read has failed, a warn Banner with the reason and a
 * Try again, since the picture is not coming by itself — the status line still says Loading, as the one state has no word for it); the dock — the walkthrough, her notes, the action waiting for his word, the draft; the composer, with the paperclip and the talk button before send (his files go with his typed words).
 *
 * THE PANEL SHARES ITS HEIGHT, AND THE COMPOSER NEVER GIVES WAY. A phone's keyboard shrinks the shell to the strip above
 * it, a phone turned sideways is 375px tall, a long message grows the composer: whatever the room, nothing is cut at the
 * panel's edge. The header and the composer stand; the composer's field grows to a quarter of the panel's own height (the
 * panel is a size container, so the cap follows the panel and not the window), then scrolls. The log takes what is left
 * and keeps a floor of 3.5rem, so her newest line is in sight while he answers her. The dock is content-sized up to 55% of
 * the panel (23rem where 55% is less) and gives way last. While the card of an action waiting for his word is drawn in it,
 * the dock has no cap of its own: it may take every row but the log's floor, because she has just read the action back and
 * the card is what he reads (an iPhone's Safari with its bars showing leaves the panel 664px, where 55% would scroll his own
 * answers out of sight).
 *
 * INSIDE THE DOCK room runs out in a fixed order. The walkthrough always stands (it is where he is); so does the action
 * waiting for his word, whole (it is what will happen: its prompt scrolls inside a cap that is a share of the panel's
 * height, and his lines, which travel word for word, stand whole at any length); and so do the draft's target, its notice
 * and its sends: the draft is the one thing ever sent. The notes give way first, down to a floor that keeps the first
 * note's title and its ✕ (with their count line), then the draft's field, down to its 88px floor, scrolling inside. EACH
 * FOLDS to one line that stands, at his press, kept in this browser, the two apart (`usePanelFold`): the notes to their
 * count line (`useNotesFold`), the draft to its head row — "DRAFT", the target and the brief's opening words
 * (`useDraftFold`), drawn while folded whether or not there is a draft ("No draft"). The room a fold leaves goes to the
 * rest of the dock and then to the log, in the same order; both folded, the dock is the walkthrough and the two lines.
 * Where those floors fit — a phone held upright, a laptop — the dock never scrolls. On a shorter panel (the keyboard up, a
 * phone turned sideways), with an action and a draft docked together, or with his lines at their longest, the dock scrolls
 * as the last resort, each card whole within it and the action's foot (sticky) in sight: the draft card holds a floor of
 * its own, so it never folds over its sends. A dock left with nothing to draw (an action that lapsed, alone in it) closes
 * rather than stand as an empty band.
 *
 * KEYS. Escape pressed inside the panel closes it, and is claimed on the way (`preventDefault` in the window's capture
 * phase): the chat stops its running turn on any Escape nobody claimed, and a key pressed in her composer is not his
 * chat's. Opened where a mouse or a pen drives the page, by a press that was not a finger's, it puts the cursor in her
 * composer (`mayFocusFieldOnOpen`); opened by a finger, or on a page that has heard neither, it does not, so opening her to
 * read the draft does not raise the keyboard. Closed from inside, it hands focus back to her door when it is on screen: the
 * rail's door, or her disc, wherever it stands on screen.
 */
export function CompanionPanelView({
  picture, readFailure, onReread, open, targetWorking, presence, talk, voice, ears, onClose, onSendText, onModelChange, onLiveChange, onInterrupt,
  onClear, onEditDraft, onSendDraft, onClearDraft, onDismissNote, onWithdraw, onOpenStation,
}: CompanionPanelViewProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const place = useCompanionPanelPlace(panelRef, open);
  const notesFold = useNotesFold(picture?.notes ?? null);
  const draftFold = useDraftFold(picture === null ? undefined : picture.draft);
  const name = picture?.settings.name ?? t('companion.defaultName');
  const failed = picture?.process.state === 'failed';
  // The draft's place: its card while there is a draft, and its folded line while he keeps it folded with none.
  const draftPlace = picture !== null && (picture.draft !== null || draftFold.folded);
  const docked = picture !== null && (picture.walk !== null || picture.notes.length > 0 || picture.pending !== null || draftPlace);

  // Closing from inside the panel hands focus to the door, so the keyboard is not dropped on the page's body.
  const close = useCallback(() => {
    const focusWasInside = panelRef.current?.contains(document.activeElement) ?? false;
    onClose();
    // On screen, not merely in the page: a door in the closed drawer keeps its `offsetParent` under `visibility: hidden`,
    // and refuses the focus.
    const door = [...document.querySelectorAll<HTMLElement>(DOOR_SELECTOR)].find((el) => el.checkVisibility({ visibilityProperty: true }));
    if (focusWasInside && door) door.focus();
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const claimEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (!panelRef.current?.contains(event.target as Node)) return;
      event.preventDefault();
      close();
    };
    window.addEventListener('keydown', claimEscape, { capture: true });
    return () => window.removeEventListener('keydown', claimEscape, { capture: true });
  }, [open, close]);

  useEffect(() => {
    if (!open || !mayFocusFieldOnOpen()) return;
    panelRef.current?.querySelector<HTMLTextAreaElement>('[data-companion-composer-field]')?.focus({ preventScroll: true });
  }, [open]);

  return (
    <Card
      ref={panelRef}
      role="region"
      aria-label={t('companion.panel.label', { name })}
      data-companion-panel=""
      className={cn(
        open ? 'flex' : 'hidden',
        'absolute inset-0 z-[61] flex-col overflow-hidden [container-type:size] max-lg:rounded-none max-lg:border-0 max-lg:shadow-none',
        'lg:inset-y-3 lg:left-auto lg:right-3 lg:z-[45] lg:w-[400px] lg:border-input lg:shadow-lift',
        // The right edge's grip is the kit's strip, `--vv-grip-edge`: 6px, and 12px where the browser names touch its primary
        // pointer (a touchscreen computer used as a tablet floats the panel too, its mouse in use), so the log and the dock keep
        // that much clear of it.
        place.floating && '[&>[data-companion-log]]:border-r-[6px] [@media(pointer:coarse)]:[&>[data-companion-log]]:border-r-[12px] [&>[data-companion-log]]:border-r-transparent',
        place.floating && '[&>[data-companion-dock]]:border-r-[6px] [@media(pointer:coarse)]:[&>[data-companion-dock]]:border-r-[12px] [&>[data-companion-dock]]:border-r-transparent',
      )}
      style={place.style}
    >
      <CompanionHeader
        name={name}
        picture={picture}
        presence={presence}
        voice={voice}
        ears={ears}
        onModelChange={onModelChange}
        onLiveChange={onLiveChange}
        onInterrupt={onInterrupt}
        onClear={onClear}
        onClose={close}
        onOpenStation={onOpenStation}
        onMovePress={place.onMovePress}
      />

      {failed && (
        <div data-companion-failed="" className="shrink-0 bg-background px-3 pt-3">
          <Banner tone="warn">{picture.process.error ?? t('companion.panel.failedUnknown', { name })}</Banner>
        </div>
      )}

      {picture === null && readFailure ? (
        // A read that failed is said, with the way to try again: the spinner below would wait on a picture that is not coming.
        <div data-companion-log="failed" className="min-h-0 flex-1 overflow-y-auto bg-background p-3">
          <Banner
            tone="warn"
            action={onReread && <Button variant="outline" size="sm" onClick={onReread}>{t('companion.panel.retry')}</Button>}
          >
            {t('companion.panel.readFailed', { name, reason: readFailure })}
          </Banner>
        </div>
      ) : picture === null ? (
        <div data-companion-log="loading" className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-background p-4">
          <Spinner size={28} label={t('companion.panel.loading', { name })} />
        </div>
      ) : (
        <CompanionLog entries={picture.log} name={name} turnId={picture.turnId} visible={open} speaking={voice?.speaking} />
      )}

      {docked && (
        // Gives way to the panel (`min-h-0`), and scrolls only once its floors no longer fit. Its cap holds while no action card
        // is drawn in it: an action's lapsed card draws nothing, so the cap comes back with no word from the page. `relative`,
        // so it is the containing block of everything it scrolls: the draft field's `sr-only` label, placed against the panel,
        // escaped the dock's scroll once it was squeezed and gave the clipped panel a scroll range of its own (106px measured
        // at a 285px panel), which a focus could scroll and nothing scrolls back.
        <div
          data-companion-dock=""
          className="relative flex max-h-[max(55%,23rem)] min-h-0 flex-col gap-2 overflow-y-auto border-t border-border bg-background px-3 pb-1 pt-3 empty:hidden has-[[data-companion-action]]:max-h-none"
        >
          {picture.walk && (
            <div className="shrink-0">
              <CompanionWalkStrip walk={picture.walk} />
            </div>
          )}
          {picture.notes.length > 0 && (
            // The notes scroll as one. They start at their full height and give way ten thousand times faster than the
            // draft — all of the shrinking, to the pixel — so the draft's field keeps every word until the notes reach their
            // floor (the count line and the first title with its ✕), measured: the scroller's 2px inset, the count line's 28px
            // (its fold control's), the 8px under it and the first card down to its ✕ (37px), 4.75rem; under a finger, where
            // the fold control is 44px, 5.75rem. Folded, they are their count line, which stands. The inset keeps the cards'
            // edges and shadows clear of the clip; a section with nothing left to show draws no band.
            <div
              data-companion-notes-scroll=""
              className={cn(
                '-mx-3 overflow-y-auto px-3 py-0.5 empty:hidden',
                notesFold.folded ? 'shrink-0' : 'min-h-[4.75rem] flex-[0_10000_auto] finger:min-h-[5.75rem]',
              )}
            >
              <CompanionNotes
                notes={picture.notes}
                name={name}
                folded={notesFold.folded}
                onFoldChange={notesFold.setFolded}
                fresh={notesFold.fresh}
                onDismiss={onDismissNote}
              />
            </div>
          )}
          {picture.pending && (
            // Keyed by the action, so a new one is a new card: nothing of the last one's Withdraw or lapse is carried over.
            <CompanionActionCard key={picture.pending.id} pending={picture.pending} name={name} onWithdraw={onWithdraw} />
          )}
          {draftPlace && (
            // A flex column with no automatic minimum (which would count the field's whole basis), so the card it holds
            // gives way with the dock: inside the card only the field shrinks, and its own 88px floor is what stops it.
            // Folded, the card's floor is its one line (`useCardFloor`), written at the press, so it stands and her panel's
            // floor drops with it at once; the line with no draft has no floor of its own, and stands (`shrink-0`).
            <div className={cn('flex flex-col', picture.draft ? 'min-h-0' : 'shrink-0')}>
              {picture.draft ? (
                <CompanionDraftCard
                  draft={picture.draft}
                  name={name}
                  targetWorking={targetWorking}
                  visible={open}
                  fold={draftFold}
                  // Every save of his passes the fold first: his own words coming back are never news on the folded line.
                  onEdit={(text) => { draftFold.onOwnSave(text); return onEditDraft(text); }}
                  onSend={onSendDraft}
                  onClear={onClearDraft}
                />
              ) : (
                <CompanionDraftNoneLine fold={draftFold} />
              )}
            </div>
          )}
        </div>
      )}

      <CompanionComposer name={name} ready={picture !== null} visible={open} onSend={onSendText} talk={talk} />

      {place.floating && (
        <CompanionPanelGrips label={t('companion.panel.resize', { name })} keyboardCorner={place.keyboardCorner} resizeBy={place.resizeBy} />
      )}
    </Card>
  );
}

/**
 * Her panel on the page: what WorkspaceFrame renders after the floating chat, in a boundary of her own
 * (`CompanionPanelBoundary`): a fault while she draws gives way her panel alone, never the page.
 */
export function CompanionPanel() {
  return (
    <CompanionPanelBoundary>
      <CompanionPanelOnPage />
    </CompanionPanelBoundary>
  );
}

/**
 * Her panel's own reads: the page's picture, the open state and the verbs from the companion's provider, and what she is doing
 * from `useCompanionPresence`, handed to CompanionPanelView, which draws every state.
 */
function CompanionPanelOnPage() {
  // `voice` is the switch and the sentence sounding, for the header's switch and the log's mark; the status line reads `presence` instead.
  const {
    picture, readFailure, reread, open, setOpen, sendText, saveSettings, editDraft, sendDraft, clearDraft, cancelAction, dismissNote, interrupt, clear,
    talk, voice, ears,
  } = useCompanion();
  const presence = useCompanionPresence();
  // The head's station button: the same door as the command palette's row, bound here to the router.
  const navigate = useNavigate();
  // The page's own set of chats with a turn running: Send steer shows while the draft's target is in it, because only then is there a turn to fold into.
  const busySessionIds = useBusySessionIdSet();
  // The action on the card he sees: the × withdraws that one, whatever has been prepared since the press.
  const pendingId = picture?.pending?.id ?? null;
  const target = picture?.draft?.target;
  const targetWorking = target?.kind === 'session' && busySessionIds.has(target.session.sessionId);

  return (
    <CompanionPanelView
      picture={picture}
      readFailure={readFailure}
      onReread={reread}
      open={open}
      targetWorking={targetWorking}
      presence={presence}
      onClose={() => setOpen(false)}
      onSendText={sendText}
      onModelChange={(model) => saveSettings({ model })}
      onLiveChange={(live) => saveSettings({ live })}
      onInterrupt={interrupt}
      onClear={clear}
      onEditDraft={editDraft}
      // A refused send rejects with the server's sentence, which the card shows under its sends.
      onSendDraft={async (mode) => { await sendDraft(mode); }}
      onClearDraft={clearDraft}
      onDismissNote={dismissNote}
      // His × on the action card: the provider calls the server and clears this action from the picture, so the card goes at once.
      onWithdraw={pendingId === null ? undefined : () => cancelAction(pendingId)}
      onOpenStation={() => openStation(navigate)}
      talk={talk}
      voice={voice}
      ears={ears}
    />
  );
}
