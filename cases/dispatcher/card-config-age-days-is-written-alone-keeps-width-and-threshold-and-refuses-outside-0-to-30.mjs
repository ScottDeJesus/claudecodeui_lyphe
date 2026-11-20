// `dispatcher card config` carries age_days as it carries width and threshold: one number written alone keeps the
// other two, --json prints all three, a value outside 0-30 is one REFUSED line with exit 2 and the file untouched,
// and a missing file reads age_days 3. Run against a scratch cards.toml (CARDS_CONFIG_PATH), never the operator's.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/card_config.py, /home/lyphe/.claude/hooks/dispatcher/cmd/card.py
// writes: none

import fs from "node:fs";

import { broken, held, runCase } from "../lib/case.mjs";
import { dispatcher, scratchStore } from "../lib/card_queue.mjs";

const HOOKS = ["/home/lyphe/.claude/hooks"];

function json(out) {
  try { return JSON.parse(out.stdout.trim().split("\n").pop()); } catch { return null; }
}

runCase(async (t) => {
  const store = await scratchStore(t, "card-config-age", HOOKS);
  const file = store.env.CARDS_CONFIG_PATH;
  const wrong = [];

  const missing = json(await dispatcher(store, ["card", "config", "--json"]));
  if (missing?.age_days !== 3) wrong.push(`a missing cards.toml read ${JSON.stringify(missing)}, not age_days 3`);

  await dispatcher(store, ["card", "config", "--width", "2", "--threshold", "0.7"]);
  const five = json(await dispatcher(store, ["card", "config", "--age-days", "5", "--json"]));
  if (five?.width !== 2 || five?.threshold !== 0.7 || five?.age_days !== 5) wrong.push(`--age-days 5 answered ${JSON.stringify(five)}, not width 2, threshold 0.7, age_days 5`);
  const width = json(await dispatcher(store, ["card", "config", "--width", "3", "--json"]));
  if (width?.width !== 3 || width?.age_days !== 5) wrong.push(`--width 3 answered ${JSON.stringify(width)}: age_days 5 was not kept`);

  const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  for (const bad of ["31", "-1"]) {
    const out = await dispatcher(store, ["card", "config", `--age-days=${bad}`]);
    const said = `${out.stdout}${out.stderr}`.split("\n").filter((l) => l.startsWith("REFUSED"));
    if (out.code !== 2 || said.length !== 1 || !said[0].includes("age_days")) wrong.push(`--age-days ${bad} exited ${out.code} saying ${JSON.stringify(said)}, not one REFUSED line naming age_days and exit 2`);
    if (fs.readFileSync(file, "utf8") !== before) wrong.push(`--age-days ${bad} changed cards.toml`);
  }

  const zero = json(await dispatcher(store, ["card", "config", "--age-days", "0", "--json"]));
  const text = fs.readFileSync(file, "utf8");
  if (zero?.age_days !== 0 || !/^age_days = 0$/m.test(text) || !/^width = 3$/m.test(text)) wrong.push(`--age-days 0 answered ${JSON.stringify(zero)} and wrote ${JSON.stringify(text.split("\n").filter((l) => !l.startsWith("#")))}`);

  if (wrong.length) return broken(wrong.join("; "));
  return held("age_days 3 read from a missing file; 5 written beside width 2 and threshold 0.7; kept by a width write; 31 and -1 refused with the file untouched; 0 written");
});
