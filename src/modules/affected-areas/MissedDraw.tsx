import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { FacePhoto } from '@/modules/affected-areas/FacePhoto';
import { NoteDialog } from '@/modules/affected-areas/NoteDialog';
import { answerOfWrite } from '@/modules/affected-areas/utils/laneTrouble';
import type { Codebook, Region, ViewEntry } from '@/shared/affected-areas-types';
import { api } from '@/shared/api';
import { MIN_REGION_AREA } from '@/shared/constants';
import type { MissedStage, RegionShape } from '@/shared/types';

/**
 * Whether a drawn box covers less than the engine's floor (`bad_box`, `MIN_REGION_AREA`). The engine rounds the corners to 6
 * places and compares the area rounded to 8, so a box of exactly the floor is kept; this compares the same way.
 */
function underAreaFloor([x0, y0, x1, y1]: [number, number, number, number]): boolean {
  const corner = (value: number): number => Math.round(value * 1e6) / 1e6;
  const area = (corner(x1) - corner(x0)) * (corner(y1) - corner(y0));
  return Math.round(area * 1e8) / 1e8 < MIN_REGION_AREA;
}

type MissedDrawProps = {
  /** The shown face: its photo's sha names the view to the engine, its size is the photo's box. */
  view: ViewEntry;
  photo: string | null;
  alt: string;
  /** The face's regions in their looks, the layer switch already applied. */
  shapes: RegionShape[];
  /** One after the highest number of ALL the view's regions (hidden by the layer or not): the engine's next badge. */
  nextOrdinal: number;
  selectedId: string | null;
  onSelect: (regionId: string) => void;
  codebook: Codebook | null;
  /** The engine's answer, the new human region with its `missed` mark: the caller appends it to the view's regions. */
  onMissed: (region: Region) => void;
  /** The face's layer switch, drawn at the start of the photo's tool row. */
  tools?: ReactNode;
  /** The selected area's `MarkBar`, shown under the photo only while Missed one is idle, so no press of another area
   *  stands beside a box being drawn or held; hidden meanwhile, never unmounted, so it returns as it was. */
  bar?: ReactNode;
};

/**
 * MISSED ONE IS A BOX. The pano screen's face photo, which Missed one turns into a box to drag: on release the kind is
 * asked (a `Menu`), then an optional note, then Save, which is one `api.affectedAreas.missed` — the box becomes a human
 * region with its `missed` mark in one transaction, answered whole, and appears numbered after the last, dashed and
 * green (the region-look table's `human`). A box is one gesture on a phone, where a polygon would be many taps. A box
 * under the engine's area floor (`MIN_REGION_AREA`) is turned back here, never sent: its release leaves Missed one
 * drawing, so the next drag is a new box at once, and says `bad_box` (the engine's own sentence for it) in the line under
 * the photo that says the floor. No box under the floor ever reaches the kind, the note or Save.
 *
 * It stands where the pano screen's photo stood, the photo with it: the drawing state has to reach `RegionImage`'s
 * `drawing` and keep the held box on the photo, so the photo is drawn here (`FacePhoto`). The chosen area's presses
 * ride in too (`bar`), because only this file knows when a box is out and they must go away. This file holds the state
 * and sends the box; `FacePhoto` draws every step and `NoteDialog` takes the note. A caller keys it by the face's view
 * (`key={view.sha256}`), so a box drawn or held on one face, its note and its refusal never ride to another face.
 *
 * Used by the affected-areas module's `PanoScreen`, in place of its face photo.
 */
export function MissedDraw({ view, photo, alt, shapes, nextOrdinal, selectedId, onSelect, codebook, onMissed, tools, bar }: MissedDrawProps) {
  const { t } = useTranslation();
  // ── The wires: where Missed one stands, the note, the refusal, and the presses that move it. Everything they hand
  //    `FacePhoto` and `NoteDialog` is composition. ──
  // Where Missed one stands. The box and the kind chosen ride from `drawn` to `saving` and back, so a refused Save keeps
  // what the operator drew and a second Save sends the same box.
  const [stage, setStage] = useState<MissedStage>({ step: 'idle' });
  // The note kept for Save; spent once the area is answered. A note rides only on the press that sends the area.
  const [note, setNote] = useState('');
  // Whether the note dialog is up. The dialog is mounted only while open, so each opening starts from the kept note.
  const [noteOpen, setNoteOpen] = useState(false);
  // Why the box was not kept, in the engine's or the lane's word, until the next press: a release under the area floor (said in
  // the drawing step, which stays live) or the answer to a Save that was sent (said under the presses).
  const [refusal, setRefusal] = useState<string | null>(null);

  const onDraw = (): void => {
    setStage({ step: 'drawing' });
    setRefusal(null);
  };
  // A box in flight cannot be taken back: once Save is out, the area is either written or refused.
  const onCancel = (): void => {
    if (stage.step === 'saving') return;
    setStage({ step: 'idle' });
    setNote('');
    setRefusal(null);
  };
  // The library hands over every box that has a width and a height, so the engine's area floor is held here: a box under it
  // is turned back with the engine's own sentence (`bad_box`) and the stage stays `drawing`, where the photo still takes a
  // drag — the sentence says "drag a bigger one" and the next drag does. Only a box over the floor goes on to its kind.
  const onDrawn = (box: [number, number, number, number]): void => {
    if (underAreaFloor(box)) {
      setRefusal('bad_box');
      return;
    }
    setStage({ step: 'drawn', box, kind: null });
    setRefusal(null);
  };
  const onKind = (cls: string): void => setStage((current) => (current.step === 'drawn' ? { ...current, kind: cls } : current));
  const onNote = (): void => setNoteOpen(true);
  const onKeepNote = (kept: string): void => {
    setNote(kept);
    setNoteOpen(false);
  };
  const onCloseNote = (): void => setNoteOpen(false);
  const save = async (): Promise<void> => {
    if (stage.step !== 'drawn' || stage.kind === null) return;
    const { box, kind } = stage;
    setStage({ step: 'saving', box, kind });
    setRefusal(null);
    const result = await answerOfWrite<Region>(() => api.affectedAreas.missed(view.sha256, { class: kind, box, note: note || null, queue: 'browse' }));
    if ('refusal' in result) {
      setStage({ step: 'drawn', box, kind });
      setRefusal(result.refusal);
      return;
    }
    setStage({ step: 'idle' });
    setNote('');
    onMissed(result.answer);
  };
  const onSave = (): void => {
    void save();
  };

  return (
    <>
      <FacePhoto
        view={view}
        photo={photo}
        alt={alt}
        shapes={shapes}
        nextOrdinal={nextOrdinal}
        selectedId={selectedId}
        onSelect={onSelect}
        codebook={codebook}
        tools={tools}
        bar={bar}
        stage={stage}
        note={note}
        refusal={refusal}
        onDraw={onDraw}
        onCancel={onCancel}
        onDrawn={onDrawn}
        onKind={onKind}
        onNote={onNote}
        onSave={onSave}
      />
      {noteOpen && (
        <NoteDialog subject={t('affectedAreas.missed.noteSubject', { number: nextOrdinal })} note={note} onKeep={onKeepNote} onDismiss={onCloseNote} />
      )}
    </>
  );
}
