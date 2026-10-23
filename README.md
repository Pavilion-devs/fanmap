# Fanmap

**Find where your fans actually are.** Fanmap is an AI agent that plans tours and bookings using [Qloo](https://www.qloo.com)'s taste data.

- **Artist mode:** "Where should I tour?" Fanmap finds the cities where an artist's fans are concentrated, plans the route, and picks openers, venues and sponsors.
- **Venue mode:** "Who should I book?" Fanmap finds the artists whose fans are concentrated near a venue, plus local openers, double bills and sponsors.

Built for the [Qloo Agentic Hackathon](https://qloo.devpost.com/). Live at [fanmap.xyz](https://fanmap.xyz).

> Work in progress. See [plan.md](plan.md) for the full plan.

## Run it locally

Requires Node 20+.

```bash
npm install
cp .env.example .env   # then add your keys
npm run dev
```

| Variable | Needed for |
|---|---|
| `QLOO_API_KEY` | All Qloo calls (hackathon key) |
| `QLOO_BASE_URL` | Defaults to `https://hackathon.api.qloo.com` |
| `ANTHROPIC_API_KEY` | The planning agent |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Optional: shared cache in production (otherwise in-memory, plus `.cache/` locally) |

Try the engine from the terminal:

```bash
npm run smoke -- "Phoebe Bridgers" "United States"     # check the Qloo connection
npm run cities -- "Zach Bryan|United States"             # ranked tour cities only
npm run plan -- "Phoebe Bridgers" --region="United Kingdom" --shows=8 --size=theatre   # full artist plan
```

## Project layout

```
src/lib/qloo/     Qloo API client (server-only, cached, retries) and typed endpoints
src/lib/geo/      Offline world city index: map areas → city names, name lookups
src/lib/engine/   Fanmap engine: city ranking, venues, local openers, route, artist plan
src/lib/cache.ts  Server-side cache (memory → Upstash Redis or local files)
src/lib/types.ts  Output format shared by the engine and the UI
src/data/         Processed city list
scripts/          Data build and smoke test
```

## Data and credits

- Taste data: [Qloo](https://www.qloo.com) Insights API. Responses are cached privately on the server and are never stored in this repo.
- City data: [GeoNames](https://www.geonames.org) `cities15000`, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Rebuild with `npm run build:cities` after downloading the files listed in `scripts/build-cities.mjs` into `data-raw/`.

## License

[MIT](LICENSE)
