import type { ComponentProps } from 'react';

import { MEMORY_NO_ANSWER } from '@/modules/station/hooks/useMemoryLines';
import { MemoryCornerView } from '@/modules/station/MemoryCorner';
import { docSpacePageUrl } from '@/modules/widgets';
import type { CompanionMemoryLines } from '@/shared/companion-types';

/*
 * THE CORNER'S FIXTURE DATA, for `station-fake.ts`'s pictures only: "What I'm keeping" in each of the four, and in the states
 * no picture shows, as `{ view, props }` drawings of `MemoryCornerView`. Nothing in the app imports this file.
 *
 * HER BANK AS IT STOOD on 2026-10-30, read and never written: `docstore list kaylee:memory --text`, `docstore get <token>` and
 * the corner's own read (`GET /api/companion/memory/lines`), whose answer is copied here whole — seven memories, newest said
 * first, each its token, title, kind (the invariant's own, or `manual`), the moment and account of its first quote, and his
 * words as `firstQuote(body, 200)` cut them. The moments are the bank's own, so the pictures say them as the corner says them
 * on the day they are drawn.
 *
 * - `home`: the seven, closed.
 * - `waiting`: the seven, open, the words of "Hoge is said Hoagie" open under it: the first line, so the short list holds
 *   his words whole as drawn (a line drawn open is never scrolled to; only his press brings a line's words into view).
 * - `walkthrough`: the seven, closed.
 * - `empty`: nothing kept yet, open (closed, an empty corner is its one line, "· 0").
 *
 * THE STATES no picture shows, `CORNER_STATES`, each drawn by the shots probe over the `home` picture: `open` (the seven, no
 * words open), `reading` (the first read still out), `unreadable` (her door's own sentence for a docstore that did not answer)
 * and `failed` (the page's own read failed over the reading it held, in the sentence `useMemoryLines` gives a read the server
 * never answered: `MEMORY_NO_ANSWER`, never the browser's own words).
 */

/** The bank's page in DocSpace, as the corner's read names it (`BANK_PAGE_ID`). */
const PAGE_ID = 'page-kaylee-memory';

/** Her bank's seven memories, as `GET /api/companion/memory/lines` answered on 2026-10-30. */
const HER_BANK: CompanionMemoryLines = {
  count: 7,
  pageId: PAGE_ID,
  reason: null,
  lines: [
    {
      token: 'MAN-9219', title: 'Hoge is said Hoagie', kind: 'manual', saidAt: '2026-10-29T23:16:41.513Z', account: 'scott',
      quote: 'HOGE is actually pronounced hoggie, sorry.',
    },
    {
      token: 'INV-10198', title: 'No restore drills, no VMs', kind: 'rule', saidAt: '2026-10-29T21:36:23.836Z', account: 'scott',
      quote: 'So in this whole backup thing, it\'s our backup file. We don\'t have to test if it loads properly because we can figure that out later. What\'s important is that we store all of our information and back…',
    },
    {
      token: 'INV-10167', title: 'Doers run on Opus', kind: 'rule', saidAt: '2026-10-29T18:09:58.457Z', account: 'scott',
      quote: 'Since you work on are working with Fable 5.1 model, do you think our and your writeups are so detailed? Do you think it would be okay to downgrade the models that you speak to to Opus 5.5?',
    },
    {
      token: 'INV-10162', title: 'Shipped is not done', kind: 'gotcha', saidAt: '2026-10-29T16:34:49.785Z', account: 'scott',
      quote: 'Just an FYI, sometimes the vendors sorry, just an FYI, um ignore what\'s out of done because I\'m not fully certain what else needs to be done. So if it says like seven out of seven done, don\'t assume t…',
    },
    {
      token: 'INV-10161', title: 'Memory is the big picture', kind: 'rule', saidAt: '2026-10-29T16:15:29.590Z', account: 'scott',
      quote: 'Okay, let\'s talk about your compaction real quick. In terms of your compaction, you\'re auto-compacted, but before that step happens, I want you to be able to choose what goes into memory and be the ju…',
    },
    {
      token: 'INV-10159', title: 'Restorly goal and my job', kind: 'rule', saidAt: '2026-10-29T15:57:32.413Z', account: 'scott',
      quote: 'Okay I was using the wrong microphone so that was partially my fault. Forget everything that was the last spoken message. Restorely app is going to be the main goal. It\'s going to be due in January an…',
    },
    {
      token: 'INV-10160', title: 'What my memory is for', kind: 'rule', saidAt: '2026-10-29T15:49:17.060Z', account: 'scott',
      quote: 'Great. I\'m glad everything is working and now that you can see everything we can really get started. Before we get started, however, I wanted to talk about your compassion protocol. Um what happened d…',
    },
  ],
};

/** A bank she has made and keeps nothing in. */
const NOTHING_KEPT: CompanionMemoryLines = { count: 0, pageId: PAGE_ID, reason: null, lines: [] };

/** Her bank when the docstore did not answer: her door's own sentence for it (`bank-door.ts`, `unansweredSentence`). */
const DOOR_DOWN: CompanionMemoryLines = {
  count: null, pageId: PAGE_ID, reason: 'the docstore door at http://127.0.0.1:8006 did not answer', lines: [],
};

/** A press a picture never makes: the shots photograph, they do not press. */
const NO_PRESS = () => {};

/** The corner's drawing: closed, nothing open, her seven, unless `over` says otherwise. */
function drawing(over: Partial<Omit<ComponentProps<typeof MemoryCornerView>, 'tier' | 'density'>>) {
  return {
    view: MemoryCornerView,
    props: {
      reading: HER_BANK,
      failure: null,
      onReread: NO_PRESS,
      open: false,
      onOpenChange: NO_PRESS,
      openLine: null,
      onOpenLine: NO_PRESS,
      pageUrl: docSpacePageUrl(PAGE_ID, null),
      ...over,
    } satisfies Omit<ComponentProps<typeof MemoryCornerView>, 'tier' | 'density'>,
  };
}

/** The corner in each of the four pictures: its view, and the props it draws that picture with. */
export const CORNER_FAKE = {
  home: drawing({}),
  waiting: drawing({ open: true, openLine: 'MAN-9219' }),
  walkthrough: drawing({}),
  empty: drawing({ reading: NOTHING_KEPT, open: true }),
};

/** The corner's states no picture shows, each drawn by the shots probe over the `home` picture. */
export const CORNER_STATES = {
  open: drawing({ open: true }),
  reading: drawing({ reading: null, open: true, pageUrl: null }),
  unreadable: drawing({ reading: DOOR_DOWN, open: true }),
  failed: drawing({ failure: MEMORY_NO_ANSWER, open: true }),
};
