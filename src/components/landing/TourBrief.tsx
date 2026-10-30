"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import styles from "./TourBrief.module.css";

// The Phoebe Bridgers example run (8 nights from Seattle, skip New York, college towns welcome).
const NIGHTS = [
  { day: 1, city: "Seattle, WA", room: "The Vera Project", opener: "Black Belt Eagle Scout" },
  { day: 2, city: "Portland, OR", room: "Wonder Ballroom", opener: "Angelo De Augustine" },
  { day: 4, city: "San Francisco, CA", room: "Great American Music Hall", opener: "Boy Scouts" },
  { day: 7, city: "Denver, CO", room: "Bluebird Theater", opener: "Watchhouse" },
  { day: 10, city: "Madison, WI", room: "High Noon Saloon", opener: "Dehd" },
  { day: 12, city: "Chicago, IL", room: "The Chicago Theatre", opener: "Gia Margaret" },
  { day: 14, city: "Northampton, MA", room: "John M. Greene Hall", opener: "Anjimile" },
  { day: 15, city: "Boston, MA", room: "The Sinclair", opener: "Sidney Gish" },
];

const WHY = [
  { city: "Portland, OR", text: "Number one overall. Top 0.1% for fan strength, with seven strong fan areas." },
  { city: "Northampton, MA", text: "Top 0.1%. A college town, as the request asked." },
  { city: "Chicago, IL", text: "Weaker fan rank (top 2%), kept for market size and routing. The brief says so." },
];

export default function TourBrief() {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      const narrow = window.innerWidth < 700;
      const scrub = { trigger: "[data-stack]", start: "top bottom", end: "top 30%", scrub: 0.7 };
      // The poster drops onto the table; the brief slides out from under it.
      gsap.fromTo("[data-poster]", { y: narrow ? 120 : 220, rotate: narrow ? -6 : -11, scale: 0.92 }, { y: 0, rotate: -2.5, scale: 1, ease: "none", scrollTrigger: scrub });
      gsap.fromTo("[data-doc]", { x: -60, y: 160, rotate: 2 }, { x: 0, y: 0, rotate: 5, ease: "none", scrollTrigger: scrub });
      gsap.from("[data-night]", {
        opacity: 0,
        x: -16,
        duration: 0.6,
        stagger: 0.07,
        ease: "power3.out",
        scrollTrigger: { trigger: "[data-poster]", start: "top 60%", once: true },
      });
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={ref} id="brief" className={styles.section} aria-labelledby="brief-title">
      <div className={styles.copy}>
        <p data-reveal className={styles.label}>
          <span className={styles.labelDot} /> Tour brief
        </p>
        <h2 id="brief-title" data-reveal className={styles.title}>
          One page.
          <br />
          <em>Ready for the promoter.</em>
        </h2>
        <p data-reveal className={styles.lede}>
          Every plan ends in a brief: the route, a room in each city, a local opener for each night, the crowd, and
          the sponsors to pitch. This one is from a real run.
        </p>

        <div data-reveal className={styles.why}>
          <p className={styles.whyHead}>Why these cities</p>
          {WHY.map((w) => (
            <p key={w.city} className={styles.whyRow}>
              <b>{w.city}</b>
              {w.text}
            </p>
          ))}
        </div>

        <dl data-reveal className={styles.proof}>
          <div>
            <dt>Asked</dt>
            <dd>8 nights from Seattle, skip New York, college towns welcome</dd>
          </div>
          <div>
            <dt>Agent</dt>
            <dd>8 tool calls · 50 seconds</dd>
          </div>
        </dl>
      </div>

      <div data-stack className={styles.stack}>
        <article data-doc className={styles.doc} aria-hidden="true">
          <p className={styles.docTag}>Brief · Phoebe Bridgers · US</p>
          <h3>Summary</h3>
          <p>
            Her audience is young (18–34), leans female, and is described as devoted, introspective and loyal. Her
            strongest fans aren&apos;t simply in the biggest cities but in Pacific Northwest hubs and small New England
            college towns.
          </p>
          <h3>Support and partners</h3>
          <p>Openers: Lucy Dacus, Julien Baker, Christian Lee Hutson, Haley Heynderickx.</p>
          <p>Fender guitar lounge at theatre stops. Dr. Martens pop-up at club shows. Polaroid booth pre-show.</p>
          <h3>Notes</h3>
          <p>New York left out as asked. Burlington, Portland ME and Boulder scored well: an expansion leg.</p>
        </article>

        <article data-poster className={styles.poster} aria-label="Tour poster: Phoebe Bridgers, US tour, 8 nights">
          <header className={styles.posterTop}>
            <span>US tour</span>
            <span>8 nights · 15 days</span>
          </header>
          <h3 className={styles.posterName}>
            Phoebe
            <br />
            Bridgers
          </h3>
          <p className={styles.posterWith}>with Lucy Dacus · Julien Baker</p>
          <ol className={styles.nights}>
            {NIGHTS.map((n) => (
              <li key={n.city} data-night>
                <span className={styles.day}>Day {String(n.day).padStart(2, "0")}</span>
                <span className={styles.nightCity}>{n.city}</span>
                <span className={styles.room}>
                  {n.room}
                  <small>+ {n.opener}</small>
                </span>
              </li>
            ))}
          </ol>
          <footer className={styles.posterFoot}>
            <span className={styles.stamp}>Routed by fan data</span>
            <span className={styles.posterLogo}>fanmap</span>
          </footer>
        </article>
      </div>
    </section>
  );
}
