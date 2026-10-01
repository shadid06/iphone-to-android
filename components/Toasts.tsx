"use client";

import { useStore } from "@/lib/store";
import { Icon } from "./icons";

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`anim-pop glass flex max-w-md items-center gap-2.5 rounded-2xl px-4 py-3 text-sm font-medium ${t.tone === "error" ? "text-danger" : ""}`}
        >
          <Icon name={t.tone === "error" ? "alert" : t.tone === "success" ? "check" : "sparkle"} size={16} className="shrink-0" />
          {t.text}
        </div>
      ))}
    </div>
  );
}
