import { isFileKind } from '@/modules/universe/utils/universeBirth';
import { hiddenKind } from '@/modules/universe/utils/universeTweaks';
import { bandedBrightness, colorForNode } from '@/modules/universe/utils/universeTokens';
import type { Frame } from '@/modules/universe/utils/universeGraphPasses';
import type { UniverseGraph, UniverseGraphNode } from '@/modules/universe/utils/universeGraph';
import type { UniverseTokens } from '@/modules/universe/utils/universeTokens';
import type { UniverseTweaks } from '@/modules/universe/utils/universeTweaks';

/**
 * WHAT A BODY LOOKS LIKE ONCE ITS FILES HAVE GONE SUB-PIXEL — one TILE per body that has file
 * children, standing in for the stars the coarse regime has just switched off.
 *
 * THE TILE IS THE BODY'S OWN DUST, NOT A DISC. Every file child is drawn once, as the one pixel it
 * has shrunk to, at the birth offset it holds from its directory and in its own kind's colour — so
 * what the coarse view blits is the shape those stars actually make, with the spread and the
 * unevenness they actually have. The disc was tried first and measured: a flat additive wash at
 * radius `fr * 1.6` over the glow sprite's solid plateau turned the fitted view 70% pure-white
 * pixels — a sky of featureless moons where the stars cluster unevenly inside their directories.
 * Dust has neither problem, because dust is only ever where a star was.
 *
 * ONE TILE PER BODY WITH FILE CHILDREN, LEAF OR NOT. A directory holding files and subdirectories
 * tiles its own files; each subdirectory tiles the files under it. Every file in the map therefore
 * has a proxy at the fitted view, whether or not the directory it hangs from is a leaf.
 *
 * THE RESOLUTION IS DERIVED FROM THE SIDE, NEVER A CONSTANT. `side` is the tile's world span —
 * `2 · fr · CLOUD_REACH`, capped at `TILE_MAX_PX` — and the pixels per world unit is that side over
 * that span, so a child's offset maps to its pixel and every child of an average directory lands
 * inside the tile. The cap only coarsens the grain; it never changes what lands where.
 *
 * THE SPRITE HALF, AND ONLY THE SPRITE HALF. What a body is, how far its stars hang from it and
 * what kind they mostly are was decided at birth and lives on the node — `leaf`, `fr`, `dk` are the
 * graph's (see `universeRegimes`). This file turns that into something to blit, and does it ONCE
 * per map, in `buildClouds`: a tile is a rasterisation and a colour resolved from the palette is a
 * document read, and neither has any business inside a frame. `drawClouds` then spends one
 * `drawImage` per visible body, which at the fitted view is hundreds of blits where the star layer
 * would have walked every file in the estate.
 *
 * NO ADDITIVE BLEND AND NO HAZE of its own: the tile is drawn `source-over` at the alpha the node's
 * own focus and depth factors give it, because the dust baked into it is already the light the star
 * layer would have drawn there.
 */

/** How far past the mean birth distance of a body's stars its tile reaches. */
const CLOUD_REACH = 1.6;
/** The side a tile is capped at, in pixels: past this a directory's dust is compressed, not lost. */
const TILE_MAX_PX = 128;
/** What one dust point — one file child — is drawn at. */
const DOT_ALPHA = 0.8;

/** One body's cloud: the node it belongs to, the baked tile of its children, and its radius in world
 *  units before the frame's own display factor scales it. */
export type Cloud = { node: UniverseGraphNode; tile: HTMLCanvasElement; radius: number };

/**
 * The tile: one pixel of dust per file child, on a transparent ground, at the birth offset between
 * that child and its parent. `ppu` is the tile's own resolution — the side over the world span the
 * tile covers — so a child at world offset `(dx, dy)` lands at `(side / 2 + dx · ppu, …)`, which is
 * where the star itself would have been drawn. `null` for a body with no file children: with none
 * there is no dust, no extent to measure and nothing to blit.
 */
function bakeTile(
  node: UniverseGraphNode,
  kids: UniverseGraphNode[],
  tokens: UniverseTokens,
  tweaks: UniverseTweaks,
  now: number,
): HTMLCanvasElement | null {
  const reach = node.fr * CLOUD_REACH;
  if (!(reach > 0)) return null;
  const side = Math.min(TILE_MAX_PX, Math.ceil(2 * reach));
  if (side <= 0) return null;
  const tile = document.createElement('canvas');
  tile.width = side;
  tile.height = side;
  const ctx = tile.getContext('2d');
  if (ctx === null) return null;
  const ppu = side / (2 * reach);
  const centre = side / 2;
  // A star exactly on the rim would land one pixel past it: the clamp holds it in, at the edge the
  // star it stands for was drawn against anyway.
  const last = side - 1;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = DOT_ALPHA;
  for (const kid of kids) {
    if (!isFileKind(kid.kind) || hiddenKind(kid.kind, tweaks)) continue;
    const x = Math.min(last, Math.max(0, Math.floor(centre + (kid.px - node.px) * ppu)));
    const y = Math.min(last, Math.max(0, Math.floor(centre + (kid.py - node.py) * ppu)));
    // The SAME light the star layer would have drawn here, through the same call: `bandedBrightness`
    // is what every star-layer colour is resolved with, and it is the one place that knows a node's
    // `t` is the crawler's epoch SECONDS. A dust point carrying the raw curve instead reads dimmer
    // than the star it stands in for — the bands are a floor as well as a batch key.
    ctx.fillStyle = colorForNode(kid, tokens, bandedBrightness(kid, now, tweaks));
    ctx.fillRect(x, y, 1, 1);
  }
  return tile;
}

/**
 * Every body's tile, by node id — baked once per map (and once more when the palette or a tweak
 * moves, since the dust carries a resolved colour), and held by the owner for the frames that draw
 * it. A body with no file children has no cloud: it is a place its children are seen through, not a
 * light of its own.
 */
export function buildClouds(
  graph: UniverseGraph,
  tokens: UniverseTokens,
  tweaks: UniverseTweaks,
  now: number,
): Map<number, Cloud> {
  const clouds = new Map<number, Cloud>();
  for (const node of graph.bodies) {
    const kids = graph.children[node.id];
    // A folder whose every file is hidden has no dust to bake: `fr` is the tree's and says it has
    // children, but a tile with no pixels is a canvas allocated and blitted for nothing.
    if (kids === undefined || !kids.some((kid) => isFileKind(kid.kind) && !hiddenKind(kid.kind, tweaks))) continue;
    const tile = bakeTile(node, kids, tokens, tweaks, now);
    if (tile === null) continue;
    clouds.set(node.id, { node, tile, radius: node.fr * CLOUD_REACH });
  }
  return clouds;
}

/**
 * The clouds, in place of the stars the coarse regime left out. A body outside the padded bounds is
 * skipped before anything is asked of it, and the tile is drawn at the size the stars themselves
 * would have had: the pass runs inside the world transform, so the camera's zoom is already in the
 * matrix and the tile's dust lands where — and as large as — the stars it stands for.
 */
export function drawClouds(frame: Frame, clouds: Map<number, Cloud>): void {
  if (clouds.size === 0) return;
  const { ctx } = frame;
  ctx.globalCompositeOperation = 'source-over';
  for (const cloud of clouds.values()) {
    const node = cloud.node;
    if (!frame.visible(node)) continue;
    const radius = cloud.radius * node.ds;
    ctx.globalAlpha = node.f * node.da;
    ctx.drawImage(cloud.tile, node.x - radius, node.y - radius, radius * 2, radius * 2);
  }
  ctx.globalAlpha = 1;
}
