// protects: warden/src/probes.mjs, warden/src/watched-probe.mjs
// writes: none
//
// probe.run reads a watched probe now: center's recheck is a read, never the kept reading re-sent.
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
  const dir = await scratchDir(t, "watched-run-now");
  fs.mkdirSync(path.join(dir, "watched"));
  fs.mkdirSync(path.join(dir, "out"));
  fs.writeFileSync(path.join(dir, "watched", "status.json"), "{}");
  const runs = path.join(dir, "out", "runs.log");
  const realRandom = Math.random;
  Math.random = () => 0.99; // the first turn is about an hour out: nothing here is a turn
  const s = await scheduler();
  const spec = { key: "case/copy", service: "case", kind: "exec", every: 3600, timeout: 5, cmd: `echo r >> '${runs}'; echo '0 seconds since the last copy'`, watch: path.join(dir, "watched", "status.json"), ages: "s", pass: "value < 3600" };
  let asked = 0;
  try {
    s.handlers.get("checks.set")({ version: 1, probes: [spec] });
    await sleep(2000);
    if (lines(runs) !== 1) return broken(`before probe.run the command ran ${lines(runs)} times, not once (the read at start)`);
    asked = Date.now();
    s.handlers.get("probe.run")({ probe: "case/copy" });
    const deadline = asked + 2000;
    while ((lines(runs) < 2 || s.results.filter((r) => r.arrived >= asked).length === 0) && Date.now() < deadline) await sleep(50);
  } finally {
    s.end();
    Math.random = realRandom;
  }
  const ran = lines(runs);
  const after = s.results.filter((r) => r.check === "case/copy" && r.arrived >= asked);
  if (ran !== 2) return broken(`after probe.run the command has run ${ran} times, not twice`);
  if (after.length === 0 || after[0].arrived - asked > 2000) return broken("no result was sent within 2 s of probe.run");
  return held(`probe.run ran the command (2 runs) and its result was sent ${after[0].arrived - asked} ms after the ask`);
});
