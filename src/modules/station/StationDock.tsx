import { useCallback, useRef } from 'react';
import type { ComponentProps, MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { CompanionDraftCard, useCompanion } from '@/modules/companion';
import { useStation } from '@/modules/station/context/StationContext';
import { useStationSessions } from '@/modules/station/context/StationSessionsContext';
import { useDockFloor } from '@/modules/station/hooks/useDockFloor';
import type { CompanionDraft } from '@/shared/companion-types';
import type { StationDensity, StationRegionProps, StationTier } from '@/shared/types';
import { EmptyState } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** The card's own verbs, as it types them: the dock hands them through untouched. */
type DraftCardProps = ComponentProps<typeof CompanionDraftCard>;

type StationDockViewProps = {
  /**
   * The window's tier. In the columns the dock takes at most 45% of her column wide and 40% on a laptop (`DOCK_CAP`); at the
   * `narrow` tier (compact's Conversation section) it holds itself to the frame that ends above the on-screen keyboard
   * (`NARROW_FRAME_HOLD`).
   */
  tier: StationTier;
  /** Taken and passed by every region; the dock draws the same at both, on the width it is given. */
  density: StationDensity;
  /** Her draft as her picture holds it, or null while she holds none: the dock is then its one quiet line. */
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

/**
 * The dock's cap in the columns: at most 45% of her column on a wide screen and 40% on a laptop, where the stage beside her
 * takes up to 55%. Written in `cqh` of her column (the shell makes it a size container), because the dock's slot is sized by
 * her column's budget (the shell's slot box: the card's head line as its basis, growing to its words) and can carry no share
 * of its own.
 */
const DOCK_CAP: Record<StationTier, string> = { wide: 'max-h-[45cqh]', laptop: 'max-h-[40cqh]', narrow: NARROW_FRAME_HOLD };

/**
 * Keeps the field's focus through a press on one of the card's buttons, so the on-screen keyboard stays up and the dock keeps
 * the room the section lifted its cap to (`has-[textarea:focus]`) until the press lands. WebKit gives a tapped button no focus
 * and blurs the field on the tap's mousedown: the dock fell back to its cap mid-tap, and the release went to whatever stood
 * there next, so his first Send on an iPhone was lost. A press that takes the focus itself
 * (Clear's question) still takes it; the send still saves his edit first.
 */
function keepFieldFocus(event: MouseEvent<HTMLElement>) {
  const focused = event.currentTarget.ownerDocument.activeElement;
  const pressed = (event.target as Element).closest('button');
  if (pressed !== null && focused?.tagName === 'TEXTAREA' && event.currentTarget.contains(focused)) event.preventDefault();
}

/**
 * THE DRAFT DOCK: her one draft, at the foot of her column, under her conversation and over the talk control (the shell's
 * `dock` slot), so the brief she composes for a chat is where his eyes and his Send are.
 *
 * - WITH A DRAFT it draws the one `CompanionDraftCard`, with every rule the card keeps (MAN-9090): his edit saved when the field
 *   blurs and before any send; Send steer only while the target works, and then leading, Send turn following; a refused send
 *   keeping everything on screen with the server's sentence; Clear asking first. Here the card draws its HEAD LINE
 *   (`headLine`): the target with Steer's state and the sends with Clear in one row at its head (the sends wrapping under the
 *   target where the dock is too narrow for both), a refusal under it, the field under all of it. And the target's name is a
 *   press (`onTargetPress`): "Show <chat> on the stage". Nothing of the brief is drawn twice.
 * - WITHOUT ONE it is one quiet line in the muted ink (kit `EmptyState` at `sm`): "When she drafts a brief for a session, it
 *   waits here for your Send." It never folds to nothing, so the place keeps its room as drafts come and go.
 *
 * THE ROOM: at most 45% of her column on a wide screen and 40% on a laptop (`DOCK_CAP`), within her column's one budget (the
 * shell's slot box): the card's field gives way first, down to nothing (below one line it steps aside whole), while its head
 * line stands — the dock never goes under
 * it, so his sends are always in sight — then her conversation from its share down to its own floor (3.5rem), then on a laptop
 * the stage. The budget reads the head line as the card measures it (`useCardFloor`; `useDockFloor` hands it to the slot), and
 * while the field holds the focus the slot gives it its 88px back. In the one-column sections the dock stands up to 45% of the
 * section, its field keeping its 44px catch there under a finger (the dock scrolls it), and while he types to her with the keys
 * up it draws its head line alone (`StationSections`). Under a finger every
 * press of the card is a 44px catch (the card's own: its sends, Clear and the target's press), the words stay in the field,
 * never behind a hover, and while he edits the brief the dock stands whole in the frame above the keyboard
 * (`NARROW_FRAME_HOLD`, the section's lifted cap, and `keepFieldFocus` holding that through a press).
 *
 * `data-station-dock` reads the state: `empty`, `session` or `new`. A pure view: `StationDock` below binds it, and
 * `.verify/kaylee-station-shots.mjs` draws it on the fixtures' pictures (`fake/dock.ts`).
 */
export function StationDockView({ tier, draft, name, targetWorking, onEdit, onSend, onClear, onTargetPress, scrollRef }: StationDockViewProps) {
  const { t } = useTranslation();
  // The dock's own node, for the floor its card measures; the station's scroll memory is handed the same node. Stable, so the
  // memory's binder is not let go and taken again on every render.
  const sectionRef = useRef<HTMLElement | null>(null);
  const bindSection = useCallback((node: HTMLElement | null) => {
    sectionRef.current = node;
    scrollRef?.(node);
  }, [scrollRef]);
  useDockFloor(sectionRef, draft !== null);

  return (
    <section
      ref={bindSection}
      aria-label={t('station.dock.label', { name, defaultValue: '{{name}}’s draft' })}
      data-station-dock={draft === null ? 'empty' : draft.target.kind}
      onMouseDown={keepFieldFocus}
      className={cn('flex min-h-0 min-w-0 flex-[0_1_auto] flex-col overflow-y-auto bg-background px-4 py-3', DOCK_CAP[tier])}
    >
      {draft === null ? (
        <EmptyState size="sm" title={t('station.dock.empty', { defaultValue: 'When she drafts a brief for a session, it waits here for your Send.' })} />
      ) : (
        // A flex column with no automatic minimum (which would count the field's whole basis), so the card gives way with the
        // dock: inside the card only the field shrinks, down to nothing under its head line.
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
      )}
    </section>
  );
}

/**
 * Her draft dock on the page, the `dock` slot's region (`stationRegions.ts`), handed the window's tier. It reads her draft and
 * its verbs from her provider, the target's live state from the station's sessions (the rows the left rail draws, never a poll
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
