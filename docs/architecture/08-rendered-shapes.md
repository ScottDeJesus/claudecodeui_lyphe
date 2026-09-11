# Rendered shapes

## In one paragraph

A settled assistant reply's ordinary markdown renders as a component instead of as plain markup
whenever it matches a shape exactly: a GFM (GitHub Flavored Markdown) table becomes a sortable table
with a copy-as-CSV action, a task list gains a progress bar, a `> [!NOTE]` alert becomes a toned
callout, a `VERDICT: FAIL — B:1 H:0 M:2 L:0` line becomes a verdict banner, a `stats` fence becomes
stat tiles, a `diff` fence is coloured by line, a run of fences in different languages becomes one
tab strip, a heading folds its section, and `src/parser.ts:42` in a sentence becomes a chip that opens
the Files tab at line 42. Nothing is inferred and no model is consulted: every trigger is a pure,
whole-text grammar behind one import path, `shapes/detect.ts`, and a block that misses its trigger by one
character renders byte for byte as it did before this feature existed. The shapes are the element
overrides react-markdown already calls, so there is no second parser, no raw HTML and no new
dependency. Two rules carry the design — **decide from `node`, render from `children`**, and **a shape
may never render less than the markdown it replaced** — and the rest of this document is their
consequences.

Every path below is under `src/modules/chat/transcript/` unless it says otherwise. Read
[the realtime stream](./02-realtime-stream.md) §"Incremental markdown rendering" for the settled and
pending halves every streaming rule here leans on, and [live widgets](./07-live-widgets.md) for the
one fence this feature routes around.

## Mental model

1. **The trigger is the author's markdown, exactly, and it is written to REJECT.** Headers must be
   exactly `Option | Pros | Cons`; an alert marker must be alone on its line; a verdict must be the
   whole paragraph; a time must open every item of a timeline. A shape that misses costs the reader
   nothing. A shape that fires on prose takes the words the author wrote and lays them out as
   something they never wrote.
2. **A miss is today's markup.** Every element has a `Plain*` component — the pre-feature markup,
   moved out of `Markdown.tsx` class for class — and an element that has a shape has a `Shape*`
   twin whose every declining branch returns that `Plain*`. `.verify/probe-shapes-baseline.mjs`
   holds a document made entirely of near misses to a DOM captured from the pre-move renderer.
3. **Two component maps and one ternary.** `PLAIN_COMPONENTS` in `Markdown.tsx` is today's DOM,
   apart from the three inline marks — file chips, colour swatches and keycaps — which it draws too
   (see **Streaming**).
   `SHAPE_COMPONENTS` spreads it and replaces exactly eight entries — `table td ul ol li blockquote p
   div` — with their `Shape*` twins. `MarkdownBodyRenderer` hands a streaming body the plain map and
   a settled body the shape map, and the same flag keeps `remarkShapeGroups` out of the plugins.
   That ternary is the streaming rule's only enforcement site. No shape reads a streaming flag.
4. **Decide from `node`, render from `children`.** Every override receives both: `node`, the
   original hast (HTML abstract syntax tree) element with its whole subtree, and `children`, the
   same content already rendered with every `**bold**`, `` `code` `` and link intact. The readers in
   `shapes/hast.ts` return TEXT, and text decides which shape and drives the sort key, the CSV and
   the counts. What the reader sees comes from `children`: `DataTable` permutes the rendered rows,
   `TaskProgress` and `Callout` draw the rendered body, and `CheckResults`, `Timeline` and the alert
   branch lift one leading token off the first text node and render everything after it.
5. **A shape that must redraw from text declines when there is markup to lose.** `DecisionMatrix`,
   `BeforeAfter`, `FactCard` and `VerdictBanner` draw from parsed text, so each is reached only when
   `hasInlineFormatting` (and, for facts, `readFactPairs`) finds no mark the redraw would drop — the
   `**Label:**` bold that defines a fact pair and the bold a model wraps a verdict in are redrawn,
   so they do not count. A decision matrix with a `code` span in a cell stays a readable table
   instead of becoming lossy cards.
