// protects: warden/src/probes.mjs, warden/src/watched-probe.mjs, warden/src/probe-kinds/file-age.mjs
// writes: none
//
// A watched probe reads at start, reads again on a change it hears (2 s after the last change, no sooner than
// 30 s after its previous read), keeps its watch across an unchanged redefinition, and skips .partial.

import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const PROBES = new URL("../../warden/src/probes.mjs", import.meta.url);
const WATCHED = new URL("../../warden/src/watched-probe.mjs", import.meta.url);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

runCase(async (t) => {
  if (!fs.existsSync(WATCHED)) return broken("warden/src/watched-probe.mjs does not exist");
  const dir = await scratchDir(t, "watched-read");
  fs.writeFileSync(path.join(dir, "a.txt"), "a");
  const realRandom = Math.random;
  Math.random = () => 0.99; // the every-seconds turn first comes ~59 min out: nothing in this case is a turn
  const { createProbes } = await import(PROBES.href);
  const handlers = new Map();
  const reads = [];
  const link = {
    on: (type, handler) => handlers.set(type, handler),
    send: (type, body) => {
      if (type === "result") for (const result of body.results) reads.push({ at: Date.now(), value: String(result.value) });
      return { seq: reads.length, sent: true };
    },
  };
  const probes = createProbes({ link });
  const spec = { key: "case/backups", service: "case", kind: "file_age", path: dir, every: 3600, timeout: 5, pass: "age < 26h" };
  try {
    handlers.get("checks.set")({ version: 1, probes: [spec] });
    await sleep(4000);
    if (reads.length !== 1) return broken("within 4 s of the definition " + reads.length + " results arrived, not the one read at start");
    if (!reads[0].value.includes("a.txt")) return broken("the read at start says " + JSON.stringify(reads[0].value));
    handlers.get("checks.set")({ version: 2, probes: [{ ...spec }] });
    await sleep(1000);
    fs.writeFileSync(path.join(dir, "b.txt.partial"), "b");
    fs.renameSync(path.join(dir, "b.txt.partial"), path.join(dir, "b.txt"));
    const deadline = Date.now() + 45_000;
    while (reads.length < 2 && Date.now() < deadline) await sleep(250);
    if (reads.length < 2) return broken("no read came within 45 s of a new file in the watched folder (every is 3600 s)");
    const second = reads[1];
    if (!second.value.includes("(b.txt)") || second.value.includes("partial")) return broken("the read after the change says " + JSON.stringify(second.value) + ", not the new file b.txt");
    const gap = second.at - reads[0].at;
    if (gap < 28_000) return broken("the read after the change came " + gap + " ms after the first, sooner than 30 s");
    return held("read at start, none on the unchanged redefinition, the change read " + Math.round(gap / 1000) + " s after the first: " + second.value);
  } finally {
    probes.stop();
    Math.random = realRandom;
  }
});
