# Fanmap: build plan (Qloo Agentic Hackathon)

> Name: **Fanmap**, live at **fanmap.xyz** (domain already owned)
> Builder: solo
> Deadline: **Thu Oct 30, 2026, 11:45 pm ET**. Our own target: **submit Wed Oct 29**, keeping Thursday as buffer.
> Finals: top 3 present live on **Nov 5** (Jason Calacanis, Cedric the Entertainer, Alex Elias).

---

## 1. The idea in one sentence

**An AI tour-planning agent for independent artists, managers and small promoters. It uses Qloo's taste data to find the cities where an artist's fans are concentrated, then plans the route, picks openers, finds matching venues and sponsors, and writes a tour brief ready to send to promoters.**

### Who it's for
- **Main user:** a manager or booking agent for a mid-size artist (roughly 50k to 2M monthly listeners). They have no data team and plan tours with spreadsheets and gut feel.
- **Second user (core feature, built second):** a venue owner or promoter asking "who should I book here?"

### The problem
Each show is a bet costing thousands in venue fees, travel and marketing. Picking the wrong city means an empty room. Big agencies have data; everyone else guesses, and an LLM guesses too (it always says NYC, LA, Chicago, Austin).

### Why it only works with Qloo
Qloo knows **where an artist's fans are concentrated, down to about city level**. An LLM can't know that. Verified on Oct 23:

| Artist | LLM-style guess | What Qloo's data shows |
|---|---|---|
| Phoebe Bridgers | NYC, LA, Chicago | Western Mass college towns (Amherst/Northampton), Portland ME, Portland OR, Burlington VT |
| Zach Bryan | Nashville, Texas | Oklahoma (Tulsa/Stillwater area), Montana, Wyoming |
| MJ Lenderman | Asheville, NYC | Central Texas, northern Wisconsin, Western Mass |
| Phoebe Bridgers (UK) | London, Manchester | **Edinburgh and Glasgow** |

Then the agent names **actual venues**: for Phoebe Bridgers in Northampton it returned *John M. Greene Hall* and *The Iron Horse*, both real music venues.

---

## 2. What the judges score and how we earn each point

All four criteria are weighted equally. **Ties are broken by Technological Implementation first.**

| Criterion | How we win it |
|---|---|
| **Technological Implementation** (deep use of Qloo) | 7+ Qloo endpoints chained by an agent: search, heatmap, similar artists, location-based artists, audience data, brands, places, compare. Real data processing (map areas → cities, ranking, removing duplicates). An agent loop that shows each step. |
| **Design** (a complete product) | One clean flow: type an artist → watch the agent work → get a map, a route, city cards and a tour brief to download or share. No login. Example artists preloaded. Works on a phone. |
| **Potential Impact** (real problem, real audience) | A specific user (indie managers and agents) and a real cost (empty rooms). Clear honest framing: "where your fans' taste is concentrated," not a promise of ticket sales. |
| **Quality of the Idea** (creative, non-obvious) | Uses Qloo for **business decisions**, not "recommend me a movie." The side-by-side panel proves our answer beats an LLM on its own. Venue mode turns the same question around. |

### Judge-by-judge
- **Mike Diolosa (Qloo CTO):** depth and correctness of API use. Show the agent's steps.
- **Jason Calacanis:** "Is this a business?" A clear pricing line and market in the description. He also invests $25K in his favourite entry.
- **Michael Abrams (Live Nation):** live music is his world. Optional Ticketmaster data (Live Nation owns Ticketmaster).
- **Todd Boehly:** consumer, media and sports. Mention how the engine extends to comedy tours, sports exhibition games and festivals.
- **Cedric the Entertainer:** must be fun and clear in 10 seconds. Comedy tours are a natural example on stage.
- **Nicole Seligman:** responsible data use. Only aggregated, anonymous taste data; honest about the limits.

---

## 3. The product experience (what a judge clicks through)

