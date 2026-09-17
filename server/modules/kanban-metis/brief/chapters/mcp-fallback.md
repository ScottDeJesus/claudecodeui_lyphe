# Metis chapter — When the MCP is dark (there is no fallback here)

> **What this is.** What a Metis session does on the turn where the `kanban-pm` MCP
> tools are NOT callable. `kanban-pm` is not a persistent registration in any config
> file — the driver injects it fresh at every launch via `--mcp-config` +
> `--strict-mcp-config`, so it is the session's ONLY MCP, and a dark MCP this turn
> means the injected carry did not come up — not a registration lag that clears next
> session. **Core routes here** from the seam's "When the MCP isn't reachable this
> session" pointer.

### When the MCP is not reachable THIS session

**Stop. Say so plainly. End the turn.** That is the whole procedure.

There is no read-only fallback on this board, and deliberately no second door:

- **There is no store to read.** The board's data lives in the SQLite file the server
  owns, and this session has no handle on it, no path to it and no library for it —
  the tools ARE the interface. A session that went looking for the file would be
  reading a snapshot it cannot trust while the server writes it.
- **There is no direct-write path either.** Authoring the way the MCP does — claiming
  a plan lease, posting questions, moving a lane — is board traffic that lights the
  operator's tabs and lands in the audit log. Writing around it would leave the board
  and the record disagreeing about what happened.
- **There is nothing to wait for.** The carry is injected at launch and does not
  re-register later in the turn. If it did not come up, it is not coming up.

So on a dark MCP: **say so plainly, name the board you were launched for, and end the
turn with no board writes attempted.** One sentence in the closing report is enough —
`⚠ kanban-pm MCP not reachable this session — no board work possible; ending the turn.`

Two things are as important as the instruction itself:

- **Nothing you think you know about the board is evidence.** Do not report bucket
  counts, card titles, lease states or an orient line from memory or from an earlier
  session. A report about a board you could not read is a fabricated one, and a
  fabricated report is worse than no report.
- **This is NOT quiescence.** Quiescence is a proven fact about a board you COULD
  read, and it alone licenses the `QUIESCENT — retiring` line; a dark MCP proves
  nothing about the board. Do not print that line here, and do not run the quiescence
  checkpoint — its first gate is a `list_active_builds` you cannot call.

The driver's next tick is what recovers this: it re-reads the board and spawns a fresh
Metis while claimable work exists, and a session whose MCP came up cleanly takes the
card. There is nothing for this session to retry.
