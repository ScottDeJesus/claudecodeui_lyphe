<!-- docstore export; edit rows with docstore write, never this file -->

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
| `spec.url` `spec.timeout` | the GET; `AbortSignal.timeout(timeout × 1000)` covers headers AND body |
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

`warden/src/probes.mjs` turns the probes center pushes into the results it stores. `createProbes({ link })` → `{ checksVersion, probesRunning, scheduled, stop() }`. `link` is anything with `on(type, handler)` and `send(type, body, { reliable })` — the warden's link, or a stand-in — and may carry `outbox`, which is read through it. The kinds it calls: MAN-7818 (`http`, `tcp`, `exec`, `file_age`, `sql`) and MAN-7820 (`health_doc`). The wire shapes: `server/shared/cerberus-types.ts` (`CerberusChecksSet`, `CerberusProbeSpec`, `CerberusResultWire`). Rules an edit keeps: INV-7028.

## Frames
| frame | what happens |
|---|---|
| in `checks.set { version, probes }` | `apply` |
| in `welcome { checks }` | `apply(checks)` when the welcome carries one (center sends it when the warden's `hello.checksVersion` differs) |
| out `checks.ack { version }` | after every `apply`, not reliable (center sends `checks.set` only while linked) |
| out `result { results }` | reliable, at most 500 results and 4 MiB a frame |

## `apply({ version, probes })`
- A set without an integer `version` and a `probes` array is logged and ignored, with no ack. A probe without a `key`, or whose `every` or `timeout` is not a whole number ≥ 1, is logged and left out; the rest run, and the ack is still sent.
- One timer per probe: the first run after a random 0–`every` seconds, then every `every` seconds. Each turn re-arms the next one before it runs; a wait past `MAX_TIMER_MS` (`probe-support.mjs`; `setTimeout` stops at 24.8 days, center allows 30) is a chain of timeouts (`waitFor`), so it ends on the exact moment.
- A probe whose spec is byte-for-byte unchanged (compared as sorted entries, so field order does not matter) keeps its timer, its `memory` and a run in flight. A changed spec gets a new timer and a new first delay. A probe that left stops, and its `memory` is dropped.
- `memory` is one object per probe key, passed to the kind as its second argument; `health_doc` keeps `lastCheckedAt` and `stillSince` in it.
- A probe never overlaps itself: a run in flight (tracked by key, so a redefined probe's old run counts) makes the next turn skip. A run that ends after its probe left or was redefined is dropped, not sent.
- `kind` is looked up in a `Map`; a kind this warden does not run is a `failing` result, "This warden does not know that kind of probe". A kind that throws is a `failing` result, "The warden could not run this probe", and the log line carries only the error's code or name.

## Results
| source | results |
|---|---|
| a simple kind | one: `check` = `source` = the probe key, `at` = `fetchedAt` = the time the run ended, `docStatus` null, the kind's `status`, `value`, `data`, `tookMs` |
| `health_doc` | its `own` result (same shape, `check` = the probe key) and then each `components` entry as the kind built it, `source` = the probe key, `tookMs` null |

## The batch and `prevAt`
- Results wait in a batch. The first result into an empty batch arms a 1 s timer (no timer ticks while nothing waits); a batch that reaches 500 flushes at once. A flush cuts the batch into frames of at most 500 results and 4 MiB (`FRAME_BYTES_LIMIT`; center closes a socket on a frame past 8 MiB). A result alone over 1 MiB (`RESULT_BYTES_LIMIT`) is sent as `failing`, "The result was too large to send (<n> MB)", `data` `{ error: 'oversize', bytes }`.
- `prevAt` is stamped at flush: the `at` of the last result flushed for that check, in memory. Null at start.
- When `link.outbox.overflowing` is true at a flush, every result goes to `outbox.keepLatest` instead of a frame and the `prevAt` memory is cleared; the first result per check after the drain therefore carries `prevAt` null. A link with no `outbox` never overflows.
- `link.send` throwing (the outbox could not reserve a seq on a full disk) drops that frame's results with one log line and forgets those checks' `prevAt` memory, so each one's next result carries `prevAt` null and center records a lapse. (Center never compares a `prevAt` with what it stored: a chain left naming the lost result would read as an unbroken stretch and vouch for the old status across the gap.)
- `stop()` clears every timer, kills the process group of every probe command still going (`killLiveProcesses`, MAN-7818), and flushes what waits; runs still going are dropped.
- `probesRunning` = the number of runs in flight, a measurement the verify probes read. `scheduled` = the probes on the schedule (0 after `stop()`): what the daemon sends as the heartbeat's `probesRunning` (the wire's "how many probes it has scheduled", `cerberus-types.ts`) and writes to `run.json`.

## Measured
- 2026-10-06, interfaces E's seven eis1 probes on a stand-in link for 70 s, then a set without `system/disk.used` for 40 s (`.verify/probe-warden-probes.mjs`): ack 1, 74 component results beside `shadow-connector/health`, the second 30 s result's `prevAt` = the first's `at`; ack 2 and no `system/disk.used` after it. `--pin` pins the first delays so the 60 s and 300 s probes land in the window too.
- 2026-10-06, `.verify/probe-warden-probes-edges.mjs`: a 1 s probe that runs 2.5 s started every 3.00 s; three repeats of an unchanged set left a 2 s probe at 2.00 s gaps; a removed probe sent nothing after; an overflowing outbox got `keepLatest` and no frames; a 601-result read left as frames of 500 and 102 (the extra one a straggler from another probe in the flush).

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/src/probes.mjs

## MAN-7824 — Warden link — `createLink`: connect, welcome and resend, heartbeat, backoff and deadlines, the outbox and its seq floor, `wire.mjs`

`warden/src/link.mjs` is the warden's one socket to center; `warden/src/wire.mjs` is the envelope, the headers and the frame check it shares with `enroll`; `warden/src/outbox.mjs` holds what center has not acked. Wire shapes: `server/shared/cerberus-types.ts`. Center's half: MAN-7800 (signing), MAN-7803 (gateway), MAN-7814 (registry). Rules an edit keeps: INV-7039. The scheduler on top: MAN-7821. Enrollment and the home: MAN-7825.

## `createLink({ identity, state?, outbox?, home?, onReport? })` → `{ outbox, linked, start(), stop(), on(type, handler), send(type, body, { reliable }) }`
| field | meaning |
|---|---|
| `identity` | `{ node, center, centerKey }` from `identity.json` |
| `state()` | read afresh for every `hello` and heartbeat → `{ checksVersion, catalogVersion, active, probesRunning }` |
| `outbox` | default `createOutbox()`; exposed as `link.outbox` so a caller reads `overflowing` and calls `keepLatest` |
| `home` | where the node key lives |
| `onReport()` | called after every heartbeat (the one sent at `welcome` included) and each time a retry is scheduled — a link that was up going down, a connect that failed, an attempt that missed its deadline; never on `stop()`. A throw is logged, `the status report failed: <message>`, and goes no further. The daemon rewrites `run.json` from it (MAN-7825) |
| `on(type, fn)` | `fn(body, envelope)` runs after the link's own handling of that type; returns a remover. A throw or rejected promise is logged, "the handler of a "<type>" frame failed", and never ends the process |
| `send(type, body, { reliable: true })` | numbered by the outbox, kept until acked, resent after a reconnect; queued even while down → `{ seq, sent }`, `sent` = it left on this socket now. Throws what `outbox.push` throws |
| `send(type, body)` | only while linked, `seq: null`, gone otherwise → `{ seq: null, sent }` |

`warden/src/link.mjs` re-exports `verifyFrame` and `readRefusal` from `wire.mjs`.

## Connect and trust
1. `WebSocket(<center as ws>/cerberus/ws)` with `X-Cerberus-Node`, `X-Cerberus-At`, `X-Cerberus-Sig`, built fresh for EVERY attempt (`connectHeaders`). `at` rises within the process even when two attempts share a millisecond, and runs at most 1 s (`MAX_AT_BUMP_MS`) ahead of the clock.
2. On open, `hello` is the first frame (`buildHello`: `version`, `startedAt`, `facts`, `checksVersion`, `catalogVersion`, `active`).
3. Every frame from center is `{ env, sig }`. `verifyFrame` checks `sig` over the exact bytes of `env` against the pinned `centerKey` BEFORE `env` is parsed. A frame whose `env.node` is another node is dropped.
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
Resolves, never rejects. Repeats the upgrade by hand and reads the 401 body (a websocket client cannot see it). `status` is null when nothing answered. `reason` is `oneLine(body)`: first line, control characters removed, at most 200 characters; else `HTTP <n>`. A 101 destroys the socket at once. Waits at most 5 s (`REFUSAL_TIMEOUT_MS`).

## `createOutbox({ home?, maxResults = 20000 })`
| call | does |
|---|---|
| `push(type, body)` → seq | numbers and queues; a `result` body without a `results` array throws `TypeError` before anything is numbered |
| `pending(afterSeq)` | queued frames above `afterSeq`, seq order |
| `ack(upto)` | trims frames at or below `upto`; ignores a non-integer or negative `upto`; raises the counter above `upto`; renumbers frames queued under numbers center already holds (`renumberAbove`); releases an overflow below the cap |
| `keepLatest(result)` | while overflowing: holds the newest result per `check`, `prevAt` forced to null |
| `overflowing`, `size`, `queuedResults` | read-only |
| `ackedUpto` | read-only: the highest `upto` center has sent (an `ack`, or `welcome.ackedUpto`); 0 until one arrives. The daemon writes it to `run.json` |

- `seqFloor` in `<home>/state.json` is a ceiling every handed-out number stays below. To hand out a number at or past it, `seqFloor + 1000` (`FLOOR_STEP`) is written and fsynced first. After a restart the counter starts at the persisted floor (at least 1: center refuses `seq` < 1).
- Overflow: once the results inside queued frames pass `maxResults`, the caller reads `overflowing` and sends `keepLatest` instead of `push`; one log line. When acks bring the queue under the cap, what was kept goes out as ONE frame (`outbox drained; <n> kept results queued as one frame`) and `push` resumes. A failed push at release keeps `overflowing` true and the next ack retries.
- The queue is in memory: a restart forgets unacked frames; the probes that made them run again.

## Open
- A center that keeps the socket open and answers no reliable frame is not recycled: no deadline runs from a reliable send to its ack. It needs a constant and carries a false-trip risk against a slow ingest; `link.mjs` is at the 300-line ceiling, so it follows the receive-path extraction.

## Measured
- 2026-10-06, slot-1 probe server (`scripts/sunset-probe.sh`): results 1–3 acked; server killed, results 4–5 queued `sent=false`; on reconnect `welcome ackedUpto=3`, `resending 2 unacked frame(s)`, `ack upto=4`, `ack upto=5`; `state.json` `{"seqFloor":1001}`.
- Same day: `verifyFrame` true on a real center-signed frame; false after `"ackedUpto":5` became `95`, and false after the same JSON was re-spaced.
- Same day, scripted fake center: backoff gaps 1.09, 2.08, 4.53, 9.04, 15.2 s and 1.07 s after a `welcome`; heartbeats every 15 s; an unsigned frame, a frame for another node and an unknown type each logged once.
- Same day: `readRefusal` against the real center answered `101`, `clock skew 75 s`, `unknown node`, `bad signature`, `unknown token`, `ECONNREFUSED`. Node 22.23.3: enroll and connect both work.

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/src/link.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/outbox.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/wire.mjs

## MAN-7825 — Warden verbs and home — `enroll`, `run`, `status`, exit codes, `run.json`, the files under `CERBERUS_WARDEN_HOME`, lost-welcome recovery

`node warden/src/main.mjs <verb> [--flag value …]` — bare `node` ≥ 22, no loader, no dependency. Verb output goes to stdout with no `[warden]` prefix; only link and daemon lines carry it. The link: MAN-7824. Center's half of enrollment: MAN-7800 (certificate), MAN-7803 (gateway).

## Verbs
| verb | run | does |
|---|---|---|
| `enroll` | `node warden/src/main.mjs enroll --center <url> --name <name> --token <token>` | becomes a node; `--center` must be `http(s)://host…`, a trailing `/` is dropped |
| `run` | `node warden/src/main.mjs run` | the daemon `cerberus-warden.service` runs (`daemon.mjs`): link, outbox and probes plugged together, until SIGTERM or SIGINT |
| `status` | `node warden/src/main.mjs status` | prints `version`, `home`, `node`, `center`, `enrolled`, `fingerprint` and the newest `run.json` — its age, `linked`, `ackedUpto`, `outbox` (frames queued, and that it is overflowing), `probes` (scheduled, with the checks version) and `daemon` when that build differs from this one; `no heartbeat since — the daemon is not running` when a `linked: true` record is over 45 s old; a field the record lacks reads `not recorded`; reads files, speaks to no one |

Exit codes: 0 done · 1 refused or failed (the reason printed; `status` on a home that is not enrolled) · 2 misused (unknown verb or flag, missing flag or value, bad `--center`).

## `run` — `runDaemon()` → exit code
1. No `identity.json` prints `This node is not enrolled — run enroll.sh with a token from Cerberus` and exits 1 before anything is created. An identity without `node`, `center` or `centerKey` prints `The identity in <file> is incomplete`; a home without `keys/node.key` prints `The node key <file> is missing`; both exit 1. A home another daemon already runs on prints ``A warden is already running on <home> — `node warden/src/main.mjs status` shows what it reports`` and exits 1 (`home-lock.mjs`, below).
2. It builds the outbox, the link and the scheduler. The link's `state()` is read from the scheduler: `{ checksVersion, catalogVersion: null, active: { runs: [], diags: [] }, probesRunning }`, where `probesRunning` is `probes.scheduled` — the wire's "how many probes it has scheduled", so a heartbeat between two turns reads the same as `run.json`'s `probes`. A later plan adds its field there and its `link.on(type, fn)` beside `createProbes`, before `link.start()`.
3. `run.json` is `{ at, linked, ackedUpto, outbox, overflowing, probes, checksVersion, version }`: `at` the daemon's clock in ms, `outbox` the frames queued (`outbox.size`), `ackedUpto` `outbox.ackedUpto`, `probes` `probes.scheduled`. It is written (0600, durably) once at start, after every heartbeat and each time the link schedules a retry (the link's `onReport`, MAN-7824), after a `welcome` or a `checks.set` has been applied (`link.on` handlers registered after `createProbes`, so the scheduler has applied the checks first), and once after stop — so a record says `linked: false` as soon as the link is lost, shows the queue growing at each failed reconnect, and a `linked: true` one more than three heartbeats old is a daemon that is gone. A write that fails (a full disk, a directory in `run.json`'s place) is one log line, `could not write run.json: <reason>`, at start, at a beat and at stop alike; the daemon goes on. `ackedUpto` and the queue still move only at those events: an `ack` does not rewrite the file.
4. Log lines: `warden <version> running as <node>, reporting to <center>`; the link's own `linked to <center> as <node>` and `link lost — retrying in <n> s`; `<SIGNAL> received; stopping`.
5. SIGTERM or SIGINT, once: `probes.stop()` (clears the timers, kills the probe commands still going, flushes the batch while the link is up), `link.stop()`, the final `run.json`, 250 ms for the close handshake, exit 0. A second signal is ignored.

`home-lock.mjs` — `takeHomeLock(home)` → `'held'` · `'taken'` · an error code. One daemon per home: center closes the older link of a node when a newer one connects, so two daemons on one home took it from each other about once a second and both rewrote `state.json`. The lock is a listener on an abstract unix socket named for the home's real path (`\0cerberus-warden:` + the first 32 hex characters of its sha256): the kernel frees it when the process dies, however it dies, so there is no file to go stale and nothing polls. On a platform that cannot bind one (any error but `EADDRINUSE`) `run` logs `could not take the one-daemon lock on this home (<code>); going on without it` and runs.

## `enroll` — `runEnroll({ center, name, token })` → exit code
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

## The home — `homeDir()` = `CERBERUS_WARDEN_HOME`, else `~/.cerberus-warden`
| path | holds | mode |
|---|---|---|
| `keys/node.key` | private key, PKCS8 PEM; the source of truth | 0600 |
| `keys/node.pub` | public half, derived copy | 0644 |
| `identity.json` | `{ node, center, centerKey, cert, enrolledAt }`, written once by `enroll` | 0600 |
| `state.json` | `{ seqFloor }` (MAN-7824 §"`createOutbox`") | 0600 |
| `run.json` | what the daemon last wrote about itself (`run`, above) | 0600 |
The home and `keys/` are 0700. Every write is temp file → fsync → rename → fsync of the directory. A `state.json` that cannot be read is logged and its floor starts at 0.

## Measured
- 2026-10-06, slot-1 probe server: `enroll` printed `Enrolled as probe-node with Cerberus at http://127.0.0.1:7896`, exit 0; a second home with the spent token exit 1 `token used`; the first home again exit 1 `This home is already enrolled…`; `identity.json` and `keys/node.key` 0600.
- Same day, `identity.json` deleted after an enrollment and `enroll` re-run with the spent token: exit 0 by the plain connect (lost-welcome recovery).
- Same day, scripted hostile center: a `welcome` signed by another key, a certificate for another key, a bad certificate signature, no certificate, and a silent center each exit 1 (the silent one after 10 s), keys on disk each time.
- Same day, `.verify/warden-daemon.sh` on the slot-3 probe server (`SUNSET_SLOT=3 bash .verify/warden-daemon.sh`, 4 min): `run` enrolled as probe-node with an http and a tcp probe every 10 s; after 30 s the overview read probe-node `reporting`, both checks `ok`, and `status` printed `linked: true`, `ackedUpto: 3`, `outbox: 0 queued`, `probes: 2 scheduled`. The center killed 20 s and booted again with its store kept (`boot_probe_server --keep-store`; a plain `boot_probe_server` wipes the Cerberus store and key, so an enrolled warden meets a center that does not know it): the log read `link lost — retrying in 1 s`, `center is unreachable: ECONNREFUSED`, `linked to … ; resending 6 unacked frame(s)`, and a lookup of `probe/http.ok` 15 s after the kill answered `result`, `failing`, "Connection refused", from a row written 5.1 s into the outage. SIGTERM: exit 0, a final `run.json` with `linked: false`, `ackedUpto: 12`, `outbox: 0 queued`; 100 s later the overview read probe-node `silent` and both checks `unknown`.
- Same day: `run` in an empty home, an identity with only `node`, an identity with no key — each exit 1 with its sentence, nothing created; a center that was never reachable, then SIGINT: `center is unreachable: ECONNREFUSED`, `SIGINT received; stopping`, exit 0, `run.json` `linked: false`.
- A `run.json` is written at a heartbeat, so a resend's acks (which follow the `welcome`) show in it at the next one, up to 15 s later: `outbox: 6 queued` right after a relink, `0` after.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-daemon.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/daemon.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/enroll.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/home-lock.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/main.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/state.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/status.mjs

## MAN-7826 — Warden install path — `npm run build:warden`, the three gateway routes, `enroll.sh` (enroll and `--refresh`) and the unit

How `warden/` becomes a running unit on a node: the artifact, the routes center serves it on, the script that installs and refreshes it, and the unit it writes. Rules an edit keeps: INV-7042. The verbs the installed warden runs: MAN-7825. Where the gateway routes live: MAN-7803.

## Files
| file | owns |
|---|---|
| `warden/build.mjs` | `npm run build:warden` → `dist-warden/` |
| `server/modules/cerberus/warden-files.ts` | `registerWardenFileRoutes(listen)`, called by `cerberus.module.ts` `start()` before the gateway binds |
| `warden/enroll.sh` | POSIX `sh`: enroll and `--refresh` |
| `warden/systemd/cerberus-warden.service` | the unit template; `enroll.sh` fills `__USER__`, `__HOME__`, `__NODE__` |

## The artifact — `npm run build:warden`
- Stages `warden/{package.json,enroll.sh,src,systemd}` at their repo paths into `dist-warden/stage-XXXXXX` (`mkdtemp`), writes `dist-warden/cerberus-warden-<version>.tar.gz` (`tar -czf … -C <stage> .`, to `<name>.partial` first and renamed once `tar` exits 0), `<file>.sha256` (`sha256sum -c` format) and `latest.json` `{ version, file, sha256, size, builtAt }`. `latest.json` is renamed in last, so a node that reads it finds a whole tarball; a failed or killed build leaves the served name untouched.
- The stage is removed only while its path still begins `dist-warden/stage-`. A missing release path is refused BEFORE the stage exists; a SIGKILL or SIGTERM mid-build (the work is synchronous, so no handler can run) leaves its `stage-*` and `.partial` in the git-ignored directory, and a later build does not sweep them.
- A version already built is refused with one sentence unless `--force`; through npm that is `npm run build:warden -- --force` (npm keeps a bare `--force` for itself), and the sentence says so. why: a node holding that version never fetches changed files (`--refresh` installs only a NEWER version), so a plan that changes `warden/` bumps the minor version in `warden/package.json` first, and this refusal is what shows a forgotten bump.
- `dist-warden/` is git-ignored.

## The routes — `warden-files.ts`, on the gateway (`CERBERUS_LISTEN`)
| route | answers |
|---|---|
| `GET /cerberus/enroll.sh` | `warden/enroll.sh` read per request, its `CENTER` marker replaced by `http://<CERBERUS_LISTEN>`; `text/plain` |
| `GET /cerberus/warden/latest.json` | `dist-warden/latest.json`; `application/json`, `no-store` |
| `GET /cerberus/warden/<file>` | `dist-warden/<file>` streamed, for `^cerberus-warden-\d+\.\d+\.\d+\.tar\.gz$` only; `application/gzip` |
- Nothing is cached: a build is live the moment it lands. No secret is in any of the three.
- The gateway answers GET only: `HEAD` (`curl -I`) is a 404 on all three routes and reads as "not built".
- A missing `latest.json` or tarball: 404, one line, "No warden has been built — run npm run build:warden". A name outside the pattern (`..`, an encoded slash, `.sha256`): 404 "Not found", judged on the RAW path (nothing is decoded).
- The file route is a PREFIX route (`wardenHttpPrefixRoutes`, tried after the exact `wardenHttpRoutes`): a release's name carries its version, so no exact path can be registered before a build.
- The root is `findApplicationRoot`, the same in source and compiled; a gateway that never bound (no `CERBERUS_LISTEN`, or the API's own port) registers nothing.

## `enroll.sh`
Run as `curl -fsSL http://<center>/cerberus/enroll.sh | sudo sh -s -- --name <node> --token <token>` (the command `POST /api/cerberus/enrollments` prints), or `… | sudo sh -s -- --refresh`.
| step | enroll | `--refresh` |
|---|---|---|
| refuses | no root; `SUDO_USER` empty or `root`; no `node` ≥ 22, `curl`, `tar`, `sha256sum`, `systemctl`; a copy with no center address; an `identity.json` already there (before any release is fetched or swapped) | the same, except the identity: it refuses when `identity.json` is MISSING, or when given a `--name`/`--token` |
| release | always: `latest.json`, tarball, SHA-256 check, extract AS the account into `~/.cerberus-warden/releases/<version>/`, swap `current` (a temporary symlink, then `mv -T`) | only when `latest.json`'s version is newer than `current`'s |
| enroll | `node current/warden/src/main.mjs enroll --center … --name … --token …` as the account | never; identity and keys are untouched |
| unit | renders EVERY `warden/systemd/*.service` the release carries, `daemon-reload`, `enable --now cerberus-warden`, `restart cerberus-warden` (`enable --now` starts nothing on a unit already running) | renders EVERY `warden/systemd/*.service` the release carries, `daemon-reload`, `enable --now` any unit not yet enabled, `restart cerberus-warden` |
| last line | "The warden on <name> is reporting to Cerberus at <center>." | "The warden on <node> runs <version>." |
- The account is `SUDO_USER`, its home from `getent passwd`; everything under `~/.cerberus-warden` is made as that account (`sudo -n -H -u`), so it owns its home and keys.
- Before the last line the script waits 3 s and requires `systemctl is-active`: a unit that falls over is reported, not claimed running.
- An enrollment whose later steps fail leaves a home that `--refresh` finishes (identity exists, unit missing).
- Releases accumulate under `releases/`; nothing prunes them (the script removes no path it did not make itself).
- Measured 2026-10-06 on a scratch center (slot 2) with a private mount namespace over `/etc/systemd/system`, a stubbed `systemctl` and the real `sudo -u`: wrong token → "unknown token", then "Cerberus did not enroll this machine, so no unit was installed."; enroll, enroll again, refresh with nothing newer, refresh from 0.0.9; a wrong SHA-256, a closed port and a 404 each stop with one sentence and leave no `/tmp/cerberus-warden.*`.

- Measured 2026-10-06 on eis1 itself, over its tailnet address: `npm run build:warden -- --force` (0.1.0 had been built before several `warden/src` changes and no node had installed it), then the printed command `curl -fsSL http://100.103.222.79:3012/cerberus/enroll.sh | sudo sh -s -- --name eis1 --token <token>` ran as the operator and ended "The warden on eis1 is reporting to Cerberus at http://100.103.222.79:3012." on the first try. `identity.json` names the tailnet address; `systemctl show cerberus-warden -p ExecStart` runs `/usr/bin/node /home/lyphe/.cerberus-warden/current/warden/src/main.mjs run` as `lyphe`; `ss -tnp` shows the warden connected from 100.103.222.79 to 100.103.222.79:3012. A `touch server/index.ts` handover: `link lost — retrying in 1 s`, `linked` 1 s later, a lookup inside the gap answered `result`. The unit stopped 135 s: the overview read eis1 `silent` 90 s after the last frame heard and all 81 checks `unknown`; a lookup inside the stop answered `stale` for the 30 s checks and `result` for `system/disk.used` (its `staleAfter` is 900 s).

## The unit — `cerberus-warden.service`
`Type=simple`, `User=__USER__`, `WorkingDirectory=__HOME__`, `ExecStart=__NODE__ __HOME__/.cerberus-warden/current/warden/src/main.mjs run`, `Restart=always`, `RestartSec=5`, `After=network-online.target`, `WantedBy=multi-user.target`.
- why the operator's account: the probes need that account's `~/.pgpass`, state directories and loopback services; a root warden would make every command center can schedule a root command.
- `systemd-analyze verify` passes on a rendered copy.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-files.ts, /home/lyphe/.claude/claudecodeui_lyphe/warden/build.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/enroll.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/systemd/cerberus-warden.service
