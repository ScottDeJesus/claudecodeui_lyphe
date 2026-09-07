# The file manager

The Files tab: the project tree, the directory in view, and one file read-only beside it.
`src/modules/file-manager/` is `DirectoryListing`, `FileBreadcrumb` and `PreviewPane` under the
one `FileManager` its barrel exports, with `useFileManagerState` holding where it is. The server
half — the routes, the refusal table, the no-overwrite rule — is [files-api.md](files-api.md).

## The rules that bite

1. **One handler opens a path, and it is retired the moment it is acted on.** `WorkspaceMain` owns
   `openRequest: { path } | null`; `handleFileOpen` sets it and brings the Files tab forward,
   `onRequestHandled` puts it back to `null`. This pane is mounted only while that tab is showing,
   so a standing request replays on the next visit and drags the reader out of a folder they had
   since walked into — and a ref cannot hold the mark, because it resets with the unmount. The SAME
   path twice still opens: the wrapper is fresh each time, so identity is the signal, and no nonce.

2. **Four caller families reach that one handler**: the chat's Edit/Write cards and bare links, the
   git panel's changed-file rows, the command palette's file rows, and the tree in this pane —
   which sends every file the same way out, images included. The git row hands over
   `onFileOpen(filePath)` and nothing else — one round trip, since the pane it opens reads no diff.
   The palette registers two ops: `openFile` carries a real path, `openFileReference` a bare chat
   reference that `useFileOpenResolver` matches against the tree first.

3. **State is keyed by project AND directory, and both halves are load-bearing.** A read is shown
   only when it settled for the project and directory now being asked for, so a pane that survives
   a project switch never stands one project's rows under another's name. Refusals split two ways
   on the same principle — a read that did not come back moves nobody. A refused *directory* keeps
   the rows and breadcrumb of where the reader still is and says the refusal beside them; "Up one
   level" needs no listing, so the way out survives. A refused project *root* has nothing honest
   but the refusal — and no upload offer, over a server that CREATES the target it called missing.

4. **`—` is what "we don't know" looks like, and `0 B` is a fact.** Null size and null mtime reach
   the cells straight through: `formatBytes(null)` is `—` while `formatBytes(0)` is `0 B`, and
   `formatRelativeTime` answers `—` rather than "just now" for a row whose `lstat` failed. An
   image's `1440 × 900` is drawn only once `onLoad` reports a natural width. Both formatters live
   in `src/shared/utils.ts` under FORMATTING — `just now`, `4m ago`, `3h ago`, `yesterday`,
   `2 days ago`, then a plain locale date past thirty.

5. **The preview is read-only and has exactly three arms**, because `FilePreview` has three: text
   with line numbers under a footer saying where editing happens, an image the browser measures,
   and a binary offered as a download. Bytes come through `api.readFileBlob` in both the image and
   download paths — the route wants the auth header, so an `<img src>` pointed at it would 401; the
   browser gets an object URL, revoked as soon as it has taken its own reference.

6. **An upload lands in the folder in view, and the toasts say what actually happened.** The target
   is `currentDir`, the saved name is read off the record (`(renamed from …)` when the server
   renamed it), and a 200 is counted rather than trusted: fewer records than files sent raises a
   warning naming the shortfall. A dropped *folder* is counted and refused rather than sent, since
   `dataTransfer` reports it as a zero-byte file and uploading that writes a lie to disk.

7. **What is missing is deliberate.** No editor: a file opened from anywhere in the workspace lands
   in this pane, and all three of its arms are read-only. No New folder, no Rename — the tree
   beside this pane already carries both. A folder's size is `—` and never `N files`, because no
   child count is on the wire and counting one is a read per row.

## Proving it

`node .verify/phase-8.mjs`, headless Chromium against the running dev server. It spends no Claude
turn — the chat card it opens comes from a conversation already on disk. See
[verification.md](verification.md).
