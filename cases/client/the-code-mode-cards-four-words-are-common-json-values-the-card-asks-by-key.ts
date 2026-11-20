// The Code Mode card's own words (code-mode--two-tools, interface H) are en/common.json's, never only a default in the
// component: its title, the waiting line, the readiness-unread line and the unreadable sentence. Each is found BY ITS
// WORDS, at whatever key the builder put it (a `<why>…</why>` wrap of the interpolation reads as `{{why}}`), and the card
// file must name one of the keys holding it, in the common namespace (`useTranslation('common')` or `ns: 'common'`).
// The kinds' own words (label, says, report) come from the verb and are not here.
//
// protects: src/modules/i18n/locales/en/common.json, src/modules/settings/tabs/agents-settings/sections/content/RunnerCodeModeRow.tsx
// writes: none

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LOCALE = path.join(REPO, "src/modules/i18n/locales/en/common.json");
const CARD = path.join(REPO, "src/modules/settings/tabs/agents-settings/sections/content/RunnerCodeModeRow.tsx");

// Interface H's words, verbatim.
const WORDS: Array<[string, string]> = [
  ["title", "Code Mode"],
  ["waiting", "Waiting: {{why}}. Agents work as before until it can."],
  ["readiness unread", "Whether this box can run Code Mode could not be read."],
  ["unreadable", "The switches could not be read from the server, so their positions are unknown. This is not the same as off. It is retried whenever this window regains focus."],
];

const norm = (s: string) => s.replace(/<(\/?)why>/g, "").replace(/\{\{\s*why\s*\}\}/g, "{{why}}").replace(/\s+/g, " ").trim();

function leaves(node: unknown, at: string[] = [], out: Array<[string, string]> = []): Array<[string, string]> {
  if (typeof node === "string") out.push([at.join("."), node]);
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) leaves(v, [...at, k], out);
  return out;
}

runCase(async () => {
  const all = leaves(JSON.parse(await readFile(LOCALE, "utf8")));
  let card: string;
  try {
    card = await readFile(CARD, "utf8");
  } catch {
    return broken("src/modules/settings/tabs/agents-settings/sections/content/RunnerCodeModeRow.tsx is not on disk");
  }
  if (!/useTranslation\(\s*['"]common['"]|ns:\s*['"]common['"]/.test(card)) return broken("the card asks no word of the common namespace");

  const wrong: string[] = [];
  const found: string[] = [];
  for (const [what, words] of WORDS) {
    const keys = all.filter(([, v]) => norm(v) === words).map(([k]) => k);
    if (keys.length === 0) { wrong.push(`common.json holds no value "${words}" (the ${what})`); continue; }
    const named = keys.find((k) => card.includes(`'${k}'`) || card.includes(`"${k}"`) || card.includes(`\`${k}\``));
    if (!named) wrong.push(`the ${what} is common.json's ${keys.join(" / ")}, and the card names none of them`);
    else found.push(`${what} ${named}`);
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`four words in common.json, each asked by the card: ${found.join(", ")}`);
});
