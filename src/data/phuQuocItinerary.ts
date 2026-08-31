import type { Place } from "../types";
import { inferPlaceCategory } from "../categories";

const PLACEHOLDER_COORDS: [number, number] = [10.2899, 103.9840];

type ItineraryEntry = {
  time: string;
  title: string;
  category: string;
  note: string;
};

const entries: Record<string, ItineraryEntry[]> = {
  "2026-10-29": [
    { time: "06:00", title: "인천팀 도착 · VJ979", category: "항공 · 인천팀", note: "16인승 버스 픽업. 부산팀 도착 전까지 인천팀 시내 일정 진행." },
    { time: "07:30", title: "Bánh Mì & You", category: "조식 · 인천팀", note: "반미·브런치 맛집. 에어컨과 카드 결제 가능. Cửa Lấp, 롱비치 방면." },
    { time: "09:00", title: "ANBA Coffee", category: "카페 · 인천팀", note: "분위기 좋은 카페에서 휴식. 131 Trần Hưng Đạo." },
    { time: "10:30", title: "Golden Foot Massage", category: "마사지 · 인천팀", note: "인천팀 4명, 약 60~90분. 이 시간에 버스는 공항으로 이동해 부산팀 픽업. 1A Trần Hưng Đạo." },
    { time: "11:00", title: "부산팀 도착 · VJ969", category: "항공 · 부산팀", note: "16인승 버스로 공항 픽업 후 시내 이동. 인천팀 마사지 종료 시간에 맞춰 합류." },
    { time: "12:30", title: "Bơ Restaurant & Coffee", category: "점심 · 8명 합류", note: "8명 전원 합류 후 점심. 100c Trần Hưng Đạo." },
    { time: "14:00", title: "Kingkong Mart", category: "장보기", note: "물·맥주·주전부리·기념품 구매. 141A Trần Hưng Đạo." },
    { time: "15:00", title: "The Residence Resort & Villas 체크인", category: "숙소 · 휴식", note: "체크인과 짐 정리 후 프라이빗 풀·해변에서 휴식." },
    { time: "16:30", title: "Sunset Town 이동", category: "이동 · 8명", note: "키스브릿지와 골목을 산책하며 석양 준비. 숙소에서 차로 약 30~40분." },
    { time: "17:30", title: "NamBo Kitchen", category: "저녁 · 석양", note: "선셋타운에서 노을을 보며 베트남식·해산물 저녁. 81 Positano, Sunset Town." },
    { time: "20:00", title: "분수쇼 관람 후 숙소 복귀", category: "관람 · 이동", note: "키스 오브 더 씨 분수쇼 일부 관람 가능. 컨디션에 따라 관람 후 버스로 복귀." },
  ],
  "2026-10-30": [
    { time: "09:00", title: "VinWonders 이동", category: "이동 · 16인승 버스", note: "북부 바이다이로 이동. 남부 숙소에서 약 1시간~1시간 10분." },
    { time: "10:00", title: "VinWonders 워터파크 & 놀이공원", category: "테마파크", note: "워터파크와 놀이공원 이용. 인접 빈펄 사파리 콤보도 고려." },
    { time: "12:30", title: "VinWonders 파크 내부 점심", category: "점심", note: "워터파크·테마파크 내 식당 또는 푸드코트 이용." },
    { time: "17:30", title: "Grand World 이동", category: "이동 · 관광", note: "운하 곤돌라와 야간 조명쇼가 있는 그랜드월드로 이동." },
    { time: "18:30", title: "Mai Hương Restaurant", category: "저녁 · 쇼뷰", note: "워터프론트 야외 해산물 식당. TH1-09 Grand World. 쇼가 보이는 자리 단체 예약 권장." },
    { time: "21:00", title: "Grand World 야경 산책 후 복귀", category: "야경 · 이동", note: "곤돌라·분수·조명 감상 후 16인승 버스로 남부 숙소 복귀." },
  ],
  "2026-10-31": [
    { time: "08:00", title: "안터이 군도 호핑 투어 픽업", category: "투어 · 8명", note: "OnBird 소규모 스노클링 또는 Into The Blue 추천. 8명 단체 사전 예약 필수." },
    { time: "12:30", title: "호핑 투어 선상 점심", category: "점심 · 투어", note: "투어에 포함된 선상 식사 또는 BBQ." },
    { time: "16:30", title: "투어 종료 · 숙소 복귀", category: "휴식", note: "안터이 항구에서 숙소로 돌아와 샤워와 휴식." },
    { time: "19:00", title: "즈엉동 시내 자유 저녁", category: "저녁 · 자유", note: "즈엉동 야시장 또는 현지 해산물 식당에서 자유 식사." },
    { time: "22:00", title: "Rosso Sky Bar & Lounge", category: "클럽 · 루프탑", note: "시뷰 루프탑 나이트클럽. 라이브 밴드와 수영장. 대안: OCSEN Beach Bar & Club, Chip Funny." },
  ],
  "2026-11-01": [
    { time: "11:00", title: "숙소 체크아웃", category: "체크아웃 · 이동", note: "8명 전원 체크아웃. 16인승 버스에 짐을 싣고 시내로 이동." },
    { time: "11:30", title: "즈엉동 시내 마지막 점심", category: "점심 · 8명", note: "이발소와 꿀 구매 장소에 가까운 시내 식당에서 함께 점심." },
    { time: "12:30", title: "Mr Đen Barbershop", category: "베트남 이발소", note: "면도·귀청소·얼굴·두피 마사지. 8명 WhatsApp 사전 예약 권장: +84 913 879 789. 217A Đường 30 Tháng 4." },
    { time: "14:00", title: "푸꾸옥 꿀 구매", category: "쇼핑", note: "시내 특산품점 또는 Kingkong Mart에서 선물용 꿀 구매." },
    { time: "14:30", title: "인천팀 공항 드롭 · VJ979", category: "항공 · 인천팀", note: "버스로 인천팀 4명을 먼저 공항에 드롭. 시내에서 공항까지 약 25~35분." },
    { time: "15:30", title: "Hộ Quốc Temple", category: "관광 · 부산팀", note: "바다 전망의 호꾸옥 사원 방문. 남부 해안 언덕, 공항에서 차로 약 25분." },
    { time: "16:45", title: "Bãi Sao", category: "해변 · 부산팀", note: "사오비치 산책·물놀이·석양. 입장료 10만 동에 음료 1잔 포함, 선베드 이용 가능." },
    { time: "18:30", title: "Ann Seafood", category: "저녁 · 부산팀", note: "켐비치 해변 해산물 식당. Bãi Khem, 공항까지 차로 약 10분." },
    { time: "20:00", title: "부산팀 공항 도착 · VJ969", category: "항공 · 부산팀", note: "23:00 출국편 체크인을 위해 3시간 전 공항 도착." },
  ],
};

export const PHU_QUOC_DATES = Object.keys(entries).sort();

export const PHU_QUOC_LIST_TITLES: Record<string, string> = {
  "2026-10-29": "도착과 선셋타운",
  "2026-10-30": "VinWonders와 Grand World",
  "2026-10-31": "호핑 투어와 토요일 밤",
  "2026-11-01": "체크아웃과 팀별 출국",
};

export function createPhuQuocItinerary(userId: string, userName: string): Record<string, Place[]> {
  const createdAt = new Date().toISOString();
  return Object.fromEntries(Object.entries(entries).map(([date, items]) => [
    date,
    items.map((item, index): Place => ({
      id: `phu-quoc-${date}-${item.time.replace(":", "")}-${index + 1}`,
      ...item,
      category: inferPlaceCategory(item),
      duration: "",
      coords: [...PLACEHOLDER_COORDS],
      alternatives: [],
      createdBy: userId,
      createdByName: userName,
      createdAt,
    })),
  ]));
}
