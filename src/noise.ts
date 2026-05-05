// 2D value-gradient noise (Perlin-style) with deterministic permutation.
// Output range is roughly [-1, 1].

const perm = new Uint8Array(512);

(() => {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  // Lehmer LCG, fixed seed for reproducibility.
  let state = 0x9e3779b1 >>> 0;
  for (let i = 255; i > 0; i--) {
    state = ((state * 1103515245) + 12345) >>> 0;
    const j = state % (i + 1);
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
})();

const grad2: ReadonlyArray<readonly [number, number]> = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(t: number, a: number, b: number): number {
  return a + t * (b - a);
}

export function noise2(x: number, y: number): number {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = fade(xf);
  const v = fade(yf);
  const aa = perm[X + perm[Y]] & 7;
  const ab = perm[X + perm[Y + 1]] & 7;
  const ba = perm[X + 1 + perm[Y]] & 7;
  const bb = perm[X + 1 + perm[Y + 1]] & 7;
  const g_aa = grad2[aa]; const g_ba = grad2[ba];
  const g_ab = grad2[ab]; const g_bb = grad2[bb];
  const x1 = lerp(u, g_aa[0] * xf + g_aa[1] * yf,           g_ba[0] * (xf - 1) + g_ba[1] * yf);
  const x2 = lerp(u, g_ab[0] * xf + g_ab[1] * (yf - 1),     g_bb[0] * (xf - 1) + g_bb[1] * (yf - 1));
  return lerp(v, x1, x2);
}

// Fractal Brownian motion — sums multiple octaves.
export function fbm2(x: number, y: number, octaves: number, persistence = 0.5): number {
  let total = 0;
  let amp = 1;
  let freq = 1;
  let max = 0;
  for (let i = 0; i < octaves; i++) {
    total += noise2(x * freq, y * freq) * amp;
    max += amp;
    amp *= persistence;
    freq *= 2;
  }
  return total / max;
}
