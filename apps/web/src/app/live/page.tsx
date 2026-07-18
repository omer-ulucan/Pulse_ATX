import Link from "next/link";

import { getLiveEvents } from "../../lib/live-events";

export const dynamic = "force-dynamic";

function payloadTitle(payload: Record<string, unknown>): string {
  const issue = payload.issue_reported;
  return typeof issue === "string" ? issue : "New city event detected";
}

export default async function LiveEventsPage() {
  const result = await getLiveEvents();

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-12">
      <header className="mb-10 flex items-end justify-between gap-6">
        <div>
          <p className="mb-2 text-sm font-semibold uppercase tracking-[0.25em] text-emerald-300">
            Live ingestion
          </p>
          <h1 className="text-4xl font-semibold">City events</h1>
        </div>
        <Link
          className="text-sm text-emerald-200 hover:text-emerald-100"
          href="/"
        >
          Overview
        </Link>
      </header>

      {!result.configured ? (
        <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-6 text-amber-100">
          Add the public Supabase URL and anon key to display ingested events.
          The worker keeps service-role credentials server-side.
        </div>
      ) : null}
      {result.error ? (
        <div className="rounded-2xl border border-red-300/20 bg-red-300/10 p-6 text-red-100">
          {result.error}
        </div>
      ) : null}
      {result.events.length === 0 && result.configured && !result.error ? (
        <p className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-slate-300">
          Waiting for the next Austin traffic event.
        </p>
      ) : null}
      <section className="grid gap-4">
        {result.events.map((event) => (
          <article
            className="rounded-2xl border border-white/10 bg-white/[0.04] p-6"
            key={event.id}
          >
            <div className="mb-4 flex items-center justify-between gap-4">
              <span className="rounded-full bg-emerald-300/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-emerald-200">
                {event.processing_status}
              </span>
              <span className="text-xs text-slate-400">
                revision {event.revision}
              </span>
            </div>
            <h2 className="text-xl font-medium">
              {payloadTitle(event.payload)}
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              {event.source} · {event.external_id}
            </p>
          </article>
        ))}
      </section>
    </main>
  );
}
