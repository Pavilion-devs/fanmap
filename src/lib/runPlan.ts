/**
 * The single entry point the API (and scripts) use to run a plan:
 *   1. identical request seen before → replay it from the plan cache (fast, free)
 *   2. otherwise → run the agent/pipeline, record its progress, and cache the result
 *
 * Replays re-stream the recorded steps and thoughts at a readable pace, with each partial
 * result filled in from the cached plan where it first arrived, so the UI builds the same way
 * it did live. Then they send the cached plan marked `run.cached`.
 */
import { cache, cacheKey } from "@/lib/cache";
import { hasClaude } from "@/lib/agent/claude";
import { takeAgentBudget } from "@/lib/limits";
import { planArtist, planVenue } from "@/lib/plan";
import type { ArtistPlanInput, Plan, PlanEvent, VenuePlanInput } from "@/lib/types";

type Emit = (event: PlanEvent) => void;
type Input = ArtistPlanInput | VenuePlanInput;

const PLAN_TTL = 60 * 60 * 24 * 14; // two weeks: covers judging
const MAX_RECORDED = 250;
const REPLAY_TOTAL_MS = 6000;
const REPLAY_MAX_STEP_MS = 450;

/** Partial results that are small enough to record whole; the rest are re-read from the plan. */
const RECORD_WHOLE = new Set(["candidates"]);

/** For plans cached before partials were recorded: which parts of the plan each tool produced. */
const TOOL_PARTIALS: Record<string, string[]> = {
  find_artist: ["artist"],
  map_fans: ["fanMap"],
  get_audience: ["audience"],
  find_support_acts: ["openers"],
  find_brands: ["brands"],
  plan_route: ["route"],
  find_venue: ["venue"],
  find_acts: ["picks"],
  find_local_acts: ["localOpeners"],
  get_crowd: ["crowd"],
  build_double_bills: ["doubleBills"],
};

interface CachedPlan {
  plan: Plan;
  events: PlanEvent[];
}

/** Same request → same key, regardless of letter case, spacing or field order. */
export function planKey(input: Input) {
  const norm = (v: unknown): unknown =>
    typeof v === "string" ? v.trim().toLowerCase().replace(/\s+/g, " ") : Array.isArray(v) ? v.map(norm) : v;
  const entries = Object.entries(input)
    .filter(([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => [k, norm(v)] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return cacheKey("plan-v1", entries);
}

export async function getCachedPlan(input: Input) {
  return cache.get<CachedPlan>(planKey(input));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function replay(cached: CachedPlan, emit: Emit, signal?: AbortSignal) {
  const plan = cached.plan as unknown as Record<string, unknown>;
  const recordedPartials = cached.events.some((e) => e.type === "partial");
  const sent = new Set<string>();
  const emitPartial = (key: string, value: unknown) => {
    if (value === undefined || sent.has(key)) return;
    sent.add(key);
    emit({ type: "partial", key, value });
  };

  const paced = cached.events.filter((e) => e.type !== "partial" && !(e.type === "step" && e.status === "running")).length;
  const delay = Math.min(REPLAY_MAX_STEP_MS, Math.floor(REPLAY_TOTAL_MS / Math.max(paced, 1)));
  for (const event of cached.events) {
    if (signal?.aborted) return;
    if (event.type === "partial") {
      emitPartial(event.key, event.value ?? plan[event.key]);
      continue;
    }
    emit(event);
    if (!recordedPartials && event.type === "step" && event.status === "done" && event.tool) {
      for (const key of TOOL_PARTIALS[event.tool] ?? []) emitPartial(key, plan[key]);
      // the full candidate list wasn't kept, so the chosen cities stand in for it
      if (event.tool === "map_fans" && cached.plan.mode === "artist") {
        emitPartial("candidates", cached.plan.cities.map((c) => ({ label: c.place.label, score: c.score, lat: c.place.lat, lon: c.place.lon })));
      }
    }
    if (event.type === "step" && event.status === "running") continue; // pair running/done quickly
    await sleep(delay);
  }
  const final = { ...cached.plan, run: cached.plan.run ? { ...cached.plan.run, cached: true } : undefined } as Plan;
  emit({ type: "result", plan: final });
}

export interface RunOptions {
  signal?: AbortSignal;
  /** skip the cache (e.g. a "re-run" button or the warm-up script refreshing) */
  fresh?: boolean;
}

/** Run (or replay) a plan. Returns whether it came from the cache. */
export async function runPlan(input: Input, emit: Emit, options: RunOptions = {}): Promise<{ plan: Plan; cached: boolean }> {
  const key = planKey(input);
  if (!options.fresh) {
    const hit = await cache.get<CachedPlan>(key);
    if (hit) {
      await replay(hit, emit, options.signal);
      return { plan: hit.plan, cached: true };
    }
  }

  // record progress so a replay can tell the same story; bulky partials are kept as markers only,
  // since the cached plan already holds their values
  const events: PlanEvent[] = [];
  const recordingEmit: Emit = (event) => {
    if (events.length < MAX_RECORDED) {
      if (event.type === "step" || event.type === "thought" || event.type === "notice") events.push(event);
      else if (event.type === "partial") {
        events.push(RECORD_WHOLE.has(event.key) ? event : { type: "partial", key: event.key, value: undefined });
      }
    }
    emit(event);
  };

  // the site-wide daily budget for agent runs; past it, the data pipeline still answers
  let useAgent = hasClaude();
  if (useAgent && !(await takeAgentBudget())) {
    useAgent = false;
    emit({
      type: "notice",
      notice: { code: "partial_result", message: "Fanmap is busy today, so this plan comes straight from the data, without the AI agent's write-up." },
    });
  }

  const planOptions = { signal: options.signal, useAgent };
  const plan =
    input.mode === "venue" ? await planVenue(input, recordingEmit, planOptions) : await planArtist(input, recordingEmit, planOptions);

  // only cache complete, agent-made plans; a pipeline fallback should get another chance next time
  if (plan.run?.engine === "agent" && !options.signal?.aborted) {
    await cache.set(key, { plan, events } satisfies CachedPlan, PLAN_TTL);
  }
  return { plan, cached: false };
}
