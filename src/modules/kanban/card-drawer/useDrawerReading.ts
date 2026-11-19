import { useCallback, useEffect, useRef, useState } from 'react';

import { soulName, stageRunning, type KanbanWalkStage } from '@/modules/kanban/utils/walkModel';

/** The sitting whose transcript the sheet is showing in place of the card. */
export type DrawerReading = { launchId: string; label: string; running: boolean };

/**
 * WHICH SITTING'S TRANSCRIPT STANDS IN PLACE OF THE CARD, and the way back from it.
 *
 * View state and nothing else: it reads no transcript (`SubagentTranscriptView` does, from the
 * launch id) and knows no card. The shell asks it to `clear` when another card opens, because a
 * transcript belongs to the card it was opened from.
 *
 * THE WAY BACK PUTS FOCUS ON THE PRESS THE READER LEFT FROM. A transcript is thousands of pixels
 * long, and a sheet that came back scrolled to wherever that left it would lose the step. Focus on
 * the press brings the step back into view and hands a keyboard its place again.
 */
export function useDrawerReading(): {
  reading: DrawerReading | null;
  readStage: (stage: KanbanWalkStage) => void;
  back: () => void;
  clear: () => void;
} {
  const [reading, setReading] = useState<DrawerReading | null>(null);
  const readFromRef = useRef<HTMLElement | null>(null);

  const readStage = useCallback((stage: KanbanWalkStage) => {
    if (stage.launch_id === null) return;
    readFromRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setReading({
      launchId: stage.launch_id,
      label: `${soulName(stage.soul)} · ${stage.name}`,
      running: stageRunning(stage),
    });
  }, []);

  const back = useCallback(() => setReading(null), []);

  const clear = useCallback(() => {
    readFromRef.current = null;
    setReading(null);
  }, []);

  useEffect(() => {
    if (reading === null) readFromRef.current?.focus();
  }, [reading]);

  return { reading, readStage, back, clear };
}
