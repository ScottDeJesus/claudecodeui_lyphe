// protects: src/modules/settings/tabs/agents-settings/sections/content/RunnerBugHuntersRow.tsx, src/modules/i18n/locales/en/settings.json
// writes: none
//
// The Select "How the hunters take turns" (bug-hunters, seam 11) offers the dispatcher's three `turns` words as three
// choices, each said in a sentence: One project at a time (the first hunter finishes a project, then the next hunter
// takes it), One hunter at a time (a hunter finishes every project before the next starts), A different hunter each
// night. A sentence is said only if a reader can read it whole: the kit's Select truncates an option's hint, so at
// 390 wide a sentence put in a hint is checked for an ellipsis that cuts it.
//
// The list is opened and closed with Escape; nothing is picked, and every hunts write is refused by the page.

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { openAgents } from "../lib/agents_settings.mjs";
import { guardHunts, TURNS_LABEL, waitForNightly } from "../lib/bug_hunters_settings.mjs";

const CHOICES = ["One project at a time", "One hunter at a time", "A different hunter each night"];
const SENTENCES = [/finish\w*\s+(a|the|that)\s+project/i, /finish\w*\s+every\s+project/i];

async function openTurns(page) {
  const trigger = page.locator(`.vv-select__trigger[aria-label*="take turns" i]`).first();
  if ((await trigger.count()) > 0) return trigger;
  const row = page.getByText(TURNS_LABEL, { exact: true }).first()
    .locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " justify-between ")][1]');
  return row.locator(".vv-select__trigger").first();
}

/** Every element of the open list and of the Select's row whose own text matches `re`, with whether an ellipsis cuts it. */
async function said(page, trigger, re) {
  return trigger.evaluate((el, src) => {
    const re = new RegExp(src, "i");
    const row = el.closest('div[class~="justify-between"]') ?? el.parentElement;
    const list = document.querySelector('[role="listbox"]');
    const places = [row, list].filter(Boolean);
    const hits = [];
    for (const place of places) {
      for (const node of place.querySelectorAll("*")) {
        if (!re.test(node.textContent ?? "") || [...node.children].some((c) => re.test(c.textContent ?? ""))) continue;
        let cut = false;
        for (let n = node; n && n !== place.parentElement; n = n.parentElement) {
          const s = getComputedStyle(n);
          if (s.textOverflow === "ellipsis" && n.scrollWidth > n.clientWidth + 1) cut = true;
        }
        hits.push({ text: (node.textContent ?? "").trim().slice(0, 120), cut });
      }
    }
    return hits;
  }, re.source);
}

async function judgeAt(page, width) {
  const trigger = await openTurns(page);
  if ((await trigger.count()) === 0) return { why: `no Select named "${TURNS_LABEL}" is drawn` };
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click({ timeout: 10000 });
  const options = (await page.getByRole("listbox").last().getByRole("option").allTextContents()).map((s) => s.replace(/\s+/g, " ").trim());
  const labels = options.map((o) => CHOICES.find((c) => o.startsWith(c)) ?? o);
  if (JSON.stringify(labels) !== JSON.stringify(CHOICES)) {
    await page.keyboard.press("Escape");
    return { why: `at ${width} wide the turns list offers ${JSON.stringify(options)}, not ${JSON.stringify(CHOICES)}` };
  }
  for (const [n, re] of SENTENCES.entries()) {
    const hits = await said(page, trigger, re);
    if (hits.length === 0) { await page.keyboard.press("Escape"); return { why: `at ${width} wide "${CHOICES[n]}" is offered with no sentence saying ${re}` }; }
    if (hits.every((h) => h.cut)) { await page.keyboard.press("Escape"); return { why: `at ${width} wide the sentence of "${CHOICES[n]}" is cut by an ellipsis: "${hits[0].text}"` }; }
  }
  await page.keyboard.press("Escape");
  return { options };
}

runCase(async (t) => {
  const page = await withPage(t, { viewport: { width: 1440, height: 900 } });
  const guard = await guardHunts(page);
  await openAgents(page);
  if (!(await waitForNightly(page))) return broken("Settings → Agents draws no bug hunters rows (no switch \"Run the bug hunters nightly\")");
  const wide = await judgeAt(page, 1440);
  if (wide.why) return broken(wide.why);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const narrow = await judgeAt(page, 390);
  if (narrow.why) return broken(narrow.why);
  if (guard.writes.length > 0) return broken(`opening the turns list wrote ${JSON.stringify(guard.writes)}`);
  return held(`the turns list offers ${CHOICES.join(" / ")}, the first two with their sentences, whole at 1440 and at 390; no write`);
});
