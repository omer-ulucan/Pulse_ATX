"use client";

import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

import {
  DashboardHealthSchema,
  DashboardIncidentSchema,
  DashboardMissionSchema,
  DashboardMissionStepSchema,
  DashboardObservationSchema,
  DashboardRawEventSchema,
  DashboardSecurityFindingSchema,
  DashboardTimelineSchema,
  DashboardToolExecutionSchema,
  type DashboardHealth,
  type DashboardIncident,
  type DashboardSecurityFinding,
  type DashboardSnapshot,
  type DashboardTimeline,
} from "../lib/dashboard-data";
import { HeartbeatWaveform } from "./heartbeat-waveform";
import { IncidentCommanderPanel } from "./incident-commander-panel";
import { BrandLockup, OperationsNav, SystemNotice } from "./operations-shell";
import { StatStrip } from "./stat-strip";

type ConnectionState = "disconnected" | "live" | "reconnecting";

const AustinLeafletMap = dynamic(
  () =>
    import("./austin-leaflet-map").then((module) => module.AustinLeafletMap),
  {
    loading: () => (
      <div className="map-loading" role="status">
        <span className="map-loading__reticle" />
        Loading Austin basemap
      </div>
    ),
    ssr: false,
  },
);

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

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function severityBand(severity: number | null): "high" | "low" | "moderate" {
  if ((severity ?? 0) >= 4) return "high";
  if (severity === 3) return "moderate";
  return "low";
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
  const [missions, setMissions] = useState(snapshot.missions);
  const [missionSteps, setMissionSteps] = useState(snapshot.missionSteps);
  const [observations, setObservations] = useState(snapshot.observations);
  const [toolExecutions, setToolExecutions] = useState(snapshot.toolExecutions);
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
          { event: "*", schema: "public", table: "agent_missions" },
          (payload) => {
            const parsed = DashboardMissionSchema.safeParse(payload.new);
            if (parsed.success) {
              setMissions((items) =>
                upsertById(items, parsed.data).slice(0, 50),
              );
              setActivityVersion((value) => value + 1);
            }
          },
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "agent_mission_steps" },
          (payload) => {
            const parsed = DashboardMissionStepSchema.safeParse(payload.new);
            if (parsed.success) {
              setMissionSteps((items) =>
                upsertById(items, parsed.data).slice(0, 200),
              );
              setActivityVersion((value) => value + 1);
            }
          },
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "agent_observations" },
          (payload) => {
            const parsed = DashboardObservationSchema.safeParse(payload.new);
            if (parsed.success) {
              setObservations((items) =>
                upsertById(items, parsed.data).slice(0, 100),
              );
              setActivityVersion((value) => value + 1);
            }
          },
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "agent_tool_executions",
          },
          (payload) => {
            const parsed = DashboardToolExecutionSchema.safeParse(payload.new);
            if (parsed.success) {
              setToolExecutions((items) =>
                upsertById(items, parsed.data).slice(0, 100),
              );
              setActivityVersion((value) => value + 1);
            }
          },
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "incidents" },
          (payload) => {
            const parsed = DashboardIncidentSchema.safeParse(payload.new);
            if (parsed.success) {
              setIncidents((items) =>
                upsertById(items, parsed.data).slice(0, 50),
              );
              setSelectedIncidentId((selected) => selected ?? parsed.data.id);
            }
          },
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "agent_timeline" },
          (payload) => {
            const parsed = DashboardTimelineSchema.safeParse(payload.new);
            if (parsed.success)
              setTimeline((items) =>
                upsertById(items, parsed.data).slice(0, 250),
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
            if (parsed.success)
              setSecurityFindings((items) =>
                upsertById(items, parsed.data).slice(0, 10),
              );
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
      incidents.find((incident) => incident.id === selectedIncidentId) ??
      incidents[0] ??
      null,
    [incidents, selectedIncidentId],
  );
  const selectedMission = useMemo(
    () =>
      missions
        .filter((mission) => mission.incident_id === selectedIncident?.id)
        .sort((left, right) =>
          right.started_at.localeCompare(left.started_at),
        )[0] ?? null,
    [missions, selectedIncident?.id],
  );
  const sourceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of rawEvents)
      counts.set(event.source, (counts.get(event.source) ?? 0) + 1);
    return [...counts.entries()].sort((left, right) => right[1] - left[1]);
  }, [rawEvents]);
  const criticalCount = incidents.filter(
    (incident) => (incident.severity ?? 0) >= 4,
  ).length;

  return (
    <main className="command-shell">
      <header className="command-header">
        <div className="command-header__identity">
          <BrandLockup compact />
          <div>
            <span className="system-label">COMMAND CENTER / AUSTIN</span>
            <h1 className="command-header__title">Austin operating picture</h1>
          </div>
        </div>
        <HeartbeatWaveform
          eventCount={rawEvents.length}
          lastHeartbeatAt={health?.last_heartbeat_at}
          status={health?.status ?? "standing by"}
          variant="command"
        />
        <OperationsNav current="/dashboard" />
      </header>

      {snapshot.error ? (
        <SystemNotice severity="critical">{snapshot.error}</SystemNotice>
      ) : null}
      {!snapshot.config ? (
        <SystemNotice>
          Public Supabase values are not loaded. The map remains ready while the
          realtime channel waits for configuration.
        </SystemNotice>
      ) : null}

      <StatStrip
        items={[
          {
            label: "AGENT STATUS",
            state: health?.status === "healthy" ? "live" : "neutral",
            value: health?.status ?? "OFFLINE",
          },
          { label: "PENDING JOBS", value: String(health?.pending_jobs ?? 0) },
          {
            label: "REALTIME",
            state: connection === "live" ? "live" : "neutral",
            value: connection,
          },
          { label: "ACTIVE SIGNALS", value: String(incidents.length) },
          {
            label: "HIGH / CRITICAL",
            state: criticalCount > 0 ? "critical" : "neutral",
            value: String(criticalCount),
          },
        ]}
      />

      <section className="command-grid" aria-label="City operations overview">
        <div className="map-instrument">
          <div className="panel-heading panel-heading--overlay">
            <div>
              <span className="panel-kicker">GEO / ACTIVE INCIDENTS</span>
              <h2>Austin operating picture</h2>
            </div>
            <span className="panel-readout">
              {incidents.length} ACTIVE / {analyzingSignals.length} ANALYZING
            </span>
          </div>
          <AustinLeafletMap
            analyzingSignals={analyzingSignals}
            incidents={incidents}
            onSelectIncident={setSelectedIncidentId}
            selectedIncidentId={selectedIncident?.id ?? null}
          />
          <div className="map-legend" aria-label="Map severity legend">
            <LegendItem label="ANALYZING" state="analyzing" />
            <LegendItem label="LOW" state="low" />
            <LegendItem label="MODERATE" state="moderate" />
            <LegendItem label="HIGH / CRITICAL" state="high" />
          </div>
          {incidents.length === 0 && analyzingSignals.length === 0 ? (
            <div className="map-empty-state">
              <span className="map-empty-state__crosshair" aria-hidden="true" />
              <p>Markers register here when a city signal clears ingestion.</p>
            </div>
          ) : null}
        </div>

        <aside className="signal-rail" aria-label="Active incident detail">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">FOCUS / DECISION</span>
              <h2>Active signal</h2>
            </div>
            <span className="panel-readout">
              {selectedIncident
                ? `SEV ${selectedIncident.severity ?? "--"}`
                : "IDLE"}
            </span>
          </div>
          {selectedIncident ? (
            <IncidentDetail incident={selectedIncident} />
          ) : (
            <EmptySignal />
          )}
          <div className="signal-queue">
            <p className="instrument-label">SIGNAL QUEUE</p>
            {incidents.length === 0 ? (
              <div className="signal-queue__empty" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            ) : (
              incidents.slice(0, 5).map((incident) => (
                <button
                  aria-pressed={incident.id === selectedIncident?.id}
                  className="signal-queue__item"
                  key={incident.id}
                  onClick={() => setSelectedIncidentId(incident.id)}
                  type="button"
                >
                  <span
                    className={`severity-mark severity-mark--${severityBand(incident.severity)}`}
                  />
                  <span>{incident.title}</span>
                  <span>{formatTime(incident.last_updated_at)}</span>
                </button>
              ))
            )}
          </div>
        </aside>
      </section>

      <IncidentCommanderPanel
        controlUrl={snapshot.config?.controlUrl ?? null}
        executions={toolExecutions}
        incident={selectedIncident}
        mission={selectedMission}
        observations={observations}
        steps={missionSteps}
        timeline={timeline}
      />

      <section className="operations-lower-grid">
        <DispatchLog
          activityVersion={activityVersion}
          connection={connection}
          entries={timeline.slice(0, 30)}
        />
        <aside className="system-instruments">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">WORKER / INPUTS</span>
              <h2>System instruments</h2>
            </div>
            <span className="panel-readout">REV {activityVersion}</span>
          </div>
          <div className="instrument-table">
            <div className="instrument-table__row">
              <span>WORKER ID</span>
              <strong>{health?.worker_id ?? "UNASSIGNED"}</strong>
            </div>
            <div className="instrument-table__row">
              <span>LAST HEARTBEAT</span>
              <strong>
                {health ? formatTime(health.last_heartbeat_at) : "--:--:--"}
              </strong>
            </div>
            {sourceCounts.length === 0 ? (
              <div className="instrument-table__row instrument-table__row--dim">
                <span>FEED COUNTS</span>
                <strong>AWAITING EVENTS</strong>
              </div>
            ) : (
              sourceCounts.slice(0, 4).map(([source, count]) => (
                <div className="instrument-table__row" key={source}>
                  <span>{source.replaceAll("_", " ")}</span>
                  <strong>{String(count).padStart(2, "0")}</strong>
                </div>
              ))
            )}
          </div>
          <div className="security-readout">
            <div className="instrument-label">
              SECURITY CHANNEL
              <span>{securityFindings.length} RECENT</span>
            </div>
            {securityFindings.length === 0 ? (
              <p className="instrument-empty-copy">
                The detection lane will record blocked or quarantined input.
              </p>
            ) : (
              securityFindings
                .slice(0, 3)
                .map((finding) => (
                  <SecurityLine finding={finding} key={finding.id} />
                ))
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}

function DispatchLog({
  activityVersion,
  connection,
  entries,
}: {
  activityVersion: number;
  connection: ConnectionState;
  entries: DashboardTimeline[];
}) {
  return (
    <section className="dispatch-log">
      <div className="panel-heading">
        <div>
          <span className="panel-kicker">AGENT / DISPATCH</span>
          <h2>Agent timeline</h2>
        </div>
        <span className="panel-readout">
          CH {String(activityVersion).padStart(3, "0")} / {connection}
        </span>
      </div>
      {entries.length === 0 ? (
        <div className="dispatch-empty">
          <div aria-hidden="true" className="dispatch-empty__rows">
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
          <p>The next worker decision will open this dispatch channel.</p>
        </div>
      ) : (
        <ol className="dispatch-entries">
          {entries.map((entry) => (
            <li className="dispatch-entry" key={entry.id}>
              <time dateTime={entry.created_at}>
                {formatTime(entry.created_at)}
              </time>
              <span className="dispatch-entry__type">
                {entry.event_type.replaceAll("_", " ")}
              </span>
              <p>{entry.message}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function IncidentDetail({ incident }: { incident: DashboardIncident }) {
  return (
    <article className="incident-detail">
      <div className="incident-detail__status">
        <span
          className={`severity-mark severity-mark--${severityBand(incident.severity)}`}
        />
        {incident.status.replaceAll("_", " ")} /{" "}
        {incident.incident_type.replaceAll("_", " ")}
      </div>
      <h3>{incident.title}</h3>
      <p>{incident.summary}</p>
      <dl>
        <div>
          <dt>LOCATION</dt>
          <dd>{incident.location_name ?? "Austin location pending"}</dd>
        </div>
        <div>
          <dt>DURATION</dt>
          <dd>{incident.predicted_duration_minutes ?? "--"} MIN</dd>
        </div>
        <div>
          <dt>CONFIDENCE</dt>
          <dd>
            {incident.confidence === null
              ? "--"
              : `${Math.round(incident.confidence * 100)}%`}
          </dd>
        </div>
      </dl>
    </article>
  );
}

function EmptySignal() {
  return (
    <div className="incident-empty">
      <div aria-hidden="true" className="incident-empty__diagram">
        <span />
        <span />
        <span />
      </div>
      <p>The focus rail opens when an active incident reaches analysis.</p>
    </div>
  );
}

function SecurityLine({ finding }: { finding: DashboardSecurityFinding }) {
  return (
    <div className="security-line">
      <span className={finding.severity === "critical" ? "critical-text" : ""}>
        {finding.severity}
      </span>
      <p>{finding.threat_type.replaceAll("_", " ")}</p>
      <span>{finding.action_taken.replaceAll("_", " ")}</span>
    </div>
  );
}

function LegendItem({
  label,
  state,
}: {
  label: string;
  state: "analyzing" | "high" | "low" | "moderate";
}) {
  return (
    <span className="map-legend__item">
      <span className={`map-legend__mark map-legend__mark--${state}`} />
      {label}
    </span>
  );
}
