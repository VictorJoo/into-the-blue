import { ChangeEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { loadGoogleMaps, type GoogleAutocompleteSuggestion, type GooglePlacesLibrary } from "./googleMaps";
import type { MapSearchResult } from "./types";
import GooglePlacesUiKitSearch from "./value/GooglePlacesUiKitSearch";

export type GooglePlaceSelection = MapSearchResult;

function mapsSearchUrl(title: string, placeId: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(title)}&query_place_id=${encodeURIComponent(placeId)}`;
}

function openExternalSearch(query: string) {
  if (!query.trim()) return;
  window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query.trim())}`, "_blank", "noopener,noreferrer");
}

type GooglePlaceSearchProps = {
  value: string;
  onChange: (value: string) => void;
  onSelected: (place: GooglePlaceSelection) => void;
  onResultsChange?: (places: MapSearchResult[]) => void;
  locationBias?: [number, number];
  autoFocus?: boolean;
};

export default function GooglePlaceSearch(props: GooglePlaceSearchProps) {
  if (import.meta.env.VITE_MAP_PROVIDER?.trim().toLowerCase() === "mapbox") {
    return <GooglePlacesUiKitSearch {...props} />;
  }
  return <LegacyGooglePlaceSearch {...props} />;
}

function LegacyGooglePlaceSearch({
  value,
  onChange,
  onSelected,
  onResultsChange,
  locationBias,
  autoFocus,
}: GooglePlaceSearchProps) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim();
  const placesLibraryRef = useRef<GooglePlacesLibrary | null>(null);
  const sessionTokenRef = useRef<unknown>(null);
  const requestIdRef = useRef(0);
  const interactedRef = useRef(false);
  const fullSearchQueryRef = useRef("");
  const [suggestions, setSuggestions] = useState<GoogleAutocompleteSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [completedQuery, setCompletedQuery] = useState("");

  const getPlacesLibrary = async () => {
    if (!apiKey) throw new Error("Google Maps API 키가 없습니다.");
    if (placesLibraryRef.current) return placesLibraryRef.current;
    const maps = await loadGoogleMaps(apiKey);
    const library = await maps.importLibrary("places") as GooglePlacesLibrary;
    placesLibraryRef.current = library;
    sessionTokenRef.current = new library.AutocompleteSessionToken();
    return library;
  };

  const requestSuggestions = async (query: string) => {
    const input = query.trim();
    if (fullSearchQueryRef.current === input) return;
    if (!apiKey || input.length < 2) {
      setSuggestions([]);
      setCompletedQuery("");
      onResultsChange?.([]);
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError("");
    try {
      const library = await getPlacesLibrary();
      if (!sessionTokenRef.current) sessionTokenRef.current = new library.AutocompleteSessionToken();
      const result = await library.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input,
        sessionToken: sessionTokenRef.current,
        language: "ko",
        ...(locationBias ? { locationBias: { center: { lat: locationBias[0], lng: locationBias[1] }, radius: 50_000 } } : {}),
      });
      if (requestId !== requestIdRef.current) return;
      setSuggestions(result.suggestions.filter((suggestion) => suggestion.placePrediction).slice(0, 5));
      setCompletedQuery(input);
      setActiveIndex(0);
    } catch (cause) {
      console.warn("Google 장소 자동완성 실패", cause);
      if (requestId === requestIdRef.current) {
        setSuggestions([]);
        setCompletedQuery("");
        const detail = cause instanceof Error ? cause.message : "알 수 없는 오류";
        setError(`검색 결과를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.${import.meta.env.DEV ? ` (${detail})` : ""}`);
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  };

  const requestTextSearch = async (query: string) => {
    const input = query.trim();
    if (!apiKey || input.length < 2) return;
    fullSearchQueryRef.current = input;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError("");
    try {
      const library = await getPlacesLibrary();
      const result = await library.Place.searchByText({
        textQuery: input,
        fields: ["id", "displayName", "formattedAddress", "location"],
        maxResultCount: 5,
        language: "ko",
        ...(locationBias ? { locationBias: { center: { lat: locationBias[0], lng: locationBias[1] }, radius: 50_000 } } : {}),
      });
      if (requestId !== requestIdRef.current) return;
      const textValue = (value: string) => ({ toString: () => value });
      const resultPlaces = result.places.filter((place) => place.id && place.location);
      setSuggestions(resultPlaces.map((place) => ({
        placePrediction: {
          placeId: place.id,
          text: textValue(place.displayName || place.formattedAddress || input),
          mainText: textValue(place.displayName || input),
          secondaryText: textValue(place.formattedAddress || ""),
          toPlace: () => place,
        },
      })));
      onResultsChange?.(resultPlaces.map((place) => ({
        placeId: place.id,
        title: place.displayName || input,
        address: place.formattedAddress || "",
        coords: [place.location!.lat(), place.location!.lng()],
        googleMapsUrl: mapsSearchUrl(place.displayName || input, place.id),
      })));
      setCompletedQuery(input);
      setActiveIndex(0);
    } catch (cause) {
      console.warn("Google 장소 전체 검색 실패", cause);
      if (requestId === requestIdRef.current) {
        setSuggestions([]);
        setCompletedQuery("");
        onResultsChange?.([]);
        const detail = cause instanceof Error ? cause.message : "알 수 없는 오류";
        setError(`검색 결과를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.${import.meta.env.DEV ? ` (${detail})` : ""}`);
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!apiKey || !interactedRef.current) return;
    const timer = window.setTimeout(() => void requestSuggestions(value), 350);
    return () => window.clearTimeout(timer);
  // requestSuggestions intentionally uses the current API/session refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, value]);

  const chooseSuggestion = async (suggestion: GoogleAutocompleteSuggestion) => {
    const prediction = suggestion.placePrediction;
    if (!prediction) return;
    setLoading(true);
    setError("");
    try {
      const place = prediction.toPlace();
      if (!place.location) await place.fetchFields({ fields: ["location", "formattedAddress"] });
      if (!place.location) throw new Error("장소 좌표가 없습니다.");
      const title = prediction.mainText?.toString() || prediction.text.toString();
      onSelected({
        placeId: place.id || prediction.placeId,
        title,
        address: place.formattedAddress || prediction.secondaryText?.toString() || "",
        coords: [place.location.lat(), place.location.lng()],
        googleMapsUrl: mapsSearchUrl(title, place.id || prediction.placeId),
      });
      onChange(title);
      setSuggestions([]);
      setCompletedQuery("");
      const library = await getPlacesLibrary();
      sessionTokenRef.current = new library.AutocompleteSessionToken();
      interactedRef.current = false;
    } catch (cause) {
      console.warn("Google 장소 선택 실패", cause);
      const detail = cause instanceof Error ? cause.message : "알 수 없는 오류";
      setError(`장소 위치를 확인하지 못했습니다. 다른 검색 결과를 선택해주세요.${import.meta.env.DEV ? ` (${detail})` : ""}`);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    interactedRef.current = true;
    fullSearchQueryRef.current = "";
    onResultsChange?.([]);
    onChange(event.target.value);
    setError("");
    setCompletedQuery("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!apiKey) {
      if (event.key === "Enter") {
        event.preventDefault();
        openExternalSearch(value);
      }
      return;
    }
    if (event.key === "ArrowDown" && suggestions.length) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % suggestions.length);
    } else if (event.key === "ArrowUp" && suggestions.length) {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      void requestTextSearch(value);
    } else if (event.key === "Escape") {
      setSuggestions([]);
    }
  };

  return (
    <div className="google-place-search">
      <div className="search-box">
        <span>⌕</span>
        <input
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="예: 푸꾸옥 야시장"
          autoFocus={autoFocus}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={suggestions.length > 0}
          aria-controls="google-place-suggestions"
          aria-activedescendant={suggestions[activeIndex] ? `google-place-option-${activeIndex}` : undefined}
        />
        {!apiKey && <button type="button" disabled={!value.trim()} onClick={() => openExternalSearch(value)}>Google 지도에서 검색 ↗</button>}
        {apiKey && <button type="button" disabled={loading || value.trim().length < 2} onClick={() => void requestTextSearch(value)}>{loading ? "검색 중" : "검색"}</button>}
      </div>
      {suggestions.length > 0 && (
        <div className="place-suggestions" id="google-place-suggestions" role="listbox">
          {suggestions.map((suggestion, index) => {
            const prediction = suggestion.placePrediction!;
            return (
              <button
                type="button"
                id={`google-place-option-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className={index === activeIndex ? "is-active" : ""}
                key={prediction.placeId}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void chooseSuggestion(suggestion)}
              >
                <span><strong>{prediction.mainText?.toString() || prediction.text.toString()}</strong><small>{prediction.secondaryText?.toString()}</small></span>
                <b>＋</b>
              </button>
            );
          })}
          <p className="google-attribution">Google 제공</p>
        </div>
      )}
      {apiKey && !suggestions.length && loading && <p className="place-search-status">Google 장소를 검색하는 중...</p>}
      {apiKey && !loading && !error && !suggestions.length && completedQuery === value.trim() && completedQuery.length >= 2 && (
        <p className="place-search-empty" role="status">검색 결과가 없습니다. 지역명과 장소명을 함께 입력해보세요.</p>
      )}
      {error && <p className="place-search-error" role="status">{error}</p>}
    </div>
  );
}
