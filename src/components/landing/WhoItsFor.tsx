"use client";

import Image from "next/image";
import { useState } from "react";
import { PHOTOS, type Photo } from "./photos";
import styles from "./WhoItsFor.module.css";

const ROWS: { title: string; who: string; body: string; points: string[]; mode: string; photos: Photo[] }[] = [
  {
    title: "Artist teams",
    who: "Managers · agents · artists booking themselves",
    body: "Name the act and the country. Get the cities where the fans are, the rooms that fit, and who should open.",
    points: ["Cities ranked by fan strength, not population", "Rooms sized to the act, openers from each scene", "A route and a one-page brief for promoters"],
    mode: "Artist mode",
    photos: [PHOTOS.van, PHOTOS.stageDoor, PHOTOS.guitarist],
  },
  {
    title: "Venues & promoters",
    who: "Talent buyers · bookers · promoters",
    body: "Name the room. Get the acts its crowd already loves, sized to your capacity, plus the local scene to build nights around.",
    points: ["Acts your crowd rates, sized to the room", "Local acts for support slots and showcase nights", "Double bills with shared taste behind them"],
    mode: "Venue mode",
    photos: [PHOTOS.desk, PHOTOS.club, PHOTOS.barStage],
  },
  {
    title: "Brands & sponsors",
    who: "Partnerships · marketing teams",
    body: "Every plan comes with the crowd behind it and the brands that crowd already loves, each with a pitch you can take into the meeting.",
    points: ["Who's in the room, by age and gender", "Brands the crowd rates highest, with the reason", "Activation ideas city by city in the brief"],
    mode: "In every plan",
    photos: [PHOTOS.bar, PHOTOS.jukebox, PHOTOS.crowd],
  },
];

export default function WhoItsFor() {
  const [open, setOpen] = useState(0);

  return (
    <section id="for" className={styles.section} aria-labelledby="for-title">
      <header className={styles.head}>
        <p data-reveal className={styles.label}>
          <span className={styles.labelDot} /> Who it&apos;s for
        </p>
        <h2 id="for-title" data-reveal className={styles.title}>
          For everyone who has
          <br />
          to <em>fill the room.</em>
        </h2>
      </header>

      <ol className={styles.rows}>
        {ROWS.map((r, i) => {
          const isOpen = open === i;
          return (
            <li
              key={r.title}
              data-reveal
              data-open={isOpen ? "1" : "0"}
              className={styles.row}
              // Opens on a real mouse move, not when the page scrolls under a resting cursor.
              onPointerMove={(e) => e.pointerType === "mouse" && !isOpen && setOpen(i)}
            >
              <button
                type="button"
                className={styles.bar}
                aria-expanded={isOpen}
                aria-controls={`for-panel-${i}`}
                onClick={() => setOpen(i)}
              >
                <span className={styles.num}>{String(i + 1).padStart(2, "0")}</span>
                <span className={styles.rowTitle}>{r.title}</span>
                <span className={styles.who}>{r.who}</span>
                <span className={styles.icon} aria-hidden="true" />
              </button>

              <div id={`for-panel-${i}`} className={styles.panel} role="region" aria-label={r.title}>
                <div className={styles.panelInner}>
                  <div className={styles.copy}>
                    <span className={styles.mode}>{r.mode}</span>
                    <p>{r.body}</p>
                    <ul>
                      {r.points.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </div>
                  <div className={styles.strip}>
                    {r.photos.map((p, j) => (
                      <figure key={p.src} className={styles.photo} style={{ transitionDelay: `${120 + j * 90}ms` }}>
                        <Image src={p.src} alt={p.alt} fill sizes="(max-width: 900px) 33vw, 22vw" />
                      </figure>
                    ))}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
