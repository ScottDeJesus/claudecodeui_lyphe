# The files API

Five routes live under `/api/file-tree`, mounted behind `authenticateToken` like everything else
in that namespace and wired in `file-tree.module.ts`. Three carry the
[file manager](file-manager.md) — the listing, the preview and the upload; two, `edit-window` and
`edit`, read and write a text file in line-numbered windows rather than whole, so a save never holds
the file it is writing into memory.

| Route | Query |
|---|---|
| `GET …/projects/:projectId/list` | `path` — relative to the project root. Absent, `.` or `./` means the root itself. Entries come back directories-first, then by name, so no client re-sorts. |
| `GET …/projects/:projectId/preview` | `path` — the file. `lines` — clamped to 1–400, defaulting to 200. `start` — the window's first line, clamped to at least 1 and deliberately given no upper clamp; absent, `0`, `-5` or `abc` all mean the top. |
| `POST …/projects/:projectId/files/upload` | multipart `files` (≤ 20) and `targetPath`. |
| `GET …/projects/:projectId/edit-window` | `path` — the file. `start` and `lines` — clamped exactly like `preview`'s, above. |
| `PATCH …/projects/:projectId/edit` | JSON body `FileLinePatch`: `path`, `baseRev` (the revision this patch was read against), `startLine` (1-based, `totalLines + 1` appends), `deleteCount` (original lines removed from `startLine`), `lines` (replacement text; no element may contain `\n` or `\r`). |

The bodies are `DirectoryListing`, `DirectoryEntry`, `FilePreview`, `UploadedFileRecord`,
`FileEditWindow`, `FileLinePatch` and `FilePatchResult` in `server/shared/types.ts`, documented
field by field where declared. Read them there — a second copy of a field list is a copy that
drifts.

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
| The path climbs out of the project, or a symlink's real target lies outside it | 403 | `Path must be under project root` |
| An unreadable file or directory | 403 | `Permission denied` |
| A NUL byte in the path, or a name past `NAME_MAX` | 400 | `The path is not valid` |
| A FIFO, socket or device node — caught by `stat` in ~5 ms, since opening a FIFO holds a libuv thread until a writer appears | 400 | `Only regular files can be previewed` |
| Genuinely absent — only a real `ENOENT` may claim this | 404 | `File not found` / `Directory not found` |
| The file's revision moved between the read and the write, or between a patch's own two revision checks | 409 | `This file changed on disk since it was opened` |
| A NUL byte in the edited file's first 8 KB | 415 | `This file is not text` |
| A line inside the requested window is not valid UTF-8 | 415 | `This file is not UTF-8 text` |
| A kept line passes 256 KiB | 422 | `A line in this file is too long to edit here` |
| `startLine` past `totalLines + 1`, or `startLine + deleteCount - 1` past `totalLines` | 422 | `The edit reaches past the end of the file` |
| A patch shaped wrong — `startLine < 1`, a negative `deleteCount`, a non-integer, or a replacement line carrying `\n`/`\r` | 400 | `The edit is not valid` |
| Not a regular file, after following any link | 400 | `Only regular files can be edited` |

8. **The listing reaches through an in-project symlink, where the tree walker never did.** A
   link whose target lives elsewhere passes containment and `list` enumerates it, so anyone who
   can write a symlink in can browse out. Full note: `resolvePathInsideProject`, `server/shared/utils.ts`.

9. **A save is guarded by the revision it was opened against, and there is no "save anyway."**
   `rev` is `` `${size}:${mtimeNs}:${ino}` `` from `statExact`, computed once in
   `file-tree-edit.service.ts` and only ever compared elsewhere. Line numbers are the only address
   a partial write has, so once the file changed under it, the old numbers would land in the wrong
   place — a mismatched `baseRev` is refused before a byte moves, and the write is refused again if
   the revision moved between its own two checks.

10. **A save copies what it did not touch, byte for byte, and never re-encodes it.** The bytes
    before `startLine` and after the deleted range are streamed straight from the original file
    into a temp file created next to it (`fileSystem.openExclusive`, with the original's own mode
    bits, so a save cannot strip the group or world access a shared file had), which is renamed
    over the original only once a second revision check still agrees. A latin-1 byte or a CRLF
    outside the edited range travels unchanged; a symlink inside the project keeps being a link,
    because the rename lands on its real target; a hard link is broken by it, which is accepted
    rather than worked around. The one line a save may still write with no terminator is the
    file's own last line, and only when the file did not have one already — an append past an
    unterminated file gets its own newline first, so two lines are never glued into one. Full
    note: `file-line-patch.ts`.

11. **One line model serves both readers, and a probe holds them together.** Lines are split on the
    byte `0x0A` and nothing else: a final segment with no newline is still a line, `"a\n"` is one
    line, `"a"` is one line, and a 0-byte file has none. `file-line-index.ts` is the only code on
    the edit path that splits lines, and it splits BYTES — a line is never decoded there, and the
    service is the only layer that decides what the bytes mean. `.verify/probe-files-api.py` asserts
    that `preview` and `edit-window` answer the same `startLine` and the same lines for the same file
    and window — `big.txt` at lines 1, 4097 and 150000, a CRLF file and one with no final newline —
    so line N in the editor is line N in the read-only preview, and the two models cannot drift
    apart unnoticed.

12. **A deep window is cheap because the line index remembers where lines begin.** Every scan
    records the byte offset of each line numbered `1 + k · 4096` it crossed, in an in-memory LRU of
    at most sixteen revisions keyed by real path and revision, beside the line count, size, final
    terminator and EOL a scan establishes once it reaches the end. Those four are facts about one
    revision, pinned to it and dropped with it. A window at line 150,000 therefore starts 4,096
    lines early rather than at byte 0, and a resuming scan always starts from a checkpoint — never
    from an arbitrary offset, because a checkpoint is only true where the line number it was found
    at is known. It holds bytes for the lines it is collecting and no others, so a window it never
    asked for is never in memory. Full note: `file-line-index.ts`.

## Proving it

`node .verify/phase-7.mjs`, fetch-driven against the running dev server — no browser. The
windowing half of rule 4 is driven by `node .verify/probe-shapes-lineopen.mjs`, which also carries
it through to the screen. `python3 .verify/probe-files-api.py` (prints `API OK`) drives the two edit
routes over HTTP — the windows and their clamps, the patches and the bytes they leave outside the
edited range, the refusals it can stage, an in-project symlink that writes its target and stays a
link, one pointing out of the project that changes nothing, the stale-revision guard, and the line
model of rule 11. See [verification.md](verification.md).
