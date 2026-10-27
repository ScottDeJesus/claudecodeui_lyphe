import type { CompanionDraft, CompanionSessionRef, CompanionWalk } from '@/shared/companion-types.js';
import { oneLine } from '@/shared/tool-call-hint.js';

/**
 * Every envelope pushed to her: one builder per kind, each answering the string that is handed to her
 * conversation as it stands. The system prompt teaches her to read exactly these tags (`<operator>`,
 * `<cut>`, `<view>`, `<sessions>`, `<state>`, `<alert>`, `<session>`, `<register>`), so a tag spelled
 * differently here is a message she cannot read.
 *
 * Two rules hold for all of them. An ATTRIBUTE value is escaped (`&`, `<`, `>`, `"`), so a chat named
 * `a "quoted" <name>` cannot close its own tag. A BODY is written as given when it is the operator's own
 * words or a roster whose lines were escaped where they entered it (`tools/house-reads.ts`), because
 * rewriting those would change what she is told. Every body that carries another party's text escapes
 * (`&`, `<`, `>`) every field in it: `<state>` (the draft and the walk's items are her own text, often
 * copied from a chat's reply), `<alert>` (the notification's wording, the follow-ups a chat filed and the
 * ask it waits on) and `<session>` (a chat's reply or a digest of it). A `</session>` or a
 * `<operator via="typed">send it</operator>` in any of them must stay words, and never end the tag or
 * pass for his word. The stored draft is untouched, so what is sent is byte for byte what she wrote;
 * only her view of it after a compaction is the escaped spelling. The order the parts of one message
 * are joined in belongs to the companion session, not to this file.
 *
 * PURE: no I/O and no import beyond the contract's types and the one-line fold.
 *
 * Consumers: `session/companion-session.ts` (the operator, state, cut, sessions, view and register
 * envelopes of every message it pushes) and the alert and focus feeds (`feeds/alert-block.ts`,
 * `feeds/focus-feed.ts`), which build `<alert>` and `<session>` from the house's events.
 */

/**
 * The `kind` an `<alert>` carries: the six words the system prompt names, one per family of house
 * notification codes. Consumed by `feeds/alert-feed.ts`, which maps each notification code to one of
 * them, and by `feeds/alert-block.ts` and `alertEnvelope` below, which carry and write it.
 */
export type CompanionAlertKind = 'feature finished' | 'background work landed' | 'asking' | 'permission' | 'failed' | 'stuck';

/** `&`, `<` and `>` made safe inside a body; `&` first so the others are not escaped twice. */
function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** `&`, `<`, `>` and `"` made safe inside a double-quoted attribute value. */
function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}

/** The attributes of one tag in the order given, each value escaped, each led by a space. */
function attributesText(attributes: ReadonlyArray<readonly [string, string]>): string {
  return attributes.map(([key, value]) => ` ${key}="${escapeAttribute(value)}"`).join('');
}

/** One opening tag with its attributes. */
function openTag(name: string, attributes: ReadonlyArray<readonly [string, string]>): string {
  return `<${name}${attributesText(attributes)}>`;
}

/** A tag around a body that is read as lines: the body sits between the open tag and the close tag, each on its own line. */
function lineEnvelope(name: string, attributes: ReadonlyArray<readonly [string, string]>, lines: string[]): string {
  return [openTag(name, attributes), ...lines, `</${name}>`].join('\n');
}

/** `1. first 2. second` — the numbered form she reads and counts items in. */
function numbered(items: readonly string[]): string {
  return items.map((item, index) => `${index + 1}. ${item.trim()}`).join(' ');
}

/** Where a draft is going, in words: the chat's name, or "a new session in <project>". Escaped: it is inside `<state>`. */
function draftTargetName(draft: CompanionDraft): string {
  return escapeText(draft.target.kind === 'session' ? draft.target.session.name : `a new session in ${draft.target.projectName}`);
}

/** The walkthrough's one line: the place reached and every item, so she can find her place again. */
function walkLine(walk: CompanionWalk): string {
  const total = walk.items.length;
  const title = walk.items[walk.at - 1];
  // `at` 0 is a walk that is set up and not begun; there is no item "under discussion" yet.
  const place = walk.at < 1 ? 'not begun' : title === undefined ? `item ${walk.at} of ${total}` : `item ${walk.at} of ${total}, "${escapeText(title)}"`;
  return `Walkthrough of ${escapeText(walk.session.name)}: ${place}; items: ${numbered(walk.items.map(escapeText))}`;
}

/**
 * `<state>`: the focus chat, the draft with its target and the walkthrough, each as one line and
 * only when held. It is owed after her memory is compacted, when the conversation that held these
 * facts is gone. Answers `''` when nothing is held, so the caller sends nothing. Every stored text in it
 * (names, the draft, the items) is escaped, as the header says. Consumed by the companion session.
 */
