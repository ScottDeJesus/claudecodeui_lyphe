import { isList, isRecord, isText } from '@/shared/document-fields.js';

/**
 * THE HANDS' AND THE EYES' DOOR TO DOCSPACE. DocSpace is ArchPulse (:8005): its pages are the house's documents. This is
 * the one client the companion reads them with: `read_doc` and `search_docs` (`eyes/doc-reads.ts`) read through it, and
 * the hands (`hands/`) open a page by its id or its exact title through `resolvePage`, so a page is found one way.
 *
 * Three calls, each bounded at 15 seconds (`AbortSignal.timeout`, which covers the body as well as the headers):
 *   - `searchPages(q, limit)`: ArchPulse's own MCP `search_pages`, over `POST /api/mcp` as one JSON-RPC 2.0 `tools/call`
 *     (the endpoint needs no handshake first);
 *   - `readPage(id)`: `GET /api/docspace/pages/:id`;
 *   - `listPages()`: `GET /api/docspace/pages`, which answers EVERY page whole (megabytes), so it is read only to find a
 *     page by its title and handed on as ids, titles and folders alone.
 *
 * Each answers `{ ok: true, value }`, or `{ ok: false, sentence }` where the sentence is whole and ready to be told:
 * "DocSpace (ArchPulse on :8005) did not answer: <why>." Nothing here throws. A page ArchPulse says it does not hold
 * (HTTP 404) is an ANSWER, not a failure: `readPage` gives `{ ok: true, value: null }`. Node's own `fetch` does the work.
 *
 * Consumers: `eyes/doc-reads.ts` (`search_docs`, `read_doc`) and, for opening a page on his word, `hands/`.
 */

/** ArchPulse's address: the environment variable of that name, else the box's loopback on :8005. No trailing slash. Consumed by this file's calls and by a probe that points them at a stand-in. */
export const ARCHPULSE_URL = (process.env.ARCHPULSE_URL?.trim() || 'http://127.0.0.1:8005').replace(/\/+$/, '');

/** How long any one call waits for ArchPulse, headers and body together. */
const CALL_BOUND_MS = 15_000;

/** The shape of every answer of this client: the value, or the whole sentence that says why there is none. Consumed by every function here and by their callers. */
export type DocspaceAnswer<T> = { ok: true; value: T } | { ok: false; sentence: string };

/** One page a search found: `matchedBlocks` is how many of its blocks hold the words. Consumed by `eyes/doc-reads.ts`. */
export type DocHit = { id: string; title: string; folder: string; matchedBlocks: number };

/**
 * One block as the page holds it. `title` is the block's own heading when it has one (the field beside `data`, else
 * `data.title`); `data` is the type's own record, whose text fields differ by type (`content`, `code`, `message`, …).
 * Consumed by `eyes/doc-reads.ts` and its renderer.
 */
export type DocBlock = { id: string; type: string; title: string | null; data: Record<string, unknown> };

/** A whole page: its id, title, folder (`''` when it has none), its own description (`''` when it has none) and blocks in order. Consumed by `eyes/doc-reads.ts` and by `hands/`. */
export type DocPage = { id: string; title: string; folder: string; description: string; blocks: DocBlock[] };

/** A page as the list names it, without a block of it. Consumed by `listPages` here and by `hands/`, which finds a page by its exact title. */
export type DocTitle = { id: string; title: string; folder: string };

/** How every sentence of this client for a call ArchPulse did not answer begins. Consumed by `didNotAnswer` here and by `eyes/doc-reads.ts`, which tells those sentences from a plain not-found. */
export const DID_NOT_ANSWER = 'DocSpace (ArchPulse on :8005) did not answer:';

/** The sentence for a call ArchPulse did not answer; `why` loses its trailing full stop so the sentence has exactly one. */
const didNotAnswer = (why: string): string => `${DID_NOT_ANSWER} ${why.replace(/[.\s]+$/, '')}.`;

