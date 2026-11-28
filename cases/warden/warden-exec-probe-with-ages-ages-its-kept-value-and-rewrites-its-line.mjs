// protects: warden/src/watched-probe.mjs, warden/src/probe-kinds/exec.mjs, warden/src/expr.mjs
// writes: none
//
// An exec probe with ages keeps its value, its line and when it measured; aged, the value grows by the time
// since in that unit and the line's leading number is rewritten to match.

import fs from "node:fs";

import { broken, held, runCase } from "../lib/case.mjs";

const WATCHED = new URL("../../warden/src/watched-probe.mjs", import.meta.url);
const KIND = new URL("../../warden/src/probe-kinds/exec.mjs", import.meta.url);
const EXPR = new URL("../../warden/src/expr.mjs", import.meta.url);
const HOUR = 3_600_000;

runCase(async () => {
  if (!fs.existsSync(WATCHED)) return broken("warden/src/watched-probe.mjs does not exist");
  const { agedOutcome, flipAt } = await import(WATCHED.href);
  const { boundsOf } = await import(EXPR.href);
  const { run } = await import(KIND.href);
  if (typeof agedOutcome !== "function" || typeof flipAt !== "function") return broken("watched-probe.mjs lacks agedOutcome or flipAt");
  if (typeof boundsOf !== "function") return broken("expr.mjs exports no boundsOf");

  const spec = { key: "case/copy", service: "case", kind: "exec", every: 300, timeout: 10, cmd: "echo '3 hours since the last copy'", watch: "/var/lib/case-none/status.json", ages: "h", pass: "value < 4", warn: "value >= 3.5" };
  const bounds = [...boundsOf(spec, "value")].map(Number).sort((a, b) => a - b);
  if (bounds.join(",") !== "3.5,4") return broken("boundsOf names " + bounds.join(",") + " for value, not 3.5,4");

  const memory = {};
  const before = Date.now();
  const read = await run(spec, memory);
  const after = Date.now();
  if (read.status !== "ok") return broken("the read itself is " + read.status + ": " + read.value);

  const flip = flipAt(spec, memory.kept ?? memory);
  if (typeof flip !== "number" || flip < before + HOUR / 2 - 1000 || flip > after + HOUR / 2 + 1000) return broken("flipAt is " + flip + ", not the measured instant plus 30 min (" + (before + HOUR / 2) + ".." + (after + HOUR / 2) + ")");

  const late = agedOutcome(spec, memory.kept ?? memory, after + 2 * HOUR);
  const leading = Number.parseFloat(String(late?.value ?? ""));
  if (late?.status !== "failing") return broken("two hours on the aged outcome is " + late?.status + ", not failing");
  if (!(Math.abs(leading - 5) < 0.05) || !String(late.value).includes("hours since the last copy")) return broken("two hours on the line reads " + JSON.stringify(late.value) + ", not 5 hours since the last copy");
  const warned = agedOutcome(spec, memory.kept ?? memory, after + 0.6 * HOUR);
  if (warned?.status !== "warn") return broken("0.6 h on the aged outcome is " + warned?.status + " (" + JSON.stringify(warned?.value) + "), not warn");
  return held("bounds 3.5,4; flip at measured+30min; +2h reads " + JSON.stringify(late.value) + " failing; +0.6h warn");
});
