// Pre-run the UI examples so they replay instantly from the plan cache.
// Uses Upstash when UPSTASH_REDIS_REST_URL/TOKEN are set (warms production), else the local cache.
//   npm run warm              # run examples that aren't cached yet
//   npm run warm -- --fresh   # re-run all of them
//   npm run warm -- cains     # only examples whose id contains "cains"
import { EXAMPLES } from "@/lib/examples";
import { getCachedPlan, runPlan } from "@/lib/runPlan";

const args = process.argv.slice(2);
const fresh = args.includes("--fresh");
const filter = args.find((a) => !a.startsWith("--"));

(async () => {
  const target = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL ? "Upstash (shared)" : "local .cache";
  console.log(`Warming ${filter ? `examples matching "${filter}"` : "all examples"} into ${target}\n`);
  let total = 0;
  for (const ex of EXAMPLES.filter((e) => !filter || e.id.includes(filter))) {
    if (!fresh && (await getCachedPlan(ex.input))) {
      console.log(`- ${ex.id}: already cached`);
      continue;
    }
    const t0 = Date.now();
    try {
      const { plan } = await runPlan(ex.input, () => {}, { fresh: true });
      const cost = plan.run?.usage?.estimatedCostUsd ?? 0;
      total += cost;
      const cachedNow = !!(await getCachedPlan(ex.input));
      console.log(
        `✓ ${ex.id}: ${plan.run?.engine}, ${((Date.now() - t0) / 1000).toFixed(0)}s, ~$${cost.toFixed(3)}${cachedNow ? "" : "  (NOT cached: agent didn't run)"}`,
      );
    } catch (err) {
      console.log(`✗ ${ex.id}: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`\nDone. Estimated cost this run: ~$${total.toFixed(3)}`);
})();
