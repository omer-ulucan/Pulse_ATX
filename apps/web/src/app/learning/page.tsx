import { MaeChart } from "../../components/mae-chart";
import { PageShell, SystemNotice } from "../../components/operations-shell";
import { StatStrip } from "../../components/stat-strip";
import { getLearningSnapshot } from "../../lib/learning-data";

export const dynamic = "force-dynamic";

function lessonText(lesson: Record<string, unknown>): string {
  return typeof lesson.lesson === "string"
    ? lesson.lesson
    : "A structured operational lesson is stored for the next similar event.";
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
  const record = effect as Record<string, unknown>;
  return typeof record.adjusted_prediction_minutes === "number" &&
    typeof record.base_prediction_minutes === "number" &&
    typeof record.used_historical_memory === "boolean"
    ? {
        adjusted: record.adjusted_prediction_minutes,
        base: record.base_prediction_minutes,
        used: record.used_historical_memory,
      }
    : null;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default async function LearningPage() {
  const snapshot = await getLearningSnapshot();
  const chronologicalErrors = [...snapshot.outcomes]
    .reverse()
    .map((outcome) => outcome.prediction_error)
    .filter((error): error is number => error !== null);
  const effects = snapshot.decisions
    .map((decision) => memoryEffect(decision.output))
    .filter((effect): effect is NonNullable<typeof effect> => effect !== null);
  const memoryUses = effects.filter((effect) => effect.used);
  const latestMemoryUse = memoryUses[0] ?? null;
  const currentMae = mean(chronologicalErrors.slice(-5));

  return (
    <PageShell
      current="/learning"
      description="Observed outcomes are compared with earlier duration estimates so the next similar incident starts with better evidence."
      eyebrow="RECURSIVE INTELLIGENCE / OUTCOME LEDGER"
      title="What the agent learned"
    >
      {!snapshot.configured ? (
        <SystemNotice>
          Public Supabase values are not loaded. The learning instruments are
          staged for the first completed outcome.
        </SystemNotice>
      ) : null}
      {snapshot.error ? (
        <SystemNotice severity="critical">{snapshot.error}</SystemNotice>
      ) : null}

      <StatStrip
        items={[
          {
            label: "COMPLETED OUTCOMES",
            value: String(snapshot.outcomes.length),
          },
          { label: "STORED LESSONS", value: String(snapshot.memories.length) },
          {
            label: "RECENT MAE",
            value:
              currentMae === null ? "-- MIN" : `${currentMae.toFixed(1)} MIN`,
          },
          {
            label: "MEMORY RETRIEVAL",
            value: `${memoryUses.length} / ${effects.length}`,
          },
        ]}
      />

      <section className="learning-centerpiece">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker">
              PREDICTION ERROR / COMPLETED INCIDENTS
            </span>
            <h2>Mean absolute error over time</h2>
          </div>
          <span className="panel-readout">UNIT / MINUTES</span>
        </div>
        <MaeChart values={chronologicalErrors} />
      </section>

      <section className="learning-lower-grid">
        <article className="memory-adjustment">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">LATEST RETRIEVAL</span>
              <h2>Prediction adjustment</h2>
            </div>
            <span className="panel-readout">PGVECTOR / 384D</span>
          </div>
          {latestMemoryUse ? (
            <div className="adjustment-visual">
              <div>
                <span>BASE</span>
                <strong>{latestMemoryUse.base}</strong>
                <small>MIN</small>
              </div>
              <span className="adjustment-visual__track" aria-hidden="true">
                <i />
              </span>
              <div>
                <span>MEMORY ADJUSTED</span>
                <strong>{latestMemoryUse.adjusted}</strong>
                <small>MIN</small>
              </div>
            </div>
          ) : (
            <div className="adjustment-empty">
              <div aria-hidden="true">
                <span />
                <i />
                <span />
              </div>
              <p>
                A retrieved incident will show how memory changed the estimate.
              </p>
            </div>
          )}
        </article>

        <section className="memory-ledger">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">INCIDENT MEMORY</span>
              <h2>Stored lessons</h2>
            </div>
            <span className="panel-readout">
              {snapshot.memories.length} ROWS
            </span>
          </div>
          {snapshot.memories.length === 0 ? (
            <div className="ledger-empty">
              <div aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <p>
                Resolved incidents will register a reusable lesson in this
                ledger.
              </p>
            </div>
          ) : (
            <ol className="lesson-list">
              {snapshot.memories.map((memory) => (
                <li key={memory.id}>
                  <div className="lesson-list__meta">
                    <time dateTime={memory.created_at}>
                      {formatDate(memory.created_at)}
                    </time>
                    <span>Q {memory.quality_score.toFixed(2)}</span>
                  </div>
                  <div>
                    <h3>{memory.summary}</h3>
                    <p>{lessonText(memory.lesson)}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </section>
    </PageShell>
  );
}
