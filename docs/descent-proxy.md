# The Descent proxy

Eight routes in two lanes, mounted under `/api/descent` behind `authenticateToken` in
`server/index.ts`, wired in `descent.module.ts`: four back the account switcher and the usage meter,
four back Descent's memory-intake review queue. Descent answers in snake_case and this proxy only
camelCases it, unwrapping the `{ok, accounts}` / `{ok, usage}` / `{ok, candidates}` envelope. Nothing
caches here — Descent already does, and a second cache would age its figures a second time.

| Route | Answers |
|---|---|
| `GET …/accounts` | 200 always: the picture, or `{reachable:false, reason}` when there is none. |
| `GET …/usage` | 200 always, the same way. |
| `POST …/accounts/switch` | Body `{slug}`. Descent's own status and body, passed through. |
| `POST …/accounts/capture` | No body. Descent's own status and body, passed through. |
| `GET …/memory` | 200 always: the pending queue, or `{reachable:false, reason}` when it is unknown. |
| `GET …/memory/:id` | 200 always: one candidate read whole, or `candidate:null` when no row carries that id. |
| `POST …/memory/:id/approve` | No body. Descent's own status and body, passed through. |
| `POST …/memory/:id/reject` | No body, the same way. |

Both lanes speak over one wire. `descent.transport.ts` owns the origin, the ceiling and the three
failure words, and `descent.module.ts` builds both services over it from a single `dependencies`
object, so the two can never drift onto different origins or ceilings. They are siblings, not a
chain: `descent.memory.service.ts` imports nothing from `descent.service.ts`. One router carries both
— the memory routes are four thin handlers on the
router that already existed, not a second routes file, which would mean exporting `sendDescentWrite`
for one caller.

The bodies are `DescentAccounts`, `DescentSlot`, `DescentUsage` and `DescentUsageWindow` for the
accounts lane, and `MemoryCandidateLean`, `MemoryCandidateFull`, `MemoryPending` and
`MemoryCandidateRead` for the memory one — all in `server/shared/types.ts` § DESCENT CONTRACTS,
documented field by field where declared. Read them there, not a copy here.

## Consumers

One lane, one screen, one poller — and there are two of each. Both pollers are mounted once for the
app's whole life, so no amount of opening and closing panels multiplies them.

The accounts lane's screen is `src/modules/accounts/`. Its `AccountFooterRow` holds the single
instance of both hooks — 60 s for the picture, 180 s for usage, and one extra reading the moment the
panel opens. What the screen makes of each of these bodies, and why an expiry sitting in the past
raises nothing there, is [accounts.md](accounts.md).

The memory lane's screen is `src/modules/memory-intake/`, reached by the workspace's **Memory** tab.
`MemoryIntakeProvider` is mounted once in `App.tsx` inside the auth gate and polls the queue at 60 s,
so the tab's count, the tab gates and the panel all read one reading; an expanded row reads that one
candidate by id, and `useMemoryReview` drives the two writes from the panel alone. Why the tab is
gated on the queue and stays put at zero, what each refusal reads as, and the fence that keeps the
two verbs a person's own, is [memory-intake.md](memory-intake.md).

Both type groups are mirrored field-for-field in `src/shared/types.ts` for the client's own use; the
declarations above are the source, and a change to either shape belongs in both files at once.

## The rules that bite

1. **A read never fails.** An unknown picture is a calm 200 `{reachable:false, reason}`, never a 5xx —
   the panel draws em-dashes, not an error wall. `reason` is one of three words — `unreachable`,
   `timeout`, `bad-response` — and they are the ONLY thing ever said about a failure: no Descent body,
   no stack, no URL, no path. A picture is whole or it is none: `ok` is tested rather than trusted, a
   slot with no slug fails the WHOLE read rather than vanishing, and a non-2xx takes that same path.

2. **A write carries Descent's verdict, not ours** — its status and body travel untouched. The three
   substitutions: 422 `{error:'slug is required'}` for a missing, blank, numeric or null slug; 422
   `{error:'id is malformed'}` for a memory id that fails `/^[A-Za-z0-9_-]{1,64}$/` — both refused at
   the route and never sent on; and 503 `{reachable:false, reason}` when Descent gave no verdict at
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

8. **The memory queue is whole or it is none, and a 422 on approve is a verdict.** One row missing a
   string `id`, `name` or `target` fails the WHOLE `GET …/memory` read as `bad-response` — rule 1's
   slot discipline again, because a silently shortened queue reads as "nothing left to review", and
   the operator can act on "Descent is not reachable" while they can do nothing about a proposal that
   was never drawn. The list is LEAN (no `body`, no `rationale`); the body arrives from the by-id read
   for the one card that is expanded. A `null` from that read means one thing — no row carries that id
   — and never "reviewed since you last looked": Descent's by-id read has no status filter, so an
   already-approved card still reads whole with its `status` saying so. A consumer that tests only for
   the null therefore draws a card someone already reviewed as if it were still waiting; `status` is
   the field to read. On the writes, Descent's cap guard answers 422 in plain English, and that text
   is the single most useful thing a reviewer can be handed — it names what to trim — so it travels
   through untouched, and the card it refused stays PENDING with the same words recorded on its
   `refusal`.

9. **Nothing here widens the memory fence.** Approving a candidate writes into files every future
   session in a project reads, so the verbs that flip a candidate off `pending` are reachable ONLY
   over Descent's own HTTP routes and carry no agent seam — no MCP verb, not even a staging one. That
   fence is structural rather than doctrinal (Descent GOTCHAS #253) and this proxy leaves it exactly
   where it was: what it adds is one more bearer-authenticated HTTP path to routes any process on this
   host could already reach unauthenticated at `:7878`. No route here is callable by an agent, and a
   memory still becomes real only when a person presses the button.

## Proving it

`node .verify/phase-12.mjs` for the accounts lane and `node .verify/phase-19.mjs` for the memory one,
both fetch-driven against the running dev server — no browser; see
[verification.md](verification.md). Neither probe moves anything the operator owns. Phase 12 never
calls `capture` and never sends `switch` a real slug — both would move the live login — so the
refusal of `__no_such_slug__` is the evidence instead. Phase 19 approves and rejects nothing that is
pending, since filing a candidate writes to a real memory file and discarding one destroys a
proposal: its write evidence is an id Descent does not have, a malformed id refused at the route, and
an id Descent already lists as approved, which it refuses before touching disk.

Both prove the down path against a CLOSED PORT rather than by stopping the operator's Descent, and
both mount the real router to do it, built the way `descent.module.ts` builds it — BOTH lanes. That
construction is load-bearing: `createDescentRouter`'s second parameter is required, so the shipped
app cannot be one short, but a probe's `tsx -e` snippet is outside `npm run typecheck`, and one built
with a single argument leaves `memoryService` undefined and 5xxs every memory route while a suite
that asserts only the accounts ones stays green.
