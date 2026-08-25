import { headers } from "next/headers";
import { env } from "@/lib/env";
import { issueFormToken } from "@/lib/auth/form-token";
import { AddEventForm } from "@/components/AddEventForm";

// Allow embedding inside a Notion page (iframe). We deliberately do NOT set
// X-Frame-Options; frame-ancestors in next.config is the modern, granular control.
export const metadata = { title: "Track a Notion 101 event" };

export default async function AddEventPage() {
  await headers(); // opt out of static rendering so the token is freshly minted
  const token = await issueFormToken(env.dashboard.sessionSecret(), Date.now());
  return (
    <main className="mx-auto w-full max-w-lg px-6 py-10">
      <h1 className="text-lg font-semibold">Track a Notion 101 event</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Paste the Luma event link. We&apos;ll pull its details and import registered guests into
        the database and Notion.
      </p>
      <AddEventForm token={token} />
    </main>
  );
}
