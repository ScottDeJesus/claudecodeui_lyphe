import type { ReactNode } from 'react';

import { classifyTable, soleNumericColumn } from '@/modules/chat/transcript/shapes/detect';
import type { HastNode } from '@/modules/chat/transcript/shapes/hast';
import { hasInlineFormatting, readTable } from '@/modules/chat/transcript/shapes/hast';
import { shapeKey } from '@/modules/chat/transcript/shapes/collapseState';
import { dataTableKind, tablePayload } from '@/modules/chat/transcript/shapes/tableData';
import { BeforeAfter } from '@/modules/chat/transcript/shapes/BeforeAfter';
import { DataTable } from '@/modules/chat/transcript/shapes/DataTable';
import { DecisionMatrix } from '@/modules/chat/transcript/shapes/DecisionMatrix';
import { renderInline } from '@/modules/chat/transcript/shapes/elements/inlineText';

/**
 * What react-markdown hands every component override: the ORIGINAL hast element beside the same
 * content already rendered with its inline marks intact. Decide from `node`, render from `children`.
 *
 * Declared per module rather than shared across `elements/`: the package is cut by OWNING PHASE, so
 * each module is editable by its phase alone, and a shared type would be a file five phases touch.
 */
type PlainElementProps = { node?: HastNode; children?: ReactNode };

/** The `table` override, moved out of `Markdown.tsx` unchanged. Used through `elements/index.ts`. */
export function PlainTable({ children }: PlainElementProps) {
  return (
    <div className="my-3 overflow-x-auto rounded-lg border border-border">
      {/* my-0 cancels Tailwind Typography's table margin, which would show as blank bands inside the border */}
      <table className="my-0 min-w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

/** The `thead` override, moved out of `Markdown.tsx` unchanged. Used through `elements/index.ts`. */
export function PlainTableHead({ children }: PlainElementProps) {
  return <thead className="bg-muted/60">{children}</thead>;
}

/** The `tr` override, moved out of `Markdown.tsx` unchanged. Used through `elements/index.ts`. */
export function PlainTableRow({ children }: PlainElementProps) {
  return <tr className="[&:last-child>td]:border-b-0">{children}</tr>;
}

/**
 * The `th` override, moved out of `Markdown.tsx` unchanged. Used through `elements/index.ts`.
 *
 * It does NOT call `renderInline`: a header is a label, never prose, and linkifying one would turn
 * a column named `src/foo.ts` into a chip nobody asked for.
 */
export function PlainTableHeaderCell({ children }: PlainElementProps) {
  return <th className="border-b border-border px-3 py-2 text-left font-semibold text-foreground">{children}</th>;
}

/** The `td` override, moved out of `Markdown.tsx` unchanged. Used through `elements/index.ts`. */
export function PlainTableCell({ children }: PlainElementProps) {
  return <td className="border-b border-border/60 px-3 py-2 align-top">{renderInline(children)}</td>;
}

/**
 * The `table` entry of `SHAPE_COMPONENTS`: the branch that picks a table's shape.
 *
 * Used through `elements/index.ts` by `Markdown.tsx`'s shape map, and reached only on a settled
 * body — the streaming half renders through `PLAIN_COMPONENTS`, decided once by the ternary in
 * `Markdown.tsx`, so nothing here reads the streaming context and a half-arrived table cannot
 * become a card or a bar.
 *
 * It returns PLAIN markup in two cases, both of them the plan's "when in doubt, return the
 * fallback": a table `readTable` cannot reason about (no header row, or ragged rows — where every
 * shape below would read a neighbouring column's value as its own), and a matrix or before/after
 * pair whose cells carry inline marks. The second is the decline `hasInlineFormatting` exists for:
 * those two shapes re-lay-out cells into cards and cannot carry rendered children across that move,
 * so a table of `code` spans stays a readable table rather than becoming a lossy card grid.
 */
export function ShapeTable({ node, children }: PlainElementProps) {
  const table = node ? readTable(node) : null;
  if (!table) return <PlainTable>{children}</PlainTable>;

  const classification = classifyTable(table);
  const payload = tablePayload(table);

  if (classification === 'decision-matrix' || classification === 'before-after') {
    if (hasInlineFormatting(node)) return <PlainTable>{children}</PlainTable>;
    return classification === 'decision-matrix' ? (
      <DecisionMatrix data={table} collapseKey={shapeKey('decision-matrix', payload)} />
    ) : (
      <BeforeAfter data={table} collapseKey={shapeKey('before-after', payload)} />
    );
  }

  // Every other table — `data-bars` and `plain` alike — is the same sortable, copyable table; the
  // only difference is whether one column earned a bar. `DataTable` renders `children`'s own rows,
  // so this arm needs no formatting decline: nothing is re-laid-out and nothing can be flattened.
  const barColumn = classification === 'data-bars' ? soleNumericColumn(table) : null;
  return (
    <DataTable data={table} barColumn={barColumn} collapseKey={shapeKey(dataTableKind(barColumn), payload)}>
      {children}
    </DataTable>
  );
}

/**
 * The `td` entry of `SHAPE_COMPONENTS`. PHASE 9 replaces this with the cell that linkifies file
 * references — and it will do so by turning on the `renderInline` seam, not by editing here.
 */
export const ShapeTableCell = PlainTableCell;
