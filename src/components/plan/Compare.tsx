import type { CSSProperties } from "react";
import type { Comparison } from "@/lib/types";
import styles from "./Compare.module.css";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export default function Compare({ comparison, unit }: { comparison: Comparison; unit: "cities" | "acts" }) {
  const { llmOnly, fanmap, onlyFanmap } = comparison;
  const ours = new Set(fanmap.items.map(norm));
  const only = new Set(onlyFanmap.map(norm));
  const total = fanmap.items.length;

  return (
    <section className={styles.section} aria-labelledby="compare-title" data-noprint>
      <div className={styles.score}>
        <p className={styles.label}>
          <span className={styles.labelDot} /> Blind spots
        </p>
        <p className={styles.big} aria-hidden="true">
          {onlyFanmap.length}
          <span>/{total}</span>
        </p>
        <h2 id="compare-title" className={styles.title}>
          {onlyFanmap.length} of these {total} {unit} <em>never come up</em> when you ask a chatbot the same question.
        </h2>
        <p className={styles.lede}>
          We asked the same model the same question with no taste data. It answered from what it knows about the {unit === "cities" ? "map" : "charts"}. Fanmap answered from where the fans are.
        </p>
      </div>

      <div className={styles.cols}>
        <div className={styles.col}>
          <h3>
            Generic AI <small>Same question, no data</small>
          </h3>
          <ol>
            {llmOnly.items.map((item, i) => {
              const miss = !ours.has(norm(item));
              return (
                <li key={item} data-miss={miss ? "1" : "0"} style={{ "--i": i } as CSSProperties}>
                  <span className={styles.n}>{String(i + 1).padStart(2, "0")}</span>
                  <span className={styles.item}>{item}</span>
                </li>
              );
            })}
          </ol>
          {llmOnly.reasoning && <q className={styles.reason}>{llmOnly.reasoning}</q>}
        </div>

        <div className={`${styles.col} ${styles.ours}`}>
          <h3>
            Fanmap <small>From fan data</small>
          </h3>
          <ol>
            {fanmap.items.map((item, i) => (
              <li key={item} data-only={only.has(norm(item)) ? "1" : "0"} style={{ "--i": i } as CSSProperties}>
                <span className={styles.n}>{String(i + 1).padStart(2, "0")}</span>
                <span className={styles.item}>{item}</span>
                {only.has(norm(item)) && <span className={styles.badge}>Only Fanmap</span>}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
