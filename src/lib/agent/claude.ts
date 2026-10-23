/** Shared Claude client and settings. Server-only. */
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

/**
 * - thinking-display-updates: the agent's short notes between tool calls come back as text,
 *   so the UI can show what it's doing ("Her fans cluster in New England, scouting those first").
 * - server-side-fallback: if a request is declined by a safety classifier, the API retries it on
 *   Anthropic's recommended fallback model instead of failing.
 */
export const BETAS = ["thinking-display-updates-2026-08-18", "server-side-fallback-2026-07-01"];

export const hasClaude = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

let client: Anthropic | undefined;
export function claude() {
  client ??= new Anthropic({ timeout: 120_000, maxRetries: 2 });
  return client;
}
