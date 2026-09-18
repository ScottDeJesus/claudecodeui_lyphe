import type { WidgetBodyShape } from '@/shared/types';

/**
 * Which KIND of widget a settled `widget` fence body is.
 *
 * The fence tag is still the whole opt-in — `CodeBlock` admits exactly the info-string word
 * `widget` and nothing else reaches here. What this file decides is the second question, the one
 * the tag cannot answer: given that a body IS a widget, is it HTML to run in a sandbox, a
 * reference to a DocSpace block to embed from ArchPulse, or an ADDRESS to draw in a frame?
 *
 * THE RAW PATH IS THE DEFAULT, and that is the load-bearing choice. Every body that is not
 * unambiguously a reference — anything not starting with a brace, anything that fails to parse,
 * any JSON whose `kind` is a word this file does not know — classifies as `html` and renders
 * exactly as it renders today. So this file cannot change what any existing widget does; each kind
 * it learns only adds a destination for bodies nothing has ever written before. A body that merely
 * CONTAINS the word docspace is HTML, because the test is the parsed `kind` field and never a
 * substring.
 *
 * `invalid` is reserved for the cases where silence would be a lie: a body that NAMES a kind this
 * file knows — `docspace`, `embed` — and then gets that kind's own fields wrong. Falling back to
 * HTML there would paint the reader a frame full of JSON with no hint of why; the error card says
 * what is wrong. A body naming a kind this file does NOT know is not an error, because a body
 * nobody meant as a reference can say anything: it is HTML, like every other unrecognised body.
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

/**
 * The longest address this will embed.
 *
 * A URL is not an id — it legitimately carries a query string, so the id pattern's character
 * allowlist cannot be reused here and the scheme check below is the whole of the validation. The
 * one thing still worth bounding is length: a pathological address belongs in no `src` attribute,
 * and 2048 is the ceiling every browser has effectively enforced for two decades anyway.
 */
const MAX_EMBED_URL_LENGTH = 2048;

/** The longest title an embed's card will wear. A heading is a name; past this it is a paragraph wearing a header's clothes. */
const MAX_EMBED_TITLE_LENGTH = 120;

/** Said once each, so the classifier, the error card and the probe can never drift into three wordings. */
const BAD_IDS_REASON = 'pageId and blockId must be present and well-formed';
const BAD_URL_REASON = 'url must be an absolute http:// or https:// address';

/** A parsed JSON value that is an object with named members — not null, and not an array. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True only for a string that matches the id pattern WHOLE — nothing coerced, nothing trimmed. */
function isEmbeddableId(value: unknown): value is string {
  return typeof value === 'string' && DOCSPACE_ID_RE.test(value);
}

/**
 * True only for an absolute `http:`/`https:` address within the length ceiling.
 *
 * THE SCHEME IS THE WHOLE GATE HERE, and it is checked by PARSING rather than by matching a
 * prefix: `javascript:`, `data:` and `blob:` are exactly the schemes that must never reach an
 * `src`, and a prefix test is defeated by whitespace and by case in ways the URL parser is not.
 * No base URL is passed, so a relative address does not parse and is refused — which is also what
 * keeps this function honest OUTSIDE a browser: `new URL(x)` needs no `window`, and this runs
 * during the HTML transcript export where there is none.
 *
 * Where the address POINTS is deliberately not asked here. That question — is this our own origin,
 * which would hand a frame the login token — is answered by `isForeignOrigin` inside `EmbedUrlFrame`,
 * behind the mount gate, because it is the one question that needs the live page to answer.
 */
function isEmbeddableUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_EMBED_URL_LENGTH) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** The model's own heading for an embed, or nothing — a blank, a non-string or an essay all become the card's default name. */
function readEmbedTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const title = value.trim();
  if (!title || title.length > MAX_EMBED_TITLE_LENGTH) return undefined;
  return title;
}

/**
 * The model's requested height, or nothing. Only a finite positive number survives — a string, a
 * NaN or a negative is dropped rather than refused, because a bad height is a cosmetic mistake and
 * the default draws a perfectly good frame. The CLAMP is `EmbedUrlFrame`'s, where the floor and
 * ceiling live beside the element they size.
 */
function readEmbedHeight(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Reads a settled fence body and says what it is. Never throws: a body is model output, so every
 * way it can be malformed has to end in one of the `WidgetBodyShape` arms rather than in an
 * exception. The kinds are tried in the order a reader would ask them: the named kinds first, each
 * refusing its own malformed fields, and `html` as the answer to everything left.
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

  if (!isPlainObject(parsed)) return { kind: 'html' };

  if (parsed.kind === 'embed') {
    if (!isEmbeddableUrl(parsed.url)) return { kind: 'invalid', reason: BAD_URL_REASON };
    return {
      kind: 'embed',
      ref: { url: parsed.url, title: readEmbedTitle(parsed.title), height: readEmbedHeight(parsed.height) },
    };
  }

  if (parsed.kind !== 'docspace') return { kind: 'html' };

  if (!isEmbeddableId(parsed.pageId) || !isEmbeddableId(parsed.blockId)) {
    return { kind: 'invalid', reason: BAD_IDS_REASON };
  }

  return { kind: 'docspace', ref: { pageId: parsed.pageId, blockId: parsed.blockId } };
}
