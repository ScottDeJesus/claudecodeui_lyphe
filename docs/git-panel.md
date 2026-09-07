# The git panel

The Source Control tab: which branch this is, how it stands against its upstream, what is
waiting to be pushed, what each change looks like, and the one button that asks Claude to commit
and push it. `src/modules/git-panel/` is `GitStatusHeader`, `changes/ChangesReadOnlyView`,
`history/HistoryView` (with `CommitHistoryItem` and `CommitGraphStrip`), `GitDiffViewer`,
`GitFailureBanner`, `GitRepositoryErrorState` and `GitDelegationCard` (with its
`StartRefusalBanner`) under the one `GitPanel` its barrel exports, with
`hooks/useGitReadController` holding everything the panel knows, `hooks/git-delegation/` holding
the run, and `utils/gitPanelUtils` deciding how each of those facts reads.

**It reads, and its one button performs no git write of its own.** Committing and pushing happen
in an agent run the panel delegates to: "Push my changes" opens a real Claude session and sends it
the literal `/git`, the operator's own command, whose rails are the estate's own push guard — the
integration plan's §3 D5. `GitDelegationCard` fills the named slot at the foot of `GitPanel`, and
the header says whose job this is in the one place a reader would look for a button: *Claude
handles commits and pushes for this project*. So the only way to start a git write here is a
conversation.

## What the header can say

One predicate decides it — `describeUpstreamPosition(remoteStatus, status)`, called ONCE in
`GitPanel` from the server's own `hasUpstream` / `hasCommits` flags, and handed to the header and
the Changes view together so the two cannot disagree. Three of its four answers are unknowns, and
none of them may render as good news:

| The read said | Badge | Changes tab |
|---|---|---|
| tracked, `ahead: 0` | `✓ Everything is pushed` (positive) | on a clean tree, *Nothing waiting to be pushed*, naming the ref it was measured against |
| tracked, `ahead: N` | `N of yours are not pushed` (info) | a section headed **Already committed, not pushed · N** |
| `hasCommits: false` | `— No commits yet` (neutral) | on a clean tree, *No commits yet* — a known zero |
| `hasUpstream: false` | `— No upstream yet` (neutral) | a section headed **· —** saying the branch tracks no remote — the same sentence as an empty state when the tree is clean |
| the read failed | `— Couldn't read upstream` (warn) | the same **· —** section, amber, git's own words one hover away |

The em dash is load-bearing: "0 not pushed", "nothing committed", "no tracking ref" and "the read
failed" are four different facts and only one of them is *everything is pushed*. A failed read is
the only one that is an error, so it alone is amber.

## The rules that bite

1. **Three reads per project, and one more per Refresh — nothing on a timer.**
   `useGitReadController(project)` returns `{ status, remoteStatus, commits, loading, error,
   diffFor, refresh }` and fetches `/api/git/status`, `/api/git/remote-status` and
   `/api/git/commits?limit=50` together. Diffs are not part of that: `diffFor` is one call a row
   makes when it is opened, because this fork's own working tree carries three hundred-odd
   changed paths and a diff apiece would be that many requests for rows nobody clicked.

2. **Every answer is stamped with the project it belongs to, and stale ones are dropped.** One
   piece of state holds the last completed read plus its `projectId`, and a read whose stamp is
   not the project now selected renders as nothing at all — never as the previous project's rows
   under this one's name. A generation ref drops an older in-flight response, and a mount ref
   keeps StrictMode's double-invoke to a single read; `refresh()` deliberately bypasses it.

3. **`commits: null` is a read that failed; `[]` is a repository with no history.** They are
   drawn differently on purpose — History says *The commit history couldn't be read* in amber for
   the first and offers the *No commits yet* empty state for the second, and the Changes tab keeps
   its count while naming no commit rather than listing none.

4. **The unpushed list is anchored at HEAD, not at the top of the log.** `/api/git/commits` asks
   every ref for the History graph, so a foreign commit can sort above this branch's tip;
   `selectUnpushedCommits` finds the entry decorated `HEAD` and slices `ahead` from there. When
   HEAD is not in the 50-entry window at all, it returns null and the section keeps its count and
   says why — a slice from the top would be a list of *pushed* commits under a heading saying
   they are not. When `ahead` exceeds the rows it could name, the list says it is showing the
   most recent ones.

