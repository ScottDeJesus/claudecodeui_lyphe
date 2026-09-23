# The API tab

The workspace tab that answers what the house spends on the third-party services it asks — a Jev
view and a DeepSeek view, one sub-tab each. The tab id moved from `jev` to `api` on 2026-09-22: no
surface carries a `jev` tab id any more.

## What the tab holds

| Piece | Home |
| --- | --- |
| Tab entry | `WorkspaceTabs.tsx` — `API_TAB: BuiltInTab = { id: 'api', labelKey: 'tabs.api', icon: Coins }`, in `houseTabs` |
| Panel | `src/modules/api-tab/ApiPanel.tsx`, re-exported lazily by `src/modules/api-tab/index.ts`; rendered for `activeTab === 'api'` in `WorkspaceMain.tsx` |
| Views | `JevPanel` (`@/modules/jev`) and `DeepseekUsagePanel` (`@/modules/deepseek-spend`), each imported through its module's `index.ts` |
| Command palette | `CommandPalette.tsx` `{ id: 'api', label: 'Go to API', … }`; `ProjectCommandPalette.tsx` lists `'api'` among its `tabs` |

- Sub-tab ids are `jev` and `deepseek`; their labels come from the `api.subtabs` map in
  `src/modules/i18n/locales/en/common.json` — `jev` reads "Jev", `deepseek` reads "DeepSeek".
- `ApiPanel` mounts ONLY the chosen view. Roots: `data-api-panel` on the panel, `data-api-subtab="<id>"`
  on the body.
- The choice persists in `localStorage['apiSubTab']`, read through `isApiSubTab` — which accepts
  exactly `jev` and `deepseek`, and answers `jev` for anything else (including a failed read).
- **The stored-`jev` migration.** `useProjectsState.ts` `readPersistedTab` maps a stored
  `activeTab === 'jev'` to `'api'` before `isValidTab`; `VALID_TABS` holds `'api'` and not `'jev'`.
  This is the ONE alias kept — a browser's old tab id, turned into the new one at read.

## Where each DeepSeek number comes from

One chain; no TypeScript file reads a transcript, the ledger or a state record:

```
hooks/deepseek_usage.summarize(range, feed, now)   →   scripts/deepseek-usage stats --json   →   GET /api/deepseek/usage   →   useDeepseekUsage
```

- `hooks/deepseek_usage.summarize` (`reader.py`) is the whole payload; `deepseek-usage stats --json`
  prints it verbatim, so the CLI screen, the JSON door and the panel cannot disagree about a number.
- `GET /api/deepseek/usage?range=&feed=` (`server/modules/deepseek/deepseek.routes.ts`) validates
  `range` ∈ `today|7d|30d|all` and `feed` an integer 0..500, else 400. The service
  (`deepseek-usage.service.ts`) runs `scripts/deepseek-usage` through `execFile` — an argument array,
  never a shell — and relays the JSON; `unreachable` → 503, `unreadable` → 502.
- `useDeepseekUsage.ts` calls `api.deepseek.usage(range, 50)` every `DEEPSEEK_USAGE_POLL_MS` (10 s)
  while the tab is visible, and at once on a range change; a failed poll keeps the last good reading.

The DeepSeek view is six sections in this order, each a `JevSection` and each root carrying
`data-deepseek-section="<key>"`, under `data-deepseek-usage`:

| Section | Draws |
| --- | --- |
| `burn` | the vendor's balance reading, spend at `today`/`7d`/`all` (per-row `usd` leading, peak-list beside each), the 14-day bars, the pricing line, any unpriced model |
| `consumers` | the top consumer's headline (`data-deepseek-top`), the range pills, the kinds strip, the `(kind, name)` table |
| `where` | roles, models, souls, per-column tokens, the endpoint, the range's outings |
| `feed` | the newest outings, newest `last_at` first |
| `switches` | the three read-only mirrors |
| `recon` | the ledger against the vendor's balance |

## The ledger — what a number is

- Ledger file `~/.claude/state/deepseek_usage/ledger.sqlite` (override `DEEPSEEK_USAGE_DIR`, read at
  call time). Transcript roots `~/.claude/projects` and `~/.claude/runner-sessions` (override
  `DEEPSEEK_USAGE_ROOTS`), walked recursively for `*.jsonl`; one `flock` on `sync.lock` serializes a sync.
- **No column holds a dollar figure.** A message row stores its five token columns and `peak` —
  whether its `ts` landed in a peak window (`deepseek.peak_until`). Dollars are computed at READ, so a
  corrected `costs.PRICES` tuple reprices the whole history on the next read instead of disagreeing
  with a stored figure.
- Two feeders fill it: `scripts/runner_transcripts.py` hands a moved run's transcripts to
  `deepseek_usage.sync` before `prune` deletes them (`run` feeds both roots on the hourly tick), and
  CloudCLI's own server records a balance reading through `deepseek-usage balance-record`.

## Outings and attribution — the rules live in `hooks/deepseek_usage/attribute.py`

- An OUTING is one stretch of one session file between real prompts: `outing = f"{session_id}#{segment}"`,
  `segment` 0-based. No two transcript files ever share an outing key.
