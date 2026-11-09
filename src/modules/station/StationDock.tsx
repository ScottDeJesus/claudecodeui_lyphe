import type { ComponentProps, MouseEvent, PointerEvent, SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { CompanionDraftCard, useCompanion } from '@/modules/companion';
import { useStation } from '@/modules/station/context/StationContext';
import { useStationSessions } from '@/modules/station/context/StationSessionsContext';
import { StationArrival } from '@/modules/station/StationArrival';
import type { CompanionDraft } from '@/shared/companion-types';
import type { StationDensity, StationRegionProps, StationTier } from '@/shared/types';
import { EmptyState, keepFieldFocus, keepFieldFocusWhileDisabled } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** The card's own verbs, as it types them: the dock hands them through untouched. */
type DraftCardProps = ComponentProps<typeof CompanionDraftCard>;

type StationDockViewProps = {
  /**
   * The window's tier. In the scene the held draft takes at most 45% of the window's height; at the `narrow` tier (compact's
   * Conversation section) it holds itself to the frame that ends above the on-screen keyboard (`NARROW_FRAME_HOLD`).
   */
  tier: StationTier;
  /** `full` (the scene, wide and laptop): the held form, drawn only while a draft stands. `compact`: the section's form. */
  density: StationDensity;
  /** The draft as the companion's picture holds it, or null while it holds none. */
  draft: CompanionDraft | null;
  /** Her name, for the card's words that say she changed the draft. */
  name: string;
  /**
   * Whether the draft's target chat is working now — its row in the station's sessions `working` or `waiting` (a chat stopped
   * on an ask still holds its run). Only then is there a turn to steer: Send steer shows, and leads.
   */
  targetWorking: boolean;
  /** Saves his edit of the brief; the card saves when the field blurs and before any send. */
  onEdit: DraftCardProps['onEdit'];
  /** Sends the draft as a turn, or folds it into the turn running now; a refused send rejects with the server's sentence. */
  onSend: DraftCardProps['onSend'];
  /** Discards the draft, once the card's question is answered. */
  onClear: DraftCardProps['onClear'];
  /** Puts the draft's target session on the stage. Handed to the card for a session's draft only: a new chat has none to show. */
  onTargetPress: () => void;
  /** The dock's scroller, for the station's scroll memory (`scrollMemory('dock')`). */
  scrollRef?: (node: HTMLElement | null) => void;
};

/**
 * THE NARROW TIER'S HOLD ON THE FRAME. The shell's frame ends its foot at `--keyboard-height`, so while he edits the brief the
 * frame is the screen above the keyboard; the dock is held to 60% of that frame (the rest is the bar and her head, with room to
 * spare), so the card always fits whole inside it, the field giving way first: the field he types in, its target and its sends
 * stand above the keys together (the Conversation section lifts its own 45% cap while the field holds the focus). A height,
 * never a fixed or absolute box of its own.
 */
const NARROW_FRAME_HOLD = 'max-h-[calc((100dvh-var(--keyboard-height,0px))*0.6)]';

/** The held draft's cap in the scene: at most 36% of the window's height, so the work above it keeps the most of it. */
const HELD_CAP = 'max-h-[36vh]';

/** The cap at compact: in the section at most 45% of it (the section's own rule), and at the narrow tier the keyboard's hold. */
const COMPACT_CAP: Record<StationTier, string> = { wide: '', laptop: '', narrow: NARROW_FRAME_HOLD };

/** The kit's cure (a press never takes the focus from the field), read on the dock's section: the dock only decides where it applies. */
const keepFocusThroughPress = keepFieldFocus<HTMLElement>();

/**
 * The dock's scope test for the kit's keepers: the card's buttons are the companion module's own, so the dock decides on its section
 * which presses the cure covers, a press on a button while the card's own field holds the focus. Answers that button, or null for a
 * press the cure leaves alone.
 */
function buttonPressedWhileFieldFocused(event: SyntheticEvent<HTMLElement>): HTMLButtonElement | null {
  const focused = event.currentTarget.ownerDocument.activeElement;
  const pressed = (event.target as Element).closest('button');
  return pressed !== null && focused?.tagName === 'TEXTAREA' && event.currentTarget.contains(focused) ? pressed : null;
}

/**
 * The dock's `onMouseDown`, an ENABLED press of the card: the press keeps the field's focus, so the on-screen keyboard stays up and
 * the dock keeps the room the section lifted its cap to (`has-[textarea:focus]`) until the press lands. WebKit gives a tapped button
 * no focus and blurs the field on the tap's mousedown: the dock fell back to its cap mid-tap, and the release went to whatever stood
 * there next, so his first Send on an iPhone was lost. A press that takes the focus itself (Clear's question) still takes it; the send
 * still saves his edit first.
 */
function keepFieldFocusInDock(event: MouseEvent<HTMLElement>) {
  if (buttonPressedWhileFieldFocused(event) !== null) keepFocusThroughPress(event);
}

/**
 * The dock's `onPointerDown`, a DISABLED press of the card (Send with his brief emptied, or the other mode's Send while one is out): a
 * disabled button is dispatched no `mousedown`, so `keepFieldFocusInDock` never runs for it and the tap still moved the focus off the
 * field. The kit's keeper for that state default-prevents the `pointerdown`; here it is given the pressed button's own `disabled`, so an
 * enabled press is untouched.
 */
function keepFieldFocusInDockWhileDisabled(event: PointerEvent<HTMLElement>) {
  keepFieldFocusWhileDisabled<HTMLElement>(buttonPressedWhileFieldFocused(event)?.disabled)(event);
}

/**
 * THE DRAFT DOCK: the brief the companion composed for a chat, held out for your Send.
 *
 * - IN THE SCENE (full density, wide and laptop) it is HELD: drawn only while a draft stands, the card floating at the center's
 *   foot over the dock (the companion and the talk control), and it arrives from the dock on the spring and settles back into it
 *   when the draft is sent or cleared (`StationArrival`; the shell's held row opens and closes with it, so the work above moves
 *   with it and never jumps). With no draft there is nothing here at all: no line saying where a draft would go.
 * - AT COMPACT DENSITY (the one-column Conversation section) it is the section's: with a draft, the card; without one, one quiet
 *   line in the muted ink ("When Kaylee drafts a brief for a session, it waits here for your Send"), so the section keeps its room
 *   as drafts come and go.
 *
 * THE CARD is the one `CompanionDraftCard`, with every rule it keeps (MAN-9090): your edit saved when the field blurs and before
 * any send; Send steer only while the target works, and then leading, Send turn following; a refused send keeping everything on
 * screen with the server's sentence; Clear asking first. The dock draws its HEAD LINE (`headLine`): the target with Steer's state
 * and the sends with Clear in one row at its head, a refusal under it, the field under all of it; the target's name is a press
 * (`onTargetPress`), "Show <chat> on the stage". Nothing of the brief is drawn twice.
 *
 * THE ROOM: held, at most 36% of the window's height, the card's field giving way inside it; in the section at most 45%
 * of it, its field keeping its 44px catch under a finger, and while you edit the brief the dock stands whole in the frame above the
 * keyboard (`NARROW_FRAME_HOLD`, the section's lifted cap, and `keepFieldFocusInDock` and `keepFieldFocusInDockWhileDisabled`
 * holding that through a press, a disabled Send's included). Under a finger every press of the card is a 44px catch.
 *
 * `data-station-dock` reads the state: `empty`, `session` or `new`. A pure view: `StationDock` below binds it, and the fixtures
 * draw it on their pictures (`fake/dock.ts`).
 */
export function StationDockView({ tier, density, draft, name, targetWorking, onEdit, onSend, onClear, onTargetPress, scrollRef }: StationDockViewProps) {
  const { t } = useTranslation();
  const label = t('station.dock.label', { name, defaultValue: '{{name}}’s draft' });
  const held = density === 'full' && tier !== 'narrow';
  // A flex column with no automatic minimum (which would count the field's whole basis), so the card gives way with the dock:
  // inside the card only the field shrinks, down to nothing under its head line.
  const card = draft === null ? null : (
    <div className="flex min-h-0 flex-col">
      <CompanionDraftCard
        draft={draft}
        name={name}
        targetWorking={targetWorking}
        // The dock is drawn whenever it stands, so the field is always measured.
        visible
        headLine
        onEdit={onEdit}
        onSend={onSend}
        onClear={onClear}
        onTargetPress={draft.target.kind === 'session' ? onTargetPress : undefined}
      />
    </div>
  );

  if (held) {
    return (
      <StationArrival when={draft !== null} from="dock">
        {/* Clear of the work above and of the dock below; the card floats (the scene's one floating shadow). */}
        <div className="px-4 pb-4 pt-3">
          <section
            ref={scrollRef}
            aria-label={label}
            data-station-dock={draft === null ? 'empty' : draft.target.kind}
            onMouseDown={keepFieldFocusInDock}
            onPointerDown={keepFieldFocusInDockWhileDisabled}
            className={cn('mx-auto flex w-full min-w-0 max-w-2xl flex-col [&_[data-companion-draft]]:shadow-[var(--shadow-overlay)]', HELD_CAP)}
          >
            {card}
          </section>
        </div>
      </StationArrival>
    );
  }

  return (
    <section
      ref={scrollRef}
      aria-label={label}
      data-station-dock={draft === null ? 'empty' : draft.target.kind}
      onMouseDown={keepFieldFocusInDock}
      onPointerDown={keepFieldFocusInDockWhileDisabled}
      className={cn('flex min-h-0 min-w-0 flex-[0_1_auto] flex-col overflow-y-auto bg-background px-4 py-3', COMPACT_CAP[tier])}
    >
      {card ?? (
        <EmptyState size="sm" title={t('station.dock.empty', { name, defaultValue: 'When {{name}} drafts a brief for a session, it waits here for your Send.' })} />
      )}
    </section>
  );
}

/**
 * The draft dock on the page, the `dock` slot's region (`stationRegions.ts`), handed the window's tier. It reads the draft and
 * its verbs from the companion's provider, the target's live state from the station's sessions (the rows the left rail draws, never a poll
 * of its own) and the stage's press and the scroll memory from the station, and hands them to `StationDockView`. It reads
 * nothing on a clock: a new draft, a cleared one and the target starting or ending a turn each arrive as her picture's frames
 * and the station's session events.
 */
export function StationDock({ tier, density }: StationRegionProps) {
  const { t } = useTranslation();
  const { picture, editDraft, sendDraft, clearDraft } = useCompanion();
  // Null until the rail's first read answers; the target is then found among its rows by `sessionId`.
  const { sessions } = useStationSessions();
  // The stage the target's press puts the session on, and the dock's place: `scrollMemory('dock')` keeps its identity across renders, so the scroller is bound once.
  const { setFocus, scrollMemory } = useStation();
  const draft = picture?.draft ?? null;
  const name = picture?.settings.name ?? t('companion.defaultName', { defaultValue: 'Kaylee' });
  const targetSession = draft?.target.kind === 'session' ? draft.target.session : null;
  // A turn to steer: the target's row is `working`, or `waiting` (a chat stopped on an ask still holds its run, so a steer folds
  // into it). A new chat's draft, rows not yet read and a target the rows do not hold have no turn.
  const targetState = targetSession === null ? undefined : sessions?.find((row) => row.sessionId === targetSession.sessionId)?.state;
  const targetWorking = targetState === 'working' || targetState === 'waiting';

  return (
    <StationDockView
      tier={tier}
      density={density}
      draft={draft}
      name={name}
      targetWorking={targetWorking}
      onEdit={editDraft}
      // A refused send rejects with the server's sentence, which the card shows under its sends. After a send the server clears
      // the draft (`companion_draft`) and opens the chat on the page holding her floor (`companion_open`), which on the station
      // is the stage: nothing more to do here.
      onSend={async (mode) => { await sendDraft(mode); }}
      onClear={clearDraft}
      // The label is the chat's name, never hers. A new chat's draft has no press (the view hands the card none).
      onTargetPress={() => {
        if (targetSession !== null) setFocus({ kind: 'chat', sessionId: targetSession.sessionId, label: targetSession.name });
      }}
      scrollRef={scrollMemory('dock')}
    />
  );
}
