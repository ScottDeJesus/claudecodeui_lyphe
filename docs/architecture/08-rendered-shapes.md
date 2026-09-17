# Rendered shapes

## In one paragraph

A settled assistant reply's ordinary markdown renders as a component instead of as plain markup
whenever it matches a shape exactly: a GFM (GitHub Flavored Markdown) table becomes a sortable table
with a copy-as-CSV action, a task list gains a progress bar, a `> [!NOTE]` alert becomes a toned
callout, a `VERDICT: FAIL — B:1 H:0 M:2 L:0` line becomes a verdict banner, a `stats` fence becomes
stat tiles, a `diff` fence is coloured by line, a run of fences in different languages becomes one
tab strip, a heading folds its section, a line ending in a colon becomes the title of the list or
table written under it, and `src/parser.ts:42` in a sentence becomes a chip that opens
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
   apart from the inline marks — file chips (with the preview under a picture's or a PDF's chip),
   colour swatches and keycaps — which it draws too
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
   `data-shape` and no frame.) `ShapeFrame` is the shared `Collapsible` plus the markers the probes
   measure (`data-shape` / `data-collapsed` / `data-text-scale` on the root, plus `data-vv-enter` on
   the root ONLY on a card the reader has not watched arrive, `data-shape-toggle` on
   the trigger, `data-shape-header` / `data-shape-icon` / `data-shape-title` / `data-shape-actions` /
   `data-shape-body` on the regions below it), the content-addressed fold memory, an actions slot,
   and the header's own anatomy — an icon and a tone, both keyed off `kind` (a closed `ShapeKind`
   union, not a bare `string`) through the file-local `SHAPE_KINDS` registry, overridable per call
   site by the `tone`/`icon` props for the three kinds whose meaning only the caller knows
   (`Callout`'s alert kind, `VerdictBanner`'s verdict, `CheckResults`' fail count). `accent` is not a
   sixth tone but the ABSENCE of one — the structural wash a card of pure structure wears — and it is
   the only value that writes no `data-tone`; that attribute sits on the header row, never the root,
   so a `Badge` or a `Chip` in the body keeps its own tone instead of inheriting the frame's. Every
   header and body size is `em`, off the named scale `tailwind.config.js`'s `fontSize` declares
   (§"Header, type and motion"), so a frame follows the chat text size the reader set rather than a fixed px.
   Its title can also arrive from above: `LeadIn` hands a lead-in paragraph's own rendered words down
   through `LeadInTitleContext`, and the frame draws those instead of its `title` prop. Two
   collapsibles do not wear it: a heading section, whose heading is its own toggle, and long output,
   whose control sits under the block.
7. **A fold is remembered by content, not by message id.** A module-level map keyed on
   `shapeKey(kind, payload)` survives the row unmounting as it scrolls away. Absent means expanded,
   always — nothing ever opens folded on its own. **An entrance is remembered by content the same
   way.** A module-level `Set<string>`, keyed on the same `shapeKey` and living beside the fold map,
   records which cards have already risen: present means the reader has seen this card, so
   `LazyMessageRow` unmounting a row as it scrolls away and a streaming retraction remounting a
   settled block never replay a rise the reader already watched (§"Header, type and motion").
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
| `markdownCards.css` | The element cards a markdown surface opts into by carrying `MARKDOWN_CARDS_CLASS` (`src/shared/constants.ts`, `'chat-md-cards'`). Imported by `Markdown.tsx` as a side effect; see §"Element cards" |
| `shapes/shapeMotion.css` | The transcript's entrances: `[data-vv-enter]` plays `animate-shape-rise` once, and the rows, items and tiles inside it follow on `animate-shape-item` with a per-position stagger. FRAMES ONLY — a plain list, a quotation and the footnotes carry no key and render identically streaming or settled, so only a `ShapeFrame` root ever carries the marker. Imported by `Markdown.tsx` as a side effect, directly after `markdownCards.css`; see §"Header, type and motion" |
| `StreamingMarkdown.tsx` | Renders a reply as a settled `<MarkdownBody>` and a pending `<MarkdownBody streaming>` |
| `shapes/detect.ts` | Every trigger, behind the one import path every consumer uses: `classifyTable`, `soleNumericColumn`, `parseNumber`, `parseStatsFence`, `deltaTone`, `parseAlertKind`, `parseVerdict`, `isLeadInText`/`LEAD_IN_MAX_CHARS`, `isTimeToken`/`timeTokenLength`, `checkGlyph`/`checkGlyphLength`, `parseFileRef`, `FILE_REF_SCAN`, `KNOWN_EXTENSIONS`, `KNOWN_DOTFILES`, `IMAGE_EXTENSIONS`/`previewKindOf`, `parseHexColor`, `parseKeyCombo`, `splitDiffLine`, `LONG_OUTPUT_LINES`, `LONG_OUTPUT_PREVIEW_LINES`. A barrel with no logic of its own — a new trigger goes in its family's module and gets its name added here |
| `shapes/detect/` | The grammars, one pure module per family: `tables`, `fences`, `prose`, `listMarks`, `fileRefs`, `inlineMarks` (which name lives where is the barrel's header). None imports anything, a sibling included, so `tsx` loads the barrel with no browser |
| `shapes/hast.ts` | `HastNode` and the text readers: `textOf`, `readTable`, `readListItems`, `readFactPairs`, `readCodeChildren`, `hasInlineFormatting` |
| `shapes/tableData.ts` | What happens after a table trigger fires: `tableRung` (the ladder `ShapeTable` switches on and `LeadIn` asks about the table under a line), `tablePayload`, `dataTableKind`, `compareCells`, `sortedOrder`, `toCsv`, `barPercents` |
| `shapes/listItems.ts` | `renderedListItems` and `liftLeadingToken` — pairs rendered `li`s with parsed items, and lifts a glyph, a time or an alert marker out of the first text node. Also the list ladder: `listRung`, plus the `listItemNodes`/`ownCheckbox` pair it reads the items with, shared with `ShapeList` so the rung and the count cannot disagree |
| `shapes/listNesting.ts` | `InsideListContext` — a list inside a list is always plain |
| `shapes/chipContext.ts` | `ChipsSuppressedContext` — true inside a link, a section heading and a sortable header, where a chip would be a button inside a control |
| `shapes/collapseState.ts` | `shapeKey` (djb2, forced unsigned), `isCollapsed`, `setCollapsed`, `clearCollapsed` — the page-lifetime fold map — plus `hasEntered`, `markEntered`, the page-lifetime entrance memory beside it, keyed the same way |
| `shapes/useShapeCollapse.ts` | `useShapeCollapse` (fold state, key migration, export override, and `enter` — whether THIS mount may play its entrance) and `useShapeInteractive` (may a control be drawn at all) |
| `shapes/markdownStreaming.ts` | `MarkdownStreamingContext`, in its own module to avoid an import cycle. Its one consumer is `CodeBlock` |
| `shapes/remarkShapeGroups.ts` | The one remark plugin, three passes over the root's children: fence runs into `tabbed-code`, a title paragraph and the list or table under it into `lead-in`, headings and their bodies into `section` wrappers |
| `shapes/leadInContext.ts` | `LeadInTitle` (`{ title, hasLink }`) and `LeadInTitleContext` — the line above a block, travelling from `LeadIn`, which provides the paragraph's own rendered children AND whether they hold a link, to `ShapeFrame`, which shows them in place of its `title` prop, folds from its chevron alone when `hasLink` is true, and re-provides `null` around its own body so no nested frame can inherit the title |
| `shapes/LeadIn.tsx` | `LeadIn` — the `lead-in` wrapper: asks `tableRung`/`listRung` whether the block below frames itself, hands the words down through `LeadInTitleContext` when it does, frames the list itself when it does not, and leaves a table that draws no frame exactly as it was |
| `shapes/ShapeFrame.tsx` | `ShapeFrame` — the header bar, fold and markers every framed shape wears. `kind` is a closed `ShapeKind` union; its default icon and tone come from the file-local `SHAPE_KINDS` registry, overridable by the `tone`/`icon` props for the three kinds whose meaning only the caller knows. `title` is a `ReactNode` (a lead-in title is the author's own rendered paragraph), `prose` keeps `not-prose` off a frame that holds plain prose, `flush` drops the body's inset for a frame whose own content reaches its own edge, and the title span carries `data-shape-title` inside `ChipsSuppressedContext` while the body carries `data-shape-body`. Every header and body size is `em`, off the named scale `tailwind.config.js`'s `fontSize` declares (§"Header, type and motion"). A title holding a link folds from the chevron alone, the same answer `ShapeSection` gives a heading with a link in it |
| `shapes/elements/index.ts` | The barrel `Markdown.tsx` imports every element override through |
| `shapes/elements/table.tsx` | `PlainTable`, `PlainTableHead`, `PlainTableRow`, `PlainTableHeaderCell`, `PlainTableCell`, and `ShapeTable` — the table branch, which draws the rung `tableRung` hands it rather than deciding again. `ShapeTableCell` is an alias of `PlainTableCell` |
| `shapes/elements/list.tsx` | `PlainList`, `PlainListItem`, and `ShapeList` — the list branch, which switches on `listRung` and keeps the rungs themselves in `shapes/listItems.ts` where `LeadIn` can ask the same question. `ShapeListItem` is an alias of `PlainListItem` |
| `shapes/elements/blockquote.tsx` | `PlainBlockquote` and `ShapeBlockquote` — the alert branch |
| `shapes/elements/paragraph.tsx` | `PlainParagraph` and `ShapeParagraph` — the verdict and fact ladder |
| `shapes/elements/plain.tsx` | `PlainRule`, `PlainHeading` (forwards hast properties, so GFM's `sr-only` footnote label stays hidden), `PlainDiv`, and `ShapeDiv`, which routes the three plugin wrappers |
| `shapes/elements/inlineText.tsx` | `renderInline` — the one seam where a block's rendered inline content gets file chips |
| `shapes/code/index.tsx` | `CodeBlock` (the `code` override's dispatcher: inline or block, then the widget branch) and `CodePre` |
| `shapes/code/EmbedFrame.tsx` | `EmbedFrame` — the card a LIVE embed wears: the one `ShapeFrame` header every shape draws, `flush` so the iframe reaches the card's own edge, plus an `a[data-docspace-open]` action carrying a DocSpace block's studio deep link. `CodeBlock` hands it to `WidgetFrame` as its `frame`, and `WidgetFrame` calls it only behind its mount and streaming gates; it imports nothing from `@/modules/widgets` and classifies no body. See [live widgets](./07-live-widgets.md) §"The DocSpace kind" |
| `shapes/code/CodeFence.tsx` | The fence precedence, and `FenceBlock`, today's highlighted block. Injects the `cc-syntax-theme` style at module scope |
| `shapes/code/InlineCode.tsx` | Today's inline code span, or a colour swatch, keycaps or a file chip |
| `shapes/MarkdownLink.tsx` | The `a` override. Asks `parseFileRef` under its loose link policy and forwards the `:line` |
| `shapes/InlineMarks.tsx` | `FileChip`, `ColorSwatch`, `KeyCaps`, and `linkifyChildren`, the prose scan |
| `shapes/useFilePreview.ts` | `useFilePreview` — a file chip's preview: reads a picture's or a PDF's bytes through the workspace's `readFileReference` palette op, shared within the reply, and keeps its fold in the shapes' own fold memory. Nothing while loading, when unreadable or mistyped, in an export, where chips are suppressed, in a reply still streaming, or for a PDF unless `navigator.pdfViewerEnabled` is true and the pointer is fine (a phone gets none). An SVG is shown from a `data:` URL, never a `blob:` one a new tab would run in this origin |
| `shapes/previewScope.ts` | `PreviewScopeContext` — the row a preview belongs to: `MessageComponent` provides a tool row's `toolId`, or a finished reply's trimmed text hashed with its turn anchor — the last tool call before it in its turn, else the prompt, read by `ChatMessagesPane` from the full message order (never an id, which changes as a reply finalises, and never the rows on screen, which "Show work" changes), `false` while a reply streams, and `null` — this mount alone — where neither exists |
| `shapes/FilePreview.tsx` | `FilePreviewFrame` — the preview under a chip: the picture (a click opens `ImageLightbox`, square as well) or the PDF in an `iframe` at most 32rem or 60vh tall, in a square-cornered hairline frame with nothing drawn over it, so a screenshot's corners and edges all show. The chip beside it carries the open-in-Files button. A loaded preview fires `TRANSCRIPT_GREW_EVENT` (`transcript/transcriptGrew.ts`), which `useChatSessionState` answers by re-pinning a chat left at its bottom |
| `shapes/MarkdownImage.tsx` | `MarkdownImage`, the `img` override in both maps: a relative `src` with a picture's extension is drawn as that file's chip (labelled with the alt text), which previews it; any other `src` is react-markdown's own `<img>` with the props it was given |
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
| `.verify/probe-shapes-fences.mjs` | The fence precedence: tiles, diff, long output, mermaid, the widget's own `data-shape="widget"` in that same order (it wears the card header now, so it is no longer left off the precedence list), streaming, export |
| `.verify/probe-shapes-groups.mjs` | `remarkShapeGroups`: tab groups, sections, their near misses, the layout gate, export, streaming |
| `.verify/probe-shapes-inline.mjs` | Chips, swatches and keycaps, where a chip must not go, the click chain, the streaming scan's cost |
| `.verify/probe-shapes-lineopen.mjs` | A line number from `openFileReference` to a marked row on the reader's screen |
| `.verify/probe-markdown-cards.mjs` | The element cards: what a `chat-md-cards` surface paints, what it must not (a `.not-prose` list, a margin), the dark repaint, and the proof the class changes no DOM |
| `.verify/phase-32.mjs` | The gallery: all nineteen kinds in one reply, through the fixture and the real transcript, the diagram drawn live and the export whole |
| `.verify/phase-33.mjs` | The carded gallery: every element card and all twenty kinds in ONE document, shown whole at the transcript's own measured width — 836 px at a 1440 px viewport and 358 px at 390 — in both themes, with the paint read off the theme's own references. It is a `phase-` and not a `probe-` script so `all.mjs` runs it, and the card laws live in the standing gate rather than in a by-hand probe |
| `.verify/phase-34.mjs` | The falsifiable probe for the rendered-markdown verve: lead-in frames, header wash, the text scale, framed embeds, and the entrance — a first settled mount carries `data-vv-enter` and plays the rise, a later mount of the same content carries neither, and reduced motion draws no rule at all |

What each probe asserts, and which of its gates redden on which defect, is
[verification.md](../verification.md) §"The browser harness".

## The triggers

One table, and `detect.ts` is its only implementation. Each row is tried top to bottom; the first
rung that matches wins, and a block no rung matches takes the fallback.

| Element | Order tried | Fallback |
| --- | --- | --- |
| `table` | decision matrix → before/after → data bars → sortable table | today's bordered table |
| `ul` / `ol` | task list → check results → timeline | today's list |
| `p` | verdict → fact card | today's paragraph, with file chips |
| `blockquote` | alert | today's bordered blockquote |
| fence | widget → mermaid → `stats` → `diff` → long output | today's highlighted block |
| inline code | hex colour → key combo → file reference | today's inline code span |
| root blocks (plugin) | tabbed code, then lead-ins, then heading sections | the blocks as written |

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
  optional time, or a month-day (`Sep 10`) opening every item, again at least two. A list of
  `**Label:** value` bullets is a list: the author wrote bullets, and a grid in their place takes the
  bullets away, shrinks the labels to captions and drops their colons.
  Task list precedes check results on purpose: a task list whose items also carry glyphs keeps its
  checkboxes. An ordered list keeps the author's first number (`listStart` in `shapes/listItems.ts`)
  in today's list and in every shape, so a numbered sequence split by a code block continues at 2
  after the fence instead of starting again at 1.
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
  a strict file reference becomes a chip. A reference `previewKindOf` names a picture (an extension
  in `IMAGE_EXTENSIONS`) or a PDF also shows that file under the chip, in a code span and in prose
  alike, and once the preview has loaded a click on the chip folds and unfolds it instead of opening
  the file — a small button beside the chip opens it, folded or not. The bytes are read
  through the `readFileReference` palette op, which `WorkspaceMain` registers on the same resolver
  a chip click opens through — minus its filename-only guess, so a picture is never a same-named file
  from elsewhere. Reads are shared per project, path and row (`PreviewScopeContext`: a tool row's id,
  or a reply's text with its turn anchor); a row with neither is read and not kept: a remount of the same reply reuses its read, a later reply naming an overwritten
  screenshot reads it again. A found-nothing read is not kept; at most 64 reads and 150 MB are held,
  a read counting its declared size from its headers on. A file over 25 MB is refused on its
  `Content-Length` — which the content route sends, streaming exactly that many bytes — or, where a
  proxy stripped the header, part-way through its body. A markdown image, `![alt](src)`, with a RELATIVE `src` and a picture's extension is
  drawn the same way; one with a scheme, `//`, or a leading `/` stays react-markdown's own `<img>` —
  `/favicon.ico`, served by the app, is pinned in the baseline document. A heading and a plain table
  header suppress chips and pictures, streaming or settled. The prose scan refuses a run that is
  only the front of a longer name (`src/logo.png.bak`, `src/a.ts.map`).
- **File references** have one grammar and two policies. `parseFileRef` with its defaults is the
  strict prose grammar: at least one `/`, a final segment that is either a name with an extension or
  a DOTFILE (whose whole name sits in the extension slot, `src/.env`), and either a `:line[:col]`
  suffix or a name on the list its slot is vouched by — `KNOWN_EXTENSIONS` for the first shape,
  `KNOWN_DOTFILES` for the second. So `src/.env` and `/etc/nginx/nginx.conf` chip; `src/.ts` stays
  plain (`ts` names no dotfile) while `src/.ts:12` chips; a segment of only dots (`src/..ts`) is
  never a file, and a bare `.env` has no separator and stays plain. An ABSOLUTE path is a path like
  any other: the scanner allows the leading `/`, and what keeps that out of a URL is its lookbehind,
  which refuses a match opening right after a letter, a `/` or a `:`. `FILE_REF_SCAN` is meant to be the
  same grammar as a global scanner for plain text, and it never matches inside a URL. **Today the two
  disagree on one case**: a path holding `//` — `src//a.ts:3`. `parseFileRef` accepts it, so written
  as a whole inline code span it becomes a chip; the scanner refuses it, because each of its segments
  must be non-empty, so the same text in a sentence stays plain. Measured on 2026-09-13. Making them
  agree is a change to `detect/fileRefs.ts`. `MarkdownLink` calls
  `parseFileRef` with both options false, which is the looser reading an author-declared link has
  always had here. A chip is drawn only from strings: a path inside `**bold**` or a link stays text.
- **The plugin** walks root children only, so nothing inside a list item or a blockquote is
  grouped. Tabbed code is a maximal run of two or more adjacent fences, every one with a language,
  not all the same language, and none of them `widget`, `mermaid`, `stats` or `diff`. A lead-in is a
  paragraph whose NEXT sibling is a list or a table and which is a title rather than a sentence:
  `isLeadInText` in `shapes/detect/prose.ts` takes it when the line is at most
  `LEAD_IN_MAX_CHARS` (120) characters, holds no line break, and either ends in a colon or is one
  wholly bold run — `**Summary**`, colon or not. Its body has to be a single `strong` node and
  nothing else but a lone `:` after it, so `**Important** and the rest` stays a sentence. A heading
  section runs from a heading to the next heading of equal or lower depth, deeper headings nesting
  inside; a heading with no body stays bare, and a `---` ending a section stays outside it. The
  lead-in pass runs between the other two, because `groupSections` nests a section's body one level
  down and a pass after it would never see a pair written under a heading.

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
| `tasks`, `checks`, `timeline` | the item texts joined by newlines |
| `facts` | the paragraph's pairs, one `Label: value` per line |
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

**Three memories are not folds.** `LongOutput` starts clamped, so its map entry records the reader's
"Show all": `true` there means released, and a collision can only ever show a block whole.
`TabbedCode` keeps a second module-level map of the tab each group last showed, keyed like its fold.
`collapseState.ts` keeps a third itself, beside its own fold map: a `Set<string>` recording which
cards have already risen, so `hasEntered`/`markEntered` answer whether THIS mount may play the
entrance `ShapeFrame` draws through `data-vv-enter` — present means seen, and a card `LazyMessageRow`
remounts, or a settled block a streaming retraction rebuilds, never replays a rise the reader already
watched.

**The export rule.** `buildTranscriptHtml` renders through `renderToStaticMarkup`, where
`useIsExportingTranscript()` is true and no effect ever runs. `useShapeCollapse` then answers
`collapsed: false, interactive: false`, and `useShapeInteractive` answers `false`:

- `ShapeFrame` draws its title with no toggle, and its body whole, and plays no entrance: `enter` is
  captured only while `interactive` is true, so an exported document never carries `data-vv-enter`.
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
becomes a colour swatch, keycaps or a file chip — except in a heading or a table header, which
suppress chips and pictures whether streaming or settled. The cost is one regex pass over the rendered text per render,
which `probe-shapes-inline.mjs` holds under 4 ms for 42,000 characters holding 400 references
(measured at 0.4 ms on 2026-09-11), and a reference then looks
the same on both sides of the settle boundary. The reasoning lives in `elements/inlineText.tsx`.

**A block that crosses the boundary remounts.** The split can retract, putting a settled block back
in the pending half, which is a different parent (see [live widgets](./07-live-widgets.md)
§"The fence" for the measured restart). A shape there drops to plain markup until it settles again,
then mounts fresh and re-reads its fold from the map, so the fold returns when its payload is
unchanged.

## Element cards

The shapes decide what a block *becomes*; the cards decide how the markdown that stays today's
markup is *painted*. On a carded surface a list is a framed, filled, rounded box; an ordered list
lifts its numbers into pills in its own gutter; and a nested list keeps its parent's frame and
loses its own. A quotation takes a wash and a rounded corner; a rule becomes a hairline that fades
out at both ends; a visible `h1` or `h2` is underlined and `h3`–`h6` are not; the footnotes block is
a card with its own list unpainted inside it; a footnote reference is a small tinted chip; an inline
image is framed and rounded; struck-through words take the muted ink; display maths scrolls sideways
on a wash of its own; and an item that opens with a bold label — `**Root cause:** the parser …` —
draws that label as the card's own title, its own line with the item's words beneath it; and a table
outside a shape — the streaming half, where nothing has settled into `DataTable` yet — takes the
carded body size over `PlainTable`'s own smaller default. Seventeen rules, R1–R17, all of them in
`src/modules/chat/transcript/markdownCards.css`.

**Colour inside a card is the accent's pair, and only the pair.** A card's marks are the accent INK
(`text-accent-ink` — the bullet, every `::marker`, the number pill's numeral, the title, the footnote
chip) and its washes are the accent FILL at low alpha (`bg-primary/…` — the pill, the quotation, the
chip behind that reference). That is the same pair the shapes draw between a green word and a green
shape ([verve/README.md](../../src/shared/ui/verve/README.md) rule 3), and the frame itself stays the
neutral hairline it was: Verve spends the accent sparingly, so a card is not a green box, it is a
neutral box whose marks are green. Two rules spend no accent at all — R14 inks a struck word the
muted foreground and R15 washes display maths in `bg-muted/50` — because those are the two marks a
shape renders for itself as well, and a card has no business tinting the inside of a callout. Both
are scoped `:not(.not-prose *)` like the rest of the paint, so inside a shape's own frame they do
not apply at all.

**The title's trigger is the bold lead-in, because CSS cannot read a colon.** A browser has no way to
match text inside a text node, so `li > strong:first-child` and the loose list's
`li > div:first-child > strong:first-child` are what a title is keyed on — the renderer spells a loose
item's paragraph as a `div`, not a `p`. The cost is named rather than hidden: the trigger is **any**
bold lead-in, colon or not, so `- **Important** and then the rest` is titled as well, and so is an
item that is bold from end to end. A label with a body, a bold word at the head of a sentence and a
wholly bold item are the same element with the same element siblings — the only difference is a text
node, and no selector reads one of those, nor a colon inside one.

**The line ABOVE a list or a table is read by the plugin, not by CSS.** Same reason, opposite
conclusion: `groupLeadIns` has the paragraph's siblings, so it can read the colon the selector
cannot and group the pair before either element renders. The paragraph's own rendered children —
bold, code span and colon intact — become the frame's title, and a list that draws no frame of its
own is framed by `LeadIn` under that title. That frame is built `prose`, so `not-prose` stays off it
and the cards' rules DO reach the list inside: R2–R5 still keep the gutter, the marker and the number
pills, and R16 still draws a `**Label:**` item's label as a title. The one rule that stops at the
frame is R1, its border and its fill — the frame itself is the card, and painting the list again
would nest border in border.

**Paint is opted into by the wrapper.** `Plain*` renders every markdown surface and only the wrapper
knows which surface it is, so the opt-in is one class there — `MARKDOWN_CARDS_CLASS` in
`src/shared/constants.ts`, spelled `'chat-md-cards'` — and the paint is a stylesheet scoped to that
class, side-effect imported by `Markdown.tsx`. It changes no DOM: the class rides the wrapper and
nothing under it moves, so **a miss is today's markup** still holds byte for byte and
`probe-shapes-baseline.mjs` is untouched by the cards. Four call sites in three files carry it —
`MessageComponent`'s two bodies (the assistant reply, the tool-use text), `ThinkingRow`'s body, and
`MarkdownContent`, which is every tool markdown body. A user message bubble and a tool error
deliberately do not.

**Three layers, in this order.** Tailwind Typography paints from the prose container; the `Plain*`
component's own class string paints next; on a carded surface `markdownCards.css` paints last. It
wins by selector specificity, never `!important`: it overrides `PlainList`'s padding (`pl-5`), its
list style (`list-decimal`) and its marker colour (`marker:text-current`), and `PlainRule`'s
`border-t`. For headings, quotes, footnotes, images and maths it only adds paint.

**The exclusion is `.not-prose`, and never `[data-shape]`.** Every block shape's frame wears
`not-prose` (`shapes/ShapeFrame.tsx`), so a list inside a callout or a task list keeps the pixels it
had. A heading section wears `data-shape="section"` and no `not-prose`, deliberately — a list under
a heading keeps its card — and an exclusion written on `[data-shape]` would silently un-card every
one of them. The one exception names a single kind and one rule: R1, the list card, also refuses
`[data-shape="list"] *`, because a list under a lead-in line is already inside a frame that IS its
card and painting it again would nest border in border. It is spelled as a literal kind, never as a
bare `[data-shape]`, so `ShapeSection`'s lists keep their cards.

**No card inside a card.** The frame's own predicate refuses `li *`, `blockquote *`,
`section.footnotes *`, `[data-shape="list"] *` and anything carrying a checkbox, so a list inside a
list item, a list inside a quote, the footnotes' own list, a list the lead-in already framed and a
task list are never framed twice.

**No rule sets a margin.** Typography's positional spacing and `SECTION_FLOW` stay the only spacing
rules here; a badge or a pill is placed inside the box its list already owns.

**A numbered badge uses the browser's own counter.** `content: counter(list-item)` honours
`<ol start="3">`, so a numbered sequence split by a code block continues at 2 after the fence
instead of starting again at 1. A custom `counter-reset` is what would restart it.

**Streaming.** The cards paint the streaming half too, because the markup is identical on both sides
of the settle boundary: a list crossing it shows as two cards until it settles, and a checks or
timeline list still streaming is carded until it settles into its shape.

**Export.** `collectDocumentStyles` in `buildTranscriptHtml.tsx` reads the running document's own
stylesheets, so an exported transcript carries `markdownCards.css` with it.

## Header, type and motion

**The header is one component, and every block shape that draws one wears it** (the two
collapsibles that draw their own are named in §"Mental model" rule 6). `ShapeFrame`
(`shapes/ShapeFrame.tsx`) draws the bar above a shape's body — the fold's chevron, the kind's icon,
the title, then an optional actions slot. `kind` is a closed `ShapeKind` union, spelled as a string
literal at every call site, so a kind a shape draws with no line in the file-local `SHAPE_KINDS`
registry is a type error rather than a silent default. The registry gives each kind its
`{ icon, tone }`: seventeen kinds are in it, the fourteen structural ones wear `accent`, and only the
three whose meaning is a verdict take a tone — `callout` (`info`), `checks` and `verdict`
(`positive`) — each overridable per call site by the `tone`/`icon` props, which is what `Callout` (its
alert kind), `VerdictBanner` (its verdict) and `CheckResults` (its fail count) do. **`accent` is not
a sixth tone but the ABSENCE of one** — the structural wash a card of pure structure wears — and it
is the only value that writes no `data-tone`. That attribute sits on the header ROW and never on the
root, so a `Badge` or a `Chip` in the body keeps its own tone instead of inheriting the frame's. The
title's words reach the frame two ways: the caller's `title` prop, or a lead-in paragraph's own
rendered children through `LeadInTitleContext` — and when those children hold a link, the chevron
alone becomes the button and the words are drawn beside it, because an anchor inside a button is two
controls in one. The chevron, the icon and the body are all sized in `em`, never px or rem: they
follow the chat text size the reader set, which is the one thing the prose around a frame already
does.

**Every size inside a rendered shape or a carded surface is `em`, off five names**
`tailwind.config.js`'s `fontSize` declares: `md-body` (`1em` — every shape's body AND its own title;
a header is never smaller than what it heads), `md-meta` (`0.875em` — a shape's actions slot, a
numbered badge, a footnote chip), `md-code` (`0.875em` — `DiffBlock`'s own line font, its first
caller), `md-stat` (`1.75em` — a stat tile's figure, and nothing else), and `chat-tool`
(`calc(var(--chat-font-size, 1rem) * 0.875)` — the base size of a tool's own markdown body, the same
ratio `prose-sm` drew at the default 16px, now following the setting instead of a fixed px).
**Why `em`.** The anchor is the reader's own size: `ChatMessagesPane.tsx` sets `--chat-font-size` on
`.chat-messages-pane`, and `TRANSCRIPT_PROSE` (`Markdown.tsx`) applies it to the prose container as
`text-[length:var(--chat-font-size,1rem)]`. A relative unit is what lets one scale ride that
setting, and it reaches a frame even though the frame wears `not-prose`: Typography's element rules
stop at that class, but font-size still inherits, so `1em` inside a frame IS the chat size. **The
compounding rule** follows from the unit — an `md-*` size goes on a text leaf, or on a frame's header
and body wrappers, and never on a container that holds another sized element, where it would
multiply. `ShapeFrame` writes `data-text-scale="flow"` on every frame's root so a probe can confirm
the scale is in force. `MarkdownContent.tsx` (every tool markdown body — see
[tool views](./06-tool-view.md) §"Content renderers") carries `text-chat-tool` beside its existing
`prose-sm`, and `markdownCards.css`'s R5, R11, R12 and R17 (§"Element cards") spell `md-meta` and
`md-body` where they spelled `text-xs`/`text-sm` before.

**A `@/shared/ui` library piece a shape composes follows the same scale, through two custom
properties rather than a `text-md-*` class.** `tokens.css`'s `[data-text-scale="flow"]` rule sets
`--vv-text-body: 1em` and `--vv-text-meta: .875em` on the frame's own root — the one element that
carries `data-text-scale="flow"` — and `Badge`, `Chip`, `Meter`, `Banner` and `Tabs`' (both its
filled and underline registers) `font-size` in `verve/controls.css` and `verve/feedback.css` read
`var(--vv-text-meta, <its old px>)` or, for `Banner`, `var(--vv-text-body, <its old px>)`, rather
than the literal alone. A
`Chip` or a `Badge` a shape composes therefore follows the reader's chat text size like the rest of
the frame; the same component built bare — Settings' own `Badge`, say — finds no custom property on
any ancestor and keeps the px it always had. `phase-34.mjs`'s `T4` reads the framed case and `T6`
pins eight bare library class strings' literal size as a ratchet, so a later change to one of those
literals is a deliberate, measured one. The library's own side of the contract is
[verve/README.md](../../src/shared/ui/verve/README.md) rule 7.

**`cn()` has to be told the five names are sizes, not colours.** `tailwind-merge` reads an unknown
`text-<name>` utility as a text COLOUR by default, so an unextended merger answers `cn('text-md-body',
'text-foreground')` with the colour alone: the class list still builds and no type error says so, the
element just quietly stops following the reader's chat text size. `src/shared/utils.ts` builds `cn`'s
merger through `extendTailwindMerge` rather than importing `twMerge` directly, registering `md-body`,
`md-meta`, `md-code`, `md-stat` and `chat-tool` under the `font-size` class group so a later
`text-md-body` really does replace an earlier one. See that file's own header comment for the failure
this avoids.

**Motion is frames only, and an entrance is remembered by content the way a fold is.** The
transcript's entrances are one stylesheet, `shapes/shapeMotion.css`, side-effect imported by
`Markdown.tsx` directly after `markdownCards.css`, and every rule in it sits inside ONE
`@media screen and (prefers-reduced-motion: no-preference)` block. Its trigger is the library marker
`data-vv-enter`, which `ShapeFrame` writes on a root only while the entrance memory says the reader
has never watched this card arrive — `hasEntered`/`markEntered` in `shapes/collapseState.ts`, a
page-lifetime `Set<string>` beside the fold map and keyed the same content-addressed way
(§"Collapse and export"). A mount is not an arrival: `LazyMessageRow` unmounts a row as it scrolls
away and a streaming retraction remounts a settled block, so without that memory every scroll back
would replay every card. Three rules carry it. `M1` — the frame itself rises once on
`animate-shape-rise`, Tailwind's `vv-rise var(--dur-move) var(--ease-enter) both` with its fill mode
overridden to `backwards`. `M2` — the rows, the loose list items and the stat tiles inside it follow
on `animate-shape-item`, Tailwind's `vv-pagein 240ms var(--ease-enter) backwards`, and `M2b` gives
the second position a 30 ms step and each one after it another, so a table's rows cascade rather than
land together — the rule's own list is `tbody > tr`, a loose `li`, `[data-stat-tile]` and `.vv-card`,
and the stagger stops growing at 150 ms so the tail never runs past 390 ms. The
meter's grow-in is the library's own and lives in `tokens.css` beside its other keyframes:
`@keyframes vv-meter-grow` is a `from` frame only, because a meter's end state is its inline
`transform: scaleX(p)` and a `to` frame with a fill would pin every bar at full width, and its rule
`[data-vv-enter] .vv-meter__fill` sits inside the same reduced-motion query. Only `opacity` and
`transform` animate, and the budget is bounded: a frame ends at 350 ms, a meter at 350 ms, and the
last staggered item at 150 + 240 = 390 ms.

**Three answers the design turns on.** *Frames only, never an element card* — a plain list, a
quotation and the footnotes render identically in the streaming and the settled half and carry no
key, so an entrance on one would play while it streams and again when it settles, while a frame
exists only in the settled half; a streaming body draws no frame at all, so it carries no marker and
nothing to animate. *An export plays nothing*: `enter` is captured only while `interactive` is true,
so the static render carries no `data-vv-enter` and draws no animation (§"Collapse and export" holds
the whole export contract). *Reduced motion draws no rule at all* — the stylesheet and the meter's
rule beside it are both inside the query, so the card is simply there.

## Gotchas

- **The baseline artifact exists only in this working tree.** `.verify/` is git-ignored, and
  `.verify/artifacts/shapes-elements-baseline.html` is pinned to the PRE-MOVE renderer. A DOM
  change means the change is wrong, not the artifact: re-capturing from the current tree compares
  the new DOM with itself and can never fail again. How it was captured, and the only legitimate way
  to re-establish it, is in [verification.md](../verification.md).
- **`FILE_REF_SCAN` carries the `g` flag.** Use it only with `match`, `matchAll`, `replace` or
  `split`. `test` and `exec` keep `lastIndex` between calls, so a second identical `test` answers
  `false`, and a scan built on them drops every other hit without a sound.
- **A chip is a `<button>`, so four places suppress it.** `MarkdownLink`, `ShapeSection`'s heading,
  `DataTable`'s header row and `ShapeFrame`'s title row provide `ChipsSuppressedContext`, and
  `FileChip` then draws the plain text or code span it was handed. The title row is the fourth
  because a lead-in title is rendered markdown sitting inside the fold toggle; the frame provides
  the suppression around the whole span rather than letting a chip appear in one. Anything else that
  puts rendered markdown inside a control needs to provide it too, or one click fires two actions.
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
| `hasInlineFormatting` or `readFactPairs` | The tables probe's marked-up matrix still declines, and the prose probe's fact declines — marks in a value, and labels that are links or code spans — still keep their span and `href`. These are what stop a shape rendering less than the markdown |
| `DataTable`'s sort | It still permutes the RENDERED `tr` elements keyed by original index. The tables probe reads whole `(label, note, count, rank)` tuples with their `code` and `strong` inside, stability in both directions, the third click, the CSV order, and each bar travelling with its row |
| A `shapeKey` payload | Two kinds never share a payload shape, and `section` still includes the body — the groups probe folds two "Findings" sections apart |
| `isCollapsed`'s default | It stays expanded. A default of folded turns a 32-bit collision into content that disappears |
| `useShapeCollapse` or `useShapeInteractive` | The tables, fences and groups probes' export mounts still draw every shape whole with zero controls, and a fold still survives its row remounting |
| `data-vv-enter`, `shapeMotion.css`'s selectors, or `hasEntered`/`markEntered` | `phase-34.mjs`'s `M` gates: a first settled mount carries the marker and plays the rise, a later mount of the same content carries neither, and reduced motion draws no rule at all |
| `LeadIn`, `LeadInTitleContext`, or the rung predicates it asks (`tableRung`/`listRung`) | `phase-34.mjs`'s `L` gates: three list frames titled from their own line, a table no rung claimed left with its paragraph above it, and a link inside a lead-in title still folding from the chevron alone. `LeadIn` asks the SAME predicates the ladders use, so a rung answered two ways loses a paragraph or gives a table a second frame |
| `EmbedFrame`, or `WidgetFrame`'s `frame` prop | `phase-34.mjs`'s `E` gates: a settled widget and a DocSpace fence wear the card header, an export and a streaming fence draw their raw source and no frame, and the DocSpace action points at the studio ([live widgets](./07-live-widgets.md) §"The DocSpace kind") |
| `ShapeFrame`'s markers | Every probe finds shapes by `data-shape`, `data-collapsed` and `data-shape-toggle`; a title and a body are read by `data-shape-title` and `data-shape-body`, a header by `data-shape-header`, its icon by `data-shape-icon`, its actions by `data-shape-actions`, and the scale itself by `data-text-scale`. Rename one and gates that never read this source go quiet |
| A new `ShapeKind`, or a kind's icon/tone in `SHAPE_KINDS` | Adding a kind with no `SHAPE_KINDS` entry is a type error at the call site, but the icon's existence in the installed `lucide-react` is not type-checked — confirm the import resolves before shipping |
| A new named size in `tailwind.config.js`'s `fontSize`, or the `chat-tool` ratio | `src/shared/utils.ts`'s `extendTailwindMerge` list names every `text-<name>` this app spends as a font size; a size added there and not to that list is read as a text COLOUR by `cn()`'s merger and silently stops following the reader's setting (§"Header, type and motion") |
| A new `font-size` in `verve/controls.css` or `verve/feedback.css` | If a shape may compose that piece inside its frame, wrap the literal in `var(--vv-text-meta, <literal>)` or `var(--vv-text-body, <literal>)`, the way `Badge`, `Chip`, `Meter` and `Banner` already do; left a bare literal, it silently ignores `data-text-scale="flow"` and the reader's chat text size (§"Header, type and motion") |
| `isLeadInText` or the lead-in pass's target test | `probe-shapes-detect.mjs` carries the grammar's six cases, and `phase-33.mjs`'s gallery declares the `list` kind the pass produces. A rule that accepts more titles a paragraph the author wrote as a sentence |
| The `[data-shape="list"]` exclusion in `markdownCards.css` | `probe-markdown-cards.mjs`'s plain-card lists stay plain, and `phase-33.mjs` finds a card under every heading — the exclusion must name one kind and never `[data-shape]` bare |
| `SECTION_FLOW` | The groups probe's layout gate: every block within half a pixel of its unsectioned position, the opening heading flush, the reply's height unchanged |
| `NEVER_TABBED` in `remarkShapeGroups` | A widget in a run of fences still mounts its live frame, and a `diff` beside a code fence stays its own shape — both are groups probe near misses |
| `CodeFence`'s order, its streaming return, or its export branch | The fences probe: both mermaid fences wear `data-shape="diagram"`, a malformed `stats` fence keeps every line, and the streaming mount draws no shape and no svg. The groups probe's export mount: the mermaid fence comes out as its source inside its `diagram` frame. `useShapeInteractive` stays above the streaming return, so every render calls the same hooks |
| `MermaidDiagram`'s render id | The gallery, `phase-32.mjs`, knows a diagram drew only by the `mermaid-` prefix on the svg id `MermaidDiagram` gives each render. Change the prefix and its four live-diagram lines redden with the diagram on screen |
| `LONG_OUTPUT_LINES` or `LONG_OUTPUT_PREVIEW_LINES` | The fences probe's 25-line fence stays whole and its 26-line fence clamps, and `probe-shapes-detect.mjs` pins the pair at 25 and 12 |
| `parseFileRef`, `FILE_REF_SCAN` or `MarkdownLink`'s policy | The inline probe: no chip in a URL, time, version or npm scope; every link that opened in the Files tab still does; the scan's cost ceiling. The whole-text parser and the scanner are built from the same fragments and are meant to agree; today they differ on one case only, a path holding `//` (see **The triggers**), so a change to either must say which way that case goes — and an absolute path and a dotfile are cases they now AGREE on, which is what a change must not undo |
| `ChipsSuppressedContext` or where it is provided | The inline probe's backticked path in a link, a section heading and a sortable header stays today's code span, and React logs no nested-control warning |
| `openFileReference`'s signature, or the file-manager chain behind it | `probe-shapes-lineopen.mjs` end to end, and the inline probe's click that must land on the target row |
| `surface-signal.ts` | `WIDGET_SIGNAL`'s bytes are another session's and move unchanged, and `MARKDOWN_SIGNAL` names only conventions `detect.ts` really implements. It costs tokens on every turn |
| A shape string | It exists under `shapes` in all eleven `chat.json` files. `MermaidDiagram`'s string is `common.shapes.diagramFailed`, because that component is shared with the PRD editor |
| Where `Timeline` or `StatTiles` live | They move to `src/shared/ui/` only when a second module uses one, and never into `src/shared/ui/verve/`, which holds stylesheets and nothing else |
| `markdownCards.css`, or the scope class its selectors spell | `probe-markdown-cards.mjs`: G2 reads the frame, G4 the badges and G7 the `.not-prose` exclusion back off the document, G1 proves the class moved no DOM and G15 that no margin moved. That probe spells `chat-md-cards` as a literal it cannot be told to rename, so renaming the class reddens it until the file is edited too |
| `PlainList`'s or `PlainRule`'s class string | On a carded surface `markdownCards.css` overrides it by specificity, so run `probe-markdown-cards.mjs` as well as `probe-shapes-baseline.mjs`: the baseline compares the class string on a body that carries no cards, and cannot see the carded surface losing it |
