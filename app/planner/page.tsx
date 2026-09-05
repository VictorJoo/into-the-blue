import type { Metadata } from "next";
import PlannerEntry from "./PlannerEntry";

export const metadata: Metadata = {
  title: "여행 계획",
  description: "장소, 일정과 이동 경로를 지도 위에서 함께 편집하세요.",
  robots: { index: false, follow: false },
};

export default function PlannerPage() {
  return <PlannerEntry />;
}
