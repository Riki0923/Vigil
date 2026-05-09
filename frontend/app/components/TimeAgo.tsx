"use client";

import { useEffect, useState } from "react";
import { relativeTime } from "@/lib/format";

// SSR-safe relative time. Initial render returns null on both server and client
// (matching during hydration), then useEffect fills in the live value on the
// client and refreshes every 30s so "5s ago" → "1m ago" without a page reload.
export function TimeAgo({ iso }: { iso: string }) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const update = () => setLabel(relativeTime(iso));
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [iso]);

  return <>{label ?? "—"}</>;
}
