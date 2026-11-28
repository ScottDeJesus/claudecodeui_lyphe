// protects: warden/src/probes.mjs, warden/src/watched-probe.mjs, warden/src/probe-kinds/exec.mjs
// writes: none
//
// A watched probe's every-seconds turn reads nothing: it re-sends the kept reading aged to now, through
// enqueue and flush like a read (prevAt stamped at flush), and the turn's old disagreement log is gone.
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
  const dir = await scratchDir(t, "watched-turn");
  fs.mkdirSync(path.join(dir, "watched"));
  fs.mkdirSync(path.join(dir, "out"));
  fs.writeFileSync(path.join(dir, "watched", "status.json"), "{}");
  const runs = path.join(dir, "out", "runs.log");
  const realRandom = Math.random;
  Math.random = () => 0; // the first turn at once, then one a second
  const s = await scheduler();
  const spec = { key: "case/copy", service: "case", kind: "exec", every: 1, timeout: 5, cmd: `echo r >> '${runs}'; echo '0 seconds since the last copy'`, watch: path.join(dir, "watched", "status.json"), ages: "s", pass: "value < 3600" };
  try {
    s.handlers.get("checks.set")({ version: 1, probes: [spec] });
    await sleep(6500);
  } finally {
    s.end();
    Math.random = realRandom;
  }
  const ran = lines(runs);
  const mine = s.results.filter((r) => r.check === "case/copy");
  const watching = s.said.some((l) => l.includes("case/copy: watching"));
  if (ran !== 1) return broken(`over six turns the command ran ${ran} times, not once (the read at start)${watching ? "" : "; the watch never opened"}`);
  if (mine.length < 6) return broken(`over six turns ${mine.length} results were sent, not the read at start and one per turn`);
  const leading = mine.map((r) => Number.parseFloat(String(r.value)));
  if (!(leading.at(-1) >= 4)) return broken("the last turn's result reads " + JSON.stringify(mine.at(-1).value) + ", not the kept value aged about six seconds");
  for (let i = 1; i < mine.length; i++) if (mine[i].prevAt !== mine[i - 1].at) return broken(`result ${i} has prevAt ${mine[i].prevAt}, not the at ${mine[i - 1].at} of the result sent before it`);
  const disagree = s.said.find((l) => /disagree/i.test(l));
  if (disagree) return broken("a turn still compares a read with the kept reading: " + disagree);
  return held(`the command ran once; ${mine.length} results, values ${leading.join(",")}, prevAt chained, no disagreement line`);
});
