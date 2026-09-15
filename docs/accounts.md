# The account switcher

The foot of the sidebar: which Claude account signs the next request, how much of its windows that
account has spent, what is left on the DeepSeek account this host's builds spend, and the two writes
that change the first of those. `src/modules/accounts/` is `AccountPopover` (with `UsageMeters`, its
own `AccountRow`, and `DeepseekBalanceReadout`) under the one `AccountFooterRow` its barrel exports,
with `hooks/useDescentAccounts` holding the picture and the writes, `hooks/useDescentUsage` holding
the readings, `hooks/useDeepseekBalance` holding the balance, and `utils/accountInitials` drawing the
two letters on the avatar. Everything but the balance comes from Descent: the server half of those —
the four accounts routes, the null discipline, the units — is [descent-proxy.md](descent-proxy.md),
which now carries a second lane this screen does not use. The balance does not, and its own server
half is [deepseek-balance.md](deepseek-balance.md).

**Two origins, one panel.** The balance is not a third Descent window and not a second reading of the
same account — it is a different account, at a different vendor, reached by a route Descent never
touches. So the panel draws it OUTSIDE the branch that replaces the meters when Descent is
unreachable, and a Descent outage cannot take the money down with it. The two also fail in opposite
directions: Descent is local and this route goes out to api.deepseek.com.

**One row, one poller.** `SidebarFooter` renders `AccountFooterRow` above Settings and
`SidebarCollapsed` renders the same component as the rail's avatar, and never both at once. That
mutual exclusion is the whole design: all three hooks live inside the row, so the app holds exactly
one Descent poller and one balance poller no matter how often the panel is opened or the sidebar
collapsed. The row hands its ONE balance reading to both registers it draws, so the line under the
account name and the block in the panel cannot disagree.

## What the footer row says

The avatar's initials come from the local part of the active label and nothing else — everyone here
shares a domain, so a domain letter hides identity rather than carrying it. The label sits beside
it, truncated, with the full address in a `title`. Under the label are the two windows worth a
glance, as inline `Meter`s: the `five_hour` and `seven_day` windows, each labelled with its reset
countdown where Descent gives one and with `5h`/`7d` where it does not, and `usage —` on the line
instead when neither window is in the reading. A window absent from the reading draws no bar at all;
a window present with `percent: null` draws an empty track and an em-dash, which is the one honest
picture of "nobody has this number".

Under those, in the same column, is the DeepSeek balance — `DeepSeek $12.34`, or `DeepSeek —` where
there is no reading. It draws while the meters are unknown too, because the two sources fail
independently. The `▼` is decoration; the row itself is the button, and it carries
`aria-haspopup="dialog"` with `aria-controls` pointed at the panel while it is open.

With no picture the label is `—` and the avatar is muted. Collapsed, the same component draws the
avatar alone under an `Account <label>` label, and a click opens the sidebar rather than a panel
there is no room for.

## What the panel says

A `Card` with `role="dialog"`, anchored `bottom-full` above the row, capped at `70vh` and scrolling
from a top edge the reader can see. Usage first, the DeepSeek balance under it, the switcher below
both.

| Descent answered | The panel draws |
|---|---|
| a picture with slots | the meters, `Switch account · N`, the date line, one row per slot, `+ Add another account` |
| `unreadable: true` | the count reads `0` and no rows follow, under *Descent answered, but it could not read its saved accounts — none can be listed.* — said in words, because an empty switcher otherwise reads as "you have no accounts" |
| `reachable: false` | *Descent is not reachable — accounts and usage are unknown.* in place of the meters, the count as an em-dash, no rows and no add button |
| nothing yet | the meters draw an em-dash and the count reads `—`; the first reading normally lands before anyone opens the panel |

