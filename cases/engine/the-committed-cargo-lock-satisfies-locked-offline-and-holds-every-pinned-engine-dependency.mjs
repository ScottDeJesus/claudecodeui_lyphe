// The engine's build stands on the committed lock (rust-transcript-engine, phase 4: the join): rust/Cargo.lock is
// not ignored by git (so the automatic save keeps it) and holds every dependency rust/transcript-engine/Cargo.toml pins with "=" at exactly that version, and
// cargo metadata --locked --offline over the workspace (run from rust/, so rustup takes the pinned toolchain) exits 0:
// the lock needs no update, which is what lets npm run build:engine's cargo build --release --locked rebuild from a clean
// target. Nothing is built and nothing is written.
//
// protects: rust/Cargo.lock, rust/Cargo.toml, rust/transcript-engine/Cargo.toml, rust/rust-toolchain.toml
// writes: none

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WORKSPACE = path.join(REPO, "rust");
const RUN_MS = 90000;

const lastLine = (text) => String(text || "").split("\n").map((line) => line.trim()).filter(Boolean).pop() || "(nothing on stderr)";

/** cargo as scripts/build-engine.mjs finds it: on PATH, else $CARGO_HOME/bin, else $HOME/.cargo/bin. */
function findCargo() {
  const onPath = (process.env.PATH || "").split(path.delimiter).filter(Boolean).map((directory) => path.join(directory, "cargo"));
  const cargoHome = process.env.CARGO_HOME ? [path.join(process.env.CARGO_HOME, "bin", "cargo")] : [];
  const home = path.join(process.env.HOME || os.homedir(), ".cargo", "bin", "cargo");
  return [...onPath, ...cargoHome, home].find((file) => {
    try {
      fs.accessSync(file, fs.constants.X_OK);
      return fs.statSync(file).isFile();
    } catch {
      return false; // missing or not executable: the next place
    }
  }) || null;
}

/** The [dependencies] of a crate manifest: each name and the version requirement written for it. */
function pins(manifest) {
  const out = [];
  let inDependencies = false;
  for (const line of manifest.split("\n")) {
    const section = /^\s*\[([^\]]+)\]/.exec(line);
    if (section) {
      inDependencies = section[1].trim() === "dependencies";
      continue;
    }
    if (!inDependencies) continue;
    const pin = /^\s*([A-Za-z0-9_-]+)\s*=\s*(?:\{[^}]*?version\s*=\s*)?"([^"]*)"/.exec(line);
    if (pin) out.push({ name: pin[1], want: pin[2] });
  }
  return out;
}

/** Every package of a Cargo.lock: name to the versions locked for it. */
function locked(lock) {
  const found = new Map();
  for (const block of lock.split("[[package]]").slice(1)) {
    const name = /^name = "([^"]+)"/m.exec(block);
    const version = /^version = "([^"]+)"/m.exec(block);
    if (name && version) found.set(name[1], [...(found.get(name[1]) || []), version[1]]);
  }
  return found;
}

runCase(async () => {
  const wrong = [];
  const readRepo = (relative) => {
    try {
      return fs.readFileSync(path.join(REPO, relative), "utf8");
    } catch (error) {
      wrong.push(relative + " cannot be read (" + (error.code || error.message) + ")");
      return "";
    }
  };
  const manifest = readRepo("rust/transcript-engine/Cargo.toml");
  const lock = readRepo("rust/Cargo.lock");
  const ignored = spawnSync("git", ["-C", REPO, "check-ignore", "-q", "rust/Cargo.lock"], { encoding: "utf8" }).status;
  if (ignored === 0) wrong.push("rust/Cargo.lock is ignored by git, so no save can keep it");
  else if (ignored !== 1) wrong.push("git check-ignore rust/Cargo.lock would not answer (status " + ignored + ")");
  const pinned = pins(manifest);
  if (manifest && pinned.length === 0) wrong.push("rust/transcript-engine/Cargo.toml names no dependency");
  const versions = locked(lock);
  for (const { name, want } of pinned) {
    if (!want.startsWith("=")) {
      wrong.push(name + " is required as " + JSON.stringify(want) + ", not pinned with =");
      continue;
    }
    const have = versions.get(name) || [];
    if (!have.includes(want.slice(1))) wrong.push(name + " is pinned " + want + " but the lock holds " + (have.join(", ") || "no " + name));
  }
  const cargo = findCargo();
  let resolved = 0;
  if (!cargo) wrong.push("no cargo on PATH, in $CARGO_HOME/bin or in $HOME/.cargo/bin");
  else {
    const meta = spawnSync(cargo, ["metadata", "--locked", "--offline", "--format-version", "1", "--manifest-path", path.join(WORKSPACE, "Cargo.toml")],
      { cwd: WORKSPACE, encoding: "utf8", timeout: RUN_MS, maxBuffer: 64 * 1024 * 1024 });
    if (meta.error) wrong.push("cargo metadata would not run (" + (meta.error.code || meta.error.message) + ")");
    else if (meta.status !== 0) wrong.push("cargo metadata --locked --offline exited " + meta.status + ": " + lastLine(meta.stderr));
    else {
      try {
        resolved = JSON.parse(meta.stdout).packages.length;
      } catch {
        wrong.push("cargo metadata printed no JSON");
      }
    }
  }
  if (wrong.length) return broken(wrong.join("; "));
  return held("rust/Cargo.lock is not ignored by git, holds all " + pinned.length + " pins at their = versions (" + pinned.map((p) => p.name + p.want).join(", ") +
    "), and cargo metadata --locked --offline resolved " + resolved + " packages with no lock update");
});
