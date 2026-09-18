# The DeepSeek balance report

One route, `GET /api/deepseek/balance`, mounted behind `authenticateToken` in `server/index.ts` and
wired in `server/modules/deepseek/deepseek.module.ts`. It answers the money left on the DeepSeek
account this host's `deepseek-flash` builds spend — a different account from the Claude slots
[accounts.md](accounts.md) describes, at a different vendor, reached by a route of its own. It answers 200 always: a key
this host does not hold, a key the vendor refused, a timeout and an unreadable body are five facts in
words, never an error wall.

It is the SECOND surface on this box built around one credential, and the other is not a route:
`DEEPSEEK_API_KEY` is declared once in `.env.example`, and what puts builds on `deepseek-flash` in
the first place is the switch under **Settings → Agents → Claude**
([plan-runner.md](plan-runner.md) §"The DeepSeek switch"). The switch writes a file the plan runner
polls and never touches the vendor; this route touches the vendor and knows nothing about the
switch. A balance that reads unknown says nothing about whether builds are riding DeepSeek, and the
switch says nothing about whether there is money left to ride it with.

There is now a THIRD place a reader meets DeepSeek here, and it spends no key at all: a soul a
`/dispatch` launched draws a pin among the chat's pinned rows — in the strip above the composer when
the desktop chat gutters are not showing, in the gutter's Subagents widget while they are — wearing
the whale when that soul ran on this account ([dispatch-souls.md](dispatch-souls.md)). It reads a finished launch's own receipt, so it
answers a question neither of the other two can — *did this particular build actually get billed
here* — and it says nothing about the balance or the switch's current position. When DeepSeek
refuses or never answers a soul, it ends having done no work — nothing is re-run on Claude — and the
pin says so on its own line.

The key is the server's alone. The browser never sees it, the response body never carries it, and
nothing on this path logs it — the vendor's own 401 body echoes part of the key back
(`Your api key: ****0000 is invalid`), which is why no vendor error text is ever returned or written
down. What crosses the wire is the figure, and only the figure:

```json
{ "reachable": true, "available": true, "currency": "USD", "total": "12.34", "checkedAt": 1789332005901 }
{ "reachable": false, "reason": "unconfigured" }
```

`DeepseekBalance` is declared under `DEEPSEEK CONTRACTS` in `server/shared/types.ts`, documented
where declared. Read it there, not a copy here. The client mirrors it in `src/shared/types.ts` under
`DEEPSEEK BALANCE`, because two registers on the account surface draw the same body.

## The rules that bite

1. **The key is read on EVERY call, from the environment first and `.env` second — and BOTH halves
   are unquoted at the point of use.** Both are load-bearing, and the mechanism is
   `server/load-env.ts`: it copies every `.env` line into `process.env` once, at process START, so
   the environment carries this key only on a process that booted after it was pasted. The process
   serving this route booted before that, which is the whole reason the file half exists. The
   environment still wins where it is set, so an operator who exports the key over the unit is
   obeyed rather than overruled. **`/proc/<pid>/environ` is not evidence either way**: that file is
   the environment as `exec` saw it, and `load-env.ts` mutates `process.env` after exec, where
   nothing on disk records it.

   The unquoting is not tidiness. `load-env.ts` copies a value **verbatim, quotes included**, and
   it is the thing that fills the half that wins — so `DEEPSEEK_API_KEY="sk-…"`, which is how a
   great many people write dotenv values, would otherwise reach the vendor as `Bearer "sk-…"`, come
   back 401, and be drawn as *DeepSeek refused the API key this server holds*. That sentence is
   false and its only remedy — get a new key — is the wrong one, while the key itself is fine.
   `systemd`'s `EnvironmentFile` strips quotes and `load-env.ts` does not: two parsers, one
   precedence, and normalising at the point of use is what keeps the losing parser's convention
   from deciding what "the key" is.

   **One divergence is known and left standing:** `load-env.ts` keeps the FIRST assignment of a
   name, while this module's file half keeps the LAST (systemd's rule, and the plan runner's), so a
   `.env` carrying two live assignments hands each half a different key and the environment half
   decides. One parser behind both halves is the cure, and it lives in shared bootstrap code every
   module reads — recorded under *What is left standing*, not patched from here.

2. **A `.env` edited while the server runs is seen by the file half and NOT by the environment
   half.** This is the trap that makes the unknown state hard to test: commenting the key out of
   `.env` under a running server changes nothing, because `process.env.DEEPSEEK_API_KEY` was
   populated at boot and the environment is consulted first. To see `unconfigured` for real, a
   process has to BOOT from a keyless `.env` — see *Proving it*. Nothing is cached on this side for
   the same reason: the per-call read is what makes a key pasted into `.env` visible to the file
   half without a restart, and the answer to "why does it still say unknown" must never be a restart
   nobody asked for.

