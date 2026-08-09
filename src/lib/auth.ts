import { supabase } from "./supabase";

export async function signInWithKakao() {
  return supabase.auth.signInWithOAuth({
    provider: "kakao",
    options: {
      redirectTo: window.location.origin,
    },
  });
}

export async function signOut() {
  return supabase.auth.signOut();
}
