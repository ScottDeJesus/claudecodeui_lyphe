import type { ComponentProps } from 'react';

import { ALL_CARDS, SHELF_NOTES } from '@/modules/station/fake/cards';
import { SESSIONS_FAKE } from '@/modules/station/fake/sessions';
import { StationConversationView } from '@/modules/station/StationConversation';
import type { CompanionActivity, CompanionLogEntry, CompanionPicture, CompanionSessionRef, CompanionSettings } from '@/shared/companion-types';
import type { CompanionSentenceRef } from '@/shared/types';

/*
 * HER CONVERSATION'S FIXTURES, and her picture in each of the station's four, for `station-fake.ts`'s pictures only. Nothing
 * in the app imports this file; `fake/head.ts` and `fake/talk.ts` draw her head and her talk control from the same pictures.
 *
 * Every picture is a `CompanionPicture` as `GET /api/companion` answers it: her log as `CompanionLogEntry` rows (his lines with
 * how they came, her sentences joined by their turn and ordered by their index, the house's alerts and her harness's system
 * lines), her cards as her picture holds them (`fake/cards.ts`'s own, so the stage's shelf and the conversation draw one card
 * set), her process, her activity, the turn she is answering. Log ids are above 900500, where no store has minted one; the
 * chats are the left rail's own (`fake/sessions.ts`). Times are relative to when the fixture loads.
 *
 * - `home`: a morning exchange. She put the uncommitted diff up while she answered, so it stands under that answer; the list
 *   of runs he pinned three hours ago is older than this conversation and stands on the shelf alone.
 * - `waiting`: her line naming the two Accepts and the red check the right rail holds, then his "Queue Kaylee's desk" and her
 *   read-back, its last sentence being spoken (marked).
 * - `walkthrough`: her paragraph on item 4 of 15 of the Kanban lane review, still being said; her activity Walking.
 * - `empty`: her picture read, her process asleep, nothing said yet: the empty log.
 *
 * `CONVERSATION_STATES` are the states no picture shows, drawn over `home` in the slot's place: no picture yet (`loading`), a
 * read that failed (`failed`), her answer begun with no sentence yet (`answering`), and three hours with every kind of line and
 * all seven of her cards standing where she put them (`dense`).
 */

const NOW = Date.now();
/** A stamp `minutes` before the fixture loads, ISO, as the wires write one. */
const ago = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString();

/** A press a picture never makes: the shots photograph, they do not press. */
const NO_PRESS = () => {};

/** The chat a picture's left rail draws by this name, as her activity names it. */
function railChat(picture: keyof typeof SESSIONS_FAKE, name: string): CompanionSessionRef {
  const found = SESSIONS_FAKE[picture].props.sessions?.find((session) => session.name === name);
  if (found === undefined) throw new Error(`fake/sessions.ts draws no chat "${name}" in its ${picture} picture`);
  return { sessionId: found.sessionId, name: found.name, project: found.project };
}

/** The chat he pressed in `home`, the chat whose permission `waiting`'s rail heads, and the chat she walks in `walkthrough`. */
export const TREE_POLISH = railChat('home', 'Roadmap tree polish');
export const UPLOADS = railChat('home', 'Restorly uploads handoff');
export const KANBAN = railChat('walkthrough', 'Kanban lane review');

let nextId = 900_501;
type Sounds = CompanionLogEntry['sounds'];
/** His line, `minutes` ago, typed or spoken. */
const he = (minutes: number, text: string, via: 'typed' | 'spoken' = 'typed'): CompanionLogEntry => (
  { id: nextId++, at: ago(minutes), role: 'operator', via, turnId: null, index: null, text, mood: null, sounds: [] });
/** One sentence of hers, the `index`th of turn `turnId`, its sounds at their offsets. */
const she = (minutes: number, turnId: string, index: number, text: string, sounds: Sounds = []): CompanionLogEntry => (
  { id: nextId++, at: ago(minutes), role: 'kaylee', via: null, turnId, index, text, mood: null, sounds });
