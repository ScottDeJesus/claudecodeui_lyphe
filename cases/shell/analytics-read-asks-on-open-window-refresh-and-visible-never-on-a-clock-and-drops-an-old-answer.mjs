// protects: src/modules/analytics/hooks/useAnalyticsSection.ts, src/shared/api.ts
// writes: none
//
// The Analytics read is told, it never asks on a clock (analytics-code-mode, interface G; useBugDashboard's pattern).
// useAnalyticsSection reads on mount, on a change of days, on refresh and when the page becomes visible again, and at
// no other moment; a newer answer replaces the drawn one whole, and an answer to a question no longer asked is never
// drawn.
//
// The real hook is imported into the running app's page through its Vite server and mounted under the page's own React
// (the copy the hook's transformed source imports), in a host of the case's own beside the app. Its route,
// GET /api/analytics/code-mode, is answered here: every read is counted and answered with a mark naming the days it
// asked and its turn, so the drawn reading says which answer it is. The page going away and coming back is stood in for
// by document.visibilityState and its event, as a tab that returns sets them.

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { withPage } from "../lib/app.mjs";

const HOOK = "/src/modules/analytics/hooks/useAnalyticsSection.ts";
const ENTRY = "/src/main.tsx";
const ROUTE = /\/api\/analytics\/code-mode(\?|$)/;
const QUIET_MS = 32000;
const HELD_MS = 3000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, ms) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) return null;
    await sleep(100);
  }
}

