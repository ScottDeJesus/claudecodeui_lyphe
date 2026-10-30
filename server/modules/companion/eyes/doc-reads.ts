import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { guardedToolResult, textResult, type ToolTextResult } from '@/shared/tool-text-result.js';

import { toolLine } from '../session/companion-prompt.js';
import type { CompanionToolDeps } from '../tools/companion-tools.js';
import { signalOf } from '../tools/read-tools.js';

import { blockSection, descriptionOf, outlineLine, pageText, sectionsHolding } from './doc-render.js';
import { DID_NOT_ANSWER, resolvePage, searchPages, type DocHit, type DocPage } from './docspace-client.js';
import { cappedLines, toPanel, wholeOrDigest } from './eyes-answer.js';

/**
 * Her eyes on DocSpace, the house's pages (ArchPulse on :8005): `search_docs` finds pages by what they say, and `read_doc`
 * reads one. Both read through ArchPulse's own search and page reads (`docspace-client.ts`), and both are read-only. Neither
 * names a chat, so neither moves her focus or her activity: a read runs as `thinking`.
 *
 * `search_docs(phrase, panel)` answers one line per page, `<title> · <folder> · page <id> · <k> blocks match`, the first 10, then
 * how many more it left out. `read_doc(page, scope, panel)` takes a page by its id or its exact title, and a scope:
 *   - `outline`: one line per block, `<n>. <type> · <title or first words> · block <id> · <characters>`;
 *   - `whole`: every block rendered (`doc-render.ts`), handed over whole when it is 2,000 characters or fewer, else digested by a dactyl
 *     under "What does this page say: its purpose, its main points, and anything it asks or decides?";
 *   - a block's id: that block, whole or digested under "What does this block say?";
 *   - anything else is a phrase: the blocks that hold it (without regard to case), whole or digested under "What does this page say about: …?".
 * `panel: true` puts the answer's whole text on his panel as a note (a digest is not made for it). A page ArchPulse does
 * not answer for is told in one sentence ("DocSpace (ArchPulse on :8005) did not answer: …") and never guessed at. Her prompt's own line is each tool's
 * description (`toolLine`). No usage or spend appears in any answer.
 *
 * Consumer: `tools/companion-tools.ts`, which adds these two after the runs' reads.
 */

/** How many pages `search_docs` shows. */
const PAGES_MAX = 10;

/**
 * How many pages the search is asked for. ArchPulse's search takes any limit, and asking for more than is shown lets the last line
 * say how many were left out; the whole house is a few hundred pages, and a hit is a few hundred bytes.
 */
const SEARCH_ASKED = 500;

/** How many blocks an outline lists before it says how many it left out. */
const OUTLINE_MAX = 30;

/** The briefs a dactyl is handed, each ending as every eyes brief does: where to cite from, and how short. */
const WHOLE_BRIEF = 'What does this page say: its purpose, its main points, and anything it asks or decides? At most 15 lines; cite L<n>.';
const BLOCK_BRIEF = 'What does this block say? At most 12 lines; cite L<n>.';
const phraseBrief = (phrase: string): string => `What does this page say about: ${phrase}? At most 12 lines; cite L<n>.`;

/** The `panel` argument both tools take. */
const panelFlag = z.boolean().optional().describe('true puts the whole answer on his panel as a note instead of in your context; you are then told only that it is there.');

/** A line's worth of a stored text: whitespace folded to single spaces. */
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** A refusal built from the client's sentence: a DocSpace that did not answer is told to him, never guessed past. */
function refuseClient(deps: CompanionToolDeps, sentence: string): ToolTextResult {
  return deps.refuse(sentence.startsWith(DID_NOT_ANSWER) ? `${sentence} Tell him DocSpace is not answering; do not guess at what a page says.` : sentence);
}

