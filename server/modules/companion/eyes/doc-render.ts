import { isList, isRecord, isText } from '@/shared/document-fields.js';

import { characterCount } from '../companion-input.js';

import type { DocBlock, DocPage } from './docspace-client.js';

/**
 * A DocSpace page as plain text, for `read_doc`: PURE, no I/O. A block's data differs by type, but the words a person reads
 * in it live in a handful of fields, and those are the ones rendered; a block of a type with none (a canvas, a list of links)
 * renders as its title alone, and its outline line says how short it is.
 *
 * A block renders as its TITLE, then each text field of its `data`: the `description` that introduces it, then its
 * `content`, `message` and `code`, then the `text` of each list item (a checklist's items carry `[x]` or `[ ]`), then
 * each row of a table (the column names first, a row's cells in column order, ` | ` between; a cell that holds a list, as a
 * multi-select does, shows its items joined by commas). Four types keep their words elsewhere and are read in their own
 * fields: an embedded docstore view (`view <view> of <package>`), a question (its question, notes, options and explanation), a
 * decision matrix (its context, each option with its verdict, pros and cons, and the summary) and a runbook (each step with
 * its instructions, command and expected output). A page renders as its title, its own description (the page-level line
 * ArchPulse keeps beside the title, often the only readable text of a page of embedded views) and its blocks, each under a
 * `## <n>. <type> · block <id>` heading, so a digest of the file can cite a block by the same number and id the outline gives.
 *
 * Consumer: `eyes/doc-reads.ts`.
 */

/** The text fields of a block's `data`, in the order they read. */
const TEXT_FIELDS = ['description', 'content', 'message', 'code'] as const;

/** A string's trimmed text, `''` for anything that is not text. */
const textOf = (value: unknown): string => (isText(value) ? value.trim() : '');

/** One table cell as text on one line: a string or a number or a flag, a list (a multi-select's items) joined by commas, else nothing. */
function cellText(value: unknown): string {
  if (isText(value)) return value.replace(/\s+/g, ' ').trim();
  if (isList(value)) return value.map(cellText).filter((item) => item !== '').join(', ');
  return typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
}

/** The list items of `data.items` that carry text, one line each; a checklist item says whether it is done. */
function itemLines(data: DocBlock['data']): string[] {
  if (!isList(data.items)) return [];
  return data.items.flatMap((item) => {
    const text = isRecord(item) ? textOf(item.text) : '';
    if (text === '') return [];
    const mark = isRecord(item) && typeof item.completed === 'boolean' ? (item.completed ? '[x] ' : '[ ] ') : '';
    return [`- ${mark}${text}`];
  });
}

/** A table's lines: its column names, then each row that holds a cell, cells in the column order. */
function tableLines(data: DocBlock['data']): string[] {
  if (!isList(data.columns) || !isList(data.rows)) return [];
  const columns = data.columns.flatMap((column) => (isRecord(column) && isText(column.id) ? [{ id: column.id, name: textOf(column.name) }] : []));
  if (columns.length === 0) return [];
  const rows = data.rows.flatMap((row) => {
    const cells = isRecord(row) && isRecord(row.cells) ? row.cells : {};
    const values = columns.map((column) => cellText(cells[column.id]));
    return values.some((value) => value !== '') ? [values.join(' | ')] : [];
  });
  return rows.length === 0 ? [] : [columns.map((column) => column.name).join(' | '), ...rows];
}

/** The trimmed text of each of `names` in `record`, those that hold any, in the order named. */
const textFields = (record: unknown, names: readonly string[]): string[] => (isRecord(record) ? names.map((name) => textOf(record[name])).filter((text) => text !== '') : []);

/** The records of a list field, `[]` when it is not a list. */
const recordsOf = (value: unknown): Array<Record<string, unknown>> => (isList(value) ? value.filter(isRecord) : []);

/** A labelled line, `<label>: <items joined by ';'>`, when `items` is a list holding any text. */
function labelled(label: string, items: unknown): string[] {
  const texts = isList(items) ? items.map(textOf).filter((text) => text !== '') : [];
  return texts.length === 0 ? [] : [`${label}: ${texts.join('; ')}`];
}

/** The words of the four types that keep them outside the common fields (see the head of this file). */
function typedLines(block: DocBlock): string[] {
  const { data } = block;
  switch (block.type) {
    case 'docstore_view': {
      const view = textOf(data.view);
      return view === '' ? [] : [`view ${view}${textOf(data.package) === '' ? '' : ` of ${textOf(data.package)}`}`];
    }
    case 'question_prompt':
      return [
        ...textFields(data, ['question', 'contextNotes']),
        ...recordsOf(data.options).map((option) => `- ${textFields(option, ['label', 'subtext']).join(' — ')}`),
        ...textFields(data, ['aiExplanation']),
      ];
    case 'decision_matrix':
      return [
        ...textFields(data, ['context']),
        ...recordsOf(data.options).flatMap((option) => [`- ${textOf(option.name)}${textOf(option.verdict) === '' ? '' : ` (${textOf(option.verdict)})`}`, ...labelled('  pros', option.pros), ...labelled('  cons', option.cons)]),
        ...textFields(data, ['summaryNote']),
      ];
    case 'sop_runbook':
      return recordsOf(data.steps).flatMap((step, index) => {
        const [title = '', instructions = ''] = [textOf(step.title), textOf(step.instructions)];
        return [`${index + 1}. ${[title, instructions].filter((part) => part !== '').join(': ')}`, ...textFields(step, ['command']).map((line) => `   run: ${line}`), ...textFields(step, ['expectedOutput']).map((line) => `   expect: ${line}`)];
      });
    default:
      return [];
  }
}

