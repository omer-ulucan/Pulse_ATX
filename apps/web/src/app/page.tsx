import { APP_NAME } from "@pulse-atx/shared";
import Link from "next/link";

const capabilities = [
  "Incremental public-feed monitoring",
  "Persistent heartbeat outside Vercel",
  "Validated Nemotron decisions through vLLM",
  "Realtime incidents, learning, and security",
];

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center gap-12 px-6 py-16">
      <div className="w-fit rounded-full border border-emerald-300/25 bg-emerald-300/10 px-4 py-2 text-sm text-emerald-200">
        Austin live intelligence network
      </div>
      <section className="max-w-4xl space-y-5">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-emerald-300">
          {APP_NAME}
        </p>
        <h1 className="text-5xl font-semibold tracking-tight sm:text-7xl">
          Know what Austin needs next.
        </h1>
        <p className="max-w-2xl text-lg leading-8 text-slate-300">
          A persistent city agent that detects new signals, correlates
          operational impact, learns from outcomes, and publishes trustworthy
          updates within seconds.
        </p>
        <Link
          className="inline-flex rounded-full bg-emerald-300 px-5 py-3 font-semibold text-emerald-950 transition hover:bg-emerald-200"
          href="/dashboard"
        >
          Open command center
        </Link>
      </section>
      <section className="grid gap-4 sm:grid-cols-2">
        {capabilities.map((capability) => (
          <article
            className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-slate-200"
            key={capability}
          >
            <span className="mr-3 text-emerald-300">●</span>
            {capability}
          </article>
        ))}
      </section>
    </main>
  );
}
