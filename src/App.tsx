import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import GoogleMapView from "./GoogleMapView";

type Place = {
  id: string;
  time: string;
  duration: string;
  title: string;
  category: string;
  note: string;
  emoji: string;
  coords: [number, number];
  travel?: string;
  alternatives: { name: string; category: string; coords: [number, number] }[];
};

type Comment = { id: number; name: string; content: string; createdAt: string };
type CommentsByPlace = Record<string, Comment[]>;

const places: Place[] = [
  {
    id: "jimi",
    time: "09:00",
    duration: "1시간 20분",
    title: "지미오름",
    category: "산책 · 오름",
    note: "정상에서 성산일출봉과 우도가 한눈에 보여요.",
    emoji: "🌿",
    coords: [33.4957, 126.9017],
    travel: "차로 18분",
    alternatives: [
      { name: "용눈이오름", category: "가벼운 트레킹", coords: [33.4599, 126.8315] },
      { name: "다랑쉬오름", category: "전망 좋은 오름", coords: [33.4767, 126.8215] },
    ],
  },
  {
    id: "haenyeo",
    time: "11:10",
    duration: "1시간 10분",
    title: "해녀의 집",
    category: "점심 · 해산물",
    note: "성게 보말죽과 전복 한 접시를 나눠 먹어요.",
    emoji: "🥣",
    coords: [33.5233, 126.8569],
    travel: "차로 22분",
    alternatives: [
      { name: "명진전복", category: "전복 돌솥밥", coords: [33.5328, 126.8501] },
      { name: "곰막식당", category: "회국수", coords: [33.5561, 126.7987] },
    ],
  },
  {
    id: "bijarim",
    time: "13:20",
    duration: "1시간 30분",
    title: "비자림",
    category: "숲 · 산책",
    note: "A코스로 천천히 걷고, 입구에서 비자향 아이스크림.",
    emoji: "🌲",
    coords: [33.4906, 126.8095],
    travel: "차로 16분",
    alternatives: [
      { name: "아부오름", category: "초원 산책", coords: [33.4486, 126.7772] },
      { name: "제주 레일바이크", category: "체험", coords: [33.466, 126.8365] },
    ],
  },
  {
    id: "myeongwol",
    time: "15:40",
    duration: "1시간",
    title: "카페 오르다",
    category: "카페 · 바다",
    note: "야외 테라스에서 파도 보며 잠깐 쉬어가기.",
    emoji: "☕",
    coords: [33.4355, 126.9182],
    travel: "차로 12분",
    alternatives: [
      { name: "카페 한라산", category: "레트로 카페", coords: [33.5246, 126.8629] },
      { name: "공백", category: "전시형 카페", coords: [33.5576, 126.7592] },
    ],
  },
  {
    id: "seopjikoji",
    time: "17:20",
    duration: "1시간 20분",
    title: "섭지코지",
    category: "노을 · 해안 산책",
    note: "등대까지 걸으며 오늘의 마지막 노을을 봐요.",
    emoji: "🌅",
    coords: [33.4238, 126.9291],
    alternatives: [
      { name: "광치기해변", category: "해변 노을", coords: [33.4522, 126.9239] },
      { name: "아쿠아플라넷", category: "실내 관람", coords: [33.4331, 126.9278] },
    ],
  },
];

const seedComments: CommentsByPlace = {
  jimi: [
    { id: 1, name: "민지", content: "운동화 꼭 챙겨요! 정상 바람 세대요.", createdAt: "어제" },
    { id: 2, name: "준호", content: "아침에는 주차장 여유 있다고 해요.", createdAt: "3시간 전" },
  ],
  haenyeo: [{ id: 3, name: "유나", content: "전복죽 2개 미리 예약할까요?", createdAt: "1시간 전" }],
};

function minutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function googleReviewUrl(name: string, coords: [number, number]) {
  const query = encodeURIComponent(`${name} ${coords[0]},${coords[1]}`);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

function getTimeline(now: Date) {
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
  return {
    active,
    progress: ((active + segment) / (starts.length - 1)) * 100,
    label: `${places[active].title} 일정 중`,
  };
}

function MapView({
  selectedId,
  focusPoint,
  onSelect,
}: {
  selectedId: string;
  focusPoint: { coords: [number, number]; name: string; token: number } | null;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, { zoomControl: false, attributionControl: true }).setView(
      [33.477, 126.87],
      11,
    );
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);

    const route = places.map((place) => place.coords);
    L.polyline(route, { color: "#ef765f", weight: 5, opacity: 0.95, lineCap: "round" }).addTo(map);
    L.polyline(route, { color: "#fffaf0", weight: 2, opacity: 0.55, dashArray: "2 11" }).addTo(map);

    places.forEach((place, index) => {
      const icon = L.divIcon({
        className: "trip-marker-wrapper",
        html: `<button class="trip-marker" aria-label="${place.title}"><span>${index + 1}</span></button>`,
        iconSize: [42, 48],
        iconAnchor: [21, 44],
        popupAnchor: [0, -42],
      });
      const marker = L.marker(place.coords, { icon }).addTo(map);
      marker.bindPopup(`<strong>${place.title}</strong><small>${place.time} · ${place.category}</small>`, {
        className: "place-popup",
        closeButton: false,
        offset: [0, -2],
      });
      marker.on("click", () => onSelect(place.id));
      markersRef.current[place.id] = marker;

      place.alternatives.forEach((alternative) => {
        const candidateIcon = L.divIcon({
          className: "candidate-marker-wrapper",
          html: "<span class=\"candidate-marker\"></span>",
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        });
        L.marker(alternative.coords, { icon: candidateIcon })
          .addTo(map)
          .bindPopup(`<strong>${alternative.name}</strong><small>후보 · ${alternative.category}</small>`, {
            className: "place-popup candidate-popup",
            closeButton: false,
          });
      });
    });

    map.fitBounds(L.latLngBounds(route), { padding: [60, 60] });
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [onSelect]);

  useEffect(() => {
    const place = places.find((item) => item.id === selectedId);
    const map = mapRef.current;
    if (!place || !map) return;
    map.flyTo(focusPoint?.coords ?? place.coords, 14, { duration: 0.8 });
    if (!focusPoint) markersRef.current[place.id]?.openPopup();
    Object.entries(markersRef.current).forEach(([id, marker]) => {
      const element = marker.getElement()?.querySelector(".trip-marker");
      element?.classList.toggle("is-selected", id === selectedId);
    });
  }, [selectedId, focusPoint]);

  return <div ref={containerRef} className="map-canvas" aria-label="제주 여행 경로 지도" />;
}

function CommentPopover({
  place,
  comments,
  onClose,
  onAdd,
}: {
  place: Place;
  comments: Comment[];
  onClose: () => void;
  onAdd: (name: string, content: string) => void;
}) {
  const [name, setName] = useState("");
  const [content, setContent] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !content.trim()) return;
    onAdd(name.trim(), content.trim());
    setContent("");
  };

  return (
    <div className="comment-popover" role="dialog" aria-label={`${place.title} 댓글`}>
      <div className="popover-heading">
        <div>
          <span className="eyebrow">함께 정하기</span>
          <h3>{place.title} 댓글</h3>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="댓글 닫기">×</button>
      </div>
      <div className="comment-list">
        {comments.length === 0 && <p className="empty-comment">첫 의견을 남겨보세요.</p>}
        {comments.map((comment) => (
          <article className="comment" key={comment.id}>
            <div className="avatar">{comment.name.slice(0, 1)}</div>
            <div>
              <div className="comment-meta"><strong>{comment.name}</strong><span>{comment.createdAt}</span></div>
              <p>{comment.content}</p>
            </div>
          </article>
        ))}
      </div>
      <form className="comment-form" onSubmit={submit}>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="이름" aria-label="이름" maxLength={16} />
        <div className="comment-input-row">
          <textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="의견을 남겨주세요" aria-label="댓글 내용" rows={2} maxLength={160} />
          <button type="submit" disabled={!name.trim() || !content.trim()} aria-label="댓글 등록">↑</button>
        </div>
      </form>
    </div>
  );
}

