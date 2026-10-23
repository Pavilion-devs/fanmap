/**
 * State and tool implementations for one artist-mode agent run.
 *
 * Each tool calls the Fanmap engine, keeps the full result here (for the final plan and the UI),
 * and returns a compact summary to Claude so the conversation stays small and fast.
 */
import { compare as qlooCompare, heatmap, type Heatmap } from "@/lib/qloo/api";
import { countryPhrase, findCity, findCountry, distanceKm, type Country } from "@/lib/geo/cities";
import { findBrands, findOpeners, getAudience, inferVenueSize, resolveArtist, type ResolvedArtist } from "@/lib/engine/artist";
import { rankCities, topShareLabel, type CityCluster, type VenueSize } from "@/lib/engine/cities";
import { findLocalOpeners } from "@/lib/engine/local";
import { findSpots, findVenues } from "@/lib/engine/places";
import { planRoute } from "@/lib/engine/route";
import { cityReason } from "@/lib/engine/artistPlan";
import { mapSettled, normName } from "@/lib/engine/util";
import type {
  ArtistPlan,
  ArtistPlanInput,
  Audience,
  BrandMatch,
  FanArea,
  LocalOpener,
  Notice,
  PlanEvent,
  RouteStop,
  TourCity,
  VenueMatch,
} from "@/lib/types";

type Emit = (event: PlanEvent) => void;
type Opener = ArtistPlan["openers"][number];

interface Scouted {
  venues: VenueMatch[];
  spots: VenueMatch[];
  localOpeners: LocalOpener[];
}

export interface SubmittedPlan {
  headline: string;
  cities: { label: string; reason: string }[];
  openers: string[];
  brand_pitches: { name: string; pitch: string }[];
  brief_markdown: string;
}

/** Thrown for bad tool input; the message goes back to Claude so it can correct itself. */
export class ToolInputError extends Error {}

/** The artist isn't in Qloo: nothing to plan, so the run stops and the user is told. */
export class ArtistNotFoundError extends Error {}

