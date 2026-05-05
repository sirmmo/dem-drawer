import { Heightmap } from './heightmap';
import { writeFloat32GeoTIFF } from './geotiff-write';

export interface ExportOptions {
  smoothPasses: number;   // box-blur passes within painted region
  useNoData: boolean;     // write unpainted pixels as GDAL_NODATA instead of 0
  noDataValue: number;    // value to use for NoData (default -9999)
  filename?: string;
}

export function exportHeightmap(hm: Heightmap, opts: ExportOptions) {
  const smoothed = opts.smoothPasses > 0 ? smoothPainted(hm, opts.smoothPasses) : hm.data;

  // Build the final pixel array: painted pixels get the (smoothed) value,
  // unpainted pixels get either 0 or NoData.
  const out = new Float32Array(hm.width * hm.height);
  const fill = opts.useNoData ? opts.noDataValue : 0;
  for (let i = 0; i < out.length; i++) {
    out[i] = hm.mask[i] ? smoothed[i] : fill;
  }

  const buf = writeFloat32GeoTIFF({
    width: hm.width,
    height: hm.height,
    data: out,
    bboxMerc: hm.bboxMerc,
    metersPerPixelX: hm.metersPerPixelX,
    metersPerPixelY: hm.metersPerPixelY,
    epsg: 3857,
    noData: opts.useNoData ? opts.noDataValue : undefined,
  });

  const blob = new Blob([buf], { type: 'image/tiff' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = opts.filename ?? 'dem.tif';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// In-region 3x3 box blur: each painted pixel is averaged with its painted neighbors only,
// so the painted/unpainted boundary stays sharp while interior noise is smoothed away.
function smoothPainted(hm: Heightmap, passes: number): Float32Array {
  const W = hm.width;
  const H = hm.height;
  const m = hm.mask;
  let cur = new Float32Array(hm.data);
  let next = new Float32Array(W * H);

  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        if (!m[idx]) {
          next[idx] = cur[idx];
          continue;
        }
        let sum = 0;
        let cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const nidx = ny * W + nx;
            if (!m[nidx]) continue;
            sum += cur[nidx];
            cnt++;
          }
        }
        next[idx] = cnt > 0 ? sum / cnt : cur[idx];
      }
    }
    const tmp = cur;
    cur = next;
    next = tmp;
  }
  return cur;
}
