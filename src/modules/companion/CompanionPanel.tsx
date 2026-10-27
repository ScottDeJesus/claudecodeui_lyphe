import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { CompanionComposer } from '@/modules/companion/CompanionComposer';
import { CompanionDraftCard } from '@/modules/companion/CompanionDraftCard';
import { CompanionHeader } from '@/modules/companion/CompanionHeader';
import { CompanionLog } from '@/modules/companion/CompanionLog';
import { CompanionNotes } from '@/modules/companion/CompanionNotes';
import { CompanionWalkStrip } from '@/modules/companion/CompanionWalkStrip';
import type { CompanionModel, CompanionPicture } from '@/shared/companion-types';
import { Banner, Card, Spinner } from '@/shared/ui';
import { cn } from '@/shared/utils';

type CompanionPanelViewProps = {
  /** Her picture as the page holds it; null until the first read lands. */
  picture: CompanionPicture | null;
  /** The page's open state: closed, the panel stays mounted (his unsent words and the log's place survive) and undrawn. */
  open: boolean;
  /** Whether the draft's target chat is working right now. */
  targetWorking: boolean;
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

/** The door in the rail, the panel's way back when it closes from the keyboard. */
const DOOR_SELECTOR = '[data-companion-door]';

/**
 * HER PANEL, drawn: Kaylee beside every chat, tied to none. Exported for this file's CompanionPanel, which hands it the
 * page's picture and verbs, and for `.verify/companion-panel-scaffold.mjs`, which mounts it on fixture pictures.
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
 * TOP TO BOTTOM: the header (who, what she is doing, the focus, the controls); a warn Banner while her process has
 * failed — the server's sentence, pinned where the eye lands, while the log keeps the system line as history and the
 * status line says the next message starts her again; the log; the dock — the walkthrough, her notes, the draft; the
 * composer.
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
 * the draft does not raise the keyboard. Closed from inside, it hands focus back to the rail's door when the door is on
 * screen.
 */
export function CompanionPanelView({
  picture, open, targetWorking, onClose, onSendText, onModelChange, onLiveChange, onInterrupt, onClear,
  onEditDraft, onSendDraft, onClearDraft, onDismissNote,
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
    const door = document.querySelector<HTMLElement>(DOOR_SELECTOR);
    if (focusWasInside && door && door.offsetParent !== null) door.focus();
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

      {picture === null ? (
        <div data-companion-log="loading" className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-background p-4">
          <Spinner size={28} label={t('companion.panel.loading', { name })} />
        </div>
      ) : (
        <CompanionLog entries={picture.log} name={name} turnId={picture.turnId} visible={open} />
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

      <CompanionComposer name={name} ready={picture !== null} visible={open} onSend={onSendText} />
    </Card>
  );
}

/**
 * Her panel on the page: what WorkspaceFrame renders after the floating chat. It reads the page's picture, the open
 * state and the verbs from the companion's provider and hands them to CompanionPanelView, which draws every state.
 */
export function CompanionPanel() {
  // FILL(panel-fill): picture and open — `const { picture, open, setOpen, sendText, saveSettings, editDraft, clearDraft, dismissNote, interrupt, clear } = useCompanion();` replaces these two stand-ins.
  const picture: CompanionPicture | null = null;
  const open = false;
  // FILL(send): targetWorking — whether the draft's target chat is working right now (the page's busy-session set), with `sendDraft` from useCompanion().
  const targetWorking = false;

  return (
    <CompanionPanelView
      picture={picture}
      open={open}
      targetWorking={targetWorking}
      // FILL(panel-fill): close — setOpen(false)
      onClose={() => {}}
      // FILL(panel-fill): send text — sendText(text)
      onSendText={async () => {}}
      // FILL(panel-fill): save settings — saveSettings({ model })
      onModelChange={async () => {}}
      // FILL(panel-fill): save settings — saveSettings({ live })
      onLiveChange={async () => {}}
      // FILL(panel-fill): interrupt — interrupt()
      onInterrupt={async () => {}}
      // FILL(panel-fill): clear — clear()
      onClear={async () => {}}
      // FILL(panel-fill): edit draft — editDraft(text)
      onEditDraft={async () => {}}
      // FILL(send): sendDraft(mode) — Send turn and Send steer; a refused send rejects with the server's sentence, which the card shows.
      onSendDraft={async () => {}}
      // FILL(panel-fill): clear draft — clearDraft()
      onClearDraft={async () => {}}
      // FILL(panel-fill): dismiss note — dismissNote(id)
      onDismissNote={async () => {}}
    />
  );
}
