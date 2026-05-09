import { loadAlerts } from "@/lib/load-alerts";
import { fetchAgentIdentity, fetchTargetReputations } from "@/lib/ens";
import { Dashboard } from "./components/Dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { alerts, source, updatedAt } = await loadAlerts();

  const proxyNames = alerts
    .map((a) => a.proxyName)
    .filter((n): n is string => typeof n === "string" && n.length > 0);

  const [agentIdentity, targetReputations] = await Promise.all([
    fetchAgentIdentity().catch(() => null),
    fetchTargetReputations(proxyNames).catch(() => ({})),
  ]);

  return (
    <Dashboard
      allAlerts={alerts}
      source={source}
      updatedAt={updatedAt}
      agentIdentity={agentIdentity}
      targetReputations={targetReputations}
    />
  );
}
