// Run venue mode (data pipeline only) from the terminal.
// npm run venue -- "First Avenue, Minneapolis" --capacity=1550 --genres="indie,hip hop"
import { runVenuePlan } from "@/lib/engine/venuePlan";
import type { PlanEvent } from "@/lib/types";

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const venue = args.find((a) => !a.startsWith("--"));
if (!venue) {
  console.error('Usage: npm run venue -- "Venue, City" [--capacity=1500] [--genres="indie,folk"]');
  process.exit(1);
}

const t0 = Date.now();
const onEvent = (e: PlanEvent) => {
  const t = `${((Date.now() - t0) / 1000).toFixed(1)}s`.padStart(6);
  if (e.type === "step" && e.status !== "running") console.log(`${t} ${e.status === "done" ? "✓" : "✗"} ${e.label}${e.detail ? `: ${e.detail}` : ""}`);
  else if (e.type === "notice") console.log(`${t} ! ${e.notice.message}`);
};

runVenuePlan(
  {
    mode: "venue",
    venue,
    capacity: flag("capacity") ? Number(flag("capacity")) : undefined,
    genres: flag("genres")?.split(",").map((g) => g.trim()),
  },
  onEvent,
)
  .then((p) => {
    console.log(`\n== ${p.venue.name} (${p.venue.category ?? "city"}) · ${p.venue.place.label} · ${p.sizeBand}`);
    console.log(`   crowd: ${p.crowd?.summary ?? "-"}`);
    console.log("   picks:");
    for (const x of p.picks) console.log(`     ${String(x.fit).padStart(3)} ${x.artist.name.padEnd(30)} pop ${x.artist.popularity.toFixed(3)} ${x.localDraw ? "local-draw " : ""}${x.confirmedLocal ? "✓local" : ""}  [${x.artist.genres.slice(0, 2).join(", ")}]`);
    console.log(`   local acts: ${p.localOpeners.map((o) => `${o.name}${o.confirmedLocal ? " ✓" : ""} ${o.fit}`).join(" | ") || "none"}`);
    console.log("   double bills:");
    for (const b of p.doubleBills) console.log(`     ${b.headliner.name} + ${b.support.name}: ${b.reason}`);
    console.log(`   brands: ${p.brands.map((b) => b.name).join(", ")}`);
    console.log(`   ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  })
  .catch((err) => {
    console.error("FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
