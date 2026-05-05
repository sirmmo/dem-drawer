import maplibregl from 'maplibre-gl';
import { Heightmap } from './heightmap';
import { ramp } from './colormap';
import { hillshadeAt, SunParams, DEFAULT_SUN } from './hillshade';

const SOURCE_ID = 'dem-overlay';
const LAYER_ID = 'dem-overlay-layer';

export type DisplayMode = 'ramp' | 'hillshade' | 'shaded';

export class HeightmapOverlay {
  private map: maplibregl.Map;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private hm: Heightmap | null = null;
  private rangeMin = 0;
  private rangeMax = 1;
  private mode: DisplayMode = 'ramp';
  private sun: SunParams = { ...DEFAULT_SUN };

  constructor(map: maplibregl.Map, canvas: HTMLCanvasElement) {
    this.map = map;
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D context on heightmap canvas');
    this.ctx = ctx;
  }

  attach(hm: Heightmap) {
    this.hm = hm;
    this.canvas.width = hm.width;
    this.canvas.height = hm.height;
    this.canvas.id = 'heightmap-canvas';
    this.detach();

    const b = hm.bboxLngLat;
    this.map.addSource(SOURCE_ID, {
      type: 'canvas',
      canvas: this.canvas,
      coordinates: [
        [b.west, b.north],
        [b.east, b.north],
        [b.east, b.south],
        [b.west, b.south],
      ],
      animate: true,
    });
    // Insert below the first existing layer so the basemap renders on top of the DEM.
    const firstLayer = this.map.getStyle().layers?.[0]?.id;
    this.map.addLayer({
      id: LAYER_ID,
      type: 'raster',
      source: SOURCE_ID,
      paint: { 'raster-opacity': 1.0, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 },
    }, firstLayer);
    this.repaintAll();
  }

  detach() {
    if (this.map.getLayer(LAYER_ID)) this.map.removeLayer(LAYER_ID);
    if (this.map.getSource(SOURCE_ID)) this.map.removeSource(SOURCE_ID);
  }

  setOpacity(o: number) {
    if (this.map.getLayer(LAYER_ID)) {
      this.map.setPaintProperty(LAYER_ID, 'raster-opacity', o);
    }
  }

  setDisplayMode(mode: DisplayMode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.repaintAll();
  }

  setSun(sun: Partial<SunParams>) {
    this.sun = { ...this.sun, ...sun };
    if (this.mode !== 'ramp') this.repaintAll();
  }

  repaintAll() {
    if (!this.hm) return;
    this.refreshRange();
    this.paintRect(0, 0, this.hm.width - 1, this.hm.height - 1);
    this.notifyDirty();
  }

  repaintRect(x0: number, y0: number, x1: number, y1: number) {
    if (!this.hm) return;
    // If the value range changed materially, repaint everything for consistent colors.
    const prevMin = this.rangeMin;
    const prevMax = this.rangeMax;
    this.refreshRange();
    if (Math.abs(prevMin - this.rangeMin) > 1e-3 || Math.abs(prevMax - this.rangeMax) > 1e-3) {
      this.paintRect(0, 0, this.hm.width - 1, this.hm.height - 1);
    } else {
      // Hillshade samples a 3x3 neighborhood, so neighbors of changed pixels also need recompute.
      const pad = this.mode === 'ramp' ? 0 : 1;
      const nx0 = Math.max(0, x0 - pad);
      const ny0 = Math.max(0, y0 - pad);
      const nx1 = Math.min(this.hm.width - 1, x1 + pad);
      const ny1 = Math.min(this.hm.height - 1, y1 + pad);
      this.paintRect(nx0, ny0, nx1, ny1);
    }
    this.notifyDirty();
  }

  private refreshRange() {
    if (!this.hm) return;
    const s = this.hm.stats();
    this.rangeMin = s.min;
    this.rangeMax = s.max;
    if (this.rangeMax - this.rangeMin < 1e-6) {
      this.rangeMax = this.rangeMin + 1;
    }
  }

  private paintRect(x0: number, y0: number, x1: number, y1: number) {
    if (!this.hm) return;
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    if (w <= 0 || h <= 0) return;
    const img = this.ctx.createImageData(w, h);
    const buf = img.data;
    const data = this.hm.data;
    const mask = this.hm.mask;
    const W = this.hm.width;
    const H = this.hm.height;
    const cellSize = this.hm.metersPerPixelX;
    const span = this.rangeMax - this.rangeMin;
    const isFlat = span <= 1e-6;
    let p = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const idx = y * W + x;
        if (!mask[idx]) {
          buf[p++] = 0; buf[p++] = 0; buf[p++] = 0; buf[p++] = 0;
          continue;
        }
        let r = 255, g = 255, b = 255;
        if (this.mode === 'hillshade') {
          const s = hillshadeAt(data, mask, W, H, x, y, cellSize, this.sun);
          r = g = b = s;
        } else {
          const v = data[idx];
          const t = isFlat ? 0.5 : (v - this.rangeMin) / span;
          [r, g, b] = ramp(t);
          if (this.mode === 'shaded') {
            const s = hillshadeAt(data, mask, W, H, x, y, cellSize, this.sun) / 255;
            // Mix toward gray slightly so shaded areas darken without crushing color.
            const k = 0.3 + 0.7 * s;
            r = r * k;
            g = g * k;
            b = b * k;
          }
        }
        buf[p++] = r;
        buf[p++] = g;
        buf[p++] = b;
        buf[p++] = 255;
      }
    }
    this.ctx.putImageData(img, x0, y0);
  }

  private notifyDirty() {
    // MapLibre canvas source samples on each frame; nudge a repaint.
    this.map.triggerRepaint();
  }
}
