// Core logic tests. All data here is made up: real Qloo responses must not be stored in the repo.
import { describe, expect, it } from "vitest";
import type { Heatmap, QlooEntity } from "@/lib/qloo/api";
import { countryPhrase, distanceKm, findCity, findCountry } from "@/lib/geo/cities";
import { rankCities } from "@/lib/engine/cities";
import { planRoute } from "@/lib/engine/route";
import { ageSummary, plausibleMatch } from "@/lib/engine/artist";
import { fromCountryOf, isMusicAct, localCutoffs, sizeBand, splitQuery } from "@/lib/engine/venue";
import { dedupeEntities, isActiveAct } from "@/lib/engine/util";
import { buildBookingComparison, buildComparison } from "@/lib/agent/compare";
import { ensureBrandsInBrief } from "@/lib/agent/brief";
import { validateArtistInput, validateVenueInput, PlanInputError } from "@/lib/plan";
import { planKey } from "@/lib/runPlan";

const entity = (over: Partial<QlooEntity>): QlooEntity => ({
  id: over.name ?? "x",
  name: "x",
  types: ["urn:entity:artist"],
  popularity: 0.9,
  tags: [],
  ...over,
});
const genres = (...names: string[]) => names.map((n) => ({ id: `urn:tag:genre:${n}`, name: n, type: "urn:tag:genre" }));

// ---------------------------------------------------------------------------

describe("geo", () => {
  it("finds cities with a region or country hint", () => {
    expect(findCity("Portland, ME")[0].regionCode).toBe("ME");
    expect(findCity("Portland")[0].regionCode).toBe("OR"); // the bigger Portland
    expect(findCity("Lagos")[0].country).toBe("NG");
    expect(findCity("Paris, France")[0].country).toBe("FR");
  });

  it("understands common country names", () => {
    expect(findCountry("uk")?.code).toBe("GB");
    expect(findCountry("USA")?.code).toBe("US");
    expect(findCountry("Nigeria")?.code).toBe("NG");
  });

  it("phrases country names in sentences", () => {
    expect(countryPhrase("United States")).toBe("the United States");
    expect(countryPhrase("Germany")).toBe("Germany");
  });

  it("measures distance", () => {
    const london = findCity("London, United Kingdom")[0];
    const paris = findCity("Paris, France")[0];
    expect(distanceKm(london, paris)).toBeGreaterThan(300);
    expect(distanceKm(london, paris)).toBeLessThan(380);
  });
});

// ---------------------------------------------------------------------------

describe("rankCities", () => {
  // cells listed strongest first, like Qloo's heatmap after sorting
  const cell = (lat: number, lon: number, rank: number, popularity = 0.9) => ({
    lat,
    lon,
    geohash: `${lat},${lon}`,
    affinity: rank,
    affinityRank: rank,
    popularity,
  });
  const map: Heatmap = {
    totalCells: 5000,
    cells: [
      cell(42.32, -72.63, 0.9999), // Northampton, MA
      cell(42.36, -72.52, 0.9998), // Amherst, MA (same cluster)
      cell(42.36, -71.06, 0.9997), // Boston
      cell(42.37, -71.11, 0.9996), // Cambridge (Boston metro)
      cell(42.33, -71.2, 0.9995), // Boston suburbs
      cell(45.52, -122.68, 0.999), // Portland, OR
      ...Array.from({ length: 40 }, (_, i) => cell(30 + i * 0.01, -95.36, 0.98 - i * 0.0001, 0.6)), // weak Houston area
    ],
  };

  it("names a college-town cluster after the town nearest the fans", () => {
    const labels = rankCities(map, "US").map((c) => c.label);
    expect(labels).toContain("Northampton, MA");
    expect(labels.some((l) => l.startsWith("Amherst"))).toBe(false); // merged, not a separate stop
  });

  it("merges suburbs into their metro", () => {
    const boston = rankCities(map, "US").find((c) => c.label === "Boston, MA");
    expect(boston).toBeDefined();
    expect(rankCities(map, "US").some((c) => c.label.startsWith("Cambridge"))).toBe(false);
  });

  it("ranks strong fan concentration above weak big markets", () => {
    const ranked = rankCities(map, "US");
    const northampton = ranked.findIndex((c) => c.label === "Northampton, MA");
    const houston = ranked.findIndex((c) => c.label.startsWith("Houston"));
    expect(northampton).toBeGreaterThanOrEqual(0);
    if (houston >= 0) expect(northampton).toBeLessThan(houston);
  });
});

