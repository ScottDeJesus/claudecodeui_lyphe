// protects: server/modules/voice/, server/modules/gemini-meter/index.ts
// writes: none
//
// askGemini is the only sender to Google and the only reader of the raw key. Reading the server's source as it stands:
// resolveGeminiKey is used by no file but server/modules/voice/gemini-wire.ts outside gemini-key.ts, which defines it; the
// voice barrel (server/modules/voice/index.ts) exports no key reader; the x-goog-api-key header is written only in
// gemini-wire.ts; and no server file that names Google's generativelanguage host calls fetch itself.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SERVER = path.join(ROOT, "server");
const WIRE = "server/modules/voice/gemini-wire.ts";
const KEY_HOME = "server/modules/voice/gemini-key.ts";
const BARREL = "server/modules/voice/index.ts";
const SOURCE = /\.(?:ts|tsx|mts|js|mjs|cjs)$/;
const SKIP = new Set(["node_modules", "dist", ".git"]);
const GOOGLE_HOST = "generativelanguage.googleapis.com";

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (SOURCE.test(entry.name)) out.push(full);
  }
  return out;
}

/** A file's code with its comments cut: block comments, and lines that are only a line comment. */
const codeOf = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

runCase(async () => {
  const files = sourceFiles(SERVER).map((full) => ({ rel: path.relative(ROOT, full), code: codeOf(fs.readFileSync(full, "utf8")) }));
  const wrong = [];
  const keyReaders = files.filter((f) => f.rel !== KEY_HOME && /\bresolveGeminiKey\b/.test(f.code)).map((f) => f.rel).sort();
  if (keyReaders.join(",") !== WIRE) wrong.push("resolveGeminiKey is used outside gemini-key.ts by " + (keyReaders.join(", ") || "no file") + ", not by gemini-wire.ts alone");
  const barrel = files.find((f) => f.rel === BARREL);
  if (!barrel) wrong.push("there is no voice barrel at " + BARREL);
  else if (/\b(resolveGeminiKey|readHouseKey|readKeyFromEnvFile)\b/.test(barrel.code)) wrong.push("the voice barrel exports a reader of the raw key");
  const headerWriters = files
    .filter((f) => /["']x-goog-api-key["']\s*:/i.test(f.code) || /\.(set|append)\(\s*["']x-goog-api-key["']/i.test(f.code))
    .map((f) => f.rel)
    .sort();
  if (headerWriters.join(",") !== WIRE) wrong.push("the x-goog-api-key header is written by " + (headerWriters.join(", ") || "no file") + ", not by gemini-wire.ts alone");
  const hostNamers = files.filter((f) => f.code.includes(GOOGLE_HOST));
  const senders = hostNamers.filter((f) => /\bfetch\s*\(/.test(f.code)).map((f) => f.rel);
  if (senders.length > 0) wrong.push("files that name Google's host and call fetch themselves: " + senders.join(", "));
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("resolveGeminiKey used only in gemini-wire.ts; the barrel exports no key reader; the header written only there; " + hostNamers.length + " file(s) name Google's host (" + hostNamers.map((f) => path.basename(f.rel)).join(", ") + ") and none calls fetch");
});
