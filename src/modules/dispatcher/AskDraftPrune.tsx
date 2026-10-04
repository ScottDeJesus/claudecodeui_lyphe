import { useEffect } from 'react';

import { pruneAskDrafts } from '@/modules/dispatcher/askDrafts';
import { asksOnLane } from '@/modules/dispatcher/askState';
import { DISPATCHER_ALL_TOPIC, useLiveTopic } from '@/modules/live-bus';
import type { DispatcherLanePicture } from '@/shared/types';

/**
 * KEEPS THE SAVED DRAFTS TO THE ASKS THE LANE STILL CARRIES, and draws nothing. Mounted by
 * `DispatcherFeed` beside the lane's bell, so it lives exactly as long as the page does and prunes
 * whichever home — the Roadmap tab's In flight face or the chat gutter's widget — is on screen, or neither.
 *
 * A draft belongs to one ask (`askDrafts.ts`), and an ask the lane stops naming — answered from
 * another device, retracted, re-cut under a new identity — is, as far as this page can tell, gone, so
 * its draft would only sit in the preference and push a live one toward the cap. ONE ask can come
 * back under the same identity: the store hides it while a planner outing is live on its plan or
 * arc, and shows it again when the outing ends. Its draft is dropped at the first frame without it
 * (the gap `askDrafts.ts` names as accepted). The frame's own plans are
 * asked, put-away ones included (`asksOnLane`): a plan the operator has hidden still owes his word
 * and keeps what he had typed, which `Show` brings back.
 *
 * NOTHING RETAINED IS NOT A LANE WITH NO ASKS. The bus holds nothing until the seed lands
 * (`DispatcherAskBell` measured the same gap), and reading that as a picture of no asks would wipe
 * every draft at each page load. A picture that really carries none does prune them all.
 *
 * The effect fires on every frame the bus publishes; a prune that finds nothing to drop writes
 * nothing (`pruneAskDrafts` returns before the write), so a quiet lane costs one set and no
 * preference change.
 */
export function AskDraftPrune() {
  const value = useLiveTopic<DispatcherLanePicture>(DISPATCHER_ALL_TOPIC);

  useEffect(() => {
    if (value === undefined) return;
    pruneAskDrafts(asksOnLane(value.payload.plans));
  }, [value]);

  return null;
}
