"use client";

import { useEffect, useMemo, useState } from "react";

import type {
  DashboardIncident,
  DashboardMission,
  DashboardMissionStep,
  DashboardObservation,
  DashboardTimeline,
  DashboardToolExecution,
} from "../lib/dashboard-data";

const toolLabels: Record<string, string> = {
  calculate_impact_change: "Calculated live impact change",
  cancel_pending_action: "Cancelled an invalidated pending action",
  check_weather_conditions: "Checked current weather amplification",
  close_incident: "Closed the incident after recovery",
  create_alert_draft: "Created a targeted commuter alert draft",
  find_affected_transit_routes: "Checked affected transit routes",
  get_incident_snapshot: "Retrieved a fresh incident snapshot",
  publish_simulated_alert: "Published the approved alert in simulation",
  record_incident_outcome: "Recorded the observed incident outcome",
  request_human_approval: "Requested operator approval",
  retrieve_similar_incidents: "Retrieved similar historical incidents",
  revise_alert_draft: "Revised the commuter alert draft",
  schedule_incident_recheck: "Scheduled the next live recheck",
  store_incident_lesson: "Stored the reusable mission lesson",
  update_incident_severity: "Updated incident severity from evidence",
};

function toolLabel(step: DashboardMissionStep): string {
  const base =
    toolLabels[step.tool_name] ?? step.tool_name.replaceAll("_", " ");
  if (
    step.tool_name === "retrieve_similar_incidents" &&
    Array.isArray(step.result)
  ) {
    return `Retrieved ${step.result.length} similar incidents`;
  }
  return base;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function readableValue(value: unknown): string {
  if (typeof value === "number")
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === "string") return value.replaceAll("_", " ");
  if (Array.isArray(value)) return value.join(", ");
  return "--";
}

