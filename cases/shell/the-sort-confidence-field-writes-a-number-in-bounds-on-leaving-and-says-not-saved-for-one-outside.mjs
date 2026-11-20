// protects: src/modules/settings/hooks/useBugBoardSettings.ts, src/modules/settings/tabs/agents-settings/sections/content/RunnerBugBoardRow.tsx, src/shared/api.ts
// writes: none
//
// The Sort confidence field writes only a number inside 0.50-0.99, and only when it is left (Enter leaves it). A number
// outside the band (80, the percent a hand types by habit) is not sent: the field puts the saved number back and SAYS
// "Not saved: use 0.50 to 0.99." until it is typed in again. A number inside is sent alone, `{ threshold }`, and the
// field then reads the number read back at two decimals.
//
// The dispatcher is the page's (lib/agents_settings.mjs): it reads width 1 and threshold 0.80 and reads a write back
// as sent. Nothing reaches the dispatcher.

import { withPage } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { answerCardConfig, openAgents, THRESHOLD_FIELD, THRESHOLD_ROW, until } from "../lib/agents_settings.mjs";

const NOT_SAVED = /Not saved: use 0\.50 to 0\.99\./;

runCase(async (t) => {
  const page = await withPage(t);
  const { requests } = await answerCardConfig(page, {
    get: () => ({ status: 200, body: { width: 1, threshold: 0.8 } }),
    put: (body) => ({ status: 200, body: { width: 1, threshold: body?.threshold ?? 0.8 } }),
  });
  await openAgents(page);
  const field = page.locator(THRESHOLD_FIELD).first();
  const row = page.locator(THRESHOLD_ROW).first();
  const writes = () => requests.filter((r) => r.method !== "GET");
  const rowWords = async () => (await row.textContent()) ?? "";
  if (!(await until(async () => (await field.count()) > 0 && (await field.inputValue()) === "0.80"))) {
    return broken(`the confidence field did not come to read 0.80 where the dispatcher answered 0.8 (it reads "${(await field.count()) ? await field.inputValue() : "nothing"}")`);
  }

  await field.fill("80");
  await field.press("Enter");
  await page.waitForTimeout(1200);
  if (writes().length > 0) return broken(`80 typed and Enter pressed sent ${JSON.stringify(writes())}`);
  if (!NOT_SAVED.test(await rowWords())) return broken(`80 typed and Enter pressed: the row does not say Not saved: use 0.50 to 0.99. ("${(await rowWords()).slice(-120)}")`);
  if ((await field.inputValue()) !== "0.80") return broken(`80 refused, the field reads "${await field.inputValue()}", not the saved 0.80`);

  await field.fill("0.9");
  if (NOT_SAVED.test(await rowWords())) return broken("typing again left the Not saved line standing");
  await field.press("Enter");
  if (!(await until(async () => writes().length > 0))) return broken("0.9 typed and Enter pressed sent no write");
  await page.waitForTimeout(1200);
  const sent = writes();
  if (sent.length !== 1 || sent[0].method !== "PUT" || JSON.stringify(sent[0].body) !== JSON.stringify({ threshold: 0.9 })) {
    return broken(`0.9 typed and Enter pressed sent ${JSON.stringify(sent)}, not one PUT {"threshold":0.9}`);
  }
  if (!(await until(async () => (await field.inputValue()) === "0.90"))) return broken(`after the write the field reads "${await field.inputValue()}", not 0.90`);
  return held('80 sent nothing, said Not saved and put 0.80 back; 0.9 sent one PUT {"threshold":0.9} and the field reads 0.90');
});
