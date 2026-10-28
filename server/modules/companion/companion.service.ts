import { companionDb } from '@/modules/database/index.js';
import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';
import type { CompanionDraft, CompanionPicture, CompanionSessionRef, CompanionSettings } from '@/shared/companion-types.js';
import { AppError } from '@/shared/utils.js';

import { createCompanionAccount, type CompanionAccount } from './companion-account.js';
import { createPress } from './companion-press.js';
import { createSpeech } from './companion-speech.js';
import type { DraftSendOutcome } from './companion-send.js';
import { buildPicture } from './companion-picture.js';
import { readCompanionSettings, saveCompanionSettings, type CompanionSettingsPatch } from './companion-settings.js';
import type { CompanionAlert } from './feeds/alert-block.js';
import { focusNewsEnvelope, readRunReply } from './feeds/focus-feed.js';

/**
 * Kaylee, per account. The service holds one `CompanionAccount` (her store, her live conversation, her activity)
 * for each CloudCLI account that has used her, made on the account's first call and never before; a made account is
 * still ASLEEP until a message is pushed — creating one launches no process.
 *
 * Every verb here backs one route (`companion.routes.ts`) or one feed, and takes the account's id first, so a call
 * cannot reach another account's rows, pages or conversation. The routes only parse and answer; the verbs decide:
 *   - `sendText` takes the floor for the page that typed, logs his line and pushes it to her;
 *   - `saveSettings` stores the patch, tells every page, and applies a model change to her running process
 *     with her memory kept (`setModel`);
 *   - `press` is a press of the talk button (`companion-press.ts`): the page takes the floor, the clip is heard, and
 *     his words (or the empty press) are logged and pushed in arrival order; a hearing that fails pushes nothing;
 *   - `sendDraft` is the panel's Send: the draft goes to its target (a turn, or folded into the running one) and the
 *     pressing page takes the floor, so the chat opens where he pressed;
 *   - `speech` and `cut` are her voice (`companion-speech.ts`): the audio of one sentence for the floor page, and the
 *     press that stops her while she speaks and owes her next message a `<cut>`;
 *   - `clear` wipes her: process, CLI conversation, log, notes, draft, walk, focus and the turn's audio. What chats
 *     were sent through her (`relayed_sends`) stays, because those rows belong to the chats;
 *   - `stopAll` winds every conversation and every synthesis down for shutdown and from then on refuses a message with a
 *     503: the HTTP drain comes after it, and a process woken then would have nothing left to end it;
 *   - `alert`, `runFailed`, `runCompleted` and `chatDeleted` are the verbs the house's feeds call (each is explained at its verb);
 *     `alert` and the focus push refuse once `stopAll` has run, for the reason a message does.
 *
 * THE RUNTIME is the gateway her tools stop, answer and send through. The module is built by the entrypoint, which owns
 * it, so `createCompanionModule` attaches it before anything can call a verb; an account made before that is refused.
 *
 * Consumers: `companion.routes.ts` (every verb but the feeds'), `companion.module.ts` (`attachRuntime`, `stopAll`)
 * and the alert, focus and deleted-chat feeds (`alert`, `runFailed`, `runCompleted`, `chatDeleted`).
 */

/**
 * How long a chat's failed-run mark stands. The runtime raises the failure and sends the run's `complete` in the same
 * handler, milliseconds apart; the bound only keeps a mark whose `complete` never came from silencing that chat's NEXT finished run.
 */
