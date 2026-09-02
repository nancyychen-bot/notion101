"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function RefreshButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading">("idle");
  async function refresh() {
    setState("loading");
    try {
      await fetch("/api/feedback-import", { method: "POST" });
      router.refresh();
    } finally {
      setState("idle");
    }
  }
  return (
    <button
      onClick={refresh}
      disabled={state === "loading"}
      className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
    >
      {state === "loading" ? "Refreshing…" : "Refresh"}
    </button>
  );
}
