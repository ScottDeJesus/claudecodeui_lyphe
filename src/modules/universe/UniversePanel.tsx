import { LocateFixed } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

import { useUniverseMap } from '@/modules/universe/hooks/useUniverseMap';
import { useUniverseStream } from '@/modules/universe/hooks/useUniverseStream';
import { useUniverseTweaks } from '@/modules/universe/hooks/useUniverseTweaks';
import type { UniverseMapState } from '@/modules/universe/hooks/useUniverseMap';
import type { UniverseStream } from '@/modules/universe/hooks/useUniverseStream';
import type { UniverseTweaksHandle } from '@/modules/universe/hooks/useUniverseTweaks';
import { UniverseActivityFeed } from '@/modules/universe/UniverseActivityFeed';
import { UniverseCanvas } from '@/modules/universe/UniverseCanvas';
import { UniverseSelectionPanel } from '@/modules/universe/UniverseSelectionPanel';
import { UniverseStatsStrip } from '@/modules/universe/UniverseStatsStrip';
import { UniverseTweaksPanel } from '@/modules/universe/UniverseTweaksPanel';
import type { UniverseMap } from '@/shared/types';
import { Banner, Button, EmptyState, Spinner } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * THE TAB — the sky beneath, three regions of chrome over it, and two buttons.
 *
 * WHERE THINGS ARE, AND WHY. The strip is top-left, where the eye lands first: how big is this
 * and is it alive. The two buttons are top-right, out of the reading path. The selection panel
 * opens under them, on the right, so a click in the sky is answered beside the hand that made it
 * and the strip is never covered. The feed is bottom-right, the last thing read, and the one that
 * moves. The middle of the screen is the sky and nothing sits on it.
 *
 * THE PANEL POSITIONS; THE REGIONS PAINT. Every `absolute` here belongs to a wrapper the panel
 * owns, and none of the regions places itself — so a region could be laid out differently by
 * another screen without a restyle (doctrine §4).
 *
 * ON A PHONE the strip wraps under the buttons, the selection panel rises from the bottom as a
 * sheet (under the thumb, and never over the strip), the feed takes the full width there too, and
 * the feed hides while a selection is open: both cannot fit, and the one the person just asked
 * for wins. On a desktop the selection panel is capped so it never reaches the feed below it,
 * with a floor so a short viewport — a landscape phone is `sm:` — still gets a readable panel. The strip lets pointer events through, so a drag that starts on its
 * numbers still moves the sky.
 *
 * FOUR STATES FOR THE MAP FETCH. Loading with nothing held: a spinner over the sky, saying what is
 * being waited for. A map with no stars: an empty state saying why. An error: an amber banner
 * under the strip, with the sky left as it was — the store retries on the next announcement, so
 * the banner is news, never a dead end. And the map itself, with the chrome over it.
 */

