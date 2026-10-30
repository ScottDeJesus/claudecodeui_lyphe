import { sessionsDb } from '@/modules/database/index.js';
import { buildClaudeToolPermissionEntry, providerRuntimeService, sessionHostLivenessSnapshot } from '@/modules/providers/index.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';
import { describeToolCall, describeToolInput, oneLine } from '@/shared/tool-call-hint.js';

/**
 * What a chat is doing at this moment, read from the running server and nothing else: its state, and one line
 * on its activity. Both are read at call time — nothing is cached, nothing polls, and no usage or spend appears
 * in either (ruling 17). Split from `house-reads.ts` by cohesion: that file knows which chats are his and how to
 * find one by name, this one knows what a given chat is up to.
 *
 * Consumers: `house-reads.ts`, which re-exports `chatState`, `activityLine`, `askLine` and `pendingAsksOf` as
 * part of the one door the tool files read the house through.
 */

/** What a chat is doing right now. `asleep` is still sendable: a message wakes it and resumes where it left off. */
export type ChatState = 'working' | 'waiting' | 'live' | 'asleep';

/**
 * The states of `sessionIds`, in the same order, from ONE read of which chats have a session host — a roster of
 * twenty chats takes one snapshot, not twenty, and its lines agree with each other.
 *
 * A chat blocked on him is `waiting` even though its run is still registered as running, so the ask is read
 * FIRST: `working` would hide the one thing she is there to notice. Then `working` (a run is registered and
 * running), then `live` (a host holds the chat but nothing runs), else `asleep`.
 * Consumed by `house-reads.ts` (`chatRows`).
 */
export function chatStates(sessionIds: readonly string[]): ChatState[] {
  const liveIds = new Set(sessionHostLivenessSnapshot().sessionIds);
  return sessionIds.map((sessionId) => {
    if (providerRuntimeService.getPendingApprovalsForSession(sessionId).length > 0) return 'waiting';
    if (chatRunRegistry.isProcessing(sessionId)) return 'working';
    return liveIds.has(sessionId) ? 'live' : 'asleep';
  });
}

/** One chat's state at this moment. Consumed by the send tools: a working chat is folded into, an idle one is given a turn. */
export function chatState(sessionId: string): ChatState {
  return chatStates([sessionId])[0];
}

/** The first `max` characters of `text`, counted by code points so a cut never lands inside an emoji and leaves half of it. */
const cutAt = (text: string, max: number): string => Array.from(text).slice(0, max).join('');

/** One ask a chat is blocked on, as its permission gateway lists it: the tool that wants an answer and that tool's input. */
type ListedAsk = { toolName?: string; input?: { questions?: Array<{ question?: string; options?: Array<{ label?: string }> }>; plan?: string } };

/** The asks a chat is blocked on, oldest first (the order the gateway holds them). Consumed by `read-tools.ts`'s `pending_ask` and by the line below. */
export function pendingAsksOf(sessionId: string): ListedAsk[] {
  return providerRuntimeService.getPendingApprovalsForSession(sessionId) as ListedAsk[];
}

/**
 * One ask in one line: what it wants to run, what it asks, or that a plan waits on his word. `detailed` is the line she
 * DECIDES on, read by `read-tools.ts`'s `pending_ask`: a question carries its option labels (when it is the only one), so she can
 * offer them, and a permission carries what it would run in full (`describeToolInput`, up to 600 characters, a count of what was
 * cut) and the rule an answer of "always" would store for every later chat of his. Without it the line is a scan of the roster
 * (the activity line below), where a Bash command is cut at 60 characters.
 */
export function askLine(ask: ListedAsk, detailed = false): string {
  if (ask.toolName === 'AskUserQuestion') {
    const questions = ask.input?.questions ?? [];
    const labels = detailed && questions.length === 1 ? (questions[0].options ?? []).map((option) => oneLine(option.label ?? '')).filter(Boolean) : [];
    const options = labels.length > 0 ? ` Options: ${labels.join(' | ')}` : '';
    return `asks "${cutAt(oneLine(questions[0]?.question ?? ''), 100)}"${questions.length > 1 ? ` (and ${questions.length - 1} more)` : ''}${options}`;
  }
  if (ask.toolName === 'ExitPlanMode') return 'a plan is ready and waits for his approval';
  const toolName = ask.toolName ?? 'a tool';
  if (!detailed) return `wants permission: ${describeToolCall(toolName, ask.input)}`;
  const entry = buildClaudeToolPermissionEntry(toolName, ask.input);
  return `wants permission: ${describeToolInput(toolName, ask.input)}${entry === null ? '' : ` (answering "always" would store ${entry} as a standing rule for every later chat of his)`}`;
}

/** The oldest ask of a waiting chat in one line. */
function waitingLine(sessionId: string): string {
  const [ask] = pendingAsksOf(sessionId);
  return ask ? askLine(ask) : 'waiting on him';
}

/** The tail of a running chat's own replay buffer: its last tool call, else the last words it wrote. */
function workingLine(sessionId: string): string {
  const events = chatRunRegistry.replayEvents(sessionId, 0);
  let lastWords: string | null = null;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.kind === 'tool_use' && event.toolName) return describeToolCall(event.toolName, event.toolInput);
    if (lastWords === null && event.kind === 'text' && event.role === 'assistant' && oneLine(event.content ?? '')) {
      lastWords = cutAt(oneLine(event.content ?? ''), 80);
    }
  }
  return lastWords ?? 'just started';
}

/** "idle 12 min" — how long since the chat's row last moved. The row's time is already ISO (`sessionsDb` normalizes it). */
function idleLine(sessionId: string): string {
  const updatedAt = Date.parse(sessionsDb.getSessionById(sessionId)?.updated_at ?? '');
  if (Number.isNaN(updatedAt)) return 'idle, no recorded activity';
  const minutes = Math.max(0, Math.round((Date.now() - updatedAt) / 60_000));
  if (minutes < 1) return 'idle just now';
  if (minutes < 60) return `idle ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `idle ${hours} h` : `idle ${Math.round(hours / 24)} d`;
}

/**
 * One line on what a chat is doing: a working chat's last tool call ("Bash npm run build") or else its last
 * words (80 characters), a waiting chat's ask, an idle or asleep chat's "idle 12 min". `state` is for a caller
 * that already read it. The answer is folded to ONE line here, at the one place every path leaves through: a tool
 * call's file name or tool name is whatever the model wrote, and a line break in it would add lines to the roster and
 * to `list_sessions` that read as other chats. Consumed by `house-reads.ts` (the roster), `session-tools.ts` through it,
 * `feeds/alert-block.ts` (the ask a waiting chat holds) and `station/station-sessions.ts`, which serves the line as it is to the
 * station's rail (the page cuts it to one line there, never here).
 */
export function activityLine(sessionId: string, state: ChatState = chatState(sessionId)): string {
  const line = state === 'working' ? workingLine(sessionId) : state === 'waiting' ? waitingLine(sessionId) : idleLine(sessionId);
  return oneLine(line);
}
