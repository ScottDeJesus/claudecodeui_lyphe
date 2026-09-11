/**
 * Numbers and tables: the one number grammar, and the table classes decided with it.
 *
 * `parseNumber` lives beside `classifyTable` because a `data-bars` verdict IS that grammar applied
 * down a column; `tableData.ts` sorts by the same grammar, so a column that bars is a column that
 * sorts numerically. Re-exported by `shapes/detect.ts` — import it from there.
 */

/** One table cell's plain text, as `hast.ts` reads it out of the tree. */
export type Cell = string;
export type Row = Cell[];
export type TableData = { headers: Row; rows: Row[] };
export type TableClass = 'decision-matrix' | 'before-after' | 'data-bars' | 'plain';

// A number and only a number: an optional sign, an integer part that is either plain digits or
// well-formed thousands groups, an optional decimal part, one optional unit. Anchored at BOTH
// ends because rejection is the whole point — `1.2.3`, `12ab`, a lone `-` and an empty cell must
// all fail, or a column of prose that happens to start with a digit turns a table into bars.
const NUMBER_RE = /^([+\-−]?)(\d+|\d{1,3}(?:,\d{3})+)(\.\d+)?([%$]|[KMB])?$/;
const UNIT_SCALE: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9 };

export function parseNumber(cell: string): number | null {
  const match = NUMBER_RE.exec(cell.trim());
  if (!match) return null;
  const [, sign, whole, fraction = '', unit = ''] = match;
  const magnitude = Number(`${whole.replace(/,/g, '')}${fraction}`);
  if (!Number.isFinite(magnitude)) return null;
  const scaled = magnitude * (UNIT_SCALE[unit] ?? 1);
  // U+2212 MINUS SIGN is what a model writes for a negative delta; `Number()` does not know it.
  return sign === '-' || sign === '−' ? -scaled : scaled;
}

const foldHeaders = (row: Row): string[] => row.map((cell) => cell.trim().toLowerCase());
const headersAre = (headers: string[], expected: string[]): boolean =>
  headers.length === expected.length && expected.every((word, index) => headers[index] === word);

/**
 * Which shape a table gets, in the plan's precedence: decision-matrix, before-after, data-bars,
 * plain. Every header test is on the WHOLE trimmed, case-folded header set — a table with an extra
 * column beside Option/Pros/Cons is a different table, and one whose headers merely CONTAIN those
 * words ("Option name") is prose that would lose its columns in a card grid.
 */
export function classifyTable(t: TableData): TableClass {
  const headers = foldHeaders(t.headers);
  if (headersAre(headers, ['option', 'pros', 'cons'])) return 'decision-matrix';
  if (headersAre(headers, ['option', 'pros', 'cons', 'verdict'])) return 'decision-matrix';
  if (headersAre(headers, ['before', 'after'])) return 'before-after';
  if (headers.length === 3 && headers[1] === 'before' && headers[2] === 'after') return 'before-after';
  if (soleNumericColumn(t) !== null) return 'data-bars';
  return 'plain';
}

/**
 * The ONE body column every row parses as a number, or null when there is not exactly one.
 *
 * `classifyTable` gives its `data-bars` verdict on this and `DataTable` paints the bar down the
 * column it names, from this one implementation: two copies of the rule would fail SILENTLY, as a
 * table classed `data-bars` that then finds no column and draws nothing. Two numeric columns is a
 * data table — a bar down one of them picks a winner the author never named — and one body row is
 * no comparison at all, since a bar against a single value is a rectangle that means nothing.
 */
export function soleNumericColumn(t: TableData): number | null {
  if (t.rows.length < 2) return null;
  let found: number | null = null;
  for (let column = 1; column < t.headers.length; column += 1) {
    if (!t.rows.every((row) => parseNumber(row[column] ?? '') !== null)) continue;
    if (found !== null) return null;
    found = column;
  }
  return found;
}