/** Used by the project workspace (`WorkspaceMain`) as the Universe tab's whole pane. */
export function UniversePanel() {
  // THE MAP is fetched here and handed down: one request for the whole tab, and the canvas, the
  // strip and the two panels all read the one copy.
  const { map, loading: mapLoading, error: mapError }: UniverseMapState = useUniverseMap();
  // THE STREAM is the lane's second reader, and the two consumers want opposite things from it: the
  // canvas takes every raw row through `subscribeRows` (no render), while the feed, the strip and
  // the selection panel read the 1 Hz snapshot below — so a busy second re-renders the chrome once.
  const { subscribeRows, recentRows, rate, countsFor }: UniverseStream = useUniverseStream();
  // THE TWEAKS live up here because two readers need the same object: the panel below, which is
  // React and shows the values, and the canvas's frame, which reads them through this same ref.
  const { tweaks, tweaksRef, setTweak, reset: resetTweaks }: UniverseTweaksHandle = useUniverseTweaks();
  // The canvas writes its camera's recenter into `recenterRef` as it mounts, so this button calls
  // the camera without the panel knowing one exists — and with no state that could go stale.
  const onRecenter = (): void => recenterRef.current?.();

  // The node the reader chose — on the sky, or in the selection panel's neighbour list — TOGETHER
  // WITH the map it was chosen on. Held here because three regions read it: the canvas holds it, the
  // selection panel describes it, and the feed yields to the panel on a phone while it is set.
  //
  // WHY THE MAP IS PART OF THE CHOICE. A node is an INDEX into the crawler's arrays, and the crawler
  // assigns them afresh on every crawl — so a choice that outlived its map would name whatever node now
  // holds that index, and the card would describe another file's lines, churn, routes and loggers under
  // the name the reader picked. Reading the choice through the map it belongs to makes that impossible
  // without an effect and without a frame of staleness: a map that is not the one the reader chose on
  // has no choice to answer with, so the card closes, the camera lets the star go and the feed comes
  // back, all in the render the new map arrives in.
  const [choice, setChoice] = useState<{ map: UniverseMap | null; node: number | null }>({ map: null, node: null });
  const selectedNode = choice.map === map ? choice.node : null;

  // Where the canvas puts its recenter, so the button up here can call it without this panel
  // knowing the camera.
  const recenterRef = useRef<(() => void) | null>(null);

  // A choice is made against the map held at the time, and this is the one door it comes in by —
  // stable for as long as that map is, because the canvas keeps it for the life of its loop and must
  // not be handed a fresh function by the stream's own 1 Hz re-render.
  const onSelectNode = useCallback((node: number | null): void => setChoice({ map, node }), [map]);

  const hasMap = map !== null && map.nodes.length > 0;

  return (
    <div className="relative h-full w-full overflow-hidden bg-background" data-universe-panel>
      <UniverseCanvas
        map={map}
        tweaksRef={tweaksRef}
        subscribeRows={subscribeRows}
        selectedNode={selectedNode}
        onSelectNode={onSelectNode}
        recenterRef={recenterRef}
      />

      {map === null && mapLoading && (
        <div className="absolute inset-0 grid place-items-center">
          <Spinner label="Reading the map…" />
        </div>
      )}

      {map !== null && map.nodes.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6">
          <EmptyState
            title="No stars"
            message="The crawler wrote a map with nothing in it. It writes another whenever a repo's HEAD moves."
          />
          {map.warnings.length > 0 && (
            <ul className="flex max-w-md flex-col gap-1 text-[13px] text-warn-ink">
              {map.warnings.map((warning) => (
                <li key={warning}>▲ {warning}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="pointer-events-none absolute left-4 top-4 flex w-[calc(100%-8rem)] max-w-3xl flex-col gap-2 sm:left-6 sm:top-6">
        {hasMap && <UniverseStatsStrip map={map} rate={rate} />}
        {mapError !== null && (
          <Banner tone="warn">
            <span className="text-[13px]">
              The map could not be read — {mapError}. The sky stays as it was; the next crawl is retried on its own.
            </span>
          </Banner>
        )}
      </div>

      <div className="absolute right-4 top-4 flex items-center gap-1">
        <Button variant="outline" size="icon" aria-label="Recenter" title="Recenter" disabled={!hasMap} onClick={onRecenter}>
          <LocateFixed aria-hidden="true" />
        </Button>
        <UniverseTweaksPanel tweaks={tweaks} onChangeTweak={setTweak} onResetTweaks={resetTweaks} />
      </div>

      {hasMap && (
        <div className="absolute inset-x-4 bottom-4 flex max-h-[55%] flex-col sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-16 sm:max-h-[max(14rem,calc(100%-24rem))] sm:w-80">
          <UniverseSelectionPanel map={map} selectedNode={selectedNode} countsFor={countsFor} onSelectNode={onSelectNode} />
        </div>
      )}

      {hasMap && (
        <div
          className={cn(
            'absolute inset-x-4 bottom-4 flex max-h-[30%] flex-col sm:inset-x-auto sm:right-4 sm:max-h-72 sm:w-96',
            selectedNode !== null && 'hidden sm:flex',
          )}
        >
          <UniverseActivityFeed map={map} recentRows={recentRows} />
        </div>
      )}
    </div>
  );
}
