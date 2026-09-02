"use client";
import { useState } from "react";
import { EventTabs, type TabItem } from "./EventTabs";
import { volunteerSummary } from "@/lib/hub/volunteer-summary";
import type { VolunteerFeedbackRow } from "@/lib/db/volunteer-feedback";

export function VolunteersTable({
  rows, tabs, activeKey,
}: { rows: VolunteerFeedbackRow[]; tabs: TabItem[]; activeKey: string }) {
  const [q, setQ] = useState("");
  const scoped = rows.filter((r) => activeKey === "__all__" || r.luma_event_id === activeKey);
  const filtered = scoped.filter((r) => {
    if (!q.trim()) return true;
    const hay = [r.volunteer_name, r.city, r.event_name, r.what_worked, r.challenges, r.improvements, r.tracks?.join(" ")]
      .filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });
  const s = volunteerSummary(scoped);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <EventTabs tabs={tabs} basePath="/volunteers" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, comment"
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm" />
      </div>
      <div className="mb-4 flex gap-6 text-sm text-neutral-600">
        <span><b className="text-neutral-900">{s.responses}</b> responses</span>
        <span>Avg experience <b className="text-neutral-900">{s.avgExperience != null ? s.avgExperience.toFixed(1) : "—"}</b>/5</span>
        <span>Avg preparedness <b className="text-neutral-900">{s.avgPreparedness != null ? s.avgPreparedness.toFixed(1) : "—"}</b>/5</span>
      </div>
      {filtered.length === 0 ? (
        <p className="text-sm text-neutral-500">No volunteer feedback yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-neutral-50 text-left">
                {["Volunteer", "Type", "City", "Event", "Tracks", "Preparedness", "Overall", "What worked", "Challenges", "Improvements", "Submitted"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.ambassador_page_id} className="border-b align-top hover:bg-neutral-50">
                  <td className="px-3 py-2 whitespace-nowrap">{r.volunteer_name ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.volunteer_type ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.city ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.event_name ?? "—"}</td>
                  <td className="px-3 py-2 max-w-xs">{r.tracks?.length ? r.tracks.join(", ") : "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.preparedness_label ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.experience_label ?? "—"}</td>
                  <td className="px-3 py-2 max-w-xs">{r.what_worked ?? "—"}</td>
                  <td className="px-3 py-2 max-w-xs">{r.challenges ?? "—"}</td>
                  <td className="px-3 py-2 max-w-xs">{r.improvements ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.submitted_at ? r.submitted_at.slice(0, 10) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
