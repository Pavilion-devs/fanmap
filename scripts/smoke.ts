// Smoke test for the Qloo client, cache and city index.
// Run: npm run smoke -- "Phoebe Bridgers" "United States"
import { searchEntities, heatmap, demographics, insightsEntities, compare, point } from "@/lib/qloo/api";
import { representativeCity, cityLabel, findCity, findCountry } from "@/lib/geo/cities";

const artistName = process.argv[2] ?? "Phoebe Bridgers";
const regionArg = process.argv[3] ?? "United States";

async function timed<T>(label: string, fn: () => Promise<T>) {
  const t = Date.now();
  const value = await fn();
  console.log(`  ${label}: ${Date.now() - t} ms`);
  return value;
}

async function main() {
  const country = findCountry(regionArg);
  if (!country) throw new Error(`Unknown country: ${regionArg}`);
  console.log(`\n== ${artistName} in ${country.name}`);

  const [artist] = await timed("search", () => searchEntities(artistName));
  if (!artist) throw new Error("artist not found");
  console.log(`  found: ${artist.name} (${artist.id}), listeners ${artist.listeners ?? "?"}`);

  const map = await timed("heatmap", () => heatmap([artist.id], country.name));
  console.log(`  areas: ${map.totalCells} total, kept ${map.cells.length}`);

  // group top cells by representative city
  const byCity = new Map<number, { label: string; cells: number; best: number; pop: number }>();
  for (const cell of map.cells) {
    const city = representativeCity(cell.lat, cell.lon);
    if (!city || city.country !== country.code) continue;
    const entry = byCity.get(city.id) ?? { label: cityLabel(city), cells: 0, best: cell.affinityRank, pop: city.population };
    entry.cells++;
    entry.best = Math.max(entry.best, cell.affinityRank);
    byCity.set(city.id, entry);
  }
  console.log("  top cities (from top areas):");
  [...byCity.values()]
    .sort((a, b) => b.best - a.best)
    .slice(0, 12)
    .forEach((c, i) => console.log(`   ${String(i + 1).padStart(2)}. ${c.label}  rank ${c.best.toFixed(5)}  areas ${c.cells}  pop ${c.pop.toLocaleString()}`));

  const demo = await timed("demographics", () => demographics([artist.id]));
  console.log("  audience:", JSON.stringify(demo));

  const similar = await timed("similar artists", () => insightsEntities("urn:entity:artist", { "signal.interests.entities": artist.id }, 5));
  console.log("  similar:", similar.map((s) => s.name).join(", "));

  const top = [...byCity.values()].sort((a, b) => b.best - a.best)[0];
  const topCity = top && findCity(top.label)[0];
  if (topCity) {
    const places = await timed(`places near ${top.label}`, () =>
      insightsEntities("urn:entity:place", { "signal.interests.entities": artist.id, "filter.location": point(topCity.lat, topCity.lon), "filter.location.radius": 15000 }, 6),
    );
    console.log("  places:", places.map((p) => p.name).join(" | "));
  }

  if (similar[0]) {
    const shared = await timed("compare with top similar", () => compare([artist.id], [similar[0].id], 5));
    console.log(`  shared with ${similar[0].name}:`, shared.map((t) => t.name).join(", "));
  }

  console.log("\n  city lookups:", ["Portland, ME", "Portland", "Lagos", "Paris, France", "Northampton, MA"].map((q) => `${q} → ${findCity(q)[0] ? cityLabel(findCity(q)[0]) : "none"}`).join(" ; "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
