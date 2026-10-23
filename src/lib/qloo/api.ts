/**
 * Typed Qloo endpoints used by Fanmap. Each returns small, normalised objects
 * so the rest of the app never touches raw Qloo responses.
 */
import { qlooGet, type Params } from "./client";

export type EntityType =
  | "urn:entity:artist"
  | "urn:entity:brand"
  | "urn:entity:place"
  | "urn:entity:destination"
  | "urn:entity:movie"
  | "urn:entity:tv_show"
  | "urn:entity:podcast"
  | "urn:entity:book"
  | "urn:entity:person"
  | "urn:entity:video_game";

export interface QlooTag {
  id: string;
  name: string;
  type: string;
}

export interface QlooEntity {
  id: string;
  name: string;
  types: string[];
  popularity: number;
  /** how strongly this matches the signal (insights only) */
  affinity?: number;
  /** metres from the location filter (places only) */
  distance?: number;
  description?: string;
  image?: string;
  tags: QlooTag[];
  location?: { lat: number; lon: number };
  address?: string;
  /** Last.fm listeners, a rough size signal for artists */
  listeners?: number;
  /** places: main category, e.g. { id: "urn:tag:genre:place:live_music_venue", name: "Live music venue" } */
  category?: { id: string; name: string };
  /** places: permanently closed */
  closed?: boolean;
  website?: string;
}

export interface HeatCell {
  lat: number;
  lon: number;
  geohash: string;
  affinity: number;
  affinityRank: number;
  popularity: number;
}

export interface Heatmap {
  /** total areas Qloo returned for the region (data coverage signal) */
  totalCells: number;
  /** top cells by affinity rank */
  cells: HeatCell[];
}

export interface Demographics {
  age: Record<string, number>;
  gender: Record<string, number>;
}

// ---------- raw response shapes (only the parts we read) ----------

type RawTag = { tag_id?: string; id?: string; name: string; type?: string; subtype?: string };
type RawEntity = {
  entity_id: string;
  name: string;
  types?: string[];
  subtype?: string;
  popularity?: number;
  query?: { affinity?: number; distance?: number };
  tags?: RawTag[];
  location?: { lat: number; lon: number };
  properties?: {
    short_description?: string;
    description?: string;
    address?: string;
    image?: { url?: string };
    external?: { lastfm?: { listeners?: number } };
    primary_genre?: { id?: string; name?: string } | null;
    is_closed?: boolean;
    website?: string;
  };
};

function normalizeEntity(e: RawEntity): QlooEntity {
  return {
    id: e.entity_id,
    name: e.name,
    types: e.types ?? (e.subtype ? [e.subtype] : []),
    popularity: e.popularity ?? 0,
    affinity: e.query?.affinity,
    distance: e.query?.distance,
    description: e.properties?.short_description ?? e.properties?.description,
    image: e.properties?.image?.url,
    tags: (e.tags ?? []).map((t) => ({ id: t.tag_id ?? t.id ?? "", name: t.name, type: t.type ?? t.subtype ?? "" })),
    location: e.location,
    address: e.properties?.address,
    listeners: e.properties?.external?.lastfm?.listeners,
    category: e.properties?.primary_genre?.id
      ? { id: e.properties.primary_genre.id, name: e.properties.primary_genre.name ?? "" }
      : undefined,
    closed: e.properties?.is_closed || undefined,
    website: e.properties?.website,
  };
}

// ---------- endpoints ----------

/** Find entities by name, e.g. an artist the user typed. */
export async function searchEntities(query: string, types: EntityType[] = ["urn:entity:artist"], take = 5) {
  return qlooGet<{ results?: RawEntity[] }, QlooEntity[]>(
    "/search",
    { query, types, take },
    { transform: (raw) => (raw.results ?? []).map(normalizeEntity), variant: "entities-v2" },
  );
}

const MAX_TAKE = 50; // Qloo's limit per request

