import { useEffect, useRef, useState } from "react";
import type { Candidate, Place } from "./types";
import type { MapFocusPoint } from "./MapView";

type LatLngLiteral = { lat: number; lng: number };
type MapsListener = { remove: () => void };

interface GoogleMapInstance {
  fitBounds: (bounds: GoogleBoundsInstance, padding?: number) => void;
  panTo: (position: LatLngLiteral) => void;
  setZoom: (zoom: number) => void;
}

interface GoogleBoundsInstance {
  extend: (position: LatLngLiteral) => void;
}

interface GoogleMarkerInstance {
  addListener: (eventName: string, handler: () => void) => MapsListener;
  setMap: (map: GoogleMapInstance | null) => void;
}

interface GoogleInfoWindowInstance {
  close: () => void;
  open: (options: { anchor: GoogleMarkerInstance; map: GoogleMapInstance }) => void;
}

interface GooglePolylineInstance {
  setMap: (map: GoogleMapInstance | null) => void;
}

interface GoogleMapsApi {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMapInstance;
  Marker: new (options: Record<string, unknown>) => GoogleMarkerInstance;
  InfoWindow: new (options: { content: Node | string }) => GoogleInfoWindowInstance;
  LatLngBounds: new () => GoogleBoundsInstance;
  Polyline: new (options: Record<string, unknown>) => GooglePolylineInstance;
  SymbolPath: { CIRCLE: unknown };
  importLibrary: (library: string) => Promise<unknown>;
}

interface RouteResult {
  createPolylines: () => GooglePolylineInstance[];
}

interface RouteLibrary {
  Route: {
    computeRoutes: (request: Record<string, unknown>) => Promise<{ routes?: RouteResult[] }>;
  };
}

type MarkerEntry = { marker: GoogleMarkerInstance; info: GoogleInfoWindowInstance };

let googleMapsPromise: Promise<GoogleMapsApi> | null = null;

function googleMapsFromWindow() {
  return (window as unknown as { google?: { maps?: GoogleMapsApi } }).google?.maps;
}

