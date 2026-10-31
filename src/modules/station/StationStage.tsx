import { ArrowLeft, Focus, X } from 'lucide-react';
import { useId, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useStation } from '@/modules/station/context/StationContext';
import { FocusFallback } from '@/modules/station/FocusFallback';
import { StageShelf } from '@/modules/station/StageShelf';
import { StageSlotsProvider } from '@/modules/station/stageSlots';
import { focusKey } from '@/modules/station/stationMemory';
import { STAGE_VIEWS } from '@/modules/station/stageViews';
import { STATION_FOCUS_GLYPHS } from '@/shared/constants';
import type { StationFocus } from '@/shared/station-types';
import { Button, EmptyState, ScrollArea, Tooltip } from '@/shared/ui';

type StationStageViewProps = {
  /** The one thing on the stage, or null for an empty stage. */
  focus: StationFocus | null;
  /** The focus's kind drawn: its registered view, else its fallback. Ignored while the stage is empty. */
  view: ReactNode;
  /** Whether the back-stack holds a focus to return to: Back is drawn only then. */
  canGoBack: boolean;
  onBack: () => void;
  /** ✕: the stage emptied. */
  onClear: () => void;
  /**
   * Her cards' shelf (`StageShelf`), drawn above the head, and above the empty stage too, so a pinned card is one press away
   * whatever stands there. It draws nothing while she has no cards. Absent on a fixture that shows none.
   */
  shelf?: ReactNode;
  /** The body scroller's ref: the station's scroll memory on the page. Absent on a fixture, which remembers nothing. */
  scrollRef?: (node: HTMLElement | null) => void;
};

/** The two presses of the head: 32 px to look at on a desk, a 44 px catch under a finger below 768 px (the touch law). */
const HEAD_PRESS = 'h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground max-md:h-11 max-md:w-11';

/**
 * The head's box for the kind's own acts (`StageHeadActions`): a row of its own under the label on a stage under 40rem (a
 * phone, a laptop's stage under her head, the wide tier's stage column at 1440 px), between the label and ✕ on a wider one.
 * The query is the head's own width, so the stage's column decides it and never the window. Out of the layout while empty.
 */
const HEAD_ACTS =
  'order-last flex basis-full flex-wrap items-center gap-2 empty:hidden [@container(min-width:40rem)]:order-none [@container(min-width:40rem)]:basis-auto';

/**
 * The foot's box (`StageFoot`): under the body and outside its scroller, so a long body never scrolls its presses away, at the
 * stage's foot where the thumb is. Its own width is a query container, so what stands in it lays out by the stage's width. Out of
 * the layout while empty.
 */
const FOOT_BOX =
  'shrink-0 border-t border-border bg-background px-3 py-3 [container-type:inline-size] empty:hidden lg:px-4';

/**
 * THE STAGE: the one thing in focus, drawn large ("one focus at a time").
 *
 * WITH A FOCUS, a head and a body. The head says what kind of thing stands here, as its glyph AND its word
 * (`STATION_FOCUS_GLYPHS`: colour and shape are never the whole signal, MAN-578), over its label in the serif at the
 * size a reader finds from across the desk: 24 px, and 22 px below 768 px, the page-title size the bar and Settings'
 * title already use. Back stands to the left while the back-stack holds a focus, and ✕ at the right, which empties the
 * stage. The body is the kind's view, in a scroller of its own, so a long card scrolls under a head that stays.
 *
 * THE KIND'S OWN ACTS AND FOOT. The frame keeps two boxes the kind's view draws into (`stageSlots.tsx`): the head's acts
 * (her card's Pin and Dismiss, her walk's End), between the label and ✕ on a stage 40rem wide or more and on a row of
 * their own under the label on a narrower one; and the foot (her walk's Back and Next), under the body and outside its
 * scroller. Each stays out of the layout while nothing is in it, so a
 * kind with no acts draws the stage exactly as before.
 *
 * HER CARDS' SHELF stands above the head (`shelf`), and above the empty stage too: a pinned card is his keep, and it stays
 * one press away whatever the stage holds. It draws nothing while she has no cards.
 *
 * WITH NONE, a quiet `EmptyState`: "Nothing on the stage", and how to put something there. No head: there is nothing
 * to name, go back from or clear. Where her regions stand beside an empty stage, the shell folds it away, or, while the
 * shelf has cards, keeps the shelf alone (`StationShellView`, `data-station-stage-empty-message`).
 *
 * THE TOUCH LAW. Back and ✕ are 44 px catches under a finger below 768 px. Their tooltips only repeat their names: the
 * press is the thing itself, so a finger, which never opens a tooltip, loses nothing.
 *
 * `data-station-stage` reads `empty` or the focus's kind, and `StationShellView` keys on `empty` to fold an empty
 * stage away where her own regions fill her column. A pure view: `StationStage` below binds it to the station's
 * focus, and `.verify/kaylee-station-shots.mjs` draws it on the fixtures' pictures.
 */
