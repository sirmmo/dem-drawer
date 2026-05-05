import { Heightmap } from './heightmap';
import { fbm2 } from './noise';

export type BrushMode = 'raise' | 'lower' | 'smooth' | 'flatten' | 'noise';

export interface BrushParams {
  mode: BrushMode;
  radiusMeters: number;
  strength: number;     // meters per stroke step (raise/lower/noise) or weight 0..1 for smooth
  hardness: number;     // 0 = soft falloff, 1 = hard edge
  flattenTarget: number;
  noiseFeatureMeters: number; // wavelength of the fundamental octave
  noiseOctaves: number;
}

// Apply brush at pixel-space center (cx, cy). Each call is one "stamp".
// Returns the dirty rect (inclusive).
export function applyBrush(
  hm: Heightmap,
  cx: number,
  cy: number,
  p: BrushParams,
): { x0: number; y0: number; x1: number; y1: number } | null {
  const radiusPx = Math.max(p.radiusMeters / hm.metersPerPixelX, 1);
  const x0 = Math.max(0, Math.floor(cx - radiusPx));
  const y0 = Math.max(0, Math.floor(cy - radiusPx));
  const x1 = Math.min(hm.width - 1, Math.ceil(cx + radiusPx));
  const y1 = Math.min(hm.height - 1, Math.ceil(cy + radiusPx));
  if (x0 > x1 || y0 > y1) return null;

  const r2 = radiusPx * radiusPx;
  const hardness = Math.min(Math.max(p.hardness, 0), 1);
  // Inner radius (full strength) vs outer falloff edge.
  const innerRatio = hardness; // hardness 1 -> step function, 0 -> full falloff
  const data = hm.data;
  const w = hm.width;

  const mask = hm.mask;

  if (p.mode === 'noise') {
    // Sample noise in world space (meters) so the feature size is independent of
    // the heightmap resolution. fbm2 returns ~[-1, 1].
    const inv = 1 / Math.max(p.noiseFeatureMeters, 1);
    const mppX = hm.metersPerPixelX;
    const mppY = hm.metersPerPixelY;
    const octaves = Math.max(1, Math.min(8, Math.round(p.noiseOctaves)));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const f = falloff(Math.sqrt(d2) / radiusPx, innerRatio);
        const wx = x * mppX * inv;
        const wy = y * mppY * inv;
        const n = fbm2(wx, wy, octaves);
        const idx = y * w + x;
        data[idx] += p.strength * f * n;
        mask[idx] = 1;
      }
    }
    return { x0, y0, x1, y1 };
  }

  if (p.mode === 'smooth') {
    // 3x3 box blur weighted by falloff.
    const tmp = new Float32Array((x1 - x0 + 1) * (y1 - y0 + 1));
    const tw = x1 - x0 + 1;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        let sum = 0;
        let cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= hm.width || ny >= hm.height) continue;
            sum += data[ny * w + nx];
            cnt++;
          }
        }
        tmp[(y - y0) * tw + (x - x0)] = sum / cnt;
      }
    }
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const f = falloff(Math.sqrt(d2) / radiusPx, innerRatio);
        const idx = y * w + x;
        const blurred = tmp[(y - y0) * tw + (x - x0)];
        data[idx] = data[idx] * (1 - f * p.strength) + blurred * f * p.strength;
        mask[idx] = 1;
      }
    }
    return { x0, y0, x1, y1 };
  }

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const f = falloff(Math.sqrt(d2) / radiusPx, innerRatio);
      const idx = y * w + x;
      switch (p.mode) {
        case 'raise':
          data[idx] += p.strength * f;
          break;
        case 'lower':
          data[idx] -= p.strength * f;
          break;
        case 'flatten': {
          const blend = Math.min(1, f * Math.max(p.strength, 0.05));
          data[idx] = data[idx] * (1 - blend) + p.flattenTarget * blend;
          break;
        }
      }
      mask[idx] = 1;
    }
  }
  return { x0, y0, x1, y1 };
}

function falloff(t: number, innerRatio: number): number {
  // t in [0..1], returns weight in [0..1]
  if (t <= innerRatio) return 1;
  const u = (t - innerRatio) / (1 - innerRatio);
  // smoothstep
  return 1 - u * u * (3 - 2 * u);
}

// Walk a line of stamps between two points so fast cursor movement still paints continuously.
export function strokeLine(
  hm: Heightmap,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  p: BrushParams,
  spacingPx: number,
): { x0: number; y0: number; x1: number; y1: number } | null {
  const dx = bx - ax;
  const dy = by - ay;
  const dist = Math.hypot(dx, dy);
  const step = Math.max(spacingPx, 0.5);
  const n = Math.max(1, Math.ceil(dist / step));
  let acc: { x0: number; y0: number; x1: number; y1: number } | null = null;
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    const x = ax + dx * t;
    const y = ay + dy * t;
    const r = applyBrush(hm, x, y, p);
    if (!r) continue;
    if (!acc) acc = r;
    else {
      acc.x0 = Math.min(acc.x0, r.x0);
      acc.y0 = Math.min(acc.y0, r.y0);
      acc.x1 = Math.max(acc.x1, r.x1);
      acc.y1 = Math.max(acc.y1, r.y1);
    }
  }
  return acc;
}
