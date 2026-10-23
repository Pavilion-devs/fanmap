/**
 * Tool definitions for the artist-mode agent. Strict schemas: every property is required,
 * optional values are nullable. Order and wording are fixed so the prompt cache stays warm.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { ArtistSession, SubmittedPlan } from "./session";

type Tool = Anthropic.Beta.BetaTool;

const obj = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: "object" as const,
  properties,
  required,
  additionalProperties: false,
});

export const ARTIST_TOOLS: Tool[] = [
  {
    name: "find_artist",
    description:
      "Look up the artist in Qloo's taste graph. Returns genres, size (Last.fm listeners, Qloo popularity), a suggested venue size and audience traits. Call this first.",
    strict: true,
    input_schema: obj({ name: { type: "string", description: "Artist name as the user wrote it" } }),
  },
  {
    name: "map_fans",
    description:
      "Map where the artist's fans are concentrated in the tour country (Qloo heatmap of thousands of areas) and rank candidate tour cities. Returns up to 25 candidates with a score, how highly fans rank there nationally, number of strong fan areas and metro population. Only these candidates can go on the tour.",
    strict: true,
    input_schema: obj({
      venue_size: {
        type: ["string", "null"],
        enum: ["club", "theatre", "arena", "any", null],
        description: "Filter out cities too small for this venue size. null = use the user's choice or 'any'.",
      },
    }),
  },
  {
    name: "get_audience",
    description: "Age and gender lean of the artist's audience (Qloo demographics) plus audience traits.",
    strict: true,
    input_schema: obj({}),
  },
  {
    name: "find_support_acts",
    description:
      "Artists whose fans overlap most with this artist's fans, smaller acts first. Use for tour-wide support slots.",
    strict: true,
    input_schema: obj({}),
  },
  {
    name: "find_brands",
    description: "Brands this audience over-indexes on (Qloo affinity). Use for sponsorship and partnership ideas.",
    strict: true,
    input_schema: obj({}),
  },
  {
    name: "scout_cities",
    description:
      "For candidate cities: performance venues the fans like (with category and rough size), local opening acts (smaller artists strong in that city, in the same genre lane, fit 0-1, confirmed_local when their profile names the city), and pre/after-show spots. Pass every city you're seriously considering in one call; it runs them in parallel.",
    strict: true,
    input_schema: obj({
      cities: { type: "array", items: { type: "string" }, description: "Candidate labels exactly as returned by map_fans" },
    }),
  },
  {
    name: "compare_artists",
    description:
      "Shared taste between this artist and another artist (Qloo compare). Use to check a co-headliner or a support act the user suggests.",
    strict: true,
    input_schema: obj({ other_artist: { type: "string" } }),
  },
  {
    name: "plan_route",
    description: "Order cities into an efficient route and space show days by travel distance.",
    strict: true,
    input_schema: obj({
      cities: { type: "array", items: { type: "string" }, description: "Candidate labels from map_fans" },
      start_city: { type: ["string", "null"], description: "Where the tour should start, if the user said so" },
    }),
  },
  {
    name: "submit_plan",
    description:
      "Submit the final tour plan. Call exactly once, at the end. Cities in order of importance (not route order).",
    strict: true,
    input_schema: obj({
      headline: {
        type: "string",
        description: "One sentence, the key insight about where this artist's fans are (max ~25 words). No numbers soup.",
      },
      cities: {
        type: "array",
        items: obj({
          label: { type: "string", description: "Candidate label from map_fans" },
          reason: {
            type: "string",
            description: "1-2 sentences: why this city, citing the data (fan rank, strong areas, venue, local scene).",
          },
        }),
      },
      openers: { type: "array", items: { type: "string" }, description: "Names of 2-4 recommended tour-wide support acts" },
      brand_pitches: {
        type: "array",
        items: obj({ name: { type: "string" }, pitch: { type: "string", description: "One line: the partnership idea" } }),
        description: "3-5 brands with a concrete partnership idea each",
      },
      brief_markdown: {
        type: "string",
        description: "The tour brief for a promoter or booking agent, in Markdown (see system prompt for the format).",
      },
    }),
  },
];

/** Human-readable progress labels for each tool call. */
export function toolLabel(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "find_artist":
      return `Finding ${input.name} in Qloo`;
    case "map_fans":
      return "Mapping where the fans are";
    case "get_audience":
      return "Reading the audience";
    case "find_support_acts":
      return "Finding support acts with the same fans";
    case "find_brands":
      return "Finding brands the fans love";
    case "scout_cities": {
      const n = Array.isArray(input.cities) ? input.cities.length : 0;
      return `Scouting venues and local acts in ${n} ${n === 1 ? "city" : "cities"}`;
    }
    case "compare_artists":
      return `Comparing fans with ${input.other_artist}`;
    case "plan_route":
      return "Planning the route";
    case "submit_plan":
      return "Writing the tour brief";
    default:
      return name;
  }
}

/** Run one tool call against the session. */
export async function runTool(session: ArtistSession, name: string, input: Record<string, unknown>) {
  switch (name) {
    case "find_artist":
      return session.findArtist(input as { name: string });
    case "map_fans":
      return session.mapFans(input as Parameters<ArtistSession["mapFans"]>[0]);
    case "get_audience":
      return session.getAudience();
    case "find_support_acts":
      return session.findSupportActs();
    case "find_brands":
      return session.findBrands();
    case "scout_cities":
      return session.scoutCities(input as { cities: string[] });
    case "compare_artists":
      return session.compareArtists(input as { other_artist: string });
    case "plan_route":
      return session.planRoute(input as { cities: string[]; start_city: string | null });
    case "submit_plan":
      return session.submitPlan(input as unknown as SubmittedPlan);
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}