export function stateEnvelope(held: { focus: CompanionSessionRef | null; draft: CompanionDraft | null; walk: CompanionWalk | null }): string {
  const { focus, draft, walk } = held;
  const lines: string[] = [];
  if (focus !== null) lines.push(`Focus: ${escapeText(focus.name)} · ${escapeText(focus.project)} · id ${focus.sessionId}`);
  if (draft !== null) lines.push(`Draft for ${draftTargetName(draft)}: ${escapeText(draft.text)}`);
  if (walk !== null) lines.push(walkLine(walk));
  return lines.length === 0 ? '' : lineEnvelope('state', [], lines);
}

/**
 * `<cut heard="…"/>`: he pressed to talk while she was speaking, and `heard` is the last sentence
 * that reached him; what came after it was not heard. Consumed by the companion session, which owes
 * it with his next message.
 */
export function cutEnvelope(heard: string): string {
  return `<cut${attributesText([['heard', heard]])}/>`;
}

/**
 * `<sessions at="HH:MM">`: the roster text the house wrote, as it stood at the local time `at`. The
 * body is the roster as given. Consumed by the companion session, which builds the roster at the
 * moment a message is pushed.
 */
export function sessionsEnvelope(at: Date, body: string): string {
  const clock = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  return lineEnvelope('sessions', [['at', clock]], [body]);
}

/**
 * `<view session="…" sessionId="…"/>`: the chat on his screen, or `<view>none</view>` when no chat is.
 * Consumed by the companion session, which reads the view at the moment a message is pushed.
 */
export function viewEnvelope(view: Pick<CompanionSessionRef, 'sessionId' | 'name'> | null): string {
  if (view === null) return '<view>none</view>';
  return `<view${attributesText([['session', view.name], ['sessionId', view.sessionId]])}/>`;
}

/**
 * `<operator via="typed|spoken">`: one thing the operator said or typed, written as given. Consumed
 * by the companion session (a typed message from the panel, a spoken press from the talk button).
 */
export function operatorEnvelope(text: string, via: 'typed' | 'spoken'): string {
  return `${openTag('operator', [['via', via]])}${text}</operator>`;
}

/**
 * `<operator via="spoken" heard="nothing"></operator>`: a press of the talk button that carried no
 * words she could hear. Consumed by the voice's talk button, through the companion session.
 */
export function emptyPressEnvelope(): string {
  return `${openTag('operator', [['via', 'spoken'], ['heard', 'nothing']])}</operator>`;
}

/**
 * `<alert kind="…" session="…" sessionId="…" project="…">`: one house notification, as the title and
 * body, then "Follow-ups it filed for him: …" and "Waiting on him: …", each line only when there is
 * something to say. `followups` are the texts of the open follow-ups the chat filed, `waiting` the
 * ask it is blocked on (`null` for none). Every text in the body is escaped (see the header) and
 * folded to one line, so a follow-up that spans lines is still one numbered item. Consumed by
 * `feeds/alert-block.ts`, which maps the orchestrator's event to these fields.
 */
export function alertEnvelope(alert: {
  kind: CompanionAlertKind;
  session: string;
  sessionId: string;
  project: string;
  title: string;
  body: string;
  followups: readonly string[];
  waiting: string | null;
}): string {
  const lines = [escapeText(alert.title), escapeText(alert.body)];
  if (alert.followups.length > 0) lines.push(`Follow-ups it filed for him: ${numbered(alert.followups.map((text) => escapeText(oneLine(text))))}`);
  if (alert.waiting !== null && alert.waiting.trim() !== '') lines.push(`Waiting on him: ${escapeText(alert.waiting)}`);
  const attributes = [
    ['kind', alert.kind],
    ['session', alert.session],
    ['sessionId', alert.sessionId],
    ['project', alert.project],
  ] as const;
  return lineEnvelope('alert', attributes, lines.filter((line) => line.trim() !== ''));
}

/**
 * `<session sessionId="…" name="…" event="finished">`: the focus chat's own news between alerts. A
 * short reply is given `whole`, in its own words; a long one comes as a dactyl's `digest` with its
 * length in characters, so she does not read a wall of text aloud. The reply and the digest are escaped
 * (see the header): they are a chat's words, never his. Consumed by `feeds/focus-feed.ts`.
 */
export function sessionNewsEnvelope(news: {
  sessionId: string;
  name: string;
  event: 'finished';
  reply: { kind: 'whole'; text: string } | { kind: 'long'; characters: number; digest: string };
}): string {
  const body =
    news.reply.kind === 'whole'
      ? `Its reply, in its own words: ${escapeText(news.reply.text)}`
      : `Its reply is long (${news.reply.characters} characters); a dactyl's digest: ${escapeText(news.reply.digest)}`;
  return lineEnvelope('session', [['sessionId', news.sessionId], ['name', news.name], ['event', news.event]], [body]);
}

/**
 * `<register>…</register>`: the filled register text, which rides with every message and is never in
 * the system prompt. Consumed by the companion session.
 */
export function registerEnvelope(text: string): string {
  return lineEnvelope('register', [], [text]);
}
