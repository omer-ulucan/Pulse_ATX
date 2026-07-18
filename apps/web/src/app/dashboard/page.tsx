import Link from "next/link";

import { RealtimeDashboard } from "../../components/realtime-dashboard";
import { getDashboardSnapshot } from "../../lib/dashboard-data";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const snapshot = await getDashboardSnapshot();
  return (
    <main className="mx-auto min-h-screen max-w-[90rem] px-5 py-8 sm:px-8">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-emerald-300">
            PulseATX command center
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
            Austin, right now.
          </h1>
        </div>
        <nav className="flex gap-5 text-sm text-slate-300">
          <Link className="hover:text-emerald-200" href="/security">
            Security
          </Link>
          <Link className="hover:text-emerald-200" href="/learning">
            Learning
          </Link>
          <Link className="hover:text-emerald-200" href="/live">
            Raw events
          </Link>
          <Link className="hover:text-emerald-200" href="/">
            Overview
          </Link>
        </nav>
      </header>
      {snapshot.error ? (
        <p className="mb-5 rounded-2xl border border-red-300/20 bg-red-300/10 p-4 text-sm text-red-100">
          {snapshot.error}
        </p>
      ) : null}
      <RealtimeDashboard snapshot={snapshot} />
    </main>
  );
}
