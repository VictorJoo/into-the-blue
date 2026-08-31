// 구글 지도 / 카카오맵 / 네이버 지도 즐겨찾기(저장 목록) 공유 링크에서
// 장소 목록을 가져오는 파서입니다. fetch API만 사용하므로
// vite dev 미들웨어(Node)와 Cloudflare Worker 어디서든 동작합니다.
//
// 세 서비스 모두 공식 API가 없어 공유 페이지가 내부적으로 사용하는
// 엔드포인트·페이로드를 파싱합니다. 서비스 개편 시 깨질 수 있으므로
// 파서마다 여러 후보 경로를 시도하고 실패 이유를 최대한 자세히 남깁니다.

export type ImportProvider = "google" | "kakao" | "naver";

export type ImportedPlace = {
  title: string;
  coords: [number, number]; // [위도, 경도]
  address?: string;
  memo?: string;
};

export type ImportResult = {
  provider: ImportProvider;
  providerLabel: string;
  groupTitle?: string;
  items: ImportedPlace[];
  warnings: string[];
};

export class ImportError extends Error {
  status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.status = status;
  }
}

const PROVIDER_LABELS: Record<ImportProvider, string> = {
  google: "Google 지도",
  kakao: "카카오맵",
  naver: "네이버 지도",
};

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Accept-Language": "ko,en;q=0.8",
  "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
};

function detectProvider(rawUrl: string): ImportProvider | null {
  let host = "";
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === "naver.me" || host.endsWith(".naver.com") || host.endsWith(".naver.me")) return "naver";
  if (host === "kko.to" || host === "kko.kakao.com" || host.endsWith(".kakao.com") || host.endsWith(".daum.net")) return "kakao";
  if (host === "maps.app.goo.gl" || host === "goo.gl" || host.endsWith("google.com") || host.endsWith(".google.co.kr")) return "google";
  return null;
}

function isValidLatLng(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    && !(lat === 0 && lng === 0);
}

async function fetchText(url: string, headers: Record<string, string> = {}) {
  const response = await fetch(url, { headers: { ...BROWSER_HEADERS, ...headers }, redirect: "follow" });
  const body = await response.text();
  return { response, body, finalUrl: response.url || url };
}

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      headers: { ...BROWSER_HEADERS, Accept: "application/json", ...headers },
      redirect: "follow",
    });
    if (!response.ok) return null;
    const text = await response.text();
    const stripped = text.replace(/^\)\]\}'[^\n]*\n?/, "");
    return JSON.parse(stripped) as unknown;
  } catch {
    return null;
  }
}

