// protects: server/modules/providers, server/modules/code-mode
// writes: none
//
// MAN-8487, as Code Mode for chats keeps it: the Claude runtime reaches Code Mode only through its context
// (context.codeMode, ChatCodeModeHooks) and imports nothing from server/modules/code-mode/; the module registers its
// hooks with useChatCodeMode, the way the tool sets and custom compaction do. The module, for its part, reaches the
// runtime only through the providers barrel, never into server/modules/providers/list.
//
// Reads the source tree; runs nothing.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE = /\.(ts|js|mjs|tsx)$/;
const IMPORTS = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"`])([^'"`]+)\1/g;

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (SOURCE.test(entry)) out.push(full);
  }
  return out;
}

const specifiersOf = (file: string) => [...readFileSync(file, "utf8").matchAll(IMPORTS)].map((m) => m[2]);

/** The repo-relative module a specifier names: `@/x` is server/x, a relative one is resolved from the file. */
function target(file: string, spec: string): string | null {
  if (spec.startsWith("@/")) return path.join("server", spec.slice(2));
  if (spec.startsWith(".")) return path.relative(ROOT, path.resolve(path.dirname(file), spec));
  return null;
}

runCase(async () => {
  const providers = path.join(ROOT, "server/modules/providers");
  const codeMode = path.join(ROOT, "server/modules/code-mode");
  let providerFiles: string[];
  let codeModeFiles: string[];
  try {
    providerFiles = filesUnder(providers);
    codeModeFiles = filesUnder(codeMode);
  } catch (error) {
    return broken(`the folders are not readable: ${String((error as Error)?.message ?? error)}`);
  }
  if (providerFiles.length < 20) return cannotRun(`only ${providerFiles.length} source files under server/modules/providers: the tree is not the one this case knows`);
  if (codeModeFiles.length === 0) return broken("server/modules/code-mode holds no source file: nothing registers Code Mode's hooks");

  const wrong: string[] = [];
  for (const file of providerFiles) {
    for (const spec of specifiersOf(file)) {
      const to = target(file, spec);
      if (to && (to === "server/modules/code-mode" || to.startsWith("server/modules/code-mode/"))) {
        wrong.push(`${path.relative(ROOT, file)} imports ${spec}`);
      }
    }
  }
  for (const file of codeModeFiles) {
    for (const spec of specifiersOf(file)) {
      const to = target(file, spec);
      if (to && to.startsWith("server/modules/providers/list/")) wrong.push(`${path.relative(ROOT, file)} reaches into the runtime: ${spec}`);
    }
  }
  const registers = codeModeFiles.some((file) => /useChatCodeMode\s*\(/.test(readFileSync(file, "utf8")));
  if (!registers) wrong.push("no file of server/modules/code-mode calls useChatCodeMode");

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`${providerFiles.length} files under server/modules/providers import nothing from server/modules/code-mode; its ${codeModeFiles.length} files reach no runtime file and one registers useChatCodeMode`);
});
