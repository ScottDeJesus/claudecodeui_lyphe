// protects: server/shared/types.ts, src/shared/types.ts, src/shared/hooks/useServerFrame.ts, server/modules, src/modules, src/shared
// writes: none
//
// THE SEAMS JOIN (pollers-hooks--client-pushes, seam 16). A kind declared but never sent, or a rider subscribed to a
// kind nobody sends, is a reader that never wakes. For each of the thirteen kinds the plan pushes: it is a member of
// GatewayEventKind (server/shared/types.ts) and named in src/shared/types.ts, a server file other than the types names
// it (the sender), and a client hook rides it through useServerFrame (or a subscribe beside it). And every kind any
// useServerFrame call in src rides is one the server declares or names, websocket_reconnected aside (the client's own).
// A reading of the source as it stands.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HINTS = ["memory_changed", "accounts_changed", "drafts_changed", "claude_updates_changed", "cli_version_changed", "heal_changed", "jev_changed", "deepseek_usage_changed", "subagent_transcript_changed"];
const STATES = ["running_sessions_state", "accounts_usage_state", "deepseek_balance_state", "app_release_state"];
const KINDS = HINTS.concat(STATES);
const RECONNECTED = "websocket_reconnected";
const SERVER_TYPES = path.join(REPO, "server/shared/types.ts");
const CLIENT_TYPES = path.join(REPO, "src/shared/types.ts");
const RIDER_HOOK = path.join(REPO, "src/shared/hooks/useServerFrame.ts");
const CALL = /useServerFrame\(\s*(\[[^\]]*\]|[A-Za-z_$][\w$]*)/g;
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const SKIP = new Set(["node_modules", "dist", ".git"]);

function sources(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(full, found);
    else if (SOURCE.test(entry.name)) found.push(full);
  }
  return found;
}

function gatewayKinds(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.startsWith("export type GatewayEventKind"));
  if (start < 0) return null;
  const kinds = new Set();
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i].trim();
    const comment = line.startsWith("//") || line.startsWith("/*") || line.startsWith("*");
    if (i > start && !(line.startsWith("|") || comment || line === "")) break;
    if (comment) continue;
    for (const m of line.matchAll(/'([a-z0-9_]+)'/g)) kinds.add(m[1]);
    if (line.endsWith(";")) break;
  }
  return kinds;
}

const literal = (kind) => new RegExp("[\"'\\x60]" + kind + "[\"'\\x60]");
const quoted = (text) => [...text.matchAll(/["'\x60]([a-z0-9_]+)["'\x60]/g)].map((m) => m[1]);

function definitionOf(name, own, texts) {
  const pattern = new RegExp("(?:const|let)\\s+" + name.replace(/\$/g, "\\$") + "\\b[^=\\n]*=\\s*(\\[[^\\]]*\\])");
  const here = pattern.exec(own);
  if (here) return here[1];
  for (const text of texts.values()) {
    const there = pattern.exec(text);
    if (there) return there[1];
  }
  return null;
}

/** The kinds a rider's list names: quoted literals, and identifiers resolved to the string constant they hold. */
function kindsIn(list, own, texts) {
  const kinds = quoted(list);
  for (const m of list.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
    const constant = new RegExp("(?:const|let)\\s+" + m[1].replace(/\$/g, "\\$") + "\\b[^=\\n]*=\\s*[\"'\\x60]([a-z0-9_]+)[\"'\\x60]");
    const here = constant.exec(own) ?? [...texts.values()].map((text) => constant.exec(text)).find(Boolean);
    if (here) kinds.push(here[1]);
  }
  return kinds;
}

runCase(async () => {
  let serverTypes, clientTypes;
  try {
    serverTypes = fs.readFileSync(SERVER_TYPES, "utf8");
    clientTypes = fs.readFileSync(CLIENT_TYPES, "utf8");
  } catch (error) {
    return cannotRun("the two types files could not be read: " + String(error));
  }
  const declared = gatewayKinds(serverTypes);
  if (!declared) return broken("server/shared/types.ts declares no GatewayEventKind");
  const serverTexts = new Map();
  for (const file of sources(path.join(REPO, "server"))) if (file !== SERVER_TYPES) serverTexts.set(file, fs.readFileSync(file, "utf8"));
  const clientTexts = new Map();
  for (const file of sources(path.join(REPO, "src"))) if (file !== CLIENT_TYPES) clientTexts.set(file, fs.readFileSync(file, "utf8"));
  const serverNames = (kind) => [...serverTexts.values()].some((text) => literal(kind).test(text));

  const faults = [];
  const ridden = new Set();
  const unresolved = [];
  for (const [file, text] of clientTexts) {
    if (file === RIDER_HOOK) continue;
    for (const call of text.matchAll(CALL)) {
      const list = call[1].startsWith("[") ? call[1] : definitionOf(call[1], text, clientTexts);
      if (list === null) {
        unresolved.push(path.relative(REPO, file) + ":" + call[1]);
        continue;
      }
      for (const kind of kindsIn(list, text, clientTexts)) {
        if (kind === RECONNECTED) continue;
        ridden.add(kind);
        if (!declared.has(kind) && !serverNames(kind)) faults.push(path.relative(REPO, file) + " rides " + kind + ", which the server neither declares nor sends");
      }
    }
  }
  for (const kind of KINDS) {
    if (!declared.has(kind)) faults.push(kind + " is not in GatewayEventKind");
    if (!literal(kind).test(clientTypes)) faults.push(kind + " is not named in src/shared/types.ts");
    if (!serverNames(kind)) faults.push(kind + " is declared but no server file sends it");
    const subscribed = ridden.has(kind) || [...clientTexts.values()].some((text) => literal(kind).test(text) && /\bsubscribe\(/.test(text));
    if (!subscribed) faults.push(kind + " is sent but no client hook rides it");
  }
  if (faults.length > 0) return broken([...new Set(faults)].join("; "));
  return held("all thirteen kinds are declared on both sides, sent by a server file and ridden by a client hook; " + ridden.size + " kinds ridden through useServerFrame, every one declared or sent" + (unresolved.length ? " (arguments not read as lists: " + unresolved.join(", ") + ")" : ""));
});
