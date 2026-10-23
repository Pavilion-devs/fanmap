/**
 * Entry point for planning: runs the agent (or the plain pipeline if the agent isn't available
 * or fails), runs the LLM-only baseline in parallel, and assembles the final plan.
 */
import Anthropic from "@anthropic-ai/sdk";
import { runArtistPlan } from "@/lib/engine/artistPlan";
import { runVenuePlan } from "@/lib/engine/venuePlan";
import type { ArtistPlan, ArtistPlanInput, PlanEvent, VenuePlan, VenuePlanInput } from "@/lib/types";
import { runVenueAgent } from "./agent/venueAgent";
import { runArtistAgent } from "./agent/artistAgent";
import { templateBrief, templateHeadline, templateVenueBrief, templateVenueHeadline } from "./agent/brief";
import { MODEL, hasClaude } from "./agent/claude";
import { buildBookingComparison, buildComparison, llmOnlyBooking, llmOnlyPlan } from "./agent/compare";
import { findCountry } from "./geo/cities";
import { RunAbortedError } from "./agent/loop";
import { mergeUsage } from "./agent/usage";

type Emit = (event: PlanEvent) => void;

export class PlanInputError extends Error {}

export function validateArtistInput(raw: unknown): ArtistPlanInput {
  const r = (raw ?? {}) as Record<string, unknown>;
  const artist = typeof r.artist === "string" ? r.artist.trim() : "";
  if (!artist) throw new PlanInputError("Tell us which artist to plan for.");
  if (artist.length > 120) throw new PlanInputError("That artist name is too long.");
  const region = typeof r.region === "string" && r.region.trim() ? r.region.trim() : "United States";
  if (!findCountry(region)) throw new PlanInputError(`We don't recognise the country "${region}".`);
  const shows = Number(r.shows ?? 10);
  const venueSize = ["club", "theatre", "arena", "any"].includes(String(r.venueSize)) ? (r.venueSize as ArtistPlanInput["venueSize"]) : undefined;
  const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
  return {
    mode: "artist",
    artist,
    region,
    shows: Number.isFinite(shows) ? Math.max(3, Math.min(Math.round(shows), 20)) : 10,
    venueSize,
    startCity: text(r.startCity, 80),
    notes: text(r.notes, 500),
  };
}

/** Errors worth falling back from (agent/LLM problems), as opposed to "no such artist". */
function agentProblem(err: unknown) {
  if (err instanceof RunAbortedError || err instanceof Anthropic.APIUserAbortError) return false;
  return err instanceof Anthropic.APIError || (err instanceof Error && /agent|model|max_tokens|turns/i.test(err.message));
}

function describeAgentError(err: unknown) {
  if (err instanceof Anthropic.AuthenticationError) return "The Claude API key was rejected.";
  if (err instanceof Anthropic.RateLimitError) return "Claude is rate-limited right now.";
  if (err instanceof Anthropic.APIError) return `Claude API error (${err.status ?? "network"}).`;
  return err instanceof Error ? err.message : String(err);
}

export interface PlanOptions {
  signal?: AbortSignal;
  /** false = skip Claude and use the data pipeline (e.g. the daily budget is spent) */
  useAgent?: boolean;
}

