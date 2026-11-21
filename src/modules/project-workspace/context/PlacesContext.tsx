import { FolderPlus, House, MessageSquare, Settings } from 'lucide-react';
import { Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useBackToWorkspace, useCurrentApplication, useSwitcherActions } from '@/modules/app-switcher';
import { useCerberusNeeds } from '@/modules/cerberus';
import { useChatHost } from '@/modules/chat-host';
import { useClaudeUpdateLine } from '@/modules/claude-updates';
import { usePaletteOps } from '@/modules/command-palette';
import { useCompanion } from '@/modules/companion';
import { useDispatcherPlans } from '@/modules/dispatcher';
import { useInboxWaiting } from '@/modules/inbox';
import { ProjectCreationWizard } from '@/modules/project-creation-wizard';
import { useProjectEffectsState, useProjectMainState } from '@/modules/project-workspace/context/ProjectsStateContext';
import { useWorkspaceViews } from '@/modules/project-workspace/hooks/useWorkspaceViews';
import { PlaceTrail } from '@/modules/project-workspace/places/PlaceTrail';
import { PlacesWheel } from '@/modules/project-workspace/places/PlacesWheel';
import { StationGlyph } from '@/modules/project-workspace/places/StationGlyph';
import { openHome, openStation } from '@/shared/cloudcliDoors';
import { useAwaitingInputSessionIdSet } from '@/shared/context/SessionProtectionContext';
import { createStableContext } from '@/shared/context/stableContext';
import { useHomeShowing, useStationDoors, useStationShowing } from '@/shared/context/StationLayerContext';
import { useVersionCheck } from '@/shared/hooks/useVersionCheck';
import type { AppTab, ChatDoor, Place, PlaceId, PlaceMark, PlaceTrailStep, SettingsMainTab } from '@/shared/types';
import { getSessionTitle } from '@/shared/utils';

/** The workspace's screens the wheel stands on its rings, by the names the wheel gives them, in its order. */
const SCREEN_PLACES: ReadonlyArray<{ id: PlaceId; tab: AppTab; ring: Place['ring'] }> = [
  { id: 'roadmap', tab: 'runner', ring: 'inner' },
  { id: 'bugs', tab: 'kanban', ring: 'inner' },
  { id: 'cerberus', tab: 'cerberus', ring: 'outer' },
  { id: 'inbox', tab: 'inbox', ring: 'outer' },
  { id: 'api', tab: 'api', ring: 'outer' },
  { id: 'universe', tab: 'universe', ring: 'outer' },
  { id: 'schedules', tab: 'schedules', ring: 'outer' },
];

/** How many places the trail keeps, the newest last: as many as a course can name side by side. */
const TRAIL_LENGTH = 6;

/** How long a press must rest on a back arrow, or on Kaylee's core, before it is a hold, in ms; and how far it may drift and still be one. */
const HOLD_MS = 450;
const HOLD_SLOP_PX = 8;

/** The fields a key is typed into: there the backtick is a character, never the wheel. */
const TYPING_SELECTOR = [
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
  'input:not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="submit"]):not([type="reset"])',
].join(', ');

/** A chat door that opens nothing, for the switcher's list of acts, whose Chat act the wheel leaves out (it floats the chat, the chat's own to do). */
const NO_CHAT_DOOR: ChatDoor = { floating: false, unread: false, toggle: () => {}, collapse: () => {} };

/** The trail with `step` stood on: the newest last, each place once (a place come back to moves to the end), as long as it may be. */
function walkedTo(trail: PlaceTrailStep[], step: PlaceTrailStep): PlaceTrailStep[] {
  const last = trail.at(-1);
  // The same place renamed (a chat's title read in after it opened): the step keeps its place and takes the new name.
  if (last?.key === step.key) return [...trail.slice(0, -1), step];
  return [...trail.filter((each) => each.key !== step.key), step].slice(-TRAIL_LENGTH);
}

