// Minimal GeoTIFF writer (single strip, EPSG:3857). Supports Float32, Int16, Uint16, Uint8.
// TIFF spec: https://www.adobe.io/open/standards/TIFF.html
// GeoTIFF spec: https://docs.ogc.org/is/19-008r4/19-008r4.html

type SampleArray = Float32Array | Int16Array | Uint16Array | Uint8Array;

interface IfdEntry {
  tag: number;
  type: number;       // 3 SHORT, 4 LONG, 11 FLOAT, 12 DOUBLE, 2 ASCII
  count: number;
  values: number[];
  asciiValue?: string; // for type 2
}

const TYPE_SIZE: Record<number, number> = { 2: 1, 3: 2, 4: 4, 11: 4, 12: 8 };

export interface ExportParams {
  width: number;
  height: number;
  data: SampleArray;           // row-major, top-left origin (y=0 = north)
  bboxMerc: { minX: number; minY: number; maxX: number; maxY: number };
  metersPerPixelX: number;
  metersPerPixelY: number;
  noData?: number;             // optional, defaults to no NODATA tag
  epsg?: number;               // defaults to 3857
}

interface SampleSpec { bytes: number; bitsPerSample: number; sampleFormat: number }

function specFor(data: SampleArray): SampleSpec {
  if (data instanceof Float32Array) return { bytes: 4, bitsPerSample: 32, sampleFormat: 3 };
  if (data instanceof Int16Array)   return { bytes: 2, bitsPerSample: 16, sampleFormat: 2 };
  if (data instanceof Uint16Array)  return { bytes: 2, bitsPerSample: 16, sampleFormat: 1 };
  if (data instanceof Uint8Array)   return { bytes: 1, bitsPerSample: 8,  sampleFormat: 1 };
  throw new Error('Unsupported sample array type');
}

