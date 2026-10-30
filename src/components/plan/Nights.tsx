"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { VenueMatch } from "@/lib/types";
import { compact, fit100, fmt, pad2, tierLabel, type Night } from "./format";
import styles from "./Nights.module.css";

interface Props {
  nights: Night[];
  country: string;
  active?: string;
  onHover: (label: string | undefined) => void;
  onInView: (label: string) => void;
}

const spotWhen = (s: VenueMatch) => (s.kind === "after_show" ? "After the show" : "Before the show");

export default function Nights({ nights, country, active, onHover, onInView }: Props) {
  const ref = useRef<HTMLOListElement>(null);

  // the night nearest the middle of the screen lights up on the map
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const label = hit?.target.getAttribute("data-city");
        if (label) onInView(label);
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    root.querySelectorAll("[data-city]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [nights, onInView]);

  return (
    <ol ref={ref} className={styles.list}>
      {nights.map((n, i) => {
        const next = nights[i + 1];
        return (
          <li key={n.city.place.label} className={styles.item} style={{ "--i": i } as CSSProperties}>
            <NightCard night={n} country={country} on={active === n.city.place.label} onHover={onHover} />
            {next && (
              <p className={styles.leg} aria-label={`${fmt(next.km)} kilometres to ${next.city.place.label}`}>
                <span className={styles.legLine} aria-hidden="true" />
                {fmt(next.km)} km
                {next.day - n.day > 1 && <span> · {next.day - n.day - 1} day{next.day - n.day - 1 > 1 ? "s" : ""} off</span>}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function NightCard({ night, country, on, onHover }: { night: Night; country: string; on: boolean; onHover: Props["onHover"] }) {
  const [more, setMore] = useState(false);
  const { city } = night;
  // "Glasgow, United Kingdom" reads better as "Glasgow, Scotland"
  const [name, labelRegion] = city.place.label.split(", ");
  const region = labelRegion === country ? city.place.region : labelRegion;
  const room = city.venues.find((v) => night.room?.includes(v.name)) ?? city.venues[0];
  const opener = city.localOpeners.find((o) => night.opener?.includes(o.name)) ?? city.localOpeners[0];
  const spot = city.spots[0];
  const otherRooms = city.venues.filter((v) => v !== room);
  const otherOpeners = city.localOpeners.filter((o) => o !== opener);
  const extra = otherRooms.length + otherOpeners.length + Math.max(0, city.spots.length - 1);

  return (
    <article
      id={`night-${night.order}`}
      data-city={city.place.label}
      data-on={on ? "1" : "0"}
      className={styles.card}
      onPointerEnter={(e) => e.pointerType === "mouse" && onHover(city.place.label)}
      onPointerLeave={() => onHover(undefined)}
    >
      <div className={styles.rail}>
        <span className={styles.day}>Day</span>
        <span className={styles.dayNum}>{pad2(night.day + 1)}</span>
      </div>

      <div className={styles.main}>
        <header className={styles.top}>
          <h3 className={styles.city}>
            {name}
            {region && <span>, {region}</span>}
          </h3>
          <span className={styles.rank} title="How the strongest fan area here ranks among all areas in the country">
            Fans {city.stats.topShare}
          </span>
        </header>
        <p className={styles.why}>{city.reason}</p>
        <p className={styles.facts}>
          <span>{city.stats.fanAreas} strong fan areas</span>
          <span>{compact(city.stats.marketPopulation)} metro</span>
          {city.stats.nearby.length > 0 && <span>Also reaches {city.stats.nearby.slice(0, 2).join(", ")}</span>}
        </p>

        <dl className={styles.grid}>
          <div>
            <dt>Room</dt>
            <dd>
              {night.room ?? "To be confirmed"}
              {room && (
                <small>
                  {tierLabel(room.tier)} · fan fit {fit100(room.affinity)}
                </small>
              )}
            </dd>
          </div>
          <div>
            <dt>Local opener</dt>
            <dd>
              {night.opener ?? "Open slot"}
              {opener && (
                <small>
                  Fit {fit100(opener.fit)}
                  {opener.confirmedLocal && " · from here"}
                </small>
              )}
            </dd>
          </div>
          {spot && (
            <div>
              <dt>{spotWhen(spot)}</dt>
              <dd>
                {spot.name}
                <small>{spot.category ?? "Nearby"}</small>
              </dd>
            </div>
          )}
        </dl>

        {extra > 0 && (
          <>
            <button type="button" className={styles.more} aria-expanded={more} onClick={() => setMore((m) => !m)}>
              {more ? "Fewer options" : `${extra} more option${extra > 1 ? "s" : ""}`}
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div className={styles.drawer} data-open={more ? "1" : "0"}>
              <div className={styles.drawerInner}>
                {otherRooms.length > 0 && (
                  <Options title="Other rooms" items={otherRooms.map((v) => [v.name, `${tierLabel(v.tier)} · fit ${fit100(v.affinity)}`])} />
                )}
                {otherOpeners.length > 0 && (
                  <Options title="Other local acts" items={otherOpeners.map((o) => [o.name, `Fit ${fit100(o.fit)}${o.confirmedLocal ? " · from here" : ""}`])} />
                )}
                {city.spots.length > 1 && (
                  <Options title="Places the fans like" items={city.spots.slice(1).map((s) => [s.name, s.category ?? spotWhen(s)])} />
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </article>
  );
}

function Options({ title, items }: { title: string; items: [string, string][] }) {
  return (
    <div className={styles.options}>
      <p>{title}</p>
      <ul>
        {items.map(([a, b]) => (
          <li key={a}>
            <span>{a}</span>
            <small>{b}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}
