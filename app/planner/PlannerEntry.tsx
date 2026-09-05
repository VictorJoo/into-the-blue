"use client";

import dynamic from "next/dynamic";

const PlannerRoot = dynamic(() => import("@/src/PlannerRoot"), {
  ssr: false,
  loading: () => (
    <main className="auth-page">
      <div className="auth-loader" role="status">여행 지도를 준비하는 중...</div>
    </main>
  ),
});

export default function PlannerEntry() {
  return <PlannerRoot />;
}
