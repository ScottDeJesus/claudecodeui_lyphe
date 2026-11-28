// The engine's build (rust-transcript-engine, interface 1): with no cargo on PATH, in $CARGO_HOME/bin or in
// $HOME/.cargo/bin, scripts/build-engine.mjs prints the rustup install line and exits 1; package.json's build:engine
// is "node scripts/build-engine.mjs" and no other script chains it; rust/target/ is git-ignored and rust/Cargo.lock is
// not; and the crate carries no #[test], no tests/ and no benches/.
//
// protects: scripts/build-engine.mjs, package.json, .gitignore, rust/transcript-engine/
// writes: none

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BUILD_SCRIPT = path.join(REPO, "scripts/build-engine.mjs");
const CRATE = path.join(REPO, "rust/transcript-engine");
const INSTALL_PIECES = ["https://sh.rustup.rs", "-y", "--no-modify-path", "--profile minimal", "--default-toolchain none"];

function filesUnder(directory) {
  const out = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) out.push(full + "/", ...filesUnder(full));
    else out.push(full);
  }
  return out;
}

runCase(async (t) => {
  const wrong = [];
  const dir = await scratchDir(t, "no-cargo");
  const emptyBin = path.join(dir, "bin");
  const home = path.join(dir, "home");
  fs.mkdirSync(emptyBin);
  fs.mkdirSync(home);
  const build = spawnSync(process.execPath, [BUILD_SCRIPT], { cwd: dir, env: { PATH: emptyBin, HOME: home }, encoding: "utf8", timeout: 30000 });
  const said = String(build.stdout || "") + "\n" + String(build.stderr || "");
  if (build.status !== 1) wrong.push("with no cargo the build ended " + (build.status ?? build.signal) + ", not exit 1");
  const missing = INSTALL_PIECES.filter((piece) => !said.includes(piece));
  if (missing.length) wrong.push("with no cargo it did not print " + missing.join(", "));

  const scripts = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8")).scripts || {};
  if (scripts["build:engine"] !== "node scripts/build-engine.mjs") wrong.push("package.json's build:engine is " + JSON.stringify(scripts["build:engine"]));
  const chained = Object.entries(scripts).filter(([key, value]) => key !== "build:engine" && /build:engine|build-engine/.test(String(value))).map(([key]) => key);
  if (chained.length) wrong.push("build:engine is chained into " + chained.join(", "));

  const ignored = (relative) => spawnSync("git", ["-C", REPO, "check-ignore", "-q", relative]).status;
  if (ignored("rust/target/release/transcript-engine") !== 0) wrong.push("rust/target/ is not git-ignored");
  if (ignored("rust/Cargo.lock") !== 1) wrong.push("rust/Cargo.lock is git-ignored");

  if (!fs.existsSync(CRATE)) wrong.push("the crate rust/transcript-engine is not on disk");
  else {
    const all = filesUnder(CRATE).filter((entry) => !entry.includes("/target/"));
    const testDirs = all.filter((entry) => /\/(tests|benches)\/$/.test(entry));
    const testAttrs = all.filter((entry) => entry.endsWith(".rs") && /#\[(test|bench)\]|#\[cfg\(test\)\]/.test(fs.readFileSync(entry, "utf8")));
    if (testDirs.length || testAttrs.length) wrong.push("the crate carries tests: " + [...testDirs, ...testAttrs].map((entry) => path.relative(REPO, entry)).join(", "));
  }

  if (wrong.length) return broken(wrong.join("; "));
  return held("no cargo: exit 1 with the rustup line; build:engine is node scripts/build-engine.mjs and chained into none of " +
    Object.keys(scripts).length + " scripts; rust/target/ ignored, rust/Cargo.lock not; no #[test], tests/ or benches/ in the crate");
});
