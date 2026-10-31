import type { ComponentProps } from 'react';

import { railChat } from '@/modules/station/fake/sessions';
import { StationDockView } from '@/modules/station/StationDock';
import type { CompanionDraft } from '@/shared/companion-types';
import type { StationSession } from '@/shared/station-types';

/*
 * THE DRAFT DOCK'S FIXTURES, for `station-fake.ts`'s pictures only: her draft as `GET /api/companion` holds it (`CompanionDraft`),
 * drawn by `StationDockView`. Nothing in the app imports this file.
 *
 * ONE HOUSE PER PICTURE: a draft's target is a chat the left rail draws in the same picture (`fake/sessions.ts`), and whether it
 * is working is read off that row as the live dock reads it: `working`, or `waiting` (stopped on an ask, its run held).
 *
 * - `home`: a three-paragraph brief for "Restorly uploads handoff", which is working: Send steer leads, Send turn follows, and
 *   the chat's name is a press that would put it on the stage.
 * - `waiting`: no draft, so the dock is its one quiet line.
 * - `walkthrough`: the brief she built over her walk of the Kanban lane review, his answers to items 1 to 3 in it, long enough
 *   that a laptop's dock gives way; the chat is asleep, so Send turn stands alone.
 * - `empty`: no draft, the one quiet line.
 *
 * `DOCK_STATES`, drawn over `home` in the slot's place: `newChat`, a brief for a chat not yet started in a project, whose target
 * stays words (there is no session to show yet) and whose one send is Send turn; `refused`, `home`'s brief whose send the server
 * refuses with its own sentence, which the probe presses so the card's refusal stands under its sends.
 *
 * EVERY VERB IS RECORDED, never acted on: each drawing's `onEdit`, `onSend`, `onClear` and `onTargetPress` writes what it was
 * handed to `DOCK_PRESSES`, which the shots probe reads after it taps the dock's presses with the keyboard up.
 */

const NOW = Date.now();
/** A stamp `minutes` before the fixture loads, ISO, as the wire writes one. */
const ago = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString();

/**
 * The verbs the dock's drawings ran, oldest first, as the probe reads them: `['edit', text]`, `['send', mode]`, `['clear']`,
 * `['show']` (the target's press). The probe empties it before it taps; nothing else reads it.
 */
export const DOCK_PRESSES: string[][] = [];

/** A draft for one of the rail's chats, changed `minutes` ago. */
const draftFor = (chat: StationSession, text: string, minutes: number): CompanionDraft => ({
  target: { kind: 'session', session: { sessionId: chat.sessionId, name: chat.name, project: chat.project } },
  text,
  updatedAt: ago(minutes),
});

/** Whether a chat has a turn to steer, as the live dock reads its row: working, or stopped on an ask with its run held. */
const working = (chat: StationSession): boolean => chat.state === 'working' || chat.state === 'waiting';

/** `home`'s target, working; and the chat she walks in `walkthrough`, asleep since its turn ended. */
const UPLOADS = railChat('home', 'Restorly uploads handoff');
const KANBAN = railChat('walkthrough', 'Kanban lane review');

/** `home`'s brief: three paragraphs for the uploads chat, which is working on a turn of its own. */
const UPLOADS_BRIEF = [
  'Hold each upload batch to 12 photos: the box refuses any request over 25 MB, and three of this morning\'s jobs went over with their drone shots.',
  'When a batch is refused, keep its photos in the tray with their names and say which one was too large, instead of clearing the tray behind the generic error.',
  'Before you deploy, run the uploads tab against job 26-04418 and put the count the drawer shows beside the count on the server, so we know nothing was lost on the way.',
].join('\n\n');

/** `walkthrough`'s brief, built over her walk of the Kanban lane review: his answers to items 1 to 3, as she wrote them in. */
const KANBAN_BRIEF = [
  'From the Kanban lane review, items 1 to 3 as Scott answered them on the walk:',
  '',
  '1. The lane\'s count after a drag between two lanes: fix it. Recount both lanes from the board once the drop lands, never from the drag\'s own tally.',
  '2. A card dropped on a collapsed lane: keep the first slot, as it lands now, but open the lane so the card is seen where it went.',
  '3. The WIP badge staying amber after a card leaves: fix it. Read the lane\'s count after the move, in the same frame as the card leaving.',
  '',
  'Do 1 and 3 first, then 2, and show the drag on a phone before calling it done. Items 4 to 15 are still being walked; their answers land here as he gives them.',
].join('\n');

/** A brief for a chat not yet started in this repo. */
const NEW_CHAT_DRAFT: CompanionDraft = {
  target: { kind: 'new', projectPath: '/home/lyphe/.claude/claudecodeui_lyphe', projectName: 'claudecodeui_lyphe' },
  text: 'List every chat asleep for more than a week, with its project and its last line, and give each one press to wake it or archive it. Read only until he presses.',
  updatedAt: ago(3),
};

/**
 * The server's refusal of a send to a chat he no longer has, word for word as `companion-send.ts` writes it (an archived or
 * deleted chat): three lines under the card's sends at 1440×900.
 */
const ARCHIVED_REFUSAL = `"${UPLOADS.name}" is no longer a chat he has (it was archived or deleted), so nothing was sent. Tell him, and ask which chat the brief is for.`;

/**
 * The dock's drawing for one draft (null: she holds none), every verb recorded in `DOCK_PRESSES` and answered at once — a send
 * refused with `refusal` when one is given, as the server answers it.
 */
const dock = (draft: CompanionDraft | null, targetWorking = false, refusal: string | null = null) => ({
  view: StationDockView,
  props: {
    draft,
    name: 'Kaylee',
    targetWorking,
    onEdit: (text: string) => { DOCK_PRESSES.push(['edit', text]); return Promise.resolve(); },
    onSend: (mode: string) => {
      DOCK_PRESSES.push(['send', mode]);
      return refusal === null ? Promise.resolve() : Promise.reject(new Error(refusal));
    },
    onClear: () => { DOCK_PRESSES.push(['clear']); return Promise.resolve(); },
    onTargetPress: () => { DOCK_PRESSES.push(['show']); },
  } satisfies Omit<ComponentProps<typeof StationDockView>, 'tier' | 'density'>,
});

/** The `dock` slot's drawing in each of the four pictures: its quiet line wherever she holds no draft, never nothing. */
export const DOCK_FAKE = {
  home: dock(draftFor(UPLOADS, UPLOADS_BRIEF, 6), working(UPLOADS)),
  waiting: dock(null),
  walkthrough: dock(draftFor(KANBAN, KANBAN_BRIEF, 1), working(KANBAN)),
  empty: dock(null),
};

/** The dock's states no picture shows, drawn by the shots probe over the `home` picture: a brief for a new chat, and a refused send. */
export const DOCK_STATES = {
  newChat: dock(NEW_CHAT_DRAFT),
  refused: dock(draftFor(UPLOADS, UPLOADS_BRIEF, 6), working(UPLOADS), ARCHIVED_REFUSAL),
};
