import { eventSummaries, recentEmailLog, recentSyncLog } from "@/lib/db/dashboard";
import { Dashboard } from "@/components/Dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [events, emails, syncs] = await Promise.all([
    eventSummaries(), recentEmailLog(), recentSyncLog(),
  ]);
  return <Dashboard events={events} emails={emails} syncs={syncs} />;
}
