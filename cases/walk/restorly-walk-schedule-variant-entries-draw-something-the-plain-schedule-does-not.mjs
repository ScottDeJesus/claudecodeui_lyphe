// protects: /opt/eis-app/walk/screens.toml, /opt/eis-app/walk/app.mjs
// writes: none
//
// Each schedule variant of Restorly's walk dictionary is a full load of /?sched=<v>#sched=<v>, so the schedule mounts with the
// seed in place. One fresh walk per entry, a real job given, reads the visible data-screen-label marks, the pressed/selected/
// checked controls, the headings and the schedule's eyebrow (its first line, up to the first ·): a variant reading exactly
// what the plain schedule reads was not drawn. focus is exempt (the app marks it only when the open job has a visit in the
// shown week, which no fixed job promises); agenda must also read something day does not.
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

const VARIANTS = ["day", "agenda", "all", "empty", "subs", "focus", "map"];
const PROBE = "async ({page}) => { await page.waitForTimeout(1500); return await page.evaluate(() => { const vis = (e) => !!e.offsetParent; const m = document.querySelector('[data-screen-label=\"Schedule\"]'); return { marks: [...document.querySelectorAll('[data-screen-label]')].filter(vis).map((e) => e.getAttribute('data-screen-label')).sort(), on: [...document.querySelectorAll('[aria-pressed=\"true\"],[aria-selected=\"true\"],[aria-checked=\"true\"]')].filter(vis).map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30)), heads: [...document.querySelectorAll('h1,h2,h3,h4,[role=heading]')].filter(vis).map((e) => e.textContent.trim().slice(0, 30)), eyebrow: m ? m.innerText.trim().split('\\n')[0].split('·')[0].trim().slice(0, 40) : null }; }); }";

runCase(async () => {
  const jobs = await run(RCURL, ["/api/eis/jobs"], process.env, 30000);
  const job = (jobs.stdout.match(UUID) || [])[0];
  if (!job) return cannotRun("rcurl.sh /api/eis/jobs listed no job: " + firstLine(jobs.stderr || jobs.stdout));
  const out = mkdtempSync(path.join(os.tmpdir(), "case-restorly-sched-variants-"));
  try {
    const all = ["schedule", ...VARIANTS];
    const answers = await Promise.all(all.map((s) => walkOne(out, s, { with: { job } }, PROBE)));
    for (let i = 0; i < all.length; i++) {
      const a = answers[i];
      if (a.fault && (a.fault.kind === "app-down" || a.fault.kind === "sign-in")) return cannotRun(all[i] + ": " + a.fault.kind + " — " + firstLine(a.fault.why));
    }
    if (!answers[0].ok) return broken("schedule itself failed: " + firstLine(JSON.stringify(answers[0].failed || answers[0].fault)));
    const plain = JSON.stringify(answers[0].read.seen);
    const wrong = [];
    for (let i = 1; i < all.length; i++) {
      const a = answers[i];
      if (!a.ok) { wrong.push(all[i] + " failed: " + firstLine(JSON.stringify(a.failed || a.fault))); continue; }
      if (all[i] !== "focus" && JSON.stringify(a.read.seen) === plain) wrong.push(all[i]);
    }
    const day = answers[all.indexOf("day")], agenda = answers[all.indexOf("agenda")];
    if (day.ok && agenda.ok && JSON.stringify(day.read.seen) === JSON.stringify(agenda.read.seen)) wrong.push("agenda reads exactly what day reads");
    if (wrong.length) return broken("these variants answered reached yet read exactly what the plain schedule reads (" + plain.slice(0, 160) + "): " + wrong.join(", "));
    return held("job " + job + ": every variant answered ok; day, agenda, all, empty, subs and map each read something the plain schedule does not, and agenda something day does not");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