type WheelState = {
  /** The middle and the width of the press it came out of (the menu, a core), or null when a key summoned it. */
  from: { x: number; y: number; size: number } | null;
  /** The press it came out of, which hides its face while the wheel is unfolded from it (`data-unfolded`); null for a key. */
  opener: HTMLElement | null;
  /** The pointer still down from the press that opened it, or null: while it is down, letting go over a place goes there. */
  held: number | null;
  /** Where the focus stood as it came up, for it to go back to when the wheel is put away with nothing chosen. */
  returnTo: HTMLElement | null;
  /** Put away with nothing chosen: drawn a moment longer, settling, and pressing nothing. */
  leaving: boolean;
};

/** The wheel as a press, or a key, brings it up: out of `opener`'s middle when there is one, with the focus to give back. */
function wheelFrom(opener: HTMLElement | null, held: number | null): WheelState {
  const box = opener?.getBoundingClientRect() ?? null;
  const focused = document.activeElement;
  return {
    from: box === null ? null : { x: box.left + box.width / 2, y: box.top + box.height / 2, size: box.width },
    opener,
    held,
    returnTo: opener ?? (focused instanceof HTMLElement && focused !== document.body ? focused : null),
    leaving: false,
  };
}

type PlacesValue = {
  /** Every place the navigation leads to, in the wheel's order: the inner ring's five, then the outer's six. */
  places: Place[];
  /**
   * The places away from here with something waiting that the menu shows: each is a bead on the menu's dial at its bearing
   * (`PlacesDial`). The app's own newer release stays on Settings in the wheel: it is news to read there, not a word owed on every page.
   */
  waiting: Place[];
  /**
   * What waits elsewhere, gathered for the menu that brings the wheel up: `owed` while any place in `waiting` owes a word, else `done`
   * while one has finished work unseen, its words naming each such place; null while nothing waits.
   */
  menuMark: PlaceMark | null;
  /** Brings the wheel up out of `opener`; with `heldPointer`, the pointer still down from that press, which a release over a place spends. */
  openWheel: (opener: HTMLElement | null, heldPointer: number | null) => void;
  /** Opens the new-project wizard, which makes a folder a project: the door the old sidebar's plus was. */
  newProject: () => void;
};

const PlacesContext = createStableContext<PlacesValue | null>(import.meta.hot, 'PlacesContext', null);

/**
 * The places the navigation leads to, and the wheel's door. Read by this module's `PlacesMenu` (the press that brings the wheel up)
 * and its `ProjectCommandPalette` (whose Places group lists them first). Throws outside `PlacesProvider`, so a reader placed wrong
 * fails at once.
 */
export function usePlaces(): PlacesValue {
  const value = useContext(PlacesContext);
  if (!value) throw new Error('usePlaces must be used within a PlacesProvider');
  return value;
}

