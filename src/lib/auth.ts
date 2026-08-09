import { supabase } from "./supabase";

export async function signInWithKakao(inviteToken?: string) {
  const redirect = new URL(window.location.origin);
  if (inviteToken) redirect.searchParams.set("invite", inviteToken);
  return supabase.auth.signInWithOAuth({
    provider: "kakao",
    options: {
      redirectTo: redirect.toString(),
    },
  });
}

export async function signOut() {
  return supabase.auth.signOut();
}
