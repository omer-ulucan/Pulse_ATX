"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type {
  SecurityAlert,
  SecurityFindingView,
  SecuritySnapshot,
} from "../lib/security-data";

const scenarios = [
  { id: "benign", label: "Benign traffic" },
  { id: "prompt_injection", label: "Prompt injection" },
  { id: "exfiltration", label: "Exfiltration attempt" },
  { id: "critical_approval", label: "Critical approval" },
] as const;

export function SecurityConsole({ snapshot }: { snapshot: SecuritySnapshot }) {
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [operator, setOperator] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const pendingAlerts = snapshot.alerts.filter(
    (alert) => alert.status === "pending_approval",
  );
  const promptInjectionCount = snapshot.findings.filter(
    (finding) => finding.threat_type === "prompt_injection",
  ).length;
  const openshellCount = snapshot.findings.filter(
    (finding) => finding.provider === "openshell",
  ).length;

  const callControl = async (
    action: string,
    path: string,
    body?: Record<string, unknown>,
  ) => {
    if (!snapshot.controlUrl) {
      setResult("Configure NEXT_PUBLIC_AGENT_CONTROL_URL first.");
      return;
    }
    if (!secret) {
      setResult("Enter the operator demo secret.");
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
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-4">
        <Metric
          label="Security findings"
          value={String(snapshot.findings.length)}
        />
        <Metric
          label="Prompt injections"
          value={String(promptInjectionCount)}
        />
        <Metric label="OpenShell blocks" value={String(openshellCount)} />
        <Metric
          label="Awaiting approval"
          value={String(pendingAlerts.length)}
        />
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm text-slate-300">
            Operator demo secret
            <input
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-slate-100 outline-none focus:border-emerald-300/50"
              onChange={(event) => setSecret(event.target.value)}
              type="password"
              value={secret}
            />
          </label>
          <label className="text-sm text-slate-300">
            Operator identity
            <input
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-slate-100 outline-none focus:border-emerald-300/50"
              onChange={(event) => setOperator(event.target.value)}
              placeholder="Austin EOC operator"
              value={operator}
            />
          </label>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          {scenarios.map((scenario) => (
            <button
              className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-4 py-2 text-sm text-emerald-100 transition hover:bg-emerald-300/20 disabled:opacity-40"
              disabled={pendingAction !== null}
              key={scenario.id}
              onClick={() =>
                void callControl(scenario.label, `/v1/demo/${scenario.id}`)
              }
              type="button"
            >
              {pendingAction === scenario.label ? "Running…" : scenario.label}
            </button>
          ))}
        </div>
        {result ? (
          <p className="mt-4 text-sm text-amber-100">{result}</p>
        ) : null}
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-3xl border border-amber-300/10 bg-amber-300/[0.04] p-6">
          <h2 className="text-lg font-semibold">Human approval queue</h2>
          <div className="mt-5 space-y-4">
            {pendingAlerts.length === 0 ? (
              <p className="text-sm text-slate-400">
                No alerts await approval.
              </p>
            ) : null}
            {pendingAlerts.map((alert: SecurityAlert) => (
              <article
                className="rounded-2xl border border-white/10 p-4"
                key={alert.id}
              >
                <p className="text-xs uppercase tracking-wide text-amber-200">
                  severity {alert.severity} ·{" "}
                  {alert.status.replaceAll("_", " ")}
                </p>
                <h3 className="mt-2 font-medium">{alert.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  {alert.message}
                </p>
                <button
                  className="mt-4 rounded-full bg-amber-200 px-4 py-2 text-sm font-semibold text-amber-950 disabled:opacity-40"
                  disabled={
                    pendingAction !== null || operator.trim().length < 2
                  }
                  onClick={() =>
                    void callControl(
                      "Alert approval",
                      `/v1/alerts/${alert.id}/approve`,
                      {
                        operator,
                      },
                    )
                  }
                  type="button"
                >
                  Approve alert
                </button>
              </article>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-red-300/10 bg-red-300/[0.04] p-6">
          <h2 className="text-lg font-semibold">Detection history</h2>
          <div className="mt-5 space-y-4">
            {snapshot.findings.length === 0 ? (
              <p className="text-sm text-slate-400">No security findings.</p>
            ) : null}
            {snapshot.findings.map((finding: SecurityFindingView) => (
              <article
                className="border-l border-red-300/30 pl-4"
                key={finding.id}
              >
                <p className="text-xs uppercase tracking-wide text-red-200">
                  {finding.provider} · {finding.stage} · {finding.severity}
                </p>
                <p className="mt-1 text-sm text-slate-200">
                  {finding.threat_type}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {finding.action_taken}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
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
