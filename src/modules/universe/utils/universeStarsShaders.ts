/**
 * THE TWO PROGRAMS THE GPU STAR LAYER RUNS — the handoff's own sources, carried here verbatim.
 *
 * ONE POINT PER RECORD, AND EVERY STAR IS A POINT. The vertex stage places a world position through
 * the camera and sizes the sprite in DEVICE pixels, which is why the ratio is a uniform of its own:
 * a `gl_PointSize` is measured in the bitmap's pixels, not in the CSS box's. The fragment stage
 * carves the sprite's shape out of the point's own square, so one draw call carries a glow, a disc
 * and a dust speck alike, selected by the record's shape.
 *
 * THE ONE TUNABLE IS THE GAUSSIAN'S 4.0. The 2D path blits a pre-baked radial sprite whose colour
 * stops are fractions of its side (`SPRITE_PLATEAU`, `SPRITE_FADE` in `universeSky`); the shader
 * evaluates the same falloff as a gaussian, and the constant is what matches the two. Higher is
 * tighter: it is the one number to move if a star reads softer or harder on the GPU than on the
 * canvas, and it is measured by flipping the Renderer tweak on the same view.
 *
 * THE OUTPUT IS PREMULTIPLIED, AND THE BLEND IS CHOSEN TO MATCH IT. `rgb * a` beside `a` is the
 * premultiplied form, which is what the glow pass wants under `ONE, ONE` and what the disc pass
 * wants under `ONE, ONE_MINUS_SRC_ALPHA`. Emitting straight alpha into either would put a dark
 * halo around every star — the classic symptom, and the reason the rule is written down here
 * rather than in the layer that blends.
 *
 * The shapes the fragment stage branches on: 0 a soft glow, 1 a disc, 2 a ring with a centre dot
 * (the export's test files — kept for the form's sake, no kind in this build uses it), 3 a dust
 * point. `starGeometry` is what decides a node's shape and its numbers; this file only paints it.
 */

export const STARS_VERTEX_SOURCE = `
    attribute vec2 aPos;      // world x,y
    attribute float aSize;    // radius in WORLD units
    attribute vec4 aColor;    // rgb + alpha (straight alpha)
    attribute float aShape;   // 0 = soft glow, 1 = hard disc, 2 = ring (test files), 3 = dust point
    uniform vec2 uCam; uniform float uZoom; uniform vec2 uHalf; uniform float uDpr;
    varying vec4 vColor; varying float vShape;
    void main() {
      vec2 s = (aPos - uCam) * uZoom;                 // screen px, origin centre
      gl_Position = vec4(s.x / uHalf.x, -s.y / uHalf.y, 0.0, 1.0);
      gl_PointSize = max(1.0, aSize * 2.0 * uZoom * uDpr);
      vColor = aColor; vShape = aShape;
    }`;

export const STARS_FRAGMENT_SOURCE = `
    precision mediump float;
    varying vec4 vColor; varying float vShape;
    void main() {
      vec2 p = gl_PointCoord * 2.0 - 1.0; float d = length(p);
      float a;
      if (vShape < 0.5)      a = exp(-d * d * 4.0) * (1.0 - smoothstep(0.7, 1.0, d));        // glow: gaussian falloff
      else if (vShape < 1.5) a = 1.0 - smoothstep(0.85, 1.0, d);                               // disc
      else if (vShape < 2.5) a = (1.0 - smoothstep(0.85, 1.0, d)) * smoothstep(0.55, 0.7, d)    // ring …
                               + (1.0 - smoothstep(0.35, 0.5, d));                             // … with centre dot
      else                   a = 1.0 - smoothstep(0.6, 1.0, d);                                // dust point
      gl_FragColor = vec4(vColor.rgb * vColor.a * a, vColor.a * a);                            // premultiplied
    }`;
