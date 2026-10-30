"use client";

import { useState, type CSSProperties } from "react";
import type { Plan } from "@/lib/types";
import { nightsOf, numberWord, pad2, shortLabel, shortlistOf } from "./format";
import Markdown from "./Markdown";
import styles from "./Brief.module.css";

/** Splits a name over two poster lines of similar length. */
function posterLines(name: string) {
  const words = name.split(" ");
  if (words.length < 2) return [name];
  let best = 1;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ").length;
    const b = words.slice(i).join(" ").length;
    const cur = Math.abs(words.slice(0, best).join(" ").length - words.slice(best).join(" ").length);
    if (Math.abs(a - b) < cur) best = i;
  }
  return [words.slice(0, best).join(" "), words.slice(best).join(" ")];
}

export default function Brief({ plan, sharePath }: { plan: Plan; sharePath: string }) {
  const [copied, setCopied] = useState<"" | "text" | "link">("");
  const markdown = plan.brief?.markdown ?? "";

  const copy = async (what: "text" | "link") => {
    const value = what === "text" ? `# ${plan.brief?.title ?? "Fanmap brief"}\n\n${markdown}` : new URL(sharePath, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      window.prompt("Copy this:", value);
    }
  };

  return (
    <section id="brief" className={styles.section} aria-labelledby="brief-title">
      <header className={styles.head}>
        <div>
          <p className={styles.label}>
            <span className={styles.labelDot} /> {plan.mode === "artist" ? "Tour brief" : "Booking brief"}
          </p>
          <h2 id="brief-title" className={styles.title}>
            One page. <em>Ready for the {plan.mode === "artist" ? "promoter" : "team"}.</em>
          </h2>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.action} onClick={() => copy("text")}>
            {copied === "text" ? "Copied" : "Copy text"}
          </button>
          <button type="button" className={styles.action} onClick={() => window.print()}>
            Download PDF
          </button>
          <button type="button" className={`${styles.action} ${styles.primary}`} onClick={() => copy("link")}>
            {copied === "link" ? "Link copied" : "Copy share link"}
          </button>
        </div>
      </header>

      <div className={styles.stage}>
        <Poster plan={plan} />
        <article className={styles.doc} id="brief-print">
          <p className={styles.docTag}>
            fanmap · {plan.mode === "artist" ? `${plan.artist.name} · ${plan.region.name}` : `${plan.venue.name} · ${plan.venue.place.label}`}
          </p>
          <h3 className={styles.docTitle}>{plan.brief?.title}</h3>
          {plan.headline && <p className={styles.docLede}>{plan.headline}</p>}
          <Markdown text={markdown} className={styles.md} />
          <p className={styles.docFoot}>
            Fan scores show where taste is concentrated, not guaranteed ticket sales. Taste data from Qloo. Generated{" "}
            {new Date(plan.generatedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.
          </p>
        </article>
      </div>
    </section>
  );
}

function Poster({ plan }: { plan: Plan }) {
  if (plan.mode === "artist") {
    const nights = nightsOf(plan);
    const days = (plan.route.at(-1)?.day ?? nights.length - 1) + 1;
    const lines = posterLines(plan.artist.name);
    const longest = Math.max(...lines.map((l) => l.length));
    const openers = plan.openers.slice(0, 2).map((o) => o.name);
    return (
      <article className={styles.poster} aria-label={`Tour poster: ${plan.artist.name}`} style={{ "--name": `${Math.min(92, 760 / longest)}px`, "--chars": longest } as CSSProperties}>
        <header className={styles.posterTop}>
          <span>{plan.region.name} tour</span>
          <span>
            {nights.length} nights · {days} days
          </span>
        </header>
        <h3 className={styles.posterName}>
          {lines.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </h3>
        {openers.length > 0 && <p className={styles.posterWith}>with {openers.join(" · ")}</p>}
        <ol className={styles.nights}>
          {nights.map((n, i) => (
            <li key={n.city.place.label} style={{ "--i": i } as CSSProperties}>
              <span className={styles.day}>Day {pad2(n.day + 1)}</span>
              <span className={styles.nightCity}>{shortLabel(n.city.place.label, plan.region.name)}</span>
              <span className={styles.room}>
                {n.room}
                {n.opener && <small>+ {n.opener}</small>}
              </span>
            </li>
          ))}
        </ol>
        <footer className={styles.posterFoot}>
          <span className={styles.stamp}>Routed by fan data</span>
          <span className={styles.posterLogo}>fanmap</span>
        </footer>
      </article>
    );
  }

  const list = shortlistOf(plan);
  const lines = posterLines(plan.venue.name);
  const longest = Math.max(...lines.map((l) => l.length));
  return (
    <article className={styles.poster} aria-label={`Booking poster: ${plan.venue.name}`} style={{ "--name": `${Math.min(92, 760 / longest)}px`, "--chars": longest } as CSSProperties}>
      <header className={styles.posterTop}>
        <span>{plan.venue.place.label}</span>
        <span>{numberWord(list.length)} acts to book</span>
      </header>
      <h3 className={styles.posterName}>
        {lines.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </h3>
      <p className={styles.posterWith}>presents · {plan.sizeBand}</p>
      <ol className={styles.nights}>
        {list.map((r, i) => (
          <li key={r.act} style={{ "--i": i } as CSSProperties}>
            <span className={styles.day}>No. {pad2(i + 1)}</span>
            <span className={styles.nightCity}>{r.act}</span>
            <span className={styles.room}>{r.slot}</span>
          </li>
        ))}
      </ol>
      <footer className={styles.posterFoot}>
        <span className={styles.stamp}>Booked by fan data</span>
        <span className={styles.posterLogo}>fanmap</span>
      </footer>
    </article>
  );
}
