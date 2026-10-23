/**
 * One-click examples for the UI. They're pre-run with `npm run warm`, so they replay instantly
 * from the plan cache. Keep inputs exactly as here: the cache key is the normalised input.
 */
import type { ArtistPlanInput, VenuePlanInput } from "@/lib/types";

export interface Example {
  id: string;
  title: string;
  subtitle: string;
  input: ArtistPlanInput | VenuePlanInput;
}

export const EXAMPLES: Example[] = [
  {
    id: "phoebe-us",
    title: "Phoebe Bridgers · US tour",
    subtitle: "8 shows from Seattle, skip New York, college towns welcome",
    input: {
      mode: "artist",
      artist: "Phoebe Bridgers",
      region: "United States",
      shows: 8,
      startCity: "Seattle",
      notes: "skip New York, college towns welcome",
    },
  },
  {
    id: "zach-us",
    title: "Zach Bryan · small rooms",
    subtitle: "7 club shows, finishing in Oklahoma",
    input: {
      mode: "artist",
      artist: "Zach Bryan",
      region: "United States",
      shows: 7,
      venueSize: "club",
      notes: "small rooms, end the tour in Oklahoma, no stadium-style venues",
    },
  },
  {
    id: "burna-uk",
    title: "Burna Boy · UK arenas",
    subtitle: "6 arena dates, finish in London",
    input: {
      mode: "artist",
      artist: "Burna Boy",
      region: "United Kingdom",
      shows: 6,
      venueSize: "arena",
      notes: "finish in London, include Scotland if the data supports it",
    },
  },
  {
    id: "first-avenue",
    title: "First Avenue, Minneapolis",
    subtitle: "1,550-cap room that wants hip hop nights and more local acts",
    input: {
      mode: "venue",
      venue: "First Avenue, Minneapolis",
      capacity: 1550,
      genres: [],
      notes: "we want a couple of hip hop nights too, and more local acts",
    },
  },
  {
    id: "cains",
    title: "Cain's Ballroom, Tulsa",
    subtitle: "1,700-cap legendary country room",
    input: { mode: "venue", venue: "Cain's Ballroom, Tulsa", capacity: 1700, genres: [] },
  },
  {
    id: "brixton",
    title: "O2 Academy Brixton, London",
    subtitle: "4,900 cap, hip hop and grime",
    input: { mode: "venue", venue: "O2 Academy Brixton, London", capacity: 4900, genres: ["hip hop", "grime"] },
  },
];
