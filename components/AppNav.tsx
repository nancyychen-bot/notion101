import { RefreshButton } from "./RefreshButton";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/feedback", label: "Feedback" },
  { href: "/volunteers", label: "Volunteers" },
  { href: "/settings/emails", label: "Settings" },
];

export function AppNav() {
  return (
    <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold">Notion 101</h1>
        <nav className="flex gap-3 text-sm">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="text-neutral-600 hover:text-neutral-900">
              {l.label}
            </a>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-2">
        <a href="/add-event" className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
          + Add event
        </a>
        <RefreshButton />
      </div>
    </div>
  );
}
