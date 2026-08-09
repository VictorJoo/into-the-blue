/* eslint-disable react-refresh/only-export-components */
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { signInWithKakao, signOut } from "./lib/auth";
import { supabase } from "./lib/supabase";

export type MemberProfile = {
  id: string;
  nickname: string;
  avatarUrl?: string;
};

type Trip = { id: string; name: string; owner_id: string };

type WorkspaceValue = {
  user: User;
  userName: string;
  avatarUrl?: string;
  trip: Trip;
  role: "owner" | "member";
  members: MemberProfile[];
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

function LoginPage({ inviteToken }: { inviteToken?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const login = async () => {
    setBusy(true);
    setError("");
    const { error: authError } = await signInWithKakao(inviteToken);
    if (authError) {
      setError("카카오 로그인을 시작하지 못했습니다. 잠시 후 다시 시도해주세요.");
      setBusy(false);
    }
  };
  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand"><span>여</span><strong>Into the Blue</strong></div>
        <p className="auth-eyebrow">SHARED TRAVEL PLANNER</p>
        <h1>함께 만드는 여행 일정</h1>
        <p className="auth-description">초대받은 여행자들과 장소, 후보, 메모와 의견을 한곳에서 정리하세요.</p>
        {inviteToken && <div className="invite-notice"><span>✓</span><div><strong>초대 링크가 확인됐어요</strong><p>카카오 로그인 후 여행에 바로 참여합니다.</p></div></div>}
        <button className="kakao-login" onClick={login} disabled={busy}><span>●</span>{busy ? "카카오로 이동 중..." : "카카오로 계속하기"}</button>
        {error && <p className="auth-error">{error}</p>}
        <small>초대받은 사용자만 여행 데이터에 접근할 수 있습니다.</small>
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
  const [trip, setTrip] = useState<Trip | null>(null);
  const [role, setRole] = useState<"owner" | "member">("member");
  const [members, setMembers] = useState<MemberProfile[]>([]);
  const [inviteError, setInviteError] = useState("");
  const inviteToken = useMemo(() => {
    const queryToken = new URL(window.location.href).searchParams.get("invite") ?? undefined;
    if (queryToken) sessionStorage.setItem("into-the-blue-invite", queryToken);
    return queryToken ?? sessionStorage.getItem("into-the-blue-invite") ?? undefined;
  }, []);

  const loadWorkspace = useCallback(async (currentSession: Session) => {
    const user = currentSession.user;
    await supabase.from("profiles").upsert({ id: user.id, nickname: metadataName(user), avatar_url: metadataAvatar(user) }, { onConflict: "id" });
    if (inviteToken) {
      const { error } = await supabase.rpc("accept_invite", { p_token: inviteToken });
      if (error) setInviteError("유효하지 않거나 이미 사용된 초대 링크입니다.");
      else {
        sessionStorage.removeItem("into-the-blue-invite");
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
    const { data: memberships } = await supabase.from("trip_members").select("trip_id,role").eq("user_id", user.id).order("joined_at", { ascending: true }).limit(1);
    const membership = memberships?.[0];
    if (!membership) {
      setTrip(null);
      setLoading(false);
      return;
    }
    const { data: tripRow } = await supabase.from("trips").select("id,name,owner_id").eq("id", membership.trip_id).single();
    setTrip(tripRow);
    setRole(membership.role as "owner" | "member");
    if (tripRow) {
      const { data: memberRows } = await supabase.from("trip_members").select("user_id").eq("trip_id", tripRow.id);
      const ids = (memberRows ?? []).map((row) => row.user_id);
      if (ids.length) {
        const { data: profiles } = await supabase.from("profiles").select("id,nickname,avatar_url").in("id", ids);
        setMembers((profiles ?? []).map((profile) => ({ id: profile.id, nickname: profile.nickname || "여행자", avatarUrl: profile.avatar_url ?? undefined })));
      } else setMembers([]);
    }
    setLoading(false);
  }, [inviteToken]);

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
    role,
    members,
  };
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceGate");
  return value;
}
