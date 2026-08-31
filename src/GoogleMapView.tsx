import { useEffect, useRef, useState } from "react";
import type { Candidate, MapSearchResult, Place, PlaceCategory } from "./types";
import { categoryMeta, placeCategory } from "./categories";
import type { MapFocusPoint } from "./MapView";
import {
  loadGoogleMaps,
  type GoogleInfoWindowInstance,
  type GoogleMapInstance,
  type GoogleMapsApi,
  type GoogleMapsListener,
  type GoogleMarkerInstance,
  type GoogleOpeningHours,
  type GooglePlace,
  type GooglePlacesLibrary,
  type GooglePolylineInstance,
} from "./googleMaps";

interface RouteResult {
  createPolylines: () => GooglePolylineInstance[];
}

interface RouteLibrary {
  Route: {
    computeRoutes: (request: Record<string, unknown>) => Promise<{ routes?: RouteResult[] }>;
  };
}

type MarkerEntry = {
  marker: GoogleMarkerInstance;
  info: GoogleInfoWindowInstance;
  loadDetails: () => Promise<void>;
  noteLabel?: { text: string; className: string };
  persistentNote: boolean;
};

type OverlapGroup = { center: [number, number]; ids: string[] };

function coordinates(coords: [number, number]) {
  return { lat: coords[0], lng: coords[1] };
}

function primaryPinIcon(index: number) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="46" height="56" viewBox="0 0 46 56">
      <path d="M23 2C11.4 2 2 11.4 2 23c0 15.1 21 31 21 31s21-15.9 21-31C44 11.4 34.6 2 23 2Z" fill="#ef765f" stroke="#fff" stroke-width="4"/>
      <circle cx="23" cy="22" r="11" fill="rgba(255,255,255,.97)"/>
      <text x="23" y="26" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" font-weight="800" fill="#c84f3d">${index + 1}</text>
    </svg>
  `)}`;
}

const candidatePinIcon = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="21" height="26" viewBox="0 0 28 34">
    <path d="M14 1.5C7.1 1.5 1.5 7.1 1.5 14c0 9.5 12.5 18.5 12.5 18.5S26.5 23.5 26.5 14C26.5 7.1 20.9 1.5 14 1.5Z" fill="#59a7f8" stroke="#fff" stroke-width="3"/>
    <circle cx="14" cy="13.5" r="3.8" fill="#fff"/>
  </svg>
`)}`;

const unscheduledPinIcon = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="23" height="28" viewBox="0 0 30 36">
    <path d="M15 1.5C7.54 1.5 1.5 7.54 1.5 15c0 10.25 13.5 19.5 13.5 19.5S28.5 25.25 28.5 15C28.5 7.54 22.46 1.5 15 1.5Z" fill="#2f86e8" stroke="#fff" stroke-width="3"/>
    <path d="M15 9.5 20.5 15 15 20.5 9.5 15Z" fill="#fff"/>
  </svg>
`)}`;

function searchResultPinIcon(index: number) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="34" height="42" viewBox="0 0 34 42">
      <path d="M17 1.5C8.44 1.5 1.5 8.44 1.5 17c0 11.72 15.5 23.5 15.5 23.5S32.5 28.72 32.5 17C32.5 8.44 25.56 1.5 17 1.5Z" fill="#3978e6" stroke="#fff" stroke-width="3"/>
      <circle cx="17" cy="16" r="8" fill="rgba(255,255,255,.95)"/>
      <text x="17" y="20" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" font-weight="700" fill="#3978e6">${index + 1}</text>
    </svg>
  `)}`;
}

function pinNoteLabel(item: Candidate, kind: "primary" | "candidate" | "unscheduled") {
  const note = item.note?.replace(/\s+/g, " ").trim();
  if (!note) return undefined;
  return {
    text: note.length > 42 ? `${note.slice(0, 42)}…` : note,
    className: `map-pin-note-label is-${kind}`,
  };
}

function overlapPositionKey(coords: [number, number]) {
  return `${coords[0].toFixed(5)}:${coords[1].toFixed(5)}`;
}

