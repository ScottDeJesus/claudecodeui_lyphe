<!-- docstore export; edit rows with docstore write, never this file -->

## MAN-7839 — Warden — the node-side agent: enroll, link, outbox, probe kinds, state directory, unit, eis1; the row that holds each

`warden/` is Cerberus's node-side agent: one daemon per machine, holding one signed websocket to center, running the probes center sends and returning their results, and hosting the Claude sessions center assigns it. Plain `.mjs` run by bare `node` ≥ 22, no loader and no dependency; the one exception is the five plain-`.js` session-host files it imports and execs from `server/modules/providers/list/claude/session-host/` (MAN-692). Center's half: `cloudcli:server/modules/cerberus` (MAN-7815, MAN-7816). A plan that changes `warden/` bumps the minor version in `warden/package.json` before it builds (MAN-7826).

## Where each subject lives
| subject | row | files |
|---|---|---|
| the verbs `enroll`, `run`, `status`, exit codes, `run.json`, lost-welcome recovery | MAN-7825 | `main.mjs`, `daemon.mjs`, `enroll.mjs`, `status.mjs`, `home-lock.mjs` |
| the state directory, `releases/`, `current`, what survives a restart | MAN-7836 | `state.mjs`, `chain.mjs` |
| the link: headers, connect signature, pinned center key, welcome, heartbeat, backoff, `readRefusal` | MAN-7824 | `link.mjs`, `wire.mjs`, `ack-watch.mjs` |
| the outbox: resend, seq floor, the 20 000-result cap | MAN-7835 | `outbox.mjs` |
| the scheduler: `checks.set`, `probe.run`, timers, the batch, `prevAt` | MAN-7821 | `probes.mjs` |
| the catalog and the runner: `catalog.set` acked, `run.start` checked against it, `run.output`, the timeout | MAN-7895 | `catalog.mjs`, `runner.mjs`, `run-lines.mjs`, `.verify/warden-catalog-runner.mjs` |
| the probe kinds `http` `tcp` `exec` `file_age` `sql`, the expression grammar, `judge` | MAN-7818 | `expr.mjs`, `probe-support.mjs`, `probe-kinds/` |
| the `health_doc` kind | MAN-7820 | `probe-kinds/health-doc.mjs` |
| the artifact, the three routes, the enrollment token, `enroll.sh` | MAN-7826 | `build.mjs`, `enroll.sh`, `server/modules/cerberus/warden-files.ts` |
| the unit `cerberus-warden.service` | MAN-7837 | `systemd/cerberus-warden.service` |
| the updater and the launcher: `update.offer`, the swap, exit 75, the 60-second probation and rollback, `hello.update` | MAN-7929 | `update.mjs`, `release-files.mjs`, `launcher.mjs` |
| which door delivers a change: the dialog, `enroll.sh --refresh` (a changed launcher, a NEW unit), enroll; releases on disk; the build's `cerberus.note` | MAN-7949 | `enroll.sh`, `build.mjs`, `launcher.mjs`, `systemd/*.service` |
| the diagnosis tools: `diag.open`, `diag.call`, `diag.close`, the three reads, the denylist, the mask | MAN-7928 | `diag-tools.mjs`, `diag-reads.mjs`, `diag-argv.mjs`, `diag-guard.mjs`, `.verify/warden-diag-tools.mjs` |
| the session host: `session.open`, the host registry the API runs, `cerberus-warden-sessions.service` | MAN-7897 | `sessions.mjs`, `systemd/cerberus-warden-sessions.service`, `.verify/warden-sessions.sh` |
| eis1, the first node: nine probes, 74 labels | MAN-7838 | `.verify/probe-warden-probes.mjs` |
| rules an edit keeps | INV-7017 kinds · INV-7028 scheduler · INV-7039 link and outbox · INV-7042 install · INV-7043 daemon · INV-7080 runner · INV-7095 session host · INV-7130 diagnosis tools · INV-7131 updater and launcher | |

## Rules of the package
- Checks stay in the services: a probe exists only for a fact no service reports itself; the one overlap, `system/disk.used`, is named in MAN-7838.
- `denied` is HTTP 401 or 403 only; every other failure is `failing` (MAN-7818).
- No warden code path defaults to a loopback center; `enroll` takes `--center`.
- The warden reads no service's `.env`. `sql` takes its password from `~/.pgpass` through libpq; no probe writes a credential into `value` or `data` (INV-7017); a diagnosis's `file.read` refuses `.env*` and the other secret-bearing paths and masks credential patterns in every text (INV-7130).
- Every log line is `[warden] …` on stdout (`journalctl -u cerberus-warden`).
- Mechanical checks: `node --check` and `oxlint warden/`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/package.json, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/main.mjs

## MAN-7818 — Warden probe kinds — the expression grammar, `judge`, and each kind's fields, metrics and sentences

The five kinds a warden runs itself, and the one comparison they are judged by. `health_doc` (one GET, one result per component, dead-poller rule): MAN-7820. Definitions and what center refuses: MAN-7812.

## Files
| file | owns |
|---|---|
| `warden/src/expr.mjs` | `parseExpr(text)`, `evaluate(expr, metrics)`, `judge(spec, outcome)` |
| `warden/src/probe-support.mjs` | `finishProbe`, `unrunnable`, `missingField`, `describeNetworkError`, `deadlineMs`, `MAX_TIMER_MS`, `clip`, `formatSeconds`, `elapsedMs`, `withDeadline`, `runProcess` |
| `warden/src/probe-kinds/{http,tcp,exec,file-age,sql}.mjs` | one `run(spec, _memory)` each → `{ status, value, data, tookMs }`; none uses `memory` |

## Expression grammar
One comparison: `<metric> <op> <number>[unit]`, one regular expression (`COMPARISON`).
| part | values |
|---|---|
| metric | `status` `took_ms` `exit` `value` `age` |
| op | `<` `<=` `>` `>=` `==` `!=` |
| number | `-?\d+(\.\d+)?` |
| unit | `ms` `s` `m` `h` `d`, on `took_ms` (base ms) and `age` (base s) ONLY |

- `parseExpr` → `{ metric, op, value }` in the metric's base unit, or `null`. `26h` → 93 600 (`age`); `1.1s` → 1100 (`took_ms`).
- A unit on `status`, `exit` or `value` (`value < 5m`) does not parse. why: no time base, so a typo, not a conversion.
- A metric the run did not produce (`value` with no number printed, `status` with no answer) fails every comparison, `!=` included.
- A metric the kind does not measure is unreadable for that kind (`age` on `http`).

| kind | metrics |
|---|---|
| `http` | `status` `took_ms` |
| `tcp` | `took_ms` |
| `exec` `sql` | `exit` `value` `took_ms` |
| `file_age` | `age` |

