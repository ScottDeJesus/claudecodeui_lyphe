// dispatch_routes.mjs — the board-dispatch module's ROUTER (`/api/kanban-dispatch/...`), mounted on an express app of the
// case's own over a scratch board database, against a stand-in dispatcher that answers from rules the case writes.
//
//   import { routesRig } from "../lib/dispatch_routes.mjs";
//   const rig = await routesRig(t, "hunts-routes", [
//     { has: ["hunt", "config", "--projects", "Nope"], stdout: "REFUSED hunt config: ...", exit: 2 },
//     { has: ["hunt", "config"], stdout: JSON.stringify(config) },
//   ]);                                                 // before any server import
//   const { kanban } = await rig.open();               // the scratch database made, the kanban barrel loaded
//   const route = await rig.mount();                   // the module made (never started) and its router listening
//   const r = await route("PUT", "/hunts/settings", { nightly: true });   // { status, json, text }
//   (await rig.calls()).map((c) => c.argv)            // every argv the stand-in heard, in order
//
// The module is made with `createKanbanDispatchModule(stand-in store watch)` and NOT started, so no placing pass or
// note applier runs: the stand-in hears only what a route sends it. The router is mounted at `/api/kanban-dispatch`
// behind `express.json()`, as server/index.ts mounts it, minus `authenticateToken` (the live server's cases judge the 401).
// A rule matches when the argv holds every word of `has` in that order (not necessarily adjacent; `--flag=value` counts as
// the two words `--flag value`); the first that
// matches answers, else `{}` at exit 0. Nothing reaches the real dispatcher.

import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";

import { placingRig } from "./board_placing.mjs";

const STAND_IN = `#!/usr/bin/env node
const fs = require("node:fs"); const path = require("node:path");
const home = path.dirname(process.argv[1]); const argv = process.argv.slice(2);
// stdin is never read: a route's command is handed no input, and a pipe left open would hold the read to the timeout.
fs.appendFileSync(path.join(home, "calls.jsonl"), JSON.stringify({ argv, at: Date.now() }) + "\\n");
const rules = JSON.parse(fs.readFileSync(path.join(home, "rules.json"), "utf8"));
// \`--flag=value\` is read as \`--flag value\`, as argparse reads it, so a rule matches either spelling.
const words = argv.flatMap((w) => (/^--[a-z-]+=/.test(w) ? [w.slice(0, w.indexOf("=")), w.slice(w.indexOf("=") + 1)] : [w]));
const holds = (has) => { let at = 0; for (const word of words) { if (at < has.length && word === has[at]) at += 1; } return at === has.length; };
const rule = rules.find((r) => holds(r.has));
if (!rule) { console.log("{}"); process.exit(0); }
if (rule.stdout !== undefined) console.log(rule.stdout);
if (rule.stderr !== undefined) console.error(rule.stderr);
process.exit(rule.exit ?? 0);
`;

export async function routesRig(t, label, rules) {
  const rig = await placingRig(t, label, {});
  const bin = process.env.DISPATCHER_BIN;
  await writeFile(bin, STAND_IN);
  await chmod(bin, 0o755);
  await writeFile(path.join(rig.folder, "rules.json"), JSON.stringify(rules));
  return {
    ...rig,
    /** Replaces the stand-in's rules, for a case whose later calls must be answered otherwise. */
    rules: (next) => writeFile(path.join(rig.folder, "rules.json"), JSON.stringify(next)),
    /** Makes the module over the scratch database and serves its router on a port of this process's own. */
    mount: async () => {
      const { default: express } = await import("express");
      const mod = await import("../../server/modules/kanban-dispatch/index.ts");
      const storeWatch = { attach: () => () => {}, followChains: () => {}, start: () => {}, stop: () => {} };
      const made = mod.createKanbanDispatchModule(storeWatch);
      const app = express();
      app.use(express.json());
      app.use("/api/kanban-dispatch", made.router);
      const server = await new Promise((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
      });
      t.defer(() => new Promise((resolve) => server.close(() => resolve())));
      const origin = `http://127.0.0.1:${server.address().port}/api/kanban-dispatch`;
      return async (method, route, body) => {
        const response = await fetch(origin + route, {
          method,
          headers: body === undefined ? {} : { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await response.text();
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {}
        return { status: response.status, json, text };
      };
    },
  };
}
