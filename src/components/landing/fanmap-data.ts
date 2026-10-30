// Showcase data for the landing-page map: Phoebe Bridgers in the US, from the example run
// (city ranks as Fanmap reports them). Heat values are an illustrative index, not raw Qloo output.

export type LonLat = [lon: number, lat: number];

/** Rough outline of the contiguous US, clockwise from the Pacific Northwest. */
export const US_OUTLINE: LonLat[] = [
  [-124.7, 48.4], [-123.0, 48.3], [-122.8, 49.0], [-95.2, 49.0], [-94.8, 49.4], [-89.6, 48.0],
  [-84.6, 46.5], [-83.6, 46.1], [-82.5, 45.3], [-82.4, 43.0], [-83.1, 42.3], [-82.5, 41.7],
  [-79.0, 42.6], [-79.0, 43.3], [-76.4, 43.6], [-76.3, 44.2], [-75.0, 44.9], [-71.5, 45.0],
  [-70.8, 45.4], [-70.0, 46.7], [-69.2, 47.45], [-68.0, 47.3], [-67.8, 45.7], [-67.0, 44.8],
  [-68.8, 44.3], [-70.2, 43.6], [-70.8, 42.6], [-70.0, 41.8], [-71.9, 41.3], [-74.0, 40.6],
  [-74.1, 39.6], [-75.0, 38.8], [-75.9, 37.2], [-76.3, 36.9], [-75.5, 35.3], [-77.0, 34.6],
  [-78.6, 33.9], [-80.9, 32.0], [-81.4, 30.7], [-80.6, 28.4], [-80.1, 26.8], [-80.4, 25.2],
  [-81.1, 25.1], [-81.8, 26.6], [-82.8, 28.0], [-82.7, 29.2], [-84.0, 30.0], [-85.4, 29.7],
  [-86.5, 30.4], [-88.0, 30.4], [-89.6, 30.2], [-89.4, 29.0], [-90.2, 29.1], [-91.5, 29.5],
  [-93.8, 29.7], [-95.0, 29.2], [-97.2, 27.6], [-97.4, 25.9], [-99.1, 26.4], [-100.0, 27.8],
  [-101.4, 29.8], [-103.0, 29.0], [-104.5, 29.6], [-106.5, 31.8], [-108.2, 31.8], [-111.1, 31.3],
  [-114.8, 32.5], [-117.1, 32.5], [-118.4, 33.8], [-120.6, 34.6], [-121.9, 36.6], [-122.5, 37.8],
  [-123.8, 39.8], [-124.4, 42.0], [-124.0, 46.3],
];

/** Great Lakes as ellipses: centre lon, centre lat, lon radius, lat radius. */
export const LAKES: [number, number, number, number][] = [
  [-87.0, 43.9, 0.75, 2.0], [-87.6, 47.5, 3.0, 0.65], [-82.6, 44.7, 0.7, 1.0],
  [-81.3, 42.2, 1.7, 0.4], [-77.8, 43.6, 1.3, 0.3],
];

export type Hotspot = { name: string; lat: number; lon: number; heat: number; rank?: string };

export const HOTSPOTS: Hotspot[] = [
  // the first five are referenced by position in StoryMap and FanMap3D
  { name: "Northampton, MA", lat: 42.32, lon: -72.63, heat: 1.0, rank: "Top 0.1%" },
  { name: "Portland, OR", lat: 45.52, lon: -122.68, heat: 0.96, rank: "Top 0.1%" },
  { name: "Burlington, VT", lat: 44.48, lon: -73.21, heat: 0.86, rank: "Top 0.1%" },
  { name: "Portland, ME", lat: 43.66, lon: -70.26, heat: 0.92, rank: "Top 0.1%" },
  { name: "Madison, WI", lat: 43.07, lon: -89.4, heat: 0.6, rank: "Top 0.3%" },
  { name: "Boston, MA", lat: 42.36, lon: -71.06, heat: 0.84, rank: "Top 0.1%" },
  { name: "Seattle, WA", lat: 47.61, lon: -122.33, heat: 0.74, rank: "Top 0.2%" },
  { name: "San Francisco, CA", lat: 37.77, lon: -122.42, heat: 0.72, rank: "Top 0.3%" },
  { name: "Minneapolis, MN", lat: 44.98, lon: -93.27, heat: 0.56, rank: "Top 0.4%" },
  { name: "Worcester, MA", lat: 42.26, lon: -71.8, heat: 0.52, rank: "Top 0.3%" },
  { name: "Austin, TX", lat: 30.27, lon: -97.74, heat: 0.46, rank: "Top 0.6%" },
  { name: "Denver, CO", lat: 39.74, lon: -104.99, heat: 0.44, rank: "Top 2%" },
  { name: "Chicago, IL", lat: 41.88, lon: -87.63, heat: 0.4, rank: "Top 2%" },
  { name: "Los Angeles, CA", lat: 34.05, lon: -118.24, heat: 0.36, rank: "Top 2%" },
  { name: "Philadelphia, PA", lat: 39.95, lon: -75.17, heat: 0.3, rank: "Top 3%" },
  { name: "New York, NY", lat: 40.71, lon: -74.0, heat: 0.22, rank: "Top 3%" },
];

/** Where a generic AI answer sends the same artist (the picks the fan data doesn't back). */
export const AI_PICKS: Hotspot[] = [
  { name: "New York", lat: 40.71, lon: -74.0, heat: 0 },
  { name: "Los Angeles", lat: 34.05, lon: -118.24, heat: 0 },
  { name: "Nashville", lat: 36.16, lon: -86.78, heat: 0 },
  { name: "Austin", lat: 30.27, lon: -97.74, heat: 0 },
  { name: "Philadelphia", lat: 39.95, lon: -75.17, heat: 0 },
];

/** The route from the example run: 8 nights from Seattle, skip New York, college towns welcome. */
export const ROUTE: Hotspot[] = [
  { name: "Seattle", lat: 47.61, lon: -122.33, heat: 0 },
  { name: "Portland, OR", lat: 45.52, lon: -122.68, heat: 0 },
  { name: "San Francisco", lat: 37.77, lon: -122.42, heat: 0 },
  { name: "Denver", lat: 39.74, lon: -104.99, heat: 0 },
  { name: "Madison", lat: 43.07, lon: -89.4, heat: 0 },
  { name: "Chicago", lat: 41.88, lon: -87.63, heat: 0 },
  { name: "Northampton", lat: 42.32, lon: -72.63, heat: 0 },
  { name: "Boston", lat: 42.36, lon: -71.06, heat: 0 },
];
