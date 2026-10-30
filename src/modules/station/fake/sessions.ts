import type { ComponentProps } from 'react';

import { ChatStageView } from '@/modules/station/ChatStage';
import { DEPLOY_CHAT, FOLLOWUPS_CHAT } from '@/modules/station/fake/needs';
import { lyphecliRoadmap, roadmapPictureOf } from '@/modules/station/fake/roadmap';
import { WAITING_FEATURE } from '@/modules/station/fake/stage';
import { WhereThingsStandView } from '@/modules/station/WhereThingsStand';
import type { RoadmapPicture } from '@/shared/roadmap-types';
import type { StationFocus, StationSession, StationSessionState } from '@/shared/station-types';
import type { StationHerMark } from '@/shared/types';

/*
 * THE LEFT RAIL'S FIXTURES, for `station-fake.ts`'s pictures only: his chats as `GET /api/companion/station/sessions` serves
 * them (`StationSession`, in her order: waiting on him, working, idle, asleep, the most recent first inside each), each line as
 * her roster spells it (a working chat's last tool call or last words, a waiting chat's ask, a resting chat's "idle 12 min"),
 * and the roadmap `lyphecli` (`fake/roadmap.ts`). Ids are in a range no store has minted, so a press on one could find nothing.
 * Times are relative to when the fixture loads. Nothing in the app imports this file.
 *
 * ONE HOUSE PER PICTURE: a chat the right rail's slice names (`fake/needs.ts`) is among these, in the state its need implies —
 * `home`'s chat with open follow-ups, `walkthrough`'s chat waiting on a permission.
 *
 * THE PICTURES: `home` three working, one idle and eleven asleep, the roadmap's three open epics, and the chat he pressed on the
 * stage (`HOME_CHAT_STAGE`), its line cut on the rail and whole there; `waiting` a chat waiting on a permission at the head and
 * two features at "waiting on you: Accept", one of them on the stage; `walkthrough` the deploy chat waiting on its permission at
 * the head, the fold open and her mark on the chat she walks; `empty` no chat and no roadmap. The rail's other states (a first
 * read still out, a first read failed, every chat asleep, her mark on the closed fold) are `SESSIONS_STATES`.
 */

const NOW = Date.now();
const ago = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString();
const NO_PRESS = () => {};

/** A fixture chat's id: CloudCLI's own shape, in a range no store has minted. */
const idOf = (n: number): string => `00000000-0000-4000-8000-${String(900_000 + n).padStart(12, '0')}`;

/** A Bash call as her roster cuts it (`describeToolCall`): its command's first 60 characters, then "…". */
const bash = (command: string): string => `Bash ${command.length > 60 ? `${command.slice(0, 60)}…` : command}`;

/** A resting chat's line, as her roster says how long it has rested: minutes, then hours under two days, then days. */
const idleFor = (minutes: number): string =>
  minutes < 60 ? `idle ${minutes} min` : minutes < 48 * 60 ? `idle ${Math.round(minutes / 60)} h` : `idle ${Math.round(minutes / 1440)} d`;

/** One chat: its state, the line she reads of it, and when it last moved, in minutes before now. `n` is its id's number, or the id. */
const chat = (n: number | string, name: string, project: string, state: StationSessionState, activity: string, minutes: number): StationSession => ({
  sessionId: typeof n === 'string' ? n : idOf(n), name, project, state, activity, updatedAt: ago(minutes),
});

/** A chat at rest, idle (its process up) or asleep, its line how long it has rested. */
const resting = (n: number | string, name: string, project: string, state: 'live' | 'asleep', minutes: number): StationSession =>
  chat(n, name, project, state, idleFor(minutes), minutes);

