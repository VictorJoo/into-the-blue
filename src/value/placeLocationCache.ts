import { supabase } from "../lib/supabase";
import type { MapSearchResult } from "../types";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function cacheSelectedPlaceLocation(place: MapSearchResult) {
  if (!place.placeId || !place.locationRefreshedAt) return;
  const refreshedAt = new Date(place.locationRefreshedAt);
  if (!Number.isFinite(refreshedAt.getTime())) return;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return;
  const { error } = await supabase.from("place_location_cache").upsert({
    google_place_id: place.placeId,
    user_id: auth.user.id,
    latitude: place.coords[0],
    longitude: place.coords[1],
    refreshed_at: refreshedAt.toISOString(),
    expires_at: new Date(refreshedAt.getTime() + THIRTY_DAYS_MS).toISOString(),
  }, { onConflict: "google_place_id,user_id" });
  if (error && import.meta.env.DEV) console.warn("장소 좌표 TTL 캐시 저장 실패", error);
}

export async function readCachedPlaceLocation(placeId: string) {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await supabase
    .from("place_location_cache")
    .select("latitude,longitude,refreshed_at,expires_at")
    .eq("google_place_id", placeId)
    .eq("user_id", auth.user.id)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error || !data) return null;
  return {
    coords: [Number(data.latitude), Number(data.longitude)] as [number, number],
    refreshedAt: String(data.refreshed_at),
    expiresAt: String(data.expires_at),
  };
}
