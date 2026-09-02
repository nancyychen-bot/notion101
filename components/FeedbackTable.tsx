"use client";
import { useState } from "react";
import { EventTabs, type TabItem } from "./EventTabs";
import type { FeedbackWithEvent } from "@/lib/db/feedback";

export function FeedbackTable({
  rows, tabs, activeKey,
}: { rows: FeedbackWithEvent[]; tabs: TabItem[]; activeKey: string }) {
  const [q, setQ] = useState("");
  const filtered = rows.filter((r) => {
    if (activeKey !== "__all__" && r.luma_event_id !== activeKey) return false;
    if (!q.trim()) return true;
    const hay = [r.respondent_name, r.event_name, r.highlight, r.feature_intent, r.interests?.join(" ")]
      .filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <EventTabs tabs={tabs} basePath="/feedback" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, comment"
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm"
        />
      </div>
      {filtered.length === 0 ? (
        <p className="text-sm text-neutral-500">No feedback yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-neutral-50 text-left">
                {["Name", "Event", "Satisfaction", "Confidence", "Interests", "Will try", "Highlight / improve", "Submitted"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.notion_page_id} className="border-b align-top hover:bg-neutral-50">
                  <td className="px-3 py-2 whitespace-nowrap">{r.respondent_name ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.event_name ?? "—"}</td>
                  <td className="px-3 py-2">{r.satisfaction_score != null ? `${r.satisfaction_score}/5` : "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.confidence ?? "—"}</td>
                  <td className="px-3 py-2 max-w-xs">{r.interests?.length ? r.interests.join(", ") : "—"}</td>
                  <td className="px-3 py-2 max-w-xs">{r.feature_intent ?? "—"}</td>
                  <td className="px-3 py-2 max-w-md">{r.highlight ?? "—"}</td>
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
