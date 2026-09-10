# Verifying a change in this fork

A change is proven here by running the real application: the dev server serves it, a
Playwright script drives the real user interface against it, and the mechanical checks come
back no worse than the recorded baseline. This fork does not verify by unit test.

## The dev server

It runs as two systemd units, not in your shell — `cloudcli-server-dev.service` (the API under
the handover supervisor, :3011 loopback) and `cloudcli-client-dev.service` (Vite, :5183 on every
interface); see [hosting.md](hosting.md). Check before you touch anything:

```bash
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5183/   # 200 = healthy, leave it alone
systemctl is-active cloudcli-server-dev cloudcli-client-dev
journalctl -u cloudcli-server-dev -n 40 --no-pager                # the API's log — read this first
```

Start it only when a unit is not `active`:

```bash
sudo systemctl start cloudcli-server-dev cloudcli-client-dev
```

Both halves reload themselves — Vite for `src/`, the dev-supervisor for `server/` — so no
code change needs a restart. A `server/` edit hands over: the supervisor boots the edited
server beside the running one and retires the old one only when the new one reports READY.
A `server/` edit that fails to load never parks the API: the previous server keeps serving
and the journal carries one `[supervisor] boot failed — previous server kept:` line naming
the error; fix the edit and it hands over. Chat sessions ride the keepalive through both.

Ports live in `.env` and are deliberately not upstream's defaults: the backend is on
**3011** because a Caddy container for another local service already owns 3001, and Vite is
on **5183** rather than 5173. `.env` also pins `HOST=127.0.0.1`, `CLAUDE_CLI_PATH`, and the
context-window values.

## Mechanical checks

```bash
npm run typecheck    # tsc over both tsconfigs — must exit 0
npm run lint         # oxlint over src/ and server/ — must exit 0
```

`.verify/baseline.txt` records what those produced before the
Verve integration began: typecheck clean, lint clean, and **128 pre-existing warnings**.
That count is a ratchet — a change may lower it, never raise it. It reads **130** from Phase 3
on: `ToastContext.tsx` exports `useToast` and `useToasts` beside `ToastProvider`, and each
export raises `react(only-export-components)` — the shape thirteen of this repo's own context
files already have, so the number was re-recorded rather than waived. The file says why in
full. `npm run build` is not part of verification and the dev server never needs it.

## The browser harness

```bash
node .verify/all.mjs
```

`all.mjs` runs every `.verify/phase-<n>.mjs` in numeric order and fails the run if one exits
non-zero or prints a line beginning with `[FAIL]`. A `[NOTE]` line is an observation and
never fails a run. Each phase script opens with `openConsole()` from `.verify/lib/console.mjs`,
which launches headless Chromium, signs in through the real forms, lands on a selected
project, and hands back the page plus `shoot()`, `api()`, and the console errors it collected.

The page runs with the service worker **blocked** and the app's two `api.github.com` calls
**answered locally** — browser-context settings that `src/` knows nothing about. A service
worker's fetches never reach Playwright's `page.route`, so with the worker allowed the stubs do
nothing and a cached bundle can be photographed in place of the change. The stubs return `{}`
to the star count and the update check, and each hook takes its own "we don't know" branch;
left to the network, GitHub's 60 anonymous requests an hour run out mid-run and the gate
measures GitHub's quota rather than this app. They match by exact endpoint: a **third** GitHub
endpoint, or any new third-party origin, goes to the network and reddens the gate — how a new
outbound call is meant to announce itself, not a fault to route around. `.verify/lib/color.mjs`
reads colour as Chromium reports it (`rgb()`, plus the `color(srgb …)` form every color-mix'd
Tailwind colour now resolves to) and measures WCAG contrast, returning `unmeasurable` rather
than a number for anything translucent.

`.verify/` is git-ignored on purpose: the screenshots are large binaries that churn on every
run, and the scripts describe one operator's machine. Nothing in the shipped application
imports from it. Playwright is not a dependency of this repo either — `console.mjs` imports
it by absolute path from `/opt/shadow-connector/node_modules/playwright/index.js` (1.58.2,
Chromium build 1208 already cached), so `npm install` here pulls no browser stack.

Screenshots land in `.verify/shots/` as `<phase>-<screen>[-<width>]-<light|dark>.png`;
`0-git-390-dark.png` is the Source Control tab at 390px wide in dark mode. The mode suffix
comes from the same flag that set the colour scheme, so it cannot disagree with the pixels.
View a shot before citing it.

Phase 2's script is the first to photograph something no one can navigate to. Nothing mounts the
new controls until Phase 4, so it imports the real modules from the running dev server
(`/src/shared/ui/index.ts`, Vite's own React), mounts a gallery of all twelve over the signed-in
page, drives it — the Switch flips, the Select takes Escape — then unmounts: `2-library-light.png`
and `2-library-dark.png` are that panel, not a screen. Its ratchets are mechanical rather than
colour (`controls.css` ≤ 300 lines, each new component ≤ 160, no colour utility in any of the
twelve), and its two colour readings print as `[NOTE]`: an OFF Switch's track and the Meter's
unknown-state role, both left as palette and ARIA calls in the integration plan's §13
(`~/.claude/plans/cloudcli-verve-integration.md`). The table below is still Phase 1's.

Phase 3 mounts a panel the same way — `3-library-light.png` and `3-library-dark.png` are its
nine, not a screen — but photographs its overlays on real ones: `3-dialog-open-*` is the
Command Palette, which is a `DialogContent` today, and `3-toast-over-settings-light` is a toast
standing above the open Settings modal, which is what the stack's z-index exists to do.

Phase 6 is the one probe that spends money, and it spends it once: it drives a real turn through the
composer only when no reply is on disk, and every later run reads the haiku answer already recorded
in that session. The integration is budgeted at **6 Claude turns**, and Phase 11's single press
spent the last of them: **all 6 are spent**, so a phase that wants another turn has to replay
instead. Its
badges are not read off that transcript — a stored conversation says a tool RAN, never that a person
was asked, so "Waiting for you" and "Allowed by you" can never appear in one. The phase drives
fixtures through the real `useToolPermissionState` and `deriveToolOutcome` instead (phase 2's
technique) and photographs those. Its contracts are at [chat-contracts.md](chat-contracts.md).

Phase 7 opens no browser at all: the files server is a set of HTTP contracts, so `phase-7.mjs`
signs in through the real login route and drives them with `fetch`. It touches no page and no
dev-user preference — safe to run beside a browser probe. Its contract is at
[files-api.md](files-api.md).

Phase 8 is back in the browser, and its hardest reading is a negative: the file manager may not draw
an image's `1440 × 900` before the browser has measured it, so `phase-8.mjs` samples the pane every
few milliseconds from the click onward and fails if any frame carried a `×` too early. It reads
the DOM back against the API's own bodies — an entry the listing reports with `bytes: null` must
read `—` on screen, never `0 B` — and it writes: the same file uploaded twice lands as `x (1).txt`,
both removed through the tree's own menu, `git status` read after rather than assumed. It spends
no Claude turn — its chat card is on disk. Its contract is at [file-manager.md](file-manager.md).

Phase 9 asks Vite what tsc cannot: `phase-9.mjs` imports `markdown-preview`'s barrel and
`PrdEditorBody.tsx` through the running dev server, so a specifier that typechecks against the
alias and then 404s is caught. The rest it reads on screen — a stored fenced `json` block still
rendering in the transcript, Appearance carrying no editor section, the four legacy `codeEditor*`
keys seeded and found untouched, and the palette's file row landing in the Files tab. It spends no
Claude turn, and one reading is out of reach: no stored conversation carries a mermaid fence, so
`MermaidDiagram` is proven as far as its module resolving and no further.

Phase 10 photographs a panel whose whole job is to report, so most of its gates read what is on
screen against what the server said over HTTP — the ahead count comes from
`/api/git/remote-status`, read with the page's own token, never off the panel's text. Its hardest
gate is a negative of a different kind than Phase 8's: it scans the Source Control landmark for a
control that WRITES, as controls rather than as text, with each changed file's path subtracted
from the label first. Both halves are load-bearing — the panel's own required copy says "Claude
handles commits and pushes for this project", and a changed path in this repository carries the
word `branches`, so a literal text scan would redden on the phase's own spec. Four shapes no
registered project on this host is in are replayed verbatim from `git.routes.ts` — a branch with
no tracking ref (**no `ahead` key at all**), a repository with no commits (`hasUpstream:false`
*with* `ahead:0`), a failed remote-status read and a failed commits read — because each must be
told apart from "everything is pushed" and none of them can be produced here. So is an empty
commit diff, which the route cannot produce at all: §7c proves that by reading a real merge commit
over HTTP and finding a header with no patch, and notes in passing that a merge row still draws a
zeroed stats card above it. The shots are `10-git-pending-{light,dark}`, `-history`, `-390`,
`-no-upstream`, `-no-commits`, `-upstream-unread`, `-failure` and `-empty-commit-diff`. It spends
no Claude turn and writes nothing, but four of this host's own registrations are its fixtures:
this fork with its dirty working tree, `.claude` genuinely ahead of its upstream, `tmp` as a
directory holding no repository, and the stale `mission-control` whose directory is gone.
Committing or cleaning this tree changes what it measures. Run it solo like every browser phase —
it ends in a second, dark session and drives the app's own theme switch back before closing. Its
contract is at [git-panel.md](git-panel.md).

Phase 11 presses a button wired to the operator's own `/git`, so its first job is making a press
free. Every press but one happens behind a socket seal — a patched `WebSocket` installed in the
page before the app loads, which swallows `chat.send` and `chat.subscribe` — and the seal is proven
two-sided immediately before each one: unsealed, a `chat.send` for a session id the server has never
heard of must come back `protocol_error SESSION_NOT_FOUND`; sealed, that same frame must get no
answer at all. Silence is only evidence once the frame is known to be answerable, and the seal is a
page global that any navigation resets, so the canary is fired at every press rather than once at
the top — a press the seal does not cover throws rather than proceeding. The exception is the one
real turn, which is spent once and kept. That press deliberately opened the seal, and what made it
safe was not the seal but what the button was pointed at: it is reachable only with no artifact on
disk AND the page built with a temporary `/git-rehearsal` command (three git reads and nothing that
writes) pointed at by `VITE_GIT_DELEGATION_COMMAND`. Its observations — the session row, the
`chat.send` frame byte for byte, the step marks, the banner and its tone, the trio of git reads that
fired on the finish, and the real frame shapes the gateway sent — live in
`.verify/artifacts/phase-11-press.json` and are read back on every later run. Deleting that file is
how you re-measure, and it costs a turn. The rig is down now, and both halves travel together: a
`.env` line without the command file it names, or the reverse, reddens a gate of its own. So the
suite runs in the configuration that actually ships — the card prints `/git` — and what makes that
safe is the seal rather than which command the page was built with. Every state the rehearsal could
not reach is produced by pressing the real button on the sealed socket and injecting the gateway's
own frame shapes over `git.routes.ts`'s own bodies (phase 10's technique, extended to the
websocket): the pushed receipt, the ahead banner, each of the five push-failure reasons, the agent
error, a reconnect that must re-subscribe from the last seq it saw, a run left in silence until the
watchdog ends it, a tab round trip, a reload and a second browser context both adopting the run, a
renamed conversation adopted off its first user row, a deleted session row skipped, a guard that
answers 401, and a checkpoint running in another project refusing the press here. Two of its
readings are estate-wide rather than in-app: the six edits to the operator's own `git.md` are
asserted as a diff, and the newest `/git` grant marker in `~/.claude/state` is recorded before and
after — `/git-rehearsal` matches the push guard's `/git` + word-boundary pattern, so the rehearsal's
own CLI session was granted a push it never took, and any grant for another session would mean a
real `/git` was said somewhere. The shots are `11-git-idle` (light and dark), `-running`,
`-running-read-done`, `-pushed`, `-banner-ahead`, `-banner-not-committed`,
`-banner-connection-lost`, `-adopted-second-window`, `-adopted-after-silence`,
`-dismiss-held-by-the-server` and `-refused-checkpoint-elsewhere`. Its contract is at
[git-panel.md](git-panel.md).

