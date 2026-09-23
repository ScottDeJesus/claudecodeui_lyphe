# The Schedules tab

Two routes under `/api/schedules` — `GET /` and `POST /sync` — behind `authenticateToken` on the
MOUNT (`server/index.ts`; the routes file imports no guard of its own), composed by
`schedules.module.ts`, and one tab of the project workspace's strip (`WorkspaceTabs.tsx`), mounted
while it is the active tab (`WorkspaceMain.tsx`).

The tab shows **the registry**: the tracked record of every scheduled job this box has, written by
one sync and served from a table. The registry is the source of truth. The box is a thing a sync
CHECKS that record against — never a thing the screen derives rows from.

## What the tab is, and where it sits

Third of the house row (`HOUSE_BASE_TABS` in `src/modules/project-workspace/WorkspaceTabs.tsx`) —
the second of the workspace's two rows, the one for surfaces that do not depend on the open
project: after the board and the sky, before the data-gated Memory, Runner and Heal tabs — id
`'schedules'`, label from the i18n key
`tabs.schedules` (`"Schedules"`, `src/modules/i18n/locales/en/common.json`), glyph the lucide
`Clock`. Like the board and the sky it carries **no gate**: the registry describes the box itself,
so nothing on it depends on which project or session is open.

The pane mounts only while the tab is active, and the panel is **read-only**. Refresh is the one
control; there is no run-now and no pause, because a control the backend cannot serve is a promise
the app breaks (run-now and pause are a separate plan, not an omission here).

Rows sit under one heading, `Your jobs`, and a job that needs a look floats to the top. **The OS's
own cron is not on this screen** (operator ruling, 2026-09-21): logrotate, man-db, apt and the rest
of what Ubuntu's packages drop into `/etc/crontab`, `/etc/cron.d` and the run-parts directories are
nothing this house created, so the sync never reads them. Everything the house schedules goes
through the door, and the door only writes the user crontab. **The header leads with the
sync's age**, and that age carries its own tone: a stored registry is only as true as its last
sync, and that sync can die silently, so an old, failed or absent one reads `warn` with a sentence
under the header saying the rows may be stale (`scheduleReadings.ts` → `syncFreshness`). A dead
sync must never look like confident rows.

## The registry is the source of truth, and opening the tab scans nothing

`GET /api/schedules` answers a `CronRegistrySnapshot` read from the store and nothing else.
`readRegistry` shells nothing and opens no file: the cron half is `cronJobsDb.listJobs()`, the last
sync `cronJobsDb.lastSync()`, and the scheduled-prompt half is read LIVE from
`scheduledMessagesDb.listPendingForUser(userId)` — which is why the route passes it the
authenticated `req.user.id` (a person's pending prompts are not another's to see, and that
repository has no `listAll`). A prompt that fires stops being pending, so the next read says so; it
is never a stale row in the registry.

On the client, `useSchedules` reads **once on mount, never on a timer**, and the panel's
minute tick is a render clock that fetches nothing — it only lets the sync's age cross the
one-hour stale line while the tab stays open. A `crontab -l` on the read path, to confirm a line
still exists, would be exactly the live derivation this feature exists to replace, and would put a
subprocess on every tab open. **The sync is the only thing that looks at the box.**

## The two tables, and where they really live

`cron_jobs` and `cron_sync_runs`, declared as SQL constants in
`server/modules/database/schema.ts` and applied by `server/modules/database/migrations.ts` exactly
the way `SCHEDULED_MESSAGES_TABLE_SCHEMA_SQL` is. They live in **the database CloudCLI already
owns** — the path `getDatabasePath()` resolves from `DATABASE_PATH`, today
`/home/lyphe/.cloudcli/auth.db`, alongside `scheduled_messages`. The repository is
`repositories/cron-jobs.db.ts` (`cronJobsDb`), taking `getConnection()` inside each method like its
neighbours.

**That file's journal mode is `delete`, not WAL.** The door is a SECOND writer, so it sets
`PRAGMA busy_timeout = 5000` before its first write and holds its own lock; without the pragma a
write arriving mid-transaction fails `SQLITE_BUSY` instead of waiting the five seconds that would
have seen it through.