/** What went wrong with a fetch, in words a person can follow: the bound, a refused door, else the system's own reason. */
function whyNot(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') return `it took longer than ${CALL_BOUND_MS / 1000} seconds`;
  const cause = error instanceof Error ? error.cause : undefined;
  if (isRecord(cause) && cause.code === 'ECONNREFUSED') return 'the connection was refused';
  if (isRecord(cause) && isText(cause.message) && cause.message !== '') return cause.message;
  return error instanceof Error && error.message !== '' ? error.message : 'the call failed';
}

/** One bounded call: its status and its JSON body (`undefined` when the body is not JSON), or the sentence for a call that never completed. */
async function call(path: string, init?: RequestInit): Promise<{ ok: true; status: number; body: unknown } | { ok: false; sentence: string }> {
  try {
    const response = await fetch(`${ARCHPULSE_URL}${path}`, { ...init, signal: AbortSignal.timeout(CALL_BOUND_MS) });
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    return { ok: true, status: response.status, body };
  } catch (error) {
    return { ok: false, sentence: didNotAnswer(whyNot(error)) };
  }
}

/** The sentence for an answer that is not what DocSpace sends (a different build, or something else on the port). */
const unreadable = (what: string): { ok: false; sentence: string } => ({ ok: false, sentence: didNotAnswer(`its ${what} was not in the shape DocSpace sends`) });

/** A folder as the page names it: its text, `''` when the page sits in none. */
const folderOf = (value: unknown): string => (isText(value) ? value : '');

/**
 * The pages whose title or text holds `q` (a phrase, never empty), at most `limit` of them, in ArchPulse's own order. A search
 * ArchPulse refuses (an empty phrase, an unknown tool) is its own sentence inside ours. Consumed by `eyes/doc-reads.ts`
 * (`search_docs`).
 */
export async function searchPages(q: string, limit: number): Promise<DocspaceAnswer<DocHit[]>> {
  const reply = await call('/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_pages', arguments: { q, limit } } }),
  });
  if (!reply.ok) return reply;
  if (reply.status !== 200) return { ok: false, sentence: didNotAnswer(`it answered ${reply.status}`) };
  const { body } = reply;
  if (isRecord(body) && isRecord(body.error)) return { ok: false, sentence: didNotAnswer(isText(body.error.message) ? body.error.message : 'the search was refused') };
  const content = isRecord(body) && isRecord(body.result) && isList(body.result.content) ? body.result.content[0] : undefined;
  if (!isRecord(content) || !isText(content.text)) return unreadable('search answer');
  // A refusal of ArchPulse's own is plain text with `isError`, not the search's JSON.
  if (isRecord(body) && isRecord(body.result) && body.result.isError === true) return { ok: false, sentence: didNotAnswer(content.text) };
  let found: unknown;
  try {
    found = JSON.parse(content.text);
  } catch {
    return unreadable('search answer');
  }
  if (!isRecord(found) || !isList(found.pages)) return unreadable('search answer');
  const hits: DocHit[] = [];
  for (const page of found.pages) {
    if (!isRecord(page) || !isText(page.id) || !isText(page.title)) return unreadable('search answer');
    hits.push({ id: page.id, title: page.title, folder: folderOf(page.folder), matchedBlocks: isList(page.matchedBlockIds) ? page.matchedBlockIds.length : 0 });
  }
  return { ok: true, value: hits };
}

/** One block of a page read, or `null` for a block that has no id and type (the page's other blocks are still read). */
function blockOf(raw: unknown): DocBlock | null {
  if (!isRecord(raw) || !isText(raw.id) || !isText(raw.type)) return null;
  const data = isRecord(raw.data) ? raw.data : {};
  const named = [raw.title, data.title].find((candidate): candidate is string => isText(candidate) && candidate.trim() !== '');
  return { id: raw.id, type: raw.type, title: named?.trim() ?? null, data };
}

/**
 * The page `id` whole, in block order; `{ ok: true, value: null }` when ArchPulse holds no such page. `id` is one URL
 * segment: it is encoded, so a value with a slash in it names nothing rather than another route. Consumed by
 * `resolvePage` here and by `eyes/doc-reads.ts` through it.
 */
