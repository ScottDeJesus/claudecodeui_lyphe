import { ArrowLeft } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useCompanion } from '@/modules/companion';
import { useStation } from '@/modules/station/context/StationContext';
import { StationDock } from '@/modules/station/StationDock';
import { useHostWindow } from '@/shared/context/HostWindowContext';
import { Button } from '@/shared/ui';
import { OWNS_ESCAPE } from '@/shared/ui/overlayEscape';
import { shouldOutsidePressClose } from '@/shared/utils';

/** How far outside the core's outer ring the bead orbits, in px: clear of the ring's press. Held still at a small core's corner, it sits just on the ring. */
const BEAD_GAP = 10;
const STILL_GAP = 2;

/** The draft's card beside the core at a desk: its width at most, and the air it keeps from the window's edges and from the core, in px. */
const POP_WIDTH = 560;
const EDGE = 8;
const CLEAR_OF_CORE = 14;

/** Under this window width there is no room beside the core: the card is a sheet at the foot (the design system's Opening rule). */
const SHEET_UNDER_PX = 600;

/** A panel that owns Escape, or a modal dialog (the card's own Clear question), drawn in front of the card: the key is that one's. */
const IN_FRONT = '[data-owns-escape], [aria-modal="true"]';

/** Where the card stands: beside the core, its top left corner and the point it grows from; or a sheet at the foot. */
type PopPlace = { kind: 'beside'; left: number; top: number; originX: number; originY: number } | { kind: 'sheet' };

/**
 * Where the card stands beside a core whose middle is (`x`, `y`) and which reaches `clear` px from it: on the side with the room for it
 * (after the core first, the side the panel is on), level with the core and kept inside the window, growing from the core's middle.
 * With no room on either side, it stands over the core, centred on it.
 */
function placeBeside(x: number, y: number, clear: number, width: number, height: number, windowWidth: number, windowHeight: number): PopPlace {
  const after = x + clear;
  const before = x - clear - width;
  const left = after + width <= windowWidth - EDGE ? after : before >= EDGE ? before : x - width / 2;
  const insideLeft = Math.round(Math.min(Math.max(EDGE, left), Math.max(EDGE, windowWidth - width - EDGE)));
  const top = Math.round(Math.min(Math.max(EDGE, y - height / 2), Math.max(EDGE, windowHeight - height - EDGE)));
  return { kind: 'beside', left: insideLeft, top, originX: Math.round(x - insideLeft), originY: Math.round(y - top) };
}

/**
 * THE DRAFT SHE HOLDS FOR YOUR SEND, AS AN ALERT ON HER CORE. It takes no room of its own on the station: while a draft stands, one bead
 * in the accent ink (a word is owed) orbits her core just outside its rings, drawn out of the core as it arrives, breathing, a ring
 * opening from it now and then; the orbit holds still under a pointer. Pressed, the draft opens beside the core: the same card the dock
 * drew over the box (`StationDock`, every rule of it kept: your edit saved before a send, Send steer while the chat works, Clear asking
 * first, the chat's name a press that puts it on the panel), grown out of the core on the lobe spring. Where the window is too narrow
 * for it beside the core it is a sheet at the foot.
 *
 * It shuts on its back arrow, on Escape (standing down while its own Clear question is up), on a press anywhere outside it, on a
 * second press of the bead, and by itself once the draft is sent or cleared, when the bead goes too.
 *
 * Drawn round the companion's core by `StationKaylee` (`CompanionCore`'s `around`), handed the radius of the core's outer ring. Round the
 * small mark at a column's head (`still`) there is no room for an orbit beside the name: the bead holds still on the ring at the core's
 * lower corner. `data-station-draft` on the bead names the draft's target kind; `data-station-draft-pop` is the card's box.
 */
