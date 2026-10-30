"use client";

import Image from "next/image";
import { useState, type CSSProperties } from "react";
import type { ArtistRef, BookingPick, DoubleBill, LocalOpener } from "@/lib/types";
import { fit100 } from "./format";
import styles from "./VenueBoard.module.css";

const FILTERS = [
  ["all", "All"],
  ["local", "Local"],
  ["draw", "Draws here"],
] as const;
type Filter = (typeof FILTERS)[number][0];

function Avatar({ artist, size = 40 }: { artist: ArtistRef; size?: number }) {
  return (
    <span className={styles.avatar} style={{ width: size, height: size }}>
      {artist.image ? <Image src={artist.image} alt="" fill sizes={`${size}px`} /> : <span>{artist.name[0]}</span>}
    </span>
  );
}

interface BoardProps {
  venue: string;
  sizeBand?: string;
  picks?: BookingPick[];
  status?: string;
}

export default function VenueBoard({ venue, sizeBand, picks, status }: BoardProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = (picks ?? []).filter((p) => (filter === "local" ? p.confirmedLocal : filter === "draw" ? p.localDraw : true));

  return (
    <section className={styles.board} aria-label="Booking board">
      <header className={styles.head}>
        <span className={styles.title}>Booking board · {venue}</span>
        {sizeBand && <span className={styles.meta}>Acts sized {sizeBand}</span>}
      </header>

      <div className={styles.filters} role="tablist" aria-label="Filter acts">
        {FILTERS.map(([id, label]) => {
          const count = (picks ?? []).filter((p) => (id === "local" ? p.confirmedLocal : id === "draw" ? p.localDraw : true)).length;
          return (
            <button key={id} type="button" role="tab" aria-selected={filter === id} className={styles.filter} onClick={() => setFilter(id)}>
              {label}
              {picks && <span>{count}</span>}
            </button>
          );
        })}
      </div>

      <ol className={styles.rows}>
        {shown.map((p, i) => (
          <li key={p.artist.id} className={styles.row} style={{ "--i": Math.min(i, 14) } as CSSProperties}>
            <span className={styles.n}>{String(i + 1).padStart(2, "0")}</span>
            <Avatar artist={p.artist} />
            <span className={styles.who}>
              <b>{p.artist.name}</b>
              <small>{p.artist.genres.slice(0, 3).join(" · ")}</small>
              {p.reason && <span className={styles.reason}>{p.reason}</span>}
            </span>
            <span className={styles.tags}>
              {p.confirmedLocal && <span className={styles.local}>Local</span>}
              {p.localDraw && <span className={styles.draw}>Draws here</span>}
            </span>
            <span className={styles.fit}>
              <span className={styles.fitBar} aria-hidden="true">
                <i style={{ width: `${p.fit}%` }} />
              </span>
              <b>{Math.round(p.fit)}</b>
            </span>
          </li>
        ))}
        {!picks &&
          Array.from({ length: 7 }, (_, i) => (
            <li key={i} className={`${styles.row} ${styles.ghost}`} aria-hidden="true" style={{ "--i": i } as CSSProperties}>
              <span className={styles.n}>{String(i + 1).padStart(2, "0")}</span>
              <span className={styles.avatar} />
              <span className={styles.who}>
                <i />
                <i />
              </span>
            </li>
          ))}
        {picks && !shown.length && <li className={styles.empty}>No acts in this filter.</li>}
      </ol>

      {status && (
        <p className={styles.status} role="status">
          <span className={styles.spinner} aria-hidden="true" />
          {status}
        </p>
      )}
    </section>
  );
}

export function LocalScene({ acts, city }: { acts: LocalOpener[]; city: string }) {
  return (
    <div className={styles.scene}>
      {acts.slice(0, 8).map((a, i) => (
        <article key={a.id} className={styles.sceneCard} style={{ "--i": i } as CSSProperties}>
          <Avatar artist={a} size={48} />
          <span className={styles.who}>
            <b>{a.name}</b>
            <small>{a.genres.slice(0, 2).join(" · ")}</small>
          </span>
          <span className={styles.sceneMeta}>
            <span>Fit {fit100(a.fit)}</span>
            {a.confirmedLocal && <span className={styles.local}>From {city}</span>}
          </span>
        </article>
      ))}
    </div>
  );
}

export function DoubleBills({ bills }: { bills: DoubleBill[] }) {
  return (
    <div className={styles.bills}>
      {bills.map((b, i) => (
        <article key={`${b.headliner.id}-${b.support.id}`} className={styles.bill} style={{ "--i": i } as CSSProperties}>
          <div className={styles.billPair}>
            <Avatar artist={b.headliner} size={52} />
            <Avatar artist={b.support} size={52} />
          </div>
          <h4>
            {b.headliner.name} <em>with</em> {b.support.name}
          </h4>
          <p>{b.reason}</p>
          {b.sharedTaste.length > 0 && (
            <ul>
              {b.sharedTaste.slice(0, 4).map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </div>
  );
}