0. **Onboarding (high standard, designed in Phase 2).** Rule: it must make a judge *want* to try the product within seconds, never slow them down. It shows the value right away (e.g. a live example of a fan map), and is skippable.
1. **Home page.** Choose a mode (artist or venue). For artist mode, one input: "Which artist are you planning a tour for?" Below it, 4 to 6 example artists (cached so they load instantly), for example Phoebe Bridgers, Zach Bryan, MJ Lenderman, Wednesday.
2. **Options (optional, sensible defaults):** country or region (**US by default**, any country selectable), number of shows (8 to 15), start city, tour type (club / theatre). Stretch: a multi-country leg (e.g. "UK + Europe").
3. **Live agent run.** A panel shows each step as it happens, for example:
   - "Found Phoebe Bridgers in Qloo"
   - "Mapping where her fans are (7,000 areas)…"
   - "Top fan areas: Northampton MA, Portland ME, Burlington VT…"
   - "Finding openers who share her audience…"
   - "Finding venues in Northampton that match her fans…"
4. **Results page:**
   - **Fan map**, coloured by fan concentration, with the route drawn on it.
   - **The route:** cities in a sensible driving order, with dates spaced realistically.
   - **City cards:** why this city (data plus a plain-English reason), 2 to 3 matching venues, a suggested local opener, and spots for before and after the show.
   - **Audience:** age and gender breakdown.
   - **Sponsor matches:** brands her fans like (e.g. Fender, Dr. Martens, Polaroid), each with a one-line pitch.
   - **Tour brief:** a clean one-page summary to copy, download as PDF, or share by link.
5. **"With vs without Qloo" panel.** The same question answered by the LLM alone, side by side. Cities that appear only in our answer are highlighted. This is the proof screen.
6. **Venue mode (core feature).** "I run a venue in Minneapolis, who should I book?" The agent returns:
   - artists whose fans are concentrated near the venue, ranked by fit;
   - local acts for opening slots (the data returned Lizzo, Dessa, Har Mar Superstar and Caroline Smith, all from Minneapolis);
   - double bills that work (two artists whose audiences overlap, via compare);
   - the venue's likely crowd (age and gender) and brands to approach for sponsorship;
   - a booking brief to send to agents.

   Venue mode reuses most of artist mode's tools, so the engine is designed for both from Day 1.

---

## 4. How it works (architecture)

```
Browser (Next.js app)
   │  artist + options
   ▼
/api/plan  (server, streams progress)
   │
   ├─ Agent loop (Claude with tool calls)
   │     decides which tools to call, in what order, and writes the reasoning and brief
   │
   ├─ Tools (our code, each wraps Qloo calls + cleanup)
   │     find_artist, get_fan_map, rank_cities, find_openers, find_local_openers,
   │     get_audience, find_brands, find_venues, compare_artists, plan_route
   │
   ├─ Qloo client (API key, retries, caching on the server)
   └─ Geo helper (map areas → city names, offline city list)
```

### Tech choices
- **Next.js (TypeScript)** for the frontend and API routes, **hosted on Vercel** with the custom domain **fanmap.xyz** (public URL, meets the "hosted externally" rule). Point the domain at Vercel on Day 1 so DNS has time to settle.
- **Claude (Anthropic API)** for the agent loop with tool use. This meets the "agentic tool / agent framework" requirement. Check the latest model IDs and SDK usage with the `claude-api` reference before building.
- **Map:** MapLibre or Leaflet with free OpenStreetMap tiles.
- **Cache:** Upstash Redis (free tier) or Vercel KV for Qloo responses. Private server-side caching is allowed. **Never commit Qloo data to the repo.**
- **City names:** a free offline **worldwide** city list (GeoNames `cities15000`, about 25,000 cities with population and coordinates) bundled in the app; no external geocoding calls needed.
- **License:** MIT, visible in the GitHub About section (required).

### Qloo calls we use (all tested Oct 23)

