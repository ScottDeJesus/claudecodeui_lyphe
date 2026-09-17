import { GLOW_MULT, GLOW_MULT_DEFAULT, bokehOf, coreOf, dopplerSwing, glowOf, isDustRegime } from '@/modules/universe/utils/universeStarGeometry';
import { isFile } from '@/modules/universe/utils/universeGraph';
import { STARS_FRAGMENT_SOURCE, STARS_VERTEX_SOURCE } from '@/modules/universe/utils/universeStarsShaders';
import { KIND_TOKEN, bandedBrightness, channelsForNode, rgbOf } from '@/modules/universe/utils/universeTokens';
import { viewportBounds } from '@/modules/universe/utils/universeView';
import type { UniverseGraph, UniverseGraphNode } from '@/modules/universe/utils/universeGraph';
import type { UniverseTokens } from '@/modules/universe/utils/universeTokens';
import type { UniverseTweaks } from '@/modules/universe/utils/universeTweaks';
import type { Viewport } from '@/modules/universe/utils/universeView';

/**
 * THE STARS ON THE GPU — the glow and the disc of every star that fits a point, in one buffer, one
 * upload and two draws a frame.
 *
 * WHAT IT REPLACED, AND WHAT IT DID NOT. The two heaviest passes of the 2D star layer were the glow
 * — one sprite blit per visible star — and the cores — one disc per visible star. Both are here as
 * records in a typed array; the edges, the trails, the dust, the clouds and the labels stay on the
 * canvas, because they were never the cost. The two paths draw the same sky because every number in
 * a record comes from `universeStarGeometry` and every colour from `universeTokens`: this file
 * decides HOW MANY points and WHICH shape, never how big a light is or how bright.
 *
 * ONE ARRAY, TWO HALVES, ONE UPLOAD. A record is eight floats — x, y, radius, r, g, b, a, shape.
 * Glow records are written from the front of the array and disc records from the middle: one
 * `bufferData` covers the span and two `drawArrays` read the two runs, so the upload happens once a
 * frame and the blend is set only between the draws. The glow is additive (`ONE, ONE`) and the disc
 * is not (`ONE, ONE_MINUS_SRC_ALPHA`), both against premultiplied output — see `universeStarsShaders`
 * for why that pairing is the whole of the anti-halo rule. The array is sized for the active list
 * and grown only when a larger one arrives: an array allocated per frame would be the megabyte this
 * layer exists to avoid.
 *
 * THE POINT CEILING IS THE DEVICE'S, AND IT IS THE RULE. The widest point a driver will draw is read
 * from it once, at the top; a star whose glow would be drawn wider than that ceiling is not sent at
 * all and is handed back to the caller, because a driver does not refuse an oversized point — it
 * clamps it, and a clamped sun is a square. There are a handful of such stars, and the 2D star layer
 * draws them whole.
 *
 * WHAT IT IS HANDED AND WHAT IT HANDS BACK. The viewport, the palette, the tweaks and the clock:
 * nothing else, and no canvas — the draw target is this layer's own element. It returns the list of
 * stars it refused, which is this instance's own array, reused every frame: the caller draws it
 * before the next draw and must not keep it.
 */

/** The layer as the owner holds it: one draw a frame, and the three things a canvas lifecycle asks. */
export type StarsGL = {
  /** Fill the buffer, upload it once, draw it twice, and answer the stars the GPU could not carry. */
  draw(
    graph: UniverseGraph,
    view: Viewport,
    tokens: UniverseTokens,
    tweaks: UniverseTweaks,
    now: number,
  ): UniverseGraphNode[];
  /** The element was resized: the viewport follows its bitmap, or the stars draw at the old size. */
  resize(): void;
  /** Blank the layer — what the owner calls the moment the choice moves back to the canvas. */
  clear(): void;
  /** The program and the buffer go. The context goes with the element. */
  dispose(): void;
};

