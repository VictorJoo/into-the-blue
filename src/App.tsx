"use client";

import { CSSProperties, FormEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signOut } from "./lib/auth";
import { supabase } from "./lib/supabase";
import { categoryMeta, inferPlaceCategory, PLACE_CATEGORIES, placeCategory } from "./categories";
import GooglePlaceSearch, { type GooglePlaceSelection } from "./GooglePlaceSearch";
import MapView from "./MapView";
import type { Candidate, DragItem, MapSearchResult, Place, PlaceCategory } from "./types";
import { useWorkspace, type WorkspaceTrip } from "./workspace";

type Comment = { id: string; userId: string; name: string; avatarUrl?: string; content: string; createdAt: string };
type CommentsByPlace = Record<string, Comment[]>;
type SchedulesByDate = Record<string, Place[]>;
type DeleteTarget = { placeId: string; candidateId?: string };
type EditTarget = { date: string; placeId: string; candidateId?: string };
type AddRank = "primary" | "candidate" | "unscheduled";
type CourseDefinition = { id: string; name: string; position: number };
type PlaceEditValues = {
  title: string;
  placeName: string;
  date: string;
  time: string;
  coords: [number, number];
  googleMapsUrl?: string;
  googlePlaceId?: string;
  googleLocationUpdatedAt?: string;
  parentId?: string;
  note: string;
  category: PlaceCategory;
};
const CATEGORY_SCHEMA_VERSION = 20260812;
const DEFAULT_COURSE_ID = "course-a";

function defaultCourseName(index: number) {
  return index < 26 ? `${String.fromCharCode(65 + index)}코스` : `${index + 1}코스`;
}

function defaultCourses(): CourseDefinition[] {
  return [{ id: DEFAULT_COURSE_ID, name: "A코스", position: 0 }];
}

function placeCourseId(place: Pick<Candidate, "courseId">) {
  return place.courseId?.trim() || DEFAULT_COURSE_ID;
}

function normalizeCourses(items: Place[], configured: CourseDefinition[] = []) {
  const courses = new Map<string, CourseDefinition>();
  configured.forEach((course, index) => {
    const id = course.id?.trim();
    const name = course.name?.trim();
    if (id && name) courses.set(id, { id, name, position: Number.isFinite(course.position) ? course.position : index });
  });
  items.forEach((place) => {
    const id = placeCourseId(place);
    if (!courses.has(id)) courses.set(id, { id, name: place.courseName?.trim() || (id === DEFAULT_COURSE_ID ? "A코스" : defaultCourseName(courses.size)), position: courses.size });
  });
  if (!courses.size) return defaultCourses();
  return [...courses.values()]
    .sort((a, b) => a.id === DEFAULT_COURSE_ID ? -1 : b.id === DEFAULT_COURSE_ID ? 1 : a.position - b.position)
    .map((course, index) => ({ ...course, position: index }));
}

function applyCourseMetadata(items: Place[], courses: CourseDefinition[]) {
  const names = new Map(courses.map((course) => [course.id, course.name]));
  return items.map((place) => {
    const courseId = placeCourseId(place);
    return { ...place, courseId, courseName: names.get(courseId) ?? place.courseName ?? "A코스" };
  });
}

function minutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(value: string, options: Intl.DateTimeFormatOptions = { month: "long", day: "numeric", weekday: "short" }) {
  return new Intl.DateTimeFormat("ko-KR", options).format(new Date(`${value}T12:00:00`));
}

function formatTripDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" }).format(new Date(`${value}T12:00:00`));
}

