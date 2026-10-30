import Link from "next/link";
import styles from "./Nav.module.css";

const LINKS = [
  { href: "#blind-spots", label: "Blind spots" },
  { href: "#how", label: "How it works" },
  { href: "#brief", label: "Tour brief" },
  { href: "#venues", label: "For venues" },
];

export function Logo() {
  return (
    <Link href="/" className={styles.logo} aria-label="Fanmap home">
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        <rect x="2" y="12" width="4.5" height="8" rx="1" fill="#4a443c" />
        <rect x="8.75" y="3" width="4.5" height="17" rx="1" fill="#FFB547" />
        <rect x="15.5" y="8.5" width="4.5" height="11.5" rx="1" fill="#8C8478" />
      </svg>
      fanmap
    </Link>
  );
}

export default function Nav() {
  return (
    <header className={styles.nav}>
      <Logo />
      <nav aria-label="Main" className={styles.links}>
        {LINKS.map((l) => (
          <a key={l.href} href={l.href}>
            {l.label}
          </a>
        ))}
      </nav>
      <a href="#plan" className={styles.cta}>
        Plan a tour
      </a>
    </header>
  );
}