/** The house's alert, or her harness's system line. */
const house = (minutes: number, role: 'alert' | 'system', text: string): CompanionLogEntry => (
  { id: nextId++, at: ago(minutes), role, via: null, turnId: null, index: null, text, mood: null, sounds: [] });

const HOME_LOG = [
  he(34, 'Morning. What landed overnight?'),
  she(33, 'h1', 0, 'Morning, Scott!', [{ tag: 'giggle', at: 15 }]),
  she(33, 'h1', 1, 'Three things landed while you slept: the Safari lane-drag fix, the memory corner, and the strip that says what landed since you last looked.'),
  she(33, 'h1', 2, 'One chat is still going, the Restorly uploads handoff, and it will want to sync the build to the box.'),
  he(27, 'What did the lane-drag fix change?', 'spoken'),
  she(26, 'h2', 0, 'Two files in the kanban module, and a guard in the drag hook.'),
  she(25.5, 'h2', 1, 'I put the uncommitted diff on your screen, so you can read it before it ships.'),
  he(4, 'Thanks. Keep an eye on the uploads chat for me.'),
  she(3, 'h3', 0, 'Will do. I\'ll tell you the moment it stops on a permission.'),
];

const WAITING_LOG = [
  he(9, 'What needs me?', 'spoken'),
  she(8, 'w1', 0, 'Two Accepts are waiting on you: What needs you, the right rail, and Kaylee\'s desk, an epic of three features.'),
  she(8, 'w1', 1, 'And Cerberus has one red check: Session is valid, on eis1, because the shadow connector\'s session token expired.'),
  he(2, 'Queue Kaylee\'s desk.', 'spoken'),
  she(1, 'w2', 0, 'Kaylee\'s desk: seven tasks over three features.'),
  she(1, 'w2', 1, 'Say yes and I\'ll queue it.'),
];
/** The sentence `waiting`'s page is sounding: the last of her read-back. */
export const WAITING_SPEAKING: CompanionSentenceRef = { turnId: 'w2', index: 1 };

const WALK_LOG = [
  he(11, 'Walk me through the Kanban lane review.', 'spoken'),
  she(10, 'k1', 0, 'Fifteen items in the Kanban lane review.'),
  she(10, 'k1', 1, 'I\'ll take them one at a time; say next when you\'re ready.'),
  he(5, 'Next.', 'spoken'),
  she(5, 'k3', 0, 'Item three: the WIP limit badge stays amber for a second after a card leaves the lane.'),
  he(1, 'Next.', 'spoken'),
  she(0.8, 't-walk', 0, 'Item four of fifteen: archived cards still count toward the Done lane\'s total in the header.'),
  she(0.5, 't-walk', 1, 'The header counts every row of the lane, archived ones too, so Done says 41 while 33 show.'),
];

/** Three hours: every kind of line, a press that carried no words, and each of her seven cards after the answer she put it up in. */
const DENSE_LOG = [
  he(185, 'Show me the recent runs.', 'spoken'),
  she(182, 'd1', 0, 'Here are the recent runs. Two of them failed overnight.'),
  house(150, 'alert', 'Restorly uploads handoff finished its turn.'),
  he(125, 'What is the design of the what-needs-you feature?'),
  she(121, 'd2', 0, 'Its design is on your screen: the right rail, and the waiting-on-you state.'),
  he(95, '', 'spoken'),
  she(94, 'd3', 0, 'I didn\'t catch that one.'),
  he(92, 'Remind me what to do before I sleep.', 'spoken'),
  she(91, 'd4', 0, 'A note is up: push the station branch, and leave the uploads chat running.'),
  he(72, 'Open your memory page.', 'spoken'),
  she(71, 'd5', 0, 'My memory\'s page is up.'),
  house(40, 'system', 'Kaylee\'s turn broke: the Claude CLI exited with code 1.'),
  he(27, 'What changed in the repo?'),
  she(26, 'd6', 0, 'The uncommitted diff is on your screen: seven lines in, two out.'),
  he(13, 'Anything in my inbox?', 'spoken'),
  she(12.5, 'd7', 0, 'Six things wait in your inbox; the list is up.'),
  he(4, 'How did the uploads run end?', 'spoken'),
  she(3.5, 'd8', 0, 'Its run\'s report is on your screen.'),
];

