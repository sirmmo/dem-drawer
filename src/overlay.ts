import maplibregl from 'maplibre-gl';
import { Heightmap } from './heightmap';
import { ramp } from './colormap';

const SOURCE_ID = 'dem-overlay';
const LAYER_ID = 'dem-overlay-layer';

export class HeightmapOverlay {
  private map: maplibregl.Map;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private hm: Heightmap | null = null;
  private rangeMin = 0;
  private rangeMax = 1;

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
      this.paintRect(x0, y0, x1, y1);
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
        const v = data[idx];
        const t = isFlat ? 0.5 : (v - this.rangeMin) / span;
        const [r, g, b] = ramp(t);
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
