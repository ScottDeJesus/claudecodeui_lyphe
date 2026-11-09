// Her face's instrument: the Astrolabe visualizer drawn into a square, without React. CompanionAvatar makes one per face and calls
// `frame` on every animation frame with what she is doing; this file owns the canvases, the WebGL core and every motion constant.
//
// THREE TIERS, by the square's size (CompanionAvatar chooses): `disc` (her button) is one 2D canvas, the breathing loop round a chrome
// core drawn from the chrome ramp; `core` adds the raymarched ferrofluid core in WebGL between a back and a front canvas; `dial` (the
// station's portrait) is the whole rig: the core inside two armillary rings (their back halves behind it, their front halves over it),
// the loop, a bezel and the reticle that slews to where she is looking and locks.
//
// EVERYTHING IS READ FROM TOKENS. Colours come from tokens.css's custom properties on the host (the signal colours of her material, the
// ground, the accent, the warn dot, the chrome ramp), re-read a few times a second and eased, so a theme switch or a new material
// crossfades as the visualizer did. Nothing here hard-codes a colour of the system.
//
// MOTION CONSTANTS are the design system's (its brand book's Motion section): envelopes 16/75 ms (RMS) … 8/50 ms (high band); state eases
// 70 ms in / 200 ms out (thinking), 160 ms (speaking), 250 ms (listening); the lock spring ω = 2π·2.2, ζ = 0.62; the lobes ω = 2π·2.3,
// ζ = 0.36; reduced motion runs drift and rotation at 0.35×.

import type { AstrolabeFrameInput, AstrolabeInstrument, AstrolabeTier, CompanionMaterial } from '@/shared/types';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
/** Reduced motion: drift, rotation and ripple run at this fraction of their speed. */
const REDUCED_MOTION_RATE = 0.35;
/** How often the palette is read back from the tokens (a theme or material change crossfades within this). */
const PALETTE_READ_MS = 400;

