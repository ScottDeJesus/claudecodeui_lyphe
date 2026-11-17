import { Ear, EarOff, MessageSquare, SlidersHorizontal } from 'lucide-react';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CompanionControls, CompanionFace, CompanionStatus, CompanionStopButton, useCompanion, useCompanionPresence } from '@/modules/companion';
import { useStationSessions } from '@/modules/station/context/StationSessionsContext';
import { useNeedsCount } from '@/modules/station/context/StationNeedsContext';
import { StationArrival } from '@/modules/station/StationArrival';
import { StationConversationView } from '@/modules/station/StationConversation';
import { StationPortraitWords } from '@/modules/station/StationPortrait';
import { useStation } from '@/modules/station/context/StationContext';
import { openHome } from '@/shared/cloudcliDoors';
import type { CompanionLogEntry, CompanionPicture } from '@/shared/companion-types';
import { useStationDoors } from '@/shared/context/StationLayerContext';
import type { CompanionEars, CompanionPresence, CompanionSentenceRef } from '@/shared/types';
import { Button, buttonVariants, Menu, Sheet } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** The square the companion's core is drawn in on the scene, in px: twice a chat's own core. */
const CORE_PX = 120;

/** The most the controls' panel takes (`StationHead`'s own figure): two lines of the controls' line. */
const CONTROLS_PANEL_PX = 380;

const EYEBROW = 'font-mono text-[10px] font-medium uppercase leading-[14px] tracking-[0.18em] text-muted-foreground';

/** The one press's size by the name: 32 px to look at on a desk, a 44 px catch under a finger. */
const NAME_PRESS = 'size-8 shrink-0 finger:size-11';

type StationKayleeViewProps = {
  /**
   * Where the column stands on the scene. `beside`: at rest, at the foot of the room the roadmap stands in, the core at the start
   * with the lines beside it. `under`: with a thing on the panel, the companion's own column at the start, the lines under the core.
   */
  form: 'beside' | 'under';
  /** The companion's name as you set it, the default while its picture loads. */
  name: string;
  /** What the companion is doing on this page (`useCompanionPresence`): the status line reads it, as the core does. */
  presence: CompanionPresence;
  /** The core at the square it is drawn in, in px: `CompanionFace` on the page, `CompanionAvatar` on a fixture's presence. */
  face: (px: number) => ReactNode;
  /** The core, pressed: the way back to the sessions home. */
  onHome: () => void;
  /** The companion's picture, or null while it loads or its read has failed: the lines then draw nothing. */
  picture: CompanionPicture | null;
  /** The sentence this page's player is sounding, marked in the answer; null when none is. */
  speaking: CompanionSentenceRef | null;
  /** The controls' line (`CompanionControls`, `layout: 'line'`), drawn inside the panel behind its press. */
  controls: ReactNode;
  /** Stop, while a turn runs (`CompanionStopButton`), beside the name because the controls stand behind a press; null while none runs. */
  stop: ReactNode;
  /** This page's ears: the press by the name switches them, and is lit while they listen. */
  ears: CompanionEars;
  /** While the companion's process has failed, its sentence; null while it runs. */
  failedSentence: string | null;
  /** How many chats are working now, and how many things wait on you; null until each has been read. */
  running: number | null;
  waiting: number | null;
  /** The whole conversation, drawn in the sheet the chat press opens. */
  transcript: ReactNode;
};

/** The last line that was yours, whichever way it was given; null before the first. */
function lastOfYours(log: CompanionLogEntry[]): CompanionLogEntry | null {
  for (let at = log.length - 1; at >= 0; at -= 1) {
    if (log[at].role === 'operator') return log[at];
  }
  return null;
}

