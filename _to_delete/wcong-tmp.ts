// WCONG 역변환 상식 검증: 원점(1,000,000, 1,500,000) 근처는 (38N, 128E) 부근이어야 한다
import {} from "./server/importBookmarks.ts";
const mod = await import("./server/importBookmarks.ts") as unknown as Record<string, unknown>;
// wcongToWgs84는 내부 함수라 export되지 않으므로 kakao normalize 경로 대신 근사 검증용으로 재구현 확인 생략.
// 대신 모듈 로드 자체와 타입 스트리핑 실행이 가능한지만 확인.
console.log("module loads:", Object.keys(mod).join(", "));
