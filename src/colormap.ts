// Hypsometric-ish ramp from low (blue/green) to high (brown/white).
const STOPS: Array<[number, [number, number, number]]> = [
  [0.00, [38, 76, 110]],
  [0.10, [70, 130, 180]],
  [0.20, [120, 180, 140]],
  [0.45, [180, 200, 120]],
  [0.65, [180, 140, 90]],
  [0.85, [140, 100, 70]],
  [1.00, [240, 240, 240]],
];

export function ramp(t: number): [number, number, number] {
  if (t <= 0) return STOPS[0][1];
  if (t >= 1) return STOPS[STOPS.length - 1][1];
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [t0, c0] = STOPS[i];
    const [t1, c1] = STOPS[i + 1];
    if (t >= t0 && t <= t1) {
      const u = (t - t0) / (t1 - t0);
      return [
        c0[0] + (c1[0] - c0[0]) * u,
        c0[1] + (c1[1] - c0[1]) * u,
        c0[2] + (c1[2] - c0[2]) * u,
      ];
    }
  }
  return STOPS[STOPS.length - 1][1];
}
