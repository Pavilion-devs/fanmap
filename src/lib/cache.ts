/**
 * Server-side cache for Qloo responses (private caching is allowed by Qloo's terms;
 * never commit cached data to the repo).
 *
 * Layers, fastest first:
 *   1. in-memory (per server instance)
 *   2. persistent: Upstash Redis (if UPSTASH_REDIS_REST_URL/TOKEN, or the KV_REST_API_URL/TOKEN names
 *      that Vercel's Upstash integration sets, are present; used in production)
 *      or a local file cache in ./.cache (development / scripts)
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Entry = { value: unknown; expires: number };

export interface CacheStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
}

const MEMORY_MAX_ENTRIES = 500;

class MemoryStore implements CacheStore {
  private map = new Map<string, Entry>();

  async get<T>(key: string) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    // refresh recency for simple LRU behaviour
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value as T;
  }

  async set(key: string, value: unknown, ttlSeconds: number) {
    this.map.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
    if (this.map.size > MEMORY_MAX_ENTRIES) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
}

class FileStore implements CacheStore {
  constructor(private dir: string) {}

  private file(key: string) {
    return path.join(this.dir, `${key}.json`);
  }

  async get<T>(key: string) {
    try {
      const entry = JSON.parse(await readFile(this.file(key), "utf8")) as Entry;
      if (entry.expires < Date.now()) return undefined;
      return entry.value as T;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number) {
    try {
      await mkdir(this.dir, { recursive: true });
      const entry: Entry = { value, expires: Date.now() + ttlSeconds * 1000 };
      await writeFile(this.file(key), JSON.stringify(entry));
    } catch {
      // read-only file systems (e.g. serverless) — the cache is best effort
    }
  }
}

/** Upstash Redis over its REST API, so we need no extra dependency. */
class UpstashStore implements CacheStore {
  constructor(
    private url: string,
    private token: string,
  ) {}

  async command(args: (string | number)[]) {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}` },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Upstash ${res.status}`);
    return ((await res.json()) as { result: unknown }).result;
  }

  async get<T>(key: string) {
    try {
      const raw = await this.command(["GET", `fanmap:${key}`]);
      return typeof raw === "string" ? (JSON.parse(raw) as T) : undefined;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number) {
    try {
      await this.command(["SET", `fanmap:${key}`, JSON.stringify(value), "EX", ttlSeconds]);
    } catch {
      // best effort
    }
  }
}

class LayeredStore implements CacheStore {
  constructor(private layers: CacheStore[]) {}

  async get<T>(key: string) {
    for (let i = 0; i < this.layers.length; i++) {
      const value = await this.layers[i].get<T>(key);
      if (value !== undefined) {
        // fill faster layers on a hit
        await Promise.all(this.layers.slice(0, i).map((l) => l.set(key, value, 60 * 60)));
        return value;
      }
    }
    return undefined;
  }

  async set(key: string, value: unknown, ttlSeconds: number) {
    await Promise.all(this.layers.map((l) => l.set(key, value, ttlSeconds)));
  }
}

/** Upstash credentials under either naming (our own, or what Vercel's Upstash integration injects). */
function upstashEnv() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : undefined;
}

/** The shared Redis store on its own, or undefined when it isn't configured (used by scripts). */
export function remoteStore(): CacheStore | undefined {
  const env = upstashEnv();
  return env ? new UpstashStore(env.url, env.token) : undefined;
}

function createStore(): CacheStore {
  const memory = new MemoryStore();
  const env = upstashEnv();
  if (env) return new LayeredStore([memory, new UpstashStore(env.url, env.token)]);
  if (!process.env.VERCEL) {
    return new LayeredStore([memory, new FileStore(path.join(process.cwd(), ".cache"))]);
  }
  return memory;
}

export const cache: CacheStore = createStore();

// ---------- counters (rate limits, budgets) ----------

const upstash = (() => {
  const env = upstashEnv();
  return env ? new UpstashStore(env.url, env.token) : undefined;
})();
const memoryCounters = new Map<string, { count: number; resetAt: number }>();

/**
 * Increment a counter that resets every `windowSeconds`, and return the new count.
 * Shared across server instances when Upstash is configured; per instance otherwise.
 */
export async function incrementCounter(key: string, windowSeconds: number): Promise<number> {
  if (upstash) {
    try {
      const count = Number(await upstash.command(["INCR", `fanmap:count:${key}`]));
      if (count === 1) await upstash.command(["EXPIRE", `fanmap:count:${key}`, windowSeconds]);
      return count;
    } catch {
      // fall through to memory if Redis is unreachable
    }
  }
  const now = Date.now();
  const entry = memoryCounters.get(key);
  if (!entry || entry.resetAt < now) {
    memoryCounters.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return 1;
  }
  entry.count++;
  return entry.count;
}

export function cacheKey(...parts: unknown[]) {
  return createHash("sha1").update(JSON.stringify(parts)).digest("hex");
}

/** Return the cached value, or compute it, store it and return it. Concurrent calls share one computation. */
const inFlight = new Map<string, Promise<unknown>>();

export async function cached<T>(key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
  const hit = await cache.get<T>(key);
  if (hit !== undefined) return hit;

  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = (async () => {
    try {
      const value = await compute();
      await cache.set(key, value, ttlSeconds);
      return value;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
}
