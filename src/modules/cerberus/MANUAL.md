<!-- docstore export; edit rows with docstore write, never this file -->

## MAN-7868 — Cerberus — the tab: `CerberusProvider`, the status table and the views, where each subject is documented, and the rules of the module

The Cerberus tab: the fleet's health on the house row. One provider reads `GET /api/cerberus/overview` and holds it for every reader; the views draw from it, and a check's sheet reads one check. The tab is composed from `@/shared/ui`, with three pieces added to the library for it (Sheet, Timeline, Steps); TextArea came for the roadmap and the Mute dialog takes it too. Server module: MAN-7815. Wire shapes: MAN-7807. Design: `design/cerberus/Cerberus Spec.dc.html`, whose Table 8 makes it reference for layout, copy and motion only: no prototype markup or script is in `src/`.

## Where each subject lives
| subject | row | code |
|---|---|---|
| the tab on the house row: `AppTab`, `VALID_TABS`, `CERBERUS_TAB`, count pill, pane, both palettes | MAN-7866 | `WorkspaceTabs.tsx`, `useWorkspaceTabGates.ts`, `ProjectSidebarRegion.tsx`, `WorkspaceMain.tsx`, `useProjectsState.ts`, `ProjectCommandPalette.tsx`, `command-palette/CommandPalette.tsx` |
| the root, the header, the clock pill, the passing count | MAN-7891 | `CerberusPanel.tsx`, `CerberusHeader.tsx`, `hooks/useClock.ts`, `hooks/useCountTo.ts` |
| the provider, `useCerberusNeeds`, what triggers a read, `useCheckDetail` and `?end=`, `api.cerberus`, `cerberusTime` | MAN-7871 | `context/CerberusContext.ts`, `context/CerberusProvider.tsx`, `hooks/useCheckDetail.ts`, `utils/cerberusTime.ts`, `index.ts`, `src/shared/api.ts` |
| the status table, the four marks, minute cells, lookup moment, recorded results | MAN-7873 (marks MAN-7874, lookup MAN-7875, traps MAN-7876) | `utils/cerberusStatus.ts`, `StatusMarks.tsx`, `sheet/MinuteCells.tsx`, `sheet/LookupMoment.tsx`, `sheet/RecordedResults.tsx` |
| the Fleet's pure model: order, groups, search, default expansion, `ringsLayout`; `toTimelineEvent` | MAN-7872 | `fleet/fleetModel.ts`, `utils/activityEvents.ts` |
| Fleet's sentences, the Needs-you card, status bar, legend, toolbar | MAN-7879 | `utils/fleetWords.ts`, `fleet/NeedsYouCard.tsx`, `fleet/FleetStatusBar.tsx`, `fleet/FleetToolbar.tsx` |
| Fleet: view, Grid, List, node card, service row, Rings, What happened | MAN-7880 (reads MAN-7885, Rings MAN-7886, service row MAN-7887) | `fleet/FleetView.tsx`, `FleetGrid.tsx`, `FleetList.tsx`, `NodeCard.tsx`, `ServiceRow.tsx`, `FleetRings.tsx`, `RingMarks.tsx`, `RingsNodePanel.tsx`, `WhatHappenedCard.tsx`, `hooks/useLeavingNeeds.ts` |
| the check sheet | MAN-7878 | `sheet/CheckSheet.tsx`, `CheckRows.tsx`, `SelectedCheck.tsx`, `CheckLabelEditor.tsx` |
| History | MAN-7877 (feed MAN-7888, lookup card MAN-7889, banner MAN-7890) | `history/*.tsx`, `hooks/useActivityFeed.ts`, `UnreachableBanner.tsx` |
| the Mute and Enroll dialogs | MAN-7884 (Mute MAN-7892, Enroll MAN-7893, install step MAN-7894) | `modals/*.tsx`, `hooks/useEnrollmentStatus.ts`, `utils/enrollAsk.ts` |
| the slots later plans fill | MAN-7867 | `SLOT:` comments, `VIEWS` in `CerberusPanel.tsx` |
| the six `animate-cerberus-*` motions and who draws each | MAN-7869 | `tailwind.config.js` |
| the words | MAN-7870 (alternatives MAN-7881, variables MAN-7882, open words MAN-7883) | `src/modules/i18n/locales/en/common.json` |
| the library pieces, their paint, the tone names | MAN-740, MAN-739 (`cloudcli:src/shared/ui/verve`); `Timeline`'s layout MAN-7847 | `src/shared/ui/Sheet.tsx`, `src/shared/ui/Timeline.tsx`, `src/shared/ui/TextArea.tsx`, `src/shared/ui/Steps.tsx`, `src/shared/ui/verve/panels.css`, `tailwind.config.js` |
| the routes the client reads | MAN-7802 (`cloudcli:server/modules/cerberus`) | `server/modules/cerberus/cerberus.routes.ts` |

## Rules of the module
- Other modules reach it only through `src/modules/cerberus/index.ts`: `CerberusProvider`, `useCerberusNeeds`, `CerberusPanel` (`lazy`). Files inside import siblings by path, never through the barrel.
- Types are `type`, never `interface`. A type two files share lives in `src/shared/types.ts` (`TimelineEvent`, `CerberusView`, `CerberusSheetTarget`, `FleetLayout`, `FleetEntry`, …). `src/shared/cerberus-types.ts` is read, never redefined.
- Every endpoint is a verb of `api.cerberus` in `src/shared/api.ts`.
- Layout of the module: `context/` (provider), `hooks/`, `utils/` (pure), `fleet/`, `sheet/`, `history/`, `modals/` (both dialogs).
- Colour: no hex, `rgba(` or `var(--` in a className or style under `src/modules/cerberus/` (2026-10-06: none outside one comment). Tone reaches paint only as `data-tone` plus a `tone-*` name (MAN-739 rule 3); the set stays five, so denied is `danger` (MAN-739 rule 4).
- A status is painted from one table, `STATUS_TABLE` (MAN-7873), and a state that speaks in colour also carries its glyph or word (MAN-578).
- Words: every sentence is a `cerberus.*` key through `t()`, English only; a label, reason, node name or description is data, never a key (MAN-7870).
- No unit tests: each seam is shown on the real app against the live center.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/

## MAN-7866 — Cerberus — the tab on the house row: `AppTab`, `VALID_TABS`, `CERBERUS_TAB`, the count pill, the pane, both palettes

Where the Cerberus tab stands in the workspace and what feeds its count. The tab's own tree: MAN-7891. The reader behind the count: MAN-7871. The words: MAN-7870. Row map: MAN-7868.

## Placement
| piece | fact |
|---|---|
| `AppTab` (`src/shared/types.ts`) | contains `'cerberus'`, after `'api'` |
| `VALID_TABS` (`useProjectsState.ts`) | contains `'cerberus'`, after `'api'`: a stored tab is restored on reload only for an id in this set. The app keeps no project selected across a reload, so a project row is chosen first, as for every tab |
| house row (`WorkspaceTabs.tsx`) | `CERBERUS_TAB = { id: 'cerberus', labelKey: 'tabs.cerberus', icon: Radar }`, appended after `API_TAB`: last built-in of row two, plugin tabs after it, no tab a hand already knows has moved |
| gate | none. why: the fleet's health is a fact about the house whichever project is open, and a monitor that hid on a quiet day could never say "All quiet" |
| label | `tabs.cerberus` = "Cerberus" (`en/common.json`, after `tabs.notes`) |
| provider | `<CerberusProvider>` inside `<HealProvider>` in `src/App.tsx`: MAN-7871 |

## Count pill
| step | file | holds |
|---|---|---|
| 1 | `CerberusContext.ts` | `useCerberusNeeds()` = `overview?.counts.needsYou ?? 0` |
| 2 | `useWorkspaceTabGates.ts` | `cerberusNeeds: number` from `useCerberusNeeds()` |
| 3 | `ProjectSidebarRegion.tsx` | passes `cerberusNeeds` to `WorkspaceTabs` |
| 4 | `WorkspaceTabs.tsx` | prop `cerberusNeeds`; `countFor('cerberus')` is it when above zero, else `undefined` (no mark) |

- The strip's number and the tab headline's number are one value: `CerberusHeader` reads `counts.needsYou` from the same overview (MAN-7891).
- An icon tab draws a dot and says the number in its title: `Cerberus (<count>)` (`Tabs.tsx`).
- Zero until the first read answers: no mark.

## Width
- 9 glyphs with Memory and Heal on = `9 × 36 + 8 × 2 = 340px` against the 304px strip: the strip holds seven and the More trigger takes the last two (API, Cerberus). A selected tab takes the row's last slot and the one before it collapses (measured 2026-10-06).
- The glyph-width comment in `WorkspaceTabs.tsx` counts nine.

## Pane and palettes
| piece | fact |
|---|---|
| pane (`WorkspaceMain.tsx`) | `activeTab === 'cerberus'` → `<div className="h-full overflow-hidden"><CerberusPanel /></div>`, after the API pane, inside the file's `Suspense`; the panel is the barrel's `lazy` export, its own chunk, loaded on the first open. The "No gate" comment sits above it |
| `NAV_TABS` (`command-palette/CommandPalette.tsx`) | `{ id: 'cerberus', label: 'Go to Cerberus', keywords: 'cerberus fleet health monitoring checks wardens nodes' }`, after API |
| `visibleTabs` (`ProjectCommandPalette.tsx`) | the always-on list names `'cerberus'` after `'api'`: a `NAV_TABS` row shows only if this list names it |

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/command-palette/CommandPalette.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useProjectsState.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useWorkspaceTabGates.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/ProjectCommandPalette.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/ProjectSidebarRegion.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/WorkspaceMain.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/WorkspaceTabs.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## MAN-7867 — Cerberus — the slots later plans fill: every `SLOT:` comment, the `VIEWS` table and `activityEvents`

Where the fixes, diagnosis, updates and sessions plans plug into the tab. Find every slot: `grep -rn "SLOT:" src/modules/cerberus`. Row map: MAN-7868.

## Rules
- A slot is a comment (or a table row) and draws nothing: no placeholder, no empty container, no flag.
- The plan that fills a slot puts its piece where the comment stands and deletes the comment.
- A filled piece carries its own words under `cerberus.*` (MAN-7870) and its own tone through `data-tone` (MAN-739 rule 4).

## Slots
| slot | file | what goes there | plan |
|---|---|---|---|
| header button row | `CerberusHeader.tsx`, `SLOT: Update wardens` | the Update wardens button, before Enroll a node | updates |
| tabs list | `CerberusPanel.tsx`, `VIEWS` (a table, no `SLOT:`); `CerberusView` in `src/shared/types.ts` | one row `{ id: 'catalog', labelKey, hintKey }` between `fleet` and `history`, hint "Fixes Cerberus can offer, or run on its own"; the view in the body between Fleet's and History's; `'catalog'` in `CerberusView` | fixes |
| Needs-you run strip | `fleet/NeedsYouCard.tsx`, `SLOT: run` | above the action row: "Running on its own · <name>", "✓ <name> finished HH:MM:SS · waiting for the next check", "✕ The warden refused “<name>”", the run's last line in mono | fixes |
| Needs-you action row | `fleet/NeedsYouCard.tsx`, `SLOT: actions` | before Mute: Run “<fix>” (tonal); Diagnose / Diagnosing… / See diagnosis (outline) | fixes, diagnosis |
| Needs-you quiet line | `fleet/NeedsYouCard.tsx`, `SLOT: quiet` | after the count line of "Nothing needs you": " Fixes set to auto-run will run on their own and show up below." | fixes |
| sheet, check → cells | `sheet/CheckSheet.tsx`, `SLOT: fixes and diagnosis` | under the check and its actions, above "Last 60 minutes": "Fixes in the catalog" and a fix's output; the read-only diagnosis | fixes, diagnosis |
| sheet action row | `sheet/SelectedCheck.tsx`, `SLOT: actions` | before Mute: Diagnose; the catalog fix | diagnosis, fixes |
| node card, updating | `fleet/NodeCard.tsx`, `SLOT: updating` (both faces) | before the warden line: the "Updating · <step>" pill (info tone, `vv-pulse`) | updates |
| node, projects | `fleet/NodeCard.tsx` (both faces), `fleet/RingsNodePanel.tsx`, `SLOT: projects` | after a co-located node's services: `NodeProjects` ("Projects that run here", "Run a project here") | sessions |
| rings key | `fleet/RingMarks.tsx`, `SLOT: fixing` (`KEY`) | second row after Needs you: "Fix running or updating", the info dot, once something feeds `fixing` or `enrolling` | fixes, updates |

## Other places a plan adds a case
| place | what a plan adds |
|---|---|
| `utils/activityEvents.ts` `toTimelineEvent` | a `case` per new `CerberusActivity` kind (`fix`, `catalog`, `diagnosis`, `warden`), a builder, words under `cerberus.activity`; an unknown kind draws neutral and is never thrown on (MAN-7872) |
| `utils/cerberusStatus.ts` `nodeMark` | `fixing` and `enrolling` return `null` (no mark) while nothing feeds them; the plan that feeds one gives it a mark |

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/CerberusHeader.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/CerberusPanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/NeedsYouCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/NodeCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/RingMarks.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/RingsNodePanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/CheckSheet.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/SelectedCheck.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/activityEvents.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/cerberusStatus.ts

## MAN-7869 — Cerberus — the six `animate-cerberus-*` motions in `tailwind.config.js` and who draws each

The tab's six motions, named in `tailwind.config.js` (`keyframes` + `animation`) and spelled `motion-safe:animate-cerberus-<name>`: a reader who asked for less motion gets none. Colour in them is `--warn-dot` through `color-mix` and nothing else; every other motion moves or fades an element that keeps its own ink. Verve's own keyframes (`vv-pagein`, `vv-pop`, `vv-ring`, `vv-toast-out`) are in `tokens.css`. Row map: MAN-7868.

