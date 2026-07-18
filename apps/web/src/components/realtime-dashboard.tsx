"use client";

import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

import {
  DashboardHealthSchema,
  DashboardIncidentSchema,
  DashboardRawEventSchema,
  DashboardSecurityFindingSchema,
  DashboardTimelineSchema,
  type DashboardHealth,
  type DashboardIncident,
  type DashboardSecurityFinding,
  type DashboardSnapshot,
  type DashboardTimeline,
} from "../lib/dashboard-data";

type ConnectionState = "disconnected" | "live" | "reconnecting";

function upsertById<T extends { id: string }>(items: T[], next: T): T[] {
  return [next, ...items.filter((item) => item.id !== next.id)];
}

function numericPayload(
  payload: Record<string, unknown>,
  key: string,
): number | null {
  const value = payload[key];
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

function markerPosition(latitude: number, longitude: number): CSSProperties {
  const x = Math.max(3, Math.min(97, ((longitude + 98.05) / 0.7) * 100));
  const y = Math.max(3, Math.min(97, (1 - (latitude - 30.05) / 0.55) * 100));
  return { left: `${x}%`, top: `${y}%` };
}

function severityMarker(severity: number | null): string {
  if (severity === 5)
    return "bg-red-400 shadow-[0_0_22px_rgba(248,113,113,.85)]";
  if (severity === 4)
    return "bg-orange-400 shadow-[0_0_22px_rgba(251,146,60,.8)]";
  if (severity === 3)
    return "bg-amber-300 shadow-[0_0_20px_rgba(252,211,77,.75)]";
  return "bg-emerald-400 shadow-[0_0_20px_rgba(52,211,153,.7)]";
}

export function RealtimeDashboard({
  snapshot,
}: {
  snapshot: DashboardSnapshot;
}) {
  const [connection, setConnection] = useState<ConnectionState>(
    snapshot.config ? "reconnecting" : "disconnected",
  );
  const [rawEvents, setRawEvents] = useState(snapshot.rawEvents);
  const [incidents, setIncidents] = useState(snapshot.incidents);
  const [timeline, setTimeline] = useState(snapshot.timeline);
  const [health, setHealth] = useState<DashboardHealth | null>(snapshot.health);
  const [securityFindings, setSecurityFindings] = useState(
    snapshot.securityFindings,
  );
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(
    snapshot.incidents[0]?.id ?? null,
  );
  const [activityVersion, setActivityVersion] = useState(0);

  useEffect(() => {
    if (!snapshot.config) return;
    const client = createClient(snapshot.config.url, snapshot.config.anonKey);
    let channel: RealtimeChannel | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    let attempt = 0;

    const connect = () => {
      if (disposed) return;
      attempt += 1;
      channel = client
        .channel(`pulse-dashboard-${attempt}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "raw_events" },
          (payload) => {
            const parsed = DashboardRawEventSchema.safeParse(payload.new);
            if (parsed.success)
              setRawEvents((items) =>
                upsertById(items, parsed.data).slice(0, 50),
              );
          },
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "incidents" },
          (payload) => {
            const parsed = DashboardIncidentSchema.safeParse(payload.new);
            if (parsed.success)
              setIncidents((items) =>
                upsertById(items, parsed.data).slice(0, 50),
              );
          },
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "agent_timeline" },
          (payload) => {
            const parsed = DashboardTimelineSchema.safeParse(payload.new);
            if (parsed.success)
              setTimeline((items) =>
                upsertById(items, parsed.data).slice(0, 30),
              );
          },
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "agent_health" },
          (payload) => {
            const parsed = DashboardHealthSchema.safeParse(payload.new);
            if (parsed.success) setHealth(parsed.data);
          },
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "security_findings" },
          (payload) => {
            const parsed = DashboardSecurityFindingSchema.safeParse(
              payload.new,
            );
            if (parsed.success) {
              setSecurityFindings((items) =>
                upsertById(items, parsed.data).slice(0, 10),
              );
            }
          },
        );

      for (const table of ["alerts", "source_health"] as const) {
        channel = channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table },
          () => setActivityVersion((value) => value + 1),
        );
      }

      channel.subscribe((status) => {
        const statusName: string = status;
        if (statusName === "SUBSCRIBED") {
          setConnection("live");
          return;
        }
        if (
          statusName === "CHANNEL_ERROR" ||
          statusName === "TIMED_OUT" ||
          statusName === "CLOSED"
        ) {
          setConnection("reconnecting");
          if (!disposed && retryTimer === null) {
            retryTimer = setTimeout(
              () => {
                retryTimer = null;
                if (channel) void client.removeChannel(channel);
                connect();
              },
              Math.min(10_000, 1_000 * attempt),
            );
          }
        }
      });
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (channel) void client.removeChannel(channel);
    };
  }, [snapshot.config]);

  const analyzingSignals = useMemo(
    () =>
      rawEvents
        .filter((event) => event.processing_status === "analyzing")
        .map((event) => ({
          id: event.id,
          latitude: numericPayload(event.payload, "latitude"),
          longitude: numericPayload(event.payload, "longitude"),
          title:
            typeof event.payload.issue_reported === "string"
              ? event.payload.issue_reported
              : "New city event detected",
        }))
        .filter(
          (
            event,
          ): event is typeof event & { latitude: number; longitude: number } =>
            event.latitude !== null && event.longitude !== null,
        ),
    [rawEvents],
  );
  const selectedIncident = useMemo(
    () =>
      incidents.find((incident) => incident.id === selectedIncidentId) ?? null,
    [incidents, selectedIncidentId],
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Metric label="Agent" value={health?.status ?? "offline"} />
          <Metric
            label="Pending jobs"
            value={String(health?.pending_jobs ?? 0)}
          />
          <Metric label="Realtime" value={connection} />
        </div>
        <div className="relative min-h-[34rem] overflow-hidden rounded-3xl border border-white/10 bg-[#0a1715]">
          <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(94,226,180,.18)_1px,transparent_1px),linear-gradient(90deg,rgba(94,226,180,.18)_1px,transparent_1px)] [background-size:48px_48px]" />
          <div className="absolute left-6 top-6 z-10">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-300">
              Austin operations map
            </p>
            <p className="mt-2 text-sm text-slate-400">
              {incidents.length} active · {analyzingSignals.length} analyzing
            </p>
          </div>
          {analyzingSignals.map((signal) => (
            <div
              className="group absolute z-20 -translate-x-1/2 -translate-y-1/2"
              key={signal.id}
              style={markerPosition(signal.latitude, signal.longitude)}
            >
              <span className="absolute -inset-3 animate-ping rounded-full bg-amber-300/30" />
              <span className="relative block size-4 rounded-full border-2 border-amber-100 bg-amber-400 shadow-[0_0_20px_rgba(251,191,36,.8)]" />
              <span className="pointer-events-none absolute left-6 top-1/2 hidden w-52 -translate-y-1/2 rounded-xl border border-white/10 bg-slate-950/95 p-3 text-xs text-slate-200 group-hover:block">
                {signal.title} · analyzing
              </span>
            </div>
          ))}
          {incidents
            .filter(
              (
                incident,
              ): incident is DashboardIncident & {
                latitude: number;
                longitude: number;
              } => incident.latitude !== null && incident.longitude !== null,
            )
            .map((incident) => (
              <button
                aria-label={`Select ${incident.title}`}
                className="group absolute z-20 -translate-x-1/2 -translate-y-1/2"
                key={incident.id}
                onClick={() => setSelectedIncidentId(incident.id)}
                style={markerPosition(incident.latitude, incident.longitude)}
                type="button"
              >
                <span
                  className={`block size-5 rounded-full border-2 border-white ${severityMarker(incident.severity)}`}
                />
                <span className="pointer-events-none absolute left-7 top-1/2 hidden w-52 -translate-y-1/2 rounded-xl border border-white/10 bg-slate-950/95 p-3 text-xs text-slate-200 group-hover:block">
                  {incident.title} · severity {incident.severity ?? "pending"}
                </span>
              </button>
            ))}
          {selectedIncident ? (
            <article className="absolute right-6 top-6 z-30 w-[min(22rem,calc(100%-3rem))] rounded-2xl border border-white/10 bg-slate-950/90 p-5 backdrop-blur">
              <div className="flex items-center justify-between gap-4">
                <span className="text-xs uppercase tracking-wide text-emerald-200">
                  {selectedIncident.incident_type.replaceAll("_", " ")}
                </span>
                <button
                  aria-label="Close incident details"
                  className="text-slate-500 hover:text-slate-200"
                  onClick={() => setSelectedIncidentId(null)}
                  type="button"
                >
                  ×
                </button>
              </div>
              <h2 className="mt-3 font-semibold text-slate-100">
                {selectedIncident.title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                {selectedIncident.summary}
              </p>
              <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
                <span>Severity {selectedIncident.severity ?? "—"}</span>
                <span>
                  {selectedIncident.predicted_duration_minutes ?? "—"} min
                </span>
                <span>
                  {selectedIncident.confidence === null
                    ? "—"
                    : `${Math.round(selectedIncident.confidence * 100)}%`}
                </span>
              </div>
            </article>
          ) : null}
          {!snapshot.config ? (
            <div className="absolute inset-x-6 bottom-6 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-5 text-sm text-amber-100">
              Configure the public Supabase URL and anon key to activate the
              Realtime city view.
            </div>
          ) : null}
        </div>
        <div className="rounded-3xl border border-red-300/10 bg-red-300/[0.04] p-5">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-red-200">
              Runtime security
            </p>
            <span className="text-sm text-slate-400">
              {securityFindings.length} recent
            </span>
          </div>
          {securityFindings.length === 0 ? (
            <p className="text-sm text-slate-400">No threats detected.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {securityFindings
                .slice(0, 4)
                .map((finding: DashboardSecurityFinding) => (
                  <article
                    className="rounded-2xl border border-red-300/10 bg-black/10 p-4"
                    key={finding.id}
                  >
                    <p className="text-xs uppercase tracking-wide text-red-200">
                      {finding.severity} · {finding.stage}
                    </p>
                    <p className="mt-2 text-sm text-slate-100">
                      {finding.threat_type}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {finding.action_taken}
                    </p>
                  </article>
                ))}
            </div>
          )}
        </div>
      </section>

      <aside className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-300">
              Agent timeline
            </p>
            <p className="mt-2 text-xs text-slate-500">
              activity revision {activityVersion}
            </p>
          </div>
          <span
            className={`size-2 rounded-full ${connection === "live" ? "bg-emerald-300" : "bg-amber-300"}`}
          />
        </div>
        <div className="space-y-5">
          {timeline.length === 0 ? (
            <p className="text-sm text-slate-400">
              Waiting for agent activity.
            </p>
          ) : null}
          {timeline.map((entry: DashboardTimeline) => (
            <article
              className="border-l border-emerald-300/30 pl-4"
              key={entry.id}
            >
              <p className="text-xs uppercase tracking-wide text-emerald-200">
                {entry.event_type}
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-200">
                {entry.message}
              </p>
              <time className="mt-2 block text-xs text-slate-500">
                {new Date(entry.created_at).toLocaleTimeString()}
              </time>
            </article>
          ))}
        </div>
      </aside>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold capitalize text-slate-100">
        {value}
      </p>
    </div>
  );
}
