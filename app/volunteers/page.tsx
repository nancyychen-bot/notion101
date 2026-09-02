import { AppNav } from "@/components/AppNav";
import { VolunteersTable } from "@/components/VolunteersTable";
import { listVolunteerFeedback } from "@/lib/db/volunteer-feedback";
import { eventSummaries } from "@/lib/db/dashboard";
import { eventLabel } from "@/lib/hub/format";
import type { TabItem } from "@/components/EventTabs";

export const dynamic = "force-dynamic";

export default async function VolunteersPage({ searchParams }: { searchParams: { event?: string } }) {
  const [rows, events] = await Promise.all([listVolunteerFeedback(), eventSummaries()]);
  const tabs: TabItem[] = [
    { key: "__all__", label: "All events" },
    ...events.map((e) => ({ key: e.luma_event_id, label: eventLabel(e.location, e.start_at, e.timezone) })),
  ];
  const activeKey = searchParams.event ?? "__all__";
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <AppNav />
      <p className="mb-4 text-sm text-neutral-500">Volunteer (ambassador / Notino / partner) feedback, mirrored from the Ambassador workspace.</p>
      <VolunteersTable rows={rows} tabs={tabs} activeKey={activeKey} />
    </div>
  );
}