5. **A failure is drawn one way, at both sites.** `describeGitFailure` gives the wording and
   `GitFailureBanner` gives the rendering: amber, in English, the path in mono when the failure
   names one (it runs to the end of the line, so a path with spaces survives), and git's own text
   in `title`. A folder that is simply not a repository is a different thing — an EmptyState with
   no action, because initialising one is a write.

6. **`staged` comes down the wire and is deliberately not rendered.** It is a subset flag over the
   four path groups, not extra paths, so listing it would count the same file twice. The changed
   list walks `FILE_STATUS_GROUPS` (M, A, D, U) instead, and a commit's own file list walks the
   same tone map — one status never reads two ways inside the panel.

7. **An untracked folder is one entry, and it is not asked for a diff.** `git status --porcelain`
   collapses a wholly-untracked directory to a single `?? dir/`, so the trailing slash is all that
   tells a folder from a file. Those rows are labelled *New folder · never committed*, open onto
   designed copy rather than a round trip, and the list says underneath how many of its entries
   are folders — the headline counts entries and cannot count the files inside them.

8. **Opening a row shows a diff; the only way out is Files.** One row at a time, a second click
   closes it, and `Open in Files` hands the path to the workspace's file manager — see
   [file-manager.md](file-manager.md). `GitDiffViewer` bounds what it paints at 200,000
   characters and 1,500 lines and says so when it has cut something, so a huge diff cannot freeze
   the tab.

## Push my changes

The panel's one verb, in the slot at its foot. A press creates a Claude conversation in this
project's directory (`api.providers.createSession`) and sends it a single `chat.send` frame whose
whole content is `GIT_DELEGATION_COMMAND` — `/git` in production — on `sonnet`, with
`permissionMode: 'bypassPermissions'`, then puts this socket in the run's audience with a
`chat.subscribe`. That is the client's entire part in a git write: the provider, the working
directory and the project path are resolved server-side from the session row the press just
created. The literal has to *begin* with `/git` or the estate's push guard
(`~/.claude/hooks/enforce_push_via_git_command.py`) refuses the run the one thing it exists for,
so a trailing space, a newline, or the command's expanded text each cost it the push.

**What it starts is the estate's checkpoint, not this repository's.** `/git` commits and pushes
all four repositories `~/.claude/commands/git.md` lists, three of which this panel never draws.
The card says so on its face — *the checkpoint that commits and pushes every repository, not only
this one* — while the caption under the button counts only what is here: *N files here · commits
are grouped by intent, then pushed to main*. Having nothing waiting in this repository is
therefore never a reason to disable the button, and the caption says so in its own words rather
than going quiet (*Nothing waiting here — the run still covers every other repository*).

**The outcome is read from git, never from what the agent said about itself.** On the run's
terminal frame the hook calls `controller.refresh()` — the panel's own three reads — and
`deriveFinishedState` computes the card from those payloads alone. The run's frames are read only
for what a *command* proves: `stageOfCommand` finds the git subcommand by position — past the
global options that take a value, which is what `git -C <repo>` is — and never reads a tool
result, because `git status --porcelain` prints the word "commit" often enough to tick a step that
never happened.

| The card says | What decided it |
|---|---|
| `● Claude is running /git`, over four step lines | a `tool_use` frame whose Bash command names `status`/`diff`, `add`, `commit` or `push`. Steps only move forward, and one is ✓ only once a command proved it |
| `✓ Pushed to main`, and the run's commits by short hash and subject | the tree read clean **and** `ahead === 0`. Five lines at most, and it says when the list was cut; a clean tree that was simply behind names what was already waiting instead |
| *Some changes are still not committed — read the conversation to see what stopped it.* | any of the four file groups still holds paths |
| one sentence per push failure — rejected · protected · no-upstream · conflict · credentials | git's own words in the **push's** result text, most specific first. A checkpoint spans several repositories, so the run's last word is rarely the push's, and the push's own result is kept for this |
| *N commits are still waiting to be pushed — read the conversation.* | commits exist, `ahead > 0`, and nothing named a cause. With no count at all it says the read failed rather than inventing a number |
| *Claude could not finish — read the conversation.* | the run sent an `error` frame, or the gateway refused the send (`protocol_error`) |
| *We stopped hearing from this run — read the conversation to see how it ended.* | 120 s of silence, then a `chat.subscribe` the gateway did not answer inside 10 s. It claims nothing about the push, in either direction |

