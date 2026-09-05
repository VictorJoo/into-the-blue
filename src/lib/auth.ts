import { supabase } from "./supabase";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function oauthRedirectUrl(inviteToken?: string) {
  const currentUrl = new URL(window.location.href);

  // 로컬에서는 배포용 환경설정과 무관하게 현재 개발 서버의 포트로 복귀한다.
  // Supabase Authentication의 Redirect URLs에도 이 origin이 등록되어 있어야 한다.
  const redirect = LOCAL_HOSTNAMES.has(currentUrl.hostname)
    ? new URL("/planner", currentUrl.origin)
    : new URL("/planner", window.location.origin);

  if (inviteToken) redirect.searchParams.set("invite", inviteToken);
  return redirect.toString();
}

export async function signInWithKakao(inviteToken?: string) {
  return supabase.auth.signInWithOAuth({
    provider: "kakao",
    options: {
      redirectTo: oauthRedirectUrl(inviteToken),
    },
  });
}

export async function signOut() {
  return supabase.auth.signOut();
}
