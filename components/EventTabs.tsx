"use client";
import { useRouter, useSearchParams } from "next/navigation";

export interface TabItem {
  key: string; // luma_event_id or "__all__"
  label: string;
}

export function EventTabs({ tabs, basePath }: { tabs: TabItem[]; basePath: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const active = params.get("event") ?? "__all__";
  function go(key: string) {
    const qs = key === "__all__" ? "" : `?event=${encodeURIComponent(key)}`;
    router.push(`${basePath}${qs}`);
  }
  return (
    <div className="mb-6 flex flex-wrap gap-2">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => go(t.key)}
          className={`rounded-full px-3 py-1 text-sm ${
            active === t.key ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
