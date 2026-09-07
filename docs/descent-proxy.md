# The Descent proxy

Four routes back the account switcher and the usage meter, mounted under `/api/descent` behind
`authenticateToken` in `server/index.ts`, wired in `descent.module.ts`. Descent answers in snake_case
and this proxy only camelCases it, unwrapping the `{ok, accounts}` / `{ok, usage}` envelope. Nothing
caches here — Descent already does, and a second cache would age its figures a second time.

| Route | Answers |
|---|---|
| `GET …/accounts` | 200 always: the picture, or `{reachable:false, reason}` when there is none. |
| `GET …/usage` | 200 always, the same way. |
| `POST …/accounts/switch` | Body `{slug}`. Descent's own status and body, passed through. |
| `POST …/accounts/capture` | No body. Descent's own status and body, passed through. |

The bodies are `DescentAccounts`, `DescentSlot`, `DescentUsage` and `DescentUsageWindow` in
`server/shared/types.ts`, documented field by field where declared. Read them there, not a copy here.

## Consumers

One: `src/modules/accounts/`. Its `AccountFooterRow` holds the single instance of both hooks, and so
the app's only Descent poller — 60 s for the picture, 180 s for usage, and one extra reading the
moment the panel opens. What the screen makes of each of these bodies, and why an expiry sitting in
the past raises nothing there, is [accounts.md](accounts.md). The four types are mirrored
field-for-field in `src/shared/types.ts` for the client's own use; the declarations above are the
source, and a change to either shape belongs in both files at once.

## The rules that bite

1. **A read never fails.** An unknown picture is a calm 200 `{reachable:false, reason}`, never a 5xx —
   the panel draws em-dashes, not an error wall. `reason` is one of three words — `unreachable`,
   `timeout`, `bad-response` — and they are the ONLY thing ever said about a failure: no Descent body,
   no stack, no URL, no path. A picture is whole or it is none: `ok` is tested rather than trusted, a
   slot with no slug fails the WHOLE read rather than vanishing, and a non-2xx takes that same path.

2. **A write carries Descent's verdict, not ours** — its status and body travel untouched. The two
   substitutions: 422 `{error:'slug is required'}` for a missing, blank, numeric or null slug, refused
   at the route and never sent on; and 503 `{reachable:false, reason}` when Descent gave no verdict at
   all, carrying that one word and nothing else.

3. **Unknown is `null`, never `0`** — `percent`, `expiresAt`, `liveExpiresAt`, `staleSince` and
   `resetsAt` stay null when Descent has none; a 0 draws a bar labelled "0 % used", and an expiry of 0
   reads as expired. `liveSessions` alone is soft: unproven reads 0, "none proven running", a fact the
   row states and never a gate. Units differ — `expiresAt`/`liveExpiresAt` epoch MILLISECONDS,
   `checkedAt`/`staleSince` epoch SECONDS, `resetsAt` an ISO-8601 string, passed through unconverted.

4. **`rolled:true` is not zero.** The percent is REAL but historical, its window since ended, and it
   survives intact: render it dim and label it "was" — draining draws a full tank nobody measured.

5. **`severity` is present only when the vendor flagged that window.** Descent has already dropped the
   benign words, so its mere PRESENCE is the signal, and it may ESCALATE a meter's tone, never soften
   it — a flagged window can read a comfortable 12 % and still mean an account lock.

6. **Three answers are neither a picture nor a failure**, all arriving `reachable:true` with Descent's
   own word intact: `unreadable:true` (its account store would not read — `slots` is `[]`, every label
   null; say so in words, since an empty switcher reads as "you have no accounts"), `windows:[]` with
   `reason:'pending'` (a poll in flight — reading, not broken), and `windows:[]` with `degraded:true`
   (no figures under this account). So `reason` is ours when `reachable:false`, Descent's when `true`.

7. **One knob, one ceiling, no credential file.** `DESCENT_URL` (default `http://127.0.0.1:7878`) and a
   4 s ceiling per call, well under the client's poll interval, so a stalled Descent costs one skipped
   reading rather than a queue of overlapping requests. The account picture arrives over HTTP: nothing
   here opens a credential file, and no token byte enters this process.

## Proving it

`node .verify/phase-12.mjs`, fetch-driven against the running dev server — no browser; see
[verification.md](verification.md). It never calls `capture` and never sends `switch` a real slug —
both would move the operator's live login. The refusal of `__no_such_slug__` is the evidence instead.
