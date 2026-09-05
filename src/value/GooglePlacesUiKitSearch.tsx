"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps, type GoogleLatLng } from "../googleMaps";
import type { MapSearchResult } from "../types";
import { cacheSelectedPlaceLocation } from "./placeLocationCache";

type UiKitPlace = {
  id: string;
  displayName?: string;
  formattedAddress?: string;
  location?: GoogleLatLng;
};

interface PlaceSearchElement extends HTMLElement {
  places: UiKitPlace[];
}

interface PlaceTextSearchRequestElement extends HTMLElement {
  textQuery: string;
  maxResultCount: number;
  locationBias?: { center: { lat: number; lng: number }; radius: number };
}

interface PlacesUiKitLibrary {
  PlaceSearchElement: new () => PlaceSearchElement;
  PlaceTextSearchRequestElement: new () => PlaceTextSearchRequestElement;
  PlaceContentConfigElement: new () => HTMLElement;
  PlaceAddressElement: new () => HTMLElement;
  PlaceAttributionElement: new () => HTMLElement;
}

type UiKitSelectEvent = Event & { place?: UiKitPlace };

function mapsSearchUrl(title: string, placeId: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(title)}&query_place_id=${encodeURIComponent(placeId)}`;
}

function toResult(place: UiKitPlace, fallbackTitle: string): MapSearchResult | null {
  if (!place.id || !place.location) return null;
  const title = place.displayName || fallbackTitle;
  return {
    placeId: place.id,
    title,
    address: place.formattedAddress || "",
    coords: [place.location.lat(), place.location.lng()],
    googleMapsUrl: mapsSearchUrl(title, place.id),
    locationRefreshedAt: new Date().toISOString(),
  };
}

export default function GooglePlacesUiKitSearch({
  value,
  onChange,
  onSelected,
  onResultsChange,
  locationBias,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  onSelected: (place: MapSearchResult) => void;
  onResultsChange?: (places: MapSearchResult[]) => void;
  locationBias?: [number, number];
  autoFocus?: boolean;
}) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
  const hostRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<PlaceTextSearchRequestElement | null>(null);
  const queryRef = useRef(value);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { queryRef.current = value; }, [value]);

  useEffect(() => {
    if (!apiKey || !hostRef.current) return;
    let disposed = false;
    let search: PlaceSearchElement | null = null;
    const host = hostRef.current;

    void loadGoogleMaps(apiKey).then(async (maps) => {
      const library = await maps.importLibrary("places") as PlacesUiKitLibrary;
      if (disposed) return;
      search = new library.PlaceSearchElement();
      search.setAttribute("selectable", "");
      search.className = "value-places-ui-list";
      const content = new library.PlaceContentConfigElement();
      const address = new library.PlaceAddressElement();
      const attribution = new library.PlaceAttributionElement();
      attribution.setAttribute("light-scheme-color", "gray");
      attribution.setAttribute("dark-scheme-color", "white");
      content.append(address, attribution);
      const request = new library.PlaceTextSearchRequestElement();
      request.maxResultCount = 5;
      if (locationBias) request.locationBias = { center: { lat: locationBias[0], lng: locationBias[1] }, radius: 50_000 };
      requestRef.current = request;
      search.append(content, request);
      search.addEventListener("gmp-load", () => {
        const results = (search?.places ?? [])
          .map((place) => toResult(place, queryRef.current.trim()))
          .filter((place): place is MapSearchResult => Boolean(place));
        onResultsChange?.(results);
      });
      search.addEventListener("gmp-select", (rawEvent) => {
        const event = rawEvent as UiKitSelectEvent;
        const selected = event.place ? toResult(event.place, queryRef.current.trim()) : null;
        if (!selected) {
          setError("선택한 장소의 위치를 확인하지 못했습니다.");
          return;
        }
        onSelected(selected);
        void cacheSelectedPlaceLocation(selected);
        onChange(selected.title);
        onResultsChange?.([]);
      });
      search.addEventListener("gmp-error", () => setError("Google Places UI Kit 검색에 실패했습니다."));
      host.replaceChildren(search);
      setReady(true);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Google 장소 검색을 준비하지 못했습니다."));

    return () => {
      disposed = true;
      requestRef.current = null;
      search?.remove();
      host.replaceChildren();
    };
  // The UI Kit element is created once; the request is updated by the debounced effect below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  useEffect(() => {
    if (!ready || !requestRef.current) return;
    const timer = window.setTimeout(() => {
      const query = value.trim();
      requestRef.current!.textQuery = query.length >= 2 ? query : "";
      if (query.length < 2) onResultsChange?.([]);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [onResultsChange, ready, value]);

  if (!apiKey) return <p className="place-search-error">Places UI Kit API 키가 필요합니다.</p>;

  return (
    <div className="google-place-search value-places-search">
      <div className="search-box">
        <span>⌕</span>
        <input
          value={value}
          onChange={(event) => { setError(""); onChange(event.target.value); }}
          placeholder="예: 해운대 해수욕장"
          autoFocus={autoFocus}
          aria-label="Google 장소 검색"
        />
      </div>
      <div ref={hostRef} className="value-places-ui-host" />
      {!ready && !error && <p className="place-search-status">Google Places UI Kit 준비 중...</p>}
      {error && <p className="place-search-error" role="status">{error}</p>}
      <p className="value-places-policy">Google 제공 · 선택한 Place ID는 저장되며 위치는 30일마다 갱신됩니다.</p>
    </div>
  );
}