/** The chat he pressed in `home`: working, its line its last words (80 characters at most), cut on the rail and whole on the stage. */
const TREE_POLISH = chat(1, 'Roadmap tree polish', 'lyphecli', 'working', 'Found it: the seed raced the first frame, so the guard now keeps the newer read', 1);
const UPLOADS = chat(2, 'Restorly uploads handoff', 'restorly', 'working', 'Edit UploadsTab.tsx', 2);
const DRYBOOK = chat(3, 'Drybook visit hours', 'restorly', 'working', bash('npx tsx scripts/drybook-visits.ts --job 26-04418 --since 2026-10-01 --rooms'), 4);
const STATUS = resting(4, 'Sleeping sessions status', 'lyphecli', 'live', 12);
/** The chat she walks in `walkthrough`: asleep since its turn ended, the most recent of the asleep. */
const KANBAN = resting(5, 'Kanban lane review', 'lyphecli', 'asleep', 38);
/** The other asleep chats, the most recent first; among them the chat whose open follow-ups the right rail lists in `home`. */
const ASLEEP: StationSession[] = [
  resting(6, 'Uncommitted diff', 'lyphecli', 'asleep', 64),
  resting(FOLLOWUPS_CHAT.sessionId, FOLLOWUPS_CHAT.chat, 'lyphecli', 'asleep', 90),
  resting(7, 'Cerberus fleet check', 'house', 'asleep', 4 * 60),
  resting(8, 'Gemini budget numbers', 'house', 'asleep', 9 * 60),
  resting(9, 'Vendor chat mail', 'restorly', 'asleep', 20 * 60),
  resting(10, 'Headscale on the box', 'house', 'asleep', 30 * 60),
  resting(11, 'Estimate lines from the demo sheet', 'restorly', 'asleep', 50 * 60),
  resting(12, 'DocSpace canvas zoom', 'lyphecli', 'asleep', 3 * 1440),
  resting(13, 'Mobile sidebar drag', 'lyphecli', 'asleep', 5 * 1440),
  resting(14, 'WorkCenter deadline extension', 'restorly', 'asleep', 6 * 1440),
];
/** `waiting`'s head: the uploads chat stopped on a permission, its ask as her roster cuts it. */
const UPLOADS_ASKING = chat(2, UPLOADS.name, UPLOADS.project, 'waiting', `wants permission: ${bash('rsync -av --delete dist/ deploy@restorly-box:/srv/restorly/uploads/')}`, 1);
/** `walkthrough`'s head: the chat whose permission the right rail holds in that picture, waiting on it. */
const DEPLOY_ASKING = chat(DEPLOY_CHAT.sessionId, DEPLOY_CHAT.chat, 'lyphecli', 'waiting',
  `wants permission: ${bash('rsync -av --delete --exclude node_modules --exclude .vite dist/ eis1:/srv/cloudcli/releases/2026-10-30/')}`, 3);

/** `home`'s focus: the chat he pressed on the rail. Put on the stage by `station-fake.ts`. */
export const HOME_FOCUS: Extract<StationFocus, { kind: 'chat' }> = { kind: 'chat', sessionId: TREE_POLISH.sessionId, label: TREE_POLISH.name };
/** `waiting`'s focus as the rail reads it: the feature whose Accept stands on the stage, one of the rail's two. */
const WAITING_CARD: StationFocus = { kind: 'card', plan: WAITING_FEATURE.name, label: 'What needs you: the right rail and the waiting-on-you state' };
/** Her mark in `walkthrough`: walking the Kanban review, her disc's initial and her words. */
const HER_WALKING: StationHerMark = { sessionId: KANBAN.sessionId, initial: 'K', words: `Kaylee is walking ${KANBAN.name}` };

/** The roadmap he selected, per picture: `lyphecli`, in `waiting` with two of the station's features owing their Accept. */
const HOME_ROADMAP = lyphecliRoadmap();
const WAITING_ROADMAP = lyphecliRoadmap({ 'kaylee-station--what-needs-you': 'accept', 'kaylee-station--cards': 'accept' });

/** The rail's props in one picture: its sessions, its roadmap and its focus, with every press doing nothing and both folds shut. */
type RailProps = Omit<ComponentProps<typeof WhereThingsStandView>, 'tier'>;
const rail = (props: Pick<RailProps, 'sessions' | 'roadmap' | 'focus'> & Partial<RailProps>) => ({
  view: WhereThingsStandView,
  props: {
    failure: null, onReread: NO_PRESS, her: null, asleepOpen: false, onAsleepOpen: NO_PRESS,
    completeOpen: false, onCompleteOpen: NO_PRESS, onPress: NO_PRESS, ...props,
  } satisfies RailProps,
});

/** The `sessions` slot's drawing in each of the four pictures. */
export const SESSIONS_FAKE = {
  home: rail({ sessions: [TREE_POLISH, UPLOADS, DRYBOOK, STATUS, KANBAN, ...ASLEEP], roadmap: HOME_ROADMAP, focus: HOME_FOCUS }),
  waiting: rail({ sessions: [UPLOADS_ASKING, TREE_POLISH, DRYBOOK, STATUS, KANBAN, ...ASLEEP], roadmap: WAITING_ROADMAP, focus: WAITING_CARD }),
  walkthrough: rail({ sessions: [DEPLOY_ASKING, KANBAN, ...ASLEEP], roadmap: HOME_ROADMAP, focus: null, her: HER_WALKING, asleepOpen: true }),
  empty: rail({ sessions: [], roadmap: null, focus: null }),
};

