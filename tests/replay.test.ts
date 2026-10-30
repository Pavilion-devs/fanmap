// Replays of cached plans and the results-page basemap. All data here is made up.
import { describe, expect, it, vi } from "vitest";
import type { ArtistPlan, PlanEvent } from "@/lib/types";

// an in-memory stand-in for the plan cache, so nothing is written to ./.cache
vi.mock("@/lib/cache", () => {
  const store = new Map<string, unknown>();
  return {
    cache: { get: async (k: string) => store.get(k), set: async (k: string, v: unknown) => void store.set(k, v) },
    cacheKey: (...parts: unknown[]) => JSON.stringify(parts),
    incrementCounter: async () => 1,
  };
});

const { cache } = await import("@/lib/cache");
const { planKey, runPlan } = await import("@/lib/runPlan");
const { countryBasemap } = await import("@/lib/geo/basemap");

const input = { mode: "artist" as const, artist: "Test Act", region: "United States", shows: 2 };
const city = (label: string, lat: number, lon: number) => ({
  rank: 1,
  place: { label, city: label.split(",")[0], country: "US", lat, lon },
  score: 80,
  reason: "",
  stats: { topShare: "top 1%", fanAreas: 2, marketPopulation: 100_000, nearby: [] },
  venues: [],
  localOpeners: [],
  spots: [],
});
const plan = {
  mode: "artist",
  input,
  artist: { id: "a", name: "Test Act", genres: [], popularity: 0.5 },
  region: { name: "United States", code: "US" },
  fanMap: [{ lat: 40, lon: -74, strength: 1 }],
  cities: [city("Alpha, NY", 40, -74), city("Beta, MA", 42, -71)],
  route: [
    { order: 1, cityLabel: "Alpha, NY", km: 0, day: 0 },
    { order: 2, cityLabel: "Beta, MA", km: 300, day: 1 },
  ],
  openers: [],
  brands: [],
  notices: [],
  run: { engine: "agent", toolCalls: [], turns: 1, ms: 1000 },
  generatedAt: "2026-01-01T00:00:00.000Z",
} satisfies ArtistPlan;

const step = (tool: string, status: "running" | "done") => ({ type: "step", id: tool, label: tool, status, tool }) as PlanEvent;

describe("plan replay", () => {
  it("fills in partial results where they first arrived, for plans cached without them", async () => {
    await cache.set(planKey(input), { plan, events: [step("map_fans", "running"), step("map_fans", "done"), step("plan_route", "running"), step("plan_route", "done")] }, 60);
    const events: PlanEvent[] = [];
    const out = await runPlan(input, (e) => events.push(e));
    expect(out.cached).toBe(true);
    const order = events.map((e) => (e.type === "partial" ? `partial:${e.key}` : e.type === "step" ? `${e.tool}:${e.status}` : e.type));
    expect(order).toEqual(["map_fans:running", "map_fans:done", "partial:fanMap", "partial:candidates", "plan_route:running", "plan_route:done", "partial:route", "result"]);
    const candidates = events.find((e) => e.type === "partial" && e.key === "candidates");
    expect(candidates?.type === "partial" && candidates.value).toEqual([
      { label: "Alpha, NY", score: 80, lat: 40, lon: -74 },
      { label: "Beta, MA", score: 80, lat: 42, lon: -71 },
    ]);
    const result = events.at(-1);
    expect(result?.type === "result" && result.plan.run?.cached).toBe(true);
  });

  it("re-reads recorded partial markers from the cached plan", async () => {
    const other = { ...input, shows: 3 };
    await cache.set(planKey(other), { plan, events: [{ type: "partial", key: "route" }, { type: "partial", key: "candidates", value: [{ label: "Alpha, NY", score: 1, lat: 40, lon: -74 }] }] }, 60);
    const events: PlanEvent[] = [];
    await runPlan(other, (e) => events.push(e));
    const partials = events.filter((e) => e.type === "partial");
    expect(partials.map((e) => e.type === "partial" && e.key)).toEqual(["route", "candidates"]);
    expect(partials[0].type === "partial" && partials[0].value).toEqual(plan.route);
  });
});

describe("basemap", () => {
  it("keeps the mainland in frame", () => {
    const us = countryBasemap("US")!;
    expect(us.projection.west).toBeGreaterThan(-130); // Hawaii and Alaska trimmed
    expect(us.dots.length / 3).toBeGreaterThan(2000);
    const gb = countryBasemap("GB")!;
    expect(gb.projection.north).toBeGreaterThan(57.5); // northern Scotland kept
    expect(countryBasemap("ZZ")).toBeNull();
  });
});
