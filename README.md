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
[`supabase/migrations/202608100001_collaboration.sql`](supabase/migrations/202608100001_collaboration.sql)을 실행합니다.

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
- 날짜별 일정·메모·댓글의 브라우저 로컬 저장
- 모바일 일정/지도 전환 탭을 포함한 반응형 UI
- GitHub Pages 자동 배포 워크플로

## GitHub Pages 배포

저장소의 **Settings → Pages → Source**를 **GitHub Actions**로 설정한 뒤 `main` 브랜치에 푸시하면 자동으로 빌드·배포됩니다.

현재 일정, 메모와 댓글은 브라우저의 `localStorage`에 저장되므로 같은 기기에서만 보입니다. 장소는 Google 지도 검색 화면에서 찾은 전체 링크를 붙여넣어 등록합니다. 여러 여행자가 데이터를 공유하거나 검색 결과를 앱 안에서 바로 불러오려면 데이터베이스와 장소 검색 API를 연결하세요.
