/**
 * Local opening acts: artists unusually strong in a specific city, in the headliner's lane.
 *
 * Qloo's location signal surfaces local favourites (e.g. Lizzo and Dessa in Minneapolis),
 * but also acts that are strong everywhere. We remove those by comparing cities:
 * an artist that shows up in many of the tour's cities isn't "local" to any of them.
 */
import { insightsEntities, point, type QlooEntity } from "@/lib/qloo/api";
import type { LocalOpener } from "@/lib/types";
import { dedupeEntities, genreNames, mapSettled, normName, round, toArtistRef } from "./util";

export interface LocalCity {
  key: string;
  lat: number;
  lon: number;
  name: string;
  region?: string;
}

interface Headliner {
  id: string;
  name: string;
  popularity: number;
  listeners?: number;
  genreTagIds: string[];
  /** all of the headliner's genre names, used to keep openers in the same lane */
  genres: string[];
  excludeIds: string[];
}

const GENERIC_GENRES = new Set(["pop", "rock", "alternative", "united states", "electronic"]);

/** Share at least one specific genre with the headliner (ignoring very broad ones). */
function sameLane(e: QlooEntity, headGenres: Set<string>) {
  const genres = genreNames(e).map(normName);
  const specific = genres.filter((g) => !GENERIC_GENRES.has(g));
  return specific.some((g) => headGenres.has(g)) || (specific.length === 0 && genres.some((g) => headGenres.has(g)));
}

const CANDIDATES_PER_CITY = 40;
const RADIUS_M = 40_000;
/** Below this taste fit, an act is too far from the headliner to open for them. */
const MIN_FIT = 0.8;

/**
 * Two candidate pools per city:
 *  - taste: artists like the headliner, weighted toward this city (in-lane, sometimes national)
 *  - scene: artists popular in this city within the headliner's genres (local, sometimes off-lane)
 * Openers should be smaller than the headliner, so both are capped below its popularity.
 */
async function localCandidates(city: LocalCity, head: Headliner) {
  const where = { "signal.location": point(city.lat, city.lon), "signal.location.radius": RADIUS_M };
  const maxPopularity = round(Math.min(head.popularity * 0.97, 0.97), 3);
  const [taste, scene] = await Promise.all([
    insightsEntities(
      "urn:entity:artist",
      { ...where, "signal.interests.entities": head.id, "filter.popularity.max": maxPopularity },
      CANDIDATES_PER_CITY,
    ),
    insightsEntities(
      "urn:entity:artist",
      {
        ...where,
        "signal.interests.tags": head.genreTagIds.length ? head.genreTagIds : undefined,
        "filter.popularity.max": maxPopularity,
      },
      CANDIDATES_PER_CITY,
    ),
  ]);
  const sceneIds = new Set(scene.map((e) => e.id));
  return { list: dedupeEntities([...taste, ...scene]), sceneIds };
}

/** How close each candidate's taste is to the headliner's (0..1), via Qloo affinity on a fixed list. */
async function fitToHeadliner(headId: string, candidates: QlooEntity[]) {
  if (!candidates.length) return new Map<string, number>();
  const scored = await insightsEntities(
    "urn:entity:artist",
    { "signal.interests.entities": headId, "filter.results.entities": candidates.map((c) => c.id) },
    candidates.length,
  );
  return new Map(scored.map((s) => [s.id, s.affinity ?? 0]));
}

const mentions = (text: string | undefined, words: (string | undefined)[]) => {
  if (!text) return false;
  const t = ` ${normName(text)} `;
  return words.some((w) => w && w.length > 2 && t.includes(` ${normName(w)} `));
};

/**
 * Local openers for each city. Pass every city on the tour at once so we can spot acts
 * that are strong everywhere; for a single city, pass a few reference cities too (`reference`).
 */
export async function findLocalOpeners(
  cities: LocalCity[],
  head: Headliner,
  options: { perCity?: number; reference?: LocalCity[] } = {},
): Promise<Map<string, LocalOpener[]>> {
  const all = [...cities, ...(options.reference ?? [])];
  const pools = await mapSettled(all, 6, (c) => localCandidates(c, head));

  // in how many cities does each artist appear? (strong everywhere = not local anywhere)
  const seenIn = new Map<string, number>();
  for (const pool of pools) for (const e of pool?.list ?? []) seenIn.set(e.id, (seenIn.get(e.id) ?? 0) + 1);
  const ubiquityLimit = Math.max(2, Math.ceil(all.length * 0.3));

  const exclude = new Set([head.id, ...head.excludeIds]);
  const headName = normName(head.name);
  const headGenres = new Set(head.genres.map(normName));
  const ranked = new Map<string, LocalOpener[]>();

  await mapSettled(cities, 6, async (city, i) => {
    const pool = pools[i];
    if (!pool) return;
    const eligible = pool.list.filter(
      (e) =>
        !exclude.has(e.id) &&
        (seenIn.get(e.id) ?? 0) < ubiquityLimit &&
        !normName(e.name).includes(headName) &&
        e.popularity < head.popularity,
    );
    // same genre lane only, unless that leaves almost nobody
    const inLane = eligible.filter((e) => sameLane(e, headGenres));
    const candidates = inLane.length >= 2 ? inLane : eligible;
    const fit = await fitToHeadliner(head.id, candidates);

    const scored = candidates.map((e) => {
      // hometown evidence: the description or a genre tag names the city/region (e.g. a "Boston" tag)
      const confirmedLocal =
        mentions(e.description, [city.name, city.region]) ||
        genreNames(e).some((g) => normName(g) === normName(city.name) || (city.region && normName(g) === normName(city.region)));
      const f = fit.get(e.id) ?? 0;
      const rank = f + (confirmedLocal ? 0.05 : 0) + (pool.sceneIds.has(e.id) ? 0.02 : 0);
      return { opener: { ...toArtistRef(e), fit: round(f), confirmedLocal }, rank };
    });

    ranked.set(
      city.key,
      scored
        .filter((s) => s.opener.fit >= MIN_FIT)
        .sort((a, b) => b.rank - a.rank)
        .map((s) => s.opener),
    );
  });

  // Give each city its own openers: cities are in priority order, an act is used once
  // (unless a city would otherwise have nobody).
  const perCity = options.perCity ?? 3;
  const used = new Set<string>();
  const result = new Map<string, LocalOpener[]>();
  for (const city of cities) {
    const list = ranked.get(city.key) ?? [];
    const fresh = list.filter((o) => !used.has(o.id)).slice(0, perCity);
    const picked = fresh.length ? fresh : list.slice(0, 1);
    picked.forEach((o) => used.add(o.id));
    result.set(city.key, picked);
  }
  return result;
}
