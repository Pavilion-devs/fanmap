"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import FanMap3D from "./FanMap3D";
import styles from "./Hero.module.css";

export default function Hero() {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ctx = gsap.context(() => {
      // Lines and fades start hidden in CSS so nothing flashes before hydration.
      if (reduce) {
        root.dataset.struck = "1";
        return;
      }
      const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
      tl.to("[data-line]", { y: 0, yPercent: 0, duration: 1.3, stagger: 0.11 }, 0.15)
        .to("[data-fade]", { opacity: 1, y: 0, duration: 1.1, stagger: 0.08 }, 0.7)
        .call(() => {
          root.dataset.struck = "1";
        }, [], 3.5);
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={ref} className={styles.hero} aria-labelledby="hero-title">
      <div className={styles.map}>
        <FanMap3D />
      </div>

      <div className={styles.copy}>
        <h1 id="hero-title" className={styles.title}>
          <span className={styles.mask}>
            <span data-line className={`${styles.line} ${styles.muted}`}>
              AI says <s className={styles.ai}>New York</s>.
            </span>
          </span>
          <span className={styles.mask}>
            <span data-line className={styles.line}>
              Your fans say
            </span>
          </span>
          <span className={styles.mask}>
            <span data-line className={`${styles.line} ${styles.accent}`}>
              Northampton.
            </span>
          </span>
        </h1>

        <p data-fade className={styles.lede}>
          Fanmap reads where an artist&apos;s taste actually lives, city by city, and turns it into a
          tour route, a booking list and a brief you can take into the room.
        </p>

        <div data-fade className={styles.actions}>
          <a href="#plan" className={styles.primary}>
            Plan a tour
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 8h9M8.5 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
          <a href="#brief" className={styles.secondary}>
            <span className={styles.play} aria-hidden="true" />
            See a real run
          </a>
        </div>

        <p data-fade className={styles.meta}>
          Any artist <i /> any country <i /> about a minute
        </p>
      </div>

      <div data-fade className={styles.legend} aria-hidden="true">
        <span><i className={styles.keyHeat} />Fan heat</span>
        <span><i className={styles.keyAi} />AI&apos;s guess</span>
        <span><i className={styles.keyRoute} />Your route</span>
        <span className={styles.hint}>Drag to turn · tap to ripple</span>
      </div>

      <a data-fade href="#blind-spots" className={styles.scrollCue}>
        <span className={styles.cueLine} />
        Scroll to see what AI misses
      </a>
    </section>
  );
}
