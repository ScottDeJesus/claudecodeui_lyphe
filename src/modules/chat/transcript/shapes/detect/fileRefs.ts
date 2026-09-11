/**
 * File references: the one answer to "is this text a file, and on which line?" — the whole-text
 * parser with its two policies and the prose scanner, both built from the same fragments below so
 * a hit is a hit in both. Re-exported by `shapes/detect.ts` — import it from there.
 */

export type FileRef = { path: string; line: number | null; column: number | null };

/** Extensions a bare `name.ext` may carry and still be treated as a file, with no `:line` to vouch for it. */
export const KNOWN_EXTENSIONS: readonly string[] = [
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'json', 'md', 'mdx', 'py', 'rs', 'go', 'java',
  'rb', 'php', 'c', 'h', 'cpp', 'hpp', 'cs', 'sh', 'bash', 'zsh', 'yml', 'yaml', 'toml', 'sql',
  'css', 'scss', 'html', 'htm', 'txt', 'lock', 'conf', 'ini', 'xml', 'svg', 'vue', 'svelte',
  'kt', 'swift', 'dart', 'ex', 'exs',
];
const KNOWN_EXTENSION_SET = new Set<string>(KNOWN_EXTENSIONS);

// `-` is escaped and kept escaped: this class is concatenated into others below, where a trailing
// bare `-` would silently become a character RANGE and throw at module load.
const SEGMENT_CHARS = 'A-Za-z0-9_.+@~\\-';
// A line number is 1-based, unpadded, and fits in a file a person can open — 1 to 9,999,999. `:0`
// is not a line, `:007` is not how one is written, and `:99999999999999999999` parses to an
// imprecise float that would travel on as a nonsense `data-line` and query param. Both the
// whole-text parser and the prose scanner are built from THIS fragment, so there is one range and
// not two that drift: a padded or out-of-range suffix is rejected identically by both.
const LINE_NUMBER = '[1-9]\\d{0,6}';
const LINE_SUFFIX = `:${LINE_NUMBER}(?::${LINE_NUMBER})?`;
// An extension holds at least one LETTER. Every known extension does; the rule is for the other
// branch, where a `:line` vouches for an unknown one, and it is what keeps arithmetic and dates out
// of it: `3/4.5:1`, `1/2.0:3` and `2026/09/10.12:30` all parse as `digits/digits.digits:line`, and
// none of them is a file. A lookahead rather than `\d*[a-z]\w*`, which would backtrack in square
// time over a long run of letters and digits. Built into both readers, so they cannot disagree.
const EXTENSION = '(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]+';
const FILE_REF_RE = new RegExp(
  `^([${SEGMENT_CHARS}/]+)\\.(${EXTENSION})(?::(${LINE_NUMBER}))?(?::(${LINE_NUMBER}))?$`
);

// The declared-href reading's own suffix: any digits, because what it strips is decided by what the
// link override has always stripped, and a line outside `LINE_NUMBER`'s range then opens the file
// at its top — as it always did — rather than travelling on as `0` or an imprecise float.
const DECLARED_SUFFIX_RE = /:(\d+)(?::(\d+))?$/;
const lineOf = (digits: string | undefined): number | null => {
  if (digits === undefined) return null;
  const line = Number(digits);
  return line >= 1 && line <= 9_999_999 ? line : null;
};

/**
 * What a link's own href or text has always counted as a file here: a separator (`/` or `\`) or a
 * trailing `.ext`, once an optional `:line[:col]` is set aside. That is looser than the prose
 * grammar on purpose — the author DECLARED it a link, so a directory (`docs/plans/`), a dotfile
 * (`.gitignore`), an extensionless file (`src/Makefile`), an anchor (`src/parser.ts#L42`), a query
 * (`src/a.ts?raw`) and a percent-encoded name are all still handed to the in-app opener exactly as
 * they always were, instead of opening a new tab at a relative URL on the app's own origin. Not one
 * of those is text a bare-path scan should chip, which is why this reading is the link's alone.
 */
function readDeclaredRef(trimmed: string): FileRef | null {
  const suffix = DECLARED_SUFFIX_RE.exec(trimmed);
  const path = suffix ? trimmed.slice(0, suffix.index) : trimmed;
  if (!path || path === '#') return null;
  if (!/[\\/]/.test(path) && !/\.[a-z0-9]+$/i.test(path)) return null;
  const line = lineOf(suffix?.[1]);
  return { path, line, column: line === null ? null : lineOf(suffix?.[2]) };
}

