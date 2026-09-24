<!-- docstore export; edit rows with docstore write, never this file -->

## INV-206 — question-cards.mjs is tied to one live session

`node .verify/question-cards.mjs [before|after]` — the label only names the screenshots in `.verify/shots/question-cards/` (gitignored). Needs the dev server at `http://127.0.0.1:5183`; starts no model turn.

| Fact | Detail |
| --- | --- |
| Hard-coded input | `SESSION_ID` `a0cb7bc1-e018-4771-90a0-c734587dc02b` (the operator's intent-lock session of 2026-09-24), `PENDING_TOOL_USE`, `CUSTOM_NOTE_START` |
| Failure when the session is pruned | `tool_use <id> not found in <transcript path>` or `card not found`; reads as a regression and is not one |
| Answered cards | Read from that session in the app; the session still grows and the chat unmounts off-screen rows, so the probe scrolls back and retries until the card stays mounted |
| Pending card | Mounted through the `phase-31.mjs` seam (the app's own `QuestionAnswerContent` in a real `PermissionContext`) with the real payload of the session's last question |
| Gates | 1 answered list is an `<ol>` and `Run it? · lock:` sits outside it · 2 custom note is ONE element · 3 plain option answer is an option row, no custom block · 4 pending list is an `<ol>` · 5 keys `1`, `0`, `Enter` behave and submit the same answer string · 6 no console errors while signed in |
| Noise it forgives | A Vite error overlay from another session's half-saved file (removed before shots, logged, not counted); GitHub calls answered locally as `lib/console.mjs` does |
| `before` mode | Screenshots the current cards only; the old components no longer exist |

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/question-cards.mjs
