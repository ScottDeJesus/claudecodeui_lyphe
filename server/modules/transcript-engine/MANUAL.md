<!-- docstore export; edit rows with docstore write, never this file -->

## MAN-10329 — The transcript engine — rust/transcript-engine/ and its door server/modules/transcript-engine/: verbs, protocol, build, config, refusals

The transcript engine is a Rust binary that reads Claude transcripts for the server. Its door, `server/modules/transcript-engine/index.ts`, is the only code that runs it. The engine takes absolute paths from its caller and knows no directory: the transcript layout has one home, `claude-session-synchronizer.provider.ts`.

## The build
- `npm run build:engine` runs `scripts/build-engine.mjs`. It finds cargo on PATH, else at `$CARGO_HOME/bin/cargo`, else at `$HOME/.cargo/bin/cargo`, and runs `cargo build --release --locked --manifest-path rust/Cargo.toml` with `rust/` as its cwd, so the pin in `rust/rust-toolchain.toml` (1.100.1, profile minimal) applies. With no cargo it prints the rustup line and exits 1. No other script chains it, so `npm run build` never builds the engine.
- rustup goes into its default homes for the operator's user: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path --profile minimal --default-toolchain none`. The first cargo run inside `rust/` fetches the pinned toolchain.
- `rust/Cargo.toml` is the workspace (`members = ["transcript-engine"]`, resolver 2; release: opt-level 3, thin LTO, one codegen unit, panic abort). The crate's dependencies are pinned with `=` (serde 1.0.229 with derive, serde_json 1.0.154, rayon 1.12.0, regex 1.13.2, memchr 2.8.3). `rust/Cargo.lock` is kept in git; `rust/target/` is ignored.
- The server runs the binary once per call, so a rebuilt engine is live at the next call and needs no restart.
- The crate has no `#[test]`, no `tests/` and no `benches/`. Each verb is shown on this box's own transcripts.

## The protocol
- Every verb's first stdout line is the header `{"engine":"transcript-engine","protocol":1,"verb":"<verb>"}`. One JSON object per line follows it.
- `PROTOCOL` in `rust/transcript-engine/src/main.rs` and `TRANSCRIPT_ENGINE_PROTOCOL` in `server/modules/transcript-engine/engine-process.ts` are both 1. They change together whenever a verb's input or output changes.
- `transcript-engine --version` prints `transcript-engine 0.1.0 protocol 1`. `--threads N` sets the width, from 1 to 256 (`MAX_THREADS` in `main.rs`, twin of `TRANSCRIPT_ENGINE_MAX_THREADS` in `engine-process.ts`; anything else exits 2); the default is every core the process may use.
- Exit codes: 0 means every record was written. 2 means the job (its arguments or stdin) could not be read, with the reason on stderr. 3 is only for `usage`: its one file could not be read, with one stderr line. Under the other verbs, an unreadable file is a record carrying `error`, never an exit. SIGTERM or a closed stdout (EPIPE on a pipe, ECONNRESET on the socketpair Node's `spawn` hands a child) ends the program quietly, exit 0.
- `main.rs` has one match arm per verb.

## Lines (`src/lines.rs`)
- A file is read whole (no mmap) into a buffer its thread reuses.
- A line ends at a newline. A trailing carriage return and the surrounding ASCII whitespace are dropped. A blank line is skipped, bytes that are not UTF-8 are decoded lossily, and a line that does not parse is skipped.
- A row is parsed into typed structs that borrow from the buffer and skip unknown fields. A row the typed shape refuses is parsed again as `serde_json::Value` and read by the same rules.

governs: /home/lyphe/.claude/claudecodeui_lyphe/rust/transcript-engine/, /home/lyphe/.claude/claudecodeui_lyphe/rust/transcript-engine/src/search/claude_row.rs, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/transcript-engine/, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/claude-transcript-rows.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/local-commands.ts

## MAN-10330 — The transcript engine — rust/transcript-engine/ and its door — Verbs
section: The transcript engine — rust/transcript-engine/ and its door server/modules/transcript-engine/: verbs, protocol, build, config, refusals/001 Verbs

- `transcript-engine usage <absolute path>` (`src/usage.rs`) writes one line per row whose `type` is `assistant` and whose `message` carries a `usage` object, in file order: `{"type":"assistant","isSidechain":…,"message":{"id":…,"usage":{…}}}`. `isSidechain` and `id` appear only when written; `usage` is verbatim. Its consumer is `summarizeClaudeTokenUsage` and `sumClaudeSessionOutput` in `provider-token-usage.service.ts`, which read nothing else of a row. That service's `readClaudeUsageRows` dependency (the door's by default) serves both whole-transcript reads. `parseClaudeUsageEntries` is left only for the tail read, and `readTextFile` only for Codex.
- `transcript-engine titles` (`src/titles.rs`) reads its job from stdin, `{"files":["/abs/a.jsonl", …]}`, and writes one record per file in input order: `{"i":0,"rows":[…]}` holding every row whose `type` is `custom-title`, `ai-title` or `last-prompt`, each its line as written, in file order, or `{"i":0,"error":"<reason>"}` for a file that cannot be read. A path that is not absolute refuses the whole job (exit 2). Files are read in parallel on the rayon pool; every record is held until all are read, then written in input order. Its consumer is `pickSessionTitle` in `claude-session-synchronizer.provider.ts`, through the door's `readTitleRows`; the indexer calls it once per `synchronize` and once per `synchronizeFile`.

