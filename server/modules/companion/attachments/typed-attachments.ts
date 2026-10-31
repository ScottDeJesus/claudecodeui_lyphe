import { promises as fs } from 'node:fs';
import path from 'node:path';

import mime from 'mime-types';

import type { CompanionAttachment } from '@/shared/companion-types.js';
import {
  claudeImageBlocks,
  filterAttachmentsToUploadStore,
  getGlobalImageAssetsDir,
  isImageAttachmentDescriptor,
  type ClaudeImageBlock,
} from '@/shared/image-attachments.js';

/**
 * Her typed door's reading of the files he attached to a line: the one place the stat, the sniff and the picture reads live, so
 * `POST /api/companion/messages` only parses and the service only decides. The page uploads to the chat's own route and posts the
 * records with his words; nothing it says about a file is trusted past the path, which goes through the same trust filter as the
 * chat's `chat.send` (only a direct child of the upload store passes) and is then read from the stored file: its size from the file,
 * its type from the stored name's extension, what she can do with it from the file itself (a picture by its type, a text file by its head and its
 * weight in her reader's prompt).
 *
 * Consumers: `companion.service.ts` (`sendText`).
 */

/**
 * How far into a file a NUL says "binary": the dactyl's own `_HEAD_BYTES` (`~/.claude/hooks/plan_runner/dactyls/refuse.py`, the
 * 8 KB its reader sniffs before it refuses a file as binary). A file she is told she can read must be a file her reader opens.
 */
const TEXT_SNIFF_BYTES = 8 * 1024;

/**
 * The ceiling of the dactyl's whole prompt: the dactyl's own `PROMPT_MAX_BYTES` (the same file: 320 KB, about 80K tokens, under the
 * 100K-token step where Haiku 5.5's price quintuples). It is not the largest file her reader opens: the reader weighs a file as the prompt
 * carries it (`read._sizes`) — its decoded text plus `LINE_NUMBER_BYTES` for every line, with the brief — and refuses what passes this, so
 * `opensOf` weighs the same way, and a text file whose weight passes it is `unopened`.
 */
const READER_MAX_BYTES = 320 * 1024;

/** What the reader adds before each line of a file: the dactyl's own `LINE_NUMBER_BYTES` (`dactyls/read.py`, `words.numbered` puts `f"{n:>6}\t"` before every line). */
const LINE_NUMBER_BYTES = 7;

/**
 * Room kept under `READER_MAX_BYTES` for her brief, which the reader weighs with the file and the door never sees: a sentence or two of hers.
 * A file within this of the ceiling is `unopened`, so she is not told she can read a file the reader refuses for a brief's width.
 */
const BRIEF_ROOM_BYTES = 2 * 1024;

/**
 * Types of a file the door never judges by its head: a PDF holds no NUL in its first 8 KB when its streams sit later (a hand-made one never has
 * one), and her prompt tells her she cannot open a PDF. Every other binary kind she names (an archive, an office document, audio, video, a picture)
 * typically opens with a header that holds a NUL, which the sniff finds.
 */
const NEVER_TEXT_TYPES = new Set(['application/pdf']);

/**
 * The stored name's looked-up types that say what a `text` file IS: any `text/*`, JSON and XML, the script and data types a developer attaches, and an SVG's
 * source. `mime-types` gives the extension's registered type, which for source files is often another thing (`server.ts` is `video/mp2t`, `lib.rs`
 * `application/rls-services+xml`): such a file's type is left out of its record rather than said wrongly, and her envelope reads `unknown type`.
 */
const TEXTUAL_TYPE = /^(text\/|image\/svg\+xml$|application\/(json|xml|javascript|x-sh|toml|sql|x-yaml)$|application\/[\w.-]+\+json$)/;

/** The longest name of his the line keeps, in characters (the 255 the door accepts, less room for a long name in her envelope). */
const NAME_MAX = 200;

/** The prefix the upload route puts before his name in a stored name: `<Date.now()>-<random>-`. */
const STORED_PREFIX = /^\d+-\d+-/;

/** One file as the page names it (`readBodyAttachments`), and what the preparation answers: the records and their pictures, or the one sentence that refuses the line. */
type NamedFile = { path: string; name: string };
type Prepared = { ok: true; attachments: CompanionAttachment[]; images: ClaudeImageBlock[] } | { ok: false; sentence: string };

/**
 * His name for the file as it is kept: trimmed, control characters dropped, cut to `NAME_MAX` characters (by code point, so a pair is never split).
 * Empty after that, it is the stored name less its `<digits>-<digits>-` prefix, which is the name he gave the upload. A refusal names a file by this,
 * never by the stored path.
 */
function nameOf(given: string, storedName: string): string {
  const his = Array.from(given.replace(/\p{Cc}/gu, '').trim()).slice(0, NAME_MAX).join('').trim();
  if (his !== '') return his;
  // The last resort is a word, never an empty name: a refusal reads "<name> is not in the upload store".
  return storedName.replace(STORED_PREFIX, '') || storedName || 'A file';
}

