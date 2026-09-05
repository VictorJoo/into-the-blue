export type PlaceCategory = "restaurant" | "cafe" | "shopping" | "tourism" | "other";

export type Candidate = {
  id: string;
  time: string;
  title: string;
  placeName?: string;
  courseId?: string;
  courseName?: string;
  category: PlaceCategory;
  categoryVersion?: number;
  categoryManual?: boolean;
  note: string;
  emoji?: string;
  coords: [number, number];
  googleMapsUrl?: string;
  googlePlaceId?: string;
  googleLocationUpdatedAt?: string;
  createdBy?: string;
  createdByName?: string;
  createdAt?: string;
};

export type Place = Candidate & {
  duration: string;
  travel?: string;
  alternatives: Candidate[];
};

export type MapSearchResult = {
  placeId: string;
  title: string;
  address: string;
  coords: [number, number];
  googleMapsUrl: string;
  locationRefreshedAt?: string;
};

export type DragItem =
  | { kind: "primary"; placeId: string }
  | { kind: "candidate"; placeId: string; candidateId: string }
  | { kind: "unscheduled"; candidateId: string };
