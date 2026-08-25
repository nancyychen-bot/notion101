import type { EmailLogRow } from "@/lib/db/email-log";

function fmt(v: string | null | undefined): string {
  if (!v) return "—";
  try { return new Date(v).toLocaleString(); } catch { return v; }
}

export function EmailLog({ rows }: { rows: EmailLogRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-neutral-500">No emails match these filters.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-neutral-50 text-left">
            <th className="px-3 py-2 font-medium">Kind</th>
            <th className="px-3 py-2 font-medium">Recipient</th>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Event</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Sent at</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b hover:bg-neutral-50">
              <td className="px-3 py-2">{r.kind}</td>
              <td className="px-3 py-2">{r.recipient_email}</td>
              <td className="px-3 py-2">{r.guest_name ?? "—"}</td>
              <td className="px-3 py-2">{r.event_name ?? "—"}</td>
              <td className="px-3 py-2">{r.status}</td>
              <td className="px-3 py-2 whitespace-nowrap">{fmt(r.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
