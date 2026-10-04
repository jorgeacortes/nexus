"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import type { LiveAgentsPayload } from "@/lib/herdr";

/** Polls the live Herdr snapshot, keeping the last good payload on a failed tick. */
export function useLiveAgents(initial: LiveAgentsPayload, intervalMs = 5000): LiveAgentsPayload {
  const [payload, setPayload] = useState(initial);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await apiFetch<LiveAgentsPayload>("/api/herdr/snapshot");
        if (!cancelled) setPayload(next);
      } catch {
        // Keep the last known snapshot; the UI shows it as stale.
      }
    };
    const timer = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [intervalMs]);

  return payload;
}