export async function readPage(id: string): Promise<DocspaceAnswer<DocPage | null>> {
  const reply = await call(`/api/docspace/pages/${encodeURIComponent(id)}`);
  if (!reply.ok) return reply;
  if (reply.status === 404) return { ok: true, value: null };
  if (reply.status !== 200) return { ok: false, sentence: didNotAnswer(`it answered ${reply.status}`) };
  const doc = isRecord(reply.body) ? reply.body.doc : undefined;
  if (!isRecord(doc) || !isText(doc.id) || !isText(doc.title) || !isList(doc.blocks)) return unreadable('page');
  const blocks = doc.blocks.flatMap((raw) => blockOf(raw) ?? []);
  return { ok: true, value: { id: doc.id, title: doc.title, folder: folderOf(doc.folder), description: isText(doc.description) ? doc.description : '', blocks } };
}

/**
 * Every page ArchPulse holds, as its id, title and folder (the blocks the list carries are dropped on the way in). The
 * list is one request for megabytes: read it only to find a page by its title. Consumed by `resolvePage` here and by `hands/`.
 */
export async function listPages(): Promise<DocspaceAnswer<DocTitle[]>> {
  const reply = await call('/api/docspace/pages');
  if (!reply.ok) return reply;
  if (reply.status !== 200) return { ok: false, sentence: didNotAnswer(`it answered ${reply.status}`) };
  if (!isRecord(reply.body) || !isList(reply.body.items)) return unreadable('page list');
  const titles: DocTitle[] = [];
  for (const item of reply.body.items) {
    const doc = isRecord(item) ? item.doc : undefined;
    if (isRecord(doc) && isText(doc.id) && isText(doc.title)) titles.push({ id: doc.id, title: doc.title, folder: folderOf(doc.folder) });
  }
  return { ok: true, value: titles };
}

/** A page id as ArchPulse mints them (`page-1793032570463-003-ev8jb8`, `page-docstore-archpulse-root`): one word of letters, digits and `._:-`, never a bare dot. */
const PAGE_ID = /^(?!\.+$)[A-Za-z0-9._:-]{1,200}$/;

/** A title compared the way he says it: case folded, runs of whitespace one space. */
const titleKey = (title: string): string => title.trim().replace(/\s+/g, ' ').toLowerCase();

/** How many same-titled pages the refusal names before it says how many more. */
const SAME_TITLE_NAMED = 5;

/**
 * A page by what he named: its id, else its exact title (without regard to case or the spacing between words). An id is
 * tried first when `ref` looks like one; a page ArchPulse does not hold under it falls through to the title. Several pages
 * under one title are refused with each named, folder and id, so a retry can name one by its id. Nothing found is refused
 * with the way to find it. Consumed by `eyes/doc-reads.ts` (`read_doc`) and, to open a page on his word, by `hands/`.
 */
export async function resolvePage(ref: string): Promise<DocspaceAnswer<DocPage>> {
  const wanted = ref.trim();
  if (PAGE_ID.test(wanted)) {
    const byId = await readPage(wanted);
    if (!byId.ok) return byId;
    if (byId.value !== null) return { ok: true, value: byId.value };
  }
  const listed = await listPages();
  if (!listed.ok) return listed;
  const matches = listed.value.filter((page) => titleKey(page.title) === titleKey(wanted));
  if (matches.length === 0) {
    return { ok: false, sentence: `No DocSpace page has the id or the title "${wanted}"; search_docs with a few of its words finds it.` };
  }
  if (matches.length > 1) {
    const named = matches.slice(0, SAME_TITLE_NAMED).map((page) => `${page.folder === '' ? 'no folder' : page.folder} · page ${page.id}`);
    const more = matches.length > SAME_TITLE_NAMED ? `, and ${matches.length - SAME_TITLE_NAMED} more` : '';
    return { ok: false, sentence: `${matches.length} DocSpace pages are titled "${wanted}": ${named.join('; ')}${more}. Name one by its id.` };
  }
  const page = await readPage(matches[0].id);
  if (!page.ok) return page;
  // The list named it a moment ago; a page deleted between the two calls is the same as no page.
  if (page.value === null) return { ok: false, sentence: `The DocSpace page "${wanted}" was just removed.` };
  return { ok: true, value: page.value };
}