/**
 * One search hit as a line: `<title> · <folder> · page <id> · <k> blocks match`. ArchPulse searches the page's stored record, so a page
 * can be a hit on its description or tags with none of its blocks matching: that is "0 blocks match", which says nothing of its title.
 */
function hitLine(hit: DocHit): string {
  const matches = hit.matchedBlocks === 1 ? '1 block matches' : `${hit.matchedBlocks} blocks match`;
  return `${oneLine(hit.title)} · ${hit.folder === '' ? 'no folder' : oneLine(hit.folder)} · page ${hit.id} · ${matches}`;
}

/** `search_docs`: the pages that hold the phrase, one line each, 10 at most. Moves neither her focus nor her activity. */
function searchDocs(deps: CompanionToolDeps, args: { phrase: string; panel?: boolean }): Promise<ToolTextResult> {
  return guardedToolResult('search_docs', 'search DocSpace', async () => {
    const found = await searchPages(args.phrase, SEARCH_ASKED);
    if (!found.ok) return refuseClient(deps, found.sentence);
    if (found.value.length === 0) return textResult(`No DocSpace page holds "${oneLine(args.phrase)}".`);
    const capped = cappedLines(found.value.map(hitLine), PAGES_MAX);
    // ArchPulse hands back at most as many pages as it was asked for (and no more than 500): at that count the pages left out are a floor, not a count.
    const text = found.value.length >= SEARCH_ASKED ? capped.replace(/(^|\n)And (\d+) more;/, '$1At least $2 more;') : capped;
    const answer = textResult(text);
    return args.panel === true ? toPanel(deps, `DocSpace: ${oneLine(args.phrase)}`, answer) : answer;
  });
}

/** A page's heading, said before its outline or a part of it: `"<title>" · <folder> · page <id>`. */
const pageHeading = (page: DocPage): string => `"${oneLine(page.title)}" · ${page.folder === '' ? 'no folder' : oneLine(page.folder)} · page ${page.id}`;

/** The longest page description an outline carries on its "About" line. */
const ABOUT_MAX = 300;

/** The page's description as one "About" line, cut at 300 characters; `''` for a page with none. */
function aboutLine(page: DocPage): string {
  const characters = Array.from(oneLine(descriptionOf(page)));
  return characters.length === 0 ? '' : `About: ${characters.length <= ABOUT_MAX ? characters.join('') : `${characters.slice(0, ABOUT_MAX - 1).join('')}…`}`;
}

/** The sentence for a page with no block: its heading, and its description when it has one. */
const noBlocks = (page: DocPage): string => [`${pageHeading(page)} has no blocks.`, aboutLine(page)].filter((line) => line !== '').join('\n');

/** `outline`: the page's blocks, one line each, under its heading and its description. */
function outline(deps: CompanionToolDeps, page: DocPage, panel: boolean): ToolTextResult {
  if (page.blocks.length === 0) return textResult(noBlocks(page));
  const lines = cappedLines(page.blocks.map((block, index) => outlineLine(block, index + 1)), OUTLINE_MAX);
  const about = aboutLine(page);
  const answer = textResult(`${pageHeading(page)}, ${page.blocks.length} ${page.blocks.length === 1 ? 'block' : 'blocks'}:\n${about === '' ? '' : `${about}\n`}${lines}`);
  return panel ? toPanel(deps, `${page.title} · outline`, answer) : answer;
}

/** One rendered text, as the answer: on his panel whole, or handed over whole / digested under `brief`. */
function answerText(
  deps: CompanionToolDeps,
  read: { text: string; label: string; brief: string; intro: string; panelTitle: string; panel: boolean },
  signal: AbortSignal | undefined
): Promise<ToolTextResult> | ToolTextResult {
  if (read.panel) return toPanel(deps, read.panelTitle, textResult(read.text));
  return wholeOrDigest(deps, { text: read.text, label: read.label, brief: read.brief, intro: read.intro }, signal);
}