/**
 * THE APP'S NAVIGATION, held once for every page: what the places are, where the reader is among them, where they have been, and
 * the two things that take them elsewhere. Rendered by this module's `ProjectWorkspaceShell` round the workspace's frame, the station
 * and the sessions home, inside the providers it reads (the pages' doors, the projects' state, the applications, Kaylee's picture).
 *
 * THE WHEEL OF PLACES (`PlacesWheel`) is what the menu's press summons on every page: Kaylee's core in the middle, the five places
 * visited most on the inner ring at fixed bearings (Home at the top, then the station, the Roadmap, Bugs and the last chat round
 * clockwise) and the rest on the outer. It comes up out of the menu (`PlacesMenu`), held or pressed; out of a long press on Kaylee's
 * core where it says it holds them (`HOLDS_PLACES`: the home's, the station's); and on the backtick key, wherever a key is not being
 * typed into a field. On a phone it is a fan from the foot, in the thumb's reach.
 *
 * THE TRAIL is the places the reader has stood on in this page's life, newest last, each once: a page, a screen of the workspace, a
 * chat. Recorded as the page, the screen or the chat changes; drawn as a course (`PlaceTrail`) when a back arrow that says it holds
 * it (`HOLDS_TRAIL`: the chat's head, the Bugs view's) is held, so a reader steps back several places in one press. A plain press of
 * the arrow is still the way back.
 *
 * EVERY GO IS A DOOR THE APP ALREADY HAS: a page is `openHome` or `openStation`; a screen is the workspace's view brought forward at
 * the address it held (an application over the workspace stepped back first, as Kaylee's own opens do); a chat is the station's
 * "Open the chat" door (`openChatInWorkspace`), the one her orders use; Settings is the workspace's dialog.
 *
 * WHAT WAITS AT A PLACE IS MARKED ON IT (`Place.mark`), each figure the one its own screen already reads, so a mark and the screen it
 * leads to never tell two stories: other chats waiting on an answer (the home), Kaylee's draft (the station), the roadmap's asks or its
 * whole lane finished, the last chat's question or its reply landed unseen, the checks that need a person (Cerberus), the Inbox's count,
 * and Settings while the server must be restarted or an update is on offer (pressed then, it opens on the tab that says so). The marks
 * of the places away from here stand on the menu's dial, each a bead at its place's bearing (`waiting`), and gathered they are the
 * menu's description (`menuMark`).
 *
 * IT ALSO HOLDS THE NEW-PROJECT WIZARD (`newProject`): the old sidebar's plus was its only door, and no screen draws that sidebar
 * now. The wheel offers it under its places and the palette among its acts.
 */