// ---------------------------------------------------------------------------

describe("planRoute", () => {
  const stops = [
    { label: "London", lat: 51.5, lon: -0.13 },
    { label: "Leeds", lat: 53.8, lon: -1.55 },
    { label: "Glasgow", lat: 55.86, lon: -4.25 },
    { label: "Birmingham", lat: 52.48, lon: -1.9 },
    { label: "Manchester", lat: 53.48, lon: -2.24 },
  ];
  const order = (r: ReturnType<typeof planRoute>) => r.map((s) => s.cityLabel);

  it("starts at the first stop by default and visits every city once", () => {
    const r = planRoute(stops);
    expect(r[0].cityLabel).toBe("London");
    expect(new Set(order(r)).size).toBe(stops.length);
  });

  it("honours a requested finish", () => {
    expect(order(planRoute(stops, { end: 0 })).at(-1)).toBe("London");
  });

  it("honours both start and finish", () => {
    const r = order(planRoute(stops, { start: 2, end: 0 }));
    expect(r[0]).toBe("Glasgow");
    expect(r.at(-1)).toBe("London");
  });

  it("adds travel days for long legs", () => {
    const r = planRoute([
      { label: "Seattle", lat: 47.6, lon: -122.33 },
      { label: "Boston", lat: 42.36, lon: -71.06 },
    ]);
    expect(r[1].day).toBeGreaterThan(3);
  });
});

// ---------------------------------------------------------------------------

describe("artist matching and audience", () => {
  it("accepts typos and 'The' but rejects nonsense", () => {
    expect(plausibleMatch("phobe bridgers", "Phoebe Bridgers")).toBe(true);
    expect(plausibleMatch("1975", "The 1975")).toBe(true);
    expect(plausibleMatch("zzqqxxnotareal band 9", "Band of Horses")).toBe(false);
  });

  it("summarises ages, including two separate peaks", () => {
    expect(ageSummary({ "24_and_younger": 0.3, "25_to_29": 0.3, "30_to_34": 0.2, "35_to_44": -0.5 })).toBe("Mostly 18–34");
    expect(ageSummary({ "24_and_younger": 0.4, "25_to_29": -0.2, "45_to_54": 0.5, "55_and_older": 0.2 })).toBe("Mostly under 25 and 45+");
    expect(ageSummary({ "25_to_29": -0.1 })).toBe("All ages");
  });

  it("drops duplicate and cut-off names", () => {
    const out = dedupeEntities([
      entity({ id: "1", name: "Har Mar Superstar" }),
      entity({ id: "2", name: "Har" }),
      entity({ id: "3", name: "Dessa" }),
      entity({ id: "3", name: "Dessa" }),
    ]);
    expect(out.map((e) => e.name)).toEqual(["Har Mar Superstar", "Dessa"]);
  });
});

// ---------------------------------------------------------------------------

