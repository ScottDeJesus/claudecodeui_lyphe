import type { ArcSnapshot } from '@/shared/types.js';

/**
 * Which arc cards cannot start, and the memory that makes each refusal reach the phone exactly once.
 *
 * A card a PRESS refuses wears the refusal on itself — either door, the start ladder for a card with no run or
 * the `resume` of a run that was created parked: the runner stamps `arc.json:cards[].refusal`
 * (exit, the ladder's own sentence, when it was first and last seen) and derives the card's state `stuck`
 * from it, so the deck and this notifier read the SAME fact. Measured 2026-09-24, and this file exists
 * because of it: the `docstore` arc's card 5 landed at 07:52 and the watchdog pressed card 6 every two
 * minutes for the next 76 minutes; `start` answered `2` thirty-eight times, the deck said "Walking" over a
 * card no door would start, and nobody was told. The retry is not the problem — a cured plan must start on
 * the next tick with nobody pressing anything — the silence was.
 *
 * "ALREADY ANNOUNCED" IS A SET OF EPISODE KEYS, held by the caller in durable storage rather than in this
 * process, for the reason the endings notifier holds a watermark there: the dev server restarts on every
 * edit through a handover that runs the old and the new server side by side, so a set in memory would
 * re-announce every standing refusal on each boot. The KEY is `<arc>:<plan_path>:<first_seen>`, minted by
 * the runner as one episode (`hooks/plan_runner/arc_refused.py`): a tick refused again for the same reason
 * keeps its `first_seen`, so three hundred ticks are one key and one push, and a plan cured and refused
 * again for a different reason is a new key — and one more push, which is the honest count.
 *
 * THE SET IS PRUNED, BUT NOT WHILE A CARD CAN STILL BE REFUSED. A stored key is dropped only when the card
 * it names has STARTED (or landed) — never merely because this one picture carries no refusal for it. The
 * runner clears the stamp the moment a plan's bytes move, and a byte that moved is not a cure: the very next
 * tick may hear the same complaint and re-seat the SAME episode (`arc_refused.episode`), so a prune taken on
 * the picture in between would re-announce a refusal the phone has already been told (measured 2026-09-24:
 * `announced=1` → `announced=0 held=1` → `announced=1`, two pushes for one standing refusal). Written AFTER
 * each announcement, never before: a throw leaves that refusal due, and the next frame retries it rather than
 * losing it.
 *
 * A TEST ARC IS NOT NEWS. A fixture under a hidden root (`arc.test_arc`, `isHiddenProjectPath`) is refused
 * on purpose, exactly as a test run's ending is never the operator's news (`runner-endings.service.ts`).
 */

/** The card states a refusal can stand in — the runner's `arc_refused.STANDING_STATES` plus the `stuck` word
 *  `arcs._derive` overlays on them. A card in any other state has started or landed, so no key of its can
 *  ever be heard again and none needs remembering. */
const REFUSAL_ABLE_STATES: ReadonlySet<string> = new Set(['unminted', 'queued', 'stalled', 'stuck']);

export type ArcRefusal = {
  /** `<arc>:<plan_path>:<first_seen>` — ONE episode of one card of one arc, and the push's own identity. */
  key: string;
  arc: string;
  /** The arc's heading, as the record carries it — the fallback name when an arc file has no title. */
  arcTitle: string;
  position: number;
  cardTitle: string;
  /** The ladder's own sentence, captured off the refusing process's stderr. Free text: shown as text, never as markup. */
  reason: string;
  exit: number;
  /** The epoch SECOND this episode's first refusal was seen — the runner's `refusal.first_seen`, and the half of the key that makes one refusal however many ticks repeat it ONE push. */
  firstSeen: number;
  planPath: string;
};

export type ArcRefusalsDependencies = {
  /** The episode keys already announced, as last stored. Empty when nothing was ever stored. */
  readAnnounced: () => string[];
  /** Stores the keys that STILL stand. Called after each announcement, never before. */
  writeAnnounced: (keys: string[]) => void;
  /** Tells the users about one refusal. Synchronous; a throw leaves that refusal, and the ones after it, due. */
  announce: (refusal: ArcRefusal) => void;
};

export type ArcRefusalsNotifier = {
  /** Reads one picture of the deck. Call it wherever the arc frame is built, before the frame goes out. */
  observe(arcs: ArcSnapshot[]): void;
};

/**
 * Every refusal standing in one deck picture, in deck order — one entry per card that cannot start. A card
 * is standing when its state is `stuck` AND its stamp is present: the runner sets both together and clears
 * both together (`arcs._derive`), so a record caught between the two reads as "the ruler said so" (the
 * state) rather than as a refusal nobody can describe.
 */
function standingRefusals(arcs: ArcSnapshot[]): ArcRefusal[] {
  const standing: ArcRefusal[] = [];
  for (const arc of arcs) {
    if (arc.test_arc) continue;
    for (const card of arc.cards ?? []) {
      if (card.state !== 'stuck' || card.refusal === null) continue;
      standing.push({
        key: `${arc.arc}:${card.plan_path}:${card.refusal.firstSeen}`,
        arc: arc.arc,
        arcTitle: arc.title || arc.arc,
        position: card.position,
        cardTitle: card.title || card.plan_path,
        reason: card.refusal.reason,
        exit: card.refusal.exit,
        firstSeen: card.refusal.firstSeen,
        planPath: card.plan_path,
      });
    }
  }
  return standing;
}

/**
 * The scopes — `<arc>:<plan_path>` — of every card a refusal could still land on in this picture: one per
 * card in a `REFUSAL_ABLE_STATES` state. A stored episode key begins with exactly one of them
 * (`standingRefusals` builds it the same way), which is how a key is recognised as still held without a
 * reader having to parse it back apart.
 */
function refusalAbleScopes(arcs: ArcSnapshot[]): string[] {
  return arcs
    .filter((arc) => !arc.test_arc)
    .flatMap((arc) =>
      (arc.cards ?? [])
        .filter((card) => REFUSAL_ABLE_STATES.has(card.state))
        .map((card) => `${arc.arc}:${card.plan_path}`)
    );
}

export function createArcRefusalsNotifier(dependencies: ArcRefusalsDependencies): ArcRefusalsNotifier {
  return {
    observe(arcs) {
      const standing = standingRefusals(arcs);
      const scopes = refusalAbleScopes(arcs);
      const was = dependencies.readAnnounced();
      const stored = new Set(was);
      // What the caller will have on disk once this picture is done with: everything announced so far whose
      // card can still be refused. A key that is standing right now is by construction one of those.
      const held = () =>
        [...stored].filter((key) => scopes.some((scope) => key.startsWith(`${scope}:`)));

      for (const refusal of standing) {
        if (stored.has(refusal.key)) continue;
        dependencies.announce(refusal);
        // Remembered AFTER the announcement, and the list written per announcement: a throw leaves that
        // refusal — and the ones after it — due for the next picture rather than marking a push that never
        // went out. `stored` is what the caller will have on disk once this write lands, so the list it is
        // handed holds only keys that have been announced.
        stored.add(refusal.key);
        dependencies.writeAnnounced(held());
      }

      const after = held();
      if (after.length !== was.length || after.some((key, index) => key !== was[index])) {
        dependencies.writeAnnounced(after);
      }
    },
  };
}