type Rgb = [number, number, number];
type Vec3 = [number, number, number];

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (current: number, target: number, dt: number, tau: number) => current + (target - current) * (1 - Math.exp(-dt / Math.max(1e-4, tau)));
const follow = (current: number, target: number, dt: number, attack: number, release: number) => ease(current, target, dt, target > current ? attack : release);
const wrapPi = (a: number) => {
  let x = (a + Math.PI) % TAU;
  if (x < 0) x += TAU;
  return x - Math.PI;
};
const norm3 = (p: Vec3): Vec3 => {
  const length = Math.hypot(p[0], p[1], p[2]) || 1;
  return [p[0] / length, p[1] / length, p[2] / length];
};
const rgba = (c: Rgb, alpha: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${clamp(alpha, 0, 1).toFixed(3)})`;
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------- palette: the tokens, parsed ---------------- */

type Palette = {
  ground: Rgb;
  signalA: Rgb;
  signalB: Rgb;
  loop: Rgb;
  halo: Rgb;
  accent: Rgb;
  quiet: Rgb;
  warn: Rgb;
  chrome: [Rgb, Rgb, Rgb, Rgb, Rgb];
  mono: string;
  light: boolean;
};

let colourProbe: CanvasRenderingContext2D | null = null;
/** Any CSS colour the tokens hold (hex, rgb(), rgba()) as an RGB triple, through the canvas's own parser. */
function parseColour(value: string, fallback: string): Rgb {
  if (!colourProbe) {
    const probe = document.createElement('canvas');
    probe.width = 1;
    probe.height = 1;
    colourProbe = probe.getContext('2d');
  }
  if (!colourProbe) return [0, 0, 0];
  colourProbe.fillStyle = '#000000';
  colourProbe.fillStyle = value.trim() || fallback;
  const parsed = String(colourProbe.fillStyle);
  if (parsed.startsWith('#')) {
    const n = parseInt(parsed.slice(1, 7), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const parts = /rgba?\(([^)]+)\)/.exec(parsed)?.[1].split(',').map(parseFloat) ?? [0, 0, 0];
  return [parts[0], parts[1], parts[2]];
}

function luminance(c: Rgb): number {
  const channel = (x: number) => {
    const v = x / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
}

/** The palette of `material` as the host's tokens declare it now (Mercury reads the plain `--signal-*`; the others their own). */
function readPalette(host: HTMLElement, material: CompanionMaterial): Palette {
  const style = getComputedStyle(host);
  const token = (name: string, fallback: string) => parseColour(style.getPropertyValue(`--${name}`), fallback);
  const prefix = material === 'mercury' ? '' : `${material}-`;
  const ground = token('canvas', '#08090b');
  return {
    ground,
    signalA: token(`${prefix}signal-a`, '#f2a65a'),
    signalB: token(`${prefix}signal-b`, '#9ed3e6'),
    loop: token(`${prefix}signal-loop`, '#ecf2f7'),
    halo: token(`${prefix}signal-halo`, '#96b4cd'),
    accent: token(material === 'mercury' ? 'accent' : material, '#f2a65a'),
    quiet: token('ink-mid', '#c9ced3'),
    warn: token('warn-dot', '#e8c45a'),
    chrome: [token('chrome-highlight', '#ffffff'), token('chrome-light', '#dce1e6'), token('chrome-mid', '#8c939b'), token('chrome-dark', '#3b4046'), token('chrome-rim', '#b9c1c9')],
    mono: style.getPropertyValue('--font-mono').trim() || '"Geist Mono", ui-monospace, monospace',
    light: luminance(ground) > 0.4,
  };
}

const PALETTE_COLOURS = ['ground', 'signalA', 'signalB', 'loop', 'halo', 'accent', 'quiet', 'warn'] as const;

/** Eases the drawn palette toward the tokens' (a theme switch or a new material crossfades over about 180 ms). */
function easePalette(drawn: Palette, target: Palette, dt: number): void {
  for (const key of PALETTE_COLOURS) {
    for (let i = 0; i < 3; i++) drawn[key][i] = ease(drawn[key][i], target[key][i], dt, 0.18);
  }
  drawn.chrome = target.chrome;
  drawn.mono = target.mono;
  drawn.light = target.light;
}

const clonePalette = (p: Palette): Palette => ({
  ...p,
  ground: [...p.ground],
  signalA: [...p.signalA],
  signalB: [...p.signalB],
  loop: [...p.loop],
  halo: [...p.halo],
  accent: [...p.accent],
  quiet: [...p.quiet],
  warn: [...p.warn],
});

/* ---------------- the core: raymarched ferrofluid in WebGL1 ---------------- */

const CORE_VERTEX = 'attribute vec2 aP;varying vec2 vUv;void main(){vUv=aP;gl_Position=vec4(aP,0.0,1.0);}';
/** The visualizer's fragment shader, verbatim, with one addition: by day (`uDay`) the halo blends as a tint instead of adding light. */
const CORE_FRAGMENT = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;
uniform float uTime, uR, uBound, uSpikeH, uSpikeB, uSpikeN, uBreath, uThink, uHalo, uEnergy, uPx, uStepK, uFlow, uDay;
uniform vec3 uL0, uL1, uL2, uLA, uLK, uW, uCA, uCB, uHaloC;
uniform vec4 uS0, uS1, uS2, uS3, uSA;
uniform mat3 uSpin;
uniform int uSteps;
const float PI = 3.14159265;
const float PHI = 1.61803399;
float h11(float x) { return fract(sin(x * 127.1 + 311.7) * 43758.5453); }
float smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }
float shockW(vec3 n, vec4 s, float a) {
  float x = acos(clamp(dot(n, s.xyz), -1.0, 1.0)) - s.w * 2.2;
  return a * exp(-x * x * 55.0) * cos(x * 22.0);
}
float crestW(vec3 n, vec4 s, float a) {
  float x = acos(clamp(dot(n, s.xyz), -1.0, 1.0)) - s.w * 2.2;
  return a * exp(-x * x * 900.0);
}
float box(vec3 r, vec3 d, vec2 hs, float soft) {
  vec3 u = normalize(cross(d, vec3(0.0, 1.0, 0.0)));
  vec3 v = cross(u, d);
  float c = dot(r, d);
  if (c <= 0.0) return 0.0;
  vec2 q = abs(vec2(dot(r, u), dot(r, v)) / c);
  vec2 e = vec2(1.0) - smoothstep(hs - soft, hs, q);
  return e.x * e.y;
}
float field(vec3 n) {
  return uLA.x * pow(max(dot(n, uL0), 0.0), uLK.x) + uLA.y * pow(max(dot(n, uL1), 0.0), uLK.y) + uLA.z * pow(max(dot(n, uL2), 0.0), uLK.z);
}
float disp(vec3 n) {
  float d = uBreath * (sin(3.1 * n.x + uTime * 0.71) * sin(2.7 * n.y - uTime * 0.53) * sin(3.3 * n.z + uTime * 0.47) + 0.5 * sin(5.3 * n.y + 1.7 * n.x + uTime * 1.13));
  if (uThink > 0.003) d += uThink * 0.011 * sin(17.0 * n.x + uTime * 9.0) * sin(19.0 * n.y - uTime * 8.0) * sin(15.0 * n.z + uTime * 7.0);
  if (uFlow > 0.0005) d += uFlow * sin(2.3 * n.x + uTime * 1.9 + 1.7 * sin(1.3 * n.y + uTime * 0.7)) * sin(2.9 * n.y - uTime * 1.4 + 1.1 * sin(1.7 * n.z - uTime * 0.9)) * sin(2.1 * n.z + uTime * 1.1);
  d += field(n);
  if (uSA.x > 0.0005) d += shockW(n, uS0, uSA.x);
  if (uSA.y > 0.0005) d += shockW(n, uS1, uSA.y);
  if (uSA.z > 0.0005) d += shockW(n, uS2, uSA.z);
  if (uSA.w > 0.0005) d += shockW(n, uS3, uSA.w);
  return d;
}
/* Ferrofluid spikes: true cone SDFs on a spherical Fibonacci lattice (nearest 4 lattice points),
   rising from the lobed surface and fused to it with a smooth-min meniscus. */
float spikes(vec3 p, vec3 n, float d) {
  vec3 pl = uSpin * n;
  float N = uSpikeN;
  float m = 1.0 - 1.0 / N;
  float ph = min(atan(pl.y, pl.x), PI);
  float z = pl.z;
  float k = max(2.0, floor(log(N * PI * sqrt(5.0) * max(1e-6, 1.0 - z * z)) / log(PHI * PHI)));
  float fk = pow(PHI, k) / sqrt(5.0);
  vec2 F = vec2(floor(fk + 0.5), floor(fk * PHI + 0.5));
  vec2 bz = -2.0 * F / N;
  vec2 bp = 2.0 * PI * (fract((F + 1.0) * PHI) - (PHI - 1.0));
  float det = bp.x * bz.y - bp.y * bz.x;
  mat2 inv = mat2(bz.y, -bz.x, -bp.y, bp.x) / det;
  vec2 c = floor(inv * vec2(ph, z - m));
  for (int s = 0; s < 4; s++) {
    vec2 o = vec2(mod(float(s), 2.0), floor(float(s) * 0.5));
    float i = dot(F, c + o);
    if (i < 0.0 || i > N - 1.0) continue;
    float a = 2.0 * PI * fract(i * PHI);
    float cz = m - 2.0 * i / N;
    float sz = sqrt(max(0.0, 1.0 - cz * cz));
    vec3 q = vec3(cos(a) * sz, sin(a) * sz, cz) * uSpin;
    /* spikes grow only where the body is pulled out into a mound, tallest at its crest */
    float g0 = pow(max(dot(q, uL0), 0.0), uLK.x), g1 = pow(max(dot(q, uL1), 0.0), uLK.y), g2 = pow(max(dot(q, uL2), 0.0), uLK.z);
    float e0 = max(uLA.x, 0.0) * g0, e1 = max(uLA.y, 0.0) * g1, e2 = max(uLA.z, 0.0) * g2;
    float ext = e0 + e1 + e2;
    float mask = max(smoothstep(0.01, 0.05, uLA.x) * smoothstep(0.35, 0.85, g0), max(smoothstep(0.01, 0.05, uLA.y) * smoothstep(0.35, 0.85, g1), smoothstep(0.01, 0.05, uLA.z) * smoothstep(0.35, 0.85, g2)));
    if (mask < 0.02) continue;
    float H = uR * uSpikeH * pow(mask, 0.6) * (0.72 + 0.28 * h11(i)) * (0.9 + 0.1 * sin(uTime * 6.0 - i * 2.3));
    if (H < 0.0004) continue;
    vec3 lm = normalize(uL0 * e0 + uL1 * e1 + uL2 * e2 + q * 1e-3);
    vec3 ax = normalize(mix(q, lm, 0.22 * mask));
    vec3 pb = p - q * (uR * (1.0 + ext - 0.015));
    float t = dot(pb, ax);
    float rho = length(pb - t * ax);
    float b = max(H * uSpikeB, 1e-4);
    vec2 w = vec2(rho, t - H);
    vec2 v = normalize(vec2(b, -H));
    float dc = dot(w, v) < 0.0 ? length(w) : dot(w, vec2(-v.y, v.x));
    dc = max(dc, -0.3 * uR - t);
    d = smin(d, dc, 0.6 * b + 0.15 * H);
  }
  return d;
}
float map(vec3 p) {
  float r = length(p);
  vec3 n = p / max(r, 1e-4);
  float d = r - uR * (1.0 + disp(n));
  if (uSpikeH > 0.006) {
    /* only pay for the spike lattice near a mound that is actually extruding */
    float near = max(step(0.01, uLA.x) * pow(max(dot(n, uL0), 0.0), uLK.x), max(step(0.01, uLA.y) * pow(max(dot(n, uL1), 0.0), uLK.y), step(0.01, uLA.z) * pow(max(dot(n, uL2), 0.0), uLK.z)));
    if (near > 0.15) d = spikes(p, n, d);
  }
  return d;
}
vec3 nrm(vec3 p) {
  const vec2 e = vec2(1.0, -1.0);
  float h = 0.0012;
  return normalize(e.xyy * map(p + e.xyy * h) + e.yyx * map(p + e.yyx * h) + e.yxy * map(p + e.yxy * h) + e.xxx * map(p + e.xxx * h));
}
float crest(vec3 n) {
  float c = 0.0;
  if (uSA.x > 0.0005) c += crestW(n, uS0, uSA.x);
  if (uSA.y > 0.0005) c += crestW(n, uS1, uSA.y);
  if (uSA.z > 0.0005) c += crestW(n, uS2, uSA.z);
  if (uSA.w > 0.0005) c += crestW(n, uS3, uSA.w);
  return c * 8.0;
}
vec3 env(vec3 r) {
  float key = box(r, normalize(vec3(-0.42, 0.55, 0.72)), vec2(0.34, 0.15), 0.06) * 2.2;
  float kick = box(r, normalize(vec3(0.62, -0.28, 0.73)), vec2(0.09, 0.3), 0.05) * 0.55;
  float top = smoothstep(0.86, 0.98, r.y) * 0.6;
  float hz = exp(-abs(r.y + 0.04) * 14.0) * 0.07;
  float ra = pow(max(dot(r, normalize(vec3(-0.98, -0.12, -0.1))), 0.0), 5.0);
  float rb = pow(max(dot(r, normalize(vec3(0.98, 0.02, -0.12))), 0.0), 5.0);
  return vec3(key + kick + top + hz) + uCA * ra * 0.95 + uCB * rb * 0.95;
}
/* Polished chrome: a studio sky/ground split with a crisp horizon, softboxes and dark rims for metallic contrast. */
vec3 envChrome(vec3 r) {
  float hy = r.y + 0.1;
  float sky = mix(0.58, 1.0, smoothstep(0.0, 0.85, hy));
  float gnd = mix(0.36, 0.12, smoothstep(0.0, -0.8, hy));
  float b = mix(gnd, sky, smoothstep(-0.012, 0.012, hy));
  b *= mix(1.0, 0.6, smoothstep(0.1, -0.6, r.z));
  float key = box(r, normalize(vec3(-0.42, 0.55, 0.72)), vec2(0.34, 0.15), 0.05) * 1.6;
  float strip = box(r, normalize(vec3(0.78, 0.12, 0.6)), vec2(0.05, 0.5), 0.02) * 1.3;
  float strip2 = box(r, normalize(vec3(-0.85, 0.2, 0.2)), vec2(0.05, 0.5), 0.02) * 0.9;
  float kick = box(r, normalize(vec3(-0.7, -0.05, -0.7)), vec2(0.06, 0.4), 0.02) * 0.9;
  float glow = exp(-abs(hy) * 14.0);
  vec3 c = vec3(b + key + strip + strip2 + kick);
  return c + uCA * 0.22 * glow * smoothstep(0.25, -0.65, r.x) + uCB * 0.22 * glow * smoothstep(-0.25, 0.65, r.x);
}
vec3 shChrome(vec3 r, float ndv, float cr) {
  vec3 F = mix(vec3(0.76, 0.78, 0.81), vec3(1.0), pow(1.0 - ndv, 5.0));
  return envChrome(r) * F * 1.05 + vec3(1.0) * cr;
}
vec3 shTube(vec3 n, vec3 r, float ndv, vec3 pos, float cr) {
  float fr = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
  vec3 glow = uCA * (0.07 + 0.42 * pow(ndv, 1.4)) * (0.55 + 0.9 * uEnergy);
  float y = pos.y / uR;
  float fx = 0.07 * sin(y * 8.0 + uTime * 1.4) * (0.35 + uEnergy);
  float dx = abs(pos.x / uR - fx);
  float fil = exp(-dx * 34.0) * (1.0 - smoothstep(0.38, 0.66, abs(y))) * (0.4 + 1.5 * uEnergy);
  vec3 c = glow * (1.0 - fr) + uCA * fil * 1.2 * (1.0 - fr) + vec3(1.0, 0.88, 0.7) * fil * fil * 0.5;
  return c + env(r) * fr * vec3(1.0, 0.84, 0.62) * 1.1 + vec3(1.0, 0.86, 0.66) * cr;
}
vec3 shWire(vec3 sn, float ndv, float dsp, float cr) {
  vec3 q = uSpin * sn;
  float lat = asin(clamp(q.y, -1.0, 1.0));
  float lon = atan(q.z, q.x);
  float aa = uPx / (uR * max(ndv, 0.2));
  float st = PI / 14.0;
  float la = abs(fract(lat / st + 0.5) - 0.5) * st;
  float lo = abs(fract(lon / st + 0.5) - 0.5) * st * cos(lat);
  float g = max(1.0 - smoothstep(0.0, aa * 1.1, la), 1.0 - smoothstep(0.0, aa * 1.1, lo));
  float cd = abs(fract(dsp * 24.0 + 0.5) - 0.5);
  float ct = (1.0 - smoothstep(0.03, 0.09, cd)) * smoothstep(0.045, 0.09, dsp);
  float fr = pow(1.0 - ndv, 2.5);
  return vec3(0.003, 0.01, 0.014) + uCA * g * (0.35 + 0.5 * ndv) + uCB * ct * 0.9 + uCA * fr * 0.6 + uCB * cr * 1.2;
}
void main() {
  vec2 p2 = vUv;
  float rr2 = dot(p2, p2);
  float rl = sqrt(rr2);
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  float b2 = uBound * uBound;
  if (rr2 < b2) {
    float zE = sqrt(b2 - rr2);
    vec3 ro = vec3(p2, zE);
    vec3 rd = vec3(0.0, 0.0, -1.0);
    float t = 0.0;
    float tEnd = 2.0 * zE;
    float dmin = 1e3;
    float d = 1.0;
    bool hit = false;
    for (int i = 0; i < 120; i++) {
      if (i >= uSteps) break;
      d = map(ro + rd * t);
      dmin = min(dmin, d);
      if (d < 0.0005) { hit = true; break; }
      t += max(d * uStepK, 0.0004);
      if (t > tEnd) break;
    }
    if (!hit && d < 0.004 && t <= tEnd) hit = true;
    if (hit) {
      vec3 pos = ro + rd * t;
      vec3 n = nrm(pos);
      float ndv = clamp(n.z, 0.0, 1.0);
      vec3 r = reflect(rd, n);
      float pl = length(pos);
      vec3 sn = pos / pl;
      float dsp = pl / uR - 1.0;
      float cr = crest(sn);
      vec3 c = vec3(0.0);
      if (uW.x > 0.002) c += uW.x * shChrome(r, ndv, cr);
      if (uW.y > 0.002) c += uW.y * shTube(n, r, ndv, pos, cr);
      if (uW.z > 0.002) c += uW.z * shWire(sn, ndv, dsp, cr);
      col = 1.0 - exp(-c * 1.25);
      alpha = 1.0;
    } else {
      float e = 1.0 - smoothstep(0.0, uPx * 1.5, dmin);
      col = mix(uHaloC * 0.6, vec3(0.6, 0.63, 0.67), uW.x) * e;
      alpha = e;
    }
  }
  float halo = uHalo * exp(-max(rl - uR, 0.0) / (0.1 * uR)) * (1.0 - smoothstep(0.86, 1.0, rl));
  /* by day the halo blends as a tint instead of adding light */
  col += uHaloC * halo * mix(1.0, 0.25, uDay) * (1.0 - alpha);
  alpha = alpha + halo * 0.25 * (1.0 - alpha);
  gl_FragColor = vec4(col, alpha);
}
`;
const CORE_UNIFORMS = ['uFlow', 'uLK', 'uTime', 'uR', 'uBound', 'uSpikeH', 'uSpikeB', 'uSpikeN', 'uBreath', 'uThink', 'uHalo', 'uEnergy', 'uPx', 'uStepK', 'uL0', 'uL1', 'uL2', 'uLA', 'uW', 'uCA', 'uCB', 'uHaloC', 'uS0', 'uS1', 'uS2', 'uS3', 'uSA', 'uSpin', 'uSteps', 'uDay'] as const;
type CoreUniforms = Partial<Record<(typeof CORE_UNIFORMS)[number], number | readonly number[] | Float32Array>>;

