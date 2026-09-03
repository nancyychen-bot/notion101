"use client";

import { useState } from "react";

type Result =
  | { ok: true; eventName: string; lumaEventId: string; guestsImported: number }
  | { ok: false; needsCalendar?: boolean; error: string };

export function AddEventForm({ token, webhookUrl }: { token: string; webhookUrl: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [needsCalendar, setNeedsCalendar] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    const form = e.currentTarget;
    const val = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | null)?.value.trim() || undefined;
    const res = await fetch("/api/add-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        lumaLink: val("lumaLink"),
        calendarApiKey: val("calendarApiKey"),
        calendarWebhookSecret: val("calendarWebhookSecret"),
        calendarUrl: val("calendarUrl"),
        calendarSlug: val("calendarSlug"),
      }),
    });
    const data = (await res.json()) as Result & { eventName?: string };
    setResult(data);
    if (!data.ok && data.needsCalendar) setNeedsCalendar(true);
    setBusy(false);
  }

  const field =
    "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400";

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-3">
      <label className="block text-sm">
        <span className="text-neutral-600">Luma event URL *</span>
        <input name="lumaLink" required placeholder="https://lu.ma/..." className={`mt-1 ${field}`} />
      </label>

      {needsCalendar ? (
        <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
          <p className="font-medium text-amber-900">Connect this Luma calendar (one-time)</p>
          <p className="text-amber-800">
            We don&apos;t have an API key for this event&apos;s calendar yet. In Luma, open the calendar →{" "}
            <strong>Settings → Options → Luma API</strong>, copy the <code>secret-…</code> key, and paste it below.
          </p>
          <p className="text-amber-800">
            <strong>Live guest sync:</strong> on that same Luma API page, add a webhook pointing to{" "}
            <code className="break-all rounded bg-amber-100 px-1 py-0.5">{webhookUrl}</code>, then paste the signing
            secret it gives you into the field below.
          </p>
          <p className="font-semibold text-amber-900">Ask Nancy Chen to help you if you&apos;re stuck here.</p>
          <input name="calendarApiKey" placeholder="secret-… (Luma API key)" className={field} />
          <input name="calendarWebhookSecret" placeholder="Webhook signing secret" className={field} />
          <input name="calendarUrl" placeholder="Luma calendar URL (e.g. https://luma.com/notion-korea)" className={field} />
          <input name="calendarSlug" placeholder="Short id / location (e.g. london or korea)" className={field} />
        </div>
      ) : null}

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
