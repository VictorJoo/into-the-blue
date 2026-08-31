const MAPBOX_GL_VERSION = "3.26.0";
const SCRIPT_ID = "mapbox-gl-js";
const STYLE_ID = "mapbox-gl-css";

export type LngLat = [number, number];

export type RouteGeoJson = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: "LineString"; coordinates: LngLat[] };
};

export interface MapboxGeoJsonSource {
  setData(data: RouteGeoJson): void;
}

export interface MapboxMap {
  addControl(control: unknown, position?: string): void;
  addLayer(layer: Record<string, unknown>): void;
  addSource(id: string, source: Record<string, unknown>): void;
  fitBounds(bounds: MapboxBounds, options?: Record<string, unknown>): void;
  flyTo(options: Record<string, unknown>): void;
  getLayer(id: string): unknown;
  getSource(id: string): MapboxGeoJsonSource | undefined;
  isStyleLoaded(): boolean;
  on(event: string, listener: () => void): void;
  once(event: string, listener: () => void): void;
  remove(): void;
}

export interface MapboxBounds {
  extend(point: LngLat): MapboxBounds;
}

export interface MapboxPopup {
  setDOMContent(element: HTMLElement): MapboxPopup;
}

export interface MapboxMarker {
  addTo(map: MapboxMap): MapboxMarker;
  getElement(): HTMLElement;
  remove(): void;
  setLngLat(point: LngLat): MapboxMarker;
  setPopup(popup: MapboxPopup): MapboxMarker;
  togglePopup(): MapboxMarker;
}

export interface MapboxGl {
  accessToken: string;
  Map: new (options: Record<string, unknown>) => MapboxMap;
  Marker: new (options?: Record<string, unknown>) => MapboxMarker;
  Popup: new (options?: Record<string, unknown>) => MapboxPopup;
  LngLatBounds: new (southwest?: LngLat, northeast?: LngLat) => MapboxBounds;
  NavigationControl: new (options?: Record<string, unknown>) => unknown;
}

declare global {
  interface Window {
    mapboxgl?: MapboxGl;
  }
}

let loader: Promise<MapboxGl> | null = null;

export function loadMapboxGl() {
  if (window.mapboxgl) return Promise.resolve(window.mapboxgl);
  if (loader) return loader;

  loader = new Promise<MapboxGl>((resolve, reject) => {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("link");
      style.id = STYLE_ID;
      style.rel = "stylesheet";
      style.href = `https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_GL_VERSION}/mapbox-gl.css`;
      document.head.append(style);
    }

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    const loaded = () => window.mapboxgl ? resolve(window.mapboxgl) : reject(new Error("Mapbox GL JS를 초기화하지 못했습니다."));
    script.addEventListener("load", loaded, { once: true });
    script.addEventListener("error", () => reject(new Error("Mapbox GL JS CDN을 불러오지 못했습니다.")), { once: true });
    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = `https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_GL_VERSION}/mapbox-gl.js`;
      script.defer = true;
      document.head.append(script);
    }
  });

  return loader;
}
