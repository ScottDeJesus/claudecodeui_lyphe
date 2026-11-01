import { useEffect, useRef } from 'react';

import { useUiPreferences } from '@/shared/context/UiPreferencesContext';
import type { AppTab } from '@/shared/types';

/** The views whose link the person can hide from the navigation, and the preference that hides each. */
type NavHideChoices = Record<'files' | 'git' | 'browser', boolean>;

/**
 * Used by WorkspaceMain, which owns the active tab: when a person turns "Hide Files / Git / Browser" ON while that
 * very view is in front, the workspace moves to chat — the link they just removed is the one they were standing on.
 *
 * It acts on the TRANSITION, never on the state. A hidden view is still reachable (the command palette, a file link
 * in the chat), and someone who got there that way must be left on it: a check of "active tab is a hidden view" on
 * every render would throw them back to chat the moment they arrived. Unlike the Shell and Tasks gates, which remove
 * the pane itself and so must be enforced on every render, a nav choice removes only a link.
 *
 * It waits for the preferences to settle, and the first settled read is only recorded: before the server's copy
 * arrives a cold mirror holds the DEFAULTS, so a saved "hidden" would otherwise look like a fresh turn-on and move
 * someone off a view they opened on purpose after a reload. Every later settled change — a toggle here, or one
 * made on another device — counts.
 */
export function useHiddenNavFallback({ activeTab, setActiveTab }: {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
}): void {
  const { hideFilesTab, hideGitTab, hideBrowserTab, settled } = useUiPreferences();

  // The choices as of the last settled render. A ref, not state: it only lets this effect tell a change from a steady
  // value, and must not cause a render of its own. `null` until the first settled read, which is only recorded.
  const lastSettledChoices = useRef<NavHideChoices | null>(null);

  useEffect(() => {
    if (!settled) return;
    const choices: NavHideChoices = { files: hideFilesTab, git: hideGitTab, browser: hideBrowserTab };
    const before = lastSettledChoices.current;
    lastSettledChoices.current = choices;
    if (before === null) return;

    const justHidden = (Object.keys(choices) as (keyof NavHideChoices)[]).filter((id) => choices[id] && !before[id]);
    if (justHidden.some((id) => id === activeTab)) setActiveTab('chat');
  }, [settled, hideFilesTab, hideGitTab, hideBrowserTab, activeTab, setActiveTab]);
}
