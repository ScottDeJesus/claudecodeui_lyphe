// protects: src/modules/settings/tabs/agents-settings/sections/content/RunnerCodeModeRow.tsx, src/modules/settings/tabs/agents-settings/sections/content/RunnerModelContent.tsx
// writes: none
//
// At a phone's width (390) the Code Mode card (code-mode--two-tools, interface H) fits: nothing of it reaches past the
// screen and the builders kind's sentence stands whole, not clipped. And the card adds no component (CloudCLI follows
// Astrolabe): every control it draws is the kit's, the Switch (`.vv-switch`, verve/controls.css) or the Button
// (`.vv-button`). The card's route is answered by the page (lib/code_mode_card.mjs); nothing is pressed.

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { openAgents } from "../lib/agents_settings.mjs";
import { answerCodeMode, codeModeCard, waitForCodeMode } from "../lib/code_mode_card.mjs";

const WIDTH = 390;
const KIT = /(^|\s)(vv-switch|vv-button)(\s|$)/;

runCase(async (t) => {
  const page = await withPage(t, { viewport: { width: WIDTH, height: 844 } });
  const wire = await answerCodeMode(page);
  await openAgents(page);
  if (!(await waitForCodeMode(page))) return broken(`Settings → Agents at ${WIDTH} wide draws no [data-runner-code-mode] handle`);
  await page.locator('.modal-backdrop [data-runner-code-mode]').first().scrollIntoViewIfNeeded();
  const card = await codeModeCard(page);
  if (!card.found || !card.afterDactyls) return broken(`at ${WIDTH} wide the card is not the row after the Dactyls row (${card.why ?? JSON.stringify(card.handles)})`);
  if (card.outside.length > 0) return broken(`at ${WIDTH} wide ${card.outside.length} part(s) of the card reach past the ${card.viewport} px screen: ${card.outside.join("; ")}`);
  const builders = card.kinds.find((k) => (k.handle ?? "").startsWith("builders:"));
  if (!builders) return broken(`no builders row in the card: ${JSON.stringify(card.handles)}`);
  if (!builders.says) return broken(`at ${WIDTH} wide the builders sentence is not drawn word for word: "${builders.text.slice(0, 120)}"`);
  if (!builders.says.whole) return broken(`at ${WIDTH} wide the builders sentence is clipped (${JSON.stringify(builders.says.rect)})`);
  const foreign = card.controls.filter((c) => !KIT.test(String(c.cls)));
  if (foreign.length > 0) return broken(`the card draws ${foreign.length} control(s) that are not the kit's Switch or Button: ${foreign.slice(0, 4).map((c) => `${c.tag}[role=${c.role}] "${c.name}"`).join("; ")}`);

  await page.waitForTimeout(500);
  const writes = wire.requests.filter((r) => r.method !== "GET");
  if (writes.length > 0) return broken(`drawing the card wrote ${JSON.stringify(writes)}`);
  return held(`at ${WIDTH} wide the card spans ${card.rect.x}..${card.rect.right}, the sentence whole, ${card.controls.length} control(s), all the kit's (${card.controls.map((c) => c.role || c.tag).join(", ")}); no write`);
});