function countdown(nextWakeAt: string | null, now: number): string {
  if (!nextWakeAt) return "NO WAKE SET";
  const remaining = Math.max(0, Date.parse(nextWakeAt) - now);
  if (remaining === 0) return "WAKE DUE";
  const totalSeconds = Math.ceil(remaining / 1_000);
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function stepGlyph(status: DashboardMissionStep["status"]): string {
  if (status === "completed") return "✓";
  if (
    status === "running" ||
    status === "waiting" ||
    status === "waiting_approval"
  )
    return "◷";
  if (status === "failed" || status === "cancelled") return "×";
  return "○";
}

export function IncidentCommanderPanel({
  controlUrl,
  executions,
  incident,
  mission,
  observations,
  steps,
  timeline,
}: {
  controlUrl: string | null;
  executions: DashboardToolExecution[];
  incident: DashboardIncident | null;
  mission: DashboardMission | null;
  observations: DashboardObservation[];
  steps: DashboardMissionStep[];
  timeline: DashboardTimeline[];
}) {
  const [now, setNow] = useState(() => Date.now());
  const [operator, setOperator] = useState("");
  const [secret, setSecret] = useState("");
  const [pendingDecision, setPendingDecision] = useState<
    "approve" | "reject" | null
  >(null);
  const [controlResult, setControlResult] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const currentSteps = useMemo(
    () =>
      mission
        ? steps
            .filter(
              (step) =>
                step.mission_id === mission.id &&
                step.plan_version === mission.plan_version,
            )
            .sort((left, right) => left.step_order - right.step_order)
        : [],
    [mission, steps],
  );
  const missionObservations = useMemo(
    () =>
      mission
        ? observations
            .filter((observation) => observation.mission_id === mission.id)
            .sort((left, right) =>
              right.created_at.localeCompare(left.created_at),
            )
        : [],
    [mission, observations],
  );
  const currentObservation = missionObservations[0] ?? null;
  const latestAudit = [...currentSteps]
    .reverse()
    .find((step) => step.decision_audit !== null)?.decision_audit;
  const pendingExecution = mission
    ? (executions.find(
        (execution) =>
          execution.mission_id === mission.id &&
          execution.approval_status === "pending",
      ) ?? null)
    : null;
  const approvalStep = pendingExecution?.mission_step_id
    ? (steps.find((step) => step.id === pendingExecution.mission_step_id) ??
      null)
    : null;
  const history = mission
    ? timeline
        .filter(
          (entry) =>
            entry.incident_id === mission.incident_id &&
            (entry.metadata.missionId === undefined ||
              entry.metadata.missionId === mission.id),
        )
        .slice(0, 14)
    : [];
  const planVersions = mission
    ? [
        ...new Set(
          steps
            .filter((step) => step.mission_id === mission.id)
            .map((step) => step.plan_version),
        ),
      ].sort((left, right) => right - left)
    : [];

  const decide = async (approved: boolean) => {
    if (!pendingExecution) return;
    if (!controlUrl) {
      setControlResult("The protected control channel is not configured.");
      return;
    }
    if (!secret || operator.trim().length < 2) {
      setControlResult(
        "Enter the operator secret and identity before deciding.",
      );
      return;
    }
    setPendingDecision(approved ? "approve" : "reject");
    setControlResult(null);
    try {
      const response = await fetch(
        `${controlUrl.replace(/\/$/, "")}/v1/missions/tools/${pendingExecution.id}/decision`,
        {
          body: JSON.stringify({ approved, operator }),
          headers: {
            Authorization: `Bearer ${secret}`,
            "Content-Type": "application/json",
          },
          method: "POST",
          signal: AbortSignal.timeout(10_000),
        },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(
          payload.error ?? `Control server returned ${response.status}`,
        );
      setControlResult(
        approved
          ? "Approval recorded. Mission resume queued."
          : "Rejection recorded. Mission cancellation queued.",
      );
    } catch (error) {
      setControlResult(
        error instanceof Error ? error.message : "Approval decision failed",
      );
    } finally {
      setPendingDecision(null);
    }
  };

  return (
    <section
      className="commander-panel"
      aria-label="Autonomous Incident Commander"
    >
      <div className="panel-heading commander-panel__heading">
        <div>
          <span className="panel-kicker">
            AUTONOMOUS LOOP / INCIDENT COMMANDER
          </span>
          <h2>Incident Commander</h2>
        </div>
        <span className="panel-readout">
          {mission
            ? `MISSION ${mission.id.slice(0, 8)} / V${mission.plan_version}`
            : "MISSION CHANNEL IDLE"}
        </span>
      </div>

      {!mission || !incident ? (
        <CommanderEmpty />
      ) : (
        <>
          <header className="mission-header">
            <div className="mission-header__goal">
              <span className="instrument-label">OPERATIONAL GOAL</span>
              <h3>{mission.goal}</h3>
              <ul>
                {mission.success_criteria.map((criterion) => (
                  <li key={criterion}>{criterion}</li>
                ))}
              </ul>
            </div>
            <dl className="mission-header__readouts">
              <div>
                <dt>STATE</dt>
                <dd
                  className={`mission-state mission-state--${mission.status}`}
                >
                  {mission.status.replaceAll("_", " ")}
                </dd>
              </div>
              <div>
                <dt>PRIORITY</dt>
                <dd>{mission.priority} / 5</dd>
              </div>
              <div>
                <dt>PLAN</dt>
                <dd>V{mission.plan_version}</dd>
              </div>
              <div>
                <dt>NEXT WAKE</dt>
                <dd>{countdown(mission.next_wake_at, now)}</dd>
              </div>
            </dl>
          </header>

          <div className="commander-grid">
            <section className="commander-instrument live-plan">
              <div className="commander-instrument__header">
                <span>LIVE PLAN</span>
                <strong>
                  STEP {mission.current_step} / {currentSteps.length}
                </strong>
              </div>
              <ol>
                {currentSteps.map((step) => (
                  <li
                    className={`mission-step mission-step--${step.status}`}
                    key={step.id}
                  >
                    <span aria-hidden="true">{stepGlyph(step.status)}</span>
                    <div>
                      <p>{toolLabel(step)}</p>
                      <small>{step.rationale}</small>
                    </div>
                    <strong>{step.status.replaceAll("_", " ")}</strong>
                  </li>
                ))}
              </ol>
            </section>

            <section className="commander-instrument current-observation">
              <div className="commander-instrument__header">
                <span>CURRENT OBSERVATION</span>
                <strong>
                  {currentObservation
                    ? formatTime(currentObservation.created_at)
                    : "--:--:--"}
                </strong>
              </div>
              {currentObservation ? (
                <dl>
                  <ObservationValue
                    label="SEVERITY"
                    value={currentObservation.state_snapshot.severity}
                    critical={currentObservation.state_snapshot.severity >= 4}
                  />
                  <ObservationValue
                    label="BLOCKED LANES"
                    value={currentObservation.state_snapshot.blockedLanes}
                  />
                  <ObservationValue
                    label="ROUTE DELAY"
                    value={`${currentObservation.state_snapshot.transitDelayMinutes} MIN`}
                  />
                  <ObservationValue
                    label="AFFECTED ROUTES"
                    value={readableValue(
                      currentObservation.state_snapshot.affectedRoutes,
                    )}
                  />
                  <ObservationValue
                    label="WEATHER"
                    value={readableValue(
                      currentObservation.state_snapshot.weatherSeverity,
                    )}
                  />
                  <ObservationValue
                    label="PREDICTED"
                    value={`${currentObservation.state_snapshot.predictedDurationMinutes} MIN`}
                  />
                </dl>
              ) : (
                <InstrumentEmpty copy="The first correlated observation will establish this mission baseline." />
              )}
            </section>

            <section className="commander-instrument change-instrument">
              <div className="commander-instrument__header">
                <span>CHANGE SINCE LAST WAKE</span>
                <strong>CYCLE {mission.wake_cycle}</strong>
              </div>
              {currentObservation &&
              Object.keys(currentObservation.change_summary).length > 0 ? (
                <ChangeRows change={currentObservation.change_summary} />
              ) : (
                <InstrumentEmpty copy="A second wake will open the deterministic before-and-after register." />
              )}
            </section>

            <section className="commander-instrument decision-audit">
              <div className="commander-instrument__header">
                <span>WHY THIS ACTION?</span>
                <strong>STRUCTURED AUDIT</strong>
              </div>
              {latestAudit ? (
                <div className="decision-audit__body">
                  <span>SELECTED</span>
                  <h3>{latestAudit.selectedAction}</h3>
                  <p>{latestAudit.selectionReason}</p>
                  <span>ALTERNATIVES</span>
                  <ul>
                    {latestAudit.alternatives.map((alternative) => (
                      <li key={alternative.name}>
                        <strong>{alternative.name}</strong>
                        <p>{alternative.expectedRisk}</p>
                        <small>
                          {Math.round(alternative.confidence * 100)}% /{" "}
                          {alternative.reversibility} reversibility
                        </small>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <InstrumentEmpty copy="High-impact steps will show selected action, risks, and rejected alternatives here." />
              )}
            </section>
          </div>

          {pendingExecution ? (
            <section className="mission-approval-card">
              <div>
                <span className="instrument-label">
                  HUMAN BOUNDARY / ACTION STOPPED
                </span>
                <h3>
                  {toolLabels[pendingExecution.tool_name] ??
                    pendingExecution.tool_name.replaceAll("_", " ")}
                </h3>
                <p>
                  {approvalStep?.rationale ??
                    "Policy requires an operator decision before this protected action can execute."}
                </p>
              </div>
              <dl>
                <div>
                  <dt>AUDIENCE</dt>
                  <dd>{readableValue(pendingExecution.arguments.audience)}</dd>
                </div>
                <div>
                  <dt>IMPACT</dt>
                  <dd>{readableValue(pendingExecution.arguments.impact)}</dd>
                </div>
                <div>
                  <dt>SECURITY</dt>
                  <dd>
                    {pendingExecution.security_status.replaceAll("_", " ")}
                  </dd>
                </div>
              </dl>
              <div className="mission-approval-card__credentials">
                <label>
                  <span>OPERATOR IDENTITY</span>
                  <input
                    value={operator}
                    onChange={(event) => setOperator(event.target.value)}
                  />
                </label>
                <label>
                  <span>CONTROL SECRET</span>
                  <input
                    autoComplete="off"
                    type="password"
                    value={secret}
                    onChange={(event) => setSecret(event.target.value)}
                  />
                </label>
              </div>
              <div className="mission-approval-card__actions">
                <button
                  disabled={pendingDecision !== null}
                  onClick={() => void decide(true)}
                  type="button"
                >
                  {pendingDecision === "approve" ? "RECORDING" : "APPROVE"}
                </button>
                <button
                  disabled={pendingDecision !== null}
                  onClick={() => void decide(false)}
                  type="button"
                >
                  {pendingDecision === "reject" ? "RECORDING" : "REJECT"}
                </button>
              </div>
              {controlResult ? (
                <p className="mission-control-result" aria-live="polite">
                  {controlResult}
                </p>
              ) : null}
            </section>
          ) : null}

          <section className="mission-history">
            <div className="commander-instrument__header">
              <span>MISSION HISTORY</span>
              <strong>
                {planVersions.length} PLAN VERSION
                {planVersions.length === 1 ? "" : "S"} / {mission.wake_cycle}{" "}
                WAKES
              </strong>
            </div>
            <div className="mission-history__body">
              <div className="plan-version-register">
                {planVersions.map((version) => (
                  <div key={version}>
                    <span>PLAN V{version}</span>
                    <strong>
                      {
                        steps.filter(
                          (step) =>
                            step.mission_id === mission.id &&
                            step.plan_version === version,
                        ).length
                      }{" "}
                      STEPS
                    </strong>
                  </div>
                ))}
              </div>
              {history.length > 0 ? (
                <ol>
                  {history.map((entry) => (
                    <li key={entry.id}>
                      <time dateTime={entry.created_at}>
                        {formatTime(entry.created_at)}
                      </time>
                      <span>{entry.event_type.replaceAll("_", " ")}</span>
                      <p>{entry.message}</p>
                    </li>
                  ))}
                </ol>
              ) : (
                <InstrumentEmpty copy="Mission state transitions will register here without exposing private reasoning traces." />
              )}
            </div>
          </section>
        </>
      )}
    </section>
  );
}

function ObservationValue({
  critical = false,
  label,
  value,
}: {
  critical?: boolean;
  label: string;
  value: number | string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={critical ? "critical-text" : ""}>{value}</dd>
    </div>
  );
}

function ChangeRows({ change }: { change: Record<string, unknown> }) {
  const entries = Object.entries(change).filter(([, value]) => {
    if (typeof value !== "object" || value === null) return false;
    if ("delta" in value)
      return typeof value.delta === "number" && value.delta !== 0;
    if ("changed" in value) return value.changed === true;
    return false;
  });
  return (
    <div className="change-rows">
      {entries.slice(0, 7).map(([key, value]) => {
        const record = value as Record<string, unknown>;
        return (
          <div key={key}>
            <span>{key.replace(/([A-Z])/g, " $1").replaceAll("_", " ")}</span>
            <strong>
              {readableValue(record.before)} → {readableValue(record.after)}
            </strong>
          </div>
        );
      })}
    </div>
  );
}

function InstrumentEmpty({ copy }: { copy: string }) {
  return (
    <div className="commander-empty-instrument">
      <div aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p>{copy}</p>
    </div>
  );
}

function CommanderEmpty() {
  return (
    <div className="commander-empty">
      <div aria-hidden="true" className="commander-empty__loop">
        <span>OBSERVE</span>
        <i>→</i>
        <span>PLAN</span>
        <i>→</i>
        <span>ACT</span>
        <i>→</i>
        <span>WAIT</span>
        <i>→</i>
        <span>REVISE</span>
      </div>
      <p>
        A qualifying correlated incident will establish a goal, execute a
        bounded plan, and reopen itself on the next live observation.
      </p>
    </div>
  );
}
