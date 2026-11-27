// protects: src/modules/deepseek-spend/useDeepseekUsage.ts, src/modules/accounts/hooks/useDeepseekBalance.ts
// writes: none
// The DeepSeek spend view and the DeepSeek balance read on the frame the server pushes, never on a clock of their
// own: useDeepseekUsage rides deepseek_usage_changed and useDeepseekBalance deepseek_balance_state through
// useServerFrame, each keeps its one read on mount, neither calls setInterval or setTimeout, and the two interval
// constants they lost (DEEPSEEK_USAGE_POLL_MS, BALANCE_POLL_MS) are named nowhere under src. Read from the files,
// with comments stripped for the code checks.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const HOOKS = [
  { file: "src/modules/deepseek-spend/useDeepseekUsage.ts", kind: "deepseek_usage_changed", constant: "DEEPSEEK_USAGE_POLL_MS" },
  { file: "src/modules/accounts/hooks/useDeepseekBalance.ts", kind: "deepseek_balance_state", constant: "BALANCE_POLL_MS" },
];
const codeOf = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");

function sourceFiles(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== "node_modules") sourceFiles(full, found); }
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) found.push(full);
  }
  return found;
}

runCase(async () => {
  const wrong = [];
  for (const hook of HOOKS) {
    const name = path.basename(hook.file);
    const code = codeOf(fs.readFileSync(path.join(ROOT, hook.file), "utf8"));
    if (!/\buseServerFrame\s*\(/.test(code)) wrong.push(`${name} calls no useServerFrame`);
    if (!code.includes(`'${hook.kind}'`) && !code.includes(`"${hook.kind}"`)) wrong.push(`${name} names no ${hook.kind}`);
    if (!/useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?\brefresh\(\)/.test(code)) wrong.push(`${name} no longer reads once on mount`);
    for (const timer of ["setInterval", "setTimeout"]) {
      const count = (code.match(new RegExp(`\\b${timer}\\s*\\(`, "g")) || []).length;
      if (count > 0) wrong.push(`${name} still calls ${timer} (${count}x)`);
    }
  }
  for (const file of sourceFiles(path.join(ROOT, "src"))) {
    const text = fs.readFileSync(file, "utf8");
    for (const hook of HOOKS) if (new RegExp(`\\b${hook.constant}\\b`).test(text)) wrong.push(`${path.relative(ROOT, file)} names ${hook.constant}`);
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("both hooks ride their pushed frame through useServerFrame, read once on mount, call no setInterval or setTimeout; neither poll constant is named under src");
});
