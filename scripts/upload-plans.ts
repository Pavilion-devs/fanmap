// Copy the plans saved in the local .cache into the shared Upstash cache, so production replays
// them without re-running the agent. Needs the Upstash URL and token in .env (either naming).
//   npm run upload-plans                # keep each plan's remaining time
//   npm run upload-plans -- --days=30   # give every plan a fresh 30 days (e.g. through judging)
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { remoteStore } from "@/lib/cache";
import type { Plan } from "@/lib/types";

const DIR = path.join(process.cwd(), ".cache");
const days = Number(process.argv.find((a) => a.startsWith("--days="))?.split("=")[1]);

(async () => {
  // uploads from a laptop can take several seconds each, well past the app's 5 s limit
  const remote = remoteStore(60_000);
  if (!remote) throw new Error("Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL / KV_REST_API_TOKEN) in .env first.");

  let copied = 0;
  for (const file of await readdir(DIR)) {
    if (!file.endsWith(".json")) continue;
    const entry = JSON.parse(await readFile(path.join(DIR, file), "utf8")) as { value?: { plan?: Plan; events?: unknown[] }; expires: number };
    const plan = entry.value?.plan;
    if (!plan || !Array.isArray(entry.value?.events)) continue; // only saved plans, not raw Qloo responses
    const ttl = days > 0 ? Math.round(days * 86400) : Math.floor((entry.expires - Date.now()) / 1000);
    if (ttl < 60) continue;
    await remote.set(file.replace(/\.json$/, ""), entry.value, ttl);
    const back = await remote.get(file.replace(/\.json$/, ""));
    const name = plan.mode === "artist" ? `${plan.artist.name} · ${plan.region.name}` : plan.venue.name;
    console.log(`${back ? "✓" : "✗"} ${name} (${Math.round(ttl / 86400)} days left)`);
    if (back) copied++;
  }
  console.log(`\n${copied} plans copied to Upstash.`);
})().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
