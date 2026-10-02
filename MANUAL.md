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

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useDeviceSettings.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useElapsed.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/ActionMenu.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Dialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Lightbox.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Menu.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Select.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Tabs.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Tooltip.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/useZoomPan.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/utils.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/host-window-home.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/host-window-kit.mjs

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
- `.verify/lib/scratch-chat.mjs` is the shared helper for a probe that sends a real turn: `createScratchChat(session)` (in `PROBE_PROJECT`, `.verify/lib/probe-project.mjs`), `openScratchChatOnHaiku(session, id)` (picks Haiku in the composer's `MODEL_CHIP`; throws if the chip does not read Haiku, so no turn is sent), `sendTurn(page, text)`, `deleteScratchChat(session, id)`; constants `MODEL_CHIP`, `SCROLLER`, `COMPOSER`.

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
| `utils/sessionPickerGroups.ts` | `groupsFromProjects(projects, marks, nameOf)`, `groupsFromSimpleList(rows, marks)` |
| `utils/projectStarOverrides.ts` | the reader's toggled stars, shared with the sidebar controller: `useProjectStarOverrides()`, `withResolvedStarState(projects, overrides)` (MAN-7507) |
| `utils/sidebarProjectFormatting.ts` | exports `getSessionName(session: ProjectSession, t)`: summary, else name, else `projects.newSession`; `sortProjects(projects, order)` |

Types in `src/shared/types.ts`, group `SIDEBAR`: `SessionPickerStatus` (`'ready' \| 'loading' \| 'error'`), `SessionPickerRow`, `SessionPickerGroup` (`key`, `heading: string \| null`, `rows`), `SessionPickerMarks` (`running`, `awaitingInput`, `subagentRunning`: `ReadonlySet<string>`).

## Groups

| shape | blocks | row |
| --- | --- | --- |
| simple list (`groupsFromSimpleList`) | one, key `simple-list`, `heading: null`, feed order kept | `standalone`: icon (`SimpleChatIconGlyph`), 13px title, 10px project line; `unread` from the feed |
| project tree (`groupsFromProjects`) | one per project in the order handed in, `key` = `projectId`, `heading` = `displayName \|\| projectId` | one line; `projectName`, `icon` null, `unread` false; sessions from `getAllSessions(project)`, newest first |

- A project with no sessions stays a block: `projects.noConversations` under its heading. why: a missing project reads as not there.
- Headings are `sticky top-0 bg-card`; New chat is pinned outside the scrolling list.
- `nameOf` is passed in; the file holds no copy of the naming rule.

## Data — `useSessionPicker`

| when | do |
| --- | --- |
| `useSimpleChatListPreferences().enabled` | groups = `groupsFromSimpleList(list.rows, marks)`; `list` = `useSimpleChatList(selectedSessionId, enabled)`, whose `rows` is `flattenChats(items)` — every chat of the feed's tree, a folder's chats in its place (MAN-7524) |
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
9. Selectors: `[data-picker-item]`, `role="group"`; `[role="menu"]` and `[role="menuitem"]` select nothing. Test ids: `session-picker-trigger`, `-panel`, `-new`, `-row` (with `data-session-id`), `-flat`, `-project`, `-project-empty`, `-empty`, `-load-more`.

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
| `dragging` | `SimpleListItemRef \| null` |
| `dropTarget` | `SimpleListDropTarget \| null` |
| `dragProps(ref)` | the carry's pointer props for one row; chat rows and folder headers both spread it; `useSimpleChatDrag` returns it (MAN-7525) |
| `onSelectChat`, `onArchiveChat`, `onDeleteChat`, `onChooseIcon` | `(chat) => void` |
| `onRenameChat(sessionId, title)` | |
| `onMoveToFolder` | `((chat) => void) \| null`; `null` = no "Move to folder…" entry on any row |
| `onToggleFolder`, `onDeleteFolder` | `(folder) => void` |
| `onRenameFolder(folderId, name)`, `onFreshShown()`, `t` | |

- One `data-testid="simple-chat-block"` per top-level item, `relative flex flex-col gap-1`, carrying `data-item-kind` (`chat` \| `folder`) and `data-item-id`. The block, not the row, carries them: a carried folder lands beside a block.
- A folder's block = header + its chats' rows (`isNested` true), the rows only while `!folder.collapsed`; a folded folder mounts no chat row.
- The folder's dot = `folderDot(folder.chats.map(chatMarks))` (MAN-7522).
- `holdsSelected` = folder folded and one of its chats is the open chat.
- Rhythm is uniform on purpose: a folder's chats sit `gap-1` from the header, the same air as between blocks; the indent carries the grouping. The block's `gap-1` is the one knob.
- Fade: a carried chat fades as its own row; a carried folder fades as its whole block (`opacity-50`).
- `simple-chat-drop-end` (`h-0.5` accent line) is drawn whenever `dropTarget.at === 'end'`.

### Drop marks
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
| glyph | `Folder` icon in a `data-drag-handle` span: the touch carry waits for it |
| toggle | ONE element, `role="button"` span, `tabIndex={0}`, `data-testid="simple-chat-folder-toggle"`, `aria-expanded`; press, Enter and Space call `onToggle`; `title` = `runner.collapse` / `runner.expand`, ns `common`; `FoldChevron` + name |
| rename | input `simple-chat-folder-rename-input`: Enter saves, Escape cancels; blank or unchanged name calls nothing |
| dot | drawn only when `dot !== null`: `simple-chat-folder-dot`, `data-mark`, `role="img"`, label and title = the mark's word; `awaitingInput` adds `vv-pulse` |
| menu | `ActionMenu` labelled `simpleList.folderOptions` with `{ name }`; entries Rename (`simple-chat-folder-rename`), divider, Delete folder (`simple-chat-folder-delete`, danger) |
| selected wash | `holdsSelected`: `bg-primary/10` |
| ring | `isDropInto`: `ring-2 ring-primary` |
| line | `dropEdge='before'`: `h-0.5` accent line on the top edge |
| fade | none of its own; `data-dragging` only says it is the carried header |

- The name is not a `<button>`: the carry turns away any press inside a `button`, so a mouse picks the folder up by its name.
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

## Gate — `.verify/probe-simple-folders.mjs`
- `node .verify/probe-simple-folders.mjs` (dev server on `127.0.0.1:5183`, signed in through `openConsole`); `ONLY=1440-light|1440-dark|390-light|390-dark` runs one combination. Gitignored; not a `phase-*.mjs`, so `all.mjs` does not run it.
- Mounts fixture props over the signed-in page through `lib/mountReact.mjs`: 17 states × 4 combinations (1440×900 and 390×844, light and dark). States: header with each of the four dots and none, folded and open, holding the open chat, renaming, as a drop target; picker with and without a current folder; tree with a loose chat, an open and a folded folder, a carried folder's block, the end line.
- Fixture host: `position:fixed`, `z-index:60` (under `ActionMenu`'s `z-[70]`, over the app), background `var(--canvas)` (`--background` is not defined); the picker's host is `display:contents` so its body-portalled Dialog shows. Frame width = the app's own sidebar width at that viewport.
- Shots: `.verify/shots/simple-folders-<state>-<width>-<light|dark>.png`; artifact `.verify/artifacts/simple-folders.json`.
- Checks: dot count, mark and label; `data-collapsed`; nested count, indent and column alignment; block count and kinds; rename value; line, ring and wash; fades (carried chat's row, carried folder's block, the header itself never); end line; picker rows and disabled state; height rule; name not a `<button>`. Seam 7: press, Enter and Space on the toggle each call `onToggle`; a press on the glyph calls nothing; the carry props arrive under the folder's ref; the picker's three answers (`onPick(id)`, `onPick(null)`, `onCancel`).
- Live check, last in each combination: the list is turned on for the probe's own context by `pinPreferences(… { simpleChatList: true }, { writes: 'drop' })` then a reload; it draws no folder chrome, every row is flush left, no row menu offers "Move to folder…". It runs last because the fixture checks read the whole document and a pinned page draws live rows.
- Account: nothing is created on the server and no turn is sent. `openConsole`'s park PATCHes `simpleChatList: false`; the probe reads the stored value before it and restores it after `browser.close()`.
- Ends `<n> states photographed, every check passed` (exit 0), else `FAILED (<n>)` (exit 1).
- 2026-09-30: 266 `[ok]`, 0 FAIL, 70 shots (68 fixture + 2 live), on the version before the live check moved to a pin. The pinned version is `node --check`ed, not run.

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
- Size: 300 LOC against the 300 default. The next addition wants an extraction, not an append.

## Signature
`useSimpleChatDrag({ items, onMove })`

| In | Is |
| --- | --- |
| `items: SimpleListItem[]` | the tree; read through a ref at release |
| `onMove(item: SimpleListItemRef, position: SimpleListPosition)` | read through a ref at release |

| Out | Is |
| --- | --- |
| `dragging` | `SimpleListItemRef \| null`: the carried row, set once the press passes the threshold |
| `dropTarget` | `SimpleListDropTarget \| null`: where the pointer says it would land; re-rendered only when the target changes |
| `dragProps(ref)` | `Pick<HTMLAttributes<HTMLElement>, 'onPointerDown' \| 'onClickCapture' \| 'onDragStart'>`; spread on every chat row and folder header (assigns to `SidebarSimpleListItems`' `dragProps`) |

## Gesture
| Rule | Is |
| --- | --- |
| threshold | `DRAG_THRESHOLD_PX = 5`: less travel is a click |
| press guards | primary button only; a press inside `button, input, [data-no-drag]` stays that control's; a touch starts only inside `[data-drag-handle]` |
| one press | a press while another is armed is ignored |
| carry start | the text selection is cleared (`removeAllRanges`) |
| listeners | four on `window` per press (`pointermove`, `pointerup`, `pointercancel`, `keydown`), removed at press end and on unmount |
| release | `pointerup` of the armed pointer id ends the press and commits |
| abandon | `Escape` or `pointercancel` ends the press and commits nothing |
| click | a carry's release is followed by a swallowed click (`onClickCapture`: `preventDefault` + `stopPropagation`); a keyboard click (`detail === 0`) passes; the next `pointerdown` disarms the swallow before its guards run |
| native drag | `onDragStart` is `preventDefault`ed |

## Commit
- On release after a carry: `positionForDrop(itemsRef.current, press.item, target)` (MAN-7520); `onMove` fires only for a non-null answer. A drop that changes nothing prints nothing.
- No target is never a move.

## DOM contract (selectors the hook reads)
| Selector | Is |
| --- | --- |
| `[data-testid="simple-chat-list"]` | list root; absent ⇒ no target |
| `[data-testid="simple-chat-row"]` + `data-session-id` | a chat row → `{ kind: 'chat' }` |
| `[data-testid="simple-chat-folder"]` + `data-folder-id` | a folder header → `{ kind: 'folder' }` |
| `[data-testid="simple-chat-block"]` + `data-item-kind` (`chat` \| `folder`) + `data-item-id` | one top-level row's block |

- The target comes from the boxes the list draws, never from the tree: drawn order is what the reader sees.

## Target — carrying a chat (`chatTargetAt`)
Scan: every row and header under the root, in document order, carried row included. `over` = the last whose top edge is at or above the pointer (the gap between two rows belongs to the row above). `drawnBelow` = some row begins below the pointer.

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

## Gate — `.verify/probe-simple-drag.mjs`
- `node .verify/probe-simple-drag.mjs` (dev server `127.0.0.1:5183`, signed in through `openConsole`, 1440×900). Gitignored; not a `phase-*.mjs`, so `all.mjs` does not run it. Zero model turns; creates nothing on the server.
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
- 2026-09-30: 9 of 9 PASS, exit 0.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/hooks/useSimpleChatDrag.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-simple-drag.mjs

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
