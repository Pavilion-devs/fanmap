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
  /** Qloo's category, e.g. "Live music venue", "Cocktail bar" */
  category?: string;
  /** rough size class for performance venues */
  tier?: "club" | "theatre" | "arena";
  /** fans' affinity for this place, 0..1 */
  affinity: number;
  distanceKm?: number;
  website?: string;
  source: "qloo";
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
  venueSize?: "club" | "theatre" | "arena" | "any";
  /** free-text wishes for the agent, e.g. "skip New York, end in my hometown, college towns welcome" */
  notes?: string;
}

/** How a plan was produced, shown to users and judges as proof of the agent's work. */
export interface RunInfo {
  engine: "agent" | "pipeline";
  model?: string;
  /** tool calls the agent made, in order */
  toolCalls: { tool: string; ms: number }[];
  /** agent turns (model calls) */
  turns: number;
  ms: number;
  /** why the plan fell back to the pipeline, if it did */
  fallbackReason?: string;
  /** tokens and estimated cost (agent + baseline comparison) */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    estimatedCostUsd: number;
    calls: number;
  };
  /** served from the plan cache (an identical request ran before) */
  cached?: boolean;
}

export interface TourCity {
  rank: number;
  place: Place;
  /** 0..100 combined score */
  score: number;
  /** plain-English reason backed by data */
  reason: string;
  /** the data behind the score, for tooltips and the brief */
  stats: {
    /** e.g. "top 0.1%": how this area ranks among all areas in the country */
    topShare: string;
    /** number of strong fan areas in this metro */
    fanAreas: number;
    marketPopulation: number;
    nearby: string[];
  };
  venues: VenueMatch[];
  localOpeners: LocalOpener[];
  spots: VenueMatch[]; // pre/after-show places
}

export interface LocalOpener extends ArtistRef {
  /** closeness to the headliner's taste, 0..1 */
  fit: number;
  /** the artist's description mentions this city or region */
  confirmedLocal: boolean;
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
  /** tour-wide support acts: share the headliner's audience, ideally smaller */
  openers: (ArtistRef & { fit: number; smaller: boolean })[];
  brands: BrandMatch[];
  /** the one-line takeaway, e.g. "Her fans cluster in New England college towns, not the big coastal cities." */
  headline?: string;
  comparison?: Comparison;
  brief?: Brief;
  notices: Notice[];
  run?: RunInfo;
  generatedAt: string;
}

// ---------- venue mode ----------

export interface VenuePlanInput {
  mode: "venue";
  /** venue name and/or city, e.g. "First Avenue, Minneapolis" */
  venue: string;
  /** genres the venue books, e.g. ["indie", "folk"] (optional) */
  genres?: string[];
  /** room capacity; sets the size of acts to suggest */
  capacity?: number;
  /** free-text wishes, e.g. "we want more hip hop nights" */
  notes?: string;
}

export interface BookingPick {
  artist: ArtistRef;
  /** 0..100: how much this venue's fans like the artist */
  fit: number;
  /** the artist is also unusually popular around the venue */
  localDraw: boolean;
  /** the artist's profile names the venue's city or region */
  confirmedLocal: boolean;
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
  venue: { name: string; place: Place; qlooId?: string; category?: string; address?: string; image?: string };
  /** the act size the plan targets, e.g. "mid-size (600–2,500)" */
  sizeBand: string;
  crowd?: Audience;
  picks: BookingPick[];
  localOpeners: LocalOpener[];
  doubleBills: DoubleBill[];
  brands: BrandMatch[];
  headline?: string;
  comparison?: Comparison;
  brief?: Brief;
  notices: Notice[];
  run?: RunInfo;
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
