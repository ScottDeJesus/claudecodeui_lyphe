import { CloudOff, Rss, Settings, Telescope } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CandidateOpening } from '@/modules/rnd/CandidateOpening';
import { CandidateRow } from '@/modules/rnd/CandidateRow';
import { RejectDialog } from '@/modules/rnd/RejectDialog';
import { RndSettingsSheet } from '@/modules/rnd/RndSettingsSheet';
import type { RndLaunchKind } from '@/modules/rnd/RndSettingsSheet';
import { OPENING_BESIDE_PX, RND_VIEWS, countOf, rowsOf, scoutLine } from '@/modules/rnd/rndWords';
import type { RndView } from '@/modules/rnd/rndWords';
import { useRnd } from '@/modules/rnd/hooks/useRnd';
import { useRndLaunch } from '@/modules/rnd/hooks/useRndLaunch';
import { stampRndSeen } from '@/modules/rnd/hooks/useRndSeen';
import { useRndWrites } from '@/modules/rnd/hooks/useRndWrites';
import { sayWeekly } from '@/modules/rnd/weeklyWords';
import { HEAD_PRESS, HEAD_WORD_PRESS, SCREEN_FRAME } from '@/shared/constants';
import { HeadTools } from '@/shared/context/HeadToolsContext';
import { useStationDoors } from '@/shared/context/StationLayerContext';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { RndCandidate } from '@/shared/rnd-types';
import { Badge, Banner, Button, EmptyState, Rule, ScrollArea, SegmentedControl, SignalLoop, Spinner } from '@/shared/ui';
import { cn, formatRelativeTime } from '@/shared/utils';

/** The question open over the open candidate. */
type Asking = 'reject';

/**
 * THE R&D PLACE: what the scout found, and what he decided about each thing. One list, four views of it by where a candidate
 * stands: Waiting, Spiking, Verdicts and Rejected. Each view wears the number that waits on him. On Verdicts that is the yeses
 * not yet adopted; the adopted stand under them, parted by a rule with their own count, because they are done.
 *
 * THE HEAD IS THE SCOUT, QUIETLY: what it is doing or last did and when it next goes out by itself, in two lines over the views;
 * Scout now and the settings stand in the screen's head, before the Menu (`HeadTools`), the place's only presses of its own. While
 * one is out the line wears the loop and Scout now waits; with no source to read it is held, and the empty view offers the press
 * that fixes it.
 *
 * IT IS READ IN THE PAGE'S FRAME (`SCREEN_FRAME`), under a head that keeps to it: at a wide desk the list stands at the frame's start,
 * under the arrow, and the room beside it, to the frame's end, is where a row opens.
 *
 * THE VIEWS' SWITCH IS DRAWN ONCE, IN ONE OF TWO SPELLINGS. Four words and four count pills are wider than a phone, and a word cut
 * short is no label: under 640 px each count is said inside its word ("Waiting 6"), from there up it is the tray's own pill.
 *
 * A ROW OPENS IN PLACE: its Opening hangs from the row's far end, beside the list where the room holds it whole (from 63rem of
 * room the list keeps the plate's width free), under the row where it does not, a sheet at the foot on a phone. A question
 * (Reject; Adopt asks nothing, Opus places it) closes by itself when the candidate's word moves on, and the Opening when the candidate leaves the view.
 *
 * FOCUS GOES BACK WHERE IT CAME FROM: a folded Opening hands it to its row and a closed question to the act that asked it, so a
 * keyboard reads on down the list and never from the page's top.
 *
 * EVERY STATE IS A SCREEN: not read yet, not answering (its sentence and Try again), read but out of touch (the last picture
 * under a line saying how old it is), and a view that holds nothing saying what lands there.
 */
