<!-- docstore export; edit rows with docstore write, never this file -->

## INV-7377 — probe — MEDIUM — the process reads IDLE for ~100 ms between a background task's `task_notification` and the follow-up turn it starts, and `activityChanged(busy:false)` fires twice in that gap

MEDIUM — the process reads IDLE for ~100 ms between a background task's `task_notification` and the follow-up turn it starts, and `activityChanged(busy:false)` fires twice in that gap

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/custom-compaction--seams/probes/gap.sh
expect: premature_idle_events=2 notification_to_followup_init_ms=~100 while the defect stands (0 events once the idle is held until the follow-up has run)
```

measured 2026-10-08 by chain chain-custom-compaction--seams-20261008-095144-d30e, finding M1, MEDIUM
probe-key: 5c19f9492760e9452b95265bfb8a5b7bda3fe7bc

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-compaction-seams.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/interfaces.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts

## INV-7378 — probe — MEDIUM — the `resumeFromScratch` cure moves the chat but leaves the transcript it left unsuperseded, so the synchronizer lists it as a second sidebar chat — with the switch OFF

MEDIUM — the `resumeFromScratch` cure moves the chat but leaves the transcript it left unsuperseded, so the synchronizer lists it as a second sidebar chat — with the switch OFF

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/custom-compaction--seams/probes/first-edit-stray.sh
expect: row_moved=true old_superseded=false sidebar_rows_after_old_transcript_is_indexed=2 while the defect stands (old_superseded=true and 1 row once cured)
```

measured 2026-10-08 by chain chain-custom-compaction--seams-20261008-095144-d30e, finding M2, MEDIUM
probe-key: bbe4fc398ba7c2b0cc0f444c76cb79b7f4d8a8e9

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-compaction-seams.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/interfaces.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts

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
