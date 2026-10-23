/**
 * Turn a Qloo fan map (thousands of small map areas) into a ranked list of tour cities.
 *
 * 1. Cluster the strongest areas into metro areas (areas within CLUSTER_KM join one cluster).
 * 2. Name each cluster after its best "anchor" city (big enough to host a show, close to the fans).
 * 3. Score clusters on: taste (how strongly fans over-index), depth (how many strong areas),
 *    market (how many people live there) and activity (Qloo popularity of the areas).
 */
import type { HeatCell, Heatmap } from "@/lib/qloo/api";
import { citiesNear, cityLabel, distanceKm, type City } from "@/lib/geo/cities";

export type VenueSize = "club" | "theatre" | "arena" | "any";

export interface CityCluster {
  anchor: City;
  label: string;
  /** other towns in the same fan cluster, e.g. Amherst next to Northampton */
  nearby: string[];
  lat: number;
  lon: number;
  /** strong fan areas (top ~3% of the country) in this metro */
  cells: number;
  /** best national rank position of any area in the cluster, 0..1 (1 = strongest) */
  bestRank: number;
  /** position of that area among all areas in the country (0 = the very top) */
  bestPosition: number;
  /** share of the country's areas that rank above this cluster's best area, e.g. 0.001 = top 0.1% */
  topShare: number;
  meanPopularity: number;
  marketPopulation: number;
  score: number;
  parts: { taste: number; depth: number; market: number; activity: number };
}

const CLUSTER_KM = 35;
const ANCHOR_RADIUS_KM = 30;

const MIN_MARKET: Record<VenueSize, number> = { club: 60_000, theatre: 200_000, arena: 800_000, any: 60_000 };
const MIN_ANCHOR_POP: Record<VenueSize, number> = { club: 20_000, theatre: 50_000, arena: 150_000, any: 20_000 };

interface RawCluster {
  lat: number;
  lon: number;
  weight: number;
  cells: HeatCell[];
  bestIndex: number;
}

function clusterCells(cells: HeatCell[]): RawCluster[] {
  const clusters: RawCluster[] = [];
  cells.forEach((cell, index) => {
    let target: RawCluster | undefined;
    let bestKm = Infinity;
    for (const c of clusters) {
      const km = distanceKm(c, cell);
      if (km < CLUSTER_KM && km < bestKm) {
        target = c;
        bestKm = km;
      }
    }
    // weight stronger areas more when moving the cluster centre
    const w = 1 + (cells.length - index) / cells.length;
    if (target) {
      target.lat = (target.lat * target.weight + cell.lat * w) / (target.weight + w);
      target.lon = (target.lon * target.weight + cell.lon * w) / (target.weight + w);
      target.weight += w;
      target.cells.push(cell);
    } else {
      clusters.push({ lat: cell.lat, lon: cell.lon, weight: w, cells: [cell], bestIndex: index });
    }
  });
  return clusters;
}

/**
 * GeoNames lists sub-areas next to the towns people actually name ("North Chicopee",
 * "Amherst Center", "South Portland Gardens"). Treat them as variants when the base town exists nearby.
 */
const VARIANT = /^(?:(?:North|South|East|West|Upper|Lower|New|Old)\s+(.+)|(.+?)\s+(?:Center|Centre|Gardens|Heights|Village|Township|Junction|Station))$/;

export function isVariantName(city: City, others: City[]) {
  const m = VARIANT.exec(city.name);
  const base = m?.[1] ?? m?.[2];
  if (!base) return false;
  return others.some((o) => o.id !== city.id && o.name === base && distanceKm(o, city) < 25);
}