## `judge(spec, outcome)` → `{ status, value }`
`outcome` = `{ completed, sentence, metrics, data }`. First match wins:
1. `completed` false → `failing`, `value` = the kind's sentence.
2. kind `http` and `metrics.status` 401 or 403 → `denied` (beats a passing `pass`).
3. `pass` (blank → the kind's default) unreadable → `failing`, "The pass expression '<text>' can't be read".
4. `pass` false → `failing`.
5. `warn` unreadable → `failing`, "The warn expression '<text>' can't be read".
6. `warn` true → `warn`; else `ok`.

| kind | default `pass` |
|---|---|
| `http` | `status == 200` |
| `tcp` | `took_ms >= 0` |
| `exec` `sql` | `exit == 0` |
| `file_age` | none: a blank `pass` is unreadable → `failing`, "The pass expression '' can't be read" |

`value` is the kind's sentence in every case except an unreadable expression.

## Kinds
| kind | fields | does | sentences |
|---|---|---|---|
| `http` | `url` | one GET via `node:http(s)`, fresh connection, body never read, redirect NOT followed (302 stays 302) | `HTTP 200 in 7 ms`; `No answer within 5 s`; the network sentence |
| `tcp` | `host` `port` | `net.connect`, closed on connect, nothing sent | `Connected in 3 ms`; `No answer within 5 s`; the network sentence |
| `exec` | `cmd` | `/bin/sh -c cmd`, cwd `$HOME`, own process group; `value` = leading number of the last non-empty stdout line, `null` when none | that line cut to 200 chars; `Exited <code>` when silent; `Did not finish within 1 s`; `Could not start the command (<code>)` |
| `file_age` | `path` | a file, or the newest regular file directly inside a directory (symlinks, subdirectories, `*.partial` not counted) | `Newest file written 8 h ago (docstore-2.dump)`; `No file in <path>`; `Cannot read <path> (<code>)`; `No answer within 5 s` |
| `sql` | `dsn` `query` | `psql -X -A -t -w -d <dsn> -c <query>`; password from `~/.pgpass`; `value` = first column of first row, a number when it parses | `Answered in 39 ms`; psql's first stderr line (cut to 200 chars) or `Exited <code>`; `psql is not installed on this node`; `Could not start psql (<code>)`; `Did not finish within 1 s` |

- `data`: `http` `{ status, took_ms }`; `tcp` `{ took_ms }`; `exec` `sql` `{ exit, value, took_ms }`; `file_age` `{ age, file }`. A run that did not complete: `{ error: 'timeout' | <code> | 'no-file' | 'definition', … }`.
- Network sentences (`describeNetworkError`): `ECONNREFUSED` Connection refused · `ENOTFOUND` `EAI_AGAIN` Host not found · `ECONNRESET` Connection reset · `EHOSTUNREACH` Host unreachable · `ENETUNREACH` Network unreachable · other `Connection failed (<code>)`. The error message is never used. why: it can carry a URL.
- `file_age` ages: under 60 s `N s`, under 1 h `N min`, under 48 h `N h`, else `N d`. A mtime in the future reads age 0, "written 0 s ago", `ok`.
- A missing or unreadable field never throws: `unrunnable` → `failing`, `tookMs` 0, `data.error` `definition`. Sentences: `The definition has no <field>`; `The definition's url can't be read`; `The definition's port can't be read` (`port` an integer 1–65 535).
- `tcp` refuses a missing `host`. why: `net.connect` would turn it into localhost.
- `timeout` is whole seconds in the spec; every kind turns it into a timer delay through `deadlineMs(spec)`.

## Process runner — `runProcess(file, args, { cwd, timeoutMs, keepStderr })`
Resolves, never rejects: `{ ended: 'done', code, signal, stdout, stderr }` · `{ ended: 'timeout' }` · `{ ended: 'error', code }` (spawn failed: `ENOENT`, or a thrown refusal such as a NUL byte).
- The child leads its own process group; at `timeoutMs` the whole group gets `SIGKILL`, so `sleep 317 | cat` leaves no `sleep`.
- The pid is checked (integer above 1) before it is negated for the group signal.
- Every child is held in a live set until it ends; `killLiveProcesses()` sends each group `SIGKILL`. The scheduler's `stop()` calls it, so a SIGTERM of the warden leaves no probe command behind (a result such a run would have made is dropped).
- stdout (and stderr when `keepStderr`) is kept as a tail, `OUTPUT_TAIL_CHARS` = 65 536.
- Measured 2026-10-06: `sleep 6 >/dev/null 2>&1 & echo started` ends `done` in 5 ms and the `sleep` survives. The group is killed only at timeout, so a command that backgrounds a process with its output redirected completes `ok` and leaves it running.

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/src/expr.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/probe-kinds/exec.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/probe-kinds/file-age.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/probe-kinds/http.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/probe-kinds/sql.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/probe-kinds/tcp.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/probe-support.mjs

## MAN-7820 — Warden `health_doc` kind — `run(spec, memory)`, the fan-out, the own check and every sentence

`health_doc` reads a service's own health document with one GET and returns the probe's own check plus one result per component. The service computes the verdicts; the kind carries them. Grammar and the other five kinds: MAN-7818. Definition fields and refusals: MAN-7812. What center keeps from a result: MAN-7811. Rules an edit keeps: INV-7017.

## `run(spec, memory)` → `{ own, components? }`
| name | what |
|---|---|
| `spec.url` `spec.timeout` | the GET; `AbortSignal.timeout(deadlineMs(spec))` covers headers AND body. `deadlineMs` clamps the delay to Node's 32-bit timer limit (INV-7017): a bare `timeout × 1000` past 2 147 483 s aborts every read within milliseconds, and center allows 2 592 000 s. The failure sentence still names `spec.timeout` in seconds |
| `spec.service` | prefix of every component key: `<service>/<id>` |
| `spec.key` | the probe's own key, `<service>/health`; `own` carries NO key, the caller applies `spec.key` (the scheduler, MAN-7821) |
| `spec.cadence ?? spec.every` | seconds; the dead-poller rule reads it |
| `memory` | an object the caller keeps between runs of this probe; the kind writes `lastCheckedAt` and `stillSince` |
| `own` | `{ status, value, data, tookMs }` |
| `components` | present ONLY when `checked_at` moved since the last read |

The GET is unauthenticated: `Accept: application/json`, no credential.

## The document
`{ overall, checked_at, components: { <id>: { status, reason, … } } }`.
- `status` is one of `green` `yellow` `red` `muted`; anything else is not guessed.
- `checked_at`: ISO-8601 with an offset (`ISO_TIME_WITH_OFFSET`): `YYYY-MM-DD`, `T` or a space, `HH:MM[:SS[.fff]]`, then `Z` or `±HH[[:]MM]`. A number or an offset-less string is refused. why: `Date.parse` reads `12345` as a year and a bare string in the warden's zone.
- `components` is a non-array object.

## Component result
`{ check: '<service>/<id>', at, fetchedAt, docStatus, status, value, data }`
| field | value |
|---|---|
| `at` | `Date.parse(checked_at)`, ms: the SERVICE's clock |
| `fetchedAt` | `Date.now()` after the read, ms: the warden's clock |
| `docStatus` | the document's word |
| `status` | `green` → `ok`, `yellow` → `warn`, `red` → `failing`, `muted` → `null` |
| `value` | `reason` when a string, else `null` |
| `data` | the component minus `status` and `reason` |

A component is skipped, and `own` fails with its sentence (the FIRST in document order), when:
- its id fails `CHECK_ID` (`^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$`), or `<service>/<id>` equals `spec.key` (a component `health` is a second writer of the probe's own check) → "The health document has a component Cerberus can't name: <id>"
- its `status` is outside the four words → "The health document has a status Cerberus can't read: <id> = <word>" (`none` when absent, JSON when not a string)

Words quoted into a sentence are cut to 80 characters (`QUOTED_WORD_MAX`). A component with a hostile id still leaves the others published. The check runs on EVERY read, so `own` holds between publications.

## `own` — first match wins
| # | when | status | `value` | `data` |
|---|---|---|---|---|
| 1 | the GET did not complete | `failing` | `The health document could not be read: <word>` | `null` |
| 2 | HTTP 401 or 403 | `denied` | `The health endpoint refused the warden: HTTP <n>` | `{ http }` |
| 3 | HTTP outside 200–299 | `failing` | `The health document could not be read: HTTP <n>` | `{ http }` |
| 4 | body is not JSON | `failing` | `The health document is not JSON` | `{ http }` |
| 5 | `checked_at` not a string of that shape | `failing` | `The health document could not be read: checked_at is not a time with an offset` | `{ http }` |
| 6 | `checked_at` more than `MAX_FUTURE_SKEW_MS` (300 000 ms) past the warden's clock | `failing` | `The health document could not be read: checked_at is ahead of this clock` | `{ http }` |
| 7 | `components` missing, null, array or not an object | `failing` | `The health document could not be read: it has no components` | `{ http }` |
| 8 | `checked_at` did not move and `memory.stillSince` is older than `3 × (cadence ?? every)` s (`STILL_CADENCES`) | `failing` | `The health document hasn't changed since <HH:MM>` | `{ overall, components, http }` |
| 9 | a component problem above | `failing` | the problem sentence | `{ overall, components, http }` |
| 10 | none of the above | `ok` | `Read <n> component[s] in <t>` | `{ overall, components, http }` |

- `data.components` is the component COUNT, not the map. `data.overall` is the document's `overall` when a string, else `null`.
- `<t>`: `<n> ms` under 1 s (`46 ms`), else `<n.n> s` (`3.3 s`). Exactly one component says `component`.
- `<HH:MM>` is the document's `checked_at` in the warden's local time, so it matches the components' `at`.
- Rows 5–7 return before `memory` is touched: a refused document never moves `lastCheckedAt`.
- `MAX_FUTURE_SKEW_MS` mirrors `ingest.service.ts` `MAX_FUTURE_SKEW_MS`. why: center drops every result stamped further ahead, so a document that far ahead would read green while all its components vanish.

## Read-failure words (`READ_FAILURE_WORDS`) — row 1
`describeReadFailure(error, timeoutSeconds)`: the code is `error.cause.code`.
| when | word |
|---|---|
| `error.name` is `TimeoutError` | `no answer within <timeout> s` |
| `ECONNREFUSED` | `connection refused` |
| `ECONNRESET` | `connection reset` |
| `UND_ERR_SOCKET` | `connection closed` |
| `ENOTFOUND` `EAI_AGAIN` | `host name not found` |
| `EHOSTUNREACH` `ENETUNREACH` | `host unreachable` |
| `ETIMEDOUT` `UND_ERR_CONNECT_TIMEOUT` `UND_ERR_HEADERS_TIMEOUT` `UND_ERR_BODY_TIMEOUT` | `no answer` (no seconds: undici's own 10 s connect deadline can fire before `timeout`) |
| `ERR_INVALID_URL`, or a `TypeError` whose message is not `fetch failed` (userinfo in the url) | `the address cannot be used` |
| code starts `HPE_` | `the answer was not valid HTTP` |
| anything else | `the connection failed` |

A new word is a new row in `READ_FAILURE_WORDS`; no library message is passed through.

## `memory`
| key | holds | set |
|---|---|---|
| `lastCheckedAt` | `Date.parse(checked_at)`, ms | when the value differs from the last read; `Z` and `+00:00` spelling one instant are NOT a move |
| `stillSince` | `fetchedAt`, ms, the warden's clock | on the same move |

A frozen document read for the first time is not accused at once: staleness counts from the warden's first sight of that `checked_at`.

## Measured
- 2026-10-06, shadow-connector `http://127.0.0.1:8001/status/infrastructure`: 74 components, 3.3–5.8 s a read; its `checked_at` moves on every request, so every read fans out all 74. Its own `<service>/health` stays quiet.
- 2026-10-06, a frozen copy with `cadence: 1`: read 1 `ok` with components; read 2 `ok`, no `components`; read 3 after 4 s `failing`, "hasn't changed since 11:40".

## Open
- `describeNetworkError` (`probe-support.mjs`, used by `http` and `tcp`) still falls back to `Connection failed (<code>)` for undici codes; this kind words them from `READ_FAILURE_WORDS`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/src/probe-kinds/health-doc.mjs

## MAN-7821 — Warden scheduler — `createProbes({ link })`: checks.set applied and acked, one timer per probe, the batch and its prevAt

`warden/src/probes.mjs` turns the probes center pushes into the results it stores. `createProbes({ link })` → `{ checksVersion, probesRunning, scheduled, runNow(probeKey), stop() }`. `link` is anything with `on(type, handler)` and `send(type, body, { reliable })` — the warden's link, or a stand-in — and may carry `outbox`, which is read through it. The kinds it calls: MAN-7818 (`http`, `tcp`, `exec`, `file_age`, `sql`) and MAN-7820 (`health_doc`). The wire shapes: `server/shared/cerberus-types.ts` (`CerberusChecksSet`, `CerberusProbeSpec`, `CerberusResultWire`). Rules an edit keeps: INV-7028.

## Frames
| frame | what happens |
|---|---|
| in `checks.set { version, probes }` | `apply` |
| in `welcome { checks }` | `apply(checks)` when the welcome carries one (center sends it when the warden's `hello.checksVersion` differs) |
| in `probe.run { probe }` | `runNow(probe)` |
| out `checks.ack { version }` | after every `apply`, not reliable (center sends `checks.set` only while linked) |
| out `result { results }` | reliable, at most 500 results and 4 MiB a frame |

## `apply({ version, probes })`
- A set without an integer `version` and a `probes` array is logged and ignored, with no ack. A probe without a `key`, or whose `every` or `timeout` is not a whole number ≥ 1, is logged and left out; the rest run, and the ack is still sent.
- One timer per probe: the first run after a random 0–`every` seconds, then every `every` seconds. Each turn re-arms the next one before it runs; a wait past `MAX_TIMER_MS` (`probe-support.mjs`; `setTimeout` stops at 24.8 days, center allows 30) is a chain of timeouts (`waitFor`), so it ends on the exact moment.
- A probe whose spec is byte-for-byte unchanged (compared as sorted entries, so field order does not matter) keeps its timer, its `memory` and a run in flight. A changed spec gets a new timer and a new first delay. A probe that left stops, and its `memory` is dropped.
- `memory` is one object per probe key, passed to the kind as its second argument; `health_doc` keeps `lastCheckedAt` and `stillSince` in it.
- A probe never overlaps itself: a run in flight (tracked by key, so a redefined probe's old run counts) makes the next turn skip. A run that ends after its probe left or was redefined is dropped, not sent.
- `kind` is looked up in a `Map`; a kind this warden does not run is a `failing` result, "This warden does not know that kind of probe". A kind that throws is a `failing` result, "The warden could not run this probe", and the log line carries only the error's code or name.

## `runNow(probeKey)` → boolean
Center's recheck after a fix (`probe.run`). The probe runs once now and its result is flushed at once, not after the 1 s batch window; its timer is not touched. A probe whose run is in flight finishes, then runs once more (any number of asks meanwhile make ONE more run), so the answer is never the read that began before the fix. A key this warden does not schedule is logged, "ignoring probe.run for <key>: this warden does not schedule it", and answers false. `stop()` forgets a run asked for and not yet started.

## Results
| source | results |
|---|---|
| a simple kind | one: `check` = `source` = the probe key, `at` = `fetchedAt` = the time the run ended, `docStatus` null, the kind's `status`, `value`, `data`, `tookMs` |
| `health_doc` | its `own` result (same shape, `check` = the probe key) and then each `components` entry as the kind built it, `source` = the probe key, `tookMs` null |

## The batch and `prevAt`
- Results wait in a batch. The first result into an empty batch arms a 1 s timer (no timer ticks while nothing waits); a batch that reaches 500 flushes at once. A flush cuts the batch into frames of at most 500 results and 4 MiB (`FRAME_BYTES_LIMIT`; center closes a socket on a frame past 8 MiB). A result alone over 1 MiB (`RESULT_BYTES_LIMIT`) is sent as `failing`, "The result was too large to send (<n> MB)", `data` `{ error: 'oversize', bytes }`.
- `prevAt` is stamped at flush: the `at` of the last result flushed for that check, read from the `previousAt` map. `createProbes({ link, previousAt })` takes that map from the daemon, which seeds it from `chain.json` — what center had acked before the last stop (INV-7028, `chain.mjs`) — so the first result after a restart carries the `at` it bridges to, and center's reader keeps vouching for the minutes before the stop. A bare `createProbes({ link })` starts an empty map, and a first result then carries null.
- When `link.outbox.overflowing` is true at a flush, every result goes to `outbox.keepLatest` instead of a frame and the `prevAt` memory is cleared; the first result per check after the drain therefore carries `prevAt` null. A link with no `outbox` never overflows.
- `link.send` throwing (the outbox could not reserve a seq on a full disk) drops that frame's results with one log line and forgets those checks' `prevAt` memory, so each one's next result carries `prevAt` null and center records a lapse. (Center never compares a `prevAt` with what it stored: a chain left naming the lost result would read as an unbroken stretch and vouch for the old status across the gap.)
- `stop()` clears every timer, kills the process group of every probe command still going (`killLiveProcesses`, MAN-7818), and flushes what waits; runs still going are dropped.
- `probesRunning` = the number of runs in flight, a measurement the verify probes read. `scheduled` = the probes on the schedule (0 after `stop()`): what the daemon sends as the heartbeat's `probesRunning` (the wire's "how many probes it has scheduled", `cerberus-types.ts`) and writes to `run.json`.

## Measured
- 2026-10-06, interfaces E's seven eis1 probes on a stand-in link for 70 s, then a set without `system/disk.used` for 40 s (`.verify/probe-warden-probes.mjs`): ack 1, 74 component results beside `shadow-connector/health`, the second 30 s result's `prevAt` = the first's `at`; ack 2 and no `system/disk.used` after it. `--pin` pins the first delays so the 60 s and 300 s probes land in the window too.
- 2026-10-06, `.verify/probe-warden-probes-edges.mjs`: a 1 s probe that runs 2.5 s started every 3.00 s; three repeats of an unchanged set left a 2 s probe at 2.00 s gaps; a removed probe sent nothing after; an overflowing outbox got `keepLatest` and no frames; a 601-result read left as frames of 500 and 102 (the extra one a straggler from another probe in the flush).

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/src/probes.mjs

## MAN-7824 — Warden link — `createLink`: connect headers and signature, the pinned center key, welcome and resend, heartbeat, backoff and deadlines, `readRefusal`, `wire.mjs`

`warden/src/link.mjs` is the warden's one socket to center; `warden/src/wire.mjs` is the envelope, the headers and the frame check it shares with `enroll`; `warden/src/outbox.mjs` holds what center has not acked (MAN-7835). Wire shapes: `server/shared/cerberus-types.ts`. Center's half: MAN-7800 (signing), MAN-7803 (gateway), MAN-7814 (registry). Rules an edit keeps: INV-7039. The scheduler on top: MAN-7821. Enrollment: MAN-7825. The home: MAN-7836. The unit: MAN-7837.

## `createLink({ identity, state?, outbox?, home?, onReport? })` → `{ outbox, linked, start(), stop(), on(type, handler), send(type, body, { reliable }) }`
| field | meaning |
|---|---|
| `identity` | `{ node, center, centerKey }` from `identity.json` |
| `state()` | read afresh for every `hello` and heartbeat → `{ checksVersion, catalogVersion, active, probesRunning }` |
| `outbox` | default `createOutbox()` (MAN-7835); exposed as `link.outbox` so a caller reads `overflowing` and calls `keepLatest` |
| `home` | where the node key lives |
| `onReport()` | called after every heartbeat (the one sent at `welcome` included) and each time a retry is scheduled — a link that was up going down, a connect that failed, an attempt that missed its deadline; never on `stop()`. A throw is logged, `the status report failed: <message>`, and goes no further. The daemon rewrites `run.json` from it (MAN-7825) |
| `on(type, fn)` | `fn(body, envelope)` runs after the link's own handling of that type; returns a remover. The one type that is no frame from center is `link.down`: its handlers run, as `fn({}, { type: 'link.down', body: {} })`, when a LINKED socket is lost (never for `stop()`, never for an attempt that did not reach `welcome`) — the session host ends its channels on it (MAN-7897). A throw or rejected promise is logged, "the handler of a "<type>" frame failed", and never ends the process |
| `send(type, body, { reliable: true })` | numbered by the outbox, kept until acked, resent after a reconnect; queued even while down → `{ seq, sent }`, `sent` = it left on this socket now. Throws what `outbox.push` throws |
| `send(type, body)` | only while linked, `seq: null`, gone otherwise → `{ seq: null, sent }` |

`warden/src/link.mjs` re-exports `verifyFrame` and `readRefusal` from `wire.mjs`.

## Connect and trust
1. `WebSocket(<center as ws>/cerberus/ws)` with `X-Cerberus-Node`, `X-Cerberus-At` (epoch ms) and `X-Cerberus-Sig` (base64 ed25519 of `cerberus-connect\n<node>\n<at>`, signed with `keys/node.key`), built fresh for EVERY attempt (`connectHeaders`): center refuses a `(node, at)` pair it saw in the last 2 minutes. `at` rises within the process even when two attempts share a millisecond, and runs at most 1 s (`MAX_AT_BUMP_MS`) ahead of the clock.
2. On open, `hello` is the first frame (`buildHello`: `version`, `startedAt`, `facts`, `checksVersion`, `catalogVersion`, `active`). `facts` = `hostname`, `platform`, `arch`, `nodeVersion`, `machineId` (first line of `/etc/machine-id`, null when absent), `cpus`, `memMb`.
3. Every frame from center is `{ env, sig }`. `verifyFrame` checks `sig` over the exact bytes of `env` against the pinned `centerKey` (the one in `identity.json`, taken from the certificate at enrollment; no other is trusted) BEFORE `env` is parsed. A frame whose `env.node` is another node is dropped.
4. Frames with their own handling: `welcome`, `ack`, `error`. Every type then reaches its `on(type)` handlers.

Drops are logged once per kind per link, not per frame:
| key | line |
|---|---|
| `unsigned` | dropped a frame that is not signed by the center this warden enrolled with (also an unparseable frame) |
| `unreadable` | a signed frame whose envelope is not JSON |
| `malformed` | a signed frame that is not an envelope |
| `other-node:<type>` | a frame addressed to another node |
| `type:<type>` | no handler for the type |

## `welcome` → linked
1. `outbox.ack(body.ackedUpto)` — trims the outbox to what center holds; a non-integer `ackedUpto` counts as 0.
2. Cancels the attempt's deadline, resets `attempt` and the refusal memory, sets `sentUpto = ackedUpto`, `linked = true`.
3. Logs `linked to <center> as <node>` (`; resending <n> unacked frame(s)` when any).
4. `flushUnsent()` puts every queued frame above `sentUpto` on the socket in seq order; an `ack` frame runs `outbox.ack` and `flushUnsent()` again (an ack can drain the outbox below its cap, which queues one frame).
5. A heartbeat at once, then every 15 s (`HEARTBEAT_MS`): `{ version, uptimeS, probesRunning }`, `seq: null`. A second `welcome` on one link replaces the interval.

## Deadlines and backoff
- Each stage of an attempt has 10 s (`ATTEMPT_DEADLINE_MS`): the upgrade, then, from open, the `welcome`. Expiry logs `center did not accept the connection` / `center did not make the link within 10 s; dropping this attempt`, abandons the socket and goes to backoff; an upgrade expiry also runs `readRefusal`.
- Backoff after the nth consecutive close: 1, 2, 4, 8, then 15 s (`BACKOFF_SECONDS`), ±20 %. A `welcome` restarts it at 1 s.
- A connect that never opened runs `readRefusal(url, freshHeaders)` so the log says why; one line per distinct answer: `center refused: <reason>` (401), `center is unreachable: <reason>` (no status), `center answered HTTP <n>: <reason>`; status 101 logs nothing.
- A link that was up and closes logs `link lost — retrying in <n> s` — `<n>` is the next backoff step, always 1 after a `welcome`. Every scheduled retry, that one included, calls `onReport`. `stop()` is not a loss: neither.

## `readRefusal(url, headers)` → `{ status, reason }`
Resolves, never rejects. Repeats the upgrade by hand and reads the 401 body. why: Node's `WebSocket` reports a failed upgrade as a bare error with no status and no body, and the body holds the sentence a person can act on (`token used`, `clock skew 75 s`). `status` is null when nothing answered. `reason` is `oneLine(body)`: first line, control characters removed, at most 200 characters; else `HTTP <n>`. A 101 destroys the socket at once. Waits at most 5 s (`REFUSAL_TIMEOUT_MS`).

## A peer that goes silent — `ack-watch.mjs`
- `createAckWatch(deadlineMs, onSilent)`: one timer that exists only while a reliable frame is outstanding (`sentUpto > outbox.ackedUpto` on a LINKED socket), so an idle warden wakes nothing. `flushUnsent` starts it (`expect`), an `ack` frame ends it and starts it again for what is still unanswered (`settle`), and ANY verified frame from center starts a running one over (`heard`). It runs out after `ACK_DEADLINE_MS` = 90 s (six heartbeats): the link logs `center has answered nothing for 90 s with <n> reliable frame(s) outstanding; dropping the link`, abandons the socket and goes to the normal backoff (1 s after a `welcome`); the next `welcome` resends what is unacked. `goDown` stops it, and so does a `welcome` (its own `flushUnsent` starts it again only for what is still unanswered), so a second `welcome` that acks everything leaves no timer behind.
- why: center answers every reliable frame, a stopped or frozen center holds the socket open and answers nothing, and the heartbeats it never reads fail no send. why ANY frame: a center that speaks is alive, so only total silence with something outstanding trips it. why 90 s: a stored batch is acked in milliseconds and a backlog streams its acks one by one, each of which starts the clock over.
- A reliable frame center leaves unacked on purpose (a type it has no handler for, a handler that threw) trips it only when center also says nothing else for 90 s; the resend after the new `welcome` is idempotent.
- Measured 2026-10-07 on the real link and outbox against scripted centers for 100 s (`.verify/warden-link-silent-peer.mjs`): a center that welcomes and goes silent with 3 frames unacked was dropped at 90 s and relinked, resending 3; one with nothing outstanding, one acking every frame 25 s late while a new one left every 10 s, and one that never acked but spoke every 30 s all kept their one connection.

## Measured
- Same day: `verifyFrame` true on a real center-signed frame; false after `"ackedUpto":5` became `95`, and false after the same JSON was re-spaced.
- Same day, scripted fake center: backoff gaps 1.09, 2.08, 4.53, 9.04, 15.2 s and 1.07 s after a `welcome`; heartbeats every 15 s; an unsigned frame, a frame for another node and an unknown type each logged once.
- Same day: `readRefusal` against the real center answered `101`, `clock skew 75 s`, `unknown node`, `bad signature`, `unknown token`, `ECONNREFUSED`. Node 22.23.3: enroll and connect both work.

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/src/ack-watch.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/link.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/wire.mjs

## MAN-7825 — Warden verbs — `enroll`, `run`, `status`, exit codes, `run.json`, lost-welcome recovery

`node warden/src/main.mjs <verb> [--flag value …]` — bare `node` ≥ 22, no loader, no dependency. Verb output goes to stdout with no `[warden]` prefix; only link and daemon lines carry it. The link: MAN-7824. The home: MAN-7836. The unit: MAN-7837. Center's half of enrollment: MAN-7800 (certificate), MAN-7803 (gateway).

## Verbs
| verb | run | does |
|---|---|---|
| `enroll` | `node warden/src/main.mjs enroll --center <url> --name <name> --token <token>` | becomes a node; `--center` must be `http(s)://host…`, a trailing `/` is dropped |
| `run` | `node warden/src/main.mjs run` | the daemon `cerberus-warden.service` runs (`daemon.mjs`): link, outbox and probes plugged together, until SIGTERM or SIGINT |
| `status` | `node warden/src/main.mjs status` | prints `version`, `home`, `node`, `center`, `enrolled`, `fingerprint` and the newest `run.json` — its age, `linked`, `ackedUpto`, `outbox` (frames queued, and that it is overflowing), `probes` (scheduled, with the checks version) and `daemon` when that build differs from this one; `no heartbeat since — the daemon is not running` when a `linked: true` record is over 45 s old; a field the record lacks reads `not recorded`; every time it prints (`enrolled`, `run`'s `written`) is local with its offset, `2026-10-07 08:59:32 -07:00` (MAN-7950); reads files, speaks to no one |

Exit codes: 0 done · 1 refused or failed (the reason printed; `status` on a home that is not enrolled) · 2 misused (unknown verb or flag, missing flag or value, bad `--center`).

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-daemon.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/daemon.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/enroll.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/home-lock.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/main.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/state.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/status.mjs

## MAN-7832 — Warden verbs — `enroll`, `run`, `status`, exit codes, `run.json`, lost-welcome recovery — `run` — `runDaemon()` → exit code
section: Warden verbs — `enroll`, `run`, `status`, exit codes, `run.json`, lost-welcome recovery/001 `run` — `runDaemon()` → exit code

1. No `identity.json` prints `This node is not enrolled — run enroll.sh with a token from Cerberus` and exits 1 before anything is created. An identity without `node`, `center` or `centerKey` prints `The identity in <file> is incomplete`; a home without `keys/node.key` prints `The node key <file> is missing`; both exit 1. A home another daemon already runs on prints ``A warden is already running on <home> — `node warden/src/main.mjs status` shows what it reports`` and exits 1 (`home-lock.mjs`, below).
2. It builds the outbox, the link, the scheduler, the catalog, the runner (MAN-7895), the diagnosis tools `createDiagTools({ link, home })` (MAN-7928) the session host `createSessions({ link, home })` (MAN-7897) and the updater `createUpdater({ link, home, activeWork, onWorkChange, exit })` (MAN-7929), whose `helloUpdate()` the link's `state()` carries as `update`. The link's `state()` is read from them: `{ checksVersion: probes.checksVersion, catalogVersion: catalog.version, active: { runs, diags, owed: runsOwed(outbox, runs) }, probesRunning }`, where `runs` and `diags` come from the daemon's `activeWork()` — the runner's `{ runs }` spread with the diagnosis tools' `{ diags }` (MAN-7928); `probesRunning` is `probes.scheduled` — the wire's "how many probes it has scheduled", so a heartbeat between two turns reads the same as `run.json`'s `probes`. `owed` is the ids of runs that are over but whose `run.*` frames still wait on the outbox for center's ack (`runsOwed`): center ends a live run that neither `runs` nor `owed` names, so a `run.start` that never arrived does not hold its check. A later plan adds its field there and its `link.on(type, fn)` beside `createProbes`, before `link.start()`.
3. `run.json` is `{ at, linked, ackedUpto, outbox, overflowing, probes, checksVersion, version }`: `at` the daemon's clock in ms, `outbox` the frames queued (`outbox.size`), `ackedUpto` `outbox.ackedUpto`, `probes` `probes.scheduled`. It is written (0600, durably) once at start, after every heartbeat and each time the link schedules a retry (the link's `onReport`, MAN-7824), after a `welcome` or a `checks.set` has been applied (`link.on` handlers registered after `createProbes`, so the scheduler has applied the checks first), and once after stop — so a record says `linked: false` as soon as the link is lost, shows the queue growing at each failed reconnect, and a `linked: true` one more than three heartbeats old is a daemon that is gone. A write that fails (a full disk, a directory in `run.json`'s place) is one log line, `could not write run.json: <reason>`, at start, at a beat and at stop alike; the daemon goes on. `ackedUpto` and the queue still move only at those events: an `ack` does not rewrite the file.
4. Log lines: `warden <version> running as <node>, reporting to <center>`; the link's own `linked to <center> as <node>` and `link lost — retrying in <n> s`; `<SIGNAL> received; stopping`, or `the update is swapped in; stopping` before an update's exit 75.
5. SIGTERM or SIGINT, once: `probes.stop()` (clears the timers, kills the probe commands still going, flushes the batch while the link is up), `runner.stop()` (kills the commands runs started), `diagTools.stop()` (kills the reads a diagnosis has going), `sessions.stop()` (detaches every session channel; the hosts keep running in their own cgroup, MAN-7897), `link.stop()`, `chain.save()` (the acked `prevAt` chain to `chain.json`), the final `run.json`, 250 ms for the close handshake, exit 0. A second signal is ignored. The updater's restart takes the same path with exit code 75 (`exit` of `createUpdater`), the launcher's word for "start the release `current` now names, under probation" (MAN-7929); `main.mjs` exits with the code `run` resolves.

`home-lock.mjs` — `takeHomeLock(home)` → `'held'` · `'taken'` · an error code. One daemon per home: center closes the older link of a node when a newer one connects, so two daemons on one home took it from each other about once a second and both rewrote `state.json`. The lock is a listener on an abstract unix socket named for the home's real path (`\0cerberus-warden:` + the first 32 hex characters of its sha256): the kernel frees it when the process dies, however it dies, so there is no file to go stale and nothing polls. On a platform that cannot bind one (any error but `EADDRINUSE`) `run` logs `could not take the one-daemon lock on this home (<code>); going on without it` and runs.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-daemon.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/chain.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/daemon.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/enroll.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/home-lock.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/main.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/state.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/status.mjs

## MAN-7833 — Warden verbs — `enroll`, `run`, `status`, exit codes, `run.json`, lost-welcome recovery — `enroll` — `runEnroll({ center, name, token })` → exit code
section: Warden verbs — `enroll`, `run`, `status`, exit codes, `run.json`, lost-welcome recovery/002 `enroll` — `runEnroll({ center, name, token })` → exit code

1. A home holding `identity.json` prints `This home is already enrolled as <node> with <center>` and exits 1, before anything is written.
2. The home is created (0700). A key already in it is reused and never replaced (log `reusing the key an earlier enrollment attempt left in this home`); else the ed25519 pair is generated and BOTH halves are written before any socket opens.
3. Key already here: a plain connect handshake first (`connectHeaders(name, home)`); on success the log says `center already knew this node and key; its certificate is recovered`. Else, or on any failure of that try: the enroll handshake (`X-Cerberus-Enroll`, `X-Cerberus-Node`, `X-Cerberus-Key`).
4. A handshake opens one socket, sends `hello`, and waits 10 s (`WELCOME_TIMEOUT_MS`) for a `welcome` for `name`. The `welcome` must carry `cert.centerKey`, verify as a frame against THAT key, and pass `certProblem`: `cert.node` = `name`, `cert.fingerprint` = this node's key fingerprint, `cert.issuedAt` a safe integer, `cert.sig` = the center key's signature of `cerberus-cert\n<node>\n<fingerprint>\n<issuedAt>`.
5. On success `identity.json` is written (`{ node, center, centerKey, cert, enrolledAt: cert.issuedAt }`, 0600) and `Enrolled as <name> with Cerberus at <center>` prints, exit 0.

Failure sentences (each exit 1):
| cause | printed |
|---|---|
| upgrade refused with 401 | center's own reason (`token used`, `unknown token`, `clock skew 75 s`, `unknown node`, `bad signature`) |
| nothing answered | `Cerberus at <center> did not answer (<code>)` |
| other HTTP status | `Cerberus at <center> answered HTTP <n>: <reason>` |
| 101 on the explaining request | `The connection to Cerberus failed` |
| socket closed after open | center's last `error` frame message, else `The connection closed before a welcome` |
| no `welcome` in 10 s | center's last `error` message, else `No welcome from Cerberus within 10 s` |
| `welcome` without `cert.centerKey` | `The welcome carried no certificate` |
| frame not signed by the key it carries | `The welcome is not signed by the key it carries` |
| bad certificate | `The certificate is not for this node's key` / `The certificate's signature does not hold` |

An `error` frame's message is unsigned before the key is pinned: it is shown through `oneLine`, never trusted.

The home — its location, layout and what survives a restart: MAN-7836.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-daemon.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/daemon.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/enroll.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/home-lock.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/main.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/state.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/status.mjs

## MAN-7834 — Warden verbs — `enroll`, `run`, `status`, exit codes, `run.json`, lost-welcome recovery — Measured
section: Warden verbs — `enroll`, `run`, `status`, exit codes, `run.json`, lost-welcome recovery/003 Measured

- 2026-10-06, slot-1 probe server: `enroll` printed `Enrolled as probe-node with Cerberus at http://127.0.0.1:7896`, exit 0; a second home with the spent token exit 1 `token used`; the first home again exit 1 `This home is already enrolled…`; `identity.json` and `keys/node.key` 0600.
- Same day, `identity.json` deleted after an enrollment and `enroll` re-run with the spent token: exit 0 by the plain connect (lost-welcome recovery).
- Same day, scripted hostile center: a `welcome` signed by another key, a certificate for another key, a bad certificate signature, no certificate, and a silent center each exit 1 (the silent one after 10 s), keys on disk each time.
- Same day, `.verify/warden-daemon.sh` on the slot-3 probe server (`SUNSET_SLOT=3 bash .verify/warden-daemon.sh`, 4 min): `run` enrolled as probe-node with an http and a tcp probe every 10 s; after 30 s the overview read probe-node `reporting`, both checks `ok`, and `status` printed `linked: true`, `ackedUpto: 3`, `outbox: 0 queued`, `probes: 2 scheduled`. The center killed 20 s and booted again with its store kept (`boot_probe_server --keep-store`; a plain `boot_probe_server` wipes the Cerberus store and key, so an enrolled warden meets a center that does not know it): the log read `link lost — retrying in 1 s`, `center is unreachable: ECONNREFUSED`, `linked to … ; resending 6 unacked frame(s)`, and a lookup of `probe/http.ok` 15 s after the kill answered `result`, `failing`, "Connection refused", from a row written 5.1 s into the outage. SIGTERM: exit 0, a final `run.json` with `linked: false`, `ackedUpto: 12`, `outbox: 0 queued`; 100 s later the overview read probe-node `silent` and both checks `unknown`.
- Same day: `run` in an empty home, an identity with only `node`, an identity with no key — each exit 1 with its sentence, nothing created; a center that was never reachable, then SIGINT: `center is unreachable: ECONNREFUSED`, `SIGINT received; stopping`, exit 0, `run.json` `linked: false`.
- A `run.json` is written at a heartbeat, so a resend's acks (which follow the `welcome`) show in it at the next one, up to 15 s later: `outbox: 6 queued` right after a relink, `0` after.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-daemon.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/daemon.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/enroll.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/home-lock.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/main.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/state.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/status.mjs

## MAN-7826 — Warden install path — `npm run build:warden`, the three gateway routes, the enrollment token, `enroll.sh` (enroll and `--refresh`)

How `warden/` becomes a running unit on a node: the artifact, the routes center serves it on, the script that installs and refreshes it, and the unit it writes. Rules an edit keeps: INV-7042. The verbs the installed warden runs: MAN-7825. Where the gateway routes live: MAN-7803.

## Files
| file | owns |
|---|---|
| `warden/build.mjs` | `npm run build:warden` → `dist-warden/` |
| `server/modules/cerberus/warden-files.ts` | `registerWardenFileRoutes(listen)`, called by `cerberus.module.ts` `start()` before the gateway binds |
| `warden/enroll.sh` | POSIX `sh`: enroll and `--refresh` |
| `warden/systemd/cerberus-warden.service`, `warden/systemd/cerberus-warden-sessions.service` | the unit templates; `enroll.sh` fills `__USER__`, `__HOME__`, `__NODE__` (the second uses `__USER__` alone) |

## The artifact — `npm run build:warden`
- Stages `warden/{package.json,enroll.sh,src,systemd}` and the five session-host files (`server/modules/providers/list/claude/session-host/{host.js,host-conn.js,host-journal.js,host-live-tasks.js,host-registry.js}`, MAN-7897) at their repo paths, plus a release-root `package.json` (`type: module`, so those `.js` files are read as ES modules on every Node ≥ 22), into `dist-warden/stage-XXXXXX` (`mkdtemp`), writes `dist-warden/cerberus-warden-<version>.tar.gz` (`tar -czf … -C <stage> .`, to `<name>.partial` first and renamed once `tar` exits 0), `<file>.sha256` (`sha256sum -c` format) and `latest.json` `{ version, file, sha256, size, note, builtAt }`, where `builtAt` is local time with its offset (`2026-10-07T08:59:32.469-07:00`), never a `Z` (MAN-7950), and `note` is the one line `warden/package.json` carries under `"cerberus": { "note": … }` — what the Update wardens dialog shows as its note (MAN-7934) and what `update.offer` carries (MAN-7929). `latest.json` is renamed in last, so a node that reads it finds a whole tarball; a failed or killed build leaves the served name untouched.
- Two refusals before anything is built, each exit 1. A `package.json` with no `cerberus.note` (absent, empty or blank, or not a string): "warden/package.json carries no note — add "cerberus": { "note": "<one line saying what this release changes>" }." A note holding a CR or LF inside it: "The note in warden/package.json must be one line." A leading or trailing newline is trimmed, not refused. `latest.json`'s readers (`enroll.sh` reads only `version`, `file` and `sha256`) are unaffected by the extra field.
- The stage is removed only while its path still begins `dist-warden/stage-`. A missing release path is refused BEFORE the stage exists; a SIGKILL or SIGTERM mid-build (the work is synchronous, so no handler can run) leaves its `stage-*` and `.partial` in the git-ignored directory, and a later build does not sweep them.
- A version already built is refused with one sentence unless `--force`; through npm that is `npm run build:warden -- --force` (npm keeps a bare `--force` for itself), and the sentence says so. why: a node holding that version never fetches changed files (`--refresh` installs only a NEWER version), so a plan that changes `warden/` bumps the minor version in `warden/package.json` first, and this refusal is what shows a forgotten bump.
- `dist-warden/` is git-ignored.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-files.ts, /home/lyphe/.claude/claudecodeui_lyphe/warden/build.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/enroll.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/systemd/cerberus-warden.service

## MAN-7946 — Warden install path — `npm run build:warden`, the three gateway routes, the — The routes — `warden-files.ts`, on the gateway (`CERBERUS_LISTEN`)
section: Warden install path — `npm run build:warden`, the three gateway routes, the enrollment token, `enroll.sh` (enroll and `--refresh`)/001 The routes — `warden-files.ts`, on the gateway (`CERBERUS_LISTEN`)

| route | answers |
|---|---|
| `GET /cerberus/enroll.sh` | `warden/enroll.sh` read per request, its `CENTER` marker replaced by `http://<CERBERUS_LISTEN>`; `text/plain` |
| `GET /cerberus/warden/latest.json` | `latest.json` of the build directory; `application/json`, `no-store` |
| `GET /cerberus/warden/<file>` | `<file>` of the build directory, streamed, for `^cerberus-warden-\d+\.\d+\.\d+\.tar\.gz$` only; `application/gzip` |
- Nothing is cached: a file that lands in the build directory is served at once. `npm run build:warden` always writes `dist-warden/`, so its build is live on landing only while `CERBERUS_WARDEN_DIST` is unset. No secret is in any of the three.
- The build directory is `CERBERUS_WARDEN_DIST`, else `<repo>/dist-warden` (`wardenDistDirectory()` in `warden-release.ts`). The updates driver offers the release from the same directory (MAN-7933), so a probe that points the variable at a scratch directory serves and offers its own builds and never touches `dist-warden/`.
- The gateway answers GET only: `HEAD` (`curl -I`) is a 404 on all three routes and reads as "not built".
- A missing `latest.json` or tarball: 404, one line, "No warden has been built — run npm run build:warden". A name outside the pattern (`..`, an encoded slash, `.sha256`): 404 "Not found", judged on the RAW path (nothing is decoded).
- The file route is a PREFIX route (`wardenHttpPrefixRoutes`, tried after the exact `wardenHttpRoutes`): a release's name carries its version, so no exact path can be registered before a build.
- The root is `findApplicationRoot`, the same in source and compiled; a gateway that never bound (no `CERBERUS_LISTEN`, or the API's own port) registers nothing.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-files.ts, /home/lyphe/.claude/claudecodeui_lyphe/warden/build.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/enroll.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/systemd/cerberus-warden.service

## MAN-7947 — Warden install path — `npm run build:warden`, the three gateway routes, the — `enroll.sh`
section: Warden install path — `npm run build:warden`, the three gateway routes, the enrollment token, `enroll.sh` (enroll and `--refresh`)/002 `enroll.sh`

Run as `curl -fsSL http://<center>/cerberus/enroll.sh | sudo sh -s -- --name <node> --token <token>` or `… | sudo sh -s -- --refresh`. Center prints the first: `POST /api/cerberus/enrollments` `{ name, desc? }` → `{ name, token, command, expiresAt }` (MAN-7802), `command` built from the gateway's listen address.
- The token is `XXXX-XXXX-XXXX`, lives 15 minutes (`TOKEN_LIFETIME_MS`) and is single-use: the gateway checks it at the upgrade and spends it when the warden's `hello` arrives, in one transaction with the node's row (a failed enrollment burns nothing). Center stores only its sha256. A spent, late or unknown token fails the enroll step with center's own word: `token used`, `token expired`, `unknown token` (MAN-7803).
- `--name`: lower-case letters, digits and hyphens, at most 32 characters, never `center`.
| step | enroll | `--refresh` |
|---|---|---|
| refuses | no root; `SUDO_USER` empty or `root`; no `node` ≥ 22, `curl`, `tar`, `sha256sum`, `systemctl`, `tmux` (at `/usr/bin/tmux`, where the sessions unit starts it); a copy with no center address; an `identity.json` already there (before any release is fetched or swapped) | the same, except the identity: it refuses when `identity.json` is MISSING, or when given a `--name`/`--token` |
| release | always: `latest.json`, tarball, SHA-256 check, extract AS the account into `~/.cerberus-warden/releases/<version>/`, swap `current` (a temporary symlink, then `mv -T`) | only when `latest.json`'s version is newer than `current`'s |
| enroll | `node current/warden/src/main.mjs enroll --center … --name … --token …` as the account | never; identity and keys are untouched |
| launcher | copies `warden/src/launcher.mjs` out of `current` to `~/.cerberus-warden/launcher.mjs` (as the account, to `launcher.mjs.next` and renamed in) BEFORE the units are rendered — the unit's `ExecStart` runs that copy, outside every release (MAN-7929); a release without a launcher stops the install | the same, whether or not a newer release was fetched, so a copy that went missing is restored |
| unit | renders EVERY `warden/systemd/*.service` the release carries, `daemon-reload`, `enable --now` each unit not yet enabled (the warden and `cerberus-warden-sessions`), `restart cerberus-warden` (`enable --now` starts nothing on a unit already running) | renders EVERY `warden/systemd/*.service` the release carries, `daemon-reload`, `enable --now` any unit not yet enabled, `restart cerberus-warden` — and only that: `cerberus-warden-sessions` holds the node's running sessions and a refresh never restarts it (INV-7095); a sessions unit that will not start is a warning on stderr and the refresh goes on to restart the warden |
| needrestart pin | `pin_needrestart`, right after the units are rendered: `/etc/needrestart/conf.d/99-cerberus-warden-sessions.conf` (0644) keeps `cerberus-warden-sessions.service` out of needrestart's restarts; no such directory: nothing written, one line says so; a failed write is a warning on stderr (INV-7095, MAN-7921) | the same, whether or not a newer release was fetched |
| last line | "The warden on <name> is reporting to Cerberus at <center>." | "The warden on <node> runs <version>." |
- The account is `SUDO_USER`, its home from `getent passwd`; everything under `~/.cerberus-warden` is made as that account (`sudo -n -H -u`), so it owns its home and keys. why: writing a unit takes root and the warden must not be root: its probes need that account's `~/.pgpass` and services (MAN-7837).
- Before the last line `require_linked` waits up to 30 s for the daemon's own word that center let it in: a `run.json` written after the restart with `linked: true`. A unit that falls over is reported, and a unit that runs but is refused (a clock more than 60 s off is the usual cause: the enrollment connect has no clock check, every later connect does) stops the script with center's own reason from the journal (`center refused: clock skew 120 s`) and exit 1. The unit stays installed and enabled; the last line is never printed for a warden that is not linked.
- An enrollment whose later steps fail leaves a home that `--refresh` finishes (identity exists, unit missing).
- Releases accumulate under `releases/`; nothing prunes them (the script removes no path it did not make itself).

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-files.ts, /home/lyphe/.claude/claudecodeui_lyphe/warden/build.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/enroll.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/systemd/cerberus-warden.service

## MAN-7948 — Warden install path — `npm run build:warden`, the three gateway routes, the — Measured 2026-10-06 on a scratch center (slot 2) with a private mount namespace over
section: Warden install path — `npm run build:warden`, the three gateway routes, the enrollment token, `enroll.sh` (enroll and `--refresh`)/003 Measured 2026-10-06 on a scratch center (slot 2) with a private mount namespace over

- Measured 2026-10-06 on a scratch center (slot 2) with a private mount namespace over `/etc/systemd/system`, a stubbed `systemctl` and the real `sudo -u`: wrong token → "unknown token", then "Cerberus did not enroll this machine, so no unit was installed."; enroll, enroll again, refresh with nothing newer, refresh from 0.0.9; a wrong SHA-256, a closed port and a 404 each stop with one sentence and leave no `/tmp/cerberus-warden.*`.

- The first install on eis1, the handover and the two-minute stop: MAN-7838.
- Measured 2026-10-06 on eis1: 0.2.0 (the chain kept across a restart, and `require_linked`) built with `npm run build:warden` and installed with the printed `curl -fsSL http://100.103.222.79:3012/cerberus/enroll.sh | sudo sh -s -- --refresh` — the first `--refresh` run live: "Fetching the warden 0.2.0 from http://100.103.222.79:3012", "The warden on eis1 runs 0.2.0.", exit 0, `current` -> `releases/0.2.0` beside the kept `releases/0.1.0`, the identity fingerprint unchanged, the daemon linked within its first seconds, and `chain.json` (0600) written within 30 s of the first ack.

## The units
`cerberus-warden.service` — directives, the account and why, the restart policy: MAN-7837; the state directory it runs against: MAN-7836. `cerberus-warden-sessions.service` — the session host's tmux server, rendered and enabled with it and never restarted by `--refresh`: MAN-7897.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-files.ts, /home/lyphe/.claude/claudecodeui_lyphe/warden/build.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/enroll.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/systemd/cerberus-warden.service

## MAN-7835 — Warden outbox — `createOutbox`: probe results queued for center, re-sent after `welcome.ackedUpto`, seqs reserved 1 000 at a time, the 20 000-result cap with `keepLatest` and `prevAt: null`

`warden/src/outbox.mjs` holds what the warden has said that center has not acked. The daemon builds one and hands it to the link as `link.outbox`; the link resends from it (MAN-7824) and the scheduler pushes results into it (MAN-7821). Wire shapes (`ack`, `welcome.ackedUpto`): `server/shared/cerberus-types.ts`. Rules an edit keeps: INV-7039.

## `createOutbox({ home?, maxResults = 20000 })`
| call | does |
|---|---|
| `push(type, body)` → seq | numbers and queues; a `result` body without a `results` array throws `TypeError` before anything is numbered |
| `pending(afterSeq)` | queued frames above `afterSeq`, seq order |
| `ack(upto)` | trims frames at or below `upto`; ignores a non-integer or negative `upto`; raises the counter above `upto`; renumbers frames queued under numbers center already holds (`renumberAbove`); leaves overflow when the queue is under the cap |
| `keepLatest(result)` | while overflowing: holds the newest result per `check` (by `at`), `prevAt` forced to null |
| `overflowing`, `size`, `queuedResults` | read-only: the flag, frames queued, results inside them |
| `ackedUpto` | read-only: the highest `upto` center has sent (an `ack`, or `welcome.ackedUpto`); 0 until one arrives. The daemon writes it to `run.json` |

## Reliable frames and resend
1. `link.send(type, body, { reliable: true })` → `outbox.push`: numbered and queued, link up or down. A frame sent without `reliable` never enters the outbox.
2. While linked the link puts the queued frame on the socket at once.
3. Center answers `ack { upto }`: frames at or below `upto` leave the queue.
4. After a reconnect, `welcome.ackedUpto` trims the queue the same way, then every frame above it is re-sent in seq order.
5. The queue is memory only. A restart forgets unacked frames and the probes that made them run again; the one thing persisted is the seq floor.

## Seqs reserved 1 000 at a time
- `seqFloor` in `<home>/state.json` (the home: MAN-7836) is a ceiling every handed-out number stays below. To hand out a number at or past it, `<number> + 1000` (`FLOOR_STEP`) is written and fsynced first. A write that fails (full disk) throws from `push` before any number leaves, and the counter stays.
- The first number is 1 (center refuses `seq` < 1). After a restart the counter starts at the persisted floor, so it skips whatever the last run may have used. why: center treats a seq at or below what it acked as a resend and answers without storing, so a repeated seq silently loses a batch.
- `state.json` lost: the floor reads 0, and the next `ack(upto)` or `welcome.ackedUpto` raises the counter above what center holds. Frames already queued under numbers center holds are renumbered above them, not trimmed as stored; one log line, `center holds results up to #<n>, past this warden's sequence; renumbering <k> queued frame(s) above it`.

## The 20 000-result cap
| step | what happens |
|---|---|
| enter | after a `push`, queued results (counted inside `result` frames, not frames) exceed `maxResults`: `overflowing` true, log `outbox holds <n> unacked results; keeping only the latest per check until center acks` |
| while | the scheduler reads `overflowing` at each flush and calls `keepLatest` instead of sending frames, and clears its `prevAt` memory (MAN-7821). The first result per check after the drain carries `prevAt: null` |
| leave | an `ack` leaves `queuedResults` below `maxResults`: `overflowing` is false, the kept results, sorted by `at`, go out as ONE `result` frame through `push`, and `push` resumes; log `outbox drained; <n> kept results queued as one frame`. That frame can lift `queuedResults` back over the cap (at most one result per check): `push` then re-enters overflow in the same `ack`, with its `enter` log line before the `drained` one |
| leave fails | the push at release throws (the floor could not be reserved): `overflowing` stays true and the next `ack` retries |
- `prevAt: null` tells center the chain before the kept result is gone, so it records a lapse. why: the results in between were dropped, and a chain naming a dropped result would read as an unbroken stretch.
- The caller chooses `push` or `keepLatest`; the outbox does not guess which results a frame holds.

## Measured
- 2026-10-06, slot-1 probe server (`scripts/sunset-probe.sh`): results 1–3 acked; server killed, results 4–5 queued `sent=false`; on reconnect `welcome ackedUpto=3`, `resending 2 unacked frame(s)`, `ack upto=4`, `ack upto=5`; `state.json` `{"seqFloor":1001}`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/src/outbox.mjs

## MAN-7836 — Warden home — `~/.cerberus-warden` (`CERBERUS_WARDEN_HOME`): `releases/`, `current`, `keys/`, `identity.json`, `state.json`, `chain.json`, `run.json`, and what survives a restart

The one directory a warden keeps its state in. `enroll`, `run`, `status` and `enroll.sh` all read or write it; `warden/src/state.mjs` names every path in it (`homePaths`) and writes all but `releases/`, `current` and `launcher.mjs`, which `enroll.sh` makes (the updater and the launcher also swap `current`, MAN-7929), and `sessions/`, which `warden/src/sessions.mjs` makes (MAN-7897). Verbs and exit codes: MAN-7825. Install: MAN-7826. Link: MAN-7824. Outbox: MAN-7835. Unit: MAN-7837. The first node: MAN-7838.

## Location
| who | home |
|---|---|
| `enroll`, `run`, `status` | `CERBERUS_WARDEN_HOME` when set and non-empty (made absolute), else `~/.cerberus-warden` (`homeDir()`) |
| `enroll.sh` and the unit | always `<account home>/.cerberus-warden`: neither passes `CERBERUS_WARDEN_HOME`, so the variable serves scratch homes, never the installed one |

The home and `keys/` are created 0700 and `chmod`ed 0700 on every use. Every write is temp file → fsync → rename → fsync of the directory.

## Layout
| path | made by | holds | mode |
|---|---|---|---|
| `launcher.mjs` | `enroll.sh`, from each release it installs or refreshes | the launcher the unit runs, outside every release (MAN-7929); a change to it reaches a node only by `--refresh` (MAN-7949) | — |
| `releases/<version>/` | `enroll.sh`, and the updater on an `update.offer` | one extracted release, at its repo paths: `warden/package.json`, `warden/enroll.sh`, `warden/src/**`, `warden/systemd/**`, the five session-host files in `server/modules/providers/list/claude/session-host/`, and a root `package.json` (`type: module`) | — |
| `current` | `enroll.sh`, the updater, the launcher | relative symlink `releases/<version>`, swapped atomically (`current.next`, then `mv -T` or a rename); the launcher runs the warden through it | — |
| `pending-update.json` | the updater at the swap; the launcher at a rollback | `{ updateId, from, to, swappedAt }`, and after a rollback `failed` (the version that failed) and `reason`; removed by the running release after the first `welcome` that follows a `hello` carrying it (MAN-7929) | 0600 |
| `hello-ok.json` | the running release, after every `welcome` | `{ version, at }` — the launcher's proof that a release started and was let in | 0600 |
| `keys/node.key` | `enroll` | private key, PKCS8 PEM; the source of truth | 0600 |
| `keys/node.pub` | `enroll` | public half, a derived copy | 0644 |
| `identity.json` | `enroll`, once | `{ node, center, centerKey, cert, enrolledAt }` | 0600 |
| `state.json` | the outbox | `{ seqFloor }` (MAN-7835) | 0600 |
| `chain.json` | the daemon | `{ <check>: at }` — the last result per check center has acked, so a restart keeps each `prevAt` chain (INV-7028); written on acks, at most every 30 s, and at a clean stop | 0600 |
| `sessions/` | the daemon, at start (`chmod`ed 0700) | per session host `<hostId>.json` (meta), `<hostId>.ndjson` (journal), `<hostId>.sock` (socket); MAN-7897 | 0700 |
| `run.json` | the daemon | `{ at, linked, ackedUpto, outbox, overflowing, probes, checksVersion, version }`, rewritten at every heartbeat and link event (MAN-7825) | 0600 |

## What persists
| survives a restart, a `--refresh` and a reboot | if lost |
|---|---|
| `keys/`, `identity.json` | `identity.json` alone: `enroll` re-run on the same home recovers it with a plain connect (MAN-7833). The key is the node's identity; `--refresh` never touches either |
| `state.json` | the floor reads 0; the next `welcome.ackedUpto` raises the counter above what center holds and queued frames are renumbered |
| `chain.json` | every first result per check carries `prevAt: null`: one lapse each |
| `releases/`, `current` | nothing prunes `releases/`; `--refresh` adds a version beside the old |

| memory only, gone at every restart | what rebuilds it |
|---|---|
| the outbox queue, and results `keepLatest` held | the probes run again |
| the probe schedule and each probe's `memory` (`health_doc`: `lastCheckedAt`, `stillSince`) | `hello` reports `checksVersion: null`, so `welcome.checks` carries the set |
| the `prevAt` map beyond what `chain.json` saved | the first result per check carries the saved `at`, or null |
| backoff, deadlines, `linked` | the link redials |
| the one-daemon lock | none: an abstract unix socket the kernel frees when the process dies (MAN-7832) |

- `sessions/` survives a warden restart and a `--refresh`: the hosts run in `cerberus-warden-sessions`' cgroup (MAN-7897). After a reboot its files are residue that `sweepDeadHosts()` removes at the next start.
- `run.json` is never read by the daemon: `status` and `enroll.sh`'s `require_linked` read it.
- Unreadable files: `state.json` is logged and its floor starts at 0; `chain.json` is logged and every first result starts a new chain.

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/enroll.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/chain.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/state.mjs

## MAN-7837 — Warden unit — `cerberus-warden.service`: `User=` the operator, `Restart=always`, the installed release, no TCP listener

One of the two systemd units a node runs for Cerberus; the other, `cerberus-warden-sessions.service`, holds the node's session-host tmux server (MAN-7897). Template: `warden/systemd/cerberus-warden.service`. Installed copy: `/etc/systemd/system/cerberus-warden.service`, rendered by `enroll.sh` per machine and never edited by hand. Install and refresh: MAN-7826. What `run` does: MAN-7825. Rules an edit keeps: INV-7042.

## Directives
| line | value | why |
|---|---|---|
| `Type=simple` | the launcher stays in the foreground and runs the daemon (`node … main.mjs run`) as its child | |
| `User=__USER__` | the account that ran `sudo` (`SUDO_USER`), never root | the probes need that account's `~/.pgpass`, state directories and loopback services; a root warden would make every command center can schedule a root command |
| `WorkingDirectory=__HOME__`, `Environment=HOME=__HOME__` | that account's home from `getent passwd` | `exec` probes run with cwd `$HOME`; the warden's home is `$HOME/.cerberus-warden` (MAN-7836) |
| `Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin` | system directories only | |
| `ExecStart=__NODE__ __HOME__/.cerberus-warden/launcher.mjs` | `__NODE__` = `command -v node` at install; the launcher is a copy `enroll.sh` makes from each release it installs, and it runs whatever `current` names | the launcher lives outside every release, so a release that cannot start cannot take its own rescue with it; `--refresh` and an `update.offer` swap `current`, so `systemctl restart cerberus-warden` runs the new release (MAN-7929) |
| `Restart=always`, `RestartSec=5` | every exit — a crash, a kill, a clean exit — restarts 5 s later | the link redials by itself; only `systemctl stop` keeps it down |
| `After=network-online.target` | | |
| `WantedBy=multi-user.target` | `enable` starts it at boot | |

- `enroll.sh` fills `__USER__`, `__HOME__`, `__NODE__` with `sed`, after checking all three to `A-Za-z0-9._/+@-`; a rendered unit that still holds a `__WORD__` marker stops the install.
- No `CERBERUS_WARDEN_HOME` in the unit: the daemon's home is `$HOME/.cerberus-warden`.
- `enroll.sh` renders and `enable --now`s every `warden/systemd/*.service` the release carries: this unit and `cerberus-warden-sessions.service` (MAN-7897), the tmux server that holds the node's chat sessions in a cgroup apart from this unit's, so `systemctl restart cerberus-warden` never reaches one. The warden asks it over `tmux -L cerberus-warden` and refuses a session when it is down.

## Network and log
- Dials `identity.json`'s `center` (eis1: `http://100.103.222.79:3012`, the gateway). Listens on no TCP port; its one listener is an abstract unix socket that keeps a second daemon off the home (MAN-7832).
- Every log line is `[warden] …` on stdout, and the launcher's own are `[launcher] …`: `journalctl -u cerberus-warden`.

## Commands
| when | do |
|---|---|
| is it up | `systemctl is-active cerberus-warden` → `active` |
| what it reports | `node ~/.cerberus-warden/current/warden/src/main.mjs status` |
| take it down | `sudo systemctl stop cerberus-warden`: center reads the node `silent` and its checks `unknown`; `start` resumes (MAN-7838) |
| run a newer release | `curl -fsSL http://<center>/cerberus/enroll.sh \| sudo sh -s -- --refresh` |

## Measured
- 2026-10-07, eis1: `systemctl show cerberus-warden -p User -p Restart -p RestartUSec -p ExecStart` → `User=lyphe`, `Restart=always`, `RestartUSec=5s`, `/usr/bin/node /home/lyphe/.cerberus-warden/launcher.mjs`; `current` → `releases/0.7.0`; `systemctl is-active` → `active`. 2026-10-06 on 0.2.0: `systemd-analyze verify` on the installed copy printed nothing; `ss -tlnp` held no listener for the warden's pid.

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/systemd/cerberus-warden.service

## MAN-7838 — eis1 — the first node: its nine probes and why each exists, shadow-connector's 74 labels, and the measured install

eis1 is the host Cerberus runs on, enrolled as a remote node: the first warden and the proof of the install path. Its definition is one document in Cerberus's store (`GET` / `PUT /api/cerberus/definitions/eis1`, MAN-7812); `.verify/probe-warden-probes.mjs` carries the first seven probe specs (every one but the estate-backup pair) as its verification copy. The pair, `estate-backup/copy.age` and `estate-backup/drill.age`, went in on 2026-10-07 by one `PUT` of the whole document with the service `estate-backup` ("Cloud backup") appended, together with the fix "Back up now" (MAN-7925); what they judge: `estate-backup status copy` and `status drill` (MAN-8018). Probe kinds: MAN-7818, MAN-7820. Unit: MAN-7837. Home: MAN-7836. Install: MAN-7826.

## Facts
| item | value |
|---|---|
| node | `eis1` |
| center | `http://100.103.222.79:3012` (`identity.json`), the tailnet address; no warden code path defaults to a loopback center, so the first node is remote in every way but geography |
| installed | `current` → `releases/<version>`, moved by the updater (MAN-7929), the version in force is eis1's `wardenVersion` in `GET /api/cerberus/overview`; unit `cerberus-warden.service` as `lyphe` |
| checks | 83 = 74 components + 9 probes' own checks (`shadow-connector/health` is one of the 9) |

## The nine probes
Rule: a probe exists only for a fact no service reports itself (Ruling 3: no check is reimplemented), with one exception, `system/disk.used`, for which the operator waived Ruling 3 on 2026-10-07 (its row). shadow-connector reports its own 74 components in its health document; the warden carries that document and probes nothing else it already reports (Supabase, Postgres, n8n, the Xact tokens). `staleAfter` is 3 × `every`, so a quiet check stays vouched for between runs (the three 300 s probes state 900 explicitly).
| key | kind · target | every / timeout | judged by | label | why it exists |
|---|---|---|---|---|---|
| `shadow-connector/health` | `health_doc` `http://127.0.0.1:8001/status/infrastructure`, `cadence` 30 | 30 / 15 | the document's own words; own check `ok` when it reads | Health document is readable | the one door for shadow-connector's verdicts: the service computes each component's status and reason, the warden carries them |
| `cloudcli/http.ok` | `http` `http://127.0.0.1:3011/health` | 30 / 5 | `status == 200` | Answers its health check | CloudCLI reports nothing about itself to Cerberus |
| `archpulse/http.ok` | `http` `http://127.0.0.1:8005/health` | 60 / 5 | `status == 200` | Answers its health check | ArchPulse reports nothing about itself to Cerberus |
| `docstore/tcp.up` | `tcp` `127.0.0.1:8006` | 60 / 5 | connected | Answers on its port | the docstore door's listener; its database is a separate process |
| `docstore/db.connect` | `sql` `postgresql://docstore@127.0.0.1:5433/docstore`, `select 1` | 60 / 10 | `exit == 0` | Its database accepts connections | the database listens on its own port (5433), so the door's port can stay up while it is down; the password comes from `~/.pgpass` |
| `docstore/backup.age` | `file_age` `/home/lyphe/.claude/state/docstore/backups` | 300 / 10 | `age < 26h`, `staleAfter` 900 | Backed up in the last day | a cron backup (`30 3 * * *`, a rotating set `docstore-1..7.dump`) that stops leaves everything else green; 26 h is the daily run plus slack |
| `system/disk.used` | `exec` `df -P / \| awk 'NR==2{sub("%","",$5); print $5"% full"}'` | 300 / 10 | `pass value < 85`, `warn value >= 80`, `staleAfter` 900 | Disk under 85% full | the one overlap, kept by the operator's waiver of Ruling 3 (2026-10-07, "Keep it"): shadow-connector's `system_resources` component also carries `disk.percent` for `/` (yellow past 85 %, red past 95 %, `health.py`), but only while its document reads, and as one component with CPU, memory, temperatures, GPU and uptime. This probe warns from 80 % and fails from 85 %, against the component's 85 % and 95 %, so it speaks first; it does not depend on shadow-connector being up, and it still reports the disk when `system_resources` is muted for its CPU temperature. `value` is the leading number of the last stdout line |
| `estate-backup/copy.age` | `exec` `/usr/local/sbin/estate-backup status copy` | 300 / 10 | `pass value < 26`, `staleAfter` 900 | Copied to Google Drive in the last day | the copy's own report of itself, which no service makes to Cerberus: a night that stops, a Drive that refuses the token or is full, or a repository that never took its first copy leaves every other check green. Only the healthy line opens with a number (hours since the newest copy); every other sentence ("No copy in Google Drive yet — the first upload is running: …", "The weekly check found the copy damaged: …", "No backup has run on this machine") has no `value`, fails the check, and is the check's sentence. 26 h is the nightly run (01:30) plus slack, as `docstore/backup.age`: at 24 the check would go amber every night between last night's copy turning a day old and tonight's landing, while 26 still turns amber the morning after a missed night. It fails as `failing` (amber), never `denied` |
| `estate-backup/drill.age` | `exec` `/usr/local/sbin/estate-backup status drill` | 3600 / 10 | `pass value < 35`, `staleAfter` 10800 | A restore drill passed in the last 35 days | the monthly restore drill (first Saturday, 02:30, in a KVM VM) is what proves the copy restores into a running machine; a drill that fails, or stops running, leaves the copy looking healthy while the restore is broken. `value` is whole days since the last pass; "The restore drill on <Mon d> failed: …" and "No restore drill has passed yet" fail the check with the reason. 35 days is a monthly drill plus a week. Amber (`failing`) too |

## shadow-connector's 74 labels
- A component's label is its PASSING condition in plain English, six words or fewer (74 labels, 3–6 words): `approval_v2_hmac` → "Approval webhook signatures are accepted", `xactimate_token` → "Xactimate token is valid", `xactanalysis_session` → "XactAnalysis polls are succeeding", `supabase` → "Supabase is reachable".
- Source: the docstring of the component's check function, read for its passing condition (its `GREEN:` line where it has one), in `/opt/shadow-connector/cerberus/health.py` (`_check_<id>`); for eight components in a sibling module: `abatement_mail_sweep`, `demo_adoption_integrity`, `demo_extraction_breaker`, `gemini_usage`, `route_auth_census`, `slack_signature` (`check_<id>` in `health_<name>.py`), `corporate_monday_link` (`_check_<id>` in `health_corporate_link.py`) and `eis_backend_auth_posture` (`_check_<id>` in `health_eis_backend.py`) — `health.py` only imports those two. That tree is read and never edited.
- Home: Cerberus's store, as the `label` of each component's check row (`services[shadow-connector].labels.<id>` in the definition). shadow-connector's document carries no label, and neither does the warden.
- A label never clears by omission (MAN-7813). A `labels.<id>` for a component Cerberus has not yet seen is refused (MAN-7812), so the definition went in two `PUT`s: the probes, then, once the 74 components appeared in the overview, the whole document with the labels. Labels do not bump the definition `version`.
- Change one label: `PUT /api/cerberus/labels` `{ node, key, label }` (MAN-7802), or the definition `PUT` with that entry.

## Measured
- 2026-10-06, `npm run build:warden -- --force` (0.1.0 predated several `warden/src` changes and no node had installed it), then the printed `curl -fsSL http://100.103.222.79:3012/cerberus/enroll.sh | sudo sh -s -- --name eis1 --token <token>` ran as the operator and ended "The warden on eis1 is reporting to Cerberus at http://100.103.222.79:3012." on the first try. `ss -tnp` showed the warden connected from 100.103.222.79 to 100.103.222.79:3012.
- Same day, `touch server/index.ts` (a handover): `link lost — retrying in 1 s`, `linked` 1 s later; a lookup inside the gap answered `result`.
- Same day, the unit stopped 135 s: the overview read eis1 `silent` 90 s after the last frame heard and all 81 checks `unknown`; a lookup inside the stop answered `stale` for the 30 s checks and `result` for `system/disk.used` (its `staleAfter` is 900 s).
- Same day, 0.2.0 installed with `… | sudo sh -s -- --refresh`: "The warden on eis1 runs 0.2.0.", `current` → `releases/0.2.0` beside the kept `releases/0.1.0`, identity fingerprint unchanged, linked within seconds.
- Same day, after the pass: `GET /api/cerberus/overview` → eis1 `reporting`, `wardenVersion` 0.2.0, 81 checks; the live document `http://127.0.0.1:8001/status/infrastructure` carried 74 components.
- 2026-10-07 22:02 -07:00, the pair added (`PUT /api/cerberus/definitions/eis1`, version 1 → 2, 7 → 9 probes; the five old services read back unchanged): the warden logged `now running checks version 2: 9 probe(s)`. `estate-backup/copy.age` reported at 22:06 and `estate-backup/drill.age` at 22:41 (39 min: a new probe's first run comes after a random delay between 0 and its `every`, MAN-7821). Both read `failing`, never `denied`; the overview then carried 83 checks.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-warden-probes.mjs

## MAN-7895 — Warden catalog and runner — `createCatalog`, `createRunner`: `catalog.set` acked, `run.start` checked against what was acked, `run.output` batches, the timeout ladder

`warden/src/catalog.mjs`, `runner.mjs` and `run-lines.mjs` hold the fixes center has signed for this node and run exactly those, nothing else. `createCatalog({ link })` → `{ version, find(id) }`; `createRunner({ link, catalog, home? })` → `{ activeWork(), onWorkChange(listener), stop() }`, where `home` is the directory a command starts in (default `os.homedir()`, the same as an `exec` probe — not the warden's state home, whose `keys/` a command should not start in). `link` is anything with `on(type, handler)` and `send(type, body, { reliable })` — the warden's link, or a stand-in. The wire shapes: `server/shared/cerberus-types.ts` (`CerberusCatalogSet`, `run.start`, `run.accepted`, `run.refused`, `run.output`, `run.end`). The design: `design/cerberus/Cerberus Spec.dc.html` §4. Rules an edit keeps: INV-7080.

## Frames
| frame | what happens |
|---|---|
| in `catalog.set { version, entries, oneOffs }` | `apply` |
| in `welcome { catalog }` | `apply(catalog)` when the welcome carries one (center sends it when `hello.catalogVersion` differs) |
| out `catalog.ack { version }` | after every `apply`, not reliable |
| in `run.start { runId, catalogVersion, entryId, proposalId, cmd, timeout, by }` | verified, then `run.refused` or a run |
| out `run.accepted`, `run.refused`, `run.output`, `run.end` | all reliable (the outbox): a link that drops mid-run loses none, and they are resent in order |
| in `probe.run { probe }` | not this file's: `probes.mjs` `runNow(probe)` runs that probe once now and flushes its result at once (MAN-7821 §"`runNow(probeKey)`"); center sends it after a good run with `recheck` (MAN-7909) |

## The catalog
- `apply` keeps `{ version, byId }` — each entry's `{ id, cmd, timeout }` and each one-off's with its `expiresAt` — REPLACING what it held; where an id is both, the entry wins. A `catalog.set` below the held version is logged, "ignoring a catalog.set of version <n>: this warden holds version <m>", and ignored with no ack: a signed frame carries no freshness, and an older one delivered late would bring a retired command back. The catalog in a `welcome` is applied whatever its version — center chose it for this connection, so a center whose store went back to a lower version still converges. A set without a safe-integer `version` and arrays of entries and one-offs is logged and ignored with no ack. An item without an id, a command or a whole-second timeout, or a one-off without a finite `expiresAt`, is logged and left out; the ack is still sent.
- A one-off past its `expiresAt` is dropped when it is looked up (`find`) or when a set arrives already past it, and its id is remembered with the moment, so a refusal reads "expired at 18:54" and not "no such entry". No timer.
- Nothing is written to disk. A restarted warden says `catalogVersion: null` in `hello` and center answers with the catalog in `welcome`; the daemon's `state()` reads `catalog.version` for it.

## Verification — `run.start`, in this order; the first to fail is the run's whole outcome
| # | what must hold | `run.refused { runId, reason }` |
|---|---|---|
| 1 | `catalogVersion` equals the version acked | `Catalog version 13 is not the one this warden acked (12)` — `(none)` before any ack, whatever version the frame names (a `catalogVersion` of null is refused here too, not at step 2) |
| 2 | the id (`entryId`, else `proposalId`; exactly one) is in that version and not expired | `No entry 'x' in catalog v12` · `The one-off 'd1' expired at 18:54` (the warden's local time) · `The run names both an entry and a proposal` · `The run names no entry or proposal` |
| 3 | `cmd` is that id's command, byte for byte (`===`) | `The command is not catalog v12's command for 'x'` |
A frame without a `runId` is logged and ignored (there is nobody to answer); a `runId` that is running, or that ended in this process (the last 500 are remembered), is logged and ignored: one id starts one child, however often the frame arrives. A refusal is logged as `refused run <runId>: <reason>` — never the command.

## The run
1. `run.accepted { runId, startedAt }`, then `/bin/sh -c <catalog's cmd>` with the account's environment, cwd `home`, stdin closed, leading its own process group.
2. Output: each stream is cut at newlines; a trailing CR, escape sequences and control characters are stripped, and text before a lone CR (a progress bar's overwritten part) goes. `n` counts from 1 across both streams in arrival order, `t` is seconds since the start. A batch leaves 250 ms after its first line (armed by a line, not ticking) and `finish()` sends the rest. Bounds: a line is cut at 2000 characters (a longer unbroken stream is cut into several), a run keeps its first 5000 lines or 512 KiB, and the count of what was not kept is one last stderr line.
3. Timeout = the smaller of the catalog's and the frame's: SIGTERM to the process group, SIGKILL 5 s later, and one more SIGKILL to the group as the run is settled, so nothing that ignored the TERM is left; the run ends `timed_out` whatever the command did. The deadline stops when the shell exits: a command that finished in time, but left a child holding its pipes, ends `ok`.
4. The run ends when the shell has exited and its pipes have drained, or 1 s after the shell exits (a command that left a daemon holding stdout does not hold the run open; the daemon is left alone). `run.end { runId, result, exit, endedAt }`: `ok` for exit 0, `failed` for anything else, `exit` null for a signal or a command that did not start (its stderr line says why).
5. `activeWork()` → `{ runs: string[] }`, the daemon's `hello.active.runs` (the children still running; the daemon adds `hello.active.owed`, the runs that are over with frames still unacked on the outbox). `onWorkChange(listener)` runs `listener` whenever a run starts or ends and answers its remover — the event the updater waits on before it restarts the warden (MAN-7929), so nothing polls `activeWork()`. `stop()` kills every child and sends nothing more; center reconciles the runs it still counts with the next `hello`.

## Measured
- 2026-10-06, `.verify/warden-catalog-runner.mjs` on a stand-in link: `catalog.set v1` acked; four `run.start`s refused, one sentence each; `echo` accepted, four lines in four batches (+0.00, +0.40, +0.80, +1.21 s), `ok`, `activeWork()` `["r-echo"]` while it ran and `[]` after; `slow` (timeout 1) `timed_out` at 1.0 s with exit null; `probe.run` answered with a `result` at once.
- Same day, edges on real processes: `yes` for 2 s kept 5000 lines plus the count line and ended `timed_out`; `trap '' TERM; sleep 30 & wait` ended `timed_out` at 6.0 s with no `sleep` left; a command that backgrounded a `sleep` ended `ok` 1.0 s after its shell; a missing cwd ended `failed` with the one stderr line; `stop()` left neither the shell nor its `sleep`, and sent nothing.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-catalog-runner.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/catalog.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/run-lines.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/runner.mjs

## MAN-7897 — Warden session host — `createSessions`: `session.open` spawn and attach over the host registry the API runs, one channel per host, a lost link is a DETACH, `cerberus-warden-sessions`

`warden/src/sessions.mjs` is the node-side half of the session host: a Claude session that runs on this machine for a project center assigned here. `createSessions({ link, home })` → `{ stop() }`, built by `daemon.mjs` beside the scheduler and the runner. `link` is anything with `on(type, handler)` and `send(type, body)` — the warden's link, or a stand-in. The wire shapes: `server/shared/cerberus-types.ts` (`session.open`, `session.frame`, `session.detach`, `session.closed`, `sessions.list`, `sessions.listed`, `session.retire`). The host protocol: MAN-688 and `session-host/MANUAL.md`. Rules an edit keeps: INV-7095.

## One implementation
The warden runs the files the API runs. `sessions.mjs` imports `createHostRegistry` from `../../server/modules/providers/list/claude/session-host/host-registry.js` — the same relative path in the checkout and in the release, because `build.mjs` stages `host.js`, `host-conn.js`, `host-journal.js`, `host-live-tasks.js` and `host-registry.js` at their repo paths (MAN-692: why they are plain JavaScript) — and `spawnHostSession` execs that directory's `host.js` under tmux. Nothing of either is copied or rewritten in `warden/`.
- The instance: `createHostRegistry({ tmuxSocketName: 'cerberus-warden', keepaliveSession: '_keepalive', sessionsDir: <home>/sessions })`. The directory is made 0700 at start (mode forced with `chmod`: `mkdir`'s is masked and ignored for one that exists). A directory that cannot be made is one log line, and an open that needs it fails with a sentence.
- The tmux server is `cerberus-warden-sessions.service`'s (`systemd/cerberus-warden-sessions.service`, rendered and enabled by `enroll.sh`): its own cgroup, so `systemctl restart cerberus-warden` never reaches a session. `tmux -L cerberus-warden ls` lists `_keepalive` and one session per host.
- The release root carries a `package.json` (`type: module`) that `build.mjs` writes: the five `.js` files take their module type from the nearest package.json above them, and a release has none of the app's.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-sessions-link.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-sessions.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-sessions.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/sessions.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/systemd/cerberus-warden-sessions.service

## MAN-7921 — Warden session host — `createSessions`: `session.open` spawn and attach over the — The unit — `cerberus-warden-sessions.service`
section: Warden session host — `createSessions`: `session.open` spawn and attach over the host registry the API runs, one channel per host, a lost link is a DETACH, `cerberus-warden-sessions`/001 The unit — `cerberus-warden-sessions.service`

Template `warden/systemd/cerberus-warden-sessions.service`; installed copy `/etc/systemd/system/cerberus-warden-sessions.service`, rendered by `enroll.sh` (the template holds one marker, `__USER__`) and never edited by hand. It is a do-nothing keepalive that holds the node's own tmux server (`-L cerberus-warden`, beside the API's `cloudcli-sessions`) in a cgroup apart from `cerberus-warden.service`'s (MAN-7837).

| line | value | why |
|---|---|---|
| `Type=forking`, `RemainAfterExit=yes` | `tmux new-session -d` forks the server and its client exits 0 | the unit stays `active` for the server's whole life |
| `User=__USER__` | the warden's account | the socket and `~/.cerberus-warden/sessions` are that account's |
| `ExecStart=/usr/bin/tmux -L cerberus-warden -f /dev/null new-session -d -s _keepalive sleep infinity` | holds the server with one no-op session; `-f /dev/null` skips `~/.tmux.conf` | the session holds no host, so no listing names it |
| `ExecStop=-/usr/bin/tmux -L cerberus-warden kill-server` | stop kills every session pane: `sudo systemctl stop cerberus-warden-sessions` is the deliberate "end every live session on this node" switch | the `-`: a stop with the server already dead lands `inactive`, never `failed` |
| `Restart=always`, `RestartSec=2` | | |
| `OOMPolicy=continue` | one OOM kill in the cgroup keeps the unit and its sibling sessions | the default stops the whole cgroup |
| `After=network.target`, `WantedBy=multi-user.target` | | |

- No `RuntimeDirectory`: journals, sockets and metas live on disk (D-1), never on `/run`'s tmpfs.
- `systemctl restart cerberus-warden` never reaches a session; `enroll.sh --refresh` never restarts this unit (INV-7095).
- A dead tmux server still reads `active`: `RemainAfterExit=yes` defeats `Restart=always` (the trap of MAN-5704, same three directives). `systemctl is-active cerberus-warden-sessions` answers `active` and `start` is a no-op, while a new session is refused with "The warden's session server is not running (cerberus-warden-sessions)". The probe is `tmux -L cerberus-warden ls` (`no server running`); the cure is `sudo systemctl restart cerberus-warden-sessions`, which ends every pane. Nothing watches it: `cloudcli-dev-watchdog` does not know the unit. Measured 2026-10-07 on a twin unit with the same directives: after `kill-server` and 4 s, `is-active` → `active`, `tmux ls` → `no server running`.
- An apt upgrade's `needrestart` restarts an unpinned unit and kills every pane in its cgroup. `enroll.sh` pins the unit on every install and every `--refresh` (`pin_needrestart`, after the units are rendered, MAN-7947): when `/etc/needrestart/conf.d` exists it writes `99-cerberus-warden-sessions.conf` there, mode 0644, holding `$nrconf{override_rc}{qr(^cerberus-warden-sessions\.service$)} = 0;` under a header that says why (a restart runs `kill-server` and ends every node chat: the failure class of `99-cloudcli-sessions.conf`, which pins the API's keepalive the same way). Where needrestart is absent nothing is written and the script says so; a write that fails is a warning. A release does not write it, so a node gets the pin at its next `--refresh` (MAN-7949). Whether this machine has it is `python3 ~/.claude/hooks/gotchas_check.py`'s `needrestart_keepalive_override`: `[FAIL]` names the unit, `[PASS]` means every keepalive unit is pinned.
- Measured 2026-10-07 on eis1: `systemctl show cerberus-warden-sessions` → `User=lyphe`, `Type=forking`, `Restart=always`, `RestartUSec=2s`, `RemainAfterExit=yes`, `OOMPolicy=continue`, `ExecStart` and `ExecStop` as above; `systemctl is-active` → `active`; `tmux -L cerberus-warden ls` → `_keepalive`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-sessions-link.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-sessions.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-sessions.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/sessions.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/systemd/cerberus-warden-sessions.service

## MAN-7922 — Warden session host — `createSessions`: `session.open` spawn and attach over the — Frames
section: Warden session host — `createSessions`: `session.open` spawn and attach over the host registry the API runs, one channel per host, a lost link is a DETACH, `cerberus-warden-sessions`/002 Frames

| frame | what the warden does |
|---|---|
| in `session.open { chan, op: 'spawn', hostId, cwd, frame }` | `spawnHostSession(hostId, cwd)`, which refuses with `HOST_SERVER_DOWN` when the keepalive session is not there, and that is `session.closed` "The warden's session server is not running (cerberus-warden-sessions)"; `connectToHost(hostId, 5000)`; writes `frame` (the host's `spawn`) as its first line |
| in `session.open { op: 'attach', hostId, cwd: null, frame }` | `isTmuxSessionAlive(hostId)`, else `session.closed` "host <id> is no longer running"; `connectToHost(hostId, 2000)`; writes `frame` (`hello`) |
| out `session.frame { chan, frame }` | one per line the host writes, verbatim; a line that is not a JSON object with a `t` is logged and dropped |
| in `session.frame { chan, frame }` | written to the host's socket; one that arrives while the open is still connecting is kept and written after the first frame; one for a channel that is gone is dropped |
| in `session.detach { chan }` | `socket.end()`; nothing is answered |
| out `session.closed { chan, reason }` | the open failed (a bad body, no server, tmux refused, the socket would not connect), the host's socket closed with no `exit`, or a host line was too big for one frame |
| in `sessions.list` → out `sessions.listed { re, hosts }` | `re` is the request envelope's `id`; `hosts` are `listLiveHosts()`, each with `lastTurnFinishedAt(hostId)` |
| in `session.retire { hostId }` | `retireHost(hostId, onEnded)`: the host's own socket, `end_input`, SIGTERM after 5 s |
| out `sessions.changed { hostId }` | once per retire, from `onEnded` (the retire socket's `close`): the host said `exit` and its files are gone, it was already gone (at once), or the registry gave up after 120 s. Center lists the node again. No timer here: the registry's socket event is the trigger |
- None is an outbox frame: the host's journal and its cursor (`hello { fromSeq }`) are the replay, so a lost frame is replayed by the next attach and a second queue here would only disagree with it.
- A host line over the link's frame ceiling (the gateway's 8 MiB, less 16 KiB for the envelope) is not sent: the channel ends with `session.closed` "A line from host <id> is <n> MiB or more, past the 8 MiB one frame of this link carries — the session cannot go on here", the host is detached (never ended) and the link stands. A line still unfinished past the ceiling is refused without waiting for its end. Without this the gateway closes the whole link on the frame and the host replays the line at every attach.
- On an `exit` frame the warden relays it, then `removeHostJournal(hostId)` (it was the attached client, so the journal and meta are its), ends the socket and drops the channel; no `session.closed` follows.
- A `session.open` is refused with a sentence, never silence, for an unknown `op`, a `hostId` outside `[A-Za-z0-9_-]{1,200}` (it is a file name and a tmux session name), a spawn without an absolute `cwd`, or no first frame. A second open on a live `chan` is logged and ignored: answering it would close the live channel at center.

## The lost link — a DETACH, never end-of-file (MAN-688)
`link.mjs` announces `link.down` to `link.on('link.down', fn)` handlers when a LINKED socket is lost (not for a stop, not for an attempt that never reached `welcome`). `sessions.mjs` then ends every channel's socket — and nothing more: no `end_input`, no `kill`. The host reads a client socket closing as a detach, so the CLI keeps working, and center attaches again when the link is back (`hello { fromSeq }` — the exact last seq it received after a blink, `acked` after a center restart). A channel is removed from the map BEFORE its socket ends, so a late `close` event cannot say `session.closed` on a link that has since come back. `daemon.mjs`'s stop does the same: the hosts are in another cgroup and outlive the warden.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-sessions-link.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-sessions.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-sessions.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/sessions.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/systemd/cerberus-warden-sessions.service

## MAN-7923 — Warden session host — `createSessions`: `session.open` spawn and attach over the — Housekeeping — `sweepDeadHosts()`
section: Warden session host — `createSessions`: `session.open` spawn and attach over the host registry the API runs, one channel per host, a lost link is a DETACH, `cerberus-warden-sessions`/003 Housekeeping — `sweepDeadHosts()`

Removes the files of hosts whose tmux session is gone. It runs on events that say a host may be gone, never on a timer: at start, on every `welcome`, when an attach finds its host dead, and when a channel's socket closes with no `exit`. A host that dies while no channel is open and the link stays up leaves its journal and meta until the next such event (the next link-up, at the latest); `listLiveHosts` ignores them meanwhile, because liveness is the tmux session and never the files.

## What it does not do
- It never checks a command: a `spawn` frame is run as sent, by design — center, signed, decides to start a session, and the CLI's whole environment travels in that frame. No log line names a frame, a command or an environment.
- It never writes a frame center did not send (`end_input` and `kill` included).
- No backpressure: a host replaying a long journal is relayed as fast as the socket reads it.

## Verification
`bash .verify/warden-sessions.sh` (about 45 s): starts the unit's own command by hand on `-L cerberus-warden` (refusing when a server is already there), runs `createSessions` in process on a stand-in link and a scratch home — a spawn to `exit` with `tmux ls`, `sessions.listed` and the files after; an attach to a host that does not exist; a list with nothing running; a frame that beats the connect; a lost link with the CLI still running, a replay at `fromSeq: 'acked'` and a `session.retire`. Then `warden-sessions-link.mjs`: the same host over the REAL `createLink` against a stand-in center (a `ws` server that signs its frames) — a signed `session.open`, `sessions.listed` answering the envelope's own `id`, the socket dropped on purpose (`link lost; detaching 1 session channel(s)`, the tmux session still there, nothing sent), a redial, an attach at `fromSeq: 'acked'` and a retire. Last, `kill-server` (only for a server this run started) and the scratch home removed.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-sessions-link.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-sessions.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-sessions.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/sessions.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/systemd/cerberus-warden-sessions.service

## MAN-7928 — Warden diagnosis tools — `createDiagTools`: `diag.open`, `diag.call`, `diag.close`, a fixed menu of reads, the denylist and the mask

`warden/src/diag-tools.mjs` is the read-only half of a diagnosis: the hands center's diagnosis agent reaches this node with. `createDiagTools({ link, home? })` → `{ activeWork(), onWorkChange(listener), stop() }`, built by `daemon.mjs` beside the runner. `link` is anything with `on(type, handler)` and `send(type, body)` that also announces `link.down`; `home` is the warden's own home (default `homeDir()`), whose `keys/` no read may open. The wire shapes: `server/shared/cerberus-types.ts` (`diag.open`, `diag.opened`, `diag.call`, `diag.result`, `diag.close`). Design: `design/cerberus/Cerberus Spec.dc.html` §4 and Table 7 ("Logs and files stay node-local"). Center's half: `server/modules/cerberus/diagnosis/`. Rules an edit keeps: INV-7130.

## Files
| file | holds |
|---|---|
| `diag-tools.mjs` | the frames, the one open diagnosis, `activeWork`, `onWorkChange`, `stop` |
| `diag-reads.mjs` | the three tools (`READ_TOOLS`): `STATUS_MENU`, `journalctl`, the file reads |
| `diag-argv.mjs` | `startArgv(binary, args)`: the one spawn, 10 s kill, 64 KB cap; `capWholeLines(buffers, cap, more)`: a cut stream ends on a line the program finished |
| `diag-guard.mjs` | `resolveReadable` (realpath, denylist) and `maskSecrets` |
| `.verify/warden-diag-tools.mjs` | the scratch center probe (header says how to run it) |

## Frames
| frame | what happens |
|---|---|
| in `diag.open { diagId, check }` | the node's one open diagnosis, or — when another is open — remembered as refused; `diag.opened { diagId }` either way, and again for a repeat of the same id |
| in `diag.call { diagId, callId, tool, args }` | `diag.result { diagId, callId, ok, text, truncated }`; outside the open diagnosis it is `ok: false` — "No diagnosis is open on this node", "Another diagnosis is open on this node" (a refused open's calls), or "Diagnosis <id> is not open on this node" |
| in `diag.close { diagId }` | ends the open one and kills its reads in flight; the close of a refused id forgets it. Nothing is answered |
| `link.down` | ends the open diagnosis and kills its reads: center failed it with the link and will never send `diag.close` |
None is an outbox frame. A call without a `diagId` and a `callId` is logged and ignored; an unknown tool, or `args` that are not an object, is refused with a sentence. A read that ends after its diagnosis did is answered to no one.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-diag-tools.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-argv.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-guard.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-reads.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-tools.mjs

## MAN-7951 — Warden diagnosis tools — `createDiagTools`: `diag.open`, `diag.call` — The three tools — a fixed menu, never a shell
section: Warden diagnosis tools — `createDiagTools`: `diag.open`, `diag.call`, `diag.close`, a fixed menu of reads, the denylist and the mask/001 The three tools — a fixed menu, never a shell

| tool | args | does |
|---|---|---|
| `log.read` | `{ unit?, path?, sinceMin = 15 (1..1440), lines = 200 (1..500), contains? }`, one of `unit` and `path` | `journalctl -u <unit> --since "-<n> min" -n <lines> --no-pager -o short-iso`, or the last `lines` lines of the file (read from the end of its last 256 KB); `contains` keeps the lines holding it, any case, judged on the MASKED text, and a miss says how many lines it looked at and that the read covers only the latest ones ("no line contains … among the 200 read — this read covers only the last 200 lines of the file …") |
| `file.read` | `{ path, maxBytes = 65536 (1..65536) }` | a regular text file's head, or a directory's listing (names sorted, the first 200: name, type, size, mtime as local time with its offset, `2026-10-07 08:59:32 -07:00`; MAN-7950); a binary file (a NUL byte, or more than 2 % non-UTF-8) is refused; a device, socket or FIFO is neither and is refused; an empty file answers "(the file is empty)". The head is WHOLE LINES. The read is never sized by `stat().size` (`/proc` files stat as 0, `/sys` ones as a page): it takes `maxBytes` + 4 KiB (+ 1 probe byte), drops a last line the read cut, masks, then ends on the last whole line within `maxBytes` (a line break at index `maxBytes` ends a line of exactly `maxBytes`, so an answer is up to `maxBytes` and usually less). `truncated` is true whenever the file goes on past what is returned. A first line past `maxBytes` answers `(its first line runs past <maxBytes> bytes)`, `ok: true, truncated: true`. A binary file is judged on the head that can be returned, not on the 4 KiB beyond it. A JWT whose payload runs more than 4 KiB past `maxBytes` is not whole in the window and is not masked whole (its parts reach 8 KB) |
| `status.read` | `{ what, name? }` | `unit` → `systemctl status <name> --no-pager -n 0` (`name` required), `failed_units` → `systemctl list-units --type=service --state=failed --no-pager`, `containers` → `docker ps --format '{{.Names}}\t{{.Status}}'`, `disks` → `df -h`, `memory` → `free -m`, `uptime` → `uptime`, `listening` → `ss -ltn` |
- A unit is `^[A-Za-z0-9@._-]+$` and never starts with `-` (an option to `systemctl`, `-H` would reach another host). A number outside its range is refused with the range, never clamped. `~/` is the account's home; any other relative path is refused.
- Every spawn is `spawn(binary, argv)` with no shell, killed at 10 s (the whole lines it had printed, then "[killed after 10 s]", not ok, `truncated: true`), and its output is capped at 64 KB of whole lines (killed, `truncated: true`; the partial last line is dropped, because the reader stopped the stream, not the program; a first line past 64 KB answers `(its first line runs past 65536 bytes)`); the call is ANSWERED at the kill — at 10 s, at the cap, when the diagnosis ends — not when the child's pipes close, so a child the program forked, or one stuck in the kernel, cannot hold the answer back. The kill is `SIGKILL` of the child only: a grandchild it forked is not signalled and lives until it ends. The cap is judged again on the text SENT, after masking (`token=1` grows to `token=<masked>`). A program that exits non-zero is ok only if it printed something (`systemctl status` of an inactive unit exits 3 with its answer); its text is then the stdout, the stderr (4 KiB of whole lines; a first stderr line past that says `(its first stderr line runs past 4096 bytes)`) and `[exit N]`. A stream the program itself ended keeps its last line, newline or not. A binary that is not there is "<binary> is not available on this node (ENOENT)". A file read through `fs` opens the real path without blocking, so a FIFO cannot hold it.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-diag-tools.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-argv.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-guard.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-reads.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-tools.mjs

## MAN-7952 — Warden diagnosis tools — `createDiagTools`: `diag.open`, `diag.call` — A log file's whole 256 KB window is masked, then cut to its last `lines` lines, then from its start
section: Warden diagnosis tools — `createDiagTools`: `diag.open`, `diag.call`, `diag.close`, a fixed menu of reads, the denylist and the mask/002 A log file's whole 256 KB window is masked, then cut to its last `lines` lines, then from its start

- A log file's whole 256 KB window is masked, then cut to its last `lines` lines, then from its start when over 64 KB (the newest lines stay) and the line the cut went through is dropped, so a private-key block is masked before the line cut can leave its `BEGIN` line out, and so a secret the cut halves leaves nothing of its value; a masked block counts as one line, so `lines` can reach slightly further back; a block whose `BEGIN` lies before the window's first byte is masked from the window's start through the last `END … PRIVATE KEY-----` line in it (a tail window runs to the newest line, so it holds the `END` of any key whose body it shows); a newest line that alone passes 64 KB answers `(its last line runs past 65536 bytes)`, `truncated: true`; every other read is cut from its end.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-diag-tools.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-argv.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-guard.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-reads.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-tools.mjs

## MAN-7953 — Warden diagnosis tools — `createDiagTools`: `diag.open`, `diag.call` — The denylist and the mask
section: Warden diagnosis tools — `createDiagTools`: `diag.open`, `diag.call`, `diag.close`, a fixed menu of reads, the denylist and the mask/003 The denylist and the mask

- Refused with `ok: false`, "Refused: <path> may hold a secret", on the path as asked AND its `realpath`: a basename ending `.env` (`.env`, `.eis_backend.env`) or holding `.env.` (`.env.local`), `*.pem`, `*.key`, `*.p12`, `id_*`, `.pgpass`, `.netrc`, `credentials*` and `.credentials*`, `.git-credentials`, `auth.json` and `auth-profiles.json` (an agent's stored provider keys), `.claude.json*` (Claude's account state and every copy of it: `.claude.json.bak-*`, `backups/.claude.json.backup.*`), a history file (`.bash_history`, `.psql_history`, `.history` …) (any case); anything under `~/.ssh`, `~/.cerberus-warden/keys`, this warden's `<home>/keys`, `~/.claude/.credentials.json`, `~/.docker/config.json`, `~/.npmrc`, `/etc/shadow`, `/etc/ssh`, `/root`, and the transcripts of the operator's sessions: the session journals `~/.cerberus-warden/sessions` and `<home>/sessions`, `~/.claude/projects`, `~/.claude/history.jsonl`, `~/.codex/sessions`, `~/.openclaw/agents/<agent>/sessions` (one root per agent directory found) and `~/.cloudcli` (its accounts and its database); in `~/.claude/state`, the house's own session stores and briefs: `dispatch-souls` (a stream-json `child.log` per soul), `dispatch-chains`, `briefs`, `dispatcher`, `episodic.db` with `-wal` and `-shm`, each judged on its path and its realpath, the rest of `~/.claude/state` readable. A path that does not exist is "No such file or directory: <path>".
- Every returned text — refusals too — passes `maskSecrets`: a credential word (`password`, `passwd`, `passphrase`, `secret`, `token`, `api`/`access`/`private` key with `_`, `-` or nothing between, `pass` and `pwd` as whole words, and a quoted `"key"`), then up to 40 characters of the rest of its name (a separator first, or a camelCase `Key`, `Id`, `Value` or `Access`: `_KEY`, `_ACCESS_KEY`, `secretKey`), then `=` or `:`, then the value → the word, the tail and the separator kept, the value `<masked>`; any case. The credential words take a plural (`API_KEYS`, `secrets`), `token` does not. `DB_PASS=x`, `AWS_SECRET_ACCESS_KEY=x`, `{"secretKey":"x"}` and `"key": "sk-…"` are masked; `passed: 3`, `bypass` and `max_tokens=1024` are words, not names, and stay. `"api_key": "k-999"` becomes `"api_key": <masked>`; the value may be a quoted text with spaces. Five shapes with no key word beside them go too: a URL's password (`https://alice:<masked>@host`; a lone userinfo of 20 or more characters whole), a `Bearer` or `Basic` value of 16 or more characters, a JWT (`eyJ…`), a `-----BEGIN … PRIVATE KEY-----` block to its END line (or to the end of the text; an armored PGP block, `PRIVATE KEY BLOCK-----`, is the same), and a `-----END … PRIVATE KEY-----` line with no BEGIN before it: from the START of the text through the LAST such line (anchored, one scan; greedy, so one pass leaves nothing for a second). The quantifiers that can start at many places are bounded, so a hostile log line cannot stall the daemon's event loop. Masking twice changes nothing more: a value that is already `<masked>` is taken as it stands, so `"token":<masked>,"err":1}` keeps its `,"err":1}` on the second pass (a text is masked at its source and again as it leaves).

## Work
`activeWork()` → `{ diags: [<the open diagnosis's id>] }` (empty when none): the daemon spreads it with the runner's `{ runs }` into `hello.active` and into the updater's wait. `onWorkChange(listener)` runs the listener when the open diagnosis begins or ends (an event, no timer) and answers its remover. `stop()` kills the reads and says nothing more.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-diag-tools.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-argv.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-guard.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-reads.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-tools.mjs

## MAN-7954 — Warden diagnosis tools — `createDiagTools`: `diag.open`, `diag.call` — Measured
section: Warden diagnosis tools — `createDiagTools`: `diag.open`, `diag.call`, `diag.close`, a fixed menu of reads, the denylist and the mask/004 Measured

- 2026-10-07, `.verify/warden-diag-tools.mjs` on a scratch center (gateway 127.0.0.1:7921) and a scratch warden: a call before any open refused; `d-1` opened and `d-2` too (both `diag.opened`), `d-2`'s call "Another diagnosis is open on this node"; `log.read` of `cerberus-warden` 15 min answered from the real journal; `failed_units` and `disks` answered; `keys/node.key` and a scratch `.env` refused, a symlink to `.env` refused; `password=hunter2` answered `password=<masked>`; the unit `x; rm -rf /` refused; `diag.close` then a call refused; every line PASS, and a dropped link ended the open diagnosis (the next call "No diagnosis is open", a new one opened).
- 2026-10-07, whole lines: `file.read` `maxBytes` 85 with the `@` of `postgres://app:S3cret@host` at byte 85 answered five filler lines with no `S3cret` (the old head answered `…url=postgres://app:S3cret`); `log.read { lines: 3 }` of a 325 KB file whose `BEGIN` lay 62 KB before the 256 KiB window answered `<masked>`; `file.read` of `~/.claude/state/dispatch-souls/<id>/child.log` answered "Refused: … may hold a secret"; `startArgv`: a child killed at 10 s mid-`postgres://app:S3cret` answered `first\n[killed after 10 s]`, a 70 000-byte single line answered the first-line sentence.
- 2026-10-07, `maskSecrets` on 5.2 MB with no END 68 ms, 100 000 `-----END CERTIFICATE-----` lines 30 ms, 200 `-----END A A A …` lines 10 ms, 40 000 long `-----END AAA…` lines 57 ms; masking the result again changed nothing in all four.
- `startArgv('yes')` stopped at 65 535 bytes of whole lines, `truncated: true`, in 7 ms; `sleep 30` was killed at 10.0 s; `echo 'a; rm -rf /' '$(id)'` printed its arguments literally.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-diag-tools.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-argv.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-guard.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-reads.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-tools.mjs

## MAN-7929 — Warden updater and launcher — `createUpdater`, `launcher.mjs`: update.offer verified and swapped in, exit 75, a 60-second probation and the rollback, hello.update

How a warden replaces itself, and how a release that cannot start is taken back. Center's half (the offer, the silence rule, the read model) is the updates plan's; this row is the node. Install and the `launcher.mjs` copy: MAN-7826. The unit: MAN-7837. The home's files: MAN-7836. Rules an edit keeps: INV-7131.

## Files
| file | owns |
|---|---|
| `warden/src/update.mjs` | `createUpdater({ link, home, activeWork, onWorkChange?, exit? })` → `{ helloUpdate() }`: the `update.offer` steps, `hello.update`, `hello-ok.json` |
| `warden/src/release-files.mjs` | the fetch, the `tar -xzf`, the `current` swap, `isOlderVersion`, `pending-update.json`, `hello-ok.json` — one function each |
| `warden/src/launcher.mjs` | what the unit runs, from `~/.cerberus-warden/launcher.mjs` — outside every release, importing nothing from one (it repeats the durable write and the swap); why: a release that cannot start cannot take its rescue down with it |

`daemon.mjs` composes it: `activeWork` is the runner's `{ runs }` spread with the diagnosis tools' `{ diags }`; `onWorkChange` registers one listener on both (`runner.onWorkChange`, `diagTools.onWorkChange`: events, never a timer); `exit` is the daemon's own clean stop with code 75. The link's `state()` adds `update: updater.helloUpdate()` and `buildHello` puts it in `hello` when there is one.

## `update.offer` → `update.progress` (reliable, every step)
`update.offer { updateId, version, url, sha256, size, note }` arrives signed, so the `sha256` in it is center's word. A malformed offer (no `updateId`: logged and ignored; a `version` not `major.minor.patch` or a `sha256` not 64 hex: `failed` "The offer carries no usable version and hash"). A second offer while one runs: `failed` "Another update is already running" (a repeat of the running `updateId` is ignored). In order:
| step | text | when |
|---|---|---|
| `verified` | "Already on <v>" | the offered version is the running one — nothing else happens |
| `failed` | "This warden is on <running> and does not go back to <v>" | the offered version is OLDER than the running one: an offer is signed but carries no freshness, so a replayed old one must not move the node backwards |
| `waiting` | "Waiting for 1 fix to finish" (`2 fixes`…) | `activeWork()` lists runs or diagnoses; re-sent when the count changes, woken by `onWorkChange`; after 10 min `failed` "Gave up waiting for 1 fix to finish" |
| `uploading` | "Uploading warden <v> · 2.1 MB" | then `fetch(url)` (a path is read against the enrolled center; 120 s limit; a body longer than the signed `size` is cut off) |
| `failed` | "The download does not match its signed hash" | SHA-256 of the bytes ≠ `sha256`: nothing is written |
| `verified` | "Signature checks out" | |
| `swapping` | "Swapping the binary · <from> kept for rollback" | after `tar -xzf` into `releases/<v>/` (as the account; `warden/src/main.mjs` must be there and `warden/package.json` must name <v>), a second wait for no fix (the upload took seconds), and a check that `releases/<from>` still exists (else `failed` "No kept copy of <from> to roll back to"); then `pending-update.json { updateId, from, to, swappedAt }` is written and `current` swapped (`current.next`, then a rename); a swap that throws removes the record |
| `restarting` | "Restarting the warden" | up to 2 s for center's ack of that frame, then the daemon stops cleanly and exits 75 |
Other `failed` sentences: "The offer carries no address to fetch"; "Could not download the release (<cause>)" or "(HTTP <n>)"; "The release does not unpack (tar exited <n>)"; "The release carries no warden/src/main.mjs"; "The release is not warden <v>". Any error that is none of these is `failed` "The update stopped (<code>)". A release is never deleted: `releases/` only grows. An update writes `releases/<v>/`, `pending-update.json` and `current` and nothing else: the launcher copy and the unit files reach a node only by `enroll.sh --refresh` (MAN-7949).

## After the restart — `hello.update`
`pending-update.json` is read once, when the daemon is built. The running release is `to` → `hello.update = { updateId, from, to }`; the record says `failed` (the launcher took a bad release back) → `{ updateId, failed: <the version that failed>, reason }`; anything else (a swap that never happened, a newer release since) is logged and the file removed. After EVERY `welcome` the release writes `hello-ok.json { version, at }` (the launcher's proof), and the first welcome removes `pending-update.json`: a welcome only answers a hello, and every hello of the process carried the record until then.

## The launcher
- Spawns `node <home>/current/warden/src/main.mjs run` with inherited stdio (the journal; its own lines are `[launcher] …`), forwards SIGTERM and SIGINT, and on a normal exit exits with the child's code — the unit's `Restart=always` starts the next launcher.
- Exit 75: it reads `pending-update.json` and starts the new `current` at once UNDER PROBATION. With no record on trial (none, one that says `failed`, one that is not whole, or one `current` does not name as its `to`) an exit 75 is an ordinary exit: the launcher exits 75 and the unit's `RestartSec=5` paces the next start. Until `hello-ok.json` names `pending.to` with an `at` no earlier than `swappedAt`, a child exit — or 60 s since `swappedAt` — is a failed release: the child is stopped (SIGTERM, SIGKILL after 5 s), `current` goes back to `releases/<from>`, `pending-update.json` is rewritten with `failed: <to>` and `reason` ("no hello within 60 s", "<to> exited with code 1 on start", "<to> was killed by <signal> on start"), and the old release starts. The swap comes first and the rewrite second: a crash between them leaves `current` on the old release and a record not yet marked, which the next launcher finishes as `failed` ("<to> was never started"). With `releases/<from>` gone from disk the launcher swaps nothing — `current` stays on the release that exists — and the record says so ("…; <from> is not on disk to go back to").
- The probation ends the moment the release writes `hello-ok.json` (an `fs.watch` of the home: an event), and at its deadline otherwise (one timer, a final read).
- A launcher started with a pending file continues the probation inside its 60 s (clock capped at 60 s from now) and rolls back past it; a record that already says `failed` is not tried again, and a record is a trial only while `current` names its `to` (one about another release, after an `enroll.sh --refresh` inside the minute, is logged and ignored); a SIGTERM mid-probation leaves the file for the next launcher.
- Release names in `pending-update.json` are checked as one path segment before a path is built from them.

## Measured
- 2026-10-07, scratch homes: three hand-made releases `a`, `b` (exit 1 at once), `c` (hello, idle) under the copied launcher — `a` exiting 75 toward `b` → "rolled back to a: b exited with code 1 on start", `current` → `releases/a`, the record `failed: "b"`; toward `c` → "c said hello; probation over", `current` → `releases/c`. Edges: started 90 s after the swap → rolled back at once; a record already `failed` → just started; a `hello-ok.json` older than the swap → not accepted; resumed 20 s in with a release that never speaks → rolled back at the 60 s mark.
- Same day, the real daemon under the real launcher against a stub center: 0.7.0 offered 0.7.1 (uploading, verified, swapping, restarting, exit 75, the next `hello` carried `update { from: 0.7.0, to: 0.7.1 }`); 0.7.1 offered a 0.7.2 whose `main.mjs` exits 1 (rolled back, the next `hello` carried `update { failed: 0.7.2, reason: "0.7.2 exited with code 1 on start" }`); an offer whose `sha256` differs from the download ended `failed` "The download does not match its signed hash" with nothing written.

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/src/launcher.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/release-files.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/update.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/systemd/cerberus-warden.service

## MAN-7949 — Warden delivery — which door a change takes: the Update wardens dialog, `enroll.sh --refresh`, enroll; releases on disk and the build note

Which door puts a change on a node, and what each door writes. The update's steps and the launcher: MAN-7929. The script, the build and the artifact: MAN-7826. Rules an edit keeps: INV-7131.

## What each door writes
| door | writes | reaches |
|---|---|---|
| the Update wardens dialog (`update.offer`) | `releases/<version>/`, `pending-update.json`, `current` | what runs from `current`: `warden/src/**` and the five session-host files |
| `enroll.sh --refresh` | the same release when it is newer than `current`; then `~/.cerberus-warden/launcher.mjs`, every `warden/systemd/*.service` the release carries, `enable --now` of a unit not yet enabled, `restart cerberus-warden` | everything a release carries, a NEW unit included |
| `enroll.sh --name <node> --token <token>` | all of the above, plus `identity.json` and `keys/` | a machine with no warden |

## Which door
| the change | do |
|---|---|
| only `warden/src/**` | bump the minor in `warden/package.json`, `npm run build:warden`, then the dialog (or `--refresh`) |
| `warden/src/launcher.mjs`, or a changed or NEW `warden/systemd/*.service` | build, then `curl -fsSL http://<center>/cerberus/enroll.sh \| sudo sh -s -- --refresh` on each node; the dialog leaves the old launcher or unit in place |
| code that needs a NEW unit | `--refresh` first or with it: an update never installs a unit |
| the first warden on a machine | enroll |

## Releases on disk
- `~/.cerberus-warden/releases/<version>/`: one directory per version installed, by either door. `current` names one. Nothing deletes one: the previous release is the rollback target (INV-7131). Layout: MAN-7836.
- `build.mjs` refuses a release whose `warden/package.json` has no one-line `cerberus.note`. The note rides `latest.json` and `update.offer`, and is what the Update wardens dialog shows as its note (MAN-7934; build: MAN-7826).

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/build.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/enroll.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/package.json, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/launcher.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/update.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/systemd/cerberus-warden.service, /home/lyphe/.claude/claudecodeui_lyphe/warden/systemd/cerberus-warden-sessions.service

## MAN-7950 — Warden local time — `local-time.mjs`: `localStamp`, `localIso`, and every time the warden shows or writes

Every time the warden shows or writes for a reader is this machine's LOCAL time with its offset, never a `Z`. why: it then reads like the journal lines beside it (`journalctl -o short-iso`).

## `warden/src/local-time.mjs` — plain ESM, no dependency
| export | returns | for |
|---|---|---|
| `localStamp(epochMs)` | `2026-10-07 08:59:32 -07:00` | a person |
| `localIso(epochMs)` | `2026-10-07T08:59:32.469-07:00` | a file a machine reads; `Date.parse(localIso(t)) === t` |

- Invalid moment (anything but a number — `null`, `undefined`, a string, `true` — and a `NaN` or out-of-range number; `0` is the epoch and stands): both throw `RangeError('Invalid time value')`. why: a damaged `enrolledAt` or `run.at` stops `status` with its one-line `[warden] status failed: …` and exit 1, not a `NaN` time and exit 0.
- The offset is the MOMENT's own (`getTimezoneOffset` of that date, not of now): a stamp from before a daylight-saving change carries the offset it had then. Whole minutes, rounded.

## Consumers
| where | prints |
|---|---|
| `warden/src/status.mjs` | `enrolled`, and `run`'s `written …` (MAN-7825) |
| `warden/src/diag-reads.mjs` | a `file.read` directory listing's mtime, `localStamp(entry.mtimeMs)` (MAN-7928) |
| `warden/build.mjs` | `latest.json` `builtAt`, `localIso(Date.now())` (MAN-7826) |

- `build.mjs` loads it with `await import('./src/local-time.mjs')` just before `builtAt` is written, not at the top. why: INV-7184's probe copies `build.mjs` alone into a bare directory and expects the one-line-note refusal; a static import would crash that copy first.
- Center's `diagnosis-moments.ts` `localStamp` omits the offset and gives it apart through `localOffset`; the tab's `cerberusTime.ts` `localIso(ms)` has the warden's `localIso` shape (MAN-7919).

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/src/local-time.mjs