function popupContent(
  item: Candidate,
  status: "확정" | "후보" | "날짜 미정 후보" | "검색 결과",
  reviewUrl: string,
  commentCount?: number,
  onComment?: () => void,
  onEdit?: () => void,
  onCategoryOnly?: (category: PlaceCategory) => void,
) {
  const content = document.createElement("div");
  content.className = "map-popup-content google-map-popup";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "google-popup-close";
  closeButton.setAttribute("aria-label", "장소 정보 닫기");

  const liveDetails = document.createElement("div");
  liveDetails.className = "google-place-live is-idle";
  liveDetails.textContent = "사진 · 평점 · 영업시간은 장소를 선택하면 표시됩니다.";

  const copy = document.createElement("div");
  copy.className = "map-popup-copy";
  const title = document.createElement("strong");
  title.textContent = item.title;
  const meta = document.createElement("small");
  meta.textContent = item.time ? `${status} · ${item.time}` : status;
  const category = categoryMeta(item);
  const categoryButton = document.createElement("button");
  categoryButton.type = "button";
  categoryButton.className = `category-tag category-${category.value}`;
  categoryButton.innerHTML = `<span aria-hidden="true">${category.icon}</span>${category.label}`;
  categoryButton.addEventListener("click", () => onCategoryOnly?.(category.value));
  copy.append(title, categoryButton, meta);
  if (item.note) {
    const note = document.createElement("p");
    note.className = "map-popup-note";
    note.textContent = item.note;
    copy.append(note);
  }

  const actions = document.createElement("div");
  actions.className = "map-popup-actions";
  const review = document.createElement("a");
  review.href = reviewUrl;
  review.target = "_blank";
  review.rel = "noreferrer";
  review.textContent = "Google";
  actions.append(review);
  if (onComment) {
    const comment = document.createElement("button");
    comment.type = "button";
    comment.textContent = `댓글 ${commentCount ?? 0}`;
    comment.addEventListener("click", onComment);
    actions.append(comment);
  }
  if (onEdit) {
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "map-popup-edit";
    edit.textContent = "✎ 수정";
    edit.addEventListener("click", onEdit);
    actions.append(edit);
  }
  content.append(closeButton, liveDetails);
  content.append(copy, actions);
  return { content, liveDetails, closeButton };
}

const dayNames = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

function localDayAndMinute(utcOffsetMinutes = 0) {
  const localNow = new Date(Date.now() + utcOffsetMinutes * 60_000);
  return {
    day: localNow.getUTCDay(),
    minuteOfWeek: localNow.getUTCDay() * 1440 + localNow.getUTCHours() * 60 + localNow.getUTCMinutes(),
  };
}

function isOpenNow(hours: GoogleOpeningHours | undefined, utcOffsetMinutes?: number) {
  const periods = hours?.periods;
  if (!periods?.length) return undefined;
  const { minuteOfWeek } = localDayAndMinute(utcOffsetMinutes);
  return periods.some(({ open, close }) => {
    if (!close) return true;
    const start = open.day * 1440 + open.hour * 60 + open.minute;
    let end = close.day * 1440 + close.hour * 60 + close.minute;
    if (end <= start) end += 7 * 1440;
    return (minuteOfWeek >= start && minuteOfWeek < end)
      || (minuteOfWeek + 7 * 1440 >= start && minuteOfWeek + 7 * 1440 < end);
  });
}

function todayHours(hours: GoogleOpeningHours | undefined, utcOffsetMinutes?: number) {
  const descriptions = hours?.weekdayDescriptions;
  if (!descriptions?.length) return "영업시간 정보 없음";
  const { day } = localDayAndMinute(utcOffsetMinutes);
  return descriptions.find((description) => description.startsWith(dayNames[day])) ?? descriptions[day] ?? "영업시간 정보 없음";
}

