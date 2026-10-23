/**
 * Offline world city index (GeoNames, CC BY 4.0). Server-only.
 * Used to turn Qloo heatmap cells (coordinates) into city names,
 * and to resolve city/country names the user types into coordinates.
 */
import data from "@/data/cities.json";

export interface City {
  id: number;
  name: string;
  country: string; // ISO-2 code
  countryName: string;
  region: string;
  regionCode: string;
  lat: number;
  lon: number;
  population: number;
  capital: boolean;
}

export interface Country {
  code: string;
  name: string;
  continent: string;
  population: number;
}

type Row = [string, string, string, string, number, number, number, number];

const countryMap = data.countries as Record<string, { name: string; continent: string; population: number }>;

export const COUNTRIES: Country[] = Object.entries(countryMap)
  .map(([code, c]) => ({ code, ...c }))
  .sort((a, b) => a.name.localeCompare(b.name));

export const CITIES: City[] = (data.cities as unknown as Row[]).map((r, id) => ({
  id,
  name: r[0],
  country: r[1],
  countryName: countryMap[r[1]]?.name ?? r[1],
  region: r[2],
  regionCode: r[3],
  lat: r[4],
  lon: r[5],
  population: r[6],
  capital: r[7] === 1,
}));

// ---------- distance ----------

const R_KM = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(h));
}

// ---------- spatial grid (1° cells) for fast nearest lookups ----------

const grid = new Map<string, City[]>();
const cellKey = (lat: number, lon: number) => `${Math.floor(lat)}:${Math.floor(lon)}`;
for (const city of CITIES) {
  const key = cellKey(city.lat, city.lon);
  const list = grid.get(key);
  if (list) list.push(city);
  else grid.set(key, [city]);
}

/** Cities within `radiusKm` of a point, nearest first. */
export function citiesNear(lat: number, lon: number, radiusKm: number, minPopulation = 0): (City & { km: number })[] {
  const latSpan = Math.ceil(radiusKm / 111) + 1;
  const lonSpan = Math.ceil(radiusKm / (111 * Math.max(Math.cos(rad(lat)), 0.1))) + 1;
  const out: (City & { km: number })[] = [];
  for (let dy = -latSpan; dy <= latSpan; dy++) {
    for (let dx = -lonSpan; dx <= lonSpan; dx++) {
      const list = grid.get(cellKey(lat + dy, lon + dx));
      if (!list) continue;
      for (const c of list) {
        if (c.population < minPopulation) continue;
        const km = distanceKm({ lat, lon }, c);
        if (km <= radiusKm) out.push({ ...c, km });
      }
    }
  }
  return out.sort((a, b) => a.km - b.km);
}

/**
 * The city that best represents a point: prefers bigger cities nearby over tiny ones right on top
 * (a show needs a crowd). Score = population weight that decays with distance.
 */
export function representativeCity(lat: number, lon: number, radiusKm = 40, minPopulation = 15000) {
  const near = citiesNear(lat, lon, radiusKm, minPopulation);
  if (near.length === 0) return undefined;
  let best = near[0];
  let bestScore = -Infinity;
  for (const c of near) {
    const score = Math.log10(c.population) - c.km / 15;
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

// ---------- name lookups ----------

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

export function findCountry(query: string): Country | undefined {
  const q = norm(query);
  const aliases: Record<string, string> = { usa: "US", "united states of america": "US", america: "US", uk: "GB", england: "GB", britain: "GB", "great britain": "GB" };
  const code = aliases[q] ?? (q.length === 2 ? q.toUpperCase() : undefined);
  if (code && countryMap[code]) return COUNTRIES.find((c) => c.code === code);
  return COUNTRIES.find((c) => norm(c.name) === q) ?? COUNTRIES.find((c) => norm(c.name).startsWith(q));
}

/**
 * Find cities by name, optionally with a region/country hint: "Portland, ME", "Lagos", "Paris, France".
 * Results are ordered by population, so the obvious match comes first.
 */
export function findCity(query: string, limit = 5): City[] {
  const [namePart, ...hintParts] = query.split(",").map((p) => p.trim());
  const name = norm(namePart);
  const hint = norm(hintParts.join(" "));
  if (!name) return [];

  const matches = CITIES.filter((c) => norm(c.name) === name);
  const pool = matches.length ? matches : CITIES.filter((c) => norm(c.name).startsWith(name));
  const filtered = hint
    ? pool.filter(
        (c) =>
          norm(c.regionCode) === hint ||
          norm(c.region).startsWith(hint) ||
          norm(c.country) === hint ||
          norm(c.countryName).startsWith(hint) ||
          findCountry(hint)?.code === c.country,
      )
    : pool;
  return (filtered.length ? filtered : pool).slice(0, limit); // CITIES is already sorted by population
}

/** "Portland, ME" for the US, "Edinburgh, United Kingdom" elsewhere. */
export function cityLabel(c: City) {
  if (c.country === "US" && c.regionCode) return `${c.name}, ${c.regionCode}`;
  return `${c.name}, ${c.countryName}`;
}
