// The Analytics area's reader is the verb CODE_MODE_BIN names at the moment createAnalyticsModule() is built, and
// it carries that verb's answer untouched: argv ["analytics", "--days", N] (N 30 when the request names no window),
// cwd the home folder, the LAST stdout line as the answer, every row as printed (a key the house adds included), an
// answer past execFile's own megabyte carried whole. A verb that exits non-zero is a 502 ANALYTICS_SOURCE_FAILED
// whose message carries the verb's last stderr line; a last line that is not JSON, or an answer missing a key, is a 502.
//
// Scratch verbs in the kit's scratch folder; the module's router on its own express app on a loopback port.
//
// protects: server/modules/analytics/, server/shared/analytics-types.ts
// writes: none

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const MODULE = "server/modules/analytics/index.ts";
const BIG = 2 * 1024 * 1024;
const STDERR_LAST = "the history folder could not be read";
const GROUP = {
  kind: "k", code_mode: true, model: "m", launches: 2, ok: 1, turns: 3, tokens_in: 4, tokens_out: 5, tokens: 9, seconds: 6,
  turns_total: 6, tokens_in_total: 8, tokens_out_total: 10, seconds_total: 12, merges_asked: 0, merges_merged: 0,
  scripts: 1, thrown: 0, timed_out: 0, refused: 0, failed: 0, declined: 0, resent: 0, a_key_the_house_adds_later: "kept",
};

function answering(drop: string | null): string {
  return `const answer = { days: Number(process.argv[4]), generated_at: 1, today: JSON.stringify(process.argv.slice(2)),
  first_day: process.cwd(), kinds: [{ kind: "k", label: "K" }], uncounted: [], groups: [${JSON.stringify(GROUP)}], rollups: [],
  series: [], faults: { total: 2, by_fault: { timed_out: 2 } },
  causes: [{ fault: "f", helper: "h", hook: "x", count: 1, threw: 0, launches: 1, kinds: ["k"], top: [{ cause: "x".repeat(${BIG}), count: 1 }] }] };
${drop ? `delete answer[${JSON.stringify(drop)}];` : ""}
console.log("the verb's own chatter before its answer");
console.log(JSON.stringify(answer));`;
}

function verb(dir: string, name: string, body: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!${process.execPath}\n${body}\n`);
  fs.chmodSync(file, 0o755);
  return file;
}

async function get(base: string, query: string): Promise<{ status: number; json: any }> {
  const response = await fetch(`${base}/api/analytics/code-mode${query}`);
  const text = await response.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, json };
}

runCase(async (t: any) => {
  let mod: any;
  try {
    mod = await import(pathToFileURL(path.join(REPO, MODULE)).href);
  } catch (error: any) {
    return broken(`${MODULE} does not load — ${String(error?.message ?? error).split("\n")[0]}`);
  }
  if (typeof mod.createAnalyticsModule !== "function") return broken(`${MODULE} exports no createAnalyticsModule`);
  const { default: express } = await import("express");
  const before = process.env.CODE_MODE_BIN;
  t.defer(() => { if (before === undefined) delete process.env.CODE_MODE_BIN; else process.env.CODE_MODE_BIN = before; });

  const dir = await scratchDir(t, "analytics-verbs");
  const verbs = {
    answering: verb(dir, "answering", answering(null)),
    failing: verb(dir, "failing", `process.stderr.write("an earlier line\\n${STDERR_LAST}\\n"); process.exit(3);`),
    noJson: verb(dir, "no-json", `console.log("{ not json");`),
    noSeries: verb(dir, "no-series", answering("series")),
  };

  async function serve(bin: string): Promise<string> {
    process.env.CODE_MODE_BIN = bin;
    const app = express();
    app.use("/api/analytics", mod.createAnalyticsModule().router);
    app.use((error: any, _request: any, response: any, _next: any) => {
      response.status(error?.statusCode ?? 500).json({ success: false, error: { code: error?.code ?? null, message: String(error?.message ?? error) } });
    });
    const server: any = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    t.defer(() => new Promise((resolve) => server.close(resolve)));
    return `http://127.0.0.1:${server.address().port}`;
  }

  const wrong: string[] = [];
  const home = fs.realpathSync(os.homedir());
  const built = await serve(verbs.answering);
  process.env.CODE_MODE_BIN = verbs.failing; // the module is built: moving the variable now must not move its verb
  for (const [query, days] of [["?days=30", "30"], ["", "30"], ["?days=366", "366"]]) {
    const r = await get(built, query);
    if (r.status !== 200) { wrong.push(`"${query}" answered ${r.status} ${JSON.stringify(r.json?.error ?? null)}`); continue; }
    const data = r.json?.data ?? {};
    let argv: unknown = null;
    try { argv = JSON.parse(data.today); } catch { argv = data.today; }
    if (JSON.stringify(argv) !== JSON.stringify(["analytics", "--days", days])) wrong.push(`"${query}" ran the verb with ${JSON.stringify(argv)}`);
    if (r.json.section !== "code-mode" || r.json.days !== Number(days) || data.days !== Number(days)) wrong.push(`"${query}" answered section ${r.json.section}, days ${r.json.days}, data.days ${data.days}`);
    if (typeof data.first_day !== "string" || fs.realpathSync(data.first_day) !== home) wrong.push(`"${query}" ran the verb in ${data.first_day}, not ${home}`);
    if (JSON.stringify(data.groups) !== JSON.stringify([GROUP])) wrong.push(`"${query}" did not carry the group row as printed: ${JSON.stringify(data.groups).slice(0, 160)}`);
    if (data.causes?.[0]?.top?.[0]?.cause?.length !== BIG) wrong.push(`"${query}" did not carry the ${BIG}-character cause whole (${data.causes?.[0]?.top?.[0]?.cause?.length})`);
    if (data.faults?.total !== 2 || data.faults?.by_fault?.timed_out !== 2) wrong.push(`"${query}" answered faults ${JSON.stringify(data.faults)}`);
  }
  const failures: Array<[string, string, string | null]> = [
    ["a verb that exits 3", verbs.failing, STDERR_LAST],
    ["a last line that is not JSON", verbs.noJson, null],
    ["an answer with no series", verbs.noSeries, null],
  ];
  for (const [what, bin, words] of failures) {
    const r = await get(await serve(bin), "?days=7");
    const message = String(r.json?.error?.message ?? "");
    if (r.status !== 502 || r.json?.error?.code !== "ANALYTICS_SOURCE_FAILED" || message === "") wrong.push(`${what} answered ${r.status} ${JSON.stringify(r.json?.error ?? null)}, not a 502 ANALYTICS_SOURCE_FAILED with a sentence`);
    else if (words && !message.includes(words)) wrong.push(`${what} answered "${message}", which does not carry the verb's "${words}"`);
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`argv analytics --days N (30 with no window) from ${home}, the last line carried as printed past 2 MiB, the built verb kept after CODE_MODE_BIN moved, 502 ANALYTICS_SOURCE_FAILED for exit 3 (carrying "${STDERR_LAST}"), a non-JSON last line and a missing series`);
});
