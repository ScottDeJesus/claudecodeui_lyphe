import { useState } from 'react';

import { MarkPresses } from '@/modules/affected-areas/MarkPresses';
import { NoteDialog } from '@/modules/affected-areas/NoteDialog';
import { answerOfWrite } from '@/modules/affected-areas/utils/laneTrouble';
import { kindName } from '@/modules/affected-areas/utils/tourModel';
import type { Codebook, MarkQueue, MarkRequest, Region } from '@/shared/affected-areas-types';
import { api } from '@/shared/api';

type MarkBarProps = {
  /** The area the presses judge: the pano's selected region, or the Mark screen's current item. */
  region: Region;
  codebook: Codebook | null;
  /** Where the operator is marking from, sent with every mark: `browse` on the pano screen, the queue's mode on the Mark screen. */
  queue: MarkQueue;
  /** The engine's answer, the judged region with its new `mark`, `standing` and `threshold`: the caller puts it in
   *  place of the one it holds and redraws (the pano never refetched), or moves to its queue's next area. */
  onMarked: (region: Region) => void;
};

/**
 * MARKBAR — THE THREE PRESSES ARE THE SAME EVERYWHERE: Confirm, Rename to… and Not a change, with an optional note,
 * on the pano screen's selected area and on the Mark screen's current one alike. EVERY PRESS IS A ROW, AND THE
 * ANSWER IS THE REDRAW: one press is one `api.affectedAreas.mark`, the lane forwards it with the operator's name, and
 * shadow-connector answers the judged region, which goes to `onMarked`; a refusal is said in words under the presses.
 *
 * This file holds the presses' state and sends them; `MarkPresses` draws them and `NoteDialog` takes the note. A
 * caller keys it by the area (`key={region.regionId}`), so a note kept for one area never rides with the next.
 *
 * Used by the affected-areas module's `PanoScreen` (the selected area, `queue` `browse`) and `MarkQueue` (the
 * queue's current area, `queue` its mode).
 */
export function MarkBar({ region, codebook, queue, onMarked }: MarkBarProps) {
  // ── The wires: the press out, its refusal, the note and its dialog, and the presses that send them. Everything they
  //    hand `MarkPresses` and `NoteDialog` is composition. ──
  // The press whose mark is out (a verdict, or `keep`): while it is out every press is refused, so one mark is sent at
  // a time and a double press never writes two rows.
  const [out, setOut] = useState<MarkRequest['verdict'] | 'keep' | null>(null);
  // Why the last press was not kept, in the engine's or the lane's word, until the next press goes out: said in a
  // sentence under the presses.
  const [refusal, setRefusal] = useState<string | null>(null);
  // The note kept for the next press. A note rides only on a press, so it is held here between the dialog and the press,
  // and spent when a mark is answered.
  const [note, setNote] = useState('');
  // Whether the note dialog is up. The dialog is mounted only while open, so each opening starts from the kept note.
  const [noteOpen, setNoteOpen] = useState(false);

  /** One press is one mark: sent through the lane, and the region the engine answers goes to the caller to be redrawn. */
  const press = async (pressed: MarkRequest['verdict'] | 'keep', body: MarkRequest): Promise<void> => {
    if (out !== null) return;
    setOut(pressed);
    setRefusal(null);
    const result = await answerOfWrite<Region>(() => api.affectedAreas.mark(region.regionId, body));
    setOut(null);
    if ('refusal' in result) {
      setRefusal(result.refusal);
      return;
    }
    setNote('');
    onMarked(result.answer);
  };
  const onMark = (verdict: 'confirm' | 'not_a_change'): void => {
    void press(verdict, { verdict, note: note || null, queue });
  };
  const onRename = (newClass: string): void => {
    void press('rename', { verdict: 'rename', newClass, note: note || null, queue });
  };
  // Keep is a rename to the kind the area already counts as: the engine takes it (it refuses only the reader's own kind),
  // and it is the press that lets a note ride on a renamed area without undoing the rename.
  const onKeep = (): void => {
    void press('keep', { verdict: 'rename', newClass: region.effectiveClass ?? region.class, note: note || null, queue });
  };
  const onNote = (): void => setNoteOpen(true);
  const onKeepNote = (kept: string): void => {
    setNote(kept);
    setNoteOpen(false);
  };
  const onCloseNote = (): void => setNoteOpen(false);

  return (
    <>
      <MarkPresses
        region={region}
        codebook={codebook}
        browsing={queue === 'browse'}
        out={out}
        refusal={refusal}
        note={note}
        onMark={onMark}
        onRename={onRename}
        onKeep={onKeep}
        onNote={onNote}
      />
      {noteOpen && (
        <NoteDialog
          subject={`${region.ordinal}. ${kindName(region.effectiveClass ?? region.class, codebook)}`}
          note={note}
          onKeep={onKeepNote}
          onDismiss={onCloseNote}
        />
      )}
    </>
  );
}
