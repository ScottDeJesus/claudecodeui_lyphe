// protects: src/modules/analytics, src/modules/i18n/locales/en/common.json
// writes: none
//
// Every word the Analytics area draws is a value under analytics. in en/common.json, asked by key through
// useTranslation('common') (analytics-code-mode, interface J). A key the module asks that the locale does not spell is
// drawn as its own path on the screen; a key outside analytics. is a word borrowed from another area's block, which
// moves when that area's words do.
//
// The module's files are read as text: every literal t('…') call and every titleKey: '…' is a key asked. A literal a + follows, as in
// t('analytics.x.columns.' + id), is the head of a family of keys built at run time: it ends at a dot and the locale
// spells a block of words there, every leaf a string.
// A key built in a template is not judged here. A plural asked with a count may be spelled as its _one and _other forms. The
// kinds' labels and the cause sentences come from the verb and are not keys.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MODULE = path.join(REPO, "src/modules/analytics");
const LOCALE = path.join(REPO, "src/modules/i18n/locales/en/common.json");
const MIN_KEYS = 5;

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(full)));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

runCase(async () => {
  let found: string[];
  try {
    found = await files(MODULE);
  } catch {
    return broken("src/modules/analytics is not on disk");
  }
  const en = JSON.parse(await readFile(LOCALE, "utf8"));
  const spelled = (key: string): unknown => key.split(".").reduce((node: any, part) => (node && typeof node === "object" ? node[part] : undefined), en);
  const wrong: string[] = [];
  const asked = new Map<string, string>();
  const heads = new Map<string, string>();
  for (const file of found) {
    const text = await readFile(file, "utf8");
    const rel = path.relative(MODULE, file);
    for (const m of text.matchAll(/\bt\(\s*(['"])([^'"\n]+)\1(\s*\+)?/g)) (m[3] ? heads : asked).set(m[2], rel);
    for (const m of text.matchAll(/\btitleKey:\s*(['"])([^'"\n]+)\1/g)) asked.set(m[2], rel);
    for (const m of text.matchAll(/\buseTranslation\(([^)]*)\)/g)) {
      if (!/^\s*['"]common['"]\s*$/.test(m[1])) wrong.push(rel + " asks useTranslation(" + m[1] + "), not 'common'");
    }
  }
  if (asked.size < MIN_KEYS) wrong.push("only " + asked.size + " literal keys found in " + found.length + " files: the area's words are not asked by key");
  for (const [key, rel] of asked) {
    if (!key.startsWith("analytics.")) { wrong.push(rel + " asks " + key + ", outside analytics."); continue; }
    const ok = typeof spelled(key) === "string" || (typeof spelled(key + "_one") === "string" && typeof spelled(key + "_other") === "string");
    if (!ok) wrong.push(rel + " asks " + key + ", which en/common.json does not spell");
  }
  const words = (node: unknown): boolean => typeof node === "string" || (node !== null && typeof node === "object" && Object.values(node).length > 0 && Object.values(node).every(words));
  for (const [head, rel] of heads) {
    if (!head.startsWith("analytics.")) { wrong.push(rel + " builds keys on " + head + ", outside analytics."); continue; }
    const block = head.endsWith(".") ? spelled(head.slice(0, -1)) : undefined;
    if (block === null || typeof block !== "object" || !words(block)) wrong.push(rel + " builds keys on " + head + ", where en/common.json spells no block of words");
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(asked.size + " keys and " + heads.size + " families of run-time keys asked across " + found.length + " files, each spelled under analytics. in en/common.json");
});
