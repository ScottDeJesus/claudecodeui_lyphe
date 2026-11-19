// The kit's DayBars (src/shared/ui/DayBars.tsx, exported from the kit's barrel) draws one or two series over named
// days, lifted from the API view's own plots with a second series added (bug-board-ways-in-and-dashboard, seam 11):
// one bar per day per series on one scale, the tallest reading the whole of its side of the plot, a zero day a
// one-pixel stub so a quiet day never reads as a missing one, a ruled zero baseline, and each day carrying its whole
// reading as its title. The legend says each series' total, so the two sums are read as numbers.
//
// The barrel is imported in node and the piece rendered to static markup with React's own server renderer. Three days,
// two series: opened 4, 0, 2 and fixed 1, 3, 0. Nothing is drawn on a screen and nothing leaves the process. The
// props and the `vv-daybars__*` classes are how this case finds the piece; a rename of either changes only that.
//
// protects: src/shared/ui/DayBars.tsx, src/shared/ui/index.ts
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";

const DAYS = [
  { day: "2026-11-17", values: [4, 1], title: "Nov 17 · 4 opened · 1 fixed" },
  { day: "2026-11-18", values: [0, 3], title: "Nov 18 · 0 opened · 3 fixed" },
  { day: "2026-11-19", values: [2, 0], title: "Nov 19 · 2 opened · 0 fixed" },
];
const SERIES = [{ label: "Opened" }, { label: "Fixed" }];

runCase(async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const kit = (await import("../../src/shared/ui/index.ts")) as Record<string, unknown>;
  if (typeof kit.DayBars !== "function") return broken("the kit's barrel exports no DayBars");

  const html = renderToStaticMarkup(createElement(kit.DayBars as never, {
    days: DAYS, series: SERIES, label: "Cards opened and fixed per day", peakLabel: (peak: number) => `Tallest bar: ${peak} in a day`,
  } as never));
  const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  const px = (style: string | undefined) => Number(/height:\s*([\d.]+)px/.exec(style ?? "")?.[1] ?? NaN);

  // One column per day: its title, then each series' side (its full height) and its bar (its reading's height).
  const columns = html.split(/(?=<span[^>]*class="[^"]*vv-daybars__day\b)/).slice(1).map((chunk) => ({
    title: unescape(/title="([^"]*)"/.exec(chunk)?.[1] ?? ""),
    sides: [...chunk.matchAll(/class="[^"]*vv-daybars__side\b[^"]*"[^>]*style="([^"]*)"/g)].map((m) => px(m[1])),
    bars: [...chunk.matchAll(/class="[^"]*vv-daybars__bar\b[^"]*"[^>]*style="([^"]*)"/g)].map((m) => px(m[1])),
  }));

  const wrong: string[] = [];
  if (columns.length !== DAYS.length) wrong.push(`${columns.length} day columns drawn for ${DAYS.length} days`);
  const peak = Math.max(...DAYS.flatMap((d) => d.values));
  columns.forEach((column, at) => {
    const day = DAYS[at];
    if (!day) return;
    if (column.title !== day.title) wrong.push(`${day.day}'s title reads "${column.title}", not its whole reading "${day.title}"`);
    if (column.bars.length !== SERIES.length) wrong.push(`${day.day} draws ${column.bars.length} bars for ${SERIES.length} series`);
    day.values.forEach((value, s) => {
      const bar = column.bars[s];
      const side = column.sides[s];
      if (value === 0 && bar !== 1) wrong.push(`${day.day}'s zero ${SERIES[s].label} is ${bar} px, not a one-pixel stub`);
      if (value === peak && bar !== side) wrong.push(`${day.day}'s ${value} ${SERIES[s].label}, the tallest reading, is ${bar} px of a ${side} px side`);
      if (value > 0 && value < peak && !(bar > 1 && bar < side)) wrong.push(`${day.day}'s ${value} ${SERIES[s].label} is ${bar} px of a ${side} px side`);
    });
  });
  if (!/vv-daybars__zero\b/.test(html)) wrong.push("no ruled zero baseline is drawn");
  const text = unescape(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ");
  if (!/Opened\s*6\b/.test(text) || !/Fixed\s*4\b/.test(text)) wrong.push(`the legend does not say Opened 6 and Fixed 4: "${text.slice(0, 160)}"`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`3 days x 2 series: bars ${columns.map((c) => c.bars.join("/")).join(", ")} px, zero days 1 px, each day titled with its reading, legend Opened 6 and Fixed 4`);
});
