/**
 * Venue mode tools: "Who should I book?"
 *
 * The key signal is the venue itself: Qloo knows which artists the fans of a specific venue
 * like (First Avenue → Hippo Campus, Bad Bad Hats, Caamp...). We combine that with location
 * (acts unusually popular around the venue) and the room's size.
 */
import { compare, insightsEntities, point, searchEntities, searchTags, type QlooEntity } from "@/lib/qloo/api";
import { CITIES, cityLabel, distanceKm, findCity, findCountry, citiesNear, type City } from "@/lib/geo/cities";
import type { Audience, BookingPick, BrandMatch, DoubleBill, LocalOpener, Place } from "@/lib/types";
import { getAudience } from "./artist";
import { dedupeEntities, genreNames, isActiveAct, mapSettled, normName, round, toArtistRef } from "./util";

// ---------- the venue ----------

export interface ResolvedVenue {
  name: string;
  qlooId?: string;
  category?: string;
  address?: string;
  image?: string;
  lat: number;
  lon: number;
  city: City;
  place: Place;
  /** true when we only know the city, not a specific venue */
  cityOnly: boolean;
}

const VENUE_LIKE = /(music venue|concert|hall|theat|arena|ballroom|stadium|amphitheater|night club|jazz club|event venue|auditorium|live music|bar|pub|tavern|lounge)/i;

function placeFor(city: City, lat: number, lon: number): Place {
  return {
    label: cityLabel(city),
    city: city.name,
    region: city.region || undefined,
    country: city.country,
    lat,
    lon,
    population: city.population,
  };
}

/**
 * "First Avenue, Minneapolis" → the Qloo place. "Minneapolis" alone → the city centre.
 * Prefers results that look like venues and whose name matches what was typed.
 */
/** Split "Hard Rock Cafe Lagos" / "First Avenue, Minneapolis" into a venue name and a city hint. */
export function splitQuery(query: string) {
  const parts = query.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length > 1) return { name: parts[0], cityHint: parts.slice(1).join(", ") };
  const words = query.trim().split(/\s+/);
  for (const n of [2, 1]) {
    if (words.length <= n) continue;
    const tail = words.slice(-n).join(" ");
    const city = findCity(tail)[0];
    if (city && normName(city.name) === normName(tail)) return { name: words.slice(0, -n).join(" "), cityHint: tail };
  }
  return { name: query.trim(), cityHint: "" };
}

/**
 * "First Avenue, Minneapolis" → the Qloo place. "Minneapolis" alone → the city's music scene.
 * Prefers results that look like venues, whose names match what was typed, near the named city.
 */
