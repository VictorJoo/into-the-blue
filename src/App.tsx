import { CSSProperties, DragEvent, FormEvent, KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";
import { signOut } from "./lib/auth";
import { supabase } from "./lib/supabase";
import MapView from "./MapView";
import { createPhuQuocItinerary, PHU_QUOC_DATES, PHU_QUOC_LIST_TITLES } from "./data/phuQuocItinerary";
import type { Candidate, DragItem, Place } from "./types";
import { useWorkspace, type WorkspaceTrip } from "./workspace";

type Comment = { id: string; userId: string; name: string; avatarUrl?: string; content: string; createdAt: string };
type CommentsByPlace = Record<string, Comment[]>;
type SchedulesByDate = Record<string, Place[]>;
type NoteTarget = { placeId: string; candidateId?: string };
type DeleteTarget = { placeId: string; candidateId?: string };
type EditTarget = { date: string; placeId: string; candidateId?: string };
type PlaceEditValues = {
  title: string;
  date: string;
  time: string;
  coords: [number, number];
  googleMapsUrl?: string;
  parentId?: string;
};

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

function primaryMeta(place: Pick<Place, "category" | "duration">) {
  return [cleanPlaceLabel(place.category), cleanPlaceLabel(place.duration)].filter(Boolean).join(" · ");
}

function candidateMeta(candidate: Pick<Candidate, "time" | "category">) {
  return [candidate.time, cleanPlaceLabel(candidate.category)].filter(Boolean).join(" · ");
}

function sortCandidates(items: Candidate[]) {
  return [...items]
    .map((candidate) => ({ ...candidate, category: cleanPlaceLabel(candidate.category) }))
    .sort((a, b) => minutes(a.time) - minutes(b.time));
}

function sortPlaces(items: Place[]) {
  return [...items]
    .map((place) => ({
      ...place,
      category: cleanPlaceLabel(place.category),
      duration: cleanPlaceLabel(place.duration),
      alternatives: sortCandidates(place.alternatives),
    }))
    .sort((a, b) => minutes(a.time) - minutes(b.time));
}

function newId(prefix = "place") {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
}

function googleReviewsUrl(place: Pick<Candidate, "title" | "coords" | "googleMapsUrl">) {
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
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
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

function asCandidate(place: Place): Candidate {
  return {
    id: place.id,
    time: place.time,
    title: place.title,
    category: place.category,
    note: place.note,
    coords: place.coords,
    googleMapsUrl: place.googleMapsUrl,
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

function AddPlacePanel({
  schedules,
  defaultDate,
  onClose,
  onAdd,
}: {
  schedules: SchedulesByDate;
  defaultDate: string;
  onClose: () => void;
  onAdd: (candidate: Candidate, rank: "primary" | "candidate", parentId: string, date: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("12:00");
  const [rank, setRank] = useState<"primary" | "candidate">("primary");
  const [parentId, setParentId] = useState(schedules[defaultDate]?.[0]?.id ?? "");
  const [googleUrl, setGoogleUrl] = useState("");
  const [parsedLink, setParsedLink] = useState<ParsedGoogleMapsLink | null>(null);
  const [memo, setMemo] = useState("");
  const [error, setError] = useState("");
  const itinerary = useMemo(() => sortPlaces(schedules[date] ?? []), [schedules, date]);

  const analyzeGoogleLink = (value = googleUrl) => {
    const parsed = parseGoogleMapsLink(value);
    if (!parsed) {
      setParsedLink(null);
      setError("전체 Google Maps 링크인지 확인해주세요. 짧은 링크는 전체 URL로 열어서 붙여넣어야 합니다.");
      return;
    }
    setGoogleUrl(parsed.url);
    setParsedLink(parsed);
    if (parsed.title) setQuery(parsed.title);
    setMemo("");
    setError("");
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim() || !date || !time || !parsedLink) {
      setError("Google Maps 전체 링크를 붙여넣고 분석한 뒤 장소명, 날짜와 시간을 확인해주세요.");
      return;
    }
    if (rank === "candidate" && !parentId) {
      setError("후보를 넣을 확정 일정을 선택해주세요.");
      return;
    }
    onAdd(
      {
        id: newId(rank),
        time,
        title: query.trim(),
        category: "",
        note: memo.trim(),
        coords: parsedLink.coords,
        googleMapsUrl: parsedLink.url,
      },
      rank,
      parentId,
      date,
    );
    onClose();
  };

  return (
    <div className="add-panel" role="dialog" aria-modal="true" aria-label="새 장소 추가">
      <div className="popover-heading">
        <div><span className="eyebrow">FREE PLACE SEARCH</span><h3>새 장소 추가</h3></div>
        <button className="icon-button" onClick={onClose} aria-label="장소 추가 닫기">×</button>
      </div>
      <p className="search-description">Google 지도에서 장소를 찾은 뒤 전체 링크를 붙여넣어 등록하세요.</p>
      <form className="place-form" onSubmit={submit}>
        <label className="field-label">Google Maps 링크로 추가</label>
        <div className={`google-link-box ${parsedLink ? "is-valid" : ""}`}>
          <span>G</span>
          <input
            value={googleUrl}
            onChange={(event) => {
              const value = event.target.value;
              setGoogleUrl(value);
              setParsedLink(null);
              if (/!3d-?\d|@-?\d/.test(value)) window.setTimeout(() => analyzeGoogleLink(value), 0);
            }}
            placeholder="google.com/maps/place/... 링크 붙여넣기"
            aria-label="Google Maps 링크"
          />
          <button type="button" onClick={() => analyzeGoogleLink()}>분석</button>
        </div>
        {parsedLink && <p className="link-status"><span>✓</span> 지도 위치를 확인했어요{parsedLink.title ? `: ${parsedLink.title}` : "."}</p>}
        <div className="or-divider"><span>또는</span></div>
        <label className="field-label">장소명 또는 Google 지도 검색어</label>
        <div className="search-box">
          <span>⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="예: 경주 불국사" autoFocus />
          <button
            type="button"
            disabled={!query.trim()}
            onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query.trim())}`, "_blank", "noopener,noreferrer")}
          >
            Google 지도에서 검색 ↗
          </button>
        </div>
        <div className="form-divider" />
        <label className="memo-field"><span>장소 메모</span><textarea value={memo} onChange={(event) => setMemo(event.target.value)} rows={3} maxLength={300} placeholder="예약 정보, 주문할 메뉴, 만날 장소 등을 적어두세요." /></label>
        <div className="schedule-date-time">
          <label><span>방문 날짜</span><input type="date" value={date} onChange={(event) => { const value = event.target.value; setDate(value); setParentId(schedules[value]?.[0]?.id ?? ""); setError(""); }} required /></label>
          <label><span>방문 시간</span><input type="time" value={time} onChange={(event) => setTime(event.target.value)} required /></label>
        </div>
        <div className="schedule-form-row rank-row">
          <fieldset>
            <legend>추가 위치</legend>
            <div className="rank-toggle">
              <button type="button" className={rank === "primary" ? "active" : ""} onClick={() => setRank("primary")}>확정 일정</button>
              <button type="button" className={rank === "candidate" ? "active" : ""} onClick={() => setRank("candidate")}>후보</button>
            </div>
          </fieldset>
        </div>
        {rank === "candidate" && (
          <label className="parent-select"><span>어느 일정의 후보인가요?</span><select value={parentId} onChange={(event) => setParentId(event.target.value)}>{itinerary.map((place) => <option value={place.id} key={place.id}>{place.time} · {place.title}</option>)}</select>{itinerary.length === 0 && <small>선택한 날짜에 확정 일정을 먼저 추가해주세요.</small>}</label>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions"><button type="button" onClick={onClose}>취소</button><button type="submit">일정에 추가</button></div>
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
}: {
  schedules: SchedulesByDate;
  targetDate: string;
  place: Place;
  candidate?: Candidate;
  onClose: () => void;
  onSave: (values: PlaceEditValues) => void;
}) {
  const item = candidate ?? place;
  const [title, setTitle] = useState(item.title);
  const [date, setDate] = useState(targetDate);
  const [time, setTime] = useState(item.time);
  const [parentId, setParentId] = useState(place.id);
  const [googleUrl, setGoogleUrl] = useState(item.googleMapsUrl ?? "");
  const [coords, setCoords] = useState<[number, number]>(item.coords);
  const [parsedLink, setParsedLink] = useState<ParsedGoogleMapsLink | null>(null);
  const [error, setError] = useState("");
  const itinerary = useMemo(() => sortPlaces(schedules[date] ?? []), [schedules, date]);

  const analyzeGoogleLink = () => {
    const parsed = parseGoogleMapsLink(googleUrl);
    if (!parsed) {
      setParsedLink(null);
      setError("전체 Google Maps 링크인지 확인해주세요. 짧은 링크는 전체 URL로 열어서 붙여넣어야 합니다.");
      return;
    }
    setGoogleUrl(parsed.url);
    setCoords(parsed.coords);
    setParsedLink(parsed);
    if (parsed.title) setTitle(parsed.title);
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
    if (googleUrl.trim() && googleUrl.trim() !== (item.googleMapsUrl ?? "") && !parsedLink) {
      setError("새 Google Maps 링크는 분석 버튼을 눌러 위치를 확인해주세요.");
      return;
    }
    onSave({
      title: title.trim(),
      date,
      time,
      coords,
      googleMapsUrl: googleUrl.trim() || undefined,
      parentId: candidate ? parentId : undefined,
    });
  };

  return (
    <div className="add-panel edit-panel" role="dialog" aria-modal="true" aria-label={`${item.title} 수정`}>
      <div className="popover-heading">
        <div><span className="eyebrow">EDIT PLACE</span><h3>{candidate ? "후보 수정" : "일정 수정"}</h3></div>
        <button className="icon-button" onClick={onClose} aria-label="수정 창 닫기">×</button>
      </div>
      <form className="place-form" onSubmit={submit}>
        <label className="field-label" htmlFor="edit-place-title">장소 이름</label>
        <div className="search-box">
          <span>⌕</span>
          <input id="edit-place-title" value={title} onChange={(event) => setTitle(event.target.value)} autoFocus required />
        </div>
        <label className="field-label">Google Maps 링크 <small>(선택)</small></label>
        <div className={`google-link-box ${parsedLink ? "is-valid" : ""}`}>
          <span>G</span>
          <input value={googleUrl} onChange={(event) => { setGoogleUrl(event.target.value); setParsedLink(null); }} placeholder="장소를 바꾸려면 새 링크를 붙여넣으세요" aria-label="Google Maps 링크" />
          <button type="button" onClick={analyzeGoogleLink} disabled={!googleUrl.trim()}>분석</button>
        </div>
        {parsedLink && <p className="link-status"><span>✓</span> 지도 위치를 변경했어요{parsedLink.title ? `: ${parsedLink.title}` : "."}</p>}
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
        <div className="form-actions"><button type="button" onClick={onClose}>취소</button><button type="submit">변경사항 저장</button></div>
      </form>
    </div>
  );
}

function CommentPopover({
  place,
  comments,
  userName,
  avatarUrl,
  onClose,
  onAdd,
}: {
  place: Place;
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
      <div className="popover-heading"><div><span className="eyebrow">함께 정하기</span><h3>{place.title} 댓글</h3></div><button className="icon-button" onClick={onClose} aria-label="댓글 닫기">×</button></div>
      <div className="comment-list">
        {comments.length === 0 && <p className="empty-comment">첫 의견을 남겨보세요.</p>}
        {comments.map((comment) => <article className="comment" key={comment.id}><div className="avatar">{comment.avatarUrl ? <img src={comment.avatarUrl} alt="" /> : comment.name.slice(0, 1)}</div><div><div className="comment-meta"><strong>{comment.name}</strong><span>{comment.createdAt}</span></div><p>{comment.content}</p></div></article>)}
      </div>
      <form className="comment-form" onSubmit={submit}><div className="comment-author"><div className="avatar small">{avatarUrl ? <img src={avatarUrl} alt="" /> : userName.slice(0, 1)}</div><strong>{userName}</strong><span>으로 작성</span></div><div className="comment-input-row"><textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="의견을 남겨주세요" aria-label="댓글 내용" rows={2} maxLength={160} /><button type="submit" disabled={!content.trim() || submitting} aria-label="댓글 등록">↑</button></div></form>
    </div>
  );
}

function NoteEditor({
  title,
  initialValue,
  onClose,
  onSave,
}: {
  title: string;
  initialValue: string;
  onClose: () => void;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave(value.trim());
  };
  return (
    <div className="note-popover" role="dialog" aria-modal="true" aria-label={`${title} 메모 수정`}>
      <div className="popover-heading"><div><span className="eyebrow">PLACE MEMO</span><h3>{title}</h3></div><button className="icon-button" onClick={onClose} aria-label="메모 닫기">×</button></div>
      <p className="note-description">이 장소를 보는 누구나 편하게 수정할 수 있는 메모입니다.</p>
      <form onSubmit={submit}>
        <textarea value={value} onChange={(event) => setValue(event.target.value)} rows={6} maxLength={300} autoFocus placeholder="예약 정보나 꼭 기억할 내용을 입력하세요." />
        <div className="note-footer"><span>{value.length}/300</span><div><button type="button" onClick={onClose}>취소</button><button type="submit">저장</button></div></div>
      </form>
    </div>
  );
}

function DeleteDialog({
  place,
  candidate,
  onCancel,
  onPromote,
  onDeleteAll,
}: {
  place: Place;
  candidate?: Candidate;
  onCancel: () => void;
  onPromote: () => void;
  onDeleteAll: () => void;
}) {
  const next = sortCandidates(place.alternatives)[0];
  const title = candidate?.title ?? place.title;
  const hasCandidates = !candidate && place.alternatives.length > 0;
  return (
    <div className="delete-dialog" role="alertdialog" aria-modal="true" aria-label={`${title} 삭제 확인`}>
      <span className="delete-kicker">DELETE SCHEDULE</span>
      <h3>{title}을 삭제할까요?</h3>
      {candidate && <p>선택한 후보 장소가 일정에서 삭제됩니다. 삭제 후에는 되돌릴 수 없습니다.</p>}
      {!candidate && !hasCandidates && <p>이 확정 일정이 목록과 지도에서 삭제됩니다. 삭제 후에는 되돌릴 수 없습니다.</p>}
      {hasCandidates && <p>후보가 {place.alternatives.length}개 있습니다. 확정 일정만 삭제하면 <strong>{next.title}</strong>이 {place.time}의 새 확정 일정으로 올라옵니다.</p>}
      {hasCandidates && <div className="delete-preview"><span>다음 확정 일정</span><strong>{next.time} · {next.title}</strong></div>}
      <div className={`delete-actions ${hasCandidates ? "" : "is-simple"}`}>
        <button onClick={onCancel}>취소</button>
        <button className="delete-all" onClick={onDeleteAll}>{hasCandidates ? "후보 포함 전체 삭제" : "삭제하기"}</button>
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

export default function App() {
  const { user, userName, avatarUrl, trip, trips, role, members, selectTrip, deleteTrip } = useWorkspace();
  const today = dateKey(new Date());
  const [selectedDate, setSelectedDate] = useState(today);
  const [lastAddDate, setLastAddDate] = useState(() => {
    const saved = localStorage.getItem("into-the-blue-last-add-date");
    return saved && /^\d{4}-\d{2}-\d{2}$/.test(saved) ? saved : today;
  });
  const [schedules, setSchedules] = useState<SchedulesByDate>({});
  const [selectedId, setSelectedId] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [commentPlace, setCommentPlace] = useState<string | null>(null);
  const [mobileSchedule, setMobileSchedule] = useState(false);
  const [focusPoint, setFocusPoint] = useState<{ coords: [number, number]; name: string; token: number } | null>(null);
  const [now, setNow] = useState(new Date());
  const [addOpen, setAddOpen] = useState(false);
  const [dragged, setDragged] = useState<DragItem | null>(null);
  const [dropZone, setDropZone] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [noteTarget, setNoteTarget] = useState<NoteTarget | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
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
  const [accountOpen, setAccountOpen] = useState(false);
  const [tripToDelete, setTripToDelete] = useState<WorkspaceTrip | null>(null);
  const [tripDeleteBusy, setTripDeleteBusy] = useState(false);

  const places = useMemo(() => sortPlaces(schedules[selectedDate] ?? []), [schedules, selectedDate]);
  const commentCounts = useMemo(() => Object.fromEntries(Object.entries(comments).map(([placeId, items]) => [placeId, items.length])), [comments]);
  const timeline = useMemo(() => getTimeline(now, places, selectedDate), [now, places, selectedDate]);
  const selected = places.find((place) => place.id === selectedId) ?? places[0];
  const openCommentPlace = places.find((place) => place.id === commentPlace);
  const deletePlace = places.find((place) => place.id === deleteTarget?.placeId);
  const deleteCandidate = deletePlace?.alternatives.find((candidate) => candidate.id === deleteTarget?.candidateId);
  const notePlace = places.find((place) => place.id === noteTarget?.placeId);
  const noteCandidate = notePlace?.alternatives.find((candidate) => candidate.id === noteTarget?.candidateId);
  const editableNote = noteTarget?.candidateId ? noteCandidate : notePlace;
  const editSourcePlace = editTarget
    ? schedules[editTarget.date]?.find((place) => place.id === editTarget.placeId)
    : undefined;
  const editSourceCandidate = editSourcePlace?.alternatives.find((candidate) => candidate.id === editTarget?.candidateId);
  const editablePlace = editTarget?.candidateId ? editSourceCandidate : editSourcePlace;
  const totalCandidates = places.reduce((sum, place) => sum + place.alternatives.length, 0);
  const scheduledDates = useMemo(() => Object.entries(schedules).filter(([, items]) => items.length > 0).map(([date]) => date).sort(), [schedules]);
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
      const [{ data: documents, error: documentError }, { data: commentRows, error: commentError }] = await Promise.all([
        supabase.from("trip_documents").select("trip_date,list_title,schedule").eq("trip_id", trip.id).order("trip_date"),
        supabase.from("comments").select("id,place_id,user_id,content,created_at").eq("trip_id", trip.id).order("created_at"),
      ]);
      if (cancelled) return;
      if (documentError || commentError) {
        setDataError("여행 데이터를 불러오지 못했습니다. Supabase 마이그레이션을 확인해주세요.");
        setDataReady(true);
        return;
      }
      const nextSchedules: SchedulesByDate = {};
      const nextTitles: Record<string, string> = {};
      for (const document of documents ?? []) {
        nextSchedules[document.trip_date] = sortPlaces((document.schedule ?? []) as Place[]);
        nextTitles[document.trip_date] = document.list_title;
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
      setListTitles(nextTitles);
      setComments(nextComments);
      const firstDate = Object.keys(nextSchedules).sort()[0] ?? today;
      setSelectedDate(firstDate);
      setSelectedId(nextSchedules[firstDate]?.[0]?.id ?? "");
      setDataReady(true);
    };
    void loadTripData();
    return () => { cancelled = true; };
  }, [trip.id, today]);

  useEffect(() => {
    if (!dataReady) return;
    const timer = window.setTimeout(async () => {
      const dates = [...new Set([...Object.keys(schedules), ...Object.keys(listTitles)])];
      if (!dates.length) return;
      const { error } = await supabase.from("trip_documents").upsert(dates.map((date) => ({
        trip_id: trip.id,
        trip_date: date,
        list_title: listTitles[date] ?? "새 여행 일정",
        schedule: schedules[date] ?? [],
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      })), { onConflict: "trip_id,trip_date" });
      if (error) setDataError("변경사항을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.");
    }, 500);
    return () => window.clearTimeout(timer);
  }, [dataReady, listTitles, schedules, trip.id, user.id]);
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 60_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    const closePopups = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setAccountOpen(false);
      setAddOpen(false);
      setCommentPlace(null);
      setDeleteTarget(null);
      setNoteTarget(null);
      setEditTarget(null);
      if (!tripDeleteBusy) setTripToDelete(null);
    };
    window.addEventListener("keydown", closePopups);
    return () => window.removeEventListener("keydown", closePopups);
  }, [tripDeleteBusy]);
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
    setSchedules((current) => ({ ...current, [selectedDate]: sortPlaces(updater(current[selectedDate] ?? [])) }));
  };

  const chooseDate = (value: string) => {
    if (!value) return;
    setSelectedDate(value);
    setSelectedId(schedules[value]?.[0]?.id ?? "");
    setCommentPlace(null);
    setNoteTarget(null);
    setDeleteTarget(null);
    setEditTarget(null);
    setEditingListTitle(false);
  };

  const openAddPlace = () => {
    setCommentPlace(null);
    setNoteTarget(null);
    setDeleteTarget(null);
    setEditTarget(null);
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

  const selectPlace = useCallback((id: string) => {
    setFocusPoint(null);
    setSelectedId(id);
    if (window.innerWidth < 840) setMobileSchedule(false);
  }, []);

  const openMapComments = useCallback((id: string) => {
    setFocusPoint(null);
    setSelectedId(id);
    setCommentPlace(id);
  }, []);

  const addPlace = (candidate: Candidate, rank: "primary" | "candidate", parentId: string, date: string) => {
    const authoredCandidate = { ...candidate, createdBy: user.id, createdByName: userName, createdAt: new Date().toISOString() };
    if (rank === "primary") {
      const place = asPrimary(authoredCandidate, authoredCandidate.time);
      setSchedules((current) => ({ ...current, [date]: sortPlaces([...(current[date] ?? []), place]) }));
      setSelectedDate(date);
      setSelectedId(place.id);
    } else {
      setSchedules((current) => ({
        ...current,
        [date]: sortPlaces((current[date] ?? []).map((place) => place.id === parentId ? { ...place, alternatives: sortCandidates([...place.alternatives, authoredCandidate]) } : place)),
      }));
      setExpanded((current) => ({ ...current, [parentId]: true }));
      setSelectedDate(date);
      setSelectedId(parentId);
    }
    setLastAddDate(date);
    localStorage.setItem("into-the-blue-last-add-date", date);
  };

  const startDrag = (event: DragEvent, item: DragItem) => {
    setDragged(item);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", JSON.stringify(item));
  };

  const finishDrag = () => { setDragged(null); setDropZone(""); };

  const dropOnPrimary = (event: DragEvent, targetId: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (!dragged) return;
    if (dragged.kind === "primary") {
      if (dragged.placeId !== targetId) {
        setItinerary((current) => {
          const source = current.find((place) => place.id === dragged.placeId);
          const target = current.find((place) => place.id === targetId);
          if (!source || !target) return current;
          return sortPlaces(current.map((place) => place.id === source.id ? { ...place, time: target.time } : place.id === target.id ? { ...place, time: source.time } : place));
        });
      }
    } else {
      const { placeId, candidateId } = dragged;
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
    }
    finishDrag();
  };

  const dropOnCandidates = (event: DragEvent, targetId: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (!dragged) return;
    if (dragged.kind === "candidate") {
      const { placeId, candidateId } = dragged;
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
    } else if (dragged.placeId !== targetId) {
      const sourceId = dragged.placeId;
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
    }
    setExpanded((current) => ({ ...current, [targetId]: true }));
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
    setDeleteTarget(null);
  };

  const saveNote = (target: NoteTarget, value: string) => {
    setItinerary((current) => current.map((place) => {
      if (place.id !== target.placeId) return place;
      if (!target.candidateId) return { ...place, note: value };
      return { ...place, alternatives: place.alternatives.map((candidate) => candidate.id === target.candidateId ? { ...candidate, note: value } : candidate) };
    }));
    setNoteTarget(null);
  };

  const savePlaceEdit = (target: EditTarget, values: PlaceEditValues) => {
    setSchedules((current) => {
      const sourceItems = current[target.date] ?? [];
      const sourcePlace = sourceItems.find((place) => place.id === target.placeId);
      if (!sourcePlace) return current;

      const next = { ...current };
      if (!target.candidateId) {
        const updated: Place = {
          ...sourcePlace,
          title: values.title,
          time: values.time,
          coords: values.coords,
          googleMapsUrl: values.googleMapsUrl,
          category: cleanPlaceLabel(sourcePlace.category),
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
        time: values.time,
        coords: values.coords,
        googleMapsUrl: values.googleMapsUrl,
        category: cleanPlaceLabel(sourceCandidate.category),
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
    setSelectedDate(values.date);
    setSelectedId(target.candidateId ? values.parentId ?? target.placeId : target.placeId);
    if (target.candidateId && values.parentId) setExpanded((current) => ({ ...current, [values.parentId!]: true }));
    setEditTarget(null);
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
    setNoteTarget(null);
    setEditTarget(null);
    setDeleteTarget({ placeId: place.id });
  };

  const requestCandidateDelete = (placeId: string, candidateId: string) => {
    setCommentPlace(null);
    setNoteTarget(null);
    setEditTarget(null);
    setDeleteTarget({ placeId, candidateId });
  };

  const requestPrimaryEdit = (placeId: string) => {
    setAddOpen(false);
    setCommentPlace(null);
    setNoteTarget(null);
    setDeleteTarget(null);
    setEditTarget({ date: selectedDate, placeId });
  };

  const requestCandidateEdit = (placeId: string, candidateId: string) => {
    setAddOpen(false);
    setCommentPlace(null);
    setNoteTarget(null);
    setDeleteTarget(null);
    setEditTarget({ date: selectedDate, placeId, candidateId });
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
    const inviteUrl = new URL(window.location.origin);
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

  const importPhuQuocItinerary = () => {
    const hasExistingItems = PHU_QUOC_DATES.some((date) => (schedules[date]?.length ?? 0) > 0);
    if (hasExistingItems && !window.confirm("2026년 10월 29일~11월 1일의 기존 일정을 PDF 내용으로 덮어쓸까요?")) return;
    const imported = createPhuQuocItinerary(user.id, userName);
    setSchedules((current) => ({ ...current, ...imported }));
    setListTitles((current) => ({ ...current, ...PHU_QUOC_LIST_TITLES }));
    const firstDate = PHU_QUOC_DATES[0];
    setSelectedDate(firstDate);
    setSelectedId(imported[firstDate]?.[0]?.id ?? "");
    setLastAddDate(firstDate);
    localStorage.setItem("into-the-blue-last-add-date", firstDate);
    setAccountOpen(false);
    if (window.innerWidth < 840) setMobileSchedule(true);
  };

  const chooseTrip = (tripId: string) => {
    setAccountOpen(false);
    setCommentPlace(null);
    setNoteTarget(null);
    setDeleteTarget(null);
    setEditTarget(null);
    setAddOpen(false);
    selectTrip(tripId);
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
    const candidateCount = entries.reduce((sum, [, items]) => sum + items.reduce((count, place) => count + place.alternatives.length, 0), 0);
    const daySections = entries.map(([date, items], dayIndex) => `
      <section class="day">
        <header class="day-heading">
          <div><span>DAY ${dayIndex + 1}</span><h2>${escapeHtml(listTitles[date] ?? "새 여행 일정")}</h2></div>
          <time>${escapeHtml(formatTripDate(date))}</time>
        </header>
        <div class="timeline">
          ${items.map((place, placeIndex) => `
            <article class="place">
              <div class="time-column"><strong>${escapeHtml(place.time)}</strong><span>${placeIndex + 1}</span></div>
              <div class="place-body">
                <div class="place-title"><h3>${escapeHtml(place.title)}</h3><b>확정</b></div>
                ${primaryMeta(place) ? `<p class="meta">${escapeHtml(primaryMeta(place))}</p>` : ""}
                ${place.note ? `<p class="memo">${noteHtml(place.note)}</p>` : ""}
                ${place.alternatives.length ? `<div class="candidates"><h4>후보 장소</h4>${sortCandidates(place.alternatives).map((candidate) => `<div class="candidate"><div><strong>${escapeHtml(candidate.title)}</strong><span>${escapeHtml(candidateMeta(candidate))}</span>${candidate.note ? `<p>${noteHtml(candidate.note)}</p>` : ""}</div><a href="${escapeHtml(googleReviewsUrl(candidate))}">Google 리뷰</a></div>`).join("")}</div>` : ""}
                <a class="review-link" href="${escapeHtml(googleReviewsUrl(place))}">Google 리뷰 보기</a>
              </div>
            </article>`).join("")}
        </div>
      </section>`).join("");

    printWindow.document.open();
    printWindow.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(trip.name)} 일정</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      @page { size: A4; margin: 13mm; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #f5f1e8; color: #24352f; font-family: "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .sheet { width: 100%; max-width: 860px; margin: 0 auto; padding: 28px; background: #fffdf8; }
      .cover { position: relative; overflow: hidden; min-height: 210px; display: flex; flex-direction: column; justify-content: flex-end; padding: 36px; border-radius: 24px; background: #173f36; color: white; }
      .cover:after { content: ""; position: absolute; top: -70px; right: -55px; width: 230px; height: 230px; border: 1px solid rgba(255,255,255,.18); border-radius: 50%; box-shadow: 0 0 0 35px rgba(255,255,255,.035), 0 0 0 70px rgba(255,255,255,.025); }
      .eyebrow { position: relative; z-index: 1; margin-bottom: 12px; color: #f4a08f; font-size: 10px; font-weight: 800; letter-spacing: .22em; }
      .cover h1 { position: relative; z-index: 1; margin: 0; font-family: Georgia, "Noto Serif KR", serif; font-size: 40px; line-height: 1; letter-spacing: -.03em; }
      .cover > p { position: relative; z-index: 1; margin: 13px 0 0; color: rgba(255,255,255,.76); font-size: 13px; }
      .stats { position: absolute; z-index: 1; right: 34px; bottom: 34px; display: flex; gap: 18px; }
      .stats div { min-width: 64px; padding-left: 12px; border-left: 1px solid rgba(255,255,255,.25); }
      .stats strong { display: block; font-size: 20px; }
      .stats span { color: rgba(255,255,255,.65); font-size: 9px; }
      .day { margin-top: 30px; break-before: auto; }
      .day + .day { padding-top: 9px; border-top: 1px solid #e5ded2; }
      .day-heading { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 18px; padding: 0 2px 12px; border-bottom: 2px solid #173f36; }
      .day-heading span { color: #ef765f; font-size: 9px; font-weight: 800; letter-spacing: .13em; }
      .day-heading h2 { margin: 5px 0 0; font-family: Georgia, "Noto Serif KR", serif; color: #173f36; font-size: 23px; }
      .day-heading time { color: #6f7b75; font-size: 11px; font-weight: 700; }
      .place { display: grid; grid-template-columns: 66px 1fr; gap: 15px; margin-bottom: 14px; break-inside: avoid; }
      .time-column { display: flex; flex-direction: column; align-items: center; gap: 7px; padding-top: 5px; color: #64716b; }
      .time-column strong { font-size: 11px; }
      .time-column span { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: #ef765f; color: white; font-size: 10px; font-weight: 800; }
      .place-body { position: relative; padding: 15px 16px; border: 1px solid #e3ddd2; border-radius: 15px; background: white; }
      .place-title { display: flex; align-items: center; gap: 8px; padding-right: 82px; }
      .place-title h3 { margin: 0; color: #173f36; font-family: Georgia, "Noto Serif KR", serif; font-size: 16px; }
      .place-title b { padding: 3px 6px; border-radius: 5px; background: #fbe6df; color: #c95f4d; font-size: 7px; }
      .meta { margin: 5px 0 0; color: #818a85; font-size: 9px; }
      .memo { margin: 10px 0 0; padding: 9px 11px; border-left: 3px solid #e2b369; border-radius: 0 8px 8px 0; background: #fbf6eb; color: #5e6963; font-size: 9px; line-height: 1.55; }
      .review-link { position: absolute; top: 14px; right: 14px; color: #8b692f; font-size: 8px; font-weight: 700; text-decoration: none; }
      .candidates { margin-top: 11px; padding-top: 9px; border-top: 1px dashed #ddd6ca; }
      .candidates h4 { margin: 0 0 6px; color: #88918c; font-size: 8px; letter-spacing: .06em; }
      .candidate { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 6px 0; }
      .candidate + .candidate { border-top: 1px solid #f0ece5; }
      .candidate > div { display: flex; flex-direction: column; gap: 2px; }
      .candidate strong { color: #3d4c46; font-size: 10px; }
      .candidate span, .candidate p { margin: 0; color: #87908b; font-size: 8px; line-height: 1.45; }
      .candidate p { color: #626f68; }
      .candidate a { flex: none; color: #987133; font-size: 8px; text-decoration: none; }
      footer { display: flex; justify-content: space-between; margin-top: 34px; padding: 14px 2px 0; border-top: 1px solid #ded7cb; color: #8b938e; font-size: 8px; }
      @media print { body { background: white; } .sheet { max-width: none; padding: 0; } .day { break-inside: auto; } }
    </style></head><body><main class="sheet"><section class="cover"><span class="eyebrow">TRAVEL ITINERARY</span><h1>${escapeHtml(trip.name)}</h1><p>${escapeHtml(tripDateRange)}</p><div class="stats"><div><strong>${entries.length}</strong><span>여행 일수</span></div><div><strong>${confirmedCount}</strong><span>확정 일정</span></div><div><strong>${candidateCount}</strong><span>후보 장소</span></div></div></section>${daySections}<footer><span>${escapeHtml(trip.name)}</span><span>Into the Blue · ${escapeHtml(new Date().toLocaleDateString("ko-KR"))}</span></footer></main><script>window.addEventListener("load",function(){setTimeout(function(){window.focus();window.print();},500)});</script></body></html>`);
    printWindow.document.close();
  };

  const appStyle = { "--sidebar-width": `${sidebarWidth}px` } as CSSProperties;

  if (!dataReady) return <main className="data-loading">여행 일정을 불러오는 중...</main>;

  return (
    <main className="app-shell" style={appStyle}>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="SURABUL TOUR 홈">
          <strong>SURABUL TOUR</strong>
          <span>MAP THE MOMENTS <i aria-hidden="true">·</i> KEEP THE JOURNEY</span>
        </a>
        <div className="trip-title"><strong>{trip.name}</strong><span>{tripDateRange}</span></div>
        <div className="top-actions">
          <div className="people" aria-label={`함께 여행하는 사람 ${members.length}명`}>{members.slice(0, 4).map((member) => <span key={member.id} title={member.nickname}>{member.avatarUrl ? <img src={member.avatarUrl} alt="" /> : member.nickname.slice(0, 1)}</span>)}</div>
          <button className="pdf-button" onClick={exportItineraryPdf} disabled={!scheduledDates.length} aria-label="전체 일정 PDF 저장"><span>⇩</span> PDF 저장</button>
          <button className="add-place-button" onClick={openAddPlace}><span>＋</span> 장소 추가</button>
          {role === "owner" && <button className={`share-button ${shareCopied ? "is-copied" : ""}`} onClick={createInviteLink}><span>{shareCopied ? "✓" : "⧉"}</span> {shareCopied ? "복사됨" : "초대 링크"}</button>}
          <div className="account-menu-wrap">
            <button className="account-button" onClick={() => setAccountOpen((value) => !value)} title="내 여행 일정" aria-label="내 여행 일정 열기" aria-expanded={accountOpen}>{avatarUrl ? <img src={avatarUrl} alt="" /> : userName.slice(0, 1)}</button>
            {accountOpen && (
              <section className="account-menu" aria-label="내 여행 일정">
                <div className="account-menu-profile"><div className="account-menu-avatar">{avatarUrl ? <img src={avatarUrl} alt="" /> : userName.slice(0, 1)}</div><div><strong>{userName}</strong><span>접근 가능한 여행 {trips.length}개</span></div></div>
                <div className="account-menu-heading"><span>내 여행 일정</span><small>선택해서 전환</small></div>
                <div className="account-trip-list">
                  {trips.map((item) => (
                    <div className={`account-trip-row ${item.id === trip.id ? "is-current" : ""}`} key={item.id}>
                      <button className="account-trip-select" onClick={() => chooseTrip(item.id)}><span className="account-trip-check">{item.id === trip.id ? "✓" : ""}</span><span><strong>{item.name}</strong><small>{item.role === "owner" ? "내가 만든 여행" : "초대받은 여행"}</small></span></button>
                      {item.role === "owner" && <button className="account-trip-delete" onClick={() => { setAccountOpen(false); setTripToDelete(item); }} aria-label={`${item.name} 삭제`} title="여행 삭제">삭제</button>}
                    </div>
                  ))}
                </div>
                <button className="account-import-itinerary" onClick={importPhuQuocItinerary}><span>＋</span><span><strong>PDF 일정 불러오기</strong><small>푸꾸옥 · 2026.10.29~11.01 · 위치는 임시값</small></span></button>
                <button className="account-signout" onClick={() => { setAccountOpen(false); void signOut(); }}>로그아웃</button>
              </section>
            )}
          </div>
        </div>
      </header>

      {accountOpen && <button className="account-menu-backdrop" onClick={() => setAccountOpen(false)} aria-label="내 여행 일정 닫기" />}

      {dataError && <div className="data-error" role="alert">{dataError}<button onClick={() => setDataError("")}>×</button></div>}

      <section className={`schedule-panel ${mobileSchedule ? "is-open" : ""}`} id="top">
        <div className="schedule-header"><div><p className="date-kicker">{relativeDateLabel(selectedDate, today)} · {formatDate(selectedDate, { month: "long", day: "numeric" })}</p>{editingListTitle ? <form className="list-title-form" onSubmit={saveListTitle}><input value={listTitleDraft} onChange={(event) => setListTitleDraft(event.target.value)} maxLength={40} autoFocus aria-label="일정 목록 제목" /><button type="submit">저장</button><button type="button" onClick={() => setEditingListTitle(false)}>취소</button></form> : <div className="list-title-row"><h1>{currentListTitle}</h1><button onClick={beginListTitleEdit} aria-label="목록 제목 수정" title="제목 수정">✎</button></div>}<p>날짜와 시간을 선택하면 일정이 자동으로 정리돼요.</p></div><button className="mobile-close" onClick={() => setMobileSchedule(false)} aria-label="지도 보기">×</button></div>
        <div className="date-navigation" aria-label="여행 날짜 선택">
          <button disabled={!previousDate} onClick={() => previousDate && chooseDate(previousDate)} aria-label="일정이 있는 이전 날짜">‹</button>
          <label><span>{relativeDateLabel(selectedDate, today)}</span><input type="date" value={selectedDate} onChange={(event) => chooseDate(event.target.value)} aria-label="날짜 직접 선택" /></label>
          <button disabled={!nextDate} onClick={() => nextDate && chooseDate(nextDate)} aria-label="일정이 있는 다음 날짜">›</button>
        </div>
        <div className="now-card"><span className="live-dot" /><div><small>{selectedDate === today ? `지금 ${now.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}` : formatDate(selectedDate)}</small><strong>{timeline.label}</strong></div><span className="weather">☀︎ 24°</span></div>
        <div className="drag-guide"><span>⋮⋮</span><p><strong>드래그로 일정 편집</strong>확정 일정과 후보를 서로 옮길 수 있어요.</p><button onClick={openAddPlace}>＋ 추가</button></div>

        <div className="timeline-list">
          <div className="timeline-track"><span style={{ height: `${timeline.progress}%` }} /></div>
          {places.length === 0 && <div className="empty-schedule"><span>빈 하루</span><h2>아직 등록된 일정이 없어요</h2><p>이 날짜에 가고 싶은 장소를 추가해보세요.</p><button onClick={openAddPlace}>＋ 첫 장소 추가</button></div>}
          {places.map((place, index) => {
            const commentCount = comments[place.id]?.length ?? 0;
            const showCandidates = !!expanded[place.id] || !!dragged;
            return (
              <article className={`schedule-item ${selectedId === place.id ? "is-selected" : ""} ${index === timeline.active ? "is-current" : ""}`} key={place.id}>
                <button className={`time-pin ${index < timeline.active ? "is-past" : ""} ${index === timeline.active ? "is-active" : ""}`} onClick={() => selectPlace(place.id)} aria-label={`${place.time} ${place.title} 지도에서 보기`}><span>{index < timeline.active ? "✓" : index + 1}</span></button>
                <time>{place.time}</time>
                <div
                  className={`place-card ${dropZone === `primary:${place.id}` ? "is-drop-target" : ""}`}
                  draggable
                  onDragStart={(event) => startDrag(event, { kind: "primary", placeId: place.id })}
                  onDragEnd={finishDrag}
                  onDragOver={(event) => event.preventDefault()}
                  onDragEnter={() => setDropZone(`primary:${place.id}`)}
                  onDrop={(event) => dropOnPrimary(event, place.id)}
                >
                  <button className="place-main" onClick={() => selectPlace(place.id)}><span className="drag-handle" aria-hidden="true">⋮⋮</span><span className="place-copy"><span className="place-topline"><strong>{place.title}</strong><em>확정</em></span>{primaryMeta(place) && <span>{primaryMeta(place)}</span>}{place.createdByName && <small className="created-by">{place.createdByName}님이 추가</small>}</span><span className="chevron">›</span></button>
                  <p className={`place-note ${place.note ? "" : "is-empty"}`}>{place.note || "메모를 추가해보세요."}</p>
                  <div className="card-actions"><button onClick={() => setExpanded((value) => ({ ...value, [place.id]: !value[place.id] }))} aria-expanded={showCandidates}>후보 {place.alternatives.length} <b className={showCandidates ? "up" : ""}>⌄</b></button><button onClick={() => requestPrimaryEdit(place.id)}>수정</button><button onClick={() => { setCommentPlace(null); setNoteTarget({ placeId: place.id }); }}>메모</button><button className={commentPlace === place.id ? "active" : ""} onClick={() => setCommentPlace(commentPlace === place.id ? null : place.id)}>댓글 {commentCount}</button><a href={googleReviewsUrl(place)} target="_blank" rel="noreferrer">Google 리뷰 ↗</a><button className="delete-item-button" onClick={() => requestPrimaryDelete(place)}>삭제</button></div>
                  {showCandidates && (
                    <div className={`alternatives ${dropZone === `candidate:${place.id}` ? "is-drop-target" : ""}`} onDragOver={(event) => event.preventDefault()} onDragEnter={() => setDropZone(`candidate:${place.id}`)} onDrop={(event) => dropOnCandidates(event, place.id)}>
                      {place.alternatives.map((candidate) => (
                        <div className="alternative-row" draggable key={candidate.id} onDragStart={(event) => { event.stopPropagation(); startDrag(event, { kind: "candidate", placeId: place.id, candidateId: candidate.id }); }} onDragEnd={finishDrag}>
                          <button className="candidate-main" onClick={() => { setSelectedId(place.id); setFocusPoint({ coords: candidate.coords, name: candidate.title, token: Date.now() }); if (window.innerWidth < 840) setMobileSchedule(false); }}><span className="candidate-drag">⋮⋮</span><span><strong>{candidate.title}</strong><small>{candidateMeta(candidate)}</small>{candidate.createdByName && <small className="created-by">{candidate.createdByName}님이 추가</small>}<span className={`candidate-note-preview ${candidate.note ? "" : "is-empty"}`}>{candidate.note || "메모를 추가해보세요."}</span></span></button>
                          <div className="candidate-actions"><span className="candidate-badge">후보</span><button onClick={() => requestCandidateEdit(place.id, candidate.id)} aria-label={`${candidate.title} 장소 날짜 시간 수정`}>수정</button><button onClick={() => { setCommentPlace(null); setNoteTarget({ placeId: place.id, candidateId: candidate.id }); }} aria-label={`${candidate.title} 메모 수정`}>메모</button><a href={googleReviewsUrl(candidate)} target="_blank" rel="noreferrer" aria-label={`${candidate.title} Google 리뷰 보기`}>링크 ↗</a><button className="candidate-delete" onClick={() => requestCandidateDelete(place.id, candidate.id)} aria-label={`${candidate.title} 후보 삭제`}>삭제</button></div>
                        </div>
                      ))}
                      <div className="candidate-drop-hint">이곳에 놓으면 후보로 이동</div>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
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
        <MapView places={places} selectedId={selected?.id ?? ""} focusPoint={focusPoint} onSelect={selectPlace} onComment={openMapComments} commentCounts={commentCounts} getReviewUrl={googleReviewsUrl} />
        <div className="map-provider-note"><strong>OpenStreetMap</strong><span>위치와 직선 경로는 무료 지도 사용</span></div>
        <div className="map-overlay-top"><button className="mobile-schedule-button" onClick={() => setMobileSchedule(true)}>☰ <span>{relativeDateLabel(selectedDate, today)} 일정</span></button><div className="route-legend"><span className="route-line" /> 확정 일정 경로 <small>{places.length}곳 · 후보 {totalCandidates}곳</small></div></div>
        <div className="map-credit">확정 일정만 직선으로 연결 · 후보는 회색 마커로 표시</div>
      </section>

      <nav className="mobile-view-switcher" aria-label="모바일 화면 전환"><button className={mobileSchedule ? "active" : ""} onClick={() => setMobileSchedule(true)}><span>☷</span>일정</button><button className={!mobileSchedule ? "active" : ""} onClick={() => setMobileSchedule(false)}><span>⌖</span>지도</button></nav>

      {(addOpen || openCommentPlace || deletePlace || editableNote || editablePlace || tripToDelete) && <button className="popover-backdrop" onClick={() => { if (tripDeleteBusy) return; setAddOpen(false); setCommentPlace(null); setDeleteTarget(null); setNoteTarget(null); setEditTarget(null); setTripToDelete(null); }} aria-label="팝업 닫기" />}
      {addOpen && <AddPlacePanel schedules={schedules} defaultDate={lastAddDate} onClose={() => setAddOpen(false)} onAdd={addPlace} />}
      {editablePlace && editTarget && editSourcePlace && <EditPlacePanel schedules={schedules} targetDate={editTarget.date} place={editSourcePlace} candidate={editSourceCandidate} onClose={() => setEditTarget(null)} onSave={(values) => savePlaceEdit(editTarget, values)} />}
      {openCommentPlace && <CommentPopover place={openCommentPlace} comments={comments[openCommentPlace.id] ?? []} userName={userName} avatarUrl={avatarUrl} onClose={() => setCommentPlace(null)} onAdd={(content) => addComment(openCommentPlace.id, content)} />}
      {editableNote && noteTarget && <NoteEditor title={editableNote.title} initialValue={editableNote.note} onClose={() => setNoteTarget(null)} onSave={(value) => saveNote(noteTarget, value)} />}
      {deletePlace && <DeleteDialog place={deletePlace} candidate={deleteCandidate} onCancel={() => setDeleteTarget(null)} onPromote={() => removePrimary(deletePlace.id, false)} onDeleteAll={() => deleteCandidate ? removeCandidate(deletePlace.id, deleteCandidate.id) : removePrimary(deletePlace.id, true)} />}
      {tripToDelete && <TripDeleteDialog trip={tripToDelete} busy={tripDeleteBusy} onCancel={() => setTripToDelete(null)} onDelete={confirmTripDelete} />}
    </main>
  );
}
