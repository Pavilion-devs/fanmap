"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { Basemap } from "@/lib/geo/basemap";
import { isActiveAct } from "@/lib/engine/util";
import { EXAMPLES } from "@/lib/examples";
import type { ArtistPlan, ArtistRef, Audience, BookingPick, BrandMatch, Comparison, DoubleBill, FanArea, LocalOpener, PlanInput, RouteStop, TourCity, VenuePlan } from "@/lib/types";
import { Logo } from "@/components/landing/Nav";
import AgentLog from "./AgentLog";
import Brief from "./Brief";
import Compare from "./Compare";
import FanMap, { type MapPoint, type MapStop } from "./FanMap";
import { compact, fmt, nightsOf, numberWord, shortLabel } from "./format";
import Insights from "./Insights";
import Nights from "./Nights";
import { useElapsed, usePlanStream, type StreamError } from "./usePlanStream";
import VenueBoard, { DoubleBills, LocalScene } from "./VenueBoard";
import styles from "./PlanView.module.css";

interface Props {
  input: PlanInput;
  basemap: Basemap | null;
  regionName: string;
  sharePath: string;
}

export default function PlanView({ input, basemap, regionName, sharePath }: Props) {
  const stream = usePlanStream(input);
  const elapsed = useElapsed(stream.startedAt, stream.finishedAt);
  const running = stream.status === "running";
  const done = stream.status === "done";
  const [hover, setHover] = useState<string>();
  const [inView, setInView] = useState<string>();
  const onInView = useCallback((label: string) => setInView(label), []);
  const [copied, setCopied] = useState(false);

  // the step the agent is on right now, for the status line on the map
  const current = [...stream.log].reverse().find((l) => l.kind === "step" && l.status === "running");
  const status = running ? (current?.kind === "step" ? `${current.label}…` : "Starting the agent…") : undefined;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(new URL(sharePath, window.location.origin).toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link:", new URL(sharePath, window.location.origin).toString());
    }
  };

  const name =
    input.mode === "artist"
      ? ((stream.partial.artist as ArtistRef | undefined)?.name ?? input.artist)
      : ((stream.partial.venue as VenuePlan["venue"] | undefined)?.name ?? input.venue.split(",")[0]);

  return (
    <div className={styles.page}>

      <header className={styles.bar} data-noprint>
        <Logo />
        <p className={styles.crumb}>
          <Link href={input.mode === "venue" ? "/plan?mode=venue" : "/plan"}>{input.mode === "artist" ? "Tour plan" : "Booking plan"}</Link>
          <span aria-hidden="true">/</span>
          <span>{name}</span>
        </p>
        <div className={styles.barActions}>
          {running && (
            <span className={styles.live}>
              <i aria-hidden="true" /> Planning
            </span>
          )}
          {done && (
            <>
              <button type="button" className={styles.ghostBtn} onClick={copyLink}>
                {copied ? "Link copied" : "Copy link"}
              </button>
              <a href="#brief" className={styles.solidBtn}>
                Open the brief
              </a>
            </>
          )}
          {!running && !done && (
            <Link href={input.mode === "venue" ? "/plan?mode=venue" : "/plan"} className={styles.ghostBtn}>
              New plan
            </Link>
          )}
        </div>
      </header>

      <main className={styles.main}>
        {input.mode === "artist" ? (
          <ArtistView stream={stream} input={input} basemap={basemap} regionName={regionName} elapsed={elapsed} status={status} active={hover ?? inView} setHover={setHover} onInView={onInView} sharePath={sharePath} />
        ) : (
          <VenueView stream={stream} input={input} elapsed={elapsed} status={status} sharePath={sharePath} />
        )}
      </main>

      <footer className={styles.foot} data-noprint>
        <Logo />
        <p>Fan scores show where taste is concentrated, not guaranteed ticket sales.</p>
        <Link href={input.mode === "venue" ? "/plan?mode=venue" : "/plan"} className={styles.ghostBtn}>
          Plan another
        </Link>
      </footer>
    </div>
  );
}

type Stream = ReturnType<typeof usePlanStream>;

// ---------------- artist mode ----------------