const FAILED_RUN_MARK_MS = 30_000;

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
  // Chat id → when the alert feed heard its run fail; read and cleared by `runCompleted`, so a failed run is not also told as finished.
  const failedRuns = new Map<string, number>();
  const press = createPress({ accountOf, refuseWhileStopping: () => { if (stopped) throw stopping(); } });
  const speech = createSpeech({ accountOf });

  /** Builds the news of a finished focus chat and pushes it to her; a failure is this account's alone, and a server that began to stop meanwhile wakes nothing. */
  async function deliverFocusNews(userId: number, focus: CompanionSessionRef, reply: string): Promise<void> {
    try {
      const envelope = await focusNewsEnvelope(userId, focus, reply);
      // A digest can take a dactyl's whole bound: he may have switched Live off, or the server begun to stop, meanwhile.
      if (stopped || !readCompanionSettings(userId).live) return;
      accountOf(userId).session.pushFocusNews(envelope);
    } catch (error) {
      console.error(`[Companion] account ${userId}: the news of "${focus.name}" finishing did not reach her`, error);
    }
  }

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

    /** A press of the talk button: the page `client` takes the floor, the clip is heard, and what he said (`''` for the empty press) is answered once it has been pushed. */
    press,

    /** One sentence of her current turn as streamed PCM for the floor page; an `AppError` refusal comes before the first byte (`companion-speech.ts`). */
    speech: speech.speak,
    /** The press while she speaks: stops the turn's syntheses and her turn, and owes her next message a `<cut>` (`companion-speech.ts`). */
    cut: speech.cut,

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

    /**
     * The panel's Send: the held draft goes to its target as `mode` asks (see `companion-send.ts` for what a send is). The
     * pressing page takes the floor, because the chat opens on the page that holds it. `text`, when a caller gives it, must
     * equal the draft's. Answers the outcome and the sentence that says it; `refused` carries the reason.
     */
    async sendDraft(userId: number, client: string, mode: 'turn' | 'steer', text?: string): Promise<DraftSendOutcome> {
      if (stopped) throw stopping();
      const account = accountOf(userId);
      account.store.setFloor(client);
      return account.sendDraft({ mode, text });
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
      account.speechCache.end();
      const windingDown = account.session.clear();
      account.store.clearAccount();
      await windingDown;
    },

    /**
     * The alert feed's first survivor of a gather window: her process is started now, with nothing pushed, so it is
     * up when the window closes. Without this a message that wakes her costs the CLI's start (about a second) on top
     * of the window's three seconds. Refused silently once the server is stopping.
     */
    warm(userId: number): void {
      if (stopped) return;
      accountOf(userId).session.warm();
    },

    /**
     * Alerts for this account that the alert feed let through: each is logged as an `alert` row on her panel
     * (so the panel shows what the house said), then all are pushed to her as ONE message. Nothing is checked
     * here — Live, the page and the repeat were judged by the feed. Refused silently once the server is stopping.
     */
    alert(userId: number, alerts: CompanionAlert[]): void {
      if (stopped || alerts.length === 0) return;
      const { store, session } = accountOf(userId);
      for (const { line } of alerts) {
        // The panel's row is a record of the alert; a row that cannot be written must not cost her the alert itself.
        try {
          store.appendLog({ role: 'alert', text: line });
        } catch (error) {
          console.error(`[Companion] account ${userId}: an alert row could not be written to her panel`, error);
        }
      }
      session.pushAlerts(alerts.map(({ envelope }) => envelope));
    },

    /**
     * The alert feed heard a failure code (`run.failed`, `run.limit`, `api.error`, `login.expired`) for this chat:
     * its run is failing, and the `runCompleted` that follows within milliseconds is not a finish. Marked whatever
     * the alert's own gates decide (Live, the page, the repeat): a failure he was not told of is still not news
     * of a finished run.
     */
    runFailed(sessionId: string): void {
      const now = Date.now();
      for (const [marked, at] of failedRuns) {
        if (now - at > FAILED_RUN_MARK_MS) failedRuns.delete(marked);
      }
      failedRuns.set(sessionId, now);
    },

    /**
     * A chat's run ended (`aborted` when it was stopped rather than finished). It is news to each live account
     * whose focus the chat is: the run's reply becomes a `<session event="finished">` and is pushed to her. An
     * aborted run was a stop, a failed run (marked by `runFailed`, or with an `error` row) is already a `failed`
     * alert, and a run that said nothing in words has nothing to report. Returns at once: the reply is read before
     * anything is awaited (the next run of the chat may replace the buffer), and a long one is digested by a dactyl
     * in the background.
     */
    runCompleted(sessionId: string, aborted: boolean): void {
      // The mark is taken whatever else decides: an aborted run's must not outlive it to silence the next.
      const failedAt = failedRuns.get(sessionId);
      failedRuns.delete(sessionId);
      const failed = failedAt !== undefined && Date.now() - failedAt <= FAILED_RUN_MARK_MS;
      if (aborted || failed || stopped) return;
      const audience: Array<{ userId: number; focus: CompanionSessionRef }> = [];
      try {
        for (const userId of companionDb.userIdsFocusedOn(sessionId)) {
          const focus = accountOf(userId).store.readState().focus;
          if (focus !== null && readCompanionSettings(userId).live) audience.push({ userId, focus });
        }
      } catch (error) {
        console.error(`[Companion] could not find who is focused on session ${sessionId}`, error);
        return;
      }
      if (audience.length === 0) return;

      const reply = readRunReply(sessionId);
      if (reply === null) return;
      for (const { userId, focus } of audience) void deliverFocusNews(userId, focus, reply);
    },

    /**
     * A chat row was deleted: every account whose focus is that chat drops the focus, and its pages hear `companion_focus` null.
     * Found from the stored rows (`userIdsFocusedOn`), so an account whose Kaylee has not been touched since the server
     * booted is found too. One account that fails is logged and does not hold the rest. Her draft's target and her walkthrough
     * are left as they are: a deleted chat there is told to her when she is next asked to send to it, or ended by her `walk` 0.
     */
    chatDeleted(sessionId: string): void {
      let audience: number[];
      try {
        audience = companionDb.userIdsFocusedOn(sessionId);
      } catch (error) {
        console.error(`[Companion] could not find who is focused on the deleted session ${sessionId}`, error);
        return;
      }
      for (const userId of audience) {
        try {
          accountOf(userId).store.setFocus(null);
        } catch (error) {
          console.error(`[Companion] account ${userId}: her focus on the deleted session ${sessionId} was not dropped`, error);
        }
      }
    },

    /**
     * Winds down each running session for the server's shutdown, and refuses every message after it (the HTTP
     * drain comes later, so one can still arrive). A session's interrupt and its close run TOGETHER: the interrupt
     * stops a turn in flight and the close ends the input and, past its grace, the process, so a CLI that answers
     * neither costs one grace (5 s) and not two. One session that fails to wind down is logged and does not hold the rest.
     */
    async stopAll(): Promise<void> {
      stopped = true;
      await Promise.all(
        [...accounts.values()].map(async ({ userId, session, speechCache }) => {
          // A sentence streaming to a page would hold the HTTP drain open for as long as Gemini kept speaking.
          speechCache.end();
          try {
            await Promise.all([session.interrupt(), session.close('the server is stopping')]);
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
