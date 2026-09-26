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