3. **Unknown is never zero, and never an error the reader can act on.** Five words, and each is an
   absence rather than a fault: `unconfigured` (no key in the environment or in `.env`), `auth` (the
   vendor refused the key — the one unknown a person can fix, and *not* `bad-response`, since the
   vendor answered perfectly and said no), `timeout`, `unreachable` (DNS, a refused connection, TLS),
   `bad-response` (a non-2xx that is not a refusal, or a 200 this app cannot read). The client draws
   all five as one em-dash with the words underneath. A `$0.00` where nothing was measured would
   claim the account is empty, which is the one lie a screen about money must not tell. The lock is
   on both sides of the wire: the server calls a **blank** `total_balance` — or a blank `currency` —
   `bad-response` rather than a reading (`isReadableEntry`), because `Number("")` is `0` and an empty
   amount would otherwise reach the screen as a confident `$0.00`; and the client's `moneyInWords`
   answers one that somehow arrives with `null`, which draws the em-dash under the server's own
   `bad-response` sentence — *DeepSeek answered with something this app could not read*. It is the
   same word the server would have used, because a blank amount is exactly that: an answer this app
   cannot read. The two halves differ only in who catches it, and the client's is the one that
   cannot be forgotten by a caller, since it is the TYPE of the figure rather than a string to test.

4. **`available: false` is a READING, not an unknown.** `is_available` is carried through as the
   vendor's own fact about a balance that came back, and the client draws the figure while saying so.
   Folding it into `reachable: false` would hide a number the vendor did give.

5. **Money never goes through a float on this side — server or client.** `total` is the vendor's own
   decimal string, carried through unconverted; the client formats it only when it is a plain decimal
   AND short enough that a `Number` holds it exactly (fifteen integer digits), and draws it verbatim
   otherwise — `1e3`, `0x10` and `12345678901234567890.99` all arrive on screen as they left the
   vendor, because `Number` would print the last of them as `$12,345,678,901,234,567,000.00`. A
   currency this app has no symbol for keeps its code beside the figure (`1,234.50 SEK`) rather than
   a guessed symbol.

6. **`balance_infos` is read strictly, as a whole.** Every entry must carry a non-blank `currency`
   and a non-blank `total_balance`, or the answer is `bad-response` — filtering a malformed row out
   could leave a CNY figure standing in for the USD one. USD is preferred where the account holds
   more than one currency, the first entry otherwise, and an EMPTY list is `null`: with no entry
   there is no currency and no amount, so there is no reading at all.

7. **Five seconds, and one abandoned request.** `AbortSignal.timeout` rejects with a `TimeoutError`
   that maps to `timeout`; every other rejection is `unreachable`. The ceiling is far longer than the
   endpoint takes when it answers (measured ~0.3 s end to end through this route) and far shorter
   than the client's own request ceiling, so a hung vendor degrades to the calm unknown before the
   screen gives up on the whole request.

8. **Nothing is persisted and nothing is cached.** No column, no migration, no file: a reading is
   true for the request that carried it. `checkedAt` is epoch MILLISECONDS (`Date.now()`), unlike
   `ClaudeUsage.checkedAt`, which is seconds.

## The client's one reading

`src/modules/accounts/hooks/useDeepseekBalance.ts` is the only place in the app that reads the route.
It polls every 180 s — the usage cadence, deliberately, since both are slow provider-owned facts —
and `AccountFooterRow.togglePanel` forces a fresh reading on open (on OPEN only: closing the panel
reads nothing), because the balance is the figure a person opens the panel for and a number that only
moves on a timer reads as stale at exactly that moment.

Two bounds make that trigger safe to press. A read that finds a request already on the wire JOINS it
rather than starting a second, so a vendor sitting on its five-second ceiling never has them stacking
in flight; and a read that lands within **five seconds** of the last one is refused outright, so the
panel's own habit — toggling it while thinking — is free rather than one vendor call per press
(measured: ten open/close cycles used to spend ten calls and now spend none, while a press six
seconds later still reads and still draws a newer figure). Five seconds sits far below the time it
takes to close a panel and reconsider and far above the vendor's own ~0.3 s answer. The floor bounds
ATTEMPTS rather than successes: a read that failed counts as one, so a route answering nothing costs
a press no more than a route answering everything. The age line under the figure is what makes the
skipped read honest — it says when the figure on screen was taken, which is the difference between a
fresh number and one that merely looks fresh.