/** Pick the city that names a cluster: as close to the fans as possible, but big enough to host shows. */
function pickAnchor(lat: number, lon: number, minPop: number, country: string) {
  const all = citiesNear(lat, lon, ANCHOR_RADIUS_KM, 0).filter((c) => c.country === country);
  const near = all.filter((c) => c.population >= minPop && !isVariantName(c, all));
  if (!near.length) return undefined;
  // the nearest town to the fans, unless a much bigger city is about as close
  let best = near[0];
  for (const c of near) {
    if (c.population >= 5 * best.population && c.km <= best.km * 1.5 + 5) best = c;
  }
  return { anchor: best, near };
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// ---------- metro merging ----------

const HUB_MIN_POP = 100_000;

/**
 * How far a city's metro reaches: grows with population (~18 km for 150k people, ~33 km for
 * Minneapolis, capped at 55 km for London or New York). Smaller cities don't swallow nearby
 * towns that are their own markets (Springfield vs. Northampton, 30 km apart).
 */
const metroRadiusKm = (population: number) =>
  Math.min(55, Math.max(18, 12 + 10 * Math.log2(Math.max(population, HUB_MIN_POP) / 100_000)));

/** GeoNames uses some official names people don't say. */
const DISPLAY_NAMES: Record<string, string> = {
  "Lexington-Fayette": "Lexington",
  "Louisville/Jefferson County metro government (balance)": "Louisville",
  "Nashville-Davidson": "Nashville",
  "Augusta-Richmond County": "Augusta",
  "Athens-Clarke County": "Athens",
  "Urban Honolulu": "Honolulu",
  "City of London": "London",
  "New York City": "New York",
};

/** The metro hub a point belongs to: the largest city whose metro radius covers it. */
function metroHub(lat: number, lon: number, country: string): City | undefined {
  const candidates = citiesNear(lat, lon, 60, HUB_MIN_POP).filter((c) => c.country === country);
  let hub: City | undefined;
  for (const c of candidates) {
    if (c.km <= metroRadiusKm(c.population) && (!hub || c.population > hub.population)) hub = c;
  }
  return hub;
}

function displayLabel(city: City) {
  const name = DISPLAY_NAMES[city.name];
  return name ? cityLabel({ ...city, name }) : cityLabel(city);
}

export function rankCities(
  map: Heatmap,
  countryCode: string,
  options: { venueSize?: VenueSize; limit?: number } = {},
): CityCluster[] {
  const venueSize = options.venueSize ?? "any";
  const total = Math.max(map.totalCells, map.cells.length, 1);
  const raw = clusterCells(map.cells);

  // Assign each cluster to a metro hub (big city) if it's within the hub's metro radius,
  // otherwise to the best nearby town. Clusters with the same anchor are merged.
  const groups = new Map<number, { anchor: City; parts: RawCluster[] }>();
  for (const c of raw) {
    // small-town clusters are named after the town nearest their strongest area (cells[0]),
    // not the averaged centre, which can drift toward a bigger neighbour
    const best = c.cells[0];
    const anchor =
      metroHub(c.lat, c.lon, countryCode) ?? pickAnchor(best.lat, best.lon, MIN_ANCHOR_POP[venueSize], countryCode)?.anchor;
    if (!anchor) continue;
    const group = groups.get(anchor.id);
    if (group) group.parts.push(c);
    else groups.set(anchor.id, { anchor, parts: [c] });
  }
  // "Strong" areas are the top ~3% of the country (30–300 areas). Only those count toward depth,
  // so a huge city with many lukewarm areas doesn't outrank a smaller city where fans really cluster.
  const position = new Map(map.cells.map((cell, i) => [cell, i]));
  const strongLimit = Math.max(30, Math.min(300, Math.round(total * 0.03)));

  const merged = [...groups.values()].map(({ anchor, parts }) => {
    const cells = parts.flatMap((p) => p.cells);
    return {
      anchor,
      cells,
      strong: cells.filter((cell) => (position.get(cell) ?? Infinity) < strongLimit).length,
      bestIndex: Math.min(...parts.map((p) => p.bestIndex)),
    };
  });
  const maxStrong = Math.max(...merged.map((c) => c.strong), 1);

  const results: CityCluster[] = [];
  for (const c of merged) {
    const { anchor } = c;
    const near = citiesNear(anchor.lat, anchor.lon, Math.max(ANCHOR_RADIUS_KM, metroRadiusKm(anchor.population)), 0).filter(
      (n) => n.country === countryCode,
    );

    const marketPopulation = near.reduce((sum, city) => sum + city.population, 0);
    if (marketPopulation < MIN_MARKET[venueSize]) continue;

    const bestRank = Math.max(...c.cells.map((x) => x.affinityRank));
    const meanPopularity = c.cells.reduce((s, x) => s + x.popularity, 0) / c.cells.length;
    const topShare = c.bestIndex / total;

    // taste: top 0.01% → 1, top 5% → ~0 (log scale, so differences at the very top still count)
    const taste = clamp01((Math.log10(1 / Math.max(topShare, 1e-4)) - Math.log10(20)) / (4 - Math.log10(20)));
    const depth = Math.log(1 + c.strong) / Math.log(1 + maxStrong);
    const market = clamp01((Math.log10(marketPopulation) - 4.7) / 2.3); // ~50k → 0, ~10M → 1
    const activity = clamp01((meanPopularity - 0.5) / 0.5);

    const weights =
      venueSize === "club"
        ? { taste: 0.55, depth: 0.2, market: 0.15, activity: 0.1 }
        : venueSize === "arena"
          ? { taste: 0.35, depth: 0.25, market: 0.3, activity: 0.1 }
          : { taste: 0.45, depth: 0.2, market: 0.25, activity: 0.1 };

    const score =
      100 * (weights.taste * taste + weights.depth * depth + weights.market * market + weights.activity * activity);

    results.push({
      anchor,
      label: displayLabel(anchor),
      nearby: near
        .filter((n) => n.id !== anchor.id && n.population >= 20_000 && !isVariantName(n, near) && !n.name.includes(anchor.name))
        .slice(0, 4)
        .map((n) => n.name),
      lat: anchor.lat,
      lon: anchor.lon,
      cells: c.strong,
      bestRank,
      bestPosition: c.bestIndex,
      topShare,
      meanPopularity,
      marketPopulation,
      score: Math.round(score * 10) / 10,
      parts: { taste, depth, market, activity },
    });
  }

  // Final pass: a weaker result inside a stronger result's metro area is the same tour stop.
  const kept: CityCluster[] = [];
  for (const r of results.sort((a, b) => b.score - a.score)) {
    const owner = kept.find((k) => {
      const reach = Math.max(metroRadiusKm(Math.max(k.anchor.population, r.anchor.population)), 30);
      return distanceKm(k, r) <= reach;
    });
    if (owner) {
      owner.cells += r.cells;
      if (!owner.nearby.includes(r.anchor.name) && owner.nearby.length < 6) owner.nearby.push(r.anchor.name);
      continue;
    }
    kept.push(r);
  }
  return kept.slice(0, options.limit ?? 25);
}

/** "top 0.1%" style label for how strongly fans over-index in a cluster. */
export function topShareLabel(share: number) {
  const pct = Math.max(share * 100, 0.01);
  if (pct < 0.1) return "top 0.1%";
  if (pct < 1) return `top ${pct.toFixed(1)}%`;
  return `top ${Math.ceil(pct)}%`;
}
