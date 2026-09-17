import { useCallback, useEffect, useRef, useState } from 'react';

import type { LLMProvider } from '@/shared/types';
import { fetchProviderAuthStatus } from '@/modules/provider-auth';

type SignInCheck = Array<readonly [LLMProvider, Awaited<ReturnType<typeof fetchProviderAuthStatus>>]>;

/**
 * The sign-in check under way, shared: the new-chat empty state mounts twice in quick succession
 * while its pane settles, and each mount asking the server again doubled the checks. It describes
 * the server host's CLIs, not a user or a session, so any caller may share it.
 */
let checkInFlight: { providers: string; promise: Promise<SignInCheck> } | null = null;

function checkSignIns(providers: readonly LLMProvider[]): Promise<SignInCheck> {
  const key = providers.join(',');
  if (checkInFlight?.providers !== key) {
    const promise = Promise.all(
      providers.map(async (id) => [id, await fetchProviderAuthStatus(id)] as const),
    ).finally(() => {
      if (checkInFlight?.promise === promise) checkInFlight = null;
    });
    checkInFlight = { providers: key, promise };
  }
  return checkInFlight.promise;
}

/**
 * Which providers the new-chat model picker hides because the server reports them signed out,
 * and the picker's open state, which decides when that set may change.
 *
 * Read by `transcript/ProviderSelectionEmptyState.tsx`. Only a real answer hides a provider: a
 * check that failed leaves it listed, and nothing is hidden before the first answer. The check runs
 * when a new chat opens and again each time the reader opens the picker, so signing in from
 * Settings shows that provider without a reload; closing the picker checks nothing.
 *
 * While the picker is open, an answer that brings a provider back applies at once, but one that
 * takes a provider away waits until the picker closes, so a group never vanishes under the
 * reader's pointer. The first answer is the exception: until it lands nothing has been hidden
 * yet, so it applies whole even with the picker open.
 */
export function useSignedOutProviders(active: boolean, providers: readonly LLMProvider[]) {
  // Keyed by content, so a caller passing a fresh array each render does not re-run the check.
  const providersKey = providers.join(',');
  const [signedOut, setSignedOut] = useState<ReadonlySet<LLMProvider>>(() => new Set());
  const [pickerOpen, setPickerOpenState] = useState(false);
  const pickerOpenRef = useRef(false);
  const answeredRef = useRef(false);
  const pendingRef = useRef<ReadonlySet<LLMProvider> | null>(null);
  // Bumped whenever answers stop being wanted (the chat is left), so a late one is dropped.
  const generationRef = useRef(0);

  const recheck = useCallback(() => {
    const generation = generationRef.current;
    void checkSignIns(providersKey.split(',') as LLMProvider[]).then((results) => {
      if (generation !== generationRef.current) return;
      const answer: ReadonlySet<LLMProvider> = new Set(
        results.filter(([, r]) => r.answered && !r.status.authenticated).map(([id]) => id),
      );
      if (pickerOpenRef.current && answeredRef.current) {
        pendingRef.current = answer;
        setSignedOut((previous) => new Set([...previous].filter((id) => answer.has(id))));
      } else {
        pendingRef.current = null;
        setSignedOut(answer);
      }
      answeredRef.current = true;
    });
  }, [providersKey]);

  useEffect(() => {
    if (!active) return undefined;
    recheck();
    return () => {
      generationRef.current += 1;
      // Leaving the chat unmounts the picker without a close, so forget what it was holding.
      pickerOpenRef.current = false;
      pendingRef.current = null;
    };
  }, [active, recheck]);

  /** Opens or closes the picker. `recheck: false` for a reopening that is only a return from a sub-view. */
  const setPickerOpen = useCallback((open: boolean, options: { recheck?: boolean } = {}) => {
    pickerOpenRef.current = open;
    setPickerOpenState(open);
    if (open) {
      if (options.recheck !== false) recheck();
      return;
    }
    if (pendingRef.current) {
      setSignedOut(pendingRef.current);
      pendingRef.current = null;
    }
  }, [recheck]);

  return { signedOut, pickerOpen, setPickerOpen };
}
