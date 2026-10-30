import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import type { NotificationHistoryRow } from '@/modules/database/index.js';
import { listMemoryCandidates } from '@/modules/memory-intake/index.js';
import { listNotificationHistory } from '@/modules/notifications/index.js';
import { oneLine } from '@/shared/tool-call-hint.js';
import type { DispatcherAsk } from '@/shared/types.js';
import { guardedToolResult, textResult, type ToolTextResult } from '@/shared/tool-text-result.js';

import { ALERT_KIND_BY_CODE } from '../feeds/alert-feed.js';
import { toolLine } from '../session/companion-prompt.js';
import type { CompanionToolDeps } from '../tools/companion-tools.js';
import { chatNameOf, UNTITLED_CHAT } from '../tools/house-reads.js';

import { cappedLines, toPanel, whenWords } from './eyes-answer.js';

/**
 * `list_alerts`: what the house told him lately, and what his inbox holds now. Two scopes and a phrase:
 *   - `recent`: the newest 20 events the house kept (`listNotificationHistory`), newest first, one line each:
 *     `<when> · <kind in words> · <chat or plan> · <title>`. The kind is the alert feed's own word where the event's code is
 *     one it tells her (`ALERT_KIND_BY_CODE`: feature finished, background work landed, asking, permission, failed, stuck),
 *     else the event's own kind (`stop`, `info`, …). The chat is its sidebar name (`chatNameOf`); an event of no chat, or of a
 *     chat that is gone or has no name of its own (the sidebar's fallback), names its plan; one of neither is "the house".
 *   - `waiting`: the Inbox as it stands NOW, each section through its own reader — the memory proposals pending
 *     (`listMemoryCandidates`), the heal ledger's live count (`house.heal.summary()`) and the asks the roadmap's cards are
 *     stopped on (`house.dispatcher()`), counted once per ask, because an arc's lock rides on every plan it names. Each
 *     section names the tool that reads it further.
 *   - anything else is a phrase, matched without regard to case over the kept events' code, title, body, chat and plan
 *     (every word of it, in any order), and answered in `recent`'s lines.
 *
 * THE USAGE FAMILY IS NEVER LISTED. The history keeps every event, `limit.*`, `usage.*` and `push.enabled` included (it is
 * the house's record), and this tool answers none of them, nor the dispatcher's usage-limit push (`NEVER_LISTED`; ruling 1:
 * never usage or spend). The wording it reads is already
 * taken clear of every figure (`spendFreeWording`, applied when the row was written).
 *
 * `panel: true` puts the whole answer on his panel as a note. No eyes tool moves her focus or her activity: a read here
 * runs as `thinking`, and it names a chat only to say its name.
 *
 * Consumer: `tools/companion-tools.ts` (`buildCompanionTools`), once per account.
 */

/** How many kept events `recent` and a phrase read: the history keeps 300 per account, and the read takes all of them so a phrase can reach the oldest. */
const HISTORY_READ_MAX = 300;

/**
 * The notification codes that never reach her list: the account's limit family (`limit.reached`, `limit.reset`, `limit.warning`,
 * `limit.overage`, `limit.out_of_credits`, and any `usage.*`), the push switch's own test (`push.enabled`), and the dispatcher's
 * one push for a usage-limit wall (`dispatcher.limit_paused`, headlined "Claude usage limit", which the pattern does not catch
 * because its code starts with `dispatcher.`). Ruling 1: never usage or spend.
 */
const NEVER_LISTED = /^(?:(?:limit|usage)\..*|push\.enabled|dispatcher\.limit_paused)$/;

/** A plural as it is said: "1 proposal", "3 proposals". */
const countOf = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/**
 * One kept event as the line she reads. `title` is folded to one line: it is the house's own sentence plus the chat's name, which a person typed.
 * The history outlives its chats, and `chatNameOf` answers the sidebar's fallback for one that is gone: the plan the row stored says more then.
 */
function alertLine(row: NotificationHistoryRow): string {
  const kind = ALERT_KIND_BY_CODE.get(row.code) ?? row.kind ?? row.code;
  const chat = row.session_id === null ? null : chatNameOf(row.session_id);
  const about = chat !== null && chat !== UNTITLED_CHAT ? chat : (row.plan ?? chat ?? 'the house');
  return [whenWords(row.at), kind, oneLine(about), oneLine(row.title)].join(' · ');
}

/** The kept events that are the house's to list: the history less the usage family, newest first. */
function listableAlerts(deps: CompanionToolDeps): NotificationHistoryRow[] {
  return listNotificationHistory(deps.userId, HISTORY_READ_MAX).filter((row) => !NEVER_LISTED.test(row.code));
}

/** `recent`: the newest 20, then how many more the history holds. */
function recentAlerts(deps: CompanionToolDeps): string {
  const rows = listableAlerts(deps);
  if (rows.length === 0) return 'The house has told him nothing that is kept yet.';
  return cappedLines(rows.map(alertLine));
}

