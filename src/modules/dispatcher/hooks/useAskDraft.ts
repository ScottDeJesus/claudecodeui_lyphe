import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { readAskDraft, saveAskDraft, useStoredAskDraft } from '@/modules/dispatcher/askDrafts';
import type { AskDraftCodec } from '@/modules/dispatcher/askDrafts';
import { hasHydratedUserPreferences } from '@/shared/userSettings';
import type { AskDraft } from '@/shared/types';

/**
 * How long after the last edit the draft is written to the preference store. The same beat as the
 * store's own server write (`userSettings.ts`), so a burst of keystrokes is one entry, not one a key.
 */
const DRAFT_SAVE_DEBOUNCE_MS = 400;

/** A draft as a comparable string, so "what I last wrote or adopted" is one cheap fact. */
const wireOf = (draft: AskDraft | null): string => JSON.stringify(draft);

/** Whether the caret is in a text field inside `scope`: the one thing another copy's write must never move. */
function holdsCaret(scope: HTMLElement | null): boolean {
  const active = document.activeElement;
  return scope !== null
    && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)
    && scope.contains(active);
}

/**
 * A FORM'S STATE THAT SURVIVES THE FORM: the state `RoundAnswer` and `LockAnswer` compose an answer in,
 * kept as a draft in the `dispatcher` preference (`askDrafts.ts`) so a reload, the other surface or an
 * unmounted widget gives it back exactly. Returns the form's `state`, `edit` to change it, `clear` for a
 * taken answer, and `scopeRef` for the element the form's fields live in.
 *
 * THE FORM'S OWN COPY IS THE ONE IT TYPES INTO. `state` is plain component state, so the caret and the
 * keystrokes never wait on a store and the field never re-renders under the hand that is typing. The
 * draft is the copy kept FOR the form: an edit is written `DRAFT_SAVE_DEBOUNCE_MS` after the last one
 * (one entry per ask, `saveAskDraft`), and the form starts from the draft there already is.
 *
 * ANOTHER COPY'S WRITE IS ADOPTED, NEVER IMPOSED. The widget and the tab show the same draft because
 * both read the store (`useStoredAskDraft`), and a draft the store holds that this form has not seen
 * becomes its state. Two things stop it taking what is being typed:
 *
 * - an edit of THIS copy that has not been written yet (`timer`) always wins — it is newer than
 *   anything the store holds, and its own write is moments away;
 * - while the caret is in one of the form's text fields (`holdsCaret`) nothing is adopted, so the words
 *   and the caret stay where their owner left them. The adoption is tried again when the caret leaves.
 *
 * `known` is what this copy last wrote or adopted, which is how its own write coming back through the
 * store is told from another copy's.
 *
 * THE LAST WORDS ARE NOT LOST TO THE BEAT: an edit still waiting is written when the page is hidden or
 * unloaded (a phone dropping a background tab, a reload) and when the form unmounts (a widget closing
 * under a narrowing window). That last write is skipped before the preferences have hydrated, so a form
 * torn down by a sign-out cannot write the leaving user's words into the next one's account.
 *
 * `blank` must keep its identity for as long as the ask does (the caller memoises it).
 *
 * Used by `RoundAnswer` and `LockAnswer`, the two forms of an open ask.
 */
export function useAskDraft<State>(identity: string, blank: State, codec: AskDraftCodec<State>): {
  state: State;
  edit: (next: State | ((current: State) => State)) => void;
  clear: () => void;
  scopeRef: RefObject<HTMLDivElement>;
} {
  const stored = useStoredAskDraft(identity);
  const scopeRef = useRef<HTMLDivElement>(null);

  // What the form shows and edits. Essential: it is the one copy the keystrokes go into, so the field is never controlled by a store another copy can write into mid-word; the draft is saved from it, and adopted into it.
  const [state, setState] = useState<State>(() => (stored === null ? blank : codec.restore(stored, blank) ?? blank));
  // The newest state, readable from a timer or a page event, which a render's closure would read stale. A ref: it paints nothing.
  const latest = useRef(state);
  // The write waiting out the beat, or `null` when every edit of this copy is already written. A ref: nothing renders from it, and "an edit is unsent" is the fact adoption asks.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What this copy last wrote or adopted, as `wireOf` says it: the store holding exactly this means there is nothing new to take. A ref: it paints nothing.
  const known = useRef(wireOf(stored));

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const draft = codec.capture(identity, latest.current);
    // Before the write, which tells the store's listeners (this form among them) synchronously.
    known.current = wireOf(draft);
    saveAskDraft(identity, draft);
  }, [identity, codec]);

  const edit = useCallback((next: State | ((current: State) => State)) => {
    // Resolved against `latest`, never against a render's state, so two edits inside one event stack.
    const resolved = typeof next === 'function' ? (next as (current: State) => State)(latest.current) : next;
    latest.current = resolved;
    setState(resolved);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(flush, DRAFT_SAVE_DEBOUNCE_MS);
  }, [flush]);

  // A taken answer: the draft is deleted, and an edit still waiting is dropped with it rather than written back over the deletion.
  const clear = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    known.current = wireOf(null);
    saveAskDraft(identity, null);
  }, [identity]);

  useEffect(() => {
    const adopt = () => {
      if (timer.current !== null || holdsCaret(scopeRef.current)) return;
      // The store as it is NOW, not as the render that scheduled this effect saw it: a second write may have landed since.
      const current = readAskDraft(identity);
      const wire = wireOf(current);
      if (wire === known.current) return;
      known.current = wire;
      const next = current === null ? blank : codec.restore(current, blank) ?? blank;
      latest.current = next;
      setState(next);
    };
    adopt();
    const scope = scopeRef.current;
    let retry: ReturnType<typeof setTimeout> | undefined;
    // After the caret has left: focus has moved on by the next tick, which `focusout` itself cannot say.
    const onFocusOut = () => {
      clearTimeout(retry);
      retry = setTimeout(adopt, 0);
    };
    scope?.addEventListener('focusout', onFocusOut);
    return () => {
      scope?.removeEventListener('focusout', onFocusOut);
      clearTimeout(retry);
    };
  }, [stored, identity, blank, codec]);

  useEffect(() => {
    const writeWaiting = () => {
      if (timer.current !== null) flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') writeWaiting();
    };
    window.addEventListener('pagehide', writeWaiting);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', writeWaiting);
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer.current === null) return;
      if (hasHydratedUserPreferences()) {
        flush();
      } else {
        // The store is empty (a sign-out): the waiting write is dropped, not left to fire into the next account.
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [flush]);

  return { state, edit, clear, scopeRef };
}
