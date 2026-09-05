"use client";

import type { MapSearchResult } from "./types";
import GooglePlacesUiKitSearch from "./value/GooglePlacesUiKitSearch";

export type GooglePlaceSelection = MapSearchResult;

type GooglePlaceSearchProps = {
  value: string;
  onChange: (value: string) => void;
  onSelected: (place: GooglePlaceSelection) => void;
  onResultsChange?: (places: MapSearchResult[]) => void;
  locationBias?: [number, number];
  autoFocus?: boolean;
};

export default function GooglePlaceSearch(props: GooglePlaceSearchProps) {
  return <GooglePlacesUiKitSearch {...props} />;
}
