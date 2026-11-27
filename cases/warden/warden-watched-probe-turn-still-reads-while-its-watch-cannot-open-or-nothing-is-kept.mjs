// protects: warden/src/probes.mjs, warden/src/watched-probe.mjs, warden/src/probe-kinds/exec.mjs
// writes: none
//
// The fallback: a watched probe whose watch is not open, or whose last read kept nothing, reads on its turn
// as an unwatched probe does.
import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const PROBES = new URL("../../warden/src/probes.mjs", import.meta.url);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const lines = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).length : 0);

/** A scheduler on a fake link; what the warden logs is kept in `said` and given back to the console at `end`. */
async function scheduler() {
  const said = [];
  const real = { log: console.log, error: console.error, warn: console.warn };
  for (const k of Object.keys(real)) console[k] = (...a) => said.push(a.join(" "));
  const { createProbes } = await import(PROBES.href);
  const handlers = new Map();
  const results = [];
  const link = {
    on: (type, handler) => handlers.set(type, handler),
    send: (type, body) => {
      if (type === "result") for (const result of body.results) results.push({ ...result, arrived: Date.now() });
      return { seq: results.length, sent: true };
    },
  };
  const probes = createProbes({ link });
  return { said, handlers, results, end: () => { probes.stop(); Object.assign(console, real); } };
}


runCase(async (t) => {
  const dir = await scratchDir(t, "watched-fallback");
  const locked = path.join(dir, "locked");
  fs.mkdirSync(locked);
  fs.mkdirSync(path.join(dir, "open"));
  fs.mkdirSync(path.join(dir, "out"));
  fs.writeFileSync(path.join(dir, "open", "status.json"), "{}");
  fs.chmodSync(locked, 0o000); // inotify cannot watch a folder it may not read
  const runsA = path.join(dir, "out", "a.log");
  const runsB = path.join(dir, "out", "b.log");
  const realRandom = Math.random;
  Math.random = () => 0;
  const s = await scheduler();
  const a = { key: "case/unwatchable", service: "case", kind: "exec", every: 1, timeout: 5, cmd: `echo r >> '${runsA}'; echo '0 seconds since'`, watch: locked, ages: "s", pass: "value < 3600" };
  const b = { key: "case/nothing-kept", service: "case", kind: "exec", every: 1, timeout: 5, cmd: `echo r >> '${runsB}'; echo 'no copy yet'`, watch: path.join(dir, "open", "status.json"), ages: "s", pass: "value < 3600" };
  try {
    s.handlers.get("checks.set")({ version: 1, probes: [a, b] });
    await sleep(4600);
  } finally {
    s.end();
    Math.random = realRandom;
    fs.chmodSync(locked, 0o700);
  }
  const ranA = lines(runsA);
  const ranB = lines(runsB);
  const cannot = s.said.some((l) => l.includes("case/unwatchable: cannot watch"));
  if (ranA < 3) return broken(`the probe whose watch cannot open ran ${ranA} times over about four turns${cannot ? "" : " (and no line says its watch could not open)"}`);
  if (ranB < 3) return broken(`the probe whose read keeps nothing ran ${ranB} times over about four turns`);
  return held(`over about four turns: unwatchable ran ${ranA} times${cannot ? " (its watch could not open)" : ""}, nothing-kept ran ${ranB} times`);
});
