import type { ReactNode } from "react";
import { AppNav } from "./AppNav";
import { EventTabs, type TabItem } from "./EventTabs";
import { SyncButton } from "./SyncButton";
import type { EventResult, Community } from "@/lib/hub/results";

function pct(n: number): string { return `${Math.round(n * 100)}%`; }

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-200 p-4">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">{title}</h3>
      {children}
    </section>
  );
}
function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-neutral-500">{label}</div>
    </div>
  );
}

export interface EmailRow {
  kind: string;
  recipient_email: string;
  status: string;
  created_at: string;
  name: string | null;
}
export interface SyncRow {
  direction: string;
  action: string;
  result: string;
  note: string | null;
  created_at: string;
}

function fmt(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export interface DashboardData {
  tabs: TabItem[];
  activeKey: string;
  result: EventResult;
  community: Community;
  syncEventId: string | null;
  unattributed: number;
  emails: EmailRow[];
  syncs: SyncRow[];
}

export function Dashboard({ data }: { data: DashboardData }) {
  const r = data.result;
  const stars = [5, 4, 3, 2, 1] as const;
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <AppNav />
      <EventTabs tabs={data.tabs} basePath="/" />

      {data.unattributed > 0 && (
        <p className="mb-4 text-xs text-amber-700">
          {data.unattributed} feedback response{data.unattributed === 1 ? "" : "s"} not yet matched to an event —{" "}
          <a href="/feedback" className="underline">see Feedback</a> (shown there under “All events”).
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Attendance">
          <div className="grid grid-cols-3 gap-4">
            <Stat value={r.registered} label="Registered" />
            <Stat value={r.approved} label="Approved" />
            <Stat value={r.checkedIn} label="Checked in" />
            <Stat value={r.noShow} label="No-shows" />
            <Stat value={r.waitlist} label="Waitlist" />
            <Stat value={pct(r.attendanceRate)} label="Attendance" />
          </div>
          {data.syncEventId && (
            <div className="mt-3"><SyncButton lumaEventId={data.syncEventId} /></div>
          )}
        </Card>

        <Card title="Satisfaction">
          <div className="mb-3 grid grid-cols-3 gap-4">
            <Stat value={r.responses} label="Responses" />
            <Stat value={pct(r.responseRate)} label="Response rate" />
            <Stat value={r.avgSatisfaction != null ? r.avgSatisfaction.toFixed(1) : "—"} label="Avg / 5" />
          </div>
          <div className="space-y-1">
            {stars.map((s) => (
              <div key={s} className="flex items-center gap-2 text-xs">
                <span className="w-8 text-neutral-500">{s} ★</span>
                <span className="tabular-nums">{r.satisfactionDist[s]}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Confidence lift">
          <div className="mb-2 text-sm">
            {r.pctMoreConfident != null ? `${pct(r.pctMoreConfident)} left more confident` : "No responses yet"}
          </div>
          <div className="grid grid-cols-4 gap-2 text-xs text-neutral-600">
            <Stat value={r.confidence.muchMore} label="Much more" />
            <Stat value={r.confidence.somewhatMore} label="Somewhat" />
            <Stat value={r.confidence.same} label="Same" />
            <Stat value={r.confidence.less} label="Less" />
          </div>
        </Card>

        <Card title="Interested in">
          {r.interests.length === 0 ? (
            <p className="text-sm text-neutral-500">No responses yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {r.interests.map((i) => (
                <li key={i.label} className="flex justify-between">
                  <span>{i.label}</span>
                  <span className="tabular-nums text-neutral-500">{i.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <section className="mt-4">
        <Card title="Community — repeat attendance">
          <div className="grid grid-cols-3 gap-4">
            <Stat value={data.community.uniqueAttendees} label="Unique attendees" />
            <Stat value={data.community.repeatAttendees} label="Repeat attendees" />
            <Stat value={pct(data.community.repeatRate)} label="Repeat rate" />
          </div>
        </Card>
      </section>

      {/* ── Recent emails ── */}
      <section className="mt-10">
        <h2 className="mb-3 text-lg font-semibold">Recent Emails</h2>
        {data.emails.length === 0 ? (
          <p className="text-sm text-neutral-500">No emails sent yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-neutral-50 text-left">
                  <th className="px-3 py-2 font-medium">Kind</th>
                  <th className="px-3 py-2 font-medium">Recipient</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Sent at</th>
                </tr>
              </thead>
              <tbody>
                {data.emails.map((e, i) => (
                  <tr key={i} className="border-b hover:bg-neutral-50">
                    <td className="px-3 py-2">{e.kind}</td>
                    <td className="px-3 py-2">{e.recipient_email}</td>
                    <td className="px-3 py-2">{e.name ?? "—"}</td>
                    <td className="px-3 py-2">{e.status}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmt(e.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Recent sync log ── */}
      <section className="mt-10">
        <h2 className="mb-3 text-lg font-semibold">Recent Sync Log</h2>
        {data.syncs.length === 0 ? (
          <p className="text-sm text-neutral-500">No sync events recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-neutral-50 text-left">
                  <th className="px-3 py-2 font-medium">Direction</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">Result</th>
                  <th className="px-3 py-2 font-medium">Note</th>
                  <th className="px-3 py-2 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {data.syncs.map((s, i) => (
                  <tr key={i} className="border-b hover:bg-neutral-50">
                    <td className="px-3 py-2">{s.direction}</td>
                    <td className="px-3 py-2">{s.action}</td>
                    <td className="px-3 py-2">{s.result}</td>
                    <td className="px-3 py-2 max-w-xs truncate" title={s.note ?? undefined}>{s.note ?? "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmt(s.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
