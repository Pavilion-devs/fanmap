// Run the full planner (agent + baseline comparison, with pipeline fallback) from the terminal.
// npm run agent -- "Phoebe Bridgers" --region="United States" --shows=8 --start="Seattle" --notes="skip New York"
import { mkdirSync, writeFileSync } from "node:fs";
import { planArtist, validateArtistInput } from "@/lib/plan";
import type { PlanEvent } from "@/lib/types";

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const artist = args.find((a) => !a.startsWith("--"));

const input = validateArtistInput({
  artist,
  region: flag("region"),
  shows: flag("shows"),
  venueSize: flag("size"),
  startCity: flag("start"),
  notes: flag("notes"),
});

const t0 = Date.now();
const time = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`.padStart(6);
const onEvent = (e: PlanEvent) => {
  if (e.type === "step" && e.status !== "running") {
    const icon = { done: "✓", failed: "✗", skipped: "-", running: "…" }[e.status];
    console.log(`${time()} ${icon} ${e.label}${e.detail ? `: ${e.detail}` : ""}`);
  } else if (e.type === "thought") console.log(`${time()} 💭 ${e.text}`);
  else if (e.type === "notice") console.log(`${time()} ! ${e.notice.message}`);
  else if (e.type === "partial") console.log(`${time()}   [partial: ${e.key}]`);
};

planArtist(input, onEvent)
  .then((plan) => {
    console.log(`\n== ${plan.artist.name} · ${plan.region.name} · engine: ${plan.run?.engine}${plan.run?.fallbackReason ? ` (fallback: ${plan.run.fallbackReason})` : ""}`);
    console.log(`   ${plan.run?.turns ?? 0} turns, ${plan.run?.toolCalls.length ?? 0} tool calls, ${((plan.run?.ms ?? 0) / 1000).toFixed(1)}s`);
    console.log(`\n   HEADLINE: ${plan.headline}`);
    if (plan.comparison) {
      console.log(`\n   COMPARISON: ${plan.comparison.headline}`);
      console.log(`     generic AI: ${plan.comparison.llmOnly.items.join(", ")}`);
      console.log(`     only Fanmap: ${plan.comparison.onlyFanmap.join(", ")}`);
    }
    console.log("\n   CITIES:");
    for (const c of plan.cities) console.log(`   - ${c.place.label}: ${c.reason}`);
    console.log(`\n${plan.brief?.markdown ?? ""}`);
    mkdirSync(".cache/plans", { recursive: true });
    const file = `.cache/plans/agent-${plan.artist.name.replace(/\W+/g, "-")}-${plan.region.code}.json`;
    writeFileSync(file, JSON.stringify(plan, null, 2));
    console.log(`\n   saved ${file}`);
  })
  .catch((err) => {
    console.error("\nFAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