export function PlacesProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const doors = useStationDoors();
  const stationShowing = useStationShowing();
  const homeShowing = useHomeShowing();
  const { selectedSession, activeTab } = useProjectMainState();
  const { setActiveTab, openSettings } = useProjectEffectsState();
  const { views } = useWorkspaceViews();
  const covered = useCurrentApplication() !== null;
  const backToWorkspace = useBackToWorkspace();
  const switcherActs = useSwitcherActions(NO_CHAT_DOOR);

  const homeName = t('home.title', { defaultValue: 'Home' });
  const stationName = t('station.title', { defaultValue: 'Kaylee Station' });
  const sessionId = selectedSession?.id ?? null;
  const sessionTitle = selectedSession ? getSessionTitle(selectedSession) : null;
  const screenName = views.find((view) => view.id === activeTab)?.label ?? null;

  // WHERE THE READER STANDS: a page over the workspace, else the workspace's screen, a chat by its session.
  const standing = useMemo<PlaceTrailStep | null>(() => {
    if (stationShowing) return { key: 'station', label: stationName, kind: 'page' };
    if (homeShowing) return { key: 'home', label: homeName, kind: 'page' };
    if (activeTab === 'chat') return sessionId !== null && sessionTitle !== null ? { key: `chat:${sessionId}`, label: sessionTitle, kind: 'chat' } : null;
    return screenName !== null ? { key: `view:${activeTab}`, label: screenName, kind: 'screen' } : null;
  }, [stationShowing, homeShowing, activeTab, sessionId, sessionTitle, screenName, stationName, homeName]);

  // THE TRAIL, walked as the reader moves: a step stood on is recorded in the render that first stands on it, the newest last.
  const [trail, setTrail] = useState<PlaceTrailStep[]>(() => (standing === null ? [] : [standing]));
  const standingSignature = standing === null ? null : `${standing.key}\u0000${standing.label}`;
  const [recorded, setRecorded] = useState(standingSignature);
  if (standingSignature !== recorded) {
    setRecorded(standingSignature);
    if (standing !== null) setTrail((before) => walkedTo(before, standing));
  }

  // THE LAST CHAT: the newest the trail holds, else the one the workspace has open under whatever page covers it.
  let lastChat: { id: string; title: string } | null = null;
  for (let index = trail.length - 1; index >= 0 && lastChat === null; index -= 1) {
    const step = trail[index];
    if (step.kind === 'chat') lastChat = { id: step.key.slice('chat:'.length), title: step.label };
  }
  if (lastChat === null && sessionId !== null && sessionTitle !== null) lastChat = { id: sessionId, title: sessionTitle };
  const lastChatId = lastChat?.id ?? null;
  const lastChatTitle = lastChat?.title ?? null;

  // WHAT WAITS AT THE PLACES, read where each place's own screen reads it. Each comes down to words, or a count, before the places are
  // built, so a frame that moves nothing a mark says builds nothing new.
  const cerberusNeeds = useCerberusNeeds();
  const { total: inboxWaiting } = useInboxWaiting();
  const { waiting: roadmapWaiting, tone: roadmapTone } = useDispatcherPlans();
  const { unread: chatUnread } = useChatHost();
  const awaitingInput = useAwaitingInputSessionIdSet();
  const { picture } = useCompanion();
  const claudeUpdate = useClaudeUpdateLine();
  const appVersion = useVersionCheck('siteboon', 'claudecodeui');

  const chatAsking = lastChatId !== null && awaitingInput.has(lastChatId);
  // The chat's unread reply is the open conversation's; the last chat is that one when it is the one the workspace has open.
  const chatReplied = chatUnread && lastChatId !== null && lastChatId === sessionId;
  // Every other chat with a question waiting: the sessions home is where they are listed.
  let othersAsking = 0;
  for (const id of awaitingInput) if (id !== lastChatId) othersAsking += 1;
  const draft = picture?.draft ?? null;
  const draftWords = draft === null ? null : t('station.draft.bead', {
    name: picture?.settings.name ?? t('companion.defaultName', { defaultValue: 'Kaylee' }),
    target: draft.target.kind === 'session' ? draft.target.session.name : draft.target.projectName,
    defaultValue: '{{name}}’s draft for {{target}}',
  });
  // Settings, the first that stands: the server running another version than this page (restart it), Claude's update on offer (not
  // while it is being installed), the app's newer release. Each opens the tab that says it.
  let settingsNotice: { words: string; tab: SettingsMainTab; quiet: boolean } | null = null;
  if (appVersion.restartRequired) {
    settingsNotice = { words: t('version.restartRequired', { ns: 'sidebar' }), tab: 'about', quiet: false };
  } else if (claudeUpdate !== null && !claudeUpdate.working) {
    settingsNotice = { words: `${claudeUpdate.title} · ${claudeUpdate.detail}`, tab: 'updates', quiet: false };
  } else if (appVersion.updateAvailable) {
    const release = appVersion.releaseInfo?.title || `v${appVersion.latestVersion}`;
    settingsNotice = { words: `${release} · ${t('version.updateAvailable', { ns: 'sidebar' })}`, tab: 'about', quiet: true };
  }
  const settingsWords = settingsNotice?.words ?? null;
  const settingsTab = settingsNotice?.tab ?? null;
  const settingsQuiet = settingsNotice?.quiet ?? false;

  const marks = useMemo(() => {
    const at: Partial<Record<PlaceId, PlaceMark>> = {};
    if (othersAsking > 0) at.home = { kind: 'owed', words: t('rail.badge.inbox', { count: othersAsking }) };
    if (draftWords !== null) at.station = { kind: 'owed', words: draftWords };
    // The lane's own reading: an ask owed outranks the green, and the green is every drawn plan complete (`tone`), never a lane at work.
    if (roadmapWaiting > 0) at.roadmap = { kind: 'owed', words: t('rail.badge.inbox', { count: roadmapWaiting }) };
    else if (roadmapTone === 'positive') at.roadmap = { kind: 'done', words: t('places.mark.finished', { defaultValue: 'All finished' }) };
    if (chatAsking) at.chat = { kind: 'owed', words: t('places.mark.asking', { defaultValue: 'Waiting on your answer' }) };
    else if (chatReplied) at.chat = { kind: 'done', words: t('rail.badge.chat') };
    if (cerberusNeeds > 0) at.cerberus = { kind: 'owed', words: t('rail.badge.cerberus', { count: cerberusNeeds }) };
    if (inboxWaiting > 0) at.inbox = { kind: 'owed', words: t('rail.badge.inbox', { count: inboxWaiting }) };
    if (settingsWords !== null) at.settings = { kind: 'owed', words: settingsWords };
    return at;
  }, [othersAsking, draftWords, roadmapWaiting, roadmapTone, chatAsking, chatReplied, cerberusNeeds, inboxWaiting, settingsWords, t]);

  const goHome = useCallback(() => openHome(doors.navigate), [doors]);
  const goStation = useCallback(() => {
    // From the home the roadmap goes with the reader: the station's stack arrives from the home's circle.
    if (doors.homeShowing()) doors.markRoadmapTravel('station');
    openStation(doors.navigate);
  }, [doors]);
  const goScreen = useCallback((tab: AppTab) => {
    // The view first, then the page: the workspace comes forward at the address it held, already showing it.
    if (covered) backToWorkspace();
    setActiveTab(tab);
    doors.navigate(doors.workspacePath());
  }, [covered, backToWorkspace, setActiveTab, doors]);
  const goChat = useCallback((id: string) => doors.openChatInWorkspace(id), [doors]);

  const places = useMemo<Place[]>(() => {
    const where: PlaceId | null = stationShowing ? 'station'
      : homeShowing ? 'home'
        : activeTab === 'chat' ? (lastChatId !== null && lastChatId === sessionId ? 'chat' : null)
          : SCREEN_PLACES.find((screen) => screen.tab === activeTab)?.id ?? null;
    const screens = new Map(SCREEN_PLACES.flatMap(({ id, tab, ring }) => {
      const view = views.find((each) => each.id === tab && !each.hiddenFromNav);
      if (view === undefined || view.icon === null) return [];
      const place: Place = {
        id, label: view.label, icon: view.icon, ring, here: where === id, keywords: view.keywords, mark: marks[id] ?? null, go: () => goScreen(tab),
      };
      return [[id, place] as const];
    }));
    const pick = (id: PlaceId) => (screens.has(id) ? [screens.get(id) as Place] : []);
    return [
      { id: 'home', label: homeName, icon: House, ring: 'inner', here: where === 'home', keywords: t('home.keywords'), mark: marks.home ?? null, go: goHome },
      {
        id: 'station', label: stationName, icon: StationGlyph, ring: 'inner', here: where === 'station', keywords: 'kaylee station companion watch floor',
        mark: marks.station ?? null, go: goStation,
      },
      ...pick('roadmap'),
      ...pick('bugs'),
      ...(lastChatId === null || lastChatTitle === null ? [] : [{
        id: 'chat' as const,
        label: lastChatTitle,
        icon: MessageSquare,
        ring: 'inner' as const,
        here: where === 'chat',
        keywords: 'last chat conversation session',
        mark: marks.chat ?? null,
        go: () => goChat(lastChatId),
      }]),
      ...pick('cerberus'),
      ...pick('inbox'),
      ...pick('api'),
      ...pick('universe'),
      ...pick('schedules'),
      {
        id: 'settings', label: t('rail.settings'), icon: Settings, ring: 'outer', here: false, keywords: 'open settings preferences',
        mark: marks.settings ?? null, go: () => openSettings(settingsTab ?? undefined),
      },
    ];
  }, [stationShowing, homeShowing, activeTab, lastChatId, lastChatTitle, sessionId, views, homeName, stationName, marks, settingsTab, t, goHome, goStation, goScreen, goChat, openSettings]);

  const waiting = useMemo(
    () => places.filter((place) => place.mark !== null && !place.here && !(place.id === 'settings' && settingsQuiet)),
    [places, settingsQuiet],
  );
  const menuMark = useMemo<PlaceMark | null>(() => {
    if (waiting.length === 0) return null;
    return {
      kind: waiting.some((place) => place.mark?.kind === 'owed') ? 'owed' : 'done',
      words: waiting.map((place) => `${place.label}: ${place.mark?.words}`).join('. '),
    };
  }, [waiting]);

  // THE NEW-PROJECT WIZARD, the one door to making a folder a project now that no screen draws the old sidebar whose plus it was.
  // A made project is read into the lists as the sidebar's own did.
  const paletteOps = usePaletteOps();
  const [creatingProject, setCreatingProject] = useState(false);
  const newProject = useCallback(() => setCreatingProject(true), []);

  // The acts under the wheel: the applications' (the list of applications always, and what can be done to the one in front while one
  // is up), then New project. None at the station, which covers the workspace an application stands over.
  const acts = useMemo(() => (stationShowing ? [] : [
    ...switcherActs.filter((act) => act.key !== 'chat' && !act.disabled),
    { key: 'new-project', label: t('places.newProject', { defaultValue: 'New project' }), icon: FolderPlus, run: newProject },
  ]), [stationShowing, switcherActs, t, newProject]);

  // THE WHEEL: up, folding away, or not drawn.
  const [wheel, setWheel] = useState<WheelState | null>(null);
  const openWheel = useCallback((opener: HTMLElement | null, heldPointer: number | null) => {
    const opening = wheelFrom(opener, heldPointer);
    setWheel((now) => (now !== null && !now.leaving ? now : opening));
  }, []);
  const closeWheel = useCallback((restoreFocus: boolean) => {
    if (wheel === null || wheel.leaving) return;
    // Gone somewhere: the place it went to is what comes next, at once; the wheel does not linger over it.
    if (!restoreFocus) {
      setWheel(null);
      return;
    }
    // Put away as it was: it settles off, and the focus goes back where it stood.
    if (wheel.returnTo?.isConnected) wheel.returnTo.focus({ preventScroll: true });
    setWheel({ ...wheel, leaving: true });
  }, [wheel]);
  const wheelLeaving = wheel?.leaving ?? false;
  useEffect(() => {
    if (!wheelLeaving) return undefined;
    // As long as its settling runs (places.css), then it is gone.
    const timer = window.setTimeout(() => setWheel((now) => (now?.leaving ? null : now)), 240);
    return () => window.clearTimeout(timer);
  }, [wheelLeaving]);

  // Whether the wheel is up, for the backtick's listener, which leaves the key to the wheel's own while it is.
  const wheelUpRef = useRef(false);
  useEffect(() => {
    wheelUpRef.current = wheel !== null && !wheel.leaving;
  }, [wheel]);

  // THE PRESS IT UNFOLDED FROM shows no face while the wheel is up, so the wheel reads as that press grown (`places.css`); its face
  // comes back as the wheel folds back into it, or at once when a place is chosen.
  const unfoldedFrom = wheel !== null && !wheel.leaving ? wheel.opener : null;
  useEffect(() => {
    if (unfoldedFrom === null) return undefined;
    unfoldedFrom.setAttribute('data-unfolded', '');
    return () => unfoldedFrom.removeAttribute('data-unfolded');
  }, [unfoldedFrom]);

  // THE BACKTICK summons it on any page (the wheel's own keys put it away), unless a key is being typed into a field or a dialog is up.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (wheelUpRef.current || event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code !== 'Backquote' && event.key !== '`') return;
      if ((event.target as Element | null)?.closest?.(TYPING_SELECTOR)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"], .modal-backdrop') !== null) return;
      event.preventDefault();
      const opening = wheelFrom(null, null);
      setWheel((now) => (now === null || now.leaving ? opening : now));
    };
    // The window's capture, ahead of the station's own listener there, which sends a printable key to Kaylee's line.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  // THE TRAIL'S PLATE, hung from the back arrow that was held; null while it is folded.
  const [trailFrom, setTrailFrom] = useState<{ x: number; y: number; arrow: HTMLElement } | null>(null);
  // The newest trail, for a hold that starts later: a back arrow with nowhere further back to show is pressed, not held.
  const trailRef = useRef(trail);
  useEffect(() => {
    trailRef.current = trail;
  }, [trail]);

  // THE HOLDS: a press resting on a back arrow that holds the trail opens the trail; one resting on a core that holds the places
  // opens the wheel, held. The click that would follow the release is the hold's, not the press's.
  useEffect(() => {
    let hold: { pointerId: number; x: number; y: number; target: HTMLElement; timer: number } | null = null;
    let swallow: { target: HTMLElement; timer: number } | null = null;
    const letGo = () => {
      if (hold === null) return;
      window.clearTimeout(hold.timer);
      hold.target.removeAttribute('data-holding');
      hold = null;
    };
    const onClick = (event: MouseEvent) => {
      if (swallow === null || !(event.target instanceof Node) || !swallow.target.contains(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      window.clearTimeout(swallow.timer);
      swallow = null;
    };
    const fire = () => {
      if (hold === null) return;
      const { target, pointerId } = hold;
      letGo();
      if (swallow !== null) window.clearTimeout(swallow.timer);
      swallow = { target, timer: window.setTimeout(() => { swallow = null; }, 1200) };
      if (target.matches('[data-holds-trail]')) {
        const box = target.getBoundingClientRect();
        setTrailFrom({ x: box.left + box.width / 2, y: box.top + box.height / 2, arrow: target });
      } else {
        openWheel(target, pointerId);
      }
    };
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary) return;
      const target = (event.target as Element | null)?.closest?.<HTMLElement>('[data-holds-trail], [data-holds-places]') ?? null;
      if (target === null) return;
      // Nowhere further back than here: the arrow is only pressed.
      if (target.matches('[data-holds-trail]') && trailRef.current.length < 2) return;
      letGo();
      target.setAttribute('data-holding', '');
      hold = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, target, timer: window.setTimeout(fire, HOLD_MS) };
    };
    const onMove = (event: PointerEvent) => {
      if (hold === null || event.pointerId !== hold.pointerId) return;
      if (Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > HOLD_SLOP_PX) letGo();
    };
    const onUp = (event: PointerEvent) => {
      if (hold !== null && event.pointerId === hold.pointerId) letGo();
    };
    // A finger's long press would raise the platform's own menu on what is held.
    const onContextMenu = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest?.('[data-holds-trail], [data-holds-places]')) event.preventDefault();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('contextmenu', onContextMenu, true);
    return () => {
      letGo();
      if (swallow !== null) window.clearTimeout(swallow.timer);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('contextmenu', onContextMenu, true);
    };
  }, [openWheel]);

  const goBackTo = useCallback((key: string) => {
    setTrailFrom(null);
    if (key === 'home') goHome();
    else if (key === 'station') goStation();
    else if (key.startsWith('view:')) goScreen(key.slice('view:'.length) as AppTab);
    else if (key.startsWith('chat:')) goChat(key.slice('chat:'.length));
  }, [goHome, goStation, goScreen, goChat]);
  const closeTrail = useCallback(() => {
    // The focus goes back to the arrow it hung from.
    trailFrom?.arrow.focus({ preventScroll: true });
    setTrailFrom(null);
  }, [trailFrom]);

  const value = useMemo<PlacesValue>(
    () => ({ places, waiting, menuMark, openWheel, newProject }),
    [places, waiting, menuMark, openWheel, newProject],
  );

  return (
    <PlacesContext.Provider value={value}>
      {children}
      {wheel !== null && (
        <PlacesWheel places={places} acts={acts} from={wheel.from} held={wheel.held} leaving={wheel.leaving} onClose={closeWheel} />
      )}
      {trailFrom !== null && (
        <PlaceTrail steps={trail} hereKey={standing?.key ?? null} anchor={trailFrom} onGo={goBackTo} onClose={closeTrail} />
      )}
      {creatingProject && createPortal(
        <Suspense fallback={null}>
          <ProjectCreationWizard onClose={() => setCreatingProject(false)} onProjectCreated={() => void paletteOps.refreshProjects()} />
        </Suspense>,
        document.body,
      )}
    </PlacesContext.Provider>
  );
}