| Tool | Qloo request | Result | Status |
|---|---|---|---|
| find_artist | `/search?types=urn:entity:artist` | id, genres, audience tags, Last.fm listeners | ✅ |
| get_fan_map | `/v2/insights?filter.type=urn:heatmap&signal.interests.entities=…&filter.location.query=United States` | ~7,000 areas with affinity, rank, popularity | ✅ slow (~9 s, 2 MB) |
| find_openers | `/v2/insights?filter.type=urn:entity:artist&signal.interests.entities=…` | similar artists | ✅ |
| find_local_openers | same, plus `signal.location` and genre tags | artists strong in that city | ✅ needs duplicate removal |
| get_audience | `/v2/insights?filter.type=urn:demographics&signal.interests.entities=…` | age and gender lean | ✅ |
| find_brands | `/v2/insights?filter.type=urn:entity:brand&signal.interests.entities=…` | brands fans like | ✅ |
| find_venues | `/v2/insights?filter.type=urn:entity:place&filter.location=POINT(lon lat)&filter.location.radius=…` | places fans like near a point | ✅ with coordinates (see 5.4) |
| compare_artists | `/v2/insights/compare?a…&b…` | shared taste tags | ✅ for co-headliner fit |

### 4.1 Output format (the contract between backend and frontend)
Agreed on Day 1, before the engine is built. Draft:
- **Progress events** streamed while the agent works, e.g. `{ type: "step", id, label, status: "running" | "done", detail? }`, so the UI can show each step live.
- **Partial results** sent as soon as they're ready (e.g. the fan map arrives before venues), so the UI can fill in progressively instead of waiting for everything.
- **Final result** for each mode, with clearly named parts:
  - Artist mode: `artist`, `audience`, `fanMap` (top areas), `cities[]` (score, reason, venues, local opener, spots), `route`, `openers[]`, `brands[]`, `comparison` (LLM-only vs Fanmap), `brief`.
  - Venue mode: `venue`, `crowd`, `artists[]` (fit score, reason), `localOpeners[]`, `doubleBills[]`, `brands[]`, `comparison`, `brief`.
- **Notices:** `limited_data`, `similar_artist_fallback`, etc., so the UI can explain them honestly.

---

## 5. Problems to solve (found in testing)

### 5.1 Map areas aren't city names
The fan map returns about 7,000 small map squares (around 20–40 km each) as coordinates, not cities.
**Fix:** for each square, find the nearest city in an offline city list (weighted by population). Group neighbouring squares into one metro area (e.g. the Amherst and Northampton squares both become "Pioneer Valley, MA"). Only cities above a minimum population count, since a show needs a venue and a crowd.

### 5.2 Top scores are bunched together
The top hundreds of areas all score 0.999…, so raw scores don't tell them apart.
**Fix:** rank by position (`affinity_rank`) and combine it with `popularity` (how much activity there is) and city size. Draft formula to tune:
`city_score = 0.6 × affinity_rank + 0.25 × popularity + 0.15 × size_factor`
Test on 10 or more artists and check the results look right to a music fan.

### 5.3 Rural outliers
Some top areas are near-empty places (for example a square in South Dakota for Phoebe Bridgers).
**Fix:** a population threshold, plus the popularity weighting above.

### 5.4 Searching by place name is unreliable
`filter.location.query=Portland, ME` matched a single neighbourhood and returned nothing useful.
**Fix:** always send coordinates (`POINT(lon lat)`) and a radius in metres. We get coordinates from our own city list.

### 5.5 The "music venue" filter barely works
Filtering places by Qloo's music venue tag returned 1 result in Portland, ME. Without the filter, results mix real venues (SPACE Gallery, The Iron Horse) with museums, libraries and hotels.
**Fix (pick on Day 2):**
- Option A: get a larger list of Qloo places and let the agent sort them into "performance venue" vs "pre/after-show spot" using names and tags.
- Option B: get real venue lists from the Ticketmaster Discovery API (free key) or OpenStreetMap, then use Qloo to rank them by fan match.
- Probably both: B for the venue list, Qloo for ranking and for the "pre/after-show" spots.