describe("venue helpers", () => {
  it("splits venue and city, with or without a comma", () => {
    expect(splitQuery("First Avenue, Minneapolis")).toEqual({ name: "First Avenue", cityHint: "Minneapolis" });
    expect(splitQuery("Hard Rock Cafe Lagos")).toEqual({ name: "Hard Rock Cafe", cityHint: "Lagos" });
    expect(splitQuery("Brixton Academy").cityHint).toBe("");
  });

  it("maps room capacity to act size", () => {
    expect(sizeBand(300).label).toMatch(/small/);
    expect(sizeBand(1550).label).toMatch(/mid-size/);
    expect(sizeBand(4900).label).toMatch(/theatre/);
    expect(sizeBand(20000).label).toMatch(/arena/);
  });

  it("sizes against the local market", () => {
    const lagos = Array.from({ length: 20 }, (_, i) => 0.5 + i * 0.023); // local stars top out ~0.94
    const [lo, hi] = localCutoffs(lagos, sizeBand(3000).rel);
    expect(lo).toBeLessThan(0.95); // a Lagos theatre can book a 0.92 local star
    expect(hi).toBe(1);
    expect(localCutoffs([0.9, 0.95], [0.5, 1])).toEqual([0, 1]); // too few to judge
  });

  it("keeps musicians and drops comedians and fictional acts", () => {
    expect(isMusicAct(entity({ tags: genres("Afrobeats", "Afropop") }), [])).toBe(true);
    expect(isMusicAct(entity({ tags: genres("Comedy", "Pop") }), [])).toBe(false);
    expect(isMusicAct(entity({ tags: genres("Pop", "Dance Pop", "Fictional") }), [])).toBe(false);
    expect(isMusicAct(entity({ tags: genres("Comedy") }), ["urn:tag:genre:comedy"])).toBe(true);
  });

  it("recognises acts from the venue's country", () => {
    expect(fromCountryOf(entity({ description: "Teni is a Nigerian singer and songwriter." }), "Nigeria", "NG")).toBe(true);
    expect(fromCountryOf(entity({ description: "An American rapper." }), "Nigeria", "NG")).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("with vs without Qloo comparison", () => {
  it("matches cities within one metro", () => {
    const fanmap = [
      { label: "Northampton, MA", lat: 42.32, lon: -72.63 },
      { label: "Brooklyn, NY", lat: 40.65, lon: -73.95 },
    ];
    const c = buildComparison({ cities: [{ city: "New York, NY", reason: "" }], reasoning: "" }, fanmap, "United States");
    expect(c.onlyFanmap).toEqual(["Northampton, MA"]);
    expect(c.headline).toBe("1 of 2 Fanmap cities don't appear in the generic AI answer.");
  });

  it("matches acts by name, ignoring case, 'The' and apostrophes", () => {
    const c = buildBookingComparison(
      { acts: [{ name: "1975", reason: "" }, { name: "Cains Band", reason: "" }], reasoning: "" },
      ["The 1975", "Cain's Band", "Prof"],
    );
    expect(c.onlyFanmap).toEqual(["Prof"]);
  });
});

// ---------------------------------------------------------------------------

describe("brief", () => {
  it("adds brand ideas when the agent only pointed at them", () => {
    const md = "## Summary\nHi\n\n## Support and partners\nOpeners: A, B. Brand ideas are listed above.\n\n## Notes\n- x";
    const out = ensureBrandsInBrief(md, [
      { name: "Fender", pitch: "guitar giveaway" },
      { name: "Polaroid", pitch: "photo booth" },
    ]);
    expect(out).toContain("- **Fender**: guitar giveaway");
    expect(out).not.toMatch(/listed above/);
    expect(out.indexOf("Fender")).toBeLessThan(out.indexOf("## Notes"));
  });

  it("leaves a brief alone when brands are already there", () => {
    const md = "## Support and partners\n- Fender: x\n- Polaroid: y";
    expect(ensureBrandsInBrief(md, [{ name: "Fender", pitch: "x" }, { name: "Polaroid", pitch: "y" }])).toBe(md);
  });
});

// ---------------------------------------------------------------------------

describe("input validation and cache keys", () => {
  it("validates and clamps artist input", () => {
    const input = validateArtistInput({ artist: "  Zach Bryan ", shows: 99, venueSize: "huge" });
    expect(input).toMatchObject({ artist: "Zach Bryan", region: "United States", shows: 20, venueSize: undefined });
    expect(() => validateArtistInput({ artist: "" })).toThrow(PlanInputError);
    expect(() => validateArtistInput({ artist: "x", region: "Atlantis Kingdom" })).toThrow(PlanInputError);
  });

  it("validates venue input", () => {
    expect(validateVenueInput({ venue: "First Avenue", capacity: "1550", genres: "indie, hip hop" })).toMatchObject({
      capacity: 1550,
      genres: ["indie", "hip hop"],
    });
    expect(() => validateVenueInput({ venue: " " })).toThrow(PlanInputError);
  });

  it("gives the same cache key regardless of case, spacing and field order", () => {
    const a = planKey({ mode: "artist", artist: "Zach  Bryan", region: "United States", shows: 7 });
    const b = planKey({ shows: 7, region: "united states", artist: "zach bryan", mode: "artist" });
    expect(a).toBe(b);
    expect(planKey({ mode: "artist", artist: "Zach Bryan", shows: 8 })).not.toBe(a);
  });
});

describe("active acts", () => {
  it("drops acts described in the past tense", () => {
    expect(isActiveAct({ description: "Test Rapper, born Jo Bloggs, was an American rapper from Ohio. He was known for x." })).toBe(false);
    expect(isActiveAct({ description: "The Testers were a Scottish indie rock band formed in 2003." })).toBe(false);
    expect(isActiveAct({ description: "Test Singer is an American singer. She was a member of a band until 2010." })).toBe(true);
    expect(isActiveAct({ description: "Test Band is a group that was formed in Leeds." })).toBe(true);
    expect(isActiveAct({})).toBe(true);
  });
});
