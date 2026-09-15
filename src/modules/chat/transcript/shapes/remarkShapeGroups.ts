/**
 * The one remark plugin the markdown shapes need: it GROUPS sibling blocks that only mean something
 * together, which no single component override can do — an override sees one element, never its
 * neighbours.
 *
 * Used by `Markdown.tsx`, which adds it to `remarkPlugins` ONLY when the body is not streaming. The
 * pending half of a streamed reply must not rearrange itself on every delta: a second fence that
 * has half-arrived would pull the first one into a tab group and push it out again 100 ms later.
 *
 * Three passes, in this order, over the ROOT's children and nothing deeper. A fence inside a list
 * item or a blockquote, or a heading inside a blockquote, is never grouped — that keeps the walk
 * one loop over one array, and keeps a list item from having its code block lifted out of it.
 *
 *   1. Tabbed code: a run of two or more adjacent fences, every one with a language, not all of
 *      them the same language, and none of them a widget, a diagram, stats or a diff, becomes
 *      `<div data-shape="tabbed-code">` around those fences. `elements/plain.tsx` routes it to
 *      `TabbedCode`.
 *   2. Lead-ins: a paragraph whose next sibling is a list or a table, and which is a title rather
 *      than a sentence, becomes `<div data-shape="lead-in">` around the pair. `elements/plain.tsx`
 *      routes it to `LeadIn`, which hands the paragraph's own rendered words down as the target
 *      shape's title.
 *   3. Heading sections: a heading and every following sibling until the next heading of EQUAL OR
 *      LOWER depth becomes `<div data-shape="section" data-depth="N">` — the heading first, its body
 *      after. A deeper heading inside the body opens a section of its own, so an h3 nests inside an
 *      h2 and an h2 never nests inside an h3. A `---` that ends a section stays outside it, between
 *      the two sections it separates. `elements/plain.tsx` routes it to `ShapeSection`.
 *
 * Lead-ins run BETWEEN those two, and the reason is `groupSections`: it nests a heading's body one
 * level down, so a lead-in pass placed after it would never see a paragraph-and-list pair written
 * under a heading. Running after tabbed code costs nothing — neither pass can change a node into a
 * list or a table — and keeps the pass that REWRITES a run of fences ahead of the pass that reads
 * the block after each one.
 *
 * The wrappers are unknown mdast nodes carrying `data.hName`; `mdast-util-to-hast` turns one into
 * exactly `<div …hProperties>` with its children converted as they always were
 * (`mdast-util-to-hast/lib/state.js`, `defaultUnknownHandler` and `applyData`). Its definitions
 * pre-pass walks into unknown nodes too, so a link reference or a footnote definition that lands
 * inside a section still resolves.
 *
 * It walks `tree.children` by hand rather than through `unist-util-visit`: that package is only a
 * transitive dependency here, and one loop over one array does not earn it. Its one import is
 * `isLeadInText` off `shapes/detect.ts` — the lead-in grammar is a TRIGGER, and `detect.ts` is the
 * one home of those, so the pass that asks the question is not the place to answer it.
 */

import { isLeadInText } from '@/modules/chat/transcript/shapes/detect';

/** The slice of an mdast node this plugin reads. Declared locally, so the module imports only the grammar. */
type MdastNode = {
  type: string;
  /** A heading's level, 1–6. */
  depth?: number;
  /** A fence's info-string word: `ts`, `python`, `widget`. `null` on an indented block. */
  lang?: string | null;
  /** A `text` or `inlineCode` node's characters — the lead-in pass reads both. */
  value?: string;
  children?: MdastNode[];
  data?: { hName?: string; hProperties?: Record<string, string> };
};

/**
 * The language a fence RENDERS as, the way `shapes/code` reads it: the leading `\w+` of the info
 * word, lower-cased. So ```js and ```js{1,3} are one language (both are labelled "Js"), and ```TS
 * and ```ts are one language — a group whose EVERY tab read the same label would be a tab strip
 * with nothing to choose between, so it is not a group. A language that merely repeats among
 * others is allowed by the trigger, and `TabbedCode` numbers its tabs ("Ts 1", "Py", "Ts 2") so no
 * two tabs share a name.
 */