### 5.6 Duplicate or cut-off names
Location results returned "Har" next to "Har Mar Superstar" and "Haley" next to "Haley Bonar".
**Fix:** remove entries whose name is a prefix of another result's name, and remove duplicate ids.

### 5.7 Growth numbers are always zero
`audience_growth` came back as 0 everywhere. **Don't build features on it.** Check the trending endpoint once; if it's empty too, drop "momentum."

### 5.8 Speed
The fan map takes ~9 s and 2 MB; other calls take ~4 s. A full plan could take 30–60 s.
**Fix:**
- Cache every Qloo response on the server (by request URL).
- Shrink the fan map to the top ~300 areas right away and store only that.
- Run independent calls at the same time (audience, brands and openers don't depend on each other).
- Stream progress so the wait feels like watching the agent work, not a loading spinner.
- Precompute the example artists so the first click is instant.

### 5.9 Artists Qloo knows little about
Very small artists may have weak data.
**Fix:** check Last.fm listeners and popularity from `/search`. If the data is thin, build the fan map from the artist's 3 closest similar artists and tell the user honestly: "Not much data on you yet, so this is based on fans of artists like you."

### 5.10 Going global: data varies by country
Tested Oct 23 with Phoebe Bridgers: UK 6,787 areas (Edinburgh, Glasgow on top), Germany 1,280 (Berlin), Brazil 719 (Rio, São Paulo), Nigeria only 74 (Lagos).
**Fix:**
- US is the default; the country picker lists every country.
- Show a "limited data in this country" notice when the area count is low (draft threshold: under ~200 areas), and suggest fewer shows.
- Map squares are smaller in some countries (the UK uses finer squares), so group by distance in km, not by square size.
- Tour dates must allow for border crossings and longer travel in multi-country legs (stretch goal).

### 5.11 Keeping the key safe
The key is in `.env` (never committed). `.gitignore` also excludes caches and raw Qloo data. The public app only calls Qloo from the server, never from the browser.

---

## 6. The "with vs without Qloo" panel

- Ask Claude **without any tools** the same question: "Plan a 10-city US tour for [artist]. List cities and why."
- Run our agent.
- Show both lists side by side. Highlight cities only in our list, and for each one show the data reason (e.g. "fans here score in the top 0.1% nationally").
- Show a short line like "6 of 10 cities differ from the generic answer."
- Be fair: same model, same prompt wording, and we don't hide when they agree.

---

## 7. Day-by-day plan

**Approach: backend first, then frontend.** The core system (data engine, agent, both modes) is built and tested first, with no real UI, only a test script and a placeholder page. The frontend gets its own focused days to reach a high standard, including onboarding.

To keep the two halves from colliding, the backend is built against a **fixed output format** (section 4.1): the exact progress events and final result the frontend will receive. Once that's fixed, the UI can be designed freely without changing the engine.

**Phase 1: core system (backend)**

| Day | Date | Goal | Done when |
|---|---|---|---|
| 1 | Thu Oct 23 | Repo, Next.js project, Qloo client with caching, worldwide city list, output format agreed; placeholder page live on fanmap.xyz | Qloo calls work from code; fanmap.xyz shows a placeholder |
| 2 | Fri Oct 24 | Data engine, artist mode: fan map → ranked cities, openers, local openers, audience, brands, venues | Sensible city lists for 10 test artists in 3+ countries; venue approach picked (5.5) |
| 3 | Sat Oct 25 | Agent loop + progress streaming + tour brief + LLM-only comparison (artist mode) | One command produces a full artist plan with step-by-step progress |
| 4 | Sun Oct 26 | Venue mode on the same engine: who to book, local openers, double bills, crowd, sponsors, booking brief | One command produces a full venue plan; both modes tested on 20+ cases |

**Phase 2: frontend and launch**

| Day | Date | Goal | Done when |
|---|---|---|---|
| 5 | Mon Oct 27 | Design system, onboarding, input screens for both modes, live agent progress | A first-time visitor understands the product and starts a plan without help |
| 6 | Tue Oct 28 | Results: map, route, city/artist cards, comparison panel, briefs (share/PDF), phone layout | Full flow for both modes works end-to-end on fanmap.xyz |
| 7 | Wed Oct 29 | Polish, speed, preloaded examples, README, license, screenshots, Devpost description; **submit** | Submitted, with every required item checked (section 9) |
| 8 | Thu Oct 30 | Buffer: fixes and final polish. The submission can be edited until 11:45 pm ET | — |

**If we fall behind:** nothing gets cut from the scope. Instead, use Thursday's buffer and simplify the *least visible* parts first (e.g. PDF export becomes a share link). The comparison panel, the map, both modes and onboarding stay.

---

## 8. What to show in the demo (and on stage on Nov 5)

1. "Managers plan tours on gut feel. Ask AI and it says New York, LA, Chicago, for every artist."
2. Type Phoebe Bridgers. The agent works live.
3. "Our agent says: Northampton, Massachusetts. Here's why: her fans are concentrated there more than almost anywhere in the US. And here's the venue: The Iron Horse."
4. Show the side-by-side panel. "Six of these ten cities never appear in the generic answer."
5. Show the tour brief: "This goes straight to a promoter."
6. Close with the business: "Thousands of touring acts below arena level can't afford a data team. This is that data team, for a monthly fee."

---

## 9. Submission checklist (from the official rules)

- [ ] Live, publicly hosted demo URL (no local-only builds, no private access)
- [ ] Public GitHub repo with all source code and setup instructions
- [ ] Open-source license file (MIT), **visible in the repo's About section**
- [ ] Text description: what it does, key features, what makes it "Qloo-powered"
- [ ] Free and unrestricted access for judges until Nov 5 (no login; if any login exists, give test details)
- [ ] All in English
- [ ] No API keys or raw Qloo data in the repo
- [ ] Screenshots or images in the Devpost entry (judges may judge from these alone)
- [ ] Description written to map clearly onto the 4 criteria (AI screening is possible)
- [ ] Finalist availability: be ready to present live on Nov 5

---

## 10. Pitch lines for the description

- **One-liner:** "A data team for every touring artist: an agent that uses Qloo's taste data to find where your fans actually are and plans the tour around them."
- **Business:** subscription per artist or per venue for managers, agents and independent promoters. Expands to comedy tours, festivals, sports exhibition games and brand pop-ups.
- **Honest limits:** shows where fans' taste is concentrated, not guaranteed ticket sales; uses only aggregated, anonymous data.

---

## 11. Decisions (Oct 23)

1. **Name:** Fanmap, at fanmap.xyz.
2. **LLM:** Claude via the Anthropic API. You add `ANTHROPIC_API_KEY` to `.env` (and to Vercel's environment settings).
3. **Accounts:** GitHub and Vercel are ready.
4. **Team:** solo.
5. **Venue mode:** a core feature. Artist mode is built first and leads the stage demo; venue mode is built right after on the same engine (Day 4), not optional.
7. **Build order:** core system (backend) first, frontend second. The frontend gets a high-standard UI and a strong onboarding, with its own dedicated days.
6. **Region:** global, with the US as the default.

---

## 12. Progress log

### Day 1 (Oct 23): setup ✅
Next.js 16 app, cached Qloo client, world city index (GeoNames), output format (`src/lib/types.ts`), public repo with MIT licence.

### Day 2 (Oct 23): artist-mode data engine ✅
`npm run plan -- "Artist" --region="Country" --shows=10 --size=club|theatre|arena` runs the whole pipeline (~10–30 s cold, instant when cached).

What's built (`src/lib/engine/`):
- **cities.ts**: fan map → metro clusters → ranked tour cities. Score = taste (how high the best area ranks nationally) + depth (number of *strong* areas, top ~3%) + market size + activity. Suburbs merge into big-city metros; weaker results inside a stronger metro are merged.
- **places.ts**: venues and pre/after-show spots from Qloo alone, using each place's category (`primary_genre`). Music venues get a bonus; banquet/wedding/conference halls are dropped.
- **local.ts**: local openers. Two pools per city (taste-near-city + local scene), drop acts that appear in many cities, same genre lane only, minimum fit 0.8, "confirmed local" when the description or a genre tag names the city. Each city gets its own acts.
- **artist.ts**: artist lookup (with similar-artist fallback for thin data), audience, tour openers, brands (with fallback).
- **route.ts**: nearest-neighbour + 2-opt route, show days spaced by distance.
- **artistPlan.ts**: runs it all and streams progress events in the agreed format.

Findings that changed the plan:
- **5.5 resolved:** venues come from Qloo only (category tags work well); Ticketmaster/OpenStreetMap not needed.
- City-level heatmaps (`output.heatmap.boundary=urn:entity:locality`) took 12.5 min and 217 MB, so they're unusable. Our own grouping stays.
- Qloo caps `take` at 50 (client now pages automatically) and rate-limits bursts (client now caps concurrent requests at 6 and backs off with jitter).
- Genre tags have different types per endpoint (`urn:tag:genre`, `urn:tag:genre:music`, `urn:tag:genre:qloo`), and some genre tags are hometowns ("Boston", "Minneapolis").
- `filter.results.entities` scores a fixed list of entities against a signal (used for opener fit; will power venue mode).

Tested: Phoebe Bridgers (US, UK), Zach Bryan, MJ Lenderman, Bad Bunny, Gully Boys (US), Burna Boy (UK, Nigeria), Asake (Nigeria), Rammstein and Taylor Swift (Germany), Anitta (Brazil).

Known gaps for later: venue lists in some countries (Brazil, Nigeria) are mostly generic event spaces; some small-town labels (e.g. "Bellview, FL" instead of Pensacola).

### Day 3 (Oct 23): agent, streaming, brief, comparison ✅
- **Agent** (`src/lib/agent/`): Claude Opus 5.5 with a hand-written tool loop over the engine. Tools: find_artist, map_fans, get_audience, find_support_acts, find_brands, scout_cities, compare_artists, plan_route, submit_plan. The agent picks cities (fan concentration first, then market, venues, geography, user wishes), writes city reasons, picks openers, brand pitches, a headline and the Markdown tour brief. Its notes between tool calls stream as "thought" events (`display: "updates"`); server-side refusal fallback is on.
- **Comparison**: a parallel no-tools call (structured output) gives the generic AI answer; cities match by distance (same metro = within 45 km).
- **Fallback**: if Claude isn't available or fails, the plain pipeline finishes the plan with a template brief. Tested with a rejected key: works, ~3 s.
- **API**: `POST /api/plan` streams newline-delimited JSON events (steps, thoughts, partial results, result/error). Input validation, unknown artists rejected (name similarity check), friendly errors.
- `npm run agent -- "Artist" --shows=8 --start="City" --notes="..."` runs the whole thing from the terminal.
- Model: `ANTHROPIC_MODEL` in `.env` (currently `claude-sonnet-5`; code default is `claude-opus-5-5`).
- Agent test runs (5 turns, 8 tool calls, ~45-65 s each):
  - Phoebe Bridgers, US, 8 shows, start Seattle, "skip New York, college towns welcome": Northampton and Burlington included, NYC skipped with data-backed reason; 6 of 8 cities not in the generic AI answer.
  - Burna Boy, UK arena, "finish in London, include Scotland if supported": Glasgow in, Edinburgh out with reasons; 5 of 6 agree with the generic answer (honest: superstar → big cities).
  - Zach Bryan, US club, "small rooms, end in Oklahoma": ends at Cain's Ballroom, Tulsa; Samantha Crain as confirmed-local opener; 6 of 7 cities not in the generic answer.
- Fixes from testing: strict-schema enum with null rejected (use "auto"), cluster names come from the town nearest the strongest fan area (Northampton, not "North Chicopee"), GeoNames sub-area names filtered, `plan_route` takes `end_city`, brand ideas guaranteed in the brief, arena/theatre tours get a size-specific venue search (London → The O2).