export async function planArtist(input: ArtistPlanInput, emit: Emit, options: PlanOptions = {}): Promise<ArtistPlan> {
  const { signal } = options;
  const useAgent = hasClaude() && options.useAgent !== false;
  const started = Date.now();
  const shows = input.shows ?? 10;
  const country = findCountry(input.region ?? "United States")!;

  // the "without Qloo" baseline runs alongside the agent
  const baseline = useAgent
    ? llmOnlyPlan(input.artist, country.name, shows, signal).catch((err) => {
        console.warn("[fanmap] baseline failed:", err instanceof Error ? err.message : err);
        return undefined;
      })
    : Promise.resolve(undefined);

  let plan: ArtistPlan;
  if (useAgent) {
    try {
      plan = await runArtistAgent(input, emit, signal);
    } catch (err) {
      if (!agentProblem(err)) throw err;
      const reason = describeAgentError(err);
      console.warn("[fanmap] agent failed, using pipeline:", reason);
      emit({ type: "thought", text: "Switching to the direct data pipeline to finish the plan." });
      plan = await runArtistPlan(input, emit);
      plan.run = { engine: "pipeline", toolCalls: [], turns: 0, ms: 0, fallbackReason: reason.slice(0, 200) };
    }
  } else {
    plan = await runArtistPlan(input, emit);
    plan.run = { engine: "pipeline", toolCalls: [], turns: 0, ms: 0, fallbackReason: hasClaude() ? "Daily agent budget reached." : "No Claude API key configured." };
  }

  plan.headline ??= templateHeadline(plan);
  plan.brief ??= templateBrief(plan);

  const llm = await baseline;
  if (llm) {
    plan.comparison = buildComparison(
      llm,
      plan.cities.map((c) => ({ label: c.place.label, lat: c.place.lat, lon: c.place.lon })),
      country.name,
    );
    emit({ type: "partial", key: "comparison", value: plan.comparison });
  }

  if (plan.run) {
    plan.run.usage = mergeUsage(plan.run.usage, llm?.usage);
    plan.run.ms = Date.now() - started;
    plan.run.model ??= plan.run.engine === "agent" ? MODEL : undefined;
  }
  emit({ type: "result", plan });
  return plan;
}

// ---------------- venue mode ----------------

export function validateVenueInput(raw: unknown): VenuePlanInput {
  const r = (raw ?? {}) as Record<string, unknown>;
  const venue = typeof r.venue === "string" ? r.venue.trim() : "";
  if (!venue) throw new PlanInputError("Tell us which venue (or city) to plan for.");
  if (venue.length > 150) throw new PlanInputError("That venue name is too long.");
  const capacity = Number(r.capacity);
  const genres = Array.isArray(r.genres)
    ? r.genres
    : typeof r.genres === "string"
      ? r.genres.split(",")
      : [];
  const notes = typeof r.notes === "string" && r.notes.trim() ? r.notes.trim().slice(0, 500) : undefined;
  return {
    mode: "venue",
    venue,
    capacity: Number.isFinite(capacity) && capacity >= 20 ? Math.min(Math.round(capacity), 100_000) : undefined,
    genres: genres.map((g) => String(g).trim()).filter(Boolean).slice(0, 4),
    notes,
  };
}

export async function planVenue(input: VenuePlanInput, emit: Emit, options: PlanOptions = {}): Promise<VenuePlan> {
  const { signal } = options;
  const useAgent = hasClaude() && options.useAgent !== false;
  const started = Date.now();
  const COUNT = 10;
  const baseline = useAgent
    ? llmOnlyBooking(input.venue, COUNT, input.capacity, input.genres, signal).catch((err) => {
        console.warn("[fanmap] venue baseline failed:", err instanceof Error ? err.message : err);
        return undefined;
      })
    : Promise.resolve(undefined);

  let plan: VenuePlan;
  if (useAgent) {
    try {
      plan = await runVenueAgent(input, emit, signal);
    } catch (err) {
      if (!agentProblem(err)) throw err;
      const reason = describeAgentError(err);
      console.warn("[fanmap] venue agent failed, using pipeline:", reason);
      emit({ type: "thought", text: "Switching to the direct data pipeline to finish the plan." });
      plan = await runVenuePlan(input, emit);
      plan.run = { engine: "pipeline", toolCalls: [], turns: 0, ms: 0, fallbackReason: reason.slice(0, 200) };
    }
  } else {
    plan = await runVenuePlan(input, emit);
    plan.run = { engine: "pipeline", toolCalls: [], turns: 0, ms: 0, fallbackReason: hasClaude() ? "Daily agent budget reached." : "No Claude API key configured." };
  }

  plan.headline ??= templateVenueHeadline(plan);
  plan.brief ??= templateVenueBrief(plan);

  const llm = await baseline;
  if (llm) {
    plan.comparison = buildBookingComparison(llm, plan.picks.slice(0, COUNT).map((p) => p.artist.name));
    emit({ type: "partial", key: "comparison", value: plan.comparison });
  }
  if (plan.run) {
    plan.run.usage = mergeUsage(plan.run.usage, llm?.usage);
    plan.run.ms = Date.now() - started;
    plan.run.model ??= plan.run.engine === "agent" ? MODEL : undefined;
  }
  emit({ type: "result", plan });
  return plan;
}