The balance block renders in EVERY one of those rows, including `reachable: false` — it is drawn
from a different origin, so it stands where the meters cannot. It is
`DeepseekBalanceReadout` in its `stacked` register: *DeepSeek balance* on the left, the figure on the
right in the same type the `Meter`'s value uses, and one faint line under it — the reason, where
there is one: *Balance unknown — no DeepSeek API key is set on this server.*, *…DeepSeek refused the
API key this server holds*, *…DeepSeek did not answer in time*, *…DeepSeek could not be reached*,
*…DeepSeek answered with something this app could not read*. With nothing to explain the line is
*Read at 13:43*: a healthy figure still owes its age, because the panel is where someone checks the
money after something stopped, and a frozen tab would otherwise hold an old number that looks fresh.

It is deliberately NOT a `Meter`. Every other reading on this surface is a share of a limit, and the
`Meter`'s whole business is the bar that share is drawn on — a balance has no limit to be a share OF,
so a bar over money would have to invent the ceiling it is measured against. It is a component of its
own for exactly that reason: `UsageMeters` draws windows, and this is not one.

Every non-active slot is one button carrying its slug — the whole row, since there is no second
control on it to nest. The account in use is not a button at all: it carries a `✓` glyph, its own
tint, and `in use now · N sessions running` (or `· none proven running`, which is a fact the row
states and never a gate). Under every other row is `Saved copy expires`/`expired <local date>`, and
`—` where Descent never read one.

Two closing lines render only where there is something to switch between: the date line above the
rows, and the reassurance below them — *Switching changes only which account signs the requests.
Your projects, conversations and running work stay exactly as they are — open conversations keep
their history and resume on the new account.* Codex is deliberately absent; these are the Claude
slots Descent holds, and Codex stays in Settings → Agents.

## The usage meters

`five_hour` reads *Current 5-hour window* and `seven_day` reads *This week*. Everything else keeps
Descent's own label, which is the only place a `weekly_scoped:*` plan is ever named.

| The window said | The meter draws |
|---|---|
| `percent: 42` | "42% used" over a bar at 42 |
| `percent: 0` | "0% used" over an empty track — a real reading, not an absence |
| `percent: null` | "—", no fill at all, and no `aria-valuenow` |
| `percent ≥ 80` | amber, the library's `▲`, and *Running heavy* in words under the bar |
| `severity` present | amber at any percent — a flagged window can read a comfortable 12 % and still mean an account lock |
| `rolled: true` | the real percent, dimmed, as "was 36% used" — draining it would draw a full tank nobody measured |
| `degraded: true` | the last figures at 60 % opacity under *As of \<local time\> — \<why\>.* |
| `windows: []` + `reason: 'pending'` | *A fresh reading is on its way.* — reading, not broken |
| `windows: []` + `degraded` | *No figures are available under this account.* |
| `reachable: false` | *Usage is unknown — \<the proxy's own word, in English\>* |

A window with a `resetsAt` also says when it turns over, counted in hours inside a day and in
weekdays past one. The block closes with the sentence that makes a blank bar readable: *Figures come
from the provider and can lag a few minutes. A blank reading means unknown, never zero.* There is no
flexible-spend bar — Descent reports no such window, and a third bar reading "—" would invent a
limit nobody set.

## The two writes

**Switching.** A row press sends its slug and, on Descent's yes, raises a positive toast: title
`Switched to <label>`, message *Running conversations finish on the account they started with. New
messages use \<label\>.* That is the honest sentence rather than the comfortable one — the swap is
whole-box, and a session already running keeps the tokens it holds in memory. On Descent's no, the
panel shows a warn `Banner` carrying **Descent's own words** whenever it sent any; only a proxy-level
`{reachable:false, reason}` is translated here (*Descent did not answer in time.*, *Descent answered
with something this app could not read.*, *Descent is not reachable.*).

**Capturing.** `+ Add another account` saves the login that is live now *before* the CLI can replace
it, then opens `ProviderLoginModal`, which runs the provider's own `/login` in an embedded terminal.
Closing the modal captures a second time — and only when the login command exited cleanly. Either
capture raises `Saved <label>` (or *Saved the login that is live now* when Descent named no slug)
with the message *It is now the account in use.*: Descent's capture is not a snapshot only, it also
re-points its active account at whatever it just saved.

