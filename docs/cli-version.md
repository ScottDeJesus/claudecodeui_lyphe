# The CLI version report

One route, `GET /api/cli-version`, mounted behind `authenticateToken` in `server/index.ts`, wired in
`cli-version.module.ts`. It carries two facts of the same shape and never lets one stand for the other:
what the binary a run WOULD spawn answers to `--version` now, and what each live run's own process
announced at init. It answers 200 always — an unreadable binary is a fact in words, never an error wall.

The same two facts decide a retirement, and they are read from ONE cache to do it: the installed
reading is `cli-version.service.ts`'s `readInstalledCliVersion`, which the route serves and the chat
runtime asks at send time. A conversation whose CLI process is older than the binary on disk is
replaced at its next message (§"The version is a launch argument" below), so the route's "restart
this" and the runtime's "I already did" can never be two answers. "Older" is meant literally: the
comparison orders the two versions rather than noticing that they differ, and the reading stops
standing as soon as the binary behind it changes — see rules 6 and 8.

```json
{ "installed": "2.1.261", "reason": null, "binaryPath": "/home/you/.npm-global/bin/claude",
  "running": [{ "sessionId": "…", "startedAt": 1788621023058, "cliVersion": "2.1.261" }] }
```

`CliVersionReport` and `CliVersionRun` are declared under `CLI VERSION CONTRACTS` in
`server/shared/types.ts`, documented where declared. Read them there, not a copy here. The client
mirrors them in `src/shared/types.ts` under `CLI VERSION`, because three screens and one composer
read the same body.

The rules that follow are the server's. The client half — one hook, three surfaces, one restart —
starts below them.

## The rules that bite

1. **The binary probed is the one a run spawns.** `resolveSpawnedClaudeBinaryPath` in
   `claude-cli-path.ts` answers it by wrapping the resolver the spawn hands the SDK: `CLAUDE_CLI_PATH`
   when set, else the SDK's own (whose bundled binary is reached on Windows alone). A second resolution
   rule here would drift, and a real version for a binary nothing runs is worse than none at all.

2. **Null is "we don't know", never `0.0.0` and never a fault.** A bare or relative path — `claude` on
   PATH, the default — is looked up on the spawn's PATH or against the run's own cwd, and only when
   the run starts, so `binaryPath` and `installed` are null and `reason` says so in plain words: chosen
   when a run starts · did not answer `--version` · answered something unreadable. No errno, no stack,
   no path echoed back; an invented version would compare equal to nothing and stale to everything.

3. **A run's `cliVersion` comes from that run, never from the probe.** `claude-runtime.provider.js`
   stamps it at the top of the `for await` message loop from `message.claude_code_version`, through
   `ChatSessionWriter.setCliVersion` into the registry's `ChatRun`. Top of the loop on purpose: the
   session-id branch below is pre-closed on every resumed turn, so a stamp inside it would miss them.
   The SAME line records it on the live process's launch profile (`profile.cliVersion`), which is what
   the next message compares — one fact, written twice, never one taken for the other. A host that
   outlived its API re-adopts from the run's own journal instead (`lastReportedCliVersion`), because
   the journal is that process's record of what it said and the meta is only what the API launched it
   with; a process that has not spoken carries `null`, which is "not heard", never "different".

4. **A run is listed before its process has spoken.** The registry admits it at send time, a beat ahead
   of the init message, so `cliVersion: null` is a real state of a healthy run, as it is for a provider
   whose adapter never stamps. Filling it from `installed` would report every run current — the state
   this route exists to detect. Stale = a `cliVersion` differing from `installed`; a null is unknown.
   That is the DISPLAY's sentence, and it stays an inequality: a run ahead of a reading it has already
   moved past is shown stale for as long as the reading stands, which is now the install's own instant
   (rule 6) and is the conservative direction — the person is told about a difference a restart settles
   by hand. The runtime, which ACTS, is stricter and orders the two (rule 8).
   A re-adopted run is stamped from its host's journal the moment it is adopted, so the retirement
   decision reads what that process actually announced rather than a blank. That stamp is not what
   puts a stale host in the report: `running[]` holds a run while a turn is in flight, and a host
   adopted between turns is completed as it is registered (`readopt.ts`, the `turnCompleteSent`
   branch), so an IDLE stale host is listed by no report at all — it is retired by the server
   instead, on a version change or at boot (rule 9), and its next message spawns on the new build.

