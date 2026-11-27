// protects: warden/src/watched-probe.mjs, warden/src/probes.mjs
// writes: none
//
// A watched folder that arrives after its probe was defined, or is removed and made again, is still heard:
// a file written into it brings a read on a change, without a redefinition.

import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const PROBES = new URL("../../warden/src/probes.mjs", import.meta.url);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

runCase(async (t) => {
  const base = await scratchDir(t, "watched-folder-moves");
  const late = path.join(base, "late");
  const again = path.join(base, "again");
  fs.mkdirSync(again);
  fs.writeFileSync(path.join(again, "a.txt"), "a");
  const said = [];
  const realLog = console.log;
  const realRandom = Math.random;
  console.log = (...args) => said.push({ at: Date.now(), line: args.join(" ") });
  Math.random = () => 0.99;
  const { createProbes } = await import(PROBES.href);
  const handlers = new Map();
  const link = { on: (type, handler) => handlers.set(type, handler), send: () => ({ sent: true }) };
  const probes = createProbes({ link });
  const spec = (key, p) => ({ key, service: "case", kind: "file_age", path: p, every: 5, timeout: 5, pass: "age < 26h" });
  try {
    handlers.get("checks.set")({ version: 1, probes: [spec("case/late", late), spec("case/again", again)] });
    await sleep(1000);
    fs.mkdirSync(late);
    fs.rmSync(again, { recursive: true });
    fs.mkdirSync(again);
    await sleep(40_000); // the reads those two moves bring have come; the turns have had their chance to watch again
    const wroteAt = Date.now();
    fs.writeFileSync(path.join(late, "b.txt"), "b");
    fs.writeFileSync(path.join(again, "b.txt"), "b");
    await sleep(40_000);
    const heard = (key) => said.some((s) => s.at > wroteAt && s.line.includes("probe " + key + ": read on a change"));
    const missed = ["case/late", "case/again"].filter((key) => !heard(key));
    if (missed.length > 0) return broken("no read on a change within 40 s of a file written into the folder of " + missed.join(" and ") + " (a folder that arrived after its definition / was removed and made again)");
    return held("both the folder that arrived late and the folder made again were heard: a read on a change followed each write");
  } finally {
    probes.stop();
    console.log = realLog;
    Math.random = realRandom;
  }
});
