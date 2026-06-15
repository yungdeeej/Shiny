/**
 * render.ts — rasterize an SVG string → PNG buffer via sharp.
 *
 * Film grain is composited HERE, not in the SVG: a full-canvas feTurbulence at
 * 2048² costs ~14s/image in librsvg. Instead we bake a small 256px noise tile
 * once (cached), tile it to the artboard, and composite it with `overlay` —
 * which keeps a clean render to ~2s/image.
 */
import sharp from "sharp";

export interface RenderOptions {
  /** Output edge length in px (default: the SVG's natural size). */
  size?: number;
  /** PNG compression effort 0..9 (sharp default 6). */
  effort?: number;
  /** Set false to skip the grain composite (faster). */
  grain?: boolean;
}

const GRAIN_TILE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><defs><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter></defs><rect width="256" height="256" filter="url(#n)"/></svg>`;

let grainTilePromise: Promise<Buffer> | null = null;
function grainTile(): Promise<Buffer> {
  if (!grainTilePromise) {
    grainTilePromise = sharp(Buffer.from(GRAIN_TILE_SVG)).png().toBuffer();
  }
  return grainTilePromise;
}

/** Build a board-sized, low-alpha grain layer (cached per w×h). */
const grainLayerCache = new Map<string, Promise<Buffer>>();
function grainLayer(w: number, h: number, opacity = 0.05): Promise<Buffer> {
  const key = `${w}x${h}`;
  let p = grainLayerCache.get(key);
  if (!p) {
    p = grainTile().then((tile) =>
      sharp(tile).resize(w, h, { kernel: "nearest" }).ensureAlpha(opacity).png().toBuffer(),
    );
    grainLayerCache.set(key, p);
  }
  return p;
}

export async function renderPng(svg: string, opts: RenderOptions = {}): Promise<Buffer> {
  // The SVG declares its own pixel dimensions, so density 96 (1:1) is correct.
  // Rasterize once; composite the cached grain layer; resize last.
  const flat = await sharp(Buffer.from(svg), { density: 96 }).png().toBuffer();
  let pipe = sharp(flat);
  if (opts.grain !== false) {
    const meta = await sharp(flat).metadata();
    const layer = await grainLayer(meta.width ?? 2048, meta.height ?? meta.width ?? 2048);
    pipe = sharp(await pipe.composite([{ input: layer, blend: "overlay" }]).png().toBuffer());
  }
  if (opts.size) {
    pipe = pipe.resize(opts.size, opts.size, { fit: "fill" });
  }
  return pipe.png({ compressionLevel: 9, effort: opts.effort ?? 4 }).toBuffer();
}

/** Render at a smaller size with stronger compression (for in-repo showcase PNGs). */
export async function renderShowcasePng(svg: string, size = 512): Promise<Buffer> {
  const full = await renderPng(svg, { grain: true });
  return sharp(full)
    .resize(size, size, { fit: "fill" })
    .png({ compressionLevel: 9, effort: 9, palette: true, quality: 80 })
    .toBuffer();
}