/** A block's text fields, as lines, without its title. */
function bodyLines(block: DocBlock): string[] {
  const fields = TEXT_FIELDS.map((name) => textOf(block.data[name])).filter((text) => text !== '');
  return [...fields, ...itemLines(block.data), ...tableLines(block.data), ...typedLines(block)];
}

/** A block as text: its title, then its text fields. `''` for a block with neither. Consumed by `blockSection` and the outline's length. */
function blockText(block: DocBlock): string {
  return [block.title ?? '', ...bodyLines(block)].filter((line) => line !== '').join('\n');
}

/**
 * One block as a section: `## <n>. <type> · block <id>`, then the block's text. `number` is the block's place in its page, from 1,
 * the same number the outline gives it. Consumed by `eyes/doc-reads.ts` (a block's own read, and a phrase's blocks) and by `pageText`.
 */
export function blockSection(block: DocBlock, number: number): string {
  return [`## ${number}. ${block.type} · block ${block.id}`, blockText(block)].filter((line) => line !== '').join('\n');
}

/**
 * The page's own description as plain text: ArchPulse keeps it beside the title, sometimes as a blockquote (`> …`), whose marker is
 * dropped. `''` for a page with none. Consumed by `pageText` and `sectionsHolding` here and by `eyes/doc-reads.ts` (the outline's
 * "About" line, and the sentence for a page with no blocks).
 */
export function descriptionOf(page: DocPage): string {
  return page.description.replace(/^[ \t]*>[ \t]?/gm, '').trim();
}

/** The section a page's description makes of itself, where it is read or searched with the blocks. */
const aboutSection = (page: DocPage): string => `## About this page\n${descriptionOf(page)}`;

/** The whole page as text: its title, its description when it has one, then every block as a section. Consumed by `eyes/doc-reads.ts` (`whole`). */
export function pageText(page: DocPage): string {
  const about = descriptionOf(page) === '' ? [] : [aboutSection(page)];
  return [`# ${page.title}`, ...about, ...page.blocks.map((block, index) => blockSection(block, index + 1))].join('\n\n');
}

/** The most characters of a block's title an outline line carries. */
const OUTLINE_TITLE_MAX = 80;

/** How many words of a block's text stand in for a title it does not have. */
const FIRST_WORDS = 8;

/** `text` cut to `max` characters, ending an ellipsis when it was cut; never splits a character. */
function shortened(text: string, max: number): string {
  const characters = Array.from(text);
  return characters.length <= max ? text : `${characters.slice(0, max - 1).join('')}…`;
}

/**
 * One outline line: `<n>. <type> · <title or first words> · block <id> · <characters>`. The title is the block's own heading; a
 * block without one is named by the first eight words of its text, and a block without text by "(no text)". The characters are
 * the length of the block as `whole` renders it (title and text fields), counted as a person counts them. Consumed by `eyes/doc-reads.ts`.
 */
export function outlineLine(block: DocBlock, number: number): string {
  const body = bodyLines(block).join(' ').split(/\s+/).filter((word) => word !== '');
  const firstWords = body.length === 0 ? '(no text)' : `${body.slice(0, FIRST_WORDS).join(' ')}${body.length > FIRST_WORDS ? '…' : ''}`;
  const name = block.title === null ? firstWords : shortened(block.title.replace(/\s+/g, ' '), OUTLINE_TITLE_MAX);
  return `${number}. ${block.type} · ${name} · block ${block.id} · ${characterCount(blockText(block))}`;
}

/**
 * The parts of `page` whose text holds `phrase` (without regard to case), in page order: its description first (as "About this page")
 * when it holds the phrase, then each block as its section under its place in the page; none when no part does. A phrase that is
 * only in the page's title holds no part. Consumed by `eyes/doc-reads.ts`.
 */
export function sectionsHolding(page: DocPage, phrase: string): string[] {
  const wanted = phrase.toLowerCase();
  const about = descriptionOf(page).toLowerCase().includes(wanted) ? [aboutSection(page)] : [];
  return [...about, ...page.blocks.flatMap((block, index) => (blockText(block).toLowerCase().includes(wanted) ? [blockSection(block, index + 1)] : []))];
}
