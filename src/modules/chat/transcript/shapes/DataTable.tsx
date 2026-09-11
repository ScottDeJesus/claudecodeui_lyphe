import { Children, cloneElement, isValidElement, useEffect, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, CheckIcon, CopyIcon } from 'lucide-react';

import { Meter } from '@/shared/ui';
import { copyTextToClipboard } from '@/shared/utils';
import { ChipsSuppressedContext } from '@/modules/chat/transcript/shapes/chipContext';
import type { TableData } from '@/modules/chat/transcript/shapes/detect';
import type { HastNode } from '@/modules/chat/transcript/shapes/hast';
import { barPercents, dataTableKind, sortedOrder, toCsv } from '@/modules/chat/transcript/shapes/tableData';
import { ShapeFrame } from '@/modules/chat/transcript/shapes/ShapeFrame';
import { useShapeInteractive } from '@/modules/chat/transcript/shapes/useShapeCollapse';

/** What react-markdown hands an override: the hast node beside the already-rendered children. */
type RenderedElement = ReactElement<{ node?: HastNode; children?: ReactNode }>;

type DataTableProps = {
  /** The cell TEXT, which decides the row order and fills the CSV — never what gets drawn. */
  data: TableData;
  /** The one numeric column that carries a bar, or null for an ordinary sortable table. */
  barColumn: number | null;
  collapseKey: string;
  /** The table as react-markdown rendered it, inline marks intact. This is what gets drawn. */
  children?: ReactNode;
};

type SortState = { column: number; direction: 'asc' | 'desc' };

/**
 * The tag a rendered child stands for. An element react-markdown routed through one of our own
 * overrides is a FUNCTION whose tag only `props.node` still knows; one it left alone (`tbody`) is an
 * intrinsic string. Reading both is what lets this module find its rows without caring which.
 */
const tagOf = (element: ReactElement): string =>
  typeof element.type === 'string'
    ? element.type
    : String((element as RenderedElement).props.node?.tagName ?? '');

const elementsOf = (children: ReactNode): RenderedElement[] =>
  Children.toArray(children).filter(isValidElement) as RenderedElement[];

const taggedChildren = (children: ReactNode, tag: string): RenderedElement[] =>
  elementsOf(children).filter((child) => tagOf(child) === tag);

/** The rendered `th` cells, so a header keeps whatever the author marked up inside it. */
const headerCellsOf = (children: ReactNode): RenderedElement[] => {
  const head = elementsOf(children).find((child) => tagOf(child) === 'thead');
  const row = head ? taggedChildren(head.props.children, 'tr')[0] : undefined;
  return row ? taggedChildren(row.props.children, 'th') : [];
};

/** Every rendered body `tr`, in document order — the units a sort moves, whole and unopened. */
const bodyRowsOf = (children: ReactNode): RenderedElement[] => {
  const rows: RenderedElement[] = [];
  for (const section of elementsOf(children)) {
    const tag = tagOf(section);
    if (tag === 'thead') continue;
    if (tag === 'tr') rows.push(section);
    else rows.push(...taggedChildren(section.props.children, 'tr'));
  }
  return rows;
};

// What a reader can already click, focus or type into. A header cell holding any of these has a
// control of its own, and the sort must not swallow it. Read off the HAST node rather than the
// rendered tree, because that is the one form available before anything is drawn.
const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'label']);

const holdsInteractive = (node: HastNode | undefined): boolean => {
  if (!node) return false;
  for (const child of node.children ?? []) {
    if (child.type !== 'element') continue;
    if (INTERACTIVE_TAGS.has(child.tagName ?? '')) return true;
    if (holdsInteractive(child)) return true;
  }
  return false;
};

/**
 * The number a cell already shows, with a proportional bar under it.
 *
 * The author's rendered cell is KEPT and the bar is added beneath it, never swapped in: a shape may
 * never render less than the markdown it replaced, and a bolded figure is still the author's bold.
 * The shared `Meter` draws the bar — a hand-rolled div and a width would be a second spelling of
 * one this library already has — and it carries no label and no figure here on purpose, because the
 * row already names itself and the line above already is the number. `ariaLabel` is what is heard.
 */