function dedupeItems(items: ImportedPlace[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.title.toLowerCase()}|${item.coords[0].toFixed(5)},${item.coords[1].toFixed(5)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// 네이버 지도 — naver.me 공유 링크 → pages.map.naver.com 북마크 공유 API
// ---------------------------------------------------------------------------

function extractNaverShareId(source: string) {
  const patterns = [
    /[?&]shareId=([\w-]+)/,
    /"shareId"\s*:\s*"([\w-]+)"/,
    /\/folder\/([\w-]{6,})/,
    /maps-bookmark\/shares\/([\w-]+)/,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

type NaverBookmark = {
  name?: string;
  displayName?: string;
  px?: number | string;
  py?: number | string;
  x?: number | string;
  y?: number | string;
  address?: string;
  memo?: string;
};

async function importNaver(rawUrl: string): Promise<ImportResult> {
  const warnings: string[] = [];
  let shareId = extractNaverShareId(rawUrl);
  if (!shareId) {
    const { body, finalUrl } = await fetchText(rawUrl);
    shareId = extractNaverShareId(finalUrl) ?? extractNaverShareId(body);
  }
  if (!shareId) {
    throw new ImportError("네이버 즐겨찾기 공유 ID를 찾지 못했습니다. 네이버 지도 앱에서 즐겨찾기 그룹의 '공유' 링크(naver.me/…)를 사용해주세요.");
  }

  const base = `https://pages.map.naver.com/save-pages/api/maps-bookmark/shares/${shareId}`;
  let groupTitle: string | undefined;
  const meta = await fetchJson(base, { Referer: "https://map.naver.com/" });
  if (meta && typeof meta === "object") {
    const record = meta as Record<string, unknown>;
    const folder = (record.folder ?? record) as Record<string, unknown>;
    const name = folder?.name ?? folder?.folderName ?? record.name;
    if (typeof name === "string" && name.trim()) groupTitle = name.trim();
  }

  const listCandidates = [
    `${base}/bookmarks?start=0&limit=1000&sort=lastUseTime`,
    `${base}/bookmarks?start=0&limit=1000`,
    `${base}/bookmarks`,
  ];
  let bookmarks: NaverBookmark[] | null = null;
  for (const candidate of listCandidates) {
    const data = await fetchJson(candidate, { Referer: "https://map.naver.com/" });
    if (!data) continue;
    const record = data as Record<string, unknown>;
    const list = record.bookmarks ?? record.bookmarkList ?? record.items ?? (Array.isArray(data) ? data : null);
    if (Array.isArray(list) && list.length > 0) {
      bookmarks = list as NaverBookmark[];
      break;
    }
  }
  if (!bookmarks) {
    throw new ImportError(`네이버 즐겨찾기 목록을 불러오지 못했습니다. (shareId: ${shareId}) 그룹 공개 설정이 '공유 허용'인지 확인해주세요.`);
  }

  const items: ImportedPlace[] = [];
  for (const bookmark of bookmarks) {
    const lat = Number(bookmark.py ?? bookmark.y);
    const lng = Number(bookmark.px ?? bookmark.x);
    const title = (bookmark.name || bookmark.displayName || "").trim();
    if (!title || !isValidLatLng(lat, lng)) continue;
    items.push({
      title,
      coords: [lat, lng],
      address: typeof bookmark.address === "string" && bookmark.address.trim() ? bookmark.address.trim() : undefined,
      memo: typeof bookmark.memo === "string" && bookmark.memo.trim() ? bookmark.memo.trim() : undefined,
    });
  }
  if (items.length === 0) {
    throw new ImportError("네이버 즐겨찾기 응답에서 좌표가 있는 장소를 찾지 못했습니다.");
  }
  if (items.length < bookmarks.length) {
    warnings.push(`좌표가 없는 ${bookmarks.length - items.length}개 항목은 건너뛰었습니다.`);
  }
  return { provider: "naver", providerLabel: PROVIDER_LABELS.naver, groupTitle, items: dedupeItems(items), warnings };
}

// ---------------------------------------------------------------------------
// 카카오맵 — kko.kakao.com 공유 링크 → folderid → 폴더 상세 JSON
// 좌표가 WCONGNAMUL(콩나물) 좌표계로 내려오는 경우 WGS84로 변환합니다.
// ---------------------------------------------------------------------------

function extractKakaoFolderId(source: string) {
  const patterns = [
    /[?&]folderid=(\d+)/i,
    /[?&]folderId=(\d+)/,
    /"folderId"\s*:\s*"?(\d+)/,
    /\/folder\/(\d+)/,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

// 횡메르카토르(TM) 역투영 — Bessel 타원체 기반 카카오 콩나물 좌표용
type TmParams = { lat0: number; lon0: number; k0: number; x0: number; y0: number };

function tmInverseBessel(x: number, y: number, params: TmParams) {
  const a = 6377397.155;
  const f = 1 / 299.1528128;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const rad = Math.PI / 180;

  const meridianArc = (phi: number) => a * (
    (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * phi
    - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * phi)
    + (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * phi)
    - (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * phi)
  );

  const M0 = meridianArc(params.lat0 * rad);
  const M = M0 + (y - params.y0) / params.k0;
  const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 = mu
    + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
    + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);
  const N1 = a / Math.sqrt(1 - e2 * sinPhi1 * sinPhi1);
  const R1 = a * (1 - e2) / Math.pow(1 - e2 * sinPhi1 * sinPhi1, 1.5);
  const T1 = tanPhi1 * tanPhi1;
  const C1 = ep2 * cosPhi1 * cosPhi1;
  const D = (x - params.x0) / (N1 * params.k0);

  const lat = phi1 - (N1 * tanPhi1 / R1) * (
    D * D / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720
  );
  const lon = params.lon0 * rad + (
    D
    - (1 + 2 * T1 + C1) * D ** 3 / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120
  ) / cosPhi1;

  return { lat: lat / rad, lon: lon / rad };
}

// Bessel(Tokyo 계열) → WGS84 간이 Molodensky 변환
function besselToWgs84(latDeg: number, lonDeg: number, dx: number, dy: number, dz: number) {
  const rad = Math.PI / 180;
  const a = 6377397.155;
  const f = 1 / 299.1528128;
  const da = 6378137 - a;
  const df = 1 / 298.257223563 - f;
  const lat = latDeg * rad;
  const lon = lonDeg * rad;
  const e2 = f * (2 - f);
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  const rn = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  const rm = a * (1 - e2) / Math.pow(1 - e2 * sinLat * sinLat, 1.5);

  const dLat = (-dx * sinLat * cosLon - dy * sinLat * sinLon + dz * cosLat
    + da * (rn * e2 * sinLat * cosLat) / a
    + df * (rm / (1 - f) + rn * (1 - f)) * sinLat * cosLat) / rm;
  const dLon = (-dx * sinLon + dy * cosLon) / (rn * cosLat);

  return { lat: (lat + dLat) / rad, lon: (lon + dLon) / rad };
}

const KOREA_BOUNDS = { minLat: 33.0, maxLat: 39.5, minLng: 124.0, maxLng: 132.5 };

function inKorea(lat: number, lng: number) {
  return lat >= KOREA_BOUNDS.minLat && lat <= KOREA_BOUNDS.maxLat && lng >= KOREA_BOUNDS.minLng && lng <= KOREA_BOUNDS.maxLng;
}

// WCONGNAMUL = TM128(카카오/다음 지도 내부 좌표) × 2.5 로 알려져 있습니다.
// 파라미터 출처가 문서화되어 있지 않아 후보를 순서대로 시도하고
// 결과가 한반도 범위에 들어오는 조합을 채택합니다.
const WCONG_CANDIDATES: TmParams[] = [
  { lat0: 38, lon0: 128, k0: 2.49975, x0: 1_000_000, y0: 1_500_000 },
  { lat0: 38, lon0: 128, k0: 2.5, x0: 1_000_000, y0: 1_500_000 },
  { lat0: 38, lon0: 128, k0: 2.49975, x0: 1_000_000, y0: 2_000_000 },
  { lat0: 38, lon0: 128, k0: 2.5, x0: 1_000_000, y0: 2_000_000 },
];

function wcongToWgs84(x: number, y: number): [number, number] | null {
  for (const params of WCONG_CANDIDATES) {
    const bessel = tmInverseBessel(x, y, params);
    const wgs = besselToWgs84(bessel.lat, bessel.lon, -146.43, 507.89, 681.46);
    if (inKorea(wgs.lat, wgs.lon)) return [wgs.lat, wgs.lon];
  }
  return null;
}

function normalizeKakaoCoords(xRaw: unknown, yRaw: unknown): { coords: [number, number]; converted: boolean } | null {
  const x = Number(xRaw);
  const y = Number(yRaw);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  // 이미 WGS84 (x=경도, y=위도)
  if (Math.abs(y) <= 90 && Math.abs(x) <= 180 && !(x === 0 && y === 0)) {
    return { coords: [y, x], converted: false };
  }
  // WCONGNAMUL 추정 (수십만~수백만 단위)
  if (x > 10_000 && y > 10_000) {
    const converted = wcongToWgs84(x, y);
    if (converted) return { coords: converted, converted: true };
  }
  return null;
}

type KakaoCandidateItem = { title: string; x: unknown; y: unknown; address?: string; memo?: string };

const KAKAO_NAME_KEYS = ["name", "placeName", "place_name", "title", "displayName"];
const KAKAO_COORD_KEYS: Array<[string, string]> = [
  ["wgs84x", "wgs84y"], ["lon", "lat"], ["lng", "lat"], ["longitude", "latitude"],
  ["x", "y"], ["px", "py"], ["wcongX", "wcongY"], ["wCongX", "wCongY"],
];

function collectKakaoItems(node: unknown, found: KakaoCandidateItem[]) {
  if (Array.isArray(node)) {
    for (const child of node) collectKakaoItems(child, found);
    return;
  }
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  const nameKey = KAKAO_NAME_KEYS.find((key) => typeof record[key] === "string" && (record[key] as string).trim());
  if (nameKey) {
    for (const [xKey, yKey] of KAKAO_COORD_KEYS) {
      if (record[xKey] !== undefined && record[yKey] !== undefined) {
        found.push({
          title: (record[nameKey] as string).trim(),
          x: record[xKey],
          y: record[yKey],
          address: typeof record.address === "string" ? record.address
            : typeof record.addr === "string" ? record.addr
            : typeof record.road_address_name === "string" ? record.road_address_name : undefined,
          memo: typeof record.memo === "string" && record.memo.trim() ? record.memo.trim() : undefined,
        });
        break;
      }
    }
  }
  for (const value of Object.values(record)) collectKakaoItems(value, found);
}

function findKakaoGroupTitle(node: unknown): string | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const title = findKakaoGroupTitle(child);
      if (title) return title;
    }
    return undefined;
  }
  if (!node || typeof node !== "object") return undefined;
  const record = node as Record<string, unknown>;
  const title = record.folderName ?? record.folder_name ?? record.folderTitle;
  if (typeof title === "string" && title.trim()) return title.trim();
  for (const value of Object.values(record)) {
    const nested = findKakaoGroupTitle(value);
    if (nested) return nested;
  }
  return undefined;
}

async function importKakao(rawUrl: string): Promise<ImportResult> {
  const warnings: string[] = [];
  let folderId = extractKakaoFolderId(rawUrl);
  if (!folderId) {
    const { body, finalUrl } = await fetchText(rawUrl);
    folderId = extractKakaoFolderId(finalUrl) ?? extractKakaoFolderId(body);
  }
  if (!folderId) {
    throw new ImportError("카카오맵 즐겨찾기 폴더 ID를 찾지 못했습니다. 카카오맵 앱에서 즐겨찾기 그룹의 '공유' 링크(kko.kakao.com/…)를 사용해주세요.");
  }

  const attempts = [
    `https://map.kakao.com/folder/detail.json?folderId=${folderId}`,
    `https://map.kakao.com/folder/detail.json?folderid=${folderId}`,
    `https://m.map.kakao.com/actions/folderDetailInfo?folderId=${folderId}&output=json`,
    `https://map.kakao.com/?target=other&folderid=${folderId}`,
  ];

  let rawItems: KakaoCandidateItem[] = [];
  let groupTitle: string | undefined;
  for (const attempt of attempts) {
    let data: unknown = await fetchJson(attempt, { Referer: "https://map.kakao.com/" });
    if (!data) {
      // JSON이 아니면 HTML 속 임베디드 JSON에서라도 긁어본다.
      const { body } = await fetchText(attempt, { Referer: "https://map.kakao.com/" });
      const embedded = body.match(/\{.*"folderId".*\}/s)?.[0];
      if (embedded) {
        try { data = JSON.parse(embedded); } catch { data = null; }
      }
    }
    if (!data) continue;
    const found: KakaoCandidateItem[] = [];
    collectKakaoItems(data, found);
    if (found.length > 0) {
      rawItems = found;
      groupTitle = findKakaoGroupTitle(data);
      break;
    }
  }
  if (rawItems.length === 0) {
    throw new ImportError(`카카오맵 즐겨찾기 목록을 불러오지 못했습니다. (folderId: ${folderId}) 폴더가 '전체 공개'로 공유되어 있는지 확인해주세요.`);
  }

  const items: ImportedPlace[] = [];
  let convertedCount = 0;
  for (const raw of rawItems) {
    const normalized = normalizeKakaoCoords(raw.x, raw.y);
    if (!normalized) continue;
    if (normalized.converted) convertedCount += 1;
    items.push({ title: raw.title, coords: normalized.coords, address: raw.address, memo: raw.memo });
  }
  if (items.length === 0) {
    throw new ImportError("카카오맵 응답에서 좌표를 해석하지 못했습니다. 좌표계 변환 보정이 필요할 수 있습니다.");
  }
  if (convertedCount > 0) {
    warnings.push("카카오 내부 좌표계를 WGS84로 변환했습니다. 지도에서 위치가 어긋나 보이면 알려주세요.");
  }
  return { provider: "kakao", providerLabel: PROVIDER_LABELS.kakao, groupTitle, items: dedupeItems(items), warnings };
}

// ---------------------------------------------------------------------------
// 구글 지도 — maps.app.goo.gl 공유 링크 → 목록 ID → entitylist/getlist 내부 API
// 페이지 HTML에는 목록 데이터가 없고(2026-08 확인), 지도 SPA가 아래 엔드포인트로
// 목록을 따로 불러온다. 로그인 쿠키 없이도 호출된다.
// 응답 구조: data[0][4]=목록 제목, data[0][8]=항목 배열,
//   item[2]=장소명, item[3]=사용자 메모, item[1][4]=주소, item[1][5]=[null,null,위도,경도]
// ---------------------------------------------------------------------------

function extractGoogleListId(source: string) {
  let decoded = source;
  try { decoded = decodeURIComponent(source); } catch { /* 원본 그대로 사용 */ }
  const patterns = [
    /11m2!2s([A-Za-z0-9_-]{10,})/,                    // /maps/@…/data=!4m3!11m2!2s{목록ID}!3e3
    /!2s([A-Za-z0-9_-]{20,})!3e/,
    /\/maps\/placelists\/list\/([A-Za-z0-9_-]{10,})/,
  ];
  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function parseGoogleListPayload(data: unknown): { groupTitle?: string; items: ImportedPlace[] } {
  const meta = Array.isArray(data) ? (data as unknown[])[0] : null;
  if (!Array.isArray(meta)) return { items: [] };
  const groupTitle = typeof meta[4] === "string" && meta[4].trim() ? meta[4].trim() : undefined;
  const rawItems = Array.isArray(meta[8]) ? meta[8] as unknown[] : [];
  const items: ImportedPlace[] = [];
  for (const raw of rawItems) {
    if (!Array.isArray(raw)) continue;
    const item = raw as unknown[];
    const title = typeof item[2] === "string" ? item[2].trim() : "";
    const place = Array.isArray(item[1]) ? item[1] as unknown[] : null;
    const geo = place && Array.isArray(place[5]) ? place[5] as unknown[] : null;
    const lat = Number(geo?.[2]);
    const lng = Number(geo?.[3]);
    if (!title || !isValidLatLng(lat, lng)) continue;
    const address = place && typeof place[4] === "string" && place[4].trim() ? place[4].trim() : undefined;
    const memo = typeof item[3] === "string" && item[3].trim() ? item[3].trim() : undefined;
    items.push({ title, coords: [lat, lng], address, memo });
  }
  return { groupTitle, items };
}

async function importGoogle(rawUrl: string): Promise<ImportResult> {
  const warnings: string[] = [];
  const consentCookie = "CONSENT=YES+cb.20240101-00-p0.ko+FX+000; SOCS=CAI";

  // 1) 공유 링크(단축 URL)에서 목록 ID를 알아낸다.
  // 주의: maps.app.goo.gl은 브라우저 UA에는 302 대신 자바스크립트로 이동하는
  // 셸 페이지(200)를 내려주므로, 반드시 단순 UA로 요청해 302 Location을 받아야 한다.
  let listId = extractGoogleListId(rawUrl);
  if (!listId) {
    const simpleHeaders = { "User-Agent": "curl/8.4.0", "Accept": "*/*" };
    const manual = await fetch(rawUrl, { headers: simpleHeaders, redirect: "manual" });
    await manual.body?.cancel();
    listId = extractGoogleListId(manual.headers.get("location") ?? "");
    if (!listId) {
      const followed = await fetch(rawUrl, { headers: simpleHeaders, redirect: "follow" });
      await followed.body?.cancel();
      listId = extractGoogleListId(followed.url || "");
    }
  }
  if (!listId) {
    // 마지막 수단: 브라우저 UA로 최종 페이지를 받아 본문에서 찾는다.
    const { body, finalUrl } = await fetchText(rawUrl, { Cookie: consentCookie });
    if (finalUrl.includes("consent.google")) {
      throw new ImportError("구글이 동의 페이지로 연결해 목록을 읽지 못했습니다. 잠시 후 다시 시도해주세요.");
    }
    listId = extractGoogleListId(finalUrl) ?? extractGoogleListId(body);
  }
  if (!listId) {
    throw new ImportError("구글 지도 목록 ID를 찾지 못했습니다. '저장됨 → 목록 → 공유'로 만든 공유 링크(maps.app.goo.gl/…)인지 확인해주세요.");
  }

  // 2) 지도 SPA가 쓰는 내부 목록 API 호출 (최대 500개)
  const pb = `!1m4!1s${listId}!2e1!3m1!1e1!2e2!3e2!4i500`;
  const listUrl = `https://www.google.com/maps/preview/entitylist/getlist?authuser=0&hl=ko&gl=kr&pb=${encodeURIComponent(pb)}`;
  const response = await fetch(listUrl, {
    headers: { ...BROWSER_HEADERS, Cookie: consentCookie, Referer: "https://www.google.com/maps/" },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new ImportError(`구글 목록 API 응답 오류 (HTTP ${response.status}). 목록이 '링크가 있는 모든 사용자'에게 공유되어 있는지 확인해주세요.`);
  }
  const text = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\)\]\}'\s*/, ""));
  } catch {
    throw new ImportError("구글 목록 API 응답을 해석하지 못했습니다. 응답 형식이 바뀌었을 수 있습니다.");
  }

  const { groupTitle, items } = parseGoogleListPayload(data);
  if (items.length === 0) {
    throw new ImportError("구글 지도 목록에서 장소를 찾지 못했습니다. 목록이 비어 있거나 응답 형식이 바뀌었을 수 있습니다.");
  }
  return { provider: "google", providerLabel: PROVIDER_LABELS.google, groupTitle, items: dedupeItems(items), warnings };
}

