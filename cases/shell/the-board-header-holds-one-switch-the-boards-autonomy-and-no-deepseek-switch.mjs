// The board's header holds ONE switch, the board's autonomy, and nothing in it names DeepSeek: the per-board DeepSeek
// switch is gone (kanban-bug-dispatcher, the board's screens). The switch's label is not read here: a later card
// rewords it, and what this case keeps is that there is one switch and that it says the board's own setting.
//
// The board is lib/kanban_board.mjs's: one made-up board with autonomy on, every board request answered by the page
// itself. Read at 1440x900, then the same page at 390x844. Nothing reaches the board's server and nothing is written.
//
// protects: src/modules/kanban/KanbanBoardHeader.tsx, src/modules/kanban/KanbanPanel.tsx
// writes: none

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { headerOf, openBoard } from "../lib/kanban_board.mjs";

const WIDTHS = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];
const DEEPSEEK = /deep\s*seek/i;

runCase(async (t) => {
  const page = await withPage(t, { viewport: WIDTHS[0] });
  const { requests } = await openBoard(page);
  const seen = [];
  for (const viewport of WIDTHS) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(400);
    const header = headerOf(page);
    const switches = header.getByRole("switch");
    const count = await switches.count();
    if (count !== 1) {
      const names = await switches.evaluateAll((all) => all.map((s) => s.getAttribute("aria-label") || s.textContent.trim()));
      return broken(`at ${viewport.width} wide the board's header holds ${count} switches (${names.join(", ")}), not the one autonomy switch`);
    }
    const checked = await switches.first().getAttribute("aria-checked");
    if (checked !== "true") return broken(`at ${viewport.width} wide the header's one switch reads aria-checked=${checked} on a board whose autonomy is on`);
    const said = await header.evaluate((el) => [el.textContent, ...[...el.querySelectorAll("[aria-label],[title],img[alt]")]
      .map((n) => `${n.getAttribute("aria-label") ?? ""} ${n.getAttribute("title") ?? ""} ${n.getAttribute("alt") ?? ""}`)].join(" "));
    if (DEEPSEEK.test(said)) return broken(`at ${viewport.width} wide the board's header still names DeepSeek`);
    seen.push(viewport.width);
  }
  const writes = requests.filter((r) => r.method !== "GET");
  if (writes.length > 0) return broken(`reading the header wrote ${writes.map((w) => `${w.method} ${w.path}`).join(", ")}`);
  return held(`at ${seen.join(" and ")} wide the header holds one switch, on as the board's autonomy, and names no DeepSeek`);
});
