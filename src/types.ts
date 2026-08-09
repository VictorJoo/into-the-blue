export type Candidate = {
  id: string;
  time: string;
  title: string;
  category: string;
  note: string;
  emoji?: string;
  coords: [number, number];
  googleMapsUrl?: string;
  createdBy?: string;
  createdByName?: string;
  createdAt?: string;
};

export type Place = Candidate & {
  duration: string;
  travel?: string;
  alternatives: Candidate[];
};

export type DragItem =
  | { kind: "primary"; placeId: string }
  | { kind: "candidate"; placeId: string; candidateId: string };
