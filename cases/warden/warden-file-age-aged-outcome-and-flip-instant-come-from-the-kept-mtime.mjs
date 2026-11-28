// protects: warden/src/watched-probe.mjs, warden/src/probe-kinds/file-age.mjs, warden/src/expr.mjs
// writes: none
//
// A file_age read keeps { name, mtimeMs }; the aged outcome and the flip instant are computed from it, the
// bounds from the definition's own pass and warn through parseExpr (boundsOf), never from a second copy of "26h".

import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const WATCHED = new URL("../../warden/src/watched-probe.mjs", import.meta.url);
const KIND = new URL("../../warden/src/probe-kinds/file-age.mjs", import.meta.url);
const EXPR = new URL("../../warden/src/expr.mjs", import.meta.url);
const HOUR = 3_600_000;

runCase(async (t) => {
  if (!fs.existsSync(WATCHED)) return broken("warden/src/watched-probe.mjs does not exist");
  const { agedOutcome, flipAt } = await import(WATCHED.href);
  const { boundsOf } = await import(EXPR.href);
  const { run } = await import(KIND.href);
  if (typeof agedOutcome !== "function" || typeof flipAt !== "function") return broken("watched-probe.mjs lacks agedOutcome or flipAt");
  if (typeof boundsOf !== "function") return broken("expr.mjs exports no boundsOf");

  const dir = await scratchDir(t, "aged-file");
  const file = path.join(dir, "a.txt");
  fs.writeFileSync(file, "a");
  const mtimeMs = Math.floor((Date.now() - HOUR) / 1000) * 1000;
  fs.utimesSync(file, mtimeMs / 1000, mtimeMs / 1000);
  const spec = { key: "case/age", service: "case", kind: "file_age", every: 300, timeout: 5, path: dir, pass: "age < 26h", warn: "age >= 20h" };

  const bounds = [...boundsOf(spec, "age")].map(Number).sort((a, b) => a - b);
  if (bounds.join(",") !== "72000,93600") return broken("boundsOf names " + bounds.join(",") + " for age, not 72000,93600");

  const memory = {};
  const read = await run(spec, memory);
  if (read.status !== "ok") return broken("the read itself is " + read.status + ": " + read.value);
  const flip = flipAt(spec, memory.kept ?? memory);
  if (typeof flip !== "number" || Math.abs(flip - (mtimeMs + 20 * HOUR)) > 1500) return broken("flipAt is " + flip + ", not the mtime plus 20 h (" + (mtimeMs + 20 * HOUR) + ")");

  const at = (hours) => agedOutcome(spec, memory.kept ?? memory, mtimeMs + hours * HOUR);
  const early = at(2);
  const warned = at(21);
  const late = at(27);
  const seen = [early, warned, late].map((o) => o?.status).join("/");
  if (seen !== "ok/warn/failing") return broken("aged at 2 h / 21 h / 27 h reads " + seen + ", not ok/warn/failing");
  if (!String(late.value).includes("a.txt") || late.value === early.value) return broken("the aged sentence was not rebuilt: 2 h says " + JSON.stringify(early.value) + ", 27 h says " + JSON.stringify(late.value));

  const past = flipAt({ ...spec, pass: "age < 30m", warn: undefined }, memory.kept ?? memory);
  if (past !== null && past !== undefined) return broken("with every bound below the age flipAt is " + past + ", not null");
  return held("bounds 72000,93600; flip at mtime+20h; aged ok/warn/failing; sentence rebuilt; no bound above → null");
});
