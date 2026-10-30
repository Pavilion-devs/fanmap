"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import PlanForm from "@/components/PlanForm";
import { PHOTOS } from "./photos";
import styles from "./PlanCta.module.css";

export default function PlanCta() {
  const ref = useRef<HTMLElement>(null);

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

        <div data-reveal className={styles.composer}>
          <PlanForm />
        </div>
      </div>
    </section>
  );
}
