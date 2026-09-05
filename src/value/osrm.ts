import { supabase } from "../lib/supabase";
import type { RouteGeoJson } from "./mapboxLoader";

export type DrivingRoute = {
  geometry: RouteGeoJson;
  distanceMeters: number;
  durationSeconds: number;
  cached: boolean;
};

export async function fetchDrivingRoute(
  tripId: string,
  points: [number, number][],
  signal?: AbortSignal,
): Promise<DrivingRoute> {
  if (points.length < 2) throw new Error("경로에는 두 곳 이상의 장소가 필요합니다.");
  if (points.length > 25) throw new Error("한 경로에는 최대 25곳까지 포함할 수 있습니다.");

  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error("경로 계산에는 로그인이 필요합니다.");

  const endpoint = process.env.NEXT_PUBLIC_ROUTE_API_URL?.trim();
  if (!endpoint) throw new Error("경로 서버 주소가 설정되지 않았습니다.");
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
