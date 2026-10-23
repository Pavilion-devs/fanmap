/**
 * "With vs without Qloo": ask the same model the same question with no tools and no data,
 * then compare its cities with Fanmap's. Cities count as the same if they're within one metro.
 */
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { findCity, distanceKm, type City } from "@/lib/geo/cities";
import type { Comparison } from "@/lib/types";
import { MODEL, claude } from "./claude";

const LlmPlan = z.object({
  cities: z.array(z.object({ city: z.string(), reason: z.string() })),
  reasoning: z.string(),
});

export interface LlmOnlyResult {
  cities: { city: string; reason: string }[];
  reasoning: string;
}

/** The baseline: what a capable LLM says from general knowledge alone. */
export async function llmOnlyPlan(artist: string, country: string, shows: number): Promise<LlmOnlyResult> {
  const response = await claude().messages.parse({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: "low", format: zodOutputFormat(LlmPlan) },
    messages: [
      {
        role: "user",
        content: `You're a tour planner. From your own knowledge only, pick the ${shows} best cities in ${country} for a ${artist} tour, where their fans are most likely to show up. Give each city as "City" or "City, State/Region" with a one-line reason, and a one-sentence summary of your reasoning.`,
      },
    ],
  });
  if (!response.parsed_output) throw new Error("No structured output from the baseline call.");
  return response.parsed_output;
}

const SAME_METRO_KM = 45;

function locate(name: string, countryName: string): City | undefined {
  return findCity(`${name}, ${countryName}`)[0] ?? findCity(name)[0];
}

export function buildComparison(
  llm: LlmOnlyResult,
  fanmapCities: { label: string; lat: number; lon: number }[],
  countryName: string,
): Comparison {
  const llmPlaces = llm.cities.map((c) => ({ name: c.city, place: locate(c.city, countryName) }));

  const onlyFanmap = fanmapCities
    .filter((f) => !llmPlaces.some((l) => l.place && distanceKm(l.place, f) <= SAME_METRO_KM))
    .map((f) => f.label);
  const total = fanmapCities.length;
  const differ = onlyFanmap.length;

  const headline =
    differ === 0
      ? `Fanmap and the generic answer agree on all ${total} cities, now backed by fan data.`
      : `${differ} of ${total} Fanmap cities don't appear in the generic AI answer.`;

  return {
    llmOnly: { items: llm.cities.map((c) => c.city), reasoning: llm.reasoning },
    fanmap: { items: fanmapCities.map((c) => c.label) },
    onlyFanmap,
    headline,
  };
}
