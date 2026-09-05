export type GoogleLatLngLiteral = { lat: number; lng: number };

export interface GoogleLatLng {
  lat: () => number;
  lng: () => number;
}

export type GoogleMapsListener = { remove: () => void };

export interface GoogleMapInstance {
  addListener: (eventName: string, handler: () => void) => GoogleMapsListener;
  fitBounds: (bounds: GoogleBoundsInstance, padding?: number) => void;
  getCenter: () => GoogleLatLng | undefined;
  getZoom: () => number | undefined;
  panTo: (position: GoogleLatLngLiteral) => void;
  setZoom: (zoom: number) => void;
}

export interface GoogleBoundsInstance {
  extend: (position: GoogleLatLngLiteral) => void;
}

export interface GoogleMarkerInstance {
  addListener: (eventName: string, handler: () => void) => GoogleMapsListener;
  setLabel: (label: string | { text: string; className?: string } | null) => void;
  setMap: (map: GoogleMapInstance | null) => void;
  setPosition: (position: GoogleLatLngLiteral) => void;
}

export interface GoogleInfoWindowInstance {
  close: () => void;
  open: (options: { anchor: GoogleMarkerInstance; map: GoogleMapInstance }) => void;
}

export interface GooglePolylineInstance {
  setMap: (map: GoogleMapInstance | null) => void;
  setOptions: (options: Record<string, unknown>) => void;
}

export interface GoogleMapsApi {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMapInstance;
  Marker: new (options: Record<string, unknown>) => GoogleMarkerInstance;
  InfoWindow: new (options: { content: Node | string; headerDisabled?: boolean }) => GoogleInfoWindowInstance;
  LatLngBounds: new () => GoogleBoundsInstance;
  Polyline: new (options: Record<string, unknown>) => GooglePolylineInstance;
  importLibrary: (library: string) => Promise<unknown>;
}

export interface GooglePlacePrediction {
  placeId: string;
  text: { toString: () => string };
  mainText?: { toString: () => string };
  secondaryText?: { toString: () => string };
  toPlace: () => GooglePlace;
}

export interface GoogleAutocompleteSuggestion {
  placePrediction?: GooglePlacePrediction;
}

export interface GooglePhotoAttribution {
  displayName: string;
  uri?: string;
}

export interface GooglePlacePhoto {
  authorAttributions?: GooglePhotoAttribution[];
  googleMapsURI?: string;
  getURI: (options: { maxWidth?: number; maxHeight?: number }) => string;
}

export interface GoogleOpeningHoursPoint {
  day: number;
  hour: number;
  minute: number;
}

export interface GoogleOpeningHoursPeriod {
  open: GoogleOpeningHoursPoint;
  close?: GoogleOpeningHoursPoint;
}

export interface GoogleOpeningHours {
  periods?: GoogleOpeningHoursPeriod[];
  weekdayDescriptions?: string[];
}

export interface GooglePlace {
  id: string;
  displayName?: string;
  location?: GoogleLatLng;
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  currentOpeningHours?: GoogleOpeningHours;
  utcOffsetMinutes?: number;
  photos?: GooglePlacePhoto[];
  googleMapsURI?: string;
  fetchFields: (request: { fields: string[] }) => Promise<{ place: GooglePlace }>;
}

export interface GooglePlacesLibrary {
  Place: {
    new (options: { id: string; requestedLanguage?: string; requestedRegion?: string }): GooglePlace;
    searchByText: (request: Record<string, unknown>) => Promise<{ places: GooglePlace[] }>;
  };
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions: (request: Record<string, unknown>) => Promise<{ suggestions: GoogleAutocompleteSuggestion[] }>;
  };
  AutocompleteSessionToken: new () => unknown;
}

let googleMapsPromise: Promise<GoogleMapsApi> | null = null;

function googleMapsFromWindow() {
  return (window as unknown as { google?: { maps?: GoogleMapsApi } }).google?.maps;
}

export function loadGoogleMaps(apiKey: string) {
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
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&language=ko&region=KR&loading=async&callback=${callbackName}`;
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
