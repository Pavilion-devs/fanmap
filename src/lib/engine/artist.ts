/**
 * Artist-level tools: find the artist, read their audience, find tour openers and brand partners.
 */
import { demographics, insightsEntities, searchEntities, type QlooEntity } from "@/lib/qloo/api";
import type { ArtistRef, Audience, BrandMatch, Notice } from "@/lib/types";
import { dedupeEntities, genreNames, isActiveAct, isGenreTag, normName, round, toArtistRef } from "./util";

export interface ResolvedArtist {
  entity: QlooEntity;
  ref: ArtistRef;
  /** Qloo genre tag ids, used to find local acts in the same lane */
  genreTagIds: string[];
  /** all genre names (ArtistRef.genres is trimmed for display) */
  allGenres: string[];
  /** audience trait tags, e.g. "Devoted" */
  traits: string[];
  /** entity ids to use as the taste signal (the artist, plus similar artists if data is thin) */
  signalIds: string[];
  notices: Notice[];
}

/** Below these, Qloo knows too little about an artist to map their fans on their own. */
const THIN_LISTENERS = 15_000;
const THIN_POPULARITY = 0.45;

/** Edit-distance similarity, 0..1 (1 = identical). */
function similarity(a: string, b: string) {
  if (a === b) return 1;
  const m = a.length;
  const n = b.length;
  if (!m || !n) return 0;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

/**
 * Does a search result plausibly match what the user typed? Qloo search always returns its
 * closest guess, so "zzqq band" would otherwise become a real artist. Typos still pass.
 */
export function plausibleMatch(query: string, name: string) {
  const q = normName(query);
  const n = normName(name);
  const strip = (s: string) => s.replace(/^the /, "");
  if (!q || !n) return false;
  if (strip(q) === strip(n) || n.includes(q) || q.includes(n)) return true;
  return similarity(strip(q), strip(n)) >= 0.75;
}

export async function resolveArtist(query: string): Promise<ResolvedArtist | undefined> {
  const results = (await searchEntities(query, ["urn:entity:artist"], 6)).filter((r) => plausibleMatch(query, r.name));
  if (!results.length) return undefined;

  const q = normName(query);
  const exact = results.filter((r) => normName(r.name) === q);
  const entity = (exact.length ? exact : results).sort((a, b) => b.popularity - a.popularity)[0];

  const notices: Notice[] = [];
  if (exact.length > 1) {
    notices.push({
      code: "ambiguous_input",
      message: `Several artists are called "${entity.name}". Using the best-known one.`,
    });
  }

  const genreTagIds = [...new Set(entity.tags.filter(isGenreTag).map((t) => t.id))].slice(0, 3);
  const traits = [...new Set(entity.tags.filter((t) => t.type === "urn:tag:audience:qloo").map((t) => t.name))].slice(0, 5);

  let signalIds = [entity.id];
  const thin = (entity.listeners ?? 0) < THIN_LISTENERS && entity.popularity < THIN_POPULARITY;
  if (thin) {
    const similar = await insightsEntities("urn:entity:artist", { "signal.interests.entities": entity.id }, 5);
    const ids = similar.filter((s) => s.id !== entity.id).slice(0, 3).map((s) => s.id);
    if (ids.length) {
      signalIds = [entity.id, ...ids];
      notices.push({
        code: "similar_artist_fallback",
        message: `Qloo has limited data on ${entity.name} so far, so the fan map also uses fans of similar artists.`,
      });
    }
  }

  const allGenres = genreNames(entity);
  return { entity, ref: toArtistRef(entity), genreTagIds, allGenres, traits, signalIds, notices };
}

/** Pick a venue size from the artist's reach when the user didn't choose one. */
export function inferVenueSize(entity: QlooEntity): "club" | "theatre" | "arena" {
  const listeners = entity.listeners ?? 0;
  if (listeners >= 3_000_000) return "arena";
  if (listeners >= 600_000) return "theatre";
  return "club";
}

// ---------- audience ----------

const AGE_BANDS: Record<string, { label: string; min: number; max: number }> = {
  "24_and_younger": { label: "Under 25", min: 18, max: 24 },
  "25_to_29": { label: "25–29", min: 25, max: 29 },
  "30_to_34": { label: "30–34", min: 30, max: 34 },
  "35_to_44": { label: "35–44", min: 35, max: 44 },
  "45_to_54": { label: "45–54", min: 45, max: 54 },
  "55_and_older": { label: "55+", min: 55, max: 99 },
};

/** "Mostly 18–34", or "Mostly under 25 and 45–54" when two separate groups stand out. */
export function ageSummary(leans: Record<string, number>) {
  const order = Object.keys(AGE_BANDS);
  const strongKeys = order.filter((band) => (leans[band] ?? 0) > 0.1);
  if (!strongKeys.length) return "All ages";

  // group consecutive bands into ranges
  const groups: { min: number; max: number }[] = [];
  let last = -2;
  for (const key of strongKeys) {
    const i = order.indexOf(key);
    const band = AGE_BANDS[key];
    if (i === last + 1 && groups.length) groups[groups.length - 1].max = band.max;
    else groups.push({ min: band.min, max: band.max });
    last = i;
  }
  const label = (g: { min: number; max: number }) => (g.max >= 99 ? `${g.min}+` : g.min <= 18 && g.max === 24 ? "under 25" : `${g.min}–${g.max}`);
  return `Mostly ${groups.map(label).join(" and ")}`;
}

export async function getAudience(signalIds: string[], traits: string[]): Promise<Audience | undefined> {
  const d = await demographics(signalIds);
  if (!d) return undefined;

  const age = Object.entries(d.age).map(([band, lean]) => ({ band: AGE_BANDS[band]?.label ?? band, lean: round(lean) }));
  const female = round(d.gender.female ?? 0);
  const male = round(d.gender.male ?? 0);
  const genderPart = female > 0.15 ? "leans female" : male > 0.15 ? "leans male" : "balanced by gender";

  return { age, gender: { female, male }, summary: `${ageSummary(d.age)}, ${genderPart}`, traits };
}

// ---------- openers ----------

export async function findOpeners(artist: ResolvedArtist, take = 8) {
  const similar = await insightsEntities("urn:entity:artist", { "signal.interests.entities": artist.entity.id }, 30);
  const head = artist.entity;
  const candidates = dedupeEntities(similar.filter((s) => s.id !== head.id && isActiveAct(s) && !normName(s.name).includes(normName(head.name))));

  const isSmaller = (s: QlooEntity) =>
    head.listeners && s.listeners ? s.listeners < head.listeners * 0.8 : s.popularity < head.popularity;

  // smaller acts first (a support slot), then by how well they match
  return candidates
    .map((s) => ({ ...toArtistRef(s), fit: round(s.affinity ?? 0), smaller: isSmaller(s) }))
    .sort((a, b) => Number(b.smaller) - Number(a.smaller) || b.fit - a.fit)
    .slice(0, take);
}

// ---------- brands ----------

/**
 * Brands the audience over-indexes on. Qloo sometimes has no brand data for an artist;
 * then we use similar artists' audiences (`fallbackIds`) instead.
 */
export async function findBrands(signalIds: string[], fallbackIds: string[] = [], take = 8): Promise<BrandMatch[]> {
  const query = (ids: string[]) =>
    insightsEntities("urn:entity:brand", { "signal.interests.entities": ids }, 20).catch(() => [] as QlooEntity[]);
  let found = await query(signalIds);
  if (!found.length && fallbackIds.length) found = await query(fallbackIds);
  const brands = dedupeEntities(found);
  return brands.slice(0, take).map((b) => ({
    id: b.id,
    name: b.name,
    affinity: round(b.affinity ?? 0),
    pitch: `${b.name} is one of the brands this audience over-indexes on.`,
  }));
}
