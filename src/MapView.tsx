import { useEffect, useRef } from "react";
import L from "leaflet";
import type { Place } from "./types";

function safe(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}

export default function MapView({
  places,
  selectedId,
  focusPoint,
  onSelect,
}: {
  places: Place[];
  selectedId: string;
  focusPoint: { coords: [number, number]; name: string; token: number } | null;
  onSelect: (id: string) => void;
}) {
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
      marker.bindPopup(`<strong>${safe(place.title)}</strong><small>${safe(place.time)} · ${safe(place.category)}</small>`, {
        className: "place-popup",
        closeButton: false,
        offset: [0, -2],
      });
      marker.on("click", () => onSelect(place.id));
      markersRef.current[place.id] = marker;

      place.alternatives.forEach((candidate) => {
        const candidateIcon = L.divIcon({
          className: "candidate-marker-wrapper",
          html: '<span class="candidate-marker"></span>',
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        });
        L.marker(candidate.coords, { icon: candidateIcon })
          .addTo(map)
          .bindPopup(`<strong>${safe(candidate.title)}</strong><small>후보 · ${safe(candidate.category)}</small>`, {
            className: "place-popup candidate-popup",
            closeButton: false,
          });
      });
    });

    if (route.length > 1) map.fitBounds(L.latLngBounds(route), { padding: [60, 60] });
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current = {};
    };
  }, [places, onSelect]);

  useEffect(() => {
    const place = places.find((item) => item.id === selectedId);
    const map = mapRef.current;
    if (!place || !map) return;
    map.flyTo(focusPoint?.coords ?? place.coords, 14, { duration: 0.8 });
    if (!focusPoint) markersRef.current[place.id]?.openPopup();
    Object.entries(markersRef.current).forEach(([id, marker]) => {
      marker.getElement()?.querySelector(".trip-marker")?.classList.toggle("is-selected", id === selectedId);
    });
  }, [selectedId, focusPoint, places]);

  return <div ref={containerRef} className="map-canvas" aria-label="여행 일정 경로 지도" />;
}