Phase 12 opens no browser either: the Descent proxy's accounts lane is four HTTP contracts, so
`phase-12.mjs` signs in through the real login route and drives them with `fetch`. What the live
picture cannot show — the null discipline, a rolled percent, a vendor `severity`, a Descent that is
down — it measures under `tsx` against bodies copied from Descent's own handlers, a closed port and a
socket that stalls mid-body. It never calls `capture` nor sends `switch` a real slug, since either
moves the operator's live Claude login; the refused `__no_such_slug__` is how Descent's own verdict
is shown to travel through intact. Its 40 gates are the accounts lane's alone, and stayed 40 when the
memory lane joined the router: what changed is the down-Descent snippet, which now mounts the real
router the way `descent.module.ts` mounts it — BOTH lanes — because a probe left constructing it one
argument short measures a proxy nobody ships. That snippet is also why its `tsx` runs name
`server/tsconfig.json` through `TSX_TSCONFIG_PATH`: the repo root maps `@/` to `src/`, so without it
the memory service's runtime import of `readObjectRecord` from `@/shared/utils.js` loads the frontend
file instead. Nothing under `runTsx` here reaches the memory mapper, so no assertion in this file
would catch that — deleting the env leaves all 40 green — which is the reason the line is commented
where it sits rather than left to look like decoration. Its contract is at
[descent-proxy.md](descent-proxy.md).

Phase 13 is back in the browser, and it splits its evidence in two rather than choosing between
them. Everything the operator's own Descent can answer — the label on the footer row, the figure
beside it, which row carries the tick, how many slots there are, and which of them sit past their
stamp — `phase-13.mjs` reads live through the proxy with the page's own token and holds the screen
against it. Everything Descent is not doing today it replays into the two READS with `page.route`,
so a `percent: 0`, a null, a rolled window, a vendor `severity`, a degraded reading, a drifted login
and four shapes of expiry are all measured without a server, an environment or an account being
touched. It presses no Switch and no "Save it", and it does not log in: the provider's login modal
is opened by its own title and closed again, the one capture that crossed the wire counted at the
network layer rather than inferred, and the account picture read back afterwards to prove it is what
it was. Two of its gates measure a door rather than the room behind it — a probe pair registered
exactly as `ChatInterface`'s abort listener is, asked what it sees while the panel is open and
again while it is closed; and the unit trap driven both ways round, since a seconds-shaped expiry
must land in 1970 and a millisecond one must not land in the year 58,000. 88 gates over a dark pass
and a light one, and it spends no Claude turn. Its contract is at [accounts.md](accounts.md).

Phase 14 stays out of the browser too: the CLI-version report is one HTTP contract over a service
whose failure paths have to be injected, so `phase-14.mjs` drives the route with `fetch` and builds
the service under `tsx` around a binary that is not there, one that answers nonsense, and a clock it
moves by hand — the cache window's far edge is measured rather than assumed. It spends one real Haiku
turn, a `sleep 20` wide enough to ask the route mid-run, and spends it once: the observation is kept
in `.verify/artifacts/` and read back on every later run, so re-measuring means deleting that file
and paying a turn for it. Its contract is at [cli-version.md](cli-version.md).

Phase 15 is the client half of that report, and it spends **zero** Claude turns — the plan's own
verification wanted two more plus a CLI shim, a `.env` edit and a server restart, and the six above
are all gone. So both sides of the disagreement are replayed instead. `/api/cli-version` is answered
inside the page, which is what lets `installed` and a run's `cliVersion` differ without a binary,
an `.env` line or the server moving: the server-side stamping those numbers come from was proven
live in Phase 14 and is not re-proven here. The websocket is sealed the way Phase 11 seals it —
`chat.send`, `chat.edit-send`, `chat.abort` and `chat.subscribe` swallowed inside the page — and the
seal is re-proven two-sided immediately before every press rather than once at the top, since it is
a page global any navigation resets; a press the canary cannot cover throws instead of proceeding.
The run being acted on is replayed too: `chat_subscribed {isProcessing:true}` puts the conversation
into the processing map the way the gateway's own ack does, and the abort's terminal `complete` is
injected in the shape `createCompleteMessage` builds. `POST /api/providers/sessions` is answered
in-page throughout, so a regression could not write a conversation to the operator's disk. What is
left genuinely measured is which frames the PAGE put on the wire, for which conversation, in what
order, how long after the `complete`, how many a double press produces, and what all three surfaces
render for each replayed report. Ten replays carry the endings: the conversation stopped and resumed
where it was pressed (R1), the person opening another conversation mid-stop (R2) or "New Session"
(R3), a press on a run that has already ended — which the report cannot know for up to 60 s (R4) —
a socket that drops between the stop and the resume (R5), a stop the gateway never confirms (R6), a
settled restart that must not refuse a *second* stale conversation (R7), a banner that must come
back on a reading rather than on a clock (R8, measured against a deliberately slowed route), a
post-send read that never arrives and falls through to the 20 s backstop (R9), and a 200 carrying
something that is not a report (R10). Nineteen of its gates open no browser at all and read the
source off disk — the forbidden shared-hook shape, the deadlines anchored to their own phase's clock,
the two line caps. The live baseline is not replayed: the real route is read with the page's own
token and the footer held against what the binary answers now, which is why the plan's `2.1.261` does
not appear as a literal — this host has since moved to 2.1.263. 119 gates over a dark pass and a
light one; the dark pass exists for the banner's paint and stops after it. It creates no shim, edits
no `.env`, touches no `server/` file, restarts no pane and starts no conversation — and the route is
re-read at the end to show the server saw no run start. Shots are `15-baseline-footer-light`,
`15-stale-chip-light`, `15-banner-light`, `15-banner-dark` and `15-resumed-light`. Its contract is
at [cli-version.md](cli-version.md).

