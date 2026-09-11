import type { WidgetBodyShape } from '@/shared/types';

/**
 * Which KIND of widget a settled `widget` fence body is.
 *
 * The fence tag is still the whole opt-in — `CodeBlock` admits exactly the info-string word
 * `widget` and nothing else reaches here. What this file decides is the second question, the one
 * the tag cannot answer: given that a body IS a widget, is it HTML to run in a sandbox, or a
 * reference to a DocSpace block to embed from ArchPulse?
 *
 * THE RAW PATH IS THE DEFAULT, and that is the load-bearing choice. Every body that is not
 * unambiguously a DocSpace reference — anything not starting with a brace, anything that fails to
 * parse, any JSON whose `kind` is something else — classifies as `html` and renders exactly as it
 * renders today. So this file cannot change what any existing widget does; it can only add a
 * second destination for bodies nothing has ever written before. A body that merely CONTAINS the
 * word docspace is HTML, because the test is the parsed `kind` field and never a substring.
 *
 * `invalid` is reserved for the one case where silence would be a lie: a body that says
 * `kind: 'docspace'` and then names ids that cannot be embedded. Falling back to HTML there would
 * paint the reader a frame full of JSON with no hint of why; the error card says what is wrong.
 */

/**
 * The ids this will embed, and the same pattern ArchPulse's own embed route parses
 * (`src/embed/embedRoute.ts`, `EMBED_ID_RE`) — one shape, spelled the same on both sides of the
 * frame, so an id either surface accepts is an id the other accepts.
 *
 * It is an ALLOWLIST of characters rather than a ban on the dangerous ones, which is why `/` and
 * a leading `.` are refused without either being named: an id may only be a word made of letters,
 * digits, dot, underscore, colon and hyphen, and may only START with a letter or digit. That
 * rules out `../x` (leading dot), `a/b` (slash) and the empty string in one stroke, and it stays
 * right when a new traversal spelling is invented. The 200-character ceiling keeps a pathological
 * id out of a URL.
 */
export const DOCSPACE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

/** Said once, so the classifier, the error card and the probe can never drift into three wordings. */
const BAD_IDS_REASON = 'pageId and blockId must be present and well-formed';

/** A parsed JSON value that is an object with named members — not null, and not an array. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True only for a string that matches the id pattern WHOLE — nothing coerced, nothing trimmed. */
function isEmbeddableId(value: unknown): value is string {
  return typeof value === 'string' && DOCSPACE_ID_RE.test(value);
}

/**
 * Reads a settled fence body and says what it is. Never throws: a body is model output, so every
 * way it can be malformed has to end in one of the three shapes rather than in an exception.
 */
export function classifyWidgetBody(code: string): WidgetBodyShape {
  const body = code.trim();

  // The cheap gate first, and it is also the honest one: JSON naming a block is an object, so a
  // body that does not open with a brace cannot be one. Anything else is HTML and stays HTML.
  if (!body.startsWith('{')) return { kind: 'html' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // A brace does not make it JSON — an HTML widget may well open with a `{` inside a template
    // or a style block. Unparseable is not an error here; it is the raw path.
    return { kind: 'html' };
  }

  if (!isPlainObject(parsed) || parsed.kind !== 'docspace') return { kind: 'html' };

  if (!isEmbeddableId(parsed.pageId) || !isEmbeddableId(parsed.blockId)) {
    return { kind: 'invalid', reason: BAD_IDS_REASON };
  }

  return { kind: 'docspace', ref: { pageId: parsed.pageId, blockId: parsed.blockId } };
}
