/**
 * THE KIT'S CHART SCALES, one rule for every chart that names its steps: a scale is cut into a few round steps (1, 2 or 5
 * of a power of ten), a count is never cut finer than one, and a measure with a top of its own (a share's whole) ends
 * there. Read by DayChart and Dumbbell; not exported from the barrel.
 */

/** How many steps a scale is cut into, at most, between its two ends. */
const STEPS = 4;

/** A scale: its two ends, its step, and the steps' values from the low end up. */
export type ChartScale = { low: number; high: number; step: number; ticks: number[] };

/** The round step that cuts a span into `STEPS` pieces or a few fewer. */
function roundStep(span: number, whole: boolean): number {
  if (span <= 0) return 1;
  const rough = span / STEPS;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((times) => times * magnitude).find((candidate) => candidate >= rough) ?? 10 * magnitude;
  return whole ? Math.max(1, step) : step;
}

/** The steps from one end to the other, each a multiple of the step so a float never drifts into the words. */
function ticksOf(low: number, high: number, step: number): number[] {
  const ticks: number[] = [];
  for (let at = Math.round(low / step); at * step <= high + step / 2; at += 1) ticks.push(Number((at * step).toPrecision(12)));
  return ticks;
}

/**
 * A scale from zero up to the tallest value, rounded up to a whole number of steps; a `ceiling` (a share's 1) is the top
 * instead. Nothing to draw is a scale of four ones, so an empty plot still has its ruled steps.
 */
export function zeroScale(peak: number, ceiling?: number): ChartScale {
  if (ceiling !== undefined) {
    const step = ceiling / STEPS;
    return { low: 0, high: ceiling, step, ticks: ticksOf(0, ceiling, step) };
  }
  if (peak <= 0) return { low: 0, high: STEPS, step: 1, ticks: ticksOf(0, STEPS, 1) };
  const step = roundStep(peak, Number.isInteger(peak));
  const high = step * Math.ceil(peak / step);
  return { low: 0, high, step, ticks: ticksOf(0, high, step) };
}

/**
 * A scale fitted round the values it holds, for marks that are positions and not lengths (a dot on a line can start
 * anywhere): from a round step under the lowest value to the `ceiling`, or to a round step over the highest.
 */
export function fitScale(lowest: number, highest: number, ceiling?: number): ChartScale {
  const top = ceiling ?? highest;
  const step = roundStep(Math.max(top - lowest, top / 10), false);
  const low = Math.max(0, step * Math.floor(lowest / step - 0.5));
  const high = ceiling ?? step * Math.ceil(highest / step);
  return { low, high, step, ticks: ticksOf(low, high, step) };
}
