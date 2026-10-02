import { useEffect, useRef } from 'react';

import { asksOnLane } from '@/modules/dispatcher/askState';
import { DISPATCHER_ALL_TOPIC, useLiveTopic } from '@/modules/live-bus';
import type { DispatcherLanePicture } from '@/shared/types';
import { playNotificationSound } from '@/shared/utils';

/**
 * How many identities the bell remembers before the oldest is forgotten. A ROUND number, and a cap
 * rather than no cap at all: this memory is a plain array walked on every frame the lane publishes,
 * so it has to end somewhere — and 200 asks is several sitting days of the dispatcher's own prompts,
 * far past the point where a prompt still standing could be pushed out by newer ones.
 */
const HEARD_LIMIT = 200;

/**
 * THE LANE'S BELL: it says, out loud, that an ask has appeared — `raised by CloudCLI`, in the
 * design's words — and it draws NOTHING at all. It is mounted by `DispatcherFeed`, inside the auth
 * gate and under the one socket, so it lives exactly as long as the page does.
 *
 * WHAT IT RINGS FOR IS NEW NEWS, NOT NEWS ON SCREEN. The card is already drawn on the plan's own
 * card in the Runner tab and the gutter's widget, and a chime that fired while the operator was
 * LOOKING at the board would be noise about something he can see. So the bell remembers the asks it
 * has already heard and rings only for an identity that is new to it — which, by `askIdentity`'s own
 * rule (`askState.ts`), means a NEW `asked` event:
 *
 *   - a page opened onto a waiting prompt holds that ask as its FIRST PICTURE and stays silent: the
 *     card is on screen, and a chime at load would be the same sound as a chime for news. The bus
 *     holds NOTHING until the seed lands, which is why the memory ignores the empty first commit
 *     rather than remembering it as a picture of no asks — measured: without that gate the seed
 *     itself rang, one chime at every page load (`.verify/probe-card-ask.mjs --retired`);
 *   - a dev-server handover remounts this component and re-seeds the same identities, and stays
 *     silent for the same reason;
 *   - a RE-CUT is a new `asked` event under the same plan, so it is a new identity and it rings:
 *     the prompt the operator answered is not the prompt he is being shown now;
 *   - a model press rewrites the census under the SAME ask, so the identity does not move and
 *     nothing rings — what changed is the words, not the question.
 *
 * ONE RING PER PICTURE, however many identities are new: the chime says "a plan wants your word",
 * never how many, and three prompts raised by one frame are not three bells.
 *
 * IT READS THE PICTURE, NOT `useDispatcherPlans`. The ask is the store's own record on the plan, and
 * a plan the operator has put away is still on the lane and still owes him a word — so the bell asks
 * the frame's own `plans` for their asks and knows nothing about this box's Hide list. It reads the
 * bus, so a frame and a seed are the same event to it, and the bus's own dedupe means a poll that
 * changed nothing never reaches this file at all.
 */
export function DispatcherAskBell() {
  const value = useLiveTopic<DispatcherLanePicture>(DISPATCHER_ALL_TOPIC);

  // What this mount has already heard, oldest first — `null` until the first picture lands, which is
  // what tells "the page opened onto an ask" apart from "an ask just arrived". A REF and not state:
  // nothing renders from it (this component returns `null`), and a memory that re-rendered the tree
  // above it would make the sound a render's side effect instead of an event's.
  const heard = useRef<string[] | null>(null);

  useEffect(() => {
    // NOTHING RETAINED IS NOT A PICTURE OF NOTHING. This mount's first commit runs with the seed
    // still in flight (`DispatcherFeed` subscribes and reads the lane in ITS effect, and a child's
    // effect runs first), so the bus holds no picture at all yet — and reading that as a picture
    // carrying no asks would make the seed itself look like news and ring at load for prompts that
    // were already standing when the page opened. The memory holds until a picture really lands, and
    // THAT picture is the silent first one.
    if (value === undefined) return;

    const identities = asksOnLane(value.payload.plans);
    const previous = heard.current;
    heard.current = heardAfter(previous ?? [], identities);
    // THE FIRST PICTURE IS ONLY REMEMBERED. Everything it carried was standing when this mount
    // arrived — the operator opened the page onto it, or the dev server handed this page over — so
    // it is the silence the decisions above ask for, and never a ring.
    if (previous === null) return;
    const remembered = new Set(previous);
    if (identities.some((identity) => !remembered.has(identity))) void playNotificationSound();
  }, [value]);

  return null;
}

/**
 * The memory after a picture: what it already held and this picture does not carry, then this
 * picture's own asks, oldest out first past the cap.
 *
 * Re-seen asks move to the NEW end on purpose. The cap evicts from the old end, so an ask still
 * standing on the lane can never be pushed out by churn elsewhere and rung a second time when the
 * next frame re-sends it — while an ask that has been answered and is no longer carried does age
 * out, which is what keeps this memory from growing without bound over a long day.
 */
function heardAfter(held: readonly string[], identities: readonly string[]): string[] {
  const carried = new Set(identities);
  const gone = held.filter((identity) => !carried.has(identity));
  const next = [...gone, ...identities];
  return next.length > HEARD_LIMIT ? next.slice(next.length - HEARD_LIMIT) : next;
}
