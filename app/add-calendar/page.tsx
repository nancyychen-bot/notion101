import { env } from "@/lib/env";
import { AddCalendarForm } from "@/components/AddCalendarForm";

export const metadata = { title: "Connect a Luma calendar" };

// Render per-request so the shown webhook URL reflects the deployment's
// APP_BASE_URL at runtime, not whatever was set at build time.
export const dynamic = "force-dynamic";

export default function AddCalendarPage() {
  const webhookUrl = `${env.app.baseUrl()}/api/webhooks/luma`;
  return (
    <main className="mx-auto w-full max-w-lg px-6 py-10">
      <h1 className="text-lg font-semibold">Connect a Luma calendar</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Pre-register a region&apos;s Luma calendar so its events import and sync automatically. You&apos;ll
        need that calendar&apos;s Luma API key and a webhook signing secret.
      </p>
      <AddCalendarForm webhookUrl={webhookUrl} />
    </main>
  );
}
