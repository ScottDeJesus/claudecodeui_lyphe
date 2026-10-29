import { followupsDb, type FollowupRow } from '@/modules/database/index.js';
import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type {
  Followup,
  FollowupCompletionArc,
  FollowupCompletionPlan,
  FollowupInput,
  FollowupsChangedEvent,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

import {
  closuresForArc,
  closuresForPlan,
  epicFinishedAt,
  type CompletionClosure,
} from './followups-completion-rule.service.js';

/**
 * The followups lane's verbs: one chat's next steps and known gaps, filed and closed by the chat's own
 * command, ticked and unticked by the person at the widget.
 *
 * WHERE THE JUDGING LIVES. The routes decide transport SHAPE (a list of `{ kind, text }`, a list of ids).
 * Everything below decides whether the content is USABLE: whether a line is one plain line of 1-240
 * characters, whether an id belongs to THIS chat. A line is REFUSED, never repaired — a chat that sent a
 * paragraph is told so in a sentence it reads, rather than having its words silently joined or cut.
 *
 * A BATCH LANDS WHOLE OR NOT AT ALL. Every line is judged before the first row is written, and a refusal
 * names the line and says nothing was filed, so the chat can fix that one line and send the call again
 * without double-filing the rest.
 *
 * THE SAME LINE IS NOT FILED TWICE. A line identical to one of the chat's still-OPEN items (same kind, same
 * text) answers that item's id and writes nothing — a retried call after a timeout, or a chat that forgot it
 * filed the line two turns ago, must not grow the list.
 *
 * THE HOUSE CLOSES ITEMS TOO. When the feature, task or epic an open item names finishes, `closeForCompletions` settles it —
 * for every chat and every account at once — and marks it `closedBy: 'completion'` with `closedFor` naming what
 * finished. The rule is `followups-completion-rule.service.ts`; the dispatcher's watcher is the caller.
 *
 * THE FRAME NAMES THE CHAT. Every write that changed a row sends one `followups_changed` to every open
 * socket, carrying the chat's app session id; a widget of another chat ignores it, and a client that is not
 * the owner only learns that some chat moved. Nothing else rides the frame.
 *
 * Consumers: `followups.routes.ts` (the widget's door) and `followups.command-routes.ts` (the `followups`
 * command's), handed this object — so the two doors refuse alike and both send the frame. The companion
 * module reads through `listOpenForAccount`, by way of the barrel's `listOpenFollowups`; the dispatcher
 * module's watcher calls `closeForCompletions`, by way of the barrel's `closeFollowupsForCompletions`.
 */

/** A line's ceiling, in characters after trimming — the number the refusal sentence quotes back to the chat. */
const TEXT_MAX = 240;

/** The most lines one `add` may carry: a turn files its handful at once, and a call of more is a runaway. */
const BATCH_MAX = 20;

/** The characters that DRAW AS NOTHING (whitespace, format and control characters): a line made only of them says nothing. */
const DRAWS_AS_NOTHING = /[\s\p{Cf}\p{Cc}]/gu;

/** Control characters (NUL, ESC, tab, vertical tab, form feed ...): not part of one plain line, and `followups list` would print them into the chat's tool result as they are. */
const CONTROL_CHARACTER = /\p{Cc}/u;

/** Every way a line can break, including the Unicode separators `\s` also takes. */
const LINE_BREAK = /[\r\n\u0085\u2028\u2029]/;

/** How many open items the account's read answers when the caller names no number, and the most it ever will. */
const OPEN_LIST_DEFAULT = 20;
const OPEN_LIST_MAX = 200;

/** One `followups` row as the wire carries it: camelCase, and the chat and account it belongs to stay here. */
function toFollowup(row: FollowupRow): Followup {
  return {
    id: row.id,
    kind: row.kind,
    text: row.text,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    doneAt: row.done_at,
    closedBy: row.closed_for !== null ? 'completion' : row.closed_by,
    closedFor: row.closed_for,
  };
}

/**
 * Writes each closure and appends the rows it moved to `into` — only those still open when the write ran
 * (`closeForCompletion`). Appended closure by closure, so a write that throws leaves the rows of the closures before it
 * in `into` for the caller to announce.
 */
function writeClosures(closures: CompletionClosure[], into: FollowupRow[]): void {
  for (const closure of closures) {
    into.push(...followupsDb.closeForCompletion(closure.ids, closure.doneAt, closure.closedFor));
  }
}

/** A refused line: 422 with the sentence that says why, so the chat can word the line again. */
function refusedLine(sentence: string): AppError {
  return new AppError(sentence, { code: 'FOLLOWUP_TEXT_REFUSED', statusCode: 422 });
}

/** The line as stored, or the 422 that says which rule it broke. `where` names the line in a batch ("" for a lone one). */
function judgeLine(raw: string, where: string): string {
  const text = raw.trim();
  if (text.replace(DRAWS_AS_NOTHING, '') === '') {
    throw refusedLine(`${where}A line cannot be empty.`);
  }
  if (LINE_BREAK.test(text)) {
    throw refusedLine(`${where}A line must be one line, with no line breaks in it.`);
  }
  if (CONTROL_CHARACTER.test(text)) {
    throw refusedLine(`${where}A line must be plain text, with no control characters in it.`);
  }
  if (text.length > TEXT_MAX) {
    throw refusedLine(`${where}A line can be ${TEXT_MAX} characters at most; this one is ${text.length}.`);
  }
  return text;
}

/** The inputs, every line judged — or the refusal, before anything is written. */
function judgeBatch(inputs: FollowupInput[]): FollowupInput[] {
  if (inputs.length === 0) {
    throw new AppError('Nothing to file: give at least one --next or --gap line.', {
      code: 'FOLLOWUP_NOTHING_TO_FILE',
      statusCode: 400,
    });
  }
  if (inputs.length > BATCH_MAX) {
    throw new AppError(`One call can file ${BATCH_MAX} lines at most; this one has ${inputs.length}.`, {
      code: 'FOLLOWUP_BATCH_TOO_LARGE',
      statusCode: 422,
    });
  }
  return inputs.map((input, index) => {
    const where = inputs.length === 1 ? '' : `Line ${index + 1} of ${inputs.length} was refused, and nothing from this call was filed: `;
    return { kind: input.kind, text: judgeLine(input.text, where) };
  });
}

/** What makes two lines the same line: the kind and the stored text. */
function lineKey(kind: string, text: string): string {
  return `${kind}\u0000${text}`;
}

/**
 * The chat's refusal for ids that no item of THIS chat carries. A call of several ids is refused whole, and the
 * sentence says so, so a chat that named a valid id beside an unknown one does not take the valid one for closed.
 */
function notFoundInChat(missing: number[], called: number): AppError {
  const named = missing.map((id) => `#${id}`).join(', ');
  const subject = missing.length === 1 ? `No item ${named}` : `No items ${named}`;
  const outcome = called > 1 ? ', so nothing from this call was closed' : '';
  return new AppError(`${subject} in this chat${outcome}. Run "followups" to list the ids that are open here.`, {
    code: 'FOLLOWUP_NOT_FOUND',
    statusCode: 404,
  });
}

/** The widget's refusal for an item that is gone (its chat deleted under it) or is another account's: said to a person, so no command in it. */
function itemGone(): AppError {
  return new AppError('That item is no longer there.', { code: 'FOLLOWUP_NOT_FOUND', statusCode: 404 });
}

/**
 * Puts one `followups_changed` frame on every open gateway socket.
 *
 * Its callers are the writes below, each AFTER its write landed — a write that refused never told a client
 * it happened. The fan-out copies `notes.service.ts`: stringify once, skip a client whose `readyState` is
 * not open, catch PER CLIENT so one dead socket does not cost the rest their frame.
 */
function broadcastFollowupsChanged(appSessionId: string): void {
  const message = JSON.stringify({ kind: 'followups_changed', appSessionId, at: Date.now() } satisfies FollowupsChangedEvent);

  connectedClients.forEach((client) => {
    if (client.readyState !== WS_OPEN_STATE) return;

    try {
      client.send(message);
    } catch (error) {
      console.error(
        `[Followups] could not send a followups_changed frame to a client: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}

/** The followups lane's verbs, as one instance. Both route files are handed this and call it verbatim. */
export const followupsService = {
  /** The chat's items, oldest first: the open ones, or all of them with `all`. The chat command's read. */
  listForChat(appSessionId: string, options: { all: boolean }): Followup[] {
    return followupsDb
      .listForChat(appSessionId)
      .filter((row) => options.all || row.state === 'open')
      .map(toFollowup);
  },

  /** Every item of one chat that this account owns, open and done, oldest first. The widget's read. */
  listForUser(userId: number, appSessionId: string): Followup[] {
    return followupsDb.listForChatOfUser(appSessionId, userId).map(toFollowup);
  },

  /**
   * The account's open items, newest first, each beside the app session id of the chat that filed it: one
   * chat's when `appSessionId` names it, every chat's when it is `null`. The companion's read — the same
   * `toFollowup` the widget's read uses, so a line reads here exactly as the Next steps widget shows it.
   *
   * `limit` is held to 1-200 (a non-number is the default 20): the answer lands in a model's context, so it is
   * a handful, never a table. A chat the account does not own answers none, as the widget's read does.
   */
  listOpenForAccount(userId: number, appSessionId: string | null, limit = OPEN_LIST_DEFAULT): Array<{ sessionId: string; followup: Followup }> {
    const bounded = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), OPEN_LIST_MAX) : OPEN_LIST_DEFAULT;
    const rows =
      appSessionId === null
        ? followupsDb.listOpenOfUser(userId, bounded)
        : followupsDb
            .listForChatOfUser(appSessionId, userId)
            .filter((row) => row.state === 'open')
            .reverse()
            .slice(0, bounded);

    return rows.map((row) => ({ sessionId: row.session_id, followup: toFollowup(row) }));
  },

  /**
   * Files a batch of lines for the chat and answers each line's item in the order given — a line the chat
   * already has open answers the existing item. Whole or nothing: the first refused line throws before a row is written.
   */
  add(appSessionId: string, userId: number, inputs: FollowupInput[]): Followup[] {
    const lines = judgeBatch(inputs);

    const open = new Map(
      followupsDb
        .listForChat(appSessionId)
        .filter((row) => row.state === 'open')
        .map((row) => [lineKey(row.kind, row.text), row] as const),
    );
    const fresh = new Map<string, FollowupInput>();
    for (const line of lines) {
      const key = lineKey(line.kind, line.text);
      if (!open.has(key) && !fresh.has(key)) fresh.set(key, line);
    }

    const inserted = fresh.size === 0 ? [] : followupsDb.addMany({ sessionId: appSessionId, userId, items: [...fresh.values()] });
    for (const row of inserted) open.set(lineKey(row.kind, row.text), row);
    if (inserted.length > 0) broadcastFollowupsChanged(appSessionId);

    return lines.map((line) => toFollowup(open.get(lineKey(line.kind, line.text)) as FollowupRow));
  },

  /**
   * Settles the named items on the chat's say-so and answers them as stored. Every id is checked against THIS
   * chat before any is closed, so one id of another chat refuses the whole call with a 404. An item already done
   * is answered as it stands.
   */
  closeInChat(appSessionId: string, ids: number[]): Followup[] {
    const missing = ids.filter((id) => followupsDb.getInChat(appSessionId, id) === null);
    if (missing.length > 0) throw notFoundInChat(missing, ids.length);

    const rows = followupsDb.closeInChat(appSessionId, ids);
    broadcastFollowupsChanged(appSessionId);
    return rows.map(toFollowup);
  },

  /**
   * Settles every open item, of any chat and any account, whose feature, task or epic has finished, and answers the items
   * it closed beside the chat each belongs to. `plans` and `arcs` are the dispatcher's picture (`DispatcherPlan[]` and
   * `DispatcherArc[]` are assignable); the rules are `closuresForPlan` and `closuresForArc`. The plans run FIRST and
   * their closures are written before an epic's candidates are read, so a feature or task claims an item before an epic
   * can: one item, one `closed_for`. Idempotent — an item already settled is not open and is never read again — so it is
   * safe to run on every picture, including the first after a boot (which catches what finished while the server was
   * down for as long as the picture still carries it). Sends ONE `followups_changed` per chat that moved, after the
   * writes landed — and still when a later write throws, for the rows already closed — and logs one line per item closed.
   */
  closeForCompletions(
    plans: FollowupCompletionPlan[],
    arcs: FollowupCompletionArc[],
  ): Array<{ sessionId: string; followup: Followup }> {
    const closedRows: FollowupRow[] = [];

    try {
      for (const plan of plans) {
        // A plan with nothing finished closes nothing, so it costs no query.
        const hasFinished = plan.completed_at !== null || plan.phases.some((phase) => phase.status === 'done');
        if (!hasFinished) continue;

        const candidates = followupsDb.listOpenNaming(plan.name);
        if (candidates.length === 0) continue;

        writeClosures(closuresForPlan(plan, candidates), closedRows);
      }

      for (const arc of arcs) {
        // Likewise an epic that has not finished costs no query.
        const finishedAt = epicFinishedAt(arc, plans);
        if (finishedAt === null) continue;

        const candidates = followupsDb.listOpenNaming(arc.name);
        if (candidates.length === 0) continue;

        writeClosures(closuresForArc(arc, finishedAt, candidates), closedRows);
      }
    } finally {
      // A fault part-way (a locked database, say) must not leave the rows already closed unannounced: the widget
      // refreshes only on a frame, and the next picture will not repeat a closure that is already written.
      for (const row of closedRows) console.log(`[Followups] closed #${row.id} for ${row.closed_for}`);
      for (const appSessionId of new Set(closedRows.map((row) => row.session_id))) broadcastFollowupsChanged(appSessionId);
    }

    return closedRows.map((row) => ({ sessionId: row.session_id, followup: toFollowup(row) }));
  },

  /** Ticks (`done`) or unticks (`open`) one of the account's items for the person at the widget and answers it as stored. */
  setStateForUser(userId: number, id: number, state: 'open' | 'done'): Followup {
    const row = followupsDb.setStateForUser(userId, id, state);
    if (row === null) throw itemGone();

    broadcastFollowupsChanged(row.session_id);
    return toFollowup(row);
  },
};

/**
 * The service's own type, taken off the instance rather than written out again: the routes take this, so a
 * verb whose signature drifts fails the typecheck at the route that calls it.
 */
export type FollowupsService = typeof followupsService;
