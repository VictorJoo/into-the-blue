import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

export type SharedLocation = {
  userId: string;
  name: string;
  avatarUrl?: string;
  lat: number;
  lng: number;
  accuracy: number;
  updatedAt: string;
};

type PresencePayload = Omit<SharedLocation, "userId"> & { userId: string };

function movedEnough(previous: SharedLocation | null, next: SharedLocation) {
  if (!previous) return true;
  const latMeters = (next.lat - previous.lat) * 111_320;
  const lngMeters = (next.lng - previous.lng) * 111_320 * Math.cos(next.lat * Math.PI / 180);
  const distance = Math.hypot(latMeters, lngMeters);
  return distance >= 15 || Date.parse(next.updatedAt) - Date.parse(previous.updatedAt) >= 8_000;
}

function geolocationErrorMessage(cause: GeolocationPositionError) {
  if (cause.code === cause.PERMISSION_DENIED) {
    return "위치 권한이 거부되었습니다. 브라우저 설정에서 위치 권한을 허용해주세요.";
  }
  if (cause.code === cause.POSITION_UNAVAILABLE) {
    return "현재 위치를 확인할 수 없습니다. 잠시 후 다시 시도해주세요.";
  }
  if (cause.code === cause.TIMEOUT) {
    return "위치 확인 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.";
  }
  return "현재 위치를 가져오지 못했습니다. 잠시 후 다시 시도해주세요.";
}

export function useSharedLocations({
  tripId,
  userId,
  name,
  avatarUrl,
}: {
  tripId?: string;
  userId?: string;
  name?: string;
  avatarUrl?: string;
}) {
  const [sharing, setSharing] = useState(false);
  const [locations, setLocations] = useState<SharedLocation[]>([]);
  const [error, setError] = useState("");
  const channelRef = useRef<RealtimeChannel | null>(null);
  const watchRef = useRef<number | null>(null);
  const lastSentRef = useRef<SharedLocation | null>(null);

  const clearError = useCallback(() => setError(""), []);

  const stop = useCallback(() => {
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
    const channel = channelRef.current;
    channelRef.current = null;
    if (channel) {
      void channel.untrack();
      void supabase.removeChannel(channel);
    }
    lastSentRef.current = null;
    setLocations([]);
    setSharing(false);
  }, []);

  const start = useCallback(() => {
    if (!tripId || !userId || !name) {
      setError("로그인한 여행 멤버만 위치를 공유할 수 있습니다.");
      return;
    }
    if (!window.isSecureContext || !navigator.geolocation) {
      setError("위치 공유는 HTTPS와 위치 권한을 지원하는 브라우저에서 사용할 수 있습니다.");
      return;
    }
    if (sharing) return;

    setError("");
    const topic = `trip-location:${tripId}`;
    const channel = supabase.channel(topic, {
      config: { private: true, presence: { key: userId } },
    });
    channelRef.current = channel;

    const sync = () => {
      const state = channel.presenceState<PresencePayload>();
      const presences = Object.values(state).flat() as Array<PresencePayload & { presence_ref: string }>;
      const next = presences
        .filter((item) => typeof item?.lat === "number" && typeof item?.lng === "number")
        .map((item) => ({
          userId: item.userId,
          name: item.name,
          avatarUrl: item.avatarUrl,
          lat: item.lat,
          lng: item.lng,
          accuracy: item.accuracy,
          updatedAt: item.updatedAt,
        }));
      setLocations(next);
    };

    channel.on("presence", { event: "sync" }, sync).subscribe((status) => {
      if (status === "SUBSCRIBED") {
        setSharing(true);
        watchRef.current = navigator.geolocation.watchPosition(
          (position) => {
            const next: SharedLocation = {
              userId,
              name,
              avatarUrl,
              lat: position.coords.latitude,
              lng: position.coords.longitude,
              accuracy: position.coords.accuracy,
              updatedAt: new Date(position.timestamp).toISOString(),
            };
            if (!movedEnough(lastSentRef.current, next)) return;
            lastSentRef.current = next;
            void channel.track(next);
          },
          (cause) => setError(geolocationErrorMessage(cause)),
          { enableHighAccuracy: false, maximumAge: 10_000, timeout: 15_000 },
        );
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setError("위치 공유 채널에 연결하지 못했습니다.");
        stop();
      }
    });
  }, [avatarUrl, name, sharing, stop, tripId, userId]);

  useEffect(() => stop, [stop]);

  return { sharing, locations, error, clearError, start, stop };
}
