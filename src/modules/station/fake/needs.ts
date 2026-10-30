import type { ComponentProps } from 'react';

import { AskStageView } from '@/modules/station/AskStage';
import { CheckStageView } from '@/modules/station/CheckStage';
import { WAITING_FEATURE } from '@/modules/station/fake/stage';
import { FollowupsStageView } from '@/modules/station/FollowupsStage';
import { WhatNeedsYouView } from '@/modules/station/WhatNeedsYou';
import type { CerberusNeed } from '@/shared/cerberus-types';
import type { CompanionPendingAction } from '@/shared/companion-types';
import type { StationFocus, StationNeed } from '@/shared/station-types';
import type { Followup } from '@/shared/types';

/*
 * THE RIGHT RAIL'S FIXTURE DATA, for `station-fake.ts`'s pictures and the shots of the rail's three stages only. Nothing in the
 * app imports this file.
 *
 * Every item is a `StationNeed` as `GET /api/companion/station/needs` answers it (`server/modules/companion/station/
 * need-readers.ts`): its id in the reader's own form, its words built as `sayOf` builds them (an Accept's "Queue <the name he
 * says it by>", a title of six words or fewer, else the plan's name with its dashes read as spaces; "Allow <chat>"; "Open
 * <chat>"; "Open <check label>"), an ask's `what` as `describeToolInput` prints a command. The pending action is a
 * `CompanionPendingAction` as her picture holds one. Ids and request ids no store holds (above 900000, as `fake/stage.ts`
 * keeps them), and made-up chat ids: nothing here names a real chat, ask or check. Times are relative to when it loads.
 *
 * - `waiting`: the "waiting on you" state — the waiting feature's Accept (its card is on the stage), an epic's Accept over
 *   three features, a red check, and her action waiting for his word: "Queue Kaylee’s desk", the epic's census its prompt;
 * - `home`: one chat's follow-ups;
 * - `walkthrough`: one chat's permission, a deploy whose command wraps on a phone;
 * - `empty`: nothing, and no action: "Nothing needs you."
 *
 * `NEEDS_STATES` are the rail's states no picture shows, drawn over `home` in the slot's place: the first read still out
 * (`reading`), a read that failed with nothing read before (`failed`: the server's own sentence, Try again), and a read whose
 * dispatcher and Cerberus readers failed while the follow-ups answered (`faults`).
 *
 * `NEEDS_STAGE_FAKE` is one drawing per stage — the ask's on the permission, the follow-ups' on that chat's list, the check's on
 * the red check's Cerberus card — each with the picture whose rail holds its item, for the shots probe.
 */

const NOW = Date.now();
/** A stamp `minutes` before the fixture loads, ISO, as the wires write one. */
const ago = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString();

/** A press a picture never makes: the shots photograph, they do not press. */
const NO_PRESS = () => {};
/** The action card's × on a picture: drawn, never pressed. */
const NO_WITHDRAW = () => Promise.resolve();

/** The waiting feature's Accept: the lock `fake/stage.ts` puts on its card, which the `waiting` picture's stage holds. */
const WAITING_ASK = WAITING_FEATURE.asking;
const FEATURE_ACCEPT: Extract<StationNeed, { kind: 'accept' }> = {
  kind: 'accept',
  id: `accept:${WAITING_ASK?.asked.id ?? 900101}-${WAITING_ASK?.asked.at ?? ago(6)}`,
  card: WAITING_FEATURE.name,
  epic: false,
  title: 'What needs you: the right rail and the waiting-on-you state',
  headline: 'kaylee-station--what-needs-you — 7 tasks',
  features: 1,
  say: 'Queue kaylee station what needs you',
};

/** The epic's census, as the dispatcher prints a lock over several features: every plan named, each phase line owned. */
const EPIC_CENSUS = [
  'kaylee-desk--notes + kaylee-desk--pins + kaylee-desk--clock — 7 tasks',
  '',
  'Her desk: the notes she keeps for him, the cards he pins, and the clock she tells the time by.',
  '',
  'Repo ~/.claude/claudecodeui_lyphe · Epic kaylee-desk · 7 tasks in 3 features · 9 decisions settled',
  '',
  'kaylee-desk--notes · 1. Her notes as cards on the station — hephaestus/sonnet',
  'kaylee-desk--notes · 2. A pinned note stays through a clear — hephaestus/sonnet — after 1',
  'kaylee-desk--notes · 3. The notes, composed — iris/opus',
  'kaylee-desk--pins · 1. His pins, kept per device — hephaestus/sonnet',
  'kaylee-desk--pins · 2. The pins, composed — iris/opus — after 1',
  'kaylee-desk--clock · 1. The clock she speaks in — hephaestus/sonnet',
  'kaylee-desk--clock · 2. The docstore says what landed — prometheus/sonnet — after 1',
  '',
  'Run it? · lock:station-fake-0000000002',
].join('\n');

