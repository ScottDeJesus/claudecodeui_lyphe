<!-- docstore export; edit rows with docstore write, never this file -->

## MAN-7401 — The Claude update check

The read half of the Claude Code / Agent SDK update pipeline: `GET /api/claude-updates` and
`POST /api/claude-updates/check`, both behind `authenticateToken`, mounted in `server/index.ts`
right after `/api/system`. `createClaudeUpdatesModule({ appRoot, supervised, isListening,
requestReboot, onRebootFailed })` (`claude-updates.module.ts`) builds `{ router, start, stop,
startReconciler }`; the entrypoint wires `start()` after `listen` (the first tick writes a file and
asks the registry — a boot that never gets there does neither), `stop()` on shutdown (a check
already in flight is left to finish), and `startReconciler()` as the last of `soleServerDuties` — a
job is picked up only once a server is serving. The reboot channel is `supervised-boot.ts`'s own
(`requestReboot` / `onRebootFailed`), so both sides of a handover use one voice.

```json
{ "checkedAt": 1790632555421, "checking": false, "checkError": null, "nextCheckAt": 1790634355421,
  "supervised": true, "job": null,
  "packages": [
    { "key": "cli", "installed": "2.1.283", "loaded": null, "latest": "2.1.284",
      "updateAvailable": true, "updatable": true, "reason": null,
      "notes": [{ "version": "2.1.284", "body": "…" }], "notesReason": null, "changelogUrl": "…" },
    { "key": "sdk", "installed": "0.3.165", "loaded": "0.3.165", "latest": "0.3.284", … } ] }
```

`ClaudeUpdatesReport` / `ClaudeUpdatePackage` and the rest of the wire contract are declared under
`CLAUDE UPDATE CONTRACTS` in `server/shared/claude-update-types.ts`, mirrored field for field in
`src/shared/claude-update-types.ts` — read them there, not a copy here.

**The five files of the check half, one question each:**

| file | owns |
|---|---|
| `update-check.store.ts` | `check.json`'s shape: read once at service build, written atomically (temp file + rename) after every check |
| `update-check.reader.ts` | one package's world-read — `npm view <name> dist-tags.latest --json` (30 s ceiling; npm itself is capped to 10 s / 0 retries via `npm_config_fetch_*` env so its own error text beats the kill) — plus the changelog fetch and the re-read trigger |
| `changelog.ts` | `fetchChangelog` / `parseChangelog` / `notesBetween` over the two `CHANGELOG.md` files, sectioned on `## x.y.z` |
| `update-check.report.ts` | the report's composition: `installed`/`loaded`/`latest` never inferred from one another; `updateAvailable` and `notesReason` decided here |
| `update-check.service.ts` | the cadence (a tick every 5 min, a check every 30 min, first tick 5 s after `start()`), `checkNow()` (joins an in-flight check, never rejects), the one journal line per check |

**Rules:**
- A failed registry read keeps the last-good `latest` and stores the failure in `latestError` (per
  package) / `checkError` and the journal line (per attempt) — a lost read is never a lost `check.json`.
- The changelog window is `(windowFrom, latest]`, re-read only when `latest` moved, the install fell
  BELOW its stored `windowFrom` (a rollback — the one direction a stored window can be too narrow),
  or an update is on offer the stored notes don't reach yet. An install that moved *up* never
  triggers a re-read: the stored set is then wider than needed and the report narrows it.
- `notesReasonFor` tests the floor (`windowFrom` above the install) before the "no entry yet" line,
  else a window that starts too high reads as a changelog with no entry for a release it was never
  asked to cover.
