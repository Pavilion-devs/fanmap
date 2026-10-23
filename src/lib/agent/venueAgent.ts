/**
 * Venue mode, agent version: "Who should I book?"
 *
 * Claude finds the venue, pulls the acts its fans love (sized to the room), the local scene,
 * the crowd and brands, builds double bills, then writes a booking plan and brief.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { compare as qlooCompare } from "@/lib/qloo/api";
import { resolveArtist } from "@/lib/engine/artist";
import {
  buildDoubleBills,
  findBookingPicks,
  findLocalActs,
  genreTagIds,
  resolveVenue,
  sizeBand,
  venueBrands,
  venueCrowd,
  type ResolvedVenue,
  type SizeBand,
} from "@/lib/engine/venue";
import { normName } from "@/lib/engine/util";
import type { Audience, BookingPick, BrandMatch, DoubleBill, LocalOpener, Notice, PlanEvent, VenuePlan, VenuePlanInput } from "@/lib/types";
import { FatalToolError, ToolInputError, runAgentLoop } from "./loop";

type Emit = (event: PlanEvent) => void;
type Tool = Anthropic.Beta.BetaTool;

export class VenueNotFoundAgentError extends FatalToolError {}

interface SubmittedBooking {
  headline: string;
  picks: { name: string; reason: string }[];
  double_bills: { headliner: string; support: string; pitch: string }[];
  local_acts: string[];
  brand_pitches: { name: string; pitch: string }[];
  brief_markdown: string;
}

class VenueSession {
  readonly notices: Notice[] = [];
  venue?: ResolvedVenue;
  band: SizeBand;
  tagIds: string[] = [];
  genreNames: string[] = [];
  picks: BookingPick[] = [];
  locals: LocalOpener[] = [];
  crowd?: Audience;
  brands: BrandMatch[] = [];
  bills: DoubleBill[] = [];
  submitted?: SubmittedBooking;

  constructor(
    readonly input: VenuePlanInput,
    private emit: Emit,
  ) {
    this.band = sizeBand(input.capacity);
  }

  private notice(n: Notice) {
    this.notices.push(n);
    this.emit({ type: "notice", notice: n });
  }

  private requireVenue() {
    if (!this.venue) throw new ToolInputError("Call find_venue first.");
    return this.venue;
  }

  private findArtist(name: string) {
    const n = normName(name);
    return [...this.picks.map((p) => p.artist), ...this.locals].find((a) => normName(a.name) === n);
  }

  async findVenue({ query }: { query: string }) {
    const venue = await resolveVenue(query);
    if (!venue) throw new VenueNotFoundAgentError(`We couldn't find a venue or city called "${query}".`);
    this.venue = venue;
    if (venue.cityOnly) {
      this.notice({
        code: "ambiguous_input",
        message: `We couldn't find that exact venue in Qloo, so this plan uses the music scene around ${venue.city.name}.`,
      });
    }
    const tags = await genreTagIds(this.input.genres);
    this.tagIds = tags.ids;
    this.genreNames = tags.names;
    this.emit({ type: "partial", key: "venue", value: { name: venue.name, place: venue.place, qlooId: venue.qlooId, category: venue.category } });
    return {
      name: venue.name,
      category: venue.category ?? null,
      address: venue.address ?? null,
      city: venue.place.label,
      known_to_qloo: !venue.cityOnly,
      room_size: this.band.label,
      genres_requested: this.genreNames,
    };
  }

  async findActs({ capacity, genre_focus }: { capacity: number | null; genre_focus: string[] }) {
    const venue = this.requireVenue();
    if (capacity) this.band = sizeBand(capacity);
    let tagIds = this.tagIds;
    if (genre_focus.length) tagIds = (await genreTagIds(genre_focus)).ids;
    const found = await findBookingPicks(venue, { band: this.band, tagIds, take: 15 });
    // keep earlier finds too, so a second, genre-focused call adds to the pool
    const known = new Set(this.picks.map((p) => p.artist.id));
    this.picks = [...this.picks, ...found.filter((p) => !known.has(p.artist.id))];
    this.emit({ type: "partial", key: "picks", value: this.picks });
    return {
      room_size: this.band.label,
      acts: found.map((p) => ({
        name: p.artist.name,
        fit: p.fit,
        size: p.artist.popularity >= 0.985 ? "big" : p.artist.popularity >= 0.95 ? "mid" : "small",
        genres: p.artist.genres.slice(0, 3),
        local_draw: p.localDraw,
        confirmed_local: p.confirmedLocal,
      })),
      how_to_read: "fit 0-100 = how much this venue's fans like the act. local_draw = rises when we weight toward the venue's area. confirmed_local = the act's profile names this city.",
    };
  }

  async findLocalActs() {
    const venue = this.requireVenue();
    this.locals = await findLocalActs(venue, { tagIds: this.tagIds, excludeIds: this.picks.map((p) => p.artist.id) });
    this.emit({ type: "partial", key: "localOpeners", value: this.locals });
    return this.locals.length
      ? this.locals.map((l) => ({ name: l.name, fit: l.fit, confirmed_local: l.confirmedLocal, genres: l.genres.slice(0, 3) }))
      : { note: "No local acts stood out from the national picture." };
  }

  async getCrowd() {
    const venue = this.requireVenue();
    if (!this.picks.length) throw new ToolInputError("Call find_acts first: the crowd is read from the acts this venue's fans love.");
    this.crowd = await venueCrowd(venue, this.picks);
    if (this.crowd) this.emit({ type: "partial", key: "crowd", value: this.crowd });
    return this.crowd ?? { note: "No audience data." };
  }

  async findBrands() {
    if (!this.picks.length) throw new ToolInputError("Call find_acts first.");
    this.brands = await venueBrands(this.picks, 10);
    this.emit({ type: "partial", key: "brands", value: this.brands });
    return this.brands.map((b) => ({ name: b.name, affinity: b.affinity }));
  }

  async buildDoubleBills({ headliners }: { headliners: string[] }) {
    if (!this.picks.length) throw new ToolInputError("Call find_acts first.");
    const chosen = headliners.length
      ? this.picks.filter((p) => headliners.some((h) => normName(h) === normName(p.artist.name)))
      : this.picks;
    this.bills = await buildDoubleBills(chosen.length ? chosen : this.picks, this.locals, { count: Math.max(4, headliners.length) });
    this.emit({ type: "partial", key: "doubleBills", value: this.bills });
    return this.bills.map((b) => ({ headliner: b.headliner.name, support: b.support.name, shared_taste: b.sharedTaste }));
  }

  async compareArtists({ a, b }: { a: string; b: string }) {
    const [x, y] = await Promise.all([resolveArtist(a), resolveArtist(b)]);
    if (!x || !y) throw new ToolInputError(`Couldn't find ${!x ? a : b} in Qloo.`);
    const shared = await qlooCompare([x.entity.id], [y.entity.id], 12);
    return { artists: [x.entity.name, y.entity.name], shared_taste: shared.map((t) => t.name) };
  }

  async submit(plan: SubmittedBooking) {
    this.requireVenue();
    const unknown = plan.picks.filter((p) => !this.findArtist(p.name)).map((p) => p.name);
    if (unknown.length) throw new ToolInputError(`Not in the acts found: ${unknown.join(", ")}. Only use names from find_acts or find_local_acts.`);
    if (!plan.picks.length) throw new ToolInputError("The plan needs at least one act.");
    this.submitted = plan;
    return { ok: true };
  }

  buildPlan(): VenuePlan {
    const venue = this.requireVenue();
    const sub = this.submitted;

    // the agent's picks first, in its order, with its reasons
    const chosen: BookingPick[] = [];
    for (const p of sub?.picks ?? []) {
      const pick = this.picks.find((x) => normName(x.artist.name) === normName(p.name));
      const local = this.locals.find((x) => normName(x.name) === normName(p.name));
      if (pick) chosen.push({ ...pick, reason: p.reason || pick.reason });
      else if (local)
        chosen.push({ artist: local, fit: Math.round(local.fit * 100), localDraw: true, confirmedLocal: local.confirmedLocal, reason: p.reason });
    }
    const rest = this.picks.filter((p) => !chosen.some((c) => c.artist.id === p.artist.id));
    const picks = [...chosen, ...rest];

    // double bills: the agent's pairings where we know both acts, with its pitch; otherwise the computed ones
    const bills: DoubleBill[] = [];
    for (const b of sub?.double_bills ?? []) {
      const h = this.findArtist(b.headliner);
      const s = this.findArtist(b.support);
      if (!h || !s) continue;
      const known = this.bills.find((x) => x.headliner.id === h.id && x.support.id === s.id);
      bills.push({ headliner: h, support: s, sharedTaste: known?.sharedTaste ?? [], reason: b.pitch });
    }

    const localOrder = (sub?.local_acts ?? []).map(normName);
    const locals = [...this.locals].sort((a, b) => {
      const ia = localOrder.indexOf(normName(a.name));
      const ib = localOrder.indexOf(normName(b.name));
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

    const pitches = new Map((sub?.brand_pitches ?? []).map((b) => [normName(b.name), b.pitch]));
    const brands = this.brands
      .map((b) => ({ ...b, pitch: pitches.get(normName(b.name)) ?? b.pitch }))
      .sort((a, b) => Number(pitches.has(normName(b.name))) - Number(pitches.has(normName(a.name))));

    return {
      mode: "venue",
      input: this.input,
      venue: { name: venue.name, place: venue.place, qlooId: venue.qlooId, category: venue.category, address: venue.address, image: venue.image },
      sizeBand: this.band.label,
      crowd: this.crowd,
      picks,
      localOpeners: locals,
      doubleBills: bills.length ? bills : this.bills,
      brands,
      headline: sub?.headline,
      brief: sub?.brief_markdown ? { title: `${venue.name}: booking brief`, markdown: sub.brief_markdown } : undefined,
      notices: this.notices,
      generatedAt: new Date().toISOString(),
    };
  }
}

// ---------------- tools ----------------

const obj = (properties: Record<string, unknown>) => ({
  type: "object" as const,
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const VENUE_TOOLS: Tool[] = [
  {
    name: "find_venue",
    description: "Look up the venue in Qloo (or fall back to the city's music scene). Call this first.",
    strict: true,
    input_schema: obj({ query: { type: "string", description: "Venue and city as the user wrote it" } }),
  },
  {
    name: "find_acts",
    description:
      "Acts this venue's fans love (Qloo taste data), sized to the room. Returns fit 0-100, size, genres and local flags. Call again with genre_focus to explore a specific lane (e.g. the user wants more hip hop nights); results accumulate.",
    strict: true,
    input_schema: obj({
      capacity: { type: ["integer", "null"], description: "Room capacity if the user gave one; null otherwise" },
      genre_focus: { type: "array", items: { type: "string" }, description: "Genres to focus on, or [] for the venue's natural taste" },
    }),
  },
  {
    name: "find_local_acts",
    description: "Smaller acts unusually popular around the venue (not just big everywhere) that its fans would like. Good openers and local nights.",
    strict: true,
    input_schema: obj({}),
  },
  {
    name: "get_crowd",
    description: "Age and gender lean of the crowd this venue's taste attracts.",
    strict: true,
    input_schema: obj({}),
  },
  {
    name: "find_brands",
    description: "Brands this crowd over-indexes on, for sponsorship and partnership ideas.",
    strict: true,
    input_schema: obj({}),
  },
  {
    name: "build_double_bills",
    description:
      "Pair headliners with a clearly smaller support act their fans also like (local acts preferred). Pass headliner names from find_acts, or [] to let it choose.",
    strict: true,
    input_schema: obj({ headliners: { type: "array", items: { type: "string" } } }),
  },
  {
    name: "compare_artists",
    description: "Shared taste between two artists (Qloo compare), e.g. to check a pairing the user suggests.",
    strict: true,
    input_schema: obj({ a: { type: "string" }, b: { type: "string" } }),
  },
  {
    name: "submit_booking_plan",
    description: "Submit the final booking plan. Call exactly once, at the end.",
    strict: true,
    input_schema: obj({
      headline: { type: "string", description: "One sentence: the key insight about what this venue's crowd wants (max ~25 words)." },
      picks: {
        type: "array",
        description: "8-12 acts to book, best first, only names from find_acts or find_local_acts",
        items: obj({ name: { type: "string" }, reason: { type: "string", description: "1 sentence citing the data" } }),
      },
      double_bills: {
        type: "array",
        description: "2-4 bills, using names from the tools",
        items: obj({ headliner: { type: "string" }, support: { type: "string" }, pitch: { type: "string", description: "1 sentence: why this bill works" } }),
      },
      local_acts: { type: "array", items: { type: "string" }, description: "Local acts to prioritise, best first" },
      brand_pitches: {
        type: "array",
        items: obj({ name: { type: "string" }, pitch: { type: "string" } }),
        description: "3-5 brands with a concrete partnership idea each",
      },
      brief_markdown: { type: "string", description: "The booking brief in Markdown (see system prompt)." },
    }),
  },
];

const SYSTEM = `You are Fanmap's booking agent. You help venue owners, talent buyers and small promoters decide who to book, using Qloo's taste data: which artists this specific venue's fans love, which acts are unusually strong in its area, and what this crowd is into.

Your value is real data instead of guessing. A generic answer is a list of famous names in the right genre; your job is to find the acts this room's crowd actually loves, sized to the room, including local acts a booker might overlook, and to explain each pick with evidence.

How to work:
1. Call find_venue first.
2. Then in parallel: find_acts (with the capacity the user gave, and any genres they asked for) and find_local_acts.
3. Then in parallel: get_crowd, find_brands, build_double_bills.
4. If the user's notes ask for a lane the first results don't cover (e.g. "more hip hop nights"), call find_acts again with that genre_focus.
5. Call submit_booking_plan.
Run independent tool calls in parallel. Before a tool call, write at most one short sentence on what you found or what you're checking next; the user sees these live.

Rules:
- Only use acts, numbers and brands that appear in tool results. Never invent them.
- Size matters: suggest acts that can fill this room but won't outgrow it. If no capacity was given, say what size you assumed.
- Mix proven draws with local acts and a couple of rising smaller names.
- Follow the user's notes; if the data doesn't support a wish, say so in the brief.

The brief (brief_markdown) is for the venue's booker. Markdown, about 350-500 words, no emojis, with these sections:
## Summary - 2-3 sentences: who this crowd is and the key insight.
## Who to book - a table: Act | Why | Slot (headliner / support / local night).
## Double bills - one bullet per bill with the pitch.
## Local scene - the local acts worth building nights around.
## Partners - one bullet per brand idea.
## Notes - honest caveats (taste is not ticket sales, data limits, assumptions about room size).`;

function userMessage(input: VenuePlanInput) {
  return [
    `Venue: ${input.venue}`,
    input.capacity ? `Capacity: ${input.capacity}` : "Capacity: not given",
    input.genres?.length ? `Genres they book: ${input.genres.join(", ")}` : undefined,
    input.notes ? `The user's notes: ${input.notes}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function label(name: string): string {
  return (
    {
      find_venue: "Finding the venue in Qloo",
      find_acts: "Finding acts this venue's fans love",
      find_local_acts: "Finding the local scene",
      get_crowd: "Reading the crowd",
      find_brands: "Finding brands this crowd loves",
      build_double_bills: "Building double bills",
      compare_artists: "Comparing two artists",
      submit_booking_plan: "Writing the booking brief",
    } as Record<string, string>
  )[name] ?? name;
}

function detail(name: string, output: unknown): string | undefined {
  const o = output as Record<string, unknown>;
  switch (name) {
    case "find_venue":
      return [o.name, o.category, o.city].filter(Boolean).join(" · ");
    case "find_acts":
      return (o.acts as { name: string }[]).slice(0, 3).map((a) => a.name).join(", ");
    case "find_local_acts":
      return Array.isArray(output) ? (output as { name: string }[]).slice(0, 3).map((a) => a.name).join(", ") : "none stood out";
    case "get_crowd":
      return (o.summary as string) ?? undefined;
    case "find_brands":
      return (output as { name: string }[]).slice(0, 3).map((b) => b.name).join(", ");
    case "build_double_bills":
      return (output as { headliner: string; support: string }[]).slice(0, 2).map((b) => `${b.headliner} + ${b.support}`).join("; ");
    default:
      return undefined;
  }
}

export async function runVenueAgent(input: VenuePlanInput, emit: Emit, signal?: AbortSignal): Promise<VenuePlan> {
  const started = Date.now();
  const s = new VenueSession(input, emit);
  const tools: Record<string, (i: Record<string, unknown>) => Promise<unknown>> = {
    find_venue: (i) => s.findVenue(i as { query: string }),
    find_acts: (i) => s.findActs(i as { capacity: number | null; genre_focus: string[] }),
    find_local_acts: () => s.findLocalActs(),
    get_crowd: () => s.getCrowd(),
    find_brands: () => s.findBrands(),
    build_double_bills: (i) => s.buildDoubleBills(i as { headliners: string[] }),
    compare_artists: (i) => s.compareArtists(i as { a: string; b: string }),
    submit_booking_plan: (i) => s.submit(i as unknown as SubmittedBooking),
  };

  const run = await runAgentLoop(
    {
      system: SYSTEM,
      tools: VENUE_TOOLS,
      userMessage: userMessage(input),
      runTool: (name, i) => {
        const fn = tools[name];
        if (!fn) throw new ToolInputError(`Unknown tool ${name}`);
        return fn(i);
      },
      label,
      detail,
      isDone: () => !!s.submitted,
      finishPrompt: "Please finish by calling submit_booking_plan.",
    },
    emit,
    signal,
  );

  const plan = s.buildPlan();
  plan.run = { ...run, ms: Date.now() - started };
  return plan;
}
