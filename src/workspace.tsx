"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { signInWithKakao, signOut } from "./lib/auth";
import { hasSupabaseConfig, supabase } from "./lib/supabase";

export type MemberProfile = {
  id: string;
  nickname: string;
  avatarUrl?: string;
};

export type WorkspaceTrip = {
  id: string;
  name: string;
  owner_id: string;
  role: "owner" | "member";
};

type WorkspaceValue = {
  user: User;
  userName: string;
  avatarUrl?: string;
  trip: WorkspaceTrip;
  trips: WorkspaceTrip[];
  role: "owner" | "member";
  members: MemberProfile[];
  selectTrip: (tripId: string) => void;
  createTrip: (name: string) => Promise<string | null>;
  renameTrip: (tripId: string, name: string) => Promise<string | null>;
  deleteTrip: (tripId: string) => Promise<string | null>;
};

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

function metadataName(user: User) {
  const metadata = user.user_metadata ?? {};
  return metadata.nickname ?? metadata.name ?? metadata.full_name ?? metadata.preferred_username ?? "여행자";
}

function metadataAvatar(user: User) {
  const metadata = user.user_metadata ?? {};
  return metadata.avatar_url ?? metadata.picture ?? undefined;
}

export function LoginPage({ inviteToken }: { inviteToken?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const login = async () => {
    if (!hasSupabaseConfig) {
      setError("Supabase 연결 정보가 아직 설정되지 않았습니다.");
      return;
    }
    setBusy(true);
    setError("");
    const { error: authError } = await signInWithKakao(inviteToken);
    if (authError) {
      setError("카카오 로그인을 시작하지 못했습니다. 잠시 후 다시 시도해주세요.");
      setBusy(false);
    }
  };
  return (
    <main className="auth-page login-page">
      <section className="auth-intro" aria-label="Into the Blue 소개">
        <a className="auth-brand" href="/">
          <span className="auth-brand-mark" aria-hidden="true">⌖</span>
          <strong>Into the Blue</strong>
        </a>
        <p className="auth-eyebrow">SHARED TRAVEL PLANNER</p>
        <h1>여행의 모든 순간을<br />지도 위에서 함께.</h1>
        <p>장소를 모으고, 일정을 정하고, 실제 이동 경로까지 한 화면에서 계획하세요.</p>
        <div className="auth-feature-list" aria-label="주요 기능">
          <span>날짜별 일정</span><span>Mapbox 이동 경로</span><span>동행자 실시간 협업</span>
        </div>
      </section>
      <section className="auth-card">
        <p className="auth-eyebrow">WELCOME</p>
        <h2>여행 계획으로 돌아가기</h2>
        <p className="auth-description">카카오 계정으로 안전하게 로그인하세요. 비밀번호를 새로 만들 필요가 없습니다.</p>
        {inviteToken && <div className="invite-notice"><span>✓</span><div><strong>초대 링크가 확인됐어요</strong><p>카카오 로그인 후 여행에 바로 참여합니다.</p></div></div>}
        <button className="kakao-login" onClick={login} disabled={busy || !hasSupabaseConfig}><span>●</span>{busy ? "카카오로 이동 중..." : "카카오로 계속하기"}</button>
        {!hasSupabaseConfig && <p className="auth-error">Cloudflare에 Supabase 공개 환경변수를 추가하면 로그인이 활성화됩니다.</p>}
        {error && <p className="auth-error">{error}</p>}
        <small>로그인하면 서비스 이용약관과 개인정보 처리방침에 동의하게 됩니다.</small>
      </section>
    </main>
  );
}

function WorkspaceSetup({ onCreated, inviteError }: { onCreated: () => Promise<void>; inviteError?: string }) {
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("새 여행");
  const create = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("create_trip", { p_name: name.trim() || "새 여행" });
    if (!error) await onCreated();
    setBusy(false);
  };
  return (
    <main className="auth-page">
      <section className="auth-card setup-card">
        <p className="auth-eyebrow">WELCOME</p>
        <h1>{inviteError ? "초대 링크를 확인해주세요" : "첫 여행을 만들어볼까요?"}</h1>
        {inviteError && <p className="auth-error">{inviteError}</p>}
        <label className="trip-name-field"><span>여행 이름</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} /></label>
        <button className="create-trip-button" onClick={create} disabled={busy}>{busy ? "만드는 중..." : "새 여행 만들기"}</button>
        <button className="signout-link" onClick={() => signOut()}>다른 계정으로 로그인</button>
      </section>
    </main>
  );
}

