"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function RefreshButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  async function refresh() {
    setState("loading");
    try {
      const res = await fetch("/api/feedback-import", { method: "POST" });
      if (!res.ok) {
        setState("error");
        return;
      }
      setState("idle");
      router.refresh();
    } catch {
      setState("error");
    }
  }
  return (
    <span className="flex items-center gap-2">
      <button
        onClick={refresh}
        disabled={state === "loading"}
        className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
      >
        {state === "loading" ? "Refreshing…" : "Refresh"}
      </button>
      {state === "error" && <span className="text-xs text-red-600">Refresh failed</span>}
    </span>
  );
}
