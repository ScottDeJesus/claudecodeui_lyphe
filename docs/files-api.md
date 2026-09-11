# The files API

Three routes back the file manager, mounted under `/api/file-tree` behind `authenticateToken`
like everything else in that namespace, and wired in `file-tree.module.ts`.

| Route | Query |
|---|---|
| `GET …/projects/:projectId/list` | `path` — relative to the project root. Absent, `.` or `./` means the root itself. Entries come back directories-first, then by name, so no client re-sorts. |
| `GET …/projects/:projectId/preview` | `path` — the file. `lines` — clamped to 1–400, defaulting to 200. `start` — the window's first line, clamped to at least 1 and deliberately given no upper clamp; absent, `0`, `-5` or `abc` all mean the top. |
| `POST …/projects/:projectId/files/upload` | multipart `files` (≤ 20) and `targetPath`. |

The bodies are `DirectoryListing`, `DirectoryEntry`, `FilePreview` and `UploadedFileRecord` in
`server/shared/types.ts`, documented field by field where declared. Read them there — a second
copy of a field list is a copy that drifts.

## The rules that bite

1. **`null` means unknown — never `0`, never an invented timestamp.** An entry whose `lstat`
   failed (a permission wall, a name that vanished mid-read) is still listed with both null. A
   symlink publishes no size at all: its own is the length of its target string. `totalLines`
   is null when the READ stopped early — not counted rather than guessed at, and never merely
   because the file is large (rule 4) — while `truncated` still says truthfully whether more
   exists.

2. **A file's own bytes decide text from binary, never its name.** Only an `image/*` MIME
   short-circuits to `kind: 'image'`; everything else is sniffed for a NUL byte in its first
   8 KB, because `mime-types` maps `.ts` to `video/mp2t` and gives `.tsx` nothing at all.

3. **A preview is bounded in bytes, not only in lines.** A line is not a bounded thing — one
   `.map` here is a single 8.2 M-character line — so each line is CLIPPED (never dropped) at
   2,000 characters and the whole body at 256 KB, `truncated` set when either bites. Chunked
   `StringDecoder` reads keep memory flat (60 MB one-liner → ~2 KB); a final line with no newline counts.

4. **A window can open mid-file, and `totalLines` answers for the READ rather than for the file.**
   `start` opens the window somewhere other than line 1 — the lines before it are counted and
   thrown away — which is what lets a `path:line` reference land on its line. Under the 2 MB
   counting cap the walk always runs to the end, so the count is real; above it the read may stop
   as soon as the window is full, and only a read that stopped early answers `null`. A window near
   the END of a large file never fills its budget, reaches EOF anyway, and reports the count it has
   already paid for — which is what lets a client tell a line past the end of a 28 MB log from one
   merely outside the window. A `start` past the end is an empty window rather than an error, and
   above the cap a `start` past what the bytes could possibly hold (`bytes + 1` lines) is answered
   without opening the file at all, since the keep-budget of an unreachable window never fills and
   the read would otherwise stream the whole file to return nothing.

5. **The cap is 100 MB and the configured limit reads 101 MB on purpose.** Busboy refuses AT
   its limit, so a file of exactly 100 MB would be turned away by a message naming 100 MB as
   the maximum; one byte higher makes the stated maximum genuinely allowed. Over it is a 400.

6. **An upload never overwrites.** A taken name becomes `report (1).pdf`, the response's `name`
   is the SAVED name, and `renamedFrom` carries the original — absent, not empty, when nothing
   was renamed, so its presence alone is the signal to say so. The free name is claimed with
   `COPYFILE_EXCL` after an `lstat` (not `access`, which follows a symlink and would 409 forever
   on a dangling one), so a racing upload loses with `EEXIST`, re-checks once, then 409s.

7. **No refusal hands the browser an absolute server path** — the message reaches a person.

| Outcome | Status | Message |
|---|---|---|
| The path climbs out of the project | 403 | `Path must be under project root` |
| An unreadable file or directory | 403 | `Permission denied` |
| A NUL byte in the path, or a name past `NAME_MAX` | 400 | `The path is not valid` |
| A FIFO, socket or device node — caught by `stat` in ~5 ms, since opening a FIFO holds a libuv thread until a writer appears | 400 | `Only regular files can be previewed` |
| Genuinely absent — only a real `ENOENT` may claim this | 404 | `File not found` / `Directory not found` |

8. **The listing reaches through an in-project symlink, where the tree walker never did.** A
   link whose target lives elsewhere passes containment and `list` enumerates it, so anyone who
   can write a symlink in can browse out. Full note: `resolvePathInsideProject`, `server/shared/utils.ts`.

## Proving it

`node .verify/phase-7.mjs`, fetch-driven against the running dev server — no browser. The
windowing half of rule 4 is driven by `node .verify/probe-shapes-lineopen.mjs`, which also carries
it through to the screen. See [verification.md](verification.md).