runCase(async (t) => {
  const page = await withPage(t);
  const asked = [];
  const holds = new Map();
  await page.route(ROUTE, async (route) => {
    const days = Number(new URL(route.request().url()).searchParams.get("days"));
    const turn = asked.push(days);
    const hold = holds.get(days) ?? 0;
    if (hold > 0) await sleep(hold);
    const body = JSON.stringify({ section: "code-mode", days: days, data: { mark: "d" + days + "-n" + turn } });
    await route.fulfill({ status: 200, contentType: "application/json", body: body }).catch(() => undefined);
  });

  const mounted = await page.evaluate(async ({ hookAt, entryAt }) => {
    const specifier = async (at, pattern) => {
      const text = await (await fetch(at)).text();
      const found = text.match(pattern);
      return { text: text, at: found ? found[1] : null };
    };
    const hook = await specifier(hookAt, /["'](\/node_modules\/\.vite\/deps\/react\.js\?v=[^"']+)["']/);
    const entry = await specifier(entryAt, /["'](\/node_modules\/\.vite\/deps\/react-dom_client\.js\?v=[^"']+)["']/);
    if (!hook.at || !entry.at) return { cannot: "the page's React was not found (react in the hook: " + hook.at + ", react-dom/client in main.tsx: " + entry.at + ")" };
    let module;
    try {
      module = await import(hookAt);
    } catch (error) {
      return { error: "the hook would not load: " + String(error && error.message).split("\n")[0] };
    }
    const use = module.useAnalyticsSection;
    if (typeof use !== "function") return { error: "useAnalyticsSection.ts exports no useAnalyticsSection (it exports " + (Object.keys(module).join(", ") || "nothing") + ")" };
    const reactModule = await import(hook.at);
    const React = reactModule.default ?? reactModule;
    const domModule = await import(entry.at);
    const createRoot = domModule.createRoot ?? (domModule.default && domModule.default.createRoot);
    if (typeof createRoot !== "function") return { cannot: "react-dom/client gave no createRoot" };
    let visibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => visibility === "hidden" });
    const narrow = (data) => {
      const found = JSON.stringify(data ?? null).match(/"mark":"([^"]+)"/);
      return found ? { mark: found[1] } : null;
    };
    const probe = { reading: null, refresh: null, setDays: null, seen: [] };
    probe.visibility = (state) => {
      visibility = state;
      document.dispatchEvent(new Event("visibilitychange"));
    };
    window.__athenaAnalytics = probe;
    function Probe() {
      const [days, setDays] = React.useState(30);
      const answer = use("code-mode", days, narrow);
      probe.reading = answer.reading;
      probe.refresh = answer.refresh;
      probe.setDays = setDays;
      if (answer.reading && answer.reading.status === "ready") probe.seen.push(answer.reading.data && answer.reading.data.mark);
      return null;
    }
    const host = document.createElement("div");
    host.setAttribute("data-athena-analytics-probe", "");
    document.body.appendChild(host);
    createRoot(host).render(React.createElement(Probe));
    return { ok: true, interval: /\bsetInterval\s*\(/.test(hook.text) };
  }, { hookAt: HOOK, entryAt: ENTRY });
  if (mounted.cannot) return cannotRun(mounted.cannot);
  if (mounted.error) return broken(mounted.error);

  const reading = () => page.evaluate(() => {
    const r = window.__athenaAnalytics.reading;
    return r ? { status: r.status, stale: r.stale === true, mark: r.data ? r.data.mark : null } : null;
  });
  const settled = () => until(async () => {
    const r = await reading();
    return r && r.status === "ready" && !r.stale ? r : null;
  }, 8000);
  const once = async (what, from) => {
    if (!(await until(async () => asked.length > from, 5000))) return what + " asked nothing";
    await sleep(1200);
    return asked.length - from === 1 ? null : what + " asked " + (asked.length - from) + " times, not once";
  };
  const wrong = [];
  const said = [];

  const first = await settled();
  if (!first) return broken("no answer was drawn within 8 s of mounting (reading " + JSON.stringify(await reading()) + ", reads " + JSON.stringify(asked) + ")");
  if (asked.length !== 1 || asked[0] !== 30) wrong.push("mounting on 30 days asked " + JSON.stringify(asked) + ", not one read of 30");
  if (mounted.interval) wrong.push("the hook's source calls setInterval");
  said.push("mount " + JSON.stringify(asked) + " drew " + first.mark);

  const quietFrom = asked.length;
  await sleep(QUIET_MS);
  if (asked.length !== quietFrom) wrong.push("with nothing done for " + QUIET_MS / 1000 + " s it read " + (asked.length - quietFrom) + " more time(s): a clock");
  said.push("quiet " + QUIET_MS / 1000 + " s: " + (asked.length - quietFrom) + " reads");

  await page.evaluate(() => window.__athenaAnalytics.visibility("hidden"));
  await sleep(800);
  const hiddenAt = asked.length;
  await page.evaluate(() => window.__athenaAnalytics.visibility("visible"));
  const back = await once("the page becoming visible again", hiddenAt);
  if (back) wrong.push(back);
  await settled();
  said.push("return: " + (asked.length - hiddenAt) + " read(s)");

  const refreshFrom = asked.length;
  await page.evaluate(() => window.__athenaAnalytics.refresh());
  const pressed = await once("Refresh", refreshFrom);
  if (pressed) wrong.push(pressed);
  await settled();
  said.push("refresh: " + (asked.length - refreshFrom) + " read(s)");

  holds.set(30, HELD_MS);
  const lateFrom = asked.length;
  await page.evaluate(() => window.__athenaAnalytics.refresh());
  await until(async () => asked.length > lateFrom, 3000);
  const lateMark = "d30-n" + asked.length;
  await page.evaluate(() => window.__athenaAnalytics.setDays(7));
  const seven = await until(async () => {
    const r = await reading();
    return r && r.status === "ready" && typeof r.mark === "string" && r.mark.indexOf("d7-") === 0 ? r : null;
  }, 5000);
  if (!seven) wrong.push("a change to 7 days drew no 7-day answer (reads since: " + JSON.stringify(asked.slice(lateFrom)) + ", reading " + JSON.stringify(await reading()) + ")");
  const seenFrom = await page.evaluate(() => window.__athenaAnalytics.seen.length);
  await sleep(HELD_MS + 1500);
  const after = await page.evaluate((from) => window.__athenaAnalytics.seen.slice(from), seenFrom);
  const last = await reading();
  if (after.includes(lateMark) || (last && last.mark === lateMark)) wrong.push("the 30-day answer that came back after the window moved to 7 was drawn (" + lateMark + ")");
  if (!asked.slice(lateFrom).includes(7)) wrong.push("moving the window to 7 days asked no 7-day read");
  said.push("window 30->7 while " + lateMark + " was held: drew " + (last && last.mark));

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(said.join("; "));
});
