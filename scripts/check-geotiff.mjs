// Run the writer and read it back with the geotiff reader to confirm it's valid.
import { fromArrayBuffer } from 'geotiff';

// Inline a JS port of writeFloat32GeoTIFF rather than transpiling TS — simpler for a quick check.
// Just write a 4×3 float32 grid and verify reader sees Float32, EPSG:3857, the geotransform,
// and the same values.

const TYPE_SIZE = { 2: 1, 3: 2, 4: 4, 11: 4, 12: 8 };

function writeFloat32GeoTIFF(p) {
  const epsg = p.epsg ?? 3857;
  const stripByteCount = p.width * p.height * 4;
  const geoKeys = [
    1, 1, 0, 3,
    1024, 0, 1, 1,
    1025, 0, 1, 1,
    3072, 0, 1, epsg,
  ];
  const entries = [
    { tag: 256, type: 4, count: 1, values: [p.width] },
    { tag: 257, type: 4, count: 1, values: [p.height] },
    { tag: 258, type: 3, count: 1, values: [32] },
    { tag: 259, type: 3, count: 1, values: [1] },
    { tag: 262, type: 3, count: 1, values: [1] },
    { tag: 273, type: 4, count: 1, values: [0] },
    { tag: 277, type: 3, count: 1, values: [1] },
    { tag: 278, type: 4, count: 1, values: [p.height] },
    { tag: 279, type: 4, count: 1, values: [stripByteCount] },
    { tag: 284, type: 3, count: 1, values: [1] },
    { tag: 339, type: 3, count: 1, values: [3] },
    { tag: 33550, type: 12, count: 3, values: [p.metersPerPixelX, p.metersPerPixelY, 0] },
    { tag: 33922, type: 12, count: 6, values: [0, 0, 0, p.bboxMerc.minX, p.bboxMerc.maxY, 0] },
    { tag: 34735, type: 3, count: geoKeys.length, values: geoKeys },
  ];
  entries.sort((a, b) => a.tag - b.tag);

  const ifdEntryBytes = entries.length * 12;
  const ifdBytes = 2 + ifdEntryBytes + 4;
  let extLen = 0;
  const extOffsets = new Map();
  entries.forEach((e, i) => {
    const totalBytes = e.count * TYPE_SIZE[e.type];
    if (totalBytes > 4) {
      if (extLen % 2) extLen++;
      extOffsets.set(i, extLen);
      extLen += totalBytes;
    }
  });
  const headerBytes = 8;
  const ifdOffset = headerBytes;
  const extOffsetBase = ifdOffset + ifdBytes;
  let stripOffset = extOffsetBase + extLen;
  while (stripOffset % 4 !== 0) { extLen++; stripOffset = extOffsetBase + extLen; }
  const total = stripOffset + stripByteCount;

  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);
  const LE = true;

  u8[0] = 0x49; u8[1] = 0x49;
  view.setUint16(2, 42, LE);
  view.setUint32(4, ifdOffset, LE);

  let p2 = ifdOffset;
  view.setUint16(p2, entries.length, LE); p2 += 2;
  const stripIdx = entries.findIndex(e => e.tag === 273);
  entries[stripIdx].values = [stripOffset];

  entries.forEach((e, i) => {
    view.setUint16(p2, e.tag, LE);
    view.setUint16(p2 + 2, e.type, LE);
    view.setUint32(p2 + 4, e.count, LE);
    const totalBytes = e.count * TYPE_SIZE[e.type];
    if (totalBytes <= 4) {
      writeArr(view, p2 + 8, e);
    } else {
      const off = extOffsetBase + extOffsets.get(i);
      view.setUint32(p2 + 8, off, LE);
      writeArr(view, off, e);
    }
    p2 += 12;
  });
  view.setUint32(p2, 0, LE);

  const out = new Float32Array(buf, stripOffset, p.width * p.height);
  out.set(p.data);
  return buf;
}

function writeArr(view, offset, e) {
  for (let i = 0; i < e.values.length; i++) {
    const v = e.values[i];
    switch (e.type) {
      case 3: view.setUint16(offset + i * 2, v, true); break;
      case 4: view.setUint32(offset + i * 4, v, true); break;
      case 12: view.setFloat64(offset + i * 8, v, true); break;
    }
  }
}

const W = 4, H = 3;
const data = new Float32Array([
  10, 20, 30, 40,
  50, 60, 70, 80,
  90, 100, 110, 120,
]);
const buf = writeFloat32GeoTIFF({
  width: W, height: H, data,
  bboxMerc: { minX: 1000000, minY: 5000000, maxX: 1000040, maxY: 5000030 },
  metersPerPixelX: 10, metersPerPixelY: 10,
});

const tiff = await fromArrayBuffer(buf);
const img = await tiff.getImage();
const pixels = await img.readRasters();
const fd = img.fileDirectory;

console.log('width', img.getWidth(), 'height', img.getHeight());
console.log('SampleFormat:', fd.SampleFormat, '(expect 3)');
console.log('BitsPerSample:', fd.BitsPerSample, '(expect 32)');
console.log('ModelTiepoint:', fd.ModelTiepoint);
console.log('ModelPixelScale:', fd.ModelPixelScale);
console.log('GeoKeys:', img.getGeoKeys());
console.log('Origin:', img.getOrigin());
console.log('Resolution:', img.getResolution());
console.log('BoundingBox:', img.getBoundingBox());
console.log('values[0]:', pixels[0].slice(0, 12));
const ok = Array.from(pixels[0]).every((v, i) => v === data[i]);
console.log('values match input:', ok);
process.exit(ok ? 0 : 1);
