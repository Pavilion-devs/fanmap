/**
 * Venue mode pipeline: "Who should I book?" Runs the venue tools and streams progress.
 * The venue agent sits on top of the same tools; this is also its fallback.
 */
import type { Notice, PlanEvent, VenuePlan, VenuePlanInput } from "@/lib/types";
import {
  buildDoubleBills,
  findBookingPicks,
  findLocalActs,
  genreTagIds,
  resolveVenue,
  sizeBand,
  venueBrands,
  venueCrowd,
} from "./venue";

type Emit = (event: PlanEvent) => void;

async function step<T>(emit: Emit, id: string, label: string, fn: () => Promise<T>, detail?: (v: T) => string) {
  const started = Date.now();
  emit({ type: "step", id, label, status: "running" });
  try {
    const value = await fn();
    emit({ type: "step", id, label, status: "done", ms: Date.now() - started, detail: detail?.(value) });
    return value;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: "step", id, label, status: "failed", ms: Date.now() - started, detail: message.slice(0, 200) });
    return undefined;
  }
}

export class VenueNotFoundError extends Error {}

export async function runVenuePlan(input: VenuePlanInput, emit: Emit = () => {}): Promise<VenuePlan> {
  const notices: Notice[] = [];
  const notice = (n: Notice) => {
    notices.push(n);
    emit({ type: "notice", notice: n });
  };

  const venue = await step(emit, "venue", `Finding ${input.venue}`, () => resolveVenue(input.venue), (v) =>
    v ? [v.name, v.category, v.place.label].filter(Boolean).join(" · ") : "not found",
  );
  if (!venue) throw new VenueNotFoundError(`We couldn't find a venue or city called "${input.venue}".`);
  if (venue.cityOnly) {
    notice({
      code: "ambiguous_input",
      message: `We couldn't find that exact venue in Qloo, so this plan uses the music scene around ${venue.city.name}.`,
    });
  }
  emit({ type: "partial", key: "venue", value: { name: venue.name, place: venue.place, qlooId: venue.qlooId, category: venue.category } });

  const band = sizeBand(input.capacity);
  const tags = await genreTagIds(input.genres);

  const picks = await step(emit, "picks", `Finding acts ${venue.cityOnly ? "this scene" : "this venue's fans"} love`, () =>
    findBookingPicks(venue, { band, tagIds: tags.ids, take: 15 }),
    (p) => p.slice(0, 3).map((x) => x.artist.name).join(", "),
  );
  if (!picks?.length) throw new Error(`Not enough fan data to suggest acts for ${venue.name}.`);
  emit({ type: "partial", key: "picks", value: picks });

  const [locals, crowd, brands] = await Promise.all([
    step(emit, "locals", `Finding local acts around ${venue.city.name}`, () =>
      findLocalActs(venue, { tagIds: tags.ids, excludeIds: picks.map((p) => p.artist.id) }),
      (l) => l.slice(0, 3).map((x) => x.name).join(", ") || "none stood out",
    ),
    step(emit, "crowd", "Reading the crowd", () => venueCrowd(venue, picks), (c) => c?.summary ?? "no data"),
    step(emit, "brands", "Finding brands this crowd loves", () => venueBrands(picks), (b) => b.slice(0, 3).map((x) => x.name).join(", ")),
  ]);
  if (locals) emit({ type: "partial", key: "localOpeners", value: locals });
  if (crowd) emit({ type: "partial", key: "crowd", value: crowd });
  if (brands) emit({ type: "partial", key: "brands", value: brands });

  const doubleBills = await step(emit, "double_bills", "Building double bills", () => buildDoubleBills(picks, locals ?? []), (d) =>
    d.map((b) => `${b.headliner.name} + ${b.support.name}`).slice(0, 2).join("; "),
  );
  if (doubleBills) emit({ type: "partial", key: "doubleBills", value: doubleBills });

  return {
    mode: "venue",
    input,
    venue: {
      name: venue.name,
      place: venue.place,
      qlooId: venue.qlooId,
      category: venue.category,
      address: venue.address,
      image: venue.image,
    },
    sizeBand: band.label,
    crowd,
    picks,
    localOpeners: locals ?? [],
    doubleBills: doubleBills ?? [],
    brands: brands ?? [],
    notices,
    generatedAt: new Date().toISOString(),
  };
}