export default function App() {
  const [selectedId, setSelectedId] = useState(places[0].id);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [commentPlace, setCommentPlace] = useState<string | null>(null);
  const [mobileSchedule, setMobileSchedule] = useState(false);
  const [focusPoint, setFocusPoint] = useState<{ coords: [number, number]; name: string; token: number } | null>(null);
  const [now, setNow] = useState(new Date());
  const [comments, setComments] = useState<CommentsByPlace>(() => {
    try {
      const saved = localStorage.getItem("into-the-blue-comments");
      return saved ? JSON.parse(saved) : seedComments;
    } catch {
      return seedComments;
    }
  });
  const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ?? "";

  const timeline = useMemo(() => getTimeline(now), [now]);
  const selected = places.find((place) => place.id === selectedId) ?? places[0];
  const openCommentPlace = places.find((place) => place.id === commentPlace);
  const totalComments = Object.values(comments).reduce((sum, list) => sum + list.length, 0);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const selectPlace = useCallback((id: string) => {
    setFocusPoint(null);
    setSelectedId(id);
    if (window.innerWidth < 840) setMobileSchedule(false);
  }, []);

  const addComment = (placeId: string, name: string, content: string) => {
    const next = {
      ...comments,
      [placeId]: [
        ...(comments[placeId] ?? []),
        { id: Date.now(), name, content, createdAt: "방금" },
      ],
    };
    setComments(next);
    localStorage.setItem("into-the-blue-comments", JSON.stringify(next));
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="여정 홈"><span>여</span>정</a>
        <div className="trip-title">
          <strong>제주 동쪽, 천천히</strong>
          <span>8월 16일 토요일 · 맑음 27°</span>
        </div>
        <div className="top-actions">
          <div className="people" aria-label="함께 여행하는 사람 3명">
            <span>민</span><span>준</span><span>유</span>
          </div>
          <button className="share-button" onClick={() => navigator.clipboard?.writeText(location.href)}><span>↗</span> 공유</button>
        </div>
      </header>

      <section className={`schedule-panel ${mobileSchedule ? "is-open" : ""}`} id="top">
        <div className="schedule-header">
          <div>
            <p className="date-kicker">DAY 2 · 8월 16일</p>
            <h1>바다와 숲 사이</h1>
            <p>서두르지 않고, 좋은 곳에 오래 머무는 하루</p>
          </div>
          <button className="mobile-close" onClick={() => setMobileSchedule(false)} aria-label="일정 닫기">×</button>
        </div>

        <div className="now-card">
          <span className="live-dot" />
          <div><small>지금 {now.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</small><strong>{timeline.label}</strong></div>
          <span className="weather">☀︎ 27°</span>
        </div>

        <div className="timeline-list">
          <div className="timeline-track"><span style={{ height: `${timeline.progress}%` }} /></div>
          {places.map((place, index) => {
            const isActive = index === timeline.active;
            const isPast = index < timeline.active;
            const commentCount = comments[place.id]?.length ?? 0;
            return (
              <article className={`schedule-item ${selectedId === place.id ? "is-selected" : ""} ${isActive ? "is-current" : ""}`} key={place.id}>
                <button className={`time-pin ${isPast ? "is-past" : ""} ${isActive ? "is-active" : ""}`} onClick={() => selectPlace(place.id)} aria-label={`${place.time} ${place.title} 지도에서 보기`}>
                  <span>{isPast ? "✓" : index + 1}</span>
                </button>
                <time>{place.time}</time>
                <div className="place-card">
                  <button className="place-main" onClick={() => selectPlace(place.id)}>
                    <span className="place-emoji">{place.emoji}</span>
                    <span className="place-copy">
                      <span className="place-topline"><strong>{place.title}</strong><em>1지망</em></span>
                      <span>{place.category} · {place.duration}</span>
                    </span>
                    <span className="chevron">›</span>
                  </button>
                  <p className="place-note">{place.note}</p>
                  <div className="card-actions">
                    <button onClick={() => setExpanded((value) => ({ ...value, [place.id]: !value[place.id] }))} aria-expanded={!!expanded[place.id]}>
                      <span>＋</span> 후보 {place.alternatives.length}곳 <b className={expanded[place.id] ? "up" : ""}>⌄</b>
                    </button>
                    <button className={commentPlace === place.id ? "active" : ""} onClick={() => setCommentPlace(commentPlace === place.id ? null : place.id)}>
                      <span>◌</span> 댓글 {commentCount}
                    </button>
                    <a href={googleReviewUrl(place.title, place.coords)} target="_blank" rel="noreferrer">
                      <span>★</span> Google 리뷰
                    </a>
                  </div>
                  {expanded[place.id] && (
                    <div className="alternatives">
                      {place.alternatives.map((alternative) => (
                        <div className="alternative-row" key={alternative.name}>
                          <button
                            onClick={() => {
                              setSelectedId(place.id);
                              setFocusPoint({ coords: alternative.coords, name: alternative.name, token: Date.now() });
                              if (window.innerWidth < 840) setMobileSchedule(false);
                            }}
                          >
                            <span className="alternative-dot" />
                            <span><strong>{alternative.name}</strong><small>{alternative.category}</small></span>
                            <em>후보</em>
                          </button>
                          <a href={googleReviewUrl(alternative.name, alternative.coords)} target="_blank" rel="noreferrer" aria-label={`${alternative.name} Google 리뷰 보기`}>★</a>
                        </div>
                      ))}
                    </div>
                  )}
                  {place.travel && <div className="travel-time"><span>↓</span> {place.travel}</div>}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="map-panel">
        {googleMapsApiKey ? (
          <GoogleMapView
            apiKey={googleMapsApiKey}
            places={places}
            selectedId={selectedId}
            focusPoint={focusPoint}
            onSelect={selectPlace}
          />
        ) : (
          <>
            <MapView selectedId={selectedId} focusPoint={focusPoint} onSelect={selectPlace} />
            <div className="map-provider-note"><strong>Google Maps 준비됨</strong><span>API 키 연결 전 미리보기 지도</span></div>
          </>
        )}
        <div className="map-overlay-top">
          <button className="mobile-schedule-button" onClick={() => setMobileSchedule(true)}>☰ <span>오늘 일정</span></button>
          <div className="route-legend"><span className="route-line" /> 1지망 경로 <small>총 68km</small></div>
        </div>
        <div className="selected-place-card">
          <div className="selected-index">{places.findIndex((place) => place.id === selected.id) + 1}</div>
          <div><small>{selected.time} · {selected.category}</small><strong>{selected.title}</strong></div>
          <div className="selected-actions">
            <a href={googleReviewUrl(selected.title, selected.coords)} target="_blank" rel="noreferrer" aria-label={`${selected.title} Google 리뷰 보기`}>★</a>
            <button onClick={() => setCommentPlace(selected.id)} aria-label={`${selected.title} 댓글 열기`}>◌ <span>{comments[selected.id]?.length ?? 0}</span></button>
          </div>
        </div>
        <div className="map-credit">오늘의 1지망 {places.length}곳 · 예상 이동 1시간 8분</div>
      </section>

      {openCommentPlace && (
        <>
          <button className="popover-backdrop" onClick={() => setCommentPlace(null)} aria-label="댓글 닫기" />
          <CommentPopover
            place={openCommentPlace}
            comments={comments[openCommentPlace.id] ?? []}
            onClose={() => setCommentPlace(null)}
            onAdd={(name, content) => addComment(openCommentPlace.id, name, content)}
          />
        </>
      )}

      <div className="comment-total" aria-hidden="true">{totalComments}개의 여행 의견</div>
    </main>
  );
}
