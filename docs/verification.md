# Verifying a change in this fork

A change is proven here by running the real application: the dev server serves it, a
Playwright script drives the real user interface against it, and the mechanical checks come
back no worse than the recorded baseline. This fork does not verify by unit test.

## The dev server

It runs under tmux, not in your shell. Check before you touch anything:

```bash
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5183/   # 200 = healthy, leave it alone
tmux capture-pane -p -t cloudcli-dev | tail -40                 # its log — read this first
```

Start it only when that curl is not `200`:

```bash
tmux new -d -s cloudcli-dev -c /home/lyphe/.claude/claudecodeui_lyphe \
  "npx concurrently --kill-others 'npm run server:dev-watch' 'npm run client'"
```

Both halves reload themselves — Vite for `src/`, `tsx watch` for `server/` — so no code
change needs a restart, and a restart costs you the running session. Note this is *not*
`npm run dev`, whose `server:dev` has no watcher.

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

Phase 12 opens no browser either: the Descent proxy is four HTTP contracts, so `phase-12.mjs` signs
in through the real login route and drives them with `fetch`. What the live picture cannot show —
the null discipline, a rolled percent, a vendor `severity`, a Descent that is down — it measures
under `tsx` against bodies copied from Descent's own handlers, a closed port and a socket that
stalls mid-body. It never calls `capture` nor sends `switch` a real slug, since either moves the
operator's live Claude login; the refused `__no_such_slug__` is how Descent's own verdict is shown
to travel through intact. Its contract is at [descent-proxy.md](descent-proxy.md).

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

## What bites people

