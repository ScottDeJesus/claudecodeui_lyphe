/**
 * ComfyUI's event socket, `/ws?clientId=…`, opened once for a bake through Node's own `WebSocket`. A frame's end is an
 * event on it — the `executed` event of the ExpressionEditor node, or an `execution_error` — never a poll of the queue.
 */

/** Where the node saved its preview: the arguments of `GET /view`. The node names no `subfolder` for a temp image, so it may be absent. */
type ComfyImage = { filename: string; subfolder?: string; type: string };

type FrameEvents = {
  /** Resolves with the prompt's preview image, rejects with its error, or with `signal`'s reason. */
  imageOf(promptId: string, signal: AbortSignal): Promise<ComfyImage>;
  /** Rejects every frame still waiting, and every one that asks later. */
  fail(error: Error): void;
  close(): void;
};

type Outcome = { image: ComfyImage } | { error: Error };

/** The ExpressionEditor's id in the prompt `comfyui.ts` sends: its `executed` event is the frame's end. */
const EDITOR_NODE_ID = '2';

/** Opens the socket and answers once it is open; `note` receives anything about it worth the bake's log. Consumed by `comfyui.ts`. */
export async function openFrameEvents(port: number, clientId: string, note: (line: string) => void): Promise<FrameEvents> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?clientId=${clientId}`);
  // An event can land before `imageOf` is asked for its prompt (the POST's answer and the socket race), so outcomes are
  // kept by prompt id until asked for.
  const outcomes = new Map<string, Outcome>();
  const waiting = new Map<string, (outcome: Outcome) => void>();
  let failure: Error | null = null;

  const settle = (promptId: string, outcome: Outcome) => {
    const waiter = waiting.get(promptId);
    if (waiter) {
      waiting.delete(promptId);
      waiter(outcome);
    } else {
      outcomes.set(promptId, outcome);
    }
  };

  const fail = (error: Error) => {
    failure ??= error;
    for (const promptId of [...waiting.keys()]) settle(promptId, { error: failure });
  };

  socket.addEventListener('message', (message) => {
    if (typeof message.data !== 'string') return; // binary frames are ComfyUI's live previews, which the bake does not use
    let event: { type?: string; data?: Record<string, unknown> };
    try {
      event = JSON.parse(message.data);
    } catch (error) {
      note(`event socket: a message was not JSON (${(error as Error).message}): ${message.data.slice(0, 120)}`);
      return;
    }
    const data = event.data ?? {};
    const promptId = typeof data.prompt_id === 'string' ? data.prompt_id : null;
    if (promptId === null) return;

    if (event.type === 'executed' && data.node === EDITOR_NODE_ID) {
      const images = (data.output as { images?: ComfyImage[] } | undefined)?.images;
      settle(promptId, images?.[0] ? { image: images[0] } : { error: new Error('the node finished but named no preview image') });
    } else if (event.type === 'execution_error') {
      const detail = `${data.node_type ?? 'node'}: ${data.exception_message ?? 'no message'}`;
      settle(promptId, { error: new Error(`ComfyUI could not render the frame (${detail})`) });
    } else if (event.type === 'execution_cached' && Array.isArray(data.nodes) && data.nodes.includes(EDITOR_NODE_ID)) {
      // Cannot happen while the bake renders each distinct slider set once (the frame cache dedupes them); named so it is not a silent hang.
      settle(promptId, { error: new Error('ComfyUI answered the frame from its own cache and sent no image') });
    }
  });
  socket.addEventListener('close', () => fail(new Error('ComfyUI closed its event socket')));

  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('the event socket of ComfyUI could not be opened')), { once: true });
  });

  return {
    imageOf(promptId, signal) {
      return new Promise<ComfyImage>((resolve, reject) => {
        const earlier = outcomes.get(promptId) ?? (failure ? { error: failure } : undefined);
        const onAbort = () => {
          waiting.delete(promptId);
          reject(signal.reason);
        };
        const answer = (outcome: Outcome) => {
          signal.removeEventListener('abort', onAbort);
          outcomes.delete(promptId);
          if ('image' in outcome) resolve(outcome.image);
          else reject(outcome.error);
        };
        if (earlier) return answer(earlier);
        if (signal.aborted) return reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
        waiting.set(promptId, answer);
      });
    },
    fail,
    close() {
      socket.close();
    },
  };
}
