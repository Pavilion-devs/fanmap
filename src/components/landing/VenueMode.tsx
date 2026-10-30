"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import styles from "./VenueMode.module.css";

type Pick = { name: string; genre: string; fit: number; local?: boolean; draws?: boolean };
type Venue = {
  id: string;
  name: string;
  city: string;
  ask: string;
  size: string;
  crowd: string;
  picks: Pick[];
  bills: { head: string; support: string; shared: string[] }[];
  missed: string;
  aiSaid: string[];
  run: string;
};

// From the warmed example runs (src/lib/examples.ts), trimmed for the page.
const VENUES: Venue[] = [
  {
    id: "first-avenue",
    name: "First Avenue",
    city: "Minneapolis",
    ask: "1,550 cap · “a couple of hip hop nights, and more local acts”",
    size: "Mid-size · 600–2,500",
    crowd: "Mostly 18–34, leans female",
    picks: [
      { name: "Prof", genre: "Hip hop", fit: 90, local: true, draws: true },
      { name: "Dessa", genre: "Alternative hip hop", fit: 88, local: true, draws: true },
      { name: "Cordae", genre: "Hip hop · jazz rap", fit: 93, draws: true },
      { name: "Benny the Butcher", genre: "East Coast hip hop", fit: 92, draws: true },
      { name: "Rainbow Kitten Surprise", genre: "Indie rock", fit: 93 },
      { name: "Bad Bad Hats", genre: "Indie pop", fit: 92, local: true },
    ],
    bills: [
      { head: "Dessa", support: "Prof", shared: ["Lyrical", "Sampler"] },
      { head: "Benny the Butcher", support: "Four Fists", shared: ["Jazz", "Funk", "Sampler"] },
    ],
    missed: "10",
    aiSaid: ["Lizzo", "Bon Iver", "Big Thief", "Sylvan Esso", "Wet Leg"],
    run: "8 tool calls · 41 s",
  },
  {
    id: "cains",
    name: "Cain's Ballroom",
    city: "Tulsa",
    ask: "1,700 cap · country room",
    size: "Mid-size · 600–2,500",
    crowd: "Under 25 and 45–54, leans female",
    picks: [
      { name: "Turnpike Troubadours", genre: "Red dirt · Americana", fit: 93, local: true, draws: true },
      { name: "Jason Boland & The Stragglers", genre: "Red dirt", fit: 93, local: true, draws: true },
      { name: "Cody Johnson", genre: "Country", fit: 95 },
      { name: "Wade Bowen", genre: "Red dirt", fit: 95 },
      { name: "Chris Stapleton", genre: "Americana", fit: 92, draws: true },
      { name: "Eli Young Band", genre: "Alt country", fit: 95 },
    ],
    bills: [
      { head: "Chris Stapleton", support: "Turnpike Troubadours", shared: ["Blues", "Folk"] },
      { head: "Thomas Rhett", support: "Mike Ryan", shared: ["Country", "Fiddle"] },
    ],
    missed: "9",
    aiSaid: ["Tyler Childers", "Charley Crockett", "Whiskey Myers", "Larkin Poe", "Nathaniel Rateliff"],
    run: "7 tool calls · 39 s",
  },
  {
    id: "brixton",
    name: "O2 Academy Brixton",
    city: "London",
    ask: "4,900 cap · hip hop and grime",
    size: "Theatre · 2,500–7,000",
    crowd: "Mostly 18–34, balanced by gender",
    picks: [
      { name: "Skepta", genre: "Grime", fit: 93, local: true },
      { name: "Giggs", genre: "UK hip hop", fit: 92, local: true },
      { name: "J Hus", genre: "UK rap", fit: 92, local: true },
      { name: "AJ Tracey", genre: "Grime", fit: 91, local: true, draws: true },
      { name: "Devlin", genre: "Grime", fit: 91, local: true, draws: true },
      { name: "Wiley", genre: "Grime", fit: 91, local: true },
    ],
    bills: [
      { head: "Wiley", support: "Giggs", shared: ["Funk", "Jazz"] },
      { head: "Skepta", support: "J Hus", shared: ["Funk", "Reggae"] },
    ],
    missed: "7",
    aiSaid: ["Stormzy", "Dave", "Central Cee", "Little Simz", "Headie One"],
    run: "7 tool calls · 35 s",
  },
];

