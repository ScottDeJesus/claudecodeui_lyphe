import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';
import type { CompanionDraft, CompanionPicture, CompanionSettings } from '@/shared/companion-types.js';
import { AppError } from '@/shared/utils.js';

import { createCompanionAccount, type CompanionAccount } from './companion-account.js';
import { buildPicture } from './companion-picture.js';
import { readCompanionSettings, saveCompanionSettings, type CompanionSettingsPatch } from './companion-settings.js';

/**
 * Kaylee, per account. The service holds one `CompanionAccount` (her store, her live conversation, her activity)
 * for each CloudCLI account that has used her, made on the account's first call and never before: an account that
 * never opens her panel costs nothing, and a made account is still ASLEEP until a message is pushed — creating
 * one launches no process.
 *
 * Every verb here backs one route (`companion.routes.ts`) or one feed, and takes the account's id first, so a
 * call cannot reach another account's rows, pages or conversation. The routes only parse and answer; what a
 * verb means is decided here:
 *   - `sendText` takes the floor for the page that typed, logs his line and pushes it to her;
 *   - `saveSettings` stores the patch, tells every page, and applies a model change to her running process
 *     with her memory kept (`setModel`);
 *   - `clear` wipes her: process, CLI conversation, log, notes, draft, walk and focus. What chats were sent
 *     through her (`relayed_sends`) stays, because those rows belong to the chats;
 *   - `stopAll` winds every conversation down for shutdown and from then on refuses a message with a 503: the
 *     HTTP drain comes after it, and a process woken then would have nothing left to end it;
 *   - `alert` and `runCompleted` are the two seams the house's feeds call (an alert of the notification
 *     orchestrator, a run that ended); the feeds fill them in the phase that starts the feeds.
 *
 * THE RUNTIME is the gateway her tools stop, answer and send through. It is not known when this file loads
 * (the module is built by the entrypoint, which owns it), so `createCompanionModule` attaches it before
 * anything can call a verb; an account made before that would have tools with no gateway, so it is refused.
 *
 * Consumers: `companion.routes.ts` (every verb but the seams), `companion.module.ts` (`attachRuntime`, `stopAll`)
 * and, in the phase that starts them, the alert and focus feeds.
 */

/** The 409 of an edit when no draft is held, with what to do about it. */
const noDraft = (): AppError =>
  new AppError('There is no draft to edit; ask her to draft one first.', { code: 'COMPANION_NO_DRAFT', statusCode: 409 });

/** The 503 of a message that arrives once the server has begun to stop: her process would be launched with nothing left to end it. */
const stopping = (): AppError =>
  new AppError('The server is shutting down, so she cannot take a message just now; send it again once it is back.', { code: 'COMPANION_STOPPING', statusCode: 503 });

