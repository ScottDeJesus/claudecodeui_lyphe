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

`ActionMenu` renders into a portal on the host window's `document.body` (`fixed z-[70]`; MAN-7451) unless a mount passes `portal={false}` (`absolute z-50`, in place).

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

## INV-4406 — The dispatcher preference is written by entry patch, never whole

Every write to the `dispatcher` preference (`hiddenPlans`, `collapsedCards`, `cardOrder`, `askDrafts`) goes through `writeUserPreferenceEntries` (`src/shared/userSettings.ts`) as an ENTRY PATCH, `{ <list>: { <entry key>: <entry> | null } }`, naming only the entries its press changes. The server applies it per entry (`mergeEntryLists`, `server/modules/database/repositories/user-preferences.db.ts`), and the client applies the same rule to its own copy (`src/shared/preferenceEntryPatch.ts`): drop every named entry, append the non-null ones in the patch's order, keep the newest 200.

- why: a client's copy of the preference is read at sign-in and never again. While writes sent the whole document, any second open client (a phone, a second tab, the :5184 build) wrote its old copy back and erased every hide and fold made elsewhere since. Measured 2026-09-28 in `auth.db`: the operator's arc Hide stored restorly's 4 lane plans at 22:17:49; at 22:18:00 another of his clients folded the same arc and stored `{"hiddenPlans":[],"collapsedCards":["darc:restorly"]}`, and the arc was back at his next load ("unable to dismiss an arc"). `.verify/probe-dismiss-done.mjs` replays it with two browsers (the arc's corner is Dismiss now: the dismissal is the same entry).
- `roadmapSeen` is the second entry-patched key, with its own rule: INV-6580.
- never hand `writeUserPreference('dispatcher', …)` a whole document. A list sent as an ARRAY still REPLACES that list (the write of a bundle from before the patch), so a tab still running such a bundle can erase entries until it is reloaded.
- a patch stays in the persisted outbox (localStorage `user-preferences:entry-outbox`, `preferenceEntryPatch.ts`) until the server has stored it or refused it for good. The sign-in read lays every unconfirmed entry over the copy it fetched, whether or not the server holds the key, and sends again what that copy lacks; a failed read sends the whole outbox again. So a reload before the PATCH lands (the 400 ms debounce, a retry backing off behind a 5xx or a dropped request) and a read the server answered before the PATCH landed both keep the press. Sending twice is safe: a patch names only its own entries. A queued patch folds per entry with the next one (`foldEntryPatches`), and a retry is rebuilt from the store's current entries (`refreshEntryPatch`).

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/user-preferences.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/cardOrderEntries.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hiddenPlans.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useCardFold.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/preferenceEntryPatch.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/userSettings.ts

## INV-4410 — A console error is explained only by what the browser itself reported — a refusal's URL, or an abandonment

A probe's console gate cannot judge a line by its words: `Failed to load resource: the server responded with a status of 403 ()` names no resource, so a tolerance written as a string match either swallows a missing chunk or fails on a call nobody in this house controls.

- measured 2026-09-25, all six passes of `probe-deck-height.mjs` at every width and theme: `403 GET https://api.github.com/repos/siteboon/claudecodeui/releases/latest` — the app's own version check, refused from this host. Every probe here carries it, and it is no evidence about the page under test.
- cure, in `.verify/probe-deck-height.mjs`: a `response` listener records every `status >= 400` as `{status, method, url}` AND its URL in a `Set`; a console line carries its origin (`ConsoleMessage.location().url`, appended as ` @ <url>`); a line whose origin is in that `Set` is EXPLAINED — that is the refusal the host gave it — and a `Failed to load resource` line whose URL is NOT in the set stays unexplained, because a missing chunk is not an update check.
- the `Failed to fetch` case is the same principle from the browser's other side: the browser's own word for a request it abandoned, so the line is excused ONLY while the browser also reported one (`requestfailed` → `failed` non-empty) — never on the string alone, which would excuse a chunk the page needed and did not get.
- the OK line names what was tolerated, by URL: `0 unexplained console error (10 network line(s): 1 abandoned, 10 refused — 403 GET https://api.github.com/...)`, so the tolerance is a reading a reviewer can check rather than a promise.
- INV-4405's fallback gate (`every error is Failed to fetch` AND `net::ERR_ABORTED` reported) is the same principle; this one adds the refusal case beside the abandonment case. Both are stricter than a bare count of zero.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-deck-height.mjs

