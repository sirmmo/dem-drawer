import { Heightmap } from './heightmap';
import { ControlPoint } from './control-points';

// Inverse-distance-weighting interpolation: every pixel becomes a weighted
// blend of all control points where weight = 1 / d^power.
// Destructive — overwrites the entire heightmap and marks every pixel as touched.
export function applyIDW(hm: Heightmap, points: ControlPoint[], power = 2) {
  if (points.length === 0) return;

  const pxPoints = points.map((p) => {
    const px = hm.lngLatToPixel(p.lng, p.lat);
    return { x: px.x, y: px.y, z: p.elevation };
  });

  const W = hm.width;
  const H = hm.height;
  const halfPow = power / 2;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let exact = false;
      let exactZ = 0;
      let sum = 0;
      let wsum = 0;
      for (let i = 0; i < pxPoints.length; i++) {
        const p = pxPoints[i];
        const dx = x - p.x;
        const dy = y - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 0.25) {
          exact = true;
          exactZ = p.z;
          break;
        }
        const w = 1 / Math.pow(d2, halfPow);
        sum += w * p.z;
        wsum += w;
      }
      const idx = y * W + x;
      hm.data[idx] = exact ? exactZ : sum / wsum;
      hm.mask[idx] = 1;
    }
  }
}