- `transcript-engine search` (`src/search/`) reads its job from stdin, `{"words":[…],"maxPerSession":2,"transparentWrappers":[…],"files":[{"path":"/abs/a.jsonl","sessions":["<provider session id>", …]}]}`, and writes one record per file in input order: `{"i":0}` when the gate refused the file or no row is a hit, `{"i":0,"error":"<reason>"}` when it cannot be read, else `{"i":0,"summaries":{"<session id>":<text or null>},"matches":[{"session","role","text","timestamp","uuid"}]}`: matches in line order, at most `maxPerSession` per session, one summary for each session with a match. The gate (`gate.rs`): every word occurs in the raw bytes case-insensitively, what `rg --ignore-case --fixed-strings` answered. A row's session is its `sessionId`, else the last row's; rows of a session the entry does not list are skipped. Visible text and role: `claude_row.rs`, over rows read by `row.rs`. Summary (`session_state.rs`): a `summary` row's text (parked by `leafUuid`, resolved by a later row's `parentUuid`) or a compact summary's text, else the last user text, else the last assistant text, as the file ends. Match test (`matcher.rs`): the words regex-escaped and joined by one or more of JavaScript's `\s` characters, case-insensitive; then, for a one-word query the first refused, the word with no letter on either side in the lowercased text. Files run in parallel (`mod.rs`); a record is written only after every one before it, at most four finished records per thread are held ahead, and each is flushed as written. Its caller is `server/modules/providers/services/session-conversations-engine.ts`, which judges every returned text again with `createWordMatcher`.

## Twinned rules
Four rules of `src/search/claude_row.rs` port TypeScript the chat's own readers share. Each side's comment names the other's file, and the two change together:
- `is_claude_turn_lookalike` and `isClaudeTurnLookalike` (`server/shared/claude-transcript-rows.ts`)
- `is_resume_placeholder_row` and `isResumePlaceholderRow` (`server/shared/claude-transcript-rows.ts`)
- `local_command_display_text` and `localCommandDisplayText` (`server/shared/local-commands.ts`)
- `strip_transparent_wrapper_prefix` and `stripTransparentWrapperPrefix` (`server/shared/local-commands.ts`)

The job's `transparentWrappers` is `TRANSPARENT_WRAPPER_COMMANDS`, exported from `server/shared/local-commands.ts` for it. This row and MAN-8054 both govern the three files.