export function RndPanel({ projectPath }: { projectPath: string | null }) {
  const { t, i18n } = useTranslation();
  const adoptedId = useId();
  const [view, setView] = useState<RndView>('waiting');
  const [openName, setOpenName] = useState<string | null>(null);
  const [openSide, setOpenSide] = useState<'right' | 'below'>('right');
  const [asking, setAsking] = useState<Asking | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // The place's own box: the room an Opening measures its side in.
  const roomRef = useRef<HTMLDivElement>(null);
  // Each drawn row's node by its candidate's name: the open one is the mark its Opening hangs from.
  const rowNodes = useRef(new Map<string, HTMLButtonElement>());
  // The question last asked: when it closes and its candidate is still open, focus goes back to the act that asked it.
  const asked = useRef<Asking | null>(null);
  useEffect(() => {
    if (asking !== null) asked.current = asking;
    else if (asked.current !== null) {
      if (openName !== null) roomRef.current?.querySelector<HTMLElement>('[data-rnd-act="' + asked.current + '"]')?.focus();
      asked.current = null;
    }
  }, [asking, openName]);

  const { picture, failure, retry: onRetry } = useRnd();
  const writes = useRndWrites();
  const { busy, refusal, dismiss: onDismissRefusal, scoutNow: onScoutNow, adopt: onAdopt, reject: onReject, reopen: onReopen } = writes;
  const { addSource: onAddSource, removeSource: onRemoveSource, webSearch: onWebSearch, scoutsRun: onScoutsRun } = writes;
  const { sendMessage } = useWebSocket();
  // The wheel's goChat: the station's "Open the chat" door, the one every open of a chat goes through.
  const onOpenChat = useStationDoors().openChatInWorkspace;
  const onSpike = (name: string) => writes.spike(name, projectPath, sendMessage, onOpenChat);
  const weeklyWords = (expression: string) => sayWeekly(expression, t, i18n.language);
  const { launch, launchFailure, save: saveLaunch } = useRndLaunch();
  const onLaunch = (kind: RndLaunchKind, slot: 'model' | 'effort', next: string | null) => writes.saveLaunch(() => saveLaunch(kind, slot, next));
  // While he stands here, what has been filed is seen: each new picture moves the stamp, and the wheel's mark lights again only
  // for what is filed after he leaves (or for a yes still waiting for his Adopt).
  const generatedAt = picture?.generated_at ?? null;
  useEffect(() => {
    if (generatedAt !== null) stampRndSeen();
  }, [generatedAt]);

  if (picture === null) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-4" data-rnd-panel={failure === null ? 'loading' : 'unreachable'} aria-busy={failure === null}>
        {failure === null ? (
          <Spinner label={t('rnd.loading')} />
        ) : (
          <EmptyState icon={CloudOff} title={t('rnd.unreachable.title')} message={failure} actionLabel={t('rnd.unreachable.retry')} onAction={onRetry} />
        )}
      </div>
    );
  }

  const scout = scoutLine(picture, t, weeklyWords);
  const noSources = picture.settings.sources.length === 0;
  const rows = rowsOf(picture, view);
  // Verdicts alone holds two words: the proved first, then the adopted under their own rule.
  const adoptedAt = view === 'verdicts' ? rows.findIndex((candidate) => candidate.word === 'adopted') : -1;
  const lead = adoptedAt === -1 ? rows : rows.slice(0, adoptedAt);
  const adopted = adoptedAt === -1 ? [] : rows.slice(adoptedAt);
  const opened = openName === null ? undefined : rows.find((candidate) => candidate.name === openName);
  const openedBusy = opened !== undefined && busy === opened.name;
  const openedRefusal = opened !== undefined && refusal !== null && refusal.where === opened.name ? refusal.sentence : null;
  const scoutRefusal = refusal !== null && refusal.where === 'scout' ? refusal.sentence : null;
  // A question stands only while its act is one the candidate's word allows: the write that answers it moves the word on.
  const askingReject = asking === 'reject' && opened !== undefined && opened.word !== 'rejected' && opened.word !== 'adopted';

  const closeOpening = () => {
    setAsking(null);
    setOpenName(null);
  };
  // Folded back by its arrow, Escape or a press elsewhere: its row takes the focus the plate held.
  const foldBack = () => {
    if (openName !== null) rowNodes.current.get(openName)?.focus();
    closeOpening();
  };
  const pickView = (next: RndView) => {
    closeOpening();
    setView(next);
  };
  const pressRow = (name: string) => {
    setAsking(null);
    if (openName === name) return setOpenName(null);
    const box = rowNodes.current.get(name)?.getBoundingClientRect();
    const room = roomRef.current?.getBoundingClientRect();
    setOpenSide(box !== undefined && room !== undefined && room.right - box.right < OPENING_BESIDE_PX ? 'below' : 'right');
    return setOpenName(name);
  };
  const keepRow = (name: string) => (node: HTMLButtonElement | null) => {
    if (node === null) rowNodes.current.delete(name);
    else rowNodes.current.set(name, node);
  };
  const openBox = () => (openName === null ? undefined : rowNodes.current.get(openName)?.getBoundingClientRect());
  // The mark is the row's far end, where its word stands: the plate opens past it, clear of the list, where the room allows.
  const anchor = () => {
    const box = openBox();
    return box === undefined ? null : { x: box.right - 16, y: box.top + box.height / 2 };
  };
  const avoid = () => {
    const box = openBox();
    return box === undefined ? null : { left: box.left, right: box.right };
  };
  const row = (candidate: RndCandidate) => (
    <CandidateRow key={candidate.name} candidate={candidate} open={opened?.name === candidate.name} onOpen={() => pressRow(candidate.name)} rowRef={keepRow(candidate.name)} />
  );

  const empty = noSources && picture.candidates.length === 0 ? (
    <EmptyState icon={Rss} title={t('rnd.empty.noSources.title')} message={t('rnd.empty.noSources.message')} actionLabel={t('rnd.empty.noSources.action')} onAction={() => setSheetOpen(true)} />
  ) : (
    <EmptyState title={t('rnd.empty.' + view + '.title')} message={t('rnd.empty.' + view + '.message')} />
  );

  return (
    <div ref={roomRef} className="relative flex h-full min-h-0 flex-col" data-rnd-panel={failure === null ? 'ready' : 'stale'} data-rnd-view={view}>
      {/* The place's own presses, in the screen's head before the Menu: Scout now (its word at a desk, its mark under a finger,
          the word kept as its name) and the settings. */}
      <HeadTools>
        <Button
          variant="outline"
          size="sm"
          className={HEAD_WORD_PRESS}
          busy={scout.out || busy === 'scout'}
          disabled={noSources}
          onClick={onScoutNow}
          title={t('rnd.scout.now')}
          data-rnd-act="scout"
        >
          <Telescope aria-hidden="true" />
          <span className="finger:sr-only">{t('rnd.scout.now')}</span>
        </Button>
        <Button variant="outline" size="icon" className={HEAD_PRESS} aria-label={t('rnd.settingsOpen')} title={t('rnd.settingsOpen')} onClick={() => setSheetOpen(true)} data-rnd-settings="">
          <Settings aria-hidden="true" />
        </Button>
      </HeadTools>

      <header className={cn(SCREEN_FRAME, 'flex-none pt-2 finger:pt-4')}>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground" data-rnd-scout={scout.out ? 'out' : 'in'}>
          {scout.out && <SignalLoop state="working" signal="secondary" />}
          {scout.trouble !== null && <Badge as="span" tone="warn">{scout.trouble}</Badge>}
          <span>{scout.line}</span>
          {scout.scouts !== null && <span data-rnd-scouts="">{scout.scouts}</span>}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{scout.weekly}</p>
      </header>

      {(failure !== null || scoutRefusal !== null) && (
        <div className={cn(SCREEN_FRAME, 'flex flex-none flex-col gap-2 pt-3')}>
          {failure !== null && (
            <Banner tone="warn" action={<Button variant="outline" size="sm" className="finger:h-11" onClick={onRetry}>{t('rnd.unreachable.retry')}</Button>}>
              {t('rnd.stale', { ago: formatRelativeTime(picture.generated_at), sentence: failure })}
            </Banner>
          )}
          {scoutRefusal !== null && <Banner tone="warn" onClose={onDismissRefusal}>{scoutRefusal}</Banner>}
        </div>
      )}

      <div className={cn(SCREEN_FRAME, 'flex-none pt-4 sm:hidden')} data-rnd-views="narrow">
        <SegmentedControl
          label={t('rnd.views.label')}
          options={RND_VIEWS.map((value) => ({ value, label: t('rnd.views.counted', { view: t('rnd.views.' + value), n: countOf(picture, value) }) }))}
          value={view}
          onChange={pickView}
        />
      </div>
      <div className={cn(SCREEN_FRAME, 'hidden flex-none pt-4 sm:block')} data-rnd-views="wide">
        <SegmentedControl
          label={t('rnd.views.label')}
          options={RND_VIEWS.map((value) => ({ value, label: t('rnd.views.' + value), count: countOf(picture, value) }))}
          value={view}
          onChange={pickView}
        />
      </div>

      {rows.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">{empty}</div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          {/* The frame is the list's room: from 63rem of it the list keeps the plate's width free at the frame's end. The list
              stands a row's inset out into the gutter, so a row's words start under the scout's line. */}
          <div className={cn(SCREEN_FRAME, '[container-type:inline-size]')}>
            <div className="-mx-3 flex max-w-3xl flex-col pb-8 pt-2 [@container(min-width:63rem)]:max-w-[min(48rem,calc(100%-33rem))]">
              {lead.length > 0 && <ul aria-label={t('rnd.views.' + view)}>{lead.map(row)}</ul>}
              {adopted.length > 0 && (
                <>
                  {lead.length === 0 && <EmptyState size="sm" title={t('rnd.empty.noProved')} />}
                  <Rule id={adoptedId} className="px-3 pb-1 pt-6" end={adopted.length}>{t('rnd.word.adopted')}</Rule>
                  <ul aria-labelledby={adoptedId}>{adopted.map(row)}</ul>
                </>
              )}
            </div>
          </div>
        </ScrollArea>
      )}

      <CandidateOpening
        candidate={opened ?? null}
        anchor={anchor}
        avoid={avoid}
        side={openSide}
        busy={openedBusy}
        // A refusal is said where its question is: in the Opening only while no question is open over it.
        refusal={askingReject ? null : openedRefusal}
        onClose={foldBack}
        onSpike={() => opened !== undefined && onSpike(opened.name)}
        onOpenChat={() => { const chat = opened?.spike?.session; if (chat) onOpenChat(chat); }}
        onOpenLauncher={() => { const chat = opened?.spike?.launched_from; if (chat) onOpenChat(chat); }}
        onAdopt={() => opened !== undefined && onAdopt(opened.name)}
        onReject={() => setAsking('reject')}
        onReopen={() => opened !== undefined && onReopen(opened.name)}
      >
        {opened !== undefined && askingReject && (
          <RejectDialog candidate={opened} busy={openedBusy} refusal={openedRefusal} onReject={(why) => onReject(opened.name, why)} onClose={() => setAsking(null)} />
        )}
      </CandidateOpening>

      <RndSettingsSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        settings={picture.settings}
        launch={launch}
        launchFailure={launchFailure}
        busy={busy === 'settings'}
        refusal={refusal !== null && refusal.where === 'settings' ? refusal.sentence : null}
        onDismissRefusal={onDismissRefusal}
        onAddSource={onAddSource}
        onRemoveSource={onRemoveSource}
        onWebSearch={onWebSearch}
        onScoutsRun={onScoutsRun}
        onLaunch={onLaunch}
      />
    </div>
  );
}