### The recovery story

**If that file is ever lost or rebuilt, ONE sync repopulates every cron row from the box
automatically.** Every line the sync reads is, by definition, a row the registry no longer has, so
the next run adopts them all — each with its name derived from its command and the box's own words
in `note`. Nothing else has to be restored by hand, and no list of jobs needs keeping anywhere.

**The one column that does not come back is `purpose`.** It holds the operator's own words about
why a job exists, and those words exist nowhere else — the box has no such field, and no other
process writes one. Every other cron field is an answer the box itself gives. So `purpose` is the
one part of this record worth backing up.

A `scheduled-prompt` row is not in this table at all: it is read live from `scheduled_messages` on
every request, so there is nothing of it to rebuild.

## What a CronJob row holds, field by field

One row is one crontab line or one scheduled prompt. The shape is declared once, in
`server/shared/types.ts` (`CRON REGISTRY`), and mirrored field-for-field into `src/shared/types.ts`
for the tab.

- `id` — stable identity, `${kind}:${origin}:${sha1(command).slice(0,12)}`. Only the COMMAND is
  hashed: a line moved between tables keeps its identity, a changed command is a different job.
- `kind` — `cron` (a line the box runs) or `scheduled-prompt` (a message this app will send).
- `name` — a handle, not a summary. On adoption it is derived from the command (basename of the
  first path-like token, Title Cased, plus the following argument word); otherwise whatever name
  the door was given. The whole command rides the name's `title` on screen for the cases this
  cannot read well.
- `purpose` — why it exists; `null` until someone says. Set by the door's `--purpose` and kept
  from the existing row when the flag is absent.
- `tags` — short lowercase words for what a job is FOR, read at a glance down the column
  (`cleanup`, `backup`, `recovery`, `sync`); `[]` when none. Stored as a JSON array in `cron_jobs.tags`
  (added to a live table by `migrateCronJobsColumns`). Set by the door's `--tags a,b` — trimmed,
  lowercased, repeats dropped; `--tags ''` clears them — and kept from the existing row when the flag
  is absent, exactly as `purpose` is; the sync carries them through. Drawn as grey chips after the
  row's badges: never a colour, because colour on a row already means state.
- `owner` — `lyphe` for a crontab line, and the asking user's id (as a string) for a prompt.
- `origin` — always `user`. It stays a field because every stored row and every id carries it.
- `expression` — the raw cron expression, verbatim: five fields, or one macro (`@daily`) that
  stands for all five.
- `scheduleText` — the same schedule in plain words (`describeCron`) — what the Schedule cell
  shows, the raw expression beside it.
- `command` — the command line as the box holds it, whitespace normalised. This is also the
  journal's key, by equality, so the normalisation is load-bearing.
- `logPath` — the absolute path from a `>>` redirection, else `null`. Shown with the owner's home
  as `~`; where it is null a cron row's Where cell reads `journal`.
- `state` — a cron row is one of `ok` / `failed` / `missing` / `unknown`; a prompt row carries its
  `scheduled_messages` status one-to-one (`pending` / `sent` / `cancelled`, plus `failed`).
- `drift` — `none`, `adopted`, `missing` or `changed`: how far the row has moved from what the box
  holds. **Sticky** — see §"What it decides".
- `driftDetail` — what moved, in one clause — *schedule was `0 * * * *`, now `30 * * * *`* — or
  `null` when drift is `none`. It gets a line of its own on the screen whenever it is set.
- `lastRunAt` / `lastResult` — the last invocation the journal saw for this exact command, as
  ISO-8601 with this box's own offset, and the word `invoked` beside it (`null` when nothing saw
  it).
- `nextRunAt` — a prompt's own `scheduled_for`; `null` for every cron row.
- `note` — anything the record must carry that no other field holds; kept from the existing row.
- `source` — where the row was read from: `crontab -l`, or `scheduled_messages` for a prompt. It is
  also what a row is matched against a source that would not answer.
