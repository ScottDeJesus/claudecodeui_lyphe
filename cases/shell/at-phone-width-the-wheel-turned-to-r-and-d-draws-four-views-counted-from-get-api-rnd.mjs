// protects: src/modules/rnd/RndPanel.tsx, src/modules/rnd/RndFeed.tsx, src/modules/rnd/hooks/useRnd.ts, src/modules/rnd/index.ts, src/modules/project-workspace/places/PlacesWheel.tsx, src/modules/project-workspace/context/PlacesContext.tsx, src/modules/project-workspace/WorkspaceMain.tsx, server/modules/rnd/rnd.routes.ts
// writes: none
// The place joined to the relay, at phone width: Menu opens the wheel, R&D is turned to and picked, and the panel draws
// Scout now and its four views counted from the standing GET /api/rnd answers (Verdicts is proved then adopted).
import { api, withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const shown = (locator) => locator.isVisible().catch(() => false);

async function until(check, ms) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) return null;
    await sleep(100);
  }
}

/** Pick one place of the wheel the Menu button opens: a press turns the wheel to it, a second picks it if the first did not. */
async function pickPlace(page, id, arrived) {
  const menu = page.getByRole("button", { name: "Menu", exact: true }).first();
  if (await shown(menu)) await menu.click();
  const place = page.locator("[data-place-name=\"" + id + "\"]").first();
  await place.waitFor({ state: "visible", timeout: 8000 }).catch(() => undefined);
  if (!(await shown(place))) return false;
  await place.click();
  if (await until(arrived, 5000)) return true;
  if (await shown(place)) await place.click();
  return Boolean(await until(arrived, 10000));
}

/** Every choice a segmented control draws, as its label and its text. */
const choices = (page) => page.evaluate(() => [...document.querySelectorAll("[role=radio], [role=tab], button[aria-pressed]")]
  .map((e) => ((e.getAttribute("aria-label") || "") + " " + (e.textContent || "")).replace(/\s+/g, " ").trim()));

runCase(async (t) => {
  const pic = await api("/api/rnd");
  if (pic.status !== 200 || !pic.json || !pic.json.standing) return broken("GET /api/rnd answered " + pic.status + ": " + String(pic.text || "").slice(0, 160));
  const s = pic.json.standing;
  const want = [["Waiting", s.waiting], ["Spiking", s.spiking], ["Verdicts", s.proved + s.adopted], ["Rejected", s.rejected]];
  const page = await withPage(t, { viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).split("\n")[0]));
  const scout = page.getByRole("button", { name: /Scout now/i }).first();
  if (!(await pickPlace(page, "rnd", () => shown(scout)))) {
    const places = await page.evaluate(() => [...new Set([...document.querySelectorAll("[data-place-name]")].map((e) => e.getAttribute("data-place-name")))]);
    if (places.indexOf("rnd") === -1) return broken("at 390 wide the wheel Menu opens offers no rnd place; it offers " + JSON.stringify(places));
    return broken("the wheel's R&D place was picked and no Scout now button was drawn");
  }
  const miss = [];
  const drawn = await until(async () => {
    const all = await choices(page);
    miss.length = 0;
    for (const pair of want) {
      const hit = all.find((x) => x.toLowerCase().indexOf(pair[0].toLowerCase()) !== -1);
      if (!hit || !new RegExp("(^|\\D)" + pair[1] + "(\\D|$)").test(hit)) miss.push(pair[0] + "=" + pair[1] + " (drawn: " + JSON.stringify(hit || null) + ")");
    }
    return miss.length === 0 ? all : null;
  }, 10000);
  if (!drawn) return broken("the views do not carry the standing's counts: " + miss.join("; "));
  await sleep(1000);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  if (wide > 391) return broken("the page is " + wide + " px wide on a 390 px screen");
  if (errors.length) return broken("the page threw: " + errors[0]);
  return held("at 390 wide the wheel's R&D place drew Scout now and the views " + want.map((p) => p[0] + " " + p[1]).join(", ") + "; page " + wide + " px wide");
});