/** A phrase: the kept events holding every word of it in their code, title, body, chat or plan. */
function alertsMatching(deps: CompanionToolDeps, phrase: string): string {
  const words = phrase.toLowerCase().split(/\s+/).filter(Boolean);
  const matched = listableAlerts(deps).filter((row) => {
    const about = row.session_id !== null ? chatNameOf(row.session_id) : '';
    const text = `${row.code} ${row.title} ${row.body} ${about} ${row.plan ?? ''}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
  if (matched.length === 0) return `Nothing the house kept mentions "${phrase}". The newest 300 of what it told him are searched; recent lists the latest.`;
  return cappedLines(matched.map(alertLine));
}

/** One section of the Inbox, read on its own: a reader that fails costs that section's line and is logged, never the other two. */
async function section(name: string, reader: string, read: () => Promise<string[]> | string[]): Promise<string[]> {
  try {
    return await read();
  } catch (error) {
    console.error(`[Companion] list_alerts could not read the Inbox's ${name} section`, error);
    return [`${name}: could not be read just now (${reader})`];
  }
}

/** The memory proposals pending: the Memory panel's own figure. */
function memoryLines(): string[] {
  const pending = listMemoryCandidates({ status: 'pending' }).length;
  return [`Memory: ${countOf(pending, 'proposal', 'proposals')} waiting (read_memory)`];
}

/** The heal ledger's live rows: the Heal panel's `live`, the whole open ledger (not the cut since the last heal). */
async function healLines(deps: CompanionToolDeps): Promise<string[]> {
  const summary = await deps.house.heal.summary();
  const live = summary.ok ? summary.value.live : undefined;
  // A summary that carries no count is a source that did not answer, not an empty ledger: never the false zero.
  if (typeof live !== 'number' || !Number.isFinite(live)) return ['Heal: could not be read just now (read_heal)'];
  return [`Heal: ${live} live (read_heal)`];
}

/**
 * The card an ask is about, in the name he knows it by: for an Accept that names several plans (an epic's lock) the epic,
 * through the lead plan's own `arc`; else the plan. A questions round names the card whose design it asks about.
 */
function askSubject(ask: DispatcherAsk, arcOfLead: string | null): string {
  if (ask.kind === 'questions') return ask.target;
  return ask.plans.length > 1 ? `${arcOfLead ?? ask.plan} (epic)` : ask.plan;
}

/** What the ask waits for, in the card's own words. */
const askWaitsFor = (ask: DispatcherAsk): string =>
  ask.kind === 'accept' ? 'waiting on your Accept' : `${countOf(ask.questions.length, 'question', 'questions')} open`;

/**
 * The roadmap's asks: the Roadmap section's count and one line per ask. An ask is counted ONCE however many plans carry it —
 * its identity is its `asked` record, the same on every plan an arc's lock names (the panel's `askIdentity`) — and a plan he
 * has put away (hidden) draws no card, so its ask is not his to answer from there.
 */
async function roadmapLines(deps: CompanionToolDeps): Promise<string[]> {
  const picture = await deps.house.dispatcher();
  if (picture === null) return ['Roadmap: not read yet; try again in a moment (list_roadmap waiting)'];
  const asks = new Map<string, { ask: DispatcherAsk; arcOfLead: string | null }>();
  for (const plan of picture.plans) {
    if (plan.asking === null || plan.hidden !== null) continue;
    const identity = `${plan.asking.asked.id}-${plan.asking.asked.at}`;
    if (!asks.has(identity)) asks.set(identity, { ask: plan.asking, arcOfLead: picture.plans.find((lead) => lead.name === plan.asking?.plan)?.arc ?? null });
  }
  const lines = [...asks.values()].map(({ ask, arcOfLead }) => `  ${askSubject(ask, arcOfLead)} · ${askWaitsFor(ask)}`);
  return [`Roadmap: ${countOf(asks.size, 'ask', 'asks')} waiting on you (list_roadmap waiting)`, ...lines];
}

/** `waiting`: the Inbox now, its three sections in the Inbox's own order. */
async function waitingNow(deps: CompanionToolDeps): Promise<string> {
  const sections = await Promise.all([
    section('Memory', 'read_memory', memoryLines),
    section('Heal', 'read_heal', () => healLines(deps)),
    section('Roadmap', 'list_roadmap waiting', () => roadmapLines(deps)),
  ]);
  return sections.flat().join('\n');
}

/** The text of one `list_alerts` call, and the title a panel note of it carries. */
async function readAlerts(deps: CompanionToolDeps, scope: string): Promise<{ title: string; text: string }> {
  const keyword = scope.toLowerCase();
  if (keyword === 'waiting') return { title: 'What waits in his inbox', text: await waitingNow(deps) };
  if (keyword === 'recent') return { title: 'What the house told him lately', text: recentAlerts(deps) };
  return { title: `What the house told him about ${scope}`, text: alertsMatching(deps, scope) };
}

/** `list_alerts`, answered in text or put on his panel. */
function listAlerts(deps: CompanionToolDeps, args: { scope: string; panel?: boolean }): Promise<ToolTextResult> {
  return guardedToolResult('list_alerts', 'read the alerts', async () => {
    const { title, text } = await readAlerts(deps, args.scope.trim());
    return args.panel === true ? toPanel(deps, title, textResult(text)) : textResult(text);
  });
}

/**
 * The definition of `list_alerts`, built with the SDK's `tool()` and zod, read-only: it changes nothing of his. Its description
 * is her prompt's own line for the tool (`toolLine`). Consumed by `tools/companion-tools.ts` (`buildCompanionTools`).
 */
export function alertReads(deps: CompanionToolDeps): Array<SdkMcpToolDefinition<any>> {
  return [
    tool(
      'list_alerts',
      toolLine('list_alerts'),
      {
        scope: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe('recent: the newest 20 things the house told him, newest first. waiting: what his inbox holds now (memory proposals, heal friction, asks on the roadmap). Anything else is a phrase searched over what the house told him.'),
        panel: z.boolean().optional().describe('true puts the whole answer on his panel as a note instead of in your context.'),
      },
      (args) => listAlerts(deps, args),
      { annotations: { readOnlyHint: true } }
    ),
  ];
}
