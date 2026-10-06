<!-- docstore export; edit rows with docstore write, never this file -->

## MAN-7815 — Cerberus — fleet health: what the module does

Cerberus: fleet health. Wardens on other machines and three checks of center's own report results; center stores the ones that say something, works every status out when the screen reads, and serves it at `/api/cerberus`. The warden gateway is a tailnet listener of its own (`CERBERUS_LISTEN`). Which row documents which subject: MAN-7816.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/index.ts

## MAN-7800 — Identity and signing — center's ed25519 key, the connect signature, signed frames, the node certificate

Every trust decision in Cerberus is an ed25519 signature. Center holds one key pair, minted once; each warden holds its own, and center stores the public half at enrollment. Where wardens dial in and the refusals: MAN-7803. Wire shapes: MAN-7807.

## Center's key — `center-key.ts`
| fact | value |
|---|---|
| file | `CERBERUS_KEY_PATH`, else `cerberus-center.key` in the directory of `getCerberusDatabasePath()` — live `~/.cloudcli/cerberus-center.key`; a scratch store gets a scratch key |
| format and mode | PKCS8 PEM, `fs.writeFileSync(path, pem, { mode: 0o600, flag: 'wx' })` |
| minted | only when the file is absent (`ENOENT`); flag `wx`, so an existing key is never overwritten. why: losing the file orphans every enrolled warden, which pins the public half |
| lost race | `EEXIST` → re-read the file; the other process's key is THE key |
| refused | a file that is not ed25519, or a read error other than `ENOENT`, throws and leaves the file untouched |
| loaded | `loadCenterKey()`: once per process, then kept. `cerberus.module.ts` `start()` calls it, so an unusable key fails the boot, not the first enrollment |

The private key never leaves the file; callers get signatures and the public key.

| function | answers |
|---|---|
| `signText(text)` | base64 ed25519 signature over the UTF-8 bytes of `text` |
| `centerPublicKey()` | base64 SPKI DER |
| `fingerprintOf(publicKeyB64)` | sha256 hex of the DER bytes |
| `canonicalEd25519PublicKey(b64)` | the key re-exported as canonical base64 SPKI DER, or `null` when it is not ed25519. why: what is stored and fingerprinted is the DER, not the peer's spelling of base64 |
| `verifyNodeSignature(publicKeyB64, text, sigB64)` | boolean; `false` for a malformed key or signature, never throws |

## Warden → center: the connect signature (`warden-auth.ts`)
| rule | value |
|---|---|
| signed text | `cerberus-connect\n<node>\n<at>` — `at` is epoch ms as whole decimal digits (`^(?:0\|[1-9]\d{0,14})$`) |
| carried in | `X-Cerberus-Node`, `X-Cerberus-At`, `X-Cerberus-Sig` (base64) |
| verified against | `nodes.public_key` of the named node |
| clock | `\|now − at\| ≤ 60 000` ms, else the refusal `clock skew <n> s` |
| reuse | a `(node, at)` pair is remembered 120 s; presenting it again is `replayed signature` |

The signature is checked BEFORE the replay memory, and only a signed pair is remembered. why: a stranger guessing timestamps cannot use up the slot a real node will need.

Enrollment signs nothing: `X-Cerberus-Enroll` (the token) proves the right, `X-Cerberus-Key` hands center the public key to store.

## Center → warden: every frame is `{ env, sig }` (`warden-link.ts` `send`)
1. Build the envelope `{ type, id, node, seq: null, at: Date.now(), body }`; `id` = 12 random hex characters.
2. `env` = `JSON.stringify(envelope)`, serialised ONCE.
3. `sig` = `signText(env)`.
4. The socket carries `JSON.stringify({ env, sig })`.

The warden verifies `sig` over the exact bytes of the `env` string it received, then parses `env`; a re-serialisation does not verify. Frames from a warden are not signed: the link was authenticated at the upgrade.

## Node certificate — `issueCert(node, fingerprint, issuedAt)` in `warden-enrollment.ts`
`CerberusNodeCert = { node, fingerprint, issuedAt, centerKey, sig }`.
- `fingerprint` = `fingerprintOf` the key the node enrolled with; `issuedAt` = the node row's `enrolled_at`; `centerKey` = `centerPublicKey()`.
- `sig` = `signText('cerberus-cert\n<node>\n<fingerprint>\n<issuedAt>')`, `issuedAt` in decimal ms; `centerKey` is not in the text.
- A re-issue is byte for byte the first: ed25519 signs deterministically and `issuedAt` is fixed. why: the cert rides EVERY connect `welcome`, so a warden whose enrollment `welcome` was lost still learns the key to pin.
- The warden pins `centerKey` from the first cert it holds and ignores a different one after.
- The warden verifies exactly these bytes: change the layout in the `CerberusNodeCert` comment (MAN-7807) and in `issueCert` together.

## Enrollment write — `enrollNode(request, hello, now)`
1. Sign the cert FIRST. A signing failure refuses with `enrollment failed`; the token stays unspent.
2. One `IMMEDIATE` transaction: `cerberusEnrollDb.markUsed(tokenHash, name, now)` must change exactly 1 row, then `cerberusNodesDb.insert` (public key, fingerprint, the token's `desc`, hello's version, machine id and facts, `enrolled_at = now`).
3. `markUsed` changing 0 rows → refusal `token used`. A thrown insert rolls the spend back (`enrollment failed`): a failed enrollment never burns a token.

Two sockets presenting one token: exactly one wins. Minting the token: MAN-7802.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/center-key.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-auth.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-enrollment.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-link.ts

## MAN-7801 — Cerberus storage rule — change or keep-alive, `prev_at`, `prev_status`, `since`, and what is pruned

The Cerberus storage rule: only results are stored, and only when they say something. "No result", "not enabled", "muted" and "paused" are worked out when the screen reads (MAN-7808), never written; nothing is overwritten. Appends: `results`, `mutes`. The only `UPDATE`s in the store: definition rows, a node's heartbeat and ack columns, a token's `used_at`, a mute's `lifted_at`. Transaction, refusals and the memory doors around this rule: MAN-7811.

## The rule — `storeFrame` in `ingest.service.ts`
Each result is judged against `lastStored[node/key]`: that check's last stored row, held in memory and seeded at start from `cerberusResultsDb.latestPerCheck()`.

| case | stored |
|---|---|
| `at <= lastStored.at` | nothing (a resend, or older than the store holds) |
| no `lastStored`; or `status`, `docStatus` or `value` differs; or `prevAt` is null; or `at − prevAt > staleAfter(check)` | a `change` row |
| else `at − lastStored.at >= 300 000` ms, or the caller passed `keepalive = true` | a `keepalive` row |
| else | nothing |

`prevAt` is the reporter's own previous result time, stamped on EVERY result, stored or not. A null `prevAt`, or a gap past `staleAfter`, is a LAPSE and is itself a change. An unbroken `prevAt` chain between two stored rows is what lets the reader call the stretch fresh (freshness rule: MAN-7808).

## Columns the rule writes (`results`)
| column | value |
|---|---|
| `kind` | `change` or `keepalive` |
| `prev_at` | the result's `prevAt`; NULL when absent or not a whole number |
| `prev_status` | `lastStored`'s status, `not_enabled` when that is NULL, SQL NULL when there was no `lastStored` |
| `status` | `ok`, `warn`, `failing`, `denied`; SQL NULL = not enabled |
| `doc_status` | `green`, `yellow`, `red`, `muted`, or NULL |

`prev_status` is the only column that spells `not_enabled`.

## Memory the rule keeps (per process, keyed `node/key`)
| memory | moves when | read as |
|---|---|---|
| `lastStored` | a row is stored | the rule's comparison |
| `lastReceivedAt` | EVERY accepted result, stored or not; never lowered | `liveLastAt` of the freshness rule; null after a boot until a result arrives |
| `since` | a stored row's status differs from its `prev_status`, or there was no `lastStored`; seeded from `latestPerCheck()` | a check view's `since`; the order of "Needs you" |

Memory moves only after the frame's transaction commits.

## Retention — `store-prune.service.ts`
- Once a day, first run 60 s after the duties arm; started by `soleDuties()`, so only the process holding the takeover prunes.
- Deletes `keepalive` rows with `at < now − 90 days` (`cerberusResultsDb.pruneKeepalivesBefore`, the only delete on `results`) and enrollment tokens with `issued_at < now − 30 days`, spent or not.
- `change` rows are never deleted. why: they are the record of every status a past moment can be read from (`rowsInWindow` needs the last row before any window), and "What happened" is built on them. A keep-alive is a copy written to say "still the same". Retention per `design/cerberus/Cerberus Spec.dc.html` Table 4: results "Changes forever · keep-alives 90 days".
- Volume: about 3.7 million `change` rows a year for one node on the real health document (earlier estimate, not re-measured): a value that carries a changing number is a change at every new value.
- 2026-10-06, live store: `center` held 56 rows, 17 `change` and 39 `keepalive`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/ingest.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/store-prune.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-results.db.ts

## MAN-7802 — The REST surface at `/api/cerberus` — thirteen routes, their error codes, mutes, enrollment minting, and the `cerberus_changed` hint

What a browser (or a probe) calls. Mounted in `server/index.ts`: `app.use('/api/cerberus', authenticateToken, cerberus.router)`, directly after the notes mount; the gateway (MAN-7803) is a different listener and carries none of these. Wire shapes: MAN-7807. What the read routes compute: MAN-7808. What the definition and label writes do: MAN-7812, MAN-7813.

## Files
| file | owns |
|---|---|
| `cerberus.routes.ts` | `createCerberusRouter({ readInputs, gatewayState })`: parse, call one verb, answer |
| `mutes.service.ts` | `createMute(input, by)`, `liftMute(id)` |
| `enrollments.service.ts` | `mintEnrollment({ name, desc? }, gateway)`, `enrollmentStatus(name)` |
| `cerberus-broadcast.ts` | `hintChanged({ nodes?, checks? })` |

