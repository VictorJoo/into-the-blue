import type { Metadata } from "next";
import { Suspense } from "react";
import LoginEntry from "./LoginEntry";

export const metadata: Metadata = {
  title: "로그인",
  description: "카카오 계정으로 로그인하고 동행자와 여행 계획을 시작하세요.",
};

export default function LoginRoute() {
  return (
    <Suspense fallback={<main className="auth-page"><div className="auth-loader">로그인 화면을 준비하는 중...</div></main>}>
      <LoginEntry />
    </Suspense>
  );
}
