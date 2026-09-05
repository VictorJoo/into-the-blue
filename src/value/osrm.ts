import { supabase } from "../lib/supabase";
import type { RouteGeoJson } from "./mapboxLoader";

export type DrivingRoute = {
  geometry: RouteGeoJson;
  distanceMeters: number;
  durationSeconds: number;
  cached: boolean;
};

type MapboxDirectionsResponse = {
  code?: string;
  message?: string;
  routes?: Array<{
    geometry?: {
      type?: string;
      coordinates?: [number, number][];
    };
    distance?: number;
    duration?: number;
  }>;
};

async function fetchMapboxDrivingRoute(
  points: [number, number][],
  signal?: AbortSignal,
): Promise<DrivingRoute> {
  const accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN?.trim();
  if (!accessToken) throw new Error("Mapbox 공개 토큰이 설정되지 않았습니다.");

  const coordinates = points
    .map(([latitude, longitude]) => `${longitude.toFixed(6)},${latitude.toFixed(6)}`)
    .join(";");
  const query = new URLSearchParams({
    access_token: accessToken,
    alternatives: "false",
    geometries: "geojson",
    overview: "full",
    steps: "false",
  });
  const endpoint = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordinates}?${query}`;
  const response = await fetch(endpoint, { signal });
  const payload = await response.json().catch(() => null) as MapboxDirectionsResponse | null;
  const route = payload?.routes?.[0];

  if (
    !response.ok
    || payload?.code !== "Ok"
    || route?.geometry?.type !== "LineString"
    || !Array.isArray(route.geometry.coordinates)
    || typeof route.distance !== "number"
    || typeof route.duration !== "number"
  ) {
    throw new Error(payload?.message || `Mapbox 경로 계산 오류 (${response.status})`);
  }

  return {
    geometry: {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: route.geometry.coordinates,
      },
    },
    distanceMeters: route.distance,
    durationSeconds: route.duration,
    cached: false,
  };
}

export async function fetchDrivingRoute(
  tripId: string,
  points: [number, number][],
  signal?: AbortSignal,
): Promise<DrivingRoute> {
  if (points.length < 2) throw new Error("경로에는 두 곳 이상의 장소가 필요합니다.");
  if (points.length > 25) throw new Error("한 경로에는 최대 25곳까지 포함할 수 있습니다.");

  const endpoint = process.env.NEXT_PUBLIC_ROUTE_API_URL?.trim();
  if (!endpoint) return fetchMapboxDrivingRoute(points, signal);

  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error("경로 계산에는 로그인이 필요합니다.");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ tripId, points }),
    signal,
  });

  const payload = await response.json().catch(() => null) as (DrivingRoute & { error?: string }) | null;
  if (!response.ok || !payload) throw new Error(payload?.error || `경로 서버 오류 (${response.status})`);
  return payload;
}
