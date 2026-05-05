import maplibregl from 'maplibre-gl';

// Layer types and their opacity-style paint property.
const OPACITY_PROPS: Record<string, string[]> = {
  background: ['background-opacity'],
  fill: ['fill-opacity'],
  line: ['line-opacity'],
  symbol: ['icon-opacity', 'text-opacity'],
  circle: ['circle-opacity', 'circle-stroke-opacity'],
  raster: ['raster-opacity'],
  heatmap: ['heatmap-opacity'],
  'fill-extrusion': ['fill-extrusion-opacity'],
  hillshade: [], // no direct opacity control
};

const DEM_LAYER_ID = 'dem-overlay-layer';

// Cache of original paint values per layer/property so we can restore them when the slider goes back to 1.
type Original = Map<string, Map<string, unknown>>;
const originalCache = new WeakMap<maplibregl.Map, Original>();

function ensureCache(map: maplibregl.Map): Original {
  let c = originalCache.get(map);
  if (!c) {
    c = new Map();
    originalCache.set(map, c);
  }
  return c;
}

export function setBasemapOpacity(map: maplibregl.Map, opacity: number) {
  const style = map.getStyle();
  if (!style?.layers) return;
  const cache = ensureCache(map);
  for (const layer of style.layers) {
    if (layer.id === DEM_LAYER_ID) continue;
    const props = OPACITY_PROPS[layer.type];
    if (!props) continue;
    let layerCache = cache.get(layer.id);
    if (!layerCache) {
      layerCache = new Map();
      cache.set(layer.id, layerCache);
    }
    for (const prop of props) {
      // Snapshot the original (style-defined) value the first time we touch it.
      if (!layerCache.has(prop)) {
        const current = map.getPaintProperty(layer.id, prop as never);
        layerCache.set(prop, current);
      }
      const original = layerCache.get(prop);
      const scaled = scaleOpacity(original, opacity);
      try {
        map.setPaintProperty(layer.id, prop as never, scaled as never);
      } catch {
        // Some property/layer combos reject — ignore.
      }
    }
  }
}

// If the original is undefined we treat as 1. If it's a number, multiply. If it's an expression, wrap in ["*", expr, opacity].
function scaleOpacity(original: unknown, factor: number): unknown {
  if (original === undefined || original === null) return factor;
  if (typeof original === 'number') return original * factor;
  // Expression-based: multiply by factor.
  return ['*', original, factor];
}

export function clearOpacityCache(map: maplibregl.Map) {
  originalCache.delete(map);
}