**Drift.** When Descent reports the live login differs from its saved copy, a warn `Banner` names
both — the one in use and the one *Save it* would adopt — and `Save it` is the same capture.

## The rules that bite

1. **The date on a row is the age of a saved copy, and never an alarm.** Descent calls `expiresAt`
   "a freshness clock, not a secret" (`account_store.py::_read_expires_at`) — the provider's expiry
   inside the COPY it holds, read from that slot's own file — and raises no warning from it anywhere
   in its own switcher. A docked slot's stamp is normally in the past, and is in the FUTURE for
   hours after a switch, because `install()` snapshots the OUTGOING login into its own slot before
   copying the target over live. So there is no "sign in again" line and no inline sign-in button
   here: an alarm that is always on is not an alarm. The panel states what the date IS, once, above
   the rows — where it has to be, since every row below carries the phrase it disarms.

2. **Unknown is an em-dash, never zero.** `percent: null`, a missing `expiresAt`, an absent picture,
   a balance the server could not read: each draws `—`. A `0` is a reading and says so. A bar at
   zero, a footer reading `0%`, or a `$0.00` where nothing was measured, would claim something the
   app does not know — and on the money line it would claim the account is empty.

3. **Warn is a floor, never a ceiling.** `severity` is present only when the vendor flagged that
   window, so its presence alone forces amber; the 80 % threshold can only add to it. The percent is
   rounded ONCE, and the figure, the tone, the fill and `aria-valuenow` all read that one integer —
   a raw 79.6 used to print "80% used" over a calm green bar.

4. **Escape marks the event; it does not stop it.** The panel closes on a window-level CAPTURE
   listener that calls `preventDefault()` and nothing else. `ChatInterface` aborts a running turn
   from a document-level capture listener gated on `defaultPrevented`, and window-capture runs
   first — so closing this panel mid-run no longer kills the run. `stopPropagation()` is
   deliberately absent: this panel is not modal, an overlay opened over it sits in front, and
   stopping the key at the earliest point took it away from the very thing the reader was looking
   at.

5. **A switch is unguarded by a dialog; a second write is not.** The soft gate is the fact on the
   row — *in use now · 8 sessions running* — rather than a modal. What is refused is a write while
   one is in flight, read from a ref rather than from `busy`, since a render value lands too late to
   stop a second press in the same tick.

6. **A capture is never free at the far end.** It rewrites both slot files, appends an audit row and
   repaints every Descent client, so the second capture is gated on the login command's exit code
   rather than on the bare fact that it exited. A modal opened and closed without signing in, and a
   login the operator cancelled, both leave the store untouched.

7. **A refusal describes one attempt.** The inline banner clears when the next write starts and when
   the panel closes; one left standing would greet the next person who opens it.

8. **The floors are 60 s, 180 s and five, and opening the panel is worth two readings.** The picture
   is re-read every minute, and usage and the balance every three, because both move slowly — usage
   comes through Descent's own cache, and money moves on the scale of a build. `togglePanel` forces
   a fresh reading of BOTH on open — on open only, so a close costs nothing — so what a person looks
   at is current without paying for it every minute. The balance is the one a person would otherwise
   check twice by hand: a figure that only moves on a timer reads as stale the moment it is the
   number you opened the panel for. It also carries a five-second floor of its own
   (`useDeepseekBalance`), because the row is a button pressed while thinking and each press would
   otherwise spend a vendor call; a skipped read is not invisible, since the age line under the
   figure says when the figure was taken.

## What is left standing

- **The balance under the account name is not that account's.** It is the HOST's DeepSeek account —
  one key in this box's `.env`, one figure — and the route is scoped to `authenticateToken` and no
  further, so a second person signing in reads the same number under THEIR name and nothing on
  screen says whose it is. Correct for a single-operator box, worth knowing on a shared one; the
  server half is [deepseek-balance.md](deepseek-balance.md) §"What is left standing".
