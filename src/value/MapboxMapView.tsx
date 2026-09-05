import { useEffect, useMemo, useRef, useState } from "react";
import type { Candidate, MapSearchResult } from "../types";
import { placeCategory } from "../categories";
import type { MapViewProps } from "../MapView";
import { fetchDrivingRoute } from "./osrm";
import {
  loadMapboxGl,
  type LngLat,
  type MapboxGl,
  type MapboxMap,
  type MapboxMarker,
  type RouteGeoJson,
} from "./mapboxLoader";
import { useSharedLocations } from "./useSharedLocations";

const ROUTE_SOURCE = "value-osrm-route";
const ROUTE_OUTLINE = "value-osrm-route-outline";
const ROUTE_LINE = "value-osrm-route-line";

function lngLat(coords: [number, number]): LngLat {
  return [coords[1], coords[0]];
}

function markerElement(kind: "place" | "candidate" | "search", label: string, index?: number) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `value-map-marker is-${kind}`;
  button.setAttribute("aria-label", label);
  const text = document.createElement("span");
  text.textContent = typeof index === "number" ? String(index + 1) : kind === "search" ? "⌕" : "";
  button.append(text);
  return button;
}

function popupElement(
  item: Candidate,
  status: string,
  reviewUrl: string,
  commentCount: number,
  onComment: () => void,
  onEdit: () => void,
) {
  const root = document.createElement("div");
  root.className = "map-popup-content value-map-popup";
  const copy = document.createElement("div");
  copy.className = "map-popup-copy";
  const title = document.createElement("strong");
  title.textContent = item.title;
  const meta = document.createElement("small");
  meta.textContent = item.time ? `${status} · ${item.time}` : status;
  copy.append(title, meta);
  if (item.note) {
    const note = document.createElement("p");
    note.className = "map-popup-note";
    note.textContent = item.note;
    copy.append(note);
  }

  const actions = document.createElement("div");
  actions.className = "map-popup-actions";
  const google = document.createElement("a");
  google.href = reviewUrl;
  google.target = "_blank";
  google.rel = "noreferrer";
  google.textContent = "Google에서 보기";
  const comment = document.createElement("button");
  comment.type = "button";
  comment.textContent = `댓글 ${commentCount}`;
  comment.addEventListener("click", onComment);
  const edit = document.createElement("button");
  edit.type = "button";
  edit.textContent = "✎ 수정";
  edit.addEventListener("click", onEdit);
  actions.append(google, comment, edit);
  root.append(copy, actions);
  return root;
}

function emptyRoute(): RouteGeoJson {
  return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [] } };
}

function upsertRoute(map: MapboxMap, route: RouteGeoJson) {
  const source = map.getSource(ROUTE_SOURCE);
  if (source) {
    source.setData(route);
    return;
  }
  map.addSource(ROUTE_SOURCE, { type: "geojson", data: route });
  map.addLayer({
    id: ROUTE_OUTLINE,
    type: "line",
    source: ROUTE_SOURCE,
    slot: "middle",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#ffffff", "line-width": 9, "line-opacity": 0.92 },
  });
  map.addLayer({
    id: ROUTE_LINE,
    type: "line",
    source: ROUTE_SOURCE,
    slot: "middle",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#007aff", "line-width": 4.5, "line-opacity": 0.94 },
  });
}

function addCandidateMarker(
  mapbox: MapboxGl,
  map: MapboxMap,
  candidate: Candidate,
  status: string,
  props: MapViewProps,
) {
  const element = markerElement("candidate", `${status} ${candidate.title}`);
  const popup = new mapbox.Popup({ offset: 22, closeButton: true }).setDOMContent(popupElement(
    candidate,
    status,
    props.getReviewUrl(candidate),
    props.commentCounts[candidate.id] ?? 0,
    () => props.onComment(candidate.id),
    () => props.onEdit(candidate.id),
  ));
  const marker = new mapbox.Marker({ element, anchor: "bottom" })
    .setLngLat(lngLat(candidate.coords))
    .setPopup(popup)
    .addTo(map);
  element.addEventListener("click", () => props.onSelect(candidate.id));
  return marker;
}

export type ValueMapContext = {
  tripId: string;
  userId: string;
  name: string;
  avatarUrl?: string;
};

