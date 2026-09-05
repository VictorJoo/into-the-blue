# Into the Blue

지도 위에서 장소와 동선을 정리하고 동행자와 함께 편집하는 여행 계획 서비스입니다.

현재 구성은 **Next.js 16 App Router + Mapbox Standard(Faded)/Directions + Supabase Auth/Postgres/Realtime + Google Places UI Kit + Cloudflare Workers**입니다. 지도와 기본 자동차 경로는 Mapbox가 담당하고, Google은 장소 검색과 원본 지도 링크에만 사용합니다. 자체 OSRM은 필요할 때 선택해서 붙일 수 있습니다.

## 구조

```text
브라우저
 ├─ Next.js 앱 Worker ── Supabase Auth / Postgres / Realtime
 ├─ Mapbox GL JS ─────── Mapbox Standard · Faded / Directions
 ├─ Google Places UI Kit
 └─ (선택) 경로 Worker ─ Supabase JWT·멤버십 확인 ── OSRM
```

- `/`: 첫 화면
- `/login`: 카카오 로그인과 초대 수락
- `/planner`: 인증된 여행 계획 화면
- `/api/import/bookmarks`: 인증된 즐겨찾기 공유 링크 가져오기
- 선택형 `into-the-blue-value` Worker: 자체 OSRM을 쓸 때 인증된 자동차 경로 계산

## 필요한 인증 정보

값은 Git에 커밋하지 않습니다. 루트에 `.env.local`을 만들고 [`.env.example`](.env.example)의 이름대로 입력합니다.

| 서비스 | 필요한 값 | 공개 범위 |
| --- | --- | --- |
| Supabase | Project URL, Publishable key | 브라우저 공개 가능. RLS 필수 |
| Mapbox | Default public token 또는 별도 public token | 브라우저 공개 가능. URL 제한 필수 |
| Google Cloud | 브라우저 API key | 브라우저 공개 가능. HTTP referrer/API 제한 필수 |
| Cloudflare | Workers Builds의 GitHub 연결 | 대시보드 또는 Wrangler 인증 |
| 선택형 경로 Worker | OSRM URL, Supabase URL/key | Worker Secret으로만 저장 |

`service_role` 키, Mapbox secret token, Google 서비스 계정 키는 프론트엔드 환경변수에 절대 넣지 않습니다.

## 로컬 실행

Node.js 22.13 이상과 pnpm 9를 사용합니다.

```bash
pnpm install
pnpm dev
```

기본 주소는 `http://localhost:3000`입니다. Mapbox 토큰이 없으면 첫 화면은 정적 미리보기를 보여주고, 여행 계획 지도는 설정 안내 상태로 표시됩니다.

검증 명령:

```bash
pnpm lint
pnpm typecheck
pnpm build:next
pnpm build
pnpm deploy:cloudflare:check
```

## Supabase 설정

### 데이터베이스

Supabase Dashboard의 **SQL Editor**에서 아래 파일을 번호 순서대로 실행합니다. 모든 사용자 데이터 테이블은 RLS를 켠 상태로 사용합니다.

1. [`supabase/migrations/202608100001_collaboration.sql`](supabase/migrations/202608100001_collaboration.sql)
2. [`supabase/migrations/202608100002_trip_management.sql`](supabase/migrations/202608100002_trip_management.sql)
3. [`supabase/migrations/202608100003_fix_invite_crypto_schema.sql`](supabase/migrations/202608100003_fix_invite_crypto_schema.sql)
4. [`supabase/migrations/202608100004_rename_trip.sql`](supabase/migrations/202608100004_rename_trip.sql)
5. [`supabase/migrations/202608100005_multi_use_invites.sql`](supabase/migrations/202608100005_multi_use_invites.sql)
6. [`supabase/migrations/202608120001_unscheduled_candidates.sql`](supabase/migrations/202608120001_unscheduled_candidates.sql)
7. [`supabase/migrations/202608120002_trip_courses.sql`](supabase/migrations/202608120002_trip_courses.sql)
8. [`supabase/migrations/202608210001_value_map.sql`](supabase/migrations/202608210001_value_map.sql)

### Auth URL

**Authentication → URL Configuration**에서 다음처럼 설정합니다.

```text
Site URL
https://into-the-blue.proudvictor89.workers.dev

Redirect URLs
http://localhost:3000/**
http://127.0.0.1:3000/**
https://into-the-blue.proudvictor89.workers.dev/**
```

사용자 도메인을 붙이면 그 주소의 `/**`도 추가합니다. 카카오 개발자 콘솔에는 앱 주소가 아니라 Supabase가 표시하는 아래 Redirect URI를 등록합니다.

```text
https://<project-ref>.supabase.co/auth/v1/callback
```

카카오 동의 항목은 최소 `profile_nickname`을 사용합니다. `account_email` 권한이 없는 앱이라면 Supabase Kakao provider의 이메일 scope를 요청하지 않도록 맞춰야 합니다.

## Mapbox 설정

Mapbox **Access tokens**에서 public token을 만들고 URL 제한에 다음 출처를 등록합니다.