- **`ProviderLoginModal` has no Escape handler.** It is a plain fixed overlay rather than the
  library `Dialog`: this panel's own dismissals stand down while it is up, and nothing takes their
  place, so an Escape there reaches `ChatInterface`'s abort gate unmarked and would end a turn
  running behind it. It neither traps focus nor hands it back on close either. Pre-existing and
  shared with that modal's other callers — a follow-up outside this module.
- **One Escape dismisses the frontmost overlay AND this panel behind it.** Marking rather than
  stopping is what lets the overlay have its key; the panel's own handler still fires on the same
  event. Measured, and the lesser of the two costs.
- **The exit-code gate is pinned as source text.** Driving it needs a real failed login against the
  operator's own account, which no run may spend, so `phase-13.mjs` asserts the shape of the
  `onComplete` handler instead of its behaviour.
- **Capture-on-success rides the terminal's exit-line scrape.** `useShellConnection` matches
  `Process exited with code (\d+)` in the shell's own output; a login whose exit line never prints
  captures nothing. It self-heals rather than losing anything — Descent then reports `drift`, and
  the banner's *Save it* adopts the live login.
- **The avatar hue is positional.** The footer always draws hue 0 and the panel indexes by row, so
  the same account can carry one colour in the footer and another in the list.
- **The panel scrolls to its actions.** Usage renders above the switcher by the plan's own step
  order, and the panel grows upward into the space above the row, so at the harness's 1440 × 900 the
  rows are all on screen and `+ Add another account` is reached by scrolling — recorded as a
  `[NOTE]` rather than gated, since it is an ordering question this phase neither created nor
  settles. No run measures a shorter viewport, and none measures the mobile drawer width.
- **Two live addresses draw the same `SD`.** A property of the addresses, not of the rule; the
  mitigations are the per-row hue and the full address in a `title` on every label.
- **Nothing marks the panel inert while the login modal covers it.** Both dismissals stand down so
  the write's banner survives, but the panel keeps its own focus order behind the overlay.
- **Two library gaps, left in the library.** `Banner` carries no `role` or `aria-live`, so a refusal
  is not announced; `Meter` emits `role="meter"` with no `aria-valuenow` on a null percent, which is
  correct-by-omission but reads as an incomplete widget to a strict validator.
- **Lint reads one of this class, on the sibling.** `useDescentUsage.ts:44` carries a
  `react(set-state-in-effect)` on its mount fetch — the shape this repo's other pollers already
  have, and the module's only finding. The balance hook beside it, of the same shape, reads clean.
  The repo reads 129 warnings and 0 errors, one fewer than before this pass, and nothing here added
  a class.

## Proving it

`node .verify/phase-13.mjs`, headless Chromium against the running dev server. The dark pass reads
the screen against Descent and stops there; the light one carries the rest. It never presses the
Switch of another slot and never presses *Save it* — either would swap the
operator's whole live login mid-run — and it never logs in: the login modal is opened by its own
title and closed without typing. Everything the operator's own Descent can answer is read live
through the proxy; everything it is not doing today — `percent: 0`, a null, a rolled window, a
flagged one, a degraded reading, four shapes of expiry, drift, and a Descent that is down — is
replayed into the two READS in the browser, touching no server and no account. Shots are
`13-footer`, `13-popover`, `13-popover-unreachable` and `13-rail`. See
[verification.md](verification.md).

**The balance line is on those shots and in none of those gates.** `phase-13.mjs` predates it and
asserts nothing about it, so the standing gate would stay green if the figure vanished from both
registers. Its own procedure — the route with a real token, the unknown exercised by BOOTING from a
keyless `.env`, and the vendor-body table against a local fake — is
[deepseek-balance.md](deepseek-balance.md) §"Proving it", and it is written out there rather than
pinned as a script. Note also that opening this panel is now an outbound vendor call from the
server: a probe that needs the figure to be a known value answers `/api/deepseek/balance` with
`page.route`, never api.deepseek.com, which no browser-context stub can reach.
