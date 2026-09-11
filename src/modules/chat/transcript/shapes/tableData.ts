import type { Row, TableData } from '@/modules/chat/transcript/shapes/detect';
import { parseNumber } from '@/modules/chat/transcript/shapes/detect';

/**
 * What the table shapes DECIDE with: the pure functions that turn a parsed `TableData` into a row
 * order, a CSV, a bar width and a collapse payload.
 *
 * They live beside the components rather than inside them for two reasons. The first is the rule
 * this whole feature rests on — the parsed TEXT decides, the rendered children get drawn — and a
 * module that cannot import React cannot be tempted to blur that line. The second is mechanical:
 * a `.tsx` file that exports a helper beside its component loses Fast Refresh for the component,
 * which oxlint reports and this repo's warning ratchet does not allow to rise.
 *
 * `detect.ts` stays the home of every TRIGGER; this is the home of what happens after one fires,
 * and it is used by `DataTable.tsx` and by `elements/table.tsx`.
 */

/**
 * The `payload` a table's collapse key is hashed from, per the plan's one table of payloads: the
 * headers and every row, joined. Spelled once because all four table kinds share it.
 */
export const tablePayload = (table: TableData): string =>
  [table.headers.join('|'), ...table.rows.map((row) => row.join('|'))].join('\n');

/** The `data-shape` a DataTable wears. One home, so the frame and its collapse key cannot disagree. */
export const dataTableKind = (barColumn: number | null): 'table' | 'data-bars' =>
  barColumn === null ? 'table' : 'data-bars';

// `soleNumericColumn` is NOT here. It lives in `detect.ts` beside `classifyTable`, which calls it
// for its own `data-bars` verdict — one implementation, because a second copy of that rule would
// fail silently as a table classed `data-bars` that then finds no column and draws no bar.

/**
 * One cell against another, for the sort. A column whose cells all parse compares as NUMBERS, so 9
 * lands before 100; a column of prose compares with `numeric: true`, so `item 2` still lands before
 * `item 10`. Where a column is mixed, numbers rank ahead of words rather than scattering through
 * them — a ranking with one `n/a` in it stays a ranking. Nothing here can throw on an empty cell,
 * and nothing here reads a cell it was not given: a short row cannot reach past its own end.
 */
export function compareCells(left: string, right: string): number {
  const leftNumber = parseNumber(left);
  const rightNumber = parseNumber(right);
  if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
  if (leftNumber !== null) return -1;
  if (rightNumber !== null) return 1;
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * The row order a sort produces, as indices into `rows`. Ascending, descending, or the author's own
 * order when `sort` is null — the third state, which a ranked or chronological table needs back.
 *
 * STABLE in both directions: the tiebreak is the ORIGINAL index and it stays ascending whichever
 * way the comparison runs, so equal cells keep the order the author wrote them in rather than
 * flipping when the arrow does.
 */
export function sortedOrder(
  rows: Row[],
  sort: { column: number; direction: 'asc' | 'desc' } | null
): number[] {
  const order = rows.map((_, index) => index);
  if (!sort) return order;
  const direction = sort.direction === 'asc' ? 1 : -1;
  return order.sort((left, right) => {
    const compared = compareCells(rows[left][sort.column] ?? '', rows[right][sort.column] ?? '');
    return compared === 0 ? left - right : compared * direction;
  });
}

/** RFC 4180: a cell carrying a comma, a quote or a newline is quoted, and inner quotes are doubled. */
const csvCell = (cell: string): string =>
  /[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;

/** The whole table as CSV — headers first, then the rows in the order the reader is looking at. */
export const toCsv = (headers: Row, rows: Row[]): string =>
  [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');

/**
 * Each row's bar width as a percentage of the widest, floored at 1 so a zero row still shows where
 * its column is. Magnitude, so a column of negative deltas draws bars at all — and a largest of
 * zero is a column of zeroes rather than a division, which is why nothing here can divide by it.
 */
export function barPercents(rows: Row[], column: number): number[] {
  const values = rows.map((row) => parseNumber(row[column] ?? '') ?? 0);
  const largest = values.reduce((most, value) => Math.max(most, Math.abs(value)), 0);
  if (largest === 0) return values.map(() => 1);
  return values.map((value) => Math.max(1, Math.min(100, Math.round((Math.abs(value) / largest) * 100))));
}
