"use client";

import { Fragment, useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import styles from "./Marquee.module.css";

const FACTS = ["8,576 fan areas read", "Top 0.1% Northampton", "5 of 8 cities AI misses", "Routed in about a minute"];
const CITIES = ["Portland, OR", "Northampton", "Portland, ME", "Burlington", "Madison", "Worcester", "Minneapolis", "Boston"];

function Row({ items, outline }: { items: string[]; outline?: boolean }) {
  // Two identical halves so the loop can wrap at -50% without a seam.
  const half = (hidden: boolean) => (
    <div className={styles.half} aria-hidden={hidden || undefined}>
      {[...items, ...items].map((t, i) => (
        <Fragment key={i}>
          <span className={styles.item}>{t}</span>
          <span className={styles.sep} aria-hidden="true" />
        </Fragment>
      ))}
    </div>
  );
  return (
    <div className={`${styles.row} ${outline ? styles.outline : ""}`}>
      <div className={styles.track} data-track>
        {half(false)}
        {half(true)}
      </div>
    </div>
  );
}

export default function Marquee() {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.registerPlugin(ScrollTrigger);

    const tracks = gsap.utils.toArray<HTMLElement>("[data-track]", root);
    const loops = tracks.map((t, i) =>
      i === 0
        ? gsap.fromTo(t, { xPercent: 0 }, { xPercent: -50, duration: 48, ease: "none", repeat: -1 })
        : gsap.fromTo(t, { xPercent: -50 }, { xPercent: 0, duration: 56, ease: "none", repeat: -1 }),
    );
    // Start deep into the loop so running it backwards never hits the start.
    loops.forEach((l) => l.totalTime(l.duration() * 50));
    const skew = gsap.quickTo(tracks, "skewX", { duration: 0.5, ease: "power3.out" });
    let settle: gsap.core.Tween | undefined;

    // Scrolling speeds the rows up and leans them; scrolling up runs them backwards.
    const st = ScrollTrigger.create({
      trigger: root,
      start: "top bottom",
      end: "bottom top",
      onUpdate(self) {
        const v = self.getVelocity();
        const boost = 1 + Math.min(Math.abs(v) / 250, 6);
        loops.forEach((l) => {
          gsap.killTweensOf(l, "timeScale");
          l.timeScale(boost * self.direction);
          gsap.to(l, { timeScale: self.direction, duration: 1.2, ease: "power2.out", delay: 0.05 });
        });
        skew(gsap.utils.clamp(-8, 8, v / -220));
        settle?.kill();
        settle = gsap.delayedCall(0.12, () => skew(0));
      },
    });

    return () => {
      st.kill();
      settle?.kill();
      loops.forEach((l) => l.kill());
    };
  }, []);

  return (
    <section ref={ref} className={styles.marquee} aria-label="Fanmap in numbers">
      <Row items={FACTS} />
      <Row items={CITIES} outline />
    </section>
  );
}
