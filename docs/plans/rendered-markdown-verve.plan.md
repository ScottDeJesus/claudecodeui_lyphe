# Rendered markdown, alive: Verve headers, colour accents, one text scale, motion, lead-in titles and framed embeds

## INTENT LOCK

**ORIGINAL REQUEST** (the operator's own words, verbatim):
> After Iris is done please dispatch her to stylize all of these in our Verve style, with color accents, and bring it to life with animations if possible. Actually we might need to create a plan for it. Bring everything to life with animations. Coloring has to be applied. They just look so bland and boring.
> I think you're also missing embedded DocSpace or embedded Arc pulse. Can you show me what that looks like? I know we worked on a feature for that and the fact that you're hiding it from me means that it probably doesn't work. The fact that you didn't even say anything about it tells me more that it probably doesn't work.
> - Bring these cards to life to make everything look good.
> - Make sure that the text is uniform throughout, such that I can adjust it when I adjust my chat text size inside of the Settings and Appearance tab. The HTML text sizes also change in relation so if the header is bigger it should be bigger but I'm seeing the headers or the names of the table are significantly smaller than its contents. That doesn't make sense.
> - Everything should be standardized and everything should be modular.
> Let's make sure we plan that. We'll do a full plan pass with /mentor

His follow-up in the same conversation, verbatim:
> How is it parsing the Markdown file? Is it a script? You're saying a style sheet cannot read a colon. Yes that's correct but how are you parsing the fact that there are bullets, because a style sheet can also not read a bullet? How are we parsing the Markdown? If we're using a script then we can simply look above the bullet and see if there's a colon and bring that into the card to make it a header. Similarly if the line above it is bold, we can bring it into the card to make a header.

Earlier in the same conversation, verbatim:
> Looks great. Is it all a part of the proper Verve styling that we already have implemented in this entire project?

**THIS PLAN DELIVERS:**
Every card that CloudCLI's chat draws from markdown is restyled. That covers tables, bulleted and numbered lists, callouts, task lists, check results, timelines, fact cards, verdicts, stat tiles, diffs, code tabs, diagrams, the embedded DocSpace block and the HTML widget. All of them get one standard Verve header: an icon for the kind of card, a title and a colour accent. Structural cards get a soft green header and a green icon. Callouts, verdicts and check results take Verve's meaning colours instead: amber for a warning, red for a failure, green for a pass. Tables get a tinted header row, the sorted column turns green, and rows tint on hover.

The markdown is parsed by a script: react-markdown with remark plugins, and one of those plugins already groups blocks. That plugin now looks at the line above a list or a table. When that line ends in a colon or is wholly bold, it becomes the card's header, kept exactly as written, colon included. A long sentence (over 120 characters) stays a sentence. While a reply is still streaming, the line stays where it is; it moves into the card once that part of the reply has settled.

Text follows the Appearance chat text size everywhere in these cards: every title, table header, label and body text. No header or label is ever smaller than the text under it. Counts, badges, timestamps, language tags and code sit at 7/8 of the body size. Markdown tool output also follows the setting at 7/8 of the chat size, which is exactly today's size at the default of 16px. That covers a subagent's final answer, the plan display and markdown tool results.

Cards come to life with motion. Each card rises in as it appears, its rows and items follow in a short stagger, and bar meters grow from zero. It all finishes within 400 ms, and it animates only movement and fade. Nothing animates while a reply is still being written, in an exported transcript, or when the device asks for reduced motion. A card rises the first time it appears in the page. Scrolling back to it does not replay it. Plain lists with no header line, quotations and footnotes are coloured but do not animate. They look the same while streaming and after they settle, so an entrance would replay every time a block settled.

Embedded DocSpace works today. It was measured before this plan was written: the embed probes pass 17 of 17 and 12 of 12, and a real embedded block already appeared earlier in this conversation. The embed gains the standard card header with an "Open in ArchPulse" link, and the HTML widget gains the header too. An exported transcript still carries the embed's source, unframed.

Links change from blue to Verve's green ink with a subtle underline. Code blocks lose their off-palette dark background, and their "copied" tick turns green.

"Standardized and modular" means:
- one header component that every card wears;
- one table of card kind → icon and colour;
- four named text sizes in the Tailwind config;
- one size swap in Verve's own tokens, which the library pieces inside a card read, and one motion stylesheet beside the cards stylesheet.

The proof is a new standing browser probe, `.verify/phase-34.mjs`. The whole-reply gallery screenshots in `.verify/phase-33.mjs` also gain a header-line list, an HTML widget and a DocSpace embed. Scott's own message bubbles keep no element cards, as today. A colon line above a list in one of them becomes its title, like every other shape they already draw.

**OPERATOR VERDICT:** CONFIRMED — 2026-09-14 — Scott: "Okay sounds good. Yep let's do that and then if there are no outstanding questions just run it. Give it my stamp."

## Runner

```toml
plan_format = 2
cwd = "/home/lyphe/.claude/claudecodeui_lyphe"
add_dirs = []

[budget]
max_cycles = 40
max_spawns = 160
max_fix_passes = 3
max_attempts = 2
max_replans = 6
```

## Interfaces

Every path is relative to `/home/lyphe/.claude/claudecodeui_lyphe`. `T/` abbreviates `src/modules/chat/transcript/` in this section only; write the full path in code.

**I1. The text scale — four named sizes and one anchor, all in `tailwind.config.js`.**

Insert a `fontSize` key into `theme.extend`, directly after the `fontFamily` block that closes at `tailwind.config.js:20`:

```js
fontSize: {
  'md-body': '1em',
  'md-meta': '0.875em',
  'md-code': '0.875em',
  'md-stat': '1.75em',
  'chat-tool': 'calc(var(--chat-font-size, 1rem) * 0.875)',
},
```

| Class | Role — use it for exactly these |
| --- | --- |
| `text-md-body` | All content, AND every title, header, label, `th`, `dt`, stat label. A header is never smaller than what it heads. |
| `text-md-meta` | Counts, deltas, timestamps, badges, chips, pills, language tags, controls ("Show all N lines", the actions slot). |
| `text-md-code` | Monospace block text (diff lines). |
| `text-md-stat` | The stat tile's value, and nothing else. |
| `text-chat-tool` | The base size of markdown tool bodies (`MarkdownContent`), 7/8 of the chat setting. |

- The sizes are `em`, relative to the surface they sit in. The anchor is unchanged: `ChatMessagesPane.tsx:281` sets `--chat-font-size` on `.chat-messages-pane`, and `TRANSCRIPT_PROSE` (`T/Markdown.tsx:181`, `text-[length:var(--chat-font-size,1rem)]`) applies it to the prose container.
- A block shape's frame wears `not-prose`, which stops Typography's element rules, but font-size still inherits. `1em` inside a frame is the chat size.
- **Compounding rule.** Put `md-*` sizes on text leaves and on the frame's header and body wrappers only. Never put `text-md-meta` or `text-md-code` on a container that holds another sized element.
- **tailwind-merge.** `cn` (`src/shared/utils.ts:22-23`) runs `twMerge`. tailwind-merge 3 reads an unknown `text-<name>` as a text COLOUR, so `cn('text-md-body', 'text-foreground')` would silently drop the size. `src/shared/utils.ts` therefore builds its merger with `extendTailwindMerge` from `tailwind-merge`: `extend.classGroups['font-size'] = [{ text: ['md-body', 'md-meta', 'md-code', 'md-stat', 'chat-tool'] }]`. `cn`'s signature is unchanged.

**I2. `ShapeFrame` — the one header every framed card wears (`T/shapes/ShapeFrame.tsx`, 77 lines today).**

```ts
type ShapeKind =
  | 'table' | 'data-bars' | 'decision-matrix' | 'before-after' | 'callout' | 'tasks' | 'checks'
  | 'timeline' | 'facts' | 'verdict' | 'stats' | 'diff' | 'tabbed-code' | 'diagram'
  | 'list' | 'widget' | 'docspace';

type ShapeFrameProps = {
  kind: ShapeKind;
  title: ReactNode;          // was string
  collapseKey: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: Tone;               // overrides the kind's registry tone (Callout, VerdictBanner, CheckResults)
  icon?: LucideIcon;         // overrides the kind's registry icon (Callout, per alert kind)
  prose?: boolean;           // true: the root omits `not-prose` — LeadIn's plain list only
  flush?: boolean;           // true: the body has no padding — EmbedFrame only
};
```

- `Tone` is `import type { Tone } from '@/shared/types'`, and `LucideIcon` is `import type { LucideIcon } from 'lucide-react'`.
- `ShapeKind` and the registry below live in `ShapeFrame.tsx`, unexported. Callers pass string literals, so no second file names the type. `.agents/skills/frontend-module-standards/SKILL.md:76` says: "Define a type directly in its sole owning component or implementation file when only that file uses it."

The registry, `SHAPE_KINDS: Record<ShapeKind, { icon: LucideIcon; tone: Tone | 'accent' }>`:

| kind | icon | tone | | kind | icon | tone |
| --- | --- | --- | --- | --- | --- | --- |
| table | `Table2` | accent | | facts | `Rows3` | accent |
| data-bars | `ChartColumn` | accent | | verdict | `Gavel` | positive |
| decision-matrix | `Scale` | accent | | stats | `Gauge` | accent |
| before-after | `GitCompareArrows` | accent | | diff | `FileDiff` | accent |
| callout | `Info` | info | | tabbed-code | `CodeXml` | accent |
| tasks | `ListChecks` | accent | | diagram | `Workflow` | accent |
| checks | `CircleCheckBig` | positive | | list | `List` | accent |
| timeline | `Clock` | accent | | widget | `AppWindow` | accent |
| | | | | docspace | `LayoutPanelTop` | accent |

Every icon name above was confirmed to exist in the installed `lucide-react` 0.515 type declarations. `BarChart3` and `Code2` do NOT exist there.

**Effective tone.** It is `tone ?? SHAPE_KINDS[kind].tone`. **Effective title** is `useContext(LeadInTitleContext) ?? title` (I3). ShapeFrame then provides `LeadInTitleContext` with the value `null` around its body, so no nested frame can take the title.

**DOM contract.** Probes select on these markers; every name is load-bearing.

| Element | Markers | className |
| --- | --- | --- |
| root | `data-shape={kind}`, `data-collapsed`, `data-text-scale="flow"` (Phase 4), `data-vv-enter=""` **only when `enter`** (Phase 6) | `cn('my-3 overflow-hidden rounded-xl border border-border bg-card/50 shadow-sm', !prose && 'not-prose', className)` |
| header row | `data-shape-header`, and `data-tone={effective tone}` **only when it is not `'accent'`**, so the tone reaches the header and nothing in the body | `flex items-center gap-2 px-3 py-2 text-md-body text-muted-foreground` plus the wash: accent → `bg-primary/[0.06]`, toned → `bg-[color:var(--tone-soft)]` |
| trigger (interactive) | `data-shape-toggle` (unchanged) | today's trigger classes, unchanged; it holds chevron, icon, title in that order |
| chevron | — | `h-[1em] w-[1em] flex-shrink-0 transition-transform duration-200` (was `h-3.5 w-3.5`) |
| icon | `data-shape-icon`, `aria-hidden="true"` | `h-[1.125em] w-[1.125em] shrink-0` plus accent → `text-accent-ink`, toned → `text-[color:var(--tone-ink)]` |
| title | `data-shape-title` | `min-w-0 flex-1 break-words font-semibold` plus accent → `text-foreground`, toned → `text-[color:var(--tone-ink)]`. Its content is wrapped in `<ChipsSuppressedContext.Provider value={true}>` (`T/shapes/chipContext.ts:24`), because the title sits inside a button. `truncate` is gone: a lead-in title wraps, it is never cut. |
| actions | `data-shape-actions` | `flex flex-shrink-0 items-center gap-1 text-md-meta` |
| body | `data-shape-body` | `border-t border-border/70 text-md-body text-foreground`, plus `px-3 py-2` unless `flush`, plus `[&>*:first-child]:mt-0 [&>*:last-child]:mb-0` when `prose` |

- **Non-interactive (export) form.** Icon, then title, then no chevron. The title is the same `data-shape-title` span.
- **Callers.** The thirteen `ShapeFrame` callers keep their `kind` and `title` arguments. Only Callout, VerdictBanner and CheckResults add `tone` (and Callout adds `icon`) in Phase 5.

**I3. Lead-in titles — the line above a list or a table becomes its header.**

- **Grammar**, `T/shapes/detect/prose.ts` (33 lines today):
  - `export const LEAD_IN_MAX_CHARS = 120;`
  - `export function isLeadInText(text: string, wholeBold: boolean): boolean` returns true iff all of these hold:
    1. `text` contains no `\n`;
    2. `text.trim().length` is between 1 and `LEAD_IN_MAX_CHARS` inclusive;
    3. `text.trimEnd().endsWith(':')` OR `wholeBold`.
  - Barrel `T/shapes/detect.ts` re-exports both names. Its header comment's `prose` family gains the words "lead-in line" (`detect.ts:7` today reads "`prose` (alert kind, verdict)").
- **Plugin pass**, `T/shapes/remarkShapeGroups.ts` (173 lines today):
  - `MdastNode` (`:35-43`) gains `value?: string`.
  - New unexported `function groupLeadIns(nodes: MdastNode[]): MdastNode[]` walks the given array once. At index `i`, when `nodes[i].type === 'paragraph'`, `nodes[i + 1]?.type` is `'list'` or `'table'`, and the paragraph qualifies, it emits `{ type: 'shapeLeadIn', data: { hName: 'div', hProperties: { 'data-shape': 'lead-in' } }, children: [nodes[i], nodes[i + 1]] }` and skips both nodes. Otherwise it copies the node.
  - **Qualifies.** Let `meaningful` be the paragraph's children minus `text` nodes whose `value` is whitespace only.
    - `wholeBold` is true when `meaningful` is exactly one `strong`, OR exactly a `strong` followed by a `text` whose trimmed `value` is `:`.
    - `text` concatenates the paragraph's subtree depth-first: `text` and `inlineCode` nodes give their `value`, and `break` gives `\n`.
    - It qualifies iff `isLeadInText(text, wholeBold)`.
  - The exported plugin's body becomes `tree.children = groupSections(groupLeadIns(groupTabbedCode(tree.children as MdastNode[])));`. Lead-ins run before sections, so a pair written under a heading is grouped before `groupSections` nests it.
  - The pass walks root children only, like the two passes before it. A pair inside a list item or a blockquote is never grouped.
- **Routing**, `T/shapes/elements/plain.tsx` `ShapeDiv` (`:91-96`) gains one branch: `if (shape === 'lead-in') return <LeadIn node={props.node}>{props.children}</LeadIn>;`.
- **Context**, `T/shapes/leadInContext.ts` (new):
  - `export const LeadInTitleContext = createContext<ReactNode>(null);`
  - A consumer comment names LeadIn (provider) and ShapeFrame (consumer).
  - It follows the local precedent of `chipContext.ts` and `listNesting.ts`.
- **Rung predicates** — the ladders' own decisions, moved out so LeadIn asks the same question the element asks:
  - **`T/shapes/tableData.ts`**: `export function tableRung(node: HastNode | undefined): 'decision-matrix' | 'before-after' | 'data-bars' | 'table' | 'none'`.
    - It returns `'none'` exactly when `ShapeTable` (`T/shapes/elements/table.tsx:78-103`) renders `PlainTable`: no readable table (`:80`), or a decision matrix or before/after pair declined by `hasInlineFormatting` (`:86`).
    - Otherwise it returns the kind `ShapeTable` draws, with `classifyTable`'s sortable-table result named `'table'`.
    - `ShapeTable` is rewritten to switch on `tableRung(node)`, with behaviour unchanged.
  - **`T/shapes/listItems.ts`**: `export function listRung(node: HastNode): 'tasks' | 'checks' | 'timeline' | 'none'`.
    - Its conditions are moved verbatim from `ShapeList`: tasks `list.tsx:147`, checks `:160`, timeline `:174`.
    - `listItemNodes` and `ownCheckbox` move with them from `list.tsx:47,71`, as a pure move. Export them only if `list.tsx` still calls them.
    - `ShapeList` keeps its `insideList` and no-items gates, then switches on `listRung(node)`, with behaviour unchanged.
- **`T/shapes/LeadIn.tsx`** (new, ≤ 120 lines): `export function LeadIn({ node, children }: { node?: HastNode; children?: ReactNode })`.
  1. `const elements = Children.toArray(children).filter(isValidElement)`, and `const hastElements = (node?.children ?? []).filter((child) => child.type === 'element')`. If `elements.length !== 2` or `hastElements.length !== 2`, return `<>{children}</>` — the author's words are never lost.
  2. `title = (elements[0].props as { children?: ReactNode }).children`, and `titleText = textOf(hastElements[0]).trim()` (`T/shapes/hast.ts:33`).
  3. `target = hastElements[1]`. The rung is `tableRung(target)` when `target.tagName === 'table'`, else `listRung(target)`.
  4. Rung is not `'none'` → return `<LeadInTitleContext.Provider value={title}>{elements[1]}</LeadInTitleContext.Provider>`. The shape's own ShapeFrame shows the title, and its collapse key is unchanged.
  5. Rung is `'none'` and the target is a table → return `<>{children}</>`: the paragraph stays above today's table, which draws no frame of its own. A declined matrix is rare, and a second frame spelling `data-shape="table"` would not be sortable.
  6. Rung is `'none'` and the target is a list → return `<ShapeFrame kind="list" prose title={title} collapseKey={shapeKey('list', titleText + '\n' + readListItems(target).map((item) => item.text).join('\n'))}>{elements[1]}</ShapeFrame>`.
- **Card CSS**, `T/markdownCards.css`. The list-frame rule is R1 today, `:13-15`, selector `.chat-md-cards :is(ul, ol):not(li *, blockquote *, section.footnotes *, .not-prose, .not-prose *):not(:has(input[type='checkbox']))`. `[data-shape="list"] *` is added inside its FIRST `:not(…)` list. No other card rule changes in Phase 3. The gutter, pill, marker and title rules still paint a lead-in list; only its own frame is withheld, because the ShapeFrame is the frame.

**I4. Shape bodies — sizes and colour inside the frames (Phase 5).** Line numbers are today's. Each literal is replaced in place, and every other class on that element stays.

| File | Today | Becomes |
| --- | --- | --- |
| `T/shapes/DataTable.tsx` (292 lines) | `<table className="my-0 min-w-full border-collapse text-sm">` `:214` | `text-sm` → `text-md-body` |
| same | header row fill `bg-muted/60` `:215` | `bg-primary/[0.05]` |
| same | every `th` (`:242` area) | adds `font-semibold text-foreground`; the `th` of the ACTIVE sort column carries `text-accent-ink` instead of `text-foreground` |
| same | every body `tr` | adds `hover:bg-primary/[0.04]` |
| `T/shapes/FactCard.tsx` | `dt` `text-xs` `:54` (muted ink) | `text-md-body font-semibold text-accent-ink` (the muted-ink class is removed) |
| same | `dd` `text-sm` `:58` | `text-md-body` |
| `T/shapes/DecisionMatrix.tsx` | labels `text-[11px]` `:64,75,89,98` | `text-md-body font-semibold` (their colour classes stay) |
| same | values `text-sm` `:69,93,102` | `text-md-body` |
| `T/shapes/BeforeAfter.tsx` | labels `text-[11px]` `:47,58,69` | `text-md-body font-semibold` |
| same | values `text-sm` `:51,62,74` | `text-md-body` |
| `T/shapes/StatTiles.tsx` | label `text-[11px]` `:58` | `text-md-body font-medium` |
| same | value `text-3xl` `:64` | `text-md-stat` |
| same | delta `text-xs` `:72` | `text-md-meta` |
| `T/shapes/Timeline.tsx` | dot `bg-muted-foreground` `:60` | `bg-accent-ink` |
| same | time token `text-xs` `:63` | `text-md-meta font-semibold text-accent-ink` (its muted-ink class is removed) |
| same | entry `text-sm` `:68` | `text-md-body` |
| `T/shapes/VerdictBanner.tsx` | verdict word `text-base` `:92` | `text-md-body`; its `ShapeFrame` (`:82`) gains `tone={verdict === 'PASS' ? 'positive' : 'danger'}` |
| `T/shapes/CheckResults.tsx` | `ShapeFrame` `:52` | gains `tone={<any failed item> ? 'danger' : 'positive'}`, using the same fail count its danger `Chip` (`:57`) already reads |
| `T/shapes/Callout.tsx` | `ShapeFrame` `:53` | gains `tone={TONE_BY_KIND[kind]}` and `icon={ICON_BY_KIND[kind]}`, a new constant in this file: note `Info`, tip `Lightbulb`, important `MessageSquareWarning`, warning `TriangleAlert`, caution `OctagonAlert` |
| `T/shapes/DiffBlock.tsx` | `text-[0.8125rem]` `:110` | `text-md-code` |
| `T/shapes/LongOutput.tsx` | `text-xs` `:90` | `text-md-meta` |

- **`DataTable.tsx` must stay ≤ 300 lines.** If the edits cross that, move the header row's rendering into `T/shapes/DataTableHead.tsx` as a pure move (same DOM, same props it already reads) and import it.
- **Why the Timeline dot is `bg-accent-ink`, not `bg-primary`.** The accent fill measures 2.81:1 on the light canvas, under the 3:1 graphics floor (`src/shared/ui/verve/README.md:122-123`). DESIGN_DOCTRINE §6 says "Dots take the ink or the mark".

**I5. Library pieces inside a frame, and the card and tool-body sizes (Phases 4–5).**

- **The size swap — `src/shared/ui/verve/tokens.css` (Phase 5).**
  - Beside the five `[data-tone]` rules (`tokens.css:198-202` when scouted), add one rule with a one-line comment above it: `[data-text-scale="flow"]{--vv-text-body:1em;--vv-text-meta:.875em}`.
  - It is the tone swap's pattern applied to size (`~/.claude/design/DESIGN_DOCTRINE.md` §5): a container sets inherited custom properties, and the library reads them.
  - An unregistered custom property holding `em` resolves at the element that READS it. A Chip reading `.875em` is 7/8 of its own parent's size, and inside a frame that is the chat size.
- **The frame opts in.** `ShapeFrame`'s root writes `data-text-scale="flow"` (I2, Phase 4).
- **The library reads its token, in place (Phase 5).** Each declaration below changes its VALUE only, on its own line. The selector, every other declaration and the file's line count stay. Match by selector: the line numbers in brackets are as scouted, and another session's finished edits may have moved them.

| # | File · selector (verbatim) | Today | Becomes |
| --- | --- | --- | --- |
| S1 | `feedback.css` · `.vv-banner` [:27-35] | `font-size: 13.5px` | `font-size: var(--vv-text-body, 13.5px)` |
| S2 | `feedback.css` · `.vv-banner__mark` [:38] | `font-size: 11px` | `font-size: var(--vv-text-meta, 11px)` |
| S3 | `feedback.css` · `.vv-banner__close` [:40-51] | `font-size: 11px` | `font-size: var(--vv-text-meta, 11px)` |
| S4 | `feedback.css` · `.vv-tabs__tab` [:103-117] | `font-size: 14px` | `font-size: var(--vv-text-meta, 14px)` |
| S5 | `feedback.css` · `.vv-tabs--underline .vv-tabs__tab` [:213-220] | `font-size: var(--text-small)` | `font-size: var(--vv-text-meta, var(--text-small))` |
| S6 | `controls.css` · `.vv-badge` [:72-85] | `font-size: 12.5px` | `font-size: var(--vv-text-meta, 12.5px)` |
| S7 | `controls.css` · `.vv-badge.vv-badge--compact` [:95] | `font-size: 10px` | `font-size: var(--vv-text-meta, 10px)` |
| S8 | `controls.css` · `.vv-chip` [:172-182] | `font-size: 13.5px` | `font-size: var(--vv-text-meta, 13.5px)` |
| S9 | `controls.css` · `.vv-chip--sm` [:200] | `font-size: 12.5px` | `font-size: var(--vv-text-meta, 12.5px)` |
| S10 | `controls.css` · `.vv-meter__label` [:329] | `font-size: 13px` | `font-size: var(--vv-text-meta, 13px)` |
| S11 | `controls.css` · `.vv-meter__value` [:330] | `font-size: 12.5px` | `font-size: var(--vv-text-meta, 12.5px)` |
| S12 | `controls.css` · `.vv-meter__sub` [:344] | `font-size: 12px` | `font-size: var(--vv-text-meta, 12px)` |
| S13 | `controls.css` · `.vv-meter--inline .vv-meter__label` [:349] | `font-size: 10.5px` | `font-size: var(--vv-text-meta, 10.5px)` |
| S14 | `controls.css` · `.vv-meter--inline .vv-meter__value` [:351] | `font-size: 10.5px` | `font-size: var(--vv-text-meta, 10.5px)` |

- **Totals, as Phase 5's check reads them:** `controls.css` carries 9 `var(--vv-text-meta,`; `feedback.css` carries 4 `var(--vv-text-meta,` and 1 `var(--vv-text-body,`.
- **Every other screen is unchanged.** Outside any `[data-text-scale]` both properties are unset, so every declaration takes its own fallback and computes today's size. Gate T6 compares bare library elements against `.verify/artifacts/verve-life-library-sizes.json`, which Phase 2 records before any library edit.
- **Why not a chat stylesheet.** `Banner`, `Meter` and `Tabs` accept no `className`, but they are reachable. What they lacked was a size setting, and DESIGN_DOCTRINE §10 says "Landing a library prop is part of a feature author's job". The Verve README's rule 3 allows a module stylesheet only "where a selector must reach markup no className can". A chat rule keyed on `.vv-meter__label` would make chat depend on library-internal class names; the library's public surface is its variant markers and `data-tone`.
- **`src/modules/chat/transcript/markdownCards.css`** size literals (Phase 4):
  - R5 (`:33-36`, the number pill), R11 (`:64-66`, the footnotes block) and R12 (`:72-74`, the footnote chip) each replace their `text-xs`/`text-sm` with `text-md-meta`.
  - One new rule, R17, is appended at the end of the file:
    - a one-line comment: `/* R17: a table outside a shape (the streaming half) takes the body size over PlainTable's text-sm. */`
    - the selector `.chat-md-cards table:not(.not-prose *)`
    - the declaration `@apply text-md-body;`
- **`src/modules/chat/tools/ContentRenderers/MarkdownContent.tsx`** (Phase 4):
  - The call `<Markdown className={cn(className, MARKDOWN_CARDS_CLASS)}>` becomes `<Markdown className={cn(className, MARKDOWN_CARDS_CLASS, 'text-chat-tool')}>`.
  - Its default prop and its three callers (`ToolRenderer.tsx:256`, `PlanDisplay.tsx:85`, `SubagentPanel.tsx:258`) are unchanged.
  - All three render inside `.chat-messages-pane` (ChatMessagesPane → LazyMessageRow → MessageComponent → ToolRenderer/SubagentPanel/PlanDisplay → MarkdownContent), so `--chat-font-size` reaches them.
  - At the default 16px the result is 14px, today's `prose-sm` size.

**I6. Motion (Phase 6).**

- **`tailwind.config.js` `theme.extend.animation`** gains exactly two entries. The `keyframes` key does not change:
  - `'shape-rise': 'vv-rise var(--dur-move) var(--ease-enter) both'`
  - `'shape-item': 'vv-pagein 240ms var(--ease-enter) backwards'`
  - `vv-rise` and `vv-pagein` already exist at `src/shared/ui/verve/tokens.css:157,160`; `--dur-move` is `.35s` (`:154`).
- **`src/shared/ui/verve/tokens.css`** gains, directly after its existing `@keyframes` lines (`:157-170` when scouted), in the file's own minified style:
  - A one-line comment: `/* vv-meter-grow has no to-frame: a meter's end state is its inline transform: scaleX(p) (Meter.tsx), and a to{transform:none} with fill would pin every bar at full width. */`
  - `@keyframes vv-meter-grow{from{transform:scaleX(0)}}`
  - `@media screen and (prefers-reduced-motion: no-preference){[data-vv-enter] .vv-meter__fill{animation:vv-meter-grow var(--dur-move) var(--ease-enter) backwards}}`
  - The meter's grow-in is Meter's own motion. Verve draws a grow-in (`vv-grow-x` in `design/CloudCLI Verve.dc.html:29-30`), and DESIGN_DOCTRINE §1 says "If Verve draws it, it is in the library."
- **`data-vv-enter`** is a library marker, like `data-tone`: an element carrying it plays its entrance.
- **The entrance is remembered by content, the way a fold is** (`docs/architecture/08-rendered-shapes.md` §"Mental model" rule 7).
  - `src/modules/chat/transcript/shapes/collapseState.ts` gains `export function hasEntered(key: string): boolean` and `export function markEntered(key: string): void`. They work over a module-level `Set<string>` beside the fold map. Nothing removes an entry; its comment says it lives for the page and grows by one key per card that rose.
  - `src/modules/chat/transcript/shapes/useShapeCollapse.ts`: the return type gains `enter: boolean`.
    - It is captured ONCE per mount, on the first render in which `interactive` is true: a `useRef<boolean | null>(null)` set to `!hasEntered(collapseKey)` at that render and never recomputed.
    - `useEffect(() => { if (interactive) markEntered(collapseKey); }, [interactive, collapseKey])` marks the key on commit, and marks every key the mount moves to.
    - In an export `interactive` is false, so `enter` is false.
  - **Why.** `LazyMessageRow` renders `{isMounted ? children : null}` and unmounts a row as it scrolls away (`src/modules/chat/transcript/LazyMessageRow.tsx:8-9,83`), and a streaming retraction remounts a settled block. A mount is not the moment a card first appears, so without this memory every scroll back would replay every card.
- **`ShapeFrame`'s root** carries `data-vv-enter=""` when `enter` is true, and no attribute otherwise.
- **`src/modules/chat/transcript/shapes/shapeMotion.css`** (new, ≤ 90 lines).
  - It is side-effect imported by `src/modules/chat/transcript/Markdown.tsx` directly after its `markdownCards.css` import (`Markdown.tsx:36`).
  - Every rule sits inside ONE `@media screen and (prefers-reduced-motion: no-preference) { … }` block, and every declaration is `@apply`.

| # | Selector | `@apply` |
| --- | --- | --- |
| M1 | `[data-vv-enter]` | `animate-shape-rise` |
| M2 | `[data-vv-enter] :is(tbody > tr, li:not(li li), [data-stat-tile], .vv-card)` | `animate-shape-item` |
| M2b | the M2 selector with `:nth-child(2)`, `:nth-child(3)`, `:nth-child(4)`, `:nth-child(5)`, `:nth-child(6)`, `:nth-child(n+7)` appended to each branch | `[animation-delay:30ms]`, `[animation-delay:60ms]`, `[animation-delay:90ms]`, `[animation-delay:120ms]`, `[animation-delay:150ms]`, `[animation-delay:150ms]` |

- The meter's rule (M3 in the gates) lives in `tokens.css`, above.
- **Budget.** A frame ends at 350 ms, a meter at 350 ms, and an item at 150 + 240 = 390 ms at most. Only `opacity` and `transform` are animated.

**I7. Framed embeds (Phase 7). The widgets module decides; the caller passes the frame in.**

- **`src/shared/types.ts`**, inside its existing `LIVE WIDGETS` group, gains two documented types. Two files use them (`.agents/skills/frontend-module-standards/SKILL.md`: "When two or more files use the same type, place it in `src/shared/types.ts`"). `import type { ReactNode } from 'react'` joins the file's imports if it is not already there.

```ts
/** A live embed's identity, handed to a caller's framer: which kind it is, and the studio link for a DocSpace block (null for an HTML widget). Built by WidgetFrame; read by the chat transcript's EmbedFrame. */
export type WidgetEmbed = { kind: 'html' | 'docspace'; studioUrl: string | null };
/** Wraps a LIVE embed. WidgetFrame calls it on its two live branches only, behind its mount and streaming gates, never for the source <pre> or the error card. Passed by the chat transcript's CodeBlock. */
export type WidgetEmbedFramer = (embed: WidgetEmbed, live: ReactNode) => ReactNode;
```

- **`src/modules/widgets/docspaceOrigin.ts`** gains `export function docspaceStudioUrl(pageId: string, blockId: string): string`.
  - It returns `` `${origin}/#page=${encodeURIComponent(pageId)}&block=${encodeURIComponent(blockId)}` ``, with `origin` resolved exactly as `docspaceEmbedUrl` (`:110-114`) resolves its own.
  - That URL is ArchPulse's studio deep link (`~/.claude/ArchPulse/README.md:21`).
  - Its consumer comment names `WidgetFrame`.
- **`src/modules/widgets/WidgetFrame.tsx`**: `WidgetFrame({ code, streaming, frame }: { code: string; streaming?: boolean; frame?: WidgetEmbedFramer })`.
  - The decision order is unchanged: classify, then `!mounted || streaming` → `<pre>`, then docspace, then `invalid` → `WidgetErrorCard`, then html.
  - **The docspace branch.** It becomes `const live = <DocSpaceFrame key={code} pageId={shape.ref.pageId} blockId={shape.ref.blockId} framed={Boolean(frame)} />;` then `return frame ? frame({ kind: 'docspace', studioUrl: docspaceStudioUrl(shape.ref.pageId, shape.ref.blockId) }, live) : live;`
  - **The html branch.** It becomes `const live = <WidgetFrameLive key={code} code={code} framed={Boolean(frame)} />;` then `return frame ? frame({ kind: 'html', studioUrl: null }, live) : live;`
  - `frame` is never called for the `<pre>` or for `WidgetErrorCard`, so an export (which never mounts) and a streaming fence stay raw source with no frame. `key={code}` stays on the inner element in both branches.
  - The fork comment at `WidgetFrame.tsx:84-88` gains one sentence: a caller's `frame` is applied behind both gates too, which is why it is a function passed in rather than a wrapper the caller draws.
  - With `framed` true, each live wrapper's className is `overflow-hidden bg-card` instead of `my-3 overflow-hidden rounded-xl border border-border bg-card` (`WidgetFrame.tsx:148`, `DocSpaceFrame.tsx:147`).
  - The `<pre>` fallback (`FALLBACK_CLASSES`, `:30-31`), `WidgetErrorCard`, the sandbox attributes and every timer are unchanged.
- **`src/modules/widgets/DocSpaceFrame.tsx`**: `DocSpaceFrame({ pageId, blockId, framed }: DocSpaceBlockRef & { framed?: boolean })`.
- **`src/modules/widgets/index.ts` is unchanged.** Chat never classifies a widget body itself.
- **`src/modules/chat/transcript/shapes/code/EmbedFrame.tsx`** (new, ≤ 80 lines): `export function EmbedFrame({ kind, studioUrl, code, children }: WidgetEmbed & { code: string; children: ReactNode })`.
  1. `shapeKind = kind === 'docspace' ? 'docspace' : 'widget'`, and `title = t(shapeKind === 'docspace' ? 'shapes.titles.docspace' : 'shapes.titles.widget')`, with `t` obtained the way `src/modules/chat/transcript/shapes/Callout.tsx` obtains it.
  2. `actions` exists only when `studioUrl` is non-null: `<a data-docspace-open href={studioUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent-ink hover:underline"><ExternalLink aria-hidden="true" className="h-[1em] w-[1em]" />{t('shapes.openInArchPulse')}</a>`.
  3. It returns `<ShapeFrame kind={shapeKind} title={title} flush collapseKey={shapeKey(shapeKind, code)} actions={actions}>{children}</ShapeFrame>`.
  4. It imports nothing from `@/modules/widgets`; its types come from `@/shared/types`.
- **`src/modules/chat/transcript/shapes/code/index.tsx`** (`:54-56`). The widget branch becomes `return <WidgetFrame code={raw} streaming={streaming} frame={(embed, live) => <EmbedFrame {...embed} code={raw}>{live}</EmbedFrame>} />;`
- **Folding.** `CollapsibleContent` keeps its children mounted when closed (`src/shared/ui/Collapsible.tsx:82-104`: a `grid-rows-[0fr]` track, never an unmount), so folding a DocSpace frame never reloads the iframe and never discards an unsaved edit.
- **i18n.** All eleven `src/modules/i18n/locales/*/chat.json` gain `shapes.titles.widget`, `shapes.titles.docspace` and `shapes.openInArchPulse`. English values: `Widget`, `DocSpace block`, `Open in ArchPulse`. The other ten are translated, with `DocSpace` and `ArchPulse` kept as product names.

**I8. Link and code-block re-tone, with the deliberate baseline widening (Phase 8).**

| File | Today | Becomes |
| --- | --- | --- |
| `T/shapes/MarkdownLink.tsx:70,84` | `text-blue-600 hover:underline dark:text-blue-400` | `text-accent-ink underline decoration-accent-ink/40 underline-offset-2 hover:decoration-accent-ink` |
| `T/shapes/code/CodeFence.tsx:116` (FenceBlock shell) | `… bg-muted/50 shadow-sm dark:bg-zinc-900` | `dark:bg-zinc-900` removed |
| `T/shapes/code/CodeFence.tsx:119` (language label) | `text-xs text-muted-foreground` | `text-md-meta text-muted-foreground` |
| `T/shapes/code/CodeFence.tsx:131` (copied tick) | `text-green-600 opacity-100 dark:text-green-500` | `text-accent-ink opacity-100` |
| `T/shapes/code/CodeFence.tsx:183` (highlighter style) | `fontSize: '0.8125rem'` | `fontSize: '0.875em'` |
| `src/modules/markdown-preview/MermaidDiagram.tsx` | carries `dark:bg-zinc-900` beside `bg-muted/50` | `dark:bg-zinc-900` removed (the drift `docs/architecture/07-live-widgets.md` §"Gotchas" records as OPEN) |

- **The sed script.** `.verify/artifacts/verve-life-retone.sed` holds one `s|<old>|<new>|g` line per class or style string in the table that the baseline document's DOM carries. Nothing else goes in it.
- **The widening is proven, not asserted.** Applying that sed script to the pre-change artifact copy must reproduce the re-captured artifact's DOM byte for byte, provenance comment lines aside.

**I9. The proof — `.verify/verve-life-compare.sh`, `.verify/lib/verve-life.mjs` and `.verify/phase-34.mjs`.**

**(a) `.verify/verve-life-compare.sh <script>` (Phase 1, ≤ 60 lines, bash).**
- `<script>` is a basename such as `phase-33.mjs`. The script runs the probe the way the probe's own usage line says: `npx --no-install tsx --tsconfig tsconfig.json .verify/<script>` when `.verify/<script>` holds a line starting `// Usage: npx --no-install tsx` (today only `probe-shapes-detect.mjs`, which loads app TypeScript through the tsconfig-only `@/` alias that bare `node` cannot resolve), otherwise `node .verify/<script>`; it writes stdout+stderr to `.verify/artifacts/verve-life-after/<script>.txt`, creating the directory.
- It keys every line starting `[FAIL]` in the after file AND in `.verify/artifacts/verve-life-before/<script>.txt`: the key is the text before the first ` — ` (space, em dash, space), or the whole line when there is none.
- It prints exactly one line:
  - `SAME-OR-BETTER <script>` when every after-key is among the before-keys;
  - `NEW-FAIL <script>: <first new key>` otherwise;
  - `NO-BEFORE <script>` when the before file is missing;
  - `NO-GATES <script>` when the after file holds no line starting `[PASS]` or `[FAIL]` (a probe that crashed before its first gate). `NO-BEFORE` is checked first.
- It always exits 0; the printed line is the verdict.
- Why it keys on gate lines rather than on a final PASS line: another session's in-flight work may already have a probe red before this plan starts, and this plan must not block on a red it did not cause, nor hide a red it did.

**(b) The fourteen recorded scripts.** `probe-shapes-baseline.mjs probe-shapes-detect.mjs probe-shapes-tables.mjs probe-shapes-lists.mjs probe-shapes-prose.mjs probe-shapes-groups.mjs probe-shapes-fences.mjs probe-shapes-inline.mjs probe-markdown-cards.mjs phase-22.mjs phase-28.mjs phase-29.mjs phase-32.mjs phase-33.mjs`. They run one at a time, never in parallel: every probe signs in as the one dev account (`docs/verification.md` §"What bites people").

**(c) `.verify/lib/verve-life.mjs` (Phase 2, ≤ 350 lines). It edits no other file in `.verify/lib/`.**
- `export const VERVE_DOCUMENT` — the markdown below, verbatim, as a template literal. Every backtick in it is escaped as `` \` `` inside the literal.
- `export async function setSurface(page, { fontPx })`:
  1. It reads `TRANSCRIPT_PROSE` out of `src/modules/chat/transcript/Markdown.tsx` with `fs` and the regex `/export const TRANSCRIPT_PROSE = '([^']+)'/`, the method `probe-markdown-cards.mjs` uses.
  2. It sets `#probe-shapes-body`'s className to `` `${TRANSCRIPT_PROSE} prose-gray chat-md-cards` ``.
  3. It sets `--chat-font-size` to `` `${fontPx}px` `` on `#probe-shapes-host`.
  4. It waits two `requestAnimationFrame`s, then every `document.getAnimations()` raced against a 400 ms cap, copying `.verify/probe-markdown-cards.mjs:125-148`.
