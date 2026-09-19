import { useContext, useEffect, useState } from 'react';
import type { WorkSheet } from 'xlsx';

import { EmptyState, Tabs } from '@/shared/ui';
import { Spinner } from '@/shared/ui/Spinner';
import type { DocumentViewProps } from '@/shared/types';
import { DocumentFrameContext } from '@/modules/document-preview/DocumentPreview';

/** The most rows the grid draws. The read asks for one more, which is how a cut is told from an end. */
const MAX_ROWS = 1000;
/** The most columns the grid draws, however wide the sheet is. */
const MAX_COLUMNS = 100;

/** What the grid holds against what the sheet has; the footer says the difference in words. */
type SheetExtent = {
  /** Rows drawn in the grid — at most 1,000. */
  shownRows: number;
  /** Every row the sheet has, when its range says so; null when the file does not record one. */
  totalRows: number | null;
  /** True when the sheet has more rows than the grid draws. */
  rowsCut: boolean;
  /** True when the sheet has more than the 100 columns the grid draws. */
  columnsCut: boolean;
};

/** One workbook as the grid reads it: every sheet's name, its window of cells, and its extent. */
type SheetBook = {
  names: string[];
  rows: Map<string, string[][]>;
  extents: Map<string, SheetExtent>;
};

/** What a sheet is before its cells are read, and what a genuinely empty sheet keeps. */
const EMPTY_EXTENT: SheetExtent = { shownRows: 0, totalRows: null, rowsCut: false, columnsCut: false };

/** A cell as the grid draws it: text. A date keeps its day, because that is what the sheet meant. */
function cellText(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell);
}

/** `0` → `A`, `25` → `Z`, `26` → `AA`: the letters a spreadsheet reader navigates by. */
function columnLetter(index: number): string {
  let letters = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}

/** A count in the reader's grouping, with its noun made singular for one. */
const countOf = (value: number, noun: string) => `${value.toLocaleString('en-US')} ${noun}${value === 1 ? '' : 's'}`;

/** The footer's sentence: how much of the sheet is on screen, and when the grid stopped short. */
function extentText(extent: SheetExtent): string {
  const rows = !extent.rowsCut
    ? countOf(extent.totalRows ?? extent.shownRows, 'row')
    : extent.totalRows === null
      ? `Showing the first ${countOf(extent.shownRows, 'row')}`
      : `Showing the first ${extent.shownRows.toLocaleString('en-US')} of ${countOf(extent.totalRows, 'row')}`;
  return extent.columnsCut ? `${rows} and the first 100 columns` : rows;
}

/**
 * A spreadsheet or a CSV/TSV file, drawn as a grid a reader can scan.
 *
 * Used by this module's DocumentPreview (through the registry) for a workbook (`sheet`) and for
 * the Table view of a `.csv`/`.tsv` file (`delimited`).
 *
 * The grid is its own scroll container on both axes, so the column letters stay pinned to its top
 * and the row numbers to its left however far the reader goes. It draws the first 1,000 rows and
 * 100 columns and the footer says so in words, because a grid that silently stops looks like a
 * sheet that ends. A workbook shows its sheet names as tabs; a CSV has one sheet and shows none.
 */
