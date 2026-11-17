import type { ComponentProps } from 'react';

import { AskStageView } from '@/modules/station/AskStage';
import { CheckStageView } from '@/modules/station/CheckStage';
import { DESK_EPIC } from '@/modules/station/fake/roadmap';
import { FollowupsStageView } from '@/modules/station/FollowupsStage';
import type { CerberusNeed } from '@/shared/cerberus-types';
import type { CompanionPendingAction } from '@/shared/companion-types';
import type { StationFocus, StationNeed } from '@/shared/station-types';
import type { Followup } from '@/shared/types';

/*
 * THE FIXTURE DATA OF WHAT NEEDS HIM, for the shots of the three stages a need opens (an ask, a chat's follow-ups, a red
 * check) and for the pending action in the companion's picture. Nothing in the app imports this file.
 *
 * Every need is a `StationNeed` as `GET /api/companion/station/needs` answers it (`server/modules/companion/station/
 * need-readers.ts`): its id in the reader's own form, an ask's `what` as `describeToolInput` prints a command. The pending
 * action is a `CompanionPendingAction` as the companion's picture holds one. Ids and request ids no store holds (above 900000,
 * as `fake/stage.ts` keeps them), and made-up chat ids: nothing here names a real chat, ask or check. Times are relative to
 * when it loads.
 *
 * `NEEDS_STAGE_FAKE` is one drawing per stage — the ask's on the permission, the follow-ups' on that chat's list, the check's on
 * the red check's Cerberus card — each with the picture it is drawn over, for the shots probe.
 */

const NOW = Date.now();
/** A stamp `minutes` before the fixture loads, ISO, as the wires write one. */
const ago = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString();

/** A press a picture never makes: the shots photograph, they do not press. */
const NO_PRESS = () => {};
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

/**
 * The red check, failing 23 minutes. Its value names no clock time of its own: the one line that says when it went red is `since`,
 * and a time written into the words would disagree with it on any day but the one it was written.
 */
const CHECK_SINCE = NOW - 23 * 60_000;
const CHECK_VALUE = '401 from the shadow connector: the session token expired';
/**
 * The companion's action waiting for his word: he asked for the epic to be queued, it was read back, and the card waits for his
 * word. Exported for the companion's picture (`fake/conversation.ts`'s `waiting`), which holds it.
 */
export const PENDING: CompanionPendingAction = {
  id: '900201',
  action: 'queue',
  target: { kind: 'card', name: `${DESK_EPIC.name}.arc`, spoken: DESK_EPIC.title, arc: null },
  prompt: EPIC_CENSUS,
  carried: [],
  say: 'Queue Kaylee’s desk',
  preparedAt: ago(1),
  expiresAt: new Date(NOW + 29 * 60_000).toISOString(),
};

/**
 * The `home` picture's chat with open follow-ups, and the `walkthrough` picture's chat waiting on a permission. Exported for the
 * house's chats (`fake/sessions.ts`), which list these same two, so every sample of one picture names one house.
 */
export const FOLLOWUPS_CHAT = { sessionId: '00000000-0000-4000-8000-000000900301', chat: 'Lane drag on touch' };
export const DEPLOY_CHAT = { sessionId: '00000000-0000-4000-8000-000000900401', chat: 'Deploy the station build' };

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
    value: CHECK_VALUE, at: NOW - 20_000, since: CHECK_SINCE,
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

/** Each stage's focus: what a press on its need puts on the stage. */
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
 * The three stages' own shots: each stage's focus, its view drawn on its fixture, and the picture it is drawn over.
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