- `export async function readRefs(page)` appends one hidden-from-flow `div#verve-life-ref` to `document.body` holding one element per class, reads each colour, then removes the div. It returns an object keyed by class string.
  - The classes: `bg-primary/[0.06]`, `bg-primary/[0.05]`, `bg-muted/50`, `bg-accent-ink`, `text-accent-ink`, `text-foreground`, `text-primary`.
  - Plus, inside a `[data-tone="warn"]` wrapper and again inside a `[data-tone="danger"]` wrapper: `bg-[color:var(--tone-soft)]` and `text-[color:var(--tone-ink)]`.
  - Every one of those classes appears in `src/` once Phases 4–5 ship, which is what makes Tailwind emit it.
- `export async function paintedPixel(page, selector, dx, dy)`:
  - It scrolls the element into view, takes `page.locator(selector).first().screenshot()`, and decodes it with `import { PNG } from 'pngjs'` (6.0.0 is installed).
  - It reads the pixel at `(dx, dy)` CSS pixels × `await page.evaluate(() => devicePixelRatio)` and returns `` `rgb(${r}, ${g}, ${b})` ``.
  - It throws when the element's box has zero width or height, because a fake measurement is worse than a missing one (`~/.claude/design/DESIGN_DOCTRINE.md` §7).
- `export { contrast } from './color.mjs';` — the existing `contrast(foreground, background)` at `.verify/lib/color.mjs:62`.
- `export async function animationsOf(page, selector)` returns, for every matching element in document order, `{ names, ends, delays, props }`:
  - `names` is each of `el.getAnimations()`'s `animationName`;
  - `ends` is each `effect.getComputedTiming().endTime` in ms;
  - `delays` is each `effect.getComputedTiming().delay`;
  - `props` is the union of keys of `effect.getKeyframes()` minus `offset`, `easing`, `composite` and `computedOffset`.

`VERVE_DOCUMENT`, verbatim:

~~~markdown
Root causes:
- the parser skipped the colon line
- the stylesheet could not read it

**Summary**

1. first step
2. second step

Results:

| Module | Owner | Status |
| --- | --- | --- |
| parser | Ada | done |
| cards | Lin | open |

The tasks:
- [x] write the probe
- [ ] ship the paint

A sentence that ends with a period.
* a plain carded list with no header line

An introduction that runs on for far longer than any header ever should, so that it reads as a sentence and never as a title, and it ends right here:
+ a long lead-in stays a paragraph

Fence after a colon:

```text
not a list
```

See `src/parser.ts:42` for the rule:
- a lead-in holding a file reference

| Endpoint | Latency |
| --- | --- |
| /a | 120 |
| /b | 340 |

Options:

| Option | Pros | Cons |
| --- | --- | --- |
| `fast` | quick | risky |

> [!WARNING]
> a toned callout

VERDICT: FAIL — B:1 H:0 M:2 L:0

**Uptime:** 99.9%
**Owner:** Ada

```stats
Requests | 1200 | +12%
Errors | 3 | -2
```

* ✓ the first check passes
* ✗ the second check fails

+ 09:30 the run starts
+ 10:15 the run ends

```widget
<div style="padding:12px">hello</div>
```

```widget
{"kind":"docspace","pageId":"page-probe-missing","blockId":"blk-probe-missing"}
```