function BarCell({ percent, ariaLabel, children }: { percent: number; ariaLabel: string; children: ReactNode }) {
  return (
    <div className="min-w-24">
      <div className="tabular-nums">{children}</div>
      {/* The bar is CAPPED. A last column on a wide screen is hundreds of pixels across, and a
          full-bleed bar there reads as a rule ruled under the number rather than as a measure of
          it — the comparison is in the ratio between the bars, which a shorter track keeps. */}
      <div className="mt-1.5 max-w-48">
        <Meter variant="inline" label="" value="" percent={percent} ariaLabel={ariaLabel} />
      </div>
    </div>
  );
}

/**
 * A markdown table that stays a table — sortable by any column, copyable as CSV, and with one
 * proportional bar column when exactly one column is numeric.
 *
 * Used by `elements/table.tsx`, which is its only consumer: it is the last rung of the `table`
 * precedence, so every table that is not a decision matrix or a before/after pair arrives here.
 *
 * **It sorts the parsed data and renders the rendered children.** The order comes from `data`,
 * whose cells are TEXT; the rows that move are `children`'s own `tr` elements, cloned whole and
 * keyed by their ORIGINAL index. So a cell keeps its `code`, its bold and its links through any
 * number of sorts, a row cannot come apart from itself, and a nested element's state survives
 * because React sees the same key arrive in a new place rather than a new row.
 */
