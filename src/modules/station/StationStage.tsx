import { ArrowLeft, Focus, X } from 'lucide-react';
import { useId } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useStation } from '@/modules/station/context/StationContext';
import { FocusFallback } from '@/modules/station/FocusFallback';
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
  /** The head's actions slot, which the kind's view may fill (a card's pin, say); nothing when absent. */
  actions?: ReactNode;
  /** The body scroller's ref: the station's scroll memory on the page. Absent on a fixture, which remembers nothing. */
  scrollRef?: (node: HTMLElement | null) => void;
};

/** The two presses of the head: 32 px to look at on a desk, a 44 px catch under a finger below 768 px (the touch law). */
const HEAD_PRESS = 'h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground max-md:h-11 max-md:w-11';

/**
 * THE STAGE: the one thing in focus, drawn large ("one focus at a time").
 *
 * WITH A FOCUS, a head and a body. The head says what kind of thing stands here, as its glyph AND its word
 * (`STATION_FOCUS_GLYPHS`: colour and shape are never the whole signal, MAN-578), over its label in the serif at the
 * size a reader finds from across the desk: 24 px, and 22 px below 768 px, the page-title size the bar and Settings'
 * title already use. Back stands to the left while the back-stack holds a focus, and ✕ at the right, which empties the
 * stage; between the label and ✕, the actions slot the kind's view may fill. The body is the kind's view, in a
 * scroller of its own, so a long card scrolls under a head that stays.
 *
 * WITH NONE, a quiet `EmptyState`: "Nothing on the stage", and how to put something there. No head: there is nothing
 * to name, go back from or clear.
 *
 * THE TOUCH LAW. Back and ✕ are 44 px catches under a finger below 768 px. Their tooltips only repeat their names: the
 * press is the thing itself, so a finger, which never opens a tooltip, loses nothing.
 *
 * `data-station-stage` reads `empty` or the focus's kind, and `StationShellView` keys on `empty` to fold an empty
 * stage away where her own regions fill her column. A pure view: `StationStage` below binds it to the station's
 * focus, and `.verify/kaylee-station-shots.mjs` draws it on the fixtures' pictures.
 */
export function StationStageView({ focus, view, canGoBack, onBack, onClear, actions, scrollRef }: StationStageViewProps) {
  const { t } = useTranslation();
  const labelId = useId();

  if (focus === null) {
    return (
      <section
        data-station-stage="empty"
        aria-label={t('station.stage.name', { defaultValue: 'Stage' })}
        className="flex min-h-0 flex-1 flex-col justify-center p-4 lg:p-6"
      >
        <EmptyState
          icon={Focus}
          title={t('station.stage.empty.title', { defaultValue: 'Nothing on the stage' })}
          message={t('station.stage.empty.message', { defaultValue: 'Press anything on either side, or ask her to show you something.' })}
        />
      </section>
    );
  }

  const glyph = STATION_FOCUS_GLYPHS[focus.kind];
  const KindIcon = glyph.icon;
  const backLabel = t('station.stage.back', { defaultValue: 'Back' });
  const clearLabel = t('station.stage.clear', { defaultValue: 'Clear the stage' });

  return (
    <section data-station-stage={focus.kind} aria-labelledby={labelId} className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-3 lg:px-4">
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
          <h2 id={labelId} className="mt-1 break-words font-serif text-[22px] font-normal leading-tight text-foreground md:text-2xl">
            {focus.label}
          </h2>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        <Tooltip content={clearLabel} position="bottom" showOnFocus>
          <Button variant="ghost" size="icon" data-station-stage-clear="" aria-label={clearLabel} className={HEAD_PRESS} onClick={onClear}>
            <X aria-hidden="true" />
          </Button>
        </Tooltip>
      </header>
      {/* Keyed by the thing on the stage, so a different thing starts at the top. */}
      <ScrollArea key={focusKey(focus)} ref={scrollRef} className="min-h-0 flex-1">
        <div className="p-3 lg:p-4">{view}</div>
      </ScrollArea>
    </section>
  );
}

/**
 * The stage on the page: what `StationShell` draws in the stage's place. It reads the focus, the back-stack and the
 * kind's view from the station and hands them to `StationStageView`, which draws every state.
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
      scrollRef={scrollMemory('stage')}
    />
  );
}