## Answer and refusal shape
| rule | value |
|---|---|
| answer | the wire shape itself, bare JSON; not wrapped in `{ success, data }` |
| nothing to say | 204 |
| refusal | an `AppError` with a `CERBERUS_` code → `{ success: false, error: { code, message, details } }` |
| routes decide | transport shape only (a field's type, which path parts make the key); range, grammar and existence are the service's refusal; a wrong shape is 400 `CERBERUS_BAD_REQUEST` |
| read inputs | `readInputs()` once per request: `Date.now()`, `wardenLinks.states()`, the gateway state, `ingest.memory` — one instant for the whole answer |
| `by` of a mute | `req.user.username`; none → 401 `CERBERUS_USER_REQUIRED` |

## Routes
| route | answer | refusals |
|---|---|---|
| `GET /overview` | `CerberusOverview` | |
| `GET /checks` | `CerberusCheckIndexEntry[]` | |
| `GET /checks/:node/:service/:check?lookup=<ms>&end=<ms>` | `CerberusCheckDetail`; `end` (default now, clamped to now) is where the 60 cells and `recent` stand, `lookup` defaults to `end` | 400 `CERBERUS_BAD_REQUEST` (a query number not whole digits); 404 `CERBERUS_UNKNOWN_CHECK` |
| `GET /lookup?node&key&at` | `CerberusLookup` | 400 `CERBERUS_BAD_REQUEST` (any of the three missing, `at` not whole digits); 404 `CERBERUS_UNKNOWN_CHECK` |
| `GET /activity?before&limit` | `CerberusActivity[]`; `limit` default 40, capped at 100; `before` default now + 1 | 400 `CERBERUS_BAD_REQUEST` |
| `POST /mutes {node,key,until,reason?}` | `CerberusMute` | 404 `CERBERUS_UNKNOWN_CHECK`; 400 `CERBERUS_BAD_MUTE` (`until` not whole ms, not in `(now, now + 24 h]`, reason over 500 characters); 400 `CERBERUS_BAD_REQUEST` (shapes) |
| `POST /mutes/:id/lift` | `CerberusMute` | 404 `CERBERUS_UNKNOWN_MUTE` |
| `PUT /labels {node, key? \| service?, label}` | 204; an empty label stores NULL | 400 `CERBERUS_BAD_LABEL`; 404 `CERBERUS_UNKNOWN_NODE` / `CERBERUS_UNKNOWN_CHECK` |
| `POST /enrollments {name, desc?}` | `CerberusEnrollment` | 400 `CERBERUS_BAD_NAME` / `CERBERUS_BAD_DESC`; 409 `CERBERUS_NAME_TAKEN`; 409 `CERBERUS_NOT_LISTENING` |
| `GET /enrollments/:name` | `CerberusEnrollmentStatus` | |
| `GET /definitions/:node` | `CerberusDefinition` | 404 `CERBERUS_UNKNOWN_NODE` |
| `PUT /definitions/:node` | `{ version }` | 400 `CERBERUS_BAD_DEFINITION` (`details.path`; a `file_age` without `pass` is refused); 404 `CERBERUS_UNKNOWN_NODE` |
| `DELETE /checks/:node/:service/:check` | 204 (retires) | 404 `CERBERUS_UNKNOWN_CHECK` / `CERBERUS_UNKNOWN_NODE`; 409 `CERBERUS_HUB_CHECK` (any check of `center`: `seedHub` would revive it) |

Route params: a check is named by `:service/:check`, key = `<service>/<check>`. A query number is whole digits (`^-?\d{1,16}$`).

## Mutes — `mutes.service.ts`
- Cerberus-side only; the warden never hears of one, and the check keeps running and recording.
- The check must be active. `until` is a whole number in `(now, now + 24 h]`: a longer silence is a definition change (retire), not a mute.
- An empty or blank reason is stored as `No reason given`; a reason is at most 500 characters.
- Rows are appended; the one update a mute gets is `lifted_at`. A lift on a mute already lifted or already run out is answered as it stands and hints nothing.
- Both writes `hintChanged` after the row is written.

## Enrollment minting — `enrollments.service.ts`
| rule | value |
|---|---|
| order of checks | name grammar (never `center`) → name taken → gateway listening |
| token | `XXXX-XXXX-XXXX`, each character `crypto.randomInt` over `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no `0 O 1 I L`) |
| stored | the sha256 only (`cerberusEnrollDb.insert`); the gateway spends it (MAN-7800) |
| lifetime | 15 minutes |
| command | `curl -fsSL http://<CERBERUS_LISTEN>/cerberus/enroll.sh \| sudo sh -s -- --name <name> --token <token>` — `enroll.sh` is served by `warden-files.ts` on the gateway (MAN-7826) |
| status | `GET /enrollments/:name` reads the name's NEWEST token: `waiting`, `used`, `expired`, or `unknown` (never minted, or pruned after 30 days) |

## The hint — `cerberus-broadcast.ts` `hintChanged({ nodes?, checks? })`
- One frame: `{ kind: 'cerberus_changed', at, nodes, checks }` (`CerberusChangedEvent`; `GatewayEventKind` carries `'cerberus_changed'`).
- Coalesced: the first hint of a quiet spell opens a 1 s window (`unref`'d); everything named inside is merged; ONE frame goes out when it closes.
- Fan-out as `broadcastNotesChanged`: one `JSON.stringify`, every open socket in `connectedClients`, a `try/catch` per client.
- `nodes` are node ids; each `checks` entry is `<node>/<key>`, split at the FIRST `/`.
- Sent after a commit, on: a stored `change` row or a discovered component (ingest), a link change (`wardenLinks.onChange`, subscribed once by the gateway), a node's first heartbeat, a mute set or lifted, a label, definition or retire write.
- Never sent for a result that was not stored, and never before the write that caused it.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/cerberus-broadcast.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/cerberus.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/enrollments.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/mutes.service.ts

## MAN-7803 — Cerberus warden gateway — its own listener, the credential check before the upgrade, the eight 401 refusals, one warden link

The Cerberus warden gateway: the listener wardens dial in on, the credential check before the upgrade, the eight 401 refusals and one link. Keys, signatures, the certificate and the enrollment write: MAN-7800. Frame shapes: MAN-7807. Link registry: MAN-7814. Result handling: MAN-7811. Process wiring and `CERBERUS_LISTEN`: MAN-7804.

## Files
| file | owns |
|---|---|
| `warden-gateway.ts` | `startWardenGateway({ listen, supervised })` → `WardenGateway { address, error, stop() }`; `wardenHttpRoutes`; `wardenHttpPrefixRoutes`; `parseListen` |
| `warden-files.ts` | registers the enroll script and the warden release on the two route tables (MAN-7826) |
| `warden-auth.ts` | `authenticateUpgrade(req, now)` → `WardenAuthResult`; type `WardenRefusal` |
| `warden-link.ts` | `runWardenLink(ws, admitted)`: one link per accepted socket |
| `.verify/probe-cerberus-gateway.mjs` | end-to-end probe on a scratch store and key |

## The listener — `warden-gateway.ts`
- Its own `http.Server`, apart from the API's, bound to `CERBERUS_LISTEN` (live: tailnet `100.103.222.79:3012`); `server.listen({ host, port, reusePort: supervised })`, as `server/index.ts`.
- It carries `GET /cerberus/ws` (the upgrade) and the two HTTP route tables, and nothing else: no user route, no login. A cookie, an `Authorization` header or a `token` query string opens nothing.
- `wardenHttpRoutes`: `Map<pathname, (req, res) => void | Promise<void>>`, exact-path GET handlers; `warden-files.ts` registers `/cerberus/enroll.sh` and `/cerberus/warden/latest.json`. `wardenHttpPrefixRoutes`: the same shape keyed by path prefix, tried after the exact table; it holds `/cerberus/warden/`, whose handler judges the rest of the RAW path itself (a release's name carries its version). Outside both tables: plain 404. A handler that throws or rejects answers a logged 500 (awaited as well as caught: an unhandled rejection ends the API process).
- Upgrade: only `GET /cerberus/ws`, else a plain 404. `authenticateUpgrade` runs BEFORE `wss.handleUpgrade` (`ws`, `noServer: true`, `maxPayload` 8 MiB: a bigger frame closes 1009 with no `error` frame, so a warden keeps a result batch under it); a refusal is `HTTP/1.1 401 Unauthorized` with one plain line as the body and the socket destroyed. A throw while judging answers 500.
- `startWardenGateway` never rejects: `listen` null → `address` and `error` null, nothing starts; not `host:port` → logged, `error` set; a bind error is logged once and answered in `error`. `address` is the bound `host:port`, an IPv6 host with its brackets.
- `stop()` closes the LISTENER only. Open links end with the process, as `http-drain.ts` leaves the browser's websockets. why: a warden reconnects on its own; closing early only makes it reconnect to the process that is leaving.
- The first start subscribes once to `wardenLinks.onChange` → `hintChanged({ nodes: [node] })` (attach, detach, silence).
- HAZARD: `reusePort` lets the gateway bind an address the API already holds without an error, and the kernel splits that address's traffic. The caller refuses `CERBERUS_LISTEN` on the API's `SERVER_PORT` before calling (`cerberus.module.ts`, MAN-7804).
- 2026-10-06, live: `Authorization: Bearer …` plus `?token=…` on the upgrade → `401` body `unknown node`; a bad `X-Cerberus-Enroll` → `401 unknown token`; any other path → `404`.

## Upgrade auth — `authenticateUpgrade`
Reads ONLY `X-Cerberus-*` headers. `X-Cerberus-Enroll` present → enroll, else connect. Signature rules and why: MAN-7800.

| path | headers | accepted when |
|---|---|---|
| enroll | `X-Cerberus-Enroll` (token as printed `XXXX-XXXX-XXXX`), `X-Cerberus-Node`, `X-Cerberus-Key` (base64 SPKI DER, ed25519) | the token's sha256 names an unused, unexpired row whose `name` = the node header; no node of that name exists; the key is ed25519. Checks only: the link spends the token |
| connect | `X-Cerberus-Node`, `X-Cerberus-At` (whole epoch ms), `X-Cerberus-Sig` (base64 ed25519 over `cerberus-connect\n<node>\n<at>`) | the node exists; `\|now − at\| ≤ 60 000`; the signature verifies against `nodes.public_key`; `(node, at)` not presented in the last 120 s |

The eight refusals, the body of the 401, one line each:
| refusal | when |
|---|---|
| `unknown token` | no `enroll_tokens` row for the token's sha256 |
| `token used` | the row's `used_at` is set |
| `token expired` | `expires_at <= now` |
| `name does not match the token` | the node header is not the token's name, or that name is already enrolled |
| `unknown node` | connect to a node with no row; also the answer to a request bearing only `Authorization` |
| `bad signature` | the enroll key is not ed25519; connect `at` or `sig` missing or `at` not a whole-ms number; the signature fails |
| `clock skew <n> s` | `\|now − at\|` > 60 s; `n` = `max(61, round(skew s))`, never the limit itself |
| `replayed signature` | `(node, at)` seen within 120 s |

## Link — `runWardenLink`
1. `attachWebSocketHeartbeat(ws)` (MAN-316): a `ws` ping every 30 s ends a half-open link. `hello` must come within 10 s else close 4001; a first frame that is not `hello` closes 4003; a malformed `hello` or a refused enrollment sends `error { message }` then closes 4002. Close 4000 is `wardenLinks.attach` replacing an older link of the node.
2. Enroll `hello`: `enrollNode` (MAN-7800); on success the link attaches, counts as heard, and `welcome` = `{ node, ackedUpto: 0, cert, checks }`.
3. Connect `hello`: `recordHello`, attach, heard; `welcome` = `{ node, ackedUpto: acked_seq, cert, checks? }`; `checks` only when the hello's `checksVersion` ≠ `nodes.checks_version`; `cert` on EVERY connect `welcome`.
4. After the handshake every frame is `wardenLinks.heard`, then judged an envelope for THIS node (`type`, `id`, `node`, `seq` null or whole, `at` a number, `body` an object); a bad one is logged once per link and ignored.

| frame in | effect |
|---|---|
| `heartbeat` | clock offset = median of the last 5 `receivedAt − env.at`; `recordHeartbeat`; the node's first one hints |
| `checks.ack` | `setChecksAcked(version)` |
| `result` | `seq` null or < 1 → logged, ignored. `seq ≤ acked_seq` → `ack { upto: seq }`, nothing stored. Else `ingest.ingestResults` (its own commit) → `setAckedSeq` → `ack`. A crash between the last two costs a resend, which ingest skips by `at` |
| any other `type` | the handler `wardenLinks.registerHandler` holds for it, else logged once per type and ignored (a newer warden may speak frames this center does not know) |

Every frame center sends: `send(type, body)` builds the envelope and wraps it `{ env, sig }` (MAN-7800).

## Probe — `.verify/probe-cerberus-gateway.mjs`
Run from the repo root; `CERBERUS_DB_PATH`, `CERBERUS_KEY_PATH` and `DATABASE_PATH` must all be under `/tmp` or it exits 2.
```
D=$(mktemp -d /tmp/cerberus-gateway.XXXXXX) || exit 1
CERBERUS_DB_PATH=$D/cerberus.db CERBERUS_KEY_PATH=$D/center.key DATABASE_PATH=$D/auth.db \
  TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx .verify/probe-cerberus-gateway.mjs
case "$D" in /tmp/cerberus-gateway.*) rm -rf "$D" ;; esac
```
- Binds `127.0.0.1:7894`: run it alone, not beside `scripts/sunset-probe.sh`'s default slot (MAN-673).
- The client verifies center's signatures with `node:crypto`, not the code under test. Covers enroll and connect `welcome`, result ack twice (one stored row), every refusal by curl, one token on two sockets, no-hello close, replaced link 4000, a bind collision (`EADDRINUSE` in `error`), key file mode and reuse.

## Open
- The 30 s ping is the shared helper, not run live in the probe.
- No shared token-hash helper: `warden-auth.ts` (checks) and `enrollments.service.ts` (mints) each hash with `crypto.createHash('sha256')` inline; both must stay sha256 hex of the token as printed.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-auth.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-gateway.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-link.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-cerberus-gateway.mjs

## MAN-7804 — The hub — what every API process runs, what only the takeover holder runs (`soleDuties()`), the three self-checks, configuration

The Cerberus module as a running API process sees it: what `server/index.ts` calls, which work every process does and which only the process holding the takeover does, and the hub's own three checks. Routes and the hint: MAN-7802. Gateway: MAN-7803. Storage rule and prune: MAN-7801. Store: MAN-7805, MAN-7806. Reads: MAN-7808. Ingest, definitions, links: MAN-7811, MAN-7812, MAN-7814. Wire shapes: MAN-7807.

## Files
| file | owns |
|---|---|
| `index.ts` | the barrel: `createCerberusModule`, `wardenLinks`, `ingest`; nothing else leaves the directory |
| `cerberus.module.ts` | `createCerberusModule({ supervised })` → `{ router, start(): Promise<void>, soleDuties(), stop() }` |
| `self-checks.service.ts` | `startSelfChecks(getGateway)`, `stopSelfChecks()` |
| `store-prune.service.ts` | `startDailyPrune()`, `stopDailyPrune()` |

## Wiring in `server/index.ts`
| call | where |
|---|---|
| `const cerberus = createCerberusModule({ supervised })` and `app.use('/api/cerberus', authenticateToken, cerberus.router)` | after the notes mount |
| `void cerberus.start()` | the `listen` callback, beside `dispatcher.start()` |
| `cerberus.soleDuties()` | last in `soleServerDuties()`: a plain boot runs it BEFORE `listen`, a handover boot at takeover (`onTakeover`) |
| `cerberus.stop()` | first in `shutdownRuntimeServices` |

## Who runs what
| work | every process | only the takeover holder |
|---|---|---|
| `start()`: open the store (migrations run), `loadCenterKey()`, `seedHub()`, `wardenLinks.seedFromStore()`, `ingest.seedMemory()`, then bind the gateway | yes | |
| the `/api/cerberus` router: every read and write route | yes | |
| ingest of a warden's results | the process that holds the warden's link | |
| `stop()`: stop the self-checks and the prune, stop the gateway accepting (open links end with the process) | yes | |
| the three self-checks, every 30 s | | `soleDuties()` |
| the daily prune | | `soleDuties()` |

why: a second API process on the same store would write a second set of hub rows (`readopt.ts` measured what a duty every process performs costs: nine probe servers retired the operator's chats).

- `start()` never rejects: a failure is logged (`[Cerberus] could not start`) and the API keeps serving.
- The sole duties arm when BOTH `start()` has finished and `soleDuties()` was called, in either order. A boot whose `start()` failed never arms them.
- The gateway binds in every process (`reusePort: supervised`), AFTER the process has signalled ready. The supervisor retires the old process on that signal and the old process stops its listener, so a handover leaves `CERBERUS_LISTEN` with NO listener for about a second (0.74–1.21 s over six handovers, 2026-10-06): a warden's first redial in it is refused and must back off. `reusePort` lets a successor bind if it ever arrives while the old process still holds the port; it does not make the two overlap. Binding before ready would close the gap and moves the entrypoint's readiness timing, which is a decision of its own.

## Configuration (read at boot; a change takes a restart; documented in `.env.example`)
| name | meaning |
|---|---|
| `CERBERUS_LISTEN` | `host:port` of the warden gateway (IPv6 as `[::1]:3012`); blank counts as unset. Live `.env`: `100.103.222.79:3012`, the tailnet address; `HOST` and the API's own listener stay loopback. Unset → no gateway, `address` and `error` null, the hub's `gateway.listening` reads `CERBERUS_LISTEN is not set` |
| `CERBERUS_DB_PATH` | the store file; else `cerberus.db` beside `getDatabasePath()` (MAN-7805) |
| `CERBERUS_KEY_PATH` | center's key; else `cerberus-center.key` beside the store (MAN-7800) |

A `CERBERUS_LISTEN` on the API's own `SERVER_PORT` is refused whatever the host: nothing binds and the gateway state's `error` says `CERBERUS_LISTEN <value> is on the API's own port`. why: `reusePort` lets the gateway bind an address the API already holds without an error, and the kernel splits that address's traffic (26 of 60 requests reached the API, 2026-10-06); `localhost`, `127.0.0.1` and a wildcard are spellings of one socket only the kernel resolves, so the port is the whole rule.

## The three self-checks — `self-checks.service.ts`
Node `center`, service `cerberus` ("Cerberus itself"), kind `self`, every 30 s, the first tick the moment the duties arm. `seedHub()` writes the three definitions at every `start()` (version 0, idempotent; a label a person changed is kept). Each tick measures an empty `BEGIN IMMEDIATE`, then ingests three `CerberusResultWire`s through `ingest.ingestResults('center', null, …)`: `seq` null, `source` = the check's own key, `prevAt` = the last tick that ingested without error (null after a boot; stored or not: an unchanged tick stores nothing and is still a link in the chain). The storage rule (MAN-7801) applies: an unchanged check stores nothing until its five-minute keep-alive.

| key (label) | ok | failing | null (not enabled) |
|---|---|---|---|
| `cerberus/wardens.fresh` (Every warden heard from in 90 s) | `N of N reporting` | `R of N reporting` | `No warden has enrolled yet` |
| `cerberus/gateway.listening` (Wardens can reach Cerberus) | `Listening on <address>` | the bind error, or the own-port refusal | `CERBERUS_LISTEN is not set` |
| `cerberus/store.write` (The store accepts writes) | `Took the write lock in N ms` | none: a store that cannot write stores nothing, and the check reads No result after 90 s | |

- `wardens.fresh` counts the nodes whose link (`resolveNodeLink`, the screen's own rule) is not `never`: a node before its first heartbeat is mid-install, not silent.
- The write lock is tried WITHOUT waiting (`busy_timeout = 0` for the measurement, then restored): the connection's 5 s wait runs on the event loop and would freeze every route. A busy store throws, the tick stores nothing and logs `a self-check tick stored nothing`, and `prevAt` does not advance.
- `stopSelfChecks()` (first in shutdown) stores the last tick as a keep-alive (`ingestResults(…, true)`), nothing when that tick was itself stored. why: the successor's first row has `prevAt` null, a lapse the reader can vouch for only back to the last stored row + 90 s; without that row a deploy paints the hub "No result" until the successor's first tick. A process that dies uncleanly leaves no such row, and the gap reads as the gap it is.
- The first tick runs when the duties arm, not 30 s later. why: this repo restarts the API on every save under `server/` (87 handovers on 2026-10-06, six bursts of 5–16 with every gap under 31 s); a process that lives under 30 s ran no tick, left no row, and a burst read "No result" for minutes (lookups `stale`, 2026-10-06). Now every process leaves a first row, and a burst is rows less than 90 s apart. `seedFromStore` reads each node's stored heartbeat, so a warden heard within a minute of the restart reads `reporting` at that first tick: `wardens.fresh` does not flip on a deploy.

## Prune
`startDailyPrune()` schedules it, 60 s after the duties arm and then daily. What it deletes and why: MAN-7801.

## Verifying it live
After `touch server/index.ts`: `journalctl -u cloudcli-server-dev.service --since "<time>" --no-pager | grep -E '\[supervisor\]|warden gateway is listening'` reads `handover complete — serving pid <n>` and, about a second LATER, the new pid's `[Cerberus] the warden gateway is listening on <address>` (read at the `handover complete` line, nothing listens yet); after that line `ss -ltn | grep 3012` shows one listener on `CERBERUS_LISTEN`'s address and none on `0.0.0.0`; `GET /api/cerberus/overview` shows `.nodes[0].services[0].checks` as the three hub checks. The writes (mutes, enrollments, labels, definitions) are driven on the scratch server of `scripts/sunset-probe.sh` (MAN-673), never against `~/.cloudcli/cerberus.db`, where a probe's token or mute would be the operator's own row.

## The whole, once (`.verify/cerberus-whole*`)
`bash .verify/cerberus-whole.sh` boots the scratch center of `scripts/sunset-probe.sh` (default slot: API 7893, gateway 7894; `SUNSET_SLOT=N` for a slot of one's own, and the probe's URL follows the slot's API). A slot that is held (a port taken, or its pid file or scratch database on file) is refused with one sentence before anything is armed or written: the harness's `probe_db` runs before its own "something already answers" guard and its stop kills whatever pid file the slot holds, so the script judges the slot first. It then drives the center through `.verify/cerberus-whole.mjs`, a warden stand-in on Node's global `WebSocket`: mint an enrollment, enroll with a fresh ed25519 key (the `welcome`'s `sig` and the certificate's `sig` verified against `cert.centerKey`, which the node pins), read the enrollment as `used`, `PUT` one http probe, reconnect with a signed connect header, take the `checks`, ack them, heartbeat, send one `result` and receive its `ack`, read the overview with the node `reporting`, then three `curl -si` upgrades: the spent token (`token used`), a connect signed by another key (`bad signature`), a user JWT alone (`unknown node`). Frames print as JSON lines; the script stops the server and removes every scratch path on every exit. `node .verify/cerberus-whole-live.mjs` is the read-only half for the live server, after a handover and after the new pid's gateway line (see above): the overview (hub first, the three checks and their sentences), a `lookup` for `cerberus/store.write` one minute back (`verdict: "result"` with no row stored at that moment), and `activity`.

## Gotchas
- A lookup before a check's first stored row answers `too_early`, not `result`: ask for a moment after the first tick.
- The hub's row counts stay put between ticks by design: three `change` rows at the first tick, then only changes and one keep-alive per check every five minutes.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.env.example, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/cerberus.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/self-checks.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/store-prune.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-whole-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-whole.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-whole.sh

## MAN-7805 — The store — `cerberus.db`: its path, the connection, the schema steps (`CERBERUS_MIGRATIONS`) and step 0

A second SQLite file beside `auth.db`, with its own singleton and its own stepped schema. Repositories over it: MAN-7806.

## Files
| File | Owns |
|---|---|
| `server/modules/database/cerberus-connection.ts` | `getCerberusDatabasePath`, `getCerberusConnection`, `closeCerberusConnection`; the step runner |
| `server/modules/database/cerberus-schema.ts` | `CERBERUS_MIGRATIONS: readonly string[]` — one SQL string per step |
| `server/modules/database/index.ts` | re-exports the three connection functions, the five `cerberus*Db` objects and their row types |

## Path
| When | Path |
|---|---|
| `CERBERUS_DB_PATH` set | that path |
| else | `cerberus.db` in the directory of `getDatabasePath()` — live `~/.cloudcli/cerberus.db`; a scratch `DATABASE_PATH` gives a scratch store |

## Open (`getCerberusConnection()`)
1. Nothing opens at import; the first call opens, later calls return the singleton.
2. `mkdir -p` the parent directory.
3. `busy_timeout = 5000`, then `journal_mode = WAL`, then `foreign_keys = ON` (busy_timeout first: switching a fresh file to WAL takes a lock the overlapping process may hold).
4. Apply the steps the file has not had.
5. The singleton is assigned only after step 4 succeeds. A failed migration closes the handle, logs `Could not open the Cerberus store`, rethrows; the next call starts over.

`closeCerberusConnection()` closes and clears the singleton; the next `getCerberusConnection()` reopens. The server never calls it (the handle closes with the process); the `store`, `read-model` and `gateway` probes in `.verify/probe-cerberus-*.mjs` close it as their last act (`probe-cerberus-store.mjs` also reopens the store once, to prove the steps idempotent); `probe-cerberus-open-race.mjs` never calls it.

## Schema steps
| Rule | Detail |
|---|---|
| Version | `PRAGMA user_version` = number of steps applied; step `i` runs only while `user_version == i`, then sets `i + 1` |
| Atomic | each step runs in one `BEGIN IMMEDIATE` transaction (`db.transaction(...).immediate()`): the write lock is taken BEFORE `user_version` is read |
| Fast path | `user_version >= CERBERUS_MIGRATIONS.length` returns before any lock |
| Newer file | `user_version` AHEAD of the build's steps is left alone, not failed (rollback to an older build; steps only add) |
| DDL | plain `CREATE TABLE` / `CREATE INDEX`, never `IF NOT EXISTS`: an existing table means counter and file disagree, fail loudly |
| Edit | a step that has run on the live store is never edited, reordered or removed — a change is a NEW step appended at the end |

## Step 0 tables
| Table | Key | Holds |
|---|---|---|
| `nodes` | `id` | one enrolled warden; bookkeeping columns `acked_seq`, `checks_version`, `checks_acked` |
| `enroll_tokens` | `token_hash` | one-time install tokens, hash only |
| `probes` | `(node, key)` | what a warden is told to run; `spec` JSON, `every` / `timeout` / `cadence` seconds |
| `checks` | `(node, key)` | what a result files under; `retired_at` hides a check and keeps its history |
| `results` | `(node, check_key, at)` | append-only; `kind IN ('change','keepalive')` CHECK |
| `mutes` | `id` | append-only but `lifted_at`; index `ix_mutes_check(node, check_key, until_at)` |

All times are epoch milliseconds, except `every`, `timeout`, `cadence`, `stale_after` (seconds).

## Prove it
Both probes refuse to run unless `CERBERUS_DB_PATH` and `DATABASE_PATH` start with `/tmp/`:
```sh
D=$(mktemp -d /tmp/cerberus-store.XXXXXX) || exit 1
CERBERUS_DB_PATH=$D/cerberus.db DATABASE_PATH=$D/auth.db TSX_TSCONFIG_PATH=server/tsconfig.json \
  node --import tsx .verify/probe-cerberus-store.mjs
```
| Probe | Proves |
|---|---|
| `.verify/probe-cerberus-store.mjs` | `user_version` 1, WAL, `busy_timeout` 5000, `foreign_keys` 1, and each repository verb through the barrel |
| `.verify/probe-cerberus-open-race.mjs` | 6 processes open a fresh store at one instant, 4 rounds: shipped `BEGIN IMMEDIATE` opened 24 of 24 at `user_version` 1; a deferred-transaction control failed 20 of 24 with `database is locked` (2026-10-06) |

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/cerberus-connection.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/cerberus-schema.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-cerberus-open-race.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-cerberus-store.mjs

## MAN-7806 — The Cerberus repositories — five `cerberus*Db` objects over `cerberus.db`

Connection and schema: MAN-7805. Reach every repository through `@/modules/database/index.js`.

## Contract (all five)
- A repository takes `getCerberusConnection()` inside every method and opens no transaction; a multi-statement unit (enrollment, ingest, a definitions write) is the caller's own transaction on that connection.
- Rows go in and come out as the table stores them: snake_case, epoch-millisecond times, `spec` / `facts` / `data` as JSON text. Parsing and camelCase belong to the caller.
- Row types are `CerberusNodeRow`, `CerberusEnrollTokenRow`, `CerberusProbeRow`, `CerberusCheckRow`, `CerberusStoredResultRow`, `CerberusMuteRow`; the names `CerberusResultRow` and `CerberusMute` are taken by the read model.
- A column named `desc`, `key` or `by` is quoted in every statement.

## `cerberusNodesDb` — `repositories/cerberus-nodes.db.ts`
| Verb | Does |
|---|---|
| `get(id)` / `list()` | one node or `null` / every node, `enrolled_at` then `id` |
| `insert(node)` | throws on a duplicate id |
| `recordHello(id, hello)` | sets `warden_version`, `machine_id`, `facts`; answers whether the node exists |
| `recordHeartbeat(id, now)` | `first_heartbeat_at` keeps its first value; `last_heartbeat_at` written at most once per 60 s, in the `WHERE`; answers whether a row was written |
| `setAckedSeq(id, seq)` | never lowers `acked_seq`; answers whether it moved |
| `setChecksVersion` / `setChecksAcked` | set the two hand-off numbers |

No verb deletes a node.

## `cerberusEnrollDb` — `repositories/cerberus-enroll.db.ts`
| Verb | Does |
|---|---|
| `insert(token)` | stores the hash, unspent; throws on a duplicate hash |
| `find(hash)` | the row, spent and expired included, or `null` |
| `latestForName(name)` | newest by `issued_at`, `rowid`, or `null` |
| `markUsed(hash, name, now)` | ONE `UPDATE` carrying hash, name, `used_at IS NULL`, `expires_at > now`; answers `changes` — 1 won, 0 refused (wrong name, spent, expired or unknown) |
| `pruneOlderThan(at)` | deletes by `issued_at < at`, spent or not; answers the count |

## `cerberusDefinitionsDb` — `repositories/cerberus-definitions.db.ts`
| Verb | Does |
|---|---|
| `probesOf(node)` / `checksOf(node)` | by service then key; `checksOf` includes retired rows |
| `upsertProbe(probe)` | insert, or replace every column |
| `deleteProbe(node, key)` | deletes the row; its checks are the caller's to retire |
| `upsertCheck(check)` | see below |
| `retireCheck(node, key, at)` | stamps `retired_at` while active; no verb deletes a check |
| `setCheckLabel` / `setServiceLabel` | `null` clears; a service label is written on every check of the service |
| `activeChecks(node?)` | unretired checks `LEFT JOIN probes` on `COALESCE(checks.probe, checks.source)`; a check whose probe row is gone still appears, with NULL `probe_*` and NULL `stale_after_s` |

`upsertCheck`:
- A NULL `label` or `service_label` keeps the stored one; clearing is `setCheckLabel` / `setServiceLabel` with `null`.
- Clears `retired_at`; keeps the first `discovered_at`.
- Overwrites `service`, `source`, `probe`, `pass`, `warn`, `stale_after`, `version` — `discoverComponent` calls it only for a component with no active check (new, or retired and reported again).
- A new check with no `service_label` takes the one its service's other checks carry.

`STALE_AFTER_SQL` = `COALESCE(c.stale_after, 3 * COALESCE(p.cadence, p.every))`, seconds — the one home of a check's staleness; nothing else re-derives it. A `cadence` of 0 gives 0 s: the definitions service must refuse it.

## `cerberusResultsDb` — `repositories/cerberus-results.db.ts`
| Verb | Does |
|---|---|
| `insert(row)` | `true` wrote; `false` ONLY when `(node, check_key, at)` already holds a row (left as it was); everything else THROWS |
| `latestPerCheck()` | each check's last row plus `since` (the `at` of the newest row whose `prev_status` differs from its status, else the first row) |
| `rowsInWindow(node, keys, from, to)` | per key: rows with `from <= at <= to`, plus the last row before `from` and the first row after `to`; ordered `check_key, at`; `[]` for no keys or `from > to`; a repeated key is read once |
| `recentChanges(node, key, since, limit, until?)` | `change` rows with `since <= at <= until` (`until` unbounded by default), newest first |
| `transitions(before, limit)` | `change` rows with `at < before` whose status differs from `prev_status`, newest first, in WHOLE `at` instants |
| `pruneKeepalivesBefore(at)` | deletes `keepalive` rows with `at < at`; the only delete on `results` |

- `insert` throws `RangeError` unless `Number.isSafeInteger(row.at)`, and throws on a NULL key or a `kind` outside `change` / `keepalive`. The ingest caller must treat a throw as a failed frame and not ack it.
- `status` is SQL NULL for "not enabled"; `prev_status` spells it `not_enabled`. A reader treats the two as one. `statusDiffers` compares through `COALESCE(status, 'not_enabled')`.
- Every `limit` is clamped `Math.max(0, Math.trunc(limit))` (also in `cerberusMutesDb.recent`); `NaN` and `Infinity` throw.
- `transitions` may return more than `limit` rows: a cut inside a group of rows sharing one `at` returns the whole group.
- `transitions` scans `results` — step 0 has no index on `at`. 2026-10-06: 28 ms at 466k rows; 135–162 ms at 1.85–2.3M.

## `cerberusMutesDb` — `repositories/cerberus-mutes.db.ts`
| Verb | Does |
|---|---|
| `insert(mute)` | appends; throws on a duplicate id |
| `get(id)` | one mute or `null` |
| `lift(id, at)` | sets `lifted_at` only while `lifted_at IS NULL AND until_at > at`; an expired mute is never recorded as lifted; answers whether this call lifted it |
| `activeAt(node, key, at)` | `from_at <= at < until_at`, not lifted by `at`; the latest `from_at` wins |
| `overlapping(node, key, from, to)` | mutes in effect at some moment of `[from, to)`, oldest first; end = `MIN(until_at, COALESCE(lifted_at, until_at))` |
| `recent(before, limit)` | mutes with `from_at < before`, ranked by the newest of lift/expiry/start that falls before `before` |

A mute is Cerberus-side only; the warden never hears of it. An expired mute stops matching and nothing writes it down.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-definitions.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-enroll.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-mutes.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-nodes.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-results.db.ts

## MAN-7807 — Cerberus wire contract — `server/shared/cerberus-types.ts` and its browser mirror

One home for every Cerberus shape. Later plans of the arc add frames and read-model fields in `server/shared/cerberus-types.ts` and redefine nothing. Each type's doc comment is the field-level reference; this row is the index and the rules.

## Files
| file | holds |
|---|---|
| `server/shared/cerberus-types.ts` | everything: vocabulary, warden wire, read model, definition and enrollment documents, hint event, server-only seams |
| `src/shared/cerberus-types.ts` | the browser's subset, field for field; imports nothing from `server/` |
| `server/shared/types.ts` | `GatewayEventKind` carries `'cerberus_changed'` (the hint event's `kind`) |

Both files are siblings of the over-ceiling `types.ts`, the `kanban-types.ts` pattern.

## Sections (`//---- NAME ----` banners)
| section | in | types |
|---|---|---|
| VOCABULARY | both | `CerberusStoredStatus`, `CerberusStatus`, `CerberusDocStatus`, `CerberusProbeKind` |
| WARDEN WIRE | server only | `CerberusEnvelope<B>`, `CerberusSignedFrame`, `CerberusHostFacts`, `CerberusHelloBody`, `CerberusNodeCert`, `CerberusWelcomeBody`, `CerberusChecksSet`, `CerberusResultWire`, `CerberusHeartbeatBody`, `CerberusResultBody`, `CerberusAckBody`, `CerberusChecksAckBody`, `CerberusErrorBody`, `CerberusFrameType` |
| READ MODEL | both | `CerberusMute`, `CerberusCell`, `CerberusCheckView`, `CerberusServiceView`, `CerberusNodeView`, `CerberusNeed`, `CerberusActivity`, `CerberusOverview`, `CerberusResultRow`, `CerberusLookup`, `CerberusCheckDetail`, `CerberusCheckIndexEntry` |
| DEFINITIONS AND ENROLLMENT | both | `CerberusEnrollment`, `CerberusEnrollmentStatus`, `CerberusProbeDefinition`, `CerberusServiceDefinition`, `CerberusDefinition`; `CerberusProbeSpec` is the one wire-born shape repeated in the browser file (a definition carries probes as their spec); the server file has it under WARDEN WIRE |
| THE HINT EVENT | both | `CerberusChangedEvent` |
| SERVER-ONLY SEAMS | server only | `CerberusLinkState`, `CerberusGatewayState`, `CerberusCheckMemory`, `CerberusReadInputs` |

## Rules an editor must not break
- Every time is epoch milliseconds; every duration (`every`, `timeout`, `cadence`, `staleAfter`) is seconds.
- JSON is camelCase on every wire; SQL is snake_case (`staleAfter` ↔ `stale_after`).
- A shared type is edited in both files in the same change. why: a field renamed on one side is a screen that stops reading.
- The browser file imports nothing from `server/`, and a type that names a server-only type is not shared. why: the client tsconfig does not compile server code.
- A comment in the browser file must not name a server-only type (`CerberusCheckMemory`, `CerberusLinkState`).
- `CerberusFrameType` widens as plans land (`run.*`, `diag.*`, `update.*`, `session.*`, `catalog.*`); `CerberusActivity` gains `fix`, `catalog`, `diagnosis`, `warden`. A reader switches on `type` / `kind` and ignores one it does not know.
- Format with prettier `--single-quote --print-width 100`, as `claude-update-types.ts`.

## Meanings fixed here that later phases inherit
| type.field | meaning |
|---|---|
| `CerberusNodeView.link` | decided in order: `never` (no first heartbeat on record; wins over `silent`), `reporting` (heard within 90 s), `silent`. The hub is `reporting`; its `lastHeardAt` is its newest self-check, its `wardenVersion`, `silentSince` and `enrolledAt` are null |
| `CerberusNodeView.lastHeardAt` | last frame of any kind; falls back to the node row's stored last heartbeat when nothing was heard since boot. `silentSince` = that + 90 000 while silent, else null |
| `CerberusLinkState.lastHeardAt` | null until a frame is heard since boot; `silentSince` null with it. The read model fills the node's `lastHeardAt` from `nodes.last_heartbeat_at` |
| `CerberusLookup.verdict` | `result` (fresh then; no row need exist at that very moment), `stale` (past what the rows vouch for, or on or after a current silence's start), `too_early` (no row at or before it), `future` |
| freshness rule | between two stored rows: fresh while moment ≤ (next row's `prevAt`, else the earlier row's `at`) + `staleAfter`; past the latest row: fresh while ≤ (center's in-memory last-received time for the check (`CerberusCheckMemory.lastReceivedAt`), else the row's `at`) + `staleAfter`. A stored row's own age proves nothing. Implemented in MAN-7808 |
| `CerberusStoredStatus` | only `status` is limited to its four words; a null status is stored null; only `prev_status` spells it `not_enabled` |
| `CerberusProbeSpec` at rest | `probes` row holds the kind's fields as JSON, `every`, `timeout`, `cadence`; the `checks` row holds `pass`, `warn`, `staleAfter`; a `checks.set` joins the two |
| `CerberusNodeCert.sig` | ed25519 over the UTF-8 bytes of `cerberus-cert\n<node>\n<fingerprint>\n<issuedAt>` (`issuedAt` decimal ms); `centerKey` is not in the text. `issueCert` (MAN-7800) signs these bytes and the warden's verification must use exactly them; change the comment first if the layout changes. The cert rides the enrollment `welcome` AND every connect `welcome` (same bytes each time); a warden that holds one ignores a repeat |
| `CerberusChangedEvent` | a hint: `nodes` are ids, each `checks` entry is `<node>/<key>` split at the FIRST `/`; coalesced to one a second; never sent for a result that was not stored |

## Open
- `CerberusProbeSpec.cmd`: run through a shell or split into argv — the warden plan decides.
- `CerberusHelloBody.catalogVersion`: its comment says `checks` is sent in `welcome` when versions differ; only `checksVersion` drives `checks`.

## Cross-references
- Store: MAN-7805. Repositories (row types `Cerberus*Row`, distinct from the read model's `CerberusResultRow` and `CerberusMute`): MAN-7806. Read model that builds these shapes: MAN-7808.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/cerberus-types.ts

## MAN-7808 — The read model — entry points, status words (`SEV`, `not_enabled` at −1) and the freshness rule

Turns the Cerberus store (MAN-7806) plus one `CerberusReadInputs` into the wire shapes of MAN-7807. Pure over those two: reads, opens no transaction, writes nothing, derives every status at read time. `cerberus.routes.ts` is its one caller (the module builds the `CerberusReadInputs` per request); other modules reach Cerberus only through `server/modules/cerberus/index.ts`.

Continues in MAN-7809 (overlays, node link, cells, check view, overview, lookup) and MAN-7810 (What happened).

## Entry points
| function | file | answers |
|---|---|---|
| `buildOverview(inputs)` | `overview.ts` | `CerberusOverview`: hub node first, then every enrolled node |
| `checkDetail(node, key, { lookupAt, end }, inputs)` | `check-detail.ts` | `CerberusCheckDetail`: check and siblings (always now), 60 cells ending at the minute boundary after `end` and `recent` (the change rows of `[end − 3 h, end]`), lookup (at `lookupAt ?? end`); `end` defaults to now and is clamped to it |
| `checkIndex()` | `check-detail.ts` | `CerberusCheckIndexEntry[]`, active checks by node, service, key |
| `lookupAt(node, key, at, inputs)` | `lookup.ts` | `CerberusLookup`; `lookupOfCheck(check, at, inputs)` when the check row is in hand |
| `activity({ before, limit }, inputs)` | `activity.ts` | `CerberusActivity[]`, newest first |
| `statusAt(rows, x, staleAfterMs, liveLastAt, now)` | `freshness.ts` | `{ verdict, row }`; the fifth argument `now` exists because `future` needs a clock |
| `windowStatus(rows, a, b, staleAfterMs, liveLastAt)` | `freshness.ts` | the worst word over `[a, b)` |

Helpers: `status-rules.ts`, `overlays.ts`, `cells.ts`, `series.ts` (`CheckSeries`, `loadSeries`), `check-views.ts` (`buildCheckView`, `findActiveCheck`), `node-links.ts` (`resolveNodeLink` → `ResolvedNodeLink`, `silentSinceOf`). `CheckSeries` and `ResolvedNodeLink` are exported from their producing file, not from `cerberus-types.ts`; `StatusAtAnswer` is file-local.

## Status words (`status-rules.ts`)
| rule | detail |
|---|---|
| `SEV` | `not_enabled` -1, `ok` 0, `paused` 1, `muted` 1, `unknown` 2, `warn` 3, `failing` 4, `denied` 5 |
| `worst(a, b)` | higher `SEV`; a tie keeps `a` (the first argument) |
| fold seed | every fold starts from `not_enabled`, never `ok`: a service of only not-enabled checks reads `not_enabled`; no checks reads `unknown` |
| `needsAttention(s)` | `SEV >= warn`; `muted`, `unknown`, `not_enabled` never need you |
| `shown(stored)` | `stored ?? 'not_enabled'` |
| `shownRow(row)` | `not_enabled` for a stored NULL; `unknown` for a word outside the four stored words (never passing, counted as unknown) |
| `storedStatusOf(row)` | the four words, else null — a bad word is null on the wire |
| `statusOf(word)` | a `SEV` key, else `unknown`; reads `results.prev_status` |

## Freshness (`freshness.ts`)
Rows are ONE check's, oldest first, as `rowsInWindow` returns them (last row before the range, first after). A row missing from the middle makes a healthy stretch read as a lapse.

| moment `x` | rule |
|---|---|
| row `r` at or before `x`, next row `n` exists | fresh while `x <= (n.prev_at ?? r.at) + staleAfterMs`; null `prev_at` ⇒ only `r.at` vouches |
| `r` is the last row | fresh while `x <= (liveLastAt ?? r.at) + staleAfterMs`; `liveLastAt` = `inputs.memory(node, key).lastReceivedAt` |
| no row at or before `x` | `too_early` |
| `x > now` | `future`; rows not read |
| not fresh | `stale`; the status shown is `unknown`, never the old word |

- `windowStatus` = `worst` of: status at `a`; every row with `a < at < b`; `unknown` if any lapse overlaps the window; status at `b - 1`.
- A lapse is `(freshUntil, next.at)`, open-ended after the last row.
- `b <= a` reads as the single moment `a`. A window ends at or before `now`; the caller clips.
- Staleness (`stale_after`) resolves ONCE, in `cerberusDefinitionsDb.activeChecks` (`STALE_AFTER_SQL`, MAN-7806): the check's own `stale_after` override, else 3 × the probe's `cadence ?? every`, in seconds, as `stale_after_s`. The read model only reads `stale_after_s` (`staleAfterSecondsOf`), else 300 s when the probe row is gone. Ingest mirrors the rule only for a component with no check row yet.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/activity.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/cells.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/check-detail.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/check-views.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/freshness.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/lookup.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/node-links.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/overlays.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/overview.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/series.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/status-rules.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-cerberus-read-model.mjs

## MAN-7809 — The read model — mute and silence overlays, node link, cells, check view, overview (Needs you, counts), lookup

Part of the read model; entry points and the freshness rule: MAN-7808.

## Overlays (`overlays.ts`)
- Applied by `layerOverlays(status, windowEnd, mutes, silentSince)` at a window's END, in this order: silence, mute.
- Silence: `silentSince !== null && windowEnd > silentSince` ⇒ `unknown`. Wins over a mute. A silence that has ended is not remembered.
- Mute: `needsAttention(status)` and a mute covers `windowEnd` ⇒ `muted`. Cover = `from_at <= at < until_at`, not lifted by `at`; latest `from_at` wins, then lower `id`.
- Hub and a node with no row are never silent (`silentSinceOf` returns null).
- A mute is named on a check view and on every lookup verdict except `future`, whatever the status.

## Node link (`node-links.ts`)
- `lastHeardAt` = live `state.lastHeardAt`, else `nodes.last_heartbeat_at`.
- `silentSince` = live `state.silentSince`, else `lastHeardAt + 90 000` when unheard for more than 90 s; a value after `now` is null.
- `link`: `never` if `first_heartbeat_at` is null (wins), else `silent`, else `reporting`. `silentSince` is set for a `never` node too, so the overlay applies to it.
- The wire's `silentSince` is non-null only while `link === 'silent'`.

## Cells (`cells.ts`)
- `count` one-minute cells end at the NEXT minute boundary `(floor(now / 60000) + 1) * 60000`; the last cell is read over `[from, now)`.
- Service cell `worst` = key of the first check to reach the cell's status, only when that status is worse than `ok`; else null. A check's own strip has `worst` null.
- Overview strips are 30 cells, a check's sheet 60. `stripStart(now, count)` is the first cell's `from`.
- `now` is the caller's moment: the overview passes now, a check's strip passes the sheet's `end` (`checkDetail`, MAN-7808).

## Check view (`check-views.ts`)
- `status` = `statusAt` at `now`: the latest row's word while fresh, else `unknown`; then overlays at `now`.
- `stored`, `value`, `at` stay the latest row's own under an `unknown` or `muted` status.
- `since`: ingest's `memory().since` for a non-`unknown` status; for `unknown`, the earlier of (`(liveLastAt ?? lastRow.at) + staleAfterMs`, silence start), each only if before `now`; null for a check that never reported.
- `kind`: probe's, `self` for the hub, else `health_doc` when the check has a `source`, else `http` (best guess for a check whose probe row is gone). `origin`: `self`, `component` (source and no probe), `probe`.

## Overview (`overview.ts`)
| rule | detail |
|---|---|
| nodes | hub `center` first: role `hub`, link `reporting`, `lastHeardAt` = newest self-check (newest row or `liveLastAt`), `wardenVersion` / `silentSince` / `enrolledAt` null; then `cerberusNodesDb.list()` |
| services | every service with an active check, plus every probe's service with no check yet (draws `unknown`), by name |
| `counts.checks` | active checks minus the not-enabled; a retired check is in no count |
| fleet `counts` | `checks`, `passing`, `needsYou`, `muted` are the sums of the services' counts; `nodes` = the hub plus every enrolled node |
| service `counts` | `total` = checks minus not-enabled; `passing`, `needsYou`, `muted`, `notEnabled`, `unknown` each count the checks whose current status is that word |
| `needsYou` | `needsAttention` checks, oldest `since` first, null `since` last, then key, then node |
| `muted` | checks with a mute covering now, whatever their status |
| `activity` | newest 7 |
| `lastResultAt` | newest stored row at or before `now`, across nodes |

## Lookup (`lookup.ts`)
| verdict | `status` | `value` | `resultAt` |
|---|---|---|---|
| `result` | row's word, mute that was active THEN laid over | the row's | the row's `at` |
| `stale` | `unknown` | null | `at` of the row it rests on, null if none |
| `too_early`, `future` | null | null | null |

- A moment at or after a current `silentSince` answers `stale`.
- A retired or unknown check throws `AppError` 404, code `CERBERUS_UNKNOWN_CHECK` (`findActiveCheck`): a retired check has no staleness to judge by.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/cells.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/check-detail.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/check-views.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/lookup.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/node-links.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/overlays.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/overview.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/series.ts

## MAN-7810 — The read model — What happened (`activity.ts`), its open edge, and the read-model probe

Part of the read model; entry points and the freshness rule: MAN-7808.

## Activity — What happened (`activity.ts`)
- Sources: `cerberusResultsDb.transitions`, `cerberusMutesDb.recent`, `cerberusNodesDb.list()` enrollments. Each source is asked for `limit` of its own newest.
- The answer runs to the end of the `at` instant the `limit`-th event sits in; a cursor `before = <last at>` therefore loses none.
- Mute events: `muted` at `from_at`; `lifted` at `lifted_at`; `expired` at `until_at` once past, only when never lifted. A lifted mute never reads `expired`.
- Same instant orders by node, check, kind. `check.from` goes through `statusOf`, `to` through `shownRow`.
- Throws `RangeError` for a non-numeric or NaN `before` / `limit`; `limit <= 0` returns `[]`.
- `check-detail.ts` `recent` = the newest 100 `change` rows of `[end − 3 h, end]` (`end` is now unless the caller asked for an earlier moment), `status` through `storedStatusOf`.

## Open
- Activity paging: two mutes whose newest events share the cut instant lose one event across pages, because `cerberusMutesDb.recent` returns exactly `limit` mutes. Cure: return whole tie groups, as `transitions` does (MAN-7806).

## Prove it
`.verify/` is gitignored. The probe refuses unless both paths start with `/tmp/`:
```sh
D=$(mktemp -d /tmp/cerberus-readmodel.XXXXXX) || exit 1
CERBERUS_DB_PATH=$D/cerberus.db DATABASE_PATH=$D/auth.db TSX_TSCONFIG_PATH=server/tsconfig.json \
  node --import tsx .verify/probe-cerberus-read-model.mjs
case "$D" in /tmp/cerberus-readmodel.*) rm -rf "$D" ;; esac
```
| scenario | proves |
|---|---|
| overview, eis1 reporting | counts, `needsYou` order, muted list, 30-cell strips, a lapse inside one cell, a tie in the cell fold |
| lookup | `result` inside a deduplicated stretch, `stale` in a gap, `too_early`, `future`, mute named; the freshness edge (`prev_at + staleAfter` is `result`, +1 ms is `stale`); a mute covers the moment before its `until` or lift, not the moment of it |
| check sheet | siblings, 60 cells, `recent` change rows only, retired check 404 and absent from the index |
| activity | newest first, transitions only where the word changed, mute events, a page by `before` continues exactly, early-lifted mute never reads `expired` |
| eis1 silent | cells after `silentSince` and eis1's checks read `unknown`; lookup after `silentSince` is `stale`; hub untouched |
| boundary `now` | exactly on a minute boundary still draws 30 cells |

Seed through the repositories and pass a hand-built `memory` standing in for `ingest.memory`. Verdict `ALL PASS` or `N FAILED`; exit 0 or 1.

## Cross-references
Wire shapes and meanings: MAN-7807. Store and repositories: MAN-7805, MAN-7806. `HUB_NODE_ID` (`center`) lives in `server/modules/cerberus/definition-document.ts`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/activity.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-cerberus-read-model.mjs

## MAN-7811 — Ingest — `ingest.ingestResults`: one transaction per frame, what is refused, what is announced, the memory doors

`ingest.ingestResults(node, seq, results, keepalive = false)` → `{ stored, changed }`: where a warden's results, and center's own, become rows. Which results become rows, the columns they carry and what memory they set: the storage rule, MAN-7801.

- `seq` is null for center's own self-checks. The caller acks AFTER it returns.
- One `BEGIN IMMEDIATE` transaction per call: a frame is stored whole or not at all. Memory (`lastStored`, `since`, `lastReceivedAt`) moves only after the commit, so a rolled-back frame's resend is judged against the truth.
- `keepalive = true` stores an unchanged result as a keepalive at once instead of after five quiet minutes. Only the self-checks' clean stop passes it (MAN-7804).
- An absent `value` or `docStatus` reads as null; `status` must be written (null = not enabled).
- A row already under `(node, check_key, at)` is skipped, not an error: a handover's other process wrote it.

A REFUSED result is dropped and logged once per `node/key: reason` (never thrown, so the frame is still acked). A frame whose `results` is not a list returns `{ stored: 0, changed: [] }`.
| refused when | note |
|---|---|
| key not `<service>/<id>` | |
| key not owned: no probe of the node equals it, and `source` is not a `health_doc` probe whose service prefixes it | |
| key equals a probe's own key but `source` ≠ that key | the same key from the health document is refused. why: two writers on one check would interleave and every flip would reach `onChange` |
| `at` not a safe integer, or more than 300 000 ms ahead of this clock | why: a future `at` would become `lastStored` and every honest result after it would be skipped |
| status outside `ok warn failing denied`; `docStatus` outside `green yellow red muted`; `value` not text; `source` not text | |

The vocabulary test runs BEFORE `discoverComponent`, so a refused result leaves no check behind.
A warden whose clock runs more than 5 minutes fast has all its results refused (one log per key) until the clock is fixed.
A probe's own check must report `source` = its key: center's self-checks send `source = key`; any other source is refused.

Outputs after the commit: `hintChanged` for the stored `change` keys and the discovered keys; `onChange` listeners get one call per frame, `{ node, changed: CerberusStatusChange[] }` (`from` null at first sight), a throwing listener is logged and skipped.
`seedMemory()` fills `lastStored` and `since` from `latestPerCheck()`; `memory(node, key)` → `CerberusCheckMemory`.

## Open
- `ingest.service.ts` is 299 of 300 lines: growth means an extraction first (`storeFrame`'s judging).
- Ingest memory is per process: two processes ingesting one node during a handover drift apart.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/ingest.service.ts

## MAN-7812 — Definitions — key grammar, `parseDefinition`, `putDefinition` and the `checks.set` hand-off to a warden

What a node runs and what it is called: the key grammar, the definition document, `putDefinition` and the `checks.set` hand-off to a warden. Names and discovered components: MAN-7813. Ingest: MAN-7811. Link registry: MAN-7814. The REST routes and the hint: MAN-7802. Store: MAN-7805, MAN-7806. Wire shapes: MAN-7807.

## Files
| file | owns |
|---|---|
| `definition-document.ts` | key grammar (`HUB_NODE_ID`, `NODE_ID_PATTERN`, `SERVICE_ID_PATTERN`, `CHECK_ID_PATTERN`, `MAX_LABEL_LENGTH`, `PROBE_KINDS`, `KIND_FIELDS`) and `parseDefinition(node, body)` → `{ ok: true, services }` or `{ ok: false, path, message }`; touches no store |
| `definition-rows.ts` | pure document ↔ rows map: `probeSpecOf`, `specOfDefinition`, `specSetSignature`, `probeRowOf`, `ownCheckUpsertOf`, `ownChecksByKey`, `definitionFromRows` |
| `definitions.service.ts` | the one writer of probes, checks, labels; reads them as documents: `putDefinition`, `getDefinition`, `checksSetFor`, `setLabel`, `retireCheck`, `discoverComponent`, `seedHub` |

## Key grammar
| thing | rule |
|---|---|
| node | `^(?!center$)[a-z0-9][a-z0-9-]{0,31}$`; `center` (`HUB_NODE_ID`) is center's own node: no warden, no `nodes` row |
| service id | `^[a-z0-9][a-z0-9-]{0,47}$` |
| check id | `^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$` |
| check key | `<service>/<id>`; a `health_doc` probe's key is `<service>/health` |
| hint `checks` entry | `<node>/<key>`, split at the FIRST `/` |

## `parseDefinition` refusals (each answers the path of the first wrong thing)
- A field the kind does not own is refused at its own path (`url` on `tcp`; a `staleafter` typo). Fields per kind: `KIND_FIELDS`, all required.
- `cadence` is allowed on `health_doc` only. why: staleness stays `3 × (cadence ?? every)` for every kind.
- `file_age` without `pass` → `services[i].probes[j].pass`. `pass` and `warn` stay text.
- A service with no probes; a service listed twice; a probe key not starting `<service>/`; a `service` field naming another service; a `node` naming another node.
- Durations are whole seconds 1 to 2 592 000. `url` is http or https. `port` 1 to 65 535. A label is a string up to 200 characters; `''` clears.
- The document's `version` is ignored; the store owns it.

## `putDefinition(node, body)` → `{ version }`
Order: unknown node 404 `CERBERUS_UNKNOWN_NODE` → parse (400 `CERBERUS_BAD_DEFINITION`, `details.path`) → one `BEGIN IMMEDIATE` transaction → `hintChanged` → `wardenLinks.send(node, 'checks.set', …)` when the set changed.
1. Each document probe is upserted with its own check (the check's key IS the probe's key).
2. A probe that left the document is deleted; its own check and the components its health document discovered are RETIRED (`retired_at`, history kept).
3. The version in the transaction is read under the write lock.
4. A `labels` entry must name a component a health document has ALREADY carried: one not yet seen is refused at `services[i].labels.<id>` (400, the whole write rolled back), because there is no row yet for the label to land on (INV-6981). So a first definition goes in TWO writes to this one route: the probes without `labels`, then — once the health document has been read and its components appear in the overview — the full document with them. Measured on eis1 2026-10-06: the first PUT answered `{"version":1}`, 74 components appeared within a minute, the second PUT (all 74 labels) answered `{"version":1}` — labels do not bump the version.

| change | `checks_version` | `checks.set` |
|---|---|---|
| anything a warden runs (`specSetSignature` differs: key, service, kind, `every`, `timeout`, `cadence`, kind fields, `pass`, `warn`, `staleAfter`) | +1 | sent down the link; an unlinked node gets it in its next `welcome` |
| labels only, or an identical document | same | not sent |

`wardenLinks.send` answering false is not an error: the warden's next `hello` asks again.

## Open
- `definitions.service.ts` is 299 of 300 lines: growth means an extraction first.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/definition-document.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/definition-rows.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/definitions.service.ts

## MAN-7813 — Labels and components — a label never clears by omission, `setLabel`, `seedHub`, `discoverComponent`

Names and discovered components, written by `definitions.service.ts`. Definitions and `putDefinition`: MAN-7812. The routes: MAN-7802.

## Labels
- A label never clears by omission: a probe, service or component the document gives no label keeps its old one. An explicit `''` clears (stored NULL).
- `services[i].labels.<id>` for a component with no check row is REFUSED 400 `CERBERUS_BAD_DEFINITION` at that path and the whole PUT rolls back. A new `health_doc` service's first PUT cannot carry component labels; add them after the first sighting.
- `setLabel({ node, key | service, label })`: exactly one of `key` / `service` else 400 `CERBERUS_BAD_LABEL`; a non-string or over-length label 400 `CERBERUS_BAD_LABEL`; an unknown check or service 404 `CERBERUS_UNKNOWN_CHECK`. `center` is a known node for labels; every other write needs an enrolled node. `retireCheck` refuses `center` outright (409 `CERBERUS_HUB_CHECK`: `seedHub` would revive the check at the next start) and a node that is not enrolled (404 `CERBERUS_UNKNOWN_NODE`).
- `seedHub()` writes `center`'s three `self` probes (`cerberus/wardens.fresh`, `cerberus/gateway.listening`, `cerberus/store.write`), every 30 s, version 0, idempotent. A label a person changed is kept: the seed words go only to a row with none.

## Components
- `discoverComponent(node, key, sourceProbeKey, at)` files a check with `source` = the `health_doc` probe, `probe` NULL, `discovered_at` = `at`; it revives a retired one with its label.
- Inside a transaction it does NOT hint (`getCerberusConnection().inTransaction`); outside one it does. Ingest hints after its own commit.
- `DELETE` of a component whose health document still lists it is undone by its next result. Muting is the tool for that.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/definition-document.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/definition-rows.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/definitions.service.ts

## MAN-7814 — The link registry — `wardenLinks`: silence, attach and detach, frame handlers, `seedFromStore`

The registry every warden's link joins: who is connected, when each node was last heard, and the handlers frames are routed to. The link that feeds it: MAN-7803. The hint a link change causes: MAN-7802. All of it is memory; the store is read once, by `seedFromStore`.

## Registry
- Socket and silence are separate: silent = `now − lastHeardAt > 90 000` or never heard, socket open or not. `silentSince` = `lastHeardAt + 90 000`, null when never heard.
- Any frame counts as hearing the node; `heard` only moves the stamp forward and tells listeners at once when it ends silence. Entering silence is found by a 5 s `unref`'d timer started by the first `attach`, `heard` or `seedFromStore`.
- `seedFromStore()` reads each node's `last_heartbeat_at` as `lastHeardAt`; seeding raises no change event. A node unheard since before the boot reads silent at once (its stored stamp is old); a handover's one-second gap never does (the stamp is at most a minute old); a node that never sent a heartbeat has no `lastHeardAt` and is silent until it does.
- `attach(link)`: an older link of the node is closed `4000`, `replaced by a newer link`; its `close` throwing is logged and the new link is still in place and announced. `detach(link)` does nothing when the node's current link is another. A link's version and clock offset outlive it.
- `send(node, type, body)` → false for no link or a throwing link (logged). Callers send after their write committed; a socket throw must not turn a committed write into a failure.
- `registerHandler(type, handler)` THROWS on a second registration of one type. why: two plans claiming a frame fail at boot, never one silently replacing the other. A handler's throw or rejection is the link's to log.

## API
Types `CerberusWardenLink` (`node`, `send`, `close`, `version`, `clockOffsetMs`) and `CerberusFrameHandler` (`(node, body, env) => void | Promise<void>`) are exported from `warden-links.ts`.

| call | does |
|---|---|
| `get(node)` / `isLinked(node)` | the node's open link or `null` / whether a socket is open now (not whether the node was heard lately) |
| `send(node, type, body)` | one frame down the node's link; `false` when it cannot |
| `onChange(listener)` | `(node, state)` on attach, detach and entering or leaving silence; answers the unsubscribe |
| `registerHandler(type, fn)` / `handlerFor(type)` | the door later plans add frames through (`run.*`, `diag.*`, `update.*`, `session.*`) |
| `states()` | `Map<node, CerberusLinkState { linked, lastHeardAt, silentSince, clockOffsetMs, version }>` for every node the registry knows |
| `attach`, `detach`, `heard`, `seedFromStore` | the link's own calls (`warden-link.ts`) and the module's `start()` |

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-links.ts

## MAN-7816 — Cerberus — row map: where each subject is documented, and the rules of the module

Design: `design/cerberus/Cerberus Spec.dc.html`. Time is epoch milliseconds on every wire; JSON is camelCase, SQL snake_case. Package summary: MAN-7815.

## Where each subject lives
| subject | row | code |
|---|---|---|
| process wiring, what every process runs vs the takeover holder (`soleDuties()`), the three self-checks, configuration | MAN-7804 | `cerberus.module.ts`, `index.ts`, `self-checks.service.ts`, `store-prune.service.ts`, `.env.example` |
| the warden gateway: listener, credential check before the upgrade, the eight 401 refusals, one link | MAN-7803 | `warden-gateway.ts`, `warden-auth.ts`, `warden-link.ts` |
| identity and signing: center's key, connect signature, signed frames, node certificate, enrollment write | MAN-7800 | `center-key.ts`, `warden-enrollment.ts` |
| the link registry `wardenLinks`: silence, handlers | MAN-7814 | `warden-links.ts` |
| ingest: one transaction per frame, refusals | MAN-7811 | `ingest.service.ts` |
| the storage rule: change or keep-alive, `prev_status`, `since`, retention | MAN-7801 | `ingest.service.ts`, `store-prune.service.ts` |
| definitions, `putDefinition`, `checks.set` | MAN-7812 | `definition-document.ts`, `definition-rows.ts`, `definitions.service.ts` |
| labels, discovered components, `seedHub` | MAN-7813 | `definitions.service.ts` |
| the read model: status words, freshness | MAN-7808 | `read-model/status-rules.ts`, `freshness.ts`, `series.ts` |
| the read model: overlays, cells, overview (Needs you, counts), lookup | MAN-7809 | `read-model/overlays.ts`, `cells.ts`, `check-views.ts`, `overview.ts`, `lookup.ts`, `node-links.ts`, `check-detail.ts` |
| the read model: What happened | MAN-7810 | `read-model/activity.ts` |
| the REST surface, its error codes, the `cerberus_changed` hint | MAN-7802 | `cerberus.routes.ts`, `mutes.service.ts`, `enrollments.service.ts`, `cerberus-broadcast.ts` |
| the store: path, connection, schema steps | MAN-7805 | `server/modules/database/cerberus-connection.ts`, `cerberus-schema.ts` |
| the five repositories | MAN-7806 | `server/modules/database/repositories/cerberus-*.db.ts` |
| edits that break the store | INV-7004 | the same files |
| the wire contract | MAN-7807 | `server/shared/cerberus-types.ts`, `src/shared/cerberus-types.ts` |
| the whole system, once: enroll, link, ack on a scratch center; the hub through a live handover | MAN-7804 | `.verify/cerberus-whole.sh`, `.verify/cerberus-whole.mjs`, `.verify/cerberus-whole-live.mjs` |
| the scratch probe server and its slots | MAN-673 (`cloudcli:docs`) | `scripts/sunset-probe.sh` |
| the API process's second port | MAN-553 (`cloudcli:docs`) | `deploy/systemd/` |

## Rules of the module
- Other modules reach it only through `server/modules/cerberus/index.ts`: `createCerberusModule`, `wardenLinks`, `ingest`.
- The store's connection, schema and repositories live in `server/modules/database/` and leave it through its barrel; no module opens a `Database` of its own.
- Shared shapes live in `server/shared/cerberus-types.ts`; there is no module-local `types.ts`.
- Routes parse, call one service verb, answer.
- No unit tests: each seam is shown on the real API or on the scratch server of `scripts/sunset-probe.sh`; a probe never opens `~/.cloudcli/cerberus.db` or binds `CERBERUS_LISTEN`'s live address.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/index.ts
