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
