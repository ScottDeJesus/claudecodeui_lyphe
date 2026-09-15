/**
 * Every trigger the markdown shapes fire on, behind one import path.
 *
 * This file holds no logic. The grammars live in `shapes/detect/`, one pure module per family —
 * `tables` (the number grammar and the table classes), `fences` (stat tiles, delta tone, diff
 * lines, the long-output fold), `prose` (alert kind, verdict, lead-in line), `listMarks` (time
 * tokens, check glyphs), `fileRefs` (the one file-reference grammar and its prose scanner) and
 * `inlineMarks` (hex colour, key combo). Every consumer imports THIS path, so splitting the
 * families moved no call site; a new trigger goes in its family's module and gets its name added
 * here.
 *
 * No family module imports anything — not React, not the DOM, not a package, not a sibling — which
 * is what lets `.verify/probe-shapes-detect.mjs` load this barrel straight through `npx tsx
 * --tsconfig tsconfig.json` with no browser and no React; a parser that cannot reach the tree also
 * cannot be tempted to read it. The flag names the repo tsconfig outright, so the `@/` paths below
 * resolve to `src/` whatever `TSX_TSCONFIG_PATH` the launching environment carries — one pointing
 * at `server/tsconfig.json` would resolve them to server code.
 *
 * Used by the components and readers under `shapes/` that decide a trigger — `remarkShapeGroups`'s
 * lead-in pass among them, because a paragraph only becomes a title when the block BENEATH it is a
 * list or a table, and the plugin is the one place with siblings to read. Each function is a pure
 * string -> verdict, and each one is written to REJECT: a shape that fires on prose is worse than
 * a shape that never fires, because the reader loses words they wrote.
 */

export type { Cell, Row, TableClass, TableData } from '@/modules/chat/transcript/shapes/detect/tables';
export { classifyTable, parseNumber, soleNumericColumn } from '@/modules/chat/transcript/shapes/detect/tables';

export type { DeltaTone, StatTile } from '@/modules/chat/transcript/shapes/detect/fences';
export {
  deltaTone,
  LONG_OUTPUT_LINES,
  LONG_OUTPUT_PREVIEW_LINES,
  parseStatsFence,
  splitDiffLine,
} from '@/modules/chat/transcript/shapes/detect/fences';

export type { AlertKind } from '@/modules/chat/transcript/shapes/detect/prose';
export {
  isLeadInText,
  LEAD_IN_MAX_CHARS,
  parseAlertKind,
  parseVerdict,
} from '@/modules/chat/transcript/shapes/detect/prose';

export {
  checkGlyph,
  checkGlyphLength,
  isTimeToken,
  timeTokenLength,
} from '@/modules/chat/transcript/shapes/detect/listMarks';

export type { FileRef, PreviewKind } from '@/modules/chat/transcript/shapes/detect/fileRefs';
export { FILE_REF_SCAN, IMAGE_EXTENSIONS, KNOWN_DOTFILES, KNOWN_EXTENSIONS, parseFileRef, previewKindOf } from '@/modules/chat/transcript/shapes/detect/fileRefs';

export { parseHexColor, parseKeyCombo } from '@/modules/chat/transcript/shapes/detect/inlineMarks';
