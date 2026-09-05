"use client";

import { useEffect, useRef, useState } from "react";
import { loadMapboxGl, type LngLat, type MapboxMap, type RouteGeoJson } from "./value/mapboxLoader";

const SAMPLE_ROUTE: LngLat[] = [
  [103.9573, 10.2268],
  [103.9691, 10.2415],
  [104.0147, 10.0274],
  [104.0255, 10.0368],
];

function addSampleRoute(map: MapboxMap) {
  const route: RouteGeoJson = {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: SAMPLE_ROUTE },
  };
  map.addSource("landing-route", { type: "geojson", data: route });
  map.addLayer({
    id: "landing-route-outline",
    type: "line",
    source: "landing-route",
    slot: "middle",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#ffffff", "line-width": 8, "line-opacity": .94 },
  });
  map.addLayer({
    id: "landing-route-line",
    type: "line",
    source: "landing-route",
    slot: "middle",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#007AFF", "line-width": 4, "line-opacity": .9 },
  });
}

export default function LandingMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN?.trim();

  useEffect(() => {
    if (!accessToken || !containerRef.current) return;
    let disposed = false;
    let map: MapboxMap | null = null;
    const markers: Array<{ remove(): void }> = [];

    void loadMapboxGl().then((mapbox) => {
      if (disposed || !containerRef.current) return;
      mapbox.accessToken = accessToken;
      map = new mapbox.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/standard",
        center: [103.995, 10.13],
        zoom: 10.25,
        attributionControl: true,
        config: {
          basemap: {
            theme: "faded",
            lightPreset: "day",
            showPointOfInterestLabels: false,
            showTransitLabels: false,
          },
        },
      });
      map.on("load", () => {
        if (!map || disposed) return;
        addSampleRoute(map);
        SAMPLE_ROUTE.forEach((point, index) => {
          const marker = document.createElement("button");
          marker.type = "button";
          marker.className = `landing-map-marker${index === 2 ? " is-selected" : ""}`;
          marker.textContent = String(index + 1);
          marker.setAttribute("aria-label", `예시 일정 ${index + 1}`);
          markers.push(new mapbox.Marker({ element: marker, anchor: "bottom" }).setLngLat(point).addTo(map!));
        });
      });
    }).catch(() => setError("지도를 불러오지 못했습니다."));

    return () => {
      disposed = true;
      markers.forEach((marker) => marker.remove());
      map?.remove();
    };
  }, [accessToken]);

  if (!accessToken) return (
    <div className="landing-map-fallback">
      <img src="/into-the-blue-social-preview.png" alt="해안선을 따라 이어지는 예시 여행 경로" />
      <span>Mapbox 연결 대기 중</span>
      <small>공개 토큰을 연결하면 실제 여행 지도로 전환됩니다.</small>
    </div>
  );
  return <div className="landing-map"><div ref={containerRef} className="landing-map-canvas" />{error && <p>{error}</p>}</div>;
}
