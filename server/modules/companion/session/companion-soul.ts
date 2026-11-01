import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * HER SOUL, READ AT EVERY LAUNCH: the two pages that say who she is, `PERSONALITY.md` (her persona, what moves her, how she talks)
 * and `DIRECTIVE.md` (her place beside his sessions), kept in the Pantheon's charters folder, `~/.claude/charters/kaylee`
 * (`COMPANION_SOUL_DIR` names another, read on each call, so a probe may point it elsewhere). They stay where they are and are read
 * here, never copied into this repo and never held across launches, so an edit to either page is in her next launch and there is no
 * second home for it to drift from. This file is the one place with the I/O, which keeps `companion-prompt.ts` pure.
 */

const SOUL_PAGES = ['PERSONALITY.md', 'DIRECTIVE.md'] as const;

// A leading YAML block: a first line `---` through the next line that is `---` (CRLF or LF), when it is empty or its first line is a
// `key:`. A markdown rule that opens a page is not a block, so the text between two rules is never taken for one.
const FRONTMATTER = /^---[ \t]*\r?\n(?:[A-Za-z_][\w-]*[ \t]*:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;
const OPENING_FENCE = /^---[ \t]*(?:\r?\n|$)/;

/**
 * A page's text without its frontmatter and trimmed, or the reason there is none. The headings and the markdown are never touched;
 * a leading byte-order mark is dropped first, so an editor that adds one cannot hide the block. `fenceKept` says the page opens with a
 * `---` line that is no closed YAML block (never closed, or a rule): the page is then left whole, and the caller says so.
 */
function readPageBody(file: string): { body: string; fenceKept: boolean } | { reason: string } {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    return { reason: missing ? 'the file does not exist' : error instanceof Error ? error.message : String(error) };
  }
  const text = raw.replace(/^\uFEFF/, '');
  const body = text.replace(FRONTMATTER, '').trim();
  return body === '' ? { reason: 'the page is empty' } : { body, fenceKept: OPENING_FENCE.test(text) && !FRONTMATTER.test(text) };
}

/**
 * Her soul as text: `PERSONALITY.md` then `DIRECTIVE.md`, each without its frontmatter, joined by one blank line. A page that is
 * missing, unreadable or empty never stops her launch: one sentence stands in its place in her own voice, naming the page, its path and
 * why, and the same fault is warned in the journal. Synchronous and read afresh on every call. Consumed by `session/companion-session.ts`,
 * once for every launch it plans: the text goes into `fillSystemPrompt`, whose answer is both hashed into the launch's shape and sent.
 */
export function readSoul(userId: number): string {
  const folder = process.env.COMPANION_SOUL_DIR || path.join(os.homedir(), '.claude', 'charters', 'kaylee');
  return SOUL_PAGES.map((page) => {
    const file = path.join(folder, page);
    const read = readPageBody(file);
    if ('body' in read) {
      if (read.fenceKept) console.warn(`[Companion] account ${userId}: her soul page ${page} (${file}) opens with a \`---\` line that is no closed YAML block; the page is left whole in her prompt`);
      return read.body;
    }
    console.warn(`[Companion] account ${userId}: her soul page ${page} (${file}) could not be read: ${read.reason}; her prompt carries a note in its place`);
    return `Your page ${page} at ${file} could not be read at this launch: ${read.reason}. Tell him once, then carry on from the register.`;
  }).join('\n\n');
}
