// The engine's status on the server's health answer (rust-transcript-engine, interface 3): GET /health carries
// transcriptEngine {"ok":true,"version":<what the built binary's --version prints>,"protocol":<its protocol>,"error":null}.
//
// protects: server/index.ts, server/modules/transcript-engine/, rust/transcript-engine/src/main.rs
// writes: none

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { api } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ENGINE = path.join(REPO, "rust/target/release/transcript-engine");

function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

runCase(async () => {
  const version = spawnSync(ENGINE, ["--version"], { encoding: "utf8", timeout: 30000 });
  if (version.error) return broken("the engine " + ENGINE + " would not run (" + (version.error.code || version.error.message) + "): npm run build:engine builds it");
  const said = String(version.stdout || "").trim();
  const match = /^transcript-engine (\S+) protocol (\d+)$/.exec(said);
  if (!match) return broken("--version printed " + JSON.stringify(said.slice(0, 120)));
  const out = await api("/health");
  if (out.status !== 200) return broken("GET /health answered " + out.status);
  const got = out.json ? out.json.transcriptEngine : undefined;
  const want = { ok: true, version: match[1], protocol: Number(match[2]), error: null };
  if (canonical(got) !== canonical(want)) return broken("GET /health's transcriptEngine is " + JSON.stringify(got) + ", not " + JSON.stringify(want));
  return held("GET /health carries transcriptEngine " + JSON.stringify(got) + ", as --version prints " + JSON.stringify(said));
});
