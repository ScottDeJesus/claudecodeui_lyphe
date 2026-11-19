// The Scheduling view composes @/shared/ui and builds nothing (MAN-575): it styles nothing of its own, and tone reaches
// paint only as data-tone plus a tone-* name (MAN-7868). Its sentences are cerberus.scheduling.* keys through t(), English
// only: a word written into the markup is a sentence no translation and no review of the words file can reach.
//
// So no file under src/modules/scheduling-report is a stylesheet; none sets a `style` prop; no string in it holds a
// palette colour class (text-red-500, bg-emerald-100/50, border-amber-300 …) or a colour literal (#hex, rgb(), hsl());
// and no JSX text node carries a letter. Layout classes (flex, grid, gap-4, md:grid-cols-2 …) are the composer's own and
// pass. The Uploads view, the model this view follows, holds none of these (read 2026-11-19).
//
// Read with the TypeScript compiler; nothing is imported or run.
//
// protects: src/modules/scheduling-report
// writes: none

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MODULE = path.join(REPO, "src/modules/scheduling-report");

const PALETTE = "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black|white";
const COLOUR_CLASS = new RegExp(`(^|[\\s:'"\`])(text|bg|border|fill|stroke|ring|outline|from|via|to|decoration|divide|shadow|accent|caret)-(${PALETTE})(-\\d{2,3})?(\\/\\d+)?(?=$|[\\s'"\`])`);
const COLOUR_LITERAL = /(#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla|oklch|oklab)\()/;

async function filesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await filesUnder(full)));
    else out.push(full);
  }
  return out;
}

runCase(async () => {
  let files: string[];
  try {
    files = await filesUnder(MODULE);
  } catch {
    return broken("src/modules/scheduling-report is not on disk");
  }
  const ts = (await import("typescript")).default;
  const wrong: string[] = [];
  let scanned = 0;

  for (const file of files) {
    const rel = path.relative(REPO, file);
    if (/\.(css|scss|sass|less)$/.test(file)) { wrong.push(`${rel} is a stylesheet`); continue; }
    if (!/\.(ts|tsx)$/.test(file)) continue;
    scanned += 1;
    const text = await readFile(file, "utf8");
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const line = (n: any) => source.getLineAndCharacterOfPosition(n.getStart(source)).line + 1;
    const visit = (n: any) => {
      if (ts.isJsxAttribute(n) && (n.name as any).text === "style") wrong.push(`${rel}:${line(n)} sets a style prop`);
      if (ts.isJsxText(n) && /\p{L}/u.test(n.text.replace(/&[a-zA-Z]+;|&#\w+;/g, ""))) wrong.push(`${rel}:${line(n)} writes ${JSON.stringify(n.text.trim().slice(0, 40))} into the markup`);
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
        const s = (n as any).text as string;
        const cls = COLOUR_CLASS.exec(s);
        if (cls) wrong.push(`${rel}:${line(n)} names the colour class ${cls[0].trim()}`);
        const lit = COLOUR_LITERAL.exec(s);
        if (lit) wrong.push(`${rel}:${line(n)} holds the colour ${lit[0]}`);
      }
      ts.forEachChild(n, visit);
    };
    visit(source);
  }

  if (scanned === 0) wrong.push("the module holds no .ts or .tsx file");
  if (wrong.length > 0) return broken(`${wrong.slice(0, 8).join("; ")}${wrong.length > 8 ? ` (+${wrong.length - 8})` : ""}`);
  return held(`${scanned} files: no stylesheet, no style prop, no palette class or colour literal, no word in the markup`);
});