function appendGoogleDetails(container: HTMLElement, place: GooglePlace) {
  container.className = "google-place-live";
  container.replaceChildren();

  const photo = place.photos?.[0];
  if (photo) {
    const photoLink = document.createElement("a");
    photoLink.className = "google-place-photo-link";
    photoLink.href = photo.googleMapsURI || place.googleMapsURI || "#";
    photoLink.target = "_blank";
    photoLink.rel = "noreferrer";
    photoLink.setAttribute("aria-label", "Google Maps에서 장소 사진 보기");
    const image = document.createElement("img");
    image.className = "google-place-photo";
    image.src = photo.getURI({ maxWidth: 480, maxHeight: 260 });
    image.alt = "Google 제공 장소 사진";
    image.loading = "lazy";
    photoLink.append(image);
    container.append(photoLink);

    const attributions = photo.authorAttributions ?? [];
    if (attributions.length) {
      const attribution = document.createElement("p");
      attribution.className = "google-photo-attribution";
      attribution.append("사진: ");
      attributions.forEach((author, index) => {
        if (index) attribution.append(", ");
        if (author.uri) {
          const link = document.createElement("a");
          link.href = author.uri;
          link.target = "_blank";
          link.rel = "noreferrer";
          link.textContent = author.displayName;
          attribution.append(link);
        } else {
          attribution.append(author.displayName);
        }
      });
      container.append(attribution);
    }
  }

  const details = document.createElement("div");
  details.className = "google-place-meta";
  if (typeof place.rating === "number") {
    const rating = document.createElement("span");
    rating.className = "google-place-rating";
    rating.textContent = `★ ${place.rating.toFixed(1)}${typeof place.userRatingCount === "number" ? ` (${place.userRatingCount.toLocaleString("ko-KR")})` : ""}`;
    details.append(rating);
  }

  const open = isOpenNow(place.currentOpeningHours, place.utcOffsetMinutes);
  if (typeof open === "boolean") {
    const status = document.createElement("span");
    status.className = `google-open-status ${open ? "is-open" : "is-closed"}`;
    status.textContent = open ? "영업 중" : "영업 종료";
    details.append(status);
  }
  if (details.childNodes.length) container.append(details);

  const hours = document.createElement("p");
  hours.className = "google-today-hours";
  hours.textContent = todayHours(place.currentOpeningHours, place.utcOffsetMinutes);
  container.append(hours);
  if (!photo && !details.childNodes.length && !place.currentOpeningHours) {
    container.className = "google-place-live is-empty";
    hours.textContent = "Google에 등록된 사진, 평점 또는 영업시간 정보가 없습니다.";
  }
}

async function hydrateGooglePlaceDetails(
  maps: Awaited<ReturnType<typeof loadGoogleMaps>>,
  item: Candidate,
  container: HTMLElement,
) {
  container.className = "google-place-live is-loading";
  container.textContent = "Google 장소 정보를 불러오는 중...";
  try {
    const library = await maps.importLibrary("places") as GooglePlacesLibrary;
    let placeId = item.googlePlaceId;
    if (!placeId) {
      const result = await library.Place.searchByText({
        textQuery: item.title,
        fields: ["id"],
        locationBias: { center: coordinates(item.coords), radius: 5000 },
        maxResultCount: 1,
        language: "ko",
      });
      placeId = result.places[0]?.id;
    }
    if (!placeId) throw new Error("일치하는 Google 장소가 없습니다.");
    const place = new library.Place({ id: placeId, requestedLanguage: "ko" });
    const result = await place.fetchFields({
      fields: ["rating", "userRatingCount", "currentOpeningHours", "utcOffsetMinutes", "photos", "googleMapsURI"],
    });
    appendGoogleDetails(container, result.place ?? place);
  } catch (cause) {
    console.warn("Google 장소 상세 정보 조회 실패", cause);
    container.className = "google-place-live is-error";
    const detail = cause instanceof Error ? cause.message : "알 수 없는 오류";
    container.textContent = `사진 · 평점 · 영업시간을 불러오지 못했습니다.${import.meta.env.DEV ? ` (${detail})` : ""}`;
  }
}

