import Link from "next/link";

import { HeartbeatWaveform } from "../components/heartbeat-waveform";
import { BrandLockup } from "../components/operations-shell";

const capabilities = [
  ["01", "Watches Austin traffic, transit, and weather without stopping."],
  ["02", "Links disruptions that share a place and time."],
  ["03", "Uses Nemotron to classify impact and estimate duration."],
  ["04", "Learns from resolved incidents before the next decision."],
  ["05", "Blocks unsafe feed instructions before they reach the model."],
] as const;

export default function HomePage() {
  return (
    <main className="landing-shell">
      <header className="landing-header">
        <BrandLockup />
        <div className="landing-header__station">
          <span className="status-dot" aria-hidden="true" />
          AUSTIN OPERATIONS / ALWAYS ON
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-hero__copy">
          <p className="eyebrow">CITY SIGNALS / ONE OPERATING PICTURE</p>
          <h1>Austin does not wait for a dashboard refresh.</h1>
          <p className="landing-deck">
            PulseATX stays on duty, turns public city feeds into verified
            incidents, and keeps operators current as conditions change.
          </p>
          <Link className="primary-action" href="/dashboard">
            Open command center
            <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="landing-hero__instrument">
          <HeartbeatWaveform
            eventCount={3}
            status="monitoring"
            variant="hero"
          />
          <div className="landing-coordinates">
            <span>30.2672° N</span>
            <span>97.7431° W</span>
            <span>TRAVIS COUNTY</span>
          </div>
        </div>
      </section>

      <section
        className="capability-ledger"
        aria-labelledby="capabilities-title"
      >
        <div className="capability-ledger__intro">
          <p className="eyebrow">ON EVERY HEARTBEAT</p>
          <h2 id="capabilities-title">What the system does</h2>
        </div>
        <ol>
          {capabilities.map(([number, capability]) => (
            <li key={number}>
              <span>{number}</span>
              <p>{capability}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
