// protects: src/modules/analytics/AnalyticsSectionFrame.tsx, src/modules/analytics/types.ts, src/modules/i18n/locales/en/common.json
// writes: none
//
// AnalyticsSectionFrame is what every Analytics section stands in: one read, four states (analytics-code-mode, interface
// G). STILL READING draws the kit's ring and no section; THE ROUTE DID NOT ANSWER draws one sentence and Try again and
// no section; AN ANSWER draws the section, the line saying when its numbers were taken and Refresh, and the section says
// busy to assistive tech only WHILE A NEWER ANSWER IS OUT (stale). The render function is called only with an answer.
//
// The frame is imported in node, its stylesheets answered empty and window stood in by globalThis, and rendered to static
// markup with React's server renderer over en/common.json through i18next. "Busy" is aria-busy="true" on an element that
// ENCLOSES the section, found by walking the markup's open tags; the kit's Button saying busy is not the section. The
// props are the seam's (reading, refresh, takenAt, children); a rename is a change to how this case finds the piece.

import { readFile } from "node:fs/promises";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FRAME = path.join(REPO, "src/modules/analytics/AnalyticsSectionFrame.tsx");
const LOCALE = path.join(REPO, "src/modules/i18n/locales/en/common.json");
const MARK = "athena-section-mark";
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

const textOf = (html: string): string =>
  html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;|&gt;/g, " ").replace(/\s+/g, " ").trim();
const firstLine = (error: unknown): string => String((error as Error)?.message ?? error).split("\n")[0];
const buttons = (html: string): string[] => [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((m) => textOf(m[1]));

/** The opening tags of the elements open around the section's mark, outermost first; null when the mark is not drawn. */
function enclosing(html: string): string[] | null {
  const at = html.indexOf("<div data-athena-mark");
  if (at === -1) return null;
  const stack: { name: string; whole: string }[] = [];
  const tag = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(html)) && m.index < at) {
    const name = m[2].toLowerCase();
    if (m[1]) {
      const i = stack.map((s) => s.name).lastIndexOf(name);
      if (i !== -1) stack.length = i;
    } else if (!m[4] && !VOID.has(name)) stack.push({ name, whole: m[0] });
  }
  return stack.map((s) => s.whole);
}

runCase(async () => {
  register(
    "data:text/javascript," +
      encodeURIComponent("export async function load(url, context, next) { if (/\\.(css|svg|png)(\\?|$)/.test(url)) return { format: 'module', source: 'export default {}', shortCircuit: true }; return next(url, context); }"),
  );
  (globalThis as any).window ??= globalThis;
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const i18n = (await import("i18next")).default;
  const { initReactI18next } = await import("react-i18next");
  const en = JSON.parse(await readFile(LOCALE, "utf8"));
  await i18n.use(initReactI18next).init({ lng: "en", fallbackLng: "en", defaultNS: "common", ns: ["common"], resources: { en: { common: en } }, interpolation: { escapeValue: false }, react: { useSuspense: false } });
  let mod: any;
  try {
    mod = await import(pathToFileURL(FRAME).href);
  } catch (error) {
    return broken("the frame would not load: " + firstLine(error));
  }
  const Frame = mod.AnalyticsSectionFrame;
  if (typeof Frame !== "function") return broken("AnalyticsSectionFrame.tsx exports no AnalyticsSectionFrame");

  const now = Math.floor(Date.now() / 1000);
  let calls = 0;
  const draw = (reading: unknown): string => {
    calls = 0;
    return renderToStaticMarkup(createElement(Frame, {
      reading,
      refresh: () => undefined,
      takenAt: () => now,
      children: (data: any) => { calls += 1; return createElement("div", { "data-athena-mark": "" }, MARK + " " + data.n); },
    } as never));
  };
  const wrong: string[] = [];

  const loading = draw({ status: "loading" });
  if (loading.includes(MARK) || calls > 0) wrong.push("while reading, the section is drawn or its render function called");
  if (!/role="status"/.test(loading)) wrong.push("while reading, no status region (the kit's ring) is drawn");
  if (buttons(loading).length > 0) wrong.push("while reading, a button is drawn: " + JSON.stringify(buttons(loading)));

  const down = draw({ status: "unreachable" });
  const downCalls = calls;
  if (down.includes(MARK) || downCalls > 0) wrong.push("when the route did not answer, the section is drawn or its render function called");
  if (!buttons(down).some((b) => /try again/i.test(b))) wrong.push("when the route did not answer, no Try again button: " + JSON.stringify(buttons(down)));
  const sentence = textOf(down.replace(/<button\b[\s\S]*?<\/button>/g, " "));
  if (sentence.length < 8) wrong.push('when the route did not answer, no sentence beside Try again ("' + sentence + '")');

  const said: string[] = [];
  for (const stale of [false, true]) {
    const what = stale ? "with a newer answer out" : "with an answer";
    const html = draw({ status: "ready", data: { n: 7 }, stale });
    const around = enclosing(html);
    if (!around || !html.includes(MARK + " 7") || calls === 0) { wrong.push(what + ", the section is not drawn"); continue; }
    const busy = around.some((t) => /\saria-busy="true"/.test(t));
    if (busy !== stale) wrong.push(what + ", the elements enclosing the section " + (busy ? "say" : "do not say") + ' aria-busy="true"');
    if (!buttons(html).some((b) => /refresh/i.test(b))) wrong.push(what + ", no Refresh button: " + JSON.stringify(buttons(html)));
    const text = textOf(html);
    if (!/\d{1,2}[:.]\d{2}/.test(text)) wrong.push(what + ', no line says the time the numbers were taken: "' + text + '"');
    said.push(what + ' "' + text.slice(0, 90) + '" busy=' + busy);
  }

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held('reading "' + textOf(loading) + '"; unreachable "' + sentence + '" + Try again; ' + said.join("; "));
});