6. **Every block shape wears one frame.** (The inline marks — chip, swatch, keycaps — carry
   `data-shape` and no frame.) `ShapeFrame` is the shared `Collapsible` plus exactly three
   things: the `data-shape` / `data-collapsed` / `data-shape-toggle` markers the probes measure, the
   content-addressed fold memory, and an actions slot. Two collapsibles do not wear it: a heading
   section, whose heading is its own toggle, and long output, whose control sits under the block.
7. **A fold is remembered by content, not by message id.** A module-level map keyed on
   `shapeKey(kind, payload)` survives the row unmounting as it scrolls away. Absent means expanded,
   always — nothing ever opens folded on its own.
8. **An export is whole.** Inside `renderToStaticMarkup` no effect runs and nothing can be clicked,
   so every shape draws its full content on the first synchronous render and draws no control. One
   module under `shapes/` reads the export context: `useShapeCollapse.ts`.
9. **The shapes compose the shared library; they never re-spell it.** `Banner`, `Chip`, `Badge`,
   `Meter`, `Card`, `Tabs` and `Collapsible` from `@/shared/ui`; colour only from Verve tokens or the
   `data-tone` vocabulary (`neutral info positive warn danger`). The timeline and the stat tile are
   the two drawings the shared library does not have. They stay in `shapes/`, painted from tokens,
   because only the chat module uses them — the day a second module wants one, it moves to
   `src/shared/ui/`.

## The pieces

