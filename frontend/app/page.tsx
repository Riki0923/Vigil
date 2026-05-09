import { loadAlerts } from "@/lib/load-alerts";
import { Dashboard } from "./components/Dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { alerts, source, updatedAt } = await loadAlerts();
  return <Dashboard allAlerts={alerts} source={source} updatedAt={updatedAt} />;
}
