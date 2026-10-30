import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import PlanView from "@/components/plan/PlanView";
import { EXAMPLES } from "@/lib/examples";
import { countryBasemap } from "@/lib/geo/basemap";
import { findCountry } from "@/lib/geo/cities";
import { validateArtistInput, validateVenueInput } from "@/lib/plan";
import type { PlanInput } from "@/lib/types";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Your plan · Fanmap",
  description: "A tour or booking plan built from where the fans actually are.",
};

type Query = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

/** The plan request from the URL: a saved example by id, or the fields from the form. */
function readInput(q: Query): PlanInput {
  const example = EXAMPLES.find((x) => x.id === one(q.example));
  if (example) return example.input;
  const raw = Object.fromEntries(Object.entries(q).map(([k, v]) => [k, one(v)]));
  return one(q.mode) === "venue" ? validateVenueInput(raw) : validateArtistInput(raw);
}

/** A short link that recreates the same request (and so replays it from the plan cache). */
function sharePath(q: Query, input: PlanInput) {
  const example = EXAMPLES.find((x) => x.id === one(q.example));
  if (example) return `/plan?example=${example.id}`;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || v === "" || (Array.isArray(v) && !v.length)) continue;
    params.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  return `/plan?${params}`;
}

async function Plan({ searchParams }: { searchParams: Promise<Query> }) {
  const q = await searchParams;
  let input: PlanInput;
  try {
    input = readInput(q);
  } catch (err) {
    return (
      <div className={styles.invalid}>
        <p className={styles.kicker}>No plan yet</p>
        <h1>{err instanceof Error ? err.message : "That request didn't make sense."}</h1>
        <Link href="/#plan">Start a plan</Link>
      </div>
    );
  }
  const country = input.mode === "artist" ? findCountry(input.region ?? "United States") : undefined;
  const basemap = country ? countryBasemap(country.code) : null;
  return <PlanView key={sharePath(q, input)} input={input} basemap={basemap} regionName={country?.name ?? ""} sharePath={sharePath(q, input)} />;
}

export default function Page({ searchParams }: PageProps<"/plan">) {
  return (
    <Suspense fallback={<div className={styles.loading} aria-label="Loading your plan" />}>
      <Plan searchParams={searchParams} />
    </Suspense>
  );
}