export async function resolveVenue(query: string): Promise<ResolvedVenue | undefined> {
  const { name: namePart, cityHint } = splitQuery(query);

  // the whole query is just a city: plan for that city's scene
  const asCity = findCity(query)[0];
  if (asCity && normName(asCity.name) === normName(query.split(",")[0])) {
    return {
      name: `Venue in ${asCity.name}`,
      lat: asCity.lat,
      lon: asCity.lon,
      city: asCity,
      place: placeFor(asCity, asCity.lat, asCity.lon),
      cityOnly: true,
    };
  }

  const results = (await searchEntities(query, ["urn:entity:place"], 8)).filter((r) => r.location);
  // "Northampton" could be MA or England: measure against every city with that name
  const hintCities = cityHint ? findCity(cityHint, 10) : [];
  const hintCity = hintCities[0];
  const hintKm = (loc: { lat: number; lon: number }) => Math.min(...hintCities.map((c) => distanceKm(c, loc)));
  const wanted = normName(namePart);
  const wantedWords = wanted.split(" ").filter((w) => w.length > 2);

  const scored = results
    .map((r) => {
      const n = normName(r.name);
      const nameWords = new Set(n.split(" "));
      let score = 0;
      if (n === wanted) score += 3;
      else if (n.includes(wanted) || wanted.includes(n)) score += 2.5;
      // same words in any order: "Brixton Academy" ↔ "O2 Academy Brixton"
      else if (wantedWords.length && wantedWords.every((w) => nameWords.has(w))) score += 2.5;
      else if (wantedWords.some((w) => w.length > 3 && nameWords.has(w))) score += 1;
      if (VENUE_LIKE.test(r.category?.name ?? "")) score += 1.5;
      if (hintCities.length && r.location && hintKm(r.location) < 40) score += 2;
      if (hintCities.length && r.location && hintKm(r.location) > 150) score -= 3;
      if (r.closed) score -= 3;
      return { r, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (best && best.score >= 3) {
    const { r } = best;
    // name the venue's town: the nearest one, unless a much bigger city is close
    // (Brixton → London, not "City of Westminster"; The Iron Horse → Northampton, not Chicopee)
    const around = citiesNear(r.location!.lat, r.location!.lon, 20, 15_000);
    let named = around[0];
    for (const c of around) if (named && c.population >= 5 * named.population && c.population >= 100_000) named = c;
    const city = named ?? citiesNear(r.location!.lat, r.location!.lon, 40, 15_000)[0] ?? findCity(cityHint || namePart)[0];
    if (city) {
      return {
        name: r.name,
        qlooId: r.id,
        category: r.category?.name,
        address: r.address,
        image: r.image,
        lat: r.location!.lat,
        lon: r.location!.lon,
        city,
        place: placeFor(city, r.location!.lat, r.location!.lon),
        cityOnly: false,
      };
    }
  }

  // the venue isn't in Qloo but we know the city ("Hard Rock Cafe Lagos"): use the city's scene
  const city = hintCity ?? findCity(query)[0];
  if (!city) return undefined;
  return {
    name: `Venue in ${city.name}`,
    lat: city.lat,
    lon: city.lon,
    city,
    place: placeFor(city, city.lat, city.lon),
    cityOnly: true,
  };
}

// ---------- room size ----------

export interface SizeBand {
  label: string;
  /** global Qloo popularity range for acts that fit the room */
  min: number;
  max: number;
  /**
   * the same range relative to the local market (quantiles of local acts' popularity).
   * Qloo popularity is global: a Nigerian superstar (Davido, 0.92) scores below a mid-level
   * US act, so in many countries the global range alone would shut out the local stars.
   */
  rel: [number, number];
}

/** Map a room's capacity to the popularity of acts that typically fill it. Rough, by design. */
export function sizeBand(capacity?: number): SizeBand {
  if (!capacity) return { label: "any size (no capacity given)", min: 0.5, max: 0.99, rel: [0, 0.97] };
  if (capacity <= 600) return { label: `small room (up to 600)`, min: 0.4, max: 0.955, rel: [0, 0.6] };
  if (capacity <= 2500) return { label: `mid-size (600–2,500)`, min: 0.85, max: 0.985, rel: [0.25, 0.9] };
  if (capacity <= 7000) return { label: `theatre (2,500–7,000)`, min: 0.95, max: 0.995, rel: [0.5, 1] };
  return { label: `arena (7,000+)`, min: 0.985, max: 1, rel: [0.8, 1] };
}

/** Popularity cut-offs for a band, measured against the local scene's own distribution. */
export function localCutoffs(pops: number[], rel: [number, number]): [number, number] {
  if (pops.length < 8) return [0, 1];
  const sorted = [...pops].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
  return [rel[0] <= 0 ? 0 : at(rel[0]), rel[1] >= 1 ? 1 : at(rel[1])];
}

// ---------- genres ----------

/** Turn genre words ("indie", "hip hop") into Qloo genre tag ids. */
export async function genreTagIds(genres: string[] = []): Promise<{ ids: string[]; names: string[] }> {
  const found = await mapSettled(genres.slice(0, 4), 4, async (g) => {
    const tags = await searchTags(g, 10);
    return tags.find((t) => t.id.startsWith("urn:tag:genre:") && !t.id.startsWith("urn:tag:genre:place")) ?? undefined;
  });
  const tags = found.filter((t): t is NonNullable<typeof t> => !!t);
  return { ids: tags.map((t) => t.id), names: tags.map((t) => t.name) };
}

// ---------- who to book ----------

const LOCAL_RADIUS_M = 40_000;

const mentionsPlace = (e: QlooEntity, city: City) => {
  const words = [city.name, city.region].filter((w) => w && w.length > 2).map((w) => normName(w!));
  const text = ` ${normName(e.description ?? "")} `;
  return (
    words.some((w) => text.includes(` ${w} `)) || genreNames(e).some((g) => words.includes(normName(g)))
  );
};

/** Qloo's "artist" type also covers comedians, TV hosts and actors; a booking list wants musicians. */
const NOT_MUSIC = /^(comedy|stand ?up comedy|comedian|alternative comedy|sketch comedy|reality tv|reality tv music|actor|actress|tv personality|television|drag queen|drag performance|podcast|magician|youtuber|fictional|presenter)$/i;
export function isMusicAct(e: QlooEntity, requestedTagIds: string[]) {
  if (requestedTagIds.some((t) => /comedy|drag/.test(t))) return true;
  const genres = genreNames(e).map((g) => g.trim());
  if (genres.some((g) => /^fictional$/i.test(g))) return false;
  if (genres.slice(0, 2).some((g) => NOT_MUSIC.test(g))) return false;
  return genres.filter((g) => NOT_MUSIC.test(g)).length < Math.max(1, genres.length / 3);
}

/** Demonyms for the countries we're most likely to see; others fall back to the country name. */
const DEMONYMS: Record<string, string[]> = {
  US: ["american"], GB: ["british", "english", "scottish", "welsh", "northern irish"], IE: ["irish"],
  NG: ["nigerian", "naija"], GH: ["ghanaian"], KE: ["kenyan"], ZA: ["south african"], CA: ["canadian"],
  AU: ["australian"], NZ: ["new zealand"], BR: ["brazilian"], MX: ["mexican"], DE: ["german"], FR: ["french"],
  ES: ["spanish"], IT: ["italian"], NL: ["dutch"], SE: ["swedish"], NO: ["norwegian"], DK: ["danish"],
  JP: ["japanese"], KR: ["korean", "k pop"], IN: ["indian"], JM: ["jamaican"], CO: ["colombian"], AR: ["argentine", "argentinian"],
  PR: ["puerto rican"], PH: ["filipino"], FI: ["finnish"], PL: ["polish"], PT: ["portuguese"],
};

/** The artist's profile or genre tags tie them to this country ("a Nigerian singer", "Nigeria"). */
export function fromCountryOf(e: QlooEntity, countryName: string, code: string) {
  const words = [normName(countryName), ...(DEMONYMS[code] ?? [])];
  const text = ` ${normName(e.description ?? "")} ${genreNames(e).map(normName).join(" ")} `;
  return words.some((w) => w && text.includes(` ${w} `));
}

/** Venue-taste fit (0..1) for a fixed list of artists. */
async function fitToSignal(signal: Record<string, unknown>, ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const scored = await insightsEntities("urn:entity:artist", { ...signal, "filter.results.entities": ids }, ids.length);
  return new Map(scored.map((s) => [s.id, s.affinity ?? 0]));
}

/** The taste signal for a venue: the venue itself if Qloo knows it, otherwise the location's genre scene. */
function venueSignal(venue: ResolvedVenue, tagIds: string[]) {
  if (venue.qlooId) return { "signal.interests.entities": venue.qlooId, "signal.interests.tags": tagIds.length ? tagIds : undefined };
  return {
    "signal.location": point(venue.lat, venue.lon),
    "signal.location.radius": LOCAL_RADIUS_M,
    "signal.interests.tags": tagIds.length ? tagIds : undefined,
  };
}

export async function findBookingPicks(
  venue: ResolvedVenue,
  options: { band: SizeBand; tagIds?: string[]; take?: number; excludeIds?: string[] },
): Promise<BookingPick[]> {
  const tagIds = options.tagIds ?? [];
  const band = { "filter.popularity.min": options.band.min, "filter.popularity.max": options.band.max };
  const where = { "signal.location": point(venue.lat, venue.lon), "signal.location.radius": LOCAL_RADIUS_M };
  const signal = venueSignal(venue, tagIds);

  // three pools: what this venue's fans like; the same weighted toward the venue's area;
  // and the area's own music scene (location only), sized against local popularity
  const [taste, local, scene] = await Promise.all([
    insightsEntities("urn:entity:artist", { ...signal, ...band }, 50),
    insightsEntities("urn:entity:artist", { ...signal, ...where, ...band }, 50),
    insightsEntities("urn:entity:artist", { ...where, "signal.interests.tags": tagIds.length ? tagIds : undefined }, 50).catch(
      () => [] as QlooEntity[],
    ),
  ]);
  // Local popularity can lower the floor (so a Nigerian star at 0.92 qualifies for a big Lagos room)
  // but never raises the ceiling (Billie Eilish is still too big for a 1,550-cap room in Minneapolis).
  const [relLo, relHi] = localCutoffs(scene.map((e) => e.popularity), options.band.rel);
  const lo = Math.min(options.band.min, relLo);
  const hi = Math.min(options.band.max, relHi);
  const sceneFit = scene.filter((e) => e.popularity >= lo && e.popularity <= hi && isMusicAct(e, tagIds) && isActiveAct(e));
  const sceneIds = new Set(scene.map((e) => e.id));

  // "local draw": shows up when we weight toward the venue's area, but not on taste alone
  const tasteIds = new Set(taste.map((e) => e.id));
  const localIds = new Set([...local.filter((e) => !tasteIds.has(e.id)), ...scene].map((e) => e.id));
  const exclude = new Set(options.excludeIds ?? []);
  const pool = dedupeEntities([...taste, ...local, ...sceneFit]).filter(
    (e) => !exclude.has(e.id) && e.popularity <= hi && isMusicAct(e, tagIds) && isActiveAct(e),
  );

  const country = findCountry(venue.city.country);
  const fit = await fitToSignal(venueSignal(venue, tagIds), pool.map((e) => e.id));
  // With only a city (no venue), every act scores ~1.0 against the location, so use Qloo's own
  // order of the local scene to tell them apart.
  const sceneRank = new Map(scene.map((e, i) => [e.id, i]));
  const cityOnlyFit = (e: QlooEntity) => {
    const i = sceneRank.get(e.id);
    return i === undefined ? 0.8 : 0.98 - (0.15 * i) / Math.max(scene.length, 1);
  };
  const picks = pool
    .map((e) => {
      const f = venue.cityOnly ? cityOnlyFit(e) : (fit.get(e.id) ?? e.affinity ?? 0);
      const localDraw = localIds.has(e.id);
      const confirmedLocal = mentionsPlace(e, venue.city);
      const fromCountry = country ? fromCountryOf(e, country.name, venue.city.country) : false;
      // the local scene and the country's own acts outrank global names at similar fit
      const rank =
        f + (localDraw ? 0.02 : 0) + (sceneIds.has(e.id) ? 0.02 : 0) + (confirmedLocal ? 0.03 : 0) + (fromCountry ? 0.02 : 0);
      return { e, f, localDraw, confirmedLocal, rank };
    })
    .filter((p) => p.f > 0)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, options.take ?? 15);

  const who = venue.qlooId ? `${venue.name}'s fans` : `music fans around ${venue.city.name}`;
  return picks.map(({ e, f, localDraw, confirmedLocal }) => ({
    artist: toArtistRef(e),
    fit: Math.round(f * 100),
    localDraw,
    confirmedLocal,
    reason: [
      `${who} rate ${e.name} highly (fit ${Math.round(f * 100)})`,
      confirmedLocal ? `a local act from ${venue.city.name}` : localDraw ? `especially popular around ${venue.city.name}` : undefined,
    ]
      .filter(Boolean)
      .join("; ") + ".",
  }));
}

// ---------- local acts ----------

/** Two other big cities in the same country, to tell local acts from acts that are big everywhere. */
function referenceCities(venue: ResolvedVenue): City[] {
  return CITIES.filter((c) => c.country === venue.city.country && distanceKm(c, venue) > 150)
    .slice(0, 2); // CITIES is sorted by population
}

export async function findLocalActs(
  venue: ResolvedVenue,
  options: { tagIds?: string[]; take?: number; excludeIds?: string[]; maxPopularity?: number },
): Promise<LocalOpener[]> {
  const tagIds = options.tagIds ?? [];
  const maxPop = options.maxPopularity ?? 0.95;
  const scene = (lat: number, lon: number) =>
    insightsEntities(
      "urn:entity:artist",
      {
        "signal.location": point(lat, lon),
        "signal.location.radius": LOCAL_RADIUS_M,
        "signal.interests.entities": venue.qlooId,
        "signal.interests.tags": tagIds.length ? tagIds : undefined,
        "filter.popularity.max": maxPop,
      },
      50,
    );

  const refs = referenceCities(venue);
  const [here, ...elsewhere] = await Promise.all([scene(venue.lat, venue.lon), ...refs.map((r) => scene(r.lat, r.lon).catch(() => []))]);
  const elsewhereIds = new Set(elsewhere.flat().map((e) => e.id));
  const exclude = new Set(options.excludeIds ?? []);

  const candidates = dedupeEntities(here).filter((e) => !exclude.has(e.id) && !elsewhereIds.has(e.id) && isActiveAct(e));
  const fit = await fitToSignal(venueSignal(venue, tagIds), candidates.map((e) => e.id));

  return candidates
    .map((e) => ({ ...toArtistRef(e), fit: round(fit.get(e.id) ?? 0), confirmedLocal: mentionsPlace(e, venue.city) }))
    .filter((o) => o.fit >= 0.75)
    .sort((a, b) => b.fit + (b.confirmedLocal ? 0.05 : 0) - (a.fit + (a.confirmedLocal ? 0.05 : 0)))
    .slice(0, options.take ?? 8);
}

// ---------- double bills ----------

/**
 * Pair strong headliners with a smaller act their fans also like.
 * Support comes from the venue's picks and local acts, so every bill suits the room.
 */
export async function buildDoubleBills(
  picks: BookingPick[],
  locals: LocalOpener[],
  options: { count?: number } = {},
): Promise<DoubleBill[]> {
  const headliners = [...picks].sort((a, b) => b.artist.popularity - a.artist.popularity).slice(0, options.count ?? 4);
  const supportPool = [...picks.map((p) => p.artist), ...locals];
  const used = new Set<string>();

  const bills = await mapSettled(headliners, 4, async (h) => {
    // support must be clearly smaller than the headliner
    const smaller = supportPool.filter((s) => s.id !== h.artist.id && s.popularity <= h.artist.popularity - 0.008);
    if (!smaller.length) return undefined;
    const fit = await fitToSignal({ "signal.interests.entities": h.artist.id }, smaller.map((s) => s.id));
    const localIds = new Set(locals.map((l) => l.id));
    const ranked = smaller
      .map((s) => ({ s, f: fit.get(s.id) ?? 0, local: localIds.has(s.id) || ("confirmedLocal" in s && !!s.confirmedLocal) }))
      .filter((x) => x.f > 0)
      // a local support act is worth a little fit: it sells tickets in the room
      .sort((a, b) => b.f + (b.local ? 0.02 : 0) - (a.f + (a.local ? 0.02 : 0)));
    return { h, ranked };
  });

  const out: DoubleBill[] = [];
  for (const b of bills) {
    if (!b) continue;
    const pick = b.ranked.find((x) => !used.has(x.s.id));
    if (!pick || used.has(b.h.artist.id)) continue;
    used.add(pick.s.id);
    used.add(b.h.artist.id);
    const shared = await compare([b.h.artist.id], [pick.s.id], 15).catch(() => []);
    const sharedTaste = shared.map((t) => t.name).filter(isMusicalTaste).slice(0, 4);
    out.push({
      headliner: b.h.artist,
      support: pick.s,
      sharedTaste,
      reason: `${b.h.artist.name}'s fans also like ${pick.s.name} (fit ${Math.round(pick.f * 100)})${
        sharedTaste.length ? `; shared taste: ${sharedTaste.slice(0, 3).join(", ").toLowerCase()}` : ""
      }.`,
    });
  }
  return out;
}

/** Keep descriptive taste tags ("folk", "melodic"); drop places and filler ("united states", "diverse"). */
const FILLER = new Set(["diverse", "american", "british", "passionate", "loyal", "dedicated", "engaging", "varied", "all", "usa", "moderate", "simple"]);
function isMusicalTaste(name: string) {
  const n = normName(name);
  if (!n || n.length > 28 || FILLER.has(n)) return false;
  if (findCountry(name) && findCountry(name)!.name.toLowerCase() === n) return false;
  if (CITIES.some((c) => normName(c.name) === n && c.population > 100_000)) return false;
  return true;
}

// ---------- crowd and brands ----------

/**
 * The crowd to book for: the combined audience of the acts this venue's fans love.
 * (A venue's own demographic record in Qloo reflects everyone who engages with the place,
 * which can differ a lot from who buys tickets, so we don't lead with it.)
 */
export async function venueCrowd(_venue: ResolvedVenue, picks: BookingPick[]): Promise<Audience | undefined> {
  const pickIds = picks.slice(0, 6).map((p) => p.artist.id);
  return pickIds.length ? getAudience(pickIds, []) : undefined;
}

/** Brands the fans of the venue's best-fit acts over-index on. */
export async function venueBrands(picks: BookingPick[], take = 8): Promise<BrandMatch[]> {
  const ids = picks.slice(0, 5).map((p) => p.artist.id);
  if (!ids.length) return [];
  const brands = dedupeEntities(
    await insightsEntities("urn:entity:brand", { "signal.interests.entities": ids }, 20).catch(() => [] as QlooEntity[]),
  );
  return brands.slice(0, take).map((b) => ({
    id: b.id,
    name: b.name,
    affinity: round(b.affinity ?? 0),
    pitch: `${b.name} is one of the brands this crowd over-indexes on.`,
  }));
}

