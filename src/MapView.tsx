import { useEffect, useRef } from "react";
import L from "leaflet";
import type { Candidate, MapSearchResult, Place } from "./types";
import GoogleMapView from "./GoogleMapView";
import MapboxMapView, { type ValueMapContext } from "./value/MapboxMapView";
import { categoryMeta, placeCategory } from "./categories";
import type { PlaceCategory } from "./types";

export type MapFocusPoint = { id: string; coords: [number, number]; name: string; token: number };

export type MapViewProps = {
  places: Place[];
  unscheduledCandidates: Candidate[];
  searchResults: MapSearchResult[];
  selectedId: string;
  focusPoint: MapFocusPoint | null;
  onSelect: (id: string) => void;
  onComment: (id: string) => void;
  onEdit: (id: string) => void;
  commentCounts: Record<string, number>;
  getReviewUrl: (place: Pick<Candidate, "title" | "coords" | "googleMapsUrl" | "googlePlaceId">) => string;
  visibleCategories: PlaceCategory[];
  showPinNotes: boolean;
  onCategoryOnly: (category: PlaceCategory) => void;
  valueContext?: ValueMapContext;
};

function safe(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}

function overlapPositionKey(coords: [number, number]) {
  return `${coords[0].toFixed(5)}:${coords[1].toFixed(5)}`;
}

function bindPinNote(marker: L.Marker, item: Candidate, offsetY: number, permanent: boolean) {
  const note = item.note?.replace(/\s+/g, " ").trim();
  if (!note) return;
  const displayNote = note.length > 42 ? `${note.slice(0, 42)}…` : note;
  marker.bindTooltip(safe(displayNote), {
    permanent,
    direction: "top",
    className: "map-pin-note-tooltip",
    offset: [0, offsetY],
    opacity: 1,
  });
  if (!permanent) marker.on("popupopen", () => marker.closeTooltip());
}

function placePopup(
  place: Place,
  commentCount: number,
  reviewUrl: string,
  onComment: (placeId: string) => void,
  onEdit: (placeId: string) => void,
  onCategoryOnly: (category: PlaceCategory) => void,
) {
  const content = document.createElement("div");
  content.className = "map-popup-content";

  const copy = document.createElement("div");
  copy.className = "map-popup-copy";
  const title = document.createElement("strong");
  title.textContent = place.title;
  const meta = document.createElement("small");
  meta.textContent = place.time;
  const category = categoryMeta(place);
  const categoryButton = document.createElement("button");
  categoryButton.type = "button";
  categoryButton.className = `category-tag category-${category.value}`;
  categoryButton.innerHTML = `<span aria-hidden="true">${category.icon}</span>${category.label}`;
  categoryButton.addEventListener("click", () => onCategoryOnly(category.value));
  copy.append(title, categoryButton, meta);
  if (place.note) {
    const note = document.createElement("p");
    note.className = "map-popup-note";
    note.textContent = place.note;
    copy.append(note);
  }

  const actions = document.createElement("div");
  actions.className = "map-popup-actions";
  const link = document.createElement("a");
  link.href = reviewUrl;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = "Google";
  link.setAttribute("aria-label", `${place.title} Google에서 보기`);
  const comment = document.createElement("button");
  comment.type = "button";
  comment.textContent = `댓글 ${commentCount}`;
  comment.setAttribute("aria-label", `${place.title} 댓글 열기`);
  comment.addEventListener("click", () => onComment(place.id));
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "map-popup-edit";
  edit.textContent = "✎ 수정";
  edit.setAttribute("aria-label", `${place.title} 수정`);
  edit.addEventListener("click", () => onEdit(place.id));
  actions.append(link, comment, edit);

  content.append(copy, actions);
  L.DomEvent.disableClickPropagation(content);
  return content;
}

function candidatePopup(candidate: Candidate, reviewUrl: string, commentCount: number, onComment: (id: string) => void, onEdit: (id: string) => void, onCategoryOnly: (category: PlaceCategory) => void, status = "후보") {
  const content = document.createElement("div");
  content.className = "map-popup-content";
  const category = categoryMeta(candidate);
  content.innerHTML = `<div class="map-popup-copy"><strong>${safe(candidate.title)}</strong><button type="button" class="category-tag category-${category.value}"><span aria-hidden="true">${category.icon}</span>${category.label}</button><small>${safe(status)}${candidate.time ? ` · ${safe(candidate.time)}` : ""}</small>${candidate.note ? `<p class="map-popup-note">${safe(candidate.note)}</p>` : ""}</div><div class="map-popup-actions"><a href="${safe(reviewUrl)}" target="_blank" rel="noreferrer" aria-label="${safe(candidate.title)} Google에서 보기">Google</a><button type="button" class="map-popup-comment">댓글 ${commentCount}</button><button type="button" class="map-popup-edit">✎ 수정</button></div>`;
  content.querySelector<HTMLButtonElement>(".category-tag")?.addEventListener("click", () => onCategoryOnly(category.value));
  content.querySelector<HTMLButtonElement>(".map-popup-comment")?.addEventListener("click", () => onComment(candidate.id));
  content.querySelector<HTMLButtonElement>(".map-popup-edit")?.addEventListener("click", () => onEdit(candidate.id));
  L.DomEvent.disableClickPropagation(content);
  return content;
}

