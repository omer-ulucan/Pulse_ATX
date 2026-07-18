import Link from "next/link";

import { SecurityConsole } from "../../components/security-console";
import { getSecuritySnapshot } from "../../lib/security-data";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const snapshot = await getSecuritySnapshot();
  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 py-12">
      <header className="mb-10 flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-red-200">
            Runtime trust center
          </p>
          <h1 className="mt-3 text-4xl font-semibold">
            Security and approvals
          </h1>
        </div>
        <nav className="flex gap-5 text-sm text-slate-300">
          <Link className="hover:text-emerald-200" href="/dashboard">
            Command center
          </Link>
          <Link className="hover:text-emerald-200" href="/learning">
            Learning
          </Link>
        </nav>
      </header>
      {!snapshot.configured ? (
        <p className="mb-6 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-5 text-amber-100">
          Configure public Supabase values to display findings and approvals.
        </p>
      ) : null}
      {snapshot.error ? (
        <p className="mb-6 rounded-2xl border border-red-300/20 bg-red-300/10 p-5 text-red-100">
          {snapshot.error}
        </p>
      ) : null}
      <SecurityConsole snapshot={snapshot} />
    </main>
  );
}
