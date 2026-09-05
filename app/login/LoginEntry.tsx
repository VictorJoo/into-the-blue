"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LoginPage } from "@/src/workspace";
import { hasSupabaseConfig, supabase } from "@/src/lib/supabase";

export default function LoginEntry() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [checking, setChecking] = useState(hasSupabaseConfig);
  const inviteToken = searchParams.get("invite") ?? undefined;

  useEffect(() => {
    if (!hasSupabaseConfig) return;
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        const query = inviteToken ? `?invite=${encodeURIComponent(inviteToken)}` : "";
        router.replace(`/planner${query}`);
      } else {
        setChecking(false);
      }
    });
  }, [inviteToken, router]);

  if (checking) {
    return <main className="auth-page"><div className="auth-loader" role="status">로그인 정보를 확인하는 중...</div></main>;
  }
  return <LoginPage inviteToken={inviteToken} />;
}
