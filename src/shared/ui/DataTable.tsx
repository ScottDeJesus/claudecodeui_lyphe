import { Fragment } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';

import type { DataTableColumn } from '@/shared/types';
import { cn } from '@/shared/utils';

type DataTableProps<Row> = {
  rows: Row[];
  columns: DataTableColumn<Row>[];
  /** A row's identity: React's key and the value `expanded` / `onExpand` speak in. */
  rowKey: (row: Row) => string;
  /** The table's accessible name. */
  label: string;
  /** The sorted column and its direction, held by the caller. A `column` with no `sortValue` sorts nothing. */
  sort?: { column: string; direction: 'asc' | 'desc' };
  /** Called with the pressed head's column `key`. Omitted: the heads are plain words, not buttons, with no sort mark until one holds the `sort`. */
  onSort?: (column: string) => void;
  /** The key of the row open under itself, or null. */
  expanded?: string | null;
  /** Called with a row's key to open it, or null to close the one that is open. */
  onExpand?: (key: string | null) => void;
  /** What an open row shows under itself. With it and `onExpand`, every row is pressable. */
  renderExpanded?: (row: Row) => ReactNode;
};


/** Two present keys in ascending order: numbers by size, text by locale with its digits read as numbers, a number before text. */
function compareKeys(a: number | string, b: number | string): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b, undefined, { numeric: true });
  return typeof a === 'number' ? -1 : 1;
}

/**
 * The rows in the order the sort asks. Stable: equal keys keep the caller's order, so a re-sort never shuffles
 * ties. The caller's array is not touched, and a sort on a column with no `sortValue` is no sort.
 */
function sortRows<Row>(rows: Row[], columns: DataTableColumn<Row>[], sort: DataTableProps<Row>['sort']): Row[] {
  const sortValue = sort ? columns.find((column) => column.key === sort.column)?.sortValue : undefined;
  if (!sort || !sortValue) return rows;

  const direction = sort.direction === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => {
      const key = sortValue(row);
      // A number that is not one has nothing to compare, exactly as `null` has none.
      return { row, index, key: typeof key === 'number' && Number.isNaN(key) ? null : key };
    })
    .sort((a, b) => {
      // Missing keys go last in BOTH directions, so a descending sort does not float the empty rows to the top.
      if (a.key === null || b.key === null) return a.key === b.key ? a.index - b.index : a.key === null ? 1 : -1;
      return direction * compareKeys(a.key, b.key) || a.index - b.index;
    })
    .map(({ row }) => row);
}

/** The head's mark: ▲ / ▼ on the sorted column (Verve's own), a faint ↕ on a sortable one not chosen. */
function sortMark(sorted: 'asc' | 'desc' | null): string {
  if (sorted === 'asc') return '▲';
  if (sorted === 'desc') return '▼';
  return '↕';
}

/**
 * Used by the affected-areas module for the proving tables (Verve §5 Data table · sortable): how well the reader's
 * regions agree with the operator's judgment, one row per kind.
 *
 * The table sorts; the caller owns WHICH sort. A column sorts when it carries `sortValue`: its head becomes a
 * button (with `onSort`), shows the sort arrows, and the sorted head carries `aria-sort`. The caller keeps
 * `sort` and answers `onSort(column)` — typically ascending on a new column, flipped on the same one — and the
 * table orders its rows by that column's `sortValue`. Rows come back in the caller's order when no sort is held.
 *
 * With `renderExpanded` and `onExpand`, a row opens under itself: the whole row is the press (a control inside a
 * cell keeps its own), it takes a tab stop and answers Enter and Space, and carries `aria-expanded`. One row is
 * open at a time because `expanded` is one key — pressing the open row closes it. A wide table scrolls sideways
 * inside its frame rather than breaking the page it sits in, its first column (the row's name) holding still at the
 * frame's edge, so a figure scrolled into view keeps its row (`verve/data.css`).
 */
export function DataTable<Row>({ rows, columns, rowKey, label, sort, onSort, expanded = null, onExpand, renderExpanded }: DataTableProps<Row>) {
  const shown = sortRows(rows, columns, sort);
  const openable = renderExpanded !== undefined && onExpand !== undefined;

  function toggleRow(key: string) {
    onExpand?.(expanded === key ? null : key);
  }

  /** A press anywhere on the row opens it, unless it landed on a control of the caller's own cell. */
  function pressRow(event: MouseEvent<HTMLTableRowElement>, key: string) {
    const control = (event.target as HTMLElement).closest('a, button, input, select, textarea, label, [role="button"]');
    if (control && event.currentTarget.contains(control)) return;
    toggleRow(key);
  }

  function keyRow(event: KeyboardEvent<HTMLTableRowElement>, key: string) {
    // Only the row's own key: Enter on a button inside a cell is that button's, not the row's.
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    toggleRow(key);
  }

  return (
    <div className="vv-datatable">
      <table aria-label={label}>
        <thead>
          <tr>
            {columns.map((column) => {
              const sortable = column.sortValue !== undefined;
              const direction = sort?.column === column.key && sortable ? sort.direction : null;
              // The mark says "this sorts", so it is drawn on a head that can be pressed, or one that holds the sort
              // the caller set; with no `onSort` a head is a plain word and stays one.
              const marked = sortable && (onSort !== undefined || direction !== null);
              const face = (
                <>
                  {column.label}
                  {marked && (
                    <span className="vv-datatable__arrow" aria-hidden="true">
                      {sortMark(direction)}
                    </span>
                  )}
                </>
              );
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={direction === null ? undefined : direction === 'asc' ? 'ascending' : 'descending'}
                  data-align={column.align === 'end' ? 'end' : undefined}
                  className="vv-datatable__head"
                >
                  {sortable && onSort ? (
                    <button type="button" className="vv-datatable__sort" onClick={() => onSort(column.key)}>
                      {face}
                    </button>
                  ) : (
                    <span className="vv-datatable__label">{face}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => {
            const key = rowKey(row);
            const open = openable && expanded === key;
            return (
              <Fragment key={key}>
                <tr
                  className={cn('vv-datatable__row', openable && 'vv-datatable__row--pressable', open && 'vv-datatable__row--open')}
                  tabIndex={openable ? 0 : undefined}
                  aria-expanded={openable ? open : undefined}
                  onClick={openable ? (event) => pressRow(event, key) : undefined}
                  onKeyDown={openable ? (event) => keyRow(event, key) : undefined}
                >
                  {columns.map((column) => (
                    <td key={column.key} data-align={column.align === 'end' ? 'end' : undefined} className="vv-datatable__cell">
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
                {open && (
                  <tr className="vv-datatable__opened">
                    <td colSpan={columns.length} className="vv-datatable__panel">
                      {renderExpanded(row)}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