- `trackedAt` / `updatedAt` — when the row entered the registry (written once, never again) and
  when the sync last touched it.

A run of the sync is its own row in `cron_sync_runs`: `ranAt`, `ok`, `error`, `seen`, `adopted`,
`missing`, `changed`, `ms` — the `CronSyncReport` the panel's header reads.

## The sync check

One function, `runSync`, one sync at a time (a second caller joins the run in flight rather than
starting a second one, and gets that run's own report). It reads, decides, writes, and records.

### What it reads

Every line of the operator's own crontab, through `crontab -l` — the `crontab` command, never a
file read directly (`schedules-cron-read.service.ts`). The system tables are deliberately not read;
see §"What the tab is, and where it sits".

Plus the journal, read ONCE per sync rather than once per row: `journalctl -u cron --since
-7 days` (`schedules-journal.service.ts`). A journal that cannot be read yields an empty map,
which downstream means "no invocation seen" — never "the job did not run".

A source that will not answer contributes no lines, a message to `error`, and its own identity to
`failedSources` — which is why that read returns three things and not one. A row whose source would
not answer is NOT the same as a row the box dropped, and only the second means the job is gone.

### What it decides

`reconcile(stored, seen, invocations, now)` is PURE — no database, no subprocess, no clock of its
own — which is what lets the drift rules be exercised against a scratch table instead of the
operator's real crontab. A line the box showed is one of three things:

- no tracked row carries its id → **adopted**: the registry gains it, named from its command;
- a tracked row differs in `expression` or `command` → **changed**, with the move spelled out;
- a tracked row matches it → carried through **with its stored drift kept**.

That last rule is the one that is easy to get wrong. **Drift is sticky**: a job edited outside the
door keeps saying so until the door itself clears it, because the door is the only thing that knows
the edit was meant. Recomputing a match back to `drift: 'none'` would launder an outside edit
within one fifteen-minute cadence and put the adopted and changed badges permanently to sleep.

A row the box no longer shows is **marked, never deleted** — `state` and `drift` both become
`missing`, and the row keeps its place, because what left the box is exactly what the registry
exists to remember. (`removeJob` is the one delete in the repository, and only the door's explicit
`remove` calls it.) And a row whose SOURCE went unread takes state `failed` instead: an unreadable
crontab cannot mark the whole registry missing.

### When it runs

Two ways, and neither decides anything itself — they start the same run:

- **its own cron line, every fifteen minutes**: `*/15 * * * * /home/lyphe/.claude/scripts/cron-registry-sync sync >> /home/lyphe/.claude/state/cron-registry.log 2>&1`;
- **the Refresh button** on the tab, which is `POST /api/schedules/sync` behind the same guard.

The sync is **itself a tracked job**. Nothing special-cases its own line: the first run adopts it
like any other, and afterwards it is a row like any other — which is why the header's counts
include the sync that wrote them.

A sync started from the server — the Refresh button — never goes through the door, so it cannot see
the door's lock, and a Refresh that read the registry before a hand-run `add` wrote its row can
still re-badge the row the door just curated. **Only a door visit clears that badge again** — drift
is sticky, so no sync will take it off — and until one comes, the row reads `Adopted`.

## The one door

**`/home/lyphe/.claude/scripts/cron-registry-sync <verb>`** — the only path anything outside this
repo ever names. One command edits the operator's crontab and records the change in the same act,
and this is it.

```
cron-registry-sync add --name <n> [--purpose <p>] [--tags <a,b>] --schedule <expr> --command <cmd> [--log <path>] [--tabfile <f>]
cron-registry-sync remove --command <cmd> [--tabfile <f>]
cron-registry-sync list
cron-registry-sync sync
```

Each verb prints one line on stdout whose **first token is the verb** — `add ok name='…'
schedule='…' command='…' table=live log=… crontab=written row=…`, `remove ok command='…'
table=live crontab=removed`, `list id=… kind=… state=… drift=… expression='…' command='…'`,
`sync ok=y seen=… adopted=… missing=… changed=… ms=… ranAt=…`. A failure says so in the same
shape (`add drift crontab=written registry=missing …`), never as a success line. Exit is `0` for work done, `1` for work that failed, `2` for a bad invocation (with
the usage on stderr) — so a caller can never read "something went wrong" where "you typed it
wrong" was meant. `list` prints the registry and nothing else; **the registry is the list**, and
this page deliberately carries no copy of it.

- `add` is idempotent on the command: one line and one row however many times it runs. `--log
  <path>` is composed into the line as `… >> <path> 2>&1`, cron's own idiom, because cron
  otherwise mails stdout; a command that already redirects is written as given, and pairing one
  with `--log` is refused rather than resolved.
- `remove` takes the line and the row away, and is the one act allowed to delete a row.
- **`add` and `remove` are the ONLY things that clear a drift flag.** Curating a job at the door
  is what says the line is meant.

### Exercising it without touching the box

`--tabfile <path>` makes `add` and `remove` read and write THAT file instead of the live crontab —
for the read and the write alike, never one without the other. `DATABASE_PATH` points the registry
at a scratch database. Together they are how the door is exercised end to end with nothing of the
operator's at risk. One caution: a `DATABASE_PATH` whose file does not exist yet is not
necessarily empty — `connection.ts` seeds it from the repo's legacy `database/auth.db` if that is
present. `sync` takes no `--tabfile`: it reads the live box, and only its registry is redirected by
`DATABASE_PATH`.

### Why the crontab line names the wrapper, and never the CLI's path

The wrapper is the whole of it:

```sh
#!/bin/sh
cd /home/lyphe/.claudecodeui_lyphe || exit 1
exec ./node_modules/.bin/tsx --tsconfig server/tsconfig.json server/modules/schedules/schedules-cli.ts "$@"
```

**A crontab line calls `/home/lyphe/.claude/scripts/cron-registry-sync sync` and never the repo's
internal `tsx` invocation.** A crontab line is the one thing on this box that nothing watches: a
line quoting an application repo's internal file path breaks the day that path moves — silently,
because a cron job that fails to start writes to a log nobody is reading, and the only symptom is a
registry that quietly stops changing. The stable path survives an edit to the import graph, and
there is one file to repair if the invocation itself ever has to change.

### Why the crontab is written before the registry

Both writes happen under **one lock**, in one act, and the crontab goes first. The failure that
order leaves is a box holding a line the record does not know about — which is exactly what a sync
is for: **the next run adopts it.** The opposite order would leave a tracked row for a line that
was never installed, and the box's own word for that is `missing` — an entry in the record for a
job that does not exist. A door that fails says so on stdout with the command's own text, names the
drift, and exits non-zero. A failure is never reported as success.

The lock is a sidecar (`~/.cloudcli/cron-door.lock`, or `<tabfile>.lock`), taken by every verb that
touches the registry — `sync` included, because the sync's own cron line runs this same command and
can land inside a hand-run `add`. It names its holder's pid, and is taken over only when that
process is gone.

## What the record deliberately cannot say

Two things a reader will look for and not find, so nobody re-derives them:

1. **A cron line's exit status.** `journalctl -u cron` records the INVOCATION and never an exit
   code, so `lastResult` is `'invoked'` or `null` and never "succeeded" — a success this box could
   not substantiate is a success it does not claim.
2. **Any readable store of Claude Code's own scheduled prompt jobs.** A `scheduled-prompt` row
   comes from this app's own `scheduled_messages`. Anything the CLI schedules for itself has no
   readable store here, so it can never appear in the registry — the row would be an invention.

## Cross-references

- [kanban.md](kanban.md), [plan-runner.md](plan-runner.md) — the other two lanes documented in this
  register, and the same shape of page.
- The contract, declared once: `server/shared/types.ts` (`CRON REGISTRY`) — mirrored in
  `src/shared/types.ts`. The client's two endpoints live in `src/shared/api.ts` (`api.schedules`)
  and nowhere else.
- The door: `server/modules/schedules/schedules-cli.ts`, reached only through
  `/home/lyphe/.claude/scripts/cron-registry-sync`.