| | |
|---|---|
| **Dev account** | `verve` / `verve-dev-2026`, created through the real setup form on the first run. To start over, delete `~/.cloudcli/auth.db` (an operator act) and run the harness again. |
| **One dev user, so two runs collide** | Every phase signs in as that one account, and `phase-4.mjs` changes its *server-side* preferences mid-run — hiding and revealing the Shell tab, toggling `tasksEnabled` — then restores them inline and asserts it did. Two `all.mjs` runs at once therefore read and overwrite each other's half-done state, which surfaces as a regression rather than as the collision it is: run the harness solo. The restore being inline rather than in a `finally` also means a run that dies part-way leaves the dev user non-default — re-run the phase, or put the switches back by hand. |
| **Onboarding writes real git config** | Its first step arrives pre-filled from the host's global git identity and the harness submits it unchanged. It never types one: an empty field stops the run rather than writing a fabricated identity into `git config --global`. |
| **One stored theme per user** | The theme is saved server-side against the account, so every run leaves the dev user on whichever mode ran last. `ensureTheme` therefore forces it in both directions by driving Settings → **Appearance** → **Dark Mode**. Those are English labels — a phase that restyles or re-labels Settings must re-point them. |
| **Settings is driven by its English labels** | Beyond `ensureTheme`'s two above, `phase-4.mjs` clicks the **Appearance** rail row and then finds its controls by the strings `Tabs in the workspace`, `Hide the Shell tab` and `Hide the Tasks tab` — the last two as `aria-label` on the switches. Re-word one in `en/settings.json` and the phase stops finding a control rather than reporting one wrong, so re-point it in the same change. |
| **12 console errors before sign-in** | `App.tsx` mounts the plugins, tasks and TaskMaster providers above `ProtectedRoute`, so the login and post-logout screens call authenticated endpoints with no token and the browser logs the 401s. A pre-existing upstream defect, measured rather than budgeted: the signed-in stage is held to zero errors, the unauthenticated ones to exactly this count. |
| **The git tab reads "Source Control"** | Tabs are selected by `[role=tab][aria-label]`, and that is the label on it. |
| **The Shell tab is off the bar by default** | `hideShellTab` defaults to `true` in `src/shared/uiPreferences.ts`, so a fresh account opens with no Shell tab and no "Go to Shell" in the command palette — an absence to reveal, not a fault to chase. Reveal it the way a person does: Settings → **Appearance** → *Tabs in the workspace* → **Hide the Shell tab**, off. Hiding a tab disconnects nothing; a running shell keeps going exactly as it does while another tab is selected, and the server ends it 30 minutes after nothing is attached (`PTY_SESSION_TIMEOUT`). |
| **The Shell tab prints `bash: claude: command not found`** | The PTY spawns `bash -c "claude …"` — a bare `PATH` lookup — and the server process on this host carries no `~/.npm-global/bin`, which is where the CLI is. `.env`'s `CLAUDE_CLI_PATH` does not reach it: that is read by the SDK providers through `server/shared/claude-cli-path.ts`, never by the PTY. Nor does upstream's `prioritizeUserNpmGlobalBin`, which only re-*orders* entries already on `PATH` and hands it back untouched when none of its candidates are there — `npm_config_prefix` being set is not enough. An environment fact rather than a fork defect, and the fix belongs at deploy time: whatever runs the server must have the CLI's directory on its own `PATH`. |
| **`uiPreferences` is one stored key, not six** | The preference store keeps a row per name, and all six workspace booleans live inside the single `uiPreferences` value. A `PATCH /api/user/preferences` carrying `{"uiPreferences":{"hideShellTab":false}}` therefore *replaces* the blob and silently drops the other five. Click the switch, or send the whole object back. A flat key is its own row and patches safely alone — which is why `phase-4.mjs` patches `tasksEnabled` directly and clicks for the rest. |
| **The Tasks tab is absent** | It is preference-gated and TaskMaster is not installed here, so its absence is recorded as a note rather than asserted as a pass — except in `phase-4.mjs`, which asserts the biconditional instead: the tab is on the bar exactly when TaskMaster is installed. A tab that can never appear would also leave the board itself unmeasured, so `phase-16.mjs` opens the tab when it is there and otherwise mounts the app's own `TaskBoardContent` and `TaskEmptyState` from the running dev server — phase 2's technique, and it says in a `[NOTE]` which of the two it read. |
| **There is no logout control** | Nothing in `src/` consumes `AuthContext`'s `logout`, so the harness removes the `auth-token` key the app itself wrote and reloads. No token is forged and no route is bypassed. |
| **Project rows are desktop-only** | The `PROJECT_ROW` selector matches nothing below 768px, where the compact sidebar renders a card instead of a button. Counting rows at 390px and reading `0` is that blind spot, not an empty sidebar. |
| **A hand-written module specifier forks the module** | Vite stamps `?t=<timestamp>` on every module it has re-transformed since the server started, so an `import('/src/…')` written without that query resolves to a *second* instance — two React contexts, and a provider stops seeing its own consumer. `phase-3.mjs` reads the specifier back out of the served consumer file instead of typing one. Editing a context file with the server already up is what makes this bite. |
| **Most registered projects answer 413, and a dead one answers 404** | `GET /api/projects` lists seven directories on this host, and the recursive tree route (`…/files`) refuses `/`, `/home/lyphe`, `/home/lyphe/.claude` and `/tmp` with a 413 at its 10,000-entry cap, while `mission-control` no longer exists on disk and 404s. Neither is a defect, and neither is a reason to re-register anything. The `…/list` route answers 200 for all four wide ones — it reads a single directory rather than a tree, which is what makes those projects browsable at all. |
| **A colour read mid-transition is a colour between two tokens** | `.vv-button` transitions `background-color`, `border-color` and `color` over 0.2s and `.vv-tabs__tab` over 0.35s, so a `getComputedStyle` taken right after a click or hover reports the blend, not either token. Read a freshly inserted element, or wait the transition out. |
| **A ratio read with the pointer on the row is the hover's ratio** | `.vv-button--ghost:hover:not(:disabled)` paints `--accent-soft`, and at `(0,3,0)` it out-specifies a call site's own `hover:bg-…` utility at `(0,2,0)` — nothing here is in a cascade layer, so specificity alone decides. A hovered project row is therefore standing on Verve's wash, not on the ground its own classes name, and `page.click()` leaves the cursor exactly where it clicked. Park it off the surface before measuring, or measure a row nothing is over. |
| **A success-only sign-in never reaches the error branch** | `phase-5.mjs` types a wrong password first, asserts the amber `Banner`, then signs in for real — because the login route answers `{error:{code,message}}` and a screen that hands that object to JSX takes the tree down rather than showing a message. No correct password visits that branch. Verify any new screen that surfaces an API error the same way: drive the rejection. |
| **Three sidebar readings are only as good as this host's data** | "↳ Show N older conversations" is *asserted*, and needs a project whose first page of sessions is not its whole history — a host without one reports a failure where there is an absence. The other two can only be noted: `messageCount` is `0` on every session server-side, so the "N messages" segment never renders, and no plugin is installed here — the registry reads `~/.claude-code-ui/plugins`, not this repo's `plugins/`, and it is empty — so the plugin tabs draw nothing to read. |

## Hosted instance

Since 2026-09-06 the dev server the probes drive is a pair of systemd units, not a tmux
session — `cloudcli-server-dev.service` (:3011 loopback) and `cloudcli-client-dev.service`
(:5183 on every interface) — see [hosting.md](hosting.md). The ports are unchanged, so every
`phase-*.mjs` runs as before. Two consequences: the app is now the operator's daily instance,
so a probe run mutates a live session's state (theme, preferences, the login modal, the sealed
`/git` press) — **run the suite only when nobody is in the app**, and always solo; and a server
edit made while a probe is mid-flight restarts the API under it (`tsx watch`), which reads as a
transient — re-run, never re-aim.
