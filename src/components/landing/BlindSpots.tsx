"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import styles from "./BlindSpots.module.css";

// Phoebe Bridgers, eight US nights. The chatbot list is a typical generic answer.
const AI_LIST = [
  { city: "New York", miss: true },
  { city: "Los Angeles", miss: true },
  { city: "Chicago", miss: true },
  { city: "Austin", miss: true },
  { city: "Nashville", miss: true },
  { city: "Seattle" },
  { city: "San Francisco" },
  { city: "Boston" },
];

const FANMAP_LIST = [
  { city: "Seattle", note: "Start" },
  { city: "Portland, OR", only: true },
  { city: "San Francisco" },
  { city: "Ithaca, NY", only: true },
  { city: "Northampton, MA", only: true, note: "Top 0.1%" },
  { city: "Burlington, VT", only: true, note: "Top 0.1%" },
  { city: "Portland, ME", only: true },
  { city: "Boston", note: "Finish" },
];

// Checked against Qloo's data on Oct 23, 2026.
const MORE = [
  { artist: "Zach Bryan", market: "US", guess: ["Nashville", "Texas"], real: ["Tulsa & Stillwater, OK", "Montana", "Wyoming"] },
  { artist: "MJ Lenderman", market: "US", guess: ["Asheville", "New York"], real: ["Central Texas", "Northern Wisconsin", "Western Mass"] },
  { artist: "Phoebe Bridgers", market: "UK", guess: ["London", "Manchester"], real: ["Edinburgh", "Glasgow"] },
];

export default function BlindSpots() {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    gsap.registerPlugin(ScrollTrigger);

    const ctx = gsap.context(() => {
      if (reduce) {
        root.dataset.played = "1";
        gsap.set("[data-roll]", { yPercent: -500 / 6 });
        return;
      }

      // The paper sheet slides up over the dark page and squares off as it lands.
      gsap.fromTo(
        "[data-sheet]",
        { y: 140, scale: 0.94, borderRadius: 56 },
        {
          y: 0,
          scale: 1,
          borderRadius: 28,
          ease: "none",
          scrollTrigger: { trigger: root, start: "top bottom", end: "top 20%", scrub: 0.6 },
        },
      );

      const tl = gsap.timeline({
        scrollTrigger: { trigger: "[data-compare]", start: "top 65%", once: true },
        onStart: () => {
          root.dataset.played = "1";
        },
      });
      tl.to("[data-miss]", { "--strike": 1, opacity: 0.45, duration: 0.5, stagger: 0.12, ease: "power2.out" }, 0.2)
        .fromTo(
          "[data-stamp]",
          { scale: 1.9, rotate: -14, opacity: 0 },
          { scale: 1, rotate: -6, opacity: 1, duration: 0.45, stagger: 0.14, ease: "back.out(2.4)" },
          0.6,
        )
        .to("[data-roll]", { yPercent: -500 / 6, duration: 1.6, ease: "power3.out" }, 0.5);
    }, root);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={ref} id="blind-spots" className={styles.section} aria-labelledby="blind-title">
      <div data-sheet className={styles.sheet}>
        <header className={styles.head}>
          <p data-reveal className={styles.label}>
            <span className={styles.labelDot} /> Blind spots
          </p>
          <h2 id="blind-title" data-reveal className={styles.title}>
            Ask an AI where to tour.
            <br />
            You get <em>a population map.</em>
          </h2>
          <p data-reveal className={styles.lede}>
            A chatbot plans around city size. Fans don&apos;t live by city size. Here&apos;s the same question,
            Phoebe Bridgers, eight US nights, answered both ways.
          </p>
        </header>

        <div data-compare className={styles.compare}>
          <div data-reveal className={`${styles.list} ${styles.aiList}`}>
            <p className={styles.listHead}>
              <span>Ask a chatbot</span>
              <span>Guessing from size</span>
            </p>
            <ol>
              {AI_LIST.map((r, i) => (
                <li key={r.city} data-miss={r.miss ? "" : undefined}>
                  <span className={styles.num}>{String(i + 1).padStart(2, "0")}</span>
                  <span className={styles.city}>{r.city}</span>
                  {!r.miss && <span className={styles.both}>Also ours</span>}
                </li>
              ))}
            </ol>
          </div>

          <div data-reveal className={styles.score} aria-label="5 of 8 cities an AI alone would miss">
            <div className={styles.big} aria-hidden="true">
              <span className={styles.roll}>
                <span data-roll className={styles.rollInner}>
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <span key={n}>{n}</span>
                  ))}
                </span>
              </span>
              <span className={styles.slash}>/</span>
              <span>8</span>
            </div>
            <p className={styles.scoreText}>
              cities an AI alone
              <br />
              would <em>never</em> name
            </p>
          </div>

          <div data-reveal className={`${styles.list} ${styles.fanList}`}>
            <p className={styles.listHead}>
              <span>Fanmap</span>
              <span>Read from the data</span>
            </p>
            <ol>
              {FANMAP_LIST.map((r, i) => (
                <li key={r.city}>
                  <span className={styles.num}>{String(i + 1).padStart(2, "0")}</span>
                  <span className={styles.city}>{r.city}</span>
                  {r.note && <span className={styles.note}>{r.note}</span>}
                  {r.only && (
                    <span data-stamp className={styles.stamp}>
                      Only in the data
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className={styles.more}>
          <p data-reveal className={styles.moreHead}>
            It&apos;s not just Phoebe.
          </p>
          <div className={styles.cards}>
            {MORE.map((m) => (
              <article data-reveal key={m.artist + m.market} className={styles.card}>
                <p className={styles.cardArtist}>
                  {m.artist}
                  <span>{m.market}</span>
                </p>
                <p className={styles.cardRow}>
                  <span className={styles.cardKey}>AI guesses</span>
                  <span className={styles.cardGuess}>{m.guess.join(" · ")}</span>
                </p>
                <p className={styles.cardRow}>
                  <span className={styles.cardKey}>Fans are in</span>
                  <span className={styles.cardReal}>{m.real.join(" · ")}</span>
                </p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
