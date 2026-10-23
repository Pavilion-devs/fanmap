/**
 * Entry point for planning: runs the agent (or the plain pipeline if the agent isn't available
 * or fails), runs the LLM-only baseline in parallel, and assembles the final plan.
 */
import Anthropic from "@anthropic-ai/sdk";
import { runArtistPlan } from "@/lib/engine/artistPlan";
import type { ArtistPlan, ArtistPlanInput, PlanEvent } from "@/lib/types";
import { runArtistAgent } from "./agent/artistAgent";
import { templateBrief, templateHeadline } from "./agent/brief";
import { MODEL, hasClaude } from "./agent/claude";
import { buildComparison, llmOnlyPlan } from "./agent/compare";
import { findCountry } from "./geo/cities";

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
  return err instanceof Anthropic.APIError || (err instanceof Error && /agent|model|max_tokens|turns/i.test(err.message));
}

export async function planArtist(input: ArtistPlanInput, emit: Emit): Promise<ArtistPlan> {
  const started = Date.now();
  const shows = input.shows ?? 10;
  const country = findCountry(input.region ?? "United States")!;

  // the "without Qloo" baseline runs alongside the agent
  const baseline = hasClaude()
    ? llmOnlyPlan(input.artist, country.name, shows).catch((err) => {
        console.warn("[fanmap] baseline failed:", err instanceof Error ? err.message : err);
        return undefined;
      })
    : Promise.resolve(undefined);

  let plan: ArtistPlan;
  if (hasClaude()) {
    try {
      plan = await runArtistAgent(input, emit);
    } catch (err) {
      if (!agentProblem(err)) throw err;
      const reason =
        err instanceof Anthropic.AuthenticationError
          ? "The Claude API key was rejected."
          : err instanceof Anthropic.RateLimitError
            ? "Claude is rate-limited right now."
            : err instanceof Anthropic.APIError
              ? `Claude API error (${err.status ?? "network"}).`
              : err instanceof Error
                ? err.message
                : String(err);
      console.warn("[fanmap] agent failed, using pipeline:", reason);
      emit({ type: "thought", text: "Switching to the direct data pipeline to finish the plan." });
      plan = await runArtistPlan(input, emit);
      plan.run = { engine: "pipeline", toolCalls: [], turns: 0, ms: 0, fallbackReason: reason.slice(0, 200) };
    }
  } else {
    plan = await runArtistPlan(input, emit);
    plan.run = { engine: "pipeline", toolCalls: [], turns: 0, ms: 0, fallbackReason: "No Claude API key configured." };
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
    plan.run.ms = Date.now() - started;
    plan.run.model ??= plan.run.engine === "agent" ? MODEL : undefined;
  }
  emit({ type: "result", plan });
  return plan;
}