/** How many floats one point is, and the byte stride they make. */
const FLOATS = 8;
const STRIDE = FLOATS * 4;
/** The shapes a record carries, by number: a soft glow, a disc, and a speck of dust. */
const SHAPE_GLOW = 0;
const SHAPE_DISC = 1;
const SHAPE_DUST = 3;
/** The smallest glow worth a point, in screen pixels — under it the sprite is a dot, and a point per
 *  file at the fitted view would be six thousand bright specks the 2D pass never drew. `drawGlow`
 *  skips a file's glow below this and this layer skips the same one, and both read the SAME
 *  expression to decide it: a file's radius through `GLOW_MULT`, times the zoom. `glowOf`'s radius
 *  carries the breath, the depth and the twinkle as well, and a gate cut on it would take a
 *  different set of stars than the pass it replaces — a star near the threshold would appear on one
 *  path and not the other, and flicker between them as its own breath crossed the line. */
const GLOW_MIN_PX = 2.5;
/** The fewest records a half is ever sized for, so a small active list does not rebuild the array. */
const MIN_RECORDS = 256;
/**
 * The sun's iris — the bright centre `drawGlow` blits over everything a core casts — as a radius in
 * star radii and an alpha, and the shade under full a document and a directory are drawn in, copied
 * from `drawCores`. They are the three numbers this layer carries rather than reads, because the
 * file that owns what a star looks like has no name for a core's own light nor for a kind's shade,
 * and the pass that owns them is on the canvas. Both are EXPORTED because the two paths that draw
 * them are one path: a star too wide for a GPU point goes back to the canvas, and the pass that
 * paints it there blits the same light and the same shade from here rather than from a second copy.
 * The one reader left outside — `drawCores` in `universeStarlight` — keeps its own copy of the
 * shade, because that file is not one this phase may write.
 */
export const CORE_IRIS_RADII = 2.6;
export const CORE_IRIS_ALPHA = 0.9;
export const KIND_DIM: Record<string, number> = { docs: 0.8, dir: 0.9 };

/**
 * The alpha a star's disc is drawn at, by the rule the core pass draws it by — and the reason this
 * layer may not read `coreOf`'s alpha for every star the way it reads every other number.
 *
 * `coreOf` answers with the three bands a SETTLED star is quantised into, so a skyful of neighbours
 * at the same depth collapses into one fill. Only the settled branch of `drawCores` draws that band;
 * every other star — one the focus has dimmed, one the depth has blurred, one occluded, the sun, a
 * galaxy — is filled at its own measured strength, `max(0.15, f) · min(1, da) · (1 − 0.7·bl)`.
 * Sending the band for those is a picture difference, not a rounding one: focus a pivot and every
 * star outside its neighbourhood eases to `f = 0.1`, so the canvas path fades the whole sky to 15%
 * while a layer drawing the band leaves every disc at full strength — no focus affordance at all.
 *
 * Exported for the single-home reason the iris above carries: a star too wide for a GPU point goes
 * to `drawLeftovers`, which must fill its disc at exactly this alpha or the two paths disagree.
 */
export function discAlphaOf(node: UniverseGraphNode, band: number): number {
  const settled =
    node.f > 0.98 && node.occ < 0.05 && node.bl < 0.05 && node.kind !== 'core' && node.kind !== 'galaxy';
  return settled ? band : Math.max(0.15, node.f) * Math.min(1, node.da) * (1 - 0.7 * node.bl);
}

/** One shader, compiled, or `null` with the driver's own complaint logged — a source that will not
 *  compile is a defect in this build, and the log is the only place the driver says what it hated. */
function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (shader === null) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) === true) return shader;
  console.error('universeStarsGL: a star shader would not compile', gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
  return null;
}

/** The program the two sources make, or `null` for a device that will not link them. */
function link(gl: WebGLRenderingContext): WebGLProgram | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, STARS_VERTEX_SOURCE);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, STARS_FRAGMENT_SOURCE);
  if (vertex === null || fragment === null) return null;
  const program = gl.createProgram();
  if (program === null) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  // The shaders are in the program now; the objects behind them are not needed to draw with it.
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) === true) return program;
  console.error('universeStarsGL: the star program would not link', gl.getProgramInfoLog(program));
  gl.deleteProgram(program);
  return null;
}

