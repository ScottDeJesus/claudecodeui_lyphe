// `tcp {host, port}` — can a connection be opened, and how long did it take. Metric: `took_ms`;
// it passes when the connection opens (the kind's default pass is "took_ms >= 0", which only a
// connection that opened can satisfy). Nothing is sent: the socket closes the moment it connects.

import net from 'node:net';

import { deadlineMs, describeNetworkError, elapsedMs, finishProbe, formatSeconds, missingField, unrunnable } from '../probe-support.mjs';

// One connection attempt, resolving with `{ connected }`, `{ timedOut }` or `{ error }`.
function connectOnce(host, port, timeoutMs) {
  return new Promise((resolve) => {
    let timer;
    let socket;
    const finish = (answer) => {
      clearTimeout(timer);
      socket?.destroy();
      resolve(answer);
    };

    try {
      socket = net.connect({ host, port });
    } catch (error) {
      // net.connect throws on a malformed port before it opens anything.
      finish({ error });
      return;
    }
    timer = setTimeout(() => finish({ timedOut: true }), timeoutMs);
    socket.on('connect', () => finish({ connected: true }));
    socket.on('error', (error) => finish({ error }));
  });
}

export async function run(spec, _memory) {
  // A missing host would not fail — net.connect quietly falls back to localhost — so it is refused here.
  const missing = missingField(spec, ['host', 'port']);
  if (missing) return unrunnable(spec, missing);
  if (!Number.isInteger(spec.port) || spec.port < 1 || spec.port > 65_535) {
    return unrunnable(spec, "The definition's port can't be read");
  }

  const startedAt = performance.now();
  const answer = await connectOnce(spec.host, spec.port, deadlineMs(spec));
  const tookMs = elapsedMs(startedAt);

  if (answer.timedOut) {
    return finishProbe(spec, {
      completed: false,
      sentence: `No answer within ${formatSeconds(spec.timeout)}`,
      data: { error: 'timeout', took_ms: tookMs },
    }, tookMs);
  }
  if (answer.error) {
    const { code, sentence } = describeNetworkError(answer.error);
    return finishProbe(spec, { completed: false, sentence, data: { error: code, took_ms: tookMs } }, tookMs);
  }
  return finishProbe(spec, {
    completed: true,
    sentence: `Connected in ${tookMs} ms`,
    metrics: { took_ms: tookMs },
  }, tookMs);
}