export default function VenueMode() {
  const ref = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  // How many characters of the venue name are typed into the search bar.
  const [typed, setTyped] = useState(Number.MAX_SAFE_INTEGER);
  const v = VENUES[active];
  const query = `${v.name}, ${v.city}`;

  const choose = (i: number) => {
    setActive(i);
    setTyped(window.matchMedia("(prefers-reduced-motion: reduce)").matches ? Number.MAX_SAFE_INTEGER : 0);
  };

  const done = typed >= query.length;
  useEffect(() => {
    if (done) return;
    const id = window.setInterval(() => setTyped((n) => n + 1), 34);
    return () => window.clearInterval(id);
  }, [done]);

  useEffect(() => {
    const root = ref.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      // The board rises and flattens out as it comes into view.
      gsap.fromTo(
        "[data-board]",
        { y: 120, rotateX: 14, scale: 0.95 },
        {
          y: 0,
          rotateX: 0,
          scale: 1,
          ease: "none",
          scrollTrigger: { trigger: "[data-board]", start: "top bottom", end: "top 35%", scrub: 0.6 },
        },
      );
      ScrollTrigger.create({
        trigger: "[data-board]",
        start: "top 70%",
        once: true,
        onEnter: () => {
          root.dataset.live = "1";
          setTyped(0);
        },
      });
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={ref} id="venues" className={styles.section} aria-labelledby="venues-title">
      <div className={styles.intro}>
        <header>
          <p data-reveal className={styles.label}>
            <span className={styles.labelDot} /> For venues
          </p>
          <h2 id="venues-title" data-reveal className={styles.title}>
            Run a room?
            <br />
            <em>Turn the map around.</em>
          </h2>
        </header>
        <div className={styles.introSide}>
          <p data-reveal className={styles.lede}>
            Name a venue. Fanmap reads the taste of the people around it and tells you who to book, sized to your
            capacity, with local acts to open and double bills that share a crowd.
          </p>
          <div data-reveal className={styles.tabs} role="tablist" aria-label="Example venues">
            {VENUES.map((x, i) => (
              <button
                key={x.id}
                type="button"
                role="tab"
                aria-selected={i === active}
                aria-controls="venue-board"
                className={styles.tab}
                onClick={() => choose(i)}
              >
                {x.name}
                <span>{x.city}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.boardWrap}>
        <div data-board id="venue-board" role="tabpanel" className={styles.board} aria-label={`${v.name} booking plan`}>
          <div className={styles.query}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className={styles.typed}>
              {query.slice(0, typed)}
              <i className={styles.caret} data-done={done ? "1" : "0"} />
            </span>
            <span className={styles.ask}>{v.ask}</span>
          </div>

          <div key={v.id} className={styles.body}>
            <div className={styles.meta}>
              <div>
                <span>Room</span>
                {v.size}
              </div>
              <div>
                <span>Crowd</span>
                {v.crowd}
              </div>
              <div>
                <span>Run</span>
                {v.run}
              </div>
            </div>

            <div className={styles.cols}>
              <div className={styles.picks}>
                <h3 className={styles.colHead}>
                  Book next <span>Fit with this crowd</span>
                </h3>
                <ol>
                  {v.picks.map((p, i) => (
                    <li key={p.name} style={{ "--i": i } as CSSProperties}>
                      <span className={styles.pickName}>
                        {p.name}
                        <small>{p.genre}</small>
                      </span>
                      <span className={styles.badges}>
                        {p.local && <b className={styles.local}>Local</b>}
                        {p.draws && <b className={styles.draws}>Draws here</b>}
                      </span>
                      <span className={styles.fit}>
                        <i style={{ "--w": `${p.fit}%` } as CSSProperties} />
                        <em>{p.fit}</em>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className={styles.side}>
                <h3 className={styles.colHead}>
                  Double bills <span>Shared taste</span>
                </h3>
                {v.bills.map((b, i) => (
                  <div key={b.head + b.support} className={styles.bill} style={{ "--i": i + 3 } as CSSProperties}>
                    <p>
                      {b.head}
                      <span>+ {b.support}</span>
                    </p>
                    <div className={styles.chips}>
                      {b.shared.map((s) => (
                        <span key={s}>{s}</span>
                      ))}
                    </div>
                  </div>
                ))}

                <div className={styles.missed} style={{ "--i": 6 } as CSSProperties}>
                  <p className={styles.missedBig}>
                    {v.missed}
                    <span>/10</span>
                  </p>
                  <p className={styles.missedText}>picks a chatbot didn&apos;t name. It said:</p>
                  <p className={styles.aiSaid}>
                    {v.aiSaid.map((n) => (
                      <s key={n}>{n}</s>
                    ))}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
