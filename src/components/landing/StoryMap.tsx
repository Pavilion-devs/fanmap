"use client";

import { useEffect, useRef } from "react";
import { HOTSPOTS, LAKES, ROUTE, US_OUTLINE } from "./fanmap-data";
import styles from "./StoryMap.module.css";

// Flat, top-down dot map for the how-it-works story. Coordinates live in a
// 1000 × 560 frame (equirectangular, longitude squeezed to keep the US shape).
const W = 1000;
const H = 560;
const px = (lon: number) => (lon + 125.5) * 16.94;
const py = (lat: number) => (49.9 - lat) * 21.5;
const pct = (lat: number, lon: number) => ({ left: `${(px(lon) / W) * 100}%`, top: `${(py(lat) / H) * 100}%` });

type Dot = { x: number; y: number; heat: number; xn: number };

function insideOutline(lon: number, lat: number) {
  let hit = false;
  for (let i = 0, j = US_OUTLINE.length - 1; i < US_OUTLINE.length; j = i++) {
    const [xi, yi] = US_OUTLINE[i];
    const [xj, yj] = US_OUTLINE[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function buildDots(): Dot[] {
  const hot = HOTSPOTS.map((h) => [px(h.lon), py(h.lat), h.heat] as const);
  const dots: Dot[] = [];
  const step = 10;
  for (let row = 0, y = 4; y < H; y += step * 0.88, row++) {
    for (let x = (row % 2) * (step / 2) + 2; x < W; x += step) {
      const lon = x / 16.94 - 125.5;
      const lat = 49.9 - y / 21.5;
      if (!insideOutline(lon, lat)) continue;
      if (LAKES.some(([lo, la, rx, ry]) => ((lon - lo) / rx) ** 2 + ((lat - la) / ry) ** 2 < 1)) continue;
      let heat = 0;
      for (const [hx, hy, hv] of hot) {
        const d2 = (x - hx) ** 2 + (y - hy) ** 2;
        heat = Math.max(heat, hv * Math.exp(-d2 / 800), hv * 0.3 * Math.exp(-d2 / 9800));
      }
      dots.push({ x, y, heat, xn: x / W });
    }
  }
  return dots;
}

const BASE = [58, 53, 46];
const AMBER = [255, 181, 71];
const HOT = [255, 241, 214];
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
function heatRGB(t: number) {
  return t < 0.5 ? mix(BASE, AMBER, t / 0.5) : mix(AMBER, HOT, (t - 0.5) / 0.5);
}

type Side = "left" | "right" | "above" | "below";

// The Northeast cities sit a few pixels apart, so each label gets its own side.
const RANKED: { lat: number; lon: number; label: string; rank?: string; side: Side; minor?: boolean }[] = [
  { ...HOTSPOTS[0], label: "Northampton, MA", rank: "Top 0.1%", side: "below" },
  { ...HOTSPOTS[2], label: "Burlington, VT", rank: "Top 0.1%", side: "above" },
  { ...HOTSPOTS[1], label: "Portland, OR", side: "right" },
  { ...HOTSPOTS[3], label: "Portland, ME", side: "right", minor: true },
  { ...HOTSPOTS[4], label: "Madison, WI", side: "below", minor: true },
];

const VENUES: { name: string; lat: number; lon: number; side: Side }[] = [
  { name: "Wonder Ballroom", lat: 45.52, lon: -122.68, side: "right" },
  { name: "Great American Music Hall", lat: 37.77, lon: -122.42, side: "right" },
  { name: "High Noon Saloon", lat: 43.07, lon: -89.4, side: "above" },
  { name: "John M. Greene Hall", lat: 42.32, lon: -72.63, side: "left" },
  { name: "The Sinclair", lat: 42.36, lon: -71.06, side: "below" },
];

function routePath() {
  const pts = ROUTE.map((r) => [px(r.lon), py(r.lat)]);
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const dist = Math.hypot(bx - ax, by - ay);
    d += ` Q${((ax + bx) / 2).toFixed(1)} ${((ay + by) / 2 - dist * 0.2).toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`;
  }
  return d;
}
const ROUTE_D = routePath();

export default function StoryMap({ step }: { step: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stepRef = useRef(step);

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dots = buildDots();

    // Two eased layers: the grey grid appearing, then the heat filling in.
    let appear = reduce ? 1 : 0;
    let heat = reduce ? 1 : 0;
    let raf = 0;
    let visible = false;
    let dpr = 1;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(canvas);

    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (!visible) return;
      const s = stepRef.current;
      const k = reduce ? 1 : 0.07;
      appear += ((s >= 0 ? 1 : 0) - appear) * k;
      heat += ((s >= 1 ? 1 : 0) - heat) * k;
      const sx = canvas.width / W;
      const sy = canvas.height / H;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const d of dots) {
        // A west-to-east wave: each dot lags a little behind the one to its left.
        const a = Math.min(1, Math.max(0, appear * 1.6 - d.xn * 0.6));
        if (a <= 0) continue;
        const h = Math.min(1, Math.max(0, heat * 1.6 - d.xn * 0.6)) * d.heat;
        const [r, g, b] = heatRGB(h);
        const radius = (1.6 + 3.2 * h) * a;
        ctx.fillStyle = `rgba(${r},${g},${b},${(0.55 + 0.45 * h) * a})`;
        ctx.beginPath();
        ctx.arc(d.x * sx, d.y * sy, radius * sx, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  return (
    <div className={styles.map} data-step={step}>
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />

      <div className={styles.found} data-on={step >= 0 ? "1" : "0"}>
        <span className={styles.check} aria-hidden="true" />
        Phoebe Bridgers
        <span className={styles.foundMeta}>Artist · found</span>
      </div>

      <div className={styles.areas} data-on={step >= 1 ? "1" : "0"}>
        <b>8,576</b> areas scored
      </div>

      {RANKED.map((r, i) => (
        <div
          key={r.label}
          className={styles.rank}
          style={{ ...pct(r.lat, r.lon), transitionDelay: `${i * 90}ms` }}
          data-on={step >= 2 ? "1" : "0"}
          data-side={r.side}
          data-minor={r.minor ? "1" : undefined}
        >
          <span className={styles.rankDot} />
          <span className={styles.rankText}>
            {r.label}
            {r.rank && <em>{r.rank}</em>}
          </span>
        </div>
      ))}

      {VENUES.map((v, i) => (
        <div
          key={v.name}
          className={styles.venue}
          style={{ ...pct(v.lat, v.lon), transitionDelay: `${i * 110}ms` }}
          data-side={v.side}
          data-on={step >= 3 ? "1" : "0"}
        >
          <svg width="14" height="18" viewBox="0 0 14 18" aria-hidden="true">
            <path d="M7 17s6-5.5 6-10A6 6 0 0 0 1 7c0 4.5 6 10 6 10z" fill="#FFB547" />
            <circle cx="7" cy="7" r="2.2" fill="#0E0D0B" />
          </svg>
          <span>{v.name}</span>
        </div>
      ))}

      <div className={styles.panel} data-on={step >= 4 ? "1" : "0"}>
        <p>
          <span>Openers</span>Lucy Dacus · Julien Baker · Christian Lee Hutson
        </p>
        <p>
          <span>Crowd</span>Mostly 18–34, leans female
        </p>
        <p>
          <span>Brands</span>Fender · Dr. Martens · Polaroid
        </p>
      </div>

      <svg className={styles.route} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={ROUTE_D} pathLength={1} data-on={step >= 5 ? "1" : "0"} />
      </svg>
      {ROUTE.map((r, i) => (
        <span
          key={r.name}
          className={styles.stop}
          style={{ ...pct(r.lat, r.lon), transitionDelay: `${300 + i * 160}ms` }}
          data-on={step >= 5 ? "1" : "0"}
        >
          {i + 1}
        </span>
      ))}

      <div className={styles.brief} data-on={step >= 5 ? "1" : "0"}>
        <span className={styles.briefTag}>Tour brief</span>
        <b>Phoebe Bridgers · 8 nights</b>
        <span>Ready to send</span>
      </div>
    </div>
  );
}