export function WorkspaceGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [trip, setTrip] = useState<WorkspaceTrip | null>(null);
  const [trips, setTrips] = useState<WorkspaceTrip[]>([]);
  const [role, setRole] = useState<"owner" | "member">("member");
  const [members, setMembers] = useState<MemberProfile[]>([]);
  const [inviteError, setInviteError] = useState("");
  const inviteToken = useMemo(() => {
    const queryToken = new URL(window.location.href).searchParams.get("invite") ?? undefined;
    if (queryToken) sessionStorage.setItem("into-the-blue-invite", queryToken);
    return queryToken ?? sessionStorage.getItem("into-the-blue-invite") ?? undefined;
  }, []);

  const activateTrip = useCallback(async (nextTrip: WorkspaceTrip, userId: string) => {
    setTrip(nextTrip);
    setRole(nextTrip.role);
    setMembers([]);
    localStorage.setItem(`into-the-blue-active-trip:${userId}`, nextTrip.id);

    const { data: memberRows } = await supabase.from("trip_members").select("user_id").eq("trip_id", nextTrip.id);
    const ids = (memberRows ?? []).map((row) => row.user_id);
    if (!ids.length) return;
    const { data: profiles } = await supabase.from("profiles").select("id,nickname,avatar_url").in("id", ids);
    setMembers((profiles ?? []).map((profile) => ({
      id: profile.id,
      nickname: profile.nickname || "여행자",
      avatarUrl: profile.avatar_url ?? undefined,
    })));
  }, []);

  const loadWorkspace = useCallback(async (currentSession: Session) => {
    const user = currentSession.user;
    let acceptedTripId: string | undefined;
    await supabase.from("profiles").upsert({ id: user.id, nickname: metadataName(user), avatar_url: metadataAvatar(user) }, { onConflict: "id" });
    if (inviteToken) {
      const { data, error } = await supabase.rpc("accept_invite", { p_token: inviteToken });
      if (error) setInviteError("유효하지 않거나 이미 사용된 초대 링크입니다.");
      else {
        acceptedTripId = data as string;
        sessionStorage.removeItem("into-the-blue-invite");
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
    const { data: memberships } = await supabase.from("trip_members").select("trip_id,role,joined_at").eq("user_id", user.id).order("joined_at", { ascending: true });
    if (!memberships?.length) {
      setTrips([]);
      setTrip(null);
      setMembers([]);
      setLoading(false);
      return;
    }
    const membershipRows = memberships ?? [];
    const tripIds = membershipRows.map((membership) => membership.trip_id);
    const { data: tripRows } = tripIds.length
      ? await supabase.from("trips").select("id,name,owner_id").in("id", tripIds)
      : { data: [] };
    const rowsById = new Map((tripRows ?? []).map((row) => [row.id, row]));
    const nextTrips = membershipRows.flatMap((membership) => {
      const row = rowsById.get(membership.trip_id);
      return row ? [{ ...row, role: membership.role as "owner" | "member" }] : [];
    });
    setTrips(nextTrips);
    const savedTripId = localStorage.getItem(`into-the-blue-active-trip:${user.id}`);
    const nextTrip = nextTrips.find((item) => item.id === acceptedTripId)
      ?? nextTrips.find((item) => item.id === savedTripId)
      ?? nextTrips[0];
    if (nextTrip) await activateTrip(nextTrip, user.id);
    setLoading(false);
  }, [activateTrip, inviteToken]);

  const selectTrip = useCallback((tripId: string) => {
    if (!session || tripId === trip?.id) return;
    const nextTrip = trips.find((item) => item.id === tripId);
    if (nextTrip) void activateTrip(nextTrip, session.user.id);
  }, [activateTrip, session, trip?.id, trips]);

  const createTrip = useCallback(async (name: string) => {
    if (!session) return "로그인 정보를 확인하지 못했습니다.";
    const nextName = name.trim();
    if (!nextName) return "여행 제목을 입력해주세요.";
    const { data: createdTripId, error } = await supabase.rpc("create_trip", { p_name: nextName });
    if (error || !createdTripId) return "새 여행을 만들지 못했습니다. 잠시 후 다시 시도해주세요.";

    const createdTrip: WorkspaceTrip = {
      id: createdTripId,
      name: nextName,
      owner_id: session.user.id,
      role: "owner",
    };
    setTrips((current) => [...current, createdTrip]);
    await activateTrip(createdTrip, session.user.id);
    return null;
  }, [activateTrip, session]);

  const renameTrip = useCallback(async (tripId: string, name: string) => {
    if (!session) return "로그인 정보를 확인하지 못했습니다.";
    const target = trips.find((item) => item.id === tripId);
    if (!target || target.role !== "owner") return "여행을 만든 사람만 제목을 수정할 수 있습니다.";
    const nextName = name.trim();
    if (!nextName) return "여행 제목을 입력해주세요.";
    const { error } = await supabase.rpc("rename_trip", { p_trip_id: tripId, p_name: nextName });
    if (error) return "여행 제목을 수정하지 못했습니다. 데이터베이스 마이그레이션을 확인해주세요.";

    setTrips((current) => current.map((item) => item.id === tripId ? { ...item, name: nextName } : item));
    setTrip((current) => current?.id === tripId ? { ...current, name: nextName } : current);
    return null;
  }, [session, trips]);

  const deleteTrip = useCallback(async (tripId: string) => {
    if (!session) return "로그인 정보를 확인하지 못했습니다.";
    const target = trips.find((item) => item.id === tripId);
    if (!target || target.role !== "owner") return "여행을 만든 사람만 삭제할 수 있습니다.";
    const { error } = await supabase.rpc("delete_trip", { p_trip_id: tripId });
    if (error) return "여행을 삭제하지 못했습니다. 데이터베이스 마이그레이션을 확인해주세요.";

    const remaining = trips.filter((item) => item.id !== tripId);
    setTrips(remaining);
    if (trip?.id === tripId) {
      const nextTrip = remaining[0];
      if (nextTrip) await activateTrip(nextTrip, session.user.id);
      else {
        localStorage.removeItem(`into-the-blue-active-trip:${session.user.id}`);
        setTrip(null);
        setMembers([]);
      }
    }
    return null;
  }, [activateTrip, session, trip?.id, trips]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) void loadWorkspace(data.session);
      else setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession) void loadWorkspace(nextSession);
      else {
        setTrip(null);
        setTrips([]);
        setMembers([]);
        setLoading(false);
      }
    });
    return () => listener.subscription.unsubscribe();
  }, [loadWorkspace]);

  if (loading) return <main className="auth-page"><div className="auth-loader">여행을 불러오는 중...</div></main>;
  if (!session) return <LoginPage inviteToken={inviteToken} />;
  if (!trip) return <WorkspaceSetup inviteError={inviteError} onCreated={() => loadWorkspace(session)} />;

  const value: WorkspaceValue = {
    user: session.user,
    userName: metadataName(session.user),
    avatarUrl: metadataAvatar(session.user),
    trip,
    trips,
    role,
    members,
    selectTrip,
    createTrip,
    renameTrip,
    deleteTrip,
  };
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceGate");
  return value;
}
