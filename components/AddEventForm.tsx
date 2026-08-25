"use client";

import { useState } from "react";

type Result =
  | { ok: true; eventName: string; lumaEventId: string; guestsImported: number }
  | { ok: false; error: string };

export function AddEventForm({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    const form = e.currentTarget;
    const lumaLink = (form.elements.namedItem("lumaLink") as HTMLInputElement).value;
    const res = await fetch("/api/add-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lumaLink, token }),
    });
    const data = (await res.json()) as { eventName?: string; lumaEventId?: string; guestsImported?: number; error?: string };
    if (res.ok && data.eventName != null) {
      setResult({ ok: true, eventName: data.eventName, lumaEventId: data.lumaEventId ?? "", guestsImported: data.guestsImported ?? 0 });
    } else {
      setResult({ ok: false, error: data.error ?? "Unknown error" });
    }
    setBusy(false);
  }

  const field =
    "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400";

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-3">
      <label className="block text-sm">
        <span className="text-neutral-600">Luma event URL *</span>
        <input
          name="lumaLink"
          required
          placeholder="https://lu.ma/..."
          className={`mt-1 ${field}`}
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {busy ? "Adding…" : "Add event"}
      </button>
      {result?.ok ? (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          Added <strong>{result.eventName}</strong>
          {result.guestsImported > 0
            ? ` — ${result.guestsImported} guest${result.guestsImported === 1 ? "" : "s"} imported`
            : ""}
          .
        </p>
      ) : null}
      {result && !result.ok ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{result.error}</p>
      ) : null}
    </form>
  );
}
