export interface HeartbeatWaveformProps {
  eventCount?: number;
  lastHeartbeatAt?: string | null | undefined;
  status?: string;
  variant?: "command" | "hero";
}

const waveformPath =
  "M0 52 L38 52 L48 50 L56 54 L66 52 L104 52 L114 50 L124 52 L136 52 L145 16 L155 86 L165 38 L176 52 L226 52 L236 50 L246 53 L282 52 L292 49 L302 52 L328 52 L338 24 L348 76 L359 42 L370 52 L420 52 L432 50 L442 53 L478 52 L488 48 L498 52 L520 52";

function heartbeatReadout(lastHeartbeatAt: string | null | undefined): string {
  if (!lastHeartbeatAt) return "--:--:--";
  return new Date(lastHeartbeatAt).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function HeartbeatWaveform({
  eventCount = 0,
  lastHeartbeatAt,
  status = "standing by",
  variant = "hero",
}: HeartbeatWaveformProps) {
  const isLive = status === "healthy" || status === "live";
  const isEmpty = eventCount === 0 && !lastHeartbeatAt;
  const renderedPath = isEmpty ? "M0 52H520" : waveformPath;
  return (
    <section
      aria-label="Agent heartbeat"
      className={`heartbeat heartbeat--${variant}`}
    >
      <div className="heartbeat__plot">
        <div className="instrument-heading">
          <span>WORKER HEARTBEAT</span>
          <span className="instrument-heading__rule" />
          <span>{isLive ? "LIVE" : "STANDBY"}</span>
        </div>
        <svg
          aria-labelledby={`heartbeat-title-${variant}`}
          className="heartbeat__svg"
          role="img"
          viewBox="0 0 520 104"
        >
          <title id={`heartbeat-title-${variant}`}>
            PulseATX worker heartbeat waveform
          </title>
          <g className="heartbeat__grid">
            <path d="M0 26H520 M0 52H520 M0 78H520" />
            <path d="M104 0V104 M208 0V104 M312 0V104 M416 0V104" />
          </g>
          <path className="heartbeat__ghost" d={renderedPath} />
          <path
            className={`heartbeat__line ${isEmpty ? "heartbeat__line--empty" : ""}`}
            d={renderedPath}
          />
          {!isEmpty ? (
            <g className="heartbeat__ticks">
              <path d="M145 6V17" />
              <path d="M338 14V25" />
              <path d="M488 38V49" />
            </g>
          ) : null}
        </svg>
      </div>
      <dl className="heartbeat__readout">
        <div>
          <dt>LAST BEAT</dt>
          <dd>{heartbeatReadout(lastHeartbeatAt)}</dd>
        </div>
        <div>
          <dt>STATE</dt>
          <dd className={isLive ? "signal-text" : undefined}>{status}</dd>
        </div>
        <div>
          <dt>EVENTS</dt>
          <dd>{String(eventCount).padStart(2, "0")}</dd>
        </div>
      </dl>
    </section>
  );
}
