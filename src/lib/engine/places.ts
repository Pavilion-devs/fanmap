/**
 * Venues and pre/after-show spots near a city, ranked by how much the artist's fans like them.
 * Qloo's place categories (primary_genre) tell us what kind of place each one is.
 */
import { insightsEntities, point, type QlooEntity } from "@/lib/qloo/api";
import type { VenueMatch } from "@/lib/types";
import type { VenueSize } from "./cities";
import { dedupeEntities, round } from "./util";

type Tier = "club" | "theatre" | "arena";

/** Venue categories (last part of Qloo's urn:tag:genre:place:… id) and their rough size. */
const VENUE_TIERS: Record<string, Tier> = {
  live_music_venue: "club",
  jazz_club: "club",
  musical_club: "club",
  night_club: "club",
  concert_hall: "theatre",
  event_venue: "theatre",
  hall: "theatre",
  theater: "theatre",
  performing_arts_theater: "theatre",
  opera_house: "theatre",
  auditorium: "theatre",
  amphitheater: "arena",
  arena: "arena",
  stadium: "arena",
};

/** Tags used to bias the Qloo query toward performance venues (results are re-checked below). */
const VENUE_TAGS = [
  "urn:tag:genre:place:live_music_venue",
  "urn:tag:genre:place:concert_hall",
  "urn:tag:genre:place:event_venue",
  "urn:tag:genre:place:jazz_club",
  "urn:tag:genre:place:amphitheater",
  "urn:tag:genre:place:arena",
];

const SIZE_TAGS: Record<"arena" | "theatre", string[]> = {
  arena: ["urn:tag:genre:place:arena", "urn:tag:genre:place:stadium", "urn:tag:genre:place:amphitheater"],
  theatre: ["urn:tag:genre:place:concert_hall", "urn:tag:genre:place:live_music_venue", "urn:tag:genre:place:theater_company"],
};

/** Words in Qloo place categories that make a good pre- or after-show spot. */
const AFTER_SHOW = /\b(bar|pub|brewery|brewpub|taproom|cocktail|wine bar|beer|night ?club|karaoke|tavern|speakeasy)\b/i;
const PRE_SHOW = /\b(restaurant|cafe|café|coffee|roastery|bakery|record|vinyl|book ?store|bookshop|diner|pizza|pizzeria|taco|taqueria|food|ramen|deli|tea|noodle|burger|bistro|brunch|dumpling|sandwich|thrift|vintage)\b/i;
const SKIP_SPOT = /\b(hotel|motel|inn|resort|school|college|university|church|clinic|hospital|bank|museum|park|farm|club house|golf|country club|wedding|banquet|office)\b/i;

const categoryKey = (e: QlooEntity) => e.category?.id.split(":").pop() ?? "";

function venueTier(e: QlooEntity): Tier | undefined {
  return VENUE_TIERS[categoryKey(e)];
}

function toVenue(e: QlooEntity, kind: VenueMatch["kind"], tier?: Tier): VenueMatch {
  return {
    id: e.id,
    name: e.name,
    address: e.address,
    lat: e.location?.lat,
    lon: e.location?.lon,
    kind,
    category: e.category?.name,
    tier,
    affinity: round(e.affinity ?? 0, 3),
    distanceKm: e.distance !== undefined ? round(e.distance / 1000, 1) : undefined,
    website: e.website,
    source: "qloo",
  };
}

const TIER_ORDER: Tier[] = ["club", "theatre", "arena"];

/** Dedicated music venues beat generic event spaces and theatres at similar fan fit. */
const CATEGORY_BONUS: Record<string, number> = {
  live_music_venue: 0.03,
  jazz_club: 0.01,
  musical_club: 0.02,
  concert_hall: 0.01,
  amphitheater: 0.01,
  arena: 0.005,
  performing_arts_theater: 0,
  theater: 0,
  event_venue: -0.03,
  hall: -0.03,
};

/** Places tagged as venues that aren't really places to put on a show. */
const NOT_A_SHOW_VENUE = /\b(banquet|banqueting|wedding|conference|golf|church|chapel|mansion|manor|estate|barn|farm|hotel|ballroom at the|country club|marquee hire)\b/i;

/** Performance venues near a point, best fan match first; the requested size is preferred. */
export async function findVenues(
  signalIds: string[],
  at: { lat: number; lon: number },
  options: { radiusKm?: number; size?: VenueSize; take?: number } = {},
): Promise<VenueMatch[]> {
  const size = options.size ?? "any";
  const query = (tags: string[], radiusKm: number, take: number) =>
    insightsEntities(
      "urn:entity:place",
      {
        "signal.interests.entities": signalIds,
        "filter.location": point(at.lat, at.lon),
        "filter.location.radius": Math.round(radiusKm * 1000),
        "filter.tags": tags,
      },
      take,
    );

  // Big rooms are rare and rarely "taste-matched" to the top, so an arena/theatre tour gets
  // its own search for rooms of that size (a little wider, since arenas sit outside centres).
  const radius = options.radiusKm ?? 25;
  const [general, sized] = await Promise.all([
    query(VENUE_TAGS, radius, 40),
    size === "arena" || size === "theatre" ? query(SIZE_TAGS[size], radius + 10, 20).catch(() => []) : Promise.resolve([]),
  ]);
  const places = [...general, ...sized];
  const score = (p: QlooEntity) => {
    const key = categoryKey(p);
    let s = p.affinity ?? 0;
    s += CATEGORY_BONUS[key] ?? 0;
    // well-known venues (high Qloo popularity) are usually the real music rooms
    s += 0.03 * (p.popularity ?? 0);
    const tier = venueTier(p);
    if (size !== "any" && tier) s -= 0.015 * Math.abs(TIER_ORDER.indexOf(tier) - TIER_ORDER.indexOf(size));
    return s;
  };

  return dedupeEntities(places.filter((p) => !p.closed && venueTier(p) && !NOT_A_SHOW_VENUE.test(p.name)))
    .sort((a, b) => score(b) - score(a))
    .slice(0, options.take ?? 4)
    .map((p) => toVenue(p, "performance", venueTier(p)));
}

/** Bars, cafés, record shops etc. the fans like, near the venue area. */
export async function findSpots(
  signalIds: string[],
  at: { lat: number; lon: number },
  options: { radiusKm?: number; take?: number } = {},
): Promise<VenueMatch[]> {
  const places = await insightsEntities(
    "urn:entity:place",
    {
      "signal.interests.entities": signalIds,
      "filter.location": point(at.lat, at.lon),
      "filter.location.radius": Math.round((options.radiusKm ?? 8) * 1000),
    },
    80,
  );

  const spots: VenueMatch[] = [];
  for (const p of dedupeEntities(places)) {
    if (p.closed || venueTier(p)) continue;
    const cat = p.category?.name ?? "";
    if (!cat || SKIP_SPOT.test(cat)) continue;
    if (AFTER_SHOW.test(cat)) spots.push(toVenue(p, "after_show"));
    else if (PRE_SHOW.test(cat)) spots.push(toVenue(p, "pre_show"));
  }

  // a mix: up to 2 of each kind, best first
  const take = options.take ?? 4;
  const pre = spots.filter((s) => s.kind === "pre_show").slice(0, Math.ceil(take / 2));
  const after = spots.filter((s) => s.kind === "after_show").slice(0, Math.ceil(take / 2));
  return [...pre, ...after].sort((a, b) => b.affinity - a.affinity).slice(0, take);
}
