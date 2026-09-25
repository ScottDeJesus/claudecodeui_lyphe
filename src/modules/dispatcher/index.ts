// The dispatcher lane's door into the live bus. App mounts it once, inside LiveBusProvider and
// directly inside RunnerFeed, beside every other lane's feed.
export { DispatcherFeed } from '@/modules/dispatcher/DispatcherFeed';
// The lane's read side — every v3 plan the store holds, this box's posture beside them, and which
// complete plans the operator has already dismissed. The Runner tab reads it for the card list and
// for the count that gates the tab.
export { useDispatcherPlans } from '@/modules/dispatcher/hooks/useDispatcherPlans';
// Both hands, one hook: the plan card's six verbs and the arc header's four — stop, resume, schedule
// and the arc's model word — relayed to the dispatcher's own binary and answered with its own
// sentence. `scope` is the whole of what differs: which door a press goes through. A caller presses
// one and re-draws from the next frame; nothing is guessed here.
export { useDispatcherVerbs } from '@/modules/dispatcher/hooks/useDispatcherVerbs';
// The pure vocabulary of a plan, so a card never re-derives a tone, a glyph, a progress count or
// the order the cards sit in — and the lane's own split, so the Runner tab and the chat gutter's
// widget group and order the arcs' plans by ONE rule instead of two.
export {
  byArc,
  byUrgencyThenNewest,
  deckFocusIndex,
  epochOf,
  PHASE_GLYPH,
  phaseProgress,
  phaseStatusTone,
  planDismissal,
  planLayer,
  planStatusTone,
  scheduleClock,
  waitsOnSiblings,
} from '@/modules/dispatcher/dispatcherState';
export type { DispatchDeckLayer, DispatcherArcGroup, DispatcherArcSplit } from '@/modules/dispatcher/dispatcherState';
// The v3 plan's card — the run card's composition with a `dispatch v1` pill — for the Runner tab's
// two lists (src/modules/runner-tab), which draw it in the same list as the runs.
export { PlanCard } from '@/modules/dispatcher/PlanCard';
// One dispatch arc as the deck every arc on this screen is drawn as — the runner's own composition
// (`DeckFrame`), the arc's header over a strip of its plans — and the list of them for a caller that
// has the lane's split in hand. Drawn by the Runner tab's two homes, above the plans no arc holds.
export { DispatchArcDeck, DispatchArcDecks } from '@/modules/dispatcher/ArcDeck';
