/**
 * Fanmap output format: the contract between the engine (backend) and the UI.
 *
 * The engine streams `PlanEvent`s while it works (newline-delimited JSON).
 * The UI can render progressively: steps as they run, partial results as they arrive,
 * and the full `ArtistPlan` / `VenuePlan` at the end.
 *
 * Change this file deliberately: both sides depend on it.
 */

// ---------- shared pieces ----------

export type Mode = "artist" | "venue";

export interface Place {
  /** display label, e.g. "Northampton, MA" or "Edinburgh, United Kingdom" */
  label: string;
  city: string;
  region?: string;
  country: string; // ISO-2
  lat: number;
  lon: number;
  population?: number;
}

export interface ArtistRef {
  id: string; // Qloo entity id
  name: string;
  image?: string;
  description?: string;
  genres: string[];
  /** Last.fm listeners, rough size signal */
  listeners?: number;
  popularity: number;
}

export interface Audience {
  /** positive = over-represented vs. the general population, negative = under */
  age: { band: string; lean: number }[];
  gender: { female: number; male: number };
  /** one plain-English line, e.g. "Mostly 18–29, leans female" */
  summary: string;
  /** Qloo audience tags, e.g. "Devoted", "Introspective" */
  traits: string[];
}

export interface BrandMatch {
  id: string;
  name: string;
  affinity: number;
  /** why this brand fits, one line */
  pitch: string;
}

export interface VenueMatch {
  id: string;
  name: string;
  address?: string;
  lat?: number;
  lon?: number;
  kind: "performance" | "pre_show" | "after_show" | "other";
  affinity: number;
  distanceKm?: number;
  source: "qloo" | "ticketmaster" | "openstreetmap";
  capacity?: number;
}

export interface FanArea {
  lat: number;
  lon: number;
  /** 0..1, position in the national ranking (1 = strongest) */
  strength: number;
}

export interface Comparison {
  /** what an LLM says without Qloo data */
  llmOnly: { items: string[]; reasoning?: string };
  /** what Fanmap says */
  fanmap: { items: string[] };
  /** items only Fanmap found */
  onlyFanmap: string[];
  /** e.g. "6 of 10 cities differ from the generic answer" */
  headline: string;
}

export interface Brief {
  title: string;
  markdown: string;
}

export type NoticeCode =
  | "limited_data" // few data points in this country/region
  | "similar_artist_fallback" // artist barely known, used similar artists
  | "ambiguous_input" // several matches, picked the most likely
  | "partial_result"; // some step failed, rest still useful

export interface Notice {
  code: NoticeCode;
  message: string;
}

// ---------- artist mode ----------

export interface ArtistPlanInput {
  mode: "artist";
  artist: string;
  /** country name or ISO-2 code; default "United States" */
  region?: string;
  shows?: number; // default 10
  startCity?: string;
  venueSize?: "club" | "theatre" | "any";
}

export interface TourCity {
  rank: number;
  place: Place;
  /** 0..100 combined score */
  score: number;
  /** plain-English reason backed by data */
  reason: string;
  venues: VenueMatch[];
  localOpener?: ArtistRef;
  spots: VenueMatch[]; // pre/after-show places
}

export interface RouteStop {
  order: number;
  cityLabel: string;
  /** km from the previous stop */
  km: number;
  /** suggested day offset from tour start */
  day: number;
}

export interface ArtistPlan {
  mode: "artist";
  input: ArtistPlanInput;
  artist: ArtistRef;
  region: { name: string; code: string };
  audience?: Audience;
  fanMap: FanArea[];
  cities: TourCity[];
  route: RouteStop[];
  openers: ArtistRef[];
  brands: BrandMatch[];
  comparison?: Comparison;
  brief?: Brief;
  notices: Notice[];
  generatedAt: string;
}

// ---------- venue mode ----------

export interface VenuePlanInput {
  mode: "venue";
  /** venue name and/or city, e.g. "First Avenue, Minneapolis" */
  venue: string;
  genres?: string[];
  capacity?: number;
}

export interface BookingPick {
  artist: ArtistRef;
  /** 0..100 */
  fit: number;
  reason: string;
}

export interface DoubleBill {
  headliner: ArtistRef;
  support: ArtistRef;
  /** shared taste tags */
  sharedTaste: string[];
  reason: string;
}

export interface VenuePlan {
  mode: "venue";
  input: VenuePlanInput;
  venue: { name: string; place: Place; qlooId?: string };
  crowd?: Audience;
  picks: BookingPick[];
  localOpeners: ArtistRef[];
  doubleBills: DoubleBill[];
  brands: BrandMatch[];
  comparison?: Comparison;
  brief?: Brief;
  notices: Notice[];
  generatedAt: string;
}

export type Plan = ArtistPlan | VenuePlan;
export type PlanInput = ArtistPlanInput | VenuePlanInput;

// ---------- streamed events ----------

export type StepStatus = "running" | "done" | "failed" | "skipped";

export type PlanEvent =
  /** the agent started or finished a step */
  | { type: "step"; id: string; label: string; status: StepStatus; detail?: string; tool?: string; ms?: number }
  /** the agent's own short commentary ("Her fans cluster in college towns…") */
  | { type: "thought"; text: string }
  /** a piece of the plan is ready; `key` is a top-level field of ArtistPlan / VenuePlan */
  | { type: "partial"; key: string; value: unknown }
  | { type: "notice"; notice: Notice }
  | { type: "result"; plan: Plan }
  | { type: "error"; message: string };
