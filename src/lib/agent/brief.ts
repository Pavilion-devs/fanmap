/** A data-only tour brief, used when the agent isn't available. */
import type { ArtistPlan, Brief } from "@/lib/types";
import { possessive } from "@/lib/engine/artistPlan";

export function templateHeadline(plan: ArtistPlan) {
  const top = plan.cities.slice(0, 3).map((c) => c.place.city);
  return `${possessive(plan.artist.name)} fans are most concentrated in ${top.slice(0, -1).join(", ")}${top.length > 1 ? " and " : ""}${top.at(-1)}.`;
}

export function templateBrief(plan: ArtistPlan): Brief {
  const byLabel = new Map(plan.cities.map((c) => [c.place.label, c]));
  const rows = plan.route.map((stop) => {
    const city = byLabel.get(stop.cityLabel);
    return `| ${stop.day + 1} | ${stop.cityLabel} | ${city?.venues[0]?.name ?? "-"} | ${city?.localOpeners[0]?.name ?? "-"} |`;
  });

  const md = [
    "## Summary",
    `${plan.headline ?? templateHeadline(plan)}${plan.audience ? ` The audience is ${plan.audience.summary.toLowerCase()}.` : ""}`,
    "",
    "## Route",
    "| Day | City | Suggested venue | Local opener |",
    "|---|---|---|---|",
    ...rows,
    "",
    "## Why these cities",
    ...plan.cities.map((c) => `- **${c.place.label}**: ${c.reason}`),
    "",
    "## Support and partners",
    plan.openers.length ? `- Support acts: ${plan.openers.slice(0, 4).map((o) => o.name).join(", ")}` : "- No support act data.",
    plan.brands.length ? `- Brands this audience over-indexes on: ${plan.brands.slice(0, 5).map((b) => b.name).join(", ")}` : "- No brand data.",
    "",
    "## Notes",
    "- Based on where fans' taste is concentrated (Qloo), not on ticket sales.",
    ...plan.notices.map((n) => `- ${n.message}`),
  ];

  return { title: `${plan.artist.name}: ${plan.region.name} tour brief`, markdown: md.join("\n") };
}
