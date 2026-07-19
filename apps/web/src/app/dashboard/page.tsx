import { RealtimeDashboard } from "../../components/realtime-dashboard";
import { getDashboardSnapshot } from "../../lib/dashboard-data";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const snapshot = await getDashboardSnapshot();
  return <RealtimeDashboard snapshot={snapshot} />;
}
