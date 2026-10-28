<!-- docstore export; edit rows with docstore write, never this file -->

## INV-8679 — probe — LOW — MAN-8579 describes three `Gallery` props more broadly than the code behaves

LOW — MAN-8579 describes three `Gallery` props more broadly than the code behaves

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX)
cat > "$D/p.mjs" <<'EOF'
import { open } from '/home/lyphe/.claude/state/pipeline-reviews/tour-affected-areas--viewer--library/athena-kit.mjs';
const { page, browser } = await open();
try {
  const run = async (p) => {
    await page.evaluate((p) => { const m = window.__mountReact, ui = window.__ui; const items = Array.from({ length: p.n }, (_, i) => ({ id: 'i' + i, src: window.__grey, tag: 'T' + i })); return m.mount('t', m.h('div', { style: { width: 500 } }, m.h(ui.Gallery, { items, label: 'g', max: p.max, selectedId: p.sel, onSelect: p.press ? () => {} : undefined }))); }, p);
    await page.waitForTimeout(400);
    const out = await page.evaluate(() => { const tiles = [...document.querySelectorAll('.vv-gallery__tile')]; return { tiles: tiles.map(e => e.tagName[0] + (e.getAttribute('aria-current') === 'true' ? '*' : '')).join(' '), ring: tiles.some(e => getComputedStyle(e).boxShadow !== 'none') }; });
    await page.evaluate(() => window.__mountReact.unmount('t'));
    return out;
  };
  console.log('selectedId=i1, no onSelect  (B=button D=div *=aria-current):', JSON.stringify(await run({ n: 3, sel: 'i1', press: false })));
  console.log('selectedId=i1, onSelect                                    :', JSON.stringify(await run({ n: 3, sel: 'i1', press: true })));
  console.log('10 items, max 4, no onSelect (the overflow tile)           :', JSON.stringify(await run({ n: 10, max: 4, press: false })));
  console.log('5 items, max 0 and max 2.9, tiles drawn                    :', (await run({ n: 5, max: 0, press: true })).tiles, '|', (await run({ n: 5, max: 2.9, press: true })).tiles);
} finally { await browser.close(); }
EOF
node "$D/p.mjs"
expect: today "no onSelect" prints {"tiles":"D D D","ring":false}, "onSelect" prints {"tiles":"B B* B","ring":true}, the overflow line ends in " B", and max 0 / 2.9 print "B | B B"; cured: the row states each of those edges, or the first line shows a ring
```

measured 2026-10-17 by chain chain-tour-affected-areas--viewer--docs-20261017-161343-c51e, finding L2, LOW
probe-key: 561cc9c48776d39e0d11f22e3298513176d56476

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Gallery.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/PhotoFill.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/RegionDrawLayer.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/RegionImage.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/media.css

## INV-9721 — `regionBadgePlaces.ts` mirrors three sizes the paint sets — change a paint size and its constant together

`clearBadgePlaces` (`RegionImage`'s `badgePlacement="clear"`, MAN-8945) places a badge on screen sizes it cannot read from the CSS:

| constant | value | the paint it mirrors |
|---|---|---|
| `BADGE_PX` | 22 | `--vv-region-badge-size` (`media.css`) |
| `SPOT_PX` | 18 | `--vv-region-spot-size` 16 px plus the 1 px hairline on each side (`spots.css`) |
| `PRESS_PX` | 6 | `.vv-region-badge::before`, `inset: -6px` (`media.css`) |

- A paint size changed alone moves badges onto what they were placed to clear, or keeps them off space that is free.
- `REACH_PX` (17) is half a badge and a press, and `SWEEP_PX` (11) half a badge: both follow the two sizes above.
- The order a place is weighed in (`Cost`: no earlier badge or spot with a middle within `REACH_PX` · covers no earlier badge or spot · middle on no other region's box · touches its own box · press clear of neighbours · least on other boxes, then a sweep of the whole picture when none of the 24 clears every press) is the contract, stated in MAN-8945's `badgePlacement` row; a change to it changes that row in the same edit.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/regionBadgePlaces.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/media.css, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/spots.css