export default function GoogleMapView({
  apiKey,
  places,
  unscheduledCandidates,
  searchResults,
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
}: {
  apiKey: string;
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
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GoogleMapInstance | null>(null);
  const mapsApiRef = useRef<GoogleMapsApi | null>(null);
  const markersRef = useRef<Record<string, MarkerEntry>>({});
  const markerCategoriesRef = useRef<Record<string, PlaceCategory>>({});
  const searchMarkersRef = useRef<Record<string, MarkerEntry>>({});
  const polylinesRef = useRef<GooglePolylineInstance[]>([]);
  const spiderLinesRef = useRef<GooglePolylineInstance[]>([]);
  const overlapGroupsRef = useRef<Record<string, OverlapGroup>>({});
  const originalPositionsRef = useRef<Record<string, [number, number]>>({});
  const spiderfiedIdsRef = useRef<string[]>([]);
  const expandOverlapRef = useRef<(id: string) => void>(() => undefined);
  const cameraRef = useRef<{ center: { lat: number; lng: number }; zoom: number } | null>(null);
  const onSelectRef = useRef(onSelect);
  const onCommentRef = useRef(onComment);
  const onEditRef = useRef(onEdit);
  const showPinNotesRef = useRef(showPinNotes);
  const commentCountsRef = useRef(commentCounts);
  const getReviewUrlRef = useRef(getReviewUrl);
  const [readyToken, setReadyToken] = useState(0);
  const [openMarkerId, setOpenMarkerId] = useState<string | null>(null);
  const [mapError, setMapError] = useState("");
  const [routeError, setRouteError] = useState("");

  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { onCommentRef.current = onComment; }, [onComment]);
  useEffect(() => { onEditRef.current = onEdit; }, [onEdit]);
  useEffect(() => { showPinNotesRef.current = showPinNotes; }, [showPinNotes]);
  useEffect(() => { commentCountsRef.current = commentCounts; }, [commentCounts]);
  useEffect(() => { getReviewUrlRef.current = getReviewUrl; }, [getReviewUrl]);

  useEffect(() => {
    let cancelled = false;
    const listeners: GoogleMapsListener[] = [];
    const initialize = async () => {
      if (!containerRef.current) return;
      try {
        const maps = await loadGoogleMaps(apiKey);
        if (cancelled || !containerRef.current) return;
        const savedCamera = cameraRef.current;
        const first = savedCamera?.center ?? coordinates(places[0]?.coords ?? unscheduledCandidates[0]?.coords ?? [10.2899, 103.984]);
        const map = new maps.Map(containerRef.current, {
          center: first,
          zoom: savedCamera?.zoom ?? 12,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          gestureHandling: "greedy",
        });
        const bounds = new maps.LatLngBounds();
        mapRef.current = map;
        mapsApiRef.current = maps;
        markersRef.current = {};
        markerCategoriesRef.current = {};
        overlapGroupsRef.current = {};
        originalPositionsRef.current = {};
        spiderfiedIdsRef.current = [];

        const collapseOverlapGroup = () => {
          spiderfiedIdsRef.current.forEach((id) => {
            const original = originalPositionsRef.current[id];
            if (original) markersRef.current[id]?.marker.setPosition(coordinates(original));
          });
          spiderLinesRef.current.forEach((line) => line.setMap(null));
          spiderLinesRef.current = [];
          spiderfiedIdsRef.current = [];
        };
        const expandOverlapGroup = (id: string) => {
          const group = overlapGroupsRef.current[id];
          if (!group || group.ids.length < 2) { collapseOverlapGroup(); return; }
          collapseOverlapGroup();
          const zoom = map.getZoom() ?? 13;
          const latitudeRadians = group.center[0] * Math.PI / 180;
          const metersPerPixel = 156543.03392 * Math.cos(latitudeRadians) / 2 ** zoom;
          const radiusMeters = Math.max(32, Math.min(48, 25 + group.ids.length * 4)) * metersPerPixel;
          const latitudeScale = 1 / 111_320;
          const longitudeScale = 1 / (111_320 * Math.max(0.2, Math.cos(latitudeRadians)));
          group.ids.forEach((markerId, index) => {
            const angle = -Math.PI / 2 + index * (Math.PI * 2 / group.ids.length);
            const position = {
              lat: group.center[0] + Math.sin(angle) * radiusMeters * latitudeScale,
              lng: group.center[1] + Math.cos(angle) * radiusMeters * longitudeScale,
            };
            markersRef.current[markerId]?.marker.setPosition(position);
            const line = new maps.Polyline({
              map,
              path: [coordinates(group.center), position],
              strokeColor: "#657b72",
              strokeOpacity: 0.58,
              strokeWeight: 1.5,
              clickable: false,
              zIndex: 2,
            });
            spiderLinesRef.current.push(line);
          });
          spiderfiedIdsRef.current = [...group.ids];
        };
        expandOverlapRef.current = expandOverlapGroup;

        const closePopups = () => [...Object.values(markersRef.current), ...Object.values(searchMarkersRef.current)].forEach(({ info }) => info.close());
        const makeEntry = (
          item: Candidate,
          status: "확정" | "후보" | "날짜 미정 후보",
          marker: GoogleMarkerInstance,
          controls?: { commentCount: number; openComments: () => void; edit: () => void },
        ) => {
          const popup = popupContent(item, status, getReviewUrlRef.current(item), controls?.commentCount, controls?.openComments, controls?.edit, onCategoryOnly);
          const info = new maps.InfoWindow({ content: popup.content, headerDisabled: true });
          popup.closeButton.addEventListener("click", () => { info.close(); setOpenMarkerId(null); });
          let detailsPromise: Promise<void> | null = null;
          const loadDetails = () => {
            if (!detailsPromise) detailsPromise = hydrateGooglePlaceDetails(maps, item, popup.liveDetails);
            return detailsPromise;
          };
          const kind = status === "확정" ? "primary" : status === "후보" ? "candidate" : "unscheduled";
          return { marker, info, loadDetails, noteLabel: pinNoteLabel(item, kind), persistentNote: status === "확정" };
        };

        places.forEach((place, index) => {
          const position = coordinates(place.coords);
          bounds.extend(position);
          originalPositionsRef.current[place.id] = place.coords;
          const marker = new maps.Marker({
            map,
            position,
            title: place.title,
            icon: primaryPinIcon(index),
            label: pinNoteLabel(place, "primary"),
          });
          const entry = makeEntry(place, "확정", marker, {
            commentCount: commentCountsRef.current[place.id] ?? 0,
            openComments: () => onCommentRef.current(place.id),
            edit: () => onEditRef.current(place.id),
          });
          listeners.push(marker.addListener("click", () => {
            closePopups();
            expandOverlapGroup(place.id);
            setOpenMarkerId(place.id);
            onSelectRef.current(place.id);
            entry.info.open({ map, anchor: marker });
            void entry.loadDetails();
          }));
          markersRef.current[place.id] = entry;
          markerCategoriesRef.current[place.id] = placeCategory(place);

          place.alternatives.forEach((candidate) => {
            const candidatePosition = coordinates(candidate.coords);
            bounds.extend(candidatePosition);
            originalPositionsRef.current[candidate.id] = candidate.coords;
            const candidateMarker = new maps.Marker({
              map,
              position: candidatePosition,
              title: candidate.title,
              icon: candidatePinIcon,
            });
            const candidateEntry = makeEntry(candidate, "후보", candidateMarker, {
              commentCount: commentCountsRef.current[candidate.id] ?? 0,
              openComments: () => onCommentRef.current(candidate.id),
              edit: () => onEditRef.current(candidate.id),
            });
            listeners.push(candidateMarker.addListener("click", () => {
              closePopups();
              expandOverlapGroup(candidate.id);
              setOpenMarkerId(candidate.id);
              onSelectRef.current(candidate.id);
              map.panTo(candidatePosition);
              candidateEntry.info.open({ map, anchor: candidateMarker });
              void candidateEntry.loadDetails();
            }));
            listeners.push(candidateMarker.addListener("mouseover", () => candidateMarker.setLabel(showPinNotesRef.current ? candidateEntry.noteLabel ?? null : null)));
            listeners.push(candidateMarker.addListener("mouseout", () => candidateMarker.setLabel(null)));
            markersRef.current[candidate.id] = candidateEntry;
            markerCategoriesRef.current[candidate.id] = placeCategory(candidate);
          });
        });

        unscheduledCandidates.forEach((candidate) => {
          const position = coordinates(candidate.coords);
          bounds.extend(position);
          originalPositionsRef.current[candidate.id] = candidate.coords;
          const marker = new maps.Marker({
            map,
            position,
            title: `날짜 미정 후보 · ${candidate.title}`,
            icon: unscheduledPinIcon,
          });
          const entry = makeEntry(candidate, "날짜 미정 후보", marker, {
            commentCount: commentCountsRef.current[candidate.id] ?? 0,
            openComments: () => onCommentRef.current(candidate.id),
            edit: () => onEditRef.current(candidate.id),
          });
          listeners.push(marker.addListener("click", () => {
            closePopups();
            expandOverlapGroup(candidate.id);
            setOpenMarkerId(candidate.id);
            onSelectRef.current(candidate.id);
            map.panTo(position);
            entry.info.open({ map, anchor: marker });
            void entry.loadDetails();
          }));
          listeners.push(marker.addListener("mouseover", () => marker.setLabel(showPinNotesRef.current ? entry.noteLabel ?? null : null)));
          listeners.push(marker.addListener("mouseout", () => marker.setLabel(null)));
          markersRef.current[candidate.id] = entry;
          markerCategoriesRef.current[candidate.id] = placeCategory(candidate);
        });

        const groupedIds = new Map<string, string[]>();
        Object.entries(originalPositionsRef.current).forEach(([id, coords]) => {
          const key = overlapPositionKey(coords);
          groupedIds.set(key, [...(groupedIds.get(key) ?? []), id]);
        });
        groupedIds.forEach((ids) => {
          if (ids.length < 2) return;
          const center = originalPositionsRef.current[ids[0]];
          const group = { center, ids };
          ids.forEach((id) => { overlapGroupsRef.current[id] = group; });
        });
        listeners.push(map.addListener("zoom_changed", collapseOverlapGroup));

        if (places.length > 1) {
          try {
            const { Route } = await maps.importLibrary("routes") as RouteLibrary;
            const { routes } = await Route.computeRoutes({
              origin: coordinates(places[0].coords),
              destination: coordinates(places[places.length - 1].coords),
              intermediates: places.slice(1, -1).map((place) => ({ location: coordinates(place.coords) })),
              travelMode: "DRIVING",
              routingPreference: "TRAFFIC_UNAWARE",
              polylineQuality: "OVERVIEW",
              fields: ["path"],
            });
            if (!cancelled && routes?.[0]) {
              polylinesRef.current = routes[0].createPolylines();
              polylinesRef.current.forEach((polyline) => {
                polyline.setOptions({ strokeColor: "#ef765f", strokeOpacity: 0.94, strokeWeight: 5 });
                polyline.setMap(map);
              });
            }
            setRouteError("");
          } catch (error) {
            console.warn("Google 자동차 경로 계산 실패", error);
            setRouteError("자동차 경로를 불러오지 못했습니다. Google Cloud에서 Routes API 사용 설정을 확인해주세요.");
          }
        } else {
          setRouteError("");
        }
        const mapPointCount = places.reduce((sum, place) => sum + 1 + place.alternatives.length, unscheduledCandidates.length);
        if (!savedCamera) {
          if (places.length) {
            map.panTo(coordinates(places[0].coords));
            map.setZoom(13);
          } else if (mapPointCount > 1) map.fitBounds(bounds, 64);
        }
        setMapError("");
        setReadyToken((value) => value + 1);
      } catch {
        if (!cancelled) setMapError("Google 지도를 불러오지 못했습니다. API 키와 허용 도메인을 확인해주세요.");
      }
    };
    void initialize();
    return () => {
      cancelled = true;
      const map = mapRef.current;
      const center = map?.getCenter();
      const zoom = map?.getZoom();
      if (center && typeof zoom === "number") cameraRef.current = { center: { lat: center.lat(), lng: center.lng() }, zoom };
      listeners.forEach((listener) => listener.remove());
      Object.values(markersRef.current).forEach(({ marker, info }) => {
        info.close();
        marker.setMap(null);
      });
      Object.values(searchMarkersRef.current).forEach(({ marker, info }) => {
        info.close();
        marker.setMap(null);
      });
      polylinesRef.current.forEach((polyline) => polyline.setMap(null));
      spiderLinesRef.current.forEach((polyline) => polyline.setMap(null));
      markersRef.current = {};
      markerCategoriesRef.current = {};
      searchMarkersRef.current = {};
      polylinesRef.current = [];
      spiderLinesRef.current = [];
      overlapGroupsRef.current = {};
      originalPositionsRef.current = {};
      spiderfiedIdsRef.current = [];
      expandOverlapRef.current = () => undefined;
      mapRef.current = null;
      mapsApiRef.current = null;
    };
  }, [apiKey, onCategoryOnly, places, unscheduledCandidates]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyToken) return;
    Object.entries(markersRef.current).forEach(([id, { marker, info, noteLabel, persistentNote }]) => {
      const visible = visibleCategories.includes(markerCategoriesRef.current[id]);
      if (!visible) info.close();
      marker.setMap(visible ? map : null);
      marker.setLabel(visible && persistentNote && showPinNotes ? noteLabel ?? null : null);
    });
  }, [focusPoint, openMarkerId, readyToken, selectedId, showPinNotes, visibleCategories]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = mapsApiRef.current;
    if (!map || !maps || !readyToken) return;
    const listeners: GoogleMapsListener[] = [];
    const closePopups = () => [...Object.values(markersRef.current), ...Object.values(searchMarkersRef.current)].forEach(({ info }) => info.close());
    searchMarkersRef.current = {};
    if (!searchResults.length) return;

    const bounds = new maps.LatLngBounds();
    searchResults.forEach((result, index) => {
      const position = coordinates(result.coords);
      bounds.extend(position);
      const marker = new maps.Marker({
        map,
        position,
        title: `검색 결과 ${index + 1}. ${result.title}`,
        icon: searchResultPinIcon(index),
      });
      const item: Candidate = {
        id: `search-${result.placeId}`,
        time: "",
        title: result.title,
        category: "other",
        note: result.address,
        coords: result.coords,
        googleMapsUrl: result.googleMapsUrl,
        googlePlaceId: result.placeId,
      };
      const popup = popupContent(item, "검색 결과", getReviewUrlRef.current(item), undefined, undefined, undefined, onCategoryOnly);
      const info = new maps.InfoWindow({ content: popup.content, headerDisabled: true });
      popup.closeButton.addEventListener("click", () => info.close());
      let detailsPromise: Promise<void> | null = null;
      const loadDetails = () => {
        if (!detailsPromise) detailsPromise = hydrateGooglePlaceDetails(maps, item, popup.liveDetails);
        return detailsPromise;
      };
      const entry = { marker, info, loadDetails, persistentNote: false };
      listeners.push(marker.addListener("click", () => {
        closePopups();
        map.panTo(position);
        info.open({ map, anchor: marker });
        void loadDetails();
      }));
      searchMarkersRef.current[result.placeId] = entry;
    });

    if (searchResults.length === 1) {
      map.panTo(coordinates(searchResults[0].coords));
      map.setZoom(15);
    } else {
      map.fitBounds(bounds, 72);
    }

    return () => {
      listeners.forEach((listener) => listener.remove());
      Object.values(searchMarkersRef.current).forEach(({ marker, info }) => {
        info.close();
        marker.setMap(null);
      });
      searchMarkersRef.current = {};
    };
  }, [onCategoryOnly, readyToken, searchResults]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyToken) return;
    const markerId = focusPoint?.id ?? selectedId;
    const position = focusPoint?.coords ?? places.find((place) => place.id === selectedId)?.coords;
    const entry = markersRef.current[markerId];
    if (!position || !entry) return;
    [...Object.values(markersRef.current), ...Object.values(searchMarkersRef.current)].forEach(({ info }) => info.close());
    expandOverlapRef.current(markerId);
    setOpenMarkerId(markerId);
    map.panTo(coordinates(position));
    entry.info.open({ map, anchor: entry.marker });
    // Opening a place through the route controls or initial selection should
    // hydrate the same photo/rating/hours content as a direct marker click.
    void entry.loadDetails();
  }, [focusPoint, places, readyToken, selectedId, unscheduledCandidates]);

  return <div className="google-map-shell"><div ref={containerRef} className="map-canvas" aria-label="Google Maps 여행 일정 자동차 경로 지도" />{mapError && <div className="map-api-error" role="alert">{mapError}</div>}{routeError && <div className="map-route-error" role="status">{routeError}</div>}</div>;
}
