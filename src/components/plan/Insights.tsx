import Image from "next/image";
import type { CSSProperties } from "react";
import type { ArtistRef, Audience, BrandMatch } from "@/lib/types";
import { fit100 } from "./format";
import styles from "./Insights.module.css";

type Act = ArtistRef & { fit: number; smaller?: boolean; confirmedLocal?: boolean };

interface Props {
  audience?: Audience;
  acts?: Act[];
  actsTitle: string;
  actsNote: string;
  brands: BrandMatch[];
}

export default function Insights({ audience, acts, actsTitle, actsNote, brands }: Props) {
  return (
    <div className={styles.grid}>
      {audience && <Crowd audience={audience} />}
      {acts && acts.length > 0 && (
        <section className={styles.card} aria-labelledby="acts-title">
          <p className={styles.kicker}>{actsNote}</p>
          <h3 id="acts-title" className={styles.title}>
            {actsTitle}
          </h3>
          <ul className={styles.acts}>
            {acts.slice(0, 5).map((a, i) => (
              <li key={a.id} style={{ "--i": i } as CSSProperties}>
                <span className={styles.avatar}>
                  {a.image ? <Image src={a.image} alt="" fill sizes="44px" /> : <span>{a.name[0]}</span>}
                </span>
                <span className={styles.actText}>
                  <b>{a.name}</b>
                  <small>
                    {a.genres.slice(0, 2).join(" · ")}
                    {a.smaller && " · smaller act"}
                    {a.confirmedLocal && " · local"}
                  </small>
                </span>
                <Meter value={a.fit} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {brands.length > 0 && (
        <section className={styles.card} aria-labelledby="brands-title">
          <p className={styles.kicker}>Brands this crowd rates</p>
          <h3 id="brands-title" className={styles.title}>
            Sponsors to pitch
          </h3>
          <ul className={styles.brands}>
            {brands.slice(0, 4).map((b, i) => (
              <li key={b.id} style={{ "--i": i } as CSSProperties}>
                <span className={styles.brandTop}>
                  <b>{b.name}</b>
                  <Meter value={b.affinity} />
                </span>
                <p>{b.pitch}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Meter({ value }: { value: number }) {
  return (
    <span className={styles.meter} title="Affinity with this crowd, out of 100">
      <span className={styles.meterBar} aria-hidden="true">
        <i style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
      <span className={styles.meterNum}>{fit100(value)}</span>
    </span>
  );
}

function Crowd({ audience }: { audience: Audience }) {
  const max = Math.max(0.5, ...audience.age.map((a) => Math.abs(a.lean)));
  const female = audience.gender.female;
  const lean = Math.abs(female) < 0.08 ? "Even split" : female > 0 ? "Leans female" : "Leans male";
  return (
    <section className={styles.card} aria-labelledby="crowd-title">
      <p className={styles.kicker}>Who&apos;s in the room</p>
      <h3 id="crowd-title" className={styles.title}>
        {audience.summary}
      </h3>

      <div className={styles.ages} role="img" aria-label={`Age profile: ${audience.age.map((a) => `${a.band} ${a.lean > 0 ? "over" : "under"}-represented`).join(", ")}`}>
        <p className={styles.axis}>
          <span>Fewer than usual</span>
          <span>More than usual</span>
        </p>
        {audience.age.map((a, i) => (
          <div key={a.band} className={styles.age} style={{ "--i": i } as CSSProperties}>
            <span className={styles.band}>{a.band}</span>
            <span className={styles.track}>
              <i
                data-pos={a.lean > 0 ? "1" : "0"}
                style={{ width: `${(Math.abs(a.lean) / max) * 50}%`, [a.lean > 0 ? "left" : "right"]: "50%" } as CSSProperties}
              />
            </span>
          </div>
        ))}
      </div>

      <div className={styles.gender}>
        <span>Male</span>
        <span className={styles.genderTrack} aria-hidden="true">
          <i style={{ left: `${50 + female * 50}%` }} />
        </span>
        <span>Female</span>
        <b>{lean}</b>
      </div>

      {audience.traits.length > 0 && (
        <ul className={styles.traits}>
          {audience.traits.slice(0, 5).map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
