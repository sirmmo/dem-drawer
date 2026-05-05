import maplibregl from 'maplibre-gl';

export interface ControlPoint {
  id: string;
  lng: number;
  lat: number;
  elevation: number;
}

export class ControlPointManager {
  private map: maplibregl.Map;
  private points: Map<string, { cp: ControlPoint; marker: maplibregl.Marker }> = new Map();
  private listEl: HTMLElement;
  private onChange: () => void;

  constructor(map: maplibregl.Map, listEl: HTMLElement, onChange: () => void) {
    this.map = map;
    this.listEl = listEl;
    this.onChange = onChange;
    this.refreshList();
  }

  list(): ControlPoint[] {
    return Array.from(this.points.values()).map((v) => v.cp);
  }

  count(): number {
    return this.points.size;
  }

  add(lng: number, lat: number, elevation: number) {
    const id = `cp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const el = document.createElement('div');
    el.className = 'cp-marker';
    el.textContent = `${Math.round(elevation)}m`;
    el.title = 'Click to remove';
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.remove(id);
    });
    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([lng, lat])
      .addTo(this.map);
    this.points.set(id, { cp: { id, lng, lat, elevation }, marker });
    this.refreshList();
    this.onChange();
  }

  remove(id: string) {
    const v = this.points.get(id);
    if (!v) return;
    v.marker.remove();
    this.points.delete(id);
    this.refreshList();
    this.onChange();
  }

  clear() {
    for (const v of this.points.values()) v.marker.remove();
    this.points.clear();
    this.refreshList();
    this.onChange();
  }

  private refreshList() {
    this.listEl.innerHTML = '';
    if (this.points.size === 0) {
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = 'No control points yet';
      this.listEl.appendChild(empty);
      return;
    }
    for (const { cp } of this.points.values()) {
      const row = document.createElement('div');
      row.className = 'cp-row';

      const label = document.createElement('span');
      label.className = 'cp-label';
      label.textContent = `${cp.lng.toFixed(3)}, ${cp.lat.toFixed(3)} → ${cp.elevation.toFixed(0)} m`;

      const del = document.createElement('button');
      del.textContent = '×';
      del.className = 'cp-del';
      del.title = 'Remove';
      del.addEventListener('click', () => this.remove(cp.id));

      row.appendChild(label);
      row.appendChild(del);
      this.listEl.appendChild(row);
    }
  }
}
