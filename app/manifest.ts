import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Into the Blue",
    short_name: "Into the Blue",
    description: "지도 위에서 동행자와 함께 만드는 여행 계획",
    start_url: "/",
    display: "standalone",
    background_color: "#F5F7FA",
    theme_color: "#F5F7FA",
    icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