/** An epic's Accept: one lock over its three features, one item naming the epic (the Inbox's rule). */
const EPIC_ACCEPT: StationNeed = {
  kind: 'accept',
  id: `accept:900102-${ago(31)}`,
  card: 'kaylee-desk',
  epic: true,
  title: 'Kaylee’s desk',
  headline: 'kaylee-desk--notes + kaylee-desk--pins + kaylee-desk--clock — 7 tasks',
  features: 3,
  say: 'Queue Kaylee’s desk',
};

/** The red check, failing 23 minutes. */
const CHECK_SINCE = NOW - 23 * 60_000;
const RED_CHECK: StationNeed = {
  kind: 'check',
  id: 'check:eis1/shadow-connector/session.valid',
  node: 'eis1',
  key: 'shadow-connector/session.valid',
  label: 'Session is valid',
  status: 'failing',
  value: '401 from the shadow connector: the session token expired at 13:52',
  since: CHECK_SINCE,
  say: 'Open Session is valid',
};

/** Her action waiting for his word: he asked her to queue the epic, she read it back, and the card waits for his yes. */
const PENDING: CompanionPendingAction = {
  id: '900201',
  action: 'queue',
  target: { kind: 'card', name: 'kaylee-desk.arc', spoken: 'Kaylee’s desk', arc: null },
  prompt: EPIC_CENSUS,
  carried: [],
  say: 'Queue Kaylee’s desk',
  preparedAt: ago(1),
  expiresAt: new Date(NOW + 29 * 60_000).toISOString(),
};

/**
 * The `home` picture's chat with open follow-ups, and the `walkthrough` picture's chat waiting on a permission. Exported for the
 * left rail's slice (`fake/sessions.ts`), which lists these same chats, so the two rails of one picture name one house.
 */
export const FOLLOWUPS_CHAT = { sessionId: '00000000-0000-4000-8000-000000900301', chat: 'Lane drag on touch' };
export const DEPLOY_CHAT = { sessionId: '00000000-0000-4000-8000-000000900401', chat: 'Deploy the station build' };

const FOLLOWUPS: StationNeed = {
  kind: 'followups',
  id: `followups:${FOLLOWUPS_CHAT.sessionId}`,
  ...FOLLOWUPS_CHAT,
  count: 4,
  newest: 'Check the drag on an iPad in landscape before it ships: the lane scrolled under the finger last time.',
  say: `Open ${FOLLOWUPS_CHAT.chat}`,
};

/** A permission whose command is long enough to wrap at 390 px, with one more ask waiting behind it. */
const PERMISSION: Extract<StationNeed, { kind: 'ask' }> = {
  kind: 'ask',
  id: 'ask:station-fake-request-900402',
  ...DEPLOY_CHAT,
  requestId: 'station-fake-request-900402',
  ask: 'permission',
  tool: 'Bash',
  what: 'Bash rsync -av --delete --exclude node_modules --exclude .vite dist/ eis1:/srv/cloudcli/releases/2026-10-30/ && ssh eis1 "ln -sfn /srv/cloudcli/releases/2026-10-30 /srv/cloudcli/current && systemctl --user restart cloudcli"',
  cut: false,
  rule: 'Bash(rsync:*)',
  options: [],
  more: 1,
  say: `Allow ${DEPLOY_CHAT.chat}`,
};

/** What else a drawing of the rail may hold: the kinds the server could not read, and a read that failed whole. */
type ReadTrouble = { faults?: StationNeed['kind'][]; failure?: string | null };

/**
 * The rail's drawing in one picture: what needs him (null: not read yet), her pending action, the thing on the stage, and any
 * trouble the read had.
 */
function drawing(needs: StationNeed[] | null, pending: CompanionPendingAction | null, focus: StationFocus | null, { faults = [], failure = null }: ReadTrouble = {}) {
  return {
    view: WhatNeedsYouView,
    props: {
      pending,
      needs,
      faults,
      failure,
      onReread: NO_PRESS,
      focus,
      onPress: NO_PRESS,
      onWithdraw: NO_WITHDRAW,
      name: 'Kaylee',
    } satisfies Omit<ComponentProps<typeof WhatNeedsYouView>, 'tier'>,
  };
}

/**
 * The `needs` slot's drawing in each of the four pictures. `waiting`'s stage holds the feature's card, so its Accept reads as
 * on the stage; the other pictures' stages hold nothing of the rail's.
 */
export const NEEDS_FAKE = {
  home: drawing([FOLLOWUPS], null, null),
  waiting: drawing([FEATURE_ACCEPT, EPIC_ACCEPT, RED_CHECK], PENDING, { kind: 'card', plan: FEATURE_ACCEPT.card, label: FEATURE_ACCEPT.title }),
  walkthrough: drawing([PERMISSION], null, null),
  empty: drawing([], null, null),
};

/** The rail's states no picture shows (`REGION_STATES`), each drawn over `home` in the `needs` slot's place. */
export const NEEDS_STATES = {
  reading: drawing(null, null, null),
  // The server's own sentence for a read that failed (`needs.routes.ts`, 503).
  failed: drawing(null, null, null, { failure: 'What needs you could not be read just now.' }),
  // The dispatcher's reader (Accepts and rounds, one read) and Cerberus's failed; the follow-ups answered.
  faults: drawing([FOLLOWUPS], null, null, { faults: ['accept', 'questions', 'check'] }),
};

