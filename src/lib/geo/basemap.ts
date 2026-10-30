/**
 * A dot-matrix silhouette of a country for the results map, built from the offline city index.
 * Each dot is a grid point with a city nearby, so the shape shows where people live, and it
 * works for any country without shipping map outlines. Server-only (reads the city index).
 */
import { CITIES } from "./cities";

export interface Basemap {
  /** viewBox size; x runs east, y runs south */
  width: number;
  height: number;
  /** projection: x = (lon - west) * k * scale + pad, y = (north - lat) * scale + pad */
  projection: { west: number; north: number; k: number; scale: number; pad: number };
  /** grid spacing in viewBox units, the natural dot size */
  step: number;
  /** flat [x, y, weight, ...]; weight 1..3 says how built-up the area around the dot is */
  dots: number[];
}

const WIDTH = 1000;
const PAD = 24;
const TARGET_CELLS = 15000;
const cache = new Map<string, Basemap | null>();

/** The range of the values, cutting off an outlying tail (a few percent of points) beyond a gap wider than `gap` degrees. */
function mainSpan(values: number[], gap: number): [number, number] {
  const v = [...values].sort((a, b) => a - b);
  const tail = Math.max(1, Math.floor(v.length * 0.06));
  let lo = 0;
  let hi = v.length - 1;
  // the innermost wide gap on each side marks where the mainland starts
  for (let i = 0; i < tail && i + 1 < v.length; i++) if (v[i + 1] - v[i] > gap) lo = i + 1;
  for (let i = v.length - 1; i > v.length - 1 - tail && i > 0; i--) if (v[i] - v[i - 1] > gap) hi = i - 1;
  return [v[lo], v[hi]];
}

export function countryBasemap(code: string): Basemap | null {
  const key = code.toUpperCase();
  if (cache.has(key)) return cache.get(key)!;

  const cities = CITIES.filter((c) => c.country === key);
  if (cities.length < 3) {
    cache.set(key, null);
    return null;
  }

  // drop far-flung territories (Alaska, Hawaii, Okinawa) so the mainland fills the frame
  let [west, east] = mainSpan(cities.map((c) => c.lon), 4);
  let [south, north] = mainSpan(
    cities.filter((c) => c.lon >= west && c.lon <= east).map((c) => c.lat),
    2,
  );
  const mx = Math.max((east - west) * 0.07, 0.4);
  const my = Math.max((north - south) * 0.07, 0.4);
  west -= mx;
  east += mx;
  south -= my;
  north += my;

  const k = Math.cos((((north + south) / 2) * Math.PI) / 180);
  const spanX = (east - west) * k;
  const spanY = north - south;
  const scale = (WIDTH - PAD * 2) / spanX;
  const height = Math.round(spanY * scale + PAD * 2);
  const projection = { west, north, k, scale, pad: PAD };

  // grid spacing so the whole frame has roughly TARGET_CELLS points
  const step = Math.sqrt(((WIDTH - PAD * 2) * (height - PAD * 2)) / TARGET_CELLS);
  const kmPerUnit = 111.2 / scale;
  const reachKm = Math.min(70, Math.max(9, step * kmPerUnit * 2.2));
  const reach = reachKm / kmPerUnit;

  // bucket the cities in viewBox units for a quick neighbour search
  const bucket = new Map<string, { x: number; y: number; pop: number }[]>();
  const keyOf = (x: number, y: number) => `${Math.floor(x / reach)}:${Math.floor(y / reach)}`;
  for (const c of cities) {
    if (c.lon < west || c.lon > east || c.lat < south || c.lat > north) continue;
    const x = (c.lon - west) * k * scale + PAD;
    const y = (north - c.lat) * scale + PAD;
    const list = bucket.get(keyOf(x, y)) ?? [];
    list.push({ x, y, pop: c.population });
    bucket.set(keyOf(x, y), list);
  }

  const dots: number[] = [];
  for (let y = PAD + step / 2; y < height - PAD; y += step) {
    for (let x = PAD + step / 2; x < WIDTH - PAD; x += step) {
      const bx = Math.floor(x / reach);
      const by = Math.floor(y / reach);
      let pop = 0;
      let near = false;
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          for (const c of bucket.get(`${bx + i}:${by + j}`) ?? []) {
            const d = Math.hypot(c.x - x, c.y - y);
            if (d > reach) continue;
            near = true;
            pop += c.pop * (1 - d / reach);
          }
        }
      }
      if (!near) continue;
      const weight = pop > 400_000 ? 3 : pop > 60_000 ? 2 : 1;
      dots.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10, weight);
    }
  }

  const map: Basemap = { width: WIDTH, height, projection, step: Math.round(step * 100) / 100, dots };
  cache.set(key, map);
  return map;
}