Nothing the route can answer is stored unexamined: a non-200 is never a reading, and a 200 whose body
is not the contract is thrown away rather than kept (`isBalanceReport`). A throw from the request
becomes `{ reachable: false, reason: 'unreachable' }`, which is the same "no reading" the server's
own body would have carried. All three paths exist because of what sits in front of the route:
`authenticateToken` answers an expired session with a JSON error, and a proxy answers a bad gateway
in JSON too.

The row owns the ONE instance and hands the same reading to both registers it draws, so they can
never disagree and opening the panel starts no second poller:

| Where | Register |
| --- | --- |
| `AccountFooterRow`, under the account name beside the usage meters | `inline` — `DeepSeek $12.34`, or `DeepSeek —` |
| `AccountPopover`, between the meters and the switcher | `stacked` — label, figure, and the line under it |

Both carry the full sentence as their accessible name and their `title`, so the row can abbreviate
without the meaning being lost — including *read at 13:43*, which only that sentence can carry where
the row has no room for a second line. The panel draws the same age as its own faint line where the
figure has nothing else to explain: the panel is where someone checks the money after something
stopped, and a frozen tab would otherwise hold a five-minute-old number that looks fresh.
`DeepseekBalanceReadout` is deliberately not a `Meter` — a balance has no limit to be a share of —
and it is the one component this feature added rather than composed from what was there.

## The rate beside the balance

DeepSeek bills two rates. Peak is 01:00–04:00 and 06:00–10:00 UTC, Monday through Friday; every
other hour, and the whole weekend, is off-peak and costs HALF as much, for every model and token
type. The rule lives once, in UTC, in `src/shared/deepseekPeakHours.ts` —
`deepseekPeakStatus(now)` answers whether the peak rate is on and the instant that changes — and is
turned into the reader's own clock only where it is drawn, so daylight saving moves the words and
nobody edits them (Pacific reads `Sun to Thu, 6 PM to 9 PM` and `Sun to Thu, 11 PM to 3 AM` in
summer, an hour earlier in winter).

Two surfaces wear it, off that one rule. `DeepseekPeakHours` sits directly under the balance in the
account panel: a badge — green `Off-peak — half price`, amber `Peak — full price` — then a line saying
until when, and the full-price hours one per line, re-read on the panel's minute tick. And the
composer's Flash chip (`ComposerDeepSeekSwitch`) takes the same tone as its outline, in both
positions of the switch, with the rate as the first sentence of its tooltip: the warning is on the
control that would spend the money. The chip re-renders through `useRateChangeTick`, one timer set
to the next boundary, not a minute tick — the colour changes four times a day. When DeepSeek moves
its hours, `PEAK_WINDOWS_UTC` is the one line to change.

## What is left standing

- **No `.verify/` phase script covers this route.** The repo's other modules are proven by
  `phase-NN.mjs`; this one was proven by the run that built it, and the procedure is written out
  below instead of being pinned as a script. Nothing re-measures it on a later pass.
- **Two parsers, one key: the duplicate-assignment divergence.** `server/load-env.ts` keeps the FIRST
  assignment of a name, this module's file half keeps the LAST (systemd's rule, and the plan
  runner's), and the environment half wins — so a `.env` carrying two live `DEEPSEEK_API_KEY` lines
  hands the route whichever one that bootstrap saw and the plan runner the other. One parser behind
  both halves is the cure; it lives in shared bootstrap code every module reads, which is a change
  of a different size to this module's.
- **The balance is the HOST's, and every signed-in user sees it.** The key lives in the host's
  `.env`, the route is scoped to `authenticateToken` and no further, and nothing on screen says the
  figure is the host's rather than the account named directly above it. Correct for a single-operator
  box and worth knowing on a multi-user one.
- **The client's copy of the reason words is a second list.** The five server words are spelled again
  in `DeepseekBalanceReadout.UNKNOWN_REASONS`; a sixth added on the server draws the quoted fallback
  — *the balance could not be read (…)* — which is visible and honest, but it is a list that can
  drift.
- **Only one currency is ever shown.** An account holding USD and CNY shows the USD figure and says
  nothing about the other; there is no total and no picker.
- **`available: false` has never been seen live.** The vendor only says it for an account it will no
  longer serve, which no run may arrange on the operator's own account, so that sentence is proven by
  its shape and not by a reading. The same goes for a multi-currency account: this one holds USD
  alone, so the preference for USD over the first entry is unexercised.
- **The route is authenticated but not rate-limited.** Any signed-in caller can hit it as often as
  it likes, and each call spends one vendor request. The floor lives in the client, not on the route
  — this app bounds itself to one read in flight and one per five seconds, and a second tab, a curl
  or any other caller is answered as fast as the vendor answers.