/** A stamp as the clock's hour and minute, or nothing for a stamp that is not a time. */
function clockOf(stamp: string): string {
  const at = new Date(stamp);
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * THE COMPANION ON THE STATION'S SCENE: the core, the name with its few presses, and two lines. It is what the station is for and
 * the one thing that is always there; everything else on the scene is the panel, the roadmap and the box to type in.
 *
 * - THE CORE is the companion's own drawing at 120 px, live as everywhere. It is a press: the way back to the sessions home.
 * - BY THE NAME, three presses, each a mark: the conversation, which opens the whole log in a sheet from the start side (it is not
 *   on the scene: the last line each way is what is usually wanted); the ears, lit while they listen for the name; and the
 *   controls (the model, Live, the voice, Clear), the kit `Menu` whose panel holds `CompanionControls`' line, without the ears' switch. Stop stands beside
 *   them while a turn runs, never behind a press. After them, how many chats are running and how many things wait on you, in
 *   words, once each has been read: a count, not a list.
 * - THE STATE, in words (`CompanionStatus`), and a failed process's sentence under it in the warn ink.
 * - TWO LINES. Yours, the last, as it was taken, with how it was given and when: enough to see a spoken line was heard right.
 *   Then the companion's latest answer as it is said (`StationPortraitWords`: the sentence being spoken on its band, the dots
 *   while one is on its way).
 *
 * TWO FORMS, one tree. `beside`: the core at the start and everything else beside it, on a measure the box to type in shares,
 * so the two read as one column in the middle of the screen. `under`: the core over the name, the lines under them, in the
 * middle of the companion's own column while the panel has the rest of the screen; a long answer scrolls inside its pane.
 *
 * `data-station-kaylee` reads the form. A pure view: `StationKaylee` below binds it.
 */
export function StationKayleeView({
  form, name, presence, face, onHome, picture, speaking, controls, stop, ears, failedSentence, running, waiting, transcript,
}: StationKayleeViewProps) {
  const { t } = useTranslation();
  const nameId = useId();
  // Whether the whole conversation's sheet is open. The press by the name opens it; the sheet's own ways out close it.
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const beside = form === 'beside';
  const yours = picture === null ? null : lastOfYours(picture.log);
  const controlsLabel = t('station.head.controls', { defaultValue: 'Controls' });
  const transcriptLabel = t('companion.log.label', { name });
  const earsLabel = t(ears.on ? 'station.kaylee.earsOn' : 'station.kaylee.earsOff', { name });
  const counts = [
    running !== null && running > 0 ? t('station.kaylee.running', { count: running }) : null,
    waiting !== null && waiting > 0 ? t('station.kaylee.waiting', { count: waiting }) : null,
  ].filter(Boolean).join(' · ');

  return (
    <section
      data-station-kaylee={form}
      aria-labelledby={nameId}
      className={cn('flex min-w-0', beside ? 'mx-auto w-full max-w-[720px] items-center gap-5 px-3 py-3' : 'min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 pb-4')}
    >
      <button
        type="button"
        data-station-kaylee-core=""
        aria-label={t('station.kaylee.home')}
        title={t('station.kaylee.home')}
        onClick={onHome}
        className="relative grid shrink-0 place-items-center rounded-full outline-none transition-transform hover:scale-[1.03] focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
        style={{ width: CORE_PX, height: CORE_PX }}
      >
        {face(CORE_PX)}
      </button>

      <div className={cn('flex min-w-0 flex-col gap-2', beside ? 'flex-1 items-start' : 'min-h-0 w-full items-center text-center')}>
        {yours !== null && (
          <div data-station-kaylee-yours="" className={cn('flex min-w-0 max-w-full flex-col', beside ? 'items-start' : 'items-center')}>
            <p className="max-w-full truncate text-sm text-foreground">{yours.text === '' ? t('companion.log.nothingHeard') : `“${yours.text}”`}</p>
            <p className={EYEBROW}>
              {[t('companion.log.you'), yours.via === null ? null : t(yours.via === 'spoken' ? 'companion.log.spoken' : 'companion.log.typed'), clockOf(yours.at)].filter(Boolean).join(' · ')}
            </p>
          </div>
        )}

        <div className={cn('flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-1.5', !beside && 'justify-center')}>
          <h2 id={nameId} data-station-kaylee-name="" className={cn(EYEBROW, 'text-foreground')}>{name}</h2>
          <div className="flex items-center gap-1.5">
            <Button
              data-station-kaylee-transcript=""
              variant="outline"
              size="icon"
              className={NAME_PRESS}
              aria-label={transcriptLabel}
              title={transcriptLabel}
              onClick={() => setTranscriptOpen(true)}
            >
              <MessageSquare aria-hidden="true" />
            </Button>
            <Button
              data-station-kaylee-ears={ears.state}
              variant={ears.on ? 'tonal' : 'outline'}
              size="icon"
              className={NAME_PRESS}
              aria-pressed={ears.on}
              aria-label={earsLabel}
              title={ears.reason ?? earsLabel}
              onClick={() => ears.setOn(!ears.on)}
            >
              {ears.on ? <Ear aria-hidden="true" /> : <EarOff aria-hidden="true" />}
            </Button>
            <Menu
              width={CONTROLS_PANEL_PX}
              label={controlsLabel}
              panel={controls}
              trigger={(
                <span data-station-kaylee-controls="" title={controlsLabel} className={cn(buttonVariants({ variant: 'outline', size: 'icon' }), NAME_PRESS)}>
                  <SlidersHorizontal aria-hidden="true" />
                  <span className="sr-only">{controlsLabel}</span>
                </span>
              )}
            />
            <StationArrival when={stop !== null} from="dock" className="shrink-0">{stop}</StationArrival>
          </div>
          {counts !== '' && <span data-station-kaylee-counts="" className="font-mono text-[11px] leading-4 text-muted-foreground">{counts}</span>}
        </div>

        <div className={cn('flex min-w-0 max-w-full flex-col', beside ? 'items-start' : 'items-center')}>
          <CompanionStatus presence={presence} emphasis="station" />
          {failedSentence !== null && (
            <p data-station-kaylee-failed="" data-tone="warn" title={failedSentence} className="flex min-w-0 items-start gap-1.5 text-xs leading-snug text-tone-ink">
              <span aria-hidden="true">▲</span>
              <span className="line-clamp-2 min-w-0 break-words">{failedSentence}</span>
            </p>
          )}
        </div>

        {picture !== null && (
          <StationPortraitWords
            picture={picture}
            name={name}
            speaking={speaking}
            align={beside ? 'start' : 'center'}
            quietEmpty
            className={beside ? 'max-h-[7.5rem] w-full' : 'w-full'}
          />
        )}
      </div>

      <Sheet side="left" flush open={transcriptOpen} onClose={() => setTranscriptOpen(false)} title={transcriptLabel} width="min(520px, 100%)">
        <div data-station-kaylee-transcript-sheet="" className="flex h-full min-h-0 flex-col">{transcript}</div>
      </Sheet>
    </section>
  );
}

