// protects: warden/src/watched-probe.mjs
// writes: none
//
// watchTarget(spec) names where a watched probe listens: a file_age folder as itself, a file_age file as its
// parent filtered to its name, an exec probe only with both watch and ages; every other kind null.

import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const WATCHED = new URL("../../warden/src/watched-probe.mjs", import.meta.url);
const isNull = (value) => value === null || value === undefined;

runCase(async (t) => {
  if (!fs.existsSync(WATCHED)) return broken("warden/src/watched-probe.mjs does not exist");
  const { watchTarget } = await import(WATCHED.href);
  if (typeof watchTarget !== "function") return broken("watched-probe.mjs exports no watchTarget");
  const dir = await scratchDir(t, "watch-target");
  const file = path.join(dir, "status.json");
  fs.writeFileSync(file, "{}");
  const base = { service: "case", every: 300, timeout: 5 };
  const same = (a, b) => path.resolve(String(a)) === path.resolve(String(b));

  const folder = watchTarget({ ...base, key: "case/folder", kind: "file_age", path: dir, pass: "age < 26h" });
  if (isNull(folder) || !same(folder.dir, dir)) return broken("a file_age probe on a folder watches " + JSON.stringify(folder) + ", not the folder itself");
  const single = watchTarget({ ...base, key: "case/file", kind: "file_age", path: file, pass: "age < 26h" });
  if (isNull(single) || !same(single.dir, dir) || single.name !== "status.json") return broken("a file_age probe on a file watches " + JSON.stringify(single) + ", not its parent filtered to status.json");
  const execWatched = watchTarget({ ...base, key: "case/copy", kind: "exec", cmd: "echo 1", watch: file, ages: "h" });
  const execOk = !isNull(execWatched) && ((same(execWatched.dir, dir) && execWatched.name === "status.json") || same(execWatched.dir, file));
  if (!execOk) return broken("an exec probe with watch and ages watches " + JSON.stringify(execWatched) + ", not its watch path");

  const unwatched = [
    ["an exec probe with watch but no ages", { ...base, key: "case/a", kind: "exec", cmd: "echo 1", watch: file }],
    ["a plain exec probe", { ...base, key: "case/b", kind: "exec", cmd: "echo 1" }],
    ["an http probe", { ...base, key: "case/c", kind: "http", url: "http://127.0.0.1:1/" }],
    ["a tcp probe", { ...base, key: "case/d", kind: "tcp", host: "127.0.0.1", port: 1 }],
    ["a sql probe", { ...base, key: "case/e", kind: "sql", dsn: "postgresql://x@127.0.0.1:1/x", query: "select 1" }],
    ["a health_doc probe", { ...base, key: "case/f", kind: "health_doc", url: "http://127.0.0.1:1/h", cadence: 30 }],
  ];
  for (const [label, spec] of unwatched) {
    const got = watchTarget(spec);
    if (!isNull(got)) return broken(label + " answers " + JSON.stringify(got) + ", not null");
  }
  return held("folder, file and exec-with-ages answer their targets; six unwatched shapes answer null");
});