## INV-4449 — A lane card's title is floored and its row wraps — never one letter per line

**A lane card's title is floored and its row wraps — at no width does a card draw it one letter per line.**

`LaneCardHead` (`src/modules/dispatcher/LaneCardHead.tsx`) is the ONE head both lane cards draw — the plan card (`PlanCard`) and the arc deck (`DeckFrame`, `data-arc-header`). Its row one (`data-lane-head-row`) is `flex min-w-0 items-start gap-2`: a wrapping group — `flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1`, holding the title heading (`min-w-fit flex-1 break-words`; `h3`, or `h4` for a plan inside an arc deck), the status word and `done/total` bound as ONE unbreakable pair (`whitespace-nowrap`, so the count never lands on a line of its own), and the clock — beside a `shrink-0` corner (`⋯`, Hide, the fold). The lead and the spend pills are the head's own rows two and three, in that order, never on row one.

- `min-w-fit` (`min-width: fit-content`) IS THE FLOOR: the title is never narrower than its own longest word, so it reads on one line, or wraps BY WORD (a plan's `--` and `-` break it too) — never one character per line. Without it the title (`flex-1`, `min-w-0`) is the only item in the group that CAN give, because the word, the clock and the count must not — and it gives all the way down.
- THE FLOOR HAS ONE BOUND, MEASURED: `fit-content` is `min(max-content, max(min-content, available))` — capped by the room the row can give — and `break-words` (`overflow-wrap: break-word`) does NOT lower a word's intrinsic min-content. A title that is ONE token with no space and no hyphen in it, wider than the row, therefore neither wraps nor shrinks: the name leaves the card (measured 2026-09-25 at 390px with a 74-character token — one 622px line in a 332px row, the title 278px past the deck's right edge, the page itself not scrolling because its ancestors clip it). No live name reaches it: the corpus's longest unbroken segment is 19 characters. The row's own `scrollWidth` against its `clientWidth` is the reading that catches it; `lines === 1` passes there.
- `flex-wrap` IS THE OTHER HALF, and neither half works alone: a floor with no wrap pushes the word, the clock and the count past the card's edge instead of under the title; a wrap with no floor (`min-w-0`) lets the title shrink to nothing.
- THE CORNER STANDS OUTSIDE THE WRAPPING GROUP, `shrink-0`, so its presses keep the row's top-right whatever the group does; the group's `min-h-10 sm:min-h-7` is the corner's height, so a one-line title centres on it.
- THE FLOOR IS CONTENT-DRIVEN, NEVER A BREAKPOINT: the same heads are drawn in the Runner tab and in the chat gutter (~380px even at 1440), so `sm:` would put one home's card on the other home's branch.

