// Run artist mode end-to-end from the terminal.
// npm run plan -- "Phoebe Bridgers" --region="United States" --shows=10 --size=club --start="Los Angeles"
// Full JSON is saved to .cache/plans/ (git-ignored: it contains Qloo data).
import { mkdirSync, writeFileSync } from "node:fs";
import { runArtistPlan } from "@/lib/engine/artistPlan";
import type { ArtistPlanInput, PlanEvent } from "@/lib/types";

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const artist = args.find((a) => !a.startsWith("--"));
if (!artist) {
  console.error('Usage: npm run plan -- "Artist name" [--region=...] [--shows=10] [--size=club|theatre|arena] [--start=City]');
  process.exit(1);
}

const input: ArtistPlanInput = {
  mode: "artist",
  artist,
  region: flag("region"),
  shows: flag("shows") ? Number(flag("shows")) : undefined,
  venueSize: flag("size") as ArtistPlanInput["venueSize"],
  startCity: flag("start"),
};

const t0 = Date.now();
const onEvent = (e: PlanEvent) => {
  const t = `${((Date.now() - t0) / 1000).toFixed(1)}s`.padStart(6);
  if (e.type === "step") {
    const icon = { running: "…", done: "✓", failed: "✗", skipped: "-" }[e.status];
    if (e.status !== "running") console.log(`${t} ${icon} ${e.label}${e.detail ? `: ${e.detail}` : ""}${e.ms ? ` (${e.ms} ms)` : ""}`);
  } else if (e.type === "notice") console.log(`${t} ! ${e.notice.message}`);
};

runArtistPlan(input, onEvent)
  .then((plan) => {
    console.log(`\n== ${plan.artist.name} · ${plan.region.name} · ${plan.audience?.summary ?? ""}`);
    console.log(`   openers: ${plan.openers.slice(0, 5).map((o) => `${o.name}${o.smaller ? "" : "*"}`).join(", ")}`);
    console.log(`   brands:  ${plan.brands.slice(0, 6).map((b) => b.name).join(", ")}`);
    console.log("\n   route:");
    for (const stop of plan.route) {
      const city = plan.cities.find((c) => c.place.label === stop.cityLabel)!;
      console.log(`   day ${String(stop.day + 1).padStart(2)} ${stop.cityLabel.padEnd(30)} ${String(stop.km).padStart(5)} km  score ${city.score}  ${city.stats.topShare}`);
      console.log(`          venues: ${city.venues.map((v) => `${v.name} (${v.category})`).join(" | ") || "none"}`);
      console.log(`          local:  ${city.localOpeners.map((o) => `${o.name}${o.confirmedLocal ? " ✓local" : ""} ${o.fit}`).join(" | ") || "none"}`);
      console.log(`          spots:  ${city.spots.map((s) => `${s.name} (${s.category})`).join(" | ") || "none"}`);
    }
    mkdirSync(".cache/plans", { recursive: true });
    const file = `.cache/plans/${plan.artist.name.replace(/\W+/g, "-")}-${plan.region.code}.json`;
    writeFileSync(file, JSON.stringify(plan, null, 2));
    console.log(`\n   saved ${file} · ${((Date.now() - t0) / 1000).toFixed(1)}s total`);
  })
  .catch((err) => {
    console.error("\nFAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