/**
 * True when her reader opens the file: its head (`TEXT_SNIFF_BYTES`) holds no NUL, and the file weighs, as the reader weighs it, no more than
 * `READER_MAX_BYTES` less `BRIEF_ROOM_BYTES`. That weight is the larger of its size and its decoded bytes (the prompt carries a text decoded, a byte that
 * is not UTF-8 becoming three) plus `LINE_NUMBER_BYTES` for every line, so it needs the text: the caller has already refused anything past
 * `READER_MAX_BYTES`, so what is read here is at most 320 KB.
 */
async function readerOpens(file: string): Promise<boolean> {
  const bytes = await fs.readFile(file);
  // Grown past the ceiling since the stat: the reader would refuse it all the more.
  if (bytes.length > READER_MAX_BYTES) return false;
  if (bytes.subarray(0, TEXT_SNIFF_BYTES).includes(0)) return false;
  const text = bytes.toString('utf8');
  const parts = text.split('\n');
  // `read.py` counts lines as `cat -n` does: a final newline ends the last line rather than starting one.
  const lines = text.endsWith('\n') ? parts.length - 1 : parts.length;
  const weight = Math.max(bytes.length, Buffer.byteLength(text)) + LINE_NUMBER_BYTES * lines;
  return weight + BRIEF_ROOM_BYTES <= READER_MAX_BYTES;
}

/**
 * What she can do with the file: `shown` for a picture (the chat's own test, `isImageAttachmentDescriptor`), `text` for a file her reader
 * opens (`readerOpens`; never a type in `NEVER_TEXT_TYPES`), `unopened` for the rest. An empty file is `unopened` whatever its name says: her
 * reader refuses an empty file, and a picture of no bytes is no image block the API would take.
 */
async function opensOf(file: string, size: number, mimeType: string | undefined): Promise<CompanionAttachment['opens']> {
  if (size === 0) return 'unopened';
  if (isImageAttachmentDescriptor({ path: file, mimeType })) return 'shown';
  if (size > READER_MAX_BYTES || (mimeType !== undefined && NEVER_TEXT_TYPES.has(mimeType))) return 'unopened';
  return (await readerOpens(file)) ? 'text' : 'unopened';
}

/**
 * One record read off the stored file, or `null` when the file cannot be read: it is gone, it is not a regular file (a symlink in the store is
 * no upload), or the read failed. The failure is logged here with its reason; the line's refusal says only what he can act on.
 */
async function readRecord(file: string, name: string): Promise<CompanionAttachment | null> {
  try {
    const stats = await fs.lstat(file);
    if (!stats.isFile()) {
      console.warn(`[Companion] A typed attachment is not a regular file of the upload store: ${path.basename(file)}`);
      return null;
    }
    const lookedUp = mime.lookup(path.basename(file)) || undefined;
    const opens = await opensOf(file, stats.size, lookedUp);
    // A file she can read keeps only a type that says what a text file is (`TEXTUAL_TYPE`); any other file keeps the extension's type as it is.
    const mimeType = opens === 'text' && lookedUp !== undefined && !TEXTUAL_TYPE.test(lookedUp) ? undefined : lookedUp;
    return { path: file, name, size: stats.size, ...(mimeType === undefined ? {} : { mimeType }), opens };
  } catch (error) {
    console.warn(`[Companion] A typed attachment could not be read from the upload store: ${path.basename(file)}`, { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

const notInStore = (name: string): Prepared => ({ ok: false, sentence: `${name} is not in the upload store; attach it again.` });
const unreadable = (name: string): Prepared => ({ ok: false, sentence: `${name} could not be read from the upload store; attach it again.` });

/**
 * His attached files made ready for her: each through the store's trust filter, deduplicated by path, its `size` and `mimeType` read from the stored file,
 * its `opens` decided, and the pictures read into image blocks by the chat's own reader. A file outside the store, or one that cannot be read, refuses the whole line
 * with a sentence that names it by his name for it, so nothing is logged or pushed for a line of which one file is wrong. The records' `path` is the stored file's
 * absolute path (the form `ask_dactyl` is handed). `images` are in the records' order, one block per `shown` file, read by one `claudeImageBlocks` call each: a picture
 * that yields no block is the "could not be read" refusal naming it. Consumed by `companion.service.ts` (`sendText`).
 */
export async function prepareTypedAttachments(records: NamedFile[]): Promise<Prepared> {
  const storeRoot = getGlobalImageAssetsDir();
  const attachments: CompanionAttachment[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    // Each record on its own, so the one the filter drops (it logs its own warn line) is the one the sentence names.
    const [admitted] = filterAttachmentsToUploadStore([{ path: record.path }]);
    const file = admitted === undefined ? null : path.resolve(storeRoot, admitted.path);
    const name = nameOf(record.name, path.basename(file ?? record.path));
    if (file === null) return notInStore(name);
    if (seen.has(file)) continue;
    seen.add(file);
    const read = await readRecord(file, name);
    if (read === null) return unreadable(name);
    attachments.push(read);
  }

  const images: ClaudeImageBlock[] = [];
  for (const attachment of attachments) {
    if (attachment.opens !== 'shown') continue;
    const [block] = await claudeImageBlocks([{ path: attachment.path, mimeType: attachment.mimeType }]);
    if (block === undefined) return unreadable(attachment.name);
    images.push(block);
  }
  return { ok: true, attachments, images };
}
