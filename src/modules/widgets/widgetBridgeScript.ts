/**
 * The script every widget document carries, verbatim and identical in all of them.
 *
 * It is the widget's only door outward. It opens no connection of its own — the document's CSP
 * forbids that — and reads nothing of the host's: everything it knows arrives as a message from
 * `window.parent`, and everything it says goes back the same way, through `postMessage`.
 *
 * It contains NO user content. The fence body a model wrote goes in the document's `<body>` and
 * is never interpolated in here, so this string is a constant of the build rather than something
 * assembled per widget. Plain ES5 — the frame parses it as-is, with no build step of its own.
 *
 * What it gives a widget author, as `window.live`:
 *   `live.subscribe(topic, fn, onError)` → an unsubscribe function
 *   `live.theme` — the last `{ dark, tokens }` the host sent
 *   `live.onTheme(fn)` → an off function, called on every later theme change
 *
 * The subscribe half is protocol-complete but has no producer until the live bus is wired: a
 * host with no handler answers every topic `{ type: 'error', reason: 'topic not allowed' }`,
 * which is the right answer for a surface that admits no topics yet.
 */
export const WIDGET_BRIDGE_SCRIPT = `
(function () {
  var host = window.parent;

  // The frame's origin is opaque (a sandbox without the same-origin token), so there is no
  // origin string to name and '*' is the only targetOrigin postMessage will accept here. Safe
  // in this direction because nothing sent up is a secret; the host protects itself the other
  // way round, by checking event.source is this frame's own contentWindow.
  var TARGET_ORIGIN = '*';

  // Both maps are keyed by TOPIC, which is a string the widget author chooses, so both are made
  // without a prototype. A plain {} inherits 'toString', 'constructor' and friends, and a topic
  // named for one of them would read back as an inherited function instead of as absent — the
  // lookup below would find a truthy non-array and throw out of the widget's own script, taking
  // down a subscribe that is contracted to always return an unsubscribe. A null prototype means
  // a topic is present only when it was actually put there, whatever it is called.
  var buckets = Object.create(null);
  var themeListeners = [];

  // The last thing each topic delivered, kept so a subscriber arriving after the first one is
  // not left silent — see the subscribe function below. Dropped when a topic's last leaves.
  var lastByTopic = Object.create(null);

  function post(message) {
    host.postMessage(message, TARGET_ORIGIN);
  }

  // A widget's own callback throwing must not take the bridge down with it, and must not vanish
  // either: the frame has its own console, and that is where a widget author looks.
  function report(what, error) {
    if (window.console && console.error) console.error('live: ' + what, error);
  }

  function subscribe(topic, fn, onError) {
    if (typeof topic !== 'string' || typeof fn !== 'function') return function () {};
    var entry = { fn: fn, onError: typeof onError === 'function' ? onError : null };
    var bucket = buckets[topic];
    if (!bucket) bucket = buckets[topic] = [];
    bucket.push(entry);
    // Only the first subscriber of a topic asks for it and only the last lets it go, so the
    // host sees one subscription per topic however many callbacks are behind it.
    if (bucket.length === 1) {
      post({ type: 'subscribe', topic: topic });
    } else if (Object.prototype.hasOwnProperty.call(lastByTopic, topic)) {
      // A later subscriber would otherwise hear nothing at all: the upward ask is suppressed
      // just above, so the host has no reason to send anything new. Replay what this topic last
      // delivered — a value or a refusal, since being told a topic is refused is also an answer
      // — asynchronously, so subscribe has returned its unsubscribe before the callback runs
      // and a callback that unsubscribes immediately is still honoured.
      var replay = lastByTopic[topic];
      setTimeout(function () {
        if (bucket.indexOf(entry) >= 0) dispatchTo(entry, replay);
      }, 0);
    }

    var released = false;
    return function unsubscribe() {
      if (released) return;
      released = true;
      var at = bucket.indexOf(entry);
      if (at >= 0) bucket.splice(at, 1);
      if (bucket.length === 0) {
        delete buckets[topic];
        // The retained message goes with it. The next first subscriber asks the host afresh, so
        // keeping it could only replay something stale to a second subscriber that arrived
        // before that answer came back.
        delete lastByTopic[topic];
        post({ type: 'unsubscribe', topic: topic });
      }
    };
  }

  function onTheme(fn) {
    if (typeof fn !== 'function') return function () {};
    themeListeners.push(fn);
    return function off() {
      var at = themeListeners.indexOf(fn);
      if (at >= 0) themeListeners.splice(at, 1);
    };
  }

  var live = { subscribe: subscribe, onTheme: onTheme, theme: null };
  window.live = live;

  // The token names the last theme message actually set. A name that disappears from a later
  // payload has to be REMOVED, not merely left unwritten: these land as inline properties on the
  // root element, and an inline property outranks the ':root' rule the document was built with,
  // so a token defined in one theme and absent from the next would keep its stale value forever.
  // Invisible today — Verve declares all of them in both themes — and silent on the day one is
  // dropped from one theme only, which is exactly when nobody would think to look here.
  var appliedTokenNames = [];

  function applyTheme(message) {
    var root = document.documentElement;
    if (message.dark) root.classList.add('dark');
    else root.classList.remove('dark');

    var tokens = message.tokens || {};
    for (var gone = 0; gone < appliedTokenNames.length; gone++) {
      if (!Object.prototype.hasOwnProperty.call(tokens, appliedTokenNames[gone])) {
        root.style.removeProperty(appliedTokenNames[gone]);
      }
    }

    appliedTokenNames = [];
    for (var name in tokens) {
      if (Object.prototype.hasOwnProperty.call(tokens, name)) {
        root.style.setProperty(name, tokens[name]);
        appliedTokenNames.push(name);
      }
    }

    live.theme = { dark: !!message.dark, tokens: tokens };
    for (var i = 0; i < themeListeners.length; i++) {
      try { themeListeners[i](live.theme); } catch (error) { report('theme listener failed', error); }
    }
  }

  // One subscriber, one message. Shared by live delivery and by the replay a late subscriber
  // gets, so both paths treat a throwing callback identically.
  function dispatchTo(entry, message) {
    try {
      if (message.type === 'data') entry.fn(message.payload, { topic: message.topic, at: message.at });
      else if (entry.onError) entry.onError(message.reason);
    } catch (error) {
      report('subscriber for ' + message.topic + ' failed', error);
    }
  }

  function deliver(message) {
    var bucket = buckets[message.topic];
    // Retain only what a LIVE subscription asked for. Retaining before this check would keep a
    // message for a topic nobody holds, and nothing would ever clear it — only the last
    // unsubscribe of a topic drops its entry, and there is no unsubscribe to come for a topic
    // that was never subscribed. The next subscriber would then be replayed a value that
    // predates it, delivered on behalf of a subscription that no longer exists.
    if (!bucket) return;
    lastByTopic[message.topic] = message;
    var copy = bucket.slice();
    for (var i = 0; i < copy.length; i++) dispatchTo(copy[i], message);
  }

  window.addEventListener('message', function (event) {
    // Identity, not origin: every sandboxed document shares the opaque origin 'null', so the
    // window object is the only thing distinguishing the embedder from any other frame.
    if (event.source !== host) return;
    var message = event.data;
    if (!message || typeof message !== 'object' || typeof message.type !== 'string') return;

    if (message.type === 'theme') applyTheme(message);
    else if (message.type === 'data' || message.type === 'error') deliver(message);
  });

  // Coalesced through a frame: a widget that lays itself out in several steps would otherwise
  // post a height per step and make the host's iframe visibly stutter.
  //
  // A timer RACES that frame, and the race is the point. requestAnimationFrame is tied to
  // RENDERING, so a widget mounted below the fold can be handed no frame at all until the reader
  // scrolls to it — and the single report the host waits on sits pending, leaving a tall widget
  // stuck at the host's floor, occupying almost nothing, until it happens to be reached.
  // Whichever fires first reports and cancels the other: an offscreen widget sizes itself on the
  // timer, a visible one still coalesces to a frame.
  var HEIGHT_FALLBACK_MS = 250;
  var rafToken = 0;
  var timerToken = 0;

  function measure() {
    if (!document.body) return;
    post({ type: 'resize', height: Math.ceil(Math.max(document.body.scrollHeight, document.body.offsetHeight)) });
  }

  function flush() {
    if (rafToken) cancelAnimationFrame(rafToken);
    if (timerToken) clearTimeout(timerToken);
    rafToken = timerToken = 0;
    measure();
  }

  function reportHeight() {
    if (rafToken || timerToken || !document.body) return;
    rafToken = requestAnimationFrame(flush);
    timerToken = setTimeout(flush, HEIGHT_FALLBACK_MS);
  }

  function watchBody() {
    if (!document.body) return;
    if (typeof ResizeObserver === 'function') new ResizeObserver(reportHeight).observe(document.body);
    reportHeight();
  }

  // This script runs in <head>, before the body it measures exists.
  if (document.body) watchBody();
  else document.addEventListener('DOMContentLoaded', watchBody);
  window.addEventListener('load', reportHeight);

  post({ type: 'ready' });
})();
`;
