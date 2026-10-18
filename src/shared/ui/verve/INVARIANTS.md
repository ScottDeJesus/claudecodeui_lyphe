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

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/

## INV-8680 — probe — LOW — The brief's one proof of findability does not print the library row, and the title carries only part of what an editor would type

LOW — The brief's one proof of findability does not print the library row, and the title carries only part of what an editor would type

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX)
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
printf 'brief query : '; docstore search "affected areas tours view lane RegionImage Gallery" --text | cut -d' ' -f1 | tr '\n' ' '; echo
printf 'PhotoFill   : '; docstore search "PhotoFill" --text | cut -d' ' -f1 | tr '\n' ' '; echo
EOF
bash "$D/p.sh"
expect: today "brief query : MAN-8575 MAN-8545 MAN-8577" and "PhotoFill   : MAN-4995"; cured: MAN-8579 printed on both lines
```

measured 2026-10-17 by chain chain-tour-affected-areas--viewer--docs-20261017-161343-c51e, finding L3, LOW
probe-key: 1a7f535b283f4912ff907778d576f4800c99c69d

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/
