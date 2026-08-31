interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: AssetFetcher;
  OSRM_BASE_URL: string;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  ALLOWED_ORIGINS?: string;
  OSRM_REGIONS_JSON?: string;
}

type RouteBody = {
  tripId?: string;
  points?: unknown;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(payload: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

function allowedOrigin(request: Request, env: Env) {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}

function cors(origin: string | null) {
  return origin ? {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization,content-type",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Vary": "Origin",
  } : {};
}

function parsePoints(value: unknown): [number, number][] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > 25) return null;
  const points: [number, number][] = [];
  for (const point of value) {
    if (!Array.isArray(point) || point.length !== 2) return null;
    const lat = Number(point[0]);
    const lng = Number(point[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    points.push([lat, lng]);
  }
  return points;
}

async function isTripMember(request: Request, env: Env, tripId: string) {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  const headers = {
    "Authorization": authorization,
    "apikey": env.SUPABASE_PUBLISHABLE_KEY,
    "Accept": "application/json",
  };
  const userResponse = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/user`, { headers });
  if (!userResponse.ok) return false;
  const user = await userResponse.json() as { id?: string };
  if (!user.id) return false;
  const membershipUrl = new URL(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/trip_members`);
  membershipUrl.searchParams.set("trip_id", `eq.${tripId}`);
  membershipUrl.searchParams.set("user_id", `eq.${user.id}`);
  membershipUrl.searchParams.set("select", "user_id");
  membershipUrl.searchParams.set("limit", "1");
  const membership = await fetch(membershipUrl, { headers });
  if (!membership.ok) return false;
  const rows = await membership.json() as unknown[];
  return rows.length > 0;
}

function routeCacheKey(request: Request, points: [number, number][]) {
  const normalized = points.map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join(";");
  const url = new URL("/api/value/route-cache", request.url);
  url.searchParams.set("points", normalized);
  return new Request(url, { method: "GET" });
}

function selectOsrmBase(env: Env, points: [number, number][]) {
  if (env.OSRM_REGIONS_JSON) {
    try {
      const regions = JSON.parse(env.OSRM_REGIONS_JSON) as Array<{
        baseUrl: string;
        bounds: [number, number, number, number];
      }>;
      const match = regions.find(({ baseUrl, bounds }) => baseUrl && bounds?.length === 4 && points.every(([lat, lng]) => (
        lng >= bounds[0] && lat >= bounds[1] && lng <= bounds[2] && lat <= bounds[3]
      )));
      if (match) return match.baseUrl.replace(/\/$/, "");
    } catch {
      // Fall back to the default global/region server when configuration is invalid.
    }
  }
  return env.OSRM_BASE_URL.replace(/\/$/, "");
}

async function route(request: Request, env: Env) {
  const origin = allowedOrigin(request, env);
  if (request.headers.get("Origin") && !origin) return json({ error: "허용되지 않은 Origin입니다." }, 403);
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 12_000) return json({ error: "요청이 너무 큽니다." }, 413, cors(origin));
  const rawBody = await request.text();
  if (rawBody.length > 12_000) return json({ error: "요청이 너무 큽니다." }, 413, cors(origin));
  let body: RouteBody | null = null;
  try { body = JSON.parse(rawBody) as RouteBody; }
  catch { /* invalid JSON is handled by the validation response below */ }
  const tripId = body?.tripId;
  const points = parsePoints(body?.points);
  if (!tripId || !UUID.test(tripId) || !points) return json({ error: "tripId 또는 경로 좌표가 올바르지 않습니다." }, 400, cors(origin));
  if (!await isTripMember(request, env, tripId)) return json({ error: "이 여행의 경로를 조회할 권한이 없습니다." }, 403, cors(origin));

  const cache = caches.default;
  const cacheKey = routeCacheKey(request, points);
  const cached = await cache.match(cacheKey);
  if (cached) {
    const payload = await cached.json() as Record<string, unknown>;
    return json({ ...payload, cached: true }, 200, { ...cors(origin), "Cache-Control": "private, max-age=60" });
  }

  const osrmCoordinates = points.map(([lat, lng]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(";");
  const osrmBase = selectOsrmBase(env, points);
  const osrmUrl = `${osrmBase}/route/v1/driving/${osrmCoordinates}?overview=full&geometries=geojson&steps=false`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  let osrmResponse: Response;
  try {
    osrmResponse = await fetch(osrmUrl, { signal: controller.signal });
  } catch (cause) {
    const message = cause instanceof Error && cause.name === "AbortError" ? "OSRM 응답 시간이 초과되었습니다." : "OSRM 서버에 연결하지 못했습니다.";
    return json({ error: message }, 502, cors(origin));
  } finally {
    clearTimeout(timeout);
  }
  if (!osrmResponse.ok) return json({ error: `OSRM 서버 오류 (${osrmResponse.status})` }, 502, cors(origin));
  const osrm = await osrmResponse.json() as {
    code?: string;
    routes?: Array<{ distance: number; duration: number; geometry: { type: "LineString"; coordinates: [number, number][] } }>;
  };
  const first = osrm.routes?.[0];
  if (osrm.code !== "Ok" || !first) return json({ error: "자동차로 연결 가능한 경로가 없습니다." }, 422, cors(origin));
  const payload = {
    geometry: { type: "Feature", properties: {}, geometry: first.geometry },
    distanceMeters: first.distance,
    durationSeconds: first.duration,
    cached: false,
  };
  const cacheResponse = json(payload, 200, { "Cache-Control": "public, max-age=86400" });
  await cache.put(cacheKey, cacheResponse.clone());
  return json(payload, 200, { ...cors(origin), "Cache-Control": "private, max-age=60" });
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/value/route") {
      const origin = allowedOrigin(request, env);
      if (request.method === "OPTIONS") {
        if (request.headers.get("Origin") && !origin) return new Response(null, { status: 403 });
        return new Response(null, { status: 204, headers: cors(origin) });
      }
      if (request.method !== "POST") return json({ error: "POST만 지원합니다." }, 405, cors(origin));
      return route(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
