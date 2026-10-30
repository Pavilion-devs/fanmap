"use client";

import Form from "next/form";
import Image from "next/image";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { EXAMPLES } from "@/lib/examples";
import type { Mode } from "@/lib/types";
import { PHOTOS } from "./photos";
import styles from "./PlanCta.module.css";

type Fields = { artist: string; region: string; shows: string; venue: string; capacity: string; notes: string };

const EMPTY: Fields = { artist: "", region: "United States", shows: "8", venue: "", capacity: "", notes: "" };

export default function PlanCta() {
  const ref = useRef<HTMLElement>(null);
  const [mode, setMode] = useState<Mode>("artist");
  const [fields, setFields] = useState<Fields>(EMPTY);
  // Set when an example is picked unchanged, so the results page can replay it instantly.
  const [example, setExample] = useState("");

  const set = (key: keyof Fields) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFields((f) => ({ ...f, [key]: e.target.value }));
    setExample("");
  };

  const pickExample = (id: string) => {
    const ex = EXAMPLES.find((x) => x.id === id);
    if (!ex) return;
    const i = ex.input;
    setFields(
      i.mode === "artist"
        ? { ...EMPTY, artist: i.artist, region: i.region ?? "United States", shows: String(i.shows ?? 8), notes: i.notes ?? "" }
        : { ...EMPTY, venue: i.venue, capacity: i.capacity ? String(i.capacity) : "", notes: i.notes ?? "" },
    );
    setExample(id);
  };

  useEffect(() => {
    const root = ref.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      gsap.fromTo(
        "[data-bg]",
        { scale: 1.2, yPercent: -6 },
        { scale: 1, yPercent: 6, ease: "none", scrollTrigger: { trigger: root, start: "top bottom", end: "bottom top", scrub: true } },
      );
    }, root);
    return () => ctx.revert();
  }, []);

  const examples = EXAMPLES.filter((x) => x.input.mode === mode);
  const ready = mode === "artist" ? fields.artist.trim().length > 1 : fields.venue.trim().length > 1;

  return (
    <section ref={ref} id="plan" className={styles.section} aria-labelledby="plan-title">
      <div className={styles.bg} aria-hidden="true">
        <div data-bg className={styles.bgInner}>
          <Image src={PHOTOS.theatre.src} alt="" fill sizes="100vw" />
        </div>
      </div>

      <div className={styles.inner}>
        <h2 id="plan-title" data-reveal className={styles.title}>
          Play where
          <br />
          <em>your fans are.</em>
        </h2>

        <div data-reveal className={styles.card}>
          <div className={styles.modes} role="radiogroup" aria-label="What are you planning?">
            {(
              [
                ["artist", "Plan a tour", "for an artist"],
                ["venue", "Book a room", "for a venue"],
              ] as const
            ).map(([m, label, sub]) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                className={styles.mode}
                onClick={() => {
                  setMode(m);
                  setExample("");
                }}
              >
                {label}
                <span>{sub}</span>
              </button>
            ))}
          </div>

          <Form action="/plan" className={`${styles.form} ${mode === "venue" ? styles.venueForm : ""}`}>
            <input type="hidden" name="mode" value={mode} />
            {example && <input type="hidden" name="example" value={example} />}

            {mode === "artist" ? (
              <>
                <label className={`${styles.field} ${styles.main}`}>
                  <span>Artist</span>
                  <input name="artist" value={fields.artist} onChange={set("artist")} placeholder="Artist name" autoComplete="off" required minLength={2} />
                </label>
                <label className={styles.field}>
                  <span>Country</span>
                  <input name="region" value={fields.region} onChange={set("region")} placeholder="United States" autoComplete="off" />
                </label>
                <label className={`${styles.field} ${styles.small}`}>
                  <span>Shows</span>
                  <select name="shows" value={fields.shows} onChange={set("shows")}>
                    {[4, 5, 6, 7, 8, 10, 12, 15].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <>
                <label className={`${styles.field} ${styles.main}`}>
                  <span>Venue</span>
                  <input name="venue" value={fields.venue} onChange={set("venue")} placeholder="Venue name and city" autoComplete="off" required minLength={2} />
                </label>
                <label className={`${styles.field} ${styles.small}`}>
                  <span>Capacity</span>
                  <input name="capacity" value={fields.capacity} onChange={set("capacity")} placeholder="1,550" inputMode="numeric" autoComplete="off" />
                </label>
              </>
            )}

            <label className={`${styles.field} ${styles.wide}`}>
              <span>Anything else? (optional)</span>
              <input
                name="notes"
                value={fields.notes}
                onChange={set("notes")}
                placeholder={mode === "artist" ? "Skip New York, end in my hometown, college towns welcome" : "We want more hip hop nights and more local acts"}
                autoComplete="off"
              />
            </label>

            <button type="submit" className={styles.submit} disabled={!ready}>
              {mode === "artist" ? "Plan the tour" : "Plan the bookings"}
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3 8h9M8.5 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </Form>

          <div className={styles.examples}>
            <span className={styles.examplesLabel}>Or try</span>
            {examples.map((x) => (
              <button
                key={x.id}
                type="button"
                className={styles.example}
                data-on={example === x.id ? "1" : "0"}
                onClick={() => pickExample(x.id)}
                title={x.subtitle}
              >
                {x.title}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