function loadGoogleMaps(apiKey: string) {
  const loaded = googleMapsFromWindow();
  if (loaded) return Promise.resolve(loaded);
  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = new Promise<GoogleMapsApi>((resolve, reject) => {
    const callbackName = "__surabulGoogleMapsReady";
    const root = window as unknown as Record<string, unknown>;
    const script = document.createElement("script");
    root[callbackName] = () => {
      const maps = googleMapsFromWindow();
      delete root[callbackName];
      if (maps) resolve(maps);
      else reject(new Error("Google Maps API를 불러오지 못했습니다."));
    };
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&libraries=routes&language=ko&region=KR&loading=async&callback=${callbackName}`;
    script.async = true;
    script.onerror = () => {
      delete root[callbackName];
      googleMapsPromise = null;
      reject(new Error("Google Maps API 요청에 실패했습니다."));
    };
    document.head.appendChild(script);
  });
  return googleMapsPromise;
}

function coordinates(coords: [number, number]): LatLngLiteral {
  return { lat: coords[0], lng: coords[1] };
}

function popupContent(
  item: Candidate,
  status: "확정" | "후보",
  reviewUrl: string,
  commentCount?: number,
  onComment?: () => void,
) {
  const content = document.createElement("div");
  content.className = "map-popup-content google-map-popup";
  const copy = document.createElement("div");
  copy.className = "map-popup-copy";
  const title = document.createElement("strong");
  title.textContent = item.title;
  const meta = document.createElement("small");
  meta.textContent = `${status} · ${item.time}`;
  copy.append(title, meta);
  if (item.note) {
    const note = document.createElement("p");
    note.className = "map-popup-note";
    note.textContent = item.note;
    copy.append(note);
  }

  const actions = document.createElement("div");
  actions.className = "map-popup-actions";
  const review = document.createElement("a");
  review.href = reviewUrl;
  review.target = "_blank";
  review.rel = "noreferrer";
  review.textContent = "Google 리뷰 ↗";
  actions.append(review);
  if (onComment) {
    const comment = document.createElement("button");
    comment.type = "button";
    comment.textContent = `댓글 ${commentCount ?? 0}`;
    comment.addEventListener("click", onComment);
    actions.append(comment);
  }
  content.append(copy, actions);
  return content;
}

export default function GoogleMapView({
  apiKey,
  places,
  selectedId,
  focusPoint,
  onSelect,
  onComment,
  commentCounts,
  getReviewUrl,
}: {
  apiKey: string;
  places: Place[];
  selectedId: string;
  focusPoint: MapFocusPoint | null;
  onSelect: (id: string) => void;
  onComment: (id: string) => void;
  commentCounts: Record<string, number>;
  getReviewUrl: (place: Pick<Candidate, "title" | "coords" | "googleMapsUrl">) => string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GoogleMapInstance | null>(null);
  const markersRef = useRef<Record<string, MarkerEntry>>({});
  const polylinesRef = useRef<GooglePolylineInstance[]>([]);
  const [readyToken, setReadyToken] = useState(0);
  const [mapError, setMapError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const listeners: MapsListener[] = [];
    const initialize = async () => {
      if (!containerRef.current) return;
      try {
        const maps = await loadGoogleMaps(apiKey);
        if (cancelled || !containerRef.current) return;
        const first = coordinates(places[0]?.coords ?? [10.2899, 103.984]);
        const map = new maps.Map(containerRef.current, {
          center: first,
          zoom: 12,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          gestureHandling: "greedy",
        });
        const bounds = new maps.LatLngBounds();
        mapRef.current = map;
        markersRef.current = {};

        places.forEach((place, index) => {
          const position = coordinates(place.coords);
          bounds.extend(position);
          const marker = new maps.Marker({
            map,
            position,
            title: place.title,
            label: { text: String(index + 1), color: "#ffffff", fontWeight: "700" },
          });
          const info = new maps.InfoWindow({
            content: popupContent(place, "확정", getReviewUrl(place), commentCounts[place.id] ?? 0, () => onComment(place.id)),
          });
          listeners.push(marker.addListener("click", () => {
            onSelect(place.id);
            info.open({ map, anchor: marker });
          }));
          markersRef.current[place.id] = { marker, info };

          place.alternatives.forEach((candidate) => {
            const candidatePosition = coordinates(candidate.coords);
            bounds.extend(candidatePosition);
            const candidateMarker = new maps.Marker({
              map,
              position: candidatePosition,
              title: candidate.title,
              icon: {
                path: maps.SymbolPath.CIRCLE,
                scale: 7,
                fillColor: "#78909c",
                fillOpacity: 1,
                strokeColor: "#ffffff",
                strokeWeight: 2,
              },
            });
            const candidateInfo = new maps.InfoWindow({ content: popupContent(candidate, "후보", getReviewUrl(candidate)) });
            listeners.push(candidateMarker.addListener("click", () => {
              map.panTo(candidatePosition);
              map.setZoom(15);
              candidateInfo.open({ map, anchor: candidateMarker });
            }));
            markersRef.current[candidate.id] = { marker: candidateMarker, info: candidateInfo };
          });
        });

        if (places.length > 1) {
          try {
            const { Route } = await maps.importLibrary("routes") as RouteLibrary;
            const { routes } = await Route.computeRoutes({
              origin: coordinates(places[0].coords),
              destination: coordinates(places[places.length - 1].coords),
              intermediates: places.slice(1, -1).map((place) => ({ location: coordinates(place.coords) })),
              travelMode: "DRIVING",
              fields: ["path", "viewport", "distanceMeters", "durationMillis"],
            });
            if (!cancelled && routes?.[0]) {
              polylinesRef.current = routes[0].createPolylines();
              polylinesRef.current.forEach((polyline) => polyline.setMap(map));
            }
          } catch {
            const fallback = new maps.Polyline({
              map,
              path: places.map((place) => coordinates(place.coords)),
              strokeColor: "#ef765f",
              strokeOpacity: 0.9,
              strokeWeight: 4,
            });
            polylinesRef.current = [fallback];
          }
        }
        if (places.length > 1) map.fitBounds(bounds, 64);
        setMapError("");
        setReadyToken((value) => value + 1);
      } catch {
        if (!cancelled) setMapError("Google 지도를 불러오지 못했습니다. API 키와 허용 도메인을 확인해주세요.");
      }
    };
    void initialize();
    return () => {
      cancelled = true;
      listeners.forEach((listener) => listener.remove());
      Object.values(markersRef.current).forEach(({ marker, info }) => {
        info.close();
        marker.setMap(null);
      });
      polylinesRef.current.forEach((polyline) => polyline.setMap(null));
      markersRef.current = {};
      polylinesRef.current = [];
      mapRef.current = null;
    };
  }, [apiKey, commentCounts, getReviewUrl, onComment, onSelect, places]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyToken) return;
    const markerId = focusPoint?.id ?? selectedId;
    const position = focusPoint?.coords ?? places.find((place) => place.id === selectedId)?.coords;
    const entry = markersRef.current[markerId];
    if (!position || !entry) return;
    Object.values(markersRef.current).forEach(({ info }) => info.close());
    map.panTo(coordinates(position));
    map.setZoom(15);
    entry.info.open({ map, anchor: entry.marker });
  }, [focusPoint, places, readyToken, selectedId]);

  return <div className="google-map-shell"><div ref={containerRef} className="map-canvas" aria-label="Google Maps 여행 일정 경로 지도" />{mapError && <div className="map-api-error" role="alert">{mapError}</div>}</div>;
}