Phase 17 is the flat list's own proof, and it also spends **zero** Claude turns. Two real
conversations are created — a real `POST /api/providers/sessions`, a real row tagged
`simple_list_at` — but the websocket is sealed the way Phase 15 seals it, `chat.send`,
`chat.edit-send`, `chat.abort` and `chat.subscribe` swallowed inside the page and the seal
re-proven two-sided right after the reload that turns simple mode on, so a regression that let a
send slip through would be caught before anything is pressed. Because Phase 2 made the server
default `true`, `openConsole` itself now PATCHes `simpleChatList: false` right after sign-in and
reloads before it waits for `PROJECT_ROW`, so every earlier phase keeps opening on the project
tree it always has; `phase-17.mjs` is one of the harnesses that flips the preference to `true`
itself and back in its own `finally`. `probe-simple-settings.mjs` and `probe-simple-view.mjs` are
the cheap smokes underneath it — the toggle exists in Settings, and the view mounts and unmounts
cleanly — so `phase-17.mjs` does not re-prove either; what it proves instead is a New chat's POST
carrying `simpleList: true` for the dropdown's own project, the row that appears naming both the
chat and its project, the sealed send leaving nothing but the frame itself on the wire, a rename
round-tripping through a real `PUT`, opening two different rows and the Files tab reading each
row's own project, an idle Remove archiving without ever opening the stop dialog, and toggling off
handing the tree back. Its contract is at [simple-chat-list.md](simple-chat-list.md).

Phase 18 is the flat list's stop-and-remove path and its mobile width, and it too spends **zero**
Claude turns. Over the same sealed socket Phase 17 seals, two things are replayed rather than run
for real: a processing ack (`chat_subscribed { isProcessing: true }`, the gateway's own ack shape)
kept alive against `SessionProtectionContext`'s 5s running-sessions re-sync — a bare re-injection
cannot outrun that sync's 10s local grace window, so `phase-18.mjs` also splices the armed id into
`GET /sessions/running` itself, the way `phase-15.mjs` answers `/api/cli-version` inside the page —
and, once the row's abort is proven, a terminal `complete` in the shape `createCompleteMessage`
builds. What is measured: that Remove on a busy row opens the stop dialog rather than archiving on
the spot, that Cancel leaves it standing with nothing sent, that Confirm puts exactly one
`chat.abort` on the wire for that row's own id, that nothing archives in the 3s the run is still
live, that the archive follows the injected complete and not before it, and — on a second row
whose complete never arrives — that `useSimpleChatRemove`'s own 15s fallback timer is what
archives it, landing 14-20s after the confirm click. The mobile pass resizes to 390px, opens the
sidebar the way a thumb would, and reads the live DOM rather than the source: the New chat button
and the row's own link (not the row `div`, which the fix never had to touch) both measure at least
44px tall and stay inside the viewport, in both themes. Shots are `18-simple-stop-dialog-light`,
`18-simple-390-light` and `18-simple-390-dark`. Its contract is at
[simple-chat-list.md](simple-chat-list.md).

Phase 19 is the Descent proxy's other lane — memory intake — and it opens no browser either: four
more HTTP contracts with nothing visual about them, driven with `fetch` behind a token from the real
login route. Its first duty is to decide no real card. Approving one writes into a file every future
session in a project reads, and rejecting one destroys a proposal, so the write path is proven
against ids that cannot move anything: one Descent does not have, a malformed one refused at the
route, and one Descent already lists as approved, which it refuses before touching disk with its CAS
matching zero rows. Twelve gates, in this order: the lane sits behind the app's auth like its
accounts sibling (1); the live list's count matches Descent's own and every row carries exactly the
lean key set (2-3) — a key-set inspection over the parsed rows, never a substring scan of the
response text, since an operator-authored `name` containing "body" would redden a proxy behaving
correctly; one candidate reads whole by id, body and all (4); an unknown id is a calm 200
`candidate:null` rather than a 404, because a read never fails (5); a write carries DESCENT's verdict
— its 404 and the cap guard's 422 arriving in its own words, with item 10 comparing the proxy's body
against Descent's byte for byte, since a rewritten refusal is one the reviewer cannot act on (6-7,
10); a malformed id never travels, on approve AND on reject (8-9); and the lane stays calm when
Descent is down, item 11 measuring the service and item 12 the MOUNTED router with both lanes wired —
200 on both reads, 503 only on the write (11-12). Items 3, 4 and 7 depend on what the board holds:
with an empty pending queue, or nothing approved, each prints a `[NOTE]` and no gate, so the PASS
count moves with the queue rather than staying pinned. Like phase 12, the down path is measured
against a closed port and never by stopping the operator's Descent — which, with nothing pending ever
written to, is what makes this one safe to run while the operator is in the app: it toggles no
preference, moves no card and opens no browser. Its contract is at
[descent-proxy.md](descent-proxy.md).

Phase 20 is that lane's screen — the Memory tab — and it is back in Chromium. Eleven gates, in
three movements: the tab is on the strip and carries the pending count while its `aria-label` stays
the bare word `Memory` (1-3), and it selects (4); the panel behind it draws one
row per waiting candidate, marks the global-blast one, reads a body whole on expand and offers both
verbs (5-8); and the sticky rule, which is this phase's own decision, is driven both ways — the tab
HELD on the strip and still selected at a count of zero, showing *All filed* with no count (9), gone
on the first tab change (10), back the moment something waits again (11). Gate 6 depends on what the
queue holds: with nothing targeting the global file it prints a `[NOTE]` and no gate. It reviews
nothing, and the run's whole shape is built around that — filing a card writes into a file every
future session reads and discarding one destroys a proposal — so the zero-count half is produced by
answering `GET /api/descent/memory` inside the page and re-reading through a dispatched
`visibilitychange`, the provider's own return-to-the-foreground path, rather than by emptying the
queue. When the operator's own Descent has nothing pending, the UI half runs on a synthetic two-row
list injected the same way, since a probe that quietly passed on an empty queue would be measuring
an absence; a `[NOTE]` says which of the two it read. The 390 px pass MEASURES the one new thing on
the mobile strip rather than photographing it — choosing a tab closes the drawer, so the tab's
bounding box is read while the drawer is still up, a tab pushed off the sideways-scrolling strip by
its own count being indistinguishable in the picture. Unlike its HTTP-only sibling this one is **not**
safe to run while the operator is in the app, for a reason that has nothing to do with memory: it
opens two `openConsole` sessions and each ends in `ensureTheme`, so it leaves the dev account on
whichever mode ran last — every browser probe's cost here, see *Hosted instance* below. What is true
of it narrowly is that it reviews no card, toggles no preference of its own, and leaves Descent's
queue exactly as it found it. Shots are `20-memory-light`, `20-memory-expanded-light`,
`20-memory-empty-light`, `20-memory-390-light` and `20-memory-dark`. Its contract is at
[memory-intake.md](memory-intake.md).

