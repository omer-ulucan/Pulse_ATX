"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type {
  SecurityAlert,
  SecurityFindingView,
  SecuritySnapshot,
} from "../lib/security-data";
import { StatStrip } from "./stat-strip";

const scenarios = [
  { id: "benign", label: "Benign traffic" },
  { id: "cross_feed", label: "Cross-feed escalation" },
  { id: "recursive_memory", label: "Recursive memory" },
  { id: "prompt_injection", label: "Prompt injection" },
  { id: "exfiltration", label: "Exfiltration attempt" },
  { id: "critical_approval", label: "Critical approval" },
] as const;

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function isEnforcementFinding(finding: SecurityFindingView): boolean {
  return finding.provider.toLowerCase().includes("openshell");
}

export function SecurityConsole({ snapshot }: { snapshot: SecuritySnapshot }) {
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [operator, setOperator] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const pendingAlerts = snapshot.alerts.filter(
    (alert) => alert.status === "pending_approval",
  );
  const detectedFindings = snapshot.findings.filter(
    (finding) => !isEnforcementFinding(finding),
  );
  const enforcedFindings = snapshot.findings.filter(isEnforcementFinding);

  const callControl = async (
    action: string,
    path: string,
    body?: Record<string, unknown>,
  ) => {
    if (!snapshot.controlUrl) {
      setResult("NEXT_PUBLIC_AGENT_CONTROL_URL is not configured.");
      return;
    }
    if (!secret) {
      setResult("Enter the operator demo secret to open the control channel.");
      return;
    }
    setPendingAction(action);
    setResult(null);
    try {
      const request: RequestInit = {
        headers: {
          Authorization: `Bearer ${secret}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        method: "POST",
        signal: AbortSignal.timeout(10_000),
      };
      if (body) request.body = JSON.stringify(body);
      const response = await fetch(
        `${snapshot.controlUrl.replace(/\/$/, "")}${path}`,
        request,
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(
          payload.error ?? `Control server returned ${response.status}`,
        );
      setResult(`${action} completed.`);
      router.refresh();
    } catch (error) {
      setResult(
        error instanceof Error ? error.message : "Control action failed",
      );
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="security-console">
      <StatStrip
        items={[
          { label: "FINDINGS", value: String(snapshot.findings.length) },
          {
            label: "HIDDENLAYER DETECTED",
            value: String(detectedFindings.length),
          },
          { label: "POLICY ENFORCED", value: String(enforcedFindings.length) },
          {
            label: "AWAITING APPROVAL",
            state: pendingAlerts.length > 0 ? "critical" : "neutral",
            value: String(pendingAlerts.length),
          },
        ]}
      />

      <section
        className="security-split"
        aria-label="Detection and enforcement pipeline"
      >
        <section className="security-lane security-lane--detected">
          <div className="security-lane__header">
            <span className="security-lane__number">01</span>
            <div>
              <span className="panel-kicker">MODEL INPUT / OUTPUT</span>
              <h2>Detected by HiddenLayer</h2>
            </div>
            <span className="panel-readout">
              {detectedFindings.length} EVENTS
            </span>
          </div>
          {detectedFindings.length === 0 ? (
            <SecurityLaneEmpty
              copy="Threat classifications will register here before model input or output proceeds."
              side="detected"
            />
          ) : (
            <ol className="security-events">
              {detectedFindings.map((finding) => (
                <FindingRow finding={finding} key={finding.id} />
              ))}
            </ol>
          )}
        </section>

        <div aria-hidden="true" className="security-transfer">
          <span />
          <strong>POLICY BOUNDARY</strong>
          <span>→</span>
        </div>

        <section className="security-lane security-lane--enforced">
          <div className="security-lane__header">
            <span className="security-lane__number">02</span>
            <div>
              <span className="panel-kicker">RUNTIME / EGRESS</span>
              <h2>Enforced by OpenShell</h2>
            </div>
            <span className="panel-readout">
              {enforcedFindings.length} BLOCKS
            </span>
          </div>
          {enforcedFindings.length === 0 ? (
            <SecurityLaneEmpty
              copy="Denied tool calls and blocked destinations will land in this enforcement record."
              side="enforced"
            />
          ) : (
            <ol className="security-events">
              {enforcedFindings.map((finding) => (
                <FindingRow finding={finding} key={finding.id} />
              ))}
            </ol>
          )}

          <section className="approval-queue">
            <div className="instrument-label">
              HUMAN APPROVAL QUEUE
              <span>{pendingAlerts.length} PENDING</span>
            </div>
            {pendingAlerts.length === 0 ? (
              <div className="approval-empty">
                <span aria-hidden="true" />
                <p>Critical proposed actions will stop here for an operator.</p>
              </div>
            ) : (
              pendingAlerts.map((alert) => (
                <ApprovalRow
                  alert={alert}
                  disabled={
                    pendingAction !== null || operator.trim().length < 2
                  }
                  key={alert.id}
                  onApprove={() =>
                    void callControl(
                      "Alert approval",
                      `/v1/alerts/${alert.id}/approve`,
                      { operator },
                    )
                  }
                />
              ))
            )}
          </section>
        </section>
      </section>

      <section className="demo-controls">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker">CONTROL CHANNEL / DEMO</span>
            <h2>Run a verified scenario</h2>
          </div>
          <span className="panel-readout">POST / V1 / DEMO</span>
        </div>
        <div className="control-fields">
          <label>
            <span>OPERATOR SECRET</span>
            <input
              autoComplete="off"
              onChange={(event) => setSecret(event.target.value)}
              type="password"
              value={secret}
            />
          </label>
          <label>
            <span>OPERATOR IDENTITY</span>
            <input
              onChange={(event) => setOperator(event.target.value)}
              value={operator}
            />
          </label>
        </div>
        <div className="scenario-grid">
          {scenarios.map((scenario, index) => (
            <button
              className="scenario-button"
              disabled={pendingAction !== null}
              key={scenario.id}
              onClick={() =>
                void callControl(scenario.label, `/v1/demo/${scenario.id}`)
              }
              type="button"
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              {pendingAction === scenario.label ? "RUNNING" : scenario.label}
            </button>
          ))}
        </div>
        {result ? (
          <p aria-live="polite" className="control-result">
            {result}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function FindingRow({ finding }: { finding: SecurityFindingView }) {
  const critical =
    finding.severity === "critical" || finding.severity === "high";
  return (
    <li className="security-event">
      <time dateTime={finding.created_at}>
        {formatTime(finding.created_at)}
      </time>
      <div>
        <p className={critical ? "critical-text" : "data-text"}>
          {finding.threat_type.replaceAll("_", " ")}
        </p>
        <span>{finding.stage.replaceAll("_", " ")}</span>
      </div>
      <strong>{finding.action_taken.replaceAll("_", " ")}</strong>
    </li>
  );
}

function SecurityLaneEmpty({
  copy,
  side,
}: {
  copy: string;
  side: "detected" | "enforced";
}) {
  return (
    <div className={`security-lane-empty security-lane-empty--${side}`}>
      <div aria-hidden="true">
        <span>--:--:--</span>
        <i />
        <b />
        <span>--:--:--</span>
        <i />
        <b />
        <span>--:--:--</span>
        <i />
        <b />
      </div>
      <p>{copy}</p>
    </div>
  );
}

function ApprovalRow({
  alert,
  disabled,
  onApprove,
}: {
  alert: SecurityAlert;
  disabled: boolean;
  onApprove: () => void;
}) {
  return (
    <article className="approval-row">
      <div>
        <span className="critical-text">SEVERITY {alert.severity}</span>
        <h3>{alert.title}</h3>
        <p>{alert.message}</p>
      </div>
      <button disabled={disabled} onClick={onApprove} type="button">
        APPROVE
      </button>
    </article>
  );
}
