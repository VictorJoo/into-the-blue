import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { debugResolve, importBookmarks, ImportError } from "./server/importBookmarks";

// 즐겨찾기 공유 링크 가져오기용 로컬 개발 프록시.
// 지도 서비스들이 CORS를 허용하지 않아 브라우저 대신 dev 서버가 대신 요청합니다.
// (배포 시에는 같은 모듈을 Cloudflare Worker에서 재사용할 수 있습니다.)
function bookmarkImportApi(): Plugin {
  return {
    name: "bookmark-import-api",
    configureServer(server) {
      server.middlewares.use("/api/import/bookmarks", (req, res) => {
        void (async () => {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          const query = new URL(req.url ?? "", "http://localhost");
          const target = query.searchParams.get("url")?.trim();
          if (!target) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "url 파라미터로 공유 링크를 전달해주세요." }));
            return;
          }
          try {
            if (query.searchParams.has("debug")) {
              res.end(JSON.stringify(await debugResolve(target)));
              return;
            }
            const result = await importBookmarks(target);
            res.end(JSON.stringify(result));
          } catch (cause) {
            res.statusCode = cause instanceof ImportError ? cause.status : 502;
            const message = cause instanceof Error ? cause.message : "즐겨찾기 가져오기에 실패했습니다.";
            res.end(JSON.stringify({ error: message }));
          }
        })();
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), bookmarkImportApi()],
  server: {
    port: 5173,
    strictPort: true,
  },
});