/** One follow-up of the chat's list, filed `minutes` ago; `done` settled by the chat. */
const followup = (id: number, kind: Followup['kind'], text: string, minutes: number, done = false): Followup => ({
  id, kind, text, state: done ? 'done' : 'open', createdAt: ago(minutes), updatedAt: ago(done ? minutes - 30 : minutes),
  doneAt: done ? ago(minutes - 30) : null, closedBy: done ? 'chat' : null, closedFor: null,
});

/** The chat's list as `useFollowups` reads it: four open (three next steps, a known gap) and two done. */
const FOLLOWUP_ROWS: Followup[] = [
  followup(900311, 'next', 'Check the drag on an iPad in landscape before it ships: the lane scrolled under the finger last time.', 12),
  followup(900312, 'next', 'Ask Scott whether a long press should lift a card, or only a drag past 8 px.', 55),
  followup(900313, 'next', 'Rerun the lane probe at 390×844 once the phone plan lands.', 140),
  followup(900314, 'gap', 'A card dragged over a folded lane is not tested: the fold may swallow the drop.', 210),
  followup(900315, 'next', 'Write the drop marker into the kanban manual.', 400, true),
  followup(900316, 'gap', 'Drag cancel on Escape was untested.', 620, true),
];

/** The red check as Cerberus's "Needs you" holds it: its view, the fix the catalog offers for it, no run, no diagnosis yet. */
const CHECK_NEED: CerberusNeed = {
  check: {
    node: 'eis1', key: 'shadow-connector/session.valid', service: 'shadow-connector', id: 'session.valid',
    label: 'Session is valid', serviceLabel: 'Shadow connector', status: 'failing', stored: 'failing',
    value: '401 from the shadow connector: the session token expired at 13:52', at: NOW - 20_000, since: CHECK_SINCE,
    every: 30, staleAfter: 90, origin: 'component', kind: 'health_doc', mute: null,
  },
  fix: {
    id: 'refresh-the-session', node: 'eis1', check: 'shadow-connector/session.valid', checkLabel: 'Session is valid',
    serviceLabel: 'Shadow connector', name: 'Refresh the session', when: 'failing',
    cmd: 'systemctl --user restart shadow-connector', timeout: 60, auto: false, limit: { runs: 3, per: 3600 }, capped: null,
    recheck: true, origin: { kind: 'written', by: 'scott', at: NOW - 9 * 86_400_000 }, createdAt: NOW - 9 * 86_400_000,
    stats: { runs: 4, ok: 4, lastRunAt: NOW - 2 * 86_400_000 },
  },
  run: null,
  diagnosis: null,
};

/** Each stage's focus: what the rail's press on its item puts on the stage. */
const ASK_FOCUS: Extract<StationFocus, { kind: 'ask' }> = {
  kind: 'ask', sessionId: PERMISSION.sessionId, requestId: PERMISSION.requestId, label: PERMISSION.chat,
};
const FOLLOWUPS_FOCUS: Extract<StationFocus, { kind: 'followups' }> = {
  kind: 'followups', sessionId: FOLLOWUPS_CHAT.sessionId, label: FOLLOWUPS_CHAT.chat,
};
const CHECK_FOCUS: Extract<StationFocus, { kind: 'check' }> = {
  kind: 'check', node: CHECK_NEED.check.node, key: CHECK_NEED.check.key, label: 'Session is valid',
};

/**
 * The three stages' own shots: each stage's focus, its view drawn on its fixture, and the picture whose rail holds its item (the
 * probe draws that picture's rail with the stage's focus, so the item reads as on the stage).
 */
export const NEEDS_STAGE_FAKE = {
  ask: {
    picture: 'walkthrough',
    focus: ASK_FOCUS,
    view: AskStageView,
    props: {
      focus: ASK_FOCUS,
      found: { kind: 'waiting', need: PERMISSION },
      answering: null,
      refusal: null,
      onAnswer: NO_PRESS,
      onReread: NO_PRESS,
      onOpenChat: NO_PRESS,
    } satisfies ComponentProps<typeof AskStageView>,
  },
  followups: {
    picture: 'home',
    focus: FOLLOWUPS_FOCUS,
    view: FollowupsStageView,
    props: {
      focus: FOLLOWUPS_FOCUS,
      reading: { items: FOLLOWUP_ROWS, unreachable: false, openCount: 4, refresh: () => Promise.resolve(), setDone: () => Promise.resolve() },
      onOpenChat: NO_PRESS,
    } satisfies ComponentProps<typeof FollowupsStageView>,
  },
  check: {
    picture: 'waiting',
    focus: CHECK_FOCUS,
    view: CheckStageView,
    props: {
      focus: CHECK_FOCUS,
      found: { kind: 'needs', need: CHECK_NEED },
      onOpenSheet: NO_PRESS,
      onRetry: NO_PRESS,
    } satisfies ComponentProps<typeof CheckStageView>,
  },
} satisfies Record<string, { picture: string; focus: StationFocus; view: unknown; props: unknown }>;
