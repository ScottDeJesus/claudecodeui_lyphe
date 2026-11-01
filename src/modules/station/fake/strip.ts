import type { ComponentProps } from 'react';

import { LANDED_UNREACHABLE } from '@/modules/station/context/StationLandedContext';
import { railChat } from '@/modules/station/fake/sessions';
import { SinceYouLastLookedView } from '@/modules/station/SinceYouLastLooked';
import type { StationLanded } from '@/shared/station-types';

/*
 * THE STRIP'S FIXTURE DATA, for `station-fake.ts`'s pictures only: "Since you last looked" in each of the four, as
 * `{ view, props }` drawings of `SinceYouLastLookedView`. Every entry is a `StationLanded`, every key the wire carries,
 * worded as the notification history keeps the four codes it reads ("Feature finished · <plan>", "Epic finished ·
 * <epic>", "Background agent finished · <chat>", Cerberus's own sentence for a check gone green). Ids are above 900000,
 * which no history row of the dev store reaches, and the chat ids are made up: nothing here names a real chat. Nothing in
 * the app imports this file.
 *
 * Times are relative to when the fixture loads, so a picture reads the same any day: "today" is minutes ago, and an older
 * landing is pinned to a clock time on a calendar day before today, so its words ("yesterday 19:34", "Oct 26") are the
 * ones the strip spells for that day.
 *
 * - `home`: five landings, two of them new: one by a chat, one shipped, one recovered (its line opens in place).
 * - `waiting`: three landings, one new. Its house is the picture's: the chats it names are rows of that picture's left rail
 *   (`railChat`), and the feature it says finished is shipped on that picture's roadmap, the one the feature on the stage waits on.
 * - `walkthrough`: three landings, none new.
 * - `empty`: nothing this week.
 *
 * Each drawing is open (`collapsed: false`); the shots probe draws each one folded too. The states no picture shows are
 * `STRIP_STATES`: the first read still out, a read that failed, and `home`'s week with no last look on record.
 */

const NOW = new Date();

/** A stamp `minutes` before the fixture loads, as the history writes one. */
const ago = (minutes: number): string => new Date(NOW.getTime() - minutes * 60_000).toISOString();

/** A stamp at `hour`:`minute` on this machine's clock, `days` calendar days before today. */
const dayAt = (days: number, hour: number, minute: number): string =>
  new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - days, hour, minute).toISOString();

/** A press a picture never makes: the shots photograph, they do not press (a recovered entry's fold is the view's own). */
const NO_PRESS = () => {};

/**
 * The strip's drawing: open, with the landings (newest first, as the read answers) and his last look, and whatever `over`
 * lays on them.
 */
function drawing(landed: StationLanded[] | null, seenAt: string | null, over: { failure?: string } = {}) {
  return {
    view: SinceYouLastLookedView,
    props: {
      landed,
      seenAt,
      collapsed: false,
      onCollapse: NO_PRESS,
      onSeen: NO_PRESS,
      onPress: NO_PRESS,
      failure: over.failure ?? null,
      onReread: NO_PRESS,
    } satisfies Omit<ComponentProps<typeof SinceYouLastLookedView>, 'tier' | 'density'>,
  };
}

/** `home`: the week so far, his last look an hour ago, two landings since. */
const HOME: StationLanded[] = [
  { id: 900105, at: ago(9), kind: 'epic', title: 'Epic finished · kaylee', plan: 'kaylee', sessionId: null, chat: null },
  {
    id: 900104, at: ago(38), kind: 'landed', title: 'Background agent finished · Kaylee’s wishlist', plan: null,
    sessionId: '00000000-0000-4000-8000-000000900104', chat: 'Kaylee’s wishlist',
  },
  {
    id: 900103, at: ago(150), kind: 'recovered', plan: null, sessionId: null, chat: null,
    title: 'A restore drill passed in the last 35 days on eis1 is green again after 21 d',
  },
  { id: 900102, at: dayAt(1, 19, 34), kind: 'shipped', title: 'Feature finished · kaylee--eyes', plan: 'kaylee--eyes', sessionId: null, chat: null },
  { id: 900101, at: dayAt(4, 11, 15), kind: 'epic', title: 'Epic finished · sidebar-rail', plan: 'sidebar-rail', sessionId: null, chat: null },
];

/** The chats `waiting`'s landings name: rows of that picture's left rail, so the strip and the rail name one house. */
const BACKUP_DRILL = railChat('waiting', 'Backup drill and XactAnalysis polls');
const KAYLEE_STATION = railChat('waiting', 'Kaylee Station');

/** `waiting`: one landing since his last look, a chat's backgrounded work. */
const WAITING: StationLanded[] = [
  {
    id: 900203, at: ago(6), kind: 'landed', title: `Background agent finished · ${BACKUP_DRILL.name}`, plan: null,
    sessionId: BACKUP_DRILL.sessionId, chat: BACKUP_DRILL.name,
  },
  {
    id: 900202, at: ago(190), kind: 'shipped', title: 'Feature finished · kaylee-station--shell', plan: 'kaylee-station--shell',
    sessionId: KAYLEE_STATION.sessionId, chat: KAYLEE_STATION.name,
  },
  {
    id: 900201, at: dayAt(1, 8, 5), kind: 'recovered', plan: null, sessionId: null, chat: null,
    title: 'The dispatcher answers on :8004 again after 6 min without a heartbeat',
  },
];

/** `walkthrough`: he looked minutes ago, after the newest landing. */
const WALKTHROUGH: StationLanded[] = [
  { id: 900303, at: ago(25), kind: 'epic', title: 'Epic finished · kaylee', plan: 'kaylee', sessionId: null, chat: null },
  {
    id: 900302, at: ago(130), kind: 'landed', title: 'Background agent finished · Live mode', plan: null,
    sessionId: '00000000-0000-4000-8000-000000900302', chat: 'Live mode',
  },
  { id: 900301, at: dayAt(2, 16, 40), kind: 'shipped', title: 'Feature finished · kaylee--memory', plan: 'kaylee--memory', sessionId: null, chat: null },
];

/** The strip in each of the four pictures: its view, and the props it draws that picture with. */
export const STRIP_FAKE = {
  home: drawing(HOME, ago(70)),
  waiting: drawing(WAITING, ago(45)),
  walkthrough: drawing(WALKTHROUGH, ago(4)),
  empty: drawing([], dayAt(3, 9, 12)),
};

/**
 * The strip's states no picture shows, each drawn by the shots probe over the `home` picture: the first read still out; a
 * read that failed, in the provider's own sentence for a request that got no answer (`LANDED_UNREACHABLE`); and `home`'s week with no
 * last look on record (every landing new, no rule).
 */
export const STRIP_STATES = {
  reading: drawing(null, ago(70)),
  failed: drawing(null, ago(70), { failure: LANDED_UNREACHABLE }),
  'first-look': drawing(HOME, null),
};
