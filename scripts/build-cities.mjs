// Builds src/data/cities.json from GeoNames dumps in ./data-raw (CC BY 4.0, https://www.geonames.org).
// Download first:
//   https://download.geonames.org/export/dump/cities15000.zip  (unzip → cities15000.txt)
//   https://download.geonames.org/export/dump/admin1CodesASCII.txt
//   https://download.geonames.org/export/dump/countryInfo.txt
// Run: node scripts/build-cities.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const raw = (f) => readFileSync(`data-raw/${f}`, "utf8").split("\n").filter((l) => l && !l.startsWith("#"));

const countries = {};
for (const line of raw("countryInfo.txt")) {
  const c = line.split("\t");
  countries[c[0]] = { name: c[4], continent: c[8], population: Number(c[7]) || 0 };
}

const admin1 = {};
for (const line of raw("admin1CodesASCII.txt")) {
  const [code, name] = line.split("\t");
  admin1[code] = name;
}

// Skip city sections/neighbourhoods (PPLX), abandoned/historical places.
const SKIP = new Set(["PPLX", "PPLH", "PPLQ", "PPLW"]);

const cities = [];
for (const line of raw("cities15000.txt")) {
  const c = line.split("\t");
  const featureCode = c[7];
  if (SKIP.has(featureCode)) continue;
  const cc = c[8];
  const admin1Code = c[10];
  cities.push([
    c[1], // name
    cc, // country code
    admin1[`${cc}.${admin1Code}`] ?? "", // region / state name
    admin1Code, // region code (US: state abbreviation)
    Math.round(Number(c[4]) * 1e4) / 1e4, // lat
    Math.round(Number(c[5]) * 1e4) / 1e4, // lon
    Number(c[14]) || 0, // population
    featureCode === "PPLC" ? 1 : 0, // capital
  ]);
}
cities.sort((a, b) => b[6] - a[6]);

mkdirSync("src/data", { recursive: true });
writeFileSync(
  "src/data/cities.json",
  JSON.stringify({
    source: "GeoNames cities15000 (CC BY 4.0, https://www.geonames.org)",
    fields: ["name", "country", "region", "regionCode", "lat", "lon", "population", "capital"],
    countries,
    cities,
  }),
);
console.log(`${cities.length} cities, ${Object.keys(countries).length} countries`);
