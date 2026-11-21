// "Any HTTP answer is ready": a unit the live step restarted is back when its `ready` address answers at all, a 404
// or a 500 included (charters/live.toml, MAN-10032). A card walk whose target is newer than a user unit serving a
// ready address that answers 500 has the unit restarted by `chain_cases.run_round`, read `restarted`, and the gate
// answers no live Break for it. A 500 is an answer: reading it as "gave no answer" refuses a round for a unit that
// is running, and briefs the fix-pass with a journal that shows nothing wrong.
//
// The recipe is a scratch file named by LIVE_CONFIG_PATH; the unit a transient user unit this case starts and stops
// (a tiny Python server on a free loopback port, answering 500 to every GET); the dispatcher store a scratch
// DISPATCHER_HOME. The round file lands under the house's reviews in a folder named for this case and this pid,
// removed at the end.
//
// protects: /home/lyphe/.claude/hooks/plan_runner/solo/chain_live.py, /home/lyphe/.claude/hooks/plan_runner/solo/chain_live_units.py
// writes: none

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { pause, python, reviewFolder, roundDriver, stamp, userEnv } from "../lib/house_live.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const SERVER = `import http.server, sys
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(500); self.end_headers(); self.wfile.write(b"down for a reason")
    def log_message(self, *a): pass
http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
`;

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function answers(url) {
  for (let i = 0; i < 50; i += 1) {
    try {
      const got = await fetch(url);
      return got.status;
    } catch {
      await pause(100);
    }
  }
  return null;
}

runCase(async (t) => {
  const dir = await scratchDir(t, "live-ready500");
  const repo = path.join(dir, "repo");
  fs.mkdirSync(path.join(repo, "app"), { recursive: true });
  fs.mkdirSync(path.join(dir, "home"));
  const server = path.join(dir, "srv.py");
  fs.writeFileSync(server, SERVER);
  const port = await freePort();
  const ready = `http://127.0.0.1:${port}/health`;

  const unit = `case-live-ready500-${process.pid}`;
  t.defer(() => {
    spawnSync("systemctl", ["--user", "stop", unit], { timeout: 30000, env: userEnv });
    spawnSync("systemctl", ["--user", "reset-failed", unit], { timeout: 30000, env: userEnv });
  });
  execFileSync("systemd-run", ["--user", `--unit=${unit}`, "--collect", "--quiet", "/usr/bin/python3", server, String(port)],
    { encoding: "utf8", timeout: 30000, env: userEnv });
  const first = await answers(ready);
  if (first !== 500) return broken(`the scratch server did not answer 500 before the round (${first}), so the round cannot be judged`);

  const slug = reviewFolder(t, "ready500");
  await pause(1300);
  const target = path.join(repo, "app", "fix.py");
  fs.writeFileSync(target, "print('the fix')\n");          // edited after the unit started: the unit is stale
  const recipe = path.join(dir, "live.toml");
  fs.writeFileSync(recipe, `[[repo]]\npath = "${repo}"\n  [[repo.rule]]\n  paths = ["app/**"]\n  restart = ["${unit}"]\n  ready = "${ready}"\n  scope = "user"\n`);
  const env = { DISPATCHER_HOME: path.join(dir, "home"), LIVE_CONFIG_PATH: recipe };
  const chain = { id: slug, slug, flow: "bug", cwd: repo, targets: [{ path: target }] };

  const before = stamp(unit);
  const run = python(roundDriver, [JSON.stringify(chain), "[1]"], { cwd: dir, env });
  if (run.status !== 0) return broken(`the round's driver exited ${run.status}: ${run.stderr.trim().split("\n").pop()}`);
  const seen = JSON.parse(run.stdout).seen[0];
  const after = stamp(unit);
  const rows = JSON.parse(seen.live || "{}")?.["1"] || [];
  const row = rows.find((each) => each.unit === unit);

  const wrong = [];
  if (seen.error) wrong.push(`the round raised ${seen.error}`);
  if (!(before !== null && after !== null && after > before)) wrong.push(`the stale unit was not restarted (started ${before}, then ${after})`);
  if (!row || row.action !== "restarted") {
    wrong.push(`a unit whose ready address answered 500 read ${row ? `${row.action}: ${String(row.detail).split("\n")[0]}` : "nothing"}`);
  }
  const live = seen.gate.filter((each) => each.why === "live");
  if (live.length > 0) wrong.push(`the gate refused the round for it: ${live.map((each) => `${each.name} — ${each.saw}`).join("; ")}`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`the unit was restarted (${before} → ${after}), its 500 read as ready, and the gate refused nothing`);
});
