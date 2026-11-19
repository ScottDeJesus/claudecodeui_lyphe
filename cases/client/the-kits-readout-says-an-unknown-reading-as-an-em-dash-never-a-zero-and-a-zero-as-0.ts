// The kit's Readout (src/shared/ui/Readout.tsx, exported from the kit's barrel) draws one figure with its label, an
// optional unit and tone. AN UNKNOWN READING IS AN EM-DASH, NEVER A ZERO (Astrolabe's Readout page: "No value shows
// '—'"), and a reading of zero is the figure 0, never the dash: the dashboard's numbers are read off this piece, and a
// section that could not be read must never print a count a reader would believe.
//
// The barrel is imported in node and the piece rendered to static markup with React's own server renderer; its text is
// read with the tags stripped. Nothing is drawn on a screen and nothing leaves the process. The props are the ones the
// seam names (label, value, unit); a later rename of a prop is a change to how this case finds the piece.
//
// protects: src/shared/ui/Readout.tsx, src/shared/ui/index.ts
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";

const DASH = "—";

runCase(async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const kit = await import("../../src/shared/ui/index.ts");
  const Readout = (kit as Record<string, unknown>).Readout;
  if (typeof Readout !== "function" && typeof Readout !== "object") return broken("the kit's barrel exports no Readout");

  const textOf = (props: Record<string, unknown>): string =>
    renderToStaticMarkup(createElement(Readout as never, props as never))
      .replace(/<[^>]*>/g, " ")
      .replace(/&#x27;|&quot;|&amp;|&lt;|&gt;/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const wrong: string[] = [];
  for (const [what, value] of [["null", null], ["undefined", undefined]] as const) {
    const text = textOf({ label: "Open high", value });
    if (!text.includes(DASH)) wrong.push(`a ${what} reading draws "${text}", with no em-dash`);
    if (/(^|\D)0(\D|$)/.test(text)) wrong.push(`a ${what} reading draws a 0: "${text}"`);
    if (!text.includes("Open high")) wrong.push(`a ${what} reading drops its label: "${text}"`);
  }
  const zero = textOf({ label: "Open high", value: 0 });
  if (!/(^|\D)0(\D|$)/.test(zero)) wrong.push(`a reading of 0 draws "${zero}", with no 0`);
  if (zero.includes(DASH)) wrong.push(`a reading of 0 draws the unknown dash: "${zero}"`);
  const twelve = textOf({ label: "Median time to fix", value: 12, unit: "h" });
  if (!/(^|\D)12(\D|$)/.test(twelve) || !/\bh\b/.test(twelve) || !twelve.includes("Median time to fix")) {
    wrong.push(`a reading of 12 with unit h draws "${twelve}", not 12, h and its label`);
  }

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`unknown reads "${textOf({ label: "Open high", value: null })}", zero reads "${zero}", twelve reads "${twelve}"`);
});
