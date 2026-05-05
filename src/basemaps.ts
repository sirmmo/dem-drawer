import type { StyleSpecification } from 'maplibre-gl';

export type Basemap =
  | { id: string; label: string; kind: 'raster'; tiles: string[]; tileSize?: number; attribution: string; maxzoom?: number }
  | { id: string; label: string; kind: 'vector-style'; styleUrl: string; attribution?: string };

export const BASEMAPS: Basemap[] = [
  {
    id: 'osm',
    label: 'OpenStreetMap',
    kind: 'raster',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    tileSize: 256,
    attribution: '© OpenStreetMap contributors',
    maxzoom: 19,
  },
  {
    id: 'opentopomap',
    label: 'OpenTopoMap',
    kind: 'raster',
    tiles: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png'],
    tileSize: 256,
    attribution: '© OpenTopoMap (CC-BY-SA), © OSM contributors, SRTM',
    maxzoom: 17,
  },
  {
    id: 'esri-imagery',
    label: 'Esri World Imagery',
    kind: 'raster',
    tiles: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 256,
    attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, USDA, USGS, AeroGRID, IGN',
    maxzoom: 19,
  },
  {
    id: 'carto-positron',
    label: 'CartoDB Positron',
    kind: 'raster',
    tiles: ['https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'],
    tileSize: 256,
    attribution: '© OSM contributors © CARTO',
    maxzoom: 20,
  },
  {
    id: 'carto-dark',
    label: 'CartoDB Dark Matter',
    kind: 'raster',
    tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
    tileSize: 256,
    attribution: '© OSM contributors © CARTO',
    maxzoom: 20,
  },
  {
    id: 'maplibre-demo',
    label: 'MapLibre Demo (vector)',
    kind: 'vector-style',
    styleUrl: 'https://demotiles.maplibre.org/style.json',
    attribution: '© MapLibre',
  },
  {
    id: 'osm-liberty',
    label: 'OSM Liberty (vector via OpenFreeMap)',
    kind: 'vector-style',
    styleUrl: 'https://tiles.openfreemap.org/styles/liberty',
    attribution: '© OpenFreeMap, © OSM contributors',
  },
];

export function rasterStyle(b: Extract<Basemap, { kind: 'raster' }>): StyleSpecification {
  return {
    version: 8,
    sources: {
      basemap: {
        type: 'raster',
        tiles: b.tiles,
        tileSize: b.tileSize ?? 256,
        attribution: b.attribution,
        maxzoom: b.maxzoom ?? 19,
      },
    },
    layers: [
      { id: 'basemap', type: 'raster', source: 'basemap' },
    ],
  };
}

export function customRasterBasemap(url: string): Basemap {
  return {
    id: 'custom',
    label: 'Custom raster',
    kind: 'raster',
    tiles: [url],
    tileSize: 256,
    attribution: 'Custom source',
    maxzoom: 22,
  };
}

export function customVectorBasemap(url: string): Basemap {
  return {
    id: 'custom',
    label: 'Custom vector',
    kind: 'vector-style',
    styleUrl: url,
    attribution: 'Custom source',
  };
}
