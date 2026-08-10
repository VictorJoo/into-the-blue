# 여정 — Into the Blue

해외 여행 일정과 이동 경로를 한 화면에서 함께 계획하는 React 앱입니다.

## 실행

```bash
pnpm install
pnpm dev
```

프로덕션 빌드는 `pnpm build`로 생성합니다.

## Supabase 협업 기능 적용

로그인, 여행 초대, 작성자 표시와 공동 저장을 사용하려면 Supabase Dashboard의 **SQL Editor**에서
아래 마이그레이션을 순서대로 실행합니다.

1. [`supabase/migrations/202608100001_collaboration.sql`](supabase/migrations/202608100001_collaboration.sql)
2. [`supabase/migrations/202608100002_trip_management.sql`](supabase/migrations/202608100002_trip_management.sql)
3. [`supabase/migrations/202608100003_fix_invite_crypto_schema.sql`](supabase/migrations/202608100003_fix_invite_crypto_schema.sql)
4. [`supabase/migrations/202608100004_rename_trip.sql`](supabase/migrations/202608100004_rename_trip.sql)
5. [`supabase/migrations/202608100005_multi_use_invites.sql`](supabase/migrations/202608100005_multi_use_invites.sql)

필수 공개 환경변수는 `.env.example`을 참고해 로컬 `.env.local`과 Cloudflare Workers Builds에 설정합니다.

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_ME
```

카카오 OAuth 복귀를 위해 Supabase **Authentication → URL Configuration**에 로컬 주소와 운영 주소를 허용합니다.

```text
http://localhost:5173/**
https://into-the-blue.<account-subdomain>.workers.dev/**
```

## 주요 기능

- 시간순 일정과 현재 시간 진행 표시
- OpenStreetMap 기반 확정 일정 경로 및 장소 이동
- 지도 장소 팝업의 Google 리뷰 링크와 댓글 바로가기
- Google Maps 전체 링크에서 장소명과 실제 위치 자동 추출
- 입력한 검색어로 무료 Google Maps 검색 결과 열기
- 방문 시간 입력과 일정 자동 정렬
- 오늘을 기본으로 일정이 있는 이전·다음 날짜 탐색
- 전체 여행 기간 표시와 날짜별 일정 제목 편집
- 지도 없이 전체 일정을 정리한 A4 PDF 저장 화면
- 확정 일정/후보 사이 드래그 앤 드롭 이동
- API 키 없는 Google 리뷰·장소 링크
- 각 일정의 확정/후보 장소 목록
- 확정·후보 장소 메모 등록 및 자유로운 수정
- 모든 장소 삭제 전 확인 및 후보 승격 선택
- 접근 가능한 여행 목록 전환과 소유자 전용 여행 삭제
- 날짜별 일정·메모·댓글의 Supabase 공동 저장
- 모바일 일정/지도 전환 탭을 포함한 반응형 UI
- Cloudflare Workers Builds 자동 배포

## Cloudflare 배포

Cloudflare Workers의 **Settings → Builds**에서 GitHub 저장소와 `main` 브랜치를 연결합니다. Build variables에 Supabase 공개 환경변수를 등록하면 `main` 푸시마다 자동으로 빌드·배포됩니다.