| File | Role |
| --- | --- |
| `Markdown.tsx` | `PLAIN_COMPONENTS`, `SHAPE_COMPONENTS`, and `MarkdownBodyRenderer` — the ternary between them, `remarkShapeGroups` added only when not streaming, and the `MarkdownStreamingContext` provider. `MarkdownBody`, `Markdown` and `TRANSCRIPT_PROSE` are its exports |
| `StreamingMarkdown.tsx` | Renders a reply as a settled `<MarkdownBody>` and a pending `<MarkdownBody streaming>` |
| `shapes/detect.ts` | Every trigger, behind the one import path every consumer uses: `classifyTable`, `soleNumericColumn`, `parseNumber`, `parseStatsFence`, `deltaTone`, `parseAlertKind`, `parseVerdict`, `isTimeToken`/`timeTokenLength`, `checkGlyph`/`checkGlyphLength`, `parseFileRef`, `FILE_REF_SCAN`, `KNOWN_EXTENSIONS`, `parseHexColor`, `parseKeyCombo`, `splitDiffLine`, `LONG_OUTPUT_LINES`, `LONG_OUTPUT_PREVIEW_LINES`. A barrel with no logic of its own — a new trigger goes in its family's module and gets its name added here |
| `shapes/detect/` | The grammars, one pure module per family: `tables`, `fences`, `prose`, `listMarks`, `fileRefs`, `inlineMarks` (which name lives where is the barrel's header). None imports anything, a sibling included, so `tsx` loads the barrel with no browser |
| `shapes/hast.ts` | `HastNode` and the text readers: `textOf`, `readTable`, `readListItems`, `readFactPairs`, `readCodeChildren`, `hasInlineFormatting` |
| `shapes/tableData.ts` | What happens after a table trigger fires: `tablePayload`, `dataTableKind`, `compareCells`, `sortedOrder`, `toCsv`, `barPercents` |
| `shapes/listItems.ts` | `renderedListItems` and `liftLeadingToken` — pairs rendered `li`s with parsed items, and lifts a glyph, a time or an alert marker out of the first text node |
| `shapes/listNesting.ts` | `InsideListContext` — a list inside a list is always plain |
| `shapes/chipContext.ts` | `ChipsSuppressedContext` — true inside a link, a section heading and a sortable header, where a chip would be a button inside a control |
| `shapes/collapseState.ts` | `shapeKey` (djb2, forced unsigned), `isCollapsed`, `setCollapsed`, `clearCollapsed` — the page-lifetime fold map |
| `shapes/useShapeCollapse.ts` | `useShapeCollapse` (fold state, key migration, export override) and `useShapeInteractive` (may a control be drawn at all) |
| `shapes/markdownStreaming.ts` | `MarkdownStreamingContext`, in its own module to avoid an import cycle. Its one consumer is `CodeBlock` |
| `shapes/remarkShapeGroups.ts` | The one remark plugin: groups root-level fence runs into `tabbed-code` and headings into `section` wrappers |
| `shapes/ShapeFrame.tsx` | `ShapeFrame` — the header bar, fold and markers every framed shape wears |
| `shapes/elements/index.ts` | The barrel `Markdown.tsx` imports every element override through |
| `shapes/elements/table.tsx` | `PlainTable`, `PlainTableHead`, `PlainTableRow`, `PlainTableHeaderCell`, `PlainTableCell`, and `ShapeTable` — the table branch. `ShapeTableCell` is an alias of `PlainTableCell` |
| `shapes/elements/list.tsx` | `PlainList`, `PlainListItem`, and `ShapeList` — the list ladder. `ShapeListItem` is an alias of `PlainListItem` |
| `shapes/elements/blockquote.tsx` | `PlainBlockquote` and `ShapeBlockquote` — the alert branch |
| `shapes/elements/paragraph.tsx` | `PlainParagraph` and `ShapeParagraph` — the verdict and fact ladder |
| `shapes/elements/plain.tsx` | `PlainRule`, `PlainHeading` (forwards hast properties, so GFM's `sr-only` footnote label stays hidden), `PlainDiv`, and `ShapeDiv`, which routes the two plugin wrappers |
| `shapes/elements/inlineText.tsx` | `renderInline` — the one seam where a block's rendered inline content gets file chips |
| `shapes/code/index.tsx` | `CodeBlock` (the `code` override's dispatcher: inline or block, then the widget branch) and `CodePre` |
| `shapes/code/CodeFence.tsx` | The fence precedence, and `FenceBlock`, today's highlighted block. Injects the `cc-syntax-theme` style at module scope |
| `shapes/code/InlineCode.tsx` | Today's inline code span, or a colour swatch, keycaps or a file chip |
| `shapes/MarkdownLink.tsx` | The `a` override. Asks `parseFileRef` under its loose link policy and forwards the `:line` |
| `shapes/InlineMarks.tsx` | `FileChip`, `ColorSwatch`, `KeyCaps`, and `linkifyChildren`, the prose scan |
| `shapes/DataTable.tsx` | Every table that is not a matrix or a before/after pair: three-state sort, CSV copy, and a `Meter` bar down the one numeric column |
| `shapes/DecisionMatrix.tsx` | `Option \| Pros \| Cons [\| Verdict]` as one `Card` per option, verdict as a `Badge` toned by its glyph |
| `shapes/BeforeAfter.tsx` | `Before \| After` (optionally after a label column) as a pair of `Card`s per row |
| `shapes/Callout.tsx` | An alert as a `Banner`, toned from its kind, titled with the kind's translated word |
| `shapes/TaskProgress.tsx` | A `Meter` over the task list, which is drawn unchanged beneath it |
| `shapes/CheckResults.tsx` | Pass and fail counts as toned `Chip`s, each row toned by the glyph its author wrote |
| `shapes/Timeline.tsx` | A rail with one dot per entry, the author's time lifted out verbatim as the entry's label |
| `shapes/FactCard.tsx` | `**Label:** value` pairs as a `<dl>` grid |
| `shapes/VerdictBanner.tsx` | A `Banner` carrying the verdict word, and four `Chip`s for the counts |
| `shapes/StatTiles.tsx` | One `Card` tile per `stats` line, the delta toned by its sign |
| `shapes/DiffBlock.tsx` | A `diff` fence line by line, each line's `data-tone` from `splitDiffLine`, with a `+n −n` summary |
| `shapes/LongOutput.tsx` | Clamps a fence over 25 lines to 12 under a fade, with a "Show all N lines" control |
| `shapes/TabbedCode.tsx` | A plugin `tabbed-code` group as the shared `Tabs` over the rendered fences |
| `shapes/ShapeSection.tsx` | A plugin `section` wrapper: the heading's words become its fold button. `SECTION_FLOW` restates Typography's positional margins |
| `src/modules/markdown-preview/MermaidDiagram.tsx` | Draws a `mermaid` fence, shared with the PRD editor. Its failure line reads `common.shapes.diagramFailed` |
| `src/modules/command-palette/context/PaletteOpsContext.tsx` | `openFileReference(path, line?)` — the door a chip and a file link open through. The rest of the chain is [file-manager.md](../file-manager.md) |
| `server/modules/providers/list/claude/surface-signal.ts` | `SURFACE_PROMPT_APPEND` — `WIDGET_SIGNAL` then `MARKDOWN_SIGNAL`, the four conventions a model is told about |
| `src/modules/i18n/locales/<locale>/chat.json` | Every shape string, under `shapes`, in all eleven locales |
| `.verify/lib/mountReact.mjs` | Mounts a second React root over the running page from the dev server's own modules |
| `.verify/lib/shapes-fixture.mjs` | `mountShapes` / `unmountShapes` — `ThemeProvider > LiveBusProvider > [toggle, div#probe-shapes-body > MarkdownBody]` |
| `.verify/probe-shapes-detect.mjs` | Every grammar in `detect.ts`, positive and near-miss cases, through `tsx` with no browser |
| `.verify/probe-shapes-baseline.mjs` | The no-swallow proof: a near-miss document byte-compared with `.verify/artifacts/shapes-elements-baseline.html`, plus a streaming pass that asserts the plain map |
| `.verify/probe-shapes-tables.mjs` | The table branch: shapes, the two declines, sort, CSV, bars, export |
| `.verify/probe-shapes-lists.mjs` | The alert branch and the list ladder, their near misses, nesting, and the `breaks` form |
| `.verify/probe-shapes-prose.mjs` | The paragraph ladder, its declines, the streaming and `breaks` forms, and the 390 px layout |
| `.verify/probe-shapes-fences.mjs` | The fence precedence: tiles, diff, long output, mermaid, the widget left alone, streaming, export |
| `.verify/probe-shapes-groups.mjs` | `remarkShapeGroups`: tab groups, sections, their near misses, the layout gate, export, streaming |
| `.verify/probe-shapes-inline.mjs` | Chips, swatches and keycaps, where a chip must not go, the click chain, the streaming scan's cost |
| `.verify/probe-shapes-lineopen.mjs` | A line number from `openFileReference` to a marked row on the reader's screen |
| `.verify/phase-32.mjs` | The gallery: all nineteen kinds in one reply, through the fixture and the real transcript, the diagram drawn live and the export whole. The one shapes proof `all.mjs` runs |

What each probe asserts, and which of its gates redden on which defect, is
[verification.md](../verification.md) §"The browser harness".

## The triggers

One table, and `detect.ts` is its only implementation. Each row is tried top to bottom; the first
rung that matches wins, and a block no rung matches takes the fallback.

| Element | Order tried | Fallback |
| --- | --- | --- |
| `table` | decision matrix → before/after → data bars → sortable table | today's bordered table |
| `ul` / `ol` | task list → check results → timeline → fact list | today's list |
| `p` | verdict → fact card | today's paragraph, with file chips |
| `blockquote` | alert | today's bordered blockquote |
| fence | widget → mermaid → `stats` → `diff` → long output | today's highlighted block |
| inline code | hex colour → key combo → file reference | today's inline code span |
| root blocks (plugin) | tabbed code, then heading sections | the blocks as written |

What "matches" means, rung by rung:

- **Tables** need a header row and rows of equal length (`readTable`); anything else is today's
  table. A decision matrix's headers, trimmed and case-folded, are exactly `option pros cons` or
  `option pros cons verdict`. Before/after is exactly `before after`, or three headers ending in
  them. Data bars need two or more body rows and exactly ONE column after the first whose every
  cell passes `parseNumber` — two numeric columns is a data table, not a chart. The matrix and the
  pair decline to today's table when `hasInlineFormatting` finds any mark in the table. **Every
  other table becomes `DataTable`**, `data-shape="table"` or `"data-bars"`: the sortable table is a
  rung, not the fallback, and it needs no decline because it draws the rendered rows.
- **Lists** run no rung at all when they sit inside another list or have no items. A task list
  needs a checkbox of the item's OWN on every item — one borrowed from a sub-list does not count.
  Check results need a leading `✓`/`✅` or `✗`/`❌` followed by a space on every item, and at least
  two items. A timeline needs a clock time (`4:12 PM`, `14:05`, `09:30:11`), an ISO date with an
  optional time, or a month-day (`Sep 10`) opening every item, again at least two. A fact list is
  `**Label:** value` on every bullet, two pairs at the least, with no other mark anywhere — a link or
  code span in a label or a value declines it.
  Task list precedes check results on purpose: a task list whose items also carry glyphs keeps its
  checkboxes.
- **Paragraphs**: a verdict is the WHOLE text matching `^VERDICT:\s+(PASS|FAIL)` with an optional
  `— B:n H:n M:n L:n` (em dash, en dash or hyphen), uppercase. The line may be wrapped in bold or
  italic, because the banner is itself the emphasis; a link or code span declines it. A fact card
  is two or more `**Label:** value` pairs, each label opening its own line, nothing else in the
  paragraph.
- **Alerts** are GitHub's syntax: a first line that is exactly `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`,
  `[!WARNING]` or `[!CAUTION]`, case-insensitive. Trailing words on that line make it a quotation. A
  quote holding the marker and no body stays a quotation, marker and all. Tones: note and important
  `info`, tip `positive`, warning `warn`, caution `danger`.
- **Fences**: the widget branch is decided first, in `CodeBlock`, on the exact info-string word
  `widget`. Everything else goes to `CodeFence`. `mermaid` matches the leading `\w+` of the info
  string, so `mermaid-v2` draws a diagram too. A `stats` fence becomes tiles only if EVERY non-blank
  line is `label | value` or `label | value | delta` (one trailing empty cell forgiven, a leading one
  not); one malformed line and the whole fence stays a code block. Any `diff` fence is coloured. A
  fence of more than `LONG_OUTPUT_LINES` (25) lines is clamped.
- **Inline code** is tried against its whole text: `#fff`, `#ffffff` or `#ffffffff` gets a swatch;
  two or more keys joined by `+` with at least one modifier becomes keycaps (`a + b` is arithmetic);
  a strict file reference becomes a chip.
- **File references** have one grammar and two policies. `parseFileRef` with its defaults is the
  strict prose grammar: at least one `/`, a final segment with an extension, and either a
  `:line[:col]` suffix or an extension in `KNOWN_EXTENSIONS`. `FILE_REF_SCAN` is meant to be the
  same grammar as a global scanner for plain text, and it never matches inside a URL. **Today the two
  disagree on one case**: a path that opens with `/` or holds `//` — `/etc/nginx/nginx.conf`,
  `/home/me/src/a.ts:12`, `src//a.ts:3`. `parseFileRef` accepts it, so written as a whole inline code
  span it becomes a chip. The scanner refuses it — its lookbehind rejects a match that starts right
  after a `/`, and each of its segments must be non-empty — so the same text in a sentence stays
  plain. Measured on 2026-09-11. Making them agree is a change to `detect/fileRefs.ts`. `MarkdownLink` calls
  `parseFileRef` with both options false, which is the looser reading an author-declared link has
  always had here. A chip is drawn only from strings: a path inside `**bold**` or a link stays text.
- **The plugin** walks root children only, so nothing inside a list item or a blockquote is
  grouped. Tabbed code is a maximal run of two or more adjacent fences, every one with a language,
  not all the same language, and none of them `widget`, `mermaid`, `stats` or `diff`. A heading
  section runs from a heading to the next heading of equal or lower depth, deeper headings nesting
  inside; a heading with no body stays bare, and a `---` ending a section stays outside it.

**What the model is told.** `SURFACE_PROMPT_APPEND` reaches every Claude turn sent through
CloudCLI's chat (see [chat-contracts.md](../chat-contracts.md) §"7. A widget fence is the opt-in,
and only on this surface" for where it is set, and why only there). Its
`MARKDOWN_SIGNAL` names only the four conventions a model would not write unprompted — the `stats`
fence, the `VERDICT:` line with its counts, `path/to/file.ext:line`, and `mermaid` — and says in one
clause that ordinary markdown already renders richly. It is paid for on every turn, so the trigger
table stays here and in `detect.ts`, never in the prompt.

## Collapse and export

**The key.** `shapeKey(kind, payload)` hashes a shape's WHOLE text, and every kind names which text:

| Kind | `payload` |
| --- | --- |
| `table`, `data-bars`, `decision-matrix`, `before-after` | headers joined by `\|`, then each row, one per line (`tablePayload`) |
| `callout` | the kind word, a newline, the quote's whole text |
| `tasks`, `checks`, `timeline`, `facts` | the item texts joined by newlines (a fact paragraph spells its pairs `Label: value`) |
| `verdict` | the whole trimmed paragraph |
| `stats`, `diff`, `output`, `diagram` | the fence body verbatim |
| `tabbed-code` | every fence's language and body, joined |
| `section` | the heading text, a newline, the body's whole text |

The `section` row is why the key is content and not title. This app's replies repeat "Findings" and
"Summary" within one message; keyed on the heading alone, folding one would fold all of them. Two
blocks whose whole text matches DO share a key and fold together — the one aliasing the design
accepts. A 32-bit collision between different payloads would show a block folded that nobody folded,
which is why `isCollapsed` defaults to expanded: the failure is a block the reader can re-open, never
content that disappears.

**The map grows only by clicks.** A new entry is written only by a toggle, so no eviction exists.
`setCollapsed` has one other caller, and it adds nothing: when a mounted block's key changes under
it — the settled half of a streaming reply keeps growing, and a section's key includes its body —
`useShapeCollapse` MOVES a fold onto the new key during render and `clearCollapsed`s the old one, so
a folded block does not spring open on the next delta and the map still holds one entry per folded
block.

**Two memories are not folds.** `LongOutput` starts clamped, so its map entry records the reader's
"Show all": `true` there means released, and a collision can only ever show a block whole.
`TabbedCode` keeps a second module-level map of the tab each group last showed, keyed like its fold.

**The export rule.** `buildTranscriptHtml` renders through `renderToStaticMarkup`, where
`useIsExportingTranscript()` is true and no effect ever runs. `useShapeCollapse` then answers
`collapsed: false, interactive: false`, and `useShapeInteractive` answers `false`:

- `ShapeFrame` draws its title with no toggle, and its body whole.
- `ShapeSection` draws the heading untouched and its body open, even if it was folded on screen.
- `LongOutput` draws every line with no fade and no control.
- `TabbedCode` stacks every fence, each under its own label.
- `DataTable` and `DiffBlock` draw no sort, CSV or copy control; the table, its rows and its bars
  stay.

The saved file inlines the app's stylesheets, so a control drawn into it would paint its hover and
do nothing. See [tool views](./06-tool-view.md) §"Rendering into an exported document" for the rule
this follows. `mermaid` is the one exception: an export draws the fence's SOURCE, as the ordinary
highlighted block inside the same `diagram` frame. A static render runs no effect for mermaid to
draw in, and no `ThemeProvider` sits above `MermaidDiagram`'s `useTheme()`, which throws outside
one. `CodeFence` makes that choice from `useShapeInteractive`, so the diagram component is never
mounted into an export.

## Streaming

`StreamingMarkdown` splits a reply into a settled half and a pending half on every delta. The
pending half is `<MarkdownBody streaming>`, and `MarkdownBodyRenderer` gives it `PLAIN_COMPONENTS`
and no `remarkShapeGroups`. So the still-growing text is today's markup by construction, apart from
the inline marks below: a
half-arrived table is never a card grid, a half-arrived fence never joins a tab group, and a verdict
cannot become a banner halfway through arriving. `probe-shapes-baseline.mjs` asserts that over a
document holding a table and all six heading levels, because no phase after the move edits the
plain map.

Fences get the flag one step further. `CodeBlock` is the only reader of `MarkdownStreamingContext`
left in the tree, because it must pass `streaming` to `WidgetFrame`. It hands the same flag to
`CodeFence` as a plain prop, and `CodeFence` returns today's highlighted block for a streaming fence
before it tries a single shape — mermaid included, so the diagram parser never runs on half a
diagram every 100 ms.

**The inline marks run on the streaming half too.** That is a divergence from the plan, which said
the streaming half never runs the scan. Two routes carry them there. `renderInline` is called by
`PlainParagraph`, `PlainListItem` and `PlainTableCell`, which are in both maps, so moving the call
into the `Shape*` twins would have reopened modules other phases own. And the `code` entry of both
maps is `CodeBlock`, which sends every inline code span to `InlineCode`, so a streaming span also
becomes a colour swatch, keycaps or a file chip. The cost is one regex pass over the rendered text per render,
which `probe-shapes-inline.mjs` holds under 4 ms for 42,000 characters holding 400 references
(measured at 0.4 ms on 2026-09-11), and a reference then looks
the same on both sides of the settle boundary. The reasoning lives in `elements/inlineText.tsx`.

**A block that crosses the boundary remounts.** The split can retract, putting a settled block back
in the pending half, which is a different parent (see [live widgets](./07-live-widgets.md)
§"The fence" for the measured restart). A shape there drops to plain markup until it settles again,
then mounts fresh and re-reads its fold from the map, so the fold returns when its payload is
unchanged.

## Gotchas

- **The baseline artifact exists only in this working tree.** `.verify/` is git-ignored, and
  `.verify/artifacts/shapes-elements-baseline.html` is pinned to the PRE-MOVE renderer. A DOM
  change means the change is wrong, not the artifact: re-capturing from the current tree compares
  the new DOM with itself and can never fail again. How it was captured, and the only legitimate way
  to re-establish it, is in [verification.md](../verification.md).
- **Two moved files still carry palette colours, on purpose.** `MarkdownLink.tsx` has
  `text-blue-600 dark:text-blue-400` and `code/CodeFence.tsx` has `text-green-600
  dark:text-green-500`, both inside blocks the baseline document renders, so re-toning either says
  `DOM CHANGED`. The palette grep the plan runs over `shapes/` (`docs/plans/markdown-shapes.plan.md`,
  Phase 2's verify) `--exclude`s exactly those two filenames. It also cannot see a third literal:
  `FenceBlock` in `code/CodeFence.tsx` paints its shell `bg-muted/50 … dark:bg-zinc-900`, and the
  grep's pattern (`blue`, `green`, `red`, `rgb(`, six-digit hex) has no `zinc`. That spelling is
  `MermaidDiagram`'s too — the drift [live widgets](./07-live-widgets.md) §"Gotchas" records. A
  re-tone is its own change, with its own baseline re-capture, and it must search for `zinc` as well.
- **`FILE_REF_SCAN` carries the `g` flag.** Use it only with `match`, `matchAll`, `replace` or
  `split`. `test` and `exec` keep `lastIndex` between calls, so a second identical `test` answers
  `false`, and a scan built on them drops every other hit without a sound.
- **A chip is a `<button>`, so three places suppress it.** `MarkdownLink`, `ShapeSection`'s heading
  and `DataTable`'s header row provide `ChipsSuppressedContext`, and `FileChip` then draws the plain
  text or code span it was handed. Anything else that puts rendered markdown inside a control needs
  to provide it too, or one click fires two actions.
- **A section wrapper moves every block Typography positions.** Tailwind Typography spaces a reply
  with `> :first-child`, `h2 + *` and `hr + *`, and a wrapper changes all of those positions.
  `SECTION_FLOW` in `ShapeSection.tsx` restates each rule where the wrapper moved it, and the groups
  probe holds every block of a sectioned reply within half a pixel of the unsectioned one. A new
  prose rule that reads position needs a line there.
- **User messages render with `remark-breaks`.** A newline arrives as a `<br>` plus a separate
  `"\n"` text node. `liftLeadingToken` drops the break an alert marker leaves behind, and
  `readFactPairs` treats a `<br>` as the separator between pairs. A new rung that reads lines must
  handle both forms; the lists and prose probes mount the `breaks` form for this.
- **Adjacent lists with the same marker and a blank line between them are ONE loose list**
  (CommonMark §5.3). A document that means two lists must switch between `-`, `*` and `+`. This bit
  the first draft of the lists probe, which saw one fifteen-item plain list and no shapes.
- **A nested list is always plain.** `InsideListContext` is set around everything `ShapeList`
  renders, so a sub-list of tasks under a task list stays an indented list, never a second card
  inside a bullet.

## If you change this, check that

| If you touch | Also check |
| --- | --- |
| Any grammar under `shapes/detect/` | `probe-shapes-detect.mjs` carries a positive AND a near-miss case for it, and the element's own browser probe still passes. A rule that accepts more is a rule that fires on someone's prose |
| `PLAIN_COMPONENTS` or any `Plain*` component | `probe-shapes-baseline.mjs` still prints `BASELINE: DOM identical`, and its streaming pass still finds no `data-shape`. Never re-capture the artifact to make it pass |
| `SHAPE_COMPONENTS` | It still spreads the plain map and replaces only elements that have a `Shape*` twin. An element with no shape (`thead`, `tr`, `th`, `hr`, `h1`–`h6`) names its `Plain*` in both maps |
| The streaming ternary, or where `remarkShapeGroups` is added | The prose, fences and groups probes' streaming mounts still draw no shape and no group. It is the one site the streaming rule is enforced |
| `hasInlineFormatting` or `readFactPairs` | The tables probe's marked-up matrix still declines, the lists probe's linked and code-span fact labels still decline, and the prose probe's fact declines still keep their span and `href`. These are what stop a shape rendering less than the markdown |
| `DataTable`'s sort | It still permutes the RENDERED `tr` elements keyed by original index. The tables probe reads whole `(label, note, count, rank)` tuples with their `code` and `strong` inside, stability in both directions, the third click, the CSV order, and each bar travelling with its row |
| A `shapeKey` payload | Two kinds never share a payload shape, and `section` still includes the body — the groups probe folds two "Findings" sections apart |
| `isCollapsed`'s default | It stays expanded. A default of folded turns a 32-bit collision into content that disappears |
| `useShapeCollapse` or `useShapeInteractive` | The tables, fences and groups probes' export mounts still draw every shape whole with zero controls, and a fold still survives its row remounting |
| `ShapeFrame`'s markers | Every probe finds shapes by `data-shape`, `data-collapsed` and `data-shape-toggle`. Rename one and gates that never read this source go quiet |
| `SECTION_FLOW` | The groups probe's layout gate: every block within half a pixel of its unsectioned position, the opening heading flush, the reply's height unchanged |
| `NEVER_TABBED` in `remarkShapeGroups` | A widget in a run of fences still mounts its live frame, and a `diff` beside a code fence stays its own shape — both are groups probe near misses |
| `CodeFence`'s order, its streaming return, or its export branch | The fences probe: both mermaid fences wear `data-shape="diagram"`, a malformed `stats` fence keeps every line, and the streaming mount draws no shape and no svg. The groups probe's export mount: the mermaid fence comes out as its source inside its `diagram` frame. `useShapeInteractive` stays above the streaming return, so every render calls the same hooks |
| `MermaidDiagram`'s render id | The gallery, `phase-32.mjs`, knows a diagram drew only by the `mermaid-` prefix on the svg id `MermaidDiagram` gives each render. Change the prefix and its four live-diagram lines redden with the diagram on screen |
| `LONG_OUTPUT_LINES` or `LONG_OUTPUT_PREVIEW_LINES` | The fences probe's 25-line fence stays whole and its 26-line fence clamps, and `probe-shapes-detect.mjs` pins the pair at 25 and 12 |
| `parseFileRef`, `FILE_REF_SCAN` or `MarkdownLink`'s policy | The inline probe: no chip in a URL, time, version or npm scope; every link that opened in the Files tab still does; the scan's cost ceiling. The whole-text parser and the scanner are built from the same fragments and are meant to agree; today they differ on a path opening with `/` or holding `//` (see **The triggers**), so a change to either must say which way that case goes |
| `ChipsSuppressedContext` or where it is provided | The inline probe's backticked path in a link, a section heading and a sortable header stays today's code span, and React logs no nested-control warning |
| `openFileReference`'s signature, or the file-manager chain behind it | `probe-shapes-lineopen.mjs` end to end, and the inline probe's click that must land on the target row |
| `surface-signal.ts` | `WIDGET_SIGNAL`'s bytes are another session's and move unchanged, and `MARKDOWN_SIGNAL` names only conventions `detect.ts` really implements. It costs tokens on every turn |
| A shape string | It exists under `shapes` in all eleven `chat.json` files. `MermaidDiagram`'s string is `common.shapes.diagramFailed`, because that component is shared with the PRD editor |
| Where `Timeline` or `StatTiles` live | They move to `src/shared/ui/` only when a second module uses one, and never into `src/shared/ui/verve/`, which holds stylesheets and nothing else |
