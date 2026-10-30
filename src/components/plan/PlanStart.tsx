"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type CSSProperties } from "react";
import PlanForm from "@/components/PlanForm";
import { Logo } from "@/components/landing/Nav";
import { PHOTOS } from "@/components/landing/photos";
import { EXAMPLES } from "@/lib/examples";
import type { Mode } from "@/lib/types";
import styles from "./PlanStart.module.css";

const COPY: Record<Mode, { title: [string, string]; lede: string; gets: [string, string][] }> = {
  artist: {
    title: ["Plan a tour", "where the fans are."],
    lede: "Name the artist and the country. The agent maps where the fans actually are, picks the cities, routes the nights and writes the brief. It takes about a minute.",
    gets: [
      ["The route", "Cities ranked by fan strength, in driving order"],
      ["A room each night", "Venues sized to the act, with backups"],
      ["Local openers", "Acts from each scene that share the crowd"],
      ["The brief", "One page for promoters, sponsors and the team"],
    ],
  },
  venue: {
    title: ["Book a room", "your crowd will fill."],
    lede: "Name the venue. The agent reads its crowd, finds the acts they love at your size, and builds local nights and double bills around them.",
    gets: [
      ["Who to book", "Acts your crowd rates, sized to the room"],
      ["Local nights", "The scene on your doorstep, ready for support slots"],
      ["Double bills", "Pairs that share a crowd, with the reason"],
      ["The brief", "A booking shortlist the team can act on"],
    ],
  },
};

export default function PlanStart({ defaultMode }: { defaultMode: Mode }) {
  const [mode, setMode] = useState<Mode>(defaultMode);
  const copy = COPY[mode];

  return (
    <div className={styles.page}>
      <header className={styles.bar}>
        <Logo />
        <Link href="/" className={styles.back}>
          How it works
        </Link>
      </header>

      <main className={styles.main}>
        <div className={styles.bg} aria-hidden="true">
          <Image src={PHOTOS.theatre.src} alt="" fill sizes="100vw" priority />
        </div>

        <section className={styles.hero} aria-labelledby="start-title">
          <p className={styles.kicker}>
            <span className={styles.dot} /> {mode === "artist" ? "Artist mode" : "Venue mode"}
          </p>
          <h1 id="start-title" key={mode} className={styles.title}>
            {copy.title[0]}
            <br />
            <em>{copy.title[1]}</em>
          </h1>
          <p className={styles.lede}>{copy.lede}</p>
          <PlanForm defaultMode={defaultMode} onModeChange={setMode} className={styles.form} />
        </section>

        <section className={styles.gets} aria-label="What you get">
          {copy.gets.map(([title, text], i) => (
            <div key={title} style={{ "--i": i } as CSSProperties}>
              <span className={styles.n}>{String(i + 1).padStart(2, "0")}</span>
              <b>{title}</b>
              <p>{text}</p>
            </div>
          ))}
        </section>

        <section className={styles.saved} aria-labelledby="saved-title">
          <div className={styles.savedHead}>
            <h2 id="saved-title">Open a saved plan</h2>
            <p>Real runs, replayed in a few seconds.</p>
          </div>
          <ul>
            {EXAMPLES.map((x) => (
              <li key={x.id}>
                <Link href={`/plan?example=${x.id}`}>
                  <span className={styles.tag}>{x.input.mode === "artist" ? "Tour" : "Booking"}</span>
                  <b>{x.title}</b>
                  <span className={styles.sub}>{x.subtitle}</span>
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3 8h9M8.5 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
