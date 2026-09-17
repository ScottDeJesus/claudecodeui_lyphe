// How much STRUCTURE the canvas stack is carrying: one reading of its pixels, composited into the one
// picture the visitor sees, and the wait for a frame that has any. `universe-ui-probe.mjs` walks the
// app; this file answers the one question that walk has to ask of the sky — is something drawn here,
// or a rectangle that would have photographed just as well if no loop had ever run?
//
// THE METRIC. Each sample's luminance against the MEDIAN luminance of the 5x5 neighbourhood around it
// on the same grid, sampled 64x64. Brightness, not colour, and local, not global: the sky's wash is a
// radial gradient from one token to another (`paintBackground` in
// `src/modules/universe/utils/universeSky.ts`), so there is no single background colour to test
// against, and a comparison against the sample's own majority colour measures the wrong property
// outright — the wash's outer ring is a colour almost nothing else shares, so a canvas that painted
// the gradient and drew not one star scores HIGHER than a healthy sky.
//
// WHAT IT SEPARATES, MEASURED. A starless wash built from the panel's own `--surface` and `--canvas`
// tokens at the gradient's own geometry scored 0 at every margin from 6 to 40; a flat fill the same
// way. The real sky never comes near either: its first drawn frame scored 1037, 1183, 1192 and 1197
// across four runs, and the same canvas a second later scored 164 to 203. Both ends clear the margin
// by an order of magnitude — where the majority-colour total for that same sky (1675, 2767, 2894) sat
// BELOW its own starless control's 2144, which is why that metric could not be thresholded at all. A
// canvas that has drawn nothing is fully transparent, reads as one flat field, and reports 0 —
// exactly the blank rectangle the probe exists to catch.
import { setTimeout as delay } from 'node:timers/promises';

import { POLL_MS, evaluate } from './universe-browser.mjs';

/**
 * The canvas the HAND is on: the panel's own root attribute and the input layer inside it — the one
 * layer of the stack that carries no `aria-hidden="true"`, because it is the one `elementFromPoint`
 * returns and the one the pointer module writes the sky's cursor on. Selected by that attribute and
 * nothing about its position, so a layer filling in later moves nothing here.
 */
export const CANVAS = '[data-universe-panel] canvas:not([aria-hidden="true"])';

/** Every layer of the stack, in the DOM order the browser paints them: what the composite is made of. */
const LAYERS = '[data-universe-panel] canvas';

/** The side of the square grid the canvas is sampled on, so a blank one cannot pass. */
const SAMPLE_GRID = 64;

/**
 * How far a sample's brightness must depart from the brightness of its own neighbourhood on the grid
 * before it counts as something DRAWN — in luminance units, 0 to 255.
 *
 * Set from measurement, not taste. On the live app the sky leaves 164 to 203 samples above 10 once its
 * first drawn frame is past, and 1037 to 1197 on that first frame itself, while a starless wash built
 * from the app's own `--surface` and `--canvas` tokens and a flat fill of the same size both leave 0
 * at every margin from 6 to 40. Ten sits inside a gap that wide, so the constant is not what the
 * verdict rests on.
 */
const STRUCTURE_MARGIN = 10;

/**
 * The stack's bitmap size and how many samples of the composite carry structure — or `null` while
 * there is no canvas of a non-zero size to read. The composite is the picture: no single layer holds
 * it, because the sky layer draws the wash and the tiles, the star layer the stars, the live layer
 * the comets and the flares, and each layer's own pixels are transparent everywhere the others are
 * not. So one scratch canvas is made at the input layer's bitmap size and every layer is drawn onto
 * it in DOM order — the order the browser paints them — and the metric runs on that. An expression
 * rather than a function, because it runs in the page.
 */
function readingScript() {
  return `(() => {
    const canvas = document.querySelector(${JSON.stringify(CANVAS)});
    if (canvas === null || canvas.width === 0 || canvas.height === 0) return null;
    const width = canvas.width;
    const height = canvas.height;
    const composite = document.createElement('canvas');
    composite.width = width;
    composite.height = height;
    const context = composite.getContext('2d');
    if (context === null) return null;
    for (const layer of document.querySelectorAll(${JSON.stringify(LAYERS)})) {
      if (layer.width === 0 || layer.height === 0) continue;
      context.drawImage(layer, 0, 0, width, height);
    }
    const pixels = context.getImageData(0, 0, width, height).data;
    const side = ${SAMPLE_GRID};
    const luminance = new Float64Array(side * side);
    for (let i = 0; i < side; i += 1) {
      for (let j = 0; j < side; j += 1) {
        const x = Math.floor(((i + 0.5) * width) / side);
        const y = Math.floor(((j + 0.5) * height) / side);
        const at = (y * width + x) * 4;
        if (pixels[at + 3] === 0) continue;
        luminance[j * side + i] = 0.2126 * pixels[at] + 0.7152 * pixels[at + 1] + 0.0722 * pixels[at + 2];
      }
    }
    const neighbourhood = [];
    let painted = 0;
    for (let i = 0; i < side; i += 1) {
      for (let j = 0; j < side; j += 1) {
        neighbourhood.length = 0;
        for (let a = Math.max(0, i - 2); a <= Math.min(side - 1, i + 2); a += 1) {
          for (let b = Math.max(0, j - 2); b <= Math.min(side - 1, j + 2); b += 1) {
            neighbourhood.push(luminance[b * side + a]);
          }
        }
        neighbourhood.sort((left, right) => left - right);
        const median = neighbourhood[neighbourhood.length >> 1];
        if (Math.abs(luminance[j * side + i] - median) > ${STRUCTURE_MARGIN}) painted += 1;
      }
    }
    return { w: width, h: height, painted };
  })()`;
}

/** One reading now, or `null` when there is nothing readable to report. */
export async function readPaint(cdp, sessionId) {
  try {
    return await evaluate(cdp, sessionId, readingScript());
  } catch {
    return null; // the loop is mid-teardown, or the context is not there yet
  }
}

/**
 * Waits until a frame with STRUCTURE on it has been drawn, and returns that reading — `null` when
 * none arrived in the window. This is the check a blank canvas cannot pass, and the reason a
 * screenshot taken after it is worth keeping at all.
 *
 * The reading returned is the FIRST frame that had structure, which is what a caller asking "was a
 * frame drawn?" wants — and it is a heavier number than the sky settles to a second later (see the
 * header), so a caller pairing it with a screenshot should read the canvas again on the far side of
 * the shutter rather than print this one beside the file.
 */
export async function waitForPaint(cdp, sessionId, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const reading = await readPaint(cdp, sessionId);
    if (reading !== null && reading.painted > 0) return reading;
    await delay(POLL_MS);
  }
  return null;
}
