import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';

import { useCurrentApplication } from '@/modules/app-switcher';
import { useChatHost } from '@/modules/chat-host';
import { useProjectChatState } from '@/modules/project-workspace/context/ProjectsStateContext';
import type { ChatDoor } from '@/shared/types';

/**
 * Used by project-workspace's WorkspaceFrame to build the chat's one door, which its hotkey, the switcher's
 * FAB and radial and the command palette press: `floating` says which way a press goes, `toggle` is that
 * press, and `collapse` is the way home that does not ask.
 *
 * `toggle` on a floating chat is `collapse()`. Otherwise it is `open()` and then the application's half of
 * "which conversation does this bring": when the application in front names a `project` (`AppEntry.project`)
 * and is not the one the chat was last routed for, `openProjectChat(project, 'latest')` points the workspace at
 * that project's most recent conversation, once per VISIT. The application's id is remembered in a ref and
 * forgotten the moment no application is up, so the next time the row is framed it brings its project again,
 * while a conversation the reader picked afterwards is left alone for as long as the visit lasts. That the
 * workspace may already be on the project is `openProjectChat`'s own rule, so an older conversation of the
 * same repository is never swapped for its newest.
 *
 * `open` runs FIRST and SYNCHRONOUSLY inside the caller's press — a picture-in-picture window can only be
 * requested from a user gesture, and the routing that follows is only state, so nothing may be awaited or
 * deferred ahead of the window's request. This hook lives here, not in chat-host or the switcher, because it is
 * the one place that joins the two: chat-host knows where the chat is and the switcher knows what is on
 * screen, and neither imports the other.
 *
 * `toggle` and `collapse` keep ONE identity for as long as the chat host lives: `toggle` reads which way a
 * press goes, and the application in front, from refs written after every commit, so a flip of `floating` or a
 * change of application hands its readers no new function and a listener that kept the one it was handed is
 * never a render behind. Only the door object itself is new when `floating` or `unread` flips, because they
 * are values it carries.
 */
export function useChatDoor(): ChatDoor {
  const { placement, unread, open, collapse } = useChatHost();
  const { openProjectChat } = useProjectChatState();
  const currentApplication = useCurrentApplication();
  const floating = placement !== 'home';

  // Which way a press goes, and which application is in front, as of the last commit. Refs so `toggle` need not
  // be rebuilt when either flips; a press always lands after the commit that made the chat float or the
  // application appear, so neither ref is ever a press behind.
  const floatingRef = useRef(floating);
  const currentApplicationRef = useRef(currentApplication);
  useLayoutEffect(() => {
    floatingRef.current = floating;
    currentApplicationRef.current = currentApplication;
  });

  // The id of the application the chat was last routed for. A ref because it is a memory between presses, not
  // something any render draws: it says "this visit already brought its project", and is cleared below when
  // the visit ends.
  const routedApplicationIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (currentApplication === null) routedApplicationIdRef.current = null;
  }, [currentApplication]);

  const toggle = useCallback(() => {
    if (floatingRef.current) {
      collapse();
      return;
    }
    open();

    const application = currentApplicationRef.current?.app;
    if (application?.project && application.id !== routedApplicationIdRef.current) {
      openProjectChat(application.project, 'latest');
      routedApplicationIdRef.current = application.id;
    }
  }, [open, collapse, openProjectChat]);

  return useMemo(() => ({ floating, unread, toggle, collapse }), [floating, unread, toggle, collapse]);
}
