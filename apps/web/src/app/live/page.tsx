import { PageShell, SystemNotice } from "../../components/operations-shell";
import { getLiveEvents } from "../../lib/live-events";

export const dynamic = "force-dynamic";

function payloadTitle(payload: Record<string, unknown>): string {
  const issue = payload.issue_reported;
  return typeof issue === "string" ? issue : "City signal received";
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default async function LiveEventsPage() {
  const result = await getLiveEvents();

  return (
    <PageShell
      current="/live"
      description="The ingestion ledger shows what arrived, where it came from, and whether the worker has claimed it for analysis."
      eyebrow="PUBLIC FEEDS / INGESTION LEDGER"
      title="Raw city events"
    >
      {!result.configured ? (
        <SystemNotice>
          Public Supabase values are not loaded. The ledger remains staged for
          the next accepted Austin feed revision.
        </SystemNotice>
      ) : null}
      {result.error ? (
        <SystemNotice severity="critical">{result.error}</SystemNotice>
      ) : null}

      <section className="event-ledger">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker">RAW EVENTS / LATEST FIRST</span>
            <h2>Accepted feed revisions</h2>
          </div>
          <span className="panel-readout">{result.events.length} ROWS</span>
        </div>
        <div className="event-table-wrap">
          <table className="event-table">
            <thead>
              <tr>
                <th>TIME</th>
                <th>SOURCE</th>
                <th>EVENT</th>
                <th>STATE</th>
                <th>REV</th>
                <th>EXTERNAL ID</th>
              </tr>
            </thead>
            <tbody>
              {result.events.map((event) => (
                <tr key={event.id}>
                  <td>
                    <time dateTime={event.first_seen_at}>
                      {formatTime(event.first_seen_at)}
                    </time>
                  </td>
                  <td className="data-text">
                    {event.source.replaceAll("_", " ")}
                  </td>
                  <td>{payloadTitle(event.payload)}</td>
                  <td>
                    <span
                      className={
                        event.processing_status === "analyzing"
                          ? "event-state event-state--live"
                          : "event-state"
                      }
                    >
                      {event.processing_status.replaceAll("_", " ")}
                    </span>
                  </td>
                  <td>{String(event.revision).padStart(2, "0")}</td>
                  <td>{event.external_id}</td>
                </tr>
              ))}
              {result.events.length === 0 ? (
                <tr className="event-table__empty-row">
                  <td>--:--:--</td>
                  <td>FEED</td>
                  <td colSpan={2}>
                    <span />
                  </td>
                  <td>--</td>
                  <td>AWAITING EVENT</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {result.events.length === 0 ? (
          <p className="ledger-empty-copy">
            The first accepted feed revision will open this ingestion ledger.
          </p>
        ) : null}
      </section>
    </PageShell>
  );
}