Phase 21 is the surface signal, and it is the one phase in this whole plan that spends a Claude
turn — once, on haiku, through the real composer a person uses. What `phase-21.mjs` proves is not
that `surface-signal.ts` and its three-line wiring into `claude-runtime.provider.js` exist as
source (the phase's own `check` commands already read that directly) but that they reach a LIVE
child process and a LIVE system prompt: the SDK child's own environment carries
`CLAUDE_SURFACE=cloudcli`, and the model, asked to name what its system prompt calls the surface
and whether it describes a widget fence, answers `SURFACE=cloudcli` and `WIDGET=yes` in its own
words. The env half is read out of `/proc/<pid>/environ` with a 50 ms `setInterval` sweep that
starts BEFORE the prompt is sent, never after: the SDK spawns one child per turn and that child
exits the moment the turn ends, so a scan begun once the reply is on screen has no window left to
read — it would find nothing and prove nothing, where a scan running the whole time the turn is in
flight catches it. The turn is spent once: the pid it saw, the moment it saw it, the reply text and
the session it landed in are kept in `.verify/artifacts/21-surface.json`, and every later run reads
that back — replaying both the env gate and the reply gate, the latter re-fetched from the
session's own persisted row on disk — rather than asking the model the same question twice.

Phase 22 is the widget fence, and it is the gallery technique again for the oldest reason: nothing in
the app mounts a widget, because the fence only exists when a model writes one. So it mounts
`MarkdownBody` from the running dev server over the signed-in page and feeds it fences built in the
probe as strings — both module specifiers read back out of served source rather than typed, the `?t=`
rule, with `ThemeContext` taken from what `useWidgetHost` itself imports so the gallery's own
`ThemeProvider` and the component reading it are the same instance. Fourteen gates, in order: a `widget`
fence yields exactly one iframe whose `sandbox` attribute is the string `allow-scripts`, with a
`srcdoc` and no `src` (1); inside that frame the origin reads `null` and both the parent document and
`localStorage` throw `SecurityError`, which is the invariant the whole feature rests on and the reason
`allow-same-origin` is never negotiable — the login JWT is in that storage (2); the frame wears the
page's theme, carrying the `dark` class in the dark session and not in the light one, with `--canvas`
resolving inside to exactly what it resolves to outside (3); the iframe follows the widget's height,
which is *sampled* every 25ms across the widget's own 500ms growth rather than read at two chosen
moments, so both the settled 160 and the grown 320 are observed instead of raced — and a second
widget SHRINKS from 320 back to 160, because a host that applied the reported height as a
`min-height` would satisfy every growth assertion ever written and still trap a shrinking widget at
its high-water mark (4); a widget that
reaches for the network is refused by the document's CSP and zero requests leave the browser, the
call carrying a `widget-probe=22` marker so the app's own polling of that path can neither redden the
gate nor quietly satisfy it (5); an unterminated fence in the pending half of a streaming reply
mounts no frame and renders its raw source (6); a plain `html` fence stays a code block AND so does a
`widget-config` one — the opt-in is the whole info-string word, since `\w+` stops at a hyphen and
would otherwise let an ordinary documentation label mount a scripted frame — each half carrying a
positive control, because "zero iframes" is also what a case that rendered nothing at all reports (7);
a frame claiming a million pixels is clamped to
exactly 2000 (8); `buildTranscriptExport` over a one-message transcript carrying a widget fence
gives markdown holding the fence and HTML holding a `<pre>` with no `<iframe>` anywhere in it, which
is what keeps a saved conversation a static file (9); a widget that NAVIGATES ITSELF AWAY is never
spoken to again (9b) — `contentWindow` identity survives a navigation, so without the revoke rule a
widget could subscribe, move the frame to a page it controls, and keep receiving whatever the host
pushes; the gate reads the answer from inside the navigated document, which forges the `ready` a real
widget sends and must hear silence, and it navigates to `about:blank` rather than to an app URL
precisely so the gate adds no console noise of its own to gate 11; a widget whose FENCE BODY CHANGES
is still talked to (9c), which is 9b's mirror and guards the same rule from the other side — the host
tells a navigation from a rebuild by counting `load` events on the element, and an in-place `srcDoc`
reassignment fires a second load exactly as a navigation does, so without the `key` on
`WidgetFrameLive` an ordinary body change would revoke a healthy widget permanently and in silence.
Its read is `live.theme` inside the new document, non-null only once the host has ANSWERED that
document's `ready`; the gate's sentinel half passes either way, because an in-place swap is also a
new document — which is exactly why the sentinel is not the assertion that counts. Both were
falsified: removing the key turns `live.theme` from `set` to `null` while the sentinel stays green
through it. And a theme flip on a MOUNTED widget arrives as
a `{type:'theme'}` message rather than a fresh document, proved by leaving a sentinel on the frame's
`window` and requiring it to survive the flip — a rebuilt `srcDoc` is a new window and the sentinel is
simply not in it (10). Gate 10 exists because gate 3 cannot see this: gate 3 compares two documents
built by two separate sessions, and both are correct whether the theme was posted or rebuilt. These
gates were falsified before being trusted — making the height monotonic reddens the shrink
assertion, and adding the theme to the `useMemo` key reddens the sentinel, while the flip's own
"did the frame go dark" assertion stays green through both, which is exactly why it is not enough on
its own.

One gate was DELETED here rather than fixed, and the reason generalises. An earlier revision asserted
that a live widget survives the streaming split boundary retracting back over it, and it passed — but
it drove the retraction by flipping the `streaming` prop on one `MarkdownBody` in a stable position,
which is not a transition `StreamingMarkdown` ever produces. The real component renders two fixed
sibling slots and MOVES a block between them, so a fence crossing the boundary changes parent and
React remounts it. Driving that against the real component leaves zero iframes and one `<pre>`: the
widget genuinely restarts, and the gate had been reporting PASS for a property the system does not
have. A probe that mounts a component in a shape its caller never uses can only test the shape it
invented. Gate 11 holds the signed-in stage to zero
console errors beyond two EXPECTED lines (see *What bites people*). The widget bodies deliberately
paint with the tokens they were handed — five tone chips in their soft/ink pairs — so the shots are
evidence of the theme crossing an opaque origin rather than pictures of grey rectangles; the dark
shots open on the widget cases themselves rather than the whole gallery — the `huge` case's iframe
is clamped to a full 2000px, so what sits below it depends on when the shutter falls, and the shots
are read as evidence of the theme and the frames, never as a census of the cases. The gates are what
count the cases. It sends no Claude turn and files no card; gate 10 writes the `theme`
preference and puts the previous value straight back, which is the same preference `openConsole`
already writes through the app's real Dark Mode switch, and no other preference is touched. Like
every browser probe here it ends in `ensureTheme` twice and leaves the dev account on
whichever mode ran last. Shots are `22-widget-light`, `22-widget-dark` and `22-widget-390-light`. Its
contract is at [architecture/07-live-widgets.md](architecture/07-live-widgets.md).

Phase 23 is the plan-runner lane, and it is back to fetch and a socket — no browser, because nothing
in it is visual. It signs in the way `phase-7.mjs` does and holds the token for every read and every
verb it issues — the polling gates re-read until they settle, so the count is not a fixed one — plus
one `ws://…/ws?token=` connection held open across the middle gates, and REOPENED on its own if it
closes before they are done with it. `tsx watch` restarts the API on any save under `server/` and the
dev supervisor hands over on its own schedule, so a socket opened at the top of a probe that runs for
half a minute is not guaranteed to still be open at the frame gate, where a closed one reads as `no
frame in 5000 ms (socket 3)` and fails a lane that is working. The reopen re-arms the push it is
waiting for, because the watcher broadcasts its whole picture to whoever is listening on its first
tick after a restart; a `[NOTE]` gives the reopen count, and normally there is no such line.
Its fixture, `.verify/lib/runner-fixture.mjs`, writes a
fake run into the REAL state directory the server is already reading, and that is the point rather
than a shortcut: a hermetic tree under `PLAN_RUNNER_STATE_DIR` would prove the classification and
nothing about the lane that is running, since the server reads the root it was started with and
nothing restarts it mid-probe. The fence that makes it safe is one prefix kept at both ends — every
id begins `fixture-live-widgets-`, the library refuses to build or delete anything else, and the run
is removed in a `finally`, so a failed gate still leaves the directory as it found it. Twelve gates,
in order: the mount's own auth on a read and on a write; the live list, with every state one of the
three and no fixture left over from an earlier run; a new run directory carried whole — five phases,
its position, three timeline rows; the same run read back by id; a stage change arriving unasked on
the open socket as a `runner_state` frame carrying its detail and its fourth timeline row; a parked
run reading `paused` and not `stale`, which is the one place this lane deliberately disagrees with
the terminal bar; a lapsed heartbeat reading `stale`; the runner's own refusal coming back as a 409
with its own exit and its own sentence and no stack in the body; a malformed id refused at the route
before anything is spawned; an unknown id answered in the runner's own words; a receipt taking the
run off both the list and the by-id read; and nothing left behind. The operator's own runs are read
by every gate and NEVER named in a request — the plan being executed while the probe runs is one of
them, it shows up in the `[NOTE]` line that lists what the list carried, and a verb sent to it would
stop the run that is running the probe. Its contract is at [plan-runner.md](plan-runner.md).

Phase 24 is the live bus, and it is the first proof that reads the far end of the chain rather than
any point along it. It is the gallery technique again — nothing in the app mounts a widget, so
`MarkdownBody` is mounted from the running dev server into the signed-in page as a second React
root — but the gallery here carries a provider stack, because a second root cannot see the app's
contexts and the thing under test IS a context: `AuthProvider`, `WebSocketProvider`,
`LiveBusProvider` and `RunnerFeed`, in App's own order, which costs a second websocket for the life
of the probe and buys the real modules at every link. The specifiers are read out of served source
the way phase-22 reads them, and TWO of them are compared — the bus as `useWidgetBridge` resolves it
against the bus as `RunnerFeed` resolves it — because if those ever differ the app has two buses and
every widget goes silent with nothing wrong in the code. It reuses phase-23's fixture
(`.verify/lib/runner-fixture.mjs`, unchanged), so one fake run travels the same real path: the state
directory the server is already reading, the same poll, the same frame. Six widgets read it. Eleven
gates, in order: the retained list replayed to a widget on the way in — the providers are mounted
first and the bus is filled BEFORE a single widget is rendered, so what the widget shows can only
have been replayed to it as it subscribed, never pushed to it afterwards; a
stage written to DISK arriving in that widget and, with its detail, in a second widget subscribed to
that one run by id — file to watcher to socket to feed to bus to bridge to frame, live; a topic off
the allowlist refused in words and a topic shaped like a URL refused identically, because a widget
names topics and never endpoints; the seventeenth topic in one frame refused as `too many
subscriptions`; two malformed `subscribe` messages posted straight at the host and dropped in
silence, with the widget reporting that it ran so "no error" cannot be satisfied by a widget that
never executed; the widgets dropped while the bus and the feed STAY MOUNTED and go on publishing,
with every subscription they held released — counted at the bus itself, through a wrapper over
`subscribe`, because a leaked listener posts into a dead `contentWindow` and that is silently
null-safe, so no console-error gate could ever see the leak it claims to catch; a widget
mounting into a FRESH bus reading a stage that changed while no widget was on screen, which is the
REST seed on mount doing its whole job — the gate also requires the seed REQUEST to have fired after
the remount, so a `runner_state` push alone cannot satisfy it, though it stops short of proving the
push lost the race; and a run that ends leaving `runner:*` rather than being
remembered as a ghost. The shot is `24-widget-live` (light, 1440), taken after the third gate: six
sandboxed frames painted with the host's own tokens, each showing runner state that crossed an
opaque-origin boundary. The eleventh gate holds the signed-in stage to zero console errors apart
from the app's own serviceWorker guard, which any sandboxed frame trips once (phase-22 measured it
four ways; it is not this change's). The operator's own runs are in `runner:*` too and the first
widget lists them — the gates read the fixture's id alone, and name no other run anywhere. The
fixture is removed in a `finally`.

Phase 25 is the runner card's ABSENCE from the chat view, and it exists because the card was
pinned there first. It was built into a `flex-none` band between the CLI-version banner and the
transcript, looked at on a phone, and refused: at 390px it took half the screen, and with the
keyboard up the conversation was down to one visible line (operator ruling 2026-09-09). Nothing
renders over the transcript — not a card, not a strip, not a chip, not a banner of the runner's —
and the Runner tab is the card's one home. So this phase proves a negative, and an absence is the
easiest thing in the world to prove badly: a probe that merely counted `[data-runner-card]` in the
chat view would pass just as happily against a server that never sent a run, a bus that dropped it,
or a lane that was never wired at all. It would be
measuring nothing and reporting a success. The reading is therefore taken in two halves and the
ORDER is load-bearing. First the data is proved to arrive: phase-23's fixture
(`.verify/lib/runner-fixture.mjs`, unchanged) writes a real run to the real state directory, and
`GET /api/plan-runner/runs` is polled until the server lists it beside the operator's own runs.
Only then is the chat view read — and held open for five seconds rather than glanced at once,
because the frame travels on the watcher's own 2 s poll and a single early sample would find an
empty view and call it a ruling upheld. Seven gates: the fixture reaching the app over the route; no
`[data-runner-card]` at the busiest of ~20 samples; no `[data-runner-pinned]` either; nothing
carrying the fixture's own `data-run-id` anywhere on the page, which catches a card drawn under
some other attribute; the transcript pane MEASURED filling its chat root exactly — root height less
the composer below it and the CLI banner above it, to within a subpixel — because an absent
`data-` attribute says nothing about a strip or a banner someone adds in its place later; and
nothing but that banner standing above the transcript at all, which is the gate a future region
fails whatever it is named. The chat root is found by walking UP from `.chat-messages-pane` rather
than by its classes, so the measurement survives a restyle. One shot,
`25-runner-chat-390-light.png`, and the seventh gate holds the signed-in stage to ZERO console
errors: this probe mounts no widget and creates no sandboxed frame, so unlike phases 22 and 24
there is no known noise to filter and anything in that list is new. It presses no button, sends no
Claude turn and names no run but its own in a request — the plan being executed while the probe
runs is live in the same list. The fixture is removed in a `finally`. The card's own visual gates
— the badge, the meter, the stage strip, the phase glyphs, the two verbs — belong to the surface
that renders it, and travel with the Runner tab into `phase-26.mjs`.

Phase 26 is the Runner tab, in the browser, and it opens by NOT asserting the thing a tab probe
would normally assert first. The program executing this plan is itself a plan-runner run, so the
lane is never empty on this host and the Runner tab is already on the bar before the probe writes
anything: a gate reading "no Runner tab" would fail on a correct build, every time. The opening
reading is therefore a `[NOTE]` recording the baseline — how many tabs, at what count — and NO GATE
BELOW IS WRITTEN AGAINST THE LANE'S ABSOLUTE TOTAL, because the operator's own runs start and finish
inside the probe's own window and such a gate would go red for a run it does not test. Three
disciplines replace it, and the probe's header states the same three. The fixture's ARRIVAL is the
one count delta: phase-23's fixture (`.verify/lib/runner-fixture.mjs`, unchanged) must raise the
count to at least one above the baseline, which is falsifiable whatever else is running. Every other
reading about the fixture is SCOPED TO ITS OWN CARD by `data-run-id` — its pause, its end, its meter,
its phases — so each is judged per-run; where a lane total is printed beside such a gate it is an
observation and never an assertion. And where a gate must know whether anything is running at all,
it reads the lane over the API rather than the tab's count, which cannot tell "no count" from "no
tab". The tab is found the way `phase-20.mjs` finds the Memory tab, by `aria-label`; its COUNT,
however, is read from
the tab's `title` and not from a `.vv-tabs__count` pill, because `Tabs` renders that pill for word
tabs only — the workspace tabs are icon-only, so the number reaches the title (`Runner (2)`) and the
glyph carries a bare dot. Seventeen gates: the fixture reaching the app over
`GET /api/plan-runner/runs`, which is the one reading that tells a failing UI gate from an empty
lane; the tab on the bar, marked with its dot, its count raised by the fixture; `Go to Runner` in the
command palette; the tab opening a panel holding a card with the fixture's own `data-run-id`; that
card arriving with its phase list already open, which is the panel's one variance; the count equal
to the number of cards drawn; the Meter reading the fixture's `1 / 5` at 20%; the PipelineStrip
drawing the reviewed six-stage chain; one row per phase with its title; a phase row expanding onto
the two stages the fixture's log says it walked; Stop offered on a live run and its REFUSAL spoken
aloud; `pauseRun` repainting the card as PAUSED with a Resume button and the run STILL LISTED in
the panel — asserted per-run against the fixture's own card, deliberately NOT as an equality on
the lane's absolute total, because those totals are read seconds apart on a host where the
operator's own runs start and finish and such a gate would go red for a run that has nothing to
do with pausing (the totals are printed beside the gate, and are an observation, not an
assertion — do not "restore" the equality);
`endRun` KEEPING the card as ENDED — COMPLETE, Stop gone, Dismiss offered — and the tab under the
reader (the sticky rule; the card's removal is phase 27's, by dismissal); the bar after navigating to
Chat held to what the LANE says rather than to the tab's own count — `readCount` answers 0 both
for a tab with no count and for a tab that is not there, so branching on it would let the very
regression that gate guards satisfy its assertion, and the branch is therefore chosen by an
independent read of `GET /api/plan-runner/runs`; a restored `runner` tab landing on the panel; the phone drawer
carrying the tab with the panel measured fitting 390px; and the signed-in console held to zero. The
probe presses Stop exactly once, on its own fixture, and expects to be refused — no lock names a
fixture, so the runner exits 1 and the lane answers 409 — which is why exactly ONE such entry is
excused from the console gate, matched on the browser's whole sentence rather than on the bare
string `409` (which would also excuse a run id or a byte count that merely contained those three
digits); a second 409 is something the probe did not ask for and still turns it red. Matching by
ROUTE would be tighter and is not reachable: `console.mjs` records `message.text()` only, while a
failed resource's URL lives in `message.location()`. IT NEVER
PRESSES RESUME: resume would ask the real runner to launch a daemon against the fixture's one-line
plan file. Two gates adapt to the host rather than pretending: the `EmptyState` and the
tab-drops-off-the-bar readings only apply when nothing else is running, and say so in a `[NOTE]`
when the operator's own runs are still on the lane. Shots are `26-runner-tab-light`,
`26-runner-tab-dark` and `26-runner-tab-390-light`. Fixtures are removed in an outermost `finally`,
each guarded separately so one failure cannot strand another. Its contract is at
[plan-runner.md](plan-runner.md).

Phase 27 is the ended card, in the browser, and it is the one probe here that writes the dev
account's synced preferences: dismissing a run is a MERGED write to the `planRunner` blob, and the
gate that matters most reloads the page and expects the dismissal to hold — that is the whole
point of syncing it. Its fixtures each carry a plan of their own (`createFixtureRun({ planName })`),
because an ended run is superseded by a newer run of the same plan and two fixtures on one plan
would read as one plan re-walked. Sixteen gates on five fixtures plus a sixth that never appears: a live fixture on
the lane; `endRun` keeping its card as ENDED with the outcome word `COMPLETE`, no Stop, Dismiss
offered and the count still counting it; a second fixture ended `halted` reading in the warn tone
with Resume beside Dismiss; Dismiss on the first taking its card and dropping the count by one;
a newer ended run of a fixture's plan superseding it, one ended card per plan; a fresh load with
the dismissed card still gone and the halted one still there; a second dismissal keeping the first
(the stored list is pruned against the WHOLE lane, never the visible list — pruning against the
visible list dropped every earlier dismissal the moment a second was made, and the server still
carried those runs, so they came straight back); a `complete` receipt written over blocked phases
reading INCOMPLETE in the warn tone with Resume, because the runner's `complete` only means something
shipped; a dismissed run reopened in place (`reopenRun`, the rename a resume makes) and ended again
coming back as a new card, because a dismissal is of one ending and not of an id; a fixture whose receipt is a day old
never listed, over the API or on the tab; two shots at 390
wide, light and dark. What bites: the write to preferences is debounced on the client, so the
reload waits for the server to acknowledge it (the probe polls `GET /api/user/preferences` for
the id) rather than reloading on the click; and the fixture ids it dismisses stay in the operator's
list until the next dismissal prunes them — harmless, capped, and noted.

Keepalive survival is the one proof here that is not a phase and is not in `all.mjs`, because what
is under test is the API's own death. `.verify/keepalive-turn.mjs` is the client every case
spawns — a driver whose socket keeps dying, which re-subscribes with the seq it remembers and
never re-sends the turn — and three runners drive the real systemd units around it:
`.verify/keepalive-host-case.mjs` takes one host process end to end with no API in the picture at
all; `.verify/keepalive-cases-p3.mjs` covers the spawn path and the gate (`turn`, `abort`,
`env-off`, `unit-down`); and `.verify/keepalive-cases-p4.mjs` covers survival itself (`A` through
`F`). `.verify/keepalive-lib.mjs` under them holds the measurement helpers and signs in as the
same dev account `.verify/lib/console.mjs` uses. Every case spends **one real Claude turn** on the
operator's own credentials and on the account's own default model — `claude-opus-5[1m]` in the
journals these were built against, not a cheap one — which is why the prompts are deliberately
trivial and why a sweep is not free. Three observables carry most of the weight, each measured
rather than asserted: the CLI's pid is the same before and after the API's pid changes, no
`claude` process is a child of the API while the keepalive is up, and the turn's own `complete`
arrives exactly once on the far side. What each case kills, and the four things to know before
running one, are at §"The keepalive cases".

Its neighbours under `.verify/handover/` prove a different thing — that a save under `server/`
replaces the API without an outage — and only one of them is free. `handover-cases.mjs` is the
matrix (`GOOD`, `BROKEN`, `COALESCE`, `READOPT`, `RESTART`) over the measurement helpers in
`handover-lib.mjs`, and it drives the LIVE unit by editing the real `server/index.ts`: that edit
IS the handover under test. What each case edits, what has to hold, and the four things to know
before running one are at §"The handover cases".

`seam-probe.mjs` beside it costs nothing: it measures the boot seam in
`server/supervised-boot.ts`. The unit now runs that seam for real on every `server/` edit, so the
healthy paths are visible on :3011 — but the modes worth fearing are exactly the ones a working
supervisor never produces, and those are what this probe makes runnable. It boots a
**second** instance of this same server on :3999 — no systemd unit is touched and no Claude turn
is spent — and reads every answer out of the world rather than out of the code: the kernel's
listener table for who holds the port, a real `SO_REUSEPORT` join for whether the child asked for
the option, the IPC channel for the READY message, and the child's own stdout for the ORDER of
its boot.

```bash
node .verify/handover/seam-probe.mjs <plain|nochannel|firstboot|handover|steal> --evidence <dir>
```

One `SEAM <mode> key=value …` line prints last, under the rule the CASE lines follow — every key
measured, none asserted. `plain` is the boot with no supervisor at all and `nochannel` the boot
with the environment bit exported but no channel behind it: the dangerous one made runnable, since
only the missing channel stands between it and a second server sharing the port. Neither may bind
with `reusePort` and neither may park waiting for a takeover nobody can send. `firstboot` is a
supervised boot with no predecessor, which still re-adopts before it reports ready; `handover`
holds the sole-server duties back until the supervisor's takeover message and runs them once, on
the far side of the ready banner; and `steal` is the most-feared failure made observable — the
supervisor dies having sent no takeover, and the child must go on serving the port without ever
running the duties, because re-adopting hosts the predecessor still holds ends those runs. Only
`steal` shortens the 30 s takeover warning, through `CLOUDCLI_TAKEOVER_WARN_MS`; nothing in
production sets it and it is no part of the supervisor's contract with its child.

Two things to know before running it. The second instance is **sealed off** from the live one — its
own database and an empty `CLOUDCLI_SESSIONS_DIR`, so `listLiveHosts()` returns nothing and it can
never re-adopt, which is to say steal, a host the live server is serving; never point it at the
real sessions directory to "see a real re-adoption". Every mode also reads the live API's own
`/api/cli-version` as a canary, so a run that disturbed :3011 says so rather than passing quietly.
And the one file the two instances share is the local server marker `~/.cloudcli/local-server.json`:
the child clobbers it on boot and removes its own on the way out, so the probe puts the original
back in a `finally` — except where the live API restarted mid-probe and wrote a fresher one, a
marker naming a living process being better truth than a snapshot naming a dead pid.

## Standing colour baselines

Measured in Phase 1 on the running app. Ratchets, like the warning count: improve, never regress.

| Measured | Reading | How it is held |
|---|---|---|
| Ink on canvas | 16.57 light · 16.59 dark | asserted ≥ 4.5:1 |
| `--accent-ink` on canvas | 4.77 light · 13.55 dark | asserted ≥ 4.5:1 |
| Destructive fill and its ink | 5.95 both modes | asserted ≥ 4.5:1 |
| `text-destructive` on canvas | 3.17 dark — below AA | reported, never asserted |
| Accent on canvas | 2.81 light — under the 3:1 graphics floor | reported: the palette's own |
| Rejected blue `rgb(37,99,235)` | 3 light sites · 1 dark | asserted as a ceiling |

## The keepalive cases

Session keepalive — a Claude turn's CLI outliving the API that started it — cannot be proven
from a browser, because the thing under test is the API's own death. Its probes drive the real
gateway over a WebSocket instead, and kill the real systemd units underneath it. They are **not
part of `all.mjs`** and are run one case at a time:

```bash
node .verify/keepalive-cases-p4.mjs <A|B|C|D|E|F> --evidence <dir>
```

Each case prints one `CASE <name> key=value …` line last. Every key on it is **measured** — from
the process table, the systemd unit, the journal copy the host wrote, or the driver's own frame
log — and a key the script could not measure prints `unmeasured`, which no expectation accepts. A
case that dies halfway therefore cannot print a passing line.

| Case | What dies, and what has to survive it |
|---|---|
| **A** | An edit-triggered handover lands mid-turn. The API's pid changes, the CLI's does not, the new server's boot logs `[keepalive] re-adopted`, and the turn's own reply still arrives — once. |
| **B** | A hard restart while the CLI is held open for background work. The background result and its notification both land on the far side of the boot. |
| **C** | The turn's `result` lands while there is no API at all to hand it to. The reply is read back out of session history, which is the observable that survives the gap. |
| **D** | The stop switch: `systemctl stop cloudcli-sessions-tmux` takes every CLI with it, and the client is told so with an error frame rather than left hanging. |
| **E** | The boot sweep collects a host whose tmux session is gone — planted as a dead meta file, counted as swept, no files left behind. |
| **F** | The replay cursor's safe direction: re-subscribing with a cursor the run itself issued replays nothing twice. |

Four things to know before running one:

- **It needs passwordless sudo** (`sudo -n systemctl …`) and it restarts `cloudcli-server-dev`
  and `cloudcli-sessions-tmux`. This is the browser suite's "run it solo, when nobody is in the
  app" rule with teeth — a case takes the API down under anyone else's session. Six cases run in
  about five minutes.
- **Every turn is a real `claude` turn** against the operator's own credentials, so a sweep
  spends real tokens. The prompts are deliberately trivial ("reply with exactly the word
  FINISHED") for that reason.
- **Each case creates and deletes its own probe session** (D-12) however it ends, so a sweep
  leaves the sessions list as it found it. `probe-*` files left in `~/.cloudcli/sessions` mean an
  interrupted run — see [hosting.md](hosting.md) §"Runbook".
- **Case A hands the API over by nudging a file**, appending a newline to
  `server/modules/providers/list/claude/session-host/index.ts` and restoring it. Any file under
  `server/` now triggers a boot — the supervisor watches the tree, not an import graph — so the
  nudge no longer depends on that file being reachable by an import; it stays there because it is
  never a change under test. Never aim it at a file the run is verifying.

Its siblings — the driver they all spawn, the `turn|abort|env-off|unit-down` cases and the
host-only one — share the same discipline, and which script drives what is in §"The browser
harness" above, under *Keepalive survival*. What the mechanism itself is, and what the boot pass
does, is in [hosting.md](hosting.md) §"Rules that bite" and
[`session-host/README.md`](../server/modules/providers/list/claude/session-host/README.md).

## The handover cases

A handover cannot be proven from a browser either: what is under test is one API process replacing
another on the same port, and the browser sees at most a reconnect. The cases provoke it the way a
developer provokes it — by saving a file under `server/` — and read every answer out of the world:
the kernel's listener table for who holds `:3011`, `ps` for the supervisor's children and their
`STAT` column, the journal's JSON entries (with `_PID`, so "which process said this" is an answer
rather than an assumption), an HTTP canary sampled throughout, and sha256 of the live file against
the backup. Like the keepalive cases they are **not part of `all.mjs`** and run one at a time:

```bash
node .verify/handover/handover-cases.mjs <GOOD|BROKEN|COALESCE|READOPT|RESTART|restore> --evidence <dir>
```

Each case prints one `CASE <name> key=value …` line last, under the same rule: every key is
**measured**, and a key the script could not measure prints `unmeasured`, which no expectation
accepts. Nothing defaults to `true`, and a failed probe is never read as a measured `false` — so a
case that dies halfway cannot print a passing line.

| Case | What it edits | What has to hold |
|---|---|---|
| **GOOD** | one newline appended to `server/index.ts` | The successor binds before the predecessor is retired: `old_pid_gone=true new_pid_bound=true single_child=true main_pid_same=true handover_lines=2 index_restored=true`, with `canary_misses` 0 or 1. Two completed handovers, because putting the file back is the second one. `handover_s` is reported, not asserted — about a second here. |
| **BROKEN** | `export { doesNotExist };` + a call to it | The API never stops answering: `canary_samples_ge80=true canary_misses=0 boot_failed_lines=1 names_error=true old_pid_kept=true recovered_new_pid=true index_restored=true`. The call is what breaks the boot — esbuild elides a bare unresolved export from a `.ts` file, so the export alone boots cleanly. |
| **COALESCE** | two newlines, a second apart | However the supervisor splits them, one server is left: `surviving_children=1 zombies=0 old_pid_gone=true single_bound=true index_restored=true`, `canary_misses` 0 or 1. One boot or two handovers is not a distinction the CASE line makes — the journal's `change during boot` line does. |
| **READOPT** | one newline, under a live session whose background work has not finished | The successor re-adopts only once the predecessor is *gone*: `complete_count=1 handover_ok=true readopted_ge1=true readopt_from_new_pid=true readopt_after_retire=true bg_completed_lines=1 host_gone=true index_restored=true`. Adopting sooner would SIGHUP the very host it inherited; the journal's own ordering against `retired pid <old>` is what proves it did not. |
| **RESTART** | nothing — `sudo -n systemctl restart cloudcli-server-dev` | The unit still lands the supervisor as MainPID with one child under it: `canary_back_within_5s=true supervisor_is_main=true single_child=true watchdog_sha_same=true`. This one is a real outage, unlike a handover, and it is timed from *before* the command is issued. |
| `restore` | nothing — it puts the file back | The escape hatch, not a case: prints `RESTORED changed` or `RESTORED unchanged`, waits out the handover a real restore provokes, and measures nothing. |

Four things to know before running one:

- **Every case edits the live `server/index.ts`** and copies it back from `<evidence>/index.ts.bak`
  in a `finally`, whatever happens; `index_restored` is read from the bytes immediately before the
  line prints. `^C` and `SIGTERM` restore it on the way out too. A run killed harder than that
  leaves the live file edited — that is what the `restore` verb is for, and it is the first thing
  to run after any interrupted sweep.
- **`BROKEN` leaves that file unbootable for a full 20 s on purpose.** The previous server answers
  throughout, and watching it do so *is* the measurement — a window cut short would not have
  watched it. Its canary samples every 200 ms rather than the default 250, so 80 samples of the
  window carry slack instead of sitting on the arithmetic maximum.
- **`READOPT` spends one real Claude turn** on the operator's own credentials and default model,
  the same cost the keepalive cases carry, and holds its probe session open for about two minutes
  waiting on background work. It creates and deletes that session however it ends.
- **`RESTART` needs passwordless sudo** (`sudo -n systemctl …`) and takes the API down for real.
  Run the whole matrix solo, when nobody is in the app — the keepalive cases' rule, for the same
  reason.

Two neighbours are not cases. `.verify/handover/seam-probe.mjs` costs nothing and touches no unit:
it boots a second, sealed-off server on `:3999` to measure the boot seam in the five modes a
working supervisor never produces — described under §"The browser harness" above, where its `SEAM`
line and its two cautions are. `bash .verify/handover/smoke.sh` is the one-command sanity check —
it touches `server/index.ts` and prints `HANDOVER old=<pid> new=<pid> seconds=<n>`, or
`NO-HANDOVER` with what it found bound.

What the mechanism itself is — the state machine, every log line, the two environment bits and the
failure table — is in
[`deploy/dev-supervisor/README.md`](../deploy/dev-supervisor/README.md), and the rule it puts on a
person editing `server/` is in [hosting.md](hosting.md) §"Rules that bite".

## What bites people

| | |
|---|---|
| **Dev account** | `verve` / `verve-dev-2026`, created through the real setup form on the first run. To start over, delete `~/.cloudcli/auth.db` (an operator act) and run the harness again. |
| **One dev user, so two runs collide** | Every phase signs in as that one account, and `phase-4.mjs` changes its *server-side* preferences mid-run — hiding and revealing the Shell tab, toggling `tasksEnabled` — then restores them inline and asserts it did. Two `all.mjs` runs at once therefore read and overwrite each other's half-done state, which surfaces as a regression rather than as the collision it is: run the harness solo. The restore being inline rather than in a `finally` also means a run that dies part-way leaves the dev user non-default — re-run the phase, or put the switches back by hand. |
| **Onboarding writes real git config** | Its first step arrives pre-filled from the host's global git identity and the harness submits it unchanged. It never types one: an empty field stops the run rather than writing a fabricated identity into `git config --global`. |
| **The Runner tab comes and goes** | It is DATA-gated: it is on the bar only while the plan runner is actually carrying a run, so a workspace with a quiet lane has no Runner tab and nothing is wrong. It is also STICKY — once it is the selected tab it stays at a count of zero, so a run ending under you empties the panel instead of moving you. A probe that asserts the tab's absence will fail on this box, where the plan runner is usually running something; and its count is read from the tab's `title`, never from a `.vv-tabs__count` pill, which icon-only tabs do not render. |
| **One stored theme per user** | The theme is saved server-side against the account, so every run leaves the dev user on whichever mode ran last. `ensureTheme` therefore forces it in both directions by driving Settings → **Appearance** → **Dark Mode**. Those are English labels — a phase that restyles or re-labels Settings must re-point them. |
| **Settings is driven by its English labels** | Beyond `ensureTheme`'s two above, `phase-4.mjs` clicks the **Appearance** rail row and then finds its controls by the strings `Tabs in the workspace`, `Hide the Shell tab` and `Hide the Tasks tab` — the last two as `aria-label` on the switches. Re-word one in `en/settings.json` and the phase stops finding a control rather than reporting one wrong, so re-point it in the same change. |
| **12 console errors before sign-in** | `App.tsx` mounts the plugins, tasks and TaskMaster providers above `ProtectedRoute`, so the login and post-logout screens call authenticated endpoints with no token and the browser logs the 401s. A pre-existing upstream defect, measured rather than budgeted: the signed-in stage is held to zero errors, the unauthenticated ones to exactly this count. |
| **The git tab reads "Source Control"** | Tabs are selected by `[role=tab][aria-label]`, and that is the label on it. |
| **The Shell tab is off the bar by default** | `hideShellTab` defaults to `true` in `src/shared/uiPreferences.ts`, so a fresh account opens with no Shell tab and no "Go to Shell" in the command palette — an absence to reveal, not a fault to chase. Reveal it the way a person does: Settings → **Appearance** → *Tabs in the workspace* → **Hide the Shell tab**, off. Hiding a tab disconnects nothing; a running shell keeps going exactly as it does while another tab is selected, and the server ends it 30 minutes after nothing is attached (`PTY_SESSION_TIMEOUT`). |
| **The Shell tab prints `bash: claude: command not found`** | The PTY spawns `bash -c "claude …"` — a bare `PATH` lookup — and the server process on this host carries no `~/.npm-global/bin`, which is where the CLI is. `.env`'s `CLAUDE_CLI_PATH` does not reach it: that is read by the SDK providers through `server/shared/claude-cli-path.ts`, never by the PTY. Nor does upstream's `prioritizeUserNpmGlobalBin`, which only re-*orders* entries already on `PATH` and hands it back untouched when none of its candidates are there — `npm_config_prefix` being set is not enough. An environment fact rather than a fork defect, and the fix belongs at deploy time: whatever runs the server must have the CLI's directory on its own `PATH`. |
| **`uiPreferences` is one stored key, not six** | The preference store keeps a row per name, and all six workspace booleans live inside the single `uiPreferences` value. A `PATCH /api/user/preferences` carrying `{"uiPreferences":{"hideShellTab":false}}` therefore *replaces* the blob and silently drops the other five. Click the switch, or send the whole object back. A flat key is its own row and patches safely alone — which is why `phase-4.mjs` patches `tasksEnabled` directly and clicks for the rest. |
| **The Tasks tab is absent** | It is preference-gated and TaskMaster is not installed here, so its absence is recorded as a note rather than asserted as a pass — except in `phase-4.mjs`, which asserts the biconditional instead: the tab is on the bar exactly when TaskMaster is installed. A tab that can never appear would also leave the board itself unmeasured, so `phase-16.mjs` opens the tab when it is there and otherwise mounts the app's own `TaskBoardContent` and `TaskEmptyState` from the running dev server — phase 2's technique, and it says in a `[NOTE]` which of the two it read. |
| **The Memory tab is on the bar only while something is waiting** | It is gated on Descent's pending queue rather than on a preference, so a host with an empty queue has no Memory tab and no *Go to Memory* row in the palette — an absence, not a fault. `phase-20.mjs` falls back to a synthetic two-row queue answered inside the page when the live count is 0, and says so in a `[NOTE]`. It also STAYS on the strip at a count of zero while it is the selected tab, deliberately — the Runner tab above is the second tab written that way, and both are read by the same gate. Its contract is at [memory-intake.md](memory-intake.md). |
| **The Memory panel is driven by its English strings** | `phase-20.mjs` finds the two verbs by the words `file it` and `discard`, the empty state by `All filed`, and the global-blast mark by the substring `global`. All four live under `memory.*` in `en/common.json` (English only; the other locales fall back to `en`). Re-word one and the phase stops finding a control rather than reporting one wrong — re-point it in the same change, the way `phase-4.mjs` is re-pointed for Settings. |
| **The runner card is driven by its English strings** | The card reads every word it draws from `runner.*` in `en/common.json` — the state badge (`LIVE` / `PAUSED` / `STALE`), the phase states, the meter's label, the phase count, the two verbs and both toasts — English only; the other locales fall back to `en`. The elapsed clocks are the exception and are NOT the card's to re-word alone: their three keys are `claudeStatus.elapsed.*` in `en/chat.json`, shared with the composer's own clock, which is why there is no private formatter in `useElapsed`. A probe that drives the card finds its controls by those strings, so re-word one and the phase stops finding a control rather than reporting one wrong — re-point it in the same change, the way `phase-4.mjs` is re-pointed for Settings. `phase-25.mjs` reads NONE of them: nothing in the chat view draws the card, and its gates are an absence and a measured height. `phase-26.mjs`, the Runner tab's probe, is where these words are read. |
| **There is no logout control** | Nothing in `src/` consumes `AuthContext`'s `logout`, so the harness removes the `auth-token` key the app itself wrote and reloads. No token is forged and no route is bypassed. |
| **Project rows are desktop-only** | The `PROJECT_ROW` selector matches nothing below 768px, where the compact sidebar renders a card instead of a button. Counting rows at 390px and reading `0` is that blind spot, not an empty sidebar. |
| **A hand-written module specifier forks the module** | Vite stamps `?t=<timestamp>` on every module it has re-transformed since the server started, so an `import('/src/…')` written without that query resolves to a *second* instance — two React contexts, and a provider stops seeing its own consumer. `phase-3.mjs` reads the specifier back out of the served consumer file instead of typing one. Editing a context file with the server already up is what makes this bite. |
| **Most registered projects answer 413, and a dead one answers 404** | `GET /api/projects` lists seven directories on this host, and the recursive tree route (`…/files`) refuses `/`, `/home/lyphe`, `/home/lyphe/.claude` and `/tmp` with a 413 at its 10,000-entry cap, while `mission-control` no longer exists on disk and 404s. Neither is a defect, and neither is a reason to re-register anything. The `…/list` route answers 200 for all four wide ones — it reads a single directory rather than a tree, which is what makes those projects browsable at all. |
| **A colour read mid-transition is a colour between two tokens** | `.vv-button` transitions `background-color`, `border-color` and `color` over 0.2s and `.vv-tabs__tab` over 0.35s, so a `getComputedStyle` taken right after a click or hover reports the blend, not either token. Read a freshly inserted element, or wait the transition out. |
| **A ratio read with the pointer on the row is the hover's ratio** | `.vv-button--ghost:hover:not(:disabled)` paints `--accent-soft`, and at `(0,3,0)` it out-specifies a call site's own `hover:bg-…` utility at `(0,2,0)` — nothing here is in a cascade layer, so specificity alone decides. A hovered project row is therefore standing on Verve's wash, not on the ground its own classes name, and `page.click()` leaves the cursor exactly where it clicked. Park it off the surface before measuring, or measure a row nothing is over. |
| **A success-only sign-in never reaches the error branch** | `phase-5.mjs` types a wrong password first, asserts the amber `Banner`, then signs in for real — because the login route answers `{error:{code,message}}` and a screen that hands that object to JSX takes the tree down rather than showing a message. No correct password visits that branch. Verify any new screen that surfaces an API error the same way: drive the rejection. |
| **`phase-22.mjs` expects two console errors, and neither is a defect in it** | The CSP refusal is the PROOF of gate 5, not noise — Chromium logs the one blocked call as two differently worded lines, so the probe filters on the `widget-probe=22` marker in the URL rather than on either phrasing. The second is the app's own: any sandboxed frame on this page raises one `SecurityError: Failed to read the 'serviceWorker' property from 'Navigator'`, because `'serviceWorker' in navigator` is true in a sandboxed context while *reading* the property throws (`index.html`, `src/main.tsx`). Measured, not assumed: it reproduces with an empty `srcdoc` carrying none of the widget code, does not reproduce with `about:blank` as the parent, and is unaffected by blocking `/sw.js`. The widget fence is simply the first thing in the app to create a sandboxed frame, so it is what exposes it. Both are filtered by substring; every other error still reddens the gate. |
| **A fixture run flashes in the terminal status bar** | `phase-23.mjs` and `phase-26.mjs` both write real run directories under the real state root, so for the few seconds one exists `scripts/runner_statusline.py` lists `fixture-live-widgets-<ms>` beside the operator's own runs — in the bar, and in `plan-runner status`. Expected, not a stray run: each probe removes what it wrote in a `finally`, `phase-23.mjs`'s last gate asserts the state root holds no `fixture-live-widgets-*` entry, and `phase-26.mjs` reddens its own run if a fixture will not remove. One left behind means a probe was killed mid-flight; delete it by hand. |
| **`phase-23.mjs` notes that the socket was reopened** | The API restarted mid-probe — a save under `server/` under `tsx watch`, or the dev supervisor handing over — and the probe's chat socket healed through it rather than failing the frame gate on a closed one. A `[NOTE]`, never a failure: the gates after it are worth as much as on a run that carried no such line. The reopen contract is in the phase 23 entry of §"The browser harness". |
| **The surface probe reads a process that only lives for one turn** | `phase-21.mjs` polls `/proc/<pid>/environ` of the SDK child spawned for its one Claude turn, and that child exists only while the turn is in flight — it is gone by the time a reply is on screen. The poll has to start before the prompt is sent and keep running through it; a reading taken after the reply arrives finds no such pid and proves nothing. |
| **Three sidebar readings are only as good as this host's data** | "↳ Show N older conversations" is *asserted*, and needs a project whose first page of sessions is not its whole history — a host without one reports a failure where there is an absence. The other two can only be noted: `messageCount` is `0` on every session server-side, so the "N messages" segment never renders, and no plugin is installed here — the registry reads `~/.claude-code-ui/plugins`, not this repo's `plugins/`, and it is empty — so the plugin tabs draw nothing to read. |

## Hosted instance

Since 2026-09-06 the dev server the probes drive is a pair of systemd units, not a tmux
session — `cloudcli-server-dev.service` (:3011 loopback) and `cloudcli-client-dev.service`
(:5183 on every interface) — see [hosting.md](hosting.md). The ports are unchanged, so every
`phase-*.mjs` runs as before. Two consequences: the app is now the operator's daily instance,
so a probe run mutates a live session's state (theme, preferences, the login modal, the sealed
`/git` press) — **run the suite only when nobody is in the app**, and always solo; and a server
edit made while a probe is mid-flight hands the API over under it, which reads as a transient —
re-run, never re-aim. The handover keeps `:3011` answered throughout, so what a probe sees is a
dropped WebSocket rather than a refused request, but it is a transient either way — except in
`phase-23.mjs`, whose socket reopens itself through the handover and says so in a `[NOTE]`.