export function DataTable({ data, barColumn, collapseKey, children }: DataTableProps) {
  const { t } = useTranslation('chat');
  // False inside a transcript export, where no handler can ever run. Every control below is drawn
  // only when this is true; the table itself, its rows and its bars are drawn either way.
  const interactive = useShapeInteractive();
  // Which column the reader sorted by, and which way. `null` is the third state — the author's own
  // order, which is meaningful often enough (a ranking, a chronology) that a click must be able to
  // reach it again rather than lose it for the life of the page.
  const [sort, setSort] = useState<SortState | null>(null);
  // Whether the last CSV copy landed, so the action can say so for a moment. The effect resets it.
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const headerCells = useMemo(() => headerCellsOf(children), [children]);
  const bodyRows = useMemo(() => bodyRowsOf(children), [children]);
  const order = useMemo(() => sortedOrder(data.rows, sort), [data, sort]);
  const percents = useMemo(
    () => (barColumn === null ? null : barPercents(data.rows, barColumn)),
    [barColumn, data]
  );
  const csv = useMemo(
    () => toCsv(data.headers, order.map((index) => data.rows[index] ?? [])),
    [data, order]
  );

  const directionOf = (column: number) => (sort?.column === column ? sort.direction : null);

  const cycleSort = (column: number) =>
    setSort((current) => {
      if (!current || current.column !== column) return { column, direction: 'asc' };
      return current.direction === 'asc' ? { column, direction: 'desc' } : null;
    });

  /** The bar goes INTO the numeric cell, so the column the author wrote is the column it appears in. */
  const rowWithBar = (row: RenderedElement, rowIndex: number): RenderedElement => {
    if (barColumn === null || !percents) return row;
    let column = -1;
    const cells = Children.map(row.props.children, (cell) => {
      if (!isValidElement(cell) || tagOf(cell) !== 'td') return cell;
      column += 1;
      if (column !== barColumn) return cell;
      const rendered = cell as RenderedElement;
      const heard = [data.rows[rowIndex]?.[0], data.headers[barColumn], data.rows[rowIndex]?.[barColumn]]
        .filter(Boolean)
        .join(' ');
      return cloneElement(rendered, {
        children: (
          <BarCell percent={percents[rowIndex] ?? 1} ariaLabel={heard}>
            {rendered.props.children}
          </BarCell>
        ),
      });
    });
    return cloneElement(row, { children: cells });
  };

  // Not drawn at all in an export, for the reason `ShapeFrame` does not draw its toggle there: the
  // saved document inlines the app's stylesheets, so a control left in it hovers and does nothing.
  const copyAction = interactive ? (
    <button
      type="button"
      data-copy-csv
      onClick={() => void copyTextToClipboard(csv).then((didCopy) => didCopy && setCopied(true))}
      title={t('shapes.copyCsv')}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-muted hover:text-foreground"
    >
      {copied ? (
        <CheckIcon aria-hidden="true" className="h-3.5 w-3.5 text-accent-ink" />
      ) : (
        <CopyIcon aria-hidden="true" className="h-3.5 w-3.5" />
      )}
      <span className="hidden sm:inline">{copied ? t('shapes.copied') : t('shapes.copyCsv')}</span>
    </button>
  ) : undefined;

  const sortGlyph = (direction: 'asc' | 'desc' | null) => {
    // Drawn on every column, faint until it is the sorted one: a control a reader has to hover to
    // discover is a control they never use.
    if (direction === null) return <ArrowUpDownIcon aria-hidden="true" className="h-3 w-3 flex-none opacity-40" />;
    if (direction === 'asc') return <ArrowUpIcon aria-hidden="true" className="h-3 w-3 flex-none text-accent-ink" />;
    return <ArrowDownIcon aria-hidden="true" className="h-3 w-3 flex-none text-accent-ink" />;
  };

  return (
    <ShapeFrame
      kind={dataTableKind(barColumn)}
      title={t('shapes.titles.table')}
      collapseKey={collapseKey}
      actions={copyAction}
    >
      {/* The frame's own inset is cancelled so the header band reaches the border, and the table
          scrolls sideways on a phone instead of squeezing every column down to nothing. */}
      <div className="-mx-3 -my-2 overflow-x-auto">
        <table className="my-0 min-w-full border-collapse text-sm">
          <thead className="bg-muted/60">
            {/* A header is a label and, when sortable, the sort button: an inline code path in it
                stays a code span rather than a chip, which would be a button inside that button. */}
            <ChipsSuppressedContext.Provider value={true}>
            <tr>
              {data.headers.map((header, column) => {
                const direction = directionOf(column);
                // The header's own rendered children, so a marked-up column title survives.
                const label = <span>{headerCells[column]?.props.children ?? header}</span>;
                // A header the author left blank has no children and no text, and `title` alone
                // would leave the button's whole accessible name as the dangling "Sort by ". A
                // blank leading header is ordinary model output, so it gets its column's POSITION
                // — through a key of its OWN, not by feeding the number to `sortBy`. "Sort by 1"
                // would read as sorting by the VALUE 1 on a feature built around numeric columns,
                // and against `|  | 1 | 2 |` it collides outright with the real header named `1`.
                const named = header.trim()
                  ? t('shapes.sortBy', { column: header.trim() })
                  : t('shapes.sortByColumnNumber', { number: column + 1 });
                // A header carrying a link already has a control in it. Nesting one button inside
                // another is invalid, gives keyboard users a tab stop inside a tab stop, and makes
                // one click fire BOTH the sort and the anchor — so the sort steps out beside it.
                const nested = holdsInteractive(headerCells[column]?.props.node);
                return (
                  <th
                    key={column}
                    scope="col"
                    aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}
                    className="border-b border-border px-3 py-2 text-left font-semibold text-foreground"
                  >
                    {!interactive ? (
                      label
                    ) : nested ? (
                      <span className="inline-flex items-center gap-1">
                        {label}
                        <button
                          type="button"
                          data-sort-column
                          onClick={() => cycleSort(column)}
                          aria-label={named}
                          title={named}
                          className="inline-flex items-center transition-colors hover:text-accent-ink"
                        >
                          {sortGlyph(direction)}
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        data-sort-column
                        onClick={() => cycleSort(column)}
                        aria-label={named}
                        title={named}
                        className="inline-flex items-center gap-1 text-left transition-colors hover:text-accent-ink"
                      >
                        {label}
                        {sortGlyph(direction)}
                      </button>
                    )}
                  </th>
                );
              })}
            </tr>
            </ChipsSuppressedContext.Provider>
          </thead>
          <tbody>
            {order.map((rowIndex) => {
              const row = bodyRows[rowIndex];
              if (!row) return null;
              // Keyed by the row's ORIGINAL index, never by its place in the sorted order: the key
              // is what tells React this is the same row in a new position rather than a new row.
              return cloneElement(rowWithBar(row, rowIndex), { key: `row-${rowIndex}` });
            })}
          </tbody>
        </table>
      </div>
    </ShapeFrame>
  );
}