export function StationDraftAlert({ ringRadius, still = false }: { ringRadius: number; still?: boolean }) {
  const { t } = useTranslation();
  const { picture } = useCompanion();
  const { tier } = useStation();
  const hostWindow = useHostWindow();
  const popId = useId();
  const beadRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  // The last press React delivered to the card's tree, its own portalled question included: a press there is not outside it.
  const pressInside = useRef<Event | null>(null);
  // Whether the card is open. A draft that is sent or cleared shuts it (below), so it never stands open over nothing.
  const [open, setOpen] = useState(false);
  // Where the card stands, measured from its own box once drawn; null until then (it is drawn hidden).
  const [place, setPlace] = useState<PopPlace | null>(null);
  const draft = picture?.draft ?? null;
  const name = picture?.settings.name ?? t('companion.defaultName', { defaultValue: 'Kaylee' });

  if (open && draft === null) setOpen(false);

  // Its place: beside the core, measured from the card's own box, so a card that grows (a refusal, Clear's question) moves rather than
  // running off the window; again as the window changes.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const settle = () => {
      const pop = popRef.current;
      const core = beadRef.current?.closest('[data-companion-core]');
      if (!pop || !core) return;
      if (hostWindow.innerWidth < SHEET_UNDER_PX) {
        setPlace((current) => (current?.kind === 'sheet' ? current : { kind: 'sheet' }));
        return;
      }
      const box = core.getBoundingClientRect();
      // Its layout size, never its box on screen: it grows in from a smaller scale, and the box would be the scaled one.
      const width = pop.offsetWidth;
      const height = pop.offsetHeight;
      const next = placeBeside(box.left + box.width / 2, box.top + box.height / 2, ringRadius + BEAD_GAP + CLEAR_OF_CORE, width, height, hostWindow.innerWidth, hostWindow.innerHeight);
      setPlace((current) => (current?.kind === 'beside' && next.kind === 'beside' && current.left === next.left && current.top === next.top ? current : next));
    };
    settle();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(settle);
    if (popRef.current) observer?.observe(popRef.current);
    hostWindow.addEventListener('resize', settle);
    return () => {
      observer?.disconnect();
      hostWindow.removeEventListener('resize', settle);
    };
  }, [open, ringRadius, hostWindow]);

  // Open, it shuts on Escape and on a press outside it. Escape is taken on the window's capture phase and marked handled, so the
  // station's own Escape (the way back) stands down for it; the card states it owns the key, so the page stands down too.
  useEffect(() => {
    if (!open) return undefined;
    const doc = hostWindow.document;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (pressInside.current === event) return;
      if (!shouldOutsidePressClose(event, [popRef.current, beadRef.current])) return;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const pop = popRef.current;
      const inFront = pop !== null && Array.from(doc.querySelectorAll(IN_FRONT)).some((element) => (
        element !== pop && (pop.contains(element) || (pop.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)
      ));
      if (inFront) return;
      event.preventDefault();
      setOpen(false);
      beadRef.current?.focus({ preventScroll: true });
    };
    doc.addEventListener('pointerdown', closeOnOutsidePointer);
    hostWindow.addEventListener('keydown', closeOnEscape, { capture: true });
    return () => {
      doc.removeEventListener('pointerdown', closeOnOutsidePointer);
      hostWindow.removeEventListener('keydown', closeOnEscape, { capture: true });
    };
  }, [open, hostWindow]);

  // The focus goes into the card once it is drawn where it stands (a hidden box takes no focus), and back to the bead when it shuts
  // with the focus inside it.
  const shown = open && place !== null;
  useEffect(() => {
    if (!shown) return undefined;
    const pop = popRef.current;
    const bead = beadRef.current;
    pop?.focus({ preventScroll: true });
    return () => {
      const active = hostWindow.document.activeElement;
      if (pop !== null && (pop.contains(active) || active === hostWindow.document.body)) bead?.focus({ preventScroll: true });
    };
  }, [shown, hostWindow]);

  if (draft === null) return null;

  const target = draft.target.kind === 'session' ? draft.target.session.name : draft.target.projectName;
  const beadLabel = t('station.draft.bead', { name, target, defaultValue: '{{name}}’s draft for {{target}}' });
  const backLabel = t('station.draft.back', { defaultValue: 'Back' });
  const sheet = place?.kind === 'sheet';
  const popStyle: CSSProperties = place === null
    ? { left: 0, top: 0, width: `min(${POP_WIDTH}px, calc(100vw - ${2 * EDGE}px))`, visibility: 'hidden' }
    : place.kind === 'sheet'
      ? { left: EDGE, right: EDGE, bottom: `calc(${EDGE}px + var(--keyboard-height, 0px) + var(--safe-area-inset-bottom, 0px))` }
      : { left: place.left, top: place.top, width: `min(${POP_WIDTH}px, calc(100vw - ${2 * EDGE}px))`, transformOrigin: `${place.originX}px ${place.originY}px` };

  return (
    <>
      <span data-open={open ? '' : undefined} data-still={still ? '' : undefined} className="station-draft-orbit">
        <button
          ref={beadRef}
          type="button"
          data-station-draft={draft.target.kind}
          aria-label={beadLabel}
          title={beadLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? popId : undefined}
          onClick={() => {
            // Measured afresh each time it opens: drawn hidden until its place is known.
            if (!open) setPlace(null);
            setOpen(!open);
          }}
          className="station-draft-bead outline-none focus-visible:ring-1 focus-visible:ring-ring"
          style={{ '--orbit-r': `${ringRadius + (still ? STILL_GAP : BEAD_GAP)}px` } as CSSProperties}
        />
      </span>
      {open && createPortal(
        <div
          ref={popRef}
          id={popId}
          role="dialog"
          aria-label={t('station.dock.label', { name, defaultValue: '{{name}}’s draft' })}
          tabIndex={-1}
          {...OWNS_ESCAPE}
          data-station-draft-pop={sheet ? 'sheet' : 'beside'}
          onPointerDownCapture={(event) => { pressInside.current = event.nativeEvent; }}
          className="station-draft-pop fixed z-[60] flex flex-col outline-none"
          style={popStyle}
        >
          <StationDock
            tier={tier}
            density="full"
            lead={(
              <Button
                variant="ghost"
                size="icon"
                data-station-draft-back=""
                aria-label={backLabel}
                title={backLabel}
                className="-my-1 -ml-1 h-8 w-8 flex-none text-muted-foreground hover:text-foreground finger:h-11 finger:w-11"
                onClick={() => {
                  setOpen(false);
                  beadRef.current?.focus({ preventScroll: true });
                }}
              >
                <ArrowLeft aria-hidden="true" />
              </Button>
            )}
          />
        </div>,
        hostWindow.document.body,
      )}
    </>
  );
}