export default function MapboxMapView(props: MapViewProps & { accessToken: string; valueContext?: ValueMapContext }) {
  const { accessToken, valueContext, places, unscheduledCandidates, searchResults, selectedId, focusPoint } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapboxRef = useRef<MapboxGl | null>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markersRef = useRef<Record<string, MapboxMarker>>({});
  const peopleMarkersRef = useRef<Record<string, MapboxMarker>>({});
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [routeError, setRouteError] = useState("");
  const [routeMeta, setRouteMeta] = useState<{ distance: number; duration: number } | null>(null);
  const shared = useSharedLocations({
    tripId: valueContext?.tripId,
    userId: valueContext?.userId,
    name: valueContext?.name,
    avatarUrl: valueContext?.avatarUrl,
  });

  const routeSignature = useMemo(
    () => places.map((place) => `${place.coords[0].toFixed(5)},${place.coords[1].toFixed(5)}`).join(";"),
    [places],
  );

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    void loadMapboxGl().then((mapbox) => {
      if (disposed || !containerRef.current) return;
      mapbox.accessToken = accessToken;
      const first = places[0]?.coords ?? unscheduledCandidates[0]?.coords ?? [10.2899, 103.984];
      const map = new mapbox.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/standard",
        config: {
          basemap: {
            theme: "faded",
            lightPreset: "day",
            showPointOfInterestLabels: true,
            showTransitLabels: true,
          },
        },
        center: lngLat(first),
        zoom: 12,
        attributionControl: true,
      });
      map.addControl(new mapbox.NavigationControl({ showCompass: true }), "bottom-right");
      map.on("load", () => { if (!disposed) setReady(true); });
      mapboxRef.current = mapbox;
      mapRef.current = map;
    }).catch((cause) => setMapError(cause instanceof Error ? cause.message : "Mapbox 지도를 불러오지 못했습니다."));
    return () => {
      disposed = true;
      Object.values(markersRef.current).forEach((marker) => marker.remove());
      Object.values(peopleMarkersRef.current).forEach((marker) => marker.remove());
      markersRef.current = {};
      peopleMarkersRef.current = {};
      mapRef.current?.remove();
      mapRef.current = null;
      mapboxRef.current = null;
      setReady(false);
    };
  // Mapbox must be initialized once per mounted screen to avoid extra billable map loads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    const mapbox = mapboxRef.current;
    const map = mapRef.current;
    if (!ready || !mapbox || !map) return;
    Object.values(markersRef.current).forEach((marker) => marker.remove());
    markersRef.current = {};

    places.forEach((place, index) => {
      if (!props.visibleCategories.includes(placeCategory(place))) return;
      const element = markerElement("place", `${index + 1}. ${place.title}`, index);
      const popup = new mapbox.Popup({ offset: 28, closeButton: true }).setDOMContent(popupElement(
        place,
        "확정",
        props.getReviewUrl(place),
        props.commentCounts[place.id] ?? 0,
        () => props.onComment(place.id),
        () => props.onEdit(place.id),
      ));
      const marker = new mapbox.Marker({ element, anchor: "bottom" }).setLngLat(lngLat(place.coords)).setPopup(popup).addTo(map);
      element.addEventListener("click", () => props.onSelect(place.id));
      markersRef.current[place.id] = marker;
      place.alternatives.forEach((candidate) => {
        if (!props.visibleCategories.includes(placeCategory(candidate))) return;
        markersRef.current[candidate.id] = addCandidateMarker(mapbox, map, candidate, "후보", props);
      });
    });
    unscheduledCandidates.forEach((candidate) => {
      if (!props.visibleCategories.includes(placeCategory(candidate))) return;
      markersRef.current[candidate.id] = addCandidateMarker(mapbox, map, candidate, "날짜 미정 후보", props);
    });
    searchResults.forEach((result: MapSearchResult, index) => {
      const element = markerElement("search", `검색 결과 ${result.title}`, index);
      markersRef.current[`search:${result.placeId}`] = new mapbox.Marker({ element, anchor: "bottom" })
        .setLngLat(lngLat(result.coords))
        .addTo(map);
    });
  }, [places, props, ready, searchResults, unscheduledCandidates]);

  useEffect(() => {
    const map = mapRef.current;
    const mapbox = mapboxRef.current;
    if (!ready || !map || !mapbox) return;
    const points = [...places.map((place) => place.coords), ...searchResults.map((result) => result.coords)];
    if (!points.length) return;
    const bounds = new mapbox.LngLatBounds(lngLat(points[0]), lngLat(points[0]));
    points.slice(1).forEach((point) => bounds.extend(lngLat(point)));
    if (points.length === 1) map.flyTo({ center: lngLat(points[0]), zoom: 13, duration: 650 });
    else map.fitBounds(bounds, { padding: 70, maxZoom: 14, duration: 650 });
  }, [ready, routeSignature, searchResults, places]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !valueContext?.tripId) return;
    if (places.length < 2) {
      upsertRoute(map, emptyRoute());
      queueMicrotask(() => {
        setRouteMeta(null);
        setRouteError("");
      });
      return;
    }
    const controller = new AbortController();
    void fetchDrivingRoute(valueContext.tripId, places.map((place) => place.coords), controller.signal)
      .then((route) => {
        upsertRoute(map, route.geometry);
        setRouteError("");
        setRouteMeta({ distance: route.distanceMeters, duration: route.durationSeconds });
      })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setRouteError(cause instanceof Error ? cause.message : "자동차 경로를 계산하지 못했습니다.");
        upsertRoute(map, emptyRoute());
      });
    return () => controller.abort();
  }, [places, ready, routeSignature, valueContext?.tripId]);

  useEffect(() => {
    const point = focusPoint ?? places.find((place) => place.id === selectedId);
    if (!point || !ready) return;
    mapRef.current?.flyTo({ center: lngLat(point.coords), zoom: 14, duration: 700 });
    markersRef.current[point.id]?.togglePopup();
    Object.entries(markersRef.current).forEach(([id, marker]) => marker.getElement().classList.toggle("is-selected", id === selectedId));
  }, [focusPoint, places, ready, selectedId]);

  useEffect(() => {
    const closePopupOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      containerRef.current
        ?.querySelectorAll<HTMLButtonElement>(".mapboxgl-popup-close-button")
        .forEach((button) => button.click());
    };
    window.addEventListener("keydown", closePopupOnEscape);
    return () => window.removeEventListener("keydown", closePopupOnEscape);
  }, []);

  useEffect(() => {
    const mapbox = mapboxRef.current;
    const map = mapRef.current;
    if (!ready || !mapbox || !map) return;
    const activeIds = new Set(shared.locations.map((location) => location.userId));
    Object.entries(peopleMarkersRef.current).forEach(([id, marker]) => {
      if (!activeIds.has(id)) { marker.remove(); delete peopleMarkersRef.current[id]; }
    });
    shared.locations.forEach((location) => {
      let marker = peopleMarkersRef.current[location.userId];
      if (!marker) {
        const element = document.createElement("div");
        element.className = "shared-location-marker";
        element.title = `${location.name} · 오차 약 ${Math.round(location.accuracy)}m`;
        if (location.avatarUrl) {
          const image = document.createElement("img");
          image.src = location.avatarUrl;
          image.alt = "";
          element.append(image);
        } else element.textContent = location.name.slice(0, 1);
        marker = new mapbox.Marker({ element, anchor: "center" }).setLngLat([location.lng, location.lat]).addTo(map);
        peopleMarkersRef.current[location.userId] = marker;
      } else marker.setLngLat([location.lng, location.lat]);
    });
  }, [ready, shared.locations]);

  return (
    <div className="value-map-shell">
      <div ref={containerRef} className="map-canvas" aria-label="Mapbox와 OSRM 기반 자동차 일정 경로 지도" />
      <div className="value-map-controls">
        <button type="button" className={shared.sharing ? "is-sharing" : ""} onClick={shared.sharing ? shared.stop : shared.start}>
          {shared.sharing ? `위치 공유 중 · ${shared.locations.length}명` : "내 위치 공유"}
        </button>
        {routeMeta && <span>{(routeMeta.distance / 1000).toFixed(1)}km · 약 {Math.max(1, Math.round(routeMeta.duration / 60))}분</span>}
      </div>
      {(mapError || routeError || shared.error) && <div className="map-api-error" role="status">{mapError || routeError || shared.error}</div>}
    </div>
  );
}
