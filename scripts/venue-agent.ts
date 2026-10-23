// Run the full venue planner (agent + baseline comparison, with pipeline fallback) from the terminal.
// npm run venue-agent -- "First Avenue, Minneapolis" --capacity=1550 --genres="indie" --notes="more hip hop nights"
import { planVenue, validateVenueInput } from "@/lib/plan";
import type { PlanEvent } from "@/lib/types";

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const input = validateVenueInput({
  venue: args.find((a) => !a.startsWith("--")),
  capacity: flag("capacity"),
  genres: flag("genres"),
  notes: flag("notes"),
});

const t0 = Date.now();
const time = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`.padStart(6);
const onEvent = (e: PlanEvent) => {
  if (e.type === "step" && e.status !== "running") console.log(`${time()} ${e.status === "done" ? "✓" : "✗"} ${e.label}${e.detail ? `: ${e.detail}` : ""}`);
  else if (e.type === "thought") console.log(`${time()} 💭 ${e.text}`);
  else if (e.type === "notice") console.log(`${time()} ! ${e.notice.message}`);
};

planVenue(input, onEvent)
  .then((plan) => {
    console.log(`\n== ${plan.venue.name} · ${plan.venue.place.label} · ${plan.sizeBand} · engine: ${plan.run?.engine}${plan.run?.fallbackReason ? ` (fallback: ${plan.run.fallbackReason})` : ""}`);
    console.log(`   ${plan.run?.turns ?? 0} turns, ${plan.run?.toolCalls.length ?? 0} tool calls, ${((plan.run?.ms ?? 0) / 1000).toFixed(1)}s`);
    console.log(`\n   HEADLINE: ${plan.headline}`);
    if (plan.comparison) {
      console.log(`\n   COMPARISON: ${plan.comparison.headline}`);
      console.log(`     generic AI: ${plan.comparison.llmOnly.items.join(", ")}`);
      console.log(`     only Fanmap: ${plan.comparison.onlyFanmap.join(", ")}`);
    }
    console.log(`\n${plan.brief?.markdown ?? ""}`);
  })
  .catch((err) => {
    console.error("\nFAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
