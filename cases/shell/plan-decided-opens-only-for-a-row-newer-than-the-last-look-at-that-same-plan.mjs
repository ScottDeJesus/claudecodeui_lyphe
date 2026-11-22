// protects: src/modules/dispatcher/PlanDecided.tsx
// writes: none
//
// walks-decide-themselves, phase 6 (the fill): the "Decided for you" fold opens only when a row is newer than the
// operator's last look at THAT plan's list, and the look is kept in localStorage per plan. In the dev client (its own
// React, i18n and kit, live source), a plan with decided rows never looked at opens its fold; folding it is the look,
// so the same plan mounted again opens closed; another plan with the same rows still opens; and a row newer than the
// look opens the first plan's fold again with that row marked "new". The look lands in localStorage under a key or a
// value naming the plan.
//
// The piece is imported from the dev client by its source path and mounted with the React the client already loaded
// (read off the piece's own transformed imports) in a fixed host over the signed-in app, at phone width. The page is
// the case's own fresh browser, so its localStorage is thrown away with it; the case still removes what it wrote.

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { withPage } from "../lib/app.mjs";

runCase(async (t) => {
  const page = await withPage(t, { viewport: { width: 390, height: 844 } });
  const stamp = Date.now();
  const A = "athena-case-look-a-" + stamp;
  const B = "athena-case-look-b-" + stamp;
  const seen = await page.evaluate(async ({ A, B }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const PIECE = "/src/modules/dispatcher/PlanDecided.tsx";
    const source = await (await fetch(PIECE)).text();
    const reactUrl = (source.match(/["'](\/node_modules\/\.vite\/deps\/react\.js[^"']*)["']/) ?? [])[1];
    if (!reactUrl) return { cannot: "the dev client's PlanDecided.tsx names no optimized react dep" };
    const main = await (await fetch("/src/main.tsx")).text().catch(() => "");
    const clientUrl = (main.match(/["'](\/node_modules\/\.vite\/deps\/react-dom_client\.js[^"']*)["']/) ?? [])[1] ?? reactUrl.replace("/react.js", "/react-dom_client.js");
    const reactMod = await import(reactUrl);
    const React = reactMod.default ?? reactMod;
    const client = await import(clientUrl);
    const createRoot = client.createRoot ?? client.default?.createRoot;
    let wrap = (el) => el;
    const routerUrl = (source.match(/["'](\/node_modules\/\.vite\/deps\/react-router-dom\.js[^"']*)["']/) ?? [])[1];
    if (routerUrl) { const rr = await import(routerUrl); const MR = rr.MemoryRouter ?? rr.default?.MemoryRouter; if (MR) wrap = (el) => React.createElement(MR, null, el); }
    let mod;
    try { mod = await import(PIECE); } catch (error) { return { error: "PlanDecided.tsx would not load in the dev client: " + String(error?.message ?? error).split("\n")[0] }; }
    const Piece = mod.PlanDecided ?? mod.default;
    if (!Piece) return { error: "PlanDecided.tsx exports no PlanDecided" };
    const clean = () => { for (const k of Object.keys(localStorage)) if (k.includes(A) || k.includes(B)) localStorage.removeItem(k); };
    clean();
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:var(--canvas,#fff);overflow:auto";
    document.body.append(host);
    let root = null;
    const errors = [];
    const mount = async (plan) => {
      if (root) root.unmount();
      root = createRoot(host);
      try { root.render(wrap(React.createElement(Piece, { plan }))); } catch (error) { errors.push(String(error?.message ?? error)); }
      await sleep(500);
    };
    const drawn = () => host.querySelectorAll("[data-decided-row]").length;
    const iso = (ms) => new Date(ms).toISOString();
    const now = Date.now();
    const rows = [
      { id: 1, at: iso(now - 3600e3), task: "Wire the reader", by: "builder", what: "athena-what-1", choice: "athena-choice-1", why: "athena-why-1", undo: "athena-undo-1" },
      { id: 2, at: iso(now - 1800e3), task: null, by: "rule", what: "athena-what-2", choice: "athena-choice-2", why: "athena-why-2", undo: "athena-undo-2" },
    ];
    const base = { status: "running", phases: [], events: [], open_gaps: [] };
    const snapshot = () => JSON.stringify(Object.entries(localStorage).filter(([k, v]) => k.includes(A) || String(v).includes(A)));
    const out = {};
    await mount({ ...base, name: A, decided: rows });
    out.firstOpen = drawn();
    const before = snapshot();
    const trigger = host.querySelector("[data-plan-decided] [data-decided-fold] button") ?? host.querySelector("[data-plan-decided] button");
    out.trigger = Boolean(trigger);
    if (trigger) { trigger.click(); await sleep(500); }
    out.afterFold = drawn();
    out.lookKept = snapshot() !== before && snapshot() !== "[]";
    await mount({ ...base, name: A, decided: rows });
    out.samePlanAgain = drawn();
    await mount({ ...base, name: B, decided: rows });
    out.otherPlan = drawn();
    const newer = { id: 3, at: iso(Date.now() + 60e3), task: "Fill the decided list", by: "designer", what: "athena-what-3", choice: "athena-choice-3", why: "athena-why-3", undo: "athena-undo-3" };
    await mount({ ...base, name: A, decided: [...rows, newer] });
    out.afterNewer = drawn();
    const third = host.querySelector('[data-decided-row="3"]');
    // The badge is found as an element of the row whose own whole text is the word: the row's textContent runs its words together.
    out.newerMarked = Boolean(third && [...third.querySelectorAll("*")].some((el) => el.children.length === 0 && /^new$/i.test((el.textContent ?? "").trim())));
    out.errors = errors;
    root.unmount();
    host.remove();
    clean();
    return out;
  }, { A, B });
  if (seen.cannot) return cannotRun(seen.cannot);
  if (seen.error) return broken(seen.error);
  const wrong = [];
  if (seen.firstOpen === 0) return broken("a plan with two decided rows never looked at opened no rows (drew " + seen.firstOpen + "): rows are not read, or the fold starts closed");
  if (!seen.trigger) return broken("the fold has no trigger button to fold it with");
  if (seen.afterFold !== 0) wrong.push("folding the trigger left " + seen.afterFold + " rows drawn");
  if (!seen.lookKept) wrong.push("folding the list wrote no look to localStorage naming the plan");
  if (seen.samePlanAgain !== 0) wrong.push("the same plan mounted again after the look opened " + seen.samePlanAgain + " rows, not closed");
  if (seen.otherPlan === 0) wrong.push("another plan with the same rows opened closed: the look is not per plan");
  if (seen.afterNewer === 0) wrong.push("a row newer than the look did not open the fold again");
  if (!seen.newerMarked) wrong.push('the newer row is not marked "new"');
  if (seen.errors.length) wrong.push("render errors: " + seen.errors[0].slice(0, 80));
  if (wrong.length > 0) return broken(wrong.join("; ") + " — saw " + JSON.stringify(seen).slice(0, 200));
  return held("open on first sight (" + seen.firstOpen + " rows), closed after the fold and on remount, open for another plan, open again with the newer row marked new");
});
