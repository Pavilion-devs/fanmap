"use client";

import { useEffect } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

// Fades and lifts every [data-reveal] element the first time it scrolls into view.
// The hidden starting state lives in globals.css so nothing flashes before hydration.
export default function ScrollReveals() {
  useEffect(() => {
    const els = gsap.utils.toArray<HTMLElement>("[data-reveal]");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      gsap.set(els, { opacity: 1, y: 0 });
      return;
    }
    gsap.registerPlugin(ScrollTrigger);
    const triggers = ScrollTrigger.batch(els, {
      start: "top 88%",
      once: true,
      onEnter: (batch) =>
        gsap.to(batch, { opacity: 1, y: 0, duration: 1.1, ease: "expo.out", stagger: 0.08, overwrite: true }),
    });
    return () => triggers.forEach((t) => t.kill());
  }, []);

  return null;
}
