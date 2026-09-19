import { Annotation, StateEffect, StateField, Transaction } from '@codemirror/state';
import type { EditorState, Extension } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';

import type { EditWindowMeta, FileEditWindow, FileLinePatch } from '@/shared/types';

/**
 * The document↔file rules: what a window of a file means as a CodeMirror document, and what each
 * kind of window answer becomes as a transaction.
 *
 * `windowMetaField` holds where the document is (the original line number of its first line, how
 * many original lines it represents, the revision they were read from), `touchedSpanField` holds
 * the one span the user edited, and the functions below turn a read answer into a load, a
 * prepend, an append or an eviction. Everything the editor knows about the file comes from here.
 */

/**
 * Marks a transaction as a window load rather than a person's edit.
 *
 * Without it a transaction that changes the document is read as an edit and widens the touched
 * span; a prepend, an append and an eviction all move lines in bulk and must leave the span
 * where it was, mapped.
 */
export const windowLoad = Annotation.define<true>();

/** Every bulk move shares this shape: a load, and out of the undo history because nobody typed it. */
const loadAnnotations = [windowLoad.of(true), Transaction.addToHistory.of(false)];

/**
 * Which edge of the document a bulk move came from, declared by the transaction that makes it.
 *
 * It decides the association the touched span maps with, and it is declared rather than guessed
 * from the change ranges because the two are not distinguishable by range: an append into a
 * document the user has emptied inserts at position 0, exactly like a prepend. Reading that as a
 * prepend would drag the span down into the freshly appended lines and the next save would write
 * them over the file's own lines.
 */
const windowMove = Annotation.define<'prepend' | 'append'>();

/** Replaces the window metadata; carried by the same transaction that loads or moves lines. */
export const setWindowMeta = StateEffect.define<EditWindowMeta>();

/** Clears the touched span after a save, a discard or a reload. */
export const clearTouchedSpan = StateEffect.define<null>();

/**
 * Where the document sits in the file.
 *
 * Its `create` value describes the state at the moment before a window has been loaded — a
 * document that is the whole file at revision "". The hook folds the real metadata in with
 * `setWindowMeta` in the same transaction that builds or rebuilds the state, so nothing ever
 * reads this default: it exists because a StateField must answer for every state.
 */
export const windowMetaField = StateField.define<EditWindowMeta>({
  create: (state) => ({
    lo: 1,
    origCount: state.doc.lines,
    eof: true,
    rev: '',
    eol: '\n',
    totalLines: state.doc.lines,
  }),
  update: (meta, tr) => {
    for (const effect of tr.effects) {
      if (effect.is(setWindowMeta)) return effect.value;
    }
    return meta;
  },
});

/**
 * The single contiguous span of the document the user has edited, in document positions, or null
 * while the document is clean.
 *
 * A transaction that changes the document WITHOUT `windowLoad` is a person's edit: the old span
 * is mapped forward and then widened to cover every changed range of the new document, so the
 * span always covers the edit and never a line the edit did not touch. A `windowLoad` transaction
 * only maps it — a prepend and an append move the whole document, and mapping both ends with the
 * association that keeps them with their own text is what stops a bulk load from being mistaken
 * for an edit. That association comes from the transaction's own `windowMove` annotation, because
 * the change ranges of the two moves are identical when an append lands in an emptied document.
 * An eviction only ever deletes outside the span, so it needs no special case.
 */
