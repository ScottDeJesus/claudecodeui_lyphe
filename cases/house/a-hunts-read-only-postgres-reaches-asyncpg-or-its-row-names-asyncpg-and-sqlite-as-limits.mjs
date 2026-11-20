// protects: /home/lyphe/.claude/hooks/plan_runner/souls.py, /home/lyphe/.claude/hooks/session_rails_hunt.py
// writes: none
//
// A hunt's database sessions are said to be read-only. `souls.hunt_env` makes that true through PGOPTIONS,
// which libpq reads (psql, psycopg2) and asyncpg — the Restorly connector's main driver — does not. So either
// an asyncpg session opened under the hunt's PGOPTIONS reads `default_transaction_read_only` on, or the docstore
// row governing `hooks/session_rails_hunt.py` names asyncpg and SQLite (the hunts' two SQLite databases have no
// guard at all) among the writes the harness's half does not bind.
//
// The session is the connector's venv python against the database `/opt/shadow-connector/.env` names, and its
// one statement is `show default_transaction_read_only`: nothing is written. The overlay is the live
// `souls.hunt_env` for a spec with `hunt="data"`.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { python } from "../lib/house_live.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const VENV = "/opt/shadow-connector/venv/bin/python";
const ENV_FILE = "/opt/shadow-connector/.env";
const DOCSTORE = path.join(os.homedir(), ".claude", "scripts", "docstore");
const HUNT_FILE = path.join(os.homedir(), ".claude", "hooks", "session_rails_hunt.py");

const OVERLAY = String.raw`
import json
from plan_runner import souls
print(json.dumps(souls.hunt_env(souls.SpawnSpec(role="hunter", agent="sherlock", model=None, prompt="", cwd="/tmp", add_dirs=[], expected_s=600, idle_s=0, hunt="data"))))
`;

const ASK = String.raw`
import asyncio, sys
values = {}
for line in open(sys.argv[1]):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
async def main():
    import asyncpg
    conn = await asyncpg.connect(host=values["PG_HOST"], port=int(values.get("PG_PORT") or 5432), database=values["PG_DB"],
                                 user=values["PG_USER"], password=values["PG_PASS"], timeout=20)
    try:
        print(await conn.fetchval("show default_transaction_read_only"))
    finally:
        await conn.close()
asyncio.run(main())
`;

runCase(async (t) => {
  const dir = await scratchDir(t, "hunt-asyncpg");
  const o = python(OVERLAY, [], { cwd: dir, env: { PGOPTIONS: "" } });
  let overlay;
  try { overlay = JSON.parse(o.stdout.trim().split("\n").pop() || ""); }
  catch { return broken(`souls.hunt_env gave no answer (exit ${o.status}): ${o.stderr.trim().split("\n").pop()}`); }
  if (!overlay.PGOPTIONS) return broken(`souls.hunt_env put no PGOPTIONS on a data hunt: ${JSON.stringify(overlay)}`);
  if (!fs.existsSync(VENV) || !fs.existsSync(ENV_FILE)) return broken("the connector's venv or .env is not on this box");

  const script = path.join(dir, "ask.py");
  fs.writeFileSync(script, ASK);
  const ran = spawnSync(VENV, ["-I", script, ENV_FILE], { cwd: dir, encoding: "utf8", timeout: 60000,
                                                         env: { ...process.env, ...overlay } });
  const reads = String(ran.stdout || "").trim().split("\n").pop();
  if (ran.status !== 0 || !["on", "off"].includes(reads))
    return broken(`the asyncpg session did not answer (exit ${ran.status}): ${String(ran.stderr || "").trim().split("\n").pop()}`);
  if (reads === "on") return held(`an asyncpg session under the hunt's PGOPTIONS (${overlay.PGOPTIONS}) reads read-only on`);

  const g = spawnSync(DOCSTORE, ["govern", HUNT_FILE], { encoding: "utf8", timeout: 60000 });
  let rows;
  try { rows = JSON.parse(g.stdout).rows || []; }
  catch { return broken(`docstore govern gave no answer (exit ${g.status}): ${String(g.stderr || "").trim().split("\n").pop()}`); }
  const named = rows.filter((r) => /asyncpg/i.test(r.body || "") && /sqlite/i.test(r.body || ""));
  if (!named.length)
    return broken(`an asyncpg session under the hunt's PGOPTIONS reads default_transaction_read_only off, and none of the ` +
                  `${rows.length} rows governing session_rails_hunt.py (${rows.map((r) => r.token).join(" ")}) names asyncpg and SQLite as limits`);
  return held(`asyncpg reads off under PGOPTIONS, and ${named[0].token} names asyncpg and SQLite among the limits`);
});
