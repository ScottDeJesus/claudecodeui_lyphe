import type { Row, TableData } from '@/modules/chat/transcript/shapes/detect';

/**
 * Readers for the hast node react-markdown hands every component override.
 *
 * `hast-util-to-jsx-runtime` sets `props.node` under react-markdown's `passNode: true`, so an
 * override receives the ORIGINAL element with its whole descendant subtree beside the already
 * rendered `children`. These functions read that subtree and nothing else: no React, no DOM, no
 * imports but a type from `detect.ts`.
 *
 * The rule they serve is **decide from `node`, render from `children`**. Everything here returns
 * TEXT, which is what a trigger, a sort key and a CSV want — and which has already dropped the
 * author's `**bold**`, `` `code` `` and links. A shape decides WHICH shape from these readers and
 * then renders the author's words from `children`; a shape that draws cells out of this text is
 * shipping a regression on the commonest table in the app.
 *
 * Used by every component under `shapes/`.
 */
export type HastNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  value?: string;
};

const elementsOf = (node: HastNode | undefined, tagNames: string[]): HastNode[] =>
  (node?.children ?? []).filter(
    (child) => child.type === 'element' && tagNames.includes(child.tagName ?? '')
  );

/** Every character of text under a node, in order and UNTRIMMED — callers trim what they compare. */
export function textOf(node: HastNode | undefined): string {
  if (!node) return '';
  if (typeof node.value === 'string') return node.value;
  return (node.children ?? []).map(textOf).join('');
}

const cellsOf = (row: HastNode): Row => elementsOf(row, ['th', 'td']).map(textOf);

/**
 * A table's headers and body cells as text, or null when it is not a table a shape can reason
 * about. Null on a missing header row and null on RAGGED rows: every shape built on this indexes
 * columns by position, and one short row would read a neighbouring column's value as its own.
 */
export function readTable(node: HastNode): TableData | null {
  const sections = (node.children ?? []).filter((child) => child.type === 'element');
  const head = sections.find((section) => section.tagName === 'thead');
  const headerRow = head ? elementsOf(head, ['tr'])[0] : undefined;
  if (!headerRow) return null;
  const headers = cellsOf(headerRow);
  if (headers.length === 0) return null;

  const rows: Row[] = [];
  for (const section of sections) {
    if (section === head) continue;
    const sectionRows = section.tagName === 'tr' ? [section] : elementsOf(section, ['tr']);
    for (const row of sectionRows) rows.push(cellsOf(row));
  }
  if (rows.some((row) => row.length !== headers.length)) return null;
  return { headers, rows };
}

const findCheckbox = (node: HastNode): HastNode | undefined => {
  for (const child of node.children ?? []) {
    if (child.type === 'element' && child.tagName === 'input' && child.properties?.type === 'checkbox') {
      return child;
    }
    const nested = findCheckbox(child);
    if (nested) return nested;
  }
  return undefined;
};

/**
 * One entry per direct `li`. `checked` is the task-list state — true, false, or null for a list
 * item that is not a task at all, which is the difference between "0 of 3 done" and an ordinary
 * bulleted list that must keep its bullets.
 */
export function readListItems(node: HastNode): { text: string; checked: boolean | null }[] {
  return elementsOf(node, ['li']).map((item) => {
    const checkbox = findCheckbox(item);
    return { text: textOf(item), checked: checkbox ? checkbox.properties?.checked === true : null };
  });
}

/**
 * `**Label:** value` pairs, or null. Strict by design: at least two pairs, every label a `strong`
 * ending in a colon, every value non-blank, and NOTHING else in the subtree — a paragraph with one
 * bolded lead-in and a sentence after it is prose, and laying it out as a fact grid would read as
 * a table the author never wrote.
 *
 * **This function IS FactCard's decline rule, for both of its callers.** A fact card draws labels
 * and values from TEXT, so it may only ever be built from pairs where text is all there was: the
 * "nothing else in the subtree" clause returns null for a `code`, a link, an `em` or a math span
 * sitting among the values, and the label clause returns null for a bold that holds ANY element —
 * `**[PR 12](url):**` or `` **`detect.ts`:** `` would otherwise be read by its text alone, and the
 * grid would draw `PR 12` with its link target silently gone. Both clauses together are what make
 * "a fact card never renders less than the markdown it replaced" true rather than hoped.
 *
 * Asking `hasInlineFormatting` of a fact paragraph NAIVELY would decline every input that can reach
 * here, because the `**Label:**` bold that defines a pair is itself a mark that function counts.
 * `elements/list.tsx` asks it with the label bolds UNWRAPPED, which is the one form in which it is
 * a real question; see `hasInlineFormatting` below.
 */
