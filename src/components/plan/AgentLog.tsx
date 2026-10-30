"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { RunInfo } from "@/lib/types";
import { duration, pad2 } from "./format";
import type { LogItem } from "./usePlanStream";
import styles from "./AgentLog.module.css";

interface Props {
  log: LogItem[];
  running: boolean;
  elapsed: number;
  run?: RunInfo;
  onCancel?: () => void;
}

const clock = (s: number) => `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;

export default function AgentLog({ log, running, elapsed, run, onCancel }: Props) {
  const listRef = useRef<HTMLOListElement>(null);
  const [open, setOpen] = useState(false);
  const expanded = running || open;
  const steps = log.filter((l) => l.kind === "step");

  // keep the newest line in view while the agent works
  useEffect(() => {
    const el = listRef.current;
    if (el && running) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [log, running]);

  return (
    <section className={styles.log} data-running={running ? "1" : "0"} data-open={expanded ? "1" : "0"} aria-label="What the agent did">
      <header className={styles.head}>
        <span className={styles.who}>
          <span className={styles.dot} aria-hidden="true" />
          {running ? "Agent working" : "Agent"}
        </span>
        <span className={styles.clock} aria-live="off">
          {running ? clock(elapsed) : run ? duration(run.ms) : clock(elapsed)}
        </span>
        {running && onCancel && (
          <button type="button" className={styles.cancel} onClick={onCancel}>
            Cancel
          </button>
        )}
      </header>

      {!running && run && (
        <div className={styles.summary}>
          <p className={styles.summaryLine}>
            <b>{run.toolCalls.length || steps.length} tool calls</b>
            {run.turns > 0 && <> · {run.turns} turns</>} · {duration(run.ms)}
            {run.engine === "agent" && run.model && <span className={styles.model}>{modelName(run.model)}</span>}
          </p>
          {run.cached && <p className={styles.sub}>Replayed from a saved run of the same request.</p>}
          {run.engine === "pipeline" && <p className={styles.sub}>Built straight from the data, without the agent&apos;s write-up.</p>}
          <button type="button" className={styles.toggle} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? "Hide the agent's work" : "Show the agent's work"}
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}

      <div className={styles.body}>
        <ol ref={listRef} className={styles.list} aria-live="polite">
          {log.map((item, i) =>
            item.kind === "thought" ? (
              <li key={item.id} className={styles.thought} style={{ "--i": i } as CSSProperties}>
                <q>{item.text}</q>
              </li>
            ) : (
              <li key={item.id} className={styles.step} data-status={item.status}>
                <span className={styles.icon} aria-hidden="true">
                  {item.status === "running" ? (
                    <span className={styles.spin} />
                  ) : item.status === "failed" ? (
                    <svg width="12" height="12" viewBox="0 0 12 12">
                      <path d="m3.5 3.5 5 5m0-5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 12 12">
                      <path d="m2.5 6.2 2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className={styles.text}>
                  <span className={styles.label}>{item.label}</span>
                  {item.detail && <span className={styles.detail}>{item.detail}</span>}
                </span>
                <span className={styles.ms}>
                  {item.tool && <code>{item.tool}</code>}
                  {item.ms !== undefined && <span>{item.ms < 1000 ? `${item.ms} ms` : `${(item.ms / 1000).toFixed(1)} s`}</span>}
                </span>
              </li>
            ),
          )}
          {running && !log.length && (
            <li className={styles.step} data-status="running">
              <span className={styles.icon} aria-hidden="true">
                <span className={styles.spin} />
              </span>
              <span className={styles.text}>
                <span className={styles.label}>Starting the agent</span>
              </span>
            </li>
          )}
        </ol>
      </div>
    </section>
  );
}

function modelName(id: string) {
  const m = id.match(/claude-(\w+)-(\d+)(?:-(\d+))?/);
  if (!m) return id;
  return `Claude ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}