export const touchedSpanField = StateField.define<{ from: number; to: number } | null>({
  create: () => null,
  update: (span, tr) => {
    for (const effect of tr.effects) {
      if (effect.is(clearTouchedSpan)) return null;
    }
    if (!tr.docChanged) return span;

    // A prepend inserts at position 0 and an append at the old document's end. Both are bulk
    // moves of text the user did not type, so the association below keeps the span with the
    // lines it already covered instead of swallowing the loaded text: a prepend pushes the span
    // down with the text it describes (assoc 1), and an append — and every edit a person makes,
    // which is widened below anyway — leaves it where it is (assoc -1). Which one this is comes
    // from the transaction's own annotation, never from where the inserted text landed.
    const assoc = tr.annotation(windowMove) === 'prepend' ? 1 : -1;
    const mappedFrom = span === null ? null : tr.changes.mapPos(span.from, assoc);
    const mappedTo = span === null ? null : tr.changes.mapPos(span.to, assoc);
    if (tr.annotation(windowLoad) === true) {
      return mappedFrom === null || mappedTo === null ? null : { from: mappedFrom, to: mappedTo };
    }

    let from = mappedFrom;
    let to = mappedTo;
    tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
      from = from === null ? fromB : Math.min(from, fromB);
      to = to === null ? toB : Math.max(to, toB);
    });
    return from === null || to === null ? null : { from, to };
  },
});

/** The touched span as document line numbers, or null when the document is clean. */
export function touchedLines(state: EditorState): { first: number; last: number } | null {
  const span = state.field(touchedSpanField);
  if (span === null) return null;
  return { first: state.doc.lineAt(span.from).number, last: state.doc.lineAt(span.to).number };
}

/**
 * The edit a save would write, or null when there is nothing to write.
 *
 * The patch replaces the ORIGINAL lines `first … origCount - (docLines - last)` with the
 * document's current lines `first … last`: the touched line is the only one that can have
 * changed, and the lines the document still holds below it map back to the originals they came
 * from. The one exception is a window at line 1 that reached EOF and was emptied — no line
 * survives to point at, and the file must simply become empty.
 */
export function computeLinePatch(state: EditorState, path: string): FileLinePatch | null {
  const meta = state.field(windowMetaField);
  const touched = touchedLines(state);
  if (touched === null) return null;
  const doc = state.doc;
  if (meta.lo === 1 && meta.eof && doc.length === 0) {
    return { path, baseRev: meta.rev, startLine: 1, deleteCount: meta.origCount, lines: [] };
  }
  const { first, last } = touched;
  const lines: string[] = [];
  for (let line = first; line <= last; line += 1) lines.push(doc.line(line).text);
  return {
    path,
    baseRev: meta.rev,
    startLine: meta.lo + first - 1,
    deleteCount: meta.origCount - (first - 1) - (doc.lines - last),
    lines,
  };
}

/**
 * The extensions every windowed document carries: the two fields above and a gutter numbered in
 * FILE lines, shifted by the window's offset so line 48,210 reads as 48,210 and not as 1.
 */
export function windowedDocumentExtensions(): Extension[] {
  return [
    windowMetaField,
    touchedSpanField,
    lineNumbers({
      formatNumber: (lineNo: number, state: EditorState) =>
        String(lineNo + state.field(windowMetaField).lo - 1),
    }),
  ];
}

// ─── What each window answer becomes ────────────────────────────────────────

/**
 * Inserts the lines read from above the document, keeping the line that was at the viewport top
 * at its pixel offset. False when the answer stopped short of the document — splicing what came
 * back would leave a hole where the lines between it and the document's first line belong.
 */
export function applyWindowPrepend(view: EditorView, win: FileEditWindow): boolean {
  const meta = view.state.field(windowMetaField);
  const wanted = meta.lo - win.startLine;
  if (wanted <= 0) return true;
  if (win.lines.length < wanted) return false;
  const inserted = win.lines.slice(win.lines.length - wanted);
  const text = `${inserted.join('\n')}\n`;
  const block = view.lineBlockAt(view.viewport.from);
  // The anchor line's distance above the visible top, which is negative: it sits in the
  // viewport's leading margin. `scrollIntoView({ y: 'start', yMargin })` puts a line's top back
  // at that offset below the visible top, so passing the offset it already had leaves it exactly
  // where it was while the text above it is inserted (CodeMirror's own `scrollSnapshot` idiom).
  const yMargin = block.top - view.scrollDOM.scrollTop;
  view.dispatch({
    changes: { from: 0, insert: text },
    effects: [
      setWindowMeta.of({
        ...meta,
        lo: meta.lo - wanted,
        origCount: meta.origCount + inserted.length,
      }),
      EditorView.scrollIntoView(block.from + text.length, { y: 'start', yMargin }),
    ],
    annotations: [...loadAnnotations, windowMove.of('prepend')],
    scrollIntoView: false,
  });
  return true;
}

