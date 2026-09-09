# The simple chat list

An alternative sidebar for someone who does not think in projects: no tree, no search chips, one
project picker, one New chat button, and a flat feed of the chats they started from this view —
newest first. `src/modules/sidebar/SidebarSimpleList.tsx` composes it from two module-private
hooks (`hooks/useSimpleChatList.ts`, `hooks/useSimpleChatRemove.ts`) and is rendered by
`Sidebar.tsx` in a slot `SidebarContent` never imports, so the tree's own code carries no
knowledge of this view. Settings stays reachable either way — this replaces the tree, not the
whole sidebar.

## The tag

A session is *in* the simple list because it was **created from** this view, not because some
later rule decided it belongs there. `sessions.simple_list_at` is `NULL` for every session made
from the project tree and a timestamp for one made here — the list's own sort key, so "newest
tagged" and "most recently started from this view" are the same ordering. The client is the only
thing that knows which composer a send came from, so it is the client that asks to be tagged:
`useSimpleChatListPreferences().enabled` rides along as `simpleList` on the same
`POST /api/providers/sessions` every composer already makes. A conversation is never re-tagged
after creation — turning simple mode off does not detag a chat it made, and back on again does
not retroactively tag one it did not.

`GET /api/providers/sessions/recent?simpleList=true` is the same recents query the project tree's
own sidebar already calls, narrowed by one clause rather than answered by a second endpoint — the
route table, its exact query shape and its response contract live in
[server/modules/providers/README.md](../server/modules/providers/README.md), not here.

## The preference keys

`simpleChatList` (on/off) and `simpleChatProjectId` (which project a New chat here lands in) are
two flat keys in the same per-user preference store every other setting lives in — theme, sort
order, the selected provider. They are not folded into `uiPreferences`: that blob is a typed
boolean reducer (`src/shared/uiPreferences.ts`), and a project id is a `string | null`, not a
flag. The store itself — how a write reaches the mirror before the server, the legacy-key seeding
rule, why a setting born after that migration seeds nothing — is documented once, in
[src/shared/userSettings.ts](../src/shared/userSettings.ts)'s own header.

## Removing a chat

`useSimpleChatRemove` owns the whole flow so the list stays presentational. A chat nobody is
waiting on archives immediately (`DELETE /api/providers/sessions/:id`, no `force` — the row goes
to Archived, never off disk). A chat the busy set says is running asks first: confirming sends one
`chat.abort` frame and archives the moment that session id drops out of the busy set — the same
busy set the running spinner reads, fed by `chat_subscribed`/`complete` frames and a five-second
resync, never a poll this hook owns. An abort the gateway never confirms still ends: a 15 s
fallback archives anyway, so Remove is never a button that can hang forever.

## What this never touches

Tagging, filtering and archiving are all rows in `sessions` — none of it reaches the provider
transcript on disk. Archiving (the only thing Remove ever does) does not delete or rewrite the
`.jsonl` file; only a hard delete with `force=true` — a cleanup path, never a UI button — removes
it, and even that only removes the file, never edits its content. How a session's on-disk identity
is minted, mapped and merged with the filesystem watcher's own view is a separate mechanism this
feature does not change; see
[docs/architecture/03-conversation-handoff.md](architecture/03-conversation-handoff.md).

## Proving it

`.verify/probe-simple-settings.mjs` and `.verify/probe-simple-view.mjs` are the cheap smokes — the
toggle exists in Settings, and the view mounts and un-mounts cleanly. `.verify/phase-17.mjs` is the
full proof: a real tagged chat created through the sealed composer, renamed, followed into Files by
project, idle-removed, and the tree restored on toggle-off. `.verify/phase-18.mjs` covers what
phase-17 leaves untested: a busy row's stop-and-remove path (the dialog, Cancel, Confirm, and the
15 s fallback described above) and the 390 px mobile width. See
[verification.md](verification.md).