export function readFactPairs(node: HastNode): { label: string; value: string }[] | null {
  const pairs: { label: string; value: string }[] = [];
  let pendingLabel: string | null = null;

  for (const child of node.children ?? []) {
    if (child.type === 'text') {
      const raw = child.value ?? '';
      if (pendingLabel === null) {
        // Whitespace between pairs is fine; words between them are prose.
        if (raw.trim()) return null;
        continue;
      }
      const [firstLine] = raw.split('\n');
      if (!firstLine.trim()) return null;
      pairs.push({ label: pendingLabel, value: firstLine.trim() });
      pendingLabel = null;
      if (raw.slice(firstLine.length + 1).trim()) return null;
      continue;
    }
    if (child.type !== 'element') continue;
    // `remark-breaks` is loaded here, so the newline BETWEEN two facts arrives as a `<br>` rather
    // than inside a text node. It is the separator this reader is defined on, in element form.
    if (child.tagName === 'br') {
      if (pendingLabel !== null) return null;
      continue;
    }
    if (child.tagName === 'strong' && pendingLabel === null) {
      // A label is bold TEXT and nothing more. A link, a code span or an emphasis inside the bold
      // is markup the grid cannot carry — it draws the label from `textOf` — so it declines here.
      if ((child.children ?? []).some((inner) => inner.type === 'element')) return null;
      const label = textOf(child).trim();
      if (!label.endsWith(':')) return null;
      pendingLabel = label.slice(0, -1).trim();
      if (!pendingLabel) return null;
      continue;
    }
    return null;
  }

  if (pendingLabel !== null) return null;
  return pairs.length >= 2 ? pairs : null;
}

const languageOf = (code: HastNode): string => {
  const className = code.properties?.className;
  const names = Array.isArray(className) ? className.map(String) : String(className ?? '').split(/\s+/);
  const match = names.find((name) => name.startsWith('language-'));
  return match ? match.slice('language-'.length) : 'text';
};

/** Each `pre > code` child of a wrapper, for the tabbed-code shape: its language and its source. */
export function readCodeChildren(node: HastNode): { lang: string; text: string }[] {
  const blocks: { lang: string; text: string }[] = [];
  for (const pre of elementsOf(node, ['pre'])) {
    const code = elementsOf(pre, ['code'])[0];
    if (!code) continue;
    // Fenced source carries a trailing newline in the tree; it would draw an empty final line.
    blocks.push({ lang: languageOf(code), text: textOf(code).replace(/\n$/, '') });
  }
  return blocks;
}

// Containers are TRANSPARENT here. A table is made of `tr` and `td`, so counting them as marks
// would make every table "formatted" and no table would ever reach DecisionMatrix. The question
// this answers is only ever: did the author mark anything up INSIDE the cells?
const STRUCTURAL_TAGS = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'ul', 'ol', 'li', 'p', 'div']);

/**
 * True when the author wrote any inline mark in this subtree — `strong`, `em`, `code`, `a`, `del`,
 * `br`, a math span. The shapes that re-lay-out cells into cards and grids cannot carry rendered
 * children across that move, so they ask this and DECLINE when it is true, falling back to today's
 * plain rendering rather than flattening the words. A shape may never render less than the
 * markdown it replaced.
 *
 * Its callers are the two TABLE shapes, `DecisionMatrix` and `BeforeAfter` — a matrix of plain
 * sentences reads `false` and becomes cards, one with inline code in a cell reads `true` and stays
 * a readable table — the list ladder's FACT rung, and BOTH rungs of the paragraph ladder in
 * `elements/paragraph.tsx`, the verdict and the fact card, each of which the plan requires to
 * decline on it too.
 * `strong` deliberately counts as a mark here, which makes it the right question for a table cell
 * and a vacuous one for a fact pair, whose `**Label:**` bold is what defines it. So the fact rungs
 * ask it with the label bolds UNWRAPPED (their text kept, their element removed): a link or code
 * span anywhere — value or label — still reads `true`. The list rung unwraps per item; the
 * paragraph rungs unwrap through their own `unwrapped` helper — the fact rung the label bolds and
 * the `<br>` between pairs, the verdict rung the `strong`/`em` a model wraps the line in.
 * `readFactPairs` above rejects the same fact inputs on its own; both fact rungs' questions are a
 * second lock that agrees with it, not a different rule.
 */
export function hasInlineFormatting(node: HastNode | undefined): boolean {
  if (!node) return false;
  for (const child of node.children ?? []) {
    if (child.type !== 'element') continue;
    if (!STRUCTURAL_TAGS.has(child.tagName ?? '')) return true;
    if (hasInlineFormatting(child)) return true;
  }
  return false;
}
