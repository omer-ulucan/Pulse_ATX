import Link from "next/link";

import { getLearningSnapshot } from "../../lib/learning-data";

export const dynamic = "force-dynamic";

function lessonText(lesson: Record<string, unknown>): string {
  return typeof lesson.lesson === "string"
    ? lesson.lesson
    : "Structured lesson stored for future incidents.";
}

export default async function LearningPage() {
  const snapshot = await getLearningSnapshot();
  const errors = snapshot.outcomes
    .map((outcome) => outcome.prediction_error)
    .filter((error): error is number => error !== null);
  const meanError = errors.length
    ? errors.reduce((total, error) => total + error, 0) / errors.length
    : null;
  const meanQuality = snapshot.memories.length
    ? snapshot.memories.reduce(
        (total, memory) => total + memory.quality_score,
        0,
      ) / snapshot.memories.length
    : null;

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-12">
      <header className="mb-10 flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-emerald-300">
            Recursive intelligence
          </p>
          <h1 className="mt-3 text-4xl font-semibold">What PulseATX learned</h1>
        </div>
        <nav className="flex gap-5 text-sm text-slate-300">
          <Link className="hover:text-emerald-200" href="/dashboard">
            Command center
          </Link>
          <Link className="hover:text-emerald-200" href="/">
            Overview
          </Link>
        </nav>
      </header>

      {!snapshot.configured ? (
        <p className="mb-6 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-5 text-amber-100">
          Configure the public Supabase URL and anon key to display learned
          incident outcomes.
        </p>
      ) : null}
      {snapshot.error ? (
        <p className="mb-6 rounded-2xl border border-red-300/20 bg-red-300/10 p-5 text-red-100">
          {snapshot.error}
        </p>
      ) : null}

      <section className="mb-8 grid gap-4 sm:grid-cols-3">
        <Metric
          label="Stored lessons"
          value={String(snapshot.memories.length)}
        />
        <Metric
          label="Mean prediction error"
          value={
            meanError === null ? "No outcomes" : `${meanError.toFixed(1)} min`
          }
        />
        <Metric
          label="Mean memory quality"
          value={meanQuality === null ? "No memories" : meanQuality.toFixed(2)}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {snapshot.memories.map((memory) => (
          <article
            className="rounded-3xl border border-white/10 bg-white/[0.04] p-6"
            key={memory.id}
          >
            <div className="mb-4 flex items-center justify-between gap-4 text-xs uppercase tracking-wide">
              <span className="text-emerald-200">Incident memory</span>
              <span className="text-slate-500">
                quality {memory.quality_score.toFixed(2)}
              </span>
            </div>
            <h2 className="text-lg font-medium text-slate-100">
              {memory.summary}
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              {lessonText(memory.lesson)}
            </p>
          </article>
        ))}
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold text-slate-100">{value}</p>
    </div>
  );
}
