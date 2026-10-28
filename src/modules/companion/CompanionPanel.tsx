import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { CompanionComposer } from '@/modules/companion/CompanionComposer';
import { CompanionDraftCard } from '@/modules/companion/CompanionDraftCard';
import { CompanionHeader } from '@/modules/companion/CompanionHeader';
import { CompanionLog } from '@/modules/companion/CompanionLog';
import { CompanionNotes } from '@/modules/companion/CompanionNotes';
import { CompanionWalkStrip } from '@/modules/companion/CompanionWalkStrip';
import { useCompanion } from '@/modules/companion/context/CompanionContext';
import { useCompanionPresence } from '@/modules/companion/hooks/useCompanionPresence';
import type { CompanionModel, CompanionPicture } from '@/shared/companion-types';
import { useBusySessionIdSet } from '@/shared/context/SessionProtectionContext';
import type { CompanionPresence, CompanionVoice, TalkPress } from '@/shared/types';
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
  onClose: () => void;
  onSendText: (text: string) => Promise<void>;
  onModelChange: (model: CompanionModel) => Promise<void>;
  onLiveChange: (live: boolean) => Promise<void>;
  onInterrupt: () => Promise<void>;
  onClear: () => Promise<void>;
  onEditDraft: (text: string) => Promise<void>;
  onSendDraft: (mode: 'turn' | 'steer') => Promise<void>;
  onClearDraft: () => Promise<void>;
  onDismissNote: (id: number) => Promise<void>;
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
 * TOP TO BOTTOM: the header (who, what she is doing, the focus, the controls, and this device's voice switch given
 * `voice`; its status line draws `presence` alone, in which the page's own state wins over her process and her activity: Cut
 * for a breath after a press that stopped her voice, then his press, Listening or Transcribing, then Speaking while this
 * page sounds her, then Loading, Stopped, Asleep or Waking while her process is not awake); a warn
 * Banner while her process has failed — the server's sentence, pinned where the eye lands, while the log keeps the
 * system line as history and the status line says the next message starts her again; the log, marking the sentence
 * being spoken (before the first read lands, a waiting row; once a read has failed, a warn Banner with the reason and a
 * Try again, since the picture is not coming by itself — the status line still says Loading, as the one state has no word for it); the dock — the walkthrough, her notes, the draft; the composer, with the talk button before send.
 *
 * THE PANEL SHARES ITS HEIGHT, AND THE COMPOSER NEVER GIVES WAY. A phone's keyboard shrinks the shell to the strip above
 * it, a phone turned sideways is 375px tall, a long message grows the composer: whatever the room, nothing is cut at the
 * panel's edge. The header and the composer stand; the composer's field grows to a quarter of the panel's own height (the
 * panel is a size container, so the cap follows the panel and not the window), then scrolls. The log takes what is left
 * and keeps a floor of 3.5rem, so her newest line is in sight while he answers her. The dock is content-sized up to 55% of
 * the panel (23rem where 55% is less) and gives way last.
 *
 * INSIDE THE DOCK room runs out in a fixed order. The walkthrough always stands (it is where he is), and so do the draft's
 * target, its notice and its sends: the draft is the one thing ever sent. The notes give way first, down to a floor that
 * keeps the first note's title and its ✕ (with the count of all of them), then the draft's field, down to its 88px floor,
 * scrolling inside. Where those floors fit — a phone held upright, a laptop — the dock never scrolls. On a shorter panel
 * (the keyboard up, a phone turned sideways) the dock scrolls as the last resort, the card whole within it: the card
 * holds a floor of its own, so it never folds over its sends.
 *
 * KEYS. Escape pressed inside the panel closes it, and is claimed on the way (`preventDefault` in the window's capture
 * phase): the chat stops its running turn on any Escape nobody claimed, and a key pressed in her composer is not his
 * chat's. Opened on a desktop it puts the cursor in her composer; on a touch screen it does not, so opening her to read
 * the draft does not raise the keyboard. Closed from inside, it hands focus back to her door when it is on screen: the
 * rail's door, or her disc, wherever it stands on screen.
 */
export function CompanionPanelView({
  picture, readFailure, onReread, open, targetWorking, presence, talk, voice, onClose, onSendText, onModelChange, onLiveChange, onInterrupt,
  onClear, onEditDraft, onSendDraft, onClearDraft, onDismissNote,
}: CompanionPanelViewProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const name = picture?.settings.name ?? t('companion.defaultName');
  const failed = picture?.process.state === 'failed';
  const docked = picture !== null && (picture.walk !== null || picture.notes.length > 0 || picture.draft !== null);

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
    if (!open || !window.matchMedia('(pointer: fine)').matches) return;
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
      )}
    >
      <CompanionHeader
        name={name}
        picture={picture}
        presence={presence}
        voice={voice}
        onModelChange={onModelChange}
        onLiveChange={onLiveChange}
        onInterrupt={onInterrupt}
        onClear={onClear}
        onClose={close}
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
        // Gives way to the panel (`min-h-0`), and scrolls only once its floors no longer fit.
        <div data-companion-dock="" className="flex max-h-[max(55%,23rem)] min-h-0 flex-col gap-2 overflow-y-auto border-t border-border bg-background px-3 pb-1 pt-3">
          {picture.walk && (
            <div className="shrink-0">
              <CompanionWalkStrip walk={picture.walk} />
            </div>
          )}
          {picture.notes.length > 0 && (
            // The notes scroll as one. They start at their full height and give way ten thousand times faster than the
            // draft — all of the shrinking, to the pixel — so the draft's field keeps every word until the notes reach their
            // floor (the count and the first title with its ✕). The inset keeps the cards' edges and shadows clear of the clip.
            <div data-companion-notes-scroll="" className="-mx-3 min-h-[4.25rem] flex-[0_10000_auto] overflow-y-auto px-3 py-0.5">
              <CompanionNotes notes={picture.notes} name={name} onDismiss={onDismissNote} />
            </div>
          )}
          {picture.draft && (
            // A flex column with no automatic minimum (which would count the field's whole basis), so the card it holds
            // gives way with the dock: inside the card only the field shrinks, and its own 88px floor is what stops it.
            <div className="flex min-h-0 flex-col">
              <CompanionDraftCard
                draft={picture.draft}
                name={name}
                targetWorking={targetWorking}
                visible={open}
                onEdit={onEditDraft}
                onSend={onSendDraft}
                onClear={onClearDraft}
              />
            </div>
          )}
        </div>
      )}

      <CompanionComposer name={name} ready={picture !== null} visible={open} onSend={onSendText} talk={talk} />
    </Card>
  );
}

/**
 * Her panel on the page: what WorkspaceFrame renders after the floating chat. It reads the page's picture, the open
 * state and the verbs from the companion's provider, and what she is doing from `useCompanionPresence`, and hands them to
 * CompanionPanelView, which draws every state.
 */
export function CompanionPanel() {
  // `voice` is the switch and the sentence sounding, for the header's switch and the log's mark; the status line reads `presence` instead.
  const {
    picture, readFailure, reread, open, setOpen, sendText, saveSettings, editDraft, sendDraft, clearDraft, dismissNote, interrupt, clear, talk, voice,
  } = useCompanion();
  const presence = useCompanionPresence();
  // The page's own set of chats with a turn running: Send steer shows while the draft's target is in it, because only then is there a turn to fold into.
  const busySessionIds = useBusySessionIdSet();
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
      talk={talk}
      voice={voice}
    />
  );
}
