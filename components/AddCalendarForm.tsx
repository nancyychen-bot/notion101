"use client";

import { useState } from "react";

type Result =
  | { ok: true; calendar: { id: string; city: string | null } }
  | { ok: false; error: string };

export function AddCalendarForm({ webhookUrl }: { webhookUrl: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    const res = await fetch("/api/add-calendar", { method: "POST", body: new FormData(e.currentTarget) });
    setResult((await res.json()) as Result);
    setBusy(false);
  }

  const field =
    "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400";

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-3">
      <label className="block text-sm">
        <span className="text-neutral-600">Short id / location *</span>
        <input name="slug" required placeholder="e.g. korea or london" className={`mt-1 ${field}`} />
      </label>
      <label className="block text-sm">
        <span className="text-neutral-600">Luma API key *</span>
        <input name="apiKey" required placeholder="secret-… (calendar → Settings → Options → Luma API)" className={`mt-1 ${field}`} />
      </label>
      <div className="space-y-1 text-sm">
        <label className="block">
          <span className="text-neutral-600">Webhook signing secret *</span>
          <input name="webhookSecret" required placeholder="whsec-…" className={`mt-1 ${field}`} />
        </label>
        <p className="text-neutral-500">
          On that same Luma API page, add a webhook pointing to{" "}
          <code className="break-all rounded bg-neutral-100 px-1 py-0.5">{webhookUrl}</code> (subscribe to guest
          registered/updated events for live check-in), then paste the signing secret it gives you above.
        </p>
      </div>
      <label className="block text-sm">
        <span className="text-neutral-600">Luma calendar URL *</span>
        <input name="calendarUrl" required placeholder="https://luma.com/notion-korea" className={`mt-1 ${field}`} />
      </label>
      <label className="block text-sm">
        <span className="text-neutral-600">City (optional)</span>
        <input name="city" placeholder="Defaults to each event's address" className={`mt-1 ${field}`} />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {busy ? "Connecting…" : "Connect calendar"}
      </button>
      {result?.ok ? (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          Connected calendar <strong>{result.calendar.id}</strong>
          {result.calendar.city ? ` (${result.calendar.city})` : ""}. Its events will import from now on.
        </p>
      ) : null}
      {result && !result.ok ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{result.error}</p>
      ) : null}
    </form>
  );
}
