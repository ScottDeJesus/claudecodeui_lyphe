// heal_scripts.mjs — deploy/heal's two scripts run as child processes, with sudo and systemctl stood in for.
//
//   import { canary, deadUrl, healScript, PARTIAL_CHAIN, runScript, scriptProblem, stubHouse, tokenOf } from "../lib/heal_scripts.mjs";
//
// heal_stubs/sudo.sh and heal_stubs/systemctl.sh go first on the child's PATH, from the case's scratch folder:
// the firewall is a scratch chain file, a unit's age is a number the case sets, and a restart is a mark. Nothing
// reaches the real firewall or a real unit; a script that calls sudo by a path (past the stand-in) is not run
// (scriptProblem says CANNOT RUN). The canary is a listener of the case's own on 127.0.0.1.
// CASE_HEAL_DIR points a run at a copy of the scripts (a case shown failing against a changed copy); unset, the
// scripts are this repo's deploy/heal.

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scratchDir } from "./scratch.mjs";

const LIB = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(LIB, "../..");
const STUBS = path.join(LIB, "heal_stubs");
const SUDO_BY_PATH = /(^|[\s;&|(])\/[\w./-]*\/sudo\b/m;
const PROXIES = ["http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"];
const STATE_FILES = ["sudo.log", "systemctl.log", "inserts", "restarted", "refuse-read", "refuse-insert", "chain"];

/** An INPUT chain as iptables -S prints it: both drops of 5183, 5184's docker0 drop only (its parts in another
 *  order), and three rules that are not drops of 5184 from br-+ (udp, port 51840, ACCEPT). */
export const PARTIAL_CHAIN = [
  "-P INPUT ACCEPT",
  "-A INPUT -p tcp -m tcp --dport 5184 -i docker0 -j DROP",
  "-A INPUT -i br-+ -p tcp -m tcp --dport 5183 -j DROP",
  "-A INPUT -i docker0 -p tcp -m tcp --dport 5183 -j DROP",
  "-A INPUT -i br-+ -p udp -m udp --dport 5184 -j DROP",
  "-A INPUT -i br-+ -p tcp -m tcp --dport 51840 -j DROP",
  "-A INPUT -i br-+ -p tcp -m tcp --dport 5184 -j ACCEPT",
].join("\n") + "\n";

export function healScript(name) {
  return path.join(process.env.CASE_HEAL_DIR || path.join(REPO, "deploy", "heal"), name);
}

/** null when the script can be run here; else { broken, why }: broken for a script missing or not executable,
 *  not broken (CANNOT RUN) for one whose sudo the stand-in could not catch. */
export function scriptProblem(script) {
  let text;
  try {
    text = fs.readFileSync(script, "utf8");
  } catch (error) {
    return { broken: true, why: script + " cannot be read (" + error.code + ")" };
  }
  try {
    fs.accessSync(script, fs.constants.X_OK);
  } catch {
    return { broken: true, why: script + " is not executable" };
  }
  if (SUDO_BY_PATH.test(text)) {
    return { broken: false, why: path.basename(script) + " calls sudo by a path, past the stand-in: nothing that could reach the real firewall or a unit is run" };
  }
  return null;
}

/** The stand-ins and their state in a scratch folder: a unit 100 s old, an empty INPUT chain. */
export async function stubHouse(t) {
  const dir = await scratchDir(t, "heal");
  const bin = path.join(dir, "bin");
  const state = path.join(dir, "state");
  fs.mkdirSync(bin);
  fs.mkdirSync(state);
  for (const name of ["sudo", "systemctl"]) {
    fs.copyFileSync(path.join(STUBS, name + ".sh"), path.join(bin, name));
    fs.chmodSync(path.join(bin, name), 0o755);
  }
  const at = (name) => path.join(state, name);
  const lines = (name) => (fs.existsSync(at(name)) ? fs.readFileSync(at(name), "utf8").split("\n").filter(Boolean) : []);
  const house = {
    bin,
    state,
    reset() {
      for (const name of STATE_FILES) fs.rmSync(at(name), { force: true });
      fs.writeFileSync(at("chain"), "-P INPUT ACCEPT\n");
    },
    setChain(text) { fs.writeFileSync(at("chain"), text); },
    refuse(what) { fs.writeFileSync(at("refuse-" + what), ""); },
    setAge(seconds) {
      const uptime = Number(fs.readFileSync("/proc/uptime", "utf8").split(" ")[0]);
      fs.writeFileSync(at("entered"), String(Math.round((uptime - seconds) * 1e6)) + "\n");
    },
    sudoCalls() { return lines("sudo.log"); },
    inserts() { return lines("inserts"); },
    restarted() { return fs.existsSync(at("restarted")); },
  };
  house.reset();
  house.setAge(100);
  return house;
}

/** Runs the script with the stand-ins first on PATH: { code, lines, stderr, ms }. */
export function runScript(script, args, house, timeoutMs = 80000) {
  const env = { ...process.env, PATH: house.bin + ":" + (process.env.PATH || "/usr/bin:/bin"), CASE_HEAL_STATE: house.state };
  for (const name of PROXIES) delete env[name];
  return new Promise((resolve) => {
    const started = Date.now();
    let out = "";
    let err = "";
    const child = spawn(script, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, lines: [], stderr: String(error.message), ms: Date.now() - started });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, lines: out.split("\n").filter((line) => line !== ""), stderr: err, ms: Date.now() - started });
    });
  });
}

/** A listener answering every GET with statusOf(); requests holds { url, at } for each. */
export async function canary(statusOf) {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({ url: request.url, at: Date.now() });
    response.statusCode = statusOf();
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  server.unref();
  return {
    base: "http://127.0.0.1:" + server.address().port,
    requests,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

/** A url on a port that was just free: nothing answers it. */
export async function deadUrl() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(() => resolve()));
  return "http://127.0.0.1:" + port + "/src/main.tsx";
}

/** The t= token of a request line, or null. */
export function tokenOf(url) {
  const at = url.indexOf("?");
  return at < 0 ? null : new URLSearchParams(url.slice(at + 1)).get("t");
}
