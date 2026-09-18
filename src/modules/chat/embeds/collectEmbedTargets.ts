import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import type { ChatMessage, EmbedUrlRef } from '@/shared/types';
import { classifyWidgetBody } from '@/modules/widgets';
import { isProseReply } from '@/modules/chat/utils/toolGrouping';

/**
 * Every embed a chat has declared, read back out of its own messages.
 *
 * WHY THE MESSAGES AND NOT THE DOM. The inline embed card already mounts for each fence, so the
 * obvious channel is to have it register itself as it mounts. It is the wrong one: the transcript
 * unmounts rows that scroll far from the viewport, so the widget's list would grow and shrink with
 * the reader's scroll position, and a fence in a message nobody has scrolled to would not exist.
 * The message store is the chat's own record of what was said, virtualised or not, so a derivation
 * over it answers the same way at every scroll position. It is the shape `usePinnedSubagentRows`
 * already uses for the same reason.
 *
 * THE FENCE IS FOUND BY THE PARSER THAT RENDERS IT. The transcript is `react-markdown`, which is
 * `unified` + `remark-parse`, with `remark-gfm` among its plugins; this runs that same pipeline and
 * reads the `code` nodes out of the tree. A second parser — a line-anchored regex, the obvious one —
 * can only agree with the renderer by accident: it finds a fence at column 0 and misses one inside a
 * list item, a blockquote or an indented block, which then draws its card in the transcript and never
 * reaches the widget. The cure is not a wider regex but not having one.
 *
 * The info string is matched on the node's `lang`, which is the WHOLE first word — `widget-config`
 * is `widget-config` and is not a widget, the same rule `CodeBlock` enforces on the rendered class.
 * Each body then goes through `classifyWidgetBody`, the one classifier, so the widget can never list
 * an address the card would have refused, and inherits every gate that classifier owns.
 *
 * ONLY THE MODEL'S OWN REPLIES DECLARE, and "a model reply" is asked of `isProseReply` — the app's
 * one answer to that question — never re-spelled here. A reader's paste, a tool's output, a thinking
 * row (models draft the fence they are about to emit), a task notification and the `<synthetic>`
 * placeholder are none of them the model asking to put a page in front of the reader, so none may
 * steer the widget's frame or open it. A re-spelling of that predicate carried four of its seven
 * conditions and let thinking rows and task notices through; the cure is to not have a second one.
 *
 * DUPLICATES COLLAPSE ON THE ADDRESS, AND THE LAST MENTION IS WHERE IT STANDS. A chat that shows one
 * dashboard four times has one dashboard, carrying its latest title and height, placed where it was
 * LAST declared — so re-declaring an address the chat already showed makes it the newest again, which
 * is how the model brings a page back to the front of the widget. The order is a pure function of the
 * messages, so it does not reshuffle while a reply streams: only a new mention moves anything.
 */

/**
 * The cheap pre-filter: a message with no widget fence in it is never parsed, and most messages are
 * that. It must be LOOSER than the parser, never tighter — a hint that refuses what the renderer
 * draws is the second-parser mistake again, one level up, and it drops a declaration in silence. So
 * both fence characters (CommonMark opens a fence with backticks OR tildes), and optional spaces or
 * tabs before the word, because CommonMark trims the info string: three backticks, a space, then
 * `widget` is a widget fence, and the transcript draws it. A false positive here only costs one
 * parse; a false negative costs a page.
 */
const FENCE_HINT = /(?:```|~~~)[ \t]*widget/;

/** How many addresses the widget remembers for one chat. A picker is a list, not a history. */
const MAX_TARGETS = 12;

/**
 * Each message's embeds, remembered by its TEXT. The collector runs on every message-array identity
 * change — ten times a second while a reply streams — and a full parse of every fence-bearing reply
 * on each of those was measured at 66ms for a 300-message chat (Athena's review). A message whose
 * text has not changed has not changed its embeds, so only the reply being written is parsed again.
 * Bounded, and cleared whole when full: a cache this cheap to rebuild is not worth an LRU.
 */
const parsedByText = new Map<string, EmbedUrlRef[]>();
const MAX_CACHED_TEXTS = 500;

/**
 * The transcript's parse, and nothing more. `remark-breaks` and `remark-math` are left out on
 * purpose: they change how prose and `$…$` render, and neither can create, remove or re-shape a
 * fenced code block — so they would cost a pass over every text node here and change no answer.
 */
const parser = unified().use(remarkParse).use(remarkGfm);

/** The minimal shape of an mdast node this walk reads. */
type MdNode = { type: string; lang?: string | null; value?: string; children?: MdNode[] };

/** One message's embed fences, in document order, at whatever depth they sit. */
function targetsInText(text: string): EmbedUrlRef[] {
  const found: EmbedUrlRef[] = [];
  const walk = (node: MdNode) => {
    if (node.type === 'code' && node.lang === 'widget' && typeof node.value === 'string') {
      const shape = classifyWidgetBody(node.value);
      if (shape.kind === 'embed') found.push(shape.ref);
      return;
    }
    node.children?.forEach(walk);
  };
  walk(parser.parse(text) as MdNode);
  return found;
}

/** One message's embeds, parsed once per distinct text. */
function targetsInTextCached(text: string): EmbedUrlRef[] {
  const cached = parsedByText.get(text);
  if (cached) return cached;
  const found = targetsInText(text);
  if (parsedByText.size >= MAX_CACHED_TEXTS) parsedByText.clear();
  parsedByText.set(text, found);
  return found;
}

/**
 * The chat's embeds, oldest first, deduplicated by address and capped.
 *
 * Pure and total: a message that is not a model reply, a message with no fence in it, and a body
 * that classifies as anything else all contribute nothing. Called from one memo in `ChatInterface`,
 * keyed on the message array's identity.
 */
export function collectEmbedTargets(messages: ChatMessage[]): EmbedUrlRef[] {
  // A Map in insertion order, where a repeated address is DELETED before it is set again — a bare
  // `set` would keep the first mention's place, and the newest address would then be whichever came
  // first rather than whichever the model named last.
  const byUrl = new Map<string, EmbedUrlRef>();
  for (const message of messages) {
    if (!isProseReply(message)) continue;
    const text = message.content;
    if (typeof text !== 'string' || !FENCE_HINT.test(text)) continue;
    for (const target of targetsInTextCached(text)) {
      byUrl.delete(target.url);
      byUrl.set(target.url, target);
    }
  }
  const all = [...byUrl.values()];
  // The OLDEST are dropped when a chat has declared more than the widget will hold: the newest
  // address is the one the reader just asked for, and it must never be the one that falls off.
  return all.length > MAX_TARGETS ? all.slice(all.length - MAX_TARGETS) : all;
}
