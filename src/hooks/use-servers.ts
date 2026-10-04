"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { ServersPayload } from "@/lib/servers";
import { SERVERS_POLL_INTERVAL_MS } from "@/lib/servers";

/**
 * Polls the host listener snapshot. A failed tick keeps the last good payload
 * and flags `refreshFailed`, so the screen can say it is no longer refreshing
 * instead of silently presenting a stale (possibly empty) list as current.
 */
export function useServers(
  initial: ServersPayload,
  intervalMs = SERVERS_POLL_INTERVAL_MS,
): { servers: ServersPayload; refreshFailed: boolean } {
  const [servers, setServers] = useState(initial);
  const [refreshFailed, setRefreshFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await apiFetch<ServersPayload>("/api/servers");
        if (cancelled) return;
        setServers(next);
        setRefreshFailed(false);
      } catch {
        if (!cancelled) setRefreshFailed(true);
      }
    };
    const timer = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [intervalMs]);

  return { servers, refreshFailed };
}