| name | motion | drawn by |
|---|---|---|
| `cerberus-ring-warn` | halo of the warn dot, `box-shadow` 0 → 8px as it fades; 1.8 s ease-out, infinite | a mark that needs you: `StatusGlyph` while `failing` (not `still`), the rings' node dot while `failing` and not selected, the newest cell of a service row while `failing` |
| `cerberus-breathe` | opacity 1 ↔ .5; 2.6 s ease-in-out, infinite | `Heartbeat` (`NodeCard.tsx`) while the warden is reporting and not restarting; the clock pill's dot while live (`CerberusHeader.tsx`); the newest cell of a service row that is not failing |
| `cerberus-travel` | a beat from the node's end of a spoke to the hub (`left: 100%` → `0`), in over the first 12%, out over the last 15%; 3.2 s linear, infinite | `FleetRings.tsx`, on a live spoke (MAN-7886) |
| `cerberus-check` | a ✓ grows .4 → 1 as it fades in; .6 s `--ease-spring`, both | `NeedsYouCard.tsx`'s quiet ✓ (100 ms delay), a landed step in `EnrollInstall.tsx`, the hello mark in `EnrollDialog.tsx` (as an arbitrary `animate-[…]` beside `vv-ring`) |
| `cerberus-line` | a rise from 5px below; .35 s `--ease-enter`, both | `history/LookupCard.tsx`: each answer of the look-up as it arrives |
| `cerberus-caret` | on 0–49%, off 50–100%, no tween; 1 s `steps(1)`, infinite | no consumer yet |

governs: /home/lyphe/.claude/claudecodeui_lyphe/tailwind.config.js

## MAN-7870 — The Cerberus screen's words — the cerberus block of en/common.json

Every word the Cerberus screen draws, in the top-level `cerberus` block of `src/modules/i18n/locales/en/common.json`, between `notes` and `applications`, plus `tabs.cerberus` (`Cerberus`, after `tabs.notes`). Wire shapes: MAN-7807; the REST surface the screen reads: MAN-7802; the module: MAN-7815. Sibling words row: MAN-7634.

## Shape

- 261 leaves under `cerberus.*`, `en` only. The other ten locales hold no `cerberus` block and no `tabs.cerberus`: `fallbackLng: 'en'` (`src/modules/i18n/config.ts`) reads the English.
- Read by the files under `src/modules/cerberus` (MAN-7871).
- Nested multi-line objects, the file's own 2-space indentation.