export function SheetPreview({ kind, name, blob }: DocumentViewProps) {
  // The workbook as read once per blob. Null until the read settles, which is a state the pane says
  // out loud — see the reading notice below — rather than drawing a grid of nothing.
  const [book, setBook] = useState<SheetBook | null>(null);
  // Which sheet of the workbook the grid is drawing. The file holds several and the reader picks
  // one; the grid, the footer and the tabs all read this one choice.
  const [activeSheet, setActiveSheet] = useState('');
  const frame = useContext(DocumentFrameContext);
  const sheets = book?.names ?? [];
  const rows = book?.rows.get(activeSheet) ?? [];
  const extent = book?.extents.get(activeSheet) ?? EMPTY_EXTENT;

  const columnCount = rows.reduce((widest, row) => Math.max(widest, row.length), 0);
  const columns = Array.from({ length: columnCount }, (_, index) => columnLetter(index));

  // One read per blob, with SheetJS imported here: the library is fetched when a sheet or a CSV is
  // opened and never with the Files tab. `sheetRows` asks for one row past the window, which is what
  // lets a workbook that runs on past 1,000 rows say so instead of stopping at the grid's edge.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const XLSX = await import('xlsx');
        const workbook =
          kind === 'delimited'
            ? XLSX.read(await blob.text(), { type: 'string', sheetRows: MAX_ROWS + 1 })
            : XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array', sheetRows: MAX_ROWS + 1 });
        if (cancelled) {
          return;
        }

        const rowsBySheet = new Map<string, string[][]>();
        const extentsBySheet = new Map<string, SheetExtent>();
        for (const sheetName of workbook.SheetNames) {
          const sheet: WorkSheet | undefined = workbook.Sheets[sheetName];
          if (!sheet) continue;
          const cells = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
          const window = cells
            .slice(0, MAX_ROWS)
            .map((row) => row.slice(0, MAX_COLUMNS).map(cellText));
          // `!fullref` is the range the FILE holds, and SheetJS writes it only where the read stopped
          // early. It is therefore the one place a total may be taken from: `!ref` ends at the window's
          // own edge instead — `A1:B1001` for a 1,501-row CSV read with `sheetRows: 1001` — and printing
          // that as the total would say "of 1,001 rows" about a file that has 1,501. A CSV carries no
          // `!fullref` at all, so its total is simply not on the page, and the footer says only how many
          // rows it is showing (I8).
          const fullReference = sheet['!fullref'] as string | undefined;
          const ownReference = sheet['!ref'] as string | undefined;
          const fullRange = fullReference ? XLSX.utils.decode_range(fullReference) : null;
          const columnRange = fullRange ?? (ownReference ? XLSX.utils.decode_range(ownReference) : null);
          const totalRows = fullRange ? fullRange.e.r - fullRange.s.r + 1 : null;
          // The read asks for one row PAST the window, so a window that came back full is itself proof
          // that rows were left off, whatever the file records — which is how a 1,501-row CSV still
          // says it stopped short. Exactly a window of rows is not cut, and says its own total.
          const rowsCut = totalRows !== null ? totalRows > window.length : cells.length > MAX_ROWS;
          const totalColumns = columnRange ? columnRange.e.c - columnRange.s.c + 1 : null;
          rowsBySheet.set(sheetName, window);
          extentsBySheet.set(sheetName, {
            shownRows: window.length,
            totalRows,
            rowsCut,
            columnsCut: totalColumns !== null && totalColumns > MAX_COLUMNS,
          });
        }
        if (cancelled) {
          return;
        }
        setBook({ names: [...workbook.SheetNames], rows: rowsBySheet, extents: extentsBySheet });
        setActiveSheet(workbook.SheetNames[0] ?? '');
      } catch (cause) {
        // Reported, not thrown: a file SheetJS cannot read is an answer the frame draws, and a
        // throw from here would reach the browser's own error channel before it reached the boundary.
        if (!cancelled) {
          frame.reportFailure?.(cause);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [blob, frame, kind]);

  // The read is still running. Said off `book` rather than off a second
  // piece of state, because `book` is null for exactly as long as the read is. Without this the pane
  // would say "This sheet is empty" about a file whose cells are still being parsed — and the frame
  // is `ready` throughout, since the bytes it fetched are in hand.
  if (book === null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-6">
        <Spinner label={`Reading ${name}…`} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {kind === 'sheet' && (
        <div className="flex-none overflow-x-auto border-b border-border px-3.5">
          <Tabs
            variant="underline"
            ariaLabel="Sheets"
            tabs={sheets.map((sheet) => ({ id: sheet, label: sheet }))}
            active={activeSheet}
            onChange={setActiveSheet}
          />
        </div>
      )}

      {rows.length === 0 ? (
        <div className="p-5">
          <EmptyState title="This sheet is empty" message="It has no cells with anything in them." />
        </div>
      ) : (
        <div role="region" aria-label={name} tabIndex={0} className="min-h-0 flex-1 overflow-auto">
          <table className="border-separate border-spacing-0 text-[12.5px] tabular-nums">
            <thead>
              <tr>
                <th aria-label="Row" className="sticky left-0 top-0 z-20 min-w-11 border-b border-r border-border bg-muted" />
                {columns.map((letter) => (
                  <th key={letter} scope="col" className="sticky top-0 z-10 border-b border-r border-border bg-muted px-2.5 py-1.5 text-center text-xs font-medium text-ink-faint">
                    {letter}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                // The sheet's own row number is the row's identity: rows are drawn from the top
                // and never reordered, and two rows may hold the same cells.
                <tr key={rowIndex}>
                  <th scope="row" className="sticky left-0 z-10 border-b border-r border-border bg-muted px-2.5 py-1.5 text-right text-xs font-medium text-ink-faint">
                    {(rowIndex + 1).toLocaleString('en-US')}
                  </th>
                  {columns.map((letter, columnIndex) => (
                    <td key={letter} className="border-b border-r border-border bg-card px-2.5 py-1.5">
                      <span className="block max-w-[320px] truncate">{String(row[columnIndex] ?? '')}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex-none border-t border-border px-3.5 py-2 text-[12.5px] text-muted-foreground">
        {extentText(extent)}
      </div>
    </div>
  );
}
