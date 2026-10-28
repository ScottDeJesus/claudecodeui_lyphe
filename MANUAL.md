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
primitives, wired into Settings and the sidebar. Both surfaces read the one module-scope report
in `hooks/useClaudeUpdates.ts`, and every call goes out through `src/shared/api.ts`'s `claudeUpdates`
group — `GET /api/claude-updates`, `POST /api/claude-updates/{check,apply,restart}`, `PUT /api/claude-updates/auto-install`.

| file | owns |
|---|---|
| `index.ts` | the module's whole export surface: `ClaudeUpdatesSettingsTab`, `ClaudeUpdateFooterRow` |
| `hooks/useClaudeUpdates.ts` | the client contract: `{ report, refresh, check, apply, restart, setAutoInstall }`; `isUpdateJobActive(job)` — true on `installing`/`installed`/`restarting`/`rolling-back`; `canPressRestart(job)` — true with no active job, or a job in `restarting` whose `restart` step is `pending`; and the one module-scope report with its poller |
| `ClaudeUpdatesSettingsTab.tsx` | Settings → Updates: title (drawn even before the first report, with the one Try again press), clock line + Check now, `AutoInstallRow` (left out when `report.autoInstall` is absent), one `PackageUpdateCard` per package, the actions row, `UpdateJobPanel`, the last press's refusal |
| `AutoInstallRow.tsx` | the automatic-install switch + its `Not installed yet — <waiting>` status line (MAN-7516); composes `SettingRow` + the library `Switch`, not `SettingsToggle` (the settings module already imports this tab) |
| `PackageUpdateCard.tsx` | one package: state line, `reason`, SDK `loaded` line, CLI mid-turn plural line, Roll back |
| `PatchNotes.tsx` | the notes list under a card |
| `UpdateJobPanel.tsx` | the four steps with icon + `from → to` + detail, `logTail` folded |
| `ClaudeUpdateFooterRow.tsx` | `ClaudeUpdateFooterRow`, the one form of the update mark: the sidebar footer row, off its `useUpdatesFooterLine` hook. The views rail draws no update mark; the row is in the list column, so it returns with the list |
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
threaded through `Sidebar.tsx` → `SidebarContent.tsx` → `SidebarFooter.tsx` as one more prop.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/claude-updates/, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/settings.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useProjectsState.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/hooks/useSettingsController.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/SettingsSidebar.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/Settings.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarContent.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarFooter.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/Sidebar.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/constants.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

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
| A fixed-width field carries `max-w-full` (`w-64 max-w-full`, `SETTINGS_FIELD_WIDTH` in `src/shared/constants.ts`: `NtfySettingsCard.tsx` and the companion module's Settings form). No `w-full sm:w-*` workaround. | Both were patches for the squeeze the floor now handles. |
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
| Stubs | TaskMaster installed; two installed plugins (the box has none; one with a 52-character name) — each answered locally, and the walk presses the first card's uninstall to draw its confirm banner, then Cancel; the box's user-scope MCP list gets a long-URL server and a long-stdio server (long command, args, env, cwd) added (a GET, answered from the real reply); every non-GET to preferences and settings is answered locally |
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
- `ProjectsStateContext.tsx` is 323 lines: the next reader hook added there needs an extraction first.
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
| `useVoiceAvailable.ts`, `useVoiceProvider.ts` | listen for `VOICE_CONFIG_SYNC_EVENT`, which settings dispatches on the opener's `window` |
| `useMicRecorder.ts` `navigator` (the chat's dictation records through it) | the opener's |
| `useChatSessionState` bare timers: the 8 s loading-wheel guard, the "Load all" hint pulses, the search-jump and landing retries, the 4 s highlight flash | each bounds a wait; the reader is not waiting on it |
| `useChatComposerState`'s 5 s draft poll | reconciles data |

## Probes

| command | proves |
| --- | --- |
| `node .verify/chat-window-bindings-home.mjs` | at home, real Haiku turns in a scratch chat on :5183 (800×240 window, so two short turns overflow the scroller): a turn streams and the transcript follows its foot with a glide (back inside the near-bottom band within 60 frames, the jump-to-bottom button never showing); Escape mid-stream stops the turn; a 400px-scrolled-up transcript is within 2px after a Files-tab trip, and at the foot it returns to the foot; a reply that arrives while the Files tab is shown lands the operator on the message they sent, within 24px of the scroller's top, the reply below the fold (MAN-7575). Expects exactly two console `404`s from `/token-usage` on a fresh chat (the server answers 404 with no transcript yet). Deletes its chat |
| `node .verify/chat-window-bindings-move.mjs` | the REAL hooks (served source) in a Chromium Document-PiP window under a `HostWindowProvider` driven like `moveTo` (emit `'before'`, place the node, set the host, emit `'after'`): scroll anchor within 2px in both directions while the scroll height changes ~40%, a follower lands on the foot, a control scroller with no hook drops 500 to 0; flush at `'before'` and cleared on the PiP; presence; observer rebuilt by the right constructor with all 60 rows answering. 2026-09-29: 33 of 33 pass |

- `PROBE_APP_URL` points the home probe at another client of the same API (a before-tree on its own port).
- Both exit 1 with the failed checks listed. The move probe sends no model turn and writes no app data.
- `.verify/lib/scratch-chat.mjs` is the shared helper for a probe that sends a real turn: `createScratchChat(session, projectPath?)` (default `PROBE_PROJECT`, `.verify/lib/probe-project.mjs`; a probe that needs a node-assigned project names a scratch project, and only `cerberus-eis-proof.mjs` may name the real `/opt/eis-app`, MAN-7924), `openScratchChatOnHaiku(session, id)` (opens `/session/<id>`; when the rail's Chat button (`nav[aria-label="Views"] button[aria-label="Chat"]`) is not `aria-current`, opens the drawer (`openDrawer` from `lib/layout-nav.mjs`, a phone's rail sits in it) and presses the button; picks Haiku in the composer's `MODEL_CHIP`; throws if the chip does not read Haiku, so no turn is sent), `sendTurn(page, text)`, `deleteScratchChat(session, id)`; constants `MODEL_CHIP`, `SCROLLER`, `COMPOSER`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useChatRealtimeHandlers.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useHostMoveScroll.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useLazyRowObserver.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useSessionPresence.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/utils/streamFlushTimer.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useMicRecorder.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-window-bindings-home.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-window-bindings-move.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/scratch-chat.mjs

## MAN-7464 — chat-host — the live chat's one node, its provider and its slot

`src/modules/chat-host/` owns the live chat's one DOM node and the door into it. Barrel exports four names: `ChatHostProvider`, `useChatHost`, `ChatHostSlot`, `ChatHostFloating`. Types `ChatPlacement`, `HostMove`, `HostWindowValue`, `PanelPlacement` live in `src/shared/types.ts`, group `CHAT HOST`. Pure parts: MAN-7446. The unread rule: MAN-7482. The floating host, its panel hook, the anchor store, the door and the hotkey: MAN-7478. Chrome (`ChatHostPanel`, `ChatHostHeader`, `ChatHostPlaceholder`; unexported): MAN-7467. Window binding: MAN-7443, MAN-7452. The picture-in-picture host: the chat-host window manual.

## Tree

`ProjectWorkspaceShell` → `PageAnchorsProvider` (MAN-9131) → `ChatHostProvider` → `AppSwitcherProvider` → `AccountsProvider` → `CompanionHost` (MAN-9083) → `WorkspaceFrame` (`src/modules/project-workspace/`; MAN-491). `WorkspaceMain` wraps `ChatInterface` in `ChatHostSlot`, inside `ChatGutterLayout`; `WorkspaceFrame` mounts `ChatHostFloating` before the FAB.

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
| `after` | reads the record and holds both rects equal; checks the node's parent has `data-chat-host-home`, the transcript and composer stand inside the node, `document.querySelector('textarea') === window.__ta` after a Files-tab trip (at 390 the views rail is in the sidebar drawer: the probe opens "Open menu" first). `--turn`: a Haiku turn streams and the transcript follows its foot |

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

1. Frame is the kit `Card`: `position: fixed`, `z-[45]`, `border-input` (the strong border), `shadow-lift` (the lift rung, `--shadow-lift`). Attributes: `role="region"`, `aria-label` = `chatHost.panelLabel`, `data-chat-host-panel`, `data-grip={placement.grip}`.
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

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/app-switcher/AppSwitcherFab.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/app-switcher/AppSwitcherRadial.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/app-switcher/utils/radialLabels.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/radial-fab-chrome.mjs

## MAN-9126 — app-switcher radial — AppSwitcherRadial, radialLabels and the fixture that — Open and close
section: app-switcher radial — AppSwitcherRadial, radialLabels and the fixture that photographs them/001 Open and close

1. `DockableFab` `onPress({ keyboard })`: chat floating → `chatDoor.collapse()`, no radial; else the press toggles `radialOpenedBy` (`'keyboard'` when `keyboard`, else `'pointer'`). The FAB's `active` (`aria-expanded`) is on while the radial or the drawer is up.
2. The radial closes on: a second FAB press; `onDragStart`; the chat starting to float; Escape; a `pointerdown` outside the shell and the FAB; focus moving into an application's frame; Tab; an item's press.
3. The chat starting to float is dropped in the render that finds `chatDoor.floating` (`setRadialOpenedBy(null)` during render), so no frame draws both. why: the radial would go on offering Chat for a chat already out.
4. Escape: window capture listener, `preventDefault()`, `OWNS_ESCAPE` spread while open, focus back to the FAB. why: ChatInterface's Escape stops a running turn and reads `defaultPrevented`; a running turn survives it.
5. A `pointerdown` on the FAB is excluded from the outside press. why: the FAB's own press toggles; closing on the pointerdown lets the click reopen it. The radial finds the FAB with `FAB_SELECTOR = '.vv-fab:not([data-companion-fab] .vv-fab)'` (React 18 has no ref-as-prop; Kaylee's disc is the same kit piece inside her layer and is left out, so the match is the applications button whatever order the two mount in).
6. Focus into a frame: window `blur` with `document.activeElement.tagName === 'IFRAME'`. why: a cross-origin frame never sends this page a `pointerdown`.
7. Item `onClick`: `if (!open) return;`, then `act.run()`, `onClose()`; a keyboard click (`event.detail === 0`) gives the FAB its focus back. why `!open`: items stay hit-testable through the close fade (`visibility` waits `FADE_MS`), and a second click ran Reload and Open in a new tab twice. why FAB focus: the item is about to hide, and the drawer's close restores focus to what held it when it opened.
8. Keyboard: items found with `querySelectorAll('[role="menuitem"]')` on the container ref, no per-item refs. ArrowDown/ArrowRight forward, ArrowUp/ArrowLeft back, over the drawn items, wrapping; from focus off an item, forward starts at the first and back at the last. Enter and Space are the focused item's click; a repeat of either (`event.repeat`) is ignored. why: a held Enter on the first item toggled Chat over and over.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/app-switcher/AppSwitcherFab.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/app-switcher/AppSwitcherRadial.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/app-switcher/utils/radialLabels.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/radial-fab-chrome.mjs

## MAN-9127 — app-switcher radial — AppSwitcherRadial, radialLabels and the fixture that — `AppSwitcherRadial` rules
section: app-switcher radial — AppSwitcherRadial, radialLabels and the fixture that photographs them/002 `AppSwitcherRadial` rules

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

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/app-switcher/AppSwitcherFab.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/app-switcher/AppSwitcherRadial.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/app-switcher/utils/radialLabels.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/radial-fab-chrome.mjs

## MAN-9128 — app-switcher radial — AppSwitcherRadial, radialLabels and the fixture that — Words
section: app-switcher radial — AppSwitcherRadial, radialLabels and the fixture that photographs them/003 Words

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

`.verify/lib/switcher.mjs` exports `FAB` (`button.vv-fab:not([data-companion-fab] .vv-fab)`: the applications button, since Kaylee's disc is a second `button.vv-fab`; its label says what a press does, so it is never the selector) and `openDrawerFromFab(page)` (tap the FAB, then the Applications item). Every probe that wants the drawer goes through it: `app-drawer-link-project`, `app-row-project-link`, `app-rows-thin`, `app-rows-escape`, `chat-floats-panel`.

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
| `src/modules/command-palette/CommandPalette.tsx` | prop `switcherActions: SwitcherAction[]`; renders `PaletteSwitcherGroup` right after the `Actions` group (`Start new chat`, `Toggle theme`) and before `Navigate` (the views list in rail order, `Go to <rail name>`, Settings last: MAN-8999), on the same page rule as `Actions` (`showActions`: no sub-page open). Passes `createSwitcherFilter(switcherActions)` as `Command`'s `filter`. The palette's barrel (`index.ts`) is unchanged |
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
- Measured 2026-10-20 on :5183 (`ONLY=1440-light`): RED before any check — `mountHost` times out and `WindowHost` throws `Cannot read properties of undefined (reading 'get')`; cause not found. Last green: 2026-09-30, 274 checks pass, exit 0.
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
- 2026-10-20, a swipe on a row is the browser's own scroll, and a lifted row survives the browser's pan: the rows are never `touch-action: none`, so a swipe that starts on a row, or on a control inside one, is the phone's own scroll and glide (nothing on the page's main thread moves the pane). At the hold's lift `usePointerDrag` holds every scroller around the press still (`overflow: hidden`, `sortable/touchCarry.ts`: MAN-8136) so the browser's pan has nothing to move, and a `pointercancel` that arrives mid-carry does not end the carry: it follows the same finger on its touch events. why: the operator's Galaxy Z Fold 8 dispatches every touch sequence uncancelable (`touchmove cancelable=false`), so no `preventDefault` can stop the browser's pan, and the pan takes the pointer away (`pointercancel`) at the first move past the slop after the lift, which used to put the row back. Operator: "Hold and drag, one motion" (2026-10-10), "The scrolling stops and is not fluid as normal scrolling" (2026-10-20). Gate: MAN-8687 (`.verify/native-scroll-drag-scratch.sh`, Chromium at 390×844 with real touch dispatched uncancelable, on this list and on an epic deck).

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
| `dragProps` | one `SimpleListDragProps` object (`src/shared/types.ts`: `onPointerDown`, `onClickCapture`, `onDragStart` and the kit's `data-hold-lift` marker), the same for every row; spread on every chat row and folder header (assigns to `SidebarSimpleListItems`' `dragProps`). The row a press lands on is read off the row's own `data-session-id` / `data-folder-id` |
| `listRef` | ref object for the list's root (`SidebarSimpleList` puts it on `simple-chat-list`): where the pointer's capture goes at the lift, and nothing else. The list registers no `touchmove` canceller: a lifted row survives the browser's pan instead (`usePointerDrag` with `sortable/touchCarry.ts`: the scrollers around the press are held still for the carry, and the finger is followed on its touch events when the browser takes the pointer away). A device with no touch screen has no finger to hold still |

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/hooks/useSimpleChatDrag.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/sortable/touchLift.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-simple-drag.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/simple-list-hold-to-drag-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/simple-list-hold-to-drag.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/simple-list-hold-to-drag-scratch.sh

## MAN-8139 — The simple list's carry — `useSimpleChatDrag` and the pointer's reading of the — Gesture
section: The simple list's carry — `useSimpleChatDrag` and the pointer's reading of the drawn list/001 Gesture

| Rule | Is |
| --- | --- |
| threshold | mouse and pen: `DRAG_THRESHOLD_PX = 5`, less travel is a click |
| hold | touch: `TOUCH_HOLD_MS` (400 ms) held still lifts the row; a finger that drifts past the kit's slop first is scrolling: the gesture lets go, the browser scrolls the pane (see the pan row), and nothing lifts. The kit's `tickLift()` pulses 20 ms where the device can (Android's own long-press buzz; an iPhone and a phone on silent get none). The `contextmenu` and `selectstart` a long-press raises are cancelled while a hold is pending or lifted, and `surfaces.css` keeps the platform's callout and selection off every handle from the first touch (`data-hold-lift`, touch screens only) — an iPhone sends no `contextmenu` to cancel |
| press guards | primary button only (the kit); in `accept`: a press that landed outside the row's own DOM is refused (React bubbles a press from a portal — the row's open action menu — through the tree to the row), and so is a press inside `button, input, [data-no-drag]`, which stays that control's: it never lifts, and a swipe that starts on it is the browser's own scroll. The three status marks in the chat row (`simple-chat-awaiting-input`, `-running`, `-subagents-running`) carry `data-no-drag`: each sits in a `Tooltip` that opens on a 350 ms touch hold, and the 400 ms carry must not lift the row under it |
| one press | a press while another gesture runs is ignored by the kit, so a second finger never changes which row is lifted |
| lifted row | the kit's carry (`shared/ui/sortable/carried.ts`, the copy `useSortable` runs): at the lift the pressed chat's row, or a folder's whole block, is taken up (`takeUp`: `data-carried`, above its neighbours, backed with an opaque ground) and follows the pointer up and down (`placeUnder` with a null x: on the list's rail), on every move and when the pane scrolls. Its slot stays as the gap. Verve draws `data-carried` as `--shadow-lift` plus a `--border-strong` hairline. At release the list is committed in one `flushSync` and the row slides from where it was drawn to its place (`putDown`; nothing slides under `prefers-reduced-motion`); a cancel or Escape slides it back |
| carry start | the text selection is cleared (`removeAllRanges`); `body` wears `vv-dragging vv-drag-sort` for the carry, which also keeps iframes from swallowing it |
| capture | the pointer is captured on the LIST's root at the lift (`captureOnStart`; the root arrives through `listRef`), never at the press, so a tap still reaches the row's link and fold toggle, and never on the row, because `:hover` follows the capture and a captured row would keep its hover wash for the whole carry |
| edge scroll | `useCarryEdgeScroll` (`hooks/useCarryEdgeScroll.ts`): from the lift, every animation frame while the pointer rests in the pane's top or bottom 56 px zone, the pane (`scrollerOf` the list root) scrolls a step toward that edge and the target is read again under the still pointer. Step and zone are the kit's own `edgeStep`, `edgeHoldAt` (`shared/ui/sortable/motion.ts`), the ones `useSortable` runs on; a carry that began in a zone does not run toward it until the pointer has left it. A page that scrolls as a whole has no pane to run. A pane scrolled by any means (a wheel) re-places the row and re-reads the target, and the row is re-placed every frame. The lifted row is PAINTED INSIDE THE LIST'S OWN BOX (`placeLifted`): it never leaves its slot, so a row painted below the list's end would extend the pane's scrollable overflow with every pixel scrolled and the loop would never end. Ended at release, at Escape and on unmount |
| release | `pointerup` ends the gesture and commits; after a mid-carry `pointercancel`, `touchend` does |
| abandon | `Escape` (a keydown listener present while a row is carried) puts the row back at once and commits nothing; `touchcancel` after a lift commits nothing (a `pointercancel` alone does not end the carry) |
| click | a carry's release is followed by a swallowed click (`onClickCapture`: `preventDefault` + `stopPropagation`); a keyboard click (`detail === 0`) passes; the next `pointerdown` disarms the swallow before its guards run |
| pan | touch, a swipe that crosses the slop before the hold fires (anywhere on a row or header, controls included): the browser's own scroll and glide. The rows are never `touch-action: none`; the gesture lets go and the pane moves on the compositor, not by script. Once a row has LIFTED (`usePointerDrag`, `sortable/touchCarry.ts`): `holdScrollersStill` sets `overflow: hidden` on every scroller from the pressed element and the handle up (the pane the list lives in, and any around it; one that shows a classic scrollbar keeps its gutter), after `onStart` has read the pane, so the browser's pan has nothing to move; the root is already clipped with `overscroll-behavior-y: contain` (`index.css`), so no pull-to-refresh shows. The edge scroll still moves the held pane by script. When the browser takes the pointer away anyway (`pointercancel` mid-carry) the carry does not end: `followTouch` follows the same finger on `touchmove`, `touchend` (a drop) and `touchcancel` (a cancel) — passive, bound on the pressed element, matched by touch identifier; nothing calls `preventDefault` on a touch event. The scrollers come back on every exit: drop, cancel, `touchcancel`, unmount. The edge scroll's end is the pane's own `scrollHeight`, which is the list's end because the carried row is painted inside the list's box (`placeLifted`) |
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
- Not proven: any real phone. `probe-card-order.mjs` is stale against the current app (2026-10-10: its project selector `PROJECT_ROW` matched no row, on the pre-change client alike; its tab selector `RUNNER_TAB` reads the `Roadmap` tab since 2026-10-20, unrun since).
- `.verify/simple-list-hold-to-drag-live.mjs` is the read-only look at the live list (no press, no touch, nothing written): it reads that the drawn list carries no `data-drag-handle` and no `.touch-none`, that rows exist, and that the page logs no error.

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
- `disabled?: boolean` (default false): the trigger is a real `disabled` button (`.vv-select__trigger:disabled` — dimmed to 0.6, `not-allowed`, no hover border) and the panel never opens; a picker that turns disabled with its list open closes it (so the list does not come back on its own when the picker is enabled again). A picker that shows a value the reader cannot change now — the master controller's Epics at once dropdown while a press is out.

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
- The live box is paused, or `route.epics` carries a key beyond `paused` and `running`: `route.epics is exactly paused and running, and the live box is not paused` is the check; the header's readout is then compared with the served census.
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

The browser's typed view of `/api/affected-areas` (the Tours tab): one wire-type file and one `api` block. The one home of every shape is shadow-connector's `core/affected_areas/wire.py` and its sibling `wire_layout.py` for the day-one plan (INV-8564); the routes are MAN-8540.

## Files
| file | holds |
|---|---|
| `src/shared/affected-areas-types.ts` | 39 types it defines, and the 18 of the next row re-exported by name (`export type { … } from '@/shared/affected-areas-layout-types'`): every `wire.py` model, its 11 nested ones and the four envelopes `TourList`, `ViewsResult`, `UnderstandingMarkResult`, `Refusal`; plus the unions `Face`, `Basis`, `Verdict`, `MarkQueue`. `Point` and `Box` are file-private (`number[]`). Imports nothing from `server/`. |
| `src/shared/affected-areas-layout-types.ts` | 18 types: every `wire_layout.py` model (the layout read, the plan's rooms, spots, openings, objects, areas, scale and pins, `Placement`), and the four fields they fill on `ViewEntry`, `Region` and `TourDetail` live in the file above. `Point` and `Box` are file-private here too, in 0..1 of the FLOOR's drawing frame. Imports `Budget`, `Face`, `Region` with `import type` from `@/shared/affected-areas-types` (the lint rule bans the relative form) |
| `src/shared/api.ts` | `api.affectedAreas`, 15 verbs, beside `api.cerberus`; a type-only import from the mirror. The same file holds `api.carrierBulletins` (the Bulletins view's four GET verbs and their own mirror, `carrier-bulletins-types.ts`): MAN-8865 |
| `.oxlintrc.json` | `src/shared/affected-areas-types.ts` and `src/shared/affected-areas-layout-types.ts` in the `frontend-shared-file` list (INV-5890): a new shared file is an unknown element until listed |

## Verbs
Every answer is the wire shape bare, the type named in a `// →` comment above the verb. Ids go through `encodeURIComponent`. The lane also forwards the cut of a pano's views and the reader's plan of a whole tour (MAN-8559); no screen calls them, so `api` holds no verb for either, and `ViewsResult` and `TourPlan` stay as the wire's mirror of their answers.

| verb | route | answer |
|---|---|---|
| `tours({ q?, limit? })` | `GET /tours` | `TourList` |
| `tour(tourId)` | `GET /tours/:tourId` | `TourDetail` |
| `pano(tourId, panoId)` | `GET /tours/:tourId/panos/:panoId` | `PanoDetail` |
| `readPano(tourId, panoId, ReadRequest)` | `POST …/panos/:panoId/read` | `ReadResult`; `timeoutMs` 120 000 |
| `image(sha, options?)` | `GET /images/:sha` | JPEG bytes: the caller reads `.blob()`; `options.signal` aborts |
| `readLayout(tourId, panoId, ReadRequest)` | `POST …/panos/:panoId/layout` | `LayoutReadResult`; `timeoutMs` 270 000 (six views at high thinking); `{ armed: false }` is the dry run, `planned` with the count and the budgets |
| `buildPlan(tourId)` | `POST /tours/:tourId/layout/plan` | `LayoutPlanResult`: the plan rebuilt from the stored reads, no model; the screen sends it once on a `stale` plan |
| `planDrawing(sha, options?)` | `GET /layout-drawings/:sha` | SVG bytes (`image/svg+xml`): the caller reads `.blob()`, as for `image`; `options.signal` aborts |
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
- A shape changes in `wire.py` (the day-one plan's in `wire_layout.py`) first; the mirror moves in the same change. why: a field renamed on one side is a screen that stops reading.
- Field names are the wire's camelCase; `class` is a key (`wire.py`'s `cls` alias). Dates are ISO text, ids text, a point `[x, y]` and a box `[x0, y0, x1, y1]`, both in 0..1 of the frame the shape sits in: one view for a region, the floor's drawing for the day-one plan.
- A response field is never optional. A field a later plan fills (`read`, `understanding`, `regions`, `mark`, `standing`, `threshold`, `holdout`, `regionsStanding`, `marksCount`, `standingCount`, `photosAffected`, `understandingMark`, `current`, `effectiveClass`, `tourName`, …) is `T | null`: `null` is "not judged", never "judged and found nothing".
- A request field `wire.py` defaults is optional (`newClass?: string | null`).
- `ViewDetail` is `ViewEntry & {…}`, as `wire.py` inherits it.
- A new verb names its answer type in a `// → Type` comment, as this file's other blocks do.

## Measured on the live engine
- 2026-10-17, `.verify/affected-areas-marking.mjs` (66 of 66): `mark` and `missed` answered 200 with a `Region` whose `mark` and `standing` equal the same region from `GET …/panos/{pano}`; `setThreshold` answered 200 with the `ProvingClass` that `GET /proving` then held (`threshold`, `isDefault`, `thresholdSetAt`); `markUnderstanding` answered 200 with the `UnderstandingMarkResult`. `wire.py` names only that last answer: the other three are read from the routes' bodies, not from a model.
- 2026-10-17: `GET /queue` answered 200 with the keys `mode`, `items`, `remaining` (an item: `tourId`, `panoId`, `roomName`, `jobLabel`, `view`, `region`); `GET /proving` answered 200 with `model`, `contractVersion`, `contractHash`, `understanding`, `classes` (a class: the twelve fields of `ProvingClass`). Each is the typed key set.
- 2026-10-18: the file's property names, read by the TypeScript compiler, against `model_json_schema(by_alias=True)` per model: 39 of 39 equal. The five fields the fix added (`photosAffected`, `understandingMark`, `current`, `effectiveClass`, `tourName`) are each `T | null` here as `T | None` there; no model class was added.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/affected-areas-layout-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/affected-areas-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts

## MAN-8559 — The affected-areas lane — /api/affected-areas forwarded to shadow-connector

`server/modules/affected-areas/` is the one hop between the browser and shadow-connector's internal-caller gate (R-CAP-11, `X-Internal-Secret` required even from loopback). The browser never holds the secret. Mounted in `server/index.ts` at `/api/affected-areas` behind `authenticateToken`. The engine's side of the same surface: MAN-8540. Its sibling lane, `/api/carrier-bulletins`, is MAN-8909.

| File | Holds |
|---|---|
| `affected-areas.module.ts` | `createAffectedAreasModule()`; the ONLY reader of the environment for this lane |
| `affected-areas.routes.ts` | `createAffectedAreasRouter({ forward })`: the lane's table, its id shapes and its default image type (`image/jpeg`; the drawing row names its own, `image/svg+xml`); it hands them to the shared router |
| `index.ts` | barrel the entrypoint imports |

Two shared files stand behind it, and neither is in this module: the forwarder (`createShadowConnectorLane({ baseUrl, envFile, label })` → `forward(LaneRequest): Promise<LaneAnswer>`, the secret read and the one `fetch`, `server/shared/shadow-connector-lane.ts`, MAN-8863) and the router (`createLaneRouter`, which checks, forwards and answers from a table, `server/shared/shadow-connector-lane-router.ts`, MAN-8908). The secret has one home, and the checks, the 404 and 422 tails and the status mapping have one copy, shared with the bulletins lane. This module builds the forwarder with `label: 'affected-areas'`, so its log warning reads `[affected-areas] no usable internal secret in <file>: <cause>`.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `SHADOW_CONNECTOR_URL` | `http://127.0.0.1:8001` | engine origin |
| `SHADOW_CONNECTOR_ENV_FILE` | `/opt/shadow-connector/.env` | file holding `EIS_INTERNAL_SECRET=` |

## Allowlist (17 rows in `ALLOWLIST`)

A method+path not in the table is the lane's own 404 `{ error: 'not a route of the affected-areas lane' }`; it never reaches :8001. The table is the lane's whole contract.

| Method path | Timeout | Reply | Body | Query (forwarded keys only) |
|---|---|---|---|---|
| `GET /tours` | 20 s | json | none | `q` ≤ 80 code points, `limit` 1–100 |
| `GET /tours/:tour` | 20 s | json | none | — |
| `POST /tours/:tour/panos/:pano/views` | 90 s | json | none | — |
| `GET /tours/:tour/panos/:pano` | 20 s | json | none | — |
| `POST /tours/:tour/panos/:pano/read` | 120 s | json | object | — |
| `POST /tours/:tour/read` | 20 s | json | none | — |
| `POST /tours/:tour/panos/:pano/layout` | 270 s | json | object | — |
| `POST /tours/:tour/layout/plan` | 120 s | json | none | — |
| `GET /images/:sha` | 20 s | bytes (`image/jpeg`) | none | — |
| `GET /layout-drawings/:sha` | 20 s | bytes (`image/svg+xml`, its own row's `image`) | none | — |
| `GET /codebook` | 20 s | json | none | — |
| `POST /regions/:region/marks` | 20 s | json | object | — |
| `POST /images/:sha/regions` | 20 s | json | object | — |
| `POST /reads/:read/marks` | 20 s | json | object | — |
| `GET /queue` | 20 s | json | none | `mode` unsure\|random, `class`, `limit` 1–50, `skip` at most 50 lowercase uuids, comma-joined (a bad one is the lane's 422 before anything is forwarded) |
| `GET /proving` | 20 s | json | none | `model`, `contract`: one token `[\w.:-]{1,80}` |
| `PUT /thresholds/:class` | 20 s | json | object | — |

## Id shapes (the lane's `PATH_RULES`; how a failure is answered is MAN-8908)

| Input | Rule |
|---|---|
| `:tour`, `:pano` | `^[0-9a-f]{24}$` lowercase |
| `:sha` | 64 lowercase hex (`SHA256_RULE`) |
| `:region`, `:read` | a lowercase uuid (`LOWERCASE_UUID_RULE`), as `routes/ids.py` holds them |
| `:class` | `^[a-z_]{2,40}$` |
| `limit` | a whole number (`wholeNumber`, private to this file) |

The lane's own 422 is `{ error }`; the engine's is `{ detail: [...] }`: a client reads both. Status mapping, the body-must-be-an-object check and the malformed-escape 422 are the shared router's (MAN-8908 rules 2–4): an upstream answer keeps its status and body; unreachable 503, unreadable 502, no secret 503. Image 2xx: `Content-Type: image/jpeg` and bytes that begin `ffd8ff` (`JPEG_SIGNATURE`; anything else is 502 `shadow-connector did not answer with a JPEG`), `Cache-Control: private, max-age=31536000, immutable`; a non-2xx image answer passes through as its JSON. The one exception is the plan drawing row, which names its own image type (`SVG_IMAGE`: `image/svg+xml`, bytes that begin `<svg`, 502 `shadow-connector did not answer with an SVG`): a row's `image` wins over the lane's, so a JPEG answered for a drawing, and an SVG for a view, are each a 502 (measured 2026-10-26 through the real router with a stub forwarder). The layout press has 270 s because six views at HIGH thinking can outlast the reader's 120 s (`LAYOUT_PRESS_TIMEOUT_MS`); a press the lane gives up on is not cancelled, the engine's reads are kept and the next press finds them cached.

## The secret read and the headers sent
Both belong to the forwarder: MAN-8863 (the read: `parseSecret`, `currentSecret`, a rotation lands on the next request) and INV-8633 (the rules). The one fact to carry here: a bytes route is asked for with `Accept: image/*` since 2026-10-22 (it was `image/jpeg`), and this lane still insists on its image type in the answer (a JPEG; an SVG for a drawing).

## Probes
- 2026-10-17: `GET /api/affected-areas/tours?limit=3` → 200, three tours; `GET …/images/<sha>` → 200 JPEG whose `sha256sum` equals the id. `GET /nope`, `DELETE /tours`, `POST /codebook` → 404 with no `shadow-connector` journal line; 422 cases (bad id, `limit=0|101`, 81-char `q`, `mode=bogus`) likewise never reach the journal. An empty env file → 503 `no_secret`, 0 engine requests; writing the secret into it → next request 200, no restart.
- 2026-10-22, the loop moved to the shared router and `Accept` changed to `image/*`: a tour read, an image, a bad image id, `limit=0`, a path outside the table, `%ZZ` and an unknown tour answered with the same status, body and headers before and after (the image's `sha256sum` `dd729923…` equals its id both times); the one difference was the engine's own `builtAt` stamp in the tour read.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/affected-areas/affected-areas.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/affected-areas/affected-areas.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/affected-areas/index.ts

## MAN-8575 — The Tours view — src/modules/affected-areas: where state lives, what the counts mean, the reads and the presses

The Tours view: a DocuSketch tour's affected areas drawn on a view's photo, or on the pano's six views as one 360° sphere. Three screens, one at a time: `TourPicker` → `TourScreen` → `PanoScreen`. `TourScreen` carries the DAY-ONE SKETCH between its room list and its panos: the engine's plan drawn with each pano's spot, each area and each fixture laid on it, a list by room beside the job's sketch and first drying report, the scale and pin lines, and "Read the room layout", the layout press and its walk (MAN-9038; the walk: MAN-8576). A region on the pano screen says where it is counted (`placementNotes`, MAN-9038). Data is `api.affectedAreas` (wire MAN-8558, lane MAN-8559, routes MAN-8540). Drawn with the library's `RegionImage`, `Gallery` (MAN-8579) and `SphereView` (MAN-8943); the 360° screen's pieces, rules and proof: MAN-8956. A switch at the view's top (`ToursSwitch`: Tours · Mark · Tables) chooses the surface: Tours is that walk; the Tables screen (`TablesScreen`, how right the reader is per kind) is beside it, not a step of it: MAN-8581; the marks (the mark bar, Missed one, the Mark screen, the understanding mark) judge what the walk draws: MAN-8582, rules MAN-8583.

## State of the module
| fact | value |
|---|---|
| phase | live: the Cerberus tab's fourth view, reading the lane; run whole against the live engine 2026-10-17 (`.verify/affected-areas-view.mjs`, `.verify/affected-areas-walk.mjs`); its 360° screen run 2026-10-22 (`.verify/affected-areas-sphere.mjs`: MAN-8956) |
| mounted | `CerberusPanel` imports the lazy `AffectedAreasView` through this module's barrel and draws it after History in the strip, only once center's overview has answered (`overview !== null`, as every view), inside a `KeptView` (MAN-8918): mounted on the first show of the Tours tab, `hidden` after, kept mounted while the Cerberus workspace tab stands (leaving that tab for Chat unmounts the panel and the view with it, and the tour, pano, `shown` and the sphere's look are lost then). why: the tour, pano, `shown` and scroll survive a visit to Fleet (MAN-7891); the views share ONE scroller, so the panel's `useKeptViews` keeps Tours's offset (written as Tours is left, restored as it returns) |
| words | `affectedAreas.*` and `cerberus.tours.{tab,tabHint}` in `src/modules/i18n/locales/en/common.json` |
| shared types | `AffectedAreasRead<T>` (`{ value, trouble, retry }`), `PanoPress`, `PanoShown` (`'sphere'` or a `Face`), `TourReaderProgress`, `AffectedAreasTrouble`, `PanoRoom` (a pano's `roomKey` and `floor`, against which a region's placement says "Counted in {room}"), `DayOneSection` (what `DayOneSketch` is handed, MAN-9038) in `src/shared/types.ts`; the sphere's `CubeFaces`, `SphereShape`, `SphereLook`, `SphereTrouble`: MAN-8943; the marks' `ToursScreenKey`, `RegionLayer`, `MarkWalk`, `MissedStage`: MAN-8582 |
| shared constants | `AFFECTED_AREAS_LANE_FAULTS` (`no_secret`, `unreachable`, `unreadable`: the faults of the lane whatever was asked, each said in `affectedAreas.trouble.<fault>`) in `src/shared/constants.ts`; read by `LaneTrouble`, `ThresholdControl`, `MarkRefusal`. `MARK_NOTE_MAX` (500) beside it: MAN-8582 |

## 360° on the pano screen
| fact | value |
|---|---|
| opens on 360° | `usePanoPlace.openPano` sets `shown: 'sphere'`; `sphereLook` is the pano's Ahead view's own cut (`lookOf`), or `AHEAD_LOOK` (0, 0, 90) when the tour lists none; nothing chosen; layer `all` |
| the strip | `FaceStrip`: 360° first (`affectedAreas.sphere.tab`), counted by `panoCounts(views).areas` (the six faces' counts summed); then Ahead · Right · Behind · Left · Ceiling · Floor |
| 360° draws | photo column `PanoSphere` (`SphereView`, `LayerSwitch` over it, the chosen area's line with `Mark it on {view}` under it, the caption with Enlarge); list column `PanoAreas` (`RegionList` under each read view's name, then "Nothing found on …" and "Not read yet: …") |
| `CUBE_OF` | `Record<Face, keyof CubeFaces>`, six view names to cube faces, and the frame it rests on (the adapter's direction, yaw and pitch, `flipTopBottom`, seams at ±45° and ±135°): MAN-8942 |
| `usePanoPlace` | holds `shown`, `sphereLook`, `selectedRegionId`, `enlarged`, `layer`; `onShow` returns to 360° at the view's look; `onMarkOn(face, regionId)` shows that view with the area still chosen |
| drawn only while seen | `PanoSphere` mounts `SphereView` only while its block is in layout (`useViewShown`): no canvas and no frame loop while the pano screen is hidden, and the look survives in the root |
| no row | nothing on the sphere writes; `Mark it on {view}` is the only way from the sphere to a press (the marks: MAN-8582) |

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/

## MAN-8953 — The Tours view — src/modules/affected-areas: where state lives, what the counts — Files
section: The Tours view — src/modules/affected-areas: where state lives, what the counts mean, the reads and the presses/001 Files

| file | holds |
|---|---|
| `AffectedAreasView.tsx` | the root: calls every hook of the Tours screens and holds their handlers; picks the Tours screen by `tourId` / `panoId` and the surface by the switch (`activeScreen`; Mark and Tables mount on their first show, stay mounted, `hidden` while another shows). `MarkScreen` and `TablesScreen` read and press for themselves (MAN-8577) |
| `@/shared/hooks/useLaneRead` | one JSON read of the lane kept for its key, shared with the Bulletins hooks (MAN-8917): `{ value, trouble, retry }` plus `reload` (quiet, keeps the value) and `replace(value, forKey)` (writes an answer that came by another road under the key it is GIVEN, and drops every read begun before it); reads when the key is set or `retry`/`reload` is called, never on a timer |
| `hooks/useTours.ts` · `useTour.ts` · `useCodebook.ts` | the picker's list (30 newest, the search text cut at 80 characters, read once typing has rested 300 ms, and only while the view is shown; `reload` when the picker comes back) · the open tour · the codebook |
| `hooks/usePano.ts` | the open pano, the dry run beside it (what a read would buy), and `pressRead(force)`: one armed press at a time per pano (kept in `inFlight`, so a press still out shows as busy when the person leaves the pano and comes back), its answer replaces the pano and the plan at once, under the key the press was made for and outranking any read begun before it, unless the person has gone to another pano. A pano the tour lists with no views is not read (its GET is a 404 until it is cut): its dry run cuts it, and until then the screen is handed it with no views; a cut that brings no answer is that pano's trouble, drawn as the header and a banner with Try again |
| `hooks/useTourReader.ts` | Read the rest: the unread panos in capture order (`panosInCaptureOrder`, `utils/tourModel.ts`, the sort `useLayoutWalk` shares), one armed press each, after the last one answered, passing a pano whose views cannot be cut; `{ walk, start, stop }` |
| `hooks/useImageUrl.ts` | `useImageUrls(shas, attempt = 0)` (a list: the open pano's six photos, and the gallery's tiles through `useTilePhotos`; a new `attempt` is a new key, so the same shas are fetched again: Try again on a photo that did not arrive), `useDrawingUrls(shas, attempt = 0)` (the same fetch over the day-one plan's SVGs, by `drawingSha`: `useDayOne`'s) and `useImageUrl(sha)` (one photo: the Mark screen's): bytes fetched with the token, object URLs revoked on unmount and on a change, aborted on a change, null on failure |
| `hooks/useTilePhotos.ts` | the tour screen's gallery photos: `useImageUrls` for the first `GALLERY_MAX` (24, `utils/tourModel.ts`) panos' Ahead views, and a second `useImageUrls` for the rest once the gallery's `onOverflowOpen` fires, so a 45-pano tour fetches 24 photos until "+N" is pressed, then the other 21 and none again. Nothing is fetched off the tour screen, and leaving it forgets the opened state (the gallery comes back collapsed) |
| `hooks/useViewShown.ts` | `isInLayout(element)` (asked before a read starts), `useViewShown(ref)` (whether the view is in layout, as state) and `useWhenShown(shown, fn)` (a word when it comes back) |
| `hooks/usePanoPlace.ts` | the open pano's place: `shown` (`PanoShown`: `'sphere'` or one of the six `Face`s), `sphereLook`, `selectedRegionId`, `enlarged` and `layer`, with `openPano(entry)` (opens on 360° looking where the pano's Ahead view was cut, `AHEAD_LOOK` when it lists none; nothing chosen, All again), `letGo()` (nothing chosen, not enlarged) and the verbs `onShow` (a tab pressed: nothing chosen; 360° from a view looks where that view looked), `onLook`, `onSelectRegion`, `onLayer`, `onMarkOn(face, regionId)` (that view shown with the area still chosen), `onEnlarge`, `onShrink`, `onFullscreen`. The root keeps no copy of the five and calls the two verbs inside its own handlers (`onOpenTour`, `onBack`, `onOpenPano`, `onBackToTour`) |

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/

## MAN-8954 — The Tours view — src/modules/affected-areas: where state lives, what the counts — `hooks/useMarkedRegions.ts` · `useQueue.ts` · `useProving.ts`
section: The Tours view — src/modules/affected-areas: where state lives, what the counts mean, the reads and the presses/002 `hooks/useMarkedRegions.ts` · `useQueue.ts` · `useProving.ts`

| file | holds |
|---|---|
| `hooks/useMarkedRegions.ts` · `useQueue.ts` · `useProving.ts` | the pano's regions with the operator's answers laid over the read · the Mark screen's walk through a queue · the Tables' read and the kind a Set threshold answered: MAN-8582, MAN-8581 |
| `utils/laneTrouble.ts` | `answerOfWrite`: sends one write of the marks plan and says what came of it. A non-2xx answer or a thrown fetch becomes an `AffectedAreasTrouble` through `troubleOfResponse` / `troubleOfFailure` in `@/shared/utils`, which the reads of both lanes share (MAN-8917) |
| `TourPicker.tsx` | search field, recent tours with a read-state badge |
| `TourScreen.tsx` | tour header with the walk (Read the rest), then `ContextCard`, then `TourRooms`, then `RoomGallery` |
| `TourRooms.tsx` | the tour's rooms in DocuSketch's walk order: name, floor, and who calls each affected, in words (MAN-8578) |
| `PanoScreen.tsx` | header + `ReadControl`, `FaceStrip`, the figure beside the list column, `UnderstandingCard`, `RoomDrying`. On a view: the figure is `MissedDraw` (the `RegionImage` photo with `LayerSwitch` over it and the chosen area's `MarkBar` under it, MAN-8582), caption, Enlarge (`Lightbox`); the list is `RegionList`. On 360°: `PanoSphere` and `PanoAreas`, no `UnderstandingCard` (MAN-8956) |
| `FaceStrip.tsx` · `ReadingList.tsx` | 360° then the six view tabs, each counting its areas (scrolling the chosen one into the strip's own box) · the waiting surface of the list of areas, drawn on a view and on 360° while the pano's detail is read |
| `PanoSphere.tsx` · `PanoAreas.tsx` | 360°: the sphere with its switch, chosen line and caption · every view's list under its name: MAN-8956 |
| `ReadControl.tsx` | the read presses (Read this pano / Read again / Read the rest), refusals in words, the walk's meter and Stop |
| `LaneTrouble.tsx` | one warn banner with Try again for a read that brought no answer; `subject`: `tours` · `tour` · `pano` · `tables` · `queue` names what failed to read (`queue`: the Mark screen's) |
| `ContextCard.tsx` · `UnderstandingCard.tsx` · `RoomDrying.tsx` · `RoomGallery.tsx` · `RegionList.tsx` | what the reader is told (the same facts for every tour; an unlinked tour adds one line saying they come from DocuSketch alone, and a card with no facts shows that line alone) · what it understood · the room's drying numbers and its demo line (`demoBeforeTour`: "Demo had begun before the tour", "No demo recorded before the tour", nothing when null) · the pano tiles (`Gallery`, max 24 then "+N") · the face's regions (its `headingId`, when given, names the card in place of its own "Marked on this view" title: 360° hands in each view's name) |
| `utils/regionLook.ts` | `REGION_LOOK` and `regionState(region)` |
| `utils/sphereFaces.ts` | the 360° view's pure model: `CUBE_OF`, `cubeFaces`, `sphereShapes`, `lookOf`: MAN-8942 |
| `utils/tourModel.ts` | `FACES`, `panoReadState`, `tourReadState`, `needsRead`, `tourUnread`, `tourFacts`, `tourName`, `addressBesideName`, `roomWords`, `spansFloors`, `spoken`, `listWords`, `capitalized`, `faceCounts(view)` (a face's `areas`, `setAside` and `proposed`, each counted through `regionState`: set aside is unsure plus not-a-change, proposed is an unmarked area of a kind with no line set), `panoCounts(views)` (those three summed over a pano's views, plus `read`, the views carrying a read), `areaWords(counts, t)` (the caption's first parts: areas, and set aside and proposed when above zero), `kindName(cls, codebook)`: pure, no fetch, no state |
| `MarkBar.tsx` · `MarkPresses.tsx` · `MarkPress.tsx` · `NoteDialog.tsx` · `MissedDraw.tsx` · `FacePhoto.tsx` · `LayerSwitch.tsx` · `ToursSwitch.tsx` · `MarkScreen.tsx` · `MarkQueue.tsx` · `UnderstandingMark.tsx` · `UnderstandingVerdict.tsx` | the marks: MAN-8582 |

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/

## MAN-8955 — The Tours view — src/modules/affected-areas: where state lives, what the counts — `TablesScreen.tsx` · `ProvingTable.tsx` · `ProvingDetail.tsx` · `ThresholdControl.tsx` ·
section: The Tours view — src/modules/affected-areas: where state lives, what the counts mean, the reads and the presses/003 `TablesScreen.tsx` · `ProvingTable.tsx` · `ProvingDetail.tsx` · `ThresholdControl.tsx` ·

| file | holds |
|---|---|
| `TablesScreen.tsx` · `ProvingTable.tsx` · `ProvingDetail.tsx` · `ThresholdControl.tsx` · `utils/provingModel.ts` | the Tables screen, its opened row, its threshold control, how its figures read: MAN-8581 |

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/

## MAN-8576 — The Tours view — src/modules/affected-areas: where state lives, what the counts mean, the reads and the presses — Root order (`AffectedAreasView.tsx`)
section: The Tours view — src/modules/affected-areas: where state lives, what the counts mean, the reads and the presses/004 Root order (`AffectedAreasView.tsx`)

1. state (`query`, `tourId`, `panoId`, `photoAttempt`, `place = usePanoPlace()` holding `shown`, `sphereLook`, `selectedRegionId`, `enlarged`, `layer`)
2. reads (`useTours`, `useTour`, `usePano`, `useCodebook`), each `{ value, trouble, retry }`; `useTour` adds `reload`, `usePano` adds `press`, `pressRead`, `reload`
3. derivations (`summary`, `entry`, `room`, `unread = tourUnread(...)`)
4. photos, walk, handlers (`useImageUrls(…, photoAttempt)`, `useTilePhotos`, `useTourReader`, `useDayOne` (the day-one sketch's plan, drawings, dry run and layout walk, handed to `TourScreen` as one `DayOneSection`; each answer of its walk that moved the plan reads the tour and the open pano again, as the reader's walk does), `on*`, `onOpenPanoAt` (an area opens its photo's pano at its face with its region chosen, an object at its face alone))

A step reads only what the steps above it produce. why: the open pano's six photos are read off `marked.pano ?? entry` with no reordering.

## What the numbers mean
| where | counts |
|---|---|
| face tab, caption "3 areas · 2 set aside · 1 proposed · read 3h ago" | `faceCounts` in `utils/tourModel.ts` (read by `FaceStrip.tsx` and `PanoScreen.tsx`), each region read through `regionState`: once the pano answered, set aside = `unsure` + `not_a_change` regions, proposed = unmarked regions of a kind with no line set (`proposed` with `standing === false`), areas = the rest; the tab counts areas. The 360° tab counts the six views summed (`panoCounts`, same file: `areas`, `setAside`, `proposed` and `read`, the views carrying a read), so the strip's numbers add up across the tabs. Before it answers, `listedAreas`: areas = `standingCount ?? regionsCount`, set aside and proposed hidden (the listing carries no state per region, so it cannot tell a proposed area from one set aside and names neither) |
| region list "Marked on this view", badges, outlines | every region of the face, set aside and proposed included; areas + set aside + proposed = outlines drawn. On 360° the same sum over the six views: each view's list under its name (`PanoAreas`), every outline on the sphere |
| 360° caption "0 areas · 5 proposed · 6 of 6 views read" | `areaWords(panoCounts(views))` then `viewsRead` (`affectedAreas.sphere.viewsRead`), in `PanoSphere`. With none of the six read, "0 of 6 views read" alone (an area count there would read as nothing found). While the pano's detail is in flight (`reading`): "Reading the pano…" (`affectedAreas.pano.reading`), since the listing's views carry no regions and a count would say "0 areas" over a pano that has them. On Standing the caption still counts every area |
| gallery tile badge | the standing areas summed over a pano's views (`listedAreas`): "3 areas"; "2 found" (`regionsCount` summed) while none stands and the reader found some, whether nobody judged them or the operator set them all aside (the listing cannot tell); "None found" when it found none. |
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
section: The Tours view — src/modules/affected-areas: where state lives, what the counts mean, the reads and the presses/005 Rules an editor must not break

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
- `index.ts` exports the lazy view only; siblings import each other by path, never through the barrel. The lazy view's surround is the shared `ViewBoundary` (`src/shared/ui`, MAN-8917), which the Cerberus tab's `KeptView` draws around it.
- `SCREEN_ENTER` (`AffectedAreasView.tsx`, the page-in animation) fills `backwards`, never `both`. why: a forward-filled transform animation keeps the screen a containing block for fixed descendants after it ends (computed `transform` reads `none`, the fill still applies), so the sphere's iPhone fullscreen stage filled the screen's box and not the phone's. Any new page-in wrapper with `both` regresses it (MAN-8944).
- 360° draws from the pano's detail: `PanoAreas` is handed `detail.views` and the list column is `ReadingList` while `detail === null`; `PanoSphere` is handed `reading={detail === null}` (MAN-8956).
- The strip's accessible name is `affectedAreas.pano.viewsLabel`: a locale adds that key.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/

## MAN-8939 — The Tours view — src/modules/affected-areas: where state lives, what the counts — `useLaneRead.replace(value, forKey)` takes the key its answer is for, never the render's own: a
section: The Tours view — src/modules/affected-areas: where state lives, what the counts mean, the reads and the presses/006 `useLaneRead.replace(value, forKey)` takes the key its answer is for, never the render's own: a

- `useLaneRead.replace(value, forKey)` takes the key its answer is for, never the render's own: a press made while the tour still listed the pano uncut has a null key in its render. It outranks every read begun before it (`replacedRef`). why: without both, a pano GET answering with the pre-press detail landed over the press's pano and left the faces unread.
- A refusal of one pano alone is passed by the walk, not a stop: `PER_PANO_REFUSALS` in `useTourReader.ts` holds only `views_refused`, as the engine's walker does (MAN-8576).
- An object URL is revoked with the record that names it (`useImageUrls` clears its record in the effect's cleanup). why: a list that comes back (the tour screen after a pano) would find its own old key and hand `<img>` revoked URLs: eight `ERR_FILE_NOT_FOUND` errors in the viewer run of 2026-10-17.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/

## MAN-8940 — The Tours view — src/modules/affected-areas: where state lives, what the counts — Measured 2026-10-17 (live engine, :5183)
section: The Tours view — src/modules/affected-areas: where state lives, what the counts mean, the reads and the presses/007 Measured 2026-10-17 (live engine, :5183)

- `.verify/affected-areas-view.mjs`: Cerberus → Tours → CLARENCE TSE → Dinning Room → each face at 1280 and 390 px: the polygons on the photo equal the engine's regions per face, the badges read 1..n and are the list's rows and the engine's ordinals, a region chosen on the photo is the row's and back, Enlarge keeps every outline on the photo (0.00 px off), nothing is read while the pano idles or Fleet shows, and Read this pano on one unread pano answers 200 `read`, 6 views, and the face strip counts the engine's areas at once.
- `.verify/affected-areas-walk.mjs`: Stop after this pano ends the walk after the pano in hand; a view hidden mid-walk sends no second press and reads nothing until it returns, then reads the tour once; the walk goes pano to pano on each answer, in capture order.
- `.verify/affected-areas-rooms.mjs --tour <24-hex tourId> [--expect-affected] [--evidence <dir>]` (the tour must be linked to a job, else exit 2): Cerberus → Tours → the tour → the Rooms card at 1280 then 390 px, once in a light and once in a dark `openConsole({ dark })` context. The app keeps the theme server-side against the dev user, so each pass switches the stored theme (`ensureTheme`, `lib/console.mjs`) and a run leaves it on dark. `--expect-affected` FAILs the run unless at least one row on the screens reads "Affected …"; without it, a run that showed none ends on a `NOTE` line and still exits 0. `WIDTHS[0]` stays 1280: `openCerberusTab` (`lib/node-card.mjs`) presses the rail's Cerberus button, which sits in the closed drawer at 390. Holds against `GET /api/affected-areas/tours/{tour}`: one row per wire room in its order, with name and floor; the words from `docusketchAffected` and `photosAffected` alone (written out in the script, not read from the component); warn tone and dot on the rows with words only; no fetch/XHR path of its own for rooms; no sideways scroll, measured on the Rooms card (`scrollWidth - clientWidth`; the card clips its overflow, so the page-level number is 0 whatever the rows do); no authenticated console error. Writes `rooms-<theme>-<width>.png`, `rooms-card-<theme>-<width>.png` and `rooms.json` (keys `<theme>-<width>`) under `.verify/shots/affected-areas-rooms/`.
- 2026-10-18, `.verify/affected-areas-rooms.mjs --tour 6ace5eb736f92c16415baa7e` with one demonstration confirm on its Garage drying-equipment region (deleted by its mark id after; the ledger counted back to 0 marks, 0 thresholds, 0 drawn areas): 26 PASS, 0 FAIL, exit 0, light and dark, 1280 and 390 px. One row, Garage, Floor 1, "Affected per the photos" (`docusketchAffected` false, `photosAffected` true, `regionsStanding` 1); at 390 px overflow `{"page":0,"rooms":0}`, warn tone and dot on that row.
- `.verify/affected-areas-tours-told.mjs [--evidence <dir>]` (reads the live lane first and exits 2 when it holds no unlinked tour with a loss type or none without facts; buys and writes nothing; its one stub is the rewritten pano GET below): at 1280 and 390 px, no picker row reads "Tour with no job or address" and every pre-job tour (8 on 2026-10-18) is in the picker by its DocuSketch name, with "No job linked"; an unlinked tour with a loss type draws it ("Water loss", from its own `context.lossType`) and the DocuSketch-alone line, no Property and no "isn't linked", its address beside its name; a factless unlinked tour draws the DocuSketch-alone line only; a room whose `demoBeforeTour` is false says "No demo recorded before the tour", true "Demo had begun before the tour". `openTour` throws unless the client asked the lane for the pressed tour's id (a label can belong to two tours). At 1280 only: the pano GET is rewritten so its first view reads `current: false` and no view `contextChanged` (every shown read on file is current today), and the pano offers Read again with `affectedAreas.read.againCurrent` naming the codebook's `contractVersion` and `model`. 2026-10-18: 27 PASS, 0 FAIL, exit 0.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/

## MAN-8941 — The Tours view — src/modules/affected-areas: where state lives, what the counts — `.verify/affected-areas-place.mjs` (`node .verify/affected-areas-place.mjs`; presses nothing that
section: The Tours view — src/modules/affected-areas: where state lives, what the counts mean, the reads and the presses/008 `.verify/affected-areas-place.mjs` (`node .verify/affected-areas-place.mjs`; presses nothing that

- `.verify/affected-areas-place.mjs` (`node .verify/affected-areas-place.mjs`; presses nothing that writes or spends) walks `usePanoPlace`'s verbs on CLARENCE TSE → Kitchen, one line per step (strip face, chosen row, layer value, Lightbox, outline count), and is stale: it reads the selected strip tab and the photo's outlines, and a pano opens on 360° (no view tab selected, no photo). 2026-10-22: its lines read `face none` and `outlines 0` from the opening on, and it exits 0. It proves nothing about the place until it presses Ahead first; the 360° walk is MAN-8956.
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
| the layer | `hooks/usePanoPlace.ts` (`layer`, All at first and on each `openPano`), `PanoScreen.tsx`, `PanoSphere.tsx` | `LayerSwitch` as `MissedDraw`'s `tools` on a view, and at the start of the photo's tool row on 360°. On Standing the photo and the sphere (`sphereShapes`) keep the regions whose wire `standing` is not false, and the chosen area whatever its flag; the list and the caption keep every area |
| Missed one · the bar | `PanoScreen.tsx` | `MissedDraw` in place of the photo div when the pano has answered and the face has a view (`key={view.sha256}`; `nextOrdinal` = highest ordinal of ALL the view's regions + 1); `MarkBar` on the chosen region as its `bar` (`queue` `browse`). 360° has neither: its chosen line's `Mark it on {view}` calls `onMarkOn`, which shows that view with the area still chosen, and `MarkBar` stands under that photo (MAN-8956) |
| kind names | `PanoScreen.tsx`, `RegionList.tsx`, `PanoSphere.tsx` | outline, list and the sphere's chosen line name a row by `region.effectiveClass ?? region.class`, so a rename redraws them |
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

## MAN-8687 — The native-scroll gate — `.verify/native-scroll-drag.mjs`: a swipe on a row or card is the browser's own scroll, and hold-and-drag still carries

Proves a swipe that starts on a chat row or an epic-deck card is the phone's own scroll and glide, and a hold of 0.5 s then a drag still carries the item through the browser's `pointercancel`. Mechanism: MAN-7525 (chat list), MAN-8136 (`sortable/touchCarry.ts`), MAN-8138 (`usePointerDrag`).

## Run
`STAGE=before|after|all SUNSET_SLOT=<n> bash .verify/native-scroll-drag-scratch.sh [evidence dir]` (several minutes; slot default 8, evidence default `.verify/artifacts/native-scroll-drag/`).
| piece | is |
| --- | --- |
| stack | `.verify/lib/simple-list-stack.sh`: a scratch API on a copy of the database |
| `before` client | the files in the runner's `NATIVE_SCROLL_BEFORE_FILES` served as git HEAD holds them (`lib/vite-scratch-before.config.mjs` serves a file the change deleted from its HEAD text); a file the change added is not listed |
| `after` client | chat list: the scratch client; deck: the dev client (`DEV_CLIENT`, default `http://127.0.0.1:5183`) |
| `native-scroll-drag.mjs --label before\|after --chat-app <url> --deck-app <url> [--out <dir>]` | `before` only records and exits 0; `after` exits 1 on any failed check; `refuseLiveApp` refuses the operator's app as `--chat-app` |

## Phone model — `lib/phone-uncancelable.mjs`
- `UNCANCELABLE_TOUCH`: init script that wraps `EventTarget.prototype.addEventListener` so every `touchstart` / `touchmove` listener is passive; Chromium then dispatches those touches uncancelable, as the operator's Galaxy Z Fold 8 does. why: headless Chromium dispatches touches blocking, so every earlier gate passed a hold the phone fails.
- `TOUCH_RECORDER` (`window.__touchTrace`), `resetTouchTrace(page)`, `readTouchTrace(page)`, `traceLines(trace)`: the timeline of touch and pointer events with each one's `cancelable`.
- The finger is `openFinger` (`lib/touch-input.mjs`, CDP `Input.dispatchTouchEvent`), 390×844.
- `PROOF_COUNTERS` (`lib/native-scroll-legs.mjs`): counts the PAGE's `scrollTop=` / `scroll` / `scrollBy` / `scrollTo` and every `preventDefault` on a touch event. The browser's own scrolling never passes through it.

## Surfaces — `lib/native-scroll-surfaces.mjs`
| surface | runs on |
| --- | --- |
| `chatSurface(env)` | the sidebar's simple list on the scratch stack; a carry writes its order to the copy |
| `deckSurface(env)` | the In flight tab's epic deck on the card-order lane (`lib/order-lane.mjs`) on the dev client; every dispatcher write stubbed, preferences pinned: nothing is stored |
A surface supplies `open(scenario, theme)`, `flickFrom`, `carryPlan`, `edgePlan`, `mousePlan`, `outcome`, `shot`; the deck adds `strips` (`[data-arc-strip]` plan strip, `[data-status-flow]` phase track) and `stripPoint`.

## Legs — `lib/native-scroll-legs.mjs`, in order per surface
| leg | asserts |
| --- | --- |
| `scrollLeg` flick | a swipe from a row or card moves the pane under the finger, the pane glides on after the lift, the page writes no scroll position, nothing lifts, no touch event is prevented |
| `carryLeg` hold + drag | the hold lifts; `pointercancel` arrives after the lift (400 ms); the item still follows the finger; the pane's `scrollTop` is unchanged at the checkpoint, after the finger turns back toward the press point, and at the drop; it drops at the new place; nothing is left (no `data-carried`, no `vv-dragging`, the pane's `overflow` and the count of inline `overflow` styles as at rest); zero `preventDefault` on touch events |
| `edgeLeg` | a lifted item in the pane's bottom zone: the pane is `overflow: hidden`, still scrolls toward the edge by the carry's own script, and is restored afterwards |
| `stripLeg` (deck) | a vertical swipe from inside the plan strip or the phase track scrolls the pane, a sideways one the strip; neither lifts; the page writes no scroll position |
| `mouseLeg` | a desktop mouse carry lifts, follows the pointer, drops at the new place, leaves nothing |
| `restLeg` (`after` only) | a resting shot at desktop and phone, dark and light |
Then: no console or page error on either surface except the seeded chats' `token-usage` 404.
why the turn-back in `carryLeg`: a chat list at the top of the pane cannot pan under a downward finger, so the first reading could pass with the freeze undone; a finger turning back up can.

## Measured
- 2026-10-20, before the turn-back reading existed: `after` 38 of 38 checks pass; the HEAD client fails 10: on both surfaces no glide, 6 page scroll writes per flick, no `pointercancel` mid-carry, the pane not held at the edge leg; on the deck, the page's scroll writes inside the plan strip and the phase track. Pane `scrollTop` across the carry: chat 0, 0, 0; deck 154, 154, 154. Glide after the lift: chat 223 → 386, deck 223 → 430 over 250–300 ms. `pointercancel` at 603 ms (chat), 583 ms (deck). The turn-back reading has not run.
- Not reproduced: any real phone, Android's long-press buzz, an iPhone's callout. The Fold itself has never run this gate.
- `.verify/` is git-ignored: the gate is local to this checkout.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/native-scroll-legs.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/native-scroll-surfaces.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/phone-uncancelable.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/native-scroll-drag.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/native-scroll-drag-scratch.sh

## MAN-8695 — The Claude API keys card — files, the read contract and the strings

Settings → Agents → Claude: the card that shows who pays for plan runs and holds the two Anthropic API key slots. It draws the door's picture (`~/.claude/scripts/claude-api status --json`, MAN-8625) through Settings' own routes (MAN-8701) and does no arithmetic of its own. Mounted by `AgentCategoryContentSection.tsx` directly after `<RunnerModelContent />`, and live from the day it landed: with no key entered, the door names the subscription and every launch rides what it rode before.

## Files — `src/modules/settings/tabs/agents-settings/sections/`
| file | role |
|---|---|
| `content/ClaudeApiKeysContent.tsx` | the card: header row (title, payer `Badge`, the door's `rides.why` + purpose sentence, retry press), then one `ClaudeApiKeyRow` per slot 1, 2 in slot order |
| `content/ClaudeApiKeyRow.tsx` | one slot: label + `Saved <date>`/`Not set`/`Unknown` badge, the standing line, one form (key, name, monthly credit, renewal day) with `Save`/`Replace` and `Remove`, both refusing the press while any slot's write is out |
| `content/claude-api-standing.ts` | pure: `standingOf(picture, unknown, t)` → `{tone, base, clause}`, `formatDay`, `usd` |
| `src/shared/hooks/useClaudeApiKeys.ts` | the read and the three acts: `GET /api/settings/claude-api`, `PUT`/`DELETE …/:slot`; one module-level epoch, one read at a time, a re-read after a failed write, a re-ask on focus and visibilitychange (one page return is one read), no timer |
| `src/shared/api.ts` | `settings.claudeApi()`, `settings.saveClaudeApiKey(slot, body)`, `settings.removeClaudeApiKey(slot)` |
| `AgentCategoryContentSection.tsx` | mounts `<ClaudeApiKeysContent />` directly after `<RunnerModelContent />` |
| `src/modules/i18n/locales/en/settings.json` | `agents.claudeApi`, 38 leaf keys, between `runnerModel` and `runnerHealModel`; every `t()` call in the four files carries a `defaultValue`; other locales fall back |

The read is `useClaudeApiKeys()`; `onSave` calls its `save` and empties the slot's draft only on a true answer; `onRemove`/`onRetry` call `remove`/`refresh`; the card mounts as the component itself.

## The read contract — `ClaudeApiCardView` (`src/shared/types.ts`)
| field | meaning |
|---|---|
| `picture` | `ClaudeApiPicture` · `{unreadable: true}` (read failed) · `null` (read on the wire) |
| `savingSlot` | slot a write is in flight on, or `null` |
| `refusal` | `{slot, words}`: the door's own sentence for a refused save, or the failure sentence for a write that never got an answer, drawn under that slot's key field; it is the pressing surface's own state, not carried across a remount |
| `save(slot, body)` | `Promise<boolean>`, `true` only on SAVED |
| `remove(slot)`, `refresh()` | `Promise<void>`; `refresh` is the retry |
- `ClaudeApiKeySave` = `{key?, label?, creditUsd?, renewsDay?}`: an omitted field keeps the slot's stored value; `renewsDay: null` clears the day; `key` is present only when the reader typed one. Its target is `PUT /api/settings/claude-api/:slot` (live, MAN-8701), body never logged or echoed.
- The unreadable sentence promises a re-ask "whenever this page regains focus": the hook's `focus`/`visibilitychange` listeners are that promise.
- Type mirrors: `ClaudeApiWall`, `ClaudeApiKeyPicture`, `ClaudeApiPicture`, `ClaudeApiUnreadable` (4 declarations + 2 comments, 2298 bytes, 32 lines) stand byte-identical in `src/shared/types.ts` and `server/shared/types.ts`. `ClaudeApiKeySave` and `ClaudeApiCardView` are the client mirror's only.

## What each state draws
| state | draws |
|---|---|
| `asking` | `Asking…` badge, `Loading...`, retry press, no slot rows |
| `unreadable` | `Unknown` badge, the unreadable sentence, retry press; both slots `Unknown`, standing `Unknown — …not the same as not set`, no form |
| read | payer badge: `Subscription` (positive) · `API key <n>` (info) · `Walled` (warn, every payer walled); FIRST LINE = `rides.why` alone for every `rides.slot`, 0, 1, 2 and `null` (`ridesNone` when `why` is empty), because the door's sentence already opens "Plan runs ride …" and a payer sentence of the card's own said it twice (INV-8937); then the purpose sentence |
| standing line order | wall (`refused` danger · `credit` · `spend` · `rate`, warn; `usage` draws the door's `detail`) → window open (`spending down until <cycle end>`, info) → no renewal day → `window opens <date>` / `window not open yet` |
Dates draw in the reader's locale and zone (`toLocaleDateString`), so an epoch at UTC midnight can read as the previous local day.

## Rules the card holds
- **SAVED empties the field, and nothing else.** A 422 keeps the typed key so it can be corrected and draws the door's words under the field (the `Field` error slot, `role="alert"`); any other failed write keeps it too, draws the door's message or a failure sentence, and re-reads the store.
- **One write at a time, visibly.** While any slot's write is on the wire, every row's `Save`/`Replace` and `Remove` refuses the press (`aria-disabled`; the button keeps focus) and an Enter submit in a field is refused too, so a second press is never silently dropped. A Save that still races the guard answers a sentence under its field; a Remove that does is dropped. Editor's rules: INV-8936, INV-8937.
- **A refusal belongs to the surface that pressed Save.** It is the mounting card's own state: leaving and returning does not redraw a sentence about a press nobody made on that screen, and the next press retires it.
- **Unreadable is never "not set".** A failed GET — a non-2xx, a body that is not the picture, a thrown call — answers `{unreadable: true}`, which the card draws as unknown in words with no form (INV-8936).
- **No timer, and no on-demand arithmetic.** The picture moves while Settings is closed (a wall lands, a window opens), so the hook asks again on `focus` and `visibilitychange`; the pair one return fires is one ask (a 600 ms window), nothing polls and no figure is computed from the picture's parts.
- **One epoch.** A read issued before a write and answered after it is dropped; a save's fresh picture is the server's read-back, never an echo of what was sent.
- **A write that failed may have landed** (the door writes the slot before it lifts the walls), so every failure answers a re-read, not the side the card asked for.
- **The key is one-way.** It travels in the PUT body only, into the door's stdin; the picture, the GET, a refusal and an error carry none. The card names a key by slot and label, never by id or digest (INV-76).

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/settings.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/AgentCategoryContentSection.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/content/ClaudeApiKeyRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/content/ClaudeApiKeysContent.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/content/claude-api-standing.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useClaudeApiKeys.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## MAN-8849 — The accounts module's launch reads — account-door.ts (the credential) and chosen-account.ts (the choice)

The two reads the rest of the server makes of the house's Claude account store. Python side: the door MAN-8842, the records MAN-8840, the token MAN-8841. Consumer: MAN-8848.

## Barrel — `server/modules/accounts/index.ts`
| export | from | answers |
|---|---|---|
| `launchCredential` | `account-door.ts` | the account in use and its token, for a CLI start |
| `chosenAccount` | `chosen-account.ts` | the house's choice now, or `null` |
| `liveAccountEmail` | `account-identity.service.ts` (`identity`) | the live login's email, `oauthAccount.emailAddress` of `~/.claude.json`; the only credential-adjacent read the server keeps besides the meter, and it opens no credential file |
| `notePacerReading` | `pacer-door.ts` (`note`) | files one window reading with the pacer: `(digest, windows, checkedAt, 'meter' \| 'chat')`; consumers `usage.service.ts` (`'meter'`) and `claude-chat-readings.ts` (`'chat'`, MAN-8859) |
| `createAccountsModule` | `accounts.module.ts` | the composition root |

## `launchCredential()` — `account-door.ts`
- Returns `Promise<ClaudeAccountCredential>` (`server/shared/types.ts`): `{ account: string|null, slug: string|null, token: string|null }`. Never rejects.
- Runs `$CLAUDE_ACCOUNT_BIN` (default `~/.claude/scripts/claude-account`) `credential --fd 3`. The door puts `{"account","slug","token": <bool>}` on stdout and the token plus a newline on fd 3.
- fd 3 is a real FIFO: `mkfifo -m 600` in a `mkdtemp` 0700 directory under `os.tmpdir()`; the read end opened `O_NONBLOCK`, the write end handed to the child as `stdio[3]` and closed in the parent at once; the directory removed whatever the answer.
- The read end is drained synchronously, once, on the child's `close`; at exit every byte is in the pipe buffer, so the drain sees all of it and then end-of-file.
- Every failure answers `{ account: null, slug: null, token: null }` and the launch rides the live login: FIFO not creatable, spawn error, non-zero exit, 10 s bound (`SIGKILL`), stdout not the promised shape (`token` not a boolean, `account`/`slug` neither string nor null).
- The only relayed string is the door's stderr on a non-zero exit, logged `[claude-account] credential: <text>` with `sk-ant-[A-Za-z0-9_-]{8,}` replaced by `[key]`. Stdout is parsed and never printed.

- `account-door.ts` also carries the panel's door faces — `accountsPicture`, `useAccount`, `setAuto`, `removeAccount`, with the relay in `account-door-relay.ts`: MAN-8858.

## `chosenAccount()` — `chosen-account.ts`
- Returns `{ digest, slug } | null`, read on every call from `<home>/chosen.json`; never cached, never called on a timer.
- `<home>` follows the Python store's `record.home()`: `$PLAN_RUNNER_CLAUDE_ACCOUNT_HOME` (made absolute, `~` expanded) when set; else the parent of a set `$DISPATCHER_HOME`, plus `/claude_account`; else `~/.claude/state/claude_account`.
- `null` on any fault: file absent, unreadable, half-written, or not the two fields with an 8-hex `digest`.

## Proof — `.verify/account-chat-launch.sh`
- One `mktemp -d` scratch home on `:7898`, two made-up accounts saved through `tokens.save` / `store.set_token` / `store.choose`; the five seams (`DISPATCHER_HOME`, `PLAN_RUNNER_CLAUDE_ACCOUNT_HOME`, `PLAN_RUNNER_CLAUDE_ACCOUNT_TOKENS`, `PLAN_RUNNER_CLAUDE_IDENTITY_PATH`, `CLAUDE_LAUNCHES_PATH`) are read back from `/proc/<pid>/environ`; the real door runs against them (`CLAUDE_ACCOUNT_BIN` unset).
- `.verify/account-chat-launch.mjs` drives one turn on a chat, creating or attaching.
- Measured 2026-10-21: turn 1 answers `Failed to authenticate. API Error: 401 OAuth access token is invalid.` (the made-up token rode); after `store.choose` of the other account the same chat's next message logs the replacement and the launch record gains a `respawn: account probe-alpha → probe-beta` line; the token appears in 0 lines of the server log, the sessions directory and the launch record.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/account-door.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/chosen-account.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/account-chat-launch.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/account-chat-launch.sh

## MAN-8858 — The account door's panel faces — the picture and the three writes (account-door-relay.ts, accounts.routes.ts)

Reference: door verbs MAN-8842, the picture's shape MAN-8843, the types' mirror rule INV-9252, the launch reads in the same barrel MAN-8849, the panel MAN-460.

## Files — `server/modules/accounts/`
| file | owns |
|---|---|
| `account-door-relay.ts` | `accountsPicture()`, `writeDoor(args)`, `AccountDoorRefusal`, `doorBin()`, `redact()`, `DOOR_TIMEOUT_MS` |
| `account-door.ts` | re-exports `AccountDoorRefusal` and `accountsPicture`; `useAccount(slug)`, `setAuto(on)`, `removeAccount(slug)` (each → the door's line); the credential read (MAN-8849) |
| `accounts.routes.ts` | the routes below and `GET /api/usage`; the whole account route surface is these five |

## Routes — mounted at `/api` behind `authenticateToken`
| route | body | 200 | refused |
|---|---|---|---|
| `GET /api/accounts` | — | the door's picture at the top level: `{reachable:true, accounts, candidates, auto, held, chosen, last_switch}`, or `{reachable:false, reason}` | never a 5xx |
| `POST /api/accounts/use` | `{slug: string}` | `{line}` = `USING <slug>…` | 422 `{error}` |
| `POST /api/accounts/auto` | `{on: boolean}` | `{line}` = `AUTO on` / `AUTO off` | 422 `{error}` |
| `POST /api/accounts/remove` | `{slug: string}` | `{line}` = `REMOVED <slug>` | 422 `{error}` |

## The picture on `GET /api/accounts`
- `claude-account status --json` relayed whole (`ClaudeAccountsPicture`, MAN-8843) at the top level, tagged `reachable:true` (`accountsBody`). No `door` member exists on the wire.
- A door that cannot answer is `{reachable:false, reason}` inside a 200; the route's belt answers the same shape with `reason:"unreachable"`.
- `reason`: `timeout` (bound hit), `bad-response` (stdout is not JSON, or lacks `accounts`/`candidates` arrays, `auto`/`held` booleans, `chosen`/`last_switch` null-or-object), `unreachable` (anything else: missing binary, non-zero exit).
- Every string of the picture, a line, a refusal and a 502 sentence passes `redact` (`sk-ant-[A-Za-z0-9_-]{8,}` → `[key]`).

## The writes
- A malformed body is refused before the door is asked: `{}` → 422 `{error:"slug is required"}`; `{"on":"yes"}` → 422 `{error:"on must be true or false"}`.
- 422 `{error}` = door exit 2 with a stdout line beginning `REFUSED`; the protocol word is stripped, the sentence is the door's (a `use` of an unknown or tokenless slug, a `remove` of an unknown slug). Caught by class (`AccountDoorRefusal`): a new refusal sentence in the door needs no change here.
- Any other failure of a write is a 502 `AppError` `CLAUDE_ACCOUNT_DOOR_FAILED` carrying the door's one stderr line (redacted), else `the claude-account door did not answer` / `… in time`. A write that did not land never answers as a read does.
- The routes send no kick: the door's `use` and `remove` kick the dispatcher themselves (INV-187).

## Rules an editor must not break
| edit | breaks | why |
|---|---|---|
| Hand a free-form value to a door write without `--` before it (`['use','--',slug]`, `['remove','--',slug]`) | `use --help` answers usage text with exit 0 and relays as a 200 for a write that never happened; `--state` answers a usage error as a 502 | the door is argparse; `--` makes the slug a positional |
| Refuse a leading `-` in a slug at the route | an account named `-foo` can no longer be chosen from the panel | the door's `_slot_name` accepts it; the separator is the cure |
| Make a door refusal the panel shows as 422 anything but exit 2 plus a `REFUSED …` stdout line | it relays as a 502 with the class name | the relay classifies on that shape only |
| Drop `killSignal: 'SIGKILL'` from either `execFile` | a door or `CLAUDE_ACCOUNT_BIN` wrapper that traps SIGTERM holds the status-chip poll for its whole life | `killed` stays true on SIGKILL, so the read still answers `timeout` |
| Let `accountsPicture()` reject | the status-chip poll answers a 5xx | the route's `.catch` is a belt over a read that is total by construction |

## Measured
- 2026-10-21, live dev API `:3011`: `GET /api/accounts` → 200, top-level keys `accounts, auto, candidates, chosen, held, last_switch, reachable`, no `door`, 2 accounts.
- 2026-10-21, probe server `:7898` on a scratch home: `use` tokenless → 422 `beta: no checked sign-in token — set it up first`; `use` checked → 200 `{"line":"USING alpha"}`, GET shows alpha `in_use:true, chosen:true`; `auto` → `AUTO off` / `AUTO on`; `remove` → `REMOVED beta`, GET drops it.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/account-door-relay.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/account-door.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/accounts.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/accounts.routes.ts

## MAN-8863 — The shadow-connector lane forwarder — createShadowConnectorLane, the one read of EIS_INTERNAL_SECRET (server/shared)

`server/shared/shadow-connector-lane.ts` is the one forwarder every CloudCLI lane to shadow-connector goes through, and the one place `EIS_INTERNAL_SECRET` is read. shadow-connector's `/api/*` surfaces are internal-caller gated (R-CAP-11: `X-Internal-Secret` required even from loopback); this server authenticates the operator, so the secret stays on this side and the browser never holds it. Exported from `server/shared/index.ts`. The routes of a lane are `server/shared/shadow-connector-lane-router.ts` (MAN-8908), which calls this file's `forward`.

Consumers (each owns its allowlist, id rules and image type; none owns a transport):

| module | lane | label |
|---|---|---|
| `server/modules/affected-areas/` (MAN-8559) | `/api/affected-areas`, the Tours lane | `affected-areas` |
| `server/modules/carrier-bulletins/` (MAN-8909) | `/api/carrier-bulletins`, the bulletins lane | `carrier-bulletins` |

| export | does |
|---|---|
| `createShadowConnectorLane({ baseUrl, envFile, label })` | builds a forwarder; the module that calls it is the ONLY reader of `SHADOW_CONNECTOR_URL` / `SHADOW_CONNECTOR_ENV_FILE` for its lane, and passes the values down |
| `ShadowConnectorLane` | `{ forward(LaneRequest): Promise<LaneAnswer> }`; a router takes `Pick<ShadowConnectorLane, 'forward'>` |
| `ShadowConnectorLaneDependencies` | `{ baseUrl, envFile, label }`; `label` is the one word the log warning leads with |
| `LaneRequest` | `{ method: GET\|POST\|PUT, path, query?, body?, actingUser, timeoutMs, expect: json\|bytes, passHeaders? }`; the route has already validated every part. `passHeaders` names (lower case) the upstream response headers a JSON answer carries back; absent or empty carries none |
| `LaneAnswer` | `{ ok: true, status, kind: json, body, headers }` (`headers`: the `passHeaders` the engine sent, lower-case keys, `{}` when none), `{ ok: true, status, kind: bytes, body: Buffer, contentType }` (no headers carried), or `{ ok: false, reason: unreachable\|unreadable\|no_secret, message }` |

## The secret read (`parseSecret`, `currentSecret`)
1. `fs.stat(envFile)` on EVERY call; re-parse only when `mtimeMs` or `size` changes. A rotation lands on the next request: no restart, no watcher.
2. The last `EIS_INTERNAL_SECRET=` line wins; an `export ` prefix, CRLF line ends and an unquoted trailing ` # comment` are read as the dotenv loader reads them.
3. A quoted value is whatever stands between the quotes, verbatim; only whitespace or a `# comment` may follow the closing quote. A quote that never closes, or other text after it, is `no_secret`. **A secret that really begins with `"` or `'` must be written quoted in the env file**, or it reads as an unclosed quote and every forward answers `no_secret`.
4. Usable means printable ASCII with no whitespace at either end (`USABLE_SECRET`): the gate compares bytes, and an HTTP stack trims a header's edges.
5. A missing file or an unusable line logs one `[<label>] no usable internal secret in <file>: <cause>` line per distinct cause; never the line parsed, and never anything parsed from it.

## Headers sent
| Header | Value |
|---|---|
| `X-Internal-Secret` | the secret |
| `Accept` | `application/json`, or `image/*` for a bytes route |
| `Content-Type` | `application/json` when a body is sent |
| `X-Acting-User` | signed-in username, non-printable → `?`, trimmed, ≤ 64 chars; absent when none. Display only: the engine derives `origin` itself (R-CAP-21) |

A bytes route asks for `image/*` and not one type because the Tours lane's images are JPEGs and the bulletins lane's are PNGs; the forwarder does not know which, so it asks for any image, and each lane's router enforces its own type on the answer's Content-Type. Changed from `image/jpeg` on 2026-10-22 (the engine answers a PNG whatever `Accept` says, so this made the request truthful and changed no answer: a Tours image was byte-identical before and after).

Rules (they bind the file; INV-8633 holds them for both lanes)
1. The secret is read from shadow-connector's env file at CALL time: `fs.stat` on every call, re-parse only when `mtimeMs` or `size` changed, so a rotation lands on the next request with no restart and no watcher. It is never written to `process.env`, this server's `.env`, a log line, an error message or a cache.
2. Nothing is forwarded without it: a missing, empty, padded, non-ASCII or unclosed-quote secret answers `no_secret` (`CloudCLI could not read shadow-connector's internal secret`) and sends no request.
3. Nothing throws. A lane fault is a RESULT; an upstream answer (404, 422, a refusal) is a RESULT carried whole.
4. `fetch` runs `redirect: 'manual'`, so the secret header never follows a `Location`.
5. `describeFailure` uses only an error's NAME and its cause's CODE, never its message: a transport error can quote the request, and the request carries the secret.
6. `X-Acting-User` is display only (the engine derives `origin` itself, R-CAP-21): non-printable characters become `?`, trimmed, at most 64 characters, absent when none.

Traps
| trap | fact |
|---|---|
| state is per forwarder | each `createShadowConnectorLane` call holds its own parse of the env file and its own last-reported cause: two lanes log one line per distinct cause EACH, and each warning leads with its own `[<label>]`. A lane built without a distinct label is indistinguishable in the journal |
| the label is the log's only lane word | the Tours warning reads `[affected-areas] no usable internal secret in <file>: <cause>`, the bulletins warning `[carrier-bulletins] …`; everything else the forwarder logs or answers is identical for every lane |
| a response header travels only when the lane names it | `LaneRequest.passHeaders`; the bulletins lane names `x-left-out` (the overview's left-out carriers, MAN-8906) and `cache-control` (MAN-8909), the Tours lane none. An engine header no lane names is dropped here, by design: never carry one on a hunch, and never `Set-Cookie` |
| a new top-level `server/shared/*.ts` file | joins `.oxlintrc.json`'s `backend-shared-utils` list (INV-6548); `shadow-connector-lane.ts` and `shadow-connector-lane-router.ts` are listed |
| measured 2026-10-21 | with a missing env file, an empty one and an unreachable engine, `forward` answers `no_secret`, `no_secret` and `unreachable` (`CloudCLI could not reach shadow-connector`), and a repeated cause logs one warning, not two; `GET /api/affected-areas/tours?limit=3` and `GET /api/affected-areas/images/<sha>` through the dev API (:3011) answer 200 with the same body sha256 as before the forwarder moved here |

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/shadow-connector-lane.ts

## MAN-8865 — Carrier-bulletins client wire — src/shared/carrier-bulletins-types.ts and api.carrierBulletins

The browser's typed view of `/api/carrier-bulletins` (the Bulletins view of the Cerberus tab): one wire-type file and one `api` block, built on the Tours precedent (MAN-8558). The one home of every body is shadow-connector's `extractors/servpro_bulletins/verify/views.py`, the read model the report and the surface both print.

## Files
| file | holds |
|---|---|
| `src/shared/carrier-bulletins-types.ts` | 21 exported types: `LeftOutCarrier` (a member of the `X-Left-Out` response header of GET /overview, which names a carrier whose file could not be planned and so has no row) and `OverviewAnswer` (the rows and the left-out carriers as the view holds them; not a wire body); the three bodies `OverviewRow`, `BulletinPage`, `PageReading`; their nested ones (`LastPull`, `LastReading`, `VerdictCounts`, `ReadingStamp`, `RequirementThreshold`, `RequirementWindow`, `RequirementScope`, `SettledRule`, `PageRequirement`, `JudgedRule`, `NotPlaced`, `PageFailure`, `PageWaiting`); and the unions `PageState`, `VerdictWord` and `SaidWord`. Beyond the design's list it holds three members the live answers carry, which views.py's docstring names as such: `BulletinPage.waiting`, and `beside` on `PageRequirement` and `JudgedRule`. Imports nothing from `server/`. |
| `src/shared/api.ts` | `api.carrierBulletins`, 4 GET verbs, beside `api.affectedAreas`; no import from the mirror (each answer is named in a `// →` comment) |
| `.oxlintrc.json` | `src/shared/carrier-bulletins-types.ts` in the `frontend-shared-file` list (INV-5890) |

## Verbs
Every verb is a GET: the view is read-only, and the lane's allowlist holds GET routes only. Ids and the page number go through `encodeURIComponent`.

| verb | route | answer |
|---|---|---|
| `overview(options?)` | `GET /overview` | `OverviewRow[]` |
| `pages(bulletinId, options?)` | `GET /bulletins/:bulletinId/pages` | `BulletinPage[]` |
| `page(bulletinId, page, options?)` | `GET /bulletins/:bulletinId/pages/:page` | `PageReading` |
| `image(sha, page, options?)` | `GET /files/:sha/pages/:page/image` | PNG bytes: the caller reads `.blob()`; `options.signal` aborts |

## Rules an editor must not break
- A body changes in `views.py` first; the mirror moves in the same change. why: a key renamed on one side is a screen that stops reading.
- Keys are the wire's snake_case (`bulletin_id`, `last_reading`, `requirements_live`), never camelCase. Dates are ISO text, ids text, page numbers count from 1.
- A body field is never optional. `null` is the plain absence the field's comment names: `last_pull` no pull on record, `last_reading` never read, `reading` a page with no answer, `waiting` a page that does not wait, `rule` a requirement on a page read and not yet settled. A part heading is never `null`: `''` is a page in no part.
- `PageState` is whole.plan_file's four words (`settled`, `read`, `unread`, `waiting`); `VerdictWord` is the check's five (`confirmed`, `corrected`, `duplicate`, `not_on_page`, `unsettled`). `said` (on `JudgedRule` and `PageFailure`) is a `SaidWord`: a `VerdictWord`, or `(no entry)` where the model gave nothing usable for a rule (`read.unsettled_entry` stores that word on an answer refused whole, a rule the model left out and a rule that cites no page). `JudgedRule.verdict` is the stored `VerdictWord`; it differs from `said` when the house's checks refused the answer.
- No `interface` declarations. A new verb names its answer in a `// → Type` comment.

## Value shapes the design left open
The design writes the keys of each body and not the inside of four of them. They are typed from the page check's own answer, and each stands until a live answer says otherwise: `threshold` is `{ value, unit, measure }` and `window` is a deadline `{ hours, basis, anchor }` (`verify/contract.py`'s `Window`, `hours` null for a deadline that counts none) and/or a `cadence`, and a requirement that recurs with no deadline arrives as `{ cadence }` alone, so every member of `RequirementWindow` is optional (`view_reading._window` puts both in one object); `scope` is `{ services, loss_types, property_types }`, each a list that is EMPTY when the page names none and then means every one of its kind (`view_reading.requirement_body` sends `[]`, never `null`; the type admits `null` for the same meaning) (`verify/contract.py`'s `Requirement`; `verify/requirement.py` only normalizes the lists to compare them); a `failures` element is `{ words, said, quote, failures }` (the printable fields of `read.Entry`). `SettledRule.state`, `PageRequirement.kind` and `.subject` are plain `string`, because the design names no closed set for them.

## Measured
- 2026-10-21: the TypeScript compiler's property names of `OverviewRow`, `BulletinPage` and `PageReading` and every nested type, against the keys of the design's THE SURFACE interface parsed out of `bulletins-read-by-claude.design.toml`: every key matched at every level the design writes keys (16, 7 and 9 at the top; `last_pull` 2, `last_reading` 6, `verdicts` 5, `reading` 6, `requirements` 8, `rule` 3, `judged` 7, `not_placed` 2, `waiting` 3). The four keys above are the only places the type has structure where the design has a bare key.
- 2026-10-21: `api.carrierBulletins` run as bundled code against a recording `fetch`: the four verbs requested exactly the four routes above, all GET and no body, an id `a/b c?d` went out as `a%2Fb%20c%3Fd`, and `image` carried the caller's abort signal.
- 2026-10-22: each key of the three live answers (the overview, State Farm's pages, one page's reading) printed beside the members of the mirror by `.verify/bulletins-view.mjs`: at every level that held a live instance, every live key is a member of its type and every required member is live (an optional member, like each of `RequirementWindow`'s, need not be: a page of deadline windows carries `anchor`, `basis`, `hours` and a page of cadences only `cadence`). The design's list is not the mirror's only source: the three members above and `cadence` are in the live answers and not in the design.
- `views.py` and the surface had not landed at that time: no body was compared with a live answer.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/carrier-bulletins-types.ts

## MAN-8880 — The Bulletins view — src/modules/carrier-bulletins: the three screens, the four reads, the presses, the rules

The Bulletins view: what Claude read of each carrier's SERVPRO program bulletin and what the house settled it into. Three screens, read-only, reading on open and on a press, every word from a bulletin a React text node, names and never ids. Live as the fifth view of the Cerberus tab's strip, after Tours, kept mounted by `KeptView` (MAN-8918). Wire: MAN-8865. Shared pieces: MAN-8917. The tab's side: MAN-7891. Plans: `~/.claude/plans/bulletins-read-by-claude.design.toml`, `bulletins-read-by-claude.phases.toml`. Every body's server home: shadow-connector `extractors/servpro_bulletins/verify/views.py`.

## State of the module
| fact | value |
|---|---|
| phase | live, reading the lane. Run whole against the live engine 2026-10-22 with `.verify/bulletins-view.mjs` (no model call, no write): 53 of 53 verdicts on the code before three later changes (the empty-scope labels, the strip's own scroller at 390 px, the no-ids check). Those three were measured apart (the strip: panel scroller 445 px in a 390 px box before, 390 in 390 after) or only compiled (the scope labels, the no-ids check); the run that would show them whole timed out in the harness's own page load at box load ~50. Also unrun: the probe's own page pick, member verdict and pages-list scroll leg (syntax-checked), and the overview with every carrier left out (no empty-state sentence under the banner). Re-run it when `/proc/loadavg` is under 12: it opens State Farm's page 13, else 22, else the read page with the most to draw (it prints which), and exits 2 only when no State Farm page holds a reading that states a requirement, which is the walk's to produce; the scroll the view keeps is measured on the carrier's 51-row pages list, so it needs no tall page |
| mounted | `CerberusPanel` draws `<KeptView id="bulletins">` around the lazy `BulletinsView` (this module's barrel) after Tours, once center's overview has answered: mounted on its first show, `hidden` after, so the open carrier, page and scroll survive a visit to Fleet. Leaving the Cerberus workspace tab for Chat unmounts the panel and the view with it |
| reads | four hooks in `hooks/`, each used by the view root alone: `useOverview`, `useBulletinPages`, `usePageReading` (each is `useLaneRead`, MAN-8917, over one `api.carrierBulletins` verb) and `usePageImage` |
| words | `cerberus.bulletins.*` in `src/modules/i18n/locales/en/common.json`, including `cerberus.bulletins.tab` and `.tabHint` (the strip's two words); the surround's failure words are `viewBoundary.*` (MAN-8917) |
| shared types | wire: `src/shared/carrier-bulletins-types.ts` (MAN-8865). Lane fault: `AffectedAreasTrouble` from `src/shared/types.ts` (one forwarder, `server/shared/shadow-connector-lane.ts`, serves both lanes) |
| proof | 2026-10-22, 1280 and 390 px wide: State Farm's page 22 (the page the walk had read; page 13 when it has) drew its image beside its one requirement, the count on screen the count `GET /api/carrier-bulletins/bulletins/{id}/pages/22` holds; each key of the three live answers is a member of the wire mirror's type and every required member is live (`OverviewRow`, `BulletinPage`, `PageReading` and every nested type that had a live instance); no request but a GET; no request while Bulletins was hidden or untouched; zero console errors |

## The reads
The root holds three states (`bulletinId`, `page`, `enlarged`) and reads through four hooks. A read happens on open and on a press, never on a timer, and nothing arrives from outside that would read while the view is hidden once it is mounted (the one exception is its opening read, made when its chunk lands after the person has already pressed Fleet: it mounts inside a hidden panel and reads the overview once, as Tours does; no `useViewShown`: Tours needs one because a press's or a walk's answer can land while it is hidden; nothing does here).
| hook | key | reads when | what it holds |
|---|---|---|---|
| `useOverview()` | `overview` | the view's first show; Refresh; Try again; Back from a carrier's pages | `{ rows, left_out }`: every carrier's current file (the overview, and the header the other two screens draw from at once) and the carriers the engine could not plan, named in the response header `X-Left-Out`. The hook re-wraps the header and the body as one JSON answer because the shared `useLaneRead` reads the body alone |
| `useBulletinPages(bulletinId)` | the bulletin id; null reads nothing | a carrier opens; Refresh; Back from a page | the carrier's pages in page order, with their parts and states; the page screen leans on it for its state and part while its reading is out, and for Previous and Next |
| `usePageReading(bulletinId, page)` | `bulletinId:page`; null reads nothing | a page opens (Previous and Next too); Refresh | the page's reading, with the exact file it is of |
| `usePageImage(sha, page)` | `sha:page` | the reading names the file, and the page changes | the page's PNG as an object URL: fetched with the token (`<img>` cannot send one), aborted when the page changes, revoked on change and on unmount, `null` while it loads, when it failed, and with no page open. Never read again by Refresh: the sha is the file's content, and the browser keeps the bytes a year |

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/carrier-bulletins/

## MAN-8928 — The Bulletins view — src/modules/carrier-bulletins: the three screens, the four — The presses (all in `BulletinsView.tsx`)
section: The Bulletins view — src/modules/carrier-bulletins: the three screens, the four reads, the presses, the rules/001 The presses (all in `BulletinsView.tsx`)

| press | does |
|---|---|
| `onOpenCarrier(bulletinId)` | opens a carrier's pages: sets the carrier, no page, the Lightbox shut, and brings the view's top (`topRef`) into view when the panel was scrolled past it |
| `onOpenPage(page)` | opens a page of the open carrier (from its list, its waiting call-out, or Previous and Next): the Lightbox shut, the top in view |
| `onBack` | one screen back (a page to its carrier's pages, a carrier to the overview), the Lightbox shut, reading again what it returns to QUIETLY (`reload`: the screen stands until the new answer lands) |
| `onRefresh` | reads again what the shown screen draws: the overview; a carrier's pages and its overview row; a page's reading and its pages. A read that has failed is read again as Try again (`retry`: its banner leaves, the screen waits, and a second failure mounts the banner afresh so it is heard again); any other quietly. It is also every banner's Try again |
| `onEnlarge` / `onShrink` | open the page's image in the house `Lightbox` / shut it (Escape, the ✕ and the backdrop) |

## Screens
One at a time, held at the root as `bulletinId` (null = overview) and `page` (null = the carrier's pages); each plays `vv-pagein` when it opens.
| screen | files | draws |
|---|---|---|
| Overview | `OverviewScreen.tsx`, `CarrierRow.tsx` | headline "N carriers *need you*" (accent `warn`) or "Every file is *read and settled*", in the plain bold heading (the tab owns the one serif headline), the calm one held back (the plain title shows) while any carrier is left out; a warn banner under the header naming each carrier the engine could not plan and why (`X-Left-Out`: MAN-8865), with no empty-state sentence beside it when every carrier is left out; carriers in groups `needs` · `notSettled` · `settled` (`carrierGroups`); per row: file, page split, live requirements, open questions, duties not placed, last pull, last reading |
| Carrier's pages | `CarrierPages.tsx`, `PageRow.tsx` | pages under the parts the bulletin prints (`partGroups`); a part whose pages share one state says it once beside the range and its rows drop the badge (`PageRow` `showState`); call-outs: waiting pages (why + `pullCommand`), a stopped reading (`warn`: pages not read, the next pull reads them, `pullCommand`), a file never read (`pullCommand`) |
| Page | `PageScreen.tsx`, `PageImage.tsx`, `ReadingColumn.tsx`, `RequirementList.tsx`, `JudgedList.tsx`, `SetAside.tsx`, `QuotedWords.tsx` | image beside the reading at container width ≥ 720 px, else a thumbnail above it; Enlarge opens the house `Lightbox`; reading in order: requirements (quote, settled rule, open question + `QUESTIONS_COMMAND` as text), judged rules (unsettled first, confirmed last; a quote shows only when it adds words the rule lacks), duties not placed, refused entries, where the answer came from |
Shared: `BulletinsTrouble.tsx` (warn banner + Try again, `subject` `overview` · `pages` · `page`), `RefreshButton.tsx`, `StateBadge.tsx`, `CommandLine.tsx`.
Pure: `utils/bulletinModel.ts` (standing, groups, `PAGE_STATE_LOOK`, `VERDICT_LOOK`, `VERDICT_ORDER`, `partGroups`, `partOfPage`, `pageStateOf`, `neighbours`), `utils/bulletinWords.ts` (every sentence built from a row; `QUESTIONS_COMMAND`, `pullCommand`, `verdictParts`).

## `carrierStanding` — evaluated in this order
| standing | when | group | tone |
|---|---|---|---|
| `waiting` | `waiting > 0` | needs | `warn` |
| `settled` | `pages > 0 && settled === pages` (a later failed run does not unsettle it) | settled | `positive` |
| `stopped` | `last_reading.status === 'failed'` | needs | `warn` |
| `unread` | `settled + read === 0` | notSettled | `neutral` |
| `partly` | otherwise | notSettled | `info` |

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/carrier-bulletins/

## MAN-8929 — The Bulletins view — src/modules/carrier-bulletins: the three screens, the four — Rules an editor must not break
section: The Bulletins view — src/modules/carrier-bulletins: the three screens, the four reads, the presses, the rules/002 Rules an editor must not break

- Read-only: no press writes, and the lane's allowlist holds GET routes only. A rule changes only by answering `QUESTIONS_COMMAND` (`venv/bin/python scripts/carrier_rules_questions.py`) or on the Approval Rules page (operator, 2026-10-21). why: the view shows what Claude read; it is not the editor.
- Every word from a bulletin (quote, rule, heading, carrier, reason, doubt) is its own text node: never through `t()`, never `dangerouslySetInnerHTML` (none in the module; R-CERB-25, vendor-authored strings are an XSS source). Sentences are `cerberus.bulletins.*` keys, English only.
- Names, never ids: the screens draw carrier names, page numbers, the bulletin's printed number and the rules' own words. A bulletin id, a file's sha and a rule's id are keys the hooks use and nothing draws (INV-76).
- Tone reaches paint only as `data-tone` plus a tone name, with a glyph and a word beside it (MAN-739, MAN-578); act is `warn`, never `danger`.
- Reads on open and on a press, never on a timer, and none while a mounted view is hidden (its opening read alone can land hidden, when its chunk arrives after the person has gone back to Fleet). A new read in this view is a hook over `useLaneRead` keyed by what it reads, read by a press; a read that arrives of its own accord needs the view-shown gate Tours has.
- A failed read shows only its banner, on all three screens: `useLaneRead` keeps the old value beside a failed quiet read, and the screens never draw it under the banner.
- A carrier the engine could not plan has no row in the overview's bare array and is named only in `X-Left-Out`: `OverviewScreen` draws a warn banner naming each one and why, and holds back the calm "Every file is read and settled" headline while any is left out (INV-2673: never derive from an absence), and draws no "No carrier has a bulletin on file" sentence when every carrier is left out (that sentence is for no carrier left out). A header that is there and cannot be read still draws the banner, unnamed.
- A requirement's window is a deadline (`hours`, `basis`, `anchor`) and/or a cadence: a cadence-only requirement comes over as `{ "cadence": "daily" }` with no deadline key (15 live requirements at the time of writing), so `requirementFacts` reads each where it is present, skips the deadline line without a `basis`, and says "Recurs daily". Never read `window.basis` unguarded: it threw inside `RequirementList` and took the whole view to its boundary banner.
- A scope list a requirement names none for is EMPTY on the wire (`requirement_body` sends `[]`, never `null`) and means every one of its kind: `requirementFacts` draws no label for it, and "Every job" when none of the three is named.
- The page image keeps a letter-page box and `contain`s the picture. why: the wire gives no page size.
- Other modules reach it only through `index.ts` (`BulletinsView`, `lazy`); files inside import siblings by path.

## Open
- The wire carries three members the screens do not draw: `BulletinPage.waiting` (why each waiting page waits, without a read per page: the carrier's call-out says only "Open it to see why") and `beside` on a requirement and on a judged rule (the entry was read from the pages beside this one, so its quote stands on a neighbouring page and not on this page's picture, which the page screen shows as if it did). The mirror holds all three; drawing them is a design decision.
- `AffectedAreasTrouble` is the lane-neutral fault type under a Tours name; renaming it touches live Tours files.
- `PageReading` has no `width` / `height`; a landscape page draws inside the letter box until it does.
- On a fault screen the header's Refresh and the banner's Try again do the same read.
- Not proven whole on the final code: the empty-scope labels and the no-ids check (the probe has both; its last run did not reach them), the overview with every carrier left out, the probe's own page pick, member verdict and pages-list scroll leg, dark mode, and the waiting and stopped states against live data (no carrier waits today; the walk's reading of AAA of Southern California is in progress).

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/carrier-bulletins/

## MAN-8908 — The lane router — createLaneRouter, the allowlist both lanes to shadow-connector share (server/shared)

`server/shared/shadow-connector-lane-router.ts` is the allowlist router both lanes to shadow-connector hand their tables to: `createLaneRouter(definition)` returns an Express router that checks, forwards and answers. The forwarder beside it (`shadow-connector-lane.ts`, MAN-8863) owns the transport and the secret; this file owns what the two lanes' routes would otherwise each write the same way, so the rules below hold for both and cannot drift. Exported from `server/shared/index.ts`; listed in `.oxlintrc.json`'s `backend-shared-utils` pattern (INV-6548).

Consumers (each declares a table and its id shapes; neither writes a handler):

| module | lane | `lane` | image |
|---|---|---|---|
| `server/modules/affected-areas/` (MAN-8559) | `/api/affected-areas` | `affected-areas` | `image/jpeg` |
| `server/modules/carrier-bulletins/` | `/api/carrier-bulletins` | `carrier-bulletins` | `image/png` |

| export | does |
|---|---|
| `createLaneRouter({ lane, upstreamPrefix, pathRules, allowlist, forward, image, passHeaders? })` | one handler per allowlist row (check, fill the path, forward, answer), then the lane's own 404, then the malformed-escape 422. `image` is `{ contentType, noun, signature }` (`LaneImage`): the image type the lane's bytes routes answer unless a row names its own, how the 502 names it, and the magic number its bytes begin with (PNG `89504e470d0a1a0a`, JPEG `ffd8ff`). `passHeaders` names the upstream response headers a JSON answer carries back (none when absent) |
| `LaneRoute` | one row: `{ method, route, timeoutMs, expect: json\|bytes, query?, body: object\|none, image? }`; `route` is in Express's form, `:name` is filled from the checked id; `image` is a `bytes` row's OWN image type, which wins over the lane's |
| `LaneImage` | `{ contentType, noun, signature }`: the type of `createLaneRouter`'s `image` and of a row's `image` |
| `LaneRule` / `patternRule(regex, expects)` | a check on one id or query value; `expects` is the half of the 422 sentence after the field's name |
| `LOWERCASE_UUID_SOURCE`, `LOWERCASE_UUID_RULE`, `SHA256_RULE` | the id shapes the two lanes share: a lowercase hyphenated uuid, 64 lowercase hex |

Rules (they bind the file; a lane that needs different behaviour changes the definition, not a copy of the loop):
1. A method-and-path pair that is not a row never reaches shadow-connector: the lane answers its own 404 `{ error: 'not a route of the <lane> lane' }`, and the request is not handed to the app's catch-all. why: the table is the lane's whole contract.
2. Every path id and every allowlisted query value is held to its rule BEFORE a byte leaves; a `:name` with no rule in `pathRules` is refused, never forwarded. A failure is the lane's 422 `{ error: '<name> must be <expects>' }`. A query value that is an array or a dictionary (`?q=a&q=b`) is not a value. A query key not in the row is dropped, not forwarded. A `body: 'object'` row needs a JSON object (array, null and scalar are a 422).
3. A malformed percent-escape in the path (`%ZZ`) throws in Express before any handler runs; the router's last middleware turns it into a 422 and forwards nothing.
4. An upstream answer keeps its status and its JSON untouched, and carries back the response headers the lane named in `passHeaders` and no others. Only the lane's own faults carry a body of the lane's making, `{ error }`, and their statuses are fixed: `unreachable` 503, `unreadable` 502, `no_secret` 503. A fault the forwarder cannot name (an error thrown, not returned) is passed to `next(error)` and answered by the app's error handler, not by a body of the lane's own. why: turning a fault into a 200 with an empty body would replace the one useful thing in the answer, that nothing was read, with silence a screen shows as data; and a header the engine sets that a lane did not name (`Set-Cookie`, a `Location`) must not reach a browser by accident.
5. A `bytes` route is relayed only on a 2xx, under its row's `image` when it names one (the Tours lane's plan drawing: an SVG) and the lane's `image` otherwise, and `Cache-Control: private, max-age=31536000, immutable` (the id is the sha256 of the bytes, so it never changes). A 2xx whose Content-Type is not that type, or whose first bytes are not `image.signature`, is `unreadable` (502 `shadow-connector did not answer with <image.noun>`). why: the Content-Type is the engine's word, and the bytes are what a browser would keep for a year. A non-2xx image answer is the engine's JSON, passed through (the forwarder reads bytes only on success).
6. The acting user is read from `request.user.username` (the mount's `authenticateToken` set it) and sent as `X-Acting-User`, display only.
7. Routes here validate and translate and do nothing else: no secret read, no socket, no cache, no model call.

Traps
| trap | fact |
|---|---|
| a page number is a pattern, not a number | the bulletins lane's `page` is `^[1-9]\d{0,2}$`, the engine's own spelling: `3`, `03` and `+3` would be three URLs for one page image, cached for a year under its URL. The Tours lane's `limit` is a bounded number (`wholeNumber`, private to its routes) because nothing is cached under it |
| the 404 sentence names the lane | `lane` is the only word of it that differs; a new lane picks a distinct one so the journal and a screen can tell whose 404 it was |
| a new lane | adds a module with a table and a mount in `server/index.ts`, builds its forwarder with its own `label` (MAN-8863), and needs no change here unless it relays something other than JSON and images (a lane that serves more than one image type names the odd one on its row: `LaneRoute.image`) |

Moved here from the Tours routes on 2026-10-22 as a pure move: the Tours lane's bodies, statuses and headers for a tour read, an image, a bad id, a bad limit, a path outside the table, a malformed escape and an unknown tour were identical before and after (image sha256 `dd729923…` = its id), except the engine's own `builtAt` stamp.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/shadow-connector-lane-router.ts

## MAN-8909 — The carrier-bulletins lane — /api/carrier-bulletins forwarded to shadow-connector

`server/modules/carrier-bulletins/` is the second lane between the browser and shadow-connector's internal-caller gate (R-CAP-11: `X-Internal-Secret` required even from loopback), built on the Tours lane's pattern (MAN-8559). It relays the four GET routes of `/api/carrier-bulletins` — what Claude read of the SERVPRO bulletins and how the house settled it (the engine's side: MAN-8906, INV-9382) — and nothing else. Mounted in `server/index.ts` at `/api/carrier-bulletins` behind `authenticateToken`, beside the Tours lane. The browser never holds the secret; the Cerberus tab's Bulletins view (client wire: MAN-8865) is its caller.

**Why a lane.** The engine's surface demands the internal secret even from loopback, and a browser must not hold it. CloudCLI's server already authenticates the operator, so the lane is the one hop: it reads the secret from shadow-connector's own env file per call (the shared forwarder, MAN-8863) and forwards. The lane is read-only because the view is (the operator's ruling of 2026-10-21): a write verb would be a new row of the table and a new decision of the engine's surface, not an edit to a handler.

| File | Holds |
|---|---|
| `carrier-bulletins.module.ts` | `createCarrierBulletinsModule()`; the ONLY reader of the environment for this lane |
| `carrier-bulletins.routes.ts` | `createCarrierBulletinsRouter({ forward })`: the four-row table, the three id shapes, the image type; the shared router (MAN-8908) does the rest |
| `index.ts` | barrel the entrypoint imports |

## Configuration
| Variable | Default | Meaning |
|---|---|---|
| `SHADOW_CONNECTOR_URL` | `http://127.0.0.1:8001` | engine origin |
| `SHADOW_CONNECTOR_ENV_FILE` | `/opt/shadow-connector/.env` | file holding `EIS_INTERNAL_SECRET=` |

The forwarder is built with `label: 'carrier-bulletins'`, so its log warning reads `[carrier-bulletins] no usable internal secret in <file>: <cause>`.

## Allowlist (4 rows in `ALLOWLIST`, GET only)
A method+path not in the table is the lane's own 404 `{ error: 'not a route of the carrier-bulletins lane' }`; it never reaches :8001. No row takes a query or a body: a query on a request is dropped, not forwarded.

| Method path | Timeout | Reply |
|---|---|---|
| `GET /overview` | 60 s | json |
| `GET /bulletins/:bulletin/pages` | 30 s | json |
| `GET /bulletins/:bulletin/pages/:page` | 30 s | json |
| `GET /files/:sha/pages/:page/image` | 30 s | bytes (`image/png`) |

The overview has the longer timeout because it plans every carrier's current file, and a file nobody has opened is fingerprinted from its PDF on that first call.

## Checks before forwarding (a failure is the lane's 422 `{ error }`, nothing sent)
| Input | Rule |
|---|---|
| `:bulletin` | lowercase hyphenated uuid, `^[0-9a-f]{8}-…-[0-9a-f]{12}$` (`LOWERCASE_UUID_RULE`) |
| `:sha` | 64 lowercase hex (`SHA256_RULE`) |
| `:page` | `^[1-9]\d{0,2}$`: 1 to 999, no sign, no leading zero, no blank |
| malformed percent-escape in the path (`%ZZ`) | 422 `the path holds a malformed percent-escape` |

`:page` is a pattern and not a number with bounds on purpose, as the engine's `ids.py` holds it: `3`, `03` and `+3` would be three URLs for one page image, and the image is cached for a year under its URL.

## Status mapping and the image
An upstream answer — the overview, a page list, a page reading, and the engine's 404 `{ detail }` (no such bulletin, replaced by a newer file, no such page) or its 502 `{ detail }` (the stored file could not be fetched, is not the file named, or could not be opened) — passes through with its status and JSON untouched. The lane's own faults are `{ error }`: unreachable 503, unreadable 502, no secret 503 (MAN-8908 rules 4 and 5).

The image is relayed as bytes with `Content-Type: image/png` and `Cache-Control: private, max-age=31536000, immutable`, and only on a 2xx: it is keyed by the file's sha256 and the page, so the same URL always draws the same picture. A 2xx that is not a PNG is the lane's `unreadable` (502 `shadow-connector did not answer with a PNG`): the check reads the Content-Type AND the first eight bytes (`89504e470d0a1a0a`, `PNG_SIGNATURE`), because an error page stamped `image/png` would otherwise be cached for a year under the page's URL. The shared forwarder asks for a bytes answer with `Accept: image/*`, so the Tours lane's JPEGs and this lane's PNGs share one transport; each lane enforces its own type on the answer.

## Headers carried back (`PASSED_HEADERS`)
A JSON answer carries back two of the engine's response headers, and no other (the shared router's `passHeaders`, MAN-8908; a header travels only when a lane names it):

| header | why |
|---|---|
| `X-Left-Out` | a JSON array of `{carrier, reason}` naming a carrier whose current file could not be planned, so the overview's bare array leaves it out (MAN-8906). Absent when no carrier is left out. Without it a carrier vanishes from the overview with no mark on the wire |
| `Cache-Control` | the engine stamps `no-store, max-age=0` on every body and every error, because what Claude has read changes with every pull; the lane keeps it rather than answer with Express's `ETag` alone |

The reader of `X-Left-Out` is the Bulletins view, from the overview response (`response.headers.get('X-Left-Out')` on the `api.carrierBulletins.overview` answer). No view code reads it yet; that belongs to the view's phase. The image carries its own `Cache-Control` (above), set by the router, and a non-2xx image answer is the engine's JSON with the engine's `no-store`.

## Rules an editor must not break
1. **GET only.** No POST/PUT/DELETE row, no query or body forwarded. why: the engine's surface is read-only and decided as such (INV-9382); a write route re-opens that decision and the operator's ruling.
2. **An id is checked before a byte leaves.** why: a malformed id is a 422 here and never a request, a journal line or an object key at the engine.
3. **No model call, no timer, no cache.** The lane forwards per request; the view reads on open and on a press.
4. **The secret is not read here.** It stays in the forwarder (INV-8633).

## Probes (2026-10-22, through the dev API :3011 with the dev login)
- `GET /api/carrier-bulletins/overview` → 200, 12 carriers, byte-equal to the engine's own answer at that moment; Hanover's pages → 200, 6 pages.
- State Farm page 13 image → 200 `image/png`, `Cache-Control: private, max-age=31536000, immutable`, 239,612 B, `sha256sum` `8be40781…` equal to the same image fetched from :8001 with the secret.
- 422 for a malformed or uppercase bulletin id, page `03` / `0` / `1000` / `1x`, a 63-hex sha, `%ZZ`; 404 for `/nope`, the mount root, `POST /overview`, `PUT` a page, `DELETE /overview` and a Tours path on this mount; 401 with no token. `journalctl -u shadow-connector --since <then>` showed 0 `carrier-bulletins` lines for all of them, and one line for a valid control call placed after.
- One Tours image through the Tours lane before and after the `Accept` change: identical bytes (its sha256 equals its id).

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/carrier-bulletins/carrier-bulletins.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/carrier-bulletins/carrier-bulletins.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/carrier-bulletins/index.ts

## MAN-8917 — Shared by the Tours and Bulletins views — ViewBoundary (src/shared/ui) and useLaneRead (src/shared/hooks): where they live, who uses them

Two pieces the Tours view (`src/modules/affected-areas`, MAN-8575) and the Bulletins view (`src/modules/carrier-bulletins`, MAN-8880) both stand on, each moved to `src/shared` when its second feature module came, as the frontend module standard places a UI component or a hook two feature modules use. Both moves were pure: no behaviour changed, and Tours' words are the ones it said before.

| piece | where | who uses it | what it is |
|---|---|---|---|
| `ViewBoundary` | `src/shared/ui/ViewBoundary.tsx`, exported by the `@/shared/ui` barrel | the Cerberus tab's `KeptView` (`src/modules/cerberus/KeptView.tsx`), around `AffectedAreasView` and `BulletinsView` | a lazy view's own surround: a waiting ring while its chunk loads and, when the chunk cannot load or the view crashes while drawing, one warn banner in place of that view alone, so the failure never climbs to the app's tab-level boundary and replaces the whole Cerberus tab |
| `useLaneRead` | `src/shared/hooks/useLaneRead.ts` | the Tours hooks (`useTours`, `useTour`, `useCodebook`, `usePano`, `useQueue`, `useProving`) and the Bulletins hooks (`useOverview`, `useBulletinPages`, `usePageReading`) | one JSON read of a shadow-connector lane kept for its key: `{ value, trouble, retry }` plus `reload` (quiet, keeps the value) and `replace(value, forKey)` (writes an answer that came by another road under the key it is GIVEN, and drops every read begun before it); it reads when the key is set or `retry`/`reload` is called, never on a timer |

`useLaneRead` turns a fault into an `AffectedAreasTrouble` through `troubleOfResponse` and `troubleOfFailure` in `src/shared/utils.ts` (group "A LANE READ THAT BROUGHT NO ANSWER"); the Tours presses' `answerOfWrite` (`src/modules/affected-areas/utils/laneTrouble.ts`) reads a fault through the same two.

## `ViewBoundary` — the name and the words
- `<ViewBoundary view={label}>`: `view` is the name of the view it surrounds, as its tab names it ("Tours", "Bulletins"). The words are `viewBoundary.*` in `common.json`, each taking `{{view}}`: `loading` "Loading {{view}}…", `failed` "{{view}} could not be shown", `failedDetail` "The rest of Cerberus is not affected. Reloading the page usually brings {{view}} back.", `reload` "Reload the page". For Tours they read as they did before the move, which `.verify/bulletins-view.mjs` shows with each chunk refused.
- The banner offers a reload of the page, not a retry: a `lazy` import that failed stays failed until the page loads again, so a retry button would answer nothing.
- It imports `Banner`, `Button` and `Spinner` by their own files, not through the `@/shared/ui` barrel that exports it.
- It is not lazy: it must be there to catch the failure of the chunk it surrounds.

## Rules
- A fault that is a lane's (`no_secret`, `unreachable`, `unreadable`, `gone`, `failed`) is told by `troubleOfResponse` / `troubleOfFailure`; a module does not tell its own.
- `useLaneRead`'s `fetchFor` must be the same function on every render (a module-level one): it is in the effect's dependencies, so a new one each render would read again each render. A null key reads nothing.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useLaneRead.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/ViewBoundary.tsx

## MAN-8942 — The 360° view's model — src/modules/affected-areas/utils/sphereFaces.ts: which view is which cube face, and a pano's areas as outlines on the sphere

`utils/sphereFaces.ts` turns a pano's six flat views into the cube the kit's `SphereView` stitches, and its areas into outlines on that sphere. Pure: nothing fetches, holds state or draws. It computes no yaw or pitch: every `Region` carries `sphere` (`[yawDeg, pitchDeg]` per polygon vertex, derived by the engine from `polygon` in the view's own frame, `core/affected_areas/views/geometry.py`, frame INV-8528), and the browser draws it as sent. The piece it feeds: `SphereView` (props MAN-8943, rules and proof MAN-8944). Module map: MAN-8575.

## Exports
| export | does |
|---|---|
| `CUBE_OF` | `Record<Face, keyof CubeFaces>`: `ahead`→`front`, `right`→`right`, `behind`→`back`, `left`→`left`, `ceiling`→`top`, `floor`→`bottom`. Names only: the six photos are never resampled |
| `cubeFaces(views, photos)` | `CubeFaces \| null` from the views and their photo URLs by `sha256` (`useImageUrls`' object URLs). Null until all six faces have a non-empty URL. why: the adapter reads the face size off `left`, and a missing face is a hole in the sphere |
| `sphereShapes(views, layer, selectedId)` | `SphereShape[]`, every area of the views |
| `lookOf(view)` | `SphereLook` of a view: its own `yawDeg`, `pitchDeg`, `fovDeg` as the engine cut it |

## `sphereShapes` rules
- `polygon` is `region.sphere` as sent. `badgeAt` is the `sphere` vertex whose INDEX is that of the polygon vertex nearest the box's top-left corner (the corner the flat view puts its badge on); ties go to the earlier vertex. why: the sphere is known only at the vertices.
- `tone`, `edge`, `wash` come from `REGION_LOOK[regionState(region)]`, the table the flat view reads: tone by judgment, never by kind.
- Layer rule is the face's: on `standing` an area draws unless `standing === false`, or it is `selectedId`. why: an area chosen in the list is never judged unseen.
- An area is left off when `sphere` has fewer than three vertices or a different count from `polygon`.
- Order: box area, largest first, a stable sort (equal areas keep the views' and regions' order). why: later outlines draw over earlier, so a small area inside a large one stays pressable.

## The frame `CUBE_OF` rests on
Cubemap adapter's `textureCoordsToSphericalCoords` (`@photo-sphere-viewer/cubemap-adapter`): direction is (x ahead, y right, z DOWN), yaw = atan2(y, x), pitch = −asin(z).
- `front` is centred at yaw 0, pitch 0; yaw grows turning right, pitch up, as the engine's views have them (`yawDeg` 0, 90, 180, −90 for Ahead, Right, Behind, Left; `pitchDeg` +90 Ceiling, −90 Floor).
- `right`, `back`, `left` are centred at +90, 180, −90; they meet at ±45° and ±135°; a texture's x grows toward larger yaw.
- The adapter's default `top` and `bottom` are the Ceiling and Floor views turned 180° (its `top` has its upper edge toward the front; the engine's Ceiling looked up at from Ahead has it toward the back). `SphereView` always sets `flipTopBottom: true`, which turns them upright, so `top` is the Ceiling view as photographed, upper edge toward `back`, and `bottom` the Floor view, upper edge toward `front` (`CubeFaces`, `src/shared/types.ts`).
- Changing `CUBE_OF` or `flipTopBottom` turns the sphere's seams wrong with no error. Re-run `node .verify/sphere-view.mjs --only frame`.

## Measured 2026-10-22 (Clarence Tse's kitchen pano, `.verify/sphere-view.mjs`)
- Six face centres: the sphere matches the face's own photo upright at 0.2–1.2% difference, against 7–23% turned 180°.
- 12 cube edges and 7 oblique looks, at 390 and 1280 px: 0.3–1.2%, against 7–20% for a mirrored control.
- Five areas (two on Ahead, three on Floor): outline vertices within 0.6 px of the flat view's, badges within 1.5 px.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/utils/sphereFaces.ts

## MAN-8956 — The 360° pano — src/modules/affected-areas: PanoSphere, PanoAreas and the strip’s 360° tab: what each draws, the rules, `.verify/affected-areas-sphere.mjs`

`PanoScreen` with `shown === 'sphere'` draws `PanoSphere` as the figure and `PanoAreas` as the list column; a pano opens on 360° (`usePanoPlace.openPano`). The cube model: MAN-8942. The library piece: MAN-8943, rules MAN-8944. Module map, counts and place: MAN-8575.

## Pieces
| piece | does |
|---|---|
| `FaceStrip.tsx` | `Tabs` (underline): `sphere` first (`affectedAreas.sphere.tab`, count `panoCounts(views).areas`), then the six `FACES`. Accessible name `affectedAreas.pano.viewsLabel`. Scrolls sideways in its own box; the selected tab is brought in by `scrollLeft`, never `scrollIntoView` (it walks every scrollable ancestor) |
| `PanoSphere.tsx` | props `panoId`, `views`, `photos`, `room`, `panoRoom` (`PanoRoom`, `src/shared/types.ts`: the pano's `roomKey` and `floor`, built by `PanoScreen`), `layer`, `selectedRegionId`, `enlarged`, `codebook`, `reading`, `onLayer`, `onSelectRegion`, `look`, `onLook`, `onFullscreen`, `onMarkOn`, `onRetryPhotos`. Top to bottom: `LayerSwitch` in the photo's tool row; `SphereView` (`key={panoId}`, mounted only while its block is in layout, `useViewShown(blockRef)`); while an area is chosen `ChosenArea`; the caption with Enlarge (`onFullscreen(true)`, disabled while `faces === null`); the hint |
| `ChosenArea` (in `PanoSphere.tsx`) | `role="group"` `data-sphere-chosen`: the number as a `Badge` in the area's look, its kind (`effectiveClass ?? class`), its view's name, `placementNotes(region.placement, panoRoom, t)` on a line of its own under the kind ("Counted in {room}" when the plan credits the area to another room, "Seen in {n} photos" above 1; nothing before the plan has placed it; MAN-9038), and `Mark it on {view}` (`data-sphere-press="mark-on"`, `onMarkOn(face, regionId)`). Sends nothing |
| `PanoAreas.tsx` | props `views: ViewDetail[]`, `panoRoom` (handed on to each `RegionList`), `selectedRegionId`, `codebook`, `onSelectRegion`. The views in `FACES` order; a view with regions draws its name as `<h3>` over its `RegionList` (`headingId`). Under them: "Nothing found on …" (read, no regions) and "Not read yet: …". A view holding an area drawn by hand is listed read or not |
| photos | one record, `useImageUrls(panoViews shas, photoAttempt)` in the root: the sphere stitches all six and a shown view reads its own out of it, so opening a view costs no second read |

`PanoSphere` inputs: faces = `cubeFaces(views, photos)` (null until all six photos have arrived: the box is a skeleton); outlines = `sphereShapes` over the views that carry `regions` only, with `layer` and `selectedRegionId`.

## Troubles in `PanoSphere`
`trouble` is what `SphereView` reported (`onTrouble`), else `photo_failed` when any of the six photos is null.
| when | draws |
|---|---|
| `photo_failed` | warn `Banner`, `role="alert"`, Try again: lets go of the report and calls `onRetryPhotos` (the root bumps `photoAttempt`; the six are fetched again) |
| `no_webgl` | neutral `Banner`, `role="status"`, one sentence (`affectedAreas.sphere.noWebgl`) sending the person to the six views |
| either | the switch, Enlarge and the hint go; the chosen line stays, so `Mark it on` still reaches the presses |

## Rules
- `PanoAreas` is fed `detail.views` only, never the listing's entries; while `detail === null` the list column is `ReadingList`, and `PanoSphere` gets `reading={detail === null}` (a caller omitting it does not typecheck). why: the listing's views carry no regions, so a list or caption built from them reads "0 areas" over a pano that has areas.
- A row press turns the sphere (`selectedId` → `gotoMarker`); an outline or badge press chooses its row; pressing the chosen one lets go (`usePanoPlace.onSelectRegion` toggles).
- Choosing an area brings the sphere's block into view a frame later (`blockRef`, `scrollIntoView({ block: 'nearest' })`). why: on a phone the list stands below the sphere, and a row pressed there must not turn a sphere out of sight.
- Words never sit on the photo: the badge's number is its row's, and the view's name over each list tells two areas numbered 1 apart. Nothing on the sphere writes a row; marks are made on a view (MAN-8582).
- Showing 360° from a view sets `sphereLook = lookOf(view)`; a sphere shown again from under Fleet, Mark or Tables keeps the look `onLook` last reported. why: the sphere unmounts whenever its block is out of layout.


## Proof — `node .verify/affected-areas-sphere.mjs`
Prod client `:5184` (`scripts/prod-client-build.sh`), live engine, nothing stubbed, nothing written; exit 1 on any FAIL; shots in `.verify/shots/affected-areas-sphere/`.
| leg | holds |
|---|---|
| A, 1280 px | Cerberus → Tours → CLARENCE TSE → Kitchen opens on 360°; one outline and one badge per engine area, numbered as the rows; caption accounts for all views; a full turn; each row turns the sphere onto its outline; outline press chooses its row; Standing leaves the chosen outline; Mark it on Floor opens Floor with `MarkBar`; 360° pressed looks at the floor; Fleet and back leaves no canvas while hidden and returns to the same look; Living Room turns a full circle with a frame trace; no console error, no reload |
| B, 390 px touch | one-finger drag turns the sphere; Enlarge fills the screen; leaves by Escape (bounded 8 s), else the library's own button |
| C, iPhone user agent | the library's emulated fullscreen fills 390×844 at (0,0); its button leaves |
| D, built client | `index.html` preloads only `vendor-react`; `SphereCanvas-*.js` is reached by dynamic import only; the Tours chunk names no sphere chunk |

2026-10-22, build 20261022-184601: every line PASS, exit 0. Kitchen 5 outlines, 5 badges, caption `0 areas · 5 proposed · 6 of 6 views read`; full turn 508°; each of the 5 rows `yawOff 0`, `pitchOff 0`; Living Room 10 outlines, 805 frames over 22 849 ms, median 16.8 ms, max 150 ms, 0 dropped; iPhone emulation 390×844 at (0,0). On build 20261022-185738 the chunk wiring alone was re-read: 1 modulepreload, 0 sphere and 0 `THREE.` references in the Tours chunk.

## Open
- The walk has not been re-run since `sphere/fixedContaining.ts` was cut out of `SphereCanvas.tsx` (a pure move) or since the fix-pass (`reading` caption, `viewsLabel`, `ReadingList` in the 360° column while the detail is read): static gates only.
- Escape does not leave fullscreen in headless Chromium (MAN-8944, limits).

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/FaceStrip.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/hooks/useImageUrl.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/hooks/usePanoPlace.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/PanoAreas.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/PanoSphere.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/affected-areas-sphere.mjs

## MAN-8999 — command palette — the Navigate group: the views list `useWorkspaceViews`, `PaletteNavRow` and the Settings row

The palette's `Navigate` group is the workspace's views list, one `Go to <label>` row per view, then a `Go to Settings` row. A view added to the list is a palette row with no second edit. The list is also the views rail's (`WorkspaceRail`, MAN-9005): the rail draws these views in this order, and the palette lists them by name.

## Pieces

| piece | where | fact |
|---|---|---|
| `useWorkspaceViews()` | `src/modules/project-workspace/hooks/useWorkspaceViews.ts` | returns `{ views: WorkspaceView[], shouldShowShellTab, shouldShowTasksTab, preferencesSettled }`. Readers: `ProjectCommandPalette` (the rows) and `WorkspaceMain` (the pane gates and the two snap-backs) |
| `WorkspaceView` | `src/shared/types.ts` | `{ id: AppTab, label, group: WorkspaceViewGroup, icon: ComponentType \| null, keywords }`. `label` = `t('tabs.<id>')`; a count never rides here, so a reader does not re-render when a badge moves |
| `WorkspaceViewGroup` | `src/shared/types.ts` | `'chat' \| 'tools' \| 'plans' \| 'house' \| 'plugins' \| 'foot'` — the run a view belongs to |
| `PaletteNavRow` | `src/shared/types.ts` | `{ key, label, keywords, run }` — `key` is the React key, `label` the name after "Go to" |
| `navRows` | `ProjectCommandPalette.tsx` | `useMemo` over `[views, t, setActiveTab, openSettings]`: each view → `{ key: view.id, label, keywords, run: () => setActiveTab(view.id) }`, then the Settings row |
| `navRows` prop | `CommandPalette.tsx` | draws `Go to ${row.label}`; the row's cmdk `value` is `Go to ${label} ${keywords}`. The palette holds no list of views and no `activeTab` |
| Settings row | `ProjectCommandPalette.tsx` | `{ key: 'settings', label: t('rail.settings'), keywords: 'open settings preferences', run: () => openSettings() }`. `rail.settings` = `Settings` (`en/common.json`) |

## Order

| run (`group`) | views in order | gate |
|---|---|---|
| `chat` | `chat` | none |
| `tools` | `files`, `git`, `browser`, then `shell`, then `tasks` | `shell` iff `!hideShellTab` (default `true`, `src/shared/uiPreferences.ts`); `tasks` iff `tasksEnabled && isTaskMasterInstalled`. A gated view joins at the END of the run |
| `plans` | `runner` (label Roadmap), `kanban`, `schedules`, `notes` | none |
| `house` | `universe`, `cerberus`, `api` | none |
| `plugins` | `plugin:<name>` for each enabled plugin | `icon: null`, `label` = the plugin's `displayName`, keywords `plugin <name>` |
| after the list | the Settings row | none |

- `browser` is ungated: with the feature off the pane draws "Browser is disabled" and a door into its Settings tab. `WorkspaceMain` has no snap-back for it.
- `WorkspaceMain` keeps two snap-backs to `chat`, tasks and shell, each waiting on `preferencesSettled`. The `browser` and `runner` panes mount on `activeTab === '<id>'` alone.
- `views` is memoised on `[shouldShowShellTab, shouldShowTasksTab, plugins, t]`; `t` stands in for the language.
- Keywords live in the hook's constants (`CHAT_VIEW`, `OPEN_TOOL_VIEWS`, `SHELL_VIEW`, `TASKS_VIEW`, `PLAN_VIEWS`, `HOUSE_VIEWS`) beside each view's glyph.

## Not in the list

- Memory and Heal are sections of the Inbox (`inbox` is the rail's foot view); the list carries one row for them, `Go to Inbox`, and no `Go to Memory` or `Go to Heal`. A stored `activeTab` of `memory` or `heal` reads back as `inbox` (`readPersistedTab`).
- `Actions` holds `Start new chat` and `Toggle theme` only. `Open settings` is the Settings row under `Navigate`; `Settings: <tab>` rows stay in the `Settings` group.
- `ProjectCommandState` (`ProjectsStateContext.tsx`) carries `selectedProject`, `handleNewSession`, `openSettings`, `setActiveTab` and no `activeTab`, so the palette does not re-render on a tab switch.

## Rules

| rule | why |
|---|---|
| Add a view in `useWorkspaceViews.ts` only; never a second list in the palette | one list is the palette's and the pane gates' truth |
| The Settings row's keywords start `open settings preferences` | the typed phrase `open settings` must match as one string; `settings preferences open` did not, and the search ran `Go to API` |

## Proof

`node .verify/palette-navigate-views.mjs` (gitignored; live app on `:5183`, `openConsole` from `.verify/lib/console.mjs`, 1440×900; `npm run typecheck` and `npm run lint` exit 0). Writes nothing to the account.

2026-10-25 reading, an account with `hideShellTab: true` and Tasks off:

| check | read |
|---|---|
| Navigate rows | Chat, Files, Git, Browser, Roadmap, Kanban, Schedules, Notes, Universe, Cerberus, API, Settings |
| Actions rows | Start new chat, Toggle theme |
| Shell and Tasks gates pinned on for one page | `Files, Git, Browser, Shell, Tasks, Roadmap …` |
| `Go to Browser` | lands on the Browser pane, `activeTab` stays `browser`; with the feature stubbed off, "Browser is disabled"; no snap-back after a reload and a project pick |
| `Go to Settings` | opens the Settings modal |

The script reads `hideShellTab ?? true` from the account, the app's own default.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/command-palette/CommandPalette.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useWorkspaceViews.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/ProjectCommandPalette.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/palette-navigate-views.mjs

## MAN-9002 — The workspace with no project selected — which panes draw, the choose-a-project body, the phone header's name, and probe-house-views-no-project.mjs

`WorkspaceMain` renders for every selection state: no early return on `!selectedProject`, and `WorkspaceHeader` always draws. Nothing in the rail is project-scoped, so the house views need no project. Landing rules: MAN-7531, MAN-7748.

## Which pane draws with no project

| view | pane with `selectedProject === null` |
| --- | --- |
| Chat, Shell, Tasks, a plugin's view | the choose-a-project body (`WorkspaceStateView mode="empty" showHeader={false}`), built once in `WorkspaceMain` as `chooseProjectBody`. Tasks draws it only while `activeTab === 'tasks'` |
| Files, Git | the pane itself, on its own roots (the git repositories, and for Files the operator's pins). Neither reads the open project |
| Roadmap (`runner`), Kanban, Browser, API, Cerberus, Notes and the other house views | the pane itself. Kanban gets `projectId={selectedProject?.projectId ?? null}` (MAN-589) |

- `useRunnerLanding({ activeTab, setActiveTab })` takes no project. Roadmap comes forward as soon as a name is held (MAN-7531 rule 1).

## `WorkspaceStateView` props

| prop | value | draws |
| --- | --- | --- |
| `mode` | `'loading'` | the loading screen, as the whole screen while projects load |
| `mode` | `'empty'` | the choose-a-project body ("Choose Your Project") |
| `showHeader` | default `true`; `false` | `true`: the phone's menu row above the body. `false`: the body alone. why: a pane under `WorkspaceMain`'s own header would stack two menu rows |

## Phone header (`WorkspaceHeader`, mobile only; desktop renders nothing)

`viewLabel` is `null` on Chat, else the active view's `label` from `useWorkspaceViews().views` (`WorkspaceMain` computes it).

| screen | title | provider logo | project line |
| --- | --- | --- | --- |
| Chat | the open chat's title, or `newSessionLabel` with no session | with a session | with a project selected |
| a view in the views list | its rail name (`Roadmap`, `Files`, `Notes`) | none | none |
| an id the list lacks (a plugin whose list is loading or gone) | the chat's face: `viewLabel` is `null` | as Chat | as Chat |

## `.verify/probe-house-views-no-project.mjs`

`node .verify/probe-house-views-no-project.mjs` on the dev client `:5183`, signed in as the `verve` dev account, tree list pinned (`simpleChatList: false`, `lib/prefs-pin.mjs`), writes dropped. gitignored.

| scenario | holds |
| --- | --- |
| desktop `/`, each view persisted, reload | Kanban, Roadmap, API and Files panes drawn (Files: its strip of roots); Chat shows the choose-a-project body; Kanban's `data-project-id` absent |
| desktop `/` then a press on each of those views | the pane opens; a press on Files draws its strip of roots |
| desktop `/?runner=<plan on the lane>` | Roadmap selected on In flight, `runner` gone from `location.search` |
| phone 390×844, `/`, Files persisted | header reads "Files", ONE menu button on the page, the strip of roots drawn |
| phone, a real chat | header = chat title + project name |
| phone, Roadmap pressed through the drawer | header reads "Roadmap", no project line |

- The probe finds the views as rail buttons (`railButton(label)` from `lib/console.mjs`; the phone's Roadmap press opens the drawer through `openDrawer` first). 2026-10-25: every leg passes, exit 0.
- A run can die on another phase's file edited mid-run (a Vite 500, then a provider error from hot reload). Rerun.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/WorkspaceHeader.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/WorkspaceStateView.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-house-views-no-project.mjs

## MAN-9005 — The views rail, composed — `WorkspaceRail`, `RailButton`, the focus tooltip, the edge lines and the live rail probe

`WorkspaceRail` is the views rail, live beside the chat list. `ProjectSidebarRegion` renders it into the sidebar's `rail` slot (`const renderRail = useCallback((list) => <WorkspaceRail list={list} isMobile={isMobile} />, [isMobile])`); `Sidebar` draws `<div className="flex h-full">{rail({ collapsed: isSidebarCollapsed, expand })}{!isSidebarCollapsed && <SidebarContent …/>}</div>`: collapsing hides the list column only, so the rail stands alone at 48px and nothing in it remounts (the switcher's dock and the account panel keep their place). `expand` is one identity across renders (`setSidebarVisible` is a `useCallback`). While the list is collapsed the rail hands the dock `pressOverride` "Show the chat list" (`rail.showList`), memoised on `list.collapsed` and `list.expand`; a press on the seated disc brings the list back, and with the disc dragged out the dock draws its own button with the same name and act (MAN-486). A 48px rail and the list's `md:w-[17.5rem]` make the docked sidebar's 20.5rem, so the main region does not move; on a phone the list is `min-w-0 flex-1` and fills what the rail leaves. The list's root carries the one hairline between the two (`border-l border-border/50`). The rail is the one place that switches `activeTab` by hand; the list column carries no tab row and no Settings button, and the list header's hide button is named "Hide the chat list" (`tooltips.hideList`, `aria-label` and `title`).

## Pieces

| piece | where | fact |
|---|---|---|
| `WorkspaceRail({ list, isMobile })` | `src/modules/project-workspace/WorkspaceRail.tsx`, default export | `<nav aria-label={t('rail.label')}>` ("Views"), `relative z-50 w-12 bg-background` (above the application layer, z-40, so the account panel it opens stands over an open application with the list collapsed), top padding `pt-2`, bottom `pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]`. Top to bottom: disc cell, scroll region, foot |
| `RailButton({ label, viewId, icon, lit, badge, onPress })` | `src/modules/project-workspace/RailButton.tsx`, default export | one view's button; `icon` null (a plugin view) draws a `size-6` disc holding the label's first letter, uppercased |
| `RailBadge` | `src/shared/types.ts` | `{ count: number, words: string }`: `count` above zero (a zero is no badge), `words` the sentence read through `aria-describedby`. `useRailBadges` builds exactly this shape |
| `useRailBadges()` | `src/modules/project-workspace/hooks/useRailBadges.ts` | `Partial<Record<AppTab, RailBadge>>`: Cerberus = `useCerberusNeeds()` (`rail.badge.cerberus`, plural), Inbox = `useInboxWaiting().total` (read through the inbox barrel; `rail.badge.inbox`), Chat = the figure 1 while `useChatHost().unread` (`rail.badge.chat`). A zero has no entry. The views list carries no count, so a reader of it does not re-render when one moves |
| `SidebarListState` | `src/shared/types.ts` | `{ collapsed: boolean, expand: () => void }`: the sidebar owns the collapse, the rail only reads it |
| `Tooltip` prop `showOnFocus` | `src/shared/ui/Tooltip.tsx` | default `false`: MAN-9015 |
| `accent-soft`, `accent-soft-hover` | `tailwind.config.js` | colour names over `--accent-soft`, `--accent-soft-hover` (MAN-739 rule 3) |
| `rail.label`, `rail.showList`, `rail.badge.*` | `src/modules/i18n/locales/en/common.json` | "Views"; "Show the chat list" (the collapse phase's press override); the badge sentences. `rail.settings` belongs to MAN-8999 |

## Layout

| part | fact |
|---|---|
| disc cell | `size-11 md:size-10` (44px phone, 40px desktop) holding `<AppSwitcherDock />`: its 28px box is centred at (24, 28) on a desktop and the app switcher's FAB is drawn over it. While the disc is seated here it draws no dot (see MAN-486): the Chat glyph's badge says a reply landed |
| scroll region | the runs of `SCROLL_GROUPS` in order: `chat`, `tools`, `plans`, `house`, `plugins`. A run with no view is dropped first; a `RailHairline` (`h-px w-6 bg-border`, `aria-hidden`, `my-1`) stands between two drawn runs |
| foot | outside the scroll, `relative z-40`: the usage rings (`UsageRings` from the accounts barrel: the 5-hour over the week, each labelled with its countdown to reset, 28px rings in 32px cells, a status and no button; MAN-9033), the views whose `group` is `foot` (Inbox: MAN-9013), the Settings button (`t('rail.settings')`, running `sidebarSharedProps.onShowSettings()`), then the account cell |

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useRailBadges.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/RailButton.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/WorkspaceRail.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Tooltip.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/rail-mockup.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/rail-read.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/sheet.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/rail-live.mjs

## MAN-9006 — The views rail, composed — `WorkspaceRail`, `RailButton`, the focus tooltip, the — `RailButton`
section: The views rail, composed — `WorkspaceRail`, `RailButton`, the focus tooltip, the edge lines and the live rail probe/001 `RailButton`

| aspect | fact |
|---|---|
| size | `size-11` below md (touch floor), `md:size-10`; glyph `size-5`, stroke 1.75 |
| name | `aria-label={label}` and nothing else; no native `title`. why: a `title` stacks a second tooltip on the kit's |
| lit | `aria-current="page"`; `RAIL_BUTTON_LIT` (`src/shared/constants.ts`): `bg-accent-soft text-accent-ink hover:bg-accent-soft-hover`; a `before:` bar 2×20px on the rail's own left edge: `-left-0.5` on a phone (44px button in 48px), `md:-left-1` (40px in 48px). `forced-colors:before:bg-[Highlight]`: forced colours flatten ground and bar to the canvas and leave the lit view unmarked. The companion module's door (`CompanionDoorView`) lights with the same constant while her panel is open, its state `aria-expanded` |
| unlit | `RAIL_BUTTON_UNLIT` (`src/shared/constants.ts`): `text-muted-foreground hover:bg-secondary hover:text-foreground` |
| badge | `data-tone="warn"` with `bg-tone-dot border-tone-ink`, `h-4 min-w-4`, `text-[10.5px] leading-normal`. Figure `aria-hidden`, `99+` past 99; the sentence sits in an `sr-only` span (`useId()`) named by `aria-describedby`. Box at `right-[calc(50%-20px)] top-[calc(50%-18px)]`: a wider figure grows leftward over the glyph and stays inside the rail. Fill is 2.07:1 on the rail's ground, so the edge and the figure carry it |
| badge ring | `ring-2` in the button's own ground: lit `ring-accent-soft`, hover `ring-accent-soft-hover`; unlit `ring-background`, hover `ring-secondary` |
| focus | token ring, `focus-visible:z-10`; `max-md:focus-visible:outline-offset-0`. why: at the house's 2px offset a 44px button's ring is 52px wide in a 48px rail, clipped by the region |
| plugin disc | unlit, `group-hover/rail-button:bg-background`. why: the hovered square turns `--surface2`, the disc's own colour |

## Focus tooltip

- The button is wrapped in `<Tooltip position="right" showOnFocus content={label}>`; what `showOnFocus` does: MAN-9015.
- 2026-10-25: Tab onto Chat shows "Chat" 21–33ms after the key.

## Scroll region and edge lines

- Region: `scrollbar-hide mt-1 w-full flex-1 min-h-0 scroll-py-1.5 overflow-y-auto overflow-x-hidden overscroll-contain`, no padding. Full width, because a scroller clips at its own box and the bar, badges and rings reach the rail's edges. `.scrollbar-hide` (`src/index.css`): 48px has no room for a scrollbar; wheel, swipe and keyboard still scroll.
- Without a scrollbar the edges say where runs are hidden. Each edge is a pair: a sticky line, and a cover in the flow at the runs' end that lies on the line once that end is in view.

| edge | line | cover |
|---|---|---|
| top | `sticky top-0 z-20 h-px w-full bg-border` | `relative z-30 -mt-px h-px w-full bg-background` holding a centred `RailHairline`: it draws the hairline under the disc |
| bottom | `sticky bottom-0 z-20 mt-1 h-px w-full bg-border` | `relative z-30 -mt-px h-px w-full bg-background` |

- At rest neither line draws. On the first pixel of scroll the 24px hairline widens to the full width on the same row.
- z-index inside the nav's own stacking context: focused button 10, edge lines 20, covers 30, foot 40. The nav is `z-50`: above the application layer (`z-40`), below the FAB (`z-60`). The account panel opens inside the foot, so it stands above the list and above an open application.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useRailBadges.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/RailButton.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/WorkspaceRail.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Tooltip.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/rail-mockup.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/rail-read.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/sheet.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/rail-live.mjs

## MAN-9007 — The views rail, composed — `WorkspaceRail`, `RailButton`, the focus tooltip, the — Rules
section: The views rail, composed — `WorkspaceRail`, `RailButton`, the focus tooltip, the edge lines and the live rail probe/002 Rules

1. The two edge pairs, the region's `mt-1` and its empty padding are the composition; the fill leaves them. why: the hairline under the disc is the top cover's, and padding would draw it twice.
2. No fade at an edge. why: it washes the rings and glyphs of the buttons it crosses.
3. The reveal is an effect on `activeTab` and on the lit button first appearing (a persisted plugin view lands with the plugin list), run in a `requestAnimationFrame`: `scrollIntoView({ block: 'nearest' })` on the region's `[aria-current="page"]` button, whatever moved the view (the rail, the palette); `scroll-py-1.5` keeps its ring 6px clear of the edge. why a frame later: a dialog closing on the same commit (the palette's "Go to") returns focus to the rail button that held it, and focusing it scrolls the region back to it; the reveal must come after that.
4. The foot stays above both edges. why: a phone's focus ring sits on the button's edge, and the bottom line would cross it.
5. An edge line says runs are hidden, not that one needs you: a badge on a hidden run shows no sign. The Chat badge is the exception, because while the disc is seated it is the only sign of a waiting reply: while a reply waits, the rail watches the Chat button (`data-view-id="chat"`) with an IntersectionObserver rooted at the region, and when it is not whole in the region (under 90%) the rail tells the dock (`unreadBadgeHidden`) and the seated disc draws its dot (MAN-486).
6. A file created under `src/` draws unstyled on `:5183` until `touch src/index.css` (INV-6586).

## Readings

`WorkspaceRail` reads `useProjectSidebarState()` (`activeTab`, `setActiveTab`, `setSidebarOpen`, `sidebarSharedProps.onShowSettings`), `useWorkspaceViews().views` and `useRailBadges()`. A view press is `setActiveTab(id)` and, on a phone (`isMobile`), `setSidebarOpen(false)` too: the drawer covers the view chosen.

## Proof

The collapse walk is `node .verify/rail-collapse-live.mjs` (MAN-486); the whole of the rail, palette, account panel, Inbox, Files and no-project views in one run is `node .verify/whole-sidebar-rail.mjs` (MAN-9012). `node .verify/rail-live.mjs` (gitignored; live client `:5183`; `ONLY=dark` for one theme) drives the rail in the sidebar through `openConsole`, at 1440×900 with the list shown and at 390×844 with the drawer open. It prints the nav's buttons in order with the names and descriptions Chrome computes, the lit one's `aria-current`, the computed colours of its bar and of a badge against the tokens, the Cerberus badge beside the Cerberus view's own headline and the Inbox badge beside the Inbox's three sections, a keyboard Tab bringing up a tooltip, a press on a rail view landing on it, and the Chat badge reading 1 with the docked disc dotless after one Haiku turn in a scratch chat whose reply lands while Files is showing (with the control: dragged out, the disc draws its dot). It then sets each layout beside the mockup's. The scratch chat is deleted at the end, and preference writes are dropped once the theme is set (`pinPreferences` with `writes: 'drop'`), so the collapse/expand pair leaves `sidebarVisible` as it found it. Every press goes through the rail's buttons; the 390×844 leg's second press is Kanban.

| file | exports |
|---|---|
| `.verify/lib/rail-read.mjs` | `RAIL` (`nav[aria-label="Views"]`), `readRail`, `railAccessibility`, `visibleTooltips`, `railTokens` |
| `.verify/lib/sheet.mjs` | `writeSheet` |
| `.verify/lib/rail-mockup.mjs` | `MOCKUP_URL` (`/home/lyphe/.claude/state/mockups/sidebar-rail.html`), `shootMockup` |

2026-10-25: `PASS — 51 ok, 0 skipped, 0 failed` in both themes. INV-5768's probe, `node .verify/probe-settings-rows.mjs after`, reads `pane kept=true` on all eight legs with the rail in place (2026-10-26); its verdict line reads `settings-rows=fail` for the Agents rows in which a "Saved …" badge sits below its label at phone widths (320px and 360px, and 390px at 1.072×; SettingRow, MAN-7425), not for the rail or the resize section. No standing leg runs a window short enough for the region to scroll.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useRailBadges.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/RailButton.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/WorkspaceRail.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Tooltip.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/rail-mockup.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/rail-read.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/sheet.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/rail-live.mjs

## MAN-9011 — The chat list column after the rail swap — no tab rows, Settings or account in it; `onCloseDrawer`, the hide and close names, the footer banners, stored `memory`/`heal` ids, and `swap-live.mjs`

The sidebar's list column (`SidebarContent`) holds the wordmark header, the body and the footer, and nothing the views rail owns. Rail: MAN-9005. Views list: MAN-8999. One tree across 768px: INV-5768.

## What the list holds
| part | fact |
|---|---|
| tab rows | none. `Sidebar` and `SidebarContent` take no `tabs` prop; `SidebarHeader` imports no `useCompactSidebar` |
| Settings button | none in the list. The rail's foot Settings button runs `sidebarSharedProps.onShowSettings()` (MAN-9005); `Sidebar` and `SidebarContent` take no `onShowSettings`; `actions.settings` is in no `sidebar.json` |
| account row | none in the list; the rail's foot holds the account cell |
| footer (`SidebarFooter`) | the restart-required banner, `ClaudeUpdateFooterRow` (MAN-7404), the update-available banner. Empty (0px) when none shows |

## Names and the mobile row
| piece | fact |
|---|---|
| desktop hide button | `onCollapseSidebar`; `tooltips.hideList` = "Hide the chat list" as `aria-label` and `title` (`sidebar.json`, all eleven locales) |
| mobile header row | create project (`tooltips.createProject`), refresh (`tooltips.refresh`), then close (`tooltips.closeDrawer` = "Close the drawer", `PanelLeftClose`), left to right, each with an `aria-label` |
| close press | runs `onCloseDrawer`: `ProjectSidebarRegion`'s `closeDrawer` = `setSidebarOpen(false)`, threaded `Sidebar` → `SidebarContent` → `SidebarHeader`. Optional: absent where the sidebar is not a drawer. The scrim (`handleBackdropClick`) closes it too |
| `ProjectSidebarRegion` | one return (INV-5768); passes `rail={renderRail}` and `onCloseDrawer={closeDrawer}` to `Sidebar` |

## Stored view ids
- `AppTab` and `VALID_TABS` hold no `memory` and no `heal`; `WorkspaceMain` mounts no Memory or Heal pane. Both are sections of the Inbox (`InboxPanel`, MAN-9013).
- `readPersistedTab` (`useProjectsState.ts`) maps a stored `jev` to `api` and a stored `memory` or `heal` to `inbox`; the stored value is rewritten to `inbox`.

## Proof — `node .verify/swap-live.mjs`
Gitignored; dev client `:5183`; `ONLY=dark` for dark; `openConsole` from `.verify/lib/console.mjs`; preference writes dropped, nothing written to the account.

| section | reads |
|---|---|
| 1. 1440×900, list shown | list tablists, tabs, Settings buttons, account buttons all 0; foot 0px; hide button named "Hide the chat list"; rail holds one Settings and one account button and no Memory or Heal button |
| 2. 1440×900, list collapsed | rail alone at 48px, Settings and account still in it |
| 3. 390×844, drawer open | header buttons in order create, refresh, "Close the drawer"; the close press and the scrim each put the drawer away |
| 4. stored `heal`, then `memory` | each reload lands on the Inbox (lit button, pane) and `localStorage.activeTab` reads `inbox` |

2026-10-25 light: 17 ok, 0 skipped, 0 failed.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/ProjectSidebarRegion.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarFooter.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarHeader.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/swap-live.mjs

## MAN-9012 — The whole walk of the sidebar rail — `.verify/whole-sidebar-rail.mjs`: legs, env, exit codes, what each leg reads

`node .verify/whole-sidebar-rail.mjs` walks the rail, the palette's Navigate rows, the account panel, the Inbox, Files' roots and the no-project views once, on the dev client `:5183` and the dev API `:3011`. Gitignored. Rail: MAN-9005. List column: MAN-9011. No-project views: MAN-9002.

## Run
| env | does |
|---|---|
| (none) | light; all four legs |
| `ONLY=dark` | dark |
| `LEGS=main,inbox,files,none` | only those legs. A key naming no leg, or an empty `LEGS=`, prints `LEGS names no leg called …; the legs are main, inbox, files, none` and exits 2 |

- Exit 0 = `PASS`; exit 1 = failed readings counted; exit 2 = bad `LEGS`.
- Four browsers in turn, one per subject that needs a world of its own. A leg that throws is reported as a failed reading, and the other legs still run.
- 2026-10-26 light: 109 ok, 0 skipped, 0 failed. 2026-10-25 dark, main leg: 72 ok.
- Screenshots: `.verify/shots/whole-sidebar-rail-<name>-<light|dark>.png`; each layout stands beside the mockup's in `…-sheet-light.png`.
- Composed from the phases' own probes (same selectors, same readings): `rail-live`, `rail-collapse-live`, `account-rail-live`, `probe-inbox`, `probe-files-roots`, `probe-house-views-no-project`, `palette-navigate-views`, `swap-live`. They stay for a single-subject re-run.

## Legs
| `LEGS` key | world | reads |
|---|---|---|
| `main` | dev account, preference writes dropped; 1440×900 then 390×844 | rail buttons in order with accessible names beside the palette's Navigate rows (13 rows, 13 buttons, plus the account button, which has no row; Settings last); the lit glyph's bar and a badge's computed colours; a keyboard Tab bringing up a tooltip; Cerberus and Inbox badges beside their views' own counts; Go to Inbox / Browser / Settings from the palette; list collapsed (same rail node, 48px) and the seated disc "Show the chat list" bringing it back; account panel beside the rail inside the viewport, Escape returning focus to the avatar, one `[data-account-trigger]` and one usage poller across collapse and expand; stored `heal` / `memory` landing on the Inbox; drawer and header name on the phone; Chat badge after one short Haiku turn in a scratch chat |
| `inbox` | `lib/ask-lane.mjs` fixture lane | the three sections add up to the rail badge and each equals its own panel's count; an Answer lands on its card in the Roadmap view's In flight face |
| `files` | writes reach the account, one pin each way | the four git roots hold still across a chat switch; a pin made on one page shows on a second page after reload; a second pin made there leaves the first; both taken off again |
| `none` | tree list pinned, reload at `/` | Kanban, Roadmap, Inbox and Files open with nothing selected; Chat shows "Choose Your Project"; the phone header reads "Files", "Roadmap" or "Kanban" on those views and the chat's title on Chat |

## Rules the walk keeps
- Heal figure: the Inbox strip's Heal figure is compared with the SUM of the "N live" badges on the Heal panel's "Friction by kind" rows, retried four times like the other badge checks. The "Friction" pill at the panel's head is `live_since_last_heal`, another cut: printed, never compared. 2026-10-25: strip 429 = sum over 22 kind rows; pill 172.
- Pins: `clearFilesPins(token)` patches `{ filesPins: { pinned: { <path>: null } } }` through the API (the shape `unpinFolder` sends), using `devToken()`. It runs before the Files leg (a dead run's pin never fails "none pinned"), in the `finally` after the Unpin click-through, and on SIGINT before `exit(130)`. The last reading is "stored filesPins left standing after Unpin: `[]`".
- Scratch chat: `lib/scratch-chat.mjs` (MAN-7452) in `lib/probe-project.mjs`'s project under `/tmp`; deleted at the end.

## Known refusals
- A fresh scratch chat has a row and no transcript file until its first turn: `GET /api/providers/sessions/<id>/token-usage` answers 404 `SESSION_FILE_NOT_FOUND` and the browser logs a console error. The walk names that exact refusal by chat id and fails on any other.
- Aborted fetches from the script's own navigation (`Failed to fetch`, `net::ERR_ABORTED`) are counted, not failed.

## Not covered
- Files' Edit-card and git-row opens: `probe-files-roots.mjs`.
- The file is ~1,000 lines, over the 800 ceiling; one script by request, outside `src/`. Splitting it by leg into `lib/` is a follow-up.

## Trap: probes that still find views by the deleted strip
- 62 files under `.verify/` (25 in `cfep-scratch/`) carry `[role="tab"][aria-label="Roadmap"|"Runner"|"Kanban"|…]`, the old workspace strip; no view is a strip tab, the views are rail buttons (`railButton(label)` in `lib/console.mjs`; on a phone `openDrawer` from `lib/layout-nav.mjs` first). They fail on their first view press. Repointed: `rail-live.mjs`, `probe-house-views-no-project.mjs`, `lib/native-scroll-surfaces.mjs`, `lib/scratch-chat.mjs`.
- The Inbox's own Memory / Heal strip (`[data-inbox-panel] [role="tab"]`) is real; those selectors are right.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/whole-sidebar-rail.mjs

## MAN-9038 — The day-one sketch section — src/modules/affected-areas: DayOneSketch, DayOnePlan, DayOneRooms, DayOnePress, useDayOne, useLayoutPlan, useLayoutWalk, utils/dayOneModel.ts, dayOne-fake.ts and their probes

Wired 2026-10-26. `TourScreen.tsx` mounts `DayOneSketch` between `TourRooms` and the panos, keyed `day-one-<tourId>` (the card above is keyed by the tour too, and siblings may not share a key). The section's data is `useDayOne` (below), called once at the view root and handed down as one `DayOneSection`; the verbs that open a pano (`onOpenPanoAt`, `onOpenPano`) are the root's. The section itself stays presentational.

| file | holds |
|---|---|
| `DayOneSketch.tsx` | the section: `data-day-one` = `plan` \| `none` \| `unavailable` \| `pending` \| `unknown`. Eyebrow `affectedAreas.dayOne.title`; status line (`panosRead` of `panosTotal` · drawn when · "from the calibration reads" when `contractVersions` holds `layout.cal0`); a floor switch (`SegmentedControl`) only when `floors.length > 1`; `DayOnePress` top right; `DayOnePlan` beside `DayOneRooms` from 960 px of container, under it below. Its one state is the chosen floor's place in `floors` |
| `DayOnePlan.tsx` | one floor: `RegionImage` (`badgePlacement="clear"`, MAN-8945) over the engine's drawing; one outline and number per area, fixture and piece of contents; one spot per pano named "{room} 360° photo" ("…, n of m" for a room with several shots). Caption lines `data-day-one-line="scale" \| "pins" \| "spots"`. Enlarge opens a display-only copy in `Lightbox`. Drawing bytes absent: waiting surface; a drawing that moves while a walk runs (its address is its content's hash) keeps the last one on screen until the new one arrives, and the plan is keyed by its floor's number, not its drawing, so an enlarged drawing stays open and a focused number stays held; failed: `data-day-one-failed` box with Try again (`onRetryDrawing`) |
| `DayOneRooms.tsx` | per room (`data-day-one-room`): size, area, perimeter, ceiling, each side's source with its band, a warning when unpinned, the sketch and first-report checks; then its numbered rows (`data-day-one-item`) with "Seen in {n} photos" above 1 |
| `DayOnePress.tsx` | `data-day-one-press`: the unread panos and views, today's budget, the walk (meter, Stop), the refusals in words, and what a part read left ("2 of 6 views could not be read.", said once the walk is over) |
| `hooks/useDayOne.ts` | the section's data for the open tour (`DayOneSection`, `src/shared/types.ts`): the plan in force (`useLayoutPlan`), each floor's drawing as an object URL through the token (`useDrawingUrls`, `hooks/useImageUrl.ts`; `onRetryDrawing` bumps its attempt), the press (ONE unarmed layout press for the first pano needing a read when the tour opens and the view is shown, none when nothing is left; an armed answer outranks a dry run still out), and what is left to read (`layoutUnread`, `utils/tourModel.ts`) |
| `hooks/useLayoutPlan.ts` | the tour's `layout` and `dayOne`, unless a newer word of its own stands over them, held only while the detail it was learnt against is the one on screen (a detail read again replaces it): the open's ONE `buildPlan` of a `stale` plan (no model; waits for the view to be shown; `rebuilding` while out; its fault is `trouble`), and `adopt`, the status a layout press answered with |
| `hooks/useLayoutWalk.ts` | the layout walk, `useTourReader`'s shape over `api.affectedAreas.readLayout`: the panos with a view whose layout is unread or not `current` (`layoutQueue`, capture order), one armed press each, "Reading 3 of 8", Stop after this pano; a refusal ends it, except `views_refused` (passed and counted); two panos in a row whose every view failed (`viewsFailed` with no `viewsRead`: the engine's own `_DEAD_PANOS`; such a pano is `partial`, not refused) end it as `failing`, said "Two panos in a row could not be read at all"; a press with no answer in time (`unreachable`) is pressed again ONCE, the second finding its reads cached; it sends only while the press is on screen (`isShown`: the view in layout, the Tours surface, no pano open — the meter and Stop are nowhere else), so a pano opened mid-walk ends it after the pano in hand and the press offers what is left on return; each answer is handed on (`onAnswer`), and one that carries a `layout` has the root read the tour and the open pano again, quietly |
| `utils/dayOneModel.ts` | pure, one model for the drawing and the list: `numberedItems(floor, codebook, t)` → `SketchItem[]`; `feet`, `band`, `inches`; `placementNotes(placement, panoRoom, t)`, the pano screen's "Counted in {room}" (the credited room's key AND floor against the pano's) and "Seen in {n} photos" (`RegionList`, `PanoSphere`'s chosen line, a line of its own under the kind) |
| `dayOne-fake.ts` | `FAKE_DAY_ONE` (Clarence Tse's tour, one entry per state of the section) and `FAKE_DRAWINGS`; imported only by the scaffold probe, 2026-10-26 |

Rules:
- Presentational: every datum is a prop. Every position is the engine's, in 0..1 of the floor's drawing; the browser computes none.
- Numbers: the wire numbers areas only (`DayOneArea.number`, from 1 per floor, in the plan's room order). `numberedItems` numbers fixtures and contents after the last area, in the wire's order. The drawing's tab order is the areas by number, then the objects.
- An area is drawn in `REGION_LOOK` of its member (`regionState`); a fixture or contents in the neutral tone with the light wash.
- Words never sit on the drawing: a number meets its row in `DayOneRooms`.
- `DayOnePress` reads `lastAnswer`: the dry run on open, then each armed answer the walk lands. why: its budget lines go stale otherwise. A walk's answer replaces the section's status line at once; the tour is read again after each answer that carries a layout, and the floors, the status and the counts follow the plan the press rebuilt.
- A press on an area or object calls `onOpenPanoAt(panoId, face, regionId)`, `regionId` null for an object; a press on a spot calls `onOpenPano(panoId)`. The Lightbox copy passes spots without `onPress`: inert.
- The drawing loads as an `<img>`, so it cannot follow the theme: the engine's SVG carries its own white ground. Spots are the one fixed-colour mark on it (MAN-8947); room names clear of the spots: INV-9720.
- Words: `affectedAreas.dayOne.*` in `src/modules/i18n/locales/en/common.json`, `en` only.

Probes (`.verify/`, git-ignored; run against the real :5183 client, no model call; `lib/day-one-kit.mjs` holds the open-the-tour and verdict plumbing the first two share):
- `node .verify/affected-areas-day-one.mjs [--tour <id>] [--evidence <dir>]`: Clarence Tse's tour at 390 and 1280 px, pressing nothing armed. Holds the section to the wire (outlines, badges, spots, rooms, the drawing's bytes through the token, the status counts), the dry run (unarmed, for the first pano needing a read, its budget line the answer's numbers), an area on the drawing and in the list opening its pano at its face with its region chosen, a spot opening its pano on 360°; then over a rewritten answer (edited in the browser, nothing written): an object opening its face with no region, a `stale` tour sending ONE rebuild, a drawing that did not arrive and Try again, a region the plan credits to another room saying "Counted in … · Seen in 2 photos" on 360°, on the sphere's chosen line and on its face.
- `node .verify/affected-areas-day-one-walk.mjs [--tour <id>] [--evidence <dir>]`: the layout walk with every armed press answered inside the browser (never forwarded: nothing is bought), the unarmed dry run going through. Five walks: Stop, a refusal (budget), a press with no answer pressed again once, no answer twice, a pano passed over; the tour's own layout reads on the wire are compared before and after.
- `node .verify/affected-areas-day-one-scaffold.mjs [--states a,b] [--evidence <dir>]`: mounts `DayOneSketch` over each `FAKE_DAY_ONE` state, photographs 390 and 1280 px in both themes, presses every callback, and exits 1 on a FAIL. Fails when a `partial` or `built` number is less than 80% shown or its middle's press lands elsewhere (light theme).

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/dayOne-fake.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/DayOnePlan.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/DayOnePress.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/DayOneRooms.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/DayOneSketch.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/hooks/useDayOne.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/hooks/useLayoutPlan.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/hooks/useLayoutWalk.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/utils/dayOneModel.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/affected-areas-day-one.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/affected-areas-day-one-scaffold.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/affected-areas-day-one-walk.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/day-one-kit.mjs

## MAN-9055 — server/modules/companion/tools — house reads: his chats, the resolvers, the roster, a chat's state and activity line

Kaylee's reads of the house. Every read answers from the database and the running server at call time: nothing cached, nothing polling, no usage or spend in any answer (ruling 17).

## `house-reads.ts` — the one door the tool files read the house through
| Export | Answers |
|---|---|
| `listHisChats()` | `HisChat[]` `{ sessionId, name, project, projectPath, updatedAt }`, newest first; `updatedAt` epoch ms, 0 when unreadable. |
| `chatRows()` | `ChatRow[]` `{ chat, state }`, ONE liveness read for all; ordered waiting, working, live, asleep; recency kept inside a state. |
| `resolveChat(ref)` | `ChatResolution` `{ ok: true, chat: CompanionSessionRef }` or `{ ok: false, sentence }`. |
| `listVisibleProjects()` | `HisProject[]` `{ name, path }`: registered, not archived, not in a hidden root; by display name. |
| `resolveProject(ref)` | `ProjectResolution` `{ ok: true, project }` or `{ ok: false, sentence }`. |
| `rosterText()` | The body of `<sessions>`; caller `companion-account.ts` (`readRoster`), read at each push. A failed read is logged (`[Companion] the roster could not be read`) and answers one sentence; never throws. |
| `chatNameOf(sessionId)` | The name the sidebar shows for ANY chat row (archived, hidden-root, or one the resolvers would not offer), one line, else `Untitled Session`. `list_followups` names a follow-up's chat by it: an item outlives the sidebar entry it came from. |
| `chatState`, `activityLine`, `askLine`, `pendingAsksOf`, `ChatState` | Re-exported from `chat-activity.ts`. |

## His chats
- A row of `sessions` with `isArchived = 0`, in a project that is not archived and not in a hidden root (`visibleProjectPathSql`, the sidebar's own test), whose `provider_session_id` is NULL or differs from `session_id`.
- `sessions` holds thousands of synced soul transcripts whose session id equals their provider id; none is his chat.
- `sessions` has no user column: every account sees the same chats, as the sidebar does.
- Name: `custom_name` folded to one line, else `Untitled Session`. Project: custom name, else the folder basename, folded to one line either way (`projectDisplayName`), else `no project`.

## The hidden fallback
- A probe chat lives under `/tmp`, a hidden root, so it is never his chat by the test above.
- `resolveChat` falls back to non-archived app chats of hidden projects only when NONE of his fits, and only by id or exact name.
- `resolveProject` falls back to a registered, non-archived project of a hidden root only when named by its EXACT path.
- The roster and both lists never include the fallback pool.

## Resolution rules
| Ref | Result |
|---|---|
| empty | sentence: name the chat/project; `list_sessions` / `list_projects` shows them |
| chat: id, or exact name (case-insensitive; the roster's entity spelling of a name also matches) | the one match |
| chat or project: several match | sentence naming each with project and id (chat) or path (project); at most 12 chats shown, then `and N more` |
| none | sentence; a ref of 3+ characters also names chats/projects that merely contain it in the name |
| project: display name (case-insensitive) or registered path | the one match |

## `chat-activity.ts` — what a chat is doing now
`ChatState` = `working` | `waiting` | `live` | `asleep`. `asleep` is still sendable: a message wakes it and resumes where it left off.

`chatStates(sessionIds)` reads `sessionHostLivenessSnapshot()` ONCE for the list. Per chat, first match wins:
1. `waiting`: `providerRuntimeService.getPendingApprovalsForSession` is non-empty.
2. `working`: `chatRunRegistry.isProcessing`.
3. `live`: a session host holds the chat.
4. `asleep`.

`waiting` beats `working`: a chat blocked on an ask still has its run registered; reading it `working` would hide the ask she exists to notice. Reversing it is one line in `chatStates`.

`activityLine(sessionId, state?)` — ONE line, always (`oneLine` at the single exit):
| State | Line |
|---|---|
| working | last tool call in the run's replay buffer (`describeToolCall`), else the last assistant words cut at 80 code points, else `just started` |
| waiting | `AskUserQuestion`: `asks "<first question, 100 code points>"` plus ` (and N more)`; `ExitPlanMode`: `a plan is ready and waits for his approval`; else `wants permission: <describeToolCall>`; no ask found: `waiting on him` |
| live, asleep | `idle just now` / `idle N min` / `idle N h` (under 48 h) / `idle N d`; `idle, no recorded activity` when the row has no time |

Cuts count code points (`cutAt`), so none lands inside an emoji.

`pendingAsksOf(sessionId)` is the gateway's list of the asks a chat is blocked on, oldest first. `askLine(ask, detailed = false)` is the waiting line above for ONE ask; `detailed` is the line she decides on: with exactly one question, ` Options: A | B | C` (the option labels) follows, and a permission carries what it would run in full (`describeToolInput`: a Bash command whole up to 600 characters, a count of what was cut) with the rule an "always" would store. Without it a Bash command is cut at 60 characters, as a roster line is scanned. `activityLine` uses it for the oldest ask undetailed; `read_session`'s `pending_ask` uses it for every ask detailed.

## Roster (`rosterText`)
- One line per working, waiting or live chat: `name · project · state: activity · id <sessionId>`; 20 lines at most, waiting first; `…and N more active; list_sessions with scope active names them.` past 20.
- No active chat: `None of his chats is working, waiting or live.`
- Then `Asleep, still sendable: <12 most recent names>` plus `, and N more`.

## Probes
`.verify/companion-house-reads.mjs` (read-only on the live database, prints resolvers, roster, handler text), `.verify/companion-house-states.mjs` (working, waiting, live on in-process stand-ins), `.verify/companion-view-of.mjs`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/tools/chat-activity.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/tools/house-reads.ts

## MAN-9056 — server/modules/companion/tools — list_sessions and list_projects: scopes, the phrase search and the first-words read

`sessionTools()` (`session-tools.ts`) returns the SDK `tool()` definitions of `list_sessions` and `list_projects`. Both carry `readOnlyHint` and set neither focus nor her activity. Both read the house through `house-reads.ts` (see the house-reads row).

## Descriptions
- Each description is `toolLine(name)` (`session/companion-prompt.ts`): the tool's line from the prompt's `TOOLS` section.
- `toolLine` throws when the prompt has no line for the tool: a tool added without a `TOOLS` line fails the first use of an account, because that is when its tool list is built.

## `list_sessions(scope)`
`scope`: string, trimmed, 1–200 characters. A line is `name · project · state · activity · id`.
| scope | Lists |
|---|---|
| `active` | every chat not asleep (working, waiting, live); none: says so and names scope `recent` |
| `recent` | the 15 most recent asleep chats |
| anything else | chats whose name, project and first words together hold EVERY word of the phrase (case-insensitive, any order); 10 at most, then `More chats match; narrow the phrase to see the rest.` |

- Order within a scope: waiting, working, live, asleep; recent first inside a state.
- A chat's first words are read only when its name and project did not already answer, and only until the list is full.

## `list_projects()`
- One line per visible project: `name · path`, by display name. A path is printed raw: it is what she passes back to `resolveProject`.
- None registered: `No project is registered yet, so a new session has nowhere to start.`

## Failure
A failed read is logged (`[Companion] <tool> could not read the house`) and returns `isError` text `… could not read the house just now (<reason>). Try once more; if it fails again, tell him.`

## `chat-first-words.ts` — `firstWordsOf(sessionId)`
- Up to 400 characters, one line, from the HEAD of the chat's transcript JSONL (`extractFirstValidJsonlData`): the first plain user row of the chat itself (not a sidechain, not `isMeta`, not a row opening with `<`). Gives up after 200 rows.
- Never `fetchHistory`: it parses a transcript end to end (largest of his: 27 MB) and caches 8, so a search through it thrashes the cache.
- A compacted chat opens with a seed beginning `This session is being continued from a previous conversation`; the preamble through `Summary:` is stripped and `*`/`#` removed, so the summary names the chat's threads. 2026-10-26: 12 of his 19 chats open this way.
- Claude chats only (`provider === 'claude'` with a `jsonl_path`); anything else answers `''`. Never throws.
- A found answer is kept per process; a miss is not (the first message may not have arrived).
- Best effort: it feeds a search and is never something she says as fact.

## `server/shared/tool-text-result.ts`
`textResult(text, isError = false)` → `{ content: [{ type: 'text', text }] }` plus `isError: true` on a refusal; the sentence says what to do next. Has an `.oxlintrc.json` boundaries entry; `session-tools.ts`, `draft-tools.ts` and `act-tools.ts` answer through it.

`guardedToolResult(toolName, doing, run)` runs one tool's work: a throw is logged `[Companion] <tool> could not <doing>` and answered as `isError` text `<tool> could not <doing> just now (<reason>). Try once more; if it fails again, tell him.` `session-tools.ts` (doing: `read the house`), `draft-tools.ts` and `act-tools.ts` (doing: `stop the chat`, `rename the chat`, `answer the chat`) share it.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/tools/chat-first-words.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/tools/session-tools.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/tool-text-result.ts

## MAN-9057 — server/modules/notifications — the session presence store: markPresence, clearPresence, isSessionWatched, isSessionOnScreen, viewOf

`services/session-presence.service.ts` records which session each open browser tab shows. `notifications/index.ts` exports all five functions below.

## Store
- One in-memory `Map<connection, { userId, sessionId, visible, updatedAt }>`, keyed by the chat websocket connection object itself; the record lives as long as the connection.
- It lives in notifications, not websocket: the ntfy channel reads it, and importing the websocket barrel there would close the cycle websocket → providers → notifications → websocket.
- A tab repeats its report every 30 s while visible. `DEFAULT_FRESH_MS` = 90 000: silence past it means gone or asleep.
- `FORGET_AFTER_MS` = 600 000: `markPresence` drops records this old (a connection that closed without `clearPresence`).
- A connection whose numeric `readyState` is not OPEN (1) never counts and is deleted by the next read; a key with no `readyState` is judged by freshness alone.
- User ids compare as strings (a number on one path, a string on another).

## Functions
| Function | Answers | Caller |
|---|---|---|
| `markPresence(connection, { userId, sessionId, visible })` | sets the record, stamps `updatedAt` | chat websocket, each `chat.presence` report |
| `clearPresence(connection)` | deletes the record | chat websocket, on close |
| `isSessionWatched(userId, sessionId, { freshMs? })` | does one of THIS user's tabs show the session visibly and fresh; false for a null user or session | ntfy channel: skips the push when true |
| `isSessionOnScreen(sessionId, { freshMs? })` | the same, whichever user | chat run registry: stamps a finishing on-screen chat read. A run carries no user and `sessions` has no user column |
| `viewOf(userId)` | `string \| null`: the chat on the account's freshest visible tab | the companion's `<view>` message: `viewedChat(userId)` in `companion-account.ts`, read at every push and named for her only when `resolveChat` can resolve it |

## `viewOf` rules
- The FRESHEST visible, live, 90 s-fresh record of the account decides, not any tab: two windows open, the one that reported last is the one he looks at.
- When that tab shows no chat (home page, a settings screen) the answer is `null`, never an older tab's chat.
- A hidden tab, a closed socket or a record past 90 s never counts.
- No `freshMs` option: always `DEFAULT_FRESH_MS`.

## Probe
`.verify/companion-view-of.mjs`: 13 checks on the real presence store.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/notifications/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/notifications/services/session-presence.service.ts

## MAN-9058 — server/modules/companion — the door: routes, input limits, refusals, module wiring

Kaylee's HTTP door. Transport only: a route reads who asks, checks the SHAPE of the body, calls one service verb (see the service row) and answers. What a verb means is the service's.

## Wiring
- `index.ts` exports `createCompanionModule` alone; every other symbol of the folder is private to it.
- `createCompanionModule({ runtime })` returns `{ router, stop }`: it calls `companionService.attachRuntime(runtime)` BEFORE building the router, so no request reaches a verb with no gateway. `stop` is `companionService.stopAll`.
- `runtime` is the `ProviderRuntimeGateway` the chat socket uses, so an act of hers is the page's own act.
- Building the module launches no process: a conversation starts on an account's first message.
- Mount: `/api/companion` behind `authenticateToken` (the account is `req.user`). Mounted in `server/index.ts` (`app.use('/api/companion', authenticateToken, companion.router)`).
- Shutdown: `shutdownRuntimeServices` in `server/index.ts` awaits `companion.stop()` first, raced against 3 s (`Promise.race` with `delay(3_000)`), before `cerberus.stop()` and the rest. why: a CLI that answers nothing is ended by its own 5 s grace, which keeps running, and the shutdown must not sit behind it inside the supervisor's window (INV-9807).

## Routes (`companion.routes.ts`)
| Route | Reads | Answers | Verb |
|---|---|---|---|
| `GET /` | client id optional | 200 `CompanionPicture` | `picture` |
| `POST /messages` | client id REQUIRED; `{ text }` 1–8000 | 202 `{ accepted: true }`; her sentences return as frames on the page's socket | `sendText` |
| `POST /floor` | client id REQUIRED | 204 | `takeFloor` |
| `PUT /settings` | JSON object, a partial of the settings | 200 `CompanionSettings` | `saveSettings` |
| `PUT /draft` | `{ text }` 1–20000 | 200 `CompanionDraft` | `editDraft` |
| `DELETE /draft` | – | 204 | `clearDraft` |
| `DELETE /notes/:id` | `id` matches `/^[1-9]\d{0,14}$/` | 204 | `dismissNote` |
| `POST /interrupt` | – | 204 | `interrupt` |
| `POST /clear` | – | 204 | `clear` |
| `POST /press` | client id REQUIRED; multipart: `audio` (one file, ≤ 25 MB, memory storage — the voice module's bound) and `durationMs` (a whole number 0–3600000, the page's own clock for the clip) | 202 `{ text }` — what he said as heard, `''` for the empty press; the answer comes once the press has been pushed in its turn | `press` (takes the floor first; `companion-press.ts`, MAN-9059) |
| `GET /speech/:turnId/:index` | client id REQUIRED, and it must be the floor's; `turnId` `/^[A-Za-z0-9_-]{1,100}$/`, `index` 0–100000 | 200 `audio/l16; rate=24000; channels=1` streamed (one of her sentences as PCM); 204 for a sentence with nothing to say; the refusals below. `HEAD` is 405 | `speech` (`companion-speech.ts`, MAN-9110) |
| `POST /cut` | client id optional; `{ turnId, heard: number \| null, interrupted: number \| null }`, all three keys required | 204, after her turn was interrupted | `cut` (`companion-speech.ts`, MAN-9111) |
| `POST /draft/send` | client id REQUIRED; `{ mode: 'turn' \| 'steer' }` (anything else is a 400 `COMPANION_INPUT_INVALID`) | 200 `{ outcome: 'started' \| 'folded' }`; a refused send is a 409 `COMPANION_SEND_REFUSED` whose message is the sentence the draft card shows | `sendDraft` (takes the floor first: the chat opens on the page that pressed) |

- The send itself is `companion-send.ts`, shared with `send_to_session` and `create_session`: checks, fold or turn, options, new chat, what clears — MAN-9072. The route adds the floor only (`sendDraft` takes it first).
- An answer is the thing itself, never wrapped (`{ settings }`, `{ data }`).
- `POST /messages`, `/floor`, `/press` and `/draft/send` REQUIRE the client id header (the page that pressed takes the floor); `GET /speech/…` REQUIRES it too (it names the page asking for her voice and takes no floor); every other route validates it if present and does not need it.

## Input (`companion-input.ts`)
| Name | Rule |
|---|---|
| `x-companion-client` | the page's own id; `/^[A-Za-z0-9._:-]{1,100}$/`; present and malformed = 400, never read as absent |
| `MESSAGE_TEXT_MAX` | 8000 characters |
| `DRAFT_TEXT_MAX` | 20000 characters, counted by `characterCount` (code points); the routes and the draft tool (`tools/draft-tools.ts`) share both |
| `readBodyText` | trims, then 1..max code points (an emoji counts one); the trimmed text is what is stored, so a later equality check on it compares trimmed text |
| `readBodyWholeNumber` | a whole number `min`..`max` from a number or a string of digits (no sign, point or leading zero: a multipart field arrives as text); `POST /press`'s `durationMs` |
| `readTurnIdParam`, `readBodyTurnId` | a turn id: `/^[A-Za-z0-9_-]{1,100}$/`; else 400 naming `turnId` |
| `readSentenceIndexParam` | the speech path's index: digits, no sign, no leading zero, 0–100000; else 400 naming `index` |
| `readBodySentenceIndex` | a cut's `heard` or `interrupted`: the key present, a whole number 0–100000 or `null` (a digit string is a 400); else 400 naming the field |
| `readBodyObject` | requires `request.is('application/json')` AND an object body; no body or `text/plain` = 400; an explicit `{}` sent as JSON is a legal empty patch. why: `express.json()` leaves `{}` for a missing body, and a save that sent nothing must not answer 200 |

The page's request helper sets `Content-Type: application/json` on every non-FormData call; a script sends it itself.

## Refusals
Envelope (the entrypoint's `AppError` handler): `{ success: false, error: { code, message, details } }`.
| Status | `code` | When |
|---|---|---|
| 400 | `COMPANION_INPUT_INVALID` | any shape failure above, a settings value past its limit; `message` names the field and its limit; `details.field` names the field |
| 400 | `COMPANION_INPUT_INVALID` | `POST /press`: no `audio` file, an `audio` that multer refused (past 25 MB, under another field name, not well-formed multipart) — `details.field` is `audio`; a `durationMs` that is missing or not a whole number 0–3600000 — `details.field` is `durationMs`; a clip that transcribes to more than 8000 characters (a typed line's limit) — `details.field` is `audio`, and a `system` log line says so |
| 400 | `COMPANION_INPUT_INVALID` | `GET /speech/…` and `POST /cut`: a `turnId` or index that is malformed, a cut that leaves out `heard` or `interrupted`, a request with no client id — `details.field` names it |
| 404 | `COMPANION_NO_SENTENCE` | `GET /speech/…`: the turn is not her current one, the log holds no sentence at that index, or the log was cleared (MAN-9110) |
| 409 | `COMPANION_NOT_FLOOR` | `GET /speech/…` from a page that does not hold the floor |
| 409 | `COMPANION_NO_DRAFT` | `PUT /draft` while no draft is held |
| 409 | `COMPANION_SPEECH_REFUSED` | `POST /press` when Gemini cannot be asked or refuses the key (`no_key`, `refused`), and `GET /speech/…` for the same two; `message` is the sentence ("No Gemini key: set one in Settings → Voice") |
| 502 | `COMPANION_SPEECH_FAILED` | `POST /press` when Gemini answered something that is not words (`failed`: another status, a network error or timeout, an answer without text), and `GET /speech/…` when the synthesis failed before its first byte; `message` is the sentence |
| 409 | `COMPANION_SEND_REFUSED` | `POST /draft/send` when the send is refused (no draft, an empty draft, the chat gone, a send already going out, a new chat in a folder that is gone, a chat that did not take the brief — the door refused it); `message` is the sentence the draft card shows |
| 503 | `COMPANION_STOPPING` | `POST /messages` and `POST /press` after `stopAll` |

## Probe
`.verify/companion-module.mjs`: see the service row. The speech door and the cut: `.verify/kaylee-speech-door.sh` (no Gemini call) and `.verify/kaylee-speech-door-live.mjs` (MAN-9110). The press door: `.verify/kaylee-press-refused.sh` (no key in reach, the door's 400s, a stand-in for Gemini's 500 and 403; no Gemini request) and `.verify/kaylee-press-live.sh` (curl as account 1 on :3011, haiku, one Gemini call) — MAN-9059.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/companion-input.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/companion.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/companion.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/index.ts

## MAN-9059 — server/modules/companion — the service verbs, one account's wiring, the picture, the tool registry and deps

## `companion.service.ts` — `companionService`
One `CompanionAccount` per CloudCLI account, made on that account's first call (`accountOf`) and never before. A made account is ASLEEP: no process launches until a message is pushed. Every verb takes the account's id first, so a call cannot reach another account's rows, pages or conversation.

| Verb | Does |
|---|---|
| `attachRuntime(gateway)` | stores the gateway and clears the stopped flag; `createCompanionModule` calls it before any verb. An account made with no gateway throws. |
| `picture(userId)` | `buildPicture` |
| `takeFloor(userId, client)` | the page holds the floor from now on |
| `sendText(userId, client, text)` | takes the floor for the typing page, logs the line (`role: 'operator'`, `via: 'typed'`), pushes it to her. 503 `COMPANION_STOPPING` once `stopAll` has run. |
| `press(userId, client, { audio, durationMs })` | a press of his talk button, answering `{ text }` (`''` for the empty press); built by `createPress` in `companion-press.ts`. See Press. 503 `COMPANION_STOPPING` once `stopAll` has run, before the press is heard and again before it is pushed. |
| `speech(userId, client, { turnId, index }, signal)` | one of her sentences as streamed PCM for the page `client`, which must hold the floor; an `AppError` refusal comes before the first byte. `speak` of `createSpeech` (`companion-speech.ts`): MAN-9110 |
| `cut(userId, { turnId, heard, interrupted })` | the talk press while she speaks: aborts the turn's syntheses, owes `<cut>`, interrupts her. MAN-9111 |
| `saveSettings(userId, patch)` | stores, emits `companion_settings` to every page, and on a model change calls `session.setModel`. A switch the CLI refuses or does not answer within `CLI_GRACE_MS` (5 s) is a `system` log line; the save and the stored model stand, and her next wake runs on it. |
| `editDraft(userId, text)` | replaces the held draft's words, keeps its target; 409 `COMPANION_NO_DRAFT` when none is held |
| `clearDraft`, `dismissNote` | a note already gone is not an error |
| `interrupt` | stops her own turn; a Stop with no turn does nothing |
| `clear(userId)` | see Clear |
| `stopAll()` | sets the stopped flag, then per account `speechCache.end()` and per session `interrupt()` and `close('the server is stopping')`; one failure is logged and does not hold the rest |
| `warm(userId)` | starts her process with nothing pushed (`session.warm()`); the alert feed calls it when a gather window opens. Refused silently once stopped. |
| `alert(userId, alerts)` | the alerts the alert feed let through: one `alert` log line each (`CompanionAlert.line`), then ONE `pushAlerts` message of their envelopes. A row that cannot be written is logged and costs no push. Refused silently once stopped. |
| `runFailed(sessionId)` | the alert feed heard `run.failed`/`run.limit`/`api.error`/`login.expired` for this chat, whatever its gates decided: marks the chat for 30 s. why: the runtime raises the failure and then still sends `complete` (exit 0) with NO `error` row, so without the mark a failed run was told twice, `failed` and then "finished". |
| `runCompleted(sessionId, aborted)` | a chat's run ended. Returns at once. Takes (and clears) the chat's failed-run mark first; skips an aborted or failed run. For each account whose stored focus is the chat (`companionDb.userIdsFocusedOn`, so an account not touched since boot is found) and whose Live is on, reads the run's reply BEFORE awaiting anything (`readRunReply`), then builds the `<session event="finished">` (`focusNewsEnvelope`) and pushes it (`pushFocusNews`); after the build (a dactyl can take up to 180 s) Live is read again and a stopped server drops it. |
| `chatDeleted(sessionId)` | a chat row was deleted (`feeds/deleted-chat-feed.ts` rides `onSessionsDeleted`, announced by `sessions.db.ts`' `deleteSessionById` and `deleteSessionsByProjectPath`, so the sidebar's delete, the synchronizer pruning a vanished transcript and a project's delete all reach it; the duplicate merge does not: the chat lives on under the app row). For each account whose stored focus is the chat (`companionDb.userIdsFocusedOn`) it calls `store.setFocus(null)`, so the pages hear `companion_focus` null. One account that fails is logged and does not hold the rest. why: the focus kept naming a chat nobody could open, and only her Clear emptied it. Her draft's target and her walk are left: a deleted chat there is refused in words when she is asked to send to it, and `walk` 0 ends the walk without resolving the chat. Proof: `.verify/companion-focus-deleted.mjs` (live), `.verify/chat-deletion-announce-direct.mjs` (every door, on a copy). |

### Clear
0. `speechCache.end()`: every synthesis aborted, every turn unspeakable until the next turn starts (MAN-9111).
1. `session.clear()` runs SYNCHRONOUSLY: detaches her process and forgets her CLI conversation. why: a message landing mid-clear wakes a fresh conversation, never a resume.
2. `store.clearAccount()` wipes log, notes, draft, walk, focus; every page empties at once.
3. Awaits the old process's wind-down (up to the CLI grace).
- `relayed_sends` rows stay: they belong to the chats.

### Press (`companion-press.ts`)
Every press is ONE turn and she always answers, if only with a word (ruling 6): nothing listens between presses.
1. The press takes the floor for the pressing page, at once.
2. It is HEARD: `durationMs` < 400 (the page's clock) or a clip of no bytes is the empty press with no Gemini call; any other clip goes through the voice barrel's `transcribeSpeech(userId, audio)` (Gemini, not counted against any budget), whose empty answer is the empty press too. The hearing is told to answer `[no speech]` for a clip with no words (a model asked to "output nothing" invented a question for 2 s of silence; told to answer the mark, a silent clip has still come back as words — open defect INV-9876, MAN-9099 §Standing defect), and a whole answer that is one bracketed note (`[no speech]`, `[silence]`, `(inaudible)`) is read as empty text — `gemini-transcribe.ts`, shared with the chat mic.
3. It is SETTLED: his line joins the log (`role: 'operator'`, `via: 'spoken'`, the transcript as text, `''` for the empty press) and is pushed — `pushOperator(text, 'spoken')`, or `pushOperatorEmpty()` for `<operator via="spoken" heard="nothing"></operator>`.
- ARRIVAL ORDER: hearing starts when a press arrives (two uploads can be in flight), but each account keeps one chain and a press is settled only after the press before it was pushed or refused. why: a slow transcription must not let a later press overtake it into her conversation.
- A hearing that is refused or fails pushes nothing and does not wake her: a `system` log line "I could not hear that: <sentence>" and an AppError carrying the sentence — 409 `COMPANION_SPEECH_REFUSED` (`no_key`, `refused`), 502 `COMPANION_SPEECH_FAILED` (`failed`). A `transcribeSpeech` that throws is a defect: logged, and settled as `failed`.
- A transcript past `MESSAGE_TEXT_MAX` (8000 characters, counted by code points like a typed line) is refused the same way: a `system` line and a 400 `COMPANION_INPUT_INVALID` naming `audio`, not logged and pushed whole.
- A message pushed while a turn runs joins that turn, so her one answer can cover both lines of two quick presses.
- Proof: `.verify/kaylee-press-refused.sh` (no key: 409 "No Gemini key: set one in Settings → Voice", the system line, her process asleep, 0 requests to Gemini; the 400s; stubbed 500/403 and their order) and `.verify/kaylee-press-live.sh` (the fixture clip and, right behind it, a 0.2 s one, on haiku: `{ "text": "What chats are working?" }` and `{ "text": "" }`, the log in that order, her JSONL, one `[voice] gemini transcribe` journal line, no spend-ledger file added).

### Stop
- Flag lives in the service; `sendText`, `press`, `warm`, `alert` and the focus push (`runCompleted`, after its build, with Live) check it.
- `attachRuntime` clears it: a newly built module takes messages again.
- `module.stop()` unsubscribes both feeds BEFORE `stopAll`.

## `feeds/` — what she hears unasked
Both feeds start in `createCompanionModule` and are subscriptions to events the house already raises; nothing polls.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/companion-account.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/companion-picture.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/companion-press.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/companion.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/feeds/deleted-chat-feed.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/tools/companion-tools.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/tools/tool-deps.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/session-deletion.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-deletion-announce-direct.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/companion-focus-deleted.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/companion-module.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-press-live.sh, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-press-refused.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-press-refused.sh

## MAN-9069 — server/modules/companion — the service verbs, one account's wiring, the picture — `alert-feed.ts` — `startAlertFeed(service)`
section: server/modules/companion — the service verbs, one account's wiring, the picture, the tool registry and deps/001 `alert-feed.ts` — `startAlertFeed(service)`

`onNotification` (notifications module) hears every event the orchestrator is handed after the session is normalized and BEFORE the push preference and the push dedupe (a `background` event is off for pushes by default and would never arrive behind that gate; a shared dedupe would let a push and her consume each other's slot). A listener that throws costs no push.
An event is dropped unless ALL hold, checked cheapest first: its code is in `ALERT_KIND_BY_CODE`; his Live is on; a page of his is connected (`isUserConnected`); not a repeat by the feed's own 20 s dedupe keyed `<user>:<dedupeKey or provider:kind:code:session>` (checked last, so a dropped event does not use up its slot).
| Code | `<alert kind>` |
|---|---|
| `dispatcher.finished`, `dispatcher.epic_finished` | feature finished |
| `run.background_completed` | background work landed |
| `agent.notification` | asking |
| `permission.required` | permission |
| `run.failed`, `run.limit`, `api.error`, `login.expired` | failed |
| `session.stuck` | stuck |
Nothing else is an alert: never `limit.*`, `push.enabled`, `run.stopped`, `dispatcher.paused`/`limit_paused`/`relaunched` (ruling 17).
- Survivors of one account gather in a one-shot 3 s window opened by the first; at its close Live is read again, each alert is built on its own (`buildAlertBlock`, a failure costs only that alert) and `service.alert` gets them all. A window builds at most 20 (`ALERTS_PER_WINDOW_MAX`, ~12 ms each of synchronous work); the rest are one sentence saying how many.
- The same listener calls `service.runFailed(sessionId)` for every `failed`-kind code before any gate, so the focus feed can tell that chat's run from a finished one.
- Her process is started when the window OPENS (`service.warm`). why: measured 2026-10-27, a message that wakes her reaches her ~1.0 s after the push (CLI start), a message to a running process ~44 ms, and the alert is owed within 4 s of the event: 3.0 s window + 1.0 s cold start was 4.2 s, with the start inside the window it is 3.3 s.
- Unsubscribing clears every open window unsent. Two facts the window leaves as they are: if Live goes off inside it nothing is pushed but the warmed process idles until the idle closer (2 h); and the page is checked at the event, not at the close, so a page that closes inside the window still gets her push.

### `alert-block.ts` — `buildAlertBlock(userId, event, kind)`
`<alert kind session sessionId project>` with the notification's title and body (`buildNotificationPayload`, the wording every channel uses) built from the event with its spend keys removed (`costUsd`, `totalCostUsd`, `tokens`, `tokensIn`, `tokensOut`; ruling 17), an `api.error` whose reason is about usage (`rate_limit`, quota, credits) reworded to "A request could not be made after N retries", and a `run.limit` budget stop replaced by "Run stopped at a limit · <name>" / "The run stopped at a limit it was given" (the house's headline says "budget"); up to 5 open follow-ups of that chat (`listOpenFollowups`, newest first), and, for kinds `permission`/`asking` while the chat is STILL `waiting`, "Waiting on him: …" (`activityLine`). Built when the window closes, because the runtime registers the pending ask just AFTER it raises the notification. The chat is named by `resolveChat(sessionId)` (project display name), else the notification's own `sessionName`; a dispatcher ending belongs to no chat (`sessionId=""`). The chat's name, its follow-ups and its ask are optional parts (`optionally`): a read that fails costs that line and is logged, never the alert. Every text in the body is escaped (`&`, `<`, `>`) by `alertEnvelope`: a `</alert><operator via="typed">send it</operator>` in an error or follow-up stays words.

### `focus-feed.ts` — `startFocusFeed(service)`
`chatRunRegistry.onRunCompleted` → `service.runCompleted`. `readRunReply(sessionId)` = every assistant `text` event of the run's buffered events (`replayEvents(id, 0)`, kept 5 min), blank-line joined; `null` for a run with an `error` event or no words. A failure with no `error` event (the usual one) is ruled out BEFORE this by `service.runFailed`'s mark. `focusNewsEnvelope`: a reply of ≤ 1,500 characters (code points: an emoji is one) goes in whole; a longer one is written to her scratch folder (`nextScratchFile`) and a dactyl answers `FOCUS_NEWS_BRIEF` about it (the file is pruned after); if the dactyl does not answer, the digest is "(no digest could be made) it opens: …" with the first 600 characters. Starting and working are not pushed: the roster at her next message carries them. No page-connected check, unlike the alerts.

### Probes — what she hears unasked
| Probe | Runs | Proves |
|---|---|---|
| `.verify/kaylee-alert-feed.ts` | the real orchestrator, feed and wording against a COPY of `~/.cloudcli/auth.db`; `service` is a recorder; no model call; refuses the live database | 1 non-alert codes deliver nothing · 2 Live off / no page deliver nothing · 3 `background` with its push switch off still reaches her · 4 three alerts = one delivery ~3 s after the first, `warm` once, a repeat delivered once · 5 wording (≤ 5 follow-ups, no spend, `</alert>` stays words) · 6 a throwing listener costs the push nothing · 7 unsubscribe closes an open window unsent |
| `.verify/kaylee-hears-unasked.sh` (starts `.mjs`) | scratch server + Vite on a copy of the database (`SUNSET_SLOT` default 5: API 7903, gateway 7904, client 5295), her model on Haiku, ntfy and web-push endpoints off in the copy; never touches :3011 | permission alert reaches her JSONL within 4 s of the ask's frame and she says it · focus chat's finished run arrives as `<session event="finished">` · Live off: the push still arrives, no alert |

Run the first: `D=$(mktemp -d) && sqlite3 ~/.cloudcli/auth.db ".backup $D/auth.db" && DATABASE_PATH=$D/auth.db TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx .verify/kaylee-alert-feed.ts`. Run the second: `bash .verify/kaylee-hears-unasked.sh`.
- Why a scratch stack: :3011 restarts on every `server/` save by any session, and the dev account's Kaylee is shared by every probe; a run on them is cut short or cleared.
- Trap: "Run date in Bash." raises NO `permission.required` on this box (`~/.claude/settings.json` allows `Bash(*)`); the `.mjs` makes its own project (`<PROBE_PROJECT>-hears`) with a project-level `ask` rule on `Bash(date:*)`.
- Not covered live: the ntfy channel, and the 20 s dedupe (feed probe only).

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/companion-account.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/companion.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/companion-picture.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/companion.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/feeds/alert-block.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/feeds/alert-feed.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/feeds/focus-feed.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/tools/companion-tools.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/tools/tool-deps.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/companion-module.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-alert-feed.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-hears-unasked.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-hears-unasked.sh

## MAN-9070 — server/modules/companion — the service verbs, one account's wiring, the picture — `companion-account.ts` — `createCompanionAccount(userId, runtime)`
section: server/modules/companion — the service verbs, one account's wiring, the picture, the tool registry and deps/002 `companion-account.ts` — `createCompanionAccount(userId, runtime)`

The one place that says which session callback writes which row and sends which frame.
| Session callback | Effect |
|---|---|
| `onSentence` | `kaylee` log line (store sends `companion_sentence`) |
| `onTurnStarted` | `speechCache.startTurn(turnId)` FIRST (the audio of every earlier turn is freed), then the `companion_turn` frame. why: a page pulls sentence 0 the moment its frame arrives (MAN-9111) |
| `onTurnEnded` | `companion_turn` frame |
| `onActivity` | holds the activity, sends `companion_activity` |
| `onProcess` | `companion_process` frame |
| `onSystemLine` | `system` log line |
| `readSettings`, `readState`, `readRoster` (`rosterText`), `readView` | read at push time, never earlier |
| `readSoundTags` | `readVoiceSettings(userId).gemini.soundTags`: read when a turn starts (the parse) and at each push (the register); INV-9938 |

- `readView` = the chat on his screen (`viewOf(userId)`), named for her only if `resolveChat` can resolve it.
- Activity is held here (`currentActivity()`); starts `IDLE_ACTIVITY`.
- `CompanionAccount.speechCache` is made here, one per account (MAN-9111); the speech door reads the floor and the sentences through `store` (MAN-9110).

## `companion-picture.ts` — `buildPicture(account)`
- Shape: `{ settings, models, process, activity, turnId, focus, draft, walk, notes, log, floor }`; `log` = newest 200 rows (store keeps 400).
- The catalog is awaited FIRST, everything else read after it in one synchronous run: no frame lands between two fields.
- Model labels: `COMPANION_MODELS` (`sonnet`, `opus`, `haiku`) matched to `readClaudeModelsDefinition().OPTIONS` by family (`[1m]` suffix ignored); label = the option's `label` as given ("Sonnet 5.5"), else the capitalized family word. why: the catalog has already split the description at ` · `.
- A catalog read that fails is logged (`[Companion] the CLI model catalog could not be read`) and the picker shows the family words.
- `readClaudeModelsDefinition` is exported by `server/modules/providers/index.ts` for this reader.

## `tools/companion-tools.ts`
| Export | Is |
|---|---|
| `COMPANION_MCP_SERVER_NAME` | re-export of `session/companion-launch.ts`; the SDK names a tool `mcp__<name>__<tool>` |
| `COMPANION_TOOL_NAMES` | the thirteen names, `toolNames()` of `session/companion-prompt.ts`: the lines of the prompt's TOOLS section that open `name(` |
| `buildCompanionTools(deps)` | `[...sessionTools(), ...readTools(deps), ...draftTools(deps), ...actTools(deps)]`: the thirteen below |
| `CompanionToolDeps` | what every tool file is handed |
| `ToolActivityPhase` | `CompanionPhase` minus `idle`, `thinking` (the turn's own) |

- The session's `init` check (`unexpectedTools`) compares the CLI's tool list against what is built here.
- `COMPANION_TOOL_NAMES` is the prompt's order (`toolNames()`); `buildCompanionTools` is the file order below. Each tool's description is its prompt line (`toolLine(name)`).

### The thirteen tools
| tool | file | activity while it runs | focus | row |
|---|---|---|---|---|
| `list_sessions`, `list_projects` | `session-tools.ts` | none | none | MAN-9056 |
| `read_session` | `read-tools.ts` | `reading_session` (the chat) | the chat | MAN-9066 |
| `list_followups` | `read-tools.ts` | none | none | MAN-9066 |
| `ask_dactyl` | `read-tools.ts` | `reading_code` (the files) | none | MAN-9066 |
| `show_note` | `draft-tools.ts` | none | none | MAN-9061 |
| `update_draft` | `draft-tools.ts` | `drafting` (the chat; none for a project target) | the chat, after the write, when the target is a session | MAN-9061 |
| `walk` | `draft-tools.ts` | `walking` (the chat, `{ at, total }`) | the chat, on every success | MAN-9061 |
| `send_to_session` | `draft-tools.ts` | `drafting` (the chat) | the chat, after the send | MAN-9072 |
| `create_session` | `draft-tools.ts` | `drafting` (no chat) | the new chat, after the send | MAN-9072 |
| `stop_session`, `rename_session`, `answer_session` | `act-tools.ts` | none | the chat, after the act (a renamed chat under its new name) | MAN-9065 |
- FOCUS IS INFERRED, never a tool: a tool that names a chat calls `deps.setFocus(chat)`, which writes and announces (`companion_focus`) only when the chat moved or was renamed.
- THE DRAFT RULE: only the draft is ever sent. `send_to_session` and `create_session` carry the brief's `text`, and it must equal the draft's words; a mismatch is refused naming the draft's target and its first words, and nothing is sent. Both go through `deps.sendDraft` (MAN-9072); so does the panel's Send.
- A tool never throws: a refusal is `deps.refuse(sentence)` (`isError` text saying what to do next), a handler that throws is logged and answered the same way.

## `tools/tool-deps.ts` — `createToolDeps({ userId, store, runtime, activity })`
| Dep | Does |
|---|---|
| `setFocus(chat)` | writes and announces focus only when the chat moved or was renamed; no focus tool exists |
| `withActivity(phase, chat, files, run)` | sets her activity for as long as `run` takes; a `walking` phase carries `{ at, total }` of the held walk |
| `openChatOnFloor(sessionId)` | emits `companion_open_chat` `{ sessionId, floor }`; nothing while no page holds the floor |
| `refuse(sentence)` | `isError` text saying what to do next; never a throw |
| `sendDraft(request)` | the one door the draft goes out by (`createDraftSender` in `companion-send.ts`, built on `setFocus` and `openChatOnFloor`); `send_to_session`, `create_session` and the panel's Send all call it |

`withActivity` end rule:
1. Each running tool's activity is kept in `running`, oldest first.
2. At a tool's end, the activity changes only if the tool's OWN activity is still the standing one. A stopped turn's `idle` stands; a late tool never repaints her busy.
3. When it changes: to the newest activity still in `running`, else `THINKING_ACTIVITY`.
- 2026-10-26: a tool left running when its turn is stopped keeps its entry until it ends; a later turn's tool ending in that window can briefly show it.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/companion-account.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/companion-picture.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/companion.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/tools/companion-tools.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/tools/tool-deps.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/companion-module.mjs

## MAN-9071 — server/modules/companion — the service verbs, one account's wiring, the picture — Probe
section: server/modules/companion — the service verbs, one account's wiring, the picture, the tool registry and deps/003 Probe

`.verify/companion-module.mjs`: real `createCompanionModule` router on a loopback express app, curl on every request, a real Haiku conversation; 47 checks (settings, message and frames, a `list_sessions` call, picture, refusals, interrupt, clear, live model change, `stop()` mid-turn in 663 ms on 2026-10-26).
```
D=$(mktemp -d /tmp/companion-module.XXXXXX) || exit 1
sqlite3 -readonly ~/.cloudcli/auth.db ".backup '$D/auth.db'" || exit 1
DATABASE_PATH=$D/auth.db CERBERUS_DB_PATH=$D/cerberus.db TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx .verify/companion-module.mjs
```
- Refuses unless `DATABASE_PATH` is under `/tmp`.
- Runs as real account 1: leaves her JSONL under `~/.claude/projects/-home-lyphe--claude-state-companion-1/` (a hidden root).
- Haiku answered "What chats are working?" from the roster in her message without a tool; the probe asks once by name to prove the tool path.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/companion-account.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/companion-picture.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/companion.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/tools/companion-tools.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/tools/tool-deps.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/companion-module.mjs

## MAN-9061 — server/modules/companion/tools — update_draft, show_note and walk: the draft she keeps, her note cards and the walkthrough cursor

`draftTools(deps)` (`draft-tools.ts`) returns the SDK `tool()` definitions of `show_note`, `update_draft`, `walk`, `send_to_session` and `create_session`, in that order. The first three write through the account's store, so `companion_note`, `companion_draft` or `companion_walk` reaches his panel when she calls it; the last two send the draft (MAN-9072). None is `readOnlyHint`. This row covers the first three. Each description is `toolLine(name)`; the argument descriptions carry what the prompt's shorthand leaves out (the prompt's `update_draft(target, …)` is the pair `session` / `project`).

Every handler runs inside `guardedToolResult` (`server/shared/tool-text-result.ts`): a throw is logged `[Companion] <tool> could not <doing>` and answered as `isError` text. A refusal is `deps.refuse(sentence)`.

## `update_draft { session?, project?, text 1–20000 }`
- Exactly one of `session` / `project` (a blank one counts as absent); both or neither is refused with a sentence saying so.
- `session` goes through `resolveChat`, `project` through `resolveProject`; their refusal sentences are passed on.
- `text` is stored EXACTLY as given (no trim): `send_to_session` and `create_session` compare their text with the draft's. A text blank after trim is refused.
- The limit is `DRAFT_TEXT_MAX` imported from `companion-input.ts` and counted in characters as `PUT /draft` counts them (`characterCount`, code points), so the route and the tool accept the same brief and `<n>` below is that count. The schema carries it as a refinement, not `.max`, which counts UTF-16 units and would refuse text the route accepts.
- Writes `{ target, text }` (`companion_draft`), THEN a session target becomes the focus (`deps.setFocus`): a write that fails moves nothing. A project target (`kind: 'new'`, `projectPath`, `projectName`) moves no focus.
- After a compaction `<state>` restates the draft, the names and the walk's items ESCAPED (`&`, `<`, `>` as entities, in `stateEnvelope`): a `</state>` or an `<operator via="typed">` in her text stays words. The stored draft is untouched, so what is sent is exactly what she wrote; only her view of it after a compaction is the escaped spelling (`resolveChat` accepts a name in that spelling).
- Activity `drafting` with that chat (none for a project) while it runs.
- Answers `Draft for <name>: <n> characters.` or `Draft for a new chat in <project>: <n> characters.`

## `show_note { title 1–80, text 1–4000 }`
Both trimmed. One card (`companion_note`); answers `On his panel.` Touches neither draft nor focus.

## `walk { session, items?: 1–60 × 1–120, at: int ≥ 0 }`
One walk per account, held in the store; `<state>` restates it after a compaction.
| Call | Result |
|---|---|
| `at` 0 | ends the HELD walk whichever chat is named, BEFORE any chat is resolved (the walk's chat may be archived or deleted since and could no longer be named): `companion_walk` null, `Walkthrough of <held chat> ended.` The focus follows the chat named only when it can still be named. None held: plain text, not an error |
| `at` 1..n with `items` | starts, or replaces the list (also for another chat than the held walk) |
| `at` 1..n without `items` | moves the held list; a walk held for ANOTHER chat, or none, is refused naming what to do (for another chat: name the held one, give items, or use `at` 0) |
| `at` > n | refused with the count: `at is 4, but the walkthrough has 3 items: …` |
- Each item is one line: a line break in an item is refused (`An item is a short title on one line: no line break.`), because the item is restated on one line in `<state>` and in the answer.
- Answers `Item k of n: <title>.` The chat becomes the focus on every success.
- The walk is WRITTEN BEFORE `withActivity('walking', …)` is entered: the activity's `{ at, total }` is read from the store when it is set. Ending a walk gives `walking` with `walk: null`.
- why the `session` and `items` argument descriptions say he may name the items himself and the chat is the one the conversation has been about: measured 2026-10-26 on Haiku, with a chat already in her conversation and without them she asked "which session?" and never called `walk` (2 of 2 runs); with them, `walk` at 1, 2, 1, null.

## Probe
`.verify/companion-draft-tools.mjs <empty dir under /tmp>`: a probe chat "probe kaylee" made on the live server in `PROBE_PROJECT`, `auth.db` copied after it with `.backup`, the real module on express over the copy, her model set to haiku, then the four typed lines; a direct section calls the tools on the real store for refusals, limits and the cursor. 36 checks on 2026-10-26. Line 1 is typed up to three times until a `companion_draft` frame arrives: Haiku fails it two ways — she passes a part of the name (`"kaylee"` for `probe kaylee`), and, commoner (2 of 4 fresh runs, 2026-10-26), she searches `list_sessions` for "probe kaylee" / "probe" / "kaylee" and never calls `update_draft`, because the probe chat sits in a hidden root that `list_sessions` cannot show while `update_draft` resolves it by its exact name. A turn that never calls the tool is not a defect of the tool.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/session/companion-envelopes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/tools/draft-tools.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/companion-draft-tools.mjs

## MAN-9062 — src/modules/companion — Kaylee's panel, rail door and Settings section: the views, the stance, the status line, the rules and the fixture

## Parts — `src/modules/companion/`

Three surfaces. Each is a VIEW that draws every state from props and a thin wrapper that binds it to the page's picture (provider, reducer, mounting: MAN-9083). Composed from the kit: `Select`, `Switch`, `ConfirmDialog`, `TextArea`, `PromptInput`, `Card`, `Banner` (MAN-569).

| surface | view (all composition) | wrapper | mounted by |
|---|---|---|---|
| her panel | `CompanionPanelView` (`CompanionPanel.tsx`) | `CompanionPanel`: reads `useCompanion()`; `targetWorking` = the draft's target chat is in the page's busy set (`useBusySessionIdSet`) | `WorkspaceFrame`, after the floating chat, ALWAYS rendered |
| her door | `CompanionDoorView` (`CompanionDock.tsx`) | `CompanionDock`: draws it in her rail cell whenever her disc is out of its seat; the door's press is the disc's own (MAN-9125, MAN-9129) | `WorkspaceRail`'s foot, after `UsageRings`, above the Inbox |
| her Settings section | `CompanionSettingsView` (`CompanionSettingsSection.tsx`) | `CompanionSettingsSection`: `useCompanionSettings` fetches `GET /api/companion`, saves `PUT /api/companion/settings`; `useTalkBindingCapture` takes the next key or mouse button when Bind is pressed and saves it as `talkBinding` (MAN-9101) | `VoiceSettingsTab`, after its own sections, voice on or off |

- Parts under the panel: `CompanionHeader` (status line, Stop, close, focus, model `Select`, Live `Switch`, Clear behind a `ConfirmDialog`; given `voice`, a row of its own under them, `CompanionVoiceSwitch`: "Voice on this device", the kit `Switch` closing the row under Clear, a `Volume2` / `VolumeX` glyph following it, the whole row its label), `CompanionLog` (entries newest last; alerts and system lines in their tone; given `speaking`, the one sentence whose `turnId` and `index` both equal `speaking`'s alone wrapped in `[data-companion-speaking-sentence][data-tone=info]`: a band `bg-tone-ink/20` widened by `ring-2 ring-tone-ink/20`, a 2px bar of the full ink in the ring's left edge (`shadow-[-2px_0_0_0] shadow-tone-ink`, the mark's 3:1: 5.3:1 light, 10.3:1 dark against the canvas, where the band alone is 1.32:1 / 1.51:1), `box-decoration-clone`, `forced-colors:underline`; ring and bar are shadows, so no word moves), `CompanionWalkStrip`, `CompanionNotes`, `CompanionDraftCard` (target, editable `TextArea`, Send turn, Send steer, Clear), `CompanionComposer` (`PromptInput`, Enter sends), `CompanionSentence` (her sounds drawn as marks at their offsets), `CompanionSettingsForm` (her name, his name, the register in a monospace `TextArea` with "Restore the original", the delivery note).
- Hooks: `useFollowNewest` (the log follows the newest line until he scrolls up; `jumpToNewest`), `useGrowingField` (textarea sized to its words, measured only while drawn), `useCardFloor` (the draft card's `min-height`), `useTalkBinding(binding, toggle)` (below).
- The talk button's binding (`TalkBinding`, MAN-9086; stored as `CompanionSettings.talkBinding`, MAN-9087):
  - `utils/talkBinding.ts` is the one pure rule, importing nothing but the type. `talkBindingFromEvent(event)` answers `{ binding }`, `{ refusal }` (a sentence that says why) or `null` (a modifier on its own, which starts a chord; a key with no nameable `code`; a mouse button past forward); `matchesTalkBinding(binding, event)` matches a keydown on `code` and all four modifiers exactly, never a `repeat`, and a mousedown on `button`; `isTalkBindingRepeat(binding, event)` is true for the auto-repeat of the bound chord held down; the label is the modifiers in the order Ctrl, Alt, Shift, Meta joined to the key by `+` (`KeyK` → `K`, `Digit1` → `1`; `Space` and `F8` as they are), or `Mouse middle`, `Mouse back`, `Mouse forward`. A change to what may be bound is an edit there (and in the server's `checkTalkBinding`, MAN-9087).
  - `hooks/useTalkBinding.ts` listens on `window` and on `useChatHost().pipWindow` (through the chat-host barrel) in the capture phase, re-binding when the binding or the window changes. A match calls `preventDefault()` and `stopPropagation()` and then `toggle` (read through a ref written in a layout effect, as `useChatHotkey` reads its own). A held chord's repeats never call `toggle` but are swallowed the same way (a held F5 or Ctrl+S is not handed to the browser). A matched mouse button's paired `mouseup` and `auxclick` are swallowed the same way, so the back button records and does not navigate, and its `pointerdown` and `pointerup` are stopped (not prevented: that would cancel the mousedown), so a popover that closes on an outside pointerdown stays open. The pairing is a ref in the hook: it survives a re-bind and a press of any other button between the two halves, and ends at the armed button's auxclick, at its next mousedown, or when the binding goes to `null`; a mouseup or auxclick whose mousedown was passed over is left alone. A `null` and an `undefined` binding (a server that predates the field) both bind nothing. A binding on the chat's own chord (Ctrl or ⌘ with `CHAT_TOGGLE_KEY`) fires both `useChatHotkey` and the talk button: nothing refuses it. While any element in the document carries `data-talk-binding-capture` (Settings, capturing a new binding) every keydown, pointerdown and mousedown is passed over, so pressing the old binding to re-bind does not press the button.
  - Proof: `.verify/kaylee-talk-binding-rule.ts` (the rule under `node --import tsx`) and `.verify/kaylee-talk-binding-hook.mjs` (the hook, mounted on :5183 with trusted key presses and a CDP back button, in the main window and in the picture-in-picture window).
- The talk press: `CompanionTalkButton` (composer slot), `TalkBindingField` (Settings row), `TalkPress` / `TalkPressState` (`src/shared/types.ts`), the status line's Listening and Transcribing, the log's "Nothing heard": MAN-9093. `useTalkPress`, `talk` on the context and the capture: MAN-9101. Proof: MAN-9095, and the whole plan on the live page, MAN-9100.
- `CompanionAvatar` (her drawn face, one SVG keyed by `data-state`, the `--kaylee-mouth` variable): MAN-9124.
- Her disc and her rail cell (`CompanionFab.tsx`, `CompanionDock.tsx`): MAN-9125; what they read from the provider: MAN-9129; proof on the live page: MAN-9130.
- `companion-fake.ts`: fixture pictures (`FAKE_PANEL`, `FAKE_SETTINGS`); only the fixtures import it.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionComposer.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionDraftCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/companion-fake.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionHeader.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionLog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionNotes.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionPanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionSentence.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionSettingsForm.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionSettingsSection.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionVoiceSwitch.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionWalkStrip.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/hooks/useCardFloor.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/hooks/useFollowNewest.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/hooks/useGrowingField.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/hooks/useTalkBinding.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/utils/talkBinding.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/companion-panel-scaffold.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/companion-kit.mjs

## MAN-9089 — src/modules/companion — Kaylee's panel, rail door and Settings section: the — The door: an `aria-label`ed rail button, `data-companion-door`, `aria-expanded` = the open state
section: src/modules/companion — Kaylee's panel, rail door and Settings section: the views, the stance, the status line, the rules and the fixture/001 The door: an `aria-label`ed rail button, `data-companion-door`, `aria-expanded` = the open state

- The door: an `aria-label`ed rail button, `data-companion-door`, `aria-expanded` = the open state; `RAIL_BUTTON_LIT` while the panel is open, `RAIL_BUTTON_UNLIT` at rest. Its words carry `defaultValue`s: it stands in the rail before anything else of hers loads. Its name and tooltip are her name alone (`companion.door.label`, default `{{name}}`), as the rail's views are named for what they show: it opens and closes the panel, so no action word. "Talk to <name>" is the panel's talk button (MAN-9093).
- `CompanionDoorView` is drawn in `CompanionDock.tsx`; `CompanionDockView` draws it in her rail cell whenever her disc is out of its seat (MAN-9125), and its press is the disc's own.
- The palette row ("Talk to Kaylee") and the wiring: MAN-9083.

## Status line (`statusOf`, `CompanionHeader`)
What she is doing is ONE value, `presence` (`CompanionPresence`, `src/shared/types.ts`), built by `useCompanionPresence()` (`hooks/useCompanionPresence.ts`, MAN-9134) from her picture (process and activity), the page's talk press and the page's player, in one order: `cut` > `listening` > `transcribing` > `speaking` > `loading` > `failed` > `asleep` > `waking` > the activity's phase. `CompanionPanel` calls the hook once and hands the value down (`CompanionPanelView presence` → `CompanionHeader presence`). `statusOf(presence)` reads the presence alone and takes no picture: the process is inside the one state (`loading`, `failed`, `asleep`, `waking`), and the button's face and label (`CompanionFab`) read the same value, so the status line and the button cannot disagree. `role="status"`, so a change is announced. Words carry the state; the dot's tone only adds to it.
| state | words | tone |
|---|---|---|
| presence `cut` (`voice.cut`: 900 ms after a talk press stopped her voice) | `Cut` | neutral, still |
| `listening` (his press) | `Listening` | positive, moving |
| `transcribing` (his press) | `Transcribing` | info, moving |
| `speaking` (`voice.speaking`: this page's player sounds a sentence: set at its start, held until the next one starts, `null` only when the player falls silent — MAN-9113) | `Speaking` | info, moving |
| `loading` (no picture yet) | `Loading…` (`companion.panel.loadingStatus`); it stays so after a read has failed (the one state has no word for a failed read: the panel body says it, below) | neutral, moving |
| `failed` (her process failed) | `Stopped · your next message starts her again` (claims no cause; the Banner carries the server's sentence) | warn |
| `asleep` | `Asleep · your next message wakes her` | neutral |
| `waking` | `Waking up` | info, moving |
| `idle` (the activity's phase) | `Idle` | positive |
| `thinking` | `Thinking` | info, moving |
| `reading_session` | `Reading <chat>` (`Reading a chat` with none) | info, moving |
| `reading_code` | `Reading code`; with files `Reading code · a.ts, b.ts` (two named at most), more: `· N files` | info, moving |
| `drafting` | `Drafting for <chat>`; no chat: `Drafting a new chat` | info, moving |
| `walking` | `Walking <chat> · item k of n`; no walk: `Walking a result` | info, moving |
- The page's rows win over every other row, her process's four included. why: an open mic is never hidden. `Cut` wins over `Listening` for its breath; the talk button stays lit the whole time, so the open mic is still shown. Their keys `companion.status.cut` / `.listening` / `.transcribing` / `.speaking` carry `defaultValue`s (`Status.fallback`). Her state returns when the page has none.
- Errors are amber, never red. Row two shows the focus chat while one is held; row three the model picker, Live and Clear; row four, given `voice`, "Voice on this device" (`CompanionVoiceSwitch`, `[data-companion-voice-row]`). why a row of its own: row three has 50px spare on the 400px column and none at 320px, and the switch is this device's where row three's controls are hers on every device.

## Stance — `CompanionPanelView`
| viewport | box | layer |
|---|---|---|
| `lg`+ | 400px column, `lg:inset-y-3 lg:right-3`, `lg:border-input lg:shadow-lift` | `z-[45]`: over the application layer (40), under the rail (50) and the FAB (60) |
| below `lg` | `absolute inset-0` sheet, no radius/border/shadow | `z-[61]`: over the sidebar drawer (50, holds the door) and the FAB (60, sits in the sheet's send lane) |

- Positioned inside the workspace shell's fixed box, not the screen: it already clears the status bar, notch and keyboard.
- Stays MOUNTED while closed (`hidden`): his unsent words and the log's scroll survive. why: render it always, never only when open.
- The panel is `[container-type:size]`: anything placed inside it portals its overlays (a fixed child resolves against the panel). `ConfirmDialog`, menus and toasts already portal.
- Escape: inside the panel it closes and is claimed (`preventDefault`, window capture phase); outside it is untouched. why: the chat aborts its turn on any unclaimed Escape.
- Closing from inside returns focus to the first of `DOOR_SELECTOR` (`[data-companion-door], [data-companion-fab] > .vv-fab`: the rail's door, her disc) that `checkVisibility({ visibilityProperty: true })` finds on screen. why: below md the rail's door stands in the closed drawer under `visibility: hidden`, with an `offsetParent` and a refused focus; her disc in its corner takes it. Opening on `(pointer: fine)` focuses her composer; on touch it does not (no keyboard).
- Height: header and composer stand. Composer field grows to 25% of the panel's height, then scrolls. Log keeps 3.5rem. Dock (walk, notes, draft) is `max-h-[max(55%,23rem)]`, gives way last.
- Dock order of giving way: notes first (floor: first title + ✕ + count), then the draft's field (floor 88px). The dock scrolls only past those floors, the draft card whole inside it.
- A failed process draws a warn `Banner` under the header (the server's sentence) beside the log's system line.
- No picture yet draws the waiting row (`[data-companion-log="loading"]`, a `Spinner`). A read that failed draws, in the log's place, `[data-companion-log="failed"]`: a warn `Banner` — `companion.panel.readFailed` ("Couldn't open {{name}}'s conversation: {{reason}}", the reason being `readFailure`, MAN-9083) — with one Try again (`companion.panel.retry`, the `onReread` prop; absent, no button). Try again gives way to the waiting row while the read is out. Proof: `.verify/kaylee-panel-read-failed.mjs`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionComposer.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionDraftCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/companion-fake.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionHeader.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionLog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionNotes.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionPanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionSentence.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionSettingsForm.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionSettingsSection.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionWalkStrip.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/hooks/useCardFloor.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/hooks/useFollowNewest.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/hooks/useGrowingField.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/companion-panel-scaffold.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/companion-kit.mjs

## MAN-9090 — src/modules/companion — Kaylee's panel, rail door and Settings section: the — Rules later edits keep
section: src/modules/companion — Kaylee's panel, rail door and Settings section: the views, the stance, the status line, the rules and the fixture/002 Rules later edits keep

| rule | why |
|---|---|
| The draft card saves his edit when the field blurs and BEFORE any send. | what is sent is what is on screen |
| `onSendDraft(mode)` rejects with the server's sentence on refusal; the card shows it and keeps everything on screen. | no silent loss |
| Send steer shows only while `targetWorking` and the draft targets a session; then it leads, Send turn follows. Otherwise Send turn alone. | a send to a working chat folds whatever button was pressed, so the two buttons differ in what they SAY |
| Clear memory, Clear draft and Restore the original register each open a `ConfirmDialog` first. | each destroys work |
| Model and Live show his choice at once, restore the old value with a toast on a refused save. | a control that snaps back reads as refused |
| Settings fields save one at a time on blur (inputs also on Enter), trimmed, only when changed and within `LIMITS` (MAN-9087). | "Saved as you change them" |
| The Settings section raising a dialog passes `wrapperClassName="z-[10000]"` to `ConfirmDialog`. | Settings is a body portal at `z-[9999]`; the default `z-50` opens behind it |
| The draft card's rows stay in normal flow, `flex-col`, `justify-content` start; the dock, the card and its wrapper keep `min-h-0`; `useCardFloor` stays. | the floor is measured from the last in-flow row's bottom; only out-of-flow rows (the field's `sr-only` label) are skipped |
| `useCardFloor` writes `min-height` on every render and on a width change with no render (`ResizeObserver` acting only when the width moved, a frame later). | `scrollHeight` lost the card's bottom padding once squeezed |
| The door lights with `RAIL_BUTTON_LIT` and rests with `RAIL_BUTTON_UNLIT` (`src/shared/constants.ts`). | one lit look with the views rail (MAN-9006) |
| Settings text fields take `SETTINGS_FIELD_WIDTH` (`src/shared/constants.ts`). | one width across Settings (MAN-7425) |
| `SettingsSection` and `SettingsCard` come from `@/shared/ui`, never the settings module. | settings → companion → settings loops and breaks HMR |
| Text goes through `t('companion.*')` (`en/common.json`); the Settings section reads `voiceSettings.companion.*` (`en/settings.json`). | |

## Seams
| seam | state |
|---|---|
| The settings save's answer | folded into the picture before the save resolves (MAN-9083) |
| The send's answer | `sendDraft(mode)` resolves with `'started'` or `'folded'`; the card needs no more (the draft clears and the chat opens by their own frames) and shows a refusal's sentence |
| Talk button | `CompanionTalkButton` stands in `PromptInputTools` (`data-companion-talk-slot`) before Send, drawn from the panel's `talk?: TalkPress`; without `talk` the cluster draws nothing and takes no room (MAN-9093) |

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionComposer.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionDraftCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/companion-fake.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionHeader.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionLog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionNotes.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionPanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionSentence.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionSettingsForm.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionSettingsSection.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionWalkStrip.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/hooks/useCardFloor.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/hooks/useFollowNewest.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/hooks/useGrowingField.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/companion-panel-scaffold.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/companion-kit.mjs

## MAN-9091 — src/modules/companion — Kaylee's panel, rail door and Settings section: the — Proof — `.verify/companion-panel-scaffold.mjs`
section: src/modules/companion — Kaylee's panel, rail door and Settings section: the views, the stance, the status line, the rules and the fixture/003 Proof — `.verify/companion-panel-scaffold.mjs`

```bash
node .verify/companion-panel-scaffold.mjs [--states awakeIdle,dense,...] [--evidence <dir>]
```
- Gitignored (`.verify/`): exists on disk only. Live client `:5183`. Exits 1 on any FAIL; zero console errors required.
- Mounts the three VIEWS on `companion-fake.ts` pictures through `lib/companion-kit.mjs`: panel in the workspace shell's fixed box (`.pwa-status-clear.fixed`), door (`CompanionDoorView`, imported from `CompanionDock.tsx`) in the rail's foot above the Inbox, section in a Settings-modal-width column at `z-9999`. Every press is recorded in `window.__companionKit.events`, none acted on.
- Photographs 1440×900 and 390×844, light and dark: states `loading asleepEmpty waking awakeIdle thinking readingSession readingCode drafting walking failed longLog draftWorking draftNew walk notes dense closed`, the door lit and unlit, the Settings states.
- Checks: status line per state; the stance and layers above; no sideways scroll; dock ≤ 55% with the draft whole; Escape claimed inside, ignored outside; draft saved before send; refusals keep words; settings limits; Restore asks first; a short panel (`--keyboard-height` 380px, 390×844) with a draft and a 12-line message cuts nothing; the card keeps its bottom padding, re-checked after narrowing to 320px with no render between.
- 2026-10-28: 275 of 275 checks, zero console errors. The door checks read the fixture's door inside `#companion-door`: below md the live dock draws its own door in the open drawer.
- The script is 297 lines (ceiling 300): any new check goes in `lib/companion-kit.mjs`.
- Fragile against a server restart mid-run.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionComposer.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionDraftCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/companion-fake.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionHeader.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionLog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionNotes.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionPanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionSentence.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionSettingsForm.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionSettingsSection.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionWalkStrip.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/hooks/useCardFloor.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/hooks/useFollowNewest.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/hooks/useGrowingField.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/companion-panel-scaffold.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/companion-kit.mjs

## MAN-9065 — server/modules/companion/tools — stop_session, rename_session and answer_session: acting on a chat through the house's own verbs

`actTools(deps)` (`act-tools.ts`) returns the SDK `tool()` definitions of `stop_session`, `rename_session` and `answer_session`, in the order her prompt lists them. Each does what its page door does, through the house's own verb, so an act of hers and one of his hand leave the same marks. None is `readOnlyHint`; each description is `toolLine(name)`. Each names a chat: it is resolved with `resolveChat` (its refusal sentence is passed on), and after the act it becomes her focus (`deps.setFocus`; a rename carries the NEW name). None sets an activity: each is over in a moment and no `CompanionPhase` says "acting". Every handler runs inside `guardedToolResult`; a refusal is `deps.refuse(sentence)`.

## `stop_session { session }`
`abortChatRun(sessionId, { runtime })` from the websocket barrel — the very verb `chat.abort` calls. `'stopped'` → "Stopped <name>; it is still there."; `'not_running'` → "<name> was not running." The chat stays alive: the run ends aborted, the sidebar spinner drops, the row is not archived.

## `rename_session { session, name 1–60, one line }`
`sessionsService.renameSessionById` (the sidebar's rename door: stores the name and marks it `name_given`, so the namer never replaces it) then `broadcastSessionUpserted`, which draws the name on every open page with no reload. A broadcast that fails is logged and does not fail the rename: the name is stored. What she holds of the chat follows the name: the focus, the draft's target and the walkthrough (`carryRename`), so the panel's draft card and `<state>` never name a chat that `resolveChat` no longer finds by that name. A name another chat of his already carries is stored all the same, and the answer says so, with both chats' ids: `resolveChat` refuses a name two chats share ("fits 2 chats"), so she is told to use ids.

## `answer_session { session, answer 1–2000 }`
Answers the OLDEST pending approval of the chat (`getPendingApprovalsForSession`, by `receivedAt`; the others are counted in the sentence) through `answerChatPermission` — the verb `chat.permission-response` calls. With nothing pending: an `isError` sentence that says so. What the ask would run is shown to her IN FULL where she decides on it — `read_session pending_ask` and `answer_session`'s own sentences (`describeToolInput` in `server/shared/tool-call-hint.ts`: a Bash command whole, a file tool's whole path, any other input as JSON; 600 characters, then a count of what was cut; a line break shows as ` ↵ `) — and `pending_ask` adds the rule an "always" would store. The 60-character `describeToolCall` hint stays for the roster, where a line is scanned. What an answer means to each ask is `ask-decision.ts`'s, and every decision is the page's own:

| ask | answer | decision |
|---|---|---|
| a permission (any tool) | `allow` | `{ allow: true }` |
| | `deny` | `{ allow: false, message: 'User denied tool use' }` |
| | `always` | `{ allow: true, rememberEntry }` and the entry merged into `claudePermissions` |
| `AskUserQuestion`, one question | an option's label, matched case-insensitively (the option's own spelling is sent), else her words; `allow`, `deny` and `always` are refused unless an option is called that, because an answer sent to the chat cannot be taken back | `{ allow: true, updatedInput: { ...input, answers: { [question]: answer } } }` (`AskUserQuestionPanel.tsx`, `handleSubmit`) |
| `AskUserQuestion`, several | — | refused: "answer it in the chat"; the resolver is not called |
| `ExitPlanMode` / `exit_plan_mode` | `allow` | `{ allow: true }` |
| | `deny` | `{ allow: false, message: 'User asked to revise the plan' }` (`PlanDisplay.tsx`) |

Any other word on a permission or a plan is refused with the words that are accepted; a permission's refusal also names the entry `always` would store. `always` on a plan or a question is not an answer.

### "always" is what the page's "Allow and remember" is
- The entry is `buildClaudeToolPermissionEntry(toolName, input)` (`providers/list/claude/claude-tool-permission-entry.ts`, exported by the providers barrel): the tool's name, or `Bash(<first word>:*)`, `Bash(git <sub>:*)`. It is a PORT of the page's `buildClaudeToolPermissionEntry` (`src/modules/chat/utils/chatPermissions.ts`) written beside the runtime's grammar matcher (`matchesToolPermission`, `claude-runtime.provider.js`): the two must stay one rule, so a rule the page wrote and one she wrote are the same string.
- `rememberAllowedTool` (`act-tools.ts`) writes it into the account's `claudePermissions` through `userPreferencesDb`: added to `allowedTools`, removed from `disallowedTools`, every other key of the preference kept (`permissionMode`, `skipPermissions`). A second call for an entry already allowed and not denied writes nothing. Read and write share no `await`, so two chats answered "always" in one tick both land.
- The write comes FIRST and the answer after, as the page does (`handleGrantToolPermission` then `handlePermissionDecision`): a write that fails leaves the ask unanswered and the call can be made again. The decision's `rememberEntry` is what the runtime pushes into the LIVE run's `allowedTools` (`canUseTool`).
- The page reads its preferences once, at sign-in (`hydrateUserPreferences`), and sends its own copy as `toolsSettings` with every turn: a page open before she answered "always" does not know the entry until it reloads, and a Settings save from it writes the preference whole. Her "always" receipt says so: "a page that was already open keeps its old list until it reloads."

## Showing
`.verify/companion-act-direct.mjs <empty dir under /tmp>` (no model call, a copy of `auth.db`): 23 checks on 2026-10-27 — the nothing-pending refusal, the merge over a `disallowedTools` entry with the other keys kept, the no-op second call, two parallel "always", the oldest-ask rule, the two-question refusal, the free answer, both plan decisions, `abortChatRun` on an idle chat, the rename's stored mark and the focus's new name, the zod limits.
`.verify/companion-act-tools-scratch.sh` (`LEGS=` picks legs): Haiku probe chats in permission mode `default`, her model on Haiku, her turns typed in the real panel, her JSONL read back. All five legs passed on 2026-10-27: "Allow it." (the turn finishes), "Always allow it." (`Bash(uname:*)` in `claudePermissions.allowedTools`, then removed through the page's Settings, the row back to what it was), "Answer it: tea." (the reply is "Tea."), "Stop it." five seconds into the seq loop (an aborted `complete` 1.6 s after, the spinner dropped, the row kept), "Call that chat probe acts." (a `session_upserted` carrying the name, the row `probe acts|1`, the name drawn on the page without a reload).

## Gotchas a probe meets
- **This box asks about nothing.** `~/.claude/settings.json` allows `Bash(*)` and the runtime loads the `user`, `project` and `local` setting sources, so "Run date in Bash." raises no permission. An `ask` rule outranks an `allow` rule, so the probe writes `.claude/settings.json` with `ask: ["Bash(date:*)", "Bash(uname:*)"]` in a project of its own. A project's settings apply to EVERY chat launched there: written into the shared `PROBE_PROJECT` it made another session's `date` chat start asking (measured 2026-10-27), so the probe's project is `${PROBE_PROJECT}-act`, removed by unlink and rmdir after.
- **Account 1 has one Kaylee.** Lines typed by two probes on the live server land in one conversation, and her "Stop it." stopped a chat that was not the typist's (her log: "The probe long chat is halted"). The scratch runner gives the probe its own server over a database copy (`scripts/sunset-probe.sh`, slot 6) and a scratch Vite; `/clear` on the copy forgets the live conversation id first, so she never resumes the live JSONL.
- **A plan-runner child's environment reaches the chats.** The scratch server starts every probe chat's CLI with its own environment, and `hooks/runner_never_stop.py` refuses `AskUserQuestion` in any process with `PLAN_RUNNER_CHILD=1`: the ask leg's chat was refused and filed a followup instead of asking. The runner unsets the plan-runner and session-identity variables before it starts the server.
- **A session host outlives its server.** Each chat that raised an ask leaves a keepalive `session-host/host.js <host id> <sessions dir>` with a live Haiku CLI child after the scratch server stops (measured 2026-10-27). The runner ends the slot's hosts (SIGTERM, matched on the slot's own sessions dir as a whole word) before it stops the server.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/tools/act-tools.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/tools/ask-decision.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-tool-permission-entry.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/companion-act-direct.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/companion-act-tools.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/companion-act-tools-scratch.sh

## MAN-9066 — server/modules/companion/tools — read_session, list_followups and ask_dactyl: the scopes, the turn windows and the dactyl path rules

`readTools(deps)` (`read-tools.ts`) returns the SDK `tool()` definitions of `read_session`, `list_followups` and `ask_dactyl`, in that order, after `list_sessions` and `list_projects`. All three carry `readOnlyHint`. Each description is `toolLine(name)`. Every handler runs inside `guardedToolResult` (a throw is logged and answered as `isError` text); a refusal is `deps.refuse(sentence)`. No usage or spend is in any answer (ruling 17).

## `read_session { session, scope }` (both 1–200 characters)
The chat goes through `resolveChat` (an unknown one: its sentence). It becomes her FOCUS, and her activity is `reading_session` with that chat while the tool runs. `scope` is matched without regard to case for `last_turn`, `recent` and `pending_ask`; any other string is a PHRASE.
| scope | Answers |
|---|---|
| `last_turn` | `"<name>", its last turn (<UTC time>):` then `He said:`, `Its reply:` (the reply's text blocks, tool-call lines left out) and `Tool calls in this turn: N`; a running chat adds that the reply may grow. Over 6,000 characters (counted as code points) the turn is rendered alone and a dactyl digest answers instead (`LAST_TURN_DIGEST_BRIEF`). No turn in the history: a chat that never ran says nothing has been said; one with a conversation of its own whose transcript reads empty (file gone) says no turn can be read and to say nothing about what it did. |
| `recent` | the last 10 turns rendered, then a digest (`RECENT_DIGEST_BRIEF`) |
| `pending_ask` | `1. <askLine>` per ask, oldest first, with the first question's option labels (single-question asks); none: `Nothing is waiting on him in "<name>".` |
| a phrase | the turns whose text holds it (case-insensitive, whitespace folded), each with one turn either side, rendered, then a digest (`phraseDigestBrief`); none: `The transcript of "<name>" does not mention "<phrase>".` |
- History is `sessionsService.fetchHistory(id, { limit: null })`, grouped by `groupTurns`.
- A rendered file is the next NUMBERED file of her scratch folder (`0004-last-turn.md`, one past the highest number there, taken in the same tick it is written), then `pruneScratch` keeps the newest 20. The answer ends with the file's path, so a sharper question can go to `ask_dactyl` (her scratch is an allowed root). Its turns carry the CHAT's own numbers (`renderTurnWindow`: `## Turn 8`, the title `10 of 129 turns`), and a gap between non-adjacent windows is marked (`(turns 5 to 7 are not shown here)`).
- What one dactyl takes is bounded: `newestThatFit` weighs each turn as `dactyl` does (UTF-8 bytes + 7 per line) against 300,000 of its 327,680-byte gate (room for the brief and the title). A window over it keeps the NEWEST turns that fit, and the answer says how many older ones were left out and how to reach them. A turn that is over the budget ALONE is set aside by number ("Turn 10 is more than one reader takes and is left out.") and the older turns are still digested; only when EVERY turn of the window is that long does she get an `isError` that there is nothing to digest. The dactyl's own "Read a range of it yourself" refusal therefore never reaches her.
- A chat still running adds "It is still working, so what it has written may grow." to a digest as it does to an inline last turn.
- The dactyl is stopped with the call: both `read_session` and `ask_dactyl` pass the handler's `extra.signal` to `runDactylRead`, which sends SIGTERM (SIGKILL after 5 s) when it fires and answers "The reader was stopped: the call was cancelled."
- A digest that fails answers the dactyl's own sentence plus the file's path; the render is not lost.

## Turn windows (`transcript-turns.ts`)
A turn opens at his text message and holds the reply rows after it; a `<task-notification>` row joins the turn it belongs to, labelled, and is no turn of his. A window of turns is chosen in `transcript-turns.ts` and written by `renderTurnWindow`. `renderTurns` (the whole history under its own numbers) has no tool caller; only `.verify/probe-companion-reads.mjs` calls it. The focus feed writes its reply with `nextScratchFile`. A phrase is searched in his words, the reply's words and its tool-call lines — never the file's headings ("He said", "Tool calls"). `.verify/companion-turn-windows.mjs` runs `groupTurns`/`turnsAround` on real strings; it is pure and touches no file.

## `list_followups { session? }`
`resolveChat` for a given session (it names a chat but moves neither focus nor activity), through the barrel's `listOpenFollowups`. One line each, newest first: `<chat name> · next|gap · <text>`; the text is `Followup.text` untouched, which is what the Next steps widget shows. A named chat is listed whole, as the widget shows it (up to the service's own ceiling of 200, then "These are the newest 200"). Every chat together are cut at 20 (the service is asked for 21 to know), and the last line then says to name one chat. A chat's name is `chatNameOf` (any chat row, archived or hidden too).

## `ask_dactyl { files 1–8, brief 1–4000, context? }`
Every file and the context go through `resolveDactylFiles` (`dactyl-paths.ts`) BEFORE any dactyl starts; one refusal sentence names every file refused, and nothing runs. Her activity is `reading_code` with the real paths. `runDactylRead` runs `dactyl --read <files> --brief - [--context <file>]`; exit 2 or 3 answers its own line as the error; the answer is its stdout (spend lines removed).
**Path rules.** A file must resolve through `realpath` to a regular file under a visible project's path, `~/.claude` or her scratch, and must not be denied. Denied: any path segment (case-insensitive) that starts with `.env`, `credentials`, `secrets`, `id_rsa` or `.claude.json`; ends in `.env`, `.pem`, `.key`, `.p12`, `.pfx`, `.db`, `.token` or `_history`; holds `.sqlite`; is an SSH key name (`id_dsa*`, `id_ecdsa*`, `id_ed25519*`, or any `id_*` with no extension); is one of `.git-credentials`, `.netrc`, `.npmrc`, `.pgpass`, `.pypirc`, `.htpasswd`, `hosts.yml`, `hosts.yaml`, `.ssh`, `.aws`, `.gnupg`, `.kube`, `.docker`; anything under `~/.claude/state/claude_account`; `~/.claude/.credentials.json`; and, by PLACE, anything in a home dot-folder or dotfile other than `~/.claude` (`~/.cloudcli`, `~/.codex`, `~/.openclaw`, `~/.config`, `~/.vscode-server`, …). The place rule is the cure for the shape the names kept missing: applications keep tokens and keys in `~/.<app>/` under names no list predicts (`auth.json`, `agent-host-token`, `device.json`, `openclaw.json` were all reachable 2026-10-27 after the names were widened once). No registered project lives in a home dot-folder, and `~/.claude` stays whole. The name rules remain a net for the other roots (`/home/lyphe` itself and `/opt` are registered projects): the first widening followed a review that found `~/.git-credentials`, `~/.npmrc`, `~/.pgpass`, `gh/hosts.yml`, a `*.env` file, `secrets.local.json`, `~/.bash_history` and `~/.claude.json` reachable. `id_*` is not blanket (an `id_utils.py` passes) because the key names and the extensionless form are what keys are called, and `.ssh` is denied whole. The name is judged FIRST, whether or not the file exists (a missing `.env` is refused as a `.env`), and the resolved path again, so a link named `notes.txt` that points at a `.env` is refused with `(which is …)`. `~/` is the home folder; a name that is not a full path (`server/shared/prompt-stream.ts`) is looked for under the visible projects — one holder is the file, none or several is a sentence. The files handed to the dactyl are the REAL paths that were judged. The argument description says nothing about secrets on purpose: measured 2026-10-27, with "refused by name" in it Haiku declined the `.env` itself and never called the tool; without it she calls, and the tool's refusal (naming `.env`, "no dactyl was started") is what she relays.

## Probes
`.verify/companion-read-tools.mjs <empty dir under /tmp>`: two Haiku probe chats in `PROBE_PROJECT` ("probe long": a short turn then 120 lines; "probe kaylee": one short turn and one follow-up through the command door), her panel opened on :5183 on Haiku, the four typed lines with the status words, tool calls and results read from her JSONL, the `dactyl --session-status` hand count around the `.env` line; then every scope and the path-rule matrix called directly on a snapshot of `auth.db`. 57 checks passed on 2026-10-27 before the review fixes added matrix names and changed the long-turn check; it has not been re-run live since. Chats are made just before their first turn and remade (up to 3 times) when the CLI answers "No conversation found": a chat that completes with `provider_session_id` equal to its own id never reached the provider, measured twice right after a server handover; and `resolveChat` then cannot find it (his chats exclude `session_id = provider_session_id`). A long reply is asked as numbered lines: "the word lorem repeated 1500 times" did not finish in 170 s on Haiku. Account 1 (`verve`) is the dev account every live probe types to, so another soul's probe can write into her conversation, draft and model mid-run (measured 2026-10-27: a `send_to_session` to another probe's chat came out of this one's turn); the probe prints CONTAMINATED when an operator line in her log is not its own.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/tools/dactyl-paths.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/tools/read-tools.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/tools/transcript-render.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/tools/transcript-turns.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/companion-read-tools.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/companion-turn-windows.mjs

## MAN-9067 — server/modules/chat-names — the naming pass: the trigger, the five questions, the write, the Haiku call, the sayable rule

Gives an app chat a name a person could say aloud, once a turn of it has ended. Writes `sessions.custom_name`, never `name_given` (MAN-9060, INV-9787). Edits that break it: INV-9817. `server/index.ts` builds it (`createChatNamer()`), calls `chatNamer.start()` in the listen callback after `startRunStallWatchdog()`, and `await chatNamer.stop()` in `shutdownRuntimeServices`.

## Files
| file | owns |
| --- | --- |
| `index.ts` | exports `createChatNamer` only |
| `chat-namer.service.ts` | `createChatNamer(): { start(): void; stop(): Promise<void> }` — the trigger, the five questions, the write |
| `first-exchange.ts` | `readFirstExchange(sessionId)` → `ChatFirstExchange { ask, reply }` or `null` |
| `haiku-name.ts` | `askHaikuForName(exchange, signal)` → a cleaned name or `null`; never rejects |
| `sayable-name.ts` | `isSayableName(name)` — one rule, applied to the chat's current name and to Haiku's answer |

## Trigger — `chatRunRegistry.onRunCompleted`
No timer, no boot sweep: a chat that already holds an unsayable name is named at its next turn. why: the house names its events, it does not poll.

| completion | the namer |
| --- | --- |
| `aborted` (Stop pressed) | skips |
| `alreadyRecorded` (a re-adopted host whose turn ended before this process began) | skips: a boot or a handover names nothing |
| any other | `considerChat` on a microtask; the listener answers synchronously and never holds a completion |

`start()` twice is a no-op. `stop()` unsubscribes, aborts every pass in flight (the Haiku child ends with it) and awaits them with `Promise.allSettled`.

## The five questions — cheapest first; Haiku is asked only when all pass
| # | question | read from |
| --- | --- | --- |
| 1 | an app chat, not archived | `sessionsDb.nameFactsOf`: `appCreated`, `isArchived`; `null` (no row) stops |
| 2 | `name_given` still 0 | `nameFactsOf.nameGiven` |
| 3 | the current name fails `isSayableName` | `nameFactsOf.customName` |
| 4 | neither in flight nor already tried by this process | `inFlight` (`Map<sessionId, Promise<void>>`), `attempted` (`Set`) |
| 5 | the transcript holds a first exchange | `readFirstExchange` non-`null` |

- Questions 1 to 4 are synchronous and claim the chat in one step (`inFlight.set`), so two completions never start two passes.
- A project's visibility is no question: a probe chat in `PROBE_PROJECT` (a hidden root under `/tmp`) is named like any other.
- `attempted` is filled at question 5's yes: one Haiku try per chat per process, whatever the answer; a restart allows one more. A chat with nothing to read yet is asked again at its next turn.

## The write
1. `askHaikuForName` → `null`: log `[Chat names] <id> was not named this time; it keeps "<name>"`, write nothing.
2. Re-read `nameFactsOf`, no `await` between this read and step 3:
   - `null`: log `was deleted while Haiku was answering; "<name>" is not written`.
   - `nameGiven` set or `customName` no longer the name that failed question 3: log `was renamed while Haiku was answering; "<name>" is not written`.
3. `sessionsDb.updateSessionCustomName(id, name)` — never `renameByPerson`. Log `[Chat names] named <id> "<name>" (was "<old>")`.
4. `broadcastSessionUpserted(id)` — the frame the sidebar, the simple list, the floating chat's picker, the notifications and Kaylee's roster redraw on. A send failure is logged; the name stays written.

A pass that throws logs `the pass for <id> failed; the chat keeps its name: <reason>`.
Read the log: `journalctl -u cloudcli-server-dev | grep '\[Chat names\]'`. Every line carries the session id.

## `readFirstExchange`
Reads `sessionsService.fetchHistory(id, { limit: null })` — the rows the person sees. Rejects when the chat is gone or its transcript cannot be read.

| side | taken |
| --- | --- |
| `ask` | the first user `text` row he wrote: non-empty, not starting `<system-reminder>` or `<task-notification>`; a slash command he typed counts |
| `reply` | the first assistant `text` row after it: non-empty, not `isCompactSummary`, not `isLocalCommandStdout`, not `model === '<synthetic>'` |

Each side is cut to 2,000 characters (`MOST_CHARACTERS_PER_SIDE`) without splitting a surrogate pair. `null` when the transcript holds no such pair.

## `askHaikuForName`
One `query()`, one turn, no session of its own.

| option | value |
| --- | --- |
| `model` | `'haiku'` |
| `systemPrompt` | `NAMING_SYSTEM_PROMPT`, verbatim below |
| `tools` / `settingSources` / `strictMcpConfig` | `[]` / `[]` / `true` |
| `settings` | `{ autoMemoryEnabled: false }` |
| `persistSession` / `maxTurns` | `false` / `1` |
| `cwd` | `~/.claude/state/chat-names`, made on demand: a hidden root, so a stray launch is in no project list |
| `env` | `userFacingEnv()` plus `launchAccountEnv().env` |
| `pathToClaudeCodeExecutable` | `resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH)`, passed when it resolves |
| prompt | `FIRST MESSAGE:\n<ask>\n\nFIRST REPLY:\n<reply>` |
| bound | `NAMING_TIMEOUT_MS` = 30 s, and the namer's `signal` |
| init check | the CLI's `system`/`init` message lists its `tools`; any entry ends the pass with `null` |

`NAMING_SYSTEM_PROMPT`, verbatim:
```text
You name a chat session for a person who refers to it aloud. Read the session's first message and first reply, and answer with a name of two to four plain words saying what the chat is about, the way a person would call it in conversation, for example Kanban board, Login fix, Estimate drafts. No punctuation, no quotes, no emoji, no file names, no paths, no slash commands. Reply with the name only.
```

Returns `null` and writes nothing, each with one `[Chat names]` line, when: the SDK fails; 30 s pass; `signal` fires; the CLI's init message lists any tool; the result is not `subtype === 'success'` or has `is_error`; the cleaned reply fails the check.

`cleanedName(reply)`:
1. refuse a reply of several lines or holding an emoji (`\p{Extended_Pictographic}`);
2. drop outer quote marks and trailing punctuation, repeatedly; collapse spaces; capitalize the first letter;
3. accept only 2 to 4 words (`FEWEST_NAME_WORDS`, `MOST_NAME_WORDS`) that pass `isSayableName`.

`countWords(name)` (`sayable-name.ts`) is the count: a token between spaces is one word ("Login-fix" is 1), except a token holding Han, Kana, Thai, Lao, Khmer or Myanmar letters, which `Intl.Segmenter` (ICU's word dictionaries) divides ("看板ボード" is 2, "見積書の下書き" is 4). The dictionary divides finer than a reader hears ("数据库连接排查" counts 5 and reads as 3), so a name with a letter in such a script may count one over: `SEGMENT_COUNT_OVERRUN`, 2 to 5. `isSayableName` below is unchanged and still reads a current name by its whitespace tokens: a Japanese first message with no space in it is one token there, kept or replaced by its 40 characters alone.

## `isSayableName(name)` — true when, after `trim()`, all six hold
1. 1 to 5 words (whitespace split);
2. at most 40 characters;
3. the first character is a letter or a digit (`\p{L}`, `\p{N}`);
4. none of `/ # \ < > { } [ ] | * _ ~`, a backtick or `"`;
5. not matching `/^untitled\b/i`;
6. not UUID-shaped (`8-4-4-4-12` hex digits).

`null`, `undefined` and `""` are not sayable. why: the names he gave pass; slash commands, placeholders and prompts fail. A new chat is named with its first message's first four words (`buildCloudCliSessionName`, `sessions.service.ts`), so "Help me plan a" passes: the rule asks whether the name can be spoken, not whether it says anything.

2026-10-27, under `tsx`, strings read from the live `sessions.custom_name`:

| name | verdict | fails |
| --- | --- | --- |
| `Live mode` | true | |
| `PM flow` | true | |
| `Fix every broken sign-in` | true | |
| `Photo Evidence Cooberator` | true | |
| `Help me plan a` | true | |
| `/git` | false | 3, 4 |
| `/upload STEVEN KENDALL` | false | 3, 4 |
| `Untitled Session` | false | 5 |
| `# day-one-sketch-from-panos — phase 3: …` (120 characters, 19 words) | false | 1, 2, 3, 4 |
| ``TASK: reply with exactly one line: `claude answered`. Nothing else, no tools.`` (12 words, 77 characters) | false | 1, 2, 4 |

## Prove it
`TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx .verify/chat-names-unspaced.mjs` → `ALL PASS`: `countWords` on twelve names, then `askHaikuForName` on a Japanese, a Chinese, a Thai and an English exchange (four Haiku calls, no chat made). 2026-10-28, 22 Haiku answers to Japanese, Chinese and Thai exchanges: before `countWords` every answer in those scripts was refused (Haiku answered in the chat's language for about half of the 22 and in English for the rest); after, 22 of 22 named, the longest counting 5.

`node .verify/chat-namer-live.mjs` → `ALL PASS`. Every turn is on Haiku in `PROBE_PROJECT` (under `/tmp`, a hidden root), chats deleted after.

| leg | shows |
| --- | --- |
| A | first turn: "Untitled Session" becomes a name, `name_given` 0, unchanged 10 s later; renamed by hand: `name_given` 1, a second turn leaves it and logs no `[Chat names]` line |
| B | a sayable `initialMessage`: no `[Chat names]` line for the id |
| C | a rename sent at `complete` wins: `was renamed while Haiku was answering` |

A probe chat is in no sidebar list (`visibleProjectPathSql` leaves a hidden root out) and its `session_upserted` frame carries `project: null`, which the page's project store drops: the leg reads the frame off the page's websocket instead.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/chat-names/chat-namer.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/chat-names/first-exchange.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/chat-names/haiku-name.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/chat-names/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/chat-names/sayable-name.ts

## MAN-9072 — server/modules/companion — the send: `companion-send.ts` and `tools/send-options.ts`, what a draft checks, runs, records and clears

The one place a draft goes out. Callers: the panel's Send (`POST /draft/send` → `companionService.sendDraft` → `account.sendDraft`), her `send_to_session` and `create_session` (`tools/draft-tools.ts`). The DRAFT is the only thing sent. One sender per account: `createDraftSender({ userId, store, runtime, setFocus, openChatOnFloor })`, built in `tools/tool-deps.ts`.

## Request and answer
| name | shape |
|---|---|
| `DraftSendRequest` | `{ mode: 'turn' \| 'steer', text?, chat?, newChat?: { projectPath, title } }` |
| `DraftSendOutcome` | `{ outcome: 'started' \| 'folded' \| 'refused', sentence }`; `sentence` is what she tells him, or the card shows |

A refusal keeps the draft. `send_to_session` passes `text` and `chat`; `create_session` passes `text` and `newChat` with `mode: 'turn'`; the panel passes `mode` alone.

## Checks, in order (each a `refused`)
1. A send already going out for this account (`sending`): one at a time. why: she calls tools in parallel and two pages can press Send; a second read of the draft before the first cleared it would send it twice.
2. No draft held; a draft blank after trim.
3. `text` given and not the draft's words, trimmed.
4. `chat` given and the draft is not for that session.
5. `newChat` given and the draft is not for a new chat in that `projectPath`.

Refusals 3 to 5 name the draft: its target and its first 160 code points, on one line (`describeDraft`). Nothing reaches a chat that was not on his screen first.

## To a chat (`sendToChat`)
| when | does | outcome |
|---|---|---|
| the row is missing or archived | nothing sent | `refused` |
| `chatRunRegistry.isProcessing` and `steerChatRun` answers `'folded'` | folds the brief into the running turn, whichever `mode` was asked; the echo goes onto that run's writer | `folded` |
| idle, or the fold found no turn | `runDetachedChatTurn` with `sendOptionsFor` and, for a Claude chat, a `messageUuid` (`randomUUID()`); its `beforeRun` hook writes the echo and records the send; the verb waits for the run to have STARTED, never for the turn | `started`; `refused` when the door refused or the hook never ran |

- `folded` means pushed, not "the turn changed course": MAN-9068. The sentence says the brief is taken at the next tool step or runs as its own turn after the turn finishes.
- A `steer` to an idle chat starts a turn; its sentence says so.
- Echo: a user text row `local_kaylee_<uuid>`, `spokenVia: 'kaylee'`; the page swaps it for the persisted row, which the history read marks again.
- Every send is recorded: `relayedSendsDb.record(sessionId, 'turn' \| 'steer', words, messageUuid)`. `messageUuid` is the uuid the turn stamped on its message, which the CLI keeps as the transcript row's own; `null` for a steer and for a chat of another provider (only the Claude runtime reads `options.messageUuid`). The history mark follows that row by uuid, else by words (MAN-9084). A failed write is logged (`[Companion] a send could not be recorded…`) and never costs the send.

## To a new chat (`sendToNewChat`)
1. Unless the project belongs to a node (`projectsDb.nodeForPath` non-null), `diagnoseProjectFolder`: a folder that is gone or not a folder is a `refused` BEFORE anything is made.
2. `sessionsService.createAppSession('claude', projectPath, words, true)`: on the simple list, as the page's New chat makes one.
3. With a title, `sessionsDb.updateSessionCustomName` alone: `name_given` stays 0, the namer may replace it (INV-9787).
4. `broadcastSessionUpserted`; a failure is logged and the send goes on.
5. `sendOptionsFor(userId, null, 'claude', { focusSessionId, name })`, then the turn. A first message that did not start is a `refused` that says the chat exists.

## After a send
- The draft clears only if `draft.updatedAt` is still the one that went: a rewrite made while the send was out is the next brief.
- The chat becomes her focus (`setFocus`) and the page that holds the floor opens it (`openChatOnFloor`: the `companion_open_chat` frame, to the floor's client id only).

## Options — `sendOptionsFor(userId, sessionId, provider, newChat?)` → `ChatSendOptions`
Read as the chat's own composer would read them. An option the source records none of is LEFT OUT, never defaulted.
| option | existing chat | new chat (`sessionId` null) |
|---|---|---|
| `model`, `effort` | the row's, when it records a model and its `provider` equals this one | the focus chat's (`NewChatBasis.focusSessionId`, same provider, has a model), else `sessionsDb.latestModelChoice(provider)` |
| `permissionMode` | the row's `permission_mode`; none recorded → left out, the chat runs on the default | `sessionsDb.latestPermissionMode(provider)` |
| `toolsSettings`, `skipPermissions` | `userPreferencesDb.getPreferences(userId)[`${provider}Permissions`]` read AT THE SEND; not a record → `{ allowedTools: [], disallowedTools: [], skipPermissions: false }` | same |
| `sessionSummary` | the row's `custom_name`, else `''` | the title, else the name `createAppSession` gave |

- A permission mode is never borrowed for a chat that exists. why: a probe chat whose chip reads "Ask before every edit" ran in bypass when the last chat he used had bypass.
- `latestModelChoice` and `latestPermissionMode` narrow to the provider. why: a model id or mode is a provider's own word; a Codex model handed to a Claude chat fails its first turn.
- Measured 2026-10-27 (scratch copy): a new chat recorded `bypassPermissions` (the newest chat's) while its composer chip read "Ask before every edit"; they agree after his first typed send.

## Open (operator rulings pending)
- A new chat takes the newest chat's permission mode and model across accounts (`sessions` has no user column).
- A refused panel press still takes the floor (`companionService.sendDraft` takes it before the send).
- `POST /draft/send` carries no `updatedAt`: it sends the draft held at the press.

## Probe
`.verify/companion-send.mjs` legs `steer,idle,create,mismatch,panel`; `.verify/companion-send-scratch.sh` runs them on a scratch server over a copy of the database (the live box has one Kaylee shared by everyone at work).

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/companion-send.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/tools/send-options.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/companion-send.mjs

## MAN-9077 — server/modules/companion/session — her launch: the options, the hidden working directory, persistence and resume, the idle close, setModel live

One launch of her CLI = one streaming-input `query()`. `companionQueryOptions(userId, settings, tools, providerSessionId)` (`session/companion-launch.ts`) builds its options; `launchCompanionCli(input)` (`session/companion-process.ts`) runs it. She is built like the Cerberus diagnosis agent (`cerberus/diagnosis/diagnosis-agent.ts`). What a CLI message means: the conversation row (`companion-events.ts`).

## Options
| option | value | why |
|---|---|---|
| `model` | `settings.model` (`sonnet` \| `opus` \| `haiku`) | read when the launch begins |
| `systemPrompt` | `fillSystemPrompt(settings.operatorName)`, a plain string | never the Claude Code preset: no house rule, CLAUDE.md or skill reaches her |
| `settingSources` | `[]` | nothing on disk widens what she may do |
| `settings` | `{ autoMemoryEnabled: false }` | the CLI keys auto-memory (`MEMORY.md`, his standing rules) to the git root of the cwd; hers sits inside `~/.claude` |
| `tools` | `[]` | no built-in tool: no shell, edit or web |
| `mcpServers` | `{ companion: createSdkMcpServer({ name: 'companion', tools }) }` | her thirteen tools, in-process |
| `strictMcpConfig` | `true` | his own MCP servers (`~/.claude.json`) are not loaded |
| `allowedTools` | each tool's name under `mcp__companion__` | exactly hers, so a tool is never one prompt away |
| `includePartialMessages` | `true` | text deltas feed the sentence stream |
| `maxTurns` | 30 | per turn of hers: one answer to him, every tool call inside it |
| `cwd` | `companionWorkingDirectory(userId)` | below |
| `env` | `{ ...userFacingEnv(), ...(await launchAccountEnv()).env }` | the account the house chose, on the subscription |
| `pathToClaudeCodeExecutable` | `resolveClaudeCodeExecutablePath(CLAUDE_CLI_PATH)`; key absent when it does not resolve | |
| `resume` | the held CLI session id; key ABSENT for a fresh launch, never empty | |

- `persistSession` is left on: her conversation is a JSONL the next launch resumes.
- `COMPANION_MCP_SERVER_NAME = 'companion'` is defined in `companion-launch.ts` and re-exported by `tools/companion-tools.ts`: one spelling.
- Init check: every `system`/`init` (it arrives at the start of EVERY turn) passes `unexpectedTools(listed, tools)`. A CLI tool that is not one of hers fails the launch before the model sees a turn: `Her session held tools it should not have (<names>), so it was not run.`

## Working directory
- `~/.claude/state/companion/<user id>`, made at launch if absent; one per account. Nothing is read from it.
- It sits under a hidden project root (`server/shared/hidden-project-paths.ts`): her conversation never reaches a project list, and the heal reads her turns as a program's, never as the operator's correction (INV-4352).
- Her JSONL: `~/.claude/projects/-home-lyphe--claude-state-companion-<user id>/`.

## Persistence and resume
| step | does |
|---|---|
| first `init` of a launch, and any `init` whose `session_id` differs from the held one | `writeProviderSessionId(id)` → `companion_state.provider_session_id` |
| next launch | `resumeForLaunch()`: `resumableSessionId(held)` → `resume`; the memory is the CLI's own JSONL |
| server restart | nothing held in memory matters: her next message launches with `resume` and her memory is back |
| held id not UUID-shaped | `resumableSessionId` answers `null`; warn `[Companion] account <id>: the held session id is not a UUID; she starts fresh`. why: the CLI refuses a non-UUID with a plain failure, not "No conversation found", so it would fail every push for ever |
| held id the CLI has no conversation for | the refused-resume fallback: conversation row |
| Clear | writes `null`; conversation row |

## The idle close
- `createIdleCloser` of `server/shared/prompt-stream.ts` (MAN-9078 for its rules), `idleMs: resolveIdleCloseMs(undefined)`: `CLAUDE_CHAT_IDLE_CLOSE_MS` when set and ≥ 5 s, never above 2 h, else `DEFAULT_IDLE_CLOSE_MS` = 2 h.
- The clock is silence since the last MESSAGE: `CompanionCli.push` calls `idle.touch()`. It is armed when the launch is created, so a `warm` launch that gets no message also closes after the window.
- `isBusy` = a turn in flight (`turns.turnId !== null`); she has no background task and no watcher. Busy at the window: log `idle window reached after N min, but a turn is in flight; asking again in a minute`, re-asked every 60 s.
- Closed idle: log `closing her idle process after N min without a message`, `onIdleClose` → the session's `closeProcess('idle')` → she is `asleep`. The memory stays; the next push resumes it.

## `setModel` live
| when | does |
|---|---|
| process up | `conversation.setModel(model)`, bounded by `CLI_GRACE_MS` = 5 s; no answer = throws `her CLI did not answer a switch to <model> within 5 s` |
| launch under way (options being built) | remembered as `wantedModel`; applied once the query exists, if it differs from the launch's model; a failure is logged `the model change made while she woke was not applied` |
| no process | nothing to apply: the next launch reads the stored model |
- No relaunch, no lost memory: the conversation continues on the new model. `companionService.saveSettings` calls it on a model change; a throw becomes the system line `She could not switch to <model> while awake; she will use it the next time she wakes.` and the save stands.

## Ending a launch (`CompanionCli`)
| verb | does |
|---|---|
| `push(message)` | queues the message, restarts the idle clock |
| `interrupt()` | `conversation.interrupt()`, answer within 5 s → `{ stillQueued: string[] }`; silence or a failure → `'unanswered'` (the session then closes the process: a CLI that ignores a Stop would ignore the next message) |
| `close()` | cancels the clock, `queue.end()` (EOF = wind down), waits up to 5 s for the loop, then `conversation.close()` |
| `kill()` | cancels the clock, ends the queue, `conversation.close()` now |
- Once ended by us (`close`, `kill`, the idle closer) the launch reports NOTHING more: its messages are drained unheard and `onEnded` fires only for a loop that ended by itself. The queue never ends on its own: why, in the prompt-stream row.

## Proof
`.verify/kaylee-session.mjs` (run under `tsx`, account 999, Haiku, stand-in callbacks): init check, hello, memory across a message, `setModel` sonnet then haiku with no relaunch, resume after close, refused resume, Stop.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/session/companion-launch.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/session/companion-process.ts

## MAN-9079 — server/modules/companion/session — her conversation: the process states, the loop's events, which result ends a turn, the refused resume, Clear and Stop

`createCompanionSession(deps)` (`session/companion-session.ts`) is one account's live conversation; `companion-account.ts` builds it (MAN-9070). The session reads nothing itself: `CompanionSessionDeps` (`companion-session-types.ts`) hands it the readers (`MessageReaders`), the sinks (`TurnSink`) and the held CLI session id. Launch: MAN-9077. Message order: MAN-9080. Sentence stream: MAN-9081.

## `CompanionSession` surface
| member | does |
|---|---|
| `pushOperator(text, via)` / `pushOperatorEmpty()` / `pushAlerts(blocks)` / `pushFocusNews(envelope)` | assemble ONE message, start a turn if she is idle, wake a closed process. `pushAlerts([])` pushes nothing |
| `warm()` | opens a launch with no message, so the CLI's ~1 s start is spent while a caller waits (the alert feed's gather window). No-op while a launch exists |
| `oweCut(heard: string \| null, interrupted: string \| null)` | the next message opens with `<cut heard interrupted/>` (MAN-9080). Called by the companion's `cut` before it awaits `interrupt()` (MAN-9111). `pushOperator(…, 'spoken')` and `pushOperatorEmpty()` (`<operator via="spoken" heard="nothing"></operator>`, a press that carried no words) are the press door's (`companion-press.ts`, MAN-9059) |
| `interrupt()` | her Stop: below |
| `setModel(model)` | `live?.cli.setModel`; MAN-9077 |
| `clear()` | below |
| `close(reason)` | `closeProcess`: detach, then `cli.close()` |
| `process`, `turnId` | the condition the panel shows; the turn in flight or `null` |

## Process states (`CompanionProcess`)
| `state` | set when |
|---|---|
| `asleep` | start; `detach` (idle close, Clear, `close`) |
| `waking` | a launch opens, until its first `init` |
| `awake` | the launch's first `init` passed the tool check; log `[Companion] account <id>: started\|resumed session <id> on <model>; the CLI listed N tools, all hers` |
| `failed` | `fail(launch, sentence)`: tool check, a failed result, a thrown loop, a loop that ended by itself. `error` = the sentence |
- A failure of her own is a system log line and a panel banner, NEVER something she says (ruling 17): the failure text is a synthetic assistant message, not stream deltas, so the sentence stream never sees it.
- `fail` kills the launch, forgets `unanswered`, ends the turn `failed`, sets `failed`, writes the system line. The next push launches again.
- A callback that throws is caught by `guarded(label, userId, fn)` (`guarded-callback.ts`): `[Companion] account <id>: the <label> callback threw`; the conversation goes on.

## The loop's events (`readLoopEvent`, pure)
| CLI message | event | session does |
|---|---|---|
| `system`/`init` | `init { sessionId, tools, model }` | tool check; store `session_id` when it differs from the held one; first of a launch = `awake` |
| `stream_event` `content_block_delta` `text_delta`, `parent_tool_use_id` null | `text { delta }` | `turns.text` → sentence stream |
| `stream_event` `content_block_stop` | `block_end` | flush the stream: a block ends with no whitespace after its last sentence |
| `system`/`compact_boundary` | `compacted` | `assembler.oweState()` |
| `result` | `result { answered, failure, resumeRefused }` | below |
| anything else, thinking and tool-input deltas, a sub-agent's deltas | none | |
- `answered` = `user_message_uuids`, else `[user_message_uuid]`, else `[]`.
- `failure`: `success` + `is_error` → `Her answer failed: <result>`; `error_max_turns` → `Her turn ran out of steps before she finished.`; any other subtype → `Her answer failed: <errors>`. A refused resume has `failure: null`.
- `failureSentence(lead, reason)`: whitespace collapsed; sentences of developer advice dropped (`Run --…`, `Please ensure…`, `Usage:…`, anything naming `options.<x>`; INV-7173); exactly one closing period.
- Measured 2026-10-26 (live CLI, streaming input, Haiku): `init` arrives at the start of EVERY turn with the same `session_id`; `result` lists in `user_message_uuids` every message of ours the turn took, a mid-turn fold included.

## Which result ends which turn (`createTurnTracker`)
- A turn starts when a message is pushed while she is idle (`admit`): `onTurnStarted(turnId)` and activity `thinking`. A message pushed mid-turn joins it.
- Every pushed message carries a uuid; the tracker remembers which turn it went into.
| `result` lists | meaning |
|---|---|
| a uuid of the turn in flight | ends it `answered` (`failure` null) or `failed` |
| only uuids of a turn already stopped | `stale`: that turn's late answer; ends nothing |
| no uuid | read as the turn in flight's (the CLI's startup failures) |
- A message the ended turn did not consume starts the next turn at once, so the panel never shows her speaking outside a turn.
- Each sentence carries `turnId` and `index` (from 0; counts only sentences `parseExpression` kept). A stopped or failed turn drops its buffered half-sentence.
- At a turn's end: `onTurnEnded(turnId, outcome, error)`, then activity `idle` unless the callback pushed and began the next turn.
- `THINKING_ACTIVITY` and `IDLE_ACTIVITY` are exported for `companion-account.ts`.

## Stop (`interrupt`)
1. `turns.stop()` ends the turn `stopped`; none in flight = nothing else happens.
2. Launch still being built (`!cli.up`) → `closeProcess('stopped before her process was up')`.
3. `cli.interrupt()`; `'unanswered'` → `closeProcess('her process did not answer the interrupt')`.
4. Answered → `turns.adopt(stillQueued)`: messages queued behind the stopped turn run as a turn of their own.

## The refused resume
- Seen as a `result` whose errors match `/No conversation found with session ID/i` (then the iterator throws), or a thrown error matching `/No conversation found/i`.
- Does: kill the launch; `writeProviderSessionId(null)`; system line `Her memory could not be resumed; she starts fresh`; `assembler.oweState()` (focus, draft, walk went with the conversation); ONE new launch with no `resume`, carrying `unanswered`. Log `[Companion] account <id>: the CLI has no conversation <id>; she starts fresh`.
- A refusal in any other wording is a `failed`; a held id that is not UUID-shaped never gets that far (`resumableSessionId`, MAN-9077).

## Clear (`clear`)
1. `writeProviderSessionId(null)` and `assembler.forget()` BEFORE anything is awaited.
2. `detach('cleared')` takes the launch out of the conversation synchronously and sets `asleep`. why: a push landing during the wind-down is a wake into a fresh conversation, never a resume of the one being cleared.
3. A turn in flight is interrupted now; `cli.close()` is awaited.
4. A push that already woke a new launch is not overwritten.
The rows go with it: MAN-9059 §Clear.

## Proof
`.verify/kaylee-session.mjs` (`--pure` for the steps with no model call): stand-in callbacks print each event; steps init, hello, memory, model, resume, refused, stop.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/session/companion-events.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/session/companion-session.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/session/companion-session-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/session/companion-turns.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/session/guarded-callback.ts

## MAN-9080 — server/modules/companion/session — what she is pushed: the order of a message and when each part is sent, the envelopes, the prompt and register fills

Every message to her is assembled at the moment it is pushed (`createMessageAssembler`, `session/companion-message.ts`) and nothing reaches her silently. Envelope builders: `session/companion-envelopes.ts` (pure). Texts and fills: `session/companion-prompt.ts` (pure).

## Order of one message
| # | part | sent when |
|---|---|---|
| 1 | `<state>` | owed once after `compact_boundary` and after a refused resume; lines `Focus: <name> · <project> · id <id>`, `Draft for <target>: <text>`, `Walkthrough of <name>: item k of n, "<title>"; items: 1. … 2. …` (`not begun` at 0), each only when held; nothing at all when none is held |
| 2 | `<cut heard="…" interrupted="…"/>` | owed once after `oweCut(heard, interrupted)`, called by the companion's `cut` (`POST /cut`, MAN-9111). Each value is a sentence's display text, escaped as an attribute; `""` = none (`heard=""`: no sentence had ended; `interrupted=""`: none was playing). A later cut replaces one no message has carried |
| 3 | `<sessions at="HH:MM">` | on a wake; then only when the roster TEXT differs from the last one sent. Body: MAN-9055 |
| 4 | `<view session="…" sessionId="…"/>` or `<view>none</view>` | on a wake; then only when it differs from the last one sent |
| 5 | the body | `<operator via="typed\|spoken">text</operator>`, the empty press `<operator via="spoken" heard="nothing"></operator>`, one or more `<alert>` (joined by newline), or one `<session>` |
| 6 | `<register>…</register>` | EVERY message: `fillRegister(readSettings(), readSoundTags())`, read from his settings each time; the sounds it lists are the account's `gemini.soundTags` (MAN-9081), read at the same push. why: he edits it; it is never in the system prompt |
- Roster and view are compared by their TEXT, not by the envelope: `<sessions at>` carries the clock, which changes every minute.
- A wake = the message goes to a process that was closed, or to a `warm` launch that holds no message yet. A resumed conversation's memory of the roster is hours old, so a wake always carries both.
- Everything is READ first and the bookkeeping committed last: a reader that throws leaves `<state>` and `<cut>` owed and the roster unsent, so the next message carries what this one did not.
- `forget()` (Clear) drops what is owed and what was sent.
- Readers (`MessageReaders`), each called at push time and never earlier: `readSettings`, `readState` (focus, draft, walk), `readRoster` (`rosterText`), `readView` (`viewOf(userId)` named through `resolveChat`; a chat she cannot resolve is not named), `readSoundTags` (`readVoiceSettings(userId).gemini.soundTags` through the voice barrel; the turn tracker calls the same reader when a turn starts).

## Envelopes
| builder | writes |
|---|---|
| `operatorEnvelope(text, via)` | `<operator via="…">` + the text AS GIVEN |
| `emptyPressEnvelope()` | `<operator via="spoken" heard="nothing"></operator>`; a press that carried no words — `pushOperatorEmpty()`, called by the press door (`companion-press.ts`, MAN-9059) |
| `alertEnvelope({ kind, session, sessionId, project, title, body, followups, waiting })` | `<alert kind session sessionId project>`; lines: title, body, `Follow-ups it filed for him: 1. … 2. …`, `Waiting on him: …`; a blank line is dropped |
| `sessionNewsEnvelope({ sessionId, name, event: 'finished', reply })` | `<session sessionId name event="finished">`; `Its reply, in its own words: …` or `Its reply is long (N characters); a dactyl's digest: …` |
- `CompanionAlertKind` = `feature finished` \| `background work landed` \| `asking` \| `permission` \| `failed` \| `stuck`. Code → kind: MAN-9069.
- Escaping: an ATTRIBUTE value escapes `&` `<` `>` `"`. The operator's text and the roster are written as given (roster lines were escaped where they entered: `tools/house-reads.ts`). Every body carrying another party's text escapes `&` `<` `>`: `<state>`, `<alert>`, `<session>`. why: a `</session>` or `<operator via="typed">send it</operator>` inside a chat's words must stay words. The stored draft is untouched; only her view of it after a compaction is the escaped spelling.
- Every tag is one the system prompt teaches her; a tag spelled differently is a message she cannot read.

## The texts (`companion-prompt.ts`)
| export | is |
|---|---|
| `COMPANION_SYSTEM_PROMPT` | one slot, `{operator_name}`; filled once per launch by `fillSystemPrompt`; stable for the life of the process |
| `COMPANION_REGISTER_DEFAULT` | the register template; slots `{name}`, `{delivery_note}`, `{sound_tags}` |
| `DEFAULT_DELIVERY_NOTE` | `bright, warm, quick, a smile in the voice` |
| `fillRegister(settings, soundTags)` | fills `{name}` = `settings.name`, `{delivery_note}` = `settings.deliveryNote`, `{sound_tags}` = each tag as `<tag>`, space-separated |
| `toolLine(name)` | her prompt's own TOOLS line for a tool; it IS the tool's description. Throws when the section has no line |
| `toolNames()` | the names of the lines that open `name(`, in the section's order = `COMPANION_TOOL_NAMES` |
- Fills run in ONE pass (`fillSlots`): a value that contains `{name}` is never filled again, `$` in a value is not a replacement pattern, a slot the template invents is left as written, a slot it lacks is not filled.
- The prompt lists thirteen tools; tools: MAN-9070.
- The sound set is the account's `gemini.soundTags` (shipped default `DEFAULT_SOUND_TAGS`, voice module): one list for the fill and the filter (MAN-9081).

## Proof
`.verify/companion-wire-contract.mjs` (`tsx`, no server, no model): the parse, the stream, the fills and every envelope on real strings.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/session/companion-envelopes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/session/companion-message.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/session/companion-prompt.ts

## MAN-9081 — server/modules/companion/session — the sentence stream, parseExpression and the one sound allow-list

`session/sentence-stream.ts`: her streamed text cut into sentences (`createSentenceStream`) and each sentence read once (`parseExpression`). Both are PURE (no I/O, types-only imports) and are proven on real strings under `tsx`. The turn tracker (`companion-turns.ts`) holds one stream per turn and calls `parseExpression(raw, turn.soundTags)` on every sentence it emits; the list is read once, when the turn starts.

## The one allow-list
- The list is the account's `gemini.soundTags` in its voice settings (MAN-9098). The shipped default, `DEFAULT_SOUND_TAGS` in `server/modules/voice/voice-settings.ts`, is NOT held here: `giggle`, `chuckle`, `laugh`, `gasp`, `sigh`, `phew`, `tsk`, `breath`, `short pause`, `long pause`.
- It feeds BOTH the register's `{sound_tags}` slot (`fillRegister`, each as `<tag>`, space-separated; read at EACH push through `MessageReaders.readSoundTags`) and the filter (`parseExpression` keeps a sound only when its tag is on it; the turn tracker reads the list when a turn STARTS, so one turn is parsed by one list). why: she is taught exactly the sounds the filter keeps, never one it then deletes.
- Both readers take `readVoiceSettings(userId).gemini.soundTags` through the voice barrel; `companion-account.ts` wires the reader.
- Tags compare lower-case with whitespace collapsed.

## `createSentenceStream(onSentence)` → `{ push(delta), flush() }`
| rule | detail |
|---|---|
| end of a sentence | a run of terminators `.` `!` `?` `…` and closers (`?!`, `...`, `."`) is one end, then whitespace, then anything but a lowercase letter; or a newline (always) |
| decided by what comes AFTER the run | no whitespace (the `5` of `3.5`, the letter of `e.g.`): no end. Whitespace holding a newline: ends. Whitespace, then a lowercase letter (`\p{Ll}`): the sentence goes on. Whitespace, then any other character: ends. The buffer's end right after the run, inside its whitespace, or on the first half of a surrogate pair decides nothing yet; a gap of more than 300 whitespace characters ends the sentence without waiting (`readGapAfterTerminator`). why: she never begins a sentence in lowercase, so `I've drafted "Reply with PONG." for that chat` and `3 p.m. today` stay one |
| kept whole | `e.g.` `i.e.` `etc.` `vs.` `mr.` `mrs.` `ms.` `dr.` `prof.` `jr.` `sr.` `cf.`; decimals; a leading list number (`1.`, `- 2.`) |
| run-on | past 300 characters: cut at the last comma (kept) or space (dropped) inside the first 300; never inside a `<…>` or `[…]` opened in the 40 characters before (`SPAN_REACH_CHARS`); with neither, a hard cut at 300. An end at or before 300 whose whitespace runs to the buffer's end (`findCut` answers `{ waitingEnd }`) holds the cut off until the next delta decides it (`flush()` still emits it); a waiting end past 300 still gets the run-on cut. `findCut` reads no further than index 300 (`scanEnd`): a decision past it belongs to the run-on cut, and one large push costs a bounded scan |
| `flush()` | emits what is left. Called at the end of EACH text block (`block_end`) and at a turn's successful end. why: a block ends with no whitespace after its last sentence; without it the next block's first words join it and its `[mood]` is lost |
- Sentences arrive trimmed and never empty. The cut depends on the text alone: one character at a time and all at once give the same sentences.
- The buffer moves before the callback runs, so a consumer that throws cannot make a sentence repeat.

## `parseExpression(raw, soundTags)` → `{ mood, display, sounds } | null`
| step | does |
|---|---|
| input | U+E000 (the parse's own sound mark) is removed first |
| list marker | `- ` `* ` `+ ` `• ` `1. ` `2) ` and a heading's `#` run are stripped, on both sides of the mood |
| mood | a leading `[…]` of 1–3 words → `mood`, lower-cased. More words is not a mood. Every other `[…]` span is dropped |
| angle spans | a tag on the list → a sound: leaves `display`, listed in `sounds`. Any other span is dropped and the words between its open and close tag stay (`<whisper>secret</whisper>` → `secret`). A `<` followed by whitespace or `=` is a comparison and stays as text; an unclosed `<` stays |
| markdown | `**` `__`, paired `*x*` / `_x_` and backticks go; `snake_case` is not emphasis |
| spacing | whitespace collapses; a space before punctuation closes up |
| answer | `null` when `display` is empty and no sound was kept |
- `sounds[i].at` = the length of `display` (JS string length, UTF-16 units) at the point the sound stood, measured before the space after the word it follows: the mark sits on that word's end.
- Kept fields: `display`, `mood`, `sounds` → the `kaylee` log line (the panel draws sounds as marks at their offsets: `CompanionSentence.tsx`). The voice's words are `utteranceOf` of that stored row (`display` with each sound written back as `<tag>` at its `at`, MAN-9110): the panel and the voice read one record.
- `index` of a sentence in its turn counts only sentences that were not `null`.

## Proof
- `.verify/companion-wire-contract.mjs`: `TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx .verify/companion-wire-contract.mjs` — parse (prints each parse and `utteranceOf` of its row), stream and fills on real strings; no server, no model call.
- `.verify/kaylee-sentence-replay.mjs`: `TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx .verify/kaylee-sentence-replay.mjs` — her recorded replies (`assistant` text blocks under `~/.claude/projects/-home-lyphe--claude-state-companion-*/`) through the cut at `f82d09c7` and the tree's; prints each text cut differently and whether the tree's cut is the same at delta sizes 1, 3, 7, 50 and whole; no server, no model call. 2026-10-28: 384 text blocks; 3 cut differently (`"Tea or coffee?"` once, `"…PONG."` twice), each now one sentence (1581 sentences → 1578), same words; 0 cut differently at any delta size.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/session/sentence-stream.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/companion-wire-contract.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-sentence-replay.mjs

## MAN-9082 — server/modules/companion — storage: the four tables, companionDb, relayedSendsDb, the store's frame per write, the floor and Clear

`COMPANION_SCHEMA_SQL` (`server/modules/database/companion-schema.ts`) is exec'd by `runMigrations` beside `FOLLOWUPS_SCHEMA_SQL`. Every statement is `IF NOT EXISTS`: editing a column there changes NOTHING on a database that has the table; a later column needs `addColumnToTableIfNotExists` in `migrations.ts` (as `sessions.permission_mode` does: MAN-9085). Rows → wire shapes and frames: `companion-store.ts`.

## The four tables
| table | key | holds | dies with |
|---|---|---|---|
| `companion_state` | `user_id` (one row per account) | `provider_session_id` (her CLI conversation; NULL until her first `init` and after Clear), `focus_json` (`CompanionSessionRef`), `draft_json` (`CompanionDraft`), `walk_json` (`CompanionWalk`), `floor` (the client id holding the floor), `updated_at` | the account (`ON DELETE CASCADE`) |
| `companion_log` | `id` AUTOINCREMENT, index `(user_id, id)` | `at`, `role` (`operator` \| `kaylee` \| `alert` \| `system`, CHECK), `via` (`typed` \| `spoken`, CHECK), `turn_id`, `turn_index`, `text`, `mood`, `sounds_json` (NULL for none, never `[]`) | the account |
| `companion_notes` | `id` AUTOINCREMENT | `at`, `title`, `text` | the account |
| `relayed_sends` | `id` AUTOINCREMENT, index on `session_id` | `session_id` → `sessions(session_id)`, `via`, `text`, `sent_at`, `message_uuid` (TEXT, NULL; added by `addRelayedSendMessageUuidColumn` in `migrations.ts`, not in `companion-schema.ts`) | the chat (`ON DELETE CASCADE`) |
- `AUTOINCREMENT`, never reused: the panel holds a note id it may ask to dismiss and an entry id it has drawn; a number it remembers never names another row.
- `relayed_sends` hangs on the CHAT because a relayed send is a fact of the chat's history. It survives Clear.
- Merge paths: the three paths in `sessions.db.ts` that delete a watcher's duplicate row (`assignProviderSessionId`, `repointSessionToProviderSession`, `createForkedSession`) move `followups` and do NOT move `relayed_sends`, and need not: the companion records a send only for a chat of her list (`session_id <> provider_session_id`), never for a watcher row. A writer that records sends for any other kind of row must extend those paths first (MAN-9003).

## `companionDb` (`repositories/companion.db.ts`; ROWS in, rows out: snake_case, JSON as text)
| verb | does |
|---|---|
| `readState(userId)` | the row or `null` |
| `writeState(userId, patch)` | upsert of the columns the patch names (`provider_session_id`, `focus_json`, `draft_json`, `walk_json`, `floor`); a key left out or `undefined` is untouched, `null` sets NULL; stamps `updated_at`; answers the row |
| `userIdsFocusedOn(sessionId)` | accounts whose `focus_json.sessionId` is the chat, ascending; read from the rows, so an account untouched since boot is found; non-JSON `focus_json` names no one (guard is a `CASE`, not `AND`) |
| `appendLog(userId, entry)` | insert + delete everything beyond the newest `COMPANION_LOG_KEEP` = 400 of the account, one transaction; answers the row with its id |
| `readLog(userId, limit)` | newest `limit` rows, oldest first; `limit` clamped to 0..400, non-finite = 400 |
| `addNote`, `listNotes`, `removeNote(userId, id)` | `listNotes` oldest first; `removeNote` is false for another account's id |
| `clearAccount(userId)` | one transaction: deletes the account's log and notes; resets `provider_session_id`, `focus_json`, `draft_json`, `walk_json` to NULL. `floor` STAYS; `relayed_sends` is never touched; no state row is created for an account with none. Answers `{ logRemoved, notesRemoved, stateReset }` |
Every statement names its account in `WHERE`/`VALUES`: an id of another account reads as no row.

## `relayedSendsDb` (`repositories/relayed-sends.db.ts`)
- `record(sessionId, via, text, messageUuid = null)`: stores `text.trim()`, `sent_at` = now (ISO, ms), `message_uuid`; answers the row. `via` is the companion's send mode (`turn` \| `steer`). `message_uuid` is the transcript uuid of the user row the send became: a Claude turn's, NULL for a steer, a turn into another provider's chat and every row recorded before the column (MAN-9084). Nothing updates or deletes a row.
- `listForSession(sessionId)`: oldest first.
- Reader: the history mark (MAN-9084). Writer: `companion-send.ts` (MAN-9072).

## The store (`createCompanionStore(userId)`): one frame per write
The write comes first and the frame second, in the same tick; a failed write sends none. Frames reach THIS account's open pages through `sendToUser`, nobody else's.
| verb | frame |
|---|---|
| `setProviderSessionId` | none |
| `setFloor(client)` | `companion_floor { floor }` on EVERY write of a client id, not only a change; a cleared floor (`null`) sends none |
| `setFocus(ref \| null)` | `companion_focus` |
| `setDraft(input \| null)`, `setWalk(input \| null)` | `companion_draft`, `companion_walk` (store stamps `updatedAt`; answers what was stored) |
| `appendLog(line)` | `companion_sentence` for `role: 'kaylee'`, else `companion_log` |
| `addNote`, `removeNote(id)` | `companion_note`; `companion_note_removed` only when this account had the note |
| `emit(frame)` | the frames that are not rows: `companion_turn`, `companion_activity`, `companion_process`, `companion_settings`, `companion_open_chat`, `companion_cleared` |
| `clearAccount()` | `companionDb.clearAccount`, then `companion_cleared` |
- A JSON column that does not read as its shape (a hand edit, a later build) is dropped with `[Companion] Dropping <column> of account <id>`: it never throws; the picture still loads.
- `readState()` → `{ providerSessionId, focus, draft, walk, floor }`.

## The floor
- `companion_state.floor` = the `x-companion-client` id of the page that last typed (`POST /messages`), pressed Send (`POST /draft/send`), pressed her talk button (`POST /press`, taken before the clip is heard) or opened her panel (`POST /floor`).
- Every write of the floor sends `companion_floor { floor }` to the account's pages (MAN-9086). The page whose client id equals it plays her voice; every other shows the words only (MAN-9113). A page that missed the move (a socket that reconnected) hears it again the next time anyone speaks to her, and reads it in the picture's `floor` when it re-seeds.
- The speech door answers only the floor page (MAN-9110).
- `openChatOnFloor(sessionId)` emits `companion_open_chat { sessionId, floor }` only while a floor is held. Every page receives it; only the page whose client id equals `floor` opens the chat (MAN-9083).
- The id is minted per tab by the page (`companionClientId()` in `src/shared/utils.ts`: 16 random bytes in hex, kept in `sessionStorage`) and rides every `api.companion.*` call as `x-companion-client`.

## Clear, in storage terms
Rows deleted: the account's log, notes, `provider_session_id`, focus, draft, walk. Rows kept: `floor`, `relayed_sends`. Order of the steps: MAN-9059 §Clear.

## Proof
`.verify/companion-storage.ts` (against a `.backup` copy of `auth.db`; refuses the live database): 405 appends leave 400 with the first five ids gone; a state round trip; a note added, listed, removed; `clearAccount` keeps the floor and `relayed_sends`; a relayed send; `latestPermissionMode`. `.verify/companion-store.mjs`: the store's frame per write, one account's page and another's silent.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/companion-store.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/companion-schema.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/companion.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/relayed-sends.db.ts

## MAN-9083 — src/modules/companion — the page's picture: CompanionProvider, the reducer, the floor, api.companion and the wiring into the workspace

The views are MAN-9062. This row is the state they draw from and the places the workspace mounts them. Shapes: `src/shared/companion-types.ts`, mirrored field for field with `server/shared/companion-types.ts` (MAN-9086). Server side: MAN-9058, MAN-9059.

## Barrel (`src/modules/companion/index.ts`) — everything else is private
`CompanionProvider`, `useCompanion`, `CompanionPanel`, `CompanionFab`, `CompanionDock`, `CompanionSettingsSection`.

## Where each is mounted
| surface | mounted by |
|---|---|
| `CompanionProvider` | `project-workspace/CompanionHost.tsx`, which `ProjectWorkspaceShell` renders around `WorkspaceFrame`, inside `PageAnchorsProvider` (the shell's outermost: MAN-9131), `ChatHostProvider`, `AppSwitcherProvider` and `AccountsProvider`. `useCompanion()` throws outside it |
| `CompanionPanel` | `WorkspaceFrame`, after `ChatHostFloating`, before `AppSwitcherFab`; ALWAYS rendered |
| `CompanionFab` | `WorkspaceFrame`, after `AppSwitcherFab`; ALWAYS rendered (her disc, over every application: MAN-9125) |
| `CompanionDock` | `WorkspaceRail`'s foot: after `UsageRings`, before the foot views (the Inbox) and Settings (her cell; it draws her door while the disc is out: MAN-9125) |
| palette row | `ProjectCommandPalette` builds `companionGroup` and passes it to `CommandPalette` (prop `companionGroup`), drawn between the Applications and Navigate groups when actions show and the group has rows. One row: key `companion`, label `t('companion.palette.talk', { name })` ("Talk to Kaylee"), icon `AudioLines`, `run: setOpen(true)`. `name` = `picture?.settings.name`, else `t('companion.defaultName')` |
| Settings section | `VoiceSettingsTab`, after its voice section, NOT gated by `voiceEnabled`; the section fetches and saves for itself (`useCompanionSettings`: `GET /api/companion`, `PUT /api/companion/settings`) |
- Opening a chat for her (`onOpenChat`, `CompanionHost.openCompanionChat(sessionId)`): `setActiveTab('chat')`, `navigate('/session/<id>')`, and when an application covers the main region (`useCurrentApplication() !== null`) the chat host's `open()` floats the chat over it. The callback changes identity as applications come and go; the provider reads the newest at the moment a frame arrives.
- Text: `t('companion.*')` in `en/common.json`; the Settings section reads `voiceSettings.companion.*` in `en/settings.json`.

## `useCompanion()` → `CompanionContextValue`
| member | does |
|---|---|
| `picture`, `open`, `clientId` | `CompanionPicture \| null` (null until the first read lands); whether her panel is open on THIS page; this page's id |
| `readFailure`, `reread()` | `string \| null`: why the last read failed (the server's sentence, else `Request failed (<status>)`), only while `picture === null`, cleared when a read lands and when `reread()` starts one; the panel draws it with Try again, which calls `reread()` |
| `setOpen(open)` | opening `POST`s `/floor` |
| `sendText(text)` | `POST /messages` |
| `saveSettings(patch \| { register: null })` | `PUT /settings`; the answer is folded in as `companion_settings` before the call resolves |
| `editDraft(text)` | `PUT /draft`; the answer is folded in as `companion_draft` |
| `sendDraft(mode)` | `POST /draft/send`; resolves with the `outcome` (`'started'` \| `'folded'`); rejects with the server's sentence on a refusal |
| `clearDraft`, `dismissNote(id)`, `interrupt`, `clear` | `DELETE /draft`, `DELETE /notes/:id`, `POST /interrupt`, `POST /clear` |
| `recentSend` | `string \| null`: the id of the chat she sent a draft to in the last `RECENT_SEND_MS` = 4000 ms (counted from the `companion_open_chat` frame this page heard), else null. `useAvatarTarget` points the button at that chat's composer while it is set |
| `fabPosition`, `moveFab(next)` | where her disc rests (`{ docked: true }` or a point) and its setter, which stores `companion-fab`: from `useCompanionFab()`, called once in the provider (MAN-9129) |
| `dockRect`, `registerDock(rect)` | the rail cell's rect while on screen, and the cell's report of it (MAN-9129) |
| `fabAway`, `setFabAway(away)` | a look holds her disc off its seat; set by `CompanionFab`, read by `CompanionDock` (MAN-9129) |
| `level()` | the page player's level, 0..1: what her face's mouth follows while she speaks (MAN-9129) |
| `talk` | `TalkPress` = `{ state: 'idle' \| 'listening' \| 'transcribing'; toggle(); error }`: this page's ONE talk press, from `useTalkPress(speech)` called once in the provider (MAN-9101). Readers: the panel's talk button, the bound key or mouse button, and `useCompanionPresence` (`state`, into the status line's Listening and Transcribing). Not part of the picture: it is this page's mic. A press cuts her off when this page's player sounds (MAN-9113) |
| `voice` | `CompanionVoice` = `{ on, setOn, speaking, cut }`: this page's voice, from `useCompanionVoice` called once in the provider (MAN-9113). Readers: the panel (the switch, the log's mark) and `useCompanionPresence` (`speaking`, `cut`, into the status line's Speaking and Cut). Not part of the picture: it is this device's switch and this page's player |
- The provider also calls `useTalkBinding(picture?.settings.talkBinding ?? null, talk.toggle)` (MAN-9062 §Parts). A press never opens her panel.
- The provider unlocks the page's audio inside `setOpen(true)` and `sendText`, and silences the voice in `interrupt` (before the request) and on a `companion_cleared` frame (MAN-9113).
- `ensureOk`: a non-2xx answer throws an `Error` whose message is `refusalSentence(response)` (the server's own sentence), else `Request failed (<status>)`.

## `api.companion` (`src/shared/api.ts`; the only place these URLs are written)
| call | route |
|---|---|
| `picture()` | `GET /api/companion` |
| `sendText(text)` | `POST /api/companion/messages` |
| `floor()` | `POST /api/companion/floor` |
| `saveSettings(patch)` | `PUT /api/companion/settings` |
| `editDraft(text)`, `clearDraft()` | `PUT`, `DELETE /api/companion/draft` |
| `sendDraft(mode)` | `POST /api/companion/draft/send` |
| `dismissNote(id)` | `DELETE /api/companion/notes/<id>` |
| `interrupt()` | `POST /api/companion/interrupt` |
| `clear()` | `POST /api/companion/clear`, `timeoutMs: 90_000` (the wind-down is awaited) |
| `speech(turnId, index, signal)` | `GET /api/companion/speech/<turnId>/<index>`, `turnId` through `encodeURIComponent`. Answers the `Response` itself with its body still arriving, for the player to read: 200 audio, 204, or the refusals of MAN-9110. `signal` is its only deadline (a sentence streams for as long as it is spoken); aborting hangs up and stops the synthesis. `speechPull.ts` is its one caller |
| `cut({ turnId, heard, interrupted })` | `POST /api/companion/cut`, JSON; answers the `Response` (204). `speechPull.ts` is its one caller (MAN-9111) |
| `press(blob, mimeType, durationMs)` | `POST /api/companion/press`, multipart `audio` + `durationMs`; answers 202 `{ text }` or the 409/502 of a hearing that came to nothing (MAN-9101, MAN-9058 §Refusals). Returns the `Response`; `useTalkPress` is its one caller |
- EVERY call carries `x-companion-client: companionClientId()` (`src/shared/utils.ts`). Server rules: MAN-9058 §Input. The floor: MAN-9082.

## The picture is seeded, then kept — nothing polls
1. `GET /api/companion` once at mount. A body that fails `isCompanionPicture` is a failed read: warn `[Companion] Could not read her picture`, the page keeps what it had, and `readFailure` holds the reason.
2. After that, every `companion_*` frame on the page's one socket is folded by `reduceCompanion(picture, frame)`.
3. Read again on: the socket's `websocket_reconnected` (frames were missed), a `companion_cleared` frame, the panel opened while `picture === null`, and the panel's Try again (`reread`) while a failed read keeps `picture` null.
4. A frame that arrives while a read is out is queued and folded over its answer. A read asked for while one is out discards that one and reads again. A `companion_cleared` drops the queue and discards a read in flight.
5. `companion_open_chat` is not folded: it opens the chat only when `frame.floor === clientId`; every other page of the account ignores it.

## `reduceCompanion` (`utils/companionReducer.ts`, pure, imports types only)
| frame | does |
|---|---|
| `companion_log`, `companion_sentence` | the entry joins `log` by `id`, ascending; a held id changes nothing; only the newest `LOG_KEPT` = 200 stay |
| `companion_turn` | `started` sets `turnId`; `ended` clears it only when it is the running turn's |
| `companion_activity`, `_focus`, `_draft`, `_walk`, `_settings`, `_process` | replaces the field |
| `companion_floor` | `floor` replaces `picture.floor` when it is text and differs; the same object back otherwise. The voice pull arms on `floor === clientId` (MAN-9113) |
| `companion_note` / `companion_note_removed` | joins by `id` / removes by `id` |
| `companion_cleared` | empties `log`, `notes`, `draft`, `walk`, `focus`, `turnId`, sets activity `idle`; `settings`, `process`, `models` and `floor` stay (the provider then reads again) |
| unknown kind, or a payload the panel cannot read | the SAME object back |
- Folding a frame twice is harmless (ids and replacement), which is why a read and the socket need no ordering. `isCompanionPicture` requires `floor` to be text or `null`.

## Proof
- `.verify/companion-lands.mjs` (live :5183 against :3011, Haiku): door, panel over an application, memory across a model switch, a second page of the account, the other account's page, Clear; records every `companion_*` frame to `<evidence>/frames.json`.
- `.verify/companion-reducer.mjs <frames.json>` (`tsx`): folds the recorded frames over each picture and sets the result beside the next `GET`.
- `.verify/companion-lands-page.mjs` (no model call): the palette row opens the panel; Settings reads and saves; `companion_open_chat` opens the chat on the named page alone.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/context/CompanionContext.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/hooks/useCompanionSettings.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/utils/companionReducer.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/CompanionHost.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/ProjectCommandPalette.tsx

## MAN-9086 — server/shared/companion-types.ts — the wire contract: the types, the fourteen frames, who sends each and what the page does

`server/shared/companion-types.ts` (group header `//----------------- COMPANION CONTRACTS ------------`) is the one home of every shape Kaylee puts on a wire. A sibling of `shared/types.ts`, as `cerberus-types.ts` is. `src/shared/companion-types.ts` mirrors it field for field and is edited together with it; nothing is server-only.
- Mirror check: `diff <(sed -n '/COMPANION CONTRACTS/,$p' server/shared/companion-types.ts | grep -E '^export type') <(sed -n '/COMPANION CONTRACTS/,$p' src/shared/companion-types.ts | grep -E '^export type')` prints nothing.
- Every time is an ISO-8601 string. JSON is camelCase on every wire, SQL snake_case (`turnId` / `turn_id`).

## Types
| type | shape |
|---|---|
| `CompanionModel` | `'sonnet' \| 'opus' \| 'haiku'` |
| `CompanionSettings` | `name` (1–40, no line break, default `Kaylee`), `operatorName` (1–40), `register` (200–16000, slots `{name}` `{delivery_note}` `{sound_tags}`), `deliveryNote` (0–120, no line break), `model` (default `sonnet`), `live` (default `false`), `talkBinding` (`TalkBinding \| null`, default `null`; `PUT` with `null` unbinds). Storage and defaults: MAN-9087 |
| `TalkBinding` | the key or mouse button that presses her talk button: `{ kind: 'key', code, ctrl, alt, shift, meta, label }` (`code` is a `KeyboardEvent.code`, 1–40 of `[A-Za-z0-9]`; a function key `F1`–`F24`, or Ctrl, Alt or Meta held with the key) or `{ kind: 'mouse', button: 1 \| 3 \| 4, label }` (middle, back, forward); `label` 1–40, no line break (`F8`, `Ctrl+Space`, `Mouse back`). Server limits: MAN-9087; the page's one rule that accepts, matches and labels a press: MAN-9062 |
| `CompanionSessionRef` | `{ sessionId, name, project }` |
| `CompanionPhase` | `idle` \| `thinking` \| `reading_session` \| `reading_code` \| `drafting` \| `walking` |
| `CompanionActivity` | `{ phase, session: Ref \| null, files: string[] \| null, walk: { at, total } \| null }` |
| `CompanionDraftTarget` | `{ kind: 'session', session }` \| `{ kind: 'new', projectPath, projectName }` |
| `CompanionDraft` | `{ target, text, updatedAt }` |
| `CompanionWalk` | `{ session, items: string[], at, updatedAt }`; `at` is 1-based, 0 = not begun |
| `CompanionSound` | `{ tag, at }`; `at` = offset into the entry's `text` (MAN-9081) |
| `CompanionLogEntry` | `{ id, at, role: 'operator' \| 'kaylee' \| 'alert' \| 'system', via: 'typed' \| 'spoken' \| null, turnId, index, text, mood, sounds: CompanionSound[] }` |
| `CompanionNote` | `{ id, at, title, text }` |
| `CompanionProcess` | `{ state: 'asleep' \| 'waking' \| 'awake' \| 'failed', error: string \| null }` |
| `CompanionTurnOutcome` | `answered` \| `stopped` \| `failed` |
| `CompanionPicture` | `{ settings, models: [{ value, label }], process, activity, turnId, focus, draft, walk, notes, log, floor }`; `GET /api/companion`; `log` = newest 200 (MAN-9070) |
| `CompanionFrame` | the union below |

## Frames — all carried by the gateway socket `/ws` to the account's open pages (`sendToUser`)
| `kind` | payload | sent by | when |
|---|---|---|---|
| `companion_log` | `entry` | `store.appendLog` | any log line but hers: the operator's typed line, an `alert`, a `system` line |
| `companion_sentence` | `entry` | `store.appendLog` | each sentence she says (`role: 'kaylee'`) |
| `companion_turn` | `turnId, state: started \| ended, outcome, error` | the account's turn callbacks | a turn begins / ends; `outcome` and `error` only on `ended` |
| `companion_activity` | `activity` | `companion-account.ts` `setActivity` | the turn sets `thinking` / `idle`; a tool sets its phase while it runs |
| `companion_focus` | `focus \| null` | `store.setFocus` | a tool names a chat that is not the focus, or one whose name or project changed. Clear sends `companion_cleared` alone, which empties the focus on the page |
| `companion_draft` | `draft \| null` | `store.setDraft` | `update_draft`, `PUT`/`DELETE /draft`, a send that clears it |
| `companion_walk` | `walk \| null` | `store.setWalk` | the `walk` tool |
| `companion_note` / `companion_note_removed` | `note` / `id` | `show_note` / `DELETE /notes/:id` (removed only when the account had it) | |
| `companion_settings` | `settings` | `saveSettings` | `PUT /settings` |
| `companion_process` | `process` | the session's `onProcess` | each state change |
| `companion_open_chat` | `sessionId, floor` | `openChatOnFloor` | a send or a new chat; none while no page holds the floor. The page whose client id equals `floor` opens the chat (MAN-9083) |
| `companion_floor` | `floor` (the client id now holding it) | `store.setFloor` | every write of the floor: a typed line, a press, Send, the panel opened. Sent even when the holder did not change. The page whose client id equals `floor` plays her voice; the others show the text only (MAN-9082, MAN-9113) |
| `companion_cleared` | none | `store.clearAccount` | Clear |
- Writer of each row and frame per callback: MAN-9070. Row → frame per store verb: MAN-9082. What a page does with each: MAN-9083.
- A frame is a notification of a write already committed: a failed write sends none; a payload JSON cannot carry is logged and sent nowhere (MAN-723).
- Later phases add types and frame kinds HERE and redefine nothing.
- Model labels (`CompanionPicture.models`): MAN-9070 §`companion-picture.ts`.

## Proof
`.verify/companion-wire-contract.mjs` runs the pure files; `.verify/companion-reducer.mjs` folds recorded frames of a real page over the pictures the server answered.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/companion-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/companion-types.ts

## MAN-9087 — server/modules/companion — her settings: the stored overrides, the defaults, the limits and the operator's name

`companion-settings.ts`: `readCompanionSettings(userId)` and `saveCompanionSettings(userId, patch)` are the one place that knows the settings' shape and limits. Both are synchronous end to end (two saves cannot interleave read and write) and touch no socket: telling the pages (`companion_settings`) is the service's act (MAN-9059).

## Storage
- The account's `user_preferences` key `companion`, via `userPreferencesDb`.
- What is stored is the OVERRIDES, never the resolved settings. A field he has not set is absent, so its default stays live: `operatorName` follows `users.git_name`, the register follows the product's text instead of freezing a copy a page echoed back.
- A stored field that no longer passes its limit reads as unset and the next save drops it (the generic `PATCH /api/user/preferences` can write any key; this module's route is not the only way in).
- Read FRESH on every call, never cached: the register is re-read at every push (MAN-9080), so a save is the next message's voice.

## Defaults (`readCompanionSettings`)
| field | default |
|---|---|
| `name` | `Kaylee` |
| `operatorName` | below |
| `register` | `COMPANION_REGISTER_DEFAULT` |
| `deliveryNote` | `DEFAULT_DELIVERY_NOTE` |
| `model` | `sonnet` |
| `live` | `false`: alerts and focus news reach her only while he has turned it on |
| `talkBinding` | `null`: no key or mouse button presses her talk button |
- `operatorName` default, first that passes its limit: the first word of `users.git_name` (up to the first whitespace; a name written as one run is cut at the first lower-to-upper boundary: `ScottDeJesus` → `Scott`), else the username with its first letter upper-cased, else `Operator`.
- `COMPANION_MODELS` = `sonnet`, `fable`, `opus`, `haiku`: the picker's order.

## Limits (`TEXT_LIMITS`, counted in code points: an emoji is one)
| field | min | max | one line |
|---|---|---|---|
| `name` | 1 | 40 | yes |
| `operatorName` | 1 | 40 | yes |
| `register` | 200 | 16000 | no |
| `deliveryNote` | 0 | 120 | yes |
- Text is trimmed first (`"   "` is length 0). One line = no `\n`, `\r`, `\v`, `\f`, U+0085, U+2028 or U+2029 (the pattern is `[\n\r\v\f\u0085\u2028\u2029]`).
- `model` must be one of `COMPANION_MODELS`; `live` must be a boolean.
- `talkBinding` is `null` or a `TalkBinding` (MAN-9086), rebuilt field by field (a stray key is not stored). `label` is a text limit of its own (`talkBinding.label`, 1–40, one line, trimmed). A `key` binding: `code` is 1–40 of `[A-Za-z0-9]`; `ctrl`, `alt`, `shift`, `meta` are each a boolean; and it is accepted only when `code` is `F1`–`F24` (`/^F(?:[1-9]|1\d|2[0-4])$/`) or `ctrl`, `alt` or `meta` is true (Shift alone does not make a key a shortcut). A `mouse` binding: `button` is 1, 3 or 4 (not the left button 0, every click, nor the right button 2, the menu). The page's `talkBindingFromEvent` (`src/modules/companion/utils/talkBinding.ts`) holds the same rule for what it offers to save; the two are edited together.

## `saveCompanionSettings(userId, patch)` → the settings as they now read
- `patch` is checked as untyped input (a route hands it a request body): not an object → 400.
- A key that is not a setting is refused, not ignored: `<key, 40 characters at most> is not a setting; the settings are name, operatorName, register, deliveryNote, model, live, talkBinding.`
- A field set to `undefined` is left as it was. `register: null` deletes the override: the default template returns; `talkBinding: null` deletes its override: nothing is bound.
- Nothing is written unless EVERY field passes. The first failure throws `inputInvalid(sentence, field)` → 400 `COMPANION_INPUT_INVALID`, `details.field` = the field (MAN-9058 §Refusals). Sentences: `<field> must be <min>-<max> characters[ with no line break] (it is not text \| it has a line break \| it has <n>).`, `model must be one of sonnet, fable, opus, haiku.`, `live must be true or false.`, and for the talk binding (all with `details.field` = `talkBinding`): `talkBinding must be null or an object with a kind of key or mouse.`, `talkBinding.kind must be key or mouse.`, `talkBinding.label must be 1-40 characters with no line break (…)`, `talkBinding.button must be 1 (middle), 3 (back) or 4 (forward).`, `talkBinding.code must be 1-40 characters of letters and digits (it is a KeyboardEvent.code, as KeyK).`, `talkBinding.ctrl, alt, shift and meta must each be true or false.`, `talkBinding must be a function key (F1-F24) or hold Ctrl, Alt or Meta with the key: a key on its own fires while you type.`
- A register equal to `COMPANION_REGISTER_DEFAULT.trim()` is not stored as an override. why: a page that echoes the whole settings object back must not freeze today's default against every later edit of it.
- No override left → the preference row is deleted.

## Callers
| reader | reads for |
|---|---|
| `companion-account.ts` | the session's `readSettings`: every push (model, names, register, delivery note) |
| `companion-picture.ts` | `GET /api/companion` |
| `companion.service.ts` | `saveSettings` behind `PUT /settings`, which also applies a model change live (MAN-9077 §`setModel` live); the `live` gate of focus news, at the run's end and again after its digest |
| `feeds/alert-feed.ts` | the `live` gate of alerts, at the event and again when the gather window closes (MAN-9069) |

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/companion-settings.ts

## MAN-9088 — Probing Kaylee — the rules every probe of her keeps, the hidden-chat naming rule and the probes that exist

A probe that makes her think, or that makes a chat think through her, spends a real model turn on a box where one Kaylee per account is shared by everyone at work. These rules bind every probe of her.

## Rules
| rule | detail |
|---|---|
| Her model is Haiku | set it before talking to her: the panel's model picker, or `PUT /api/companion/settings` `{"model":"haiku"}`. Never Sonnet or Opus for a probe. A switch with no message after it only switches the running process |
| Probe chats live in `PROBE_PROJECT` | `/tmp/cloudcli-probe-chat` (`.verify/lib/probe-project.mjs`; `ensureProbeProject()` makes the folder: the turn's launch falls back to `$HOME` when it is missing). Every chat she sends to, steers, stops, answers or creates during a probe lives there, never in a real project. Why: the heal files a typed turn as the operator's unless the chat's project sits in a hidden root (`HIDDEN_PROJECT_ROOTS`, INV-4352) |
| Every probe chat sends with `model: 'haiku'` | the composer's own model chip (`.verify/lib/scratch-chat.mjs`: `createScratchChat`, `MODEL_CHIP`) |
| Turns are short and few | one line, one word back |
| A hidden chat or project is resolved only when named EXACTLY | below |
| Never type to the other account's Kaylee | load its page, send nothing |
| Pure functions are shown under `tsx` on real strings | `parseExpression`, the sentence stream, the fills, the envelopes, `reduceCompanion` on recorded frames. No server, no model |
| Her voice and her hearing are not counted against a Gemini budget, yet a probe still calls Gemini as little as the code allows | a refusal is proven with `GEMINI_API_KEY` unset and `GEMINI_ENV_FILE` an empty file (no call); the call shape once on `gemini-3.8-flash-lite-tts` with one short sentence; the speech model is set to `gemini-3.8-flash-lite-tts` for every probe that makes her speak; no probe loops over sentences beyond one short counting turn (INV-9908) |
| Not on :3011 when a restart cuts the run | `server/` saves restart :3011 and the dev account's Kaylee is shared: a run there is cut short or cleared. Use a scratch stack or a copy of the database |

## The hidden-chat naming rule
- A probe chat sits under `/tmp`, a hidden root, so it is never one of "his chats": the roster, `list_sessions` and `list_projects` do not show it.
- `resolveChat` reaches it only by id or by its exact name (case-insensitive); `resolveProject` only by the project's exact registered path. A PART of the name ("kaylee" for "probe kaylee") resolves nothing. Rule and code: MAN-9055 §The hidden fallback.
- So a probe names the chat exactly in its message ("Draft for probe kaylee: …"), and the page shows the chat so `<view>` names it for her.
- Measured 2026-10-26 on Haiku: with a hidden chat she often searched `list_sessions` for the name and never called `update_draft`. A turn that never calls the tool is not a defect of the tool: the probe retypes up to three times (MAN-9061 §Probe).

## Stacks
| stack | when |
|---|---|
| live :3011 / :5183 | `companion-lands.mjs`, `kaylee-whole.mjs`: the dev account, Haiku, probe chats in `PROBE_PROJECT` |
| scratch server + Vite on a copy of the database | `companion-send-scratch.sh`, `companion-act-tools-scratch.sh`, `kaylee-hears-unasked.sh`: never touch :3011 |
| the real module on express over a `.backup` copy under `/tmp` | `companion-module.mjs`, `companion-draft-tools.mjs`: runs as account 1, leaves her JSONL under `~/.claude/projects/-home-lyphe--claude-state-companion-1/`; refuse a database outside `/tmp` |
| `tsx`, no server | `companion-wire-contract.mjs`, `kaylee-sentence-replay.mjs`, `companion-reducer.mjs`, `companion-turn-windows.mjs` |

## The probes (`.verify/`, gitignored: on disk only)
| script | shows |
|---|---|
| `kaylee-session.mjs [--pure]` | her conversation: init check, memory, `setModel` live, resume, refused resume, Stop (MAN-9077, MAN-9079) |
| `companion-module.mjs` | routes, frames, a `list_sessions` call, refusals, interrupt, clear, live model change, `stop()` mid-turn (MAN-9071) |
| `companion-storage.ts`, `companion-store.mjs` | tables and the store's frames (MAN-9082) |
| `companion-house-reads.mjs`, `companion-house-states.mjs`, `companion-view-of.mjs` | the roster, a chat's state, `viewOf` (MAN-9055, MAN-9057) |
| `companion-draft-tools.mjs`, `companion-read-tools.mjs`, `companion-act-tools.mjs`, `companion-turn-windows.mjs`, `probe-companion-reads.mjs` | the tool files (MAN-9061, MAN-9066, MAN-9065) |
| `companion-send.mjs` (legs `steer,idle,create,mismatch,panel`) | the send (MAN-9072, MAN-9068) |
| `kaylee-alert-feed.ts`, `kaylee-hears-unasked.sh` | alerts and focus news (MAN-9069) |
| `kaylee-p3-run-verbs.mjs` | the page's own stop and permission answer through the shared verbs (websocket MAN-710) |
| `kaylee-through-mark.mjs`, `companion-permission-mode.mjs`, `prompt-stream-join.mjs` | the mark, `permission_mode`, the shared prompt stream (MAN-9084, MAN-9085, MAN-9078) |
| `companion-panel-scaffold.mjs` | the views on fixture pictures (MAN-9062) |
| `kaylee-talk-scaffold.sh` (`.mjs`) | the talk press, binding row, chat-mic picker and Gemini section on fixtures; her panel and Settings > Voice against an untouched client; no model turn, no Gemini call (MAN-9095) |
| `kaylee-clip.mjs`, `kaylee-press-refused.sh`, `kaylee-press-live.sh`, `kaylee-talk-chat-mic.mjs`, `kaylee-talk-whole.mjs`, `mic-recorder-move.mjs`, `kaylee-talk-binding-hook.mjs`, `kaylee-talk-binding-rule.ts` | the spoken probes: their one fixture clip, which of them calls Gemini and how often (MAN-9100) |
| `companion-lands.mjs`, `companion-lands-page.mjs`, `companion-reducer.mjs` | the page (MAN-9083) |
| `kaylee-voice-speech.mjs` | `synthesizeSentence`, the three voice settings and the sound-tag readers: ONE paid sentence on `gemini-3.8-flash-lite-tts` and its transcription back, the rest free (MAN-9105) |
| `kaylee-speech-door.sh` (`.mjs`) | the speech door and the cut with NO Gemini call: no key in reach, Google's host a stand-in (MAN-9110, MAN-9111) |
| `kaylee-speech-door-live.mjs` | the same door on :3011 as account 1: at most 2 Gemini calls, Kaylee on `haiku` (MAN-9110) |
| `kaylee-voice-pcm-player.mjs` | the page's player on generated tones, live :5183, no Gemini call (MAN-9112) |
| `kaylee-voice-scaffold.sh` (`.mjs`) | the voice switch, the speaking mark, Speaking and Cut and the Gemini section's voice rows on fixtures; its live half exits 1 against the wired panel; run `--only fixtures` (MAN-9106) |
| `kaylee-voice-whole.mjs` | the whole voice once: two pages, the pull, the cut, the floor, the switch, Settings; one counting turn on `gemini-3.8-flash-lite-tts`; step 7 with no Gemini call (MAN-9113) |
| `kaylee-whole.mjs` | the whole system once on :3011 / :5183: panel from her door (the rail's door, or her disc docked in its cell), Haiku in the picker, a probe chat named "probe kaylee", "What chats are working?", "Draft for probe kaylee: reply with the single word PONG.", "Send it."; screenshots 1440×900 and 390×844 under `.verify/shots/kaylee-whole/` |
| `page-anchors-live.mjs` | the page's anchors on :5183: the registry's rules in a fixture, then the keys on screen in four views; no model call (MAN-9131) |
| `kaylee-avatar-states.mjs` | her face in every state, light and dark, full and reduced motion; no model call (MAN-9124) |
| `kaylee-one-state.mjs` | the status line, the button's label and the face's `data-state` for each of the fourteen presence states on fixtures, the order through `presenceOf`, the live page with her process as it is, and a `companion_process` frame alone moving the button; read-only page on :5183, no word to her, no model call (MAN-9135) |
| `kaylee-sentence-replay.mjs` (`node --import tsx`) | her recorded replies (`assistant` text blocks under `~/.claude/projects/-home-lyphe--claude-state-companion-*/`) through the sentence cut at `f82d09c7` and the tree's; the texts cut differently, and each text at delta sizes 1, 3, 7, 50 and whole; no server, no model call (MAN-9081) |
| `kaylee-avatar-placement.mjs` (`node --import tsx`), `kaylee-avatar-target.mjs` | where her disc stands beside an anchor, on bare numbers; `useAvatarTarget` stepped through a scripted presence over four fixture anchors; no model call (MAN-9132) |
| `kaylee-fab-chrome.mjs` | her disc and rail cell on fixtures: seated, dragged, gliding, at 1440 and 390; no model call (MAN-9125) |
| `kaylee-fab-motion.mjs`, `kaylee-fab-presence-frames.mjs`, `kaylee-fab-speaking.mjs` | her button on the live page: where it goes on a read (Haiku); the status line and the face in the same frame (Haiku, voice off); the mouth while she speaks (Gemini speech, one sentence: run on purpose) (MAN-9130) |
| `kaylee-presence-whole.mjs` | the status line's words frame by frame across a read, a draft, a talk press and a spoken sentence (Haiku; one speech call) (MAN-9113) |

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/companion-lands.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-whole.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/probe-project.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/scratch-chat.mjs

## MAN-9092 — useMicRecorder — the mic's one recorder, and useVoiceInput on top

`src/shared/hooks/useMicRecorder.ts` owns the mic: opens it on `start`, answers the clip and its `durationMs` on `stop`, closes the tracks always. It lives in `src/shared/hooks` because two modules use it.

| consumer | uses |
|---|---|
| the chat's `useVoiceInput` (`src/modules/chat/hooks/useVoiceInput.ts`) | `start`, `stop`; the clip's blob and type go to `transcribeVoice`; `durationMs` is not read; `onEnded` → a plain-stop transcription |
| the companion's `useTalkPress` (`src/modules/companion/hooks/useTalkPress.ts`, MAN-9101) | `start`, `stop`; blob, type and `durationMs` go to `api.companion.press`; `durationMs` is the clock of the server's 0.4 s empty-press rule; `onEnded` → a press |
- Neither consumer calls `cancel()`; it is for a caller that must close the mic without a clip.
- The move out of `useVoiceInput` changed nothing the chat sees: `useVoiceInput` keeps its signature and behavior (`.verify/mic-recorder-move.mjs`).

## `useMicRecorder(onEnded?)`

| member | does |
| --- | --- |
| `state` | `'idle'` \| `'recording'`; `'recording'` from `setState` after `rec.start()` until the recorder's stop event lands |
| `start(): Promise<void>` | opens `getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}})`; a second call while one is pending or recording is dropped (one mic) |
| `stop(): Promise<MicClip \| null>` | resolves the clip; `null` when nothing was recording, after `cancel()`, after an unmount |
| `cancel()` | closes the mic at once, detaches the recorder's handlers, resolves a pending `stop()` with `null`; a `start()` still waiting on `getUserMedia` hands its mic straight back (`generationRef`) |
| `onEnded(clip)` | called with the clip when the recorder stops by itself (tracks ended: a device unplugged); nobody awaits that clip |

- `MicClip` = `{ blob, mimeType, durationMs }`. `durationMs` runs from the recorder's start to the instant `stop()` was called; for a self-stopped recording, to the stop event.
- `start()` rejects with a sentence fit to show: `Microphone access denied.` (`NotAllowedError`), `No microphone found.` (`NotFoundError`), else `Mic error: <message>`. A start cancelled by `cancel()` resolves without opening the mic and says nothing, whether `getUserMedia` answered or failed.
- MIME order: `audio/webm;codecs=opus`, `audio/webm`, `audio/mp4`, `audio/ogg;codecs=opus`, `audio/ogg`; the first `MediaRecorder.isTypeSupported` wins, none → the browser default.
- Each recorder owns its own chunks and stream. why: a late stop event must not close a newer recorder's mic.
- A second `stop()` while one is pending resolves `null` at once and the first keeps its resolver. why: `stop()` leaves the recorder `inactive` in the same call (a double tap, or the mic and Send both firing, transcribes one clip).
- `navigator` stays the opener's (MAN-7452 §"Deliberately on the opener").

## `useVoiceInput(onTranscript, onError?)` — the transcription half

Returns `{ state, toggle, stop }`; `state` = `'transcribing'` while a clip is out, else the recorder's `state`. `stop({ send: true })` passes `send` to `onTranscript(text, send)`.

| clip | result |
| --- | --- |
| `blob.size < 800` | `onError('Recording too short')`, no request |
| upload | `transcribeVoice(blob, 'recording.<ext>', provider)` (`m4a` for mp4, `ogg` for ogg, else `webm`) in `src/shared/api.ts`, `provider` read from `currentVoiceProvider()` (the store `useVoiceProvider` keeps) when the clip is sent. `'openai'` (the default): a configured `baseUrl` → `POST <baseUrl>/audio/transcriptions` (`file`, `model` = `sttModel` or `whisper-1`); else the CloudCLI voice proxy (`audio` part, `x-voice-*` headers). `'gemini'`: always `POST /api/voice/transcribe` (`audio` part), no `x-voice-*` header, never the browser's endpoint |
| non-ok response | `'gemini'` with a sentence in the body (`error`: the 409 no key or refused key, the 502 failure): `onError(<that sentence>)`. Otherwise `onError('Transcription failed: transcribe <status>')` |
| empty text | `onError('No speech detected')` |
| self-stopped clip | transcribed as a plain stop (`send` false) via `onEnded` |

- `onTranscript` / `onError` are read through a ref: `start`, `stop`, `toggle` keep stable identity across renders.
- After unmount nothing is drawn and no handler is called.

## `useVoiceProvider()` and `useVoiceAvailable(purpose)`

`useVoiceProvider(active)` (`src/modules/chat/hooks/useVoiceProvider.ts`) answers `'openai' | 'gemini'`, the account's chat-mic provider (`GET /api/voice/settings` → `settings.provider`).
- One GET per page serves every active caller (a module-level store read through `useSyncExternalStore`); it is made by the first active caller to mount, again on `VOICE_CONFIG_SYNC_EVENT`, and again when the page is returned to (`onPageReturn`): the document becomes visible, the window takes focus, the browser comes back `online`, or a sign-in raises `auth-token-refreshed`. One page-level set of listeners holds them while any active caller is mounted. Reads run one at a time; one asked for while another is out runs after it, once.
- `active` false subscribes to nothing, so it asks nothing: `useVoiceAvailable` passes `enabled && purpose === 'dictate'`, so a page with voice off makes no `/api/voice` request, and a read-aloud control never asks `GET /api/voice/settings` (it asks `GET /api/voice/health` when no browser `baseUrl` is set, §`useVoiceAvailable`).
- `'openai'` until the server answers; a read that fails leaves the last answer as it was. why: today's behavior is the default, and a page that cannot ask must not draw a mic it cannot be sure of (the server's `GET /api/voice/health` is the proxy's own answer for every account, so it does not draw one either). A page returning from sleep asks while the network is still down: that failed read must not take away a mic drawn a moment before.
- The voice fields dispatch the same event on every edit, so reads are also spaced: at most one per 400 ms (`MIN_READ_GAP_MS`), a request inside the gap waiting for its end.
- A return raises several events at once (visible, focus, online): a read is asked for only when none began inside the gap, since that read has seen the newest state. A read that began earlier and is still out is not taken to have seen it (a laptop woken asks while the network is down): the return sets the one more read `readProvider` runs after it, so an `online` that arrives behind a hung read is not lost. A first read that fails therefore stands only until the page is next returned to; a provider changed on another tab, or a sign-in as another account in the same tab, is seen at the next return. Nothing polls: a page left in front, untouched, does not re-read. Proof: `.verify/kaylee-voice-provider-return.mjs`.

`useVoiceAvailable(purpose: 'speak' | 'dictate' = 'speak')`: `'speak'` (read-aloud, `MessageSpeakControl`) is unchanged: voice on, and a browser `baseUrl` or the server's health, which is the OpenAI-compatible proxy's own `configured` for every account. why: read-aloud has no Gemini door — `POST /api/voice/tts` is the proxy's alone (MAN-9098) — so the picker does not govern it. `'dictate'` (the composer's mic, `ChatComposer`) is voice on alone when the provider is `'gemini'`, and read-aloud's answer on `'openai'`. why: Gemini transcribes on the server's key, so the browser needs no backend.

`VoiceInputButton`'s error bubble sits at the mic's left edge, wraps at `min(18rem, 100vw − 4.5rem)`, and rises above the hover tooltip where a pointer hovers. why: a Gemini refusal is a whole sentence ("No Gemini key: set one in Settings → Voice"), and a bubble centered on the phone footer's left-hand mic ran off the screen.

## Probe

| command | proves |
| --- | --- |
| `node .verify/kaylee-talk-chat-mic.mjs --stub` | the chat's mic on the provider: no mic on OpenAI-compatible (no backend on this box), one shared `GET /api/voice/settings`, the mic on Gemini over the same open composer, the clip sent as `audio` with no `x-voice-*` header and no request to a browser `baseUrl`, a page whose first provider read fails (stubbed 500, after a reload) draws no mic until `VOICE_CONFIG_SYNC_EVENT` asks again, the refusal sentence inside the screen and clear of the tooltip at 1440×900 and 390×844, light and dark. Without `--stub`: one live Gemini transcription of the fixture clip, one `[voice] gemini transcribe` line in the journal |
| `node .verify/kaylee-voice-provider-return.mjs` | the provider store's returns, on :5183 with `GET /api/voice/settings` answered by the probe: a failed first read, the server back, one focus → the mic is drawn, one read more; focus + visibilitychange + online in one tick → one read; the answer failing after a good one → a focus reads and the mic stays; a sign-in event → one read; the picker changed elsewhere → the page returned to and the mic goes |
| `node .verify/mic-recorder-move.mjs` | chat mic on :5183 with a stubbed `getUserMedia` and transcription backend: 2 s recording fills the composer (mic → square → mic, tracks live then ended, upload `recording.webm` / `whisper-1`, > 800 bytes); two presses 50 ms apart give "Recording too short", one mic; a press during a pending `getUserMedia` is dropped; tracks ended under a live recording still transcribe; a router push to an unmatched path ends the track (a `page.goto` would destroy the document) |

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/composer/VoiceInputButton.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useVoiceAvailable.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useVoiceInput.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useVoiceProvider.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useMicRecorder.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-talk-chat-mic.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/mic-recorder-move.mjs

## MAN-9093 — src/modules/companion — the talk press: TalkPress, the talk button, the binding row, Listening and Transcribing on the status line, "Nothing heard"

The views of the page's one talk press: the talk button in her composer, the binding row in Settings, Listening and Transcribing on the status line, "Nothing heard" in the log. A view draws from props; `CompanionProvider` holds the press (MAN-9101) and `CompanionPanel` / `CompanionSettingsSection` hand it down (§Mounting). The key and mouse rule and the listener: MAN-9062 §Parts (`useTalkBinding`, `talkBinding.ts`); the capture: MAN-9101; the stored binding: MAN-9087.

## Types — `src/shared/types.ts`
| type | shape |
|---|---|
| `TalkPressState` | `'idle' \| 'listening' \| 'transcribing'`. A press while a clip transcribes records again at once: `listening` can follow `transcribing` |
| `TalkPress` | `{ state: TalkPressState; toggle: () => void; error: string \| null }` |
- `toggle` = one press: open the mic, or stop it and send the clip.
- `error` = what failed on the page itself (mic refused, clip not sent). A refused transcription is her harness's system line in the log, never `error`.

## Props that carry it
| prop | on | absent |
|---|---|---|
| `talk?: TalkPress` | `CompanionPanelView`, then `CompanionComposer` | no talk button |
| `presence: CompanionPresence` (required) | `CompanionPanelView`, then `CompanionHeader`'s status line; `CompanionPanel` gets it from `useCompanionPresence()`, which reads `talk.state` into `listening` / `transcribing` (MAN-9089, MAN-9134) | — |
| `voice?: CompanionVoice` (`src/shared/types.ts`: `on`, `setOn`, `speaking`, `cut`) | `CompanionPanelView`, then `CompanionHeader` (`on`/`setOn`: the "Voice on this device" row) and `CompanionLog` (`speaking`: the sentence marked) | no voice row, nothing marked |
| `talkBinding?: ReactNode` | `CompanionSettingsView` | nothing drawn. Present, it stands in a `SettingsCard` above her fields once settings are read |

## `CompanionTalkButton` — props `state`, `error`, `onToggle`, `name`
| state | look | accessible name |
|---|---|---|
| `idle` | `ghost` icon, mic in `text-muted-foreground` | `companion.talk.start` — `Talk to {{name}}` |
| `listening` | `tonal` + `ring-2 ring-primary` pulse (`motion-safe:animate-pulse`) | `companion.talk.stop` — `Stop and send` |
| `transcribing` | `Spinner` (28) laid over the mic; still pressable | `companion.talk.transcribing` — `Transcribing · press to talk again` |
- Wrapper `span[data-companion-talk=<state>]`. Slot: `PromptInputTools[data-companion-talk-slot]` in the composer, before Send.
- `error` set: `data-tone="warn"`, mic in `text-tone-ink`, an `sr-only` copy of the sentence as `aria-describedby`.
- The error's sentence is drawn by `CompanionComposer`: `p[role=alert][data-companion-talk-error]`, `ml-auto`, amber with ▲, IN FLOW above the box. Both clear with the next press.

| rule | why |
|---|---|
| The sentence is never a bubble over the button | the composer box clips it; unclipped it covered Send steer / Send turn (photographed) |
| A plain `Button`, no `aria-pressed` | its name changes with its state; a toggle's must not |
| Keep `h-8 w-8 rounded-lg` and `before:-inset-1.5` under `(pointer:coarse)` | 32px to the eye, 44px catch (Verve touch floor), Send's size and corner |
| Keep `[@media(pointer:coarse)]:mr-2` | the 44px catches of talk and Send meet and do not overlap |
| The rail door is not named "Talk to <name>" | that name is this button's; the door is named for what it shows (MAN-9089) |

## Status line and log
- Listening and Transcribing: MAN-9089 §Status line.
- `CompanionLog`: a `spoken` entry whose `text.trim()` is empty draws `data-heard="nothing"`, a `border-dashed` outline in `text-muted-foreground` reading `companion.log.nothingHeard` — `Nothing heard`, under the usual `You · spoken` caption. Drawn from the data alone: no prop gates it, so it shows on her live log wherever such a line exists.
- `companion-fake.ts`: panel state `heard` holds one spoken line and one empty one.

## `TalkBindingField` — props `label`, `capturing`, `refusal`, `onBind`, `onClear`, `onCancel`
Settings > Voice > Companion's "Talk button" row (`voiceSettings.companion.talkBinding.*`, `en/settings.json`), in `CompanionSettingsView`'s `talkBinding` slot.
| state | line under the `SettingRow` |
|---|---|
| unbound (`label` null) | `Not bound` + `Bind` |
| bound | `kbd[data-talk-binding-label]` + `Bind` (name `Bind the talk button`) + `Clear` (name `Clear the talk button`) |
| capturing | `div[role=status][data-talk-binding-prompt]` `Press a key or mouse button… Escape cancels` + `Cancel` (`[data-talk-binding-cancel]`) |
- Root: `[data-talk-binding]` = `unbound` \| `bound` \| `capturing`; `data-talk-binding-capture` ONLY while capturing. That attribute is what `useTalkBinding` reads to pass every keydown, pointerdown and mousedown over (MAN-9062).
- Focus: into the prompt when capture starts; to `Bind` when it ends, only if focus fell to the body.
- `refusal` replaces the helper: `role=alert`, amber, ▲; the sentence already says what to use.
- A parent's capture MUST pass a left press on `[data-talk-binding-cancel]` over, or Cancel cannot be clicked with the mouse.

## Mounting
| place | does |
|---|---|
| `CompanionProvider` | calls `useTalkPress(speech)` once (`speech` = `useCompanionVoice`'s `{ unlock, cutOff, release }`, MAN-9113) and `useTalkBinding(picture?.settings.talkBinding ?? null, talk.toggle)`; `talk` is a member of `useCompanion()` (MAN-9083, MAN-9101) |
| `CompanionPanel` | `talk` from `useCompanion()` → `CompanionPanelView talk={talk}` → `CompanionComposer talk`; `useCompanionPresence()` → `CompanionPanelView presence` → `CompanionHeader` |
| `CompanionComposer` | `{talk && <CompanionTalkButton state error onToggle name />}` in `[data-companion-talk-slot]`; `talk.error` in `p[data-companion-talk-error]` |
| `CompanionSettingsSection` | `useTalkBindingCapture((talkBinding) => save({ talkBinding }))` (MAN-9101) → `talkBinding={<TalkBindingField label={settings?.talkBinding?.label ?? null} … />}` |
- The talk button, the bound key or mouse button, and a press in the floating chat's picture-in-picture window are the SAME press: one `talk`, one mic.

## Proof
`.verify/kaylee-talk-scaffold.sh`: MAN-9095 (the views on fixtures). `.verify/kaylee-talk-whole.mjs`: MAN-9100 (the whole plan on the live page).

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionTalkButton.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/TalkBindingField.tsx

## MAN-9094 — src/modules/settings/tabs — Settings > Voice: the chat mic's provider picker and the Gemini section

Views drawn from props; the tab binds them. Server side: `server/modules/voice/` (`saveGeminiKey`, `saveVoiceSettings`, `geminiKeyStatus`): MAN-9098. Kaylee's own section in the same tab: MAN-9062.

## `VoiceSettingsTab` — section order
1. Voice on/off.
2. Voice on only: backend section (`voiceSettings.backendTitle`) — the OpenAI-compatible fields.
3. `GeminiVoiceSection`, voice on or off.
4. `CompanionSettingsSection`, voice on or off.
- Rule: with Gemini picked, only the `voiceSettings.sttModel` field leaves; its row goes `sm:grid-cols-4` → `sm:grid-cols-3`. Base URL, API key, TTS model, voice, format, the note and the section's sentence stay. why: read-aloud uses that backend whatever the picker says; the picker governs the chat mic alone.
- Kaylee hears through Gemini whatever the picker says.

## Mounted
- The tab's head reads `useVoiceSettings()` (`src/modules/settings/hooks/useVoiceSettings.ts`): `{ settings, keyStatus, saving, error, providerRefusal, saveSettings, saveKey, clearKey, retry }`. `openaiPicked = (settings?.provider ?? 'openai') === 'openai'`.
- `VoiceProviderPicker` is first in the backend section (voice on); `GeminiVoiceSection` sits before `CompanionSettingsSection`, voice on or off, with `onRetry={retry}`; its `keyStatus` prop is `GeminiKeyStatus | null` (`src/shared/types.ts`, beside `VoiceProvider` and `VoiceSettings`).
- `VoiceSettingsTab` hands the Gemini section the stored speech rows: `speechModel`, `voice` and `soundTags` read from `settings.gemini` (undefined while the settings are unread, so no row stands over a value the page cannot see), and saves each through `saveSettings({ gemini: { transcriptionModel | speechModel | voice | soundTags } })` (`soundTags`: the whole list, or `null` for Restore). The server's rules for them: MAN-9102; the list's one home: INV-9938.
- The picker's `onChange` saves only a provider other than the one picked (`pickedProvider`): the option already picked sends nothing. A refused provider save leaves the picker where it was and its sentence (`providerRefusal`, `[data-voice-provider-refused]`) stands under the picker; the Gemini card's `error` line, two sections below, carries the same sentence.
- `GET /api/voice/settings` is read once on mount (and again on `retry`); nothing is optimistic.
- `saveSettings(patch)` and the key saves run one at a time in the order made, through one queue; a read that was out when a save landed is dropped as older.
- A save that carried `provider` and landed dispatches `VOICE_CONFIG_SYNC_EVENT`, after the server's answer. why: the chat's `useVoiceProvider` and `useVoiceAvailable` re-read on it, so an open composer follows the picker in the same tab.
- The key is passed to `api.voice.saveGeminiKey(key)` (`PUT /api/voice/gemini-key`) and never held by the hook; the answer is `{ key: GeminiKeyStatus }`.
- `api.voice.{ settings, saveSettings, saveGeminiKey, clearGeminiKey }` (`src/shared/api.ts`) are the only places these URLs are written. `settings` and `saveSettings` answer `{ settings, key }`; `saveSettings` takes a `Partial<VoiceSettings>`.

## `VoiceProviderPicker` — props `value: 'openai' \| 'gemini'`, `onChange`
Kit `Field` (label `voiceSettings.provider.label` — `Speech to text`, helper `…provider.help`) around a `SegmentedControl` (radio group, arrows move the choice): `OpenAI-compatible` \| `Gemini`. The control sits in a block `div`, so the tray is as wide as its words.

## `GeminiVoiceSection` — props
| prop | meaning |
|---|---|
| `keyStatus` | `{ source: 'stored' \| 'house' \| 'none'; last4: string \| null }`; `null` while the account's settings are read |
| `transcriptionModel` | the stored model name |
| `saving` | a save is out: Save/Replace/Clear are busy |
| `error` | the server's sentence for the last refused save; with `keyStatus` null, the read that failed |
| `onSaveKey(key)`, `onClearKey()`, `onTranscriptionModel(model)` | the saves |
| `speechModel?` + `onSpeechModel?` | both given: the Speech model row (`[data-gemini-speech-model-field]`, placeholder `gemini-3.8-flash-tts`, `MODEL_SHAPE`); its helper names `gemini-3.8-flash-lite-tts` as the cheap choice, the name held whole (`WholeWords`) |
| `voice?` + `onVoice?` | both given: the Voice row (`[data-gemini-voice-field]`, placeholder `Kore`, `VOICE_SHAPE` `^[A-Za-z0-9_-]{1,40}$`, the server's `VOICE_PATTERN`) |
| `soundTags?` + `onSoundTags?` | both given: the card's last row, `SoundTagsField`; `onSoundTags(null)` restores Google's set |
| `onRetry?` | draws `Try again` on the failed-read banner |
- Absent, a row is not drawn. Row order: API key, Transcription model, Speech model, Voice, Sound tags.
- `keyStatus === null`: `[data-gemini-voice=loading]` waiting card; with `error`, `[data-gemini-voice=failed]` warn `Banner` (+ `Try again` when `onRetry`), no fields. why: a field over a value the page cannot see overwrites a good one.
- Ready: `[data-gemini-voice=ready]`, a divided `SettingsCard` of the rows given (API key and Transcription model always), then `p[data-gemini-voice-save]` = `saving` \| `refused` \| `idle` (always mounted).
- Key line under `API key` (`[data-gemini-key]` = source): `✓ Using your key ending <last4>`, `✓ Using the house's key` (positive), `▲ No key: Gemini is off` (warn).
- Key field: `type=password`, `[data-gemini-key-field]`; Enter or `Save` (`Replace` once stored) sends; `Clear` only while `stored`.
- The three name rows are one component, `GeminiNameField` (`voice-settings/sections/GeminiNameField.tsx`; props `label`, `help`, `invalid`, `stored`, `placeholder`, `shape`, `hook`, `saving`, `onSave`): `[data-gemini-<hook>-field]`, saved on blur or Enter, only when changed and valid; follows the stored value while untouched; a name sent is not sent again until no save is out (Enter then blur sends once).
- Model field: `[data-gemini-model-field]`, placeholder `gemini-3.8-flash`.

## `SoundTagsField` — props `tags`, `saving`, `onChange(tags \| null)`
- Root `[data-gemini-sound-tags]` = the count. The list in its order as kit `Chip`s (`action`), each a press that removes it, named `Remove <tag>`, ✕ glyph; `[data-gemini-sound-tag]` on the word. The last one left is a static chip (no ✕) with the line `At least one sound stays on the list.`
- Under `(pointer: coarse)` each removable chip is `min-h-11` (44px) and the gap `gap-2`. why: a press removes at once, and a miss takes the neighbour.
- Focus after a removal: once the list no longer holds the sound, the chip now at its index (the last chip if it was last), or the add field when only the static last chip is left; a refused removal leaves focus where it was; a focus moved elsewhere meanwhile is not taken. A `useEffect` on `tags` and `saving`; refs only.
- Add: one `form`, the API key row's shape: `[data-gemini-sound-tag-field]` (`basis-48`) + `Add` (Enter too), the line `basis-full` under them. Typed words are read as the parse reads a tag: trimmed, spaces collapsed, lower case. Refused under the field, `role=alert`, amber ▲: not `^[a-z]+(?: [a-z]+)*$` or over 24 characters; already listed (`“hum” is on the list already.`). At 30, `Add` waits and a line says so; the field stays live (keeps focus).
- The typed word stays until the list holds it: a refused add loses nothing; the server's sentence is the card's last line.
- `Restore Google's set` (`[data-gemini-sound-tags-restore]`) is the `SettingRow`'s control, `outline` `sm` with `RotateCcw`, as the register's `Restore the original` (`CompanionSettingsForm`, MAN-9062): beside the title while there is room, under it on a phone. It opens a `ConfirmDialog` (`z-[10000]`; Cancel, Restore destructive), then `onChange(null)`. why: it drops every sound he added; the server holds Google's set, the page no copy. One tab, one way to draw a restore.
- Nothing optimistic; while `saving`, every chip, `Add` and Restore are `busy`. why: the next list is made from the one drawn.

| rule | why |
|---|---|
| `TAG_SHAPE`, `MAX_TAGS` 30, `MAX_TAG_CHARS` 24 mirror the server's `checkSoundTags` (`server/modules/voice/voice-settings.ts`) | edited together |

| rule | why |
|---|---|
| `KEY_SHAPE` `^[\x21-\x7e]{20,200}$`; a typed key that fails says `A Gemini key is 20–200 plain ASCII characters with no spaces.` (`voiceSettings.gemini.keyInvalid`) under the field and is not sent | the server's `saveGeminiKey` limit (`gemini-key.ts`, MAN-9098); edited together |
| `MODEL_SHAPE` `^[A-Za-z0-9._-]{1,80}$`; invalid says why in place of the helper | the server's `MODEL_PATTERN` (`voice-settings.ts`); edited together |
| The key field empties the moment a key is sent; the key is never shown back beyond `last4` | no key stands in the page after its save |
| `Clear` opens a `ConfirmDialog` (`Forget your Gemini key?`: `Cancel`, `Forget the key`); `onClearKey` runs only on `Forget the key` | a forgotten key cannot be shown again |
| That `ConfirmDialog` takes `wrapperClassName="z-[10000]"`; it opens only while `stored` | Settings is a body portal at `z-[9999]` (MAN-9090); a key cleared elsewhere leaves nothing to ask |

## Proof
`.verify/kaylee-talk-scaffold.sh`: MAN-9095. `.verify/kaylee-talk-chat-mic.mjs [--stub]` runs the tab and the chat's mic on :5183 as account 1: the picker, the key set ("… ending KE12") and cleared, the model saved on blur (the PUT answered by the probe), the mic shown and hidden with the picker over the same open composer, and the clip sent to `/api/voice/transcribe` as `audio` with no `x-voice-*` header. `--stub` answers `/api/voice/transcribe` itself (no Gemini call) and adds the refusal sentence at both sizes and themes; without it, one live transcription of the fixture clip.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/hooks/useVoiceSettings.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/voice-settings/sections/GeminiNameField.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/voice-settings/sections/GeminiVoiceSection.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/voice-settings/sections/SoundTagsField.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/voice-settings/sections/VoiceProviderPicker.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/VoiceSettingsTab.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-talk-chat-mic.mjs

## MAN-9095 — src/modules/companion — Proof — .verify/kaylee-talk-scaffold.sh (the talk press, the binding row, the chat mic's picker and the Gemini section)

```bash
bash .verify/kaylee-talk-scaffold.sh [--evidence <dir>] [--only fixtures|live]
node .verify/kaylee-talk-scaffold.mjs [--evidence <dir>] [--before <url>] [--only fixtures|live]
```
- Gitignored (`.verify/`): on disk only. Pieces: MAN-9093 (talk press), MAN-9094 (Settings > Voice). Live client `:5183`; no Gemini call, no model turn.
- Exits 1 on any FAIL; zero console errors from either half. Photographs: `.verify/shots/kaylee-talk-scaffold/` + `shots.json`.
- Photographs 1440×900 and 390×844, light and dark.

## Fixtures (`lib/talk-fixtures.mjs`, `lib/talk-kit.mjs`)
- `talk-kit.mjs` mounts the app's own components over the live page through `mountReact.mjs`: her panel (`CompanionPanelView` on `companion-fake.ts`) in the workspace shell's fixed box with a fake `talk`, and the talk button in the panel's `[data-companion-talk-slot]`. Settings > Voice is the LIVE modal (`voiceEnabled` pinned on, nothing written): the picker first in the backend section, the Gemini section after it, her live section replaced by `CompanionSettingsView` on `FAKE_SETTINGS` with the binding row in `talkBinding`.
- Every press is recorded in `window.__talkKit.events`, none acted on.
- Checks: the button per state (name, plain button, 32px, before send, ring only listening, spinner only transcribing, taken in every state); status line per press (also over `thinking`, `failed`, `loading`); the error right above the box, amber, announced, inside the panel, standing over nothing with a draft docked; the log's spoken and empty lines; the picker hands its value and drops only the speech-to-text field on Gemini; the Gemini section per key source, refused, waiting, unread; a short key refused under its field, a good one sent on Enter and gone from the page; the model saved on leaving its field only when valid; Clear asks first; the binding row's focus follows capture and `data-talk-binding-capture` exists only while capturing.

## Live (`lib/talk-live.mjs`, `lib/talk-probe.mjs`)
- Her panel (from her door: the rail's door, or her disc docked in its cell) and Settings > Voice, as they stand. Settings > Voice asserts the sections `Voice`, `Backend`, `Gemini`, `Companion` in that order, the six OpenAI-compatible fields, picker 1, Gemini section 1, binding row 1 (`lib/talk-live.mjs:141`: the row is mounted, MAN-9093 §Mounting). Her panel's live check asserts the talk button mounted in its slot (`[data-companion-talk-slot]` holds 1 child of width > 0, `[data-companion-talk]` 1) and her own status line (not Listening or Transcribing). The whole plan on the live page: `.verify/kaylee-talk-whole.mjs` (MAN-9100).
- With `--before`, her panel on an untouched client: the DOM must be identical (exact) and the picture within `ANTI_ALIASING_ALLOWANCE` = 8 pixels. The `voice-*` surfaces are not paired: the untouched client has no picker or Gemini section. The one live redraw, his empty spoken line ("Nothing heard"), is photographed as drawn and set aside on both before the pair is compared.
- Opening her panel takes account 1's floor; opening Settings makes the app's own settings write.

## The untouched client (`kaylee-talk-scaffold.sh`)
- A scratch Vite on `TALK_BEFORE_PORT` (default 5197) through `lib/vite-scratch-before.config.mjs`: the files in the script's `BEFORE_FILES` are served as git HEAD holds them, everything else as the tree has it; it proxies to the dev API `:3011`, read only. Its dependency cache is a scratch directory, never `node_modules/.vite`.
- Refuses to start when the port listens. Kills only a pid that is a plain number above 1 whose command line is vite; removes only its own `mktemp -d` scratch.
- A phase that changes another live client file adds it to `BEFORE_FILES`.
- `lib/vite-scratch-before.config.mjs` also serves a snapshot directory (`PNH_BEFORE_DIR`) in place of git HEAD, and `lib/talk-live.mjs` exports its comparers: MAN-9106.

## Measured
- 2026-10-27, before the fix-pass: 205 fixture checks and 38 live checks passed (12 pairs, 0 differing pixels in the final run), zero console errors. The fix-pass changed the probe's checks to match (Clear asks first, Try again, read-aloud's fields stay on Gemini) and did not re-run them.
- `lib/talk-fixtures.mjs` is 294 lines (ceiling 300): a new check goes in a new lib file.
- A reload from another session's edit kills a run; re-run.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-talk-scaffold.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-talk-scaffold.sh, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/talk-fixtures.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/talk-kit.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/talk-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/talk-probe.mjs

## MAN-9098 — server/modules/voice — the account's `voice` preference, its Gemini key, the settings routes and the transcribe provider branch

`server/modules/voice/` serves two speech-to-text backends per account: the OpenAI-compatible proxy (`voice.service.ts`, the default) and Gemini (`gemini-*.ts`), and it speaks Kaylee's sentences through Gemini (`gemini-speech.ts`, MAN-9105). `voice.module.ts` builds `voiceRoutes`; `server/index.ts` mounts it at `/api/voice` behind `authenticateToken`. The Gemini call itself: MAN-9099. Rules: INV-9908.

## Barrel — `index.ts`
| export | consumer |
|---|---|
| `voiceRoutes` | `server/index.ts` |
| `transcribeSpeech` (= `transcribeWithGemini`) | `companion/companion-press.ts`: every press, whatever the chat's provider says |
| `synthesizeSentence` | `companion/companion-speech.ts`: one call per sentence a floor page pulls (MAN-9105, MAN-9110) |
| `readVoiceSettings` | `companion/companion-account.ts`: `readSoundTags`, the account's `gemini.soundTags` read at the start of each turn (the parse) and at each push (the register). Inside the module: `gemini-transcribe.ts`, `gemini-speech.ts`, `voice-provider.ts`, the settings routes |
| `DEFAULT_SOUND_TAGS` | `.verify/companion-wire-contract.mjs` (the parse proven against the shipped set). Its one home is `voice-settings.ts`; the companion's filter and her register read the account's list through `readVoiceSettings` (INV-9938) |
| type `TranscribeAnswer` | `companion-press.ts`: tells a refusal from a failure |
| type `SpeechAnswer` | `companion/companion-speech.ts`: tells a refusal (`no_key`, `refused`, `failed`) from a stream |
- Types in `server/shared/types.ts`: `VoiceProvider`, `VoiceSettings`, `GeminiKeyStatus`, `TranscribeAnswer`, `SpeechChunk`, `SpeechAnswer`. The page mirrors the first three in `src/shared/types.ts`, with `VoiceSettingsPatch` (what `PUT /settings` takes; `soundTags: null` allowed).

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/gemini-key.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/gemini-speech.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/voice.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/voice-provider.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/voice.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/voice.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/voice-settings.ts

## MAN-9102 — server/modules/voice — the account's `voice` preference, its Gemini key, the — The `voice` preference — `voice-settings.ts`
section: server/modules/voice — the account's `voice` preference, its Gemini key, the settings routes and the transcribe provider branch/001 The `voice` preference — `voice-settings.ts`

- Stored under the `voice` key of the account's `user_preferences` (`userPreferencesDb`), as OVERRIDES: only fields the account set. why: a default the house later changes still reaches an account that never chose.
- Read fresh on every call, never cached: a saved change is heard by the next press.
- A stored field that fails its limit reads as its default (the generic `PATCH /api/user/preferences` can write any key).

| field | default | limit |
|---|---|---|
| `provider` | `openai` | `openai` or `gemini` |
| `gemini.transcriptionModel` | `gemini-3.8-flash` (the house's transcriber role) | 1–80 characters of `[A-Za-z0-9._-]` (`MODEL_PATTERN`). why: it becomes a path segment of the Gemini URL |
| `gemini.speechModel` | `gemini-3.8-flash-tts`; `gemini-3.8-flash-lite-tts` is the cheap choice | the same `MODEL_PATTERN` |
| `gemini.voice` | `Kore` | 1–40 characters of `[A-Za-z0-9_-]` |
| `gemini.soundTags` | `DEFAULT_SOUND_TAGS`: `giggle`, `chuckle`, `laugh`, `gasp`, `sigh`, `phew`, `tsk`, `breath`, `short pause`, `long pause` | 1–30 tags, each 1–24 characters of `[a-z]` words with single spaces between them (no blank tag, no leading or trailing space), none twice. `soundTags: null` in a patch drops the account's own list, so the default reads again |

- `gemini.soundTags` is the ONE allow-list of the sounds she may make: the register she is taught (`{sound_tags}`) and the filter that strips her sentences (`parseExpression`) both read it (MAN-9081). `DEFAULT_SOUND_TAGS` lives in `voice-settings.ts` and nowhere else; `readVoiceSettings` hands out a copy, never the shipped array.

- `provider` picks the backend of the chat composer's mic only. The companion hears through Gemini whatever it says; read-aloud (`POST /tts`, `GET /health`) stays on the OpenAI-compatible backend.
- `saveVoiceSettings(userId, patch)` merges a partial field by field (nested `gemini` included) and answers the settings as stored. Nothing is written when any field is refused. The read and the write have no `await` between them, so two saves cannot merge from the same stored value.

Refusals — all 400 `VOICE_SETTINGS_INVALID`, `details.field` as listed:
| patch | sentence | field |
|---|---|---|
| not an object | `The settings must be a JSON object.` | `settings` |
| a key other than `provider`, `gemini` | `<key, 40 characters at most> is not a voice setting; the fields are provider and gemini (transcriptionModel, speechModel, voice, soundTags).` | the key |
| `provider` not a listed word | `provider must be "openai" or "gemini".` | `provider` |
| `gemini` not an object | `gemini must be an object holding transcriptionModel, speechModel, voice, soundTags.` | `gemini` |
| `gemini.<other>` | `gemini.<other, 40 characters at most> is not a voice setting; the fields are gemini.transcriptionModel, gemini.speechModel, gemini.voice, gemini.soundTags.` | `gemini.<other>` |
| a model past its limit | `gemini.transcriptionModel must be 1 to 80 characters of letters, digits, dots, underscores and hyphens.` (likewise `gemini.speechModel`) | `gemini.transcriptionModel` or `gemini.speechModel` |
| `voice` past its limit | `gemini.voice must be 1 to 40 characters of letters, digits, underscores and hyphens.` | `gemini.voice` |
| `soundTags` not a list of 1–30 valid tags | `gemini.soundTags must be a list of 1 to 30 sound tags, each 1 to 24 lower-case letters with single spaces between words.` | `gemini.soundTags` |
| a tag listed twice | `gemini.soundTags lists "<tag>" more than once.` | `gemini.soundTags` |

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/gemini-key.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/voice.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/voice-provider.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/voice.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/voice.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/voice-settings.ts

## MAN-9103 — server/modules/voice — the account's `voice` preference, its Gemini key, the — The key — `gemini-key.ts`
section: server/modules/voice — the account's `voice` preference, its Gemini key, the settings routes and the transcribe provider branch/002 The key — `gemini-key.ts`

- Stored in `user_credentials` as `credential_type` `gemini_api_key` (`credentialsDb`), name `Gemini API key`, description `Voice: Gemini transcription and speech`. One key per account.
- `resolveGeminiKey(userId)` — order, read at call time and never cached:
  1. the account's stored active credential;
  2. `GEMINI_API_KEY` in the process environment (Python-stripped);
  3. the `GEMINI_API_KEY=` line of the file `GEMINI_ENV_FILE` names (default `/opt/shadow-connector/.env`);
  4. `null`: none.
- `resolveGeminiKey` is NOT in the barrel. Its readers are `gemini-transcribe.ts` and `gemini-speech.ts`.
- The env file is parsed as `~/.claude/scripts/gemini-image` `_read_api_key` parses it: lines split at Python's `str.splitlines()` boundaries, each stripped by Python's own whitespace set (`pythonStrip`), an `export ` prefix dropped, the name before the first `=` compared after stripping, the value stripped then stripped of quote marks, a line with an empty value skipped; the first line that yields a value wins. An absent or unreadable file is no house key.
- `geminiKeyStatus(userId)` → `{ source, last4 }`:
  | source | when | last4 |
  |---|---|---|
  | `stored` | the account has a stored key | its last four characters |
  | `house` | no stored key; step 2 or 3 yields one | `null` |
  | `none` | no key at all | `null` |
- Only `last4` of the account's OWN key is ever shown. The house's key is never shown, even in part. No answer carries a key.
- `saveGeminiKey(userId, key)`: 20–200 printable ASCII characters (`\x21`–`\x7e`: no space, no line break, nothing non-ASCII). why: the key rides an HTTP header, and a character that cannot be sent would pass the limit and fail later as a network error. Refusal: 400 `VOICE_SETTINGS_INVALID`, `details.field` `key`, sentence `key must be a string of 20 to 200 printable ASCII characters with no spaces or line breaks.`; the sentence never repeats the key. A body without a string `key` is refused the same way.
- The new `gemini_api_key` row is created FIRST, then every other row of the type is deleted, active or not. why: a failed insert leaves the earlier key standing instead of none.
- `clearGeminiKey(userId)` deletes all the account's `gemini_api_key` rows; its calls then use the house key (`source` `house`, or `none`).
- The page checks the same class before it sends (`KEY_SHAPE` `^[\x21-\x7e]{20,200}$`): MAN-9094.

## Routes — `voice.routes.ts`, `/api/voice`
| verb | path | body | answer |
|---|---|---|---|
| GET | `/health` | none | the proxy's own `{ configured }`, the same for every account (read-aloud's speaker reads it) |
| GET | `/settings` | none | 200 `{ settings: VoiceSettings, key: GeminiKeyStatus }` |
| PUT | `/settings` | a partial `{ provider?, gemini?: { transcriptionModel?, speechModel?, voice?, soundTags? } }` | the same shape; 400 `VOICE_SETTINGS_INVALID` |
| PUT | `/gemini-key` | `{ key }` | 200 `{ key: GeminiKeyStatus }`; 400 `VOICE_SETTINGS_INVALID` naming `key` |
| DELETE | `/gemini-key` | none | 200 `{ key: GeminiKeyStatus }` |
| POST | `/transcribe` | multipart `audio` (≤ 25 MB, memory) | 200 `{ text }`; see the next section |
| POST | `/tts` | `{ text }` | the proxy's audio stream |
- A `VOICE_SETTINGS_INVALID` answer is the app's envelope `{ success: false, error: { code, message, details } }` (MAN-9058 §Refusals); the page reads `message` through `refusalSentence`.
- 2026-10-27, live :3011: `GET /settings` → `{"settings":{"provider":"openai","gemini":{"transcriptionModel":"gemini-3.8-flash","speechModel":"gemini-3.8-flash-tts","voice":"Kore","soundTags":[the ten]}},"key":{"source":"house","last4":null}}`, `grep -c AIza` on the body → 0; `PUT /settings {"bogus":1}` → 400 `bogus is not a voice setting; the fields are provider and gemini (transcriptionModel, speechModel, voice, soundTags).`

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/gemini-key.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/voice.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/voice-provider.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/voice.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/voice.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/voice-settings.ts

## MAN-9104 — server/modules/voice — the account's `voice` preference, its Gemini key, the — `POST /transcribe` — the provider branch (`voice-provider.ts`)
section: server/modules/voice — the account's `voice` preference, its Gemini key, the settings routes and the transcribe provider branch/003 `POST /transcribe` — the provider branch (`voice-provider.ts`)

`createVoiceProvider(voiceService).transcribeForChat(userId, audio, overrides)`, called by the route with the upload (`mimeType` default `audio/webm`, `fileName` default `recording.webm`):
| account's `provider` | does |
|---|---|
| `openai` (default) | `voiceService.transcribe({ audio, overrides })` exactly as before; reads the browser's `x-voice-*` headers |
| `gemini` | `transcribeWithGemini(userId, audio)`; the `x-voice-*` headers are ignored |

On `gemini`:
| `TranscribeAnswer` | HTTP | body |
|---|---|---|
| `ok` | 200 | `{ text }`; `''` when the model reported no words (a silent clip is not certain to come back `''`: INV-9876, MAN-9099 §Standing defect) |
| `no_key`, `refused` | 409 | `{ error: <sentence> }` (a plain string, not the envelope). why: the person fixes both in Settings → Voice |
| `failed` | 502 | `{ error: <sentence> }` |
- Sentences: MAN-9099. The chat's `useVoiceInput` shows them as they came (MAN-9092).
- An upload multer refuses is 400 `{ error: <its message> }`; no `audio` part is 400 `{ error: 'No audio uploaded' }`.
- `GET /health` takes no part in this decision: it answers the proxy's `configured` with Gemini picked too. The composer's mic follows `GET /settings` (MAN-9092 §`useVoiceProvider`).

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/gemini-key.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/voice.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/voice-provider.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/voice.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/voice.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/voice-settings.ts

## MAN-9099 — server/modules/voice — `transcribeWithGemini`: the generateContent call, the three refusals, the key rules and what is never counted

`transcribeWithGemini(userId, audio: VoiceAudioUpload): Promise<TranscribeAnswer>` (`gemini-transcribe.ts`) turns one clip into the words spoken, for one account. It never throws for an expected failure. Settings, key and routes: MAN-9098. Rules: INV-9908. Open defect: INV-9876 (§Standing defect).

| consumer | reaches it as |
|---|---|
| `voice-provider.ts` | the chat composer's mic when the account's `provider` is `gemini` |
| `companion/companion-press.ts` | the voice barrel's `transcribeSpeech`: every press of the talk button |

## Answer — `TranscribeAnswer`
| answer | when | `sentence` |
|---|---|---|
| `{ ok: true, text }` | the model answered; `text` is trimmed; `''` when it reported no words or only a bracketed note (`[no speech]`). A silent clip is not certain to come back `''` (§Standing defect) | – |
| `{ ok: false, reason: 'no_key' }` | no key in reach (MAN-9098 §The key); NO request is made | `No Gemini key: set one in Settings → Voice` |
| `{ ok: false, reason: 'refused' }` | HTTP 401 or 403, or a 400 whose error names the key (`API_KEY_INVALID` in the body, or `api key` in Google's message, case-insensitive) | `Gemini refused the key: <Google's message>` |
| `{ ok: false, reason: 'failed' }` | any other status, a network error, a timeout, a reply with no text | `Gemini could not transcribe this: <why>` |

`<why>` of `failed`:
| cause | `<why>` |
|---|---|
| another HTTP status | `HTTP <status>: <Google's message, else the first 300 characters of the body, else HTTP <status>>` |
| no answer in time | `no answer within 60 s` |
| network error | the error's message, then ` (<cause's message>)` when it has one |
| `promptFeedback.blockReason` and no candidate | `the request was blocked (<reason>)` |
| no candidate | `the answer held no candidate` |
| candidate with no text and `finishReason` other than `STOP` | `the answer held no text (finish reason <reason>)`; `missing` when the reply names none |

HTTP of each reason on the chat route: `no_key`, `refused` → 409; `failed` → 502 (MAN-9098 §`POST /transcribe`). On the press door: 409 `COMPANION_SPEECH_REFUSED`, 502 `COMPANION_SPEECH_FAILED` (MAN-9059 §Press).

## The request
- `POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`; `<model>` = the account's `gemini.transcriptionModel` through `encodeURIComponent`.
- Headers: `x-goog-api-key: <key>`, `Content-Type: application/json`.
- Body: `{ contents: [{ role: 'user', parts: [{ text: TRANSCRIPTION_INSTRUCTION }, { inline_data: { mime_type, data: <the clip, base64> } }] }], generationConfig: { temperature: 0 } }`. The clip rides inline; no Files API.
- `TRANSCRIPTION_INSTRUCTION`: transcribe verbatim, in the language spoken; output only the words, no commentary, labels, timestamps or quotation marks; if the audio holds no spoken words at all (silence, room noise, a click, breathing, music) output exactly `[no speech]` and nothing else; never write words that were not spoken. why: asked to transcribe 2 s of digital silence under "output nothing", the model wrote a question nobody asked; the mark gives it a word to say. It does not make a silent clip come back `''` (§Standing defect).

## MIME mapping — `geminiMimeType`
| recorder's type | sent as |
|---|---|
| `audio/mp4` (Safari's AAC) | `audio/m4a` |
| any other | the base type lower-cased, parameters dropped (`audio/webm;codecs=opus` → `audio/webm`) |

## Retry and bound
- Every attempt carries `AbortSignal.timeout(60_000)`.
- ONE retry, after 2 s, when the first answer is 429 or 503. Any other status, a network error and a timeout are not retried. So a call can run 60 + 2 + 60 s.

## Reading the reply — `readTranscript`
- The text is candidate 0's parts that are strings and not `thought: true`, joined, trimmed.
- Empty text with `finishReason` `STOP` is a success with `text` `''`.
- A whole answer that is one bracketed note — `[no speech]`, `[silence]`, `(inaudible)`; `ANNOTATION_ONLY`: `[…]` or `(…)` of 1–40 characters on one line, an optional trailing `.` — is a success with `text` `''`. Words with a bracket inside them are kept whole.

## The key — rules of this file
- The key is resolved per call (`resolveGeminiKey`, MAN-9098).
- It rides the `x-goog-api-key` header only: never the URL, a log line or a sentence.
- Every sentence returned passes `redactKey` (`gemini-errors.ts`, shared with `gemini-speech.ts`, MAN-9105): the key's own text, and anything shaped `AIza[0-9A-Za-z_-]{20,}`, becomes `[key]`. The status, message and failure helpers (`isRetryableStatus`, `googleMessage`, `namesTheKey`, `describeFetchFailure`, `parseJsonObject`) live there too.

## Standing defect — INV-9876
- A clip with no words in it, longer than the press door's 0.4 s empty-press floor, can still come back as invented words under the current instruction. 2026-10-27, `gemini-3.8-flash`, 2 s of silence, two runs of INV-9876's probe: `I'll do that`, then `the world's most`.
- Both are `ok` answers. The press door logs and pushes them as his line (MAN-9059 §Press); the chat mic fills the composer with them.
- Nothing in this file separates them from speech: read an `ok` text as what the model heard, not proof that something was said.

## Never counted
- The door carries no `admit`, no `record` and no budget name. Operator, 2026-10-26: "Kaylee doesn't count for the budget." The chat mic on Gemini rides the same door and is not counted.
- Measured (MAN-9059 §Press): after a live press, `/opt/shadow-connector/state/gemini_plan_spend/` gained no file.

## Log
- One line per call, never the key: `[voice] gemini transcribe <model> <clip bytes> B <ms> ms → ok|no_key|refused|failed`. The journal is shared: a probe names its call by the bytes it uploaded (the fixture posted by curl is 122924 B, MAN-9100).

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/gemini-errors.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/gemini-transcribe.ts

## MAN-9100 — Probing Kaylee — the spoken probes: the fixture clip `kaylee-what-chats-are-working.wav`, its maker `.verify/kaylee-clip.mjs`, and which probe feeds it

Every spoken probe of kaylee--talk feeds one clip, so none synthesizes speech again. Her model on `haiku` first (MAN-9088 §Rules). `.verify/` is gitignored: on disk only.

## The clip — `.verify/fixtures/kaylee-what-chats-are-working.wav`
| fact | value |
|---|---|
| words | `What chats are working?` |
| voice | Gemini `gemini-3.8-flash-lite-tts`, voice `Kore`, style `plain, clear, unhurried` |
| format | RIFF WAV, PCM, 1 channel, 16-bit, 24 kHz |
| size | 122924 bytes = 44-byte header + 122880 bytes of samples = 2.56 s (2026-10-27, `wave` module) |
| heard as | `What chats are working?` through `transcribeWithGemini` on `gemini-3.8-flash` (MAN-9059 §Press) |

## The maker — `node .verify/kaylee-clip.mjs`
- File present: prints `the fixture clip is already made; no Gemini call`, the path, bytes and seconds; exit 0 (run 2026-10-27).
- File absent: ONE Gemini call, then the file is written and kept for good.
  1. `POST https://generativelanguage.googleapis.com/v1beta/interactions` with `stream: true`, `response_format: { type: 'audio', mime_type: 'audio/l16' }`, `generation_config.speech_config: [{ voice: 'Kore' }]`; the audio is every `step.delta` whose `delta.type` is `audio` (base64 PCM), up to `interaction.completed`.
  2. Only if Google refuses that shape (non-2xx): ONE fallback, `generateContent` with `responseModalities: ['AUDIO']`.
- A stream that ends without `interaction.completed` after some audio throws and writes NO file. why: the file is written once and kept; half a sentence is not the fixture.
- An Interactions answer with no audio step: the whole answer is kept at `$TMPDIR/kaylee-clip-answer.<pid>.txt` and the run fails. why: reading it differently never costs a second call.
- The key is read as `~/.claude/scripts/gemini-image` reads it (`GEMINI_API_KEY`, else the `GEMINI_API_KEY=` line of `GEMINI_ENV_FILE`, default `/opt/shadow-connector/.env`) and never printed; every message passes a `AIza…` → `[key]` redaction.
- Exit 4: no key. Exit 3: the call or its reading failed.
- To change the words: delete the file and run the maker once, knowingly.

## Who feeds on it
| probe | how | Gemini calls |
|---|---|---|
| `.verify/kaylee-press-refused.sh` | posts the file to `POST /api/companion/press` on a scratch server with no key in reach (MAN-9059 §Press) | 0 |
| `.verify/kaylee-press-live.sh` | curl as account 1 on :3011: the file with `durationMs` 2200, then its first 4800 samples as a 0.2 s clip (`durationMs` 200) | 1 (the short clip is the empty press) |
| `.verify/kaylee-talk-chat-mic.mjs` | Chromium fake mic; the chat's mic (MAN-9092, MAN-9094) | 0 with `--stub`, else 1 |
| `.verify/kaylee-talk-whole.mjs` | Chromium fake mic; the whole plan once on :3011 / :5183 (below) | 2 |
| `.verify/mic-recorder-move.mjs`, `.verify/kaylee-talk-scaffold.sh`, `.verify/kaylee-talk-binding-*` | no clip: a stubbed `getUserMedia`, fixtures, or a hook mounted alone | 0 |

- Chromium's flags: `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<wav>%noloop`. `%noloop` plays the file once per stream; the page records the browser's own container (webm), not the wav, so its journal byte count differs from the file's.

## `kaylee-talk-whole.mjs [--steps 1,2,3] [--stub-chat-mic]` — the plan once
| step | shows |
|---|---|
| 1 | no binding: the back button navigates (the control) |
| 2 | Settings > Voice > Companion: a plain `K` and a left click each refused with their sentence; Escape cancels; the back button bound as `Mouse back`, and the page does not navigate |
| 3 | a spoken press with an application in the drawer: Listening and no navigation; again after 2.5 s: Transcribing, then his line and her answer naming real chats; photographed at 1440×900 and 390×844, light and dark, in the one press |
| 4 | the panel's talk button twice within 0.4 s: `Nothing heard`, her short answer, no transcription call |
| 5 | the chat in its picture-in-picture window (Ctrl+.): the back button there records; with her panel closed a press does not open it |
| 6 | Gemini picked for the chat's mic: 2.5 s recorded on a scratch chat fills the composer (`--stub-chat-mic` answers `/api/voice/transcribe` from the probe) |
| 7 | the Gemini spend ledger's listing before and after (unchanged); the journal's `[voice] gemini transcribe` lines of THIS run's clips |
| 9 | failures answered by the probe's own routes: a refused hearing returns to idle with no page error; an unsent clip, a server sentence and a refused mic are the page's error until the next press; a press while a clip is out records anew |
- Back-button presses go through a CDP session's `Input.dispatchMouseEvent` (`button: 'back'`), which Playwright's mouse cannot send.
- It puts back the binding (through Settings' Clear), the model and the provider, and deletes its scratch chat. Her log keeps the lines of the presses.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/fixtures/kaylee-what-chats-are-working.wav, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-clip.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-talk-whole.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/talk-whole-kit.mjs

## MAN-9101 — src/modules/companion — `useTalkPress` and `talk` on the context, the binding capture `useTalkBindingCapture`, and the press the page sends

The page's one talk press and the capture that binds it. The press's types and views: MAN-9093. The key/mouse rule and the listener: MAN-9062 §`useTalkBinding`. The server's side: MAN-9059 §Press. The recorder: MAN-9092.

## `useTalkPress(voice): TalkPress` (`hooks/useTalkPress.ts`)
- Called ONCE, by `CompanionProvider` (`context/CompanionContext.tsx`), handed the page's voice (`{ unlock, cutOff, release }` of `useCompanionVoice`). A second call is a second mic and a second state.
- `toggle()` asks the voice before the mic: `unlock()` first, inside the press's gesture; the press that OPENS the mic calls `cutOff()`, which holds her voice while he records and, when she is sounding or a sentence is queued, stops her and sends the cut (`POST /api/companion/cut`); the press that ENDS the recording, a mic that never opened and a device that went away each call `release()`. The clip's upload awaits the cut's settling, so the cut is owed before the press is pushed. Detail: MAN-9113 §The cut on the press; the server's side: MAN-9111.
- `CompanionProvider` also calls `useTalkBinding(picture?.settings.talkBinding ?? null, talk.toggle)` beside it. why: the account's binding arrives with the picture's settings, so a re-bind on any page reaches every page by its `companion_settings` frame.
- `talk: TalkPress` is a member of `useCompanion()` (MAN-9083). Readers: the panel's talk button, the bound key or mouse button, and `useCompanionPresence` (`state`, into the status line's Listening and Transcribing).
- A press NEVER opens her panel; `POST /api/companion/press` takes the floor itself.

| `state` | when |
|---|---|
| `listening` | the recorder is `recording` (wins over everything) |
| `transcribing` | not recording and a clip is out: between the stopping press and the server's answer |
| `idle` | otherwise |

- TAP TO TALK: `toggle()` once opens the mic; again stops it and sends the clip. The mic is open only while `listening`: `useMicRecorder` closes its tracks on stop.
- LISTENING WINS: a press while an earlier clip is out records again at once; `transcribing` returns after it if a clip is still out. The count of clips in flight (`hearing`) is a number, not a flag. The server settles presses in arrival order (MAN-9059), so none is kept here.
- NO PRESS IS LOST: the intent (`wantedRef`) is set the moment a press lands, and what it asks of the recorder waits behind whatever an earlier press asked and has not finished (`turnRef`). why: the browser can take a moment, or a permission prompt for as long as the person likes, to hand over the mic, and the recorder refuses a second `start()` while one is pending.
- The clip goes out with `api.companion.press(blob, mimeType, durationMs)`: `durationMs` is `useMicRecorder`'s, so the server's 0.4 s empty-press rule reads the page's own clock. Nothing waits for the upload; the next press may record at once.
- A recording whose device goes away stops by itself and arrives through the recorder's `onEnded`: it is sent as his second press.
- A stop that finds no clip (the mic was refused, the page left) lowers the count and sends nothing.

`error` — only what failed on the page itself; it stays until the next press:
| cause | `error` |
|---|---|
| the mic could not open | the recorder's sentence: `Microphone access denied.`, `No microphone found.`, `Mic error: <message>` |
| the upload got no answer | `Your recording could not be sent.` |
| any other refusal | the server's own sentence (`refusalSentence`), else `Your recording could not be sent.` |
- 409 `COMPANION_SPEECH_REFUSED` and 502 `COMPANION_SPEECH_FAILED` are NOT an `error`: the server has already written them into her log as the system line `I could not hear that: <sentence>`; the state returns to `idle`. why: the sentence belongs in the conversation, once.

## `api.companion.press(blob, mimeType, durationMs)` (`src/shared/api.ts`)
- `POST /api/companion/press`, multipart: `audio` = the blob named `recording.<m4a|ogg|webm>` (`recordingFileName(mimeType)`, as the chat's mic names its upload) and `durationMs` = the rounded integer; header `x-companion-client`.
- Answers 202 `{ text }` once the press has been heard and pushed to her; the refusals are in MAN-9058 §Refusals. An upload has no deadline of its own.

## `useTalkBindingCapture(saveBinding)` (`hooks/useTalkBindingCapture.ts`)
Used by `CompanionSettingsSection`, which passes `saveBinding = (talkBinding) => save({ talkBinding })` (`PUT /api/companion/settings`, MAN-9087). Returns `{ capturing, refusal, begin, cancel, clear }` to `TalkBindingField` (MAN-9093).
- `begin()` (the Bind button): window listeners in the CAPTURE phase take the next `keydown` or `mousedown`, whatever has focus.
- `talkBindingFromEvent` (MAN-9062) answers the press: a binding → saved, capture ends; a refusal sentence → shown as `refusal` and the capture goes on, so the next press can be the right one.
- PASSED OVER (the capture waits): a modifier on its own (the start of a chord); a key with no nameable `code`; a mouse button past forward; any press on Cancel (`[data-talk-binding-cancel]`); the auto-repeat of the key that opened it (swallowed); a plain Tab.
- ESCAPE cancels from wherever focus is, Cancel included; the binding stays as it was. It is swallowed, so it never reaches the chat's Escape, which stops a running turn.
- An accepted press is swallowed whole (`preventDefault`, `stopPropagation`, `stopImmediatePropagation`): not the old binding's listener, not a dialog, not the browser hears it.
- The release of a mouse button the capture took — bound, or refused (left, right) — is swallowed too (`swallowRelease`): its `mouseup`, then its `click` (left) or `auxclick` (the others); the right button adds `contextmenu`. why: the back button's release would navigate back, a left click would land on what is under it.
  - The swallow is held at module level, not by the hook. why: the press that ends the capture unmounts the capture's listeners before its own release arrives.
  - The NEXT `mousedown` of any button ends the pairing. why: the press that binds removes the prompt it went down on, and a browser sends no click or auxclick to an element that left the page; without this the next real press of that button is lost.
- `clear()` saves `null`.
- A refused save shows the server's own sentence as `refusal`; a failure that carries none (the browser's `TypeError` of a request with no answer, or a throw that is no `Error`) shows `Your binding could not be saved.`
- While `capturing`, `TalkBindingField`'s root carries `data-talk-binding-capture`, which makes `useTalkBinding` pass every keydown, pointerdown and mousedown over (MAN-9062).

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/hooks/useTalkBindingCapture.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/hooks/useTalkPress.ts

## MAN-9105 — server/modules/voice — synthesizeSentence: Kaylee's voice from Gemini, the streamed Interactions call, the answer, the abort and what is never counted

`synthesizeSentence(userId, { text, style, signal }): Promise<SpeechAnswer>` (`gemini-speech.ts`) speaks one sentence of hers in the account's Gemini voice, streamed as PCM. `text` is the sentence's words as `utteranceOf` rebuilds them from her stored row (sounds written back as `<tag>`, MAN-9110), `style` its delivery. It never throws for an expected failure. Settings, key, routes: MAN-9098. The transcribing twin: MAN-9099. Rules: INV-9908. The sound-tag list's one home: INV-9938. Proof: `.verify/kaylee-voice-speech.mjs`.

| consumer | reaches it as |
|---|---|
| `companion/companion-speech.ts` (the speech door, MAN-9110) | the voice barrel's `synthesizeSentence`: one call per sentence a floor page pulls, aborted on the cut or the hang-up (MAN-9111) |

## Answer — `SpeechAnswer`
| answer | when | `sentence` |
|---|---|---|
| `{ ok: true, chunks }` | the FIRST audio has already arrived: `chunks` yields it, then the rest | – |
| `{ ok: false, reason: 'no_key' }` | no key in reach (MAN-9098 §The key); NO request is made | `No Gemini key: set one in Settings → Voice` |
| `{ ok: false, reason: 'refused' }` | HTTP 401 or 403, or a 400 that names the key | `Gemini refused the key: <Google's message>` |
| `{ ok: false, reason: 'failed' }` | any other status, a network error, a timeout, an `error` event before any audio, a stream that closes holding no audio | `Gemini could not speak this: <why>` |

- Failures before the first audio are ANSWERS, so the route can refuse with a status (409 `COMPANION_SPEECH_REFUSED`) before it commits to a 200 stream. A failure AFTER audio began makes the iterator THROW an Error whose message is the sentence (an `error` event; the stream closing before `interaction.completed`: `the audio stopped before Google finished it`; a dropped connection; `no answer within 60 s`). An abort on `signal` is not a failure: the iterator simply ends.
- `<why>` of `failed` before audio: `HTTP <status>: <Google's message, else the first 300 characters of the body, else HTTP <status>>`; `no answer within 60 s`; the fetch error's message and its cause's; `Google reported an error: <message>`; `the answer held no audio`; `the answer had no body`. The wording helpers are shared with `gemini-transcribe.ts` in `gemini-errors.ts` (`redactKey`, `googleMessage`, `namesTheKey`, `isRetryableStatus`, `describeFetchFailure`, `parseJsonObject`).

## The request
- `POST https://generativelanguage.googleapis.com/v1beta/interactions`, headers `x-goog-api-key: <key>` (nowhere else) and `Content-Type: application/json`, body `{ model, input: [{ type: 'user_input', content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style }] }] }], response_format: { type: 'audio', mime_type: 'audio/l16' }, generation_config: { speech_config: [{ voice }] }, stream: true }`. `model` = the account's `gemini.speechModel`, `voice` = its `gemini.voice`, both read fresh per call. A blank `style` sends no `annotations`.
- Google answers server-sent events. Measured 2026-10-27 on `gemini-3.8-flash-lite-tts`: `interaction.created`, `interaction.status_update`, `step.start`, then `step.delta` ×37 (each `delta.type` `audio`, `delta.data` base64 PCM), `step.stop`, `interaction.completed`. The event's name is its `event:` line, else the data's own `event_type`/`type`. Only audio deltas are read; `interaction.completed` ends it; an `error` event fails it.
- PCM is little-endian Int16, mono, 24 kHz. Every yielded piece is a WHOLE number of samples: an odd trailing byte is carried into the next piece (tested: deltas of 801, 600 and 599 bytes yield 800, 600, 600).

## Retry, bound, abort
- ONE retry, after 1 s, when the first answer is 429 or 503 (before any audio); the pause ends at once on an abort. Any other status and a network error are not retried.
- One 60 s bound on the whole call (the ask to the last byte).
- `signal` aborting ends the stream at once (a pending `next()` resolves done) and cancels the request, so nothing more is generated. A consumer that stops early (`return()` on the iterator, even before its first read) cancels it too and the call's line is written; an abort that lands before the first read delivers no piece (`firstThenRest` is a hand-written iterator for that reason: a generator's body does not start until its first `next()`). An already-aborted signal makes no request, and an abort before the first audio answers `{ ok: true, chunks }` with `chunks` empty (no `ok: false`). Measured: an abort after the first chunk ended the iterator in 1 ms, the replay server saw the connection close with 4 of 42 events sent.

## The key and the budget
- The key is resolved per call (`resolveGeminiKey`) and rides the header only; every sentence passes `redactKey`.
- NOT COUNTED (operator, 2026-10-26, "Kaylee doesn't count for the budget"): no `admit` before, no `record` after, no budget name. Measured: `/opt/shadow-connector/state/gemini_plan_spend/` listing identical before and after the paid proof.

## Log
- One line per call, written when it ends, never the key: `[voice] gemini speech <model> <characters> ch <bytes> B <ms> ms → ok|no_key|refused|failed|aborted`. `<bytes>` is the PCM delivered so far. Measured: `[voice] gemini speech gemini-3.8-flash-lite-tts 41 ch 138240 B 1322 ms → ok` (2.88 s of audio, first chunk 951 ms after the ask, 37 chunks of 1920–7680 B).

## Gotcha — the voice slurs "build is"
- `Okay so <short pause> the build is green!` with style `bright, warm, quick, a smile in the voice; delighted` is voiced, has a 340 ms pause where `<short pause>` stands, and nothing bracketed is spoken. It does NOT say "build is" clearly: Gemini's transcriber heard `Okay, so, the middle's green!` (lite) and `Okay, so the bill is green.` (flash-tts); faster-whisper `base` heard `Okay, so the bill's green!`. The delivered bytes are Google's, byte for byte (the PCM equals the base64 of the 37 stored deltas), so the slur is the voice's, not the module's. `.verify/kaylee-voice-speech.mjs` therefore judges that `green` was heard and that `short pause` was not spoken, and prints the words; a probe that must assert on "build" should choose a sentence without a fast contraction.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/gemini-errors.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/gemini-speech.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-voice-speech.mjs

## MAN-9106 — src/modules/companion — Proof — .verify/kaylee-voice-scaffold.sh (the voice switch, the speaking mark, Speaking and Cut, the Gemini section's voice rows)

```bash
bash .verify/kaylee-voice-scaffold.sh [--evidence <dir>] [--only fixtures|live]
node .verify/kaylee-voice-scaffold.mjs [--evidence <dir>] [--before <url>] [--only fixtures|live]
```
- Gitignored (`.verify/`): on disk only. Pieces: MAN-9062 (`CompanionVoiceSwitch`, the log's speaking mark), MAN-9089 (Speaking and Cut on the status line), MAN-9093 (`voice?: CompanionVoice`), MAN-9094 (`GeminiNameField`, `SoundTagsField`). Live client `:5183`; no Gemini call, no model turn.
- Exits 1 on any FAIL; zero console errors from either half. Photographs: `.verify/shots/kaylee-voice-scaffold/` + `shots.json`, at 1440×900 and 390×844, light and dark.

## Fixtures (`lib/voice-kit.mjs`, `lib/voice-fixtures-panel.mjs`, `lib/voice-fixtures-settings.mjs`)
- `voice-kit.mjs` mounts the app's own `CompanionPanelView` on `companion-fake.ts` (state `spoken`: a finished turn whose third sentence wraps and holds a sound) with a fake `talk` and `voice`, in the workspace shell's fixed box. Settings > Voice is the LIVE modal: its Gemini section is set aside and the fixture's `GeminiVoiceSection` stands in its place, driven by `FakeGemini`, a stand-in server: each save recorded, `saving` true in the same press and counted per save, the answer after `delay` ms, `soundTags: null` answered with `GOOGLE_TEN`, or refused with `refuse`.
- `GOOGLE_TEN` is checked against the server's `DEFAULT_SOUND_TAGS` in `server/modules/voice/voice-settings.ts`.
- Panel checks: the voice row on/off (name `Voice on this device`, glyph, the switch's right edge on Clear's, the controls row's picker and Clear unmoved, no row without `voice`); one sentence marked, the third, info tone, its sound inside, across wrapped lines, no character moved (paragraph height and every text node's first and last character); the band is a ground plus a same-colour ring, no underline; the status line for cut over listening, cut over speaking, listening after the cut, transcribing over speaking, speaking, voice off, no voice; a press on the switch and on its words each hand `!on`.
- Settings checks: rows in order (API key, Transcription model, Speech model, Voice, Sound tags); placeholders; the speech model helper naming `gemini-3.8-flash-lite-tts`, held whole; ten chips named `Remove <tag>`; ten plus one; an add read as the parse reads a tag, busy while out, the field emptied when it lands; taken and misshapen words refused under the field; a remove; Restore asking first, Cancel sending nothing, Restore sending `null`; a refused add keeping the word; the last tag; thirty; the two names saved trimmed on blur or Enter, once; misshapen names refused in the helper's place; the transcription model as before.

- Not asserted: the speaking mark's ink bar (the ring check passes on any shadow that contains the ground), the focus move after a removed chip, the 44px removable chip under `(pointer: coarse)`, Restore's place in the row's control slot (only that it exists).

## Live (`lib/voice-live.mjs`) — the wired panel
- Photographs her panel from her door (the rail's door, or her disc docked in its cell) and Settings > Voice at both sizes and themes, and asserts what is drawn now: the voice row once (`[data-companion-voice-row]`), no sentence marked while nothing is spoken, her status line neither Speaking nor Cut, the talk button in its slot, and the Gemini section's five rows in order (`WIRED_ROWS`: API key, Transcription model, Speech model, Voice, Sound tags) with the transcription field once and her three new fields.
- With `--before` every pair must DIFFER in its DOM (the untouched client has neither the voice row nor the three rows), and the panel's and the Gemini section's photographs too: another size (`compare` answers -1) or more than the anti-aliasing allowance. The Settings dialog crops (`voice-top`, `voice-gemini`, `voice-companion`) hold the Gemini section whatever the scroll, so their DOM differs and their picture is the crop's business (`WIRED`, `voice-live.mjs`).
- Measured 2026-10-28: `bash .verify/kaylee-voice-scaffold.sh --only live` exits 0, 40 photographs, no console error from either client. The live voice: `.verify/kaylee-voice-whole.mjs` (MAN-9113).
- Opening her panel takes account 1's floor; opening Settings makes the app's own settings write.

## The untouched client (`kaylee-voice-scaffold.sh`)
- A scratch Vite on `VOICE_BEFORE_PORT` (default 5198) through `lib/vite-scratch-before.config.mjs`, with `PNH_BEFORE_DIR=.verify/before/kaylee-voice-scaffold`: the files in `BEFORE_FILES` are served as that snapshot holds them, taken before the scaffold's first edit (kaylee--talk's work under it was not committed, so git HEAD was older than "before"); everything else as the tree has it. Without `PNH_BEFORE_DIR` the config serves git HEAD, as before.
- Refuses to start when the port listens or the snapshot lacks a listed file. Kills only a pid that is a plain number above 1 whose command line is vite; removes only its own `mktemp -d` scratch.

## Measured
- 2026-10-27, before review 1's fix-pass (Restore in the row's control slot, the speaking mark's ink bar, focus after a removed chip, 44px removable chips under a finger), which was not re-run: 128 fixture checks passed in one run, zero console errors. `.verify/kaylee-talk-scaffold.mjs --only fixtures` still passed its 207 checks after `GeminiNameField` took the transcription row.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-voice-scaffold.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-voice-scaffold.sh, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/vite-scratch-before.config.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/voice-fixtures-panel.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/voice-fixtures-settings.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/voice-kit.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/voice-live.mjs

## MAN-9110 — server/modules/companion — the speech door: GET /speech/:turnId/:index, the floor rule, the sentence rebuilt from its log row, the refusals and the request line

`GET /api/companion/speech/:turnId/:index` speaks ONE of her sentences to the page that holds the floor, as raw PCM streamed while Gemini synthesizes it. The page pulls (MAN-9113); the server never pushes audio. Verb: `companionService.speech` = `speak` of `createSpeech` (`companion-speech.ts`). The voice call: MAN-9105. The cache and `POST /cut`: MAN-9111. Not counted against any Gemini budget: the door asks none (INV-9908). Rules: INV-9939.

## Request
| part | rule |
|---|---|
| `x-companion-client` | REQUIRED: 400 `COMPANION_INPUT_INVALID` without it (MAN-9058 §Input). It must be the floor's, below |
| `:turnId` | `/^[A-Za-z0-9_-]{1,100}$/` (`readTurnIdParam`); else 400 naming `turnId` |
| `:index` | digits, no sign, no leading zero, 0–100000 (`readSentenceIndexParam`); else 400 naming `index` |
| `HEAD` | 405 `Allow: GET`. why: Express answers a HEAD with the GET handler, which would start a synthesis for a response that carries no audio |

## Checks, in this order (`serve`)
1. The request's client is not `store.readState().floor` → 409 `COMPANION_NOT_FLOOR`.
2. `speechCache.isCurrent(turnId)` is false → 404 `COMPANION_NO_SENTENCE`. The current turn is in memory: a server restart, Clear and shutdown leave none, so every sentence answers 404 until the next turn starts.
3. `speechCache.find(turnId, index)` holds an entry (finished, or still being synthesized) → joined: no second call, logged `(cache)`.
4. Otherwise `store.readSentence(turnId, index)` is `null` → 404. `utteranceOf` is `null` → 204, no entry cached, no call. Else `startSynthesis`: an entry put in the cache, `synthesizeSentence(userId, { text, style, signal: entry.abort.signal })`, logged `(gemini)`.
5. The request joins the entry (`joinEntry`) and waits for `entry.opened`: the first audio, or the refusal, thrown before a byte.

## Answers
| status | `code` | when | body |
|---|---|---|---|
| 200 | – | first audio arrived | PCM, little-endian Int16, mono, 24 kHz, whole samples per write; `Content-Type: audio/l16; rate=24000; channels=1`, `Cache-Control: no-store`, `X-Accel-Buffering: no` |
| 204 | – | nothing to say | none |
| 400 | `COMPANION_INPUT_INVALID` | a malformed param, or no client id | the field's sentence |
| 404 | `COMPANION_NO_SENTENCE` | not the current turn, an index the log holds no `kaylee` row for, or a cleared log | `She has no such sentence to say: it is not in her current turn.` |
| 409 | `COMPANION_NOT_FLOOR` | check 1 | `Another page holds the floor, so her voice plays there; this page shows her words only.` |
| 409 | `COMPANION_SPEECH_REFUSED` | `synthesizeSentence` answered `no_key` or `refused` | Google's sentence, e.g. `No Gemini key: set one in Settings → Voice` |
| 502 | `COMPANION_SPEECH_FAILED` | `synthesizeSentence` answered `failed` before the first byte | its sentence (key redacted) |
- Envelope: MAN-9058 §Refusals. The mapping is `geminiRefusal` (`companion-input.ts`), shared with the press door.
- A synthesis that fails or stops AFTER the first byte ends the response where the audio stopped; the status is already 200. The door writes `[companion] speech <turn>/<index>: the audio stopped early: <sentence>` on stderr (`fill`, `companion-speech.ts`) and drops the entry. `[companion] speech: the audio stream stopped before its end` (`streamPcm`) is the route's own catch for an iterator that throws, which `followEntry` does not. The write waits on `drain` or `close` between pieces.
- A page that hangs up (`response` `close`) aborts its request's signal; the synthesis stops when its LAST follower leaves unfinished. An entry that stopped before its end leaves the cache: half a sentence is never replayed.
- A second request for a sentence still being synthesized FOLLOWS it: the audio that has arrived, then each piece on a wake (no poll). One call serves both.

## The refusal's system line
- The first `no_key` or `refused` of a turn writes ONE `system` log line `I could not speak: <sentence>` (`claimRefusalLine(turnId)`); later refused sentences of that turn write none. A `failed` writes none. A panel write that throws is logged and does not change the answer.
- The page stops pulling that turn on a 409 (MAN-9113) and shows nothing of its own: the line arrives as a `companion_log` frame.

## The sentence, rebuilt from its log row (`companion-utterance.ts`, pure)
- Row: `companionDb.readSentence(userId, turnId, index)`, the newest `kaylee` row of that turn and index (`turn_id`, `turn_index`). The cache holds audio only; the words come from the row.
- `text` = the row's display `text` with each sound written back as `<tag>` at its offset `at` (clamped to the text), ordered by offset then by the order made. A space on each side of a tag, none outside at the start or end; `.,!?;:…` right after a tag closes up. The row is the one record the panel draws and the voice speaks.
- `style` = the account's `deliveryNote` (`readCompanionSettings`), or `<deliveryNote>; <mood>` when the sentence led with a mood; the mood alone when the note is empty; both empty = no style (no `annotations` in the request). why short: Google warns that a long style block makes the voice drift.
- Nothing to say = no letter or digit (any script) once `<…>` spans are removed, so `<short pause>` alone, or punctuation alone, answers 204.

## Log
- One line per request: `[companion] speech <turn>/<index> client=<id> → <status> (<cache|gemini>)`. The parenthesis is absent when the request was refused before either (404, 409 `COMPANION_NOT_FLOOR`, 204). A non-`AppError` throw logs 500.
- One `[voice] gemini speech …` line per call (MAN-9105). A probe counts requests and calls by these two.

## Proof
- `bash .verify/kaylee-speech-door.sh`: no Gemini call. `GEMINI_API_KEY` unset, `GEMINI_ENV_FILE` an empty file, `DATABASE_PATH` a `.backup` copy of `auth.db`, all under one `mktemp -d`. The real routes, door, cache, store and `synthesizeSentence`; stand-ins for her session (records `oweCut` and `interrupt`) and Google's host (a wrapped `fetch` answering server-sent events). Eight legs: no key and the 204s; the guards; a sentence streamed, then from the cache; the text and style Gemini was given, and a follower; a hang-up; the cut; refusals and failures; the 4 MB bound, the expiry, a new turn, shutdown. 2026-10-27: 50 of 50 checks passed.
- `node .verify/kaylee-speech-door-live.mjs`: curl against :3011 as account 1 with a `/ws` socket printing the `companion_*` frames; Kaylee on `haiku` (stops otherwise); exits 2 when account 1 holds a Gemini key of its own (`key.source` `stored`), since leg 3 stores a made-up key and deletes it; at most 2 Gemini calls on `gemini-3.8-flash-lite-tts`; the spend-ledger listing before and after.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/companion-input.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/companion.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/companion-speech.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/companion-utterance.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-speech-door-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-speech-door.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-speech-door.sh

## MAN-9111 — server/modules/companion — the speech cache and the cut: the bounds, POST /cut, oweCut and <cut heard interrupted/>

The door's audio is kept per account for the current turn (`companion-speech-cache.ts`), and a talk press while she speaks is the cut (`POST /cut`, `cut` in `companion-speech.ts`). The door: MAN-9110. The page's side of the cut: MAN-9113. What she is pushed: MAN-9080. Rules: INV-9939.

## The cache — one per account
- Made by `createCompanionAccount` (`speechCache` on `CompanionAccount`, MAN-9070). Shape: `Map<turnId, Map<index, SpeechEntry>>`.
- `SpeechEntry` = `{ pcm: Buffer[]; done: boolean; abort: AbortController; bytes; followers; opened; wakes }`.
  - `pcm` the audio so far. `done` true once no more will come (finished, failed or aborted). `abort` stops the synthesis underneath.
  - `opened` settles with `null` at the first audio, or with the `AppError` the door answers. `followers` counts the requests reading it. `wakes` are the requests waiting for more.

| verb | does |
|---|---|
| `startTurn(turnId)` | frees the audio of every earlier turn; `turnId` is the only speakable turn from now. Called by `onTurnStarted` BEFORE the `companion_turn` frame. why: a page pulls sentence 0 the moment its frame arrives |
| `isCurrent`, `find`, `put`, `remove` | the door's reads and writes; `remove` takes an entry out only while it is still the one held for that sentence |
| `trim()` | keeps the byte bound; called after each chunk lands |
| `abortTurn(turnId)` | the cut: aborts every unfinished synthesis of the turn, the freed ones (orphans) of that turn included, and answers how many it stopped. Finished sentences stay |
| `end()` | aborts every synthesis, forgets every turn AND the current one: Clear (`companionService.clear`, before the session is told) and `stopAll`. why: a sentence streaming to a page would hold the HTTP drain open |
| `claimRefusalLine(turnId)` | true once per turn: the turn's one `I could not speak` line (MAN-9110) |

| bound | value | behaviour |
|---|---|---|
| size | `SPEECH_CACHE_MAX_BYTES` = 4 MB per account (about 87 s of audio) | the oldest FINISHED sentence is dropped first; a sentence still being synthesized is never dropped for room, someone is listening |
| age | `SPEECH_CACHE_TTL_MS` = ten minutes after the LAST sentence was added | one `setTimeout` (`unref`), reset by each `put`, cleared when the audio is freed: an expiry, not a poll. It frees AUDIO only; the turn stays current, so a sentence asked after the gap is synthesized again (never a 404) |
| turn | the next turn starts | the earlier turns' audio is freed |

- ORPHAN: a synthesis in flight when its audio is freed (a new turn, the expiry) is not stopped. It finishes for the page that holds it, kept outside `turns` so no new request finds it, and still reached by `abortTurn(its turn)` and `end()`.
- An entry that stopped before its end (a failure, an abort, a hang-up) leaves the cache.

## `POST /cut`
- Request: JSON `{ turnId: string, heard: number | null, interrupted: number | null }`. Client id optional (checked when present). `turnId` as the speech route's. `heard` and `interrupted` are REQUIRED keys, each a whole number 0–100000 or `null`; a digit string, a negative, a missing key: 400 `COMPANION_INPUT_INVALID` naming the field (`readBodyTurnId`, `readBodySentenceIndex`).
- `heard` = index of the last sentence of that turn whose playback ENDED; `interrupted` = the index playing at the press. `null` = none.
- 204, answered AFTER her turn was interrupted (seconds, when her process is slow to answer).
- The press is the cut's only trigger: an alert never cuts her. It needs no floor and no current turn.

`cut(userId, { turnId, heard, interrupted })` (`companion-speech.ts`), in this order:
1. `speechCache.abortTurn(turnId)`: nothing more is spent on that turn.
2. `session.oweCut(textOf(heard), textOf(interrupted))`. `textOf(i)` = the display text of the turn's log row `i` (`store.readSentence`), `null` for a `null` index or a row the log no longer holds.
3. Log: `[companion] cut <turn> heard=<n|none> interrupted=<n|none>: <k> synthesis(es) stopped`.
4. `await session.interrupt()`: stops her running turn; with none, nothing.
- why 2 before 4: the press's own message can arrive while she is stopping and must already carry the cut.
- A turn the log no longer holds still stops her and owes a cut with both values empty.

## Owed, then carried
- `CompanionSession.oweCut(heard: string | null, interrupted: string | null)` → the assembler stores `{ heard ?? '', interrupted ?? '' }`. A later cut replaces one no message has carried yet. Clear drops it.
- The next message pushed to her (normally the press's own) carries `<cut heard="…" interrupted="…"/>` as its second part, after `<state>` (MAN-9080). Builder: `cutEnvelope(heard, interrupted)` (`companion-envelopes.ts`); each value is a display text escaped as an attribute (`&` `<` `>` `"`), `""` for none.
- The system prompt teaches it: `heard` is the last sentence that played to its end (empty when none), `interrupted` the sentence he cut off, which he heard only in part; nothing after those was heard.

## Proof
`bash .verify/kaylee-speech-door.sh` (MAN-9110) legs 6 and 8: a malformed cut is refused and owes nothing; a cut aborts the turn's syntheses, owes the two texts and interrupts her; the 4 MB bound, the expiry, a new turn and `end()`. The whole path with her real JSONL: `.verify/kaylee-voice-whole.mjs` step 2 (MAN-9113).

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/companion-speech-cache.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/companion-speech.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/session/companion-envelopes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/session/companion-message.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/session/companion-session-types.ts

## MAN-9112 — src/modules/companion — pcmPlayer: one AudioContext, gapless scheduling on the audio clock, onSentence, level and the synchronous stop

`createPcmPlayer(): PcmPlayer` (`utils/pcmPlayer.ts`) turns the speech door's PCM streams into sound, sentence after sentence with no gap. Private to the companion module (not in its barrel). The page's one is made by `useCompanionVoice` (`useState(createPcmPlayer)`, MAN-9113). Input: the format of `GET /speech` (MAN-9110): little-endian Int16, mono, 24 kHz, no container.

| caller | uses |
|---|---|
| `utils/speechPull.ts` | `enqueue`, `playing`, `lastEnded`, `stop` |
| `hooks/useCompanionVoice.ts` | `unlock`, and `onSentence` (hands the pull its `start` and `end`) |

## `PcmPlayer`
| member | does |
|---|---|
| `enqueue(turnId, index, body)` | plays the sentence after those already enqueued, reading `body` as it arrives. A chunk may end mid-sample: the odd byte is carried to the next chunk. Never throws. A body it cannot read (locked, or `null`) is logged and skipped. A `turnId`/`index` already queued is cancelled, not logged. A browser with no Web Audio is logged and its body cancelled |
| `stop()` | SYNCHRONOUS: stops and disconnects every scheduled source, cancels every body being read, empties the queue. No event follows. `playing()` is `null` in the same call. A sentence enqueued afterwards plays normally |
| `playing()` | the sentence between its `start` and `end` events, else `null`: before the first, after `stop()`, and for the instant between one sentence's `end` and the next one's `start` (two separate audio callbacks) |
| `lastEnded()` | the last sentence that sounded to its end; survives `stop()`. A stopped sentence is not one. A body that brought no audio is not one (its `end` is still sent) |
| `level()` | the analyser's RMS over its last 1024 samples (43 ms), 0..1. 0 when no context exists, the context is not `running`, or from the instant of `stop()` until the analyser window and one render quantum (128 frames) have passed: the cut audio is hidden, not left to fade |
| `onSentence(listener)` | `{ turnId, index, phase: 'start' \| 'end' }` for each sentence; answers the unsubscribe. A listener that throws is logged; the others still hear it |
| `unlock()` | makes or resumes the AudioContext. Call inside a gesture with nothing awaited first: the context is made and `resume()` called before the first `await` |

## The graph
- One `AudioContext` per player, made lazily by `unlock()` or the first `enqueue()`: a page that never speaks opens none. Made at 24 kHz so a buffer plays with no resampling (a buffer resampled one chunk at a time glitches at every edge); a browser that refuses gets its own rate and a warning.
- Every source → one `GainNode` → one `AnalyserNode` (`fftSize` 1024) → destination.

## Gapless scheduling
- Chunks go on the audio clock, never a timer. Each starts where the one before it ends, counted in whole samples since the run began: `startAt = runStart + runSamples / 24000` (a running sum of floats would drift).
- A new run begins only when nothing is scheduled ahead: the end of what is scheduled is under `currentTime` + `JOIN_GUARD_SECONDS` (0.01 s). It starts at `RESTART_LEAD_SECONDS` (0.05 s) past `currentTime`, rounded up to the context's sample grid.
- ORDER: a later sentence's chunks wait in `waiting` until every earlier body is over, so sentences never interleave.
- A body that fails partway is spoken as far as it got; the sentence ends there rather than hanging the queue.

## Events
- Nothing polls: the audio clock reports both. `start` = the `ended` of a silent one-sample marker scheduled at the sentence's first chunk. `end` = the `ended` of its last real buffer, once the body is over.
- `drain()` is the only place events go out: in enqueue order, `start` before `end`, whatever order the browser delivered the callbacks in. The join between two sentences reads as one instant.
- They fire when the audio thread renders the moment, which is the output latency (a few tens of ms) before it is audible.
- A body with no audio takes its turn: `start` then `end` back to back, so whoever waits on it (the pull) is not left waiting.

## Proof
`node .verify/kaylee-voice-pcm-player.mjs` (live :5183, Playwright, generated tones, no Gemini call, nothing mocked but the network). Web Audio is observed where the player calls it. Legs: two sentences in one go in odd 37-byte chunks (events and their times, gap between consecutive scheduled buffers, samples handed over against samples sent, the level); a stream far slower than its sound; a stop 300 ms into a 3 s tone (`playing()` null in the same call, body cancelled, every source stopped, no event, level 0 within 100 ms); a sentence after the stop. Exits 1 on any FAIL and on any console error. 2026-10-27, run by the review on a loaded box: every leg PASS, exit 0, 1,947 buffers scheduled, largest gap between consecutive buffers 0, `stop()` in 0.40 ms with 322 sources stopped and the body cancelled, level 0 at 100 ms.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/utils/pcmPlayer.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-voice-pcm-player.mjs

## MAN-9113 — src/modules/companion — her voice on the page: useCompanionVoice, the pull (speechPull.ts), the per-device switch, the cut on the press and the presence that orders the page's states

The page that holds the floor pulls her sentences from `GET /speech` (MAN-9110) and plays them through its player (MAN-9112). A press while she sounds is the cut (MAN-9111). Server side of the floor: MAN-9082. The presence (the one state, her process in it): MAN-9134; the cut on the press: MAN-9133; proof: MAN-9135. Rules: INV-9940.

## `useCompanionVoice({ picture, clientId })` (`hooks/useCompanionVoice.ts`)
- Called ONCE, by `CompanionProvider`. Answers `{ voice, unlock, cutOff, release, silence }`.
- `voice: CompanionVoice` = `{ on, setOn, speaking, cut }` (`src/shared/types.ts`) is the `voice` member of `useCompanion()` (MAN-9083). `unlock`, `cutOff` and `release` go to `useTalkPress(speech)`; `unlock` and `silence` are also the provider's.
- The pull runs while `on && picture.floor === clientId`: `engine.arm()` when that becomes true, `engine.disarm()` when it stops (hang up the request, `player.stop()`, `speaking` null). Every other page, and a page with the switch off, makes NO speech request and shows the words only.
- `engine.see(picture)` runs on every folded picture, floor or not, so the pull knows the log when it arms.

## The switch — per device
- `localStorage['companion-voice']`: `'off'` = off; any other value or none = ON (default). A storage that refuses the read = on; one that refuses the write = the switch holds for the page's life.
- `voice.setOn(next)` stores it and, when turning on, calls `player.unlock()` (the click is the gesture).
- Drawn by `CompanionVoiceSwitch`, "Voice on this device", row four of `CompanionHeader` (MAN-9089); off, her words still stream into the log.

## Unlock — the page's audio opens inside a gesture
`unlock()` (a no-op while the switch is off) is the FIRST statement of: opening her panel (`setOpen(true)`), `sendText`, and every talk press (`useTalkPress.toggle`).

## The pull (`utils/speechPull.ts`, `createSpeechPull(player, setSpeaking)`)
Plain closures; the only clocks are a picture, an answer and the player's `start` event. Nothing polls.
| rule | detail |
|---|---|
| what it asks | `api.companion.speech(turnId, index, signal)` for the smallest index at or after `next` whose `kaylee` row is in `picture.log` for the running turn: "the frame has arrived" |
| how far ahead | `pending` holds the request from its ask until the player STARTS that sentence (`onSentence` `start`). So: the one sounding, plus one asked or queued. Sentence k is asked when its frame has arrived and nothing is pending: at once when the player is idle, else when k-1 starts. So the silence between two sentences is k's synthesis latency minus k-1's length, when positive: about 360 ms after a one-word sentence (reported by the fill review, 2026-10-27; no fix designed) |
| joining mid-turn | `arm()` begins after the last sentence the log holds, so a page that takes the floor mid-turn starts with the next frame to arrive |
| a new turn | `picture.turnId` changed → `follow(turnId, 0)`: an unanswered request is hung up, what the player already holds plays out. With no turn running, the newest sentence's turn the page never followed is joined after its last sentence (not read out late) |
| 200 `audio/l16` with a body | `player.enqueue`; `next` = index + 1 |
| 204; any 5xx; a 200 that is not `audio/l16`; a failed fetch | skipped (`next` = index + 1); the last three warn |
| 409 (`COMPANION_SPEECH_REFUSED`, `COMPANION_NOT_FLOOR`), 404, any other refusal | `stopped` for the turn; the next turn starts again. The refusal's sentence is NOT shown by the page: the server wrote it as a `system` line (MAN-9110) |
| a socket reconnect | the picture is re-seeded and `see()` runs; the pull keeps its place |
| `speaking` | set at a sentence's `start`, held until the next one starts, `null` only when the player is silent and nothing is pending: never between two sentences |
| `silence()` | hang up, `stopped` for the turn, `player.stop()`, `speaking` null; the floor is kept. Called by Stop (`interrupt`, before the request) and the `companion_cleared` frame |

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionPanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionVoiceSwitch.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/context/CompanionContext.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/hooks/useCompanionPresence.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/hooks/useCompanionVoice.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/hooks/useTalkPress.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/utils/speechPull.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-presence-whole.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-voice-whole.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/voice-whole-edges.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/voice-whole-kit.mjs

## MAN-9133 — src/modules/companion — her voice on the page: useCompanionVoice, the pull — The cut on the press (`useTalkPress.toggle`, MAN-9101)
section: src/modules/companion — her voice on the page: useCompanionVoice, the pull (speechPull.ts), the per-device switch, the cut on the press and the presence that orders the page's states/001 The cut on the press (`useTalkPress.toggle`, MAN-9101)

1. `unlock()`.
2. The press that OPENS the mic calls `cutOff()`: `held` = true (nothing is asked for while he records, so her voice never enters his clip).
   - If `player.playing()` or a request is pending: `turnId` = the playing sentence's, else the pending one's; `heard` = `player.lastEnded().index` when it is of that turn, else `null`; `interrupted` = the playing index when of that turn, else `null`. Then `silence()` and `POST /api/companion/cut { turnId, heard, interrupted }` (MAN-9111). `cutOff` answers that request's settling, never rejecting. Nothing sounding and nothing on its way: `null`, no request, the press only holds the pull.
   - `voice.cut` is true for `CUT_SHOWN_MS` = 900 ms.
3. The mic opens at once; the clip's upload awaits the cut's settling (`cutOwedRef`), so the cut is owed before the press is pushed.
4. The press that ends the recording, a mic that never opened and a device that went away each call `release()`: `held` false, `next` = at least one past every sentence in the log, then the pull resumes. What she said while his mic was open is not read out afterwards.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionPanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionVoiceSwitch.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/context/CompanionContext.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/hooks/useCompanionPresence.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/hooks/useCompanionVoice.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/hooks/useTalkPress.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/utils/speechPull.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-presence-whole.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-voice-whole.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/voice-whole-edges.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/voice-whole-kit.mjs

## MAN-9134 — src/modules/companion — her voice on the page: useCompanionVoice, the pull — The presence — the one state, in one order
section: src/modules/companion — her voice on the page: useCompanionVoice, the pull (speechPull.ts), the per-device switch, the cut on the press and the presence that orders the page's states/002 The presence — the one state, in one order

`useCompanionPresence(): CompanionPresence` (`hooks/useCompanionPresence.ts`). Types in `src/shared/types.ts`: `CompanionPresence` = `{ state, session: CompanionSessionRef | null, files: string[] | null, walk: { at, total } | null }`; `CompanionPresenceState` = the fourteen words below.
| source | read from `useCompanion()` | gives |
|---|---|---|
| her server-held picture | `picture` (null while it loads) | `loading` while it is null |
| her process | `picture.process.state` | `failed`, `asleep`, `waking`; `awake` gives no word of its own |
| her activity | `picture.activity` | the phase when her process is awake, and ALWAYS `session`, `files`, `walk`, whatever the state |
| this page's talk press | `talk.state` | `listening`, `transcribing` |
| this page's player | `voice.cut`, `voice.speaking !== null` | `cut`, `speaking` |
Priority, first that holds wins — `presenceOf(picture, talkState, cut, speaking)`, pure; `picture` is `Pick<CompanionPicture, 'activity' | 'process'> | null`:
1. `cut` (`voice.cut`: 900 ms after a press stopped her voice)
2. `listening` or `transcribing` (`talk.state`; `listening` wins when a new recording started over a clip still out)
3. `speaking`
4. `loading` (`picture` null)
5. `failed`, then `asleep`, then `waking` (`picture.process.state`)
6. the activity's phase: `reading_code`, `reading_session`, `drafting`, `walking`, `thinking`, `idle`. One phase at a time, so they never compete. A phase this build cannot name (a newer server's) reads `thinking`.
- The fourteen words, in their order: `cut` > `listening` > `transcribing` > `speaking` > `loading` > `failed` > `asleep` > `waking` > `reading_code` > `reading_session` > `drafting` > `walking` > `thinking` > `idle`.
- why the page first: his open mic shows even while she is mid-sentence or her process is down; `cut` is the one word for the instant her voice stopped.
- why her process before her activity: a Kaylee who cannot answer never reads as ready (ruling 19: never fake good news).
- Memoized on the process's state, the activity's VALUE (`JSON.stringify(activity)`), `talk.state`, `cut`, `speaking`. why: the server sends a fresh object with every `companion_activity` frame, repeats included; a presence minted for words that did not change would restart what a consumer holds on it. A `companion_process` frame alone moves the state.
- THE ONLY RESOLVER of the picture (process and activity), the press and the player into a state: the status line and the button read this one value, so they cannot disagree. A consumer may still read one source for its own part (the talk button reads `talk.state`, the log reads `voice.speaking`, the header's controls read the picture).
| reader | draws |
|---|---|
| `CompanionPanel` → `CompanionHeader` (`presence` prop) | the status line: words and tones from the state alone, MAN-9089 |
| `CompanionFab` | the face's `data-state` (`CompanionAvatar`, MAN-9124), the button's label (`presenceWords`, MAN-9129) and where she looks (`useAvatarTarget`, MAN-9132) |
- The line and the button change in the same frame: `.verify/kaylee-fab-presence-frames.mjs` (MAN-9130).
- `presenceOf` is exported for the `.verify/lib/*-kit.mjs` fixtures that mount a view where no provider stands: each hands in its fixture's picture (null for the loading one).

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionPanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionVoiceSwitch.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/context/CompanionContext.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/hooks/useCompanionPresence.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/hooks/useCompanionVoice.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/hooks/useTalkPress.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/utils/speechPull.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-presence-whole.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-voice-whole.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/voice-whole-edges.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/voice-whole-kit.mjs

## MAN-9135 — src/modules/companion — her voice on the page: useCompanionVoice, the pull — Proof
section: src/modules/companion — her voice on the page: useCompanionVoice, the pull (speechPull.ts), the per-device switch, the cut on the press and the presence that orders the page's states/003 Proof

`node .verify/kaylee-voice-whole.mjs [--steps 0,…,7]`: live :5183 and :3011 as account 1, Kaylee on `haiku`, the speech model on `gemini-3.8-flash-lite-tts`; two Chromium pages (a laptop 1440×900, a phone 390×844) with the fake-media flags. Steps: 0 setup; 1 the phone asks "Count from one to six, one number per sentence." (the phone speaks and marks, the laptop makes no speech request); 2 the cut on the third sentence (silent within 0.1 s, `{ turnId, heard: 1, interrupted: 2 }`, her next JSONL user message opens with `<cut heard=… interrupted=…/>`); 3 the laptop presses talk and the floor moves; 4 the laptop's switch off; 5 Settings (the speech model, voice and sound tags; `hum` into her next `<register>`; Restore); 6 the spend ledger before and after; 7 the pull's edges with the door answered by the probe, no Gemini call (`lib/voice-whole-edges.mjs`). It puts Kaylee's model, the speech model and the sound tags back as found.

`node .verify/kaylee-presence-whole.mjs` (live :5183 and :3011 as account 1, Kaylee on `haiku`, the speech model on `gemini-3.8-flash-lite-tts`, Chromium with the fake-media flags; the voice switch OFF until the last step, so the long turn costs no Gemini call): a requestAnimationFrame loop installed before the app runs keeps every change of `[data-companion-status]` with its frame. One turn naming a probe chat by id (a hidden project's chat is on her roster only through the `<view>`, the freshest tab of the shared account, or an id she is handed): `Reading <chat>`, `Drafting for <chat>`, each drawn within 250 ms of its `companion_activity` frame (asserted; 2026-10-27 measured about 15 ms); two talk presses in 0.26 s: `Listening`, then `Transcribing`; the voice switch on and one short sentence: `Speaking`, exactly one speech call, answered. The four in their order, no console error from the recorder on; the longest gap between read frames is printed, not asserted (it is the host's load). Her read set her focus to the probe chat; the delete of that chat ends the focus (the server drops a focus whose chat row is deleted, `companion_focus` null: MAN-9059), so nothing is left on her. 2026-10-27: all pass, before the `Transcribing` and exactly-one checks were added.

`node .verify/kaylee-one-state.mjs` (live :5183, account 1, a read-only page via `lib/read-only-page.mjs`: nothing written to the account, no word sent to her, no model call, no Gemini call). Legs, numbered as the probe numbers them, in the order it runs them:
- Leg 3, the live page: her `process.state` from `GET /api/companion` beside the live status line, the live button's label and its face's `data-state`; all three are in the words of one state, and with her process asleep the line and the label both say asleep.
- Leg 1, the fourteen states on fixtures: the app's own `CompanionHeader` and `CompanionFabView` (face `CompanionAvatar`, label `presenceWords`) drawn for each, printing the status line, the label and the face's `data-state`; checks that all three name the state, the face's accessible name is the label, only idle's label says "ready", the failed row's face reads `data-state="failed"`, and the process rows keep their tones. Photographs: `.verify/shots/kaylee-one-state-<state>.png`.
- Leg 2, the order, through the app's own `presenceOf`: the page's four states over every process state, the process over every phase, an unknown phase as `thinking`, no picture as `loading`.
- Leg 4, the hook on the live page: the picture read is answered asleep and idle, then `companion_process` frames (waking, awake, failed) are sent to the page's own socket; the button, face and line move on the process alone (the memo key on the process's state).
- 2026-10-28: 62 of 62 checks passed; account 1 was asleep: line "Asleep · your next message wakes her", label "Kaylee, asleep", face `asleep`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionPanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionVoiceSwitch.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/context/CompanionContext.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/hooks/useCompanionPresence.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/hooks/useCompanionVoice.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/hooks/useTalkPress.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/utils/speechPull.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-one-state.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-presence-whole.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-voice-whole.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/voice-whole-edges.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/voice-whole-kit.mjs

## MAN-9123 — The queued message — one per session, appended to on the server, sent by the dispatcher: routes, merge, claim, restore and the composer's rules

A message sent while a turn runs is queued; the dispatcher sends it when the session is idle. One queued message per `(user_id, draft_scope)` row of `session_drafts` (column `queued_message`).

## Routes (`server/modules/user/user.routes.ts`, mounted at `/api/user`)
| Route | Body | Answers |
|---|---|---|
| `POST /drafts/queued-message` | `{ scope, queuedMessage: { id?, content, options?, attachments } }` | 200 `{ success, queuedMessage, appended }` — what the scope now holds; `appended` = merged into a waiting message |
| `DELETE /drafts/queued-message` | `{ scope }` | 200 `{ success, queuedMessage }` — the message it removed, `null` when nothing was waiting |
| `PUT /drafts` | `{ scope, text? }` | 200 `{ success, written }` — `written` is what was stored: `["text"]`, or `[]` when the body had no `text`. A `queuedMessage` in the body is ignored |
| `DELETE /drafts` | `{ scope }` | 200 — deletes the scope's whole row: text and queued message both. Only a page loaded before the per-part saves calls it |

| Refusal | Code | Status |
|---|---|---|
| no text and no attachments | `INVALID_QUEUED_MESSAGE` | 400 |
| content, or merged content, over `MAX_DRAFT_TEXT_LENGTH` (100 000 chars) | `QUEUED_MESSAGE_TOO_LONG` | 413 |
| the waiting message or the new one starts with `/` (after leading whitespace) | `QUEUED_MESSAGE_NOT_COMBINABLE` | 409 |
A refusal stores nothing.

## Merge — `sessionDraftsDb.appendQueuedMessage(userId, scope, message, maxContentLength)`
1. One transaction: read the stored message, merge, write. Returns `QueuedAppendResult` (`server/shared/types.ts`): `queued` | `not-combinable` | `too-long`.
2. `content` = both texts joined by a blank line (empty parts dropped); `attachments` concatenated in order.
3. `options` and `id` = the newer message's, falling back to the older.
4. Never touches `draft_text`.
5. A message queued after the dispatcher claimed the earlier one is stored alone. why: the claim cleared the column; nothing is sent twice.
- `readQueuedChatMessage` (`server/shared/utils.ts`) is the one reader of a stored value; the repo and the dispatcher both use it. It reads legacy `images` as `attachments`.

## Clear — `sessionDraftsDb.clearQueuedMessage(userId, scope)`
- Nulls `queued_message`, returns the removed `QueuedChatMessage | null`, deletes the row if empty (`deleteEmptyDraft`).

## Dispatch (`scheduled-message-dispatcher.service.ts`, `POLL_INTERVAL_MS = 30_000`)
1. `listQueuedMessages` → per session idle: `claimQueuedMessage` (compare-and-null on the exact stored string; a row the claim leaves empty is deleted).
2. Send through `runDetachedChatTurn`.
3. Turn did not start → `restoreQueuedMessage`: puts the claimed message back IN FRONT of anything queued since (merged); the row is upserted, since the claim may have deleted it.

## Text save — `sessionDraftsDb.saveDraft(userId, scope, text)`
- `PUT /drafts` writes `draft_text` and nothing else; it never touches `queued_message`. A body that still carries `queuedMessage` (a page loaded before the append route) has that field ignored, and its text is saved. why not a 4xx: that page sends its text in the same body, and a refusal would lose it.
- What that page's queue and cancel become: it sends `{ scope, queuedMessage: X }` to queue and `{ scope, queuedMessage: null }` to Edit or Delete, with no `text`. Both answer 200 `written: []` and change nothing. So the queue the page draws is never stored (nothing is sent), and a card it cancels stays stored and is sent by the dispatcher. Honouring the explicit `null` would let a stale tab wipe a follow-up another tab just added, so the operator holds that call.
- A queued message changes only through append, clear, `DELETE /drafts` (the whole row) and the dispatcher's claim and restore.

## Client — `src/shared/chatDrafts.ts`
- `appendQueuedMessage(scope, message)` → `{ queuedMessage, appended }`; rejects `QueueRefusedError { code }` when the server refused.
- `clearQueuedMessage(scope)` → `{ landed, removed, sentence }`.
- The page's copy of the queue (and its localStorage mirror `chat-drafts`) changes only on a server answer: an append's reply or a `landed` clear. It is never written back to the server.
- Per-scope requests are serialized (`queueRequests`); `queueRevisions` makes a `hydrateChatDrafts` that began before a local change keep the local copy.
- The debounced text save sends `text` only.

## Composer — `useChatComposerState.ts`
| Action | Rule |
|---|---|
| queue | emptied composer; on refusal the text returns in front of anything typed since, and an error line shows (`input.queue.notCombinable` for 409, else `Failed to queue message: …`) |
| Edit / Delete | `takeCardOffServerQueue` clears on the server and acts on the message the server REMOVED, never the card's copy; a second press while a clear is in flight is ignored |
| clear did not land | card stays; error line `Failed to remove the queued message: … It is still queued.` |
| Edit, nothing removed | composer left empty. why: the dispatcher already sent it; filling it sends twice |
| Delete, server held more than the card | error line carries the full deleted text |
| session switch during a clear | the text goes to the origin session's draft (`writeDraftText`); the open card and composer are left alone |
| card refresh | `hydrateChatDrafts` every 5 s and on `visibilitychange` to visible |
- Those two error lines are English literals; only `input.queue.*` keys are translated (en, es, ko, zh-CN).

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/session-drafts.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/scheduled-messages/services/scheduled-message-dispatcher.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/user/user.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/user/user.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/user/user.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/composer/QueuedMessageCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useChatComposerState.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/chatDrafts.ts

## MAN-9124 — src/modules/companion CompanionAvatar — Kaylee's face: props, looks, the --kaylee-mouth contract, ring numbers, accessible name, fixture

## `CompanionAvatar` — Kaylee's face (`src/modules/companion/CompanionAvatar.tsx`, `CompanionAvatar.css`)

One SVG drawn in code on Verve tokens, no image. Fills a square of `size` px and owns no chrome: the disc, the dock and the motion around her are the button's. Mounted by `CompanionFab` (the button's face, 26 px: MAN-9129) and by the fixtures.

### Props — `CompanionAvatar({ presence, level, size, name? })`
| prop | type | use |
|---|---|---|
| `presence` | `CompanionPresence` | `state` picks the look; `walk` feeds the ring; `session.name` / `files` feed the accessible name |
| `level` | `() => number` | the page player's `level()`; read only by the mouth loop, never a changing prop (a level through React redraws sixty times a second). Already 0..1 (the player clamps it): the loop writes it as it is. Measured at a spoken sentence's peaks: 0.38–0.42 (MAN-9130) |
| `size` | `number` | px |
| `name` | `string?` | her name as he set it; absent ⇒ `t('companion.defaultName')` |

### Looks — `data-state` on the `<svg class="kaylee">`
| state | accent on | pose |
|---|---|---|
| `idle` | none | breath, blink |
| `listening` | `.kaylee__ears` | head tilted, brows up |
| `transcribing` | `.kaylee__dots` | looks down, dots faster |
| `thinking` | `.kaylee__dots` | looks up and away, crooked smile |
| `speaking` | none | mouth is the variable's |
| `reading_session` | `.kaylee__bubble` | eyes along its lines |
| `reading_code` | `.kaylee__page` | eyes across it |
| `drafting` | `.kaylee__draft` | pencil writes a stroke under her chin |
| `walking` | `.kaylee__walk` | ring filled clockwise from the top to `walk.at / walk.total`; `.kaylee__halo` is `display: none` in both motion modes |
| `cut` | `.kaylee__surprise` | wide eyes, high brows, round mouth, one blink; `.kaylee__mouth-open` is `display: none` |
| `failed` | `.kaylee__walk` (the closed ring) and `.kaylee__surprise` (the level mouth) | still in both motion modes: no breath, no glow, no blink loop (`animation: none` on body, halo and eye, in the motion block). Eyes level and a little lowered (`scale: 1 0.84`), no tilt, no brows. `.kaylee__lip` is `display: none` and `.kaylee__surprise` is drawn as a level line (`scale: 1.3 0.22`), so there is no smile. The ring's stroke is `--kaylee-stopped` = `--warn-dot`, the colour of the status line's amber dot; `.kaylee__progress`, `.kaylee__count` and `.kaylee__halo` are off. why a ring and not the rim: the orb is amber in both themes (`--warn-dot` #d9a64a on the lamp's `--garnish` in dark), so an amber accent ON the orb would vanish; the ring stands 5 px clear of it at 96 px with the ground between |
| `asleep`, `loading` | none | exactly idle's look: no rule of their own |
| `waking` | `.kaylee__dots` | exactly thinking's look: the stylesheet's thinking selectors are `:is([data-state='thinking'], [data-state='waking'])` |

- Markup always holds every part; `[data-state]` turns on its accent (one part; `failed` has two, the ring and the level mouth) and sets the pose. A look is a still frame; movement lives only inside `@media (prefers-reduced-motion: no-preference)` at the foot of the stylesheet. why: reduced motion keeps each look and drops the movement with no rule of its own.
- Pose uses `rotate` / `scale` / `translate`, never `transform`. why: a breathing keyframe (`scale`) must not fight the tilt (`rotate`).
- Palette: Verve tokens only, plus two `#fff` glints (white in both themes). `--kaylee-rim` is the face's own darker edge (garnish 40% over `--ink` in light, over `--canvas` in dark). The button draws her on `bg-card` inside the kit's accent rim (MAN-9125), never on the accent itself. Measured on `--accent` in the light theme: rim against ground 1.65:1 at the head's edge, 1.12:1 at the chin; on `--surface`: 4.97:1 and 2.68:1 (INV-9979).
- Ids: one `useId()` per face prefixes the gradient and clip ids. why: a page holds several faces.

### `--kaylee-mouth` — the mouth contract
| rule | detail |
|---|---|
| range | `0` closed smile .. `1` open wide; default `0` on `.kaylee` |
| writer | the mouth loop (a `useEffect` in `CompanionAvatar`, MAN-9129) on the svg's own `style`, only while `data-state` is `speaking`; React never sets it, so a redraw cannot overwrite it. Its cleanup removes the variable |
| open mouth | `.kaylee__mouth-open` scales on it (`0.4 + v * 0.6`) and is hidden at `0` (`opacity: clamp(0, v * 40, 1)`) |
| heard only while `data-state='speaking'` | `.kaylee:not([data-state='speaking']) .kaylee__mouth-open { opacity: 0 }`; a value left in the variable never opens a stopped face, so a stale frame after the cleanup shows nothing |
| reduced motion | the CSS ignores the variable while speaking: `scale: 1 0.78; opacity: 1` (half open, still); the loop still runs while she speaks |

### Ring numbers
- `walk.at/walk.total` in a pill over the lower face, hidden until `.kaylee:hover`, or hover / `:focus-visible` of any `button`, `a`, `[role='button']`, `[tabindex]` ancestor. The button around her needs no wiring.
- Font 22 units, minus 3 per digit past 3 characters, floor 12; pill width `min(68, natural + 14)`. A longer walk is squeezed with `textLength` + `lengthAdjust='spacingAndGlyphs'` (`1391/1391`, `12345/12345` stay inside the face).
- `walk.total` 0 ⇒ the track alone; `walk.at` 0 ⇒ the arc is empty.

### Accessible name
- `role="img"`, `aria-label` = `presenceWords(t, name, presence)` (`utils/presenceWords.ts`, MAN-9129): her name, then the state in words, keys `companion.avatar.*` in `en/common.json` (`defaultValue` carries the English; other locales fall back to English). The button wearing her uses the same sentence as its label.
- `reading_session`: chat name, else "a chat". `reading_code`: 0 files ⇒ "code"; ≤ `FILES_NAMED` (2) ⇒ base names joined by `, `; more ⇒ "{{count}} files". `drafting`: "for {{chat}}", else "a new chat". `walking`: chat + `walk` ⇒ "walking {{chat}}, item {{at}} of {{total}}", else "walking a result". `cut`: "stopped talking". Her process: `loading` "loading", `failed` "stopped", `asleep` "asleep", `waking` "waking up"; only `idle` says "ready" (MAN-9129).
- A button around her may replace it with its own label.
- `FILES_NAMED` and `baseName` live in `utils/presenceWords.ts`; `CompanionHeader.tsx` imports them.

### Proof — `.verify/kaylee-avatar-states.mjs`
- `node .verify/kaylee-avatar-states.mjs` (live page on :5183): every state at 48 and 96 px, light and dark, the speaking mouth at 0.15 / 0.55 / 1 (`level` returns the opening and the face's own mouth loop writes the variable), the ring at 2 of 5; once with full motion, once with `prefers-reduced-motion: reduce` emulated. PASS/FAIL per line, exit 1 on any FAIL.
- Checks: name, gate (reduced motion: no element of any face names an animation), accent, mouth, left-over variable opens only a speaking face, ring, names, pose, numbers, motion (every state but walking and failed moves; failed runs no animation, and holds its body and eye while idle breathes), looks (asleep and loading compute idle's look, waking thinking's: 24 reads with motion, 27 reduced, over halo, body, eyes, brows, lip, surprise and dots, with the accents on), failed (the ring's computed stroke is the warn dot's colour and clear of the orb, with the halo off; eyes level, no smile, a level mouth; no breath, glow or blink loop named), phone (390 px), errors. Sixteen cells: nine looks, speaking at three openings, and the four of her process, named by `presenceWords` ("Kaylee, stopped", "asleep", "waking up", "loading").
- Measured contrast of the failed ring on the button's ground: 2.21:1 on `--surface` in light, 7.77:1 in dark. In light that is below 3:1: the ring is not the only signal (the level mouth, the lowered eyes, the button's label and the status line say it too).
- Shots: `.verify/shots/kaylee-avatar-{motion,reduced,numbers,phone}-{light,dark}.png`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionAvatar.css, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionAvatar.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-avatar-states.mjs

## MAN-9125 — src/modules/companion — her disc and her rail cell: CompanionFabView, CompanionDockView, the layer, the glide and hop, her phone corner, stacking and the fixture

Live: `WorkspaceFrame` renders `CompanionFab` after `AppSwitcherFab`; `WorkspaceRail` renders `CompanionDock` in its foot after `UsageRings` (MAN-9083). What the two wrappers read and keep: MAN-9129. Her face: MAN-9124. Where a look sends her: MAN-9132 (`useAvatarTarget`, `avatarPlacement`), over the page's anchors (MAN-9131). Proof on the live page: MAN-9130.

## Parts — `src/modules/companion/`
| file | holds |
|---|---|
| `CompanionFab.tsx` | `CompanionFabView` (every state from props) · `CompanionFab` (binds it to the provider: MAN-9129) |
| `CompanionFab.css` | `.companion-fab`: the glide, the hop, the reduced-motion jump |
| `CompanionDock.tsx` | `CompanionDockView` (her rail cell) · `CompanionDock` (binds it to the provider: MAN-9129) · `CompanionDoorView` (the plain door the cell draws while the disc is out of its seat, MAN-9089) |

## `CompanionFabView` props
| prop | use |
|---|---|
| `label` | accessible name and tooltip ("Kaylee, reading Bugfixes") |
| `face` | `ReactNode` handed to the kit's `icon`, drawn `FACE_PX` = `FAB_SIZE_PX` − 2 = 26 px square, on `bg-card`, inside the kit's 1px accent rim |
| `position` | `DockableFabPosition`: docked, or a point |
| `dockRect` | the rail cell's rect while the rail is docked (md+) and the rect is on screen, else `null` |
| `active` | panel open: `aria-expanded`, the kit's pressed look |
| `target` | `{ key, left, top } \| null`: a look, the disc's top-left in viewport px (what `avatarPlacement` returns plus the look's key). A new `key` = a new look = glide then hop |
| `onPress` | a press that ended no drag: opens or closes her panel |
| `onPositionChange(next)` | once per drag, at release: docked or the drop point |
| `onRestChange(rect)` | her rest's box before any look's offset, each time it moves (drop, dock, resize): the `buttonRect` of `useAvatarTarget(presence, buttonRect)` |

## The layer
- `[data-companion-fab]`: `fixed inset-0 pointer-events-none`; the disc (`.vv-fab`, the kit's `DockableFab`, unchanged) takes `pointer-events: auto`. why a layer: the kit's button scales itself with its own `transform` and is one fixed node, so her glide cannot be its transform.
- Its `translate` = 0 at rest, target − rest on a look. The layer is the disc's containing block and its box is the viewport, so the kit's `left`/`top` mean what they always mean.
- Her rest is never worked out here: it is the kit's `onRectChange` rect less the layer's drawn offset at that instant (docked = the cell's centre; floating = the kit's CSS clamp).
| attribute on the layer | set while |
|---|---|
| `data-target="<key>"` | a look is drawn |
| `data-dragging` | a drag is in hand, first move to release |
| `data-landing` | the hop runs |
| `data-tracking` | she has landed at the look drawn |

## Motion (`CompanionFab.css`)
- Glide: `translate` over 450 ms on `var(--ease-enter)`. `translate`, not `transform`, so the hop animates `transform` without fighting it.
- Hop: 5 px up, `--dur-quick` (200 ms), once per look (on the glide's `transitionend` for `translate`). A look's re-measures (scroll, resize) carry her at once (`data-tracking`: `transition: none`), no second hop. Home: the glide back, no hop; the next look lands again.
- Drag: the offset drops at once (`data-dragging`: `transition: none`); the look in hand is set aside (`cancelledKey`) until another key or none begins; the drop sets the new rest.
- `prefers-reduced-motion: reduce`: no transition, so no glide and no hop. The hop is declared only under `no-preference`.

## Stacking — the workspace shell's stacking context
| where | layer z |
|---|---|
| md and up | 59 |
| below md, at rest | 49 |
| below md, a look holds her (`data-target`) | 59 |
- Classes: `z-[49] data-[target]:z-[59] md:z-[59]`.
- 59 is over the applications (40), the floating chat and her desktop panel (45; the disc is how that panel closes) and the docked rail (50), under the applications button and its radial (60), which stay on top where they meet.
- 49 is under the sidebar drawer (50): an open drawer covers her corner, its cell draws her door, and the controls of its rows stay pressable; over the floating chat (45) and the applications.
- Below `lg` her panel is a sheet at 61 that covers both discs and has its own close.

## Her corner — docked with `dockRect === null` (a phone: the rail is in the drawer)
- `CORNER_INSET` = `{ x: 72 + FAB_CATCH_PX, y: 112 }`: rest = top-left at (`innerWidth` − 116, `innerHeight` − 112), on the applications button's line, one 44 px catch left of it; the catches meet edge to edge. Handed to the kit as a point, so its clamp holds her inside the safe area and she wears the floating look.
- It follows the window's size (`useSyncExternalStore` on `resize`, subscribed only while in the corner). Opening or closing the drawer never moves her.
- 72 and 112 are `FAB_DEFAULT_INSET_X` / `_Y` (`src/shared/constants.ts`), the applications button's phone default, read by its storage too: a change to the 72 overlaps the two catches with nothing to catch it (MAN-9010).
- Measured at 390×844 on a chat: she hides ~4 characters of one line of his text ("ay f"), beside the 4 the applications button hides ("m th"); that line is a short message's only line, or the line before the one he types. Keyboard up on Android (390×508): she at y 396 on the field, the applications button at y 472.
- Rejected spots: directly above the applications button (the conversation's newest lines and the thumb's scroll lane; `touch-action: none` makes a scroll that starts on a catch drag the disc); high in that column (Files chips, Git tabs: a press meant for them opens her panel).

## `CompanionDockView({ seated, away, open, name, onPress, onRect })`
- `[data-companion-dock-cell]`: `RAIL_BUTTON_BASE` (40 px; 44 below md), the rail foot's rhythm whether it holds her disc or her door. In it, a 28 px `size-7` `aria-hidden` box that paints nothing and reports its rect through `onRect`; the disc is drawn centred on that rect.
| prop | cell draws |
|---|---|
| `seated` true (her rest is docked and the dock is believed) | the box only |
| `seated` false (disc out, or no rect) | `CompanionDoorView` over the box, the disc's own press: the rail always has a way to her |
| `away` true (a look holds her off the seat) | a dashed ring on the box, `border-muted-foreground/70`; her place kept |
| `open` and `seated` | `RAIL_BUTTON_LIT` on the cell. why: the kit's pressed ring is too faint at 28 px. Unseated, the door lights itself |
- A look keeps `seated` true. why: the door must not flicker into the rail each time she glides away and back.
- `onRect` fires from a layout effect: on mount, on window `resize`, whenever the box enters or leaves the viewport (an `IntersectionObserver` on the box, disconnected on cleanup), and `null` on unmount and below md (`(min-width: 768px)` false). From md up nothing slides the sidebar, so a resize and the crossing of md are the movers. why the observer: `resize` fires BEFORE React draws the layout the new width asks for, so growing from a phone to a desktop width reads the drawer's off-screen box and the context refuses it; the observer reports after that layout. Nothing polls. The rect is reported as measured.

## Seams to keep
- Two `.vv-fab` discs stand in the page. `FAB_SELECTOR` (`src/shared/constants.ts`) is `.vv-fab:not([data-companion-fab] .vv-fab)`: the applications button, whatever order the two mount in (MAN-9014). A probe names the one it wants: `lib/switcher.mjs`'s `FAB` for the applications button, `lib/kaylee-fab-live.mjs`'s `FAB` (`[data-companion-fab] .vv-fab`) for hers.
- `registerDock` believes a rect only through `dockableRect` (`src/shared/utils.ts`, shared with app-switcher). why: a phone's hidden rail keeps a layout box and would place her off screen.
- Outside her module: with the keyboard up on Android the applications button's stored point is clamped onto the left half of Send (app-switcher's placement rule).

## Proof — `.verify/kaylee-fab-chrome.mjs`
```bash
node .verify/kaylee-fab-chrome.mjs
```
- Gitignored (`.verify/`). Live client `:5183`. PASS/FAIL per line, exit 1 on any FAIL; light and dark.
- Mounts the app's own `CompanionFabView` and `CompanionDockView` (face: `CompanionAvatar`) through `lib/kaylee-fab-kit.mjs`: the dock in the rail foot's cell, the disc in the shell's fixed container (`.pwa-status-clear.fixed`) after the applications button. The LIVE cell and layer stand in the page too: the kit hides them and takes off the cell's `data-companion-dock-cell`, its door's `data-companion-door` and the layer's `data-companion-fab`, so every query finds the fixtures'. Two React roots, one fixture state in `window.__fabKit`. Real mouse drags; a real touch swipe through `lib/kaylee-fab-phone.mjs`.
- 1440×900: seated (centred on the box, named "Kaylee, ready", z 59, no door in the cell) · press · out (door drawn, unlit; disc and door light together) · back (a drop near the cell docks) · glide (450 ms ease-out, one 200 ms hop, re-measure moves her at once) · cancel (drag during a look) · reduced motion.
- 390×844 touch, on a chat, applications button seeded at its phone default: her corner, her catch on the composer and none of the conversation, a swipe where she once rested scrolls the conversation, the drawer's cell draws her door, the open drawer leaves her in her corner.
- Shots: `.verify/shots/kaylee-fab-*-{light,dark}.png` (docked, docked-rail, open-rail, out, out-rail, out-open, glide-mid, glide-hop, glide-landed, visit-open, reduced, phone, phone-drawer).
- Kit residual: a dragged disc sits 1.12 px off the pointer (pressed `.vv-fab:active` scales to 0.92 and `heldFrom` halves the scaled width); the applications disc too. Pointer checks allow 1.5 px.
- 2026-10-27: 64 of 64 checks passed, with the disc and the cell mounted live beside the fixtures.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionDock.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionFab.css, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionFab.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-fab-chrome.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/kaylee-fab-kit.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/kaylee-fab-phone.mjs

## MAN-9129 — src/modules/companion — her disc and her cell on the page: the provider's fab state, `companion-fab`, the button's label and look, the mouth loop

What the live `CompanionFab` and `CompanionDock` read from `useCompanion()` and what the provider keeps for them. The views (`CompanionFabView`, `CompanionDockView`: MAN-9125) take everything as props; these wrappers bind them to the page. Mounted: `CompanionFab` by `WorkspaceFrame` after `AppSwitcherFab`, `CompanionDock` by `WorkspaceRail`'s foot after `UsageRings` (MAN-9083). Proof: MAN-9130.

## Provider state — `useCompanionFab()` (`hooks/useCompanionFab.ts`), called once by `CompanionProvider`
| `useCompanion()` member | holds | written by |
|---|---|---|
| `fabPosition: DockableFabPosition` | where she rests: `{ docked: true }` or `{ docked: false, x, y }` | `moveFab` |
| `moveFab(next)` | sets `fabPosition` and writes `companion-fab`, at the release of a drag | `CompanionFab` (`onPositionChange`) |
| `dockRect: DOMRect \| null` | the rail cell's rect while the rail is docked (md and up) and the rect is on screen | `registerDock` |
| `registerDock(rect)` | believes a rect only through `dockableRect`; keeps the held object when `sameRect` says the same place | `CompanionDock` (`onRect`) |
| `fabAway: boolean` | a look holds the disc off its seat | `setFabAway` |
| `setFabAway(away)` | `true` while a look holds her, `false` when `CompanionFab` unmounts | `CompanionFab` |
| `level: () => number` | the page player's level, 0..1 | `useCompanionVoice` |
- `moveFab`, `registerDock`, `setFabAway` and `level` keep one identity for the page's life.
- `dockableRect` and `sameRect` are `src/shared/utils.ts`'s, shared with app-switcher's provider (MAN-9010).

## `companion-fab` — `utils/companionFabStorage.ts`
- `localStorage` key `companion-fab`: per browser, never the server. why: it describes where a button was dropped in this window.
- The record is the kit's position: `{"docked":true}` or `{"docked":false,"x":<n>,"y":<n>}`.
- `readFabPosition()`: the stored position, else `{ docked: true }` on absent, unparseable, not-a-position or storage refused. Never throws.
- `writeFabPosition(position)`: a refused write is swallowed. why: the provider's state is the truth for the page's life.

## `CompanionFab` — what binds each view prop
| view prop | from |
|---|---|
| `label` | `presenceWords(t, name, presence)`; `name` = `picture.settings.name`, else `t('companion.defaultName')` |
| `face` | `<CompanionAvatar presence level size={26} name />`; `presence` = `useCompanionPresence()` (the one value the status line reads too: MAN-9134) |
| `position`, `dockRect`, `active` | `fabPosition`, `dockRect`, `open` |
| `onPress`, `onPositionChange` | `setOpen(!open)`, `moveFab` |
| `onRestChange` | state `restRect`, the `buttonRect` of `useAvatarTarget(presence, restRect)` |
| `target` | (MAN-9132) `useAvatarTarget` gives `look`; `avatarPlacement(look.rect, FAB_SIZE_PX, viewport)` gives `{ key, left, top }`; `null` with no look |
- `viewport` = `{ width, height, safe }`. Width and height come from `useSyncExternalStore` on `resize`, subscribed only while a look holds her. `safe` = `readSafeInsets()` (a hidden node wearing `env(safe-area-inset-*)`), read once per hold and again only when the window's size changes (memo on `holding`, width, height). why: a scroll frame re-measures the look and must not build a node each time.

## `CompanionDock` — what binds each view prop
- `seated` = `fabPosition.docked && dockRect !== null`; `away` = `fabAway`; `open`; `name` = `picture?.settings.name ?? null`; `onPress` = `setOpen(!open)`; `onRect` = `registerDock`.

## `presenceWords(t, name, presence)` — `utils/presenceWords.ts`
- One sentence, her name then what she is doing ("Kaylee, reading Bugfixes"): the face's accessible name and the button's label and tooltip. Words and keys: MAN-9124 §"Accessible name".
- One word for each of the fourteen presence states. The four of her process: `loading` "{{name}}, loading", `failed` "{{name}}, stopped", `asleep` "{{name}}, asleep", `waking` "{{name}}, waking up" (keys `companion.avatar.loading`, `.failed`, `.asleep`, `.waking`; the English is in `en/common.json` too). Only `idle` says "ready": the button never says she is ready while her process has failed, is asleep or waking, or her picture is unread (ruling 19: never fake good news).
- Exports `FILES_NAMED` = 2 and `baseName(path)` too; `CompanionHeader` imports both.

## The mouth loop — `CompanionAvatar.tsx`
- A `requestAnimationFrame` loop runs only while `data-state` is `speaking`: each frame writes `String(level())` to `--kaylee-mouth` on the face's own `<svg>` (a ref; React never redraws). The cleanup cancels the frame and `removeProperty`s the variable.
- `level` is 0..1 already, so the gain is 1. Measured peaks of a spoken sentence: MAN-9130.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionAvatar.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionDock.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionFab.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/hooks/useCompanionFab.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/utils/companionFabStorage.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/utils/presenceWords.ts

## MAN-9130 — src/modules/companion — Proof — .verify/kaylee-fab-motion.mjs, kaylee-fab-presence-frames.mjs, kaylee-fab-speaking.mjs (her button on the live page) and lib/kaylee-fab-live.mjs

Her button on the live page: dev client `:5183`, server `:3011`, as the dev account `verve`. Gitignored (`.verify/`). PASS/FAIL per line, exit 1 on any FAIL. The fixture proof (no live turn): MAN-9125 §Proof. What is proved: MAN-9125, MAN-9129.

## Scene — `.verify/lib/kaylee-fab-live.mjs`
- `openLiveScene({ viewport, touch, dark, voice, speechModel, label, deviceScaleFactor })` → `scene`: her model on Haiku; the speech model set when asked; a probe chat in `lib/probe-project.mjs`'s scratch project, given one turn and renamed; the simple list pinned on; the recorder installed.
- Exports `FAB` (`[data-companion-fab] .vv-fab`), `LAYER`, `CELL` (`[data-companion-dock-cell]`), `PANEL`, `FIELD`, `VOICE_ROW`, `FILES_BUTTON`, `SMALL_FILE` (`src/shared/ui/buttonVariants.ts`), `CHEAP_SPEECH_MODEL` (`gemini-3.8-flash-lite-tts`).
- Recorder `window.__fabRec`: one entry per animation frame while `rec.on`: the disc's centre, the face's `data-state` and `--kaylee-mouth`, the layer's `data-target` and drawn `translate`, the status line's words, the probe chat row's rect (`rec.rowKey` = `chat-row:<id>`), the Files rail button's rect (`rail:files`).
- The probe chat has no row on the simple list: a chat under `/tmp` is hidden by `server/shared/hidden-project-paths.ts`, which the feed filters in SQL. The page's own read of the feed (`GET /api/providers/sessions/recent?…simpleList=true`) is answered with the probe chat added on top; the row, its anchor and her look at it are the app's own. Nothing is written to the server.
- Read-only page: opened through `openReadOnlyPage` (`lib/read-only-page.mjs`): preference writes answered and dropped, nothing PATCHed from node, Vite hot updates held off. Its optional `contextOptions` passes Playwright context options on (the phone leg: `isMobile`, `hasTouch`, `deviceScaleFactor`).
- `speechModel` set: the `PUT` is read back, and the scene throws before anything is spoken if it did not take.
- `scene.tearDown()`: puts back her model and the speech model (read back), clears the draft, removes `companion-voice` and `companion-fab` from this browser, deletes the probe chat, and returns the list of restores that did not answer ok. Each probe counts that list as failures.
- What stays on the account (no route removes it; only her Clear empties it, which would wipe a conversation other probes use): her log, about four entries per turn. Her focus does not stay: it ends with the probe chat's delete (MAN-9059 `chatDeleted`).

## `node .verify/kaylee-fab-motion.mjs` — where the button goes (Haiku)
| step | checks |
|---|---|
| 1 rest | her line quiet and the label ends in the word of her process (`, ready` awake; `, asleep` after a restart of :3011 or two idle hours, which is where the probe usually finds her); centre on the Kaylee cell's centre (≤ 1.5 px); no door in the cell; a real press opens her panel (`aria-expanded`); label = `<picture.settings.name>, <that word>` |
| 2 chat | "Read the last turn of <probe chat>": at the end of her look (the read plus the hold) the centre is within 12 px of the row's right edge; ≥ 8 frames between cell and row; the hold lets go 1.4–1.8 s after the read ended and she is home 0.3–0.65 s after that |
| 3 file | a dactyl reads `SMALL_FILE`: centre within 12 px of the Files rail button's right edge (key `rail:files`), then home |
| 4 drop | dragged to (700, 430): centre ≤ 3 px of it, `companion-fab` stored as a point, the cell draws her door; reloaded: ≤ 1 px of the same centre; dragged back on the cell: docked, `{"docked":true}` stored, door gone |
| 5 reduced | `prefers-reduced-motion: reduce`: the layer's transition computes `none` (`translate 0.45s` otherwise); she reaches the row and goes home with 0 frames between |
- "While she reads" is her LOOK, not the read: `read_session` on a tiny chat answers in about 30 ms, so she lands on the row during the hold.
- The hold (1.5 s) and the glide home (0.45 s) cannot both give "back in the cell 1.5 s after the read": the hold lets go at 1.5 s and she is in the cell at about 1.9 s.
- 2026-10-27: ALL PASS (Haiku). Chat: centre 10.0 px from the row's right edge (centre (324, 89), edge 314), 19 frames between; hold let go 1.52 s after the read, home 1.90 s after it. File: 10.0 px from the Files button's right edge. Drop: centre (701.1, 431.1), stored `{"docked":false,"x":687.1,"y":417.1}`, the same centre after reload. Reduced: `none 1e-05s` against `translate 0.45s`, 0 frames between.

## `node .verify/kaylee-fab-presence-frames.mjs` — one state, drawn twice
- Voice off (no speech call), panel open, one turn: read the probe chat, then draft a message for it. Every animation frame compares the status line's words (`[data-companion-status]`, read as a state through `companion.status.*`) with the face's `data-state`.
- All fourteen states are compared, her process's four too: a frame on Asleep, Waking up, Stopped or Loading is read as `asleep`, `waking`, `failed` or `loading` and compared with the face like any other.
- Checks: the turn showed `reading_session` and then `drafting`; no frame where the two differ; no console error.
- 2026-10-27, before the probe compared her process words: ALL PASS; 375 frames (212 `idle`, 158 `thinking`, 3 `reading_session`, 2 `drafting`), 0 where the words and the state differ. The probe as it stands has not run (a Haiku turn).

## `node .verify/kaylee-fab-speaking.mjs` — the face speaking
- 1440×900 and 390×844 (touch); voice on; speech model `CHEAP_SPEECH_MODEL`. Asks "Reply with exactly one short sentence: hello." How many sentences she answers with is hers.
- Checks: the face reaches `speaking`; `--kaylee-mouth` takes more than 3 distinct values and opens past 0.1 while it does; within a few frames of the voice ending the loop has released it (`''`; the effect's cleanup leaves at most a stale frame or two, hidden by the stylesheet); a clip of the disc was kept; one `/api/companion/speech/` request per sentence she answered with (counted from her log entries of the turn after the question); no console error.
- Below lg her panel is a sheet over both discs: the probe closes it after sending, and she speaks on from her corner.
- Evidence of the mouth is the face clip taken at 8× whose window held the widest mouth. The whole-viewport shot is taken at the first speaking frame and may show the mouth shut.
- Shots: `.verify/shots/kaylee-fab-speaking-{desktop,phone}-{page,face}.png`. Every run spends Gemini speech requests: run it on purpose.
- Last run 2026-10-27, before the one-request-per-sentence check and the "within a few frames" release check were written: the mouth variable took 29 distinct values on desktop (peak 0.42) and 25 on the phone (peak 0.38); the stale value after the voice ended lasted one frame. The probe as it stands has not run.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-fab-motion.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-fab-presence-frames.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-fab-speaking.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/kaylee-fab-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/read-only-page.mjs

## MAN-9131 — src/shared/context — the page's anchor registry: PageAnchorsProvider, usePageAnchor, usePageAnchors, PAGE_ANCHOR, data-page-anchor

The page's anchors: elements a floating guide can point at, registered under stable keys. Registers: the sidebar's rows, the chat composer, the file tree, the rail. Reader: the companion's button (`useAvatarTarget`: MAN-9132). `src/shared/context/PageAnchorsContext.tsx`, no feature owner.

## Mount
- `ProjectWorkspaceShell` renders `PageAnchorsProvider` OUTERMOST: `PageAnchorsProvider` > `ChatHostProvider` > `AppSwitcherProvider` > `AccountsProvider` > `CompanionHost` (`CompanionProvider`) > `WorkspaceFrame`. why: registrars and the reader sit below it.
- The registrars (`SidebarSimpleListRow`, `SidebarSessionItem`, `ChatComposer`, `FileTree`, `RailButton`) import `usePageAnchor` and nothing of the companion; the companion imports none of the `sidebar`, `chat`, `file-tree` or `project-workspace` modules (`chat-host`, which registers nothing, it does) and reads through `usePageAnchors`. why: both sides depend on `shared`, neither on the other.
- Their modules' other files may import the companion: `project-workspace` mounts it (`WorkspaceFrame`, `WorkspaceRail`, `CompanionHost`, `ProjectCommandPalette`). The boundary is the registrar files, not the modules.

## Not the live bus
- The bus retains JSON per allow-listed topic and compares readings by `JSON.stringify`; it is also the vocabulary the widget bridge shows untrusted frames. An element is not JSON; a rect published per scroll would stringify the sidebar sixty times a second.
- The registry holds ELEMENTS and nothing measured; the reader measures at the moment it looks one up.
- State is two refs (`Map<string, HTMLElement>`, `Set` of listeners), never React state. why: a registration must not re-render the tree under the provider; sidebar rows register on every mount.

## Keys — `PAGE_ANCHOR` (`src/shared/constants.ts`, group `PAGE ANCHORS`)
| key | spelling | registered by | on |
|---|---|---|---|
| `chatRow(id)` | `chat-row:<id>` | `SidebarSimpleListRow` (`row.sessionId`), `SidebarSessionItem` (`session.id`) | the row's root `div` |
| `composer(id)` | `composer:<id>` | `ChatComposer`, `id` = its own `sessionId`; `null` without one (a new chat has no key) | the `div.relative.mx-auto.max-w-[54.25rem]` around the field |
| `filesView` | `files-view` | `FileTree` | its root, one callback ref handing the node to the upload's `treeRef` and the anchor |
| `railFiles` | `rail:files` | `RailButton` through its optional `anchorKey` prop (absent registers nothing); `WorkspaceRail` passes it for `view.id === 'files'` | the rail button |

## `data-page-anchor`
- The provider stamps `data-page-anchor="<key>"` on each element it HOLDS and takes it off on release or displacement. why: one selector finds the registrations on screen, for a probe and for the console.
- Console: `document.querySelectorAll('[data-page-anchor]').length` = anchors registered on screen, one `chat-row:` per visible sidebar row.
- One element carries one stamp: registered under two keys it shows only the later.

## API
| export | does |
|---|---|
| `PageAnchorsProvider({ children })` | holds the registry; its value has one identity for its life, so no consumer is woken by it |
| `usePageAnchor(key: string \| null): (element: HTMLElement \| null) => void` | returns a ref callback; `null` key registers nothing. One identity per `key` (`useCallback` on the provider and the key), so React never detaches and re-attaches it on a plain re-render |
| `usePageAnchors(): { element(key): HTMLElement \| null; subscribe(listener): () => void }` | the reader. Throws `usePageAnchors must be used within a PageAnchorsProvider` outside one. One identity for the provider's life |
- `usePageAnchor` outside a provider registers nothing and does not throw. why: the rows and the tree are also drawn in surfaces with no guide above them.

## Rules
1. The last element mounted under a key wins; the displaced element loses its stamp.
2. An element unmounting, or its key changing, releases only its own claim; a newer holder of the same key stays. why: the ref callback is handed `null` on detach and cannot say which element left, so the call site remembers the one it registered.
3. `claim` of the element already held notifies nobody.
4. `subscribe(listener)`: the listener is told THAT a registration changed, never which; the reader looks its own key up again. Returns the unsubscribe.
5. A listener that throws is `console.error`ed (`[PageAnchors] a listener threw …`) and does not stop the others.

## Held is not drawn — the reader measures and refuses
`element(key)` returns what is MOUNTED. Measured on the dev client:
| case | what the registry holds |
|---|---|
| Files view open; the chat view stays mounted and hidden | `composer:<id>` at 0×0 at 0,0 |
| phone, drawer closed | every `chat-row:` and `rail:files` mounted off screen (44×44 at −329,114) |
| row scrolled out of the sidebar's own scroller | still held |
| chat floated into another window | the same node under another `ownerDocument`; its rect is in that window's coordinates |
| off the Files view | `files-view` absent: the tree unmounts. The only key that is "drawn or absent" |
- The reader refuses a rect with no area, one outside its viewport, an element whose `ownerDocument` is not its own, and one something stands over; it falls to the next anchor. `sightOf` in `useAvatarTarget`: MAN-9132 §"In sight".

## Proof — `node .verify/page-anchors-live.mjs`
- Gitignored (`.verify/`). Live client `:5183` (`ANCHORS_APP=<url>` for a scratch client). No model call; preference writes are dropped, so the dev account is never changed.
- Registry rules in a fixture mounting the app's own provider: last wins, unmount clears its own claim only, `null` registers nothing, a changed key moves the stamp, `subscribe` hears each change and stops when told.
- On the page: (1) simple list, no chat open: a `chat-row:` per visible row and `rail:files`, no `composer:`; (2) a chat opened from its row: `composer:<its id>` on the input box; (3) Files view: `files-view` on the tree root and `rail:files` on the rail's Files button, `files-view` gone back on Chat; (4) tree list (`simpleChatList: false`): a `chat-row:` per session row, none doubled.
- 2026-10-27: PASS, 30 ok, 0 failed. Counts on the dev account at 1440×900: 19 (simple list), 20 (chat open), 21 (Files open), 22 (tree list).

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/composer/ChatComposer.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/file-tree/FileTree.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/ProjectWorkspaceShell.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/RailButton.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/WorkspaceRail.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSessionItem.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSimpleListRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/context/PageAnchorsContext.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/page-anchors-live.mjs

## MAN-9132 — src/modules/companion — where she looks: useAvatarTarget, the targets and their order, the in-sight test, the 1.5 s hold, avatarPlacement

Her button (`CompanionFab`, MAN-9125) is drawn at `avatarPlacement` of the rect `useAvatarTarget` returns while a look holds her, and rests otherwise. The anchors are the page's registry (MAN-9131). The presence it reads: MAN-9134. `CompanionFab` binds both: MAN-9129.

## `useAvatarTarget(presence: CompanionPresence, buttonRect: DOMRect | null = null): { key: string; rect: DOMRect } | null` — `hooks/useAvatarTarget.ts`
- `buttonRect`: her rest's box (`restRect` of `CompanionFab`), for in-sight test 4; null = nothing is under the button.
- Reads `usePageAnchors()` (throws outside `PageAnchorsProvider`) and `useCompanion().recentSend`.
- Returns the first anchor of the look that is in sight, with its rect as measured then in viewport px; null when none.
- Barrel: not exported. `CompanionFab` is its one caller.

## Targets and their order
Three looks, tried in this order; the first that applies is the only one tried.
| # | applies when | anchors, best first |
|---|---|---|
| 1 | `presence.state === 'reading_code'` or `presence.files !== null` | `files-view`, `rail:files` |
| 2 | `presence.session !== null`: a chat read, drafted for or walked | `chat-row:<sessionId>`, `composer:<sessionId>` |
| 3 | `recentSend !== null`: a draft sent in the last `RECENT_SEND_MS` = 4000 ms (MAN-9083) | `composer:<recentSend>` |
- The look is the presence's SUBJECT (`files`, `session`), not its state word. why: a sentence she speaks while reading turns `state` to `speaking`; the target must hold through it.
- A chat read outranks the send look: reading A within 4 s of a send to A stands on the row; when the read ends the composer takes over inside the send window.

## In sight — `sightOf(element, buttonRect)`: all four hold, else the anchor is no target and the next anchor is tried
1. Connected, and `ownerDocument === document`. why: a chat floated into another window is the same node with a rect in that window's coordinates.
2. The rect has width and height > 0 and meets the viewport (`right > 0`, `bottom > 0`, `left < innerWidth`, `top < innerHeight`). why: a hidden chat view holds its composer at 0×0; a phone's closed drawer holds every row off to the left.
3. `document.elementFromPoint` at the rect's centre lands on the anchor or inside it. why: an application, a dialog or her own panel over it, or the sidebar's scroller clipping it, leaves her at home; a centre off screen has no element and fails.
4. The rect is not wholly inside `buttonRect`. why: she is already standing on it.

## Hold — `TARGET_HOLD_MS` = 1500
- The look ends (no anchor keys) with a target standing: a timer drops it 1500 ms later. A look that returns inside the window takes the hold back; a held anchor that leaves sight ends it early.
- why: a run of tool calls (each ends, the next begins a moment later) keeps her where she is. 0.9 s between two calls: she never left.
- While held, only the held key is re-tested.
- Send look: 4000 ms window + 1500 ms hold = dropped 5501 ms after the frame.

## Events, not watchdogs — what is attached
| state | `scroll` (capture, passive) | `resize` | registry `subscribe` |
|---|---|---|---|
| no look, no target | no | no | no |
| a look, nothing in sight | no | no | yes |
| a target holds (look or hold) | yes | yes | yes |
- Re-measured when: the look changes; the registry announces a registration; and, only while a target holds, `scroll` or `resize`. Each schedules ONE `requestAnimationFrame` (`measureOnNextFrame`): a burst measures once.
- `isSameTarget`: the same key at the same rect keeps the held object; a re-measure that found nothing new renders nothing.
- Nothing polls. A look standing with nothing in sight has no scroll or resize listener: only a registration or a change of look brings her back (an overlay closing announces neither).
- Unmount cancels the pending frame.

## `avatarPlacement(anchor: DOMRect, size: number, viewport: { width; height; safe?: { top; right; bottom; left } }): { left: number; top: number }` — `utils/avatarPlacement.ts`
- Returns the disc's top-left in viewport px, whole numbers (a half pixel blurs the rim).
- Imports nothing. why: `tsx` loads it with no `@/` resolver, so the proof runs it on bare numbers.
- `CompanionFab` calls it with `look.rect`, `FAB_SIZE_PX` (28) and `{ width, height, safe }`: `width`/`height` from `useSyncExternalStore` on `resize`, subscribed only while a look holds her; `safe` from `readSafeInsets()` (`env(safe-area-inset-*)`), read once per hold and again when the window's size changes.
| anchor, told by height alone | place |
|---|---|
| ROW: height ≤ `ROW_MAX_HEIGHT_PX` = 88 (sidebar row 54, rail Files button 40) | disc centre `ROW_CENTRE_PAST_EDGE_PX` = 10 past the row's right edge, centred on the row |
| BOX: taller (composer 123 desktop / 115 phone, file tree) | disc centre on the box's top-right corner |
- 88 sits between the tallest row and the shortest composer, nearer the rows: a row that grows a line stays a row.
- 10 because the measure is the disc's CENTRE within 12 px of the row's right edge, true at any disc size (28 and 44 both read 10).
- The clamp comes last and always applies: each edge of the safe area + `VIEWPORT_EDGE_PX` = 8 (the kit's `DockableFab` edge, not exported). A window too small for the disc gives the top-left. A non-finite width, height or inset counts as 0, so the answer is always a number.
- Residual: beside the rail button and at the file tree's corner her 44 px catch lies over real controls (INV-9982).

## Proof
- `node --import tsx .verify/kaylee-avatar-placement.mjs`: the placement on bare numbers; rects measured on the dev client (row 242×54, Files button 40×40, composer 836×123 / 374×115). 2026-10-27: ALL PASS, 23 checks.
- `node .verify/kaylee-avatar-target.mjs [--strict]` (live client `:5183`; `--strict` mounts under `React.StrictMode`): `lib/avatar-target-kit.mjs` registers four anchors and steps a scripted presence; prints key, rect and what is attached at each step. No model call. 2026-10-27: ALL PASS, 32 checks: row, tree, rail fallback, covered, clipped, 0×0, below the fold, under the button, the 1.5 s hold, the send look's 5501 ms, nothing attached at home, nothing left after unmount.
- On the live page with a real turn (Haiku): MAN-9130.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/CompanionFab.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/hooks/useAvatarTarget.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/companion/utils/avatarPlacement.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-avatar-placement.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/kaylee-avatar-target.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/avatar-target-kit.mjs
