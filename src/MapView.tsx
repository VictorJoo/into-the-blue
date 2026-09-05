"use client";

import type { Candidate, MapSearchResult, Place, PlaceCategory } from "./types";
import MapboxMapView, { type ValueMapContext } from "./value/MapboxMapView";

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

export default function MapView(props: MapViewProps) {
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN?.trim();
  if (mapboxToken) return <MapboxMapView {...props} accessToken={mapboxToken} />;
  return (
    <div className="map-canvas map-config-empty" role="status">
      <strong>Mapbox 연결이 필요합니다</strong>
      <span>Cloudflare에 NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN을 추가해주세요.</span>
    </div>
  );
}
