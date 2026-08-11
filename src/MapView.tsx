import { useEffect, useRef } from "react";
import L from "leaflet";
import type { Candidate, Place } from "./types";
import GoogleMapView from "./GoogleMapView";

export type MapFocusPoint = { id: string; coords: [number, number]; name: string; token: number };

export type MapViewProps = {
  places: Place[];
  selectedId: string;
  focusPoint: MapFocusPoint | null;
  onSelect: (id: string) => void;
  onComment: (id: string) => void;
  commentCounts: Record<string, number>;
  getReviewUrl: (place: Pick<Candidate, "title" | "coords" | "googleMapsUrl">) => string;
};

function safe(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}

function placePopup(
  place: Place,
  commentCount: number,
  reviewUrl: string,
  onComment: (placeId: string) => void,
) {
  const content = document.createElement("div");
  content.className = "map-popup-content";

  const copy = document.createElement("div");
  copy.className = "map-popup-copy";
  const title = document.createElement("strong");
  title.textContent = place.title;
  const meta = document.createElement("small");
  meta.textContent = place.time;
  copy.append(title, meta);
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
  link.textContent = "링크 ↗";
  link.setAttribute("aria-label", `${place.title} Google 리뷰 보기`);
  const comment = document.createElement("button");
  comment.type = "button";
  comment.textContent = `댓글 ${commentCount}`;
  comment.setAttribute("aria-label", `${place.title} 댓글 열기`);
  comment.addEventListener("click", () => onComment(place.id));
  actions.append(link, comment);

  content.append(copy, actions);
  L.DomEvent.disableClickPropagation(content);
  return content;
}

function candidatePopup(candidate: Candidate, reviewUrl: string) {
  return `<div class="map-popup-content"><div class="map-popup-copy"><strong>${safe(candidate.title)}</strong><small>후보 · ${safe(candidate.time)}</small>${candidate.note ? `<p class="map-popup-note">${safe(candidate.note)}</p>` : ""}</div><div class="map-popup-actions"><a href="${safe(reviewUrl)}" target="_blank" rel="noreferrer">링크 ↗</a></div></div>`;
}

function OpenStreetMapView({
  places,
  selectedId,
  focusPoint,
  onSelect,
  onComment,
  commentCounts,
  getReviewUrl,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});

  useEffect(() => {
    if (!containerRef.current) return;
    const first = places[0]?.coords ?? [48.8566, 2.3522];
    const map = L.map(containerRef.current, { zoomControl: false, attributionControl: true }).setView(first, 12);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);

    const route = places.map((place) => place.coords);
    const mapPoints = places.flatMap((place) => [place.coords, ...place.alternatives.map((candidate) => candidate.coords)]);
    if (route.length > 1) {
      L.polyline(route, { color: "#ef765f", weight: 5, opacity: 0.95, lineCap: "round" }).addTo(map);
      L.polyline(route, { color: "#fffaf0", weight: 2, opacity: 0.55, dashArray: "2 11" }).addTo(map);
    }

    places.forEach((place, index) => {
      const icon = L.divIcon({
        className: "trip-marker-wrapper",
        html: `<button class="trip-marker" aria-label="${safe(place.title)}"><span>${index + 1}</span></button>`,
        iconSize: [42, 48],
        iconAnchor: [21, 44],
        popupAnchor: [0, -42],
      });
      const marker = L.marker(place.coords, { icon }).addTo(map);
      marker.bindPopup(placePopup(place, commentCounts[place.id] ?? 0, getReviewUrl(place), onComment), {
        className: "place-popup",
        closeButton: false,
        offset: [0, -2],
      });
      marker.on("click", () => onSelect(place.id));
      markersRef.current[place.id] = marker;

      place.alternatives.forEach((candidate) => {
        const candidateIcon = L.divIcon({
          className: "candidate-marker-wrapper",
          html: `<button class="candidate-marker" aria-label="후보 장소 ${safe(candidate.title)}"><span></span></button>`,
          iconSize: [30, 36],
          iconAnchor: [15, 33],
          popupAnchor: [0, -31],
        });
        const candidateMarker = L.marker(candidate.coords, { icon: candidateIcon })
          .addTo(map)
          .bindPopup(candidatePopup(candidate, getReviewUrl(candidate)), {
            className: "place-popup candidate-popup",
            closeButton: false,
          });
        candidateMarker.on("click", () => map.flyTo(candidate.coords, 15, { duration: 0.65 }));
        markersRef.current[candidate.id] = candidateMarker;
      });
    });

    if (mapPoints.length > 1) map.fitBounds(L.latLngBounds(mapPoints), { padding: [60, 60] });
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
    };
  }, [commentCounts, getReviewUrl, onComment, onSelect, places]);

  useEffect(() => {
    const place = places.find((item) => item.id === selectedId);
    const map = mapRef.current;
    if (!place || !map) return;
    map.flyTo(focusPoint?.coords ?? place.coords, 14, { duration: 0.8 });
    markersRef.current[focusPoint?.id ?? place.id]?.openPopup();
    Object.entries(markersRef.current).forEach(([id, marker]) => {
      marker.getElement()?.querySelector(".trip-marker")?.classList.toggle("is-selected", id === selectedId);
    });
  }, [selectedId, focusPoint, places]);

  return <div ref={containerRef} className="map-canvas" aria-label="여행 일정 경로 지도" />;
}

export default function MapView(props: MapViewProps) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim();
  if (apiKey) return <GoogleMapView {...props} apiKey={apiKey} />;
  return <OpenStreetMapView {...props} />;
}
