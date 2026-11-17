import { Ear, EarOff, MessageSquare, SlidersHorizontal, Volume2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { AccountWeekRing } from '@/modules/accounts';
import { CompanionControls, CompanionFace, CompanionStatus, CompanionStopButton, useCompanion, useCompanionPresence } from '@/modules/companion';
import { SessionsHalo } from '@/modules/sidebar';
import { useStationSessions } from '@/modules/station/context/StationSessionsContext';
import { useNeedsCount } from '@/modules/station/context/StationNeedsContext';
import { StationArrival } from '@/modules/station/StationArrival';
import { StationConversationView } from '@/modules/station/StationConversation';
import { StationPortraitWords } from '@/modules/station/StationPortrait';
import { useStation } from '@/modules/station/context/StationContext';
import type { CompanionLogEntry, CompanionPicture } from '@/shared/companion-types';
import { useStationDoors } from '@/shared/context/StationLayerContext';
import type { CompanionEars, CompanionPresence, CompanionSentenceRef } from '@/shared/types';
import { Button, buttonVariants, Menu, Sheet } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** The square the companion's core is drawn in, in px: in the halo's middle, and alone as the mark at the head of one column. */
const CORE_PX: Record<StationKayleeForm, number> = { beside: 64, under: 64, mark: 48 };

/** How far outside the core's edge the account's week is drawn, in px. */
const WEEK_GAP = 4;

/** How long the core keeps its pointer on the panel after the companion places a thing there, in ms: as long as its mark stands. */
const PLACING_LOOK_MS = 1900;

/**
 * Where the companion stands on the scene. `beside`: at rest, at the foot of the room the roadmap stands in, the halo at the start with the
 * lines beside it. `under`: the halo over the lines, in the companion's own column while a thing is on the panel (and, on a phone held
 * upright, in the middle of the screen while nothing is). `mark`: one column with a thing on the panel, the core alone at the head with the
 * lines beside it, so the panel has the screen.
 */
export type StationKayleeForm = 'beside' | 'under' | 'mark';

/** The most the controls' panel takes: two lines of the controls' line. */
const CONTROLS_PANEL_PX = 380;

const EYEBROW = 'font-mono text-[10px] font-medium uppercase leading-[14px] tracking-[0.18em] text-muted-foreground';

/** The one press's size by the name: 32 px to look at on a desk, a 44 px catch under a finger. */
const NAME_PRESS = 'size-8 shrink-0 finger:size-11';

type StationKayleeViewProps = {
  /** Where the companion stands on the scene (`StationKayleeForm`). */
  form: StationKayleeForm;
  /**
   * The halo, drawn round the core it is handed (`SessionsHalo` on the page): the chats as a hoop, the core in its middle. Not asked for in
   * `mark`, where the core stands alone.
   */
  halo: (core: ReactNode) => ReactNode;
  /** The companion's name as you set it, the default while its picture loads. */
  name: string;
  /** What the companion is doing on this page (`useCompanionPresence`): the status line reads it, as the core does. */
  presence: CompanionPresence;
  /** The core at the square it is drawn in, in px: `CompanionFace` on the page, `CompanionAvatar` on a fixture's presence. */
  face: (px: number) => ReactNode;
  /** The core, pressed: the way back to the sessions home. */
  onHome: () => void;
  /**
   * The account's week as a ring round the core, at the radius it is given in px (`AccountWeekRing` on the page): its band opens the
   * account switcher. Absent on a fixture, which draws the core alone.
   */
  week?: (radius: number) => ReactNode;
  /**
   * Which way the core is turned while the companion has just put a thing on the panel: the panel's bearing from the core in
   * degrees (0 to the end side, clockwise), drawn as a pointer just outside the core for as long as the panel wears the companion's
   * mark. Null, or absent on a fixture, at every other moment.
   */
  turnedTo?: number | null;
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
  /** Says the latest answer again; null while there is none to say, a turn runs, or this device's voice is off (the press is then drawn disabled). */
  onSayAgain: (() => void) | null;
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
 * THE COMPANION ON THE STATION'S SCENE: the core in its halo, the name with its few presses, and two lines. It is what the station is for
 * and the one thing that is always there; everything else on the scene is the panel, the roadmap and the box to type in.
 *
 * - THE CORE is the companion's own drawing, live as everywhere. It is a press: the way back to the sessions home. Round it stands THE
 *   HALO (`halo`), every chat a slot on a hoop; the slot at the front is read out under it, and pressed, opens its chat.
 * - BY THE NAME, four presses, each a mark: the conversation, which opens the whole log in a sheet (it is not on the scene: the last
 *   line each way is what is usually wanted); the speaker, which says the latest answer again, for a reader who was out of the room;
 *   the ears, lit while they listen for the name; and the controls (the model, Live, the voice, Clear), the kit `Menu` whose panel
 *   holds `CompanionControls`' line, without the ears' switch. Stop stands beside them while a turn runs, never behind a press. After
 *   them, how many chats are running and how many things wait on you, in words, once each has been read: a count, not a list.
 * - THE STATE, in words (`CompanionStatus`: Listening and Transcribing while you talk), and a failed process's sentence under it in
 *   the warn ink.
 * - TWO LINES. Yours, the last, as it was taken, with how it was given and when: enough to see a spoken line was heard right.
 *   Then the companion's latest answer as it is said (`StationPortraitWords`: the sentence being spoken on its band, the dots
 *   while one is on its way).
 *
 * THREE FORMS, one tree (`StationKayleeForm`). `beside`: the halo at the start and everything else beside it, on a measure the box to
 * type in shares, so the two read as one column in the middle of the screen. `under`: the halo over the name and the lines, centred. A
 * long answer scrolls inside its pane. `mark`: the core alone, small, with the presses beside it, the state and the last line heard on
 * one line under them, and the answer held to two lines: the least of the companion that still says what it is doing.
 *
 * `data-station-kaylee` reads the form. A pure view: `StationKaylee` below binds it.
 */
export function StationKayleeView({
  form, halo, name, presence, face, onHome, week, turnedTo = null, picture, speaking, controls, stop, ears, onSayAgain, failedSentence, running, waiting, transcript,
}: StationKayleeViewProps) {
  const { t } = useTranslation();
  const nameId = useId();
  // Whether the whole conversation's sheet is open. The press by the name opens it; the sheet's own ways out close it.
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const under = form === 'under';
  const mark = form === 'mark';
  const yours = picture === null ? null : lastOfYours(picture.log);
  const yoursWords = yours === null ? '' : yours.text === '' ? t('companion.log.nothingHeard') : `“${yours.text}”`;
  const controlsLabel = t('station.head.controls', { defaultValue: 'Controls' });
  const transcriptLabel = t('companion.log.label', { name });
  const earsLabel = t(ears.on ? 'station.kaylee.earsOn' : 'station.kaylee.earsOff', { name });
  const againLabel = t('station.kaylee.again');
  const counts = [
    running !== null && running > 0 ? t('station.kaylee.running', { count: running }) : null,
    waiting !== null && waiting > 0 ? t('station.kaylee.waiting', { count: waiting }) : null,
  ].filter(Boolean).join(' · ');
  const core = (
    // The core's own box: the account's week is centred on it, under the core's press, so only the band outside the core reaches it.
    <span className="relative grid shrink-0 place-items-center" style={{ width: CORE_PX[form], height: CORE_PX[form] }}>
      {week?.(CORE_PX[form] / 2 + WEEK_GAP)}
      {turnedTo !== null && (
        // The instrument's own pointer, drawn outside the core's square, where a core this small has no room for it.
        <span
          aria-hidden="true"
          data-station-kaylee-turn={Math.round(turnedTo)}
          className="station-turn"
          style={{ transform: `rotate(${turnedTo}deg) translateX(${CORE_PX[form] / 2 + 13}px)` }}
        />
      )}
      <button
        type="button"
        data-station-kaylee-core=""
        aria-label={t('station.kaylee.home')}
        title={t('station.kaylee.home')}
        onClick={onHome}
        className="relative grid size-full place-items-center rounded-full outline-none transition-transform hover:scale-[1.04] focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
      >
        {face(CORE_PX[form])}
      </button>
    </span>
  );

  return (
    <section
      data-station-kaylee={form}
      aria-labelledby={nameId}
      className={cn(
        'flex min-w-0',
        form === 'beside' && 'mx-auto w-full max-w-[720px] items-center gap-4 px-3 py-2',
        under && 'min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 pb-3',
        mark && 'mx-auto w-full max-w-[720px] items-start gap-3 px-3 py-2',
      )}
    >
      {mark ? core : halo(core)}

      <div className={cn('flex min-w-0 flex-col gap-1.5', under ? 'min-h-0 w-full items-center text-center' : 'flex-1 items-start')}>
        {yours !== null && !mark && (
          <div data-station-kaylee-yours="" className={cn('flex min-w-0 max-w-full flex-col', under ? 'items-center' : 'items-start')}>
            <p className="max-w-full truncate text-sm text-foreground">{yoursWords}</p>
            <p className={EYEBROW}>
              {[t('companion.log.you'), yours.via === null ? null : t(yours.via === 'spoken' ? 'companion.log.spoken' : 'companion.log.typed'), clockOf(yours.at)].filter(Boolean).join(' · ')}
            </p>
          </div>
        )}

        <div className={cn('flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-1.5', under && 'justify-center')}>
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
              data-station-kaylee-again=""
              variant="outline"
              size="icon"
              className={NAME_PRESS}
              aria-label={againLabel}
              title={againLabel}
              disabled={onSayAgain === null}
              onClick={() => onSayAgain?.()}
            >
              <Volume2 aria-hidden="true" />
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
          {counts !== '' && !mark && <span data-station-kaylee-counts="" className="font-mono text-[11px] leading-4 text-muted-foreground">{counts}</span>}
        </div>

        <div className={cn('flex min-w-0 max-w-full', mark ? 'items-baseline gap-2' : 'flex-col', under ? 'items-center' : !mark && 'items-start')}>
          <CompanionStatus presence={presence} emphasis={mark ? 'panel' : 'station'} />
          {/* The mark is one line where the other forms have two: the state, then what was last heard, in the room that is left. */}
          {mark && yours !== null && <p data-station-kaylee-yours="" className="min-w-0 truncate text-sm text-muted-foreground">{yoursWords}</p>}
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
            align={under ? 'center' : 'start'}
            quietEmpty
            className={cn('w-full', form === 'beside' && 'max-h-[7.5rem]', mark && 'max-h-[3rem]')}
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
 * The companion on the scene, on the page: it hands `StationKayleeView` the core bound to this page's provider, the halo round it
 * (`SessionsHalo`, the simple chat list as a hoop: a chat pressed at its front opens in the workspace), the presence, the picture and
 * the voice, the controls bound to the provider's verbs, Stop while a turn runs, the ears, the speaker's press, the two counts (the
 * chats the station holds as working, and what needs you by the station's one rule, `useNeedsCount`), the whole conversation for its
 * sheet, and the way home (`onHome`, the shell's, which takes the roadmap along). It adds no state of the companion's.
 *
 * WHEN THE COMPANION PUTS A THING ON THE PANEL ITSELF (`useStation().placed`), the core turns its pointer to the panel for as long as
 * the panel wears the companion's mark, then lets go. A thing you put there turns nothing.
 *
 * THE CORE'S DEALINGS WITH A CHAT are the picture's own (`picture.activity`): while the companion reads a chat the halo draws a bead
 * coming in from that chat's slot, and while it drafts for one, a bead going out to it.
 *
 * Drawn by `StationShell`, in the scene, in the form and at the halo's width the arrangement gives it.
 */
export function StationKaylee({ form, haloWidth, onHome }: { form: StationKayleeForm; haloWidth: number; onHome: () => void }) {
  const { t } = useTranslation();
  const { picture, readFailure, reread, voice, sayAgain, ears, saveSettings, interrupt, clear } = useCompanion();
  const presence = useCompanionPresence();
  const { sessions } = useStationSessions();
  const waiting = useNeedsCount();
  const { setFocus, scrollMemory, placed } = useStation();
  const doors = useStationDoors();
  // The panel's bearing from the core, in degrees, while the companion has just placed a thing on it: the core's pointer stands
  // there for as long as its mark does (`PLACING_LOOK_MS`), then lets go. State, because the view draws from it; null otherwise.
  const [turnedTo, setTurnedTo] = useState<number | null>(null);
  const placings = placed?.count ?? 0;
  // The placings this page had seen as the station mounted: only a later one turns the core.
  const [seenAtMount] = useState(placings);
  useEffect(() => {
    if (placings <= seenAtMount) return undefined;
    let done = 0;
    // Measured on the next frame, once the panel and the companion's column stand where the placing put them: the panel's middle
    // from the core's.
    const frame = window.requestAnimationFrame(() => {
      const core = document.querySelector('[data-station-kaylee-core]')?.getBoundingClientRect();
      const panel = document.querySelector('[data-station-stage-cell]')?.getBoundingClientRect();
      if (!core || !panel || panel.width === 0) return;
      const dx = panel.left + panel.width / 2 - (core.left + core.width / 2);
      const dy = panel.top + panel.height / 2 - (core.top + core.height / 2);
      setTurnedTo((Math.atan2(dy, dx) * 180) / Math.PI);
      done = window.setTimeout(() => setTurnedTo(null), PLACING_LOOK_MS);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(done);
    };
  }, [placings, seenAtMount]);
  const name = picture?.settings.name ?? t('companion.defaultName', { defaultValue: 'Kaylee' });
  const turnRunning = picture?.turnId != null;
  const answered = picture !== null && picture.log.some((entry) => entry.role === 'kaylee' && entry.turnId !== null && entry.index !== null);
  const activity = picture?.activity ?? null;
  const dealt = activity === null || activity.session === null ? null
    : activity.phase === 'reading_session' ? { id: activity.session.sessionId, way: 'in' as const }
      : activity.phase === 'drafting' ? { id: activity.session.sessionId, way: 'out' as const }
        : null;

  return (
    <StationKayleeView
      form={form}
      halo={(core) => (
        <SessionsHalo
          enabled
          width={haloWidth}
          // A halo standing small, over the lines, writes no folder's name round itself.
          names={form === 'beside'}
          reading
          link={dealt}
          coreRadius={CORE_PX[form] / 2}
          onOpenChat={(sessionId) => doors.openChatInWorkspace(sessionId)}
        >
          {core}
        </SessionsHalo>
      )}
      name={name}
      presence={presence}
      face={(px) => <CompanionFace size={px} />}
      onHome={onHome}
      turnedTo={turnedTo}
      week={(radius) => <AccountWeekRing radius={radius} />}
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
      onSayAgain={answered && !turnRunning && voice.on && voice.speaking === null ? sayAgain : null}
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
