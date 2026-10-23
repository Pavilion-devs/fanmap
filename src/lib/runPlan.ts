/**
 * The single entry point the API (and scripts) use to run a plan:
 *   1. identical request seen before → replay it from the plan cache (fast, free)
 *   2. otherwise → run the agent/pipeline, record its progress, and cache the result
 *
 * Replays re-stream the recorded steps and thoughts quickly, so the UI still shows the
 * agent's work, then send the cached plan marked `run.cached`.
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
const REPLAY_TOTAL_MS = 2500;

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
  const delay = Math.min(120, Math.floor(REPLAY_TOTAL_MS / Math.max(cached.events.length, 1)));
  for (const event of cached.events) {
    if (signal?.aborted) return;
    emit(event);
    if (event.type === "step" && event.status === "running") continue; // pair running/done quickly
    await sleep(delay);
  }
  const plan = { ...cached.plan, run: cached.plan.run ? { ...cached.plan.run, cached: true } : undefined } as Plan;
  emit({ type: "result", plan });
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

  // record progress (not the bulky partial results) so a replay can show the same story
  const events: PlanEvent[] = [];
  const recordingEmit: Emit = (event) => {
    if ((event.type === "step" || event.type === "thought" || event.type === "notice") && events.length < MAX_RECORDED) {
      events.push(event);
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
