/**
 * Artist mode: "Where should I tour?"
 *
 * Runs the data pipeline and streams progress (PlanEvent) as it goes.
 * The AI agent (Day 3) sits on top of these same tools; this pipeline is also its fallback.
 */
import { heatmap } from "@/lib/qloo/api";
import { findCity, findCountry, distanceKm } from "@/lib/geo/cities";
import type { ArtistPlan, ArtistPlanInput, FanArea, Notice, PlanEvent, TourCity } from "@/lib/types";
import { findBrands, findOpeners, getAudience, inferVenueSize, resolveArtist } from "./artist";
import { rankCities, topShareLabel, type CityCluster, type VenueSize } from "./cities";
import { findLocalOpeners } from "./local";
import { findSpots, findVenues } from "./places";
import { planRoute } from "./route";
import { mapSettled } from "./util";

export type Emit = (event: PlanEvent) => void;

const DEFAULT_REGION = "United States";
const LIMITED_DATA_AREAS = 200;

/** Wrap a step: emits running/done/failed with timing. Returns undefined if the step fails. */
async function step<T>(emit: Emit, id: string, label: string, fn: () => Promise<T>, detail?: (v: T) => string) {
  const started = Date.now();
  emit({ type: "step", id, label, status: "running" });
  try {
    const value = await fn();
    emit({ type: "step", id, label, status: "done", ms: Date.now() - started, detail: detail?.(value) });
    return value;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: "step", id, label, status: "failed", ms: Date.now() - started, detail: message.slice(0, 200) });
    return undefined;
  }
}

/** "Phoebe Bridgers'" / "Zach Bryan's" */
export const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);

export function cityReason(c: CityCluster, countryName: string) {
  const parts = [`Fans here rank in the ${topShareLabel(c.topShare)} of all areas in ${countryName}`];
  if (c.cells >= 5) parts.push(`across ${c.cells} strong fan areas`);
  if (c.nearby.length) parts.push(`with ${c.nearby.slice(0, 2).join(" and ")} nearby`);
  return parts.join(", ") + ".";
}