function ArtistView({
  stream,
  input,
  basemap,
  regionName,
  elapsed,
  status,
  active,
  setHover,
  onInView,
  sharePath,
}: {
  stream: Stream;
  input: Extract<PlanInput, { mode: "artist" }>;
  basemap: Basemap | null;
  regionName: string;
  elapsed: number;
  status?: string;
  active?: string;
  setHover: (l: string | undefined) => void;
  onInView: (l: string) => void;
  sharePath: string;
}) {
  const plan = stream.plan?.mode === "artist" ? stream.plan : undefined;
  const p = stream.partial;
  const artist = plan?.artist ?? (p.artist as ArtistRef | undefined);
  const fanMap = plan?.fanMap ?? (p.fanMap as FanArea[] | undefined);
  const route = plan?.route ?? (p.route as RouteStop[] | undefined);
  const audience = plan?.audience ?? (p.audience as Audience | undefined);
  const openers = (plan?.openers ?? (p.openers as ArtistPlan["openers"] | undefined))?.filter(isActiveAct);
  const brands = plan?.brands ?? (p.brands as BrandMatch[] | undefined) ?? [];
  const comparison = plan?.comparison ?? (p.comparison as Comparison | undefined);

  const candidates = useMemo<MapPoint[] | undefined>(() => {
    const c = (p.candidates as MapPoint[] | undefined) ?? (p.cities as TourCity[] | undefined)?.map((x) => ({ label: x.place.label, lat: x.place.lat, lon: x.place.lon }));
    return c ?? plan?.cities.map((x) => ({ label: x.place.label, lat: x.place.lat, lon: x.place.lon }));
  }, [p.candidates, p.cities, plan]);

  const stops = useMemo<MapStop[] | undefined>(() => {
    if (!route?.length) return undefined;
    const where = new Map<string, MapPoint>();
    candidates?.forEach((c) => where.set(c.label, c));
    plan?.cities.forEach((c) => where.set(c.place.label, { label: c.place.label, lat: c.place.lat, lon: c.place.lon }));
    const rank = new Map(plan?.cities.map((c) => [c.place.label, c.stats.topShare]));
    return route.flatMap((r) => {
      const at = where.get(r.cityLabel);
      return at ? [{ ...at, order: r.order, rank: rank.get(r.cityLabel), name: shortLabel(r.cityLabel, regionName) }] : [];
    });
  }, [route, candidates, plan, regionName]);

  const nights = plan ? nightsOf(plan) : [];
  const shows = plan ? nights.length : (input.shows ?? 10);
  const days = route?.length ? (route.at(-1)!.day ?? 0) + 1 : undefined;
  const km = route?.reduce((n, r) => n + r.km, 0);
  const mapStep = stream.log.find((l) => l.kind === "step" && l.tool === "map_fans");
  const areas = mapStep?.kind === "step" ? mapStep.detail?.match(/([\d,]+) areas/)?.[1] : undefined;

  const chips = [regionName, `${input.shows ?? 10} shows`, input.startCity && `From ${input.startCity}`, input.venueSize && input.venueSize !== "any" && `${input.venueSize} rooms`, input.notes && `“${input.notes}”`].filter(Boolean) as string[];

  return (
    <>
      <Header
        kicker={`Tour plan · ${regionName}`}
        name={artist?.name ?? input.artist}
        em={`${numberWord(shows)} nights.`}
        headline={plan?.headline}
        running={stream.status === "running"}
        chips={chips}
        meta={
          artist && (
            <>
              {artist.image && (
                <span className={styles.avatar}>
                  <Image src={artist.image} alt="" fill sizes="36px" />
                </span>
              )}
              <span>{artist.genres.slice(0, 3).join(" · ")}</span>
              {artist.listeners ? <span>{compact(artist.listeners)} listeners</span> : null}
            </>
          )
        }
        stats={
          plan && [
            ["Nights", String(nights.length)],
            ["Days", days ? String(days) : "–"],
            ["Driving", km ? `${fmt(km)} km` : "–"],
            ["Fan areas read", areas ?? "–"],
          ]
        }
        notices={stream.notices}
      />

      {stream.status === "error" || stream.status === "cancelled" ? (
        <Problem error={stream.error} cancelled={stream.status === "cancelled"} onRetry={stream.retry} mode="artist" sharePath={sharePath} />
      ) : (
        <div className={styles.stage} data-done={plan ? "1" : "0"} data-noprint>
          <div className={styles.left}>
            <AgentLog log={stream.log} running={stream.status === "running"} elapsed={elapsed} run={plan?.run} onCancel={stream.cancel} />
            {plan && nights.length > 0 && (
              <section className={styles.block} aria-labelledby="nights-title">
                <SectionHead id="nights-title" kicker="The route" title="Night by night" note="Hover a night to find it on the map." />
                <Nights nights={nights} country={regionName} active={active} onHover={setHover} onInView={onInView} />
              </section>
            )}
          </div>
          <div className={styles.right} data-fit="1">
            {basemap ? (
              <FanMap
                basemap={basemap}
                fanMap={fanMap}
                candidates={candidates}
                stops={stops}
                active={active}
                onActive={setHover}
                title={`Fan map · ${regionName}`}
                meta={areas ? `${areas} areas read` : undefined}
                status={status}
              />
            ) : (
              <div className={styles.noMap}>No map for this country yet.</div>
            )}
          </div>
        </div>
      )}

      {plan && (
        <div className={styles.after}>
          {comparison && <Compare comparison={comparison} unit="cities" />}
          {(audience || openers?.length || brands.length > 0) && (
            <section className={styles.wide} aria-labelledby="insights-title" data-noprint>
              <SectionHead id="insights-title" kicker="Around the shows" title="The crowd, the support, the sponsors" />
              <Insights audience={audience} acts={openers} actsTitle="Support acts" actsNote="Share the same fans" brands={brands} />
            </section>
          )}
          {plan.brief && <Brief plan={plan} sharePath={sharePath} />}
        </div>
      )}
    </>
  );
}