/** General insights query returning entities (similar artists, brands, places, ...). Pages past 50 results. */
export async function insightsEntities(filterType: EntityType, params: Params, take = 10): Promise<QlooEntity[]> {
  const pages = Math.ceil(Math.max(take, 1) / MAX_TAKE);
  const fetchPage = (page: number) =>
    qlooGet<{ results?: { entities?: RawEntity[] } }, QlooEntity[]>(
      "/v2/insights",
      { "filter.type": filterType, ...params, take: Math.min(take, MAX_TAKE), page: pages > 1 ? page : undefined },
      { transform: (raw) => (raw.results?.entities ?? []).map(normalizeEntity), variant: "entities-v2" },
    );
  if (pages === 1) return fetchPage(1);
  const results = await Promise.all(Array.from({ length: pages }, (_, i) => fetchPage(i + 1)));
  return results.flat().slice(0, take);
}

const HEATMAP_KEEP = 600;

/**
 * Where an entity's fans are concentrated within a region (country name, e.g. "United States").
 * The raw response is ~2 MB, so only the top cells are kept and cached.
 */
export async function heatmap(entityIds: string[], region: string, extra: Params = {}) {
  type Raw = {
    results?: {
      heatmap?: {
        location: { latitude: number; longitude: number; geohash: string };
        query: { affinity: number; affinity_rank: number; popularity: number };
      }[];
    };
  };
  return qlooGet<Raw, Heatmap>(
    "/v2/insights",
    {
      "filter.type": "urn:heatmap",
      "signal.interests.entities": entityIds,
      "filter.location.query": region,
      ...extra,
    },
    {
      variant: `heatmap-top-${HEATMAP_KEEP}`,
      transform: (raw) => {
        const all = raw.results?.heatmap ?? [];
        const cells = all
          .map((h) => ({
            lat: h.location.latitude,
            lon: h.location.longitude,
            geohash: h.location.geohash,
            affinity: h.query.affinity,
            affinityRank: h.query.affinity_rank,
            popularity: h.query.popularity,
          }))
          .sort((a, b) => b.affinityRank - a.affinityRank)
          .slice(0, HEATMAP_KEEP);
        return { totalCells: all.length, cells };
      },
    },
  );
}

/** Age and gender lean of an entity's audience (positive = over-represented). */
export async function demographics(entityIds: string[]) {
  type Raw = { results?: { demographics?: { query?: { age?: Record<string, number>; gender?: Record<string, number> } }[] } };
  return qlooGet<Raw, Demographics | null>(
    "/v2/insights",
    { "filter.type": "urn:demographics", "signal.interests.entities": entityIds },
    {
      variant: "demographics",
      transform: (raw) => {
        const q = raw.results?.demographics?.[0]?.query;
        return q ? { age: q.age ?? {}, gender: q.gender ?? {} } : null;
      },
    },
  );
}

/** Taste tags two entities (or groups) have in common. */
export async function compare(aIds: string[], bIds: string[], take = 10) {
  type Raw = { results?: { tags?: (RawTag & { query?: { score?: number } })[] } };
  return qlooGet<Raw, (QlooTag & { score: number })[]>(
    "/v2/insights/compare",
    { "a.signal.interests.entities": aIds, "b.signal.interests.entities": bIds, take },
    {
      variant: "compare-tags",
      // Qloo ignores `take` here, so trim ourselves (and drop duplicate names)
      transform: (raw) =>
        (raw.results?.tags ?? [])
          .filter((t, i, all) => all.findIndex((o) => o.name === t.name) === i)
          .slice(0, take)
          .map((t) => ({
          id: t.tag_id ?? t.id ?? "",
          name: t.name,
          type: t.subtype ?? t.type ?? "",
          score: t.query?.score ?? 0,
        })),
    },
  );
}

/** Look up valid tag ids by keyword (tags must be real Qloo ids, not free text). */
export async function searchTags(query: string, take = 10) {
  type Raw = { results?: { tags?: RawTag[] } };
  return qlooGet<Raw, QlooTag[]>(
    "/v2/tags",
    { "filter.query": query, take },
    {
      variant: "tags",
      transform: (raw) => (raw.results?.tags ?? []).map((t) => ({ id: t.tag_id ?? t.id ?? "", name: t.name, type: t.type ?? "" })),
    },
  );
}

/** WKT point helper: Qloo expects POINT(lon lat). */
export const point = (lat: number, lon: number) => `POINT(${lon} ${lat})`;
