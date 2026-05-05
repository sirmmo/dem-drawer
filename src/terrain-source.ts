import maplibregl from 'maplibre-gl';
import { Heightmap } from './heightmap';

const TILE_SIZE = 256;
const PROTOCOL = 'painted-dem';

let registered = false;

export function registerPaintedDemProtocol(getHeightmap: () => Heightmap | null) {
  if (registered) return;
  registered = true;

  maplibregl.addProtocol(PROTOCOL, async (req) => {
    // URL form: painted-dem://v{N}/{z}/{x}/{y}.png  or painted-dem://{z}/{x}/{y}.png
    const path = req.url.replace(`${PROTOCOL}://`, '').replace(/\.[a-z]+$/i, '');
    const parts = path.split('/').filter(Boolean);
    const last3 = parts.slice(-3).map((s) => parseInt(s, 10));
    if (last3.length !== 3 || last3.some(Number.isNaN)) {
      return { data: emptyTile() };
    }
    const [z, x, y] = last3;
    const hm = getHeightmap();
    const bitmap = await renderTile(z, x, y, hm);
    return { data: bitmap };
  });
}

async function emptyTile(): Promise<ImageBitmap> {
  return renderTile(0, 0, 0, null);
}

async function renderTile(z: number, x: number, y: number, hm: Heightmap | null): Promise<ImageBitmap> {
  const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(TILE_SIZE, TILE_SIZE);
  const buf = img.data;

  // Terrarium "0 m" baseline color (R=128, G=0, B=0).
  if (!hm) {
    fillBaseline(buf);
    ctx.putImageData(img, 0, 0);
    return createImageBitmap(canvas);
  }

  const n = Math.pow(2, z);
  const lngWest = (x / n) * 360 - 180;
  const lngEast = ((x + 1) / n) * 360 - 180;

  // Skip work if tile lng range is fully outside the heightmap bbox.
  const bb = hm.bboxLngLat;
  if (lngEast < bb.west || lngWest > bb.east) {
    fillBaseline(buf);
    ctx.putImageData(img, 0, 0);
    return createImageBitmap(canvas);
  }

  for (let py = 0; py < TILE_SIZE; py++) {
    const v = (py + 0.5) / TILE_SIZE;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + v) / n))) * 180) / Math.PI;
    if (lat < bb.south || lat > bb.north) {
      const rowStart = py * TILE_SIZE * 4;
      for (let i = 0; i < TILE_SIZE * 4; i += 4) {
        buf[rowStart + i] = 128;
        buf[rowStart + i + 1] = 0;
        buf[rowStart + i + 2] = 0;
        buf[rowStart + i + 3] = 255;
      }
      continue;
    }
    for (let pxi = 0; pxi < TILE_SIZE; pxi++) {
      const u = (pxi + 0.5) / TILE_SIZE;
      const lng = lngWest + u * (lngEast - lngWest);
      const e = sampleBilinear(hm, lng, lat);
      const total = clamp(Math.round((e + 32768) * 256), 0, 0xffffff);
      const idx = (py * TILE_SIZE + pxi) * 4;
      buf[idx] = (total >>> 16) & 0xff;
      buf[idx + 1] = (total >>> 8) & 0xff;
      buf[idx + 2] = total & 0xff;
      buf[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return createImageBitmap(canvas);
}

function fillBaseline(buf: Uint8ClampedArray) {
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = 128;
    buf[i + 1] = 0;
    buf[i + 2] = 0;
    buf[i + 3] = 255;
  }
}

function sampleBilinear(hm: Heightmap, lng: number, lat: number): number {
  const bb = hm.bboxLngLat;
  if (lng < bb.west || lng > bb.east || lat < bb.south || lat > bb.north) return 0;
  const px = hm.lngLatToPixel(lng, lat);
  const x0 = Math.floor(px.x);
  const y0 = Math.floor(px.y);
  if (x0 < 0 || y0 < 0 || x0 >= hm.width || y0 >= hm.height) return 0;
  const x1 = Math.min(x0 + 1, hm.width - 1);
  const y1 = Math.min(y0 + 1, hm.height - 1);
  const fx = px.x - x0;
  const fy = px.y - y0;
  const W = hm.width;
  const m = hm.mask;
  const d = hm.data;
  // Treat unpainted pixels as 0 so empty regions stay flat instead of bilinearly bleeding.
  const v00 = m[y0 * W + x0] ? d[y0 * W + x0] : 0;
  const v10 = m[y0 * W + x1] ? d[y0 * W + x1] : 0;
  const v01 = m[y1 * W + x0] ? d[y1 * W + x0] : 0;
  const v11 = m[y1 * W + x1] ? d[y1 * W + x1] : 0;
  return (
    v00 * (1 - fx) * (1 - fy) +
    v10 * fx * (1 - fy) +
    v01 * (1 - fx) * fy +
    v11 * fx * fy
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

const TERRAIN_SOURCE_ID = 'painted-dem-source';
let version = 0;

export function tileUrl(): string {
  return `${PROTOCOL}://v${version}/{z}/{x}/{y}.png`;
}

export function attachTerrain(map: maplibregl.Map, hm: Heightmap, exaggeration: number) {
  if (map.getSource(TERRAIN_SOURCE_ID)) {
    map.setTerrain(null);
    map.removeSource(TERRAIN_SOURCE_ID);
  }
  version++;
  map.addSource(TERRAIN_SOURCE_ID, {
    type: 'raster-dem',
    tiles: [tileUrl()],
    tileSize: TILE_SIZE,
    encoding: 'terrarium',
    minzoom: 0,
    maxzoom: 16,
    bounds: [hm.bboxLngLat.west, hm.bboxLngLat.south, hm.bboxLngLat.east, hm.bboxLngLat.north],
  });
  map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration });
}

export function detachTerrain(map: maplibregl.Map) {
  map.setTerrain(null);
  if (map.getSource(TERRAIN_SOURCE_ID)) map.removeSource(TERRAIN_SOURCE_ID);
}

export function setTerrainExaggeration(map: maplibregl.Map, exaggeration: number) {
  if (map.getTerrain()) {
    map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration });
  }
}

// Bump the version and re-point the source so MapLibre refetches all tiles.
export function refreshTerrain(map: maplibregl.Map) {
  const src = map.getSource(TERRAIN_SOURCE_ID) as maplibregl.RasterDEMTileSource | undefined;
  if (!src) return;
  version++;
  src.setTiles([tileUrl()]);
}
