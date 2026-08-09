# 여정 — Into the Blue

제주 여행 일정과 이동 경로를 한 화면에서 함께 계획하는 React 앱입니다.

## 실행

```bash
pnpm install
pnpm dev
```

프로덕션 빌드는 `pnpm build`로 생성합니다.

## 주요 기능

- 시간순 일정과 현재 시간 진행 표시
- OpenStreetMap 기반 1지망 경로 및 장소 이동
- Google Maps 실제 자동차 경로 지원 및 Google 리뷰 링크
- 각 일정의 1지망/후보 장소 목록
- 장소별 댓글 팝오버와 브라우저 로컬 저장
- 데스크톱/모바일 반응형 UI
- GitHub Pages 자동 배포 워크플로

## GitHub Pages 배포

저장소의 **Settings → Pages → Source**를 **GitHub Actions**로 설정한 뒤 `main` 브랜치에 푸시하면 자동으로 빌드·배포됩니다.

현재 댓글은 브라우저의 `localStorage`에 저장되므로 같은 기기에서만 보입니다. 여러 여행자가 댓글을 공유하려면 Supabase 같은 데이터베이스를 연결하세요.

## Google Maps 연결

Google Cloud Console에서 **Maps JavaScript API**와 **Directions API**를 활성화하고 `.env.example`을 `.env.local`로 복사한 뒤 브라우저 API 키를 입력하세요. 키가 없을 때는 OpenStreetMap 미리보기가 자동으로 표시되며, Google 리뷰 링크는 키 없이도 작동합니다.

GitHub Pages에서는 저장소의 **Settings → Secrets and variables → Actions**에 `GOOGLE_MAPS_API_KEY`라는 이름으로 키를 등록하세요. Google Cloud Console에서 키의 웹사이트 제한을 `https://사용자명.github.io/저장소명/*`으로 설정해야 합니다.
