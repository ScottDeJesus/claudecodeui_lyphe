// protects: server/modules/agent-launch/agent-launch.service.ts, server/modules/agent-launch/agent-launch.routes.ts, server/modules/agent-launch/agent-launch.module.ts, src/shared/api.ts
// writes: none
//
// A HUNT ROW SAVES (bug-hunters seam 10). Edit Agent Chains saves a row as `PUT /api/agent-launch/rows/<name>`
// (`src/shared/api.ts`, the name URI-encoded); a hunt row is named `hunt.<kind>` and changes `soul` and `model`. The
// service passes `set hunt.<kind> --soul S --model M` to the launch table's CLI and answers the census it printed;
// `model: null` is the CLI's `default`. A soul that is not a word (a leading dash would be read as a flag) never
// reaches the CLI: a 400. `--effort` on a hunt row is the CLI's refusal: a 400. A tweak row still saves as it did, and
// GET relays the census whole, each hunt row's `soul` and `choices.hunt_souls` included.
// The CLI is a stand-in (LAUNCH_TABLE_BIN) that records each argv; the real launch table is never written.

import { chmod, readFile, writeFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const CENSUS = {
  file: "/scratch/launch.toml", state: "ok", problems: [], defaults: {},
  choices: { models: ["opus", "sonnet"], efforts: ["high"], hunt_souls: ["argus", "athena", "daedalus"] },
  rows: [
    { name: "tweak", kind: "tweak", model: "opus", model_pinned: false, effort: "high", effort_pinned: true, lanes: [] },
    { name: "hunt.data", kind: "hunt", soul: "sherlock", model: "opus", model_pinned: false, effort: "max", effort_pinned: true, lanes: [], shim: null },
  ],
};
const EFFORT_REFUSED = "a hunt row's effort is not its own: it is its soul's effort pin, or the table's default for its model";

const STAND_IN = `#!/usr/bin/env node
const fs = require("node:fs"); const path = require("node:path");
const home = path.dirname(process.argv[1]); const argv = process.argv.slice(2);
fs.appendFileSync(path.join(home, "calls.jsonl"), JSON.stringify(argv) + "\\n");
if (argv[0] === "set" && argv.includes("--effort") && argv[1].startsWith("hunt.")) { console.log(JSON.stringify({ error: ${JSON.stringify(EFFORT_REFUSED)} })); process.exit(2); }
console.log(fs.readFileSync(path.join(home, "census.json"), "utf8"));
`;

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const folder = await scratchDir(t, "hunt-row-save");
  const bin = path.join(folder, "launch-table");
  await writeFile(bin, STAND_IN);
  await chmod(bin, 0o755);
  await writeFile(path.join(folder, "census.json"), JSON.stringify(CENSUS));
  process.env.LAUNCH_TABLE_BIN = bin;
  const callsFile = path.join(folder, "calls.jsonl");
  const calls = async (): Promise<string[][]> => (fs.existsSync(callsFile) ? (await readFile(callsFile, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

  let router: any;
  let express: any;
  try {
    express = (await import("express")).default;
    const mod: any = await import("../../server/modules/agent-launch/index.ts");
    router = mod.createAgentLaunchModule().router;
  } catch (error) {
    return cannotRun(`the agent-launch module would not load: ${String((error as Error).message).split("\n")[0]}`);
  }
  const app = express();
  app.use(express.json());
  app.use("/api/agent-launch", router);
  const server: any = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  t.defer(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const origin = `http://127.0.0.1:${server.address().port}/api/agent-launch`;
  const put = async (name: string, body: unknown) => {
    const response = await fetch(`${origin}/rows/${encodeURIComponent(name)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, text };
  };

  const wrong: string[] = [];
  const last = async () => (await calls()).at(-1) ?? null;
  const pairOf = (argv: string[] | null, flag: string) => (argv && argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);

  const saved = await put("hunt.data", { soul: "daedalus", model: "sonnet" });
  const savedArgv = await last();
  if (saved.status !== 200 || saved.text.trim() !== JSON.stringify(CENSUS)) wrong.push(`PUT rows/hunt.data {soul, model} answered ${saved.status} ${saved.text.slice(0, 120)}, not the census the CLI printed`);
  if (!savedArgv || savedArgv[0] !== "set" || savedArgv[1] !== "hunt.data" || pairOf(savedArgv, "--soul") !== "daedalus" || pairOf(savedArgv, "--model") !== "sonnet" || savedArgv.length !== 6) {
    wrong.push(`PUT rows/hunt.data {soul, model} ran ${JSON.stringify(savedArgv)}, not set hunt.data --soul daedalus --model sonnet`);
  }

  const cleared = await put("hunt.code", { model: null });
  const clearedArgv = await last();
  if (cleared.status !== 200 || JSON.stringify(clearedArgv) !== JSON.stringify(["set", "hunt.code", "--model", "default"])) wrong.push(`PUT rows/hunt.code {model: null} answered ${cleared.status} and ran ${JSON.stringify(clearedArgv)}, not set hunt.code --model default`);

  const heardBefore = (await calls()).length;
  const flagSoul = await put("hunt.data", { soul: "--model" });
  if (flagSoul.status !== 400 || (await calls()).length !== heardBefore) wrong.push(`PUT rows/hunt.data {soul: "--model"} answered ${flagSoul.status}${(await calls()).length !== heardBefore ? ` and ran ${JSON.stringify(await last())}` : ""}, not a 400 that reaches no CLI`);

  const effort = await put("hunt.data", { effort: "high" });
  if (effort.status !== 400) wrong.push(`PUT rows/hunt.data {effort: high} answered ${effort.status} ${effort.text.slice(0, 100)}, not a 400`);

  const tweak = await put("tweak", { model: "sonnet" });
  const tweakArgv = await last();
  if (tweak.status !== 200 || JSON.stringify(tweakArgv) !== JSON.stringify(["set", "tweak", "--model", "sonnet"])) wrong.push(`PUT rows/tweak {model: sonnet} answered ${tweak.status} and ran ${JSON.stringify(tweakArgv)}, not set tweak --model sonnet`);

  const census = await fetch(origin + "/");
  const read = await census.text();
  if (census.status !== 200 || read.trim() !== JSON.stringify(CENSUS)) wrong.push(`GET / answered ${census.status} ${read.slice(0, 120)}, not the census whole (hunt row soul and choices.hunt_souls kept)`);

  if (wrong.length > 0) return broken(wrong.join("; ").slice(0, 900));
  return held("set hunt.data --soul daedalus --model sonnet relayed with its census; a null model sent default; a dash soul a 400 that reached no CLI; a hunt effort a 400; the tweak still saves; GET relayed the census whole");
});