/**
 * The companion on the scene, on the page: it hands `StationKayleeView` the core bound to this page's provider, the presence, the
 * picture and the voice, the controls bound to the provider's verbs, Stop while a turn runs, the ears, the two counts (the chats
 * the station holds as working, and what needs you by the station's one rule, `useNeedsCount`), the whole conversation for its
 * sheet, and the way home. It adds no state of the companion's.
 *
 * Drawn by `StationShell`, in the scene (wide and laptop), in the form the stage's focus gives it.
 */
export function StationKaylee({ form }: { form: 'beside' | 'under' }) {
  const { t } = useTranslation();
  const { picture, readFailure, reread, voice, ears, saveSettings, interrupt, clear } = useCompanion();
  const presence = useCompanionPresence();
  const { sessions } = useStationSessions();
  const waiting = useNeedsCount();
  const { setFocus, scrollMemory } = useStation();
  const doors = useStationDoors();
  const name = picture?.settings.name ?? t('companion.defaultName', { defaultValue: 'Kaylee' });
  const turnRunning = picture?.turnId != null;

  return (
    <StationKayleeView
      form={form}
      name={name}
      presence={presence}
      face={(px) => <CompanionFace size={px} />}
      onHome={() => openHome(doors.navigate)}
      picture={picture}
      speaking={voice.speaking}
      controls={(
        <CompanionControls
          name={name}
          picture={picture}
          layout="line"
          align="start"
          stopOutside
          voice={voice}
          // The ears are the press by the name, so the panel carries no second switch for them.
          onModelChange={(model) => saveSettings({ model })}
          onLiveChange={(live) => saveSettings({ live })}
          onInterrupt={interrupt}
          onClear={clear}
        />
      )}
      stop={turnRunning ? <CompanionStopButton name={name} onInterrupt={interrupt} /> : null}
      ears={ears}
      failedSentence={picture?.process.state === 'failed' ? (picture.process.error ?? t('companion.panel.failedUnknown', { name })) : null}
      running={sessions === null ? null : sessions.filter((row) => row.state === 'working').length}
      waiting={waiting}
      transcript={(
        <StationConversationView
          density="full"
          picture={picture}
          readFailure={readFailure}
          onReread={reread}
          name={name}
          speaking={voice.speaking}
          // A card pressed in the conversation goes on the panel, as it does from the conversation's own region.
          onOpenCard={(note) => setFocus({ kind: 'note', id: note.id, label: note.title })}
          scrollRef={scrollMemory('conversation')}
        />
      )}
    />
  );
}
