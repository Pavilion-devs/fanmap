/** Token usage and estimated cost per run, so we know what a plan costs. */

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** rough estimate from list prices; not a bill */
  estimatedCostUsd: number;
  calls: number;
}

/** USD per million tokens (list prices). Cache writes are 1.25x input, reads are listed per model. */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

export const emptyUsage = (): Usage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  estimatedCostUsd: 0,
  calls: 0,
});

interface ApiUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function addUsage(total: Usage, usage: ApiUsage | undefined | null, model: string): Usage {
  if (!usage) return total;
  const price = PRICES[model] ?? PRICES["claude-sonnet-5-5"];
  const read = usage.cache_read_input_tokens ?? 0;
  const write = usage.cache_creation_input_tokens ?? 0;
  const cost =
    (usage.input_tokens * price.input + usage.output_tokens * price.output + read * price.cacheRead + write * price.input * 1.25) /
    1_000_000;
  total.inputTokens += usage.input_tokens;
  total.outputTokens += usage.output_tokens;
  total.cacheReadTokens += read;
  total.cacheWriteTokens += write;
  total.estimatedCostUsd = Math.round((total.estimatedCostUsd + cost) * 10_000) / 10_000;
  total.calls += 1;
  return total;
}

export function mergeUsage(a: Usage | undefined, b: Usage | undefined): Usage | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    estimatedCostUsd: Math.round((a.estimatedCostUsd + b.estimatedCostUsd) * 10_000) / 10_000,
    calls: a.calls + b.calls,
  };
}
