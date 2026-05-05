import maplibregl from 'maplibre-gl';
import { BASEMAPS, customRasterBasemap, customVectorBasemap, Basemap } from './basemaps';
import { createMap, setBasemap } from './map';
import { Heightmap } from './heightmap';
import { HeightmapOverlay } from './overlay';
import { applyBrush, BrushParams, strokeLine } from './brush';
import { pickBBox, buildHeightmap } from './extent';
import { exportHeightmap, exportInt16GeoTIFF, exportGrayscalePNG } from './export';
import { setBasemapOpacity, clearOpacityCache } from './basemap-opacity';
import { registerPaintedDemProtocol, attachTerrain, detachTerrain, refreshTerrain, setTerrainExaggeration } from './terrain-source';
import type { DisplayMode } from './overlay';
import { ControlPointManager } from './control-points';
import { applyIDW } from './idw';

interface AppState {
  map: maplibregl.Map;
  heightmap: Heightmap | null;
  overlay: HeightmapOverlay;
  brush: BrushParams;
  painting: boolean;
  paintMode: boolean;
  lastPxlPaint: { x: number; y: number } | null;
  basemap: Basemap;
  terrainOn: boolean;
  cps: ControlPointManager | null;
  cpMode: boolean;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function init() {
  const heightmapCanvas = $('heightmap-canvas') as HTMLCanvasElement;
  const initialBasemap = BASEMAPS[0];
  const map = createMap('map', initialBasemap);
  const overlay = new HeightmapOverlay(map, heightmapCanvas);

  const state: AppState = {
    map,
    heightmap: null,
    overlay,
    brush: {
      mode: 'raise',
      radiusMeters: 500,
      strength: 5,
      hardness: 0.5,
      flattenTarget: 100,
      noiseFeatureMeters: 500,
      noiseOctaves: 4,
    },
    painting: false,
    paintMode: false,
    lastPxlPaint: null,
    basemap: initialBasemap,
    terrainOn: false,
    cps: null,
    cpMode: false,
  };

  registerPaintedDemProtocol(() => state.heightmap);

  setupBasemapPicker(state);
  setupExtentControls(state);
  setupBrushControls(state);
  setupOverlayControls(state);
  setupExport(state);
  setupPaintModeToggle(state);
  setupPainting(state);
  setupCursorReadout(state);
  setupBrushCursorPreview(state);
  setupTerrainControls(state);
  setupDisplayMode(state);
  setupControlPoints(state);
}

function setupDisplayMode(state: AppState) {
  const select = $<HTMLSelectElement>('display-mode');
  select.addEventListener('change', () => {
    state.overlay.setDisplayMode(select.value as DisplayMode);
  });

  const az = $<HTMLInputElement>('sun-azimuth');
  const azVal = $('sun-azimuth-val');
  const alt = $<HTMLInputElement>('sun-altitude');
  const altVal = $('sun-altitude-val');
  const z = $<HTMLInputElement>('sun-zfactor');
  const apply = () => {
    azVal.textContent = az.value;
    altVal.textContent = alt.value;
    state.overlay.setSun({
      azimuthDeg: parseFloat(az.value),
      altitudeDeg: parseFloat(alt.value),
      zFactor: parseFloat(z.value) || 1,
    });
  };
  for (const el of [az, alt, z]) el.addEventListener('input', apply);
}

function setupControlPoints(state: AppState) {
  const listEl = $('cp-list');
  const toggle = $<HTMLButtonElement>('cp-toggle');
  const clearBtn = $<HTMLButtonElement>('cp-clear');
  const generate = $<HTMLButtonElement>('cp-generate');
  const power = $<HTMLInputElement>('cp-power');

  state.cps = new ControlPointManager(state.map, listEl, () => {});

  const applyMode = () => {
    toggle.textContent = state.cpMode ? 'Stop placing' : 'Place control points';
    toggle.classList.toggle('active', state.cpMode);
    state.map.getCanvas().style.cursor = state.cpMode ? 'crosshair' : '';
  };

  toggle.addEventListener('click', () => {
    if (state.paintMode) {
      // Don't fight the paint handler.
      $<HTMLButtonElement>('paint-toggle').click();
    }
    state.cpMode = !state.cpMode;
    applyMode();
  });

  clearBtn.addEventListener('click', () => {
    state.cps?.clear();
  });

  state.map.on('click', (e) => {
    if (!state.cpMode || !state.cps) return;
    const raw = window.prompt('Elevation in meters?', '100');
    if (raw === null) return;
    const z = parseFloat(raw);
    if (!isFinite(z)) return;
    state.cps.add(e.lngLat.lng, e.lngLat.lat, z);
  });

  generate.addEventListener('click', () => {
    if (!state.heightmap) {
      alert('Draw a bbox first.');
      return;
    }
    if (!state.cps || state.cps.count() < 2) {
      alert('Add at least 2 control points.');
      return;
    }
    const p = parseFloat(power.value) || 2;
    applyIDW(state.heightmap, state.cps.list(), p);
    state.overlay.repaintAll();
    if (state.terrainOn) refreshTerrain(state.map);
    updateStats(state);
  });
}

function setupTerrainControls(state: AppState) {
  const btn = $<HTMLButtonElement>('terrain-toggle');
  const exag = $<HTMLInputElement>('terrain-exag');
  const pitch = $<HTMLInputElement>('map-pitch');

  const apply = () => {
    btn.textContent = state.terrainOn ? 'Disable 3D' : 'Enable 3D';
    btn.classList.toggle('active', state.terrainOn);
  };

  btn.addEventListener('click', () => {
    if (!state.heightmap) {
      alert('Draw a bbox and paint something first.');
      return;
    }
    state.terrainOn = !state.terrainOn;
    if (state.terrainOn) {
      attachTerrain(state.map, state.heightmap, parseFloat(exag.value));
      // Auto-tilt so the user actually sees relief.
      if (state.map.getPitch() < 30) {
        state.map.easeTo({ pitch: 55, duration: 600 });
        pitch.value = '55';
      }
    } else {
      detachTerrain(state.map);
      state.map.easeTo({ pitch: 0, duration: 400 });
      pitch.value = '0';
    }
    apply();
  });

  exag.addEventListener('input', () => {
    setTerrainExaggeration(state.map, parseFloat(exag.value));
  });

  pitch.addEventListener('input', () => {
    state.map.setPitch(parseFloat(pitch.value));
  });
  state.map.on('pitch', () => {
    pitch.value = state.map.getPitch().toFixed(0);
  });

  apply();
}

function setupPaintModeToggle(state: AppState) {
  const btn = $<HTMLButtonElement>('paint-toggle');
  const apply = () => {
    btn.textContent = state.paintMode ? 'Exit paint mode' : 'Enter paint mode';
    btn.classList.toggle('active', state.paintMode);
    document.body.classList.toggle('paint-mode', state.paintMode);
    if (state.paintMode) {
      state.map.dragPan.disable();
      state.map.boxZoom.disable();
      state.map.doubleClickZoom.disable();
    } else {
      state.map.dragPan.enable();
      state.map.boxZoom.enable();
      state.map.doubleClickZoom.enable();
    }
    document.getElementById('brush-cursor')?.classList.toggle('hidden', !state.paintMode);
  };
  btn.addEventListener('click', () => {
    if (!state.heightmap && !state.paintMode) {
      alert('Draw a bbox first to set the canvas extent.');
      return;
    }
    state.paintMode = !state.paintMode;
    if (state.paintMode && state.cpMode) {
      // Exit CP mode so its map-click handler doesn't fire during paint.
      $<HTMLButtonElement>('cp-toggle').click();
    }
    apply();
  });
}

function setupBasemapPicker(state: AppState) {
  const select = $<HTMLSelectElement>('basemap-select');
  for (const b of BASEMAPS) {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = `${b.label} (${b.kind === 'raster' ? 'raster' : 'vector'})`;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => {
    const b = BASEMAPS.find(x => x.id === select.value);
    if (!b) return;
    state.basemap = b;
    setBasemap(state.map, b, () => reattachOverlay(state));
  });

  const customApply = $<HTMLButtonElement>('custom-apply');
  const customUrl = $<HTMLInputElement>('custom-url');
  const customType = $<HTMLSelectElement>('custom-type');
  customApply.addEventListener('click', () => {
    const url = customUrl.value.trim();
    if (!url) return;
    const b = customType.value === 'vector'
      ? customVectorBasemap(url)
      : customRasterBasemap(url);
    state.basemap = b;
    setBasemap(state.map, b, () => reattachOverlay(state));
    select.value = '';
  });
}

function reattachOverlay(state: AppState) {
  // The new style has different layer IDs, so the cached "original" values are invalid.
  clearOpacityCache(state.map);
  if (state.heightmap) {
    state.overlay.attach(state.heightmap);
  }
  // Reapply current basemap opacity to the new style's layers.
  const slider = $<HTMLInputElement>('basemap-opacity');
  setBasemapOpacity(state.map, parseFloat(slider.value));
  // setStyle wipes terrain + sources; restore if user had it on.
  if (state.terrainOn && state.heightmap) {
    const exag = parseFloat($<HTMLInputElement>('terrain-exag').value);
    attachTerrain(state.map, state.heightmap, exag);
  }
}

function setupExtentControls(state: AppState) {
  $<HTMLButtonElement>('draw-bbox').addEventListener('click', async () => {
    if (state.paintMode) {
      // Exit paint mode while picking bbox so map nav handlers don't fight us.
      $<HTMLButtonElement>('paint-toggle').click();
    }
    const ext = await pickBBox(state.map);
    if (!ext) return;
    const mpp = parseFloat(($<HTMLInputElement>('mpp')).value) || 20;
    const hm = buildHeightmap(ext, mpp);
    state.heightmap = hm;
    state.overlay.attach(hm);
    $('extent-info').textContent =
      `${hm.width}×${hm.height} px @ ${mpp} m/px • ` +
      `lng [${ext.west.toFixed(4)}, ${ext.east.toFixed(4)}] ` +
      `lat [${ext.south.toFixed(4)}, ${ext.north.toFixed(4)}]`;
    state.map.fitBounds(
      [[ext.west, ext.south], [ext.east, ext.north]],
      { padding: 60, duration: 600 },
    );
    if (state.terrainOn) {
      const exag = parseFloat($<HTMLInputElement>('terrain-exag').value);
      attachTerrain(state.map, hm, exag);
    }
    updateStats(state);
  });

  $<HTMLButtonElement>('clear-bbox').addEventListener('click', () => {
    state.heightmap = null;
    state.overlay.detach();
    $('extent-info').textContent = 'No extent set';
    updateStats(state);
  });
}

function setupBrushControls(state: AppState) {
  const mode = $<HTMLSelectElement>('brush-mode');
  const radius = $<HTMLInputElement>('brush-radius');
  const strength = $<HTMLInputElement>('brush-strength');
  const hardness = $<HTMLInputElement>('brush-hardness');
  const target = $<HTMLInputElement>('brush-target');
  const flattenRow = $('flatten-row');
  const noiseRows = $('noise-rows');
  const noiseFeature = $<HTMLInputElement>('brush-noise-feature');
  const noiseOctaves = $<HTMLInputElement>('brush-noise-octaves');

  const sync = () => {
    state.brush = {
      mode: mode.value as BrushParams['mode'],
      radiusMeters: parseFloat(radius.value) || 100,
      strength: parseFloat(strength.value) || 1,
      hardness: parseFloat(hardness.value) || 0,
      flattenTarget: parseFloat(target.value) || 0,
      noiseFeatureMeters: parseFloat(noiseFeature.value) || 500,
      noiseOctaves: parseFloat(noiseOctaves.value) || 4,
    };
    flattenRow.style.display = mode.value === 'flatten' ? 'flex' : 'none';
    noiseRows.style.display = mode.value === 'noise' ? 'block' : 'none';
  };

  for (const el of [mode, radius, strength, hardness, target, noiseFeature, noiseOctaves]) {
    el.addEventListener('input', sync);
    el.addEventListener('change', sync);
  }
  sync();
}

function setupOverlayControls(state: AppState) {
  const opacity = $<HTMLInputElement>('overlay-opacity');
  opacity.addEventListener('input', () => {
    state.overlay.setOpacity(parseFloat(opacity.value));
  });

  const baseOpacity = $<HTMLInputElement>('basemap-opacity');
  const applyBase = () => setBasemapOpacity(state.map, parseFloat(baseOpacity.value));
  baseOpacity.addEventListener('input', applyBase);
  // Run once after style load too.
  state.map.once('idle', applyBase);
}

function setupExport(state: AppState) {
  const readExportSettings = () => ({
    smoothPasses: Math.max(0, parseInt($<HTMLInputElement>('export-smooth').value, 10) || 0),
    useNoData: $<HTMLInputElement>('export-nodata').checked,
    noDataValue: parseFloat($<HTMLInputElement>('export-nodata-value').value) || -9999,
  });

  const requireHeightmap = () => {
    if (!state.heightmap) {
      alert('Set an extent first.');
      return false;
    }
    return true;
  };

  $<HTMLButtonElement>('export-btn').addEventListener('click', () => {
    if (!requireHeightmap()) return;
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const s = readExportSettings();
    exportHeightmap(state.heightmap!, {
      ...s,
      filename: `dem-${ts}.tif`,
    });
  });

  $<HTMLButtonElement>('export-int16-btn').addEventListener('click', () => {
    if (!requireHeightmap()) return;
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const s = readExportSettings();
    exportInt16GeoTIFF(state.heightmap!, {
      smoothPasses: s.smoothPasses,
      useNoData: s.useNoData,
      filename: `dem-int16-${ts}.tif`,
    });
  });

  $<HTMLButtonElement>('export-png-btn').addEventListener('click', () => {
    if (!requireHeightmap()) return;
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const s = readExportSettings();
    exportGrayscalePNG(state.heightmap!, {
      smoothPasses: s.smoothPasses,
      transparentUnpainted: s.useNoData,
      filenameBase: `dem-grayscale-${ts}`,
    });
  });

  $<HTMLButtonElement>('reset-btn').addEventListener('click', () => {
    if (!state.heightmap) return;
    state.heightmap.reset();
    state.overlay.repaintAll();
    if (state.terrainOn) refreshTerrain(state.map);
    updateStats(state);
  });
}

function setupPainting(state: AppState) {
  const canvas = state.map.getCanvas();

  const eventToPixel = (e: MouseEvent): { x: number; y: number } | null => {
    if (!state.heightmap) return null;
    const rect = canvas.getBoundingClientRect();
    const ll = state.map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
    return state.heightmap.lngLatToPixel(ll.lng, ll.lat);
  };

  const onDown = (e: MouseEvent) => {
    if (!state.paintMode || !state.heightmap) return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    state.painting = true;
    const px = eventToPixel(e);
    if (!px) return;
    state.lastPxlPaint = px;
    const r = applyBrush(state.heightmap, px.x, px.y, state.brush);
    if (r) state.overlay.repaintRect(r.x0, r.y0, r.x1, r.y1);
    updateStats(state);
  };

  const onMove = (e: MouseEvent) => {
    if (!state.painting || !state.heightmap || !state.lastPxlPaint) return;
    const px = eventToPixel(e);
    if (!px) return;
    const spacing = Math.max(state.brush.radiusMeters / state.heightmap.metersPerPixelX * 0.25, 0.5);
    const r = strokeLine(state.heightmap, state.lastPxlPaint.x, state.lastPxlPaint.y, px.x, px.y, state.brush, spacing);
    state.lastPxlPaint = px;
    if (r) state.overlay.repaintRect(r.x0, r.y0, r.x1, r.y1);
    updateStats(state);
  };

  const onUp = () => {
    if (state.painting && state.terrainOn) {
      refreshTerrain(state.map);
    }
    state.painting = false;
    state.lastPxlPaint = null;
  };

  canvas.addEventListener('mousedown', onDown, true);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function setupBrushCursorPreview(state: AppState) {
  const cursorEl = $('brush-cursor');
  const canvas = state.map.getCanvas();
  canvas.addEventListener('mousemove', (e) => {
    if (!state.paintMode || !state.heightmap) {
      cursorEl.classList.add('hidden');
      return;
    }
    const rect = canvas.getBoundingClientRect();
    // Project a point one brush-radius east of the cursor in lng/lat to convert meters → CSS px.
    const ll = state.map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
    // Use the heightmap's pixel scale (m/px) and the map's canvas-to-heightmap mapping.
    // Easier: project center + offset point in mercator and back to screen.
    const c = state.map.project(ll);
    const radiusMeters = state.brush.radiusMeters;
    const metersPerScreenPx = metersPerScreenPxAt(state.map, ll.lat);
    const radiusScreenPx = radiusMeters / metersPerScreenPx;
    cursorEl.classList.remove('hidden');
    cursorEl.style.left = `${c.x + rect.left}px`;
    cursorEl.style.top = `${c.y + rect.top}px`;
    cursorEl.style.width = `${radiusScreenPx * 2}px`;
    cursorEl.style.height = `${radiusScreenPx * 2}px`;
  });
  canvas.addEventListener('mouseleave', () => cursorEl.classList.add('hidden'));
}

function metersPerScreenPxAt(map: maplibregl.Map, lat: number): number {
  // Web Mercator: meters per pixel = 156543.03 * cos(lat) / 2^zoom
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, map.getZoom());
}

function setupCursorReadout(state: AppState) {
  const readout = $('cursor-readout');
  state.map.getCanvas().addEventListener('mousemove', (e) => {
    if (!state.heightmap) {
      readout.classList.add('hidden');
      return;
    }
    const rect = state.map.getCanvas().getBoundingClientRect();
    const ll = state.map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
    const px = state.heightmap.lngLatToPixel(ll.lng, ll.lat);
    const ix = Math.floor(px.x);
    const iy = Math.floor(px.y);
    if (ix < 0 || iy < 0 || ix >= state.heightmap.width || iy >= state.heightmap.height) {
      readout.classList.add('hidden');
      return;
    }
    readout.classList.remove('hidden');
    const z = state.heightmap.get(ix, iy);
    readout.textContent = `lng ${ll.lng.toFixed(5)}  lat ${ll.lat.toFixed(5)}  z ${z.toFixed(2)} m  (${ix},${iy})`;
  });
}

function updateStats(state: AppState) {
  const el = $('stats');
  if (!state.heightmap) {
    el.textContent = '—';
    return;
  }
  const s = state.heightmap.stats();
  if (s.touched === 0) {
    el.textContent = 'Nothing painted yet';
    return;
  }
  const total = state.heightmap.width * state.heightmap.height;
  const pct = ((s.touched / total) * 100).toFixed(1);
  el.textContent = `min ${s.min.toFixed(1)}  max ${s.max.toFixed(1)}  mean ${s.mean.toFixed(1)} m  (${pct}% painted)`;
}

init();