| group | keys | holds |
|---|---|---|
| `loading` | 1 | the spinner label |
| `header` | 16 | `eyebrow`, `headline.*` (10), `summary.*` (6: `of_*`, `muted`, `nodes_*`, `lastResult`), `live`, `reconnecting`, `enroll` |
| `status` | 8 | one word per status value |
| `fleet` | 46 | `tabs`, `layouts`, `filters`, `searchPlaceholder`, `expandAll`, `collapseAll`, `bar`, `nodes_*`, `showing`, `showMore`, `noMatch`, `noneInGroup`, `legend`, `rings` |
| `needs` | 14 | the Needs-you panel and its muted list |
| `node` | 19 | a node card: warden line, empty and waiting states (a card's title, a list band's lead), squares |
| `service` | 11 | a service row's pill and cell tip |
| `activity` | 17 | the What-happened feed |
| `sheet` | 24 | the check sheet |
| `lookup` | 13 | the moment lookup's answers |
| `history` | 27 | the History tab: the look-up card's fields, prompts and headings, the events card's states (MAN-7877) |
| `mute` | 17 | the mute dialog and its toast |
| `enroll` | 31 | the three-step enroll flow |
| `time` | 13 | spans and relative times |
| `errors` | 4 | `unreachable`, `retry`, `lastAnswer` (the banner's second line over a kept answer), `writeFailed` (the warn toast's title for a refused mute, lift or label write, and the Enroll dialog's banner title for a refused ask) |

## Rules

- `status.*` is keyed by the status value itself (`ok warn failing denied not_enabled unknown muted paused`): `` t(`cerberus.status.${status}`) `` needs no map. Every legend or cell that names a status reads it; only a different word has its own key.
- `{{word}}` is the lowercased status word, passed by the caller: `lookup.was`, `lookup.wasNoValue`, `service.oneBad`, `node.bad`, `activity.check.other`.
- A reason, a check label and a node description are data, never keys. The server stores "No reason given" itself (`NO_REASON_GIVEN`, `server/modules/cerberus/mutes.service.ts`), so the mute dialog has no key for it.
- Glyphs `✓ ▲ ✕ — ·` stay in code. The two keys with a glyph inside: `enroll.copied` (`✓ Copied`) and `needs.word` (`· {{word}}`). `needs.quiet` carries no `✓`: the badge draws it.
- A two-part headline is two keys, the second drawn in the accent by code: `header.headline.quiet` + `quietAccent`, `needs_*` + `needsAccent_*`, `enroll.title` + `titleAccent`, `enroll.helloLead` + `helloAccent`.
- `enroll.notListening` is `CERBERUS_NOT_LISTENING` said in words, drawn by `EnrollRefusal` (MAN-7884) both after a 409 and up front while the overview says the gateway is not listening.
- `enroll.desc` is one key, `What it is (optional)`: the prototype draws `optional` in its Field's `meta` slot, which the house `Field` (`src/shared/ui/Field.tsx`) does not have.
- Apostrophes in keys are straight (`'`); `fleet.noMatch` quotes with `“ ”`.
- `activity.expired` is the summary line under the `activity.lifted` title; never drawn alone.
- `activity.muted` (`until {{time}}`) and `activity.mutedTomorrow` (`until {{time}} tomorrow`): `mutedTomorrow` when the lift falls on a later local day than the mute (MAN-7872).
- `activity.source.check` and `activity.source.mute` have no reader: the pill is the service's label. Only `activity.source.node` is read.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json

## MAN-7871 — Cerberus — the client: `CerberusProvider`, `useCerberusNeeds`, `useCheckDetail`, `api.cerberus`, `cerberusTime`

The browser's one reader of Cerberus: a provider holds the overview for every reader, a hook reads one check. Wire shapes: MAN-7807. Routes read: MAN-7802. Words: MAN-7870. The provider this follows: MAN-7521.

## Files
| file | holds |
|---|---|
| `src/modules/cerberus/index.ts` | barrel: `CerberusProvider`, `useCerberusNeeds`, `CerberusPanel` (lazy) |
| `src/modules/cerberus/context/CerberusContext.ts` | `CerberusContext` (default `null`), type `CerberusValue`, hooks `useCerberus`, `useCerberusNeeds`; no component |
| `src/modules/cerberus/context/CerberusProvider.tsx` | `CerberusProvider` only |
| `src/modules/cerberus/hooks/useCheckDetail.ts` | `useCheckDetail` |
| `src/modules/cerberus/utils/cerberusTime.ts` | `hm`, `hms`, `dateOf`, `dayAndTime`, `momentOf`, `stampOf`, `agoParts`, `stretchKey`, `sameLocalDay`, `isWholeTime`, `isWholeDate` |
| `src/modules/cerberus/fleet/fleetModel.ts`, `utils/activityEvents.ts` | the Fleet's pure model and the activity→Timeline mapping: MAN-7872 |
| `src/modules/cerberus/fleet/*.tsx`, `utils/fleetWords.ts` | the Fleet view: MAN-7880, MAN-7879 |
| `src/modules/cerberus/modals/*.tsx`, `hooks/useEnrollmentStatus.ts`, `utils/enrollAsk.ts` | the Mute and Enroll dialogs: MAN-7884 |
| `src/shared/api.ts` | `api.cerberus` (ten verbs), `refusalSentence` |
| `src/shared/types.ts` | `CerberusMuteInput`, `CerberusLabelInput`, `CerberusEnrollInput` (client-only: the routes read a loose JSON body); the dialogs' `CerberusEnrollRefusal`: MAN-7884 |

## Mount and barrel
- `src/App.tsx`: `<CerberusProvider>` directly inside `<HealProvider>`, wrapping `<Router>`; inside the auth gate, below `WebSocketProvider`. why: `api.cerberus` is authenticated; `cerberus_changed` arrives on the one socket; above the Router a count pill is honest on every tab.
- The barrel exports `CerberusPanel` too, as `lazy(() => import(...))`: the panel is the tab's whole tree, its own chunk, loaded on the tab's first open (`WorkspaceMain` renders it inside its `Suspense`). Nothing else. Module files import siblings by path, never through the barrel.
- `useCerberus()` throws outside the provider (`useCerberus must be used within a CerberusProvider`).
- `useCerberusNeeds()` = `overview?.counts.needsYou ?? 0`. Read by `useWorkspaceTabGates` for the Cerberus tab's count pill, so the strip and the tab's headline are the same number.

## `CerberusValue`
| member | meaning |
|---|---|
| `overview: CerberusOverview \| null` | last good read; `null` = no read has answered |
| `unreachable: boolean` | true only while `overview` is `null` and the last read failed; the next good apply clears it |
| `stale: boolean` | true once a read fails while the held overview was answered over 90 s before (`STALE_AFTER_MS` = three clock reads); the next good apply clears it. Never true while `overview` is `null` |
| `refresh(): Promise<void>` | one read; the Try again press; never rejects |
| `mute(input)`, `liftMute(id)`, `setLabel(input)` | `Promise<boolean>`: `true` = landed and the overview already re-read; `false` = refused or no answer, the warn toast already raised |

- The four verbs keep one identity for the app's life; the translator is read through `tRef` (`useLayoutEffect`), never in a verb's deps.
- A failed read over a held overview keeps it and raises no toast: `unreachable` never rises over one. `stale` rises when that failure finds the overview answered over 90 s before, and the root then draws its "last answer" banner and the header's pill stops saying Live (MAN-7891). It is judged at each failed read, never on a timer, so one dropped poll never flaps it. Every read carries a 30 s deadline of its own (`REQUEST_TIMEOUT_MS` as an `AbortController` timer in `refresh`, passed to `api.cerberus.overview({ signal })`, so a platform without `AbortSignal.timeout` is covered), so a read left hanging fails and is judged rather than keeping the picture fresh.

## Reads
| trigger | rule |
|---|---|
| mount | one read, after the subscription |
| `cerberus_changed` | at most one read per 1 s (`FRAME_READ_GAP_MS`); frames inside the gap queue ONE trailing read |
| `websocket_reconnected` | read at once, unthrottled |
| clock | every 30 s (`CLOCK_READ_MS`): cells slide, "ago" ages, a check goes stale with no row written |
| own landed write | the re-read, before the verb answers |

- A read is good when `response.ok` and the body has a `nodes` array and a `counts` object. Anything else, or a throw, keeps the overview.
- Each read takes a ticket (`newestReadRef`); a good answer older than the newest applied (`newestAnswerRef`) is dropped. A failed read judges before the mark and never moves it, so an older good read still in flight can land.

## Writes
- One in flight per target: `mute:<node>/<key>`, `lift:<id>`, `label:<node>/<key or service>`. A second press returns the first's promise.
- Verdict is `response.ok` alone; the body is not read. The screen comes from the re-read.
- Refused or no answer: one `warn` toast, title `cerberus.errors.writeFailed`, message = `refusalSentence(response)` (the server's own sentence), omitted when none. Not raised after unmount.
- Only the mute speaks on success: `positive` toast, `cerberus.mute.toast.title` (`time` = `hm(until)`), `cerberus.mute.toast.message` (`label` = the check's plain name, else its key). A lift and a label are silent.

## `useCheckDetail({ node, service, id, lookupAt?, end? })`
Answers `{ detail, loading, error, refresh }` from `GET /api/cerberus/checks/:node/:service/:id?lookup&end` (MAN-7802).

| field | meaning |
|---|---|
| `detail` | `null` until a read for THIS check answered; an answer for another check is never shown |
| `loading` | `detail === null` and no `error` |
| `error` | `'gone'` (404: retired while open) or `'unreachable'` (network, 5xx, a body that is not a check detail); `null` otherwise |
| `refresh()` | one read |

- Re-reads: a `cerberus_changed` whose `checks` includes `<node>/<service>/<id>` (compared whole, never split), `websocket_reconnected`, every 30 s.
- A change of `lookupAt`, `end` or the check is a new read; the previous answer of the same check stays on screen until it lands.
- Only the newest read's outcome is published. A failure keeps the last good `detail` of the same check beside `error`.
- `end` is where the 60 cells and `recent` stand; the server's rule is MAN-7802. History passes `end` = `lookupAt` = the moment looked up, so its cells are the 60 minutes up to it and its recorded results the newest 100 of the 3 h of rows before it (MAN-7877). The sheet passes `lookupAt` only: its strip stays on now (MAN-7878). why: the sentence and the cells must describe one moment.
- `lookupAt` and `end` are epoch ms, both default to now; the server takes `lookup` as `end` when absent.
- A blank `node` is "no check chosen" (History's picker before its index answers): nothing is asked, `detail` stays `null` and `loading` is false.
- A caller holds `lookupAt` / `end` in state. `Date.now()` passed from render re-reads on every render.

## `api.cerberus` — `src/shared/api.ts`
| verb | request |
|---|---|
| `overview({ signal? })` | `GET /api/cerberus/overview`; a `signal` handed in replaces the api layer's `REQUEST_TIMEOUT_MS` one: the provider brings its own deadline |
| `checks()` | `GET /api/cerberus/checks` |
| `check(node, service, id, { lookup?, end? })` | `GET /api/cerberus/checks/:node/:service/:id` |
| `lookup(node, key, at)` | `GET /api/cerberus/lookup` |
| `activity({ before?, limit? })` | `GET /api/cerberus/activity`; `before` exclusive |
| `mute(input)` | `POST /api/cerberus/mutes` |
| `liftMute(id)` | `POST /api/cerberus/mutes/:id/lift` |
| `setLabel(input)` | `PUT /api/cerberus/labels` |
| `enroll(input)` | `POST /api/cerberus/enrollments` |
| `enrollment(name)` | `GET /api/cerberus/enrollments/:name` |

- Reads answer their wire shape bare; a refusal is the app's `{ success: false, error }` envelope. Nobody draws from a write's answer.
- `refusalSentence(response)`: the server's own sentence from a refusal body (`errorMessage(error) ?? errorMessage(details)`), `null` when none or not JSON. One copy, shared by `NotesProvider` and `CerberusProvider`.

## `cerberusTime.ts`
Pure: no `t`, no `Date.now()`. Local time, 24-hour, written by hand so every browser locale reads alike.
| function | answers |
|---|---|
| `hm(ms)` | `08:05` |
| `hms(ms)` | `08:05:09` |
| `dateOf(ms)` | `2026-10-05`: the digits a date input holds |
| `dayAndTime(ms)` | `2026-10-05 08:05` |
| `momentOf(date, time)` | epoch ms of a date input's and a time input's whole values together; `null` while either is not whole or the two name no real day |
| `stampOf(ms, now)` | `17:52:10` on `now`'s local day, `2026-10-02 17:52:10` on any other: a time alone always means today. History's answer, its headings and its empty results line print through it |
| `agoParts(ms, now)` | `'now'` (under 2 s, or a moment after `now`) or `{ n, unit: 's' \| 'min' \| 'h' \| 'd' }`, rounded down; the screen says it with `cerberus.time.*Ago` |
| `stretchKey(seconds)` | `{ key, count }` in the largest exact unit (`cerberus.time.seconds` / `minutes` / `hours`); the screen says it with `t(key, { count })`: "every 30 s", "older than 90 s" |
| `sameLocalDay(a, b)` | true when two moments share a local calendar day: a time alone (`hm`/`hms`) for today, `dayAndTime` otherwise |
| `isWholeTime(text)`, `isWholeDate(text)` | a time input's `HH:MM[:SS]`, a date input's `YYYY-MM-DD`; a half-typed or cleared field holds `""`, and a lookup waits for whole ones |

`stretchKey` hands back a key, not a word, as the status table hands back `wordKey`: the words stay in `en/common.json`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/App.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/context/CerberusContext.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/context/CerberusProvider.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useCheckDetail.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/cerberusTime.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## MAN-7872 — Cerberus — the fleet's pure model: `fleetModel`, `toTimelineEvent`, the `Fleet*` and `Rings*` types

The Cerberus tab's pure half: the overview as sorted fleet items, filter counts, search, default expansion, rings geometry, and one mapping from a "What happened" line to a Timeline row. No React, no clock, no DOM. Client reader: MAN-7871. Wire shapes: MAN-7807. Words: MAN-7870.

## Files
| file | holds |
|---|---|
| `src/modules/cerberus/fleet/fleetModel.ts` | `fleetItems`, `groupOf`, `filterGroups`, `applyFilter`, `defaultExpanded`, `ringsLayout` |
| `src/modules/cerberus/utils/activityEvents.ts` | `toTimelineEvent(activity, t, now)` |
| `src/shared/types.ts` § CERBERUS FLEET MODEL | `FleetStatus`, `FleetGroup`, `FleetFilter`, `FleetFilterGroup`, `FleetService`, `FleetItem`, `RingSpokeKind`, `RingsNode`, `RingsLayout`, `FleetLayout`, `FleetEntry` (client-only; the Fleet views read them: MAN-7880) |
| `src/modules/cerberus/utils/cerberusStatus.ts` | `STATUS_TABLE`: the one owner of a status's tone, glyph, word key and cell shape; `activityEvents.ts` and the marks read it: MAN-7873 |

## Functions — `fleetModel.ts`
| function | answers |
|---|---|
| `fleetItems(overview)` | one `FleetItem` per node, worst first: `STATUS_RANK`, then the hub ahead of its peers, then id with numeric collation (`node-2` before `node-10`) |
| `groupOf(status)` | the `FleetGroup` bucket |
| `filterGroups(items)` | all six `FleetFilterGroup`s in order `all needs unknown muted updating empty`, zero counts included; counted over the WHOLE fleet; hiding an empty group is the toolbar's call |
| `applyFilter(items, group, query)` | items in one filter, narrowed by `query` (trimmed, case aside, substring of `item.search`); blank query narrows nothing; keeps the caller's order, so pass `fleetItems` output |
| `defaultExpanded(items)` | `Set<string>` of ids in group `needs`; empty when the fleet has more than 12 nodes; pass the WHOLE fleet, never a filtered list |
| `ringsLayout(items, width, height)` | `RingsLayout` in pixels from the box's top-left |

## Node status rules
- `STATUS_RANK` (smaller = worse): `failing`/`denied` 0, `fixing` 1, `warn` 2, `unknown` 3, `paused`/`enrolling` 4, `muted` 5, `ok` 6, `empty` 7.
- A node's status = the worst of its services'; no service = `empty`.
- A `not_enabled` service counts as `ok` at the node level; its own row still says what it is.
- `denied` outranks `failing` when a node has both.
- `fixing` and `enrolling` are in the type and the rank; nothing produces them yet.
- `groupOf`: `failing denied fixing warn` → `needs`; `paused enrolling` → `updating`; every other status is its own group. `ok` is counted by the status bar; no filter button selects it.
- `FleetItem` carries `id desc role link status services search` only. Minute cells, warden version and last-heard time stay on `CerberusNodeView`, found by `id`.
- `item.search` = lower-cased `id`, `desc`, each service's id and label, joined by single spaces; null and empty words are dropped, so `center cerberus` matches.

## `ringsLayout`
- Returns `{ center, hub, guides, nodes, total }`. Each `RingsNode` carries `item ring x y angleDeg length dot spoke live labelled`. Selection is the view's state, not in it.
- `hub` is the item with `role === 'hub'`, at `center`, only when it is in the list: a caller that filters keeps it in. Every other item is sorted worst first and placed.
- Rings are circles of the box's shorter side; a wide box leaves margin. 1 to 7 rings open as the fleet needs; the worst sit on ring 0.
- `nodes.length < total`: the rest do not fit; they are in Grid.
- A box of 0×0 or non-finite size places nothing and does not throw.
- `spoke`: `dashed` for `unknown` and `enrolling`; `amber` for rank ≤ `warn`; `plain` otherwise. `live` = `link === 'reporting'`.
- A loud node (rank ≤ `unknown`) is never drawn under 9 px. `labelled` = ring 0 with 12 nodes or fewer on it, or a loud node at dot ≥ 9.
- Dot diameter by `total`: ≤24 → 18, ≤80 → 13, ≤260 → 9, else 6; scaled by `side / 470`, floor 0.7, minimum 5.

## `toTimelineEvent(activity, t, now)`
Maps one `CerberusActivity` to a kit `TimelineEvent`. Callers: the Fleet's What-happened card (overview's newest seven), History's feed (`GET /api/cerberus/activity` pages).

| kind | tone | source (pill) | title key | summary |
|---|---|---|---|---|
| `check` | `STATUS_TABLE[to].tone` | `serviceLabel`, else the service of the check key | `activity.check.ok warn failing unknown`; any other `to` = `activity.check.other` with `word` lowercased | `value` when the check reported one |
| `mute`, `event: 'muted'` | `neutral` | as `check` | `activity.muted`; `activity.mutedTomorrow` when the lift is on a later local day than the mute | `reason` |
| `mute`, lifted or expired | `neutral` | as `check` | `activity.lifted` | `activity.expired` for `expired`, none for an early lift |
| `node` | `positive` | `activity.source.node` | `activity.enrolled` | `activity.enrolledSummary` when `wardenVersion` is set |
| any kind this bundle does not know | `neutral` | the kind | the kind | none; never thrown on |

- `when` = `hms(at)` when `at` is on `now`'s own local day, else `dayAndTime(at)`. why: a bare `17:52:10` under History's "Everything since…" reads as today. `now` is the caller's, so a row never changes between two renders of one overview.
- `mutedTomorrow` rests on the 24 h mute cap: a different local day is always the next. If the server allows longer mutes, `mutedTitle` must name the date.
- `meta` = `activity.meta` (`service` = check key, `node`); for a `check` it is followed by ` · <from word> → <to word>`. Status words come from `STATUS_TABLE[status].wordKey`.
- A label, reason, node name and value go in as variables, never as keys.
- New `CerberusActivity` kinds (`fix catalog diagnosis warden`) add a case to the switch, a builder, and words under `cerberus.activity`.

## Callers must
- Guard `overview.lastResultAt` for null before `agoParts` (it takes a number).
- Map `agoParts`' unit to a `cerberus.time.*Ago` key; there is no shared "12 s ago" helper yet.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/fleetModel.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/activityEvents.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## MAN-7873 — Cerberus — the tab's status marks and the check sheet's pieces: `STATUS_TABLE`, `StatusGlyph` `StatusCell` `StatusSquare` `StatusPill`, `MinuteCells`, `LookupMoment`, `RecordedResults`

The Cerberus tab's drawing vocabulary and the check sheet's three pieces. Pure of data: each takes its read model from the caller. Spec: `design/cerberus/Cerberus Spec.dc.html`, Table 1. Client reader: MAN-7871. Pure fleet model: MAN-7872. Words: MAN-7870. Wire shapes: MAN-7807. Colour rules: MAN-739 (rules 3–5), MAN-578.

## Files
| file | holds |
|---|---|
| `src/modules/cerberus/utils/cerberusStatus.ts` | `STATUS_TABLE`; `nodeMark(status)`, the status a node's word draws its marks with (`null` for `empty`, `fixing`, `enrolling`), read by the node card and the rings |
| `src/modules/cerberus/StatusMarks.tsx` | `StatusGlyph`, `StatusCell`, `StatusSquare`, `StatusPill` |
| `src/modules/cerberus/sheet/MinuteCells.tsx` | `MinuteCells` |
| `src/modules/cerberus/sheet/LookupMoment.tsx` | `LookupMoment`, `LookupSentence`, `SentenceRow` |
| `src/modules/cerberus/sheet/RecordedResults.tsx` | `RecordedResults` |
| `src/shared/types.ts` § CERBERUS STATUS VOCABULARY | `CerberusCellShape` |

No file outside the module imports the marks or the sheet pieces. Inside it, `sheet/CheckSheet.tsx` composes `MinuteCells`, `LookupMoment` and `RecordedResults` (MAN-7878) and `history/LookupCard.tsx` composes `LookupSentence`, `SentenceRow`, `MinuteCells` and `RecordedResults` (MAN-7877).

## `STATUS_TABLE` — the one owner
`Record<CerberusStatus, { tone, glyph, wordKey, cell }>`. Nothing else in the tab decides a status's tone, glyph or shape; a view reads it here. `activityEvents.ts` reads it too (MAN-7872).

| status | tone | glyph | cell |
|---|---|---|---|
| `ok` | positive | ✓ | `soft` |
| `warn` | warn | ▲ | `outline` |
| `failing` | warn | ▲ | `solid` |
| `denied` | danger | ✕ | `solid` |
| `not_enabled` | neutral | · | `flat` |
| `unknown` | neutral | — | `dashed` |
| `muted` | neutral | — | `surface` |
| `paused` | neutral | — | `dashed` |

- `wordKey` = `cerberus.status.<status>` (MAN-7870).
- `denied` is the only red; a sixth tone for it is refused (MAN-739 rule 4).
- `unknown` and `paused` draw the same cell: no reading either way; only the word says why.
- `not_enabled` never needs you.

## `CerberusCellShape` — paint in `StatusMarks.tsx` `CELL_PAINT`
| shape | paint | reads as |
|---|---|---|
| `soft` | `bg-tone-soft`, no edge | passing; recedes: 60 washed minutes are one calm band |
| `outline` | wash inside the tone's edge | close to the limit |
| `solid` | tone dot fill | failing, refused |
| `flat` | `bg-tone-dot/35`, no edge | not enabled |
| `dashed` | dashed edge, no fill | no reading |
| `surface` | `bg-muted` inside `border-input` | muted |

- `soft` keeps no tone-coloured edge. why: measured; an edge made a passing square read as an outlined "close to the limit" square in green, and the strip as 60 boxes.
- `flat` steps from `soft` by lightness, not hue. why: at the neutral dot's 20% the two measured 1.07:1 light, 1.10:1 dark; at 35%, rendered, 1.26:1 and 1.42:1.
- Tone reaches paint only as `data-tone` plus a `tone-*` Tailwind name. No hex, `rgba(` or `var(--` in the marks.
- Colour never animates between statuses (MAN-739 rule 5). The only motion: the failing glyph's `animate-cerberus-ring-warn`, under `motion-safe`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/index.css, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/LookupMoment.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/MinuteCells.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/RecordedResults.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/StatusMarks.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/cerberusStatus.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## MAN-7874 — Cerberus — the tab's status marks and the check sheet's pieces: `STATUS_TABLE` — Marks — `StatusMarks.tsx`

| mark | props | draws |
|---|---|---|
| `StatusGlyph` | `status`, `size` `sm`\|`md`\|`lg` (20, 24, 32 px; default `md`), `decorative`, `still` | round glyph in the tone's ink on its wash |
| `StatusCell` | `status`, `label`, any span attribute | one minute; the caller gives size, flow and role |
| `StatusSquare` | `status`, `label` | 10 px square in the cell's shape, with `title` |
| `StatusPill` | `status`, `text` | `Badge` (`tone`) holding glyph then word or `text`; `text` is cut with an ellipsis |

- `StatusGlyph` names its word as `role="img"` + `aria-label` + `title`; `decorative` replaces that with `aria-hidden` (the word is written beside it).
- `StatusGlyph` rings only for `failing` and not `still`. A lookup's glyph is `still`: the ring means needs you NOW, and a looked-up moment may be long past.
- `·` is drawn at 1.8em inside the glyph; the glyph still comes from the table.
- `StatusCell` and `StatusSquare` default `label` to the bare word; a caller passes the sentence (`Shadow connector · All 4 checks passing`).
- `StatusPill` is the library's `Badge`: every tone pill in the app shares one paint.

## `MinuteCells({ cells, selectedFrom?, onPick })`
`cells: CerberusCell[]`, oldest left; draws any count; renders `null` for none. Axis under it: `hm` of the first, middle (`floor(count / 2)`) and last cell's `from`. Holds no data and no marker: `onPick(cell)` is the caller's.
- One tab stop: `role="listbox"`, each minute a `role="option"` (`aria-selected` = `selectedFrom` match), `aria-label` = `cerberus.sheet.cells`.
- Keys: `ArrowLeft`/`ArrowRight` ±1, `PageUp`/`PageDown` ±10, `Home`/`End`, `Enter` or Space picks. A key starts from the minute it is on, else the `selectedFrom` one, else the newest.
- Pointer: the minute is found from the pointer's x, so a press in the 2 px gap lands on the nearer cell, and a phone's 4 px cells stay tappable. A click with `detail` 0 (assistive tech) picks the keyboard's minute.
- Tooltip (`vv-tooltip`): `cerberus.sheet.cellTip` (`time` `word`); a folded minute (`cell.worst` not null) adds the check key on its own mono line, and its accessible name uses `cerberus.sheet.cellTipWorst`.
- Tooltip placement is written to the nodes in `useLayoutEffect`, not state: centred on the minute and held inside the strip, with its pointer on the minute's centre; above the strip, or `data-side="below"` when the nearest clipping ancestor leaves no room.
- `selectedFrom` marks its minute with an accent outline; the minute under the pointer scales on y.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/index.css, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/LookupMoment.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/MinuteCells.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/RecordedResults.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/StatusMarks.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/cerberusStatus.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## MAN-7875 — Cerberus — the tab's status marks and the check sheet's pieces: `STATUS_TABLE` — `LookupMoment({ time, onTimeChange, lookup, check })`, `LookupSentence({ lookup, check, size?, now?

## `LookupMoment({ time, onTimeChange, lookup, check })`, `LookupSentence({ lookup, check, size?, now? })`, `SentenceRow`
- `check` = `Pick<CerberusCheckView, 'at' | 'origin' | 'staleAfter'>`: the lookup alone cannot give "older than 90 s", "by Cerberus on this server" or "The latest is 17:52:00". Callers pass `detail.check`.
- `LookupMoment`: `Input type="time" step={1}` (`time` is its `HH:MM:SS`), then the sentence; a value `isWholeTime` refuses (`cerberusTime.ts`, MAN-7871: not `HH:MM` or `HH:MM:SS`) shows `cerberus.lookup.typeATime`. Turning `time` into a moment and reading the lookup is the caller's.
- `size`: `md` (default) is the sheet's line, `text-sm` beside the `md` glyph; `lg` is History's headline answer, the serif display face at 21 px beside the `lg` glyph. why: in History the answer is what the card is for.
- `now`: given, every time the sentence prints (`lookup.at`, `resultAt`, `check.at`) goes through `stampOf(ms, now)` (MAN-7871), so a moment on another local day carries its date ("At 2026-10-02 17:52:10 it was …") and a time alone always means today. History passes it; the sheet looks up today only and passes none. why: History keeps an answer on screen while it reads another date, and that answer must not pass for the new date's.
- `SentenceRow({ status, sentence, meta, size? })`: the glyph-then-sentence row every answer draws, exported for the prompts History puts in the answer's place (pick a date, choose a check, a retired check).
- The sentence column is the stable `aria-live="polite"` region; `LookupSentence` alone is no live region, so History wraps it in one.
- `verdict` → sentence: `result` → `lookup.was` / `wasNoValue` (the value's trailing full stops dropped); `future` → `lookup.future` + `futureMeta` (`check.at`); `too_early` → `lookup.tooEarly`; `stale` → `lookup.stale` (`staleAfter` through `stretchKey`, MAN-7871: the largest exact unit).
- Glyph status: only `result` has its own; the other three show `unknown`, under `lookup.unknownMeta` ("not the same as passing").
- Meta (`result` only, when `resultAt` is set): `lookup.meta`/`metaMuted` from a warden, `metaHub`/`metaHubMuted` when `check.origin === 'self'`; `Muted` forms when `lookup.mute` covered the moment.

## `RecordedResults({ rows, emptyText? })`
- `rows: CerberusResultRow[]`, the read's `recent`; sorted newest first inside, whatever order it arrives in.
- Row: `hms` time column, `StatusPill` (a null `status` draws `not_enabled`), then `value` when not null.
- 12 rows (`FIRST_ROWS`), then a ghost button `cerberus.sheet.moreResults` (`count` = hidden); one press shows all.
- No rows: `emptyText`, else `cerberus.sheet.noChanges` ("the last 3 h", true of the sheet's window ending now). History passes `cerberus.history.noChanges`, which names the moment its window ends at.
- Section headings belong to the sheet and History, not these pieces.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/index.css, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/LookupMoment.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/MinuteCells.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/RecordedResults.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/StatusMarks.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/cerberusStatus.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## MAN-7876 — Cerberus — the tab's status marks and the check sheet's pieces: `STATUS_TABLE` — rules and traps

What the pieces can rely on in the data they are handed:
- Checks sit in key order in every service, as the store hands them out; code picking one finds it by key, never by position.

## Rules
- A new status or cell shape: one edit in `STATUS_TABLE` and `CELL_PAINT`; never a second table in a view.
- Dark mode sets `color-scheme: dark` on `input[type="date"]` and `[type="time"]` in `src/index.css` (the rule beside checkbox and radio). Without it the picker glyph is dark on a dark field; History's date field shares it.

## Traps
| trap | do |
|---|---|
| the time field shows `05:52:10 PM` on an en-US browser, beside the tab's 24-hour sentences; neither `lang` nor the page locale changes it | known; an always-24-hour field needs a custom text field |
| a `.tsx` file created under `src/` after the dev client starts has no Tailwind classes | `touch src/index.css` once: INV-6586 |

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/index.css, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/LookupMoment.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/MinuteCells.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/RecordedResults.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/StatusMarks.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/cerberusStatus.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## MAN-7877 — Cerberus — the History view: `HistoryView`, `LookupCard`, `EventsCard`, `UnreachableBanner`

The Cerberus tab's History view, filled and live: `HistoryView` reads the check index and the chosen check and holds the look-up's fields; `useActivityFeed` reads the feed. The cards draw what they are handed and read nothing. Time words: MAN-7871. Pieces it composes: MAN-7873 (`LookupSentence`, `SentenceRow`, `MinuteCells`, `RecordedResults`). Feed mapping: MAN-7872. Words: MAN-7870 (`cerberus.history.*`, `cerberus.errors.*`). `CerberusPanel` (MAN-7891) mounts it as the History view, only while that view shows. The workspace mounts the panel as the Cerberus tab.

## Files
| file | holds |
|---|---|
| `src/modules/cerberus/history/HistoryView.tsx` | the container: the index read, the look-up's fields, the chosen check's read, the presses |
| `src/modules/cerberus/hooks/useActivityFeed.ts` | the feed: newest page, earlier pages, the re-read on a frame, the open row |
| `src/modules/cerberus/history/LookupCard.tsx` | "Look up a check": fields, raw line, answer, hour strip, recorded results |
| `src/modules/cerberus/history/EventsCard.tsx` | "Everything since HH:MM": the full `Timeline` and its foot |
| `src/modules/cerberus/UnreachableBanner.tsx` | `UnreachableBanner({ onRetry, detail? })` |

## `HistoryView` layout
- Two `Card`s in a `flex-wrap` row: look-up `flex-[3_1_460px]`, feed `flex-[2_1_340px]`; they stack below ~820 px (460 + 340 + gap), look-up first.
- Padding `clamp(16px, 4cqi, 32px)`: follows the panel's own width.

## What `HistoryView` holds
| piece | rule |
|---|---|
| `checks`, `checksFailed` | `api.cerberus.checks()` once on mount (the effect keyed by `indexAsks`; Try again adds one, never a poll); `checks` is `null` until it answers, `checksFailed` while the latest read did not |
| `chosen` | `<node>/<key>`, `null` at first. Set ONCE, during render, when the index has a check and the overview has answered (or failed): the check that has needed you longest (`overview.needsYou[0]`), else `checks[0]`. A later read never moves it |
| `date`, `time` | the fields' text: today and now at first; `""` while cleared or half typed |
| `moment` | the last WHOLE moment the two fields named (`momentOf`), epoch ms; while a field is not whole it stands. `lookupAt` and `end` of `useCheckDetail` are both `moment`, so the 60 cells and the recorded results follow the moment looked up |
| `opened` | `Date.now()` when the view opened; the date, time and `moment` start there, and it is `now` until the overview's first read |
| `clockLead` | how far the browser's clock runs ahead of center's, ms (0 when it does not): the index answer's `Date` header against `Date.now()` at the headers. When the index answers, an opening moment the person has not changed is held back by it, before any read is made at it, so a drifted browser never opens on "That hasn't happened yet." |
| `now` | `overview?.now ?? opened`: center's clock as the provider last read it (every frame, every 30 s), so "today" turns at midnight. One for both cards and `toTimelineEvent` |
| detail | `useCheckDetail({ node, service, id, lookupAt: moment, end: moment })` with the chosen key split at its first `/`; a blank node (nothing chosen) reads nothing |
| `onPick(cell)` | date, time and `moment` move to `min(cell.to − 1 s, Date.now() − clockLead)` floored to the second: the minute's last second, or center's now for the minute still running. The date is the cell's own, so an hour across midnight starts the day before |
| `onRetry` (look-up) | the index again while it has not answered, else the detail's `refresh()` |
| feed | `useActivityFeed()`: see below; `since` is `hm(oldest.at)` on `now`'s day, else `dayAndTime` |

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/history/EventsCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/history/HistoryView.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/history/LookupCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useActivityFeed.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/UnreachableBanner.tsx

## MAN-7878 — Cerberus — the check sheet: `CheckSheet`, `CheckRows`, `SelectedCheck`, `CheckLabelEditor`

The check sheet on the library's `Sheet`: one service's checks and one of them in full. `CheckSheet.tsx` reads the fleet from `useCerberus()` and the check from `useCheckDetail`, and wires every press: the other three files draw what they are handed and read nothing. Marks and pieces it composes: MAN-7873. Banner: MAN-7877 (`UnreachableBanner`). Time words: MAN-7871. Words: MAN-7870 (`cerberus.sheet.*`, `cerberus.errors.lastAnswer`). Design: `design/cerberus/Cerberus Tab.dc.html` :393-537, less fixes and diagnosis. `CerberusPanel` (MAN-7891) mounts it, opened from a Fleet minute, a service row or a Needs-you card.

## Files
| file | holds |
|---|---|
| `src/modules/cerberus/sheet/CheckSheet.tsx` | `CheckSheet({ open, onClose, node, service, check, lookupAt?, onMute })`: the container; `CheckSheetBody`, `SheetSection`, `ReadingPlaceholder` |
| `src/modules/cerberus/sheet/CheckRows.tsx` | `CheckRows({ checks, selectedKey, serviceName, onSelect })` |
| `src/modules/cerberus/sheet/SelectedCheck.tsx` | `SelectedCheck({ check, editor, onName, onMute, onUnmute })` |
| `src/modules/cerberus/sheet/CheckLabelEditor.tsx` | `CheckLabelEditor({ value, onSave, onCancel, busy })` |

## `CheckSheet` — layout and reads
- Props: `node` (`eis1`, or `center`), `service` (id), `check` (id within the service: the key after the first `/`), `lookupAt?` (epoch ms; omitted = now), `onMute(check)`: the root opens its Mute dialog in front of the sheet.
- Title: the service's label, else its id. Under it, top to bottom: raw line (`sheet.raw`; `sheet.rawHub` when the node's `wardenVersion` is null), `CheckRows`, `SelectedCheck`, the fixes/diagnosis `SLOT:`, then the check's own sections.
- `CheckSheetBody` holds every read; `Sheet` mounts it only while open. Keyed `<node>/<service>/<check>@<lookupAt|now>`: each opening, and a sheet sent to another check or minute, starts fresh (row, moment, editor closed).
- Two reads; the sheet never blanks while one is out:

| read | draws |
|---|---|
| the fleet (`overview`, held by the provider) | title, raw line, rows, the selected check's block: at once on open |
| the check's own (`useCheckDetail`) | `sheet.lastHour` → `MinuteCells`, `lookup.title` → `LookupMoment`, `sheet.recorded` → `RecordedResults` |

- `rows` = the fleet's copy of the service's checks (`serviceView.checks`); only when the fleet has none, the read's `check` + `siblings` sorted by key.
- `shown` (the selected check's block) = the entry of `rows` keyed `<service>/<selectedId>`, else `detail.check`. why: every write re-reads the fleet before it answers, so head and rows never disagree.

| state | draws |
|---|---|
| no answer yet (`detail` null, `error` null) | `ReadingPlaceholder`: three `vv-skeleton` sections, eyebrows drawn, `aria-busy` |
| `error === 'unreachable'` | `UnreachableBanner` over the sections; `detail` = `errors.lastAnswer` only when a last good answer stays under it; Try again = `refresh()` |
| `error === 'gone'` | dashed line `sheet.gone` in place of the sections; title, rows and head stay |
| answered | the three sections |

- Live region: one `<p role="status" class="sr-only">`, mounted with the body. Says `sheet.loading` while the read is out with no answer, `sheet.gone` when gone, else nothing. The placeholder and the visible gone line carry no role; the banner is its own alert. why: a region inserted with its text often is not announced.
- Entrance: raw line rises first (`motion-safe:animate-shape-rise`), rows at `animationDelay: '60ms'`, the check and its sections at `120ms`. The delay is inline: INV-7053.
- `SLOT:` comments (nothing drawn) in `CheckSheet` and `SelectedCheck`: MAN-7867.

## What `CheckSheet.tsx` reads, holds and writes
| piece | what it is |
|---|---|
| `overview` | `useCerberus().overview`, read in `CheckSheet`: names the service and its node before the check is read |
| `selectedId` | state: the selected check's id; `check` until a row is pressed |
| `moment` | state: the lookup's moment, epoch ms; `lookupAt` until a minute is picked or a whole time typed; `undefined` is now, a live read |
| `typedTime` | state: what a person has typed in the time input, `null` otherwise. Null, the input shows `hms(detail.lookup.at)`, the moment the sentence names, so a live sheet's input moves with its sentence at each re-read; `""` while a time is half typed. Apart from `moment`, so typing is never overwritten |
| `detail`, `error`, `refresh` | `useCheckDetail({ node, service, id: selectedId, lookupAt: moment })`; `refresh` is Try again |
| `editingId` | state: the id of the check whose label editor is open, or `null`. Name this check and ✎ open it for the shown check; Cancel, a save that lands and a press on another row close it. By id, so a write that lands late closes only the editor it was for |
| `savingId` | state: the id of the check whose `setLabel` is in flight, or `null`. The editor's `busy` is `savingId === selectedId`, so a write for one check never locks another's editor |
| `liftMute`, `setLabel` | `useCerberus()`; each raises its own toast when the write does not land |
| `onSelect` | `setSelectedId(entry.id)` and `editingId` clears; the lookup keeps its moment |
| `onSave` | `setLabel({ node, key: shown.key, label })`; `''` clears the name. The editor closes when the write lands, if it is still on that check, and stays open, Save ready again, when it does not (the provider's toast says why) |
| `onMute` | the root's `onMute(shown)` |
| `onUnmute` | `liftMute(shown.mute.id)`; the note leaves when the fleet reads the lift |
| `onPick` | the lookup to the pressed minute's last second (`cell.to - 1000`), or back to live for the newest cell, which is the minute still running (the read sends no `end`). Judged by place on the strip, never by the browser's clock; `typedTime` clears and the input follows the read |
| `onTimeChange` | holds the text; a whole time (`isWholeTime`) moves the lookup to that second today, local (`todayAt`) |

## `CheckRows`
- `ul` with `aria-label` `sheet.checksOf` (`service` = the title); one `button` per check: `StatusGlyph`, label over `check.id` (the id alone, mono, with no label), then `value`.
- The shown row is marked three ways (MAN-578): `bg-background`, a 3 px accent rule on its left edge, `aria-current`.
- Accessible name reads the status word first (the glyph names it). The glyph rings while failing.
- `value`: right-aligned, up to 45% of the row from `sm`; under the label on a phone.
- A row leans 3 px right under the pointer, `motion-safe`; its ground changes at once (MAN-739 rule 5). The focus ring is drawn inside the row (`outline-offset:-2px`): the box clips anything outside.
- `selectedKey` is `<service>/<id>`; `onSelect` hands the pressed `CerberusCheckView`.

## `SelectedCheck`
- Head, in wrap order: name (`h3`: the label in the serif face, else the key in mono), `StatusPill`, then the naming action. The action wraps first on a phone, never the status.
- Naming action: ghost `sheet.nameThis` + pencil for a check with no label; a ghost icon button (✎, `sheet.rename`) beside a label. It is hidden while the editor is open.
- `editor` (an element or `null`) takes the name's place while open; the status pill stays.
- Then `check.value`; "Checked `hms(at)` · every `stretchKey(every)` · by …" (`sheet.checked`; `sheet.checkedHub` when `origin === 'self'`; `sheet.notChecked` / `notCheckedHub` while `at` is null); then the raw key, when the check has a label or the editor is open.
- Action row: `SLOT:`, then `sheet.mute` (ghost) while `check.mute` is null, else a neutral `Badge` holding `sheet.muteNote` (`hm(mute.until)`, `reason`) in full, wrapping, and `sheet.unmute`.
- Focus: when the editor closes and focus fell to the page, it returns to the naming button.

## `CheckLabelEditor`
- A `form`: `Input` (`aria-label` `sheet.nameThis`; opens with the name selected whole), Save (submit), Cancel. Mounted only while open; the draft is state seeded from `value`.
- Enter or Save hands on the trimmed draft. Save is off, and Enter writes nothing, while the trimmed draft equals the trimmed `value`.
- An emptied name that differs from `value` shows `sheet.clearsName` (`aria-describedby`); saving `''` clears the name and the key shows again.
- No length cap in the field. why: the server keeps the one rule (200 characters); its refusal reaches the person through the write's toast.
- `busy`: field `readOnly` + `aria-busy`, Save and Cancel disabled.
- Escape: the `form` carries `OWNS_ESCAPE` (`src/shared/ui/overlayEscape.ts`), so `Sheet` stands down: the first Escape cancels the edit, the next closes the sheet. The key is heard on `useHostWindow().document`, not the field, so it holds with focus on a row or the strip; an Escape ending an IME composition is ignored.
- While `busy` the claim and the listener are both dropped: Escape then closes the sheet, and the write lands or toasts either way.

## Rules
- Small text in the sheet takes `text-muted-foreground`: 5.06:1 light, 7.34:1 dark on the panel. `text-ink-faint` measures 3.34:1 light and fails AA.
- A fixture mounts the sheet inside the app's own provider chain (`I18nextProvider`, `ThemeProvider`, `ToastProvider` with its `ToastStack`, `UiPreferencesProvider`, `AuthProvider`, `WebSocketProvider`, then `CerberusProvider`) against the live center. Its host takes `display:contents`: a host with its own stacking context traps the toast stack (z 10001) under the sheet (z-50).

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/CheckLabelEditor.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/CheckRows.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/CheckSheet.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/SelectedCheck.tsx

## MAN-7879 — Cerberus — the Fleet view's sentences and cards: `fleetWords`, `NeedsYouCard`, `FleetStatusBar`, `FleetLegend`, `FleetToolbar`

The Fleet view's wording and its three top cards. Pure model: MAN-7872. Marks: MAN-7873. Words: MAN-7870. The view's container, node cards, service rows and rings: MAN-7880.

## `fleetWords.ts` — the sentences
Takes `t` and `now` from the caller, so a sentence is a function of what it is handed; a label, node name and version go in as variables, never as keys (MAN-7870). Read by `NodeCard`, `ServiceRow` and the rings' panel. Its `agoPhrase(t, ms, now)` ("12 s ago", "just now") is exported for the tab's header too (`CerberusHeader`, the last result's age).

| function | case | sentence |
|---|---|---|
| `serviceSentence(t, service)` | one check needs you | `service.oneBad` |
| | several | `service.needYou_*` |
| | `unknown`, all checks | `service.noResult_*`; some: `service.someNoResult` |
| | `paused` | `service.paused` |
| | `muted` | `service.someMuted` |
| | `not_enabled` | the status word |
| | `ok` | `service.allPassing_*` |
| `nodeLine(t, item, node)` | no services | `node.waiting` (`link === 'never'`), else `node.nothingAssigned` |
| | `paused` / `muted` / `ok` | `node.restarting` / `node.mutedCheck` / `node.allPassing_*` |
| | `failing denied warn unknown` | `node.bad`: the first service at that word |
| | `fixing enrolling empty` | `node.nothingAssigned` |
| `wardenLine(t, node, now)` | hub | `node.hub` |
| | `link === 'never'` or no `lastHeardAt` | `node.waiting` |
| | `link === 'silent'` | `node.silent`, `time` = `hm(silentSince ?? lastHeardAt)` |
| | any `paused` check | `node.wardenRestarting` |
| | else | `node.heard`, `ago` against `now` |
| `isRestarting(node)` | any check `paused` | true; the heartbeat dot also reads it |

- Silence outranks a restart: a restart that never comes back is the thing to see.
- A switched-off service counts as passing for the node.
- `serviceSentence` also names a service's square in a collapsed card (`node.squareTip`).
- The service's folded status picks the case, so the pill's glyph and words never disagree.

## `NeedsYouCard`
`NeedsYouCard({ needs, muted, counts, now, onOpen, onMute })`.
- Cards in the read model's order (oldest `since` first); each: glyph, label (else key in mono) and `needs.word`, where and since (`needs.where`, `needs.whereNoSince`), the raw key, the value cut at two lines (`title` carries the whole), Mute.
- Quiet (`needs` empty): `needs.quiet` and `needs.quietPassing_*`.
- No cap on the cards: with dozens, the fleet drops below the fold. 2026-10-06: 19 cards stood 3,925 px tall on a phone and 1,117 px at 1440.
- Muted list while any mute is set: `needs.mutedTitle`, `needs.mutedItem`, `needs.mutedMeta` (`hm(until)`, minutes left from `now`, reason), Unmute.
- A card that stops needing you leaves on `vv-toast-out` over 0.55 s (`leaving`); with motion reduced it is gone.

## `FleetStatusBar` and `FleetLegend`
- `FleetStatusBar({ groups, listed, drawn })` counts from `groups`: passing = All less the rest. Left words join the non-zero groups with ` · `; right note is `fleet.nodes_*`, or `fleet.showing` when the page is shorter than the list. The bar is `aria-hidden`.
- `FleetLegend()` draws one `StatusCell` per status in `ok warn failing denied muted unknown not_enabled`; no result also stands for paused. Refused and Not enabled are there because both appear in real strips.

## `FleetToolbar`
- `FleetToolbar({ layout, groups, filter, query, folds, onLayout, onFilter, onQuery, onExpandAll, onCollapseAll })`.
- A filter is offered only when its count is above zero, or it is chosen, or it is All; counts are the whole fleet's, so a search never changes a chip.
- Expand all / Collapse all show only when `folds` (`!narrow && layout !== 'rings'`).

## `SLOT:` comments (nothing drawn)
Every slot a later plan fills, in this view and elsewhere: MAN-7867.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/FleetStatusBar.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/FleetToolbar.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/NeedsYouCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/fleetWords.ts

## MAN-7880 — Cerberus — the Fleet view: `FleetView`, `NodeCard`, `ServiceRow`, `FleetGrid`, `FleetList`, `WhatHappenedCard`

The Cerberus tab's Fleet view, live: its reads are `useCerberus()` and the pure fleet model, its choices component state, its two presses the props `onOpenCell` and `onMute`. Sentences, Needs-you card, status bar, legend, toolbar, `SLOT:` comments: MAN-7879. Pure model: MAN-7872. Marks and strips: MAN-7873. Check sheet it opens: MAN-7878. Words: MAN-7870. Client reader: MAN-7871. `CerberusPanel` mounts it (MAN-7891), the workspace's Cerberus tab.

## Files
| file | holds |
|---|---|
| `src/modules/cerberus/fleet/FleetView.tsx` | `FleetView({ overview, narrow, onOpenCell, onMute })`: the container; layout, filter, search, open nodes and page |
| `src/modules/cerberus/fleet/FleetGrid.tsx` | `FleetGrid({ entries, moreCount, now, onToggle, onOpenCell, onShowMore })` |
| `src/modules/cerberus/fleet/FleetList.tsx` | `FleetList({ entries, moreCount, narrow, now, onToggle, onOpenCell, onShowMore })` |
| `src/modules/cerberus/fleet/FleetRings.tsx` | `FleetRings({ items, nodes, now, onOpenCell })`: the Rings layout; owns its box, its layout and its selection |
| `src/modules/cerberus/fleet/RingMarks.tsx` | `RingDot`, `RingHub`, `RingsKey`: a node's dot, center's round, the key |
| `src/modules/cerberus/fleet/RingsNodePanel.tsx` | `RingsNodePanel({ item, node, now, onClose, onOpenCell })`: the selected node beside the rings |
| `src/modules/cerberus/fleet/NodeCard.tsx` | `NodeCard({ item, node, open, face, index, narrow?, now, onToggle, onOpenCell })`: one node, `face` `grid` or `list`; exports `NodeGlyph({ status, size })` and `Heartbeat({ node, name? })`, which `RingsNodePanel` reuses |
| `src/modules/cerberus/fleet/ServiceRow.tsx` | `ServiceRow({ node, service, face, onOpenCell })`: name, pill, 30 minute cells |
| `src/modules/cerberus/fleet/WhatHappenedCard.tsx` | `WhatHappenedCard({ activity, now })`: the kit's dense `Timeline` |
| `src/shared/types.ts` § CERBERUS FLEET MODEL | `FleetLayout`, `FleetEntry` (`{ item, node, open }`), `CerberusSheetTarget` |

Leaves draw what they are handed and read nothing: they call `onOpenCell`, `onMute`, `onOpen`, `onToggle`. `NeedsYouCard` alone reads the provider, for Unmute (`liftMute(id)`).

## `FleetView` — contract
- Props: `overview` (non-null: the root draws loading and unreachable), `narrow` (the root's container query), `onOpenCell(target: CerberusSheetTarget)`, `onMute(check)`. The sheet and the Mute dialog are the root's.
- The root needs `container-type: inline-size`: padding `clamp(16px,4cqi,32px)` and the list's indent `clamp(16px,10cqi,60px)` size against it.
- Order: `NeedsYouCard`; then a wrapping row of the fleet column (`flex-[3_1_620px]`: toolbar, status bar, nodes, legend) and `WhatHappenedCard` (`flex-[1_1_300px]`; under the fleet on a phone).
- Nodes: `fleetItems` (worst first), `applyFilter(items, filter, query)`, open = `toggled[id] ?? defaultExpanded(items).has(id)`. `defaultExpanded` reads the WHOLE fleet, so a search never changes what opens. A node opened or closed by hand stays so.
- Paging: first page `FIRST_PAGE` = grid 120, list 80; "Show N more" adds `PAGE_STEP` 120 (`fleet.showMore`); Rings draws every node. A filter or search change returns to the first page (`limit` null).
- `shown.length === 0`: dashed sentence, `fleet.noneInGroup` for a blank search, else `fleet.noMatch`.
- Ages use `overview.now`, never a running clock: heartbeats are not re-read between reads, so a clock that ran on would age a node still reporting.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/FleetGrid.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/FleetList.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/FleetRings.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/FleetView.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/NodeCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/RingMarks.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/RingsNodePanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/ServiceRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/WhatHappenedCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## MAN-7881 — The Cerberus screen's words — the cerberus block of en/common.json — Alternatives the caller picks

| when | key | else |
|---|---|---|
| the node has no `wardenVersion` (the hub) | `sheet.rawHub` | `sheet.raw` |
| `check.origin === 'self'` | `sheet.checkedHub`, `sheet.notCheckedHub`, `lookup.metaHub`, `lookup.metaHubMuted` | `sheet.checked`, `sheet.notChecked`, `lookup.meta`, `lookup.metaMuted` (name the warden and its node) |
| result `value` is null | `lookup.wasNoValue`, `mute.rawNoValue` | `lookup.was`, `mute.raw` |

- `fleet.bar.needs_one` (`{{count}} needs you`) and `node.allPassing_one` (`Its service is passing`) are the singular forms; the other counts use `_other`.
- The warden line is one whole key in each state: `node.heard`, `node.wardenRestarting` and `node.silent` each carry their own `Warden {{version}} · `; `node.waiting` and `node.hub` have no version. A restart is told from the checks: any `paused` check.
- An empty node is `node.emptyTitle`/`node.waitingTitle` over its message in Grid's `EmptyState`, and `node.emptyLead`/`node.waitingLead` (the same words with their full stop) leading the message in List's one sentence.

## Composition

- Summary line: the passing number is drawn on its own (it counts up), then `header.summary.of_*`; the parts are joined with ` · ` in code.
- Mute helper: `time.liftsAt` or `time.liftsTomorrow`, then `. `, then `mute.keepsRunning`.
- An enroll ask that gets no command is said in a warn banner inside the dialog, never a toast: `enroll.notListening` for center's 409 `CERBERUS_NOT_LISTENING` and for an overview whose gateway is not listening; `errors.unreachable` for no answer; else `errors.writeFailed` over the server's own sentence. A 409 `CERBERUS_NAME_TAKEN` is the name field's `enroll.nameTaken`.
- `lookup.stale` takes `{{staleAfter}}` as a formatted span: `staleAfter` is per check.
- `time.secondsAgo minutesAgo hoursAgo daysAgo seconds minutes hours minutesLeft` are plain keys with `{{count}}` (the abbreviation follows the number): no `_one`/`_other`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json

## MAN-7882 — The Cerberus screen's words — the cerberus block of en/common.json — Variables a call must pass

A `_one`/`_other` key resolves only when the call passes `count`.

| key | pass |
|---|---|
| `header.headline.needs_*`, `needsAccent_*`, `summary.of_*`, `summary.nodes_*`, `summary.muted` | `count` |
| `header.summary.lastResult` | `ago` |
| `fleet.filters.label` | `name`, `count` |
| `fleet.bar.*`, `fleet.nodes_*`, `fleet.showMore`, `fleet.rings.note_*` | `count` |
| `fleet.showing` | `shown`, `total` |
| `fleet.noMatch` | `query` |
| `fleet.rings.hubTitle` | `name` |
| `fleet.rings.dotTip` | `name`, `text` |
| `fleet.rings.partial` | `shown`, `total` |
| `needs.count_*`, `needs.mutedTitle` | `count` |
| `needs.quietPassing_*` | `passing`, `count` |
| `needs.word` | `word` |
| `needs.where` | `service`, `node`, `time` |
| `needs.whereNoSince` | `service`, `node` |
| `needs.mutedItem` | `label`, `service` |
| `needs.mutedMeta` | `time`, `left`, `reason` |
| `node.heard` | `version`, `ago` |
| `node.silent` | `version`, `time` |
| `node.wardenRestarting` | `version` |
| `node.bad` | `label`, `word` |
| `node.allPassing_*`, `node.moreSquares` | `count` |
| `node.squareTip` | `label`, `text` |
| `node.emptyMessage` | `node` |
| `service.oneBad` | `label`, `word` |
| `service.needYou_*`, `service.noResult_*`, `service.allPassing_*` | `count` |
| `service.someMuted` | `passing`, `total`, `muted` |
| `service.someNoResult` | `passing`, `total`, `unknown` |
| `service.cellTip`, `sheet.cellTip` | `time`, `word` |
| `sheet.cellTipWorst` | `time`, `word`, `check` |
| `sheet.moreResults` | `count` |

| `activity.check.ok warn failing unknown`, `activity.lifted` | `label` |
| `activity.check.other` | `label`, `word` |
| `activity.muted`, `activity.mutedTomorrow` | `label`, `time` |
| `activity.enrolled` | `node` |
| `activity.enrolledSummary` | `version` |
| `activity.meta`, `sheet.rawHub` | `service`, `node` |
| `sheet.raw` | `service`, `node`, `version` |
| `sheet.muteNote` | `time`, `reason` |
| `sheet.checked` | `time`, `every`, `node` |
| `sheet.checkedHub` | `time`, `every` |
| `sheet.notChecked` | `every`, `node` |
| `sheet.notCheckedHub` | `every` |
| `sheet.checksOf` | `service` |
| `lookup.was` | `time`, `word`, `value` |
| `lookup.wasNoValue` | `time`, `word` |
| `lookup.futureMeta`, `lookup.metaHub` | `time` |
| `lookup.stale` | `staleAfter` |
| `lookup.meta` | `time`, `node` |
| `lookup.metaMuted` | `time`, `node`, `reason` |
| `lookup.metaHubMuted` | `time`, `reason` |
| `history.option` | `service`, `check` |
| `history.optionOnNode` | `service`, `check`, `node` |
| `history.hour`, `history.recorded`, `history.noChanges` | `time` |
| `history.raw` | `key`, `node`, `every` |
| `history.since` | `time` |
| `mute.raw` | `service`, `key`, `value` |
| `mute.rawNoValue` | `service`, `key` |
| `mute.durations.untilTime`, `mute.confirm`, `mute.toast.title` | `time` |
| `mute.toast.message` | `label` |
| `enroll.nameTaken`, `enroll.listening` | `name` |
| `enroll.expires`, `enroll.expired` | `time` |
| `enroll.done` | `name`, `version`, `time` |
| `time.*Ago`, `time.seconds minutes hours minutesLeft` | `count` |
| `time.hoursMinutesLeft` | `hours`, `minutes` |
| `time.liftsAt`, `time.liftsTomorrow` | `time` |

## Words with no prototype sentence

Written by the builder, not quoted: `enroll.expired`, `enroll.getNewCommand`, `enroll.notListening`, `node.allPassing_one`, `activity.check.other`, `activity.check.unknown`, `activity.mutedTomorrow`, `activity.nothingYet`, `errors.retry` (copy of `notes.retry`), `fleet.bar.needs_one`, `fleet.layouts.label`, `fleet.filters.title`, `needs.whereNoSince`, `service.noResult_*`, `service.someNoResult`, `service.paused`, the hub forms and `wasNoValue`/`rawNoValue`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json

## MAN-7883 — The Cerberus screen's words — the cerberus block of en/common.json — Open words

| gap | state |
|---|---|
| fixes and warden-update words: `Fix running or updating`, `Updating · step`, `Updating to X`, `Show them in the fleet` | no key; the fixes and warden-update plans own them |
| `enroll.intro` ends at `…reports to Cerberus on center.` | the reference's `, and runs fixes when asked` goes back into it with the cerberus--fixes plan, once a warden runs a catalog fix on center's signed `run.start` |
| Catalog tab, scenario-player words, preview-node notes | no key |
| `node.heard`, `node.silent`, `node.wardenRestarting`, `enroll.done`, `activity.enrolledSummary` with a null `wardenVersion` | draw a double space; no code path writes such a row |

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json

## MAN-7884 — Cerberus — the tab's dialogs: `MuteDialog`, `EnrollDialog`, `EnrollInstall`, `DialogFrame`, `useEnrollmentStatus`, `enrollAsk`

The two dialogs are filled and live in their own right: both read the one overview and write through the one provider (MAN-7871). `CerberusPanel` (MAN-7891) hosts one of each — Mute from a Needs-you card and from the check sheet, Enroll from the header's "Enroll a node" — and the workspace mounts it as the Cerberus tab, so both open from the live app. Words: MAN-7870, open words MAN-7883. Wire shapes: MAN-7807. Routes: MAN-7802. Design: `design/cerberus/Cerberus Tab.dc.html`.

## Files
| file | holds |
|---|---|
| `src/modules/cerberus/modals/DialogFrame.tsx` | `DialogFrame({ size, title, accent, busy, onDismiss, marker, children })`: Verve's `Modal` look on the house `Dialog` |
| `src/modules/cerberus/modals/MuteDialog.tsx` | `MuteDialog({ open, check, onClose })`; its own `CerberusMuteDuration` = `'min15' \| 'hour1' \| 'hours4' \| 'morning'` and `liftsAt` |
| `src/modules/cerberus/modals/EnrollDialog.tsx` | `EnrollDialog({ open, onClose })`: the three-step flow |
| `src/modules/cerberus/modals/EnrollInstall.tsx` | `EnrollInstall` (the install step), `EnrollRefusal` (the warn banner for a refused ask) |
| `src/modules/cerberus/hooks/useEnrollmentStatus.ts` | `useEnrollmentStatus(issued)`: the poll of `GET /api/cerberus/enrollments/:name` |
| `src/modules/cerberus/utils/enrollAsk.ts` | `askForCommand(name, desc)`: the ask for a command, answered `issued` / `taken` / `refused` |
| `src/shared/types.ts` | `CerberusEnrollRefusal` = `{ kind: 'notListening' } \| { kind: 'unreachable' } \| { kind: 'refused'; sentence: string \| null }` (read by the dialog, its install step and the ask) |

## Shared behaviour
- A dialog is mounted only while `open`: it opens clean every time, and its polling stops on close with no extra code.
- `MuteDialog` draws nothing when `check` is `null`; its form is keyed `node/key`, so a dialog sent straight to another check starts over.
- A dialog closes on Escape, the backdrop, the ✕, Cancel (Enroll: Done too). While Mute's write is out (`busy`) none of them closes it. Enroll never holds its way out: it closes at any moment, even with an ask out — a token the server already minted still works until it expires, it is just never shown.
- `useReturnFocus()` returns focus to the opener.
- `DialogFrame`: `size` `md` = 520 px (Mute), `lg` = 600 px (Enroll), never wider than the screen less 2 rem; the panel scrolls as a whole. `marker` sets `data-cerberus-dialog="mute" | "enroll"` on the panel: what a verify script finds it by.
- `DialogFrame` draws the ✕ LAST in panel order, so first focus lands on the dialog's first field or chip, and Escape still closes from anywhere. It is `disabled` while `busy`.
- `DialogFrame` `accent`: `{ words }` in the accent italic; `{ key }` in mono, upright, for a check with no label.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useEnrollmentStatus.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/DialogFrame.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/EnrollDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/EnrollInstall.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/MuteDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/enrollAsk.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## MAN-7885 — Cerberus — the Fleet view: `FleetView`, `NodeCard`, `ServiceRow`, `FleetGrid` — what each reads, and `FleetRings`

| file | reads and holds |
|---|---|
| `FleetView.tsx` | `fleetItems`, `groups` (`filterGroups`), `shown` (`applyFilter`) memoised on the overview; state `layout`, `filter`, `query`, `toggled` (nodes opened or closed by hand, read for its own entries only: a node named `constructor` is a legal name), `limit`; a filter or a search sets `limit` to null; Expand all and Collapse all write an entry for every node of the page |
| `NeedsYouCard.tsx` | `useCerberus().liftMute(id)` for Unmute; `hooks/useLeavingNeeds.ts` keeps a card that stopped needing you drawn 0.55 s at the place it held (`leaving: true`, `vv-toast-out`), keyed `<node>/<key>`, and drops it when the check needs you again; a place counts in the list as drawn, cards still leaving included; when a leaver expires, the leavers after it move up one slot; a new need that lands ahead of a leaver within the 0.55 s leaves it one slot off until it goes (an anchor-key design would remove that) |
| `ServiceRow.tsx` | `onOpenCell` for the row (at now) and for a minute (`lookupAt: cell.to - 1_000`; the newest minute, now) |
| `WhatHappenedCard.tsx` | `toTimelineEvent(line, t, now)` per line, memoised; one state, `openKey` |
| `FleetRings.tsx` | `size` (state set by a ResizeObserver on `boxRef`, built from the host window), `layout` (`ringsLayout(items, width, height)` at that size, memoised on the three), `selected` (state, `null` at first; let go when its node leaves `items`), `onSelect` (toggles; ✕ hands `null`) |

- The open What happened row is held by the line's identity (`at`, `kind`, `node`, `check`), never by its position: the kit's `Timeline` takes `openIndex` from its owner, and the card derives it by finding that line. A newer line at the head leaves the open row on its event, and a row pushed past seven stops matching and closes.

## `CerberusSheetTarget`
`{ node: string; service: string; check: string; lookupAt?: number }`.
- `check` = the check's `id` within the service (`session.valid`), never the full key; `CheckSheet` takes it as is (MAN-7878).
- `lookupAt` = epoch ms; omitted = now.

| press | hands |
|---|---|
| a Needs-you card's name | `{ node, service, check: check.id }`, now |
| a service row's name and pill (one button) | the check that set the newest minute, else the check at the service's own word, else its first; now |
| a minute cell, not the newest | that minute's `worst` check resolved the same way; `lookupAt: cell.to - 1_000` |
| the newest minute | as above, now |

- A service with no check opens nothing.
- The 30 cells are a pointer's shortcut and take no tab stop (30 stops per service would bury the keyboard). The keyboard opens the sheet from the name and picks minutes in the sheet's own strip.
- Trap: `cell.to - 1_000` is not always the cell's word. A minute's word is the worst over the whole minute: the last second answers a run's first minute; on a run's last minute it already reads the word that came after. Cure, not built: the read model hands each minute the moment its word was reached (`CerberusCell.at`, set in `windowStatus` and `buildServiceCells`), then `ServiceRow` and `CheckSheet` both pass `lookupAt: cell.at` in one change.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/FleetGrid.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/FleetList.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/FleetRings.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/FleetView.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/NodeCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/ServiceRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/WhatHappenedCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useLeavingNeeds.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## MAN-7886 — Cerberus — the Fleet view: `FleetView`, `NodeCard`, `ServiceRow`, `FleetGrid` — `FleetRings`

- FleetView renders it while `layout === 'rings'` and `shown` is not empty, with `items` = the hub (kept at the centre whatever the filter or search leaves) then `shown`. Its Rings props carry no marker: each is a value FleetView already reads.
- It owns its box (`boxRef`), the layout for that box, and the selection. why: a parent can see neither the box nor a press, and a return from Grid or List starts with nothing selected.
- The ring's card (`flex-[3_1_300px]`, at most 720 px) and the side column (`flex-[2_1_300px]`) stand side by side from a 616 px row, which the fleet column always is beside What happened (its floor is 620 px); under that they stack. why: the prototype's 440 + 280 needed 736 px, and on the app's 1004–1159 px panes (1037 on a 1366 screen, 1111 on a 1440) the panel fell some 700 px below the ring, out of view. 300 px is what a service row's 30 minutes need, padding included.
- ✕ hands focus back to the selected node's dot (the hub when that node is not drawn) before letting it go. why: the dot stays mounted and only its `aria-pressed` flips, so focus never falls to `<body>` with the panel's button.
- Positions are the layout's pixels drawn as shares of the box it was laid out in (`center` × 2). A fixed fake fills any width, and a resize being measured stays in place. Dots and spokes keep their px.
- Marks (`RingMarks.tsx`) read `nodeMark` and `STATUS_TABLE`. `RingDot` paints by the word's cell shape; `soft` (passing) takes the tone's edge too. why: a lone dot needs one to be seen; a strip's minute does not. `RingHub` is center: glyph, name, "Cerberus", a fifth of the box (66–92 px). `surface` (muted) takes the neutral dot's solid edge on the raised grey. why: the strip's `border-input` edge measured 1.41:1 on the light card, and a lone dot needs 3:1 to be found. A node with no mark (nothing assigned, as every newly enrolled node starts), and an unmarked hub, is a hollow round in the neutral dot's solid edge under `data-tone="neutral"`: kept dashed it would read as no result. `RingsKey`'s swatches are `RingDot`s; its "Fix running or updating" row is a `SLOT:` in `KEY`, second after Needs you, as the prototype orders it.
- A label (glyph + name) stands on the side away from the hub: above a node on a ring's upper half, below one on its lower half. It is capped at `max-w-[30cqi]` (the box is an inline-size container) and cut with an ellipsis, and in the box's outer left or right fifth it runs inward from its dot. why: names have no length cap, and at a phone's 320 px box long ones ran past the card; the dot's title, its name and the panel carry a name whole.
- Spokes: dashed `border-tone-dot` under `data-tone="neutral"` for no result (why: `border-input` measured 1.41:1 on the light card, and the line that says no result must read on its own); amber `border-t-2` under `data-tone="warn"` for needs you; plain `border-input` otherwise; a selected plain spoke turns `border-primary`. why 2 px: Chromium floors a border under 2 px to whole device pixels, so the prototype's 1.5 px drew as 1 px on a 1× screen.
- Beats: `motion-safe:animate-cerberus-travel`, base `opacity-0`, phases `-(index % 7) × 0.45 s`. Every live spoke beats while every node on the rings is `labelled`; past that, only amber spokes beat. why: sixty beats are texture, and a silent node is told by its dashed spoke and hollow dot.
- Each dot is a button (`aria-pressed`, named "<id> · <line>"); its press area is ≥ 24 px. The keyboard walks the hub, then the nodes worst first.
- The panel (`RingsNodePanel`, keyed by node) shows only for a node in `items`: name, description, line, the warden line said once, a `ServiceRow` (`grid` face) per service or the one-sentence empty state.
- Note: `fleet.rings.note` / `fleet.rings.partial`; none while unmeasured (0 × 0) or with no node around the hub.

## `NodeCard`, `FleetGrid`, `FleetList`
- `grid` face: collapsed tile (glyph, name, heartbeat, up to 8 service squares then `+N`, one line); open, it spans the grid (`col-span-full`) as a card with the warden line and a `ServiceRow` per service; an empty node draws the kit's `EmptyState`.
- `list` face: a row (chevron, glyph, name and description, squares, line, warden line) opening a canvas band; an empty node is one sentence at the band's indent. `narrow` moves the warden line from the row's end into the open band.
- A list row does not repeat the warden line when it equals the node's line ("Waiting for the first heartbeat").
- The tile's edge is `STATUS_TABLE[mark].cell`: `solid` 1.5 px tone edge, `outline` 1 px, `dashed` 1.5 px dashed, the rest the plain border. A node with no mark (`empty`, `fixing`, `enrolling`) draws a dashed edge and a dashed round glyph.
- `fixing` and `enrolling` are fed by nothing yet; each draws as a node with no mark.
- `FleetGrid` columns: `repeat(auto-fill,minmax(150px,1fr))`; never packed `dense`. why: dense pulled later tiles above an open card, broke worst-first order and made keyboard order differ from the eye's.
- Entrance: `motion-safe:animate-shape-rise`, delay inline `min(index, 24) * 18` ms (INV-7053).
- Heartbeat dot: positive and breathing while `link === 'reporting'` and not restarting, else still neutral; named (`role="img"`) only on a collapsed tile.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/FleetGrid.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/FleetList.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/FleetRings.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/FleetView.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/NodeCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/RingMarks.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/RingsNodePanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/ServiceRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/WhatHappenedCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## MAN-7887 — Cerberus — the Fleet view: `FleetView`, `NodeCard`, `ServiceRow`, `FleetGrid` — `ServiceRow`

- Name over raw id (`service.label` over `service.service` in mono; no label: the id alone), `StatusPill` with `serviceSentence`, then the strip: one `StatusCell` per `service.cells`, oldest left, named by `service.cellTip` or, when a check set the minute, `sheet.cellTipWorst`.
- The newest minute breathes (`animate-cerberus-breathe`), or rings while failing (`animate-cerberus-ring-warn`), under `motion-safe`.
- `grid` face sits on the card's surface; `list` face on the canvas, indented and a little tighter.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/FleetGrid.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/FleetList.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/FleetView.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/NodeCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/ServiceRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/WhatHappenedCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## MAN-7888 — Cerberus — the History view: `HistoryView`, `LookupCard`, `EventsCard` — `useActivityFeed` — `hooks/useActivityFeed.ts`

Returns `{ lines, failed, earlier, openIndex, toggle, loadEarlier, retry }`. One `useReducer` holds `lines`, `failed`, the foot (`CerberusFeedFoot` in `shared/types.ts`) and `openIndex`, so a re-read moves the lines and the open row in one step.
- Mount: subscribes, THEN reads `activity({ limit: 40 })`. A `cerberus_changed` frame reads the newest page again, at most once a second (the provider's own gap, the last frame of a burst always read); `websocket_reconnected` reads at once.
- Answers land in ticket order as the providers' do: a good page older than one already published is dropped, and a failed read moves no mark, so a good page still in flight when a newer read fails still lands.
- A re-read that REACHES the held head (its oldest is no newer than the held head) keeps what was loaded BELOW it and puts the open row where its line now stands (matched whole, `JSON.stringify`), or shuts it when the line is gone. A re-read that does not reach it (more than a page landed since: a reconnect after a long sleep) lets the held lines go and the foot says what the page says, so the list is always one unbroken run of the record; an earlier page asked from a cursor the list no longer ends at is dropped. A failed re-read over rows says nothing.
- `loadEarlier`: `activity({ before: <oldest at>, limit: 40 })`, appended (only lines older than the oldest held). A page under 40 is the record's start (`none`). The server runs a page on to the end of an instant, so a page may hold more than 40; every row it sends is kept.
- `retry`: Try again on a first page that did not answer: the placeholder is back while it reads.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/history/EventsCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/history/HistoryView.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/history/LookupCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useActivityFeed.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/UnreachableBanner.tsx

## MAN-7889 — Cerberus — the History view: `HistoryView`, `LookupCard`, `EventsCard` — `LookupCard` props

`checks: CerberusCheckIndexEntry[] | null`, `checksFailed`, `chosen`, `date`, `time`, `detail: CerberusCheckDetail | null`, `failure` (`useCheckDetail`'s `error`), `now`, `onCheck`, `onDate`, `onTime`, `onPick(cell)`, `onRetry`.

| derived | rule |
|---|---|
| index | `reading` (`checks` null, not failed), `failed`, `empty` (0 checks), `ready` |
| `answer` | `detail` when index `ready`, a check chosen and `failure !== 'gone'`, else `null`: a retired check's last answer is never drawn |
| `waiting` | index `reading`, or `ready` with a check chosen, no `failure` and no `detail` |
| `unreachable` | index `failed`, or `ready` with a check chosen and `failure === 'unreachable'` |

- Fields: Check (`Select size="sm"`; a disabled `Input` of the same height until the index answers), Date, At (`type="time" step={1}`). Height `h-11 md:h-9`.
- Row: Check `flex-[2_1_260px]`, then Date + At as ONE wrapping group `flex-[2_1_312px]` (each `flex-[1_1_150px]`). The row breaks Check, then the pair; At is never alone.
- Picker option: `history.option` (`<service label> · <check label>`; service falls back to its raw name, check to its key after the first `/`), sorted with `localeCompare(label, language)`. Two options with one label take `history.optionOnNode`. Value `<node>/<key>`.
- Well (the answer): `LookupSentence size="lg"` keyed `<check>@<at>` so each answer rises in. Prompts take its place through `SentenceRow size="lg" status="unknown"`, in this order: index `empty` → `history.noChecks`; none chosen → `history.chooseCheck`; `gone` → `sheet.gone` + `history.goneMeta`; date not `isWholeDate` → `history.pickADate`; time not `isWholeTime` → `lookup.typeATime`.
- The well is the polite live region and is always mounted: a region inserted with its content is not announced. Empty, it has no frame and is `sr-only`, so the gap above it stays shut.
- Banner: `UnreachableBanner` when `unreachable`; `detail` = `errors.lastAnswer` while an answer is kept under it.
- Raw line (`history.raw`): `answer.check.key`, node, `every` through `stretchKey`.
- Headings `history.hour` and `history.recorded`, and `RecordedResults`' `emptyText` (`history.noChanges`), all take `time` = `stampOf(answer.lookup.at, now)`; `RecordedResults` is keyed by `chosen`.
- A newly typed moment keeps the last answer on screen until its own lands; that answer names its own moment.
- Placeholders (`WaitingAnswer`, `WaitingSections`, the feed's) fade in after 150 ms: `animate-[vv-fade_200ms_ease_150ms_both]`. why: a local read answers in tens of ms; an instant placeholder flashes.

## `EventsCard` props
`events: TimelineEvent[] | null` (newest first), `since: string | null`, `failed`, `earlier: CerberusFeedFoot` (`'more' | 'reading' | 'failed' | 'none'`, `shared/types.ts`), `openIndex`, `onToggle`, `onEarlier`, `onRetry`.

| state | draws |
|---|---|
| `events` null, `failed` | `UnreachableBanner onRetry` |
| `events` null | `WaitingFeed`: `role="status"`, five skeleton rows, `history.readingEvents` |
| `events` empty | `EmptyState`: `history.empty` + `history.emptyMessage` |
| rows | `Timeline density="full"` controlled by `openIndex`, then the foot |
| foot `more` / `reading` | ghost "Show earlier" button; `reading` disables it (`aria-busy`) and says `history.readingEarlier` |
| foot `failed` | `UnreachableBanner onRetry={onEarlier}` |
| foot `none` | `history.nothingEarlier` |

- Eyebrow: `history.since` with `since`, else `history.everything`. `HistoryView` computes `since` from the oldest row: `hm(at)` on `now`'s local day, else `dayAndTime(at)`.
- `openIndex` is the caller's: a re-read prepends rows, and an uncontrolled `Timeline` would leave a different event open (MAN-7847).

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/history/EventsCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/history/HistoryView.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/history/LookupCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useActivityFeed.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/UnreachableBanner.tsx

## MAN-7890 — Cerberus — the History view: `HistoryView`, `LookupCard`, `EventsCard` — `UnreachableBanner`

- `Banner tone="warn"` inside `role="alert"`. An alert is heard when it MOUNTS: a retry that fails again is heard only where the caller mounts the banner afresh. why warn: nothing was refused; the next read may answer.
- Re-mounting callers: `CerberusPanel` (keyed by Try again's finished reads, MAN-7891); the feed's placeholder and History's index read (put back while the read is out). Silent on a second failure: the check sheet's and the look-up's retry of a check's read keep it mounted.
- Try again: `Button variant="tonal" size="sm"`, `max-md:h-11` (44 px under `md`).
- First line `errors.unreachable` (`font-medium`); optional `detail` second line sets itself apart by weight alone. No `opacity-*` on it. why: `opacity-80` measured 3.24:1 on the light banner, under AA.
- Consumers: `CerberusPanel` (its first read of the fleet failed; the fleet it holds is stale, with `detail` `cerberus.errors.lastAnswer`), `LookupCard`, `EventsCard`, `sheet/CheckSheet.tsx`: one spelling of the state for the tab.

## Rules
- A time printed without a date means today. Both cards judge "today" against the view's one `now`.
- `toTimelineEvent(line, t, now)` takes the same `now` (MAN-7872).
- Every control under `md` is 44 px tall: fields `h-11`, Try again, Show earlier (`max-md:h-11`).
- A read or press added to a card goes through a prop in `HistoryView` (or the feed hook it calls); a card never calls `api`.

## Traps
| trap | do |
|---|---|
| the Check picker gives every option its own tab stop (84 on the live index); no arrow keys, no type-to-find | known; a roving-focus `Select` is its own piece of work |
| `useCheckDetail` re-reads every 30 s even for a fixed past `lookupAt` (MAN-7871) | known; unmeasured cost |
| feed titles read "Import backlog is clear is failing" when a label is phrased as a claim: `activity.check.failing` is `<label> is failing` | the plan's wording; change the label, not the key |
| `LookupCard.tsx` is 273 lines, over the module's ~250 | split is a follow-up |
| the time field shows `05:52:10 PM` on an en-US browser | MAN-7876 |

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/history/EventsCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/history/HistoryView.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/history/LookupCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useActivityFeed.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/UnreachableBanner.tsx

## MAN-7891 — Cerberus — the tab root and header: `CerberusPanel`, `CerberusHeader`

The Cerberus tab's root and header, live: the root reads the one overview through `useCerberus()`, holds the tab's own state, and hosts the sheet and the two dialogs; the workspace mounts it as the Cerberus tab. Fleet view: MAN-7880. History view: MAN-7877. Sheet: MAN-7878. Dialogs: MAN-7884. Client reader: MAN-7871. Words: MAN-7870. Banner: MAN-7890. Design: `design/cerberus/Cerberus Tab.dc.html`.

## Files
| file | holds |
|---|---|
| `src/modules/cerberus/CerberusPanel.tsx` | `CerberusPanel()`: header, stale banner, strip, the view shown, the sheet and the two dialogs |
| `src/modules/cerberus/CerberusHeader.tsx` | `CerberusHeader({ overview, stale, onEnroll })` and `ClockPill`: eyebrow, headline, summary, clock pill, Enroll a node |
| `src/modules/cerberus/hooks/useClock.ts` | `useClock(tickMs = 1000)`: the browser's clock as epoch ms, read again each tick on the host window |
| `src/modules/cerberus/hooks/useCountTo.ts` | `useCountTo(target)`: the passing count as drawn |
| `src/shared/types.ts` | `CerberusView = 'fleet' | 'history'` |

`index.ts` exports `CerberusPanel` as a `lazy` import (its own chunk, loaded on the tab's first open); `WorkspaceMain` renders it.

## `CerberusPanel` layout
| order | block | shows when |
|---|---|---|
| 1 | `CerberusHeader` | `overview !== null` |
| 2 | `UnreachableBanner` with `detail` `cerberus.errors.lastAnswer`, keyed by `attempt` | `stale` |
| 3 | strip: `Tabs` and the shown view's hint | `overview !== null` |
| 4 | Fleet, `hidden` while History shows | `overview !== null` |
| 5 | History (`HistoryView`), mounted only while shown | `view === 'history'` |
| — | "Loading Cerberus…" (`cerberus.loading`, `vv-fade` held back 150 ms) | `overview === null && !unreachable` |
| — | `UnreachableBanner` (no `detail`), keyed by `attempt` | `overview === null && unreachable` |

- `VIEWS` is one table (`id`, `labelKey`, `hintKey`). The slot a later plan fills in it: MAN-7867.
- Root: `[container-type:inline-size]`; `data-cerberus-panel="narrow|wide"` carries the flag for a verify script.
- Gutter `px-[clamp(16px,4cqi,32px)]`, top `pt-[clamp(20px,5cqi,28px)]`: from the panel's own width, not the window's. `HistoryView` and `FleetView` keep the same spelling.
- `narrow`: below 620 px, wide again only above 660 px; a width of 0 changes nothing.
- Fleet stays mounted so layout, filter, search and open nodes survive a visit to History. why: it reads nothing of its own. While hidden its box is 0 wide; the rings fill must ignore that.
- History polls every 30 s, so it mounts only while shown.
- A view shown plays `vv-pagein` again.

## Reads and state
| what | where it comes from |
|---|---|
| `overview`, `unreachable`, `stale`, `refresh` | `useCerberus()` (MAN-7871): the fleet, whether the first read failed, whether the held fleet is the last answer (a read failed and it was answered over 90 s before), the read Try again presses |
| `attempt` | state, 0: how many of Try again's reads have finished (`refresh().then(...)`); keys both banners |
| `narrow` | state set by a `ResizeObserver` on `rootRef`, built with `resizeObserverIn(useHostWindow(), …)`: narrow below 620 px, wide again only above 660 px (`width <= 660` keeps it narrow); a width of 0 is ignored |
| `view` | state, `'fleet'`: the view the strip shows |
| `sheet` | state, `CerberusSheetTarget \| null`: set by Fleet's `onOpenCell`, handed to `CheckSheet` field by field |
| `muting` | state, `CerberusCheckView \| null`: set by `onMute` from a Needs-you card or the sheet; the sheet stays open under the dialog |
| `enrolling` | state, `false`: the header's Enroll a node opens the dialog |
| `connected` (header) | `useWebSocket().isConnected` |
| `now` (header) | `useClock()`: every second |
| passing count as drawn (header) | `useCountTo(counts.passing)`: the number itself on mount; on a change it counts from the number last drawn over 1.4 s, ease-out `1 − (1 − k)³`, rounded, one step a frame on the host window; with motion reduced it is the target at once |

## On the workspace
The tab's place on the house row, its count pill, its pane and both palettes: MAN-7866.

## Banner re-announce
- An alert is heard when it mounts. Both root banners are keyed by `attempt`, so a retry that fails again mounts afresh and is heard again.
- The provider's own 30 s reads never change `attempt`: a fleet that stays out of reach is not announced every 30 s.
- Open (follow-up, shared code): Try again shows nothing while its read is out; the sheet's and History's look-up retries do not re-mount the banner (`useCheckDetail` would need a `retry` that clears the failure during the read).

## `CerberusHeader`
- Eyebrow `cerberus.header.eyebrow`; headline `<lead> <em>accent</em>`: "All *quiet*", "One check *needs you*", "3 checks *need you*", from `counts.needsYou` (the number the workspace strip's pill shows).
- Accent: italic, never bold (the display serif has none); `data-tone="positive"` at quiet, `warn` while anything needs you, `text-tone-ink`. why: the call to act is never painted passing green.
- A changed headline re-mounts (keyed by its words) and rises in (`animate-shape-rise`).
- Summary: "`passing` of `checks` checks passing · `muted` muted · `nodes` nodes · last result `ago`". `muted` is left out at 0, the age while `lastResultAt === null`. The age is `agoPhrase` from `utils/fleetWords.ts` (MAN-7879).
- The count in motion is `aria-hidden`; an `sr-only` span carries `counts.passing`.
- Eyebrow, summary and hint use `text-muted-foreground`. why: `ink-faint` measures ~3.1:1 on the light canvas, under AA.
- Pill: `live = connected && !stale`. Live: breathing positive dot, `cerberus.header.live`, `hms(now)`. Otherwise: still neutral dot and `cerberus.header.reconnecting`, no time. Only the mode word is `role="status"`; the clock never is.
- The button row's slot for a later plan: MAN-7867.
- Buttons `h-8 max-md:h-11`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/CerberusHeader.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/CerberusPanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useClock.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useCountTo.ts

## MAN-7892 — Cerberus — the tab's dialogs: `MuteDialog`, `EnrollDialog`, `EnrollInstall` — `MuteDialog`

- Chips in order: `min15`, `hour1`, `hours4`, `morning`. The `morning` chip reads `cerberus.mute.durations.untilTime` with `hm(untilOf('morning'))`.
- `liftsAt(choice, from)` is the one place a duration becomes a moment: `from` + 15 min, 1 h or 4 h, or the next 08:00 local — today's while it is still to come (strictly after `from`), else tomorrow's, set by calendar (`setDate`) so a day with a clock change still lands on 08:00, and never more than `MAX_LIFT_MS` (24 h less a minute, under the server's 24-hour cap) from `from`; the one hour a year that bound bites, the chip, the line under it and the button all say the time it lifts at instead of 08:00.
- Lift line under the chips: `cerberus.time.liftsAt`, or `liftsTomorrow` when `until` is on a later local day than `now` — also for 15 min at 23:50. Confirm reads `cerberus.mute.confirm` with `hm(until)`.
- `now` is state, re-read on each minute's turn (one timeout to the next minute, then another) while the dialog stands open, so the lift line and the button never go stale. The write counts `until` from `Date.now()` at the press, not from `now`.
- Reason: `TextArea`, `maxLength` 500 (the server's limit, `mutes.service.ts`); `readOnly` while `busy`; sent trimmed. The server stores an empty one as "No reason given".
- Title accent: the check's `label` with its first letter lowered (`lowerFirst`; a first word with a second capital in it — SMTP, CompanyCam, WorkCenter — keeps its capitals), else the check's raw `key`.
- Confirm: `busy` on, `mute({ node, key, until, reason: reason.trim() })` from `useCerberus()`. On `true` the dialog closes and the provider's toast speaks (MAN-7871); on `false` `busy` is off again and what was typed stays beside the provider's toast. While `busy` the chips, the field, Cancel, the ✕, Escape and the backdrop hold still.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useEnrollmentStatus.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/DialogFrame.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/EnrollDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/EnrollInstall.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/MuteDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/enrollAsk.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## MAN-7893 — Cerberus — the tab's dialogs: `MuteDialog`, `EnrollDialog`, `EnrollInstall` — `EnrollDialog`

| step | shows | leaves when |
|---|---|---|
| name | intro, name field (`maxLength` 32, `NODE_ID_PATTERN`), description (`maxLength` 200), "Get the install command" | a command is issued (`issued !== null`) |
| install | `EnrollInstall`, keyed by `issued.token` | the status carries `node.firstHeartbeatAt` AND `helloShown` |
| hello | ✓ that grows in and rings once, `enroll.helloLead` + `helloAccent`, `enroll.done`, `enroll.inFleet`, Done (`autoFocus`) | Done |

- `Steps` shows where the flow stands and is not pressable: no going back to rename a node whose token is out. Past the last step at hello, so all three wear ✓.
- The suggested name (`suggestName`, seeded once into state) is the first free `node-N`, counting up from `N = overview.nodes.length`, not from 1 (the prototype's start: center and eis1 suggest `node-2`); `node-1` while no overview has been read.
- The name is typed to the server's grammar: lower case, every character outside `[a-z0-9-]` dropped, no leading dash.
- Name error: `empty` when blank, `taken` when `overview.nodes` holds it (the hub, `center`, is a node of it) or when the last ask for exactly this name came back 409 `CERBERUS_NAME_TAKEN` (`takenName`; typing another name clears it). Shown on the name field. The submit waits on either.
- While `!overview.gateway.listening`: a warn `EnrollRefusal` of kind `notListening` shows before anyone asks, and "Get the install command" waits.
- `askForCommand` (`utils/enrollAsk.ts`) is the one ask, for the first command and for a new one: `api.cerberus.enroll({ name, desc })` with `desc` trimmed and left out when blank. It tells a refusal by the error body's `code`, not by the status (409 is both): `CERBERUS_NOT_LISTENING` is `notListening`; no answer at all (or a 200 that is not JSON) is `unreachable`; a 200 JSON body that is not an enrollment is `refused` with no sentence; any other is `refused` with `refusalSentence(response)`; `CERBERUS_NAME_TAKEN` is `taken`.
- A failed ask for a command shows as a banner in the dialog, never a toast. `taken` is the name field's, except for a new command asked for from the install step, where no field is in view: there it is a `refused` banner with the server's sentence.
- `useEnrollmentStatus(issued)` reads `api.cerberus.enrollment(issued.name)` at once and then 2 s after each answer lands (never two reads in flight). It stops at an expired token, at the warden's first heartbeat and when the dialog closes; a read that fails keeps the last answer. An answer is held with the token it was read for, so a new command starts from no answer, which reads as waiting.
- `helloShown` turns true 1.2 s after the status first carries `node.firstHeartbeatAt`; Copy writes `issued.command` through `copyTextToClipboard(…, useHostWindow())` and says "✓ Copied" for 2 s; a second press while it shows starts the 2 s over (`copiedAt` is a moment, not a flag).
- An expired token says so and "Get a new install command" asks again for the same name and description; its answer replaces the command, `EnrollInstall` remounts on the new token, and polling resumes.
- Closing at any step is safe: an issued token still works until it expires; the node turns up in Fleet when its warden speaks.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useEnrollmentStatus.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/DialogFrame.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/EnrollDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/EnrollInstall.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/MuteDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/enrollAsk.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## MAN-7894 — Cerberus — the tab's dialogs: `MuteDialog`, `EnrollDialog`, `EnrollInstall` — `EnrollInstall`

- Three lines tick as the machine gets there: `token` (at once), `install` (`installRanAt !== null`), `hello` (`node.firstHeartbeatAt !== null`). Each is `role="img"` with `status.completed` or `status.pending`, keyed by its state so a landed ✓ is a new mark playing `cerberus-check`; the `<ul>` is `aria-live="polite"`.
- The command is mono, whole, wrapped anywhere, `select-all`. Copy autofocuses on mount.
- The Copy label swap sits in one grid cell with the unsaid word held `invisible`: the button is always as wide as "✓ Copied" in any language, so the command never re-wraps. The swap stays inside that cell.
- Expired (`status.token === 'expired'`): the command is struck through and keeps its ink `text-secondary-foreground` (7.49:1 light, 9.31:1 dark on its `bg-muted` box; muted ink there reads 4.45:1 in light, under AA); Copy is `disabled`; the listening box is replaced by a warn banner with "Get a new install command", which takes focus (`autoFocus`).
- The expired banner mounts fresh each time the token expires, which is what lets its button take focus. A reissue keeps that: a new command remounts the step by token, with Copy focused again and its ✓ arriving again.
- `EnrollRefusal` has `role="alert"` so a second refusal is announced; tone `warn` (nothing was denied). Words: `enroll.notListening`, `errors.unreachable`, `errors.writeFailed` + the server's sentence.

## Rules
- The ✕'s phone-size offsets (`max-md:` ± 6 px, 44 px square) are calculated from `DialogFrame`'s padding `clamp(18px,5vw,32px)` / `clamp(20px,5vw,30px)`. Change the padding and those offsets together.
- `EnrollDialog` and `MuteDialog` use the page's `document` through `useReturnFocus`, not `useHostWindow()`; harmless while the tab lives in the main window. Copy does go through `useHostWindow()`.
- The Mute and Enroll submits, and the install step's "Get a new install command", are `aria-disabled` while their write is out and never `disabled`: a disabled button gives up the focus it holds, so a refused press would leave the page with none. Each handler guards the press itself. Tailwind's `aria-disabled:` variants paint the dimmed look, since the kit `Button` paints none.

## Open
| gap | state |
|---|---|
| kit `Button` has no `busy` option (Chip's `aria-disabled` + dimmed look) | the dialogs paint and guard `aria-disabled` themselves (Rules); a kit `busy` would let every busy button do the same without the per-call classes |
| house `Field` has no slot for Verve's small "optional" label | `enroll.desc` reads `What it is (optional)` in one key |

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useEnrollmentStatus.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/DialogFrame.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/EnrollDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/EnrollInstall.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/MuteDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/enrollAsk.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts
