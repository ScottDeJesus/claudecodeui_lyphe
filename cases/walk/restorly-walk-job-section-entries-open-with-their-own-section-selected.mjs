// protects: /opt/eis-app/walk/screens.toml, /opt/eis-app/walk/app.mjs
// writes: none
//
// Each job-section entry of Restorly's walk dictionary opens the job and clicks its section tab; its landmark is only
// that tab, present whether or not it is selected. One fresh walk per entry reads the Job sheet's tabs marked
// aria-selected after the open: the entry is reached only when the selected tab is the one it names.
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const WEB = path.join(os.homedir(), ".claude", "scripts", "web-walk");
const RCURL = "/opt/eis-app/scripts/rcurl.sh";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const firstLine = (s) => String(s || "").trim().split("\n")[0].slice(0, 240);
const lastLine = (s) => String(s || "").split("\n").map((l) => l.trim()).filter(Boolean).pop() || "";

function run(cmd, args, env, timeout) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: os.homedir(), env, timeout, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === "number" ? error.code : String(error.code)) : 0, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

async function walkOne(out, screen, extra, probe) {
  const file = path.join(out, screen + ".json");
  writeFileSync(file, JSON.stringify({ app: "restorly", timeout_ms: 90000, ...extra, steps: [{ open: screen }, { step: "seen", run: probe }] }));
  const r = await run(WEB, ["run", file, "--out", path.join(out, screen)], { ...process.env, WEB_WALK_OUT: out }, 115000);
  try { return JSON.parse(lastLine(r.stdout)); } catch { return { ok: false, fault: { kind: "walk", why: "no answer line (exit " + r.code + "): " + firstLine(r.stderr) } }; }
}

const SECTIONS = { "job-coordination": "Coordination", "job-work": "Work", "job-carrier": "Carrier", "job-money": "Money", "job-file": "File", "job-activity": "Activity" };
const PROBE = "async ({page}) => { await page.waitForTimeout(1500); return await page.locator('[data-screen-label=\"Job\"] [role=\"tab\"][aria-selected=\"true\"]').evaluateAll((els) => els.filter((e) => e.offsetParent).map((e) => (e.textContent || '').trim())); }";

runCase(async () => {
  const jobs = await run(RCURL, ["/api/eis/jobs"], process.env, 30000);
  const job = (jobs.stdout.match(UUID) || [])[0];
  if (!job) return cannotRun("rcurl.sh /api/eis/jobs listed no job: " + firstLine(jobs.stderr || jobs.stdout));
  const out = mkdtempSync(path.join(os.tmpdir(), "case-restorly-job-sections-"));
  try {
    const answers = await Promise.all(Object.keys(SECTIONS).map((s) => walkOne(out, s, { with: { job } }, PROBE)));
    const wrong = [];
    const names = Object.keys(SECTIONS);
    for (let i = 0; i < names.length; i++) {
      const a = answers[i];
      const label = SECTIONS[names[i]];
      if (a.fault && (a.fault.kind === "app-down" || a.fault.kind === "sign-in")) return cannotRun(names[i] + ": " + a.fault.kind + " — " + firstLine(a.fault.why));
      if (!a.ok) { wrong.push(names[i] + ": the walk failed — " + firstLine((a.failed && a.failed[0] && a.failed[0].why) || (a.fault && a.fault.why))); continue; }
      const sel = a.read && a.read.seen;
      if (!(Array.isArray(sel) && sel.length === 1 && sel[0].startsWith(label))) wrong.push(names[i] + " selected " + JSON.stringify(sel) + ", not " + label);
    }
    if (wrong.length) return broken("job " + job + ": " + wrong.join("; "));
    return held("job " + job + ": each of the six section entries opened with its own section the one selected tab");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
