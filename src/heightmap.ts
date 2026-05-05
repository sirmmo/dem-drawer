export interface MercatorBBox {
  minX: number; // EPSG:3857 meters
  minY: number;
  maxX: number;
  maxY: number;
}

export interface LngLatBBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export class Heightmap {
  readonly width: number;
  readonly height: number;
  readonly bboxMerc: MercatorBBox;
  readonly bboxLngLat: LngLatBBox;
  readonly metersPerPixelX: number;
  readonly metersPerPixelY: number;
  data: Float32Array;
  mask: Uint8Array;            // 1 if the pixel has been touched by a brush, else 0

  constructor(width: number, height: number, bboxMerc: MercatorBBox, bboxLngLat: LngLatBBox) {
    this.width = width;
    this.height = height;
    this.bboxMerc = bboxMerc;
    this.bboxLngLat = bboxLngLat;
    this.metersPerPixelX = (bboxMerc.maxX - bboxMerc.minX) / width;
    this.metersPerPixelY = (bboxMerc.maxY - bboxMerc.minY) / height;
    this.data = new Float32Array(width * height);
    this.mask = new Uint8Array(width * height);
  }

  reset() {
    this.data.fill(0);
    this.mask.fill(0);
  }

  // Convert lng/lat to pixel (col,row); row 0 is top (north).
  lngLatToPixel(lng: number, lat: number): { x: number; y: number } {
    const merc = lngLatToMercator(lng, lat);
    const x = (merc.x - this.bboxMerc.minX) / this.metersPerPixelX;
    const y = (this.bboxMerc.maxY - merc.y) / this.metersPerPixelY;
    return { x, y };
  }

  pixelToLngLat(x: number, y: number): { lng: number; lat: number } {
    const mx = this.bboxMerc.minX + x * this.metersPerPixelX;
    const my = this.bboxMerc.maxY - y * this.metersPerPixelY;
    return mercatorToLngLat(mx, my);
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.data[y * this.width + x];
  }

  stats(): { min: number; max: number; mean: number; touched: number } {
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let touched = 0;
    for (let i = 0; i < this.data.length; i++) {
      if (!this.mask[i]) continue;
      const v = this.data[i];
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      touched++;
    }
    if (touched === 0) return { min: 0, max: 0, mean: 0, touched: 0 };
    return { min, max, mean: sum / touched, touched };
  }
}

const R = 6378137;

export function lngLatToMercator(lng: number, lat: number): { x: number; y: number } {
  const x = (lng * Math.PI / 180) * R;
  const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2)) * R;
  return { x, y };
}

export function mercatorToLngLat(x: number, y: number): { lng: number; lat: number } {
  const lng = (x / R) * 180 / Math.PI;
  const lat = (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI;
  return { lng, lat };
}
