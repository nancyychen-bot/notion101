import { SyncButton } from "./SyncButton";

// ── Row types ────────────────────────────────────────────────────────────────

export interface EventRow {
  id: string;
  luma_event_id: string;
  name: string | null;
  start_at: string | null;
  pending: number;
  approved: number;
  declined: number;
  waitlist: number;
  checked_in: number;
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

// ── Props ────────────────────────────────────────────────────────────────────

interface DashboardProps {
  events: EventRow[];
  emails: EmailRow[];
  syncs: SyncRow[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

// ── Main Dashboard component (server) ────────────────────────────────────────

export function Dashboard({ events, emails, syncs }: DashboardProps) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Notion 101</h1>
        <a
          href="/add-event"
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Track an event
        </a>
      </div>

      {/* ── Events ── */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold">Events</h2>
        {events.length === 0 ? (
          <p className="text-sm text-neutral-500">No events tracked yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-neutral-50 text-left">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Start</th>
                  <th className="px-3 py-2 font-medium text-center">Pending</th>
                  <th className="px-3 py-2 font-medium text-center">Approved</th>
                  <th className="px-3 py-2 font-medium text-center">Declined</th>
                  <th className="px-3 py-2 font-medium text-center">Waitlist</th>
                  <th className="px-3 py-2 font-medium text-center">Checked-in</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-b hover:bg-neutral-50">
                    <td className="px-3 py-2">{e.name ?? "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmt(e.start_at)}</td>
                    <td className="px-3 py-2 text-center">{e.pending}</td>
                    <td className="px-3 py-2 text-center">{e.approved}</td>
                    <td className="px-3 py-2 text-center">{e.declined}</td>
                    <td className="px-3 py-2 text-center">{e.waitlist}</td>
                    <td className="px-3 py-2 text-center">{e.checked_in}</td>
                    <td className="px-3 py-2">
                      <SyncButton lumaEventId={e.luma_event_id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Recent emails ── */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold">Recent Emails</h2>
        {emails.length === 0 ? (
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
                {emails.map((e, i) => (
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
      <section>
        <h2 className="mb-3 text-lg font-semibold">Recent Sync Log</h2>
        {syncs.length === 0 ? (
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
                {syncs.map((s, i) => (
                  <tr key={i} className="border-b hover:bg-neutral-50">
                    <td className="px-3 py-2">{s.direction}</td>
                    <td className="px-3 py-2">{s.action}</td>
                    <td className="px-3 py-2">{s.result}</td>
                    <td className="px-3 py-2 max-w-xs truncate" title={s.note ?? undefined}>
                      {s.note ?? "—"}
                    </td>
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
