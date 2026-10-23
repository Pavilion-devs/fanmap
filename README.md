# Fanmap

**Find where your fans actually are.** Fanmap is an AI agent for touring and booking, built on [Qloo](https://www.qloo.com)'s taste graph.

- **Artist mode: "Where should I tour?"** Fanmap maps where an artist's fans are concentrated, ranks tour cities, plans the route, and picks venues, local openers, support acts and brand partners. Claude writes a tour brief a promoter can use.
- **Venue mode: "Who should I book?"** Fanmap finds the acts a specific venue's fans love, sized to the room, plus the local scene, double bills and sponsors, and writes a booking brief.

Every plan is compared with what an AI says **without** Qloo data. Example: for a Phoebe Bridgers US tour, 6 of Fanmap's 8 cities (Northampton MA, Portland ME, Burlington VT…) don't appear in the generic answer (New York, LA, Chicago…).

Built for the [Qloo Agentic Hackathon](https://qloo.devpost.com/). Live at [fanmap.xyz](https://fanmap.xyz).

## How it works

```
Browser ──POST /api/plan──▶ plan cache? ──yes──▶ replay recorded steps + plan (instant)
                                  │no
                                  ▼
                     Claude agent (tool loop)  ──fails──▶ data pipeline (no LLM)
                                  │ tools
                                  ▼
                Fanmap engine (Qloo + offline world city index)
   fan map → metro clusters → ranked cities · venues · local acts · route · audience · brands
```

- **Qloo calls used:** search (artists, places), Insights for artists, places, brands and demographics, heatmaps (fan concentration by area), `filter.results.entities` (scoring a fixed list), and compare (shared taste).
- **The agent** (Claude, manual tool loop) decides what to look at, follows the user's wishes ("skip New York", "end in Oklahoma", "more hip hop nights"), and writes the plan. Its notes and every tool call stream to the browser as they happen.
- **Without Qloo:** the same model gets the same question with no tools; the answers are compared city by city (by distance) or act by act.
- **Honest framing:** results show where fans' *taste* is concentrated, not ticket sales.

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
| `ANTHROPIC_API_KEY` | The agent and the "without Qloo" comparison (without it, plans come from the data pipeline) |
| `ANTHROPIC_MODEL` | Optional; defaults to `claude-opus-5-5` |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Production: shared cache, plan cache and rate limits across server instances |
| `FANMAP_FRESH_PLANS_PER_HOUR` | Optional; new (uncached) plans per visitor per hour, default 6 |
| `FANMAP_CACHED_PLANS_PER_HOUR` | Optional; cached replays per visitor per hour, default 60 |
| `FANMAP_AGENT_RUNS_PER_DAY` | Optional; site-wide daily cap on agent runs, default 300 (after that, plans use the data pipeline) |

## Commands

```bash
npm run dev            # the app
npm test               # unit tests (made-up data; Qloo responses are never stored in the repo)
npm run lint && npm run typecheck

# the engine from the terminal
npm run plan -- "Zach Bryan" --shows=8 --size=club                       # artist mode, data pipeline only
npm run agent -- "Phoebe Bridgers" --shows=8 --start="Seattle" --notes="skip New York"   # artist mode, full agent
npm run venue -- "First Avenue, Minneapolis" --capacity=1550             # venue mode, data pipeline only
npm run venue-agent -- "Cain's Ballroom, Tulsa" --capacity=1700          # venue mode, full agent
npm run warm                                                             # pre-run the UI examples into the plan cache
```

## API

`POST /api/plan` streams newline-delimited JSON events (types in [`src/lib/types.ts`](src/lib/types.ts)):

```jsonc
// artist mode
{ "mode": "artist", "artist": "Phoebe Bridgers", "region": "United States", "shows": 8,
  "venueSize": "club|theatre|arena|any", "startCity": "Seattle", "notes": "skip New York" }
// venue mode
{ "mode": "venue", "venue": "First Avenue, Minneapolis", "capacity": 1550, "genres": ["indie"], "notes": "..." }
```

Events: `step` (a tool call starting/finishing), `thought` (the agent's notes), `partial` (a piece of the plan is ready), `notice`, then `result` or `error`. Identical requests replay from the plan cache. Visitors are rate-limited (HTTP 429 with `Retry-After`).

## Project layout

```
src/app/api/plan/   Streaming API route
src/lib/runPlan.ts  Plan cache + replay, daily agent budget
src/lib/plan.ts     Planner: agent or pipeline, baseline comparison, input validation
src/lib/agent/      Claude agent loop, artist and venue agents, comparison, briefs, usage/cost
src/lib/engine/     Fanmap engine: city ranking, venues, local acts, route, venue picks
src/lib/qloo/       Qloo API client (server-only, cached, paged, rate-limited) and typed endpoints
src/lib/geo/        Offline world city index: map areas → city names, name lookups
src/lib/limits.ts   Per-visitor rate limits and daily budget
src/lib/examples.ts One-click examples (pre-run with npm run warm)
tests/              Unit tests
```

## Data and credits

- Taste data: [Qloo](https://www.qloo.com) Insights API. Responses are cached privately on the server and are never stored in this repo.
- City data: [GeoNames](https://www.geonames.org) `cities15000`, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Rebuild with `npm run build:cities` after downloading the files listed in `scripts/build-cities.mjs` into `data-raw/`.
- AI: [Claude](https://www.anthropic.com) by Anthropic.

## License

[MIT](LICENSE)