function OpenStreetMapView({
  places,
  unscheduledCandidates,
  selectedId,
  focusPoint,
  onSelect,
  onComment,
  onEdit,
  commentCounts,
  getReviewUrl,
  visibleCategories,
  showPinNotes,
  onCategoryOnly,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});
  const expandOverlapRef = useRef<(id: string) => void>(() => undefined);

  useEffect(() => {
    if (!containerRef.current) return;
    const first = places[0]?.coords ?? unscheduledCandidates[0]?.coords ?? [10.2899, 103.984];
    const map = L.map(containerRef.current, { zoomControl: false, attributionControl: true }).setView(first, 12);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);

    const originalPositions: Record<string, [number, number]> = {};
    const overlapGroups: Record<string, { center: [number, number]; ids: string[] }> = {};
    let spiderLines: L.Polyline[] = [];
    let spiderfiedIds: string[] = [];
    const collapseOverlapGroup = () => {
      spiderfiedIds.forEach((id) => {
        const original = originalPositions[id];
        if (original) markersRef.current[id]?.setLatLng(original);
      });
      spiderLines.forEach((line) => line.removeFrom(map));
      spiderLines = [];
      spiderfiedIds = [];
    };
    const expandOverlapGroup = (id: string) => {
      const group = overlapGroups[id];
      if (!group || group.ids.length < 2) { collapseOverlapGroup(); return; }
      collapseOverlapGroup();
      const center = L.latLng(group.center);
      const centerPoint = map.latLngToLayerPoint(center);
      const radius = Math.max(32, Math.min(48, 25 + group.ids.length * 4));
      group.ids.forEach((markerId, index) => {
        const angle = -Math.PI / 2 + index * (Math.PI * 2 / group.ids.length);
        const point = L.point(centerPoint.x + Math.cos(angle) * radius, centerPoint.y + Math.sin(angle) * radius);
        const position = map.layerPointToLatLng(point);
        markersRef.current[markerId]?.setLatLng(position);
        spiderLines.push(L.polyline([center, position], { color: "#657b72", weight: 1.5, opacity: 0.58, interactive: false }).addTo(map));
      });
      spiderfiedIds = [...group.ids];
    };
    expandOverlapRef.current = expandOverlapGroup;

    const route = places.map((place) => place.coords);
    const mapPoints = [...places.flatMap((place) => [place.coords, ...place.alternatives.map((candidate) => candidate.coords)]), ...unscheduledCandidates.map((candidate) => candidate.coords)];
    if (route.length > 1) {
      L.polyline(route, { color: "#ef765f", weight: 5, opacity: 0.95, lineCap: "round" }).addTo(map);
      L.polyline(route, { color: "#fffaf0", weight: 2, opacity: 0.55, dashArray: "2 11" }).addTo(map);
    }

    places.forEach((place, index) => {
      if (visibleCategories.includes(placeCategory(place))) {
      const icon = L.divIcon({
        className: "trip-marker-wrapper",
        html: `<button class="trip-marker" aria-label="${safe(place.title)}"><span>${index + 1}</span></button>`,
        iconSize: [42, 48],
        iconAnchor: [21, 44],
        popupAnchor: [0, -42],
      });
      const marker = L.marker(place.coords, { icon }).addTo(map);
      originalPositions[place.id] = place.coords;
      marker.bindPopup(placePopup(place, commentCounts[place.id] ?? 0, getReviewUrl(place), onComment, onEdit, onCategoryOnly), {
        className: "place-popup",
        closeButton: false,
        offset: [0, -2],
      });
      if (showPinNotes) bindPinNote(marker, place, -42, true);
      marker.on("click", () => { expandOverlapGroup(place.id); onSelect(place.id); });
      markersRef.current[place.id] = marker;
      }

      place.alternatives.forEach((candidate) => {
        if (!visibleCategories.includes(placeCategory(candidate))) return;
        const candidateIcon = L.divIcon({
          className: "candidate-marker-wrapper",
          html: `<button class="candidate-marker" aria-label="후보 장소 ${safe(candidate.title)}"><span></span></button>`,
          iconSize: [26, 31],
          iconAnchor: [13, 29],
          popupAnchor: [0, -27],
        });
        const candidateMarker = L.marker(candidate.coords, { icon: candidateIcon })
          .addTo(map)
          .bindPopup(candidatePopup(candidate, getReviewUrl(candidate), commentCounts[candidate.id] ?? 0, onComment, onEdit, onCategoryOnly), {
            className: "place-popup candidate-popup",
            closeButton: false,
          });
        originalPositions[candidate.id] = candidate.coords;
        if (showPinNotes) bindPinNote(candidateMarker, candidate, -26, false);
        candidateMarker.on("click", () => { expandOverlapGroup(candidate.id); onSelect(candidate.id); map.panTo(candidate.coords, { animate: true, duration: 0.65 }); });
        markersRef.current[candidate.id] = candidateMarker;
      });
    });

    unscheduledCandidates.forEach((candidate) => {
      if (!visibleCategories.includes(placeCategory(candidate))) return;
      const candidateIcon = L.divIcon({
        className: "candidate-marker-wrapper unscheduled-marker-wrapper",
        html: `<button class="candidate-marker unscheduled-marker" aria-label="날짜 미정 후보 ${safe(candidate.title)}"><span></span></button>`,
        iconSize: [28, 33],
        iconAnchor: [14, 31],
        popupAnchor: [0, -29],
      });
      const marker = L.marker(candidate.coords, { icon: candidateIcon })
        .addTo(map)
        .bindPopup(candidatePopup(candidate, getReviewUrl(candidate), commentCounts[candidate.id] ?? 0, onComment, onEdit, onCategoryOnly, "날짜 미정 후보"), {
          className: "place-popup candidate-popup",
          closeButton: false,
        });
      originalPositions[candidate.id] = candidate.coords;
      if (showPinNotes) bindPinNote(marker, candidate, -28, false);
      marker.on("click", () => { expandOverlapGroup(candidate.id); onSelect(candidate.id); map.panTo(candidate.coords, { animate: true, duration: 0.65 }); });
      markersRef.current[candidate.id] = marker;
    });

    const groupedIds = new Map<string, string[]>();
    Object.entries(originalPositions).forEach(([id, coords]) => {
      const key = overlapPositionKey(coords);
      groupedIds.set(key, [...(groupedIds.get(key) ?? []), id]);
    });
    groupedIds.forEach((ids) => {
      if (ids.length < 2) return;
      const group = { center: originalPositions[ids[0]], ids };
      ids.forEach((id) => { overlapGroups[id] = group; });
    });
    map.on("zoomstart", collapseOverlapGroup);

    if (places.length) map.setView(places[0].coords, 13);
    else if (mapPoints.length > 1) map.fitBounds(L.latLngBounds(mapPoints), { padding: [60, 60] });
    mapRef.current = map;
    const closePopupOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") map.closePopup();
    };
    window.addEventListener("keydown", closePopupOnEscape);

    return () => {
      window.removeEventListener("keydown", closePopupOnEscape);
      map.remove();
      mapRef.current = null;
      markersRef.current = {};
      expandOverlapRef.current = () => undefined;
    };
  }, [commentCounts, getReviewUrl, onCategoryOnly, onComment, onEdit, onSelect, places, showPinNotes, unscheduledCandidates, visibleCategories]);

  useEffect(() => {
    const place = places.find((item) => item.id === selectedId);
    const map = mapRef.current;
    const point = focusPoint ?? (place ? { id: place.id, coords: place.coords } : null);
    if (!point || !map) return;
    expandOverlapRef.current(point.id);
    map.panTo(point.coords, { animate: true, duration: 0.8 });
    markersRef.current[point.id]?.openPopup();
    Object.entries(markersRef.current).forEach(([id, marker]) => {
      marker.getElement()?.querySelector(".trip-marker")?.classList.toggle("is-selected", id === selectedId);
    });
  }, [selectedId, focusPoint, places, unscheduledCandidates]);

  return <div ref={containerRef} className="map-canvas" aria-label="여행 일정 경로 지도" />;
}

export default function MapView(props: MapViewProps) {
  const provider = import.meta.env.VITE_MAP_PROVIDER?.trim().toLowerCase();
  const mapboxToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN?.trim();
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim();
  if (provider === "mapbox" && mapboxToken) return <MapboxMapView {...props} accessToken={mapboxToken} />;
  if (apiKey) return <GoogleMapView {...props} apiKey={apiKey} />;
  return <OpenStreetMapView {...props} />;
}
