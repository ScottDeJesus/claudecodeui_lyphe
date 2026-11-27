// protects: warden/src/probe-kinds/http.mjs, warden/package.json, warden/build.mjs
// writes: none
//
// The release eis1's warden runs fills {nonce}: its own copy of the http kind, under .cerberus-warden/current, sends
// a fresh token. A node left on an older release sends the placeholder itself and is answered from Vite's cache.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { startListener } from "../lib/http_listener.mjs";

const SERVICE = "cerberus-warden.service";
const FILLED = /^\/src\/main\.tsx\?t=[A-Za-z0-9]+$/;

/** Where a warden lives on this box: the home's .cerberus-warden, then the one the unit's ExecStart names. */
function wardenHomes() {
  const homes = [path.join(os.homedir(), ".cerberus-warden")];
  try {
    const execStart = execFileSync("systemctl", ["show", SERVICE, "-p", "ExecStart", "--value"], { encoding: "utf8", timeout: 10000 });
    const named = execStart.match(/(\/[^\s;'"]*\/\.cerberus-warden)\//);
    if (named) homes.push(named[1]);
  } catch (error) {
    console.error(`systemctl show ${SERVICE}: ${String(error?.message).split("\n")[0]}`);
  }
  return homes;
}

/** The release root `current` names: a link or directory followed, or a file holding the version. */
function releaseRoot(home) {
  const current = path.join(home, "current");
  const stat = fs.lstatSync(current);
  if (stat.isSymbolicLink() || stat.isDirectory()) return fs.realpathSync(current);
  const text = fs.readFileSync(current, "utf8").trim();
  let version = text;
  try {
    const parsed = JSON.parse(text);
    version = parsed?.version ?? parsed?.current ?? text;
  } catch {}
  return path.join(home, "releases", String(version));
}

runCase(async () => {
  const home = wardenHomes().find((dir) => fs.existsSync(path.join(dir, "current")));
  if (!home) return cannotRun("no warden release readable on this box: no .cerberus-warden/current in the home or in the unit's ExecStart");
  const root = releaseRoot(home);
  const kindFile = ["warden/src/probe-kinds/http.mjs", "src/probe-kinds/http.mjs"].map((part) => path.join(root, part)).find((file) => fs.existsSync(file));
  if (!kindFile) return cannotRun(`the release at ${root} holds no probe-kinds/http.mjs`);
  const manifest = ["warden/package.json", "package.json"].map((part) => path.join(root, part)).find((file) => fs.existsSync(file));
  const version = manifest ? JSON.parse(fs.readFileSync(manifest, "utf8")).version ?? "?" : "?";
  const { run } = await import(pathToFileURL(kindFile).href);
  const listener = await startListener("ok");
  try {
    await run({ key: "case/release-nonce", kind: "http", url: `${listener.origin}/src/main.tsx?t={nonce}`, timeout: 5 }, {});
    const target = listener.targets[0] ?? "";
    if (!FILLED.test(target)) return broken(`eis1's warden ${version} (${root}) sent ${listener.lines[0] ?? "nothing"}, no fresh token for {nonce}`);
    return held(`eis1's warden ${version} (${root}) sent ${listener.lines[0]}`);
  } finally {
    await listener.close();
  }
});
