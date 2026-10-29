import type { DispatcherCardText, DispatcherPicture } from '@/modules/dispatcher/index.js';
import type { HealService } from '@/modules/heal/index.js';
import type { CerberusOverview } from '@/shared/cerberus-types.js';
import type { RoadmapPicture } from '@/shared/roadmap-types.js';
import type { RelayAnswer, RelayOrder, ResumeRunOrder } from '@/shared/relayed-press-types.js';
import type { SoulLaunchSnapshot } from '@/shared/types.js';

/**
 * The house, handed in: the readers only a MODULE INSTANCE holds, which Kaylee's tools read the panels through.
 *
 * The operator's ruling is that her reads go through the same server-side readers the panels use. The roadmap lane and
 * the dispatcher lane each hold a validated picture behind `whenLanded`, refreshed every two seconds; the souls lane holds
 * its launches; Cerberus builds its overview from its own inputs; the heal lane holds the one service that runs the
 * worker. None of those handles is reachable from a barrel — each exists only on the instance `server/index.ts` built —
 * so the entrypoint, the composition root, builds the house from those instances AFTER them (Kaylee is mounted after the
 * dispatch-souls lane for that reason) and hands it to `createCompanionModule({ runtime, house })`. From there it
 * travels one argument at a time: `companionService.attachRuntime(gateway, house)`, `createCompanionAccount(userId,
 * runtime, house)`, `createToolDeps({ …, house })`, and every tool file reads it as `CompanionToolDeps.house`.
 *
 * A read through the house is one of her `thinking` moments, never an activity of its own: nothing here moves her state.
 *
 * Consumers: `server/index.ts` (builds it), `companion.module.ts`, `companion.service.ts`, `companion-account.ts` and
 * `tools/tool-deps.ts` (carry it), and the tool files that read through it — the eyes (`eyes/*.ts`: `roadmap`,
 * `dispatcher`, `cardText`, `launches`, `cerberus`, `heal`) and the hands, which fire through the two doors `relay` and
 * `resumeRun` (`hands/action-doors.ts`).
 */

/**
 * What a card's design text read answers: the text whole, or the dispatcher's own sentence for why there is none (a name
 * it does not hold answers its own not-found line). The same shape as the dispatcher lane's `cardText`, named here as the
 * house's word for it. Consumed by `CompanionHouse.cardText` and the eyes' `read_card`.
 */
export type HouseText = DispatcherCardText;

/**
 * The readers only a module instance holds. Each is the lane's own handle, so a read here and the panel's agree:
 *   - `roadmap()` — the roadmap lane's picture (`whenLanded`, bounded), or `null` while this boot's first reading has not landed;
 *   - `dispatcher()` — the dispatcher lane's picture, bounded the same way, the same `null`;
 *   - `cardText(name)` — `dispatcher show <name>`, run with the dispatcher lane's own child environment;
 *   - `launches()` — the dispatch-souls lane's picture: the souls and chains a chat launched, answered at once (the lane's reading is synchronous, so `null` is the shared lane's type and never a case it meets);
 *   - `cerberus()` — the Cerberus tab's overview, built from the module's own inputs on each call;
 *   - `heal` — the heal lane's service, narrowed to the two reads she makes (`summary`, `kind`); it runs the worker
 *     `HEAL_REFLEX_BIN` names, so the worker's binary keeps its one rule;
 *   - `relay(order)` — the dispatcher lane's door for one act of hers on his spoken word: the answers to an open prompt go through
 *     the ask book (which answers its own record of the pinned ask) and every other verb is the dispatcher's own, each carrying
 *     kaylee--press's record of his word (`relayed-press-types.ts`). Never throws: a refusal is a `RelayAnswer`;
 *   - `resumeRun(order)` — the dispatch-souls lane's door for a chain resumed with his rulings (`plan-runner chain --resume`),
 *     answered the same way.
 *
 * Consumed by `createCompanionModule` (which receives it from the entrypoint) and, as `CompanionToolDeps.house`, by every
 * tool file that reads a panel.
 */
export type CompanionHouse = {
  roadmap(): Promise<RoadmapPicture | null>;
  dispatcher(): Promise<DispatcherPicture | null>;
  cardText(name: string): Promise<HouseText>;
  launches(): Promise<SoulLaunchSnapshot[] | null>;
  cerberus(): CerberusOverview;
  heal: Pick<HealService, 'summary' | 'kind'>;
  relay(order: RelayOrder): Promise<RelayAnswer>;
  resumeRun(order: ResumeRunOrder): Promise<RelayAnswer>;
};
