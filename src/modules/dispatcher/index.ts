// The dispatcher lane's door into the live bus. App mounts it once, inside LiveBusProvider and
// beside every other lane's feed.
export { DispatcherFeed } from '@/modules/dispatcher/DispatcherFeed';
// The lane's read side — every plan the store holds, this box's posture beside them, and which
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
// The plan's card — phases, verbs, the fold — and the arc's deck drawn as the screen draws it: the
// arc's header over a strip of its plans. `DispatchArcDecks` is the strip of decks, given the split
// that says which plans go under which arc. Drawn by both of the Runner tab's homes
// (`src/modules/runner-tab`) and by the chat gutter's widget.
export { PlanCard } from '@/modules/dispatcher/PlanCard';
export { DispatchArcDeck, DispatchArcDecks } from '@/modules/dispatcher/ArcDeck';
// The pin a plan wears when the open chat is the one that launched it, drawn by both homes.
export { SessionPin } from '@/modules/dispatcher/SessionPin';
// One planner outing as one line — who is out, on what model, for how long — and the row of them for
// the outings no card and no deck can carry. Drawn by the plan card's and the arc deck's own headers
// inside this module, and by the Runner tab's two homes above the arc decks for the rest.
export { LoosePlannerBadges, PlannerBadge } from '@/modules/dispatcher/PlannerBadge';
