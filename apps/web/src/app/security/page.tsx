import { PageShell, SystemNotice } from "../../components/operations-shell";
import { SecurityConsole } from "../../components/security-console";
import { getSecuritySnapshot } from "../../lib/security-data";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const snapshot = await getSecuritySnapshot();
  return (
    <PageShell
      current="/security"
      description="Every model interaction is inspected, and every runtime action remains inside an explicit policy boundary."
      eyebrow="TRUST PIPELINE / DETECT TO ENFORCE"
      title="Security operations"
    >
      {!snapshot.configured ? (
        <SystemNotice>
          Public Supabase values are not loaded. Detection and enforcement lanes
          remain staged for the first security event.
        </SystemNotice>
      ) : null}
      {snapshot.error ? (
        <SystemNotice severity="critical">{snapshot.error}</SystemNotice>
      ) : null}
      <SecurityConsole snapshot={snapshot} />
    </PageShell>
  );
}