```text
http://localhost:3000/*
http://127.0.0.1:3000/*
https://into-the-blue.proudvictor89.workers.dev/*
```

사용자 도메인을 붙이면 그 출처도 추가합니다. 토큰은 `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`에 입력합니다. 앱은 Mapbox Standard의 `faded` 테마와 Directions API를 사용합니다. 기본 토큰보다는 별도 public token을 만들고 운영·미리보기 도메인을 URL 제한에 등록하세요.

## Google Places 설정

Google Cloud Console에서 **Maps JavaScript API**와 Places UI Kit에 필요한 **Places API**를 활성화합니다. 키의 애플리케이션 제한은 **웹사이트(HTTP referrer)**, API 제한은 실제 사용하는 두 API로 설정합니다.

```text
http://localhost:3000/*
http://127.0.0.1:3000/*
https://into-the-blue.proudvictor89.workers.dev/*
```

키는 `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`에 입력합니다. Google 지도 자체나 Google Routes API는 렌더링·경로 계산에 사용하지 않습니다.

## Cloudflare 앱 Worker 배포

Cloudflare **Workers & Pages → into-the-blue → Settings → Builds**에서 GitHub 저장소와 `main` 브랜치를 연결합니다.

```text
Build command:  pnpm build
Deploy command: pnpm exec wrangler deploy
Root directory: /
Node version:   22.13 이상
```

Build variables에는 아래 다섯 값을 등록합니다. `NEXT_PUBLIC_*` 값은 브라우저 번들에 빌드 시 포함되므로 값을 바꾼 뒤에는 반드시 새 빌드를 실행합니다.

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
NEXT_PUBLIC_SITE_URL
```

자체 OSRM을 사용할 때만 `NEXT_PUBLIC_ROUTE_API_URL`을 추가합니다. 이 값이 없으면 Mapbox Directions가 기본 경로 엔진으로 사용됩니다.

비프로덕션 브랜치 빌드는 PR 미리보기가 필요할 때만 켭니다. 운영 브랜치는 `main`입니다.
별도 미리보기 도메인에서 전체 기능을 시험하려면 그 정확한 Origin을 Supabase Redirect URLs, Mapbox/Google 허용 URL, 경로 Worker의 `ALLOWED_ORIGINS`에도 추가합니다.

## 선택 사항: 자체 OSRM 경로 Worker 배포

Mapbox Directions 대신 자체 OSRM을 운영하려는 경우에만 `worker/value.ts`를 앱과 별도로 배포합니다. 브라우저 요청의 Supabase access token과 `trip_members` 멤버십을 확인한 뒤 OSRM을 호출합니다.

먼저 [`wrangler.value.jsonc`](wrangler.value.jsonc)의 `ALLOWED_ORIGINS`를 운영 도메인에 맞춥니다. 이후 Worker Secret을 등록하고 배포합니다.

```bash
pnpm exec wrangler secret put OSRM_BASE_URL --config wrangler.value.jsonc
pnpm exec wrangler secret put SUPABASE_URL --config wrangler.value.jsonc
pnpm exec wrangler secret put SUPABASE_PUBLISHABLE_KEY --config wrangler.value.jsonc
pnpm exec wrangler secret put OSRM_REGIONS_JSON --config wrangler.value.jsonc
pnpm deploy:route-worker
```

단일 OSRM 서버만 쓰면 `OSRM_REGIONS_JSON`은 생략할 수 있습니다. 배포된 경로 Worker의 주소를 앱의 `NEXT_PUBLIC_ROUTE_API_URL`에 `/api/value/route`까지 포함해 등록한 뒤 앱을 다시 빌드합니다.

## 즐겨찾기 그룹 가져오기

상단의 **즐겨찾기 가져오기**에서 Google 지도·카카오맵·네이버 지도의 공개 공유 링크를 날짜 미정 후보로 가져올 수 있습니다. `/api/import/bookmarks`는 로그인한 사용자의 Bearer token을 확인하므로 로컬과 Cloudflare 배포 환경에서 동일하게 동작합니다.

- 지원 링크: `naver.me/…`, `kko.kakao.com/…`, `maps.app.goo.gl/…`
- 세 서비스의 공개 공유 페이지 구조를 해석하므로 서비스 개편 시 파서 보수가 필요할 수 있습니다.
- 같은 이름의 장소가 이미 일정이나 후보에 있으면 건너뜁니다.

## 주요 기능

- 날짜·시간·장소를 편집하는 코스 중심 일정
- 확정·후보 장소, 메모, 댓글, 작성자 표시
- 지도 팝업의 Google 링크·댓글·수정 동작
- 동행자 초대 링크와 Supabase 공동 편집
- 접근 가능한 여행 전환, 소유자 전용 이름 변경·삭제
- Mapbox 자동차 경로, 일정 PDF 저장, Realtime 현재 위치 공유
- 320px 모바일부터 넓은 데스크톱까지 반응형 화면

세부 지도·선택형 OSRM·데이터 정책은 [`docs/value-map-architecture.md`](docs/value-map-architecture.md)를 참고하세요.
