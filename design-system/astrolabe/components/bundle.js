/* @ds-bundle: {"format":4,"namespace":"Astrolabe","components":[{"name":"Rings"},{"name":"Track"},{"name":"Core"},{"name":"Orbit"},{"name":"ArcGauge"},{"name":"SignalLoop"},{"name":"Spinner"},{"name":"Scene"},{"name":"Opening"},{"name":"Arrival"},{"name":"Sheet"},{"name":"Summon"},{"name":"Key"},{"name":"Trace"},{"name":"Steps"},{"name":"Roster"},{"name":"Excerpt"},{"name":"KeyValueList"},{"name":"ReadoutRow"},{"name":"Readout"},{"name":"BufferGauge"},{"name":"Badge"},{"name":"Reticle"},{"name":"Footprint"},{"name":"YourWords"},{"name":"Prepared"},{"name":"Stream"},{"name":"Exchange"},{"name":"Choice"},{"name":"Status"},{"name":"Plate"},{"name":"Rule"},{"name":"Transcript"},{"name":"Notice"},{"name":"Button"},{"name":"ToggleButton"},{"name":"FileButton"},{"name":"SegmentedControl"},{"name":"TextField"},{"name":"Select"},{"name":"Switch"},{"name":"Fader"},{"name":"Composer"},{"name":"Files"},{"name":"Questions"},{"name":"Form"},{"name":"ToolRow"},{"name":"Prose"},{"name":"Rail"},{"name":"Meter"},{"name":"Dock"},{"name":"Icon"}]} */
/* Astrolabe — components for a voice instrument. Needs React 18 as window.React. Reads its colours, spaces and type from tokens.css. */
(function () {
  'use strict';
  var React = window.React;
  var h = React.createElement, useRef = React.useRef, useEffect = React.useEffect, useState = React.useState, useMemo = React.useMemo, useContext = React.useContext;
  var TAU = Math.PI * 2, DEG = Math.PI / 180, MINUS = '−';
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(c, t, dt, tau) { return c + (t - c) * (1 - Math.exp(-dt / Math.max(1e-4, tau))); }
  function follow(c, t, dt, att, rel) { return ease(c, t, dt, t > c ? att : rel); }
  function wrapPi(a) { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; }
  function norm3(p) { var L = Math.hypot(p[0], p[1], p[2]) || 1; return [p[0] / L, p[1] / L, p[2] / L]; }
  function seeded(seed) { var s = seed >>> 0; return function () { s = (s + 0x6D2B79F5) >>> 0; var t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function cx() { var out = []; for (var i = 0; i < arguments.length; i++) if (arguments[i]) out.push(arguments[i]); return out.join(' '); }
  function rgba(c, a) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + clamp(a, 0, 1).toFixed(3) + ')'; }
  function signed(x, d) { return (x < 0 ? MINUS : '+') + Math.abs(x).toFixed(d); }
  var NOTE = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  function noteName(f) { if (!(f > 20)) return '—'; var m = 69 + 12 * Math.log2(f / 440), r = Math.round(m), c = Math.round((m - r) * 100); return NOTE[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1) + ' ' + (c < 0 ? MINUS : '+') + Math.abs(c) + '¢'; }
  var reducedMotion = function () { try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } };
  var STATES = { idle: 1, thinking: 1, bridging: 1, speaking: 1, listening: 1, reading: 1, writing: 1 };
  function normState(s) { return s === 'dispatching' ? 'writing' : STATES[s] ? s : 'idle'; }

  /* ---------- colours from tokens (CSS custom properties), parsed once per refresh ---------- */
  var _cc = null;
  function parseColor(str, fb) {
    if (!_cc) { var c = document.createElement('canvas'); c.width = c.height = 1; _cc = c.getContext('2d'); }
    var s = (str || '').trim() || fb;
    _cc.fillStyle = '#000000'; _cc.fillStyle = s;
    var v = String(_cc.fillStyle);
    if (v[0] === '#') { var n = parseInt(v.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]; }
    var m = /rgba?\(([^)]+)\)/.exec(v);
    if (!m) return [0, 0, 0, 1];
    var p = m[1].split(',').map(parseFloat);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  function lum(c) { var f = function (x) { x /= 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); }
  var PAL_KEYS = [['ground', 'ground', '#08090b'], ['a', 'signal-a', '#f2a65a'], ['b', 'signal-b', '#9ed3e6'], ['loop', 'signal-loop', '#ecf2f7'], ['halo', 'signal-halo', '#96b4cd'], ['accent', 'accent', '#f2a65a'], ['quiet', 'ink-quiet', '#c9ced3'], ['c1', 'chrome-highlight', '#ffffff'], ['c2', 'chrome-light', '#dce1e6'], ['c3', 'chrome-mid', '#8c939b'], ['c4', 'chrome-dark', '#3b4046'], ['c5', 'chrome-rim', '#b9c1c9'], ['ink', 'ink', '#eef1f4'], ['muted', 'ink-muted', '#959da6'], ['danger', 'danger-dot', '#ff7b6b'], ['warn', 'warn-dot', '#e6c15a']];
  function readPalette(el) {
    var cs = getComputedStyle(el), P = {};
    for (var i = 0; i < PAL_KEYS.length; i++) { var k = PAL_KEYS[i]; P[k[0]] = parseColor(cs.getPropertyValue('--' + k[1]), k[2]); }
    P.mono = (cs.getPropertyValue('--font-mono') || '').trim() || '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
    P.plate = parseFloat(cs.getPropertyValue('--opacity-plate')) || 0.8;
    var mat = (cs.getPropertyValue('--ast-material') || '').trim();
    P.material = mat === 'tube' || mat === 'wire' || mat === 'plasma' ? mat : 'mercury';
    P.light = lum(P.ground) > 0.4;
    return P;
  }
  /* A palette that eases toward the tokens (persona and theme changes crossfade over ~0.18 s, as in the instrument). */
  function LivePalette(el) { this.el = el; this.t = readPalette(el); this.c = JSON.parse(JSON.stringify(this.t)); this.at = 0; }
  LivePalette.prototype.step = function (now, dt) {
    if (now - this.at > 400) { this.at = now; try { this.t = readPalette(this.el); } catch (e) { /* keep */ } }
    var t = this.t, c = this.c, moving = false;
    for (var i = 0; i < PAL_KEYS.length; i++) {
      var k = PAL_KEYS[i][0];
      for (var j = 0; j < 3; j++) { var nv = ease(c[k][j], t[k][j], dt, 0.18); if (Math.abs(nv - t[k][j]) < 0.5) nv = t[k][j]; else moving = true; c[k][j] = nv; }
    }
    c.mono = t.mono; c.plate = t.plate; c.material = t.material; c.light = t.light;
    return moving;
  };

  /* ---------- the signal: rms / low / mid / high / f0 / voicing / onsets / words / units ---------- */
  function blankFeatures() { return { rms: 0, low: 0, mid: 0, high: 0, f0: 0, voicing: 0, onsets: 0, onsetAmp: 0, words: 0, units: 0, unit: '', word: '', wordIndex: -1, phase: 'idle' }; }

  /* Live analysis of an AnalyserNode — the instrument's own: AGC'd bands, a noise gate, spectral-flux onsets, YIN pitch. */
  function analyserSource(an) {
    var sr = (an.context && an.context.sampleRate) || 48000;
    try { an.fftSize = 2048; an.smoothingTimeConstant = 0; an.minDecibels = -100; an.maxDecibels = -10; } catch (e) { /* keep caller's settings */ }
    var td = new Float32Array(an.fftSize), fd = new Float32Array(an.frequencyBinCount), prev = new Float32Array(an.frequencyBinCount);
    var dec = new Float32Array(1024), yin = new Float32Array(512);
    var agc = { low: 0.02, mid: 0.02, high: 0.004, rms: 0.04 }, fluxAvg = 0, fluxVar = 0, lastShock = 0, noise = 0.002, fr = 0, lastP = null, silentFor = 1;
    var F = blankFeatures(), last = 0;
    function pitch() {
      var D = sr > 32000 ? 2 : 1, x = dec, N = Math.min(x.length, Math.floor(td.length / D));
      for (var i = 0; i < N; i++) x[i] = D === 2 ? 0.5 * (td[2 * i] + td[2 * i + 1]) : td[i];
      var s = sr / D, minLag = Math.max(2, Math.floor(s / 420)), W = 320, d = yin;
      var maxLag = Math.min(Math.floor(s / 72), N - W - 2, yin.length - 2), run = 0, best = -1, tau, j;
      d[0] = 1;
      for (tau = 1; tau <= maxLag + 1; tau++) { var sum = 0; for (j = 0; j < W; j++) { var v = x[j] - x[j + tau]; sum += v * v; } run += sum; d[tau] = run > 0 ? (sum * tau) / run : 1; }
      for (tau = minLag; tau <= maxLag; tau++) { if (d[tau] < 0.15) { while (tau + 1 <= maxLag && d[tau + 1] < d[tau]) tau++; best = tau; break; } }
      if (best < 0) { var mn = 1, mt = -1; for (tau = minLag; tau <= maxLag; tau++) if (d[tau] < mn) { mn = d[tau]; mt = tau; } if (mn < 0.3 && mt > 0) best = mt; else return { f0: 0, conf: clamp(1 - mn, 0, 1) * 0.5 }; }
      var a = d[best - 1], b = d[best], c = d[best + 1], den = a + c - 2 * b, shift = Math.abs(den) > 1e-9 ? (0.5 * (a - c)) / den : 0;
      return { f0: s / (best + clamp(shift, -1, 1)), conf: clamp(1 - b, 0, 1) };
    }
    return function read() {
      var now = performance.now();
      if (now - last < 5) return F;
      var dt = clamp((now - (last || now - 16)) / 1000, 0.001, 0.1); last = now;
      an.getFloatTimeDomainData(td);
      var ss = 0, i;
      for (i = 0; i < td.length; i++) ss += td[i] * td[i];
      var rms = Math.sqrt(ss / td.length);
      an.getFloatFrequencyData(fd);
      var binHz = sr / an.fftSize, lo = 0, mi = 0, hi = 0, flux = 0;
      for (i = 1; i < fd.length; i++) {
        var db = fd[i], mag = db > -160 ? Math.pow(10, db / 20) : 0, f = i * binHz;
        if (f >= 70 && f < 350) lo += mag * mag; else if (f >= 350 && f < 2500) mi += mag * mag; else if (f >= 3500 && f < 10000) hi += mag * mag;
        if (f >= 2500) { var dd = mag - prev[i]; if (dd > 0) flux += dd; }
        prev[i] = mag;
      }
      lo = Math.sqrt(lo); mi = Math.sqrt(mi); hi = Math.sqrt(hi);
      var dk = Math.exp(-dt / 4);
      agc.low = Math.max(agc.low * dk, lo, 1e-4); agc.mid = Math.max(agc.mid * dk, mi, 1e-4); agc.high = Math.max(agc.high * dk, hi, 1e-5); agc.rms = Math.max(agc.rms * dk, rms, 0.01);
      noise = rms < noise ? lerp(noise, rms, 0.2) : lerp(noise, rms, 0.002);
      var gate = clamp((rms - noise * 1.8) / (noise * 4 + 0.004), 0, 1), dbfs = 20 * Math.log10(rms + 1e-9);
      var tR = clamp(0.5 * clamp((dbfs + 58) / 46, 0, 1) + 0.5 * (rms / agc.rms), 0, 1) * gate;
      var tL = clamp(lo / agc.low, 0, 1) * gate, tM = clamp(mi / agc.mid, 0, 1) * gate, tH = clamp(hi / agc.high, 0, 1) * gate;
      fluxAvg = lerp(fluxAvg, flux, 0.08); fluxVar = lerp(fluxVar, (flux - fluxAvg) * (flux - fluxAvg), 0.08);
      var thr = fluxAvg + 2.2 * Math.sqrt(fluxVar) + 1e-4;
      if (flux > thr && gate > 0.3 && now - lastShock > 85) { lastShock = now; F.onsets++; F.units++; F.onsetAmp = clamp((flux - thr) / (thr + 1e-6), 0.25, 1); }
      fr++;
      if (fr % 2 === 0 || !lastP) lastP = pitch();
      var tF = lastP.f0 > 0 && gate > 0.2 ? lastP.f0 : 0;
      if (tR > 0.12) { if (silentFor > 0.3) F.words++; silentFor = 0; } else silentFor += dt;
      F.rms = follow(F.rms, tR, dt, 0.016, 0.075); F.low = follow(F.low, tL, dt, 0.028, 0.12); F.mid = follow(F.mid, tM, dt, 0.02, 0.09); F.high = follow(F.high, tH, dt, 0.008, 0.05);
      if (tF > 0) F.f0 = F.f0 > 0 ? ease(F.f0, tF, dt, 0.028) : tF;
      F.voicing = follow(F.voicing, tF > 0 ? lastP.conf : 0, dt, 0.02, 0.07);
      F.dbfs = dbfs; F.measured = true; F.phase = tR > 0.05 ? 'speech' : 'pause';
      return F;
    };
  }

  /* A synthetic, voice-shaped signal for previews and empty states: it "speaks" the instrument's own line on a loop.
     Never present it as measured telemetry. */
  var DEMO_LINE = "If I am the voice speaking, I don't want to pretend I have lungs, teeth, or a jawline. I want you to see the architecture of how I actually exist.";
  var CLS = { V: [0.8, 0.64, 0.12, 1], N: [0.46, 0.8, 0.05, 1], L: [0.52, 0.56, 0.1, 1], P: [0.52, 0.16, 0.8, 0], S: [0.3, 0.04, 0.96, 0], F: [0.22, 0.06, 0.48, 0] };
  function consClass(ch) { if (/[ptkbdgcqx]/.test(ch)) return 'P'; if (/[szj]/.test(ch)) return 'S'; if (/[fvh]/.test(ch)) return 'F'; if (/[mn]/.test(ch)) return 'N'; if (/[lrwy]/.test(ch)) return 'L'; return null; }
  function buildDemo(text) {
    var words = text.split(/\s+/).filter(Boolean), segs = [], t = 0.9, rnd = seeded(5), wi, sylT;
    for (wi = 0; wi < words.length; wi++) {
      var raw = words[wi], w = raw.toLowerCase().replace(/[^a-z']/g, ''), sy = w.match(/[^aeiouy]*[aeiouy]+(?:[^aeiouy]*$)?/g) || [w || 'a'];
      for (var si = 0; si < sy.length; si++) {
        var chunk = sy[si], c0 = chunk[0], cls = consClass(c0), dur = clamp(0.085 + 0.034 * chunk.length, 0.12, 0.3) * (0.9 + 0.2 * rnd());
        var acc = si === 0 && w.length > 3 ? 1 : 0;
        sylT = t;
        if (cls) { var cd = cls === 'P' ? 0.055 : 0.075; segs.push({ t0: t, t1: t + cd, c: cls, amp: 0.8 + 0.2 * rnd(), wi: wi, onset: cls === 'P' ? 0.9 : cls === 'S' ? 0.7 : 0, g: c0 }); t += cd; }
        var vv = (chunk.match(/[aeiouy]+/) || ['a'])[0];
        segs.push({ t0: t, t1: t + dur, c: 'V', amp: 0.7 + 0.3 * rnd() + 0.15 * acc, wi: wi, acc: acc, g: vv, syl: sylT });
        t += dur;
      }
      t += /[.?!]$/.test(raw) ? 0.42 : /[,;:]$/.test(raw) ? 0.2 : 0.035;
    }
    return { words: words, segs: segs, end: t, loop: t + 1.1 };
  }
  function demoSource() {
    var D = buildDemo(DEMO_LINE), F = blankFeatures(), last = 0, idx = 0, lastLoop = -1, seenOn = -1, seenW = -1, seenU = -1;
    var read = function () {
      var now = performance.now();
      if (now - last < 5) return F;
      var dt = clamp((now - (last || now - 16)) / 1000, 0.001, 0.1); last = now;
      var T = now / 1000, loopN = Math.floor(T / D.loop), t = T - loopN * D.loop;
      if (loopN !== lastLoop) { lastLoop = loopN; idx = 0; seenOn = -1; seenW = -1; seenU = -1; }
      while (idx < D.segs.length - 1 && D.segs[idx].t1 <= t) idx++;
      var S = D.segs[idx], tR = 0, tL = 0, tM = 0, tH = 0, tF = 0, voi = 0;
      if (S && t >= S.t0 && t < S.t1) {
        var k = CLS[S.c], u = (t - S.t0) / (S.t1 - S.t0), env = Math.sin(Math.PI * clamp(u, 0, 1)) * (S.c === 'P' ? (u < 0.25 ? 1.3 : 0.6) : 1);
        tR = k[0] * S.amp * env; tL = k[1] * S.amp * env; tH = k[2] * S.amp * env; tM = (0.35 + 0.4 * (S.c === 'V' ? 1 : 0.3)) * S.amp * env;
        if (k[3]) { var pos = S.t0 / D.end, base = 205 - 80 * pos; tF = base * (1 + 0.1 * (S.acc || 0) * Math.sin(Math.PI * u)); voi = 0.9; }
        if (S.onset && idx !== seenOn) { seenOn = idx; F.onsets++; F.onsetAmp = S.onset; }
        if (idx !== seenU) { seenU = idx; F.units++; F.unit = '⟨' + S.g + '⟩'; }
        if (S.wi !== seenW) { seenW = S.wi; F.words++; F.wordIndex = S.wi; F.word = D.words[S.wi].toLowerCase().replace(/[^a-z']/g, ''); }
      }
      F.phase = t < D.end ? (t < 0.9 ? (t < 0.5 ? 'idle' : 'thinking') : 'speech') : 'pause';
      if (F.phase !== 'speech') { F.wordIndex = t >= D.end ? D.words.length : -1; F.unit = ''; F.word = ''; }
      F.rms = follow(F.rms, tR, dt, 0.016, 0.075); F.low = follow(F.low, tL, dt, 0.028, 0.12); F.mid = follow(F.mid, tM, dt, 0.02, 0.09); F.high = follow(F.high, tH, dt, 0.008, 0.05);
      if (tF > 0) F.f0 = F.f0 > 0 ? ease(F.f0, tF, dt, 0.028) : tF;
      F.voicing = follow(F.voicing, tF > 0 ? voi : 0, dt, 0.02, 0.07);
      return F;
    };
    read.words = D.words; read.text = DEMO_LINE; read.demo = true;
    /* the state a preview should show right now: idle → thinking (pre-roll) → speaking → idle */
    read.state = function () { var p = read().phase; return p === 'speech' ? 'speaking' : p === 'thinking' ? 'thinking' : 'idle'; };
    return read;
  }
  var demoSignal = demoSource();

  function createSignal(source) {
    if (typeof source === 'function') return source;
    if (source === 'demo') return demoSignal;
    if (source && typeof source.getFloatTimeDomainData === 'function') return analyserSource(source);
    var F = blankFeatures();
    if (source && typeof source === 'object') for (var k in source) F[k] = source[k];
    return function () { return F; };
  }
  function useSignal(signal) { return useMemo(function () { return signal == null ? null : createSignal(signal); }, [signal]); }

  /* Per-component envelope state: the instrument's eases and counters. */
  function Drive() {
    this.v = { t: 0, think: 0, speak: 0, listen: 0, read: 0, write: 0, rms: 0, low: 0, mid: 0, high: 0, energy: 0, spikeEnv: 0, f0: 0, voicing: 0, f0vis: 150 };
    this.seen = null; this.events = []; this.words = 0; this.units = 0; this.unit = ''; this.word = '';
  }
  Drive.prototype.step = function (dt, state, read) {
    var v = this.v, F = read ? read() : null, live = state === 'speaking' || state === 'listening';
    var thinking = state === 'thinking' || state === 'bridging';
    v.t += dt;
    v.think = ease(v.think, thinking ? 1 : 0, dt, thinking ? 0.07 : 0.2);
    v.speak = ease(v.speak, state === 'speaking' ? 1 : 0, dt, 0.16);
    v.listen = ease(v.listen, state === 'listening' ? 1 : 0, dt, 0.25);
    v.read = ease(v.read, state === 'reading' ? 1 : 0, dt, 0.22);
    v.write = ease(v.write, state === 'writing' ? 1 : 0, dt, 0.14);
    var g = live && F;
    v.rms = follow(v.rms, g ? F.rms : 0, dt, 0.012, 0.075); v.low = follow(v.low, g ? F.low : 0, dt, 0.02, 0.12);
    v.mid = follow(v.mid, g ? F.mid : 0, dt, 0.015, 0.09); v.high = follow(v.high, g ? F.high : 0, dt, 0.006, 0.05);
    v.voicing = follow(v.voicing, g ? F.voicing : 0, dt, 0.02, 0.07);
    if (g && F.f0 > 0) { v.f0 = F.f0; v.f0vis = ease(v.f0vis, F.f0, dt, 0.15); }
    v.energy = ease(v.energy, v.rms, dt, 0.12);
    v.spikeEnv = follow(v.spikeEnv, v.rms, dt, 0.035, 0.3);
    if (F) {
      if (!this.seen) this.seen = { o: F.onsets, w: F.words, u: F.units };
      if (live) {
        if (F.onsets > this.seen.o) this.events.push(F.onsetAmp || 0.6);
        if (F.words > this.seen.w) this.words += Math.min(4, F.words - this.seen.w);
        if (F.units > this.seen.u) this.units += Math.min(6, F.units - this.seen.u);
        this.unit = F.unit || ''; this.word = F.word || '';
      } else { this.unit = ''; this.word = ''; }
      this.seen.o = F.onsets; this.seen.w = F.words; this.seen.u = F.units;
    }
    if (this.events.length > 8) this.events.splice(0, this.events.length - 8);
    return F;
  };

  /* rAF loop bound to an element: pauses offscreen and in hidden tabs. */
  function useFrame(ref, fn) {
    var cb = useRef(fn);
    cb.current = fn;
    useEffect(function () {
      var el = ref.current, raf = 0, last = performance.now(), visible = true, alive = true, io = null;
      if (el && window.IntersectionObserver) { io = new IntersectionObserver(function (es) { visible = es.some(function (x) { return x.isIntersecting; }); }); io.observe(el); }
      function loop(now) {
        if (!alive) return;
        raf = requestAnimationFrame(loop);
        now = performance.now();
        if (!visible || document.hidden) { last = now; return; }
        var dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
        last = now;
        try { cb.current(dt, now); } catch (e) { if (!loop.err) { loop.err = true; console.error('[Astrolabe]', e); } }
      }
      raf = requestAnimationFrame(loop);
      return function () { alive = false; cancelAnimationFrame(raf); if (io) io.disconnect(); };
    }, []);
  }
  /* Canvas sizing with devicePixelRatio, observed. */
  function fitCanvas(c, w, h, dpr) { var pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr)); if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; } }
  function useBox(ref) {
    var box = useRef({ w: 0, h: 0, v: 0 });
    useEffect(function () {
      var el = ref.current;
      if (!el) return;
      var set = function () { var r = el.getBoundingClientRect(); if (r.width !== box.current.w || r.height !== box.current.h) { box.current.w = r.width; box.current.h = r.height; box.current.v++; } };
      set();
      if (!window.ResizeObserver) return;
      var ro = new ResizeObserver(set); ro.observe(el);
      return function () { ro.disconnect(); };
    }, []);
    return box;
  }

  function assign(t) { for (var i = 1; i < arguments.length; i++) { var s = arguments[i]; if (s) for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = s[k]; } return t; }
  function omit(o, keys) { var r = {}; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k) && keys.indexOf(k) < 0) r[k] = o[k]; return r; }
  function opts(list) { return (list || []).map(function (o) { return typeof o === 'object' && o !== null ? { value: String(o.value), label: o.label != null ? o.label : String(o.value), disabled: !!o.disabled } : { value: String(o), label: String(o) }; }); }

  /* ---------- Icon: the instrument's marks ---------- */
  /* A button whose mark says it carries no word: `iconOnly` keeps the word for assistive tech and as the button's title. */
  function bareWord(p) { return p.iconOnly && typeof p.children === 'string' ? p.children : undefined; }
  var ICONS = {
    play: { box: 12, size: 12, fill: true, d: [['path', { d: 'M3 1.6v8.8L10.4 6z' }]] },
    stop: { box: 12, size: 12, fill: true, d: [['rect', { x: 2, y: 2, width: 8, height: 8, rx: 1 }]] },
    mic: { box: 16, size: 14, d: [['rect', { x: 5.75, y: 1.75, width: 4.5, height: 8, rx: 2.25 }], ['path', { d: 'M3.25 7.75a4.75 4.75 0 0 0 9.5 0M8 12.5v2' }]] },
    upload: { box: 16, size: 14, d: [['path', { d: 'M8 10.5V2.5M4.75 5.75 8 2.5l3.25 3.25M2.75 10.5v3h10.5v-3' }]] },
    chevron: { box: 16, size: 14, d: [['path', { d: 'M4.75 6.5 8 9.75l3.25-3.25' }]] },
    back: { box: 16, size: 14, d: [['path', { d: 'M12.75 8H3.5M7.25 4.25 3.5 8l3.75 3.75' }]] },
    send: { box: 16, size: 14, d: [['path', { d: 'M8 12.75V3.5M4.25 7.25 8 3.5l3.75 3.75' }]] },
    /* what a session used: the marks on a ToolRow */
    terminal: { box: 16, size: 14, d: [['path', { d: 'M3 4.75 6.25 8 3 11.25M8.25 11.25H13' }]] },
    file: { box: 16, size: 14, d: [['path', { d: 'M4 1.75h5L12 4.75v9.5H4zM9 1.75v3h3' }]] },
    pencil: { box: 16, size: 14, d: [['path', { d: 'M2.75 13.25l.65-2.9 7.35-7.35 2.25 2.25-7.35 7.35zM9.5 4.25l2.25 2.25' }]] },
    search: { box: 16, size: 14, d: [['circle', { cx: 7, cy: 7, r: 4.25 }], ['path', { d: 'M10.25 10.25 13.5 13.5' }]] },
    globe: { box: 16, size: 14, d: [['circle', { cx: 8, cy: 8, r: 5.75 }], ['path', { d: 'M2.25 8h11.5M8 2.25c-2.2 2-2.2 9.5 0 11.5M8 2.25c2.2 2 2.2 9.5 0 11.5' }]] },
    tool: { box: 16, size: 14, d: [['path', { d: 'M10.4 2.5a3.3 3.3 0 0 0-3.9 4.4L2.5 10.9l2.6 2.6 4-4a3.3 3.3 0 0 0 4.4-3.9l-2 2-1.9-.5-.5-1.9z' }]] },
    thought: { box: 16, size: 14, d: [['rect', { x: 3.25, y: 2, width: 10.5, height: 7.5, rx: 3.75 }], ['circle', { cx: 5, cy: 11.6, r: 0.9 }], ['circle', { cx: 2.9, cy: 13.6, r: 0.45 }]] },
    question: { box: 16, size: 14, d: [['circle', { cx: 8, cy: 8, r: 5.75 }], ['path', { d: 'M6.3 6.4a1.75 1.75 0 1 1 2.5 1.6c-.5.3-.8.7-.8 1.25M8 11.35v.05' }]] },
    copy: { box: 16, size: 14, d: [['rect', { x: 5.5, y: 5.5, width: 8, height: 8, rx: 1.25 }], ['path', { d: 'M10.5 5.5V3.75c0-.7-.55-1.25-1.25-1.25h-5.5c-.7 0-1.25.55-1.25 1.25v5.5c0 .7.55 1.25 1.25 1.25H5.5' }]] },
    check: { box: 16, size: 14, d: [['path', { d: 'M3.5 8.5 6.5 11.5 12.5 4.75' }]] },
    /* what you add, what you put away, what you keep, and the marks the station's switches wear */
    plus: { box: 16, size: 14, d: [['path', { d: 'M8 3v10M3 8h10' }]] },
    close: { box: 16, size: 14, d: [['path', { d: 'M4 4l8 8M12 4l-8 8' }]] },
    pin: { box: 16, size: 14, d: [['path', { d: 'M9.75 2.25 13.75 6.25l-1.75.6-2.1 2.1.15 2.6-1.1 1.1-5.6-5.6 1.1-1.1 2.6.15 2.1-2.1zM5.75 10.25 2.75 13.25' }]] },
    speaker: { box: 16, size: 14, d: [['path', { d: 'M2.75 6.25h2.5L8.5 3.5v9L5.25 9.75h-2.5zM10.75 6a2.75 2.75 0 0 1 0 4M12.4 4.25a5.25 5.25 0 0 1 0 7.5' }]] },
    'speaker-off': { box: 16, size: 14, d: [['path', { d: 'M2.75 6.25h2.5L8.5 3.5v9L5.25 9.75h-2.5zM10.75 6.25l3 3.5M13.75 6.25l-3 3.5' }]] },
    trash: { box: 16, size: 14, d: [['path', { d: 'M3.25 4.5h9.5M6.5 4.5V2.75h3V4.5M4.5 4.5l.6 8.75h5.8l.6-8.75M6.9 6.9v4M9.1 6.9v4' }]] },
    chat: { box: 16, size: 14, d: [['path', { d: 'M3.75 2.75h8.5a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H7.5L4.5 13.5v-2.75h-.75a1.5 1.5 0 0 1-1.5-1.5v-5a1.5 1.5 0 0 1 1.5-1.5z' }]] },
    ear: { box: 16, size: 14, d: [['path', { d: 'M4.25 6.5a3.75 3.75 0 1 1 7.5 0c0 2.4-2.25 2.75-2.25 4.75a2.25 2.25 0 0 1-4.3.9M6.5 7a1.5 1.5 0 1 1 3 0c0 .9-.9 1.1-1.25 1.75' }]] },
    'ear-off': { box: 16, size: 14, d: [['path', { d: 'M4.25 6.5a3.75 3.75 0 1 1 7.5 0c0 2.4-2.25 2.75-2.25 4.75a2.25 2.25 0 0 1-4.3.9M2.75 2.75l10.5 10.5' }]] },
    panel: { box: 16, size: 14, d: [['rect', { x: 2.75, y: 3, width: 10.5, height: 10, rx: 1.25 }], ['path', { d: 'M2.75 6.25h10.5' }]] },
    lines: { box: 16, size: 14, d: [['path', { d: 'M3 4.5h10M3 8h10M3 11.5h6' }]] },
    menu: { box: 16, size: 14, d: [['path', { d: 'M3 4.5h10M3 8h10M3 11.5h10' }]] },
    settings: { box: 16, size: 14, d: [['path', { d: 'M6.88 3.13L7.15 1.56L8.85 1.56L9.12 3.13L10.65 3.76L11.96 2.84L13.16 4.04L12.24 5.35L12.87 6.88L14.44 7.15L14.44 8.85L12.87 9.12L12.24 10.65L13.16 11.96L11.96 13.16L10.65 12.24L9.12 12.87L8.85 14.44L7.15 14.44L6.88 12.87L5.35 12.24L4.04 13.16L2.84 11.96L3.76 10.65L3.13 9.12L1.56 8.85L1.56 7.15L3.13 6.88L3.76 5.35L2.84 4.04L4.04 2.84L5.35 3.76Z' }], ['circle', { cx: 8, cy: 8, r: 2 }]] },
    more: { box: 16, size: 14, fill: true, d: [['circle', { cx: 3.5, cy: 8, r: 1.1 }], ['circle', { cx: 8, cy: 8, r: 1.1 }], ['circle', { cx: 12.5, cy: 8, r: 1.1 }]] },
  };
  function Icon(p) {
    var I = ICONS[p.name] || ICONS.play, s = p.size || I.size;
    var attrs = { width: s, height: s, viewBox: '0 0 ' + I.box + ' ' + I.box, className: cx('ast-icon', !I.fill && 'ast-icon-stroke', p.className), style: p.style, 'aria-hidden': p.title ? undefined : 'true', role: p.title ? 'img' : undefined, focusable: 'false' };
    if (I.fill) attrs.fill = 'currentColor';
    else { attrs.fill = 'none'; attrs.stroke = 'currentColor'; attrs.strokeWidth = 1.4; attrs.strokeLinecap = 'round'; attrs.strokeLinejoin = 'round'; }
    var kids = I.d.map(function (e, i) { return h(e[0], assign({ key: i }, e[1])); });
    if (p.title) kids.unshift(h('title', { key: 't' }, p.title));
    return h('svg', attrs, kids);
  }

  /* ---------- Button ---------- */
  function Button(p) {
    var rest = omit(p, ['variant', 'active', 'icon', 'className', 'children', 'type', 'iconOnly', 'size']);
    return h('button', assign({ title: bareWord(p) }, rest, {
      type: p.type || 'button',
      className: cx('ast-btn', 'control-label', p.variant === 'primary' && 'ast-btn-primary', p.variant === 'danger' && 'ast-btn-danger', p.size === 'small' && 'ast-btn-small', p.iconOnly && p.icon && 'ast-btn-icon', p.className),
      'data-active': p.active ? 'true' : undefined,
    }), p.icon ? h(Icon, { name: p.icon }) : null, h('span', null, p.children));
  }

  /* ---------- ToggleButton ---------- */
  function ToggleButton(p) {
    var rest = omit(p, ['pressed', 'onPressedChange', 'icon', 'className', 'children', 'onClick', 'iconOnly']);
    return h('button', assign({ title: bareWord(p) }, rest, {
      type: 'button', 'aria-pressed': p.pressed ? 'true' : 'false',
      className: cx('ast-btn', 'control-label', 'ast-toggle', p.iconOnly && p.icon && 'ast-btn-icon', p.className),
      onClick: function (e) { if (p.onClick) p.onClick(e); if (p.onPressedChange && !e.defaultPrevented) p.onPressedChange(!p.pressed); },
    }), p.icon ? h(Icon, { name: p.icon }) : null, h('span', null, p.children));
  }

  /* ---------- FileButton ---------- */
  function FileButton(p) {
    var rest = omit(p, ['accept', 'onFile', 'className', 'children', 'icon', 'disabled', 'style', 'multiple', 'iconOnly']);
    return h('label', { className: cx('ast-btn', 'control-label', 'ast-file', p.iconOnly && 'ast-btn-icon', p.className), style: p.style, title: p.iconOnly ? (typeof p.children === 'string' ? p.children : 'File') : undefined, 'data-disabled': p.disabled ? 'true' : undefined },
      h(Icon, { name: p.icon || 'plus' }),
      h('span', null, p.children || 'File'),
      h('input', assign({}, rest, {
        type: 'file', className: 'ast-file-input', accept: p.accept, multiple: p.multiple, disabled: p.disabled,
        onChange: function (e) { var fl = e.target.files; if (fl && fl.length && p.onFile) p.onFile(p.multiple ? Array.prototype.slice.call(fl) : fl[0]); try { e.target.value = ''; } catch (x) { /* ignore */ } },
      })));
  }

  /* ---------- SegmentedControl ---------- */
  function SegmentedControl(p) {
    var list = opts(p.options), val = p.value != null ? String(p.value) : null, root = useRef(null), ind = useRef(null), placed = useRef(false);
    // the selection is one plate that slides between segments on the lock spring; it lands without motion the first time
    React.useLayoutEffect(function () {
      var g = root.current, plate = ind.current;
      if (!g || !plate) return;
      var b = g.querySelector('[aria-pressed="true"]');
      if (!b) { plate.style.opacity = '0'; return; }
      if (!placed.current) { plate.style.transition = 'none'; }
      plate.style.opacity = '1';
      plate.style.width = b.offsetWidth + 'px';
      plate.style.transform = 'translateX(' + b.offsetLeft + 'px)';
      if (!placed.current) { void plate.offsetWidth; plate.style.transition = ''; placed.current = true; }
    });
    /* the plate is a thing you can take hold of: drag it and it follows, let go and the nearest segment catches it */
    var drag = useRef(null);
    function segAt(x) {
      var g = root.current, bs = g ? g.querySelectorAll('.ast-seg-btn') : [], best = -1, bd = Infinity;
      for (var i = 0; i < bs.length; i++) { if (bs[i].disabled) continue; var d = Math.abs(bs[i].offsetLeft + bs[i].offsetWidth / 2 - x); if (d < bd) { bd = d; best = i; } }
      return best;
    }
    function onDown(e) {
      if (p.disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
      var g = root.current, rc = g.getBoundingClientRect();
      drag.current = { id: e.pointerId, x0: e.clientX, left: rc.left, moved: false, w: ind.current ? ind.current.offsetWidth : 0, max: g.clientWidth };
    }
    function onMove(e) {
      var d = drag.current, plate = ind.current;
      if (!d || d.id !== e.pointerId || !plate) return;
      if (!d.moved) { if (Math.abs(e.clientX - d.x0) < 5) return; d.moved = true; try { root.current.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } plate.style.transition = 'none'; root.current.setAttribute('data-held', 'true'); }
      plate.style.transform = 'translateX(' + clamp(e.clientX - d.left - d.w / 2, 0, Math.max(0, d.max - d.w)) + 'px)';
    }
    function onUp(e) {
      var d = drag.current, plate = ind.current;
      if (!d || d.id !== e.pointerId) return;
      drag.current = null;
      if (!d.moved) return;
      try { root.current.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      root.current.removeAttribute('data-held');
      var i = segAt(e.clientX - d.left), b = i >= 0 ? root.current.querySelectorAll('.ast-seg-btn')[i] : null;
      if (plate) plate.style.transition = '';
      if (b && plate) { plate.style.width = b.offsetWidth + 'px'; plate.style.transform = 'translateX(' + b.offsetLeft + 'px)'; }
      if (i >= 0 && list[i] && list[i].value !== val && p.onChange) p.onChange(list[i].value);
      /* a drag is not also a click */
      var stop = function (ev) { ev.stopPropagation(); ev.preventDefault(); };
      root.current.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(function () { if (root.current) root.current.removeEventListener('click', stop, { capture: true }); }, 0);
    }
    return h('div', { ref: root, role: 'group', 'aria-label': p.label, className: cx('ast-seg', p.className), style: p.style, onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onUp },
      h('span', { ref: ind, className: 'ast-seg-plate', 'aria-hidden': 'true' }),
      list.map(function (o) {
        var on = o.value === val;
        return h('button', {
          key: o.value, type: 'button', 'aria-pressed': on ? 'true' : 'false', disabled: o.disabled || p.disabled,
          className: 'ast-seg-btn control-label',
          onClick: function () { if (!on && p.onChange) p.onChange(o.value); },
        }, o.label);
      }));
  }

  /* ---------- TextField ---------- */
  function TextField(p) {
    var rest = omit(p, ['label', 'showLabel', 'className', 'style', 'inputRef', 'onEnter', 'onKeyDown']);
    return h('label', { className: cx('ast-field', p.className), style: p.style },
      h('span', { className: p.showLabel ? 'ast-field-label caption-caps' : 'ast-sr' }, p.label || 'Text'),
      h('input', assign({ type: 'text', autoComplete: 'off', spellCheck: false }, rest, {
        ref: p.inputRef, className: 'ast-field-input field-text',
        onKeyDown: function (e) { if (p.onKeyDown) p.onKeyDown(e); if (p.onEnter && e.key === 'Enter' && !e.defaultPrevented) { e.preventDefault(); p.onEnter(e.currentTarget.value, e); } },
      })));
  }

  /* ---------- Select ---------- */
  function Select(p) {
    var list = opts(p.options);
    var rest = omit(p, ['label', 'options', 'onChange', 'className', 'style', 'value']);
    var box = h('span', { className: 'ast-select-box' },
      h('select', assign({}, rest, {
        className: 'ast-select field-value', value: p.value != null ? String(p.value) : undefined, 'aria-label': p.label ? undefined : p['aria-label'],
        onChange: function (e) { if (p.onChange) p.onChange(e.target.value, e); },
      }), list.map(function (o) { return h('option', { key: o.value, value: o.value, disabled: o.disabled }, o.label); })),
      h(Icon, { name: 'chevron', className: 'ast-select-chev' }));
    if (!p.label) return h('span', { className: cx('ast-select-solo', p.className), style: p.style }, box);
    return h('label', { className: cx('ast-select-row', 'telemetry', p.className), style: p.style }, h('span', { className: 'ast-select-label' }, p.label), box);
  }

  /* ---------- Dock ---------- */
  function Dock(p) {
    var rest = omit(p, ['className', 'children']);
    return h('div', assign({}, rest, { className: cx('ast-dock', p.className) }), p.children);
  }

  /* ---------- KeyValueList ---------- */
  function KeyValueList(p) {
    var items = (p.items || []).map(function (it) { return Array.isArray(it) ? { label: it[0], value: it[1] } : it; }), painted = useRef(false);
    useEffect(function () { painted.current = true; }, []);
    return h('dl', { className: cx('ast-kv', 'telemetry', p.className), style: p.style },
      items.map(function (it, i) {
        // a plain value is keyed by itself, so a change re-mounts it and it ticks (accent, then ink) — the reading moved
        var plain = typeof it.value === 'string' || typeof it.value === 'number', shown = it.value == null || it.value === '' ? '—' : it.value;
        return [h('dt', { key: 'k' + i }, it.label), h('dd', { key: 'v' + i, title: typeof it.value === 'string' ? it.value : undefined }, plain ? h('span', { key: String(it.value), className: painted.current ? 'ast-tick' : undefined }, shown) : shown)];
      }));
  }

  /* ---------- Status ---------- */
  var STATE_WORD = { idle: 'Idle', thinking: 'Thinking', bridging: 'Bridging', speaking: 'Speaking', listening: 'Listening', reading: 'Reading', writing: 'Writing', playing: 'Playing' };
  function Status(p) {
    var st = p.state || 'idle', live = st !== 'idle', rest = omit(p, ['state', 'label', 'dot', 'tone', 'className']);
    return h('span', assign({}, rest, { className: cx('ast-status', 'status-word', p.className), 'data-live': live ? 'true' : 'false', 'data-tone': p.tone || undefined }),
      p.dot === false ? null : h('span', { key: live ? 'live' : 'idle', className: 'ast-status-dot', 'aria-hidden': 'true' }),
      h('span', null, p.label != null ? p.label : STATE_WORD[st] || st));
  }

  /* ---------- Readout: the one large live number ---------- */
  function fmtNum(v, d) { return typeof v === 'number' && isFinite(v) && v > 0 ? v.toFixed(d) : v == null || v === 0 ? '—' : String(v); }
  function Readout(p) {
    var d = p.decimals != null ? p.decimals : 2, read = useSignal(p.signal), root = useRef(null), num = useRef(null), note = useRef(null), tick = useRef(0), voi = useRef(0);
    var hasVal = typeof p.value === 'number' ? p.value > 0 : p.value != null && p.value !== '' && p.value !== '—';
    var v0 = p.voicing != null ? p.voicing : hasVal ? 1 : 0;
    useFrame(root, function (dt, now) {
      if (!read || !root.current) return;
      var F = read(), on = F.f0 > 20 && F.voicing > 0.3;
      voi.current = follow(voi.current, on ? F.voicing : 0, dt, 0.02, 0.07);
      root.current.style.setProperty('--voi', voi.current.toFixed(3));
      if (now - tick.current > 70) {
        tick.current = now;
        if (num.current) { num.current.textContent = F.f0 > 20 ? F.f0.toFixed(d) : '—'; num.current.style.opacity = on ? '1' : 'var(--opacity-dim)'; }
        if (note.current && p.note == null) note.current.textContent = noteName(F.f0);
      }
    });
    var align = p.align === 'start' ? 'start' : 'end';
    return h('div', { ref: root, className: cx('ast-readout', p.className), 'data-align': align, style: assign({ '--voi': String(v0) }, p.style) },
      h('div', { className: 'ast-readout-main' },
        h('span', { ref: num, className: 'ast-readout-num readout', style: { opacity: read ? undefined : hasVal && v0 > 0.3 ? 1 : 'var(--opacity-dim)' } }, read ? '—' : fmtNum(p.value, d)),
        p.unit ? h('span', { className: 'ast-v telemetry' }, p.unit) : null),
      (p.note != null || p.source != null || read) ? h('div', { className: 'ast-readout-sub telemetry' },
        h('span', { ref: note, className: 'ast-v' }, p.note != null ? p.note : read ? '—' : ''),
        p.source != null ? h('span', { className: 'ast-k' }, p.source) : null) : null);
  }

  /* ---------- BufferGauge: depth of what is queued ahead ---------- */
  function BufferGauge(p) {
    var n = p.cells || 24, on = p.filled != null ? p.filled : Math.round(clamp(+p.value || 0, 0, 1) * n), cells = [];
    for (var i = 0; i < n; i++) cells.push(h('span', { key: i, className: 'ast-cell', 'data-on': i < on ? 'true' : 'false' }));
    return h('div', { className: cx('ast-buffer', 'telemetry', p.className), style: p.style },
      h('div', { className: 'ast-cells', style: { '--n': n }, role: 'meter', 'aria-label': p.label || 'Buffer depth', 'aria-valuemin': 0, 'aria-valuemax': n, 'aria-valuenow': on }, cells),
      p.caption != null ? h('div', { className: 'ast-v' }, p.caption) : null);
  }

  /* ---------- ReadoutRow: inline label/value pairs ---------- */
  function ReadoutRow(p) {
    return h('div', { className: cx('ast-row', 'telemetry', p.className), 'data-align': p.align === 'end' ? 'end' : 'start', 'data-spacing': p.spacing === 'wide' ? 'wide' : undefined, style: p.style },
      (p.items || []).map(function (it, i) {
        it = Array.isArray(it) ? { label: it[0], value: it[1] } : it;
        return h(React.Fragment, { key: i },
          it.label != null ? h('span', { className: 'ast-k' }, it.label) : null,
          it.value != null ? h('span', { className: it.tone === 'muted' ? 'ast-k-plain' : it.tone === 'accent' ? 'ast-v-accent' : 'ast-v' }, it.value) : null);
      }));
  }

  /* ---------- Notice ---------- */
  function Notice(p) {
    var rest = omit(p, ['className', 'children']);
    return h('p', assign({ role: 'status' }, rest, { className: cx('ast-notice', 'notice', p.className) }), p.children);
  }

  /* ---------- Transcript: weight is the voice's loudness, opacity is time ---------- */
  function Transcript(p) {
    var words = typeof p.words === 'string' ? p.words.split(/\s+/).filter(Boolean) : p.words || [];
    var n = words.length, a = p.active != null ? p.active : -1, read = useSignal(p.signal), line = useRef(null);
    var mem = useRef({ key: '', w: [], a: -1, acc: 0, cnt: 0 }), M = mem.current, key = words.join(' ');
    if (M.key !== key) { M.key = key; M.w = []; M.a = -1; M.acc = 0; M.cnt = 0; }
    if (a !== M.a) { if (M.a >= 0 && M.cnt > 0) M.w[M.a] = 300 + 460 * Math.pow(M.acc / M.cnt, 0.8); M.a = a; M.acc = 0; M.cnt = 0; }
    var live = !!p.live && !!read && a >= 0 && a < n;
    useFrame(line, function () {
      if (!read || !line.current) return;
      var r = read().rms || 0;
      line.current.style.setProperty('--rms', r.toFixed(3));
      if (p.live && M.a >= 0) { M.acc += r; M.cnt++; }
    });
    var weightOf = function (i, d) { return p.weights && p.weights[i] != null ? p.weights[i] : M.w[i] != null ? Math.round(M.w[i]) : d; };
    var out = [], i, push = function (i, s, fw) { out.push(h('span', { key: i, className: 'ast-tx-w', 'data-s': s, style: fw != null ? { fontWeight: fw } : undefined }, words[i])); };
    var back = p.history != null ? p.history : 9, ahead = p.lookahead != null ? p.lookahead : 3;
    if (n && a >= n) { for (i = Math.max(0, n - (back + 4)); i < n; i++) push(i, 'settled', weightOf(i, 400)); }
    else if (n && a < 0) { for (i = 0; i < Math.min(n, ahead + 1); i++) push(i, 'ghost'); }
    else if (n) {
      for (i = Math.max(0, a - back); i < Math.min(n, a + ahead + 1); i++) {
        if (i < a) push(i, 'settled', weightOf(i, 400));
        else if (i === a) push(i, 'live', live ? 'calc(300 + var(--rms, 0) * 480)' : weightOf(i, 420));
        else push(i, 'ghost');
      }
    }
    return h('div', { className: cx('ast-tx', p.className), style: p.style },
      p.label ? h('div', { className: 'ast-tx-label caption-caps' }, p.label) : null,
      h('div', { ref: line, className: 'ast-tx-line transcript', 'aria-live': p.ariaLive || 'off', style: p.lines ? { maxHeight: 'calc(' + p.lines + ' * 1.45em + 2px)' } : undefined },
        out.length ? out : p.hint ? h('span', { className: 'ast-tx-hint' }, p.hint) : null));
  }

  /* ---------- shared canvas drawing ---------- */
  function strokeVals(el) {
    var cs = getComputedStyle(el), f = function (n, d) { var x = parseFloat(cs.getPropertyValue('--' + n)); return isFinite(x) && x > 0 ? x : d; };
    return { loop: f('stroke-loop', 1.25), solo: f('stroke-loop-solo', 1.8), strand: f('stroke-strand', 1.6), reticle: f('stroke-reticle', 1.25), hair: f('stroke-hairline', 1) };
  }
  function clearCanvas(c, dpr) { var ctx = c.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return ctx; }
  function dprNow() { return Math.min(window.devicePixelRatio || 1, 2); }

  /* ---------- SignalLoop: the loop in small — an agent at work, wherever it is listed ---------- */
  var MATERIALS = ['mercury', 'tube', 'wire', 'plasma'];
  function SignalLoop(p) {
    var st = p.state === 'working' || p.state === 'idle' ? p.state : 'thinking', size = p.size || 14;
    /* `material` makes it one agent's own mark: it wears that material's colour and keeps it at rest, so you can tell whose it is */
    var own = MATERIALS.indexOf(p.material) >= 0 ? p.material : null;
    return h('svg', { className: cx('ast-loop', own && 'ast-persona-' + own, p.className), 'data-state': st, 'data-own': own ? 'true' : undefined, 'data-signal': p.signal === 'secondary' ? 'secondary' : 'accent', width: size, height: size, viewBox: '0 0 16 16',
      'aria-hidden': p.label ? undefined : 'true', role: p.label ? 'img' : undefined, 'aria-label': p.label || undefined, style: p.style },
      p.label ? h('title', null, p.label) : null,
      h('circle', { className: 'ast-loop-track', cx: 8, cy: 8, r: 6 }),
      h('circle', { className: 'ast-loop-ring', cx: 8, cy: 8, r: 6, pathLength: 16, strokeDasharray: st === 'thinking' ? '1.25 0.75' : undefined }));
  }

  /* ---------- Spinner: the thinking loop with its words, for anything on its way ---------- */
  function Spinner(p) {
    var size = p.size || 44, R = 19, dash = (2 * Math.PI * R) / 12;
    return h('div', { className: cx('ast-spinner', p.className), role: 'status', 'aria-busy': 'true', style: p.style },
      h('svg', { className: 'ast-spinner-ring', width: size, height: size, viewBox: '0 0 44 44', 'aria-hidden': 'true' },
        h('circle', { className: 'ast-loop-track', cx: 22, cy: 22, r: R }),
        h('circle', { className: 'ast-spinner-dashes', cx: 22, cy: 22, r: R, strokeDasharray: (dash * 0.56).toFixed(2) + ' ' + (dash * 0.44).toFixed(2) })),
      p.label ? h('span', { className: 'ast-spinner-label notice' }, p.label) : null);
  }

  /* ---------- Badge: a word of status in one of the four tones (or neutral), always with its glyph ---------- */
  var TONE_GLYPH = { neutral: '·', info: 'i', positive: '✓', warn: '▲', danger: '✕' };
  function Badge(p) {
    var tone = TONE_GLYPH[p.tone] ? p.tone : 'neutral';
    return h('span', { className: cx('ast-badge', 'status-word', p.className), 'data-tone': tone, style: p.style },
      p.glyph === false ? null : h('span', { key: tone, className: 'ast-badge-glyph', 'aria-hidden': 'true' }, TONE_GLYPH[tone]),
      h('span', null, p.children));
  }

  /* =====================================================================================================
     QUIET UNTIL IT'S TRUE — the components that decide what is on screen, where it sits, and how it comes and goes.
     At rest a Scene is your work and the instrument at its quietest. Everything else arrives when it becomes true.
     ===================================================================================================== */

  /* ---------- Arrival: mounts what has become true, on a spring, and settles it away when it stops ---------- */
  var ARRIVE_FROM = { center: 1, object: 1, dock: 1, core: 1 };
  var ARRIVE_MS = { lock: 520, lobe: 880, settle: 360 };
  function Arrival(p) {
    var from = ARRIVE_FROM[p.from] ? p.from : 'center', spring = p.spring === 'lobe' ? 'lobe' : 'lock';
    var ph = useState(p.when ? 'arriving' : 'gone'), phase = ph[0], setPhase = ph[1];
    var last = useRef(p.children), linger = useRef(0), gone = useRef(p.onGone);
    gone.current = p.onGone;
    if (p.when) last.current = p.children;
    // when it becomes true it arrives (or comes back mid-settle); when it stops, it lingers, then settles
    useEffect(function () {
      clearTimeout(linger.current);
      if (p.when) setPhase(function (cur) { return cur === 'live' || cur === 'arriving' ? cur : 'arriving'; });
      else linger.current = setTimeout(function () { setPhase(function (cur) { return cur === 'gone' ? cur : 'settling'; }); }, Math.max(0, +p.linger || 0));
      return function () { clearTimeout(linger.current); };
    }, [!!p.when]);
    function finish(which) {
      setPhase(function (cur) {
        if (cur !== which) return cur;
        if (cur === 'arriving') return 'live';
        if (cur === 'settling') { if (gone.current) setTimeout(gone.current, 0); return 'gone'; }
        return cur;
      });
    }
    // a backstop for a browser that drops animationend (hidden tab, display: none)
    useEffect(function () {
      if (phase !== 'arriving' && phase !== 'settling') return;
      var t = setTimeout(function () { finish(phase); }, (phase === 'arriving' ? ARRIVE_MS[spring] : ARRIVE_MS.settle) + 160);
      return function () { clearTimeout(t); };
    }, [phase]);
    if (phase === 'gone') return null;
    return h(p.as || 'div', {
      className: cx('ast-arrival', phase === 'arriving' && 'ast-arrive', phase === 'settling' && 'ast-settle', p.className),
      'data-from': from, 'data-spring': spring, style: p.style,
      onAnimationEnd: function (e) { if (e.target === e.currentTarget) finish(phase); },
    }, p.when ? p.children : last.current);
  }

  /* ---------- Scene: the screen as an instrument and your work. With no work it is home, and the instrument has the center.
     With work, the instrument docks at the foot, small and still live, and leans in when you reach for it. ---------- */
  function sceneTok(el, name, fb) { var v = el ? parseFloat(getComputedStyle(el).getPropertyValue(name)) : NaN; return isFinite(v) ? v : fb; }
  function Scene(p) {
    var root = useRef(null), inst = useRef(null), sz = useState({ w: 0, h: 0 }), ns = useState(false), leave = useRef(0);
    var home = p.work == null || p.work === false, open = !!(p.opening && p.opening.props && p.opening.props.open), near = !home && (open || (p.near != null ? !!p.near : ns[0]));
    function setNear(v) { clearTimeout(leave.current); if (p.near == null) ns[1](v); if (p.onNear) p.onNear(v); }
    useEffect(function () {
      var el = root.current;
      if (!el) return;
      var set = function () { var r = el.getBoundingClientRect(); sz[1](function (c) { return c.w === r.width && c.h === r.height ? c : { w: r.width, h: r.height }; }); };
      set();
      if (typeof ResizeObserver === 'undefined') return;
      var ro = new ResizeObserver(set); ro.observe(el);
      return function () { ro.disconnect(); clearTimeout(leave.current); };
    }, []);
    var W = sz[0].w, H = sz[0].h, el = root.current;
    var rest = sceneTok(el, '--size-instrument-rest', 96), nearMax = sceneTok(el, '--size-instrument-near', 360), homeMax = sceneTok(el, '--size-instrument-home', 720), gut = sceneTok(el, '--space-24', 24);
    var foot = rest + gut, size, x, y;
    if (home) { size = clamp(Math.min(W - 2 * gut, H - foot - gut), 120, homeMax); x = (W - size) / 2; y = Math.max(gut / 2, (H - foot - size) / 2); }
    else if (near) { size = Math.max(rest, Math.min(nearMax, W - 2 * gut, H - gut)); x = gut; y = H - size - gut / 2; }
    else { size = rest; x = gut; y = H - rest - gut / 2; }
    function leaveSoon() { clearTimeout(leave.current); leave.current = setTimeout(function () { setNear(false); }, 600); }
    return h('div', {
      ref: root, className: cx('ast-scene', p.className), 'data-home': home ? 'true' : 'false', 'data-near': near ? 'true' : 'false', 'data-ready': W ? 'true' : 'false',
      style: assign({ '--ast-foot': foot + 'px', '--ast-inst': rest + gut + 'px' }, p.style),
      /* a press anywhere else lets the instrument go back to its place */
      onPointerDown: function (e) { if (near && !open && inst.current && !inst.current.contains(e.target)) setNear(false); },
    },
      home ? null : h('div', { className: 'ast-scene-work' }, p.work),
      h('div', { className: 'ast-scene-foot' },
        p.held ? h('div', { className: 'ast-scene-held' }, p.held) : null,
        h('div', { className: 'ast-scene-controls' }, p.controls || null)),
      h('div', {
        ref: inst, className: 'ast-scene-instrument', 'data-ast-keeps-opening': '', style: W ? { left: x, top: y, width: size, height: size } : undefined,
        onPointerEnter: function (e) { if (!home && e.pointerType === 'mouse') setNear(true); },
        onPointerLeave: function (e) { if (!home && e.pointerType === 'mouse') leaveSoon(); },
        /* by touch, the first press on the docked instrument only brings it to you */
        onPointerDownCapture: function (e) { if (!home && !near && e.pointerType !== 'mouse') { e.stopPropagation(); e.preventDefault(); setNear(true); } },
        onFocus: function () { if (!home) setNear(true); },
        onBlur: function (e) { if (!home && !(e.relatedTarget && inst.current && inst.current.contains(e.relatedTarget))) leaveSoon(); },
      }, p.instrument),
      /* the opening is told where the instrument will be, so it can stand clear of it */
      p.opening && React.isValidElement(p.opening) && W ? React.cloneElement(p.opening, { avoid: { left: x, top: y, right: x + size, bottom: y + size } }) : p.opening || null);
  }

  /* ---------- Reticle: the companion's attention, closing on what it is reading or about to touch ---------- */
  function Reticle(p) {
    var on = !!p.active, locked = on && !!p.locked;
    return h(p.as || 'div', {
      className: cx('ast-reticle', p.className), style: p.style,
      'data-on': on ? 'true' : 'false', 'data-locked': locked ? 'true' : 'false', 'data-sweep': p.sweep === false ? 'false' : undefined, 'data-tone': p.tone === 'secondary' ? 'secondary' : 'accent',
    },
      p.children,
      h('span', { className: 'ast-reticle-frame', 'aria-hidden': 'true' },
        h('i', { className: 'ast-reticle-c', 'data-c': 'tl' }), h('i', { className: 'ast-reticle-c', 'data-c': 'tr' }),
        h('i', { className: 'ast-reticle-c', 'data-c': 'bl' }), h('i', { className: 'ast-reticle-c', 'data-c': 'br' })),
      on && p.label ? h('span', { className: 'ast-reticle-plate canvas-plate' }, p.label) : null);
  }

  /* ---------- Footprint: the companion's sign on anything it did — the core in miniature, never a label ---------- */
  var footprintSeq = 0;
  function Footprint(p) {
    var id = useRef(null);
    if (!id.current) id.current = 'ast-fp-' + (++footprintSeq);
    var size = p.size || 14, by = p.by || 'the companion';
    return h('span', { className: cx('ast-footprint', p.className), style: p.style, title: p.title },
      h('svg', { className: 'ast-footprint-mark', width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': 'true' },
        h('defs', null, h('radialGradient', { id: id.current, cx: '36%', cy: '32%', r: '74%' },
          h('stop', { offset: '0', className: 'ast-chrome-1' }), h('stop', { offset: '0.2', className: 'ast-chrome-2' }),
          h('stop', { offset: '0.55', className: 'ast-chrome-3' }), h('stop', { offset: '0.82', className: 'ast-chrome-4' }),
          h('stop', { offset: '1', className: 'ast-chrome-5' }))),
        h('circle', { className: 'ast-footprint-orbit', cx: 8, cy: 8, r: 6.6 }),
        h('circle', { className: 'ast-footprint-core', cx: 8, cy: 8, r: 3.6, fill: 'url(#' + id.current + ')' })),
      p.children ? h('span', { className: 'ast-footprint-word status-word' }, p.children) : null,
      h('span', { className: 'ast-sr' }, (p.children ? ' ' : '') + 'by ' + by));
  }

  /* ---------- YourWords: your exact line, quoted — the anchor of anything that moved on your word ---------- */
  function YourWords(p) {
    var cap = [p.who || 'You', p.via === 'typed' ? 'typed' : 'spoken', p.at].filter(Boolean).join(' · ');
    return h('figure', { className: cx('ast-words', p.className), style: p.style },
      h('blockquote', { className: 'ast-words-line said' }, '“', p.children, '”'),
      h('figcaption', { className: 'ast-words-cap caption-caps' }, cap));
  }

  /* ---------- Prepared: what the companion readied, held out above the core until your word locks it ---------- */
  function Prepared(p) {
    var locked = p.state === 'locked', verb = p.action || 'Do it', hold = p.hold, open = hold === false;      /* open: it waits for your word with no clock on it */
    return h('section', {
      className: cx('ast-prepared', p.className), style: p.style, 'data-state': locked ? 'locked' : 'holding', 'data-hold': open ? 'open' : undefined, 'aria-label': verb + (p.target ? ' \u00b7 ' + p.target : ''),
      onKeyDown: function (e) { if (!locked && e.key === 'Escape' && p.onDismiss) { e.stopPropagation(); p.onDismiss(); } },
    },
      h('div', { className: 'ast-prepared-head' },
        h(Footprint, { by: p.by }, locked ? 'Locked' : 'Prepared'),
        /* where it will act is a way there */
        p.target ? (p.onTarget ? h(Button, { size: 'small', className: 'ast-prepared-target', onClick: p.onTarget }, p.target) : h('span', { className: 'ast-prepared-target telemetry' }, p.target)) : null),
      h('p', { className: 'ast-prepared-what field-text' }, p.children),
      /* the hold: a line that runs down while it waits for your word, and closes when you give it */
      h('span', { className: 'ast-prepared-hold', role: 'presentation', style: hold != null && !open ? { '--ast-hold': (typeof hold === 'number' ? hold + 'ms' : hold) } : undefined },
        h('span', { className: 'ast-prepared-left', onAnimationEnd: function (e) { if (!locked && e.animationName === 'ast-hold' && p.onExpire) p.onExpire(); } })),
      locked
        ? (p.words ? h(YourWords, { via: p.via, at: p.at }, p.words) : null)
        : h('div', { className: 'ast-prepared-actions' },
          h(Button, { variant: 'primary', onClick: p.onLock }, verb),
          h(Button, { icon: 'back', iconOnly: true, className: 'ast-prepared-dismiss', title: (p.dismissLabel || 'Dismiss') + ' (Esc)', onClick: p.onDismiss }, p.dismissLabel || 'Dismiss')));
  }

  /* =====================================================================================================
     THE INSTRUMENT, TAKEN APART — the visualizer's parts as components. Each is still at rest and comes
     alive only with its signal: the same envelopes, springs and palette as the Dial and the Core.
     ===================================================================================================== */

  function mixc(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
  // The lock spring (ω = 2π·2.2, ζ = 0.62) and the lobe spring (ω = 2π·2.3, ζ = 0.36), integrated per frame.
  var SPRING = { lock: [TAU * 2.2, 0.62], lobe: [TAU * 2.3, 0.36] };
  function springStep(s, target, dt, kind) {
    var k = SPRING[kind || 'lock'], w = k[0], z = k[1], n = Math.max(1, Math.ceil(dt / 0.008)), h1 = dt / n;
    for (var i = 0; i < n; i++) { var a = -w * w * (s.x - target) - 2 * z * w * s.v; s.v += a * h1; s.x += s.v * h1; }
    return s.x;
  }
  function canvasFont(P, px, weight) { return (weight || 400) + ' ' + px + 'px ' + P.mono; }
  function plateText(ctx, P, text, x, y, align, color) {
    ctx.font = canvasFont(P, 10, 500);
    ctx.textBaseline = 'middle';
    var w = ctx.measureText(text).width, x0 = align === 'end' ? x - w - 4 : align === 'center' ? x - w / 2 - 2 : x - 2;
    ctx.fillStyle = rgba(P.ground, P.plate);
    ctx.fillRect(x0 - 2, y - 7, w + 8, 14);
    ctx.fillStyle = rgba(color || P.quiet, 1);
    ctx.textAlign = 'left';
    ctx.fillText(text, x0 + 2, y + 0.5);
  }

  /* ---------- the voice as a trace, inside the Composer and the Summon while they listen. Not a component of its own. ---------- */
  function ListenTrace(p) {
    var read = useSignal(p.signal), root = useRef(null), cv = useRef(null), box = useBox(root), S = useRef(null);
    useFrame(root, function (dt, now) {
      var el = root.current, c = cv.current, W = box.current.w, H = box.current.h;
      if (!el || !c || !W || !H) return;
      if (!S.current) S.current = { drive: new Drive(), pal: new LivePalette(el), ph: [0, 1.3, 2.1], shocks: [], sw: strokeVals(el) };
      var st = S.current, D = st.drive, rm = reducedMotion() ? 0.35 : 1;
      D.step(dt, normState(p.state), read);
      st.pal.step(now, dt);
      var v = D.v, P = st.pal.c, live = Math.max(v.speak, v.listen * 0.85), f0n = clamp((v.f0vis - 80) / 260, 0, 1);
      st.ph[0] += dt * (4 + 9 * f0n) * rm; st.ph[1] += dt * (11 + 8 * f0n) * rm; st.ph[2] += dt * 29 * rm;
      while (D.events.length) { st.shocks.push({ u: 1.02, amp: D.events.shift() }); if (st.shocks.length > 4) st.shocks.shift(); }
      st.shocks.forEach(function (k) { k.u -= dt * 0.85 * rm; });
      st.shocks = st.shocks.filter(function (k) { return k.u > -0.08; });
      var dpr = dprNow();
      fitCanvas(c, W, H, dpr);
      var ctx = clearCanvas(c, dpr), mid = H / 2, A = (H / 2 - 2) * clamp(0.1 + 1.25 * v.rms, 0, 1) * live;
      var wl = 0.55 * v.low + 0.02, wm = 0.35 * v.mid + 0.01, wh = 0.2 * v.high + 0.005, ws = wl + wm + wh, n = Math.max(48, Math.round(W / 2.5));
      ctx.lineWidth = st.sw.hair + 0.7 * live;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = rgba(mixc(P.quiet, P.accent, live), 0.5 + 0.5 * live);
      if (v.think > 0.05) { ctx.setLineDash([3, 5]); ctx.lineDashOffset = -v.t * 26 * rm; }
      ctx.beginPath();
      for (var i = 0; i <= n; i++) {
        var u = i / n, env = Math.pow(Math.sin(Math.PI * u), 0.7);
        var shape = (wl * Math.sin(u * TAU * 2.1 + st.ph[0]) + wm * Math.sin(u * TAU * 5.7 + st.ph[1]) + wh * Math.sin(u * TAU * 15.3 + st.ph[2])) / ws;
        var y = mid - env * A * shape - (1 - live) * 0.6 * Math.sin(u * TAU + v.t * 0.8 * rm);
        for (var s = 0; s < st.shocks.length; s++) { var k = st.shocks[s], d = (u - k.u) / 0.035; y -= k.amp * live * (H * 0.28) * Math.exp(-d * d) * Math.sin(d * 3.2); }
        if (i) ctx.lineTo(u * W, y); else ctx.moveTo(u * W, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    });
    return h('div', { ref: root, className: cx('ast-canvas', 'ast-scope', p.className), style: p.style, role: 'img', 'aria-label': p.label || 'Waveform: ' + (STATE_WORD[normState(p.state)] || 'Idle') },
      h('canvas', { ref: cv, 'aria-hidden': 'true' }));
  }

  /* ---------- ArcGauge: one value on a 240° ring from the dial, springing to each new reading ---------- */
  var ARC_R = 46, ARC_SWEEP = (240 / 360) * TAU * ARC_R, ARC_C = TAU * ARC_R;
  function ArcGauge(p) {
    var root = useRef(null), arc = useRef(null), num = useRef(null), S = useRef({ x: 0, v: 0 });
    var val = clamp(+p.value || 0, 0, 1), warn = p.warnAt != null && val >= p.warnAt, dec = p.decimals == null ? 0 : p.decimals;
    var fmt = p.format || function (x) { return (x * 100).toFixed(dec); };
    useFrame(root, function (dt) {
      var a = arc.current, n = num.current;
      if (!a) return;
      var s = S.current;
      if (reducedMotion()) { s.x = val; s.v = 0; } else springStep(s, val, dt, 'lock');
      var x = clamp(s.x, 0, 1.02);
      a.setAttribute('stroke-dasharray', (ARC_SWEEP * x).toFixed(2) + ' ' + ARC_C.toFixed(2));
      if (n) n.textContent = fmt(clamp(s.x, 0, 1));
    });
    var ticks = [];
    for (var i = 0; i <= 10; i++) {
      var ang = (150 + 24 * i) * DEG, r0 = ARC_R + 5, r1 = ARC_R + (i % 5 === 0 ? 10 : 8);
      ticks.push(h('line', { key: i, x1: 60 + r0 * Math.cos(ang), y1: 60 + r0 * Math.sin(ang), x2: 60 + r1 * Math.cos(ang), y2: 60 + r1 * Math.sin(ang), className: 'ast-arc-tick' }));
    }
    return h('figure', { ref: root, className: cx('ast-arc', p.className), style: p.size ? assign({ '--ast-arc': p.size + 'px' }, p.style) : p.style, 'data-warn': warn ? 'true' : 'false', role: 'img', 'aria-label': (p.label || 'Value') + ': ' + fmt(val) + (p.unit ? ' ' + p.unit : '') + (warn ? ', high' : '') },
      h('svg', { viewBox: '0 0 120 120', 'aria-hidden': 'true' },
        h('g', null, ticks),
        h('circle', { cx: 60, cy: 60, r: ARC_R, className: 'ast-arc-track', strokeDasharray: ARC_SWEEP.toFixed(2) + ' ' + ARC_C.toFixed(2), transform: 'rotate(150 60 60)' }),
        h('circle', { ref: arc, cx: 60, cy: 60, r: ARC_R, className: 'ast-arc-value', strokeDasharray: '0 ' + ARC_C.toFixed(2), transform: 'rotate(150 60 60)' })),
      /* the figure and its unit are one thing, centred in the ring as one */
      h('div', { className: 'ast-arc-read' }, h('span', { className: 'ast-arc-fig' }, h('span', { ref: num, className: 'ast-arc-num' }, fmt(val)), p.unit ? h('span', { className: 'ast-arc-unit telemetry' }, p.unit) : null)),
      p.label ? h('figcaption', { className: 'ast-arc-label caption-caps' }, warn ? '▲ ' : '', p.label) : null);
  }

  /* ---------- Plate: a label on a ground plate — the instrument's way of naming what it points at ---------- */
  function Plate(p) {
    return h('span', { className: cx('ast-plate', 'canvas-plate', p.className), style: p.style, 'data-tone': p.tone === 'quiet' ? 'quiet' : 'accent', 'data-leader': p.leader || undefined }, p.children);
  }

  /* ---------- Rule: a heading with its hairline, drawn in from the words when it arrives ---------- */
  function Rule(p) {
    return h('div', { className: cx('ast-hrule', p.className), style: p.style, 'data-align': p.align === 'end' ? 'end' : 'start', role: 'heading', 'aria-level': p.level || 3 },
      h('span', { className: 'ast-hrule-label telemetry-rule' }, p.children),
      h('span', { className: 'ast-hrule-line', 'aria-hidden': 'true' }));
  }

  /* =====================================================================================================
     THE COMPANION — two presences in one space: how sure it is of you, what waits, what it says, what it
     anticipates, who is working, how far a plan has come, and what it is reading.
     ===================================================================================================== */

  /* ---------- Orbit: what is waiting, as beads on the core's orbit — each arrives on the lobe, leaves on the settle ---------- */
  var orbitSeq = 0;
  function Orbit(p) {
    var count = Math.max(0, Math.round(+p.count || 0)), max = p.max || 8, size = p.size || 64;
    var bs = useState(function () { var a = []; for (var i = 0; i < Math.min(count, max); i++) a.push({ id: ++orbitSeq, out: false }); return a; });
    var beads = bs[0], setBeads = bs[1], uid = useRef(null);
    if (!uid.current) uid.current = 'ast-orb-' + (++orbitSeq);
    useEffect(function () {
      var want = Math.min(count, max);
      setBeads(function (cur) {
        var live = cur.filter(function (b) { return !b.out; });
        if (live.length === want) return cur;
        if (live.length < want) { var add = []; for (var i = live.length; i < want; i++) add.push({ id: ++orbitSeq, out: false }); return cur.concat(add); }
        var drop = live.slice(want).map(function (b) { return b.id; });
        return cur.map(function (b) { return drop.indexOf(b.id) >= 0 ? { id: b.id, out: true } : b; });
      });
      var t = setTimeout(function () { setBeads(function (cur) { return cur.filter(function (b) { return !b.out; }); }); }, 420);
      return function () { clearTimeout(t); };
    }, [count, max]);
    var live = beads.filter(function (b) { return !b.out; }), R = 38, idx = 0;
    var words = count === 0 ? 'Nothing waiting' : count + ' waiting';
    return h('span', { className: cx('ast-orbit', p.className), style: assign({ width: size, height: size }, p.style), 'data-busy': count ? 'true' : 'false', role: 'img', 'aria-label': p.label || words, title: p.title || words },
      h('svg', { viewBox: '0 0 100 100', width: size, height: size, 'aria-hidden': 'true' },
        h('defs', null, h('radialGradient', { id: uid.current, cx: '36%', cy: '32%', r: '74%' },
          h('stop', { offset: '0', className: 'ast-chrome-1' }), h('stop', { offset: '0.2', className: 'ast-chrome-2' }), h('stop', { offset: '0.55', className: 'ast-chrome-3' }),
          h('stop', { offset: '0.82', className: 'ast-chrome-4' }), h('stop', { offset: '1', className: 'ast-chrome-5' }))),
        h('circle', { className: 'ast-orbit-ring', cx: 50, cy: 50, r: R }),
        h('circle', { className: 'ast-orbit-core', cx: 50, cy: 50, r: 13, fill: 'url(#' + uid.current + ')' }),
        h('g', { className: 'ast-orbit-spin' }, beads.map(function (b) {
          var i = b.out ? -1 : idx++, ang = i < 0 ? null : (360 * i) / Math.max(1, live.length) - 90;
          return h('g', { key: b.id, className: 'ast-orbit-slot', style: ang == null ? undefined : { transform: 'rotate(' + ang + 'deg)' } },
            h('circle', { className: 'ast-orbit-bead', 'data-out': b.out ? 'true' : 'false', cx: 50 + R, cy: 50, r: 4.2 }));
        }))),
      count > max ? h('span', { className: 'ast-orbit-more telemetry' }, '+' + (count - max)) : null);
  }

  /* ---------- Stream: the companion's words as they arrive — each lands faint and thin, then settles ---------- */
  function Stream(p) {
    var text = p.text || '', words = text.split(/(\s+)/).filter(function (w) { return w.length; });
    // words present when it mounts (not live) are simply there; every word after that arrives — once, on mount
    var born = useRef(null);
    if (!born.current) { born.current = []; if (!p.live) for (var j = 0; j < words.length; j++) born.current[j] = 0; }
    for (var i = 0; i < words.length; i++) if (born.current[i] == null) born.current[i] = 1;
    return h('p', { className: cx('ast-stream', p.size === 'large' ? 'transcript' : 'field-text', p.className), style: p.style, 'aria-live': p.ariaLive || 'off', 'aria-busy': p.live ? 'true' : 'false' },
      words.map(function (w, i) {
        if (/^\s+$/.test(w)) return w;
        return h('span', { key: i, className: born.current[i] ? 'ast-word ast-word-new' : 'ast-word' }, w);
      }),
      p.live ? h('span', { className: 'ast-stream-caret', 'aria-hidden': 'true' }, h(SignalLoop, { state: 'working', size: 12 })) : null);
  }

  /* ---------- Exchange: one turn between you and the companion — your words, then its answer as it arrives ---------- */
  function Exchange(p) {
    return h('div', { className: cx('ast-exchange', p.className), style: p.style },
      p.said ? h(YourWords, { via: p.via, at: p.at, who: p.who }, p.said) : null,
      p.reply != null || p.live ? h('div', { className: 'ast-exchange-reply' },
        h(Footprint, { by: p.by }, p.live ? 'Answering' : 'Answered'),
        h(Stream, { text: p.reply || '', live: p.live, size: p.size, ariaLive: p.ariaLive })) : null);
  }

  /* ---------- Choice: a question with its options; the companion's likely pick wears its reticle until you choose ---------- */
  function optList(options) { return (options || []).map(function (o, i) { return typeof o === 'string' ? { value: o, label: o } : assign({ value: String(i) }, o); }); }
  function Choice(p) {
    var list = optList(p.options), multi = !!p.multiple;
    var vals = multi ? (Array.isArray(p.value) ? p.value.map(String) : []) : p.value != null ? [String(p.value)] : [];
    var otherOn = !!p.other && p.otherValue != null, has = vals.length > 0 || otherOn;
    /* one answer locks the moment it is picked, unless it can still be changed: several answers, an Other, or `locked` said otherwise */
    var locked = p.locked != null ? !!p.locked : !multi && !p.other && p.value != null, likely = p.likely != null ? String(p.likely) : null;
    function pick(v) {
      if (locked || !p.onPick) return;
      if (multi) p.onPick(vals.indexOf(v) >= 0 ? vals.filter(function (x) { return x !== v; }) : vals.concat(v));
      else { if (otherOn && p.onOther) p.onOther(null); p.onPick(v); }
    }
    function other() { if (locked || !p.onOther) return; if (!otherOn && !multi && p.onPick && vals.length) p.onPick(null); p.onOther(otherOn ? null : ''); }
    return h('section', {
      className: cx('ast-choice', p.className), style: p.style, 'data-picked': locked ? 'true' : 'false', 'aria-label': p.question,
      onKeyDown: function (e) {
        var tg = e.target && e.target.tagName; if (tg === 'INPUT' || tg === 'TEXTAREA') return;       /* typing your own answer is not picking */
        var n = parseInt(e.key, 10);
        if (n >= 1 && n <= list.length) { e.preventDefault(); pick(list[n - 1].value); } else if (p.other && e.key === '0') { e.preventDefault(); other(); }
      },
    },
      p.source ? h('div', { className: 'ast-choice-source caption-caps' }, p.source) : null,
      h('p', { className: 'ast-choice-q field-text' }, p.question),
      multi && !locked ? h('p', { className: 'ast-choice-hint caption-caps' }, 'Select all that apply') : null,
      h('div', { className: 'ast-choice-list', role: 'group' }, list.map(function (o, i) {
        var on = vals.indexOf(o.value) >= 0, isLikely = !has && !locked && likely === o.value, away = locked && !on;
        var row = h('button', { type: 'button', className: 'ast-choice-opt field-text', 'data-on': on ? 'true' : 'false', 'data-away': away ? 'true' : 'false', 'aria-pressed': on ? 'true' : 'false', disabled: locked, onClick: function () { pick(o.value); } },
          h(Key, null, String(i + 1)),
          h('span', { className: 'ast-choice-label' }, o.label, o.detail ? h('span', { className: 'ast-choice-detail' }, o.detail) : null),
          isLikely ? h('span', { className: 'ast-sr' }, ' — the likely pick of ' + (p.by || 'the companion')) : null);
        return h(Reticle, { key: o.value, active: isLikely || on, locked: on, label: isLikely ? 'Likely' : on ? 'Chosen' : undefined, className: 'ast-choice-ret' }, row);
      }),
      /* Other: your own answer, in your own words. It is always the last row, on 0 */
      p.other && !(locked && !otherOn) ? h(Reticle, { key: '__other', active: otherOn, locked: otherOn, label: otherOn ? 'Chosen' : undefined, className: 'ast-choice-ret' },
        h('button', { type: 'button', className: 'ast-choice-opt field-text', 'data-on': otherOn ? 'true' : 'false', 'aria-pressed': otherOn ? 'true' : 'false', disabled: locked, onClick: other },
          h(Key, null, '0'), h('span', { className: 'ast-choice-label' }, p.otherLabel || 'Other...'))) : null,
      otherOn && !locked ? h(TextField, { key: '__text', className: 'ast-choice-other', label: 'Your answer', placeholder: p.otherPlaceholder || 'Type your answer...', value: p.otherValue || '', autoFocus: true, onChange: function (e) { if (p.onOther) p.onOther(e.target.value); } }) : null),
      locked && p.words ? h(YourWords, { via: p.via, at: p.at }, p.words) : null);
  }

  /* ---------- Questions: several asked at once, answered one at a time. You can go back, skip, or answer any of them in your
     own words. Nothing is sent until Submit. Answered, the set stays as the record of what you said. ---------- */
  function Questions(p) {
    var qs = p.questions || [], n = qs.length, st = useState(0), sel = useState({}), oth = useState({});
    if (!n) return null;
    function label(q, v) { var l = optList(q.options).filter(function (o) { return o.value === String(v); })[0]; return l ? l.label : v; }
    if (p.answers) {
      var any = p.answers.some(function (a) { return a && ((a.values && a.values.length) || a.other); });
      return h('div', { className: cx('ast-questions', p.className), style: p.style, 'data-answered': 'true' }, qs.map(function (q, i) {
        var a = p.answers[i] || {}, vals = a.values || [], none = !vals.length && !a.other;
        return h('section', { key: i, className: 'ast-questions-rec', 'aria-label': q.question },
          q.header || n > 1 ? h('div', { className: 'ast-choice-source caption-caps' }, q.header || 'Question ' + (i + 1) + ' of ' + n) : null,
          h('p', { className: 'ast-choice-q field-text' }, q.question),
          none ? h('p', { className: 'ast-questions-none caption-caps' }, any ? 'Skipped' : 'No answer provided') : null,
          vals.length ? h('p', { className: 'ast-questions-ans field-text' }, h('span', { className: 'caption-caps' }, 'Your answer'), vals.map(function (v) { return label(q, v); }).join(', ')) : null,
          a.other ? h(YourWords, { via: 'typed', at: p.at, who: 'In your words' }, a.other) : null);
      }));
    }
    var step = Math.min(st[0], n - 1), q = qs[step], multi = !!q.multiple, cur = sel[0][step], o = oth[0][step];
    function done(i) { var v = sel[0][i], t = oth[0][i]; return (Array.isArray(v) ? v.length > 0 : v != null) || (t != null && String(t).trim().length > 0); }
    function build() { return qs.map(function (x, i) { var v = sel[0][i], t = oth[0][i]; return { values: Array.isArray(v) ? v : v != null ? [v] : [], other: t != null && String(t).trim() ? String(t).trim() : null }; }); }
    function setAt(state, v) { state[1](function (m) { var c = assign({}, m); c[step] = v; return c; }); }
    var last = step === n - 1, anyDone = qs.some(function (x, i) { return done(i); });
    function advance() { if (last) { if (anyDone && p.onSubmit) p.onSubmit(build()); } else st[1](step + 1); }
    return h('div', {
      className: cx('ast-questions', p.className), style: p.style,
      onKeyDown: function (e) { var tg = e.target && e.target.tagName; if (e.key === 'Enter' && tg !== 'BUTTON' && tg !== 'TEXTAREA') { e.preventDefault(); advance(); } },
    },
      n > 1 ? h(Track, { steps: qs.map(function (x, i) { return { id: i, label: x.header || 'Question ' + (i + 1), state: i === step ? 'waiting' : done(i) ? 'done' : 'next' }; }), label: 'Questions', value: step, onOpen: function (s) { st[1](+s.id); } }) : null,
      h(Choice, {
        key: step, question: q.question, options: q.options, multiple: multi, likely: q.likely, by: p.by, locked: false,
        source: n > 1 ? 'Question ' + (step + 1) + ' of ' + n + (q.header ? ' · ' + q.header : '') : q.header || p.source,
        value: multi ? cur || [] : cur != null ? cur : null, onPick: function (v) { setAt(sel, v); },
        other: true, otherValue: o != null ? o : null, onOther: function (t) { setAt(oth, t); },
      }),
      h('div', { className: 'ast-questions-foot' },
        h(Button, { onClick: function () { if (p.onSkip) p.onSkip(); } }, n > 1 ? 'Skip all' : 'Skip'),
        step > 0 ? h(Button, { onClick: function () { st[1](step - 1); } }, 'Back') : null,
        last ? h(Button, { variant: 'primary', disabled: !anyDone, onClick: advance }, 'Submit') : h(Button, { variant: 'primary', onClick: advance }, 'Next')));
  }

  /* ---------- Form: what a tool needs from you before it can go on. Fields, then Submit or Decline ---------- */
  function Form(p) {
    var fields = p.fields || [], vs = useState(function () { var m = {}; fields.forEach(function (f) { m[f.id] = f.value != null ? f.value : f.type === 'boolean' ? false : ''; }); return m; }), er = useState({});
    var head = [p.from ? h('div', { key: 's', className: 'ast-choice-source caption-caps' }, p.from + ' asks for your input') : null, p.message ? h('p', { key: 'q', className: 'ast-choice-q field-text' }, p.message) : null];
    if (p.result) {
      var vals = p.values || {};
      return h('section', { className: cx('ast-form', p.className), style: p.style, 'data-answered': 'true', 'aria-label': p.message || 'Form' }, head,
        p.result === 'declined' ? null : h(KeyValueList, { items: fields.map(function (f) { var v = vals[f.id]; return [f.label, f.type === 'boolean' ? (v ? 'Yes' : 'No') : v === '' || v == null ? null : String(v)]; }) }),
        h(Badge, { tone: p.result === 'declined' ? 'warn' : 'positive' }, p.result === 'declined' ? 'Declined' : 'Submitted'));
    }
    function set(id, v) { vs[1](function (m) { var c = assign({}, m); c[id] = v; return c; }); }
    function submit() {
      var bad = {};
      fields.forEach(function (f) {
        var v = vs[0][f.id];
        if (f.required && f.type !== 'boolean' && String(v == null ? '' : v).trim() === '') bad[f.id] = 'Required';
        else if (f.type === 'number' && String(v).trim() !== '' && !isFinite(+v)) bad[f.id] = 'Enter a number';
      });
      er[1](bad);
      if (!Object.keys(bad).length && p.onSubmit) p.onSubmit(vs[0]);
    }
    return h('form', { className: cx('ast-form', p.className), style: p.style, 'aria-label': p.message || 'Form', noValidate: true, onSubmit: function (e) { e.preventDefault(); submit(); } }, head,
      fields.map(function (f) {
        var name = f.required || f.type === 'boolean' ? f.label : f.label + ' (optional)', v = vs[0][f.id], bad = er[0][f.id];
        var ctl = f.type === 'select' ? h(Select, { label: name, options: [{ value: '', label: 'Choose…' }].concat(f.options || []), value: v == null ? '' : String(v), onChange: function (x) { set(f.id, x); } })
          : f.type === 'boolean' ? h(Switch, { checked: !!v, label: name, showLabel: true, onChange: function (x) { set(f.id, x); } })
            : h(TextField, { label: name, showLabel: true, value: v == null ? '' : v, inputMode: f.type === 'number' ? 'decimal' : undefined, 'aria-invalid': bad ? 'true' : undefined, onChange: function (e) { set(f.id, e.target.value); } });
        return h('div', { key: f.id, className: 'ast-form-field' }, ctl, bad ? h('span', { className: 'ast-form-error caption-caps', role: 'alert' }, bad) : null);
      }),
      h('div', { className: 'ast-questions-foot' }, h(Button, { onClick: function () { if (p.onDecline) p.onDecline(); } }, 'Decline'), h(Button, { variant: 'primary', type: 'submit' }, 'Submit')));
  }

  /* ---------- Roster: the agents at work right now — present only while someone is working ---------- */
  function elapsed(ms) { var s = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(s / 60); return m ? m + ':' + String(s % 60).padStart(2, '0') : s + ' s'; }
  function Roster(p) {
    var agents = (p.agents || []).filter(function (a) { return a && a.state && a.state !== 'idle'; });
    var tk = useState(0), setTick = tk[1];
    useEffect(function () { if (!agents.length) return; var id = setInterval(function () { setTick(function (x) { return x + 1; }); }, 1000); return function () { clearInterval(id); }; }, [agents.length > 0]);
    if (!agents.length) return null;
    var now = Date.now();
    return h('ul', { className: cx('ast-roster', p.className), style: p.style, 'aria-label': p.label || 'At work' }, agents.map(function (a) {
      return h('li', { key: a.id || a.name, className: 'ast-roster-row', 'data-helper': a.helper ? 'true' : 'false' },
        h(SignalLoop, { state: a.state === 'thinking' ? 'thinking' : 'working', signal: a.helper ? 'secondary' : 'accent', size: 13 }),
        h('span', { className: 'ast-roster-name field-text' }, a.helper ? '↳ ' : '', a.name),
        a.activity ? h('span', { className: 'ast-roster-act field-text' }, a.activity) : null,
        a.since ? h('span', { className: 'ast-roster-time telemetry' }, elapsed(now - a.since)) : null);
    }));
  }

  /* ---------- Steps: a plan being worked through — done steps settle with a check, the live one works ---------- */
  var STEP_GLYPH = { done: '✓', failed: '✕' };
  function Steps(p) {
    var steps = p.steps || [];
    return h('ol', { className: cx('ast-steps', p.className), style: p.style, 'aria-label': p.label || 'Plan' }, steps.map(function (s, i) {
      var state = s.state === 'done' || s.state === 'live' || s.state === 'failed' ? s.state : 'next';
      return h('li', { key: s.id || i, className: 'ast-step', 'data-state': state },
        h('span', { className: 'ast-step-mark', 'aria-hidden': 'true' },
          state === 'live' ? h(SignalLoop, { state: s.thinking ? 'thinking' : 'working', size: 14 }) : STEP_GLYPH[state] ? h('span', { key: state, className: 'ast-step-glyph' }, STEP_GLYPH[state]) : h('span', { className: 'ast-step-ring' })),
        h('span', { className: 'ast-step-body' },
          h('span', { className: 'ast-step-label field-text' }, s.label, h('span', { className: 'ast-sr' }, ' — ' + (state === 'next' ? 'not started' : state === 'live' ? 'in progress' : state))),
          s.detail ? h('span', { className: 'ast-step-detail telemetry' }, s.detail) : null));
    }));
  }

  /* ---------- Excerpt: the lines the companion is reading, with its read head moving down the gutter ---------- */
  function Excerpt(p) {
    var lines = p.lines || String(p.text || '').split('\n').map(function (t, i) { return { n: (p.start || 1) + i, text: t }; });
    var atIdx = -1;
    lines.forEach(function (l, i) { if (l.n === p.at) atIdx = i; });
    return h('figure', { className: cx('ast-excerpt', p.className), style: p.style },
      h('figcaption', { className: 'ast-excerpt-head' },
        h('span', { className: 'ast-excerpt-path caption-caps' }, p.path),
        p.by !== false && atIdx >= 0 ? h(Footprint, { by: p.by }, p.label || 'Reading') : null),
      h('div', { className: 'ast-excerpt-body' },
        atIdx >= 0 ? h('span', { className: 'ast-excerpt-head-bar', 'aria-hidden': 'true', style: { transform: 'translateY(calc(' + atIdx + ' * var(--ast-row)))' } }) : null,
        h('pre', { className: 'ast-excerpt-pre field-value' }, lines.map(function (l, i) {
          var state = atIdx < 0 ? 'read' : i < atIdx ? 'read' : i === atIdx ? 'at' : 'ahead';
          return h('span', { key: l.n, className: 'ast-excerpt-line', 'data-state': state, 'data-kind': l.kind || undefined },
            h('span', { className: 'ast-excerpt-n', 'aria-hidden': 'true' }, l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : l.n),
            h('code', null, l.text || ' '), '\n');
        }))));
  }

  /* =====================================================================================================
     ONE CALL AWAY — what is not on screen, brought up on your word: the summon, a sheet, the history,
     and the keys that reach them.
     ===================================================================================================== */

  /* ---------- Key: a keycap for the key that reaches something ---------- */
  function Key(p) {
    return h('kbd', { className: cx('ast-key', 'status-word', p.className), style: p.style, title: p.title, 'data-pressed': p.pressed ? 'true' : undefined }, p.children);
  }

  /* ---------- Summon: the one call away — drawn out of the core, a line to say or type, results that arrive ---------- */
  var summonSeq = 0;
  function Summon(p) {
    var items = p.items || [], input = useRef(null), sel = useState(0), uid = useRef(null);
    if (!uid.current) uid.current = 'ast-summon-' + (++summonSeq);
    var active = Math.min(sel[0], Math.max(0, items.length - 1));
    useEffect(function () { if (p.open && input.current) input.current.focus(); }, [p.open]);
    useEffect(function () { sel[1](0); }, [p.query, items.length]);
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); if (p.onClose) p.onClose(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); sel[1](Math.min(items.length - 1, active + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel[1](Math.max(0, active - 1)); }
      else if (e.key === 'Enter' && items[active]) { e.preventDefault(); if (p.onPick) p.onPick(items[active]); }
    }
    var list = uid.current + '-list';
    return h(Arrival, { when: !!p.open, from: 'core', spring: 'lobe', className: cx('ast-summon-wrap', p.className), style: p.style },
      h('div', { className: 'ast-summon', role: 'dialog', 'aria-label': p.label || 'Call up anything', onKeyDown: onKey },
        h('div', { className: 'ast-summon-field', 'data-listening': p.listening ? 'true' : 'false' },
          h(Footprint, { by: p.by, size: 16 }),
          p.listening ? h('div', { className: 'ast-summon-scope' }, h(ListenTrace, { state: 'listening', signal: p.signal })) : null,
          h('input', {
            ref: input, className: 'ast-summon-input said', value: p.query || '', spellCheck: false, autoComplete: 'off',
            placeholder: p.listening ? 'Listening…' : p.placeholder || 'Say it or type it',
            role: 'combobox', 'aria-expanded': items.length ? 'true' : 'false', 'aria-controls': list, 'aria-activedescendant': items.length ? list + '-' + active : undefined, 'aria-label': p.label || 'Call up anything',
            onChange: function (e) { if (p.onQuery) p.onQuery(e.target.value); },
          })),
        items.length ? h('ul', { id: list, role: 'listbox', className: 'ast-summon-list' }, items.map(function (it, i) {
          return h('li', {
            key: it.id || i, id: list + '-' + i, role: 'option', 'aria-selected': i === active ? 'true' : 'false', className: 'ast-summon-item', 'data-active': i === active ? 'true' : 'false',
            style: { animationDelay: i * 32 + 'ms' }, onMouseEnter: function () { sel[1](i); }, onMouseDown: function (e) { e.preventDefault(); }, onClick: function () { if (p.onPick) p.onPick(it); },
          },
            h('span', { className: 'ast-summon-src caption-caps' }, it.source),
            h('span', { className: 'ast-summon-label field-text' }, it.label),
            it.hint ? h('span', { className: 'ast-summon-hint telemetry' }, it.hint) : null);
        })) : null,
        h('div', { className: 'ast-summon-foot telemetry' },
          h(Key, null, '↑↓'), h('span', null, 'Move'), h(Key, null, '↵'), h('span', null, 'Open'), h(Key, null, 'Esc'), h('span', null, 'Close'))));
  }

  /* ---------- Sheet: a summoned panel over a dimmed ground — from the dock, or in from the far edge ---------- */
  function Sheet(p) {
    var panel = useRef(null), side = p.from === 'end' || p.from === 'rim-end' ? 'end' : 'dock', close = useRef(p.onClose);
    close.current = p.onClose;
    useEffect(function () {
      if (!p.open) return;
      var prev = document.activeElement;
      if (panel.current) panel.current.focus();
      var f = function (e) { if (e.key === 'Escape' && close.current) close.current(); };
      window.addEventListener('keydown', f);
      return function () { window.removeEventListener('keydown', f); if (prev && prev.focus) try { prev.focus(); } catch (e) { /* gone */ } };
    }, [p.open]);
    return h(Arrival, { when: !!p.open, from: 'dock', className: cx('ast-sheet-layer', side === 'end' && 'ast-sheet-layer-end', p.className), style: p.style },
      h('div', { className: 'ast-sheet-scrim', 'aria-hidden': 'true', onClick: function () { if (close.current) close.current(); } }),
      h('section', { ref: panel, tabIndex: -1, className: 'ast-sheet', 'data-side': side, role: 'dialog', 'aria-modal': 'true', 'aria-label': typeof p.title === 'string' ? p.title : undefined, style: p.width ? { width: p.width } : undefined },
        h('div', { className: 'ast-sheet-head' },
          h('button', { type: 'button', className: 'ast-sheet-close', onClick: function () { if (close.current) close.current(); }, 'aria-label': 'Back', title: 'Back (Esc)' }, h(Icon, { name: 'back' })),
          h(Rule, null, p.title)),
        h('div', { className: 'ast-sheet-body' }, p.children)));
  }

  /* ---------- Trace: what happened, newest first — the history that stays one call away instead of on screen ---------- */
  function Trace(p) {
    var ev = (p.events || []).slice(0, p.max || 12);
    if (!ev.length) return null;
    return h('ol', { className: cx('ast-trace', p.className), style: p.style, 'aria-label': p.label || 'History' }, ev.map(function (e, i) {
      return h('li', { key: e.id || i, className: 'ast-trace-item', 'data-latest': i === 0 ? 'true' : 'false' },
        h('span', { className: 'ast-trace-bead', 'aria-hidden': 'true' }),
        h('div', { className: 'ast-trace-head' },
          e.at ? h('span', { className: 'ast-trace-at telemetry' }, e.at) : null,
          h('span', { className: 'ast-trace-src caption-caps' }, e.source),
          e.status ? h(Badge, { tone: e.tone }, e.status) : null),
        e.text ? h('p', { className: 'ast-trace-text field-text' }, e.text) : null,
        e.words ? h(YourWords, { via: e.via }, e.words) : e.by ? h(Footprint, { by: e.by }, e.did || 'Done') : null);
    }));
  }

  /* =====================================================================================================
     MORE CONTROLS — machined, squared, and on the springs: a switch, a fader, and the line you talk through.
     ===================================================================================================== */

  /* ---------- Switch: a square knob in a square track, springing across ---------- */
  function Switch(p) {
    var on = !!p.checked;
    return h('button', {
      type: 'button', role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': p.showLabel ? undefined : p.label, disabled: p.disabled,
      className: cx('ast-switch', p.className), style: p.style,
      onClick: function () { if (p.onChange) p.onChange(!on); },
    },
      h('span', { className: 'ast-switch-track', 'aria-hidden': 'true' }, h('span', { className: 'ast-switch-knob' })),
      p.showLabel ? h('span', { className: 'ast-switch-label control-label' }, p.label) : null);
  }

  /* ---------- Fader: a value on a ticked hairline, its pointer springing to every change ---------- */
  function Fader(p) {
    var min = p.min == null ? 0 : +p.min, max = p.max == null ? 1 : +p.max, val = clamp(+p.value || 0, min, max), t = max > min ? (val - min) / (max - min) : 0;
    var root = useRef(null), thumb = useRef(null), fill = useRef(null), S = useRef({ x: t, v: 0 });
    useFrame(root, function (dt) {
      var s = S.current;
      if (reducedMotion()) { s.x = t; s.v = 0; } else springStep(s, t, dt, 'lock');
      var x = clamp(s.x, -0.015, 1.015);
      if (thumb.current) thumb.current.style.left = (x * 100).toFixed(2) + '%';
      if (fill.current) fill.current.style.transform = 'scaleX(' + clamp(x, 0, 1).toFixed(4) + ')';
    });
    var fmt = p.format || function (x) { var d = p.decimals == null ? 2 : p.decimals; return x.toFixed(d) + (p.unit ? ' ' + p.unit : ''); };
    var ticks = [], dets = (p.detents || []).filter(function (d) { return d >= min && d <= max; }), on = false;
    /* detents: values the fader catches on, the way a ring catches on a mark */
    function caught(x) { var c = (max - min) * 0.025; for (var k = 0; k < dets.length; k++) if (Math.abs(x - dets[k]) <= c) return dets[k]; return x; }
    for (var k = 0; k < dets.length; k++) if (Math.abs(val - dets[k]) < 1e-9) on = true;
    if (dets.length) for (var j = 0; j < dets.length; j++) ticks.push(h('span', { key: 'd' + j, className: 'ast-fader-tick', 'data-major': 'true', 'data-detent': 'true', 'data-on': Math.abs(val - dets[j]) < 1e-9 ? 'true' : 'false', style: { left: ((dets[j] - min) / (max - min)) * 100 + '%' } }));
    else for (var i = 0; i <= 10; i++) ticks.push(h('span', { key: i, className: 'ast-fader-tick', 'data-major': i % 5 === 0 ? 'true' : 'false', style: { left: i * 10 + '%' } }));
    return h('div', { className: cx('ast-fader', p.className), style: p.style, 'data-disabled': p.disabled ? 'true' : 'false' },
      h('div', { className: 'ast-fader-head' },
        h('span', { className: 'ast-fader-label caption-caps' }, p.label),
        h('span', { className: 'ast-fader-value telemetry' }, fmt(val))),
      h('div', { ref: root, className: 'ast-fader-track' },
        ticks,
        h('span', { className: 'ast-fader-rail', 'aria-hidden': 'true' }, h('span', { ref: fill, className: 'ast-fader-fill' })),
        h('span', { ref: thumb, className: 'ast-fader-thumb', 'aria-hidden': 'true', 'data-caught': on ? 'true' : 'false' }),
        h('input', {
          type: 'range', className: 'ast-fader-input', min: min, max: max, step: p.step || 'any', value: val, disabled: p.disabled,
          'aria-label': p.label, 'aria-valuetext': fmt(val),
          onChange: function (e) { if (p.onChange) p.onChange(caught(parseFloat(e.target.value))); },
        })));
  }

  /* ---------- Files: what rides with a line. Each is a chip: its name, its size, and a thumbnail if it is a picture ---------- */
  function fileSize(n) { n = +n || 0; return n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
  function Files(p) {
    var list = p.files || [];
    if (!list.length) return null;
    return h('div', { className: cx('ast-files', p.className), style: p.style, role: 'list', 'aria-label': p.label || 'Files' }, list.map(function (f, i) {
      var thumb = f.url ? h('img', { src: f.url, alt: '' }) : null;
      return h('span', { key: f.id != null ? f.id : f.name + i, className: 'ast-file-chip telemetry', role: 'listitem' },
        thumb ? (p.onOpen ? h('button', { type: 'button', className: 'ast-file-thumb', id: f.id != null ? 'ast-file-' + f.id : undefined, 'data-ast-keeps-opening': '', 'aria-label': 'Open ' + f.name, onClick: function () { p.onOpen(f); } }, thumb) : h('span', { className: 'ast-file-thumb' }, thumb)) : null,
        h('span', { className: 'ast-file-name' }, f.name), f.size != null ? h('span', { className: 'ast-file-size' }, fileSize(f.size)) : null,
        p.onRemove ? h('button', { type: 'button', className: 'ast-file-x', 'aria-label': 'Remove ' + f.name, onClick: function () { p.onRemove(f); } }, '×') : null);
    }));
  }

  /* ---------- Composer: the line you talk or type through. It grows with what you type and carries files; its lower edge is the
     status of what you last sent; and it has one button, which is Send when there is something to send and Stop while work runs. ---------- */
  function Composer(p) {
    var v = p.value || '', files = p.files || [], has = v.trim().length > 0 || files.length > 0, ta = useRef(null), hold = useRef({ t: 0, fired: false });
    var maxH = (p.maxRows || 7) * 24;
    React.useLayoutEffect(function () { var el = ta.current; if (el) { el.style.height = 'auto'; el.style.height = Math.min(maxH, el.scrollHeight) + 'px'; } }, [v, maxH]);
    useEffect(function () { return function () { clearTimeout(hold.current.t); }; }, []);
    function send() { if (has && p.onSend) p.onSend(v); }
    var pr = p.progress != null && isFinite(+p.progress) ? clamp(+p.progress, 0, 1) : null;
    var stop = !has && !!p.onStop;
    /* the talk press: one press opens the mic, the next stops it and sends what was heard; while that becomes words a press records again */
    var talk = p.talk || null, ts = talk ? talk.state || 'idle' : null, hearing = !!p.listening || ts === 'listening', noteId = React.useId();
    var talkWord = !talk ? '' : ts === 'listening' ? 'Stop and send' : ts === 'transcribing' ? 'Transcribing \u00b7 press to talk again' : 'Talk' + (talk.name ? ' to ' + talk.name : '');
    /* a hold on Send is its own gesture: it fires onHold and the press that follows sends nothing */
    var press = p.onHold ? {
      onPointerDown: function () { clearTimeout(hold.current.t); hold.current.fired = false; hold.current.t = setTimeout(function () { hold.current.fired = true; p.onHold(); }, 480); },
      onPointerUp: function () { clearTimeout(hold.current.t); }, onPointerLeave: function () { clearTimeout(hold.current.t); },
    } : null;
    return h('div', { className: cx('ast-composer', p.className), style: p.style, 'data-listening': hearing ? 'true' : 'false', 'data-busy': p.busy ? 'true' : 'false', 'data-drop': p.dropping ? 'true' : 'false',
      onDragOver: p.onFiles ? function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) e.preventDefault(); } : undefined,
      onDrop: p.onFiles ? function (e) { var fl = e.dataTransfer && e.dataTransfer.files; if (fl && fl.length) { e.preventDefault(); e.stopPropagation(); p.onFiles(Array.prototype.slice.call(fl)); } } : undefined },
      /* its lower edge says what became of what you sent: dashes while it is on its way, a line that fills as the work gets done */
      p.busy || pr !== null ? h('span', { className: 'ast-composer-edge', role: 'progressbar', 'aria-label': typeof p.busy === 'string' ? p.busy : 'Working', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pr !== null ? Math.round(pr * 100) : undefined },
        pr !== null ? h('span', { className: 'ast-composer-done', style: { transform: 'scaleX(' + pr + ')' } }) : h('span', { className: 'ast-composer-crawl' })) : null,
      talk && talk.error ? h('p', { className: 'ast-composer-note notice', role: 'alert', id: noteId }, talk.error) : null,
      files.length ? h(Files, { files: files, onRemove: p.onRemoveFile, label: 'Files to send' }) : null,
      h(Arrival, { when: hearing, from: 'dock', className: 'ast-composer-scope' }, h(ListenTrace, { state: 'listening', signal: p.signal })),
      h('textarea', {
        ref: ta, rows: 1, className: 'ast-composer-input field-text', value: v, spellCheck: true, autoComplete: 'off', 'aria-label': p.label || 'Say it or type it',
        placeholder: hearing ? 'Listening…' : ts === 'transcribing' ? 'Transcribing…' : p.placeholder || 'Say it or type it',
        onChange: function (e) { if (p.onChange) p.onChange(e.target.value); },
        /* Enter sends, with or without Ctrl or Cmd; Shift and Enter is a new line */
        onKeyDown: function (e) { if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent && e.nativeEvent.isComposing)) { e.preventDefault(); send(); } },
        onPaste: p.onFiles ? function (e) { var fl = e.clipboardData && e.clipboardData.files; if (fl && fl.length) { e.preventDefault(); p.onFiles(Array.prototype.slice.call(fl)); } } : undefined,
      }),
      p.onFiles ? h(FileButton, { multiple: true, iconOnly: true, className: 'ast-composer-attach', 'aria-label': 'Attach a file', onFile: function (f) { p.onFiles([].concat(f)); } }, 'File') : null,
      p.onListen ? h(ToggleButton, { icon: 'mic', iconOnly: true, pressed: !!p.listening, onPressedChange: p.onListen }, p.listening ? 'Stop listening' : 'Listen') : null,
      talk ? h('span', { className: 'ast-composer-talk', 'data-talk': ts, 'data-tone': talk.error ? 'warn' : undefined },
        /* it never takes the focus from the field beside it, so a phone's keys stay up */
        h(Button, { icon: 'mic', iconOnly: true, active: ts === 'listening', title: talkWord + (ts === 'idle' && talk.binding ? ' \u00b7 ' + talk.binding : ''), 'aria-label': talkWord, 'aria-describedby': talk.error ? noteId : undefined, onMouseDown: function (e) { e.preventDefault(); }, onClick: talk.onToggle }, talkWord),
        ts === 'transcribing' ? h('svg', { className: 'ast-composer-talk-turn', viewBox: '0 0 44 44', 'aria-hidden': 'true' }, h('circle', { className: 'ast-spinner-dashes', cx: 22, cy: 22, r: 19, strokeDasharray: '5.57 4.38' })) : null) : null,
      h(Arrival, { when: has || stop, from: 'dock', as: 'span', className: 'ast-composer-send' },
        has ? h(Button, assign({ variant: 'primary', icon: 'send', iconOnly: !p.sendLabel || p.sendLabel === 'Send', className: 'ast-composer-go', 'data-ast-keeps-opening': '', title: p.sendTitle, onClick: function () { if (hold.current.fired) { hold.current.fired = false; return; } send(); } }, press), p.sendLabel || 'Send')
          : stop ? h(Button, { icon: 'stop', iconOnly: true, onClick: p.onStop }, 'Stop') : null));
  }

  /* =====================================================================================================
     OBJECTS — the few living things a screen is made of. Each one is a way in, a measure and a sign at once,
     whisper-quiet until it is needed or you touch it, and it moves like a physical thing.
     ===================================================================================================== */

  var RG_HALF = Math.PI / 2;
  var RG_GLIDE = 0.38;   /* how long a flick carries (duration-glide) */
  var RG_JUMP = 0.14;    /* how fast a tapped mark comes round (duration-jump) */
  var RG_VMAX = 14;      /* rad/s, the hardest flick */
  /* The rig's rings, inside out: its two armillary rings (b, a), its flat loop, and two more for larger sets. */
  var RG_KIND = {
    halo: { tone: 'halo', iota: 62, omega: 4.1, drift: 0.045, wob: 0 },
    b: { tone: 'b', iota: 68, omega: 0.4, drift: 0.06, wob: 3 },
    a: { tone: 'a', iota: 54, omega: 2.3, drift: -0.035, wob: 0 },
    e: { tone: 'loop', iota: 46, omega: 5.3, drift: -0.05, wob: 0 },
    loop: { tone: 'loop', iota: 0, omega: 0, drift: 0, wob: 0 },
  };
  var RG_SETS = {
    1: [['a', 0.9]],
    2: [['b', 0.68], ['a', 0.94]],
    3: [['b', 0.58], ['a', 0.79], ['loop', 1]],
    4: [['halo', 0.4], ['b', 0.6], ['a', 0.8], ['loop', 1]],
    5: [['halo', 0.32], ['b', 0.49], ['a', 0.66], ['e', 0.83], ['loop', 1]],
  };
  var RG_STATES = { idle: 1, working: 1, waiting: 1, done: 1, failed: 1 };
  var RG_WORD = { idle: 'not started', working: 'working', waiting: 'waiting on you', done: 'done', failed: 'failed' };
  function rgMod(a, n) { return ((a % n) + n) % n; }
  function rgStep(r) { return TAU / r.n; }
  function rgAlign(r, x) { var st = rgStep(r); return RG_HALF + Math.round((x - RG_HALF) / st) * st; }
  function rgIndex(r) { return rgMod(r.m, r.n); }            /* the thing whose mark sits at the pointer */
  function rgMark(r, j) { return r.psi - j * rgStep(r); }      /* where thing j's mark is: things run clockwise, the way progress reads */
  function rgFind(items, id) { for (var i = 0; i < items.length; i++) if (items[i] && String(items[i].id) === String(id)) return i; return -1; }
  function rgState(it) { return it && RG_STATES[it.state] ? it.state : 'idle'; }
  function rgBasis(r) { return { co: Math.cos(r.omega), so: Math.sin(r.omega), ci: Math.cos(r.iota), si: Math.sin(r.iota) }; }
  /* A point of the ring on screen, and how far it sits toward you (positive) or away. */
  function rgPt(E, B, rad, t) { var c = Math.cos(t), s = Math.sin(t); return [E.cx + rad * (c * B.co - s * B.so * B.ci), E.cy - rad * (c * B.so + s * B.co * B.ci), s * B.si]; }
  /* The reverse: where on the ring's own plane a screen point falls, as an angle. It is what keeps a mark under your finger. */
  function rgAngle(E, B, x, y) { var dx = x - E.cx, dy = -(y - E.cy); return Math.atan2((-dx * B.so + dy * B.co) / B.ci, dx * B.co + dy * B.so); }
  function rgNearest(E, r, x, y) {
    var B = rgBasis(r), rad = r.rf * E.Ro, N = 72, best = Infinity, bt = 0, i, k;
    function tryAt(t) { var q = rgPt(E, B, rad, t), d = (q[0] - x) * (q[0] - x) + (q[1] - y) * (q[1] - y); if (d < best) { best = d; bt = t; } }
    for (i = 0; i < N; i++) tryAt((i / N) * TAU);
    var span = TAU / N;
    for (k = 0; k < 5; k++) { span *= 0.5; var c = bt; tryAt(c - span); tryAt(c + span); }
    return { d: Math.sqrt(best), front: Math.sin(bt) * B.si >= 0 };
  }
  /* The ring a pointer is on: the closest one inside the grab band, the near side winning where two cross. */
  function rgAt(E, x, y, band) {
    var hit = null, score = Infinity;
    for (var i = 0; i < E.rings.length; i++) {
      var r = E.rings[i];
      if (r.leaving || r.life < 0.5 || r.holder !== null) continue;
      var n = rgNearest(E, r, x, y);
      if (n.d > band) continue;
      var s = n.d - (n.front ? 1.5 : 0);
      if (s < score) { score = s; hit = r; }
    }
    return hit;
  }
  /* The thing a point on a ring belongs to: each thing owns the span from its mark to the next one. */
  function rgItemAt(E, r, x, y) { var a = rgAngle(E, rgBasis(r), x, y), st = rgStep(r); return Math.floor(wrapPi(r.psi - a) / st + 0.18); }
  function rgRelease(r, v, now) {
    var st = rgStep(r);
    r.target = rgAlign(r, r.psi + v * RG_GLIDE);              /* the mark the flick would carry it to */
    if (Math.abs(r.target - r.psi) < 0.9 * st) { r.mode = 'lock'; r.vel = v; } else { r.mode = 'seek'; r.tau = RG_GLIDE; r.vel = v; }
  }
  function rgJump(r, target) {
    r.target = target;
    if (Math.abs(target - r.psi) < 0.9 * rgStep(r)) r.mode = 'lock'; else { r.mode = 'seek'; r.tau = reducedMotion() ? 0.07 : RG_JUMP; }
  }
  /* Bring mark j round to the pointer, the short way. */
  function rgBring(r, j) { rgJump(r, r.psi + wrapPi(RG_HALF - rgMark(r, j))); }
  function rgAdvance(r, dt, now) {
    var st = rgStep(r), locked = false;
    if (r.mode === 'wheel' && now > r.wheelUntil) rgRelease(r, 0, now);
    if (r.mode === 'seek') {
      var d = (r.target - r.psi) * (1 - Math.exp(-dt / r.tau));
      r.vel = d / dt; r.psi += d;
      if (Math.abs(r.target - r.psi) < 0.9 * st) r.mode = 'lock';
    } else if (r.mode === 'lock') {
      var n = Math.max(1, Math.ceil(dt / 0.006)), hh = dt / n, w = SPRING.lock[0], z = reducedMotion() ? 1 : SPRING.lock[1];
      for (var i = 0; i < n; i++) { r.vel += (-w * w * (r.psi - r.target) - 2 * z * w * r.vel) * hh; r.psi += r.vel * hh; }
      if (Math.abs(r.psi - r.target) < 0.002 && Math.abs(r.vel) < 0.03) { r.psi = r.target; r.vel = 0; r.mode = 'rest'; r.lockFlash = 1; r.plateUntil = now + 1400; locked = true; }
    }
    var m = Math.round((r.psi - RG_HALF) / st);
    if (m !== r.m) { r.m = m; r.flash = 1; }
    springStep(r.pawl, r.mode === 'rest' ? 1 : 0, dt, 'lock');      /* the pointer lifts while the ring turns and drops in when it locks */
    return locked;
  }
  /* One arc of a ring, on the near side or the far side only, so the far half can sit back. */
  function rgArc(ctx, E, B, rad, t0, t1, front, flat) {
    var n = Math.max(2, Math.ceil(Math.abs(t1 - t0) / (TAU / 96))), on = false;
    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      var u0 = lerp(t0, t1, i / n), u1 = lerp(t0, t1, (i + 1) / n);
      if (!flat && (Math.sin((u0 + u1) / 2) >= 0) !== front) { on = false; continue; }
      var q;
      if (!on) { q = rgPt(E, B, rad, u0); ctx.moveTo(q[0], q[1]); on = true; }
      q = rgPt(E, B, rad, u1); ctx.lineTo(q[0], q[1]);
    }
  }
  function rgTick(ctx, E, B, rad, t, k0, k1) { var a = rgPt(E, B, rad * k0, t), b = rgPt(E, B, rad * k1, t); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }

  function rgDrawRing(ctx, E, r, front, P) {
    var B = rgBasis(r), rad = r.rf * E.Ro, tone = P[r.tone] || P.loop, flat = B.si < 0.06;
    if (flat && !front) return;                             /* a face-on ring has no far side: it is drawn once */
    var depth = Math.min(1, B.si * 1.15), vis = r.life * (1 - 0.45 * r.dim), act = r.act, near = !flat && !front ? 1 - depth : 1;
    var st = rgStep(r), small = E.Ro < 90, k = rgIndex(r), lw = (r.tone === 'loop' ? 1.25 : 1) + 0.8 * act, j, t;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    /* the ring itself: a hairline, whisper-quiet */
    rgArc(ctx, E, B, rad, flat || front ? 0 : Math.PI, flat ? TAU : front ? Math.PI : TAU, front, true);
    if (act > 0.02) {
      ctx.strokeStyle = rgba(tone, 0.05 * act * vis * lerp(0.4, 1, near)); ctx.lineWidth = lw + 13; ctx.stroke();
      ctx.strokeStyle = rgba(tone, 0.1 * act * vis * lerp(0.4, 1, near)); ctx.lineWidth = lw + 5; ctx.stroke();
    }
    ctx.strokeStyle = rgba(tone, lerp(lerp(0.2, 0.34, act), lerp(0.42, 0.7, act), near) * vis); ctx.lineWidth = lw; ctx.stroke();

    /* each thing's span: how far it has got, and what it is doing */
    var gap = Math.min(0.07, st * 0.16), len = st - gap, per = Math.max(1, Math.round(24 / r.n));
    for (j = 0; j < r.n; j++) {
      var it = r.items[j] || {}, state = rgState(it), t0 = rgMark(r, j) - gap / 2, pr = state === 'done' ? 1 : clamp(+it.progress || 0, 0, 1);
      var col = state === 'failed' ? P.danger : tone, head = t0 - len * pr, done = state === 'done';
      if (pr > 0.001) {
        rgArc(ctx, E, B, rad, t0, head, front, flat);
        /* finished work rests: thinner and quieter than work in hand */
        ctx.strokeStyle = rgba(col, lerp(done ? 0.28 : 0.34, done ? 0.56 : 0.98, near) * vis); ctx.lineWidth = done ? (small ? 1.3 : 1.5) : (small ? 1.6 : 2.1) + 0.6 * act; ctx.stroke();
      }
      if (state === 'working') {
        /* work in progress: dashes crawl ahead of the head, and a bead rides it */
        var ahead = Math.min(len * (1 - pr), Math.max(0.1, len * 0.3)), dash = Math.max(0.03, 7 / Math.max(20, rad)), ph = (E.work * 0.42) % dash;
        ctx.strokeStyle = rgba(col, lerp(0.3, 0.9, near) * vis); ctx.lineWidth = small ? 1.3 : 1.6;
        for (var u = ph - dash; u < ahead; u += dash) {
          var a0 = Math.max(0, u), a1 = Math.min(ahead, u + dash * 0.5);
          if (a1 > a0) { rgArc(ctx, E, B, rad, head - a0, head - a1, front, flat); ctx.stroke(); }
        }
        if (flat || (Math.sin(head) >= 0) === front) {
          var hb = rgPt(E, B, rad, head);
          ctx.beginPath(); ctx.arc(hb[0], hb[1], (small ? 2 : 2.6) + 0.9 * act, 0, TAU);
          ctx.fillStyle = rgba(col, lerp(0.45, 1, near) * vis); ctx.fill();
        }
        /* helpers at work on it ride behind the bead, one small bead each */
        var ag = Math.min(5, Math.max(0, Math.round(+it.agents || 0))), sp = Math.max(0.04, 8 / Math.max(20, rad));
        for (var q = 1; q <= ag && !small; q++) {
          var ta = head + q * sp;
          if (ta > t0 || !(flat || (Math.sin(ta) >= 0) === front)) continue;
          var ab = rgPt(E, B, rad * 1.035, ta);
          ctx.beginPath(); ctx.arc(ab[0], ab[1], 1.5, 0, TAU);
          ctx.fillStyle = rgba(P.ink, lerp(0.4, 0.9, near) * vis); ctx.fill();
        }
      } else if (state === 'failed' && (flat || (Math.sin(head) >= 0) === front)) {
        ctx.beginPath(); rgTick(ctx, E, B, rad, head, 0.94, 1.06);
        ctx.strokeStyle = rgba(P.danger, lerp(0.45, 1, near) * vis); ctx.lineWidth = 2; ctx.stroke();
      }
    }
    /* the marks: one per thing, with the rig's fine divisions between them */
    ctx.lineWidth = 1;
    if (!small) {
      ctx.beginPath();
      for (j = 0; j < r.n * per; j++) {
        if (j % per === 0) continue;
        t = r.psi - (j * st) / per;
        if (flat || (Math.sin(t) >= 0) === front) rgTick(ctx, E, B, rad, t, 1, 1.022);
      }
      ctx.strokeStyle = rgba(tone, lerp(0.09, lerp(0.2, 0.34, act), near) * vis); ctx.stroke();
    }
    ctx.beginPath();
    for (j = 0; j < r.n; j++) {
      t = rgMark(r, j);
      if (j === k || rgState(r.items[j]) === 'waiting') continue;
      if (flat || (Math.sin(t) >= 0) === front) rgTick(ctx, E, B, rad, t, 1, small ? 1.07 : 1.05);
    }
    ctx.strokeStyle = rgba(tone, lerp(lerp(0.26, 0.36, act), lerp(0.6, 0.95, act), near) * vis); ctx.stroke();
    for (j = 0; j < r.n; j++) {
      t = rgMark(r, j);
      if (!(flat || (Math.sin(t) >= 0) === front)) continue;
      var waiting = rgState(r.items[j]) === 'waiting';
      if (waiting) {
        /* waiting on you: the mark turns accent and holds a gate open, steady, with no blinking */
        var g = Math.min(0.06, st * 0.2);
        ctx.beginPath(); rgTick(ctx, E, B, rad, t, 0.93, 1.1); rgTick(ctx, E, B, rad, t - g, 0.965, 1.06); rgTick(ctx, E, B, rad, t + g, 0.965, 1.06);
        ctx.strokeStyle = rgba(P.accent, lerp(0.5, 1, near) * vis); ctx.lineWidth = small ? 1.4 : 1.7; ctx.stroke();
      } else if (j === k) {
        var hot = clamp(Math.max(r.flash, r.lockFlash, act), 0, 1);
        ctx.beginPath(); rgTick(ctx, E, B, rad, t, 1, 1.085 + 0.02 * act);
        ctx.strokeStyle = rgba(mixc(P.ink, P.accent, hot), lerp(0.4, 1, near) * vis); ctx.lineWidth = 1.25 + 0.6 * act; ctx.stroke();
      }
    }
  }
  function rgPlate(ctx, E, P, x, y, cap, label, alpha, hot) {
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = canvasFont(P, 10, 400); var wc = cap ? ctx.measureText(cap).width : 0;
    ctx.font = canvasFont(P, 12, 500); var wl = label ? ctx.measureText(label).width : 0;
    var pw = Math.max(wc, wl) + 16, ph = cap && label ? 36 : 22;
    x = clamp(x, pw / 2 + 2, E.W - pw / 2 - 2); y = clamp(y, ph / 2 + 2, E.H - ph / 2 - 2);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x - pw / 2, y - ph / 2, pw, ph, 2); else ctx.rect(x - pw / 2, y - ph / 2, pw, ph);
    ctx.fillStyle = rgba(P.ground, P.plate * alpha); ctx.fill();
    if (cap) { ctx.font = canvasFont(P, 10, 400); ctx.fillStyle = rgba(P.muted, alpha); ctx.fillText(cap, x - pw / 2 + 8, y + (label ? -8 : 0.5)); }
    if (label) { ctx.font = canvasFont(P, 12, 500); ctx.fillStyle = rgba(mixc(P.ink, P.accent, clamp(hot, 0, 1)), alpha); ctx.fillText(label, x - pw / 2 + 8, y + (cap ? 8 : 0.5)); }
  }
  function rgDrawPointer(ctx, E, r, P) {
    var B = rgBasis(r), rad = r.rf * E.Ro, q = rgPt(E, B, rad, RG_HALF), vis = r.life * (1 - 0.45 * r.dim), sc = clamp(E.Ro / 140, 0.5, 1);
    var nx = -B.so, ny = -B.co;                             /* straight out from the ring, where it faces you */
    var off = rad * 0.105 * B.ci + 5 * sc + (1 - r.pawl.x) * 5 * sc, hot = clamp(Math.max(r.act, r.flash, r.lockFlash), 0, 1);
    var tx = q[0] + nx * off, ty = q[1] + ny * off, bx = q[0] + nx * (off + 8 * sc), by = q[1] + ny * (off + 8 * sc), qx = -ny * 4 * sc, qy = nx * 4 * sc;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(bx + qx, by + qy); ctx.lineTo(bx - qx, by - qy); ctx.closePath();
    ctx.fillStyle = rgba(mixc(P.muted, P.accent, hot), lerp(0.7, 1, hot) * vis); ctx.fill();
    if (r.plate > 0.01) {                                   /* the name of what faces you, only while the ring is in use */
      var it = r.items[rgIndex(r)] || {}, cap = (r.def.label || '') + (it.detail ? (r.def.label ? ' · ' : '') + it.detail : '');
      rgPlate(ctx, E, P, q[0] + nx * (off + 8 * sc + 26), q[1] + ny * (off + 8 * sc + 26), cap.toUpperCase(), it.label || '', r.plate * vis, r.flash * 1.5);
    }
  }

  /* ---------- Rings: sets of things you turn through. A ring's marks are the things; the mark that faces you is where you are;
     each thing's span lights as it advances; the way the span moves says whether it is working, waiting on you, done or failed. ---------- */
  /* one measure, or two: the first is worn closest to the core */
  function rgGauges(g) { return (Array.isArray(g) ? g : g ? [g] : []).filter(function (x) { return x && isFinite(+x.value); }).slice(0, 2); }
  var Rings = React.forwardRef(function Rings(p, ref) {
    var root = useRef(null), cv = useRef(null), coreEl = useRef(null), box = useBox(root), ER = useRef(null), PR = useRef(p), tick = useState(0);
    PR.current = p;
    function eng() {
      if (!ER.current) ER.current = { rings: [], cx: 0, cy: 0, Ro: 0, W: 0, H: 0, grabs: {}, nGrabs: 0, clock: 0, work: 0, driftK: 0, idleAt: 0, pal: null, hover: null, core: 0, started: false };
      return ER.current;
    }
    function bump() { tick[1](function (x) { return x + 1; }); }
    function sync(E) {
      var defs = (PR.current.rings || []).slice(0, 5), n = Math.max(1, defs.length), set = RG_SETS[n], seen = {}, i, j;
      for (i = 0; i < defs.length; i++) {
        var d = defs[i] || {}, id = d.id != null ? String(d.id) : 'ring-' + i, kind = RG_KIND[d.kind] ? d.kind : set[i][0], K = RG_KIND[kind];
        var items = d.items || [], N = Math.max(1, items.length), r = null, want = d.value != null ? rgFind(items, d.value) : -1;
        for (j = 0; j < E.rings.length; j++) if (E.rings[j].id === id) r = E.rings[j];
        if (!r) {
          var k0 = want >= 0 ? want : Math.max(0, d.defaultValue != null ? rgFind(items, d.defaultValue) : 0), psi = RG_HALF + k0 * (TAU / N);
          r = { id: id, psi: psi, vel: 0, target: psi, tau: RG_GLIDE, mode: 'rest', m: Math.round((psi - RG_HALF) / (TAU / N)), n: N, omega: K.omega, iota: (K.iota * DEG), rf: set[i][1],
            life: E.started ? 0 : 1, act: 0, dim: 0, hover: false, focus: false, holder: null, flash: 0, lockFlash: 0, pawl: { x: 1, v: 0 }, plate: 0, plateUntil: 0, wheelUntil: 0, hist: [],
            applied: d.value, reported: items[k0] ? items[k0].id : null, sel: k0 };
          E.rings.push(r);
        }
        r.def = d; r.items = items; r.K = K; r.tone = d.tone === 'a' || d.tone === 'b' || d.tone === 'loop' || d.tone === 'halo' ? d.tone : K.tone; r.rfT = set[i][1]; r.leaving = false;
        r.tilt = d.tilt != null && isFinite(d.tilt) ? clamp(+d.tilt, 0, 72) : K.iota;
        if (r.n !== N) { r.n = N; r.m = Math.round((r.psi - RG_HALF) / (TAU / N)); if (r.mode !== 'held') { r.target = rgAlign(r, r.psi); r.mode = 'lock'; } }
        if (d.value !== r.applied) { r.applied = d.value; if (want >= 0 && want !== rgIndex(r) && r.mode !== 'held') rgBring(r, want); }
        seen[id] = 1;
      }
      for (j = 0; j < E.rings.length; j++) if (!seen[E.rings[j].id]) E.rings[j].leaving = true;
      E.rings.sort(function (a, b) { return a.rfT - b.rfT; });
    }
    function clientPoint(E, r, j) {
      var c = cv.current; if (!c) return null;
      var rc = c.getBoundingClientRect(), q = rgPt(E, rgBasis(r), r.rf * E.Ro, rgMark(r, j));
      return { x: rc.left + q[0], y: rc.top + q[1] };
    }
    function open(E, r, j) { var P0 = PR.current, it = r.items[rgMod(j, r.n)]; if (it && P0.onOpen) P0.onOpen(it, r.def, clientPoint(E, r, j)); }
    React.useImperativeHandle(ref, function () {
      return {
        /* where a thing's mark is on screen right now, in client coordinates: what an Opening hangs from */
        pointOf: function (ringId, itemId) {
          var E = eng();
          for (var i = 0; i < E.rings.length; i++) if (E.rings[i].id === String(ringId)) { var j = rgFind(E.rings[i].items, itemId); return j < 0 ? null : clientPoint(E, E.rings[i], j); }
          return null;
        },
        /* the direction of a thing's mark from the core, in degrees, for the Core's `azimuth`: what it reads from or writes to */
        azimuthOf: function (ringId, itemId) {
          var pt = this.pointOf(ringId, itemId), E = eng(), el = cv.current;
          if (!pt || !el) return null;
          var rc = el.getBoundingClientRect();
          return Math.atan2(rc.top + E.cy - pt.y, pt.x - rc.left - E.cx) / DEG;
        },
      };
    });

    useFrame(root, function (dt, now) {
      var el = root.current, c = cv.current, W = box.current.w, H = box.current.h, P0 = PR.current;
      if (!el || !c || !W || !H) return;
      var E = eng(), i, r;
      if (!E.pal) E.pal = new LivePalette(el);
      E.pal.step(now, dt);
      sync(E); E.started = true;
      var mn = Math.min(W, H), rm = reducedMotion() ? 0.35 : 1;
      E.W = W; E.H = H; E.cx = W / 2; E.cy = H / 2; E.Ro = Math.max(14, (mn / 2 - clamp(mn * 0.085, 5, 30)) / 1.08);
      var cs = Math.round((2 * E.Ro) / 2.3);
      if (coreEl.current && E.core !== cs) { E.core = cs; coreEl.current.style.width = cs + 'px'; coreEl.current.style.height = cs + 'px'; }

      /* The rings drift when left alone, and hold still the moment you touch one or open something. */
      var held = E.nGrabs > 0, busy = held || !!P0.hold, anyHeld = false, changed = false;
      for (i = 0; i < E.rings.length; i++) { r = E.rings[i]; if (r.mode !== 'rest' || r.focus) busy = true; if (r.mode === 'held' || r.mode === 'wheel') anyHeld = true; }
      if (busy) E.idleAt = now + 700;
      E.driftK = held ? 0 : ease(E.driftK, P0.drift !== false && now > E.idleAt ? 1 : 0, dt, 0.45);
      var rate = E.driftK * rm;
      E.clock += dt * rate; E.work += dt * rm;
      for (i = 0; i < E.rings.length; i++) {
        r = E.rings[i];
        if (rgAdvance(r, dt, now)) {
          var it = r.items[rgIndex(r)];
          r.sel = rgIndex(r); changed = true;
          if (it && it.id !== r.reported) { r.reported = it.id; if (P0.onChange) P0.onChange(it, r.def); }
        }
        r.omega += r.K.drift * dt * rate;
        r.iota = ease(r.iota, (r.tilt + r.K.wob * Math.sin(E.clock * 0.31)) * DEG * (r.tilt > 0 ? 1 : 0), dt, 0.18);
        r.rf = ease(r.rf, r.rfT, dt, 0.16);
        r.life = ease(r.life, r.leaving ? 0 : 1, dt, r.leaving ? 0.1 : 0.2);
        var actT = r.mode === 'held' || r.mode === 'wheel' || r.focus ? 1 : r.mode !== 'rest' ? 0.7 : r.hover ? 0.4 : 0;
        r.act = ease(r.act, actT, dt, actT > r.act ? 0.06 : 0.24);
        var plateT = r.mode !== 'rest' || r.focus || now < r.plateUntil ? 1 : 0;
        r.plate = ease(r.plate, plateT, dt, plateT > r.plate ? 0.05 : 0.2);
        r.dim = ease(r.dim, anyHeld && actT < 0.7 ? 1 : 0, dt, 0.16);
        r.flash *= Math.exp(-dt / 0.16); r.lockFlash *= Math.exp(-dt / 0.45);
      }
      for (i = E.rings.length - 1; i >= 0; i--) if (E.rings[i].leaving && E.rings[i].life < 0.02) E.rings.splice(i, 1);
      if (changed) bump();

      var dpr = dprNow(), ctx = c.getContext('2d'), P = E.pal.c;
      fitCanvas(c, W, H, dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      for (i = 0; i < E.rings.length; i++) rgDrawRing(ctx, E, E.rings[i], false, P);
      for (i = 0; i < E.rings.length; i++) rgDrawRing(ctx, E, E.rings[i], true, P);
      for (i = 0; i < E.rings.length; i++) rgDrawPointer(ctx, E, E.rings[i], P);
      /* one measure, worn by the core: a hairline that fills clockwise, quiet until it is high */
      var ggs = rgGauges(P0.gauge), g0 = Math.max(8, E.Ro * 0.27), gstep = Math.max(5, E.Ro * 0.047);
      E.gaugeR = ggs.length ? g0 : 0; E.gaugeOut = ggs.length ? g0 + (ggs.length - 1) * gstep : 0;
      for (var gi = 0; gi < ggs.length; gi++) {
        var gg = ggs[gi], gv = clamp(+gg.value, 0, 1), gr = g0 + gi * gstep, high = gv >= (gg.warn == null ? 0.8 : +gg.warn), full = gv >= (gg.danger == null ? 1 : +gg.danger), gcol = full ? P.danger : high ? P.warn : P.muted, gh = E.overGauge === gi + 1 ? 1 : 0;
        ctx.lineCap = 'butt';
        ctx.beginPath(); ctx.arc(E.cx, E.cy, gr, 0, TAU); ctx.strokeStyle = rgba(P.muted, 0.16); ctx.lineWidth = 1; ctx.stroke();
        if (gv > 0.002) { ctx.beginPath(); ctx.arc(E.cx, E.cy, gr, -RG_HALF, -RG_HALF + TAU * gv); ctx.strokeStyle = rgba(gcol, high || gh ? 0.95 : 0.6); ctx.lineWidth = high || gh ? 2 : 1.4; ctx.stroke(); }
        if (gh) rgPlate(ctx, E, P, E.cx, E.cy - E.gaugeOut - 20, ((gg.label || 'Load') + ' \u00b7 ' + (gg.detail || Math.round(gv * 100) + '%')).toUpperCase(), '', 1, 0);
      }
      /* under a mouse, the mark you point at names itself; you turn to it or click it */
      var hv = E.hover;
      if (hv && hv.r.mode === 'rest' && !hv.r.leaving && rgMod(hv.j, hv.r.n) !== rgIndex(hv.r)) {
        var hi = hv.r.items[rgMod(hv.j, hv.r.n)], hq = rgPt(E, rgBasis(hv.r), hv.r.rf * E.Ro * 1.02, rgMark(hv.r, hv.j));
        if (hi && hi.label) rgPlate(ctx, E, P, hq[0], hq[1] - 20, '', hi.label, 1, 0);
      }
    });

    /* ---------- hands ---------- */
    function local(e) { var rc = cv.current.getBoundingClientRect(); return [e.clientX - rc.left, e.clientY - rc.top]; }
    function bandFor(e) { var cs = getComputedStyle(root.current), t = e.pointerType === 'touch'; return parseFloat(cs.getPropertyValue(t ? '--size-grab-touch' : '--size-grab')) || (t ? 30 : 14); }
    function setHover(E, r, j) {
      for (var i = 0; i < E.rings.length; i++) E.rings[i].hover = E.rings[i] === r;
      E.hover = r ? { r: r, j: j } : null;
      if (cv.current) cv.current.style.cursor = E.nGrabs ? 'grabbing' : r ? 'grab' : (E.overCore && PR.current.onCore) || (E.overGauge && PR.current.onGauge) ? 'pointer' : '';
    }
    function onDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      var E = eng(), xy = local(e), r = rgAt(E, xy[0], xy[1], bandFor(e));
      if (!r) {
        var dd = Math.hypot(xy[0] - E.cx, xy[1] - E.cy), gtol = e.pointerType === 'touch' ? 14 : 8, onG = !!PR.current.onGauge && E.gaugeR > 0 && dd > E.gaugeR - gtol && dd < E.gaugeOut + gtol;
        E.coreDown = onG || dd < E.Ro / 2.3 ? { x: xy[0], y: xy[1], t: e.timeStamp, gauge: onG, gi: onG && E.gaugeOut > E.gaugeR && dd > (E.gaugeR + E.gaugeOut) / 2 ? 1 : 0 } : null;
        return;
      }
      e.preventDefault();
      try { cv.current.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      var moving = r.mode !== 'rest';                          /* a touch on a spinning ring catches it */
      r.mode = 'held'; r.holder = e.pointerId; r.vel = 0; r.hist = [[e.timeStamp, r.psi]];
      E.grabs[e.pointerId] = { r: r, last: rgAngle(E, rgBasis(r), xy[0], xy[1]), x0: xy[0], y0: xy[1], t0: e.timeStamp, travel: 0, moving: moving, touch: e.pointerType === 'touch' };
      E.nGrabs++;
      setHover(E, e.pointerType === 'mouse' ? r : null, 0); E.hover = null;
    }
    function onMove(e) {
      var E = eng(), xy = local(e), g = E.grabs[e.pointerId];
      if (!g) {
        if (e.pointerType !== 'mouse') return;
        var hr = rgAt(E, xy[0], xy[1], 14);
        var dc = Math.hypot(xy[0] - E.cx, xy[1] - E.cy);
        E.overGauge = !hr && E.gaugeR > 0 && dc > E.gaugeR - 8 && dc < E.gaugeOut + 8 ? (E.gaugeOut > E.gaugeR && dc > (E.gaugeR + E.gaugeOut) / 2 ? 2 : 1) : 0;
        E.overCore = !hr && !E.overGauge && dc < E.Ro / 2.3;
        setHover(E, hr, hr ? rgItemAt(E, hr, xy[0], xy[1]) : 0);
        return;
      }
      var r = g.r, a = rgAngle(E, rgBasis(r), xy[0], xy[1]), d = wrapPi(a - g.last);
      g.last = a; r.psi += d; g.travel = Math.max(g.travel, Math.hypot(xy[0] - g.x0, xy[1] - g.y0));
      r.hist.push([e.timeStamp, r.psi]);
      while (r.hist.length > 2 && e.timeStamp - r.hist[0][0] > 110) r.hist.shift();
    }
    function onUp(e, cancelled) {
      var E = eng(), g = E.grabs[e.pointerId];
      if (!g) {
        if (!cancelled && E.coreDown && e.timeStamp - E.coreDown.t < 500 && (PR.current.onCore || PR.current.onGauge)) { var cxy = local(e); if (Math.hypot(cxy[0] - E.coreDown.x, cxy[1] - E.coreDown.y) < 10) { if (E.coreDown.gauge && PR.current.onGauge) { var grc = cv.current.getBoundingClientRect(); PR.current.onGauge({ x: grc.left + E.cx, y: grc.top + E.cy - E.gaugeOut }, E.coreDown.gi); } else if (!E.coreDown.gauge) PR.current.onCore(); } }
        E.coreDown = null; return;
      }
      delete E.grabs[e.pointerId]; E.nGrabs = Math.max(0, E.nGrabs - 1);
      var r = g.r; r.holder = null;
      try { cv.current.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (cv.current) cv.current.style.cursor = '';
      if (r.leaving) return;
      if (!cancelled && g.travel < (g.touch ? 10 : 5) && e.timeStamp - g.t0 < 400) {     /* a tap, not a turn */
        if (g.moving) { rgRelease(r, 0, performance.now()); return; }
        var xy = local(e), j = rgItemAt(E, r, xy[0], xy[1]);
        r.psi = r.hist[0][1];
        /* tap a mark and it comes round to you; tap the one already facing you and it opens */
        if (rgMod(j, r.n) === rgIndex(r)) { r.mode = 'rest'; r.plateUntil = performance.now() + 1400; open(E, r, j); } else rgBring(r, j);
        return;
      }
      var v = 0, hs = r.hist;
      if (hs.length >= 2) { var a = hs[0], b = hs[hs.length - 1], span = b[0] - a[0]; if (span > 12 && e.timeStamp - b[0] < 90) v = (b[1] - a[1]) / (span / 1000); }
      rgRelease(r, clamp(v, -RG_VMAX, RG_VMAX), performance.now());
    }
    useEffect(function () {
      var c = cv.current;
      if (!c) return;
      function onWheel(e) {
        var E = eng(), xy = local(e), r = rgAt(E, xy[0], xy[1], 16);
        if (!r) return;
        e.preventDefault();
        var px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 120 : e.deltaY;
        r.psi -= clamp(px, -240, 240) * 0.0024; r.mode = 'wheel'; r.vel = 0; r.wheelUntil = performance.now() + 150;
      }
      c.addEventListener('wheel', onWheel, { passive: false });
      return function () { c.removeEventListener('wheel', onWheel); };
    }, []);
    function onKey(e, id) {
      var E = eng(), r = null, i;
      for (i = 0; i < E.rings.length; i++) if (E.rings[i].id === id) r = E.rings[i];
      if (!r) return;
      var st = rgStep(r), base = r.mode === 'seek' || r.mode === 'lock' ? r.target : rgAlign(r, r.psi), d = 0;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') d = 1;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') d = -1;
      else if (e.key === 'Home') { e.preventDefault(); rgJump(r, base + wrapPi(RG_HALF - base)); return; }
      else if (e.key === 'End') { e.preventDefault(); rgJump(r, base + wrapPi(RG_HALF + (r.n - 1) * st - base)); return; }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (r.mode === 'rest') open(E, r, rgIndex(r)); return; }
      else return;
      e.preventDefault(); rgJump(r, base + d * st);
    }
    function setFocus(id, on) { var E = eng(); for (var i = 0; i < E.rings.length; i++) if (E.rings[i].id === id) { E.rings[i].focus = on; if (!on) E.rings[i].plateUntil = performance.now() + 1400; } }

    var E0 = eng(), defs = (p.rings || []).slice(0, 5);
    return h('div', { ref: root, className: cx('ast-rings', p.className), style: p.style, role: 'group', 'aria-label': p.label || 'Instrument' },
      h('div', { ref: coreEl, className: 'ast-rings-core' }, p.children),
      h('canvas', {
        ref: cv, className: 'ast-rings-canvas', 'aria-hidden': 'true',
        onPointerDown: onDown, onPointerMove: onMove, onPointerUp: function (e) { onUp(e, false); }, onPointerCancel: function (e) { onUp(e, true); },
        onLostPointerCapture: function (e) { onUp(e, true); }, onPointerLeave: function (e) { var E = eng(); if (e.pointerType === 'mouse' && !E.nGrabs) { E.overCore = false; E.overGauge = false; setHover(E, null, 0); } },
        onContextMenu: function (e) { e.preventDefault(); },
      }),
      /* every ring is a slider: arrows turn it a mark at a time, Enter opens what faces you */
      defs.map(function (d, i) {
        var id = d.id != null ? String(d.id) : 'ring-' + i, items = d.items || [], r = null, j;
        for (j = 0; j < E0.rings.length; j++) if (E0.rings[j].id === id) r = E0.rings[j];
        var k = r ? clamp(r.sel, 0, Math.max(0, items.length - 1)) : Math.max(0, rgFind(items, d.value != null ? d.value : d.defaultValue)), it = items[k] || {};
        return h('div', {
          key: id, className: 'ast-sr ast-rings-slider', role: 'slider', tabIndex: 0, 'aria-label': d.label || 'Ring ' + (i + 1), 'aria-orientation': 'horizontal',
          'aria-valuemin': 1, 'aria-valuemax': Math.max(1, items.length), 'aria-valuenow': k + 1,
          'aria-valuetext': (it.label || 'Mark ' + (k + 1)) + ', ' + RG_WORD[rgState(it)] + (it.detail ? ', ' + it.detail : ''),
          onFocus: function () { setFocus(id, true); }, onBlur: function () { setFocus(id, false); }, onKeyDown: function (e) { onKey(e, id); },
        });
      }),
      rgGauges(p.gauge).map(function (g, gi) { return h('div', { key: 'gauge-' + gi, className: 'ast-sr', role: 'meter', tabIndex: p.onGauge ? 0 : undefined, 'aria-label': g.label || 'Load', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(clamp(+g.value || 0, 0, 1) * 100), 'aria-valuetext': g.detail || undefined, onKeyDown: function (e) { if (p.onGauge && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); p.onGauge(null, gi); } } }); }),
      p.onCore ? h('button', { type: 'button', className: 'ast-sr', onClick: p.onCore }, p.coreLabel || 'Call the companion') : null);
  });

  /* ---------- Track: one thing's course, as a line you can read along. Its ticks are the steps; it is lit to where it has got;
     dashes crawl where it is working; point along it and each step names itself; click a step and it opens. ---------- */
  var TRACK_WORD = { done: 'done', live: 'in progress', next: 'not started', failed: 'failed', waiting: 'waiting on you' };
  function Track(p) {
    var root = useRef(null), steps = p.steps || [], n = Math.max(1, steps.length), hv = useState(-1), at = hv[0];
    var first = -1, i;
    for (i = 0; i < steps.length; i++) if (steps[i].state !== 'done') { first = i; break; }
    var doneN = first < 0 ? n : first, liveState = first < 0 ? null : steps[first].state;
    var sel = p.value != null ? rgFind(steps, p.value) : -1, shown = at >= 0 ? at : sel;
    function open(idx, e) {
      if (!p.onOpen || !steps[idx]) return;
      var rc = root.current.getBoundingClientRect();
      p.onOpen(steps[idx], { x: rc.left + rc.width * ((idx + 0.5) / n), y: rc.top + rc.height / 2 });
    }
    return h('div', { ref: root, className: cx('ast-track', p.className), style: assign({ '--ast-track-n': n }, p.style), role: 'group', 'aria-label': (p.label || 'Steps') + ': ' + doneN + ' of ' + n + ' done', 'data-state': liveState || 'done', onPointerLeave: function () { hv[1](-1); } },
      h('span', { className: 'ast-track-line', 'aria-hidden': 'true' },
        h('span', { className: 'ast-track-lit', style: { width: (100 * doneN) / n + '%' } }),
        liveState === 'live' ? h('span', { className: 'ast-track-crawl', style: { left: (100 * doneN) / n + '%', width: 100 / n + '%' } }) : null,
        liveState === 'failed' ? h('span', { className: 'ast-track-fail', style: { left: (100 * doneN) / n + '%', width: 100 / n + '%' } }) : null),
      first >= 0 && liveState !== 'next' ? h('span', { className: 'ast-track-head', 'aria-hidden': 'true', 'data-state': liveState, style: { left: (100 * doneN) / n + '%' } }) : null,
      steps.map(function (s, idx) {
        var state = TRACK_WORD[s.state] ? s.state : 'next';
        return h('button', {
          key: s.id != null ? s.id : idx, type: 'button', className: 'ast-track-step', 'data-state': state, 'data-on': idx === shown ? 'true' : 'false',
          style: { left: (100 * idx) / n + '%', width: 100 / n + '%' }, 'aria-label': 'Step ' + (idx + 1) + ' of ' + n + ': ' + s.label + ', ' + TRACK_WORD[state],
          onPointerEnter: function () { hv[1](idx); }, onFocus: function () { hv[1](idx); }, onBlur: function () { hv[1](-1); }, onClick: function (e) { open(idx, e); },
        });
      }),
      shown >= 0 && steps[shown] ? h('span', { className: 'ast-track-plate canvas-plate', 'aria-hidden': 'true', 'data-edge': shown < n * 0.2 ? 'start' : shown > n * 0.8 ? 'end' : 'mid', style: { left: (100 * (shown + 0.5)) / n + '%' } },
        h('span', { className: 'ast-track-num' }, String(shown + 1).padStart(2, '0')), ' ', steps[shown].label) : null);
  }

  /* ---------- Opening: what a deliberate click opened, hung from the mark it came out of. This is where words, lists and
     history live. One at a time; it folds back into its mark when you are done. ---------- */
  function Opening(p) {
    var root = useRef(null), plate = useRef(null), line = useRef(null), dot = useRef(null), L = useRef({ side: '', x: 0, y: 0, ok: false }), ps = useState(null), pos = ps[0];
    var anchorRef = useRef(p.anchor); anchorRef.current = p.anchor;
    var closeRef = useRef(p.onClose); closeRef.current = p.onClose;
    function anchorNow() {
      var a = anchorRef.current, host = root.current && root.current.offsetParent;
      if (typeof a === 'function') a = a();
      if (!a || !host) return null;
      var rc = host.getBoundingClientRect();
      return { x: a.x - rc.left, y: a.y - rc.top, W: rc.width, H: rc.height };
    }
    /* place the plate once, on the side with room; on a narrow screen it is a sheet at the foot */
    React.useLayoutEffect(function () {
      if (!p.open) { ps[1](null); L.current.ok = false; return; }
      var a = anchorNow(), el = plate.current;
      if (!el) return;
      var w = el.offsetWidth, hgt = el.offsetHeight, gap = 40, pad = 12;
      if (!a || a.W < 560) { ps[1]({ side: 'sheet' }); return; }
      var side = p.side === 'left' || p.side === 'right' || p.side === 'above' || p.side === 'below' ? p.side : a.x < a.W / 2 ? 'right' : 'left';
      if (side === 'right' && a.x + gap + w > a.W - pad) side = a.x - gap - w >= pad ? 'left' : 'below';
      if (side === 'left' && a.x - gap - w < pad) side = a.x + gap + w <= a.W - pad ? 'right' : 'below';
      if (side === 'below' && a.y + gap + hgt > a.H - pad) side = 'above';
      var x, y, av = p.avoid;
      if (side === 'right' || side === 'left') {
        x = side === 'right' ? a.x + gap : a.x - gap - w;
        /* where there is room, it stands clear of the object it came from, so the object stays whole */
        if (av && side === 'right' && av.right + 16 + w <= a.W - pad) x = Math.max(x, av.right + 16);
        if (av && side === 'left' && av.left - 16 - w >= pad) x = Math.min(x, av.left - 16 - w);
        y = clamp(a.y - Math.min(hgt * 0.3, 56), pad, Math.max(pad, a.H - hgt - pad));
      }
      else { x = clamp(a.x - w / 2, pad, Math.max(pad, a.W - w - pad)); y = side === 'below' ? a.y + gap : a.y - gap - hgt; }
      ps[1]({ side: side, x: x, y: y, w: w, h: hgt });
    }, [!!p.open, p.side]);
    /* the leader follows the mark while the instrument drifts */
    L.current.pos = pos;
    useEffect(function () {
      if (!p.open) return;
      var raf = 0, alive = true;
      function draw() {
        if (!alive) return;
        raf = requestAnimationFrame(draw);
        var ln = line.current, d = dot.current, po = L.current.pos;
        if (!ln || !d || !po || po.side === 'sheet') return;
        var a = anchorNow();
        if (!a) return;
        var ex = po.side === 'right' ? po.x : po.side === 'left' ? po.x + po.w : clamp(a.x, po.x + 12, po.x + po.w - 12);
        var ey = po.side === 'below' ? po.y : po.side === 'above' ? po.y + po.h : clamp(a.y, po.y + 14, po.y + po.h - 14);
        ln.setAttribute('x1', a.x.toFixed(1)); ln.setAttribute('y1', a.y.toFixed(1)); ln.setAttribute('x2', ex.toFixed(1)); ln.setAttribute('y2', ey.toFixed(1));
        d.setAttribute('cx', a.x.toFixed(1)); d.setAttribute('cy', a.y.toFixed(1));
      }
      draw();
      return function () { alive = false; cancelAnimationFrame(raf); };
    }, [!!p.open]);
    useEffect(function () {
      if (!p.open) return;
      function onKey(e) { if (e.key === 'Escape' && closeRef.current) { e.stopPropagation(); closeRef.current(); } }
      function onDown(e) { if (plate.current && !plate.current.contains(e.target) && closeRef.current && !(e.target.closest && e.target.closest('[data-ast-keeps-opening]'))) closeRef.current(); }
      document.addEventListener('keydown', onKey);
      var t = setTimeout(function () { document.addEventListener('pointerdown', onDown); }, 0);
      if (plate.current) plate.current.focus({ preventScroll: true });
      return function () { clearTimeout(t); document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); };
    }, [!!p.open]);
    if (!p.open) return null;
    var sheet = pos && pos.side === 'sheet', ready = !!pos;
    return h('div', { ref: root, className: cx('ast-opening', p.className), 'data-side': pos ? pos.side : 'right', 'data-ready': ready ? 'true' : 'false' },
      !sheet ? h('svg', { className: 'ast-opening-leader', 'aria-hidden': 'true' }, h('line', { ref: line }), h('circle', { ref: dot, r: 5 })) : null,
      h('section', {
        ref: plate, className: 'ast-opening-plate', role: 'dialog', 'aria-label': p.title || p.source || 'Detail', tabIndex: -1,
        style: assign({ width: sheet ? undefined : p.width || undefined }, pos && !sheet ? { left: pos.x, top: pos.y } : null, p.style),
      },
        h('header', { className: 'ast-opening-head' },
          h('button', { type: 'button', className: 'ast-opening-close', 'aria-label': 'Back', title: 'Back (Esc)', onClick: function () { if (p.onClose) p.onClose(); } }, h(Icon, { name: 'back' })),
          h('span', { className: 'ast-opening-source caption-caps' }, p.source || '')),
        p.title || p.status ? h('div', { className: 'ast-opening-titlerow' }, h('h3', { className: 'ast-opening-title field-text' }, p.title), p.status ? h(Badge, { tone: p.tone }, p.status) : null) : null,
        h('div', { className: 'ast-opening-body' }, p.children)));
  }


  /* ---------- CopyButton: copies, then says so for two seconds. Not a component of its own: ToolRow and Prose carry it. ---------- */
  function copyText(text, done) {
    var fallback = function () {
      try { var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); var ok = document.execCommand('copy'); document.body.removeChild(ta); done(!!ok); } catch (e) { done(false); }
    };
    try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, fallback); else fallback(); } catch (e) { fallback(); }
  }
  function CopyButton(p) {
    var st = useState(false), ok = st[0];
    useEffect(function () { if (!ok) return undefined; var t = setTimeout(function () { st[1](false); }, 2000); return function () { clearTimeout(t); }; }, [ok]);
    var word = ok ? 'Copied' : p.label || 'Copy';
    return h('button', { type: 'button', className: cx('ast-copy', p.className), 'aria-label': word, title: word, 'data-done': ok ? 'true' : undefined,
      onClick: function (e) { e.stopPropagation(); copyText(String(typeof p.text === 'function' ? p.text() : p.text), function (y) { if (y) st[1](true); }); },
      onKeyDown: function (e) { e.stopPropagation(); } },
      h(Icon, { key: ok ? 'y' : 'n', name: ok ? 'check' : 'copy' }));
  }

  /* ---------- ToolRow: one thing the session did, folded to a line. Its mark, its name, what it acted on, and how it came out;
     the whole line opens it. A thought is the same row, and so is a run of the same tool, counted. ---------- */
  /* The words are the ones a session's own state is said in everywhere else. A row that finished says nothing: it is the ordinary case. */
  var TOOL_STATE = { running: ['Working', 'info'], error: ['Failed', 'danger'], denied: ['Denied', 'warn'], waiting: ['Needs you', 'warn'], allowed: ['Allowed by you', null] };
  function ToolRow(p) {
    var out = p.output == null ? '' : String(p.output).replace(/\s+$/, ''), hasOut = out.length > 0;
    var n = p.lines != null ? p.lines : hasOut ? out.split('\n').length : 0;
    var cmd = p.command && p.command !== p.title ? p.command : null;
    var can = hasOut || !!cmd || (p.children != null && p.children !== false);
    var st = useState(!!p.defaultOpen), open = can && (p.open != null ? !!p.open : st[0]);
    var toggle = function () { if (!can) return; st[1](!open); if (p.onOpenChange) p.onOpenChange(!open); };
    var S = TOOL_STATE[p.state] || null, running = p.state === 'running', d = p.diff, has = p.title != null && p.title !== '';
    var stop = function (e) { e.stopPropagation(); };
    return h('div', { id: p.id, className: cx('ast-tool', p.className), 'data-open': open ? 'true' : 'false', 'data-state': p.state || undefined, 'data-can': can ? 'true' : 'false', style: p.style },
      h('div', { className: 'ast-tool-head', role: can ? 'button' : undefined, tabIndex: can ? 0 : undefined, 'aria-expanded': can ? open : undefined, onClick: toggle,
        onKeyDown: function (e) { if (!can || e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } } },
        h(Icon, { name: p.icon || 'tool', className: 'ast-tool-icon' }),
        h('span', { className: 'ast-tool-label row-text' }, p.label),
        p.count > 1 ? h('span', { className: 'ast-tool-count telemetry' }, '×' + p.count) : null,
        d && (d.added || d.removed) ? h('span', { className: 'ast-tool-diff telemetry', 'aria-label': (d.added || 0) + ' lines added, ' + (d.removed || 0) + ' removed' },
          d.added ? h('span', { 'data-kind': 'add' }, '+' + d.added) : null, d.removed ? h('span', { 'data-kind': 'del' }, '−' + d.removed) : null) : null,
        has ? h('span', { className: 'ast-tool-sep', 'aria-hidden': 'true' }, '/') : null,
        has ? (p.onTitle
          ? h('button', { type: 'button', className: 'ast-tool-title ast-tool-link field-value', 'data-ast-keeps-opening': '', title: typeof p.title === 'string' ? p.title : undefined, onClick: function (e) { e.stopPropagation(); p.onTitle(e); }, onKeyDown: stop }, p.title)
          : h('span', { className: cx('ast-tool-title', p.mono ? 'field-value' : 'row-text'), title: typeof p.title === 'string' ? p.title : undefined }, p.title)) : null,
        h('span', { className: 'ast-tool-end' },
          p.note ? h('span', { className: 'ast-tool-note telemetry' }, p.note) : null,
          p.copy ? h(CopyButton, { text: p.copy, label: p.copyLabel || 'Copy', className: 'ast-tool-copy' }) : null,
          !open && n > 0 && !running ? h('span', { className: 'ast-tool-lines telemetry' }, n + (n === 1 ? ' line' : ' lines')) : null,
          running ? h(SignalLoop, { state: 'working', size: 12 }) : null,
          S ? h('span', { className: 'ast-tool-state status-word', 'data-tone': S[1] || undefined }, S[0]) : null)),
      open ? h('div', { className: 'ast-tool-body' },
        /* under a finger the copy is inside, where it does not crowd the line */
        p.copy ? h(CopyButton, { text: p.copy, label: p.copyLabel || 'Copy', className: 'ast-tool-copy-in' }) : null,
        cmd ? h('pre', { className: 'ast-tool-cmd field-value' }, h('span', { className: 'ast-tool-prompt', 'aria-hidden': 'true' }, '$ '), cmd) : null,
        hasOut ? h('pre', { className: 'ast-tool-out field-value', 'data-error': p.state === 'error' ? 'true' : undefined, tabIndex: 0 }, out) : null,
        p.children) : null);
  }

  /* ---------- Prose: what the session wrote, read as markdown and set to be read. Plain marks stay plain; the forms a reply
     reaches for (a line that introduces a list, a callout, a verdict, a few numbers, a diff, a long output) each get one quiet shape.
     The same rules dress markup you render yourself: put `ast-prose reading` on its container. ---------- */
  var LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/, FENCE_RE = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/, HEAD_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/, HR_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
  var TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
  var VERDICT_RE = /^VERDICT:\s+(PASS|FAIL)(?:\s+[—–-]\s+B:(\d+)\s+H:(\d+)\s+M:(\d+)\s+L:(\d+))?$/, ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/i;
  var ALERT_TONE = { note: 'info', important: 'info', tip: 'positive', warning: 'warn', caution: 'danger' };
  var LEAD_MAX = 120, LONG_LINES = 25, LONG_PREVIEW = 12;
  function indentOf(s) { return /^\s*/.exec(s)[0].replace(/\t/g, '    ').length; }
  function cells(line) { var s = line.trim(); if (s.charAt(0) === '|') s = s.slice(1); if (s.charAt(s.length - 1) === '|' && s.charAt(s.length - 2) !== '\\') s = s.slice(0, -1); return s.split(/(?<!\\)\|/).map(function (c) { return c.trim().replace(/\\\|/g, '|'); }); }
  function startsBlock(lines, i) { var ln = lines[i]; return FENCE_RE.test(ln) || HEAD_RE.test(ln) || HR_RE.test(ln) || /^\s*>/.test(ln) || LIST_RE.test(ln) || (ln.indexOf('|') >= 0 && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].indexOf('-') >= 0); }
  function parseList(lines, i) {
    var base = indentOf(lines[i]), m0 = LIST_RE.exec(lines[i]), ordered = /\d/.test(m0[2]), items = [];
    while (i < lines.length) {
      var ln = lines[i];
      if (!ln.trim()) {
        var j = i + 1; while (j < lines.length && !lines[j].trim()) j++;
        if (j < lines.length && items.length && (indentOf(lines[j]) >= base + 2 || (LIST_RE.test(lines[j]) && indentOf(lines[j]) >= base && /\d/.test(LIST_RE.exec(lines[j])[2]) === ordered))) { i = j; continue; }
        break;
      }
      var m = LIST_RE.exec(ln), ind = indentOf(ln);
      if (m && !HR_RE.test(ln)) {
        if (ind < base) break;
        if (ind < base + 2) { if (/\d/.test(m[2]) !== ordered) break; var task = /^\[( |x|X)\]\s+(.*)$/.exec(m[3]); items.push({ text: task ? task[2] : m[3], task: task ? (task[1] === ' ' ? 'open' : 'done') : null, kids: [] }); i++; continue; }
        if (!items.length) break;
        var sub = parseList(lines, i); items[items.length - 1].kids.push(sub.node); i = sub.next; continue;
      }
      if (ind >= base + 2 && items.length && !FENCE_RE.test(ln)) { items[items.length - 1].text += '\n' + ln.trim(); i++; continue; }
      break;
    }
    return { node: { t: 'list', ordered: ordered, start: ordered ? parseInt(m0[2], 10) : null, items: items }, next: i };
  }
  function parseBlocks(src) {
    var lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n'), out = [], i = 0, m;
    while (i < lines.length) {
      var ln = lines[i];
      if (!ln.trim()) { i++; continue; }
      if ((m = FENCE_RE.exec(ln))) {
        var mark = m[1], body = []; i++;
        while (i < lines.length && !(lines[i].trim().indexOf(mark) === 0 && /^\s*[`~]+\s*$/.test(lines[i]))) { body.push(lines[i]); i++; }
        out.push({ t: 'code', lang: m[2] || '', text: body.join('\n'), closed: i < lines.length }); i++; continue;
      }
      if ((m = HEAD_RE.exec(ln))) { out.push({ t: 'h', n: m[1].length, text: m[2] }); i++; continue; }
      if (HR_RE.test(ln)) { out.push({ t: 'hr' }); i++; continue; }
      if (/^\s*>/.test(ln)) { var q = []; while (i < lines.length && /^\s*>/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; } out.push({ t: 'quote', text: q.join('\n') }); continue; }
      if (ln.indexOf('|') >= 0 && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].indexOf('-') >= 0) {
        var head = cells(ln), align = cells(lines[i + 1]).map(function (c) { return /^:.*:$/.test(c) ? 'center' : /:$/.test(c) ? 'right' : null; }), rows = []; i += 2;
        while (i < lines.length && lines[i].trim() && lines[i].indexOf('|') >= 0) { rows.push(cells(lines[i])); i++; }
        out.push({ t: 'table', head: head, align: align, rows: rows }); continue;
      }
      if (LIST_RE.test(ln)) { var L = parseList(lines, i); out.push(L.node); i = L.next; continue; }
      var para = [ln]; i++;
      while (i < lines.length && lines[i].trim() && !startsBlock(lines, i)) { para.push(lines[i]); i++; }
      out.push({ t: 'p', text: para.map(function (s) { return s.trim(); }).join('\n') });
    }
    return out;
  }
  /* the forms: settled text only. A half-arrived list must never be read as a shape, so a streaming Prose stays plain. */
  function shapeBlocks(blocks) {
    var out = [];
    blocks.forEach(function (b) {
      var m, prev = out[out.length - 1];
      if (b.t === 'p' && (m = VERDICT_RE.exec(b.text.trim()))) b = { t: 'verdict', verdict: m[1], counts: m[2] === undefined ? null : [+m[2], +m[3], +m[4], +m[5]] };
      else if (b.t === 'p') {
        var pairs = b.text.split('\n').map(function (s) { return /^\*\*([^*`\[\]]+?):\*\*\s+([^*`\[\]_~]+)$/.exec(s); });
        if (pairs.length > 1 && pairs.every(Boolean)) b = { t: 'facts', items: pairs.map(function (x) { return [x[1], x[2].trim()]; }) };
      } else if (b.t === 'quote') {
        var first = b.text.split('\n')[0];
        if ((m = ALERT_RE.exec(first.trim()))) b = { t: 'callout', kind: m[1].toLowerCase(), text: b.text.split('\n').slice(1).join('\n') };
      } else if (b.t === 'list' && b.items.length) {
        if (b.items.every(function (it) { return it.task; })) b = assign({}, b, { shape: 'tasks' });
        else if (b.items.every(function (it) { return /^[✓✅✗❌]\s/.test(it.text); })) b = assign({}, b, { shape: 'checks' });
      } else if (b.t === 'code' && b.closed) {
        if (b.lang === 'stats') {
          var tiles = [], good = true;
          b.text.split('\n').forEach(function (line) { if (!line.trim()) return; var c = line.split('|').map(function (x) { return x.trim(); }); if (c.length > 2 && c[c.length - 1] === '') c.pop(); if (c.length < 2 || c.length > 3 || !c[0] || !c[1]) good = false; else tiles.push({ label: c[0], value: c[1], delta: c[2] || null }); });
          if (good && tiles.length) b = { t: 'stats', tiles: tiles };
        } else if (b.lang === 'diff') b = assign({}, b, { shape: 'diff' });
      }
      /* the line above a list or a table is the head of the block it introduces */
      if ((b.t === 'list' || b.t === 'table') && prev && prev.t === 'p' && prev.text.indexOf('\n') < 0 && prev.text.trim().length <= LEAD_MAX && (/:$/.test(prev.text.trim()) || /^\*\*[^*]+\*\*$/.test(prev.text.trim()))) { out[out.length - 1] = { t: 'lead', title: prev.text.trim(), body: b }; return; }
      out.push(b);
    });
    return out;
  }
  var INLINE_RE = /(`+)(?!`)([\s\S]*?[^`])\1(?!`)|!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|\*\*(?=\S)([\s\S]*?\S)\*\*|~~(?=\S)([\s\S]*?\S)~~|\*(?=[^\s*])([\s\S]*?[^\s*])\*|(?:^|(?<=[\s(]))_(?=\S)([\s\S]*?\S)_(?=$|[\s).,;:!?])|(https?:\/\/[^\s<>]*[^\s<>).,;:!?'"])/g;
  var FILE_RE = /^((?:[\w.@~-]+\/)+[\w.@-]+\.[A-Za-z0-9]{1,8})(?::(\d+))?$/;
  function inline(text, ctx, pre) {
    var out = [], last = 0, m, k = 0, key = function () { return (pre || 'i') + '-' + k++; };
    var push = function (s) { if (!s) return; if (!ctx.breaks) { out.push(s); return; } s.split('\n').forEach(function (part, i) { if (i) out.push(h('br', { key: key() })); if (part) out.push(part); }); };
    var re = new RegExp(INLINE_RE.source, 'g');           /* its own: a bold or a link reads its inside with this same function */
    while ((m = re.exec(text))) {
      push(text.slice(last, m.index)); last = m.index + m[0].length;
      if (m[1]) {
        var raw = m[2].replace(/^ (?=.*\S)(.*) $/, '$1'), f = ctx.onFile && FILE_RE.exec(raw.trim());
        out.push(f ? h('button', { key: key(), type: 'button', className: 'ast-prose-file', 'data-ast-keeps-opening': '', title: 'Open ' + f[1], onClick: (function (ref) { return function (e) { ctx.onFile(ref, e); }; })({ path: f[1], line: f[2] ? +f[2] : null }) }, h('code', null, raw.trim())) : h('code', { key: key() }, raw));
      } else if (m[4]) out.push(h('img', { key: key(), src: m[4], alt: m[3] || '', loading: 'lazy' }));
      else if (m[6]) out.push(h('a', { key: key(), href: m[6], target: '_blank', rel: 'noreferrer noopener' }, inline(m[5], ctx, key())));
      else if (m[7]) out.push(h('strong', { key: key() }, inline(m[7], ctx, key())));
      else if (m[8]) out.push(h('del', { key: key() }, inline(m[8], ctx, key())));
      else if (m[9]) out.push(h('em', { key: key() }, inline(m[9], ctx, key())));
      else if (m[10]) out.push(h('em', { key: key() }, inline(m[10], ctx, key())));
      else if (m[11]) out.push(h('a', { key: key(), href: m[11], target: '_blank', rel: 'noreferrer noopener' }, m[11]));
    }
    push(text.slice(last));
    return out;
  }
  function ProseFold(p) {
    var st = useState(true), open = st[0], linked = /\]\(|https?:\/\//.test(p.title), ctx = p.ctx;
    var chev = h(Icon, { name: 'chevron', className: 'ast-prose-fold-mark' }), title = h('span', { className: 'ast-prose-fold-title' }, inline(p.title, ctx, 'ft'));
    return h('div', { className: 'ast-prose-fold', 'data-open': open ? 'true' : 'false' },
      /* a link in the title would be a control inside a control, so then the mark alone folds it */
      linked ? h('div', { className: 'ast-prose-fold-head' }, h('button', { type: 'button', className: 'ast-prose-fold-btn', 'aria-expanded': open, 'aria-label': open ? 'Collapse' : 'Expand', title: open ? 'Collapse' : 'Expand', onClick: function () { st[1](!open); } }, chev), title)
        : h('button', { type: 'button', className: 'ast-prose-fold-head ast-prose-fold-btn', 'aria-expanded': open, title: open ? 'Collapse' : 'Expand', onClick: function () { st[1](!open); } }, chev, title),
      open ? h('div', { className: 'ast-prose-fold-body' }, p.children) : null);
  }
  function ProseCode(p) {
    var b = p.b, lines = b.text.split('\n'), long = lines.length >= LONG_LINES, st = useState(false), all = st[0] || !long, diff = b.shape === 'diff';
    var shown = all ? lines : lines.slice(0, LONG_PREVIEW), add = 0, del = 0;
    if (diff) lines.forEach(function (l) { if (/^\+(?!\+\+)/.test(l)) add++; else if (/^-(?!--)/.test(l)) del++; });
    var kind = function (l) { return !diff ? undefined : /^@@/.test(l) ? 'hunk' : /^(\+\+\+|---|diff |index )/.test(l) ? 'meta' : l.charAt(0) === '+' ? 'add' : l.charAt(0) === '-' ? 'del' : undefined; };
    return h('figure', { className: 'ast-prose-code', 'data-clamped': all ? undefined : 'true' },
      h('figcaption', { className: 'ast-prose-code-head' },
        h('span', { className: 'caption-caps' }, diff ? 'Diff' : b.lang || (long ? 'Output' : 'Code')),
        diff && (add || del) ? h('span', { className: 'ast-tool-diff telemetry' }, add ? h('span', { 'data-kind': 'add' }, '+' + add) : null, del ? h('span', { 'data-kind': 'del' }, '−' + del) : null) : null,
        long ? h('span', { className: 'telemetry ast-prose-code-n' }, lines.length + ' lines') : null,
        h(CopyButton, { text: b.text, label: 'Copy', className: 'ast-prose-copy' })),
      h('pre', { className: 'field-value', tabIndex: 0 }, h('code', null, diff ? shown.map(function (l, i) { return h('span', { key: i, className: 'ast-prose-line', 'data-kind': kind(l) }, l || ' ', '\n'); }) : shown.join('\n'))),
      long ? h(Button, { size: 'small', className: 'ast-prose-more', 'aria-expanded': all, onClick: function () { st[1](!st[0]); } }, st[0] ? 'Show less' : 'Show all ' + lines.length + ' lines') : null);
  }
  var NUM_RE = /^[+\-−]?[$€£]?\d[\d,]*(\.\d+)?\s?(%|[a-zA-Z]{1,3})?$/;
  function renderList(b, key, ctx) {
    var kids = b.items.map(function (it, i) {
      var chk = b.shape === 'checks' ? (/^[✓✅]/.test(it.text) ? 'pass' : 'fail') : null, text = chk ? it.text.replace(/^[✓✅✗❌]\s+/, '') : it.text;
      return h('li', { key: i, 'data-task': it.task || undefined, 'data-check': chk || undefined },
        it.task ? h('span', { className: 'ast-prose-box', role: 'img', 'aria-label': it.task === 'done' ? 'Done' : 'Not done' }, it.task === 'done' ? '✓' : '') : null,
        chk ? h('span', { className: 'ast-prose-check', role: 'img', 'aria-label': chk === 'pass' ? 'Passed' : 'Failed' }, chk === 'pass' ? '✓' : '✕') : null,
        h('span', { className: 'ast-prose-li' }, inline(text.replace(/\n/g, ctx.breaks ? '\n' : ' '), ctx, 'l' + i)),
        it.kids.map(function (k, j) { return renderList(k, 'k' + j, ctx); }));
    });
    var list = h(b.ordered ? 'ol' : 'ul', { key: key, start: b.ordered && b.start !== 1 ? b.start : undefined, style: b.ordered && b.start > 1 ? { counterReset: 'ast-li ' + (b.start - 1) } : undefined, 'data-shape': b.shape || undefined }, kids);
    if (b.shape === 'tasks') { var done = b.items.filter(function (it) { return it.task === 'done'; }).length; return h('div', { key: key, className: 'ast-prose-count' }, h('div', { className: 'ast-prose-count-head telemetry' }, h('span', null, done + ' of ' + b.items.length + ' done'), h('span', { className: 'ast-prose-bar', 'aria-hidden': 'true' }, h('span', { style: { width: (100 * done / b.items.length) + '%' } }))), list); }
    if (b.shape === 'checks') { var pass = kids.filter(function (x, i) { return /^[✓✅]/.test(b.items[i].text); }).length, fail = b.items.length - pass; return h('div', { key: key, className: 'ast-prose-count' }, h('div', { className: 'ast-prose-count-head telemetry' }, h('span', { 'data-tone': 'positive' }, pass + ' passed'), fail ? h('span', { 'data-tone': 'danger' }, fail + ' failed') : null), list); }
    return list;
  }
  function renderBlock(b, key, ctx) {
    if (b.t === 'p') return h('p', { key: key }, inline(ctx.breaks ? b.text : b.text.replace(/\n/g, ' '), ctx, 'p'));
    if (b.t === 'h') return h('h' + b.n, { key: key }, inline(b.text, ctx, 'h'));
    if (b.t === 'hr') return h('hr', { key: key });
    if (b.t === 'quote') return h('blockquote', { key: key }, renderBlocks(b.text, ctx));
    if (b.t === 'callout') return h('aside', { key: key, className: 'ast-prose-callout', 'data-tone': ALERT_TONE[b.kind] }, h('span', { className: 'ast-prose-callout-word caption-caps' }, b.kind), renderBlocks(b.text, ctx));
    if (b.t === 'list') return renderList(b, key, ctx);
    if (b.t === 'lead') return h(ProseFold, { key: key, title: b.title, ctx: ctx }, renderBlock(b.body, 'b', ctx));
    if (b.t === 'facts') return h(KeyValueList, { key: key, className: 'ast-prose-facts', items: b.items });
    if (b.t === 'verdict') return h('div', { key: key, className: 'ast-prose-verdict' }, h(Badge, { tone: b.verdict === 'PASS' ? 'positive' : 'danger' }, b.verdict),
      b.counts ? ['Blocking', 'High', 'Medium', 'Low'].map(function (w, i) { return h('span', { key: w, className: 'ast-prose-rung telemetry', 'data-tone': b.counts[i] ? (i < 2 ? 'danger' : i === 2 ? 'warn' : 'info') : undefined }, w, ' ', h('b', null, b.counts[i])); }) : null);
    if (b.t === 'stats') return h('div', { key: key, className: 'ast-prose-stats' }, b.tiles.map(function (t, i) { var c = (t.delta || '').trim().charAt(0); return h('div', { key: i, className: 'ast-prose-stat' }, h('span', { className: 'caption-caps' }, t.label), h('span', { className: 'ast-prose-stat-v figure' }, t.value), t.delta ? h('span', { className: 'telemetry', 'data-tone': c === '+' ? 'positive' : c === '-' || c === '−' ? 'danger' : undefined }, t.delta) : null); }));
    if (b.t === 'code') return h(ProseCode, { key: key, b: b });
    if (b.t === 'table') {
      /* a column of nothing but figures is set as figures, to the right; one stray word and it stays words */
      var num = b.head.map(function (_, i) { return b.rows.length > 0 && b.rows.every(function (r) { return NUM_RE.test(r[i] == null ? '' : r[i]); }); });
      return h('div', { key: key, className: 'ast-prose-table' }, h('table', null,
        h('thead', null, h('tr', null, b.head.map(function (c, i) { return h('th', { key: i, scope: 'col', 'data-align': b.align[i] || (num[i] ? 'right' : undefined) }, inline(c, ctx, 'th' + i)); }))),
        h('tbody', null, b.rows.map(function (r, j) { return h('tr', { key: j }, b.head.map(function (_, i) { return h('td', { key: i, 'data-align': b.align[i] || (num[i] ? 'right' : undefined), 'data-num': num[i] ? 'true' : undefined }, inline(r[i] == null ? '' : r[i], ctx, 'td' + j + '-' + i)); })); }))));
    }
    return null;
  }
  /* While the text is arriving, what has settled is everything before the last blank line that is not inside an open fence.
     The settled part takes its forms; the block still being written stays plain, so a half-arrived list is never read as a shape. */
  function splitSettled(text) {
    var lines = text.split('\n'), open = null, cut = -1, pos = 0;
    for (var i = 0; i < lines.length; i++) {
      var m = FENCE_RE.exec(lines[i]);
      if (m) { if (!open) open = m[1].charAt(0); else if (m[1].charAt(0) === open && !m[2]) open = null; }
      else if (!open && !lines[i].trim() && i < lines.length - 1) cut = pos;
      pos += lines[i].length + 1;
    }
    return cut < 0 ? ['', text] : [text.slice(0, cut), text.slice(cut)];
  }
  function renderBlocks(text, ctx) {
    if (!ctx.streaming) return shapeBlocks(parseBlocks(text)).map(function (b, i) { return renderBlock(b, i, ctx); });
    var parts = splitSettled(String(text == null ? '' : text));
    return shapeBlocks(parseBlocks(parts[0])).map(function (b, i) { return renderBlock(b, i, ctx); }).concat(parseBlocks(parts[1]).map(function (b, i) { return renderBlock(b, 'p' + i, ctx); }));
  }
  function Prose(p) {
    var ctx = { onFile: p.onFile, breaks: !!p.breaks, streaming: !!p.streaming };
    var kids = useMemo(function () { return renderBlocks(p.text != null ? p.text : typeof p.children === 'string' ? p.children : '', ctx); }, [p.text, p.children, p.onFile, p.breaks, p.streaming]);
    var text = p.text != null ? p.text : typeof p.children === 'string' ? p.children : '';
    return h('div', { className: cx('ast-prose', 'reading', p.className), 'data-quiet': p.quiet ? 'true' : undefined, style: p.style, dir: 'auto' }, kids,
      p.streaming ? h('span', { className: 'ast-prose-live' }, h(SignalLoop, { state: 'working', size: 12 })) : null,
      p.copy && !p.streaming ? h('div', { className: 'ast-prose-foot' }, h(CopyButton, { text: text, label: 'Copy as markdown' })) : null);
  }

  /* ---------- Meter: one measure, small: a ring with its figure inside, for when several stand in a column and should compare
     in one look. Quiet until it is high: then warn, then danger. The one measure shown large is the ArcGauge dial. ---------- */
  function Meter(p) {
    var v = p.value == null || !isFinite(+p.value) ? null : clamp(+p.value, 0, 1), pct = v == null ? null : Math.round(v * 100), size = p.size || 32;
    /* judged on the rounded figure, the one that is printed, so a meter never says 75 beside a calm ring */
    var tone = pct == null ? null : p.danger != null && pct >= Math.round(p.danger * 100) ? 'danger' : p.warn != null && pct >= Math.round(p.warn * 100) ? 'warn' : null;
    return h('figure', { className: cx('ast-meter', p.className), 'data-tone': tone || undefined, 'data-empty': pct == null ? 'true' : undefined, title: p.title, style: p.style,
      role: 'meter', 'aria-label': p.label, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct == null ? undefined : pct, 'aria-valuetext': p.valueText != null ? p.valueText : pct == null ? 'No reading' : pct + '%' },
      h('span', { className: 'ast-meter-dial', style: { width: size, height: size } },
        h('svg', { width: size, height: size, viewBox: '0 0 32 32', 'aria-hidden': 'true' },
          h('circle', { className: 'ast-meter-track', cx: 16, cy: 16, r: 13.5 }),
          pct ? h('circle', { className: 'ast-meter-arc', cx: 16, cy: 16, r: 13.5, pathLength: 100, strokeDasharray: pct + ' 100', transform: 'rotate(-90 16 16)' }) : null),
        h('span', { className: 'ast-meter-fig telemetry', 'aria-hidden': 'true' }, pct == null ? '—' : pct)),
      p.caption ? h('figcaption', { className: 'ast-meter-cap telemetry' }, p.caption) : null);
  }

  /* ---------- Rail: a long run as a spine of marks, one for each turn. The one in view is lit, and a press goes there. ---------- */
  function Rail(p) {
    var items = p.items || [];
    return h('nav', { className: cx('ast-rail', p.className), 'aria-label': p.label || 'Turns', style: p.style },
      h('div', { className: 'ast-rail-run' }, items.map(function (it) {
        if (it.kind === 'break') return h('span', { key: it.id, className: 'ast-rail-break', 'aria-hidden': 'true' });
        var at = it.id === p.at;
        return h('button', { key: it.id, type: 'button', className: 'ast-rail-mark', 'data-kind': it.kind === 'you' ? 'you' : 'reply', 'data-at': at ? 'true' : undefined, 'data-tone': it.tone || undefined,
          'aria-current': at ? 'true' : undefined, 'aria-label': 'Go to: ' + (it.label || ''), title: it.label, onClick: function () { if (p.onGo) p.onGo(it.id); } }, h('i', { 'aria-hidden': 'true' }));
      })));
  }

  /* ---------- Core: the raymarched ferrofluid singularity (WebGL1), with a chrome-ramp 2D fallback ---------- */
  var CORE_VS = 'attribute vec2 aP;varying vec2 vUv;void main(){vUv=aP;gl_Position=vec4(aP,0.0,1.0);}';
  var CORE_FS = "\n#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\nvarying vec2 vUv;\nuniform float uTime, uR, uBound, uSpikeH, uSpikeB, uSpikeN, uBreath, uThink, uHalo, uEnergy, uPx, uStepK, uFlow, uDay;\n/* the kinetic states: how much of each is present (0 to 1), and what drives it */\nuniform float uListen, uRead, uWrite, uSwell, uFacetT;\nuniform vec4 uTide, uRip, uTen;\nuniform vec3 uAim;\nuniform mat3 uFacet;\nuniform vec3 uL0, uL1, uL2, uLA, uLK, uW, uCA, uCB, uHaloC;\nuniform vec4 uS0, uS1, uS2, uS3, uSA;\nuniform mat3 uSpin;\nuniform float uWp;\nuniform int uSteps;\nconst float PI = 3.14159265;\nconst float PHI = 1.61803399;\nfloat h11(float x) { return fract(sin(x * 127.1 + 311.7) * 43758.5453); }\nfloat smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }\nfloat shockW(vec3 n, vec4 s, float a) {\n  float x = acos(clamp(dot(n, s.xyz), -1.0, 1.0)) - s.w * 2.2;\n  return a * exp(-x * x * 55.0) * cos(x * 22.0);\n}\nfloat crestW(vec3 n, vec4 s, float a) {\n  float x = acos(clamp(dot(n, s.xyz), -1.0, 1.0)) - s.w * 2.2;\n  return a * exp(-x * x * 900.0);\n}\nfloat box(vec3 r, vec3 d, vec2 hs, float soft) {\n  vec3 u = normalize(cross(d, vec3(0.0, 1.0, 0.0)));\n  vec3 v = cross(u, d);\n  float c = dot(r, d);\n  if (c <= 0.0) return 0.0;\n  vec2 q = abs(vec2(dot(r, u), dot(r, v)) / c);\n  vec2 e = vec2(1.0) - smoothstep(hs - soft, hs, q);\n  return e.x * e.y;\n}\nfloat field(vec3 n) {\n  return uLA.x * pow(max(dot(n, uL0), 0.0), uLK.x) + uLA.y * pow(max(dot(n, uL1), 0.0), uLK.y) + uLA.z * pow(max(dot(n, uL2), 0.0), uLK.z);\n}\n/* Thinking: the liquid stiffens into a polyhedron. Twenty-six planes on thirteen axes (a dodecahedron's six, an\n   octahedron's four, a cube's three); the surface is whichever plane is nearest along n. Each plane sits at its own\n   depth and the depths jump together on uFacetT, so faces appear, widen and are cut away: it holds, then re-forms. */\nfloat facetR(vec3 q, vec3 a, float rho, float ph) {\n  return (rho + 0.055 * sin(uFacetT * 2.4 + ph)) / max(abs(dot(q, a)), 0.05);\n}\nfloat facets(vec3 n) {\n  vec3 q = uFacet * n;\n  float r = facetR(q, vec3(0.0, 0.5257, 0.8507), 0.88, 0.0);\n  r = min(r, facetR(q, vec3(0.0, -0.5257, 0.8507), 0.88, 1.9));\n  r = min(r, facetR(q, vec3(0.5257, 0.8507, 0.0), 0.88, 3.7));\n  r = min(r, facetR(q, vec3(-0.5257, 0.8507, 0.0), 0.88, 5.1));\n  r = min(r, facetR(q, vec3(0.8507, 0.0, 0.5257), 0.88, 0.8));\n  r = min(r, facetR(q, vec3(0.8507, 0.0, -0.5257), 0.88, 2.9));\n  r = min(r, facetR(q, vec3(0.5774, 0.5774, 0.5774), 0.95, 4.4));\n  r = min(r, facetR(q, vec3(-0.5774, 0.5774, 0.5774), 0.95, 1.3));\n  r = min(r, facetR(q, vec3(0.5774, -0.5774, 0.5774), 0.95, 5.8));\n  r = min(r, facetR(q, vec3(0.5774, 0.5774, -0.5774), 0.95, 2.4));\n  r = min(r, facetR(q, vec3(1.0, 0.0, 0.0), 0.97, 3.2));\n  r = min(r, facetR(q, vec3(0.0, 1.0, 0.0), 0.97, 0.4));\n  r = min(r, facetR(q, vec3(0.0, 0.0, 1.0), 0.97, 4.9));\n  return r - 1.0;\n}\nfloat disp(vec3 n) {\n  /* what is liquid about it goes still as it stiffens */\n  float liquid = 1.0 - uThink;\n  float d = liquid * uBreath * (sin(3.1 * n.x + uTime * 0.71) * sin(2.7 * n.y - uTime * 0.53) * sin(3.3 * n.z + uTime * 0.47) + 0.5 * sin(5.3 * n.y + 1.7 * n.x + uTime * 1.13));\n  /* Idle: a tide. One long bulge whose axis slowly comes round, on a slow swell of the whole body. */\n  float ta = dot(n, uTide.xyz);\n  d += uTide.w * (1.5 * ta * ta - 0.5) + uSwell;\n  if (uThink > 0.003) d += uThink * facets(n);\n  /* Listening: it flattens into a dish that faces you, and what it hears stands on the dish as rings. */\n  if (uListen > 0.003) {\n    float cz = n.z, rho2 = max(1.0 - cz * cz, 0.0), rho = sqrt(rho2);\n    d += uListen * (inversesqrt(rho2 / 1.21 + cz * cz / 0.3) - 1.0);\n    float face = smoothstep(-0.05, 0.3, cz);\n    d += uListen * uRip.z * cos(uRip.x * rho) * uRip.y * face * (1.0 - smoothstep(0.72, 0.9, rho));\n    /* the lip of the dish */\n    d += uListen * 0.03 * exp(-(rho - 0.9) * (rho - 0.9) * 90.0) * face;\n  }\n  /* Reading: a mouth opens toward what it reads, and the surface spirals down into it. */\n  if (uRead > 0.003) {\n    float th = acos(clamp(dot(n, uAim), -1.0, 1.0));\n    vec3 ru = normalize(cross(uAim, vec3(0.0, 1.0, 0.001)));\n    vec3 rv = cross(uAim, ru);\n    float ph = atan(dot(n, rv), dot(n, ru));\n    d -= uRead * 0.4 * exp(-th * th * 7.0);\n    d += uRead * 0.05 * exp(-(th - 0.66) * (th - 0.66) * 16.0);\n    d += uRead * 0.034 * sin(3.0 * ph + 7.0 * log(th + 0.08) + uTime * 5.0) * smoothstep(0.05, 0.3, th) * exp(-th * th * 1.3);\n    /* what it drinks: a ring drawn in from the far side and swallowed, again and again */\n    float g = fract(uTime * 0.8), tg = 2.5 * (1.0 - g);\n    d += uRead * 0.03 * sin(PI * g) * exp(-(th - tg) * (th - tg) * 46.0);\n  }\n  if (uFlow > 0.0005) d += uFlow * sin(2.3 * n.x + uTime * 1.9 + 1.7 * sin(1.3 * n.y + uTime * 0.7)) * sin(2.9 * n.y - uTime * 1.4 + 1.1 * sin(1.7 * n.z - uTime * 0.9)) * sin(2.1 * n.z + uTime * 1.1);\n  d += field(n);\n  if (uSA.x > 0.0005) d += shockW(n, uS0, uSA.x);\n  if (uSA.y > 0.0005) d += shockW(n, uS1, uSA.y);\n  if (uSA.z > 0.0005) d += shockW(n, uS2, uSA.z);\n  if (uSA.w > 0.0005) d += shockW(n, uS3, uSA.w);\n  return d;\n}\n/* Ferrofluid spikes: true cone SDFs on a spherical Fibonacci lattice (nearest 4 lattice points),\n   rising from the lobed surface and fused to it with a smooth-min meniscus. */\nfloat spikes(vec3 p, vec3 n, float d) {\n  vec3 pl = uSpin * n;\n  float N = uSpikeN;\n  float m = 1.0 - 1.0 / N;\n  float ph = min(atan(pl.y, pl.x), PI);\n  float z = pl.z;\n  float k = max(2.0, floor(log(N * PI * sqrt(5.0) * max(1e-6, 1.0 - z * z)) / log(PHI * PHI)));\n  float fk = pow(PHI, k) / sqrt(5.0);\n  vec2 F = vec2(floor(fk + 0.5), floor(fk * PHI + 0.5));\n  vec2 bz = -2.0 * F / N;\n  vec2 bp = 2.0 * PI * (fract((F + 1.0) * PHI) - (PHI - 1.0));\n  float det = bp.x * bz.y - bp.y * bz.x;\n  mat2 inv = mat2(bz.y, -bz.x, -bp.y, bp.x) / det;\n  vec2 c = floor(inv * vec2(ph, z - m));\n  for (int s = 0; s < 4; s++) {\n    vec2 o = vec2(mod(float(s), 2.0), floor(float(s) * 0.5));\n    float i = dot(F, c + o);\n    if (i < 0.0 || i > N - 1.0) continue;\n    float a = 2.0 * PI * fract(i * PHI);\n    float cz = m - 2.0 * i / N;\n    float sz = sqrt(max(0.0, 1.0 - cz * cz));\n    vec3 q = vec3(cos(a) * sz, sin(a) * sz, cz) * uSpin;\n    /* spikes grow only where the body is pulled out into a mound, tallest at its crest */\n    float g0 = pow(max(dot(q, uL0), 0.0), uLK.x), g1 = pow(max(dot(q, uL1), 0.0), uLK.y), g2 = pow(max(dot(q, uL2), 0.0), uLK.z);\n    float e0 = max(uLA.x, 0.0) * g0, e1 = max(uLA.y, 0.0) * g1, e2 = max(uLA.z, 0.0) * g2;\n    float ext = e0 + e1 + e2;\n    float mask = max(smoothstep(0.01, 0.05, uLA.x) * smoothstep(0.35, 0.85, g0), max(smoothstep(0.01, 0.05, uLA.y) * smoothstep(0.35, 0.85, g1), smoothstep(0.01, 0.05, uLA.z) * smoothstep(0.35, 0.85, g2)));\n    if (mask < 0.02) continue;\n    float H = uR * uSpikeH * pow(mask, 0.6) * (0.72 + 0.28 * h11(i)) * (0.9 + 0.1 * sin(uTime * 6.0 - i * 2.3));\n    if (H < 0.0004) continue;\n    vec3 lm = normalize(uL0 * e0 + uL1 * e1 + uL2 * e2 + q * 1e-3);\n    vec3 ax = normalize(mix(q, lm, 0.22 * mask));\n    vec3 pb = p - q * (uR * (1.0 + ext - 0.015));\n    float t = dot(pb, ax);\n    float rho = length(pb - t * ax);\n    float b = max(H * uSpikeB, 1e-4);\n    vec2 w = vec2(rho, t - H);\n    vec2 v = normalize(vec2(b, -H));\n    float dc = dot(w, v) < 0.0 ? length(w) : dot(w, vec2(-v.y, v.x));\n    dc = max(dc, -0.3 * uR - t);\n    d = smin(d, dc, 0.6 * b + 0.15 * H);\n  }\n  return d;\n}\n/* Writing: a tendril reaches for the target with a bouton at its end, and needles ride out along it, point first.\n   uTen = (how far it reaches beyond the surface in radii, its thickness, where the needles are, the bouton's size). */\nfloat tendril(vec3 p, float d) {\n  float s = dot(p, uAim);\n  if (s < uR * 0.3) return d;\n  vec3 tu = normalize(cross(uAim, vec3(0.0, 0.001, 1.0)));\n  vec3 tv = cross(uAim, tu);\n  float L = uR * (1.0 + uTen.x);\n  float k = clamp((s - uR * 0.85) / max(L - uR * 0.85, 1e-3), 0.0, 1.0);\n  /* it wavers like something alive, pinned at the root and at the target */\n  float wv = sin(PI * k) * uR * 0.04;\n  vec2 w = vec2(dot(p, tu), dot(p, tv)) - wv * vec2(sin(k * 9.0 - uTime * 6.0), 0.6 * cos(k * 7.0 - uTime * 4.6));\n  float rad = uR * uTen.y * mix(2.6, 1.0, smoothstep(0.0, 0.45, k));\n  for (int j = 0; j < 3; j++) {\n    float f = fract(uTen.z + float(j) / 3.0);\n    float x = k - f;\n    /* a needle: widest at its tail, drawn to a point at the front */\n    float prof = clamp(-x / 0.2, 0.0, 1.0) * smoothstep(-0.24, -0.2, x) * step(x, 0.0);\n    rad += uR * 0.055 * prof * smoothstep(0.0, 0.1, f) * (1.0 - smoothstep(0.86, 1.0, f));\n  }\n  float dc = length(w) - rad;\n  dc = max(dc, s - L);\n  dc = min(dc, length(p - uAim * L) - uR * uTen.w);\n  return smin(d, dc, uR * 0.1);\n}\nfloat map(vec3 p) {\n  float r = length(p);\n  vec3 n = p / max(r, 1e-4);\n  float d = r - uR * (1.0 + disp(n));\n  if (uTen.x > 0.004) d = tendril(p, d);\n  if (uSpikeH > 0.006) {\n    /* only pay for the spike lattice near a mound that is actually extruding */\n    float near = max(step(0.01, uLA.x) * pow(max(dot(n, uL0), 0.0), uLK.x), max(step(0.01, uLA.y) * pow(max(dot(n, uL1), 0.0), uLK.y), step(0.01, uLA.z) * pow(max(dot(n, uL2), 0.0), uLK.z)));\n    if (near > 0.15) d = spikes(p, n, d);\n  }\n  return d;\n}\nvec3 nrm(vec3 p) {\n  const vec2 e = vec2(1.0, -1.0);\n  float h = 0.0012;\n  return normalize(e.xyy * map(p + e.xyy * h) + e.yyx * map(p + e.yyx * h) + e.yxy * map(p + e.yxy * h) + e.xxx * map(p + e.xxx * h));\n}\nfloat crest(vec3 n) {\n  float c = 0.0;\n  if (uSA.x > 0.0005) c += crestW(n, uS0, uSA.x);\n  if (uSA.y > 0.0005) c += crestW(n, uS1, uSA.y);\n  if (uSA.z > 0.0005) c += crestW(n, uS2, uSA.z);\n  if (uSA.w > 0.0005) c += crestW(n, uS3, uSA.w);\n  return c * 8.0;\n}\nvec3 env(vec3 r) {\n  float key = box(r, normalize(vec3(-0.42, 0.55, 0.72)), vec2(0.34, 0.15), 0.06) * 2.2;\n  float kick = box(r, normalize(vec3(0.62, -0.28, 0.73)), vec2(0.09, 0.3), 0.05) * 0.55;\n  float top = smoothstep(0.86, 0.98, r.y) * 0.6;\n  float hz = exp(-abs(r.y + 0.04) * 14.0) * 0.07;\n  float ra = pow(max(dot(r, normalize(vec3(-0.98, -0.12, -0.1))), 0.0), 5.0);\n  float rb = pow(max(dot(r, normalize(vec3(0.98, 0.02, -0.12))), 0.0), 5.0);\n  return vec3(key + kick + top + hz) + uCA * ra * 0.95 + uCB * rb * 0.95;\n}\n/* Polished chrome: a studio sky/ground split with a crisp horizon, softboxes and dark rims for metallic contrast. */\nvec3 envChrome(vec3 r) {\n  float hy = r.y + 0.1;\n  float sky = mix(0.58, 1.0, smoothstep(0.0, 0.85, hy));\n  float gnd = mix(0.36, 0.12, smoothstep(0.0, -0.8, hy));\n  float b = mix(gnd, sky, smoothstep(-0.012, 0.012, hy));\n  b *= mix(1.0, 0.6, smoothstep(0.1, -0.6, r.z));\n  float key = box(r, normalize(vec3(-0.42, 0.55, 0.72)), vec2(0.34, 0.15), 0.05) * 1.6;\n  float strip = box(r, normalize(vec3(0.78, 0.12, 0.6)), vec2(0.05, 0.5), 0.02) * 1.3;\n  float strip2 = box(r, normalize(vec3(-0.85, 0.2, 0.2)), vec2(0.05, 0.5), 0.02) * 0.9;\n  float kick = box(r, normalize(vec3(-0.7, -0.05, -0.7)), vec2(0.06, 0.4), 0.02) * 0.9;\n  float glow = exp(-abs(hy) * 14.0);\n  vec3 c = vec3(b + key + strip + strip2 + kick);\n  return c + uCA * 0.22 * glow * smoothstep(0.25, -0.65, r.x) + uCB * 0.22 * glow * smoothstep(-0.25, 0.65, r.x);\n}\nvec3 shChrome(vec3 r, float ndv, float cr) {\n  vec3 F = mix(vec3(0.76, 0.78, 0.81), vec3(1.0), pow(1.0 - ndv, 5.0));\n  return envChrome(r) * F * 1.05 + vec3(1.0) * cr;\n}\nvec3 shTube(vec3 n, vec3 r, float ndv, vec3 pos, float cr) {\n  float fr = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);\n  vec3 glow = uCA * (0.07 + 0.42 * pow(ndv, 1.4)) * (0.55 + 0.9 * uEnergy);\n  float y = pos.y / uR;\n  float fx = 0.07 * sin(y * 8.0 + uTime * 1.4) * (0.35 + uEnergy);\n  float dx = abs(pos.x / uR - fx);\n  float fil = exp(-dx * 34.0) * (1.0 - smoothstep(0.38, 0.66, abs(y))) * (0.4 + 1.5 * uEnergy);\n  vec3 c = glow * (1.0 - fr) + uCA * fil * 1.2 * (1.0 - fr) + vec3(1.0, 0.88, 0.7) * fil * fil * 0.5;\n  return c + env(r) * fr * vec3(1.0, 0.84, 0.62) * 1.1 + vec3(1.0, 0.86, 0.66) * cr;\n}\nvec3 shWire(vec3 sn, float ndv, float dsp, float cr) {\n  vec3 q = uSpin * sn;\n  float lat = asin(clamp(q.y, -1.0, 1.0));\n  float lon = atan(q.z, q.x);\n  float aa = uPx / (uR * max(ndv, 0.2));\n  float st = PI / 14.0;\n  float la = abs(fract(lat / st + 0.5) - 0.5) * st;\n  float lo = abs(fract(lon / st + 0.5) - 0.5) * st * cos(lat);\n  float g = max(1.0 - smoothstep(0.0, aa * 1.1, la), 1.0 - smoothstep(0.0, aa * 1.1, lo));\n  float cd = abs(fract(dsp * 24.0 + 0.5) - 0.5);\n  float ct = (1.0 - smoothstep(0.03, 0.09, cd)) * smoothstep(0.045, 0.09, dsp);\n  float fr = pow(1.0 - ndv, 2.5);\n  return vec3(0.003, 0.01, 0.014) + uCA * g * (0.35 + 0.5 * ndv) + uCB * ct * 0.9 + uCA * fr * 0.6 + uCB * cr * 1.2;\n}\n/* Plasma: dark glass with a charge held in it. Filaments wander out from the middle to the wall, brighter where they touch it. */\nfloat plFil(float phi, float rho, float base, float sp, float k) {\n  float a = base + 0.55 * sin(uTime * sp + k) + 0.24 * sin(rho * 7.0 - uTime * (1.1 + sp) + k * 2.0);\n  float d = abs(mod(phi - a + PI, 2.0 * PI) - PI) * max(rho, 0.08);\n  return exp(-d * 26.0) * smoothstep(0.02, 0.3, rho);\n}\nvec3 shPlasma(vec3 sn, vec3 r, float ndv, float cr) {\n  float rho = length(sn.xy);\n  float phi = atan(sn.y, sn.x);\n  float f = plFil(phi, rho, 0.4, 0.31, 0.0) + plFil(phi, rho, 2.5, 0.23, 1.7) + plFil(phi, rho, 4.4, 0.37, 3.1) + 0.7 * plFil(phi, rho, 5.6, 0.19, 4.6);\n  f *= 0.55 + 1.3 * uEnergy + 0.45 * rho;\n  float seed = exp(-rho * rho * 9.0);\n  float fr = pow(1.0 - ndv, 3.0);\n  vec3 c = vec3(0.012, 0.008, 0.022) + uCA * (0.05 + 0.5 * seed) + uCA * f * 0.9 + vec3(1.0, 0.92, 1.0) * (f * f * 0.45 + seed * seed * 0.5);\n  return c * (1.0 - 0.6 * fr) + env(r) * (0.05 + 0.85 * pow(1.0 - ndv, 5.0)) * vec3(0.86, 0.82, 1.0) + uCB * fr * 0.5 + uCB * cr * 1.2;\n}\nvoid main() {\n  vec2 p2 = vUv;\n  float rr2 = dot(p2, p2);\n  float rl = sqrt(rr2);\n  vec3 col = vec3(0.0);\n  float alpha = 0.0;\n  float b2 = uBound * uBound;\n  if (rr2 < b2) {\n    float zE = sqrt(b2 - rr2);\n    vec3 ro = vec3(p2, zE);\n    vec3 rd = vec3(0.0, 0.0, -1.0);\n    float t = 0.0;\n    float tEnd = 2.0 * zE;\n    float dmin = 1e3;\n    float d = 1.0;\n    bool hit = false;\n    for (int i = 0; i < 120; i++) {\n      if (i >= uSteps) break;\n      d = map(ro + rd * t);\n      dmin = min(dmin, d);\n      if (d < 0.0005) { hit = true; break; }\n      t += max(d * uStepK, 0.0004);\n      if (t > tEnd) break;\n    }\n    if (!hit && d < 0.004 && t <= tEnd) hit = true;\n    if (hit) {\n      vec3 pos = ro + rd * t;\n      vec3 n = nrm(pos);\n      float ndv = clamp(n.z, 0.0, 1.0);\n      vec3 r = reflect(rd, n);\n      float pl = length(pos);\n      vec3 sn = pos / pl;\n      float dsp = pl / uR - 1.0;\n      float cr = crest(sn);\n      vec3 c = vec3(0.0);\n      if (uW.x > 0.002) c += uW.x * shChrome(r, ndv, cr);\n      if (uW.y > 0.002) c += uW.y * shTube(n, r, ndv, pos, cr);\n      if (uW.z > 0.002) c += uW.z * shWire(sn, ndv, dsp, cr);\n      if (uWp > 0.002) c += uWp * shPlasma(sn, r, ndv, cr);\n      col = 1.0 - exp(-c * 1.25);\n      alpha = 1.0;\n    } else {\n      float e = 1.0 - smoothstep(0.0, uPx * 1.5, dmin);\n      col = mix(uHaloC * 0.6, vec3(0.6, 0.63, 0.67), uW.x) * e;\n      alpha = e;\n    }\n  }\n  float halo = uHalo * exp(-max(rl - uR, 0.0) / (0.1 * uR)) * (1.0 - smoothstep(0.86, 1.0, rl));\n  /* by day the halo blends as a tint instead of adding light */\n  col += uHaloC * halo * mix(1.0, 0.25, uDay) * (1.0 - alpha);\n  alpha = alpha + halo * 0.25 * (1.0 - alpha);\n  gl_FragColor = vec4(col, alpha);\n}";
  var CORE_UNI = ['uFlow', 'uLK', 'uTime', 'uR', 'uBound', 'uSpikeH', 'uSpikeB', 'uSpikeN', 'uBreath', 'uThink', 'uHalo', 'uEnergy', 'uPx', 'uStepK', 'uL0', 'uL1', 'uL2', 'uLA', 'uW', 'uWp', 'uCA', 'uCB', 'uHaloC', 'uS0', 'uS1', 'uS2', 'uS3', 'uSA', 'uSpin', 'uSteps', 'uDay', 'uListen', 'uRead', 'uWrite', 'uSwell', 'uFacetT', 'uTide', 'uRip', 'uTen', 'uAim', 'uFacet'];
  function rotMat(a) {
    var ux = 0.28, uy = 0.94, uz = 0.19, L = Math.hypot(ux, uy, uz), x = ux / L, y = uy / L, z = uz / L, c = Math.cos(a), s = Math.sin(a), t = 1 - c;
    return new Float32Array([t * x * x + c, t * x * y + s * z, t * x * z - s * y, t * x * y - s * z, t * y * y + c, t * y * z + s * x, t * x * z + s * y, t * y * z - s * x, t * z * z + c]);
  }
  /* a turn of `a` about any axis, and the product of two turns (column-major, as the shader wants them) */
  function rotAxis(ux, uy, uz, a) {
    var L = Math.hypot(ux, uy, uz) || 1, x = ux / L, y = uy / L, z = uz / L, c = Math.cos(a), s = Math.sin(a), t = 1 - c;
    return [t * x * x + c, t * x * y + s * z, t * x * z - s * y, t * x * y - s * z, t * y * y + c, t * y * z + s * x, t * x * z + s * y, t * y * z - s * x, t * z * z + c];
  }
  function mul3(A, B) {
    var o = new Float32Array(9);
    for (var c = 0; c < 3; c++) for (var r = 0; r < 3; r++) o[c * 3 + r] = A[r] * B[c * 3] + A[3 + r] * B[c * 3 + 1] + A[6 + r] * B[c * 3 + 2];
    return o;
  }
  /* time that holds, then jumps: a beat every `tau` seconds, crossed in the first fifth of it */
  function stepped(t, tau) { var x = t / tau, f = x - Math.floor(x), k = clamp(f / 0.2, 0, 1); return Math.floor(x) + k * k * (3 - 2 * k); }
  function CoreGL(canvas) {
    var self = this;
    this.c = canvas; this.lost = false;
    this.onLost = function (e) { e.preventDefault(); self.lost = true; };
    this.onRestored = function () { try { self.init(); self.lost = false; } catch (e) { /* stays lost */ } };
    canvas.addEventListener('webglcontextlost', this.onLost, false);
    canvas.addEventListener('webglcontextrestored', this.onRestored, false);
    this.init();
  }
  CoreGL.prototype.init = function () {
    var o = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' };
    var gl = this.c.getContext('webgl', o) || this.c.getContext('experimental-webgl', o);
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    var sh = function (type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error('shader: ' + gl.getShaderInfoLog(s)); return s; };
    var pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, CORE_VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, CORE_FS));
    gl.bindAttribLocation(pr, 0, 'aP');
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('link: ' + gl.getProgramInfoLog(pr));
    this.p = pr; gl.useProgram(pr);
    var b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    var u = this.u = {};
    CORE_UNI.forEach(function (n) { u[n] = gl.getUniformLocation(pr, n); });
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
  };
  CoreGL.prototype.draw = function (U) {
    var gl = this.gl;
    if (!gl || this.lost) return;
    gl.viewport(0, 0, this.c.width, this.c.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.p);
    for (var k in U) {
      var loc = this.u[k], val = U[k];
      if (!loc) continue;
      if (k === 'uSteps') gl.uniform1i(loc, val);
      else if (typeof val === 'number') gl.uniform1f(loc, val);
      else if (val.length === 3) gl.uniform3f(loc, val[0], val[1], val[2]);
      else if (val.length === 4) gl.uniform4f(loc, val[0], val[1], val[2], val[3]);
      else if (val.length === 9) gl.uniformMatrix3fv(loc, false, val);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  CoreGL.prototype.destroy = function () {
    this.c.removeEventListener('webglcontextlost', this.onLost); this.c.removeEventListener('webglcontextrestored', this.onRestored);
    try { var ext = this.gl && this.gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch (e) { /* ignore */ }
    this.gl = null;
  };
  function c01(c) { return [c[0] / 255, c[1] / 255, c[2] / 255]; }

  function Core(p) {
    var read = useSignal(p.signal), root = useRef(null), cv = useRef(null), cv2 = useRef(null), box = useBox(root), S = useRef(null);
    useEffect(function () { return function () { if (S.current && S.current.gl) S.current.gl.destroy(); }; }, []);
    useFrame(root, function (dt, now) {
      var el = root.current, c = cv.current, W = box.current.w, H = box.current.h;
      if (!el || !c || !W || !H) return;
      if (!S.current) {
        S.current = { drive: new Drive(), pal: new LivePalette(el), lob: { a: [0, 0, 0], va: [0, 0, 0], d: [norm3([0.6, 0.6, 0.5]), norm3([-0.6, 0.5, 0.6]), norm3([0.3, 0.9, 0.35])], k: [5, 5, 5] }, shocks: [], pw: [1, 0, 0, 0], spin: 0, time: 0, az: 1.15, aim: norm3([0.4, 0.45, 0.8]), ten: 0, tenV: 0, quality: 1, slowT: 0, fastT: 0, gl: null, side: 0 };
        try { S.current.gl = new CoreGL(c); } catch (e) { S.current.gl = null; console.warn('[Astrolabe] Core: WebGL unavailable, drawing the 2D chrome core.', e && e.message ? e.message : e); }
        c.style.display = S.current.gl ? 'block' : 'none';
        if (cv2.current) cv2.current.style.display = S.current.gl ? 'none' : 'block';
      }
      /* `drive`, 0 to 1: how hard it is driven. It stirs the surface, feeds the filament and widens the glow, in every form. */
      var drv = clamp(+p.drive || 0, 0, 1);
      var st = S.current, state = normState(p.state), D = st.drive, rm = reducedMotion() ? 0.35 : 1;
      D.step(dt, state, read);
      st.pal.step(now, dt);
      var v = D.v, P = st.pal.c, lb = st.lob;
      st.time += dt * rm;
      while (D.events.length) {
        var amp = D.events.shift() * (state === 'speaking' ? 1 : 0), aa = Math.random() * TAU, bb = Math.acos(lerp(0.25, 0.95, Math.random()));
        if (amp > 0) st.shocks.push({ dir: [Math.sin(bb) * Math.cos(aa), Math.sin(bb) * Math.sin(aa), Math.cos(bb)], age: 0, amp: amp });
        if (st.shocks.length > 4) st.shocks.shift();
      }
      st.shocks.forEach(function (s) { s.age += dt; });
      st.shocks = st.shocks.filter(function (s) { return s.age < 1.3; });
      var mat = p.material || P.material, ti = ['mercury', 'tube', 'wire', 'plasma'].indexOf(mat);
      for (var i = 0; i < 4; i++) { var tv = i === ti ? 1 : 0, nv = ease(st.pw[i], tv, dt, 0.18); st.pw[i] = Math.abs(nv - tv) < 0.002 ? tv : nv; }
      /* liquid lobes: damped springs that swell, overshoot and settle; directions glide after their magnets */
      var sp = v.speak, ls = v.listen, rd = v.read, wr = v.write, w0 = TAU * 2.3, z0 = 0.36;
      /* speaking pulls it into lobes; writing leans it toward the target, where the tendril leaves it */
      var tgtA = [0.42 * v.low * sp, 0.32 * (0.6 * v.low + 0.4 * v.mid) * sp, 0.2 * v.rms * sp + 0.12 * wr];
      var nS = Math.max(1, Math.ceil(dt / 0.008)), hS = dt / nS;
      for (var s2 = 0; s2 < nS; s2++) for (var j = 0; j < 3; j++) { lb.va[j] += (w0 * w0 * (tgtA[j] - lb.a[j]) - 2 * z0 * w0 * lb.va[j]) * hS; lb.a[j] = clamp(lb.a[j] + lb.va[j] * hS, -0.2, 0.42); }
      var na, nb, az;
      {
        var tt = st.time;
        na = [Math.cos(0.4 + tt * 0.19) * 0.8, 0.45 + 0.3 * Math.sin(tt * 0.23), 0.5];
        nb = [Math.cos(2.6 - tt * 0.13) * 0.8, 0.35 + 0.3 * Math.cos(tt * 0.17), 0.6];
        st.az = p.azimuth != null && isFinite(p.azimuth) ? +p.azimuth * DEG : wrapPi(st.az + dt * 0.06 * rm);
        az = st.az;
      }
      var kd = 1 - Math.exp(-dt / 0.2), tgtD = [norm3([na[0], na[1], na[2] + 0.55]), norm3([nb[0], nb[1], nb[2] + 0.55]), norm3([Math.cos(az), Math.sin(az), 0.35])];
      for (var q = 0; q < 3; q++) { var d0 = lb.d[q], d1 = tgtD[q]; lb.d[q] = norm3([lerp(d0[0], d1[0], kd), lerp(d0[1], d1[1], kd), lerp(d0[2], d1[2], kd)]); lb.k[q] = 5 + 6 * clamp(Math.abs(lb.a[q]) / 0.3, 0, 1); }
      st.spin += dt * (0.05 + 0.35 * v.energy * v.speak) * rm;
      /* what it reads or writes to is at `azimuth`: the mouth turns to face it and you; the tendril runs straight at it */
      if (rd > 0.01 || wr > 0.01) {
        var kr = rd / (rd + wr + 1e-4), flat = lerp(1, 0.52, kr), aimT = norm3([Math.cos(az) * flat, Math.sin(az) * flat, lerp(0.12, 0.82, kr)]), ka = 1 - Math.exp(-dt / 0.16);
        st.aim = norm3([lerp(st.aim[0], aimT[0], ka), lerp(st.aim[1], aimT[1], ka), lerp(st.aim[2], aimT[2], ka)]);
      }
      /* the tendril: sprung out to its reach while writing, drawn back in when it stops */
      var reach = 1.06, tenT = state === 'writing' ? reach : 0, wt = TAU * 1.9, zt = 0.5;
      for (var s4 = 0; s4 < nS; s4++) { st.tenV += (wt * wt * (tenT - st.ten) - 2 * zt * wt * st.tenV) * hS; st.ten = clamp(st.ten + st.tenV * hS, 0, 1.12); }
      /* size: a centred square; the GL canvas renders at up to 1.5× and adapts down on slow frames */
      var side = Math.max(16, Math.floor(Math.min(W, H))), dpr = dprNow();
      if (st.side !== side) {
        st.side = side;
        [c, cv2.current].forEach(function (k) { if (!k) return; k.style.width = side + 'px'; k.style.height = side + 'px'; k.style.left = Math.round((W - side) / 2) + 'px'; k.style.top = Math.round((H - side) / 2) + 'px'; });
      }
      var busy = v.think > 0.01 || v.speak > 0.01 || v.listen > 0.01 || rd > 0.01 || wr > 0.01 || st.shocks.length > 0;
      if (st.gl) {
        var ms = dt * 1000;
        if (busy) {
          if (ms > 24) { st.slowT += ms; st.fastT = 0; } else if (ms < 18) { st.fastT += ms; st.slowT = Math.max(0, st.slowT - ms * 0.5); }
          if (st.slowT > 1200 && st.quality > 0.5) { st.quality = Math.max(0.5, st.quality * 0.84); st.slowT = 0; }
          if (st.fastT > 5000 && st.quality < 1) { st.quality = Math.min(1, st.quality * 1.12); st.fastT = 0; }
        }
        var px = Math.max(64, Math.round(side * Math.min(dpr, 1.5) * st.quality));
        if (c.width !== px) { c.width = px; c.height = px; }
        var uR = 2 / 4.6, th = v.think, E = v.rms, LA = lb.a;
        var se = clamp((v.spikeEnv - 0.02) / 0.3, 0, 1), spikeH = 0.62 * se * se * (3 - 2 * se) * sp;
        var shs = st.shocks.slice(-4), SS = [], SA = [0, 0, 0, 0], shMax = 0;
        for (var m = 0; m < 4; m++) { var s3 = shs[m]; if (s3) { SS.push([s3.dir[0], s3.dir[1], s3.dir[2], s3.age]); SA[m] = s3.amp * 0.022 * Math.exp(-s3.age * 2.6); shMax = Math.max(shMax, SA[m]); } else SS.push([0, 0, 1, 9]); }
        var lobeSum = Math.max(0, LA[0]) + Math.max(0, LA[1]) + Math.max(0, LA[2]), lobeMag = Math.max(Math.abs(LA[0]), Math.abs(LA[1]), Math.abs(LA[2]));
        /* idle: a tide. A slow swell, in a little faster than out, and one long bulge whose axis comes round */
        var calm = (1 - clamp(Math.max(sp, ls, rd, wr), 0, 1)) * (1 - th), bt = st.time * TAU / 7.5, tw = st.time * 0.12;
        var swell = 0.02 * (Math.sin(bt) - 0.2 * Math.sin(2 * bt)) * calm, tide = norm3([Math.cos(tw), 0.3 * Math.sin(st.time * 0.19), Math.sin(tw)]);
        tide.push(0.05 * (0.65 + 0.35 * Math.sin(bt - 0.9)) * calm);
        /* listening: more rings the higher the voice, deeper the louder it is; they stand, and pulse */
        var rk = 16 + 20 * clamp((v.f0vis - 90) / 260, 0, 1), ra = Math.min(0.01 + 0.07 * v.rms, 0.85 / rk);
        /* thinking: the facets hold, then turn and re-cut on a beat */
        var ft = stepped(st.time, 0.95), facet = mul3(rotAxis(0.3, 0.9, 0.2, stepped(st.time, 0.95) * 0.62), rotAxis(0.8, -0.1, 0.55, stepped(st.time + 0.4, 1.9) * 0.9));
        /* writing: three needles in flight; the bouton swells as each one lands */
        var np = st.time * 1.35, land = np * 3 - Math.floor(np * 3), tenK = clamp(st.ten / reach, 0, 1), bulb = (0.062 + 0.04 * Math.exp(-land * 5)) * tenK;
        var thick = Math.max(0.02, (1.1 * 2 / c.width) / uR);
        var bound = Math.min(0.985, uR * Math.max(1 + lobeSum + spikeH + 0.1 + shMax * 1.2 + 0.07 * calm + 0.09 * drv + 0.13 * ls + 0.24 * th + 0.06 * rd, st.ten > 0.004 ? 1 + st.ten + bulb + 0.06 : 0));
        var slope = 2.1 * lobeMag + 22 * shMax + 0.15 + 0.7 * drv + (0.9 + ra * rk) * ls + 1.0 * rd + 0.8 * th + 0.5 * tenK, qq = st.quality;
        st.gl.draw({
          uTime: st.time, uR: uR, uBound: bound, uSpikeH: spikeH, uSpikeB: 0.24, uSpikeN: 260, uBreath: lerp(0.011, 0.018, sp) * (1 + 2.4 * drv), uThink: th,
          uFlow: (0.004 + 0.02 * drv + 0.024 * v.energy * sp) * (1 - th), uLK: lb.k,
          uListen: ls, uRead: rd, uWrite: wr, uSwell: swell, uTide: tide, uRip: [rk, 0.78 + 0.22 * Math.cos(st.time * TAU * 2.2), ra, 0], uFacetT: ft, uFacet: facet, uAim: st.aim, uTen: [st.ten, thick, np, bulb],
          uHalo: (0.14 + 0.5 * drv + 0.8 * E * sp + 0.3 * th + 0.1 * ls + 0.2 * rd + 0.26 * wr) * (P.light ? 0.7 : 1), uEnergy: E + 0.6 * drv, uPx: 2 / c.width, uStepK: clamp(0.88 / Math.sqrt(1 + slope * slope), 0.4, 0.85),
          uL0: lb.d[0], uL1: lb.d[1], uL2: lb.d[2], uLA: LA, uW: [st.pw[0], st.pw[1], st.pw[2]], uWp: st.pw[3],
          uCA: c01(P.a), uCB: c01(P.b), uHaloC: c01(P.halo),
          uS0: SS[0], uS1: SS[1], uS2: SS[2], uS3: SS[3], uSA: SA, uSpin: rotMat(st.spin), uSteps: qq > 0.9 ? 96 : qq > 0.7 ? 80 : 64, uDay: P.light ? 1 : 0,
        });
      } else if (cv2.current) {
        var c2 = cv2.current;
        fitCanvas(c2, side, side, dpr);
        var ctx = clearCanvas(c2, dpr), cx0 = side / 2, cy0 = side / 2, R = side / 4.6, kk = 1 + 0.06 * v.rms * v.speak - 0.03 * v.listen;
        ctx.beginPath();
        for (var n2 = 0; n2 <= 120; n2++) {
          var t2 = (n2 / 120) * TAU, rr = R * kk * (1 + 0.018 * Math.sin(3 * t2 + st.time) + 0.012 * Math.sin(5 * t2 - st.time * 1.3) + 0.08 * v.low * v.speak * Math.pow(Math.max(0, Math.cos(t2 - az)), 4));
          var x = cx0 + rr * Math.cos(t2), y = cy0 - rr * Math.sin(t2);
          if (n2) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        var g = ctx.createRadialGradient(cx0 - R * 0.38, cy0 - R * 0.42, R * 0.04, cx0, cy0, R * 1.05);
        g.addColorStop(0, rgba(P.c1, 1)); g.addColorStop(0.16, rgba(P.c2, 1)); g.addColorStop(0.5, rgba(P.c3, 1)); g.addColorStop(0.8, rgba(P.c4, 1)); g.addColorStop(0.94, rgba(P.c5, 1)); g.addColorStop(1, rgba(P.accent, 0.6));
        ctx.fillStyle = g; ctx.fill();
      }
    });
    return h('div', { ref: root, className: cx('ast-canvas', 'ast-core', p.className), style: p.style, role: 'img', 'aria-label': p.label || 'Voice core: ' + (STATE_WORD[normState(p.state)] || 'Idle') },
      h('canvas', { ref: cv, 'aria-hidden': 'true' }),
      h('canvas', { ref: cv2, 'aria-hidden': 'true', style: { display: 'none' } }));
  }

  var api = {
    Button: Button, ToggleButton: ToggleButton, FileButton: FileButton, SegmentedControl: SegmentedControl, TextField: TextField, Select: Select, Dock: Dock, Icon: Icon,
    KeyValueList: KeyValueList, Status: Status, Readout: Readout, BufferGauge: BufferGauge, ReadoutRow: ReadoutRow,
    Transcript: Transcript, Notice: Notice, Core: Core,
    SignalLoop: SignalLoop, Spinner: Spinner, Badge: Badge,
    Scene: Scene, Arrival: Arrival, Rings: Rings, Track: Track, Opening: Opening, Reticle: Reticle, Footprint: Footprint, YourWords: YourWords, Prepared: Prepared,
    Sheet: Sheet, Summon: Summon, Trace: Trace, Key: Key, Orbit: Orbit, Stream: Stream, Exchange: Exchange, Choice: Choice, Roster: Roster, Steps: Steps, Excerpt: Excerpt,
    ArcGauge: ArcGauge, Plate: Plate, Rule: Rule, Switch: Switch, Fader: Fader, Composer: Composer, Files: Files, Questions: Questions, Form: Form, ToolRow: ToolRow, Prose: Prose, Rail: Rail, Meter: Meter,
    createSignal: createSignal, demoSignal: demoSignal, noteName: noteName,
  };
  window.Astrolabe = assign(window.Astrolabe || {}, api);

})();
