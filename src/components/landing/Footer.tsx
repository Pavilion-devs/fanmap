import Link from "next/link";
import { Logo } from "./Nav";
import styles from "./Footer.module.css";

const LINKS = [
  { href: "#blind-spots", label: "Blind spots" },
  { href: "#how", label: "How it works" },
  { href: "#for", label: "Who it's for" },
  { href: "#venues", label: "For venues" },
  { href: "#brief", label: "Tour brief" },
  { href: "/plan", label: "Plan a tour" },
  { href: "/plan?mode=venue", label: "Book a room" },
];

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.top}>
        <div className={styles.brand}>
          <Logo />
          <p>Find where your fans actually are, then go play there.</p>
        </div>

        <nav aria-label="Footer" className={styles.links}>
          {LINKS.map((l) =>
            l.href.startsWith("/") ? (
              <Link key={l.href} href={l.href}>
                {l.label}
              </Link>
            ) : (
              <a key={l.href} href={l.href}>
                {l.label}
              </a>
            ),
          )}
        </nav>

        <details className={styles.credits}>
          <summary>Data &amp; credits</summary>
          <p>
            Taste, audience and place data from Qloo. Planning and briefs written by Claude. City data from{" "}
            <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">
              GeoNames
            </a>
            , licensed{" "}
            <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
              CC BY 4.0
            </a>
            . Photos from{" "}
            <a href="https://unsplash.com/" target="_blank" rel="noreferrer">
              Unsplash
            </a>
            . Fan scores show where taste is concentrated, not guaranteed ticket sales.
          </p>
        </details>
      </div>

      <p className={styles.word} aria-hidden="true">
        Fanmap
      </p>

      <div className={styles.bottom}>
        <span>© 2026 Fanmap</span>
        <span>Any artist · any country</span>
      </div>
    </footer>
  );
}
