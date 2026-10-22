// The dispatcher lane's door into the live bus. App mounts it once, inside LiveBusProvider and
// beside every other lane's feed.
export { DispatcherFeed } from '@/modules/dispatcher/DispatcherFeed';
// The lane's read side — every plan the store holds, this box's posture beside them, and which of
// them the operator has hidden or dismissed. The In flight face reads it for the card list and the
// `Hidden` list; the tab strip and the Roadmap tab's In flight switch read the `count` and `waiting`
// that mark them.
export { useDispatcherPlans } from '@/modules/dispatcher/hooks/useDispatcherPlans';
// Both hands, one hook: the plan card's verbs and the arc header's three — stop, resume,
// the arc's model word — relayed to the dispatcher's own binary and answered with its own
// sentence. `scope` is the whole of what differs: which door a press goes through. A caller presses
// one and re-draws from the next frame; nothing is guessed here. `drop` is the one verb a card
// guards with a dialog, because it is the one no press undoes.
export { useDispatcherVerbs } from '@/modules/dispatcher/hooks/useDispatcherVerbs';
// The board's one queue press, which names no epic of its own: an epic moved `--before` another or `--last` in
// the dispatcher's queue. Both lists that draw the queue's decks (In flight's, the gutter's column) press
// through it, because a drop carries whichever epic was dragged and a hook cannot be called per card.
export { useEpicQueueVerbs } from '@/modules/dispatcher/hooks/useEpicQueueVerbs';
// The pure vocabulary of a plan, so a card never re-derives a tone or a progress count — and the
// lane's own split, so the Roadmap tab's In flight face and the chat gutter's widget group the arcs'
// plans and order every card by ONE rule instead of two.
export {
  byArc,
  deckFocusIndex,
  epochOf,
  phaseProgress,
  phaseStatusTone,
  planLayer,
  planStatusTone,
  scheduleClock,
  waitsOnSiblings,
} from '@/modules/dispatcher/dispatcherState';
// The operator's arrangement of the lane's cards, the one thing that orders them: the saved ranks
// both homes feed `byArc`, and the write a drop makes — one entry for the moved card, in the
// `dispatcher` preference's `cardOrder`.
export { moveCard, useCardRanks } from '@/modules/dispatcher/cardOrderEntries';
// The plan's card — head, action bar, glance face, the fold — and the arc's deck: the arc's head over
// its plans, paged one card per view in a strip, in the tab and in the gutter alike. `DispatchArcDecks`
// is the stack of decks, given the split that says which plans go under which arc. Drawn by both homes
// in `src/modules/runner-tab`: the Roadmap tab's In flight face and the chat gutter's widget.
export { PlanCard } from '@/modules/dispatcher/PlanCard';
export { DispatchArcDecks } from '@/modules/dispatcher/ArcDeck';
// How full the planner lane is — `planners <out> of <lanes> out` — drawn from the frame's own route by
// the header of the Roadmap tab's In flight face and the chat gutter's widget, and by neither when the
// frame states none.
export { PlannerLanesReadout } from '@/modules/dispatcher/PlannerLanesReadout';
// The master controller — the Claude · DeepSeek house switch, the board's one Start and Pause all
// — drawn from the frame's own route by the header of the Roadmap tab's In flight face and at the
// top of the chat gutter's Runs widget (one component, two mounts), and not at all when the frame states no census.
export { MasterController } from '@/modules/dispatcher/MasterController';
// The presses that put a card away: one plan's corner and an arc deck's (`usePutAway`), and `Dismiss done · N`.
// A done card's is Dismiss, an entry in the operator's own list; an unfinished card's is Hide, the dispatcher's.
export { doneDismiss } from '@/modules/dispatcher/hiddenPlans';
export { usePutAway } from '@/modules/dispatcher/hooks/usePutAway';
// Where the keyboard lands once a press has taken its own control away with the card.
export { landFocusInHome } from '@/modules/dispatcher/putAwayFocus';
// The `Hidden · N` list at the foot of both homes: every plan the dispatcher holds hidden, each with its `Show`.
export { HiddenPlans } from '@/modules/dispatcher/HiddenPlans';
// The pin a plan wears when the open chat is the one that launched it, drawn by both homes.
export { SessionPin } from '@/modules/dispatcher/SessionPin';
// One planner outing as one line — who is out, on what model, for how long — and the row of them for
// the outings no card and no deck can carry. Drawn by the plan card's and the arc deck's own headers
// inside this module, and by the In flight face and the chat gutter's widget above the arc decks for the rest.
export { LoosePlannerBadges, PlannerBadge } from '@/modules/dispatcher/PlannerBadge';
// The dispatcher's sentence in the operator's words — arc, plan and phase said as epic, feature and
// task. Read by the verbs' toasts and the plan card's captions inside this module, and by the roadmap
// module's writes (`useRoadmapWrites`), whose refusal toast shows the dispatcher's first line through it.
export { operatorWords } from '@/modules/dispatcher/operatorWords';
