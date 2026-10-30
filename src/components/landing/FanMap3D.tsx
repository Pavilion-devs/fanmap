"use client";

import { useEffect, useRef } from "react";
import { AI_PICKS, HOTSPOTS, LAKES, ROUTE, US_OUTLINE, type Hotspot } from "./fanmap-data";
import styles from "./FanMap3D.module.css";

// World units: 1 = one degree of latitude; longitude is squeezed by cos(~38°).
const LON0 = -96;
const LAT0 = 38.5;
const KX = 0.78;
const STEP = 0.56;
const TILE = 0.42;
const BASE_H = 0.14;
const MAX_H = 8.5;

const toX = (lon: number) => (lon - LON0) * KX;
const toZ = (lat: number) => -(lat - LAT0);

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const backOut = (t: number) => {
  const c = 1.4;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};
const rnd = (i: number) => {
  const s = Math.sin(i * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};

type Cell = { x: number; z: number; heat: number; base: number; h: number; xn: number };

function insideOutline(lon: number, lat: number) {
  let hit = false;
  for (let i = 0, j = US_OUTLINE.length - 1; i < US_OUTLINE.length; j = i++) {
    const [xi, yi] = US_OUTLINE[i];
    const [xj, yj] = US_OUTLINE[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function inLake(lon: number, lat: number) {
  return LAKES.some(([lo, la, rx, ry]) => ((lon - lo) / rx) ** 2 + ((lat - la) / ry) ** 2 < 1);
}

function heatAt(x: number, z: number) {
  let heat = 0;
  for (const h of HOTSPOTS) {
    const dx = x - toX(h.lon);
    const dz = z - toZ(h.lat);
    const d2 = dx * dx + dz * dz;
    heat = Math.max(heat, h.heat * Math.exp(-d2 / 1.62), h.heat * 0.26 * Math.exp(-d2 / 23));
  }
  return heat;
}

const heightFor = (heat: number) => MAX_H * Math.pow(heat, 1.75);

function buildCells(): Cell[] {
  const lons = US_OUTLINE.map((p) => p[0]);
  const lats = US_OUTLINE.map((p) => p[1]);
  const minX = toX(Math.min(...lons));
  const maxX = toX(Math.max(...lons));
  const minZ = toZ(Math.max(...lats));
  const maxZ = toZ(Math.min(...lats));
  const cells: Cell[] = [];
  let n = 0;
  for (let z = minZ; z <= maxZ; z += STEP) {
    for (let x = minX; x <= maxX; x += STEP) {
      n++;
      const lon = x / KX + LON0;
      const lat = LAT0 - z;
      if (!insideOutline(lon, lat) || inLake(lon, lat)) continue;
      const seed = rnd(n);
      const heat = Math.min(1, heatAt(x, z) + seed * 0.035);
      const base = BASE_H * (0.6 + seed * 0.9);
      cells.push({ x, z, heat, base, h: base + heightFor(heat), xn: (x - minX) / (maxX - minX) });
    }
  }
  return cells;
}

// Raw sRGB ramp: charcoal → amber → warm white. The pillar shader outputs it as-is.
const RAMP: [number, number, number][] = [
  [0.165, 0.149, 0.129],
  [1.0, 0.71, 0.278],
  [1.0, 0.945, 0.84],
];
function writeHeatColor(t: number, out: Float32Array, o: number) {
  const k = t < 0.55 ? t / 0.55 : (t - 0.55) / 0.45;
  const a = t < 0.55 ? RAMP[0] : RAMP[1];
  const b = t < 0.55 ? RAMP[1] : RAMP[2];
  const e = t < 0.55 ? Math.pow(clamp01(k), 1.3) : clamp01(k);
  out[o] = a[0] + (b[0] - a[0]) * e;
  out[o + 1] = a[1] + (b[1] - a[1]) * e;
  out[o + 2] = a[2] + (b[2] - a[2]) * e;
}

const PILLAR_VERT = /* glsl */ `
  varying vec3 vColor;
  varying vec3 vNormal;
  varying float vH;
  void main() {
    vColor = instanceColor;
    vNormal = normal;
    vH = position.y;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const PILLAR_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying vec3 vNormal;
  varying float vH;
  void main() {
    vec3 L = normalize(vec3(-0.5, 0.0, 0.86));
    float top = step(0.5, vNormal.y);
    float glow = clamp((vColor.r + vColor.g + vColor.b - 0.9) / 1.6, 0.0, 1.0);
    float side = 0.4 + 0.3 * max(0.0, dot(vNormal, L));
    side = mix(side, 0.92, glow * 0.45);
    float shade = mix(side * mix(0.55, 1.0, vH), 1.0, top);
    gl_FragColor = vec4(vColor * shade, 1.0);
  }
`;

type Overlay = { el: HTMLElement; pos: [number, number, number]; show: number; strike?: number };

export default function FanMap3D({ className }: { className?: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const overlay = overlayRef.current;
    const tip = tipRef.current;
    if (!root || !overlay || !tip) return;

    let disposed = false;
    let cleanup = () => {};

    (async () => {
      const THREE = await import("three");
      if (disposed) return;

      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
      } catch {
        root.dataset.fallback = "1";
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setClearColor(0x000000, 0);
      root.prepend(renderer.domElement);
      renderer.domElement.className = styles.canvas;

      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
      const disposables: { dispose: () => void }[] = [];
      const keep = <T extends { dispose: () => void }>(d: T) => (disposables.push(d), d);

      // Plinth: the US outline as a dark slab the pillars stand on.
      const shape = new THREE.Shape(US_OUTLINE.map(([lon, lat]) => new THREE.Vector2(toX(lon), lat - LAT0)));
      const slabGeo = keep(new THREE.ExtrudeGeometry(shape, { depth: 0.7, bevelEnabled: false }));
      slabGeo.rotateX(-Math.PI / 2);
      slabGeo.translate(0, -0.72, 0);
      const slab = new THREE.Mesh(slabGeo, [
        keep(new THREE.MeshLambertMaterial({ color: 0x141210 })),
        keep(new THREE.MeshLambertMaterial({ color: 0x1d1a16 })),
      ]);
      scene.add(slab);
      const edges = new THREE.LineSegments(
        keep(new THREE.EdgesGeometry(slabGeo, 30)),
        keep(new THREE.LineBasicMaterial({ color: 0x3a342d, transparent: true, opacity: 0.8 })),
      );
      scene.add(edges);
      scene.add(new THREE.AmbientLight(0xffffff, 1.6));
      const sun = new THREE.DirectionalLight(0xffffff, 1.4);
      sun.position.set(-20, 30, 30);
      scene.add(sun);

      // Pillars: one instanced box per map cell, height = fan heat.
      const cells = buildCells();
      const count = cells.length;
      const boxGeo = keep(new THREE.BoxGeometry(1, 1, 1));
      boxGeo.translate(0, 0.5, 0);
      const pillarMat = keep(
        new THREE.ShaderMaterial({ vertexShader: PILLAR_VERT, fragmentShader: PILLAR_FRAG }),
      );
      const pillars = new THREE.InstancedMesh(boxGeo, pillarMat, count);
      pillars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const colors = new Float32Array(count * 3);
      pillars.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
      pillars.instanceColor.setUsage(THREE.DynamicDrawUsage);
      const mats = pillars.instanceMatrix.array as Float32Array;
      for (let i = 0; i < count; i++) {
        const o = i * 16;
        mats.fill(0, o, o + 16);
        mats[o] = TILE;
        mats[o + 5] = cells[i].h;
        mats[o + 10] = TILE;
        mats[o + 12] = cells[i].x;
        mats[o + 14] = cells[i].z;
        mats[o + 15] = 1;
      }
      pillars.computeBoundingSphere();
      if (pillars.boundingSphere) pillars.boundingSphere.radius *= 1.25;
      pillars.frustumCulled = false;
      scene.add(pillars);

      const topAt = (lon: number, lat: number) => {
        const x = toX(lon);
        const z = toZ(lat);
        let best = 0;
        for (const c of cells) {
          const d2 = (c.x - x) ** 2 + (c.z - z) ** 2;
          if (d2 < 0.5 && c.h > best) best = c.h;
        }
        return best;
      };

      // Soft glow above and around the hottest places.
      const glowCanvas = document.createElement("canvas");
      glowCanvas.width = glowCanvas.height = 128;
      const g = glowCanvas.getContext("2d")!;
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.25, "rgba(255,255,255,0.45)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      const glowTex = keep(new THREE.CanvasTexture(glowCanvas));
      glowTex.colorSpace = THREE.SRGBColorSpace;

      const glows: { sprite: InstanceType<typeof THREE.Sprite>; mat: InstanceType<typeof THREE.SpriteMaterial>; heat: number }[] = [];
      for (const h of HOTSPOTS.filter((s) => s.heat >= 0.55)) {
        const mat = keep(
          new THREE.SpriteMaterial({
            map: glowTex,
            color: 0xffb547,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false,
            transparent: true,
            opacity: 0,
          }),
        );
        const sprite = new THREE.Sprite(mat);
        sprite.position.set(toX(h.lon), topAt(h.lon, h.lat) + 0.4, toZ(h.lat));
        sprite.scale.setScalar(4.2 * h.heat);
        sprite.renderOrder = 10;
        scene.add(sprite);
        glows.push({ sprite, mat, heat: h.heat });
      }
      const floorGlowMat = keep(
        new THREE.MeshBasicMaterial({
          map: glowTex,
          color: 0xff9a2e,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
          opacity: 0,
        }),
      );
      const floorGeo = keep(new THREE.PlaneGeometry(1, 1));
      for (const h of HOTSPOTS.filter((s) => s.heat >= 0.7)) {
        const m = new THREE.Mesh(floorGeo, floorGlowMat);
        m.rotation.x = -Math.PI / 2;
        m.position.set(toX(h.lon), 0.02, toZ(h.lat));
        m.scale.setScalar(9 * h.heat);
        scene.add(m);
      }

      // What a generic AI answer picks: slate rings that get struck out.
      const ringGeo = keep(new THREE.RingGeometry(0.62, 0.78, 48));
      ringGeo.rotateX(-Math.PI / 2);
      const rings = AI_PICKS.map((p) => {
        const mat = keep(
          new THREE.MeshBasicMaterial({ color: 0x8da2c4, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
        );
        const mesh = new THREE.Mesh(ringGeo, mat);
        const y = topAt(p.lon, p.lat) + 0.25;
        mesh.position.set(toX(p.lon), y, toZ(p.lat));
        mesh.renderOrder = 5;
        scene.add(mesh);
        return { mesh, mat, y };
      });

      // The route: arcs that hop between the stops, lifted off the map.
      const routeGroup = new THREE.Group();
      scene.add(routeGroup);
      const stops = ROUTE.map((r) => new THREE.Vector3(toX(r.lon), topAt(r.lon, r.lat) + 0.35, toZ(r.lat)));
      const path = new THREE.CurvePath<InstanceType<typeof THREE.Vector3>>();
      for (let i = 1; i < stops.length; i++) {
        const a = stops[i - 1];
        const b = stops[i];
        const d = a.distanceTo(b);
        const mid = a.clone().add(b).multiplyScalar(0.5);
        mid.y = Math.max(a.y, b.y) + 0.8 + d * 0.22;
        path.add(new THREE.QuadraticBezierCurve3(a, mid, b));
      }
      const tubularSegments = 600;
      const radial = 6;
      const tubeGeo = keep(new THREE.TubeGeometry(path, tubularSegments, 0.06, radial, false));
      const tubeIndexCount = tubeGeo.index ? tubeGeo.index.count : 0;
      tubeGeo.setDrawRange(0, 0);
      const tube = new THREE.Mesh(tubeGeo, keep(new THREE.MeshBasicMaterial({ color: 0xffd08a })));
      routeGroup.add(tube);

      const stopGeo = keep(new THREE.SphereGeometry(0.17, 16, 12));
      const stopMat = keep(new THREE.MeshBasicMaterial({ color: 0xfff1d6 }));
      const stopMeshes = stops.map((p) => {
        const m = new THREE.Mesh(stopGeo, stopMat);
        m.position.copy(p);
        m.scale.setScalar(0);
        routeGroup.add(m);
        return m;
      });
      // Arc length fraction at each stop, so stops pop as the line reaches them.
      const lengths = path.getCurveLengths();
      const total = lengths[lengths.length - 1] || 1;
      const stopAt = [0, ...lengths.map((l) => l / total)];

      const dropMat = keep(
        new THREE.LineDashedMaterial({ color: 0xffb547, dashSize: 0.18, gapSize: 0.14, transparent: true, opacity: 0.55 }),
      );
      const drops = stops.map((p) => {
        const geo = keep(new THREE.BufferGeometry().setFromPoints([p.clone(), p.clone()]));
        const line = new THREE.Line(geo, dropMat);
        line.visible = false;
        scene.add(line);
        return { geo, line, base: p };
      });

      // HTML overlays pinned to points in the scene.
      const overlays: Overlay[] = [];
      const addPin = (pos: [number, number, number], title: string, sub: string, show: number, secondary = false) => {
        const el = document.createElement("div");
        el.className = `${styles.pin} ${secondary ? styles.pinSecondary : ""}`;
        el.innerHTML = `<span class="${styles.stem}"></span><span class="${styles.dot}"></span><span class="${styles.card}"><b>${title}</b><span>${sub}</span></span>`;
        overlay.appendChild(el);
        overlays.push({ el, pos, show });
      };
      const addAiTag = (p: Hotspot, y: number, show: number, strike: number) => {
        const el = document.createElement("div");
        el.className = styles.aiTag;
        el.innerHTML = `<span>AI pick · ${p.name}</span>`;
        overlay.appendChild(el);
        overlays.push({ el, pos: [toX(p.lon), y, toZ(p.lat)], show, strike });
      };

      const north = HOTSPOTS[0];
      addPin([toX(north.lon), topAt(north.lon, north.lat), toZ(north.lat)], "Northampton, MA", "Top 0.1% for Phoebe Bridgers fans", 5.2);
      const portland = HOTSPOTS[1];
      addPin([toX(portland.lon), topAt(portland.lon, portland.lat), toZ(portland.lat)], "Portland, OR", "Wonder Ballroom · night 2", 5.6, true);
      AI_PICKS.forEach((p, k) => addAiTag(p, rings[k].y, 2.7 + k * 0.12, 3.5 + k * 0.1));

      // Camera: orthographic, orbiting a fixed target. Users can turn and tilt it.
      const THETA0 = 0.2;
      const PHI0 = 0.62;
      let theta = THETA0;
      let phi = reduce ? PHI0 : 1.05;
      let thetaTarget = THETA0;
      let phiTarget = PHI0;
      let pointerX = 0;
      const target = new THREE.Vector3(0.5, 0, 0.6);
      const placeCamera = () => {
        camera.position.set(
          target.x + 120 * Math.cos(phi) * Math.sin(theta),
          target.y + 120 * Math.sin(phi),
          target.z + 120 * Math.cos(phi) * Math.cos(theta),
        );
        camera.lookAt(target);
      };

      let width = 1;
      let height = 1;
      const fit = () => {
        width = root.clientWidth || 1;
        height = root.clientHeight || 1;
        renderer.setSize(width, height, false);
        const aspect = width / height;
        // Size the frustum from the map's footprint at the resting angle.
        const keepTheta = theta;
        const keepPhi = phi;
        theta = THETA0;
        phi = PHI0;
        placeCamera();
        camera.updateMatrixWorld();
        const inv = camera.matrixWorldInverse;
        let minVx = Infinity, maxVx = -Infinity, minVy = Infinity, maxVy = -Infinity;
        const v = new THREE.Vector3();
        for (const [lon, lat] of US_OUTLINE) {
          for (const y of [-0.7, 6]) {
            v.set(toX(lon), y, toZ(lat)).applyMatrix4(inv);
            minVx = Math.min(minVx, v.x);
            maxVx = Math.max(maxVx, v.x);
            minVy = Math.min(minVy, v.y);
            maxVy = Math.max(maxVy, v.y);
          }
        }
        const w = maxVx - minVx;
        const h = maxVy - minVy;
        const narrow = width < 700;
        const pad = narrow ? 1.02 : 1.1;
        const viewH = Math.max(h * pad * (narrow ? 1.05 : 1.18), (w * pad) / aspect);
        const cx = (minVx + maxVx) / 2;
        const cy = (minVy + maxVy) / 2 + viewH * (narrow ? 0.03 : 0.1);
        camera.left = cx - (viewH * aspect) / 2;
        camera.right = cx + (viewH * aspect) / 2;
        camera.top = cy + viewH / 2;
        camera.bottom = cy - viewH / 2;
        camera.updateProjectionMatrix();
        theta = keepTheta;
        phi = keepPhi;
      };
      fit();
      const ro = new ResizeObserver(fit);
      ro.observe(root);

      // Interaction: drag to turn, hover to lift, tap to send a ripple.
      const raycaster = new THREE.Raycaster();
      const ndc = new THREE.Vector2();
      let pointerInside = false;
      let pointerDirty = false;
      let hoverIdx = -1;
      let hoverAmt = 0;
      let hoverX = 0;
      let hoverZ = 0;
      let dragging = false;
      let dragMoved = false;
      let releasedAt = 0;
      let lastPX = 0;
      let lastPY = 0;
      let tipX = 0;
      let tipY = 0;
      const ripples: { x: number; z: number; t0: number }[] = [];
      const canvas = renderer.domElement;

      const onMove = (e: PointerEvent) => {
        const r = canvas.getBoundingClientRect();
        tipX = e.clientX - r.left;
        tipY = e.clientY - r.top;
        ndc.set((tipX / r.width) * 2 - 1, -(tipY / r.height) * 2 + 1);
        pointerX = ndc.x;
        pointerInside = true;
        pointerDirty = true;
        if (dragging) {
          const dx = e.clientX - lastPX;
          const dy = e.clientY - lastPY;
          if (Math.abs(dx) + Math.abs(dy) > 2) dragMoved = true;
          thetaTarget = Math.max(THETA0 - 1.1, Math.min(THETA0 + 1.1, thetaTarget - dx * 0.0038));
          phiTarget = Math.max(0.32, Math.min(1.15, phiTarget + dy * 0.0028));
          lastPX = e.clientX;
          lastPY = e.clientY;
        }
      };
      const onDown = (e: PointerEvent) => {
        dragging = true;
        dragMoved = false;
        lastPX = e.clientX;
        lastPY = e.clientY;
        canvas.setPointerCapture(e.pointerId);
        root.dataset.dragging = "1";
      };
      const onUp = (e: PointerEvent) => {
        if (dragging && !dragMoved && hoverIdx >= 0) {
          ripples.push({ x: cells[hoverIdx].x, z: cells[hoverIdx].z, t0: performance.now() / 1000 });
          if (ripples.length > 4) ripples.shift();
        }
        dragging = false;
        releasedAt = performance.now() / 1000;
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
        delete root.dataset.dragging;
      };
      const onLeave = () => {
        pointerInside = false;
        pointerX = 0;
        hoverIdx = -1;
        tip.dataset.on = "0";
      };
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerdown", onDown);
      canvas.addEventListener("pointerup", onUp);
      canvas.addEventListener("pointercancel", onUp);
      canvas.addEventListener("pointerleave", onLeave);

      const nearestName = (x: number, z: number) => {
        let best: Hotspot | null = null;
        let bestD = 2.2;
        for (const h of HOTSPOTS) {
          const d = Math.hypot(toX(h.lon) - x, toZ(h.lat) - z);
          if (d < bestD) {
            bestD = d;
            best = h;
          }
        }
        return best;
      };
      const showTip = (i: number) => {
        const c = cells[i];
        const near = nearestName(c.x, c.z);
        const lon = c.x / KX + LON0;
        const lat = LAT0 - c.z;
        const heat = Math.round(c.heat * 100);
        const title = near ? near.name : `${lat.toFixed(1)}°N ${Math.abs(lon).toFixed(1)}°W`;
        const rank = near?.rank ? ` · ${near.rank}` : "";
        tip.innerHTML = `<b>${title}</b><span>Fan heat ${heat}/100${rank}</span>`;
        tip.dataset.on = "1";
      };

      let visible = true;
      const io = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting), { threshold: 0 });
      io.observe(root);

      const start = performance.now() / 1000;
      let last = start;
      const v3 = new THREE.Vector3();
      let raf = 0;

      const frame = () => {
        raf = requestAnimationFrame(frame);
        if (!visible) return;
        const now = performance.now() / 1000;
        const dt = Math.min(0.05, now - last);
        last = now;
        const T = reduce ? 30 : now - start;

        // Camera settles from a top-down view into the isometric angle, then drifts.
        const settle = reduce ? 1 : easeInOut(clamp01((T - 0.2) / 2.4));
        const drift = reduce ? 0 : Math.sin(T * 0.16) * 0.08;
        const k = Math.min(1, dt * 3.5);
        // A couple of seconds after a drag, ease back to the resting composition.
        if (!dragging && now - releasedAt > 2.5) {
          const back = Math.min(1, dt * 0.6);
          thetaTarget += (THETA0 - thetaTarget) * back;
          phiTarget += (PHI0 - phiTarget) * back;
        }
        theta += (thetaTarget + drift + pointerX * 0.06 - theta) * k;
        const phiGoal = settle < 1 ? 1.05 + (phiTarget - 1.05) * settle : phiTarget;
        phi += (phiGoal - phi) * (settle < 1 ? 1 : k);
        placeCamera();

        hoverAmt += ((pointerInside && hoverIdx >= 0 && !dragging ? 1 : 0) - hoverAmt) * Math.min(1, dt * 7);
        if (hoverIdx >= 0) {
          hoverX += (cells[hoverIdx].x - hoverX) * Math.min(1, dt * 12);
          hoverZ += (cells[hoverIdx].z - hoverZ) * Math.min(1, dt * 12);
        }
        while (ripples.length && now - ripples[0].t0 > 3.2) ripples.shift();

        for (let i = 0; i < count; i++) {
          const c = cells[i];
          const appear = reduce ? 1 : easeOut(clamp01((T - 0.15 - c.xn * 0.9) / 0.5));
          const grow = reduce ? 1 : backOut(clamp01((T - 1.2 - c.xn * 0.8 - (1 - c.heat) * 0.25) / 0.9));
          let lift = 0;
          if (hoverAmt > 0.01) {
            const d2 = (c.x - hoverX) ** 2 + (c.z - hoverZ) ** 2;
            if (d2 < 9) lift += hoverAmt * 1.4 * Math.exp(-d2 / 1.1);
          }
          for (const r of ripples) {
            const age = now - r.t0;
            const d = Math.hypot(c.x - r.x, c.z - r.z);
            const front = d - age * 9;
            if (front > -3 && front < 3) lift += 1.3 * Math.exp(-(front * front) / 0.7) * Math.exp(-age * 1.1);
          }
          const h = (c.base + (c.h - c.base) * grow) * appear + lift;
          const o = i * 16;
          mats[o] = TILE * appear;
          mats[o + 5] = Math.max(0.001, h);
          mats[o + 10] = TILE * appear;
          writeHeatColor(Math.min(1, c.heat * (0.35 + 0.65 * grow) + lift * 0.22), colors, i * 3);
        }
        pillars.instanceMatrix.needsUpdate = true;
        pillars.instanceColor!.needsUpdate = true;

        const glowIn = reduce ? 1 : clamp01((T - 2.1) / 1.2);
        const pulse = reduce ? 1 : 0.85 + 0.15 * Math.sin(T * 1.6);
        for (const gl of glows) gl.mat.opacity = glowIn * 0.55 * gl.heat * pulse;
        floorGlowMat.opacity = glowIn * 0.28;

        rings.forEach((r, k2) => {
          const p = reduce ? 1 : easeOut(clamp01((T - 2.6 - k2 * 0.12) / 0.45));
          r.mat.opacity = p * 0.9;
          r.mesh.scale.setScalar(1 + (1 - p) * 1.6);
        });

        const draw = reduce ? 1 : easeInOut(clamp01((T - 3.7) / 2.0));
        tubeGeo.setDrawRange(0, Math.floor((draw * tubeIndexCount) / (radial * 6)) * radial * 6);
        stopMeshes.forEach((m, k2) => {
          m.scale.setScalar(draw <= 0 ? 0 : easeOut(clamp01((draw - stopAt[k2] + 0.07) * 14)));
        });

        // After the route lands it floats up off the map like an exploded layer.
        const floatT = reduce ? 0 : Math.max(0, T - 6.2);
        const rise = reduce ? 1.2 : (1 - Math.cos(floatT * 0.7)) * 1.1;
        routeGroup.position.y = rise;
        drops.forEach((d) => {
          d.line.visible = draw >= 1 && rise > 0.05;
          if (!d.line.visible) return;
          const pos = d.geo.attributes.position as InstanceType<typeof THREE.BufferAttribute>;
          pos.setXYZ(0, d.base.x, d.base.y, d.base.z);
          pos.setXYZ(1, d.base.x, d.base.y + rise, d.base.z);
          pos.needsUpdate = true;
          d.line.computeLineDistances();
        });

        // Hover picking, once the intro has settled.
        if (pointerDirty && T > 3 && !dragging) {
          pointerDirty = false;
          raycaster.setFromCamera(ndc, camera);
          const hit = raycaster.intersectObject(pillars, false)[0];
          const idx = hit?.instanceId ?? -1;
          if (idx !== hoverIdx) {
            hoverIdx = idx;
            if (idx >= 0) showTip(idx);
            else tip.dataset.on = "0";
          }
        }
        if (hoverIdx >= 0) tip.style.transform = `translate3d(${tipX + 16}px, ${tipY - 12}px, 0)`;

        for (const ov of overlays) {
          const on = T >= ov.show;
          if ((ov.el.dataset.on === "1") !== on) ov.el.dataset.on = on ? "1" : "0";
          if (ov.strike !== undefined) {
            const struck = T >= ov.strike;
            if ((ov.el.dataset.struck === "1") !== struck) ov.el.dataset.struck = struck ? "1" : "0";
          }
          if (!on) continue;
          v3.set(ov.pos[0], ov.pos[1], ov.pos[2]).project(camera);
          const sx = ((v3.x + 1) / 2) * width;
          const sy = ((1 - v3.y) / 2) * height;
          ov.el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0)`;
          const side = sx > width * (ov.strike === undefined ? 0.7 : 0.8) ? "left" : "right";
          if (ov.el.dataset.side !== side) ov.el.dataset.side = side;
        }

        renderer.render(scene, camera);
      };
      raf = requestAnimationFrame(frame);
      root.dataset.ready = "1";

      cleanup = () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        io.disconnect();
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("pointercancel", onUp);
        canvas.removeEventListener("pointerleave", onLeave);
        overlays.forEach((o) => o.el.remove());
        disposables.forEach((d) => d.dispose());
        renderer.dispose();
        canvas.remove();
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  return (
    <div ref={rootRef} className={`${styles.root} ${className ?? ""}`}>
      <div ref={overlayRef} className={styles.overlay} aria-hidden="true" />
      <div ref={tipRef} className={styles.tip} data-on="0" aria-hidden="true" />
    </div>
  );
}