export async function runArtistPlan(input: ArtistPlanInput, emit: Emit = () => {}): Promise<ArtistPlan> {
  const notices: Notice[] = [];
  const notice = (n: Notice) => {
    notices.push(n);
    emit({ type: "notice", notice: n });
  };

  const shows = Math.max(3, Math.min(input.shows ?? 10, 25));
  // ranking only filters city size when the user picked a venue size; venue choice always has a target size
  const rankingSize: VenueSize = input.venueSize ?? "any";
  const country = findCountry(input.region ?? DEFAULT_REGION);
  if (!country) throw new Error(`Unknown country or region: ${input.region}`);

  // 1. the artist
  const artist = await step(emit, "artist", `Finding ${input.artist} in Qloo`, () => resolveArtist(input.artist), (a) =>
    a ? `${a.entity.name}${a.ref.genres.length ? ` · ${a.ref.genres.slice(0, 2).join(", ")}` : ""}` : "not found",
  );
  if (!artist) throw new Error(`Couldn't find an artist called "${input.artist}".`);
  artist.notices.forEach(notice);
  emit({ type: "partial", key: "artist", value: artist.ref });
  const venueSize: VenueSize = input.venueSize && input.venueSize !== "any" ? input.venueSize : inferVenueSize(artist.entity);
  const whose = possessive(artist.entity.name);

  // 2. fan map, audience, openers and brands in parallel
  const openersPromise = findOpeners(artist);
  const [ranked, audience, openers, brands] = await Promise.all([
    step(
      emit,
      "fan_map",
      `Mapping where ${whose} fans are in ${country.name}`,
      async () => {
        const map = await heatmap(artist.signalIds, country.name);
        const cities = rankCities(map, country.code, { venueSize: rankingSize, limit: Math.max(shows + 5, 15) });
        return { map, cities };
      },
      (r) => `${r.map.totalCells.toLocaleString()} areas → ${r.cities.length} candidate cities`,
    ),
    step(emit, "audience", "Reading the audience", () => getAudience(artist.signalIds, artist.traits), (a) => a?.summary ?? "no data"),
    step(emit, "openers", "Finding support acts with the same fans", () => openersPromise, (o) =>
      o.slice(0, 3).map((x) => x.name).join(", "),
    ),
    step(
      emit,
      "brands",
      "Finding brands the fans love",
      async () => {
        const direct = await findBrands(artist.signalIds);
        if (direct.length) return direct;
        const similar = await openersPromise.catch(() => []);
        return findBrands([], similar.slice(0, 3).map((o) => o.id));
      },
      (b) => (b.length ? b.slice(0, 3).map((x) => x.name).join(", ") : "no brand data"),
    ),
  ]);

  if (!ranked || !ranked.cities.length) throw new Error(`Not enough fan data for ${artist.entity.name} in ${country.name}.`);
  const { map } = ranked;

  if (map.totalCells < LIMITED_DATA_AREAS) {
    notice({ code: "limited_data", message: `Qloo has limited data for ${country.name}, so treat this plan as a starting point.` });
  }

  const fanMap: FanArea[] = map.cells.slice(0, 300).map((c, i) => ({
    lat: c.lat,
    lon: c.lon,
    strength: Math.round((1 - i / map.totalCells) * 1e4) / 1e4,
  }));
  emit({ type: "partial", key: "fanMap", value: fanMap });
  if (audience) emit({ type: "partial", key: "audience", value: audience });
  if (openers) emit({ type: "partial", key: "openers", value: openers });
  if (brands) emit({ type: "partial", key: "brands", value: brands });

  const selected = ranked.cities.slice(0, shows);
  if (selected.length < shows) {
    notice({ code: "limited_data", message: `Only ${selected.length} cities in ${country.name} stand out for this artist.` });
  }
  emit({
    type: "partial",
    key: "candidates",
    value: selected.map((c) => ({ label: c.label, score: c.score, lat: c.lat, lon: c.lon })),
  });

  // 3. venues, spots and local openers for each city
  const [venues, spots, locals] = await Promise.all([
    step(emit, "venues", `Finding venues in ${selected.length} cities`, () =>
      mapSettled(selected, 5, (c) =>
        findVenues(artist.signalIds, c, { radiusKm: Math.min(35, 15 + c.nearby.length * 4), size: venueSize }),
      ),
      (v) => `${v.reduce((n, x) => n + (x?.length ?? 0), 0)} venues`,
    ),
    step(emit, "spots", "Finding pre- and after-show spots", () => mapSettled(selected, 5, (c) => findSpots(artist.signalIds, c))),
    step(emit, "local_openers", "Finding local opening acts", () =>
      findLocalOpeners(
        selected.map((c) => ({ key: String(c.anchor.id), lat: c.lat, lon: c.lon, name: c.anchor.name, region: c.anchor.region })),
        {
          id: artist.entity.id,
          name: artist.entity.name,
          popularity: artist.entity.popularity,
          listeners: artist.entity.listeners,
          genreTagIds: artist.genreTagIds,
          genres: artist.allGenres,
          excludeIds: (openers ?? []).map((o) => o.id),
        },
      ),
    ),
  ]);

  const cities: TourCity[] = selected.map((c, i) => ({
    rank: i + 1,
    place: {
      label: c.label,
      city: c.anchor.name,
      region: c.anchor.region || undefined,
      country: c.anchor.country,
      lat: c.lat,
      lon: c.lon,
      population: c.anchor.population,
    },
    score: c.score,
    reason: cityReason(c, country.name),
    stats: {
      topShare: topShareLabel(c.topShare),
      fanAreas: c.cells,
      marketPopulation: c.marketPopulation,
      nearby: c.nearby,
    },
    venues: venues?.[i] ?? [],
    localOpeners: locals?.get(String(c.anchor.id)) ?? [],
    spots: spots?.[i] ?? [],
  }));
  if (!venues || !spots || !locals) {
    notice({ code: "partial_result", message: "Some details couldn't be loaded; the city ranking is still complete." });
  }
  emit({ type: "partial", key: "cities", value: cities });

  // 4. route
  const route = await step(emit, "route", "Planning the route", async () => {
    let start = 0;
    if (input.startCity) {
      const from = findCity(input.startCity)[0];
      if (from) {
        start = cities.reduce((best, c, i) => (distanceKm(from, c.place) < distanceKm(from, cities[best].place) ? i : best), 0);
      }
    }
    return planRoute(cities.map((c) => ({ label: c.place.label, lat: c.place.lat, lon: c.place.lon })), start);
  }, (r) => `${r.reduce((n, s) => n + s.km, 0).toLocaleString()} km over ${(r.at(-1)?.day ?? 0) + 1} days`);
  emit({ type: "partial", key: "route", value: route ?? [] });

  const plan: ArtistPlan = {
    mode: "artist",
    input,
    artist: artist.ref,
    region: { name: country.name, code: country.code },
    audience,
    fanMap,
    cities,
    route: route ?? [],
    openers: openers ?? [],
    brands: brands ?? [],
    notices,
    generatedAt: new Date().toISOString(),
  };
  emit({ type: "result", plan });
  return plan;
}
