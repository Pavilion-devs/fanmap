/**
 * Artist mode, agent version: Claude plans the tour by calling Fanmap's Qloo-backed tools.
 *
 * The agent decides which cities to scout, weighs fan concentration against market size and
 * geography, follows the user's wishes, picks openers and partners, and writes the brief.
 * Every tool call is streamed to the UI as a progress step; the agent's own notes as "thought".
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { ArtistPlan, ArtistPlanInput, PlanEvent, RunInfo } from "@/lib/types";
import { BETAS, MODEL, claude } from "./claude";
import { ArtistNotFoundError, ArtistSession, ToolInputError } from "./session";
import { ARTIST_TOOLS, runTool, toolLabel } from "./tools";

type Emit = (event: PlanEvent) => void;
type MessageParam = Anthropic.Beta.BetaMessageParam;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

const MAX_TURNS = 12;

const SYSTEM = `You are Fanmap's tour-planning agent. You help independent artists, managers, booking agents and small promoters decide where to tour, using Qloo's taste data: where an artist's fans are actually concentrated, which venues and local acts those fans like, and which brands they love.

Your value is that you use real data instead of guessing. A generic answer ("New York, LA, Chicago") is what the user would get without you; your job is to find where this artist's fans really are, including smaller cities a human planner would miss, and to explain it with evidence.

How to work:
1. Call find_artist first.
2. Then, in parallel: map_fans, get_audience, find_support_acts, find_brands.
3. Pick a shortlist of candidates (about the number of shows plus 3) and call scout_cities once with all of them.
4. Choose the final cities. Fan concentration matters most: a city where fans rank in the top 0.5% usually beats a much bigger city ranked top 2-3%, because that's where shows sell out. Then consider market size (a show needs a crowd), whether good venues and a local scene exist, and a route that makes geographic sense. Include a big, lower-ranked market only when the venue size needs it or the route needs a stop there. Never put two stops in the same metro. The user's wishes come first: start city, cities to avoid, venue size, and preferences in their notes (for example "college towns welcome" means favour the small, high-ranking towns; "big rooms only" means favour large markets). Only go against a wish when the data clearly argues otherwise, and then say why in the brief.
5. Call plan_route with the final cities, then submit_plan.
Run independent tool calls in parallel. Before a tool call, write at most one short sentence on what you found or what you're checking next; the user sees these live.

Rules:
- Only use cities, venues, artists, brands and numbers that appear in tool results. Never invent them. If data is thin, say so.
- Frame results as where fans' taste is concentrated, not as ticket-sales predictions.
- City reasons cite the evidence: how highly fans rank there, number of strong fan areas, a standout venue or local act.
- If the user names a city that isn't a candidate, leave it out and explain in the brief's notes that the fan data doesn't support it.

The brief (brief_markdown) is for a promoter or booking agent. Markdown, about 350-500 words, no emojis, with these sections:
## Summary - 2-3 sentences: who the audience is and the key insight about where they are.
## Route - a table with columns Day | City | Suggested venue | Local opener.
## Why these cities - one bullet per city with the evidence.
## Support and partners - recommended support acts, then each brand partnership idea as its own bullet (the brief must stand on its own).
## Notes - honest caveats (data limits, taste is not ticket sales) and anything the user asked for that the data didn't support.`;

function userMessage(input: ArtistPlanInput) {
  const lines = [
    `Plan a tour for: ${input.artist}`,
    `Country: ${input.region || "United States"}`,
    `Number of shows: ${input.shows ?? 10}`,
    input.venueSize && input.venueSize !== "any" ? `Venue size: ${input.venueSize}` : "Venue size: you decide from the artist's reach",
    input.startCity ? `Start city: ${input.startCity}` : undefined,
    input.notes ? `The user's notes: ${input.notes}` : undefined,
  ];
  return lines.filter(Boolean).join("\n");
}

/** Short text for the tool_result content sent back to Claude. */
const asContent = (value: unknown) => JSON.stringify(value);

