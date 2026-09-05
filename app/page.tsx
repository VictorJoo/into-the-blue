import Link from "next/link";
import { ArrowRight, CalendarDays, MapPinned, Route, UsersRound } from "lucide-react";
import LandingMap from "@/src/LandingMap";
import WebMcpLandingTools from "@/src/WebMcpLandingTools";
import styles from "./page.module.css";

const features = [
  {
    icon: MapPinned,
    title: "장소를 지도 위에",
    description: "가고 싶은 장소와 후보를 한눈에 비교하고 바로 일정에 넣을 수 있어요.",
  },
  {
    icon: Route,
    title: "동선을 더 단순하게",
    description: "날짜와 코스별 이동 경로를 확인하며 무리 없는 하루를 만들어요.",
  },
  {
    icon: UsersRound,
    title: "함께 결정하기",
    description: "동행자를 초대하고 댓글과 메모로 여행 계획을 함께 완성해요.",
  },
];

export default function HomePage() {
  return (
    <main className={styles.page}>
      <WebMcpLandingTools />
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Into the Blue 홈">
          <span className={styles.brandMark}><MapPinned size={18} strokeWidth={2.2} /></span>
          <span>Into the Blue</span>
        </Link>
        <nav className={styles.nav} aria-label="주요 메뉴">
          <a href="#features">기능</a>
          <Link href="/login">로그인</Link>
          <Link className={styles.navPrimary} href="/planner">여행 계획 시작</Link>
        </nav>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>SHARED TRAVEL PLANNER</p>
          <h1>여행의 모든 순간을,<br />지도 위에서 함께.</h1>
          <p className={styles.lead}>흩어진 장소와 의견을 하나의 여행으로 정리하세요. 날짜별 일정부터 실제 이동 경로까지 모두 한 화면에 담았습니다.</p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryAction} href="/planner">여행 계획 시작하기 <ArrowRight size={17} /></Link>
            <a className={styles.secondaryAction} href="#features">어떻게 작동하나요?</a>
          </div>
          <div className={styles.heroNote}>
            <UsersRound size={17} />
            <span><strong>초대 링크 하나로</strong> 동행자와 바로 시작하세요.</span>
          </div>
        </div>

        <div className={styles.mapStage} aria-label="Into the Blue 여행 지도 미리보기">
          <LandingMap />
          <article className={`${styles.mapCard} ${styles.scheduleCard}`}>
            <span className={styles.cardIcon}><CalendarDays size={17} /></span>
            <div><small>오늘의 일정</small><strong>선셋 타운 산책</strong><span>17:30 · 세 번째 장소</span></div>
          </article>
          <article className={`${styles.mapCard} ${styles.routeCard}`}>
            <small>예상 이동</small>
            <strong>18.4 km</strong>
            <span>자동차로 약 31분</span>
          </article>
        </div>
      </section>

      <section className={styles.features} id="features" aria-labelledby="feature-heading">
        <div className={styles.sectionIntro}>
          <p>PLAN TOGETHER</p>
          <h2 id="feature-heading">계획에 필요한 것만,<br />한곳에 모았습니다.</h2>
        </div>
        <div className={styles.featureGrid}>
          {features.map(({ icon: Icon, title, description }) => (
            <article className={styles.featureCard} key={title}>
              <span><Icon size={20} strokeWidth={1.9} /></span>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className={styles.footer}>
        <span>Into the Blue</span>
        <p>더 좋은 여행은 더 선명한 계획에서 시작됩니다.</p>
      </footer>
    </main>
  );
}
