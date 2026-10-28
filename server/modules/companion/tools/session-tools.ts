import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { guardedToolResult, textResult, type ToolTextResult } from '@/shared/tool-text-result.js';

import { toolLine } from '../session/companion-prompt.js';

import { firstWordsOf } from './chat-first-words.js';
import { activityLine, chatRows, listVisibleProjects, type ChatRow } from './house-reads.js';

/**
 * The two tools that show her the house: `list_sessions` (his chats with their state) and `list_projects` (where a
 * new chat can start). Both are reads, and neither names a chat, so neither sets the focus or her activity — she
 * is looking at the house, not at a session. Every result is text; a refusal is `isError` with a sentence that
 * says what to do next. No usage or spend appears in either (ruling 17).
 *
 * Each description is her prompt's own line for the tool (`toolLine`), so what the tool list says and what her
 * system prompt says are one text.
 *
 * Consumer: `tools/companion-tools.ts`, which puts these two first in the list of thirteen it builds.
 */

/** How many chats `recent` lists and how many a phrase may match: a list she reads aloud from is short. */
const RECENT_COUNT = 15;
const PHRASE_MATCH_MAX = 10;

/** `name · project · state · activity · id`: the one line a chat is listed as. */
function chatLine({ chat, state }: ChatRow): string {
  return [chat.name, chat.project, state, activityLine(chat.sessionId, state), chat.sessionId].join(' · ');
}

/**
 * The chats whose name, project and first words together hold every word of `phrase` (case-insensitive,
 * any order), in the order given, one more than `limit` at most so the caller can say there were more. A
 * chat's first words are read only when its name and project did not already answer, and only until the
 * list is full.
 */
async function chatsMatching(rows: ChatRow[], phrase: string, limit: number): Promise<ChatRow[]> {
  const words = phrase.toLowerCase().split(/\s+/).filter(Boolean);
  const holdsAll = (text: string): boolean => words.every((word) => text.includes(word));
  const matched: ChatRow[] = [];
  for (const row of rows) {
    const heading = `${row.chat.name} ${row.chat.project}`.toLowerCase();
    if (holdsAll(heading) || holdsAll(`${heading} ${(await firstWordsOf(row.chat.sessionId)).toLowerCase()}`)) matched.push(row);
    if (matched.length > limit) break;
  }
  return matched;
}

/** The text of one `list_sessions` call. */
async function listSessions(scope: string): Promise<string> {
  const rows = chatRows();
  const wanted = scope.trim();
  const lines = (chats: ChatRow[]): string => chats.map(chatLine).join('\n');
  if (wanted.toLowerCase() === 'active') {
    const active = rows.filter((row) => row.state !== 'asleep');
    return active.length > 0 ? lines(active) : 'None of his chats is working, waiting or live. Use scope recent to see the ones that are asleep.';
  }
  if (wanted.toLowerCase() === 'recent') {
    const others = rows.filter((row) => row.state === 'asleep').slice(0, RECENT_COUNT);
    return others.length > 0 ? lines(others) : 'Every chat of his is working, waiting or live; scope active lists them.';
  }
  const matched = await chatsMatching(rows, wanted, PHRASE_MATCH_MAX);
  if (matched.length === 0) {
    return `No chat of his matches "${wanted}" in its name, its project or its first words. Try one word of it, or scope recent.`;
  }
  const more = matched.length > PHRASE_MATCH_MAX ? '\nMore chats match; narrow the phrase to see the rest.' : '';
  return lines(matched.slice(0, PHRASE_MATCH_MAX)) + more;
}

/** The text of one `list_projects` call. */
function listProjects(): string {
  const projects = listVisibleProjects();
  return projects.length > 0 ? projects.map((project) => `${project.name} · ${project.path}`).join('\n') : 'No project is registered yet, so a new session has nowhere to start.';
}

/** A read as a tool result: its text, or — when the read itself failed — an error she can report, logged with what failed. */
const answering = (toolName: string, read: () => Promise<string> | string): Promise<ToolTextResult> =>
  guardedToolResult(toolName, 'read the house', async () => textResult(await read()));

/**
 * The definitions of `list_sessions` and `list_projects`, built with the SDK's `tool()` and zod. Both are marked
 * read-only so the CLI never asks permission for them.
 */
export function sessionTools(): Array<SdkMcpToolDefinition<any>> {
  const readOnly = { annotations: { readOnlyHint: true } };
  return [
    tool(
      'list_sessions',
      toolLine('list_sessions'),
      {
        scope: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe(
            'active: every chat that is working, waiting on him or live. recent: the 15 most recent others. Anything else is a phrase matched against a chat\'s name, its project and its first words (up to 10 chats).'
          ),
      },
      ({ scope }) => answering('list_sessions', () => listSessions(scope)),
      readOnly
    ),
    tool('list_projects', toolLine('list_projects'), {}, () => answering('list_projects', listProjects), readOnly),
  ];
}