Link to [the docs](https://example.com) and a fence follows.

```ts
const answer = 42;
```
~~~

**(d) `.verify/phase-34.mjs` (Phase 2, ≤ 450 lines).**

**Output contract.**
- One line per gate, `[PASS] <id> <text>` or `[FAIL] <id> <text> — <detail>`, for exactly the 41 ids below, printed in table order after every session has run (collect the results, then print).
- Then exactly one final line, `VERVE LIFE 34: all gates PASS` or `VERVE LIFE 34: a gate FAILED`; the exit code is 0 or 1.
- Screenshots go to `.verify/shots/phase-34-light.png` and `.verify/shots/phase-34-dark.png`: element shots of `#probe-shapes-body`, taken after `setSurface` has waited out animations.

**Structure, copied rather than invented.**
- Sessions, each a fresh `openConsole` (`.verify/lib/console.mjs:364`), in this order:
  - **A** light: every L and T gate, C1–C4 and C7, E1–E6, F1, the light half of F2, and X1.
  - **B** dark: C5, C6, F3 and the dark half of F2.
  - **C** light: M1, M2, M3, M4, M7, M8, then M5. M1–M3 are read on this session's FIRST settled mount.
  - **D** light with `page.emulateMedia({ reducedMotion: 'reduce' })` before its first mount: M6.
  - A fresh session is a fresh page, so the entrance memory starts empty. In a page that has already mounted the document, no frame carries `data-vv-enter`.
  - `report()` and exit handling follow `.verify/probe-markdown-cards.mjs:41-46,495`.
- Mount: `mountShapes(page, VERVE_DOCUMENT)` or `mountShapes(page, VERVE_DOCUMENT, { streaming: true })`, and `unmountShapes(page)` (`.verify/lib/shapes-fixture.mjs:158,246`).
- Every mount is followed by `setSurface(page, { fontPx: 16 })` unless a gate says otherwise. The M gates read BEFORE `setSurface`'s animation wait: they call `setSurface` only after their own read.
- Reduced motion is `page.emulateMedia({ reducedMotion: 'reduce' })`, restored with `'no-preference'`. No lib file is edited for it.
- "±0.5" means within 0.5 CSS px. "ratio" means `fontSize ÷ #probe-shapes-body fontSize`.

| id | Session | Passes when |
| --- | --- | --- |
| L1 | light | exactly 3 `[data-shape="list"]`; their `[data-shape-title]` trimmed textContents, in document order, are `Root causes:`, `Summary`, `See src/parser.ts:42 for the rule:` |
| L2 | light | no `p` in `#probe-shapes-body` has trimmed textContent equal to any L1 title, `Results:` or `The tasks:` |
| L3 | light | the `[data-shape="table"]` holding a `th` `Module` has title `Results:`; the `[data-shape="data-bars"]` title is `Table`; the `[data-shape="tasks"]` title is `The tasks:` |
| L4 | light | a `p` reading `A sentence that ends with a period.` exists, and its next element sibling is a `ul` with no `[data-shape]` ancestor; a `p` starting `An introduction that runs on` exists; a `p` reading `Fence after a colon:` exists |
| L5 | light | the list frame titled `See src/parser.ts:42…` has a `code` inside `[data-shape-title]` and zero `button[data-shape="chip"]` inside `[data-shape-title]` |
| L6 | light | the list frame titled `Summary` has a `strong` inside `[data-shape-title]` and an `ol` in its body |
| L7 | light | the first list frame's root lacks class `not-prose`; its `ul` computed `borderTopWidth` is `0px`; its first `li`'s `::marker` colour equals `readRefs()['text-accent-ink']` |
| L8 | light | after remounting streaming: zero `[data-shape-title]`, and `p` elements reading `Root causes:` and `Results:` both exist (then remount settled for the next gates) |
| L9 | light | a `p` reading `Options:` exists, and its next element sibling is, or contains, a `table` that has no `[data-shape]` ancestor |
| T1 | light | at 16px, every `[data-shape-title]` (at least 12) has fontSize equal to the body's fontSize ±0.5 |
| T2 | light | at 16px, in the `Results:` table, the first `th` and the first `td` both equal the body fontSize ±0.5 |
| T3 | light | at 16px: every `[data-shape="facts"] dt` fontSize ≥ its `dd` fontSize; in each `[data-stat-tile]`, the first element child equals the body ±0.5 and the element carrying class `text-md-stat` equals 1.75 × body ±0.5 |
| T4 | light | at 16px: every `.vv-chip`, `.vv-badge`, `[data-shape-actions]` and data-bars `.vv-meter__value` inside `[data-shape]` (at least 5 in total) equals 0.875 × body ±0.5; every `.vv-banner` inside `[data-shape]` (at least 2) equals the body ±0.5 |
| T5 | light | after `setSurface(page, { fontPx: 20 })`: the body reads `20px`, and every element T1–T4 measured has the same ratio as at 16px ±0.02 |
| T6 | light | eight bare elements appended to `document.body` outside any `[data-text-scale]` (`.vv-chip`, `.vv-chip.vv-chip--sm`, `.vv-badge`, `.vv-badge.vv-badge--compact`, `.vv-banner`, `.vv-banner__mark`, `.vv-meter__label`, `.vv-tabs__tab`) compute the `fontSize` recorded for each in `.verify/artifacts/verve-life-library-sizes.json`. When that file is absent, the probe first writes it from this reading (Phase 2's run, before any library edit), and it never rewrites it |
| C1 | light | at least 8 frames of kind table, data-bars, tasks, timeline, facts, stats or list: each `[data-shape-header]` background equals ref `bg-primary/[0.06]`, its `[data-shape-icon]` colour equals ref `text-accent-ink`, and its `[data-shape-title]` colour equals ref `text-foreground` |
| C2 | light | the `[data-shape-header]` of `[data-shape="callout"]` has `data-tone="warn"`, and those of `[data-shape="verdict"]` and `[data-shape="checks"]` have `data-tone="danger"`; no `[data-shape]` root carries `data-tone`; each header background equals that tone's ref `bg-[color:var(--tone-soft)]` and each title colour that tone's ref `text-[color:var(--tone-ink)]` |
| C3 | light | for the `Results:` frame and the callout frame, with the header pixel `paintedPixel(<header>, Math.floor(width / 2), height - 3)` (inside the header's bottom padding, clear of the glyphs, the icon and the rounded corners): `contrast(title colour, pixel) ≥ 4.5`, `contrast(icon colour, pixel) ≥ 3.0`, and the rejected control `contrast(ref text-primary, Results header pixel) < 4.5` |
| C4 | light | the `Results:` table's first `thead th` background, or its `thead tr` background when the `th` is transparent, equals ref `bg-primary/[0.05]`; after one click on that `th`'s sort control, that `th`'s colour equals ref `text-accent-ink` |
| C5 | dark | C1 holds against the dark session's own refs, and the `Results:` header background differs from C1's light reading |
| C6 | dark | C3's two floors (≥ 4.5 and ≥ 3.0) hold in dark; the rejected control is not read in dark |
| C7 | light | the first timeline dot (the element in `[data-shape="timeline"]` carrying class `bg-accent-ink`) has background equal to ref `bg-accent-ink`; the first `[data-shape="facts"] dt` colour equals ref `text-accent-ink` |
| M1 | light | session C's first settled mount: every `[data-shape][data-collapsed]` whose `data-shape` is not `section`, `output` or `file-preview` (at least 12; the two embed frames join from Phase 7) carries `data-vv-enter`, and `animationsOf` gives it a `vv-rise` animation with end ≤ 400 |
| M2 | light | same mount: every `tbody tr` in the `Results:` table has an animation named `vv-pagein`; the second row's delay is 30; every end in the document is ≤ 400 |
| M3 | light | same mount: each data-bars `.vv-meter__fill` has an animation named `vv-meter-grow`; after `setSurface`'s wait, the two fills' computed `transform` strings differ |
| M4 | light | every animation M1–M3 found has `props` ⊆ {`opacity`, `transform`} |
| M5 | light | session C, streaming mount: zero `[data-vv-enter]`, and no element in the body has an animation named `vv-rise`, `vv-pagein` or `vv-meter-grow` |
| M6 | light | session D, reduced motion, first settled mount: at least 12 `[data-vv-enter]`, every one with computed `animationName` `none`, and every data-bars `.vv-meter__fill` with `animationName` `none` |
| M7 | light | settled mount: the `ul` after `A sentence that ends with a period.` has computed `animationName` `none` |
| M8 | light | session C, after M1–M4 and M7: unmount, then mount `VERVE_DOCUMENT` settled again. Zero `[data-vv-enter]` and zero `vv-rise` animations, while at least 12 `[data-shape-header]` are present |
| E1 | light | exactly one `[data-shape="widget"]`, title `Widget`, holding exactly one `iframe` whose `sandbox` attribute `===` `allow-scripts` |
| E2 | light | read within 2000 ms of the settled mount: `[data-shape="docspace"]` has title `DocSpace block` and one `iframe` whose `new URL(src).origin !== location.origin`; `a[data-docspace-open]` has href ending `/#page=page-probe-missing&block=blk-probe-missing`, target `_blank`, and rel containing `noopener` |
| E3 | light | the parent element of each iframe in E1 and E2 has computed `borderTopWidth` `0px` |
| E4 | light | mark the docspace iframe (`el.__verveMark = 1`), click its frame's `[data-shape-toggle]`: the root reads `data-collapsed="true"`, the marked iframe is still `isConnected`, and its `src` is unchanged; click again to reopen |
| E5 | light | streaming mount: zero `[data-shape="widget"]` and zero `[data-shape="docspace"]`; one `pre` contains `hello` and one contains `"kind":"docspace"` |
| E6 | light | an export render of `VERVE_DOCUMENT`, made the way `.verify/probe-shapes-fences.mjs` renders its `EXPORT_DOCUMENT` (its export mount near `:170`, copied, not imported), holds a `pre` containing `"kind":"docspace"`, zero `[data-shape="docspace"]`, zero `[data-shape="widget"]` and zero `iframe` |
| F1 | light | at 20px: the `ts` fence's language label (the `text-md-meta` element in that fence's shell) and its highlighted `code` element both measure 17.5px ±0.5 |
| F2 | light + dark | the `a` reading `the docs` has colour equal to that session's ref `text-accent-ink`, and its `textDecorationLine` includes `underline`; read in both sessions, one gate line |
| F3 | dark | the `ts` fence's shell (the `rounded-xl` ancestor of its `code`) has background equal to the dark ref `bg-muted/50` |
| X1 | light | zero console errors and zero `pageerror` in session A, between its first mount and its last unmount, ignoring only messages containing `Failed to read the 'serviceWorker' property` (`docs/architecture/07-live-widgets.md` §"Gotchas") and failed loads of URLs on the ArchPulse origin (port 8005) |
| X2 | both | both screenshot files exist and are larger than 0 bytes |

**Group counts**, read by each phase's verify as `awk '/^\[PASS\] <G>[0-9]+ /{p++} /^\[FAIL\] <G>[0-9]+ /{f++} END{print p+0, f+0}'`: L 9 · T 6 · C 7 · M 8 · E 6 · F 3 · X 2.

## Project Constraints

- **No unit tests, ever.** Never create, edit or delete anything under `src/**/tests/` or any `*.test.*` file. Verification is the `.verify/` browser probes against the running dev server and the checks in this plan.
- **Git.** Work stays in the working tree. No commit, push, branch, stash, checkout, restore, reset or clean. To undo an edit of your own, copy the file to a backup under `.verify/artifacts/verve-life-backup/` first and copy it back. Another session's uncommitted work shares this tree (for example `src/modules/chat/transcript/shapes/detect/fileRefs.ts`, `src/shared/ui/verve/controls.css`, `src/shared/types.ts`). Never revert, reformat or "tidy" it. Where it is in your manifest, edit around it in place.
- **Frontend law**, `.agents/skills/frontend-module-standards/SKILL.md`:
  - Application imports use `@/…`, never `./` or `../` (`:17-23`).
  - `import type` for types; `type`, never `interface` (`:66-72`).
  - Every exported symbol carries a comment naming its consumers, kept current (`:52-53`).
  - Another module is imported only through its `index.ts` (`:30`).
  - A new string arrives through `t()` in all eleven locales.
- **Colour law**, `src/shared/ui/verve/README.md:29-33`: "Colour reaches a screen through Tailwind, never as a literal … a screen spells Tailwind names: not hex, not `var(--…)`." The one sanctioned arbitrary spelling is the existing tone precedent `text-[color:var(--tone-ink)]` / `bg-[color:var(--tone-soft)]` (`src/modules/chat/transcript/shapes/CheckResults.tsx:86`, `src/modules/chat/transcript/shapes/DiffBlock.tsx:35-39`). No palette utility (`blue-*`, `green-*`, `zinc-*`, `gray-*`, …) is added anywhere.
- **Tone law**, `~/.claude/design/DESIGN_DOCTRINE.md` §5: "No component may ever add a tone rule" and the enum is CLOSED at `neutral info positive warn danger`. §6: colour is never the whole signal, so every toned header also carries its icon and its words.
- **Library CSS edits** (Phases 5–6). In `src/shared/ui/verve/controls.css` and `feedback.css`, only the fourteen font-size values named in Interfaces I5 change, each in place with today's value kept as the fallback, and no line is added. `tokens.css` gains only the size swap, the meter keyframes and its one media rule. DESIGN_DOCTRINE §10: "Landing a library prop is part of a feature author's job, not scope creep and not a contended-footprint risk."
- **Rule 5, motion**, `src/shared/ui/verve/README.md:55-58`: "Colour animates only across a theme flip … no always-on colour transition comes back." Motion here animates `opacity` and `transform` only, and never on hover.
- **Shapes law**, `docs/architecture/08-rendered-shapes.md`:
  - "decide from `node`, render from `children`" and "a shape may never render less than the markdown it replaced" (§"In one paragraph").
  - "A miss is today's markup": no `Plain*` class string changes. Phase 8 is the one deliberate exception, proven by its sed script.
  - "The exclusion is `.not-prose`, and never `[data-shape]`" (§"Element cards"). The one new exclusion names a single kind, `[data-shape="list"]`, and only on the list-frame rule.
  - "No rule sets a margin" (§"Element cards").
- **Baseline law**, `docs/verification.md:903-918`: "The artifact is never rewritten to make a comparison pass." `.verify/artifacts/shapes-elements-baseline.html` is re-captured only in Phase 8, only with `--write --force --note=…`, and only after the sed proof.
- **Module size.** The default ceiling is 300 lines per file. `DataTable.tsx` (292) splits by pure move before it crosses. New stylesheets are ≤ 90 lines each. `.verify/lib/verve-life.mjs` ≤ 350 and `.verify/phase-34.mjs` ≤ 450: single sequential verification scripts, justified as such. `src/index.css` (944 lines) is never the home for a new rule.
- **Dev server.** `cloudcli-client-dev.service` (Vite, `:5183`) and `cloudcli-server-dev.service` (API, `:3011`) hot-reload `src/`. Check `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5183/` prints `200`. Never start, stop or restart them. `archpulse.service` (`:8005`) is needed by `phase-29.mjs` only.
- **Probes run one at a time**, and sign in as the dev account only.
- **Never print `.env`.** It holds a live credential.
- **Healed means deleted.** A corrected doc sentence is replaced outright, with no "previously" note and no struck-through history.

## Phase 1 — Record the harness before anything changes
Depends on: none

```toml
[phase]
id = "1"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 5400
manifest = [".verify/verve-life-compare.sh", ".verify/artifacts/verve-life-before", ".verify/artifacts/verve-life-after"]
forbidden = [".verify/lib", ".verify/artifacts/shapes-elements-baseline.html"]
athena = [
  "The compare key keeps the gate's measured detail, so a gate that stayed red with a different number reads NEW-FAIL, or the cut uses a hyphen instead of ' — ' and a genuinely new failure hides behind an old key",
  "A probe that crashed before printing any gate yields zero [FAIL] lines and the script prints SAME-OR-BETTER instead of NO-GATES",
  "The before files were captured with probes running in parallel, colliding on the one dev account, or with stderr dropped, so the recorded reds are not the tree's reds",
  "The baseline artifact backup is not byte-identical to .verify/artifacts/shapes-elements-baseline.html, so Phase 8's sed proof compares against the wrong bytes",
  "The script exits non-zero or prints more than one line, so a caller reading its stdout sees noise instead of the verdict",
  "The tsx-or-node choice is keyed on the probe's name, or every probe is routed through tsx, instead of reading the probe's own // Usage: line, so a node probe runs under a different loader than it was written for or the next TypeScript-importing probe crashes NO-GATES",
  "The recording and the compare script choose the invocation by different rules, so a probe's before file and after file were produced by different runtimes and its verdict compares unlike runs",
]

[[steps]]
kind = "edit"
path = ".verify/verve-life-compare.sh"
what = "The script exists from attempt 1 (56 lines) and runs every probe with bare node; edit it in place so it matches Interfaces I9(a) as it now reads. Choose the invocation per probe from the probe's own usage line: when .verify/<script> holds a line matching ^// Usage: npx --no-install tsx (grep -q), run npx --no-install tsx --tsconfig tsconfig.json .verify/<script>; otherwise run node .verify/<script>. Both write stdout+stderr into .verify/artifacts/verve-life-after/<script>.txt. Everything else stays as I9(a) says: key [FAIL] lines at the first ' — ', print exactly one of SAME-OR-BETTER / NEW-FAIL / NO-BEFORE / NO-GATES, always exit 0. NO-GATES wins when the after file holds no line starting [PASS] or [FAIL]; NO-BEFORE is checked before NO-GATES. Why: probe-shapes-detect.mjs imports app TypeScript whose barrel re-exports through the tsconfig-only @/ alias, so bare node dies with ERR_MODULE_NOT_FOUND before its first gate; its usage line (.verify/probe-shapes-detect.mjs:20) names the tsx invocation, which prints 97 PASS gates. Key the choice on the usage line, never on the probe's name, and never route the node probes through tsx. The script stays at most 60 lines."
check = '''
bash -n .verify/verve-life-compare.sh && for w in SAME-OR-BETTER NEW-FAIL NO-BEFORE NO-GATES 'tsx --tsconfig tsconfig.json' '// Usage: npx --no-install tsx'; do if grep -qF -- "$w" .verify/verve-life-compare.sh; then printf 'ok '; else printf 'missing '; fi; done; if [ "$(wc -l < .verify/verve-life-compare.sh)" -le 60 ]; then echo 'lines-ok'; else echo 'lines-over'; fi
'''
expect = "ok ok ok ok ok ok lines-ok"

[[steps]]
kind = "run"
cmd = '''
mkdir -p .verify/artifacts/verve-life-before && for s in probe-shapes-baseline.mjs probe-shapes-detect.mjs probe-shapes-tables.mjs probe-shapes-lists.mjs probe-shapes-prose.mjs probe-shapes-groups.mjs probe-shapes-fences.mjs probe-shapes-inline.mjs probe-markdown-cards.mjs phase-22.mjs phase-28.mjs phase-29.mjs phase-32.mjs phase-33.mjs; do if grep -q '^// Usage: npx --no-install tsx' ".verify/$s"; then npx --no-install tsx --tsconfig tsconfig.json ".verify/$s" > ".verify/artifacts/verve-life-before/$s.txt" 2>&1; else node ".verify/$s" > ".verify/artifacts/verve-life-before/$s.txt" 2>&1; fi; done; true
'''
check = '''
n=0; for s in probe-shapes-baseline.mjs probe-shapes-detect.mjs probe-shapes-tables.mjs probe-shapes-lists.mjs probe-shapes-prose.mjs probe-shapes-groups.mjs probe-shapes-fences.mjs probe-shapes-inline.mjs probe-markdown-cards.mjs phase-22.mjs phase-28.mjs phase-29.mjs phase-32.mjs phase-33.mjs; do f=".verify/artifacts/verve-life-before/$s.txt"; if [ -s "$f" ] && grep -qE '^\[(PASS|FAIL)\]' "$f"; then n=$((n+1)); fi; done; echo "recorded=$n"
'''
expect = "recorded=14"
timeout_s = 7200

[[steps]]
kind = "run"
cmd = "cp .verify/artifacts/shapes-elements-baseline.html .verify/artifacts/verve-life-before/shapes-elements-baseline.html"
check = "cmp -s .verify/artifacts/shapes-elements-baseline.html .verify/artifacts/verve-life-before/shapes-elements-baseline.html && echo SAME"
expect = "SAME"

[[verify]]
cmd = "bash .verify/verve-life-compare.sh probe-shapes-detect.mjs"
expect = "SAME-OR-BETTER probe-shapes-detect.mjs"
timeout_s = 600

[[verify]]
cmd = "bash .verify/verve-life-compare.sh probe-verve-life-absent.mjs"
expect = "NO-BEFORE probe-verve-life-absent.mjs"
timeout_s = 120

[[verify]]
cmd = "n=$(grep -l 'ERR_MODULE_NOT_FOUND' .verify/artifacts/verve-life-before/*.txt .verify/artifacts/verve-life-after/probe-shapes-detect.mjs.txt 2>/dev/null | wc -l); echo \"module-crashes=$n\""
expect = "module-crashes=0"
timeout_s = 60
```

**What to build.** One bash script, and a recording of fourteen probes run one after another. Nothing else is yours in this phase.

The recording is the ground every later phase stands on. Another session's uncommitted work shares this tree, so some of these probes may already be red. A red recorded here is not this plan's to fix. It is the line later phases must not cross.

The step's `cmd` runs the fourteen probes serially, which takes a long while (phase-29 alone drives ArchPulse). Run it once, and let it finish. It re-records all fourteen, overwriting what attempt 1 left in `.verify/artifacts/verve-life-before/`. Each probe runs the way its own `// Usage:` line says: `probe-shapes-detect.mjs` through `npx --no-install tsx --tsconfig tsconfig.json`, the other thirteen through `node`. The compare script uses the same rule.

**Reversible default you may take without stopping.** The compare key cuts at ` — ` (space, em dash, space), the separator the harness's `report()` functions use. If a probe's `[FAIL]` detail uses another separator, the key is the whole line for that probe, which is stricter, never looser.

**Sirens.**
- **Chasing a red.** You will see a recorded probe already failing, perhaps `phase-29.mjs` with `[FAIL] the run reached its end (fetch failed)` if ArchPulse is down, or a shapes probe reddened by `detect/fileRefs.ts` in-flight work. Do not investigate it and do not re-run it until it goes green. Record it exactly as printed, and name it in your report.
- **Parallel runs.** You will want to run the fourteen probes concurrently to save time. Do not. They share one dev account, and two runs overwrite each other's preferences (`docs/verification.md` §"What bites people").
- **Fixing a probe.** You will see a probe line you think is wrong. `.verify/lib` and every probe are outside your manifest; put it in your report.
- **Bare node for every probe.** Attempt 1 ran all fourteen with `node`, and `probe-shapes-detect.mjs` died with `ERR_MODULE_NOT_FOUND: Cannot find package '@/modules'`. You will want to fix that by adding an `imports` map, a loader hook or a `node_modules/@` shim, or by editing the probe. Do not. Choose the invocation from the probe's own usage line, in both the recording `cmd` and the compare script, exactly as step 1's `what` says.
- **Keeping attempt 1's files.** You will see thirteen before files already green from attempt 1, and want to re-run only the one that crashed. Do not. Run the step's `cmd` as written, so all fourteen come from one serial pass.
- **Divergence.** When reality differs from this chart, stop and report it verbatim. Examples: a listed probe file does not exist; `.verify/artifacts/shapes-elements-baseline.html` does not exist; a probe prints neither `[PASS]` nor `[FAIL]` lines at all.

## Phase 2 — The falsifiable probe, failing on every group before any paint
Depends on: Phase 1

```toml
[phase]
id = "2"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 5400
manifest = [".verify/lib/verve-life.mjs", ".verify/phase-34.mjs", ".verify/artifacts/verve-life-library-sizes.json", ".verify/shots"]
forbidden = [".verify/lib/console.mjs", ".verify/lib/shapes-fixture.mjs", ".verify/lib/color.mjs", ".verify/lib/mountReact.mjs", ".verify/artifacts/verve-life-before", ".verify/artifacts/shapes-elements-baseline.html", "src/modules/chat/transcript/shapes/ShapeFrame.tsx", "src/modules/chat/transcript/markdownCards.css", "tailwind.config.js"]
athena = [
  "A gate passes vacuously: its selector matched nothing and no minimum count is asserted (T1 at least 12, T4 at least 5 and 2, C1 at least 8, M1 at least 12)",
  "A colour gate compares against a hard-coded rgb string instead of readRefs in the same session and theme",
  "paintedPixel ignores devicePixelRatio, or samples a pixel under the title glyphs, the icon, or the rounded corner, so C3 measures ink against ink or against the page behind the frame",
  "The M gates read animations after setSurface has already waited them out, so M1 cannot see a vv-rise that did play, or M5 passes because everything finished",
  "E2 reads the docspace frame after DOCSPACE_READY_TIMEOUT_MS, when the iframe may already be replaced by WidgetErrorCard",
  "X1's ignore filter is broad enough to swallow real errors, for example matching on the word Error or on any iframe load",
  "VERVE_DOCUMENT differs from the plan's verbatim text, for example the checks and timeline lists share a marker and merge into one loose list",
  "The M gates share a page with earlier mounts, so the entrance memory hides data-vv-enter and M1 fails, or M6 passes, for a reason unrelated to motion",
  "T6 rewrites the library-sizes JSON on a later run, so it compares the tree with itself and can never fail",
  "A paragraph gate (L2, L4, L8, L9, M7) selects `p`, which this renderer never emits, so L2 cannot fail and the others are red for a reason unrelated to the feature",
  "X1's failed-load allowance is not bounded by the count of :8005 errors, so a 404 from another origin is swallowed",
  "E6 reads a client mount, where WidgetFrame's mount effect frames live iframes, instead of the export's renderToStaticMarkup",
]

[[steps]]
kind = "edit"
path = ".verify/lib/verve-life.mjs"
what = "Create the helper module exactly per Interfaces I9(c): VERVE_DOCUMENT verbatim, setSurface, readRefs, paintedPixel (pngjs, devicePixelRatio, throws on a zero box), the contrast re-export from ./color.mjs, animationsOf. Import nothing from a .verify/lib file except color.mjs. The check prints SIZE-OK, then a line of six `ok ` each with its trailing space; expect_re matches that line exactly, trailing space included, and any missing-<name> or SIZE-OVER fails it."
check = '''
node --check .verify/lib/verve-life.mjs && awk 'END{print (NR<=350)?"SIZE-OK":"SIZE-OVER"}' .verify/lib/verve-life.mjs && for n in VERVE_DOCUMENT setSurface readRefs paintedPixel contrast animationsOf; do if grep -qE "export (const|async function|function|\{[^}]*)[^a-zA-Z]*$n" .verify/lib/verve-life.mjs; then printf 'ok '; else printf "missing-$n "; fi; done; echo
'''
expect_re = "^SIZE-OK\\n(ok ){6}$"

[[steps]]
kind = "edit"
path = ".verify/phase-34.mjs"
what = "Create the probe exactly per Interfaces I9(d): 41 gates L1-X2 printed in table order, one [PASS]/[FAIL] line each, the VERVE LIFE 34 final line, exit 0/1, two element screenshots, the four sessions A-D of I9(d), report() copied from probe-markdown-cards.mjs, the library-sizes JSON written only when absent, the E6 export mount copied from probe-shapes-fences.mjs, mounts via shapes-fixture.mjs, every colour from readRefs, M gates read before setSurface's wait, reduced motion via page.emulateMedia. Where I9(d) reads a `p`, select `div.mb-2.last\\:mb-0`: this renderer emits every paragraph as that div (src/modules/chat/transcript/shapes/elements/paragraph.tsx:18-22) and a `p` selector matches nothing, so L2 could never fail. E6 renders VERVE_DOCUMENT through the export path the app writes, renderToStaticMarkup inside TranscriptRenderContext with isExporting true (src/modules/chat/export/buildTranscriptHtml.tsx:68), because the probe-shapes-fences client mount runs WidgetFrame's mount effect and frames both live iframes. X1 counts console errors whose message.location().url names :8005 and drops at most that many `Failed to load resource` lines, because openConsole records only message.text(), which carries no URL. E2 times its 2000 ms from the settled mount to its own read. M5 also requires that the streaming body rendered. Each screenshot first resizes the viewport to the body box, as .verify/phase-33.mjs:654 does, so the whole element is painted. Add the phase-34.mjs entry to docs/verification.md per the phase body."
check = '''
node --check .verify/phase-34.mjs && awk 'END{print (NR<=450)?"SIZE-OK":"SIZE-OVER"}' .verify/phase-34.mjs
'''
expect = "SIZE-OK"

[[steps]]
kind = "run"
cmd = "node .verify/phase-34.mjs"
check = '''
node .verify/phase-34.mjs 2>&1 | awk '/^\[(PASS|FAIL)\] [LTCMEFX][0-9]+ /{n++} /^\[FAIL\] L1 /{a="L1"} /^\[FAIL\] T1 /{b="T1"} /^\[FAIL\] C1 /{c="C1"} /^\[FAIL\] M1 /{d="M1"} /^\[FAIL\] E1 /{e="E1"} /^\[FAIL\] F2 /{g="F2"} /^VERVE LIFE 34:/{s=$0} END{print n+0, a, b, c, d, e, g, s}'
'''
expect = "41 L1 T1 C1 M1 E1 F2 VERVE LIFE 34: a gate FAILED"
timeout_s = 900

[[verify]]
cmd = "test -s .verify/shots/phase-34-light.png && test -s .verify/shots/phase-34-dark.png && echo SHOTS-OK"
expect = "SHOTS-OK"

[[verify]]
cmd = "node -e \"const j=JSON.parse(require('fs').readFileSync('.verify/artifacts/verve-life-library-sizes.json','utf8')); console.log(Object.keys(j).length)\""
expect = "8"

[[verify]]
cmd = '''
{ grep -cE '#[0-9a-fA-F]{6}|rgba?\([0-9]' .verify/phase-34.mjs || true; }
'''
expect = "0"
```

**What to build.** Two files: the helper module and the probe. Then run the probe once. The probe MUST end this phase FAILING, with L1, T1, C1, M1, E1 and F2 red. None of what they measure exists yet: no lead-in frames, no `data-shape-title`, no header wash, no `data-vv-enter`, no framed embeds, and links are still blue. That red is the proof each group can fail. Every other gate may read red or green today; the check does not care, and neither should you. Two gates are guards and read green already: T6, because the library-sizes file is written from this very run before any library edit, and E6, because an export has never framed an embed.

Copy the structure, never re-invent it:
- `report()` and exit handling from `.verify/probe-markdown-cards.mjs:41-46,495`;
- the animation wait from `:125-148`;
- sessions from `.verify/lib/console.mjs:364`;
- mounts from `.verify/lib/shapes-fixture.mjs:158,246`.

Read those, then write the probe gate by gate against Interfaces I9(d).

**Three places I9(d) reads the renderer wrong. Step 2's `what` carries the order for each.** A paragraph is `div.mb-2.last\:mb-0`, never a `p`. An export is `renderToStaticMarkup`, because a client mount runs effects and frames the embeds. A failed load's console text carries no URL, so X1 counts `:8005` errors by `location().url`.

The second verify requires ZERO colour literals in the probe. Every expected colour comes from `readRefs`. `paintedPixel`'s `rgb(` template lives in the helper, not the probe.

**Reversible defaults you may take without stopping.**
- When `readRefs` builds its tone wrappers, put the `data-tone` attribute on the wrapper div and the class on a child, which is how inheritance reaches a real header. Reversal: one wrapper per class.
- For the `thead` background (C4), read the `th` first and fall back to the `tr` when the `th` is transparent. Reversal: read the `tr` only.

**Sirens.**
- **Making it pass.** You will want to add a class or an attribute in `src/` so a group goes green. Do not: `src/` is not in your manifest, and a red probe is this phase's deliverable.
- **Editing the fixture.** You will see that `openConsole` takes no `reducedMotion` option and `mountShapes` takes no className. Do not add either to `.verify/lib/console.mjs` or `shapes-fixture.mjs`; both are forbidden and every shapes probe depends on them. Use `page.emulateMedia` and `setSurface`.
- **Reference classes not emitted.** Before Phases 4–5, `bg-primary/[0.06]`, `bg-primary/[0.05]` and the tone arbitrary classes appear nowhere in `src/`, so Tailwind does not emit them and `readRefs` reads transparent for them. That is expected today. Do not hard-code a fallback colour.
- **ArchPulse.** E2 needs no real block. `page-probe-missing` names nothing, and the gate reads the frame and the iframe's origin, never the block. If `archpulse.service` is down, E2 may still pass on the iframe's `src` alone; do not make it depend on the block loading.
- **Re-recording the library sizes.** When T6 fails, you will want the probe to refresh `.verify/artifacts/verve-life-library-sizes.json`. It writes that file only when it is absent, and never again. Phases 3–9 forbid it.
- **One session for everything.** You will want to read the M gates in session A to save a browser launch. Do not. The entrance memory lives for the page, so after the L, T and C gates have mounted the document, no frame carries `data-vv-enter`.
- **Divergence.** When reality differs from this chart, stop and report it verbatim. Examples: `pngjs` does not import; `probe-shapes-fences.mjs` has no export mount near `:170`; `mountShapes` renders no `#probe-shapes-body`; `VERVE_DOCUMENT` renders fewer than 12 framed shapes once Phase 5 has shipped; `page.emulateMedia` rejects `reducedMotion`.

**Docs the sweep leaves.** `.verify/` is git-ignored. The sweep adds a `phase-34.mjs` entry to `docs/verification.md` §"The browser harness" giving its command, its final line and its groups; Phase 9 converges it.

## Phase 3 — Lead-in titles: the line above a list or a table becomes its header
Depends on: Phase 2

```toml
[phase]
id = "3"
builder = "iris"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 5400
manifest = ["src/modules/chat/transcript/shapes/detect/prose.ts", "src/modules/chat/transcript/shapes/detect.ts", "src/modules/chat/transcript/shapes/remarkShapeGroups.ts", "src/modules/chat/transcript/shapes/elements/plain.tsx", "src/modules/chat/transcript/shapes/elements/table.tsx", "src/modules/chat/transcript/shapes/elements/list.tsx", "src/modules/chat/transcript/shapes/tableData.ts", "src/modules/chat/transcript/shapes/listItems.ts", "src/modules/chat/transcript/shapes/leadInContext.ts", "src/modules/chat/transcript/shapes/LeadIn.tsx", "src/modules/chat/transcript/shapes/ShapeFrame.tsx", "src/modules/chat/transcript/markdownCards.css", ".verify/probe-shapes-detect.mjs", ".verify/probe-markdown-cards.mjs", ".verify/phase-33.mjs", ".verify/artifacts/verve-life-after", ".verify/shots"]
forbidden = [".verify/phase-34.mjs", ".verify/artifacts/verve-life-library-sizes.json", ".verify/lib", ".verify/artifacts/verve-life-before", ".verify/artifacts/shapes-elements-baseline.html", "tailwind.config.js", "src/modules/chat/transcript/Markdown.tsx", "src/modules/chat/transcript/StreamingMarkdown.tsx", "src/shared/ui"]
athena = [
  "The lead-in pass fires on a paragraph inside a list item, a blockquote or a section body it should not reach, or runs after groupSections so a pair under a heading is never grouped",
  "A paragraph with a soft line break, a break node, or more than 120 characters still becomes a title, or a paragraph that is bold plus other words counts as wholly bold",
  "LeadIn loses the author's words: the paragraph vanishes when the target declines to PlainTable, the rung predicate disagrees with the ladder it was moved out of, or the fallback for an unexpected child count drops content",
  "tableRung or listRung changed behaviour while moving: a matrix with inline formatting no longer declines, or a borrowed sub-list checkbox now counts as a task",
  "A lead-in title holding a code span with a file path renders a chip button inside the fold toggle, or the title still truncates",
  "The list-frame exclusion is written on [data-shape] generically, so lists under heading sections lose their card, or a second card rule was changed",
  "The probe-markdown-cards or phase-33 edits changed more than the named sentences and the one new block and kind, weakening gates instead of preserving them",
  "LeadInTitleContext leaks: a ShapeFrame nested under a titled frame, or a shape rendered later in the document, shows another block's title",
]

[[steps]]
kind = "edit"
path = "src/modules/chat/transcript/shapes/detect/prose.ts"
what = "Per Interfaces I3: add LEAD_IN_MAX_CHARS = 120 and isLeadInText(text, wholeBold). Also re-export both from src/modules/chat/transcript/shapes/detect.ts and add 'lead-in line' to the barrel header's prose family words."
check = '''
printf '%s %s\n' "$(grep -cE '^export (const LEAD_IN_MAX_CHARS = 120;|function isLeadInText\(text: string, wholeBold: boolean\): boolean)' src/modules/chat/transcript/shapes/detect/prose.ts)" "$(grep -cE 'isLeadInText|LEAD_IN_MAX_CHARS' src/modules/chat/transcript/shapes/detect.ts)"
'''
expect_re = "^2 [1-9][0-9]*$"

[[steps]]
kind = "edit"
path = ".verify/probe-shapes-detect.mjs"
what = "Add six isLeadInText cases through the detect.ts barrel, each gate text containing the words 'lead-in': ('Root causes:', false) true; ('Summary', true) true; ('A sentence.', false) false; ('x'.repeat(120) + ':', false) false; ('one\\ntwo:', false) false; ('   ', true) false. Copy the file's existing eq() form; change no other case."
check = '''
bash .verify/verve-life-compare.sh probe-shapes-detect.mjs && awk '/^\[PASS\]/ && /lead-in/{n++} END{print (n>=6)?"LEADIN-OK":"LEADIN-LOW"}' .verify/artifacts/verve-life-after/probe-shapes-detect.mjs.txt
'''
expect_re = "^SAME-OR-BETTER probe-shapes-detect\\.mjs\\s+LEADIN-OK$"
timeout_s = 600

[[steps]]
kind = "edit"
path = "src/modules/chat/transcript/shapes/remarkShapeGroups.ts"
what = "Per Interfaces I3: add value?: string to MdastNode, add the unexported groupLeadIns pass with the exact qualification rule, and make the plugin body groupSections(groupLeadIns(groupTabbedCode(...))). Update the file's header comment: three passes, lead-ins between tabbed code and sections, and why that order."
check = "grep -cF 'groupSections(groupLeadIns(groupTabbedCode(' src/modules/chat/transcript/shapes/remarkShapeGroups.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "src/modules/chat/transcript/shapes/tableData.ts"
what = "Per Interfaces I3: add tableRung(node). Also move listRung, listItemNodes and ownCheckbox into src/modules/chat/transcript/shapes/listItems.ts, and rewrite ShapeTable (elements/table.tsx) and ShapeList (elements/list.tsx) to switch on the rung with unchanged behaviour. This is a pure move of the decisions: no rung order, threshold or decline changes."
check = '''
cat src/modules/chat/transcript/shapes/tableData.ts src/modules/chat/transcript/shapes/listItems.ts | grep -cE '^export function (tableRung|listRung)\('
'''
expect = "2"

[[steps]]
kind = "edit"
path = "src/modules/chat/transcript/shapes/LeadIn.tsx"
what = "Create leadInContext.ts and LeadIn.tsx per Interfaces I3. Add the ShapeDiv 'lead-in' branch in elements/plain.tsx. In ShapeFrame.tsx apply ONLY: title becomes ReactNode; the effective title is useContext(LeadInTitleContext) ?? title; re-provide null around the body; the prose prop drops not-prose and adds the body's first/last margin classes; the title span gets data-shape-title, loses truncate, and wraps its content in ChipsSuppressedContext.Provider value true; the body div gets data-shape-body."
check = '''
printf '%s %s %s\n' "$(grep -cF "shape === 'lead-in'" src/modules/chat/transcript/shapes/elements/plain.tsx)" "$(cat src/modules/chat/transcript/shapes/LeadIn.tsx src/modules/chat/transcript/shapes/ShapeFrame.tsx | grep -c 'LeadInTitleContext')" "$({ grep -c 'truncate' src/modules/chat/transcript/shapes/ShapeFrame.tsx || true; })"
'''
expect_re = "^1 [3-9][0-9]* 0$"

[[steps]]
kind = "edit"
path = "src/modules/chat/transcript/markdownCards.css"
what = "Per Interfaces I3, card CSS: add [data-shape=\"list\"] * inside the FIRST :not(...) of the list-frame rule (R1, :13-15), and update that rule's one-line comment to say a list inside a lead-in frame is framed by the frame. No other rule changes in this phase."
check = '''
printf '%s %s\n' "$(grep -cF '.not-prose, .not-prose *, [data-shape="list"] *):not(:has(input' src/modules/chat/transcript/markdownCards.css)" "$(grep -c 'data-shape="list"' src/modules/chat/transcript/markdownCards.css)"
'''
expect = "1 1"

[[steps]]
kind = "edit"
path = ".verify/probe-markdown-cards.mjs"
what = "In PROBE_DOCUMENT only: change the sentence 'Intro paragraph line:' (:72) to 'Intro paragraph line.' and 'A loose list spells the same label inside its paragraph:' (:78) to end with a full stop. Both lists exist to prove PLAIN element cards, and a colon now titles them. Nothing else in the file changes."
check = '''
f=.verify/probe-markdown-cards.mjs; printf '%s %s %s\n' "$(grep -cF 'Intro paragraph line.' "$f")" "$({ grep -cF 'Intro paragraph line:' "$f" || true; })" "$(grep -cF 'A loose list spells the same label inside its paragraph.' "$f")"
'''
expect = "1 0 1"

[[steps]]
kind = "edit"
path = ".verify/phase-33.mjs"
what = "In GALLERY_BLOCKS: the three card-section sentences ending in a colon before a plain list (:79 bulleted, :90 loose, :98 numbered-from-three) end with a full stop instead. Add ONE new block directly after the numbered-list block: 'A line ending in a colon titles the list below it:' followed on the next line by '- the header line moves into the card' and '- a sentence that ends with a full stop stays a sentence'. Add the kind 'list' to the constant listing the gallery's expected data-shape kinds. Change no gate logic."
check = '''
f=.verify/phase-33.mjs; printf '%s %s\n' "$(grep -cF 'A line ending in a colon titles the list below it:' "$f")" "$({ grep -cF 'A numbered list that starts at three:' "$f" || true; })"
'''
expect = "1 0"

[[steps]]
kind = "run"
cmd = "npx tsc --noEmit -p tsconfig.json"
check = '''
{ npx tsc --noEmit -p tsconfig.json 2>&1 | grep -cE 'transcript/shapes/(LeadIn|leadInContext|ShapeFrame|remarkShapeGroups|tableData|listItems|detect|detect/prose|elements/(plain|table|list))\.tsx?' || true; }
'''
expect = "0"
timeout_s = 600

[[steps]]
kind = "run"
cmd = "npx oxlint src/modules/chat/transcript/shapes"
check = "npx oxlint src/modules/chat/transcript/shapes/LeadIn.tsx src/modules/chat/transcript/shapes/leadInContext.ts src/modules/chat/transcript/shapes/ShapeFrame.tsx src/modules/chat/transcript/shapes/remarkShapeGroups.ts src/modules/chat/transcript/shapes/tableData.ts src/modules/chat/transcript/shapes/listItems.ts src/modules/chat/transcript/shapes/elements/plain.tsx src/modules/chat/transcript/shapes/elements/table.tsx src/modules/chat/transcript/shapes/elements/list.tsx src/modules/chat/transcript/shapes/detect/prose.ts >/dev/null 2>&1; echo lint-exit=$?"
expect = "lint-exit=0"
timeout_s = 300

[[verify]]
cmd = '''
node .verify/phase-34.mjs 2>&1 | awk '/^\[PASS\] L[0-9]+ /{p++} /^\[FAIL\] L[0-9]+ /{f++} END{print p+0, f+0}'
'''
expect = "9 0"
timeout_s = 900

[[verify]]
cmd = '''
for s in probe-shapes-baseline.mjs probe-shapes-tables.mjs probe-shapes-lists.mjs probe-shapes-prose.mjs probe-shapes-groups.mjs probe-markdown-cards.mjs phase-32.mjs phase-33.mjs; do bash .verify/verve-life-compare.sh "$s"; done | awk '/^SAME-OR-BETTER /{n++} END{print "same-or-better=" n+0}'
'''
expect = "same-or-better=8"
timeout_s = 3600
```

**What to build.** Scott's own reading of the parser, made real. The markdown is parsed by a script, react-markdown plus remark plugins. `remarkShapeGroups` already walks the reply's top-level blocks to group code tabs and heading sections. It gains a pass that looks at the block above a list or a table: when that paragraph ends in a colon or is wholly bold, the pair is grouped, and the paragraph becomes the card's header. Build exactly Interfaces I3, plus the four ShapeFrame changes the LeadIn step names. Everything else in I2 is Phase 4's.

The pieces, in the order the steps take them:
1. The grammar and its six detect cases.
2. The plugin pass.
3. The two rung predicates, moved out of the ladders so LeadIn asks the same question the table and list ask.
4. LeadIn, its context, the ShapeDiv branch and the minimal ShapeFrame changes.
5. The one card-CSS exclusion.
6. The two probe documents whose PLAIN-card lists now carry a lead-in.

**Why each constraint exists**, so you do not relitigate it:
- **Root children only, before sections.** "The plugin walks root children only, so nothing inside a list item or a blockquote is grouped" (`docs/architecture/08-rendered-shapes.md` §"The triggers"). `groupSections` nests a section's body one level down, so a lead-in pass after it would never see a pair written under a heading.
- **Render from children, colon kept.** "a shape may never render less than the markdown it replaced." The title is the paragraph's own rendered children: bold, code and link intact, colon included.
- **The rungs move, never fork.** If LeadIn guessed which targets frame themselves and guessed wrong, a declined matrix would lose its paragraph. One predicate, called by both, cannot disagree with itself.
- **Chips suppressed in titles.** The title sits inside the fold toggle, a button, and "A chip is a `<button>`, so three places suppress it" (08 §"Gotchas").
- **`[data-shape="list"]`, never `[data-shape]`.** A heading section wears `data-shape="section"`, and its lists must keep their cards (08 §"Element cards").

**What the probe edits are for.** `probe-markdown-cards.mjs:166` reads `:scope > ul`, and `phase-33.mjs:336` reads `:scope > ul, [data-shape="section"] ul`. Those lists exist to prove plain element cards, and both were introduced by a sentence ending in a colon, which now titles them into a frame. A full stop keeps them plain, and the gates keep proving what they proved. phase-33's shapes section also has colon sentences before its tables, task list, checks and timeline. Leave those: they now title those shapes, and no phase-33 gate reads a title.

**Reversible defaults you may take without stopping.**
- `LEAD_IN_MAX_CHARS = 120`. Reversal: one number in `detect/prose.ts` plus its near-miss case.
- Tables take lead-ins as well as lists. Reversal: drop `'table'` from `groupLeadIns`'s target test.

**Sirens.**
- **Styling the header.** In `ShapeFrame.tsx` you will want to add the icon, the wash and the sizes while you are there. Do not: that is Phase 4, and its probe gates are not yours. Apply only the four changes the step names.
- **ShapeList looking up.** You will want `ShapeList` to read its previous sibling. It cannot see one, and the plugin is the one place with siblings.
- **The streaming half.** You will want lead-ins while a reply streams. `remarkShapeGroups` is kept out of the streaming half on purpose (`Markdown.tsx:131-132`), and L8 proves the paragraph stays put there.
- **Moved-code drift.** While moving `ownCheckbox` or `listItemNodes`, you will see something to improve. Move them verbatim. A behaviour change hides inside a move where no probe is looking.
- **More sentences.** In phase-33 you will want to convert or reword other sentences. Change exactly the three named sentences, add the one block and the one kind.
- **A red that is not yours.** If a compare line reads `NEW-FAIL`, read the after file under `.verify/artifacts/verve-life-after/`. If the new failure names a lead-in, a title or a list frame, it is yours: fix the code, never the gate. If it names something this phase never touched, re-run that one probe once. If it is still new, stop and report both lines verbatim.
- **Divergence.** When reality differs from this chart, stop and report it verbatim. Examples: `ownCheckbox` reads React children rather than a hast node; `classifyTable`'s sortable result is not named `'plain'`; phase-33 has no single constant of expected kinds; `probe-shapes-detect.mjs` prints no `[PASS]` line per case.

**Docs the sweep leaves.** `docs/architecture/08-rendered-shapes.md` gets a lead-in row in §"The triggers" (root blocks, plugin) and `LeadIn.tsx` / `leadInContext.ts` rows in §"The pieces". The §"Element cards" paragraph "The title's trigger is the bold lead-in, because CSS cannot read a colon" gains the other half: the line ABOVE a list is read by the plugin. Phase 9 converges it.

## Phase 4 — One text scale and one header: sizes, merge rule, icons, washes
Depends on: Phase 3

```toml
[phase]
id = "4"
builder = "iris"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 4500
manifest = ["tailwind.config.js", "src/shared/utils.ts", "src/modules/chat/transcript/shapes/ShapeFrame.tsx", "src/modules/chat/transcript/markdownCards.css", "src/modules/chat/tools/ContentRenderers/MarkdownContent.tsx", ".verify/artifacts/verve-life-after", ".verify/shots"]
forbidden = [".verify/phase-34.mjs", ".verify/artifacts/verve-life-library-sizes.json", ".verify/lib", ".verify/artifacts/verve-life-before", ".verify/artifacts/shapes-elements-baseline.html", "src/modules/chat/transcript/shapes/LeadIn.tsx", "src/modules/chat/transcript/shapes/remarkShapeGroups.ts", "src/modules/chat/transcript/Markdown.tsx", "src/shared/ui", "src/index.css", "src/modules/chat/tools/PlanDisplay.tsx", "src/modules/chat/tools/SubagentPanel.tsx"]
athena = [
  "cn still drops a size: extendTailwindMerge was configured under the wrong group key or with the md-* names missing, so cn('text-md-body', 'text-foreground') loses one of them",
  "A header wash, icon or title colour is spelled as hex, var(--...) outside the sanctioned tone precedent, or a palette utility, or a toned frame paints with the accent pair instead of its tone pair",
  "data-tone lands on the frame root instead of the header row, so a toneless Badge or Chip in the body inherits warn or danger; or it is written for accent kinds, or missing for toned kinds",
  "The title still truncates or is still text-xs, or the chevron and icon are sized in px or rem so they stop following the chat text size",
  "A card rule's text-xs or text-sm survived, or R17 carries a margin, !important or a selector that reaches inside a .not-prose shape",
  "MarkdownContent's default prop or a caller's className changed, or text-chat-tool lands before prose-sm so prose-sm wins",
  "The body lost px-3 py-2 on non-flush frames, or the prose body margin classes are applied to every frame instead of prose frames only",
]

[[steps]]
kind = "edit"
path = "tailwind.config.js"
what = "Per Interfaces I1: insert the fontSize key with md-body, md-meta, md-code, md-stat and chat-tool directly after the fontFamily block (tailwind.config.js:17-20). Nothing else in the file changes."
check = "grep -cE \"'(md-body|md-meta|md-code|md-stat|chat-tool)':\" tailwind.config.js"
expect = "5"

[[steps]]
kind = "edit"
path = "src/shared/utils.ts"
what = "Per Interfaces I1, tailwind-merge: build the merger with extendTailwindMerge, extend.classGroups['font-size'] = [{ text: ['md-body', 'md-meta', 'md-code', 'md-stat', 'chat-tool'] }]. cn keeps its exact signature; its doc comment names the five sizes and why the extension exists."
check = '''
npx tsx -e "import('./src/shared/utils.ts').then((m) => console.log(m.cn('text-md-body', 'text-foreground'), '|', m.cn('text-md-meta', 'text-md-body')))"
'''
expect = "text-md-body text-foreground | text-md-body"
timeout_s = 300

[[steps]]
kind = "edit"
path = "src/modules/chat/transcript/shapes/ShapeFrame.tsx"
what = "Per Interfaces I2, everything except data-vv-enter: the ShapeKind union and SHAPE_KINDS registry (unexported), the tone and icon props, the effective tone, data-text-scale set to flow on the root, data-tone on the header row (never the root) only for non-accent tones, the header row with its wash, the icon, the title colours, the chevron at 1em, the actions slot at text-md-meta, the body at text-md-body with px-3 py-2 unless flush. Keep Phase 3's title context, prose prop and markers exactly."
check = '''
f=src/modules/chat/transcript/shapes/ShapeFrame.tsx; for m in data-text-scale data-shape-header data-shape-icon data-shape-title data-shape-actions data-shape-body 'bg-primary/[0.06]' 'bg-[color:var(--tone-soft)]' 'text-accent-ink' ChartColumn LayoutPanelTop; do if grep -qF "$m" "$f"; then printf 'ok '; else printf "missing:$m "; fi; done; printf '%s\n' "$({ grep -cE 'text-(xs|sm)([^a-z-]|$)|h-3\.5' "$f" || true; })"
'''
expect = "ok ok ok ok ok ok ok ok ok ok ok 0"

[[steps]]
kind = "edit"
path = "src/modules/chat/transcript/markdownCards.css"
what = "Per Interfaces I5: in R5, R11 and R12 replace text-xs or text-sm with text-md-meta, and append R17 (.chat-md-cards table:not(.not-prose *) -> @apply text-md-body;) with its one-line comment. No other rule changes."
check = '''
f=src/modules/chat/transcript/markdownCards.css; printf '%s %s %s\n' "$({ grep -E '@apply' "$f" | grep -cE 'text-(xs|sm)([^a-z-]|$)' || true; })" "$(grep -E '@apply' "$f" | grep -c 'text-md-meta')" "$(grep -cF '.chat-md-cards table:not(.not-prose *)' "$f")"
'''
expect = "0 3 1"

[[steps]]
kind = "edit"
path = "src/modules/chat/tools/ContentRenderers/MarkdownContent.tsx"
what = "Per Interfaces I5: the Markdown call becomes cn(className, MARKDOWN_CARDS_CLASS, 'text-chat-tool'). The default prop, the imports' shape and the consumer comment (ToolRenderer, PlanDisplay, SubagentPanel) stay; add one comment line saying tool bodies follow the chat text size at 7/8."
check = '''
f=src/modules/chat/tools/ContentRenderers/MarkdownContent.tsx; printf '%s %s\n' "$(grep -cF "cn(className, MARKDOWN_CARDS_CLASS, 'text-chat-tool')" "$f")" "$(grep -cF "className = 'mt-1 prose prose-sm max-w-none dark:prose-invert'" "$f")"
'''
expect = "1 1"

[[steps]]
kind = "run"
cmd = "npx tsc --noEmit -p tsconfig.json"
check = '''
{ npx tsc --noEmit -p tsconfig.json 2>&1 | grep -cE 'shared/utils\.ts|transcript/shapes/|tools/ContentRenderers/MarkdownContent\.tsx' || true; }
'''
expect = "0"
timeout_s = 600

[[steps]]
kind = "run"
cmd = "npx oxlint src/shared/utils.ts src/modules/chat/transcript/shapes/ShapeFrame.tsx src/modules/chat/tools/ContentRenderers/MarkdownContent.tsx"
check = "npx oxlint src/shared/utils.ts src/modules/chat/transcript/shapes/ShapeFrame.tsx src/modules/chat/tools/ContentRenderers/MarkdownContent.tsx >/dev/null 2>&1; echo lint-exit=$?"
expect = "lint-exit=0"
timeout_s = 300

[[verify]]
cmd = '''
node .verify/phase-34.mjs 2>&1 | awk '/^\[PASS\] (L[0-9]+|T1|C1|C5) /{p++} END{print p+0}'
'''
expect = "12"
timeout_s = 900

[[verify]]
cmd = "curl -s 'http://127.0.0.1:5183/src/index.css?direct' | grep -cE '\\.text-md-(body|meta)'"
expect_re = "^[1-9][0-9]*$"

[[verify]]
cmd = '''
for s in probe-shapes-tables.mjs probe-shapes-lists.mjs probe-shapes-prose.mjs probe-shapes-fences.mjs probe-markdown-cards.mjs phase-32.mjs phase-33.mjs; do bash .verify/verve-life-compare.sh "$s"; done | awk '/^SAME-OR-BETTER /{n++} END{print "same-or-better=" n+0}'
'''
expect = "same-or-better=7"
timeout_s = 3600
```

**What to build.** The standard every card will share: four named sizes plus the tool anchor, the merge rule that keeps them from being silently dropped, and the full header anatomy of Interfaces I2 (except `data-vv-enter`, which is Phase 6's). Also the card stylesheet's three size literals, R17, and the tool-body anchor. The shape bodies' own literals are Phase 5's.

Then look at `.verify/shots/phase-34-light.png` and `-dark.png` with the Read tool before you return. Check four things:
- The header wash is visible but quiet in both themes.
- The icon sits on the title's baseline.
- A long lead-in title wraps under itself rather than under the icon.
- The chevron still turns.

**Why each constraint exists**, so you do not relitigate it:
- **`em`, never `rem` or `px`.** Scott's words: "such that I can adjust it when I adjust my chat text size". This was measured before charting: every framed shape sat outside the setting (`ShapeFrame.tsx:48` `text-xs`, `:72` `text-sm`), while the prose around it followed `--chat-font-size`. A header in `rem` is exactly the "names of the table significantly smaller than its contents" he saw.
- **Title at `text-md-body`, never smaller.** Also Scott's: "if the header is bigger it should be bigger". The Verve canvas draws an uppercase 12px eyebrow over 15.5px body (`typography.css:12`). For rendered markdown, the operator's ruling above outranks that drawing, and the header's weight and wash carry the hierarchy instead.
- **The accent pair for structure, the five tones for meaning.**
  - Structural cards get the accent's wash (`bg-primary/[0.06]`) and ink (`text-accent-ink`). A green SHAPE is fill, a green WORD is ink (`src/shared/ui/verve/README.md:36-39`), and the title stays `text-foreground` for reading.
  - Callouts, verdicts and checks carry meaning, so they take `data-tone`. "Tone is a token swap, not a rule": the header reads `--tone-soft`/`--tone-ink` by inheritance, and no rule is written per tone. The attribute sits on the header row, not the root, so a Badge or Chip in the body keeps its own tone.
- **tailwind-merge.** `cn` is `twMerge(clsx(…))` (`src/shared/utils.ts:22-23`). Unknown `text-*` names fall into the colour group, so `cn('… text-md-body text-muted-foreground')` would keep only the colour. The frame would still build; it would just stop following the setting, and no type error would say so.
- **R17 reaches only non-shape tables.** A table outside a shape is the streaming half's `PlainTable` (`text-sm`, `elements/table.tsx:28`). Changing that class string would move the pinned baseline DOM, so it is overridden from the scoped stylesheet by specificity instead, as R1–R3 already override `PlainList`.

**Reversible defaults you may take without stopping** (each reversal is one line):
- Header wash `bg-primary/[0.06]`. Reversal: another alpha in `ShapeFrame.tsx` and in `readRefs`.
- Title colour `text-foreground` on accent kinds. Reversal: `text-accent-ink`, after C3 confirms ≥ 4.5 on the wash.
- Tool bodies at 7/8 of the chat size. Reversal: `'chat-tool'` in `tailwind.config.js` to `'var(--chat-font-size, 1rem)'`.

**Sirens.**
- **Shape bodies.** You will see `text-[11px]`, `text-3xl` and `text-xs` in DataTable, StatTiles, FactCard and their siblings. Do not touch them. They are Phase 5's, and those files are not in your manifest.
- **Library stylesheets.** You will want to change `.vv-banner`'s or `.vv-chip`'s `font-size` in `src/shared/ui/verve/controls.css` or `feedback.css`. Do not in this phase. Those sizes are the whole app's, and Phase 5 changes them as a token swap inside the library.
- **`TRANSCRIPT_PROSE`.** You will want to rewrite it as `text-chat`. Do not: two probes read its string by regex, and it already carries the anchor.
- **Colour literals.** You will want a hex or a `var(--accent-soft)` because a wash "looks right" that way. Do not. Tailwind names only, and the tone precedent `bg-[color:var(--tone-soft)]` is the one arbitrary spelling allowed. If a name refuses to compile (Vite overlay, or served CSS missing the class), stop and report the exact error.
- **C3 is not yet yours.** Contrast gates need Phase 5's toned callout. If T1, C1 or C5 fail and the cause is the frame, fix the frame. If the cause is the probe (a selector that cannot match), stop and report the gate line verbatim. The probe is forbidden to you.
- **Divergence.** When reality differs from this chart, stop and report it verbatim. Examples: `tailwind.config.js` is ESM and has no `fontFamily` block at `:17-20`; `src/shared/utils.ts` already uses `extendTailwindMerge`; a `ShapeFrame` caller passes a `kind` outside the union.

**Docs the sweep leaves.** `docs/architecture/08-rendered-shapes.md` §"Mental model" rule 6 ("Every block shape wears one frame") gains the header anatomy and the kind registry. `src/shared/ui/verve/README.md` rule 3 gains the named sizes. Phase 9 converges both.

## Phase 5 — Inside the cards: every body size, tone and accent mark, and the library's size swap
Depends on: Phase 4

```toml
[phase]
id = "5"
builder = "iris"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 4500
manifest = ["src/modules/chat/transcript/shapes/DataTable.tsx", "src/modules/chat/transcript/shapes/DataTableHead.tsx", "src/modules/chat/transcript/shapes/FactCard.tsx", "src/modules/chat/transcript/shapes/DecisionMatrix.tsx", "src/modules/chat/transcript/shapes/BeforeAfter.tsx", "src/modules/chat/transcript/shapes/StatTiles.tsx", "src/modules/chat/transcript/shapes/Timeline.tsx", "src/modules/chat/transcript/shapes/VerdictBanner.tsx", "src/modules/chat/transcript/shapes/CheckResults.tsx", "src/modules/chat/transcript/shapes/Callout.tsx", "src/modules/chat/transcript/shapes/DiffBlock.tsx", "src/modules/chat/transcript/shapes/LongOutput.tsx", "src/shared/ui/verve/tokens.css", "src/shared/ui/verve/controls.css", "src/shared/ui/verve/feedback.css", ".verify/artifacts/verve-life-after", ".verify/shots", ".verify/phase-34.mjs"]
forbidden = [".verify/artifacts/verve-life-library-sizes.json", ".verify/lib", ".verify/artifacts/verve-life-before", ".verify/artifacts/shapes-elements-baseline.html", "src/modules/chat/transcript/shapes/ShapeFrame.tsx", "src/modules/chat/transcript/markdownCards.css", "src/modules/chat/transcript/Markdown.tsx", "tailwind.config.js", "src/shared/ui/Banner.tsx", "src/shared/ui/Chip.tsx", "src/shared/ui/Badge.tsx", "src/shared/ui/Meter.tsx", "src/shared/ui/Card.tsx", "src/shared/ui/Tabs.tsx", "src/shared/ui/Collapsible.tsx", "src/shared/ui/index.ts", "src/shared/utils.ts", "src/modules/chat/transcript/shapes/elements"]
athena = [
  "A label, dt, th or stat label is still smaller than the text it heads, or a meta element was given text-md-body so counts and badges read as loud as content",
  "DataTable's sort, CSV order or bar cells moved: a class edit touched the rendered-row permutation, or the DataTableHead extraction changed the DOM or its props",
  "A library declaration changed more than its value: a selector, a neighbouring declaration, a fallback px that differs from today's, or a new rule added to controls.css or feedback.css, so a screen outside a card moves (T6 reads it)",
  "The tokens.css swap names a property the declarations do not read, sits somewhere other than beside the [data-tone] rules, or holds rem or px, so cards stop following the chat size",
  "CheckResults picks its tone from a count it does not already read, or VerdictBanner tones PASS and FAIL the wrong way round",
  "The Timeline dot uses bg-primary (2.81:1 in light, under the graphics floor) instead of bg-accent-ink, or the FactCard dt keeps a muted class beside text-accent-ink so the two fight",
  "A text-md-* size lands on a container holding another sized element, so a chip inside a label compounds to 0.875 x 0.875",
  "The .verify/phase-34.mjs edit changed more than the one spread on the ratios line: a tolerance, a gate id, a threshold, a measured list or its order moved, so T5 passes on a weaker oracle instead of on the DOM",
  "T5 passes because the 16px and 20px ratio lists came out empty, NaN-free by omission, or of different lengths, not because every title, cell, fact, tile, meta and banner size keeps its ratio",
]

[[steps]]
kind = "edit"
path = ".verify/phase-34.mjs"
what = '''Repair the one oracle token that makes T5 fail for every DOM. In .verify/phase-34.mjs, on the line that starts `  const ratios = (surface) => [` (line 326), `[surface.titleSizes, surface.cells.th` becomes `[...surface.titleSizes, surface.cells.th`. Make it with exactly: sed -i 's/\[surface\.titleSizes, surface\.cells\.th/[...surface.titleSizes, surface.cells.th/' .verify/phase-34.mjs . Why (measured by attempt 1, re-confirmed at replan): titleSizes is an array, so unspread it is ONE list entry that maps to NaN, and Math.abs(NaN - NaN) <= 0.02 is false, so T5 printed `23 sizes` and failed whatever the cards render; spread, it measures every title as I9(d) T5 requires ("every element T1-T4 measured"), 35 sizes. No other byte of this file changes; the check hashes the file with the token reversed against its pre-phase hash 95b147631346. The previous attempt's edits to the eleven shape files and the three verve stylesheets are already in the tree: run each later step's check first, and where it already prints its expect, leave that file as it is.'''
check = '''
f=.verify/phase-34.mjs; printf '%s %s %s %s\n' "$({ grep -cF '[surface.titleSizes, surface.cells.th' "$f" || true; })" "$({ grep -cF '[...surface.titleSizes, surface.cells.th' "$f" || true; })" "$(sed 's/\[\.\.\.surface\.titleSizes, surface\.cells\.th/[surface.titleSizes, surface.cells.th/' "$f" | sha256sum | cut -c1-12)" "$(node --check "$f" >/dev/null 2>&1 && echo syntax-ok || echo syntax-bad)"
'''
expect = "0 1 95b147631346 syntax-ok"

[[steps]]
kind = "edit"
path = "src/modules/chat/transcript/shapes/DataTable.tsx"
what = "Per Interfaces I4, the DataTable rows: table text-md-body, header row bg-primary/[0.05], th font-semibold text-foreground, the active-sort th text-accent-ink, body tr hover:bg-primary/[0.04]. If the file would exceed 300 lines, first move the header row into DataTableHead.tsx as a pure move."
check = '''
f=src/modules/chat/transcript/shapes/DataTable.tsx; printf '%s %s %s\n' "$(grep -cF 'bg-primary/[0.05]' "$f" src/modules/chat/transcript/shapes/DataTableHead.tsx 2>/dev/null | awk -F: '{s+=$NF} END{print (s>=1)?"wash-ok":"wash-missing"}')" "$({ grep -cE 'text-sm([^a-z-]|$)|bg-muted/60' "$f" || true; })" "$(awk 'END{print (NR<=300)?"size-ok":"size-over"}' "$f")"
'''
expect = "wash-ok 0 size-ok"

[[steps]]
kind = "edit"
path = "src/modules/chat/transcript/shapes/StatTiles.tsx"
what = "Per Interfaces I4, every remaining row: StatTiles, FactCard, DecisionMatrix, BeforeAfter, Timeline, VerdictBanner (plus its tone), CheckResults (its tone), Callout (its tone plus ICON_BY_KIND), DiffBlock, LongOutput. Replace each named literal in place and keep every other class."
check = '''
d=src/modules/chat/transcript/shapes; printf '%s %s %s %s\n' "$({ grep -nE 'text-(xs|sm|base|lg|xl|2xl|3xl)([^a-z0-9-]|$)|text-\[[0-9.]+(px|rem)\]' $d/DataTable.tsx $d/FactCard.tsx $d/DecisionMatrix.tsx $d/BeforeAfter.tsx $d/StatTiles.tsx $d/Timeline.tsx $d/VerdictBanner.tsx $d/CheckResults.tsx $d/Callout.tsx $d/DiffBlock.tsx $d/LongOutput.tsx 2>/dev/null || true; } | wc -l | tr -d ' ')" "$(grep -cE 'Lightbulb|MessageSquareWarning|TriangleAlert|OctagonAlert' $d/Callout.tsx)" "$(grep -c 'text-md-stat' $d/StatTiles.tsx)" "$(grep -c 'bg-accent-ink' $d/Timeline.tsx)"
'''
expect_re = "^0 [4-9][0-9]* 1 [1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "src/shared/ui/verve/tokens.css"
what = "Per Interfaces I5: add the [data-text-scale=flow] swap rule (--vv-text-body:1em;--vv-text-meta:.875em) with its one-line comment beside the [data-tone] rules. Then change S1-S14 in src/shared/ui/verve/feedback.css and controls.css in place, value only, each keeping its own px (or var(--text-small)) as the fallback. No other line in those two files changes."
check = '''
v=src/shared/ui/verve; printf '%s %s %s %s %s\n' "$(grep -cF '[data-text-scale="flow"]' $v/tokens.css)" "$(grep -o 'var(--vv-text-meta,' $v/controls.css | wc -l | tr -d ' ')" "$(grep -o 'var(--vv-text-meta,' $v/feedback.css | wc -l | tr -d ' ')" "$(grep -o 'var(--vv-text-body,' $v/feedback.css | wc -l | tr -d ' ')" "$(cat $v/controls.css $v/feedback.css | { grep -c 'data-shape' || true; })"
'''
expect = "1 9 4 1 0"

[[steps]]
kind = "run"
cmd = "npx tsc --noEmit -p tsconfig.json"
check = '''
{ npx tsc --noEmit -p tsconfig.json 2>&1 | grep -cE 'transcript/shapes/(DataTable|DataTableHead|FactCard|DecisionMatrix|BeforeAfter|StatTiles|Timeline|VerdictBanner|CheckResults|Callout|DiffBlock|LongOutput)\.tsx' || true; }
'''
expect = "0"
timeout_s = 600

[[steps]]
kind = "run"
cmd = "npx oxlint src/modules/chat/transcript/shapes"
check = "npx oxlint src/modules/chat/transcript/shapes >/dev/null 2>&1; echo lint-exit=$?"
expect = "lint-exit=0"
timeout_s = 300

[[verify]]
cmd = '''
node .verify/phase-34.mjs 2>&1 | awk '/^\[PASS\] [TC][0-9]+ /{p++} /^\[FAIL\] [TC][0-9]+ /{f++} END{print p+0, f+0}'
'''
expect = "13 0"
timeout_s = 900

[[verify]]
cmd = '''
for s in probe-shapes-tables.mjs probe-shapes-lists.mjs probe-shapes-prose.mjs probe-shapes-fences.mjs probe-shapes-groups.mjs probe-markdown-cards.mjs phase-32.mjs phase-33.mjs; do bash .verify/verve-life-compare.sh "$s"; done | awk '/^SAME-OR-BETTER /{n++} END{print "same-or-better=" n+0}'
'''
expect = "same-or-better=8"
timeout_s = 3600
```

**What to build.** Three parts.
1. The eleven shape bodies from Interfaces I4. Every literal named there is replaced where it stands, and no other class on that element moves.
2. The library size swap from I5. One rule goes in `tokens.css`, and fourteen font-size values in `controls.css` and `feedback.css` read it with today's px kept as the fallback. With that, `Banner`, `Chip`, `Badge`, `Meter` and `Tabs` follow the chat size inside a card and nowhere else.
3. The one-token T5 repair in `.verify/phase-34.mjs` (the first step). Attempt 1 shipped parts 1 and 2 and every other gate went green; T5 alone failed, because the oracle put `surface.titleSizes` into its ratio list unspread (`:326`), which no DOM can pass. A throwaway 20px re-measure showed every size keeping its 16px ratio exactly.

The frame and its `data-text-scale="flow"` marker shipped in Phase 4.

Then look at `.verify/shots/phase-34-light.png` and `-dark.png` with the Read tool before you return. Check four things:
- The `Results:` table's header row is tinted, and its headers are the same size as its cells.
- The callout reads amber.
- The FAIL verdict reads red.
- The stat values are the largest text in their tiles, and their labels are no smaller than body text.

**Why each constraint exists**, so you do not relitigate it:
- **Labels at `text-md-body`.** The labels are DecisionMatrix's "Pros"/"Cons", BeforeAfter's "Before"/"After", FactCard's `dt` and StatTiles' label. Each heads the text beside or under it, and Scott ruled a header is never smaller than its contents. They were 11px or `text-xs` under 14px values, which is his complaint verbatim.
- **Meta at `text-md-meta`.** A count, a delta, a timestamp or a badge is not a header, so 7/8 keeps content ahead of bookkeeping.
- **The size lives in the library, set by a swap.** DESIGN_DOCTRINE §10: "A feature that needs new CSS is *discovering a library gap*" and "Landing a library prop is part of a feature author's job, not scope creep and not a contended-footprint risk." §5's pattern is the mechanism: a container sets inherited custom properties, the component reads them, and no component or screen writes a per-surface rule. Outside a card nothing is set, so every declaration falls back to exactly today's px, and T6 reads that.
- **Tones come from what each shape already reads.** VerdictBanner already chooses `positive`/`danger` for its Banner (`:88`), and CheckResults already paints a `danger` Chip for failures (`:57`). The header takes the same answer, so a card never disagrees with itself.

**Reversible defaults you may take without stopping** (each reversal is one line):
- Table body at `text-md-body`, the same as a reply's prose. Reversal: `text-md-meta` on the `<table>`.
- FactCard `dt` in `text-accent-ink`. Reversal: `text-foreground`.
- Timeline time token in `text-accent-ink`. Reversal: `text-muted-foreground`.
- The swap sets meta at `.875em`. Reversal: the one value in `tokens.css`.

**Sirens.**
- **The other session's lines.** `controls.css` and `feedback.css` carry another session's recent edits. Edit only the fourteen values named in I5, each in place. Never reformat, reorder, re-minify or "tidy" a neighbouring line, and never revert anything you did not write.
- **A new library rule.** You will want to add a `[data-text-scale] .vv-chip { … }` rule, or a `.vv-chip--flow` variant, instead of changing the value in place. Do not. The declaration reads its token; nothing else is added to `controls.css` or `feedback.css`, and the check counts `data-shape` there at 0.
- **A value that is not a plain px.** If a selector in S1–S14 carries no `font-size`, carries it in another form than the table shows, or appears twice, stop and report the selector and its current line verbatim.
- **The oracle.** `.verify/phase-34.mjs` is yours for the one spread token only. You will want to tidy the ratio line, widen a `near` tolerance, or touch another gate you see failing. Do not; the step's check hashes every other byte. If a T or C gate other than T5 still fails after the token, stop and report its `[FAIL]` line verbatim.
- **The frame.** You will want to adjust `ShapeFrame.tsx`'s wash or title now that you can see the bodies. Do not; it is forbidden in this phase. Name it in your report with the screenshot line.
- **`elements/`.** You will see `PlainTable`'s `text-sm` (`elements/table.tsx:28`). Do not change it. Its DOM is pinned by the shapes baseline, and Phase 4's R17 already overrides it on carded surfaces.
- **DataTable's sort.** You will want to restructure the header while adding its colours. The sort permutes the RENDERED rows keyed by original index (08 §"If you change this, check that", `DataTable`'s sort row). Change classes only; `probe-shapes-tables.mjs` in the verify reads whole row tuples.
- **Compounding.** You will want to put `text-md-meta` on a flex row holding a chip. Put sizes on text leaves; a chip inside is already sized by the swap.
- **Divergence.** When reality differs from this chart, stop and report it verbatim. Examples: a literal is not at the line I4 names and the file has two candidates; `CheckResults` has no failure count to read; `DataTable`'s active-sort state lives outside the header row; `tokens.css` has no `[data-tone]` rules.

**Docs the sweep leaves.** `src/shared/ui/verve/README.md` rule 4 gains the size swap beside the tone swap. `docs/architecture/08-rendered-shapes.md` says library pieces inside a frame follow the chat size through it. Phase 9 converges both.

## Phase 6 — Motion: cards rise once, rows follow, meters grow
Depends on: Phase 5

```toml
[phase]
id = "6"
builder = "iris"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 4500
manifest = ["tailwind.config.js", "src/shared/ui/verve/tokens.css", "src/modules/chat/transcript/shapes/collapseState.ts", "src/modules/chat/transcript/shapes/useShapeCollapse.ts", "src/modules/chat/transcript/shapes/shapeMotion.css", "src/modules/chat/transcript/shapes/ShapeFrame.tsx", "src/modules/chat/transcript/Markdown.tsx", ".verify/artifacts/verve-life-after", ".verify/shots"]
forbidden = [".verify/phase-34.mjs", ".verify/artifacts/verve-life-library-sizes.json", ".verify/lib", ".verify/artifacts/verve-life-before", ".verify/artifacts/shapes-elements-baseline.html", "src/modules/chat/transcript/markdownCards.css", "src/modules/chat/transcript/StreamingMarkdown.tsx", "src/modules/chat/transcript/LazyMessageRow.tsx", "src/shared/ui/verve/controls.css", "src/shared/ui/verve/feedback.css", "src/shared/ui/Meter.tsx", "src/shared/ui/Collapsible.tsx", "src/index.css"]
athena = [
  "An animation touches a property other than opacity and transform (height, margin, colour, filter, box-shadow), or a hover transition on colour is added, breaking verve README rule 5",
  "vv-meter-grow carries a to frame or forwards fill, so every meter bar ends at full width instead of its value",
  "data-vv-enter is written in an export (interactive false) or on the streaming half, so a saved transcript or a half-arrived block animates",
  "The entrance memory is wrong: a remount of an unchanged card rises again, the key is marked during render so the first appearance never rises, enter is recomputed on a later render of the same mount, or it keys on anything but collapseKey",
  "A rule sits outside the prefers-reduced-motion: no-preference media block, in shapeMotion.css or in tokens.css, so reduced-motion readers still get a rise or a grow",
  "The item stagger ends past 400 ms (delay plus duration), which the harness's 400 ms animation cap would read mid-flight",
  "Element cards (plain ul, blockquote, footnotes) gained an animation, which replays each time a streaming block settles into the other half",
  "The M2 selector reaches nested li li, or rows of a table inside a callout body, so a stagger restarts inside a stagger",
]

[[steps]]
kind = "edit"
path = "tailwind.config.js"
what = "Per Interfaces I6: add exactly two animation entries, 'shape-rise' and 'shape-item', with the strings I6 gives. The keyframes key does not change, and nothing named shape-grow exists."
check = '''
printf '%s %s %s\n' "$(grep -cE "'shape-(rise|item)':" tailwind.config.js)" "$(grep -cF "'shape-rise': 'vv-rise var(--dur-move) var(--ease-enter) both'" tailwind.config.js)" "$({ grep -c 'shape-grow' tailwind.config.js || true; })"
'''
expect = "2 1 0"

[[steps]]
kind = "edit"
path = "src/shared/ui/verve/tokens.css"
what = "Per Interfaces I6: directly after the existing @keyframes lines add the one-line comment, @keyframes vv-meter-grow{from{transform:scaleX(0)}} and the media rule @media screen and (prefers-reduced-motion: no-preference){[data-vv-enter] .vv-meter__fill{animation:vv-meter-grow var(--dur-move) var(--ease-enter) backwards}}, in the file's minified style. Nothing else in the file changes."
check = '''
f=src/shared/ui/verve/tokens.css; printf '%s %s\n' "$(grep -cF '@keyframes vv-meter-grow{from{transform:scaleX(0)}}' "$f")" "$(grep -cF '[data-vv-enter] .vv-meter__fill{animation:vv-meter-grow var(--dur-move) var(--ease-enter) backwards}' "$f")"
'''
expect = "1 1"

[[steps]]
kind = "edit"
path = "src/modules/chat/transcript/shapes/collapseState.ts"
what = "Per Interfaces I6, entrance memory: add hasEntered(key) and markEntered(key) over a module-level Set beside the fold map, documented. In useShapeCollapse.ts add enter to the return: captured once per mount on the first render where interactive is true (a useRef set to !hasEntered(collapseKey) then), and marked by useEffect(() => { if (interactive) markEntered(collapseKey); }, [interactive, collapseKey])."
check = '''
printf '%s %s\n' "$(grep -cE '^export function (hasEntered|markEntered)\(key: string\)' src/modules/chat/transcript/shapes/collapseState.ts)" "$(grep -cE 'markEntered|hasEntered' src/modules/chat/transcript/shapes/useShapeCollapse.ts | awk '{print ($1>=2)?"hook-ok":"hook-missing"}')"
'''
expect = "2 hook-ok"

[[steps]]
kind = "edit"
path = "src/modules/chat/transcript/shapes/shapeMotion.css"
what = "Create the stylesheet per Interfaces I6: ONE @media screen and (prefers-reduced-motion: no-preference) block holding M1, M2 and M2b keyed on [data-vv-enter], every declaration an @apply, a one-line comment per rule, and a header comment of at most 6 lines saying: frames only, never element cards, and why; the meter's grow-in lives in tokens.css. Add import '@/modules/chat/transcript/shapes/shapeMotion.css'; to Markdown.tsx directly after its markdownCards.css import, and nothing else there."
check = '''
printf '%s %s\n' "$(curl -s 'http://127.0.0.1:5183/src/modules/chat/transcript/shapes/shapeMotion.css?direct' | awk '/@apply/{a++} /prefers-reduced-motion: ?no-preference/{m++} /data-vv-enter/{s++} /!important/{i++} END{print "apply=" a+0, "media=" m+0, "important=" i+0, (s>=3)?"scope=ok":"scope=low"}')" "$(grep -cF "import '@/modules/chat/transcript/shapes/shapeMotion.css';" src/modules/chat/transcript/Markdown.tsx)"
'''
expect = "apply=0 media=1 important=0 scope=ok 1"

[[steps]]
kind = "edit"
path = "src/modules/chat/transcript/shapes/ShapeFrame.tsx"
what = "Per Interfaces I2 and I6: read enter from useShapeCollapse and put data-vv-enter=\"\" on the root when enter is true, no attribute otherwise. No other change to the file."
check = '''
printf '%s %s\n' "$(grep -cE 'data-vv-enter=\{[^}]*enter' src/modules/chat/transcript/shapes/ShapeFrame.tsx)" "$({ grep -c 'data-shape-enter' src/modules/chat/transcript/shapes/ShapeFrame.tsx || true; })"
'''
expect = "1 0"

[[steps]]
kind = "run"
cmd = "npx tsc --noEmit -p tsconfig.json"
check = '''
{ npx tsc --noEmit -p tsconfig.json 2>&1 | grep -cE 'transcript/shapes/(ShapeFrame|useShapeCollapse|collapseState)\.tsx?|transcript/Markdown\.tsx' || true; }
'''
expect = "0"
timeout_s = 600

[[steps]]
kind = "run"
cmd = "npx oxlint src/modules/chat/transcript/shapes/ShapeFrame.tsx src/modules/chat/transcript/shapes/useShapeCollapse.ts src/modules/chat/transcript/shapes/collapseState.ts src/modules/chat/transcript/Markdown.tsx"
check = "npx oxlint src/modules/chat/transcript/shapes/ShapeFrame.tsx src/modules/chat/transcript/shapes/useShapeCollapse.ts src/modules/chat/transcript/shapes/collapseState.ts src/modules/chat/transcript/Markdown.tsx >/dev/null 2>&1; echo lint-exit=$?"
expect = "lint-exit=0"
timeout_s = 300

[[verify]]
cmd = '''
node .verify/phase-34.mjs 2>&1 | awk '/^\[PASS\] M[0-9]+ /{p++} /^\[FAIL\] M[0-9]+ /{f++} END{print p+0, f+0}'
'''
expect = "8 0"
timeout_s = 900

[[verify]]
cmd = '''
for s in probe-shapes-tables.mjs probe-shapes-lists.mjs probe-shapes-groups.mjs probe-shapes-fences.mjs probe-markdown-cards.mjs phase-32.mjs phase-33.mjs; do bash .verify/verve-life-compare.sh "$s"; done | awk '/^SAME-OR-BETTER /{n++} END{print "same-or-better=" n+0}'
'''
expect = "same-or-better=7"
timeout_s = 3600
```

**What to build.** Motion, and the memory that makes it an arrival rather than a mount. Build exactly Interfaces I6.
- Every framed card rises with Verve's own `vv-rise` (`tokens.css:157`) the first time it appears in the page.
- Its rows, items, tiles and option cards follow with `vv-pagein` in a 30 ms stagger.
- A meter's fill grows from zero to its value, by the library's own `vv-meter-grow`.

All of it keys on one marker, `data-vv-enter`, which `ShapeFrame` writes only while `useShapeCollapse` says this card has not yet entered.

Then look at the two screenshots, taken after animations settle, to confirm nothing ended mid-flight: every bar at its value and every card fully opaque. Also watch a live settle once: write a throwaway script under `/tmp` (never under `.verify/`) that mounts through `feedStreaming` from `.verify/lib/shapes-fixture.mjs:225`. A table the reader already saw as plain markdown should rise as it settles, not blink.

**Why each constraint exists**, so you do not relitigate it:
- **Remembered by content.** `LazyMessageRow` unmounts rows as they scroll away (`LazyMessageRow.tsx:8-9,83`), and about a third of replies retract a settled block once (`docs/architecture/02-realtime-stream.md` §"Incremental markdown rendering"). Keyed on mount, every scroll back would replay every card. A fold already survives both by a module-level map keyed on `shapeKey` (08 rule 7), and the entrance uses the same key, beside it.
- **Captured once, marked on commit.** Marking during render would mark the key before the first appearance could rise. Recomputing on a later render would drop the attribute mid-animation.
- **Frames only; element cards never.** A plain list, a quotation and the footnotes render identically in the streaming and settled halves and carry no key, so a CSS entrance would play while a list streams and again when it settles. Frames exist only in the settled half.
- **The meter's grow-in is the library's.** Verve draws a grow-in (`vv-grow-x`), and "If Verve draws it, it is in the library" (DESIGN_DOCTRINE §1). It is keyed on the same library marker, so any future surface that marks an entrance gets it.
- **Opacity and transform only, ≤ 400 ms.** Those two properties move no layout. Rule 5 bans colour animation outside a theme flip. `probe-markdown-cards.mjs:125-148` waits animations out with a 400 ms cap.
- **`vv-meter-grow` has no `to`.** The meter's value is its inline `transform: scaleX(p)` (`Meter.tsx:42`).

**Reversible defaults you may take without stopping** (each reversal is one line):
- Card entrance `vv-rise` (18px with a fade). Reversal: a transform-only keyframe in `tokens.css` named in `shape-rise`, if a settling table reads as a blink.
- Stagger step 30 ms, capped at the 6th item. Reversal: the M2b delay values.
- A table sort re-plays the row stagger, because React moves the rows and moving an element restarts its CSS animation. Reversal: M2 drops `tbody > tr`.
- If oxlint refuses reading a ref during render, capture `enter` with `useState` instead: its lazy initialiser runs on the first render, so the semantics are the same whenever `interactive` is already known there.

**Sirens.**
- **Element cards.** You will want to give plain lists and quotations the rise too; Scott asked for "everything". Do not. The replay mechanism is measured, not a taste call, and it is recorded in Decisions with its reversal.
- **Clearing the memory.** You will want a `clearEntered`, or to evict old keys. The set grows only by cards that rose, like the fold map. Nothing removes a key.
- **Hover.** You will want a hover lift. Verve lifts only interactive cards (`controls.css:150`).
- **`vv-anim`.** You will see `body.vv-anim` in `tokens.css:178`. Leave it; it is the theme flip's half-second and kills transitions only.
- **A red layout gate.** If `probe-shapes-groups.mjs` or `phase-32.mjs` reports a position or box gate as NEW-FAIL, a rise's transform was measured mid-flight. Stop and report the gate line verbatim; never weaken a probe or lengthen its wait.
- **First appearance does not rise.** If M1 fails because `enter` reads false on a card's first appearance (for example `interactive` is false on every first render, or a development double-render marks the key early), stop and report which. Do not move the mark into render.
- **Divergence.** When reality differs from this chart, stop and report it verbatim. Examples: `useShapeCollapse` has no `interactive` in its return; Tailwind refuses an `animation` value naming a keyframe it did not define (`vv-rise` lives in `tokens.css`); `collapseState.ts` holds its fold map somewhere other than module scope.

**Docs the sweep leaves.** `docs/architecture/08-rendered-shapes.md` rule 7 covers entrances beside folds, plus the motion rules: frames only, the marker, the export and streaming answers, the 400 ms ceiling, and why element cards do not animate. Phase 9 converges it.

## Phase 7 — Embedded DocSpace and the HTML widget wear the card header
Depends on: Phase 6

```toml
[phase]
id = "7"
builder = "iris"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 4500
manifest = ["src/modules/widgets/WidgetFrame.tsx", "src/modules/widgets/DocSpaceFrame.tsx", "src/modules/widgets/docspaceOrigin.ts", "src/shared/types.ts", "src/modules/chat/transcript/shapes/code/EmbedFrame.tsx", "src/modules/chat/transcript/shapes/code/index.tsx", "src/modules/i18n/locales/de/chat.json", "src/modules/i18n/locales/en/chat.json", "src/modules/i18n/locales/es/chat.json", "src/modules/i18n/locales/fr/chat.json", "src/modules/i18n/locales/it/chat.json", "src/modules/i18n/locales/ja/chat.json", "src/modules/i18n/locales/ko/chat.json", "src/modules/i18n/locales/ru/chat.json", "src/modules/i18n/locales/tr/chat.json", "src/modules/i18n/locales/zh-CN/chat.json", "src/modules/i18n/locales/zh-TW/chat.json", ".verify/phase-33.mjs", ".verify/probe-shapes-fences.mjs", ".verify/artifacts/verve-life-after", ".verify/shots"]
forbidden = ["src/modules/widgets/index.ts", "src/modules/widgets/classifyWidgetBody.ts", "src/modules/widgets/buildWidgetDocument.ts", "src/modules/widgets/widgetBridgeScript.ts", "src/modules/widgets/hooks", "src/modules/chat/transcript/shapes/ShapeFrame.tsx", "src/modules/chat/transcript/shapes/shapeMotion.css", ".verify/phase-34.mjs", ".verify/artifacts/verve-life-library-sizes.json", ".verify/phase-22.mjs", ".verify/phase-28.mjs", ".verify/phase-29.mjs", ".verify/lib", ".verify/artifacts/verve-life-before", ".verify/artifacts/shapes-elements-baseline.html"]
athena = [
  "frame is invoked on the pre, the error card, or before mount, so an export or a streaming fence carries a DocSpace header over raw source",
  "DOCSPACE_SANDBOX or the HTML widget's sandbox changed, isForeignOrigin is consulted later than before, or the key={code} on either inner element was dropped or moved onto the framer's output",
  "Chat re-decides the widget kind: classifyWidgetBody or a JSON parse appears anywhere under src/modules/chat, or the widgets barrel gained exports for it",
  "The studio link is built from anything but the classified, id-checked ref, or lacks rel noopener noreferrer",
  "Folding the frame unmounts or re-srcs the iframe, discarding what the reader typed into the block",
  "The framed wrapper keeps its rounded border, so the embed shows a frame inside the frame, or an unframed caller (phase-22, 28, 29) lost its border",
  "A locale file gained keys outside shapes.titles.widget, shapes.titles.docspace and shapes.openInArchPulse, broke JSON, or translated the product names",
  "phase-33's new DocSpace block makes a gate depend on ArchPulse being up or on the block's content, rather than on the frame the app draws",
]

[[steps]]
kind = "edit"
path = "src/modules/widgets/docspaceOrigin.ts"
what = "Per Interfaces I7: add docspaceStudioUrl(pageId, blockId), resolving the origin exactly as docspaceEmbedUrl does, with a consumer comment naming WidgetFrame. Add the two documented types WidgetEmbed and WidgetEmbedFramer to src/shared/types.ts inside its LIVE WIDGETS group."
check = '''
printf '%s %s\n' "$(grep -cE '^export function docspaceStudioUrl\(pageId: string, blockId: string\): string' src/modules/widgets/docspaceOrigin.ts)" "$(grep -cE '^export type (WidgetEmbed|WidgetEmbedFramer) =' src/shared/types.ts)"
'''
expect = "1 2"

[[steps]]
kind = "edit"
path = "src/modules/widgets/WidgetFrame.tsx"
what = "Per Interfaces I7: add the optional frame prop (WidgetEmbedFramer) and call it on the docspace and html LIVE branches only, exactly as I7 spells them (frame({ kind: 'docspace', studioUrl: ... }, live) and frame({ kind: 'html', studioUrl: null }, live)), with framed={Boolean(frame)} on DocSpaceFrame and WidgetFrameLive and key={code} kept on those inner elements. DocSpaceFrame.tsx gains framed. Add the one sentence to the fork comment. The pre fallback, WidgetErrorCard, both sandboxes and every timer stay byte-identical."
check = '''
w=src/modules/widgets; printf '%s %s %s\n' "$(cat $w/WidgetFrame.tsx $w/DocSpaceFrame.tsx | grep -cF 'my-3 overflow-hidden rounded-xl border border-border bg-card')" "$(grep -cE "frame\(\{ kind: '(docspace|html)'" $w/WidgetFrame.tsx)" "$(cat $w/WidgetFrame.tsx $w/DocSpaceFrame.tsx | grep -c 'key={code}')"
'''
expect = "2 2 2"

[[steps]]
kind = "edit"
path = "src/modules/chat/transcript/shapes/code/EmbedFrame.tsx"
what = "Create EmbedFrame per Interfaces I7: it draws only the ShapeFrame (flush) and, when studioUrl is non-null, the Open in ArchPulse link; its props are WidgetEmbed from @/shared/types plus code and children; it imports nothing from @/modules/widgets. Change the CodeBlock widget branch in shapes/code/index.tsx to: return <WidgetFrame code={raw} streaming={streaming} frame={(embed, live) => <EmbedFrame {...embed} code={raw}>{live}</EmbedFrame>} />;"
check = '''
printf '%s %s %s\n' "$(grep -cF 'frame={(embed, live) => <EmbedFrame {...embed} code={raw}>{live}</EmbedFrame>}' src/modules/chat/transcript/shapes/code/index.tsx)" "$(grep -cE 'data-docspace-open|noopener noreferrer' src/modules/chat/transcript/shapes/code/EmbedFrame.tsx)" "$({ grep -rc 'classifyWidgetBody' src/modules/chat || true; } | awk -F: '{s+=$NF} END{print s+0}')"
'''
expect_re = "^1 [2-9][0-9]* 0$"

[[steps]]
kind = "edit"
path = "src/modules/i18n/locales/en/chat.json"
what = "Per Interfaces I7, i18n: in all eleven chat.json add shapes.titles.widget, shapes.titles.docspace and shapes.openInArchPulse (English: Widget, DocSpace block, Open in ArchPulse), translated in the other ten with DocSpace and ArchPulse kept as product names. No other key moves."
check = '''
node -e "const fs=require('fs');const d='src/modules/i18n/locales';let n=0;for(const l of fs.readdirSync(d)){const p=d+'/'+l+'/chat.json';if(!fs.existsSync(p))continue;const s=JSON.parse(fs.readFileSync(p,'utf8')).shapes||{};if(s.titles&&s.titles.widget&&s.titles.docspace&&s.openInArchPulse&&s.titles.docspace.includes('DocSpace')&&s.openInArchPulse.includes('ArchPulse'))n++;}const e=JSON.parse(fs.readFileSync(d+'/en/chat.json','utf8')).shapes;console.log('locales='+n, e.titles.widget+'|'+e.titles.docspace+'|'+e.openInArchPulse)"
'''
expect = "locales=11 Widget|DocSpace block|Open in ArchPulse"

[[steps]]
kind = "edit"
path = ".verify/phase-33.mjs"
what = "In GALLERY_BLOCKS add two blocks at the end of the shapes section: 'A widget fence draws a live frame.' followed by a widget fence whose body is <div style=\"padding:12px\">a live widget</div>, and 'A DocSpace block embeds in place.' followed by a widget fence whose body is {\"kind\":\"docspace\",\"pageId\":\"page-1789426608499-001-ng2x42\",\"blockId\":\"blk-1789426608492-000-15ou60\"}. Add 'widget' and 'docspace' to the constant of expected data-shape kinds. The one gate-logic change allowed: the console-error gate (\"the run raised no console error and no page error while signed in\") filters the standing sandbox noise line `Failed to read the 'serviceWorker' property` by name, as a `SANDBOX_SW_NOISE` constant, exactly as the other probes that mount a sandboxed srcdoc widget already forgive it — the widget block is the first opaque-origin iframe this gallery mounts, and `.verify/lib/console.mjs`'s serviceWorker init script throws inside it twice. No other gate changes."
check = '''
f=.verify/phase-33.mjs; printf '%s %s %s\n' "$(grep -cF 'page-1789426608499-001-ng2x42' "$f")" "$(grep -cF 'A widget fence draws a live frame.' "$f")" "$( [ "$(grep -c 'SANDBOX_SW_NOISE' "$f")" -ge 2 ] && echo 1 || echo 0)"
'''
expect = "1 1 1"

[[steps]]
kind = "edit"
path = ".verify/probe-shapes-fences.mjs"
what = "The fixture's widget fence now wears the card frame this phase mandates (EmbedFrame → ShapeFrame kind=\"widget\"), so the frozen expected-kinds list near :65 predates it. Append 'widget' to that list, so it reads ['stats', 'diff', 'output', 'output', 'widget']. Change nothing else in the file."
check = '''
grep -cE "\['stats', 'diff', 'output', 'output', 'widget'\]" .verify/probe-shapes-fences.mjs
'''
expect = "1"

[[steps]]
kind = "run"
cmd = "npx tsc --noEmit -p tsconfig.json"
check = '''
{ npx tsc --noEmit -p tsconfig.json 2>&1 | grep -cE 'modules/widgets/|transcript/shapes/code/(EmbedFrame|index)\.tsx|shared/types\.ts' || true; }
'''
expect = "0"
timeout_s = 600

[[steps]]
kind = "run"
cmd = "npx oxlint src/modules/widgets src/modules/chat/transcript/shapes/code"
check = "npx oxlint src/modules/widgets src/modules/chat/transcript/shapes/code >/dev/null 2>&1; echo lint-exit=$?"
expect = "lint-exit=0"
timeout_s = 300

[[verify]]
cmd = '''
node .verify/phase-34.mjs 2>&1 | awk '/^\[PASS\] E[0-9]+ /{p++} /^\[FAIL\] E[0-9]+ /{f++} END{print p+0, f+0}'
'''
expect = "6 0"
timeout_s = 900

[[verify]]
cmd = '''
for s in phase-22.mjs phase-28.mjs phase-29.mjs probe-shapes-fences.mjs phase-32.mjs phase-33.mjs; do bash .verify/verve-life-compare.sh "$s"; done | awk '/^SAME-OR-BETTER /{n++} END{print "same-or-better=" n+0}'
'''
expect = "same-or-better=6"
timeout_s = 3600
```

**What to build.** Scott wrote "you're hiding it from me means that it probably doesn't work". It does work, and it was measured before this plan was charted:
- `phase-28.mjs`: 17 of 17 PASS.
- `phase-29.mjs`: 12 of 12 PASS, with a real block embedded, edited in the frame and read back in ArchPulse's studio.
- One model reply in this conversation carried a real embed (`~/.claude/projects/-home-lyphe--claude-claudecodeui-lyphe/caad59e6-761d-4c77-af32-d0b4c45d1db8.jsonl:2772`).

What it lacked is the look: a bordered box with no title, no icon and no way out to the studio. This phase gives both live embed kinds the header every other card wears, plus "Open in ArchPulse" on a DocSpace block. Build exactly Interfaces I7.

The shape of it is an inversion. The widgets module still alone decides what a fence body is and whether a live frame may exist. The chat module hands it a `frame` function, and `WidgetFrame` calls that function only after its own gates have passed.

**Why each constraint exists**, so you do not relitigate it:
- **The fork stays behind the gates.** `WidgetFrame.tsx:84-88`: "The fork sits BEHIND both gates, and that is the whole reason it is in this file rather than in `CodeBlock`. Forking upstream would put it in front of them." 07's change table pins the export: `buildTranscriptHtml` still exports a `<pre>` and no `<iframe>`. An export runs no effects, so a chat-side classifier would frame raw JSON as a "DocSpace block". E6 reads that export.
- **`framed` drops the wrapper's border, nothing else.** The frame is the border. The sandbox strings, `isForeignOrigin`, the ready timer and `key={code}` are the security and revoke contract of `docs/architecture/07-live-widgets.md` ("Do not remove the key without removing the counter; each is the other's premise").
- **Folding is safe.** `CollapsibleContent` keeps its children mounted (`src/shared/ui/Collapsible.tsx:82-104`), so the iframe is never unmounted and never re-`src`ed; E4 proves it.
- **The link, not a proxy.** `/#page=<pageId>&block=<blockId>` is ArchPulse's own deep link (`~/.claude/ArchPulse/README.md:21`), opened in a new tab on ArchPulse's origin. 07 §"The DocSpace kind": "Never proxy port 8005 through this app's Express or Vite."
- **phase-33's DocSpace block.** It names the real block this conversation already showed, so the gallery shots show a real embed. No gate reads the block's content.

**Reversible defaults you may take without stopping** (each reversal is one line):
- The action label "Open in ArchPulse". Reversal: the `shapes.openInArchPulse` values.
- The HTML widget is framed with the title "Widget". Reversal: `EmbedFrame` returns `<>{children}</>` when `kind === 'html'`.

**Sirens.**
- **Classifying in chat.** You will want `CodeBlock` or `EmbedFrame` to parse the body so it can pick a title before `WidgetFrame` renders. Do not. The kind arrives in the `frame` call, and the check counts `classifyWidgetBody` under `src/modules/chat` at 0.
- **Exporting more from widgets.** You will want to add `classifyWidgetBody` or `docspaceStudioUrl` to `src/modules/widgets/index.ts`. The barrel is forbidden and gains nothing; `WidgetFrame` consumes the URL helper inside its own module.
- **The sandbox.** While threading `frame` through, you will want to tidy `DOCSPACE_SANDBOX` or `FALLBACK_CLASSES`. Do not. `phase-28.mjs` gate 1 compares the sandbox with `===`.
- **The key.** You will want to put `key={code}` on the framer's output instead of the inner element. Do not. The key belongs to the element whose `load` count it resets.
- **The embed probes.** `phase-22/28/29.mjs` mount `WidgetFrame` with no `frame`, so they exercise the unframed path unchanged; all three are forbidden. A NEW-FAIL there means the embed regressed: fix the code.
- **ArchPulse down.** If `phase-29.mjs` reports `[FAIL] the run reached its end (fetch failed)`, check `systemctl is-active archpulse`. If it is not active, that line is the service, not this phase (`docs/verification.md` §"The dev server"). Record it and let the compare line speak. Never start, stop or restart a unit.
- **Divergence.** When reality differs from this chart, stop and report it verbatim. Examples: `resolveDocSpaceOrigin` needs an argument `docspaceEmbedUrl` does not pass; `WidgetFrame` has a caller other than `CodeBlock` and the three probes; `src/shared/types.ts` has no `LIVE WIDGETS` group; phase-33 renders its gallery without `LiveBusProvider`.

**Docs the sweep leaves.** `docs/architecture/07-live-widgets.md` gets the `frame` function, the `framed` prop, the studio link, and why the frame is applied behind the gates, in §"The pieces" and §"The DocSpace kind". `docs/chat-contracts.md` §7 says a live embed wears the card header, and an export or a streaming fence does not. Phase 9 converges both.

## Phase 8 — Links and code blocks join Verve, with the baseline widened on proof
Depends on: Phase 7

```toml
[phase]
id = "8"
builder = "iris"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 3600
manifest = ["src/modules/chat/transcript/shapes/MarkdownLink.tsx", "src/modules/chat/transcript/shapes/code/CodeFence.tsx", "src/modules/markdown-preview/MermaidDiagram.tsx", ".verify/artifacts/verve-life-retone.sed", ".verify/artifacts/shapes-elements-baseline.html", ".verify/artifacts/verve-life-after", ".verify/shots", ".verify/probe-shapes-baseline.mjs"]
forbidden = [".verify/phase-34.mjs", ".verify/artifacts/verve-life-library-sizes.json", ".verify/lib", ".verify/artifacts/verve-life-before", "src/modules/chat/transcript/shapes/ShapeFrame.tsx", "src/modules/chat/transcript/shapes/elements", "src/modules/chat/transcript/markdownCards.css", "src/modules/chat/transcript/shapes/InlineMarks.tsx"]
athena = [
  "The sed script is broad (a bare 'blue' or 'zinc' pattern, or a regex rather than the exact class string) so the proof would pass a change nobody intended",
  "The baseline was re-captured before the sed proof could fail, or the proof ignores more than the provenance comment lines, laundering a neighbour's DOM change into the pinned artifact",
  "A link lost its underline at rest, so colour became the whole signal, or a transition on the anchor still animates colour",
  "The code block's label or code size is still rem, or the inline style became a class on another element and moved the DOM beyond the sed script",
  "MermaidDiagram's edit reached beyond its one dark literal, changing the PRD editor's diagram frame",
  "The copied tick now reads as a neutral grey instead of the accent ink, or its opacity toggle was lost",
  "The probe edit reached beyond line 355 — its --write, --force or --note handling, its provenance lines, or another gate — so the rules that make a widening visible changed along with the widening",
  "The re-keyed fence gate counts a marker that some element other than the two FenceBlock shells could also carry, so a fence that failed to render would still pass it",
  "MermaidDiagram.tsx:106's live-diagram container paints a light block behind the dark-themed diagram in dark mode, or took a palette, hex or arbitrary colour instead of a Tailwind token",
]

[[steps]]
kind = "edit"
path = "src/modules/chat/transcript/shapes/MarkdownLink.tsx"
what = '''
Per Interfaces I8: MarkdownLink's two class strings (:70,84) become text-accent-ink underline decoration-accent-ink/40 underline-offset-2 hover:decoration-accent-ink, dropping any transition utility on the anchor; a cursor-pointer on the file-ref anchor stays. Also apply I8 to CodeFence.tsx (:116 shell drops dark:bg-zinc-900, :119 label text-md-meta, :131 copied tick text-accent-ink opacity-100, :183 fontSize '0.875em').
MermaidDiagram.tsx carries TWO dark:bg-zinc-900, and this check requires zero in the three files: (a) :84, the source <pre> beside bg-muted/50 — drop dark:bg-zinc-900, nothing else; (b) :106, the live-diagram container spelled bg-white ... dark:bg-zinc-900 — replace that pair with bg-card (the surface token: white in light, the dark surface in dark, where mermaid.initialize at :56 renders theme 'dark'). Every other class on both elements stays. Neither Mermaid element is in the baseline document (the pre-change artifact holds exactly 2 bg-muted/50, both FenceBlock shells), so no sed line is written for them.
These edits may already be in the tree from the blocked attempt: read each file first and leave a literal that already reads as specified untouched.
'''
check = '''
printf '%s %s %s\n' "$(cat src/modules/chat/transcript/shapes/MarkdownLink.tsx src/modules/chat/transcript/shapes/code/CodeFence.tsx src/modules/markdown-preview/MermaidDiagram.tsx | { grep -cE '(blue|green|zinc)-[0-9]' || true; })" "$(grep -c 'text-md-meta' src/modules/chat/transcript/shapes/code/CodeFence.tsx)" "$(grep -cF "fontSize: '0.875em'" src/modules/chat/transcript/shapes/code/CodeFence.tsx)"
'''
expect_re = "^0 [1-9][0-9]* 1$"

[[steps]]
kind = "edit"
path = ".verify/artifacts/verve-life-retone.sed"
what = "Write one exact s|old|new|g line per class or style string this phase changed AS THE BASELINE DOCUMENT'S DOM SERIALISES IT (read .verify/artifacts/verve-life-before/shapes-elements-baseline.html to see each old string's serialised spelling; an inline fontSize serialises as font-size in a style attribute). Escape sed metacharacters. Allow comment lines starting with #. No other line. The blocked attempt left this file with 4 substitutions (links, the shell's dark variant, the label, the font-size); when it already matches this rule, keep it as it is."
check = '''
awk '/^s\|/{s++; next} /^#/ || NF==0 {next} {bad++} END{print "subs=" (s>=2 ? "ok" : "low"), "bad=" bad+0}' .verify/artifacts/verve-life-retone.sed
'''
expect = "subs=ok bad=0"

[[steps]]
kind = "edit"
path = ".verify/probe-shapes-baseline.mjs"
what = '''
Re-key the ONE gate that counts the literal this phase removes. Line 355 today reads, verbatim:
ok('both fences rendered through the highlighter', countOf(/dark:bg-zinc-900/g) === 2, `${countOf(/dark:bg-zinc-900/g)} code wrappers`);
Replace that whole line with exactly this line (no indentation, nothing after the semicolon):
ok('both fences rendered through the highlighter', countOf(/bg-muted\/50 shadow-sm"/g) === 2, `${countOf(/bg-muted\/50 shadow-sm"/g)} code wrappers`);
Why this marker: in the pre-change artifact the 2 occurrences of dark:bg-zinc-900 are the two FenceBlock shells, spelled bg-muted/50 shadow-sm dark:bg-zinc-900" — bg-muted/50 occurs nowhere else in the document — and the sed line that drops the dark variant turns both into bg-muted/50 shadow-sm" (the closing quote pins that the shell's class list ends there). Without this, --write refuses with BASELINE: NOT CAPTURED and the widening can never be recorded.
No other line of the file changes: not its flags, not its provenance code, not any other gate. The check hashes every line except 355 against today's file and line 355 against the exact text above.
'''
check = '''
printf 'other=%s line=%s\n' "$(awk 'NR!=355' .verify/probe-shapes-baseline.mjs | sha256sum | cut -c1-12)" "$(sed -n 355p .verify/probe-shapes-baseline.mjs | sha256sum | cut -c1-12)"
'''
expect = "other=a1837c4e5b1d line=2ad7f85fd0c9"

[[steps]]
kind = "run"
cmd = '''
cp .verify/artifacts/verve-life-before/shapes-elements-baseline.html .verify/artifacts/shapes-elements-baseline.html && node .verify/probe-shapes-baseline.mjs --write --force --note="verve-life Phase 8: link and code-block re-tone, proven by .verify/artifacts/verve-life-retone.sed" > .verify/artifacts/verve-life-after/baseline-recapture.txt 2>&1; true
'''
check = '''
diff <(sed -f .verify/artifacts/verve-life-retone.sed .verify/artifacts/verve-life-before/shapes-elements-baseline.html | grep -v '^<!--') <(grep -v '^<!--' .verify/artifacts/shapes-elements-baseline.html) >/dev/null && echo RETONE-EXACT || echo RETONE-MISMATCH
'''
expect = "RETONE-EXACT"
timeout_s = 900

[[steps]]
kind = "run"
cmd = "npx tsc --noEmit -p tsconfig.json"
check = '''
{ npx tsc --noEmit -p tsconfig.json 2>&1 | grep -cE 'shapes/MarkdownLink\.tsx|shapes/code/CodeFence\.tsx|markdown-preview/MermaidDiagram\.tsx' || true; }
'''
expect = "0"
timeout_s = 600

[[verify]]
cmd = '''
node .verify/phase-34.mjs 2>&1 | awk '/^\[PASS\] F[0-9]+ /{p++} /^\[FAIL\] F[0-9]+ /{f++} END{print p+0, f+0}'
'''
expect = "3 0"
timeout_s = 900

[[verify]]
cmd = '''
node .verify/probe-shapes-baseline.mjs 2>&1 | awk '/^\[FAIL\] /{f++} /^BASELINE: /{b=$0} END{print "fail=" f+0 " " b}'
'''
expect = "fail=0 BASELINE: DOM identical"
timeout_s = 900

[[verify]]
cmd = '''
grep -c '^<!-- baseline capture' .verify/artifacts/shapes-elements-baseline.html
'''
expect = "4"

[[verify]]
cmd = '''
for s in probe-shapes-inline.mjs probe-shapes-fences.mjs probe-shapes-groups.mjs probe-markdown-cards.mjs phase-32.mjs phase-33.mjs; do bash .verify/verve-life-compare.sh "$s"; done | awk '/^SAME-OR-BETTER /{n++} END{print "same-or-better=" n+0}'
'''
expect = "same-or-better=6"
timeout_s = 3600
```

**What to build.** The last two pieces of transcript markup still painted off Verve's palette, and a deliberate, proven widening of the one artifact that pins their DOM.

The pieces are:
- links in `text-blue-600`;
- code blocks with a `zinc` dark shell and a `green` copied tick;
- the code block's `rem` label and code size.

`docs/architecture/08-rendered-shapes.md` §"Gotchas" names exactly these literals and says "A re-tone is its own change, with its own baseline re-capture". That is this phase.

**The order is load-bearing.**
1. Make the source edits.
2. Write the sed script from the PRE-change artifact copy Phase 1 took.
3. Re-key the one probe gate that counts the removed literal (`.verify/probe-shapes-baseline.mjs:355`).
4. Run the re-capture ONCE, starting from the pre-change copy (the step's command copies it back first).

The runner's check then proves the widening. The sed script applied to the old bytes must reproduce the new bytes exactly, provenance comments aside. If any other byte moved, whether a class you did not intend to change or a neighbour's in-flight DOM change, the proof reads `RETONE-MISMATCH` and the phase does not ship. The pre-change artifact carries 4 provenance lines, 3 of them opening `<!-- baseline capture`; one sanctioned capture makes that count 4, which the third verify reads.

**Why each constraint exists**, so you do not relitigate it:
- **The re-capture is sanctioned, the laundering is not.** `docs/verification.md:903-918`: "The artifact is never rewritten to make a comparison pass," and `--write --force` is the "deliberately re-capture" form that records `DIVERGED at offset N` in the file. A widening is legitimate only when every divergent byte is the intended one, and the sed proof is what shows that.
- **The one probe line.** The first attempt blocked because the probe's gate "both fences rendered through the highlighter" counted `dark:bg-zinc-900`, the exact literal I8 removes, so `--write` refused (`BASELINE: NOT CAPTURED (a gate above failed — nothing was written)`). The re-keyed gate still asks its own question — two fences reached the highlighter — against the marker the shell keeps. Its step's check pins the other 476 lines by hash, so the edit cannot reach the capture rules.
- **An underline at rest.** DESIGN_DOCTRINE §6: "Every state that speaks in colour also carries a mark, glyph, or word." A green link with no underline is colour alone.
- **No transition on the anchor.** `docs/verification.md` records that `MarkdownLink` gives every anchor `transition: all 0.15s`. Verve README rule 5: "no always-on colour transition comes back." If that transition comes from a class in `MarkdownLink.tsx`, remove it and add its line to the sed script. If it comes from elsewhere (Typography, `index.css`), leave it and name its source in your report. The first attempt measured it: `src/index.css:145-153`, a `@layer base` rule over `button, a, input, textarea, select, [role="button"], .transition-all`, outside this manifest.
- **`bg-muted/50` in both themes.** The converging ruling that `docs/architecture/07-live-widgets.md` §"Gotchas" leaves OPEN is made here: the token wins over the literal, for `FenceBlock` and `MermaidDiagram` alike, which is what that note said the honest move would be.

**Reversible defaults you may take without stopping** (each reversal is one line plus one sed line):
- Link underline at 40% ink. Reversal: `decoration-accent-ink/60`.
- Code at `0.875em`, matching Typography's own `code` and `pre` size (`@tailwindcss/typography` `styles.js`, `em(14, 16)`). Reversal: `'0.8125em'`.
- `MermaidDiagram.tsx:106`'s live-diagram container takes `bg-card` in place of `bg-white … dark:bg-zinc-900`. Reversal: `bg-muted/50`, matching its source `<pre>` (no sed line: Mermaid is not in the baseline document).

**Sirens.**
- **A pre-existing red baseline.** Read `.verify/artifacts/verve-life-before/probe-shapes-baseline.mjs.txt` first. If its `BASELINE:` line is anything but `BASELINE: DOM identical`, someone else's change already moved the pinned DOM. Your sed proof would then either fail or launder that change. Do not re-capture: report that line verbatim and return `RESULT: BLOCKED`.
- **A second capture.** If the proof mismatches, you will want to adjust the sed script and capture again. Before any second capture, copy `.verify/artifacts/verve-life-before/shapes-elements-baseline.html` back over `.verify/artifacts/shapes-elements-baseline.html`, so the file does not accumulate a laundering provenance line. Then fix the sed script or the source, and capture once more. Never edit the artifact by hand. The capture step's command performs that copy itself, so running that exact command again is the sanctioned second capture.
- **Chips and inline code.** You will see `InlineMarks.tsx`'s `text-accent-ink` and `code/InlineCode.tsx`. They already use accent ink and `em`; both are out of scope, and `InlineMarks.tsx` is forbidden.
- **The probe.** `probe-shapes-baseline.mjs` changes at line 355 only, to the exact line its step spells. Its flags are `--write`, `--force` and `--note=` (`:87-88,116-120`); use them, never change them. You will see line 402's `held('<thead class="bg-muted/60">')` and other class-keyed gates: this phase changes none of those classes, so leave them.
- **The Mermaid frame.** You will see `bg-white` left behind once `dark:bg-zinc-900` goes from `MermaidDiagram.tsx:106`. Do not leave it bare (a white block behind a dark diagram) and do not reach for a palette or hex: it becomes `bg-card`, per the default above.
- **Divergence.** When reality differs from this chart, stop and report it verbatim. Examples: the artifact's provenance lines do not start `<!--`; the DOM in the artifact spans lines that also start `<!--`; the class strings at `MarkdownLink.tsx:70,84` differ from Interfaces I8; the probe's line 355 does not read the zinc gate quoted in its step, or its other-lines hash differs from the check's before you edit (another session changed the probe).

**Docs the sweep leaves.** `docs/architecture/08-rendered-shapes.md` §"Gotchas" loses its "Two moved files still carry palette colours, on purpose" item (healed means deleted). `docs/architecture/07-live-widgets.md` §"Gotchas" loses the OPEN zinc item. `docs/verification.md` §"The browser harness" records this widening in the baseline probe's entry, and that the fence gate now counts the shell's `bg-muted/50 shadow-sm` marker. Phase 9 converges all three.

## Phase 9 — The docs say what shipped, and the whole goal is re-proven
Depends on: Phase 8

```toml
[phase]
id = "9"
builder = "prometheus"
model = "sonnet"
code_change = false
doc_sweep = "foreground"
expected_s = 7200
manifest = ["docs/architecture/08-rendered-shapes.md", "docs/architecture/07-live-widgets.md", "docs/verification.md", "docs/chat-contracts.md", "src/shared/ui/verve/README.md", ".verify/artifacts/verve-life-after"]
forbidden = ["src/modules/chat/transcript", "src/modules/widgets", "tailwind.config.js", "src/shared/utils.ts", "src/shared/ui/verve/tokens.css", "src/shared/ui/verve/controls.css", "src/shared/ui/verve/feedback.css", ".verify/phase-34.mjs", ".verify/artifacts/verve-life-library-sizes.json", ".verify/lib", ".verify/artifacts/shapes-elements-baseline.html"]
athena = [
  "A doc describes what this plan hoped instead of what the source does, for example a size, a delay or a selector that differs from the shipped file",
  "A healed item survives: the palette-literal gotcha in 08, the OPEN zinc gotcha in 07, or a sentence still saying CSS is the only reader of a lead-in",
  "The element-cards section now claims lists without a lead-in animate, or omits why they do not",
  "verification.md's phase-34 entry omits its groups, its final line, or the baseline widening's sed proof",
  "08 still names shapeType.css, rule 7 omits that entrances are remembered by content, or the Verve README misses the size swap or the entrance marker",
]

[[steps]]
kind = "edit"
path = "docs/architecture/08-rendered-shapes.md"
what = "Converge the doc on the shipped source: a lead-in row in The triggers; LeadIn.tsx, leadInContext.ts, shapeMotion.css and code/EmbedFrame.tsx rows in The pieces, and no shapeType.css row; Mental model rule 7 covering entrances beside folds; the list-kind exclusion documented under No card inside a card, so the never-[data-shape] sentence stays true; a new section '## Header, type and motion' between '## Element cards' and '## Gotchas' covering the header anatomy and kind registry, the five named sizes and why em, the tailwind-merge extension, and frames-only motion with its export, streaming and reduced-motion answers; the element-cards title paragraph gains the plugin's reading of the line above a list; the palette-literals gotcha is deleted; If-you-change rows for each new file."
check = '''
f=docs/architecture/08-rendered-shapes.md; printf '%s %s %s %s\n' "$(grep -c '^## Header, type and motion$' "$f")" "$({ grep -c 'Two moved files still carry palette colours' "$f" || true; })" "$(for n in LeadIn.tsx leadInContext.ts shapeMotion.css EmbedFrame.tsx hasEntered; do grep -q "$n" "$f" && printf 1; done)" "$({ grep -c 'shapeType' "$f" || true; })"
'''
expect = "1 0 11111 0"

[[steps]]
kind = "edit"
path = "docs/architecture/07-live-widgets.md"
what = "Describe the framed embed: EmbedFrame in The pieces, the frame function WidgetFrame calls behind its own gates and why, the framed prop, docspaceStudioUrl and the studio deep link in The DocSpace kind, the unframed streaming and invalid cases; delete the OPEN raw-source zinc gotcha now that both spellings sit on the token. Also say in docs/chat-contracts.md section 7 that a settled widget or DocSpace fence wears the card header."
check = '''
printf '%s %s %s\n' "$(grep -c 'docspaceStudioUrl' docs/architecture/07-live-widgets.md | awk '{print ($1>=1)?"link-ok":"link-missing"}')" "$({ grep -c 'OPEN: the two raw-source' docs/architecture/07-live-widgets.md || true; })" "$(grep -c 'EmbedFrame' docs/chat-contracts.md | awk '{print ($1>=1)?"contract-ok":"contract-missing"}')"
'''
expect = "link-ok 0 contract-ok"

[[steps]]
kind = "edit"
path = "docs/verification.md"
what = "Under The browser harness: a phase-34.mjs entry (command, the VERVE LIFE 34 final line, the seven groups and what each proves, the two shots), the verve-life-compare.sh helper, the probe-markdown-cards and phase-33 document changes, and in the baseline probe's entry the Phase 8 widening with its sed proof. In src/shared/ui/verve/README.md: rule 3 names the md-* sizes and shapeMotion.css beside markdownCards.css as the module stylesheets; rule 4 gains the data-text-scale size swap beside the tone swap, and the data-vv-enter marker with vv-meter-grow."
check = '''
printf '%s %s %s\n' "$(grep -c 'VERVE LIFE 34' docs/verification.md | awk '{print ($1>=1)?"probe-ok":"probe-missing"}')" "$(grep -c 'verve-life-retone.sed' docs/verification.md | awk '{print ($1>=1)?"sed-ok":"sed-missing"}')" "$(grep -q 'data-text-scale' src/shared/ui/verve/README.md && grep -q 'data-vv-enter' src/shared/ui/verve/README.md && ! grep -q 'shapeType' src/shared/ui/verve/README.md && echo verve-ok || echo verve-missing)"
'''
expect = "probe-ok sed-ok verve-ok"

[[verify]]
cmd = "node .verify/phase-34.mjs 2>&1 | grep -E '^VERVE LIFE 34: ' | tail -1"
expect = "VERVE LIFE 34: all gates PASS"
timeout_s = 900

[[verify]]
cmd = '''
for s in probe-shapes-baseline.mjs probe-shapes-detect.mjs probe-shapes-tables.mjs probe-shapes-lists.mjs probe-shapes-prose.mjs probe-shapes-groups.mjs probe-shapes-fences.mjs probe-shapes-inline.mjs probe-markdown-cards.mjs phase-22.mjs phase-28.mjs phase-29.mjs phase-32.mjs phase-33.mjs; do bash .verify/verve-life-compare.sh "$s"; done | awk '/^SAME-OR-BETTER /{n++} END{print "same-or-better=" n+0}'
'''
expect = "same-or-better=14"
timeout_s = 7200
```

**What to write.** Read the shipped files and write what they do, never what this plan hoped:
- `src/modules/chat/transcript/shapes/ShapeFrame.tsx`, `LeadIn.tsx`, `remarkShapeGroups.ts`, `shapeMotion.css`, `collapseState.ts` and `useShapeCollapse.ts`;
- `code/EmbedFrame.tsx`;
- `src/modules/widgets/WidgetFrame.tsx` and the `WidgetEmbed`/`WidgetEmbedFramer` types in `src/shared/types.ts`;
- `src/shared/ui/verve/tokens.css`'s size swap and meter grow-in, and the fourteen library declarations that read the swap;
- `tailwind.config.js`'s `fontSize` and `animation` entries;
- `.verify/phase-34.mjs`.

The two verify entries are this plan's goal, re-proven against the finished tree.

**Sirens.**
- **Rewriting more than asked.** You will want to tidy neighbouring sections. Change what the steps name, plus what the shipped files require. Nothing else.
- **Editing the source.** You will see a comment or a class you disagree with. All source is forbidden in this phase; the disagreement goes in your report.
- **Healed means deleted.** A corrected sentence is replaced outright. No "previously", no "was", no struck-through history.

## Waves

Wave 1: Phase 1 — the recorded harness; independent of everything
Wave 2: Phase 2 — the probe; consumes the recording
Wave 3: Phase 3 — lead-in titles; the probe's L group
Wave 4: Phase 4 — the scale and the header; builds on Phase 3's frame changes
Wave 5: Phase 5 — the bodies and the library size swap; uses Phase 4's sizes and header
Wave 6: Phase 6 — motion and its entrance memory; keys on Phase 4's frame
Wave 7: Phase 7 — the embeds; uses the frame's flush prop and kinds
Wave 8: Phase 8 — the re-tone and the widened baseline
Wave 9: Phase 9 — the docs and the goal

Strictly serial. `ShapeFrame.tsx`, `tailwind.config.js`, `.verify/phase-33.mjs`, the probe's groups and `docs/architecture/08-rendered-shapes.md` (every foreground sweep) are shared across adjacent phases, so no two phases are independent.

## Goal

*Goal:* in a settled chat reply, every framed card wears the one Verve header (icon, title, accent or tone wash). Every card size follows the Appearance chat text size, with no header or label smaller than the text it heads. Frames rise the first time they appear in the page, rows follow, and meters grow, within 400 ms, never while streaming, in an export or under reduced motion. A line ending in a colon, or wholly bold, directly above a list or a table becomes that card's title. Widget and DocSpace embeds wear the header, with a studio link. Links and code blocks paint only Verve tokens. None of the fourteen recorded probes gains a failure. *Verify by:* Phase 9's two `[[verify]]` entries, which print `VERVE LIFE 34: all gates PASS` and `same-or-better=14`.

## Decisions

- **The parser reads the line above a list, as Scott described.** Markdown is parsed by react-markdown with remark plugins, not by CSS. The lead-in pass joins `remarkShapeGroups` because that plugin is the one place that sees sibling blocks. `ShapeList` never sees its previous sibling, and CSS reads neither a colon nor a bullet.
- **Lead-in scope.**
  - Root blocks only, grouped before sections.
  - Lists and tables.
  - At most 120 characters, one line.
  - The colon is kept, and the title is the paragraph's own rendered children.
- **The rungs move out of the ladders rather than being guessed twice.** `tableRung` and `listRung` are called by both the element and `LeadIn`, so a declined matrix or a plain list can never lose its lead-in line.
- **A header is never smaller than its contents.** This is Scott's ruling, and for rendered markdown it outranks the Verve canvas's 12px uppercase eyebrow and table header (`design/verve/_ds/…/tokens/typography.css:12`, canvas table header at 12px). Weight and wash carry hierarchy instead of size.
- **Colour.** Scott's "Coloring has to be applied" outranks the canvas's "accent sparingly — actions and focus only" (`colors.css:13`) on these cards, within a bounded spend:
  - the header wash and icon;
  - list marks and number pills (already shipped);
  - the table header tint, the sorted column and the row hover.

  Frames and body text stay neutral. Meaning uses the closed five-tone enum, never a new colour.
- **Sizes are `em`, named in `tailwind.config.js`.** Named sizes make the scale one editable place. `em` makes every card follow `--chat-font-size` on every surface it renders on. Tool bodies scale at 7/8, which is today's pixel size at the default.
- **Library pieces are sized by a token swap in the library.** `[data-text-scale="flow"]` in `tokens.css` sets `--vv-text-body` and `--vv-text-meta`, and each of fourteen Verve declarations reads its token, with today's value as the fallback. This is DESIGN_DOCTRINE §5's pattern, and §10 says a library gap is landed in the library. A chat stylesheet reaching `.vv-meter__label` would couple chat to library internals. Every screen outside a card computes today's size (T6).
- **`cn` learns the names.** Without the tailwind-merge extension the sizes would be silently dropped wherever `cn` joins a size with a colour.
- **Motion lives on frames only.** Element cards (plain lists, quotations, footnotes) render the same in the streaming and settled halves and remount when a block settles, so a CSS entrance would play twice on every live reply. Reversal: add the M1 rule for `.chat-md-cards :is(ul, ol)` and accept the replay.
- **The entrance is remembered by content.** `LazyMessageRow` unmounts rows as they scroll away, and a retraction remounts a settled block, so a mount is not an appearance. A page-lifetime set of entered keys beside the fold map (`collapseState.ts`, 08 rule 7) lets a card rise once (M8). The meter's grow-in is the library's own keyframe on the library marker `data-vv-enter`.
- **No hover lift.** Verve lifts interactive cards only (`controls.css:150`).
- **Embeds are framed by a function `WidgetFrame` calls behind its own gates.** The chat module passes `frame`. The widgets module alone still decides the kind, and calls `frame` only on its two live branches (`WidgetFrame.tsx:84-88`: "The fork sits BEHIND both gates"). So the source `<pre>` (streaming, export) and the error card are never framed (E5, E6), chat never classifies a body, and the widgets barrel is unchanged. Folding keeps the iframe mounted.
- **The baseline is widened once, on a sed proof.** Links and code blocks are the pinned DOM (08 §"Gotchas"). Their re-tone is its own phase, and the widening is legitimate only if every divergent byte is intended.
- **Builders.**
  - Iris does the paint (Phases 4–6), as Scott asked, including the library size swap and the meter grow-in.
  - Hephaestus does the parser pass, the probe, the embeds' security-bearing frame code and the baseline widening.
  - Prometheus writes the docs.
- **Embedded DocSpace works.** That was measured before this plan, not assumed: phase-28 17/17, phase-29 12/12, `archpulse.service` active, and a real embed in this conversation's transcript at line 2772.

## Edge cases

- **A colon paragraph followed by a blank line and a fence.** It stays a paragraph (L4).
- **A colon paragraph inside a blockquote or a list item, above a list.** It is not grouped: root children only.
- **Two colon paragraphs in a row, then a list.** Only the adjacent one titles the list; the first stays a paragraph.
- **A lead-in above a decision matrix whose cells carry inline formatting.** `tableRung` answers `'none'`, and the lead-in stays a paragraph above today's table (L9).
- **A lead-in above a task list, check results or a timeline.** That shape's own frame takes the title, and its collapse key is unchanged.
- **A lead-in holding a link.** The link renders inside the title, inside the fold button. Accepted: react-markdown's anchor is not a chip, and the fold toggle still receives clicks outside it.
- **A streaming retraction over a titled card.** The title drops back to a paragraph for a tick and the frame re-rises on re-settle. Accepted, the same mechanism every shape already has.
- **Scrolling back to a card, or a retraction that re-settles an unchanged block.** No replay, because its key has entered. A block whose payload changed while it was away rises once more, under its new key.
- **Opening a conversation.** The last 30 rows mount at once (`ChatMessagesPane.tsx:32`), so their frames rise together once. Accepted.
- **Sorting a table.** The row stagger replays, because React moves the rows. Default, reversal in Phase 6.
- **Scott's own message bubbles.** Settled user text runs the same plugin and shape map, so a colon line above a list in a user message is titled too, and its frames rise. The element cards stay off there, as today.
- **An exported transcript.** Titles and icons are present, with no chevron, no motion and no studio link. Widget and DocSpace fences export as their source, unframed (E6).
- **ArchPulse down.** The DocSpace frame's header stays; inside it the iframe gives way to `WidgetErrorCard` after `DOCSPACE_READY_TIMEOUT_MS`, as today.
- **Chat text size at its maximum, 22px.** A stat value is 38.5px, and titles wrap rather than truncate.
- **A browser without `:has()`.** The list-frame rule is invalid there and lists render uncarded, as today; lead-in frames still draw, because they are components.

## Exclusions

- **Element-card motion.** Recorded in Decisions with its reversal.
- **Row reorder animation beyond the CSS replay**, for example FLIP. Its own change if wanted.
- **Text inside a live HTML widget.** It is a sandboxed document sized by Verve's `--text-body` (`src/modules/widgets/buildWidgetDocument.ts:46`). Following the Appearance setting there needs a bridge message, and is its own change.
- **The raw-text `SubagentNote` and the reasoning accordion.** They render prose without markdown (`docs/plans/markdown-element-styling.plan.md` §"Exclusions").
- **`markdown-preview/MarkdownPreview.tsx` and `VersionUpgradeModal`.** Other modules with their own react-markdown configurations. `MermaidDiagram` is touched only for its one dark literal.
- **Showing the working embed inside this conversation** belongs to the conversation, not to a phase. The phase-29 run and phase-33's four gallery shots are the artifacts that show it.

## Doctrine citations

- `docs/architecture/08-rendered-shapes.md` §"Mental model" rules 1, 2, 4, 6, 8, 9; §"Element cards"; §"Gotchas"; §"If you change this, check that".
- `docs/architecture/02-realtime-stream.md` §"Incremental markdown rendering": settled blocks un-settle and remount.
- `docs/architecture/07-live-widgets.md` §"The DocSpace kind" and §"Gotchas".
- `docs/verification.md:903-918`: the baseline's re-capture rule; §"What bites people": one dev account, run solo.
- `src/shared/ui/verve/README.md` rules 3, 4, 5 and the library contract.
- `~/.claude/design/DESIGN_DOCTRINE.md` §1 (if Verve draws it, it is in the library), §5 (tone is a token swap), §6 (colour is never the whole signal), §7 (measure the pixels), §10 (a library gap is landed in the library).
- `src/modules/widgets/WidgetFrame.tsx:84-88`: the widget fork sits behind both gates.
- `.agents/skills/frontend-module-standards/SKILL.md:17-23, 30, 52-53, 66-72, 76`.

## Open Questions

None. Every scope question is settled in Decisions, every reversible choice is named with its reversal in its phase, and the embed's state was measured rather than assumed.

## Ship Logs

### Phase 1 Ship Log — ⛔ BLOCKED 2026-09-14
- [BLOCKED: builder-blocked: DIVERGENCE: probe-shapes-detect.mjs prints neither [PASS] nor [FAIL] under the plan's own recording command — "node .verify/probe-shapes-detect.mjs" dies with "Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@/modules' imported from /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/transcri]
- run: rendered-markdown-verve-plan-20260914-191708-3ad6 · attempt 1 of 2 · fix-passes 0 of 3 · spec_sha 136faf0fa6d6 · retry: on-spec-change
- builder: hephaestus/deepseek-flash · session 2c27afe4-4f5a-4012-ba06-d0253f708dda · 503s · RESULT: BLOCKED
- evidence: /home/lyphe/.claude/state/runner/rendered-markdown-verve-plan-20260914-191708-3ad6/phase_1/

### Phase 1 Ship Log — ↻ REPLANNED 2026-09-14
- run: rendered-markdown-verve-plan-20260914-191708-3ad6 · replan 1 of 3 · spec_sha 136faf0fa6d6 → 88fe701809ad · replanner odysseus/claude-opus-5 · session ca1c53c9-8472-457e-b272-f199883b1e61 · 140s · cost $1.29
- cause: builder-blocked: DIVERGENCE: probe-shapes-detect.mjs prints neither [PASS] nor [FAIL] under the plan's own recording command — "node .verify/probe-shapes-detect.mjs" dies with "Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@/modules' imported from /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/transcri
- changed: I rewrote Phase 1 and one line of `## Interfaces` (I9(a)). All four checks pass: lint exits 0, the gate prints `RUNNER`, the walk shows the new spec, and the lock still reads `lock:2aace01c64`. Cause: `probe-shapes-detect.mjs` loads app TypeScript through the `@/` alias, which only tsconfig defines, so `node` can't run it. The compare script and the recording command now read each probe's own `// Usage:` line and run it through tsx when that line says so; only this probe does. Step 1 fixes the existing script and checks the rule and its line count. I added a crash check that reads 2 today and must read 0, plus two Athena items. I didn't add `.verify`, the probe or the evidence folder to `man
- evidence: /home/lyphe/.claude/state/runner/rendered-markdown-verve-plan-20260914-191708-3ad6/phase_1/

### Phase 1 Ship Log — ✅ SHIPPED 2026-09-14
- run: rendered-markdown-verve-plan-20260914-191708-3ad6 · attempt 1 of 2 · cycle 2 · spawns 5/160 · fix-passes 0 of 3 · cost $1.18 (run $2.54) · resumed 0×
- builder: hephaestus/deepseek-flash · session d335f7ee-b3b8-4ea8-916e-f4892c9ad5b9 · 603s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 0 · LOW 0 — CLEARED
- checks: 3/3 steps OK · verify 3/3 OK
- forbidden: unchanged (2 declared, 2 present)
- docs: Prometheus returned · 0 files
- evidence: /home/lyphe/.claude/state/runner/rendered-markdown-verve-plan-20260914-191708-3ad6/phase_1/

### Phase 2 Ship Log — ⛔ BLOCKED 2026-09-14
- [BLOCKED: verify: node --check .verify/lib/verve-life.mjs && awk 'END{print (NR<=350)?"SIZE-OK":"SIZE-OVER"}' .verify/lib/verve-life.mjs && for n in VERVE_DOCUMENT setSurface readRefs paintedPixel contrast animationsOf; do if grep -qE "export (const|async function|function|\{[^}]*)[^a-zA-Z]*$n" .verify/lib/verve-life]
- run: rendered-markdown-verve-plan-20260914-191708-3ad6 · attempt 1 of 2 · fix-passes 2 of 3 · spec_sha 81be3b73d090 · retry: on-spec-change
- builder: hephaestus/deepseek-flash · session 5e848819-c76e-41a3-a3e9-3012dfb9ce32 · 1655s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 1 · HIGH 2 · MED 4 · LOW 1 → fix-pass 1/deepseek-flash (898s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 2/3 steps OK · verify 3/3 OK → fix-pass 2/deepseek-flash (187s) → 2/3 steps OK · verify 3/3 OK
- forbidden: unchanged (9 declared, 9 present)
- residue: BLOCKING 1 · HIGH 2 · MED 4 · LOW 1 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/rendered-markdown-verve-plan-20260914-191708-3ad6/phase_2/

### Phase 2 Ship Log — ↻ REPLANNED 2026-09-14
- run: rendered-markdown-verve-plan-20260914-191708-3ad6 · replan 2 of 3 · spec_sha 81be3b73d090 → 8015411b2b17 · replanner odysseus/claude-opus-5 · session 56e7db6a-263a-4f75-b55b-d931a68be7b2 · 170s · cost $1.55
- cause: verify: node --check .verify/lib/verve-life.mjs && awk 'END{print (NR<=350)?"SIZE-OK":"SIZE-OVER"}' .verify/lib/verve-life.mjs && for n in VERVE_DOCUMENT setSurface readRefs paintedPixel contrast animationsOf; do if grep -qE "export (const|async function|function|\{[^}]*)[^a-zA-Z]*$n" .verify/lib/verve-life
- changed: I've fixed Phase 2 so its re-run can pass, but one of the four proofs still fails: `plan-runner lint` exits 2. Its three `v2:builder-shim` findings are on Phases 3, 7 and 8, which I'm not allowed to edit. The plan copy saved before this replan gets the same three findings, so my edit didn't cause them. The other three proofs pass: `gate` prints `RUNNER`, `walk` renders, and the lock prints `lock:2aace01c64`. Nothing outside Phase 2 changed. Phase 2 blocked on the spec, not the code. Step 1's check prints `ok ` with a trailing space, and the runner's plain `re.search` never let `ok$` match that. I changed the pattern to `^SIZE-OK\n(ok ){6}$` and tested it: it matches today's output and fails
- evidence: /home/lyphe/.claude/state/runner/rendered-markdown-verve-plan-20260914-191708-3ad6/phase_2/

### Phase 2 Ship Log — ✅ SHIPPED 2026-09-14
- run: rendered-markdown-verve-plan-20260914-191708-3ad6 · attempt 1 of 2 · cycle 4 · spawns 14/160 · fix-passes 1 of 3 · cost $1.68 (run $6.54) · resumed 0×
- builder: hephaestus/deepseek-flash · session f417a1f5-f968-4682-91fd-b9023cbd5e56 · 884s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 1 · MED 0 · LOW 2 → fix-pass 1/deepseek-flash (367s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 3/3 steps OK · verify 3/3 OK
- forbidden: unchanged (9 declared, 9 present)
- docs: Prometheus returned · 0 files
- residue: BLOCKING 0 · HIGH 1 · MED 0 · LOW 2 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/rendered-markdown-verve-plan-20260914-191708-3ad6/phase_2/

### Phase 3 Ship Log — ✅ SHIPPED 2026-09-14
- run: rendered-markdown-verve-plan-20260914-191708-3ad6 · attempt 1 of 2 · cycle 5 · spawns 19/160 · fix-passes 2 of 3 · cost $2.20 (run $8.73) · resumed 0×
- builder: hephaestus/deepseek-flash · session 1509af3e-b6e3-4c8e-877a-9b4ee33e929b · 1002s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 1 · MED 0 · LOW 3 → fix-pass 1/deepseek-flash (601s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 9/10 steps OK · verify 2/2 OK → fix-pass 2/deepseek-flash (547s) → 10/10 steps OK · verify 2/2 OK
- forbidden: unchanged (9 declared, 9 present)
- docs: Prometheus returned · 1 files
- residue: BLOCKING 0 · HIGH 1 · MED 0 · LOW 3 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/rendered-markdown-verve-plan-20260914-191708-3ad6/phase_3/

### Phase 4 Ship Log — ✅ SHIPPED 2026-09-14
- run: rendered-markdown-verve-plan-20260914-191708-3ad6 · attempt 1 of 2 · cycle 6 · spawns 23/160 · fix-passes 1 of 3 · cost $2.01 (run $10.74) · resumed 0×
- builder: iris/deepseek-flash · session 6bf58134-23a7-4b34-a1c2-1c89bdb52d8c · 656s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 0 · LOW 1 → fix-pass 1/deepseek-flash (417s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 7/7 steps OK · verify 3/3 OK
- forbidden: unchanged (12 declared, 12 present)
- docs: Prometheus returned · 1 files
- residue: BLOCKING 0 · HIGH 0 · MED 0 · LOW 1 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/rendered-markdown-verve-plan-20260914-191708-3ad6/phase_4/

### Phase 5 Ship Log — ⛔ BLOCKED 2026-09-14
- [BLOCKED: builder-blocked: Files changed (all inside the manifest): `src/modules/chat/transcript/shapes/{DataTable,FactCard,StatTiles,DecisionMatrix,BeforeAfter,Timeline,VerdictBanner,CheckResults,Callout,DiffBlock,LongOutput}.tsx`, `src/shared/ui/verve/{tokens,controls,feedback}.css`; `.verify/shots/phase-34-{light,dark}.png]
- run: rendered-markdown-verve-plan-20260914-191708-3ad6 · attempt 1 of 2 · fix-passes 0 of 3 · spec_sha 40d160197fc9 · retry: on-spec-change
- builder: iris/deepseek-flash · session 369d90aa-05da-45cf-9103-c85a107192f6 · 794s · RESULT: BLOCKED
- evidence: /home/lyphe/.claude/state/runner/rendered-markdown-verve-plan-20260914-191708-3ad6/phase_5/

### Phase 5 Ship Log — ↻ REPLANNED 2026-09-14
- run: rendered-markdown-verve-plan-20260914-191708-3ad6 · replan 3 of 3 · spec_sha 40d160197fc9 → d4525cade979 · replanner odysseus/claude-opus-5 · session 9fa90b6d-0976-41bb-8983-5d3ad6bc8b7a · 139s · cost $1.41
- cause: builder-blocked: Files changed (all inside the manifest): `src/modules/chat/transcript/shapes/{DataTable,FactCard,StatTiles,DecisionMatrix,BeforeAfter,Timeline,VerdictBanner,CheckResults,Callout,DiffBlock,LongOutput}.tsx`, `src/shared/ui/verve/{tokens,controls,feedback}.css`; `.verify/shots/phase-34-{light,dark}.png
- changed: I replanned Phase 5, but one of the four proofs still fails: `plan-runner lint` exits 2. Its three `v2:builder-shim` findings sit in Phases 3, 7 and 8 (plan lines 737, 1295, 1426). They were already there before my edit (the saved `replan-3.before.md` shows the same 3), and I'm not allowed to edit those phases. The other proofs pass: `gate` prints `RUNNER`, `walk` renders the new step, and the lock prints `lock:2aace01c64`. Every change is inside Phase 5, and its TOML parses. The builder was right, and I re-checked it: the probe script `.verify/phase-34.mjs:326` puts `surface.titleSizes` into T5's ratio list without spreading it. That one entry becomes NaN, and NaN never counts as close, so
- evidence: /home/lyphe/.claude/state/runner/rendered-markdown-verve-plan-20260914-191708-3ad6/phase_5/

### Phase 5 Ship Log — ✅ SHIPPED 2026-09-15
- run: rendered-markdown-verve-plan-20260914-191708-3ad6 · attempt 1 of 2 · cycle 8 · spawns 29/160 · fix-passes 1 of 3 · cost $2.11 (run $14.47) · resumed 0×
- builder: iris/deepseek-flash · session 567a2207-8b40-4c50-ab90-47918e0b4888 · 442s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 0 · LOW 2 → fix-pass 1/deepseek-flash (399s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 6/6 steps OK · verify 2/2 OK
- forbidden: unchanged (18 declared, 18 present)
- docs: Prometheus returned · 2 files
- residue: BLOCKING 0 · HIGH 0 · MED 0 · LOW 2 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/rendered-markdown-verve-plan-20260914-191708-3ad6/phase_5/

### Phase 6 Ship Log — ✅ SHIPPED 2026-09-15
- run: rendered-markdown-verve-plan-20260914-191708-3ad6 · attempt 1 of 2 · cycle 9 · spawns 33/160 · fix-passes 1 of 3 · cost $1.47 (run $15.94) · resumed 0×
- builder: iris/deepseek-flash · session ee33e99b-0741-4d12-b2cf-6e5a13a888df · 1354s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 0 · LOW 2 → fix-pass 1/deepseek-flash (437s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 7/7 steps OK · verify 2/2 OK
- forbidden: unchanged (13 declared, 13 present)
- docs: Prometheus returned · 2 files
- residue: BLOCKING 0 · HIGH 0 · MED 0 · LOW 2 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/rendered-markdown-verve-plan-20260914-191708-3ad6/phase_6/

### Phase 7 Ship Log — ⛔ BLOCKED 2026-09-15
- [BLOCKED: builder-blocked: DIVERGENCE: `.verify/probe-shapes-fences.mjs` goes NEW-FAIL (`[FAIL] [light]` and `[dark] every non-mermaid fence wears the shape the precedence table promises (stats, diff, output, output, diagram, diagram, widget)`) because the mandated `EmbedFrame`→`ShapeFrame kind="widget"` gives that fixture's]
- run: rendered-markdown-verve-plan-20260914-191708-3ad6 · attempt 1 of 2 · fix-passes 0 of 3 · spec_sha 9f9d36634cc9 · retry: on-spec-change
- builder: hephaestus/deepseek-flash · session 1cc10514-177d-44ef-b997-25fbabff97a2 · 930s · RESULT: BLOCKED
- evidence: /home/lyphe/.claude/state/runner/rendered-markdown-verve-plan-20260914-191708-3ad6/phase_7/

### Phase 8 Ship Log — ⛔ BLOCKED 2026-09-15
- [BLOCKED: depends: not SHIPPED: Phase 7]
- run: rendered-markdown-verve-plan-20260914-191708-3ad6 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 3 · spec_sha a44c7ba21f07 · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/rendered-markdown-verve-plan-20260914-191708-3ad6/phase_8/

### Phase 9 Ship Log — ⛔ BLOCKED 2026-09-15
- [BLOCKED: depends: not SHIPPED: Phase 8]
- run: rendered-markdown-verve-plan-20260914-191708-3ad6 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 3 · spec_sha 30ac1fcb5cb2 · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/rendered-markdown-verve-plan-20260914-191708-3ad6/phase_9/

### Run rendered-markdown-verve-plan-20260914-191708-3ad6 — COMPLETE 2026-09-15
- shipped: 1, 2, 3, 4, 5, 6
- blocked: 7: builder-blocked, 8: depends, 9: depends, 7: skipped, spec unchanged
- next: re-author the phase spec each ⛔ entry names, then plan-runner start /home/lyphe/.claude/claudecodeui_lyphe/docs/plans/rendered-markdown-verve.plan.md — until a phase's `spec_sha` moves it is skipped, so a run started before the edit repeats this one exactly
- brief: /home/lyphe/.claude/state/runner/rendered-markdown-verve-plan-20260914-191708-3ad6/resume_brief.md

### Phase 7 Ship Log — ✅ SHIPPED 2026-09-15
- run: rendered-markdown-verve-plan-20260915-032206-97da · attempt 1 of 2 · cycle 1 · spawns 4/160 · fix-passes 1 of 3 · cost $1.70 (run $1.70) · resumed 0×
- builder: iris/deepseek-flash · session acbefbfb-e142-4cdb-b19c-33db979db07e · 410s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 1 · LOW 2 → fix-pass 1/deepseek-flash (494s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 8/8 steps OK · verify 2/2 OK
- forbidden: unchanged (15 declared, 15 present)
- docs: Prometheus returned · 3 files
- residue: BLOCKING 0 · HIGH 0 · MED 1 · LOW 2 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/rendered-markdown-verve-plan-20260915-032206-97da/phase_7/

### Phase 8 Ship Log — ⛔ BLOCKED 2026-09-15
- [BLOCKED: builder-blocked: step 4: npx tsc --noEmit -p tsconfig.json ran clean; check prints `0`.]
- run: rendered-markdown-verve-plan-20260915-032206-97da · attempt 1 of 2 · fix-passes 0 of 3 · spec_sha c0435344f30a · retry: on-spec-change
- builder: iris/deepseek-flash · session ff1c1f4d-d1e7-4321-8343-719e5b09ba2b · 239s · RESULT: BLOCKED
- evidence: /home/lyphe/.claude/state/runner/rendered-markdown-verve-plan-20260915-032206-97da/phase_8/

### Phase 8 Ship Log — ↻ REPLANNED 2026-09-15
- run: rendered-markdown-verve-plan-20260915-032206-97da · replan 1 of 6 · spec_sha c0435344f30a → 28c94e9f7732 · replanner odysseus/claude-opus-5 · session d0cede75-6192-443b-81c7-ba8fd3a8995b · 318s · cost $2.01
- cause: builder-blocked: step 4: npx tsc --noEmit -p tsconfig.json ran clean; check prints `0`.
- changed: I rewrote Phase 8 so it can capture the new baseline. The probe's gate at `.verify/probe-shapes-baseline.mjs:355` counted `dark:bg-zinc-900`, the exact class this phase removes. So I moved the probe from `forbidden` to `manifest` and added a step that changes only that line, to a gate counting `bg-muted/50 shadow-sm"`, which appears on exactly the two code-block shells. Its check hashes every other line of the probe, and that line's new text. The capture command now copies the pre-change artifact back first. VERIFY also checks for zero `[FAIL]` lines and one new provenance line. I picked `bg-card` for `MermaidDiagram.tsx:106`, with a way to undo it. I didn't add `.verify`, `tsconfig.json` or
- evidence: /home/lyphe/.claude/state/runner/rendered-markdown-verve-plan-20260915-032206-97da/phase_8/

### Phase 8 Ship Log — ✅ SHIPPED 2026-09-15
- run: rendered-markdown-verve-plan-20260915-032206-97da · attempt 1 of 2 · cycle 3 · spawns 9/160 · fix-passes 0 of 3 · cost $1.63 (run $5.42) · resumed 0×
- builder: iris/deepseek-flash · session 42522dc6-44cb-4b9b-ad6f-69b602ed094a · 522s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 0 · LOW 0 — CLEARED
- checks: 5/5 steps OK · verify 4/4 OK
- forbidden: unchanged (8 declared, 8 present)
- docs: Prometheus returned · 4 files
- evidence: /home/lyphe/.claude/state/runner/rendered-markdown-verve-plan-20260915-032206-97da/phase_8/

### Phase 9 Ship Log — ✅ SHIPPED 2026-09-15
- run: rendered-markdown-verve-plan-20260915-032206-97da · attempt 1 of 2 · cycle 4 · spawns 10/160 · fix-passes 0 of 3 · cost $0.24 (run $5.65) · resumed 0×
- builder: prometheus/deepseek-flash · session 1e3c657e-7124-4ffd-af9e-cd79bb9e397a · 1442s · RESULT: DONE
- athena: n/a — code_change = false
- checks: 3/3 steps OK · verify 2/2 OK
- forbidden: unchanged (11 declared, 11 present)
- evidence: /home/lyphe/.claude/state/runner/rendered-markdown-verve-plan-20260915-032206-97da/phase_9/

### Run rendered-markdown-verve-plan-20260915-032206-97da — COMPLETE 2026-09-15
- shipped: 7, 8, 9
- blocked: none
- next: run complete — the checkpoint is Scott's /git, on his clock
- brief: /home/lyphe/.claude/state/runner/rendered-markdown-verve-plan-20260915-032206-97da/resume_brief.md
