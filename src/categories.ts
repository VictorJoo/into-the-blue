import type { Candidate, PlaceCategory } from "./types";

export const PLACE_CATEGORIES: { value: PlaceCategory; label: string; icon: string }[] = [
  { value: "restaurant", label: "음식점", icon: "🍽" },
  { value: "cafe", label: "카페", icon: "☕" },
  { value: "shopping", label: "쇼핑", icon: "🛍" },
  { value: "tourism", label: "관광", icon: "🏝" },
  { value: "other", label: "기타", icon: "⌖" },
];

const categoryValues = new Set<PlaceCategory>(PLACE_CATEGORIES.map(({ value }) => value));

export function inferPlaceCategory(item: Pick<Candidate, "title" | "note">): PlaceCategory {
  const text = `${item.title} ${item.note}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/mart|market|쇼핑|기념품|souvenir|red street|야시장|chợ đêm|cho dem/.test(text)) return "shopping";
  if (/restaurant|bistro|kitchen|cuisine|seafood|hai san|buffet|bbq|food|식객|레스토랑|음식점|해산물|씨푸드|점심|저녁|아침 식사|한식|카레|분켄|bún|bun quay|껌자딘|com gia dinh|bếp|bep|nhà hàng|nha hang|tom house|tôm house|솥 |banh mi|bánh mì/.test(text)) return "restaurant";
  if (/cafe|coffee|커피|카페|gelato|빙수|bingsu|minmon|루남/.test(text)) return "cafe";
  if (/tour|tourism|관광|투어|호핑|vinwonders|빈원더스|grand world|sunset town|썬셋타운|kiss of the sea|키스 오브 더 씨|분수쇼|show|temple|사원|해변|beach|bãi sao|bai sao|island|섬|safari|사파리|theme park|테마파크|놀이공원|waterpark|워터파크|야경|곤돌라|케이블카|bridge|브릿지|다리|산책/.test(text)) return "tourism";
  return "other";
}

export function placeCategory(item: Pick<Candidate, "title" | "note" | "category">): PlaceCategory {
  return categoryValues.has(item.category as PlaceCategory) ? item.category as PlaceCategory : inferPlaceCategory(item);
}

export function categoryMeta(item: Pick<Candidate, "title" | "note" | "category">) {
  const value = placeCategory(item);
  return PLACE_CATEGORIES.find((category) => category.value === value)!;
}
