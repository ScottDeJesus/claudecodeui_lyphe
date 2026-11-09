import type { ComponentProps } from 'react';

import { SESSIONS_FAKE } from '@/modules/station/fake/sessions';
import { LiveSessionsView } from '@/modules/station/LiveSessions';

/*
 * THE START RIM'S FIXTURES, for `station-fake.ts`'s pictures only: `LiveSessionsView` drawn on the very chats, focus and mark the
 * `sessions` slot's slice draws in each picture (`fake/sessions.ts`), so the rim and "Where things stand" can never disagree about
 * what is running. Nothing in the app imports this file.
 *
 * - `home`: three chats working, the one on the stage lit; `waiting`: three working and one idle (the idle one is not drawn);
 *   `walkthrough`: one chat waiting on you (a permission it asked), the companion walking another, asleep, that the rim does not
 *   hold; `empty`: no chats at all, so the rim is not true and takes no room.
 */

/** A press a picture never makes: the shots photograph, they do not press. */
const NO_PRESS = () => {};

type LiveProps = Omit<ComponentProps<typeof LiveSessionsView>, 'tier' | 'density'>;

/** The rim's drawing in one picture, from the `sessions` slice of the same picture. */
const live = (picture: keyof typeof SESSIONS_FAKE) => {
  const { sessions, focus, her } = SESSIONS_FAKE[picture].props;
  return {
    view: LiveSessionsView,
    props: { sessions, focus, her, onPress: NO_PRESS, onMore: NO_PRESS } satisfies LiveProps,
  };
};

/** The `live` slot's drawing in each of the four pictures. */
export const LIVE_FAKE = {
  home: live('home'),
  waiting: live('waiting'),
  walkthrough: live('walkthrough'),
  empty: live('empty'),
};