function createCompanionService() {
  const accounts = new Map<number, CompanionAccount>();
  let runtime: ProviderRuntimeGateway | null = null;
  // Set by `stopAll`: from then on a message is refused, because `stopAll` has already run and nothing would end the process it woke.
  let stopped = false;

  /** The account's Kaylee, made on first use. */
  function accountOf(userId: number): CompanionAccount {
    const held = accounts.get(userId);
    if (held) return held;
    if (runtime === null) throw new Error('The companion has no runtime gateway: createCompanionModule attaches it before any verb is called.');
    const made = createCompanionAccount(userId, runtime);
    accounts.set(userId, made);
    return made;
  }

  return {
    /** The gateway her tools act through; a module built is a service that takes messages again. Called once by `createCompanionModule`. */
    attachRuntime(gateway: ProviderRuntimeGateway): void {
      runtime = gateway;
      stopped = false;
    },

    /** The whole of her for a page: `GET /api/companion`. */
    picture: (userId: number): Promise<CompanionPicture> => buildPicture(accountOf(userId)),

    /** The page `client` holds the floor from now on: she acts on it, and "open this chat" is sent to it alone. */
    takeFloor(userId: number, client: string): void {
      accountOf(userId).store.setFloor(client);
    },

    /**
     * A line he typed: the typing page takes the floor, the line joins the log, and she is pushed it as
     * `<operator via="typed">`. Refused with a 503 once `stopAll` has run.
     */
    sendText(userId: number, client: string, text: string): void {
      if (stopped) throw stopping();
      const { store, session } = accountOf(userId);
      store.setFloor(client);
      store.appendLog({ role: 'operator', via: 'typed', text });
      session.pushOperator(text, 'typed');
    },

    /**
     * Stores `patch`, tells every page the settings as they now read, and applies a model change to her running
     * process (her memory is kept; a process that is asleep launches on the stored model). A model the CLI
     * refuses to switch to is a system line on the panel, never a failed save: the setting IS saved and the
     * next time she wakes she runs on it.
     */
    async saveSettings(userId: number, patch: CompanionSettingsPatch): Promise<CompanionSettings> {
      const { store, session } = accountOf(userId);
      const before = readCompanionSettings(userId);
      const settings = saveCompanionSettings(userId, patch);
      store.emit({ kind: 'companion_settings', settings });
      if (settings.model !== before.model) {
        try {
          await session.setModel(settings.model);
        } catch (error) {
          console.error(`[Companion] account ${userId}: her running process would not switch to ${settings.model}`, error);
          store.appendLog({ role: 'system', text: `She could not switch to ${settings.model} while awake; she will use it the next time she wakes.` });
        }
      }
      return settings;
    },

    /** Replaces the words of the held draft, keeping its target: the 409 `COMPANION_NO_DRAFT` when none is held. */
    editDraft(userId: number, text: string): CompanionDraft {
      const { store } = accountOf(userId);
      const held = store.readState().draft;
      if (held === null) throw noDraft();
      const stored = store.setDraft({ target: held.target, text });
      if (stored === null) throw new Error('The store answered no draft for a draft it was given');
      return stored;
    },

    clearDraft(userId: number): void {
      accountOf(userId).store.setDraft(null);
    },

    /** Dismisses a note card. A note already gone (the other page dismissed it first) is not an error. */
    dismissNote(userId: number, id: number): void {
      accountOf(userId).store.removeNote(id);
    },

    /** Stops her own turn now. A Stop with no turn running does nothing. */
    interrupt: (userId: number): Promise<void> => accountOf(userId).session.interrupt(),

    /**
     * Wipes her. The session is told first and SYNCHRONOUSLY detaches its process and forgets the CLI conversation
     * (a message that lands while the old process winds down is a wake into a fresh one, never a resume); the rows
     * go straight after, so every page empties at once; and only then is the wind-down awaited, which can take
     * the CLI's whole grace.
     */
    async clear(userId: number): Promise<void> {
      const account = accountOf(userId);
      const windingDown = account.session.clear();
      account.store.clearAccount();
      await windingDown;
    },

    /**
     * The house's notification orchestrator handed `event` for this account. The alert feed fills this seam;
     * until then no event is her business and nothing reaches her.
     */
    alert(userId: string | number, event: unknown): void {
      void userId;
      void event;
    },

    /**
     * A chat's run ended (`aborted` when it was stopped rather than finished). The focus feed fills this seam;
     * until then no run's end is news to her.
     */
    runCompleted(sessionId: string, aborted: boolean): void {
      void sessionId;
      void aborted;
    },

    /**
     * Interrupts each running session and ends its input, for the server's shutdown, and refuses every message
     * after it (the HTTP drain comes later, so one can still arrive). One session that fails to wind down is
     * logged and does not hold the rest.
     */
    async stopAll(): Promise<void> {
      stopped = true;
      await Promise.all(
        [...accounts.values()].map(async ({ userId, session }) => {
          try {
            await session.interrupt();
            await session.close('the server is stopping');
          } catch (error) {
            console.error(`[Companion] account ${userId}: her process did not wind down cleanly`, error);
          }
        }),
      );
    },
  };
}

/** Consumed by `companion.routes.ts` and `companion.module.ts`, and by the feeds, which are handed it by the module. */
export const companionService = createCompanionService();

/** The service's surface, for the routes and feeds that are handed it. Consumed by `companion.routes.ts`. */
export type CompanionService = typeof companionService;
