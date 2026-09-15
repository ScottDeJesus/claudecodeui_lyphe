# Markdown element cards — styled lists, quotes, rules, headings, footnotes, images and math in chat replies

## INTENT LOCK

**ORIGINAL REQUEST** (the operator's own words, verbatim):
> can we create a plan to stylize cards for anything thats missing on our html/md conversion?

It followed directly on his previous message in the same conversation, verbatim:
> the bulleted lists and numbered lists are still not rendering in chat with html. has lists been defined in html to be caught when reading the md reply?

**THIS PLAN DELIVERS:**
Lists are not broken, and this plan adds no parsing. Measured on the running app before charting, every bulleted and numbered list in a reply already becomes a real HTML list with visible bullets and numbers. The lists in Scott's report were in ordinary replies, which this plan covers. What those lists lack, like several other markdown elements, is a styled card. This plan adds that styling to CloudCLI chat replies.

Bulleted and numbered lists sit in a framed card with rounded corners, a hairline border and a soft fill. Bullets are drawn in the muted ink. Numbers become small round badges that keep the author's starting number, so a list that begins at 3 shows 3, 4, 5. Nested lists stay inside their parent card with hollow bullets, never a card inside a card. Plain quotes get a tinted panel. Horizontal rules become a hairline that fades at both ends. Top-level (h1) and second-level (h2) headings get a hairline underline. Footnotes sit in their own card, with small pill reference numbers. Struck-through text is muted. Pictures linked from the web get a rounded frame. Display maths gets a tinted panel.

It applies to assistant replies, thinking rows, tool-row prose and every markdown tool body (a subagent's final answer, the plan display, markdown tool results), in light and dark and in an exported transcript. Unchanged: Scott's own message bubbles, tool error text, link colour, and every existing shape (tables, callouts, task lists, check results, timelines, verdicts, stat tiles, code blocks).

Two places still show a model's words as raw text, where a list reads as plain `-` lines: a subagent's running notes inside its panel, and the collapsed reasoning under a reply. This plan does not change them. Turning them into rendered markdown is a separate change.

It is paint only. Not one HTML element or class in a rendered reply changes, so every existing proof that a shape never swallows words still holds. A new headless-Chromium probe against the running dev server proves it: it measures each element's computed style with and without the styling, in light and dark, and saves a screenshot of each.

**OPERATOR VERDICT:** CONFIRMED — 2026-09-14 — Scott: "Accept — run it"

## Runner

```toml
plan_format = 2
cwd = "/home/lyphe/.claude/claudecodeui_lyphe"
add_dirs = []

[budget]
max_cycles = 20
max_spawns = 90
max_fix_passes = 3
max_attempts = 2
max_replans = 3
```

## Interfaces

Every path is relative to `/home/lyphe/.claude/claudecodeui_lyphe`.

**1. The scope class — `chat-md-cards`.** One class name, spelled literally in exactly two places: the exported constant below, and the stylesheet's selectors. A markdown surface opts into the cards by carrying it on the element that wraps the rendered markdown. Nothing else reads it.

- `src/shared/constants.ts` (250 lines today; its last group opens at `:220`, `//----------------- PROVIDER TOOL SETTINGS STORAGE ------------`) gains a NEW group at the end of the file, following the file's own convention:
  - If the last existing group is not already followed by a `// ---------------------------` line, add one first.
  - Then `//----------------- CHAT MARKDOWN CARDS ------------`.
  - Then a doc comment. It says three things. What the class opts into: `src/modules/chat/transcript/markdownCards.css`. Who applies it: MessageComponent's reply, thinking and tool-text bodies, and MarkdownContent for every tool markdown body. And that user message bubbles and tool errors deliberately do not carry it.
  - Then `export const MARKDOWN_CARDS_CLASS = 'chat-md-cards';`.
  - The binding rule is `.agents/skills/frontend-module-standards/SKILL.md:94-95`: "When two or more files use the same constant, place it in `src/shared/constants.ts`." The file already holds a class-string constant (`SETTING_ROW_CLASS`, `:205`).
- `src/modules/chat/transcript/Markdown.tsx` gains ONLY one side-effect import, placed after its last existing `import` statement: `import '@/modules/chat/transcript/markdownCards.css';`. `TRANSCRIPT_PROSE` (`Markdown.tsx:180`) is not moved and not edited.

**2. The call sites — exactly four, in two files.**

| File | Today | Becomes |
| --- | --- | --- |
| `src/modules/chat/transcript/MessageComponent.tsx:299` (tool-use display text) | `<Markdown className={TRANSCRIPT_PROSE}>` | `<Markdown className={cn(TRANSCRIPT_PROSE, MARKDOWN_CARDS_CLASS)}>` |
| `src/modules/chat/transcript/MessageComponent.tsx:366` (thinking row) | `className={cn(TRANSCRIPT_PROSE, 'prose-gray')}` | `className={cn(TRANSCRIPT_PROSE, 'prose-gray', MARKDOWN_CARDS_CLASS)}` |
| `src/modules/chat/transcript/MessageComponent.tsx:430` (assistant reply, `StreamingMarkdown`) | `className={cn(TRANSCRIPT_PROSE, 'prose-gray')}` | `className={cn(TRANSCRIPT_PROSE, 'prose-gray', MARKDOWN_CARDS_CLASS)}` |
| `src/modules/chat/tools/ContentRenderers/MarkdownContent.tsx:22` | `<Markdown className={className}>` | `<Markdown className={cn(className, MARKDOWN_CARDS_CLASS)}>` |

- `MessageComponent.tsx` already imports `cn` from `@/shared/utils` (`:6`). It adds `import { MARKDOWN_CARDS_CLASS } from '@/shared/constants';`, or joins an existing `@/shared/constants` import if the file has one.
- `MarkdownContent.tsx` adds `import { cn } from '@/shared/utils';` and `import { MARKDOWN_CARDS_CLASS } from '@/shared/constants';`.
- `MarkdownContent`'s default prop (`:19`, `className = 'mt-1 prose prose-sm max-w-none dark:prose-invert'`) stays byte-identical.
- `MarkdownContent`'s callers are exactly `ToolRenderer.tsx:256`, `PlanDisplay.tsx:85` and `SubagentPanel.tsx:258`, and all three stay byte-identical: they inherit the class through `MarkdownContent`.
- `MarkdownContent`'s consumer comment (`:10-16`, which today names only ToolRenderer and PlanDisplay) is corrected to name ToolRenderer, PlanDisplay and SubagentPanel (`SKILL.md:53`: "Update an exported component's consumer comment whenever its consumers change").
- `MessageComponent.tsx:200`, the USER message, where `className={TRANSCRIPT_PROSE}` stands alone on its line, is NOT changed.

**3. The stylesheet — `src/modules/chat/transcript/markdownCards.css`, new, ≤ 200 lines.**
- Plain CSS rules whose declarations are Tailwind `@apply` lists of Tailwind class names, plus the one raw `content: counter(list-item);` declaration.
- No `@layer`: Tailwind 3.4.17 refuses `@layer components` in a file that has no matching `@tailwind` directive.
- No hex, no `rgb()`/`hsl()`, no `var(--…)`, no palette utility (`blue-*`, `gray-*`, `zinc-*`, …). `src/shared/ui/verve/README.md:29-33`: "Colour reaches a screen through Tailwind, never as a literal … a screen spells Tailwind names: not hex, not `var(--…)`."
- Every rule paints INSIDE a block's box (border, fill, radius, padding, marker), and **no rule sets a margin**.
- Each rule gets a one-line comment saying which markdown it paints.

Two selector predicates, written out in full wherever used (CSS has no variables for selectors):

- **CARD** — a list that gets a frame: `:not(li *, blockquote *, section.footnotes *, .not-prose, .not-prose *):not(:has(input[type='checkbox']))`
- **OUTSIDE-SHAPES** — `:not(.not-prose, .not-prose *)`. Every block shape's frame carries `not-prose` (`src/modules/chat/transcript/shapes/ShapeFrame.tsx:43`). A heading section carries `data-shape="section"` (`shapes/ShapeSection.tsx:181`) and NO `not-prose`, so lists under a heading DO get cards. Never exclude on `[data-shape]`.

| # | Selector (every one prefixed `.chat-md-cards `) | `@apply` / declaration |
| --- | --- | --- |
| R1 | `:is(ul, ol)` + CARD | `rounded-xl border border-border bg-card/50 py-2.5 pr-4` |
| R2 | `ul` + CARD | `pl-9` |
| R3 | `ol` + CARD | `list-none pl-11` |
| R4 | `ol` + CARD + ` > li` | `relative` |
| R5 | `ol` + CARD + ` > li::before` | `content: counter(list-item);` then `@apply absolute right-full top-1 mr-2 flex h-5 min-w-5 items-center justify-center rounded-full border border-border bg-muted px-1 text-xs font-semibold leading-none tabular-nums text-foreground` |
| R6 | `:is(ul, ol):not(.not-prose *) > li::marker` | `text-muted-foreground` |
| R7 | `li ul:not(.not-prose *)` | `list-[circle]` |
| R8 | `blockquote` + OUTSIDE-SHAPES | `rounded-r-lg bg-muted/50 py-2 pr-4` |
| R9 | `hr:not(.not-prose *)` | `h-px border-0 bg-gradient-to-r from-transparent via-border to-transparent` |
| R10 | `:is(h1, h2):not(.sr-only, .not-prose *)` | `border-b border-border pb-1` |
| R11 | `section.footnotes` | `rounded-xl border border-border bg-card/50 px-4 py-3 text-sm` |
| R12 | `sup > a` | `rounded bg-muted px-1 text-xs no-underline` |
| R13 | `img:not(.not-prose *)` | `rounded-lg border border-border` |
| R14 | `del` | `text-muted-foreground` |
| R15 | `.katex-display` | `overflow-x-auto rounded-lg bg-muted/50 px-3 py-2` |

`counter(list-item)` is the browser's built-in list counter, and it already honours an `<ol start="3">`. Never use a custom `counter-reset`: it would restart at 1 a list split by a code block (`docs/architecture/08-rendered-shapes.md` §"The triggers": "a numbered sequence split by a code block continues at 2 after the fence instead of starting again at 1").

**The three paint layers, in order.** They are recorded here and in `08-rendered-shapes.md` §"Element cards", and pointed to from `PlainList` and `PlainRule`:
1. Tailwind Typography paints from the prose container.
2. The `Plain*` component's own class string paints next.
3. On a carded surface, `markdownCards.css` paints last.

On a carded surface it OVERRIDES `PlainList`'s `pl-5`, its `list-decimal` (on `ol`) and its `marker:text-current` (`shapes/elements/list.tsx:30,34`), and `PlainRule`'s `border-t` (`shapes/elements/plain.tsx:19`). It wins by selector specificity, never `!important`. For headings, quotes, footnotes, images and maths it only adds paint.

**4. The probe — `.verify/probe-markdown-cards.mjs`, new, ≤ 400 lines.** Run as `node .verify/probe-markdown-cards.mjs`.
- It prints exactly one line per gate, `[PASS] G<n> <text>` or `[FAIL] G<n> <text> — <detail>`, for G1 through G19 in order: 19 gate lines, and no other line starting with `[PASS]` or `[FAIL]`.
- It then prints exactly one final line, `MARKDOWN CARDS: all gates PASS` or `MARKDOWN CARDS: a gate FAILED`, and exits 0 or 1.
- It writes `.verify/shots/markdown-cards-light.png` and `.verify/shots/markdown-cards-dark.png`: an element screenshot of `#probe-shapes-body` with the class on.

How it mounts, every piece copied from an existing probe and nothing in `.verify/lib/` edited:

- **Sessions.** `openConsole({ dark: false })`, then later `openConsole({ dark: true })`, from `.verify/lib/console.mjs:364`. Copy the exact pattern of `.verify/probe-shapes-lists.mjs:500` and `:795`, including how that file closes each session and exits (`:831`) and how its `report()` sets `process.exitCode` (`:43-52`).
- **Mount.** `mountShapes(page, PROBE_DOCUMENT)` from `.verify/lib/shapes-fixture.mjs:158`; `unmountShapes(page)` from `:246`. The body element is `#probe-shapes-body` (`SHAPES_BODY_ID`, `:36`), rendered with NO className (`:104`).
- **The two states.** Read `TRANSCRIPT_PROSE`'s string out of `src/modules/chat/transcript/Markdown.tsx` with `fs` and the regex `/export const TRANSCRIPT_PROSE = '([^']+)'/`.
  - **State OFF:** set `#probe-shapes-body`'s `className` to `` `${TRANSCRIPT_PROSE} prose-gray` `` via `page.evaluate`.
  - **State ON:** the same, plus ` chat-md-cards`.
  - React never set a className on that div, so it never resets one. Wait two `requestAnimationFrame`s after each change before reading.
- **Reference colours are never literals.** Inside `page.evaluate`, append a `div#probe-cards-ref` to `document.body`, outside the prose body. It holds one element per class: `text-muted-foreground`, `bg-card/50`, `bg-muted`, `bg-muted/50`, `border border-border`, `rounded-xl`, `rounded-lg`. Read their computed `color`, `backgroundColor`, `borderTopColor` and `borderTopLeftRadius`, then remove the div. Every colour gate compares against these readings, taken in the same session and theme.

`PROBE_DOCUMENT`, verbatim (a JS template literal in the probe):

```markdown
Intro paragraph line:
- **Alpha:** first bullet
- **Beta:** second bullet
  - nested one
  - nested two

3. third
4. fourth

## Findings

- inside a section

> a plain quote

> [!NOTE]
> - list inside a callout

- [ ] task one
- [x] task two

---

Text with ~~struck~~ words and a note[^1].

![favicon](/favicon.ico)

$$
x^2
$$

[^1]: The footnote body.
```

The gates. ON and OFF are the two states above; "card ul" is `#probe-shapes-body > ul` and "card ol" is `#probe-shapes-body > ol`.

| Gate | Passes when |
| --- | --- |
| G1 | read once in state OFF and once in state ON: `#probe-shapes-body`'s `cloneNode(true)`, with the clone's own `class` attribute removed, serialised by `outerHTML`, is byte-identical across the two reads, AND the host's raw `className` differs across them (else both reads saw one state) — the cards change no DOM |
| G2 | card ul, ON: `borderTopWidth` `1px`, `borderTopColor` = ref border, `backgroundColor` = ref `bg-card/50`, `borderTopLeftRadius` = ref `rounded-xl`; OFF: `borderTopWidth` `0px` |
| G3 | card ul's first `li`, ON: `getComputedStyle(li, '::marker').color` = ref `text-muted-foreground` |
| G4 | card ol: `getAttribute('start')` is `3`; ON: `listStyleType` `none`, `borderTopWidth` `1px`, first `li` `::before` `content` contains `counter(list-item)`, `::before` `backgroundColor` = ref `bg-muted` |
| G5 | the `ul` inside card ul's second `li`, ON: `borderTopWidth` `0px`, `listStyleType` `circle` |
| G6 | first `[data-shape="section"] ul`, ON: `borderTopWidth` `1px` |
| G7 | every `ul`/`ol` inside a `.not-prose` element: at least 2 found, and each one's `borderTopWidth` and `backgroundColor` are identical ON and OFF |
| G8 | first `blockquote` not inside `.not-prose`: ON `backgroundColor` = ref `bg-muted/50`; OFF `backgroundColor` `rgba(0, 0, 0, 0)` |
| G9 | first `hr`: ON `borderTopWidth` `0px` and `backgroundImage` contains `linear-gradient`; `getBoundingClientRect().height` equal ON and OFF |
| G10 | `section.footnotes`, ON: `borderTopWidth` `1px`, `backgroundColor` = ref `bg-card/50`; its `ol` ON `borderTopWidth` `0px` |
| G11 | first `h2` without class `sr-only`, ON: `borderBottomWidth` `1px`; `h2.sr-only`, ON: `borderBottomWidth` `0px` |
| G12 | first `img`, ON: `borderTopWidth` `1px`, `borderTopLeftRadius` = ref `rounded-lg` |
| G13 | first `del`, ON: `color` = ref `text-muted-foreground` |
| G14 | at least 1 `.katex-display`; ON `backgroundColor` = ref `bg-muted/50` |
| G15 | every element matching `#probe-shapes-body :is(div.mb-2, ul, ol, blockquote, hr, h2, section.footnotes, img, .katex-display)` — at least 10 found — has identical `marginTop` and `marginBottom` ON and OFF |
| G16 | zero console errors and zero `pageerror` events recorded between the light mount and its unmount |
| G17 | dark session, card ul ON: `backgroundColor` = the dark session's ref `bg-card/50`, and differs from G2's light reading |
| G18 | dark session, card ul first `li` ON: `::marker` `color` = the dark session's ref `text-muted-foreground` |
| G19 | both screenshot files exist and are larger than 0 bytes after writing |

**5. The recorded baseline — `.verify/artifacts/markdown-cards-baseline-before.txt`.** It holds the full stdout and stderr of `node .verify/probe-shapes-baseline.mjs`, captured in Phase 1 before any stylesheet exists. Phase 2 compares its own `BASELINE:` line against this file's. A verdict that was already red because of a neighbour's work therefore does not block this plan, and a verdict this plan moves does.

## Project Constraints

- **No unit tests, ever.** Never create, edit or delete anything under `src/**/tests/`. `src/modules/chat/tests/streamingMarkdownComponent.test.tsx` exists and is not this plan's. Verification is the `.verify/` probes against the running dev server and the checks in this file.
- **Git.** Work stays in the working tree. No commit, push, branch, stash, checkout, restore, reset or clean. To undo a probe edit, copy the file to a backup first and copy it back.
- **Frontend law**, `.agents/skills/frontend-module-standards/SKILL.md`:
  - Application imports use `@/…`, never `./` or `../`.
  - `import type` for types; `type`, never `interface`.
  - An exported symbol carries a comment naming its consumers (`:52-53`).
  - A constant used by two or more files lives in `src/shared/constants.ts` (`:94-95`), in UPPER_SNAKE_CASE (`:97`), with its own comment (`:100`), inside a `//----------------- NAME ------------` group closed by `// ---------------------------` (`:104-109`).
- **Colour law**, `src/shared/ui/verve/README.md:29-33`: "a screen spells Tailwind names: not hex, not `var(--…)`." A stylesheet in `src/modules/` paints with `@apply` and Tailwind class names only.
- **DOM law**, `08-rendered-shapes.md` §"Gotchas": the artifact `.verify/artifacts/shapes-elements-baseline.html` is pinned to the pre-move renderer. "A DOM change means the change is wrong, not the artifact", and it is never re-captured from the current tree (`docs/verification.md:909-918`). This plan re-captures nothing. No `Plain*` or `Shape*` class string changes, and the only edits under `shapes/elements/` are two comment lines.
- **Module size.** The default ceiling is 300 lines per file. The stylesheet stays ≤ 200 lines. The probe stays ≤ 400 lines; that is justified here because it is a single sequential verification script. `src/index.css` (944 lines) is never the home for new rules.
- **Dev server.** `cloudcli-client-dev.service` (Vite, `:5183`) and `cloudcli-server-dev.service` (API, `:3011`) run under systemd and hot-reload `src/`.
  - Check that `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5183/` prints `200`. Never start, stop or restart either unit.
  - Probes run one at a time, and they sign in as the dev account `verve`, never another account.
- **Never print `.env`.** It holds a live credential.
- **Another session's in-flight edits share this tree.** Never edit, format, revert or "fix" them:
  - `src/modules/chat/transcript/PinnedSubagents.tsx`
  - `src/modules/chat/transcript/shapes/detect.ts`
  - `src/modules/chat/transcript/shapes/detect/fileRefs.ts`
  - `src/shared/ui/verve/controls.css`
  - the new `src/modules/chat/transcript/PinnedAgentRow.tsx` and `SoulLaunchPinRow.tsx`
- **Healed means deleted.** A corrected doc sentence is replaced outright, with no "previously" note and no struck-through history.

## Phase 1 — The falsifiable probe, and the baseline recorded before any paint
Depends on: none

```toml
[phase]
id = "1"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 2700
manifest = [".verify/probe-markdown-cards.mjs", ".verify/artifacts/markdown-cards-baseline-before.txt", ".verify/shots"]
forbidden = [".verify/lib", ".verify/artifacts/shapes-elements-baseline.html", ".verify/probe-shapes-baseline.mjs", ".verify/probe-shapes-lists.mjs", "src/modules/chat/transcript/Markdown.tsx", "src/modules/chat/transcript/shapes/elements"]
athena = [
  "A colour gate compares against a hard-coded rgb string instead of the in-session reference element, so it would pass or fail on a token edit rather than on the rule it names",
  "A gate passes vacuously: its selector matched zero elements (no .not-prose list, no .katex-display, no section heading) and the gate reports PASS on an empty set",
  "G1 compares the host's innerHTML (which includes nothing the class changes) or reads both states after the class is already on, so it can never fail",
  "The probe mounts with a className passed through a modified .verify/lib/shapes-fixture.mjs, or edits any .verify/lib file, instead of setting className on #probe-shapes-body from page.evaluate",
  "The recorded baseline file is truncated, captured with stderr dropped, or produced by a different command than node .verify/probe-shapes-baseline.mjs, so Phase 2's comparison against it means nothing",
  "G1 strips the host's class with a regex over the serialised string instead of cloneNode(true) plus removeAttribute('class'), or never checks that the host's raw className differs between the two reads, so reading both states after the class is on still passes",
]

[[steps]]
kind = "run"
cmd = "node .verify/probe-shapes-baseline.mjs > .verify/artifacts/markdown-cards-baseline-before.txt 2>&1; true"
check = "grep -cE '^BASELINE: ' .verify/artifacts/markdown-cards-baseline-before.txt"
expect = "1"
timeout_s = 600

[[steps]]
kind = "edit"
path = ".verify/probe-markdown-cards.mjs"
what = "Create the probe, or amend the one attempt 1 left in place (keep what already matches), exactly per Interfaces item 4: two openConsole sessions (light, then dark) as in probe-shapes-lists.mjs:500/:795, mountShapes of the verbatim PROBE_DOCUMENT, state OFF/ON by setting className on #probe-shapes-body, in-session reference elements for every colour and radius, gates G1-G19 each printing one [PASS]/[FAIL] line, the final MARKDOWN CARDS line, both screenshots, exit 0/1. G1 CURE: attempt 1 compared body.innerHTML, which serialises descendants only and so can never see the one attribute the two states change; that gate could not fail. In each state's page.evaluate read (a) body.className as a string and (b) const clone = body.cloneNode(true); clone.removeAttribute('class'); then clone.outerHTML. G1 prints PASS only when the two (b) strings are byte-identical AND the two (a) strings differ. Its FAIL detail names the half that failed: for (b) both lengths and the firstDifference offset, for (a) the one className both reads saw. The word innerHTML appears nowhere in the file, comments included; the check greps for that."
check = '''
node --check .verify/probe-markdown-cards.mjs && awk '/innerHTML/{i++} /removeAttribute\(.class.\)/{r++} /cloneNode\(true\)/{c++} END{printf "SYNTAX-OK %s %s\n", (NR<=400)?"SIZE-OK":"SIZE-OVER", (i==0 && r>0 && c>0)?"G1-HOST-OK":"G1-HOST-MISSING"}' .verify/probe-markdown-cards.mjs
'''
expect = "SYNTAX-OK SIZE-OK G1-HOST-OK"

[[steps]]
kind = "run"
cmd = "node .verify/probe-markdown-cards.mjs"
check = '''
node .verify/probe-markdown-cards.mjs 2>&1 | awk '/^\[(PASS|FAIL)\] G[0-9]+ /{n++} /^\[PASS\] G1 /{g1="G1PASS"} /^\[FAIL\] G2 /{g2="G2FAIL"} /^MARKDOWN CARDS:/{f=$0} END{print n+0, g1, g2, f}'
'''
expect = "19 G1PASS G2FAIL MARKDOWN CARDS: a gate FAILED"
timeout_s = 600

[[verify]]
cmd = "test -s .verify/shots/markdown-cards-light.png && test -s .verify/shots/markdown-cards-dark.png && echo SHOTS-OK"
expect = "SHOTS-OK"

[[verify]]
cmd = "{ grep -cE 'rgba?\\(|#[0-9a-fA-F]{6}\\b' .verify/probe-markdown-cards.mjs || true; }"
expect_re = "^[0-2]$"
```

**What to build.** Two files and nothing else: the recorded baseline (step 1, a command you run) and the probe (step 2). Then run the probe once (step 3).

**The probe MUST end this phase FAILING.** No stylesheet exists yet, so G2 has nothing to find; the check expects `[FAIL] G2` and the final `MARKDOWN CARDS: a gate FAILED`. That failure is the proof the probe can fail. G1 must PASS already: with the host's own `class` attribute stripped from a clone, the host's `outerHTML` is identical in both states with or without a stylesheet, while its raw `className` differs. The second half is what lets G1 fail at all; attempt 1 compared `innerHTML`, which never contains the host's own attribute, so its G1 could not fail.

The probe's structure is copied from existing files, never re-invented:
- `report()` and exit handling: `.verify/probe-shapes-lists.mjs:43-52` and `:831`.
- Sessions: `:500` and `:795` of that same file.
- Mount and unmount: `.verify/lib/shapes-fixture.mjs:158` and `:246`.

Read those, then write the probe to Interfaces item 4 gate by gate.

The second verify allows at most 2 `rgb(` or six-digit-hex matches. That covers the one literal the gate table names, OFF's `rgba(0, 0, 0, 0)` in G8, and a possible duplicate of it in a detail message. Every other colour comes from the reference element.

**Sirens.**
- **Making the probe pass.** You will want to write a stylesheet so the gates go green. Do not: `src/` is not in your manifest. A red probe at the end of this phase is the deliverable.
- **Editing the fixture.** You will see that `mountShapes` has no className option and want to add one to `.verify/lib/shapes-fixture.mjs`. Do not: `.verify/lib` is forbidden and every other shapes probe depends on it. Set `className` on `#probe-shapes-body` with `page.evaluate`.
- **Hard-coded colours.** You will want to hard-code the colours you observe. Do not. Read every expected colour off the reference elements, in the same session and theme.
- **A red recorded baseline.** Step 1 may record `BASELINE: DOM CHANGED …` instead of `DOM identical`, because the in-flight file-reference grammar in `shapes/detect/fileRefs.ts` belongs to another session and may already move that DOM. Record it exactly as printed. Do not investigate it, and do not touch `fileRefs.ts` or the artifact. Phase 2 compares against whatever you recorded.
- **Stale doc sentences.** You will see `docs/verification.md` claim that the shapes probes write nothing to the account, while `openConsole` PATCHes preferences. Do not fix it here; Phase 3 does.
- **G1 failing.** If G1 FAILS because the class-stripped `outerHTML` differs between OFF and ON, stop. Report both lengths and the first differing offset verbatim. Do not adjust G1 until it passes. If G1 FAILS because the raw `className` is the same in both reads, the probe took both reads in the same state. That is the probe's own read order, in your manifest: fix the order, never the gate.
- **The quick strip.** You will want to strip the class with a string `.replace(/ class="[^"]*"/, '')` over `outerHTML`, or to keep `innerHTML` and add a separate class check. Do not. Use `cloneNode(true)` plus `removeAttribute('class')`, and drop every `innerHTML`, comments included; step 2's check counts all three.
- **Divergence.** When reality differs from this chart, stop and report the divergence verbatim; never improvise around it. Examples: `openConsole` or `mountShapes` has a different signature; `#probe-shapes-body` carries a className; `PROBE_DOCUMENT` renders no `section.footnotes` or no `.katex-display`; `probe-shapes-baseline.mjs` does not exist.

**Docs the sweep leaves.** `.verify/` is git-ignored. The sweep adds one entry for `probe-markdown-cards.mjs` to `docs/verification.md` §"The browser harness", giving its command and its final line. Phase 3 converges it.

## Phase 2 — The stylesheet, the constant and the four call sites
Depends on: Phase 1

```toml
[phase]
id = "2"
builder = "iris"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 2700
manifest = ["src/modules/chat/transcript/markdownCards.css", "src/shared/constants.ts", "src/modules/chat/transcript/Markdown.tsx", "src/modules/chat/transcript/MessageComponent.tsx", "src/modules/chat/tools/ContentRenderers/MarkdownContent.tsx", "src/modules/chat/transcript/shapes/elements/list.tsx", "src/modules/chat/transcript/shapes/elements/plain.tsx", ".verify/shots"]
forbidden = [".verify/probe-markdown-cards.mjs", ".verify/artifacts/markdown-cards-baseline-before.txt", ".verify/artifacts/shapes-elements-baseline.html", ".verify/lib", "src/modules/chat/transcript/shapes/elements/table.tsx", "src/modules/chat/transcript/shapes/elements/blockquote.tsx", "src/modules/chat/transcript/shapes/elements/paragraph.tsx", "src/modules/chat/transcript/shapes/elements/inlineText.tsx", "src/modules/chat/transcript/shapes/elements/index.ts", "src/modules/chat/transcript/shapes/ShapeFrame.tsx", "src/modules/chat/transcript/shapes/ShapeSection.tsx", "src/modules/chat/tools/PlanDisplay.tsx", "src/modules/chat/tools/SubagentPanel.tsx", "src/index.css", "src/shared/ui/verve/tokens.css", "tailwind.config.js"]
athena = [
  "A card rule sets a margin, or overrides Typography's first-child or h2-plus rule, so a reply that opens with a list or follows a heading moves (G15 reads margins, but check the selectors themselves)",
  "The exclusion keys on [data-shape] instead of .not-prose, so every list under a heading loses its card, or the not-prose exclusion is missing so TaskProgress, CheckResults, Timeline or Callout internals get framed",
  "The numbered badge uses a custom counter-reset or counter-increment instead of the built-in counter(list-item), so an <ol start=3> or a list split by a code fence restarts at 1",
  "A colour literal, var(--...), @layer, !important or palette utility is in markdownCards.css, or rules landed in src/index.css, or @apply was left uncompiled in the served CSS",
  "The user message bubble (MessageComponent.tsx:200) or ToolErrorDisplay picked up the class, or any className inside shapes/ changed so the DOM moved",
  "The class was also added at PlanDisplay or SubagentPanel, bringing back the three-site shape, or MarkdownContent's default prop changed instead of its Markdown call",
  "A comment edit in list.tsx or plain.tsx touched a class string, or the new constant sits outside a CHAT MARKDOWN CARDS group or lacks its doc comment",
]

[[steps]]
kind = "edit"
path = "src/shared/constants.ts"
what = "Per Interfaces item 1: add the CHAT MARKDOWN CARDS group at the end of the file (closing the previous group with the separator line if it is not already closed), with a doc comment and export const MARKDOWN_CARDS_CLASS = 'chat-md-cards';"
check = '''
grep -c "^export const MARKDOWN_CARDS_CLASS = 'chat-md-cards';$" src/shared/constants.ts
'''
expect = "1"

[[steps]]
kind = "edit"
path = "src/modules/chat/transcript/Markdown.tsx"
what = "Per Interfaces item 1: add `import '@/modules/chat/transcript/markdownCards.css';` after the last import. Nothing else in the file changes; TRANSCRIPT_PROSE is not touched and the constant is not declared here."
check = '''
f=src/modules/chat/transcript/Markdown.tsx; printf '%s %s\n' "$(grep -cE "^import '@/modules/chat/transcript/markdownCards\.css';$" "$f")" "$({ grep -c MARKDOWN_CARDS_CLASS "$f" || true; })"
'''
expect = "1 0"

[[steps]]
kind = "edit"
path = "src/modules/chat/transcript/markdownCards.css"
what = "Create the stylesheet per Interfaces item 3: a header comment of at most 6 lines (see the phase body), then rules R1-R15 in order, each selector prefixed .chat-md-cards and carrying the CARD or OUTSIDE-SHAPES predicate written out in full, declarations as @apply lists of Tailwind names plus the one content: counter(list-item); line, a one-line comment per rule, no margin, no @layer, no !important, no colour literal."
check = '''
curl -s 'http://127.0.0.1:5183/src/modules/chat/transcript/markdownCards.css?direct' | awk '/@apply/{a++} /chat-md-cards/{c++} /counter\(list-item\)/{k++} END{print "apply=" a+0, (c>=10 ? "scope=ok" : "scope=low"), (k>=1 ? "counter=ok" : "counter=missing")}'
'''
expect = "apply=0 scope=ok counter=ok"

[[steps]]
kind = "run"
cmd = "wc -l src/modules/chat/transcript/markdownCards.css"
check = '''
f=src/modules/chat/transcript/markdownCards.css; printf '%s %s %s\n' "$({ grep -cE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|var\(--|(blue|green|red|zinc|gray|slate|neutral|stone)-[0-9]|@layer|!important' "$f" || true; })" "$({ grep -cE '(^|[^a-z-])(m|mt|mb|my|mx|ml|mr)-[0-9]' "$f" || true; } | awk '{print ($1<=1)?"margins-ok":"margins-set"}')" "$(awk 'END{print (NR<=200)?"size-ok":"size-over"}' "$f")"
'''
expect = "0 margins-ok size-ok"

[[steps]]
kind = "edit"
path = "src/modules/chat/transcript/MessageComponent.tsx"
what = "Per Interfaces item 2: import MARKDOWN_CARDS_CLASS from @/shared/constants and add it at the three call sites on lines 299, 366 and 430 exactly as the table shows. Line 200 (the user message, className={TRANSCRIPT_PROSE} alone on its line) stays byte-identical."
check = '''
f=src/modules/chat/transcript/MessageComponent.tsx; printf '%s %s\n' "$(grep -c 'MARKDOWN_CARDS_CLASS' "$f")" "$(grep -cE '^\s+className=\{TRANSCRIPT_PROSE\}$' "$f")"
'''
expect = "4 1"

[[steps]]
kind = "edit"
path = "src/modules/chat/tools/ContentRenderers/MarkdownContent.tsx"
what = "Per Interfaces item 2: import cn from @/shared/utils and MARKDOWN_CARDS_CLASS from @/shared/constants, change line 22 to <Markdown className={cn(className, MARKDOWN_CARDS_CLASS)}>, keep the default prop on line 19 byte-identical, and correct the consumer comment to name ToolRenderer, PlanDisplay and SubagentPanel."
check = '''
f=src/modules/chat/tools/ContentRenderers/MarkdownContent.tsx; printf '%s %s %s %s\n' "$(grep -c MARKDOWN_CARDS_CLASS "$f")" "$(grep -cF "className = 'mt-1 prose prose-sm max-w-none dark:prose-invert'" "$f")" "$( [ "$(grep -c SubagentPanel "$f")" -ge 1 ] && echo 1 || echo 0)" "$(grep -cF "import { cn } from '@/shared/utils';" "$f")"
'''
expect = "2 1 1 1"

[[steps]]
kind = "edit"
path = "src/modules/chat/transcript/shapes/elements/list.tsx"
what = "Comment only: add one line to the comment above export function PlainList (line 27) reading: On a surface carrying MARKDOWN_CARDS_CLASS, markdownCards.css overrides this list's padding, list style and marker colour; see 08-rendered-shapes.md §Element cards. No class string or code line changes."
check = '''
f=src/modules/chat/transcript/shapes/elements/list.tsx; printf '%s %s %s\n' "$(grep -cF 'mb-2 list-outside list-decimal space-y-1 pl-5 marker:text-current last:mb-0' "$f")" "$(grep -cF 'mb-2 list-outside list-disc space-y-1 pl-5 marker:text-current last:mb-0' "$f")" "$(grep -c 'markdownCards.css' "$f")"
'''
expect = "1 1 1"

[[steps]]
kind = "edit"
path = "src/modules/chat/transcript/shapes/elements/plain.tsx"
what = "Comment only: add one line to the comment above export function PlainRule (line 18) reading: On a surface carrying MARKDOWN_CARDS_CLASS, markdownCards.css overrides this rule's border with a fading hairline; see 08-rendered-shapes.md §Element cards. No class string or code line changes."
check = '''
f=src/modules/chat/transcript/shapes/elements/plain.tsx; printf '%s %s\n' "$(grep -cF '<hr className="my-4 border-t border-border" />' "$f")" "$(grep -c 'markdownCards.css' "$f")"
'''
expect = "1 1"

[[steps]]
kind = "run"
cmd = "npx tsc --noEmit -p tsconfig.json"
check = '''
{ npx tsc --noEmit -p tsconfig.json 2>&1 | grep -cE 'transcript/(Markdown|MessageComponent)\.tsx|tools/ContentRenderers/MarkdownContent\.tsx|shapes/elements/(list|plain)\.tsx|shared/constants\.ts' || true; }
'''
expect = "0"
timeout_s = 600

[[steps]]
kind = "run"
cmd = "npx oxlint src/shared/constants.ts src/modules/chat/transcript/Markdown.tsx src/modules/chat/transcript/MessageComponent.tsx src/modules/chat/tools/ContentRenderers/MarkdownContent.tsx src/modules/chat/transcript/shapes/elements/list.tsx src/modules/chat/transcript/shapes/elements/plain.tsx"
check = '''
npx oxlint src/shared/constants.ts src/modules/chat/transcript/Markdown.tsx src/modules/chat/transcript/MessageComponent.tsx src/modules/chat/tools/ContentRenderers/MarkdownContent.tsx src/modules/chat/transcript/shapes/elements/list.tsx src/modules/chat/transcript/shapes/elements/plain.tsx >/dev/null 2>&1; echo "lint-exit=$?"
'''
expect = "lint-exit=0"
timeout_s = 300

[[verify]]
cmd = '''
node .verify/probe-markdown-cards.mjs 2>&1 | awk '/^\[PASS\] G[0-9]+ /{p++} /^\[FAIL\]/{f++} /^MARKDOWN CARDS:/{s=$0} END{print p+0, f+0, s}'
'''
expect = "19 0 MARKDOWN CARDS: all gates PASS"
timeout_s = 600

[[verify]]
cmd = '''
diff <(node .verify/probe-shapes-baseline.mjs 2>&1 | grep -E '^BASELINE: ') <(grep -E '^BASELINE: ' .verify/artifacts/markdown-cards-baseline-before.txt) >/dev/null && echo BASELINE-SAME || echo BASELINE-MOVED
'''
expect = "BASELINE-SAME"
timeout_s = 600
```

**What to build.** Everything is exactly per Interfaces items 1–3:
- one shared constant;
- one import;
- one stylesheet;
- four call sites in two files;
- two comment lines.

The design is fixed; your craft is in the stylesheet itself: selectors written out in full and in R1–R15 order, and one comment per rule naming the markdown it paints. Its header comment, at most 6 lines, says three things:
- `Plain*` renders every markdown surface and only the wrapper knows which one, so a surface opts in by class.
- On carded surfaces this file overrides `PlainList`'s padding, list style and marker colour, and `PlainRule`'s border, by selector specificity and never `!important`.
- A stylesheet changes no DOM.

Then run the probe yourself and look at both screenshots with the Read tool before you return. Bullets must sit inside the card's left padding. Number badges must sit in the gutter, not over the text. The fading rule must be visible in dark.

Why each constraint exists, so you do not relitigate it:
- **Paint, opted into by the wrapper.** The `Plain*` components render markdown on all eight surfaces, including user bubbles and `ToolErrorDisplay`. Only the wrapper knows which surface it is on, so the opt-in is a class on the wrapper and the paint is a stylesheet scoped to it.
- **No margins.** Tailwind Typography spaces a reply with positional rules, and `SECTION_FLOW` in `shapes/ShapeSection.tsx` restates them for sectioned replies. A card that sets a margin moves blocks the groups probe holds to half a pixel. G15 reads every block's margins with and without the class.
- **`.not-prose`, never `[data-shape]`.** A heading section wears `data-shape="section"` and must keep its lists carded (G6). Every framed shape wears `not-prose` and must stay untouched (G7).
- **`counter(list-item)`.** It is the browser's own list counter and already honours `start`.
- **Four call sites in two files.** `MarkdownContent` is the one door every tool markdown body passes through, so PlanDisplay and SubagentPanel inherit the class. User bubbles (`MessageComponent.tsx:200`) and `ToolErrorDisplay.tsx:75` stay uncarded: a card inside a filled bubble is a frame inside a frame, and tool errors keep their red prose.
- **The two comment lines.** On carded surfaces, `PlainList`'s `pl-5`, `list-decimal` and `marker:text-current` and `PlainRule`'s `border-t` are overridden. Without a pointer, the next person who edits them sees nothing move in replies.

**Reversible defaults you may take without stopping** (each reversal is one line):
- Bullets use `text-muted-foreground`. Reversal: R6 becomes `text-primary`.
- The card fill is `bg-card/50`, matching `ShapeFrame.tsx:43`. Reversal: R1 and R11 name another fill.

**Sirens.**
- **Class strings in `list.tsx` and `plain.tsx`.** Both files are in your manifest for ONE comment line each. You will want to change `PlainList`'s `pl-5` or `PlainRule`'s `border-t` there, since the stylesheet overrides them anyway. Do not. Any class change moves the DOM the shapes baseline pins, and "A DOM change means the change is wrong, not the artifact." The other files in `shapes/elements/` are forbidden.
- **PlanDisplay and SubagentPanel.** You will see both pass their own className to `MarkdownContent` and want to add the class there too. Do not: both are forbidden, and `MarkdownContent` adds it for every caller.
- **`MarkdownContent`'s default prop.** You will want to append the class to it. Do not: the default reaches only `ToolRenderer`. The class goes on the `<Markdown>` call through `cn`.
- **`var(--…)` and hex.** You will want `var(--surface)` or a hex value because `@apply` feels indirect. Do not; the Verve README forbids it on a screen. If an `@apply` name refuses to compile (a Vite error overlay, or the served CSS carries an error), stop and report the exact error. Never substitute a raw variable.
- **`src/index.css` or `Markdown.tsx`.** You will want to put the rules in `src/index.css` beside `.chat-messages-pane`, or the constant beside `TRANSCRIPT_PROSE`. Do not: the rules go in `markdownCards.css` (`index.css` is 944 lines and forbidden), and the constant goes in `src/shared/constants.ts`. `TRANSCRIPT_PROSE` stays where it is, untouched.
- **`@layer components`.** You will want to wrap the rules in it. Do not; Tailwind 3.4 refuses `@layer` in a file with no `@tailwind` directive.
- **Link colour.** You will see `MarkdownLink.tsx` still paints links `text-blue-600`. Do not re-tone it, and do not override `a` colour from the stylesheet. Its re-tone is a separate change with its own baseline re-capture (`08-rendered-shapes.md` §"Gotchas").
- **More surfaces.** You will see `ToolErrorDisplay`, `VersionUpgradeModal`, `markdown-preview/MarkdownPreview.tsx`, the raw-text `message.reasoning` accordion and `SubagentNote`. Do not touch any of them; they are excluded.
- **A failing gate.** If the probe fails a gate and the cause is a rule, fix the rule. If the cause is the probe itself (a wrong selector, a race), stop and report the gate line verbatim. The probe is forbidden to you, and editing it to pass is the failure this plan exists to prevent.
- **`BASELINE-MOVED`.** If the baseline verify prints it, stop and report both `BASELINE:` lines verbatim. This plan changes no markup, so a moved baseline is either a neighbour's in-flight edit landing between phases or a class string you changed. Say which, with the evidence.
- **Divergence.** When reality differs from this chart, stop and report it verbatim. Examples: a call site's line text differs from the table; `MarkdownContent` has a caller other than `ToolRenderer`, `PlanDisplay` and `SubagentPanel`; `src/shared/constants.ts` does not use the `//----------------- NAME ------------` group convention.

**Docs the sweep leaves.** `docs/architecture/08-rendered-shapes.md` gets a row for `markdownCards.css` in §"The pieces", and the `## Element cards` section Phase 3 specifies. Phase 3 converges it.

## Phase 3 — The docs: element cards, the module-stylesheet rule, and the probes' honest account of what they write
Depends on: Phase 2

```toml
[phase]
id = "3"
builder = "prometheus"
model = "sonnet"
code_change = false
doc_sweep = "foreground"
manifest = ["docs/architecture/08-rendered-shapes.md", "docs/verification.md", "src/shared/ui/verve/README.md"]
forbidden = ["src/modules/chat/transcript/markdownCards.css", "src/modules/chat/transcript/Markdown.tsx", "src/shared/constants.ts", ".verify/probe-markdown-cards.mjs"]
athena = [
  "The new section claims the cards change the DOM, or omits that the shapes baseline stays byte-identical because the cards are paint only",
  "The section lists user message bubbles or tool errors among the carded surfaces, or omits the .not-prose exclusion and why [data-shape] is wrong",
  "The verification.md correction deletes the probes' zero-Claude-turns fact along with the false no-writes clause, or leaves one of the false clauses standing",
  "The section says six call sites, or omits the three-layer override order and which PlainList and PlainRule classes the stylesheet overrides",
]

[[steps]]
kind = "edit"
path = "docs/architecture/08-rendered-shapes.md"
what = "Add a `## Element cards` section between `## Streaming` and `## Gotchas`, a `markdownCards.css` row in the pieces table, a `probe-markdown-cards.mjs` row beside the other probes, and two `If you change this` rows (markdownCards.css; PlainList's or PlainRule's class string), with the content the phase body lists."
check = '''
f=docs/architecture/08-rendered-shapes.md; printf '%s %s %s\n' "$(grep -c '^## Element cards$' "$f")" "$( [ "$(grep -c 'markdownCards.css' "$f")" -ge 3 ] && echo css-ok || echo css-low)" "$(grep -c 'probe-markdown-cards.mjs' "$f")"
'''
expect_re = "^1 css-ok [1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "docs/verification.md"
what = "Add the probe-markdown-cards.mjs entry under The browser harness, replace every false 'nothing written on the server or the account' clause with the true account of openConsole's writes, and add the one What-bites-people row the phase body quotes."
check = '''
f=docs/verification.md; printf '%s %s %s\n' "$({ grep -c 'nothing written on the server' "$f" || true; })" "$( [ "$(grep -c 'probe-markdown-cards.mjs' "$f")" -ge 1 ] && echo probe-ok || echo probe-missing)" "$(grep -c "Every probe that calls \`openConsole\` writes the dev account's preferences" "$f")"
'''
expect = "0 probe-ok 1"

[[steps]]
kind = "edit"
path = "src/shared/ui/verve/README.md"
what = "Under rule 3 of The rules that keep it one source (Colour reaches a screen through Tailwind, line 29), add the one sentence the phase body quotes, naming markdownCards.css as today's only module stylesheet."
check = "grep -c 'markdownCards.css' src/shared/ui/verve/README.md"
expect = "1"

[[verify]]
cmd = '''
awk '/^## /{s=$0} s=="## Element cards"{n++} END{print (n>=12)?"SECTION-OK":"SECTION-THIN"}' docs/architecture/08-rendered-shapes.md
'''
expect = "SECTION-OK"

[[verify]]
cmd = '''
awk '/^## /{h[++i]=$0} END{for(j=1;j<=i;j++) if(h[j]=="## Element cards") print h[j-1] " | " h[j+1]}' docs/architecture/08-rendered-shapes.md
'''
expect = "## Streaming | ## Gotchas"

[[verify]]
cmd = '''
f=docs/architecture/08-rendered-shapes.md; printf '%s %s\n' "$({ grep -ci 'six call sites' "$f" || true; })" "$( [ "$(grep -ci 'three layers' "$f")" -ge 1 ] && echo layers-ok || echo layers-missing)"
'''
expect = "0 layers-ok"
```

**What to write.** Read `src/modules/chat/transcript/markdownCards.css`, `src/shared/constants.ts` and `.verify/probe-markdown-cards.mjs` as shipped, and write what they do, never what this plan hoped.

`docs/architecture/08-rendered-shapes.md` gets a new `## Element cards` section between `## Streaming` and `## Gotchas`, at least 12 lines. It says:
- **What gets a card.** Every element R1–R15 paints, in reader's words.
- **Paint, opted into by the wrapper.** The `Plain*` components render all eight markdown surfaces and only the wrapper knows which surface it is, so the opt-in is a class there (`MARKDOWN_CARDS_CLASS` in `src/shared/constants.ts`) and the paint is a stylesheet scoped to it. The cards change no DOM, so "a miss is today's markup" still holds byte for byte and `probe-shapes-baseline.mjs` is unaffected.
- **Which surfaces carry `chat-md-cards`.** MessageComponent's three bodies (assistant reply, thinking row, tool-use text) and `MarkdownContent`, which covers every tool markdown body. User message bubbles and tool errors deliberately do not.
- **Three layers, in order.** Typography paints from the prose container; the `Plain*` class string comes next; on a carded surface `markdownCards.css` comes last. It overrides `PlainList`'s padding (`pl-5`), list style (`list-decimal`) and marker colour (`marker:text-current`), and `PlainRule`'s `border-t`, by selector specificity. For headings, quotes, footnotes, images and maths it only adds paint.
- **The exclusion.** It is `.not-prose`, because every block shape's frame wears it. It is never `[data-shape]`, because heading sections wear `data-shape="section"` and their lists must keep their cards.
- **No card inside a card.** There is none inside a list item, a quote, the footnotes, or a task list.
- **No margins.** No rule sets a margin: Typography's positional spacing and `SECTION_FLOW` stay the only spacing rules.
- **Numbered badges.** They use the browser's own `counter(list-item)`, so `start` is honoured.
- **Streaming.** The cards paint the streaming half too, because the markup is identical. A list crossing the settle boundary shows as two cards until it settles. A still-streaming checks or timeline list is carded until it settles into its shape.
- **Export.** `collectDocumentStyles` in `buildTranscriptHtml.tsx` carries the stylesheet into an exported transcript.

Also add:
- a `markdownCards.css` row to §"The pieces";
- a `probe-markdown-cards.mjs` row beside the other probes;
- two §"If you change this, check that" rows:
  - touching `markdownCards.css` → run `node .verify/probe-markdown-cards.mjs`, whose G1 proves no DOM moved and whose G7 and G15 hold the exclusion and the margins;
  - touching `PlainList`'s or `PlainRule`'s class string → on carded surfaces `markdownCards.css` overrides it, so run `probe-markdown-cards.mjs` as well as the baseline probe.

`src/shared/ui/verve/README.md`: under rule 3 (`:29`, "Colour reaches a screen through Tailwind, never as a literal"), add exactly this one sentence:
> A module carries its own stylesheet only where a selector must reach markup no className can: a scope class's descendants, `:has()`, `::marker`. It still spells Tailwind names through `@apply`; the one today is `src/modules/chat/transcript/markdownCards.css` ([08-rendered-shapes.md](../../../../docs/architecture/08-rendered-shapes.md) §"Element cards").

`docs/verification.md`:
1. **The new entry.** Under §"The browser harness", add an entry for `probe-markdown-cards.mjs`: its command, its final line `MARKDOWN CARDS: all gates PASS`, what G1, G7 and G15 hold, and its two screenshots.
2. **The false clauses.** Every occurrence of "nothing written on the server or the account" is false. The lines stood at 999, 1068, 1118 and 1220 when this plan was charted, and the baseline probe's entry near 922 may carry the same clause. Every shapes probe calls `openConsole` (`.verify/lib/console.mjs:364`), which PATCHes `simpleChatList` to false (`:222-233`) and drives the stored theme through `ensureTheme` (`:266`, `:420`), both against the dev account `verve`.
   - Replace each clause with the true account, keeping the "Zero Claude turns" fact that sits beside it.
   - Add one row to §"What bites people" whose bold title is exactly: **Every probe that calls `openConsole` writes the dev account's preferences**. Its text states the two writes and that no other account is touched.

**Sirens.**
- **Rewriting more than asked.** You will want to rewrite neighbouring entries or Verve README rules you think are stale. Change only the clauses named here, plus what the new probe and stylesheet require.
- **Editing the source.** You will want to fix a probe, CSS or constant comment you disagree with. Do not; all three are forbidden in this phase. A disagreement goes in your report.
- **Other Verve files.** `src/shared/ui/verve/controls.css`, in the same directory as the README, belongs to another session's in-flight work. Only `README.md` is yours.

## Waves

Wave 1: Phase 1 — the probe and the recorded baseline; independent of everything
Wave 2: Phase 2 — the stylesheet; consumes Phase 1's probe and recorded baseline
Wave 3: Phase 3 — the docs; describes what Phase 2 shipped

Strictly serial: each phase consumes the one before it, and Phases 2 and 3 both touch the same engine's docs through their sweeps.

## Goal

*Goal:* every markdown element a chat reply renders that had no styled treatment now paints as a card, rule, badge or panel, in light and dark, with the rendered DOM byte-identical to before. *Verify by:* Phase 2's two `[[verify]]` entries, which read `19 0 MARKDOWN CARDS: all gates PASS` and `BASELINE-SAME`.

## Diagnosis (measured before charting)

- **Lists already render as lists with visible markers.** Two probes were taken in headless Chromium against `:5183`.
  - A real transcript `ul` read `listStyleType: disc`.
  - An isolated `MarkdownBody` mount read `disc` for its `ul` and `decimal` for its `ol`.
  - Both screenshots show the bullets and the numbers.
  - The deciding rules are `.list-disc` and `.list-decimal`, on `PlainList` at `shapes/elements/list.tsx:30,34`. They beat Preflight's `ol, ul, menu { list-style: none }`.
- **Scott's lists were on a markdown surface.** Measured in his transcript (`~/.claude/projects/-home-lyphe--claude-claudecodeui-lyphe/caad59e6-761d-4c77-af32-d0b4c45d1db8.jsonl`):
  - The two list-bearing replies before his report are lines 1705 and 1772 (5 and 22 list lines). Both are main-thread assistant `text` blocks, not sidechain, which `MessageComponent.tsx:430` renders through `StreamingMarkdown`.
  - From his first list complaint (line 532) to his report (line 1809), 14 assistant text blocks carried lists.
  - All 96 thinking blocks in that span were empty, so the reasoning accordion had no text to show.
  - No subagent transcript under that session has an assistant text block in the six hours before his report, so no `SubagentNote` carried a list.
  - His markdown is valid GFM: `- **Label:** …` lines with no indent and no fence, and bullet lists may interrupt a paragraph.
- **The earlier fix that "still" refers to.** At line 971 a rule was removed that turned a list of `- **Label:** …` bullets into a "Details" grid. Since then those lists render as plain `ul`/`li`.
- **The one marker-stripping rule is intentional.** It is `[&>ul]:list-none` at `shapes/TaskProgress.tsx:57`, and it applies only to a settled task list.
- **Two surfaces render a model's prose as raw text**, outside `Markdown`:
  - `SubagentNote` (`SubagentPanel.tsx:79-86`);
  - the reasoning accordion (`MessageComponent.tsx:383`).
  The thinking row at `:366` renders the same kind of text as markdown. A list on either raw surface is literal `-` lines.
- **The gap is styling.** Headings, `strong`/`em`/`del`, `br`, `sup` and the footnotes section have no component and only Typography's defaults. Lists, quotes and `hr` have plain utility classes. Pictures linked from the web and display maths have no frame.

## Decisions

- **Paint, opted into by the wrapper.** The `Plain*` components render all eight markdown surfaces, and only the wrapper knows which surface it is. So the opt-in is a class there and the paint is a stylesheet scoped to it. As a result the DOM stays byte-identical and the no-swallow proof (`.verify/probe-shapes-baseline.mjs:322-323` compares `innerHTML`) is not reopened, along with every class-string gate in the shapes probes, including `probe-shapes-lists.mjs:722-725`.
- **`MARKDOWN_CARDS_CLASS` lives in `src/shared/constants.ts`** (`SKILL.md:94-95`). `TRANSCRIPT_PROSE` predates that rule and is not moved here.
- **The class goes on four call sites in two files.** `MarkdownContent` is the one door for tool markdown bodies.
- **The stylesheet lives in the transcript module, not in `src/index.css`.** It sits beside the renderer that owns the elements and is imported by `Markdown.tsx`. The Verve README records when a module stylesheet is allowed (Phase 3).
- **The override order is written down.** Typography, then `Plain*`, then `markdownCards.css`. It is recorded in `08-rendered-shapes.md` §"Element cards" and pointed to from `PlainList` and `PlainRule`.
- **Colours use `@apply` Tailwind names, per the Verve colour law.** Dark mode follows the tokens.
- **Excluded surfaces.** User bubbles are excluded, because a card inside a bubble is a frame inside a frame; the reversal is one call site at `MessageComponent.tsx:200`. `ToolErrorDisplay` keeps its red prose.
- **A card never changes a margin.**

## Edge cases

- **A list crossing the streaming boundary.** Two cards show until it settles. Accepted, because the markup is identical in both halves.
- **A still-streaming checks or timeline list.** It is carded while streaming and becomes its shape on settle. Accepted, and documented in Phase 3.
- **A streaming task list.** It is excluded by `:has(input[type='checkbox'])`, so there is no card-to-meter jump.
- **An ordered list numbered 100 or more.** The badge (`min-w-5 px-1`, anchored `right-full mr-2`) widens leftward into the `pl-11` gutter.
- **A reply that opens with a list.** No margin rule exists, so Typography's first-child margin still applies.
- **A browser without `:has()`.** Rule R1's whole selector is invalid there, so those lists render exactly as today.
- **The footnote label.** GFM emits `h2.sr-only#footnote-label`; R10 excludes it.
- **Export.** `buildTranscriptHtml.tsx:26-41` collects every document stylesheet, so exported transcripts show the cards.
- **A red pre-existing shapes baseline.** Phase 2 compares its verdict line against the one Phase 1 recorded, never against "identical".
- **A new `MarkdownContent` caller.** It is carded by default. That is intended: tool markdown is one surface.

## Exclusions

- **Link colour.** `MarkdownLink.tsx` still paints `text-blue-600`. Re-toning it is a DOM change with its own baseline re-capture.
- **Other surfaces.** `markdown-preview/MarkdownPreview.tsx` and `version-upgrade/VersionUpgradeModal.tsx` are other modules with their own react-markdown configs.
- **Raw-text rows.** `SubagentNote` and the `message.reasoning` accordion show prose without markdown. Routing them through `Markdown` changes markup on two surfaces the baseline does not pin, and is its own plan. It is named in the INTENT LOCK.
- **Raw HTML in replies.** It stays escaped (`rehype-raw` is not wired). `rehype-raw` sits unused in `package.json:191`, which is a separate cleanup.

## Doctrine citations

- `docs/architecture/08-rendered-shapes.md` §"Mental model" rule 2, and §"Gotchas": the baseline artifact, and "A re-tone is its own change, with its own baseline re-capture".
- `docs/verification.md:909-918`: the baseline's provenance, the deliberate `--write --force` re-capture, and "never by re-capturing from the current tree".
- `src/shared/ui/verve/README.md:29-33` (colour law) and `:69-70` (`verve/` holds stylesheets only).
- `.agents/skills/frontend-module-standards/SKILL.md:17-23` (imports), `:48-55` (exports and consumer comments), `:92-110` (constants and shared-file grouping).

## Open Questions

None. Every scope question is settled in Decisions, and the surface Scott's lists were on is measured in the Diagnosis. Every reversible choice is named with its reversal in Phase 2.

## Ship Logs

### Phase 1 Ship Log — ⛔ BLOCKED 2026-09-14
- [BLOCKED: idle: no stream line for 1200s]
- run: markdown-element-styling-plan-20260914-120108-569a · attempt 2 of 2 · fix-passes 0 of 3 · spec_sha 3fa1123ca2f7 · retry: allowed
- builder: hephaestus/deepseek-flash · session 68dbcc0d-c3bc-44ae-86b9-4bde6e89cb90 · 1200s · idle: no stream line for 1200s
- evidence: /home/lyphe/.claude/state/runner/markdown-element-styling-plan-20260914-120108-569a/phase_1/

### Phase 2 Ship Log — ⛔ BLOCKED 2026-09-14
- [BLOCKED: depends: not SHIPPED: Phase 1]
- run: markdown-element-styling-plan-20260914-120108-569a · attempt 0 of 2 (never dispatched) · fix-passes 0 of 3 · spec_sha 322fce777b1f · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/markdown-element-styling-plan-20260914-120108-569a/phase_2/

### Phase 3 Ship Log — ⛔ BLOCKED 2026-09-14
- [BLOCKED: depends: not SHIPPED: Phase 2]
- run: markdown-element-styling-plan-20260914-120108-569a · attempt 0 of 2 (never dispatched) · fix-passes 0 of 3 · spec_sha 3d1c75a4212b · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/markdown-element-styling-plan-20260914-120108-569a/phase_3/

### Run markdown-element-styling-plan-20260914-120108-569a — ALL-BLOCKED 2026-09-14
- shipped: none
- blocked: 1: idle, 2: depends, 3: depends
- next: plan-runner resume markdown-element-styling-plan-20260914-120108-569a
- brief: /home/lyphe/.claude/state/runner/markdown-element-styling-plan-20260914-120108-569a/resume_brief.md

### Phase 1 Ship Log — ⛔ BLOCKED 2026-09-14
- [BLOCKED: athena: fix-pass 1: step 3: re-ran the probe check → `19 G1PASS G2FAIL MARKDOWN CARDS: a gate FAILED`; both verifies → `SHOTS-OK`, `1`; LOW 1 named above as a sealed plan defect]
- run: markdown-element-styling-plan-20260914-125201-7bde · attempt 1 of 2 · fix-passes 1 of 3 · spec_sha 3fa1123ca2f7 · retry: on-spec-change
- builder: hephaestus/deepseek-flash · session a71a4c41-fc0f-4209-a434-a45abb948155 · 322s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 0 · LOW 2 → fix-pass 1/deepseek-flash (89s)
- forbidden: unchanged (6 declared, 6 present)
- evidence: /home/lyphe/.claude/state/runner/markdown-element-styling-plan-20260914-125201-7bde/phase_1/

### Phase 1 Ship Log — ↻ REPLANNED 2026-09-14
- run: markdown-element-styling-plan-20260914-125201-7bde · replan 1 of 3 · spec_sha 3fa1123ca2f7 → 40a133129d64 · replanner odysseus/claude-opus-5 · session 4b9068d9-9b2c-465f-b67a-acbf5903cabc · 137s · cost $0.80
- cause: athena: fix-pass 1: step 3: re-ran the probe check → `19 G1PASS G2FAIL MARKDOWN CARDS: a gate FAILED`; both verifies → `SHOTS-OK`, `1`; LOW 1 named above as a sealed plan defect
- changed: I rewrote Phase 1 so its G1 gate can actually fail. All four checks you asked for pass: `lint` exits 0, `gate` prints `RUNNER` first, `walk` renders, and the lock is still `lock:7ad340ee8d`. **Why it blocked.** The plan's own G1 row was wrong, not the builder's work. G1 compared `#probe-shapes-body`'s `innerHTML` between the two states. `innerHTML` only covers the body's children, and the only thing that changes between states is the body's own `class` attribute. So G1 could never fail. **What changed.** - **The G1 row in `## Interfaces`.** It now copies the body with `cloneNode(true)`, removes the copy's `class` attribute, and compares its `outerHTML` in both states. It also requires the
- evidence: /home/lyphe/.claude/state/runner/markdown-element-styling-plan-20260914-125201-7bde/phase_1/

### Phase 1 Ship Log — ✅ SHIPPED 2026-09-14
- run: markdown-element-styling-plan-20260914-125201-7bde · attempt 1 of 2 · cycle 4 · spawns 10/90 · fix-passes 1 of 3 · cost $0.92 (run $1.92) · resumed 1×
- builder: hephaestus/deepseek-flash · session 238ddc88-0879-439e-975f-325bf7045012 · 234s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 1 · MED 0 · LOW 1 → fix-pass 1/deepseek-flash (53s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 3/3 steps OK · verify 2/2 OK
- forbidden: unchanged (6 declared, 6 present)
- docs: Prometheus returned · 0 files
- residue: BLOCKING 0 · HIGH 1 · MED 0 · LOW 1 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/markdown-element-styling-plan-20260914-125201-7bde/phase_1/

### Phase 2 Ship Log — ✅ SHIPPED 2026-09-14
- run: markdown-element-styling-plan-20260914-125201-7bde · attempt 1 of 2 · cycle 5 · spawns 14/90 · fix-passes 1 of 3 · cost $0.83 (run $2.75) · resumed 1×
- builder: iris/deepseek-flash · session 0a906709-35d4-43b7-959d-9a46cb8ec009 · 402s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 1 · MED 0 · LOW 0 → fix-pass 1/deepseek-flash (195s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 10/10 steps OK · verify 2/2 OK
- forbidden: unchanged (16 declared, 16 present)
- docs: Prometheus returned · 2 files
- residue: BLOCKING 0 · HIGH 1 · MED 0 · LOW 0 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/markdown-element-styling-plan-20260914-125201-7bde/phase_2/

### Phase 3 Ship Log — ✅ SHIPPED 2026-09-14
- run: markdown-element-styling-plan-20260914-125201-7bde · attempt 1 of 2 · cycle 6 · spawns 15/90 · fix-passes 0 of 3 · cost $0.08 (run $2.83) · resumed 1×
- builder: prometheus/deepseek-flash · session f0eea469-978a-42a5-af10-ecd8ed57e1e9 · 163s · RESULT: DONE
- athena: n/a — code_change = false
- checks: 3/3 steps OK · verify 3/3 OK
- forbidden: unchanged (4 declared, 4 present)
- evidence: /home/lyphe/.claude/state/runner/markdown-element-styling-plan-20260914-125201-7bde/phase_3/

### Run markdown-element-styling-plan-20260914-125201-7bde — COMPLETE 2026-09-14
- shipped: 1, 2, 3
- blocked: none
- next: run complete — the checkpoint is Scott's /git, on his clock
- brief: /home/lyphe/.claude/state/runner/markdown-element-styling-plan-20260914-125201-7bde/resume_brief.md
