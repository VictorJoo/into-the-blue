import { importBookmarks, ImportError } from "./server/importBookmarks.ts";

// 1. URL 검증 에러 경로
for (const bad of ["not-a-url", "https://example.com/foo"]) {
  try {
    await importBookmarks(bad);
    console.log("UNEXPECTED success", bad);
  } catch (e) {
    console.log("expected error:", bad, "->", e instanceof ImportError ? `${e.status} ${e.message}` : e);
  }
}
