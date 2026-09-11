/**
 * List marks: the leading time that makes a list a timeline and the leading glyph that makes it a
 * check list. Each mark has a DECIDE function and a MEASURE function built from one pattern, so a
 * list classed by one rule is never sliced by another. Re-exported by `shapes/detect.ts` — import
 * it from there.
 */

const MONTHS =
  'Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December';
// Each field is bounded to a real value rather than to a digit count: `99:99` and `2026-13-45` are
// not times, and a grammar that accepts them is one more way a list of version numbers or ratios
// becomes a timeline. Two digits after the colon is also what keeps `16:9` and `1:2` out.
const CLOCK = '(?:[01]?\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?';
const MERIDIEM = '(?:\\s*[AaPp]\\.?[Mm]\\.?)?';
const ISO_DATE = '\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])';
// An ISO date may carry its time: `2026-09-10T04:12` is what a pasted log line looks like, and the
// `T` is a word character, so without this the date alone fails the boundary and the whole line —
// the exact input Timeline exists for — reads as prose.
const ISO_TIME = `(?:T${CLOCK}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})?)?`;
const MONTH_DAY = `(?:${MONTHS})\\.?\\s+(?:[1-9]|[12]\\d|3[01])`;
// A clock time, an ISO timestamp or a month-day, at the START, ending on a non-word boundary.
const TIME_TOKEN_RE = new RegExp(`^(?:${CLOCK}${MERIDIEM}|${ISO_DATE}${ISO_TIME}|${MONTH_DAY})(?!\\w)`);

/**
 * How many characters of `text` the leading time token occupies, counting any whitespace before
 * it, or 0 when the text does not open with one.
 *
 * `Timeline` lifts that token out and draws it as the entry's label, so it needs the token's
 * EXTENT and not merely its existence. The answer lives here, beside the grammar, rather than as a
 * second regex inside the component: `parseFileRef` states the rule it follows — one grammar, one
 * home, two policies — and a shape carrying its own copy of `TIME_TOKEN_RE` would be a list that
 * becomes a timeline on one rule and then slices its own label with another.
 *
 * The two answers cannot drift, because `isTimeToken` below IS this function.
 */
export function timeTokenLength(text: string): number {
  const lead = text.length - text.trimStart().length;
  const match = TIME_TOKEN_RE.exec(text.slice(lead));
  return match ? lead + match[0].length : 0;
}

/** True when the text OPENS with a time, which is what makes a list a timeline. */
export function isTimeToken(text: string): boolean {
  return timeTokenLength(text.trim()) > 0;
}

// The four marks, named once. `checkGlyph` DECIDES with them and `checkGlyphLength` MEASURES with
// them, so the two can never disagree about what a mark is. All four are in the BMP, which is why
// one UTF-16 unit is a whole glyph below.
const PASS_GLYPHS = '✓✅';
const FAIL_GLYPHS = '✗❌';
const CHECK_GLYPH_RE = new RegExp(`^([${PASS_GLYPHS}${FAIL_GLYPHS}])\\s`);

/** The leading pass/fail glyph of a check line, or null. The glyph must be followed by space. */
export function checkGlyph(text: string): 'pass' | 'fail' | null {
  const match = CHECK_GLYPH_RE.exec(text.trim());
  if (!match) return null;
  return PASS_GLYPHS.includes(match[1]) ? 'pass' : 'fail';
}

/**
 * How many characters of `text` the leading check glyph occupies, counting any whitespace before
 * it, or 0 when it does not open with one.
 *
 * `CheckResults` lifts that glyph out and redraws it as the row's mark, so it needs the glyph's
 * EXTENT, and it needs it measured against the ORIGINAL string. `checkGlyph` cannot answer that:
 * it trims BOTH ends before testing for the space that must follow the mark, so a first text node
 * of exactly `"✓ "` — which is what `- ✓ **built** fine` gives, the glyph and then straight into a
 * bold — trims to `"✓"`, fails its own `\s` test, and the row loses its mark entirely.
 *
 * Requiring no trailing space here is correct rather than lax: by the time this runs, `checkGlyph`
 * has already read the item's WHOLE text and ruled the row a check. This only measures what it
 * found, and it measures it with the same four characters.
 */
export function checkGlyphLength(text: string): number {
  const lead = text.length - text.trimStart().length;
  const glyph = text.charAt(lead);
  return glyph && `${PASS_GLYPHS}${FAIL_GLYPHS}`.includes(glyph) ? lead + 1 : 0;
}
