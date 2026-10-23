// Print ranked tour cities for artists, to tune the ranking.
// Run: npm run cities -- "Phoebe Bridgers|United States" "Burna Boy|United Kingdom" [--size=club]
import { searchEntities, heatmap } from "@/lib/qloo/api";
import { findCountry } from "@/lib/geo/cities";
import { rankCities, topShareLabel, type VenueSize } from "@/lib/engine/cities";

const args = process.argv.slice(2);
const size = (args.find((a) => a.startsWith("--size="))?.split("=")[1] ?? "any") as VenueSize;
const jobs = args.filter((a) => !a.startsWith("--"));

async function run(job: string) {
  const [name, regionName = "United States"] = job.split("|");
  const country = findCountry(regionName);
  if (!country) throw new Error(`Unknown country ${regionName}`);
  const [artist] = await searchEntities(name);
  if (!artist) throw new Error(`No artist ${name}`);
  const map = await heatmap([artist.id], country.name);
  const cities = rankCities(map, country.code, { venueSize: size, limit: 15 });
  console.log(`\n== ${artist.name} · ${country.name} · ${map.totalCells} areas · size=${size}`);
  for (const [i, c] of cities.entries()) {
    const p = c.parts;
    console.log(
      `${String(i + 1).padStart(3)}. ${c.label.padEnd(28)} ${String(c.score).padStart(5)}  ${topShareLabel(c.topShare).padEnd(10)} areas ${String(c.cells).padStart(3)}  market ${(c.marketPopulation / 1e6).toFixed(2)}M  [t ${p.taste.toFixed(2)} d ${p.depth.toFixed(2)} m ${p.market.toFixed(2)} a ${p.activity.toFixed(2)}]  ${c.nearby.join(", ")}`,
    );
  }
}

(async () => {
  for (const job of jobs.length ? jobs : ["Phoebe Bridgers|United States"]) await run(job);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
