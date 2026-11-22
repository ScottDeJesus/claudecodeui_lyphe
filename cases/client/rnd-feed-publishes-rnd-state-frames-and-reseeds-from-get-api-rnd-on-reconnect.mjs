// protects: src/modules/rnd/RndFeed.tsx
// writes: none
//
// The R&D lane's feed (rnd-area phase 6, interface G): RndFeed seeds the picture from GET /api/rnd, publishes each rnd_state
// frame on the live bus's R&D topic, and re-seeds from GET /api/rnd on websocket_reconnected as RoadmapFeed does, since the lane
// speaks only on a change and a write that landed while the socket was down would otherwise stay unseen.
//
// RndFeed.tsx is transpiled with the repo's TypeScript (JSX as plain calls) and its effect run with React, i18n, the live bus,
// the socket, useRnd, rndWire and the api stubbed; the effect is the whole of what is judged.
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

const picture = (n) => ({
  generated_at: "2026-11-21T00:00:0" + n + "Z",
  settings: { web_search: true, weekly: null, sources: [] },
  scout: { out: null, last: null },
  standing: { waiting: n, spiking: 0, proved: 0, adopted: 0, rejected: 0 },
  candidates: [],
});

runCase(async () => {
  let reads = 0;
  let serving = { ...picture(1), at: 1000 };
  let handler = null;
  const cleanups = [];
  const published = [];
  const bus = {
    held: null,
    get() { return this.held; },
    publish(topic, payload, at) { published.push({ topic, payload, at }); this.held = { payload, at }; },
  };
  const stubs = {
    react: { useEffect: (effect) => { cleanups.push(effect()); } },
    "react-i18next": { useTranslation: () => ({ t: (key) => key }) },
    "@/modules/live-bus": { RND_ALL_TOPIC: "rnd:all", useLiveBus: () => bus },
    "@/modules/rnd/hooks/useRnd": { registerReread: () => () => {}, sayFeedFailure: () => {} },
    "@/modules/rnd/rndWire": wire,
    "@/shared/api": { api: { rnd: { picture: async () => { reads += 1; const body = serving; return { ok: true, status: 200, json: async () => body }; } } } },
    "@/shared/context/WebSocketContext": { useWebSocket: () => ({ subscribe: (listener) => { handler = listener; return () => { handler = null; }; } }) },
  };
  let mod;
  try {
    mod = await loadStubbed("src/modules/rnd/RndFeed.tsx", stubs);
  } catch (error) {
    return broken("RndFeed.tsx would not load: " + firstLineOf(error));
  }
  if (mod.missing) return cannotRun("RndFeed.tsx now imports " + mod.missing.join(", ") + ", which this case does not stub");
  if (typeof mod.RndFeed !== "function") return broken("RndFeed.tsx exports no RndFeed");
  const wrong = [];
  mod.RndFeed({ children: null });
  await tick();
  if (typeof handler !== "function") return broken("RndFeed subscribed nothing to the socket");
  const last = () => published[published.length - 1];
  if (reads !== 1 || published.length !== 1 || last().topic !== "rnd:all" || last().payload.standing.waiting !== 1) wrong.push("the seed read " + reads + " time(s) and published " + canon(published).slice(0, 200));

  serving = { ...picture(2), at: 2000 };
  handler({ kind: "websocket_reconnected" });
  await tick();
  if (reads !== 2) wrong.push("a reconnect read GET /api/rnd " + (reads - 1) + " time(s), not once");
  else if (published.length !== 2 || last().payload.standing.waiting !== 2) wrong.push("a reconnect's newer picture was not published (" + published.length + " publishes)");

  handler({ kind: "rnd_state", ...picture(3), at: 3000 });
  await tick();
  if (reads !== 2) wrong.push("an rnd_state frame made a read");
  if (published.length !== 3 || last().payload.standing.waiting !== 3) wrong.push("the rnd_state frame was not published");
  else if ("kind" in last().payload || "at" in last().payload) wrong.push("the published picture carries the frame's kind or at");

  handler({ kind: "roadmap_state", ...picture(4), at: 4000 });
  await tick();
  if (published.length !== 3 || reads !== 2) wrong.push("another lane's frame published or read");

  for (const cleanup of cleanups) if (typeof cleanup === "function") cleanup();
  if (handler !== null) wrong.push("unmounting left the socket subscription");
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("seed published once; a reconnect re-read GET /api/rnd and published the newer picture; an rnd_state frame published without a read or its kind; a roadmap frame ignored; unmount unsubscribed");
});
