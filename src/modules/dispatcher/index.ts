// The dispatcher lane's door into the live bus. App mounts it once, inside LiveBusProvider and
// beside every other lane's feed.
export { DispatcherFeed } from '@/modules/dispatcher/DispatcherFeed';
// The lane's read side — every plan the store holds, this box's posture beside them, and which of
// them the operator has hidden or dismissed. The Runner tab reads it for the card list, the `Hidden`
// list and the count and `laneOpen` that badge and gate the tab.
export { useDispatcherPlans } from '@/modules/dispatcher/hooks/useDispatcherPlans';
// Both hands, one hook: the plan card's seven verbs and the arc header's four — stop, resume, schedule
// and the arc's model word — relayed to the dispatcher's own binary and answered with its own
// sentence. `scope` is the whole of what differs: which door a press goes through. A caller presses
// one and re-draws from the next frame; nothing is guessed here. `drop` is the one verb a card
// guards with a dialog, because it is the one no press undoes.
export { useDispatcherVerbs } from '@/modules/dispatcher/hooks/useDispatcherVerbs';
// The pure vocabulary of a plan, so a card never re-derives a tone, a progress count or
// the order the cards sit in — and the lane's own split, so the Runner tab and the chat gutter's
// widget group and order the arcs' plans by ONE rule instead of two.
export {
  byArc,
  byUrgencyThenNewest,
  deckFocusIndex,
  epochOf,
  phaseProgress,
  phaseStatusTone,
  planLayer,
  planStatusTone,
  scheduleClock,
  waitsOnSiblings,
} from '@/modules/dispatcher/dispatcherState';
export type { DispatchDeckLayer, DispatcherArcGroup, DispatcherArcSplit } from '@/modules/dispatcher/dispatcherState';
// The ask readings both homes' orders take: a plan that owes the operator a word comes up in every
// list — the lane's own order and the widget's lift — because an ask is the one state that waits on
// him and will not move until he answers.
export { anyOwesWord, owesWord } from '@/modules/dispatcher/askState';
// The plan's card — head, action bar, glance face, the fold — and the arc's deck: the arc's head over
// its plans, paged one card per view in a strip, in the tab and in the gutter alike. `DispatchArcDecks`
// is the stack of decks, given the split that says which plans go under which arc. Drawn by both homes
// in `src/modules/runner-tab`: the Runner tab and the chat gutter's widget.
export { PlanCard } from '@/modules/dispatcher/PlanCard';
export { DispatchArcDecks } from '@/modules/dispatcher/ArcDeck';
// How full the planner lane is — `planners <out> of <lanes> out` — drawn from the frame's own route by
// the Runner tab's header and the chat gutter's widget, and by neither when the frame states none.
export { PlannerLanesReadout } from '@/modules/dispatcher/PlannerLanesReadout';
// The presses that put a card away, each one write to the put-away store: one plan's corner, an arc
// deck's and `Dismiss done · N`. A done card's is Dismiss and an unfinished card's Hide.
export { doneDismiss, planPutAway } from '@/modules/dispatcher/hiddenPlans';
// Where the keyboard lands once a press has taken its own control away with the card.
export { landFocusInHome } from '@/modules/dispatcher/putAwayFocus';
// The `Hidden · N` list at the foot of both homes: every hidden (unfinished) plan, each with its `Show`.
export { HiddenPlans } from '@/modules/dispatcher/HiddenPlans';
// The pin a plan wears when the open chat is the one that launched it, drawn by both homes.
export { SessionPin } from '@/modules/dispatcher/SessionPin';
// One planner outing as one line — who is out, on what model, for how long — and the row of them for
// the outings no card and no deck can carry. Drawn by the plan card's and the arc deck's own headers
// inside this module, and by the Runner tab's two homes above the arc decks for the rest.
export { LoosePlannerBadges, PlannerBadge } from '@/modules/dispatcher/PlannerBadge';