export async function runArtistAgent(input: ArtistPlanInput, emit: Emit): Promise<ArtistPlan> {
  const started = Date.now();
  const session = new ArtistSession(input, emit);
  const toolCalls: RunInfo["toolCalls"] = [];
  const messages: MessageParam[] = [{ role: "user", content: userMessage(input) }];
  let turns = 0;
  let stepCounter = 0;

  for (; turns < MAX_TURNS; ) {
    const response = await claude().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: BETAS,
      fallbacks: "default",
      thinking: { type: "adaptive", display: "updates" },
      output_config: { effort: "medium" },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: ARTIST_TOOLS,
      messages,
    });
    turns++;

    if (response.stop_reason === "refusal") throw new Error("The model declined this request.");

    // the agent's notes: progress-update thinking blocks and any plain text
    for (const block of response.content) {
      const text = block.type === "thinking" ? block.thinking : block.type === "text" ? block.text : "";
      if (text.trim()) emit({ type: "thought", text: text.trim() });
    }

    // append the assistant turn unchanged (thinking blocks must be passed back as-is)
    messages.push({ role: "assistant", content: response.content });

    const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (!uses.length) {
      if (session.submitted) break;
      if (response.stop_reason === "max_tokens") throw new Error("The agent ran out of room before finishing.");
      messages.push({ role: "user", content: "Please finish by calling plan_route if needed, then submit_plan." });
      continue;
    }
    if (response.stop_reason === "max_tokens") throw new Error("A tool call was cut off (max_tokens).");

    // run this turn's tool calls in parallel; all results go back in one message
    const results = await Promise.all(
      uses.map(async (use): Promise<ToolResult> => {
        const toolInput = (use.input ?? {}) as Record<string, unknown>;
        const id = `${use.name}-${++stepCounter}`;
        const label = toolLabel(use.name, toolInput);
        const t0 = Date.now();
        emit({ type: "step", id, label, status: "running", tool: use.name });
        try {
          const output = await runTool(session, use.name, toolInput);
          const ms = Date.now() - t0;
          toolCalls.push({ tool: use.name, ms });
          emit({ type: "step", id, label, status: "done", tool: use.name, ms, detail: stepDetail(use.name, output) });
          return { type: "tool_result", tool_use_id: use.id, content: asContent(output) };
        } catch (err) {
          const ms = Date.now() - t0;
          const message = err instanceof Error ? err.message : String(err);
          emit({ type: "step", id, label, status: "failed", tool: use.name, ms, detail: message.slice(0, 200) });
          if (err instanceof ArtistNotFoundError) throw err;
          // input mistakes go back to the agent so it can fix them; data failures too, so it can work around them
          return {
            type: "tool_result",
            tool_use_id: use.id,
            is_error: true,
            content: err instanceof ToolInputError ? message : `Tool failed: ${message.slice(0, 300)}`,
          };
        }
      }),
    );
    messages.push({ role: "user", content: results });

    // once the plan is submitted there is nothing left for the agent to do
    if (session.submitted) break;
  }

  if (!session.submitted) throw new Error(`The agent didn't finish within ${MAX_TURNS} turns.`);

  await session.ensureScouted(session.submitted.cities.map((c) => c.label));
  const plan = session.buildPlan();
  plan.run = { engine: "agent", model: MODEL, toolCalls, turns, ms: Date.now() - started };
  return plan;
}

/** One-line detail for a finished step, shown under the step label. */
function stepDetail(tool: string, output: unknown): string | undefined {
  const o = output as Record<string, unknown>;
  try {
    switch (tool) {
      case "find_artist":
        return [o.name, (o.genres as string[])?.slice(0, 2).join(", ")].filter(Boolean).join(" · ");
      case "map_fans": {
        const c = o.candidates as { label: string }[];
        return `${Number(o.total_areas_in_country).toLocaleString()} areas → ${c.length} candidate cities, led by ${c.slice(0, 3).map((x) => x.label.split(",")[0]).join(", ")}`;
      }
      case "get_audience":
        return (o.summary as string) ?? undefined;
      case "find_support_acts":
        return (output as { name: string }[]).slice(0, 3).map((x) => x.name).join(", ");
      case "find_brands":
        return Array.isArray(output) ? (output as { name: string }[]).slice(0, 3).map((x) => x.name).join(", ") : undefined;
      case "scout_cities": {
        const cities = o.cities as { venues: unknown[] }[];
        return `${cities.reduce((n, c) => n + c.venues.length, 0)} venues across ${cities.length} cities`;
      }
      case "compare_artists":
        return (o.shared_taste as string[]).slice(0, 4).join(", ");
      case "plan_route":
        return `${Number(o.total_km).toLocaleString()} km over ${o.days} days`;
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}