5. **The parse is a ladder, and a tie is null.** `--version` is read line-wise, since an nvm or npm
   shim prints its own line first; the CLI is identified rather than positioned — the `(Claude Code)`
   signature it signs with, then any line naming Claude, then any version-shaped line. A rung answers
   only when exactly one line holds it: two are a guess, so it falls to null rather than name a shim's.

6. **One spawn per window, shared, and the window ends when the BINARY changes.** A read version
   stands 60 s; a failure stands 10 s, because the operator repairing a broken CLI is the person
   watching this route. The exec carries a 10 s ceiling, and the in-flight promise is shared and
   cleared in a `finally` — clear it on the fulfilled path alone and a probe that once rejected is
   handed back, still rejected, for the life of the process. The cache is the process's ONE reading
   (`readInstalledCliVersion`), shared by this route and by the runtime's retirement decision, so
   those two cannot hold different answers for a window.
   The window is a claim about a file, so it is dropped when the file changes: every ask fingerprints
   the file the reading came from — that path, plus its mtime (`fingerprintOf`) — and probes again the
   moment it differs, so an upgrade is seen on the first ask after the install rather than on the first
   ask after the minute. That path comes off the reading itself, so the fingerprint costs two syscalls
   and NO resolver call (a resolver is asked once per probe and no more, which is what phase-14's
   rejection gate counts). A path that is no longer a file still gets a stable fingerprint of its own,
   so a binary that appears, disappears or moves re-probes rather than standing on a clock; a reading
   with no path at all (the CLI is chosen when a run starts) has no file to watch and the windows above
   decide alone, exactly as before.

7. **Nothing is persisted.** No column, no migration, no session field: a version is true only while
   its run is alive. `running[]` is the registry's own `listRunningRuns()`, which already keeps
   `status === 'running'` — three fields are copied off it, and this service joins and filters nothing.
   `startedAt` is epoch MILLISECONDS.

8. **The installed version is a LAUNCH argument.** A CLI process runs the build it was started with, so
   a message that would reuse a host older than the binary retires it and spawns afresh — at the moment
   of the message, not after a manual restart. The decision is `planLiveChanges` in `chat-process.ts`
   (the reason reads `cli 2.1.278 → 2.1.280`); the bounded read behind it is `installed-cli-version.ts`
   (`installedCliVersionForLaunch`, 1.5 s — a null is "not heard" and joins the process as it is), and
   the profile field is `LaunchProfile.cliVersion`. Three guards keep it from firing on a healthy
   process: BOTH sides must be strings; a process that has not announced itself is unknown, not stale;
   and the read is asked only when the running process has a version of its own, so an adapter that
   never speaks never spends a probe. A turn IN FLIGHT is never retired for a version — that is the
   banner's case, below.
   The comparison is ORDERED, not an inequality (`isBehindInstalled`): only a process BEHIND the
   binary is replaced. The live side is what a process announced at its own init and is never stale;
   the installed side is a reading, and a reading older than the process is no reason to replace it —
   on "differs" alone, a current process would be retired and respawned as the same build once per
   message until the reading turned over, each time paying a cold start and a full resume replay. Two
   versions that cannot be ordered fall back to the plain difference: a build nobody can compare is
   not a reason to leave a conversation on an old binary for good.

