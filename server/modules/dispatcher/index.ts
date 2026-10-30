// createDispatcherModule: used by the server entrypoint to mount the authenticated dispatcher lane
// at `/api/dispatcher` — the poll behind the `dispatcher_state` frame (every plan this host holds),
// the relay for the dispatcher's own stop/resume/park/unpark/schedule, its next off-peak moment, the
// notification each plan or epic ending earns, and the prompt a plan owes the operator, raised on the plan's
// card in the Roadmap tab's In flight face and in the Runs widget and answered back through the dispatcher's own doors.
export { createDispatcherModule } from './dispatcher.module.js';
// DispatcherPicture: used by the companion's house (`server/modules/companion/house.ts`), which names the
// lane's picture as the type of `CompanionHouse.dispatcher()`; the instance that answers it is `createDispatcherModule().picture`.
export type { DispatcherPicture } from './dispatcher-state.service.js';
// DispatcherCardText: used by the companion's house (`house.ts`, as `HouseText`) for what `createDispatcherModule().cardText`
// answers — a card's design text whole, or the dispatcher's own first line.
export type { DispatcherCardText } from './dispatcher-card-text.service.js';
