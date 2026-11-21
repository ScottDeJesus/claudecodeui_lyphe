// CodeModeCauses draws the window's failures as families, ranked as the verb ranked them, each a row that opens
// (the kit's Collapsible) to its commonest sentences, the journals' own words drawn as they came; the head says how
// many failures there were in all; a family names its kinds by the labels the answer carries, never a locale's
// (analytics-code-mode, interfaces I and J).
//
// The part is rendered to static markup under the en words, handed 7 failures and two families, then none.
//
// protects: src/modules/analytics/sections/code-mode/CodeModeCauses.tsx, src/modules/analytics/sections/code-mode/codeModeFigures.ts, src/shared/ui/Collapsible.tsx
// writes: none

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PART = "../../src/modules/analytics/sections/code-mode/CodeModeCauses.tsx";

function numberKeys(name: string): string[] {
  const src = fs.readFileSync(path.join(REPO, "src/shared/analytics-types.ts"), "utf8");
  const m = new RegExp("(?:type|interface)\\s+" + name + "\\b[^{]*\\{([\\s\\S]*?)\\n\\}").exec(src);
  return m ? [...m[1].matchAll(/^\s*(\w+)\??\s*:\s*number\b/gm)].map((x) => x[1]) : [];
}

async function english() {
  const i18next: any = (await import("i18next")).default;
  const { initReactI18next }: any = await import("react-i18next");
  const en = JSON.parse(fs.readFileSync(path.join(REPO, "src/modules/i18n/locales/en/common.json"), "utf8"));
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({ lng: "en", fallbackLng: "en", ns: ["common"], defaultNS: "common", resources: { en: { common: en } }, interpolation: { escapeValue: false }, react: { useSuspense: false } });
  const at = (key: string) => key.split(".").reduce((n: any, p: string) => (n && typeof n === "object" ? n[p] : undefined), en);
  return { t: i18n.t.bind(i18n), has: (key: string) => typeof at(key) === "string" || typeof at(key + "_other") === "string" };
}

const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const textOf = (html: string) => unescape(html.replace(/<!--.*?-->/g, "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

async function render(part: any, props: unknown): Promise<string> {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  return renderToStaticMarkup(createElement(part, props as never));
}

const FIRST = ["Zebra sentence one, as the journal said it: the edit's old text was not in the file", "Zebra sentence two"];

runCase(async () => {
  const words = await english();
  const totals = (total: number) => ({ ...Object.fromEntries(numberKeys("CodeModeFaultTotals").map((k) => [k, 0])), total });
  const causes = [
    { fault: "zebra-fault", helper: "zebra-helper", hook: "zebra_hook", count: 5, threw: 2, launches: 3, kinds: ["zk"], top: [{ cause: FIRST[0], count: 3 }, { cause: FIRST[1], count: 1 }] },
    { fault: "quokka-fault", helper: "", hook: "", count: 2, threw: 0, launches: 1, kinds: ["zk"], top: [{ cause: "Quokka sentence", count: 2 }] },
  ];
  const kinds = [{ kind: "zk", label: "Zebra kind" }];
  const mod: any = await import(PART);
  if (typeof mod.CodeModeCauses !== "function") return broken("CodeModeCauses.tsx exports no CodeModeCauses");
  const html = await render(mod.CodeModeCauses, { causes, faults: totals(7), kinds });
  const text = textOf(html);

  const wrong: string[] = [];
  for (const sentence of FIRST) if (!text.includes(sentence)) wrong.push("the first family does not show its sentence \"" + sentence.slice(0, 40) + "\"");
  const a = text.indexOf("zebra-fault");
  const b = text.indexOf("quokka-fault");
  if (a < 0 || b < 0 || a > b) wrong.push("the families are not drawn in the order handed (zebra-fault at " + a + ", quokka-fault at " + b + ")");
  if (!text.includes("Zebra kind")) wrong.push("the family does not name its kind by the data's label \"Zebra kind\"");
  const expanded = [...html.matchAll(/aria-expanded="(true|false)"/g)].map((m) => m[1]);
  if (expanded[0] !== "true" || expanded[1] !== "false") wrong.push("the rows' open states read " + (expanded.join("/") || "none") + ", not the first open and the second closed");
  const head = words.has("analytics.codeMode.causes.head") ? words.t("analytics.codeMode.causes.head", { count: 7 }) : null;
  if (head ? !text.includes(head) : !/\b7\b/.test(text)) wrong.push("the head does not say the 7 failures in all" + (head ? " (\"" + head + "\")" : ""));

  const quiet = await render(mod.CodeModeCauses, { causes: [], faults: totals(0), kinds });
  if (/aria-expanded=/.test(quiet) || textOf(quiet) === "") wrong.push("with no failure it draws family rows, or nothing at all: \"" + textOf(quiet).slice(0, 80) + "\"");

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("head \"" + (head ?? "7") + "\"; zebra-fault open on its 2 sentences verbatim, quokka-fault closed; kind named Zebra kind; none reads \"" + textOf(quiet).slice(0, 60) + "\"");
});
