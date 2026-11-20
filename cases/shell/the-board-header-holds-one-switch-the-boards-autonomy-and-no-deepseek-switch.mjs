// The board holds ONE switch, its autonomy, and nothing of it names DeepSeek: the per-board DeepSeek switch is gone
// (kanban-bug-dispatcher, the board's screens). Since the board's redraw to the design system (2026-11-20) the switch stands in
// what the board's core opens, the board itself, and the view's head holds none: the head is the way back, the board's name and
// the menu. The switch's label is not read here: a later card rewords it, and what this case keeps is that there is one switch
// and that it says the board's own setting.
//
// The board is lib/kanban_board.mjs's: one made-up board with autonomy on, every board request answered by the page
// itself. Read at 1440x900, then the same page at 390x844. Nothing reaches the board's server and nothing is written.
//
// protects: src/modules/kanban/BugBoardOpening.tsx, src/modules/kanban/BugHead.tsx, src/modules/kanban/KanbanPanel.tsx
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { headerOf, openBoard, openBoardItself } from "../lib/kanban_board.mjs";

const WIDTHS = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];
const DEEPSEEK = /deep\s*seek/i;

/** Everything a region says, its words and its elements' names. */
const sayings = (region) => region.evaluate((el) => [el.textContent, ...[...el.querySelectorAll("[aria-label],[title],img[alt]")]
  .map((n) => `${n.getAttribute("aria-label") ?? ""} ${n.getAttribute("title") ?? ""} ${n.getAttribute("alt") ?? ""}`)].join(" "));

runCase(async (t) => {
  const page = await withPage(t, { viewport: WIDTHS[0] });
  const { requests } = await openBoard(page);
  const seen = [];
  for (const viewport of WIDTHS) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(400);
    const head = headerOf(page);
    const headSwitches = await head.getByRole("switch").count();
    if (headSwitches !== 0) return broken(`at ${viewport.width} wide the view's head holds ${headSwitches} switch(es): the board's switch belongs to what its core opens`);
    if (DEEPSEEK.test(await sayings(head))) return broken(`at ${viewport.width} wide the view's head names DeepSeek`);
    const opening = await openBoardItself(page);
    const switches = opening.getByRole("switch");
    const count = await switches.count();
    if (count !== 1) {
      const names = await switches.evaluateAll((all) => all.map((s) => s.getAttribute("aria-label") || s.textContent.trim()));
      return broken(`at ${viewport.width} wide the board's Opening holds ${count} switches (${names.join(", ")}), not the one autonomy switch`);
    }
    const checked = await switches.first().getAttribute("aria-checked");
    if (checked !== "true") return broken(`at ${viewport.width} wide the board's one switch reads aria-checked=${checked} on a board whose autonomy is on`);
    if (DEEPSEEK.test(await sayings(opening))) return broken(`at ${viewport.width} wide the board's Opening still names DeepSeek`);
    await page.keyboard.press("Escape");
    await opening.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
    seen.push(viewport.width);
  }
  const writes = requests.filter((r) => r.method !== "GET");
  if (writes.length > 0) return broken(`reading the board wrote ${writes.map((w) => `${w.method} ${w.path}`).join(", ")}`);
  return held(`at ${seen.join(" and ")} wide the board's Opening holds one switch, on as the board's autonomy, the head holds none, and nothing names DeepSeek`);
});