export function writeGeoTIFF(p: ExportParams): ArrayBuffer {
  const spec = specFor(p.data);
  const epsg = p.epsg ?? 3857;
  const stripByteCount = p.width * p.height * spec.bytes;

  // GeoKeyDirectory: header (4 SHORTs) + N keys × 4 SHORTs.
  const geoKeys: number[] = [
    1, 1, 0, 3,          // version 1.1.0, 3 keys
    1024, 0, 1, 1,       // GTModelTypeGeoKey -> 1 (Projected)
    1025, 0, 1, 1,       // GTRasterTypeGeoKey -> 1 (PixelIsArea)
    3072, 0, 1, epsg,    // ProjectedCSTypeGeoKey
  ];

  const noDataAscii = p.noData !== undefined ? `${p.noData}\0` : null;

  const entries: IfdEntry[] = [
    { tag: 256, type: 4, count: 1, values: [p.width] },                    // ImageWidth
    { tag: 257, type: 4, count: 1, values: [p.height] },                   // ImageLength
    { tag: 258, type: 3, count: 1, values: [spec.bitsPerSample] },         // BitsPerSample
    { tag: 259, type: 3, count: 1, values: [1] },                          // Compression: none
    { tag: 262, type: 3, count: 1, values: [1] },                          // PhotometricInterpretation: BlackIsZero
    { tag: 273, type: 4, count: 1, values: [0] },                          // StripOffsets (patched)
    { tag: 277, type: 3, count: 1, values: [1] },                          // SamplesPerPixel
    { tag: 278, type: 4, count: 1, values: [p.height] },                   // RowsPerStrip (whole image)
    { tag: 279, type: 4, count: 1, values: [stripByteCount] },             // StripByteCounts
    { tag: 284, type: 3, count: 1, values: [1] },                          // PlanarConfiguration: chunky
    { tag: 339, type: 3, count: 1, values: [spec.sampleFormat] },          // SampleFormat
    { tag: 33550, type: 12, count: 3, values: [p.metersPerPixelX, p.metersPerPixelY, 0] }, // ModelPixelScale
    { tag: 33922, type: 12, count: 6, values: [0, 0, 0, p.bboxMerc.minX, p.bboxMerc.maxY, 0] }, // ModelTiepoint
    { tag: 34735, type: 3, count: geoKeys.length, values: geoKeys },       // GeoKeyDirectory
  ];
  if (noDataAscii !== null) {
    entries.push({ tag: 42113, type: 2, count: noDataAscii.length, values: [], asciiValue: noDataAscii });
  }

  // Sort by tag (TIFF requires ascending tag order).
  entries.sort((a, b) => a.tag - b.tag);

  // Layout: header(8) + IFD + extData + raster.
  const ifdEntryBytes = entries.length * 12;
  const ifdBytes = 2 + ifdEntryBytes + 4; // count + entries + nextIFD

  // Compute extData section: each entry whose payload > 4 bytes is stored externally, ref'd by offset.
  // Build extData as a flat array of bytes; record per-entry offset.
  let extLen = 0;
  const extOffsets = new Map<number, number>(); // entry index -> offset within extData
  entries.forEach((e, i) => {
    const totalBytes = e.type === 2
      ? e.asciiValue!.length
      : e.count * TYPE_SIZE[e.type];
    if (totalBytes > 4) {
      // Pad to even for safety (TIFF likes word boundaries).
      if (extLen % 2 !== 0) extLen++;
      extOffsets.set(i, extLen);
      extLen += totalBytes;
    }
  });
  const headerBytes = 8;
  const ifdOffset = headerBytes;                 // IFD right after header
  const extOffsetBase = ifdOffset + ifdBytes;
  // Pad ext section so the raster strip lands on a 4-byte boundary (required for Float32 view).
  let stripOffset = extOffsetBase + extLen;
  while (stripOffset % 4 !== 0) {
    extLen++;
    stripOffset = extOffsetBase + extLen;
  }
  const total = stripOffset + stripByteCount;

  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);
  const LE = true;

  // --- TIFF header ---
  u8[0] = 0x49; u8[1] = 0x49;          // 'II' little endian
  view.setUint16(2, 42, LE);
  view.setUint32(4, ifdOffset, LE);

  // --- IFD ---
  let p2 = ifdOffset;
  view.setUint16(p2, entries.length, LE); p2 += 2;

  // Patch StripOffsets value to actual stripOffset.
  const stripIdx = entries.findIndex(e => e.tag === 273);
  entries[stripIdx].values = [stripOffset];

  entries.forEach((e, i) => {
    view.setUint16(p2, e.tag, LE);
    view.setUint16(p2 + 2, e.type, LE);
    view.setUint32(p2 + 4, e.count, LE);

    const totalBytes = e.type === 2
      ? e.asciiValue!.length
      : e.count * TYPE_SIZE[e.type];

    if (totalBytes <= 4) {
      // inline
      writeValuesInline(view, u8, p2 + 8, e);
    } else {
      const off = extOffsetBase + extOffsets.get(i)!;
      view.setUint32(p2 + 8, off, LE);
      writeValuesAt(view, u8, off, e);
    }
    p2 += 12;
  });
  view.setUint32(p2, 0, LE); // next IFD = 0

  // --- Raster: copy raw bytes regardless of sample type. ---
  const dst = new Uint8Array(buf, stripOffset, stripByteCount);
  const src = new Uint8Array(p.data.buffer, p.data.byteOffset, p.data.byteLength);
  dst.set(src);

  return buf;
}

// Back-compat alias.
export const writeFloat32GeoTIFF = writeGeoTIFF;

function writeValuesInline(view: DataView, u8: Uint8Array, offset: number, e: IfdEntry) {
  if (e.type === 2) {
    const s = e.asciiValue!;
    for (let i = 0; i < s.length && i < 4; i++) u8[offset + i] = s.charCodeAt(i);
    return;
  }
  writeValueArray(view, offset, e);
}

function writeValuesAt(view: DataView, u8: Uint8Array, offset: number, e: IfdEntry) {
  if (e.type === 2) {
    const s = e.asciiValue!;
    for (let i = 0; i < s.length; i++) u8[offset + i] = s.charCodeAt(i);
    return;
  }
  writeValueArray(view, offset, e);
}

function writeValueArray(view: DataView, offset: number, e: IfdEntry) {
  const LE = true;
  for (let i = 0; i < e.values.length; i++) {
    const v = e.values[i];
    switch (e.type) {
      case 3: view.setUint16(offset + i * 2, v, LE); break;
      case 4: view.setUint32(offset + i * 4, v, LE); break;
      case 11: view.setFloat32(offset + i * 4, v, LE); break;
      case 12: view.setFloat64(offset + i * 8, v, LE); break;
      default: throw new Error(`Unsupported TIFF type ${e.type}`);
    }
  }
}