const renderedLanguage = (lang: string | null | undefined): string =>
  (/^\w+/.exec(lang ?? '')?.[0] ?? '').toLowerCase();

/**
 * Fences that are never grouped: every language the fence precedence table turns into something
 * other than highlighted code. A tab group holds CODE — one example in several languages — and a
 * live widget, a diagram, a row of stat tiles or a diff is a shape of its own, already in its own
 * frame; filed under a tab of a "Code" block it would be hidden behind a label that misnames it,
 * and a live frame hidden behind a tab would break the widget contract outright.
 *
 * Matched on the rendered language rather than the whole word. The dispatcher mounts a widget only
 * on the exact word `widget`, while CodeFence draws a diagram on any word whose `\w+` capture is
 * `mermaid` — so matching the prefix leaves every fence that COULD be one of these out. A
 * `widget-config` fence stays out too, which costs nothing: when in doubt, the fence stays as it is.
 */
const NEVER_TABBED = new Set(['widget', 'mermaid', 'stats', 'diff']);

/** Does a maximal run of adjacent fences meet the whole trigger? Any member failing it fails the run. */
function isTabbableRun(run: MdastNode[]): boolean {
  if (run.length < 2) return false;
  const languages = run.map((fence) => renderedLanguage(fence.lang));
  if (languages.some((language) => language === '' || NEVER_TABBED.has(language))) return false;
  return new Set(languages).size > 1;
}

/**
 * Pass 1. A run is MAXIMAL — every adjacent fence, not the first two — and it is grouped whole or
 * not at all: splitting `[ts, py, widget]` into a `[ts, py]` group beside a lone widget would let
 * the widget decide where a tab group ends, which is exactly the fence this pass must not touch.
 */
function groupTabbedCode(nodes: MdastNode[]): MdastNode[] {
  const grouped: MdastNode[] = [];
  let index = 0;
  while (index < nodes.length) {
    if (nodes[index].type !== 'code') {
      grouped.push(nodes[index]);
      index += 1;
      continue;
    }
    let end = index;
    while (end < nodes.length && nodes[end].type === 'code') end += 1;
    const run = nodes.slice(index, end);
    if (isTabbableRun(run)) {
      grouped.push({
        type: 'shapeTabs',
        data: { hName: 'div', hProperties: { 'data-shape': 'tabbed-code' } },
        children: run,
      });
    } else {
      grouped.push(...run);
    }
    index = end;
  }
  return grouped;
}

/** A paragraph's children with the whitespace-only text nodes taken out: the words a reader sees. */
const meaningfulChildren = (node: MdastNode): MdastNode[] =>
  (node.children ?? []).filter((child) => !(child.type === 'text' && (child.value ?? '').trim() === ''));

/**
 * Is the whole line one bold run — `**Summary**` — or one bold run and the colon that follows it?
 *
 * The plan's second half of the lead-in trigger, and the reason a colon is not required of it: a
 * bold lead-in over a list is a label in every transcript this app renders, colon or not. Anything
 * else in the line — a word before the bold, a word after it — makes it a sentence, and the `:**`
 * spelling is admitted only as a LONE colon, because `**Important** and the rest` must stay prose.
 */
const isWhollyBold = (children: MdastNode[]): boolean => {
  const [first, second] = children;
  // `strong` is the mdast node a `**bold**` run becomes; this plugin runs in the remark half of the
  // pipeline, so the word is read off the mdast type and never off a hast tag name.
  if (first?.type !== 'strong') return false;
  if (children.length === 1) return true;
  return children.length === 2 && second?.type === 'text' && (second.value ?? '').trim() === ':';
};

/**
 * Every character of the paragraph's subtree that reaches the screen, in order. `text` and
 * `inlineCode` carry their words in `value`, and a `break` — `remark-breaks`, or a hard break — is
 * a line ending, which is what `isLeadInText` refuses a title for.
 */
const lineText = (node: MdastNode): string => {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? '';
  if (node.type === 'break') return '\n';
  return (node.children ?? []).map(lineText).join('');
};

