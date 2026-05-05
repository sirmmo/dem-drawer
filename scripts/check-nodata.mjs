// Verify the NoData tag is written and round-trips through geotiff.js reader.
import { fromArrayBuffer } from 'geotiff';

const TYPE_SIZE = { 2: 1, 3: 2, 4: 4, 11: 4, 12: 8 };

function writeFloat32GeoTIFF(p) {
  const epsg = p.epsg ?? 3857;
  const stripByteCount = p.width * p.height * 4;
  const geoKeys = [1,1,0,3, 1024,0,1,1, 1025,0,1,1, 3072,0,1,epsg];
  const noDataAscii = p.noData !== undefined ? `${p.noData}\0` : null;
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
  if (noDataAscii !== null) {
    entries.push({ tag: 42113, type: 2, count: noDataAscii.length, values: [], asciiValue: noDataAscii });
  }
  entries.sort((a, b) => a.tag - b.tag);

  const ifdEntryBytes = entries.length * 12;
  const ifdBytes = 2 + ifdEntryBytes + 4;
  let extLen = 0;
  const extOffsets = new Map();
  entries.forEach((e, i) => {
    const total = e.type === 2 ? e.asciiValue.length : e.count * TYPE_SIZE[e.type];
    if (total > 4) { if (extLen % 2) extLen++; extOffsets.set(i, extLen); extLen += total; }
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

  u8[0] = 0x49; u8[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);

  let p2 = ifdOffset;
  view.setUint16(p2, entries.length, true); p2 += 2;
  const stripIdx = entries.findIndex(e => e.tag === 273);
  entries[stripIdx].values = [stripOffset];
  entries.forEach((e, i) => {
    view.setUint16(p2, e.tag, true);
    view.setUint16(p2 + 2, e.type, true);
    view.setUint32(p2 + 4, e.count, true);
    const totalBytes = e.type === 2 ? e.asciiValue.length : e.count * TYPE_SIZE[e.type];
    if (totalBytes <= 4) writeInline(view, u8, p2 + 8, e);
    else {
      const off = extOffsetBase + extOffsets.get(i);
      view.setUint32(p2 + 8, off, true);
      writeAt(view, u8, off, e);
    }
    p2 += 12;
  });
  view.setUint32(p2, 0, true);
  new Float32Array(buf, stripOffset, p.width * p.height).set(p.data);
  return buf;
}

function writeInline(view, u8, offset, e) {
  if (e.type === 2) {
    for (let i = 0; i < e.asciiValue.length && i < 4; i++) u8[offset + i] = e.asciiValue.charCodeAt(i);
    return;
  }
  for (let i = 0; i < e.values.length; i++) {
    if (e.type === 3) view.setUint16(offset + i*2, e.values[i], true);
    if (e.type === 4) view.setUint32(offset + i*4, e.values[i], true);
  }
}
function writeAt(view, u8, offset, e) {
  if (e.type === 2) {
    for (let i = 0; i < e.asciiValue.length; i++) u8[offset + i] = e.asciiValue.charCodeAt(i);
    return;
  }
  for (let i = 0; i < e.values.length; i++) {
    if (e.type === 3) view.setUint16(offset + i*2, e.values[i], true);
    if (e.type === 4) view.setUint32(offset + i*4, e.values[i], true);
    if (e.type === 12) view.setFloat64(offset + i*8, e.values[i], true);
  }
}

const W = 4, H = 3;
const data = new Float32Array([
  -9999, -9999, 30, 40,
  -9999, 60, 70, 80,
  90, 100, 110, -9999,
]);
const buf = writeFloat32GeoTIFF({
  width: W, height: H, data,
  bboxMerc: { minX: 0, minY: 0, maxX: 40, maxY: 30 },
  metersPerPixelX: 10, metersPerPixelY: 10,
  noData: -9999,
});

const tiff = await fromArrayBuffer(buf);
const img = await tiff.getImage();
const fd = img.fileDirectory;
console.log('GDAL_NODATA tag (42113):', JSON.stringify(fd.GDAL_NODATA));
const ok = fd.GDAL_NODATA && fd.GDAL_NODATA.replace(/\0/g, '').trim() === '-9999';
console.log('NoData tag matches "-9999":', ok);
process.exit(ok ? 0 : 1);
