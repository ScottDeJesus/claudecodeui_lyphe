import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { operatorWords } from '@/modules/dispatcher';
import { api } from '@/shared/api';
import { useToast } from '@/shared/context/ToastContext';
import type { RoadmapAct, RoadmapWriteBody } from '@/shared/roadmap-types';
import { firstLine } from '@/shared/utils';

/**
 * One write: resolves `true` exactly when the dispatcher took it (2xx), `false` on a refusal or a
 * request that never completed. Read by the Roadmap tab's dialogs, action menus and drags, which close
 * on a `true`.
 */
export type RoadmapWrite = (body: RoadmapWriteBody) => Promise<boolean>;

/** The nine writes, by act. Returned by `useRoadmapWrites` to the Roadmap tab's dialogs, action menus and drags. */
export type RoadmapWrites = Record<RoadmapAct, RoadmapWrite>;

/** The part of an answer this hook reads: the dispatcher's sentence (`stdout`, then `stderr`) or the lane's own 400 (`error`). All free text. */
type WriteAnswer = { stdout?: unknown; stderr?: unknown; error?: unknown };

/** The route each act goes through, in the lane's own words (`api.roadmap`). */
const CALL: Record<RoadmapAct, (body: RoadmapWriteBody) => Promise<Response>> = {
  add: api.roadmap.add,
  edit: api.roadmap.edit,
  move: api.roadmap.move,
  propose: api.roadmap.propose,
  unpropose: api.roadmap.unpropose,
  block: api.roadmap.block,
  unblock: api.roadmap.unblock,
  remove: api.roadmap.remove,
  promote: api.roadmap.promote,
};

/**
 * The acts whose body carries `title` to the dispatcher. On every other act a `title` a caller passes
 * is taken off before sending, so a word the lane's fences do not read for that act never rides the wire.
 */
const TITLE_ON_THE_WIRE: ReadonlySet<RoadmapAct> = new Set<RoadmapAct>(['add', 'edit']);

/** A verdict is the dispatcher's own body, so it is read BEFORE the status is judged — a 409 carries it too. */
async function readAnswer(response: Response): Promise<WriteAnswer | null> {
  try {
    return (await response.json()) as WriteAnswer;
  } catch {
    return null;
  }
}

/**
 * Add, Edit, Move, Propose, Back to idea, Block, Unblock, Delete and Promote for the roadmap's
 * items, and what to say about each. Used by every press of the Roadmap tab — the dialogs, the
 * action menus and the drag that reorders a card or a row.
 *
 * NOTHING IS OPTIMISTIC, AND THE HOOK HOLDS NO COPY OF THE PICTURE. A landed write pokes the lane, and
 * the screen redraws from the `roadmap_state` frame that follows (`RoadmapFeed`), so what is drawn is
 * what the store says. A write's answer is only a sentence for a toast, and the boolean it resolves
 * is for the caller's dialog: `true` closes it, `false` leaves it open with what was typed.
 *
 * A SUCCESS SPEAKS IN CLOUDCLI'S OWN WORDS (`roadmap.toast.<act>`, naming the item by the `itemTitle`
 * the caller passes — or by the `title` it sends, for an add or a rename), and a REFUSAL IN THE DISPATCHER'S: its first line, read from `stdout` before
 * `stderr` as `useDispatcherVerbs` does — every dispatcher verb refuses on stdout — and shown through
 * `operatorWords`, which says epic, feature and task where the dispatcher says arc, plan and phase.
 * A 400 (a field the lane's fence refused) carries its sentence in `error`, read last. The refusal
 * toast is amber rather than red: a refused write denied nothing and destroyed nothing.
 *
 * The toast is raised even if the dialog that pressed has closed: the provider above holds it, and a
 * write that landed after the dialog went away is still news.
 */
export function useRoadmapWrites(): RoadmapWrites {
  const { t } = useTranslation();
  const toast = useToast();

  return useMemo(() => {
    const run = async (act: RoadmapAct, body: RoadmapWriteBody): Promise<boolean> => {
      // `itemTitle` only ever names the item in the toast, so it never goes on the wire; `title` does
      // for the acts that change or set one.
      const { itemTitle, ...withoutItemTitle } = body;
      const { title, ...withoutTitle } = withoutItemTitle;
      const wire = TITLE_ON_THE_WIRE.has(act) ? withoutItemTitle : withoutTitle;
      try {
        const response = await CALL[act](wire);
        const answer = await readAnswer(response);
        if (response.ok) {
          // `itemTitle` is what the caller is showing, then the wire `title` (an add's, or an edit's new
          // one). The item's name stands in only for a caller that sent neither, so a toast never has a
          // hole in it; a caller is expected to send the title it is showing.
          toast({ tone: 'positive', title: t(`roadmap.toast.${act}`, { title: itemTitle ?? title ?? body.name ?? '' }) });
          return true;
        }
        const said = operatorWords(
          firstLine(answer?.stdout) || firstLine(answer?.stderr) || firstLine(answer?.error),
          body.name ? [body.name] : [],
        );
        toast({ tone: 'warn', title: said || t('messages.operationFailed') });
        return false;
      } catch (error) {
        // The request never completed — the API is down, or the deadline passed. That is the
        // network's word, not the dispatcher's, and it is said as such.
        console.warn(`[useRoadmapWrites] the ${act} request did not complete:`, error);
        toast({ tone: 'warn', title: t('messages.networkError') });
        return false;
      }
    };

    const bind = (act: RoadmapAct): RoadmapWrite => (body) => run(act, body);
    return {
      add: bind('add'),
      edit: bind('edit'),
      move: bind('move'),
      propose: bind('propose'),
      unpropose: bind('unpropose'),
      block: bind('block'),
      unblock: bind('unblock'),
      remove: bind('remove'),
      promote: bind('promote'),
    };
  }, [t, toast]);
}
