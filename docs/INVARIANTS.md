<!-- docstore export; edit rows with docstore write, never this file -->

## INV-206 — question-cards.mjs is tied to one live session

`node .verify/question-cards.mjs [before|after]` — the label only names the screenshots in `.verify/shots/question-cards/` (gitignored). Needs the dev server at `http://127.0.0.1:5183`; starts no model turn.

| Fact | Detail |
| --- | --- |
| Hard-coded input | `SESSION_ID` `a0cb7bc1-e018-4771-90a0-c734587dc02b` (the operator's intent-lock session of 2026-09-24), `PENDING_TOOL_USE`, `CUSTOM_NOTE_START` |
| Failure when the session is pruned | `tool_use <id> not found in <transcript path>` or `card not found`; reads as a regression and is not one |
| Answered cards | Read from that session in the app; the session still grows and the chat unmounts off-screen rows, so the probe scrolls back and retries until the card stays mounted |
| Pending card | Mounted through the `phase-31.mjs` seam (the app's own `QuestionAnswerContent` in a real `PermissionContext`) with the real payload of the session's last question |
| Gates | 1 answered list is an `<ol>` and `Run it? · lock:` sits outside it · 2 custom note is ONE element · 3 plain option answer is an option row, no custom block · 4 pending list is an `<ol>` · 5 keys `1`, `0`, `Enter` behave and submit the same answer string · 6 no console errors while signed in |
| Noise it forgives | A Vite error overlay from another session's half-saved file (removed before shots, logged, not counted); GitHub calls answered locally as `lib/console.mjs` does |
| `before` mode | Screenshots the current cards only; the old components no longer exist |

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/question-cards.mjs

## INV-4354 — A folded Collapsible's rows still read as visible

`isVisible()` and DOM node counts report the rows of a FOLDED `Collapsible` as visible.

- why: `CollapsibleContent` (`src/shared/ui/Collapsible.tsx`) keeps its children mounted inside a `grid-rows-[0fr]` wrapper with `overflow-hidden`; each row keeps a non-empty bounding box.
- measure a fold as a clip: walk each row's ancestors up to its own card, intersect every non-`visible` `overflow` box, count rows whose intersection is taller than 1px. `PAINTED_HEIGHT` in `.verify/probe-dispatch-card-phases.mjs` is the reading.
- stop the walk at the card: the pane above it is a scroll area, and a scroll position is not a fold.
- `data-state="open|closed"` on `CollapsibleContent` corroborates; it is never the verdict.
- 2026-09-25: the gutter's plan cards read as visible by node count and `isVisible()` while painting 0 of 9 and 0 of 14 rows.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Collapsible.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-dispatch-card-phases.mjs

## INV-4356 — ActionMenu portals to body unless a mount passes portal={false}

`ActionMenu` renders into a `document.body` portal (`fixed z-[70]`) unless a mount passes `portal={false}` (`absolute z-50`, in place).

- why: in place, the menu is clipped by the first `overflow:hidden` ancestor and painted inside the first ancestor that makes a stacking context; a `backdrop-filter` header scopes the menu's `z-50` to its own layer, so the transcript paints over it.
- opt-out mount: `src/modules/mcp/McpServers.tsx` only — Settings' `fixed z-[9999]` panel draws a `z-[70]` portalled menu UNDER its own content.
- a new mount inside an overlay whose layer is above `70` passes `portal={false}`; so does a menu that must scroll with its trigger (the portal path closes on the first scroll).
- portal rungs: above fullscreen-card (`45`), Dialog (`50`) and the FAB (`60`); under Settings (`9999`), modals (`10000`) and the toast stack (`10001`).
- `align` is honoured on the portal path (both edges clamped); no mount passes it.
- proof: `node .verify/export-menu-layer.mjs <label>` — 4 sites × dark/light, exit 0 on `ALL PASS`. 2026-09-25: 94 ok / 0 FAIL; 70 ok / 20 FAIL with the old default.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/mcp/McpServers.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/ActionMenu.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/export-menu-layer.mjs

## INV-4357 — A rect read from an opening .vv-action-menu is 0.96 of its size and 24px low

`getBoundingClientRect()` on a `.vv-action-menu` in the commit that opens it returns the animation's start frame, not the settled box.

- why: `.vv-action-menu` enters on `animation: vv-pop 0.3s … both` (`feedback.css`); the start state `translateY(24px) scale(.96)` (`tokens.css`) is on the element in the frame a layout effect runs.
- 2026-09-25, composer: rect `250×251` against the `260×261` layout box; a flip sized from it left the last item over the trigger's top 4px.
- a `ResizeObserver` never fires for it: the layout box never changes, only the transform.
- size and place from `offsetWidth` / `offsetHeight`, which no transform touches. `placePortalledMenu` in `src/shared/ui/ActionMenu.tsx` does, once per open, in a `useLayoutEffect`.
- a viewport resize closes the menu (`closeOnViewportChange`), so nothing re-places it.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/ActionMenu.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/export-menu-layer.mjs

## INV-4358 — A useLayoutEffect in the exported transcript tree warns on the server

React's server renderer warns `useLayoutEffect does nothing on the server` when the hook is CALLED, whatever its body does.

- why: the export document is built by `renderToStaticMarkup`; an `isExporting` early return inside the effect body leaves the warning, once per long turn (2026-09-25, verified).
- cure: the measuring hook lives in `FoldMeasurement` (`src/modules/chat/transcript/CollapsibleUserText.tsx`), mounted as `{!isExporting && …}`; the export tree never renders it.
- any component the export renders that needs a layout effect takes the same split: the hook in a child gated on `isExporting`.
- `.verify/export-menu-layer.mjs` fails a site on any console error after its real download, so a returning warning fails the probe.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/transcript/CollapsibleUserText.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/export-menu-layer.mjs

## INV-4405 — waitForLoadState('networkidle') resolves at once on a loaded document, so a navigation right after it aborts the mount burst

`page.waitForLoadState('networkidle')` returns immediately for a document that already loaded, so a `goto` or a reload straight after it abandons the app's mount burst in flight.

- symptom: console `Failed to fetch` from `useVersionCheck` and `useSidebarController` beside `net::ERR_ABORTED` on about 17 requests (`/health`, `/api/accounts`, `/api/usage`, the sidebar's archived sessions, the GitHub release). It appears with no card pressed.
- why: the `networkidle` lifecycle event fired when the document first loaded; waiting on it again resolves instantly.
- the burst arrives in WAVES, so one zero-in-flight sample reads quiet between two of them (the next wave's `/api/deepseek/balance` proved it).
- the source is the entry path's desktop resize: a 390px document resized up mounts the sidebar, and the `goto` a moment later abandons its requests.
- cure in `.verify/probe-card-fold.mjs`: `quiet` counts in-flight requests and requires the quiet to HOLD 600ms; `enterProject` drains before it navigates. With both, the fold passes log 0 console errors.
- fallback gate: a console error passes only while every error is `Failed to fetch` AND the browser reported `net::ERR_ABORTED`; both counts are printed, and any other error fails.
- 2026-09-25: the entry path alone, with no fold pressed, logged 4 of these errors.
- other probes that navigate right after entry can carry `quiet` from this file; it is not yet in `.verify/lib/`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-card-fold.mjs

## INV-4406 — Two open documents overwrite each other's card folds: collapsedCards is written whole

`writeFolds` and `pruneCardFolds` (`src/shared/hooks/useCardFold.ts`) read the localStorage mirror and PATCH the whole `planRunner.collapsedCards` list, so the last document to write wins.

- measured 2026-09-25: with nothing of the probe running, the stored list toggled between `["darc:restorly"]` and `[]` at 16:18:45, 16:18:52, 16:19:54 and 16:20:02. A second open document was folding and unfolding the operator's own arc card.
- effect on a probe: after a reload, 3 of 5 keys were missing while the card-side reading was still correct. A fold test run beside an open browser tab of the operator's can fail for this reason alone.
- `dismissedRuns.ts` has the same shape, and `useCardFold.ts` copies it. The merge is per KEY of the blob, not per entry of the list.
- not cured: merge-on-write, or a server-side merge, is a refactor. Read the failing key list before blaming the fold.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useCardFold.ts

## INV-4410 — A console error is explained only by what the browser itself reported — a refusal's URL, or an abandonment

A probe's console gate cannot judge a line by its words: `Failed to load resource: the server responded with a status of 403 ()` names no resource, so a tolerance written as a string match either swallows a missing chunk or fails on a call nobody in this house controls.

- measured 2026-09-25, all six passes of `probe-deck-height.mjs` at every width and theme: `403 GET https://api.github.com/repos/siteboon/claudecodeui/releases/latest` — the app's own version check, refused from this host. Every probe here carries it, and it is no evidence about the page under test.
- cure, in `.verify/probe-deck-height.mjs`: a `response` listener records every `status >= 400` as `{status, method, url}` AND its URL in a `Set`; a console line carries its origin (`ConsoleMessage.location().url`, appended as ` @ <url>`); a line whose origin is in that `Set` is EXPLAINED — that is the refusal the host gave it — and a `Failed to load resource` line whose URL is NOT in the set stays unexplained, because a missing chunk is not an update check.
- the `Failed to fetch` case is the same principle from the browser's other side: the browser's own word for a request it abandoned, so the line is excused ONLY while the browser also reported one (`requestfailed` → `failed` non-empty) — never on the string alone, which would excuse a chunk the page needed and did not get.
- the OK line names what was tolerated, by URL: `0 unexplained console error (10 network line(s): 1 abandoned, 10 refused — 403 GET https://api.github.com/...)`, so the tolerance is a reading a reviewer can check rather than a promise.
- INV-4405's fallback gate (`every error is Failed to fetch` AND `net::ERR_ABORTED` reported) is the same principle; this one adds the refusal case beside the abandonment case. Both are stricter than a bare count of zero.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-deck-height.mjs

## INV-4449 — The arc header's title is floored and the row wraps — never one letter per line

**The arc header's title is floored and the row wraps — at no width does a card draw it one letter per line.**

`DeckFrame`'s header row — the one holding the title, a lane's `titleTail`, the status badge and the fold toggle (`src/modules/plan-runner/DeckFrame.tsx`, `data-arc-header`) — is `flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1`, and the title `h4` is `min-w-fit flex-1 break-words`.

- `min-w-fit` (`min-width: fit-content`) IS THE FLOOR: the title is never narrower than its own longest word, so it reads on one line, or wraps BY WORD — never one character per line. Without it the title (`flex-1`, `min-w-0`) is the only item in the row that CAN give, because the tail, the badge and the fold toggle must not — and it gives all the way down.
- THE FLOOR HAS ONE BOUND, MEASURED: `fit-content` is `min(max-content, max(min-content, available))` — capped by the room the row can give — and `break-words` (`overflow-wrap: break-word`) does NOT lower a word's intrinsic min-content. A title that is ONE token with no space and no hyphen in it, wider than the row, therefore neither wraps nor shrinks: the name leaves the card (measured 2026-09-25 at 390px with a 74-character token — one 622px line in a 332px row, the title 278px past the deck's right edge, the page itself not scrolling because its ancestors clip it). HEAD was worse there — the same token crushed into a 25px column of 37 stacked letters — and no live name reaches it: the corpus's longest unbroken segment is 19 characters against a 242px narrowest row. THE PROBE CANNOT SEE IT: `lines === 1` passes while the row's own `scrollWidth` against its `clientWidth` is the reading that fails, and every payload is the lane's live arcs.
- `flex-wrap` IS THE OTHER HALF, and neither half works alone: a floor with no wrap pushes the badge and the toggle past the card's right edge instead of under it; a wrap with no floor (`min-w-0`, the shape HEAD shipped) lets the title shrink to nothing while the row still overflows. A lane's tail (the dispatcher's spend line) therefore DROPS BELOW the title at a narrow width and stays beside it on a wide one.
- THE FLOOR IS CONTENT-DRIVEN, NEVER A BREAKPOINT: the same decks are drawn in the Runner tab (a `max-w-2xl` column) and in the chat gutter (~380px even at 1440), so `sm:` would put one home's deck on the other home's branch.
- A LANE'S OWN TAIL MUST NOT TAKE A WIDTH IT CANNOT GIVE BACK: `src/modules/dispatcher/ArcDeck.tsx` draws the spend line `min-w-0` with NO `shrink-0`, so a longer figure wraps by word rather than pushing the title or the card's edge.

measured 2026-09-25. Operator, with a phone screenshot of the Runner widget: "This card is rendering funny on my phone" (`/tmp/chains/arc-header-phone.jpg`: `restorly.arc` one letter per line in a monospace column, `$0.32 DeepSeek · 2.6M in · 26k out` whole beside it, the status word and the fold chevron cut off past the card's edge).

- CONTROL ON THE RUNNING BUILD (`--head-css` puts the row back to HEAD's three declarations in the page: row `nowrap`, title `min-width: 0`, tail `shrink-0`): at 390px the dispatch arc's title renders 12 lines in a 0px-wide box under a 101px word and the header overflows the card by 23px; at 320px, 12 lines and 93px of spill with FOUR items past the edge. The runner's deck (no tail) was squeezed the same way, more mildly: 186px of a 332px row at 390px (3 lines), 116px of 262px at 320px (5 lines).
- AFTER: title 1 line in a 332px box at 390px and 262px at 320px, tail below the title at both, 0px of header overflow, no console errors — 42 readings held across 1440/390/320 × light/dark × both decks.

```probe
node .verify/probe-arc-header-fit.mjs --tag after             # exit 0: every reading held, 0 failed
node .verify/probe-arc-header-fit.mjs --tag head --head-css   # the control, expected to FAIL: 12 lines in a 0px box
```
expect: on each deck the title's box is at least its longest word wide AND the header row's `scrollWidth` equals its `clientWidth` (the reading that catches the one-bound case above), at 1440, 390 and 320, dark and light; the tail is below the title or beside it with no overlap; 0 console errors of this app's. The `--head-css` pass rewrites three CSS declarations IN THE PAGE (never the source, never the store) and is expected to reproduce the crush — that is what makes those declarations, and not something else in the diff, the cause. The dev client must be up on 127.0.0.1:5183; the probe presses no control and writes nothing.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/ArcDeck.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/plan-runner/DeckFrame.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-arc-header-fit.mjs
