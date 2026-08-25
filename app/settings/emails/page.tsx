import { SettingsNav } from "@/components/hub/SettingsNav";
import { EmailEditor } from "@/components/hub/EmailEditor";
import { listOverrides } from "@/lib/db/email-overrides";

export const dynamic = "force-dynamic";

export default async function EmailsPage() {
  const overrides = await listOverrides();
  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <SettingsNav active="emails" />
      <h1 className="mb-1 text-xl font-semibold">Email editor</h1>
      <p className="mb-6 text-sm text-neutral-500">Edit each automated email, save a draft, then publish to go live.</p>
      <EmailEditor overrides={overrides} />
    </main>
  );
}
