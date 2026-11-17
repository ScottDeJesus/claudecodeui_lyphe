import type { ComponentProps } from 'react';

import { ChatStageView } from '@/modules/station/ChatStage';
import { DEPLOY_CHAT, FOLLOWUPS_CHAT } from '@/modules/station/fake/needs';
import { lyphecliRoadmap, roadmapPictureOf } from '@/modules/station/fake/roadmap';
import type { RoadmapPicture } from '@/shared/roadmap-types';
import type { StationFocus, StationSession, StationSessionState } from '@/shared/station-types';

/*
 * THE HOUSE'S CHATS AND ROADMAP, for `station-fake.ts`'s pictures only: his chats as `GET /api/companion/station/sessions`
 * serves them (`StationSession`, waiting on him first, then working, idle, asleep, the most recent first inside each), each
 * line as the roster spells it (a working chat's last tool call or last words, a waiting chat's ask, a resting chat's
 * "idle 12 min"), and the roadmap `lyphecli` (`fake/roadmap.ts`). Ids are in a range no store has minted, so a press on one
 * could find nothing. Times are relative to when the fixture loads. Nothing in the app imports this file.
 *
 * ONE HOUSE PER PICTURE: a chat the needs' samples name (`fake/needs.ts`) is among these, in the state its need implies —
 * `home`'s chat with open follow-ups, `walkthrough`'s chat waiting on a permission. Every other sample that names a chat
 * (her cards, the conversation, the dock's draft targets) reads its row from here by name (`railChat`).
 *
 * THE PICTURES: `home` three working, one idle and eleven asleep, and the chat he pressed on the stage (`HOME_CHAT_STAGE`);
 * `waiting` three working, two idle and the asleep, and the roadmap with the feature on the stage and the epic `kaylee-desk`
 * standing at "waiting on you: Accept"; `walkthrough` the deploy chat waiting on its permission at the head; `empty` no chat
 * and no roadmap.
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
  sessionId: typeof n === 'string' ? n : idOf(n), name, project, state, activity, updatedAt: ago(minutes), pinned: false,
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
/**
 * Two more of `waiting`'s chats: one whose background agent finished minutes ago, idle since, and the chat that asked for a
 * feature that finished three hours ago, asleep since.
 */
const BACKUP_DRILL = resting(203, 'Backup drill and XactAnalysis polls', 'house', 'live', 6);
const KAYLEE_STATION = resting(202, 'Kaylee Station', 'lyphecli', 'asleep', 190);
/** `waiting`'s chats in her order: the asleep ones with the feature's chat among them, by how long each has rested. */
const WAITING_SESSIONS = [TREE_POLISH, UPLOADS, DRYBOOK, BACKUP_DRILL, STATUS, KANBAN, ASLEEP[0], ASLEEP[1], KAYLEE_STATION, ...ASLEEP.slice(2)];
/** `walkthrough`'s head: the chat whose permission the right rail holds in that picture, waiting on it. */
const DEPLOY_ASKING = chat(DEPLOY_CHAT.sessionId, DEPLOY_CHAT.chat, 'lyphecli', 'waiting',
  `wants permission: ${bash('rsync -av --delete --exclude node_modules --exclude .vite dist/ eis1:/srv/cloudcli/releases/2026-10-30/')}`, 3);

/** `home`'s focus: the chat he pressed on the rail. Put on the stage by `station-fake.ts`. */
export const HOME_FOCUS: Extract<StationFocus, { kind: 'chat' }> = { kind: 'chat', sessionId: TREE_POLISH.sessionId, label: TREE_POLISH.name };
/**
 * The roadmap he selected, per picture: `lyphecli`, in `waiting` with the feature on the stage owing its Accept and the epic
 * `kaylee-desk` (three features) owing the epic's.
 */
const HOME_ROADMAP = lyphecliRoadmap();
const WAITING_ROADMAP = lyphecliRoadmap({ 'kaylee-station--what-needs-you': 'accept' }, { desk: true });

/** The house's chats in each of the four pictures. */
export const HOUSE_CHATS: Record<'home' | 'waiting' | 'walkthrough' | 'empty', StationSession[]> = {
  home: [TREE_POLISH, UPLOADS, DRYBOOK, STATUS, KANBAN, ...ASLEEP],
  waiting: WAITING_SESSIONS,
  walkthrough: [DEPLOY_ASKING, KANBAN, ...ASLEEP],
  empty: [],
};

/**
 * The chat the house holds by this name in a picture, its row whole (its state among it): how another sample names a chat of
 * the same house (`fake/dock.ts`'s draft targets, working or not as their rows say). Throws when the house holds no such chat,
 * so a renamed fixture fails at once instead of drawing a chat no picture holds.
 */
export function railChat(picture: keyof typeof HOUSE_CHATS, name: string): StationSession {
  const found = HOUSE_CHATS[picture].find((session) => session.name === name);
  if (found === undefined) throw new Error(`fake/sessions.ts holds no chat "${name}" in its ${picture} picture`);
  return found;
}

/** The roadmap lane's picture the live bus carries in each picture, so a feature's step phrase names what it waits on. */
export const ROADMAP_PICTURES: Record<keyof typeof HOUSE_CHATS, RoadmapPicture> = {
  home: roadmapPictureOf(HOME_ROADMAP),
  waiting: roadmapPictureOf(WAITING_ROADMAP),
  walkthrough: roadmapPictureOf(HOME_ROADMAP),
  empty: roadmapPictureOf(null),
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
 * The chat stage's states no picture shows, as shots of their own beside the needs' (`NEEDS_STAGE_FAKE`) and her cards'
 * (`CARDS_STAGE_FAKE`): each the picture it stands over, the focus on the stage, and the view with its props. `chat-gone`: a
 * chat his sessions no longer list; `chat-reading`: a chat put back by a reload before his sessions are read.
 */
export const SESSIONS_STAGE_FAKE = {
  'chat-gone': {
    picture: 'home',
    focus: GONE_FOCUS,
    view: ChatStageView,
    props: { focus: GONE_FOCUS, session: null, onOpenChat: NO_PRESS } satisfies ComponentProps<typeof ChatStageView>,
  },
  'chat-reading': {
    picture: 'home',
    focus: HOME_FOCUS,
    view: ChatStageView,
    props: { focus: HOME_FOCUS, session: undefined, onOpenChat: NO_PRESS } satisfies ComponentProps<typeof ChatStageView>,
  },
} satisfies Record<string, { picture: string; focus: StationFocus; view: unknown; props: unknown }>;