- **A vendor that answers 200 with a body it cannot read is indistinguishable from one that answers
  500.** Both are `bad-response`, and neither is logged anywhere — deliberate, since the vendor's
  refusal text carries part of the key, but it means a real shape change is a silently calm em-dash.
- **The balance is not in the collapsed rail.** The rail draws the avatar alone; the figure is one
  click away, in the expanded row and the panel.
- **The type register is composed by VALUE, not by class, so it can drift silently.** The stacked
  form restates Verve's meter register in Tailwind — `text-[13px] font-medium text-foreground`,
  `text-[12.5px] tabular-nums text-muted-foreground`, `text-xs text-ink-faint` — against
  `.vv-meter__label` / `__value` / `__sub` in `src/shared/ui/verve/controls.css` §Meter. Both sides
  agree today — the sizes are the same three numbers, and `foreground` / `muted-foreground` /
  `ink-faint` resolve to the same `--ink` / `--ink-muted` / `--ink-faint` those rules name
  (`tailwind.config.js`), confirmed in the live DOM in both themes. They are two copies of one
  decision:
  re-size the meter's label there and this line stays where it was, with nothing failing and
  nothing to read but the two surfaces side by side. The cohesive cure is a track-less register in
  the library that both compose.

## Proving it

1. **The route, with a real login token.** `curl -s http://127.0.0.1:3011/api/deepseek/balance -H
   "Authorization: Bearer <token>"` against the running dev server, with a token minted from the real
   `auth.db`. Answers 200 with the five fields and nothing else; the same URL without the header
   answers 401.
2. **The screen, in the live client.** Headless Chromium on `http://127.0.0.1:5183/` with the token
   in `localStorage['auth-token']`, reading `[data-account-row]` and `#account-panel` — the figure
   appears under the account name beside the meters, and again in the panel.
3. **The unknown, exercised for real — and it must be exercised this way.** Comment the key out of
   `.env`, then let the process BOOT from that file (the dev supervisor reboots the child on any
   write under `server/`; `touch server/index.ts` is enough). Only then does the route answer
   `{"reachable":false,"reason":"unconfigured"}`, and only then does the screen draw `—` with
   *no DeepSeek API key is set on this server* under it. Editing `.env` under a running server
   proves nothing — rule 2 above is exactly why.
   **Never let the file reach a terminal.** `grep`, `cat`, `sed -n` and a diff of `.env` all print the
   credential into whatever is recording the session, and a masking regex is one commented line away
   from missing the line it was written to hide — which is exactly how this key ended up at rest in a
   run log. Count what you need instead of printing it (`grep -c '^DEEPSEEK_API_KEY='`), edit with
   `sed -i` (silent), and verify the restoration with a checksum, which is what step 4 does.
   **If it happens anyway, the cure is rotation and not deletion.** The copy in a run log can be
   overwritten in place at its exact byte offsets (same length, same inode, so an appending writer
   keeps its offset), and the copy a live session directory holds can be treated the same way — but
   a session transcript under `~/.claude/projects/` is the operator's own record of their own work,
   no run may rewrite it, and every copy of a value that has been read is still the live credential
   until it is rotated at the vendor. Purge what the run wrote; name the rest.
4. **Restore, and re-read.** The key goes back, the process reboots from the restored file, and the
   route answers the real balance again. The restored `.env` is byte-identical to the one the run
   found: `md5sum -c` against the checksum taken before the first edit.
5. **The vendor-body table, against a local fake.** Point `createDeepseekService` at a port this run
   owns — the module takes its URL as a dependency for exactly this — and answer one shape per
   request: a blank `total_balance`, a blank `currency`, an amount that is a number rather than a
   string, an empty `balance_infos`, one good entry beside one bad, `is_available: false`, nineteen
   integer digits, 401, 500, and a 200 that is not JSON. Every one of them must come back as the
   reading or the word the table above promises, and none of them touches the operator's account or
   the key. This is the seed for the `.verify/` script this route does not yet have.
6. **The quoted-key case, without touching the vendor's account.** Boot a throwaway process that
   mounts `createDeepseekModule()` on a spare port with `DEEPSEEK_API_KEY` set to the QUOTED form of
   the real key — precisely what `load-env.ts` produces from `DEEPSEEK_API_KEY="sk-…"` — and read the
   route: it must answer the real balance. It answered `{"reachable":false,"reason":"auth"}` before
   the unquote went in on the environment half, and no restart of the dev server is needed to prove
   it, since nothing here touches the unit's own key.