/**
 * The GPU star layer over one canvas, or `null` when this page has no WebGL to give it — the caller
 * then hands the 2D star layer everything, which is the path this build shipped with.
 */
export function createStarsGL(canvas: HTMLCanvasElement): StarsGL | null {
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false });
  if (gl === null) return null;
  const program = link(gl);
  if (program === null) return null;
  const buffer = gl.createBuffer();
  if (buffer === null) return null;

  // The attribute slots and the four uniforms, looked up once: a `getAttribLocation` per frame is a
  // string lookup per frame, and the program never changes under this layer's life.
  const at = {
    pos: gl.getAttribLocation(program, 'aPos'),
    size: gl.getAttribLocation(program, 'aSize'),
    color: gl.getAttribLocation(program, 'aColor'),
    shape: gl.getAttribLocation(program, 'aShape'),
  };
  const uniform = {
    cam: gl.getUniformLocation(program, 'uCam'),
    zoom: gl.getUniformLocation(program, 'uZoom'),
    half: gl.getUniformLocation(program, 'uHalf'),
    dpr: gl.getUniformLocation(program, 'uDpr'),
  };
  // The widest point this device will draw, read ONCE. A driver that answers nothing gets the
  // ceiling every implementation promises.
  const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array | null;
  const maxPoint = range === null ? 64 : range[1] || 64;

  let data = new Float32Array(0);
  /** How many records the glow half holds; the discs start at it. */
  let half = 0;
  let coreRecords = 0;

  /**
   * The two halves, sized for the active list. Grown only when the list outgrows what is held, and
   * never emptied: the walk below writes over every record it will draw, and what it does not write
   * is never drawn from.
   */
  const ensure = (glow: number, core: number): void => {
    if (glow <= half && core <= coreRecords) return;
    half = Math.max(glow, MIN_RECORDS);
    coreRecords = Math.max(core, MIN_RECORDS);
    data = new Float32Array((half + coreRecords) * FLOATS);
  };

  /** One record at `at`, and the index of the next one. The only place the layout is written down. */
  const put = (
    at: number,
    x: number,
    y: number,
    radius: number,
    color: readonly [number, number, number],
    alpha: number,
    shape: number,
  ): number => {
    data[at] = x;
    data[at + 1] = y;
    data[at + 2] = radius;
    data[at + 3] = color[0];
    data[at + 4] = color[1];
    data[at + 5] = color[2];
    data[at + 6] = alpha;
    data[at + 7] = shape;
    return at + FLOATS;
  };

  const leftovers: UniverseGraphNode[] = [];

  const draw = (
    graph: UniverseGraph,
    view: Viewport,
    tokens: UniverseTokens,
    tweaks: UniverseTweaks,
    now: number,
  ): UniverseGraphNode[] => {
    leftovers.length = 0;
    const z = view.z;
    // The ratio is the BITMAP's, worked out from the box it is drawn in: a point is measured in the
    // bitmap's pixels and the viewport is measured in the box's, and the two differ by exactly it.
    const dpr = view.w > 0 ? canvas.width / view.w : 1;
    const bokeh = tweaks.depthOfField > 0;
    const ink = rgbOf(tokens, '--ink');
    // The glow half takes a second record per star when depth of field is on, for the soft disc a
    // blurred star spreads into, and the sun adds a third of its own for the iris; the disc half is
    // always one record per star and never more. Sized for that worst case, so the walk below cannot
    // reach the far half — and every put is bounded as well, because the two halves are a rule about
    // the buffer rather than an arithmetic that happens to come out.
    ensure(graph.act.length * (bokeh ? 2 : 1) + 1, graph.act.length);
    const coreStart = half;
    let glowAt = 0;
    let coreAt = coreStart * FLOATS;
    const bounds = viewportBounds(view);

    for (const node of graph.act) {
      if (node.x < bounds.x0 || node.x > bounds.x1 || node.y < bounds.y0 || node.y > bounds.y1) continue;
      const glow = glowOf(node, now, 0);
      const color = rgbOf(tokens, KIND_TOKEN[node.kind]);
      // THE GATE THE GLOW PASS ITSELF USES, read before anything is written: a file's glow under a
      // couple of screen pixels is a dot the 2D pass never drew. The bokeh and the iris ride it,
      // because both are drawn inside a glow's reach.
      const draws = !isFile(node) || node.r * (GLOW_MULT[node.kind] ?? GLOW_MULT_DEFAULT) * z >= GLOW_MIN_PX;
      const spread = draws && bokeh && node.r * z >= 2 ? bokehOf(node) : null;
      const iris = draws && node.kind === 'core' ? node.r * CORE_IRIS_RADII : 0;
      // THE CEILING IS THE WIDEST RECORD THIS STAR PUTS THROUGH THE SLOT, not the glow's alone. Past
      // it the driver does not refuse the point, it CLAMPS it, and what comes out is a shape the
      // geometry never asked for — a disc the shader derives from `gl_PointCoord` arrives smaller
      // and harder than `bokehOf` sized it. The bokeh spreads three times past the glow at the
      // twinkle floor, so on a device with a 64 px cap, not this box's 1023, the blurred stars are
      // what breaks first. A star that does not fit goes back whole — glow, bokeh, iris and disc.
      let widest = glow.radius;
      if (spread !== null && spread.radius > widest) widest = spread.radius;
      if (iris > widest) widest = iris;
      if (widest * 2 * z * dpr > maxPoint) {
        leftovers.push(node);
        continue;
      }
      if (draws) {
        if (glowAt + FLOATS <= coreStart * FLOATS) {
          glowAt = put(glowAt, node.x, node.y, glow.radius, color, glow.alpha, SHAPE_GLOW);
        }
        if (spread !== null && glowAt + FLOATS <= coreStart * FLOATS) {
          glowAt = put(glowAt, node.x, node.y, spread.radius, color, spread.alpha, SHAPE_GLOW);
        }
        if (iris > 0 && glowAt + FLOATS <= coreStart * FLOATS) {
          glowAt = put(glowAt, node.x, node.y, iris, ink, CORE_IRIS_ALPHA, SHAPE_GLOW);
        }
      }
      const disc = coreOf(node, now);
      const swing = dopplerSwing(node, tweaks.doppler);
      const core = swing === null ? channelsForNode(node, tokens, bandedBrightness(node, now, tweaks)) : rgbOf(tokens, swing);
      coreAt = put(
        coreAt,
        node.x,
        node.y,
        disc.radius,
        core,
        discAlphaOf(node, disc.alpha) * (KIND_DIM[node.kind] ?? 1),
        isDustRegime(node, z) ? SHAPE_DUST : SHAPE_DISC,
      );
    }

    // ONE UPLOAD, TWO DRAWS. The span from the first glow record to the last disc goes up in a single
    // call; the unused tail of the glow half is inside it and is never drawn from.
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.uniform2f(uniform.cam, view.x, view.y);
    gl.uniform1f(uniform.zoom, z);
    gl.uniform2f(uniform.half, view.w / 2, view.h / 2);
    gl.uniform1f(uniform.dpr, dpr);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, coreAt), gl.DYNAMIC_DRAW);

    gl.enableVertexAttribArray(at.pos);
    gl.vertexAttribPointer(at.pos, 2, gl.FLOAT, false, STRIDE, 0);
    gl.enableVertexAttribArray(at.size);
    gl.vertexAttribPointer(at.size, 1, gl.FLOAT, false, STRIDE, 8);
    gl.enableVertexAttribArray(at.color);
    gl.vertexAttribPointer(at.color, 4, gl.FLOAT, false, STRIDE, 12);
    gl.enableVertexAttribArray(at.shape);
    gl.vertexAttribPointer(at.shape, 1, gl.FLOAT, false, STRIDE, 28);
    gl.enable(gl.BLEND);

    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, glowAt / FLOATS);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, coreStart, (coreAt - coreStart * FLOATS) / FLOATS);

    return leftovers;
  };

  const resize = (): void => {
    gl.viewport(0, 0, canvas.width, canvas.height);
  };

  const clear = (): void => {
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  };

  const dispose = (): void => {
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
  };

  return { draw, resize, clear, dispose };
}
