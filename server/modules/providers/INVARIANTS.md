<!-- docstore export; edit rows with docstore write, never this file -->

## INV-7379 — probe — LOW — `providerRuntimeService.activity` hands every caller the SAME object for a runtime without `activity()`

LOW — `providerRuntimeService.activity` hands every caller the SAME object for a runtime without `activity()`

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/custom-compaction--seams/probes/shared-notlive.sh
expect: second_answer_after_a_caller_mutated_the_first={"live":false,"busy":true,"why":"MUTATED"} while the defect stands (the clean {"live":false,"busy":false,"why":null} once cured)
```

measured 2026-10-08 by chain chain-custom-compaction--seams-20261008-095144-d30e, finding L1, LOW
probe-key: 67b90d3a5a320a9855990720c4bb0fddf380727d

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-compaction-seams.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/interfaces.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts

## INV-7381 — probe — LOW — `askCompactionTakesOver` has no bound; a hook that never settles hangs the send

LOW — `askCompactionTakesOver` has no bound; a hook that never settles hangs the send

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/custom-compaction--seams/probes/hook-never-settles.sh
expect: hung_takesOver_answer=STILL PENDING after 3000 ms while the defect stands (hung_takesOver_answer=false once bounded)
```

measured 2026-10-08 by chain chain-custom-compaction--seams-20261008-095144-d30e, finding L3, LOW
probe-key: c50b00bdf811bc984fd6c66ada4385b3e23e5150

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-compaction-seams.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/interfaces.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts

## INV-7382 — probe — LOW — a stale `activityChanged({live:false})` fires while a replacement process is still starting

LOW — a stale `activityChanged({live:false})` fires while a replacement process is still starting

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/custom-compaction--seams/probes/stale-not-live.sh
expect: not_live_events_while_the_replacement_was_starting=1 while the defect stands (0 once the end-of-life report waits for the replacement)
```

measured 2026-10-08 by chain chain-custom-compaction--seams-20261008-095144-d30e, finding L4, LOW
probe-key: 55ce2c8d9c301fb181894989852dd5374c6ef3eb

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-compaction-seams.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/interfaces.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts

## INV-7383 — probe — LOW — giving a chat back with `idleCompaction: true` overrides an `idleCompaction` the operator or a project set in a settings file

LOW — giving a chat back with `idleCompaction: true` overrides an `idleCompaction` the operator or a project set in a settings file

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/custom-compaction--seams/probes/clear-overrides-user.sh
expect: user_settings_say_false effective_before=false effective_after_the_seams_give_back=true while the defect stands (…=false when the give-back preserves the user's own setting)
```

measured 2026-10-08 by chain chain-custom-compaction--seams-20261008-095144-d30e, finding L5, LOW
probe-key: 4c6548046773cab96cde07932d9d9c12ad72fca9

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-compaction-seams.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/interfaces.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts

## INV-7384 — probe — LOW — a re-adopted run's report carries bare `sendOptions` and nothing says so