/** Her settings as the station reads them: his names, her model and Live, and the key bound to her talk press. */
const SETTINGS: CompanionSettings = {
  name: 'Kaylee', operatorName: 'Scott', register: '', deliveryNote: 'bright, warm, quick, a smile in the voice', model: 'sonnet', live: false,
  talkBinding: { kind: 'key', code: 'F8', ctrl: false, alt: false, shift: false, meta: false, label: 'F8' },
};
const IDLE: CompanionActivity = { phase: 'idle', session: null, files: null, walk: null };

/** A picture: an awake, idle companion with nothing said, and whatever a picture changes. */
export const picture = (change: Partial<CompanionPicture>): CompanionPicture => ({
  settings: SETTINGS,
  models: [
    { value: 'sonnet', label: 'Sonnet 5.5' }, { value: 'fable', label: 'Fable 5.1' }, { value: 'opus', label: 'Opus 5.5' }, { value: 'haiku', label: 'Haiku 5.5' },
  ],
  process: { state: 'awake', error: null }, activity: IDLE, turnId: null, focus: null, draft: null, pending: null, walk: null,
  notes: [], log: [], floor: 'fixture-station', face: { id: null, original: true, bake: null }, ...change,
});

/** Her picture in each of the station's four: what her head, her conversation and her talk control are drawn from. */
export const HER_PICTURES = {
  home: picture({ log: HOME_LOG, notes: SHELF_NOTES.home }),
  waiting: picture({ log: WAITING_LOG, notes: SHELF_NOTES.waiting, settings: { ...SETTINGS, live: true, talkBinding: { kind: 'mouse', button: 3, label: 'Mouse back' } } }),
  walkthrough: picture({
    log: WALK_LOG, notes: SHELF_NOTES.walkthrough, turnId: 't-walk', focus: KANBAN,
    activity: { ...IDLE, phase: 'walking', session: KANBAN, walk: { at: 4, total: 15 } },
  }),
  empty: picture({ process: { state: 'asleep', error: null }, settings: { ...SETTINGS, talkBinding: null } }),
};

/** The conversation's drawing: her picture (null: no picture yet), and whatever a state changes. */
function drawing(her: CompanionPicture | null, over: Partial<Omit<ComponentProps<typeof StationConversationView>, 'tier'>> = {}) {
  return {
    view: StationConversationView,
    props: {
      picture: her, readFailure: null, onReread: NO_PRESS, name: her?.settings.name ?? 'Kaylee', speaking: null, onOpenCard: NO_PRESS, ...over,
    } satisfies Omit<ComponentProps<typeof StationConversationView>, 'tier'>,
  };
}

/** The conversation in each of the four pictures. */
export const CONVERSATION_FAKE = {
  home: drawing(HER_PICTURES.home),
  waiting: drawing(HER_PICTURES.waiting, { speaking: WAITING_SPEAKING }),
  walkthrough: drawing(HER_PICTURES.walkthrough),
  empty: drawing(HER_PICTURES.empty),
};

/** The conversation's states no picture shows, each drawn by the shots probe over the `home` picture. */
export const CONVERSATION_STATES = {
  loading: drawing(null),
  failed: drawing(null, { readFailure: 'Failed to fetch' }),
  answering: drawing(picture({ log: [...HOME_LOG, he(0.2, 'Is the uploads chat still waiting?')], notes: SHELF_NOTES.home, turnId: 'h4' })),
  dense: drawing(picture({ log: DENSE_LOG, notes: ALL_CARDS, settings: { ...SETTINGS, live: true } })),
};
