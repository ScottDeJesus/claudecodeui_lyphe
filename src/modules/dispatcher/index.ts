// The dispatcher lane's door into the live bus. App mounts it once, inside LiveBusProvider and
// directly inside RunnerFeed, beside every other lane's feed.
export { DispatcherFeed } from '@/modules/dispatcher/DispatcherFeed';
// The lane's read side — every v3 plan the store holds, this box's posture beside them, and which
// complete plans the operator has already dismissed. The Runner tab reads it for the card list and
// for the count that gates the tab.
export { useDispatcherPlans } from '@/modules/dispatcher/hooks/useDispatcherPlans';
// The card's hand: the six verbs, relayed to the dispatcher's own binary and answered with its own
// sentence. A card calls one of these and re-draws from the next frame; nothing is guessed here.
export { useDispatcherVerbs } from '@/modules/dispatcher/hooks/useDispatcherVerbs';
// The arc's hand: the one verb that names an arc — its DeepSeek / Claude word, which the dispatcher
// hands to every plan of the arc. A separate hook from the card's because an arc has no verbs of its
// own beyond this one, exactly as the runner lane keeps `useArcModel` apart from `useRunnerVerbs`.
export { useDispatcherArcModel } from '@/modules/dispatcher/hooks/useDispatcherArcModel';
// The pure vocabulary of a plan, so a card never re-derives a tone, a glyph, a progress count or
// the order the cards sit in.
export {
  byUrgencyThenNewest,
  epochOf,
  PHASE_GLYPH,
  phaseProgress,
  phaseStatusTone,
  planStatusTone,
  scheduleClock,
} from '@/modules/dispatcher/dispatcherState';
// The v3 plan's card — the run card's composition with a `dispatch v1` pill — for the Runner tab's
// two lists (src/modules/runner-tab), which draw it in the same list as the runs.
export { PlanCard } from '@/modules/dispatcher/PlanCard';
// One dispatch arc as a header over the plans it speaks for, and the list of them for a caller that
// has the lane's arcs in hand. Drawn by the Runner tab's two homes, above their plan cards.
export { DispatchArcHeader, DispatchArcHeaders } from '@/modules/dispatcher/ArcHeader';