/**
 * The chat the rail draws by this name in a picture, its row whole (its state among it): how another region's slice names a
 * chat of the same house (`fake/dock.ts`'s draft targets, working or not as their rows say). Throws when the rail draws no
 * such chat, so a renamed fixture fails at once instead of drawing a chat no rail holds.
 */
export function railChat(picture: keyof typeof SESSIONS_FAKE, name: string): StationSession {
  const found = SESSIONS_FAKE[picture].props.sessions?.find((session) => session.name === name);
  if (found === undefined) throw new Error(`fake/sessions.ts draws no chat "${name}" in its ${picture} picture`);
  return found;
}

/** The roadmap lane's picture the live bus carries in each picture, so a feature's step phrase names what it waits on. */
export const ROADMAP_PICTURES: Record<keyof typeof SESSIONS_FAKE, RoadmapPicture> = {
  home: roadmapPictureOf(HOME_ROADMAP),
  waiting: roadmapPictureOf(WAITING_ROADMAP),
  walkthrough: roadmapPictureOf(HOME_ROADMAP),
  empty: roadmapPictureOf(null),
};

/**
 * The `sessions` slot's states no picture shows, drawn over `home`: a first read still out, a first read failed (a later failure
 * keeps the rows as they stand, so it has no drawing of its own), every chat asleep, and her mark on the closed fold's head.
 */
export const SESSIONS_STATES = {
  reading: rail({ sessions: null, roadmap: undefined, focus: null }),
  failed: rail({ sessions: null, failure: 'Your chats could not be read just now.', roadmap: HOME_ROADMAP, focus: null }),
  nothingRunning: rail({ sessions: [KANBAN, ...ASLEEP], roadmap: HOME_ROADMAP, focus: null }),
  // She reads an asleep chat the closed fold hides, so the fold's head carries her mark.
  herFolded: rail({
    sessions: [TREE_POLISH, UPLOADS, DRYBOOK, STATUS, KANBAN, ...ASLEEP], roadmap: HOME_ROADMAP, focus: null,
    her: { sessionId: ASLEEP[0].sessionId, initial: 'K', words: `Kaylee is reading ${ASLEEP[0].name}` },
  }),
};

/** `home`'s stage: the chat he pressed, drawn whole; Back returns to what stood there before it. */
export const HOME_CHAT_STAGE = {
  view: ChatStageView,
  props: { focus: HOME_FOCUS, session: TREE_POLISH, onOpenChat: NO_PRESS } satisfies ComponentProps<typeof ChatStageView>,
  canGoBack: true,
};

/** A chat the stage still holds (pressed before it went, or put back by a reload) that his sessions no longer list. */
const GONE_FOCUS: Extract<StationFocus, { kind: 'chat' }> = { kind: 'chat', sessionId: idOf(99), label: 'Spreadsheet import' };

/**
 * The chat stage's states no picture shows, as shots of their own beside the right rail's (`NEEDS_STAGE_FAKE`) and her cards'
 * (`CARDS_STAGE_FAKE`): each the picture it stands over, the focus on the stage (the rail lights its row, when the rail holds
 * it), the rail's own state meanwhile (`state`, a `SESSIONS_STATES` name, or none), and the view with its props. `chat-gone`: a
 * chat his sessions no longer list; `chat-reading`: a chat put back by a reload before his sessions are read, the rail reading
 * too. `lib/station-rail.mjs`'s `railStageRun` draws them at 1440×900 and on the phone.
 */
export const SESSIONS_STAGE_FAKE = {
  'chat-gone': {
    picture: 'home',
    focus: GONE_FOCUS,
    state: null,
    view: ChatStageView,
    props: { focus: GONE_FOCUS, session: null, onOpenChat: NO_PRESS } satisfies ComponentProps<typeof ChatStageView>,
  },
  'chat-reading': {
    picture: 'home',
    focus: HOME_FOCUS,
    state: 'reading',
    view: ChatStageView,
    props: { focus: HOME_FOCUS, session: undefined, onOpenChat: NO_PRESS } satisfies ComponentProps<typeof ChatStageView>,
  },
} satisfies Record<string, { picture: string; focus: StationFocus; state: keyof typeof SESSIONS_STATES | null; view: unknown; props: unknown }>;