function relativeDateLabel(value: string, today: string) {
  if (value === today) return "오늘";
  const difference = Math.round((new Date(`${value}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86_400_000);
  if (difference === -1) return "어제";
  if (difference === 1) return "내일";
  return formatDate(value, { month: "long", day: "numeric" });
}

function dDayLabel(startDate: string, today: string) {
  const difference = Math.round((new Date(`${startDate}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86_400_000);
  if (difference === 0) return "D-DAY";
  return difference > 0 ? `D-${difference}` : `D+${Math.abs(difference)}`;
}

function formatCommentTime(value: string) {
  const date = new Date(value);
  const difference = Date.now() - date.getTime();
  if (difference < 60_000) return "방금";
  if (difference < 3_600_000) return `${Math.floor(difference / 60_000)}분 전`;
  if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)}시간 전`;
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(date);
}

function cleanPlaceLabel(value?: string) {
  const label = value?.trim() ?? "";
  return label === "시간 미정" || label === "Google Maps 장소" ? "" : label;
}

function placeSearchName(item: Pick<Candidate, "title" | "placeName" | "googleMapsUrl">) {
  const savedName = item.placeName?.trim();
  if (savedName) return savedName;
  if (item.googleMapsUrl) {
    try {
      const url = new URL(item.googleMapsUrl);
      const queryName = url.searchParams.get("query")?.trim() || url.searchParams.get("q")?.trim();
      if (queryName) return queryName;
      const pathMatch = url.pathname.match(/\/maps\/place\/([^/]+)/);
      if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]).replace(/\+/g, " ").trim();
    } catch { /* fall back to the itinerary title for legacy links */ }
  }
  return item.title;
}

function normalizedPlaceName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function distanceMeters(from: [number, number], to: [number, number]) {
  const radians = (degree: number) => degree * Math.PI / 180;
  const latitudeDelta = radians(to[0] - from[0]);
  const longitudeDelta = radians(to[1] - from[1]);
  const latitude1 = radians(from[0]);
  const latitude2 = radians(to[0]);
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function sortCandidates(items: Candidate[]) {
  return [...items]
    .map((candidate) => ({
      ...candidate,
      category: candidate.categoryManual ? placeCategory(candidate) : inferPlaceCategory(candidate),
      categoryVersion: CATEGORY_SCHEMA_VERSION,
    }))
    .sort((a, b) => minutes(a.time) - minutes(b.time));
}

function sortPlaces(items: Place[]) {
  return [...items]
    .map((place) => ({
      ...place,
      category: place.categoryManual ? placeCategory(place) : inferPlaceCategory(place),
      categoryVersion: CATEGORY_SCHEMA_VERSION,
      duration: cleanPlaceLabel(place.duration),
      alternatives: sortCandidates(place.alternatives),
    }))
    .sort((a, b) => minutes(a.time) - minutes(b.time));
}

function newId(prefix = "place") {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
}

function googleReviewsUrl(place: Pick<Candidate, "title" | "coords" | "googleMapsUrl" | "googlePlaceId">) {
  if (place.googleMapsUrl) {
    try {
      const url = new URL(place.googleMapsUrl);
      if (url.hostname.includes("google.") && url.pathname.includes("/maps/place/") && url.pathname.includes("/data=")) {
        if (!url.pathname.includes("!9m1!1b1")) url.pathname = `${url.pathname}!9m1!1b1`;
        return url.toString();
      }
    } catch { /* fall through to a supported Maps search URL */ }
  }
  const query = encodeURIComponent(`${place.title} 리뷰 ${place.coords[0]},${place.coords[1]}`);
  return `https://www.google.com/maps/search/?api=1&query=${query}${place.googlePlaceId ? `&query_place_id=${encodeURIComponent(place.googlePlaceId)}` : ""}`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}

function noteHtml(value: string) {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

type ParsedGoogleMapsLink = { url: string; title: string; coords: [number, number] };

function parseGoogleMapsLink(input: string): ParsedGoogleMapsLink | null {
  let raw = input.trim().replace(/\\([()])/g, "$1");
  const markdownStart = raw.indexOf("](");
  if (markdownStart >= 0 && raw.endsWith(")")) raw = raw.slice(markdownStart + 2, -1);
  const urlMatch = raw.match(/https:\/\/[^\s]+/i);
  if (!urlMatch) return null;
  raw = urlMatch[0];

  let parsedUrl: URL;
  try { parsedUrl = new URL(raw); }
  catch { return null; }
  const hostname = parsedUrl.hostname.toLowerCase();
  if (!(hostname === "google.com" || hostname.endsWith(".google.com") || hostname === "maps.app.goo.gl")) return null;

  const decoded = decodeURIComponent(raw);
  const exact = decoded.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  const viewport = decoded.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const coordinates = exact ?? viewport;
  if (!coordinates) return null;

  const titleMatch = parsedUrl.pathname.match(/\/maps\/place\/([^/]+)/);
  let title = titleMatch ? decodeURIComponent(titleMatch[1]).replace(/\+/g, " ") : "";
  title = title.replace(/\s+/g, " ").trim();
  return { url: parsedUrl.toString(), title, coords: [Number(coordinates[1]), Number(coordinates[2])] };
}

function openGoogleMapsSearch(query: string) {
  const searchQuery = query.trim();
  if (!searchQuery) return;
  window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchQuery)}`, "_blank", "noopener,noreferrer");
}

function searchGoogleMapsOnEnter(event: ReactKeyboardEvent<HTMLInputElement>, query: string) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  openGoogleMapsSearch(query);
}

function asCandidate(place: Place): Candidate {
  return {
    id: place.id,
    time: place.time,
    title: place.title,
    placeName: place.placeName,
    courseId: place.courseId,
    courseName: place.courseName,
    category: place.category,
    note: place.note,
    coords: place.coords,
    googleMapsUrl: place.googleMapsUrl,
    googlePlaceId: place.googlePlaceId,
    googleLocationUpdatedAt: place.googleLocationUpdatedAt,
  };
}

function asPrimary(candidate: Candidate, time: string, alternatives: Candidate[] = []): Place {
  return { ...candidate, time, duration: "", alternatives: sortCandidates(alternatives) };
}

function getTimeline(now: Date, places: Place[], selectedDate: string) {
  if (!places.length) return { active: 0, progress: 0, label: "일정을 추가해보세요" };
  const today = dateKey(now);
  if (selectedDate < today) return { active: places.length - 1, progress: 100, label: "완료된 일정" };
  if (selectedDate > today) return { active: 0, progress: 0, label: "예정된 일정" };
  const current = now.getHours() * 60 + now.getMinutes();
  const starts = places.map((place) => minutes(place.time));
  if (current < starts[0]) return { active: 0, progress: 0, label: "첫 일정 전" };
  if (current >= starts[starts.length - 1] + 80)
    return { active: starts.length - 1, progress: 100, label: "오늘 일정 완료" };
  let active = 0;
  for (let index = 0; index < starts.length; index += 1) {
    if (current >= starts[index]) active = index;
  }
  const start = starts[active];
  const end = starts[active + 1] ?? start + 80;
  const segment = Math.min(1, Math.max(0, (current - start) / (end - start)));
  const denominator = Math.max(1, starts.length - 1);
  return {
    active,
    progress: Math.min(100, ((active + segment) / denominator) * 100),
    label: `${places[active].title} 일정 중`,
  };
}

function CategoryPicker({ value, onChange }: { value: PlaceCategory; onChange: (value: PlaceCategory) => void }) {
  return <fieldset className="category-picker"><legend>카테고리</legend><div>{PLACE_CATEGORIES.map((category) => <button type="button" key={category.value} className={value === category.value ? "active" : ""} onClick={() => onChange(category.value)} aria-pressed={value === category.value}><span aria-hidden="true">{category.icon}</span>{category.label}</button>)}</div></fieldset>;
}

function CategoryTag({ item, onClick }: { item: Pick<Candidate, "title" | "note" | "category">; onClick?: () => void }) {
  const meta = categoryMeta(item);
  return <button type="button" className={`category-tag category-${meta.value}`} onClick={(event) => { event.stopPropagation(); onClick?.(); }} title={`${meta.label} 핀만 보기`}><span aria-hidden="true">{meta.icon}</span>{meta.label}</button>;
}

function AddPlacePanel({
  schedules,
  defaultDate,
  defaultTime,
  onClose,
  onAdd,
  onSearchResults,
}: {
  schedules: SchedulesByDate;
  defaultDate: string;
  defaultTime: string;
  onClose: () => void;
  onAdd: (candidate: Candidate, rank: AddRank, parentId: string, date: string) => void;
  onSearchResults: (places: MapSearchResult[]) => void;
}) {
  const googleSearchEnabled = Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim());
  const [searchQuery, setSearchQuery] = useState("");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState(defaultTime);
  const [rank, setRank] = useState<AddRank>("primary");
  const [parentId, setParentId] = useState(schedules[defaultDate]?.[0]?.id ?? "");
  const [selectedGooglePlace, setSelectedGooglePlace] = useState<GooglePlaceSelection | null>(null);
  const [googleUrl, setGoogleUrl] = useState("");
  const [parsedLink, setParsedLink] = useState<ParsedGoogleMapsLink | null>(null);
  const [memo, setMemo] = useState("");
  const [category, setCategory] = useState<PlaceCategory>("other");
  const [error, setError] = useState("");
  const itinerary = useMemo(() => sortPlaces(schedules[date] ?? []), [schedules, date]);

  const selectGooglePlace = (selection: GooglePlaceSelection) => {
    setSelectedGooglePlace(selection);
    setSearchQuery(selection.title);
    setTitle(selection.title);
    setError("");
  };

  const analyzeGoogleLink = (value = googleUrl) => {
    const parsed = parseGoogleMapsLink(value);
    if (!parsed) {
      setParsedLink(null);
      setError("좌표가 포함된 Google Maps 전체 링크인지 확인해주세요.");
      return;
    }
    setGoogleUrl(parsed.url);
    setParsedLink(parsed);
    if (parsed.title) {
      setSearchQuery(parsed.title);
      setTitle(parsed.title);
    }
    setError("");
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const location = googleSearchEnabled ? selectedGooglePlace : parsedLink;
    if (!title.trim() || !location || (rank !== "unscheduled" && (!date || !time))) {
      setError(googleSearchEnabled
        ? "Google 검색 결과에서 장소를 선택한 뒤 필요한 정보를 확인해주세요."
        : "Google Maps 전체 링크를 분석한 뒤 필요한 정보를 확인해주세요.");
      return;
    }
    if (rank === "candidate" && !parentId) {
      setError("후보를 넣을 확정 일정을 선택해주세요.");
      return;
    }
    onAdd(
      {
        id: newId(rank),
        time: rank === "unscheduled" ? "" : time,
        title: title.trim(),
        placeName: location.title,
        category,
        categoryVersion: CATEGORY_SCHEMA_VERSION,
        categoryManual: true,
        note: memo.trim(),
        coords: location.coords,
        googleMapsUrl: googleSearchEnabled ? selectedGooglePlace?.googleMapsUrl : parsedLink?.url,
        googlePlaceId: selectedGooglePlace?.placeId,
        googleLocationUpdatedAt: selectedGooglePlace?.locationRefreshedAt,
      },
      rank,
      parentId,
      date,
    );
    onClose();
  };

  return (
    <div className="add-panel" role="dialog" aria-label="새 장소 추가">
      <div className="popover-heading">
        <div><span className="eyebrow">{googleSearchEnabled ? "GOOGLE PLACE SEARCH" : "FREE MAP MODE"}</span><h3>새 장소 추가</h3></div>
        <button className="icon-button" onClick={onClose} aria-label="장소 추가 닫기" />
      </div>
      <p className="search-description">{googleSearchEnabled ? "장소를 검색해 결과를 선택한 뒤 일정 정보를 입력하세요." : "무료 지도 모드에서는 Google Maps의 좌표가 포함된 전체 링크로 장소를 추가할 수 있어요."}</p>
      <form className="place-form" onSubmit={submit}>
        {googleSearchEnabled ? <>
          <label className="field-label">장소명 또는 Google 지도 검색어</label>
          <GooglePlaceSearch value={searchQuery} onChange={setSearchQuery} onSelected={selectGooglePlace} onResultsChange={onSearchResults} locationBias={itinerary[0]?.coords ?? Object.values(schedules).flat()[0]?.coords} autoFocus />
          {selectedGooglePlace && <p className="link-status"><span>✓</span> 선택한 장소: {selectedGooglePlace.title}{selectedGooglePlace.address ? ` · ${selectedGooglePlace.address}` : ""}</p>}
        </> : <>
          <label className="field-label">Google Maps 전체 링크</label>
          <div className={`google-link-box ${parsedLink ? "is-valid" : ""}`}><span>G</span><input value={googleUrl} onChange={(event) => { const value = event.target.value; setGoogleUrl(value); setParsedLink(null); if (/!3d-?\d|@-?\d/.test(value)) window.setTimeout(() => analyzeGoogleLink(value), 0); }} placeholder="google.com/maps/place/... 링크 붙여넣기" aria-label="Google Maps 링크" autoFocus /><button type="button" onClick={() => analyzeGoogleLink()} disabled={!googleUrl.trim()}>분석</button></div>
          {parsedLink && <p className="link-status"><span>✓</span> 지도 위치를 확인했어요{parsedLink.title ? `: ${parsedLink.title}` : "."}</p>}
          <div className="or-divider"><span>또는</span></div>
          <label className="field-label">장소명 또는 Google 지도 검색어</label>
          <div className="search-box"><span>⌕</span><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => searchGoogleMapsOnEnter(event, searchQuery)} placeholder="예: 경주 불국사" /><button type="button" disabled={!searchQuery.trim()} onClick={() => openGoogleMapsSearch(searchQuery)}>Google 지도에서 검색 ↗</button></div>
        </>}
        <label className="title-field"><span>일정 제목</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={googleSearchEnabled ? "선택한 장소명이 자동으로 입력됩니다." : "지도 링크의 장소명이 자동으로 입력됩니다."} required /></label>
        <CategoryPicker value={category} onChange={setCategory} />
        <div className="form-divider" />
        <label className="memo-field"><span>장소 메모</span><textarea value={memo} onChange={(event) => setMemo(event.target.value)} rows={3} maxLength={300} placeholder="예약 정보, 주문할 메뉴, 만날 장소 등을 적어두세요." /></label>
        <div className="schedule-form-row rank-row">
          <fieldset>
            <legend>추가 위치</legend>
            <div className="rank-toggle">
              <button type="button" className={rank === "primary" ? "active" : ""} onClick={() => setRank("primary")}>확정 일정</button>
              <button type="button" className={rank === "candidate" ? "active" : ""} onClick={() => setRank("candidate")}>후보</button>
              <button type="button" className={rank === "unscheduled" ? "active" : ""} onClick={() => { setRank("unscheduled"); setError(""); }}>날짜 미정 후보</button>
            </div>
          </fieldset>
        </div>
        {rank !== "unscheduled" && <div className="schedule-date-time">
          <label><span>방문 날짜</span><input type="date" value={date} onChange={(event) => { const value = event.target.value; setDate(value); setParentId(schedules[value]?.[0]?.id ?? ""); setError(""); }} required /></label>
          <label><span>방문 시간</span><input type="time" value={time} onChange={(event) => setTime(event.target.value)} required /></label>
        </div>}
        {rank === "candidate" && (
          <label className="parent-select"><span>어느 일정의 후보인가요?</span><select value={parentId} onChange={(event) => setParentId(event.target.value)}>{itinerary.map((place) => <option value={place.id} key={place.id}>{place.time} · {place.title}</option>)}</select>{itinerary.length === 0 && <small>선택한 날짜에 확정 일정을 먼저 추가해주세요.</small>}</label>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions"><button type="button" onClick={onClose}>취소</button><button type="submit">{rank === "unscheduled" ? "후보 목록에 추가" : "일정에 추가"}</button></div>
      </form>
    </div>
  );
}

function EditPlacePanel({
  schedules,
  targetDate,
  place,
  candidate,
  onClose,
  onSave,
  onDelete,
  onSearchResults,
}: {
  schedules: SchedulesByDate;
  targetDate: string;
  place: Place;
  candidate?: Candidate;
  onClose: () => void;
  onSave: (values: PlaceEditValues) => void;
  onDelete: () => void;
  onSearchResults: (places: MapSearchResult[]) => void;
}) {
  const googleSearchEnabled = Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim());
  const item = candidate ?? place;
  const [searchQuery, setSearchQuery] = useState(() => placeSearchName(item));
  const [title, setTitle] = useState(item.title);
  const [placeName, setPlaceName] = useState(() => placeSearchName(item));
  const [date, setDate] = useState(targetDate);
  const [time, setTime] = useState(item.time);
  const [parentId, setParentId] = useState(place.id);
  const [googleUrl, setGoogleUrl] = useState(item.googleMapsUrl);
  const [googlePlaceId, setGooglePlaceId] = useState(item.googlePlaceId);
  const [googleLocationUpdatedAt, setGoogleLocationUpdatedAt] = useState(item.googleLocationUpdatedAt);
  const [coords, setCoords] = useState<[number, number]>(item.coords);
  const [memo, setMemo] = useState(item.note);
  const [category, setCategory] = useState<PlaceCategory>(placeCategory(item));
  const [selectedGooglePlace, setSelectedGooglePlace] = useState<GooglePlaceSelection | null>(null);
  const [parsedLink, setParsedLink] = useState<ParsedGoogleMapsLink | null>(null);
  const [error, setError] = useState("");
  const itinerary = useMemo(() => sortPlaces(schedules[date] ?? []), [schedules, date]);

  const selectGooglePlace = (selection: GooglePlaceSelection) => {
    setGoogleUrl(selection.googleMapsUrl);
    setGooglePlaceId(selection.placeId);
    setGoogleLocationUpdatedAt(selection.locationRefreshedAt);
    setCoords(selection.coords);
    setSelectedGooglePlace(selection);
    setSearchQuery(selection.title);
    setPlaceName(selection.title);
    setTitle(selection.title);
    setError("");
  };

  const analyzeGoogleLink = (value = googleUrl ?? "") => {
    const parsed = parseGoogleMapsLink(value);
    if (!parsed) {
      setParsedLink(null);
      setError("좌표가 포함된 Google Maps 전체 링크인지 확인해주세요.");
      return;
    }
    setGoogleUrl(parsed.url);
    setCoords(parsed.coords);
    setGooglePlaceId(undefined);
    setGoogleLocationUpdatedAt(undefined);
    setParsedLink(parsed);
    if (parsed.title) {
      setSearchQuery(parsed.title);
      setPlaceName(parsed.title);
      setTitle(parsed.title);
    }
    setError("");
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !date || !time) {
      setError("장소명, 날짜와 시간을 확인해주세요.");
      return;
    }
    if (candidate && !parentId) {
      setError("후보를 넣을 확정 일정을 선택해주세요.");
      return;
    }
    if (!googleSearchEnabled && googleUrl?.trim() && googleUrl.trim() !== (item.googleMapsUrl ?? "") && !parsedLink) {
      setError("새 Google Maps 링크는 분석 버튼을 눌러 위치를 확인해주세요.");
      return;
    }
    onSave({
      title: title.trim(),
      placeName,
      date,
      time,
      coords,
      googleMapsUrl: googleUrl,
      googlePlaceId,
      googleLocationUpdatedAt,
      parentId: candidate ? parentId : undefined,
      note: memo.trim(),
      category,
    });
  };

  return (
    <div className="add-panel edit-panel" role="dialog" aria-label={`${item.title} 수정`}>
      <div className="popover-heading">
        <div><span className="eyebrow">EDIT PLACE</span><h3>{candidate ? "후보 수정" : "일정 수정"}</h3></div>
        <button className="icon-button" onClick={onClose} aria-label="수정 창 닫기" />
      </div>
      <p className="search-description">{googleSearchEnabled ? "장소를 바꾸려면 검색 결과에서 새 장소를 선택하세요. 나머지 일정 정보만 수정할 수도 있습니다." : "장소 위치를 바꾸려면 새 Google Maps 전체 링크를 붙여넣고 분석하세요. 나머지 정보만 수정할 수도 있습니다."}</p>
      <form className="place-form" onSubmit={submit}>
        {googleSearchEnabled ? <>
          <label className="field-label">장소명 또는 Google 지도 검색어</label>
          <GooglePlaceSearch value={searchQuery} onChange={setSearchQuery} onSelected={selectGooglePlace} onResultsChange={onSearchResults} locationBias={item.coords} autoFocus />
          {selectedGooglePlace && <p className="link-status"><span>✓</span> 변경할 장소: {selectedGooglePlace.title}{selectedGooglePlace.address ? ` · ${selectedGooglePlace.address}` : ""}</p>}
        </> : <>
          <label className="field-label">Google Maps 전체 링크</label>
          <div className={`google-link-box ${parsedLink ? "is-valid" : ""}`}><span>G</span><input value={googleUrl ?? ""} onChange={(event) => { const value = event.target.value; setGoogleUrl(value); setParsedLink(null); if (/!3d-?\d|@-?\d/.test(value)) window.setTimeout(() => analyzeGoogleLink(value), 0); }} placeholder="장소를 바꾸려면 새 링크를 붙여넣으세요" aria-label="Google Maps 링크" autoFocus /><button type="button" onClick={() => analyzeGoogleLink()} disabled={!googleUrl?.trim()}>분석</button></div>
          {parsedLink && <p className="link-status"><span>✓</span> 지도 위치를 변경했어요{parsedLink.title ? `: ${parsedLink.title}` : "."}</p>}
          <div className="or-divider"><span>또는</span></div>
          <label className="field-label">장소명 또는 Google 지도 검색어</label>
          <div className="search-box"><span>⌕</span><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => searchGoogleMapsOnEnter(event, searchQuery)} placeholder="예: 경주 불국사" /><button type="button" disabled={!searchQuery.trim()} onClick={() => openGoogleMapsSearch(searchQuery)}>Google 지도에서 검색 ↗</button></div>
        </>}
        <label className="title-field"><span>일정 제목</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={googleSearchEnabled ? "선택한 장소명이 자동으로 입력됩니다." : "일정 제목을 입력해주세요."} required /></label>
        <CategoryPicker value={category} onChange={setCategory} />
        <div className="form-divider" />
        <label className="memo-field"><span>장소 메모</span><textarea value={memo} onChange={(event) => setMemo(event.target.value)} rows={3} maxLength={300} placeholder="예약 정보, 주문할 메뉴, 만날 장소 등을 적어두세요." /></label>
        <div className="schedule-date-time">
          <label><span>방문 날짜</span><input type="date" value={date} onChange={(event) => {
            const value = event.target.value;
            setDate(value);
            if (candidate) setParentId(value === targetDate ? place.id : schedules[value]?.[0]?.id ?? "");
            setError("");
          }} required /></label>
          <label><span>방문 시간</span><input type="time" value={time} onChange={(event) => setTime(event.target.value)} required /></label>
        </div>
        {candidate && (
          <label className="parent-select"><span>어느 일정의 후보인가요?</span><select value={parentId} onChange={(event) => setParentId(event.target.value)}>{itinerary.map((primary) => <option value={primary.id} key={primary.id}>{primary.time} · {primary.title}</option>)}</select>{itinerary.length === 0 && <small>선택한 날짜에 확정 일정이 없습니다.</small>}</label>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions edit-form-actions"><button className="form-delete-button" type="button" onClick={onDelete}>이 항목 삭제</button><button type="button" onClick={onClose}>취소</button><button type="submit">변경사항 저장</button></div>
      </form>
    </div>
  );
}

function EditUnscheduledPanel({ item, targetDate, confirmedPlaces, onClose, onSave, onDelete, onSearchResults }: {
  item: Candidate;
  targetDate: string;
  confirmedPlaces: Place[];
  onClose: () => void;
  onSave: (candidate: Candidate, targetPlaceId?: string) => void;
  onDelete: () => void;
  onSearchResults: (places: MapSearchResult[]) => void;
}) {
  const googleSearchEnabled = Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim());
  const [searchQuery, setSearchQuery] = useState(() => placeSearchName(item));
  const [title, setTitle] = useState(item.title);
  const [placeName, setPlaceName] = useState(() => placeSearchName(item));
  const [category, setCategory] = useState<PlaceCategory>(placeCategory(item));
  const [memo, setMemo] = useState(item.note);
  const [coords, setCoords] = useState(item.coords);
  const [googleMapsUrl, setGoogleMapsUrl] = useState(item.googleMapsUrl);
  const [googlePlaceId, setGooglePlaceId] = useState(item.googlePlaceId);
  const [googleLocationUpdatedAt, setGoogleLocationUpdatedAt] = useState(item.googleLocationUpdatedAt);
  const [googleUrl, setGoogleUrl] = useState(item.googleMapsUrl ?? "");
  const [parsedLink, setParsedLink] = useState<ParsedGoogleMapsLink | null>(null);
  const [targetPlaceId, setTargetPlaceId] = useState("");
  const [error, setError] = useState("");
  const selectGooglePlace = (selection: GooglePlaceSelection) => {
    setSearchQuery(selection.title); setPlaceName(selection.title); setTitle(selection.title); setCoords(selection.coords);
    setGoogleMapsUrl(selection.googleMapsUrl); setGooglePlaceId(selection.placeId); setGoogleLocationUpdatedAt(selection.locationRefreshedAt); setError("");
  };
  const analyzeGoogleLink = () => {
    const parsed = parseGoogleMapsLink(googleUrl);
    if (!parsed) { setError("좌표가 포함된 Google Maps 전체 링크인지 확인해주세요."); return; }
    setParsedLink(parsed); setCoords(parsed.coords); setGoogleMapsUrl(parsed.url); setGooglePlaceId(undefined); setGoogleLocationUpdatedAt(undefined);
    if (parsed.title) { setSearchQuery(parsed.title); setPlaceName(parsed.title); setTitle(parsed.title); }
    setError("");
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) { setError("일정 제목을 입력해주세요."); return; }
    onSave({ ...item, title: title.trim(), placeName, category, categoryVersion: CATEGORY_SCHEMA_VERSION, categoryManual: true, note: memo.trim(), coords, googleMapsUrl, googlePlaceId, googleLocationUpdatedAt }, targetPlaceId || undefined);
  };
  return <div className="add-panel edit-panel" role="dialog" aria-label={`${item.title} 수정`}>
    <div className="popover-heading"><div><span className="eyebrow">EDIT PLACE</span><h3>날짜 미정 후보 수정</h3></div><button className="icon-button" onClick={onClose} aria-label="수정 창 닫기" /></div>
    <p className="search-description">장소 정보와 카테고리, 메모를 수정하거나 후보를 삭제할 수 있습니다.</p>
    <form className="place-form" onSubmit={submit}>
      {googleSearchEnabled ? <><label className="field-label">장소명 또는 Google 지도 검색어</label><GooglePlaceSearch value={searchQuery} onChange={setSearchQuery} onSelected={selectGooglePlace} onResultsChange={onSearchResults} locationBias={item.coords} autoFocus /></> : <><label className="field-label">Google Maps 전체 링크</label><div className={`google-link-box ${parsedLink ? "is-valid" : ""}`}><span>G</span><input value={googleUrl} onChange={(event) => { setGoogleUrl(event.target.value); setParsedLink(null); }} aria-label="Google Maps 링크" autoFocus /><button type="button" onClick={analyzeGoogleLink}>분석</button></div>{parsedLink && <p className="link-status"><span>✓</span> 지도 위치를 변경했어요{parsedLink.title ? `: ${parsedLink.title}` : "."}</p>}<div className="or-divider"><span>또는</span></div><label className="field-label">장소명 또는 Google 지도 검색어</label><div className="search-box"><span>⌕</span><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => searchGoogleMapsOnEnter(event, searchQuery)} placeholder="예: 경주 불국사" /><button type="button" disabled={!searchQuery.trim()} onClick={() => openGoogleMapsSearch(searchQuery)}>Google 지도에서 검색 ↗</button></div></>}
      <label className="title-field"><span>일정 제목</span><input value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
      <CategoryPicker value={category} onChange={setCategory} />
      <div className="form-divider" />
      <label className="memo-field"><span>장소 메모</span><textarea value={memo} onChange={(event) => setMemo(event.target.value)} rows={3} maxLength={300} /></label>
      <label className="parent-select"><span>{formatDate(targetDate)} 확정 일정에 후보로 넣기</span><select value={targetPlaceId} onChange={(event) => setTargetPlaceId(event.target.value)}><option value="">날짜 미정 후보로 유지</option>{confirmedPlaces.map((place) => <option value={place.id} key={place.id}>{place.time} · {place.title}{place.courseName ? ` · ${place.courseName}` : ""}</option>)}</select>{confirmedPlaces.length === 0 && <small>현재 선택한 날짜에 확정 일정이 없습니다.</small>}</label>
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions edit-form-actions"><button className="form-delete-button" type="button" onClick={onDelete}>이 항목 삭제</button><button type="button" onClick={onClose}>취소</button><button type="submit">변경사항 저장</button></div>
    </form>
  </div>;
}

function AddCandidatePanel({ place, unscheduledCandidates, registeredItems, onClose, onAdd, onAddMany, onSearchResults, onPreview }: {
  place: Place;
  unscheduledCandidates: Candidate[];
  registeredItems: Candidate[];
  onClose: () => void;
  onAdd: (candidate: Candidate, sourceUnscheduledId?: string) => void;
  onAddMany: (candidates: Candidate[], sourceUnscheduledIds: string[]) => void;
  onSearchResults: (places: MapSearchResult[]) => void;
  onPreview: (candidate: Candidate) => void;
}) {
  const googleSearchEnabled = Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim());
  const [searchQuery, setSearchQuery] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<PlaceCategory>("other");
  const [memo, setMemo] = useState("");
  const [coords, setCoords] = useState<[number, number] | null>(null);
  const [googleMapsUrl, setGoogleMapsUrl] = useState<string | undefined>();
  const [googlePlaceId, setGooglePlaceId] = useState<string | undefined>();
  const [googleLocationUpdatedAt, setGoogleLocationUpdatedAt] = useState<string | undefined>();
  const [placeName, setPlaceName] = useState("");
  const [sourceUnscheduledId, setSourceUnscheduledId] = useState<string | undefined>();
  const [selectedRecommendationIds, setSelectedRecommendationIds] = useState<string[]>([]);
  const [googleUrl, setGoogleUrl] = useState("");
  const [parsedLink, setParsedLink] = useState<ParsedGoogleMapsLink | null>(null);
  const [error, setError] = useState("");

  const recommendations = useMemo(() => {
    const registeredIds = new Set(registeredItems.map((item) => item.id));
    const registeredPlaceIds = new Set(registeredItems.map((item) => item.googlePlaceId).filter(Boolean));
    const registeredNames = new Set(registeredItems.map((item) => normalizedPlaceName(item.title)));
    return unscheduledCandidates
      .filter((candidate) => !registeredIds.has(candidate.id))
      .filter((candidate) => !candidate.googlePlaceId || !registeredPlaceIds.has(candidate.googlePlaceId))
      .filter((candidate) => !registeredNames.has(normalizedPlaceName(candidate.title)))
      .map((candidate) => ({ candidate, distance: distanceMeters(place.coords, candidate.coords) }))
      .filter(({ distance }) => distance <= 1000)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 5);
  }, [place.coords, registeredItems, unscheduledCandidates]);

  const selectGooglePlace = (selection: GooglePlaceSelection) => {
    setSelectedRecommendationIds([]);
    setSearchQuery(selection.title);
    setTitle(selection.title);
    setPlaceName(selection.title);
    setCoords(selection.coords);
    setGoogleMapsUrl(selection.googleMapsUrl);
    setGooglePlaceId(selection.placeId);
    setGoogleLocationUpdatedAt(selection.locationRefreshedAt);
    setSourceUnscheduledId(undefined);
    setError("");
  };

  const populateRecommendation = (candidate: Candidate) => {
    setSearchQuery(placeSearchName(candidate));
    setTitle(candidate.title);
    setPlaceName(placeSearchName(candidate));
    setCategory(placeCategory(candidate));
    setMemo(candidate.note);
    setCoords(candidate.coords);
    setGoogleMapsUrl(candidate.googleMapsUrl);
    setGooglePlaceId(candidate.googlePlaceId);
    setGoogleLocationUpdatedAt(candidate.googleLocationUpdatedAt);
    setGoogleUrl(candidate.googleMapsUrl ?? "");
    setParsedLink(null);
    setSourceUnscheduledId(candidate.id);
  };

  const clearRecommendationFields = () => {
    setSearchQuery("");
    setTitle("");
    setPlaceName("");
    setCategory("other");
    setMemo("");
    setCoords(null);
    setGoogleMapsUrl(undefined);
    setGooglePlaceId(undefined);
    setGoogleLocationUpdatedAt(undefined);
    setGoogleUrl("");
    setSourceUnscheduledId(undefined);
  };

  const selectRecommendation = (candidate: Candidate) => {
    const wasSelected = selectedRecommendationIds.includes(candidate.id);
    const nextIds = wasSelected
      ? selectedRecommendationIds.filter((id) => id !== candidate.id)
      : [...selectedRecommendationIds, candidate.id];
    setSelectedRecommendationIds(nextIds);
    const remainingSingle = nextIds.length === 1
      ? recommendations.find(({ candidate: item }) => item.id === nextIds[0])?.candidate
      : undefined;
    if (remainingSingle) populateRecommendation(remainingSingle);
    else if (nextIds.length === 0) clearRecommendationFields();
    else setSourceUnscheduledId(undefined);
    setError("");
    onSearchResults([]);
    if (!wasSelected) onPreview(candidate);
  };

  const analyzeGoogleLink = () => {
    const parsed = parseGoogleMapsLink(googleUrl);
    if (!parsed) {
      setParsedLink(null);
      setError("좌표가 포함된 Google Maps 전체 링크인지 확인해주세요.");
      return;
    }
    setParsedLink(parsed);
    setCoords(parsed.coords);
    setGoogleMapsUrl(parsed.url);
    setGooglePlaceId(undefined);
    setGoogleLocationUpdatedAt(undefined);
    setSourceUnscheduledId(undefined);
    setSelectedRecommendationIds([]);
    if (parsed.title) {
      setSearchQuery(parsed.title);
      setTitle(parsed.title);
      setPlaceName(parsed.title);
    }
    setError("");
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (selectedRecommendationIds.length >= 2) {
      const selectedCandidates = selectedRecommendationIds
        .map((id) => recommendations.find(({ candidate }) => candidate.id === id)?.candidate)
        .filter((candidate): candidate is Candidate => Boolean(candidate))
        .map((candidate) => ({
          ...candidate,
          time: place.time,
          title: placeSearchName(candidate),
          placeName: placeSearchName(candidate),
        }));
      if (selectedCandidates.length < 2) {
        setError("일괄 추가할 후보를 두 곳 이상 선택해주세요.");
        return;
      }
      onAddMany(selectedCandidates, selectedRecommendationIds);
      return;
    }
    if (!title.trim() || !coords) {
      setError("검색 결과나 가까운 추천 장소를 선택해주세요.");
      return;
    }
    const source = sourceUnscheduledId ? unscheduledCandidates.find((candidate) => candidate.id === sourceUnscheduledId) : undefined;
    onAdd({
      ...source,
      id: source?.id ?? newId("candidate"),
      time: place.time,
      title: title.trim(),
      placeName: placeName || title.trim(),
      category,
      categoryVersion: CATEGORY_SCHEMA_VERSION,
      categoryManual: true,
      note: memo.trim(),
      coords,
      googleMapsUrl,
      googlePlaceId,
      googleLocationUpdatedAt,
    }, sourceUnscheduledId);
  };

  return <div className="add-panel candidate-add-panel" role="dialog" aria-label={`${place.title} 후보 장소 추가`}>
    <div className="popover-heading"><div><span className="eyebrow">ADD CANDIDATE</span><h3>후보 장소 추가</h3></div><button className="icon-button" onClick={onClose} aria-label="후보 장소 추가 닫기" /></div>
    <p className="search-description"><strong>{place.title}</strong>의 후보를 검색하거나 1km 이내의 날짜 미정 후보에서 선택하세요.</p>
    <form className="place-form" onSubmit={submit}>
      {recommendations.length > 0 && <section className="nearby-recommendations"><div><strong>가까운 날짜 미정 후보</strong><span>복수 선택 가능 · 1km 이내</span></div>{recommendations.map(({ candidate, distance }) => <button type="button" className={selectedRecommendationIds.includes(candidate.id) ? "active" : ""} key={candidate.id} onClick={() => selectRecommendation(candidate)} aria-pressed={selectedRecommendationIds.includes(candidate.id)}><i aria-hidden="true">{selectedRecommendationIds.includes(candidate.id) ? "✓" : ""}</i><span><strong>{candidate.title}</strong><small>{categoryMeta(candidate).icon} {categoryMeta(candidate).label}</small></span><b>{Math.max(1, Math.round(distance))}m</b></button>)}</section>}
      {unscheduledCandidates.length > 0 && recommendations.length === 0 && <p className="nearby-empty">1km 이내에 추천할 날짜 미정 후보가 없습니다.</p>}
      {selectedRecommendationIds.length < 2 && <>{googleSearchEnabled ? <><label className="field-label">장소명 또는 Google 지도 검색어</label><GooglePlaceSearch value={searchQuery} onChange={(value) => { setSearchQuery(value); setSourceUnscheduledId(undefined); setSelectedRecommendationIds([]); }} onSelected={selectGooglePlace} onResultsChange={onSearchResults} locationBias={place.coords} autoFocus={recommendations.length === 0} /></> : <><label className="field-label">Google Maps 전체 링크</label><div className={`google-link-box ${parsedLink ? "is-valid" : ""}`}><span>G</span><input value={googleUrl} onChange={(event) => { setGoogleUrl(event.target.value); setParsedLink(null); setSourceUnscheduledId(undefined); setSelectedRecommendationIds([]); }} placeholder="google.com/maps/place/... 링크 붙여넣기" aria-label="Google Maps 링크" autoFocus={recommendations.length === 0} /><button type="button" onClick={analyzeGoogleLink} disabled={!googleUrl.trim()}>분석</button></div></>}
        <label className="title-field"><span>일정 제목</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="선택한 장소명이 자동으로 입력됩니다." required /></label>
        <CategoryPicker value={category} onChange={setCategory} />
        <div className="form-divider" />
        <label className="memo-field"><span>장소 메모</span><textarea value={memo} onChange={(event) => setMemo(event.target.value)} rows={3} maxLength={300} placeholder="후보로 비교할 내용을 적어두세요." /></label></>}
      {selectedRecommendationIds.length >= 2 && <div className="bulk-candidate-summary"><strong>{selectedRecommendationIds.length}개 후보를 일괄 추가합니다</strong><span>각 후보의 장소명이 일정 제목으로 사용되고 기존 카테고리와 메모가 유지됩니다.</span></div>}
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions"><button type="button" onClick={onClose}>취소</button><button type="submit">{selectedRecommendationIds.length >= 2 ? `${selectedRecommendationIds.length}개 후보 일괄 추가` : "후보로 추가"}</button></div>
    </form>
  </div>;
}

function CommentPopover({
  place,
  comments,
  userName,
  avatarUrl,
  onClose,
  onAdd,
}: {
  place: Candidate;
  comments: Comment[];
  userName: string;
  avatarUrl?: string;
  onClose: () => void;
  onAdd: (content: string) => Promise<void>;
}) {
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!content.trim() || submitting) return;
    setSubmitting(true);
    await onAdd(content.trim());
    setContent("");
    setSubmitting(false);
  };

  return (
    <div className="comment-popover" role="dialog" aria-modal="true" aria-label={`${place.title} 댓글`}>
      <div className="popover-heading"><div><span className="eyebrow">함께 정하기</span><h3>{place.title} 댓글</h3></div><button className="icon-button" onClick={onClose} aria-label="댓글 닫기" /></div>
      <div className="comment-list">
        {comments.length === 0 && <p className="empty-comment">첫 의견을 남겨보세요.</p>}
        {comments.map((comment) => <article className="comment" key={comment.id}><div className="avatar">{comment.avatarUrl ? <img src={comment.avatarUrl} alt="" /> : comment.name.slice(0, 1)}</div><div><div className="comment-meta"><strong>{comment.name}</strong><span>{comment.createdAt}</span></div><p>{comment.content}</p></div></article>)}
      </div>
      <form className="comment-form" onSubmit={submit}><div className="comment-author"><div className="avatar small">{avatarUrl ? <img src={avatarUrl} alt="" /> : userName.slice(0, 1)}</div><strong>{userName}</strong><span>으로 작성</span></div><div className="comment-input-row"><textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="의견을 남겨주세요" aria-label="댓글 내용" rows={2} maxLength={160} /><button type="submit" disabled={!content.trim() || submitting} aria-label="댓글 등록">↑</button></div></form>
    </div>
  );
}

function DeleteDialog({
  place,
  candidate,
  onCancel,
  onPromote,
  onDeleteAll,
  onMoveCandidate,
}: {
  place: Place;
  candidate?: Candidate;
  onCancel: () => void;
  onPromote: () => void;
  onDeleteAll: () => void;
  onMoveCandidate: () => void;
}) {
  const next = sortCandidates(place.alternatives)[0];
  const title = candidate?.title ?? place.title;
  const hasCandidates = !candidate && place.alternatives.length > 0;
  return (
    <div className="delete-dialog" role="alertdialog" aria-modal="true" aria-label={`${title} 삭제 확인`}>
      <span className="delete-kicker">DELETE SCHEDULE</span>
      <h3>{title}을 삭제할까요?</h3>
      {candidate && <p>후보를 완전히 삭제하거나, 나중에 다시 정할 수 있도록 날짜 미정 후보로 옮길 수 있습니다.</p>}
      {!candidate && !hasCandidates && <p>이 확정 일정이 목록과 지도에서 삭제됩니다. 삭제 후에는 되돌릴 수 없습니다.</p>}
      {hasCandidates && <p>후보가 {place.alternatives.length}개 있습니다. 확정 일정만 삭제하면 <strong>{next.title}</strong>이 {place.time}의 새 확정 일정으로 올라옵니다.</p>}
      {hasCandidates && <div className="delete-preview"><span>다음 확정 일정</span><strong>{next.time} · {next.title}</strong></div>}
      <div className={`delete-actions ${candidate ? "is-candidate" : hasCandidates ? "" : "is-simple"}`}>
        <button onClick={onCancel}>취소</button>
        <button className="delete-all" onClick={onDeleteAll}>{hasCandidates ? "후보 포함 전체 삭제" : candidate ? "완전히 삭제" : "삭제하기"}</button>
        {candidate && <button className="move-unscheduled" onClick={onMoveCandidate}>날짜 미정으로 이동</button>}
        {hasCandidates && <button className="promote-next" onClick={onPromote}>확정 일정만 삭제</button>}
      </div>
    </div>
  );
}

function TripDeleteDialog({
  trip,
  busy,
  onCancel,
  onDelete,
}: {
  trip: WorkspaceTrip;
  busy: boolean;
  onCancel: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="delete-dialog trip-delete-dialog" role="alertdialog" aria-modal="true" aria-label={`${trip.name} 여행 삭제 확인`}>
      <span className="delete-kicker">DELETE TRIP</span>
      <h3>{trip.name}을 삭제할까요?</h3>
      <p>모든 일정, 후보 장소, 댓글과 초대 링크가 함께 삭제됩니다. <strong>삭제한 여행은 복구할 수 없습니다.</strong></p>
      <div className="trip-delete-actions">
        <button onClick={onCancel} disabled={busy}>취소</button>
        <button className="delete-all" onClick={onDelete} disabled={busy}>{busy ? "삭제하는 중..." : "여행 전체 삭제"}</button>
      </div>
    </div>
  );
}

function ConfirmDialog({
  label,
  title,
  message,
  detail,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  label: string;
  title: string;
  message: string;
  detail?: string;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return <div className="delete-dialog common-confirm-dialog" role="alertdialog" aria-modal="true" aria-label={title}>
    <span className="delete-kicker">{label}</span>
    <h3>{title}</h3>
    <p>{message}</p>
    {detail && <div className="confirm-dialog-detail">{detail}</div>}
    <div className="common-confirm-actions">
      <button onClick={onCancel} disabled={busy}>취소</button>
      <button className="delete-all" onClick={onConfirm} disabled={busy}>{busy ? "처리하는 중..." : confirmLabel}</button>
    </div>
  </div>;
}

function MoveDayDialog({
  sourceDate,
  sourceTitle,
  sourceCount,
  targetDate,
  targetCount,
  confirmOverwrite,
  busy,
  error,
  onTargetDateChange,
  onCancel,
  onMove,
}: {
  sourceDate: string;
  sourceTitle: string;
  sourceCount: number;
  targetDate: string;
  targetCount: number;
  confirmOverwrite: boolean;
  busy: boolean;
  error: string;
  onTargetDateChange: (value: string) => void;
  onCancel: () => void;
  onMove: () => void;
}) {
  const sameDate = sourceDate === targetDate;
  const hasConflict = targetCount > 0;
  return (
    <div className="delete-dialog move-day-dialog" role="dialog" aria-modal="true" aria-label={`${formatTripDate(sourceDate)} 일정 이동`}>
      <span className="move-day-kicker">MOVE DAY</span>
      <h3>하루 일정을 옮길까요?</h3>
      <p><strong>{formatTripDate(sourceDate)}</strong>의 확정 일정 {sourceCount}개와 후보, 일정 제목을 함께 이동합니다.</p>
      <div className="move-day-source"><span>이동할 일정</span><strong>{sourceTitle}</strong><small>{formatTripDate(sourceDate)} · {sourceCount}개</small></div>
      <label className="move-day-date"><span>옮길 날짜</span><input type="date" value={targetDate} onChange={(event) => onTargetDateChange(event.target.value)} disabled={busy} autoFocus /></label>
      {sameDate && <p className="move-day-message" role="status">현재 날짜가 아닌 다른 날짜를 선택해주세요.</p>}
      {hasConflict && !sameDate && !confirmOverwrite && <p className="move-day-message is-warning" role="status">선택한 날짜에 확정 일정 {targetCount}개가 있습니다. 이동을 누르면 덮어쓰기 여부를 한 번 더 확인합니다.</p>}
      {hasConflict && !sameDate && confirmOverwrite && <div className="move-day-overwrite" role="alert"><strong>{formatTripDate(targetDate)} 일정을 덮어쓸까요?</strong><span>기존 확정 일정 {targetCount}개와 후보, 제목이 삭제되고 현재 일정으로 교체됩니다.</span></div>}
      {error && <p className="move-day-message is-error" role="alert">{error}</p>}
      <div className="move-day-actions">
        <button onClick={onCancel} disabled={busy}>취소</button>
        <button className={confirmOverwrite ? "is-overwrite" : ""} onClick={onMove} disabled={busy || !targetDate || sameDate}>{busy ? "이동하는 중..." : confirmOverwrite ? "덮어쓰고 이동" : "이 날짜로 이동"}</button>
      </div>
    </div>
  );
}

type ImportedBookmarkItem = { title: string; coords: [number, number]; address?: string; memo?: string };
type BookmarkImportResult = {
  provider: "google" | "kakao" | "naver";
  providerLabel: string;
  groupTitle?: string;
  items: ImportedBookmarkItem[];
  warnings?: string[];
};
type BookmarkImportOutcome = { added: number; skipped: number };

function ImportBookmarksDialog({ onClose, onImport }: {
  onClose: () => void;
  onImport: (result: BookmarkImportResult) => BookmarkImportOutcome;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<(BookmarkImportOutcome & { providerLabel: string; groupTitle?: string; warnings: string[] }) | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const target = url.trim();
    if (!target || busy) return;
    setBusy(true);
    setError("");
    setSummary(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(`/api/import/bookmarks?url=${encodeURIComponent(target)}`, {
        headers: session ? { Authorization: `Bearer ${session.access_token}` } : undefined,
      });
      const payload = await response.json().catch(() => null) as (BookmarkImportResult & { error?: string }) | null;
      if (!response.ok || !payload || !Array.isArray(payload.items)) {
        setError(payload?.error || "즐겨찾기를 불러오지 못했습니다. 공유 링크를 다시 확인해주세요.");
        return;
      }
      const outcome = onImport(payload);
      setSummary({ ...outcome, providerLabel: payload.providerLabel, groupTitle: payload.groupTitle, warnings: payload.warnings ?? [] });
    } catch {
      setError("가져오기 요청에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="delete-dialog import-dialog" role="dialog" aria-modal="true" aria-label="즐겨찾기 가져오기">
      <div className="popover-heading"><div><span className="eyebrow">IMPORT FAVORITES</span><h3>즐겨찾기 가져오기</h3></div><button className="icon-button" onClick={onClose} aria-label="즐겨찾기 가져오기 닫기" /></div>
      <p className="import-description">구글 지도 · 카카오맵 · 네이버 지도 앱에서 즐겨찾기 그룹을 <strong>공유</strong>한 링크를 붙여넣으면, 그룹에 담긴 장소가 모두 <strong>날짜 미정 후보</strong>로 추가됩니다. 이미 등록된 장소는 자동으로 건너뛰어요.</p>
      <form className="import-form" onSubmit={submit}>
        <input
          value={url}
          onChange={(event) => { setUrl(event.target.value); setError(""); }}
          placeholder="naver.me/… · kko.kakao.com/… · maps.app.goo.gl/…"
          aria-label="즐겨찾기 그룹 공유 링크"
          autoFocus
          inputMode="url"
        />
        {error && <p className="form-error" role="alert">{error}</p>}
        {summary && (
          <div className="import-summary" role="status">
            <strong>{summary.providerLabel}{summary.groupTitle ? ` · ${summary.groupTitle}` : ""}</strong>
            <span>{summary.added > 0 ? `날짜 미정 후보에 ${summary.added}개를 추가했어요.` : "새로 추가된 장소가 없어요."}{summary.skipped > 0 ? ` 이미 있는 ${summary.skipped}개는 건너뛰었어요.` : ""}</span>
            {summary.warnings.map((warning) => <small key={warning}>{warning}</small>)}
          </div>
        )}
        <div className="form-actions">
          <button type="button" onClick={onClose}>{summary ? "닫기" : "취소"}</button>
          <button type="submit" disabled={busy || !url.trim()}>{busy ? "불러오는 중..." : "가져오기"}</button>
        </div>
      </form>
    </div>
  );
}

export default function App() {
  const { user, userName, avatarUrl, trip, trips, role, members, selectTrip, createTrip, renameTrip, deleteTrip } = useWorkspace();
  const today = dateKey(new Date());
  const [selectedDate, setSelectedDate] = useState(today);
  const [lastAddDate, setLastAddDate] = useState(() => {
    const saved = localStorage.getItem("into-the-blue-last-add-date");
    return saved && /^\d{4}-\d{2}-\d{2}$/.test(saved) ? saved : today;
  });
  const [schedules, setSchedules] = useState<SchedulesByDate>({});
  const [coursesByDate, setCoursesByDate] = useState<Record<string, CourseDefinition[]>>({});
  const [activeCourseByDate, setActiveCourseByDate] = useState<Record<string, string>>({});
  const [courseStorageAvailable, setCourseStorageAvailable] = useState(false);
  const [unscheduledCandidates, setUnscheduledCandidates] = useState<Candidate[]>([]);
  const [unscheduledOpen, setUnscheduledOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [sidebarScrollTarget, setSidebarScrollTarget] = useState<{ id: string; token: number } | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [commentPlace, setCommentPlace] = useState<string | null>(null);
  const [mobileSchedule, setMobileSchedule] = useState(false);
  const [focusPoint, setFocusPoint] = useState<{ id: string; coords: [number, number]; name: string; token: number } | null>(null);
  const [mapSearchResults, setMapSearchResults] = useState<MapSearchResult[]>([]);
  const [now, setNow] = useState(new Date());
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [addDefaults, setAddDefaults] = useState({ date: lastAddDate, time: "12:00" });
  const [candidateAddTarget, setCandidateAddTarget] = useState<string | null>(null);
  const [dragged, setDragged] = useState<DragItem | null>(null);
  const [dragPreview, setDragPreview] = useState<{ x: number; y: number; title: string; kind: string } | null>(null);
  const [dropZone, setDropZone] = useState("");
  const activeDragRef = useRef<DragItem | null>(null);
  const pointerDropZoneRef = useRef("");
  const schedulePanelRef = useRef<HTMLElement | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [unscheduledEditId, setUnscheduledEditId] = useState<string | null>(null);
  const [visibleCategories, setVisibleCategories] = useState<PlaceCategory[]>(PLACE_CATEGORIES.map(({ value }) => value));
  const [showPinNotes, setShowPinNotes] = useState(true);
  const [categoryFilterOpen, setCategoryFilterOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem("into-the-blue-sidebar-width"));
    return Number.isFinite(saved) && saved >= 360 ? Math.min(saved, 680) : 430;
  });
  const [resizing, setResizing] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [comments, setComments] = useState<CommentsByPlace>({});
  const [listTitles, setListTitles] = useState<Record<string, string>>({});
  const [dataReady, setDataReady] = useState(false);
  const [dataError, setDataError] = useState("");
  const [editingListTitle, setEditingListTitle] = useState(false);
  const [listTitleDraft, setListTitleDraft] = useState("");
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null);
  const [courseNameDraft, setCourseNameDraft] = useState("");
  const [courseDeleteTarget, setCourseDeleteTarget] = useState<{ date: string; course: CourseDefinition } | null>(null);
  const [courseDeleteBusy, setCourseDeleteBusy] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [tripForm, setTripForm] = useState<{ mode: "create" } | { mode: "rename"; trip: WorkspaceTrip } | null>(null);
  const [tripNameDraft, setTripNameDraft] = useState("");
  const [tripFormBusy, setTripFormBusy] = useState(false);
  const [tripFormError, setTripFormError] = useState("");
  const [tripToDelete, setTripToDelete] = useState<WorkspaceTrip | null>(null);
  const [tripDeleteBusy, setTripDeleteBusy] = useState(false);
  const [dayMoveSource, setDayMoveSource] = useState<string | null>(null);
  const [dayMoveDate, setDayMoveDate] = useState("");
  const [dayMoveConfirmOverwrite, setDayMoveConfirmOverwrite] = useState(false);
  const [dayMoveBusy, setDayMoveBusy] = useState(false);
  const [dayMoveError, setDayMoveError] = useState("");

  const currentCourses = useMemo(() => coursesByDate[selectedDate]?.length ? coursesByDate[selectedDate] : defaultCourses(), [coursesByDate, selectedDate]);
  const activeCourseId = currentCourses.some((course) => course.id === activeCourseByDate[selectedDate])
    ? activeCourseByDate[selectedDate]
    : currentCourses[0].id;
  const currentCourse = currentCourses.find((course) => course.id === activeCourseId) ?? currentCourses[0];
  const activeCourseIdForDate = (date: string) => {
    const courses = coursesByDate[date]?.length ? coursesByDate[date] : defaultCourses();
    const saved = activeCourseByDate[date];
    return courses.some((course) => course.id === saved) ? saved : courses[0].id;
  };
  const activeCourseNameForDate = (date: string, courseId = activeCourseIdForDate(date)) => {
    const courses = coursesByDate[date]?.length ? coursesByDate[date] : defaultCourses();
    return courses.find((course) => course.id === courseId)?.name ?? "A코스";
  };
  const places = useMemo(() => sortPlaces((schedules[selectedDate] ?? []).filter((place) => placeCourseId(place) === activeCourseId)), [activeCourseId, schedules, selectedDate]);
  const activeSchedules = useMemo(() => Object.fromEntries(Object.entries(schedules).map(([date, items]) => {
    const courses = coursesByDate[date]?.length ? coursesByDate[date] : defaultCourses();
    const saved = activeCourseByDate[date];
    const courseId = courses.some((course) => course.id === saved) ? saved : courses[0].id;
    return [date, items.filter((place) => placeCourseId(place) === courseId)];
  })), [activeCourseByDate, coursesByDate, schedules]);
  const commentCounts = useMemo(() => Object.fromEntries(Object.entries(comments).map(([placeId, items]) => [placeId, items.length])), [comments]);
  const timeline = useMemo(() => getTimeline(now, places, selectedDate), [now, places, selectedDate]);
  const selected = places.find((place) => place.id === selectedId) ?? places[0];
  const selectedPlaceIndex = selected ? places.findIndex((place) => place.id === selected.id) : -1;
  const commentableItems = useMemo(() => [...places.flatMap((place) => [place, ...place.alternatives]), ...unscheduledCandidates], [places, unscheduledCandidates]);
  const openCommentPlace = commentableItems.find((place) => place.id === commentPlace);
  const candidateAddPlace = places.find((place) => place.id === candidateAddTarget);
  const deletePlace = places.find((place) => place.id === deleteTarget?.placeId);
  const deleteCandidate = deletePlace?.alternatives.find((candidate) => candidate.id === deleteTarget?.candidateId);
  const editSourcePlace = editTarget
    ? schedules[editTarget.date]?.find((place) => place.id === editTarget.placeId)
    : undefined;
  const editSourceCandidate = editSourcePlace?.alternatives.find((candidate) => candidate.id === editTarget?.candidateId);
  const editablePlace = editTarget?.candidateId ? editSourceCandidate : editSourcePlace;
  const editableUnscheduled = unscheduledCandidates.find((candidate) => candidate.id === unscheduledEditId);
  const courseDeletePlaces = courseDeleteTarget
    ? (schedules[courseDeleteTarget.date] ?? []).filter((place) => placeCourseId(place) === courseDeleteTarget.course.id)
    : [];
  const totalCandidates = places.reduce((sum, place) => sum + place.alternatives.length, unscheduledCandidates.length);
  const scheduledDates = useMemo(() => Object.entries(schedules).filter(([, items]) => items.length > 0).map(([date]) => date).sort(), [schedules]);
  const tripDday = scheduledDates.length ? dDayLabel(scheduledDates[0], today) : "";
  const previousDate = [...scheduledDates].reverse().find((date) => date < selectedDate);
  const nextDate = scheduledDates.find((date) => date > selectedDate);
  const currentListTitle = listTitles[selectedDate] ?? "새 여행 일정";
  const rangeDates = scheduledDates.length ? scheduledDates : [selectedDate];
  const tripDateRange = rangeDates[0] === rangeDates[rangeDates.length - 1]
    ? formatTripDate(rangeDates[0])
    : `${formatTripDate(rangeDates[0])} ~ ${formatTripDate(rangeDates[rangeDates.length - 1])}`;

  useEffect(() => {
    for (const key of ["into-the-blue-schedules-v3", "into-the-blue-itinerary-v2", "into-the-blue-comments", "into-the-blue-list-titles"]) localStorage.removeItem(key);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadTripData = async () => {
      setDataReady(false);
      setDataError("");
      const [
        { data: documents, error: documentError },
        { data: commentRows, error: commentError },
        { data: candidatePool, error: candidatePoolError },
        { data: courseRows, error: courseRowsError },
      ] = await Promise.all([
        supabase.from("trip_documents").select("trip_date,list_title,schedule").eq("trip_id", trip.id).order("trip_date"),
        supabase.from("comments").select("id,place_id,user_id,content,created_at").eq("trip_id", trip.id).order("created_at"),
        supabase.from("trip_candidate_pools").select("candidates,seed_version").eq("trip_id", trip.id).maybeSingle(),
        supabase.from("trip_courses").select("trip_date,course_id,name,position").eq("trip_id", trip.id).order("trip_date").order("position"),
      ]);
      if (cancelled) return;
      if (documentError || commentError || candidatePoolError) {
        setDataError("여행 데이터를 불러오지 못했습니다. Supabase 마이그레이션을 확인해주세요.");
        setDataReady(true);
        return;
      }
      const nextSchedules: SchedulesByDate = {};
      const nextTitles: Record<string, string> = {};
      let localCourses: Record<string, CourseDefinition[]> = {};
      try {
        const saved = localStorage.getItem(`into-the-blue-courses:${trip.id}`);
        const parsed = saved ? JSON.parse(saved) : {};
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) localCourses = parsed;
      } catch { /* use the default A course */ }
      const serverCourses = new Map<string, CourseDefinition[]>();
      for (const row of courseRows ?? []) {
        const course: CourseDefinition = { id: row.course_id, name: row.name, position: row.position };
        serverCourses.set(row.trip_date, [...(serverCourses.get(row.trip_date) ?? []), course]);
      }
      const nextCourses: Record<string, CourseDefinition[]> = {};
      for (const document of documents ?? []) {
        const rawItems = Array.isArray(document.schedule) ? document.schedule as Place[] : [];
        const configured = serverCourses.get(document.trip_date) ?? localCourses[document.trip_date] ?? [];
        const courses = normalizeCourses(rawItems, configured);
        nextCourses[document.trip_date] = courses;
        nextSchedules[document.trip_date] = sortPlaces(applyCourseMetadata(rawItems, courses));
        nextTitles[document.trip_date] = document.list_title;
      }
      for (const [date, configured] of Object.entries(localCourses)) {
        if (!nextCourses[date]?.length) nextCourses[date] = normalizeCourses([], configured);
      }
      const authorIds = [...new Set((commentRows ?? []).map((comment) => comment.user_id))];
      const { data: authorProfiles } = authorIds.length
        ? await supabase.from("profiles").select("id,nickname,avatar_url").in("id", authorIds)
        : { data: [] };
      const authors = new Map((authorProfiles ?? []).map((profile) => [profile.id, profile]));
      const nextComments: CommentsByPlace = {};
      for (const comment of commentRows ?? []) {
        const author = authors.get(comment.user_id);
        const item: Comment = {
          id: comment.id,
          userId: comment.user_id,
          name: author?.nickname || "여행자",
          avatarUrl: author?.avatar_url ?? undefined,
          content: comment.content,
          createdAt: formatCommentTime(comment.created_at),
        };
        nextComments[comment.place_id] = [...(nextComments[comment.place_id] ?? []), item];
      }
      setSchedules(nextSchedules);
      setCoursesByDate(nextCourses);
      setActiveCourseByDate(Object.fromEntries(Object.entries(nextCourses).map(([date, courses]) => [date, courses[0]?.id ?? DEFAULT_COURSE_ID])));
      setCourseStorageAvailable(!courseRowsError);
      try {
        const savedCandidates = localStorage.getItem(`into-the-blue-unscheduled-candidates:${trip.id}`);
        const parsedCandidates = savedCandidates ? JSON.parse(savedCandidates) : [];
        const localCandidates = Array.isArray(parsedCandidates) ? sortCandidates(parsedCandidates as Candidate[]) : [];
        const serverCandidates = Array.isArray(candidatePool?.candidates) ? sortCandidates(candidatePool.candidates as Candidate[]) : [];
        // A missing server row means this trip still uses the former browser-only
        // storage. Import that local list once; afterwards Supabase is authoritative.
        const restoredCandidates = candidatePool ? serverCandidates : localCandidates;
        setUnscheduledCandidates(restoredCandidates);
      } catch {
        setUnscheduledCandidates([]);
      }
      setUnscheduledOpen(false);
      setListTitles(nextTitles);
      setComments(nextComments);
      const itineraryDates = Object.entries(nextSchedules)
        .filter(([, items]) => items.length > 0)
        .map(([date]) => date)
        .sort();
      const firstDate = itineraryDates[0];
      const lastDate = itineraryDates[itineraryDates.length - 1];
      const initialDate = !firstDate
        ? today
        : today < firstDate
          ? firstDate
          : today > lastDate
            ? lastDate
            : today;
      setSelectedDate(initialDate);
      const initialCourseId = nextCourses[initialDate]?.[0]?.id ?? DEFAULT_COURSE_ID;
      setSelectedId(nextSchedules[initialDate]?.find((place) => placeCourseId(place) === initialCourseId)?.id ?? "");
      setDataReady(true);
    };
    void loadTripData();
    return () => { cancelled = true; };
  }, [trip.id, today]);

  useEffect(() => {
    if (!dataReady) return;
    const timer = window.setTimeout(async () => {
      const dates = [...new Set([...Object.keys(schedules), ...Object.keys(listTitles), ...Object.keys(coursesByDate)])];
      if (!dates.length) return;
      const { error } = await supabase.from("trip_documents").upsert(dates.map((date) => ({
        trip_id: trip.id,
        trip_date: date,
        list_title: listTitles[date] ?? "새 여행 일정",
        schedule: applyCourseMetadata(schedules[date] ?? [], coursesByDate[date]?.length ? coursesByDate[date] : defaultCourses()),
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      })), { onConflict: "trip_id,trip_date" });
      if (error) setDataError("변경사항을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.");
    }, 500);
    return () => window.clearTimeout(timer);
  }, [coursesByDate, dataReady, listTitles, schedules, trip.id, user.id]);
  useEffect(() => {
    if (!dataReady) return;
    localStorage.setItem(`into-the-blue-courses:${trip.id}`, JSON.stringify(coursesByDate));
    if (!courseStorageAvailable) return;
    const rows = Object.entries(coursesByDate).flatMap(([date, courses]) => courses.map((course, position) => ({
      trip_id: trip.id,
      trip_date: date,
      course_id: course.id,
      name: course.name,
      position,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })));
    if (!rows.length) return;
    const timer = window.setTimeout(async () => {
      const { error } = await supabase.from("trip_courses").upsert(rows, { onConflict: "trip_id,trip_date,course_id" });
      if (error) setDataError("코스 정보를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.");
    }, 500);
    return () => window.clearTimeout(timer);
  }, [courseStorageAvailable, coursesByDate, dataReady, trip.id, user.id]);
  useEffect(() => {
    if (!dataReady) return;
    const timer = window.setTimeout(async () => {
      const { error } = await supabase.from("trip_candidate_pools").upsert({
        trip_id: trip.id,
        candidates: unscheduledCandidates,
        seed_version: 0,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: "trip_id" });
      if (error) {
        setDataError("날짜 미정 후보를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.");
        return;
      }
      localStorage.setItem(`into-the-blue-unscheduled-candidates:${trip.id}`, JSON.stringify(unscheduledCandidates));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [dataReady, schedules, trip.id, unscheduledCandidates, user.id]);
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 60_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    const closePopups = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setAccountOpen(false);
      setAddOpen(false);
      setCandidateAddTarget(null);
      setCommentPlace(null);
      setDeleteTarget(null);
      setEditTarget(null);
      if (!courseDeleteBusy) setCourseDeleteTarget(null);
      if (!tripDeleteBusy) setTripToDelete(null);
      if (!dayMoveBusy) setDayMoveSource(null);
    };
    window.addEventListener("keydown", closePopups);
    return () => window.removeEventListener("keydown", closePopups);
  }, [courseDeleteBusy, dayMoveBusy, tripDeleteBusy]);
  useEffect(() => {
    if (!resizing) return;
    const resize = (event: PointerEvent) => {
      const width = Math.max(360, Math.min(680, Math.min(event.clientX, window.innerWidth * 0.58)));
      setSidebarWidth(width);
      localStorage.setItem("into-the-blue-sidebar-width", String(width));
    };
    const stop = () => setResizing(false);
    document.body.classList.add("is-resizing-sidebar");
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stop, { once: true });
    return () => {
      document.body.classList.remove("is-resizing-sidebar");
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stop);
    };
  }, [resizing]);

  const setItinerary = (updater: (current: Place[]) => Place[]) => {
    setSchedules((current) => {
      const allItems = current[selectedDate] ?? [];
      const otherCourses = allItems.filter((place) => placeCourseId(place) !== activeCourseId);
      const activeItems = allItems.filter((place) => placeCourseId(place) === activeCourseId);
      const updated = updater(activeItems).map((place) => ({ ...place, courseId: activeCourseId, courseName: currentCourse.name }));
      return { ...current, [selectedDate]: sortPlaces([...otherCourses, ...updated]) };
    });
  };

  const chooseDate = (value: string) => {
    if (!value) return;
    const courseId = activeCourseIdForDate(value);
    setSelectedDate(value);
    setSelectedId(schedules[value]?.find((place) => placeCourseId(place) === courseId)?.id ?? "");
    setCommentPlace(null);
    setDeleteTarget(null);
    setEditTarget(null);
    setMapSearchResults([]);
    setEditingListTitle(false);
    setEditingCourseId(null);
    setCandidateAddTarget(null);
  };

  const chooseCourse = (courseId: string) => {
    setActiveCourseByDate((current) => ({ ...current, [selectedDate]: courseId }));
    setSelectedId(schedules[selectedDate]?.find((place) => placeCourseId(place) === courseId)?.id ?? "");
    setFocusPoint(null);
    setCommentPlace(null);
    setDeleteTarget(null);
    setEditTarget(null);
    setMapSearchResults([]);
    setEditingCourseId(null);
    setCandidateAddTarget(null);
  };

  const beginCourseNameEdit = (course: CourseDefinition) => {
    setEditingCourseId(course.id);
    setCourseNameDraft(course.name);
  };

  const saveCourseName = (event: FormEvent) => {
    event.preventDefault();
    if (!editingCourseId) return;
    const name = courseNameDraft.trim();
    if (!name) return;
    setCoursesByDate((current) => ({
      ...current,
      [selectedDate]: (current[selectedDate]?.length ? current[selectedDate] : defaultCourses()).map((course) => course.id === editingCourseId ? { ...course, name } : course),
    }));
    setSchedules((current) => ({
      ...current,
      [selectedDate]: (current[selectedDate] ?? []).map((place) => placeCourseId(place) === editingCourseId ? { ...place, courseName: name } : place),
    }));
    setEditingCourseId(null);
  };

  const addCourse = () => {
    const courses = coursesByDate[selectedDate]?.length ? coursesByDate[selectedDate] : defaultCourses();
    const course: CourseDefinition = { id: newId("course"), name: defaultCourseName(courses.length), position: courses.length };
    setCoursesByDate((current) => ({ ...current, [selectedDate]: [...courses, course] }));
    setActiveCourseByDate((current) => ({ ...current, [selectedDate]: course.id }));
    setSelectedId("");
    setFocusPoint(null);
    setCommentPlace(null);
    setDeleteTarget(null);
    setEditTarget(null);
    setCandidateAddTarget(null);
    setMapSearchResults([]);
    setEditingCourseId(course.id);
    setCourseNameDraft(course.name);
  };

  const requestCourseDelete = (course: CourseDefinition) => {
    const courses = coursesByDate[selectedDate]?.length ? coursesByDate[selectedDate] : defaultCourses();
    if (courses.length <= 1) return;
    setEditingCourseId(null);
    setCourseDeleteTarget({ date: selectedDate, course });
  };

  const confirmCourseDelete = async () => {
    if (!courseDeleteTarget || courseDeleteBusy) return;
    const { date, course } = courseDeleteTarget;
    const courses = coursesByDate[date]?.length ? coursesByDate[date] : defaultCourses();
    if (courses.length <= 1) { setCourseDeleteTarget(null); return; }
    const remainingCourses = courses.filter((item) => item.id !== course.id).map((item, position) => ({ ...item, position }));
    const coursePlaces = (schedules[date] ?? []).filter((place) => placeCourseId(place) === course.id);
    const deletedIds = coursePlaces.flatMap((place) => [place.id, ...place.alternatives.map((candidate) => candidate.id)]);
    const remainingPlaces = (schedules[date] ?? []).filter((place) => placeCourseId(place) !== course.id);
    const replacement = remainingCourses[0];
    setCourseDeleteBusy(true);

    setCoursesByDate((current) => ({ ...current, [date]: remainingCourses }));
    setSchedules((current) => ({
      ...current,
      [date]: (current[date] ?? []).filter((place) => placeCourseId(place) !== course.id),
    }));
    setComments((current) => Object.fromEntries(Object.entries(current).filter(([placeId]) => !deletedIds.includes(placeId))));
    if (activeCourseByDate[date] === course.id || (date === selectedDate && activeCourseId === course.id)) {
      setActiveCourseByDate((current) => ({ ...current, [date]: replacement.id }));
      if (date === selectedDate) setSelectedId(remainingPlaces.find((place) => placeCourseId(place) === replacement.id)?.id ?? "");
    }
    setEditingCourseId(null);
    setFocusPoint(null);
    setCommentPlace(null);
    setDeleteTarget(null);
    setEditTarget(null);
    setCandidateAddTarget(null);
    setMapSearchResults([]);

    let failed = false;
    if (deletedIds.length) {
      const { error } = await supabase.from("comments").delete().eq("trip_id", trip.id).in("place_id", deletedIds);
      failed = failed || Boolean(error);
    }
    if (courseStorageAvailable) {
      const { error } = await supabase.from("trip_courses").delete().eq("trip_id", trip.id).eq("trip_date", date).eq("course_id", course.id);
      failed = failed || Boolean(error);
    }
    if (failed) setDataError("코스는 삭제했지만 서버의 일부 정보를 정리하지 못했습니다. 잠시 후 다시 시도해주세요.");
    setCourseDeleteBusy(false);
    setCourseDeleteTarget(null);
  };

  const importSharedBookmarks = useCallback((result: BookmarkImportResult): BookmarkImportOutcome => {
    const registered = new Set([
      ...Object.values(schedules).flatMap((dayPlaces) => dayPlaces.flatMap((place) => [place, ...place.alternatives])).map((place) => normalizedPlaceName(place.title)),
      ...unscheduledCandidates.map((candidate) => normalizedPlaceName(candidate.title)),
    ]);
    const additions: Candidate[] = [];
    let skipped = 0;
    for (const item of result.items) {
      const key = normalizedPlaceName(item.title);
      if (!key || registered.has(key)) {
        skipped += 1;
        continue;
      }
      registered.add(key);
      const sourceLabel = `${result.providerLabel} 즐겨찾기${result.groupTitle ? ` '${result.groupTitle}'` : ""}에서 가져온 후보`;
      additions.push({
        id: newId("import"),
        time: "",
        title: item.title,
        category: inferPlaceCategory({ title: item.title, note: item.memo ?? "" }),
        categoryVersion: CATEGORY_SCHEMA_VERSION,
        note: item.memo ? `${item.memo} · ${sourceLabel}` : sourceLabel,
        coords: item.coords,
        googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.title)}`,
        createdBy: user.id,
        createdByName: userName,
        createdAt: new Date().toISOString(),
      });
    }
    if (additions.length > 0) {
      setUnscheduledCandidates(sortCandidates([...unscheduledCandidates, ...additions]));
      setUnscheduledOpen(true);
    }
    return { added: additions.length, skipped };
  }, [schedules, unscheduledCandidates, user.id, userName]);

  const openAddPlace = () => {
    setCommentPlace(null);
    setDeleteTarget(null);
    setEditTarget(null);
    setCandidateAddTarget(null);
    setMapSearchResults([]);
    setAddDefaults({ date: lastAddDate, time: "12:00" });
    setAddOpen(true);
  };

  const openFirstCoursePlace = () => {
    setCommentPlace(null);
    setDeleteTarget(null);
    setEditTarget(null);
    setCandidateAddTarget(null);
    setMapSearchResults([]);
    setAddDefaults({ date: selectedDate, time: "09:00" });
    setAddOpen(true);
  };

  const beginListTitleEdit = () => {
    setListTitleDraft(currentListTitle);
    setEditingListTitle(true);
  };

  const saveListTitle = (event: FormEvent) => {
    event.preventDefault();
    const title = listTitleDraft.trim();
    if (!title) return;
    setListTitles((current) => ({ ...current, [selectedDate]: title }));
    setEditingListTitle(false);
  };

  const openDayMove = () => {
    if (!(schedules[selectedDate]?.length ?? 0)) return;
    setDayMoveSource(selectedDate);
    setDayMoveDate(selectedDate);
    setDayMoveConfirmOverwrite(false);
    setDayMoveError("");
  };

  const closeDayMove = () => {
    if (dayMoveBusy) return;
    setDayMoveSource(null);
    setDayMoveDate("");
    setDayMoveConfirmOverwrite(false);
    setDayMoveError("");
  };

  const changeDayMoveDate = (value: string) => {
    setDayMoveDate(value);
    setDayMoveConfirmOverwrite(false);
    setDayMoveError("");
  };

  const moveDay = async () => {
    const sourceDate = dayMoveSource;
    const targetDate = dayMoveDate;
    if (!sourceDate || !targetDate || sourceDate === targetDate || dayMoveBusy) return;
    const sourceSchedule = schedules[sourceDate] ?? [];
    const sourceCourses = coursesByDate[sourceDate]?.length ? coursesByDate[sourceDate] : normalizeCourses(sourceSchedule);
    const sourceActiveCourseId = sourceCourses.some((course) => course.id === activeCourseByDate[sourceDate]) ? activeCourseByDate[sourceDate] : sourceCourses[0].id;
    if (!sourceSchedule.length) {
      setDayMoveError("이동할 일정이 없습니다.");
      return;
    }
    const targetCount = schedules[targetDate]?.length ?? 0;
    if (targetCount > 0 && !dayMoveConfirmOverwrite) {
      setDayMoveConfirmOverwrite(true);
      return;
    }

    const sourceTitle = listTitles[sourceDate] ?? "새 여행 일정";
    const hadTargetDocument = Object.prototype.hasOwnProperty.call(schedules, targetDate)
      || Object.prototype.hasOwnProperty.call(listTitles, targetDate);
    const previousTargetSchedule = schedules[targetDate] ?? [];
    const previousTargetCourses = coursesByDate[targetDate]?.length ? coursesByDate[targetDate] : normalizeCourses(previousTargetSchedule);
    const previousTargetTitle = listTitles[targetDate] ?? "새 여행 일정";
    setDayMoveBusy(true);
    setDayMoveError("");

    const { error: targetError } = await supabase.from("trip_documents").upsert({
      trip_id: trip.id,
      trip_date: targetDate,
      list_title: sourceTitle,
      schedule: applyCourseMetadata(sourceSchedule, sourceCourses),
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "trip_id,trip_date" });
    if (targetError) {
      setDayMoveBusy(false);
      setDayMoveError("새 날짜에 일정을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.");
      return;
    }

    const { error: sourceError } = await supabase.from("trip_documents")
      .delete()
      .eq("trip_id", trip.id)
      .eq("trip_date", sourceDate);
    if (sourceError) {
      if (hadTargetDocument) {
        await supabase.from("trip_documents").upsert({
          trip_id: trip.id,
          trip_date: targetDate,
          list_title: previousTargetTitle,
          schedule: applyCourseMetadata(previousTargetSchedule, previousTargetCourses),
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        }, { onConflict: "trip_id,trip_date" });
      } else {
        await supabase.from("trip_documents").delete().eq("trip_id", trip.id).eq("trip_date", targetDate);
      }
      setDayMoveBusy(false);
      setDayMoveError("기존 날짜의 일정을 정리하지 못해 이동을 취소했습니다. 다시 시도해주세요.");
      return;
    }

    setSchedules((current) => {
      const next = { ...current };
      delete next[sourceDate];
      next[targetDate] = sortPlaces(sourceSchedule);
      return next;
    });
    setCoursesByDate((current) => {
      const next = { ...current };
      delete next[sourceDate];
      next[targetDate] = sourceCourses;
      return next;
    });
    setActiveCourseByDate((current) => {
      const next = { ...current };
      delete next[sourceDate];
      next[targetDate] = sourceActiveCourseId;
      return next;
    });
    if (courseStorageAvailable) {
      await supabase.from("trip_courses").delete().eq("trip_id", trip.id).in("trip_date", [sourceDate, targetDate]);
      await supabase.from("trip_courses").insert(sourceCourses.map((course, position) => ({
        trip_id: trip.id,
        trip_date: targetDate,
        course_id: course.id,
        name: course.name,
        position,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      })));
    }
    setListTitles((current) => {
      const next = { ...current };
      delete next[sourceDate];
      next[targetDate] = sourceTitle;
      return next;
    });
    if (lastAddDate === sourceDate) {
      setLastAddDate(targetDate);
      localStorage.setItem("into-the-blue-last-add-date", targetDate);
    }
    setSelectedDate(targetDate);
    setSelectedId(sourceSchedule.find((place) => placeCourseId(place) === sourceActiveCourseId)?.id ?? "");
    setCommentPlace(null);
    setDeleteTarget(null);
    setEditTarget(null);
    setMapSearchResults([]);
    setFocusPoint(null);
    setDayMoveBusy(false);
    setDayMoveSource(null);
    setDayMoveDate("");
    setDayMoveConfirmOverwrite(false);
  };

  const selectPlace = useCallback((id: string) => {
    const place = places.find((item) => item.id === id);
    setFocusPoint(place ? { id: place.id, coords: place.coords, name: place.title, token: Date.now() } : null);
    setSelectedId(id);
    if (window.innerWidth < 840) setMobileSchedule(false);
  }, [places]);

  const selectMapItem = useCallback((id: string) => {
    const primary = places.find((place) => place.id === id);
    if (primary) {
      setSelectedId(primary.id);
      setSidebarScrollTarget({ id: primary.id, token: Date.now() });
      if (window.innerWidth < 840) setMobileSchedule(false);
      return;
    }
    const parent = places.find((place) => place.alternatives.some((candidate) => candidate.id === id));
    if (parent) {
      setSelectedId(parent.id);
      setExpanded((current) => ({ ...current, [parent.id]: true }));
      setSidebarScrollTarget({ id, token: Date.now() });
      if (window.innerWidth < 840) setMobileSchedule(false);
      return;
    }
    if (unscheduledCandidates.some((candidate) => candidate.id === id)) {
      setUnscheduledOpen(true);
      setSidebarScrollTarget({ id, token: Date.now() });
      if (window.innerWidth < 840) setMobileSchedule(false);
    }
  }, [places, unscheduledCandidates]);

  useEffect(() => {
    if (!sidebarScrollTarget) return;
    const frame = window.requestAnimationFrame(() => {
      const panel = schedulePanelRef.current;
      if (!panel) return;
      const item = [...panel.querySelectorAll<HTMLElement>("[data-sidebar-item-id]")]
        .find((element) => element.dataset.sidebarItemId === sidebarScrollTarget.id);
      if (!item) return;
      const panelRect = panel.getBoundingClientRect();
      const itemRect = item.getBoundingClientRect();
      const centeredOffset = Math.max(18, (panel.clientHeight - itemRect.height) / 2);
      const top = panel.scrollTop + itemRect.top - panelRect.top - centeredOffset;
      panel.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [sidebarScrollTarget]);

  const openCandidateList = (placeId: string) => {
    setExpanded((current) => current[placeId] ? current : { ...current, [placeId]: true });
  };

  const toggleCandidateList = (placeId: string) => {
    setExpanded((current) => ({ ...current, [placeId]: !(current[placeId] ?? false) }));
  };

  const openMapComments = useCallback((id: string) => {
    setFocusPoint(null);
    const parent = places.find((place) => place.id === id || place.alternatives.some((candidate) => candidate.id === id));
    if (parent) setSelectedId(parent.id);
    setCandidateAddTarget(null);
    setCommentPlace(id);
  }, [places]);

  const openMapEdit = useCallback((id: string) => {
    setAddOpen(false);
    setCandidateAddTarget(null);
    setCommentPlace(null);
    setDeleteTarget(null);
    setEditTarget(null);
    setUnscheduledEditId(null);
    setMapSearchResults([]);
    const primary = places.find((place) => place.id === id);
    if (primary) {
      setEditTarget({ date: selectedDate, placeId: primary.id });
      return;
    }
    const parent = places.find((place) => place.alternatives.some((candidate) => candidate.id === id));
    if (parent) {
      setEditTarget({ date: selectedDate, placeId: parent.id, candidateId: id });
      return;
    }
    if (unscheduledCandidates.some((candidate) => candidate.id === id)) setUnscheduledEditId(id);
  }, [places, selectedDate, setAddOpen, setCandidateAddTarget, setCommentPlace, setDeleteTarget, setEditTarget, setMapSearchResults, setUnscheduledEditId, unscheduledCandidates]);

  const openCandidateAdd = (placeId: string) => {
    setAddOpen(false);
    setCommentPlace(null);
    setDeleteTarget(null);
    setEditTarget(null);
    setUnscheduledEditId(null);
    setMapSearchResults([]);
    setCandidateAddTarget(placeId);
  };

  const addCandidateToPlace = (candidate: Candidate, sourceUnscheduledId?: string) => {
    const target = places.find((place) => place.id === candidateAddTarget);
    if (!target) return;
    const authoredCandidate: Candidate = {
      ...candidate,
      time: target.time,
      courseId: activeCourseId,
      courseName: currentCourse.name,
      createdBy: candidate.createdBy ?? user.id,
      createdByName: candidate.createdByName ?? userName,
      createdAt: candidate.createdAt ?? new Date().toISOString(),
    };
    setItinerary((current) => current.map((place) => place.id === target.id
      ? { ...place, alternatives: sortCandidates([...place.alternatives.filter((item) => item.id !== authoredCandidate.id), authoredCandidate]) }
      : place));
    if (sourceUnscheduledId) setUnscheduledCandidates((current) => current.filter((item) => item.id !== sourceUnscheduledId));
    setExpanded((current) => ({ ...current, [target.id]: true }));
    setSelectedId(target.id);
    setFocusPoint({ id: authoredCandidate.id, coords: authoredCandidate.coords, name: authoredCandidate.title, token: Date.now() });
    setCandidateAddTarget(null);
    setMapSearchResults([]);
  };

  const addCandidatesToPlace = (candidates: Candidate[], sourceUnscheduledIds: string[]) => {
    const target = places.find((place) => place.id === candidateAddTarget);
    if (!target || candidates.length === 0) return;
    const authoredCandidates = candidates.map((candidate) => ({
      ...candidate,
      time: target.time,
      courseId: activeCourseId,
      courseName: currentCourse.name,
      createdBy: candidate.createdBy ?? user.id,
      createdByName: candidate.createdByName ?? userName,
      createdAt: candidate.createdAt ?? new Date().toISOString(),
    }));
    const addedIds = new Set(authoredCandidates.map((candidate) => candidate.id));
    const sourceIds = new Set(sourceUnscheduledIds);
    setItinerary((current) => current.map((place) => place.id === target.id
      ? { ...place, alternatives: sortCandidates([...place.alternatives.filter((item) => !addedIds.has(item.id)), ...authoredCandidates]) }
      : place));
    setUnscheduledCandidates((current) => current.filter((item) => !sourceIds.has(item.id)));
    setExpanded((current) => ({ ...current, [target.id]: true }));
    setSelectedId(target.id);
    const last = authoredCandidates[authoredCandidates.length - 1];
    setFocusPoint({ id: last.id, coords: last.coords, name: last.title, token: Date.now() });
    setCandidateAddTarget(null);
    setMapSearchResults([]);
  };

  const addPlace = (candidate: Candidate, rank: AddRank, parentId: string, date: string) => {
    const targetCourseId = activeCourseIdForDate(date);
    const targetCourseName = activeCourseNameForDate(date, targetCourseId);
    const authoredCandidate = {
      ...candidate,
      ...(rank === "unscheduled" ? {} : { courseId: targetCourseId, courseName: targetCourseName }),
      createdBy: user.id,
      createdByName: userName,
      createdAt: new Date().toISOString(),
    };
    if (rank === "unscheduled") {
      setUnscheduledCandidates((current) => [...current, authoredCandidate]);
      setUnscheduledOpen(true);
      setFocusPoint({ id: authoredCandidate.id, coords: authoredCandidate.coords, name: authoredCandidate.title, token: Date.now() });
    } else if (rank === "primary") {
      const place = asPrimary(authoredCandidate, authoredCandidate.time);
      setSchedules((current) => ({ ...current, [date]: sortPlaces([...(current[date] ?? []), place]) }));
      setCoursesByDate((current) => current[date]?.length ? current : { ...current, [date]: defaultCourses() });
      setActiveCourseByDate((current) => ({ ...current, [date]: targetCourseId }));
      setSelectedDate(date);
      setSelectedId(place.id);
    } else {
      setSchedules((current) => ({
        ...current,
        [date]: sortPlaces((current[date] ?? []).map((place) => place.id === parentId ? { ...place, alternatives: sortCandidates([...place.alternatives, authoredCandidate]) } : place)),
      }));
      setExpanded((current) => ({ ...current, [parentId]: true }));
      setActiveCourseByDate((current) => ({ ...current, [date]: targetCourseId }));
      setSelectedDate(date);
      setSelectedId(parentId);
    }
    if (rank !== "unscheduled") {
      setLastAddDate(date);
      localStorage.setItem("into-the-blue-last-add-date", date);
    }
    setMapSearchResults([]);
  };

  const startPointerDrag = (event: ReactPointerEvent<HTMLElement>, item: DragItem, title: string) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activeDragRef.current = item;
    setDragged(item);
    setDragPreview({ x: event.clientX, y: event.clientY, title, kind: item.kind });
  };

  const finishDrag = () => {
    activeDragRef.current = null;
    pointerDropZoneRef.current = "";
    setDragged(null);
    setDragPreview(null);
    setDropZone("");
  };

  const moveToPrimary = (item: DragItem, targetId: string) => {
    if (item.kind === "primary") {
      if (item.placeId !== targetId) {
        setItinerary((current) => {
          const source = current.find((place) => place.id === item.placeId);
          const target = current.find((place) => place.id === targetId);
          if (!source || !target) return current;
          return sortPlaces(current.map((place) => place.id === source.id ? { ...place, time: target.time } : place.id === target.id ? { ...place, time: source.time } : place));
        });
      }
    } else if (item.kind === "candidate") {
      const { placeId, candidateId } = item;
      setItinerary((current) => {
        const next = current.map((place) => ({ ...place, alternatives: [...place.alternatives] }));
        const source = next.find((place) => place.id === placeId);
        const candidate = source?.alternatives.find((item) => item.id === candidateId);
        if (!source || !candidate) return current;
        source.alternatives = source.alternatives.filter((item) => item.id !== candidateId);
        const targetIndex = next.findIndex((place) => place.id === targetId);
        if (targetIndex < 0) return current;
        const target = next[targetIndex];
        const demoted = { ...asCandidate(target), time: target.time };
        next[targetIndex] = asPrimary({ ...candidate, time: target.time }, target.time, [...target.alternatives, demoted]);
        return sortPlaces(next);
      });
      setSelectedId(candidateId);
      setExpanded((current) => ({ ...current, [candidateId]: true }));
    } else {
      const candidate = unscheduledCandidates.find((entry) => entry.id === item.candidateId);
      if (!candidate) return;
      setItinerary((current) => {
        const targetIndex = current.findIndex((place) => place.id === targetId);
        if (targetIndex < 0) return current;
        const next = current.map((place) => ({ ...place, alternatives: [...place.alternatives] }));
        const target = next[targetIndex];
        const demoted = { ...asCandidate(target), time: target.time };
        next[targetIndex] = asPrimary({ ...candidate, time: target.time }, target.time, [...target.alternatives, demoted]);
        return sortPlaces(next);
      });
      setUnscheduledCandidates((current) => current.filter((entry) => entry.id !== item.candidateId));
      setSelectedId(candidate.id);
    }
  };

  const moveToCandidates = (item: DragItem, targetId: string) => {
    if (item.kind === "candidate") {
      const { placeId, candidateId } = item;
      setItinerary((current) => {
        const next = current.map((place) => ({ ...place, alternatives: [...place.alternatives] }));
        const source = next.find((place) => place.id === placeId);
        const candidate = source?.alternatives.find((item) => item.id === candidateId);
        const target = next.find((place) => place.id === targetId);
        if (!source || !candidate || !target) return current;
        source.alternatives = source.alternatives.filter((item) => item.id !== candidateId);
        target.alternatives = sortCandidates([...target.alternatives.filter((item) => item.id !== candidateId), candidate]);
        return sortPlaces(next);
      });
    } else if (item.kind === "primary" && item.placeId !== targetId) {
      const sourceId = item.placeId;
      setItinerary((current) => {
        const next = current.map((place) => ({ ...place, alternatives: [...place.alternatives] }));
        const sourceIndex = next.findIndex((place) => place.id === sourceId);
        if (sourceIndex < 0) return current;
        const source = next[sourceIndex];
        const demoted = asCandidate(source);
        if (source.alternatives.length) {
          const [replacement, ...rest] = sortCandidates(source.alternatives);
          next[sourceIndex] = asPrimary({ ...replacement, time: source.time }, source.time, rest);
        } else {
          next.splice(sourceIndex, 1);
        }
        const target = next.find((place) => place.id === targetId);
        if (!target) return current;
        target.alternatives = sortCandidates([...target.alternatives, demoted]);
        return sortPlaces(next);
      });
      setSelectedId(targetId);
    } else if (item.kind === "unscheduled") {
      const candidate = unscheduledCandidates.find((entry) => entry.id === item.candidateId);
      if (!candidate) return;
      setItinerary((current) => current.map((place) => place.id === targetId
        ? { ...place, alternatives: sortCandidates([...place.alternatives, { ...candidate, time: place.time }]) }
        : place));
      setUnscheduledCandidates((current) => current.filter((entry) => entry.id !== item.candidateId));
      setSelectedId(targetId);
    }
    setExpanded((current) => ({ ...current, [targetId]: true }));
  };

  const moveToUnscheduled = (item: DragItem) => {
    if (item.kind === "unscheduled") return;
    if (item.kind === "candidate") {
      const source = places.find((place) => place.id === item.placeId);
      const candidate = source?.alternatives.find((entry) => entry.id === item.candidateId);
      if (!candidate) return;
      setItinerary((current) => current.map((place) => place.id === item.placeId
        ? { ...place, alternatives: place.alternatives.filter((entry) => entry.id !== item.candidateId) }
        : place));
      setUnscheduledCandidates((current) => [...current, { ...candidate, time: "" }]);
    } else {
      const source = places.find((place) => place.id === item.placeId);
      if (!source) return;
      setItinerary((current) => {
        const target = current.find((place) => place.id === item.placeId);
        if (!target) return current;
        if (!target.alternatives.length) return current.filter((place) => place.id !== item.placeId);
        const [promotion, ...rest] = sortCandidates(target.alternatives);
        return sortPlaces(current.map((place) => place.id === item.placeId
          ? asPrimary({ ...promotion, time: target.time }, target.time, rest)
          : place));
      });
      setUnscheduledCandidates((current) => [...current, { ...asCandidate(source), time: "" }]);
    }
    setUnscheduledOpen(true);
    setFocusPoint(null);
  };

  const findPointerDropZone = (clientX: number, clientY: number) => {
    const element = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-drop-kind][data-place-id]");
    if (!element) return "";
    return `${element.dataset.dropKind}:${element.dataset.placeId}`;
  };

  const movePointerDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!activeDragRef.current) return;
    event.preventDefault();
    const zone = findPointerDropZone(event.clientX, event.clientY);
    pointerDropZoneRef.current = zone;
    setDropZone(zone);
    setDragPreview((current) => current ? { ...current, x: event.clientX, y: event.clientY } : current);
  };

  const finishPointerDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const item = activeDragRef.current;
    if (!item) return;
    const zone = findPointerDropZone(event.clientX, event.clientY) || pointerDropZoneRef.current;
    const separator = zone.indexOf(":");
    const kind = separator > 0 ? zone.slice(0, separator) : "";
    const targetId = separator > 0 ? zone.slice(separator + 1) : "";
    if (kind === "primary" && targetId) moveToPrimary(item, targetId);
    if (kind === "candidate" && targetId) moveToCandidates(item, targetId);
    if (kind === "unscheduled") moveToUnscheduled(item);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    finishDrag();
  };

  const addComment = async (placeId: string, content: string) => {
    const { data, error } = await supabase.from("comments").insert({ trip_id: trip.id, place_id: placeId, user_id: user.id, content }).select("id,created_at").single();
    if (error || !data) {
      setDataError("댓글을 저장하지 못했습니다.");
      return;
    }
    const item: Comment = { id: data.id, userId: user.id, name: userName, avatarUrl, content, createdAt: "방금" };
    setComments((current) => ({ ...current, [placeId]: [...(current[placeId] ?? []), item] }));
  };

  const removeCandidate = (placeId: string, candidateId: string) => {
    setItinerary((current) => current.map((place) => place.id === placeId ? { ...place, alternatives: place.alternatives.filter((candidate) => candidate.id !== candidateId) } : place));
    if (comments[candidateId]) {
      const nextComments = { ...comments };
      delete nextComments[candidateId];
      setComments(nextComments);
      void supabase.from("comments").delete().eq("trip_id", trip.id).eq("place_id", candidateId);
    }
    setDeleteTarget(null);
  };

  const moveCandidateToUnscheduled = (placeId: string, candidateId: string) => {
    const sourcePlace = places.find((place) => place.id === placeId);
    const candidate = sourcePlace?.alternatives.find((item) => item.id === candidateId);
    if (!candidate) return;
    const unscheduledCandidate: Candidate = {
      ...candidate,
      time: "",
      courseId: undefined,
      courseName: undefined,
    };
    setItinerary((current) => current.map((place) => place.id === placeId
      ? { ...place, alternatives: place.alternatives.filter((item) => item.id !== candidateId) }
      : place));
    setUnscheduledCandidates((current) => [...current.filter((item) => item.id !== candidateId), unscheduledCandidate]);
    setUnscheduledOpen(true);
    setFocusPoint({ id: candidate.id, coords: candidate.coords, name: candidate.title, token: Date.now() });
    setDeleteTarget(null);
  };

  const savePlaceEdit = (target: EditTarget, values: PlaceEditValues) => {
    setSchedules((current) => {
      const sourceItems = current[target.date] ?? [];
      const sourcePlace = sourceItems.find((place) => place.id === target.placeId);
      if (!sourcePlace) return current;

      const next = { ...current };
      if (!target.candidateId) {
        const destinationCourseId = values.date === target.date ? placeCourseId(sourcePlace) : activeCourseIdForDate(values.date);
        const updated: Place = {
          ...sourcePlace,
          title: values.title,
          placeName: values.placeName,
          time: values.time,
          note: values.note,
          coords: values.coords,
          googleMapsUrl: values.googleMapsUrl,
          googlePlaceId: values.googlePlaceId,
          category: values.category,
          categoryVersion: CATEGORY_SCHEMA_VERSION,
          categoryManual: true,
          courseId: destinationCourseId,
          courseName: activeCourseNameForDate(values.date, destinationCourseId),
          duration: cleanPlaceLabel(sourcePlace.duration),
        };
        next[target.date] = sortPlaces(sourceItems.filter((place) => place.id !== target.placeId));
        const destination = values.date === target.date ? next[values.date] : current[values.date] ?? [];
        next[values.date] = sortPlaces([...(destination ?? []), updated]);
        return next;
      }

      const sourceCandidate = sourcePlace.alternatives.find((candidate) => candidate.id === target.candidateId);
      if (!sourceCandidate || !values.parentId) return current;
      const updatedCandidate: Candidate = {
        ...sourceCandidate,
        title: values.title,
        placeName: values.placeName,
        time: values.time,
        note: values.note,
        coords: values.coords,
        googleMapsUrl: values.googleMapsUrl,
        googlePlaceId: values.googlePlaceId,
        category: values.category,
        categoryVersion: CATEGORY_SCHEMA_VERSION,
        categoryManual: true,
      };
      next[target.date] = sortPlaces(sourceItems.map((place) => place.id === target.placeId
        ? { ...place, alternatives: place.alternatives.filter((candidate) => candidate.id !== target.candidateId) }
        : place));
      const destination = values.date === target.date ? next[values.date] : current[values.date] ?? [];
      if (!(destination ?? []).some((place) => place.id === values.parentId)) return current;
      next[values.date] = sortPlaces((destination ?? []).map((place) => place.id === values.parentId
        ? { ...place, alternatives: sortCandidates([...place.alternatives, updatedCandidate]) }
        : place));
      return next;
    });
    if (!coursesByDate[values.date]?.length) setCoursesByDate((current) => ({ ...current, [values.date]: defaultCourses() }));
    setSelectedDate(values.date);
    if (!target.candidateId) {
      const source = schedules[target.date]?.find((place) => place.id === target.placeId);
      const destinationCourseId = values.date === target.date && source ? placeCourseId(source) : activeCourseIdForDate(values.date);
      setActiveCourseByDate((current) => ({ ...current, [values.date]: destinationCourseId }));
    }
    setSelectedId(target.candidateId ? values.parentId ?? target.placeId : target.placeId);
    if (target.candidateId && values.parentId) setExpanded((current) => ({ ...current, [values.parentId!]: true }));
    setEditTarget(null);
    setMapSearchResults([]);
  };

  const removePrimary = (placeId: string, deleteAll: boolean) => {
    const target = places.find((place) => place.id === placeId);
    if (!target) return;
    if (!deleteAll && target.alternatives.length) {
      const [promotion, ...rest] = sortCandidates(target.alternatives);
      const promoted = { ...asPrimary({ ...promotion, time: target.time }, target.time, rest), duration: target.duration };
      setItinerary((current) => sortPlaces(current.map((place) => place.id === placeId ? promoted : place)));
      setSelectedId(promoted.id);
    } else {
      const remaining = places.filter((place) => place.id !== placeId);
      setItinerary(() => remaining);
      if (selectedId === placeId) setSelectedId(remaining[0]?.id ?? "");
    }
    if (comments[placeId]) {
      const nextComments = { ...comments };
      delete nextComments[placeId];
      setComments(nextComments);
      void supabase.from("comments").delete().eq("trip_id", trip.id).eq("place_id", placeId);
    }
    setDeleteTarget(null);
  };

  const requestPrimaryDelete = (place: Place) => {
    setCommentPlace(null);
    setEditTarget(null);
    setDeleteTarget({ placeId: place.id });
  };

  const requestCandidateDelete = (placeId: string, candidateId: string) => {
    setCommentPlace(null);
    setEditTarget(null);
    setDeleteTarget({ placeId, candidateId });
  };

  const requestPrimaryEdit = (placeId: string) => {
    setAddOpen(false);
    setCommentPlace(null);
    setDeleteTarget(null);
    setUnscheduledEditId(null);
    setMapSearchResults([]);
    setEditTarget({ date: selectedDate, placeId });
  };

  const requestCandidateEdit = (placeId: string, candidateId: string) => {
    setAddOpen(false);
    setCommentPlace(null);
    setDeleteTarget(null);
    setUnscheduledEditId(null);
    setMapSearchResults([]);
    setEditTarget({ date: selectedDate, placeId, candidateId });
  };

  const saveUnscheduledEdit = (candidate: Candidate, targetPlaceId?: string) => {
    if (targetPlaceId) {
      const target = (schedules[selectedDate] ?? []).find((place) => place.id === targetPlaceId);
      if (!target) {
        setDataError("선택한 확정 일정을 찾지 못했습니다. 다시 선택해주세요.");
        return;
      }
      const scheduledCandidate: Candidate = {
        ...candidate,
        time: target.time,
        courseId: placeCourseId(target),
        courseName: target.courseName,
      };
      setSchedules((current) => ({
        ...current,
        [selectedDate]: (current[selectedDate] ?? []).map((place) => place.id === targetPlaceId
          ? { ...place, alternatives: sortCandidates([...place.alternatives.filter((item) => item.id !== scheduledCandidate.id), scheduledCandidate]) }
          : place),
      }));
      setUnscheduledCandidates((current) => current.filter((item) => item.id !== candidate.id));
      setActiveCourseByDate((current) => ({ ...current, [selectedDate]: placeCourseId(target) }));
      setExpanded((current) => ({ ...current, [targetPlaceId]: true }));
      setSelectedId(targetPlaceId);
      setUnscheduledEditId(null);
      setMapSearchResults([]);
      setFocusPoint({ id: scheduledCandidate.id, coords: scheduledCandidate.coords, name: scheduledCandidate.title, token: Date.now() });
      return;
    }
    setUnscheduledCandidates((current) => current.map((item) => item.id === candidate.id ? candidate : item));
    setUnscheduledEditId(null);
    setMapSearchResults([]);
    setFocusPoint({ id: candidate.id, coords: candidate.coords, name: candidate.title, token: Date.now() });
  };

  const deleteUnscheduled = (candidateId: string) => {
    setUnscheduledCandidates((current) => current.filter((candidate) => candidate.id !== candidateId));
    if (focusPoint?.id === candidateId) setFocusPoint(null);
    setUnscheduledEditId(null);
  };

  const toggleCategoryFilter = (category: PlaceCategory) => {
    setVisibleCategories((current) => current.includes(category) ? current.filter((value) => value !== category) : [...current, category]);
  };

  const showOnlyCategory = useCallback((category: PlaceCategory) => setVisibleCategories([category]), []);

  const navigateMapSchedule = (direction: -1 | 1) => {
    const next = places[selectedPlaceIndex + direction];
    if (next) {
      setSelectedId(next.id);
      setSidebarScrollTarget({ id: next.id, token: Date.now() });
      setFocusPoint(null);
      setCommentPlace(null);
      return;
    }
    const adjacentDate = direction === 1 ? nextDate : previousDate;
    if (!adjacentDate) return;
    const adjacentPlaces = sortPlaces(schedules[adjacentDate] ?? []);
    const boundaryPlace = direction === 1 ? adjacentPlaces[0] : adjacentPlaces[adjacentPlaces.length - 1];
    if (!boundaryPlace) return;
    const courseId = placeCourseId(boundaryPlace);
    setActiveCourseByDate((current) => ({ ...current, [adjacentDate]: courseId }));
    setSelectedDate(adjacentDate);
    setSelectedId(boundaryPlace.id);
    setSidebarScrollTarget({ id: boundaryPlace.id, token: Date.now() });
    setFocusPoint(null);
    setCommentPlace(null);
    setMapSearchResults([]);
    setEditingListTitle(false);
    setEditingCourseId(null);
    setCandidateAddTarget(null);
  };

  const resizeBy = (amount: number) => {
    setSidebarWidth((current) => {
      const width = Math.max(360, Math.min(680, current + amount));
      localStorage.setItem("into-the-blue-sidebar-width", String(width));
      return width;
    });
  };

  const onResizeKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "ArrowLeft") { event.preventDefault(); resizeBy(-20); }
    if (event.key === "ArrowRight") { event.preventDefault(); resizeBy(20); }
    if (event.key === "Home") { event.preventDefault(); setSidebarWidth(360); localStorage.setItem("into-the-blue-sidebar-width", "360"); }
    if (event.key === "End") { event.preventDefault(); setSidebarWidth(680); localStorage.setItem("into-the-blue-sidebar-width", "680"); }
  };

  const createInviteLink = async () => {
    if (role !== "owner") return;
    setDataError("");
    const { data: token, error } = await supabase.rpc("create_invite", { p_trip_id: trip.id, p_expires_in_hours: 168 });
    if (error || !token) {
      setDataError("초대 링크를 만들지 못했습니다. 데이터베이스 마이그레이션을 확인해주세요.");
      return;
    }
    const inviteUrl = new URL("/login", window.location.origin);
    inviteUrl.searchParams.set("invite", token);
    try {
      await navigator.clipboard.writeText(inviteUrl.toString());
    } catch {
      const input = document.createElement("textarea");
      input.value = inviteUrl.toString();
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    setShareCopied(true);
    window.setTimeout(() => setShareCopied(false), 1800);
  };

  const chooseTrip = (tripId: string) => {
    setAccountOpen(false);
    setTripForm(null);
    setCommentPlace(null);
    setDeleteTarget(null);
    setEditTarget(null);
    setAddOpen(false);
    setMapSearchResults([]);
    selectTrip(tripId);
  };

  const openTripCreate = () => {
    setTripNameDraft("");
    setTripFormError("");
    setTripForm({ mode: "create" });
  };

  const openTripRename = (targetTrip: WorkspaceTrip) => {
    setTripNameDraft(targetTrip.name);
    setTripFormError("");
    setTripForm({ mode: "rename", trip: targetTrip });
  };

  const closeTripForm = () => {
    if (tripFormBusy) return;
    setTripForm(null);
    setTripFormError("");
  };

  const submitTripForm = async (event: FormEvent) => {
    event.preventDefault();
    if (!tripForm || tripFormBusy) return;
    const nextName = tripNameDraft.trim();
    if (!nextName) {
      setTripFormError("여행 제목을 입력해주세요.");
      return;
    }
    setTripFormBusy(true);
    setTripFormError("");
    const error = tripForm.mode === "create"
      ? await createTrip(nextName)
      : await renameTrip(tripForm.trip.id, nextName);
    setTripFormBusy(false);
    if (error) {
      setTripFormError(error);
      return;
    }
    setTripForm(null);
    if (tripForm.mode === "create") setAccountOpen(false);
  };

  const confirmTripDelete = async () => {
    if (!tripToDelete || tripDeleteBusy) return;
    setTripDeleteBusy(true);
    const error = await deleteTrip(tripToDelete.id);
    setTripDeleteBusy(false);
    if (error) {
      setDataError(error);
      return;
    }
    setTripToDelete(null);
  };

  const exportItineraryPdf = () => {
    const printWindow = window.open("", "_blank", "width=980,height=900");
    if (!printWindow) return;
    const entries = scheduledDates.map((date) => [date, sortPlaces(schedules[date] ?? [])] as const);
    const confirmedCount = entries.reduce((sum, [, items]) => sum + items.length, 0);
    const candidateCount = unscheduledCandidates.length
      + entries.reduce((sum, [, items]) => sum + items.reduce((count, place) => count + place.alternatives.length, 0), 0);
    const daySections = entries.map(([date, items], dayIndex) => `
      <section class="day">
        <header class="day-heading">
          <div><span>DAY ${dayIndex + 1}</span><h2>${escapeHtml(listTitles[date] ?? "새 여행 일정")}</h2></div>
          <time>${escapeHtml(formatTripDate(date))}</time>
        </header>
        <div class="timeline">
          ${normalizeCourses(items, coursesByDate[date] ?? []).map((course) => {
            const courseItems = items.filter((place) => placeCourseId(place) === course.id);
            if (!courseItems.length) return "";
            return `<section class="course-section"><div class="course-heading"><strong>${escapeHtml(course.name)}</strong><span>${courseItems.length}곳</span></div>${courseItems.map((place, placeIndex) => `
              <article class="place">
                <div class="time-column"><strong>${escapeHtml(place.time)}</strong><span>${placeIndex + 1}</span></div>
                <div class="place-body">
                  <div class="place-title"><h3>${escapeHtml(place.title)}</h3></div>
                  ${place.note ? `<p class="memo">${noteHtml(place.note)}</p>` : ""}
                  ${place.alternatives.length ? `<div class="candidates"><h4>후보 장소</h4>${sortCandidates(place.alternatives).map((candidate) => `<div class="candidate"><div><strong>${escapeHtml(candidate.title)}</strong><span>${escapeHtml(candidate.time)}</span>${candidate.note ? `<p>${noteHtml(candidate.note)}</p>` : ""}</div></div>`).join("")}</div>` : ""}
                </div>
              </article>`).join("")}</section>`;
          }).join("")}
        </div>
      </section>`).join("");

    printWindow.document.open();
    printWindow.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(trip.name)} 일정</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      @page { size: A4; margin: 13mm; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #f5f7fa; color: #1d1d1f; font-family: "Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .sheet { width: 100%; max-width: 860px; margin: 0 auto; padding: 28px; background: #fff; }
      .cover { position: relative; min-height: 210px; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 30px; padding: 36px; border: 1px solid rgba(60,60,67,.12); border-radius: 24px; background: #f5f7fa; color: #1d1d1f; }
      .cover-copy { position: relative; z-index: 1; min-width: 0; }
      .eyebrow { display: block; margin-bottom: 12px; color: #007aff; font-size: 10px; font-weight: 800; letter-spacing: .18em; }
      .cover h1 { max-width: 100%; margin: 0; overflow-wrap: anywhere; word-break: keep-all; font: 600 40px/1.08 "Pretendard Variable", Pretendard, sans-serif; letter-spacing: -.03em; }
      .cover-copy > p { margin: 13px 0 0; color: #6e6e73; font-size: 13px; line-height: 1.4; }
      .stats { position: relative; z-index: 1; display: flex; align-self: end; gap: 18px; }
      .stats div { min-width: 64px; padding-left: 12px; border-left: 1px solid rgba(60,60,67,.16); }
      .stats strong { display: block; color: #1d1d1f; font-size: 20px; font-variant-numeric: tabular-nums; }
      .stats span { color: #6e6e73; font-size: 9px; }
      .day { margin-top: 30px; break-before: auto; }
      .day + .day { padding-top: 9px; border-top: 1px solid rgba(60,60,67,.12); }
      .day-heading { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 18px; padding: 0 2px 12px; border-bottom: 2px solid #007aff; }
      .day-heading span { color: #007aff; font-size: 9px; font-weight: 800; letter-spacing: .13em; }
      .day-heading > div { min-width: 0; }
      .day-heading h2 { margin: 5px 0 0; overflow-wrap: anywhere; word-break: keep-all; color: #1d1d1f; font: 600 23px/1.2 "Pretendard Variable", Pretendard, sans-serif; }
      .day-heading time { flex: none; color: #6e6e73; font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .course-section + .course-section { margin-top: 22px; padding-top: 16px; border-top: 1px dashed rgba(60,60,67,.16); }
      .course-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 11px; padding: 7px 10px; border-radius: 9px; background: #f0f2f5; color: #3a3a3c; }
      .course-heading strong { font-size: 11px; }
      .course-heading span { font-size: 8px; font-weight: 700; }
      .place { display: grid; grid-template-columns: 66px 1fr; gap: 15px; margin-bottom: 14px; break-inside: avoid; }
      .time-column { display: flex; flex-direction: column; align-items: center; gap: 7px; padding-top: 5px; color: #6e6e73; }
      .time-column strong { font-size: 11px; font-variant-numeric: tabular-nums; }
      .time-column span { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: #007aff; color: white; font-size: 10px; font-weight: 800; }
      .place-body { position: relative; padding: 15px 16px; border: 1px solid rgba(60,60,67,.12); border-radius: 15px; background: white; }
      .place-title { display: flex; align-items: center; }
      .place-title h3 { margin: 0; color: #1d1d1f; font: 600 16px/22px "Pretendard Variable", Pretendard, sans-serif; }
      .meta { margin: 5px 0 0; color: #8e8e93; font-size: 9px; }
      .memo { margin: 10px 0 0; padding: 9px 11px; border-left: 3px solid #007aff; border-radius: 0 8px 8px 0; background: #f2f7ff; color: #6e6e73; font-size: 9px; line-height: 1.55; }
      .candidates { margin-top: 11px; padding-top: 9px; border-top: 1px dashed rgba(60,60,67,.16); }
      .candidates h4 { margin: 0 0 6px; color: #8e8e93; font-size: 8px; letter-spacing: .06em; }
      .candidate { padding: 6px 0; }
      .candidate + .candidate { border-top: 1px solid #f0f1f3; }
      .candidate > div { display: flex; flex-direction: column; gap: 2px; }
      .candidate strong { color: #3a3a3c; font-size: 10px; }
      .candidate span, .candidate p { margin: 0; color: #8e8e93; font-size: 8px; line-height: 1.45; }
      .candidate p { color: #6e6e73; }
      footer { display: flex; justify-content: space-between; margin-top: 34px; padding: 14px 2px 0; border-top: 1px solid rgba(60,60,67,.12); color: #8e8e93; font-size: 8px; }
      @media screen and (max-width: 640px) {
        .sheet { padding: 12px; }
        .cover { min-height: auto; grid-template-columns: 1fr; gap: 24px; padding: 26px 22px 24px; border-radius: 18px; }
        .eyebrow { margin-bottom: 9px; font-size: 8px; }
        .cover h1 { font-size: clamp(28px, 9.5vw, 38px); line-height: 1.12; }
        .cover-copy > p { margin-top: 9px; font-size: 11px; }
        .stats { width: 100%; justify-content: space-between; gap: 0; }
        .stats div { flex: 1; min-width: 0; padding-left: 9px; }
        .stats strong { font-size: 18px; }
        .stats span { font-size: 8px; }
        .day { margin-top: 24px; }
        .day-heading { align-items: flex-start; gap: 12px; margin-bottom: 14px; }
        .day-heading h2 { font-size: 19px; line-height: 1.25; }
        .day-heading time { padding-top: 2px; font-size: 9px; }
        footer { flex-direction: column; gap: 4px; }
      }
      @media print { body { background: white; } .sheet { max-width: none; padding: 0; } .day { break-inside: auto; } }
    </style></head><body><main class="sheet"><section class="cover"><div class="cover-copy"><span class="eyebrow">TRAVEL ITINERARY</span><h1>${escapeHtml(trip.name)}</h1><p>${escapeHtml(tripDateRange)}</p></div><div class="stats"><div><strong>${entries.length}</strong><span>여행 일수</span></div><div><strong>${confirmedCount}</strong><span>확정 일정</span></div><div><strong>${candidateCount}</strong><span>후보 장소</span></div></div></section>${daySections}<footer><span>${escapeHtml(trip.name)}</span><span>Into the Blue · ${escapeHtml(new Date().toLocaleDateString("ko-KR"))}</span></footer></main><script>window.addEventListener("load",function(){setTimeout(function(){window.focus();window.print();},500)});</script></body></html>`);
    printWindow.document.close();
  };

  const appStyle = { "--sidebar-width": `${sidebarWidth}px` } as CSSProperties;
  const valueMapsEnabled = Boolean(process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN?.trim());

  if (!dataReady) return <main className="data-loading">여행 일정을 불러오는 중...</main>;

  return (
    <main className={`app-shell ${dragged ? "is-dragging" : ""}`} style={appStyle}>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Into the Blue 홈">
          <strong><i aria-hidden="true">⌖</i> Into the Blue</strong>
          <span>MAP THE MOMENTS <i aria-hidden="true">·</i> KEEP THE JOURNEY</span>
        </a>
        <div className="trip-title"><strong>{trip.name}</strong>{tripDday && <b className="trip-dday" aria-label={`여행 시작일까지 ${tripDday}`}>{tripDday}</b>}<span className="trip-date-range">{tripDateRange}</span></div>
        <div className="top-actions">
          <div className="people" aria-label={`함께 여행하는 사람 ${members.length}명`}>{members.slice(0, 4).map((member) => <span key={member.id} title={member.nickname}>{member.avatarUrl ? <img src={member.avatarUrl} alt="" /> : member.nickname.slice(0, 1)}</span>)}</div>
          <button className="pdf-button" onClick={exportItineraryPdf} disabled={!scheduledDates.length} aria-label="전체 일정 PDF 저장"><span>⇩</span> PDF 저장</button>
          <button className="import-button" onClick={() => setImportOpen(true)} title="구글·카카오·네이버 즐겨찾기 공유 링크로 후보 가져오기"><span>★</span> 즐겨찾기 가져오기</button>
          <button className="add-place-button" onClick={openAddPlace}><span>＋</span> 장소 추가</button>
          {role === "owner" && <button className={`share-button ${shareCopied ? "is-copied" : ""}`} onClick={createInviteLink} title="7일 동안 여러 명이 사용할 수 있는 초대 링크"><span>{shareCopied ? "✓" : "⧉"}</span> {shareCopied ? "복사됨" : "초대 링크"}</button>}
          <div className="account-menu-wrap">
            <button className="account-button" onClick={() => { setAccountOpen((value) => !value); setTripForm(null); setTripFormError(""); }} title="내 여행 일정" aria-label="내 여행 일정 열기" aria-expanded={accountOpen}>{avatarUrl ? <img src={avatarUrl} alt="" /> : userName.slice(0, 1)}</button>
            {accountOpen && (
              <section className="account-menu" aria-label="내 여행 일정">
                <div className="account-menu-profile"><div className="account-menu-avatar">{avatarUrl ? <img src={avatarUrl} alt="" /> : userName.slice(0, 1)}</div><div><strong>{userName}</strong><span>접근 가능한 여행 {trips.length}개</span></div></div>
                <div className="account-menu-heading"><div><span>내 여행 일정</span><small>선택해서 전환</small></div><button className="account-new-trip" onClick={openTripCreate}>＋ 새 여행 일정</button></div>
                {tripForm && (
                  <form className="account-trip-form" onSubmit={submitTripForm}>
                    <label htmlFor="account-trip-name">{tripForm.mode === "create" ? "새 여행 제목" : "여행 제목 수정"}</label>
                    <input id="account-trip-name" value={tripNameDraft} onChange={(event) => setTripNameDraft(event.target.value)} maxLength={40} placeholder="예: 제주도 가족 여행" autoFocus />
                    {tripFormError && <p role="alert">{tripFormError}</p>}
                    <div><button type="button" onClick={closeTripForm} disabled={tripFormBusy}>취소</button><button type="submit" disabled={tripFormBusy}>{tripFormBusy ? "저장 중..." : tripForm.mode === "create" ? "만들기" : "저장"}</button></div>
                  </form>
                )}
                <div className="account-trip-list">
                  {trips.map((item) => (
                    <div className={`account-trip-row ${item.id === trip.id ? "is-current" : ""}`} key={item.id}>
                      <button className="account-trip-select" onClick={() => chooseTrip(item.id)}><span className="account-trip-check">{item.id === trip.id ? "✓" : ""}</span><span><strong>{item.name}</strong><small>{item.role === "owner" ? "내가 만든 여행" : "초대받은 여행"}</small></span></button>
                      {item.role === "owner" && <div className="account-trip-actions"><button className="account-trip-edit" onClick={() => openTripRename(item)} aria-label={`${item.name} 제목 수정`} title="여행 제목 수정">✎</button><button className="account-trip-delete" onClick={() => { setAccountOpen(false); setTripForm(null); setTripToDelete(item); }} aria-label={`${item.name} 삭제`} title="여행 삭제">삭제</button></div>}
                    </div>
                  ))}
                </div>
                <button className="account-signout" onClick={() => { setAccountOpen(false); void signOut(); }}>로그아웃</button>
              </section>
            )}
          </div>
        </div>
      </header>

      {accountOpen && <button className="account-menu-backdrop" onClick={() => { setAccountOpen(false); setTripForm(null); setTripFormError(""); }} aria-label="내 여행 일정 닫기" />}

      {dataError && <div className="data-error" role="alert">{dataError}<button onClick={() => setDataError("")}>×</button></div>}

      <section ref={schedulePanelRef} className={`schedule-panel ${mobileSchedule ? "is-open" : ""}`} id="top">
        <div className="schedule-header"><div><p className="date-kicker">{formatDate(selectedDate)}</p>{editingListTitle ? <form className="list-title-form" onSubmit={saveListTitle}><input value={listTitleDraft} onChange={(event) => setListTitleDraft(event.target.value)} maxLength={40} autoFocus aria-label="일정 목록 제목" /><button type="submit">저장</button><button type="button" onClick={() => setEditingListTitle(false)}>취소</button></form> : <div className="list-title-row"><h1>{currentListTitle}</h1><div className="list-title-actions"><button onClick={beginListTitleEdit} aria-label="목록 제목 수정" title="제목 수정">✎</button>{(schedules[selectedDate]?.length ?? 0) > 0 && <button className="day-move-button" onClick={openDayMove} aria-label={`${formatTripDate(selectedDate)} 전체 일정 다른 날짜로 이동`} title="이 날짜 일정 이동"><span aria-hidden="true">→</span></button>}</div></div>}<p>날짜별로 코스를 나눠 일정을 정리할 수 있어요.</p></div><button className="mobile-close" onClick={() => setMobileSchedule(false)} aria-label="지도 보기">×</button></div>
        <div className="date-navigation" aria-label="여행 날짜 선택">
          <button disabled={!previousDate} onClick={() => previousDate && chooseDate(previousDate)} aria-label="일정이 있는 이전 날짜">‹</button>
          <label><span>{relativeDateLabel(selectedDate, today)}</span><input type="date" value={selectedDate} onChange={(event) => chooseDate(event.target.value)} aria-label="날짜 직접 선택" /></label>
          <button disabled={!nextDate} onClick={() => nextDate && chooseDate(nextDate)} aria-label="일정이 있는 다음 날짜">›</button>
        </div>
        <div className="drag-guide"><span>⋮</span><p><strong>아이콘을 잡아 일정 편집</strong>카드에 놓으면 확정, 후보 버튼에 놓으면 후보가 돼요.</p><button onClick={openAddPlace}>＋ 추가</button></div>

        <section
          className={`unscheduled-pool ${unscheduledOpen ? "is-open" : ""} ${dropZone === "unscheduled:pool" ? "is-drop-target" : ""}`}
          data-drop-kind="unscheduled"
          data-place-id="pool"
          aria-label="날짜 미정 후보 목록"
        >
          <button className="unscheduled-pool-heading" onClick={() => setUnscheduledOpen((value) => !value)} aria-expanded={unscheduledOpen} aria-controls="unscheduled-candidate-list">
            <span className="unscheduled-pool-icon" aria-hidden="true">⌖</span>
            <span><strong>날짜 미정 후보</strong><small>어느 날짜에도 속하지 않은 장소 · 지도에 항상 표시</small></span>
            <b>{unscheduledCandidates.length}</b>
            <i className={unscheduledOpen ? "up" : ""} aria-hidden="true">⌄</i>
          </button>
          {unscheduledOpen && <div className="unscheduled-list" id="unscheduled-candidate-list">
            {unscheduledCandidates.length === 0 && <div className="unscheduled-empty"><strong>저장된 후보가 없어요</strong><span>장소 추가에서 ‘날짜 미정 후보’를 선택하거나 일정 카드를 이곳에 놓아보세요.</span></div>}
            {unscheduledCandidates.map((candidate) => <div className={`unscheduled-row ${dragged?.kind === "unscheduled" && dragged.candidateId === candidate.id ? "is-drag-source" : ""}`} data-sidebar-item-id={candidate.id} key={candidate.id}>
              <button className="unscheduled-drag" onPointerDown={(event) => startPointerDrag(event, { kind: "unscheduled", candidateId: candidate.id }, candidate.title)} onPointerMove={movePointerDrag} onPointerUp={finishPointerDrag} onPointerCancel={finishDrag} aria-label={`${candidate.title} 드래그하여 일정에 배치`} title="잡아서 일정에 배치">⋮</button>
              <div className="unscheduled-copy" role="button" tabIndex={0} onClick={() => { setFocusPoint({ id: candidate.id, coords: candidate.coords, name: candidate.title, token: Date.now() }); if (window.innerWidth < 840) setMobileSchedule(false); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setFocusPoint({ id: candidate.id, coords: candidate.coords, name: candidate.title, token: Date.now() }); } }}>
                <strong>{candidate.title}</strong>
                <span className={candidate.note ? "" : "is-empty"}>{candidate.note || "메모를 추가해보세요."}</span>
                {candidate.createdByName && <small>{candidate.createdByName}님이 추가</small>}
              </div>
              <CategoryTag item={candidate} onClick={() => showOnlyCategory(placeCategory(candidate))} />
              <button className="unscheduled-edit" onClick={() => { setAddOpen(false); setCandidateAddTarget(null); setCommentPlace(null); setDeleteTarget(null); setEditTarget(null); setUnscheduledEditId(candidate.id); setMapSearchResults([]); }} aria-label={`${candidate.title} 수정 및 삭제`} title="수정 및 삭제">✎</button>
              <a href={googleReviewsUrl(candidate)} target="_blank" rel="noreferrer" aria-label={`${candidate.title} Google에서 보기`}>Google</a>
            </div>)}
            <div className="unscheduled-drop-hint">일정이나 후보를 이곳에 놓으면 날짜 미정 후보가 됩니다.</div>
          </div>}
        </section>

        <section className="course-itinerary-shell">
          <section className="course-switcher" aria-label={`${formatTripDate(selectedDate)} 코스 선택`}>
            <div className="course-tabs-row">
              <div className="course-tabs" role="tablist" aria-label="날짜별 여행 코스">
                {currentCourses.map((course) => {
                  const count = (schedules[selectedDate] ?? []).filter((place) => placeCourseId(place) === course.id).length;
                  const isActive = course.id === activeCourseId;
                  return <div className={`course-tab-item ${isActive ? "active" : ""}`} role="presentation" key={course.id}>
                    {isActive && editingCourseId === course.id
                      ? <form className="course-tab-name-form" onSubmit={saveCourseName} onClick={(event) => event.stopPropagation()}>
                        <input value={courseNameDraft} onChange={(event) => setCourseNameDraft(event.target.value)} maxLength={24} aria-label="코스 이름" autoFocus />
                        <button type="submit" aria-label="코스 이름 저장" title="저장">✓</button>
                        <button type="button" onClick={() => setEditingCourseId(null)} aria-label="코스 이름 수정 취소" title="취소">×</button>
                      </form>
                      : <>
                        <button type="button" role="tab" aria-selected={isActive} onClick={() => isActive ? beginCourseNameEdit(course) : chooseCourse(course.id)} title={isActive ? "한 번 더 누르면 코스명 수정" : `${course.name} 선택`}><span>{course.name}</span><small>{count}</small></button>
                        {isActive && <div className="course-tab-actions">
                      <button type="button" className="course-delete-button" onClick={() => requestCourseDelete(course)} disabled={currentCourses.length <= 1} aria-label={`${course.name} 삭제`} title={currentCourses.length <= 1 ? "마지막 코스는 삭제할 수 없습니다" : "코스 삭제"}>×</button>
                        </div>}
                      </>}
                  </div>;
                })}
              </div>
              <button className="course-add-button" type="button" onClick={addCourse} aria-label="이 날짜에 새 코스 추가" title="새 코스 추가">＋</button>
            </div>
          </section>

          <div className="timeline-list">
          <div className="timeline-track"><span style={{ height: `${timeline.progress}%` }} /></div>
          {places.length === 0 && <div className="empty-schedule"><span>빈 코스</span><h2>{currentCourse.name}에 아직 일정이 없어요</h2><p>이 코스에 가고 싶은 장소를 추가해보세요.</p><button onClick={openFirstCoursePlace}>＋ 첫 장소 추가</button></div>}
          {places.map((place, index) => {
            const commentCount = comments[place.id]?.length ?? 0;
            const isCandidateListOpen = expanded[place.id] ?? false;
            const candidateListId = `candidate-list-${place.id}`;
            return (
              <article className={`schedule-item ${selectedId === place.id ? "is-selected" : ""} ${index === timeline.active ? "is-current" : ""} ${dragged?.kind === "primary" && dragged.placeId === place.id ? "is-drag-source" : ""}`} data-sidebar-item-id={place.id} key={place.id}>
                <button className={`time-pin ${index < timeline.active ? "is-past" : ""} ${index === timeline.active ? "is-active" : ""}`} onClick={() => selectPlace(place.id)} aria-label={`${place.time} ${place.title} 지도에서 보기`}><span>{index < timeline.active ? "✓" : index + 1}</span></button>
                <time>{place.time}</time>
                <div
                  className={`place-card ${dropZone === `primary:${place.id}` ? "is-drop-target" : ""}`}
                  data-drop-kind="primary"
                  data-place-id={place.id}
                >
                  <button className="corner-edit-button" onClick={() => requestPrimaryEdit(place.id)} aria-label={`${place.title} 수정`} title="수정">✎</button>
                  <div className="place-main"><button className="drag-handle" onPointerDown={(event) => startPointerDrag(event, { kind: "primary", placeId: place.id }, place.title)} onPointerMove={movePointerDrag} onPointerUp={finishPointerDrag} onPointerCancel={finishDrag} aria-label={`${place.title} 드래그하여 이동`} title="잡아서 일정 이동">⋮</button><button className="place-copy" onClick={() => { selectPlace(place.id); if (place.alternatives.length) openCandidateList(place.id); }}><span className="place-topline"><strong>{place.title}</strong></span>{place.createdByName && <small className="created-by">{place.createdByName}님이 추가</small>}</button></div>
                  <p className={`place-note ${place.note ? "" : "is-empty"}`}>{place.note || "메모를 추가해보세요."}</p>
                  <div className="card-actions"><CategoryTag item={place} onClick={() => showOnlyCategory(placeCategory(place))} /><button className={dropZone === `candidate:${place.id}` ? "is-drop-target" : ""} data-drop-kind="candidate" data-place-id={place.id} onClick={() => toggleCandidateList(place.id)} aria-expanded={isCandidateListOpen} aria-controls={candidateListId}>후보 {place.alternatives.length} <b className={isCandidateListOpen ? "up" : ""}>⌄</b></button><button className={commentPlace === place.id ? "active" : ""} onClick={() => setCommentPlace(commentPlace === place.id ? null : place.id)}>댓글 {commentCount}</button><a href={googleReviewsUrl(place)} target="_blank" rel="noreferrer" aria-label={`${place.title} Google에서 보기`}>Google</a></div>
                  {isCandidateListOpen && (
                    <div id={candidateListId} data-drop-kind="candidate" data-place-id={place.id} className={`alternatives ${dropZone === `candidate:${place.id}` ? "is-drop-target" : ""}`}>
                      {place.alternatives.map((candidate) => (
                        <div className={`alternative-row ${dragged?.kind === "candidate" && dragged.candidateId === candidate.id ? "is-drag-source" : ""}`} data-sidebar-item-id={candidate.id} key={candidate.id}>
                          <button className="corner-edit-button candidate-corner-edit" onClick={() => requestCandidateEdit(place.id, candidate.id)} aria-label={`${candidate.title} 수정`} title="수정">✎</button>
                          <div className="candidate-main"><button className="candidate-drag" onPointerDown={(event) => startPointerDrag(event, { kind: "candidate", placeId: place.id, candidateId: candidate.id }, candidate.title)} onPointerMove={movePointerDrag} onPointerUp={finishPointerDrag} onPointerCancel={finishDrag} aria-label={`${candidate.title} 드래그하여 이동`} title="잡아서 후보 이동">⋮</button><button className="candidate-copy" onClick={() => { setSelectedId(place.id); setFocusPoint({ id: candidate.id, coords: candidate.coords, name: candidate.title, token: Date.now() }); if (window.innerWidth < 840) setMobileSchedule(false); }}><span className="candidate-topline"><strong>{candidate.title}</strong></span><small>{candidate.time}</small>{candidate.createdByName && <small className="created-by">{candidate.createdByName}님이 추가</small>}<span className={`candidate-note-preview ${candidate.note ? "" : "is-empty"}`}>{candidate.note || "메모를 추가해보세요."}</span></button></div>
                          <div className="candidate-actions"><CategoryTag item={candidate} onClick={() => showOnlyCategory(placeCategory(candidate))} /><a href={googleReviewsUrl(candidate)} target="_blank" rel="noreferrer" aria-label={`${candidate.title} Google에서 보기`}>Google</a></div>
                        </div>
                      ))}
                      <button type="button" className="candidate-drop-hint" onClick={() => openCandidateAdd(place.id)}><span aria-hidden="true">＋</span> 이 일정에 후보 장소 추가</button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
          </div>
        </section>
      </section>

      <div
        className="sidebar-resizer"
        role="separator"
        aria-label="일정 사이드바 너비 조절"
        aria-orientation="vertical"
        aria-valuemin={360}
        aria-valuemax={680}
        aria-valuenow={Math.round(sidebarWidth)}
        tabIndex={0}
        onPointerDown={() => setResizing(true)}
        onKeyDown={onResizeKeyDown}
      ><span /></div>

      <section className="map-panel">
        <MapView places={places} unscheduledCandidates={unscheduledCandidates} searchResults={mapSearchResults} selectedId={selected?.id ?? ""} focusPoint={focusPoint} onSelect={selectMapItem} onComment={openMapComments} onEdit={openMapEdit} commentCounts={commentCounts} getReviewUrl={googleReviewsUrl} visibleCategories={visibleCategories} showPinNotes={showPinNotes} onCategoryOnly={showOnlyCategory} valueContext={{ tripId: trip.id, userId: user.id, name: userName, avatarUrl }} />
        <div className="map-provider-note"><strong>{valueMapsEnabled ? "Mapbox · Faded" : "Mapbox 연결 대기"}</strong><span>{valueMapsEnabled ? `${process.env.NEXT_PUBLIC_ROUTE_API_URL?.trim() ? "OSRM 우선 · Mapbox 대체 경로" : "Mapbox 자동차 경로"} · Google Places 장소 검색` : "공개 토큰을 연결하면 지도가 표시됩니다"}</span></div>
        <div className="map-overlay-top"><button className="mobile-schedule-button" onClick={() => setMobileSchedule(true)}>☰ <span>{relativeDateLabel(selectedDate, today)} 일정</span></button><div className="map-overlay-controls"><div className="route-legend"><span className="route-line" /> 확정 일정 경로 <small>{places.length}곳 · 후보 {totalCandidates}곳 · 날짜 미정 {unscheduledCandidates.length}곳{mapSearchResults.length ? ` · 검색 ${mapSearchResults.length}곳` : ""}</small></div><div className={`map-category-filter ${categoryFilterOpen ? "is-open" : "is-collapsed"}`} role="group" aria-label="지도 카테고리 필터"><button className="map-category-toggle" onClick={() => setCategoryFilterOpen((open) => !open)} aria-expanded={categoryFilterOpen} aria-controls="map-category-filter-items"><span aria-hidden="true">⚲</span><strong>필터</strong><i aria-hidden="true">{categoryFilterOpen ? "⌃" : "⌄"}</i></button>{categoryFilterOpen && <div id="map-category-filter-items">{PLACE_CATEGORIES.map((category) => <button key={category.value} className={visibleCategories.includes(category.value) ? "active" : ""} onClick={() => toggleCategoryFilter(category.value)} aria-pressed={visibleCategories.includes(category.value)}><span aria-hidden="true">{category.icon}</span>{category.label}</button>)}<button className={`map-note-filter ${showPinNotes ? "active" : ""}`} onClick={() => setShowPinNotes((visible) => !visible)} aria-pressed={showPinNotes}><span aria-hidden="true">▤</span>메모</button></div>}</div></div></div>
        {selected && (selectedPlaceIndex > 0 || previousDate || selectedPlaceIndex < places.length - 1 || nextDate) && <div className="map-itinerary-navigation" aria-label="선택한 일정 지도 이동"><button onClick={() => navigateMapSchedule(-1)} disabled={selectedPlaceIndex <= 0 && !previousDate} aria-label="이전 일정으로 이동">‹</button><div><strong>{selectedPlaceIndex + 1} / {places.length}</strong><span>{selected.title}</span></div><button onClick={() => navigateMapSchedule(1)} disabled={selectedPlaceIndex >= places.length - 1 && !nextDate} aria-label="다음 일정으로 이동">›</button></div>}
        <div className="map-credit">© Mapbox · © OpenStreetMap contributors</div>
      </section>

      <nav className="mobile-view-switcher" aria-label="모바일 화면 전환"><button className={mobileSchedule ? "active" : ""} onClick={() => setMobileSchedule(true)}><span>☷</span>일정</button><button className={!mobileSchedule ? "active" : ""} onClick={() => setMobileSchedule(false)}><span>⌖</span>지도</button></nav>

      {importOpen && <><button className="popover-backdrop" onClick={() => setImportOpen(false)} aria-label="즐겨찾기 가져오기 닫기" /><ImportBookmarksDialog onClose={() => setImportOpen(false)} onImport={importSharedBookmarks} /></>}
      {(openCommentPlace || deletePlace || tripToDelete || dayMoveSource || courseDeleteTarget) && <button className="popover-backdrop" onClick={() => { if (tripDeleteBusy || dayMoveBusy || courseDeleteBusy) return; setCommentPlace(null); setDeleteTarget(null); setTripToDelete(null); setCourseDeleteTarget(null); closeDayMove(); }} aria-label="팝업 닫기" />}
      {addOpen && <AddPlacePanel schedules={activeSchedules} defaultDate={addDefaults.date} defaultTime={addDefaults.time} onClose={() => setAddOpen(false)} onAdd={addPlace} onSearchResults={setMapSearchResults} />}
      {candidateAddPlace && <AddCandidatePanel place={candidateAddPlace} unscheduledCandidates={unscheduledCandidates} registeredItems={Object.values(schedules).flatMap((dayPlaces) => dayPlaces.flatMap((place) => [place, ...place.alternatives]))} onClose={() => { setCandidateAddTarget(null); setMapSearchResults([]); }} onAdd={addCandidateToPlace} onAddMany={addCandidatesToPlace} onSearchResults={setMapSearchResults} onPreview={(candidate) => { setSelectedId(candidateAddPlace.id); setFocusPoint({ id: candidate.id, coords: candidate.coords, name: candidate.title, token: Date.now() }); }} />}
      {editablePlace && editTarget && editSourcePlace && <EditPlacePanel schedules={activeSchedules} targetDate={editTarget.date} place={editSourcePlace} candidate={editSourceCandidate} onClose={() => setEditTarget(null)} onSave={(values) => savePlaceEdit(editTarget, values)} onDelete={() => { setMapSearchResults([]); if (editTarget.candidateId) requestCandidateDelete(editTarget.placeId, editTarget.candidateId); else requestPrimaryDelete(editSourcePlace); }} onSearchResults={setMapSearchResults} />}
      {editableUnscheduled && <EditUnscheduledPanel item={editableUnscheduled} targetDate={selectedDate} confirmedPlaces={sortPlaces(schedules[selectedDate] ?? [])} onClose={() => { setUnscheduledEditId(null); setMapSearchResults([]); }} onSave={saveUnscheduledEdit} onDelete={() => { if (window.confirm(`${editableUnscheduled.title} 후보를 삭제할까요?`)) deleteUnscheduled(editableUnscheduled.id); }} onSearchResults={setMapSearchResults} />}
      {openCommentPlace && <CommentPopover place={openCommentPlace} comments={comments[openCommentPlace.id] ?? []} userName={userName} avatarUrl={avatarUrl} onClose={() => setCommentPlace(null)} onAdd={(content) => addComment(openCommentPlace.id, content)} />}
      {deletePlace && <DeleteDialog place={deletePlace} candidate={deleteCandidate} onCancel={() => setDeleteTarget(null)} onPromote={() => removePrimary(deletePlace.id, false)} onDeleteAll={() => deleteCandidate ? removeCandidate(deletePlace.id, deleteCandidate.id) : removePrimary(deletePlace.id, true)} onMoveCandidate={() => { if (deleteCandidate) moveCandidateToUnscheduled(deletePlace.id, deleteCandidate.id); }} />}
      {tripToDelete && <TripDeleteDialog trip={tripToDelete} busy={tripDeleteBusy} onCancel={() => setTripToDelete(null)} onDelete={confirmTripDelete} />}
      {courseDeleteTarget && <ConfirmDialog label="DELETE COURSE" title={`${courseDeleteTarget.course.name}를 삭제할까요?`} message={courseDeletePlaces.length ? `이 코스에 등록된 일정 ${courseDeletePlaces.length}곳과 모든 후보 장소가 코스와 함께 삭제됩니다.` : "이 코스가 일정에서 삭제됩니다."} detail="삭제한 코스와 장소는 복구할 수 없습니다." confirmLabel="코스와 장소 삭제" busy={courseDeleteBusy} onCancel={() => setCourseDeleteTarget(null)} onConfirm={() => void confirmCourseDelete()} />}
      {dayMoveSource && <MoveDayDialog sourceDate={dayMoveSource} sourceTitle={listTitles[dayMoveSource] ?? "새 여행 일정"} sourceCount={schedules[dayMoveSource]?.length ?? 0} targetDate={dayMoveDate} targetCount={schedules[dayMoveDate]?.length ?? 0} confirmOverwrite={dayMoveConfirmOverwrite} busy={dayMoveBusy} error={dayMoveError} onTargetDateChange={changeDayMoveDate} onCancel={closeDayMove} onMove={moveDay} />}
      {dragPreview && <div className={`drag-preview is-${dragPreview.kind}`} style={{ left: dragPreview.x, top: dragPreview.y }} aria-hidden="true"><span>⋮</span><strong>{dragPreview.title}</strong><small>{dropZone ? "여기에 놓기" : "원하는 위치로 이동"}</small></div>}
    </main>
  );
}
