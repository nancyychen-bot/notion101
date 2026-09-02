import {
  eventSummaries, feedbackForResults, checkedInAttendees, recentEmailLog, recentSyncLog,
} from "@/lib/db/dashboard";
import { computeResults, computeCommunity } from "@/lib/hub/results";
import { eventLabel } from "@/lib/hub/format";
import { Dashboard, type DashboardData } from "@/components/Dashboard";
import type { TabItem } from "@/components/EventTabs";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: { event?: string } }) {
  const [events, feedback, attendees, emails, syncs] = await Promise.all([
    eventSummaries(), feedbackForResults(), checkedInAttendees(), recentEmailLog(), recentSyncLog(),
  ]);
  const { overall, perEvent, unattributed } = computeResults(events, feedback);
  const community = computeCommunity(attendees);

  const tabs: TabItem[] = [
    { key: "__all__", label: "All events" },
    ...events.map((e) => ({ key: e.luma_event_id, label: eventLabel(e.location, e.start_at, e.timezone) })),
  ];

  const activeKey = searchParams.event ?? "__all__";
  const result = activeKey === "__all__"
    ? overall
    : perEvent.find((r) => r.key === activeKey) ?? overall;

  const data: DashboardData = {
    tabs,
    activeKey,
    result,
    community,
    syncEventId: activeKey === "__all__" ? null : activeKey,
    unattributed,
    emails: emails as DashboardData["emails"],
    syncs: syncs as DashboardData["syncs"],
  };
  return <Dashboard data={data} />;
}
