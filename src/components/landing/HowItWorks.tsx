"use client";

import { useEffect, useRef, useState } from "react";
import StoryMap from "./StoryMap";
import styles from "./HowItWorks.module.css";

const STEPS = [
  {
    title: "Find the artist",
    body: "Type a name. Fanmap pins down the exact artist in Qloo's catalogue, so the whole map is about the right Phoebe.",
    tag: "Qloo · search",
  },
  {
    title: "Read the country's taste",
    body: "Qloo scores about 8,500 small areas for how strongly they lean toward this artist. Not streams, not population. Taste.",
    tag: "Qloo · insights heatmap",
  },
  {
    title: "Rank every city",
    body: "Areas roll up into real cities, ranked against the whole country. Northampton, MA lands in the top 0.1%. Big cities only make the cut if their fans do.",
    tag: "Fanmap · city index",
  },
  {
    title: "Scout the rooms",
    body: "In each city the agent finds venues that fit the crowd and the size of the act, plus somewhere to go before and after the show.",
    tag: "Qloo · places",
  },
  {
    title: "Line up openers and partners",
    body: "Acts whose fans overlap, who the crowd is, and the brands that crowd already loves. Ready-made support slots and sponsor pitches.",
    tag: "Qloo · similar · compare · demographics · brands",
  },
  {
    title: "Route it and write the brief",
    body: "Claude orders the stops into a sensible run and writes a one-page brief you can send to a promoter today.",
    tag: "Claude · route + brief",
  },
];

export default function HowItWorks() {
  const [step, setStep] = useState(-1);
  const stepsRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const list = stepsRef.current;
    if (!list) return;
    const items = Array.from(list.querySelectorAll<HTMLElement>("[data-step]"));
    // The step crossing the middle of the screen is the active one.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setStep(Number((e.target as HTMLElement).dataset.step));
        }
      },
      { rootMargin: "-48% 0px -48% 0px" },
    );
    items.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <section id="how" className={styles.section} aria-labelledby="how-title">
      <header className={styles.head}>
        <p data-reveal className={styles.label}>
          <span className={styles.labelDot} /> How it works
        </p>
        <h2 id="how-title" data-reveal className={styles.title}>
          From a name to a tour,
          <br />
          in <em>about a minute.</em>
        </h2>
      </header>

      <div className={styles.grid}>
        <div className={styles.stage}>
          <div className={styles.stageInner}>
            <div className={styles.rail} aria-hidden="true">
              {STEPS.map((s, i) => (
                <span key={s.title} data-on={i <= step ? "1" : "0"} />
              ))}
            </div>
            <StoryMap step={step} />
          </div>
        </div>

        <ol ref={stepsRef} className={styles.steps}>
          {STEPS.map((s, i) => (
            <li key={s.title} data-step={i} data-active={i === step ? "1" : "0"} className={styles.step}>
              <span className={styles.num}>{String(i + 1).padStart(2, "0")}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
              <span className={styles.tag}>{s.tag}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