// ---------------- venue mode ----------------

function VenueView({ stream, input, elapsed, status, sharePath }: { stream: Stream; input: Extract<PlanInput, { mode: "venue" }>; elapsed: number; status?: string; sharePath: string }) {
  const plan = stream.plan?.mode === "venue" ? stream.plan : undefined;
  const p = stream.partial;
  const venue = plan?.venue ?? (p.venue as VenuePlan["venue"] | undefined);
  // plans saved before late artists were filtered out still list them, so drop them here too
  const picks = (plan?.picks ?? (p.picks as BookingPick[] | undefined))?.filter((x) => isActiveAct(x.artist));
  const locals = (plan?.localOpeners ?? (p.localOpeners as LocalOpener[] | undefined))?.filter(isActiveAct);
  const bills = (plan?.doubleBills ?? (p.doubleBills as DoubleBill[] | undefined))?.filter((b) => isActiveAct(b.headliner) && isActiveAct(b.support));
  const crowd = plan?.crowd ?? (p.crowd as Audience | undefined);
  const brands = plan?.brands ?? (p.brands as BrandMatch[] | undefined) ?? [];
  const comparison = plan?.comparison ?? (p.comparison as Comparison | undefined);
  const [venueName, ...rest] = input.venue.split(",");
  const city = venue?.place.city ?? rest.join(",").trim();

  const chips = [input.capacity && `${fmt(input.capacity)} capacity`, ...(input.genres ?? []), input.notes && `“${input.notes}”`].filter(Boolean) as string[];

  return (
    <>
      <Header
        kicker={`Booking plan · ${venue?.place.label ?? city}`}
        name={venue?.name ?? venueName.trim()}
        em={city ? `${city}.` : "the room."}
        headline={plan?.headline}
        running={stream.status === "running"}
        chips={chips}
        meta={
          venue && (
            <>
              {venue.image && (
                <span className={styles.avatar}>
                  <Image src={venue.image} alt="" fill sizes="36px" />
                </span>
              )}
              {venue.category && <span>{venue.category}</span>}
              {venue.address && <span>{venue.address}</span>}
            </>
          )
        }
        stats={
          plan && [
            ["Acts matched", String(picks?.length ?? 0)],
            ["Local acts", String((picks?.filter((x) => x.confirmedLocal).length ?? 0) + (locals?.length ?? 0))],
            ["Double bills", String(bills?.length ?? 0)],
            ["Act size", plan.sizeBand.replace(/\s*\(.*\)/, "").replace(/^\w/, (c) => c.toUpperCase())],
          ]
        }
        notices={stream.notices}
      />

      {stream.status === "error" || stream.status === "cancelled" ? (
        <Problem error={stream.error} cancelled={stream.status === "cancelled"} onRetry={stream.retry} mode="venue" sharePath={sharePath} />
      ) : (
        <div className={styles.stage} data-done={plan ? "1" : "0"} data-noprint>
          <div className={styles.left}>
            <AgentLog log={stream.log} running={stream.status === "running"} elapsed={elapsed} run={plan?.run} onCancel={stream.cancel} />
            {plan && locals && locals.length > 0 && (
              <section className={styles.block} aria-labelledby="scene-title">
                <SectionHead id="scene-title" kicker="Local nights" title="The scene on your doorstep" note="Acts from around the venue that your crowd already rates." />
                <LocalScene acts={locals} city={venue?.place.city ?? city} />
              </section>
            )}
            {plan && bills && bills.length > 0 && (
              <section className={styles.block} aria-labelledby="bills-title">
                <SectionHead id="bills-title" kicker="Double bills" title="Pairs that share a crowd" />
                <DoubleBills bills={bills} />
              </section>
            )}
          </div>
          <div className={styles.right}>
            <VenueBoard venue={venue?.name ?? venueName.trim()} sizeBand={plan?.sizeBand} picks={picks} status={status} />
          </div>
        </div>
      )}

      {plan && (
        <div className={styles.after}>
          {comparison && <Compare comparison={comparison} unit="acts" />}
          {(crowd || brands.length > 0) && (
            <section className={styles.wide} aria-labelledby="insights-title" data-noprint>
              <SectionHead id="insights-title" kicker="The room" title="Who comes, and who'd sponsor them" />
              <Insights audience={crowd} actsTitle="" actsNote="" brands={brands} />
            </section>
          )}
          {plan.brief && <Brief plan={plan} sharePath={sharePath} />}
        </div>
      )}
    </>
  );
}