/**
 * Pass 2. A paragraph becomes a lead-in only when the block BENEATH it is a list or a table AND the
 * paragraph is a title — see `isLeadInText`. The two nodes travel together into
 * `<div data-shape="lead-in">`, and `elements/plain.tsx` routes the pair to `LeadIn`, which decides
 * whether the target frames itself and, when it does not, frames it under the paragraph's own words.
 *
 * It walks the array ONCE and skips both nodes when it emits, so the paragraph is never also
 * considered against the block after the list. Deeper paragraphs — one inside a list item, a
 * blockquote or a section body — are not this pass's business: the walk is over root children only,
 * exactly like the two passes beside it.
 */
function groupLeadIns(nodes: MdastNode[]): MdastNode[] {
  const grouped: MdastNode[] = [];
  let index = 0;
  while (index < nodes.length) {
    const node = nodes[index];
    const target = nodes[index + 1];
    const isTitle = node.type === 'paragraph' && isLeadInText(lineText(node), isWhollyBold(meaningfulChildren(node)));
    if (isTitle && (target?.type === 'list' || target?.type === 'table')) {
      grouped.push({
        type: 'shapeLeadIn',
        data: { hName: 'div', hProperties: { 'data-shape': 'lead-in' } },
        children: [node, target],
      });
      index += 2;
      continue;
    }
    grouped.push(node);
    index += 1;
  }
  return grouped;
}

/**
 * Nodes that occupy no place in the rendered body: a link reference definition renders nothing,
 * and a footnote definition is drawn in the footer. A heading followed only by these has nothing to
 * fold, so it is not given a toggle that would do nothing.
 */
const RENDERS_IN_PLACE = (node: MdastNode): boolean =>
  node.type !== 'definition' && node.type !== 'footnoteDefinition';

/**
 * Pass 3, recursive over the SLICE it was handed — never over any node's own children. Each level
 * holds headings strictly deeper than the one above it, so the recursion is at most six deep.
 *
 * A heading with no body — the next block is a heading of equal or lower depth, or nothing — is
 * left bare. Folding it would hide nothing, and a bare heading keeps the prose container's own
 * spacing rules (`h2 + *`, `> :first-child`) reading the siblings they always read.
 */
function groupSections(nodes: MdastNode[]): MdastNode[] {
  const grouped: MdastNode[] = [];
  let index = 0;
  while (index < nodes.length) {
    const heading = nodes[index];
    if (heading.type !== 'heading') {
      grouped.push(heading);
      index += 1;
      continue;
    }
    const depth = heading.depth ?? 1;
    let end = index + 1;
    // `<=` is the whole boundary rule: an equal or shallower heading ends this section, a deeper one
    // belongs to it.
    while (end < nodes.length && !(nodes[end].type === 'heading' && (nodes[end].depth ?? 1) <= depth)) {
      end += 1;
    }
    // A `---` that ENDS a section is the line between it and the next one, not part of it: folding
    // a section must not take the rule that separates it from its neighbour. Left outside, it is
    // also still the sibling the prose container's `hr + *` rule reads, so the next heading keeps
    // the spacing it has under a rule.
    let bodyEnd = end;
    while (bodyEnd > index + 1 && nodes[bodyEnd - 1].type === 'thematicBreak') bodyEnd -= 1;
    const body = nodes.slice(index + 1, bodyEnd);
    const trailingRules = nodes.slice(bodyEnd, end);
    if (body.some(RENDERS_IN_PLACE)) {
      grouped.push({
        type: 'shapeSection',
        data: { hName: 'div', hProperties: { 'data-shape': 'section', 'data-depth': String(depth) } },
        children: [heading, ...groupSections(body)],
      });
    } else {
      grouped.push(heading, ...body);
    }
    grouped.push(...trailingRules);
    index = end;
  }
  return grouped;
}

/**
 * The unified attacher. It takes no options; the transformer rewrites the root's children in place,
 * tabbed code first and sections last, so a tab group and a lead-in both land inside the section
 * their blocks were written under.
 */
export function remarkShapeGroups() {
  return (tree: { children: unknown[] }): void => {
    tree.children = groupSections(groupLeadIns(groupTabbedCode(tree.children as MdastNode[])));
  };
}
