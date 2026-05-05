import maplibregl from 'maplibre-gl';
import { Heightmap, lngLatToMercator, mercatorToLngLat } from './heightmap';

export interface ExtentResult {
  west: number;
  south: number;
  east: number;
  north: number;
}

// Lets the user click-drag a rectangle on the map. Resolves to lng/lat bbox.
export function pickBBox(map: maplibregl.Map): Promise<ExtentResult | null> {
  return new Promise((resolve) => {
    const canvas = map.getCanvas();
    canvas.style.cursor = 'crosshair';
    map.dragPan.disable();
    map.boxZoom.disable();

    const overlay = document.createElement('div');
    overlay.className = 'bbox-preview';
    overlay.style.display = 'none';
    document.body.appendChild(overlay);

    let startPx: { x: number; y: number } | null = null;
    let startLngLat: maplibregl.LngLat | null = null;

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      startPx = { x: e.clientX, y: e.clientY };
      const rect = canvas.getBoundingClientRect();
      startLngLat = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
      overlay.style.display = 'block';
      overlay.style.left = `${startPx.x}px`;
      overlay.style.top = `${startPx.y}px`;
      overlay.style.width = '0px';
      overlay.style.height = '0px';
    };

    const onMove = (e: MouseEvent) => {
      if (!startPx) return;
      const x0 = Math.min(startPx.x, e.clientX);
      const y0 = Math.min(startPx.y, e.clientY);
      const w = Math.abs(e.clientX - startPx.x);
      const h = Math.abs(e.clientY - startPx.y);
      overlay.style.left = `${x0}px`;
      overlay.style.top = `${y0}px`;
      overlay.style.width = `${w}px`;
      overlay.style.height = `${h}px`;
    };

    const cleanup = () => {
      canvas.style.cursor = '';
      map.dragPan.enable();
      map.boxZoom.enable();
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
      window.removeEventListener('keydown', onKey, true);
      overlay.remove();
    };

    const onUp = (e: MouseEvent) => {
      if (!startPx || !startLngLat) {
        cleanup();
        resolve(null);
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const endLL = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
      const west = Math.min(startLngLat.lng, endLL.lng);
      const east = Math.max(startLngLat.lng, endLL.lng);
      const south = Math.min(startLngLat.lat, endLL.lat);
      const north = Math.max(startLngLat.lat, endLL.lat);
      cleanup();
      if (Math.abs(east - west) < 1e-6 || Math.abs(north - south) < 1e-6) {
        resolve(null);
      } else {
        resolve({ west, south, east, north });
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cleanup();
        resolve(null);
      }
    };

    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
    window.addEventListener('keydown', onKey, true);
  });
}

export function buildHeightmap(extent: ExtentResult, metersPerPixel: number): Heightmap {
  const sw = lngLatToMercator(extent.west, extent.south);
  const ne = lngLatToMercator(extent.east, extent.north);
  const widthMeters = ne.x - sw.x;
  const heightMeters = ne.y - sw.y;
  const width = Math.max(8, Math.round(widthMeters / metersPerPixel));
  const height = Math.max(8, Math.round(heightMeters / metersPerPixel));
  // Snap merc bbox to whole-pixel boundaries.
  const bboxMerc = {
    minX: sw.x,
    minY: sw.y,
    maxX: sw.x + width * metersPerPixel,
    maxY: sw.y + height * metersPerPixel,
  };
  const swLL = mercatorToLngLat(bboxMerc.minX, bboxMerc.minY);
  const neLL = mercatorToLngLat(bboxMerc.maxX, bboxMerc.maxY);
  const bboxLngLat = { west: swLL.lng, south: swLL.lat, east: neLL.lng, north: neLL.lat };
  return new Heightmap(width, height, bboxMerc, bboxLngLat);
}
