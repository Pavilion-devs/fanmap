/**
 * Protecting the public API and the API budgets.
 *
 * - Per visitor: a few fresh (uncached) plans per hour; cached replays are cheap, so more.
 * - Site-wide: a daily cap on agent runs. Past it, plans use the data pipeline (no Claude),
 *   so the site keeps working without running up a bill.
 */
import { incrementCounter } from "@/lib/cache";

const num = (v: string | undefined, fallback: number) => (v && Number.isFinite(Number(v)) ? Number(v) : fallback);

export const LIMITS = {
  freshPerHour: num(process.env.FANMAP_FRESH_PLANS_PER_HOUR, 6),
  cachedPerHour: num(process.env.FANMAP_CACHED_PLANS_PER_HOUR, 60),
  agentRunsPerDay: num(process.env.FANMAP_AGENT_RUNS_PER_DAY, 300),
};

/** Best-effort client id from proxy headers (Vercel sets x-forwarded-for). */
export function clientId(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "anonymous";
}

export async function allowRequest(client: string, cached: boolean) {
  const hour = Math.floor(Date.now() / 3_600_000);
  const limit = cached ? LIMITS.cachedPerHour : LIMITS.freshPerHour;
  const count = await incrementCounter(`${cached ? "cached" : "fresh"}:${client}:${hour}`, 3600);
  return { allowed: count <= limit, limit, retryAfterSeconds: 3600 - Math.floor((Date.now() / 1000) % 3600) };
}

/** Counts an agent run against today's budget; false once the budget is spent. */
export async function takeAgentBudget() {
  const day = new Date().toISOString().slice(0, 10);
  const count = await incrementCounter(`agent-runs:${day}`, 86_400);
  return count <= LIMITS.agentRunsPerDay;
}
