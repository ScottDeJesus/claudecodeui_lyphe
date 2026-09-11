import { useCallback, useState } from 'react';

import { useIsExportingTranscript } from '@/modules/chat/context/TranscriptRenderContext';
import { clearCollapsed, isCollapsed, setCollapsed } from '@/modules/chat/transcript/shapes/collapseState';

/**
 * The two cross-cutting rules every collapsible shape obeys, in one place.
 *
 * Used by `ShapeFrame`, `ShapeSection` and `LongOutput`. Three components each remembering to
 * call `useIsExportingTranscript()` themselves would be three chances to ship a shape that exports
 * EMPTY — the failure `docs/architecture/06-tool-view.md` §"Rendering into an exported document"
 * warns about — so this is the only place under `shapes/` that reads the export context. A fourth
 * collapsible shape gets both rules for free by calling this and nothing else, and a shape that has
 * controls but no fold state of its own (`DataTable`, `DiffBlock`, `TabbedCode`) calls
 * `useShapeInteractive` at the foot of this file for the same reason — as does `CodeFence`, which
 * draws a mermaid fence's source instead of the diagram in an export.
 */
export function useShapeCollapse(collapseKey: string): {
  collapsed: boolean;
  toggle: () => void;
  interactive: boolean;
} {
  // An export is a static render inside `renderToStaticMarkup`, where no effect ever runs and
  // there is no chevron to click: a folded block there is content the reader can never reach.
  const isExporting = useIsExportingTranscript();
  // Seeded from the page-lifetime map rather than from a prop, because the transcript unmounts
  // rows that scroll far from the viewport and this component's own state dies with them.
  const [folded, setFolded] = useState(() => isCollapsed(collapseKey));
  // The key `folded` was seeded from. The key is content-addressed, so it CHANGES under a mounted
  // instance: the settled half of a streaming reply keeps growing, and a `section` is keyed on its
  // heading plus its whole body. Without this re-seed the state would still answer for the old
  // key while `toggle` wrote to the new one, and the reader's first click after any delta would
  // set what was already set and appear dead.
  const [seededKey, setSeededKey] = useState(collapseKey);
  if (seededKey !== collapseKey) {
    // The fold MIGRATES onto the new key; it is not re-read from it. Re-reading would find the new
    // key absent and spring the block open on every delta of an active stream — which is the one
    // thing the operator asked to control himself. A click this instance witnessed is known
    // intent, and known intent outranks the expanded default: that default exists to make a
    // COLLISION fail safe, not to discard a fold the reader can still see. Clearing the old key
    // is what keeps this a move rather than a copy, so the Map holds one entry per folded block.
    //
    // The honest limit of "this instance witnessed the click": a key change cannot be told apart
    // from React reusing this instance for a DIFFERENT block at the same index — the case when
    // root children reshuffle, as they do when Phase 7's `remarkShapeGroups` moves blocks into
    // section wrappers. The fold then lands on a block that never carried it, and the departed
    // block's memory is dropped. That is accepted rather than engineered around: telling the two
    // apart would need a stable block identity, and the key here is content-addressed and never an
    // id BY DESIGN. The cost is a spurious fold the reader can re-open — the same failure class
    // the plan already accepts for a djb2 collision, and it loses no content either.
    //
    // Reading BOTH keys is what makes this safe to run during render: re-running it with the same
    // inputs writes the same entry and deletes the same one, so StrictMode's double invocation
    // and React's own discarded re-render pass both land on the identical result. An effect could
    // not do this job at all — an export renders inside `renderToStaticMarkup`, where no effect
    // ever runs, and on screen it would paint one frame in the wrong state before correcting.
    const remembered = isCollapsed(collapseKey) || isCollapsed(seededKey);
    if (remembered) {
      setCollapsed(collapseKey, true);
      clearCollapsed(seededKey);
    }
    setSeededKey(collapseKey);
    setFolded(remembered);
  }

  const toggle = useCallback(() => {
    // Flipped from this instance's own state, which the re-seed above keeps equal to the Map's
    // answer for the CURRENT key. Two mounted blocks with identical text do share a key, but
    // neither subscribes to the Map, so the twin does not move until it next mounts — the
    // aliasing this design accepts, stated here rather than wished away.
    const next = !folded;
    setCollapsed(collapseKey, next);
    setFolded(next);
  }, [collapseKey, folded]);

  return { collapsed: isExporting ? false : folded, toggle, interactive: !isExporting };
}

/**
 * May a shape draw a control at all? False inside a transcript export, and nowhere else.
 *
 * The same answer `useShapeCollapse` returns as `interactive`, for a shape BODY that has controls
 * of its own but no fold state of its own — `DataTable`'s copy-as-CSV action and its sort headers.
 * `CodeFence` asks it too, to choose a renderer rather than a control: in an export a mermaid fence
 * is its source, because `MermaidDiagram` draws in an effect and reads `useTheme()`, and an export
 * runs no effect and mounts no `ThemeProvider`.
 * It lives in THIS module so the header above stays true: one place under `shapes/` reads the
 * export context, and a shape asking "may I draw a control?" asks the module that already knows
 * rather than growing a second answer beside it.
 *
 * It matters because an export inlines the app's stylesheets (`export/buildTranscriptHtml.tsx`),
 * so a control drawn into one LOOKS alive — it paints its own hover — and does nothing at all when
 * clicked. `ShapeFrame` already refuses to draw its toggle in that state; every other control in a
 * shape has to refuse with it, or the refusal is decoration.
 */
export function useShapeInteractive(): boolean {
  return !useIsExportingTranscript();
}