LOW — a re-adopted run's report carries bare `sendOptions` and nothing says so

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/custom-compaction--seams/probes/bare-report.sh
expect: readopted_report_sendOptions={"cwd":"/x"} keys_that_say_it_is_incomplete=0 while the defect stands (the profile's model/effort present, or a key that says "incomplete", once cured)
```

measured 2026-10-08 by chain chain-custom-compaction--seams-20261008-095144-d30e, finding L6, LOW
probe-key: feb0f6745244c4761f805d3fba0d271a8e5eb41f

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-compaction-seams.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/interfaces.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts

## INV-7978 — Claude runtime — the background-call ledger: what holds the CLI open and what releases a hold

`spawnProcess` in `claude-runtime.provider.js` holds two sets of tool-call ids. A call is a hold while its work may still run past the turn that launched it. While `deferredTools` is non-empty the process reads busy (`busy (N background calls have not reported)`), the idle closer and the version sweep keep their hands off it, and a Stop leaves it alive.

| set | contents | filled | emptied |
|---|---|---|---|
| `launchedThisTurn` | ids launched this turn that may outlive it (`backgroundWorkIds`: Bash with `run_in_background`, the `DEFERRED_WORK_TOOLS` names) | every message that carries them | at each `result`; by a `task_notification` naming the id |
| `deferredTools` | ids whose work was still outstanding when a turn ended; persisted in the host meta (`deferredTools`, `heldForBackgroundWork`) | at a `result`: every id still in `launchedThisTurn` | the releases below |

Releases (the only ones; a hold with none of these stays):

| when | release |
|---|---|
| `system/task_notification` with a `tool_use_id`, before or after the launching turn's `result` | that id leaves BOTH sets, by id; a call whose notification came mid-turn never becomes a hold |
| a follow-up turn no task notification woke (a scheduled wake-up, a cron: work the task system never lists) | the OLDEST hold, at that turn's `result` |
| a follow-up turn a notification woke (`init` seen while the follow-up latch `followUp.expected` was armed sets `followUpAnswersNotification`, read and cleared at the `result`) | none: the notification already released its call by id; the other holds may still be running |
| re-adoption (`reattach.deferredTools`) | the ids `listLiveHosts` left after reading the host's journal (MAN-687); a meta with only the bit restores one entry `'re-adopted'` |
| re-adoption (`reattach.liveTasks`) | not a hold of this ledger but the CLI's own task set, `backgroundTasks`, which the process's `activity`, idle closer and compaction guard also read: it starts from the tasks the host's journal shows running (a `task_started` with no `task_notification`, less what the newest `background_tasks_changed` dropped: `host-live-tasks.js`), so every kind of task holds a re-adopted process, not only the kinds `backgroundWorkIds` names |

- why: a notification that arrived before its turn's `result` once still moved its call into `deferredTools` at that result, with nothing left to name it again; the chat read busy for good (2026-10-12: two calls that finished within 12 s held a chat).
- why: a follow-up that releases "the oldest" after a notification released its own call frees a second call that may still be running.
- Not released: a launch that never started (a hook-blocked or denied background Bash) has no notification and no follow-up; it stays held until a follow-up no notification woke arrives.
- Never: replace the ids with a count, release a hold on a timer, or clear the set to unstick a chat. The proof of a finished call is the host journal's own `task_notification` frame, never its absence.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-runtime.provider.js

## INV-9787 — sessions.name_given — edits that break it: the mark is written with a person's rename, never by the app, and a merge keeps name and mark together

Behaviour: MAN-9060.

| Edit | Breaks | Why |
| --- | --- | --- |
| Rename by a person with `updateSessionCustomName` and `markNameGiven` called apart (`renameSessionById` in `sessions.service.ts`, a new door) | a failure between the two leaves the name he gave stored with `name_given = 0`; the namer replaces it at the chat's next turn | `sessionsDb.renameByPerson` runs both in one transaction |
| Give `rename_session` (`companion/tools/act-tools.ts`) a write of its own instead of `renameSessionById` | a name he told Kaylee to keep reads `name_given = 0`; the namer replaces it at the chat's next turn | her rename is his word and takes the sidebar's door |
| Call `markNameGiven` from the app's own naming (the Codex synchronizer, the namer, Kaylee's `create_session` title in `companion-send.ts`) | a name the app chose reads as his and is never replaced | the mark means a person typed the name |
| Write `name_given` back to `0` | a name he typed becomes replaceable | the mark has no undo |
| Merge the duplicate row in `assignProviderSessionId` with `COALESCE(custom_name, …)` alone, or without `MAX(name_given, …)` | the mark and the name part: the app row reads `name_given = 1` over a name he did not give, or his name is lost | a name travels with its mark |
| Backfill `name_given = 1` for existing names | every old name, the app's included, is frozen | no name on disk is known to be his; the first rename marks it |

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/companion-send.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/tools/act-tools.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/migrations.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/sessions.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/services/sessions.service.ts

## INV-9931 — chokidar v4 `ignored` matches no glob — the watcher passes a function

chokidar v4 (4.0.3) takes a path, a `RegExp` or a function in `ignored`; a glob string matches nothing and is dropped silently.

- symptom: a glob list such as `**/subagents/**` left every file and directory under every root watched; the serving API held 22,161 inotify watches.
- fix: `ignored: createWatcherIgnoredMatcher(rootPath)` in `sessions-watcher.service.ts`; the ignored set is in MAN-348.
- measured 2026-10-27: 22,161 → 14,441 watches on the serving API.
- the matcher judges only the path below `rootPath`, so a root that sits under a `build/` or `dist/` directory is still watched; segments match whole (`subagents.jsonl`, `..archive` stay watched).
- an edit to the ignored set: measure the watch count after the handover (`/proc/<pid>/fdinfo` inotify entries), never trust the list.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/services/sessions-watcher.service.ts

## INV-9932 — probe — LOW — a row that parses to JSON `null` still drops the rest of the file in `buildLookupMap`

LOW — a row that parses to JSON `null` still drops the rest of the file in `buildLookupMap`

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && TSX_TSCONFIG_PATH=server/tsconfig.json timeout 90 node --import tsx /home/lyphe/.claude/state/pipeline-reviews/upstream-1376-watcher-lookup/athena-probes/null-row.mts
echo "[probe exit $?]"
# expect: `half-written row between rows a and c -> [["a","1"],["c","3"]]`, `null row … -> [["a","1"]]` (c lost) while the defect stands; cured when the `null row` line also reads `[["a","1"],["c","3"]]`
```

measured 2026-10-27 by chain chain-upstream-1376-watcher-lookup-20261027-153824-5545, finding L1, LOW
probe-key: ab8c02e137d29122f8f1719e05081504ed853815

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/services/sessions-watcher.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/utils.ts

## INV-10698 — provider_session_id — edits that break it: NULL is a live state until a run announces the id, and a turn resumes only a conversation whose transcript exists

Behaviour: MAN-341 (the provider id column's lifecycle) and MAN-339 (the two ids). A chat created into the app holds a NULL `provider_session_id` until its first run announces the provider's own id, and every runtime reads NULL as "start the conversation".

| Edit | Breaks | Why |
| --- | --- | --- |
| Run `addProviderSessionIdMapping` (`database/migrations.ts`) or any backfill gated on `provider_session_id IS NULL` at every boot, not once on the column's own absence | every chat waiting for its first turn at a boot is stamped with its own app id; its first turn resumes a conversation that does not exist ("No conversation found with session ID", no reply, no error frame on the page) and so does every later turn. Measured 2026-11-03: seven failures, five chats, in one hour of ~90 supervisor boots | NULL is a live state of this column, not a gap to fill; the supervisor boots a candidate on every `server/` save, so a boot-time stamp is a race any waiting chat can lose |
| Read `sessionsDb.getSessionById(...).provider_session_id` as the id to resume, in a runtime or a new door, without asking whether the conversation exists | a mapping with no transcript behind it (a stamp, a process that died before it wrote, a removed file) is resumed on every turn and fails on every turn: the chat never recovers | `claude-resumable-session.ts` is the Claude check (`spawnProcess`, once per process start); it keeps the id whenever the lookup cannot say, so it never drops a conversation that was there |
| Skip the check for a process this machine launches, or run it for a re-adopted host or a Cerberus node's project | a launch resumes a dead id; or a node's chat (transcript on the node's disk) is "not found" here, detached, and starts over | a re-adopted host holds its conversation live; the node's transcript is out of this disk's reach |
| Make the check look only at the row's `jsonl_path` | a chat whose transcript exists but the synchronizer has not indexed yet loses its conversation | the recorded path is the quick proof; the scan of the CLI's project folders is the fallback |
| Give the Codex, Cursor or OpenCode runtime the same check by testing `jsonl_path IS NULL` | OpenCode rows indexed from disk have a NULL `jsonl_path` by design (one shared sqlite file), so a live conversation reads as dead | each provider's own transcript is the test; only Claude's is a file named by the id |

Proof: `bash .verify/probe-first-turn-resume.sh before|after` (a second server, a real SIGTERM-and-boot between a chat's creation and its first turn, Haiku, the probe project).

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/migrations.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/sessions.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-resumable-session.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-runtime.provider.js, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/services/sessions.service.ts

## INV-10705 — A turn that ends in an error — edits that break it: the result handler tells the page, the between-turns branch stays silent, a turn that was stopped says nothing

Behaviour: MAN-453 (`error` is an informational row, `complete` the one terminal event of a run). A turn the Claude CLI ends with a `result` whose subtype is not `success` (`error_during_execution`, `error_max_turns`, `error_max_budget_usd`, `error_max_structured_output_retries`) is told to the page by the runtime's result handler (`claude-runtime.provider.js`, the `message.type === 'result'` block): an `error` row naming the cause (`describeErrorResult`, `claude-error-result.ts`: the result's `errors` without the CLI's `[ede_diagnostic]` line, else a sentence for the subtype), then that turn's one `complete` with exit 1 (`success: false`). The same `errors` text is the body of the `run.failed` push (`resultErrorLines`), and a result that ended in an interrupt raises neither the row nor the push (`endedByInterrupt`).

| Edit | Breaks | Why |
| --- | --- | --- |
| Tell the page from the catch's "between turns" branch (drop its `!pendingTurn && (reattach || firstTurnOpened)` return, or send a frame there) | an idle process that dies between turns paints a finished reply as failed, on a page that asked nothing | that branch is right only for a process failing while idle. The error result closes the turn BEFORE the throw that follows it (`Claude Code returned an error result: …`), so the result handler is the one place that still has the turn, the cause and the page. Measured 2026-11-03: a chat resumed on a provider id with no conversation showed the typed message and nothing else, on every try, because that branch dropped the throw and the result handler had sent `complete` exit 0 |
| Send the row for a `subtype: 'success'` result with `is_error` | an API error is on the page twice | the CLI has already put it on the stream as an assistant message (`API Error: …`, read off a host journal), and `api.error` is its push |
| Send the row for a result whose `terminal_reason` is `aborted_streaming` or `aborted_tools`, or for an instance in `abortedInstances` / `supersededInstances` | a Stop, a retirement or an interrupt from the terminal paints an error on a turn the person ended | the CLI answers every interrupt with `error_during_execution`; it is a stop, not a failure. A Stop's own `complete` (aborted) was sent by the abort handler. The `terminal_reason` test (`endedByInterrupt`) is shared with the `run.failed` push, which skips an interrupt too. Not covered: a Stop pressed before the process registers (`abortClaudeSDKSession` answers false, nothing is marked), whose turn runs on and paints its failing result like any other turn, as its reply text also arrives after the aborted `complete` |
| Send the failed result's `complete` with exit 0, or let a second `complete` out | the page plays the completion chime and flashes the title for a failure; or a run has two terminal events | `success: false` is what the page reads to stay quiet (`useChatRealtimeHandlers`); the registry drops a second `complete` |
| Put an `error` row on a reconciliation's skipped result, or on the result of an append that answers no pending turn | a resume's background-task bookkeeping, or an append's bookkeeping result, paints an error | both are skipped before anything client-facing (`continue`, ahead of the handler), and neither is an error subtype. An append that is alone in its push DOES answer the turn: it goes on to its `token_budget` and its `complete` like any turn, and one that ended in an error subtype is told like any turn (the row, exit 1) |

Other runtimes, checked 2026-11-03. Codex already does this (`turn.failed` is an `error` row, then `complete` exit 1). OpenCode has no result message: its failures are `error` events and stderr, both rows. Cursor's `result` with a subtype other than `success` sends an `error` row (the result's text, else the subtype) ahead of its `complete`, unless stderr already put an error on the page, the run is the workspace-trust prompt's (it is retried), or it was aborted; when stderr and the result land in the same tick the stdout line is read first, and the page then shows the failure twice, once from each (measured against the stub; the real CLI's stderr was not available).

Proof: `bash .verify/probe-error-result.sh before|after` (a second server; a chat forced into the failure with no model call; then a Haiku turn the user stops), `TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx .verify/probe-error-result-page.mjs` (the live page, one Haiku-model message, the row still there after the page's re-read) and `bash .verify/probe-cursor-error-result.sh` (the real Cursor runtime against a stub `cursor-agent`, the CLI not being installed here).

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-error-result.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-runtime.provider.js, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-runtime-signals.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/cursor/cursor-runtime.provider.js
