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
group — `GET /api/claude-updates`, `POST /api/claude-updates/{check,apply,restart}`, `PUT /api/claude-updates/auto-install`.

| file | owns |
|---|---|
| `index.ts` | the module's whole export surface: `ClaudeUpdatesSettingsTab`, `ClaudeUpdateFooterRow`, `ClaudeUpdateRailButton` |
| `hooks/useClaudeUpdates.ts` | the client contract: `{ report, refresh, check, apply, restart, setAutoInstall }`; `isUpdateJobActive(job)` — true on `installing`/`installed`/`restarting`/`rolling-back`; `canPressRestart(job)` — true with no active job, or a job in `restarting` whose `restart` step is `pending`; and the one module-scope report with its poller |
| `ClaudeUpdatesSettingsTab.tsx` | Settings → Updates: title (drawn even before the first report, with the one Try again press), clock line + Check now, `AutoInstallRow` (left out when `report.autoInstall` is absent), one `PackageUpdateCard` per package, the actions row, `UpdateJobPanel`, the last press's refusal |
| `AutoInstallRow.tsx` | the automatic-install switch + its `Not installed yet — <waiting>` status line (MAN-7516); composes `SettingRow` + the library `Switch`, not `SettingsToggle` (the settings module already imports this tab) |
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
  offers no restart; it is disabled unless `canPressRestart(report.job)` (stricter than the route,
  which refuses only `installing`/`rolling-back` — MAN-7408 has the per-state reasons).
- The under-buttons sentence is drawn only while `versions.length > 0` (an offer exists); there is
  no fallback copy for "nothing on offer".
- The CLI card's mid-turn count is `useCliVersion().staleSessionIds.size` — this module never reads
  `/api/cli-version` itself (MAN-503).
- `en/settings.json` carries only `updates.autoInstall.{label,description,waiting}` (the auto-install
  row); every other string in this module ships its own English `defaultValue` (`updateWording.ts`'s
  own note) — do not add a parallel `updates` i18n block for them without moving them off
  `defaultValue` at the same time.

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
| word (`model`, `effort`, an `effort` map key, `deepseek_effort`, `dactyl_model`, `dactyl_effort`, `summarizer_model`, `summarizer_effort`) | `^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$`; a token fence, not the vocabulary — `-` first would read as a CLI flag; the dactyl's two and the summarizer's two have no `null` |
| unknown body key | 400 |
| `effort` map | at most 16 models (`EFFORT_MAP_MAX_ENTRIES`); more would overrun the OS argv limit; `{}` counts as no field |
| no field named | 400 "name at least one of …" (the defaults route's sentence lists all seven fields) |

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

`AgentLaunchDefaultsChange` = `{model?, effort?, deepseek_effort?, dactyl_model?, dactyl_effort?, summarizer_model?, summarizer_effort?}`; the argv flags are `--dactyl-model` / `--dactyl-effort` and `--summarizer-model` / `--summarizer-effort`.

The client mirror is `src/shared/agent-launch-types.ts`: the census key for key in the CLI's snake_case (`choices.dactyl_models`, `choices.summarizer_models`, `defaults.dactyl_model`, `defaults.dactyl_effort`, `defaults.summarizer_model`, `defaults.summarizer_effort` included), plus `AgentLaunchRowChange` and `AgentLaunchDefaultsChange`.

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
| Stubs | the WIP defaults answered `all` and `all` (the row's widest state, both steppers reading `All`); TaskMaster installed; two installed plugins (the box has none; one with a 52-character name) — each answered locally, and the walk presses the first card's uninstall to draw its confirm banner, then Cancel; the box's user-scope MCP list gets a long-URL server and a long-stdio server (long command, args, env, cwd) added (a GET, answered from the real reply); every non-GET to preferences and settings is answered locally |
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
- A transform scales a child's strokes and boxes with the picture, and `vector-effect: non-scaling-stroke` does not undo that (measured 2026-10-17: a 2px edge reads 4.5px at 225%). The content element therefore carries the zoom as the custom property `--lightbox-scale` (a bare number, 1 at fit; unset outside the Lightbox, so a reader writes `var(--lightbox-scale, 1)`). A child that wants marks at screen size divides by it: `RegionImage`'s outlines, dashes and badges do (`verve/media.css`), so a region's edge stays one weight at every zoom.
- The overlay swallows only its own close after a drag (`wasDrag`); a child's `onClick` runs first. A pan that starts and ends on one pressable child (a `RegionImage` outline given `onSelect`) still fires that child's click (read from `Lightbox.tsx` and `useZoomPan.ts`, 2026-10-17; not run). Give a child inside the Lightbox no handler its pan would trip.
- The viewer is a native modal `<dialog>`, portalled to the host window's `<body>` and opened by `showModal()` in a layout effect, in that document's TOP LAYER. No fixed layer (the PRD editor's `z-[200]`, Settings' `z-[9999]`, a later one) can cover it, and it carries no z-index. Anything that must sit above it has to be top-layer itself.
- `showModal()` makes the page inert, focuses the close button and keeps Tab inside. Focus returns to the opener on close. The dialog's `cancel` is prevented: Esc is heard from the host window's capture phase, so closing never stops a run.
- A `ResizeObserver` on the stage and the content re-clamps the pan on a window resize or a phone turning. It is built by the host window's constructor (`resizeObserverIn`, MAN-7451) and rebuilt on a move.
- A `ctrl`+wheel delta is capped at 25px per event: a Ctrl+mouse-wheel notch lands near a plain one (about 1.28× against 1.25×), not 2.7×. A pinch, many small deltas, is unaffected. The wheel's reading is `wheelZoomRatio` in `src/shared/utils.ts`, which the roadmap tree's zoom (MAN-7827) reads its `ctrl`+wheel through as well: one plain notch (deltaY −100) still gives 1.24608 here, then one `ctrl` notch 1.59999.
- `useZoomPan` hears moves and releases on the HOST window (`useHostWindow()`, MAN-7443), never through pointer capture: capture retargets the `click` that ends a press, and the overlay needs the click's real target to tell the backdrop from the content.
- Double-tap is two taps within 320ms and 32px; a touch screen sends no `dblclick`. The button step, the double-tap zoom, the tap slop and these two numbers are `ZOOM_*` in `src/shared/constants.ts`, shared with the roadmap tree's zoom.
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
| `projectChoices` | `ProjectChoice[]` | every project by name, gone-folder ones included (`isFolderMissing`); the new-chat picker leaves those out (MAN-8135) |
| `openProjectChat` | `(projectPath: string \| null, mode: 'latest' \| 'new') => boolean` | the one door into a project's conversation |

- `ProjectChoice` = `Pick<Project, 'projectId' \| 'displayName' \| 'fullPath' \| 'isFolderMissing'> & { nameHint: string \| null }` (`src/shared/types.ts`); memoised on a JSON key of `[projectId, displayName, fullPath, nameHint, isFolderMissing]` (`projectChoiceRows`), so a session upsert does not rebuild it. `nameHint` = `projectNameHints(state.projects)` over the whole list (MAN-8135).
- Separate from `ProjectMainContext` so a reader of only these two is not woken by a selection change or a `projects` rebuild.
- The value is memoised on the two fields and moves only when the choices do.
- `ProjectsStateContext.tsx` is 316 lines: the next reader hook added there needs an extraction first.
- Readers: `ProjectWorkspaceShell` (`projectChoices`, handed to `AppSwitcherProvider`), `useChatDoor` (`openProjectChat(app.project, 'latest')`, once per visit of an application) and `FloatingChatHeader` (`openProjectChat(app.project ?? null, 'new')`).

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

## `placeNode.ts` — `placeNode(node, parent)`: node becomes parent's last child, a focused text field keeps its focus and caret
| when | call | why |
|---|---|---|
| same `ownerDocument` AND same `getRootNode()` AND `'moveBefore' in parent` | `parent.moveBefore(node, null)` | iframes survive |
| any other | `parent.append(node)` | cross-document move (the picture-in-picture window) reloads frames whatever is used; `moveBefore` throws `HierarchyRequestError` on a detached node, which is how the chat's node is first placed |
Focus, by hand: `holdFocusedField(node)` reads `document.activeElement` BEFORE the move — when it stands inside `node` and has numeric `selectionStart`/`selectionEnd`, it keeps the field with its selection and direction. After either call `returnFocus`: skipped when the field is no longer connected; else `blur()`, `focus({ preventScroll: true })`, `setSelectionRange(start, end, direction)`. A focus on a button, link or checkbox (no selection) is not held. A field that throws on `selectionStart` is not held and logs `console.warn('[chat-host] a focused field has no selection to keep across the move', error)`. why: a bare `focus()` on a field that still reports focus does nothing.
Measured 2026-09-29: `'moveBefore' in Element.prototype` true. Chromium 145, bare page, no app code: `moveBefore` keeps `document.activeElement` and `:focus` on a moved textarea but resets its selection to 0, and the editor then ignores key input until the field is blurred and focused again; a plain `append` drops focus entirely. Into the frame's document: `append` once, `moveBefore` never.
`.verify/chat-host-pure-parts.mjs` holds `activeElement` after `placeNode`; `.verify/chat-floats-panel.mjs` (MAN-7478) holds that a key typed straight after a float and after a collapse lands.

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
| `Sheet` | `src/shared/ui/Sheet.tsx` | portal target `hostWindow.document.body`; Escape/Tab `keydown` on `hostWindow` capture; focus trap and `activeElement`; autofocus and focus-return frames (`hostWindow.requestAnimationFrame`); no body scroll lock |
| `Tooltip` | `src/shared/ui/Tooltip.tsx` | portal; show-delay timer; position frame; `resize`/`scroll`; outside-press on the host document |
| `ActionMenu` | `src/shared/ui/ActionMenu.tsx` | portal; viewport clamp reads `hostWindow.innerWidth`/`innerHeight`; `resize`/`scroll`; Escape and outside press on the host document |
| `Menu`, `Select` | `src/shared/ui/Menu.tsx`, `Select.tsx` | Escape and outside press on the host document; `Menu`'s touch wait for `pointerup`/`pointercancel` is dropped with its listeners in the effect's cleanup |
| `useEdgeShift` | `src/shared/ui/useEdgeShift.ts` | `hostWindow.innerWidth`; `resize` on `hostWindow` (`Menu`, in-place `ActionMenu`) |
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
- `Dialog` and `Sheet` bind Escape on the `hostWindow` capture phase, which runs before the chat's host-document capture listener (ChatInterface's Escape-stops-the-turn). why: closing either never also stops the run; it marks the event first.
- `Dialog` restores focus on close (the trigger, else the element focused at open) only when `hostWindow.document.activeElement` is `null` or the body. why: the palette's Chat row closes it and floats the chat, whose composer takes focus in a layout effect before the dialog's passive restore; restoring over that undoes it. 2026-09-30: after the palette's Chat row, `document.activeElement` is the composer `TEXTAREA`, was the palette trigger `BUTTON`. An ordinary close drops focus to the body and still restores.
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

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useDeviceSettings.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useElapsed.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/ActionMenu.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Dialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Lightbox.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Menu.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Select.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Sheet.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Tabs.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Tooltip.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/useZoomPan.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/utils.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/host-window-home.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/host-window-kit.mjs

## MAN-7452 — Chat state layer follows the host window

The chat's state hooks bind timers, frames, listeners and observers to `useHostWindow()` (MAN-7443, rules in MAN-7451) and keep the reader's place across a move between hosts. At home `hostWindow` is the page's own `window`: the chat stands inside `ChatHostSlot`'s `HostWindowProvider` (MAN-7464), whose value stays that `window` until a floating host moves the node.

## What binds to the host window

| unit | file | bound to `hostWindow` |
| --- | --- | --- |
| `ChatInterface` | `src/modules/chat/ChatInterface.tsx` | Escape-stops-the-turn `keydown`: document CAPTURE listener on `hostWindow.document`, still checks `defaultPrevented`; `hostWindow` in the effect's dependencies |
| `useChatSessionState` | `src/modules/chat/hooks/useChatSessionState.ts` | settle loop `requestAnimationFrame`/`cancelAnimationFrame` (`hostWindow` in the effect's dependencies); the landing pin's frames via `hostWindowRef` (`landAtMessageTop`); scroll restore via `useHostMoveScroll` |
| `useFollowGlide` | `src/modules/chat/hooks/useFollowGlide.ts` | glide frames (`requestAnimationFrame`, cancelled on `armedOn`, the window that issued them), the content-box `ResizeObserver` built by `hostWindow.ResizeObserver`, `matchMedia` for reduced motion, the `keydown` listener on `hostWindow.document`; the effect re-runs on a move (MAN-7574) |
| `useIsLookingAtSession` | `src/modules/chat/hooks/useSessionPresence.ts` | the host document's `visibilityState` and `visibilitychange`; re-read at once when `hostWindow` changes (MAN-7575) |
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

- Callers: the `becameLooking` branch of `useChatSessionState` (`anchor: null`: foot or top; MAN-385) and the move's `'after'`.
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
| `useChatSessionState` bare timers: the 8 s loading-wheel guard, the "Load all" hint pulses, the search-jump and landing retries, the 4 s highlight flash | each bounds a wait; the reader is not waiting on it |
| `useChatComposerState`'s 5 s draft poll | reconciles data |

## Probes

| command | proves |
| --- | --- |
| `node .verify/chat-window-bindings-home.mjs` | at home, real Haiku turns in a scratch chat on :5183 (800×240 window, so two short turns overflow the scroller): a turn streams and the transcript follows its foot with a glide (back inside the near-bottom band within 60 frames, the jump-to-bottom button never showing); Escape mid-stream stops the turn; a 400px-scrolled-up transcript is within 2px after a Files-tab trip, and at the foot it returns to the foot; a reply that arrives while the Files tab is shown lands the operator on the message they sent, within 24px of the scroller's top, the reply below the fold (MAN-7575). Expects exactly two console `404`s from `/token-usage` on a fresh chat (the server answers 404 with no transcript yet). Deletes its chat |
| `node .verify/chat-window-bindings-move.mjs` | the REAL hooks (served source) in a Chromium Document-PiP window under a `HostWindowProvider` driven like `moveTo` (emit `'before'`, place the node, set the host, emit `'after'`): scroll anchor within 2px in both directions while the scroll height changes ~40%, a follower lands on the foot, a control scroller with no hook drops 500 to 0; flush at `'before'` and cleared on the PiP; presence; observer rebuilt by the right constructor with all 60 rows answering. 2026-09-29: 33 of 33 pass |

- `PROBE_APP_URL` points the home probe at another client of the same API (a before-tree on its own port).
- Both exit 1 with the failed checks listed. The move probe sends no model turn and writes no app data.
- `.verify/lib/scratch-chat.mjs` is the shared helper for a probe that sends a real turn: `createScratchChat(session, projectPath?)` (default `PROBE_PROJECT`, `.verify/lib/probe-project.mjs`; a probe that needs a node-assigned project names a scratch project, and only `cerberus-eis-proof.mjs` may name the real `/opt/eis-app`, MAN-7924), `openScratchChatOnHaiku(session, id)` (opens `/session/<id>`, clicks the `Chat` tab when another workspace tab is selected, picks Haiku in the composer's `MODEL_CHIP`; throws if the chip does not read Haiku, so no turn is sent), `sendTurn(page, text)`, `deleteScratchChat(session, id)`; constants `MODEL_CHIP`, `SCROLLER`, `COMPOSER`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useChatRealtimeHandlers.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useHostMoveScroll.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useLazyRowObserver.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useSessionPresence.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/utils/streamFlushTimer.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-window-bindings-home.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-window-bindings-move.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/scratch-chat.mjs

## MAN-7464 — chat-host — the live chat's one node, its provider and its slot

`src/modules/chat-host/` owns the live chat's one DOM node and the door into it. Barrel exports four names: `ChatHostProvider`, `useChatHost`, `ChatHostSlot`, `ChatHostFloating`. Types `ChatPlacement`, `HostMove`, `HostWindowValue`, `PanelPlacement` live in `src/shared/types.ts`, group `CHAT HOST`. Pure parts: MAN-7446. The unread rule: MAN-7482. The floating host, its panel hook, the anchor store, the door and the hotkey: MAN-7478. Chrome (`ChatHostPanel`, `ChatHostHeader`, `ChatHostPlaceholder`; unexported): MAN-7467. Window binding: MAN-7443, MAN-7452. The picture-in-picture host: the chat-host window manual.

## Tree

`ProjectWorkspaceShell` → `ChatHostProvider` → `AppSwitcherProvider` → `WorkspaceFrame` (`src/modules/project-workspace/`; MAN-491). `WorkspaceMain` wraps `ChatInterface` in `ChatHostSlot`, inside `ChatGutterLayout`; `WorkspaceFrame` mounts `ChatHostFloating` before the FAB.

## Files

| file | what |
| --- | --- |
| `context/ChatHostContext.tsx` | `ChatHostProvider`; `useChatHost(): { placement: ChatPlacement, pipWindow: Window | null, unread: boolean, open, collapse, reportAnchor, reportCovered }`; `useChatHostMechanics(): { node, moveTo, subscribeMove, hostWindowValue, setHomeElement, publishFacts, comeHome, anchorStore }` — module-internal, not in the barrel. Both hooks throw outside the provider |
| `hooks/useUnreadReply.ts` | `useUnreadReply({ sessionId, onScreen }): boolean`, called by the provider — MAN-7482 |
| `ChatHostSlot.tsx` | `ChatHostSlot({ sessionId: string \| null, showing: boolean, children })` |
| `ChatHostFloating.tsx` | `ChatHostFloating({ header })` — MAN-7478 |
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
5. `ChatHostSlot` renders `div[data-chat-host-home].flex.min-h-0.flex-col` (registered with `setHomeElement`), `ChatHostPlaceholder` (`onBringBack={collapse}`) while the chat is away, and a portal into `node` of `HostWindowProvider value={hostWindowValue}` around the children. Away is `chatAway`, slot state written by the `'after'` of every move (`floating`) — not `placement !== 'home'`. The home is `h-full` while the chat is not away and `h-0 overflow-hidden` while it is — never `hidden`. why: `collapse` moves the node home while the placement still says it floats; a textarea in a `display: none` box cannot hold focus, so the composer lost its caret on the way home. `h-0` keeps the placeholder inside the tab's box and the home rendered. why `chatAway`: a window is placed when the browser hands it over but receives the chat only after its stylesheets load; squeezing the home at the placement left the chat in a zero-height box for that wait, the squeeze's scroll events marked the reader scrolled up, and the transcript did not follow the foot into the window (231px off it, measured).
6. `ChatHostSlot` layout effect 1: `placement === 'home'` and the div exists → `moveTo(home, false)`. Layout effect 2: `publishFacts({ sessionId, showing })`, no cleanup. Layout effect 3: cleanup only, `publishFacts(null)`, keyed on `publishFacts`. why: one effect's cleanup also runs on every `sessionId` change and would take a floating chat home at each conversation switch.
7. The node's first adoption at mount goes through `moveTo`: listeners hear one `'before'`/`'after'`. `'before'` sees a detached scroller, captures nothing; `'after'` restores from `fallback()` (`useHostMoveScroll`, MAN-373).
8. `placement` is state, written by `changePlacement` (which also writes `placementRef`, what a press reads before React has drawn). `open()` sets `'panel'` where the browser has no Document Picture-in-Picture API and requests a window where it has (the window manual); no-op while no slot is mounted (`mountedRef`). `comeHome()` runs `moveTo(home, false)` while the host is still mounted, clears `pipWindow` and sets `'home'` (only the state changes when no home is registered); `collapse()` runs it from the panel, closes an open window (whose `pagehide` runs it) and runs it itself for a window already `closed` (the window manual, rule 8). `publishFacts(null)` sets `'home'` (or closes the window). `'window'` is set when the window arrives. Never stored: every load opens home.
9. The home element and the mounted fact are refs in the provider; a change re-renders nothing. `comeHome` reads the home element and `open` reads the mounted fact. The slot's facts (`sessionId`, `showing`) are provider state (`facts`), and so is `covered` (written by `reportCovered`): the unread rule reads them (MAN-7482). A change re-renders the provider, not its `children` element.
9a. `anchorStore` (`createAnchorStore`, `utils/anchorStore.ts`, type `AnchorStore` in `src/shared/types.ts`) is created once in the provider; `reportAnchor` is its `set`. MAN-7478.
10. `useChatHost` readers: `ChatHostSlot`, `ChatHostFloating`, and outside the module `WorkspaceFrame` (`reportAnchor`, `reportCovered`, `pipWindow` for the hotkey), `WorkspaceMain` (`placement`) and `useChatDoor` (`placement`, `unread`, `open`, `collapse`).
11. Import edges: only `src/modules/project-workspace/` imports chat-host, through the barrel (`AppSwitcherFab` takes the anchor and the chat's door as props and imports nothing of chat-host); chat-host imports `src/shared` and itself. `grep -rn "@/modules/chat-host" src | grep -v "^src/modules/chat-host/"` lists the callers.
12. A second export is how a second caller starts moving the chat: keep the mechanics hook, `moveTo` and `node` inside the module.

## Probe — `node .verify/chat-host-provider.mjs`

Mounts the real provider, slot and floating host through `lib/mountReact.mjs` on :5183 with a fixture that changes the slot's `sessionId` and unmounts and remounts it, under the app's own `AuthProvider` and `WebSocketProvider` (the unread rule subscribes to the socket). No FAB is mounted. The Document PiP API is set aside for the panel legs and put back for the window legs. Exit 1 lists failures. Covers: `open()` with no chat mounted does nothing; `open()` floats the node and its textarea into the panel body; a `sessionId` change keeps the chat floating; the slot unmounting takes it home; the slot remounting adopts the node at home, same textarea; `collapse()` brings the node home before the panel goes; with no FAB reporting, the panel stands at the kit's resting corner. Window legs (a trusted `F9` press is the fixture's door; `requestWindow`'s arrival can be held back): a press opens a window with `pipWindow` set, the node in it and the header on it; `collapse()` closes it and the `pagehide` brings the node home; a second press while it is opening makes no second request; a `collapse()` that arrives while it is opening closes it on arrival; the slot unmounting closes an open window and one still opening. The floating run: MAN-7478.

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

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/ChatHostSlot.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/context/ChatHostContext.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-host-home.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-host-provider.mjs

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

Three presentational components in `src/modules/chat-host/`: the floating chat's frame, its top row, and the tab's stand-in while the chat floats. Props only: none reads `useChatHost`, none is in the barrel (MAN-7464); `grep -rln "chat-host/ChatHost\(Panel\|Header\|Placeholder\)" src | grep -v "^src/modules/chat-host/"` prints nothing. `ChatHostFloating` mounts `ChatHostPanel` and `ChatHostHeader` (MAN-7478); `ChatHostSlot` mounts `ChatHostPlaceholder` (MAN-7464). Geometry: MAN-7446. Kit grip: MAN-490.

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
4. Hand-off to whoever renders it beside `ChatHostSlot`: the slot's home `div` must give up its height whenever `placement !== 'home'`. Otherwise the placeholder lands entirely below the tab's box (top 900 in a 900px tab, button at y 1378) and the tab's `overflow-hidden` clips it: an empty tab with nothing to press. `ChatHostSlot` does so with `h-0 overflow-hidden`, rendered and never `hidden` (MAN-7464 rule 5), and passes `onBringBack={collapse}`.

## Words

Eight keys under `chatHost` in `src/modules/i18n/locales/<lang>/common.json`, all 11 locales: `panelLabel`, `collapse`, `resize`, `panelTitle`, `panelMessage`, `windowTitle`, `windowMessage`, `bringBack`. `panelMessage` (en): "It's open over your work." — it names neither the button nor a side, because a phone stands the panel above or below the FAB.

## Proof — `node .verify/chat-host-chrome.mjs`

Mounts the three real components over the running :5183 page (`.verify/lib/mountReact.mjs`) with fake props; the framed application is a fixed iframe of `http://127.0.0.1:8005/` in the main region's `absolute inset-0 z-40` layer. Needs :8005 up: with it down the `[frame] … loaded under the panel` check fails. Exit 1 lists failures. Shots: `.verify/shots/chat-host-chrome-*`.
Covers, at 1440×900 and 390×844, light and dark: panel in each placement (docked, floating, above and below the FAB on the phone) with `placement` computed by `panelPlacement` from the real FAB's rect; header alone at 420px, at the 376px minimum, with a long name and with an empty slot; the panel at minimum size with the grip in each corner; placeholder in both readings in a tab-height box beside a `hidden` stand-in for the slot's home (`data-fixture-slot-home`; the real home is `h-0 overflow-hidden`, and both take no height); grip at rest, hovered and focused; `z-index` 45 against 40 and 60; a press at the panel's centre lands on the panel and one at the FAB on the FAB; a grip drag over the frame grows the panel with the frame inert; grip glyph ≥ 3:1 on the header and body grounds at rest and hovered; coarse pointer gives the 24px grip and no sticky hover; no console errors.
Measured 2026-09-29 on :5183: 168 of 168 checks pass, exit 0.

Open:
- `panelPlacement` knows nothing of the safe area: a tall panel in a standalone PWA reaches the status bar at its 8px top margin. The caller passes a viewport that already stands clear.
- `.verify/` is gitignored; force-add to commit.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/ChatHostHeader.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/ChatHostPanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/ChatHostPlaceholder.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-host-chrome.mjs

## MAN-7473 — Session picker — SidebarSessionPicker, useSessionPicker, FloatingChatHeader, its parts, groups, data and words

The floating chat's header switcher: a two-line trigger and a panel listing the sidebar's own conversations. Panel, trigger and row rules: MAN-7484. Proofs: MAN-7485. Mounted in the floating chat's header by `FloatingChatHeader` (`src/modules/project-workspace/FloatingChatHeader.tsx`); the live tab at home carries no picker. The header slot it fills (it must truncate itself): MAN-7467. The floating host that draws the header: MAN-7478. Sidebar rows it copies: MAN-661, MAN-666.

## Files — `src/modules/sidebar/`

| file | what |
| --- | --- |
| `src/modules/project-workspace/FloatingChatHeader.tsx` | default export `FloatingChatHeader()`, no props. `WorkspaceFrame` mounts it as `<ChatHostFloating header={<FloatingChatHeader />} />`. Reads `useProjectSidebarState().sidebarSharedProps`, `useProjectChatState().openProjectChat`, `useCurrentApplication()`; passes the five picker members by name, never `{...sidebarSharedProps}`. `onNewChat` = `openProjectChat(currentApplication?.app.project ?? null, 'new')`: the framed application's project, else the project the chat is already in. why the read lives here: `sidebarSharedProps` is rebuilt on every session upsert, and every reader wakes on each; WorkspaceFrame, the shell and the door never subscribe to it |
| `SidebarSessionPicker.tsx` | named export `SidebarSessionPicker(props)`, in the barrel. Props (file-local): `projects: Project[]`, `selectedProject: Project \| null`, `selectedSession: ProjectSession \| null`, `onProjectSelect(project)`, `onSessionSelect(session)`, `onNewChat()`. `nameOf` = `getSessionName(session, t)`; the trigger name is `nameOf(selectedSession)`, else `projects.newSession`; the project line is `displayName \|\| projectId`. Calls `useSessionPicker` and hands `onNewChat` straight through |
| `hooks/useSessionPicker.ts` | named export `useSessionPicker({ projects, selectedSessionId, nameOf, onProjectSelect, onSessionSelect })` → `{ groups, status, hasMore, loadMore, pick }`. `SidebarSessionPicker` is its one caller. Rules: §"Data — `useSessionPicker`" |
| `SidebarSessionPickerMenu.tsx` | default export, the view: `name`, `projectName`, `groups`, `status`, `currentSessionId`, `hasMore`, `onPick(row)`, `onNewChat`, `onLoadMore`. Draws trigger content, pinned New chat, states, groups, Show more |
| `SidebarSessionPickerPopover.tsx` | default export, the mechanics: `trigger`, `triggerTitle`, `label`, `pinned`, `children` |
| `SidebarSessionPickerRow.tsx` | default export, one conversation: `row`, `standalone`, `isCurrent`, `onPick` |
| `utils/sessionPickerGroups.ts` | `groupsFromProjects(projects, marks, nameOf)`, `groupsFromSimpleList(rows, marks, projectNameHints)` |
| `utils/projectStarOverrides.ts` | the reader's toggled stars, shared with the sidebar controller: `useProjectStarOverrides()`, `withResolvedStarState(projects, overrides)` (MAN-7507) |
| `utils/sidebarProjectFormatting.ts` | exports `getSessionName(session: ProjectSession, t)`: summary, else name, else `projects.newSession`; `sortProjects(projects, order)` |

Types in `src/shared/types.ts`, group `SIDEBAR`: `SessionPickerStatus` (`'ready' \| 'loading' \| 'error'`), `SessionPickerRow`, `SessionPickerGroup` (`key`, `heading: string \| null`, `rows`), `SessionPickerMarks` (`running`, `awaitingInput`, `subagentRunning`: `ReadonlySet<string>`).

## Groups

| shape | blocks | row |
| --- | --- | --- |
| simple list (`groupsFromSimpleList`) | one, key `simple-list`, `heading: null`, feed order kept | `standalone`: icon (`SimpleChatIconGlyph`), 13px title, 10px project line, then `· <projectNameHint>` when the project's name is shared (MAN-8135); `unread` from the feed |
| project tree (`groupsFromProjects`) | one per project in the order handed in, `key` = `projectId`, `heading` = `displayName \|\| projectId` | one line; `projectName` and `projectNameHint` null, `icon` null, `unread` false; sessions from `getAllSessions(project)`, newest first |

- A project with no sessions stays a block: `projects.noConversations` under its heading. why: a missing project reads as not there.
- Headings are `sticky top-0 bg-card`; New chat is pinned outside the scrolling list.
- `nameOf` and `projectNameHints` are passed in; the file holds no copy of either rule.

## Data — `useSessionPicker`

| when | do |
| --- | --- |
| `useSimpleChatListPreferences().enabled` | groups = `groupsFromSimpleList(list.rows, marks, projectHints)`; `projectHints` = `projectNameHints(projects)` over the whole `projects` list; `list` = `useSimpleChatList(selectedSessionId, enabled)`, whose `rows` is `flattenChats(items)` — every chat of the feed's tree, a folder's chats in its place (MAN-7524) |
| preference off | groups = `groupsFromProjects(sortProjects(withResolvedStarState(projects, starOverrides), sortOrder), marks, nameOf)`; `starOverrides` = `useProjectStarOverrides()`; `sortOrder` = `useSyncExternalStore(subscribeToUserPreferences, readProjectSortOrder)`, so it follows the preference live |
| marks | `useBusySessionIdSet`, `useAwaitingInputSessionIdSet`, `useSubagentRunningSessionIdSet` |
| `status` | simple list with no rows: `list.hasError` → `'error'`, else `list.isLoading` → `'loading'`; otherwise `'ready'`, always `'ready'` in the tree. why: `reload` sets `isLoading` on every `session_upserted` and `simple_list_changed`; mapping it straight would blank the drawn list for a skeleton each time |
| `hasMore` | `enabled && list.hasMore`; false in the tree |
| `loadMore` | `list.loadMore()` in the simple list; no-op in the tree |
| `pick(row)`, project found by `row.projectId` | `onProjectSelect(project)`, then `onSessionSelect({ ...session, __projectId: project.projectId })` |
| `pick(row)`, project not found | `onSessionSelect({ ...session, __projectId: row.projectId ?? '' })` |
| `session` in `pick`, simple list | built from the row: `id`, `summary: row.title`, `__provider`, `__projectId`. Same as `SidebarSimpleList` `handleRowSelect`; a bare id would title the workspace "New Session" |
| `session` in `pick`, tree | the project's own loaded session from `getAllSessions(project)`, else the row-built one |

- `useSimpleChatList(selectedSessionId, enabled = true)`: `enabled` false = no fetch, no subscription, no reload. Tree mode pays nothing for the picker's instance; the sidebar's own call takes the default.
- Star: a star toggled in the sidebar reorders the picker's tree at once — both read the one override map (MAN-7507). `toggle-star` broadcasts nothing, so `projects[].isStarred` alone would lag until a full refresh.
- Archive: the picker's feed is its own `useSimpleChatList` instance. `removeLocal` on any instance drops the row from every mounted one (module-level `removalListeners`), so an archive or delete in the sidebar leaves the picker at once. An instance that never paged the row in keeps its total. The server broadcasts nothing for an archive or a delete.

## Words

- Five keys under `chatHost` in `src/modules/i18n/locales/<lang>/common.json`, all 11 locales: `pickerTitle`, `pickerList`, `pickerEmpty`, `pickerLoading`, `pickerError`.
- Reused from `sidebar.json`: `simpleList.newChat`, `.loadMore`, `.running`, `.awaitingInput`, `.subagentsRunning`, `.unread`; `projects.newSession`, `.noConversations`. `simpleList.awaitingInput` is in all 11 files.
- `recent.loadFailed` exists in English only: the error line is `chatHost.pickerError`, not that key.
- `python3 .verify/session-picker-words.py` exits 1 on a missing key or one left as the English sentence. 2026-09-29: `ALL 11 LOCALES CARRY 5 NEW KEYS AND 8 REUSED ONES`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/FloatingChatHeader.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/hooks/useSessionPicker.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSessionPicker.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/utils/sessionPickerGroups.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/session-picker-words.py

## MAN-7475 — app-switcher radial — AppSwitcherRadial, radialLabels and the fixture that photographs them

The switcher's radial: the acts that can run drawn on an arc around the FAB, each a disc the size of the FAB with an icon and a label pill, and the plan that puts each label on a side of its disc. Nothing up: Chat and Applications, two items together beside the FAB. An application up: all five. An act whose `disabled` is true is not drawn. A FAB tap opens it; a press on an item runs its act and closes it. Arc geometry (`radialLayout`): MAN-491. The FAB's press, drag and dot: MAN-486. The unread rule behind the dot: MAN-7464. The proof that presses the live FAB: MAN-7481.

## Files

| file | what |
| --- | --- |
| `AppSwitcherRadial.tsx` | `AppSwitcherRadial({ open, acts: SwitcherAction[], points: {x,y}[], origin: {x,y} | null, onClose, openedByKeyboard?: boolean })` — `acts` is what to draw (no `disabled` act); `points[i]` is the centre of `acts[i]`; an act with no point draws nothing; `origin` is the FAB's centre, which the label plan reads. `openedByKeyboard` (default false): the first item takes focus in the commit that opens it |
| `utils/radialLabels.ts` | `estimateLabelWidth(label, shortcut, textClip = Infinity)`, `planRadialLabels(points, labels, viewport, centre)` → `RadialLabelPlan` (`{ sides, textClip }`), `labelTranslate(side, point)`, type `RadialLabelSide` (`right` \| `left` \| `above` \| `below`) |
| `AppSwitcherFab.tsx` | mounts the radial as a sibling of `DockableFab`, never its parent: the FAB is one node for life, and a radial inside it would unmount it and the drag's pointer capture. Owns `radialOpenedBy: 'pointer' \| 'keyboard' \| null` (the input that opened it), `acts = useSwitcherActions(chatDoor)` less its `disabled` acts, `drawnActs` (those acts as last drawn while open; the close fades from them, so Close app, which takes the application down in the press that closes the radial, leaves the fading arc as it was), `points = radialLayout(fabRect, viewport, drawn count)` and `origin` from the rect the kit reports, and `open = radialOpenedBy !== null && !chatDoor.floating` |

## Open and close

1. `DockableFab` `onPress({ keyboard })`: chat floating → `chatDoor.collapse()`, no radial; else the press toggles `radialOpenedBy` (`'keyboard'` when `keyboard`, else `'pointer'`). The FAB's `active` (`aria-expanded`) is on while the radial or the drawer is up.
2. The radial closes on: a second FAB press; `onDragStart`; the chat starting to float; Escape; a `pointerdown` outside the shell and the FAB; focus moving into an application's frame; Tab; an item's press.
3. The chat starting to float is dropped in the render that finds `chatDoor.floating` (`setRadialOpenedBy(null)` during render), so no frame draws both. why: the radial would go on offering Chat for a chat already out.
4. Escape: window capture listener, `preventDefault()`, `OWNS_ESCAPE` spread while open, focus back to the FAB. why: ChatInterface's Escape stops a running turn and reads `defaultPrevented`; a running turn survives it.
5. A `pointerdown` on the FAB is excluded from the outside press. why: the FAB's own press toggles; closing on the pointerdown lets the click reopen it. The radial finds the FAB with `FAB_SELECTOR = '.vv-fab'` (React 18 has no ref-as-prop; there is one FAB).
6. Focus into a frame: window `blur` with `document.activeElement.tagName === 'IFRAME'`. why: a cross-origin frame never sends this page a `pointerdown`.
7. Item `onClick`: `if (!open) return;`, then `act.run()`, `onClose()`; a keyboard click (`event.detail === 0`) gives the FAB its focus back. why `!open`: items stay hit-testable through the close fade (`visibility` waits `FADE_MS`), and a second click ran Reload and Open in a new tab twice. why FAB focus: the item is about to hide, and the drawer's close restores focus to what held it when it opened.
8. Keyboard: items found with `querySelectorAll('[role="menuitem"]')` on the container ref, no per-item refs. ArrowDown/ArrowRight forward, ArrowUp/ArrowLeft back, over the drawn items, wrapping; from focus off an item, forward starts at the first and back at the last. Enter and Space are the focused item's click; a repeat of either (`event.repeat`) is ignored. why: a held Enter on the first item toggled Chat over and over.

## `AppSwitcherRadial` rules

1. Shell: `div[data-app-switcher-radial=open|closed]`, `pointer-events-none fixed inset-0 z-[60]`. Items are `pointer-events-auto`, so the FAB, the chat panel and the application stay pressable between them.
2. `z-[60]` is the FAB's own level, later in the tree: over the application layer (40) and the floating chat's panel (45); dialogs and menus portal above it. Seventh neighbour in the note above `.vv-fab` in `src/shared/ui/verve/surfaces.css`.
3. Shell is ALWAYS mounted, so the close can animate. `role="menu"` and `aria-label` = `applications.radialLabel` are spread only while `open`; closed it carries `aria-hidden` and no role, name or Escape claim. `OWNS_ESCAPE` spreads the same way. why: a claim on Escape is honest only while the radial is up. Never mount and unmount the radial.
4. Item: `button[role="menuitem"][data-act=<key>]`, `tabIndex={-1}` (one Tab stop for the FAB, arrows inside the radial), class `vv-fab-disc` (surfaces.css): `--vv-fab-size` square, glyph `--vv-fab-glyph`, a 44px round `::before` catch like the FAB's (`--vv-fab-catch`); JS twins `FAB_SIZE_PX`, `FAB_CATCH_PX` in `shared/constants.ts`. Centred on its point. `aria-keyshortcuts` from `act.shortcut` (`Ctrl+` → `Control+`, `⌘` → `Meta+`).
5. No greyed look: a `disabled` act is not handed to the radial, so there is no `aria-disabled`, dashed ring or `cursor-not-allowed`; the palette (MAN-7483) still greys it.
6. Enabled acts are surface discs; `chat` (not disabled) is the one accent disc.
7. Label: `span[data-radial-label=<side>]` INSIDE the button, so a press on either is the item's press and the item's name is the label. An opaque pill on the card ground (the radial floats over an application of any colour). The shortcut is a `kbd[aria-hidden]` chip after the word; `[@media(pointer:coarse)]:hidden`, and dropped from the plan when `(pointer: coarse)` matches.
8. Motion: while `open`, item `i` waits `i × 35ms` (`BLOOM_STAGGER_MS`) to fade and grow, over `FADE_MS` 200ms; press (`transform`) and hover (`background-color`) take `FEEDBACK_MS` 150ms with no wait. `visibility` is on its own clock: flips at once on open, waits `FADE_MS` on close. why: a delayed `visibility` would hold the first item unfocusable until its stagger ran. `motion-reduce:transition-none` clears every transition.

## Label plan — `planRadialLabels`

1. `centre` (the FAB's centre, from the caller) is the arc's centre: "outward" is away from it and the labels keep clear of its 44px catch. No points → no sides.
2. Side order per item: outward on the axis it leans along most, then the other axis (its own direction, then opposite), then the far side of the first axis.
3. Search: depth-first over the sides, cost = area a label (plus `LABEL_CLEARANCE_PX` 4px) covers of any disc (its own too), the FAB's 44px catch and the labels already placed; stops at the first plan that covers nothing, else the least-covering stands.
4. Widths are estimated, not measured: Latin 6.4px a character, CJK / Hangul / fullwidth 12px, +18px padding; the chip adds `chars × 6.4 + 18`. `LABEL_HEIGHT_PX` 24, `LABEL_GAP_PX` 6, `LABEL_EDGE_PX` 8.
5. Whole words first; then `CLIPPED_TEXT_STEPS_PX = [64, 48]` in order. Stops at cost 0. A cut is kept only if it covers STRICTLY less than the plan before it. A cut word is `truncate` with `maxWidth: textClip`; the chip is never cut and the button's name stays the whole word.
6. `labelTranslate` returns a CSS `transform` whose `clamp()` holds the pill `LABEL_EDGE_PX` inside the viewport walls; no measurement, no resize listener.

## Words

Keys under `applications` in `src/modules/i18n/locales/<lang>/common.json`, all 11 locales: `actChat`, `actCollapseChat`, `actApplications`, `actReload`, `actClose`, `actOpenInTab` (the act labels; en: Chat, Collapse chat, Apps, Reload app, Close app, Open in tab), `fabLabelMenu`, `fabLabelCollapse`, `radialLabel` (en: Quick actions), `fabUnread`. The FAB's label is `fabLabelCollapse` while the chat floats, else `fabLabelMenu`; while the dot shows, `<label> — <fabUnread>`. The label is the tooltip.

## Proof — `node .verify/radial-fab-chrome.mjs`

Mounts the real `AppSwitcherRadial` and the kit `DockableFab` over the running :5183 page (`.verify/lib/mountReact.mjs`); `points` = `radialLayout` of the real FAB's rect for the drawn count, `acts` = `useSwitcherActions` inside the real `AppSwitcherProvider` less the `disabled` ones (nothing up: two drawn; "an application up" = `disabled` cleared: five). Iframe of `http://127.0.0.1:8005/` at z-40, stand-in chat panel at z-45. Needs :5183 and :8005. Shots: `.verify/shots/radial-fab-*`.
Covers, at 1440×900 and 390×844, light and dark, in each stance, nothing up and application up: every disc's box equals the FAB's box, keeps its 44px catch and 12px glyph; no `aria-disabled` inside the radial; no overlap of discs, labels, the FAB's catch or the viewport edge; discs on `radialLayout`'s points; hit tests through the layers, and 20px outward of each disc; label ≥ 4.5:1, icon ≥ 3:1; the arrow run covers exactly the drawn items; focus ring; first frame of an open; reduced motion; closed shell exposes nothing; a grid of stand-in FAB positions (walls and corners at the FAB's own extremes) for two items, five items and German words (light only); the dot; the live FAB's press. `fab-radial-door.mjs` (MAN-7481) covers the real FAB, including the close fade.
Open:
- Docked top-left with five items the corner arc reaches about 167px; open arcs reach 100px, two items always 100px. About 4% of the phone's FAB positions cut a word short. Narrower phones, five items near the screen's centre: INV-6057.
- `.verify/` is gitignored; force-add to commit.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/app-switcher/AppSwitcherFab.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/app-switcher/AppSwitcherRadial.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/app-switcher/utils/radialLabels.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/radial-fab-chrome.mjs

## MAN-7478 — chat-host floating — ChatHostFloating, useFloatingPanel, the anchor store, useChatDoor, useChatHotkey and the proof that floats the chat

The floating chat: `ChatHostFloating` draws the in-page panel beside the FAB (or the picture-in-picture window's header, the window manual), `useFloatingPanel` decides where it stands and how big it is, an external anchor store carries the FAB's rect to it, and `useChatDoor` + `useChatHotkey` press it from anywhere. Provider, slot, placement writers: MAN-7464. Geometry, size storage, `placeNode`: MAN-7446. Frame, header, placeholder: MAN-7467. FAB and switcher: MAN-491. The door's routing proof: MAN-7486.

## Files

| file | what |
| --- | --- |
| `src/modules/chat-host/ChatHostFloating.tsx` | `ChatHostFloating({ header: ReactNode })` in the barrel; reads `placement` and `pipWindow` only, renders the file-private `FloatingPanel` while `'panel'`, `ChatHostWindow` while `'window'` with a window open, else `null`. `FloatingPanel` draws `ChatHostPanel` with `ChatHostHeader header={header} onCollapse={collapse}`. `WorkspaceFrame` mounts it before the FAB with `header={<FloatingChatHeader />}` (MAN-7473) |
| `src/modules/chat-host/hooks/useFloatingPanel.ts` | `useFloatingPanel(): { placement: PanelPlacement, bodyRef, onResize, onResizeEnd }` |
| `src/modules/chat-host/hooks/usePanelViewport.ts` | `usePanelViewport(): { width, height }` |
| `src/modules/chat-host/utils/anchorStore.ts` | `createAnchorStore(): AnchorStore` |
| `src/modules/project-workspace/hooks/useChatDoor.ts` | `useChatDoor(): ChatDoor` |
| `src/modules/project-workspace/hooks/useChatHotkey.ts` | `useChatHotkey(toggle: () => void, pipWindow: Window \| null): void` |

## Rules

1. Reads are split by cost. `ChatHostFloating` reads `placement`; only `FloatingPanel` reads the anchor, the viewport and the size. A FAB drag reports the rect many times a second and re-renders the panel alone: never the workspace, and at home nothing is subscribed.
2. Anchor store: `subscribe`, `getSnapshot(): DOMRect | null`, `set(rect | null)`. `set` with an unchanged rect (left, top, width, height equal; `null` equal `null`) keeps the old object and notifies nobody. Listeners are iterated from a copy. The provider creates one (`useState(createAnchorStore)`); `reportAnchor` is its `set`; the panel reads it with `useSyncExternalStore`.
3. `AppSwitcherFab({ chatDoor, onAnchorChange })` passes the kit's `onRectChange` on and reports `null` when it unmounts, through a latest-callback ref (`anchorListener`). why: the kit re-reports only when a placement input changes, so an effect keyed on the callback would clear the anchor on every new function and never restore it. `WorkspaceFrame` hands it `reportAnchor` and `chatDoor={door}`; the switcher imports nothing of chat-host.
4. No rect reported: `restingAnchor(viewport)`, a 28px rect 16px from the right and 56px from the bottom (the kit's `RESTING_CORNER` in `DockableFab`). A reported rect is lifted by `anchorInsideViewport`: `top = min(top, max(viewport.height − rect.height − 8, 8))`. why: the FAB is `position: fixed` against the layout viewport, which a keyboard leaves alone, so a panel above it would sit under the keys. Built field by field: a `DOMRect`'s fields are getters a spread does not copy.
5. Viewport: `innerWidth` by `innerHeight − --keyboard-height` (the variable `useVisualViewportKeyboardOffset` writes on the root; unset or NaN counts 0). Re-read on window `resize` and `visualViewport` `resize`. An unchanged reading keeps the old object.
6. Size: `chosenSize` state, seeded `readPanelSize() ?? defaultPanelSize(viewport)`. Drawn size = `clampPanelSize(chosenSize, viewport)` on every render, `placement = panelPlacement(anchorRect, size, viewport)`. A window shrunk under the panel shrinks it; grown again, the chosen size returns.
7. Resize: `resizeBaseRef` holds the size DRAWN at the first delta of a gesture, never `chosenSize`. Grip on the left: width grows as `dx` goes negative; grip on the top: height grows as `dy` goes negative. The result goes through `panelPlacement`; the size that comes out is kept (`setChosenSize`) and written by `writePanelSize` once, at release, then the base clears. why: beside the FAB the panel draws narrower than asked; a base of the asked size makes the grip lag the pointer and stores a size the reader never saw.
8. Body adoption: layout effect `moveTo(bodyRef.current, true)`, keyed on `moveTo`, no cleanup. `collapse` carries the node home while the panel is still mounted; a slot that unmounts takes the placement home and the node leaves with the panel (MAN-7464).
9. The door: `ChatDoor { floating, unread, toggle, collapse }`, `floating = placement !== 'home'`, `unread` from `useChatHost()` (MAN-7482). `toggle` and `collapse` keep one identity for the host's life; `toggle` reads which way a press goes, and the application in front (`useCurrentApplication()`), from refs written in a layout effect after every commit. Floating: `collapse()`. Otherwise `open()` FIRST and synchronously (the window's request spends the press's activation), then, when the application in front names a `project` (`AppEntry.project`) and is not the one the chat was last routed for, `openProjectChat(app.project, 'latest')` and the application's id goes into `routedApplicationIdRef`. So the door routes ONCE PER VISIT: an effect on the current application forgets the id whenever no application is up (Close, then frame again, is a new visit). Whether the workspace is already on that project is `openProjectChat`'s own rule, so an older conversation of the same repository is never swapped for its newest. Only the door object is new when `floating` or `unread` flips. `AppSwitcherFab` reads `floating`, `unread` and `collapse` and hands the door to `useSwitcherActions` (MAN-491, MAN-7475).
10. The hotkey: `keydown`, capture phase, on `window` and on `pipWindow` while one is open (the effect is keyed on it). Chord = Ctrl or ⌘, plus `CHAT_TOGGLE_KEY` (`'.'`, `src/shared/constants.ts`); Alt refused (AltGr reports Ctrl+Alt); `event.repeat` refused. `preventDefault()` then `toggle()` in the same keydown; `toggle` is read through a ref. Focus inside a cross-origin framed application: the keydown goes to the frame, never reaches `window`, and Ctrl+. does nothing; float from the FAB.
11. `WorkspaceMain` reads `floating = placement !== 'home'`: `ChatGutterLayout enabled={!isMobile && !floating}`, `ChatInterface isActive={activeTab === 'chat' || floating}`.
12. `ChatGutterLayout`'s region observer ignores a measured width of 0 only while `enabled` (`if (width === 0 && enabled) return`). A hidden chat tab measures 0 and must not tear the gutters down; a region its owner switched off (the chat floats) is off whatever it measures. why: a stale "wide" would leave the columns standing, and their claim on the pinned subagent strip with them, so the floating chat drew no strip. Gutters need a region of `MIN_REGION_PX` (`ChatGutterLayout.tsx`).
13. While the chat is away (the node has left the home; MAN-7464 rule 5) the slot's home is `h-0 overflow-hidden` beside the placeholder and `placeNode` returns a focused composer its focus and caret after each move (MAN-7446).

## Proof — `node .verify/chat-floats-panel.mjs`

Playwright on :5183 (`lib/console.mjs`), a scratch chat and a second one in `lib/probe-project.mjs`'s project under /tmp, 1440×900, FAB docked, Haiku picked in the composer's model chip, both chats deleted at the end. 31 `check` calls; exit 1 lists failures; shots `.verify/artifacts/chat-floats-panel-*.png`. Covers:

| leg | holds |
| --- | --- |
| float | Ctrl+. floats the chat 12px off the FAB, 420 wide, inside the viewport; transcript at its foot; `activeElement` is the same textarea; a key typed straight after lands (`'k'`) |
| placeholder | in the chat tab while floating, the home `getComputedStyle(...).display !== 'none'` at height 0; Bring it back collapses |
| turns and draft | a Haiku turn sent from the panel streams into it; a draft typed there survives collapse; a key typed straight after collapse lands at the end of the draft; a mid-transcript scroll offset survives float and collapse |
| framed app | the panel floats over EIS App and is the topmost thing at its centre |
| FAB drag | dragging the FAB 300px moves the panel with it, live and after the drop, still 12px off |
| grip resize | resizes across the framed application with the frames inert; `localStorage['chat-host']` holds the size; same after a reload and a new float |
| conversation change | while floating, the chat stays in the panel, same textarea |
| gutters | at 1600px with the sidebar collapsed: drawn at home, stand down while floating, return on collapse |
| phone | 390×844: panel 374 wide, 8px margins, above the FAB |

Measured 2026-09-30 on :5183: 31 of 31 checks pass, exit 0; against the `h-0` home, float then collapse restored a scroll offset of 747 before and after, the display check and the two keys-that-land checks held, and the grip resize across the frame, the drag and the reload each held. The drawer is reached through `lib/switcher.mjs` (MAN-7481).
`chat-floats-panel.mjs` deletes `documentPictureInPicture` from every page with an init script: where the API exists the press floats a window (the window manual, `chat-floats-window.mjs`), so the panel is the path of a browser without it.
`.verify/chat-host-provider.mjs` (MAN-7464) covers the cases the live page cannot reach.

Open:
- The gutters need a region of `MIN_REGION_PX`; a docked 328px sidebar leaves 1272 of 1600, so the gutters leg collapses the sidebar first.
- The panel ignores the standalone-PWA status-bar offset (`panelPlacement` knows nothing of the safe area).
- The stored panel width can be fractional.
- `.verify/` is gitignored; force-add to commit.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-gutters/ChatGutterLayout.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/ChatHostFloating.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/hooks/useFloatingPanel.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/hooks/usePanelViewport.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/utils/anchorStore.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useChatDoor.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useChatHotkey.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-floats-panel.mjs

## MAN-7479 — chat-host window — the picture-in-picture host: its request, its mirror, its column and its pagehide

The picture-in-picture host of the live chat: where the browser has the Document Picture-in-Picture API (Chromium on a secure context), Ctrl+. / the door floats the chat in a window that sits over every application; where it has not, or the browser refuses, the press opens the panel instead (MAN-7478). Provider, slot and node: MAN-7464. Mirroring and `placeNode`: MAN-7446. The window's header is the panel's (`ChatHostHeader`, MAN-7467).

## Files

| file | what |
| --- | --- |
| `src/vite-env.d.ts` | declares the one member read, `Window.documentPictureInPicture?.requestWindow(options?: { width?: number; height?: number }): Promise<Window>` — TypeScript 5.9's lib.dom lacks the API. An `interface` merge, the only shape that can add to the global `Window` |
| `src/modules/chat-host/context/ChatHostContext.tsx` | `open()` requests the window; `collapse()` closes it; `comeHome()`; `pipWindow` in the public value |
| `src/modules/chat-host/ChatHostWindow.tsx` | `ChatHostWindow({ pip, header })`: portals `ChatHostHeader` into the window's header container inside `HostWindowProvider value={{ hostWindow: pip, subscribeMove }}` |
| `src/modules/chat-host/hooks/usePictureInPicture.ts` | `usePictureInPicture(pip): HTMLElement` — the header container; owns the mirror, the column, the move-in and the `pagehide` |
| `src/modules/project-workspace/hooks/useChatHotkey.ts` | `useChatHotkey(toggle, pipWindow)` — also binds the window while one is open |

## Rules

1. `open()` does nothing while no slot is mounted (`mountedRef`), while the chat already floats (`placementRef !== 'home'`) or while a window request is in flight (`openingRef`). Else, with `'documentPictureInPicture' in window`, it calls `requestWindow({ width: 420, height: 680 })` FIRST and synchronously inside the press — the request spends the press's user activation, so nothing is awaited or deferred ahead of it. When the window arrives: `pipWindow` and `'window'` are set together. A refusal — a rejection, a request that throws, one that resolves without a window (an extension or polyfill) — clears `openingRef`, logs a `console.warn` and sets `'panel'` unless a `collapse()` abandoned the request (rule 2), so a press never does nothing and the door is never wedged by a request that did not come back. Without the API `open()` sets `'panel'` at once.
2. The request in flight is `openingRef = { abandoned }`. A `collapse()` or a slot that unmounts before the window arrives sets `abandoned`; the arrival then closes the window and leaves the placement home. The provider's unmount effect does the same and closes an open window.
3. `collapse()` with a window open only calls `pip.close()`. Every way the window goes — that call, the window's own close button, "Back to tab", the opener navigating — is the window's `pagehide`, which runs the one path home: `comeHome()` (`moveTo(home, false)` synchronously, clear `pipWindow`, placement `'home'`), then `mirror.stop()`.
4. `usePictureInPicture`, in order: (1) `mirrorDocument(document, pip.document)`; (2) the window's column — `margin: 0; height: 100dvh; display: flex; flex-direction: column` — holding a header container (`flex: none`) and a chat container (`flex: 1; min-height: 0`, a flex column), appended to `pip.document.body`; (3) once the mirror's `ready` resolves, `moveTo(chatContainer, true)`, guarded by a `wanted` flag because `ready` also settles when the mirror is stopped; (4) `pagehide` as rule 3. The column is an element of its own: the mirror rewrites the body's `style` whenever the opener's changes.
5. The column is built in render (`useMemo` on `pip`) and only attached in the effect, and the effect sets no state. why: under StrictMode (development) the header container handed to state from the first, discarded mount was the one React rendered; the header landed in a detached element, appeared a render later, and the chat had been laid out 40px taller than it stayed, so the transcript sat 40px off its foot. The cleanup removes the listener, stops the mirror and detaches the column; it never closes the window (StrictMode would end every window in development).
6. `ready` waits for every cloned stylesheet `<link>` to load or fail, at most `READY_TIMEOUT_MS` (8s, MAN-7446). A link whose host does not answer — the app's Google Fonts sheet on a box with no route to fonts.googleapis.com — keeps the window empty to that ceiling, then the chat moves in. With the host reachable the sheet is cached and `ready` is a few milliseconds.
7. The tab keeps showing the chat until the window has it: `ChatHostSlot` squeezes its home and draws the placeholder on `chatAway` (the `'after'` of a move with `floating: true`), not on the placement (MAN-7464 rule 5). The placeholder reads its window wording from `placement === 'window'`.
8. A window that is already closed fires no `pagehide` the app can hear, so three guards end that wedge: `open()` does not adopt an arrival with `closed` set (it closes it, the chat stays home and the panel does not open); the effect calls the `pagehide` path at once if `pip.closed` after attaching the listener; and `collapse()` runs `comeHome()` instead of `close()` on a window that is `closed`. The trigger is a window closed out of band (another tab's PiP request, the window manager) inside the tens of milliseconds between the browser making it and the listener attaching.
9. The first-open size is 420×680; the browser remembers the size the reader gives it and code never positions the window. The hotkey is bound on `pipWindow` too (the effect is keyed on it), because a key pressed in the window never reaches the opener; in the window `toggle` is the collapse.

## Proof — `node .verify/chat-floats-window.mjs`

Playwright on :5183 (`lib/console.mjs`, dark), 1440×900, a scratch chat in `lib/probe-project.mjs`'s project, Haiku throughout, chat deleted at the end. Playwright's Chromium opens a Document PiP window from a trusted key and reports it as a page (`context.waitForEvent('page')`); the context's emulated viewport is laid over that page, so the probe sets it to 420×680. Two harness accommodations, named in the file: the opener's Google Fonts `<link>` is pointed at an empty sheet (rule 6), and the window's arrival is delayed 700ms so the emulation matches before the chat moves in. Covers: Ctrl+. opens a page whose document holds the transcript and the opener holds none; the composer's computed background equals the opener's; the window wears the header and is 420 wide; the transcript is at its foot and the composer is focused, the very textarea from home; the chat tab shows the window placeholder; a draft typed in the window stays; the model chip's menu is in the window's document and none in the opener's; Haiku picked there; a turn sent from the window streams into it; `/` opens the command menu in the window; Escape pressed in the window mid-turn sends `chat.abort` and the Stop button goes; Ctrl+. pressed in the window closes the page and the chat is home at its foot, draft intact, same textarea; a second float closed by `pipPage.close()` comes home the same way; a press while a window is being opened makes one request; a refused request opens the panel; with the API deleted the press opens the panel and no page opens; no console error while signed in beyond the empty chat's own 404s. Shots `.verify/artifacts/chat-floats-window-*.png`. The provider's window legs (a collapse that arrives while the window is opening; the slot unmounting) are `node .verify/chat-host-provider.mjs` (MAN-7464).

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/ChatHostWindow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/context/ChatHostContext.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/hooks/usePictureInPicture.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/vite-env.d.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-floats-window.mjs

## MAN-7481 — FAB door proof — fab-radial-door.mjs and lib/switcher.mjs

Proof that the FAB is the door to the radial, the chat and the dot (MAN-7475, MAN-486, MAN-7464). `node .verify/fab-radial-door.mjs`:

One run on the real app at :5183 (`lib/console.mjs` `openConsole`), 1440×900 then 390×844, with `documentPictureInPicture` deleted by an init script so every float lands in the in-page panel. The chat socket goes through `page.routeWebSocket`, forwarding to the real server, so the frames leg delivers a frame as the server would. Writes nothing to the registry: EIS App and ArchPulse are the operator's own rows, framed and taken down through the drawer. Exit 1 lists failures. Shots: `.verify/artifacts/fab-door-*.png`.

| leg | holds |
| --- | --- |
| radial | a FAB tap with nothing up opens two items (chat, applications), none greyed; with an application up, five in order, and through Close's fade they keep their places; a second tap closes it; Applications opens the drawer; a press outside closes it |
| keyboard | Escape closes and focus is on the FAB; Enter on the FAB opens with Chat focused; arrows wrap over the drawn items; Enter on Applications opens the drawer and its close returns focus to the FAB |
| drag and chat | a drag moves the FAB and closes the open radial, and its click does not reopen it; Chat floats the chat and the label reads Collapse chat; the next tap collapses it and opens no radial |
| application acts | Reload re-requests the frame's `src`; Open in a new tab opens the resolved url as a new page and the frame stays; Close takes the pane down and the radial draws just Chat and Applications again |
| dual | with the right frame focused, Close takes the right pane and the left stays |
| dot (one real Haiku turn, scratch project under /tmp) | EIS App framed while the turn runs, no dot; the dot arrives after `complete`; the label says why; Chat from the radial floats the chat and clears the dot; Escape with the radial open leaves the turn's `complete` not aborted |
| frames (injected through the route) | another conversation's `complete`, an aborted `complete`, stream and status frames light nothing; a `permission_request` lights the dot; floating clears it; a reply while the chat floats lights nothing; a reply while the chat is collapsed behind an application lights it; taking the application down, or changing conversation, clears it |

The scratch chat is deleted at the end; the 2 console errors while signed in (measured 2026-09-30) are the empty scratch chat's own 404 on `/api/providers/sessions/:id/token-usage`.
Not run against the 28px discs and the 34° step (its dot leg sends one Haiku turn): the two-item opening and the close-fade check, which compares each item's `left`/`top` style, since the drawn box shrinks by design, have no live reading.
Not proven live: a `permission_request` raised by a real permission-asking run (the frame is injected through the real socket client); the Escape check has no control run without the radial.

`.verify/lib/switcher.mjs` exports `FAB` (`button.vv-fab`; its label says what a press does, so it is never the selector) and `openDrawerFromFab(page)` (tap the FAB, then the Applications item). Every probe that wants the drawer goes through it: `app-drawer-link-project`, `app-row-project-link`, `app-rows-thin`, `app-rows-escape`, `chat-floats-panel`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/fab-radial-door.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/switcher.mjs

## MAN-7482 — chat-host unread — useUnreadReply, the rule behind the FAB's dot

`useUnreadReply({ sessionId: string | null, onScreen: boolean }): boolean` in `src/modules/chat-host/hooks/useUnreadReply.ts`: a reply landed in the chat's conversation while the chat was out of sight. `ChatHostProvider` calls it once and publishes the result as `unread` on `useChatHost()`; `useChatDoor` carries it as `ChatDoor.unread`; `AppSwitcherFab` draws it as the dot (MAN-486). Provider and slot: MAN-7464.

## Inputs

| input | source |
| --- | --- |
| `sessionId` | the slot's published `facts.sessionId`, else null; null means nothing can be unread |
| `onScreen` | provider: `placement !== 'home' \|\| (facts.showing && !covered)`. Floating is on screen; at home the chat tab must be showing and no application over it |
| `covered` | `reportCovered(boolean)`, called by `WorkspaceFrame` with `useCurrentApplication() !== null` |

## Rules

1. Lights on a websocket frame (`useWebSocket().subscribe`) whose `event.sessionId === sessionId` while `onScreen` is false, and that is `kind === 'complete'` with `aborted !== true`, or `kind === 'permission_request'`. Every other frame lights nothing: stream deltas, status, another conversation's frames, an aborted `complete` (the reader's own Stop).
2. Clears when the chat comes on screen (floated; the chat tab showing with no application over it) and when the conversation changes.
3. State is `waitingSessionId`, the conversation a reply waits in, never a boolean. `unread = waitingSessionId !== null && waitingSessionId === sessionId && !onScreen`. A stale value is dropped in the render that finds it (`if (waitingSessionId !== null && !unread) setWaitingSessionId(null)`), never by an effect. why: a change of conversation un-lights the dot by itself.
4. The subscription is bound once (`[subscribe]`); it reads `sessionId` and `onScreen` through a ref written in a layout effect. why: a frame that lands right after the chat floated is judged against the latest facts, not the render the subscription was made in.
5. `covered` is `WorkspaceFrame`'s to report, from a layout effect (INV-6010); chat-host never imports the switcher.
6. Proof: the dot and frames legs of `.verify/fab-radial-door.mjs` (MAN-7481).

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/hooks/useUnreadReply.ts

## MAN-7483 — command palette — the Applications group: the switcher's five acts

The command palette draws the application switcher's five acts as an `Applications` group. The list is the radial's (`useSwitcherActions`, MAN-491; the radial: MAN-7475), so a label and the order are written once; the palette greys a `disabled` act in place, and the radial does not draw it.

## Files

| file | what |
|---|---|
| `src/modules/project-workspace/ProjectCommandPalette.tsx` | `ProjectCommandPalette({ chatDoor: ChatDoor })` calls `useSwitcherActions(chatDoor)` and passes the result to `CommandPalette` as `switcherActions`. `WorkspaceFrame` renders it and hands it the one door it builds (`useChatDoor`), the same door the FAB and the hotkey press |
| `src/modules/command-palette/CommandPalette.tsx` | prop `switcherActions: SwitcherAction[]`; renders `PaletteSwitcherGroup` right after the `Actions` group and before `Navigate`, on the same page rule as `Actions` (`showActions`: no sub-page open). Passes `createSwitcherFilter(switcherActions)` as `Command`'s `filter`. The palette's barrel (`index.ts`) is unchanged |
| `src/modules/command-palette/PaletteSwitcherGroup.tsx` | `PaletteSwitcherGroup({ actions, run })` → `<CommandGroup heading="Applications">`. One `CommandItem` per act: `value={switcherActValue(act)}`, `disabled={act.disabled}`, `onSelect={() => run(act.run)}`; the icon in the `Actions` rows' idiom (`h-4 w-4 shrink-0 text-muted-foreground`, `aria-hidden`), the label, and `act.shortcut` (only Chat has one: `Ctrl+.`) in muted `text-xs` on the right |
| `src/modules/command-palette/utils/switcherActFilter.ts` | `switcherActValue(act)` → `` `${label} ${keywords}`.trim() `` (the row's `value`); `createSwitcherFilter(actions)` → the `Command` filter |

## Rules

| rule | why |
|---|---|
| A disabled act stays in its place, greyed | cmdk never selects a disabled row |
| `run(act.run)` is synchronous: never put a promise or timer between the press and `act.run` | the Chat act floats a Document Picture-in-Picture window, which the browser allows only inside the keypress or click that asked |
| `createSwitcherFilter` gives the five acts a score floor of 0.5 (`SWITCHER_ACT_MATCH_FLOOR`) and leaves every other row at cmdk's own `defaultFilter` score | cmdk's match is fuzzy; a greyed act is skipped by the selection and Enter falls to the next match, so `reload` with nothing framed floated the chat |
| The group's `value` and the filter's act set both come from `switcherActValue` | one function, so the two cannot drift |
| The floor is scoped to the five acts; a palette-wide threshold changes every group and is a separate change | only the acts change state |
| With the palette open, `Ctrl`/`Cmd` + `CHAT_TOGGLE_KEY` with `e.defaultPrevented` set closes the palette (`handleKeyDown` on `Command`) | `useChatHotkey` hears the chord first on window capture and runs the Chat act; left open, the palette stays modal and dead to the keyboard until Escape |
| `CommandList` max height is `max-h-[min(360px,calc(100dvh-6rem))]` | `Actions` + `Applications` need about 330px (class arithmetic, not measured); the last row must not sit below the fold on a short window |

## Floor measurement (cmdk `defaultFilter`, 2026-09-30)

| match | score |
|---|---|
| prefix, whole word, word initials, multi-word | 0.8 to 0.99 |
| scattered letters inside words | 0.17 or less |
| `reload` against Chat's keywords (`chat conversation messages float window panel`) | 0.0028 |

Nothing lies between 0.17 and 0.8, so 0.5 separates a query a reader means from an accident.

## Known limits

- The Chat act is always enabled, even with no project: the door's "Chat always available" rule in `useSwitcherActions`/`useChatDoor`, shared by the radial and the hotkey. A palette-only grey would split the one list.
- The kit `Dialog` restores focus last, after the palette closes: after the Chat chord focus lands on the control the reader started from, not the chat's composer.
- `switcherActFilter.ts` imports `defaultFilter` straight from `cmdk`; the kit's `Command.tsx` does not re-export it.

## Proof

`node .verify/palette-applications-group.mjs` (gitignored; live app on `:5183`, Playwright Chromium, 1440×900 then 390×844, `documentPictureInPicture` deleted by an init script; sends no turn and writes no registry row). Checks:

1. Group stands right after `Actions`, five acts in order Chat, Apps, Reload app, Close app, Open in tab; the last three greyed with nothing up; 16px muted `aria-hidden` icons.
2. Only the Chat row prints a shortcut (`Ctrl+.`); it reads `Collapse chat` while the chat floats.
3. Nothing up: `reload` leaves Reload app alone in the group and no act is the selection. With EIS App framed, `reload` selects Reload app and Enter re-requests the frame's `src` (frame requests 23 → 46, `src` unchanged).
4. Apps opens the drawer; Open in tab opens `http://127.0.0.1:8004/`; Close app takes the application down; the Chat row floats the chat and, pressed again by Enter, collapses it.
5. `pipLeg` (second context keeping the PiP API): the Chat row selected by click and by Enter each open a real PiP window holding the chat.

2026-09-30: every check passed on the build before the filter, chord-close and list-height changes; the two "reload" assertions and the three changes above were edited afterwards and the script was syntax-checked, not re-run.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/command-palette/CommandPalette.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/command-palette/PaletteSwitcherGroup.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/command-palette/utils/switcherActFilter.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/ProjectCommandPalette.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/palette-applications-group.mjs

## MAN-7484 — Session picker view — panel, trigger and row rules

Rules of the picker's view: the panel's mechanics and the trigger and row it draws. Parts and data: MAN-7473.

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
5. Marks, drawn from `chatMarks` with `isSelected: isCurrent` (MAN-7522), in order: awaiting an answer (`bg-warn-ink` pulsing dot; hides running), running (spinner), subagents (purple dot), unread (`bg-primary` dot; hidden on the open row and on running or awaiting rows). Labels `simpleList.awaitingInput`, `.running`, `.subagentsRunning`, `.unread`.
6. The open conversation: `aria-current="true"`, `bg-primary/10`, `font-medium` and a `Check` tick, so it survives greyscale.
7. States, each with New chat still pinned: loading (three `vv-skeleton` rows in `role="status"`, `chatHost.pickerLoading`); error (`Banner tone="warn"`, `chatHost.pickerError`); no groups, or the simple list's one empty block (paragraph `chatHost.pickerEmpty`).
8. Show more (`simpleList.loadMore`, "Show more") draws only when `status === 'ready'`, the list is not empty and `hasMore`; it calls `onLoadMore` and keeps the panel open.
9. Selectors: `[data-picker-item]`, `role="group"`; `[role="menu"]` and `[role="menuitem"]` select nothing. Test ids: `session-picker-trigger`, `-panel`, `-new`, `-row` (with `data-session-id`), `-flat`, `-project`, `-project-hint`, `-project-empty`, `-empty`, `-load-more`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSessionPickerMenu.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSessionPickerPopover.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSessionPickerRow.tsx

## MAN-7485 — Session picker proofs — session-picker-scaffold.mjs (the view) and header-picker.mjs (the whole)

Proofs of the session picker: the view on fake data, the whole in the running app. Parts and data: MAN-7473; view rules: MAN-7484.

## Proof, view — `node .verify/session-picker-scaffold.mjs`

Needs :5183 (client) and :8005 (the framed application). `ONLY=1440-light` (`<width>-<theme>`) runs one combination. Exit 1 lists failures.
- Fake data around the view (`SidebarSessionPickerMenu`), the popover and the row; the sidebar-fed outer `SidebarSessionPicker` is proved live by `header-picker.mjs`. Mounts the real components through `.verify/lib/mountReact.mjs` with fake props: in `ChatHostHeader` in a 420px column (the picture-in-picture width) and in the real `ChatHostPanel` beside the real FAB over an `:8005` iframe. 1440×900 and 390×844, light and dark; 390 runs with touch emulation (coarse pointer).
- The 420px column (states, dense list) runs at 1440 only.
- Covers: the live tab carries no picker; trigger fit, 36px height, ellipsis; panel placement, z 70, `OWNS_ESCAPE`, 8px margins, 360px cap; New chat first; the open row's four signs; the four marks; row heights 32/38/44; heading and project-line ink ≥ 4.5:1; sticky heading and pinned New chat under scroll; the empty project scrolled into view; Escape (already marked at document capture), keyboard walk, outside press, blur, Show more keeps open, a pick, New chat; a press in the framed application closes the panel; no console errors.
- Shots `.verify/shots/session-picker-{panel,window}-<state>-<width>-<theme>.png`; `<state>`: `trigger-long`, `flat-open`, `projects-open`, `projects-empty-project`; window at 1440 only: `loading`, `error`, `empty`, `bare`, `new`, `noproject`, `dense-scrolled`.
- Measured 2026-09-30 on :5183: 274 checks pass, exit 0.
- `.verify/` is gitignored; force-add to commit.

## Proof, live — `node .verify/header-picker.mjs`

Needs :5183, :8005 and the API (curl). Sends no model turn. Exit 1 lists failures. `.verify/` is gitignored.
- Two runs on :5183 in Playwright's Chromium, one per list mode: `simpleChatList: true`, then `false`, pinned for that page only (`lib/prefs-pin.mjs`, writes dropped). An init script deletes `window.documentPictureInPicture`, so `Control+.` floats the chat into the in-page panel.
- Scratch registry row: `POST /api/apps` `Header check` (`http://{host}:8005`), `PATCH` `project` = `/home/lyphe/.claude/ArchPulse`, removed at the end. The run refuses to start with a row of that name on file. `sha256sum apps.local.json` is checked equal before and after.
- Per run:
  1. At home the live chat carries no picker.
  2. Floating: simple list fetches a `simpleList=true` page; tree fetches none.
  3. The header names the open conversation and its project (the title the API holds).
  4. The list has rows, New chat first; the open row is `aria-current`; the pick target is listed; simple = one `session-picker-flat` block, tree = one `session-picker-project` per project.
  5. A pick puts `/session/<id>` in the URL and its transcript (a four-word snippet from the newest page) in the floating chat; the chat stays floating; the header names the new one.
  6. New chat, nothing framed: the new-chat screen (`new-chat-project`) opens in the chat's current project.
  7. Scratch row framed: the chat is floated again over it (a FAB press collapses a floating chat, so the row is framed from home through `openDrawerFromFab`); a pick still works; New chat opens with ArchPulse selected. The workspace is on another project first, so only `FloatingChatHeader` reading the row's `project` explains it.
  8. No console error while signed in beyond the chat's own 404s.
- Shots `.verify/artifacts/header-picker-{simple-list,tree}-{1-named,2-list-open,3-picked,4-new-chat-current,5-new-chat-linked}.png`.
- Measured 2026-09-30: every check passes in both modes.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/header-picker.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/session-picker-scaffold.mjs

## MAN-7486 — Chat door routing proof — node .verify/chat-door-application.mjs

Proves the door's routing rule (MAN-7478 rule 9): Ctrl+. brings the front application's project once per visit, and never swaps a conversation the workspace is already on. Project door: MAN-7444. Drawer helpers: `.verify/lib/switcher.mjs` (MAN-7481).

## Run

`node .verify/chat-door-application.mjs`

| fact | value |
| --- | --- |
| target | :5183, Playwright Chromium via `lib/console.mjs` `openConsole`, 1440×900 |
| chat surface | init script deletes `window.documentPictureInPicture`, so the chat floats as the in-page panel (`[data-chat-host-panel]`) |
| model calls | none; conversations are opened and read, never typed into |
| fixture | scratch row "Chat door check" at `http://{host}:8005`, added through the drawer's Add application, linked through the kebab's Link project…, removed through the kebab at the end |
| refuses to start | a row already named "Chat door check" is on file |
| registry | `apps.local.json` sha256 taken before and after; equal or the run fails |
| failure cleanup | `finally` deletes the scratch row through `DELETE /api/apps/<id>` |
| checks | 15 on a clean run; exit 1 lists the failures |
| shots | `.verify/artifacts/chat-door-application-1-routed.png`, `-4-empty-project.png`, `-failure.png` on a throw |
| console | judged only after the probe's own `page.reload`; the reload aborts the mounted chat's fetches |

Measured 2026-09-30 on :5183: all legs pass, hash equal at start and after removal.

## Legs

| leg | steps | holds |
| --- | --- | --- |
| 1 | frame the row, Ctrl+. | URL is `/session/<id>` of the first ArchPulse row of the sidebar, which equals the row read at the start |
| 2 | collapse, pick an older ArchPulse conversation, Ctrl+. | pick stays |
| 2b | collapse, pick a `.claude` conversation, Ctrl+. | pick stays; only the remembered id keeps the door from routing to ArchPulse |
| 3 | collapse, pick an older ArchPulse conversation, radial Close, frame again, Ctrl+. | pick stays; the workspace is already on the project |
| 3b | collapse, pick a `.claude` conversation, Close, frame again, Ctrl+. | routes to ArchPulse's newest; the forgetting on Close is a routing that ran |
| 4 | collapse, relink to `keepalive-proof` (no conversations), Close, frame again, Ctrl+. | `/` with `[data-testid="new-chat-project"]` naming `keepalive-proof` |
| 5 | Remove the row through its kebab | registry hash equals the first line |

why 2b and 3b: legs 2 and 3 pass without the memory, since `openProjectChat` is a no-op on the project the workspace already holds.

## Rules

1. The probe presses Ctrl+. after `document.activeElement.blur()` and `window.focus()`: a key pressed inside the cross-origin frame never reaches the hotkey (MAN-7478 rule 10).
2. The sidebar is an accordion and a click on a project row selects that project. The probe reads both orders (ArchPulse, `.claude`) once at the start and opens a block only when it picks from it; reading by clicking puts the workspace on ArchPulse before the press.
3. Live data: another session touching ArchPulse mid-run reorders its sessions. Rerun.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useChatDoor.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-door-application.mjs

## MAN-7500 — Whole-plan proof — whole-check.mjs: the window, panel, radial, picker, door and dot, at 1440 and 390

The whole app-drawer-chat plan run once on the live dev client, in a real browser: the host window, the panel, the radial, the header's picker, the door's three ways in, the dot, and the registry back at its hash. `node .verify/whole-check.mjs` (every leg, at 1440x900 and then 390x844); `WIDTH=390 node .verify/whole-check.mjs` for one width; leg names (`window picker door dot panel radial`) after it run only those. About five minutes (295 s measured); exit 0 and `ALL CHECKS PASS` when every line is `ok`. A leg name or a `WIDTH` the file does not know exits 2 before anything runs, and the last check counts the legs that ran against the legs asked for, so a run that drew nothing cannot end green.

Needs: the client on :5183, the API on :3011, EIS App on :8004 and ArchPulse on :8005 answering, and the harness's Chromium (it opens a real Document Picture-in-Picture window from a trusted press and reports it as a page).

## What each leg shows
| leg | mode | shows |
|---|---|---|
| window | PiP present | Ctrl+. floats the scratch chat into a window: a draft typed there stays; the model menu opens INSIDE it (none in the opener); the reply to a Haiku turn sent from it lands in it, at its foot (it arrives in one flush, so "streamed" is not sampled); Ctrl+. pressed in it collapses it, the transcript home at its foot, the draft intact, the same textarea |
| picker | PiP present | in the window's header, under `simpleChatList` true and then false (`prefs-pin.mjs`, writes dropped): the list opens in the window, New chat first, the open conversation marked; a pick puts `/session/<id>` in the URL and its transcript in the window |
| door | PiP present | with the scratch row "Whole check" (`http://{host}:8005`, linked to ArchPulse through Link project…) framed, each in its own visit: the radial's Chat, Ctrl+. in the tab, and the palette's Chat row float the chat onto ArchPulse's most recent conversation (read from the API by the door's own rule); Ctrl+. in the window and in the tab, and the palette's Chat row (reading `Collapse chat`), collapse it; the palette's Applications group lists the five acts |
| dot | PiP present | a Haiku turn runs while EIS App (no project) covers the chat; when `complete` arrives the FAB carries `.vv-fab__dot`; floating the chat clears it |
| panel | PiP deleted | the press opens the panel 12px off the FAB, no window; dragging the FAB moves it; the grip resizes it across a framed application (`vv-drag-resize` mid-drag); `localStorage['chat-host']` holds the size; a reload keeps it |
| radial | PiP deleted | two items with nothing up, five with an application up; the palette lists the same five; Applications opens the drawer; Reload re-requests the frame, Open in a new tab opens its url, Close takes it down; Chat floats the panel and the FAB's next tap collapses it without a radial; a focused right pane is the one Close takes; a second tap closes the radial; a drag moves the FAB |

The two modes are told apart by an init script reading `sessionStorage['probe:no-pip']`; a page with it set has `documentPictureInPicture` deleted before its scripts run.

## What it spends and touches
- Two Haiku turns per width (the window's, the dot's), both in `lib/probe-project.mjs`'s scratch project under /tmp; nothing is ever sent to a real project's conversation. The scratch chat is deleted at the end BY CURL, so a run ended under the browser's feet still takes it down.
- The picker and door legs OPEN real conversations (ArchPulse's newest, the simple list's top rows) as a reader would; the server marks a completed unread session read when it is viewed (`markReadIfCompleted`), so a conversation that was unread and finished may be read afterwards. Nothing is typed in them.
- The registry: `sha256sum apps.local.json` is read first; the scratch row is added through the drawer's form, linked through its kebab and removed through its kebab; the run fails if the hash differs at the end and removes any row it left. The server's icon cache (`apps.icons.local.json`) keeps a probed row's id until some other icon is due, so the run takes the scratch id out of it itself (write-then-rename) and checks it is gone.
- Preferences are pinned for the run's pages only (writes dropped from the picker leg on). Dual screen, a standing preference the browser keeps, is put back (`Close dual screen` on the row that holds the second half) and the drawer's summary is read to say so.

## What fails the run besides a leg's own checks
- Any request the tab or a window made to the app's own origins (the client and its API) that failed or answered 4xx/5xx, except the scratch chat's own `token-usage` 404. Windows are watched as each opens. The browser words every failed load "Failed to load resource", so the console check leaves resource loads out and this URL-keyed check judges them. Requests to other origins (the framed applications' signed-out `/api/eis/auth/me` 401s, the font host the sandbox cannot reach) are printed and not counted.
- Console errors and page errors in the tab or a window.
- A window that does not close within 15 s after a collapse (the wait gives up, so it is a failure, not a hang).

## Why it is shaped this way
- The picker opens its first conversation FROM INSIDE the app (`/`, then a route change), not by a cold deep link: in simple-list mode a cold `/session/<id>` can be replaced by `/` (INV-6043; `.verify/simple-list-deep-link.mjs` reproduces it).
- The app's Google Fonts `<link>` is pointed at an empty sheet before a float (the run says so once, in its output), and `requestWindow` answers 700ms late. The sandbox cannot reach the fonts, and the window's mirror waits every cloned link up to its 8s ceiling: unpatched, the window page exists at +38ms and the chat's composer appears in it at +8397ms, so every `ok` here stands on the patched page and a host that cannot reach Google Fonts shows a blank window for 8s on each float. Playwright also lays its emulated viewport over the window the moment it adopts it.
- On a phone the panel stands above or below the FAB at FULL width, so its grip changes the height only, and it can only SHRINK there (it already fills the room); on desktop it grows by the pointer's travel.
- The 401s on `/api/eis/auth/me` in the run's log are the framed EIS App's own signed-out call, listed and not counted.
- Screenshots land in `.verify/artifacts/whole-check-<width>-<name>.png`.

Files: `whole-check.mjs` (the driver: baseline hash, scratch chat and row, the two widths, removal), `lib/whole-check-kit.mjs` (reporter, curl, scratch row and chat removal, icon-cache cleanup, network watch, page moves), `lib/whole-check-window-legs.mjs` (window, picker, door, dot), `lib/whole-check-inpage-legs.mjs` (panel, radial).

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/whole-check-inpage-legs.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/whole-check-kit.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/whole-check-window-legs.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/whole-check.mjs

## MAN-7507 — Shared sidebar state — toggled project stars and feed removals

Two module-level stores keep the sidebar (`useSidebarController`, `SidebarSimpleList`) and the floating session picker (`useSessionPicker`, MAN-7473) in agreement. Each reader mounts where the other's React state is not.

## Star overrides — `src/modules/sidebar/utils/projectStarOverrides.ts`
| export | use |
| --- | --- |
| `setProjectStarOverride(projectId, starred)` | records the star the reader just set, or the server just answered; `useSidebarController.toggleStarProject` is the only writer |
| `reconcileProjectStarOverrides(projects)` | drops each override `projects[].isStarred` has caught up with, and those of projects that are gone; runs in the controller's `[projects]` effect |
| `useProjectStarOverrides()` | `useSyncExternalStore` read of the map; the controller and `useSessionPicker` both call it |
| `withResolvedStarState(projects, overrides)` | `projects` with each override applied; the same array when none differs |

- `projects[].isStarred` refreshes only on a full project refresh; the server's `toggle-star` answers the caller and broadcasts nothing. why: without the map a star reorders the sidebar and not the picker.
- The map is replaced, never mutated, on each write. why: `useSyncExternalStore` compares snapshots by identity.
- The picker's tree is `sortProjects(withResolvedStarState(projects, starOverrides), sortOrder)`; the sidebar's is the same over its own `projectsWithResolvedStarState`. Both orders agree at once.

## Feed removals — `src/modules/sidebar/hooks/useSimpleChatList.ts`
- Module-level `removalListeners` holds one `dropRow` per mounted `useSimpleChatList` instance.
- `removeLocal(sessionId)` on any instance calls every listener. An instance drops the chat (`removeChat`) only when its own tree holds it, and lowers its `total` only when that chat was a top-level row (`wasTopLevel`). why: an instance that never paged the row in must keep its total; a chat inside a folder was never one of the rows `total` counts.
- `dropRow` writes `itemsRef.current = landed.items` before `setItems(landed.items)`. why: a second removal in the same tick must read the first's result; from the render-time snapshot React applies the second `setItems` over the first and resurrects the chat while both `setTotal` decrements land.
- Not covered: a mixed same-tick pair (`moveLocal` then `removeLocal`) can lose the optimistic write until the next feed reload. No live caller does it.
- An archive or a delete sends neither `session_upserted` nor `simple_list_changed`, the two frames that refresh the feed. why: without the fan-out the picker keeps the row until an unrelated frame.
- The hook's whole contract: MAN-7524.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/hooks/useSimpleChatList.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/utils/projectStarOverrides.ts

## MAN-7522 — The marks rule — `simpleChatMarks.ts`, `chatMarks` and `folderDot`

One home for which marks a chat draws and which one a folder's dot wears: `src/modules/sidebar/utils/simpleChatMarks.ts`. No other file spells the conditions out. Simple list: MAN-661. Picker row: MAN-7484.

## Readers

| reader | uses |
| --- | --- |
| `SidebarSimpleListRow.tsx` | `chatMarks`; draws `marks.awaitingInput`, `.running`, `.subagents`, `.unread`, each `&& !isEditing` |
| `SidebarSessionPickerRow.tsx` | `chatMarks` with `isSelected: isCurrent` (the open conversation) |
| `SidebarSimpleListItems.tsx` | `folderDot(folder.chats.map(chatMarks))`, facts from the three id sets, each chat's `unread` and the open chat's id |

Type `SimpleChatMark` = `'awaitingInput' | 'unread' | 'running' | 'subagents'`, in `src/shared/types.ts`.

## `chatMarks(facts)` → `Record<SimpleChatMark, boolean>`

`facts`: `unread`, `isSelected`, `isRunning`, `isAwaitingInput`, `isSubagentRunning`.

| mark | drawn when |
| --- | --- |
| `awaitingInput` | `isAwaitingInput`, selected or not |
| `unread` | `unread && !isSelected && !isRunning && !isAwaitingInput` |
| `running` | `isRunning && !isAwaitingInput` |
| `subagents` | `isSubagentRunning`, beside any other mark |

## `folderDot(marks[])` → `SimpleChatMark | null`

First of `awaitingInput`, `unread`, `running`, `subagents` that any entry carries; `null` when none does. An empty array is `null`.

## Proof

`node .verify/probe-simple-marks.mjs` — bare Chromium page on `http://127.0.0.1:5183/`, no sign-in, nothing written; imports `/src/modules/sidebar/utils/simpleChatMarks.ts` from the dev server. Ends `SIMPLE-MARKS PASS` (exit 0), else exit 1.
- Four pairs (waiting beside unread, unread beside running, running beside subagents, no marks) and `folderDot` over each.
- M6: all 32 combinations of the five facts give the verdicts the two rows' old expressions gave. 2026-09-30: 0 differ.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSimpleListRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/utils/simpleChatMarks.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-simple-marks.mjs

## MAN-7523 — The simple list's folder scaffold — `SidebarSimpleListItems`, `SidebarSimpleFolderRow`, `SidebarSimpleFolderPicker`

The folder tree's three presentational components and the chat row's two new props, all in `src/modules/sidebar/`. Each is a function of its props: no fetch, no hook, no DOM read. The list: MAN-661. Types: MAN-7514. Tree functions: MAN-7520. Marks: MAN-7522. Words: MAN-7512.

## Wiring
- 2026-09-30: live. `SidebarSimpleList.tsx` mounts `SidebarSimpleListItems` (one block per top-level row; `SidebarSimpleFolderRow` is its folder header) and `SidebarSimpleFolderPicker`; `.verify/probe-simple-folder-composer.mjs` walks the mounted tree end to end (MAN-7528).
- The live list draws the tree: `onMoveToFolder` is null exactly while the list holds no folder, so no row offers "Move to folder…" until one exists.
- `// FILL: <name>` comments sit on the behaviour each marker names, already written. Wiring the tree into `SidebarSimpleList.tsx` does not rewrite them.

## `SidebarSimpleListItems.tsx`
Draws the tree as a fragment inside `SidebarSimpleList`'s `simple-chat-list-rows` container; it draws no container of its own.

| Prop | Is |
| --- | --- |
| `items` | `SimpleListItem[]`, server order |
| `selectedSessionId`, `failedSessionId`, `freshFolderId` | `string \| null` each |
| `busySessionIds`, `awaitingInputSessionIds`, `subagentRunningSessionIds` | `ReadonlySet<string>` |
| `liveHostSessionIds` | `ReadonlySet<string> \| null` — the chats whose CLI has a live session host, from `useSessionHostLiveSet` (pushed on change, never polled); `null` until the server's first snapshot |
| `dragging` | `SimpleListItemRef \| null` |
| `dropTarget` | `SimpleListDropTarget \| null` |
| `dragProps` | one object of the carry's pointer props, the same for every row; chat rows and folder headers both spread it; `useSimpleChatDrag` returns it and `SidebarSimpleListItems` takes it as given (MAN-7525) |
| `onSelectChat`, `onArchiveChat`, `onDeleteChat`, `onChooseIcon` | `(chat) => void` |
| `onRenameChat(sessionId, title)` | |
| `onMoveToFolder` | `((chat) => void) \| null`; `null` = no "Move to folder…" entry on any row |
| `onToggleFolder`, `onDeleteFolder` | `(folder) => void` |
| `onRenameFolder(folderId, name)`, `onFreshShown()`, `t` | |

- One `data-testid="simple-chat-block"` per top-level item, `relative flex flex-col gap-1`, carrying `data-item-kind` (`chat` \| `folder`) and `data-item-id`. The block, not the row, carries them: a carried folder lands beside a block.
- A folder's block = header + its chats' rows (`isNested` true), the rows only while `!folder.collapsed`; a folded folder mounts no chat row.
- The folder's dot = `folderDot(folder.chats.map(chatMarks))` (MAN-7522).
- A chat row's `isAsleep` = `liveHostSessionIds !== null && chat.provider === 'claude' && !liveHostSessionIds.has(chat.sessionId)`: only a Claude chat has a host to lack, and nothing is grayed while the set is unknown. `SidebarSimpleListRow` draws it as `data-asleep="true"`, the title in `text-muted-foreground` (`text-secondary-foreground` while selected, where muted reads under AA on the selected wash), the glyph in `text-ink-faint` (muted while selected) and the hover title `simpleList.asleep` on the row's link. A state, not a mark: the row opens and takes a message as before, and the next message starts a host. Which chats are asleep and why: session-host MAN-695, "Which chats have a live host".
- `holdsSelected` = folder folded and one of its chats is the open chat.
- Rhythm is uniform on purpose: a folder's chats sit `gap-1` from the header, the same air as between blocks; the indent carries the grouping. The block's `gap-1` is the one knob.
- Lift: a carried chat is lifted as its own row, a carried folder as its whole block, by the kit's carry (`shared/ui/sortable/carried.ts`; MAN-8139); neither fades. Every landing mark (the row and block lines, the folder ring, the end line) is `z-40`, one step over the carried item's 30, so the row drawn under the finger never hides it.
- `simple-chat-drop-end` (`h-0.5` accent line) is drawn whenever `dropTarget.at === 'end'`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSimpleFolderPicker.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSimpleFolderRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSimpleListItems.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSimpleListRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSimpleList.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-simple-folders.mjs

## MAN-8123 — The simple list's folder scaffold — `SidebarSimpleListItems` — Drop marks
section: The simple list's folder scaffold — `SidebarSimpleListItems`, `SidebarSimpleFolderRow`, `SidebarSimpleFolderPicker`/001 Drop marks

| Carried | `dropTarget` | Mark, on |
| --- | --- | --- |
| chat | `row`, a chat | `dropEdge` = that edge, on that chat's row |
| chat | `row`, a folder, `before` | `dropEdge='before'`, on the folder header's top edge |
| chat | `row`, a folder, `after` | none |
| chat | `into` F | accent ring (`isDropInto`), on F's header |
| folder | `row` X, X a top-level item | line at the top (`before`) or bottom (`after`) of X's block |
| any | `end` | `simple-chat-drop-end` |

## `SidebarSimpleFolderRow.tsx`
The header. Props: `folder`, `dot`, `holdsSelected`, `isFresh`, `onFreshShown`, `onToggle`, `onRename(name)`, `onDelete`, `dragProps` (nullable), `isDragging`, `dropEdge` (`'before' \| null`), `isDropInto`, `t`.

| Part | Rule |
| --- | --- |
| root | `data-testid="simple-chat-folder"`, `data-folder-id`, `data-collapsed` (`'true' \| 'false'`), `data-dragging`; spreads `dragProps` |
| height | compact sidebar: `min-h-11`; otherwise `py-2` (the chat row's rule) |
| glyph | the `Folder` icon in a bare span; the header is carried by a hold anywhere that is not a control, like a chat row |
| toggle | ONE element, `role="button"` span, `tabIndex={0}`, `data-testid="simple-chat-folder-toggle"`, `aria-expanded`; press, Enter and Space call `onToggle`; `title` = `runner.collapse` / `runner.expand`, ns `common`; `FoldChevron` + name |
| rename | input `simple-chat-folder-rename-input`: Enter saves, Escape cancels; blank or unchanged name calls nothing |
| dot | drawn only when `dot !== null`: `simple-chat-folder-dot`, `data-mark`, `role="img"`, label and title = the mark's word; `awaitingInput` adds `vv-pulse` |
| menu | `ActionMenu` labelled `simpleList.folderOptions` with `{ name }`; entries Rename (`simple-chat-folder-rename`), divider, Delete folder (`simple-chat-folder-delete`, danger) |
| selected wash | `holdsSelected`: `bg-primary/10` |
| ring | `isDropInto`: a layer of its own (`simple-chat-folder-into`: `absolute inset-0 z-40 ring-2 ring-primary`), not a ring on the header, because the carried row is drawn over the header |
| line | `dropEdge='before'`: `h-0.5` accent line on the top edge |
| fade | none of its own; `data-dragging` only says it is the carried header |

- The name is not a `<button>`: the carry turns away any press inside a `button`, so the name carries the folder like a chat's title does (a mouse by a drag, a finger by a hold).
- Fresh effect (`isFresh`): opens the name for typing, selects it whole on first focus, `scrollIntoView({ block: 'nearest' })`, calls `onFreshShown()`; the list clears its fresh id there, so it runs once per fresh turn.

| Mark | Word key (`simpleList.`) | Disc ink |
| --- | --- | --- |
| `awaitingInput` | `awaitingInput` | `bg-warn-ink` |
| `unread` | `unread` | `bg-primary` |
| `running` | `running` | `bg-muted-foreground animate-pulse` |
| `subagents` | `subagentsRunning` | `bg-purple-500 dark:bg-purple-400 animate-pulse` |

## `SidebarSimpleFolderPicker.tsx`
Props: `open`, `folders: SimpleListFolder[]`, `currentFolderId: string \| null`, `onPick(folderId \| null)`, `onCancel`, `t`.

- `Dialog` `simple-chat-folder-dialog`, titled `simpleList.folderPickerTitle`; closing it calls `onCancel`.
- One `simple-chat-folder-option` per folder, `data-folder-id` = its id, in given order.
- The current folder's option: `disabled`, `aria-pressed`, `ring-2 ring-primary`. A press on another calls `onPick(folderId)`.
- A last option `data-folder-id="none"` (`simpleList.noFolder`) only when `currentFolderId !== null`; a press calls `onPick(null)`.
- Cancel = `simple-chat-folder-cancel`, label `actions.cancel` (`sidebar.json`).

## `SidebarSimpleListRow.tsx` — two props
| Prop | Effect |
| --- | --- |
| `isNested: boolean` | `ml-8` and `data-nested="true"` (attribute absent otherwise) |
| `onMoveToFolder: (() => void) \| null` | non-null adds `simple-chat-move-to-folder` (`simpleList.moveToFolder`, `FolderInput`) between Change icon and Archive; null draws no entry |

- `ml-8` = 32px = the row's icon box (`w-6`) + `gap-2`: a nested glyph starts in the folder header's chevron column and the title starts past the folder's name. Anything that moves the chevron moves this indent.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSimpleFolderPicker.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSimpleFolderRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSimpleListItems.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSimpleListRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSimpleList.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-simple-folders.mjs

## MAN-8124 — The simple list's folder scaffold — `SidebarSimpleListItems` — Gate — `.verify/probe-simple-folders.mjs`
section: The simple list's folder scaffold — `SidebarSimpleListItems`, `SidebarSimpleFolderRow`, `SidebarSimpleFolderPicker`/002 Gate — `.verify/probe-simple-folders.mjs`

- `node .verify/probe-simple-folders.mjs` (dev server on `127.0.0.1:5183`, signed in through `openConsole`); `ONLY=1440-light|1440-dark|390-light|390-dark` runs one combination. Gitignored; not a `phase-*.mjs`, so `all.mjs` does not run it.
- Mounts fixture props over the signed-in page through `lib/mountReact.mjs`: 17 states × 4 combinations (1440×900 and 390×844, light and dark). States: header with each of the four dots and none, folded and open, holding the open chat, renaming, as a drop target; picker with and without a current folder; tree with a loose chat, an open and a folded folder, a carried folder's block, the end line.
- Fixture host: `position:fixed`, `z-index:60` (under `ActionMenu`'s `z-[70]`, over the app), background `var(--canvas)` (`--background` is not defined); the picker's host is `display:contents` so its body-portalled Dialog shows. Frame width = the app's own sidebar width at that viewport.
- Shots: `.verify/shots/simple-folders-<state>-<width>-<light|dark>.png`; artifact `.verify/artifacts/simple-folders.json`.
- Checks: dot count, mark and label; `data-collapsed`; nested count, indent and column alignment; block count and kinds; rename value; line, ring and wash; fades (carried chat's row, carried folder's block, the header itself never); end line; picker rows and disabled state; height rule; name not a `<button>`. Seam 7: press, Enter and Space on the toggle each call `onToggle`; a press on the glyph calls nothing; the carry props arrive under the folder's ref; the picker's three answers (`onPick(id)`, `onPick(null)`, `onCancel`).
- Live check, last in each combination: the list is turned on for the probe's own context by `pinPreferences(… { simpleChatList: true }, { writes: 'drop' })` then a reload; it draws no folder chrome, every row is flush left, no row menu offers "Move to folder…". It runs last because the fixture checks read the whole document and a pinned page draws live rows.
- Account: nothing is created on the server and no turn is sent. `openConsole`'s park PATCHes `simpleChatList: false`; the probe reads the stored value before it and restores it after `browser.close()`.
- Ends `<n> states photographed, every check passed` (exit 0), else `FAILED (<n>)` (exit 1).
- 2026-09-30: 266 `[ok]`, 0 FAIL, 70 shots (68 fixture + 2 live), on the version before the live check moved to a pin. The pinned version is `node --check`ed, not run.
- 2026-10-10: the `fades` checks (`carriedRowOpacity` / `carriedBlockOpacity` 0.5) read a fade `SidebarSimpleListItems` no longer draws (a carried item is lifted by the kit's carry, `data-carried`: MAN-8139); they fail until the probe reads the lift instead.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSimpleFolderPicker.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSimpleFolderRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSimpleListItems.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSimpleListRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSimpleList.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-simple-folders.mjs

## MAN-7524 — The simple list's feed hook — useSimpleChatList holds the tree

`src/modules/sidebar/hooks/useSimpleChatList.ts`: the paginated, server-tagged feed behind `SidebarSimpleList` and `SidebarSessionPicker`. Signature `useSimpleChatList(selectedSessionId: string | null, enabled = true)`. The list: MAN-661. Feed route and frame: MAN-7519. Types: MAN-7514. Tree functions: MAN-7520. Removal fan-out: MAN-7507.

## State
- `items: SimpleListItem[]` is the one piece of feed state; every local edit goes through a `simpleChatTree` function (MAN-7520). why: one home per edit, no second list to disagree.
- `rows` = `useMemo(() => flattenChats(items), [items])`: every chat, flat, in drawn order, a folder's chats in the folder's place. The picker lists it; "is the open chat loaded" asks it.
- `total`, `hasMore`, `isLoading`, `hasError`: server's counts and fetch flags.
- `total`, `loadMore`'s offset and `items.length` are in TOP-LEVEL rows: a folder counts once however many chats it holds.
- `enabled` false: no page fetched, no websocket subscription, no open-chat reload. Turning it on fetches page one.

## Return — twelve members
| Member | Is |
| --- | --- |
| `items` | top-level rows, server order: a loose chat, or a folder with its chats whole |
| `rows` | `flattenChats(items)` |
| `total`, `hasMore`, `isLoading`, `hasError` | as above; `isLoading` is true only while a non-append fetch is in flight |
| `reload()`, `loadMore()` | see Paging |
| `patchLocal(sessionId, { sessionTitle?, icon? })` | `patchChat`; `unread` is outside the patch type: the server's answer to a finished run, never a guess |
| `patchFolderLocal(folderId, { name?, collapsed? })` | `patchFolder` |
| `removeLocal(sessionId)` | fan-out to every mounted instance (MAN-7507) |
| `moveLocal(item: SimpleListItemRef, position: SimpleListPosition)` | `moveItem`; the same tree when the row, folder or anchor is not in it, so a missing anchor never means "the top" |

## Paging
Request: `api.recentConversations({ limit, offset, simpleList: true })`; answer `{ conversations, layout, total, hasMore }`; page = `treeFromFeed(conversations, layout ?? [])`.

| Call | `offset`, `limit` | Effect on `items` |
| --- | --- | --- |
| first fetch (mount, or `enabled` turning on) | `0`, `PAGE_SIZE` = 20 | replaces |
| `reload()` | `0`, `Math.min(MAX_RELOAD_ROWS, Math.max(PAGE_SIZE, items.length))` | replaces |
| `loadMore()` | `items.length`, `PAGE_SIZE` | `appendPage(previous, page)` |

- `MAX_RELOAD_ROWS = 100`: the feed route bounds `limit` at 1–100 and answers 400 above it. A list paged past 100 top-level rows reloads its first 100; the rest is one `loadMore` away.
- A replace discards every local write made since: re-reading the server's list is what settles them.
- `requestSeqRef`: a response older than the latest request is dropped.

## Reload triggers
| Trigger | Rule |
| --- | --- |
| `session_upserted` or `simple_list_changed` frame | one `reload()`, debounced `RELOAD_DEBOUNCE_MS` = 500 |
| open chat missing from `rows` | one `reload()` per `selectedSessionId` (`attemptedForRef`). why: a session outside the feed would loop forever |

## Optimistic writes
- `patchLocal`, `patchFolderLocal`, `moveLocal` show the change at once; the `session_upserted` / `simple_list_changed` reload confirms it.
- `useSimpleChatFolders.move(item, position)` (the composer's folder hook, `SidebarSimpleList.tsx`) calls `moveLocal(item, position)`, then `api.simpleList.move` (MAN-7514); a refusal or a failure is logged and answered with `reload()`.
- The live list draws the tree through `SidebarSimpleListItems`, with the folder verbs in `useSimpleChatFolders` (MAN-7528).

## Gate — `.verify/probe-simple-feed.mjs`
- `node .verify/probe-simple-feed.mjs` (dev app `127.0.0.1:5183`, dev API `127.0.0.1:3011`, Chromium through `openConsole`). Zero model turns. Gitignored; a `probe-*.mjs`, so `all.mjs` does not run it.
- Pins the list ON for its own page: `pinPreferences(… { simpleChatList: true }, { writes: 'drop' })`, then reloads. Reads the account's `simpleChatList` BEFORE `openConsole` (its park PATCHes `false`) and restores it AFTER `browser.close()`. why: a live page holds a local-first copy that would overwrite an earlier restore.
- Setup: one `probe-feed-<HHMMSS>` chat through the real `POST /api/providers/sessions`; the folder and the move go through the page's own `src/shared/api.ts` (`api.simpleList`).
- Counts every `recent?…simpleList=true` request the page makes.

| Gate | Proves |
| --- | --- |
| C1 | the chat's creation drew its row and moved a feed re-read (`session_upserted`) |
| C2 | `api.simpleList.createFolder('probe-folder')` → 201 with the minted id |
| C3 | the folder write moved a feed re-read (`simple_list_changed`) |
| C4 | `api.simpleList.move` of the chat into the folder → 200 echoing `item`, `folderId`, `after: null` |
| C5 | the move moved a feed re-read (`simple_list_changed`) |
| C6 | the feed's `layout` holds the folder with the chat's id in it |
| C7 | `[data-testid="simple-chat-row"]` ids equal the feed's `conversations` ids, the folder's chat among them |

- Cleanup in `finally`: `deleteFolder` (200 `{ released: 1 }`), `DELETE …/sessions/<id>?force=true` (200), browser closed, `simpleChatList` restored.
- Ends `SIMPLE-LIST-FEED PASS`, else `SIMPLE-LIST-FEED FAIL (<n>)` and exit 1.
- 2026-09-30: seven gates green; folder write → reload 528 ms, move → reload 663 ms; 9 drawn rows = 9 feed rows.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/hooks/useSimpleChatList.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-simple-feed.mjs

## MAN-7525 — The simple list's carry — `useSimpleChatDrag` and the pointer's reading of the drawn list

`src/modules/sidebar/hooks/useSimpleChatDrag.ts`: pointer-event carry for the simple list's folder tree. Press a chat row or a folder header, carry it, drop it; on release one `onMove(item, position)`. Module-private: no barrel export. The list: MAN-661. Tree functions and `positionForDrop`: MAN-7520. Types (`SimpleListItemRef`, `SimpleListDropTarget`, `SimpleListPosition`): MAN-7514. The components that draw the marks and spread `dragProps`: MAN-7523.

## Wiring
- 2026-09-30: live. `SidebarSimpleList.tsx` calls `useSimpleChatDrag({ items, onMove: move })`, `move` being `useSimpleChatFolders`' (MAN-7528); `.verify/probe-simple-folder-composer.mjs` drives the carry on the mounted tree, `.verify/probe-simple-drag.mjs` at the hook level.
- Why pointer events, not the browser's drag-and-drop: DnD never fires from a touch screen and this list is used on a phone.
- Size: 244 LOC (`wc -l`, 2026-10-10). `chatTargetAt` / `folderTargetAt` and the DOM readers under them live in `src/modules/sidebar/utils/simpleChatDropTarget.ts` (153 LOC), which reads every row and block as laid out (`layoutRectOf`, transform taken off), because the carried row is drawn under the pointer by a transform.
- 2026-10-09: the press-to-carry runs on the kit's `usePointerDrag` (kind `sort`), the mechanism the sortable lists lift on. A finger carries after holding still for `TOUCH_HOLD_MS` (400 ms, `src/shared/constants.ts`, shared with `useSortable`) anywhere on a row or header that is not a control; one that moves first is scrolling the list and lifts nothing. A mouse carries after 5 px, as before. Operator: "Can we fix drag and drop on mobile to be hold then drag on the chat please".
- 2026-10-10, hold and drag in one motion: on a touch screen the rows are `touch-action: none` from the first touch (the `data-touch-pan` marker, `surfaces.css`), and a swipe that starts on a row, or on a control inside one, scrolls the pane by the page's own hand (`usePointerDrag`'s `scrollsPane`, `sortable/touchPan.ts`: MAN-8136). why: the operator's Galaxy Z Fold 8 dispatches every touch sequence uncancelable (`touchmove cancelable=false`), so the pane's `touchmove` canceller held nothing: the browser panned and sent `pointercancel` at the first move past the slop after the lift, and the row faded and went back. `touch-action` is the one lever the browser reads before the touch. Why the dispatch is uncancelable there is not established (the browser's policy, the device, or a busy dev build); the cure does not depend on it. Operator: "Hold and drag, one motion".

## Signature
`useSimpleChatDrag({ items, onMove })`

| In | Is |
| --- | --- |
| `items: SimpleListItem[]` | the tree; read through a ref at release |
| `onMove(item: SimpleListItemRef, position: SimpleListPosition)` | read through a ref at release |

| Out | Is |
| --- | --- |
| `dragging` | `SimpleListItemRef \| null`: the carried row, set once the carry lifts (a mouse past the threshold, a finger after the hold) |
| `dropTarget` | `SimpleListDropTarget \| null`: where the pointer says it would land; re-rendered only when the target changes |
| `dragProps` | one `SimpleListDragProps` object (`src/shared/types.ts`: `onPointerDown`, `onClickCapture`, `onDragStart` and the kit's `data-hold-lift` and `data-touch-pan` markers), the same for every row; spread on every chat row and folder header (assigns to `SidebarSimpleListItems`' `dragProps`). The row a press lands on is read off the row's own `data-session-id` / `data-folder-id` |
| `listRef` | ref object for the list's root (`SidebarSimpleList` puts it on `simple-chat-list`): where the pointer's capture goes at the lift, and nothing else. The list registers no `touchmove` canceller: its rows are `touch-action: none` from the first touch on any device that has a coarse pointer at all (`@media (any-pointer: coarse)`, so a touch laptop whose primary pointer is a mouse is covered too), so the browser has no pan to take. A device with no touch screen has no finger to hold still |

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/hooks/useSimpleChatDrag.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/sortable/touchLift.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-simple-drag.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/simple-list-hold-to-drag-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/simple-list-hold-to-drag.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/simple-list-hold-to-drag-scratch.sh

## MAN-8139 — The simple list's carry — `useSimpleChatDrag` and the pointer's reading of the — Gesture
section: The simple list's carry — `useSimpleChatDrag` and the pointer's reading of the drawn list/001 Gesture

| Rule | Is |
| --- | --- |
| threshold | mouse and pen: `DRAG_THRESHOLD_PX = 5`, less travel is a click |
| hold | touch: `TOUCH_HOLD_MS` (400 ms) held still lifts the row; a finger that drifts past the kit's slop first is scrolling: from that move on the page scrolls the pane by hand (`scrollsPane`; see the pan row), and nothing lifts. The kit's `tickLift()` pulses 20 ms where the device can (Android's own long-press buzz; an iPhone and a phone on silent get none). The `contextmenu` and `selectstart` a long-press raises are cancelled while a hold is pending or lifted, and `surfaces.css` keeps the platform's callout and selection off every handle from the first touch (`data-hold-lift`, touch screens only) — an iPhone sends no `contextmenu` to cancel |
| press guards | primary button only (the kit); in `accept`: a press that landed outside the row's own DOM is refused (React bubbles a press from a portal — the row's open action menu — through the tree to the row), and so is a press inside `button, input, [data-no-drag]`, which stays that control's: it never lifts, but a swipe that starts on it still scrolls the pane (the kit takes a refused press as a pan on a list that scrolls by hand). The three status marks in the chat row (`simple-chat-awaiting-input`, `-running`, `-subagents-running`) carry `data-no-drag`: each sits in a `Tooltip` that opens on a 350 ms touch hold, and the 400 ms carry must not lift the row under it |
| one press | a press while another gesture runs is ignored by the kit, so a second finger never changes which row is lifted |
| lifted row | the kit's carry (`shared/ui/sortable/carried.ts`, the copy `useSortable` runs): at the lift the pressed chat's row, or a folder's whole block, is taken up (`takeUp`: `data-carried`, above its neighbours, backed with an opaque ground) and follows the pointer up and down (`placeUnder` with a null x: on the list's rail), on every move and when the pane scrolls. Its slot stays as the gap. Verve draws `data-carried` as `--shadow-lift` plus a `--border-strong` hairline. At release the list is committed in one `flushSync` and the row slides from where it was drawn to its place (`putDown`; nothing slides under `prefers-reduced-motion`); a cancel or Escape slides it back |
| carry start | the text selection is cleared (`removeAllRanges`); `body` wears `vv-dragging vv-drag-sort` for the carry, which also keeps iframes from swallowing it |
| capture | the pointer is captured on the LIST's root at the lift (`captureOnStart`; the root arrives through `listRef`), never at the press, so a tap still reaches the row's link and fold toggle, and never on the row, because `:hover` follows the capture and a captured row would keep its hover wash for the whole carry |
| edge scroll | `useCarryEdgeScroll` (`hooks/useCarryEdgeScroll.ts`): from the lift, every animation frame while the pointer rests in the pane's top or bottom 56 px zone, the pane (`scrollerOf` the list root) scrolls a step toward that edge and the target is read again under the still pointer. Step and zone are the kit's own `edgeStep`, `edgeHoldAt` (`shared/ui/sortable/motion.ts`), the ones `useSortable` runs on; a carry that began in a zone does not run toward it until the pointer has left it. A page that scrolls as a whole has no pane to run. A pane scrolled by any means (a wheel) re-places the row and re-reads the target, and the row is re-placed every frame. The lifted row is PAINTED INSIDE THE LIST'S OWN BOX (`placeLifted`): it never leaves its slot, so a row painted below the list's end would extend the pane's scrollable overflow with every pixel scrolled and the loop would never end. Ended at release, at Escape and on unmount |
| release | `pointerup` ends the gesture and commits |
| abandon | `Escape` (a keydown listener present while a row is carried) puts the row back at once and commits nothing; `pointercancel` after a lift commits nothing |
| click | a carry's release is followed by a swallowed click (`onClickCapture`: `preventDefault` + `stopPropagation`); a keyboard click (`detail === 0`) passes; the next `pointerdown` disarms the swallow before its guards run |
| pan | touch, a swipe that crosses the slop before the hold fires (anywhere on a row or header, controls included): the kit's `sortable/touchPan.ts` scrolls the list's pane (`scrollerOf` the row) one to one with the finger from the move that crossed the slop, delta-driven and clamped at the pane's own ends, so a finger dragged past an end and turned back scrolls back at once. At the lift the finger's speed over the last 100 ms carries on and brakes at a constant 2800 px/s² (so a flick of 500, 1000, 2000 and 4000 px/s travels about 45, 179, 714 and 2857 px; Android's own fling, worked from its published constants, 58, 194, 647 and 2157; headless Chromium's, measured, 47, 189, 758 and 3030; at most 8 px/ms to start) and stops at an end. `GLIDE_DECELERATION` in `touchPan.ts` is the one constant to retune. A new touch anywhere stops the glide, and the click it would end in is spent; so is the tail click of a pan. The rows are `touch-action: none` at rest (`data-touch-pan`, wherever a coarse pointer is present: `@media (any-pointer: coarse)`), so the browser takes nothing; a device with no touch screen is unchanged. The pane's end is its own `scrollHeight`, which is the list's end because the carried row is painted inside the list's box (`placeLifted`) |
| native drag | `onDragStart` is `preventDefault`ed |

## Commit
- On release after a carry: `positionForDrop(itemsRef.current, carried, target)` (MAN-7520); `onMove` fires only for a non-null answer. A drop that changes nothing prints nothing.
- No target is never a move.

## DOM contract (selectors the hook reads)
| Selector | Is |
| --- | --- |
| `[data-testid="simple-chat-list"]` | list root; absent ⇒ no target |
| `[data-testid="simple-chat-row"]` + `data-session-id` | a chat row → `{ kind: 'chat' }` |
| `[data-testid="simple-chat-folder"]` + `data-folder-id` | a folder header → `{ kind: 'folder' }` |
| `[data-testid="simple-chat-block"]` + `data-item-kind` (`chat` \| `folder`) + `data-item-id` | one top-level row's block |

- The target comes from the boxes the list draws, never from the tree: drawn order is what the reader sees.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/hooks/useCarryEdgeScroll.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/hooks/useSimpleChatDrag.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-simple-drag.mjs

## MAN-8140 — The simple list's carry — `useSimpleChatDrag` and the pointer's reading of the — Target — carrying a chat (`chatTargetAt`)
section: The simple list's carry — `useSimpleChatDrag` and the pointer's reading of the drawn list/002 Target — carrying a chat (`chatTargetAt`)

Scan: every row and header under the root, in document order, carried row included — each read as laid out (`layoutRectOf`), so the carried row, drawn under the pointer by a transform, is measured at its own slot. `over` = the last whose top edge is at or above the pointer (the gap between two rows belongs to the row above). `drawnBelow` = some row begins below the pointer.

| Pointer | `dropTarget` |
| --- | --- |
| above the first drawn row | `{ at: 'row', item: <first drawn>, edge: 'before' }` |
| `over` is the carried row, and not (`!drawnBelow` and pointer below the list root's box bottom) | `{ at: 'row', item: <carried>, edge: 'before' }` ⇒ `positionForDrop` null ⇒ no move |
| `over` is the carried row, `!drawnBelow`, pointer below the list root's bottom | `{ at: 'end' }` |
| `!drawnBelow` and pointer below `over`'s bottom | `{ at: 'end' }` |
| `over` a chat row | `{ at: 'row', item, edge }`: `before` above the row's middle, else `after` |
| `over` a folder header | top quarter: `{ at: 'row', item: folder, edge: 'before' }`; the rest: `{ at: 'into', folderId }` |

- Own place is named by the carried row's own `before` edge. why: `positionForDrop`'s `refAbove` skips the carried row and answers the row above it in its own container, which is the position the row holds now. Dropping the carried row from the scan hands the pointer to the next row, a top-level one when the carried row is a folder's last chat, and a press-release inside it reads as a lift out of the folder.
- The end boundary for a carried last drawn row is the list root's box bottom, not the row's bottom edge. The row's own box, the gap under it and the list's padding tail all stay own place; past the root the row can be carried to `end` (the last chat of a last open folder reaches `{ folderId: null, after: <last top-level row> }`). Moving the boundary to the row's edge breaks drag 8 of the gate.

## Target — carrying a folder (`folderTargetAt`)
- Candidates: every `simple-chat-block` except the carried folder's own, in document order; none ⇒ no target.
- Chosen: the first whose bottom edge is at or below the pointer; the last when the pointer is past all.
- `{ at: 'row', item: <block's ref>, edge }`: `before` above the block's middle, else `after`.
- Never `end`, never `into`: a folder lives at the top level, and past the last block the last block with `after` maps to the same place as `end`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/hooks/useSimpleChatDrag.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-simple-drag.mjs

## MAN-8141 — The simple list's carry — `useSimpleChatDrag` and the pointer's reading of the — Gate — `.verify/probe-simple-drag.mjs`
section: The simple list's carry — `useSimpleChatDrag` and the pointer's reading of the drawn list/003 Gate — `.verify/probe-simple-drag.mjs`

- `node .verify/probe-simple-drag.mjs` (dev server `127.0.0.1:5183`, signed in through `openConsole`, 1440×900). Gitignored; not a `phase-*.mjs`, so `all.mjs` does not run it. Zero model turns; creates nothing on the server. `CARRY_PROBE_APP_URL=<scratch client>` points it, `athena-carry-endzone.mjs`, `athena-carry-ownplace.mjs` and `probe-simple-folders.mjs` at a scratch client instead (`mountReact.mjs` reads React's URLs off the page's own entry module), and then no preference of the live account is read, parked or restored.
- Fixture: `lib/mountReact.mjs` mounts a component that calls the hook over a literal tree (loose `a1`, `a2`; open `f1[c1, c2]`; open `f2[e1]`), drawn as plain elements with the test ids and data attributes above, `dragProps` spread on every row and header. Drags are real (`page.mouse.down` / `move` / `up`). The hook's own `dragging` / `dropTarget` are rendered into the host and read while the button is still down.
- Account: reads `simpleChatList` through the API BEFORE `openConsole` (its park PATCHes `false`), restores it AFTER `browser.close()`.
- Artifact: `.verify/artifacts/simple-drag.json`.

| Drag | Carried → aim | `dropTarget` | `onMove` |
| --- | --- | --- | --- |
| 1 | `a1` → header `f1`, 60% down | `into` `f1` | `{ folderId: 'f1', after: null }` |
| 2 | `a2` → header `f2`, 5% down | `row` `f2` `before` | `{ folderId: null, after: folder f1 }` |
| 3 | `a1` → row `c1`, 95% down | `row` `c1` `after` | `{ folderId: 'f1', after: chat c1 }` |
| 4 | `c1` → 30px below `e1` | `end` | `{ folderId: null, after: folder f2 }` |
| 5 | `a2` → its own row, 95% down | `row` `a2` `before` | none |
| 6 | folder `f1` → block `f2`, 95% down | `row` `f2` `after` | `{ folderId: null, after: folder f2 }` |
| 7 | `c2` (last of an open folder) → inside its own row | `row` `c2` `before` | none |
| 8 | `c2` → 3px below its own box | `row` `c2` `before` | none |
| 9 | `e1` (last of the last folder) → inside its own row | `row` `e1` `before` | none |

- Each drag also checks `dragging` and `dropTarget` are `null` after release.
- Ends `SIMPLE-DRAG PASS`, else `SIMPLE-DRAG FAIL` (exit 1); a signed-in console error also fails.
- 2026-09-30: 9 of 9 PASS, exit 0. 2026-10-09, on the `usePointerDrag` engine and a scratch client: 9 of 9 PASS.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/hooks/useSimpleChatDrag.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-simple-drag.mjs

## MAN-8142 — The simple list's carry — `useSimpleChatDrag` and the pointer's reading of the — Gate — the hold on a phone, `.verify/simple-list-hold-to-drag.mjs`
section: The simple list's carry — `useSimpleChatDrag` and the pointer's reading of the drawn list/004 Gate — the hold on a phone, `.verify/simple-list-hold-to-drag.mjs`

- `SUNSET_SLOT=7 bash .verify/simple-list-hold-to-drag-scratch.sh` stands up a SCRATCH API on a copy of the database, seeds 14 top-level rows (12 loose chats, 2 folders holding 3 chats), serves the client as git HEAD has the files in `SLHD_CHANGED_FILES` (`before`) and as it is (`after`), runs the proof against each and tears everything down. The proof refuses the live app (:5183, :5184, :3011) and a list that is not the seeded one, and puts the list back after every leg. Artifacts: `.verify/artifacts/simple-list-hold-to-drag/` (`before.json`, `after.json`, a rest shot and a mid-carry shot per desktop/mobile × dark/light).
- Phone (390×844, real touch): T1 hold a chat's title past 400 ms, slide it below another chat, let go — the chat lands there and the SERVER's order says so; T2 the same from a folder's header; T3 a quick vertical swipe from a row's title scrolls the list and lifts nothing; T4 the same from a row's icon (before the change this lifted the row and refused to scroll); T5 hold a row still and let go — nothing moves and the chat stays shut (before: it opened); T6 tap opens the chat. Desktop (a real mouse): M1 a chat carried, M2 a folder carried, M3 a click opens the chat — the same server orders before and after.
- `.verify/lib/touch-input.mjs`: `openFinger(page)` → `{ down(point), slide(point, { stepPx, stepDelayMs }), up(), tap(point), close() }`, one finger over CDP `Input.dispatchTouchEvent`; the context needs `hasTouch: true`. why: `page.touchscreen` only taps, and a `TouchEvent` dispatched inside the page skips the browser's gesture recogniser, so neither shows a scroll begin or be refused.
- A `before` run only records (28 of 73 checks fail, by design); an `after` run exits 1 on any failure. 2026-10-09: after 75 of 75 PASS. The one console line it allows is the 404 the seeded chats' own `token-usage` returns when opened (they have no transcript).
- 2026-10-10, hold-then-drag made reliable and readable: the stack and its fixtures live in `.verify/lib/simple-list-stack.sh` (`SLHD_CHANGED_FILES`: the files the latest change touched, which the "before" client serves as git HEAD has them; rewritten with each change) and the page helpers in `.verify/lib/simple-list-scratch.mjs` (`restore()` also unfolds the seeded folders: a collapsed folder draws no chats, and every leg's "page order equals server order" would fail without a hint of why); both gates use them. `bash .verify/simple-list-hold-reliable-scratch.sh` runs on that stack, in turn: `simple-list-hold-reliable-trace.mjs` (Chromium, real CDP touch, 390 px: holds of 0.45 / 0.7 / 1.2 / 2.5 s then 120 px over 300 ms, a 3 px drift, a 12 px early move, a swipe, a tap — each with its event trace: `pointercancel`, `contextmenu`, `selectstart`, and whether each `touchmove` was cancelable and prevented; an `after` run exits 1 unless every case is as written), `simple-list-hold-reliable.mjs`, this gate again, and `probe-card-order.mjs`.
- `simple-list-hold-reliable.mjs` (`lib/carry-read.mjs` reads the page, `lib/sortable-fixture.mjs` mounts the real `useSortable`; artifacts under `.verify/artifacts/simple-list-hold-reliable/`): phone and desktop, light and dark — the lift shows at the hold (`data-carried`, an elevation), mid-carry the item stands under the pointer and away from its slot, is unfaded and opaque, and its box paints its own backing with nothing of the rows beneath showing through; the landing mark is a painted pixel of a screenshot where the carried item is drawn over it; drop, cancel (CDP `touchCancel`), hold-still, Escape and the rename box; nothing left on the page (no `data-carried`, no inline marks, no `vv-dragging`); WebKit at rest (`-webkit-user-select: none` computed on the row, link and folder header of a touch-emulated phone; the served rule carries `-webkit-touch-callout: none`, which a Linux WebKit drops at parse time and cannot compute); desktop selection equal to the `before` record; the kit's sortable list on the real hook drops the same card the same way before and after. 2026-10-10 on the scratch stack: 91 checks pass (run before `placeLifted`'s clamp and `onFrame`; neither gate has run since).
- Measured 2026-10-10, Chromium with real CDP touch: every hold from 0.45 s to 2.5 s lands the drop, with no `pointercancel`, `contextmenu` or `selectstart`, before and after. Headless Chromium does not emulate the platform's long press (a held plain link raises no `contextmenu`, no selection begins), so Android's 400 ms touch-and-hold, its 20 ms buzz, an iPhone's link callout and a fling's uncancelable touches are NOT reproduced by any run here.
- Edge scroll: the carried row is painted inside the list's own box (`useSimpleChatDrag` `placeLifted`). The row never leaves its slot, so a row painted below the list's end extends the pane's scrollable overflow with every pixel it scrolls, and the edge loop (`useCarryEdgeScroll`) finds no end. `useCarryEdgeScroll` also reports a scroll of the pane by any means (a wheel) and calls `onFrame` every frame, so the row stays under a resting pointer. 2026-10-10, 3 s with the finger at the pane's bottom edge: the list stops at its grown limit (386 → 392); before the clamp it ran to ~1500 and snapped back at release.
- Not proven: any real phone. `probe-card-order.mjs` is stale against the current app (its project selector matches no row and the sidebar no longer has a Runner tab), on the pre-change client alike.
- `.verify/simple-list-hold-to-drag-live.mjs` is the read-only look at the live list (no press, no touch, nothing written): it reads that the drawn list carries no `data-drag-handle` and no `.touch-none`, that rows exist, and that the page logs no error.
- 2026-10-10, hold and drag in one motion: `STAGE=before|after|all SUNSET_SLOT=8 bash .verify/simple-list-one-motion-scratch.sh` runs `.verify/simple-list-one-motion.mjs` on that stack — Chromium with real CDP touch at 390 px and at 690 px (a Fold's inner screen, `FOLD_SCENARIO` in `lib/simple-list-scratch.mjs`), each twice: the touch dispatched UNCANCELABLE (`lib/phone-uncancelable.mjs`: an init script wraps `EventTarget.prototype.addEventListener` so every `touchstart`/`touchmove` listener is passive; Chrome then refuses the page any cancel once the pan starts, as on the operator's Fold — the headless `touchstart` itself still reports `cancelable=true`, where the phone reported `false`) and blocking (headless default). Legs in `lib/one-motion-legs.mjs` and `lib/one-motion-others.mjs`, reads in `lib/one-motion-reads.mjs`. BEFORE (git HEAD), uncancelable: a 0.5 s hold and drag lifts, then a `pointercancel` arrives at the first move past the slop, the row goes back and nothing drops; blocking passes, which is why every earlier gate passed. The flick legs lift at once and check the glide against `speed²/2a` (`GLIDE_DECELERATION`, mirrored in `lib/one-motion-legs.mjs`), not a bare floor; `touchLaptopLeg` runs a finger on a 1280 px page whose primary pointer is a mouse (`any-pointer: coarse`, `pointer: fine`) and expects the rows `touch-action: none` and the drop to land. 2026-10-10 on the scratch stack: 281 checks pass, run before the constant-deceleration glide, the speed-based flick check and `touchLaptopLeg` existed; none of those three has run. Not measured: a real phone, the glide's distance against the phone's own.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/hooks/useSimpleChatDrag.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/utils/simpleChatDropTarget.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/sortable/carried.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/carry-read.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/simple-list-scratch.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/simple-list-stack.sh, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/sortable-fixture.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/touch-input.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/simple-list-hold-reliable.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/simple-list-hold-reliable-scratch.sh, /home/lyphe/.claude/claudecodeui_lyphe/.verify/simple-list-hold-reliable-trace.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/simple-list-hold-to-drag-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/simple-list-hold-to-drag.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/simple-list-hold-to-drag-scratch.sh

## MAN-7528 — The simple list's folder verbs — `useSimpleChatFolders`, the composer `SidebarSimpleList` and its walk

`src/modules/sidebar/hooks/useSimpleChatFolders.ts` owns the simple list's folder verbs; `src/modules/sidebar/SidebarSimpleList.tsx` composes it with the feed, the carry, the disposals and the tree. Module-private: no barrel export. The list: MAN-661. Feed hook: MAN-7524. Carry: MAN-7525. Tree components and their test ids: MAN-7523. Types and `api.simpleList`: MAN-7514.

## `useSimpleChatFolders` — signature
`useSimpleChatFolders({ items, reload, patchFolderLocal, moveLocal, t })`

| In | Is |
| --- | --- |
| `items: SimpleListItem[]` | the tree as the feed holds it: which folders exist, where a chat sits now |
| `reload: () => Promise<void>` | `useSimpleChatList`'s re-read; the floor every refused or failed write falls back to |
| `patchFolderLocal(folderId, { name?, collapsed? })` | the optimistic write behind rename and fold |
| `moveLocal(item, position)` | the optimistic write behind a move |
| `t: TFunction` | a new folder is born named `t('simpleList.newFolder')` |

| Out | Is |
| --- | --- |
| `freshFolderId`, `onFreshShown()` | the folder just made, or null; the header opens its rename input once, then calls `onFreshShown` (MAN-7523) |
| `pickerChat`, `pickerFolderId` | the chat whose "Move to folder…" dialog is open (null = closed); the folder that chat sits in, derived from `items` by `useMemo` (null = top level) |
| `pendingDeleteFolder` | the folder whose delete waits on a yes, or null |
| `createFolder()` | `api.simpleList.createFolder(t('simpleList.newFolder'))`; on `ok` reads `data.folderId`, `await reload()`, then sets `freshFolderId`. why: the fresh header must be mounted before the id is named. A failure is logged and answered with `reload()` |
| `renameFolder(folderId, name)` | `patchFolderLocal` then `api.simpleList.updateFolder(folderId, { name })` |
| `toggleFolder(folder)` | `patchFolderLocal` then `updateFolder(folderId, { collapsed: !folder.collapsed })` |
| `requestDelete(folder)` | `folder.chats.length === 0` ⇒ deleted at once; else sets `pendingDeleteFolder` |
| `confirmDelete()`, `cancelDelete()` | delete `pendingDeleteFolder` (clearing it first) / clear it |
| `openFolderPicker(chat)`, `closeFolderPicker()` | set / clear `pickerChat` |
| `moveToFolder(folderId \| null)` | the picker's answer; see Picker answers |
| `move(item, position)` | the carry's `onMove`: `moveLocal(item, position)` then `api.simpleList.move(item, position)` |

## Write rule
- `renameFolder`, `toggleFolder`, `move`: optimistic. The route is asked after the local write; a non-`ok` answer or a throw is logged (`[SidebarSimpleList] Failed to …`) and followed by `reload()`.
- `createFolder`, folder delete: not optimistic. The route first, then `reload()` (a delete always reloads, a failure logged first).
- A `reload()` replaces `items` (MAN-7524 §Paging), so it undoes every local write the server did not take.

## Picker answers — `moveToFolder`
Closes the dialog first, then:

| Pick | Write |
| --- | --- |
| folder F | `move({ kind: 'chat', id }, { folderId: F, after: null })`: first in F, under its header |
| none, chat in folder G | `move(ref, { folderId: null, after: { kind: 'folder', id: G } })`: top level, directly under G |
| none, chat already top level | no write |

## `SidebarSimpleList` — wiring
- Props: `projects`, `selectedProject`, `selectedSession`, `onProjectSelect`, `onSessionSelect`, `onNewSession`, `onSessionRemoved`, `onRenameSession`, `t`.
- `useSimpleChatFolders({ items, reload, patchFolderLocal, moveLocal, t })`; `useSimpleChatDrag({ items, onMove: move })`: a drop and a "Move to folder…" are one write path.
- `confirmDelete` / `cancelDelete` from the folder hook are aliased `confirmFolderDelete` / `cancelFolderDelete`: `useSimpleChatRemove` returns the same names.
- `folders` = the `kind: 'folder'` items of `items`, drawn order; it feeds `SidebarSimpleFolderPicker`.
- `onMoveToFolder` = `null` while `folders.length === 0`, else `openFolderPicker` (no row offers "Move to folder…" until a folder exists).

| State | Draws |
| --- | --- |
| `hasError && items.length === 0` | the load-failed text and Try again; no New folder |
| `!isLoading && items.length === 0` | `simple-chat-empty`, the New chat pill, New folder |
| otherwise | `simple-chat-list-rows` (`select-none` while `dragging !== null`): `SidebarSimpleListItems`, the New chat pill, New folder, `simple-chat-load-more` when `hasMore` |

- New folder = `simple-chat-new-folder`, `t('simpleList.newFolder')`: the one way a folder is born.
- Five dialogs: stop, delete, icon picker, `SidebarSimpleFolderPicker`, and a `ConfirmDialog` for a folder delete (`simpleList.folderDeleteTitle`, `simpleList.folderDeleteBody`; Cancel `actions.cancel`, destructive `simpleList.folderDelete`).
- Size: 2026-09-30, `SidebarSimpleList.tsx` 298 LOC and `useSimpleChatFolders.ts` 220 LOC against the 300 default; the next addition to the composer wants an extraction, not an append.

## Gate — `.verify/probe-simple-folder-composer.mjs`
- `node .verify/probe-simple-folder-composer.mjs` (dev app `127.0.0.1:5183`, dev API `127.0.0.1:3011`, Chromium through `openConsole`); `DARK=1` runs the same walk in the dark theme. Zero model turns. Gitignored (`.verify/`); not a `phase-*.mjs`, so `all.mjs` does not run it.
- Fixture: three chats through `POST /api/providers/sessions` (`simpleList: true`), named `probe-list-1..3`; the app is told `probe-list-1` waits on the reader (a `/sessions/running` stub with `awaitingInputSessionIds`), so the folder's dot has one possible mark. The list is pinned on for the page (`pinPreferences(… { simpleChatList: true }, { writes: 'drop' })`), PATCHed on, reloaded. Every gesture is `page.mouse` or a real click; the folder is made by the page's own New folder button, named `probe-list-folder`.
- Account: `simpleChatList` is read BEFORE `openConsole` (its park PATCHes `false`) and restored AFTER `browser.close()`. why: a live page holds a local-first copy that would overwrite an earlier restore.
- Cleanup in `finally`: each chat `DELETE …/sessions/<id>?force=true`, any leftover folder deleted by id, browser closed, preference restored.
- Artifact `.verify/artifacts/simple-folder-composer.json` (`-dark.json` under `DARK=1`): `{ sessionIds, folderId }`, rewritten as each is created. Shots `.verify/shots/simple-folder-composer-{1440,390,delete-dialog}-<light|dark>.png`.

| Step | Gate |
| --- | --- |
| S1 New folder | click `simple-chat-new-folder`; the folder is the first block, open (`data-collapsed="false"`), no dot; its `simple-chat-folder-rename-input` opens with the whole name selected (`selectionStart === 0`, `selectionEnd === length > 0`); the app's own `scrollIntoView({ block: 'nearest' })` fires on the `simple-chat-folder` root (the probe wraps `Element.prototype.scrollIntoView` before the click); typed name + Enter ⇒ POST `…/simple-list/folders` 201, PATCH `…/folders/<id>` 200 carrying `"name":"probe-list-folder"` |
| S2 drag in | `probe-list-1`'s row carried to 60% down the header; the header wears `ring-2` while held; released, the row sits inside the folder's block; PUT `…/simple-list/position` 200 carrying `item` chat id, `folderId`, `after: null` |
| S3 fold | press `simple-chat-folder-toggle`; `data-collapsed="true"`, the nested row leaves the page; exactly one `simple-chat-folder-dot`, `data-mark="awaitingInput"`; PATCH 200 carrying `"collapsed":true` |
| S4 reload | the folder first, same id, folded, dot `awaitingInput`; chats 2 and 3 drawn |
| S5 photographs | 1440 and 390 shots; at 390 the drawer is opened (`button[aria-label="Open menu"]`) if the header is hidden; the header is visible at 390 and again at 1440 |
| S6 delete | folder menu ⇒ "Delete folder" ⇒ `[role="dialog"][aria-modal="true"]` shot ⇒ its destructive "Delete folder"; the folder block is gone, `probe-list-1` is the first top-level block, and `GET …/sessions/recent?simpleList=true&limit=100` `layout` holds no entry for the folder |

- A failing step prints `[FAIL] Sn <reason with the observed value>`; later steps print "not reached".
- Ends `SIMPLE-FOLDER-COMPOSER PASS` (exit 0), else `SIMPLE-FOLDER-COMPOSER FAIL` (exit 1).
- 2026-09-30: 6 of 6 PASS, exit 0, light and dark, before the S1 selection and `scrollIntoView` gates were added; the probe with them is `node --check`ed, not run.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/hooks/useSimpleChatFolders.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSimpleList.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-simple-folder-composer.mjs

## MAN-7539 — Gate — .verify/probe-whole-folders.mjs: the folders' whole journey on :5184

The folders' whole journey on the operator's own surface. Parts: MAN-7536 (folders), MAN-7528 (the composer walk `probe-simple-folder-composer.mjs`).

## Gate — `.verify/probe-whole-folders.mjs`
- `node .verify/probe-whole-folders.mjs > /tmp/<dir>/run.log 2>&1` — redirect OUTSIDE `server`, `src`, `.verify`. why: W9 echoes the four old-door symbols; a transcript under those three is found by W9's own grep and turns it red.
- Target `http://127.0.0.1:5184` (`vite preview` of `.prod-client/builds/<stamp>`), not the dev client `:5183`. Precondition, the caller's check: `find src -newer .prod-client/.built -print -quit` prints nothing and `.prod-client/.building` is absent.
- Gitignored; not a `phase-*.mjs`, so `all.mjs` does not run it. Zero model turns, so the Haiku-probe rule binds nothing.
- One Playwright session, one context, two pages: desktop 1440×900 and phone 390×844 (drawer opened). The context pin `pinPreferences(… { simpleChatList: true }, { writes: 'drop' })` serves both; the phone's `/sessions/running` answer rides `context.route`, the same `runningStub()` as the desktop page's. The phone's main-frame navigation count is W1's "no reload" proof. Keep both properties in any edit.
- Fixture: four chats `probe-whole-1..4` through `POST /api/providers/sessions`; `-1` waits on the reader (`awaitingInputSessionIds`), `-2` carries a subagent; one folder born by the page's own New folder button, named `probe-whole-folder`, renamed `probe-whole-folder-two` in W8.
- Account: `simpleChatList` read BEFORE `openConsole`, restored AFTER `browser.close()` (MAN-7528's rule).
- Cleanup in `finally`: each chat `DELETE …/sessions/<id>?force=true`, the folder `DELETE` when `folderId` is still set, browser closed, preference restored. `.verify/artifacts/whole-folders.json` `{ sessionIds, folderId }` is the sweep list of an interrupted run.
- Shots `.verify/shots/whole-folders-{1-fresh,2-carried-in,3-carried-out,4-picker-in,4-under-folder,5-folder-moved,6-folded-1440,6-folded-390,7-picker-flat,8-reloaded,8-delete-ask,8-deleted}-light.png`.

| Step | Gate |
| --- | --- |
| W1 new folder | folder is the top block with its rename input open; typed name ⇒ POST 201, PATCH 200; the phone draws the name with 0 main-frame navigations |
| W2 two in by carry | PUT `…/simple-list/position` 200 into the folder (header middle), then `after` a nested chat; the folder's one dot is `awaitingInput` |
| W3 one out by carry | PUT 200 after a top-level row; the dot becomes `subagents` |
| W4 "Move to folder…" | picker in: PUT 200 `after: null`; picker out: PUT 200 `after` the folder; the chat lands directly under the folder; the way out is pressed+disabled on the folder's option |
| W5 folder carried | PUT 200 with `item.kind: 'folder'`; a folder's landing line is a plain `blockLine`, no `data-drop-edge`, and only the header wears `ring-2` for "into" — never gate a folder carry on those |
| W6 folded | BEFORE the fold the phone must draw the nested row inside the folder's block (count 1); PATCH 200 `collapsed:true`; the chat leaves both pages; one dot `subagents` |
| W7 picker flat | `session-picker-flat` lists every probe chat in the feed's own order, the folded folder's chat among them |
| W8 reload, rename, delete | reloaded folded, pathname still ends `/session/<id>`; rename PATCH 200; confirm dialog ⇒ DELETE 200; the held chat sits at the folder's old position; `layout` holds no entry for the folder |
| W9 old door | `PUT /api/providers/sessions/<id>/<old route>` ⇒ 404 `API_ROUTE_NOT_FOUND`; `grep -rn "<four symbols>" server src .verify` ⇒ stdout empty, exit 1 |

- The four symbols are built from parts (`OLD_SYMBOLS`); none appears as a literal in the file. Keep that in any edit to `stepOldDoor`.
- The fresh folder is found as "top block, a folder, rename input open", never `locator(FOLDER).first()`. why: a leftover folder would be taken.
- W8's `folderId` names the folder only until the wire shows the app's own `DELETE …/folders/<id>` answered 200; it is then nulled so `cleanup` does not re-DELETE (no spurious `HTTP 404`), and the later checks read `goneId`. Keep the two roles apart.
- The end prints `404 responses: [...]` by `METHOD path` for both pages.
- A failing step prints `[FAIL] Wn <reason with the observed value>`; later steps print "not reached".
- Ends `WHOLE-FOLDERS PASS` (exit 0), else `WHOLE-FOLDERS FAIL` (exit 1).

## Console 404 on a fresh chat
- `GET /api/providers/sessions/<id>/token-usage` answers 404 for a chat with no usage row; one fresh chat opened ⇒ one such 404 and one console error. Measured 2026-09-30 (`/tmp/heph-whole/see-404.mjs`, not kept).
- `chat-window-bindings-home.mjs` forgives exactly this shape for a scratch chat. A chat with usage showed 0.

## Record
- 2026-09-30: 9 of 9 PASS at 15:14, exit 0, against `.prod-client/builds/20260930-145821`. That run predates two gates: W6's phone before-picture and W8's pathname check. The standing file has not run.
- 2026-09-30: `node --check` OK on the standing file. Two page console 404s in that run: one is the mechanism above; the second is not attributed.
- Size: 940 lines, over the 800 ceiling; the split shape is by stage (setup, steps, cleanup plus wire helpers).

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-whole-folders.mjs

## MAN-7819 — The roadmap tree's layout — layoutTree, TreeLayout and the dot state (src/modules/roadmap/utils/treeLayout.ts)

What it is
`layoutTree(roadmap, goalText)` works out the roadmap tree's whole geometry once, in px at scale 1. Pure and `import type` only (`@/shared/roadmap-types`, `@/shared/types`): no React, no DOM, no i18n. Runs headless on the store's own document: `npx --no-install tsx --tsconfig tsconfig.json`.
Readers: `RoadmapTreeFace` calls it once per picture (memoised on the roadmap and the goal text) and hands the result to `RoadmapTree` and `useTreeWords` (MAN-7827); every tree node reads its spot. `TreePanel` (MAN-7840) is handed the layout, finds its item in it, and gives `EpicPanel` `dots` for its feature rows and `FeaturePanel` the item's own `state`.

Public API
| export | shape |
|---|---|
| `layoutTree(roadmap: Roadmap, goalText: string)` | -> `TreeLayout`; `goalText` is the label the goal draws (the goal or its "missing" words) |
| `TreeLayout` | `{ width, height, goal: { y, r, lines, baselines, bottom }, milestones: TreeMilestoneSpot[], dots: Map<string, RoadmapDotState> }` |
| `TreeMilestoneSpot` | `{ milestone, n, x, y, r, eyebrowY, titleLines, titleBaselines, lineY, spine: { x, top, bottom }, epics: TreeEpicSpot[] }` |
| `TreeEpicSpot` | `{ epic, x, y, r, tickTo, labelX, titleLines, titleBaselines, dots: TreeDotSpot[], lineY }` |
| `TreeDotSpot` | `{ feature, x, y, state: RoadmapDotState }` |
| `RoadmapDotState` (in `src/shared/types.ts`) | `'shipped' \| 'inFlight' \| 'designing' \| 'proposed' \| 'idea' \| 'blocked'`; `inFlight` is the word `in flight` as a key |

Rules
- `dots` is keyed by feature name; the tree and the panel's feature rows both read the dot state from it, so they cannot disagree.
- Dot state, in order: word `shipped` -> `shipped` whatever stands above it; else `feature.blocked ?? epic.blocked ?? milestone.blocked` not null -> `blocked`; else the word (`in flight` -> `inFlight`).
- A milestone's `x` is its ring's centre and its column's centre; the column's left edge is `x - 124`. Epic `x`, `y`, `r` are the epic ring's.
- `spine.bottom` is the last epic's `y`; `spine.top` when the milestone has no epic.
- Row bottoms and column ends are not exposed; derive them as `max(lineY + 3, y + 19)`.
- Columns: `width = max(400, 248 * milestones)`, centred in the width; one milestone sits at ring x 200, under the goal. Zero milestones: 400 wide, `height` = `goal.bottom + 8`.
- `height` = deepest column end + 8.
- `goal.bottom` = last goal baseline + 7; the connectors start there. An empty goal still reserves line 1, so `bottom` stays 52.
- Wrap limits count UTF-16 units: goal 48, milestone title 30, epic title 26. An emoji counts 2.
- Wrap: at most two lines; words pack greedily; a third line folds into the second. A line past the limit is cut to exactly the limit with `…` last (an overlong first word too).
- Cut that would land after a high surrogate steps back one unit: that line is one under the limit.
- A cut line is not trimmed: a cut after a space keeps it (`"… a …"`).
- Geometry numbers are named constants at the top of the file; change them there, nowhere else.

Measured
2026-10-06, `dispatcher roadmap show --json`:
| roadmap | size | dots = store features | scale at tab 1440x900 / widget 1680x1000 / tab 1680x1000 / tab 390x844 |
|---|---|---|---|
| Restorly | 744x614 | 38 = 38 | 0.821 / 0.876 / 0.948 / 0.678 |
| lyphecli | 744x443 | 39 = 39 | 1.000 / 1.000 / 1.000 / 0.940 |

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/utils/treeLayout.ts

## MAN-7827 — The roadmap tree — RoadmapTree, TreeGoal, TreeMilestoneNode, TreeEpicNode, TreeTip and treeWords (src/modules/roadmap/tree)

`RoadmapTree` draws one roadmap as an SVG tree from `layoutTree`'s layout (MAN-7819): the goal at the apex, a connector to each milestone's ring, under each a spine of epic rings with titles, feature dots and lines. Mounted by `RoadmapTreeFace` (MAN-7829). Marks, halos and moments: MAN-7828. Words: MAN-7634 (`roadmap.tree.*`).

Files
| file | exports | owns |
|---|---|---|
| `tree/RoadmapTree.tsx` | `RoadmapTree` | the pane, the svg, the fit, paint order, the memoised nodes |
| `tree/useTreeZoom.ts` | `useTreeZoom` | the zoom: its state, gestures, anchor and the scroll a zoom makes |
| `tree/TreeZoomControls.tsx` | `TreeZoomControls` | the +, −, Fit buttons in the wrapper's corner |
| `tree/TreeGoal.tsx` | `TreeGoal`, `TreeGoalConnectors` | the goal's flag ring and label; one connector per milestone |
| `tree/TreeMilestoneNode.tsx` | `TreeMilestoneNode`, `TreeMilestoneEdges` | a milestone's eyebrow, ring, title and line; its spine and ticks |
| `tree/TreeEpicNode.tsx` | `TreeEpicNode` | an epic's ring, title, dots, line and burst |
| `tree/TreeTip.tsx` | `TreeTip` | the tip chip |
| `tree/treeWords.ts` | `useTreeWords` | every item's words, for the tip and every `aria-label` |
| `tree/treeKeys.ts` | `selectionUnder`, `treeKeyOf` | the item a `data-tree-key` names, and the key an item's node carries |
| `tree/useTreePane.ts` | `useTreePane` | the pane's scroll: the goal's x, the opening, the selection scroll, the scale hold |
| `tree/TreeRing.tsx`, `tree/TreeHalo.tsx` | `TreeRing`; `TreeHalo`, `TreeDotCut` | the marks: MAN-7828 |

Props
`RoadmapTree({ roadmap: Roadmap, layout: TreeLayout, maxHeight: number | null, selected: RoadmapTreeSelection | null, onSelect(selection), paneRef: RefObject<HTMLDivElement> })`
- `RoadmapTreeSelection` (`src/shared/types.ts`): `{ kind: 'roadmap' } | { kind: 'milestone' | 'epic' | 'feature'; name: string }`. A name the picture no longer holds reads as nothing selected.
- `maxHeight`: `null` draws at natural size (column fit hands none). Viewport fit hands `useTreeRoom`'s room, `null` until it is measured (MAN-7829).
- `paneRef`: the tree's scroller, which the face hands `useMilestoneMomentInView` in viewport fit (column fit hands it the column's scroller).

Mount
- `RoadmapTreeFace` draws it under its picker row, with `TreePanel` under it, while the roadmap holds a milestone. It holds the selection (`pressedBy`: `useState<Record<string, RoadmapTreeSelection>>` keyed by roadmap name), resolves it against the picture each render with `holdsItem` (a name the picture no longer holds reads as nothing selected), and hands the tree `selected` and an `onSelect` that writes the entry of the roadmap on screen (column fit also brings the panel's head into view). A switch to the other roadmap and back returns to the item pressed there (MAN-7829).
- `layout` = `layoutTree(selected, selected.goal ?? t('roadmap.goal.missing'))`, memoised on `selected` and `goalText`.

Fit and pane
- `fitScale = clamp((maxHeight − 8) / layout.height, 0.6, 1)`; `maxHeight` `null` is 1. `scale = fitScale × zoom` (Zoom, below). svg `width`/`height` = layout × scale, `viewBox` the layout's, `mx-auto`.
- Pane `[data-roadmap-tree]`: `overflow-x-auto overscroll-x-contain scrollbar-thin touch-pan-x touch-pan-y -mt-1 pt-1`. `overflow-y-auto` + a max height while the 0.6 floor holds the scale or `zoom > 1`; else `overflow-y-hidden`. The max height is `maxHeight`, else (column fit) the drawing's height at the fit + 8, so a zoomed pane scrolls inside its own box and never pushes the panel away.
- why `-mt-1 pt-1` and svg `overflow-visible`: the goal's halo stands above the drawing and would be clipped flat.
- svg: `role="group"`, `aria-label` `roadmap.tree.label`, `select-none`. why: a double press must not highlight a title.
- Keep `overscroll-x-contain` (a sideways swipe past the end must not chain to the page's back gesture) and `select-none`.

Paint order and memo

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/RoadmapTree.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/TreeEpicNode.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/TreeGoal.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/treeKeys.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/TreeMilestoneNode.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/TreeTip.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/treeWords.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/TreeZoomControls.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/useTreePane.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/useTreeZoom.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-roadmap-tree-zoom.mjs

## MAN-7912 — The roadmap tree — RoadmapTree, TreeGoal, TreeMilestoneNode, TreeEpicNode — Edges in an `aria-hidden` group: `TreeGoalConnectors`, then each milestone's `TreeMilestoneEdges`.
section: The roadmap tree — RoadmapTree, TreeGoal, TreeMilestoneNode, TreeEpicNode, TreeTip and treeWords (src/modules/roadmap/tree)/001 Edges in an `aria-hidden` group: `TreeGoalConnectors`, then each milestone's `TreeMilestoneEdges`.

1. Edges in an `aria-hidden` group: `TreeGoalConnectors`, then each milestone's `TreeMilestoneEdges`.
2. `TreeGoal`.
3. Per milestone: `TreeMilestoneNode`, then each of its `TreeEpicNode`s. This is also the Tab order; epics are siblings of their milestone, never inside its button.
- The goal and its connectors take `goalX` as a prop; everything else is memoised on `layout`, `roadmap.current`, `selected` and the words function, so a scroll redraws only them.
- Nodes read `CelebrationContext` themselves, so the memo does not depend on it.

Markers
| attribute | on | holds |
|---|---|---|
| `data-tree-key` | goal `roadmap`; milestone `milestone:<name>`; epic `epic:<name>`; each dot's group `feature:<name>` | the one key a press reads off the nearest node |
| `data-roadmap-goal` | goal group | |
| `data-roadmap-milestone=<name>` | milestone group | `CelebrationLayer` (MAN-7636) measures its FIRST child, the ring's track circle, for the burst origin, and focuses the group when the moment ends: the ring is drawn first |
| `data-roadmap-epic=<name>` | epic group | |
| `data-roadmap-feature=<name>`, `data-roadmap-dot=<state>` | the visible dot circle | the dot, named by its feature |
| `data-celebrating` | milestone group `milestone`, epic group `epic`, dot `feature` or `task` | a moment names it |
| `data-selected` | node group, dot circle | the selected item |
| `data-tree-halo=ring\|dot` | halo circle | |
| `data-roadmap-tip` | tip chip | |
| `data-roadmap-zoom` | the zoom buttons' group | |

Nodes
- Goal, milestone and epic: `role="button"`, `tabIndex=0`, `aria-pressed`, `aria-label` = `<head> — <line>` from `useTreeWords`. A milestone is `aria-current="step"` while it is `roadmap.current`.
- A dot is not a tab stop; the keyboard reaches a feature through its epic's panel (MAN-7841).
- A dot is a group: an invisible hit circle (r 4, `[pointer-events:all]`) then the visible circle (r 2.8), which is the topmost element at its centre. A press on a dot names the feature, never its epic.
- A missing goal draws `roadmap.goal.missing` in italic muted.
- No node wears an outline: `outline-none focus-visible:outline-none`. why: `outline-none` alone loses to tokens.css's `[tabindex]:focus-visible` rule; the halo is the focus ring.

Words (`useTreeWords(roadmap, layout) → (item: RoadmapTreeSelection) => { head, line }`)
| item | head | line |
|---|---|---|
| goal | `roadmap.tree.goal` | the goal, else `roadmap.goal.missing` |
| milestone | `roadmap.tree.milestone` (`n`) + ` · ` + title | `roadmap.tree.epics` (`count`, `word`) |
| epic | title | `roadmap.tree.epicLine`, or the word alone while it holds no feature; + ` · ` + `roadmap.tree.blocked` while `epic.blocked` is not null |
| feature | title | feature word, `roadmap.feature.tasks` once it has a task, project; + ` · ` + `roadmap.tree.blocked` while its dot state is `blocked` |
| a name the picture lacks | `''` | `''` |
- Word maps: `ROADMAP_FEATURE_WORD_KEYS`, `ROADMAP_MILESTONE_WORD_KEYS`, `ROADMAP_EPIC_WORD_KEYS` (`src/shared/constants.ts`).
- A blocked milestone says no "Blocked" on the tree: only its dots turn red.

Tip (`TreeTip({ head, line, top, left?, right? })`)
- `.vv-tooltip`, `max-w-60`, `pointer-events-none absolute z-10`, `aria-hidden`. The last child of `RoadmapTree`'s `relative` wrapper, outside the pane's clip. A screen reader skips it: the node labels say the same words.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/RoadmapTree.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/TreeEpicNode.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/TreeGoal.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/treeKeys.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/TreeMilestoneNode.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/TreeTip.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/treeWords.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/useTreePane.ts

## MAN-7913 — The roadmap tree — RoadmapTree, TreeGoal, TreeMilestoneNode, TreeEpicNode — `onPointerMove` on the svg names the item of the nearest `[data-tree-key]` and stands the chip 14px
section: The roadmap tree — RoadmapTree, TreeGoal, TreeMilestoneNode, TreeEpicNode, TreeTip and treeWords (src/modules/roadmap/tree)/002 `onPointerMove` on the svg names the item of the nearest `[data-tree-key]` and stands the chip 14px

- `onPointerMove` on the svg names the item of the nearest `[data-tree-key]` and stands the chip 14px right of and below the pointer, in the wrapper's coordinates (`left`). Within 250px of the wrapper's right edge it stands left of the pointer: anchored by its right edge (`right = width − x + 14`), so its right edge is 14px left of the pointer whatever its width, and it wraps to the room the pointer leaves it. A pointer with less than 120px left of it keeps the chip on its right. `onPointerLeave`, a pointer over empty drawing and a touch pointer clear it, and a chip whose item a frame has taken away is not drawn (its words are empty). why touch: a finger has no hover, and its press is the selection.

Presses and keys
- One delegated `click` on the svg: `selectionUnder(event.target)` reads the nearest `[data-tree-key]` and `onSelect` receives what it names. A dot's own key is nearer than its epic's, so a press on a dot selects the feature.
- `keydown` on the svg: Enter or Space on a focused `[role="button"][data-tree-key]` (the goal, a milestone, an epic) selects it. Space is `preventDefault`ed, so the page does not scroll.

The pane's scroll (`useTreePane`)
- The goal's x: the drawing's centre while `layout.width × scale ≤ pane.clientWidth`; else `(scrollLeft + clientWidth / 2) / scale`, held within [200, width − 200]. A passive `scroll` listener and a `ResizeObserver` on the pane read it at most once per animation frame, and only `TreeGoal` and `TreeGoalConnectors` redraw: the nodes are memoised.
- The opening: on mount and when `roadmap.name` changes (never on a new frame of the same roadmap), an overflowing pane is set `behavior: 'instant'` so the current milestone's column (`roadmap.current`, else the last) sits at its centre. A pane with no width (the gutter's widget stays mounted under every other tab, `display: none`) cannot take a scroll: the opening is owed, and the pane's `ResizeObserver` runs it the moment the pane gains a width, with no poll or timer. The pane's own ends hold the first and the last column off-centre (`scrollLeft` clamps at 0 and at `scrollWidth − clientWidth`). When the roadmap holds a selection whose node that leaves outside the pane's width, the pane is set instant on that node instead.
- The selection: when the selected milestone, epic or dot is not wholly inside the pane's visible box, `scrollTo` brings its mark (its node's first child) to the centre on each axis it is out on, smooth, or instant under `prefers-reduced-motion: reduce`. Down is reached only while the pane overflows downward (a floored fit, or a zoom); the goal is never scrolled to: it follows the pane. The effect is keyed on the selected key, so a press on the item already selected scrolls nothing. The commit of an opening runs no selection scroll of its own: the opening sets the pane on a held selection that the current column leaves outside the pane's width (a roadmap switched back to).
- The scale: a new `scale` that arrives with the same `zoom` (the face's measured height arrives after the tree mounts; a resize) holds the drawing x at the pane's centre across it, while the pane overflowed. A scale that arrives with a new `zoom` is `useTreeZoom`'s to place; this hook then only re-reads the pane.

Zoom (`useTreeZoom`, `TreeZoomControls`)
- Model: `zoom` runs 1 (the fit) to 2.5 over `fitScale`, never below the fit. State `{ roadmapName, zoom }` is per mounted tree, starts at 1, is not stored, and a roadmap switch resets it while rendering, so no frame draws the new roadmap at the old zoom (not kept for a roadmap switched back to). `useTreeZoom({ paneRef, roadmapName, fitScale })` returns `zoom`, `scale`, `canZoomIn`, `canZoomOut`, `zoomIn`, `zoomOut`, `zoomToFit`; `RoadmapTree` calls it BEFORE `useTreePane`. Every surface that draws the tree zooms: the tab's face, the gutter widget, the widget at full screen.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/RoadmapTree.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/TreeEpicNode.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/TreeGoal.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/treeKeys.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/TreeMilestoneNode.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/TreeTip.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/treeWords.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/TreeZoomControls.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/useTreePane.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/useTreeZoom.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-roadmap-tree-zoom.mjs

## MAN-7914 — The roadmap tree — RoadmapTree, TreeGoal, TreeMilestoneNode, TreeEpicNode — Anchor: every zoom is `zoomTo(next, from, to)`, the drawing point under client point `from` ends
section: The roadmap tree — RoadmapTree, TreeGoal, TreeMilestoneNode, TreeEpicNode, TreeTip and treeWords (src/modules/roadmap/tree)/003 Anchor: every zoom is `zoomTo(next, from, to)`, the drawing point under client point `from` ends

- Anchor: every zoom is `zoomTo(next, from, to)`, the drawing point under client point `from` ends under `to`. The point is read off the svg's box (`(from − box) / scale`), the zoom is committed with `flushSync` (the next event of a pinch reads a resized drawing), and a layout effect of that commit `scrollTo`s the pane (`instant`) by the error read off the svg's box. No frame shows the new size at the old scroll. Wheel and double-tap: from = to = the point. Pinch: from = the last midpoint, to = the new one, so a drifting pinch pans. Buttons: the pane's visible centre. The scroll clamps at the pane's ends, and a drawing narrower than its pane stays centred, so the anchor holds once it overflows.
- Who places the pane: `useTreeZoom` for a zoom; `useTreePane` takes `zoom` and holds the drawing's centre only across a scale that arrives with the same zoom (a resize).
- Gestures, native listeners on the pane: two-finger pinch (Pointer Events, `fingers` by id, touch and pen; zoom = the zoom when the second finger landed × the spread since, read from both fingers' current places once per animation frame, so a drag that holds the spread asks for no zoom; a clamp keeps no half-move; a reversal past a clamp acts only once the spread is back inside the baseline's range); `ctrl`+wheel and trackpad pinch (`wheelZoomRatio`, non-passive; a plain wheel is not heard and scrolls); double-tap and double-click (two taps within 320ms and 32px on the same node, or both on empty drawing, each node read where the press went down, each moving under 6px: fit → 2×, else → 1, about the point; two taps on neighbouring dots are two presses). The click that ends a double-tap is swallowed in the capture phase: on touch the browser aims it after the zoom, at the new layout; measured, that click lands on empty drawing or on the node the first tap already selected, so letting it through changes nothing a person sees, and it is held back so a press that zoomed never also selects what the new layout puts under the finger. The first tap's own click is not held: a tap within a finger's reach of a node selects it, then the second tap zooms. A pinch selects nothing and raises no tip.
- Pinch against scroll, measured at 390×660 (CDP touches, both fingers down together): the default `touch-action: manipulation` gives `pointercancel` after 6 moves, the browser taking the gesture even where page zoom is forbidden; `pan-x pan-y` on the pane 24 of 24 moves with both scroll axes kept (INV-7075 holds) — chosen; a `touchmove` `preventDefault` 24 of 24; `touch-action: none` set on the second `pointerdown` fails (read when the first touch starts). A finger already scrolling when the second lands belongs to the browser, and no variant that keeps the scroll takes it back.
- Controls: `TreeZoomControls({ canZoomIn, canZoomOut, onZoomIn, onZoomOut, onFit })`, three `Button variant="outline" size="icon"` (`h-8 w-8 bg-card`), `absolute right-2 top-2 z-10` in the wrapper beside the pane, so they do not scroll; Lucide `ZoomIn`, `ZoomOut`, `Maximize`; `aria-label` and `title` `roadmap.tree.zoomIn|zoomOut|fit`. A press steps ×1.5 (`ZOOM_BUTTON_STEP`); In is disabled at 2.5 and Out at 1; Fit stays enabled.
- One source with the Lightbox (MAN-7426): `ZOOM_BUTTON_STEP`, `ZOOM_DOUBLE_TAP_SCALE`, `ZOOM_TAP_SLOP_PX`, `ZOOM_DOUBLE_TAP_WINDOW_MS`, `ZOOM_DOUBLE_TAP_RADIUS_PX` in `src/shared/constants.ts` and `wheelZoomRatio` in `src/shared/utils.ts`.
- Proof: `node .verify/probe-roadmap-tree-zoom.mjs [phone|desktop|widget] [light|dark]` — surfaces and themes are filters, none runs all; `widget` is the gutter widget in column fit (ctrl+wheel, buttons, Fit, pane height kept). The probe double-taps the point farthest from every `[data-tree-key]` box (at least 24px) and asserts both pointerdowns landed on no key: a finger's hit-test reaches past `elementFromPoint` (measured: a touch 5px past a ring's rim presses the ring, a label's reach is wider), so a spot that looks empty to a script can be a press on a node, whose first tap selects it before any zoom.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/RoadmapTree.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/TreeEpicNode.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/TreeGoal.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/treeKeys.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/TreeMilestoneNode.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/TreeTip.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/treeWords.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/TreeZoomControls.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/useTreePane.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/useTreeZoom.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-roadmap-tree-zoom.mjs

## MAN-7828 — The roadmap tree's marks and motion — TreeRing, TreeHalo, TreeDotCut, the dot paint and the moments (src/modules/roadmap/tree)

The marks a tree node wears and the motion a moment gives it. Structure, props, markers and words: MAN-7827. Moment rules: MAN-7656. Layout and the dot state: MAN-7819.

Dot paint
`ROADMAP_DOT_PAINT[state]` (`src/shared/constants.ts`), put on through `style`; the state is `layout.dots`'. The details panel's `PanelDot` (MAN-7840) paints from the same table, so a row's dot and the tree's agree.
| state | fill | stroke |
|---|---|---|
| `shipped` | `--accent` | `--accent` |
| `inFlight` | `--warn-dot` | `--warn-dot` |
| `designing` | `--garnish` | `--garnish` |
| `proposed` | `--info-dot` | `--info-dot` |
| `idea` | `--surface` | `--ink-faint` |
| `blocked` | `--danger-dot` | `--danger-dot` |
- 2026-10-06: in dark mode `designing` (gold) sits close to `inFlight` (amber).

Halo (`TreeHalo`)
| state | paint |
|---|---|
| selected | dashed `2 3`, `--ink` |
| keyboard focus on a ring node | solid accent, width 2 (`group-focus-visible:`); never on a dot, which sits inside its epic's `group` |
| named by a moment, reduced motion | solid accent for as long as the moment names it; with motion the node's own motion plays and the halo stays hidden |
| otherwise | `hidden` |
- Stands at `r + 6` round a ring (stroke 1.5), `r + 3.5` round a dot (stroke 2). `pointer-events-none`: a press lands on the mark beneath.
- A dot's halo is drawn after every dot of its epic, so neighbours never paint over it.

Dot cut-out (`TreeDotCut`)
- An alpha mask (`mask-type: alpha`, set inline so no generated class can fail it), one even-odd path of the dots' box with annuli as holes: the halo's width and 0.75 either side.
- `TreeEpicNode` renders it while any of its dots wears a halo (selected, or a moment names it) and gives it as `mask` to the dots that wear none. A haloed dot never takes it.
- A celebrating dot's annulus is cut under reduced motion only, where its halo shows.
- why a mask, not a canvas-coloured knock-out ring: the tree sits on `--canvas` (the tab) and on `--surface` (the widget and full-screen Card); a mask paints nothing, so it fits both.
- A mask leaves hit-testing alone: a cut-back neighbour takes its own press (measured in Chromium, 2026-10-06).
- Dots must stay inside their epic's group; the visible dots carry their own `mask` attribute.
- Residual: where a selected dot's cut-out overlaps a reduced-motion celebrating dot's, a dot caught in the overlap shows uncut.

Moments
| moment | the tree draws |
|---|---|
| milestone | its ring: the last share draws (`roadmap-draw`) and the ring blooms (`roadmap-bloom`, 900 ms); the goal's connector to it draws itself (`roadmap-draw`); `CelebrationLayer` waits out those 900 ms before it enters (MAN-7636) |
| epic | its ring draws and blooms; 12 particles burst from the ring's centre (`roadmap-burst`; accent, gold, deep green in turn; `--dx`/`--dy` inline) |
| feature, task | that feature's dot blooms (`roadmap-bloom`); a task moment names its feature |
| any, `prefers-reduced-motion: reduce` | nothing moves, no particle; the solid accent halo holds while the moment names the item |
- A ring holds `scale-110` while its moment is named and eases back after (`motion-safe:transition-transform duration-move`).
- The tree is the one place a moment draws on an item. A milestone reached moves nothing else, so its epics' and features' moments play on the nodes the tree always draws.

Ring (`TreeRing`)
- Track first, then arcs: the track circle is the node's first child.
- Shipped arc: the whole circle with one dash (`pathLength` 1, dash `share` on, `strokeDashoffset` .25), not a rotated path. why: the bloom's transform is free to scale it.
- While `moment`: the last feature's share is an arc of its own drawn on `roadmap-draw` (`pathLength` 1, dash 1; a one-feature item's is the whole ring); track and arcs bloom about the ring's centre (`[transform-box:fill-box] origin-center`).
- An item with no feature: dashed `3 3` track in `--ink-faint`.

Traps
- The `:5183` dev server may not generate a class new to the tree: fetch `/src/index.css` and read it before trusting a look (MAN-7830 Traps). `[transform-box:fill-box]`, `[stroke-dasharray:2_3]`, `text-[11.5px]`, `tracking-[.14em]`, `stroke-ink-faint` and `fill-card` were served on 2026-10-06.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/TreeHalo.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/TreeRing.tsx

## MAN-7840 — The roadmap tree's details panel — TreePanel and PanelRows: the frame, the heading and the shared pieces (src/modules/roadmap/panel)

The details panel under the roadmap tree: the selected item fills it. Mounted by `RoadmapTreeFace` (MAN-7829) right under `RoadmapTree` (MAN-7827), in both fits. Its four bodies, menus and writes: MAN-7841. Dot state: MAN-7819; dot paint: MAN-7828; words `roadmap.panel.*`: MAN-7634.

`RoadmapTreeFace` holds the selection per roadmap and hands the same `selected` to the tree and to this panel (`select` here, `selectOnTree` to the tree): a press on the tree fills the panel, a press on a row moves the selection, and with it the tree's halo. Every write and dialog goes through the face context's `openDialog` and `useRoadmapWrites()` (MAN-7841).

Files
| file | exports | owns |
|---|---|---|
| `panel/TreePanel.tsx` | `TreePanel` | the `Card` frame, the subject lookup, the hint, the fit, the heading id |
| `panel/PanelRows.tsx` | `PanelHead`, `PanelDot`, `RowList`, `PanelQuote`, `PanelAdd` | the pieces all four bodies share |
| `panel/RoadmapPanel.tsx`, `MilestonePanel.tsx`, `EpicPanel.tsx`, `FeaturePanel.tsx` | one body each | MAN-7841 |

Props
`TreePanel({ roadmap: Roadmap, layout: TreeLayout, selected: RoadmapTreeSelection | null, onSelect(selection), fit: 'viewport' | 'column' })`
- `layout` is the tree's own (`layoutTree`): the panel finds its item there (`findSubject`), so it and the tree judge alike what the picture still holds. `selected` null, or a name the layout lacks, shows the hint.
- `RoadmapTreeFace` mounts it directly under the tree, in the body's `gap-3` flow, `fit` the face's own, while the roadmap holds a milestone.

Frame (`TreePanel`)
| attribute | holds |
|---|---|
| `data-roadmap-panel` | `hint`, `roadmap`, `milestone`, `epic` or `feature` |
| `role="region"` | named by the open body's heading (`aria-labelledby`); by `roadmap.panel.label` (`Details`) while the hint shows |
| `data-roadmap-panel-row=<name>` | a row, on its surface |
| `data-roadmap-dot=<state>` | a `PanelDot` |

- `useTreeRoom` finds the panel by `[data-roadmap-panel]` and measures its height (MAN-7829).
- Width: `mx-auto w-full max-w-3xl`, whatever the tree's width.
- `viewport` fit: `h-[clamp(9rem,26vh,16rem)] shrink-0 overflow-hidden`, the inside `overflow-y-auto overscroll-contain scrollbar-thin`. why: the tree's scale must not change as the panel fills. `column` fit: natural height.
- The scroller is `key`ed by the item (`roadmap`, `<kind>:<name>`, `hint`): a new selection draws afresh at its head with its quote folded.
- The hint: a centred muted line under a `Pointer` icon, `roadmap.panel.hint`. No `EmptyState`: it would push the Add press out of the band.
- The heading id is `useId()` in `TreePanel`, passed to the body as the required `headingId`; the body's `PanelHead` sets it on the `h2`.

Shared pieces (`PanelRows`)
- `PanelHead({ id, title, sub, action })`: `h2` `font-serif text-xl/tight font-normal`, `tabIndex={-1}`, `outline-none focus-visible:outline-none`; the sub line `text-xs text-muted-foreground text-pretty`.
- `PanelDot({ state })`: `ROADMAP_DOT_PAINT[state]` (`src/shared/constants.ts`) as fill and border, `aria-hidden`.
- `RowList({ rows, sortable, empty, onSelect })`: `sortable` null draws rows as they come; else in `sortable.order`, with `attachList` on the `ul` and `itemProps(name)` on each `li`. An empty list is a muted line on the same hairline.
- Row: a free surface whose click selects (so `useSortable` lifts it from a free press, never from a control); its title is the real `<button>`, `aria-describedby` its meta.
- `PanelQuote({ text })`: `blockquote` on a left rule, `^\s*>\s?` stripped per line, `line-clamp-3`; Show all (`roadmap.goal.showAll`, `ml-1`) only when the fold hides lines; its press hands the keyboard to the quote (`tabIndex={-1}`, no ring), since the button leaves with the fold. Roadmap, milestone and epic goals fold; the feature's goal never does. why: an epic goal runs to 2,400 characters and would push the rows out of a 234px band.
- `PanelAdd({ label, onPress })`: ghost `Button` with `Plus`.

Rules
- Keep `text-xl/tight` as ONE class: `cn` drops a `leading-*` spelled before a later size.
- No `tabular-nums` on the head's sub line: a title's comma takes a figure's width ("requested ,"). Keep `text-pretty` there: a lone "1" wraps onto its own line otherwise. Row meta keeps `tabular-nums`.
- The heading is a focus target and never a tab stop; `outline-none` alone loses to tokens.css's `[tabindex]:focus-visible` rule, so `focus-visible:outline-none` stays.
- A row's press hands the keyboard to the new panel's heading (`selectFromRow` names the panel, the effect on `shownKey` focuses it once drawn): the pressed row goes with the panel it stood in. A press on the tree leaves focus on the tree's node.
- 2026-10-06: `h-[clamp(9rem,26vh,16rem)]`, `text-xl/tight` and `grid-cols-[auto_minmax(0,1fr)]` were in the served stylesheet; `src/index.css` needed no touch.

Traps
- The band is 234px and `useSortable`'s edge zone is 56px at each edge, so a row can open inside a zone (the first visible one opens within 20px of the bottom). A carry that begins there holds that edge until the pointer has left the zone or been pulled far past the pane (`Carry.edgeHold`, MAN-7577): a drag of a row's height moves it one slot (`{kind: 'plan', name, before: <next>}`) or nothing, and the band does not move. Before the hold it ran the band to the list's END and wrote `after: <last>`. Scaling the zone to `min(56, height / 4)` would not have cured it: 234 / 4 is 58.
- The ⋯ menu closes on any scroll: a probe brings the panel into view before it presses the trigger.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/panel/PanelRows.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/panel/TreePanel.tsx

## MAN-7841 — The roadmap tree's details panel — the four bodies: RoadmapPanel, MilestonePanel, EpicPanel and FeaturePanel, their menus and their writes (src/modules/roadmap/panel)

What `TreePanel` draws for each kind of selection. Frame, heading and shared pieces: MAN-7840. Dot state: MAN-7819. Words `roadmap.panel.*`: MAN-7634. Case phrase: MAN-7660.

Props
| body | props |
|---|---|
| `RoadmapPanel` | `{ roadmap, headingId, onSelect }` |
| `MilestonePanel` | `{ roadmap, milestone, n, headingId, onSelect }` |
| `EpicPanel` | `{ epic, n, dots, headingId, onSelect }` |
| `FeaturePanel` | `{ feature, epic, milestone, n, dot, headingId }` |
- `n` is the milestone's 1-based place; `dot` and `dots` are `layout.dots`' (MAN-7819); `onSelect(selection: RoadmapTreeSelection)` takes a row's item.

Bodies, in order under the head
| body | head `sub` | then |
|---|---|---|
| roadmap | `roadmap.panel.roadmap` + facts joined ` · ` (`data-roadmap-standing`, each `data-roadmap-fact=<key>`): milestones reached, shipped, in flight, next, blocked (warn), waiting (warn), cases total, cases broken (warn), all holding | goal `PanelQuote`, or the press `roadmap.goal.missing` (dashed); milestone rows in path order, never sortable; Add a milestone |
| milestone | `roadmap.milestone.eyebrow` (`n`, `word`); `word` is `roadmap.panel.reachedOn` once reached on a known day (`formatShortDate`), else the milestone word | blocked reason whole (warn `Badge`); goal quote; epic rows, sortable; Add an epic |
| epic | `roadmap.panel.epicLine` (`n`, `word`), with the time (`roadmap.facts.withTime`, `humanizeDuration(runtime_s)`) once `runtime_s > 0` | case line `data-roadmap-epic-cases` once `cases.total > 0`: `epicHolding`, amber `epicBroken` for `broken + regressed`; blocked reason whole; goal quote; feature rows, sortable; Add a feature |
| feature | `roadmap.panel.featureLine` (`epic`, `n`) | warn lines; facts `dl`; goal in full, or `roadmap.panel.noGoal` |
- The epic's and roadmap's case words read `standing.cases` in place; only the feature's Cases fact goes through `caseMark`.

Rows
| row | dot | meta |
|---|---|---|
| milestone | reached `shipped`, in progress `inFlight`, else `idea` | `roadmap.tree.milestoneLine`, the word alone while it holds no feature; + ` · ` + `roadmap.tree.blocked` while `milestone.blocked` |
| epic | complete `shipped`, in progress `inFlight`, else `idea` | `roadmap.panel.rowMeta` (`word`, `done`, `count`), the word alone while it holds no feature; + blocked while `epic.blocked` |
| feature | `dots.get(name) ?? 'idea'` | `rowMeta`, the word alone before a task; + blocked while the dot is `blocked` |
- Blocked is said in words on a row, never by colour alone: it matches the tree's tip. The tree's milestone node draws no blocked mark, so the milestone row is where a milestone's block reads.

Feature panel
- Warn lines first, in amber `Badge`s that wrap: `data-roadmap-panel-waiting=<accept|questions>` (`roadmap.feature.waitingAccept` or `waitingQuestions`) while `waiting_on_you`; `data-roadmap-panel-blocked` (`roadmap.blocked`) with the nearest reason (`feature.blocked ?? epic.blocked ?? milestone.blocked`) only while the dot is `blocked`, so a shipped feature under a blocked epic never reads blocked.
- Facts (`dl`, `grid-cols-[auto_minmax(0,1fr)]`): State (`PanelDot`, then `roadmap.stateLine` with `useStepPhrase`; the word alone while a waiting line stands, so the warning is said once), Tasks (`panel.tasksDone` or `panel.noTasks`), Project, Cases (`caseMark`: a `warn` `Badge` or plain text, `data-roadmap-cases=<key>`; only once the feature keeps a case).
- Open (`data-roadmap-panel-open`, outline `Button`, `roadmap.panel.open`, `aria-describedby` the heading) leads to the feature's dialog, whose menu and footer carry every write; the panel has no `ActionMenu`.

Menus (`ActionMenu`, label `roadmap.menu.actions`)
| body | items |
|---|---|
| roadmap | edit, add milestone, delete (only while it holds no milestone) |
| milestone | edit, add epic, move earlier (disabled at `n <= 1`), move later (disabled at the last), mark blocked or unblock, delete (only while it holds no epic) |
| epic | add feature, edit, move to milestone, mark blocked or unblock, delete (only while it holds no feature) |

Writes (every press goes through the face context's `openDialog` or `useRoadmapWrites()`; the dialogs are `OpenDialog`'s)
| body | presses |
|---|---|
| `RoadmapPanel` | ⋯: edit, add a milestone, delete (`openDialog`); the missing goal's press `openDialog({ dialog: 'edit', kind: 'roadmap', item: roadmap, goalFirst: true })`; the foot's Add a milestone; a milestone row's press selects it |
| `MilestonePanel` | ⋯: edit, add an epic, block, delete (`openDialog`); Move earlier and Move later `writes.move({ kind: 'milestone', name, before \| after, itemTitle })` and nothing more; Unblock `writes.unblock({ kind: 'milestone', name, itemTitle })`; the foot's Add an epic; epic rows are a `useSortable` list; an epic row's press selects it |
| `EpicPanel` | ⋯: add a feature, edit, move, block, delete (`openDialog`); Unblock `writes.unblock({ kind: 'arc', name, itemTitle })`; the foot's Add a feature; feature rows are a `useSortable` list; a feature row's press selects it |
| `FeaturePanel` | Open `openDialog({ dialog: 'feature', name })`, which leads into FeatureDialog, whose own ⋯ and footer carry the feature's writes |
- A moved milestone keeps the panel: the selection is held by name, so nothing re-selects after Move earlier or Move later.
- A drop writes `writes.move({ kind: 'arc' \| 'plan', name, before \| after, itemTitle })`: the neighbour the row now stands before, else the one it follows. The promise is returned, so `useSortable` holds the row where it was dropped until the next frame lands.
- A row is a free surface whose title is its `<button>`: a press on the title selects, a press-and-carry on the free surface reorders (`isFreePress` never lifts from a control).
- A selection a row made hands the keyboard to the new panel's heading (`TreePanel`'s `selectFromRow` and its effect on `shownKey`); the tree's own presses leave it on the tree's node.
- The roadmap body's cases pair stands LAST among its facts. why: the pair is bound by adjacency, so no feature fact reads as counting cases.
- The panel is the one place a face draws the roadmap's standing line, an epic's case line and a feature's case phrase (`data-roadmap-standing`, `data-roadmap-epic-cases`, `data-roadmap-cases=<key>`: MAN-7660). A page holding the tab and the gutter's widget draws each twice: scope a probe under `[data-roadmap-face]` or `[data-roadmap-widget]`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/panel/EpicPanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/panel/FeaturePanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/panel/MilestonePanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/panel/RoadmapPanel.tsx

## MAN-7847 — Kit — `Timeline`: row layout, density, controlled open row

`src/shared/ui/Timeline.tsx`: Verve's chronological feed, one button row per `TimelineEvent`. Paint: `.vv-timeline*` in `src/shared/ui/verve/panels.css` (MAN-740 rule 6). Not the transcript's `chat/transcript/shapes/Timeline.tsx`, which draws an author's own list.

## Props
| prop | meaning |
|---|---|
| `events: TimelineEvent[]` | `tone`, `source`, `title`, `summary?`, `when`, `meta?` |
| `density` | `full` (default): title + summary. `dense`: no summary, title one line with an ellipsis |
| `openIndex?: number \| null` | the open row's POSITION when the caller owns it; `null` = none; left out, the timeline keeps its own |
| `onToggle?(index)` | the toggle when `openIndex` is given, a notification when not |

- A `TimelineEvent` has no id, so only a position can be kept. A feed that grows at its head (newest first) owns `openIndex` and shifts it by the rows it prepends, or closes the row: an uncontrolled one leaves a different event open.
- An open row is never empty: no `meta` draws `timeline.noDetail`.
- The dot is `data-tone` + `bg-tone-dot`, so it cannot disagree with a status mark.

## Row layout
`dot` · the body (`.vv-timeline__body`: the source pill, then the words — title, then summary when `full`) · `when` · chevron.
- STACKED OR SIDE BY SIDE IS THE LIST'S DECISION, never a row's. `.vv-timeline` is a container (`container: vv-timeline / inline-size`): under 32 rem EVERY row drops its words UNDER its pill, in either density (a `dense` title stays one line there); from 32 rem EVERY row sets them beside it, the pill capped at 45 % of the body so the words keep their 10 rem.
- why: a wrap decided row by row, on each pill's own width, put the title of a short-pilled row beside it and the title of a long-pilled one under it, so one list's titles started in two places. Measured 2026-10-07 on the real `Timeline` with eight sources of different lengths (`.verify/cerberus-timeline-stacking.mjs`): before, 340 to 460 px split the list (6, 4 and 1 of 8 rows stacked); after, every width from 300 to 900 px is all stacked or all side by side, and the narrowest title is 165 px.
- Measured: at 390 px a "Shadow connector" pill beside the title left it ~90 px, and titles wrapped to four lines. The stack is the cure.
- A pill wider than its room truncates (`.vv-timeline__source`: ellipsis).

## Consumers
| consumer | density | file |
|---|---|---|
| Fleet's What happened card, a column ~300 px wide | `dense` | `src/modules/cerberus/fleet/WhatHappenedCard.tsx` |
| History's feed (MAN-7877) | `full` | `src/modules/cerberus/history/EventsCard.tsx` |

## Traps
| trap | do |
|---|---|
| a rule that decides stacked or side by side per ROW, from that row's pill width | one list mixes both and its titles start in two places; keep the decision on the list: the `@container vv-timeline (min-width: 32rem)` rule on `.vv-timeline` in `panels.css`, which Fleet's card and History's feed share |

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Timeline.tsx

## MAN-7848 — Kit — `Select`: the list opens on its chosen row

`src/shared/ui/Select.tsx`: the one styled single-choice picker. Host-window binding: MAN-7451.

## Opening
- A list that scrolls opens with its chosen row (`[aria-selected="true"]`) centred, not at its top. Every `Select` in the app gets it; a list that does not scroll is untouched, and the browser clamps either end.
- `useLayoutEffect` on `open` sets the list's `scrollTop` before the panel paints: `chosen.offsetTop - list.offsetTop - (list.clientHeight - chosen.offsetHeight) / 2`.
- `scrollTop` and not `scrollIntoView`. why: `scrollIntoView` also scrolls the page under the panel.
- No chosen row (`value` matches no option): the list opens at its top.
- why: History's check picker holds every active check (84 on the live index); opened at its top it hid the choice being reconsidered (MAN-7877).

## Option `hint`
- `SelectOption` = `{ value, label, hint? }`. `hint` is secondary text after the label in `.vv-select__hint` (muted ink, 0.86em), for a choice whose label alone does not name it (two projects called `app`; MAN-8135). It is never part of `label`.
- The trigger and every option draw it through `OptionText`, with a real space (`{' '}`) before the span. why: a CSS margin is not text, so the accessible name and a copied label ran the words together.
- An option that has a hint truncates (`min-w-0 truncate`) like the trigger; options without one are unchanged.
- On the chosen row's wash the hint steps up one ink (`--ink-mid`). why: `--ink-muted` read 4.44:1 there, under AA.

## Rules
- `.vv-select__panel` (`position: fixed`, drawn on `body`, `controls.css`) must stay the positioned ancestor of `.vv-select__list` and its rows. why: the offset arithmetic above reads both offsets from it; a `position: relative` on the list or a row breaks the centring.
- `.vv-select__list` is the scroller (`overflow-y: auto`); the `action` row sits outside it.

## Known
| gap | state |
|---|---|
| no type-to-find (the arrows, Home and End walk the rows; Tab closes the panel and hands focus back to the trigger) | its own piece of work |
| an open list stays up when its trigger is scrolled out of its own scroller but is still inside the window: `placePanel` tests the window only, so the panel hangs over the scroller's edge | follow-up; `placePanel` serves every picker in every scroller, so a change to it needs its own review |

## The panel is drawn on `body` (the master controller in the Runs widget, MAN-8430)
- `createPortal(panel, hostWindow.document.body)`, `position: fixed`, `z-index: 10000`; `placePanel` (`Select.tsx`) puts it against the trigger before it paints: below when the whole panel fits, above when that side is roomier, `PANEL_MARGIN` (8px) in from the screen's edges, capped to the room it has (the list then scrolls inside the panel); its width is the trigger's, widened by the CSS `min-width`. It follows the trigger on every scroll and resize, and closes when the trigger leaves the screen. why: drawn in place it was cut off by the first ancestor with an overflow — the chat gutter's Runs widget scroller (under 200px tall in a column of four widgets), a deck's swipe strip, a card's fold — and the options past that edge could not be reached; the panel is held inside the screen wherever its control wrapped to.
- `z-index: 10000`, and the panel is appended to `body` as it opens, so at an equal z it is in front of a layer already up. why: Settings' own `fixed z-[9999]` layer draws a z-70 portalled panel UNDER its content (INV-4356), and Settings holds `Select`s (Appearance); 10000 is the app's ceiling, one under the toast stack.
- KEYBOARD. why: the panel is no longer after the trigger in the tab order, so Tab could never reach it. Opening focuses the chosen row (the first when none is chosen); ArrowUp / ArrowDown / Home / End walk the rows; Tab closes the panel and focuses the trigger; Escape closes and focuses the trigger. Options stay `tabIndex={0}`.
- Measured before the panel left its ancestors (`document.elementFromPoint` at each option's centre, 2026-10-15): an epic fold's lists reached 0 of 8 options at 1440 and 4 of 8 / 2 of 8 at 360; a feature fold's, 0 of 3 (Athena's review of the master controller). After: 31 lists across the header, every epic and feature fold, the Runs widget, RoadmapPicker, Settings → Appearance and the Tasks filters, every option reachable.
- The listbox is NOT inside the trigger's group in the DOM: a probe finds the open list by its role (`[role="listbox"]`; one is open at a time), and proves it whole by hit-testing the centre of every option (`.verify/master-controller-widget.mjs`).

## `disabled` (the master controller, MAN-8442)
- `disabled?: boolean` (default false): the trigger is a real `disabled` button (`.vv-select__trigger:disabled` — dimmed to 0.6, `not-allowed`, no hover border) and the panel never opens; a picker that turns disabled with its list open closes it (so the list does not come back on its own when the picker is enabled again). A picker that shows a value the reader cannot change now — the master controller's WIP dropdowns while the DeepSeek switch is on.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Select.tsx

## MAN-7926 — Cerberus fixes, the whole once — .verify/cerberus-fixes-whole-scratch.sh, -live.mjs and cerberus-fixes-refused-shot.mjs: what each proves, how to run it, the verdicts

The fixes screen, the catalog and the auto-run rule shown end to end: a real Run now on the live tab, auto-run and a refusal on a scratch center. The whole before the fixes: MAN-7899 (`.verify/cerberus-whole*`). Runs, the rule, the refusal's source: MAN-7904, MAN-7910, INV-7106, INV-7080. The screen: MAN-7906. The seeded entries: MAN-7925. The scratch server and its slots: MAN-673 (`cloudcli:docs`).

## Files
| file | proves | runs against |
|---|---|---|
| `.verify/cerberus-fixes-whole-live.mjs` | Run now on `docstore/backup.age`, pressed in the sheet as a person presses it | the live app on :5183 (`openConsole`, `openNodeCard`), `~/.cloudcli/cerberus.db` read-only |
| `.verify/cerberus-fixes-whole-scratch.sh` | auto-run once inside its limit, the recheck, a refused `run.start` | a scratch center (`scripts/sunset-probe.sh`) and a scratch warden |
| `.verify/cerberus-fixes-refused-shot.mjs` | `FixOutput` reads "Refused" after the refusal's crossed-octagon icon (`lucide-octagon-x`), and the refusal's reason, over a real run view | the running :5183 client, the scratch center's answer |

## Run it
| when | do |
|---|---|
| the live half | `node .verify/cerberus-fixes-whole-live.mjs --evidence <dir>` |
| the scratch half | `SUNSET_SLOT=4 bash .verify/cerberus-fixes-whole-scratch.sh <dir>` — about 4 minutes, run it in the background |
| the shot alone | `SCRATCH_TOKEN=<jwt of the scratch center> node .verify/cerberus-fixes-refused-shot.mjs <run url> <dir> [Refused]` — the scratch script calls it |

## `cerberus-fixes-whole-live.mjs`
- Opens eis1's card, the Document store row (the sheet opens on `docstore/backup.age`), presses "Run now" under "Fixes in the catalog", polls the page every 200 ms and prints each change of the pill, the pane's lines and the check's value.
- Starts a REAL `docstore/bin/backup` (one `pg_dump`, ~18 s): `docstore-<weekday>.dump` is overwritten. No model is called.
- Verdicts, all required: the POST answered 200 with a `runId`; `GET /api/cerberus/runs/<id>` is `by: you`, `result: ok`, `exit: 0`; its lines carry `backup: …/docstore-<weekday>.dump <bytes> bytes` with an offset `t`; the pane shows that line; the pill reads "Succeeded" after its circle-check icon (`lucide-circle-check`); the check's value reads "Newest file written <n> s ago (docstore-<weekday>.dump)" with n < 60; the entry has exactly one more run in the store; no console error while signed in.
- Output: `steps.txt` and the screenshots (1440×900 running, 1440×900 and 390×844 ended, 390×844 pane) in `<dir>`.
- No guard for the 03:25–03:35 backup `flock` (`state/docstore/backup.lock`): a press then ends `failed` (MAN-7925).

## `cerberus-fixes-whole-scratch.sh`
1. The slot is claimed by the harness's `probe_db` (`mkdir "<prefix>claim"`) before anything of it is written; a slot another probe holds is refused ("slot <N> is held by another probe") and the script exits 1, its trap leaving the holder alone.
2. Boots the scratch center, enrolls a warden from this checkout with its own `CERBERUS_WARDEN_HOME` as a background job, sets a `file_age` probe `pass: "age < 1m"` every 10 s.
3. Entry A touches the file (auto on, 1 run per 3 600 s, `recheck`). Entry B is on another check, auto off.
4. Timeline until the check has moved into failing twice (counted from stored `change` rows) plus 25 s: A must have exactly one run.
5. B's set is acked, then `update catalog set cmd='echo changed'` in the scratch store; `POST /catalog/<B>/run` makes the real center send the changed command with the acked version; the warden answers `run.refused`.
6. Mounts `FixOutput` over B's run through `cerberus-fixes-refused-shot.mjs`.

| verdict | passes when |
|---|---|
| A ran by auto exactly once | `count(runs where entry = A and by = 'auto')` is 1 |
| A's auto run ended ok | `runs.result = 'ok'` |
| the recheck passed the check | a stored `failing → ok` row with `at - prev_at < 5000` and `at` within −1 s to +5 s of A's run `ended_at` |
| B ended refused | `result = refused`, `started_at` null, `cmd = 'echo changed'` |
| B's refusal says why | `note` equals `The command is not catalog v<sent version>'s command for '<B id>'` |
| B named the newest acked version | `catalog_version` is the max acked version of the node |

- The recheck verdict compares `prev_at` (the warden's previous result time, `ingest.service.ts`) with the run's end: a recheck follows the failing result by ~1 s, a cadence tick by ~10 s. why: a bare `failing → ok` count passes on the next tick when `recheck` never fired.
- The refusal verdict names the command check: a refusal for an unknown id or the wrong version fails it.
- Cleanup on every exit: the warden (pid checked as an integer above 1 and as `warden/src/main.mjs` in `/proc/<pid>/cmdline` before `kill`), the probe server, then the `mktemp -d` scratch under `/tmp/heph-fixes-whole-*`.
- Measured 2026-10-07: slot 4, A one auto run, recheck row 1 s after the failing result; B `refused` with no start and no exit.

## `cerberus-fixes-refused-shot.mjs`
- Reads the run from the scratch center (`<run url>`, token in `SCRATCH_TOKEN`) and hands it to the component through a Playwright route on `**/api/cerberus/runs/<id>`. why: the component reads through the live client's API base, not `$SUNSET_API`.
- Mounts the running client's own `FixOutput` and `WebSocketContext` with `lib/mountReact.mjs` (specifiers read from served source), a quiet socket, at 1440×900 and 390×844.
- Writes `fix-output-<expect>-<w>x<h>.png`; `expect` is the pill word, default `Refused`.
- Six verdicts per size: pill word + its `RUN_LOOK` icon (the svg's `lucide-*` class; "Failed" and "Failed · exit N" take the triangle); eyebrow "Fix output"; the run's name; the pane's first line `$ <cmd>`; the run's note in the pane; no page error. A refused run whose `note` is null fails the note verdict; any other result accepts a null note.
- Exit 1 when any verdict failed at either size.

## Rules
- A "recheck passed" claim is discriminated from the probe's own cadence: compare `prev_at` and the run's end, never a bare `failing → ok` count.
- The scratch script runs in a slot of its own (`SUNSET_SLOT`, default 4 here) and never opens `~/.cloudcli/cerberus.db` or binds 3012; the live script only reads that store (`sqlite3 -readonly`).

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-fixes-refused-shot.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-fixes-whole-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-fixes-whole-scratch.sh

## MAN-7956 — Node-updating probe — .verify/cerberus-node-updating.sh, .verify/lib/signed-hello.mjs

Shows MAN-7933's two rules live: a node whose update is the active one takes no new work, and a `failed` hello heard after center ended the update `updated` turns it `rolled_back`. A scratch center, one scratch warden (`probe-node`) under its launcher, no real store.

```
bash .verify/cerberus-node-updating.sh        # repo root; slot 2 unless SUNSET_SLOT says otherwise; about 6 min
```

Slot claimed by `probe_db` (`scripts/sunset-probe.sh`); a slot another probe holds is refused and the trap leaves it alone. Opens no `~/.cloudcli/cerberus.db`, writes no `dist-warden/`, binds no 3012; releases N, N+1, N+2 are built through scratch copies of the tree (`.verify/lib/scratch-wardens.sh`).

| Step | Shown |
|---|---|
| 1 | `probe-node` on N; checks `probe/file.age`, `probe/stale.age`; entry A (a 60 s fix on the first), entry B (auto, limit 1 an hour, on the second) |
| 2 | A's run started, N+1 offered: the warden answers `waiting`, the update stays active until the fix ends. Meanwhile `POST /catalog/<A or B>/run` → 409 `CERBERUS_NODE_UPDATING`, no `runs` row; `POST /diagnoses` first step "probe-node's warden is updating: this diagnosis reads Cerberus history only"; the stale check moves into failing and no auto run starts, nothing logged "was not run on its own" |
| 3 | update ended `updated`, launcher stopped, a hello signed with the warden's own key carrying `failed`: +5 s naming another release → left `updated`; +10 s naming N+1 → `rolled_back`, `ended_at` unchanged, one `failed` step "Rolled back to N · <reason>"; the same hello again adds no second step |
| 4 | launcher started, N+2 offered with no fix running: ends `updated` at once; the stale check moving into failing starts B's one run of the hour (step 2 spent none); a `failed` hello 125 s after the end amends nothing |

## `.verify/lib/signed-hello.mjs`
```
node .verify/lib/signed-hello.mjs <scratch warden home> <version the hello reports> <updateId> <failed version> <reason>
```
- Connects as a warden's link does (upgrade signed over `cerberus-connect\n<node>\n<at>` with `<home>/keys/node.key`), sends ONE hello whose `update` is `{ updateId, failed, reason }`, waits for `welcome`, hangs up.
- Prints `welcomed`, else the reason and exit 1; exit 2 on bad usage or a home outside `/tmp` (it reads a private key; nothing of it is printed).
- The warden of that home must NOT be running: a node holds one link and a second replaces the first. Stop its launcher first.
- The hello lists no live run (`active.runs` empty): center's reconcile ends any live run of that node `failed`. Send it only when the node has no run going.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-node-updating.sh, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/signed-hello.mjs

## MAN-7957 — The Cerberus repositories — cerberusUpdatesDb.activeNode and rolledBackAfterUpdated

Two verbs of `cerberusUpdatesDb` (`repositories/cerberus-updates.db.ts`) beside those of MAN-7806. Behaviour on top of them: MAN-7933.

| Verb | Does |
|---|---|
| `activeNode()` | the `node` of the oldest live update (`ended_at IS NULL ORDER BY started_at, rowid LIMIT 1`, the order of `running()[0]`), else `null`. A node is "updating" from the moment its update is the active one until it ends; the update behind it in its batch is not, until its turn. Read from the store, never the driver's memory, so a handover's two processes agree. Consumers: `startRun` (409 `CERBERUS_NODE_UPDATING`), `auto-run.ts`, the diagnosis service's `openSession` |
| `rolledBackAfterUpdated(id, at, text, since, note)` | the ONE amendment of an ended update; `true` when it did it. In ONE transaction (nested into the caller's): `UPDATE updates SET result = 'rolled_back', step = 'failed', note = @note WHERE id = @id AND result = 'updated' AND ended_at >= @since`; only when that changed the row, `INSERT INTO update_steps (…, 'failed', @text) ON CONFLICT (update_id, at, step) DO NOTHING`. `ended_at` is left as it was. `at` and `since` that are not whole epoch ms THROW |

- `rolledBackAfterUpdated` is the exception to "opens no transaction" (MAN-7806 Contract): its two writes are one unit however it is called.
- An update never `updated`, one `updated` before `since`, one already `rolled_back` (a resent hello) or a failure is left as it was and answers `false`.
- The step does not go through `insertStep`: that one keeps its `ended_at IS NULL` guard and would refuse it. No other path writes a step under an ended update or reopens one.
- `note` is the launcher's bare reason, what a live rollback files; `text` is the whole sentence "Rolled back to <from> · <reason>".

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-updates.db.ts

## MAN-7958 — Cerberus diagnosis words — .verify/cerberus-diagnosis-words-shot.mjs: what it proves, how to run it, the write guard, the verdicts

Photographs the two words a diagnosis tells the sheet — `when` (what promotion writes) and `scope` (whether the node's reads were given) — on the REAL Cerberus tab of the running :5183 client. The screen: MAN-7932. The words: MAN-7870. `.verify/` is gitignored.

## Run it
`node .verify/cerberus-diagnosis-words-shot.mjs <evidence dir> [node/service/check]` — default check `eis1/shadow-connector/approval_engine`.
| exit | when |
|---|---|
| 0 | every verdict PASS |
| 1 | any FAIL, or the check is not in `GET /api/cerberus/checks` (stops at once with a sentence naming it) |
| 2 | no evidence dir |

## What is answered, what is aborted
- One handler on `**/api/cerberus/**` (`page.route`) decides by METHOD first: a non-GET is counted in `refusedWrites` and aborted, whatever URL it names — the fixture URLs included. why: a separate route per URL let the answering routes beat an abort route; the check route's `route.fetch()` would replay a `DELETE` to the live store.
- Then `GET /api/cerberus/diagnoses/fixture0diagwords` is answered with the fixture (`diagnosisFixture({ when, scope })`: steps count from 1; the history step quotes its subject in “ ”); `GET /api/cerberus/checks/<node>/<service>/<check>` is the real answer with `diagnosis` put in; anything else falls through.
- The service row on the node card is matched by the check's own `serviceLabel`, read from `GET /api/cerberus/checks` (the word the card draws), never a fixed label.

## Scenarios and verdicts (each at 1440×900 and 390×844)
| scenario | fixture | verdicts |
|---|---|---|
| 1 Add to catalog → Promote dialog | `when: 'warn'`, `scope: 'node'`, the check reading `failing` now | the trigger line reads "nears its limit"; the raw line ends "· warn" |
| 2 Diagnosis panel | `when: 'failing'`, `scope: 'history'` | the panel reads "Read-only. It reads Cerberus history: <node>'s logs and status were not reachable."; it does not say "It reads logs, status and Cerberus history" |
| both | | `refusedWrites === 0`; no console error or page error |

Photographs, into the evidence dir: `promote-when-warn-<w>x<h>.png`, `diagnosis-scope-history-<w>x<h>.png`; `sheet-did-not-open.png` when the sheet never opens.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-diagnosis-words-shot.mjs

## MAN-8065 — modules/compaction procedure — one run, the steps with the seed append (step 7), Stop by phase, automatic refusals and the failure push

`compact()` (`compaction-procedure.ts`) is one compaction run. The decorator hands it the run's own writer: every frame goes to that writer, so the gateway sequences it, replays it to every tab and shows it on the processing line. The old transcript is never written; the chat's row moves only inside `swapToCompactedSession` (MAN-8046).

## The steps
1. Session row. No `provider_session_id` / `jsonl_path` → error frame `This chat has no transcript to compact yet.`, `complete` exit 1.
2. Guard `waitUntilQuiet`. Manual waits, subscribed to `activityChanged` BEFORE its first read (no timer, no poll), re-saying `Compaction waits until <why> — Stop cancels it` as the reason moves. Automatic never waits: busy → logged `left alone: the chat is busy (<why>)`, `complete` exit 0.
3. Fresh `summarizerStatus()` → `noteSummarizerStatus`. Not ready → `refusedByReadiness`. Else status frame `Compacting with <model> · <effort>…`.
4. `fireCompactHealTrigger`: `python3 ~/.claude/hooks/heal_trigger.py --reason compact`, the CLI's PreCompact payload with the OLD session id and transcript, 10 s bound, a failure is one log line. It fires before the verb: a refused or failed attempt fires it too.
5. `runSummarizeVerb`: `~/.claude/scripts/summarize --transcript <path> --session <id> [--instructions -]`; 60-minute ceiling; SIGTERM, SIGKILL after 15 s; stdout cap 64 MiB. Only `signalOwnChild` signals, and only a plain pid above 1 of a child not yet exited. Its answer:

| answer | do |
|---|---|
| exit 0, JSON `{seed: string[], model, served[], effort, chunks, tokens_in, tokens_out}` — `readVerbSuccess` takes `seed` as one or more non-empty strings (the verb gives 2 to 4: MAN-8133) and returns a copy | success |
| exit 3 | `refusedByReadiness` |
| exit 2 | `refuseAutomatic`; logged; error frame; no push |
| any other exit, or exit 0 whose JSON does not read | logged; error frame `Compaction failed: <sentence>. The chat stays on its current session.`, `complete` exit 1, push |

Every non-success answer except exit 3 logs `the summarizer ended without a summary (exit <n>): <sentence>` (exit 2 adds ` — the chat is under an automatic refusal until a manual Compact or a flip of the switch`) before its error frame.

6. Live rows before the seed append: the `compaction` row, then the summary row (`isCompactSummary`). Ids `compaction-<oldProviderSessionId>` and `compaction-summary-<oldProviderSessionId>` equal the history's, so the post-run refresh replaces them.
7. The seed append: `inner.run('claude', '', …)` with the triggering send's options minus `attachments`, `images`, `files`, `compactionTrigger`, plus `resumeFromScratch: true`, `transcriptAppend: seed`, `compactionSeed: true` (MAN-8055). No model call, no assistant text after the summary. `createSeedWriter({…, facts, seed: success.seed})` calls `swapToCompactedSession` (with the same `seed`, stored on the record: MAN-8046) at the first announced id other than the old one, before forwarding it, and holds the run's `complete`.
8. Success or take-back. Success = swapped AND held `complete` exit 0 AND not aborted: `setCompactionPostTokens` with the last `token_budget.used` (the runtime's one `getContextUsage` `full` count, MAN-8055), then forward the held `complete`. Anything else:
   - `inner.abort('claude', sessionId)` retires the seed's process (skipped after a Stop, which already did). why: it is registered under the chat's key; left alive, the next message joins it on the seed session while the row says the old one.
   - `unswapCompactedSession` (records the seed `compaction-abandoned`) when the swap was written; a swap that failed parks the unclaimed seed as superseded.
   - error frame, `complete` exit 1, push (step 9).
9. The push for an automatic failure: §"The failure push".

`refusedByReadiness`: `noteVerbNotReady`, `refuseAutomatic`, then one `logDecision` line. Manual → logged `handed to the CLI: the summarizer is not ready (<why>)`, status `Custom compaction is not ready (<why>); the CLI compacts this chat instead.`, then `inner.run('/compact', …)` on the same run and writer. Automatic → logged `left alone: the summarizer is not ready (<why>)`, `complete` exit 0.

A manual Compact handed to the CLI before `compact()` runs (the summarizer was already known not ready) is logged by the decorator: MAN-8067 §"The decorator's `/compact` test".

`compact()` never rejects: a thrown step is an error frame, `complete` exit 1 and a push.

## Stop and the flight
A flight is `{trigger, phase: waiting|summarizing|seeding, stopped, stop}`; `flight.stop` is replaced per phase. After a Stop the run writes nothing more (`emit` gates on `flight.stopped`) and pushes nothing.

| phase | Stop does | result |
|---|---|---|
| waiting | ends the guard | no compaction |
| summarizing | SIGTERM to the verb's child (the verb passes it on) | no verb or summarizer child left |
| seeding | `inner.abort`; the procedure takes a written swap back | chat stays on its old session; abandoned seed = `compaction-abandoned` |

- `flightOf(sessionId)` = in flight AND not stopped. A stopped flight stays registered until its verb exits; the next turn's Stop must reach `inner.abort`. Code needing "still registered" must not use `flightOf`.
- `stopFlightsBeforeSeed()` stops every flight not yet seeding (shutdown).

## Automatic refusals
`refuseAutomatic(sessionId)` stamps the chat with `switchFlipCount()`. The triggers leave the chat alone until the count differs from the stamp (a switch flip) or a manual Compact runs (`liftAutomaticRefusal`). Set by exit 2 and by not-ready. NOT set by exit 1, an exit-0 answer that does not read, a seed that did not take or a thrown step: that chat stays due and the next turn end or idle deadline starts the run again, uncapped (MAN-8066 §"A failure is not a refusal"). A chat holding only a seed plus one exchange gets exit 2 (nothing to compact yet).

## The failure push
Code `compaction.failed`, `kind: 'error'`, `severity: 'error'`, `meta {trigger, reason}`, `dedupeKey claude:compaction:failed:<sessionId>`. Wording lives in `notification-copy.service.ts` (MAN-622). Sent for an automatic trigger with an unstopped flight. Not sent for: manual, a Stop, exit 2, not-ready.

## Probing
`node .verify/custom-compaction-chat.mjs --app <scratch client url> --api <probe api url> --leg manual|background|turn|wait|delete [--chat <id>] [--turns N] [--runs M] [--seconds S] [--evidence <dir>] [--server-log <file>]`; Haiku chats in the scratch project under `/tmp`.
- Boot the probe server with `CUSTOM_COMPACTION_FLAG_PATH` on a scratch flag, never the live `~/.claude/state/custom_compaction.flag`. `CUSTOM_COMPACTION_AUTO_FRACTION` / `CUSTOM_COMPACTION_IDLE_AFTER_MS` make the `turn` / `wait` legs reach a run. A `turn` leg after a compaction also needs `CUSTOM_COMPACTION_MIN_GROWTH=-1`, else the growth guard holds it (MAN-8066 §"The growth guard").
- A second probe server beside the first: `PROBE_PORT=<port>` (MAN-492). The driver's `--server-log` defaults to the 7893 log; at another port pass `--server-log "$APPS_LOG"` or its decision-lines block prints empty. `whole.sh` does not pass it.
- The driver presses Compact in the composer's usage panel: typed `/compact` + Enter picks a built-in from the command palette.
- Exposure (stated, not observed): a probe server booted with the switch on re-adopts the live keepalive hosts of real chats; a real chat past its fraction would be compacted at its turn end.

## The whole run — `.verify/custom-compaction-whole.sh`
`bash .verify/custom-compaction-whole.sh` (gitignored): one scratch flag reading `on` (the operator's flag is never written), a scratch Vite on :5291, four probe-server boots with `SUMMARIZE_TAIL_TOKENS=50`, evidence in `/tmp/custom-compaction-whole.*`. Exit 0 = every gate held. A held :7893 or :5291 (another run, `compaction-handover-whole.sh` uses both) exits 1 with nothing started. why: the exit trap stops the server by pid file and would stop the other run's.

| leg | boot env | proves |
|---|---|---|
| a manual | `CUSTOM_COMPACTION_AUTO_FRACTION=1` | row toggles the flag; Compact pressed in the usage panel compacts |
| b turn-end | `CUSTOM_COMPACTION_AUTO_FRACTION=0.02`, `CUSTOM_COMPACTION_MIN_GROWTH=-1` | the turn's end compacts (`--tool` turn: a plain exchange alone leaves verb exit 2) |
| c idle | `CUSTOM_COMPACTION_IDLE_AFTER_MS=60000`, `CUSTOM_COMPACTION_IDLE_MIN_TOKENS=1` | one turn, then silence: the idle run is logged |
| d not ready | `PLAN_RUNNER_CLAUDE_BIN=/bin/true` | route `ready:false`, row `Waiting`, one Compact reaches the CLI with a `handed to the CLI` decision line |

- Gates (`expect` / `fail`): compactions on record with `post_tokens` filled after each leg, triggers `manual,auto,idle` in order, leg d's `compact_boundary` count, a floor of 4 heal-trigger lines, the indexer refusal beside its control (`.verify/custom-compaction-indexer.ts` on a database `.backup` copy), the search hit and its absence on the probe server, the delete, the operator's flag unchanged.
- The search step takes a word the assistant wrote in the FIRST transcript that no later transcript holds. Every seed's operator block carries each typed message, so the `manual` leg's first turn asks the assistant for a lorem ipsum filler paragraph; the step prints the typed-versus-written counts. Measurements: MAN-8134 §"Traps".
- `retire_chat_hosts` ends the chat's CLI hosts by tmux session name (`<chat id>-*`, `kill-session -t =<name>`, never a pid) after each of the first three stops, after the last, and in `cleanup`. why: `stop_probe_server` deletes the sessions directory, so each boot otherwise strands one live `claude` (~250 MB).
- `cleanup` (EXIT trap) deletes the scratch chat through the app; with the probe server already down it says the chat is left standing.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/compaction-children.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/compaction-facts.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/compaction-frames.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/compaction-guard.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/compaction-procedure.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/compaction-registry.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/compaction-seed.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/notifications/services/notification-copy.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/custom-compaction-chat.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/custom-compaction-indexer.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/custom-compaction-whole.sh

## MAN-8066 — modules/compaction triggers — turn end and its growth guard, idle, the pending wake, startRun, shutdown and the decision line

`auto-trigger.ts` (`createAutoTrigger`) holds the runtime's `turnEnded` and `activityChanged` hooks and the idle deadline. Operator ruling 2026-10-08: compaction at 50% context on turn end only, never in the middle of work; idle compaction replaced by ours, the CLI's autocompact kept as the net. Nothing here compacts mid-turn, nothing polls, and with the switch off nothing here acts. The run it starts is MAN-8065.

## The two triggers
| trigger | fires when | default | env seam (read at the call) |
|---|---|---|---|
| turn end | `contextTokens ≥ fraction × contextWindow`, and for a chat compacted before, `contextTokens − post_tokens ≥ growth × contextWindow` (growth guard) | fraction 0.5 (`AUTO_COMPACT_FRACTION`); growth 0.2 (`MIN_GROWTH_FRACTION`) | `CUSTOM_COMPACTION_AUTO_FRACTION`, `CUSTOM_COMPACTION_MIN_GROWTH` |
| idle | one unref'd timeout per chat, re-armed at every turn end, armed again after a restart from the chat's last turn end ("A restart"), fires once, and is decided again at each quiet of the process while it finds the process busy or a run in progress (the compaction starts at most once: "The idle deadline"); `contextTokens ≥ min` | 3,240,000 ms (54 min); min 200,000 | `CUSTOM_COMPACTION_IDLE_AFTER_MS`, `CUSTOM_COMPACTION_IDLE_MIN_TOKENS` |

An override that is not a positive finite number falls back to the default; `CUSTOM_COMPACTION_MIN_GROWTH` takes any finite number, a negative one included. `IDLE_AFTER_MS` above 2,147,483,647 also falls back: Node clamps a larger `setTimeout` delay to 1 ms, which would fire at once.

## Turn end
`turnEnded(report)`: remember the context (`rememberTurnContext`), drop the chat's pending report, clear its idle deadline, then decide off `takeoverSnapshot()` (MAN-8067).

| when | do |
|---|---|
| shutdown (`stopped`) | nothing |
| snapshot `null` (nothing has asked since boot, e.g. a re-adopted chat's first turn end) | `compactionMode()` then decide again; slower, a queued message may take the session first, the next turn end retries. A throw out of the mode read or the decision is logged `could not read the mode or decide on the turn end`, never an unhandled rejection |
| snapshot `false` | nothing, no log |
| `report.seed` | log `a seed append arms nothing` |
| otherwise | arm the idle deadline, then test the report below |

Not due, tested in this order: turn aborted; context or window unknown; under the fraction (`not due: 3.3% of the window, due at 50.0%`); under the growth since the last compaction (§"The growth guard"); a chat whose node's warden lists no live tasks (`not taken over: the chat's node warden lists no background tasks`); a flight in progress; chat under an automatic refusal. Due and `activity.busy` → kept as the chat's one pending report (`due, kept pending until the process goes quiet`). Due and quiet → `startRun(report, 'auto')` synchronously inside `turnEnded`: the turn's `complete` has gone out and the queued-message pass waits on a `setImmediate`, so the reservation lands first and a queued message lands in the new session.

## The growth guard
`notDueBecause` reads `sessionCompactionsDb.latestCompaction(appSessionId)` (MAN-8046) right after the fraction test; `post_tokens` of the newest `compaction` row is the baseline. No record, or a record with `post_tokens` NULL: not held. Held → logged `not due: the context grew <n> since the last compaction, under <needed>`.
- why: the operator block only grows; a seed at or past half the window would leave the first turn after every compaction due again, a loop of compactions each minutes long. A 60K seed on a 1M window never meets the bound (due again at 500K). The idle trigger has no guard.
- `<n>` can be negative: the turn end's count and the compaction's post-append count are two instruments that disagree by ~1.7-2.1K (a just-compacted chat that answers once reads about −1.7K: the decision lines `grew -1623` and `grew -1758`). A probe that needs a turn end to compact right after a compaction boots with `CUSTOM_COMPACTION_MIN_GROWTH=-1`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/auto-trigger.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/compaction-log.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/idle-restore.ts

## MAN-8315 — modules/compaction triggers — turn end and its growth guard, idle, the pending — A failure is not a refusal
section: modules/compaction triggers — turn end and its growth guard, idle, the pending wake, startRun, shutdown and the decision line/001 A failure is not a refusal

Only verb exit 2 and not-ready put a chat under an automatic refusal (MAN-8065). Any other end of an automatic compaction leaves the chat due: verb exit 1 (including the watch's kill of a wrong-model or twice-answered reply), an exit-0 answer that does not read, a seed that did not take, a thrown step. The next turn end that finds the chat past the fraction starts the verb again, whole, and so does the next idle deadline: one start per turn end by the turn-end trigger, no cap, no backoff. The IDLE check is bounded further, across restarts: a failed or refused start is its one attempt for that turn end, and a start that a handover cut short gets one more (MAN-8316, "Bounded across a restart"); a restart never gives a failed idle check another start.
- Each start spends a full summarizer call before it can fail again: input up to `CALL_TOKENS` 600,000 estimate tokens (MAN-8049).
- The `compaction.failed` push is deduped per chat (`claude:compaction:failed:<sessionId>`); the spend is not.
- What ends them: a run that succeeds, a refusal (exit 2, not-ready), or the switch off; for the idle check also a failure, and a second start of one turn end. A failed manual Compact does not.

## The pending wake
`activityChanged(sessionId, activity)` first hands the change to the guard's listeners (`publishActivity`), then, with a pending report and `activity.busy` false: take the report; snapshot `false` → stop; a run in progress, a flight or an automatic refusal → logged `pending compaction dropped: <why>`; else `startRun(report, 'auto')`.

## The idle deadline
Fires `fireIdleDeadline`: chat row gone → `forgetSession` and log; `contextTokens` null or under `min` → log; `takesOver` false → log; then, synchronously up to the start: a run in progress, process busy, a flight, a refusal → `left alone: <why>`; else `idle, starting the compaction`, the start is counted in the chat's host meta (`markIdleCheck`, MAN-8316 "Bounded across a restart") and `startRun(report, 'idle')` runs. A server restart does not cost a chat its deadline ("A restart").

A run in progress or a busy process ends on its own, so those two `left alone` answers keep the report in `idleRetries` (one per chat). The `activityChanged` that says the process went quiet takes it out and runs `fireIdleDeadline` again, whole: every condition above is read afresh (a second `left alone` keeps it again, the next quiet tries once more). A flight or an automatic refusal is not kept: a flight's own end is a turn end, which re-arms the deadline. A turn end (`clearIdle`) and `stop()` drop the kept report with the deadline. Nothing here polls: the wake is the activity edge. The decision lines are the same sentences; a retried chat reads `left alone: the process is busy` and, later, `idle, starting the compaction` under `trigger=idle`.

What goes quiet without a turn end: a task whose notification wakes no follow-up turn (the follow-up latch's grace expires), and the process ending (`live: false`). A task that wakes a follow-up turn ends in a turn end, which supersedes the kept report with a fresh deadline.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/auto-trigger.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/compaction-log.ts

## MAN-8316 — modules/compaction triggers — turn end and its growth guard, idle, the pending — A restart
section: modules/compaction triggers — turn end and its growth guard, idle, the pending wake, startRun, shutdown and the decision line/002 A restart

The deadline is a timer in the server's memory, so every restart and handover drops it, and the dev server hands over on every save under `server/`. It is restored from what is on disk, with no store of deadlines. A chat with a deadline still to come always has a live host (the process closes after 120 minutes without a message, the idle wait is 54), and the boot's re-adoption walks exactly those hosts. For a host whose last turn was complete, the Claude runtime reads the turn's end off the host's journal — a LOCAL host's from this machine's own, a node's from the warden's listing, which carries the same registry function's record of it (`lastTurn`; the server is never handed the warden's home path) — and calls `turnRestored(report, endedAt, idleTries)` (MAN-8055; `idleTries` is the host meta's count of idle starts for that turn end, "Bounded across a restart"); a host mid-turn gets its deadline from its own turn end. A chat on a node is taken over like any other, so it is restored like any other; a node whose warden predates `lastTurn` lists none, and its chats are restored from their next turn end. A node whose warden predates `liveTasks` (0.12.0) lists no task ledger either, and is read as unknown, not as none: such a chat is not taken over at all (`takesOver` false, MAN-8067), so no idle check fires for it and it keeps the CLI's own compaction.

`turnRestored` (`auto-trigger.ts`) does nothing when stopped, or when the chat already holds a deadline (a turn that ended since this boot armed a newer one). Otherwise it does nothing with the switch off (`takeoverSnapshot()` false), and asks `planIdleRestore` (`idle-restore.ts`), keeps the report's context for a manual compaction's `pre_tokens` (`rememberTurnContext`) unless the plan says the chat was compacted since, logs one decision line (`trigger=idle`) and arms or not:

| the chat | line, `decision=` |
|---|---|
| the last turn made no request (a seed append runs none), so no context | `no deadline restored: the last turn made no request, so it measured no context` |
| compacted at or after the turn's end (`latestCompaction(...).compactedAtMs + 1000 > endedAt`: the record's time is whole seconds, so it is read as the end of its second) | `no deadline restored: the chat was compacted after its last turn (its context is now <post_tokens>)`; the stale context is not kept as the chat's (`rememberTurnContext`) |
| the idle check has already started its limit (`IDLE_CHECK_MAX_TRIES`, 2) of compactions for this turn end | `no deadline restored: the idle check has already started <n> of its 2 compactions for this turn end` |
| context under the idle floor | `no deadline restored: the context is under <min> tokens` |
| `endedAt + idle wait` still ahead by 15 s or more | `deadline restored after a restart: the last turn ended <ago> ago, the check is due in <left>`: armed for the remainder |
| passed, or less than 15 s ahead | `deadline restored after a restart, already due: the last turn ended <ago> ago, the check runs in <delay>`: armed for the settle (15 s, `RESTORE_SETTLE_MS`) plus 30 s (`RESTORE_SPACING_MS`) for each overdue chat restored before it in this boot |

The remainder is never longer than a whole wait. Overdue chats are queued, not started together (`createRestoreSpacer`): the first starts at the settle, the next 30 s after it, and so on, because each start is a summarizer call of up to 600,000 tokens and a process replacement, all in the first seconds after a dev-server save. The spacing is of the starts, not a limit on how many compactions run at once: a long one still overlaps the next. A restore with time left on its wait is not queued. The settle exists because re-adoption is asynchronous: the adopted process registers its handle and replays what the previous server never acknowledged in its first seconds, and a turn that ends in that replay arms the chat's own deadline and clears this one (`clearIdle`).

A node host's report is made from the warden's listing: `reportRestoredTurn` (`claude-compaction-restore.ts`) takes `reattach.lastTurn` (`CerberusNodeHostLastTurn`: `endedAt`, `modelUsage`, and the turn's last main-thread request cut down to the fields the token reading uses) where a local host's is read off its journal, and runs the one request through `mainThreadRequestOf` (`session-host/host-registry.js`), the rule a live stream's message and a local journal go through too. The warden computes it with the registry's own `lastTurnRecord` and the same `mainThreadRequestOf` (`warden/src/last-turn.mjs` only cuts the message it chose down to the fields the rule reads), so there is one reading of a journal and one rule for which message is its request.

A restored deadline is the same timer as any other: its fire is `fireIdleDeadline`, so every gate above applies (chat row, the floor, `takesOver`, a run in progress, a busy process, a flight, a refusal) and a busy process keeps it for the next quiet (`idleRetries`). A restore never starts a compaction itself, and never in a chat that is mid-turn or busy. A chat that was due and busy when the server restarted is picked up the same way; there is no second mechanism.

Why a compacted chat is not restored: a compaction seeds a NEW process, so its host's journal begins after the swap. Its last `result` is the seed append's, which made no request and measured no context; the chat reads as it did before a restart, and arms nothing until its next turn, exactly as a live seed append does. The `compactedAtMs` test is the second line, for a chat whose old host outlived its retirement (the journal then shows the size before the compaction). A second, third and fourth restart therefore do nothing more to a chat a restore compacted. `latestCompaction` carries `compactedAtMs` (the record's `created_at`, to the second) for this test.

## Bounded across a restart
The idle check gets at most `IDLE_CHECK_MAX_TRIES` (2) compaction starts per turn end, counted in the chat's host meta so a restart cannot repeat it without bound (it was bounded to one per turn end before the restore, by the deadline dying with the server).
- The record is `idleCheck: { at, tries }` in the host's meta (`IdleCheck`, `shared/types.ts`), written through the host's own `note` like the background-call release: `fireIdleDeadline` calls `markIdleCheck` right before `startRun(report, 'idle')` with the start's number (1, or the restored count + 1), and the Claude runtime's process handle sends the note (`ack: false`, no cursor moves). A chat with no live process answers false and nothing is written; only the restart loses its memory then.
- A failed or refused idle start is the limit at once: `compact()` writes `tries = 2` when an idle run ends `failed` (no transcript, the summarizer's exit 1/2/3 or an unreadable answer, not-ready, a seed that did not take, a thrown step) and was not stopped. The next boot reads it and logs `no deadline restored: the idle check has already started 2 of its 2 compactions for this turn end`.
- A start that a handover cut short (the run was stopped, or the server died) is not a failure: its count stays at what the start wrote (1), the next boot restores the deadline and the restored fire is the second and last start (`tries` 2). A second cut short ends it. So one turn end costs at most two summarizer calls however often the dev server hands over.
- A new turn end clears it: the live loop sets the process's record to null at every `result` and its note writes the null; the restore also reads a record only when `at` is not before the host's last `result` (a turn that ended while no server ran leaves a stale record, which counts for nothing). The in-memory count (`idleStarts`) is dropped with the deadline at `turnEnded`.
- A left-alone answer (busy, a run in progress), a floor or a takeover refusal start nothing and count nothing.
- A successful compaction replaces the process and its host, so the record goes with the old host.

## Busy after a restart
The process's activity reads busy for a background task (`backgroundTasks`, the CLI's own level signal). That set lived only in the process, so a re-adopted chat read idle for work that was still running (a backgrounded subagent or monitor the call ledger never names), and the restored deadline would have compacted it and ended the CLI under the work. The set is rebuilt at re-adoption from the host's journal (`host-live-tasks.js`, `LiveHost.liveTasks`, MAN-683): a `task_started` with no `task_notification` after it, less what the newest `background_tasks_changed` dropped, by the reducer the live loop uses. The process starts from those ids, so the restored deadline reads `left alone: the process is busy` and the retry waits for the task's own end. The version sweep (`busyReason`) and the process's idle closer (`isBusy`) read the same, so a host running a task is no longer retired by either.

A restart during a compaction stops its summarizer (`stopChatCompaction`) and its host is told of the start before that, so the next boot restores the chat's deadline for the one retry above. The dev server hands over on every save under `server/`, so saving code while an overdue chat compacts spends its retry, and no more.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/auto-trigger.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/compaction-log.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/idle-restore.ts

## MAN-8317 — modules/compaction triggers — turn end and its growth guard, idle, the pending — `startRun`
section: modules/compaction triggers — turn end and its growth guard, idle, the pending wake, startRun, shutdown and the decision line/003 `startRun`

`runDetachedChatTurn({ sessionId, userId, content: '/compact', options: {...report.sendOptions, compactionTrigger}, beforeRun })` with the DECORATOR as runtime, so its `/compact` test sees the run.
- `beforeRun` sets `run.completionAlreadyRecorded = true`: the run does not stamp `last_completed_at`, so no unread dot lights on a chat the operator read. Listeners still hear the run end.
- That skips the registry's sidebar broadcast too, so when the outcome is `started` the trigger calls `broadcastSessionUpserted(sessionId)`: an open tab refetches and sees the marker's "after" figure.
- Outcome not started → logged `did not start: <error>`.
- A detached run has no socket: an open tab shows the processing state, then the refreshed history, never live frames. Watching them needs a tab that subscribes while the run is live (`watchRuns` in the probe driver).
- If the registry gains a neutral-completion door, `startRun` should use it instead of `completionAlreadyRecorded`.

## Shutdown
`stop()`: `stopped = true`, clears every idle timer and pending report; `startRun` and `armIdleDeadline` return at once. why: a process that is leaving must not begin a verb its successor cannot see. Reached by `stopChatCompaction()` (MAN-8067).

## The decision line (`compaction-log.ts`, `logDecision`)
`[compaction] session=<id> trigger=<turn-end|activity|idle|auto|manual> contextTokens=<n|unknown> contextWindow=<n|unknown> activity=<idle|busy (<why>)|not live> decision=<sentence>`

One line per decision, from the triggers, the decorator and the procedure alike; `grep '\[compaction\]'` on the server log says why a chat was or was not compacted. Where no report is at hand the measure is `lastTurnContext(sessionId)`. A run that ends also logs `compacted onto <id> (<pre> → <post> tokens)`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/auto-trigger.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/compaction-log.ts

## MAN-8067 — modules/compaction wiring — the decorator and the options it owns (`transcriptAppend`, `compactionSeed`), what takes a chat over, the files and shutdown

`server/modules/compaction/` replaces the CLI's compaction of a Claude chat with the launch table's `[summarizer]` compaction (`~/.claude/scripts/summarize`) while the switch (MAN-8061) reads on and the summarizer is ready. Off or not ready: no compaction is taken over and the CLI compacts as before. The decorator's two options-level acts do not read the switch: it removes `transcriptAppend` and `compactionSeed` from every Claude run, and gives a start-over in a chat that has a stored seed that seed again (see "The options this module owns on a Claude run"). Barrel exports: `withChatCompaction`, `stopChatCompaction`. Only `server/index.ts` imports the module; the module reaches settings, providers, websocket, database and notifications through their barrels only. The Claude runtime knows the module only through `ChatCompactionHooks` (MAN-8055). The record and swap are `sessionCompactionsDb` (MAN-8046); history and the marker are MAN-8054 and MAN-8060. Triggers: MAN-8066. One run: MAN-8065.

## What stays of the CLI's own compaction
Who writes the summary: `~/.claude/scripts/summarize`, on the launch table's `[summarizer]` model and effort (read at the call, MAN-7407; edited in Edit Agent Chains, MAN-7417). The chat keeps its own model and effort: the seed append rides the triggering turn's send options.
| CLI mechanism | taken-over chat | not taken over (switch off, summarizer not ready) |
|---|---|---|
| typed or pressed `/compact` | the summarizer's, through the decorator | the CLI's |
| idle compaction | OFF: `idleCompaction: false` (`CLI_COMPACTION_SETTINGS`, MAN-8055); CloudCLI's idle trigger replaces it (MAN-8066) | the CLI's own |
| auto-compact: threshold, at overflow, precompute | KEPT, `autoCompactEnabled` never set: the net under a trigger that waits, failed or was refused | the CLI's own |
- `idleCompaction: false` is the only setting the module changes. Measured 2026-10-08, 2.1.293, no model call: at launch and through a live `applyFlagSettings`, `getSettings().effective.idleCompaction` reads `false` and `getContextUsage().isAutoCompactEnabled` stays `true`.
- With the switch off nothing is merged and the launch is byte-identical to a chat with no module.

## Wiring in `server/index.ts`
| fact | value |
|---|---|
| wrap | `const chatRuntime = withChatCompaction(providerRuntimeService)`, once; it also registers the hooks with the service (`useChatCompaction`) |
| receives `chatRuntime` | `createWebSocketServer` `chat.runtime`, `createNtfyActionRoutes`, `readoptKeepaliveSessions`, `initializeScheduledMessageDispatcher` |
| stays on the bare service | the `getRunner` one-shots (no chat to compact) |
| shutdown | `stopChatCompaction()` in `shutdownRuntimeServices`, right after `closeScheduledMessageDispatcher()` |
| type | `withChatCompaction<Inner extends CompactionInnerRuntime>(inner): Inner` spreads the service; members the gateway type does not name (`recallApproval`) ride through |

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/compaction-mode.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/compaction-runtime.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/index.ts

## MAN-8338 — modules/compaction wiring — the decorator and the options it owns — Files
section: modules/compaction wiring — the decorator and the options it owns (`transcriptAppend`, `compactionSeed`), what takes a chat over, the files and shutdown/001 Files

| file | owns |
|---|---|
| `compaction-runtime.ts` | the decorator: `run` removes the options this module owns from every Claude run, re-seeds a start-over in a compacted chat, and intercepts a taken-over `/compact`; `abort` routes to the flight; `stopChatCompaction` |
| `auto-trigger.ts` | the `turnEnded` / `turnRestored` / `activityChanged` hooks, idle deadlines, `startRun` |
| `idle-restore.ts` | `planIdleRestore`: whether a re-adopted chat is owed its idle deadline after a restart, when it falls, and whether its turn end has used its `IDLE_CHECK_MAX_TRIES`; `createRestoreSpacer`: the queue of a boot's overdue chats |
| `compaction-procedure.ts` | `compact()`, one run |
| `compaction-mode.ts` | switch + summarizer status → `compactionMode`, `takesOver`, `takeoverSnapshot`, `switchFlipCount`, `noteSummarizerStatus`, `noteVerbNotReady` |
| `node-task-ledger.ts` | `taskLedgerUnlisted(appSessionId)`: the chat's node's last list holds its host with `liveTasks === null`; read by `takesOver`, the turn-end test and the decorator's `/compact` |
| `compaction-registry.ts` | flights, activity listeners, automatic refusals, last turn contexts, `forgetSession` |
| `compaction-guard.ts` | `waitUntilQuiet` |
| `compaction-children.ts` | the only spawns: `runSummarizeVerb`, `fireCompactHealTrigger` |
| `compaction-seed.ts` | `createSeedWriter`: the swap at the new session's announcement, the held `complete` |
| `compaction-facts.ts` | `readVerbSuccess`, `verbFailureSentence`, `factsOf` |
| `compaction-frames.ts` | the frames a run writes |
| `compaction-log.ts` | `logDecision` |

## What takes a chat over
`takesOver({ appSessionId })` = `appSessionId !== null` AND NOT `taskLedgerUnlisted(appSessionId)` AND `compactionMode().on`. `on` = switch on AND summarizer `ready`; the switch is read at every call. A chat placed on a Cerberus node is taken over exactly as a local one: the verb reads the transcript from this machine's disk, and a node chat's transcript is on it, because placement refuses a node that is not co-located (`node-transport.ts`, `colocationRefusal`) and the warden, its session host and this server run as the same user. The one node chat that is not taken over is one whose node's warden lists no live tasks for its host (`taskLedgerUnlisted`, `node-task-ledger.ts`: its last list carries `liveTasks: null`, a warden from before 0.12.0): a re-adopted process starts its task set from that list, so a chat re-adopted from such a warden would read as having no task while a subagent or monitor ran, and a compaction would end it. That chat keeps the CLI's own compaction until its warden is updated; the answer follows the node's last list, so it changes the moment a newer warden is listed.

| when | do |
|---|---|
| status cached, `ready`, binary (`cli.path` size + mtime) unchanged | serve the cache |
| status cached but not ready, or binary changed, or none | ask `summarizerStatus()` (`summarize --status`, ~0.25 s), single-flighted: one verb process per burst, one ask per message launch while not ready |
| switch seen to move | drop the cached status and add 1 to `switchFlipCount()`: a flip is also a retry |
| verb exits 3 | `noteVerbNotReady(sentence)`: the cache reads not-ready until the next launch asks again |
| status unreadable | `ready: null`, not on |

why a not-ready status is never served from the cache: the operator edits the summarizer's words in Edit Agent Chains, which moves neither binary nor switch; a cached not-ready would hold chats on the CLI while Settings (which asks afresh) reads ready.

`takeoverSnapshot()` = the last `compactionMode()` answer, read synchronously (`null` before any ask). The turn-end trigger needs it: its run must start in the tick of the turn's `complete`, before the queued-message pass (`setImmediate`) takes the session's reservation, and an awaited switch read lost that race. A stale snapshot is safe: the decorator re-asks `takesOver` and ends an automatic run no longer taken over with a `complete` exit 0, nothing done.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/compaction-mode.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/compaction-runtime.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/index.ts

## MAN-8339 — modules/compaction wiring — the decorator and the options it owns — The decorator's `/compact` test
section: modules/compaction wiring — the decorator and the options it owns (`transcriptAppend`, `compactionSeed`), what takes a chat over, the files and shutdown/002 The decorator's `/compact` test

- Claude only; the command matches `/^\/compact(?:\s+([\s\S]*))?$/`; the words after it are the summarizer's instructions.
- `options.sessionId` is a non-empty string; no `resumeAnchorId`, no `resumeFromScratch: true`. An edit that replaces a message with `/compact` stays an edit and reaches the CLI.
- Trigger = `options.compactionTrigger` when `auto` or `idle`, else `manual`.
- One `compactionMode()` read per request, for a node's chat too: `on` decides (with `taskLedgerUnlisted`, the same test as `takesOver`), `why` explains.
- Taken over → `compact()`. Not taken over: manual → `inner.run` (the CLI compacts), logged `handed to the CLI: <why>` when the switch is on and the summarizer cannot be served, or the chat's node warden lists no live tasks (`why` set; with the switch off `why` is null and nothing is logged); automatic → logged `no longer taken over, the run ends with nothing done`, `complete` exit 0.
- `abort`: a flight not yet stopped → `flight.stop()`; else `inner.abort`.

## The options this module owns on a Claude run
- Every Claude run the decorator handles, `/compact` or not, first loses `transcriptAppend` and `compactionSeed`, and everything after reads the cleaned options: the chat gateway spreads a client's send options into the runtime's, so a client's `transcriptAppend` would ride into a transcript and its `compactionSeed` would silence a turn's push and its report. Only this module puts them on a run. The procedure's step 7 calls the inner service directly, so its own seed append never passes through here.
- A start-over (`resumeFromScratch === true` on a command `/compact` does not match) in a chat whose `sessionCompactionsDb.latestCompaction(sessionId)` stores a seed runs with `transcriptAppend: <that seed>`. Why: when the operator's first message after a compaction joined the seed append's live process, no assistant row precedes it, only the append and its attachments, so `resolveEditAnchor` answers "start over" and the edited message's new session would start empty. Started over with the seed appended again, the session holds exactly the seed and the edited message, and the session it replaces is filed as an edit's rewind (`reason` NULL) like any start-over. `resolveEditAnchor` stays as it is: an attachment's uuid is refused as a resume point, so no anchor could make the edited message a sibling under one parent. When the CLI resumed from disk instead, its placeholder row precedes the message and the anchor rule resumes through it: not a start-over. A record with no stored seed (a NULL column) gives none: nothing is appended.
- A read that throws ends the run (the gateway logs it and completes the run, exit 1) rather than sending the edited message into an empty session.

## Shutdown
`stopChatCompaction()` = the trigger's `stop()` (MAN-8066) + `stopFlightsBeforeSeed()` (MAN-8065): no idle deadline fires, no pending compaction starts, a waiting or summarizing flight is stopped (its verb gets SIGTERM) rather than orphaned. A seed append already running is a run like any other and finishes with the drain. Not measured: how a service stop treated an in-flight summarizer child before this call existed.

`pre_tokens` of a record = the last report this server kept for the chat (`lastContextTokens`), for manual and automatic alike; null after a restart until the chat's next turn end.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/compaction-mode.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/compaction-runtime.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/index.ts

## MAN-8134 — Probe — compaction-handover: the re-seed on an edit, and the whole hand-over across two compactions (run, legs, traps)

Proves, on real Haiku chats driven through the composer: the decorator's start-over re-seed (MAN-8067 §"The options this module owns on a Claude run") with `compaction-handover.sh`, and the whole hand-over — the seed append, the operator block carried across two seeds, a slash command answered from the seed — with `compaction-handover-whole.sh`. `.verify/` is gitignored: every file exists on disk only.

## Run
| when | do |
|---|---|
| prove the re-seed | `bash .verify/compaction-handover.sh` — exit 0 when every claim holds |
| see the edit without it | `BEFORE=1 bash .verify/compaction-handover.sh` — the server boots from a scratch copy of the tree whose decorator returns the cleaned options; the leg asserts the opposite (no `queueTranscriptOnly` append in the new session; the reply does not give the code word) |
| prove the whole hand-over | `bash .verify/compaction-handover-whole.sh` — exit 0 when every claim holds; two to three minutes (it waits for a minute boundary before the slash command) |
| drive one leg by hand | `node .verify/compaction-handover-chat.mjs --app <vite url> --api <probe api url> --leg edit\|whole\|delete [--chat <id>] [--evidence <dir>] [--server-log <file>] [--without-seed]` |

## Setup the wrappers own
- `compaction-handover.sh`: probe server on `PROBE_PORT` (default 7895), scratch Vite on `VITE_PORT` (default 5293). `compaction-handover-whole.sh`: the default probe port 7893 and Vite on 5291, the ports `custom-compaction-whole.sh` uses; both scripts refuse to start while either port is held, so the two never run together. Both: scratch flag reading `on` under `mktemp -d`, `SUMMARIZE_TAIL_TOKENS=50`, `CUSTOM_COMPACTION_AUTO_FRACTION=1` (only the press compacts). The operator's `~/.claude/state/custom_compaction.flag` is compared at the end and never written.
- Both ports must be free at start: a held port (a second run, a leftover server) exits 1 with nothing started. why: the exit trap stops the server by pid file and would stop the other run's.
- Evidence directory `/tmp/compaction-handover.XXXXXX` or `/tmp/compaction-handover-whole.XXXXXX`, printed first; the driver copies the transcripts there before it checks any claim.
- Cleanup order: retire the chat's CLI hosts (tmux sessions `<chat id>-*`) and wait for their panes to exit, then delete the chat through the app, then stop the servers. why: a host still exiting flushes metadata rows and leaves a stub transcript after the delete.

## Leg `edit`
1. New scratch chat on Haiku; a turn states a made-up code word.
2. Compact pressed in the composer's usage panel; the record stores the seed blocks.
3. The first message after the compaction is sent at once, so it joins the seed append's live process: no assistant row precedes it.
4. That message is edited through "Edit and resend" into "what code word did I give you", which starts the conversation over.
5. Asserted: the new session's first rows are the append (`queueTranscriptOnly`, exactly the stored seed's blocks), the attachments, then the edited message; the reply gives the code word; the session the edit left is in `superseded_provider_sessions` with `reason` NULL; the pre-compaction session keeps `reason=compaction`.

## Leg `whole` (`lib/handover-whole.mjs`; the driver hands it the page, the socket tap and its helpers)
1. A project skill named for the chat, `handover-recall-<first 8 characters of the chat id>`, is planted in the probe project (`/tmp/cloudcli-probe-chat/.claude/skills/<name>/SKILL.md`) and removed when the leg ends; `--leg delete --chat <id>` removes that chat's skill too, for a run that died inside the leg. why: the probe project is shared, and a fixed name let another run's `delete` leg take this run's skill away before its slash turn.
2. Two turns, the first stating a made-up code word; Compact pressed. Asserted per compaction: the run's frames have a summary, no assistant text after it, one `token_budget` between it and the `complete`, and the summary-to-`complete` time under 10 s (measured 1.6–2.7 s); the record's `json_array_length(seed)` is 2 to 4 with the preamble first and `HANDOVER` last; the marker draws `before → after` with `data-compaction-after="known"`; the composer's counter equals `post_tokens`.
3. `/handover-recall-<id prefix> no tools` typed in the composer: the CLI writes a `<command-name>` row, and the reply names the code word in one turn, on the chat's own model, saying nothing of a compaction or of having the context (the check also reads the seed's own preamble words, and is first shown to flag four known-bad replies and to pass the probe's own first message). Two more typed turns are held to the same; the new transcript's first rows are printed (`type`, `queueTranscriptOnly`, the head of each block), with no assistant row before the first typed message, and the appended row holding exactly the stored seed's blocks.
4. Compact pressed again; then one turn asks for the probe's very first message word for word, and the reply gives it, filler included.
5. Asserted on the second seed: its operator block holds the five messages typed before it, in order, the slash command as typed, each under the minute it was sent (the second stretch starts in a minute later than the first seed's newest stamp, so the entries span two minutes and one stamp on all of them would fail); `render.render(render.entries(<the second compaction's old transcript>, <its id>), 4000)` has the first stretch's messages under `### Earlier operator messages`; `GET …/messages?limit=200` holds two summary rows, each followed by a `text/user`. The decision lines are printed.

## Traps
- The dev account stores `plainMode: true`: the composer then sends every message as `/plain <text>` and the CLI writes `<command-message>` rows, not the typed words. A probe that reads transcript text pins `openConsole({ preferences: { ...HARNESS_PREFERENCES, plainMode: false } })` for its page; nothing is written to the account. `.verify/custom-compaction-chat.mjs` does not pin it.
- A `.claude/commands/<name>.md` file is expanded by the composer itself (`handleCustomCommand` sends the body as plain text): the CLI sees the body, writes no `<command-name>` row, and the operator block can never hold the command as typed. A skill is the engine's (`isEngineHandledCommand`): the composer sends `/<name> <args>` as typed, the shape of the operator's `/tweak`. The probe's command is therefore a project skill, and the slash palette stays closed because the typed text has arguments after the name.
- The chat pane draws a window of rows: at the second compaction only one marker is in the page. The leg finds the marker by its own figures (`before → after`), never by its place.
- `custom-compaction-whole.sh`'s search step needs a word only the first transcript holds. Every seed's operator block carries each typed message verbatim, so nothing the first prompts say stays out of the later transcripts; the manual leg's first turn asks the assistant for a lorem ipsum filler paragraph "only for the record", which a summary drops (measured with the verb at `SUMMARIZE_TAIL_TOKENS=50`: 27 of 32 words absent from the seed). A list of thirty obscure words with definitions is carried whole (0 of 79 absent). The search reads `text` blocks only and skips `isMeta` rows, so a word in a tool result or a skill body is never found by it.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/compaction-handover-chat.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/compaction-handover.sh, /home/lyphe/.claude/claudecodeui_lyphe/.verify/compaction-handover-whole.sh, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/handover-whole.mjs

## MAN-8135 — Same-named projects and gone folders — `projectNameHints`, `isFolderMissing`, where each shows

Two lists of rules: a project NAME is not unique (a worktree, a copy), and a project's FOLDER can be gone. Both are decided once and drawn by every list that names a project.

## `projectNameHints(projects)` — `src/shared/projectNameHints.ts`

| item | value |
|---|---|
| signature | `projectNameHints(projects: readonly Pick<Project, 'projectId' \| 'displayName' \| 'fullPath'>[]): Map<string, string>` |
| returns | `projectId` → hint, ONLY for projects that share a `displayName` with another; a unique name has no entry (`hints.get(id) ?? null`) |
| input | the WHOLE visible list, never a filtered one: a filtered list can drop the other project of the name |
| pure | no I/O; no copy of the rule lives anywhere else |

Hint rule, per group of one name:

| when | hint |
|---|---|
| parents differ | the fewest trailing parent-folder names that differ from every other project of the name; one more parent where the last ones collide (`a/x`, `b/x`, `y`) |
| two projects share the SAME parent (`/home/me/foo` named `repo` beside `/home/me/repo`) | their own folder names (`foo`, `repo`), lengthened with the parents above only when another hint already reads the same |
| project at the filesystem root | `/` |

- Each project gets its own depth, not the group's.
- The hint is secondary text drawn BESIDE the name in a muted ink; never fold it into `displayName`, which the rename box and the server read.
- The helper is a shared file registered in `.oxlintrc.json`'s shared-file list; a new shared helper is added there or lint flags every import.

## Callers — one list, one hint

| surface | where | draws |
|---|---|---|
| new-chat project dropdown | `ProjectsStateProvider` computes `nameHint` into every `ProjectChoice` (MAN-7444); `ProviderSelectionEmptyState` maps it to the `Select` option `hint` | trigger and options |
| chat list row | `SidebarSimpleList` → `SidebarSimpleListItems` → `SidebarSimpleListRow` `projectNameHint` | `· <hint>` after the 10px project line, `data-testid="simple-chat-project-hint"` |
| session picker row | `useSessionPicker` → `groupsFromSimpleList(rows, marks, projectHints)` → `SessionPickerRow.projectNameHint` | `· <hint>` after the project line, `data-testid="session-picker-project-hint"` (MAN-7473) |
| Settings default-project picker | `AppearanceSettingsTab` `simpleChatProjectOptions` | `Select` option `hint` |

- A row's project line truncates the NAME before the hint; the hint is the part that tells the project apart (`max-w-[60%] flex-shrink-0 truncate`).
- Not covered (a bare name): the tree-mode Recent conversations list, sidebar search results. A new surface that names a project calls `projectNameHints` over the whole list.

## `isFolderMissing`

| item | value |
|---|---|
| set by | `getProjectsWithSessions` (`projects-with-sessions-fetch.service.ts`) per project through `diagnoseProjectFolder` (`list/claude/claude-project-folder.ts`, exported by the `providers` barrel) — the SAME test the run pre-flight uses (MAN-699) |
| never true | for a project assigned to a node (`projectsDb.nodeForPath(path) !== null`): its folder lives on the node; for an archived item |
| type | `ProjectListItem.isFolderMissing: boolean` (server); `Project.isFolderMissing?: boolean` (client); `SettingsProject` and `AgentSettingsProject` carry it optionally, set in `normalizeProjectForSettings` |

| surface | effect |
|---|---|
| new-chat dropdown (`ProviderSelectionEmptyState`) | project left out |
| `useSimpleChatProject` | skipped, saved choice and first-project fallback alike; a saved gone project falls back as if absent |
| Settings default-project picker | project left out |
| project tree row (`SidebarProjectItem`) | `Badge tone="warn"` "Folder missing" (`projects.folderMissing`, en only, `defaultValue`), path as hover `title`, `data-testid="project-folder-missing"`, compact and desktop layouts |

- The tree's own actions on a marked project are unchanged; archiving it stays the reader's click.
- A folder that vanishes while the page is open reaches the client only if `projectsHaveChanges` (`useProjectsState.ts`) compares the field. A new field the server adds to the project list is added there too, or an idle refresh drops it.

## `HIDDEN_PROJECT_ROOTS` — `server/shared/hidden-project-paths.ts`

- Roots: `TEST_PROJECTS_ROOT`, `~/.claude/state`, `/tmp`, `/var/tmp`, `os.tmpdir()`. A project under one is out of every project list, feed and search.
- Mirror: `~/.claude/scripts/heal_friction_who.py` `HIDDEN_ROOTS`. A root added to the TS list is added there, or a probe chat in it reads as operator-typed.

## Proof — `.verify/project-name-hints.mjs`

- Run through `.verify/project-name-hints-scratch.sh`: a scratch API on a copy of the database, fixtures under `/dev/shm`, the client served twice (`after` = now; `before` = the touched files from git HEAD via `.verify/lib/vite-scratch-before.config.mjs`). Nothing touches the operator's list.
- Command: `node .verify/project-name-hints.mjs --label before|after --app <url> --fixture-root <dir> [--out <dir>]`. `after` exits 1 on any failed check; `before` records only.
- Reads, per desktop and mobile × dark and light: the new-chat dropdown, the chat list, the session picker, the tree's "Folder missing" badge. Artifacts: `.verify/artifacts/project-name-hints/`.
- 2026-10-09: after 58 checks per label, all pass, no console or page errors; before 38 fail. Hint ink contrast 5.06 or better; the chosen option row steps up one ink (`.vv-select__option[aria-selected='true'] .vv-select__hint`).

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/projects/services/projects-with-sessions-fetch.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/hidden-project-paths.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useProjectsState.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/projectNameHints.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/project-name-hints.mjs

## MAN-8320 — Probe — chat-idle-restore: a restart keeps a chat's idle compaction deadline (run, legs, setup)

Proves a server restart keeps a chat's idle compaction deadline (MAN-8316, "A restart"), on a scratch stack restarted for real, with Haiku chats. `.verify/` is gitignored: both files exist on disk and are absent from `git status`.

## Run
| when | do |
|---|---|
| prove the restore | `bash .verify/chat-idle-restore.sh after` — exit 0 when both runs hold |
| see the old code without it | `bash .verify/chat-idle-restore.sh before` — the code at HEAD from a throwaway `git worktree` under `/tmp`; asserts the opposite (no `trigger=idle` line after the restart) |
| `before` after the change is committed | `BEFORE_REF=<commit before the change> bash .verify/chat-idle-restore.sh before` — why: HEAD then carries the restore and the leg fails its own assertion |
| drive one chat by hand | `node .verify/chat-idle-restore.mjs --api <probe api url> --token <jwt> --chat-file <path>` — two short Haiku turns in `lib/probe-project.mjs`'s scratch project; the chat id goes to `--chat-file` at once; prints `TURN_ENDED <epoch seconds>` |

Exit 1 prints `FAILED: <why>`; exit 2 is a bad leg name.

## Setup the script owns
- Probe server on `PROBE_PORT` 7897 with its own sessions dir; a held port exits 1 with nothing started.
- Env on every boot: `CUSTOM_COMPACTION_IDLE_AFTER_MS=100000`, `CUSTOM_COMPACTION_IDLE_MIN_TOKENS=1`, `CUSTOM_COMPACTION_AUTO_FRACTION=1` (the turn-end trigger never fires), `SUMMARIZE_TAIL_TOKENS=20` (a compaction is cheap), `CUSTOM_COMPACTION_FLAG_PATH` at a scratch flag reading `on`; the operator's `custom_compaction.flag` is read and never written.
- A restart is SIGTERM to the probe server and a boot on the SAME sessions dir, so the chat's host survives and is re-adopted. `stop_probe_server` deletes that dir, so it runs only between runs.
- Evidence in `/tmp/chat-idle-restore.XXXXXX` (printed first): `server-boot-<n>.log`, `server-run<n>.log`, `driver-<n>.txt`.
- Cleanup: delete the chat through the app, stop the server, end the chat's tmux sessions `<chat id>-*` on the `cloudcli-sessions` server, remove the worktree.

## Run 1 — kept across a restart
1. A turn ends; the server restarts 25 s later.
2. After: `deadline restored after a restart: … the check is due in <n> s` is logged; `idle, starting the compaction` follows between 1 s before and 6 s after the original deadline (100 s after the turn's end); then `compacted onto`.
3. Before: no `trigger=idle` line after the restart.

## Run 2 — overdue, once
1. A turn ends; the server stays down past the deadline, then boots.
2. After: `deadline restored after a restart, already due` is logged; the compaction starts after the 15 s settle and finishes; two further restarts must not log `starting the compaction` or `compacted onto` for the chat (the line they are expected to log is `no deadline restored: the last turn made no request`; a missing line is noted, not failed).
3. Before: no `trigger=idle` line.

## Measured
- 2026-10-12, after: run 1 restored "due in 73 s", started at 100.8 s, `compacted onto (33020 → 36125)`; run 2 started 15.0 s after the restore line.

## Not covered
The 30 s spacing of overdue chats, the 2-start limit and the `markIdleCheck` write (MAN-8316, "Bounded across a restart") have no leg here.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-idle-restore.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-idle-restore.sh

## MAN-8432 — The epic queue on the live lane — .verify/epic-queue-live.mjs

## run
`node .verify/epic-queue-live.mjs [--api http://127.0.0.1:3011] [--url http://127.0.0.1:5183]` from `claudecodeui_lyphe/`; exit 0 prints `ALL CHECKS PASS`, exit 1 lists the failed checks.
- Reads the LIVE dispatcher through the dev server as the dev user; writes nothing to it. Shot: `.verify/shots/epic-queue-live/in-flight-1440x900.png`.
- Opens the workspace on an older chat of this repo, never the newest (`quietChatId`).
- Fixture-lane proofs of the same face: MAN-8431. The verbs it reads: MAN-8425.

## what it compares
| reading | against |
|---|---|
| `GET /api/dispatcher/plans` → each arc's `queue`, each plan's `queue_hold`, `route.epics` | the same keys in `dispatcher status --json`, by value (the server fills an absent key with `null`, so presence proves nothing) |
| the served places, sorted by position | `dispatcher queue`'s own listing: position, name, turn |
| `route.epics.running` | the `· <k> running` head of `dispatcher queue` |
| the live queue | holds at least one epic (an empty list fails) |
| In flight, read after an 800 ms settle | decks in the served order; each deck's note `<position> · <turn word>`; dial readout `<running> running`; no sideways overflow |

## fails when
- The live dial is not a limit of 1 to 5 with `paused no`: `route.epics reads a limit of 1 to 5, not paused` is the check, and `Epics at once reads the served limit` compares the header's dropdown with it.
- The live queue is empty.
- `dispatcher queue`'s line shape changes (`listedQueue` parses `N. <name>.arc — <its turn|waiting|paused> — `).

## the one press
`POST /api/dispatcher/arcs/no-such-epic/queue {"last": true}` → 409 containing `no arc no-such-epic`; the door writes nothing.

## nothing moved
- Every non-GET the page makes to `/api/dispatcher/` or `/api/user/` is aborted and counted; any such call fails the run. Other non-GETs pass and are printed.
- `liveReading` before and after must be equal: `dispatcher epics`, the count of `arcs` rows with a `queue_position` (`sqlite3 -readonly` on `state/dispatcher/dispatcher.db`), size and mtime of `state/epics.flag`.
- Every `DISPATCHER_*` variable is dropped from the child environment (`LIVE_ENV`): a shell holding the scratch walk's exports would otherwise make `dispatcher epics` read a scratch dial.

## keeping
`.verify/` is git-ignored: the file lives on disk only.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/epic-queue-live.mjs

## MAN-8487 — Tool sets' contracts — the two toolset-types files, `ProviderRuntimeContext.toolsets`, `syncToolsets`, `session_toolsets_changed`, `loopbackApiOrigin`, the `JWT_SECRET` export

The seams tool sets cross, as types and one hook. The Claude runtime reaches the toolsets module only through its context and imports nothing from it; the module registers the hook, the way custom compaction does (MAN-8055).

## Types — `server/shared/toolset-types.ts` (server) and `src/shared/toolset-types.ts` (client mirror)

| type | crosses a wire | mirrored in `src/shared` | produced by → read by |
| --- | --- | --- | --- |
| `ToolsetSetView` | yes | yes | service → composer, `toolset list` |
| `SessionToolsetsView` | yes | yes | service (GET, tail of every switch) → composer, `toolset list` |
| `ToolsetServerOutcome` | yes | yes | service → composer, command |
| `ToolsetSwitchResult` | yes | yes | service → PUT caller, command door caller |
| `ToolsetCommandRequest` | yes | yes | `bin/toolset.mjs` → command door |
| `SessionToolsetsChangedEvent` | yes | yes | service after a switch → composer's hook |
| `ToolsetServerConfig` | no | no | registry reader → hook, service |
| `ToolsetDefinition` | no | no | registry reader → hook, service |
| `ChatToolsetLaunch` | no | no | hook → Claude runtime |
| `ChatToolsetHooks` | no | no | toolsets module → Claude runtime, via context |
| `ToolsetSyncOutcome` | no | no | Claude runtime → toolsets service |

- The six wire shapes are edited in both files together, field for field; a one-sided edit is a response the composer cannot read. why: the client tsconfig cannot import `server/`, so the mirror is a copy.
- `src/shared/toolset-types.ts` imports nothing from `server/`.
- `ToolsetSyncOutcome` is `{ live: false }` | `{ live: true, confirmed: true, added, removed, errors }` | `{ live: true, confirmed: false, reason }`. Importers take it from `@/shared/toolset-types.js`, not from `types.ts`.
- Both files are listed in `.oxlintrc.json` (INV-6548, INV-5890).

## The runtime seam — `providerRuntimeService`

| name | where | contract |
| --- | --- | --- |
| `ProviderRuntimeContext.toolsets` (`ChatToolsetHooks`) | `server/shared/types.ts` | always present; one hook, `launchFor({ appSessionId, onNode })` → `ChatToolsetLaunch` |
| `useChatToolsets(hooks)` | `provider-runtime.service.ts` | stores the hooks every context carries |
| `INERT_TOOLSET_HOOKS` | same | default; `launchFor` answers `{ env: {}, servers: null, promptLine: null }`, a fresh object per call, so a launch is today's |
| `IProviderRuntime.syncToolsets?(appSessionId)` | `server/shared/interfaces.ts` | optional; only a runtime with a live process per chat has it; answers `ToolsetSyncOutcome` |
| `syncToolsets(provider, appSessionId)` | `provider-runtime.service.ts` | asks the provider's runtime, calling the verb as a method (`this` holds); answers `{ live: false }` for a runtime without the verb, a sync that throws or rejects, or a provider that fails to resolve; the last three log `[provider-runtime] could not sync the tool sets of <provider> session <id>:` |

- `context.toolsets` is one delegating object that reads the registered hooks at CALL time, so a context built before `useChatToolsets` sees the hooks afterwards. why: a Claude process keeps the context of the message that spawned it.

- `useChatToolsets` is called by `toolsets.module.ts` at boot (MAN-8499); `session_toolsets_changed` is emitted by `toolsets.service.ts` after a switch that changed the on-sets (MAN-8500). The Claude runtime reads `context.toolsets` at every launch and answers `syncToolsets` for a chat with a live process (its call-ins, the one `setMcpServers` mechanism and the base-name guard: MAN-8495); a chat without one answers `live: 'next-message'`.
- A probe script imports the app through `modules/providers/index.ts`. Importing `provider-runtime.service.ts` first dies on `Cannot access 'providerRegistry' before initialization` (circular import).

## `session_toolsets_changed`

- Member of `GatewayEventKind` (`server/shared/types.ts`); shape `SessionToolsetsChangedEvent` = `{ kind, sessionId, at }`. A client that hears it reads the chat's view again.
- Sent to every open `/ws` socket by `broadcastToolsetsChanged` (`toolsets.service.ts`), only when the switch changed the stored list.

## `loopbackApiOrigin()` — `server/shared/utils.ts`

- Answers `http://127.0.0.1:${process.env.SERVER_PORT || '3001'}`, re-read at every call. Callers: `resolveApiOrigin` (`kanban-metis.module.ts`), `getMcpApiUrl` (`browser-use.service.ts`), the toolsets module.
- It names no `PORT` (INV-8440). A server on another port (a probe on 7893) hands its children its own origin.

## `JWT_SECRET` export — `server/modules/auth/index.ts`

- `export { JWT_SECRET }` from `auth.middleware.js`; the toolsets module derives each chat's credential from it.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/auth/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/services/provider-runtime.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/interfaces.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/toolset-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/utils.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/toolset-types.ts

## MAN-8490 — Composer tool-set section — ComposerToolsetSection, useSessionToolsets, the pill's count, the busy and waiting rows

The model menu's last group: which of the box's tool sets are on for this chat, one press each (MAN-8487 types, MAN-8497 server). Live in every Claude chat: `ChatInterface` reads the chat's sets through `useSessionToolsets` and hands them down through `ChatComposer` to `ComposerModelMenu`.

## Parts

| file | owns |
| --- | --- |
| `ComposerToolsetSection.tsx` | `ComposerToolsetSection({ toolsets })`: heading, the lines, the set rows, the stray rows, one `sr-only` status region. `null` while `toolsets.view` is `null` |
| `hooks/useSessionToolsets.ts` | `useSessionToolsets(sessionId, provider)` and its answer type `SessionToolsetsState` (`view`, `pendingSet`, `lastResult`, `error`, `toggle`); the wire shapes are `src/shared/toolset-types.ts`'s |
| `src/shared/api.ts` | `api.toolsets.read(sessionId)` (GET `/api/toolsets/sessions/:id`) and `api.toolsets.set(sessionId, set, on)` (PUT `…/sets/:set`, body `{ on }`), beside `api.notes` |
| `ComposerMenuPrimitives.tsx` | `ComposerMenuItem` `role="menuitemcheckbox"` (sets `aria-checked`); props `busy`, `waiting` |
| `ComposerModelMenu.tsx` | optional prop `toolsets?: SessionToolsetsState`; renders the section as the last group under `ComposerMenuSeparator`; the pill's count |
| `ChatComposer.tsx`, `ChatInterface.tsx` | `ChatInterface` calls `useSessionToolsets(openSessionId, selectedSession?.__provider ?? provider)` and passes the answer as `toolsets`; `ChatComposer` hands it to `ComposerModelMenu` |

## The hook

- Inert (`view` null, no read, no subscription) unless the provider is `claude` and there is a session id. The session id is the APP's. `ChatInterface` keys it by the opened session's own provider (`selectedSession?.__provider ?? provider`), because `provider` state is brought in line with a newly opened chat by an effect one render later and would still name the previous chat's.
- It subscribes through `useWebSocket().subscribe` BEFORE its first read and reads again on a `session_toolsets_changed` naming its chat and on `websocket_reconnected`. Never on a timer. Every switch that changed a row raises the frame, the model's own `toolset` in Bash included, so the section moves live.
- Each read takes a ticket. An answer is dropped when a newer ticket has already answered, or when the chat changed. A newer read that fails drops nothing.
- `toggle(set, on)` sets `pendingSet`, PUTs, and takes `view` and `lastResult` from the answer. A second press while one is out for the SAME chat is ignored; leaving a chat lets go of its switch, so the next chat's press is never swallowed. A refusal puts the envelope's `error.message` in `error` and reads the view again, since a refusal can mean the box's file changed under the menu.
- An answer is accepted only when its shape is what the menu and the section read (`sets` and `strays` arrays, each set's `servers` array; a switch's `servers` array and a valid `view`). A wrong-shaped 2xx is a failed read or a refusal, never state: the menu draws from the view at every render of the composer, and a bad one takes the whole chat pane down.
- A failure that is not the server's envelope says so in the app's own words (`composer.toolsets.noAnswer`, `composer.toolsets.badAnswer`), never the engine's ("Unexpected token '<'", "Failed to fetch").
- The PUT's deadline is 45 s (`api.toolsets.set`, `timeoutMs: 45_000`), above the server's 30 s bound on a live process's sync, so the answer that says `unconfirmed` or `failed` is the one that reaches the screen. The literal and `bin/toolset.mjs`'s deadline move together.
- The answer's identity changes only when a read or a switch lands, or the chat changes (the menu is memoized on it). Leaving a chat drops what was held for it.
- A registry file edit raises no frame, so an open menu reads the new file at the next frame, reconnect, chat switch or reload.

## Rows

| state | what the row does |
| --- | --- |
| set | checkbox row, `isSelected` = `set.on`; description = the set's description and its servers line |
| `busy` (`pendingSet === name`) | `aria-busy` + `aria-disabled`, keeps focus, takes no press; box becomes the `vv-spinner__ring` paint (`aria-hidden`); "Switching on…"/"Switching off…" replaces the servers line, so the row keeps its height |
| `waiting` (`pendingSet` set, another row) | `aria-disabled`, keeps focus, takes no press, 60% opacity, no hover wash, `cursor-not-allowed`. why: the hook tracks one `pendingSet`, so a second press would take the first row's spinner |
| stray (on-name no longer defined) | ticked, amber words behind ▲; its press switches it off |

- `busy` draws no spinner on a radio row; a checkbox row draws no caller trailing mark.
- Node chat (`availability: 'node'`): no rows, one note; the pill counts none.

## Lines

| `data-toolset-line` | words | shown when |
| --- | --- | --- |
| `error` (warn) | "Not updated: {{error}}" | `toolsets.error` set |
| `node` | "This chat runs on {{node}}. …" | node chat |
| `unreadable` (warn) | "The tool-set file could not be read: …" | `registryError` |
| `none` | "No tool sets are defined on this box yet. They live in {{file}}." | no sets, no strays, no error |
| `trouble` (warn) | one sentence per `failed`/`unconfirmed` server | under its row, only while the row still stands where `lastResult` left it (`result.set`, `result.on`) and no press of it is out |
| `next-message` | "Applies from the next message." | same condition, `live: 'next-message'`, no trouble |

- One `<p role="status" class="sr-only" data-toolset-announce>` is always mounted; the error, trouble and next-message words are copied into it. why: a live region inserted already holding its words is often skipped. The visible lines carry no `role`.
- `data-toolset-section` marks the group; `data-toolset-count` marks the pill's count.
- Notes use `text-muted-foreground`. why: the menu's faint ink measures 3.34:1 in light, under AA at 12px.
- Every line wraps (`[overflow-wrap:anywhere]`). why: a path, node, name or server error is one token wider than a phone.

## The pill's count

- Count = sets on + strays; zero on a node chat. Shown as "· n set(s)" in the pill and as "· n tool set(s) on" on the trigger's `aria-label`/tooltip (still starts "Select model").
- The count span shows only when `ChatComposer`'s footer is ≥45rem (`[@container(min-width:45rem)]:inline`). INV-8443.
- Locale keys: `composer.toolsets.*` in `src/modules/i18n/locales/en/chat.json`; `count` and `onLabel` carry `_one`/`_other`. The other locales have none; each call's `defaultValue` carries the English.

## Open — not fixed

- The empty box's edge measures 1.41:1 light, 1.57:1 dark; on this screen it is usually the only sign a row can be ticked. Verve's own draw, an operator colour decision (MAN-742).
- The menu's existing headings and model note use the faint ink (3.34:1 light), under AA.
- `lastResult` never expires in the hook, so "Applies from the next message." outlives the next message. The hook's signature carries no send signal and no frame announces a turn's start.
- On a phone (390px) the menu is already ~779 of 844px tall; the section is below the fold and the pill shows no count.
- The composer strip at 640–767px with "· High · 2 sets" is unmeasured.

## Probing

- `aria-disabled` rows need `{ force: true }` in Playwright.
- The count span computes `display: block` inside the chip; test `!== 'none'`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/composer/ComposerMenuPrimitives.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/composer/ComposerModelMenu.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/composer/ComposerToolsetSection.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useSessionToolsets.ts

## MAN-8496 — Tool sets whole proof — toolset-whole.mjs and its helpers

The tool sets as one system on the real app: two Haiku scratch chats (A, B), five steps, menus, registry back to empty. Parts: MAN-8497 (the module: MAN-8498, MAN-8499, MAN-8500, MAN-8501), MAN-8487, MAN-8490, MAN-8495.

## Run it — `node .verify/toolset-whole.mjs [--evidence <dir>]`

- Needs the dev API on `:3011` (`cloudcli-server-dev`) and the client on `:5183`.
- Evidence: `--evidence <dir>`, default `.verify/artifacts/toolset-whole-<epoch ms>/`; holds `run.log` and `toolsets.local.json.before` (the saved box bytes).
- Spends 10 Haiku turns (A 8, B 2), in `lib/probe-project.mjs`'s project under `/tmp`.
- Writes the LIVE `toolsets.local.json` (adds set `probe`) and hands the dev API over once (`touch server/index.ts`). Never run it while another probe or a conversation that matters is mid-turn.
- `.verify/` is gitignored; force-add to commit.

| exit | when |
|---|---|
| 0 | every check ok |
| 1 | a check failed, or the run aborted (`RUN ABORTED` + stack in `run.log`; SUMMARY reads `ABORTED after n check(s)…`) |
| 130 | SIGINT, SIGTERM or SIGHUP |

- Cleanup, on every ending: the box file written back byte for byte (`finally`, process exit, the three signals). A signal also ends both chats' hosts and deletes both chats through the app.
- `SUMMARY` is the last line of `run.log`: `<ok>/<n> checks ok`, then `; FAILED: <names>`.

## Steps

| # | does | proves |
|---|---|---|
| 1 | A: `toolset on probe` in Bash, `probe_echo "same-turn"` loaded through ToolSearch, one turn | live sync: one journal line `+probe`, one probe-server pid whose parent is A's CLI, `tools/list` + `tools/call` in the server log |
| 2 | B (never asked) is asked for `probe_echo` | ToolSearch finds nothing, a direct call is refused, no probe server is B's child |
| 3 | A's next message, no switch | same pid, one `tools/call` from it, no new sync line |
| 4 | `toolset off probe` | `removed`; journal `+ -probe`; the CLI's `deferred_tools_delta` drops the tool; no `tools/call` after the off; `pgrep` empty |
| 5a | `toolset on probe` again | `connected`; one probe-server process, A's CLI its parent; third sync line |
| 5b | the handover (`touch server/index.ts`), then A's next message | `[keepalive] re-adopting host`; A's CLI keeps its pid; the message joins the re-adopted process; it echoes from the new server pid with no switch; exactly one sync line since the handover |
| 5c | idle close (`idleCloseMs: 5000`, at least 5 s after the send) | CLI and server gone |
| 5d | a send to the closed chat | the fresh process calls `probe_echo` in its first turn, no `toolset` command, set read from A's row `["probe"]`: the HOLD |
| + | menus, `toolset list` outside a chat, empty registry, row readback, delete both chats | A's menu: probe `aria-checked=true` + pill "· 1 set"; B's: false, no pill; menu off answers PUT 200 `removed`; `toolset list` without `CLAUDE_SURFACE` exits 3; empty-registry note; A's row `[]`, B's NULL |

- Sync-line counts (journal `Tool sets for session <A>`), cumulative: 1 after step 1, 1 after step 3, 2 after 4 (newest `+ -probe`), 3 after 5a, 6 after the menu's off press (newest `+ -probe`). B's row is read with `toolsets is null`.
- Every turn also checks it ran on Haiku, read off its own assistant rows (`turnModels`, `<synthetic>` left out).
- The pointer sentence is proved by the CLI's own `prompt_snapshot` attachment plus `CLAUDE_SURFACE=cloudcli`, the loopback URL and a 64-character credential in the CLI's environment (shape printed, never the value). B's verbatim quote is printed, never asserted: Haiku sometimes declines.
- Shots (1440×900, light): `.verify/shots/toolset-whole-{A-menu-probe-on,B-menu-probe-off,A-menu-probe-off,A-menu-empty-registry}-light.png`.

## The hold check

- Passes when the fresh process has exactly one sync line, `+probe`, and `promptReleasedAt` (the CLI's `queue-operation` `enqueue` row) lands no more than 100 ms before it. why: 100 ms covers journald-vs-CLI clock skew.
- With the hold the enqueue lands 4–10 ms after the line; with no hold it sits about 750–1000 ms before it.
- The first tool call is printed, never decisive: it trails the prompt by the model's latency (1.2–2 s), longer than the sync, so it is green without a hold.

## Helpers

| file | owns |
|---|---|
| `lib/toolset-whole-kit.mjs` | `probeProcesses` / `describeProbeProcesses` (`pgrep` counting real `node …/probe-server.mjs` only), `journalWithTimes`, `serverLogSince`, `transcriptRows`, `turnEntries`, `systemPromptTexts`, `deferredToolNames`, `promptReleasedAt`, `turnModels`, `openChatSocket`, `cliToolsetEnvironment` |
| `lib/toolset-menu-kit.mjs` | `readMenu(page)`, `photograph(page, name)` |
| `lib/toolset-probe-server-source.mjs` | `PROBE_SERVER_SOURCE`: the stdio MCP server (`probe_echo`) written to `probe-server.mjs` in the probe project when `/tmp/mcp-probe/probe-server.mjs` is gone |

## Traps

- A Bash wrapper whose text names `probe-server.mjs` matches `pgrep -f`; count only `node …/probe-server.mjs` (`probeProcesses`).
- Haiku sometimes obeys the CLI's removal notice and makes no `probe_echo` call in steps 4a/4b; asking again hardens the refusal. The checks rest on `deferred_tools_delta`, no echo, an error for any call made, no process; never on a call being made.
- A removed stdio server is ended by signal: its log shows no `stdin end, exiting` line. Do not assert one.
- `DELETE /api/providers/sessions/:id?force=true` removes the row and the transcript and closes no process (`deleteOrArchiveSessionById`). The chat's CLI and its MCP servers live to the 2-hour idle close and then write stub rows (`last-prompt`, `ai-title`, `cost-state`) into the removed transcript path. The script ends both hosts (`endHosts`, tmux `kill-session`) BEFORE the delete.
- A new chat's row has been seen with `provider_session_id` set to its own app id before its first send (2 of ~30 first launches; writer not found; `toolsets` NULL, nothing synced). The launch then dies on `No conversation found with session ID`. `ensurePristine` reads each row before the first send and, on a flip, prints the row, deletes the chat, makes a fresh one (3 attempts).
- Pages' `GET …/token-usage` 404s (`SESSION_FILE_NOT_FOUND`) are the existing route answering a chat with no transcript yet; none are on `/api/toolsets`.
- The box restore is write-in-place, not write-then-rename.

## Measured

- 2026-10-16 closing run: 67 of 67 checks, box file `7b 7d 0a` before and after, no probe-server process, no transcript left.
- The hold-order check, the per-turn Haiku check, the sync-line / server-log count checks and the signal cleanup were added after that run; no run of them is recorded.
- Sizes: `toolset-whole.mjs` 610 lines, `toolset-whole-kit.mjs` 301, `toolset-menu-kit.mjs` 34, `toolset-probe-server-source.mjs` 43.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/toolset-menu-kit.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/toolset-probe-server-source.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/toolset-whole-kit.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/toolset-whole.mjs

## MAN-8551 — Cerberus Needs you, read for urgency — .verify/cerberus-needs-you-severity.mjs: what it proves, how to run it, the verdicts

Browser gate for the Needs-you card's severity: order, tone, stripe, tinted head, icon, contrast. Rules it checks: MAN-7808 (`needsYouOrder`), MAN-7879 (the card), MAN-7873 (`STATUS_TABLE`).

## Run
`node .verify/cerberus-needs-you-severity.mjs <evidence dir>`; exit 0 when every verdict passes, 1 on any FAIL, 2 without the dir. Needs the running :5183 client (`openConsole`, `openCerberusTab`).

## What it does
1. Reads the live `/api/cerberus/overview` once (a GET made by the script, not by the page).
2. Answers the page's overview request with that copy, `needsYou` rewritten to five checks on live services: `warn`, `denied`, `warn`, `failing`, `warn`, `since` rising in that order; `counts.needsYou` 5.
3. Serves the five in the order the server under test would send: sorted by `needsYouOrder`, imported straight from `server/modules/cerberus/read-model/status-rules.ts` (Node loads the `.ts`); a server with no such export gets them as written (oldest `since` first). why: a stub never passes through the server and the client keeps the order it is sent.
4. Photographs 1280×800 and 390×844 (`isMobile`, `hasTouch`), dark and light: four PNGs in the evidence dir.
5. Aborts and counts every non-GET to `/api/cerberus/`; nothing the page does reaches a write.

## Verdicts, per width and theme
| verdict | passes when |
|---|---|
| order | cards draw `denied, failing, warn, warn, warn` |
| tone | each card's `<li>` carries its status's `data-tone` (`danger`, `warn`, `warn`) |
| icon | each card's mark is a lucide icon; `denied`, `failing`, `warn` draw three different ones |
| stripe | each card has its 4 px accent bar |
| head | `denied` and `failing` tint the header band; `warn` does not |
| word | each card says its status in words |
| contrast | each header line on a tinted head is ≥ 4.5:1, or ≥ its contrast on a plain card where that is lower |
| console | zero console or page errors |

Once per run: the live server's own `needsYou` is in `needsYouOrder`; the five as written are oldest `since` first; no write was tried.

## Measured
- 2026-10-17 before the change: exit 1, 20 FAIL (no `data-tone`, no stripe, glyph text). After: exit 0, all pass.
- Plain light card's raw key measures 3.34:1 (the house's faint ink); the gate accepts it because it demands no more than the plain card gives.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-needs-you-severity.mjs

## MAN-8558 — Affected-areas client wire — src/shared/affected-areas-types.ts and api.affectedAreas

The browser's typed view of `/api/affected-areas` (the Tours tab): one wire-type file and one `api` block. The one home of every shape is shadow-connector's `core/affected_areas/wire.py` (INV-8564); the routes are MAN-8540.

## Files
| file | holds |
|---|---|
| `src/shared/affected-areas-types.ts` | 39 exported types: every `wire.py` model, its 11 nested ones and the four envelopes `TourList`, `ViewsResult`, `UnderstandingMarkResult`, `Refusal`; plus the unions `Face`, `Basis`, `Verdict`, `MarkQueue`. `Point` and `Box` are file-private (`number[]`). Imports nothing from `server/`. |
| `src/shared/api.ts` | `api.affectedAreas`, 12 verbs, beside `api.cerberus`; a type-only import from the mirror |
| `.oxlintrc.json` | `src/shared/affected-areas-types.ts` in the `frontend-shared-file` list (INV-5890) |

## Verbs
Every answer is the wire shape bare, the type named in a `// →` comment above the verb. Ids go through `encodeURIComponent`. The lane also forwards the cut of a pano's views and the plan of a whole tour (MAN-8559); no screen calls them, so `api` holds no verb for either, and `ViewsResult` and `TourPlan` stay as the wire's mirror of their answers.

| verb | route | answer |
|---|---|---|
| `tours({ q?, limit? })` | `GET /tours` | `TourList` |
| `tour(tourId)` | `GET /tours/:tourId` | `TourDetail` |
| `pano(tourId, panoId)` | `GET /tours/:tourId/panos/:panoId` | `PanoDetail` |
| `readPano(tourId, panoId, ReadRequest)` | `POST …/panos/:panoId/read` | `ReadResult`; `timeoutMs` 120 000 |
| `image(sha, options?)` | `GET /images/:sha` | JPEG bytes: the caller reads `.blob()`; `options.signal` aborts |
| `codebook()` | `GET /codebook` | `Codebook` |
| `mark(regionId, MarkRequest)` | `POST /regions/:regionId/marks` | `Region` (comment only) |
| `missed(sha, MissedRequest)` | `POST /images/:sha/regions` | `Region` (comment only) |
| `markUnderstanding(readId, UnderstandingMarkRequest)` | `POST /reads/:readId/marks` | `UnderstandingMarkResult` |
| `queue({ mode, cls?, limit?, skip? })` | `GET /queue?mode&class&limit&skip` (`skip` is the ids comma-joined; at most 50, lowercase uuids: MAN-8559) | `Queue`; `mode` is required, typed `Queue['mode']` |
| `proving({ model?, contract? })` | `GET /proving` | `Proving` |
| `setThreshold(cls, ThresholdRequest)` | `PUT /thresholds/:cls` | `ProvingClass` (comment only) |

## Failure bodies (read `.error` AND `.detail`)
| body | from |
|---|---|
| `{ error: string }` | the lane: 503 `no_secret` / `unreachable`, 502 `unreadable`, 422 malformed id or query value, 404 path not forwarded |
| `{ detail: string }` or `{ detail: [...] }` | shadow-connector's reader routes, passed through: 404 `no such tour`, FastAPI's list-shaped 422 |
| `{ error, detail }` (`Refusal`) | shadow-connector's marks routes |

## Rules an editor must not break
- A shape changes in `wire.py` first; the mirror moves in the same change. why: a field renamed on one side is a screen that stops reading.
- Field names are the wire's camelCase; `class` is a key (`wire.py`'s `cls` alias). Dates are ISO text, ids text, a point `[x, y]` and a box `[x0, y0, x1, y1]`, both in 0..1 of one view.
- A response field is never optional. A field a later plan fills (`read`, `understanding`, `regions`, `mark`, `standing`, `threshold`, `holdout`, `regionsStanding`, `marksCount`, `standingCount`, `photosAffected`, `understandingMark`, `current`, `effectiveClass`, `tourName`, …) is `T | null`: `null` is "not judged", never "judged and found nothing".
- A request field `wire.py` defaults is optional (`newClass?: string | null`).
- `ViewDetail` is `ViewEntry & {…}`, as `wire.py` inherits it.
- A new verb names its answer type in a `// → Type` comment, as this file's other blocks do.

## Measured on the live engine
- 2026-10-17, `.verify/affected-areas-marking.mjs` (66 of 66): `mark` and `missed` answered 200 with a `Region` whose `mark` and `standing` equal the same region from `GET …/panos/{pano}`; `setThreshold` answered 200 with the `ProvingClass` that `GET /proving` then held (`threshold`, `isDefault`, `thresholdSetAt`); `markUnderstanding` answered 200 with the `UnderstandingMarkResult`. `wire.py` names only that last answer: the other three are read from the routes' bodies, not from a model.
- 2026-10-17: `GET /queue` answered 200 with the keys `mode`, `items`, `remaining` (an item: `tourId`, `panoId`, `roomName`, `jobLabel`, `view`, `region`); `GET /proving` answered 200 with `model`, `contractVersion`, `contractHash`, `understanding`, `classes` (a class: the twelve fields of `ProvingClass`). Each is the typed key set.
- 2026-10-18: the file's property names, read by the TypeScript compiler, against `model_json_schema(by_alias=True)` per model: 39 of 39 equal. The five fields the fix added (`photosAffected`, `understandingMark`, `current`, `effectiveClass`, `tourName`) are each `T | null` here as `T | None` there; no model class was added.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/affected-areas-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts

## MAN-8559 — The affected-areas lane — /api/affected-areas forwarded to shadow-connector

`server/modules/affected-areas/` is the one hop between the browser and shadow-connector's internal-caller gate (R-CAP-11, `X-Internal-Secret` required even from loopback). The browser never holds the secret. Mounted in `server/index.ts` at `/api/affected-areas` behind `authenticateToken`. The engine's side of the same surface: MAN-8540.

| File | Holds |
|---|---|
| `affected-areas.module.ts` | `createAffectedAreasModule()`; the ONLY reader of the environment |
| `affected-areas.routes.ts` | `createAffectedAreasRouter({ forward })`: the allowlist, id/query/body checks, status mapping |
| `affected-areas.service.ts` | `createAffectedAreasService({ baseUrl, envFile })` → `forward(LaneRequest): Promise<LaneAnswer>`; the secret read; the one `fetch` |
| `index.ts` | barrel the entrypoint imports |

`LaneRequest`, `LaneAnswer`, `AffectedAreasService` are exported from the service file (Jev-lane precedent), not `server/shared/types.ts` (2,483 lines).

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `SHADOW_CONNECTOR_URL` | `http://127.0.0.1:8001` | engine origin |
| `SHADOW_CONNECTOR_ENV_FILE` | `/opt/shadow-connector/.env` | file holding `EIS_INTERNAL_SECRET=` |

## Allowlist (14 rows in `ALLOWLIST`)

A method+path not in the table is the lane's own 404 `{ error: 'not a route of the affected-areas lane' }`; it never reaches :8001. The table is the lane's whole contract.

| Method path | Timeout | Reply | Body | Query (forwarded keys only) |
|---|---|---|---|---|
| `GET /tours` | 20 s | json | none | `q` ≤ 80 code points, `limit` 1–100 |
| `GET /tours/:tour` | 20 s | json | none | — |
| `POST /tours/:tour/panos/:pano/views` | 90 s | json | none | — |
| `GET /tours/:tour/panos/:pano` | 20 s | json | none | — |
| `POST /tours/:tour/panos/:pano/read` | 120 s | json | object | — |
| `POST /tours/:tour/read` | 20 s | json | none | — |
| `GET /images/:sha` | 20 s | bytes (`image/jpeg`) | none | — |
| `GET /codebook` | 20 s | json | none | — |
| `POST /regions/:region/marks` | 20 s | json | object | — |
| `POST /images/:sha/regions` | 20 s | json | object | — |
| `POST /reads/:read/marks` | 20 s | json | object | — |
| `GET /queue` | 20 s | json | none | `mode` unsure\|random, `class`, `limit` 1–50, `skip` at most 50 lowercase uuids, comma-joined (a bad one is the lane's 422 before anything is forwarded) |
| `GET /proving` | 20 s | json | none | `model`, `contract`: one token `[\w.:-]{1,80}` |
| `PUT /thresholds/:class` | 20 s | json | object | — |

## Checks before forwarding (a failure is the lane's 422 `{ error }`, nothing sent)

| Input | Rule |
|---|---|
| `:tour`, `:pano` | `^[0-9a-f]{24}$` lowercase |
| `:sha` | `^[0-9a-f]{64}$` lowercase |
| `:region`, `:read` | `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` lowercase, as `routes/ids.py` holds them |
| `:class` | `^[a-z_]{2,40}$` |
| query key not in the row | dropped, not forwarded |
| query value that is an array/dict (`?q=a&q=b`) | 422 |
| body on a `body: object` row | JSON object; array/null/scalar → 422 |
| malformed percent-escape in the path (`%ZZ`) | 422 `the path holds a malformed percent-escape` (error handler at the end of the router) |

The lane's own 422 is `{ error }`; the engine's is `{ detail: [...] }`: a client reads both.

## Status mapping

| Case | Answer |
|---|---|
| upstream answered JSON | its status and body, untouched (404 `no such tour`, 403 wrong secret, 422, refusals) |
| network error / timeout | 503 `{ error }` (`unreachable`) |
| non-JSON from a json route; 2xx image that is not `image/jpeg`; 3xx with no JSON | 502 `{ error }` (`unreadable`) |
| secret missing, empty, padded, non-ASCII, unclosed quote | 503 `no_secret` (`CloudCLI could not read shadow-connector's internal secret`); nothing sent |
| a thrown error the service cannot name | `next(error)` → the app's handler |

Image 2xx: `Content-Type: image/jpeg`, `Cache-Control: private, max-age=31536000, immutable`; a non-2xx image answer passes through as its JSON.

## The secret read (`parseSecret`, `currentSecret`)

1. `fs.stat(envFile)` on EVERY call; re-parse only when `mtimeMs` or `size` changes. A rotation lands on the next request: no restart, no watcher.
2. Last `EIS_INTERNAL_SECRET=` line wins; `export ` prefix, CRLF, and an unquoted trailing ` # comment` are handled as dotenv does.
3. Quoted value: whatever stands between the quotes, verbatim; only whitespace or a `# comment` may follow the closing quote. A quote that never closes, or other text after it → `no_secret`. A secret that really begins with `"` or `'` must be quoted.
4. Usable = printable ASCII, no whitespace at either end (`USABLE_SECRET`): the gate compares bytes and an HTTP stack trims header edges.
5. A missing file logs one `[affected-areas] no usable internal secret in <file>: <cause>` line per distinct cause; never the line parsed.
6. The secret is held in the browser nowhere and in CloudCLI's own environment nowhere: read from the engine's file per call, never written to `process.env`, this server's `.env`, a log or a cache (INV-8633). why: a copy drifts on rotation, and the agent sessions this server spawns inherit its environment.

## Headers sent

| Header | Value |
|---|---|
| `X-Internal-Secret` | the secret |
| `Accept` | `application/json`, or `image/jpeg` for a bytes route |
| `Content-Type` | `application/json` when a body is sent |
| `X-Acting-User` | signed-in username, non-printable → `?`, trimmed, ≤ 64 chars; absent when none. Display only: the engine derives `origin` itself (R-CAP-21) |

`fetch` runs `redirect: 'manual'` so the secret header never follows a `Location`; timeout is `AbortSignal.timeout(timeoutMs)`.

## Probes (2026-10-17)

- `GET /api/affected-areas/tours?limit=3` → 200, three tours; `GET …/images/<sha>` → 200 JPEG whose `sha256sum` equals the id.
- `GET /nope`, `DELETE /tours`, `POST /codebook` → 404 with no `shadow-connector` journal line; 422 cases (bad id, `limit=0|101`, 81-char `q`, `mode=bogus`) likewise never reach the journal.
- An empty env file → 503 `no_secret`, 0 engine requests; writing the secret into it → next request 200, no restart.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/affected-areas/affected-areas.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/affected-areas/affected-areas.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/affected-areas/affected-areas.service.ts

## MAN-8575 — The Tours view — src/modules/affected-areas: where state lives, what the counts mean, the reads and the presses

The Tours view: a DocuSketch tour's affected areas drawn on the single photo. Three screens, one at a time: `TourPicker` → `TourScreen` → `PanoScreen`. Data is `api.affectedAreas` (wire MAN-8558, lane MAN-8559, routes MAN-8540). Drawn with the library's `RegionImage` and `Gallery` (MAN-8579). A switch at the view's top (`ToursSwitch`: Tours · Mark · Tables) chooses the surface: Tours is that walk; the Tables screen (`TablesScreen`, how right the reader is per kind) is beside it, not a step of it: MAN-8581; the marks (the mark bar, Missed one, the Mark screen, the understanding mark) judge what the walk draws: MAN-8582, rules MAN-8583.

## State of the module
| fact | value |
|---|---|
| phase | live: the Cerberus tab's fourth view, reading the lane; run whole against the live engine 2026-10-17 (`.verify/affected-areas-view.mjs`, `.verify/affected-areas-walk.mjs`) |
| mounted | `CerberusPanel` imports the lazy `AffectedAreasView` through this module's barrel and draws it after History in the strip, only once center's overview has answered (`overview !== null`, as every view): mounted on the first show of the Tours tab (`toursShown`), `hidden` after, kept mounted while the Cerberus workspace tab stands (leaving that tab for Chat unmounts the panel and the view with it, and the tour, pano and face are lost then). why: the tour, pano, face and scroll survive a visit to Fleet (MAN-7891); the views share ONE scroller, so `CerberusPanel` keeps Tours's offset itself (`toursScrollRef`, written as Tours is left, restored as it returns) |
| words | `affectedAreas.*` and `cerberus.tours.{tab,tabHint}` in `src/modules/i18n/locales/en/common.json` |
| shared types | `AffectedAreasRead<T>` (`{ value, trouble, retry }`), `PanoPress`, `TourReaderProgress`, `AffectedAreasTrouble` in `src/shared/types.ts`; the marks' `ToursScreenKey`, `RegionLayer`, `MarkWalk`, `MissedStage`: MAN-8582 |
| shared constants | `AFFECTED_AREAS_LANE_FAULTS` (`no_secret`, `unreachable`, `unreadable`: the faults of the lane whatever was asked, each said in `affectedAreas.trouble.<fault>`) in `src/shared/constants.ts`; read by `LaneTrouble`, `ThresholdControl`, `MarkRefusal`. `MARK_NOTE_MAX` (500) beside it: MAN-8582 |

## Files
| file | holds |
|---|---|
| `AffectedAreasView.tsx` | the root: calls every hook of the Tours screens and holds their handlers; picks the Tours screen by `tourId` / `panoId` and the surface by the switch (`activeScreen`; Mark and Tables mount on their first show, stay mounted, `hidden` while another shows). `MarkScreen` and `TablesScreen` read and press for themselves (MAN-8577) |
| `hooks/useLaneRead.ts` | one JSON read of the lane kept for its key: `{ value, trouble, retry }` plus `reload` (quiet, keeps the value) and `replace(value, forKey)` (writes an answer that came by another road under the key it is GIVEN, and drops every read begun before it); reads when the key is set or `retry`/`reload` is called, never on a timer |
| `hooks/useTours.ts` · `useTour.ts` · `useCodebook.ts` | the picker's list (30 newest, the search text cut at 80 characters, read once typing has rested 300 ms, and only while the view is shown; `reload` when the picker comes back) · the open tour · the codebook |
| `hooks/usePano.ts` | the open pano, the dry run beside it (what a read would buy), and `pressRead(force)`: one armed press at a time per pano (kept in `inFlight`, so a press still out shows as busy when the person leaves the pano and comes back), its answer replaces the pano and the plan at once, under the key the press was made for and outranking any read begun before it, unless the person has gone to another pano. A pano the tour lists with no views is not read (its GET is a 404 until it is cut): its dry run cuts it, and until then the screen is handed it with no views; a cut that brings no answer is that pano's trouble, drawn as the header and a banner with Try again |
| `hooks/useTourReader.ts` | Read the rest: the unread panos in capture order, one armed press each, after the last one answered, passing a pano whose views cannot be cut; `{ walk, start, stop }` |
| `hooks/useImageUrl.ts` | `useImageUrls(shas)` (a list of tiles) and `useImageUrl(sha)` (the shown face): bytes fetched with the token, object URLs revoked on unmount and on a change, aborted on a change, null on failure |
| `hooks/useTilePhotos.ts` | the tour screen's gallery photos: `useImageUrls` for the first `GALLERY_MAX` (24, `utils/tourModel.ts`) panos' Ahead views, and a second `useImageUrls` for the rest once the gallery's `onOverflowOpen` fires, so a 45-pano tour fetches 24 photos until "+N" is pressed, then the other 21 and none again. Nothing is fetched off the tour screen, and leaving it forgets the opened state (the gallery comes back collapsed) |
| `hooks/useViewShown.ts` | `isInLayout(element)` (asked before a read starts), `useViewShown(ref)` (whether the view is in layout, as state) and `useWhenShown(shown, fn)` (a word when it comes back) |
| `hooks/useMarkedRegions.ts` · `useQueue.ts` · `useProving.ts` | the pano's regions with the operator's answers laid over the read · the Mark screen's walk through a queue · the Tables' read and the kind a Set threshold answered: MAN-8582, MAN-8581 |
| `utils/laneTrouble.ts` | a non-2xx answer or a thrown fetch as an `AffectedAreasTrouble` |
| `ViewBoundary.tsx` | the lazy view's surround, exported by the barrel with the view: a waiting ring while its chunk loads, and a Tours-only warn banner (Reload the page) when it cannot load or crashes, so the failure never replaces the whole Cerberus tab |
| `TourPicker.tsx` | search field, recent tours with a read-state badge |
| `TourScreen.tsx` | tour header with the walk (Read the rest), then `ContextCard`, then `TourRooms`, then `RoomGallery` |
| `TourRooms.tsx` | the tour's rooms in DocuSketch's walk order: name, floor, and who calls each affected, in words (MAN-8578) |
| `PanoScreen.tsx` | header + `ReadControl`, `FaceStrip`, the face (`MissedDraw`: the `RegionImage` photo with `LayerSwitch` over it and the chosen area's `MarkBar` under it, MAN-8582) beside `RegionList`, caption, Enlarge (`Lightbox`), `UnderstandingCard`, `RoomDrying` |
| `FaceStrip.tsx` · `ReadingList.tsx` | the six face tabs, each counting its areas (scrolling the chosen one into the strip's own box) · the waiting surface of the list of areas |
| `ReadControl.tsx` | the read presses (Read this pano / Read again / Read the rest), refusals in words, the walk's meter and Stop |
| `LaneTrouble.tsx` | one warn banner with Try again for a read that brought no answer; `subject`: `tours` · `tour` · `pano` · `tables` · `queue` names what failed to read (`queue`: the Mark screen's) |
| `ContextCard.tsx` · `UnderstandingCard.tsx` · `RoomDrying.tsx` · `RoomGallery.tsx` · `RegionList.tsx` | what the reader is told (the same facts for every tour; an unlinked tour adds one line saying they come from DocuSketch alone, and a card with no facts shows that line alone) · what it understood · the room's drying numbers and its demo line (`demoBeforeTour`: "Demo had begun before the tour", "No demo recorded before the tour", nothing when null) · the pano tiles (`Gallery`, max 24 then "+N") · the face's regions |
| `utils/regionLook.ts` | `REGION_LOOK` and `regionState(region)` |
| `utils/tourModel.ts` | `FACES`, `panoReadState`, `tourReadState`, `needsRead`, `tourUnread`, `tourFacts`, `tourName`, `addressBesideName`, `roomWords`, `spansFloors`, `spoken`, `listWords`, `capitalized`, `faceCounts(view)` (a face's `areas`, `setAside` and `proposed`, each counted through `regionState`: set aside is unsure plus not-a-change, proposed is an unmarked area of a kind with no line set), `kindName(cls, codebook)`: pure, no fetch, no state |
| `MarkBar.tsx` · `MarkPresses.tsx` · `MarkPress.tsx` · `NoteDialog.tsx` · `MissedDraw.tsx` · `FacePhoto.tsx` · `LayerSwitch.tsx` · `ToursSwitch.tsx` · `MarkScreen.tsx` · `MarkQueue.tsx` · `UnderstandingMark.tsx` · `UnderstandingVerdict.tsx` | the marks: MAN-8582 |
| `TablesScreen.tsx` · `ProvingTable.tsx` · `ProvingDetail.tsx` · `ThresholdControl.tsx` · `utils/provingModel.ts` | the Tables screen, its opened row, its threshold control, how its figures read: MAN-8581 |

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/

## MAN-8576 — The Tours view — src/modules/affected-areas: where state lives, what the counts mean, the reads and the presses — Root order (`AffectedAreasView.tsx`)
section: The Tours view — src/modules/affected-areas: where state lives, what the counts mean, the reads and the presses/001 Root order (`AffectedAreasView.tsx`)

1. state (`query`, `tourId`, `panoId`, `face`, `selectedRegionId`, `enlarged`)
2. reads (`useTours`, `useTour`, `usePano`, `useCodebook`), each `{ value, trouble, retry }`; `useTour` adds `reload`, `usePano` adds `press`, `pressRead`, `reload`
3. derivations (`summary`, `entry`, `room`, `unread = tourUnread(...)`)
4. photos, walk, handlers (`useImageUrl`, `useTilePhotos`, `useTourReader`, `on*`)

A step reads only what the steps above it produce. why: the shown face's photo is read off `entry` with no reordering.

## What the numbers mean
| where | counts |
|---|---|
| face tab, caption "3 areas · 2 set aside · 1 proposed · read 3h ago" | `faceCounts` in `utils/tourModel.ts` (read by `FaceStrip.tsx` and `PanoScreen.tsx`), each region read through `regionState`: once the pano answered, set aside = `unsure` + `not_a_change` regions, proposed = unmarked regions of a kind with no line set (`proposed` with `standing === false`), areas = the rest; the tab counts areas. Before it answers, `listedAreas`: areas = `standingCount ?? regionsCount`, set aside and proposed hidden (the listing carries no state per region, so it cannot tell a proposed area from one set aside and names neither) |
| region list "Marked on this view", badges, outlines | every region of the face, set aside and proposed included; areas + set aside + proposed = outlines drawn |
| gallery tile badge | the standing areas summed over a pano's views (`listedAreas`): "3 areas"; "2 found" (`regionsCount` summed) while none stands and the reader found some, whether nobody judged them or the operator set them all aside (the listing cannot tell); "None found" when it found none. The pano opens on the first face whose read found an area, standing or not |
| tour line "26 areas found" | `regionsStanding`, or `regionsTotal` while none stands: a tour the reader marked never reads as empty |
| tour line "42 of 42 cut views read · 5 panos not cut" | views read of views cut; `uncut = panoCount − round(viewsTotal / 6)`; "none cut yet" when `viewsTotal === 0` |
| `tourReadState` | against six views per pano (`panoCount × 6`), never against views cut: a tour with an uncut pano is `partly` |
| `tourUnread` | panos with a view that needs a read (`needsRead`: none yet, or a read whose `ReadState.current` is not true), and those views (six for a pano never cut); the press says them as "5 panos · 30 views need a read" (`affectedAreas.read.rest`, `viewsNeedRead`) before it spends. The tour line's "N of M cut views read" is a different count (reads under ANY contract, `viewsRead`), so a stale read counts in it and in "need a read" both |
| room list title "Rooms" | no count, on purpose: the header's "in 5 rooms" is `roomCount` (`docusketch_tours.rooms`, DocuSketch's own count), while the list has one row per room key, and `canonical_key` folds names ("Office2 / Office1" is one row). The two differed on 14 of the 60 newest tours (El Camino College: 39 against 35, measured 2026-10-17) |

## Read presses
- The press is synchronous per pano: `POST …/panos/:pano/read` answers when the pano's six views are read (7–10 s, longer behind the tour's lock) with `pano` filled, so nothing is polled (`core/affected_areas/routes/read.py`). The browser waits up to 120 s (`api.affectedAreas.readPano`). A client that gives up does not cancel the purchase: the next press finds the reads cached.
- `armed: false` is the dry run (`planned`, buys nothing); `armed: true` buys; `force: true` re-reads views that already have a read under this contract.
- The engine reads one pano per press. A whole tour is the viewer's walk: Read the rest sends one armed press per unread pano, in capture order, the next only after the last one answered.

| press | offered when | sends |
|---|---|---|
| Read this pano | the dry run is not back, was refused, or has `viewsToRead > 0` | `{ armed: true, force: false }` |
| Read again | `againReason` in `ReadControl.tsx` is non-null: (1) a view's `read.contextChanged === true`, the job's details having changed since that face was read; (2) a view with `read.status === 'read'` needs a read (`needsRead`: its `read.current` is not true, so it was read under an older contract or model than the reader reads under now; the engine decides it and the browser compares nothing), said as `affectedAreas.read.againCurrent` with the codebook's `contractVersion` and `model`. `useTourReader.unreadInCaptureOrder` and `tourUnread` use the same `needsRead`. Condition 2 is off until the codebook has answered | `{ armed: true, force: true }` |
| Read the rest | `unreadPanos > 0`, or a walk is running | `useTourReader.start` |

- A refusal is drawn before the presses it refuses. While one no retry clears stands (`budget`, `flag_off`, `gemini_off`, `no_key`), the presses drop to outline.
- A walk and a press stopped by the same wall show one banner.
- A pano that did not answer draws its header and banner alone: no press, no face. A lane fault the press repeats is said once.
- `usePano` sets `press.trouble` when a dry run or press gets no answer. why: "Working out…" must not hang.
- A pano never cut is cut by its dry run (`readPano` armed false); the screen says "Cutting this pano into its six views…".
- The walk is the viewer's: one armed `readPano` per pano; `useTourReader` must expose a stop (`onStopRest`, ends after the pano in hand).
- Every press and Show all is 44 px tall below `md` (`max-md:h-11`).
- Reads happen on open and on a press: a tour or pano opening, a search that has rested, Try again, Back to the picker (it reads the list again quietly, since a press or a walk changed how far each tour is read), a press and the answer of one. No timer reads anything but the search's 300 ms rest. why: Cerberus's History polls every 30 s and so mounts only while shown; Tours stays mounted, so it must cost nothing hidden.
- Nothing starts while the view is hidden. The walk asks `isInLayout` before each press and stops after the pano in hand when the view is away; the search's rest timer runs only while `useViewShown` says the view is shown, so text typed just before leaving is read on the return; an answer that arrives hidden is held (`heldRef`) and the list, the tour and the pano are read once when the view comes back. why: a walk spends, and no one is watching its meter or Stop.
- The walk stops at a refusal (`status: 'refused'`, or a lane fault) with the reason as `lastRefusal`, except a refusal of that pano alone (`PER_PANO_REFUSALS` in `useTourReader.ts`: `views_refused`, a photo the engine cannot cut), which it passes and counts in `skipped`; a part read (`partial`) goes on to the next pano. why: the engine's own walker stops only at `_STOPS` (`budget`, `flag_off`, `context_degraded` and the three systemic reasons, `core/affected_areas/read.py`), the refusals every later pano would meet too. A walk that passed panos says so when it ends (`affectedAreas.read.skipped`), and a passed pano stays unread, so each later Read the rest tries it again (a refusal in 270 ms).
- The press's answer is the progress: the plan after a press is counted off the answer's pano (`planAfter`), not asked of the lane again. An answer that lands after the person went to another pano writes nothing of the pano on screen (`openKeyRef`; `patchedUnlessElsewhere`): the single press record and the single pano slot belong to the pano open now. A walk's answer for the open pano reads the pano AND its dry run again (`reload`), so the plan line and Read this pano follow the faces.
- A pano the tour lists with no views is never GET: the lane answers 404 "no kept views" until it is cut, which reads as "no longer on its tour". `usePano` hands the screen that pano with no views while the dry run cuts it (the "Cutting this pano…" line and the uncut sentence), the dry run's pano replaces it, and a cut tells the root to read the tour again so its listing and gallery tile follow. A dry run that is refused (`views_refused`) leaves it uncut with the refusal said in `ReadControl`.
- A reading of the client in dev shows each read of an open twice: `React.StrictMode` runs mount effects twice there. A build reads once.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/

## MAN-8577 — The Tours view — src/modules/affected-areas: where state lives, what the counts mean, the reads and the presses — Rules an editor must not break
section: The Tours view — src/modules/affected-areas: where state lives, what the counts mean, the reads and the presses/002 Rules an editor must not break

- Screens draw what they are handed; the Tours screens' hooks are called from `AffectedAreasView.tsx` only, and `fetch` and `api` calls live in `hooks/` alone. Exceptions: `TablesScreen.tsx` reads its own table (`useProving`) and sends its own Set threshold press (MAN-8581); `MarkScreen.tsx` reads its own queue (`useQueue`) and the photo of its area (`useImageUrl`); and the presses of the marks (`MarkBar`, `MissedDraw`, `UnderstandingMark`) send their own writes through `answerOfWrite` (`utils/laneTrouble.ts`), each keeping its press, refusal and note in its own state (MAN-8582). why: a press is one call whose answer is the redraw, and its state (out, refused, noted) belongs to the press, not to the hub.
- A mark's answer is laid over the pano, never fetched for: `useMarkedRegions(pano.value)` keeps the engine's answers beside the read and gives the pano with each answered region in place (the answer outranks a read of the same region that carries no mark or an older one, so a quiet reload landing late never redraws a judged area unjudged). The pano is read again only on a person's press: the switch coming back to Tours (`pano.reload()`), a read, Back.
- Tone is by judgment, never by kind: a region is painted by where it stands (`regionState` in `utils/regionLook.ts`), not by its codebook kind. why: the tone set stays five (MAN-739 rule 4) and the codebook has fourteen kinds. The kind is words (the list's label, the badge's accessible name).
- Null is "not judged": `regionState` reads a null `mark` or `standing` as `proposed`, never as unsure or rejected. So does a `threshold` of null: a kind with no line set has nothing to be "below", and its unmarked areas read `proposed` while `standing` is false (they stand only when marked, INV-8635).

`REGION_LOOK` (`RegionState`, five). `regionState` takes the first row that matches, top to bottom:
| state | when | tone | edge | wash | word (`affectedAreas.look.*`) |
|---|---|---|---|---|---|
| `not_a_change` | `mark.verdict === 'not_a_change'`: a reader's area set aside, or a drawn one taken back (the one mark the engine takes on a drawn area) | neutral | dashed | none | `notAChange` "Not a change" |
| `human` | `source === 'human'`, standing (any other mark) | positive | dashed | full | `human` "Drawn by hand" |
| `confirmed` | `mark.verdict` is `confirm` or `rename` | positive | solid | full | `confirmed` "Confirmed" |
| `unsure` | `mark === null && standing === false && threshold !== null`: below a line the operator set for the kind | info | dashed | light | `unsure` "Unsure" |
| `proposed` | anything else, a null `mark`, `standing` or `threshold` included | info | solid | full | `proposed` "Proposed" |

Info is the reader's word and positive the operator's; a dashed edge is anything the reader's word alone does not carry. `PanoScreen` turns each region into a `RegionShape` with `tone`, `edge` and `wash` (drawn by `RegionImage`, MAN-8579); `RegionList` shows the word.
- A room is affected on two authorities, both named (MAN-3035): `docusketchAffected` and `photosAffected === true`, never `regionsStanding`, which counts older damage. A `RoomEntry` is one per `(roomKey, floor)`. The words and the tone are MAN-8578.
- Names, never ids, in any line a person reads (INV-76); a tour is named by its job's label, else DocuSketch's own name for it (`tourName`: a pre-job tour), else its address, else "Tour with no job or address"; the address stands as a line of its own whenever the name above it is not the address (`addressBesideName`).
- A bare `YYYY-MM-DD` (date of loss) goes through `formatShortDate`, which reads it as that local day.
- `index.ts` exports the lazy view and `ViewBoundary` (its surround) only; siblings import each other by path, never through the barrel. `ViewBoundary` is not lazy: it must be there to catch the failure of the chunk it surrounds.
- `useLaneRead.replace(value, forKey)` takes the key its answer is for, never the render's own: a press made while the tour still listed the pano uncut has a null key in its render. It outranks every read begun before it (`replacedRef`). why: without both, a pano GET answering with the pre-press detail landed over the press's pano and left the faces unread.
- A refusal of one pano alone is passed by the walk, not a stop: `PER_PANO_REFUSALS` in `useTourReader.ts` holds only `views_refused`, as the engine's walker does (MAN-8576).
- An object URL is revoked with the record that names it (`useImageUrls` clears its record in the effect's cleanup). why: a list that comes back (the tour screen after a pano) would find its own old key and hand `<img>` revoked URLs: eight `ERR_FILE_NOT_FOUND` errors in the viewer run of 2026-10-17.

## Measured 2026-10-17 (live engine, :5183)
- `.verify/affected-areas-view.mjs`: Cerberus → Tours → CLARENCE TSE → Dinning Room → each face at 1280 and 390 px: the polygons on the photo equal the engine's regions per face, the badges read 1..n and are the list's rows and the engine's ordinals, a region chosen on the photo is the row's and back, Enlarge keeps every outline on the photo (0.00 px off), nothing is read while the pano idles or Fleet shows, and Read this pano on one unread pano answers 200 `read`, 6 views, and the face strip counts the engine's areas at once.
- `.verify/affected-areas-walk.mjs`: Stop after this pano ends the walk after the pano in hand; a view hidden mid-walk sends no second press and reads nothing until it returns, then reads the tour once; the walk goes pano to pano on each answer, in capture order.
- `.verify/affected-areas-rooms.mjs --tour <24-hex tourId> [--expect-affected] [--evidence <dir>]` (the tour must be linked to a job, else exit 2): Cerberus → Tours → the tour → the Rooms card at 1280 then 390 px, once in a light and once in a dark `openConsole({ dark })` context. The app keeps the theme server-side against the dev user, so each pass switches the stored theme (`ensureTheme`, `lib/console.mjs`) and a run leaves it on dark. `--expect-affected` FAILs the run unless at least one row on the screens reads "Affected …"; without it, a run that showed none ends on a `NOTE` line and still exits 0. `WIDTHS[0]` stays 1280: `openCerberusTab` finds "More views" only on the wide layout. Holds against `GET /api/affected-areas/tours/{tour}`: one row per wire room in its order, with name and floor; the words from `docusketchAffected` and `photosAffected` alone (written out in the script, not read from the component); warn tone and dot on the rows with words only; no fetch/XHR path of its own for rooms; no sideways scroll, measured on the Rooms card (`scrollWidth - clientWidth`; the card clips its overflow, so the page-level number is 0 whatever the rows do); no authenticated console error. Writes `rooms-<theme>-<width>.png`, `rooms-card-<theme>-<width>.png` and `rooms.json` (keys `<theme>-<width>`) under `.verify/shots/affected-areas-rooms/`.
- 2026-10-18, `.verify/affected-areas-rooms.mjs --tour 6ace5eb736f92c16415baa7e` with one demonstration confirm on its Garage drying-equipment region (deleted by its mark id after; the ledger counted back to 0 marks, 0 thresholds, 0 drawn areas): 26 PASS, 0 FAIL, exit 0, light and dark, 1280 and 390 px. One row, Garage, Floor 1, "Affected per the photos" (`docusketchAffected` false, `photosAffected` true, `regionsStanding` 1); at 390 px overflow `{"page":0,"rooms":0}`, warn tone and dot on that row.
- `.verify/affected-areas-tours-told.mjs [--evidence <dir>]` (reads the live lane first and exits 2 when it holds no unlinked tour with a loss type or none without facts; buys and writes nothing; its one stub is the rewritten pano GET below): at 1280 and 390 px, no picker row reads "Tour with no job or address" and every pre-job tour (8 on 2026-10-18) is in the picker by its DocuSketch name, with "No job linked"; an unlinked tour with a loss type draws it ("Water loss", from its own `context.lossType`) and the DocuSketch-alone line, no Property and no "isn't linked", its address beside its name; a factless unlinked tour draws the DocuSketch-alone line only; a room whose `demoBeforeTour` is false says "No demo recorded before the tour", true "Demo had begun before the tour". `openTour` throws unless the client asked the lane for the pressed tour's id (a label can belong to two tours). At 1280 only: the pano GET is rewritten so its first view reads `current: false` and no view `contextChanged` (every shown read on file is current today), and the pano offers Read again with `affectedAreas.read.againCurrent` naming the codebook's `contractVersion` and `model`. 2026-10-18: 27 PASS, 0 FAIL, exit 0.
- `.verify/affected-areas-view.mjs` presses nothing unless `--press` is given (one armed press, counted; it needs a cut, unread pano, which each press uses up), and `.verify/affected-areas-walk.mjs` runs nothing unless `--cases` names what to buy (A and B six reads each, C twelve; each pano read is read for good).
- Open: Read the rest has not met a refusal (a spent budget) on the live engine; a refusal is drawn from `ReadControl`'s own words.
- 2026-10-18, `.verify/affected-areas-gallery-fetch.mjs` (the 45-pano ESTHER VILLA tour; the live engine answers its GET, and the panos with no view cut are given a stand-in Ahead view, because cutting is paid and no live tour has 24 cut panos): 8 of 8 checks pass. Opening fetches 24 distinct photos and none of the other 21; "+N" fetches the 21 and none of the 24 again; a pano opened and left collapses the gallery and asks for none of the 21.
- Open: "Affected per DocuSketch" and "Affected per DocuSketch and the photos" have not been seen on a live tour: `docusketchAffected` is false on all 210 stored views of the 9 tours cut (2026-10-18).

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/

## MAN-8578 — TourRooms.tsx — the tour's room list: affected rooms and the authority that calls each (DocuSketch, the tour's photos), beside the pano gallery

`src/modules/affected-areas/TourRooms.tsx` is the Rooms card of `TourScreen`, between `ContextCard` and the pano gallery. Props: `rooms: RoomEntry[]` = `TourDetail.rooms` (wire MAN-8558): one row per room, a `(roomKey, floor)` pair (React key `roomKey:floor`), in DocuSketch's walk order. A row is not a control; it opens nothing.

## A row
| part | source |
|---|---|
| name | `roomWords(room.roomName, null, false, t)`; "Unnamed room" when null; never the key (INV-76) |
| floor | "Floor 2" from `room.floor`; nothing when null (DocuSketch gave the room no floor) |
| authority words | `authorityWords(room, t)` below; none when nobody calls the room affected |
| dot | `bg-tone-dot` under `data-tone="warn"` on every affected row, whichever authority spoke; the dot's column is kept on the other rows so the names align |

## Authority words (`affectedAreas.rooms.*` in `common.json`)
Two wire fields, both on `RoomEntry`: `docusketchAffected` (`boolean`, DocuSketch's sketch flag) and `photosAffected` (`boolean | null`, the verdict from the tour's photos for THIS room, MAN-8573; null = not judged).
| `docusketchAffected` | `photosAffected` | words | key |
|---|---|---|---|
| true | not true | Affected per DocuSketch | `affectedDocusketch` |
| false | true | Affected per the photos | `affectedPhotos` |
| true | true | Affected per DocuSketch and the photos | `affectedBoth` |
| false | false or null | (none) | |
- Never `regionsStanding`: it counts older damage, which never makes a room affected.
- The sketch stays an authority and the photos are a second; the words name which spoke (MAN-3035).
- Empty list: "DocuSketch named no rooms on this tour". Title "Rooms", inside the card, with no count (MAN-8576 §"What the numbers mean").

## Why a list of rooms beside a gallery of panos
- why: the units differ. A verdict is per room (`(room_key, floor)`, MAN-8573) and a `RoomEntry` is one per pair; a gallery tile is one pano and a room has several (100 newest tours: 2,156 panos in 632 room keys, MAN-8543).
- A tile's badge counts the areas that stand on its pano's views ("3 areas"), or says "2 found" while the reader found some and none stands yet, or "None found" (`listedAreas`, MAN-8576); older damage counts there and never affects, so a badge cannot say whether the room is.
- The gallery draws at most 24 tiles then "+N" (`RoomGallery` `GALLERY_MAX`), so an affected room's pano can sit behind "+N"; the list has every room.

## Layout
- Rows tile into 260 px columns (`repeat(auto-fill,minmax(260px,1fr))`): one on a phone, two at 1024, three at 1280, four from about 1440.
- 40-room commercial tour: 497 px tall at 1440, 684 px at 1280, about 1,731 px in one column. Median tour: 5 rooms.
- Check: `.verify/affected-areas-rooms.mjs` (MAN-8577 §"Measured 2026-10-17").

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/TourRooms.tsx

## MAN-8581 — The Tables screen of the affected areas Tours view (Tours · Mark · Tables) — src/modules/affected-areas: the proving DataTable of how right the reader is per kind, its sort, thin kinds and the Set threshold press

The Tables screen: `GET /proving` (the pinned model on the current contract) as one sortable row per codebook kind, each with its line (threshold) and a press that sets it. `TablesScreen` → `ProvingTable` → `ProvingDetail` → `ThresholdControl`. The Tours view's state, reads and rules: MAN-8575. The engine's lines: MAN-8569. The table's props and paint: MAN-8580.

## State
| fact | value |
|---|---|
| phase | live: the view root's Tours · Mark · Tables switch (`AffectedAreasView.tsx`) mounts Tables on its first show and keeps it mounted, `hidden` while another shows; `shown` (Tables on view, and the view itself) re-reads the table quietly each time it turns true again. Run whole against the live engine: `.verify/affected-areas-marking.mjs` |
| `TablesScreen.tsx` | the screen's state and presses: `useProving(shown)`, `sort`, `expanded`, `heldFrom`, `line`, `pressing`, `refusal`, `onSort`, `onExpand`, `onStep`, `onSetThreshold` |
| wire | `api.affectedAreas.proving({ model?, contract? })` → `GET /api/affected-areas/proving` → `Proving`; `api.affectedAreas.setThreshold(cls, { threshold })` → `PUT /api/affected-areas/thresholds/{cls}` → the `ProvingClass` as it now stands (`src/shared/api.ts`; types in `src/shared/affected-areas-types.ts`) |
| words | `affectedAreas.tables.*`; a failed read says `affectedAreas.trouble.gone_tables` / `failed_tables` through `LaneTrouble subject="tables"` |
| hook | `hooks/useProving.ts`: `useProving(shown)` reads `GET /proving` through `useLaneRead` (`{ value, trouble, retry }`) and reads again quietly when `shown` turns true again; `replaceClass(kind)` puts the `ProvingClass` a Set threshold answered in place of its row (into the tables as they stand when the answer lands) |

## Files
| file | holds |
|---|---|
| `TablesScreen.tsx` | the screen's data and state; passes `ProvingTable` its props: `proving`, `sort`, `onSort`, `expanded`, `onExpand`, `heldFrom`, `line`, `pressing`, `refusal`, `onStep`, `onSetThreshold` |
| `ProvingTable.tsx` | head ("How right the reader is", model · contract), the understanding line, the states, the `DataTable`, the column legend |
| `ProvingDetail.tsx` | the opened row: `ThresholdControl`, the sweep, renamed-to, latest notes; exports `Share` |
| `ThresholdControl.tsx` | the house `Stepper` and Set threshold; draws the press, sends nothing |
| `utils/provingModel.ts` | `tooFew(count)`, `isThin(kind)`, `lineWords(line, t)`, `sameLine(a, b)`, `thresholdWords(kind, t)`: how a figure reads, never its value |

## Table
- Columns in order: Kind (with its line: "Threshold 65% · set Oct 15", or "No threshold set: its areas stand only when you mark them"), Precision, Coverage, Missed, Judged, Right, Wrong kind, Not a change, Near the line. Precision and Coverage are at the kind's line; a kind with no line set shows them previewed at the engine's default, each said "at 0.50" under the figure (`Share`'s `previewedAt`, `affectedAreas.tables.atDefault`), and its sweep marks no row "In force". The control starts at that default, its stepper noted "not set", and its sentence says what stands while no line is set. ~1,212 px of table (measured at 1280: the Kind column holds its sentence in a fixed `w-44` wrapping span, so no line's words widen it, and every row is 96 px) in an 885 px frame at 1280, 356 on a phone (MAN-8580): it scrolls sideways at every size, so the order decides what shows first.
- Opens sorted by precision, lowest first (`FIRST_SORT`). A new column opens on the end that needs the operator: precision and coverage lowest first, counts highest first, kind A to Z; the same column flips. A dash sorts as nothing: last in both directions (`DataTable`, MAN-8580).
- States: read out (real heads over six `vv-skeleton` rows); lane fault (`LaneTrouble` with Try again; a failed re-read draws it above the table it kept); no kind judged on the random slice (info banner over a table whose lines can still be set); the kinds.
- The understanding line is counts ("18 of 22 judged right"), never a rate.
- What each count is (the engine's, MAN-8563): Judged, Right, Wrong kind and Not a change are the kind's regions on the random slice, judged confirm, rename and not a change; Near the line is marks made in Unsure first; Missed is areas drawn that the reader missed. Near the line and Missed enter no share. The legend under the table says each (`affectedAreas.tables.legend.*`).

## Rules an editor must not break
- The screen computes no figure. Every number is `GET /proving`'s; `provingModel.ts` decides only how it reads. why: a rate the screen computed would be a number the engine never stood behind.
- Thin: `isThin(kind)` is `kind.randomSlice.n < 10` (`FEWEST_FOR_A_PERCENT`). `tooFew(count)` is the same test for any share, over the count it was divided by: Precision over `nAt` (a sweep point's `n`), Coverage over `randomSlice.right`. A share over fewer than ten, or null, draws "—" with `sr-only` "too few judged" (`Share`). A judged kind's Precision can be a dash when its line sits high. The engine returns a share from one judgment up; the viewer decides. A thin kind's line stays settable, with a line saying to set it on his own judgment.
- `TablesScreen` sends Set threshold, not `ThresholdControl`. why: the control's states (moved, pressing, refused) draw from props, and the answer replaces its row where the table is held. The screen reads for itself (`useProving`) and sends through `answerOfWrite` (`utils/laneTrouble.ts`): the hook-owner rule is MAN-8577's. A step moves the line 0.05 (`Math.round(x * 20) / 20`, kept within 0 and 1); a press that would change nothing (the line in force, set by the operator) is refused by the control and again in the handler.
- Set threshold is never `disabled`: when it would change nothing it carries `aria-disabled` and the house `Button` refuses the press. why: `disabled` drops keyboard focus to the top of the app after a successful set. It is offered when the line is a default (`kind.isDefault`: setting it records the operator's choice) or the stepper has moved (`!sameLine(value, kind.threshold)`).
- Lines are compared with `sameLine` (within 1e-6), never `===`. Steps are 0.05 within 0..1 and rounded (`Math.round(x * 20) / 20`). A line is said in percent ("65%", `lineWords`), the unit a region's confidence is said in.
- `heldFrom`: the rows as they stood when the open row opened. `ProvingTable` sorts by them (`sortedBy`) so Set threshold's answer redraws its row where it stands. Opening a row with none held holds the current rows; opening another keeps them; closing lets them go. A head pressed while a row is open re-takes the held rows as they stand now (`heldFrom` = `proving.value.classes`) and re-sorts; with no row open it sets `heldFrom` null.
- A refusal is drawn above the button it refused (`ThresholdControl`, `role="alert"`): the engine's `not_a_person`, `bad_class`, `bad_threshold` (`affectedAreas.tables.refused.<code>`); a lane fault of `AFFECTED_AREAS_LANE_FAULTS` (`src/shared/constants.ts`) in the Tours view's words (`affectedAreas.trouble.<fault>`); `failed` or `gone` as `refused.failed`; anything else as `refused.other`.
- The opened row is `ProvingDetail`: two columns from 840 px of container, one below. Its width is `calc(100cqi-34px)` and `sticky left-4`, against the container `ProvingTable` makes of the table's wrapper. why: the row spans every column, wider than the frame on a phone. The 34 px are the frame's two 1 px borders and the panel's 16 px padding each side: change either and the panel is wrong.
- The sweep lists the engine's lines (0.3 to 0.9 in 0.1 steps) with the line in force marked "In force" and the stepper's moved line "If set"; either one falling between priced lines takes a figure-less row. A kind never judged on the slice shows one line in place of the sweep.

## Open
- The house `Stepper` is ~35 px tall on touch where Verve asks 44; five screens share it (Set threshold itself is 44 below `md`, `max-md:h-11`).
- `ProvingDetail` keeps a local `kindName(cls)` over the table's kinds; `kindName(cls, codebook)` is in `utils/tourModel.ts`: one of them should go, and the table carries no codebook.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/hooks/useProving.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/ProvingDetail.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/ProvingTable.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/TablesScreen.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/ThresholdControl.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/utils/provingModel.ts

## MAN-8582 — The marking pieces — src/modules/affected-areas: the mark bar, Missed one, the Mark screen and the understanding mark

The operator's marks on the Tours view: Confirm, Rename to… and Not a change on an area, Missed one (a drawn area), the Mark screen (a queue the engine orders), and Right / Wrong on a read's understanding. Engine side: MAN-8560. The Tours view's state, reads and rules: MAN-8575. What an editor must not break here: MAN-8583. `RegionImage` props and paint: MAN-8579.

## State
| fact | value |
|---|---|
| phase | live: every press is a row and the answer is the redraw. Run whole against the live engine, every mark through the real lane, its rows deleted by id after (`openConsole()` on :5183): `.verify/affected-areas-judgments-seen.mjs` runs today (the understanding mark on the wire and on the card after a reload, a batch of 20 skips, the walk starting over, a drawn area's served badge; its step 6 was extended after the last run and is unrun: MAN-8583 §"Open"). `.verify/affected-areas-marking.mjs` drives the other presses (Confirm, Rename, Not a change, Missed one, the Tables line) but exits 2 at target selection: it wants an unmarked area that already stands, and none does while no line is set |
| shell / drawn | a shell (`MarkBar`, `MissedDraw`, `UnderstandingMark`, `MarkScreen`) holds the state and sends the press; its drawn piece (`MarkPresses`, `FacePhoto`, `UnderstandingVerdict`, `MarkQueue`) takes every state as props. Same convention as the Tables (MAN-8581) |
| wire | `api.affectedAreas.mark(regionId, MarkRequest)` → `Region`; `.missed(sha, MissedRequest)` → `Region`; `.markUnderstanding(readId, UnderstandingMarkRequest)` → `UnderstandingMarkResult`; `.queue({ mode, cls, limit, skip })` → `Queue` (`src/shared/api.ts`; types in `src/shared/affected-areas-types.ts`). The `queue` sent with a mark is `MarkQueue`: `unsure` · `random` · `browse` |
| words | `affectedAreas.{screens,layer,groups,mark,missed,understanding}.*`, `affectedAreas.trouble.{gone,failed}_queue`; refusals `affectedAreas.mark.refused.<code>`: the nine engine reasons (`not_a_person`, `no_region`, `no_read`, `no_image`, `bad_verdict`, `bad_class`, `same_class`, `bad_box`, `note_too_long`), `failed`, `other` |
| shared | types `ToursScreenKey` (`tours` · `mark` · `tables`), `RegionLayer` (`standing` · `all`), `MarkWalk`, `MissedStage` in `src/shared/types.ts`; `MARK_NOTE_MAX` (500, the engine's `MAX_NOTE`), `MIN_REGION_AREA` (1e-4, the engine's `seat/normalize.MIN_AREA_FRAC`: the floor `MissedDraw` holds a drawn box to) and `AFFECTED_AREAS_LANE_FAULTS` in `src/shared/constants.ts`; `kindName(cls, codebook)` in `utils/tourModel.ts` (the kind an area counts as is the engine's `region.effectiveClass`, `region.class` only for a Region it left unjudged) |
| hooks | `hooks/useMarkedRegions.ts`, `hooks/useQueue.ts` (and `hooks/useProving.ts`, MAN-8581); the writes go through `answerOfWrite` in `utils/laneTrouble.ts`, which answers the engine's `Region` / `UnderstandingMarkResult` / `ProvingClass`, or the one reason it was not kept (the body's refusal code, the lane's fault, or `failed`) |

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/AffectedAreasView.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/FacePhoto.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/hooks/useMarkedRegions.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/hooks/useQueue.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/LayerSwitch.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkBar.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkPresses.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkPress.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkQueue.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkScreen.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MissedDraw.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/NoteDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/PanoScreen.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/RegionList.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/ToursSwitch.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/UnderstandingCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/UnderstandingMark.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/UnderstandingVerdict.tsx

## MAN-8601 — The marking pieces — src/modules/affected-areas: the mark bar, Missed one, the — Files
section: The marking pieces — src/modules/affected-areas: the mark bar, Missed one, the Mark screen and the understanding mark/001 Files

| file | holds |
|---|---|
| `MarkBar.tsx` | shell: the press out, its refusal, the note and its dialog; props `region`, `codebook`, `queue` (the type `MarkQueue` in `affected-areas-types.ts`: `unsure` · `random` · `browse`), `onMarked(region)`; used by `PanoScreen` (`queue` `browse`) and `MarkQueue.tsx` (`queue` its mode); keyed by `region.regionId` |
| `MarkPresses.tsx` | drawn: Confirm · Rename to… (a `Menu` of the codebook's kinds, the area's own left out) · Not a change · Add a note; handles `data-mark-bar`, `data-mark-press` = `keep` · `confirm` · `rename` · `not_a_change` · `note` |
| `MarkPress.tsx` | `JudgmentPress` (a `Button` in a region-look tone), `KeyCap` (Y, R, N, S), `MarkRefusal` (warn banner, `role="alert"`, `data-mark-refusal`) |
| `NoteDialog.tsx` | the note in a `DialogFrame`, at most `MARK_NOTE_MAX`; Keep the note holds it for the next press and sends nothing; mounted only while open |
| `MissedDraw.tsx` | shell: Missed one's stage, note, refusal; replaces `PanoScreen`'s photo div |
| `FacePhoto.tsx` | drawn: the face block (tool row, `RegionImage`, the chosen area's `bar`, the new-area form); handles `data-missed-step`, `data-missed-press` = `start` · `cancel` · `kind` · `note` · `save`, `data-missed-form` |
| `LayerSwitch.tsx` | Standing · All `SegmentedControl`, handed to `MissedDraw` as `tools` |
| `ToursSwitch.tsx` | Tours · Mark · Tables `SegmentedControl` at the top of `AffectedAreasView` |
| `MarkScreen.tsx` | shell: the queue's `mode` and `kind`, `walk` = `useQueue(mode, kind, shown)` (`MarkWalk`), the photo's `useImageUrl`, keys, Skip (waits while a mark is out) |
| `MarkQueue.tsx` | drawn: mode switch, kind `Select`, one area (question, place, count left, photo with `focusId`, the reader's words, `MarkBar`, Skip); states reading · lane fault · spent · an area whose pano has not answered; handles `data-mark-screen`, `data-mark-mode`, `data-mark-left`, `data-mark-press="skip"` |
| `UnderstandingMark.tsx` | shell: the verdict out, refusal, the last press's answer, the Wrong field; the card draws `standingMark(answer, read.understandingMark)`: the read's newest mark from the wire, or this press's answer while it is the later |
| `UnderstandingVerdict.tsx` | drawn: "Is this account right?" with Right and Wrong; handles `data-understanding-mark`, `data-understanding-press` = `right` · `wrong` · `send-wrong` |

## The two queues (`MarkScreen`'s `mode`, opens on `unsure`; the engine orders them: MAN-8562, MAN-8572)
| mode | label | the engine serves | what its marks are for | the screen says |
|---|---|---|---|---|
| `unsure` | Unsure first | unmarked model regions outside the random slice, nearest their kind's line first (to 0.5 where none is set: the distance orders the queue and decides nothing, MAN-8562) | finding each kind's line fast; the Tables count them as Near the line and no share takes them in (MAN-8563) | `affectedAreas.mark.unsureHint` |
| `random` | Random slice | unmarked held-out regions in one fixed order | measuring the reader; they feed Judged, Right, Wrong kind, Not a change and so Precision and Coverage | `affectedAreas.mark.randomHint` |

- Both modes draw one facts line under the reader's words (`MarkQueue.tsx` `facts`): "{n}% sure", "threshold {n}%" (or "No line set" where the kind has none: `region.threshold` null), the basis ("seen in the photo") and, when `region.holdout` is true, "held out to measure the reader". The engine serves no held-out area in `unsure`.
- One area at a time: the question "Is this {the reader's kind}?", where it is, "{n} left", its photo, the reader's words, `MarkBar`, Skip.
- The mode and the kind are the operator's choice; the screen never changes either. A new choice starts the walk over.
- A queue with nothing in it says "Nothing left to mark" and why, by kind (`emptyKind`) or by mode (`emptyUnsure`, `emptyRandom`).
- Every mark sent from the screen carries the mode as its `queue` (`unsure` · `random`); the pano screen's carry `browse`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/AffectedAreasView.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/FacePhoto.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/hooks/useMarkedRegions.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/hooks/useQueue.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/LayerSwitch.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkBar.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkPresses.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkPress.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkQueue.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkScreen.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MissedDraw.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/NoteDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/PanoScreen.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/RegionList.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/ToursSwitch.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/UnderstandingCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/UnderstandingMark.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/UnderstandingVerdict.tsx

## MAN-8602 — The marking pieces — src/modules/affected-areas: the mark bar, Missed one, the — How each is wired
section: The marking pieces — src/modules/affected-areas: the mark bar, Missed one, the Mark screen and the understanding mark/002 How each is wired

| piece | file | does |
|---|---|---|
| `useMarkedRegions(pano.value)` | `AffectedAreasView.tsx`, `hooks/useMarkedRegions.ts` | holds the operator's answers by pano beside the read: a mark's answer replaces its region where it stands, `onMissed` appends the drawn one to its view, never a refetch; `PanoScreen` draws the laid-over pano. An answer outranks a read of the same region that carries no mark or an older one (compared by `markId` and `markedAt`); a read that carries the same mark takes over, with its current `standing` and line. `onMarked` / `onMissed` write under the pano the answer is FOR |
| Back to the tour | `AffectedAreasView.tsx` | calls `tour.reload()` quietly: a judgment moves the tour's tile counts, its rooms' "Affected per the photos" and the face a pano opens on. The pano is not refetched |
| the switch | `AffectedAreasView.tsx` | `ToursSwitch` outside the keyed entrance; Mark and Tables mount on first show (`openedScreens`) and stay mounted, `hidden` while another shows. A surface shown again reads again, quietly, on that press: Tours the open pano (`pano.reload()`), else the open tour, else the list; Mark and Tables when their `shown` turns true (`useWhenShown`) |
| the layer | `AffectedAreasView.tsx` (`layer`, All at first and on each pano opened), `PanoScreen.tsx` | `LayerSwitch` as `MissedDraw`'s `tools`. On Standing the photo keeps the regions whose wire `standing` is not false, and the chosen area whatever its flag; the list and the caption keep every area |
| Missed one · the bar | `PanoScreen.tsx` | `MissedDraw` in place of the photo div when the pano has answered and the face has a view (`key={view.sha256}`; `nextOrdinal` = highest ordinal of ALL the view's regions + 1); `MarkBar` on the chosen region as its `bar` (`queue` `browse`) |
| kind names | `PanoScreen.tsx`, `RegionList.tsx` | outline and list name a row by `region.effectiveClass ?? region.class`, so a rename redraws them |
| list scroll | `RegionList.tsx` | in the stacked layout (the nearest container under 720 px) the row scroll is skipped: the face block brings photo and presses into view |
| the understanding | `UnderstandingCard.tsx` | `<UnderstandingMark key={read.readId} read={read} />` for a read with a `readId` |
| the queue | `MarkScreen.tsx`, `hooks/useQueue.ts` | `useQueue(mode, kind, shown)`: a batch of 20 from `api.affectedAreas.queue`, read again under a new key on a mode or kind change and when its last area is passed, quietly when `shown` turns true again; `next(answered)` after a press (a mark hands over its region, a skip null); the walk's newest 50 skipped region ids ride the read as `skip` (fixed when a batch is spent and part of its key), so the batch after 20 skips is the next 20; an engine answer with no item and `remaining` above zero means every area left was skipped, and the walk forgets its skips and reads again with none; `left` = the batch's `remaining` less the areas of that batch judged here, and an area it holds an answer for is passed over (a late batch never offers a marked area again), as is an area skipped in this queue (kept for the mode and kind it was skipped in; all skipped starts the walk over); neighbours from `panoFor(item.tourId/item.panoId)`, the view found by `sha256`, a neighbour judged on this screen drawn as answered |
| the keys | `MarkScreen.tsx` | Y, N and R click `[data-mark-screen] [data-mark-press=…]`, S skips; on the host window only while `shown`, and never while a field has the focus or a dialog, menu or list is up |

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/AffectedAreasView.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/FacePhoto.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/hooks/useMarkedRegions.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/hooks/useQueue.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/LayerSwitch.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkBar.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkPresses.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkPress.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkQueue.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkScreen.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MissedDraw.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/NoteDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/PanoScreen.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/RegionList.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/ToursSwitch.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/UnderstandingCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/UnderstandingMark.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/UnderstandingVerdict.tsx

## MAN-8583 — The marking pieces — rules an editor must not break: presses, the counted kind, notes, Missed one, scroll, and what was measured

The pieces, their markers and the wire: MAN-8582. Engine verdicts and refusals: MAN-8560. Hook-owner and tone rules of the Tours view: MAN-8577.

## Rules
- Nothing is marked for the operator: no confirm-all, and a confidence never turns an area green. One press is one `api.affectedAreas.mark`; the answer `Region` is the redraw.
- A press is tinted by the look the area takes when pressed (`REGION_LOOK`; `JudgmentPress` with `data-tone`; no `Button` variant, since every variant carries a hover colour). Confirm = confirmed fill, Rename to… = confirmed outline (`RENAME_FACE`), Not a change = set-aside grey.
- One mark out at a time: while `out` is non-null every press refuses a second. A busy press keeps its focus (`busy`, never `disabled`).
- The kind an area counts as is `region.effectiveClass ?? region.class`, never `region.class` alone: the wire's `class` stays the reader's after a rename, and `effectiveClass` is shadow-connector's `standing.effective_class`, computed once in the engine (the fallback is only for a Region the engine left unjudged; the browser derives it from no mark). Every line that names an area's kind reads it; the Mark screen's question names the reader's own `region.class`.
- A renamed area leads with Keep {kind} (a rename to the kind it counts as; the engine refuses only the reader's own kind) and its Confirm reads Put back {the reader's kind}. why: without Keep a note could ride only a press that undoes the rename.
- An area drawn by hand (`source === 'human'`) offers Not a change alone and no note; once taken back it offers no press. `confirm` and `rename` on it are `bad_verdict` (MAN-8560).
- A note rides only on a press and is spent when a mark is answered; `NoteDialog` sends nothing. `MarkBar` is keyed by the area so a kept note never rides to the next.
- Y, N, R and S click the presses' own `data-mark-press` elements: the same press a pointer makes. The keys are the Mark screen's alone. why: on the pano screen a key would fire while a note is typed.
- Missed one: `MissedDraw` replaces the photo; `bar` is hidden, never unmounted, while a box is drawn or held. why: no press of another area may stand beside the box, and the bar returns as it was. The floor on a drawn box is the engine's area floor (`MIN_REGION_AREA` = 1e-4, `seat/normalize.MIN_AREA_FRAC`; the engine stays the authority, `bad_box`): the library reports every box that has a width and a height, and `MissedDraw` turns one under the floor back before sending, in the engine's own sentence (`affectedAreas.mark.refused.bad_box`) — at its release, which leaves Missed one drawing (the photo takes the next drag at once) and puts the sentence in the floor line's place until the next release; no box under the floor reaches the kind, the note or Save, so no request leaves for it. The corners are rounded to 6 places and the area to 8 before the compare, as the engine does, so a box of exactly the floor is kept. `FacePhoto` says the floor in a line under the photo while Missed one is drawing (`affectedAreas.missed.floor`: about 10 by 10 pixels), unless a refusal stands in its place. Save waits for a kind; a refused Save returns to `drawn` with box and kind kept.
- `FacePhoto` owns the scroll on a choice: it brings its block into view a frame after an area is chosen (`blockRef`, `scrollIntoView({ block: 'nearest' })`); `MarkPresses` never scrolls itself. why: on a phone photo and presses fit one screen, and the list scrolls its own row in the same commit.
- `LayerSwitch` filters on the wire's `standing`, never re-derived. On Standing the chosen area stays drawn whatever its flag, so an area chosen in the list is never judged unseen. The list keeps every area either way.
- The understanding mark is the read's newest, from the wire (`ReadState.understandingMark`), and is said after any reload; a press's answer replaces it at once (`standingMark`: the later of the two, the wire's when they are the same mark). A queue item carries no neighbours: `useQueue` reads its pano to dim them, and draws a neighbour judged on this screen as the engine answered it unless the pano read carries the same mark or a newer one (`answerOutranks`, shared with `useMarkedRegions`).

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/AffectedAreasView.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/FacePhoto.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/LayerSwitch.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkBar.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkPresses.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkPress.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkQueue.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkScreen.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MissedDraw.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/NoteDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/PanoScreen.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/RegionList.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/UnderstandingCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/UnderstandingMark.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/UnderstandingVerdict.tsx

## MAN-8603 — The marking pieces — rules an editor must not break: presses, the counted kind — A skipped area is not marked, so it stays in the queue and in `remaining`. The screen remembers its
section: The marking pieces — rules an editor must not break: presses, the counted kind, notes, Missed one, scroll, and what was measured/001 A skipped area is not marked, so it stays in the queue and in `remaining`. The screen remembers its

- A skipped area is not marked, so it stays in the queue and in `remaining`. The screen remembers its skips by region id (`skipped`, oldest first, kept for the mode and kind they were made in: another queue starts with none, a skip made there replaces them, and coming back before one is made finds them); the newest 50 ride the next read as `GET /queue?skip=` (the engine's bound), so the engine leaves them out and the batch after 20 skips is the next 20. The skips sent are fixed when a batch is spent, as part of the read's key, so a skip inside a batch never reads again; those made in the batch on screen, and any older than the newest 50, are passed over locally, so Mark shown again after Tables comes up where it was left. When the engine answers no item and a `remaining` above zero, every area left was skipped: the walk forgets its skips and reads again with none (the render-time guard in `useQueue`), since "Nothing left to mark" would be false; the same holds in the batch in hand when it holds only areas skipped before the newest 50. `left` is the batch's `remaining` less the areas of that batch judged here (`answers`), never less the skips.
- The queue passes over an area it holds an answer for: a batch read that began before a mark and lands after it still serves the marked area, and it is not offered again. A mark answered after the operator has skipped past its area is kept and counted and leaves the screen where it is (`onScreenRef`).
- A skip waits while a mark is out (`MarkScreen.onSkip` reads the bar's `aria-busy` presses): a skip on the last area of a batch would read the next batch before the engine has the mark, which would serve the marked area again with its presses on.
- A drawn area's answer is laid over the saved copy of it too (`laidOver` applies `answered` to the `drawn` copies): until the pano is read again that copy is the only one the screen has, and the one press the bar offers on it, Not a change, would otherwise redraw nothing and be offered again.
- The keys read `[data-mark-screen] [data-mark-press=…]` on the host window and wait while a field has the focus or a `[role="dialog"]`, `[role="menu"]` or `[role="listbox"]` is in the document.
- `Menu` draws no group headings: the kinds stand in the codebook's order, which is its groups' order, and each row carries its group's word as its `description` (`affectedAreas.groups.<group>`: Damage, Work already done, The source, Older damage) — in Rename to… (13 kinds, its own left out) and in Missed one's kind menu (all 14). The Mark screen's kind `Select` shows the same word as a hint. A row of two lines is about 60 px, so the menu is 780–840 px tall: it hangs under its trigger and scrolls with the page, its last row reachable at 390 and at 1280 px.
- Words name kinds and places, never ids (INV-76).

## Measured 2026-10-17 (the presses and the Mark screen, light and dark, 1280×800 and 390×844, on the live :5183 app)
- Presses: 36 px at a desk, 44 px on the phone. At 1280×800 the Mark screen fits above the fold: the Tours view starts ~180 px down the panel, so photo and answer split the width evenly.
- `FacePhoto` block: 620 of the phone scroller's 799 px with the caption, measured before the scroll moved into it; the move itself is not re-measured.
- Verve's tone pairs on the presses: 4.48:1 Confirm, 4.46:1 Not a change (light), under AA's 4.5:1; ghost Add a note 2.81:1 (MAN-742). A palette call.
- Not shot dark: the pano with its presses and the Tables (the Mark screen was).

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/AffectedAreasView.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/FacePhoto.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/LayerSwitch.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkBar.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkPresses.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkPress.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkQueue.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkScreen.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MissedDraw.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/NoteDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/PanoScreen.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/RegionList.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/UnderstandingCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/UnderstandingMark.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/UnderstandingVerdict.tsx

## MAN-8604 — The marking pieces — rules an editor must not break: presses, the counted kind — Measured 2026-10-17 (the live :5183 client over the live engine, `.verify/affected-areas-marking.mjs
section: The marking pieces — rules an editor must not break: presses, the counted kind, notes, Missed one, scroll, and what was measured/002 Measured 2026-10-17 (the live :5183 client over the live engine, `.verify/affected-areas-marking.mjs

## Measured 2026-10-17 (the live :5183 client over the live engine, `.verify/affected-areas-marking.mjs`, 66 of 66 checks, run on the code with the skip memory and the skip guard)
- Every mark goes through the real lane as the signed-in operator (`marked_by` the operator's name, `origin` `internal`); each is deleted by id afterwards, before and after counts equal (marks 0, human regions 0, thresholds 0, regions 72).
- Confirm, Rename, Not a change, Missed one and the understanding Wrong each answer 200 and the answer is the engine's own read of the region (`mark.markId`, verdict, `standing`) on `GET …/panos/{pano}`; each is one request, the photo element is the same one after it.
- Standing hides exactly the regions whose wire `standing` is false (2 of 3 drawn; the list keeps 3). The Mark screen shows each item's confidence and threshold (Unsure first) or the held-out flag (Random slice) as `GET /queue` sent them; S skips with no row, Y and N by key mark from the queue they were made in, and "N left" falls by one to the engine's `remaining`.
- The Tables' counts equal `GET /proving` for all fourteen kinds; Set threshold moved Containment to 100% and the answer, the row and `GET /proving` agree; back on the pano the area of that kind went from standing to not standing.
- Three real engine refusals, bent in flight (`bad_class`, `note_too_long`, `bad_box`), are said in words and write nothing; the browser logs each 422 as a console error of its own, and nothing else is logged.
- 390 px: no sideways page scroll on the pano with its presses nor on the Mark screen.

## Measured 2026-10-18 (the live :5183 client over the live engine, `.verify/affected-areas-judgments-seen.mjs`, 15 of 15 checks; steps 1–5 and 7 as they now stand, step 6 before it told the served badge from the stored one)
- Understanding mark: the pano GET reads `understandingMark` null, then the Wrong mark with its note, then the newer Right; the tour GET carries the same mark; the card says wrong with its note after a full reload, at 1280 and 390 px.
- Skip: `GET /queue?mode=unsure&limit=3&skip=<first three ids>` serves items 4 to 6 of the unskipped queue. A batch of 20 skips on the Mark screen writes no row, sends those 20 as `skip` and the screen comes up on the engine's first area for it.
- Bad `skip` (51 ids, upper-case, not a uuid, a trailing comma): 422 on the engine and on the lane, before any query.
- Start over: a kind with two areas, both skipped, reads `no skip → skip(2) → no skip`; the screen is on "2 left" again.
- A drawn area on a view read twice is served the shown read's region count plus one (`2` on a view with 1 area). Rolled-back probe on a view whose newer read held more regions: stored `model 1, human 2, model 2`, served `model 1, human 3, model 2`.
- The pano, tour and both queue answers equal the pre-change snapshots apart from the new fields (`understandingMark`, `effectiveClass`).
- Cleanup: every mark and drawn area deleted by the id its POST answered, psql by those ids 0 rows, ledger back at 0 marks, 0 drawn areas, 0 thresholds.

## Measured 2026-10-18 (the live :5183 client over the live engine, `.verify/affected-areas-marking-boxes.mjs`, 31 of 31 checks at 1280 and 390 px, one session per width)
- A 0.5 × 0.015 box (75 times the floor) is held with no sentence, sent, and kept: the engine answered 200 with a human area, `areaFrac` 0.0075; it is deleted by the id its POST answered, psql by that id and by its mark's id answers no row, drawn areas 0 before and after.
- A 0.005 × 0.005 box (area 2.5e-5) was held on the photo with "That box is too small to be an area: drag a bigger one", and no request left; Athena then found the photo took no further drag in that stage. A release under the floor now leaves Missed one drawing and puts the sentence in the floor line's place, and the script's step 2 asserts that and a real next drag; that step has not run since it was rewritten.
- Rename to… lists 13 kinds and Missed one's menu 14, in codebook order, each row with its group's word; the last row scrolls into view and a press at its centre lands on it (the 390 px Rename menu's last row ends flush with the screen's bottom edge).

## Open
- `.verify/affected-areas-marking.mjs` takes back a reader's area and never a drawn one, walks no stale batch (one read before a mark and landing after it), and exits 2 at target selection while no line is set: its target selection and Tables section need rewriting for "a line moved over an area makes it stand".
- `.verify/affected-areas-judgments-seen.mjs` step 6 (two areas drawn on a view read twice, the first deleted by id: the second served count + 1 while the ledger stores count + 2; the array in badge order; the take-back's answer under the served badge) passes `node --check` and has not run. The file is ~360 lines in seven steps.
- The skip guard (`markIsOut`) is read, not run: no probe skips with a mark out.
- `MarkQueue`'s `shapeOf` and `PanoScreen`'s shapes map derive the same `RegionShape` (tone, edge, wash, the name of the kind it counts as): one of them should go.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/AffectedAreasView.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/FacePhoto.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/LayerSwitch.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkBar.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkPresses.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkPress.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkQueue.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkScreen.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MissedDraw.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/NoteDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/PanoScreen.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/RegionList.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/UnderstandingCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/UnderstandingMark.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/UnderstandingVerdict.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/affected-areas-marking-boxes.mjs

## MAN-8621 — memory-assert — how a rules / requirements card lands on its shelf

`memory-compose.ts::compose`, `section` branch. Targets: `rules` → `~/.claude/RULES.md`, anchor `## Rules`; `requirements` → `~/.claude/REQUIREMENTS.md`, anchor `## Requirements`. Both are `mustExist`: a missing file refuses before `compose` runs. "Blank" is `current.trim() === ''`. "Carries the anchor" is a line of the body that trims to the anchor.

| shelf | body | result |
|---|---|---|
| blank | carries the anchor | body is the whole file plus one trailing `\n` — a restore, title and note included |
| blank | does not | `<title>\n\n<anchor>\n\n<body>\n` — the title (`# RULES.md` / `# REQUIREMENTS.md`) and the heading are minted here, so the session-start shape check (`hooks/shelf_health.py`) finds the shelf healthy; a heading-carrying restore is written exactly as given and judged as written |
| content, anchor present | does not | body lands at the END of the anchor's section: before the next `## ` heading, else at file end |
| content, anchor present | carries it | refused: "already has content … only an empty shelf takes it … queue them without the heading line" |
| content, anchor absent | any | refused: "has no “<anchor>” section to add this under … will not invent one" (checked before the row above) |

- why blank is writable: no session can add a line to a shelf (`hooks/enforce_shelf_channel.py`), so a wiped shelf has no heading to land under and the queue is the only door that refills it.
- why content refuses a heading-carrying body: its title, note and second heading would land INSIDE the section, and every later entry above them.
- Caps run on the composed result against `''` for a blank file. `rules` / `requirements` hold 60 lines / 2,000 chars (MAN-604): a restore past them refuses and the file stays blank.
- Refusal remedy for the total-size reason: blank shelf → "the file is empty, so there is no entry to trim — shorten this body."; shelf with content → "trim an entry before adding another."
- Landing mode: the `rules`, `requirements` and `claude` steps carry `readOnly` (`memory-plan.ts`), and `memory-assert.ts::atomicWrite` sets the temp file to 0444 BEFORE the rename — the shelf never exists writable at its real path, so a stray `> RULES.md` fails with "Permission denied". The rename needs only the directory's write bit, so the door passes over the 0444 file it replaces. Memory notes and the project `MEMORY.md` keep a plain write's mode. `hooks/shelf_health.py` re-applies 0444 at every main session start (`SHELF_MODE` there, `SHELF_FILE_MODE` here: one number in two languages).
- Restore a wiped shelf: queue its full text as ONE `rules` / `requirements` card, before any other entry, with no line reworded. `commands/remember.md` §2 gives the same instruction to the proposing session.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/memory-intake/memory-assert.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/memory-intake/memory-caps.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/memory-intake/memory-compose.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/memory-intake/memory-plan.ts, /home/lyphe/.claude/commands/remember.md
