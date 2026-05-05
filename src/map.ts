import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Basemap, rasterStyle } from './basemaps';

export function createMap(container: string, basemap: Basemap): maplibregl.Map {
  const style = basemap.kind === 'raster' ? rasterStyle(basemap) : basemap.styleUrl;
  const map = new maplibregl.Map({
    container,
    style,
    center: [12.4964, 41.9028],
    zoom: 5,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-left');
  return map;
}

export function setBasemap(map: maplibregl.Map, basemap: Basemap, preserveOverlay: () => void) {
  const style = basemap.kind === 'raster' ? rasterStyle(basemap) : basemap.styleUrl;
  map.setStyle(style);
  map.once('styledata', preserveOverlay);
}