/**
 * The ONE answer to "is this text a file reference, and what line is it on?".
 *
 * Both options default TRUE — the strict grammar the prose scan needs: a separator, and a known
 * extension unless a `:line` suffix vouches for it. `MarkdownLink` passes both FALSE, and that
 * policy is `readDeclaredRef` above: the reading an author-declared href has always had here. It
 * accepts every reference the strict grammar does, with the same path and line, and more besides.
 * Two policies, one home. (One option alone relaxes only its own check on the strict grammar.)
 */
export function parseFileRef(
  text: string,
  options: { requireSeparator?: boolean; requireKnownExtension?: boolean } = {}
): FileRef | null {
  const { requireSeparator = true, requireKnownExtension = true } = options;
  const trimmed = text.trim();
  // A URL is a reference to the web, not to the workspace, and its path half parses perfectly.
  if (!trimmed || trimmed.includes('://')) return null;
  if (!requireSeparator && !requireKnownExtension) return readDeclaredRef(trimmed);
  const match = FILE_REF_RE.exec(trimmed);
  if (!match) return null;
  const [, stemPath, extension, lineText, columnText] = match;
  // The final segment needs a real name: `src/.ts` and `src/..ts` are not files.
  const finalSegment = stemPath.slice(stemPath.lastIndexOf('/') + 1);
  if (!/[A-Za-z0-9_+@~-]/.test(finalSegment)) return null;
  // A suffix outside `LINE_NUMBER` fails the anchored match above, so the WHOLE reference is
  // rejected rather than quietly dropped to `line: null`: the text then stays plain and the reader
  // keeps every character the author wrote, where returning the bare path would render a chip
  // missing the `:0` or `:007` it was written with.
  if (requireSeparator && !stemPath.includes('/')) return null;
  if (requireKnownExtension && lineText === undefined && !KNOWN_EXTENSION_SET.has(extension.toLowerCase())) {
    return null;
  }
  return {
    path: `${stemPath}.${extension}`,
    line: lineText === undefined ? null : Number(lineText),
    column: columnText === undefined ? null : Number(columnText),
  };
}

/**
 * The global scanner for file references sitting inside ordinary prose. Same grammar as the strict
 * `parseFileRef`, expressed as one regex so a hit is a hit in both places.
 *
 * The leading lookbehind is what makes it URL-proof: inside `https://host/src/a.ts` every
 * candidate start is preceded by `/`, `.` or `:`, so the whole URL is immune and no `://` run can
 * ever be part of a match. Lookbehind is ES2018 and already required by this app at runtime —
 * `mermaid`, which `MermaidDiagram` loads to draw a fence, ships it in its own dist.
 *
 * **Use it only with `match`, `matchAll`, `replace` or `split`.** It carries the `g` flag, so
 * `test` and `exec` advance and KEEP `lastIndex` between calls: `re.test('src/a.ts')` is true, and
 * the identical call straight after is false. A `linkifyChildren` that walked many string children
 * with `test` would drop every other hit, and it would drop them silently — the methods named
 * above all reset `lastIndex` themselves, which is why they are the whole contract.
 */
export const FILE_REF_SCAN = new RegExp(
  `(?<![${SEGMENT_CHARS}:/])` +
    `(?:[${SEGMENT_CHARS}]+/)+[${SEGMENT_CHARS}]*[A-Za-z0-9_+@~-]` +
    `\\.(?:(?:${KNOWN_EXTENSIONS.join('|')})(?:${LINE_SUFFIX})?|${EXTENSION}${LINE_SUFFIX})` +
    // Both halves of the suffix grammar are the shared `LINE_SUFFIX`, and `(?!:\d)` closes the
    // last gap between the two readers: without it, a run the whole-text parser rejects for its
    // suffix (`src/a.ts:0`, `src/a.ts:007`) would still be scanned here as the bare path, and the
    // same characters would become a chip in prose while staying plain in an inline code span.
    `(?![A-Za-z0-9_])(?!:\\d)`,
  'gi'
);