/** The spin of the spike lattice about a fixed tilted axis. */
function spinMatrix(angle: number): Float32Array {
  const ux = 0.28;
  const uy = 0.94;
  const uz = 0.19;
  const length = Math.hypot(ux, uy, uz);
  const x = ux / length;
  const y = uy / length;
  const z = uz / length;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return new Float32Array([t * x * x + c, t * x * y + s * z, t * x * z - s * y, t * x * y - s * z, t * y * y + c, t * y * z + s * x, t * x * z + s * y, t * y * z - s * x, t * z * z + c]);
}

type CoreGl = { draw: (uniforms: CoreUniforms) => void; destroy: () => void; lost: () => boolean };

/** The core's GL program on `canvas`, or null where the browser has no WebGL (the 2D chrome core stands in). */
function createCoreGl(canvas: HTMLCanvasElement): CoreGl | null {
  const options: WebGLContextAttributes = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' };
  const gl = (canvas.getContext('webgl', options) ?? canvas.getContext('experimental-webgl', options)) as WebGLRenderingContext | null;
  if (!gl) return null;
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(`shader: ${gl.getShaderInfoLog(shader) ?? ''}`);
    return shader;
  };
  let isLost = false;
  let program: WebGLProgram | null = null;
  const locations = new Map<string, WebGLUniformLocation | null>();
  const build = () => {
    program = gl.createProgram();
    if (!program) throw new Error('program');
    gl.attachShader(program, compile(gl.VERTEX_SHADER, CORE_VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, CORE_FRAGMENT));
    gl.bindAttribLocation(program, 0, 'aP');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`link: ${gl.getProgramInfoLog(program) ?? ''}`);
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    locations.clear();
    for (const name of CORE_UNIFORMS) locations.set(name, gl.getUniformLocation(program, name));
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
  };
  try {
    build();
  } catch (error) {
    console.warn('[astrolabe] the core shader did not build; drawing the 2D chrome core', error);
    return null;
  }
  const onLost = (event: Event) => {
    event.preventDefault();
    isLost = true;
  };
  const onRestored = () => {
    try {
      build();
      isLost = false;
    } catch {
      // stays lost: the 2D core stands in
    }
  };
  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);
  return {
    lost: () => isLost,
    draw(uniforms) {
      if (isLost || !program) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      for (const [name, value] of Object.entries(uniforms)) {
        const location = locations.get(name);
        if (!location || value === undefined) continue;
        if (name === 'uSteps') gl.uniform1i(location, value as number);
        else if (typeof value === 'number') gl.uniform1f(location, value);
        else if (value.length === 3) gl.uniform3f(location, value[0], value[1], value[2]);
        else if (value.length === 4) gl.uniform4f(location, value[0], value[1], value[2], value[3]);
        else if (value.length === 9) gl.uniformMatrix3fv(location, false, value as Float32Array);
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    destroy() {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      try {
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      } catch {
        // already gone
      }
    },
  };
}

/* ---------------- the instrument ---------------- */

type Shock = { dir: Vec3; age: number; amp: number };
type Echo = { age: number; amp: number };
type RingNode = { a: Vec3; b: Vec3 };

function ringBasis(iota: number, omega: number) {
  const co = Math.cos(omega);
  const so = Math.sin(omega);
  const ci = Math.cos(iota);
  const si = Math.sin(iota);
  return { U: [co, so, 0] as Vec3, V: [-so * ci, co * ci, si] as Vec3 };
}
function ringPoint(basis: { U: Vec3; V: Vec3 }, radius: number, theta: number): Vec3 {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [radius * (c * basis.U[0] + s * basis.V[0]), radius * (c * basis.U[1] + s * basis.V[1]), radius * (c * basis.U[2] + s * basis.V[2])];
}
const RETICLE_CORNERS: ReadonlyArray<readonly [number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const MATERIALS: readonly CompanionMaterial[] = ['mercury', 'tube', 'wire'];

function makeCanvas(host: HTMLElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.position = 'absolute';
  canvas.style.pointerEvents = 'none';
  canvas.style.display = 'block';
  host.appendChild(canvas);
  return canvas;
}

/**
 * Used by this module's CompanionAvatar: builds her face's instrument in `host` (an empty element that React gives no children) at
 * `tier`, and returns its `frame`, `resize` and `destroy` (see `AstrolabeInstrument`).
 */
export function createAstrolabeInstrument(host: HTMLElement, tier: AstrolabeTier, initialMaterial: CompanionMaterial): AstrolabeInstrument {
  const back = tier === 'dial' ? makeCanvas(host) : null;
  const glCanvas = tier === 'disc' ? null : makeCanvas(host);
  const front = makeCanvas(host);
  const core = glCanvas ? createCoreGl(glCanvas) : null;
  if (glCanvas && !core) glCanvas.style.display = 'none';

  let size = 0;
  let material = initialMaterial;
  let targetPalette = readPalette(host, material);
  const palette = clonePalette(targetPalette);
  let paletteReadAt = 0;
  let quality = 1;
  let slowMs = 0;
  let fastMs = 0;

  // The instrument's envelopes and eases (`v`), the pointer and its lock (`dial`), the rings, the lobes and what rides out on an onset.
  const v = { t: 0, think: 0, speak: 0, listen: 0, rms: 0, low: 0, mid: 0, high: 0, energy: 0, spikeEnv: 0, f0: 0, voicing: 0, presence: 1 };
  const dial = {
    az: 1.15, azVel: 0, lockErr: 1, locked: false, acquired: false, lockAmt: 0, lockPulse: 0, sweep: 0, thinkStart: 0, wasThinking: false, target: null as number | null,
    inPsi: 0, inPsiT: 0, inOmega: 0.4, inIota: 70 * DEG, midPsi: 2, midPsiT: 2, midOmega: 2.3, midIota: 54 * DEG, pitchDev: 0, walk: 0,
  };
  const nodes: RingNode = { a: [0.6, 0.6, 0.5], b: [-0.6, 0.5, 0.6] };
  const lobes = { a: [0, 0, 0], va: [0, 0, 0], d: [norm3([0.6, 0.6, 0.5]), norm3([-0.6, 0.5, 0.6]), norm3([0.3, 0.9, 0.35])] as Vec3[], k: [5, 5, 5] };
  const materialWeights: number[] = MATERIALS.map((m) => (m === material ? 1 : 0));
  let shocks: Shock[] = [];
  let echoes: Echo[] = [];
  let spin = 0;
  let clock = 0;
  let seenOnsets = -1;
  let seenWord: string | null = null;

  const fit = (canvas: HTMLCanvasElement, cssSide: number, pixelScale: number, offset: number) => {
    const px = Math.max(1, Math.round(cssSide * pixelScale));
    if (canvas.width !== px || canvas.height !== px) {
      canvas.width = px;
      canvas.height = px;
    }
    canvas.style.width = `${cssSide}px`;
    canvas.style.height = `${cssSide}px`;
    canvas.style.left = `${offset}px`;
    canvas.style.top = `${offset}px`;
  };
  const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
  const begin2d = (canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const scale = canvas.width / Math.max(1, size);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    return ctx;
  };

  /** The geometry of the square: loop radius `Ro`, core radius `R` and the GL canvas's side, by tier. */
  const geometry = () => {
    if (tier === 'dial') {
      const Ro = Math.max(40, size / 2 - 44);
      return { Ro, R: Ro / 2.3, glSide: 2 * Ro };
    }
    if (tier === 'core') {
      const R = size / 5.4;
      return { Ro: 2.3 * R, R, glSide: 4.6 * R };
    }
    return { Ro: size * 0.42, R: size * 0.25, glSide: 0 };
  };

  const resize = (next: number) => {
    size = Math.max(16, Math.round(next));
    const scale = dpr();
    if (back) fit(back, size, scale, 0);
    fit(front, size, scale, 0);
    if (glCanvas && core) {
      const { glSide } = geometry();
      const side = Math.round(glSide);
      const px = Math.max(64, Math.round(side * Math.min(scale, 1.5) * quality));
      if (glCanvas.width !== px) {
        glCanvas.width = px;
        glCanvas.height = px;
      }
      glCanvas.style.width = `${side}px`;
      glCanvas.style.height = `${side}px`;
      glCanvas.style.left = `${Math.round((size - side) / 2)}px`;
      glCanvas.style.top = `${Math.round((size - side) / 2)}px`;
    }
  };

  /** The loop: one ring whose radius ripples with the formant bands; it breaks into turning dashes while she thinks. */
  const drawLoop = (ctx: CanvasRenderingContext2D, cx: number, cy: number, Ro: number, colour: Rgb, solo: boolean, rate: number) => {
    const sp = v.speak;
    const th = v.think;
    const gm = solo ? 2.2 : 1;
    const a3 = (0.004 + 0.013 * v.low * gm) * sp + 0.012 * v.listen * v.rms;
    const a7 = 0.007 * v.mid * sp * gm;
    const a17 = 0.003 * v.high * sp * gm;
    const breath = 0.004 * Math.sin(v.t * 0.9 * rate) * (1 - sp);
    const t = v.t * rate;
    ctx.beginPath();
    for (let i = 0; i <= 240; i++) {
      const a = (i / 240) * TAU;
      const rr = Ro * (1 + breath + a3 * Math.sin(3 * a + t * 0.7) + a7 * Math.sin(7 * a - t * 1.3) + a17 * Math.sin(17 * a + t * 2.3));
      const x = cx + rr * Math.cos(a);
      const y = cy - rr * Math.sin(a);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.closePath();
    // Small faces scale the dash and the glow with the square, so the disc reads as the same instrument at 56 px.
    const scale = clamp(size / 300, 0.3, 1);
    const gap = th * 16 * scale;
    if (gap > 0.6 * scale) {
      ctx.setLineDash([Math.max(3 * scale, (26 - th * 8) * scale), gap]);
      ctx.lineDashOffset = -dial.sweep * 60 * scale;
    } else ctx.setLineDash([]);
    const base = solo ? 1.8 : 1.25;
    const width = (base + (solo ? 5 : 2.4) * v.low * sp + (solo ? 2.4 : 1.1) * v.mid * sp + 1.2 * v.rms * v.listen) * Math.max(0.7, scale);
    const glow = (0.5 + 0.5 * sp + 0.3 * v.listen) * (palette.light ? 0.5 : 1);
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(colour, 0.045 * glow);
    ctx.lineWidth = width + 14 * scale;
    ctx.stroke();
    ctx.strokeStyle = rgba(colour, 0.09 * glow);
    ctx.lineWidth = width + 6 * scale;
    ctx.stroke();
    ctx.strokeStyle = rgba(colour, 0.16 * glow);
    ctx.lineWidth = width + 2.5 * scale;
    ctx.stroke();
    ctx.strokeStyle = rgba(colour, 0.62 + 0.33 * Math.max(sp, th, v.listen));
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.setLineDash([]);
  };

  /** A walk's progress: an accent arc over the loop from twelve o'clock, clockwise, and its count under the core (core and dial). */
  const drawWalk = (ctx: CanvasRenderingContext2D, cx: number, cy: number, Ro: number, walk: AstrolabeFrameInput['walk']) => {
    if (!walk) return;
    const filled = walk.total > 0 ? clamp(walk.at / walk.total, 0, 1) : 0;
    dial.walk = lerp(dial.walk, filled, 0.18);
    const width = Math.max(1.5, size / 120);
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(palette.quiet, 0.18);
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(cx, cy, Ro + width * 2.5, 0, TAU);
    ctx.stroke();
    if (dial.walk > 0.001) {
      ctx.strokeStyle = rgba(palette.accent, 0.95);
      ctx.beginPath();
      ctx.arc(cx, cy, Ro + width * 2.5, -Math.PI / 2, -Math.PI / 2 + TAU * dial.walk);
      ctx.stroke();
    }
    if (tier !== 'disc') {
      const text = `${walk.at}/${walk.total}`;
      const fontPx = clamp(size / 22, 10, 13);
      ctx.font = `500 ${fontPx}px ${palette.mono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const w = ctx.measureText(text).width;
      const y = cy + Ro * 0.62;
      ctx.fillStyle = rgba(palette.ground, 0.8);
      ctx.fillRect(cx - w / 2 - 6, y - fontPx * 0.8, w + 12, fontPx * 1.6);
      ctx.fillStyle = rgba(palette.accent, 0.95);
      ctx.fillText(text, cx, y);
    }
  };

  /** The pointer: a small triangle outside the loop where she is looking (disc and core), in the lead signal colour. */
  const drawPointer = (ctx: CanvasRenderingContext2D, cx: number, cy: number, Ro: number) => {
    if (dial.target === null && dial.lockAmt < 0.02) return;
    const c = Math.cos(dial.az);
    const s = -Math.sin(dial.az);
    const px = -s;
    const py = c;
    const scale = clamp(size / 260, 0.35, 1);
    const r0 = Ro + 6 * scale + 2;
    const r1 = r0 + 9 * scale + 2;
    const half = 4.5 * scale + 1;
    ctx.beginPath();
    ctx.moveTo(cx + c * r0, cy + s * r0);
    ctx.lineTo(cx + c * r1 + px * half, cy + s * r1 + py * half);
    ctx.lineTo(cx + c * r1 - px * half, cy + s * r1 - py * half);
    ctx.closePath();
    ctx.fillStyle = rgba(palette.signalA, 0.92 * Math.max(dial.lockAmt, dial.target === null ? 0 : 0.6));
    ctx.fill();
  };

  /** The 2D chrome core: the Mercury ramp in a breathing outline (the disc tier, and where WebGL is missing). */
  const drawChromeCore = (ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number) => {
    const k = 1 + 0.06 * v.rms * v.speak - 0.03 * v.listen + 0.02 * v.think * Math.sin(v.t * 9);
    ctx.beginPath();
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * TAU;
      const rr = R * k * (1 + 0.018 * Math.sin(3 * a + clock) + 0.012 * Math.sin(5 * a - clock * 1.3) + 0.08 * v.low * v.speak * Math.pow(Math.max(0, Math.cos(a - dial.az)), 4));
      const x = cx + rr * Math.cos(a);
      const y = cy - rr * Math.sin(a);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    const gradient = ctx.createRadialGradient(cx - R * 0.38, cy - R * 0.42, R * 0.04, cx, cy, R * 1.05);
    const [c1, c2, c3, c4, c5] = palette.chrome;
    const tint = material === 'mercury' ? null : palette.accent;
    const mix = (c: Rgb, amount: number): Rgb => (tint ? [lerp(c[0], tint[0], amount), lerp(c[1], tint[1], amount), lerp(c[2], tint[2], amount)] : c);
    gradient.addColorStop(0, rgba(mix(c1, 0.1), 1));
    gradient.addColorStop(0.16, rgba(mix(c2, 0.25), 1));
    gradient.addColorStop(0.5, rgba(mix(c3, 0.35), 1));
    gradient.addColorStop(0.8, rgba(mix(c4, 0.3), 1));
    gradient.addColorStop(0.94, rgba(mix(c5, 0.2), 1));
    gradient.addColorStop(1, rgba(palette.accent, 0.6));
    ctx.fillStyle = gradient;
    ctx.fill();
  };

  const frame = (dt: number, input: AstrolabeFrameInput) => {
    if (size === 0) return;
    const now = performance.now();
    const rm = reducedMotion() ? REDUCED_MOTION_RATE : 1;
    const asleepRate = input.asleep ? 0.5 : 1;
    const rate = rm * asleepRate;
    if (input.material !== material) {
      material = input.material;
      paletteReadAt = 0;
    }
    if (now - paletteReadAt > PALETTE_READ_MS) {
      paletteReadAt = now;
      try {
        targetPalette = readPalette(host, material);
      } catch {
        // keep the last palette
      }
    }
    easePalette(palette, targetPalette, dt);

    // State eases and envelopes: features move the instrument only while she speaks or listens.
    const state = input.state;
    const thinking = state === 'thinking';
    v.t += dt * asleepRate;
    clock += dt * rate;
    v.think = ease(v.think, thinking ? 1 : 0, dt, thinking ? 0.07 : 0.2);
    v.speak = ease(v.speak, state === 'speaking' ? 1 : 0, dt, 0.16);
    v.listen = ease(v.listen, state === 'listening' ? 1 : 0, dt, 0.25);
    v.presence = ease(v.presence, input.asleep ? 0.55 : 1, dt, 0.4);
    const heard = (state === 'speaking' || state === 'listening') && input.voice ? input.voice : null;
    v.rms = follow(v.rms, heard ? heard.rms : 0, dt, 0.012, 0.075);
    v.low = follow(v.low, heard ? heard.low : 0, dt, 0.02, 0.12);
    v.mid = follow(v.mid, heard ? heard.mid : 0, dt, 0.015, 0.09);
    v.high = follow(v.high, heard ? heard.high : 0, dt, 0.006, 0.05);
    v.voicing = follow(v.voicing, heard ? heard.voicing : 0, dt, 0.02, 0.07);
    if (heard && heard.f0 > 0) v.f0 = heard.f0;
    v.energy = ease(v.energy, v.rms, dt, 0.12);
    v.spikeEnv = follow(v.spikeEnv, v.rms, dt, 0.035, 0.3);

    // Onsets: a hard consonant sends a shock across the core and, when strong, an echo ring out from it.
    if (input.voice) {
      if (seenOnsets >= 0 && input.voice.onsets > seenOnsets && heard) {
        const amp = input.voice.onsetAmp || 0.6;
        const a = Math.random() * TAU;
        const b = Math.acos(lerp(0.25, 0.95, Math.random()));
        shocks.push({ dir: [Math.sin(b) * Math.cos(a), Math.sin(b) * Math.sin(a), Math.cos(b)], age: 0, amp });
        if (shocks.length > 4) shocks.shift();
        if (amp > 0.55) {
          echoes.push({ age: 0, amp });
          if (echoes.length > 5) echoes.shift();
        }
        dial.inPsiT += 0.28;
      }
      seenOnsets = input.voice.onsets;
    }
    if (input.word !== seenWord) {
      if (input.word) dial.midPsiT += 0.52;
      seenWord = input.word;
    }
    for (const s of shocks) s.age += dt;
    for (const e of echoes) e.age += dt;
    shocks = shocks.filter((s) => s.age < 1.3);
    echoes = echoes.filter((e) => e.age < 0.95);

    // The pointer: sweeps for the first 42% of the anticipation window, springs to where she looks, locks; drifts with no target.
    if (thinking && !dial.wasThinking) dial.thinkStart = now;
    dial.wasThinking = thinking;
    const target = input.azimuth === null ? null : input.azimuth * DEG;
    if (target !== dial.target) {
      dial.target = target;
      dial.acquired = false;
    }
    const sweeping = thinking && (target === null || now - dial.thinkStart < 320 * 0.42);
    const steps = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      if (sweeping) {
        dial.azVel = lerp(dial.azVel, 7 * rate, 1 - Math.exp(-h / 0.07));
        dial.az += dial.azVel * h;
        dial.lockErr = 1;
      } else if (target !== null) {
        const err = wrapPi(target - dial.az);
        const w = TAU * 2.2;
        const z = 0.62;
        dial.azVel += (w * w * err - 2 * z * w * dial.azVel) * h;
        dial.az += dial.azVel * h;
        dial.lockErr = Math.abs(err);
      } else {
        dial.azVel = lerp(dial.azVel, 0.06 * rate, 1 - Math.exp(-h / 0.8));
        dial.az += dial.azVel * h;
        dial.lockErr = 1;
      }
    }
    dial.az = wrapPi(dial.az);
    dial.locked = target !== null && !sweeping && dial.lockErr < 0.012 && Math.abs(dial.azVel) < 0.25;
    if (dial.locked && !dial.acquired) {
      dial.acquired = true;
      dial.lockPulse = 1;
    }
    dial.lockPulse = Math.max(0, dial.lockPulse - dt * 2.2);
    dial.lockAmt = ease(dial.lockAmt, dial.locked ? 1 : 0, dt, dial.locked ? 0.07 : 0.05);
    dial.sweep += dt * 4.2 * rate;

    // The armillary rings tick with her units and words, tilt with pitch, lean in while she listens.
    dial.inPsiT += dt * (0.12 + 0.9 * v.think) * rate;
    dial.midPsiT -= dt * (0.05 + 0.5 * v.think) * rate;
    dial.inPsi = ease(dial.inPsi, dial.inPsiT, dt, 0.07);
    dial.midPsi = ease(dial.midPsi, dial.midPsiT, dt, 0.12);
    const pitchDeviation = v.f0 > 0 && v.voicing > 0.3 ? clamp((v.f0 - 190) / 190, -0.4, 0.4) : 0;
    dial.pitchDev = ease(dial.pitchDev, pitchDeviation, dt, 0.1);
    dial.inOmega += dt * (0.06 + 0.45 * v.think) * rate;
    dial.midOmega -= dt * (0.035 + 0.3 * v.think) * rate;
    dial.inIota = (70 + 5 * Math.sin(v.t * 0.31) + 8 * v.think - 16 * v.listen) * DEG;
    dial.midIota = (54 + 32 * dial.pitchDev - 18 * v.listen) * DEG;

    // The core's lobes: damped springs that swell, overshoot and settle; their directions glide after the ring nodes and the pointer.
    const sp = v.speak;
    const ls = v.listen;
    const w0 = TAU * 2.3;
    const z0 = 0.36;
    const lobeTargets = [
      0.42 * v.low * sp + 0.02 * v.think - 0.13 * v.low * ls,
      0.32 * (0.6 * v.low + 0.4 * v.mid) * sp + 0.02 * v.think - 0.09 * v.mid * ls,
      0.1 * dial.lockPulse + 0.2 * v.rms * sp + 0.05 * v.think - 0.05 * v.rms * ls,
    ];
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < 3; i++) {
        lobes.va[i] += (w0 * w0 * (lobeTargets[i] - lobes.a[i]) - 2 * z0 * w0 * lobes.va[i]) * h;
        lobes.a[i] = clamp(lobes.a[i] + lobes.va[i] * h, -0.2, 0.42);
      }
    }
    if (tier !== 'dial') {
      nodes.a = [Math.cos(0.4 + clock * 0.19) * 0.8, 0.45 + 0.3 * Math.sin(clock * 0.23), 0.5];
      nodes.b = [Math.cos(2.6 - clock * 0.13) * 0.8, 0.35 + 0.3 * Math.cos(clock * 0.17), 0.6];
    }
    const glide = 1 - Math.exp(-dt / 0.2);
    const lobeDirections: Vec3[] = [norm3([nodes.a[0], nodes.a[1], nodes.a[2] + 0.55]), norm3([nodes.b[0], nodes.b[1], nodes.b[2] + 0.55]), norm3([Math.cos(dial.az), Math.sin(dial.az), 0.35])];
    for (let i = 0; i < 3; i++) {
      const d0 = lobes.d[i];
      const d1 = lobeDirections[i];
      lobes.d[i] = norm3([lerp(d0[0], d1[0], glide), lerp(d0[1], d1[1], glide), lerp(d0[2], d1[2], glide)]);
      lobes.k[i] = 5 + 6 * clamp(Math.abs(lobes.a[i]) / 0.3, 0, 1);
    }
    spin += dt * (0.05 + 0.35 * v.energy * v.speak + 0.3 * v.think) * rate;
    const ti = MATERIALS.indexOf(material);
    for (let i = 0; i < 3; i++) {
      const goal = i === ti ? 1 : 0;
      const next = ease(materialWeights[i], goal, dt, 0.18);
      materialWeights[i] = Math.abs(next - goal) < 0.002 ? goal : next;
    }

    // ---- draw ----
    const { Ro, R } = geometry();
    const cx = size / 2;
    const cy = size / 2;
    const loopColour = input.failed ? palette.warn : palette.loop;
    host.style.opacity = v.presence.toFixed(3);

    if (back) {
      const bctx = begin2d(back);
      if (bctx) drawRingsBack(bctx, cx, cy, R, Ro);
    }
    const busy = v.think > 0.01 || v.speak > 0.01 || v.listen > 0.01 || shocks.length > 0;
    if (core && glCanvas && !core.lost()) {
      const ms = dt * 1000;
      if (busy) {
        if (ms > 24) {
          slowMs += ms;
          fastMs = 0;
        } else if (ms < 18) {
          fastMs += ms;
          slowMs = Math.max(0, slowMs - ms * 0.5);
        }
        if (slowMs > 1200 && quality > 0.5) {
          quality = Math.max(0.5, quality * 0.84);
          slowMs = 0;
          resize(size);
        }
        if (fastMs > 5000 && quality < 1) {
          quality = Math.min(1, quality * 1.12);
          fastMs = 0;
          resize(size);
        }
      }
      drawCore();
    }
    const fctx = begin2d(front);
    if (!fctx) return;
    if (!core || core.lost()) drawChromeCore(fctx, cx, cy, R);
    if (tier === 'dial') drawRingsFront(fctx, cx, cy, R, Ro);
    drawLoop(fctx, cx, cy, Ro, loopColour, tier !== 'dial', rate);
    drawWalk(fctx, cx, cy, Ro, input.walk);
    if (tier === 'dial') drawBezelAndReticle(fctx, cx, cy, R, Ro, input.label);
    else drawPointer(fctx, cx, cy, Ro);
    if (tier !== 'disc') {
      fctx.lineWidth = 1;
      for (const e of echoes) {
        const r = R * (1.08 + e.age * 2.3);
        if (r > Ro * 0.98) continue;
        fctx.beginPath();
        fctx.arc(cx, cy, r, 0, TAU);
        fctx.strokeStyle = rgba(palette.loop, e.amp * 0.24 * Math.pow(1 - e.age / 0.95, 2));
        fctx.stroke();
      }
    }
  };

  const drawCore = () => {
    if (!core || !glCanvas) return;
    // The GL square is 4.6 core radii across in every tier, so the core's radius in its own clip space is fixed.
    const uR = 2 / 4.6;
    const sp = v.speak;
    const th = v.think;
    const ls = v.listen;
    const E = v.rms;
    const LA = lobes.a;
    const se = clamp((v.spikeEnv - 0.02) / 0.3, 0, 1);
    const spikeH = 0.62 * se * se * (3 - 2 * se) * sp;
    const recent = shocks.slice(-4);
    const shockVectors: number[][] = [];
    const shockAmps = [0, 0, 0, 0];
    let shockMax = 0;
    for (let i = 0; i < 4; i++) {
      const s = recent[i];
      if (s) {
        shockVectors.push([s.dir[0], s.dir[1], s.dir[2], s.age]);
        shockAmps[i] = s.amp * 0.022 * Math.exp(-s.age * 2.6);
        shockMax = Math.max(shockMax, shockAmps[i]);
      } else shockVectors.push([0, 0, 1, 9]);
    }
    const lobeSum = Math.max(0, LA[0]) + Math.max(0, LA[1]) + Math.max(0, LA[2]);
    const lobeMag = Math.max(Math.abs(LA[0]), Math.abs(LA[1]), Math.abs(LA[2]));
    const bound = Math.min(0.985, uR * (1 + lobeSum + spikeH + 0.1 + shockMax * 1.2));
    const slope = 2.1 * lobeMag + 22 * shockMax + 0.15;
    const toUnit = (c: Rgb) => [c[0] / 255, c[1] / 255, c[2] / 255];
    core.draw({
      uTime: clock, uR, uBound: bound, uSpikeH: spikeH, uSpikeB: 0.24, uSpikeN: 260, uBreath: 0.02 * (1 - 0.5 * sp) + 0.008, uThink: th,
      uFlow: 0.004 + 0.024 * v.energy * sp + 0.01 * th, uLK: lobes.k,
      uHalo: (0.22 + 0.8 * E * sp + 0.3 * th + 0.1 * ls) * (palette.light ? 0.7 : 1), uEnergy: E, uPx: 2 / (glCanvas.width || 1),
      uStepK: clamp(0.88 / Math.sqrt(1 + slope * slope), 0.4, 0.85),
      uL0: lobes.d[0], uL1: lobes.d[1], uL2: lobes.d[2], uLA: LA, uW: materialWeights,
      uCA: toUnit(palette.signalA), uCB: toUnit(palette.signalB), uHaloC: toUnit(palette.halo),
      uS0: shockVectors[0], uS1: shockVectors[1], uS2: shockVectors[2], uS3: shockVectors[3], uSA: shockAmps, uSpin: spinMatrix(spin),
      uSteps: quality > 0.9 ? 96 : quality > 0.7 ? 80 : 64, uDay: palette.light ? 1 : 0,
    });
  };

  /** The armillary rings, split at the image plane: `front` false draws what passes behind the core, true what passes over it. */
  const drawRings = (ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, front: boolean) => {
    const rings = [
      { r: R * 1.42, iota: dial.inIota, omega: dial.inOmega, psi: dial.inPsi, colour: palette.signalB, key: 'a' as const, pull: v.low },
      { r: R * 1.8, iota: dial.midIota, omega: dial.midOmega, psi: dial.midPsi, colour: palette.signalA, key: 'b' as const, pull: 0.6 * v.low + 0.4 * v.mid, label: seenWord },
    ];
    for (const ring of rings) {
      const basis = ringBasis(ring.iota, ring.omega);
      ctx.beginPath();
      let previous: boolean | null = null;
      for (let i = 0; i <= 144; i++) {
        const p = ringPoint(basis, ring.r, (i / 144) * TAU);
        const x = cx + p[0];
        const y = cy - p[1];
        const isFront = p[2] >= 0;
        if (isFront === front) {
          if (previous !== front) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        previous = isFront;
      }
      ctx.strokeStyle = rgba(ring.colour, front ? 0.62 : 0.2);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      for (let k = 0; k < 24; k++) {
        const theta = ring.psi + (k * TAU) / 24;
        const p1 = ringPoint(basis, ring.r, theta);
        if (p1[2] >= 0 !== front) continue;
        const p2 = ringPoint(basis, ring.r * (k % 6 === 0 ? 1.07 : 1.04), theta);
        ctx.moveTo(cx + p1[0], cy - p1[1]);
        ctx.lineTo(cx + p2[0], cy - p2[1]);
      }
      ctx.strokeStyle = rgba(ring.colour, front ? 0.55 : 0.18);
      ctx.stroke();
      const node = ringPoint(basis, ring.r, ring.psi);
      const length = Math.hypot(node[0], node[1], node[2]) || 1;
      nodes[ring.key] = [node[0] / length, node[1] / length, node[2] / length];
      if (node[2] >= 0 !== front) continue;
      const x = cx + node[0];
      const y = cy - node[1];
      const pull = ring.pull * v.speak;
      if (pull > 0.02) {
        const sc = (R * 1.04) / length;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(cx + node[0] * sc, cy - node[1] * sc);
        ctx.strokeStyle = rgba(ring.colour, (front ? 0.5 : 0.18) * pull);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(x, y, front ? 3 : 2.2, 0, TAU);
      ctx.fillStyle = rgba(ring.colour, front ? 0.95 : 0.35);
      ctx.fill();
      if (front && 'label' in ring && ring.label && v.speak > 0.1) {
        ctx.font = `500 10px ${palette.mono}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const width = ctx.measureText(ring.label).width;
        ctx.fillStyle = rgba(palette.ground, 0.8);
        ctx.fillRect(x + 5, y - 16, width + 8, 14);
        ctx.fillStyle = rgba(ring.colour, 0.92);
        ctx.fillText(ring.label, x + 9, y - 9);
      }
    }
  };
  const drawRingsBack = (ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, Ro: number) => {
    // The guides: two faint circles beyond the loop and the scale either side, the instrument's printed face.
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(palette.loop, 0.06);
    ctx.beginPath();
    ctx.arc(cx, cy, Ro * 1.12, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    for (const side of [-1, 1]) {
      for (let i = 0; i <= 6; i++) {
        const x = cx + side * (Ro + 10 + i * 4);
        const tick = i % 3 === 0 ? 4 : 2;
        ctx.moveTo(x, cy - tick);
        ctx.lineTo(x, cy + tick);
      }
    }
    ctx.strokeStyle = rgba(palette.loop, 0.14);
    ctx.stroke();
    drawRings(ctx, cx, cy, R, false);
  };
  const drawRingsFront = (ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, Ro: number) => {
    drawRings(ctx, cx, cy, R, true);
    // The sweep: a conic flare that turns while she thinks.
    if (v.think > 0.02 && typeof ctx.createConicGradient === 'function') {
      const sweep = ctx.createConicGradient(-dial.sweep, cx, cy);
      sweep.addColorStop(0, rgba(palette.signalA, 0.16 * v.think));
      sweep.addColorStop(0.09, rgba(palette.signalA, 0));
      sweep.addColorStop(1, rgba(palette.signalA, 0));
      ctx.fillStyle = sweep;
      ctx.beginPath();
      ctx.arc(cx, cy, Ro, 0, TAU);
      ctx.arc(cx, cy, R * 1.05, 0, TAU, true);
      ctx.fill();
    }
  };
  /** The bezel (ticks, dots, the azimuth pointer) and, when she looks somewhere, the reticle and its plate. */
  const drawBezelAndReticle = (ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, Ro: number, label: string | null) => {
    ctx.beginPath();
    for (let k = 0; k < 72; k++) {
      if (k % 6 === 0) continue;
      const a = dial.az + (k * TAU) / 72;
      const c = Math.cos(a);
      const s = -Math.sin(a);
      ctx.moveTo(cx + c * (Ro + 17), cy + s * (Ro + 17));
      ctx.lineTo(cx + c * (Ro + 22), cy + s * (Ro + 22));
    }
    ctx.strokeStyle = rgba(palette.loop, 0.26);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = rgba(palette.loop, 0.62);
    for (let k = 0; k < 12; k++) {
      const a = dial.az + (k * TAU) / 12;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * (Ro + 20), cy - Math.sin(a) * (Ro + 20), 1.6, 0, TAU);
      ctx.fill();
    }
    const c = Math.cos(dial.az);
    const s = -Math.sin(dial.az);
    ctx.beginPath();
    ctx.moveTo(cx + c * (Ro + 29), cy + s * (Ro + 29));
    ctx.lineTo(cx + c * (Ro + 39) - s * 5, cy + s * (Ro + 39) + c * 5);
    ctx.lineTo(cx + c * (Ro + 39) + s * 5, cy + s * (Ro + 39) - c * 5);
    ctx.closePath();
    ctx.fillStyle = rgba(palette.signalA, 0.92);
    ctx.fill();
    if (dial.target === null) return;
    const target = dial.target;
    const ca = Math.cos(dial.az);
    const sa = Math.sin(dial.az);
    const mx = cx + ca * Ro;
    const my = cy - sa * Ro;
    const err = wrapPi(target - dial.az);
    ctx.lineWidth = 1;
    if (Math.abs(err) > 0.02) {
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.arc(cx, cy, Ro + 8, -dial.az, -(dial.az + err), err > 0);
      ctx.strokeStyle = rgba(palette.signalA, 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(target) * Ro, cy - Math.sin(target) * Ro, 4, 0, TAU);
      ctx.strokeStyle = rgba(palette.signalA, 0.7);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx + ca * (Ro - 8), cy - sa * (Ro - 8));
    ctx.lineTo(cx + ca * R * 1.18, cy - sa * R * 1.18);
    ctx.strokeStyle = rgba(palette.signalA, 0.1 + 0.35 * dial.lockPulse + 0.12 * dial.lockAmt);
    ctx.stroke();
    const reach = lerp(17, 9, dial.lockAmt) + 6 * dial.lockPulse;
    const arm = 5;
    ctx.beginPath();
    for (const [sx, sy] of RETICLE_CORNERS) {
      const x = mx + sx * reach;
      const y = my + sy * reach;
      ctx.moveTo(x - sx * arm, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y - sy * arm);
    }
    ctx.strokeStyle = rgba(palette.signalA, 0.95);
    ctx.lineWidth = 1.25;
    ctx.stroke();
    const line1 = (label ?? 'Target').toUpperCase();
    const line2 = `AZ ${(((dial.az / DEG) + 360) % 360).toFixed(1)}° · ${dial.locked ? 'LOCK' : 'SLEW'}`;
    ctx.font = `500 10px ${palette.mono}`;
    ctx.textBaseline = 'middle';
    const width = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width);
    const place = (radius: number, inside: boolean) => {
      const align: CanvasTextAlign = ca > 0.3 ? (inside ? 'right' : 'left') : ca < -0.3 ? (inside ? 'left' : 'right') : 'center';
      const lx = cx + ca * radius;
      const rawY = cy - sa * radius;
      const ly = clamp(rawY, 20, size - 20);
      const bx = align === 'left' ? lx : align === 'right' ? lx - width : lx - width / 2;
      const shift = clamp(bx, 6, size - 6 - width) - bx;
      return { align, lx: lx + shift, ly, bx: bx + shift, off: Math.abs(shift) > 2 || rawY < 20 || rawY > size - 20 };
    };
    let plate = place(Ro + 58, false);
    if (plate.off) plate = place(Ro - 50, true);
    ctx.textAlign = plate.align;
    ctx.fillStyle = rgba(palette.ground, 0.8);
    ctx.fillRect(plate.bx - 6, plate.ly - 16, width + 12, 32);
    ctx.fillStyle = rgba(palette.signalA, 0.95);
    ctx.fillText(line1, plate.lx, plate.ly - 7);
    ctx.fillStyle = rgba(palette.quiet, 0.88);
    ctx.fillText(line2, plate.lx, plate.ly + 7);
  };

  return {
    frame,
    resize,
    destroy() {
      core?.destroy();
      for (const canvas of [back, glCanvas, front]) canvas?.remove();
    },
  };
}
