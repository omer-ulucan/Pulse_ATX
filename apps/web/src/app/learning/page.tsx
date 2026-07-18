import Link from "next/link";

import { getLearningSnapshot } from "../../lib/learning-data";

export const dynamic = "force-dynamic";

function lessonText(lesson: Record<string, unknown>): string {
  return typeof lesson.lesson === "string"
    ? lesson.lesson
    : "Structured lesson stored for future incidents.";
}

function mean(values: number[]): number | null {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : null;
}

function memoryEffect(output: Record<string, unknown>): {
  adjusted: number;
  base: number;
  used: boolean;
} | null {
  const effect = output.memory_effect;
  if (!effect || typeof effect !== "object" || Array.isArray(effect))
    return null;
  const effectRecord = effect as Record<string, unknown>;
  const adjusted = effectRecord.adjusted_prediction_minutes;
  const base = effectRecord.base_prediction_minutes;
  const used = effectRecord.used_historical_memory;
  return typeof adjusted === "number" &&
    typeof base === "number" &&
    typeof used === "boolean"
    ? { adjusted, base, used }
    : null;
}

export default async function LearningPage() {
  const snapshot = await getLearningSnapshot();
  const errors = snapshot.outcomes
    .map((outcome) => outcome.prediction_error)
    .filter((error): error is number => error !== null);
  const meanError = mean(errors);
  const meanQuality = snapshot.memories.length
    ? snapshot.memories.reduce(
        (total, memory) => total + memory.quality_score,
        0,
      ) / snapshot.memories.length
    : null;
  const chronologicalErrors = [...snapshot.outcomes]
    .reverse()
    .map((outcome) => outcome.prediction_error)
    .filter((error): error is number => error !== null);
  const windowSize = Math.min(
    5,
    Math.max(1, Math.ceil(chronologicalErrors.length / 2)),
  );
  const firstWindowMae = mean(chronologicalErrors.slice(0, windowSize));
  const recentWindowMae = mean(chronologicalErrors.slice(-windowSize));
  const effects = snapshot.decisions
    .map((decision) => memoryEffect(decision.output))
    .filter((effect): effect is NonNullable<typeof effect> => effect !== null);
  const memoryUses = effects.filter((effect) => effect.used);
  const latestMemoryUse = memoryUses[0] ?? null;

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
          <Link className="hover:text-emerald-200" href="/security">
            Security
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

      <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
        <Metric
          label="First-window MAE"
          value={
            firstWindowMae === null
              ? "No outcomes"
              : `${firstWindowMae.toFixed(1)} min`
          }
        />
        <Metric
          label="Recent-window MAE"
          value={
            recentWindowMae === null
              ? "No outcomes"
              : `${recentWindowMae.toFixed(1)} min`
          }
        />
        <Metric
          label="Memory retrieval usage"
          value={`${memoryUses.length} / ${effects.length}`}
        />
      </section>

      <section className="mb-8 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">Duration error over time</h2>
            <span className="text-xs text-slate-500">
              {snapshot.outcomes.length} completed incidents
            </span>
          </div>
          <div className="mt-6 flex min-h-36 items-end gap-2">
            {chronologicalErrors.length === 0 ? (
              <p className="self-center text-sm text-slate-400">
                No recorded outcomes.
              </p>
            ) : null}
            {chronologicalErrors.map((error, index) => (
              <div
                aria-label={`Outcome ${index + 1}: ${error} minute error`}
                className="min-w-3 flex-1 rounded-t bg-emerald-300/70"
                key={`${index}-${error}`}
                style={{ height: `${Math.max(8, Math.min(136, error * 6))}px` }}
                title={`${error} minute error`}
              />
            ))}
          </div>
        </article>
        <article className="rounded-3xl border border-emerald-300/10 bg-emerald-300/[0.04] p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-200">
            Latest memory-adjusted prediction
          </p>
          {latestMemoryUse ? (
            <div className="mt-6 grid grid-cols-2 gap-4">
              <Metric
                label="Before memory"
                value={`${latestMemoryUse.base} min`}
              />
              <Metric
                label="After memory"
                value={`${latestMemoryUse.adjusted} min`}
              />
            </div>
          ) : (
            <p className="mt-5 text-sm text-slate-400">
              Waiting for a decision that retrieves historical memory.
            </p>
          )}
        </article>
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
