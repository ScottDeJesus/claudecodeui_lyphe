import { Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { WaitingAsks } from '@/modules/dispatcher';
import { HealPanel } from '@/modules/heal';
import { useInboxWaiting } from '@/modules/inbox/hooks/useInboxWaiting';
import { MemoryIntakePanel } from '@/modules/memory-intake';
import { useDeviceSettings } from '@/shared/hooks/useDeviceSettings';
import { Spinner, Tabs } from '@/shared/ui';

/** The Inbox's three sections in the operator's order — the strip draws them so, and the entry rule walks them so — each with the key of its word. */
const SECTIONS = [
  { id: 'memory', wordKey: 'inbox.sections.memory' },
  { id: 'heal', wordKey: 'inbox.sections.heal' },
  { id: 'roadmap', wordKey: 'inbox.sections.roadmap' },
] as const;

/** One section of the Inbox. */
type InboxSection = (typeof SECTIONS)[number]['id'];

/** The localStorage key the reader's last chosen section is held under. */
const HELD_SECTION_KEY = 'inbox.section';

/** The section the reader last chose, else the first on the strip; anything else a browser holds is not a section. */
function readHeldSection(): InboxSection {
  try {
    const stored = localStorage.getItem(HELD_SECTION_KEY);
    return SECTIONS.find((entry) => entry.id === stored)?.id ?? SECTIONS[0].id;
  } catch {
    return SECTIONS[0].id;
  }
}

/** Holds the reader's choice for his next visit; a browser that will not keep it keeps the choice for the session. */
function holdSection(section: InboxSection): void {
  try {
    localStorage.setItem(HELD_SECTION_KEY, section);
  } catch {
    // localStorage unavailable: the choice lasts the session.
  }
}

/**
 * Where an entry lands: the held section if something waits in it, else the first on the strip that has something
 * waiting, else the held one — the reader who came to an empty Inbox finds it where he left it. `null` while a reading
 * the answer rests on has not landed: a section not yet read is not a section with nothing waiting, so the rule never
 * walks past one (a cold reload would otherwise land on whichever reading arrived first). It answers the moment the
 * answer is settled — the held section as soon as it is read and waits, without the other two.
 */
function entrySection(held: InboxSection, counts: Record<InboxSection, number>, landed: Record<InboxSection, boolean>): InboxSection | null {
  if (!landed[held]) return null;
  if (counts[held] > 0) return held;
  for (const entry of SECTIONS) {
    if (!landed[entry.id]) return null;
    if (counts[entry.id] > 0) return entry.id;
  }
  return held;
}

/** What the body shows while a panel loads, and while the entry waits on its readings. */
const spinner = <div className="grid h-full place-items-center"><Spinner /></div>;

/**
 * THE INBOX: everything waiting on the operator, in three sections behind one strip — Memory (the memories sessions
 * proposed), Heal (the live friction) and Roadmap (each ask a feature or an epic is waiting on). The three are always
 * on the strip: a section with nothing waiting is quiet, never gone.
 *
 * ONE BODY AT A TIME. The Memory and Heal panels are full-height panels with headers and scrollers of their own, so they
 * mount whole under the strip, one at a time, each in this view's `Suspense`; stacked in one scroll they would nest
 * scrollers. The Roadmap section's body is the dispatcher's `WaitingAsks`, which opens in the same grammar.
 *
 * THE STRIP IS THE HEAD. The pane draws no title over it: the workspace names the view it opened, and the body under
 * the strip names its section in a header of its own. Each section carries its count only while something waits, in
 * the warn tone — the strip's own amber pill, the operator's turn — and in words too (`attention`): the kit hides the
 * pill from a screen reader and speaks the attention as the tab's description.
 *
 * The tray is drawn as the Roadmap view's faces are, segmented and at its own width, and from `md` the bar's padding
 * is the bodies' own `px-4`, so the tray, the section's header and its rows share one left edge. On a phone the tray
 * spans the row in equal thirds and the bar narrows to `px-3`: the room a third needs to keep its word and a
 * three-figure pill whole down to 360px (measured in review: 141 · 288 · 12 whole at 360, 375 and 390). The tray then
 * lines up with Heal's own `px-3` header, 4px left of the others; a count that stays on screen is worth more than the
 * edge. The kit's equal tab sets the floor below that: at 320 a third cannot hold "Memory" and its pill at any bar
 * padding (px-4, px-3 and px-2 measured), and the pill gives way to an ellipsis.
 *
 * AN ENTRY IS DECIDED ONCE, WHEN ITS READINGS HAVE LANDED (`entrySection`), and is then fixed for the visit: a count
 * falling to zero under the reader (he answers the last ask, he accepts the last memory) never moves him off the
 * section he is working in. Until it is decided — a cold reload on the Inbox, while the ledger or the queue is still
 * being read — no tab is lit and the body is the spinner; the reader's own pick on the strip always wins and leaves it.
 *
 * `data-inbox-panel` carries the section on screen (`deciding` until the entry is), the handle a browser probe finds the
 * Inbox by.
 *
 * Used by project-workspace's WorkspaceMain as the `inbox` view's pane, through this module's barrel (lazily).
 */
export default function InboxPanel() {
  const { t } = useTranslation();
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const counts = useInboxWaiting();
  // The section the reader held when he came in, read once: the entry rule is asked against it, and only a pick on the
  // strip writes it.
  const [held] = useState<InboxSection>(readHeldSection);
  // Where the entry rule lands him: null until every reading it rests on has landed, then fixed for the visit. Latched
  // here rather than recomputed, so a count falling to zero afterwards cannot move the section.
  const arrival = entrySection(held, counts, counts.landed);
  const [entered, setEntered] = useState<InboxSection | null>(arrival);
  if (entered === null && arrival !== null) setEntered(arrival);
  // The reader's own pick this visit: it outranks the entry, and it is how he leaves a body still waiting on readings.
  const [chosen, chooseSection] = useState<InboxSection | null>(null);
  const section = chosen ?? entered;

  // The strip hands back a bare id; only the three sections are ever one.
  const pick = (id: string) => {
    const next = SECTIONS.find((entry) => entry.id === id);
    if (next === undefined) return;
    chooseSection(next.id);
    holdSection(next.id);
  };
  const shown = SECTIONS.find((entry) => entry.id === section);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-inbox-panel={section ?? 'deciding'}>
      <div className="flex shrink-0 items-center border-b border-border px-3 py-2.5 md:px-4">
        <Tabs
          ariaLabel={t('inbox.sections.label')}
          tabs={SECTIONS.map((entry) => ({
            id: entry.id,
            label: t(entry.wordKey),
            // No pill at zero: an empty section is quiet, never a 0 to read past.
            count: counts[entry.id] > 0 ? counts[entry.id] : undefined,
            // The same count in words, for the reader the pill is hidden from; it is the same amber as the tone.
            attention: counts[entry.id] > 0 ? t('inbox.sections.waiting', { count: counts[entry.id] }) : undefined,
            tone: 'warn' as const,
          }))}
          active={section ?? ''}
          onChange={pick}
          equal={isMobile}
        />
      </div>

      <div role="tabpanel" aria-label={shown === undefined ? undefined : t(shown.wordKey)} aria-busy={section === null} className="min-h-0 flex-1">
        {/* A section's panel loads the first time it is drawn; the strip stays put while it does. The same spinner
            holds the body while the entry waits on its readings. */}
        <Suspense fallback={spinner}>
          {section === null && spinner}
          {section === 'memory' && <MemoryIntakePanel />}
          {section === 'heal' && <HealPanel />}
          {section === 'roadmap' && <WaitingAsks />}
        </Suspense>
      </div>
    </div>
  );
}
