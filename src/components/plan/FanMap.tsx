"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Basemap } from "@/lib/geo/basemap";
import type { FanArea } from "@/lib/types";
import styles from "./FanMap.module.css";

export type MapPoint = { label: string; lat: number; lon: number };
export type MapStop = MapPoint & { order: number; rank?: string; name?: string };

interface Props {
  basemap: Basemap;
  fanMap?: FanArea[];
  candidates?: MapPoint[];
  stops?: MapStop[];
  active?: string;
  onActive?: (label: string | undefined) => void;
  title: ReactNode;
  meta?: ReactNode;
  status?: string;
}

const HEAT_MS = 1600;
const BASE_MS = 900;

// dim → amber → hot white, the same ramp as the landing map
const RAMP: [number, number, number][] = [
  [74, 68, 60],
  [168, 104, 40],
  [255, 181, 71],
  [255, 241, 214],
];
function ramp(t: number) {
  const x = Math.min(Math.max(t, 0), 1) * (RAMP.length - 1);
  const i = Math.min(Math.floor(x), RAMP.length - 2);
  const f = x - i;
  const [a, b] = [RAMP[i], RAMP[i + 1]];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)} ${Math.round(a[1] + (b[1] - a[1]) * f)} ${Math.round(a[2] + (b[2] - a[2]) * f)}`;
}
/** Width of a label in pixels, measured in the page's own font. */
function textMeasurer(size: number) {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return (text: string) => text.length * size * 0.56;
  ctx.font = `500 ${size}px ${getComputedStyle(document.body).fontFamily}`;
  return (text: string) => ctx.measureText(text).width;
}

const ease = (t: number) => 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 3);

export default function FanMap({ basemap, fanMap, candidates, stops, active, onActive, title, meta, status }: Props) {
  const { width: W, height: H, projection: p, step, dots } = basemap;
  const project = useMemo(() => (lat: number, lon: number) => [(lon - p.west) * p.k * p.scale + p.pad, (p.north - lat) * p.scale + p.pad] as const, [p]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [px, setPx] = useState(0); // rendered frame width in CSS pixels

  // heat at every dot, and how long after the strongest area each dot lights up
  const heat = useMemo(() => {
    const n = dots.length / 3;
    const value = new Float32Array(n);
    const delay = new Float32Array(n);
    if (!fanMap?.length) return { value, delay, ready: false };
    const cells = fanMap.map((c, i) => {
      const [x, y] = project(c.lat, c.lon);
      return { x, y, w: Math.pow(1 - i / fanMap.length, 1.3) };
    });
    const sigma = step * 1.9;
    const s2 = 2 * sigma * sigma;
    const reach2 = (3 * sigma) ** 2;
    let max = 0;
    for (let i = 0; i < n; i++) {
      const x = dots[i * 3];
      const y = dots[i * 3 + 1];
      let h = 0;
      for (const c of cells) {
        const d2 = (c.x - x) ** 2 + (c.y - y) ** 2;
        if (d2 < reach2) h += c.w * Math.exp(-d2 / s2);
      }
      value[i] = h;
      if (h > max) max = h;
    }
    const top = cells[0];
    let far = 1;
    for (let i = 0; i < n; i++) {
      value[i] = max ? Math.pow(value[i] / max, 0.55) : 0;
      delay[i] = Math.hypot(dots[i * 3] - top.x, dots[i * 3 + 1] - top.y);
      if (delay[i] > far) far = delay[i];
    }
    for (let i = 0; i < n; i++) delay[i] = (delay[i] / far) * 0.6;
    return { value, delay, ready: true };
  }, [fanMap, dots, step, project]);

  const clock = useRef({ base: 0, heat: 0 });

  // draw the dots (and the heat as it spreads) on the canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const now = performance.now();
    if (!clock.current.base) clock.current.base = reduce ? now - BASE_MS * 2 : now;
    if (heat.ready && !clock.current.heat) clock.current.heat = reduce ? now - HEAT_MS * 2 : now;

    let raf = 0;
    const draw = () => {
      const t = performance.now();
      const scale = canvas.width / W;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const baseT = (t - clock.current.base) / BASE_MS;
      const heatT = clock.current.heat ? (t - clock.current.heat) / HEAT_MS : 0;
      const n = dots.length / 3;
      const r0 = step * 0.27 * scale;

      for (let i = 0; i < n; i++) {
        const x = dots[i * 3];
        const weight = dots[i * 3 + 2];
        const appear = ease(baseT * 1.6 - (x / W) * 0.6);
        if (appear <= 0) continue;
        const h = heat.ready ? heat.value[i] * ease((heatT - heat.delay[i]) / 0.4) : 0;
        ctx.globalAlpha = appear * Math.min(1, 0.32 + weight * 0.12 + h * 0.9);
        ctx.fillStyle = h > 0.04 ? ramp(0.15 + h * 0.85) : ramp(weight * 0.05);
        ctx.beginPath();
        ctx.arc(x * scale, dots[i * 3 + 1] * scale, r0 * (0.85 + weight * 0.08 + h * 0.75), 0, Math.PI * 2);
        ctx.fill();
      }

      // soft glow over the hottest areas
      if (heat.ready && heatT > 0) {
        ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < n; i++) {
          const h = heat.value[i] * ease((heatT - heat.delay[i]) / 0.4);
          if (h < 0.55) continue;
          ctx.globalAlpha = (h - 0.55) * 0.22;
          ctx.fillStyle = "#ffb547";
          ctx.beginPath();
          ctx.arc(dots[i * 3] * scale, dots[i * 3 + 1] * scale, r0 * 4.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
      }
      ctx.globalAlpha = 1;

      const settled = baseT > 1.2 && (!heat.ready || heatT > 1.1);
      if (!settled) raf = requestAnimationFrame(draw);
    };

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      setPx(r.width);
      cancelAnimationFrame(raf);
      draw();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [heat, dots, step, W]);

  // markers and labels, placed in pixels so text stays crisp at any size
  const k = px / W || 0;
  const placed = useMemo(() => {
    if (!stops?.length || !k) return [];
    const measure = textMeasurer(px < 600 ? 10.5 : 11.5);
    type Box = { x: number; y: number; w: number; h: number };
    const h0 = 22;
    const boxes: Box[] = stops.map((s) => {
      const [x, y] = project(s.lat, s.lon);
      return { x: x * k - 12, y: y * k - 12, w: 24, h: 24 };
    });
    // how badly a label box collides with what's already placed (and the frame edges)
    const cost = (b: Box) => {
      let c = Math.max(0, -b.x) * h0 + Math.max(0, b.x + b.w - px) * h0;
      for (const o of boxes) {
        const ox = Math.min(b.x + b.w, o.x + o.w) - Math.max(b.x, o.x);
        const oy = Math.min(b.y + b.h, o.y + o.h) - Math.max(b.y, o.y);
        if (ox > 0 && oy > 0) c += ox * oy;
      }
      return c;
    };
    return stops.map((s) => {
      const [x, y] = project(s.lat, s.lon);
      const cx = x * k;
      const cy = y * k;
      const w = measure(s.name ?? s.label) + 16;
      const h = h0;
      const options = [
        { x: cx + 16, y: cy - h / 2 },
        { x: cx - 16 - w, y: cy - h / 2 },
        { x: cx + 14, y: cy - h - 4 },
        { x: cx + 14, y: cy + 4 },
        { x: cx - 14 - w, y: cy - h - 4 },
        { x: cx - 14 - w, y: cy + 4 },
        { x: cx - w / 2, y: cy - 16 - h },
        { x: cx - w / 2, y: cy + 16 },
      ];
      let pick = options[0];
      let best = Infinity;
      for (const o of options) {
        const c = cost({ ...o, w, h });
        if (c < best) [best, pick] = [c, o];
        if (c === 0) break;
      }
      boxes.push({ x: pick.x, y: pick.y, w, h });
      return { ...s, cx, cy, lx: pick.x - cx, ly: pick.y - cy };
    });
  }, [stops, k, px, project]);

  // the route, gently arched between stops
  const routePath = useMemo(() => {
    if (!stops || stops.length < 2) return "";
    const pts = stops.map((s) => project(s.lat, s.lon));
    let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      const bend = 0.16;
      d += ` Q${(mx - (y1 - y0) * bend).toFixed(1)} ${(my + (x1 - x0) * bend).toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
    }
    return d;
  }, [stops, project]);

  const chosen = new Set(stops?.map((s) => s.label));

  return (
    <figure className={styles.card} style={{ "--ar": `${W} / ${H}`, "--arn": W / H } as CSSProperties}>
      <header className={styles.head}>
        <span className={styles.title}>{title}</span>
        {meta && <span className={styles.meta}>{meta}</span>}
      </header>

      <div className={styles.wrap}>
        <div ref={frameRef} className={styles.frame} data-active={active ? "1" : "0"}>
          <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />

          <svg className={styles.overlay} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
            {candidates?.map((c, i) => {
              if (chosen.has(c.label)) return null;
              const [x, y] = project(c.lat, c.lon);
              return <circle key={c.label} className={styles.candidate} cx={x} cy={y} r={step * 0.9} style={{ "--i": i } as CSSProperties} />;
            })}
            {routePath && (
              <>
                <path key={`${routePath}-glow`} className={styles.routeGlow} d={routePath} pathLength={1} />
                <path key={routePath} className={styles.route} d={routePath} pathLength={1} />
              </>
            )}
          </svg>

          {placed.map((s, i) => {
            const on = active === s.label;
            return (
              <button
                key={s.label}
                type="button"
                className={styles.stop}
                data-on={on ? "1" : "0"}
                style={{ left: s.cx, top: s.cy, "--i": i } as CSSProperties}
                onPointerEnter={() => onActive?.(s.label)}
                onPointerLeave={() => onActive?.(undefined)}
                onFocus={() => onActive?.(s.label)}
                onBlur={() => onActive?.(undefined)}
                onClick={() => document.getElementById(`night-${s.order}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
                aria-label={`Stop ${s.order}: ${s.name ?? s.label}${s.rank ? `, fans ${s.rank}` : ""}`}
              >
                <span className={styles.pin}>{s.order}</span>
                <span className={styles.label} style={{ left: s.lx, top: s.ly }}>
                  {s.name ?? s.label}
                  {s.rank && <em>{s.rank}</em>}
                </span>
              </button>
            );
          })}

          {status && (
            <p className={styles.status} role="status">
              <span className={styles.spinner} aria-hidden="true" />
              {status}
            </p>
          )}
        </div>
      </div>

      <figcaption className={styles.foot}>
        <span className={styles.legend}>
          <span>Fewer fans</span>
          <i aria-hidden="true" />
          <span>Most fans</span>
        </span>
        <span className={styles.note}>Each dot is a populated area. The glow shows where the artist&apos;s fans concentrate.</span>
      </figcaption>
    </figure>
  );
}