/** Appends the lines read from below the document. False when the answer held no lines at all. */
export function applyWindowAppend(view: EditorView, win: FileEditWindow): boolean {
  if (win.lines.length === 0) return false;
  const meta = view.state.field(windowMetaField);
  const doc = view.state.doc;
  const text = win.lines.join('\n');
  // Only a window with no original lines at all — an empty file, or a window past the last line
  // — takes the appended text as its first line. A document the user has emptied still holds the
  // single empty line their deletion left behind, and the appended originals belong BELOW it:
  // joining them onto it would merge the user's deletion into the first appended line.
  const windowHasNoOriginalLines = doc.length === 0 && meta.origCount === 0;
  view.dispatch({
    changes: { from: doc.length, insert: windowHasNoOriginalLines ? text : `\n${text}` },
    effects: setWindowMeta.of({
      ...meta,
      origCount: meta.origCount + win.lines.length,
      eof: win.eof,
      totalLines: win.eof ? win.totalLines : meta.totalLines,
    }),
    annotations: [...loadAnnotations, windowMove.of('append')],
    scrollIntoView: false,
  });
  return true;
}

/**
 * Drops the lines above the viewport's buffer; the policy only asks for lines outside the span.
 *
 * The scroll goes with them, and that is the whole of this function's care. Deleting `count` lines
 * ABOVE the reader takes that much height out of the scroller, while the scroll offset — a number —
 * stays where it was; the text under the reader would then drop by those lines, and the browser
 * clamps the offset at the shorter document's end, landing the reader inside the lines this window
 * just fetched. A plan reading that viewport evicts what they are looking at, and the editor
 * visibly jumps every time it fetches. So the line at the viewport's top is kept at the pixel
 * offset it already had, by the same CodeMirror idiom the prepend uses (its `scrollSnapshot`
 * shape: `y: 'start'` with the block's own distance below the visible top as the margin).
 */
export function applyEvictTop(view: EditorView, count: number): void {
  const doc = view.state.doc;
  if (count <= 0 || count >= doc.lines) return;
  const meta = view.state.field(windowMetaField);
  const removed = doc.line(count + 1).from;
  // The anchor has to be a position that SURVIVES the deletion: a viewport whose top sits inside
  // the evicted lines leaves the document's first surviving line as the anchor.
  const anchor = Math.max(view.viewport.from, removed);
  const block = view.lineBlockAt(anchor);
  const yMargin = block.top - view.scrollDOM.scrollTop;
  view.dispatch({
    changes: { from: 0, to: removed },
    effects: [
      setWindowMeta.of({ ...meta, lo: meta.lo + count, origCount: meta.origCount - count }),
      // Effects are not mapped through their own transaction's changes, so this names the
      // position the anchor occupies once the lines above it are gone.
      EditorView.scrollIntoView(anchor - removed, { y: 'start', yMargin }),
    ],
    annotations: loadAnnotations,
    scrollIntoView: false,
  });
}

/** Drops the lines below the viewport's buffer. `eof` goes with them: the window no longer ends
 * at the file's last line, and the next append decides that again from what it reads. */
export function applyEvictBottom(view: EditorView, count: number): void {
  const doc = view.state.doc;
  if (count <= 0 || count >= doc.lines) return;
  const meta = view.state.field(windowMetaField);
  view.dispatch({
    changes: { from: doc.line(doc.lines - count).to, to: doc.length },
    effects: setWindowMeta.of({ ...meta, origCount: meta.origCount - count, eof: false }),
    annotations: loadAnnotations,
    scrollIntoView: false,
  });
}
