import { useState } from 'react';

import { standingMark } from '@/modules/affected-areas/hooks/useMarkedRegions';
import { UnderstandingVerdict } from '@/modules/affected-areas/UnderstandingVerdict';
import { answerOfWrite } from '@/modules/affected-areas/utils/laneTrouble';
import type { Mark, ReadState, UnderstandingMarkRequest, UnderstandingMarkResult } from '@/shared/affected-areas-types';
import { api } from '@/shared/api';

type UnderstandingMarkProps = {
  /** The read whose account is judged; the card mounts this only for a read with a `readId`. */
  read: ReadState;
};

/**
 * THE UNDERSTANDING TAKES RIGHT OR WRONG: what the reader made of the whole face, judged in one press — Right, or
 * Wrong with a note saying what was wrong. Each is one `api.affectedAreas.markUnderstanding(readId, …)`, a row of its
 * own: a changed mind is a new press, and the history stays. The judgment drawn is the read's newest mark: the one the
 * wire carries (`read.understandingMark`) or the answer of a press made here, whichever is later (`standingMark`).
 *
 * A caller keys it by the read (`key={read.readId}`), so an answer, a refusal or a Wrong note typed for one face's
 * account never rides to another face's.
 *
 * This file holds the presses' state and sends them; `UnderstandingVerdict` draws them.
 *
 * Used by the affected-areas module's `UnderstandingCard`, as its last block.
 */
export function UnderstandingMark({ read }: UnderstandingMarkProps) {
  // ── The wires: the press out, its refusal, the last press's answer, the Wrong field, and the presses. Everything they
  //    hand `UnderstandingVerdict` is composition. ──
  // The verdict whose mark is out: while it is, both presses refuse a second, so one mark is sent at a time.
  const [out, setOut] = useState<UnderstandingMarkRequest['verdict'] | null>(null);
  // Why the last press was not kept, in the engine's or the lane's word, until the next press: said under the presses.
  const [refusal, setRefusal] = useState<string | null>(null);
  // The mark the last press made here was answered with, null before one. The wire's mark was fetched before the press, so
  // this is what is drawn from the press until a read of the pano brings the same mark or a later one (`standingMark`).
  const [answered, setAnswered] = useState<Mark | null>(null);
  // Whether Wrong was pressed and its field is open: a Wrong is sent from there, with the note of what was wrong.
  const [writing, setWriting] = useState(false);

  /** One press is one mark of its own: a changed mind is a new press, and the history stays with the engine. */
  const press = async (body: UnderstandingMarkRequest): Promise<void> => {
    const { readId } = read;
    if (out !== null || readId === null) return;
    setOut(body.verdict);
    setRefusal(null);
    const result = await answerOfWrite<UnderstandingMarkResult>(() => api.affectedAreas.markUnderstanding(readId, body));
    setOut(null);
    if ('refusal' in result) {
      setRefusal(result.refusal);
      return;
    }
    setAnswered(result.answer.mark);
    setWriting(false);
  };
  const onRight = (): void => {
    void press({ verdict: 'understanding_right' });
  };
  const onWrong = (): void => {
    setWriting(true);
    setRefusal(null);
  };
  const onSendWrong = (note: string): void => {
    void press({ verdict: 'understanding_wrong', note: note || null });
  };
  const onCancelWrong = (): void => setWriting(false);

  return (
    <UnderstandingVerdict
      out={out}
      refusal={refusal}
      mark={standingMark(answered, read.understandingMark)}
      writing={writing}
      onRight={onRight}
      onWrong={onWrong}
      onSendWrong={onSendWrong}
      onCancelWrong={onCancelWrong}
    />
  );
}