// ---------------------------------------------------------------------------

// 로컬 디버그용: 여러 요청 조합으로 단축 링크가 어떻게 응답하는지 본다.
export async function debugResolve(rawUrl: string) {
  const variants: Array<{ label: string; headers: Record<string, string> }> = [
    { label: "chrome-ua", headers: BROWSER_HEADERS },
    { label: "curl-ua", headers: { "User-Agent": "curl/8.4.0", "Accept": "*/*" } },
    { label: "no-ua", headers: { "Accept": "*/*" } },
    { label: "googlebot", headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "Accept": "*/*" } },
    { label: "old-android", headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 4.4.2; Nexus 5 Build/KOT49H) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/33.0 Mobile Safari/537.36", "Accept": "*/*" } },
  ];
  const results: Record<string, unknown> = {};
  for (const variant of variants) {
    try {
      const response = await fetch(rawUrl, { headers: variant.headers, redirect: "manual" });
      const location = response.headers.get("location");
      let followedUrl: string | null = null;
      if (!location) {
        const followed = await fetch(rawUrl, { headers: variant.headers, redirect: "follow" });
        followedUrl = followed.url;
        await followed.text();
      }
      results[variant.label] = {
        status: response.status,
        location: location?.slice(0, 220) ?? null,
        followedUrl: followedUrl?.slice(0, 220) ?? null,
        listId: extractGoogleListId(location ?? followedUrl ?? ""),
      };
    } catch (cause) {
      results[variant.label] = { fetchError: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause) };
    }
  }
  return results;
}

export async function importBookmarks(rawUrl: string): Promise<ImportResult> {
  const trimmed = rawUrl.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new ImportError("http(s)로 시작하는 공유 링크를 입력해주세요.", 400);
  }
  const provider = detectProvider(trimmed);
  if (!provider) {
    throw new ImportError("구글 지도, 카카오맵, 네이버 지도 공유 링크만 지원합니다.", 400);
  }
  if (provider === "naver") return importNaver(trimmed);
  if (provider === "kakao") return importKakao(trimmed);
  return importGoogle(trimmed);
}
