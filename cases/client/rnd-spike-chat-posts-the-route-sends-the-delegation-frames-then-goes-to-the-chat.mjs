// protects: src/modules/rnd/startSpikeChat.ts
// writes: none
//
// A spike's chat (rnd-area phase 6, interface G): startSpikeChat posts POST /api/rnd/candidates/:name/spike {projectPath}, sends
// the two frames git-delegation/startRun.ts sends — chat.send {sessionId, content: prompt, options: {provider: 'claude', model,
// permissionMode: 'bypassPermissions', skipPermissions: true}} and chat.subscribe {sessions: [{sessionId, lastSeq: 0}]} — and
// then goes to the chat through goChat(sessionId). A refusal is the server's sentence, and nothing is sent.
//
// startSpikeChat.ts is transpiled with the repo's TypeScript and run with api.rnd.spike and rndWire stubbed; nothing else is
// imported.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);

const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));

/** The module at rel, transpiled with the repo's TypeScript (JSX as __h calls), each import taken from stubs by its specifier. */
async function loadStubbed(rel, stubs) {
  const ts = require("typescript");
  const text = await readFile(path.join(REPO, rel), "utf8");
  const js = ts.transpileModule(text, {
    fileName: path.basename(rel),
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: "__h", jsxFragmentFactory: "__F" },
  }).outputText;
  const missing = [];
  const code = js.replace(/^import\s+(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\}\s*)?(?:from\s*)?['"]([^'"]+)['"];?[ \t]*$/gm, (all, def, named, spec) => {
    if (!Object.prototype.hasOwnProperty.call(stubs, spec)) {
      missing.push(spec);
      return "";
    }
    const from = "globalThis.__caseStubs[" + JSON.stringify(spec) + "]";
    const parts = [];
    if (def) parts.push("const " + def + " = " + from + ".default;");
    if (named && named.trim()) parts.push("const {" + named.replace(/\b([\w$]+)\s+as\s+([\w$]+)/g, "$1: $2") + "} = " + from + ";");
    return parts.join(" ");
  });
  if (missing.length > 0) return { missing };
  if (/^import\s/m.test(code)) return { missing: ["an import of a shape this case does not read"] };
  globalThis.__caseStubs = stubs;
  const prelude = "const __h = (type, props, ...children) => ({ type, props, children });\nconst __F = 'fragment';\n";
  return await import("data:text/javascript;base64," + Buffer.from(prelude + code).toString("base64"));
}

const firstLineOf = (error) => String((error && error.message) || error).split("\n")[0].slice(0, 160);
const isRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const wire = {
  isRecord,
  readBody: async (response) => { try { return await response.json(); } catch { return null; } },
  sentenceOf: (body) => (isRecord(body) ? String(body.stdout || body.stderr || body.error || "").split("\n")[0] : ""),
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));

runCase(async () => {
  const log = [];
  let answer = null;
  const stubs = {
    "@/shared/api": { api: { rnd: { spike: async (name, request) => { log.push(["post", name, request]); return answer; } } } },
    "@/modules/rnd/rndWire": wire,
  };
  let mod;
  try {
    mod = await loadStubbed("src/modules/rnd/startSpikeChat.ts", stubs);
  } catch (error) {
    return broken("startSpikeChat.ts would not load: " + firstLineOf(error));
  }
  if (mod.missing) return cannotRun("startSpikeChat.ts now imports " + mod.missing.join(", ") + ", which this case does not stub");
  if (typeof mod.startSpikeChat !== "function") return broken("startSpikeChat.ts exports no startSpikeChat");
  const send = (message) => log.push(["send", message]);
  const go = (sessionId) => log.push(["go", sessionId]);
  const wrong = [];
  const prompt = "/spike Does it settle?\n\nCandidate: cand-x";

  answer = { ok: true, status: 200, json: async () => ({ sessionId: "sess-1", prompt, model: "opus" }) };
  try {
    await mod.startSpikeChat("cand-x", "/home/p", send, go);
  } catch (error) {
    wrong.push("an answered spike threw: " + firstLineOf(error));
  }
  const want = [
    ["post", "cand-x", { projectPath: "/home/p" }],
    ["send", { type: "chat.send", sessionId: "sess-1", content: prompt, options: { provider: "claude", model: "opus", permissionMode: "bypassPermissions", skipPermissions: true } }],
    ["send", { type: "chat.subscribe", sessions: [{ sessionId: "sess-1", lastSeq: 0 }] }],
    ["go", "sess-1"],
  ];
  if (canon(log) !== canon(want)) wrong.push("an answered spike did " + canon(log).slice(0, 500));

  for (const [label, reply, sentence] of [
    ["a refused route", { ok: false, status: 409, json: async () => ({ stdout: "REFUSED spike cand-x: cand-x is adopted\n" }) }, "REFUSED spike cand-x"],
    ["an answer naming no session", { ok: true, status: 200, json: async () => ({ prompt, model: "opus" }) }, null],
  ]) {
    log.length = 0;
    answer = reply;
    let thrown = null;
    try {
      await mod.startSpikeChat("cand-x", "/home/p", send, go);
    } catch (error) {
      thrown = String((error && error.message) || error);
    }
    if (thrown === null) wrong.push(label + " did not throw");
    else if (sentence !== null && !thrown.includes(sentence)) wrong.push(label + " threw " + JSON.stringify(thrown) + ", not the server's sentence");
    const after = log.filter((entry) => entry[0] !== "post");
    if (after.length > 0) wrong.push(label + " still did " + canon(after).slice(0, 200));
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("post {projectPath}, chat.send (claude, the answered model, bypassPermissions, skipPermissions) then chat.subscribe lastSeq 0, then goChat; a refusal throws the dispatcher's sentence and sends nothing");
});
