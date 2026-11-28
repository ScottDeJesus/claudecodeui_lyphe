#!/usr/bin/env node
// Builds the transcript engine (rust/transcript-engine) for the server's door to it
// (server/modules/transcript-engine/). Run as `npm run build:engine`; chained into no other script.
// The server runs the binary per call, so a rebuilt engine is live at the next call: no restart.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE = path.join(REPO_ROOT, 'rust');
const RUSTUP_INSTALL_LINE =
  "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path --profile minimal --default-toolchain none";

const cargo = findCargo();
if (!cargo) {
  console.error('[build-engine] cargo was found neither on PATH, nor in $CARGO_HOME/bin, nor in $HOME/.cargo/bin. Install rustup with:');
  console.error(RUSTUP_INSTALL_LINE);
  process.exit(1);
}

// The cwd is the workspace so rustup picks the toolchain pinned in rust/rust-toolchain.toml.
const build = spawnSync(
  cargo,
  ['build', '--release', '--locked', '--manifest-path', path.join(WORKSPACE, 'Cargo.toml')],
  { cwd: WORKSPACE, stdio: 'inherit' },
);
if (build.error) {
  console.error(`[build-engine] ${cargo} could not be run: ${build.error.message}`);
  process.exit(1);
}
process.exit(build.status ?? 1);

function findCargo() {
  const onPath = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean).map((directory) => path.join(directory, 'cargo'));
  const cargoHome = process.env.CARGO_HOME ? [path.join(process.env.CARGO_HOME, 'bin', 'cargo')] : [];
  const home = path.join(process.env.HOME || os.homedir(), '.cargo', 'bin', 'cargo');
  return [...onPath, ...cargoHome, home].find(isExecutable) ?? null;
}

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false; // missing or not executable: try the next place
  }
}