Everything but the pushed receipt is a warn Banner — amber, never red — and every finished state
offers *Read the conversation*.

**The run lives outside React; the one-run guard lives on the server.** The workspace unmounts the
panel whenever another tab is selected, so the run's identity, its subscription and its watchdog
sit at module scope in `hooks/git-delegation/runStore.ts`, and a mounted panel binds to them
through `useSyncExternalStore` — which is why leaving the tab and coming back shows the run in
flight rather than an armed button. Module scope is per document, though, so a reload, a second
window and an HMR update each get an empty one: `findLiveRun.ts` asks the SERVER instead, reading
`/api/providers/sessions/running` fresh at the press rather than trusting the 5-second poll behind
the sidebar's activity chip. A running session IS a delegation run when its `summary` is the
command or — every sidebar row can be renamed, including this one while it runs — when its first
user row is, read as two bounded head pages rather than as a transcript (the largest conversation
on this host is 86 MB). The question is asked host-wide, because `/git` is one checkpoint across
all four repositories: a run in this project is adopted and narrated here, a run in another
project is named and refuses the press (*A checkpoint is already running in …*, with the way into
it beside the button), and a guard that cannot be read refuses too — *We couldn't check whether a
run is already going, so nothing was started.* Dismiss asks the same question before it lets go of
a run nobody heard end.

**The command is an operator knob.** `VITE_GIT_DELEGATION_COMMAND` (documented in
`.env.example`) replaces the literal, and pointing it at a read-only command is how the button is
exercised without moving a remote. ⚠ It is not a read-only *session*: the push guard's test is
`/git` followed by a word boundary and a hyphen is one, so a value like `/git-rehearsal` mints the
same 30-minute push grant inside a conversation this button starts with `bypassPermissions`. Keep
such a value only as long as the run that needs it.

## What is left standing

- **A tab round trip discards an open diff.** `GitPanel` renders one view or the other, so
  switching to History and back unmounts the Changes view along with the diff it had open — and
  the History tab loses its own per-commit diff cache the same way.
- **A fast collapse-and-reopen re-fetches a commit diff.** The cache key is written when the read
  *lands*, so a row closed and reopened while its first read is still in flight sends a second
  `GET /api/git/commit-diff`. Both answers are for the same commit, so the row is right either way.
- **A merge row draws a zeroed stats card.** `git show` omits a merge's patch and still prints its
  header, so `parseCommitFiles` finds no file sections and the card above the header reads
  Files 0 / +0 / -0. Pre-existing, measured (`.verify/phase-10.mjs` §7c reads a real merge over
  HTTP), deliberately deferred.
- **"Unpushed" is inferred, not read.** What the HEAD-anchored slice cannot rule out is a foreign
  commit sorted *below* HEAD inside the first `ahead` entries. Only a server read of
  `git log @{u}..HEAD` would settle it, and `/commits` asks every ref because the graph needs it.
- **The server's git write routes are still there, and nothing calls them.**
  `server/modules/git/**` keeps its write surface; every `api.git.*` helper in `src/` is a GET
  (`status`, `diff`, `commitDiff`, `branches`, `remoteStatus`, `commits`), and the command palette
  is the only consumer outside this module. Retiring the unconsumed routes is a follow-up.

### The delegation's own

- **`agent-error` outranks a clean read.** The plan's order is explicit, so a run that errored,
  recovered and pushed anyway would be called a failure while the lists above it read *everything
  is pushed*. Moving that test below `ahead === 0` is the whole fix; the combination has not turned up.
- **The tree is tested before the upstream.** A run that pushed what it committed and still left
  something uncommitted reads *not committed* — the more useful of the two true things, by plan order.