/** The text of one `read_doc` call, after the page is resolved. */
function readScope(deps: CompanionToolDeps, page: DocPage, scope: string, panel: boolean, signal: AbortSignal | undefined): Promise<ToolTextResult> | ToolTextResult {
  const heading = pageHeading(page);
  const keyword = scope.toLowerCase();
  if (keyword === 'outline') return outline(deps, page, panel);
  if (page.blocks.length === 0) return textResult(noBlocks(page));
  if (keyword === 'whole') {
    const intro = `${heading}, ${page.blocks.length} ${page.blocks.length === 1 ? 'block' : 'blocks'}:`;
    return answerText(deps, { text: pageText(page), label: 'doc-whole', brief: WHOLE_BRIEF, intro, panelTitle: page.title, panel }, signal);
  }

  const index = page.blocks.findIndex((block) => block.id === scope);
  if (index !== -1) {
    const text = blockSection(page.blocks[index], index + 1);
    return answerText(deps, { text, label: 'doc-block', brief: BLOCK_BRIEF, intro: `${heading}, block ${index + 1}:`, panelTitle: `${page.title} · block ${index + 1}`, panel }, signal);
  }
  // A block id the page does not hold is a mistake to correct, not a phrase to search for.
  if (/^blk-/.test(scope)) return deps.refuse(`${heading} has no block ${scope}; read_doc with scope outline lists its blocks.`);

  const phrase = oneLine(scope);
  const sections = sectionsHolding(page, phrase);
  if (sections.length === 0) return textResult(`${heading} does not mention "${phrase}".`);
  // The parts a phrase is searched in: the page's description (when it has one) and its blocks.
  const parts = page.blocks.length + (descriptionOf(page) === '' ? 0 : 1);
  const intro = `${heading}: ${sections.length} of ${parts} ${parts === 1 ? 'part holds' : 'parts hold'} "${phrase}" (the page's description and blocks):`;
  return answerText(deps, { text: sections.join('\n\n'), label: 'doc-phrase', brief: phraseBrief(phrase), intro, panelTitle: `${page.title} · ${phrase}`, panel }, signal);
}

/** `read_doc`: resolves the page by its id or exact title, then reads the scope. Moves neither her focus nor her activity. */
function readDoc(deps: CompanionToolDeps, args: { page: string; scope: string; panel?: boolean }, signal: AbortSignal | undefined): Promise<ToolTextResult> {
  return guardedToolResult('read_doc', 'read the page', async () => {
    const found = await resolvePage(args.page);
    if (!found.ok) return refuseClient(deps, found.sentence);
    return readScope(deps, found.value, args.scope.trim(), args.panel === true, signal);
  });
}

/**
 * The definitions of `search_docs` and `read_doc` (the order her prompt lists them), built with the SDK's `tool()` and zod. Both are
 * marked read-only: they change nothing and the CLI never asks about them. Consumed by `tools/companion-tools.ts`
 * (`buildCompanionTools`), once per account.
 */
export function docReads(deps: CompanionToolDeps): Array<SdkMcpToolDefinition<any>> {
  const readOnly = { annotations: { readOnlyHint: true } };
  return [
    tool(
      'search_docs',
      toolLine('search_docs'),
      {
        phrase: z.string().trim().min(1).max(200).describe('A few distinctive words the page holds, in its title or its text. Not a whole question.'),
        panel: panelFlag,
      },
      (args) => searchDocs(deps, args),
      readOnly
    ),
    tool(
      'read_doc',
      toolLine('read_doc'),
      {
        page: z.string().trim().min(1).max(300).describe('The page, by its id (page-…) as search_docs prints it, or by its exact title.'),
        scope: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe(
            "outline: one line per block with its id and length. whole: every block (a long page comes as a digest). A block's id (blk-…): that block. Anything else is a phrase: the blocks that hold it, as a digest when long."
          ),
        panel: panelFlag,
      },
      (args, extra) => readDoc(deps, args, signalOf(extra)),
      readOnly
    ),
  ];
}