governs: /home/lyphe/.claude/claudecodeui_lyphe/rust/transcript-engine/, /home/lyphe/.claude/claudecodeui_lyphe/rust/transcript-engine/src/search/claude_row.rs, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/transcript-engine/, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/claude-transcript-rows.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/local-commands.ts

## MAN-10331 — The transcript engine — rust/transcript-engine/ and its door — The door (`server/modules/transcript-engine/`)
section: The transcript engine — rust/transcript-engine/ and its door server/modules/transcript-engine/: verbs, protocol, build, config, refusals/002 The door (`server/modules/transcript-engine/`)

- `index.ts` exports `readClaudeUsageRows(filePath)`, `readTitleRows(filePaths)` (index-aligned `{rows}` or `{error}`), `openTranscriptSearch(job, {signal})` (returns `{forFile(index), end()}`), `transcriptEngineStatus()` and `TRANSCRIPT_ENGINE_PROTOCOL`.
  - `forFile` is asked with rising indexes. It reads stdout only as far as the record asked for; the stream is paused while lines wait.
  - `end()` sends SIGTERM and is safe to call twice. The signal's abort calls it.
- `engine-process.ts` holds the spawn helper and the `--version` run. `engine-status.ts` holds the last known state. `transcript-engine.types.ts` holds the record shapes (`TranscriptSearchJob`, `TranscriptSearchFileRecord`, `TitleRowsResult`, `TranscriptEngineStatus`).
- Two config names are read at each call, and neither needs an `.env` line:
  - `TRANSCRIPT_ENGINE_BIN`: the binary. By default it is `<app root>/rust/target/release/transcript-engine`, with the root found as `commands.module.ts` finds it.
  - `TRANSCRIPT_ENGINE_THREADS`: when set, it is passed as `--threads`.
- Three refusal words, all `AppError` status 503:
  - `TRANSCRIPT_ENGINE_UNAVAILABLE`: no binary to run. The message names `npm run build:engine`.
  - `TRANSCRIPT_ENGINE_STALE`: the header's protocol is not the door's. Same message.
  - `TRANSCRIPT_ENGINE_FAILED`: a non-zero exit, a signal the door did not send, or a record the door cannot read. It carries the last stderr line.
- How the status is learned:
  - From one `--version` run at module load, which the boot never awaits, and after that from every call's exit. Nothing polls.
  - The first known state, and every change between ok and not ok, logs one `[transcript-engine]` line in the server's journal.
  - Exits 2 and 3 refuse one call's input and leave the status ok.
  - Only a `--version` answer sets the status ok; a header alone sets nothing, since an engine can die after writing one. A run that exits 0 while the status is not ok starts one `--version` run, and its answer sets it ok. A `--version` run that cannot start (`error` then `close`) is judged once: the status keeps the start reason (ENOENT, EACCES), never the exit code. A `--version` answer is dropped when a failure was recorded after it started (a generation counter in `engine-status.ts`).
  - A `TRANSCRIPT_ENGINE_THREADS` that is not a whole number from 1 to 256 is refused in the door as `TRANSCRIPT_ENGINE_FAILED` and sets the status not ok: it is the server's configuration, not one call's input.
- `server/index.ts`: `/health` answers `transcriptEngine: transcriptEngineStatus()`.

## Prove it
- `npm run build:engine`, then `rust/target/release/transcript-engine --version`.
- `curl -s http://127.0.0.1:3011/health` should answer `"transcriptEngine":{"ok":true,"version":"0.1.0","protocol":1,"error":null}`.
- A `cloudcli-tsx` probe printing `providerTokenUsageService.getSessionTokenUsage(<an idle session>, { includeSessionTotal: true })`.
- `journalctl -u cloudcli-server-dev | grep transcript-engine`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/rust/transcript-engine/, /home/lyphe/.claude/claudecodeui_lyphe/rust/transcript-engine/src/search/claude_row.rs, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/transcript-engine/, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/claude-transcript-rows.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/local-commands.ts
