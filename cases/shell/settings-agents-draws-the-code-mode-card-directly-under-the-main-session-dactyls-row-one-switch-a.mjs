// protects: src/modules/settings/tabs/agents-settings/sections/content/RunnerCodeModeRow.tsx, src/modules/settings/tabs/agents-settings/sections/content/RunnerModelContent.tsx, src/modules/i18n/locales/en/common.json
// writes: none
//
// Settings → Agents draws the Code Mode card (code-mode--two-tools, interface H) directly under the main-session
// Dactyls row: titled "Code Mode", one row a kind of the status's `kinds` with `data-runner-code-mode="<kind>:on|off"`,
// the kind's label, its `says` sentence word for word, and one switch standing where the handle says. The card's route
// is answered by the page (lib/code_mode_card.mjs) with one `builders` kind, ready and off, so the case reads the same
// card whether the card draws a fixed reading or asks the server. Nothing is pressed, and a write is a BROKEN.

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { openAgents } from "../lib/agents_settings.mjs";
import { answerCodeMode, codeModeCard, SAYS, waitForCodeMode } from "../lib/code_mode_card.mjs";

runCase(async (t) => {
  const page = await withPage(t, { viewport: { width: 1440, height: 900 } });
  const wire = await answerCodeMode(page);
  await openAgents(page);
  if (!(await waitForCodeMode(page))) return broken("Settings → Agents draws no [data-runner-code-mode] handle");
  const card = await codeModeCard(page);
  if (!card.found) return broken(`the card cannot be placed: ${card.why}`);
  if (!card.afterDactyls) return broken(`the [data-runner-code-mode] handles (${JSON.stringify(card.handles)}) are not inside the row directly after the main-session Dactyls row`);
  if (!/^Code Mode(\s|$)/.test(card.text)) return broken(`the card after the Dactyls row does not open with its title "Code Mode": "${card.text.slice(0, 80)}"`);
  if (card.kinds.length !== 1) return broken(`one builders kind answered, ${card.kinds.length} kind rows drawn: ${JSON.stringify(card.handles)}`);

  const [kind] = card.kinds;
  const m = /^builders:(on|off)$/.exec(kind.handle ?? "");
  if (!m) return broken(`the builders row's handle is "${kind.handle}", not builders:on|off for a kind with a position`);
  if (!kind.text.includes("Builders")) return broken(`the builders row does not say its label "Builders": "${kind.text.slice(0, 80)}"`);
  if (!kind.says) return broken(`the builders row holds no element saying the kind's sentence word for word; it reads "${kind.text.slice(0, 160)}"`);
  if (kind.switches.length !== 1) return broken(`the builders row draws ${kind.switches.length} switches, not one`);
  const checked = kind.switches[0].checked === "true" ? "on" : "off";
  if (checked !== m[1]) return broken(`the handle says ${m[1]} and the switch is drawn ${checked} (aria-checked ${kind.switches[0].checked})`);
  if (!SAYS.endsWith("Takes effect on the next launch.")) return broken("the case's own sentence is not interface H's");

  await page.waitForTimeout(800);
  const writes = wire.requests.filter((r) => r.method !== "GET");
  if (writes.length > 0) return broken(`drawing the card wrote ${JSON.stringify(writes)}`);
  return held(`"Code Mode" directly after the Dactyls row; ${kind.handle}, "Builders", the sentence whole, switch "${kind.switches[0].name}" ${checked}; ${wire.requests.length} reads of the route, no write`);
});