- **A subagent transcript is its own outing.** A file under `/subagents/`, or rows carrying
  `"isSidechain": true`, gets `session_id = "agent-" + agentId` and `parent_session = the row's
  sessionId`, and its `soul` is the `agentType` of the sibling `agent-<agentId>.meta.json`. It is
  resolved BEFORE the four rules and never against its own id: it inherits `kind`, `name` and `run_id`
  from what its PARENT session belonged to, and keeps its own soul and `role = "subagent"`. A parent
  session that spent no DeepSeek has no outing to inherit, so the rules run against the parent's id,
  then the subagent's own cwd.
- Four rules name an outing, and the FIRST that answers wins — `dispatch` (a
  `state/dispatch-souls/*/result.json` naming the session), `runner` (a brief `label`, or the
  `run.json` naming the session), `wave` (a scout wave the session id is booked against), `session`
  (the cwd slug; `probe` when the cwd is under `/tmp/`, else `chat`).
- Rules 1–3 freeze the row at once; rule 4 waits 48 h of idle, so a dispatcher's `result.json` —
  written when its child ends — still claims its outing.
- Scout waves are named from the `scouts` rows booked into `state/plan_costs/*.json`
  (`hooks/plan_runner/costs.py` `record_wave`, the durable record), and from
  `state/scout-waves/*/wave.json` for a wave whose plan has not launched yet. The wave id is the row's
  `ref`; the reader is `hooks/deepseek_usage/records.py`.

## Pricing — per window, computed at read

- Rates come from `costs.PRICES`, the off-peak factor from `deepseek.OFF_PEAK_FACTOR`, the peak test
  from `deepseek.peak_until`, the usage columns from `costs.usage_columns`. No second rate table, no
  second peak table, no literal `0.5` outside `deepseek.py`.
- `price.row_price(model, cols, peak) -> (usd, usd_list)`: `usd_list` is the PEAK list price
  (`costs.price`); `usd` is `usd_list` at peak and `usd_list * OFF_PEAK_FACTOR` off-peak.
- Chinese public holidays are NOT modelled (`hooks/plan_runner/deepseek.py`): a holiday weekday prices
  as peak.
- **A receipt prices a DeepSeek child HERE too, since 2026-09-23.** `costs.result_cost` sends a child
  through `row_price` at the window it ran in (`vendor_price`, `hooks/plan_runner/costs.py`), so a run
  receipt, a chain stage and a heal row carry this ledger's own figure for the same tokens — not the
  peak list rate, and never the CLI's `modelUsage` row, which is cumulative session arithmetic rather
  than the billed delta. Measured over the eighteen DeepSeek outings of 2026-09-23's six heal chains:
  the old recipe read $4.149158 where the ledger bills $1.201426596. `usd_list` is what `usd` would
  have been had every hour of the row been peak; the panel leads with `usd` and shows the list figure
  small beside it, as the reference rate the window's own dollars were halved from.

## The reconciliation — and the two parts of its gap

`recon.py` walks the USD balance readings in order and reads their consecutive pairs:

- a pair at most **900 s** apart whose balance FELL is spend, credited to the later reading's hour —
  that hour is COVERED; the same pair RISING is a top-up, never negative spend;
- a pair farther apart than 900 s says nothing about one hour, so its fall is `unassigned_usd` — a gap
  the readings cannot close, not a drop to hide.
- `ledger_usd` sums the per-row `usd` of covered hours only; `gap_usd = balance_usd - ledger_usd` over
  covered hours; an uncovered hour's `balance_usd` is null. A non-USD currency nulls every balance figure.

Two KNOWN parts of the gap:

| Part | Cause |
| --- | --- |
| Tool-side calls | A transcript carries the assistant model's messages only, so an outing's internal Haiku spend is invisible to the ledger (the measured ~0.5% note in `hooks/plan_runner/costs.py`). |
| Readings > 900 s apart | Balance that moved between two readings more than 900 s apart is `unassigned_usd`, not spend the ledger can compare against a stamped hour. |

## The switch mirrors — read-only

`DeepseekSwitches.tsx` reads the three existing hooks and nothing else: no setter of any of them is
referenced anywhere in `src/modules/deepseek-spend/`, so no press here can flip a switch. An
unreadable switch is its own amber word, never a guess at `off`.

| Row | Hook | Where it IS changed |
| --- | --- | --- |
| chat | `useDeepSeekFlashSwitch()` — `enabled`/`unreadable` | Settings → Agents → Claude (and the composer chip) |
| heal | `useHealModelSwitch()` — `position`/`unreadable` | the Heal tab |
| swarm | `useSwarmSwitch()` — `enabled`/`lanes`/`unreadable` | Settings → Agents → Claude |

The caption states the same split: *Settings changes the chat and swarm switches; Heal changes the
heal model.*

## Proving it

The harness is `.verify/lib/console.mjs` — headless Chromium against APP `:5183`, API `:3011`,
`DEV_USER verve` (`openConsole`, `openTab`). The probe
(`/tmp/api-tab-probe/shot.mjs`) drives it:

1. `openTab(page, 'API')` — the tab opens.
2. `openTab(page, 'Jev')`, then wait for `[data-jev-panel]` — the Jev view is live inside it.
3. `openTab(page, 'DeepSeek')`, then wait for `[data-deepseek-section="recon"]`; count
   `[data-deepseek-section]` → **6** (burn, consumers, where, feed, switches, recon);
   `getByText('Sample numbers')` → **0** — the sample notice is gone.
4. `[data-deepseek-top]` carries the top consumer's name.

The runner's verify drives exactly this as `node /tmp/api-tab-probe/shot.mjs goal`, expecting the tail
`api=ok jev=ok deepseek=6 sample=0`.
