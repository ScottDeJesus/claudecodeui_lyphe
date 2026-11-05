import { oneMaskedFieldText, oneWellFormedLine } from './diagnosis-text.js';

/**
 * Everything a check last reported, as the lines of one prompt section: its stored result's `data` flattened to
 * `  <path>: <value>`, one scalar to a line, in the parsed object's own key order (a JS object lists integer-like keys first,
 * ascending, whatever order the document wrote them in).
 *
 * WHY IT IS GENERIC. The warden keeps every field a health-document component sends beside its status and its
 * sentence (`warden/src/probe-kinds/health-doc.mjs` — "everything the service sent beyond its verdict and sentence is
 * kept"), and the store holds it as the result's `data`. So whatever a service adds to a component (a last run, an age, the
 * operation that last failed) reaches the agent through this one function with no change here: there is no list of fields
 * to keep in step with the services. A dark poller's cause is found from what it last said, and the check's one sentence
 * (`THE CHECK`'s value) is only part of that.
 *
 * Every path and every value goes through `oneMaskedLine` (INV-7153), by way of `diagnosis-text.ts`'s two readers of a service's
 * own text. A STRING under a credential's NAME (`db.password`, `refresh_token`) is `<masked>` whole, because the value alone does not
 * say it is one and the line mask takes only the first word of it. A number or a boolean is read as written whatever its name says:
 * `token_remaining_hours: 7.6` is the fact a token-driven poller's diagnosis turns on, not a credential.
 *
 * Consumers: `diagnosis-agent.ts` (`diagnosisPromptOf`), which hands the lines to `buildDiagnosisSystemPrompt`.
 */

/** A path or a value is cut to this before it joins its line. */
const FIELD_LIMIT = 240;

/** The most lines the section holds; the fields past it are counted, not shown. */
const MAX_LINES = 40;

/**
 * How deep the flattening goes. The data is a service's own document and has no fixed shape; a container below this
 * reads as its JSON text on one line instead of as a path of a dozen parts.
 */
const MAX_DEPTH = 8;

type Leaf = { path: string; text: string; isString: boolean };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** What one leaf reads as: a string as it is, a number or a boolean as written, `null`, and an empty container as `{}` or `[]`. */
function leafText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.length === 0 ? '[]' : JSON.stringify(value);
  if (isObject(value)) return Object.keys(value).length === 0 ? '{}' : JSON.stringify(value);
  return String(value);
}

/** Depth-first, in the object's own key order; an array index is a path part like any key. */
function collectLeaves(value: unknown, path: string, depth: number, leaves: Leaf[]): void {
  const entries: Array<[string, unknown]> | null = Array.isArray(value)
    ? value.map((item, index): [string, unknown] => [String(index), item])
    : isObject(value)
      ? Object.entries(value)
      : null;
  if (entries === null || entries.length === 0 || depth >= MAX_DEPTH) {
    leaves.push({ path, text: leafText(value), isString: typeof value === 'string' });
    return;
  }
  for (const [name, child] of entries) collectLeaves(child, path === '' ? name : `${path}.${name}`, depth + 1, leaves);
}

/** One leaf as its line: its path and its value, each masked and cut (a string under a credential's name is masked whole). */
function lineOf({ path, text, isString }: Leaf): string {
  const value = isString ? oneMaskedFieldText(path, text, FIELD_LIMIT) : oneWellFormedLine(text, FIELD_LIMIT);
  return `  ${oneWellFormedLine(path, FIELD_LIMIT)}: ${value}`;
}

/**
 * The lines of the stored result's `data` JSON text: at most 40, then `  (<n> more fields not shown)`. `[]` for a
 * null, for text that is not JSON and for JSON that is not an object, and for an object with no field at all.
 */
export function reportedLines(data: string | null): string[] {
  if (data === null) return [];
  const leaves: Leaf[] = [];
  try {
    const parsed: unknown = JSON.parse(data);
    if (!isObject(parsed)) return [];
    for (const [name, child] of Object.entries(parsed)) collectLeaves(child, name, 1, leaves);
  } catch (error) {
    // Text that is not JSON, or a nesting too deep to walk, is a result with no fields to show: the diagnosis goes on without the section.
    console.error('[Cerberus] a stored result\'s data could not be read for a diagnosis prompt', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  const lines = leaves.slice(0, MAX_LINES).map(lineOf);
  if (leaves.length > MAX_LINES) lines.push(`  (${leaves.length - MAX_LINES} more fields not shown)`);
  return lines;
}