- A `checkedAt` in the future (a clock stepped back) is read as no check at all, on disk
  (`readStoredCheck`) and in memory (`checkIfDue`'s negative-gap branch); both re-check, and
  checking re-stamps.
- The CLI's `installed` is the one cached reading `readInstalledCliVersion()`
  (`@/modules/cli-version/index.js`) answers — the same reading `/api/cli-version` and the chat
  runtime's retirement decision use (MAN-501; MAN-502 rule 1). This module resolves no binary of
  its own.
- `isBehindInstalled` (`server/shared/version-order.ts`) is the one ordering rule behind every
  version comparison here — the changelog window, `updateAvailable`, the short-window test, the
  reader's re-read trigger — the same rule MAN-502 describes for the chat runtime and the idle sweep.

**Out of scope for this row:** the job — `ClaudeUpdateJob` and the install/restart half — is
MAN-7402 (the detached runner: `update-job.ts`, `update-runner.ts`) and MAN-7403 (the API side that
starts, watches and commits it: `update-actions.service.ts`, `update-reconciler.ts` with its
`.states`, `update-commit.ts`, the `POST /apply` and `POST /restart` routes).
`claude-updates.module.ts` reads `job.json` and the last 40 lines of its log into every report
(`currentJob()`) but owns none of the job's own behavior.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/claude-update-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/version-order.ts

## MAN-7402 — The Claude update runner — install and rollback

The install/restart half of the Claude Code / Agent SDK update pipeline (the read half — the
version check — is MAN-7401): a DETACHED runner process that outlives the API process that
requested the update. Three files, one question each:

| file | owns |
|---|---|
| `update-job.ts` | `job.json`/`job.log` under `claudeUpdatesDir()`; `createJob`/`readJob`/`writeJob` (temp-file + rename, never a half-written read); `spawnUpdateRunner(appRoot, dir, mode)`; `isRunnerAlive(pid)` |
| `update-runner.ts` | the state machine run BY the spawned process: `runInstall` / `runRollback`, one command per step |
| `runner-command.ts` | one command's mechanics: argv spawn (no shell), framing into `job.log`, the 10-minute ceiling, the detail rule — used by `update-runner.ts` and by nothing else |

**Spawn** (`spawnUpdateRunner`, `update-job.ts`): `process.execPath` with the same tsx loader pair
`deploy/dev-supervisor/child.mjs` uses (`--require preflight.cjs`, `--import loader.mjs`) running
`update-runner.ts <dir> <install|rollback>`; `cwd: appRoot`; `detached: true`; `stdio: ['ignore',
logFd, logFd]` where `logFd` is `job.log` opened for append (closed in the parent once the child
holds it); env is `process.env` + `TSX_TSCONFIG_PATH`, with `CLOUDCLI_SUPERVISED` /
`CLOUDCLI_HANDOVER` deleted (a spawned command must not inherit a supervisor claim that isn't
this process's); `unref()`; returns the pid. The loader pair matters because through the tsx CLI
the returned pid would be tsx's, and `isRunnerAlive()` reads `/proc/<pid>/cmdline` for the literal
substring `update-runner` — the CLI's cmdline wouldn't have it, so every live runner would read as
dead. The caller writes `runnerPid` into `job.json` itself (`createJob` → `spawnUpdateRunner` →
set `runnerPid` → `writeJob`); the runner's own first write is never the one that records its pid.

**Runner startup** (`update-runner.ts` `main`): argv `<dir> <install|rollback>`; a missing dir or
an unrecognised mode refuses (exit 1, one usage line, `job.json` untouched) BEFORE the job is even
read — a mistyped hand-run must not mark someone else's live job `failed`. Then `awaitJob` polls
`job.json` every 100ms (`JOB_POLL_MS`) for up to 10s (`JOB_WAIT_MS`) for `job.runnerPid ===
process.pid`; a job that never names this pid gets `the job never named this runner (pid <pid>)`
and exit 1, `job.json`/`job.log` untouched — the guard against a stray or duplicate spawn acting on
a job it doesn't own. Exit code is about the PROCESS, not the job: 0 once a verdict is on disk
(whatever it says), 1 only when the process never got that far.

**Install** (`runInstall`): runs the job's `cli`/`sdk` steps in `job.steps` order, one at a time; a
job with ZERO install steps throws `the job names no install step` (never a vacuous green
`installed`) — caught by `markTopLevelFailure`, which marks the job `failed` with `endedAt` set and
logs `the runner stopped: the job names no install step`. A failed step stops the run; later
install steps stay `pending` (the reconciler only advances a job out of `installed`, so nothing
would ever commit or restart what a further install changed). `installCli`: `npm install -g
<pkg>@<version>`; exit 0 is the whole verdict. `installSdk`: `npm install --save <pkg>@<version>`,
but landed means BOTH exit 0 AND `readSdkVersionOnDisk() === version` — npm can exit 0 having put
something else in place, and the restart that follows only has the disk to go on. On landing,
`job.packageFiles.hashesAfterInstall` is set to `hashPackageFiles(REPO_ROOT)` (INV-100's commit
guard reads this later — a file it can't re-read hashes to `''`, never a blind commit). On failure
the step is marked `failed`, `restoreSdk` runs (reinstalls the step's `from` version; if
`job.packageFiles.cleanAtStart`, also `git checkout HEAD -- package.json package-lock.json`; the
outcome is appended to the step's own detail as `; <version> restored` or a failure sentence), and
the `restart`/`commit` steps (when present) are marked `skipped` — `the SDK did not install`. Job
ends `installed` (**`endedAt` stays null** — not over, the reconciler restarts onto it next) when
every install step is `done`, else `failed` (`endedAt` set).

**Rollback** (`runRollback`): reinstalls the `sdk` step's `from` version and ends ON that step
(never a fresh one) — success marks the `commit` step `skipped` (`nothing to commit — Claude Agent
SDK <from> is back`) and the job `rolled-back`; failure (the npm install, or — when
`cleanAtStart` — the `git checkout` after it) marks the job `failed`, detail carrying `node_modules
may not match package-lock.json` after either failure's own message (git's own first stderr line
for the checkout, via `gitDetail`). No `sdk` step or no `from` on it: `nothing to roll back to: the
job does not name an Agent SDK version`, job `failed` at once — a rollback must never install a
guess. Rollback ALWAYS sets `endedAt`, on every branch (unlike install's `installed`).

**Running one command** (`runner-command.ts`, `runCommand(argv, cwd)`): argv spawn, never a shell.
`job.log` gets `[ISO] $ <argv joined>`, then one `[ISO] <line>` per output line (blank lines
dropped — npm pads with them), then `[ISO] exit <code|signal>`. `say()` is the single writer — this
process's own stdout IS `job.log` (the spawner opened it and handed it over as both stdout and
stderr), so runner lines and command lines interleave in true order. `COMMAND_TIMEOUT_MS` = 10
minutes: SIGTERM, then SIGKILL after a 10s grace (`KILL_GRACE_MS`) if it's still alive — a timeout
is the verdict whatever the exit code says, and its detail (`npm did not finish within 10
minutes`) overrides npm's own last line. After the process's own `exit` event, `STREAM_DRAIN_MS` =
250ms is given before the verdict settles — an npm-spawned install-script grandchild can hold the
piped stdio open after npm itself is gone, and a verdict must never hang on that (`child.mjs` waits
out the same hazard with the same bound). A command that never started at all (nothing named on
PATH) is a FAILED command, not a runner crash: the framed verdict line reads `exit — the command
never started` (words, not `-2`, the bare libuv code) while `CommandResult.code`/`signal` keep the
raw values for any machine reader. `failureDetail`: the first line starting `npm error`, else the
last line printed, else `npm exited with <code|signal> and said nothing`. `gitDetail`: git's own
first stderr line, or the general detail when there isn't one.

**Any uncaught throw** during `runInstall`/`runRollback` is caught by `main` and handed to
`markTopLevelFailure`: whatever step is `running` is marked `failed` with the error's own message,
the job is marked `failed` with `endedAt` set, and `job.log` gets `the runner stopped: <message>` —
leaving the job in `installing` would have the reconciler read a dead runner as `interrupted`
(vanished), which is not what happened.

`spawnUpdateRunner`'s caller (`update-actions.service.ts`) and the reconciler that reads
`runnerPid`/`isRunnerAlive` (`update-reconciler.ts`) are MAN-7403 — the API-side half that starts,
watches and commits a job this file's process only ever runs.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/runner-command.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-job.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-runner.ts

## MAN-7403 — The Claude update apply/restart — routes, actions, reconciler

The serving half of the install/restart pipeline (the detached runner process is MAN-7402; the
version check is MAN-7401): once a job exists, everything that starts it, watches it, restarts
onto it and commits it belongs to whichever API process holds the port. Six files, one question
each:

| file | owns |
|---|---|
| `claude-updates.routes.ts` | `POST /apply` and `POST /restart` (`GET /` and `POST /check` are MAN-7401's) |
| `update-actions.service.ts` | `applyUpdate` / `restartServer`: the ordered refusal checks, the burst guard |
| `update-reconciler.ts` | the tick: when a pass runs, one at a time, and dispatch by `job.state` |
| `update-reconciler.states.ts` | what `installed` and `restarting` DO: CLI verification, the reboot, the 4 ordered rules |
| `update-commit.ts` | the commit step's 4 guards, INV-100's pathspec rule, never pushed |
| `update-git.ts` | `GitResult`/`RunGit` — two type aliases only; the one `execFile` implementation lives in `claude-updates.module.ts` |

**`POST /apply`** (body `{ targets: { cli?, sdk? } }`): 400 `bad-request` when the body carries no
`targets` object; else `applyUpdate(targets)` — a refusal answers its own `status`/`refusal`
(400 or 409), a success re-reads and answers the full report at 202 (a job has started, not
finished — the tab polls this route from here on). **`POST /restart`**: `restartServer()`; a
refusal is 409 with `{error, message}`; success is 202 `{ requested: true }` — the process about
to be replaced cannot honestly say more than that.

**`applyUpdate`'s checks, in order** (`update-actions.service.ts`): shape (`readNamedTargets` —
only `cli`/`sdk` keys, each a string value, at least one) → the in-process `startingUpdate` flag
(409 `job-active` — closes a same-process burst: measured 2026-09-28, two `POST /apply` in one
burst both accepted and spawned two runners before this guard existed) → `job.json`'s own state
against `APPLY_ACTIVE_STATES` (`installing`, `installed`, `restarting`, `rolling-back`) →
`selectKind` against a FRESH check report (every target equals that package's `latest` now ⇒
`update`; every target equals the last `done` `update` job's own `from` ⇒ `rollback`; neither ⇒
409 `stale-target`) → the CLI's own `updatable` flag when `cli` is named (409 `not-updatable`) →
what is installed right now (a target already at the version asked for drops out; nothing left ⇒
409 `nothing-to-update`) → one more `job.json` read with **no `await` between it and `writeJob`**
(409 `job-active` again — this is the guard against the window the awaits above open: a job
written by another request, or another process across a handover, in that window is refused
rather than overwritten). `startingUpdate` is set before the first await and released in a
`finally`; a missed release would refuse every later press for the life of the process. The
`git diff --quiet` clean-at-start test only runs when `sdk` is among the remaining targets.
Write order is `createJob` → `spawnRunner('install')` → set `runnerPid` → `writeJob` →
`reconciler.kick()` — the runner waits for its own pid to appear in the file, never the reverse.

**`restartServer`**: 409 `not-supervised` when `supervised` is false; 409 `job-active` when
`job.state` is `installing` or `rolling-back` (`RESTART_ACTIVE_STATES` — the runner owns the tree
in those two); when the job is already `restarting`, records `job.restart = { requestedAt,
requestedBy: process.pid }` the same way the reconciler's own request is recorded, so a boot this
call triggers still rolls back on failure. `requestReboot()` answering false (the supervisor
channel closed between the check and the send) is 409 `not-supervised` too.

**The tick** (`update-reconciler.ts`, `TICK_INTERVAL_MS` = 1s): `start()` reads `job.json` once
and arms only for a non-terminal job; `kick()` arms it and no-ops before `start()`; a pass disarms
on a terminal job and, when the RUNNER was the one that ended it (`failed`/`rolled-back` reach a
terminal state without a pass of this file's), fires `runCheck()` once — the one memory the tick
keeps, so the panel does not wait out the cadence to see a version the runner already moved
(`TERMINAL_STATES`: `done`, `failed`, `rolled-back`, `interrupted`). One pass at a time (`busy`);
nothing runs before `isListening()`. `installing`/`rolling-back` with a dead runner
(`isRunnerAlive` false) → `interrupted`, the running step marked `failed` — a spinner over a dead
runner is a lie a person waits on. `installed`/`restarting` are handed to
`update-reconciler.states.ts`.

**`installed`** (`update-reconciler.states.ts`): verifies the `cli` step by reading the binary a
run would spawn and comparing it to `step.to`; a `cli`-only job ends there (`done`/`failed`, no
restart owed). An `sdk` step routes to the `restart` step: already on the loaded version (a
restart happened between the install and this pass) skips straight to the commit; else
`requestReboot()` — accepted moves the job to `restarting` and records
`{ requestedAt, requestedBy: process.pid }`; refused (`!supervised`) still moves the job to
`restarting`, the step's own sentence saying a person must restart it by hand.

**`restarting`**, four rules in order: (1) this process already loaded the target version → the
restart is done, run the commit, finish `done`; (2) a request of THIS process's own, unanswered
past `REBOOT_ANSWER_TIMEOUT_MS` (60s) → put the step back to `pending` for another press; (3)
another process booted AFTER the request (`performance.timeOrigin > requestedAt`) and loaded
something else → that boot WAS the answer and it was wrong → `failed`; (4) anything else (a boot
already in flight, a requester this process will never see again) → leave the job exactly as it
is. `rebootFailed` (the supervisor's failure listener) answers only a `restarting` job whose
`requestedBy` is this process's own pid: the `restart` step gets the supervisor's own error line,
the job moves to `rolling-back`, and `spawnRunner('rollback')` + `writeJob` + `arm()` happen in
one call — a failed boot always ends in a runner, never a job left stuck waiting.

**`update-commit.ts`'s four guards, in order**: no `commit` step on the job → throws (unreachable
from typed callers — only an sdk job carries one); `packageFiles.cleanAtStart` false → `skipped`
("had uncommitted changes when the update started"); `hashesAfterInstall` null or either hash
changed since the runner wrote it → `skipped` ("changed after the install"); else
`git commit -m <message> -- package.json package-lock.json` (INV-100 — the pathspec form commits
the FULL working-tree content of exactly those two paths, which is what the two guards above exist
to make safe) → `failed` on a non-zero exit (git's own first stderr line) or `done` (a
`rev-parse --short HEAD` for the receipt — a failed rev-parse costs the sentence its hash, never
the step its `done`). The commit runs with the repository's own hooks and is never pushed. Message:
`chore(deps): bump <sdk name> from <X> to <Y>` for an update, `roll back …` for a rollback — both
versions are the step's own, not whatever happens to be on disk when it runs.

**`claude-updates.module.ts`** builds the one `runGit` (`execFile('git', argv, { cwd: appRoot })`,
never rejecting — a git that ran and refused answers with its own code and words; only a git that
could not start at all answers `code: null`) and hands the same function to the commit, the
actions and the reconciler, so nothing here grows a second implementation of "ask git something."
`stop()` stops the reconciler along with the check (MAN-7401) — a shutdown owes nothing to a job
the runner still holds, and the next process reads the same file.

**`server/index.ts`'s global error middleware** answers a body `express.json()` could not parse
(`type: 'entity.parse.failed'` / `'entity.too.large'`) before the `AppError` branch, with one
`console.warn` line instead of a raw stack: `/api/claude-updates` gets `{error:'bad-request',
message}` — the shape its own routes use for every other refusal — while every other route keeps
the app's `{success:false,error:{code:'BAD_REQUEST',…}}` envelope. Without this a truncated body
on `/apply` or `/restart` answered 500 `INTERNAL_ERROR` (measured 2026-09-28). A future route
wanting the `/api/claude-updates` refusal shape has to join that path's own prefix branch; every
other route keeps the envelope.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/claude-updates.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/claude-updates.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-actions.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-commit.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-git.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-reconciler.states.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-reconciler.ts

## MAN-7404 — The Claude update client

The live frontend half of the Claude update pipeline (the wire contract is MAN-7401; the
install/restart backend is MAN-7402/MAN-7403): `src/modules/claude-updates/`, composed from Verve
primitives, wired into Settings and the sidebar. All three surfaces read the one module-scope report
in `hooks/useClaudeUpdates.ts`, and every call goes out through `src/shared/api.ts`'s `claudeUpdates`
group — `GET /api/claude-updates`, `POST /api/claude-updates/{check,apply,restart}`.

| file | owns |
|---|---|
| `index.ts` | the module's whole export surface: `ClaudeUpdatesSettingsTab`, `ClaudeUpdateFooterRow`, `ClaudeUpdateRailButton` |
| `hooks/useClaudeUpdates.ts` | the client contract: `{ report, refresh, check, apply, restart }`; `isUpdateJobActive(job)` — true on `installing`/`installed`/`restarting`/`rolling-back`; and the one module-scope report with its poller |
| `ClaudeUpdatesSettingsTab.tsx` | Settings → Updates: title (drawn even before the first report, with the one Try again press), clock line + Check now, one `PackageUpdateCard` per package, the actions row, `UpdateJobPanel`, the last press's refusal |
| `PackageUpdateCard.tsx` | one package: state line, `reason`, SDK `loaded` line, CLI mid-turn plural line, Roll back |
| `PatchNotes.tsx` | the notes list under a card |
| `UpdateJobPanel.tsx` | the four steps with icon + `from → to` + detail, `logTail` folded |
| `ClaudeUpdateFooterRow.tsx` | `ClaudeUpdateFooterRow` (sidebar footer row) + `ClaudeUpdateRailButton` (collapsed rail icon), both off one `useUpdatesFooterLine` hook |
| `updateWording.ts` | `UPDATE_STEP_LABELS`, `JOB_STATE_SENTENCES` — one place, because both the job panel and the footer row draw them |

**One report, one poller.** Every surface subscribes to the single module-scope slot; the read's
cadence follows the report's own `job` — 60 s idle, 1.5 s while `isUpdateJobActive(job)`, the timer
re-armed when that changes — and nothing is published until the body changes, so a poll answering
the same bytes moves no renderer. A failed read keeps the last picture. Each action posts and then
forces a read, resolving `{ ok: true }` or `{ ok: false, message }` — the refusal's own sentence
(`ClaudeUpdateRefusal`, 400/409) drawn under the buttons that asked; `refresh()` is that forced read
on its own, answering true/false.

**Rules**:
- `updateAvailable` is never re-derived client-side — `PackageUpdateCard` only draws the server's
  own reading (`installed` vs `latest`, the CLI's own ordering).
- "Available" (an offer drawn) = `updateAvailable && updatable && latest !== null`; an update that
  exists but is not `updatable` draws the plain pair plus `reason`, never a button.
- Roll back shows only when `job.kind === 'update' && job.state === 'done'` and this package's own
  step is `done`; it sends `{ targets: { [pkg.key]: step.from } }` — one package at a time.
- `Restart server` is drawn only while `report.supervised` — a process that cannot hand itself over
  offers no restart.
- The under-buttons sentence is drawn only while `versions.length > 0` (an offer exists); there is
  no fallback copy for "nothing on offer".
- The CLI card's mid-turn count is `useCliVersion().staleSessionIds.size` — this module never reads
  `/api/cli-version` itself (MAN-503).
- `en/settings.json` carries no `updates.*` keys; every string in this module ships its own English
  `defaultValue` (`updateWording.ts`'s own note) — do not add a parallel `updates` i18n block
  without moving these off `defaultValue` at the same time.

**Wired into (additive, no renames)**: `src/shared/types.ts` (`SettingsMainTab` gains `'updates'`),
`src/shared/constants.ts` (`SETTINGS_MAIN_TABS` — the command **palette's** own ordered list; it is
**not** the sidebar's list — `SettingsSidebar.tsx` keeps its own `NAV_ITEMS`, and the two are kept
in step by hand, no shared source, both carrying `updates` just before `about`),
`useSettingsController.ts` (`KNOWN_MAIN_TABS`), `Settings.tsx` (renders `ClaudeUpdatesSettingsTab`
on `activeTab === 'updates'`), `useProjectsState.ts` (`onShowUpdates: () => openSettings('updates')`),
threaded through `Sidebar.tsx` → `SidebarCollapsed.tsx`/`SidebarContent.tsx` →
`SidebarFooter.tsx`/`SidebarCollapsed.tsx` as one more prop, mirroring `onShowSettings`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/claude-updates/, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/settings.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useProjectsState.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/hooks/useSettingsController.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/SettingsSidebar.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/Settings.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarCollapsed.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarContent.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarFooter.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/Sidebar.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/constants.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## MAN-7416 — server/modules/agent-launch — the relay's service, shape checks, failure classes and timeouts

Module internals of the `/api/agent-launch` relay. Its contract (routes, bodies, refused 400 · unreachable 503 · unreadable 502, `LAUNCH_TABLE_BIN`) is MAN-7418; Metis's resolve is a section of MAN-7418; the window that reads it is MAN-7417. The server never opens `launch.toml` and never regenerates a shim; the CLI is the one reader and writer (MAN-7415, MAN-7407).

## service
| what | value |
|---|---|
| instance | one `createAgentLaunchService({ bin })`, built on first use, shared by the router and `resolveLaunchSide` |
| `resolveLaunchSide(name, side)` | barrel export; runs `resolve <name> --side <side>` through the same service; answers `AgentLaunchResolved` `{name, side, model, effort}` |
| spawn | `execFile` with argv (no shell), `cwd` = `os.homedir()`, env = `userFacingEnv()`, stdout cap 4 MiB |

## route checks — shape only
| check | value |
|---|---|
| row name | `^[a-z][a-z0-9_]{0,63}$`; a shape, not a soul whitelist |
| word (model, effort, model key) | `^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$`; a token fence, not the vocabulary — `-` first would read as a CLI flag |
| unknown body key | 400 |
| `effort` map | at most 16 models (`EFFORT_MAP_MAX_ENTRIES`); more would overrun the OS argv limit; `{}` counts as no field |
| no field named | 400 "name at least one of …" |

Which words the table accepts is the CLI's to say; its sentence reaches the caller.

## failure classes
Every failure is `AgentLaunchResult` `{ok: false, reason, message}`; the status each reason earns is MAN-7418.
| reason | when |
|---|---|
| `refused` | exit 2 with `{"error": "<sentence>"}` on stdout; the sentence passes untouched. The CLI's own argparse faults are refusals too |
| `unreachable` | spawn failure (`ENOENT`), timeout, crash, any other exit, exit 2 with no `{"error"}` on stdout |
| `unreadable` | exit 0 whose stdout is not one JSON object; a `resolveSide` answer whose `name`, `side`, `model` or `effort` does not match what was asked |

| verb | timeout |
|---|---|
| `show`, `resolve` | 20 s (`READ_TIMEOUT_MS`) |
| `set`, `defaults` | 90 s (`WRITE_TIMEOUT_MS`): the CLI's lock wait plus the 60 s regeneration |

An error thrown outside these branches goes to the app's error handler.

## shared types — `server/shared/types.ts`
`AgentLaunchResult<T>` · `AgentLaunchResolved` · `AgentLaunchRowChange` · `AgentLaunchDefaultsChange`.

The client mirror is `src/shared/agent-launch-types.ts`: the census key for key in the CLI's snake_case, plus `AgentLaunchRowChange` and `AgentLaunchDefaultsChange`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/agent-launch/agent-launch.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/agent-launch/agent-launch.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/agent-launch/agent-launch.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/agent-launch/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/agent-launch-types.ts

## MAN-7425 — SettingRow — the one settings row, its wrap rule and its probe

## `SettingRow` — `src/shared/ui/SettingRow.tsx`

One labelled setting and its control. Exported from `src/shared/ui/index.ts`. Every Settings tab, `LanguageSelector`, the heal panel's settings dialog (`HealControls.tsx`), the plugin cards (`PluginSettingsTab.tsx`, inside the card's accent-bar chrome) and the MCP server rows (`McpServers.tsx`) compose it.

| prop | meaning |
| --- | --- |
| `label` | the row's title, `break-words`: a string, or nodes when the title carries marks that must wrap with its words (a plugin's version and slot, an MCP server's transport and scope, a status badge) |
| `icon?` | mark before the label, in a `flex shrink-0` slot |
| `description?` | helper under the label: a string, or nodes for a byline and links |
| `children` | the control; `null` draws no control wrapper at all |
| other attributes | land on the root (`data-*` hooks) |

### Layout rules

| rule | why |
| --- | --- |
| The row wraps; the layout follows the ROW's width, never the viewport. No `sm:` breakpoint on a row. | The Settings modal and the heal dialog differ in width at one viewport; a breakpoint gets one wrong. |
| Text column is `min-w-[min(100%,10rem)] flex-1`; controls are `max-w-full shrink-0`. Controls sit beside the text while a 10rem column fits, else drop below it. | Without a floor the text column got the remainder: 1px beside a stepper + ghost button + switch at 360px, label spilling under the controls. |
| Floor is 10rem. Switch-only rows stay inline at 320, 341, 357, 360 and 390px at 1.0× and 1.072× text scale, and from 357px at 1.2×. | Measured 2026-09-29. 13rem dropped every switch row below its text at 320 (208 + 16 + 52 > 254px) and was too wide at the operator's 1.072× text scale (fix-pass M1). 9rem also holds 341px at 1.2×. |
| A switch-only row seen dropping below its text near 341–360px: lower the floor. Steppers, buttons, inputs and badges drop below their text by design. | |
| Icon slot never shrinks, label span is `min-w-0`. No caller patches a glyph. | A wrapping label squeezed a bare icon to nothing. |
| A fixed-width field carries `max-w-full` (`w-64 max-w-full`, `NtfySettingsCard.tsx` `FIELD_WIDTH`). No `w-full sm:w-*` workaround. | Both were patches for the squeeze the floor now handles. |
| `null` children ⇒ no wrapper. | An empty `shrink-0` wrapper takes its own flex line and adds a blank band under the text (Jev's scope rows). |
| A status badge rides the label line, with `null` children (`AccountContent`'s Connected badge). | In the controls slot the floor treats a badge like a button and drops it under the text at 320px. |

### Proof — `.verify/probe-settings-rows.mjs`

```bash
node .verify/probe-settings-rows.mjs <before|after>
```

The measurers live in `.verify/lib/settings-rows-measure.mjs` (run inside the page), the walk, stubs and drivers in `.verify/lib/settings-rows-walk.mjs`.

| item | value |
| --- | --- |
| Word | prefixes shots: `.verify/shots/settings-rows-<word>-<place>-<viewport>-x<scale>-<theme>.png` |
| `SETTINGS_ROWS_WIDTHS` | comma list of CSS px, default `320,360,390,1440`; under 768 is a phone |
| `SETTINGS_ROWS_SCALES` | comma list of text scales, default `1,1.072` (the operator's phone draws text at 1.072×; the root font size is set, as Android's font scale does) |
| `SETTINGS_ROWS_CLIENT` | URL of a `vite preview` of a pre-change build, to measure `before` after the tree moved on |
| Finds rows | by shape (flex box of two children: text, then a control or a status pill, beside a column that takes the slack), never by class or component name |
| Measures | text-column width; control over a label/description/icon line box (overlap); control past the row or pane edge (overflow); the column's ink past its own edge (spill); ANY text past its own column, in a row or not (overrun — the MCP URL); a switch-only row or a status pill below its text at a phone width (dropped); a pill set into a label's line below the words it follows; a control cut by the box that hides it (cut — its box leaves an `overflow: hidden` ancestor's or the pane's; a scroller passes): the plugin install form's button behind its input, the uninstall banner's Remove |
| Provider strip | measured on the Agents tab at every walk and once more at 768 × 1.2×: no provider button clipped by an `overflow: hidden` ancestor, none truncated, the last one reachable when the strip scrolls |
| Tab resize | opens Settings at 1440, picks a tab, crosses to 700, reads the tab and whether the pane node survived; then the same from a second tab back to 1440; then a phone turned to landscape and back (390×844 ↔ 844×390), the tab picked in portrait |
| Stubs | swarm ceiling set; TaskMaster installed; two installed plugins (the box has none; one with a 52-character name) — each answered locally, and the walk presses the first card's uninstall to draw its confirm banner, then Cancel; the box's user-scope MCP list gets a long-URL server and a long-stdio server (long command, args, env, cwd) added (a GET, answered from the real reply); every non-GET to preferences and settings is answered locally |
| Verdict | last line `settings-rows=pass` (exit 0) or `settings-rows=fail` (exit 1); usage error exits 2 |
| Baseline 2026-09-29, round 2 | before: plugin cards' text column 122–135px at 320 and the repo slug running out of it; MCP URLs 14–382px past their column at 320–390, 6px at 1440; the Connected badge below its text at 320; OpenCode clipped at 768 × 1.2; the open tab reset to Agents on every crossing of 768. After: 0 overlaps, 0 overflows, 0 overruns, 0 dropped switches or badges at 320/360/390 × 1.0/1.072, the plugin cards' column 246px at 320, the strip scrolls with every provider reachable, tab and pane kept across both crossings |
| Not covered | the heal stepper value wrapping to two lines at 360 (no overlap) |

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/mcp/McpServers.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/plugins/PluginSettingsTab.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/ProjectSidebarRegion.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/NtfySettingsCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/AgentSelectorSection.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/SettingRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/settings-rows-measure.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/settings-rows-walk.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-settings-rows.mjs

## MAN-7426 — Lightbox — the one full-screen zoom viewer for pictures and diagrams

`src/shared/ui/Lightbox.tsx` + `src/shared/ui/useZoomPan.ts`: the one full-screen zoom viewer.

- Callers: `ImageLightbox` (`src/modules/chat/transcript/ChatMessageImages.tsx`; thumbnails, composer attachments, file previews) and `MermaidDiagram` (the chat's mermaid fence and a markdown preview).
- In the kit because chat and markdown-preview cannot import each other.
- `Lightbox` is exported from `src/shared/ui/index.ts`; `useZoomPan` is not, as with `usePointerDrag`.
- `ImageLightbox` is a thin `<img>` wrapper; `MermaidDiagram`'s `DiagramViewer` passes an opaque card, because mermaid's light theme draws dark ink the backdrop would swallow.

## Lightbox — inputs

| Input | Result |
| --- | --- |
| open | fitted (scale 1) |
| wheel; trackpad pinch (`ctrl`+wheel) | zoom about the pointer |
| two-finger pinch | zoom about the midpoint; a drifting pinch also pans |
| drag | pan, clamped so no empty backdrop shows on an axis the content overflows |
| double-click; double-tap | toggle fit and 2× |
| `+` `−` buttons; keys `+` `-` `0` | step ×1.5 about the centre; fit |
| Esc; close button; click on the backdrop | close |
| click on the content; the click ending a pan or pinch; a press begun on a control and released on the backdrop | never closes |

## Lightbox — rules

- Zoom runs fit (1×) to 8×. It is a CSS transform on the content, so an svg redraws sharp at every level. No `will-change: transform`: it pins the raster and blurs an svg.
- The viewer is a native modal `<dialog>`, portalled to the host window's `<body>` and opened by `showModal()` in a layout effect, in that document's TOP LAYER. No fixed layer (the PRD editor's `z-[200]`, Settings' `z-[9999]`, a later one) can cover it, and it carries no z-index. Anything that must sit above it has to be top-layer itself.
- `showModal()` makes the page inert, focuses the close button and keeps Tab inside. Focus returns to the opener on close. The dialog's `cancel` is prevented: Esc is heard from the host window's capture phase, so closing never stops a run.
- A `ResizeObserver` on the stage and the content re-clamps the pan on a window resize or a phone turning. It is built by the host window's constructor (`resizeObserverIn`, MAN-7451) and rebuilt on a move.
- A `ctrl`+wheel delta is capped at 25px per event: a Ctrl+mouse-wheel notch lands near a plain one (about 1.28× against 1.25×), not 2.7×. A pinch, many small deltas, is unaffected.
- `useZoomPan` hears moves and releases on the HOST window (`useHostWindow()`, MAN-7443), never through pointer capture: capture retargets the `click` that ends a press, and the overlay needs the click's real target to tell the backdrop from the content.
- Double-tap is two taps within 320ms and 32px; a touch screen sends no `dblclick`.
- Controls carry `data-lightbox-control`; a capture handler records whether a press began on one (found with `isElementLike`, not `instanceof Element`), and the overlay's click ignores such a press.
- The toolbar is centred with `inset-x-0 mx-auto w-fit`, never `-translate-x-1/2`: on a touch screen `src/index.css` gives a tapped `button` `transform: inherit !important`, so a button inside a translated parent jumps half its width between press and release and the click misses.
- The same rule gives a tapped `[role="button"]` `background-color: inherit !important`: `MermaidDiagram`'s button carries no paint and the card is its child.
- The close button and the toolbar are `absolute`, so the PWA inset rides their offsets (`--safe-area-inset-*`), not the layer's `pwa-notch-safe` padding.
- Not handled: Safari's desktop trackpad pinch, which arrives as `gesture*` events.

## Lightbox — MermaidDiagram

- A drawn diagram is a `role="button"` (`cursor-zoom-in`; Enter and Space too) that opens `Lightbox` on a card sized to fit the screen, capped at 2× the diagram's natural size. A diagram shown as its source never opens.
- The viewer's svg copy has every element id renamed with a `viewer-` PREFIX, because the inline diagram stays in the page behind it and sequence diagrams use ids (`actor14`, `root-15`) that are not scoped to the root id.
- Prefix, never suffix: mermaid's stylesheet picks markers out by the END of their id (`[id$="-crosshead"]`, `-barbEnd`, `-arrowhead`); nothing in it selects by the start.

## Lightbox — strings and probes

- Strings: `common.lightbox.*` (`close`, `zoomIn`, `zoomOut`, `fit`) and `common.shapes.diagram`, `common.shapes.diagramOpen`; all 11 locales. The close label is `Close preview` in `en`.
- `.verify/lightbox-zoom.mjs [label] [phase ...]`: desktop and a 390px phone, dark and light; a diagram, a picture, the markdown-preview path; sends no message.
- `.verify/pwa-notch-close-controls.mjs`: the close button clears the notch; it pins `userLanguage: 'en'` through `prefs-pin` to find the button by its label.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/transcript/ChatMessageImages.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/markdown-preview/MermaidDiagram.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Lightbox.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/useZoomPan.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lightbox-zoom.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/pwa-notch-close-controls.mjs

## MAN-7443 — Host window — which window a subtree is drawn in

`src/shared/context/HostWindowContext.tsx` — which window a subtree is drawn in, and the chat's moves between hosts. Types: `HostMove`, `HostWindowValue` in `src/shared/types.ts` (group `CHAT HOST`).

## Exports

| export | signature | does |
| --- | --- | --- |
| `HostWindowProvider` | `({ value: HostWindowValue, children })` | sets the window for its subtree |
| `useHostWindow` | `() => Window` | the provider's `hostWindow`; the global `window` outside a provider |
| `useHostMove` | `(listener: (move: HostMove) => void) => void` | calls the LATEST `listener` on every chat move, synchronously; subscribes to nothing outside a provider |

## Types

- `HostMove` = `{ phase: 'before' | 'after'; floating: boolean }`. `'before'`: the chat's node still sits in the host it leaves (flush what a closing window would lose). `'after'`: it stands in the new host. `floating`: the new host is a floating one (the panel or the picture-in-picture window), not the chat tab.
- `HostWindowValue` = `{ hostWindow: Window; subscribeMove: (listener: (move: HostMove) => void) => () => void }`.

## Rules

- Code that binds a listener, portal, measurement or frame to a window reads `useHostWindow()`, never the `window` / `document` global. why: the global is the opener, whichever window the chat stands in.
- The window goes in the dependency list of the effect that binds to it. why: a move is then a re-bind, not a leak on the old window.
- No provider ⇒ every reader gets the global `window`. why: a reader outside a provider is handed the object it used to name directly.
- The value is set in one place: the chat's move between hosts. why: taking the seam out changes that one function.
- `useHostMove` writes its latest-listener ref in a LAYOUT effect declared BEFORE the subscribing layout effect. why: a move is emitted from a layout effect; a passive write leaves the ref one render stale at `'before'`. `usePointerDrag`'s passive write is safe only because its callers fire from DOM events.
- The subscription is a layout effect keyed on `subscribeMove`. why: a component mounting in the same commit as a move already listens when `'after'` fires.

## Readers

| reader | binds to `hostWindow` |
| --- | --- |
| `WidgetFrame` (`src/modules/widgets/WidgetFrame.tsx`) | fullscreen-card Escape `keydown`, capture phase |
| `ChatGutterLayout` (`src/modules/chat-gutters/ChatGutterLayout.tsx`) | fullscreen gutter-widget Escape `keydown`, capture phase |
| the kit's overlays and `useDeviceSettings`/`useElapsed` | see MAN-7451 |
| the chat's state hooks (`src/modules/chat/hooks/`, `ChatInterface`) | see MAN-7452 |
| the chat's composer menus, transcript controls, copy helper, export and widget frames | see MAN-7466 |

- `WidgetFrame` and `ChatGutterLayout` call `otherOverlayHoldsEscape(hostWindow.document)`; the function takes the `Document` to query (`src/shared/ui/overlayEscape.ts`). why: a panel open in a picture-in-picture window lives in that window's document.
- `ChatHostSlot` (`src/modules/chat-host/ChatHostSlot.tsx`, MAN-7464) mounts the one `HostWindowProvider`, around the chat's portal; its `hostWindow` is the page's own `window` while the chat is home. `useHostMove`'s callers (`useChatRealtimeHandlers`, `useHostMoveScroll`, `useChatComposerState` under `src/modules/chat/hooks/`) hear the node's first adoption at mount as one `'before'`/`'after'` pair, and no other move yet. Everything outside the slot's subtree has no provider and reads the global `window`.
- Every reader: `grep -rln "useHostWindow()" src`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/context/HostWindowContext.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/overlayEscape.ts

## MAN-7444 — The project-chat door — openProjectChat, ProjectChatContext, useProjectChatState

## `useProjectChatState()` — `src/modules/project-workspace/context/ProjectsStateContext.tsx`

Returns `{ projectChoices, openProjectChat }` from `ProjectChatContext`, the innermost of the six provider contexts. Throws outside `ProjectsStateProvider`.

| field | type | holds |
|---|---|---|
| `projectChoices` | `ProjectChoice[]` | every project a chat can be pointed at |
| `openProjectChat` | `(projectPath: string \| null, mode: 'latest' \| 'new') => boolean` | the one door into a project's conversation |

- `ProjectChoice` = `Pick<Project, 'projectId' \| 'displayName' \| 'fullPath'>` (`src/shared/types.ts`); memoised on a JSON key of `[projectId, displayName, fullPath]`, so a session upsert does not rebuild it.
- Separate from `ProjectMainContext` so a reader of only these two is not woken by a selection change or a `projects` rebuild.
- The value is memoised on the two fields and moves only when the choices do.
- `ProjectsStateContext.tsx` is 297 lines: the next reader hook added there needs an extraction first.
- Readers: none yet (2026-09-29); the door and the context are live and waiting for their first consumers.

## `openProjectChat(projectPath, mode)` — `src/modules/project-workspace/hooks/useOpenProjectChat.ts`

`useOpenProjectChat(state)` returns the function itself. It keeps ONE identity for the provider's life: the five inputs (`projects`, `selectedProject`, `handleProjectSelect`, `handleSessionSelect`, `handleNewSession`) and the simple list's two (`enabled`, `setProjectId`) are read through one ref written in an effect.

Target project = the `projects` entry whose `fullPath === projectPath`, else `selectedProject`; neither → nothing happens, answers `false`.

| mode | target is the selected project | otherwise |
|---|---|---|
| `'latest'` | nothing | its newest session (`getAllSessions(project)[0]`): `handleProjectSelect(project)` then `handleSessionSelect({ ...newest, __projectId })`; no session → a new chat there |
| `'new'` | new chat there | new chat there |

- New chat = `handleNewSession(project)`. With the simple chat list on (`useSimpleChatListPreferences().enabled`), `setProjectId(project.projectId)` runs first, in the same commit — the new-chat picker's own rule.
- why: `SidebarSimpleList` re-selects the saved project whenever no chat is open; without the save, the workspace moves off the target one commit after the door answered `true`.
- Every new-chat path writes the operator's saved simple-list project, a null or unknown path included (the fallback project); saving the value already held is a no-op.
- Return value: `true` only when `projectPath` itself named a known project. A null path answers `false` even when it fell back to `selectedProject`.
- "Newest" is the sidebar's own rule — see the rule row on `src/shared/sessionRecency.ts`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/context/ProjectsStateContext.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useOpenProjectChat.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## MAN-7445 — Shortcuts are printed through one platform check

One platform check decides how a shortcut prints. A component never tests `navigator.platform` and never keeps its own modifier constant.

| Name | In | Returns |
|---|---|---|
| `isApplePlatform()` | `src/shared/utils.ts` | true on Mac, iPhone, iPad; false where there is no `navigator` |
| `modifierKeyLabel()` | `src/shared/utils.ts` | `'⌘'` on Apple, else `'Ctrl'` — for a lone modifier printed in its own `<kbd>` |
| `formatShortcut(key)` | `src/shared/utils.ts` | `⌘K` on Apple, `Ctrl+K` elsewhere; pass the key as it prints (`'K'`, `'.'`) |
| `CHAT_TOGGLE_KEY` | `src/shared/constants.ts` | `'.'` — the chat hotkey's key; one value, so what is printed is what is heard |

Callers: `SidebarHeader.tsx` (`modifierKeyLabel`), `ProviderSelectionEmptyState.tsx` (`formatShortcut('K')`), `useSwitcherActions.ts` (`formatShortcut(CHAT_TOGGLE_KEY)`).

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/constants.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/utils.ts

## MAN-7446 — chat-host pure parts — panel geometry, panel size storage, node placement, document mirroring

Four files in `src/modules/chat-host/utils/`. None reads React state; each is proven on its own.

## Proof
| what | run |
|---|---|
| `mirrorDocument`, `placeNode` in the live app (:5183, no model turn) | `node .verify/chat-host-pure-parts.mjs` — 21 checks, exits 1 listing failures |
| `panelGeometry` | run the file under `tsx`; only import is `import type { PanelPlacement }` |
`.verify/all.mjs` runs only `phase-<n>.mjs`; it does not run `chat-host-pure-parts.mjs`.

## `panelGeometry.ts` — where the floating panel stands
Exports `panelPlacement(anchorRect, size, viewportSize): PanelPlacement`, `clampPanelSize(size, viewport)`, `defaultPanelSize(viewport)`. `PanelPlacement` (`{left, top, width, height, grip}`; `grip` = the panel corner farthest from the FAB) lives in `src/shared/types.ts`, `CHAT HOST` group.

Constants (file-private):
| name | value |
|---|---|
| `PANEL_GAP_PX` | 12 — panel's near corner off the FAB, on both axes |
| `PANEL_MARGIN_PX` | 8 — panel to every viewport edge |
| `PANEL_MIN` | 376 × 360 (width, height). Width: one more than the 374px the widest phone (430) leaves beside a FAB parked at its edge, so no phone under 768px is ever beside; on a desktop the narrowest a chat reads at. Height: header 40 + composer with chips ~120 + three or four transcript lines |
| `PANEL_DEFAULT` | desktop 420 × 640; phone height = 0.6 × viewport height |
| `DESKTOP_MIN_WIDTH_PX` | 768 — at or above: desktop default; below: full width less margins |

`panelPlacement` rules:
1. Room per side = viewport − margin − (FAB edge ± gap). Grows toward the side with more room per axis; a tie goes right and down.
2. BESIDE — the roomier horizontal side holds `PANEL_MIN.width` (376): width = min(asked, room); height never shrinks for the FAB — top slides inside the margins instead. Grip = far vertical × far horizontal corner.
3. STACKED — that side holds under 376: `left` = 8, width = viewport − 16, top = FAB bottom + 12 (or above), height = min(asked, room above/below), floor 0. Grip on the edge away from the FAB, horizontal corner away from the FAB's half of the screen.
4. NaN and ±Infinity in any anchor/viewport field count as 0; a NaN size holds to the minimum; no function returns NaN. Source it guards: viewport height read as `innerHeight − parseFloat(keyboardHeight)` while the variable is unset.
5. `clampPanelSize` — each axis held in [`PANEL_MIN`, viewport − 16]; where they cross, the viewport wins. `defaultPanelSize` is NOT clamped; the caller clamps whatever size it ends with.

Measured under `tsx` 2026-09-29 (viewport 1440×900 / 390×844):
| case | left, top, size | grip |
|---|---|---|
| docked FAB (12,14), 1440×900 | 52, 54, 420×640 | bottom-right |
| docked FAB (12,14), 390×844 | 8, 54, 374×506 — STACKED below, full width | bottom-right |
| floating FAB (1380,820), 1440×900 | 948, 168, 420×640 | top-left |
| floating FAB (340,760), 390×844 | 8, 242, 374×506 — STACKED above | top-left |
| floating FAB (318,732), 390×844 | 8, 214, 374×506 — STACKED above | top-left |
| resting FAB at the right edge, 430×844 | 8, 182, 414×506 — STACKED | top-left |
`clampPanelSize` 5000×5000 → 1424×884 (1440×900), 374×828 (390×844); 10×10 → 376×360 (1440×900), 374×360 (390×844: the viewport wins the width). `defaultPanelSize` → 420×640 (1440×900), 374×506 (390×844).

Known limit: STACKED height can fall below `PANEL_MIN.height` (360) for a FAB mid-screen on a short phone (292 at 360×640 with the FAB at (150,300), 250 at 320×568 at (150,270)). A caller must not store the rendered height as the remembered size.

## `chatHostStorage.ts` — the one persisted value
| fn | contract |
|---|---|
| `readPanelSize(): {width,height} \| null` | never throws; absent, unparseable, wrong shape, or storage refused → `null` (caller uses `defaultPanelSize`) |
| `writePanelSize(size)` | writes nothing for a non-size; swallows a failed write |
- Key `localStorage['chat-host']`, value `{ panel: { width, height } }`; per browser, never the server.
- A size is valid only when both extents are finite and > 0.
- Panel position and where the chat is drawn are deliberately NOT stored: the chat is home on every load; the panel follows the FAB.

## `placeNode.ts` — `placeNode(node, parent)`: node becomes parent's last child
| when | call | why |
|---|---|---|
| same `ownerDocument` AND same `getRootNode()` AND `'moveBefore' in parent` | `parent.moveBefore(node, null)` | focus and iframes survive |
| any other | `parent.append(node)` | cross-document move (the picture-in-picture window) reloads frames whatever is used; `moveBefore` throws `HierarchyRequestError` on a detached node, which is how the chat's node is first placed |
Measured 2026-09-29: `'moveBefore' in Element.prototype` true; a focused input in a moved div stayed `document.activeElement`; a plain `append` of the same div dropped focus. Into the frame's document: `append` once, `moveBefore` never.

## `mirrorDocument.ts` — `mirrorDocument(source, target): { ready, stop }`
Copies the opener's look into the picture-in-picture window's blank document and keeps it copied. Throws when `source.defaultView` is null.
1. `<base href>` = `source.baseURI`, first child of the target head. A `<base>` the target already had is reused and left at `stop`.
2. Every stylesheet `<link>` and `<style>` of the source head, cloned in source order. Head observer: childList, subtree, characterData, and attributes `href`/`media`/`rel`/`crossorigin` (a link rewritten in place). Sheet key: link = absolute `href` + media + crossOrigin; style = media + text. A clone whose key survives a pass is kept and untouched (a loaded link stays loaded); an unmatched one is removed.
3. `class`, `style`, `lang`, `dir`, `data-*` of `<html>` and `<body>`. First pass makes the target's mirrored attributes equal the source's; later passes write only attributes whose SOURCE value changed since the last copy. Same-attribute change overwrites wholesale (a `style` is one string).
4. `ready`: settles when every link cloned at the start has loaded or errored (at once when none); after `READY_TIMEOUT_MS` = 8000 if one never reports; and when `stop()` runs.
5. `stop()`: disconnects both observers, clears the timer, settles `ready`, removes the cloned sheets and the `<base>` it created. Target is left unstyled.

Rules for a caller:
- Check your own "still wanted" flag in `ready.then(...)`: `ready` may settle because of `stop`.
- Own the target's `<body>` `class`/`style` only as the mirror carries them; lay out inside the body, not on it.
- A second mirror into the same document (StrictMode mount, cleanup, mount) starts from a clean head only because `stop()` removes its clones.
- Recognition is by `nodeName` and `rel`, never `instanceof`; observers come from `source.defaultView.MutationObserver` (two windows, two constructors).

Measured 2026-09-29 (Playwright, :5183, frame = same-origin `about:srcdoc`): `ready` in 75 ms; stylesheet count 11 = 11 (1 link each); `<html>` classes equal; `dark` reaches the frame on the next task, not the same tick; `data-*` and CSS variable copied and removed; an appended `<style>` (12 = 12) and an in-place text rewrite (Vite HMR shape) reach the frame; an unchanged link keeps its clone across a re-mirror; after `stop()` neither a `<style>` nor a class change reaches the frame.

Unmeasured / open:
- A real `documentPictureInPicture` window.
- `<link rel="alternate stylesheet">` and `disabled` links are cloned as active sheets; the app writes none today.
- `<base href>` turns fragment links (`#x`) in the chat into navigation to the opener's URL; unverified in a real window.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/utils/chatHostStorage.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/utils/mirrorDocument.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/utils/panelGeometry.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/utils/placeNode.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-host-pure-parts.mjs

## MAN-7451 — Kit and shared hooks follow the host window

The kit's overlays and two shared hooks bind to `useHostWindow()` (MAN-7443), never the global `window`/`document`. At home the hook returns the page's own `window`: outside `ChatHostSlot`'s subtree there is no provider, and inside it (MAN-7464) the provider's `hostWindow` is that same `window`.

## What binds to the host window

| unit | file | bound to `hostWindow` |
| --- | --- | --- |
| `Dialog` | `src/shared/ui/Dialog.tsx` | portal target `hostWindow.document.body`; Escape/Tab `keydown` on `hostWindow` capture; body scroll lock; focus trap and `activeElement`; autofocus frame |
| `Tooltip` | `src/shared/ui/Tooltip.tsx` | portal; show-delay timer; position frame; `resize`/`scroll`; outside-press on the host document |
| `ActionMenu` | `src/shared/ui/ActionMenu.tsx` | portal; viewport clamp reads `hostWindow.innerWidth`/`innerHeight`; `resize`/`scroll`; Escape and outside press on the host document |
| `Menu`, `Select` | `src/shared/ui/Menu.tsx`, `Select.tsx` | Escape and outside press on the host document |
| `Lightbox` | `src/shared/ui/Lightbox.tsx` | portal to the host body; `keydown` capture on `hostWindow`; focus return |
| `useZoomPan` | `src/shared/ui/useZoomPan.ts` | `pointermove`/`pointerup`/`pointercancel`/`blur` on `hostWindow`; stage+content `ResizeObserver` via `resizeObserverIn`; wheel listener re-binds on a move |
| `Tabs` | `src/shared/ui/Tabs.tsx` | indicator `ResizeObserver` via `resizeObserverIn` |
| `useDeviceSettings` | `src/shared/hooks/useDeviceSettings.ts` | `hostWindow.innerWidth`; `resize` on `hostWindow` (narrow in a 420px window under a 1440px opener) |
| `useElapsed` | `src/shared/hooks/useElapsed.ts` | tick `setInterval` on `hostWindow` |

Every unit above has `hostWindow` in the dependency list of each effect that binds to it.

## Helpers — `src/shared/utils.ts` (group `DOM TESTS AND OBSERVERS THAT SURVIVE A WINDOW MOVE`)

| name | signature | use |
| --- | --- | --- |
| `isNodeLike` | `(target: EventTarget \| null \| undefined) => target is Node` | `typeof nodeType === 'number'`; `Tooltip` outside-press test |
| `isElementLike` | `(target: EventTarget \| null \| undefined) => target is Element` | `nodeType === 1`; `Lightbox` finds the control a press began on |
| `resizeObserverIn` | `(hostWindow: Window, callback: ResizeObserverCallback) => ResizeObserver \| null` | `new hostWindow.ResizeObserver(callback)`; null where the window has none; `Tabs`, `useZoomPan` |

## Rules

- An event target is tested with `isNodeLike`/`isElementLike`, never `instanceof Node`/`Element`. why: a node made in the PiP window belongs to that window's realm; the opener's `Node` answers false for it.
- A `ResizeObserver` is built with `resizeObserverIn(hostWindow, …)` and `hostWindow` goes in the effect's dependencies. why: an observer delivers on the frame lifecycle of the window whose constructor built it. 2026-09-29, Chromium PiP: 6 resizes of a PiP element reached a PiP-built observer 6 times; an opener-built one got 0 until the opener drew a frame, and a hidden opener draws none.
- The chat's `IntersectionObserver` (`useLazyRowObserver`) is built with the host window's constructor and rebuilt on a move (MAN-7452). An opener-built observer's delivery in a PiP window is unmeasured.
- A timer keeps the window that armed it with its id (`Tooltip`'s `timeoutRef` = `{ id, armedOn }`) and is cleared on `armedOn`. why: a move between arm and clear otherwise clears the wrong window's timer.
- `Dialog` binds Escape on the `hostWindow` capture phase, which runs before the chat's host-document capture listener (ChatInterface's Escape-stops-the-turn). why: closing a dialog never also stops the run; it marks the event first.
- A hook that binds pointer state to a window clears that state in the cleanup that unbinds the listeners (`useZoomPan` calls `heldPointers.clear()`). why: a move re-runs the effect; a half-held gesture must not outlive its window.
- A frame or timer spy in a probe keys on the kit callback's source (`FOCUSABLE_SELECTOR` for the `Dialog` frame, `setTooltipStyle` for the `Tooltip` frame). why: the opener draws frames constantly; a raw count is meaningless.
- `mirrorDocument` (`src/modules/chat-host/utils/mirrorDocument.ts`) keeps the opener `<body>`'s inline `style` live on the PiP body: an opener-side `Dialog`'s `overflow: hidden` lands on the PiP body too.
- Toasts of a floating chat draw in the opener tab.

## Deliberately on the opener

| code | why it stays |
| --- | --- |
| `DockableFab.tsx`, `usePointerDrag.ts`, `SplitPane.tsx` | the FAB, its drags and the split live in the opener around the chat |
| `KanbanLane.tsx`, `KanbanCard.tsx` | the board's own code |
| `useTabsOverflow.ts` | its only caller is `WorkspaceTabs`, the opener's tab rows |
| `jevSwitchesStore.ts` and the five switch hooks | one page-wide store each, polled on the opener's focus and visibility |
| `SessionProtectionContext.tsx` | one provider above the chat host; its poll and `visibilitychange` catch-up serve the opener tab |
| `ThemeContext.tsx` | writes the opener's `<body>`; the PiP window mirrors it |
| `ToastContext.tsx` | the toast stack draws in the opener |
| `WebSocketContext.tsx` | the one socket belongs to the opener; its listeners recheck on the opener's visibility and network events |
| `useRateChangeTick`, `useCliVersion`, `useVersionCheck` | hours-out timer / one module-scope poller / the opener's own poll |
| `usePageTitle` | `document.title` is the tab title |

## Probes

| command | proves |
| --- | --- |
| `node .verify/host-window-kit.mjs` | the components above, mounted under a `HostWindowProvider` in a real 420×680 Document-PiP window (Playwright Chromium, :5183), driven with real input and read back from both windows; the frame, timer, observer, `isNodeLike`, closed-window and move rows included. 2026-09-29: 45 of 45 pass |
| `node .verify/host-window-home.mjs` | at home nothing changed: Ctrl+K palette portals to `<body>` and locks/unlocks its scroll on Escape; the composer's kit tooltip appears on hover and goes; `useDeviceSettings` flips the composer's edit-mode chip at 1440 vs 390. 2026-09-29: 8 of 8 pass |

- Both exit 1 with the failed checks listed; neither sends a model turn or writes app data.
- Sibling probes touched by the same change: `.verify/lightbox-zoom.mjs`, `.verify/export-menu-layer.mjs` (MAN-7426, INV-4356).

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useDeviceSettings.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useElapsed.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/ActionMenu.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Dialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Lightbox.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Menu.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Select.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Tabs.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Tooltip.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/useZoomPan.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/utils.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/host-window-home.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/host-window-kit.mjs

## MAN-7452 — Chat state layer follows the host window

The chat's state hooks bind timers, frames, listeners and observers to `useHostWindow()` (MAN-7443, rules in MAN-7451) and keep the reader's place across a move between hosts. At home `hostWindow` is the page's own `window`: the chat stands inside `ChatHostSlot`'s `HostWindowProvider` (MAN-7464), whose value stays that `window` until a floating host moves the node.

## What binds to the host window

| unit | file | bound to `hostWindow` |
| --- | --- | --- |
| `ChatInterface` | `src/modules/chat/ChatInterface.tsx` | Escape-stops-the-turn `keydown`: document CAPTURE listener on `hostWindow.document`, still checks `defaultPrevented`; `hostWindow` in the effect's dependencies |
| `useChatSessionState` | `src/modules/chat/hooks/useChatSessionState.ts` | settle loop `requestAnimationFrame`/`cancelAnimationFrame` (`hostWindow` in the effect's dependencies); the follow-the-foot `setTimeout`s via `hostWindowRef`; scroll restore via `useHostMoveScroll` |
| `useChatRealtimeHandlers` | `src/modules/chat/hooks/useChatRealtimeHandlers.ts` | the 100 ms stream flush timer (below) |
| `useSessionPresence` | `src/modules/chat/hooks/useSessionPresence.ts` | `visibilityState` and `visibilitychange` from `hostWindow.document`; `hostWindow` in the effect's dependencies, so a move says the old document left, then announces the new one |
| `useLazyRowObserver` | `src/modules/chat/hooks/useLazyRowObserver.ts` | observer built by `hostWindow.IntersectionObserver`; a layout effect keyed on `hostWindow` disconnects the old one, builds a new one and re-observes every registered row; `isSupported` reads the host window |
| `useChatComposerState` | `src/modules/chat/hooks/useChatComposerState.ts` | submit defers and scroll-after-send timers; `hostWindow.confirm`; `getComputedStyle` from the textarea's own `ownerDocument.defaultView`; focuses the textarea on an `'after'` move when `floating` |
| `useInputHistory`, `useFileMentions` | `src/modules/chat/hooks/` | `requestAnimationFrame`, caret timers |
| `useSlashCommands` | `src/modules/chat/hooks/useSlashCommands.ts` | `requestAnimationFrame`; the menu debounce, cleared on the window that armed it |
| `useSubagentTranscript` | `src/modules/chat/hooks/useSubagentTranscript.ts` | poll `setTimeout`/`clearTimeout` |

## Scroll restore across a move — `src/modules/chat/hooks/useHostMoveScroll.ts`

`useChatSessionState` stays the scroll's one owner; it calls `useHostMoveScroll({ scrollContainerRef, isFollowing, fallback })` and imports `captureScrollRestoreState`, `restoreScroll`, `ScrollRestoreState` from the file.

`restoreScroll(container, state)` is the one restore rule for a transcript that was away:

| when | do |
| --- | --- |
| `state.following` | `scrollTop = scrollHeight` |
| `state.anchor` is connected and `anchorOffset !== null` | shift `scrollTop` so the anchor row stands at its recorded offset |
| else | `scrollTop = state.top` |

- Callers: the became-active branch of `useChatSessionState` (`anchor: null`: foot or top; MAN-385) and the move's `'after'`.
- `'before'`: a scroller that is connected with `clientHeight > 0` is captured (`captureScrollRestoreState` plus `following`, read from `isUserScrolledUpRef`); otherwise nothing is captured.
- `'after'`: restore from the capture, or from `fallback()` (`restoreStateAtMove` in `useChatSessionState`: the following flag, `scrollPositionRef.current.top`), then the capture is spent.
- The node's first adoption at mount is a move: `'before'` finds the scroller detached and captures nothing, `'after'` restores from `fallback()`.
- Both phases run in the move's own task. why: a node detached and attached loses `scrollTop`; no frame may paint the top and no scroll event may reach the near-top page load.

## Stream flush — `src/modules/chat/utils/streamFlushTimer.ts`

| export | does |
| --- | --- |
| `armStreamFlush(timerRef, hostWindow, flush)` | arms the 100 ms timer on `hostWindow`; the ref holds `StreamFlushTimer` = `{ id, armedOn, flush }` (`src/shared/types.ts`) |
| `clearStreamFlush(timerRef)` | clears on `armedOn`, the window that armed it |
| `flushStreamNow(timerRef)` | clears, then runs `flush` at once |

- `useChatRealtimeHandlers` arms through `armingWindowRef`. `'before'`: `flushStreamNow`. `'after'`: `armingWindowRef` = the transcript element's `ownerDocument.defaultView`. why: the context's `hostWindow` changes one render AFTER a move; a delta landing between would arm on the window just left.
- `resetStreamingState` in `ChatInterface` and the `stream_end` / `complete` branches call `clearStreamFlush`.

## Rules

- A timer or frame the reader waits on runs on the host window. why: a hidden opener holds its timers up to a second.
- A timer is cleared on the window that armed it (its ref keeps `armedOn`); a move between arm and clear otherwise clears the wrong window's timer.
- A bare `setTimeout` is not caught by a `requestAnimationFrame|addEventListener` grep: search `setTimeout(` and `setInterval(` too.

## Deliberately on the opener

| code | why it stays |
| --- | --- |
| `useSessionPresence`'s 30 s heartbeat | paces the server's 90 s expiry, not anything the reader sees; an interval armed on a window that closes dies with it |
| `useRestartOnInstalledCli.ts` deadlines (15 s, 5 s, 20 s) | the restart state machine, measured from absolute times |
| `usePinnedSubagentRows.ts` expiry repaint | hours away |
| `useVoiceAvailable.ts` | listens for `VOICE_CONFIG_SYNC_EVENT`, which settings dispatches on the opener's `window` |
| `useVoiceInput.ts` `navigator` | the opener's |
| `useChatSessionState` bare timers: the 8 s loading-wheel guard, the "Load all" hint pulses, the search-jump retries, the 4 s highlight flash | each bounds a wait; the reader is not waiting on it |
| `useChatComposerState`'s 5 s draft poll | reconciles data |

## Probes

| command | proves |
| --- | --- |
| `node .verify/chat-window-bindings-home.mjs` | at home, real Haiku turns in a scratch chat on :5183 (800×240 window, so two short turns overflow the scroller): a turn streams and the transcript follows its foot; Escape mid-stream stops the turn; a 400px-scrolled-up transcript is within 2px after a Files-tab trip, and at the foot it returns to the foot. Expects exactly two console `404`s from `/token-usage` on a fresh chat (the server answers 404 with no transcript yet). Deletes its chat |
| `node .verify/chat-window-bindings-move.mjs` | the REAL hooks (served source) in a Chromium Document-PiP window under a `HostWindowProvider` driven like `moveTo` (emit `'before'`, place the node, set the host, emit `'after'`): scroll anchor within 2px in both directions while the scroll height changes ~40%, a follower lands on the foot, a control scroller with no hook drops 500 to 0; flush at `'before'` and cleared on the PiP; presence; observer rebuilt by the right constructor with all 60 rows answering. 2026-09-29: 33 of 33 pass |

- `PROBE_APP_URL` points the home probe at another client of the same API (a before-tree on its own port).
- Both exit 1 with the failed checks listed. The move probe sends no model turn and writes no app data.
- `.verify/lib/scratch-chat.mjs` is the shared helper for a probe that sends a real turn: `createScratchChat(session)` (in `PROBE_PROJECT`, `.verify/lib/probe-project.mjs`), `openScratchChatOnHaiku(session, id)` (picks Haiku in the composer's `MODEL_CHIP`; throws if the chip does not read Haiku, so no turn is sent), `sendTurn(page, text)`, `deleteScratchChat(session, id)`; constants `MODEL_CHIP`, `SCROLLER`, `COMPOSER`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useChatRealtimeHandlers.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useHostMoveScroll.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useLazyRowObserver.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useSessionPresence.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/utils/streamFlushTimer.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-window-bindings-home.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-window-bindings-move.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/scratch-chat.mjs

## MAN-7464 — chat-host — the live chat's one node, its provider and its slot

`src/modules/chat-host/` owns the live chat's one DOM node and the door into it. Barrel exports three names: `ChatHostProvider`, `useChatHost`, `ChatHostSlot`. Types `ChatPlacement`, `HostMove`, `HostWindowValue`, `PanelPlacement` live in `src/shared/types.ts`, group `CHAT HOST`. Pure parts: MAN-7446. Chrome (`ChatHostPanel`, `ChatHostHeader`, `ChatHostPlaceholder`; unexported, unmounted): MAN-7467. Window binding: MAN-7443, MAN-7452.

## Tree

`ProjectWorkspaceShell` → `ChatHostProvider` → `AppSwitcherProvider` → `WorkspaceFrame` (`src/modules/project-workspace/`; MAN-491). `WorkspaceMain` wraps `ChatInterface` in `ChatHostSlot`, inside `ChatGutterLayout`.

## Files

| file | what |
| --- | --- |
| `context/ChatHostContext.tsx` | `ChatHostProvider`; `useChatHost(): { placement: ChatPlacement }`; `useChatHostMechanics(): { node, moveTo, subscribeMove, hostWindowValue, setHomeElement, publishFacts }` — module-internal, not in the barrel. Both hooks throw outside the provider |
| `ChatHostSlot.tsx` | `ChatHostSlot({ sessionId: string \| null, showing: boolean, children })` |
| `index.ts` | the barrel |

## Rules

1. The chat never renders in place. `ChatHostSlot` portals its children into `node`, at home as when floating. why: a second parent fiber remounts `ChatInterface`; one portal target keeps its draft, scroll and stream.
2. `node` is `div.flex.h-full.min-h-0.flex-col[data-chat-host-node]`, created once in the provider by a lazy `useState`, never recreated.
3. `moveTo(target, floating)`, one synchronous step:
   1. `node.parentElement === target` → return.
   2. emit `{ phase: 'before', floating }` — the node still stands in the host it leaves.
   3. `placeNode(node, target)` (MAN-7446).
   4. `setHostWindow(target.ownerDocument.defaultView)` when non-null.
   5. emit `{ phase: 'after', floating }`.
   The context's `hostWindow` follows one render later; an `'after'` listener reads the new window off its own element's document.
4. `emit` iterates a copy of the listener set. A throwing listener is caught (`console.error('[chat-host] a move listener threw while the chat changed hosts', move, error)`) and the move goes on.
5. `ChatHostSlot` renders `div[data-chat-host-home].flex.h-full.min-h-0.flex-col` (registered with `setHomeElement`) and a portal into `node` of `HostWindowProvider value={hostWindowValue}` around the children.
6. `ChatHostSlot` layout effect 1: `placement === 'home'` and the div exists → `moveTo(home, false)`. Layout effect 2: `publishFacts({ sessionId, showing })`; cleanup `publishFacts(null)`.
7. The node's first adoption at mount goes through `moveTo`: listeners hear one `'before'`/`'after'`. `'before'` sees a detached scroller, captures nothing; `'after'` restores from `fallback()` (`useHostMoveScroll`, MAN-373).
8. `placement` is state that stays `'home'`; nothing writes it. Never stored: every load opens home.
9. The home element and the published facts are refs in the provider; nothing reads them, and a change re-renders nothing. Readers arrive with the floating panel and the radial's fill.
10. `useChatHost` is read today by `ChatHostSlot` only; no file outside chat-host reads it.
11. Import edges: only `src/modules/project-workspace/` imports chat-host, through the barrel; chat-host imports `src/shared` and itself. `grep -rn "@/modules/chat-host" src | grep -v "^src/modules/chat-host/"` lists the callers.
12. A second export is how a second caller starts moving the chat: keep the mechanics hook, `moveTo` and `node` inside the module.

## Probe — `node .verify/chat-host-home.mjs before|after [--turn]`

Scratch chat in `.verify/lib/probe-project.mjs`'s project (under `/tmp`), opened by its `/session/<id>` link at 1440×900 and 390×844. Both modes delete the chat. Exit 1 lists failures.

| mode | does |
| --- | --- |
| `before` | run against a tree without the slot. Writes `.verify/artifacts/chat-host-home.json`: `getBoundingClientRect()` of the textarea and of the transcript scroller. Throws and writes nothing when `[data-chat-host-node]` is already drawn: the pre-change record cannot be retaken from the post-change tree |
| `after` | reads the record and holds both rects equal; checks the node's parent has `data-chat-host-home`, the transcript and composer stand inside the node, `document.querySelector('textarea') === window.__ta` after a Files-tab trip (at 390 the tab strip is in the sidebar drawer: the probe opens "Open menu" first). `--turn`: a Haiku turn streams and the transcript follows its foot |

Shots: `.verify/shots/chat-host-home-{before,after}-{1440,390}-light.png`.

Measured 2026-09-29 on :5183:
| | 1440×900 | 390×844 |
| --- | --- | --- |
| textarea rect, before = after | `{467.5, 754, 834×64}` | `{9, 722, 372×64}` |
| scroller rect, before = after | `{450.5, 0, 868×753}` | `{0, 45.5, 390×675.5}` |
| chat-area screenshot diff | 0 of 999,000 px | 0 of 329,160 px |
| textarea identity after Files-tab trip | true | true |
| Haiku turn, foot gap at each 250 ms sample | worst 0 px, final 0 px | worst 0 px, final 0 px |

- The Haiku reply grew the transcript in 2 steps only: "streams" rests on the reply landing and the foot holding.
- Console: one `token-usage` 404 for the scratch chat's session, present before the change; the probe holds the set equal.
- `.verify/chat-surfaces-home.mjs` (model menu, `/` menu, schedule popover, copy control) passes; it sends no turn, so it does not cover Escape stopping a running turn.

Open:
- One run at 1440 logged `[SessionProtection] Failed to sync running sessions: TypeError: Failed to fetch` with the API up 40 minutes; not seen in later runs; source not found.
- No floating host exists: `placement` never leaves `'home'`, and no move after the first adoption has run in the app.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/ChatHostSlot.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/context/ChatHostContext.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-host-home.mjs

## MAN-7466 — Chat surfaces follow the host window

The chat's composer menus, transcript controls, copy helper, transcript export and widget frames bind to `useHostWindow()` (MAN-7443; rules MAN-7451; state layer MAN-7452). At home `hostWindow` is the page's own `window`: nothing changes.

## What binds to the host window

| unit | file | bound to `hostWindow` |
| --- | --- | --- |
| `ComposerModelMenu`, `ComposerPermissionMenu`, `ScheduleMessagePopover` | `src/modules/chat/composer/` | portal target `hostWindow.document.body` |
| `useComposerMenuAnchor` | `src/modules/chat/hooks/useComposerMenuAnchor.ts` | anchor from `hostWindow.innerWidth`/`innerHeight`; `resize`, `scroll` and Escape `keydown` on `hostWindow`; outside press on the host document |
| `CommandMenu` | `src/modules/chat/composer/CommandMenu.tsx` | portal; `getMenuPosition(position, hostWindow)`: phone layout when `hostWindow.innerWidth < 640` (height ceiling 54% of the window's height), else the desktop layout (360px ceiling) clamped against `hostWindow.innerWidth`; outside press tested with `isNodeLike`. `ChatComposer` anchors it from `hostWindow.innerHeight` |
| `MessageCopyControl` | `src/modules/chat/transcript/MessageCopyControl.tsx` | format-menu portal; placement from `hostWindow.innerWidth`/`innerHeight`; `mousedown`, `scroll`, `resize` on `hostWindow`; copy through `copyTextToClipboard(text, hostWindow)` |
| `AskUserQuestionPanel` | `src/modules/chat/tools/InteractiveRenderers/AskUserQuestionPanel.tsx` | Escape `keydown`, capture, on `hostWindow`; focus read from `hostWindow.document.activeElement`; mount frame; element tests by `tagName` and `isElementLike`, never `instanceof` |
| `ActivityIndicator` | `src/modules/chat/composer/ActivityIndicator.tsx` | delay `setTimeout` and elapsed `setInterval`, each cleared on `hostWindow` |
| `ChatComposer` | `src/modules/chat/composer/ChatComposer.tsx` | voice-error 4 s timer; Send-hold timer kept as `{ id, armedOn }` |
| `ProviderSelectionEmptyState` | `src/modules/chat/transcript/ProviderSelectionEmptyState.tsx` | focus timer |
| `CollapsibleUserText` | `src/modules/chat/transcript/CollapsibleUserText.tsx` | `ResizeObserver` via `resizeObserverIn(hostWindow, …)` |
| `SubagentTranscriptView` | `src/modules/chat/subagents/SubagentTranscriptView.tsx` | `IntersectionObserver` built by `hostWindow.IntersectionObserver` |
| `ChatExportMenu`, `ChatMessageFiles` | `src/modules/chat/transcript/` | download anchor made in `hostWindow.document` |
| `WidgetFrame`, `useWidgetHost`, `DocSpaceFrame` | `src/modules/widgets/` | see "Widget frames" |

Every unit has `hostWindow` in the dependency list of each effect that binds to it. A timer is cleared on the window that armed it.

## `copyTextToClipboard(text, win = window)` — `src/shared/utils.ts`

- `win`: the window the press happened in. why: the clipboard answers to the FOCUSED document; for a control in the picture-in-picture window that is the window's, not the opener's.
- Primary path: `win.navigator.clipboard.writeText`. Fallback: a `readonly` textarea made, focused, selected and `execCommand('copy')`'d in `win.document`; it returns `false` when that document has no body.
- A CLOSED window's `writeText` returns `undefined`, not a promise; the helper treats that as not copied and takes the fallback (measured 2026-09-29: awaiting it reported a copy that never happened).
- Callers passing `useHostWindow()`: `MessageCopyControl`, `ThinkingRow`, `DataTable`, `CodeFence`, `DiffBlock`, `OneLineDisplay`, `BashCommandDisplay`. Every other caller keeps the default.
- `MarkdownCodeBlock` (`src/modules/markdown-preview/`) copies through the default `window`; chat does not import it.

## Transcript export

`downloadTranscriptExport(format, input, hostDocument)` — `src/modules/chat/utils/chatExport.ts`. `hostDocument` is the document the menu is drawn in (`ChatExportMenu` passes `hostWindow.document`).
- It is `buildTranscriptHtml`'s `sourceDocument`: the `dark` class and the stylesheets the file carries are read from it.
- It holds the download `<a>` (made, attached, clicked and removed there).

## Widget frames

| part | binds to |
| --- | --- |
| `readVerveTokens(hostDocument)` — `src/modules/widgets/readVerveTokens.ts` | resolves the tokens against `hostDocument.documentElement` through its `defaultView` |
| `WidgetFrame` first build — `WidgetFrame.tsx` | `dark` and tokens read from `useHostWindow().document`; the frames are keyed `<windowKey>:<code>` (MAN-415) |
| `useWidgetHost` — `hooks/useWidgetHost.ts` | `message` listener on `hostWindow`; every post made by `postAsHostWindow` (MAN-416); `postTheme` reads tokens from the OPENER's `document`, not the window's (MAN-415) |
| `DocSpaceFrame` — `DocSpaceFrame.tsx` | ready deadline on `hostWindow`, kept as `{ id, armedOn }` |

## Deliberately on the opener

| code | why it stays |
| --- | --- |
| `utils/pinnedDismissals.ts` `storage` listener | `storage` is `localStorage`'s news and `localStorage` is the opener's; `dismissPins` publishes to its listeners directly, so a dismissal in this tab never depends on the event |
| `utils/pageTitleNotification.ts` | `document.title` is the tab title |
| `export/buildTranscriptHtml.tsx` inline `onclick` | runs inside the saved file, whose `document` is that file's |
| `widgets/widgetBridgeScript.ts` | runs inside the widget's own frame |
| `CodeFence.tsx` syntax-theme `<style>` in the opener's head | chat-host's `mirrorDocument` clones head styles into the window and keeps them live; no probe reads it |

## Probes

| command | proves |
| --- | --- |
| `node .verify/chat-surfaces-window.mjs` | the REAL components (served source) mounted under a `HostWindowProvider` in a real 420×680 Document-PiP window (Playwright Chromium, :5183, opener 1440×900), driven like chat-host's `moveTo`, the opener's stylesheets mirrored into the window. Model, command and format menus open in the window, stand inside its viewport and close on Escape / outside press; `CommandMenu` takes the phone layout (54% height) in 420px and the desktop clamp in a 700px window (`setViewportSize`, restored to 420); Escape in the window skips the ask-user panel; a message copy and `copyTextToClipboard(text, win)` write through the window's navigator (a spy on both `writeText`s); a widget's `resize` and theme reach it, a widget carried in and back stays sized and themed. 2026-09-29: 29 of 29 pass |
| `node .verify/chat-surfaces-home.mjs` | at home, in a scratch chat under `.verify/lib/probe-project.mjs`'s project, nothing sent: the model menu opens over the composer (shot `.verify/shots/chat-surfaces-model-menu.png`), `/` opens the command menu, holding Send opens the schedule popover and sends nothing, a message's copy control copies (read back with `navigator.clipboard`) in the transcript stored by `.verify/embed-fullscreen.mjs` (`.verify/artifacts/embed-fullscreen.json`; run that probe first). Deletes its chat. 2026-09-29: 9 of 9 pass |

- Both exit 1 with the failed checks listed; `PROBE_APP_URL` points them at another client of the same API. Neither sends a model turn.
- Sibling probes for the same change: `.verify/embed-fullscreen.mjs`, `.verify/export-menu-layer.mjs`, `.verify/probe-claude-catalog-picker.mjs`.

## Not proven

- The clipboard against a genuinely unfocused opener: the harness treats every page as focused.
- `DocSpaceFrame` against a real DocSpace origin; `WidgetFrame`'s first-build token read.
- The voice banner, the observers, hold-on-Send and the `storage` listener across a move or a close.
- `postTheme`'s opener-document read: the window probe stays green if it reads the window's document. A pin needs a theme flip with a widget in the window, which writes the account's theme preference and needs a restore.
- `chat-host` has no provider yet (MAN-7464): every window scenario runs in the probe's fixture.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/composer/ActivityIndicator.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/composer/CommandMenu.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/composer/ComposerModelMenu.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/composer/ComposerPermissionMenu.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/composer/ScheduleMessagePopover.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useComposerMenuAnchor.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/tools/InteractiveRenderers/AskUserQuestionPanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/transcript/ChatExportMenu.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/transcript/MessageCopyControl.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/utils/chatExport.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/widgets/DocSpaceFrame.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/widgets/hooks/useWidgetHost.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/widgets/readVerveTokens.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/widgets/WidgetFrame.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/utils.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-surfaces-home.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-surfaces-window.mjs

## MAN-7467 — chat-host chrome — ChatHostPanel, ChatHostHeader, ChatHostPlaceholder and the fixture that photographs them

Three presentational components in `src/modules/chat-host/`: the floating chat's frame, its top row, and the tab's stand-in while the chat floats. Props only: none reads `useChatHost`, none is in the barrel (MAN-7464), nothing mounts them — `grep -rn "ChatHostPanel\|ChatHostHeader\|ChatHostPlaceholder" src | grep -v "^src/modules/chat-host/"` prints nothing. Geometry: MAN-7446. Kit grip: MAN-490.

## Components

| file | signature |
| --- | --- |
| `ChatHostPanel.tsx` | `ChatHostPanel({ placement: PanelPlacement, header: ReactNode, bodyRef: Ref<HTMLDivElement>, onResize, onResizeEnd })` — the two handlers are `ResizeGrip`'s |
| `ChatHostHeader.tsx` | `ChatHostHeader({ header: ReactNode, onCollapse: () => void })` |
| `ChatHostPlaceholder.tsx` | `ChatHostPlaceholder({ placement: 'panel' \| 'window', onBringBack })` — never `'home'` |

## `ChatHostPanel` rules

1. Frame is the kit `Card`: `position: fixed`, `z-[45]`, `border-input` (the strong border), inline `boxShadow: var(--shadow-lift)`. Attributes: `role="region"`, `aria-label` = `chatHost.panelLabel`, `data-chat-host-panel`, `data-grip={placement.grip}`.
2. Parts top to bottom: `header`; body `div[data-chat-host-body].flex.min-h-0.flex-1.flex-col.bg-background` (gets `bodyRef`, empty: the chat's node is moved in by `moveTo`); the grip's wrapper at `placement.grip`, 2px in from the corner (`GRIP_CORNER`).
3. `z-[45]`: above the application layer (40), below the FAB (60). Measured in the fixture on the shell's own container.
4. The panel measures nothing and moves nothing: rect and grip corner arrive in `placement`.
5. Grip in a TOP corner → the frame sets `--chat-host-header-left` (top-left) or `--chat-host-header-right` (top-right) to `1.75rem`, `2.25rem` under `(pointer: coarse)`. A bottom corner sets neither.
6. Grip in a BOTTOM corner under `(pointer: coarse)` → body `pb-5` (20px band under the composer). why: the composer keeps 8px from the panel's edge on a phone, so a 24px grip covers its send button. A mouse's 16px grip needs no band.

## `ChatHostHeader` rules

1. One row `div[data-chat-host-header].flex.h-10`: the `header` slot, then the collapse control.
2. Collapse control: `Button` `variant="ghost" size="icon"`, `h-8 w-8`, `Minimize2`, `aria-label` and `Tooltip` = `chatHost.collapse`, a transparent `before:-inset-1` catch that makes the hit area 40px.
3. Padding: `paddingLeft: var(--chat-host-header-left, 0.5rem)`, `paddingRight: var(--chat-host-header-right, 0.375rem)`. Custom properties inherit: the panel sets them, the picture-in-picture window sets neither and gets the fallbacks.
4. Slot wrapper is `-mx-1 flex min-w-0 flex-1 items-center overflow-x-clip px-1`. A slot that does not truncate itself is cut at the collapse control, never over it; the 4px lane keeps a picker's focus ring (2px wide, 2px off) whole. The picker must truncate itself.

## `ChatHostPlaceholder` rules

1. Root `div[data-chat-host-placeholder=<placement>].flex.h-full.min-h-0.w-full` (centered, `p-6`) around the kit `EmptyState`. It fills the box it is given and never positions itself.
2. `'panel'`: `PanelBottomOpen`, `chatHost.panelTitle`, `chatHost.panelMessage`. `'window'`: `PictureInPicture2`, `chatHost.windowTitle`, `chatHost.windowMessage`. Action label `chatHost.bringBack`.
3. The root scopes the message ink: `[&_.vv-empty__message]:text-muted-foreground` (`--ink-muted`, about 5:1). `EmptyState`'s own `--ink-faint` at 13.5px is about 3.1:1 on the light canvas, under AA; the kit is shared with three other modules and untouched.
4. Hand-off to whoever renders it beside `ChatHostSlot`: the slot's home `div` (`h-full`, empty while the chat floats) must be `hidden` whenever `placement !== 'home'`. Otherwise the placeholder lands entirely below the tab's box (top 900 in a 900px tab, button at y 1378) and the tab's `overflow-hidden` clips it: an empty tab with nothing to press. `ChatHostSlot` does not render the placeholder today.

## Seams

`grep -rn "FILL:" src/modules/chat-host` lists four:
| marker | where | fills with |
| --- | --- | --- |
| `// FILL: collapse` | `ChatHostHeader` `onClick` | the move home |
| `// FILL: bring-back` | `ChatHostPlaceholder` `onAction` | the move home |
| `// FILL: resize` | `ChatHostPanel` grip handlers | size write, clamped by `clampPanelSize` |
| `{/* FILL: body … */}` | `ChatHostPanel` body | adopts the node through `moveTo(body, true)` |

## Words

Eight keys under `chatHost` in `src/modules/i18n/locales/<lang>/common.json`, all 11 locales: `panelLabel`, `collapse`, `resize`, `panelTitle`, `panelMessage`, `windowTitle`, `windowMessage`, `bringBack`. `panelMessage` (en): "It's open over your work." — it names neither the button nor a side, because a phone stands the panel above or below the FAB.

## Proof — `node .verify/chat-host-chrome.mjs`

Mounts the three real components over the running :5183 page (`.verify/lib/mountReact.mjs`) with fake props; the framed application is a fixed iframe of `http://127.0.0.1:8005/` in the main region's `absolute inset-0 z-40` layer. Needs :8005 up: with it down the `[frame] … loaded under the panel` check fails. Exit 1 lists failures. Shots: `.verify/shots/chat-host-chrome-*`.
Covers, at 1440×900 and 390×844, light and dark: panel in each placement (docked, floating, above and below the FAB on the phone) with `placement` computed by `panelPlacement` from the real FAB's rect; header alone at 420px, at the 376px minimum, with a long name and with an empty slot; the panel at minimum size with the grip in each corner; placeholder in both readings in a tab-height box beside the slot's `hidden` home `div`; grip at rest, hovered and focused; `z-index` 45 against 40 and 60; a press at the panel's centre lands on the panel and one at the FAB on the FAB; a grip drag over the frame grows the panel with the frame inert; grip glyph ≥ 3:1 on the header and body grounds at rest and hovered; coarse pointer gives the 24px grip and no sticky hover; no console errors.
Measured 2026-09-29 on :5183: 168 of 168 checks pass, exit 0.

Open:
- `panelPlacement` knows nothing of the safe area: a tall panel in a standalone PWA reaches the status bar at its 8px top margin. The caller passes a viewport that already stands clear.
- `.verify/` is gitignored; force-add to commit.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/ChatHostHeader.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/ChatHostPanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/ChatHostPlaceholder.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-host-chrome.mjs

## MAN-7473 — Session picker — SidebarSessionPicker, its four parts, its groups and the fixture that photographs it

The floating chat's header switcher: a two-line trigger and a panel listing the sidebar's own conversations. SCAFFOLD: composed and photographed, reads nothing but its props, mounted by nothing — `grep -rn "SidebarSessionPicker" src | grep -v "^src/modules/sidebar/SidebarSessionPicker"` lists the barrel line in `src/modules/sidebar/index.ts` and comments only. The header slot it goes in (it must truncate itself): MAN-7467. Sidebar rows it copies: MAN-661, MAN-666.

## Files — `src/modules/sidebar/`

| file | what |
| --- | --- |
| `SidebarSessionPicker.tsx` | named export `SidebarSessionPicker(props)`, in the barrel. Props (file-local): `projects: Project[]`, `selectedProject: Project \| null`, `selectedSession: ProjectSession \| null`, `onProjectSelect(project)`, `onSessionSelect(session)`, `onNewChat()`. Today: `groupsFromProjects(projects, EMPTY_PICKER_MARKS, nameOf)`, status `'ready'`, `hasMore` false, the three handlers no-ops |
| `SidebarSessionPickerMenu.tsx` | default export, the view: `name`, `projectName`, `groups`, `status`, `currentSessionId`, `hasMore`, `onPick(row)`, `onNewChat`, `onLoadMore`. Draws trigger content, pinned New chat, states, groups, Show more |
| `SidebarSessionPickerPopover.tsx` | default export, the mechanics: `trigger`, `triggerTitle`, `label`, `pinned`, `children` |
| `SidebarSessionPickerRow.tsx` | default export, one conversation: `row`, `standalone`, `isCurrent`, `onPick` |
| `utils/sessionPickerGroups.ts` | `EMPTY_PICKER_MARKS`, `groupsFromProjects(projects, marks, nameOf)`, `groupsFromSimpleList(rows, marks)` |

Types in `src/shared/types.ts`, group `SIDEBAR`: `SessionPickerStatus` (`'ready' \| 'loading' \| 'error'`), `SessionPickerRow`, `SessionPickerGroup` (`key`, `heading: string \| null`, `rows`), `SessionPickerMarks` (`running`, `awaitingInput`, `subagentRunning`: `ReadonlySet<string>`).

## Groups

| shape | blocks | row |
| --- | --- | --- |
| simple list (`groupsFromSimpleList`) | one, key `simple-list`, `heading: null`, feed order kept | `standalone`: icon (`SimpleChatIconGlyph`), 13px title, 10px project line; `unread` from the feed |
| project tree (`groupsFromProjects`) | one per project in the order handed in, `key` = `projectId`, `heading` = `displayName \|\| projectId` | one line; `projectName`, `icon` null, `unread` false; sessions from `getAllSessions(project)`, newest first |

- A project with no sessions stays a block: `projects.noConversations` under its heading. why: a missing project reads as not there.
- Headings are `sticky top-0 bg-card`; New chat is pinned outside the scrolling list.
- `nameOf` is passed in; the file holds no copy of the naming rule.

## Panel rules

1. Portalled to `useHostWindow().document.body`, `fixed z-[70]`, `Card` with `OWNS_ESCAPE`; opens in the picture-in-picture window when the chat is there.
2. Width `min(360, viewport − 16)`, 8px window margin, 6px gap; opens below the trigger, above it when room below < 260px and less than above; `maxHeight = min(440, room)`; the list scrolls inside.
3. `role="group"` labelled `chatHost.pickerList`; the trigger has `aria-expanded` and `aria-controls`, no `aria-haspopup`. why not `menu`: it holds a status block, a paragraph and a banner in some states.
4. Items are marked `data-picker-item`: New chat, every row, Show more. Arrows, Home and End walk them (wrapping); a keyboard open (`event.detail === 0`) focuses the first; ArrowDown on the trigger enters a panel opened by a press; Tab closes and focuses the trigger.
5. A press on an item closes the panel and refocuses the trigger, unless the item carries `data-keeps-open` (Show more).
6. Escape: a WINDOW capture listener calls `preventDefault()` and closes. why: the chat stops a running turn on a document-capture Escape unless the event is already marked; window capture runs first.
7. Also closes on a `pointerdown` outside, on the host window's `blur` (a press inside the framed application, whose pointer this document never hears) and on `resize`.
8. Not the kit's `Menu` (single row shape, cannot scroll, hangs in place under the header slot's and the panel's `overflow-hidden`), `ActionMenu` or `Select` (each owns a one-line trigger). Precedent: `AccountPopover` (`Card` + portal). A second consumer should promote a kit `Popover` for both.

## Trigger and row rules

1. Trigger `h-9` (36px) inside the 40px header, with a transparent `before:` catch to 40px; name 13px, project 10px muted, both `truncate`; chevron `flex-shrink-0`. Hover title: `<name> — chatHost.pickerTitle`.
2. Row heights: 32px under a heading, 38px standalone, 44px under `(pointer: coarse)`; New chat 36px, 44px coarse.
3. The row is `<a href="/session/<id>">`: an unmodified primary press calls `preventDefault()` then `onPick`; a modified press opens a tab. Space also activates. `draggable={false}`.
4. Ink is pinned `hover:text-foreground focus-visible:text-foreground`. why: the global `a:hover` turns a link the accent green, the app's word for healthy.
5. Marks, in order: awaiting an answer (`bg-warn-ink` pulsing dot; hides running), running (spinner), subagents (purple dot), unread (`bg-primary` dot; hidden on the open row and on running or awaiting rows). Labels `simpleList.awaitingInput`, `.running`, `.subagentsRunning`, `.unread`.
6. The open conversation: `aria-current="true"`, `bg-primary/10`, `font-medium` and a `Check` tick, so it survives greyscale.
7. States, each with New chat still pinned: loading (three `vv-skeleton` rows in `role="status"`, `chatHost.pickerLoading`); error (`Banner tone="warn"`, `chatHost.pickerError`); no groups, or the simple list's one empty block (paragraph `chatHost.pickerEmpty`).
8. Show more (`simpleList.loadMore`, "Show more") draws only when `status === 'ready'`, the list is not empty and `hasMore`; it calls `onLoadMore` and keeps the panel open.
9. Selectors: `[data-picker-item]`, `role="group"`; `[role="menu"]` and `[role="menuitem"]` select nothing. Test ids: `session-picker-trigger`, `-panel`, `-new`, `-row` (with `data-session-id`), `-flat`, `-project`, `-project-empty`, `-empty`, `-load-more`.

## Seams — `grep -n "FILL:" src/modules/sidebar/SidebarSessionPicker.tsx` lists seven

| marker | fills with |
| --- | --- |
| `name` | `getSessionName` — a non-exported const in `utils/sidebarProjectFormatting.ts`; the scaffold reimplements it as `summary \|\| name \|\| t('projects.newSession')`. Export it and swap it in |
| `rows` | `useSimpleChatList` when `useSimpleChatListPreferences().enabled`, else `sortProjects(projects, order)` with `getAllSessions`; marks from `useBusySessionIdSet`, `useAwaitingInputSessionIdSet`, `useSubagentRunningSessionIdSet`. `useSimpleChatList` takes no `enabled` flag and fetches and subscribes on mount: a bare call in tree mode costs one page and one websocket subscription. Give it an `enabled` argument or read it where the preference is on. `groupsFromSimpleList` has no caller in `src/` until this fill |
| `status` | the simple list's `isLoading` → `'loading'`, `hasError` → `'error'`; the tree is always `'ready'` |
| `has-more` | the simple list's `hasMore`; false in the tree |
| `pick` | `onProjectSelect(project)`, then `onSessionSelect(session tagged with the project)` |
| `new-chat` | `onNewChat()` |
| `load-more` | the simple list's `loadMore()` |

## Words

- Five keys under `chatHost` in `src/modules/i18n/locales/<lang>/common.json`, all 11 locales: `pickerTitle`, `pickerList`, `pickerEmpty`, `pickerLoading`, `pickerError`.
- Reused from `sidebar.json`: `simpleList.newChat`, `.loadMore`, `.running`, `.awaitingInput`, `.subagentsRunning`, `.unread`; `projects.newSession`, `.noConversations`. `simpleList.awaitingInput` is in all 11 files.
- `recent.loadFailed` exists in English only: the error line is `chatHost.pickerError`, not that key.
- `python3 .verify/session-picker-words.py` exits 1 on a missing key or one left as the English sentence. 2026-09-29: `ALL 11 LOCALES CARRY 5 NEW KEYS AND 8 REUSED ONES`.

## Proof — `node .verify/session-picker-scaffold.mjs`

Needs :5183 (client) and :8005 (the framed application). `ONLY=1440-light` (`<width>-<theme>`) runs one combination. Exit 1 lists failures.
- Mounts the real components through `.verify/lib/mountReact.mjs` with fake props: in `ChatHostHeader` in a 420px column (the picture-in-picture width) and in the real `ChatHostPanel` beside the real FAB over an `:8005` iframe. 1440×900 and 390×844, light and dark; 390 runs with touch emulation (coarse pointer).
- The 420px column (outer-wiring proof, states, dense list) runs at 1440 only.
- Covers: the live tab carries no picker; trigger fit, 36px height, ellipsis; panel placement, z 70, `OWNS_ESCAPE`, 8px margins, 360px cap; New chat first; the open row's four signs; the four marks; row heights 32/38/44; heading and project-line ink ≥ 4.5:1; sticky heading and pinned New chat under scroll; the empty project scrolled into view; Escape (already marked at document capture), keyboard walk, outside press, blur, Show more keeps open, a pick, New chat; a press in the framed application closes the panel; no console errors.
- Shots `.verify/shots/session-picker-{panel,window}-<state>-<width>-<theme>.png`; `<state>`: `trigger-long`, `flat-open`, `projects-open`, `projects-empty-project`; window at 1440 only: `loading`, `error`, `empty`, `bare`, `new`, `noproject`, `dense-scrolled`.
- Measured 2026-09-29 on :5183: 278 checks pass, exit 0.
- `.verify/` is gitignored; force-add to commit.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSessionPickerMenu.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSessionPickerPopover.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSessionPickerRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSessionPicker.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/utils/sessionPickerGroups.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/session-picker-scaffold.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/session-picker-words.py
