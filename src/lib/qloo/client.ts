/**
 * Thin, typed client for the Qloo hackathon API.
 * - Key stays on the server (never import this from client components).
 * - Every response is cached server-side; raw data never goes into the repo.
 * - Retries on rate limits / server errors.
 */
import { cached, cacheKey } from "@/lib/cache";

const BASE_URL = process.env.QLOO_BASE_URL ?? "https://hackathon.api.qloo.com";
const DEFAULT_TTL = 60 * 60 * 24 * 7; // a week: taste data changes slowly
const TIMEOUT_MS = 45_000;
const MAX_RETRIES = 4;
/** Max Qloo requests in flight at once (per server instance), to stay under the rate limit. */
const MAX_CONCURRENT = 6;

let active = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

export type Params = Record<string, string | number | boolean | undefined | null | (string | number)[]>;

export class QlooError extends Error {
  constructor(
    message: string,
    public status: number,
    public path: string,
  ) {
    super(message);
    this.name = "QlooError";
  }
}

function apiKey() {
  const key = process.env.QLOO_API_KEY;
  if (!key) throw new Error("QLOO_API_KEY is not set");
  return key;
}

/** Build a stable query string: drop empty values, join arrays with commas, sort keys (better cache hits). */
function toQuery(params: Params) {
  const search = new URLSearchParams();
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value === undefined || value === null || value === "") continue;
    search.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  return search.toString();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rawGet<T>(path: string, params: Params): Promise<T> {
  const url = `${BASE_URL}${path}?${toQuery(params)}`;
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let retryAfterMs = 0;
    try {
      const res = await withSlot(() =>
        fetch(url, {
          headers: { "X-Api-Key": apiKey(), Accept: "application/json" },
          signal: AbortSignal.timeout(TIMEOUT_MS),
          cache: "no-store",
        }),
      );
      if (res.ok) return (await res.json()) as T;

      const body = await res.text().catch(() => "");
      const error = new QlooError(`Qloo ${res.status} on ${path}: ${body.slice(0, 300)}`, res.status, path);
      // 4xx (other than 429) means the request itself is wrong — retrying won't help
      if (res.status !== 429 && res.status < 500) throw error;
      retryAfterMs = Number(res.headers.get("retry-after")) * 1000 || 0;
      lastError = error;
    } catch (err) {
      if (err instanceof QlooError && err.status !== 429 && err.status < 500) throw err;
      lastError = err;
    }
    if (attempt < MAX_RETRIES) {
      // exponential backoff with jitter, so parallel retries don't all land together
      await sleep(Math.max(retryAfterMs, 1000 * 2 ** attempt * (0.75 + Math.random() * 0.5)));
    }
  }
  throw lastError;
}

/**
 * Cached GET. `transform` shrinks big responses before they're stored;
 * give each different transform its own `variant` name so cache entries don't collide.
 */
export async function qlooGet<T, R = T>(
  path: string,
  params: Params,
  options: { ttl?: number; transform?: (raw: T) => R; variant?: string } = {},
): Promise<R> {
  const key = cacheKey("qloo", path, toQuery(params), options.variant ?? (options.transform ? "transformed" : "raw"));
  return cached<R>(key, options.ttl ?? DEFAULT_TTL, async () => {
    const raw = await rawGet<T>(path, params);
    return options.transform ? options.transform(raw) : (raw as unknown as R);
  });
}
