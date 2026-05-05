import { Heightmap } from './heightmap';
import { writeGeoTIFF } from './geotiff-write';

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

  const buf = writeGeoTIFF({
    width: hm.width,
    height: hm.height,
    data: out,
    bboxMerc: hm.bboxMerc,
    metersPerPixelX: hm.metersPerPixelX,
    metersPerPixelY: hm.metersPerPixelY,
    epsg: 3857,
    noData: opts.useNoData ? opts.noDataValue : undefined,
  });

  triggerDownload(new Blob([buf], { type: 'image/tiff' }), opts.filename ?? 'dem.tif');
}

// Int16 GeoTIFF: integer meters, NoData = -32768. The classic "DEM raster".
export function exportInt16GeoTIFF(hm: Heightmap, opts: { smoothPasses: number; useNoData: boolean; filename?: string }) {
  const NO_DATA = -32768;
  const smoothed = opts.smoothPasses > 0 ? smoothPainted(hm, opts.smoothPasses) : hm.data;
  const out = new Int16Array(hm.width * hm.height);
  const fill = opts.useNoData ? NO_DATA : 0;
  for (let i = 0; i < out.length; i++) {
    if (!hm.mask[i]) {
      out[i] = fill;
    } else {
      // Clamp into Int16 range so weird values don't wrap.
      const v = Math.round(smoothed[i]);
      out[i] = v < -32767 ? -32767 : v > 32767 ? 32767 : v;
    }
  }
  const buf = writeGeoTIFF({
    width: hm.width,
    height: hm.height,
    data: out,
    bboxMerc: hm.bboxMerc,
    metersPerPixelX: hm.metersPerPixelX,
    metersPerPixelY: hm.metersPerPixelY,
    epsg: 3857,
    noData: opts.useNoData ? NO_DATA : undefined,
  });
  triggerDownload(new Blob([buf], { type: 'image/tiff' }), opts.filename ?? 'dem-int16.tif');
}

// 8-bit grayscale PNG: normalized to [min, max] of painted region. Range is
// embedded in the filename (e.g. dem-grayscale_min-3.0_max142.5.png) so callers
// can recover absolute meters.
export function exportGrayscalePNG(hm: Heightmap, opts: { smoothPasses: number; transparentUnpainted: boolean; filenameBase?: string }): Promise<void> {
  const smoothed = opts.smoothPasses > 0 ? smoothPainted(hm, opts.smoothPasses) : hm.data;
  const stats = hm.stats();
  const min = stats.min;
  const max = stats.touched > 0 ? Math.max(stats.max, min + 1e-6) : 1;
  const span = max - min;

  const canvas = document.createElement('canvas');
  canvas.width = hm.width;
  canvas.height = hm.height;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(hm.width, hm.height);
  const buf = img.data;
  for (let i = 0; i < hm.data.length; i++) {
    const idx = i * 4;
    if (!hm.mask[i]) {
      if (opts.transparentUnpainted) {
        buf[idx] = 0; buf[idx + 1] = 0; buf[idx + 2] = 0; buf[idx + 3] = 0;
      } else {
        buf[idx] = 0; buf[idx + 1] = 0; buf[idx + 2] = 0; buf[idx + 3] = 255;
      }
    } else {
      const t = (smoothed[i] - min) / span;
      const v = Math.max(0, Math.min(255, Math.round(t * 255)));
      buf[idx] = v;
      buf[idx + 1] = v;
      buf[idx + 2] = v;
      buf[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) return resolve();
      const base = opts.filenameBase ?? 'dem-grayscale';
      const minStr = min.toFixed(2).replace(/\./g, '_');
      const maxStr = max.toFixed(2).replace(/\./g, '_');
      const name = `${base}_min${minStr}_max${maxStr}.png`;
      triggerDownload(blob, name);
      resolve();
    }, 'image/png');
  });
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
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
