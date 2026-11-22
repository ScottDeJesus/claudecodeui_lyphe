import { isRecord, readBody, sentenceOf } from '@/modules/rnd/rndWire';
import { api } from '@/shared/api';

/** A spike the server would not start, in its own sentence (the dispatcher's, or the relay's). Any other throw is the network's. */
export class SpikeRefusal extends Error {}

type SpikeStart = { sessionId: string; prompt: string; model: string };

/**
 * SPIKE A CANDIDATE IN A CHAT OF ITS OWN. The server opens the chat in the project and stamps the candidate spiking with its
 * session (POST /api/rnd/candidates/:name/spike); this sends the two frames git-delegation/startRun.ts sends, the /spike prompt at
 * the model the launch table gives rnd.spike, and goes to the chat through the wheel's goChat. Used by useRndWrites for Spike and
 * for Spike again.
 *
 * Four options and no more, as startRun's: the server resolves the rest from the session row. bypassPermissions because the spike
 * runs unattended in its own workdir, under /spike's Guard.
 */
export async function startSpikeChat(
  name: string,
  projectPath: string,
  sendMessage: (message: unknown) => void,
  goChat: (sessionId: string) => void,
): Promise<void> {
  const response = await api.rnd.spike(name, { projectPath });
  const body = await readBody(response);
  if (!response.ok) throw new SpikeRefusal(sentenceOf(body) || 'The server would not start the spike (' + response.status + ').');
  const start = asSpikeStart(body);
  if (start === null) throw new SpikeRefusal('The server started the spike but did not say which chat it opened.');

  sendMessage({
    type: 'chat.send',
    sessionId: start.sessionId,
    content: start.prompt,
    options: { provider: 'claude', model: start.model, permissionMode: 'bypassPermissions', skipPermissions: true },
  });
  // The gateway's own shape (chat.subscribe { sessions }): a bare sessionId is silently ignored.
  sendMessage({ type: 'chat.subscribe', sessions: [{ sessionId: start.sessionId, lastSeq: 0 }] });
  goChat(start.sessionId);
}

function asSpikeStart(value: unknown): SpikeStart | null {
  if (!isRecord(value)) return null;
  const { sessionId, prompt, model } = value;
  if (typeof sessionId !== 'string' || sessionId === '' || typeof prompt !== 'string' || typeof model !== 'string') return null;
  return { sessionId, prompt, model };
}
