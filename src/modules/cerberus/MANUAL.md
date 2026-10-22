<!-- docstore export; edit rows with docstore write, never this file -->

## MAN-7868 — Cerberus — the tab: `CerberusProvider`, the status table and the views, where each subject is documented, and the rules of the module

The Cerberus tab: the fleet's health on the house row. One provider reads `GET /api/cerberus/overview` and holds it for every reader; the views draw from it, and a check's sheet reads one check. The tab is composed from `@/shared/ui`, with five pieces added to the library for it (Sheet, Timeline, Steps, Checkbox, DialogFrame: every module with a panel to raise or a feed to draw composes them); TextArea came for the roadmap and the Mute dialog takes it too. Server module: MAN-7815. Wire shapes: MAN-7807. Design: `design/cerberus/Cerberus Spec.dc.html`, whose Table 8 makes it reference for layout, copy and motion only: no prototype markup or script is in `src/`.

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
| a project's node: `projects.node`, the route and its co-location rule, "Projects that run here", `CerberusNodeView.colocated` / `projects` / `sessions` | MAN-7920 | `fleet/NodeProjects.tsx`, `utils/fleetWords.ts` (`sessionsTail`), `server/modules/projects/projects.routes.ts`, `server/modules/projects/services/project-node.service.ts` |
| the check sheet | MAN-7878 | `sheet/CheckSheet.tsx`, `CheckRows.tsx`, `SelectedCheck.tsx`, `CheckLabelEditor.tsx` |
| History | MAN-7877 (feed MAN-7888, lookup card MAN-7889, banner MAN-7890) | `history/*.tsx`, `hooks/useActivityFeed.ts`, `UnreachableBanner.tsx` |
| Tours, the strip's fourth view, after History: the code is the module `src/modules/affected-areas` (`cloudcli:src/modules/affected-areas`), which the root imports through its barrel; drawn once center's overview has answered, mounted on its first show and kept `hidden` after | MAN-8575 (row map and numbers MAN-8576, rules MAN-8577); the root's side MAN-7891 | `CerberusPanel.tsx` (`VIEWS`, `KeptView`), `src/modules/affected-areas/*` |
| the Bulletins view, the strip's fifth view, after Tours: the code is the module `src/modules/carrier-bulletins` (`cloudcli:.`), which the root imports through its barrel; read-only; drawn once center's overview has answered, mounted on its first show and kept `hidden` after, as Tours is | MAN-8880 (its wire MAN-8865; the root's side MAN-7891; the surround both views share MAN-8917) | `CerberusPanel.tsx` (`VIEWS`, `KeptView`), `src/modules/carrier-bulletins/*` |
| the Mute and Enroll dialogs | MAN-7884 (Mute MAN-7892, Enroll MAN-7893, install step MAN-7894) | `modals/*.tsx`, `hooks/useEnrollmentStatus.ts`, `utils/enrollAsk.ts` |
| the slots later plans fill, and the `FILL:` markers a scaffolded screen leaves for its fill | MAN-7867 | `SLOT:` and `FILL:` comments, `VIEWS` in `CerberusPanel.tsx` |
| the fixes screen, live: Catalog view, a Needs-you card's fix, Fix output, the sheet's fixes, the run reads | MAN-7906 | `catalog/CatalogView.tsx`, `fleet/NeedFix.tsx`, `sheet/FixOutput.tsx`, `sheet/CheckFixes.tsx`, `hooks/useRunOutput.ts`, `hooks/useRunLastLine.ts`, `hooks/useCatalogRead.ts` |
| the diagnosis screen, live: the read-only diagnosis panel and the Promote dialog; the Diagnose buttons, the diagnosis read and its three writes | MAN-7932; MAN-7945 | `sheet/DiagnosisPanel.tsx`, `modals/PromoteDialog.tsx`; `DiagnoseButton.tsx`, `hooks/useDiagnosis.ts`, `hooks/useDiagnosisVerbs.ts` |
| the updates screen, live: the header's Update wardens button, the dialog, the Updating pill and paused restart on a node's card, the warden lines of What happened | MAN-7934 | `CerberusHeader.tsx`, `modals/UpdateWardensDialog.tsx`, `hooks/useWardensRead.ts`, `hooks/useUpdateBatch.ts`, `utils/wardenUpdates.ts`, `fleet/UpdatingPill.tsx` |
| the six `animate-cerberus-*` motions and who draws each | MAN-7869 | `tailwind.config.js` |
| the words | MAN-7870 (alternatives MAN-7881, variables MAN-7882, open words MAN-7883) | `src/modules/i18n/locales/en/common.json` |
| the library pieces, their paint, the tone names | MAN-740, MAN-739 (`cloudcli:src/shared/ui/verve`); `Timeline`'s layout MAN-7847 | `src/shared/ui/Sheet.tsx`, `src/shared/ui/Timeline.tsx`, `src/shared/ui/TextArea.tsx`, `src/shared/ui/Steps.tsx`, `src/shared/ui/Checkbox.tsx`, `src/shared/ui/DialogFrame.tsx`, `src/shared/ui/verve/panels.css`, `tailwind.config.js` |
| the routes the client reads | MAN-7802 (`cloudcli:server/modules/cerberus`) | `server/modules/cerberus/cerberus.routes.ts` |

## Rules of the module
- Other modules reach it only through `src/modules/cerberus/index.ts`: `CerberusProvider`, `useCerberusNeeds`, `CerberusPanel` (`lazy`). Files inside import siblings by path, never through the barrel. The two modules it reaches are `src/modules/affected-areas` (`AffectedAreasView`) and `src/modules/carrier-bulletins` (`BulletinsView`), each through its `index.ts`; the surround both views are mounted in is the shared `ViewBoundary` (`src/shared/ui/ViewBoundary.tsx`, MAN-8917), drawn by `KeptView` (MAN-8918).
- Types are `type`, never `interface`. A type two files share lives in `src/shared/types.ts` (`TimelineEvent`, `CerberusView`, `CerberusSheetTarget`, `FleetLayout`, `FleetEntry`, …). `src/shared/cerberus-types.ts` is read, never redefined.
- Every endpoint is a verb of `api.cerberus` in `src/shared/api.ts`.
- Layout of the module: `context/` (provider), `hooks/`, `utils/` (pure), `fleet/`, `sheet/`, `history/`, `catalog/` (the Catalog view), `modals/` (the dialogs).
- Colour: no hex, `rgba(` or `var(--` in a className or style under `src/modules/cerberus/` (2026-10-06: none outside one comment). Tone reaches paint only as `data-tone` plus a `tone-*` name (MAN-739 rule 3); the set stays five, so denied is `danger` (MAN-739 rule 4).
- A status is painted from one table, `STATUS_TABLE` (MAN-7873), and a state that speaks in colour also carries its icon or word (MAN-578).
- Words: every sentence is a `cerberus.*` key through `t()`, English only; a label, reason, node name or description is data, never a key (MAN-7870). The Tours strip's two words are `cerberus.*` (`cerberus.tours.tab`, `cerberus.tours.tabHint`); the Tours view's own are `affectedAreas.*` (MAN-8575).
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
| pane (`WorkspaceMain.tsx`) | `activeTab === 'cerberus'` → `<div className="h-full overflow-hidden"><CerberusPanel projectChoices={projectChoices} /></div>`, after the API pane, inside the file's `Suspense`; the panel is the barrel's `lazy` export, its own chunk, loaded on the first open. The "No gate" comment sits above it |
| `NAV_TABS` (`command-palette/CommandPalette.tsx`) | `{ id: 'cerberus', label: 'Go to Cerberus', keywords: 'cerberus fleet health monitoring checks wardens nodes' }`, after API |
| `visibleTabs` (`ProjectCommandPalette.tsx`) | the always-on list names `'cerberus'` after `'api'`: a `NAV_TABS` row shows only if this list names it |

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/command-palette/CommandPalette.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useProjectsState.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useWorkspaceTabGates.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/ProjectCommandPalette.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/ProjectSidebarRegion.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/WorkspaceMain.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/WorkspaceTabs.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## MAN-7867 — Cerberus — the slots later plans fill: every `SLOT:` and `FILL:` comment, the `VIEWS` table and `activityEvents`

Where a plan plugs into the tab (the fixes plan's places are filled and live: MAN-7906, and so are the updates plan's: MAN-7934, the diagnosis plan's: MAN-7932, the tours plan's: MAN-8575, and the bulletins plan's: MAN-8880). No `SLOT:` or `FILL:` comment stands in `src/modules/cerberus`; the rings-key row below is the one slot left. A plan whose screen is scaffolded and not yet filled marks its places `FILL:` (`grep -rn "FILL:" src/modules/cerberus`): each names what its fill mounts there, and the fill replaces it. Row map: MAN-7868.

## Rules
- A slot is a comment (or a table row) and draws nothing: no placeholder, no empty container, no flag.
- The plan that fills a slot puts its piece where the comment stands and deletes the comment.
- A filled piece carries its own words under `cerberus.*` (MAN-7870) and its own tone through `data-tone` (MAN-739 rule 4).

## Slots
| slot | file | what goes there | plan |
|---|---|---|---|
| rings key | `fleet/RingMarks.tsx`, `KEY` | the `fixing` row ("Fix running or updating", `cerberus.fix.fleet.legend`, the info dot) is live, and an `updating` node draws it too; `enrolling` shares it, with no mark of its own yet | enrolling |


## Other places a plan adds a case
| place | what a plan adds |
|---|---|
| `utils/activityEvents.ts` `toTimelineEvent` | a `case` per new `CerberusActivity` kind (`fix`, `catalog`, `warden` and `diagnosis` are live), a builder, words under `cerberus.activity`; an unknown kind draws neutral and is never thrown on (MAN-7872) |
| `utils/cerberusStatus.ts` `nodeMark` | `enrolling` returns `null` (no mark) while nothing feeds it; whatever feeds it gives it a mark. `fixing` is fed and draws `FLEET_FIXING_LOOK` through `markLook`, and so does `updating` (a node with an update queued or running) |

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/CerberusHeader.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/CerberusPanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/NeedsYouCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/NodeCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/RingMarks.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/RingsNodePanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/ServiceRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/CheckFixes.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/CheckSheet.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/SelectedCheck.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/activityEvents.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/cerberusStatus.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/fleetWords.ts

## MAN-7869 — Cerberus — the six `animate-cerberus-*` motions in `tailwind.config.js` and who draws each

The tab's six motions, named in `tailwind.config.js` (`keyframes` + `animation`) and spelled `motion-safe:animate-cerberus-<name>`: a reader who asked for less motion gets none. Colour in them is `--warn-dot` through `color-mix` and nothing else; every other motion moves or fades an element that keeps its own ink. Verve's own keyframes (`vv-pagein`, `vv-pop`, `vv-ring`, `vv-toast-out`) are in `tokens.css`. Row map: MAN-7868.

| name | motion | drawn by |
|---|---|---|
| `cerberus-ring-warn` | halo of the warn dot, `box-shadow` 0 → 8px as it fades; 1.8 s ease-out, infinite | a mark that needs you: `StatusGlyph` while `failing` (not `still`), the rings' node dot while `failing` and not selected, the newest cell of a service row while `failing` |
| `cerberus-breathe` | opacity 1 ↔ .5; 2.6 s ease-in-out, infinite | `Heartbeat` (`NodeCard.tsx`) while the warden is reporting (`link === 'reporting'`, so never while `paused`); the clock pill's dot while live (`CerberusHeader.tsx`); the newest cell of a service row that is not failing; the running wrench of a fix's output pill while it goes (`FixOutput.tsx`) |
| `cerberus-travel` | a beat from the node's end of a spoke to the hub (`left: 100%` → `0`), in over the first 12%, out over the last 15%; 3.2 s linear, infinite | `FleetRings.tsx`, on a live spoke (MAN-7886) |
| `cerberus-check` | a ✓ grows .4 → 1 as it fades in; .6 s `--ease-spring`, both | `NeedsYouCard.tsx`'s quiet passing glyph (100 ms delay), a landed step in `EnrollInstall.tsx`, the hello mark in `EnrollDialog.tsx` (as an arbitrary `animate-[…]` beside `vv-ring`), the Catalog's empty-state ✓ (`CatalogView.tsx`, 200 ms delay), the result badge of a fix's output once it ended (`FixOutput.tsx`), and the "Ready" and "Failed" badges of a diagnosis (`DiagnosisPanel.tsx`) |
| `cerberus-line` | a rise from 5px below; .35 s `--ease-enter`, both | `history/LookupCard.tsx`: each answer of the look-up as it arrives; each output line of a fix as it arrives (`FixOutput.tsx`), each step of a diagnosis as it is said (`DiagnosisPanel.tsx`), each step line of an update (`UpdateWardensDialog.tsx`) |
| `cerberus-caret` | on 0–49%, off 50–100%, no tween; 1 s `steps(1)`, infinite | the cursor block after the output of a fix that is still going (`FixOutput.tsx`) |

governs: /home/lyphe/.claude/claudecodeui_lyphe/tailwind.config.js

## MAN-7870 — The Cerberus screen's words — the cerberus block of en/common.json

Every word the Cerberus screen draws, in the top-level `cerberus` block of `src/modules/i18n/locales/en/common.json`, between `notes` and `applications`, plus `tabs.cerberus` (`Cerberus`, after `tabs.notes`). Wire shapes: MAN-7807; the REST surface the screen reads: MAN-7802; the module: MAN-7815. Sibling words row: MAN-7634.

## Shape

- 439 leaves under `cerberus.*`, `en` only (measured 2026-10-07: the groups below sum to it). The other ten locales hold no `cerberus` block and no `tabs.cerberus`: `fallbackLng: 'en'` (`src/modules/i18n/config.ts`) reads the English.
- Read by the files under `src/modules/cerberus` (MAN-7871).
- Nested multi-line objects, the file's own 2-space indentation.

| group | keys | holds |
|---|---|---|
| `loading` | 1 | the spinner label |
| `header` | 16 | `eyebrow`, `headline.*` (10), `summary.*` (6: `of_*`, `muted`, `nodes_*`, `lastResult`), `live`, `reconnecting`, `enroll` |
| `status` | 8 | one word per status value |
| `fleet` | 45 | `tabs`, `layouts`, `filters`, `searchPlaceholder`, `expandAll`, `collapseAll`, `bar`, `nodes_*`, `showing`, `showMore`, `noMatch`, `noneInGroup`, `legend`, `rings` |
| `needs` | 14 | the Needs-you panel and its muted list |
| `node` | 37 | a node card: warden line, empty and waiting states (a card's title, a list band's lead), squares; `sessions_*` (the count after the warden line); `projects.*` (14: "Projects that run here", its empty line, ✕'s name, the two "Moving…" words, "Run a project here", the line with nothing to offer, the refusal, `notReporting`, and `toast.here` / `toast.hereWaiting` / `toast.back`); `updating` (`UpdatingPill`) and `updatingWarden` (the collapsed tile's line): MAN-7934 |
| `service` | 11 | a service row's pill and cell tip |
| `activity` | 43 | the What-happened feed; `fix` (7) and `catalog` (3) are the fixes plan's kinds, `source.fix` and `source.catalog` their pills; `diagnosis` (4: `asked`, `askedSummary`, `ready`, `failed`) and `source.diagnosis` are the diagnosis plan's, read by `diagnosisEvent` (MAN-7872); `warden` (8) and `source.warden` are the updates plan's, read by `wardenEvent` (MAN-7934) |
| `sheet` | 24 | the check sheet |
| `lookup` | 13 | the moment lookup's answers |
| `history` | 27 | the History tab: the look-up card's fields, prompts and headings, the events card's states (MAN-7877) |
| `catalog` | 27 | the Catalog tab and its rows: `tab`, `tabHint`, `intro`, `count_*`, `empty`, `new`, `trigger.*`, `raw`, `stats.*`, `origin.*`, `auto.*`, `runNow`, `running`, `blocked` (MAN-7906) |
| `fix` | 32 | a fix on the screen: `run`, `command`, `strip.*` (a Needs-you card's run strip), `output.*` (Fix output), `sheet.*` (the sheet's fixes), `headline` + `headlineAccent`, `quiet`, `fleet.*` (MAN-7906) |
| `diagnosis` | 29 | the diagnosis plan's panel and buttons (MAN-7932): `eyebrow`, the pill's `reading` / `ready` / `failed`, `scope`, `steps_*` (the folded steps' one line), `proposal.*` (the Proposed fix box: `title`, `runOnce`, `addToCatalog`, `running`, `ranOnce` with `result.*`, `refused`, `expired`, `unpublished`, `promotedOff` / `promotedOn` / `promotedRetired`, `note`, `noteAdd`, `none`), and the buttons: `diagnose`, `diagnosing`, `see`, `again`, `hint` |
| `promote` | 24 | the Promote dialog (MAN-7932): `title` + `accent`, `from_*`, `name`, `nameHelper`, `when`, `runs`, `generalized`, `last`, `exact`, `auto`, `autoOff`, `autoOn` (+ `autoOn_warn`), `limit`, `limitHelper`, `perHour_*`, `cancel`, `confirm`, `toast.*` |
| `mute` | 17 | the mute dialog and its toast |
| `enroll` | 31 | the three-step enroll flow |
| `updates` | 23 | the updates plan's dialog and header button (MAN-7934): `button.update` / `.updating` / `.upToDate` (the header's three states), `title` + `titleAccent`, `note`, `kept_*`, `versions`, `node`, `current`, `queued`, `updated`, `rolledBack`, `cancel`, `start_*`, `running`, `close`, `done`, `missed_*`, `finish` |
| `time` | 13 | spans and relative times |
| `errors` | 4 | `unreachable`, `retry`, `lastAnswer` (the banner's second line over a kept answer), `writeFailed` (the warn toast's title for a refused mute, lift or label write, and the Enroll dialog's banner title for a refused ask) |

## Rules

- `status.*` is keyed by the status value itself (`ok warn failing denied not_enabled unknown muted paused`): `` t(`cerberus.status.${status}`) `` needs no map. Every legend or cell that names a status reads it; only a different word has its own key.
- `{{word}}` is the lowercased status word, passed by the caller: `lookup.was`, `lookup.wasNoValue`, `service.oneBad`, `node.bad`, `activity.check.other`.
- A reason, a check label and a node description are data, never keys. The server stores "No reason given" itself (`NO_REASON_GIVEN`, `server/modules/cerberus/mutes.service.ts`), so the mute dialog has no key for it.
- A status's or a run's mark is a lucide icon in code (`STATUS_TABLE`, `RUN_LOOK`, MAN-7873), never in the words. Text characters still in code: the update dialog's `✓ ✕ ▲ ●` (MAN-7934), the diagnosis steps' `● ✓` and `↳`, the enroll ticks' `✓`. The two keys with a glyph inside: `enroll.copied` (`✓ Copied`) and `needs.word` (`· {{word}}`). `needs.quiet` carries no `✓`: the badge draws it.
- A two-part headline is two keys, the second drawn in the accent by code: `header.headline.quiet` + `quietAccent`, `needs_*` + `needsAccent_*`, `enroll.title` + `titleAccent`, `enroll.helloLead` + `helloAccent`.
- `node.projects.refusedLead` + `refused` are `PROJECT_NODE_NOT_COLOCATED` said in words, in `NodeProjects`' warn banner; the server's two sentences under that code ("not enrolled", "not on this machine") are not shown. `toast.here` and `toast.back` are the toasts the provider's `setProjectNode` raises when a move lands; `toast.hereWaiting` is `toast.here`'s message while the node's warden is not reporting, the case `notReporting` names under the section's heading. `node.sessions_*` carries no `·`: `sessionsTail` (`utils/fleetWords.ts`) draws it, after the warden line's words and only while the warden reports. Its words are bound by no-break spaces (` `), and the code joins the dot to them with one, so on a phone the phrase wraps whole rather than leaving "here" alone.
- `enroll.notListening` is `CERBERUS_NOT_LISTENING` said in words, drawn by `EnrollRefusal` (MAN-7884) both after a 409 and up front while the overview says the gateway is not listening.
- `enroll.desc` is one key, `What it is (optional)`: the prototype draws `optional` in its Field's `meta` slot, which the house `Field` (`src/shared/ui/Field.tsx`) does not have.
- Apostrophes in keys are straight (`'`); `fleet.noMatch` quotes with `“ ”`.
- `activity.expired` is the summary line under the `activity.lifted` title; never drawn alone.
- `activity.muted` (`until {{time}}`) and `activity.mutedTomorrow` (`until {{time}} tomorrow`): `mutedTomorrow` when the lift falls on a later local day than the mute (MAN-7872).
- `activity.source.check` and `activity.source.mute` have no reader: the pill is the service's label. Only `activity.source.node` is read.
- `activity.fix.*`, `activity.catalog.*`, `activity.source.fix` and `.source.catalog` are read by `fixEvent` and `catalogEvent` in `utils/activityEvents.ts`. The feed's `fix` line carries a result and the seconds it took but no exit code, so a failure reads `activity.fix.failed` ("Failed"); the exit code is said by `fix.strip.failedExit` and `fix.output.failedExit`, which read the run.
- A name, label or command in the fixes' words is a `{{name}}` / `{{cmd}}` variable drawn through `t()`, never `Trans`: `Trans` escapes `<` in a label (MAN-7906).
- `catalog.count_*`, `catalog.stats.allOk_*` / `someOk_*` and `catalog.auto.on_*` are plural pairs on `count`; `catalog.auto.on_hour_*` / `on_day_*` pick by `context` (`hour` or `day`).
- `promote.from_*` and `promote.perHour_*` are plural pairs on `count`; `promote.autoOn` picks `autoOn_warn` by `context` (the entry's `when`), and falls back to `autoOn` for `failing`. `diagnosis.steps_*` is a plural pair on `count`, with `{{from}}` and `{{to}}` (the first and last step's `hms()`; `_one` has no range). `diagnosis.ready`, `.proposal.ranOnce`, `.proposal.refused`, `.proposal.expired` and `promote.from_*` take `{{time}}` as `hms()`; `.proposal.unpublished` takes `{{node}}`. `promote.generalized`'s `{{used}}` and `{{saved}}` are spans of the proposal's two commands, `saved` read through `promote.last` + `time.minutes` / `time.hours` when it is a relative window (MAN-7932). A summary, a piece of evidence, an error and a command are data, never keys.
- `updates.kept_*`, `updates.start_*` and `updates.missed_*` are plural pairs on `count`; `kept_*` counts the versions kept for rollback, its `{{from}}` one version or `updates.versions` joining several. A version, a release note, a node's id and a warden's step sentence are data, never keys; `note` drops the release note's own trailing full stop. The ✓ before `updated` and `done`, the ✕ before `rolledBack`, the ▲ before a failed step's sentence and before `missed_*`, and the running ● stay in code (MAN-7934). `activity.warden.*` (8: `started`, `startedSummary_*`, `updated`, `updatedKept`, `rolledBack`, `rolledBackUnknown`, `failed`) and `activity.source.warden` are the warden update's lines of What happened.
- `diagnosis.proposal.ranOnce`'s `{{result}}` is `proposal.result.*` (`ok`, `failed`, `timedOut`), so a run that did not succeed never says "succeeded"; a refusal never started, so it is `proposal.refused`, never "Ran once"; the ↳ before a piece of evidence, and the ✓ before `promotedOff` / `promotedOn` stay in code; the `diagnosis.failed` pill draws `RUN_LOOK.failed`'s icon before the word.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json

## MAN-7871 — Cerberus — the client: `CerberusProvider`, `useCerberusNeeds`, `useCheckDetail`, `api.cerberus`, `cerberusTime`

The browser's one reader of Cerberus: a provider holds the overview for every reader, a hook reads one check. Wire shapes: MAN-7807. Routes read: MAN-7802. Words: MAN-7870. The provider this follows: MAN-7521.

## Files
| file | holds |
|---|---|
| `src/modules/cerberus/index.ts` | barrel: `CerberusProvider`, `useCerberusNeeds`, `CerberusPanel` (lazy) |
| `src/modules/cerberus/context/CerberusContext.ts` | `CerberusContext` (default `null`), type `CerberusValue`, hooks `useCerberus`, `useCerberusNeeds`; no component |
| `src/modules/cerberus/context/CerberusProvider.tsx` | `CerberusProvider` only |
| `src/modules/cerberus/context/ProjectChoicesContext.ts` | `ProjectChoicesContext` (default `null`) and `useProjectChoices()`: the workspace's projects, provided by `CerberusPanel` from its `projectChoices` prop and read by `NodeProjects`; no component |
| `src/modules/cerberus/hooks/useCheckDetail.ts` | `useCheckDetail` |
| `src/modules/cerberus/hooks/useCatalogRead.ts` | `useCatalogRead()`: the catalog beside the overview, read by the provider |
| `src/modules/cerberus/hooks/useWardensRead.ts` | `useWardensRead()` → `{ wardens, readWardens }`: `GET /api/cerberus/wardens` beside the overview (the release on offer, each node against it, the running batch), read by the provider on the same triggers; ticketed like the catalog's read, a failed read keeps the last answer: MAN-7934 |
| `src/modules/cerberus/hooks/useRunOutput.ts`, `useRunLastLine.ts` | `useRunOutput(runId)`: one run and its lines, streamed and replayed (`FixOutput`); `useRunLastLine(run)`: a card's strip's newest line, live (`NeedFix`): MAN-7906 |
| `src/modules/cerberus/hooks/useDiagnosis.ts`, `useDiagnosisVerbs.ts` | `useDiagnosis(id)`: one diagnosis and its steps, read and kept live (`DiagnosisPanel`); `useDiagnosisVerbs(tools)`: the provider's `diagnose`, `runProposal` and `promote`: MAN-7945 |
| `src/modules/cerberus/utils/cerberusTime.ts` | `hm`, `hms`, `dateOf`, `dayAndTime`, `momentOf`, `stampOf`, `agoParts`, `stretchKey`, `sameLocalDay`, `isWholeTime`, `isWholeDate` |
| `src/modules/cerberus/fleet/fleetModel.ts`, `utils/activityEvents.ts` | the Fleet's pure model and the activity→Timeline mapping: MAN-7872 |
| `src/modules/cerberus/fleet/*.tsx`, `utils/fleetWords.ts` | the Fleet view: MAN-7880, MAN-7879 |
| `src/modules/cerberus/modals/*.tsx`, `hooks/useEnrollmentStatus.ts`, `utils/enrollAsk.ts` | the Mute and Enroll dialogs: MAN-7884 |
| `src/shared/api.ts` | `api.cerberus` (the overview's, the catalog's, the run's, the warden updates' — `wardens`, `startUpdate`, `updateBatch` — and the diagnosis' verbs); `api.projects.setNode(projectId, node \| null)` (`PUT /api/projects/:projectId/node`, 204; `api.projects.list()` is the sidebar's read); `refusalSentence(response)` (the server's own sentence, or `null`); `refusalCode(response)` (`error.code` of a refusal body, or `null`; reads a clone, so `refusalSentence` can still read the body) |
| `src/shared/types.ts` | `CerberusMuteInput`, `CerberusLabelInput`, `CerberusEnrollInput` (client-only: the routes read a loose JSON body); the dialogs' `CerberusEnrollRefusal`: MAN-7884 |

## Mount and barrel
- `src/App.tsx`: `<CerberusProvider>` directly inside `<HealProvider>`, wrapping `<Router>`; inside the auth gate, below `WebSocketProvider`. why: `api.cerberus` is authenticated; `cerberus_changed` arrives on the one socket; above the Router a count pill is honest on every tab.
- The barrel exports `CerberusPanel` too, as `lazy(() => import(...))`: the panel is the tab's whole tree, its own chunk, loaded on the tab's first open (`WorkspaceMain` renders it inside its `Suspense`). Nothing else. Module files import siblings by path, never through the barrel.
- `useCerberus()` throws outside the provider (`useCerberus must be used within a CerberusProvider`).
- `useCerberusNeeds()` = `overview?.counts.needsYou ?? 0`. Read by `useWorkspaceTabGates` for the Cerberus tab's count pill, so the strip and the tab's headline are the same number.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/App.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/context/CerberusContext.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/context/CerberusProvider.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/context/ProjectChoicesContext.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useCheckDetail.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/cerberusTime.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## MAN-7917 — Cerberus — the client: `CerberusProvider`, `useCerberusNeeds`, `useCheckDetail` — `CerberusValue`
section: Cerberus — the client: `CerberusProvider`, `useCerberusNeeds`, `useCheckDetail`, `api.cerberus`, `cerberusTime`/001 `CerberusValue`

| member | meaning |
|---|---|
| `overview: CerberusOverview \| null` | last good read; `null` = no read has answered |
| `unreachable: boolean` | true only while `overview` is `null` and the last read failed; the next good apply clears it |
| `stale: boolean` | true once a read fails while the held overview was answered over 90 s before (`STALE_AFTER_MS` = three clock reads); the next good apply clears it. Never true while `overview` is `null` |
| `catalog: CerberusCatalogEntryView[] \| null` | the catalog, read with the overview (`useCatalogRead`); `null` until a read answers, kept over a failed one |
| `catalogFailed: boolean` | true only while `catalog` is `null` and its last read failed |
| `wardens: CerberusWardens \| null` | where the wardens stand against the release on offer (`useWardensRead`), read with the overview and again on every `cerberus_changed`; `null` until a read answers, kept over a failed one. The header's update button and the Update wardens dialog both draw from it |
| `startUpdate(nodes)` | `Promise<{ batch, updates } \| null>`: `POST /api/cerberus/updates` through `api.cerberus.startUpdate`, one at a time (`writeOnce`). The answer is the batch and its updates as they stood, after the re-read; `null` = refused (409 `CERBERUS_UPDATE_RUNNING`: a batch is already going; 409 `CERBERUS_NO_RELEASE`), the warn toast with the server's sentence already raised and the wardens read again so a batch started elsewhere shows; also `null`, with no toast, when the start landed and its 200 answer cannot be read (a body that is not JSON, or not a batch): `response.ok` is the verdict, and the dialog follows the batch through `wardens.running`, which the re-read after every landed write brings |
| `diagnose(node, key)`, `runProposal(id)`, `promote(id, input)` | `Promise<boolean>`, built by `useDiagnosisVerbs` (MAN-7945) over the provider's `writeOnce` and `settleWrite`, so a landed write has re-read the fleet before it answers and a refused one has raised the warn toast with the server's sentence: `diagnose` is `POST /api/cerberus/diagnoses { node, check: key }` and sends no model, silent when it lands; `runProposal` is `POST …/:id/run`, silent when it lands; `promote` is `POST …/:id/promote` with a `CerberusPromoteInput` and raises the toast `promote.toast.*` ("Added to the catalog" · "<name> · auto-run off", the name from the entry the server wrote) when it lands |
| `refresh(): Promise<boolean>` | one read of the overview, and the catalog and the wardens started beside it and not waited for (a write's verdict never waits out a hung read of either); resolves when the overview has answered or failed, with whether it answered; the Try again press; never rejects |
| `mute(input)`, `liftMute(id)`, `setLabel(input)`, `runEntry(id, onStarted?)`, `setAuto(id, on)` | `Promise<boolean>`: `true` = landed and the overview already re-read (or, when that read failed, being read again — see `settleWrite`); `false` = refused or no answer, the warn toast already raised. `runEntry`'s `onStarted(runId)` is called with the run the press started, as soon as the answer names it and before the re-read (the check sheet pins its Fix output to it); not called when the answer cannot be read, nor for a second press that joins the first's write |
| `starting: readonly string[]` | the entries whose Run press is out: `POST /catalog/:id/run` answers once the warden has accepted (up to 10 s). Every Run now of each reads "Running…" for the wait; an entry leaves when its press settles, after the re-read that holds the run, and a press on another entry meanwhile does not take its label back |
| `setProjectNode(project, node)` | `Promise<'moved' \| 'refused' \| 'failed'>`: `PUT /api/projects/:projectId/node` through `api.projects.setNode` (`node` the node's id, or `null` for this server). `moved` = landed, the overview already re-read, and the toast `node.projects.toast.here` (its message `hereWaiting` while the node's `link` is not `reporting`) or `toast.back` raised; `refused` = 409 `PROJECT_NODE_NOT_COLOCATED`, no toast (`NodeProjects`' banner says it); `failed` = any other refusal or no answer, the warn toast already raised. One write per project at a time |

- The verbs keep one identity for the app's life; the translator is read through `tRef` (`useLayoutEffect`), never in a verb's deps.
- A failed read over a held overview keeps it and raises no toast: `unreachable` never rises over one. `stale` rises when that failure finds the overview answered over 90 s before, and the root then draws its "last answer" banner and the header's pill stops saying Live (MAN-7891). It is judged at each failed read, never on a timer, so one dropped poll never flaps it. Every read carries a 30 s deadline of its own (`REQUEST_TIMEOUT_MS` as an `AbortController` timer in `refresh`, passed to `api.cerberus.overview({ signal })`, so a platform without `AbortSignal.timeout` is covered), so a read left hanging fails and is judged rather than keeping the picture fresh.

## Reads
| trigger | rule |
|---|---|
| mount | one read, after the subscription |
| `cerberus_changed` | at most one read per 1 s (`FRAME_READ_GAP_MS`); frames inside the gap queue ONE trailing read |
| `cerberus_changed` with `updates: true` | read at once, never held to the gap (`readForUpdateFrame`): the overview and the wardens only, one read at a time, and frames that land while it is out ask for ONE more when it answers, so a burst of an update's steps costs two reads. why: an update is over in about 0.4 s, so a read held for the gap finds it ended |
| `websocket_reconnected` | read at once, unthrottled |
| clock | every 30 s (`CLOCK_READ_MS`): cells slide, "ago" ages, a check goes stale with no row written |
| own landed write | the re-read, before the verb answers |

- A read is good when `response.ok` and the body has a `nodes` array and a `counts` object. Anything else, or a throw, keeps the overview. A good body is read as the newer client wants it (`withFixFields`): `running` as none and each need's `fix` and `run` as null where an older server left them out.
- Each read takes a ticket (`newestReadRef`); a good answer older than the newest applied (`newestAnswerRef`) is dropped. A failed read judges before the mark and never moves it, so an older good read still in flight can land.

## Writes
- One in flight per target: `mute:<node>/<key>`, `lift:<id>`, `label:<node>/<key or service>`, `project-node:<projectId>`, `run:<entry>`, `auto:<entry>`. A second press returns the first's promise.
- `settleWrite(request, saysOwnRefusal?)` is the one place a write settles; `sendWrite` flattens it to a boolean. Verdict is `response.ok`: the body is not read for it. The screen comes from the re-read. A caller that says one refusal in words of its own passes `saysOwnRefusal`: `setProjectNode` passes `isNotColocatedRefusal` (409 and `refusalCode(response) === 'PROJECT_NODE_NOT_COLOCATED'`), which settles as `refused` with no toast; every other refusal is `failed`.
- `landed` follows `refresh()`, which never rejects. A write whose re-read failed still answers landed, at once (its verdict never waits out a second read), and `rereadAfterWrite` reads the overview again after 1 s and after 4 s until a read taken after the write has been applied — its own, a frame's or the clock's — so the screen catches up in seconds, not at the next 30 s clock read. Measured 2026-10-07 on the real provider with the API answered by routes: the re-read failing once, the new fleet on screen 1.02 s after the press; failing twice, 5.02 s (`.verify/cerberus-write-reread.mjs`).
- Refused or no answer: one `warn` toast, title `cerberus.errors.writeFailed`, message = `refusalSentence(response)` (the server's own sentence), omitted when none. Not raised after unmount.
- Speaks on success: the mute and `setProjectNode`. A lift, a label, a run (the card's strip is the proof) and an auto-run switch (the switch and its line are) are silent. A refused run (409 `CERBERUS_RUN_ACTIVE` — the check already has a run going —, `CERBERUS_NODE_SILENT` or `CERBERUS_NODE_UPDATING`) and a refused switch (a capped entry) raise the write's warn toast with the server's sentence.
  - Mute: `positive` toast, `cerberus.mute.toast.title` (`time` = `hm(until)`), `cerberus.mute.toast.message` (`label` = the check's plain name, else its key).
  - `setProjectNode` to a node: `positive` toast `cerberus.node.projects.toast.here` (`name` = the project's name as `NodeProjects` drew it, `node`); while that node's `link` is not `reporting`, its message is `toast.hereWaiting`. Back to this server: `toast.back` (`name`).

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/App.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/context/CerberusContext.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/context/CerberusProvider.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useCheckDetail.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/cerberusTime.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## MAN-7918 — Cerberus — the client: `CerberusProvider`, `useCerberusNeeds`, `useCheckDetail` — `useCheckDetail({ node, service, id, lookupAt?, end? })`
section: Cerberus — the client: `CerberusProvider`, `useCerberusNeeds`, `useCheckDetail`, `api.cerberus`, `cerberusTime`/002 `useCheckDetail({ node, service, id, lookupAt?, end? })`

Answers `{ detail, loading, error, refresh }` from `GET /api/cerberus/checks/:node/:service/:id?lookup&end` (MAN-7802).

| field | meaning |
|---|---|
| `detail` | `null` until a read for THIS check answered; an answer for another check is never shown |
| `loading` | `detail === null` and no `error` |
| `error` | `'gone'` (404: retired while open) or `'unreachable'` (network, 5xx, a body that is not a check detail); `null` otherwise |
| `refresh()` | one read |

- Re-reads: a `cerberus_changed` whose `checks` includes `<node>/<service>/<id>` (compared whole, never split), `websocket_reconnected`, every 30 s.
- A change of `lookupAt`, `end` or the check is a new read; the previous answer of the same check stays on screen until it lands.
- A read takes a ticket and the question it was made for (`readKey`: the check, `lookupAt`, `end`), and an outcome for any question but the one asked now is dropped on arrival: a read that left for the row or the time just left says nothing about the one on screen (a late 500 of the row just left never replaces the failure of the row now shown; a good answer for another moment never lands over a failed read of the moment now typed). Within the question asked now the provider's rule holds: a good answer lands when its ticket is newer than the newest good one applied (`newestAnswerRef`) and clears `error`; a failed read never moves that mark, and is published only while no newer good answer stands and no newer failure has been said (`newestFailureRef`), so a failed newer read never throws away a good older one still in flight, and a slow 500 never turns a newer 404 into "can't be reached". A failure keeps the last good `detail` of the same check beside `error`.
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
| `catalog({ signal? })` | `GET /api/cerberus/catalog` |
| `writeEntry(input)` | `POST /api/cerberus/catalog` (no screen calls it; the seeds go through it; the Promote dialog writes its entry through `promote`) |
| `setAuto(id, on)` | `PUT /api/cerberus/catalog/:id/auto` |
| `runEntry(id)` | `POST /api/cerberus/catalog/:id/run` → `{ runId }`, up to 10 s after the press; the provider reads the `runId` only for a `runEntry` given an `onStarted` |
| `run(id)` | `GET /api/cerberus/runs/:id`: the run with every line it holds |
| `wardens({ signal? })` | `GET /api/cerberus/wardens` → `CerberusWardens`; the provider brings its own deadline |
| `startUpdate(nodes)` | `POST /api/cerberus/updates { nodes }` → `{ batch, updates }`; 409 `CERBERUS_UPDATE_RUNNING` while a batch runs |
| `updateBatch(batch, { signal? })` | `GET /api/cerberus/updates/:batch` → the batch's `CerberusUpdateView[]`, every step with its time; `useUpdateBatch` reads it 2 s after each answer while the dialog is open |
| `diagnose({ node, check, model? })` | `POST /api/cerberus/diagnoses` → `{ id }`; 409 `CERBERUS_DIAG_RUNNING` while the check has a diagnosis going. The tab sends no `model` |
| `diagnosis(id, { signal? })` | `GET /api/cerberus/diagnoses/:id` → `CerberusDiagnosisView` with every step and its run's lines; `useDiagnosis` reads it |
| `runProposal(id)` | `POST /api/cerberus/diagnoses/:id/run` → `{ runId }`; 409 with no proposal or once its one-off expired; never touches the catalog |
| `promote(id, input)` | `POST /api/cerberus/diagnoses/:id/promote { name, auto, limit }` → the new `CerberusCatalogEntryView`; the one write that does touch the catalog |

- Reads answer their wire shape bare; a refusal is the app's `{ success: false, error }` envelope. Nobody draws from a write's answer.
- `refusalSentence(response)`: the server's own sentence from a refusal body (`errorMessage(error) ?? errorMessage(details)`), `null` when none or not JSON. One copy, shared by `NotesProvider` and `CerberusProvider`. `refusalCode(response)`: the body's `error.code`, `null` when none or not JSON; it reads a clone, so the sentence can still be read after it. `settleWrite` in the provider is the one write path: it answers `landed`, `failed`, or `refused` for a caller that says one refusal in words of its own (`sendWrite` is it flattened to a boolean).

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/App.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/context/CerberusContext.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/context/CerberusProvider.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useCheckDetail.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/cerberusTime.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## MAN-7919 — Cerberus — the client: `CerberusProvider`, `useCerberusNeeds`, `useCheckDetail` — `cerberusTime.ts`
section: Cerberus — the client: `CerberusProvider`, `useCerberusNeeds`, `useCheckDetail`, `api.cerberus`, `cerberusTime`/003 `cerberusTime.ts`

Pure: no `t`, no `Date.now()`. Local time, 24-hour, written by hand so every browser locale reads alike. Every time the tab shows or writes for a reader is local; a stamp a machine also reads (a `<time dateTime>`, a date handed to a formatter) carries its offset and never a `Z`: `localIso`, which has the warden's `localIso` shape (MAN-7950). Nothing under `src/modules/cerberus` writes a UTC `Z` stamp.
| function | answers |
|---|---|
| `hm(ms)` | `08:05` |
| `hms(ms)` | `08:05:09` |
| `dateOf(ms)` | `2026-10-05`: the digits a date input holds |
| `dayAndTime(ms)` | `2026-10-05 08:05` |
| `localIso(ms)` | `2026-10-07T08:59:32.469-07:00`: the moment as an ISO stamp in local time with the offset it had at that moment; `RecordedResults`' `<time dateTime>` takes it |
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
| `src/modules/cerberus/utils/cerberusStatus.ts` | `STATUS_TABLE`: the one owner of a status's tone, icon, word key and cell shape; `activityEvents.ts` and the marks read it: MAN-7873 |

## Functions — `fleetModel.ts`
| function | answers |
|---|---|
| `fleetItems(overview)` | one `FleetItem` per node, worst first: `STATUS_RANK`, then the hub ahead of its peers, then id with numeric collation (`node-2` before `node-10`) |
| `runOnService(running, node, service)` | the oldest run of `overview.running` on one of the service's checks, or `null`: that service is `fixing` |
| `groupOf(status)` | the `FleetGroup` bucket |
| `filterGroups(items)` | all six `FleetFilterGroup`s in order `all needs unknown muted updating empty`, zero counts included; counted over the WHOLE fleet; hiding an empty group is the toolbar's call |
| `applyFilter(items, group, query)` | items in one filter, narrowed by `query` (trimmed, case aside, substring of `item.search`); blank query narrows nothing; keeps the caller's order, so pass `fleetItems` output |
| `defaultExpanded(items)` | `Set<string>` of ids in group `needs`; empty when the fleet has more than 12 nodes; pass the WHOLE fleet, never a filtered list |
| `ringsLayout(items, width, height)` | `RingsLayout` in pixels from the box's top-left |

## Node status rules
- `STATUS_RANK` (smaller = worse): `failing`/`denied` 0, `fixing` 1, `warn` 2, `unknown` 3, `paused`/`updating`/`enrolling` 4, `muted` 5, `ok` 6, `empty` 7.
- A node's status = the worst of its services'; no service = `empty`.
- A `not_enabled` service counts as `ok` at the node level; its own row still says what it is.
- `denied` outranks `failing` when a node has both.
- `fixing` is fed from `overview.running`: a service with a run going on one of its checks (`runOnService`) is `fixing`, whatever its own word is, and a node reads the worst of its services' words. A node whose only trouble is being fixed is `fixing`; one with another service still `failing` stays `failing`, since that one needs you. `enrolling` is in the type and the rank; nothing produces it yet.
- `updating` and `paused` are fed from the node itself (`nodeStatusOf`): a node with `link === 'paused'` (its warden restarting for an update) starts from `paused`, one with `updating` set (an update queued or running) from `updating`, instead of `ok` — so it is under Updating even when every check is passing, and even with no service, which would read `empty`. A worse word still wins: a failing check on a node that is updating still needs you.
- `groupOf`: `failing denied fixing warn` → `needs`; `paused updating enrolling` → `updating`; every other status is its own group. `ok` is counted by the status bar; no filter button selects it.
- `FleetItem` carries `id desc role link status fixBy services search` only; `link` is typed `CerberusNodeView['link']` (`reporting`, `silent`, `never`, `paused`), so it follows that union (`fixBy` is who started the node's run, `auto` or `you`, while its `status` is `fixing`, else `null`). Minute cells, warden version and last-heard time stay on `CerberusNodeView`, found by `id`.
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
- `fix` and `catalog` are live: `fixEvent` (started: "Ran on its own: “X”" / "You ran “X”", info; ended: "“X” finished · Succeeded in 12 s" / "· Failed" / "· Timed out" in the result's tone, "The warden refused “X”" in the refusal's red; the line carries the result and the seconds, not the exit) and `catalogEvent` ("Added “X”" positive, "Auto-run on · “X”" / "Auto-run off · “X”" neutral; no node or check). `diagnosisEvent` is live too: asked ("You asked for a diagnosis" · "<label> · read-only", info), ready ("Diagnosis ready" · its summary, neutral: a document, not a health signal), failed ("Diagnosis failed" · the sentence that says why, the warn of a failed run). `wardenEvent` is live too (source `activity.source.warden`, words `activity.warden.*`; MAN-7933 says when center writes each): `update_started` ("You started a warden update to <to>", info, no node; summary "<n> nodes · one at a time" when `nodes` is present), `updated` ("Warden on <node> updated to <to> · <from> kept for rollback", positive; no tail when `from` is null or equals `to`, since nothing was swapped), `rolled_back` ("Warden on <node> rolled back to <from>", warn; "rolled back" alone when `from` is null), `update_failed` ("Warden on <node> could not update to <to>", warn). A new kind adds a case to the switch, a builder, and words under `cerberus.activity`.

## Callers must
- Guard `overview.lastResultAt` for null before `agoParts` (it takes a number).
- Map `agoParts`' unit to a `cerberus.time.*Ago` key; there is no shared "12 s ago" helper yet.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/fleetModel.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/activityEvents.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## MAN-7873 — Cerberus — the tab's status marks and the check sheet's pieces: `STATUS_TABLE`, `StatusGlyph` `StatusCell` `StatusSquare` `StatusPill`, `MinuteCells`, `LookupMoment`, `RecordedResults`

The Cerberus tab's drawing vocabulary and the check sheet's three pieces. Pure of data: each takes its read model from the caller. Spec: `design/cerberus/Cerberus Spec.dc.html`, Table 1. Client reader: MAN-7871. Pure fleet model: MAN-7872. Words: MAN-7870. Wire shapes: MAN-7807. Colour rules: MAN-739 (rules 3–5), MAN-578.

## Files
| file | holds |
|---|---|
| `src/modules/cerberus/utils/cerberusStatus.ts` | `STATUS_TABLE`; `RUN_LOOK`, `FLEET_FIXING_LOOK`; `markLook(mark)`, the look a mark paints from (`STATUS_TABLE`'s row, or `FLEET_FIXING_LOOK` for `fixing`); `nodeMark(status)`, the mark a node's word draws with (`null` for `empty`, `enrolling`; `fixing` for `updating`), read by the node card and the rings |
| `src/modules/cerberus/StatusMarks.tsx` | `MarkIcon`; `StatusGlyph`, `StatusCell`, `StatusSquare`, `StatusPill` (each takes a `CerberusMark`: a status, or `fixing`) |
| `src/modules/cerberus/sheet/MinuteCells.tsx` | `MinuteCells` |
| `src/modules/cerberus/sheet/LookupMoment.tsx` | `LookupMoment`, `LookupSentence`, `SentenceRow` |
| `src/modules/cerberus/sheet/RecordedResults.tsx` | `RecordedResults` |
| `src/shared/types.ts` § CERBERUS STATUS VOCABULARY | `CerberusCellShape` |

No file outside the module imports the marks or the sheet pieces. Inside it, `sheet/CheckSheet.tsx` composes `MinuteCells`, `LookupMoment` and `RecordedResults` (MAN-7878) and `history/LookupCard.tsx` composes `LookupSentence`, `SentenceRow`, `MinuteCells` and `RecordedResults` (MAN-7877).

## `STATUS_TABLE` — the one owner
`Record<CerberusStatus, { tone, icon, wordKey, cell }>`. `icon` is a lucide `LucideIcon`. Nothing else in the tab decides a status's tone, icon or shape; a view reads it here. `activityEvents.ts` reads it too (MAN-7872).

| status | tone | icon | cell |
|---|---|---|---|
| `ok` | positive | `CircleCheck` | `soft` |
| `warn` | warn | `TriangleAlert` | `outline` |
| `failing` | warn | `OctagonAlert` | `solid` |
| `denied` | danger | `OctagonX` | `solid` |
| `not_enabled` | neutral | `CircleDashed` | `flat` |
| `unknown` | neutral | `Clock` | `dashed` |
| `muted` | neutral | `BellOff` | `surface` |
| `paused` | neutral | `CirclePause` | `dashed` |

- `wordKey` = `cerberus.status.<status>` (MAN-7870).
- `denied` is the only red; a sixth tone for it is refused (MAN-739 rule 4).
- The three that need you differ by outline alone (crossed octagon, octagon with `!`, triangle with `!`); measured at 8× zoom.
- `unknown` and `paused` draw the same tone and cell: no reading either way. Where a mark has room the icon says why (`Clock`, `CirclePause`); the word always does.
- `not_enabled` never needs you.

## `RUN_LOOK` and `FLEET_FIXING_LOOK` — a fix's look
`RUN_LOOK: Record<'going' | 'ok' | 'failed' | 'timed_out' | 'refused', { tone, icon }>`: how a fix's run is drawn. A run wears the icon of the status it reads like (`ok`, `warn`, `denied`). A refusal is a run's outcome, never a check's status, so it is no row of `STATUS_TABLE`.

| run | tone | icon |
|---|---|---|
| `going` | info | `Wrench` |
| `ok` | positive | `CircleCheck` |
| `failed`, `timed_out` | warn | `TriangleAlert` |
| `refused` | danger | `OctagonX` |

- Read by `fleet/NeedFix.tsx` (the strip; a run that succeeded takes the icon but a neutral tone) and `sheet/FixOutput.tsx` (the pill): MAN-7906; and by `sheet/DiagnosisPanel.tsx` (its Failed pill, and its one-off's ran line in the result's ink): MAN-7932. Each draws the icon through `MarkIcon` (MAN-7874).
- `FLEET_FIXING_LOOK: { tone, icon, cell, wordKey, glyphMotion }` = `RUN_LOOK.going`'s tone and icon (`Wrench`), cell `solid`, `cerberus.fix.fleet.running`, `glyphMotion` `vv-pulse` 1.4 s: how the fleet draws a node or service with a fix running (`fixing`), through `markLook`; the glyph, the pill's wrench and the ring dot pulse in place of the failing ring. The `solid` cell makes every paint map keyed by shape draw it as the prototype does: the tile edged 1.5 px in the info dot, ring dot and service square filled.
- `fixing` is fed from `overview.running` (`fleetModel.runOnService`) and drawn by `NodeGlyph`, the tile's edge, the rings' dot, hub and label icon and panel (`nodeMark` → `markLook`), `nodeLine` ("Fix running on its own" / "Fix running" by `FleetItem.fixBy`), the service row's pill and the collapsed card's squares (`serviceSentence(t, service, run)`), and the rings' key row. An `updating` node draws the same wrench and shares the rings' key row ("Fix running or updating"); `enrolling` shares it too.

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
| `MarkIcon` | `icon` (a `LucideIcon` from a look), `className` | the icon, `aria-hidden`, `strokeWidth` 2.25, `flex-none`; the caller gives size, flow and motion |
| `StatusGlyph` | `status` (a `CerberusMark`: a status, or `fixing`, the info wrench that pulses), `size` `sm`\|`md`\|`lg` (rounds of 20, 24, 32 px holding icons of 12, 14, 18 px; default `md`), `decorative`, `still` | round glyph holding the table's icon in the tone's ink on its wash |
| `StatusCell` | `status`, `label`, any span attribute | one minute; the caller gives size, flow and role |
| `StatusSquare` | `status`, `label` | 10 px square in the cell's shape, with `title` |
| `StatusPill` | `status`, `text` | `Badge` (`tone`) holding a 14 px icon then word or `text`; `text` is cut with an ellipsis |

- `StatusGlyph` names its word as `role="img"` + `aria-label` + `title`; `decorative` replaces that with `aria-hidden` (the word is written beside it).
- `StatusGlyph` rings only for `failing` and not `still`. A lookup's glyph is `still`: the ring means needs you NOW, and a looked-up moment may be long past.
- `MarkIcon` is the one way the module draws a look's icon: the rings' hub and labels, a Needs-you card's run strip, Fix output's pill and the diagnosis panel's Failed pill use it too. Stroke 2.25 is the one that still reads at 12 px. No mark draws a status as a text character.
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
| `chosen` | `<node>/<key>`, `null` at first. Set ONCE, during render, when the index has a check and the overview has answered (or failed): the check that has needed you longest (the oldest `since` among `overview.needsYou`, then key, then node: the overview lists them worst first, so `firstChoice` picks it), else `checks[0]`. A later read never moves it |
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

The check sheet on the library's `Sheet`: one service's checks and one of them in full. `CheckSheet.tsx` reads the fleet from `useCerberus()` and the check from `useCheckDetail`, and wires every press: the other three files draw what they are handed and read nothing. Marks and pieces it composes: MAN-7873. Banner: MAN-7877 (`UnreachableBanner`). Time words: MAN-7871. Words: MAN-7870 (`cerberus.sheet.*`, `cerberus.errors.lastAnswer`). Design: `design/cerberus/Cerberus Tab.dc.html` :393-537; the fixes' pieces: MAN-7906; the diagnosis's: MAN-7932. `CerberusPanel` (MAN-7891) mounts it, opened from a Fleet minute, a service row or a Needs-you card.

## Files
| file | holds |
|---|---|
| `src/modules/cerberus/sheet/CheckSheet.tsx` | `CheckSheet({ open, onClose, node, service, check, lookupAt?, onMute })`: the container; `CheckSheetBody`, `SheetSection`, `ReadingPlaceholder` |
| `src/modules/cerberus/sheet/CheckRows.tsx` | `CheckRows({ checks, selectedKey, serviceName, onSelect })` |
| `src/modules/cerberus/sheet/SelectedCheck.tsx` | `SelectedCheck({ check, editor, onName, onMute, onUnmute })` |
| `src/modules/cerberus/sheet/CheckLabelEditor.tsx` | `CheckLabelEditor({ value, onSave, onCancel, busy })` |

## `CheckSheet` — layout and reads
- Props: `node` (`eis1`, or `center`), `service` (id), `check` (id within the service: the key after the first `/`), `lookupAt?` (epoch ms; omitted = now), `onMute(check)`: the root opens its Mute dialog in front of the sheet.
- Title: the service's label, else its id. Under it, top to bottom: raw line (`sheet.raw`; `sheet.rawHub` when the node's `wardenVersion` is null), `CheckRows`, `SelectedCheck`, Fix output (`FixOutput`), `DiagnosisPanel` (while the check has a diagnosis, keyed by its id: MAN-7932), "Fixes in the catalog" (`CheckFixes`), then the check's own sections. Fix output shows, in this order: the run the last Run now pressed in this sheet started (`startedRuns`, by check id, from the press's own answer through `runEntry`'s `onStarted`; it holds when a newer run of the check begins); else the run the sheet was opened on (a Needs-you card's strip hands its id as `run`), whatever newer run the check's read names, so opening an older run never lands on a newer one, and a sibling check has no opened run; else the check's newest run within the hour (`detail.run`). A run of the shown diagnosis's proposal is left out of Fix output: the panel draws it under its proposal, so it is never drawn twice. With neither, no Fix output; "Fixes in the catalog" waits for the check's read.
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

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/CheckLabelEditor.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/CheckRows.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/CheckSheet.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/SelectedCheck.tsx

## MAN-7907 — Cerberus — the check sheet: `CheckSheet`, `CheckRows`, `SelectedCheck` — What `CheckSheet.tsx` reads, holds and writes
section: Cerberus — the check sheet: `CheckSheet`, `CheckRows`, `SelectedCheck`, `CheckLabelEditor`/001 What `CheckSheet.tsx` reads, holds and writes

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
| `diagnosis` | `detail?.diagnosis ?? null`, the check's newest diagnosis (`?? null`: an older server's answer has none): `SelectedCheck`'s Diagnose / Diagnose again, and `DiagnosisPanel` keyed by its id |
| `heldByOther` | the check's going run (`detail.run`) is not this diagnosis's own one-off: `DiagnosisPanel`'s `held`, which disables Run it once as `CheckFixes` holds its entries |
| `startedRuns` | state: the run each Run now pressed in this sheet started, by the id of the check it was pressed on (`CheckFixes`' `onRunStarted`, then the check is read again). Fix output shows it before the run the sheet opened on and before the check's newest |
| `outputRunId` | the run Fix output shows, in this order: the run the last Run now pressed on the shown check started (`startedRuns`); else the run the sheet was opened on (the `run` prop, for the check it opened on only), whatever newer run the check's read names, so opening an older run from What happened never lands on a newer one; with neither, the check's newest run within the hour (`detail.run`). No run, no Fix output. Except the run that is `diagnosis.run`: the panel draws that under its proposal |
| `onDiagnosisStarted` | `useCheckDetail`'s `refresh`, handed to `SelectedCheck`: Diagnose reads the check again when a diagnosis lands, and stays busy until that read has settled |
| `onPromote` | the root's `onPromote(diagnosis, shown)`: Add to catalog opens the Promote dialog in front of the sheet, as `onMute` does Mute |
| `onPick` | the lookup to the moment the pressed minute's word was reached (`cell.at`), or back to live for the newest cell, which is the minute still running (the read sends no `end`). Judged by place on the strip, never by the browser's clock; `typedTime` clears and the input follows the read |
| `onTimeChange` | holds the text; a whole time (`isWholeTime`) moves the lookup to that second today, local (`todayAt`) |

## `CheckRows`
- `ul` with `aria-label` `sheet.checksOf` (`service` = the title); one `button` per check: `StatusGlyph`, label over `check.id` (the id alone, mono, with no label), then `value`.
- The `ul` is capped at `max-h-[min(260px,32dvh)]` and scrolls itself. why: a service can hold 75 checks, and an uncapped list put the selected check and its 60 minutes 4,300 to 6,400 px down a body 780 to 835 px tall (measured 2026-10-06). On mount and when `selectedKey` changes, `useRowInView` centres the marked row if it is not fully in view; it sets the box's `scrollTop`, never `scrollIntoView`, which would scroll the sheet's body too. A row pressed fully in view stays put; one half in view is centred.
- The shown row is marked three ways (MAN-578): `bg-background`, a 3 px accent rule on its left edge, `aria-current`.
- Accessible name reads the status word first (the glyph names it). The glyph rings while failing.
- `value`: right-aligned, up to 45% of the row from `sm`; under the label on a phone.
- A row leans 3 px right under the pointer, `motion-safe`; its ground changes at once (MAN-739 rule 5). The focus ring is drawn inside the row (`outline-offset:-2px`): the box clips anything outside.
- `selectedKey` is `<service>/<id>`; `onSelect` hands the pressed `CerberusCheckView`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/CheckLabelEditor.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/CheckRows.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/CheckSheet.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/SelectedCheck.tsx

## MAN-7908 — Cerberus — the check sheet: `CheckSheet`, `CheckRows`, `SelectedCheck` — `SelectedCheck`
section: Cerberus — the check sheet: `CheckSheet`, `CheckRows`, `SelectedCheck`, `CheckLabelEditor`/002 `SelectedCheck`

- Head, in wrap order: name (`h3`: the label in the serif face, else the key in mono), `StatusPill`, then the naming action. The action wraps first on a phone, never the status.
- Naming action: ghost `sheet.nameThis` + pencil for a check with no label; a ghost icon button (✎, `sheet.rename`) beside a label. It is hidden while the editor is open.
- `editor` (an element or `null`) takes the name's place while open; the status pill stays.
- Then `check.value`; "Checked `hms(at)` · every `stretchKey(every)` · by …" (`sheet.checked`; `sheet.checkedHub` when `origin === 'self'`; `sheet.notChecked` / `notCheckedHub` while `at` is null); then the raw key, when the check has a label or the editor is open.
- Action row: `DiagnoseButton` (outline, `diagnosis.diagnose`; `diagnosis.again` once the check has a diagnosis; not drawn while one runs, nor until the check's own read has answered, since until then nobody knows which word is true), then `sheet.mute` (ghost) while `check.mute` is null, else a neutral `Badge` holding `sheet.muteNote` (`hm(mute.until)`, `reason`) in full, wrapping, and `sheet.unmute`.
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
| `serviceSentence(t, service, run?)` | a run going on one of its checks | `fix.fleet.runningAuto` / `fix.fleet.running`, by `run.by` |
| | one check needs you | `service.oneBad` |
| | several | `service.needYou_*` |
| | `unknown`, all checks | `service.noResult_*`; some: `service.someNoResult` |
| | `paused` | `service.paused` |
| | `muted` | `service.someMuted` |
| | `not_enabled` | the status word |
| | `ok` | `service.allPassing_*` |
| `nodeLine(t, item, node)` | no services | `node.waiting` (`link === 'never'`), `node.restarting` (`link === 'paused'`), `node.updatingWarden` (`updating` set), else `node.nothingAssigned` |
| | `paused` / `updating` / `muted` / `ok` | `node.restarting` / `node.updatingWarden` / `node.mutedCheck` / `node.allPassing_*` |
| | `failing denied warn unknown` | `node.bad`: the first service at that word |
| | `fixing` | `fix.fleet.runningAuto` / `fix.fleet.running`, by `item.fixBy` |
| | `enrolling empty` | `node.nothingAssigned` |
| `isRestarting(node)` | `link === 'paused'` | true; the heartbeat dot also reads it |
| `sessionsTail(t, node)` | `link !== 'reporting'` or `sessions` not a positive count (missing included: an older API answering a newer client) | `null`: a silent warden's last list is a count nobody has confirmed since; the hub has none |
| | otherwise | ` ·\u00a0` + `node.sessions_*` (`count`): the tail of a warden line drawn as words, after `wardenLine`, in its run of text. The no-break spaces keep the dot with the phrase and the phrase whole |
| `wardenLine(t, node, now)` | hub | `node.hub` |
| | `isRestarting(node)` (`link === 'paused'`) | `node.wardenRestarting` (the read model lays `paused` over `silent` and `never`) |
| | `link === 'never'` or no `lastHeardAt` | `node.waiting` |
| | `link === 'silent'` | `node.silent`, `time` = `hm(silentSince ?? lastHeardAt)` |
| | else | `node.heard`, `ago` against `now` |

- A restart is `link === 'paused'`, which outranks silence for as long as the update runs; when the update fails the node reads silent, and that is the thing to see.
- A switched-off service counts as passing for the node.
- `serviceSentence` also names a service's square in a collapsed card (`node.squareTip`).
- The service's folded status picks the case, so the pill's icon and words never disagree.

## `NeedsYouCard`
`NeedsYouCard({ needs, muted, counts, now, onOpen, onMute })`.
- Cards in the read model's order, kept as sent (`needsYouOrder`, MAN-7808: worst first — refused, failing, close to the limit — then oldest `since`); each: round glyph (the status's icon), label (else key in mono) and `needs.word`, where and since (`needs.where`, `needs.whereNoSince`), the raw key, the value cut at two lines (`title` carries the whole), Mute.
- Severity on the card, all from `STATUS_TABLE` (MAN-7873): the `<li>` carries `data-tone`; a 4 px `bg-tone-dot` bar runs down its left edge (`absolute inset-y-0 left-0 w-1`). A status whose cell is `solid` (failing, refused) also tints the head row with `bg-tone-soft`; `warn` keeps the bar only.
- Under the tint the "where" line is `text-secondary-foreground` and the raw key `text-muted-foreground`, each one ink darker than on a plain card. why: on the light refused tint they measured 4.43:1 and 2.92:1; one step up, 7.46:1 and 4.43:1.
- Quiet (`needs` empty): `needs.quiet` and `needs.quietPassing_*`.
- No cap on the cards: with dozens, the fleet drops below the fold. 2026-10-06: 19 cards stood 3,925 px tall on a phone and 1,117 px at 1440.
- Muted list while any mute is set: `needs.mutedTitle`, `needs.mutedItem`, `needs.mutedMeta` (`hm(until)`, minutes left from `now`, reason), Unmute.
- A card that stops needing you leaves on `vv-toast-out` over 0.55 s (`leaving`); with motion reduced it is gone.

## `FleetStatusBar` and `FleetLegend`
- `FleetStatusBar({ groups, listed, drawn })` counts from `groups`: passing = All less the rest. Left words join the non-zero groups with ` · `; right note is `fleet.nodes_*`, or `fleet.showing` when the page is shorter than the list. The bar is `aria-hidden`.
- The bar's `ok`, `needs`, `muted` and `unknown` segments are `StatusCell`s of the statuses `ok`, `warn`, `muted` and `unknown`, so the status table (`STATUS_TABLE`) alone decides their tone and shape and the bar cannot disagree with the cells or the legend; `SEGMENTS` names a status for them and carries no paint. The `needs` bucket (`groupOf`) holds `failing`, `denied`, a fix running and `warn` alike, and the bar draws all of them as `warn`'s outline, the look the legend calls "Close to the limit": the bar says how many nodes need a look, the cards and the legend say which kind. A lone `needs` node at fleet scale (one in 500) is the 4 px minimum segment with a 2 px interior, told apart by its amber edge. `updating` (the info dot) and `empty` (a dashed box) are fleet words with no status behind them and keep their own paint.
- `FleetLegend()` draws one `StatusCell` per status in `ok warn failing denied muted unknown not_enabled`; no result also stands for paused. Refused and Not enabled are there because both appear in real strips.

## `FleetToolbar`
- `FleetToolbar({ layout, groups, filter, query, folds, onLayout, onFilter, onQuery, onExpandAll, onCollapseAll })`.
- A filter is offered only when its count is above zero, or it is chosen, or it is All; counts are the whole fleet's, so a search never changes a chip.
- Expand all / Collapse all show only when `folds` (`!narrow && layout !== 'rings'`).

## The card's fix, its diagnosis and the quiet line
- The card's action row is `NeedFix` (the run strip on a line of its own, then Run “<fix>”), then Diagnose (outline): `DiagnoseButton` while `need.diagnosis` is null, whose press opens the sheet on the check, where the steps arrive; "Diagnosing…" while the need's diagnosis runs and "See diagnosis" once it ended, both opening the sheet; then Mute. `NeedCard` takes the whole `need`, and `useLeavingNeeds` keeps the whole need of a card that is leaving, so it keeps its strip while it fades.
- The quiet line ends with `cerberus.fix.quiet` ("Fixes set to auto-run will run on their own and show up below."), after a space, while any catalog entry is set to run on its own (`catalog.some(entry => entry.auto)`). `NeedFix`: MAN-7906.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/FleetStatusBar.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/FleetToolbar.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/NeedsYouCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/fleetWords.ts

## MAN-7880 — Cerberus — the Fleet view: `FleetView`, `NodeCard`, `ServiceRow`, `FleetGrid`, `FleetList`, `WhatHappenedCard`

The Cerberus tab's Fleet view, live: its reads are `useCerberus()` and the pure fleet model, its choices component state, its two presses the props `onOpenCell` and `onMute`. Sentences, Needs-you card, status bar, legend, toolbar: MAN-7879. Pure model: MAN-7872. Marks and strips: MAN-7873. Check sheet it opens: MAN-7878. Words: MAN-7870. Client reader: MAN-7871. `CerberusPanel` mounts it (MAN-7891), the workspace's Cerberus tab.

## Files
| file | holds |
|---|---|
| `src/modules/cerberus/fleet/FleetView.tsx` | `FleetView({ overview, narrow, onOpenCell, onMute })`: the container; layout, filter, search, open nodes and page |
| `src/modules/cerberus/fleet/FleetGrid.tsx` | `FleetGrid({ entries, moreCount, now, onToggle, onOpenCell, onShowMore })` |
| `src/modules/cerberus/fleet/FleetList.tsx` | `FleetList({ entries, moreCount, narrow, now, onToggle, onOpenCell, onShowMore })` |
| `src/modules/cerberus/fleet/FleetRings.tsx` | `FleetRings({ items, nodes, now, onOpenCell })`: the Rings layout; owns its box, its layout and its selection |
| `src/modules/cerberus/fleet/RingMarks.tsx` | `RingDot`, `RingHub`, `RingsKey`: a node's dot, center's round, the key |
| `src/modules/cerberus/fleet/RingsNodePanel.tsx` | `RingsNodePanel({ item, node, now, onClose, onOpenCell })`: the selected node beside the rings |
| `src/modules/cerberus/fleet/NodeCard.tsx` | `NodeCard({ item, node, open, face, index, narrow?, now, onToggle, onOpenCell })`: one node, `face` `grid` or `list`; exports `NodeGlyph({ status, size })` and `Heartbeat({ node, name? })`, which `RingsNodePanel` reuses; it mounts `NodeProjects` after the services, and every warden line it draws as words ends with `sessionsTail`; a node with an update queued or running wears `UpdatingPill` ("Updating · Restarting the warden", `fleet/UpdatingPill.tsx`) before its warden line, on a list row and on an open grid card, and reads "Updating its warden" as its collapsed tile's line; while its warden restarts (`link === 'paused'`) its heartbeat dot stands neutral and its warden line says "Warden 0.4.2 · restarting": MAN-7934 |
| `src/modules/cerberus/fleet/NodeProjects.tsx` | `NodeProjects({ node, colocated, link, projects, face, returnFocus })`: a co-located node's "Projects that run here", after its services, on its card and in the Rings panel — a tile per project (name over path, ✕ back to this server) and "Run a project here", the kit's portalled `ActionMenu` (a `Select`'s list is drawn in place, and the card's `overflow-hidden` cuts it to 11 of its 320 px), disabled while no list has been handed down (a section drawn outside a panel). A tile is named by the sidebar's `displayName` when the workspace lists the project, so the tile, the menu row and the toasts agree; the overview's name (the custom name, else the folder's) stands only for a project the sidebar does not list. While `link` is not `reporting`, a warn banner under the heading says messages in the node's projects are refused until its warden reports. The menu offers the workspace's projects (`useProjectChoices()`) that no node of the overview lists, as `{ projectId, name: displayName, path: fullPath }`; a pick and a ✕ press the provider's `setProjectNode`, and its answer draws the rest. `NodeCard` and `RingsNodePanel` mount it for every node, after its services, and it decides from `colocated` and `projects` (MAN-7920): the whole section for a co-located node; "Projects assigned here" and the tiles only, each with its ✕ and never the picker, for a node that is not co-located but holds projects; nothing for any other |
| `src/modules/cerberus/fleet/ServiceRow.tsx` | `ServiceRow({ node, service, face, onOpenCell })`: name, pill, 30 minute cells |
| `src/modules/cerberus/fleet/WhatHappenedCard.tsx` | `WhatHappenedCard({ activity, now })`: the kit's dense `Timeline` |
| `src/shared/types.ts` § CERBERUS FLEET MODEL | `FleetLayout`, `FleetEntry` (`{ item, node, open }`), `CerberusSheetTarget` |
| `src/shared/types.ts` § CERBERUS NODE PROJECTS | `CerberusProjectMove` (`'moved'`, `'refused'`, `'failed'`): what a `NodeProjects` assign or unassign verb resolves to; a rejection reads as `failed`. `refused` is the 409 `PROJECT_NODE_NOT_COLOCATED` (no toast: the section's banner says it); `failed` is any other refusal or no answer (the write's own toast has said it) |

Leaves draw what they are handed and read nothing: they call `onOpenCell`, `onMute`, `onOpen`, `onToggle`. `NeedsYouCard` alone reads the provider, for Unmute (`liftMute(id)`); `NodeProjects` reads the provider's `overview` and `setProjectNode`, and the workspace's projects through `useProjectChoices()`.

- A project assigned to a node that has since stopped being co-located (`node.colocated` false) stays on that node, and its card draws the section under "Projects assigned here" with one line ("<node> is no longer on this machine, so these projects' chats can't run there. Move each back to this server.") and the tile of each such project with its ✕, which is the way back (`PUT /api/projects/:projectId/node` with `{"node": null}`); no picker, no "Nothing runs here yet", no not-reporting banner. When the last project has moved back the section goes with the ✕ that held focus, and focus goes to the card's header button (the rings panel's close) through `NodeProjects`'s `returnFocus`. `NodeProjects` takes `colocated` and decides it once; `NodeCard` and the rings' panel draw it for every node. A turn in such a project is refused at placement (MAN-7905).

## `FleetView` — contract
- Props: `overview` (non-null: the root draws loading and unreachable), `narrow` (the root's container query), `onOpenCell(target: CerberusSheetTarget)`, `onMute(check)`. The sheet and the Mute dialog are the root's.
- The root needs `container-type: inline-size`: padding `clamp(16px,4cqi,32px)` and the list's indent `clamp(16px,10cqi,60px)` size against it.
- Order: `NeedsYouCard`; then a wrapping row of the fleet column (`flex-[3_1_620px]`: toolbar, status bar, nodes, legend) and `WhatHappenedCard` (`flex-[1_1_300px]`; under the fleet on a phone).
- Nodes: `fleetItems` (worst first), `applyFilter(items, filter, query)`, open = `toggled[id] ?? defaultExpanded(items).has(id)`. `defaultExpanded` reads the WHOLE fleet, so a search never changes what opens. A node opened or closed by hand stays so.
- Paging: first page `FIRST_PAGE` = grid 120, list 80; "Show N more" adds `PAGE_STEP` 120 (`fleet.showMore`); Rings draws every node. A filter or search change returns to the first page (`limit` null).
- `shown.length === 0`: dashed sentence, `fleet.noneInGroup` for a blank search, else `fleet.noMatch`.
- Ages use `overview.now`, never a running clock: heartbeats are not re-read between reads, so a clock that ran on would age a node still reporting.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/FleetGrid.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/FleetList.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/FleetRings.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/FleetView.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/NodeCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/NodeProjects.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/RingMarks.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/RingsNodePanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/ServiceRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/WhatHappenedCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## MAN-7881 — The Cerberus screen's words — the cerberus block of en/common.json — Alternatives the caller picks

| when | key | else |
|---|---|---|
| the node has no `wardenVersion` (the hub) | `sheet.rawHub` | `sheet.raw` |
| `check.origin === 'self'` | `sheet.checkedHub`, `sheet.notCheckedHub`, `lookup.metaHub`, `lookup.metaHubMuted` | `sheet.checked`, `sheet.notChecked`, `lookup.meta`, `lookup.metaMuted` (name the warden and its node) |
| result `value` is null | `lookup.wasNoValue`, `mute.rawNoValue` | `lookup.was`, `mute.raw` |

- `fleet.bar.needs_one` (`{{count}} needs you`) and `node.allPassing_one` (`Its service is passing`) are the singular forms; the other counts use `_other`.
- The warden line is one whole key in each state: `node.heard`, `node.wardenRestarting` and `node.silent` each carry their own `Warden {{version}} · `; `node.waiting` and `node.hub` have no version. A restart is told from the link: `link === 'paused'`.
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
| warden-update words: `Updating · step`, `Updating to X`, `Show them in the fleet` (`Fix running or updating` is `fix.fleet.legend`) | no key; the warden-update plan owns them |
| scenario-player words, preview-node notes | no key |
| `node.heard`, `node.silent`, `node.wardenRestarting`, `enroll.done`, `activity.enrolledSummary` with a null `wardenVersion` | draw a double space; no code path writes such a row |

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json

## MAN-7884 — Cerberus — the tab's dialogs: `MuteDialog`, `EnrollDialog`, `EnrollInstall`, `DialogFrame`, `useEnrollmentStatus`, `enrollAsk`

The two dialogs are filled and live in their own right: both read the one overview and write through the one provider (MAN-7871). `CerberusPanel` (MAN-7891) hosts one of each — Mute from a Needs-you card and from the check sheet, Enroll from the header's "Enroll a node" — and the workspace mounts it as the Cerberus tab, so both open from the live app. Words: MAN-7870, open words MAN-7883. Wire shapes: MAN-7807. Routes: MAN-7802. Design: `design/cerberus/Cerberus Tab.dc.html`.

## Files
| file | holds |
|---|---|
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
- Every dialog is framed by the library's `DialogFrame` (`src/shared/ui/DialogFrame.tsx`: props, behaviour and paint are MAN-7963). `size` `md` (520 px) frames Mute; `lg` (600 px) frames Enroll, `PromoteDialog` (MAN-7932, the nearer of the two to the prototype's 580) and `UpdateWardensDialog` (MAN-7934). Each passes `data-cerberus-dialog="mute" | "enroll" | "promote" | "update"`: what a verify script finds it by. Mute, Promote and Update wardens pass `busy` while their write is out, which disables the ✕; Enroll never holds its way out and passes none.
- The accent is `{ words }` in Enroll, Promote and Update wardens; Mute's is the check's label, lower-cased, as `{ words }`, or `{ key }` for a check with no label.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useEnrollmentStatus.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/EnrollDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/EnrollInstall.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/MuteDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/enrollAsk.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## MAN-7885 — Cerberus — the Fleet view: `FleetView`, `NodeCard`, `ServiceRow`, `FleetGrid` — what each reads, and `FleetRings`

| file | reads and holds |
|---|---|
| `FleetView.tsx` | `fleetItems`, `groups` (`filterGroups`), `shown` (`applyFilter`) memoised on the overview; state `layout`, `filter`, `query`, `toggled` (nodes opened or closed by hand, read for its own entries only: a node named `constructor` is a legal name), `limit`; a filter or a search sets `limit` to null; Expand all and Collapse all write an entry for every node of the page |
| `NeedsYouCard.tsx` | `useCerberus().liftMute(id)` for Unmute; `hooks/useLeavingNeeds.ts` keeps a card that stopped needing you drawn 0.55 s at the place it held (`leaving: true`, `vv-toast-out`), keyed `<node>/<key>`, and drops it when the check needs you again; a place counts in the list as drawn, cards still leaving included; when a leaver expires, the leavers after it move up one slot; a new need that lands ahead of a leaver within the 0.55 s leaves it one slot off until it goes (an anchor-key design would remove that) |
| `ServiceRow.tsx` | `onOpenCell` for the row (at now) and for a minute (`lookupAt: cell.at`; the newest minute, now) |
| `WhatHappenedCard.tsx` | `toTimelineEvent(line, t, now)` per line, memoised; one state, `openKey` |
| `FleetRings.tsx` | `size` (state set by a ResizeObserver on `boxRef`, built from the host window), `layout` (`ringsLayout(items, width, height)` at that size, memoised on the three), `selected` (state, `null` at first; let go when its node leaves `items`), `onSelect` (toggles; ✕ hands `null`) |

- The open What happened row is held by the line's identity (`at`, `kind`, `node`, `check`, `event`, and the `runId` or `entry`; a part reads empty for a line without one, as a `catalog` line has no node or check), never by its position: the kit's `Timeline` takes `openIndex` from its owner, and the card derives it by finding that line. A newer line at the head leaves the open row on its event, and a row pushed past seven stops matching and closes.

## `CerberusSheetTarget`
`{ node: string; service: string; check: string; lookupAt?: number }`.
- `check` = the check's `id` within the service (`session.valid`), never the full key; `CheckSheet` takes it as is (MAN-7878).
- `lookupAt` = epoch ms; omitted = now.

| press | hands |
|---|---|
| a Needs-you card's name | `{ node, service, check: check.id }`, now |
| a service row's name and pill (one button) | the check that set the newest minute, else the check at the service's own word, else its first; now |
| a minute cell, not the newest | that minute's `worst` check resolved the same way; `lookupAt: cell.at`, the moment its word was reached |
| the newest minute | as above, now |

- A service with no check opens nothing.
- The 30 cells are a pointer's shortcut and take no tab stop (30 stops per service would bury the keyboard). The keyboard opens the sheet from the name and picks minutes in the sheet's own strip.
- Why `cell.at` and not a fixed second: a minute's word is the worst over the whole minute, so its last second reads the word that came after a run's last minute and its first second misses a run's first. The read model hands each minute the moment its word was reached (`CerberusCell.at`, MAN-7809); `ServiceRow` and the sheet's strip both pass it as `lookupAt`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/FleetGrid.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/FleetList.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/FleetRings.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/FleetView.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/NodeCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/ServiceRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/WhatHappenedCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useLeavingNeeds.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## MAN-7886 — Cerberus — the Fleet view: `FleetView`, `NodeCard`, `ServiceRow`, `FleetGrid` — `FleetRings`

- FleetView renders it while `layout === 'rings'` and `shown` is not empty, with `items` = the hub (kept at the centre whatever the filter or search leaves) then `shown`. Its Rings props carry no marker: each is a value FleetView already reads.
- It owns its box (`boxRef`), the layout for that box, and the selection. why: a parent can see neither the box nor a press, and a return from Grid or List starts with nothing selected.
- The ring's card (`flex-[3_1_300px]`, at most 720 px) and the side column (`flex-[2_1_300px]`) stand side by side from a 616 px row, which the fleet column always is beside What happened (its floor is 620 px); under that they stack. why: the prototype's 440 + 280 needed 736 px, and on the app's 1004–1159 px panes (1037 on a 1366 screen, 1111 on a 1440) the panel fell some 700 px below the ring, out of view. 300 px is what a service row's 30 minutes need, padding included.
- The panel's ✕ is the library's ghost icon `Button`, named by `buttons.close`: 40 px at a desk, 44 px below md.
- ✕ hands focus back to the selected node's dot (the hub when that node is not drawn) before letting it go. why: the dot stays mounted and only its `aria-pressed` flips, so focus never falls to `<body>` with the panel's button.
- Positions are the layout's pixels drawn as shares of the box it was laid out in (`center` × 2). A fixed fake fills any width, and a resize being measured stays in place. Dots and spokes keep their px.
- Marks (`RingMarks.tsx`) read `nodeMark` and `STATUS_TABLE`. `RingDot` paints by the word's cell shape; `soft` (passing) takes the tone's edge too. why: a lone dot needs one to be seen; a strip's minute does not. `RingHub` is center: icon, name, "Cerberus", a fifth of the box (66–92 px). `surface` (muted) takes the neutral dot's solid edge on the raised grey. why: the strip's `border-input` edge measured 1.41:1 on the light card, and a lone dot needs 3:1 to be found. A node with no mark (nothing assigned, as every newly enrolled node starts), and an unmarked hub, is a hollow round in the neutral dot's solid edge under `data-tone="neutral"`: kept dashed it would read as no result. `RingsKey`'s swatches are `RingDot`s; its "Fix running or updating" row is the `fixing` row of `KEY`, second after Needs you, as the prototype orders it.
- A label (icon + name; the icon is `markLook(mark).icon` through `MarkIcon`, 12 px, lowered 2 px to centre on the name's capitals) stands on the side away from the hub: above a node on a ring's upper half, below one on its lower half. It is capped at `max-w-[30cqi]` (the box is an inline-size container) and cut with an ellipsis, and in the box's outer left or right fifth it runs inward from its dot. why: names have no length cap, and at a phone's 320 px box long ones ran past the card; the dot's title, its name and the panel carry a name whole.
- Spokes: dashed `border-tone-dot` under `data-tone="neutral"` for no result (why: `border-input` measured 1.41:1 on the light card, and the line that says no result must read on its own); amber `border-t-2` under `data-tone="warn"` for needs you; plain `border-input` otherwise; a selected plain spoke turns `border-primary`. why 2 px: Chromium floors a border under 2 px to whole device pixels, so the prototype's 1.5 px drew as 1 px on a 1× screen.
- Beats: `motion-safe:animate-cerberus-travel`, base `opacity-0`, phases `-(index % 7) × 0.45 s`. Every live spoke beats while every node on the rings is `labelled`; past that, only amber spokes beat. why: sixty beats are texture, and a silent node is told by its dashed spoke and hollow dot.
- Each dot is a button (`aria-pressed`, named "<id> · <line>"); its press area is ≥ 24 px. The keyboard walks the hub, then the nodes worst first.
- The panel (`RingsNodePanel`, keyed by node) shows only for a node in `items`: name, description, line, the warden line said once (ending with `sessionsTail`, MAN-7879), a `ServiceRow` (`grid` face) per service or the one-sentence empty state, then `NodeProjects` (`grid` face), which draws for a co-located node and for one that holds assigned projects (MAN-7880, MAN-7920).
- Note: `fleet.rings.note` / `fleet.rings.partial`; none while unmeasured (0 × 0) or with no node around the hub.

## `NodeCard`, `FleetGrid`, `FleetList`
- `grid` face: collapsed tile (glyph, name, heartbeat, up to 8 service squares then `+N`, one line); open, it spans the grid (`col-span-full`) as a card with the warden line and a `ServiceRow` per service; an empty node draws the kit's `EmptyState`.
- `list` face: a row (chevron, glyph, name and description, squares, line, warden line) opening a canvas band; an empty node is one sentence at the band's indent. `narrow` moves the warden line from the row's end into the open band.
- A list row does not repeat the warden line when it equals the node's line ("Waiting for the first heartbeat").
- The tile's edge is `markLook(mark).cell`: `solid` 1.5 px tone edge, `outline` 1 px, `dashed` 1.5 px dashed, the rest the plain border. A node with no mark (`empty`, `enrolling`) draws a dashed edge and a dashed round glyph.
- `fixing` is fed (a fix running on one of its services) and draws the info wrench — its tile edged 1.5 px in the info dot, the glyph pulsing. `updating` (an update queued or running) draws the same look through `nodeMark` and names itself "Updating its warden" (`StatusGlyph`'s `label`); `paused` keeps the dashed neutral of its checks. `enrolling` is fed by nothing yet and draws as a node with no mark.
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
- Re-mounting callers: `CerberusPanel` (keyed by Try again's finished reads, MAN-7891); the feed's placeholder, History's index read and the sheet's Fix output (each puts its placeholder back while the read is out). Silent on a second failure: the check sheet's and the look-up's retry of a check's read keep it mounted.
- Try again: `Button variant="tonal" size="sm"`, `max-md:h-11` (44 px under `md`).
- First line `errors.unreachable` (`font-medium`); optional `detail` second line sets itself apart by weight alone. No `opacity-*` on it. why: `opacity-80` measured 3.24:1 on the light banner, under AA.
- Consumers: `CerberusPanel` (its first read of the fleet failed; the fleet it holds is stale, with `detail` `cerberus.errors.lastAnswer`), `LookupCard`, `EventsCard`, `sheet/CheckSheet.tsx`, `sheet/FixOutput.tsx` (its run's own read failed; the sheet's banner speaks only for the check's read), and `sheet/DiagnosisPanel.tsx` (its diagnosis's own read failed, MAN-7932): one spelling of the state for the tab.

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

The Cerberus tab's root and header, live: the root reads the one overview through `useCerberus()`, holds the tab's own state, and hosts the sheet and its four dialogs (Mute, Promote, Enroll, Update wardens); the workspace mounts it as the Cerberus tab. Fleet view: MAN-7880. History view: MAN-7877. Sheet: MAN-7878. Dialogs: MAN-7884. Client reader: MAN-7871. Words: MAN-7870. Banner: MAN-7890. Design: `design/cerberus/Cerberus Tab.dc.html`.

## Files
| file | holds |
|---|---|
| `src/modules/cerberus/CerberusPanel.tsx` | `CerberusPanel({ projectChoices })`: header, stale banner, strip, the view shown, the sheet and the four dialogs (Mute, Promote, Enroll, Update wardens); it provides `projectChoices` (the workspace's projects, which `NodeProjects` offers) to Fleet through `ProjectChoicesContext`, because the workspace owns that list and imports this module |
| `src/modules/cerberus/CerberusHeader.tsx` | `CerberusHeader({ overview, stale, wardens, onEnroll, onUpdateWardens })` and `ClockPill`: eyebrow, headline, summary, clock pill, the update button, Enroll a node |
| `src/modules/cerberus/hooks/useClock.ts` | `useClock(tickMs = 1000)`: the browser's clock as epoch ms, read again each tick on the host window |
| `src/modules/cerberus/hooks/useCountTo.ts` | `useCountTo(target)`: the passing count as drawn |
| `src/shared/types.ts` | `CerberusView = 'fleet' | 'catalog' | 'history' | 'tours' | 'bulletins'` |

`index.ts` exports `CerberusPanel` as a `lazy` import (its own chunk, loaded on the tab's first open); `WorkspaceMain` renders it with its `projectChoices`, which it only does once the workspace's projects have been read.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/CerberusHeader.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/CerberusPanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useClock.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useCountTo.ts

## MAN-8914 — Cerberus — the tab root and header: `CerberusPanel`, `CerberusHeader` — `CerberusPanel` layout
section: Cerberus — the tab root and header: `CerberusPanel`, `CerberusHeader`/001 `CerberusPanel` layout

| order | block | shows when |
|---|---|---|
| 1 | `CerberusHeader` | `overview !== null` |
| 2 | `UnreachableBanner` with `detail` `cerberus.errors.lastAnswer`, keyed by `attempt` | `stale` |
| 3 | strip: `Tabs` in a box of its own that scrolls sideways (the five words make a 429 px tray, wider than a phone's panel: without the box the panel's whole scroller panned and clipped Bulletins), and the shown view's hint | `overview !== null` |
| 4 | Fleet, `hidden` while another view shows | `overview !== null` |
| 5 | Catalog (`CatalogView`), mounted only while shown | `overview !== null && view === 'catalog'` |
| 6 | History (`HistoryView`), mounted only while shown | `overview !== null && view === 'history'` |
| 7 | Tours (`AffectedAreasView` from `@/modules/affected-areas`, in a `KeptView`), mounted on its first show and `hidden` after | `overview !== null`, and Tours shown once |
| 8 | Bulletins (`BulletinsView` from `@/modules/carrier-bulletins`, in a `KeptView`), mounted on its first show and `hidden` after | `overview !== null`, and Bulletins shown once |
| — | "Loading Cerberus…" (`cerberus.loading`, `vv-fade` held back 150 ms) | `overview === null && !unreachable` |
| — | `UnreachableBanner` (no `detail`), keyed by `attempt` | `overview === null && unreachable` |

- `VIEWS` is one table (`id`, `labelKey`, `hintKey`), in strip order: Fleet, Catalog, History, Tours, Bulletins.
- Catalog (`catalog.tab` / `catalog.tabHint`), between Fleet and History, is mounted only while shown like History: it holds no place of its own, so its entrance plays each time. View: MAN-7906.

- Root: `[container-type:inline-size]`; `data-cerberus-panel="narrow|wide"` carries the flag for a verify script.
- Gutter `px-[clamp(16px,4cqi,32px)]`, top `pt-[clamp(20px,5cqi,28px)]`: from the panel's own width, not the window's. `HistoryView` and `FleetView` keep the same spelling.
- `narrow`: below 620 px, wide again only above 660 px; a width of 0 changes nothing.
- Fleet stays mounted so layout, filter, search and open nodes survive a visit to History. why: it reads nothing of its own. While hidden its box is 0 wide; the rings fill must ignore that.
- Tours is the fourth view (`tours` after History: `cerberus.tours.tab`, `cerberus.tours.tabHint`) and Bulletins the fifth (`bulletins`: `cerberus.bulletins.tab`, `cerberus.bulletins.tabHint`); their code is the modules `src/modules/affected-areas` (MAN-8575) and `src/modules/carrier-bulletins` (MAN-8880), each imported through its `index.ts`. They draw only once center's overview has answered, as every view does. Each is mounted by `KeptView.tsx` (MAN-8918: `<KeptView id view shownOnce label>` around the lazy view): it mounts on its first show and stays mounted, `hidden` after, so the open tour, pano and face, or the open carrier and page, survive a visit to Fleet. why: each reads on open and on a press, never on a timer or while hidden, so kept mounted it costs nothing. The lazy chunk loads on the first show; the shared `ViewBoundary` (MAN-8917) inside `KeptView` keeps a chunk that fails to load a banner of that view alone, never the tab-level error card, and names the view by its tab's name (`label`).
- The views share ONE scroller (the box inside `ScrollArea`), whose offset follows whichever view is taller, so the panel keeps each kept view's offset itself, in `hooks/useKeptViews.ts`: `onView` calls its `leaving(next)` before it changes the view, which writes the offset of the kept view being left, and a layout effect writes it back as that view returns (a first show starts at the top). `leaving` runs in the press and not in an effect, because the view's panel is `hidden` by the commit that follows and the browser then clamps the offset to the shorter content. The strip scrolls with the content, so the offset a view is left at is one at which the strip is on screen. Leaving the Cerberus workspace tab for another unmounts the panel and both views with it (`WorkspaceMain` mounts the panel only while its tab is active), so the place survives a visit to Fleet, not to Chat.
- History polls every 30 s, so it mounts only while shown.
- A view shown plays `vv-pagein` again.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/CerberusHeader.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/CerberusPanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useClock.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useCountTo.ts

## MAN-8915 — Cerberus — the tab root and header: `CerberusPanel`, `CerberusHeader` — Reads and state
section: Cerberus — the tab root and header: `CerberusPanel`, `CerberusHeader`/002 Reads and state

| what | where it comes from |
|---|---|
| `overview`, `unreachable`, `stale`, `refresh` | `useCerberus()` (MAN-7871): the fleet, whether the first read failed, whether the held fleet is the last answer (a read failed and it was answered over 90 s before), the read Try again presses |
| `attempt` | state, 0: how many of Try again's reads have finished (`refresh().then(...)`); keys both banners |
| `narrow` | state set by a `ResizeObserver` on `rootRef`, built with `resizeObserverIn(useHostWindow(), …)`: narrow below 620 px, wide again only above 660 px (`width <= 660` keeps it narrow); a width of 0 is ignored |
| `view` | state, `'fleet'`: the view the strip shows |
| `shownOnce` (in `useKeptViews`) | state, a set holding the first view: the views shown at least once; a view is added while rendering as it first shows, never removed. `KeptView` mounts its view when its id is in it |
| `scrollerRef`; `offsetsRef` (in `useKeptViews`) | refs: the panel's scroller, and where each kept view was scrolled to when last left (written by `leaving`, read as the view returns) |
| `sheet` | state, `CerberusSheetTarget \| null`: set by Fleet's `onOpenCell`, handed to `CheckSheet` field by field |
| `muting` | state, `CerberusCheckView \| null`: set by `onMute` from a Needs-you card or the sheet; the sheet stays open under the dialog |
| `promoting` | state, `{ diagnosis, check } \| null`: set by the sheet's `onPromote` (Add to catalog on a diagnosis) for `PromoteDialog`; the sheet stays open under the dialog. A promotion that lands (`onPromoted`) clears it, closes the sheet and sets `view` to `'catalog'`, where the new entry stands first with its "New" badge and wash |
| `enrolling` | state, `false`: the header's Enroll a node opens the dialog |
| `updatingWardens` | state, `false`: the header's update button opens the Update wardens dialog; closing it leaves a running batch running |
| `wardens` | `useCerberus()`: handed to the header, which draws its update button from it |
| `connected` (header) | `useWebSocket().isConnected` |
| `now` (header) | `useClock()`: every second |
| passing count as drawn (header) | `useCountTo(counts.passing)`: the number itself on mount; on a change it counts from the number last drawn over 1.4 s, ease-out `1 − (1 − k)³`, rounded, one step a frame on the host window; with motion reduced it is the target at once |

## On the workspace
The tab's place on the house row, its count pill, its pane and both palettes: MAN-7866.

## Banner re-announce
- An alert is heard when it mounts. Both root banners are keyed by `attempt`, so a retry that fails again mounts afresh and is heard again.
- The provider's own 30 s reads never change `attempt`: a fleet that stays out of reach is not announced every 30 s.
- Open (follow-up, shared code): Try again shows nothing while its read is out; the sheet's and History's look-up retries do not re-mount the banner (`useCheckDetail` would need a `retry` that clears the failure during the read).

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/CerberusHeader.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/CerberusPanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useClock.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useCountTo.ts

## MAN-8916 — Cerberus — the tab root and header: `CerberusPanel`, `CerberusHeader` — `CerberusHeader`
section: Cerberus — the tab root and header: `CerberusPanel`, `CerberusHeader`/003 `CerberusHeader`

- Eyebrow `cerberus.header.eyebrow`; headline `<lead> <em>accent</em>`: "All *quiet*", "One check *needs you*", "3 checks *need you*", from `counts.needsYou` (the number the workspace strip's pill shows).
- Accent: italic, never bold (the display serif has none); `data-tone="positive"` at quiet, `info` for "One fix *running*" (the only need has its fix going: `accentTone` takes the run's own tone, `RUN_LOOK.going.tone`), `warn` while anything else needs you, `text-tone-ink`. why: the call to act is never painted passing green, and a need already being fixed is not painted as one still waiting.
- A changed headline re-mounts (keyed by its words) and rises in (`animate-shape-rise`).
- Summary: "`passing` of `checks` checks passing · `muted` muted · `nodes` nodes · last result `ago`". `muted` is left out at 0, the age while `lastResultAt === null`. The age is `agoPhrase` from `utils/fleetWords.ts` (MAN-7879).
- The count in motion is `aria-hidden`; an `sr-only` span carries `counts.passing`.
- Eyebrow, summary and hint use `text-muted-foreground`. why: `ink-faint` measures ~3.1:1 on the light canvas, under AA.
- Pill: `live = connected && !stale`. Live: breathing positive dot, `cerberus.header.live`, `hms(now)`. Otherwise: still neutral dot and `cerberus.header.reconnecting`, no time. Only the mode word is `role="status"`; the clock never is.
- The button row, before Enroll a node (MAN-7934): Enroll's own Button (outline, `sm`), opening the Update wardens dialog. Its words: `updates.button.updating` ("Updating wardens · 2 of 3": `batchPlace(wardens.running)`, the first update not ended, counting from 1, of the batch's size) while a batch runs, else `updates.button.update` with `latest.version` while a node can take it (`canTake`: `behind` and a version — one that never said hello is on no link to offer the release on, so the header never offers what the dialog would answer "Update 0 nodes"), else `updates.button.upToDate`. Drawn only once `GET /wardens` has answered with a release: with none there is nothing to offer. The headline reads "One fix *running*" (`fix.headline` + `headlineAccent`, the accent in the info tone) when `counts.needsYou` is 1 and that need's run is going (`result` null).
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

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useEnrollmentStatus.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/EnrollDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/EnrollInstall.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/MuteDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/enrollAsk.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

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
- While `!overview.gateway.listening`: a warn `EnrollRefusal` of kind `notListening` shows before anyone asks, and "Get the install command" waits. A `notListening` refusal that an ask brought is true of the moment it was given: the first reading of the overview to arrive after it that says the gateway listens clears it (`lastOverview`, judged in the render that first sees a new reading), with no new ask.
- `askForCommand` (`utils/enrollAsk.ts`) is the one ask, for the first command and for a new one: `api.cerberus.enroll({ name, desc })` with `desc` trimmed and left out when blank. It tells a refusal by the error body's `code` (`refusalCode` of `@/shared/api`, the one copy), not by the status (409 is both): `CERBERUS_NOT_LISTENING` is `notListening`; no answer at all (or a 200 that is not JSON) is `unreachable`; a 200 JSON body that is not an enrollment is `refused` with no sentence; any other is `refused` with `refusalSentence(response)`; `CERBERUS_NAME_TAKEN` is `taken`.
- A failed ask for a command shows as a banner in the dialog, never a toast. `taken` is the name field's, except for a new command asked for from the install step, where no field is in view: there it is a `refused` banner with the server's sentence.
- `useEnrollmentStatus(issued)` reads `api.cerberus.enrollment(issued.name)` at once and then 2 s after each answer lands (never two reads in flight). It stops at an expired token, at the warden's first heartbeat and when the dialog closes; a read that fails keeps the last answer. An answer is held with the token it was read for, so a new command starts from no answer, which reads as waiting.
- `helloShown` turns true 1.2 s after the status first carries `node.firstHeartbeatAt`; Copy writes `issued.command` through `copyTextToClipboard(…, useHostWindow())` and says "✓ Copied" for 2 s; a second press while it shows starts the 2 s over (`copiedAt` is a moment, not a flag).
- An expired token says so and "Get a new install command" asks again for the same name and description; its answer replaces the command, `EnrollInstall` remounts on the new token, and polling resumes.
- Closing at any step is safe: an issued token still works until it expires; the node turns up in Fleet when its warden speaks.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useEnrollmentStatus.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/EnrollDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/EnrollInstall.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/MuteDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/enrollAsk.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## MAN-7894 — Cerberus — the tab's dialogs: `MuteDialog`, `EnrollDialog`, `EnrollInstall` — `EnrollInstall`

- Three lines tick as the machine gets there: `token` (at once), `install` (`installRanAt !== null`), `hello` (`node.firstHeartbeatAt !== null`). Each is `role="img"` with `status.completed` or `status.pending`, keyed by its state so a landed ✓ is a new mark playing `cerberus-check`; the `<ul>` is `aria-live="polite"`.
- The command is mono, whole, wrapped anywhere, `select-all`. Copy autofocuses on mount.
- The Copy label swap sits in one grid cell with the unsaid word held `invisible`: the button is always as wide as "✓ Copied" in any language, so the command never re-wraps. The swap stays inside that cell.
- Expired (`status.token === 'expired'`): the command is struck through and keeps its ink `text-secondary-foreground` (7.49:1 light, 9.31:1 dark on its `bg-muted` box; muted ink there reads 4.45:1 in light, under AA); Copy is `disabled`; the listening box is replaced by a warn banner with "Get a new install command", which takes focus (`autoFocus`).
- The expired banner mounts fresh each time the token expires, which is what lets its button take focus. A reissue keeps that: a new command remounts the step by token, with Copy focused again and its ✓ arriving again.
- `EnrollRefusal` has `role="alert"` so a second refusal is announced; tone `warn` (nothing was denied). Words: `enroll.notListening`, `errors.unreachable`, `errors.writeFailed` + the server's sentence.

## Rules
- The ✕'s phone-size offsets (6 px each way, 44 px square: `.vv-dialogframe__close` in `verve/panels.css`) are calculated from `.vv-dialogframe`'s padding `clamp(18px,5vw,32px)` / `clamp(20px,5vw,30px)`, the first shared with the ✕ as `--vv-dialogframe-gutter`. Change the padding and those offsets together.
- `EnrollDialog` and `MuteDialog` use the page's `document` through `useReturnFocus`, not `useHostWindow()`; harmless while the tab lives in the main window. Copy does go through `useHostWindow()`.
- The Mute and Enroll submits, and the install step's "Get a new install command", are the kit `Button`'s `busy` while their write is out and never `disabled`: a disabled button gives up the focus it holds, so a refused press would leave the page with none. The Enroll submit is `aria-disabled` too while its name is blank or taken or the gateway is down, never `disabled`: the 409 that says a name is taken turns that on under the very press that holds the focus. The kit `Button` refuses the press itself for `busy` and for `aria-disabled` and paints the dimmed look (`Button.tsx`).

## Open
| gap | state |
|---|---|
| house `Field` has no slot for Verve's small "optional" label | `enroll.desc` reads `What it is (optional)` in one key |

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useEnrollmentStatus.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/EnrollDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/EnrollInstall.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/MuteDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/enrollAsk.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## MAN-7906 — Cerberus — the fixes screen, live: `CatalogView`, `NeedFix`, `FixOutput`, `CheckFixes`, `useRunOutput`

The fixes screen's four pieces, drawn from the provider and the run reads, and mounted on the live tab. Words: MAN-7870 (`cerberus.catalog.*`, `cerberus.fix.*`). Run look: MAN-7873. Wire shapes: MAN-7807. Client reads and the provider's verbs: MAN-7871. Row map: MAN-7868. Design: `design/cerberus/Cerberus Tab.dc.html`.

## Files
| file | holds | design |
|---|---|---|
| `catalog/CatalogView.tsx` | `CatalogView()`: intro, count, entries newest first; `EntryRow`, `ReadingRows` | :301-336 |
| `fleet/NeedFix.tsx` | `NeedFix({ need, leaving, onOpen })`: a Needs-you card's run strip, then Run “<name>” | :77-84 |
| `sheet/FixOutput.tsx` | `FixOutput({ runId })`: one run's head, pill and output pane; `ReadingRun`, `UnreadRun` | :429-449 |
| `sheet/CheckFixes.tsx` | `CheckFixes({ fixes, run })`: "Fixes in the catalog" with Run now | :489-504 |
| `hooks/useRunOutput.ts` | `useRunOutput(runId)` → `{ run, lines, replaying, failed, refresh }` | — |
| `hooks/useRunLastLine.ts` | `useRunLastLine(run)`: the strip's newest line, kept live | — |
| `hooks/useCatalogRead.ts` | `useCatalogRead()` → `{ catalog, catalogFailed, readCatalog }`, called by the provider | — |

## Where they read
- `CatalogView`: `useCerberus()` for `catalog`, `catalogFailed`, `overview.running`, `starting`, `setAuto`, `runEntry`, `refresh` (Try again); `useClock(60_000)` for the hour an entry is new (`starting.includes(entry.id)` marks a press still out).
- `NeedFix`: its need; `useCerberus()` for `starting` and `runEntry`; `useRunLastLine(run)`. The strip opens the sheet with `run: run.id`. A press that had focus hands it to the strip when the strip takes the button's place (`aria-disabled`, never `disabled`, kept the focus until then).
- `FixOutput`: `useRunOutput(runId)`; `useClock` ticks each second while the run goes, hourly otherwise. Each line is an `OutputLine`, memoised on its line, so a line added draws only itself; a run's closing sentence (`note`) waits until `replaying` is over, so it follows the lines.
- `CheckFixes`: `useCerberus()` for `starting` and `runEntry`; a press is `runEntry(entry.id, onRunStarted)`, so the sheet is handed the id of the run the press started and pins Fix output to it.
- `CerberusPanel` mounts `CatalogView`; `CheckSheet` mounts `FixOutput` (keyed by run) and `CheckFixes`, and the diagnosis plan's `DiagnosisPanel` mounts a second `FixOutput` for its proposal's one-off run, under the proposal (MAN-7932); `NeedsYouCard` mounts `NeedFix` and carries the quiet sentence; `CerberusHeader` says "One fix running".

## `useRunOutput(runId)`
- Reads `GET /api/cerberus/runs/:id` (`api.cerberus.run`) once subscribed, and again when a `cerberus_changed` hint names the run's check (`<node>/<check key>`, known after the first read) and on `websocket_reconnected`. Only the newest read's answer is applied; `failed` while a read has not answered, cleared by one that has.
- Lines: the read's and each `cerberus_run_output` frame's for this run, merged by `n` (a line both carry is kept once), in order.
- A run that has ended when it is first read replays: each line appears at its own `t`, the whole replay capped at 10 s (the pace is squeezed by `10 / last t`). One timer at a time reveals every line whose moment has passed and waits for the next, no sooner than 40 ms, so a 5,000-line run is a few hundred renders and ends at the cap; `replaying` is true until the last line is shown. A run still going shows what it has at once and takes the rest as frames; a later read never replays. The timer ends with the card.

## `useRunLastLine(run)`
- The newest line of a frame for this run while the run has no result and its number is past `run.lastN` (the overview's own newest line number); from the moment a read has caught up with it, the overview's `lastLine`. Lines are compared by number, never text, so a read that left before a frame and lands after it cannot put its older line back. An ended run shows the overview's `lastLine`. An overview with no `lastN` (an older API) reads as no line yet, so the newest frame's line stands until the run ends. why: `lastN` is `CerberusRunView`'s newest line number, from the same statement as `lastLine`.

## `CatalogView`
- Order: `createdAt` descending, then name. Count `catalog.count_*` (`count`, `auto`).
- Row: name, "New · HH:MM" `Badge` and a `bg-tone-soft/70` wash while `now - createdAt < 1 h`; trigger line (check label, else the key in mono, then `catalog.trigger.<when>`); raw key and `when` when a label shows; `$ cmd`; run stats and origin; `Switch` and `auto` line, or the `capped` reason in neutral with no switch; Run now.
- Row entrance staggers 45 ms a row, capped at 12 rows.
- States: `ReadingRows` (three skeleton rows, `aria-busy`) before the first read; `UnreachableBanner` with Try again when it failed; `catalog.empty` for no entries.
- `busy` (this entry runs, or its press is out): "Running…" via `aria-disabled`; `blocked` (another run on the same node and check): real `disabled`, `catalog.blocked` under the auto line, `aria-describedby` on the button. why: center refuses a second run on a check (`CERBERUS_RUN_ACTIVE`).

## `NeedFix`
- Draws nothing for a need with no `run` and no `fix`.
- Strip (a `button`, `basis-full`, opens the sheet), from the run: going `strip.running` / `strip.runningAuto` (info, no icon); `ok` `strip.finished` (neutral, the check icon in positive ink); an ended run's icon is `RUN_LOOK`'s, through `MarkIcon`; `failed` `strip.failed` / `strip.failedExit`; `timed_out` `strip.timedOut`; `refused` `strip.refused` (danger).
- Second line: `run.note` (body face, `line-clamp-2`), else `run.lastLine` (mono, one line, `title` carries it whole), else `$ cmd`.
- Button `fix.run`, tonal, while `fix !== null` and no run is going. Pending press: "Running…", `aria-disabled`.
- `leaving` disables both: a card on its way out takes no press.

## `FixOutput`
- Head: eyebrow `fix.output.title`, the fix's name, `output.meta` (who, node, start time; `output.metaRefused` for a refusal). Right: pill `Badge` (`RUN_LOOK` tone and icon, `role="status"`; a going run's wrench breathes) and `output.elapsed` while going / `output.took` once ended; none for a refusal.
- Pane `role="log"`: `$ cmd`, then `+NNs text` per line (`output.offset`); a line opening `✓` is positive ink; `run.note` after the lines in the result's ink; a blinking caret while going.
- Pane `max-h-[min(26rem,60vh)]`, scrolls itself. It follows a new line only while the reader is within 8 px of the bottom (`followingRef` + `useLayoutEffect`, no state); scrolled back, it holds still.
- Pane sits on `bg-background`. why: on the darker grey, muted and green text measured 4.46 and 4.49:1 light; on the page background 4.73 and 4.77.
- Placeholders keep the frame and eyebrow: `ReadingRun` (skeleton) while the read is out; `UnreadRun` (`UnreachableBanner`, Try again) when it failed. The sheet's own banner speaks only for the check's read.
- Keyed by run id in the sheet, so a new run starts the pane fresh.

## `CheckFixes`
- `fixes` = the check's entries, every `when`. Row: name, `$ cmd`, auto line (the `capped` reason, `catalog.auto.on_*`, or `fix.sheet.offered`), Run now (tonal).
- The entry whose run is going reads "Running…" (`aria-disabled`); every other entry is `disabled` while a run on the check is going. No entries: dashed `fix.sheet.none`.

## Rules
- A pending or running Run button is the kit `Button`'s `busy` (`aria-disabled`, never `disabled`; the kit refuses the press itself — `Button.tsx`). why: `disabled` blurs the button under the keyboard user who pressed it. `disabled` only when another run holds the check.
- No `Trans` in these pieces: a label, name or command reaches the screen as text through `t()`. why: `Trans` escapes `<` in a check label ("p95 < 300 ms") to protect its own tags.
- Icons live in code (`RUN_LOOK`, MAN-7873), not in the words (MAN-7870).
- Feed words sit under `cerberus.activity` (`fix`, `catalog`), not under `cerberus.fix`: each kind of event keeps its words there (MAN-7872).
- Light-mode contrast under 4.5:1 that is the kit's, not this screen's (2026-10-06): green `Badge` 4.48, tonal `Button` 4.48, the sheet's ✕ 4.46. Every colour these pieces choose passes.
- Phrases with no design source: `catalog.empty`, `catalog.auto.label`, `catalog.blocked`, the failed and timed-out strips, `output.metaRefused`.
- Not composed: the prototype pulses a card's glyph while its fix runs; the Needs-you card's glyph keeps its failing ring (the fleet's node glyph, squares, pill and dot do pulse: `markLook`).
- The Catalog writes nothing but the auto switch and a run. The one screen that writes an entry is the Promote dialog (`api.cerberus.promote`: `POST /diagnoses/:id/promote`, MAN-7932); `api.cerberus.writeEntry` (`POST /catalog`) is the seeds' door and no screen calls it.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/catalog/CatalogView.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/NeedFix.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useCatalogRead.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useRunLastLine.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useRunOutput.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/CheckFixes.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/FixOutput.tsx

## MAN-7920 — Cerberus — a project's node: `projects.node`, `PUT /api/projects/:projectId/node`, the co-location rule, and "Projects that run here"

A project's Claude chats run on this server or on one co-located node's warden. The tab writes the assignment from a node's card and reads it back in the overview. Server side — column declaration, the relay, the hints: MAN-7901 §"A project's node". What a turn does with it: MAN-7905.

## The assignment
| piece | fact |
|---|---|
| column | `projects.node` (`TEXT DEFAULT NULL`): the node's id, NULL = this server |
| write | `PUT /api/projects/:projectId/node { node: string \| null }` → 204; client `api.projects.setNode(projectId, node)`; the tab's verb `setProjectNode` (MAN-7917) |
| refusals | 400 `INVALID_PROJECT_NODE` (no `node`, or an empty or non-string one); 404 `PROJECT_NOT_FOUND` (judged first, even for `null`); 409 `PROJECT_NODE_NOT_COLOCATED` |
| reads | `projectsDb.nodeForPath(path)`, by `dispatchRun` on every turn → `options.node`; `projectsDb.listByNode(node)` → `CerberusNodeView.projects` |
| effect | the next CLI the project needs is spawned by that node's warden; a CLI already running keeps running where it started and later messages in its chat join it. Only Claude reads `node` |

**Co-location rule.** The 409 answers unless the node is enrolled (`cerberusNodesDb.get`) AND `nodeSessions.isColocated(node)`: the node's last `hello.facts.machineId` equals the first line of this machine's `/etc/machine-id`. why: a session's working folder is a path on this server's disk and the warden reads it from its own. `null` needs no node. The rule is checked at the assignment and again at every placement (MAN-7905): a node that later leaves this machine keeps its projects, a turn in one is refused with "<node> is no longer this machine — move this project back to this server from its card on the Cerberus tab", and its card (`colocated: false`) draws only the rows of those projects, each with the ✕ that moves it back.

## What the tab reads and draws
| `CerberusNodeView` field | Value | Drawn as |
|---|---|---|
| `colocated: boolean` | `nodeSessions.isColocated(id)`; false for the hub | with `projects`, decides `NodeProjects` on the node's open card (Grid, List, the Rings panel): the whole section for a node on this machine, the rows alone for one that is not but holds projects, nothing for any other (`NodeProjects` takes `colocated` and decides it once) |
| `projects: { projectId, name, path }[]` | `projectsDb.listByNode(id)`, by path; `name` is the custom name, else the folder's | one tile per project: name over path, ✕ moves it back to this server |
| `sessions: number` | `nodeSessions.lastListed(id).length`; 0 before a list has answered; the hub 0 | " · N sessions running here" ending the warden line, only while `link` is `reporting` and `sessions > 0` (`sessionsTail`, MAN-7879) |

- "Projects that run here" (`fleet/NodeProjects.tsx`, MAN-7880): the heading, a tile per project, and "Run a project here" — the workspace's projects (`useProjectChoices()`) that no node's list holds, in the kit's `ActionMenu`, not a `Select`: a node card clips what overflows it. A pick and a ✕ both call `setProjectNode`; its answer (`moved`, `refused`, `failed`) draws the rest. A 409 is the section's warn banner; any other failure is the write's toast. A node that is not `colocated` draws "Projects assigned here", one line saying the node is no longer on this machine, and the tiles only: no "Run a project here", no "Nothing runs here yet", no not-reporting banner (it would refuse them reporting or not).
- While a node's `link` is not `reporting`, a message in its projects is refused with "<node>'s warden is not connected — this project's sessions run on <node>" (MAN-689). The section says so in a warn banner, and a move still lands.
- A landed write re-reads the overview, and the server hints the node left and the node joined (`cerberus_changed`), so a second window re-reads too (MAN-7871).

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/projects/projects.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/projects/services/project-node.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/NodeProjects.tsx

## MAN-7932 — Cerberus — the diagnosis screen, live: `DiagnosisPanel`, `PromoteDialog`

The diagnosis plan's screen, live on the tab: `DiagnosisPanel` in the check sheet, `PromoteDialog` over it, the Diagnose buttons of the Needs-you card and the sheet, and the reads and writes behind them. Words: MAN-7870 (`cerberus.diagnosis.*`, `cerberus.promote.*`, `cerberus.activity.diagnosis.*`). Wire shapes: `CerberusDiagnosisView`, `CerberusDiagnosisStep`, `CerberusDiagStepEvent` in `src/shared/cerberus-types.ts`; `CerberusPromoteInput` in `src/shared/types.ts`. The buttons, `useDiagnosis` and the provider's three writes: MAN-7945. Routes: MAN-7918. Row map: MAN-7868. Design: `design/cerberus/Cerberus Tab.dc.html` :447-487 (the panel), :560-594 (Promote), :85 (the card's buttons).

## `sheet/DiagnosisPanel.tsx` — `DiagnosisPanel({ diagnosisId, held, onPromote })`
- Frame and eyebrows are Fix output's (`FRAME`, `EYEBROW`), `vv-pop` on arrival. Head: `diagnosis.eyebrow`, then the pill in a `role="status"`, keyed by `status`: `running` → `diagnosis.reading`, info `Badge`, `vv-pulse` 1.6 s; `done` → `diagnosis.ready` with `hms(endedAt)`, neutral, `cerberus-check` once; `failed` → `RUN_LOOK.failed` (`TriangleAlert` through `MarkIcon`, warn) and `diagnosis.failed`. why neutral for Ready: a diagnosis is a document, not a health signal; a green pill would say the check is fine while it is still red.
- Body: the scope sentence, by `diagnosis.scope`: `node` draws `diagnosis.scope` ("Read-only on <node>. It reads logs, status and Cerberus history. It can't run fixes or change files."), `history` draws `diagnosis.scopeHistory` ("Read-only. It reads Cerberus history: <node>'s logs and status were not reachable."); the steps in a `role="log"` labelled by the eyebrow, each a memoised `StepRow` rising in on `cerberus-line`: ● in the info ink breathing (`vv-pulse` 1.2 s) on the last step while `running`, ✓ (muted) otherwise, the text, `hms(startedAt + t × 1000)`.
- The steps fold once the diagnosis is over: a `Collapsible`, open while `running`, then on the person's press of its one line, `diagnosis.steps_*` ("7 steps · 17:53:14–17:53:45", a `CollapsibleTrigger` with the kit's `FoldChevron`, 44 px under `md`); the list sits in `CardFoldBody`, so a folded trail leaves the tab order and the accessibility tree. why: a finished diagnosis's answer is the signal and its steps the detail; unfolded, 14 steps put the summary below a phone's fold.
- `done`: under a rule (`shape-rise`), the summary in the serif display face (20 px, `text-wrap: pretty`), then each piece of evidence after an `aria-hidden` ↳ with a hanging indent. `failed`: `error` in the warn ink under a rule; no summary, no proposal, no "No fix proposed.".
- The Proposed fix box (`done` with a `proposal`; canvas ground, `vv-pop` 180 ms after the summary): eyebrow, name, `$ cmd` (`fix.command`); Run it once (primary) while `run` is null and the one-off is live, `disabled` while `held` (another run holds the check: center takes one at a time, and `CheckFixes` holds its other entries the same way); Add to catalog (tonal) while `promotedTo` is null; the ran line (`RanLine`): `proposal.running` while the run goes, `proposal.ranOnce` with `hms(startedAt ?? requestedAt)` and `proposal.result.*` once it started and ended, in its result's ink unless it succeeded, and `proposal.refused` with `hms(endedAt ?? requestedAt)` for a refusal, which never started; never run with its one-off gone, `proposal.expired` (`hms(oneOffExpiresAt)`) or, for one never published (`oneOffExpiresAt` null), `proposal.unpublished`, muted, both pointing at Diagnose again; ✓ and `proposal.promotedOff` / `promotedOn` in the positive ink, or `proposal.promotedRetired` with the id, muted and with no ✓, once the entry is retired; then the note for the buttons on screen: `proposal.note` with both, `proposal.noteAdd` with Add to catalog alone, none with Run it once alone. `done` with no proposal: `proposal.none`.
- The one-off's run draws as `FixOutput`, keyed by its id, straight under the box. why: the hand that pressed Run it once is at the box, and `proposal.running` says "output below". The sheet's own Fix output leaves that run out (`CheckSheet`'s `outputRunId`, MAN-7907), so it is never drawn twice.
- The one-off is live while `useStillAhead(oneOffExpiresAt)`: one `hostWindow.setTimeout` at the moment it expires, seeded at mount so a long-expired one-off never flashes its button. Nothing polls.
- Read out: `ReadingDiagnosis` (eyebrow written, shape shimmering, `aria-busy`). Read failed: `UnreadDiagnosis` (eyebrow, `UnreachableBanner` with Try again).
- Reads and writes: `useDiagnosis(diagnosisId)` (below) gives the diagnosis with its steps, `failed` and `refresh` (Try again). `promoted` is `promotedTo` resolved against the provider's catalog: `{ retired: false, name, auto }` with the entry's current name and auto, or `{ retired: true, name }` with the id itself once the catalog no longer holds it; `null` while `promotedTo` is null and while the catalog has not been read, so "not read yet" never says retired. Run it once is `runProposal(diagnosis.id)`; `starting` holds the button `aria-disabled`, reading `catalog.running`, through the press AND the panel's own re-read after it (`await refresh()`), so the button never comes back before the run shows under the box and takes a second press that center would refuse. A refusal is the provider's toast. Add to catalog hands the diagnosis to the `onPromote` prop.

## `modals/PromoteDialog.tsx` — `PromoteDialog({ open, diagnosis, check, onClose, onPromoted })`
- `DialogFrame` `size="lg"` (600, the nearer of the frame's two widths to the prototype's 580), `data-cerberus-dialog="promote"`, title `promote.title` with the accent `promote.accent`. Draws nothing unless open with a diagnosis that has a proposal and a check; keyed by the diagnosis.
- Top to bottom: `promote.from` (`hms(startedAt)`, counted by the evidence); Name (`Input`, starting as `proposal.name`, `maxLength` 100 = the server's `MAX_NAME_LENGTH`, amber `invalid` while blank, when the confirm is `aria-disabled`); When (a read-only `Field`: the check's label, or its key in mono, with `catalog.trigger.<when>` over `catalog.raw`, as the Catalog writes the entry), `when` being `diagnosis.when`, the word the server will write (the check's stored status when the diagnosis began: `warn` or `failing`), never a guess from the check's status now; Runs (`$ general` in mono on `bg-secondary`; helper `promote.generalized` when `general !== cmd`, else `promote.exact`); the `Switch` with `promote.auto` and `promote.autoOff` / `promote.autoOn` (context `warn` says "nears its limit"); Limit chips 1, 2 and 4 runs an hour (`promote.perHour`, 2 chosen at first, as the prototype), helper `promote.limitHelper`; Cancel (outline) and `promote.confirm` (submit).
- `promote.generalized`'s `used` and `saved` are `changedSpans(cmd, general)`: the words between the two commands' common start and common end (`--since 17:50` against `--since 15m` is `17:50` and `15m`; a side left with no span stands as its whole command). `saved` reads as `promote.last` with `time.minutes` or `time.hours` when it is a relative window (`15m`, `"15 min ago"`, `2h`), as written otherwise.
- Nothing is optimistic, as in Mute: `busy` holds every control and every way out. Confirm is `promote(diagnosis.id, { name: name.trim(), auto, limit: { runs, per: 3600 } })`, which raises the toast `promote.toast.*` when it lands; then `onPromoted()` and the root closes the dialog and the sheet and shows the Catalog, where the new entry stands first with its "New" badge and wash (`onClose` is only for the ways out that write nothing). A refusal raises the provider's toast and leaves the dialog open, controls free, with what was typed.

## Where it mounts
- `CheckSheet` (MAN-7878): `DiagnosisPanel` between Fix output and `CheckFixes`, from `detail.diagnosis`, keyed by its id; `held` is a going run that is not this diagnosis's own one-off; its `onPromote` goes up to the root as `onMute` does. `CerberusPanel` (MAN-7891) hosts the one `PromoteDialog`, between Mute and Enroll, in front of the sheet.
- `utils/activityEvents.ts` (MAN-7872): the `diagnosis` kind of What happened.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/PromoteDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/DiagnosisPanel.tsx

## MAN-7934 — Cerberus — the updates screen, live: the header's button, `UpdateWardensDialog`, a node's pill and restart, the warden lines of What happened

The updates screen, live on the tab: the header's Update wardens button (MAN-7891), the dialog it opens, the Updating pill and the restarting warden line on a node's card (`UpdatingPill`, `nodeLine`, `wardenLine`: MAN-7880), the `updating` and `paused` nodes under Updating (`fleetModel`: MAN-7872), and the `warden` kind of What happened (`activityEvents` `wardenEvent`: MAN-7872). Words: MAN-7870 (`cerberus.updates.*`; `cerberus.node.updating`, `cerberus.node.updatingWarden`; `cerberus.activity.warden.*`). Wire shapes: `CerberusWardens`, `CerberusUpdateView`, `CerberusUpdateStep` and `CerberusStartedBatch` (what `startBatch` returns and `POST /updates` answers), each in both contract files, `server/shared/cerberus-types.ts` and `src/shared/cerberus-types.ts`. Row map: MAN-7868. Design: `design/cerberus/Cerberus Tab.dc.html` :644-690 (the dialog), :48 (its header button).

## Where the screen reads
- `wardens` is the provider's (`useWardensRead`, MAN-7871): `GET /wardens` beside every overview read — the 30 s clock, a `cerberus_changed` frame, a write's re-read. A release built while the tab is open reaches the button within the clock's 30 s; a batch's every step does at once: an update's frames carry `updates: true` and are read without the gap, so the steps of an update that is over in 0.4 s are each on screen as they land.
- `useUpdateBatch(batch, seed)` reads `GET /updates/:batch` 2 s after each answer for as long as the dialog stands and some update of it has not ended: one read at a time, a failed one keeps the last answer. `seed` is what the dialog knew when it began following (the press's answer, or `wardens.running`), so it never flashes back to choosing before the first read. The hook answers whichever of its poll and its `seed` knows more, per update (`freshestBatch`: an ended update outweighs any steps, otherwise the steps it has — an update only moves forward), and the dialog keeps `seed` current with what `wardens.running` pushes on every update frame, so a step shows as it lands and not at the next 2 s read.
- `startUpdate(nodes)` is the provider's write (MAN-7871): `{ batch, updates }` on a landed start; `null` after a refusal's toast, and `null` with no toast on a landed start whose 200 body cannot be read: the dialog adopts the batch from `wardens.running`.

## `modals/UpdateWardensDialog.tsx` — `UpdateWardensDialog({ open, onClose })`
- `DialogFrame` `size="lg"` (600, the prototype's own), `data-cerberus-dialog="update"`, title `updates.title` with the accent `updates.titleAccent`. Draws nothing unless open, and nothing while `latest` is null.
- The note: `updates.note` (`latest.version`, and `latest.note` with its own trailing full stop dropped, since the sentence brings one), then `updates.kept` counted by the versions kept for rollback: the ticked nodes' while choosing, the batch's `from`s once it runs, distinct and oldest first (numeric collation), joined by `updates.versions` when there are several; left out when there are none. A node the offer found already on the release (`from === to`) swapped nothing and keeps nothing: its version is left out, here and in What happened's "updated to <v>" line.
- A row per `wardens.nodes` entry, in the read's order. While choosing, a node that can take the update (`canTake`) is a `Checkbox` (`src/shared/ui/Checkbox.tsx`, painted by `.vv-checkbox*` in `verve/panels.css`: MAN-740) labelled `updates.node`; its `className="py-3"` makes the whole 44 px row the press target, and it is disabled while Update N nodes is out. Every other row is the same words plain (the bare id when it has no version) with `rowState` on its right, 12.5 px medium. In the batch: `updates.queued` (muted) until its first step, then that step's text behind the info ● breathing (`vv-pulse` 1.2 s), then ✓ `updates.updated` (positive — the handshake, the new warden's hello that ends the update, is not a step of the wire, and this mark is how the dialog shows it), ✕ `updates.rolledBack` with `from` (warn), or ▲ before the last step's text for `failed` (warn). Outside it: `updates.current` with the node's own version when it is not behind, `node.waiting` with no version, nothing when it is behind. A state is keyed by its words and fades in (`vv-fade` .25 s).
- Under a row in the batch, its steps: a `role="log"` labelled by the row's words, mono 11.5 px on the canvas ground, `hms(at)` in the muted ink then the text, the `failed` step in the warn ink, each rising in on `cerberus-line`, keyed by `at` and `step`. why the canvas: the times' muted ink measured 4.46:1 on the prototype's surface2 in light, under AA; 4.73:1 on the canvas, 8.07:1 in dark.
- The footer: a `role="status"` region mounted from the first frame, then the buttons. Choosing: the region empty, Cancel (outline) and `updates.start` counted by the ticked nodes that can take it, `aria-disabled` at none and while out, `aria-busy` while out, the press guarded. Running (any update's `result` null): `updates.running` (muted) and Close (outline). Ended: ✓ `updates.done` (positive) when every update ended `updated`, else ▲ `updates.missed` counted by those that did not (warn), both naming the release the batch took its nodes to (the batch's own `to`, never `latest`, which a newer build may have moved), and `updates.finish` (primary). why the second ending: an ending is never said greener than it was. Every button is 44 px below md. The footer row is pinned (`sticky bottom-0`, `z-10`) on the panel's own ground (`bg-card`) under a hairline (`border-t border-border`), `pt-3 pb-4` with `-mb-4` laying its bottom padding over the frame's. why: the panel scrolls as a whole, and the first focus — Close or Done while a batch runs or has ended — sat below the fold on a phone, so a tall batch opened scrolled to its foot with the title, the ✕ and the note out of view; pinned, it opens at its top. The list gives its inputs `scroll-mb-28`, so a Checkbox the keyboard reaches is scrolled in clear of the pinned footer.
- Nothing is optimistic: `starting` holds the Checkboxes, Cancel and the ✕, and a row moves only when the batch's read does. Closing never stops a batch.
- State: `followed` (`CerberusStartedBatch | null`: the batch the dialog follows with its updates as they stood; set by a landed start, or adopted from `wardens.running` the moment it holds one — as the dialog opens, or after a refused start (409 `CERBERUS_UPDATE_RUNNING`) when the re-read brings the batch that is going; replaced by `freshestBatch(followed.updates, wardens.running)` whenever the pushed batch knows more; kept after the wardens read drops an ended batch, so the ending stays up until Done), `selected` (the ticked nodes, starting as every node that can take the update; a Checkbox's press adds or takes away), `starting` (Update N nodes out). The batch the rows draw is `useUpdateBatch(followed?.batch ?? null, followed?.updates ?? [])`; null while choosing.
- A reopened dialog over a running batch is not choosing: it adopts the batch and follows it. An ended batch is gone from `wardens.running`, so a dialog opened after it ended is choosing again.

## `fleet/UpdatingPill.tsx` — `UpdatingPill({ updating })`
- `<Badge as="span" tone="info">` with `max-w-full whitespace-nowrap` and `vv-pulse` 1.6 s (motion-safe), "Updating · " + `updating.text` (`node.updating`) in a `truncate` span: the warden's own sentence for its latest step, or center's while the update has no step yet ("Offering warden 0.8.0", "Waiting its turn"). On a list row and an open grid card, before the warden line.

## `utils/wardenUpdates.ts`
- `canTake(node)`: `behind && version !== null`; read by the header and the dialog so neither offers what the other would refuse.
- `freshestBatch(held, incoming)`: two reads of one batch laid together, per update (in `held`'s order) whichever knows more — an ended update outweighs any steps, otherwise the steps it has; read by `useUpdateBatch` (its poll against its seed) and the dialog (its `followed` against `wardens.running`).
- `batchPlace(running)`: `{ index, of }` for the header's "i of n": the first update with no `result`, counting from 1, of the batch's length; the last place when all ended but the read still holds the batch; `null` with no batch.

## Prove it
- `node .verify/cerberus-updates-whole-live.mjs --evidence <dir>` runs the whole update on the live tab (:5183): two real tabs, one holding the dialog and one the node's open card, the press, the steps, the pill, the paused cell in the sheet's strip and What happened, with 1440×900 shots and every change of what a reader saw stamped from the batch's start at center (its `startedAt`: one clock for every figure). Before the press it throws unless the dialog offers exactly one Checkbox, `<node> · warden <from>`, and "Update 1 node" (the dialog ticks every node that can take the update, so another node behind would be sent too). It reports the independent `/ws` client's socket as "opened +N ms … closed at +N ms" or "never opened". `--after <batch>` runs only what follows the update (the REST reads, the sheet, What happened), read-only, for a batch that already ran; the sheet's strip holds the last 60 minutes, so about an hour after the update the restart's minute has left it and that leg says so instead of checking it.
- A restart is on screen for about 0.35 s, so each page's reads are held (`.verify/lib/update-run-kit.mjs` `holdAfter`) once it has drawn the restart, the shots are taken, and the reads are let go: nothing is altered, only fetched late.
- `SUNSET_SLOT=8 bash .verify/cerberus-updates-whole-scratch.sh <dir>` is its rehearsal: the same script against a scratch center, a scratch warden named `eis1` under its launcher and a scratch Vite (its own dependency cache, `.verify/lib/vite-scratch.config.mjs`; held open by a pipe on stdin, since Vite ends itself when its stdin does).

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/UpdatingPill.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useUpdateBatch.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useWardensRead.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/UpdateWardensDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/wardenUpdates.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-updates-whole-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-updates-whole-scratch.sh, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/update-run-kit.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/vite-scratch.config.mjs

## MAN-7945 — Cerberus — the diagnosis screen, live: `DiagnoseButton`, `useDiagnosis`, `useDiagnosisVerbs`

The diagnosis screen's buttons and reads, live: `DiagnoseButton` (the Needs-you card's and the sheet's Diagnose), `useDiagnosis` (one diagnosis and its steps, kept live) and `useDiagnosisVerbs` (the provider's three writes). The panel and the dialog they feed: MAN-7932. Words: MAN-7870. Routes: MAN-7918. The provider's verbs: MAN-7917. Row map: MAN-7868.

## `DiagnoseButton.tsx` — `DiagnoseButton({ node, checkKey, label, disabled?, onStarted? })`
- An outline `sm` `Button` that asks for a diagnosis through the provider's `diagnose(node, key)`, which sends no model. `pressing` (state) holds it `busy` and reading `diagnosis.diagnosing` for the press, `aria-disabled` and never `disabled`, so the hand that pressed it keeps its focus. The `disabled` prop is the card's alone: set while the card is leaving (its check no longer needs you), the button drawn as it was and taking no press. A landed press calls `onStarted` and stays busy until what it returns settles; a refusal (409 `CERBERUS_DIAG_RUNNING`) is the provider's toast. why: center's hint for the check is coalesced to the trailing edge of its one-second window, so for up to a second after the start the sheet's own read held no diagnosis, and a button that came back at center's answer was an enabled "Diagnose" over a diagnosis already running: a second press was a refused POST and a warn toast.
- On the Needs-you card (`NeedsYouCard`): drawn while `need.diagnosis` is null, "Diagnose" (`diagnosis.diagnose`), and `onStarted` opens the sheet on the check, where the steps arrive. Once the need has a diagnosis (`need.diagnosis`: the check's newest since it went bad) the button is a plain outline `Button` that opens the same sheet: "Diagnosing…" (`diagnosis.diagnosing`) while it runs, "See diagnosis" (`diagnosis.see`) once it ended, whatever its outcome.
- In the sheet's action row (`SelectedCheck`, before Mute): "Diagnose" while the check has no diagnosis, "Diagnose again" (`diagnosis.again`) once it has one. Not drawn while the diagnosis runs (center takes one at a time on a check), and not until the check's own read has answered (`diagnosisRead`), since until then nobody knows which word is true. Its `onStarted` is the sheet's own check read (`useCheckDetail`'s `refresh`, through `SelectedCheck`'s `onDiagnosisStarted`), so the new diagnosis stands before the button lets go: the button then goes (the diagnosis runs) and its panel, keyed by its id, replaces the old.
- `CheckFixes`' empty note gains `diagnosis.hint` after its own sentence, in the one dashed box.

## `hooks/useDiagnosis.ts` — `useDiagnosis(diagnosisId)` → `{ diagnosis, failed, refresh }`
- The diagnosis as `GET /api/cerberus/diagnoses/:id` answers it, its steps merged by `n` from two roads: the read brings every step the diagnosis holds, and each `cerberus_diag_step` frame for this id (a picture, not a hint: no re-read) brings the one just stored; a step both carry is kept once, and a frame for another diagnosis is ignored. Frames that land before the first read answers are kept and merged into it.
- Everything else (status, summary, evidence, proposal, `run`, `promotedTo`) is only ever what a read said. A read is made again when a `cerberus_changed` hint names the diagnosis's check (`<node>/<check key>`: the diagnosis ended, its one-off ran, it was promoted) and on `websocket_reconnected`. Only the newest read's answer is applied; a read that did not answer sets `failed` until a read does, and keeps the last good answer; the panel draws `failed` only while there is no answer. An answer is a diagnosis when `id`, `node`, `status` and `steps` are there; `evidence`, `proposal` and `run` are then defaulted (none, null, null) as the overview's `withFixFields` does, since the panel dereferences them and a server that drifted from the client must not stand the error boundary in place of the tab.
- `refresh()` reads once more and resolves when that read has settled (Try again; the panel awaits it after Run it once). State carries its diagnosis's id, so a panel handed another id never draws the first's answer.

## `hooks/useDiagnosisVerbs.ts` — `useDiagnosisVerbs({ writeOnce, settleWrite, toast, tRef, mountedRef })`
- The provider's three writes, split out of `CerberusProvider.tsx` (already past 500 lines) and built over its guards: one write per target (`diagnose:<node>/<key>`, `run-proposal:<id>`, `promote:<id>`, so a double press is one write), `settleWrite` (the fleet is re-read before the verb answers; a refusal is the warn toast with the server's sentence). `diagnose` and `runProposal` are silent when they land: the card's "Diagnosing…" and the panel's "Running now" are the proof. `promote` speaks, since its result is on another tab: "Added to the catalog" · "<name> · auto-run off" (`messageOn` when auto was set), the name from the entry the server wrote, or the typed name when the answer's body is unreadable: a landed write stays landed (`response.ok` is its verdict), never a refusal.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/DiagnoseButton.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useDiagnosis.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useDiagnosisVerbs.ts

## MAN-8918 — Cerberus — the kept views: KeptView and useKeptViews (Tours and Bulletins stay mounted, hidden once left, with their scroll)

The one small piece the Cerberus tab's two kept-mounted views share (Tours: MAN-8575; Bulletins: MAN-8880), so `CerberusPanel.tsx` holds no second copy of either view's mount, hide or scroll lines. The panel's side: MAN-7891 (layout, state, and the rule for why the views share one scroller).

| file | what it is |
|---|---|
| `hooks/useKeptViews.ts` | `useKeptViews(view, scrollerRef)` → `{ shownOnce, leaving }`. `shownOnce` is state: the views shown at least once, with the current view added while rendering (React renders again at once, before anything is drawn, so a view's first frame is already mounted). `leaving(next)` is called by the strip's press before the view changes and writes the scroller's offset for the kept view being left; a layout effect on the view writes that offset back as the view returns (a first show starts at the top). `KEPT_VIEWS` (`tours`, `bulletins`) is the list of views whose offset is kept |
| `KeptView.tsx` | `<KeptView id view shownOnce label>{lazy view}</KeptView>`: renders nothing until `id` is in `shownOnce`, then a `role="tabpanel"` named `label`, `hidden` unless `view === id`, around `<ViewBoundary view={label}>` (MAN-8917). Nothing on the wrapper sets a display, so `hidden` takes it out of layout |

## Rules
- A new kept view is one entry in `KEPT_VIEWS`, one `VIEWS` row and one `<KeptView>` in the panel: never a second mount block in `CerberusPanel.tsx` (it stays under 300 lines).
- The offset is written in the press (`leaving`), not in an effect or a render: the panel of the view being left is `hidden` by the commit that follows the press, and the browser then clamps the scroller to the shorter content, so an effect reads the clamped offset. Reading a ref during render is the other way to get it, and the house lint (`react(refs)`) flags it.
- The strip scrolls with the content (the header, the strip and the view are one scroller), so a person leaves a view from an offset at which the strip is on screen: that is the offset that is kept, and a probe that scrolls past the strip must scroll back to it before it presses (a Playwright click scrolls the strip into view first and moves the offset it is meant to find).
- A kept view reads on open and on a press and never on a timer or while hidden, so kept mounted it costs nothing; a view that must read of its own accord while hidden does not belong here.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useKeptViews.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/KeptView.tsx
