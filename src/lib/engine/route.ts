/**
 * Order tour stops into a sensible route: nearest-neighbour from the start city,
 * improved with 2-opt (untangles crossing legs), then spaced into show days.
 */
import { distanceKm } from "@/lib/geo/cities";
import type { RouteStop } from "@/lib/types";

export interface Stop {
  label: string;
  lat: number;
  lon: number;
}

/** Driving/travel per day before an extra travel day is needed. */
const KM_PER_TRAVEL_DAY = 650;
/** A day off after this many shows in a row. */
const SHOWS_BEFORE_DAY_OFF = 5;

function pathLength(order: number[], d: number[][]) {
  let total = 0;
  for (let i = 1; i < order.length; i++) total += d[order[i - 1]][order[i]];
  return total;
}

/** Shortest-ish open path starting at `start` (indices into stops). */
function openPath(stops: Stop[], start: number): number[] {
  const n = stops.length;
  const d = stops.map((a) => stops.map((b) => distanceKm(a, b)));

  // nearest neighbour
  const order = [start];
  const used = new Set(order);
  while (order.length < n) {
    const last = order[order.length - 1];
    let best = -1;
    for (let j = 0; j < n; j++) if (!used.has(j) && (best < 0 || d[last][j] < d[last][best])) best = j;
    order.push(best);
    used.add(best);
  }

  // 2-opt on an open path (start fixed)
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < n - 1; i++) {
      for (let k = i + 1; k < n; k++) {
        const candidate = [...order.slice(0, i), ...order.slice(i, k + 1).reverse(), ...order.slice(k + 1)];
        if (pathLength(candidate, d) + 1e-6 < pathLength(order, d)) {
          order.splice(0, n, ...candidate);
          improved = true;
        }
      }
    }
  }
  return order;
}

/** Show days for stops already in order. */
function scheduleDays(ordered: Stop[]): RouteStop[] {
  let day = 0;
  return ordered.map((stop, i) => {
    const km = i === 0 ? 0 : Math.round(distanceKm(ordered[i - 1], stop));
    if (i > 0) {
      day += 1 + Math.floor(km / KM_PER_TRAVEL_DAY);
      if (i % SHOWS_BEFORE_DAY_OFF === 0) day += 1;
    }
    return { order: i + 1, cityLabel: stop.label, km, day };
  });
}

/**
 * @param stops tour cities (any order)
 * @param options.start index of the stop the tour must start at (default: the first stop)
 * @param options.end index of the stop the tour must finish at (e.g. a hometown show)
 */
export function planRoute(stops: Stop[], options: { start?: number; end?: number } = {}): RouteStop[] {
  if (!stops.length) return [];
  const { start, end } = options;

  let order: number[];
  if (end !== undefined && end !== start) {
    // plan backwards from the finish, then flip
    order = openPath(stops, end).reverse();
    if (start !== undefined) order = [start, ...order.filter((i) => i !== start)];
  } else {
    order = openPath(stops, start ?? 0);
  }
  return scheduleDays(order.map((i) => stops[i]));
}
