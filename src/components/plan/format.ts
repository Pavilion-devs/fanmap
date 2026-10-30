import type { ArtistPlan, TourCity, VenuePlan } from "@/lib/types";

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];

export const numberWord = (n: number) => WORDS[n] ?? String(n);
export const pad2 = (n: number) => String(n).padStart(2, "0");
export const fmt = (n: number) => n.toLocaleString("en-US");
/** 0..1 affinity → "85" */
export const fit100 = (v: number) => String(Math.round(v * 100));

export function compact(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

/** "Glasgow, United Kingdom" → "Glasgow" when the whole plan is in that country. */
export const shortLabel = (label: string, country: string) => (country && label.endsWith(`, ${country}`) ? label.slice(0, -country.length - 2) : label);

export function duration(ms: number) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${pad2(s % 60)} s`;
}

/** Rows of the first markdown table under a heading that matches `heading`. */
export function briefTable(markdown: string | undefined, heading: RegExp): string[][] {
  if (!markdown) return [];
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => /^#{1,4}\s/.test(l) && heading.test(l));
  if (start < 0) return [];
  const rows: string[][] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^#{1,4}\s/.test(line)) break;
    if (!line.startsWith("|")) {
      if (rows.length) break;
      continue;
    }
    const cells = line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim().replace(/\*\*/g, ""));
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    rows.push(cells);
  }
  return rows.slice(1); // drop the header row
}

export interface Night {
  order: number;
  day: number;
  km: number;
  city: TourCity;
  /** the room and opener the brief recommends (falls back to the top data match) */
  room?: string;
  opener?: string;
}

/** The tour in route order, joined with each city's data and the brief's picks. */
export function nightsOf(plan: ArtistPlan): Night[] {
  const table = briefTable(plan.brief?.markdown, /route/i);
  const byCity = new Map(plan.cities.map((c) => [c.place.label, c]));
  const stops = plan.route.length ? plan.route : plan.cities.map((c, i) => ({ order: i + 1, cityLabel: c.place.label, km: 0, day: i }));
  return stops.flatMap((stop): Night[] => {
    const city = byCity.get(stop.cityLabel);
    if (!city) return [];
    const row = table.find((r) => r[1] && (r[1] === city.place.label || r[1].startsWith(city.place.city)));
    return [
      {
        order: stop.order,
        day: stop.day,
        km: stop.km,
        city,
        room: row?.[2] || city.venues[0]?.name,
        opener: row?.[3] || city.localOpeners[0]?.name,
      },
    ];
  });
}

/** Venue mode: the brief's shortlist with slots, or the top picks. */
export function shortlistOf(plan: VenuePlan) {
  const table = briefTable(plan.brief?.markdown, /book/i);
  if (table.length >= 3) return table.map((r) => ({ act: r[0], slot: r[2] ?? "" })).slice(0, 10);
  return plan.picks.slice(0, 10).map((p) => ({ act: p.artist.name, slot: p.confirmedLocal ? "Local" : "" }));
}

export const tierLabel = (tier?: string) => (tier === "club" ? "Club" : tier === "theatre" ? "Theatre" : tier === "arena" ? "Arena" : "Room");