// ---------------- shared pieces ----------------

function Header({
  kicker,
  name,
  em,
  headline,
  running,
  chips,
  meta,
  stats,
  notices,
}: {
  kicker: string;
  name: string;
  em: string;
  headline?: string;
  running: boolean;
  chips: string[];
  meta?: ReactNode;
  stats?: string[][] | undefined;
  notices: Stream["notices"];
}) {
  return (
    <header className={styles.header} data-noprint>
      <p className={styles.kicker}>
        <span className={styles.kickerDot} /> {kicker}
      </p>
      <h1 className={styles.title}>
        {name}, <em>{em}</em>
      </h1>
      <div className={styles.headRow}>
        <div className={styles.headLeft}>
          {headline ? (
            <p className={styles.headline}>{headline}</p>
          ) : running ? (
            <p className={styles.headlineGhost} aria-label="Writing the headline">
              <i />
              <i />
            </p>
          ) : null}
          {meta && <p className={styles.meta}>{meta}</p>}
        </div>
        <ul className={styles.chips} aria-label="Your request">
          {chips.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
      {stats && (
        <dl className={styles.stats}>
          {stats.map(([k, v], i) => (
            <div key={k} style={{ "--i": i } as CSSProperties}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {notices.length > 0 && (
        <ul className={styles.notices}>
          {notices.map((n) => (
            <li key={n.message} data-code={n.code}>
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.3" />
                <path d="M7 4v3.6M7 9.6v.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              {n.message}
            </li>
          ))}
        </ul>
      )}
    </header>
  );
}

function SectionHead({ id, kicker, title, note }: { id: string; kicker: string; title: string; note?: string }) {
  return (
    <header className={styles.sectionHead}>
      <p className={styles.kicker}>
        <span className={styles.kickerDot} /> {kicker}
      </p>
      <h2 id={id}>{title}</h2>
      {note && <p className={styles.sectionNote}>{note}</p>}
    </header>
  );
}

const PROBLEM: Record<StreamError["kind"], string> = {
  not_found: "We couldn't find that one",
  limit: "That's the limit for now",
  input: "Something's missing from the request",
  network: "The connection dropped",
  server: "Something went wrong",
};

function Problem({ error, cancelled, onRetry, mode, sharePath }: { error?: StreamError; cancelled: boolean; onRetry: () => void; mode: "artist" | "venue"; sharePath: string }) {
  const examples = EXAMPLES.filter((x) => x.input.mode === mode && sharePath !== `/plan?example=${x.id}`).slice(0, 3);
  const canRetry = cancelled || (error && error.kind !== "not_found" && error.kind !== "input");
  return (
    <section className={styles.problem} role="alert" data-noprint>
      <p className={styles.kicker}>
        <span className={styles.kickerDot} data-tone="warn" /> {cancelled ? "Stopped" : "No plan this time"}
      </p>
      <h2>{cancelled ? "You stopped the run." : PROBLEM[error?.kind ?? "server"]}</h2>
      <p className={styles.problemText}>{cancelled ? "Nothing was saved. Start it again whenever you're ready." : error?.message}</p>
      <div className={styles.problemActions}>
        {canRetry && error?.kind !== "limit" && (
          <button type="button" className={styles.solidBtn} onClick={onRetry}>
            {cancelled ? "Start again" : "Try again"}
          </button>
        )}
        <Link href={mode === "venue" ? "/plan?mode=venue" : "/plan"} className={styles.ghostBtn}>
          Change the request
        </Link>
      </div>
      <div className={styles.examples}>
        <p>Or open a saved plan. These replay in seconds:</p>
        <ul>
          {examples.map((x) => (
            <li key={x.id}>
              <Link href={`/plan?example=${x.id}`}>
                <b>{x.title}</b>
                <span>{x.subtitle}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

