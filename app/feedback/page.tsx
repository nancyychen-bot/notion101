import { AppNav } from "@/components/AppNav";
import { FeedbackTable } from "@/components/FeedbackTable";
import { listFeedbackWithEvents } from "@/lib/db/feedback";
import { eventSummaries } from "@/lib/db/dashboard";
import { eventLabel } from "@/lib/hub/format";
import type { TabItem } from "@/components/EventTabs";

export const dynamic = "force-dynamic";

export default async function FeedbackPage({ searchParams }: { searchParams: { event?: string } }) {
  const [rows, events] = await Promise.all([listFeedbackWithEvents(), eventSummaries()]);
  const tabs: TabItem[] = [
    { key: "__all__", label: "All events" },
    ...events.map((e) => ({ key: e.luma_event_id, label: eventLabel(e.location, e.start_at, e.timezone) })),
  ];
  const activeKey = searchParams.event ?? "__all__";
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <AppNav />
      <p className="mb-4 text-sm text-neutral-500">Post-event feedback, matched to its Notion 101 event.</p>
      <FeedbackTable rows={rows} tabs={tabs} activeKey={activeKey} />
    </div>
  );
}
