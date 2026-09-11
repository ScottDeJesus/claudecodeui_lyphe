/**
 * The one remark plugin the markdown shapes need: it GROUPS sibling blocks that only mean something
 * together, which no single component override can do — an override sees one element, never its
 * neighbours.
 *
 * Used by `Markdown.tsx`, which adds it to `remarkPlugins` ONLY when the body is not streaming. The
 * pending half of a streamed reply must not rearrange itself on every delta: a second fence that
 * has half-arrived would pull the first one into a tab group and push it out again 100 ms later.
 *
 * Two passes, in this order, over the ROOT's children and nothing deeper. A fence inside a list
 * item or a blockquote, or a heading inside a blockquote, is never grouped — that keeps the walk
 * one loop over one array, and keeps a list item from having its code block lifted out of it.
 *
 *   1. Tabbed code: a run of two or more adjacent fences, every one with a language, not all of
 *      them the same language, and none of them a widget, a diagram, stats or a diff, becomes
 *      `<div data-shape="tabbed-code">` around those fences. `elements/plain.tsx` routes it to
 *      `TabbedCode`.
 *   2. Heading sections: a heading and every following sibling until the next heading of EQUAL OR
 *      LOWER depth becomes `<div data-shape="section" data-depth="N">` — the heading first, its body
 *      after. A deeper heading inside the body opens a section of its own, so an h3 nests inside an
 *      h2 and an h2 never nests inside an h3. A `---` that ends a section stays outside it, between
 *      the two sections it separates. `elements/plain.tsx` routes it to `ShapeSection`.
 *
 * The wrappers are unknown mdast nodes carrying `data.hName`; `mdast-util-to-hast` turns one into
 * exactly `<div …hProperties>` with its children converted as they always were
 * (`mdast-util-to-hast/lib/state.js`, `defaultUnknownHandler` and `applyData`). Its definitions
 * pre-pass walks into unknown nodes too, so a link reference or a footnote definition that lands
 * inside a section still resolves.
 *
 * It walks `tree.children` by hand and imports nothing: `unist-util-visit` is only a transitive
 * dependency here, and one loop over one array does not earn it.
 */

/** The slice of an mdast node this plugin reads. Declared locally, so the module imports nothing. */
type MdastNode = {
  type: string;
  /** A heading's level, 1–6. */
  depth?: number;
  /** A fence's info-string word: `ts`, `python`, `widget`. `null` on an indented block. */
  lang?: string | null;
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

/**
 * Nodes that occupy no place in the rendered body: a link reference definition renders nothing,
 * and a footnote definition is drawn in the footer. A heading followed only by these has nothing to
 * fold, so it is not given a toggle that would do nothing.
 */
const RENDERS_IN_PLACE = (node: MdastNode): boolean =>
  node.type !== 'definition' && node.type !== 'footnoteDefinition';

/**
 * Pass 2, recursive over the SLICE it was handed — never over any node's own children. Each level
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
 * tabbed code first, so a tab group lands inside the section its fences were written under.
 */
export function remarkShapeGroups() {
  return (tree: { children: unknown[] }): void => {
    tree.children = groupSections(groupTabbedCode(tree.children as MdastNode[]));
  };
}