9. **An IDLE host is retired when the reading MOVES, and at every boot — that is what makes the
   restart automatic.** Rule 8 acts on a message; a host between turns had no message to act on it,
   so it sat on the old build for up to the idle closer's two hours and no surface said so (rule 4:
   an idle host is in no report). `idle-version-sweep.ts` runs the SAME test — both sides a version
   string, the ordered comparison, and no work in flight — on two triggers, and it reuses
   `planLiveChanges`'s `isBehindInstalled` rather than restating it: the probe's cache moving from one
   version string to a different one (`cli-version-change.ts`, whose observer the keepalive's owning
   process subscribes to at boot), and boot re-adoption, where the keepers are put through it after
   `retireOlderHosts`. "In flight" is asked in two places because the two triggers cannot ask it in
   the same one: at a boot the run registry is EMPTY — it is per-process memory and nothing has run
   yet — so `chatRunRegistry.isProcessing` answers *no* for every session on the machine, and the
   host's own meta is the only surviving witness: `turnCompleteSent` false (a turn was accepted and
   has not reported) or `heldForBackgroundWork` / a non-empty `deferredTools` (work the result did
   not wait for) keeps it. The log line is `[keepalive] retiring idle host <hostId>: cli 2.1.278 →
   2.1.280`, a kept host says so in one line of its own, and the retirement is the same
   wind-down as a supersede (`end_input`, then SIGTERM over the host's own socket), so the
   conversation is untouched and its next message spawns fresh and resumes. There is no timer: the
   change trigger rides the probe the client already polls and the send path already asks, and a
   machine with no client open is covered at the next boot. `null` on either side retires nothing,
   and a turn in flight is never touched — that case is the banner's, below.

## The client's one reading

`src/shared/hooks/useCliVersion.ts` is the only place in the app that reads the route, and the only
place the comparison is made — three screens making three comparisons is three chances to disagree
about one fact. The report is held at MODULE scope behind a single 60 s poller and published through
`useSyncExternalStore`. Not a per-component `useState`: the sidebar mounts this hook once per session
row, so a hook that fetched on its own would put one request per conversation on the wire every
minute for the same picture. The poller starts with the first subscriber and stops with the last, and
module scope is per DOCUMENT — a reload or a second tab starts with nothing and asks again, which is
correct for a reading of right now.

It hands back `installed`, the route's own `reason`, `staleSessionIds`, `staleVersionOf(sessionId)`
and `refresh()`.

**Stale is one sentence.** A run in `running[]` whose `cliVersion` is a *string* and differs from
`installed`. A null `cliVersion` is "not heard yet" — never stale. The server's replacement is the
stricter rule (it orders the two and replaces only a process behind the binary — rule 8), so this
client test can name a run stale in the moment after an upgrade in which no retirement would happen;
it is a display, and its answer is the conservative one. `installed: null` makes NOTHING
stale, which is why rule 2 above answers null rather than a stand-in version. A finished conversation
is not stale either: it is not in `running[]` at all.

**And stale no longer means "somebody must press something" for an idle conversation.** A run is listed
while a turn is in flight, and a process between turns the server replaces ITSELF — on a version
change or at boot (rule 9), which is the same reading being polled here; what is left for a person is
the turn that is running NOW, which is the banner's own case. The three surfaces still read one hook
and one comparison — the client is told the same fact it always was, and the server has stopped
waiting for it.

**A read publishes only when the body CHANGED, and only in TOKEN order.** The last body is kept
verbatim, so a poll that answers the same JSON republishes nothing and an idle app does not re-render
every session row once a minute. Each read takes a token, and one whose answer lands after a newer
one has already answered is dropped rather than published: two requests can be open at once, and the
older finishing last would otherwise put back the picture it replaced. A read that throws publishes
nothing and logs nothing — the route answers 200 even when it has no version to give, so a throw here
is this app's own network, and keeping the last picture is the honest reading of "we could not ask".

**`refresh()` is a FORCED read, and its answer is the point.** It opens its own request instead of
joining the poll already in flight — that one was taken before whatever the caller just did — and
resolves `true` when a reading arrived, `false` when none did. A caller acting on the answer must be
able to tell "the route says nothing is stale" from "we could not ask". The token is claimed only
once the body is known to be a report, so a 200 carrying something else (a proxy interstitial, a
truncated body) cannot take the token, publish nothing, and still tell the waiting caller that a
reading landed.

## The three surfaces

| Where | What it says | What it does |
| --- | --- | --- |
| Sidebar session row (`SidebarSessionItem`) | a warn `Badge` reading `↻ On CLI 2.1.240`, titled *Open the conversation to restart it on Claude CLI 2.1.261* | nothing — inert on purpose |
| Sidebar footer (`SidebarFooter`) | one fact line, `cliVersionFactLine()` | nothing |
| Above the transcript (`ChatInterface`) | a warn `Banner` | *Restart and resume* · *Stay on 2.1.240* |

The chip is inert because the restart lives in that conversation's own banner, beside the sentence
that explains what it does. Its title says where to go rather than being a second door.

The footer states the fact and stops there — a button in a footer would be one click ending work the
person cannot see. Its line joins what is installed to what is still running, and the difference
between the two not-knowns at the bottom is the whole point:

```
Claude CLI 2.1.261 is installed
Claude CLI 2.1.261 is installed · 1 conversation still runs 2.1.240
Claude CLI 2.1.261 is installed · 2 conversations still run other versions
Claude CLI version — the Claude CLI is chosen when a run starts, so its version is not known in advance
Claude CLI version —
```

Two stale runs that agree are named (`2 conversations still run 2.1.240`); two that disagree are only
counted, because naming one would be false about the other. The fourth line is `installed: null` with
the route's OWN words — never a stand-in `0.0.0`, and never one not-known standing in for another.
The fifth is the state every cold mount passes through: `installed` and `reason` are both null, so
nothing has been read and nothing may be explained.

The banner is the one place the fact carries an action, and it stands for the case the automatic
retirement cannot cover — a turn already running, which keeps the version it started on. It stands
above the transcript because it describes the turn being read, and it leaves on its own when that run
ends (the stale set empties and the banner goes with it, dismissed or not). Its copy names the
automatic half as the automatic half — an idle conversation restarts itself (rule 9) — so the press
below it is offered for the turn it is describing, not as the only way off an old build:

> This conversation is running Claude CLI 2.1.240. Version 2.1.261 is installed on your machine — an
> idle conversation restarts on its own and picks it up, and one that is answering keeps the version
> its turn started on. Restarting stops this turn and resumes the same conversation on 2.1.261 —
> every message is kept.

*Stay on 2.1.240* hides it for that run only. What is stored is `sessionId:version` in component
state — a new version is a different fact and asks again, and nothing is persisted, so a reload asks
again too.

The banner is also the ONLY thing that stands there. By operator ruling 2026-09-09 nothing else renders
above the transcript — the reasoning is with the lane that provoked it,
[plan-runner.md](plan-runner.md) §"The runner card" — and `.verify/phase-25.mjs` measures the
transcript's height against its chat root minus the composer and this banner, so a second region
above the messages reddens that gate whatever it is named. This banner is inside the measurement,
not an exception to it: it earns the height because it describes the very turn being read and
leaves when that run ends.

## Stop and resume

`src/modules/chat/hooks/useRestartOnInstalledCli.ts`, consumed by `useChatComposerState` in 17 lines.
It lives in the chat module because it needs the composer's abort, the composer's submit and the
per-session processing map, and it takes all three BY ARGUMENT along with `useWebSocket()`'s socket:
a shared hook would have to re-derive every one of them, and would then own a send it cannot see the
result of.

A state machine of four phases — `idle → stopping → resuming → resumed` — carrying the conversation
it belongs to, the `staleVersion` the report gave at the press, and `since`, the moment that phase
began. Every deadline is anchored to its own phase's clock rather than to when its effect last ran:
an unrelated conversation's `complete`, or a poll landing, re-runs these effects, and a timer re-armed
there would push its own deadline out indefinitely and leave the ending it exists to speak
unreachable. The intent is state rather than a ref because setting it must schedule the effect that
carries it forward; a ref beside it refuses a second press in the SAME tick, before any render could
disable the button.

Two witnesses decide the two hard questions:

1. **The stop ends on the terminal `complete` for THIS conversation, no older than the press**, read
   off the wire. The processing map is not that evidence — the server rewrites it every 5 s from its
   own list, so a sweep that merely stops listing the session would read as "the run I aborted
   ended", and the resume would go out for a stop that never happened.
2. **The resume is ATTEMPTED only on an open socket and CLAIMED only when the composer reached its
   send.** Neither alone is enough: `sendMessage` writes the frame if and only if the socket is OPEN
   and otherwise says so to the console and nowhere else, and the processing map is marked live a few
   statements BEFORE that frame is written, so on a dropped socket it would report a turn that never
   left the browser. The prompt is `Continue from where you stopped.` and carries no context on
   purpose — the SDK's `resume`, which every send already uses, hands the new process the transcript.

### The five endings

| Ending | What the person sees | What was sent |
| --- | --- | --- |
| resumed | positive toast *Resumed on Claude CLI 2.1.261* — "The conversation was stopped and resumed — every message is still here." | `chat.abort`, then one `chat.send` carrying the resume prompt |
| stopped, but abandoned | warn *Stopped, but not resumed* — "You opened another conversation while this one was stopping. Open it again and press Restart to continue." | `chat.abort` only |
| could not stop | warn *Could not stop the conversation* — "It never confirmed that it stopped, so nothing was resumed." | `chat.abort` only; no `complete` came back inside 15 s |
| could not resume | warn *Could not resume* — "The connection dropped, so nothing was sent. The conversation is still here." | `chat.abort` only; the socket was not OPEN when the stop landed |
| could not resume | warn *Could not resume* — "The conversation is still here." | `chat.abort`, and `handleSubmit` was called but nothing was observed running within 5 s |
| nothing to restart | warn *Nothing to restart* — "This conversation has already finished, so nothing was stopped." | nothing at all; a forced `refresh()` is fired instead |

Six rows, five endings: *could not resume* is reached two ways and says which. The last row is the
press the report itself invites — it is up to 60 s old, so the banner can still be on screen for a run
that has already finished, and an abort for a finished run sends nothing. That press arms nothing.

### One at a time

`restartPending` covers EVERY conversation while a restart is genuinely in flight (`stopping` or
`resuming`), so a stale conversation elsewhere has its button disabled and titled *Another
conversation is being restarted. Wait for it to finish.* — refused with the reason rather than
enabled and inert. A restart that has already reached `resumed` is NOT in flight: it is only holding
its own banner down, and up to twenty more seconds of "another conversation is being restarted" after
that conversation resumed is a sentence that has stopped being true.

### Hold and release

From the send until the report catches up, the banner for that conversation is held down —
`restartedSessionId`. Leaving it up would keep offering to stop the turn the press just started: one
more click and the resume is aborted and re-sent. It is released by the first reading that ARRIVES
after the send (that is what `refresh()` resolving `true` means), whatever that reading says; failing
that, by the report no longer saying what it said at the press; and failing both, by a 20 s
backstop. A read that FAILED releases nothing — released on the clock or on a request that merely
settled, the hold would end on the picture taken before the abort, and the banner would come back
describing the run this restart replaced. The chip and the footer count clear on that same reading,
because all three read one hook.

## What is left standing

- **"Stay on" is keyed to `sessionId:version`, not to a run.** A NEW run of the same conversation on
  the same old version is still dismissed. Deliberate — the person answered about that version — but
  it is not run identity.
- **The accent-filled button is the interrupting one.** *Restart and resume* takes `Button`'s default
  variant (`--accent`) and *Stay on 2.1.240* is the outline, so the eye lands on the one that stops a
  running turn.
- **A gateway-refused abort leaves a `NO_ACTIVE_RUN` row.** The server answers `protocol_error`, the
  client appends an error row to the transcript and idles the session, and no `complete` follows — so
  the machine says nothing for 15 s and then ends on the cap, beside an error row already on screen.
- **The positive claim is a fence, not a wire observation.** The composer marks the session live
  before `sendMessage` writes the frame, so a send the SERVER then refuses still raises *Resumed on
  Claude CLI …* next to the refusal's own error row.
- **`ws` is a memo, `sendMessage` reads `wsRef.current`.** The context's value memo captures the
  socket as of its last render (`[sendMessage, subscribe, isConnected]`), so during a token-refresh
  reconnect the gate can read a socket that is already replaced and refuse conservatively. Nothing is
  sent and the person is told so — a refusal, never a silent drop.
- **No abandon in `resuming` or `resumed`.** Only `stopping` watches the conversation on screen, so
  the positive toast can appear while the person is looking at a different conversation.
- **An unmount mid-restart speaks no ending.** The intent and its timers are component state; if the
  chat unmounts between the press and the ending, the abort has already gone out and no toast comes.
- **The 15 s cap's LENGTH is unmeasured.** `phase-15.mjs` R6 waits 16.5 s and reads the toast, so any
  cap shorter than that reads the same. What is proven is that the cap speaks, not when.
- **`installed` is cached, `running` is not.** The route serves `installed` from its own ≤60 s window
  while listing runs live, so a run that reached a new binary inside that window is reported stale
  until the window or the fingerprint ends it. The window no longer outlives the binary: an install
  changes the file the reading is about, and the next ask probes (`fingerprintOf`, rule 6), so
  the blind stretch is the install's own instant rather than the whole minute.
  The runtime reads that same cache — deliberately, one cache, one answer — and its decision is
  ORDERED (rule 8), so the two states this window used to confuse are now told apart: a reading older
  than the process replaces nothing (the process is ahead of a stale measurement, and retiring it
  would spawn the same build again per message), while a process older than the reading is retired at
  its next message, which is the point of the rule. What is left is small and named: a binary that is
  swapped in the instant between one ask's fingerprint and its probe answers with the version it had,
  and a binary whose content changes while its path and mtime do not (an in-place edit that preserves
  the timestamp) is invisible to the fingerprint and stands out its window like any reading.
- **The retirement wait is bounded at 1.5 s, and its length is measured against a cold cache only.**
  A warm reading answers in microseconds; the bound exists for a cache that goes cold against a binary
  that will not answer `--version`, and it is short of the probe's own 10 s ceiling so a message is
  never held for a binary nobody is watching. Nothing breaks if it elapses: a null joins the process,
  and the NEXT message retries — the probe's in-flight promise is shared, so the retry is cheap.
- **The idle sweep fires on a TRANSITION and at a boot — never on a clock.** An idle host is retired
  when the reading moves (`cli-version-change.ts`) or when the server boots (rule 9); nothing sweeps
  in between. So a stale idle host whose turn is in flight exactly at boot, on a machine where the
  version then stops moving, stays on the old build until its next message — the rule the sweep was
  built on, not a hole in it. A boot cannot ask the run registry that question (it is empty until
  something runs), so it asks the host's meta instead, and it keeps a host that was mid-turn or
  holding background work for the same reason the runtime's idle closer refuses to close one; a
  sweep that skipped such a host says so in one line, so the near-miss is visible rather than
  inferred. A second API process sweeps nothing: the subscription is registered
  after the keepalive claim (`readopt.ts`), so the process that does not own this machine's hosts
  touches none of them — the same reason it adopts none. And the walk is deferred a turn of the event
  loop, so neither the version poll nor a message send ever waits on tmux for it.
- **A sweep the reading provokes can retire the host that provoked it.** The message path's own
  bounded read is the same shared probe, so a message that finds an install also fires the sweep —
  and the sweep skips that host, because `dispatchRun` registered its run before the read was asked
  (`chatRunRegistry.isProcessing`). Any OTHER idle host behind the binary is retired in that same
  moment, which is the feature, not a side effect.
- **The disabled-with-reason state is near-unreachable.** Switching conversations during `stopping`
  abandons the restart, which clears `restartPending`; the only window where another conversation's
  button is disabled is the `resuming` phase — at most five seconds, usually one tick.
- **A wall-clock millisecond is the `resumed` intent's identity.** The hold is released only if
  `since` still matches the moment it settled, so two restarts of the same conversation settling
  inside one millisecond would collide.
- **A zero-length 200 would claim the token.** `lastBody` starts as `''`, so an empty body compares
  equal, takes the token and resolves `refresh()` `true` with nothing read. Unreachable from this
  route, which always answers a JSON report.
- **Lint reads 122 where it would read 119.** Three `react(set-state-in-effect)` on the machine's
  three transitions — the shape most of this repo's hooks already have, and well under the 130 the
  baseline ratchets against.

## Proving it

`node .verify/phase-14.mjs`, mostly `fetch` and `tsx` against the running dev server; see
[verification.md](verification.md). It spends one real Haiku turn — a `sleep 20`, wide enough to ask the
route mid-run — and spends it ONCE: the observation lands in `.verify/artifacts/phase-14-live-run.json`
and later runs read it back. Deleting that file re-measures, at the cost of a turn. The resumed-turn
stamp is settled by where the stamp line sits and what seeds the guard below it, never by a second turn.
Its snapshot of `claude-runtime.provider.js` is bounded rather than counted to a phase's own diff: the
gate now asserts what that bound stood for — the file is still JavaScript, its cliVersion footprint is
one call, and the DECISION is in `chat-process.ts` while the probe is in `installed-cli-version.ts`.

`node .verify/phase-15.mjs` proves the client, in headless Chromium and with ZERO real turns: the run's
six-turn budget was already spent, so both halves of the disagreement are REPLAYED. `/api/cli-version`
is answered inside the page, so `installed` and a run's `cliVersion` can be made to differ without
touching a binary, `.env` or the server — the stamping those numbers come from is Phase 14's, and is
not re-proven here. The websocket is sealed and the seal re-proven two-sided immediately before every
press, so what is measured is which frames the PAGE put on the wire, for which conversation, in what
order and how long after the `complete`. The live route is still read once with the page's own token,
and the footer asserted against the version the binary answers NOW rather than a literal that would
pass while stale. Shots are `15-baseline-footer-light`, `15-stale-chip-light`, `15-banner-light`,
`15-banner-dark` and `15-resumed-light`. See [verification.md](verification.md).

The idle sweep was proven LIVE, on a conversation the probe made itself, by MOVING THE READING
rather than installing anything. Six steps, and no message is sent between the move and the
observation, which is the whole point: (1) create a conversation through the API and send one real
turn, so its host is born on the installed build; (2) read that host's `cliVersion` off its own
journal; (3) forge the journal's init line to an older string — `2.1.278` — which is the state an
install leaves behind (the version sits JSON-ESCAPED inside the journal's own `line` field, as
`claude_code_version\":\"2.1.280\"`, so a plain-string match finds nothing and the forge silently
does nothing); (4) ask `/api/cli-version` and assert no run is in flight for that
conversation, the registry's own answer being one of the sweep's two witnesses (`busyReason` in
`idle-version-sweep.ts` is the other); (5) point `CLAUDE_CLI_PATH` at
a one-line stub that answers `--version` and move the reading in two asks — the first caches
`2.1.279`, editing the stub's answer to `2.1.280` and asking again is the transition that fires it;
(6) read the log, `listLiveHosts`, `tmux` and the host's three files. The stub lives only in the
probe's own environment: the real `claude` on `PATH` is never pointed at, and every other live host
was first MEASURED to be on the reading the stub would serve, so the sweep could not reach one.

Observed, with nothing sent in between: `[keepalive] retiring idle host
239cca8a-b5cf-405e-8710-9430b934985e-mucz1zjr: cli 2.1.278 → 2.1.280`; the host gone from
`listLiveHosts`, from `tmux` and from disk (all three files); the three other live hosts still
listed on the SAME pids (`3541241`, `3622011`, `3582704`); and then ONE message, which spawned a new
host for that conversation whose own init line reports `2.1.280`, while the reply still knew the word
the first turn had written into the conversation.

The BOOT trigger was then proven on a real turn in flight, with no stub at all: a conversation made
through the API, a real turn started by a scheduled message and held open (`sleep 50`), its journal
forged to `2.1.278` as above, and an ordinary dev handover — a real boot of the running server. That
boot logged `[keepalive] keeping host …-muczst10 on cli 2.1.278: a turn was in flight — it is
retired at its next message, not now`, re-adopted the host, and left its journal, socket and tmux
session intact; when the turn landed and the boot was repeated, the SAME host on the SAME forged
version logged `[keepalive] retiring idle host …-muczst10: cli 2.1.278 → 2.1.280` and took its files
with it. The forged record is OVERWRITTEN by the first re-adoption — the CLI re-announces the build
it actually runs — so the second boot forge again first. A genuinely old process re-announces the OLD
build, which is exactly why the boot test stands for the case it exists for. The trigger also proved
itself unprompted the moment the code landed: the next boot logged `[keepalive] retiring idle host
639a1d96-…: cli 2.1.276 → 2.1.280` and the same for `66071067-…`, then `re-adopted 3 host(s), swept 0
dead host file(s)`. No timer exists behind either trigger: the change rides the client's own ~1 min
poll of the route it already polls, and a machine nobody polls is covered by the next boot and the
next message.
