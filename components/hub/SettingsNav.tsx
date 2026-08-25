import Link from "next/link";

export function SettingsNav({ active }: { active: "emails" | "log" }) {
  const tab = (href: string, key: string, label: string) => (
    <Link href={href} className={`rounded-md px-3 py-1.5 text-sm ${active === key ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}>{label}</Link>
  );
  return (
    <div className="mb-6 flex items-center gap-2">
      <Link href="/" className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100">← Dashboard</Link>
      <span className="text-neutral-300">|</span>
      {tab("/settings/emails", "emails", "Email editor")}
      {tab("/settings/emails/log", "log", "Sent log")}
    </div>
  );
}
