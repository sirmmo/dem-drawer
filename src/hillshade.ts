// Horn's algorithm for hillshading. Returns a 0..255 grayscale value.

export interface SunParams {
  azimuthDeg: number;   // 0=N, 90=E, 180=S, 270=W. Conventional GIS default: 315 (NW).
  altitudeDeg: number;  // 0=horizon, 90=overhead.
  zFactor: number;      // vertical exaggeration applied before slope calc.
}

export const DEFAULT_SUN: SunParams = {
  azimuthDeg: 315,
  altitudeDeg: 45,
  zFactor: 1,
};

export function hillshadeAt(
  data: Float32Array,
  mask: Uint8Array,
  W: number,
  H: number,
  x: number,
  y: number,
  cellSize: number,
  sun: SunParams,
): number {
  const get = (xx: number, yy: number) => {
    if (xx < 0) xx = 0;
    else if (xx >= W) xx = W - 1;
    if (yy < 0) yy = 0;
    else if (yy >= H) yy = H - 1;
    const idx = yy * W + xx;
    return mask[idx] ? data[idx] : 0;
  };
  const a = get(x - 1, y - 1), b = get(x, y - 1), c = get(x + 1, y - 1);
  const d = get(x - 1, y),                          e = get(x + 1, y);
  const f = get(x - 1, y + 1), g = get(x, y + 1), h = get(x + 1, y + 1);

  const dzdx = ((c + 2 * e + h) - (a + 2 * d + f)) / (8 * cellSize);
  const dzdy = ((f + 2 * g + h) - (a + 2 * b + c)) / (8 * cellSize);

  const slope = Math.atan(sun.zFactor * Math.sqrt(dzdx * dzdx + dzdy * dzdy));
  let aspect = Math.atan2(dzdy, -dzdx);
  if (aspect < 0) aspect += 2 * Math.PI;

  const az = (sun.azimuthDeg * Math.PI) / 180;
  const zenith = ((90 - sun.altitudeDeg) * Math.PI) / 180;

  const shade =
    Math.cos(zenith) * Math.cos(slope) +
    Math.sin(zenith) * Math.sin(slope) * Math.cos(az - aspect);

  if (shade < 0) return 0;
  if (shade > 1) return 255;
  return Math.round(shade * 255);
}
