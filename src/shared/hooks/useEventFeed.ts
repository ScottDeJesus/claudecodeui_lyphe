import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useHostWindow } from '@/shared/context/HostWindowContext';

/**
 * How long after a refused dial the feed is dialled again, doubling with each refusal up to the cap. The lane answers 503
 * for every second the engine takes to boot, and a browser never re-dials an `EventSource` that got a status: the engine
 * offers no event for "I am back", so the one thing left is to try again, a little later each time, until it answers.
 */
const REDIAL_FIRST_MS = 1000;
const REDIAL_MAX_MS = 30_000;

/**
 * What the feed tells a listener. `open` is every (re)dial of the connection: the feed keeps no history and its frames carry
 * no id, so whatever moved while it was closed is lost, and a listener reads again on `open`. `frame` is one told change.
 */
export type FeedEvent<F> = { kind: 'open' } | { kind: 'frame'; frame: F };

type FeedListener<F> = (event: FeedEvent<F>) => void;

/**
 * The feed's one connection, as its readers hold it: they subscribe, and never open a connection of their own. `redial` dials
 * a feed that was refused at once instead of at the end of its wait (a press of Refresh or Try again asks it); it does
 * nothing while the feed is open or opening.
 */
export type EventFeed<F> = { subscribe: (listener: FeedListener<F>) => () => void; redial: () => void };

/**
 * What a view hands the feed: where it dials, how one message is read, whether the view wants the feed open, and the name the
 * console lines say it by. A caller may pass inline functions; the feed always uses the latest ones.
 */
type EventFeedAsk<F> = {
  /** Read at every dial, not once: it carries the stored token, which may change. */
  url: () => string;
  /** Turns one message's data into a frame; a `null` is dropped and no listener hears it. */
  parse: (data: string) => F | null;
  /** Opens the feed while true, and closes it the moment it is false. */
  active: boolean;
  /** The feed's name as its console lines say it, e.g. `'upload runs'`. */
  name: string;
};

type FeedHub<F> = EventFeed<F> & { publish: FeedListener<F>; attach: (redial: (() => void) | null) => void };

/** A listener that throws must not keep the others from hearing: each is isolated, and the failure is said. */
function createHub<F>(name: string): FeedHub<F> {
  const listeners = new Set<FeedListener<F>>();
  // What a `redial` does now: set by the connection while it stands, so a press never reaches a connection that is gone.
  let redialNow: (() => void) | null = null;
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish: (event) => {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (failure) {
          console.error(`A reader of the ${name} feed failed on a frame; the others still heard it.`, failure);
        }
      }
    },
    redial: () => redialNow?.(),
    attach: (redial) => {
      redialNow = redial;
    },
  };
}

/**
 * THE ONE CONNECTION of a view to one server-sent feed: an `EventSource` on that feed, open only while the view is shown and
 * closed the moment it is hidden. The feed tells that something changed, after the change committed; the view's readers
 * subscribe through `useFeedEvents`, re-read what the frame names and poll nothing. The browser re-dials a dropped
 * connection by itself, and each dial is told to the readers as `open`.
 *
 * A DIAL THE LANE REFUSES IS DIALLED AGAIN. The browser gives up for good on a status (the lane's 503 while the engine
 * boots, a 401 on a lapsed login), so any restart of the engine under a shown view would leave it deaf, looking current, for
 * the rest of the show. So a refused dial arms ONE timeout (`REDIAL_FIRST_MS`, doubling to `REDIAL_MAX_MS`) that dials
 * again, and a press of Refresh or Try again dials at once (`redial`); the timeout is armed only by a refusal and is
 * cleared when the view is hidden. It is the one timer here, and it asks nothing but "is the feed answering": what moved
 * meanwhile is read on the `open` that ends the wait.
 *
 * Used by the upload-runs module's `useRunsFeed` and the scheduling-report module's `useSchedulingRead`.
 */
export function useEventFeed<F>({ url, parse, active, name }: EventFeedAsk<F>): EventFeed<F> {
  const hostWindow = useHostWindow();
  // The listeners' registry, made once: every reader subscribes to this same object, so it must outlive any render.
  const [hub] = useState(() => createHub<F>(name));
  // Refs, not deps: an inline url or parse must not re-dial the feed on each render.
  const urlRef = useRef(url);
  const parseRef = useRef(parse);
  useLayoutEffect(() => {
    urlRef.current = url;
    parseRef.current = parse;
  });

  useEffect(() => {
    if (!active) return undefined;
    let source: EventSource | null = null;
    // The armed re-dial, while the feed is refused and waiting to be dialled again.
    let waiting: number | null = null;
    let refusals = 0;

    const dial = () => {
      waiting = null;
      source?.close();
      const dialled = new EventSource(urlRef.current());
      source = dialled;
      dialled.onopen = () => {
        refusals = 0;
        hub.publish({ kind: 'open' });
      };
      dialled.onmessage = (message) => {
        const frame = parseRef.current(message.data);
        if (frame !== null) hub.publish({ kind: 'frame', frame });
      };
      dialled.onerror = () => {
        // CONNECTING is a drop the browser is already re-dialling; CLOSED is a refusal it will not retry.
        if (dialled.readyState !== EventSource.CLOSED) return;
        refusals += 1;
        const wait = Math.min(REDIAL_MAX_MS, REDIAL_FIRST_MS * 2 ** (refusals - 1));
        if (refusals === 1) console.warn(`The ${name} feed was refused; dialling it again in ${wait / 1000} s, and again with a longer wait each time it is refused.`);
        waiting = hostWindow.setTimeout(dial, wait);
      };
    };

    dial();
    hub.attach(() => {
      if (waiting === null) return;
      hostWindow.clearTimeout(waiting);
      dial();
    });
    return () => {
      hub.attach(null);
      if (waiting !== null) hostWindow.clearTimeout(waiting);
      source?.close();
    };
  }, [active, hub, hostWindow, name]);

  return hub;
}

/**
 * Calls the LATEST `listener` for every event the feed tells, for as long as the caller stands. The listener is held in a
 * ref, written in a layout effect, so a caller can hand in an inline function without re-subscribing on each render: a
 * subscription re-made each render would open a gap in which a frame goes unheard.
 *
 * Used by the upload-runs module's `useUploadsRead`, `useLiveRun` and `useRunSheet`, and the scheduling-report module's
 * `useSchedulingRead` and `useEntrySheet`.
 */
export function useFeedEvents<F>(feed: EventFeed<F>, listener: FeedListener<F>): void {
  const latest = useRef(listener);
  useLayoutEffect(() => {
    latest.current = listener;
  });

  useEffect(() => feed.subscribe((event) => latest.current(event)), [feed]);
}