- **"Opens with the command" is the identity key, host-wide.** A conversation somebody starts by
  typing the command in chat is a delegation run to the guard; a run started while the knob held a
  different value is invisible to a page built with this one.
- **A deleted session row is the guard's only fail-open.** Deleting a conversation removes its row
  without stopping its run, so that id lingers in the running list with nothing behind it. It is
  skipped with a console warning rather than blocking the panel's only verb for the rest of that run.
- **The head read is two rows deep.** `HEAD_ROWS = 2` clears one leading non-user row; a
  conversation that opens with more than that hides the command from the fallback test.
- **The guard's cost scales with what is running.** Up to three small reads per running
  conversation, sequentially, on every press and every dismiss — bounded by how many runs the host
  has going, which is not something this panel controls.
- **Two presses inside ~10 ms are indistinguishable from here.** The window before the gateway
  registers the first run is the floor a client-side guard cannot reach; only the server could
  refuse that one.
- **A held dismiss's sentence lives in component state.** The notice and the refusal belong to the
  panel that pressed, deliberately not to the store, so leaving the tab drops the sentence while
  the run and its receipt survive.
- **A dismiss that is asking the server shows nothing.** The in-flight flag is a ref, so a second
  click is swallowed silently rather than answered on screen.
- **A conversation resumed with the command right after its receipt can be skipped.** "Already
  reported" is keyed on the session id and dropped only when the server stops listing it, so a new
  run sent into that same conversation inside the few seconds it lingers is invisible to the guard.
- **An adopted run re-subscribes at `lastSeq: 0`.** The gateway replays a running run's whole event
  backlog to the adopting document; steps only move forward, so it costs frames rather than
  correctness. That receipt also carries no "commits that were waiting" line — a document that
  missed the press cannot know how far ahead the branch was.
- **The receipt's commit list carries the same caveat as the unpushed list.** It is anchored at HEAD
  and walks down, so a foreign commit sorted *below* HEAD inside the run's own window would be
  claimed — see *"Unpushed" is inferred, not read* above. `git log @{u}..HEAD` is the server read
  neither of them has.
- **A press discards an un-drawn receipt for another project.** A run that ended while another
  repository was on screen waits for that panel to be looked at again; pressing here first
  supersedes it, and its receipt is never drawn.
- **A hidden tab reaches the silence deadline late.** Browsers clamp timers in a backgrounded page,
  so the 120 s is a floor rather than a bound — the safe direction for a verdict that ends a run's
  narration.
- **The guard's truth is one server process's memory.** `listRunningRuns` reads a `Map` held in the
  running server (`server/modules/websocket/services/chat-run-registry.service.ts`), so a restart
  empties it and a press after that has nothing left to be refused by.
- **"Read the conversation" keeps the workspace's tab.** The workspace restores the tab it was last
  on, so arriving from Source Control lands on Source Control and the conversation is one click
  away rather than on screen. Selecting the Chat tab on arrival is workspace state, and a follow-up.
- **The rehearsal minted a push grant it never used.** `/git-rehearsal` matches the push guard's
  `/git` + word-boundary pattern, so the one real verification run's own CLI session was granted a
  push it did not take. Measured and reported rather than worked around — the hook is the estate's,
  not this fork's — and expired on the guard's own TTL.
- **Neither silent refusal says which condition fired.** A running-sessions read that answers
  non-OK and a body whose `sessions` is not an array both return "I could not check" without a log
  line; only the thrown path is logged, and the operator's sentence is the same either way.
- **The malformed-body branch is unexercised.** `.verify/phase-11.mjs` drives the 401 and the
  deleted row; a 200 carrying a non-array `sessions` is reasoned about rather than replayed.

## Proving it

The reading half is `node .verify/phase-10.mjs`, headless Chromium against the running dev server.
It spends no Claude turn and writes nothing — the states no repository on this host is in are
replayed from the server's own bodies. The button is `node .verify/phase-11.mjs`, which presses it
for real once — behind a websocket seal it re-proves before every press — and drives every other
finished state through the real hook and the real card. See [verification.md](verification.md).
