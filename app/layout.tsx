import type { Metadata, Viewport } from "next";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "../src/styles.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: {
    default: "Into the Blue — 함께 만드는 여행 계획",
    template: "%s · Into the Blue",
  },
  description: "지도 위에서 장소를 모으고, 동행자와 일정을 완성하는 여행 계획 서비스",
  applicationName: "Into the Blue",
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: "Into the Blue",
    title: "Into the Blue — 함께 만드는 여행 계획",
    description: "장소부터 동선까지, 여행 계획을 한눈에 정리하세요.",
    images: [{ url: "/into-the-blue-social-preview.png", width: 1200, height: 630, alt: "해안선을 따라 이어지는 Into the Blue 여행 경로" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Into the Blue — 함께 만드는 여행 계획",
    description: "장소부터 동선까지, 여행 계획을 한눈에 정리하세요.",
    images: ["/into-the-blue-social-preview.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F5F7FA",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
