import type { QlooEntity } from "@/lib/qloo/api";
import type { ArtistRef } from "@/lib/types";

/** Run async work over items with at most `limit` running at once (keeps us polite to the API). */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Like mapLimit, but a failed item becomes `undefined` instead of failing everything. */
export async function mapSettled<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>) {
  return mapLimit(items, limit, async (item, i) => {
    try {
      return await fn(item, i);
    } catch (err) {
      console.warn("[fanmap] step failed:", err instanceof Error ? err.message : err);
      return undefined;
    }
  });
}

export const normName = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Qloo sometimes returns the same act twice, or a cut-off name next to the full one
 * ("Har" next to "Har Mar Superstar"). Keep the first (highest ranked) full name.
 */
export function dedupeEntities<T extends { id: string; name: string }>(items: T[]): T[] {
  const ids = new Set<string>();
  const names = items.map((i) => normName(i.name));
  return items.filter((item, i) => {
    if (ids.has(item.id)) return false;
    const n = names[i];
    if (!n) return false;
    // drop a name that is a strict word-prefix of another name in the list
    const isFragment = names.some((other, j) => j !== i && other !== n && other.startsWith(n + " "));
    // drop a later exact duplicate name
    const isDuplicate = names.findIndex((other) => other === n) < i;
    if (isFragment || isDuplicate) return false;
    ids.add(item.id);
    return true;
  });
}

/** Qloo labels artist genres differently per endpoint: urn:tag:genre, urn:tag:genre:music, urn:tag:genre:qloo. */
export const isGenreTag = (t: { type: string }) =>
  t.type === "urn:tag:genre" || t.type === "urn:tag:genre:music" || t.type === "urn:tag:genre:qloo";

/** Unique genre names for an artist, most important first. */
export const genreNames = (e: QlooEntity) => [...new Set(e.tags.filter(isGenreTag).map((t) => t.name.replace(/\s+-\s+/g, " ")))];

export function toArtistRef(e: QlooEntity): ArtistRef {
  const genres = genreNames(e).slice(0, 4);
  return {
    id: e.id,
    name: e.name,
    image: e.image,
    description: e.description,
    genres,
    listeners: e.listeners,
    popularity: e.popularity,
  };
}

export const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;
