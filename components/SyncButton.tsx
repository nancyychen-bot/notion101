"use client";

import { useState } from "react";

export function SyncButton({ lumaEventId }: { lumaEventId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [msg, setMsg] = useState<string>("");

  async function handleSync() {
    setState("loading");
    setMsg("");
    try {
      const res = await fetch("/api/sync-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lumaEventId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setState("error");
        setMsg(data.error ?? `HTTP ${res.status}`);
      } else {
        setState("done");
        setMsg(`Synced ${data.guestsImported ?? 0} guests`);
      }
    } catch (err) {
      setState("error");
      setMsg(err instanceof Error ? err.message : "Network error");
    }
  }

  return (
    <span className="flex items-center gap-2">
      <button
        onClick={handleSync}
        disabled={state === "loading"}
        className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {state === "loading" ? "Syncing…" : "Sync now"}
      </button>
      {msg && (
        <span className={`text-xs ${state === "error" ? "text-red-600" : "text-green-700"}`}>
          {msg}
        </span>
      )}
    </span>
  );
}
