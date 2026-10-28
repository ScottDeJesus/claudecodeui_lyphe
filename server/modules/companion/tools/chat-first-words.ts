import { sessionsDb } from '@/modules/database/index.js';
import { oneLine } from '@/shared/tool-call-hint.js';
import { extractFirstValidJsonlData } from '@/shared/utils.js';

/**
 * The words a chat was started with, for `list_sessions`'s phrase search ("the kanban one" finds the chat whose
 * first message was about the kanban board, whatever it has been renamed since).
 *
 * It reads only the HEAD of the chat's transcript — the first user row — never the whole of it. The history
 * reader parses a transcript end to end (the largest of his today is 27 MB) and holds eight of them in its cache,
 * so a search that read twenty chats through it would take seconds and push the chats he has open out of that
 * cache. The head read stops at the first line that answers, which is a few kilobytes in.
 *
 * A COMPACTED CHAT opens with the compaction's seed, a user row that begins "This session is being continued from a
 * previous conversation…" and then carries the summary of everything before (measured: 12 of his 19 chats today).
 * Those opening words are boilerplate, so the words after "Summary:" stand in: they name the threads of the chat,
 * which is what a search for "the kanban one" needs.
 *
 * Best effort and said so: only a Claude chat has a transcript file this reads, a row the CLI wrote for itself
 * (a slash command's echo, a background-task notice, a system reminder — each opens with a tag) is passed over,
 * and a chat whose plain first message is not within `HEAD_ROWS_SCANNED` rows has none. It feeds a search and
 * is never something she says as fact.
 *
 * Consumer: `session-tools.ts`.
 */

/** How much of the first message a search sees: enough to hold what the opening was about, little enough to stay a line. */
const FIRST_WORDS_CHARACTERS = 400;

/** The compaction seed's boilerplate, through the "Summary:" that ends it; what follows is the summary itself. */
const CONTINUATION_PREAMBLE = /^This session is being continued from a previous conversation[\s\S]*?\bSummary:\s*/;

/** How many transcript rows the head read looks through before it gives up: the first message is the first few. */
const HEAD_ROWS_SCANNED = 200;

type TranscriptRow = { type?: unknown; isSidechain?: unknown; isMeta?: unknown; message?: { content?: unknown } };

/** The words of one transcript row when it is a plain user message of the chat itself, else `null`. */
function userWordsOf(rawRow: unknown): string | null {
  const row = rawRow as TranscriptRow | null;
  if (row?.type !== 'user' || row.isSidechain === true || row.isMeta === true) return null;
  const content = row.message?.content;
  const text = Array.isArray(content)
    ? content.map((block: { type?: unknown; text?: unknown }) => (block?.type === 'text' && typeof block.text === 'string' ? block.text : '')).join(' ')
    : typeof content === 'string' ? content : '';
  // The summary is markdown; its emphasis marks only spend the characters a search has. A message he typed is left as he wrote it.
  const words = oneLine(CONTINUATION_PREAMBLE.test(text) ? text.replace(CONTINUATION_PREAMBLE, '').replace(/[*#]/g, '') : text);
  return words && !words.startsWith('<') ? words.slice(0, FIRST_WORDS_CHARACTERS) : null;
}

/** A chat's first words never change once written, so a found answer is kept for the life of the process. A miss is not kept: the first message may simply not have arrived. */
const knownFirstWords = new Map<string, string>();

/**
 * The first words of a chat (up to 400 characters, one line), or `''` when it has none this read can find.
 * Never throws: an unreadable transcript is a chat with no first words, and the search goes on by its name.
 */
export async function firstWordsOf(sessionId: string): Promise<string> {
  const known = knownFirstWords.get(sessionId);
  if (known !== undefined) return known;
  const row = sessionsDb.getSessionById(sessionId);
  if (!row || row.provider !== 'claude' || !row.jsonl_path) return '';
  let rowsSeen = 0;
  // The extractor stops the file read at its first truthy answer, so giving up is an answer: an object holding nothing.
  const head = await extractFirstValidJsonlData<{ words: string }>(row.jsonl_path, (rawRow) => {
    rowsSeen += 1;
    const words = userWordsOf(rawRow);
    if (words !== null) return { words };
    return rowsSeen >= HEAD_ROWS_SCANNED ? { words: '' } : null;
  });
  const words = head?.words ?? '';
  if (words) knownFirstWords.set(sessionId, words);
  return words;
}
