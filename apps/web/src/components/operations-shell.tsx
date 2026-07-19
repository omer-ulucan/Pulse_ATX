import Link from "next/link";
import type { ReactNode } from "react";

const navigation = [
  { href: "/dashboard", label: "Command" },
  { href: "/learning", label: "Learning" },
  { href: "/security", label: "Security" },
  { href: "/live", label: "Raw feed" },
] as const;

export function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      aria-label="PulseATX home"
      className={
        compact ? "brand-lockup brand-lockup--compact" : "brand-lockup"
      }
      href="/"
    >
      <span>PULSE</span>
      <span className="brand-lockup__city">ATX</span>
    </Link>
  );
}

export function OperationsNav({ current }: { current?: string }) {
  return (
    <nav aria-label="Primary navigation" className="operations-nav">
      {navigation.map((item) => (
        <Link
          aria-current={current === item.href ? "page" : undefined}
          className="operations-nav__link"
          href={item.href}
          key={item.href}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function PageShell({
  children,
  current,
  description,
  eyebrow,
  title,
}: {
  children: ReactNode;
  current: string;
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <main className="page-shell">
      <header className="page-masthead">
        <div className="page-masthead__brand">
          <BrandLockup compact />
          <span className="system-label">Austin city operations</span>
        </div>
        <OperationsNav current={current} />
        <div className="page-masthead__title">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="page-deck">{description}</p>
        </div>
      </header>
      {children}
    </main>
  );
}

export function SystemNotice({
  children,
  severity = "info",
}: {
  children: ReactNode;
  severity?: "critical" | "info";
}) {
  return (
    <div className={`system-notice system-notice--${severity}`} role="status">
      <span aria-hidden="true" className="system-notice__code">
        {severity === "critical" ? "ERR" : "SYS"}
      </span>
      <p>{children}</p>
    </div>
  );
}