const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}k`);

export class ArtistSession {
  readonly notices: Notice[] = [];
  artist?: ResolvedArtist;
  country: Country;
  venueSize?: VenueSize;
  map?: Heatmap;
  candidates: CityCluster[] = [];
  audience?: Audience;
  openers: Opener[] = [];
  brands: BrandMatch[] = [];
  scouted = new Map<string, Scouted>();
  route: RouteStop[] = [];
  submitted?: SubmittedPlan;
  private routeRequest: { start: string | null; end: string | null } = { start: null, end: null };

  constructor(
    readonly input: ArtistPlanInput,
    private emit: Emit,
  ) {
    const country = findCountry(input.region ?? "United States");
    if (!country) throw new Error(`Unknown country or region: ${input.region}`);
    this.country = country;
  }

  private notice(n: Notice) {
    if (this.notices.some((x) => x.code === n.code && x.message === n.message)) return;
    this.notices.push(n);
    this.emit({ type: "notice", notice: n });
  }

  private requireArtist() {
    if (!this.artist) throw new ToolInputError("Call find_artist first.");
    return this.artist;
  }

  /** Match a city label from Claude to a candidate (exact label, then by name, then by distance). */
  private resolveCandidate(label: string): CityCluster | undefined {
    const want = normName(label);
    const exact = this.candidates.find((c) => normName(c.label) === want);
    if (exact) return exact;
    const byName = this.candidates.find((c) => normName(c.label).startsWith(normName(label.split(",")[0])));
    if (byName) return byName;
    const place = findCity(label)[0];
    if (!place) return undefined;
    const near = this.candidates
      .map((c) => ({ c, km: distanceKm(c, place) }))
      .sort((a, b) => a.km - b.km)[0];
    return near && near.km < 60 ? near.c : undefined;
  }

  // ---------------- tools ----------------

  async findArtist({ name }: { name: string }) {
    const artist = await resolveArtist(name);
    if (!artist) throw new ArtistNotFoundError(`We couldn't find an artist called "${name}". Check the spelling or try another name.`);
    this.artist = artist;
    artist.notices.forEach((n) => this.notice(n));
    this.emit({ type: "partial", key: "artist", value: artist.ref });
    return {
      name: artist.entity.name,
      genres: artist.allGenres.slice(0, 8),
      description: artist.entity.description,
      lastfm_listeners: artist.entity.listeners ?? null,
      qloo_popularity: Number(artist.entity.popularity.toFixed(3)),
      suggested_venue_size: inferVenueSize(artist.entity),
      audience_traits: artist.traits,
      notes: artist.notices.map((n) => n.message),
    };
  }

  async mapFans({ venue_size }: { venue_size: VenueSize | "auto" }) {
    const artist = this.requireArtist();
    // the ranking only filters city size when a size was chosen explicitly
    const rankingSize: VenueSize = venue_size && venue_size !== "auto" ? venue_size : (this.input.venueSize ?? "any");
    this.venueSize = rankingSize !== "any" ? rankingSize : inferVenueSize(artist.entity);
    this.map = await heatmap(artist.signalIds, this.country.name);
    this.candidates = rankCities(this.map, this.country.code, { venueSize: rankingSize, limit: 25 });
    if (this.map.totalCells < 200) {
      this.notice({ code: "limited_data", message: `Qloo has limited data for ${countryPhrase(this.country.name)}, so treat this plan as a starting point.` });
    }
    this.emit({ type: "partial", key: "fanMap", value: this.fanMap() });
    this.emit({
      type: "partial",
      key: "candidates",
      value: this.candidates.map((c) => ({ label: c.label, score: c.score, lat: c.lat, lon: c.lon })),
    });
    return {
      country: this.country.name,
      total_areas_in_country: this.map.totalCells,
      venue_size_used_for_ranking: rankingSize,
      candidates: this.candidates.map((c, i) => ({
        rank: i + 1,
        label: c.label,
        score: c.score,
        fans_rank_in: topShareLabel(c.topShare),
        strong_fan_areas: c.cells,
        metro_population: k(c.marketPopulation),
        nearby: c.nearby.slice(0, 3),
      })),
      how_to_read:
        "score 0-100 combines fan concentration (most important), number of strong fan areas, market size and activity. 'fans_rank_in: top 0.1%' means the best area there ranks in the top 0.1% of all areas in the country for this artist.",
    };
  }

  async getAudience() {
    const artist = this.requireArtist();
    this.audience = await getAudience(artist.signalIds, artist.traits);
    if (this.audience) this.emit({ type: "partial", key: "audience", value: this.audience });
    return this.audience ?? { note: "No audience data for this artist." };
  }

  async findSupportActs() {
    const artist = this.requireArtist();
    this.openers = await findOpeners(artist, 10);
    this.emit({ type: "partial", key: "openers", value: this.openers });
    return this.openers.map((o) => ({ name: o.name, fit: o.fit, smaller_than_headliner: o.smaller, genres: o.genres.slice(0, 3) }));
  }

  async findBrands() {
    const artist = this.requireArtist();
    let brands = await findBrands(artist.signalIds, [], 10);
    if (!brands.length && this.openers.length) brands = await findBrands([], this.openers.slice(0, 3).map((o) => o.id), 10);
    this.brands = brands;
    this.emit({ type: "partial", key: "brands", value: brands });
    return brands.length ? brands.map((b) => ({ name: b.name, affinity: b.affinity })) : { note: "No brand data." };
  }

  async scoutCities({ cities }: { cities: string[] }) {
    const artist = this.requireArtist();
    if (!this.candidates.length) throw new ToolInputError("Call map_fans first.");
    const picked: CityCluster[] = [];
    const unknown: string[] = [];
    for (const label of cities) {
      const c = this.resolveCandidate(label);
      if (c && !picked.includes(c)) picked.push(c);
      else if (!c) unknown.push(label);
    }
    if (!picked.length) {
      throw new ToolInputError(`None of those cities are candidates. Use labels from map_fans, e.g. ${this.candidates.slice(0, 3).map((c) => `"${c.label}"`).join(", ")}.`);
    }

    // local openers are compared across every city we know about, so include already-scouted ones
    const allForLocals = [...new Set([...picked, ...this.candidates.filter((c) => this.scouted.has(c.label))])];
    const [venues, spots, locals] = await Promise.all([
      mapSettled(picked, 5, (c) =>
        findVenues(artist.signalIds, c, { radiusKm: Math.min(35, 15 + c.nearby.length * 4), size: this.venueSize ?? "any" }),
      ),
      mapSettled(picked, 5, (c) => findSpots(artist.signalIds, c)),
      findLocalOpeners(
        allForLocals.map((c) => ({ key: c.label, lat: c.lat, lon: c.lon, name: c.anchor.name, region: c.anchor.region })),
        {
          id: artist.entity.id,
          name: artist.entity.name,
          popularity: artist.entity.popularity,
          listeners: artist.entity.listeners,
          genreTagIds: artist.genreTagIds,
          genres: artist.allGenres,
          excludeIds: this.openers.map((o) => o.id),
        },
      ).catch(() => new Map<string, LocalOpener[]>()),
    ]);

    picked.forEach((c, i) =>
      this.scouted.set(c.label, { venues: venues[i] ?? [], spots: spots[i] ?? [], localOpeners: locals.get(c.label) ?? [] }),
    );

    return {
      cities: picked.map((c) => {
        const s = this.scouted.get(c.label)!;
        return {
          label: c.label,
          venues: s.venues.map((v) => ({ name: v.name, category: v.category, size: v.tier, fan_fit: v.affinity })),
          local_openers: s.localOpeners.map((o) => ({ name: o.name, fit: o.fit, confirmed_local: o.confirmedLocal, genres: o.genres.slice(0, 2) })),
          pre_and_after_show_spots: s.spots.map((p) => `${p.name} (${p.category})`),
        };
      }),
      not_found: unknown.length ? unknown : undefined,
    };
  }

  async compareArtists({ other_artist }: { other_artist: string }) {
    const artist = this.requireArtist();
    const other = await resolveArtist(other_artist);
    if (!other) throw new ToolInputError(`No artist called "${other_artist}" in Qloo.`);
    const shared = await qlooCompare([artist.entity.id], [other.entity.id], 12);
    return {
      artists: [artist.entity.name, other.entity.name],
      shared_taste: shared.map((t) => t.name),
      other_artist_genres: other.allGenres.slice(0, 5),
    };
  }

  async planRoute({ cities, start_city, end_city }: { cities: string[]; start_city: string | null; end_city: string | null }) {
    const picked = cities.map((l) => this.resolveCandidate(l)).filter((c): c is CityCluster => !!c);
    if (picked.length < 2) throw new ToolInputError("Give at least two candidate city labels from map_fans.");
    // the stop nearest a named city (it may be a candidate label or any city name)
    const nearestTo = (name: string | null) => {
      const place = name ? (this.resolveCandidate(name) ?? findCity(name)[0]) : undefined;
      if (!place) return undefined;
      return picked.reduce((best, c, i) => (distanceKm(place, c) < distanceKm(place, picked[best]) ? i : best), 0);
    };
    this.routeRequest = { start: start_city, end: end_city };
    this.route = planRoute(picked.map((c) => ({ label: c.label, lat: c.lat, lon: c.lon })), {
      start: nearestTo(start_city),
      end: nearestTo(end_city),
    });
    this.emit({ type: "partial", key: "route", value: this.route });
    return {
      stops: this.route.map((s) => ({ day: s.day + 1, city: s.cityLabel, km_from_previous: s.km })),
      total_km: this.route.reduce((n, s) => n + s.km, 0),
      days: (this.route.at(-1)?.day ?? 0) + 1,
    };
  }

  async submitPlan(plan: SubmittedPlan) {
    this.requireArtist();
    const unknown = plan.cities.filter((c) => !this.resolveCandidate(c.label)).map((c) => c.label);
    if (unknown.length) throw new ToolInputError(`Not candidate cities: ${unknown.join(", ")}. Use labels from map_fans.`);
    if (!plan.cities.length) throw new ToolInputError("The plan needs at least one city.");
    this.submitted = plan;
    return { ok: true };
  }

  // ---------------- assembling the plan ----------------

  fanMap(): FanArea[] {
    if (!this.map) return [];
    const total = this.map.totalCells;
    return this.map.cells.slice(0, 300).map((c, i) => ({ lat: c.lat, lon: c.lon, strength: Math.round((1 - i / total) * 1e4) / 1e4 }));
  }

  /** Make sure every chosen city has venue/opener details, even if the agent skipped scouting some. */
  async ensureScouted(labels: string[]) {
    const missing = labels.filter((l) => {
      const c = this.resolveCandidate(l);
      return c && !this.scouted.has(c.label);
    });
    if (missing.length) await this.scoutCities({ cities: missing });
  }

  /**
   * The brief must stand on its own: if the agent pointed at brand ideas instead of listing them,
   * put the bullets into the "Support and partners" section.
   */
  private briefWithBrands(markdown: string, pitches: { name: string; pitch: string }[]) {
    const mentioned = pitches.filter((p) => markdown.toLowerCase().includes(p.name.toLowerCase())).length;
    if (!pitches.length || mentioned >= Math.ceil(pitches.length / 2)) return markdown;
    const bullets = pitches.map((p) => `- **${p.name}**: ${p.pitch}`).join("\n");
    const lines = markdown.split("\n").filter((l) => !/brand (ideas|pitches|partnership ideas)[^.]*\b(above|below|separately)\b/i.test(l));
    const start = lines.findIndex((l) => /^##\s+support and partners/i.test(l));
    if (start < 0) return `${lines.join("\n")}\n\n## Brand partners\n${bullets}`;
    const next = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
    const at = next < 0 ? lines.length : next;
    lines.splice(at, 0, "", "Brand partnership ideas:", bullets, "");
    return lines.join("\n").replace(/\n{3,}/g, "\n\n");
  }

  /** Start/end indices for a rebuilt route, from what the agent asked for (or the user's start city). */
  private routeEnds(cities: TourCity[]) {
    const index = (name: string | null | undefined) => {
      const place = name ? (this.resolveCandidate(name) ?? findCity(name)[0]) : undefined;
      if (!place) return undefined;
      return cities.reduce((best, c, i) => (distanceKm(place, c.place) < distanceKm(place, cities[best].place) ? i : best), 0);
    };
    return { start: index(this.routeRequest.start ?? this.input.startCity), end: index(this.routeRequest.end) };
  }

  buildPlan(): ArtistPlan {
    const artist = this.requireArtist();
    const chosen = this.submitted?.cities ?? this.candidates.slice(0, this.input.shows ?? 10).map((c) => ({ label: c.label, reason: "" }));

    const cities: TourCity[] = [];
    for (const pick of chosen) {
      const c = this.resolveCandidate(pick.label);
      if (!c || cities.some((x) => x.place.label === c.label)) continue;
      const s = this.scouted.get(c.label);
      cities.push({
        rank: cities.length + 1,
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
        reason: pick.reason || cityReason(c, this.country.name),
        stats: { topShare: topShareLabel(c.topShare), fanAreas: c.cells, marketPopulation: c.marketPopulation, nearby: c.nearby },
        venues: s?.venues ?? [],
        localOpeners: s?.localOpeners ?? [],
        spots: s?.spots ?? [],
      });
    }

    // keep the route in sync with the final city list
    const routeLabels = new Set(this.route.map((r) => r.cityLabel));
    const sameCities = cities.length === routeLabels.size && cities.every((c) => routeLabels.has(c.place.label));
    const route = sameCities
      ? this.route
      : planRoute(cities.map((c) => ({ label: c.place.label, lat: c.place.lat, lon: c.place.lon })), this.routeEnds(cities));

    // openers: the agent's picks first (in its order), then the rest
    const pickedOpeners = (this.submitted?.openers ?? [])
      .map((name) => this.openers.find((o) => normName(o.name) === normName(name)))
      .filter((o): o is Opener => !!o);
    const openers = [...pickedOpeners, ...this.openers.filter((o) => !pickedOpeners.includes(o))];

    // brands: use the agent's pitch where it wrote one
    const pitches = new Map((this.submitted?.brand_pitches ?? []).map((b) => [normName(b.name), b.pitch]));
    const brands = this.brands
      .map((b) => ({ ...b, pitch: pitches.get(normName(b.name)) ?? b.pitch }))
      .sort((a, b) => Number(pitches.has(normName(b.name))) - Number(pitches.has(normName(a.name))));

    return {
      mode: "artist",
      input: this.input,
      artist: artist.ref,
      region: { name: this.country.name, code: this.country.code },
      audience: this.audience,
      fanMap: this.fanMap(),
      cities,
      route,
      openers,
      brands,
      headline: this.submitted?.headline,
      brief: this.submitted?.brief_markdown
        ? {
            title: `${artist.entity.name}: ${this.country.name} tour brief`,
            markdown: this.briefWithBrands(this.submitted.brief_markdown, this.submitted.brand_pitches),
          }
        : undefined,
      notices: this.notices,
      generatedAt: new Date().toISOString(),
    };
  }
}