export function StationStageView({ focus, view, canGoBack, onBack, onClear, shelf, scrollRef }: StationStageViewProps) {
  const { t } = useTranslation();
  const labelId = useId();
  // The head's acts box once mounted, which the kind's view portals its own acts into (`StageSlotsProvider`). State and not a
  // ref, because the view can draw into the box only after it exists, so its arrival must draw the view again.
  const [actsBox, setActsBox] = useState<HTMLElement | null>(null);
  // The foot's box once mounted, which the kind's view portals its foot into (Back and Next). State for the same reason.
  const [footBox, setFootBox] = useState<HTMLElement | null>(null);

  if (focus === null) {
    return (
      <section data-station-stage="empty" aria-label={t('station.stage.name', { defaultValue: 'Stage' })} className="flex min-h-0 flex-1 flex-col">
        {shelf}
        <div data-station-stage-empty-message="" className="flex min-h-0 flex-1 flex-col justify-center overflow-hidden p-4 lg:p-6">
          <EmptyState
            icon={Focus}
            title={t('station.stage.empty.title', { defaultValue: 'Nothing on the stage' })}
            message={t('station.stage.empty.message', { defaultValue: 'Press anything on either side, or ask her to show you something.' })}
          />
        </div>
      </section>
    );
  }

  const glyph = STATION_FOCUS_GLYPHS[focus.kind];
  const KindIcon = glyph.icon;
  const backLabel = t('station.stage.back', { defaultValue: 'Back' });
  const clearLabel = t('station.stage.clear', { defaultValue: 'Clear the stage' });

  return (
    <section data-station-stage={focus.kind} aria-labelledby={labelId} className="flex min-h-0 flex-1 flex-col">
      {shelf}
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-3 [container-type:inline-size] lg:px-4">
        {canGoBack && (
          <Tooltip content={backLabel} position="bottom" showOnFocus>
            <Button variant="ghost" size="icon" data-station-stage-back="" aria-label={backLabel} className={HEAD_PRESS} onClick={onBack}>
              <ArrowLeft aria-hidden="true" />
            </Button>
          </Tooltip>
        )}
        <div className="min-w-0 flex-1 px-1">
          <p className="flex min-w-0 items-center gap-1.5 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            <KindIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{t(glyph.wordKey)}</span>
          </p>
          {/* Takes a programmatic focus and no Tab stop: the one-column station hands the keyboard here when a pull to Stage strands it. */}
          <h2
            id={labelId}
            tabIndex={-1}
            data-station-stage-label=""
            className="mt-1 break-words font-serif text-[22px] font-normal leading-tight text-foreground md:text-2xl"
          >
            {focus.label}
          </h2>
        </div>
        <div ref={setActsBox} data-station-stage-actions="" className={HEAD_ACTS} />
        <Tooltip content={clearLabel} position="bottom" showOnFocus>
          <Button variant="ghost" size="icon" data-station-stage-clear="" aria-label={clearLabel} className={HEAD_PRESS} onClick={onClear}>
            <X aria-hidden="true" />
          </Button>
        </Tooltip>
      </header>
      {/* Keyed by the thing on the stage, so a different thing starts at the top. */}
      <ScrollArea key={focusKey(focus)} ref={scrollRef} data-station-stage-body="" className="min-h-0 flex-1">
        <div className="p-3 lg:p-4">
          <StageSlotsProvider actions={actsBox} foot={footBox}>{view}</StageSlotsProvider>
        </div>
      </ScrollArea>
      <div ref={setFootBox} data-station-stage-foot="" className={FOOT_BOX} />
    </section>
  );
}

/**
 * The stage on the page: what `StationShell` draws in the stage's place. It reads the focus, the back-stack and the
 * kind's view from the station and hands them to `StationStageView`, which draws every state, with her cards' shelf above.
 *
 * IT NEVER BRINGS ITSELF INTO VIEW: in the one-column arrangement the stage is a section, and a different thing put on it
 * pulls the switch to it (`useStationSection`, once, for every region's press); in the columns it is always on screen.
 */
export function StationStage() {
  const { focus, canGoBack, setFocus, back, scrollMemory } = useStation();
  // The registry keys each component to the kind it takes, so the one looked up by `focus.kind` takes this `focus`.
  const View = focus === null ? undefined : (STAGE_VIEWS[focus.kind] as ComponentType<{ focus: StationFocus }> | undefined);
  // Keyed by the thing, so a different thing in the same kind starts its view afresh, state and all.
  const view = focus === null ? null : View === undefined ? <FocusFallback key={focusKey(focus)} focus={focus} /> : <View key={focusKey(focus)} focus={focus} />;

  return (
    <StationStageView
      focus={focus}
      view={view}
      canGoBack={canGoBack}
      onBack={back}
      onClear={() => setFocus(null)}
      shelf={<StageShelf />}
      scrollRef={scrollMemory('stage')}
    />
  );
}