measured 2026-09-25. Operator, with a phone screenshot of the Runner widget: "This card is rendering funny on my phone" (`/tmp/chains/arc-header-phone.jpg`: `restorly.arc` one letter per line in a monospace column, `$0.32 DeepSeek · 2.6M in · 26k out` whole beside it, the status word and the fold chevron cut off past the card's edge).

- CONTROL ON THE RUNNING BUILD (`--head-css` sets the group `nowrap` and the title `min-width: 0` in the page): on the 2026-09-25 header, 12 lines in a 0px-wide box at 390px and 23px of spill; on `LaneCardHead` with the Epic tag in the title (2026-09-28), 1 line in a 91px box at 390 and 4 lines in a 21px box at 320 — the corner now stands outside the group, so 390px leaves the title room even without its floor.
- AFTER (2026-09-26, `LaneCardHead`): all 20 heads of the Runner tab — the `restorly` deck, its 13 plan cards and 6 loose plans — read `scrollWidth === clientWidth` on `data-lane-head-row` at 1920, 390 and 320; the arc's title is 1 line in a 113px box at 390 and 134px at 320, the pills below it, 0px of header overflow, light and dark.

```probe
node .verify/probe-arc-header-fit.mjs --tag after             # exit 0: every reading held, 0 failed
node .verify/probe-arc-header-fit.mjs --tag head --head-css   # the control, expected to FAIL at 320: 4 lines in a 21px box
```
expect: on the deck the title's box is at least its longest word wide AND the head row's `scrollWidth` equals its `clientWidth`, at 1440, 390 and 320, dark and light; the pills (`data-arc-spend`) are below the title with no overlap; 0 console errors of this app's. The `--head-css` pass rewrites two CSS declarations IN THE PAGE (never the source, never the store) and is expected to reproduce the crush — that is what makes those declarations, and not something else in the diff, the cause. The dev client must be up on 127.0.0.1:5183; the probe presses no control and writes nothing.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/ArcDeck.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/DeckFrame.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/LaneCardHead.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-arc-header-fit.mjs

## INV-4481 — Probes written against the deleted plan-runner lane fail, and all.mjs is red

`.verify` probes written against the deleted plan-runner lane fail, and `node .verify/all.mjs` runs `phase-23.mjs`..`phase-27.mjs` by glob, so the whole run is red.

- what is gone: the `/api/plan-runner` routes (404 now, MAN-5437), the `runner_state` and `arc_state` frames, the `planRunner` preference (the folds and the hidden plans live under `dispatcher`, as `collapsedCards` and `hiddenPlans`), the run and arc cards (`data-runner-card`, `data-arc-card`), and the run and arc directories a fixture wrote into the old runner state tree.
- find the probes that still name them: `grep -rlE 'api/plan-runner|runner_state|arc_state|planRunner' claudecodeui_lyphe/.verify --include=*.mjs`. 2026-09-26: `phase-23` to `phase-27`, `probe-arc-run-merge`, `probe-phase-wave-mark`, `probe-runner-schedule`, `probe-side-widgets`, `probe-card-fold`, `stale-chat/asclepius-stale-proof`. Their fixtures (`lib/runner-fixture.mjs`, `lib/arc-run-fixture.mjs`, `lib/arc-stuck-fixture.mjs`) write fake runs into a tree no server reads.
- stale for a second reason: `probe-planner-card.mjs` and `probe-planner-card-write.py` still name plans with the retired name suffix (`grep -rl 'v3' claudecodeui_lyphe/.verify`), which the dispatcher refuses, and the planner soul under its retired id.
- a red `all.mjs` is therefore not a regression in the change under test: read which phase failed.
- retiring these files is the operator's call: they are the standing-gate record of past phases. `.verify/` is gitignored, so a `git clean -x` deletes it and no commit shows the change.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/all.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/arc-run-fixture.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/arc-stuck-fixture.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/runner-fixture.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/phase-23.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/phase-24.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/phase-25.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/phase-26.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/phase-27.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-arc-run-merge.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-card-fold.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-phase-wave-mark.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-planner-card.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-planner-card-write.py, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-runner-schedule.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-side-widgets.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/stale-chat/asclepius-stale-proof.mjs

## INV-4650 — probe — MAN-373 and ScrollArea's comment say "a focus" scrolled the outer box; measured, a focus does not

MAN-373 and ScrollArea's comment say "a focus" scrolled the outer box; measured, a focus does not

```probe
node /home/lyphe/.claude/state/pipeline-reviews/runner-card-makeover--whole/athena-probes/focusescape.mjs
expect: `before (static):` prints "outerScrollTop":0 with "innerScrollTop" equal to "innerMax" — a focus never reaches the escaped range
```

measured 2026-09-26 by chain chain-runner-card-makeover--whole-20260926-210824-bf49, finding L2, LOW
probe-key: 5ba30369542f5607a441e4f2004ee7f839d99d20

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/phaseWord.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanPhaseRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/ScrollArea.tsx

## INV-4651 — probe — MAN-373's ScrollArea roll call names 4 callers, beside a code comment naming all 12

MAN-373's ScrollArea roll call names 4 callers, beside a code comment naming all 12

```probe
grep -o "Every caller is a pane outside the transcript — [^.]*" /home/lyphe/.claude/claudecodeui_lyphe/docs/architecture/MANUAL.md; grep -rl "<ScrollArea" /home/lyphe/.claude/claudecodeui_lyphe/src | wc -l
expect: the row names four files while 12 files render <ScrollArea
```

measured 2026-09-26 by chain chain-runner-card-makeover--whole-20260926-210824-bf49, finding L3, LOW
probe-key: 5fb1f128c394cc47b391f7f01bc0f2c1f149ac33

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/phaseWord.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanPhaseRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/ScrollArea.tsx

## INV-4652 — probe — PlanCard's comment says it is "the one lane read a card makes"; PlanFace makes a second, and MAN-1557's `waitsOn` rationale is stale with it

PlanCard's comment says it is "the one lane read a card makes"; PlanFace makes a second, and MAN-1557's `waitsOn` rationale is stale with it

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -n "one lane read" src/modules/dispatcher/PlanCard.tsx; grep -n "useDispatcherPlans()" src/modules/dispatcher/PlanCard.tsx src/modules/dispatcher/PlanFace.tsx; grep -c "would be one bus subscription per card" docs/MANUAL.md
expect: PlanCard claims the one lane read while both PlanCard.tsx and PlanFace.tsx call useDispatcherPlans(), and MAN still prints the one-subscription rationale (count 1)
```

measured 2026-09-26 by chain chain-runner-card-makeover--whole-20260926-210824-bf49, finding L4, LOW
probe-key: fc4abb9778d094436351a99d60c0a4b49ab42bcb

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/phaseWord.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanPhaseRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/ScrollArea.tsx

## INV-6114 — probe — the ask and landing probes answer api.github.com in the page

`.verify/probe-card-ask.mjs`, `.verify/probe-runner-widget-list.mjs` and `.verify/probe-runner-landing.mjs` each answer `api.github.com` with an empty release (`context.route(GITHUB, …)`), 200 `{}`, registered before the page is created.
- Trap: the app's update check is a GET to `api.github.com`; a route scoped to `**/api/**` (this origin's) lets it reach the real network.
- Measured 2026-09-30: anonymous GitHub answered 403, its console error turned a correct build red (`0 console errors` fails); the landing probe went red ×2 at quota 0, green at quota 55.
- Rule: a `.verify/` probe answers every host the page reaches that is not a read of this origin, before it counts console errors. A filter on the collected console lines is not the cure; the reading stays exact only when the request never leaves the page.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-card-ask.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-runner-landing.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-runner-widget-list.mjs

## INV-6506 — probe — The standing proof for `width.reason` cannot tell the per-plan rule from the old board-wide one

The standing proof for `width.reason` cannot tell the per-plan rule from the old board-wide one

```probe
S=$(mktemp -d /tmp/athena-mut-XXXXXX) || exit 1
case "$S" in /tmp/athena-mut-*) ;; *) echo "refusing $S"; exit 1;; esac
mkdir -p "$S/.claude/scripts" || exit 1
tar -C ~/.claude --exclude=.venv --exclude=__pycache__ -cf - hooks | tar -C "$S/.claude" -xf - || exit 1
cp -r ~/.claude/scripts/runner_fixtures "$S/.claude/scripts/" || exit 1
python3 - "$S/.claude/hooks/dispatcher/width.py" <<'PY'
import re, sys
p = sys.argv[1]; s = open(p).read()
new, n = re.subn(r'    mine = \[other for other in busy_phases\(conn\) if .*\]\n', '    mine = busy_phases(conn)\n', s)
print("mutation applied:", n == 1)
open(p, "w").write(new)
PY
HOME="$S" timeout 120 python3 "$S/.claude/scripts/runner_fixtures/claude_swarm.py" 2>&1 | cut -c1-110 | tail -5
echo "fixture exit: ${PIPESTATUS[0]}"
case "$S" in /tmp/athena-mut-*) rm -r "$S";; esac
echo "[probe exit $?]"
expect: `mutation applied: True`, then a `FAIL` reading line and `fixture exit: 1` once the fixture holds a cross-plan reading (today: four PASS lines and `fixture exit: 0` — the board-wide count passes)
```

measured 2026-10-03 by chain chain-swarm-per-plan-20261003-135930-38a4, finding M1, MEDIUM
probe-key: 25810ac941c45dac1daf3446b719f82b9747be50

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/swarm-switch.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/content/RunnerModelContent.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useSwarmSwitch.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/hooks/dispatcher/planner_lanes.py, /home/lyphe/.claude/hooks/dispatcher/planner_rule.py, /home/lyphe/.claude/hooks/dispatcher/rule.py, /home/lyphe/.claude/hooks/dispatcher/swarm_word.py, /home/lyphe/.claude/hooks/dispatcher/width.py, /home/lyphe/.claude/scripts/runner_fixtures/claude_swarm.py

## INV-6507 — probe — Statements that the box's number bounds the whole board remain, in places the doc sweep's net will not reach

Statements that the box's number bounds the whole board remain, in places the doc sweep's net will not reach

```probe
cd ~/.claude && docstore get MAN-6438 | python3 -c "import sys,json; b=json.load(sys.stdin)['row']['body']; print('MAN-6438 board-wide sentence:', 'decides **how many phases the dispatcher walks at once' in b)"; grep -n "the runner walks one phase at a time" claudecodeui_lyphe/server/modules/settings/swarm-switch.ts
echo "[probe exit $?]"
expect: `MAN-6438 board-wide sentence: False` and no grep line — the flag's number is described as each plan's default, and `off` as one phase of each plan at a time (today: `True`, and `16: *   \`off\`      the swarm is off; the runner walks one phase at a time`)
```

measured 2026-10-03 by chain chain-swarm-per-plan-20261003-135930-38a4, finding L1, LOW
probe-key: f94c2531ee54f86bce8fe2dd7582a96f9364321c

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/swarm-switch.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/content/RunnerModelContent.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useSwarmSwitch.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/hooks/dispatcher/planner_lanes.py, /home/lyphe/.claude/hooks/dispatcher/planner_rule.py, /home/lyphe/.claude/hooks/dispatcher/rule.py, /home/lyphe/.claude/hooks/dispatcher/swarm_word.py, /home/lyphe/.claude/hooks/dispatcher/width.py, /home/lyphe/.claude/scripts/runner_fixtures/claude_swarm.py

## INV-6571 — probe — . An epic whose status turns `complete` without a new completion is never announced — and the comment and doc say it is

. An epic whose status turns `complete` without a new completion is never announced — and the comment and doc say it is

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && timeout 100 npx tsx --tsconfig server/tsconfig.json /home/lyphe/.claude/state/pipeline-reviews/epic-pushes/athena-probes/status-turns-late.mts; echo "[probe exit $?]"
expect: `idea dropped, arc turns complete: epic <name> (newest completion #<id>) — epic_finished pushes: 1` (today: 0 — the control line above it, the arc complete from the start, says 1)
```

measured 2026-10-03 by chain chain-epic-pushes-20261003-171247-ef3d, finding M1, MEDIUM
probe-key: f8a0597ce4b18b606a470ec712f117f91162a361

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-endings.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/notifications/services/notification-copy.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/notifications/services/ntfy-channel.service.ts

## INV-6572 — probe — . INV-5922 still says "a halt is one push per plan"

. INV-5922 still says "a halt is one push per plan"

```probe
docstore get INV-5922 | grep -c "a halt is one push per plan"; echo "[probe exit $?]"
expect: 0 (today: 1, probe exit 0)
```

measured 2026-10-03 by chain chain-epic-pushes-20261003-171247-ef3d, finding L1, LOW
probe-key: 247eff9f2e5e8c2ae9266dac25e3b73c4604a9f1

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-endings.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/notifications/services/notification-copy.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/notifications/services/ntfy-channel.service.ts

## INV-6576 — probe — the roadmap lane's rows are not in `docs/MANUAL.md`'s family, and the report does not say why

the roadmap lane's rows are not in `docs/MANUAL.md`'s family, and the report does not say why

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe; for t in MAN-1498 MAN-7628 MAN-7629; do printf '%s ' $t; docstore get $t | python3 -c "import sys,json;p=json.load(sys.stdin)['row']['package'];print(p['repo']+':'+p['path'])"; done; grep -c '^## MAN-7628' docs/MANUAL.md
expect: MAN-1498 prints cloudcli:docs, MAN-7628 and MAN-7629 print cloudcli:. and the grep prints 0 (cured when the two print cloudcli:docs and the grep prints 1)
```

measured 2026-10-03 by chain chain-roadmap--lane--docs-20261003-180710-2122, finding M1, MEDIUM
probe-key: a27055db666a8a0c1d7ddd7c3399c36867113d4c

governs: /home/lyphe/.claude/claudecodeui_lyphe/docs/

## INV-6577 — probe — MAN-7626, the lane's shared-door row, sits in the repo-root `MANUAL.md` while every other row of the lane lives in `docs/MANUAL.md`

MAN-7626, the lane's shared-door row, sits in the repo-root `MANUAL.md` while every other row of the lane lives in `docs/MANUAL.md`

```probe
docstore get MAN-7626 | python3 -c "import sys,json;p=json.load(sys.stdin)['row']['package'];print(p['repo']+':'+p['path'])"
expect: cloudcli:docs — the package of MAN-7631 and MAN-1498 (today cloudcli:.)
```

measured 2026-10-03 by chain chain-roadmap--lane--whole-20261003-183736-de24, finding L2, LOW
probe-key: 84ae870657a8db5dfbd97279f63b4c2619ad3e16

governs: /home/lyphe/.claude/claudecodeui_lyphe/docs/

## INV-6580 — roadmapSeen is entry-patched, and its merge does not compare stamps — a writer never sends an older at

`roadmapSeen` is the second entry-patched preference, beside `dispatcher` (INV-4406). Shape: `{ seen: { name: string; at: string }[] }`, one entry per roadmap; `name` is the roadmap's, `at` is the dispatcher's UTC string of the newest `shipped_at`, `completed_at` or `reached_at` this user's screen celebrated.

- A key joins BOTH lists together: `ENTRY_PATCHED_KEYS` (`src/shared/userSettings.ts`) and `ENTRY_LISTED_KEYS` (`server/modules/database/repositories/user-preferences.db.ts`). One without the other sends patches the server stores whole, or stores whole what the client patches.
- Write it through `writeUserPreferenceEntries`, never `writeUserPreference('roadmapSeen', …)`. why: a whole write from the device that read last erases the other roadmap's stamp and replays its completions.
- THE MERGE IS NOT MONOTONIC. `mergeEntryLists` (server) and `applyEntryPatch` (client) replace the named entry and compare no `at`, so a patch carrying an older `at` moves the stamp backward and the other device replays what it already played.
- A stamp writer never sends an `at` older than the one it read. This cannot cover a stale device that never re-read the server's stamp: only a merge that keeps the newer `at` per roadmap can, on both sides, and `dispatcher`'s lists share that merge.
- A reader treats `{ "seen": [] }` and an absent key alike: the entry merge keeps the key after every entry is removed.
- `PreferenceListEntry` (`src/shared/types.ts`) is `string | { name: string; [field: string]: unknown }`, so `{ name, at }` is legal as a literal.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/user-preferences.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/preferenceEntryPatch.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/userSettings.ts
