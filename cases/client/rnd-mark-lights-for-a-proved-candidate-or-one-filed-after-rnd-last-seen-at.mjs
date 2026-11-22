// protects: src/modules/rnd/hooks/useRndSeen.ts
// writes: none
//
// The place's mark on the wheel (rnd-area phase 6, interface G): lit when a candidate is proved, or was filed after the operator
// last stood on the place, a stamp the client keeps in localStorage under rnd.lastSeenAt. The dispatcher writes UTC stamps
// without a zone ("2026-11-20 11:30:00"); read as local time they would move by the box's offset, so the case runs in
// America/Los_Angeles, where that misreading turns a filing before the stamp into one after it.
//
// useRndSeen.ts is transpiled with the repo's TypeScript and run with React, i18n and the live bus stubbed and a window whose
// localStorage is a Map.
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

process.env.TZ = "America/Los_Angeles";
const KEY = "rnd.lastSeenAt";

runCase(async () => {
  const kept = new Map();
  globalThis.window = {
    localStorage: { getItem: (key) => (kept.has(key) ? kept.get(key) : null), setItem: (key, value) => kept.set(key, String(value)) },
    addEventListener() {},
    removeEventListener() {},
  };
  let topic = null;
  const stubs = {
    react: { useMemo: (make) => make(), useSyncExternalStore: (subscribe, snapshot) => snapshot() },
    "react-i18next": { useTranslation: () => ({ t: (key, options) => key + ":" + (options ? options.count : "") }) },
    "@/modules/live-bus": { RND_ALL_TOPIC: "rnd:all", useLiveTopic: () => topic },
  };
  let mod;
  try {
    mod = await loadStubbed("src/modules/rnd/hooks/useRndSeen.ts", stubs);
  } catch (error) {
    return broken("useRndSeen.ts would not load: " + firstLineOf(error));
  }
  if (mod.missing) return cannotRun("useRndSeen.ts now imports " + mod.missing.join(", ") + ", which this case does not stub");
  if (typeof mod.useRndMark !== "function" || typeof mod.stampRndSeen !== "function") return broken("useRndSeen.ts exports no useRndMark or stampRndSeen");
  const candidate = (word, filed) => ({ name: word + "-" + filed, title: word, word, filed_at: filed, source_url: "https://example.org/" + word });
  const mark = (candidates) => {
    topic = candidates === null ? null : { payload: { generated_at: "", settings: { web_search: true, weekly: null, sources: [] }, scout: { out: null, last: null }, standing: {}, candidates }, at: 1 };
    return mod.useRndMark();
  };
  const wrong = [];
  const expect = (label, candidates, lit) => {
    const got = mark(candidates);
    if ((got !== null) !== lit) wrong.push(label + ": " + (lit ? "unlit" : "lit (" + canon(got) + ")"));
  };
  kept.set(KEY, "2026-11-20T12:00:00.000Z");
  expect("no picture", null, false);
  expect("everything filed before the stamp, none proved (a zoneless 11:30 UTC among them)", [candidate("waiting", "2026-11-20 11:30:00"), candidate("rejected", "2026-11-19T00:00:00Z"), candidate("adopted", "2026-11-01 08:00:00")], false);
  expect("a proved candidate filed long before the stamp", [candidate("waiting", "2026-01-01 00:00:00"), candidate("proved", "2026-01-01 00:00:00")], true);
  expect("a candidate filed half an hour after the stamp", [candidate("waiting", "2026-11-20 12:30:00")], true);
  kept.delete(KEY);
  expect("no stamp kept", [candidate("waiting", "2020-01-01 00:00:00")], true);
  mod.stampRndSeen();
  if (!kept.has(KEY)) wrong.push("stampRndSeen kept no " + KEY);
  expect("after stampRndSeen", [candidate("waiting", "2020-01-01 00:00:00")], false);
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("lit for proved and for a filing after the stamp, unlit for older filings (zoneless read as UTC) and with no picture, lit with no stamp, put out by stampRndSeen");
});
