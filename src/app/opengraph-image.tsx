import { ImageResponse } from "next/og";

export const alt = "Fanmap: find where your fans actually are, then go play there.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// A field of dots that warms toward a few hot spots, like the fan map.
const SPOTS = [
  [0.79, 0.36, 1],
  [0.86, 0.3, 0.8],
  [0.62, 0.52, 0.55],
  [0.9, 0.62, 0.45],
];
const DOTS: { x: number; y: number; h: number }[] = [];
for (let y = 40; y < 600; y += 26) {
  for (let x = 640; x < 1180; x += 26) {
    const h = Math.max(...SPOTS.map(([sx, sy, w]) => w * Math.exp(-((x / 1200 - sx) ** 2 + (y / 630 - sy) ** 2) / 0.006)));
    DOTS.push({ x, y, h });
  }
}

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: "#0e0d0b", color: "#f2ede4", position: "relative" }}>
        {DOTS.map((d, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: d.x,
              top: d.y,
              width: 6 + d.h * 8,
              height: 6 + d.h * 8,
              borderRadius: 999,
              background: d.h > 0.15 ? `rgba(255, ${181 + Math.round(d.h * 60)}, ${71 + Math.round(d.h * 140)}, ${0.35 + d.h * 0.65})` : "#2a2621",
            }}
          />
        ))}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 72px", width: 720 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            <div style={{ width: 16, height: 30, borderRadius: 3, background: "#6a6155" }} />
            <div style={{ width: 16, height: 56, borderRadius: 3, background: "#ffb547" }} />
            <div style={{ width: 16, height: 40, borderRadius: 3, background: "#a39b8e" }} />
            <div style={{ marginLeft: 14, fontSize: 44, letterSpacing: -2 }}>fanmap</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 92, lineHeight: 0.98, letterSpacing: -4 }}>
            <span>Play where</span>
            <span style={{ color: "#ffb547" }}>your fans are.</span>
          </div>
          <div style={{ fontSize: 28, color: "#a39b8e", lineHeight: 1.35 }}>
            Tour routes, booking lists and briefs from where an artist&apos;s fans actually live.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
